require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});
const mongoose = require("mongoose");
const User = require("../models/User");
const Bet = require("../models/Bet");
const Promo = require("../models/Promo");
const Notification = require("../models/Notification");
const config = require("../config/env");

/**
 * Analyzes user activity to find users at risk of churning and offers them a promotion.
 */
async function analyzePlayerChurn() {
  console.log("🚀 Starting Player Churn analysis script...");

  try {
    // Find users who are not already flagged for any reason
    const users = await User.find({ "responsibleGambling.status": "ok" });

    for (const user of users) {
      let isFlagged = false;
      let reason = "";

      // Rule 1: Check for a long losing streak (e.g., 5 or more losses in a row)
      const recentBets = await Bet.find({ user: user._id })
        .sort({ createdAt: -1 })
        .limit(5);
      if (recentBets.length === 5) {
        const allLost = recentBets.every((bet) => bet.status === "lost");
        if (allLost) {
          isFlagged = true;
          reason = "Recent losing streak detected.";
        }
      }

      // Rule 2: Check for a significant drop in betting frequency
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

        // If user was active (e.g., > 4 bets) and then stopped almost completely
        if (betsPreviousWeek > 4 && betsLastWeek < betsPreviousWeek / 2) {
          isFlagged = true;
          reason = "A significant drop in betting activity was detected.";
        }
      }

      // If the user is flagged, take action
      if (isFlagged) {
        user.responsibleGambling.status = "at_risk"; // Soft-flag the user
        user.responsibleGambling.riskFactors.push(reason);
        await user.save();

        // Create a personalized re-engagement promotion for this user
        const promo = new Promo({
          title: "A Free Bet On Us!",
          description:
            "We've missed you! Here's a free $5 bet to get you back in the game. It will be automatically applied to your next bet over $10.",
          promoType: "FreeBet",
          isActive: true, // Make it active for the user to see
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Expires in 7 days
        });
        await promo.save();

        // Notify the user about their new promotion
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

// Allow running the script directly via 'node scripts/analyzePlayerChurn.js'
if (require.main === module) {
  mongoose
    .connect(config.MONGODB_URI)
    .then(() => {
      console.log("✅ MongoDB connected for manual churn analysis.");
      return analyzePlayerChurn();
    })
    .catch((err) => console.error("DB connection error", err))
    .finally(() => {
      mongoose.disconnect();
      console.log("ℹ️ MongoDB disconnected.");
    });
}

module.exports = { analyzePlayerChurn };
