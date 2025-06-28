const mongoose = require("mongoose");
const Bet = require("../models/Bet");
const Notification = require("../models/Notification");
const { getNewsSummaryForTeam } = require("../services/newsService"); // Assuming a function in newsService

/**
 * Finds upcoming bets and sends AI-powered tips to users.
 * Assumes a database connection is already established.
 * @param {object} io - The Socket.IO instance for real-time notifications.
 */
async function sendPreGameTips(io) {
  console.log("🚀 Starting Pre-Game Intelligent Tips script...");

  try {
    const now = new Date();
    const twentyFourHoursFromNow = new Date(
      now.getTime() + 24 * 60 * 60 * 1000
    );

    const upcomingBets = await Bet.find({
      status: "pending",
      "selections.game.matchDate": { $gte: now, $lte: twentyFourHoursFromNow },
    }).populate("selections.game user");

    for (const bet of upcomingBets) {
      for (const selection of bet.selections) {
        const game = selection.game;
        const user = bet.user;

        if (!game || !user) continue;

        // Generate a news summary for both teams
        const homeNews = await getNewsSummaryForTeam(game.homeTeam);
        const awayNews = await getNewsSummaryForTeam(game.awayTeam);

        const tip = `
          **${game.homeTeam} vs ${game.awayTeam}**
          *Your Pick: ${selection.outcome}*
          
          **Latest News:**
          *${game.homeTeam}:* ${homeNews || "No specific news."}
          *${game.awayTeam}:* ${awayNews || "No specific news."}
        `;

        // Create a notification for the user
        const newNotification = new Notification({
          user: user._id,
          message: tip,
          type: "pre_game_tip",
          link: `/my-bets`,
        });
        await newNotification.save();

        // Emit a real-time event to the user
        if (io) {
          io.to(user._id.toString()).emit("new_notification", newNotification);
        }
      }
    }
    console.log("✅ Pre-Game Intelligent Tips script complete.");
  } catch (error) {
    console.error(
      "❌ An error occurred during the pre-game tips script:",
      error
    );
  }
}

// REMOVED logic that connected/disconnected the database.
// The script now only exports the function to be used by the main app.
module.exports = { sendPreGameTips };
