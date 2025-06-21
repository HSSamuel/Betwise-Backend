// In: Bet/Backend/controllers/aviatorController.js

const { body, validationResult } = require("express-validator");
const mongoose = require("mongoose");
const User = require("../models/User");
const AviatorBet = require("../models/AviatorBet");
const Transaction = require("../models/Transaction");

// --- Validation Rules ---
exports.validatePlaceBet = [
  body("stake")
    .isFloat({ gt: 0 })
    .withMessage("A positive stake amount is required.")
    .toFloat(),
];

// --- Controller Functions ---

exports.placeBet = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const aviatorService = req.aviatorService;
  const { stake } = req.body;
  const userId = req.user._id;

  // Check game state from the service
  if (aviatorService.gameState !== "betting") {
    const err = new Error(
      "Bets can only be placed during the 'betting' phase."
    );
    err.statusCode = 400;
    return next(err);
  }

  // --- FIX: Add a guard clause to ensure a game round exists ---
  if (!aviatorService.currentGame) {
    const err = new Error(
      "Cannot place bet. The game round has not started yet."
    );
    err.statusCode = 400;
    return next(err);
  }
  // --- END FIX ---

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new Error("User not found.");
    }
    if (user.walletBalance < stake) {
      throw new Error("Insufficient funds.");
    }
    const existingBet = await AviatorBet.findOne({
      user: userId,
      game: aviatorService.currentGame._id,
    }).session(session);
    if (existingBet) {
      throw new Error("You have already placed a bet on this round.");
    }

    // Deduct stake and create records
    user.walletBalance -= stake;

    const bet = new AviatorBet({
      user: userId,
      game: aviatorService.currentGame._id,
      stake: stake,
    });

    const transaction = new Transaction({
      user: userId,
      type: "bet",
      amount: -stake,
      balanceAfter: user.walletBalance,
      description: `Aviator bet for round #${aviatorService.currentGame._id}`,
    });

    await user.save({ session });
    await bet.save({ session });
    await transaction.save({ session });

    await session.commitTransaction();

    res.status(201).json({
      message: "Bet placed successfully!",
      bet,
      walletBalance: user.walletBalance,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

exports.cashOut = async (req, res, next) => {
  const aviatorService = req.aviatorService;
  const userId = req.user._id;

  if (aviatorService.gameState !== "running") {
    const err = new Error("You can only cash out while the game is running.");
    err.statusCode = 400;
    return next(err);
  }

  // --- FIX: Add a guard clause to ensure a game round exists ---
  if (!aviatorService.currentGame) {
    const err = new Error(
      "Cannot cash out. The game round has not started yet."
    );
    err.statusCode = 400;
    return next(err);
  }
  // --- END FIX ---

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const bet = await AviatorBet.findOne({
      user: userId,
      game: aviatorService.currentGame._id,
      status: "pending",
    }).session(session);

    if (!bet) {
      throw new Error("No active bet found for this round to cash out.");
    }

    const cashOutMultiplier = aviatorService.multiplier;
    const payout = bet.stake * cashOutMultiplier;

    bet.status = "won";
    bet.cashOutAt = cashOutMultiplier;
    bet.payout = parseFloat(payout.toFixed(2));

    const user = await User.findById(userId).session(session);
    user.walletBalance += bet.payout;

    const transaction = new Transaction({
      user: userId,
      type: "win",
      amount: bet.payout,
      balanceAfter: user.walletBalance,
      description: `Aviator cash out at ${cashOutMultiplier}x`,
    });

    await bet.save({ session });
    await user.save({ session });
    await transaction.save({ session });

    await session.commitTransaction();

    // Notify clients of the cash out
    aviatorService.io.emit("aviator:cashed_out", {
      username: user.username,
      payout: bet.payout,
      multiplier: cashOutMultiplier,
    });

    res.status(200).json({
      message: "Cashed out successfully!",
      payout: bet.payout,
      multiplier: cashOutMultiplier,
      walletBalance: user.walletBalance,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};
