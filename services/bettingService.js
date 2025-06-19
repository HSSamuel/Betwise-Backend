// In: Bet/Backend/services/bettingService.js

const mongoose = require("mongoose");
const User = require("../models/User");
const Game = require("../models/Game");
const Bet = require("../models/Bet");
const Transaction = require("../models/Transaction");

// 1. We import the function from our new helper service.
const { generateInterventionMessage } = require("./aiHelperService");

/**
 * Checks if a user has exceeded their weekly betting limits.
 * @param {object} user - The Mongoose user object.
 * @param {number} stake - The amount the user wants to bet.
 */
const checkBettingLimits = (user, stake) => {
  const now = new Date();

  // Check Bet Count Limit
  const betLimitInfo = user.limits.weeklyBetCount;
  if (betLimitInfo.limit > 0) {
    if (now > new Date(betLimitInfo.resetDate)) {
      betLimitInfo.currentCount = 0;
      betLimitInfo.resetDate = new Date(
        now.getTime() + 7 * 24 * 60 * 60 * 1000
      );
    }
    if (betLimitInfo.currentCount >= betLimitInfo.limit) {
      const err = new Error(
        `You have reached your weekly limit of ${
          betLimitInfo.limit
        } bets. Your limit will reset on ${betLimitInfo.resetDate.toDateString()}.`
      );
      err.statusCode = 403;
      throw err;
    }
  }

  // Check Stake Amount Limit
  const stakeLimitInfo = user.limits.weeklyStakeAmount;
  if (stakeLimitInfo.limit > 0) {
    if (now > new Date(stakeLimitInfo.resetDate)) {
      stakeLimitInfo.currentAmount = 0;
      stakeLimitInfo.resetDate = new Date(
        now.getTime() + 7 * 24 * 60 * 60 * 1000
      );
    }
    if (stakeLimitInfo.currentAmount + stake > stakeLimitInfo.limit) {
      const remaining = stakeLimitInfo.limit - stakeLimitInfo.currentAmount;
      const err = new Error(
        `This bet would exceed your weekly stake limit of $${
          stakeLimitInfo.limit
        }. You have $${remaining.toFixed(2)} remaining.`
      );
      err.statusCode = 403;
      throw err;
    }
  }
};

/**
 * Checks for patterns of "loss chasing" and throws an error with an AI-generated message if detected.
 * @param {object} user - The Mongoose user object.
 * @param {number} stake - The amount the user wants to bet.
 */
const checkForLossChasing = async (user, stake) => {
  const lastSettledBet = await Bet.findOne({
    user: user._id,
    status: { $in: ["won", "lost"] },
  }).sort({ updatedAt: -1 });

  if (
    lastSettledBet &&
    lastSettledBet.status === "lost" &&
    stake > lastSettledBet.stake * 2
  ) {
    // 2. We use the imported function here.
    const interventionMessage = await generateInterventionMessage(
      user.username,
      lastSettledBet.stake,
      stake
    );
    const err = new Error(interventionMessage);
    err.statusCode = 422;
    err.intervention = true;
    throw err;
  }
};

/**
 * Executes the logic to place a single bet within a database transaction.
 * @param {string} userId - The ID of the user placing the bet.
 * @param {string} gameId - The ID of the game being bet on.
 * @param {string} outcome - The predicted outcome ('A', 'B', 'Draw').
 * @param {number} stake - The amount being staked.
 * @returns {object} An object containing the new bet and the user's updated wallet balance.
 */
const placeSingleBetTransaction = async (userId, gameId, outcome, stake) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(userId).session(session);
    const game = await Game.findById(gameId).session(session);

    if (!game) throw new Error("Game not found.");
    if (game.status !== "upcoming" || new Date(game.matchDate) < new Date()) {
      throw new Error("Betting is closed for this game.");
    }
    if (user.walletBalance < stake) {
      throw new Error("Insufficient funds in your wallet.");
    }

    let selectedOdd;
    if (outcome === "A") selectedOdd = game.odds.home;
    else if (outcome === "B") selectedOdd = game.odds.away;
    else if (outcome === "Draw") selectedOdd = game.odds.draw;

    if (!selectedOdd) {
      throw new Error("Odds for the selected outcome are not available.");
    }

    user.walletBalance -= stake;
    user.favoriteLeagues.addToSet(game.league);

    if (user.limits.weeklyBetCount.limit > 0)
      user.limits.weeklyBetCount.currentCount += 1;
    if (user.limits.weeklyStakeAmount.limit > 0)
      user.limits.weeklyStakeAmount.currentAmount += stake;

    await user.save({ session });

    const bet = new Bet({
      user: userId,
      betType: "single",
      stake,
      totalOdds: selectedOdd,
      selections: [{ game: gameId, outcome: outcome, odds: selectedOdd }],
      game: gameId,
      outcome: outcome,
      oddsAtTimeOfBet: game.odds,
    });
    await bet.save({ session });

    await new Transaction({
      user: user._id,
      type: "bet",
      amount: -stake,
      balanceAfter: user.walletBalance,
      bet: bet._id,
      game: game._id,
      description: `Bet on ${game.homeTeam} vs ${game.awayTeam}`,
    }).save({ session });

    await session.commitTransaction();
    return { bet, walletBalance: user.walletBalance };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * NEW: A comprehensive service to handle the entire process of placing a single bet.
 * This encapsulates user lookup, limit checks, and the database transaction.
 * @param {string} userId - The ID of the user placing the bet.
 * @param {string} gameId - The ID of the game being bet on.
 * @param {string} outcome - The predicted outcome ('A', 'B', 'Draw').
 * @param {number} stake - The amount being staked.
 * @returns {Promise<object>} An object containing the new bet and the user's updated wallet balance.
 */
const placeSingleBet = async (userId, gameId, outcome, stake) => {
  // 1. Fetch the user from the database.
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error("User for this operation was not found.");
    err.statusCode = 404;
    throw err;
  }

  // 2. Perform all business logic checks before the transaction.
  checkBettingLimits(user, stake);
  await checkForLossChasing(user, stake);

  // 3. Execute the database transaction to place the bet.
  const { bet, walletBalance } = await placeSingleBetTransaction(
    userId,
    gameId,
    outcome,
    stake
  );

  return { bet, walletBalance };
};

module.exports = {
  checkBettingLimits,
  checkForLossChasing,
  placeSingleBetTransaction,
  placeSingleBet,
};