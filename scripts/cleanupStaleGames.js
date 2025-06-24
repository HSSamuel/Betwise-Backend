const mongoose = require("mongoose");
const Game = require("../models/Game");
const Bet = require("../models/Bet");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const config = require("../config/env");

const STALE_GAME_THRESHOLD_HOURS = 4;

const cleanupStaleGames = async () => {
  console.log("🤖 Starting stale game cleanup script...");

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const thresholdDate = new Date(
      Date.now() - STALE_GAME_THRESHOLD_HOURS * 60 * 60 * 1000
    );

    const staleGames = await Game.find({
      status: "live",
      matchDate: { $lt: thresholdDate },
    }).session(session);

    if (staleGames.length === 0) {
      console.log("✅ No stale live games found. All clean!");
      await session.abortTransaction();
      // We must end the session, but no longer disconnect mongoose.
      session.endSession();
      return;
    }

    console.log(`🧹 Found ${staleGames.length} stale live games to cancel...`);

    for (const game of staleGames) {
      game.status = "cancelled";
      game.result = null;
      await game.save({ session, validateBeforeSave: false });

      const betsToRefund = await Bet.find({
        "selections.game": game._id,
        status: "pending",
      })
        .populate("user")
        .session(session);

      for (const bet of betsToRefund) {
        if (bet.user) {
          bet.user.walletBalance += bet.stake;
          await bet.user.save({ session });
          await new Transaction({
            user: bet.user._id,
            type: "refund",
            amount: bet.stake,
            balanceAfter: bet.user.walletBalance,
            bet: bet._id,
            game: game._id,
            description: `Refund for stale/cancelled game: ${game.homeTeam} vs ${game.awayTeam}`,
          }).save({ session });
        }
        bet.status = "cancelled";
        await bet.save({ session });
      }
      console.log(
        `  - Game ${game._id} cancelled and ${betsToRefund.length} bets refunded.`
      );
    }

    await session.commitTransaction();
    console.log("✅ Stale game cleanup complete.");
  } catch (error) {
    await session.abortTransaction();
    console.error("❌ An error occurred during stale game cleanup:", error);
  } finally {
    session.endSession();
  }
};

// This part is for running the script manually. We'll add connection logic here.
if (require.main === module) {
  const runStandalone = async () => {
    await mongoose.connect(config.MONGODB_URI);
    await cleanupStaleGames();
    await mongoose.disconnect();
  };
  runStandalone();
}

module.exports = { cleanupStaleGames };
