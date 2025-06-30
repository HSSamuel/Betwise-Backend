const mongoose = require("mongoose");
const User = require("../models/User");
const Bet = require("../models/Bet");
const Promo = require("../models/Promo");
const Notification = require("../models/Notification");

/**
 * Analyzes user activity to find users at risk of churning.
 * Assumes a database connection is already established.
 */
async function analyzePlayerChurn() {
  console.log("🚀 Starting Player Churn analysis script...");

  try {
    const users = await User.find({ "responsibleGambling.status": "ok" });

    for (const user of users) {
      let isFlagged = false;
      let reason = "";

      const recentBets = await Bet.find({ user: user._id })
        .sort({ createdAt: -1 })
        .limit(5);
      if (
        recentBets.length === 5 &&
        recentBets.every((bet) => bet.status === "lost")
      ) {
        isFlagged = true;
        reason = "Recent losing streak detected.";
      }

      if (!isFlagged) {
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
        const betsLastWeek = await Bet.countDocuments({
          user: user._id,
          createdAt: { $gte: oneWeekAgo },
        });
        const betsPreviousWeek = await Bet.countDocuments({
          user: user._id,
          createdAt: { $gte: twoWeeksAgo, $lt: oneWeekAgo },
        });

        if (betsPreviousWeek > 4 && betsLastWeek < betsPreviousWeek / 2) {
          isFlagged = true;
          reason = "A significant drop in betting activity was detected.";
        }
      }

      if (isFlagged) {
        user.responsibleGambling.status = "at_risk";
        user.responsibleGambling.riskFactors.push(reason);
        await user.save();

        const promo = new Promo({
          title: "A Free Bet On Us!",
          description:
            "We've missed you! Here's a free $5 bet to get you back in the game. It will be automatically applied to your next bet over $10.",
          promoType: "FreeBet",
          isActive: true,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        await promo.save();

        await new Notification({
          user: user._id,
          message:
            "We've missed you! Check out your new promotion in the Promotions tab.",
          type: "promo",
          link: "/promotions",
        }).save();

        console.log(
          `⚠️  FLAGGED USER FOR CHURN: ${user.username}. Reason: ${reason}. A Free Bet promo has been offered.`
        );
      }
    }
    console.log("✅ Player Churn analysis complete.");
  } catch (error) {
    console.error("❌ An error occurred during churn analysis:", error);
  }
}

// REMOVED logic that connected/disconnected the database.
module.exports = { analyzePlayerChurn };
