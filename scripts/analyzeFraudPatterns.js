// In: scripts/analyzeFraudPatterns.js

require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});

const mongoose = require("mongoose");
const User = require("../models/User");
const Bet = require("../models/Bet");
const Transaction = require("../models/Transaction");
const Withdrawal = require("../models/Withdrawal");

const SCRIPT_THRESHOLD_HOURS = 48; // Analyze users created in the last 48 hours
const MIN_BET_COUNT_FOR_WITHDRAWAL = 3; // User must have at least this many bets to not be suspicious

async function analyzeUsersForFraud() {
  console.log("🚀 Starting Fraud Pattern analysis script...");
  const dbUri = process.env.MONGODB_URI;
  if (!dbUri) {
    console.error("❌ Error: MONGODB_URI is not defined.");
    process.exit(1);
  }

  await mongoose.connect(dbUri);
  console.log("✅ MongoDB connected.");

  try {
    const thresholdDate = new Date(
      Date.now() - SCRIPT_THRESHOLD_HOURS * 60 * 60 * 1000
    );
    const newUsers = await User.find({ createdAt: { $gte: thresholdDate } });

    console.log(`ℹ️  Found ${newUsers.length} new users to analyze...`);

    for (const user of newUsers) {
      // Rule 1: Does the user have a pending withdrawal request?
      const pendingWithdrawal = await Withdrawal.findOne({
        user: user._id,
        status: "pending",
      });
      if (!pendingWithdrawal) {
        continue; // Not suspicious if there's no withdrawal request, move to next user
      }

      // Rule 2: Has the user placed very few bets?
      const betCount = await Bet.countDocuments({ user: user._id });
      if (betCount >= MIN_BET_COUNT_FOR_WITHDRAWAL) {
        continue; // User has sufficient betting activity, not suspicious
      }

      // If both rules are met, flag the user.
      user.flags.isFlaggedForFraud = true;
      user.flags.fraudReason = `User has a pending withdrawal of ${pendingWithdrawal.amount} with only ${betCount} bets placed. Possible rapid deposit/withdrawal activity.`;

      await user.save();
      console.log(
        `⚠️  FLAGGED USER: ${user.username}. Reason: ${user.flags.fraudReason}`
      );
    }

    console.log("✅ Fraud analysis complete.");
  } catch (error) {
    console.error("❌ An error occurred during fraud analysis:", error);
  } finally {
    await mongoose.disconnect();
    console.log("ℹ️ MongoDB disconnected.");
  }
}

analyzeUsersForFraud();
