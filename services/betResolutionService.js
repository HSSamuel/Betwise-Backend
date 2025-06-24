const mongoose = require("mongoose");
const Bet = require("../models/Bet");
const User = require("../models/User");
const Game = require("../models/Game");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification"); // Ensure Notification model is imported

/**
 * A simple helper function for currency formatting on the backend.
 * @param {number} amount - The numerical amount.
 * @returns {string} A formatted currency string.
 */
function formatCurrency(amount) {
  if (typeof amount !== "number") return "$0.00";
  return "$" + amount.toFixed(2);
}

/**
 * Resolves all pending bets for a given game that has finished.
 * @param {object} game - The Mongoose game object that has just finished.
 * @param {object} session - The Mongoose database session.
 * @param {object} io - The Socket.IO server instance.
 */
const resolveBetsForGame = async (game, session, io) => {
  // Find all pending single bets for this game
  const singleBetsToResolve = await Bet.find({
    "selections.game": game._id,
    status: "pending",
    betType: "single",
  }).session(session);

  if (singleBetsToResolve.length > 0) {
    console.log(
      `Resolving ${singleBetsToResolve.length} single bets for game: ${game._id}`
    );
    for (const bet of singleBetsToResolve) {
      await processSingleBet(bet, game, session, io);
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
      await checkAndResolveMultiBet(bet, session, io);
    }
  }
};

/**
 * Processes a single bet's outcome.
 * @param {object} bet - The Mongoose bet object.
 * @param {object} game - The finished game object.
 * @param {object} session - The Mongoose database session.
 * @param {object} io - The Socket.IO server instance.
 */
async function processSingleBet(bet, game, session, io) {
  const user = await User.findById(bet.user).session(session);
  if (!user) {
    console.warn(`User for bet ${bet._id} not found. Skipping.`);
    return;
  }

  const selection = bet.selections[0];
  if (selection.outcome === game.result) {
    // --- Bet is WON ---
    const payout = bet.stake * selection.odds;
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

    await user.save({ session });
    await bet.save({ session });

    const notificationMessage = `Your bet on ${game.homeTeam} vs ${game.awayTeam} won!`;
    io.to(user._id.toString()).emit("bet_settled", {
      status: "won",
      message: notificationMessage,
      payout: bet.payout,
    });
    await new Notification({
      user: user._id,
      message: `${notificationMessage} You won ${formatCurrency(bet.payout)}.`,
      type: `bet_won`,
      link: `/my-bets`,
    }).save({ session });
  } else {
    // --- Bet is LOST ---
    bet.status = "lost";
    bet.payout = 0;
    await bet.save({ session });

    const notificationMessage = `Your bet on ${game.homeTeam} vs ${game.awayTeam} was settled.`;
    io.to(user._id.toString()).emit("bet_settled", {
      status: "lost",
      message: notificationMessage,
    });
    await new Notification({
      user: user._id,
      message: notificationMessage,
      type: `bet_lost`,
      link: `/my-bets`,
    }).save({ session });
  }
}

/**
 * Checks if a multi-bet can be resolved, and if so, processes its outcome.
 * @param {object} bet - The Mongoose multi-bet object.
 * @param {object} session - The Mongoose database session.
 * @param {object} io - The Socket.IO server instance.
 */
async function checkAndResolveMultiBet(bet, session, io) {
  const gameIds = bet.selections.map((s) => s.game);
  const gamesInBet = await Game.find({ _id: { $in: gameIds } }).session(
    session
  );

  const allGamesFinished = gamesInBet.every(
    (g) => g.status === "finished" && g.result
  );
  if (!allGamesFinished || gamesInBet.length !== bet.selections.length) {
    return;
  }

  const user = await User.findById(bet.user).session(session);
  if (!user) {
    console.warn(`User for multi-bet ${bet._id} not found. Skipping.`);
    return;
  }

  let isBetWon = true;
  for (const selection of bet.selections) {
    const game = gamesInBet.find((g) => g._id.equals(selection.game));
    if (!game || selection.outcome !== game.result) {
      isBetWon = false;
      break;
    }
  }

  if (isBetWon) {
    bet.status = "won";
    bet.payout = parseFloat((bet.stake * bet.totalOdds).toFixed(2));
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

    const notificationMessage = `Your multi-bet with ${bet.selections.length} selections won!`;
    io.to(user._id.toString()).emit("bet_settled", {
      status: "won",
      message: notificationMessage,
      payout: bet.payout,
    });
    await new Notification({
      user: user._id,
      message: `${notificationMessage} You won ${formatCurrency(bet.payout)}.`,
      type: "bet_won",
      link: "/my-bets",
    }).save({ session });
  } else {
    bet.status = "lost";
    bet.payout = 0;

    const notificationMessage = `Your multi-bet with ${bet.selections.length} selections was settled.`;
    io.to(user._id.toString()).emit("bet_settled", {
      status: "lost",
      message: notificationMessage,
    });
    await new Notification({
      user: user._id,
      message: notificationMessage,
      type: "bet_lost",
      link: "/my-bets",
    }).save({ session });
  }
  await bet.save({ session });
}

module.exports = {
  resolveBetsForGame,
};
