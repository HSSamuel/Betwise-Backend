require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});
const mongoose = require("mongoose");
const Bet = require("../models/Bet");
const Game = require("../models/Game");
const User = require("../models/User");
const Notification = require("../models/Notification");
const { getNewsSummary } = require("../services/aiService");
const config = require("../config/env");

async function sendPreGameTips() {
  console.log("🚀 Starting Pre-Game Intelligent Tips script...");
  const dbUri = config.MONGODB_URI;
  if (!dbUri) {
    console.error("❌ Error: MONGODB_URI is not defined.");
    process.exit(1);
  }

  await mongoose.connect(dbUri);
  console.log("✅ MongoDB connected.");

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

        // Generate a news summary for both teams
        const homeNews = await getNewsSummary(game.homeTeam);
        const awayNews = await getNewsSummary(game.awayTeam);

        const tip = `
          **${game.homeTeam} vs ${game.awayTeam}**
          *Your Pick: ${selection.outcome}*
          
          **Latest News:**
          *${game.homeTeam}:* ${homeNews}
          *${game.awayTeam}:* ${awayNews}
        `;

        // Create a notification for the user
        await new Notification({
          user: user._id,
          message: tip,
          type: "promo",
          link: `/my-bets`,
        }).save();
      }
    }

    console.log("✅ Pre-Game Intelligent Tips script complete.");
  } catch (error) {
    console.error(
      "❌ An error occurred during the pre-game tips script:",
      error
    );
  } finally {
    await mongoose.disconnect();
    console.log("ℹ️ MongoDB disconnected.");
  }
}

sendPreGameTips();
