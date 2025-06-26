require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});
const mongoose = require("mongoose");
const User = require("../models/User");
const Bet = require("../models/Bet");
const Transaction = require("../models/Transaction");
const { sendEmail } = require("../services/emailService");
const config = require("../config/env");

async function analyzePlayerChurn() {
  console.log("🚀 Starting Player Churn analysis script...");
  const dbUri = process.env.MONGODB_URI;
  if (!dbUri) {
    console.error("❌ Error: MONGODB_URI is not defined.");
    process.exit(1);
  }

  await mongoose.connect(dbUri);
  console.log("✅ MongoDB connected.");

  try {
    const users = await User.find({ "responsibleGambling.status": "ok" });

    for (const user of users) {
      // Rule 1: Long losing streak
      const recentBets = await Bet.find({ user: user._id })
        .sort({ createdAt: -1 })
        .limit(10);
      const losingStreak = recentBets.every((bet) => bet.status === "lost");

      // Rule 2: Decreased betting frequency
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

      if (losingStreak && recentBets.length >= 5) {
        // Flag for churn and offer a promotion
        user.responsibleGambling.status = "at_risk";
        user.responsibleGambling.riskFactors.push("Long losing streak");
        await user.save();
        // Here you would integrate with your promotions system to offer a FreeBet
        console.log(
          `⚠️  FLAGGED USER FOR CHURN: ${user.username}. Reason: Long losing streak.`
        );
      }

      if (betsLastWeek < betsPreviousWeek / 2 && betsPreviousWeek > 5) {
        // Flag for churn and offer a promotion
        user.responsibleGambling.status = "at_risk";
        user.responsibleGambling.riskFactors.push(
          "Decreased betting frequency"
        );
        await user.save();
        console.log(
          `⚠️  FLAGGED USER FOR CHURN: ${user.username}. Reason: Decreased betting frequency.`
        );
      }
    }

    console.log("✅ Player Churn analysis complete.");
  } catch (error) {
    console.error("❌ An error occurred during churn analysis:", error);
  } finally {
    await mongoose.disconnect();
    console.log("ℹ️ MongoDB disconnected.");
  }
}

analyzePlayerChurn();
