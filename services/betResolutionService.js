// In: services/betResolutionService.js

const mongoose = require("mongoose");
const Bet = require("../models/Bet");
const User = require("../models/User");
const Game = require("../models/Game");
const Transaction = require("../models/Transaction");

/**
 * Resolves all pending bets (both single and multi) for a given game that has finished.
 * This function should be called within a database session.
 * @param {object} game - The Mongoose game object that has just finished.
 * @param {object} session - The Mongoose database session.
 */
const resolveBetsForGame = async (game, session) => {
  // Find all pending single bets for this game
  const singleBetsToResolve = await Bet.find({
    game: game._id,
    status: "pending",
    betType: "single",
  }).session(session);

  if (singleBetsToResolve.length > 0) {
    console.log(
      `Resolving ${singleBetsToResolve.length} single bets for game: ${game._id}`
    );
    for (const bet of singleBetsToResolve) {
      await processSingleBet(bet, game, session);
    }
  }

  // Find all multi-bets that include this game
  const multiBetsToCheck = await Bet.find({
    "selections.game": game._id,
    status: "pending",
    betType: "multi",
  }).session(session);

  if (multiBetsToCheck.length > 0) {
    console.log(
      `Checking ${multiBetsToCheck.length} multi-bets containing game: ${game._id}`
    );
    for (const bet of multiBetsToCheck) {
      await checkAndResolveMultiBet(bet, session);
    }
  }
};

/**
 * Processes a single bet's outcome.
 * @param {object} bet - The Mongoose bet object.
 * @param {object} game - The finished game object.
 * @param {object} session - The Mongoose database session.
 */
async function processSingleBet(bet, game, session) {
  const user = await User.findById(bet.user).session(session);
  if (!user) {
    console.warn(`User for bet ${bet._id} not found. Skipping.`);
    return;
  }

  if (bet.outcome === game.result) {
    // --- Bet is WON ---
    let winningOdds =
      bet.outcome === "A"
        ? bet.oddsAtTimeOfBet.home
        : bet.outcome === "B"
        ? bet.oddsAtTimeOfBet.away
        : bet.oddsAtTimeOfBet.draw;
    const payout = bet.stake * winningOdds;
    bet.status = "won";
    bet.payout = parseFloat(payout.toFixed(2));
    user.walletBalance += bet.payout;

    await new Transaction({
      user: user._id,
      type: "win",
      amount: bet.payout,
      balanceAfter: user.walletBalance,
      bet: bet._id,
      game: game._id,
      description: `Winnings for bet on ${game.homeTeam} vs ${game.awayTeam}`,
    }).save({ session });
  } else {
    // --- Bet is LOST ---
    bet.status = "lost";
    bet.payout = 0;
  }

  await bet.save({ session });
  await user.save({ session });
}

/**
 * Checks if a multi-bet can be resolved, and if so, processes its outcome.
 * @param {object} bet - The Mongoose multi-bet object.
 * @param {object} session - The Mongoose database session.
 */
async function checkAndResolveMultiBet(bet, session) {
  const gameIds = bet.selections.map((s) => s.game);
  const gamesInBet = await Game.find({ _id: { $in: gameIds } }).session(
    session
  );

  // Check if all games in the bet slip have finished
  const allGamesFinished = gamesInBet.every(
    (g) => g.status === "finished" && g.result
  );
  if (!allGamesFinished || gamesInBet.length !== bet.selections.length) {
    return; // Skip this bet if one or more games are still pending
  }

  let isBetWon = true;
  for (const selection of bet.selections) {
    const game = gamesInBet.find((g) => g._id.equals(selection.game));
    if (selection.outcome !== game.result) {
      isBetWon = false;
      break; // One loss is enough to lose the whole bet
    }
  }

  if (isBetWon) {
    bet.status = "won";
    bet.payout = bet.stake * bet.totalOdds;
    const user = await User.findById(bet.user).session(session);
    user.walletBalance += bet.payout;

    await new Transaction({
      user: user._id,
      type: "win",
      amount: bet.payout,
      balanceAfter: user.walletBalance,
      bet: bet._id,
      description: `Win from multi-bet with ${bet.selections.length} selections.`,
    }).save({ session });

    await user.save({ session });
    console.log(
      `✅ Multi-bet ${bet._id} was WON. Payout: $${bet.payout.toFixed(2)}.`
    );
  } else {
    bet.status = "lost";
    bet.payout = 0;
    console.log(`❌ Multi-bet ${bet._id} was LOST.`);
  }
  await bet.save({ session });
}

module.exports = {
  resolveBetsForGame,
};
