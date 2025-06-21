const { body, query, param, validationResult } = require("express-validator");
const mongoose = require("mongoose");
const Bet = require("../models/Bet");
const Game = require("../models/Game");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const bettingService = require("../services/bettingService");

// --- Validation Rules ---
exports.validatePlaceBet = [
  body("gameId").isMongoId().withMessage("Valid gameId is required."),
  body("outcome")
    .isIn(["A", "B", "Draw"])
    .withMessage("Outcome must be 'A', 'B', or 'Draw'."),
  body("stake")
    .isFloat({ gt: 0 })
    .withMessage("Stake must be a positive number.")
    .toFloat(),
];

exports.validatePlaceMultipleSingles = [
  body("stakePerBet")
    .isFloat({ gt: 0 })
    .withMessage("A positive stake per bet is required.")
    .toFloat(),
  body("selections")
    .isArray({ min: 1 })
    .withMessage("At least one selection is required."),
  body("selections.*.gameId")
    .isMongoId()
    .withMessage("Each selection must have a valid gameId."),
  body("selections.*.outcome")
    .isIn(["A", "B", "Draw"])
    .withMessage("Each selection outcome must be 'A', 'B', or 'Draw'."),
];

exports.validateGetUserBets = [
  query("status").optional().isIn(["pending", "won", "lost", "cancelled"]),
  query("gameId").optional().isMongoId(),
  query("page").optional().isInt({ min: 1 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
];

exports.validateGetBetById = [
  param("id")
    .isMongoId()
    .withMessage("A valid bet ID is required in the URL parameter."),
];

exports.validatePlaceMultiBet = [
  body("stake")
    .isFloat({ gt: 0 })
    .withMessage("A positive stake is required.")
    .toFloat(),
  body("selections")
    .isArray({ min: 2, max: 10 })
    .withMessage("A multi-bet must contain between 2 and 10 selections."),
  body("selections.*.gameId")
    .isMongoId()
    .withMessage("Each selection must have a valid gameId."),
  body("selections.*.outcome")
    .isIn(["A", "B", "Draw"])
    .withMessage("Each selection outcome must be 'A', 'B', or 'Draw'."),
  body("selections").custom((selections) => {
    const gameIds = selections.map((s) => s.gameId);
    const uniqueGameIds = new Set(gameIds);
    if (uniqueGameIds.size !== gameIds.length) {
      throw new Error(
        "A multi-bet cannot contain multiple selections from the same game."
      );
    }
    return true;
  }),
];

// --- Controller Functions ---

exports.placeBet = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { gameId, outcome, stake } = req.body;
  const userId = req.user._id;

  try {
    const result = await bettingService.placeSingleBet(
      userId,
      gameId,
      outcome,
      stake
    );
    res.status(201).json({
      msg: "Bet placed successfully!",
      bet: result.bet,
      walletBalance: result.walletBalance,
    });
  } catch (error) {
    next(error);
  }
};

exports.placeMultiBet = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { stake, selections } = req.body;
  const userId = req.user._id;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error("User not found.");
    if (user.walletBalance < stake) throw new Error("Insufficient funds.");

    const gameIds = selections.map((s) => s.gameId);
    const games = await Game.find({
      _id: { $in: gameIds },
      status: "upcoming",
    }).session(session);

    if (games.length !== selections.length) {
      throw new Error(
        "One or more selected games are not available for betting (they may have started or do not exist)."
      );
    }

    let totalOdds = 1;
    const finalSelections = [];

    for (const selection of selections) {
      const game = games.find((g) => g._id.toString() === selection.gameId);
      if (!game) throw new Error(`Game with ID ${selection.gameId} not found.`);

      let selectionOdds;
      if (selection.outcome === "A") selectionOdds = game.odds.home;
      else if (selection.outcome === "B") selectionOdds = game.odds.away;
      else if (selection.outcome === "Draw") selectionOdds = game.odds.draw;

      if (!selectionOdds)
        throw new Error(
          `Odds for the selected outcome in game ${game.homeTeam} vs ${game.awayTeam} are not available.`
        );

      totalOdds *= selectionOdds;
      finalSelections.push({
        game: game._id,
        outcome: selection.outcome,
        odds: selectionOdds,
      });
    }

    user.walletBalance -= stake;
    await user.save({ session });

    const multiBet = new Bet({
      user: userId,
      betType: "multi",
      stake,
      totalOdds: parseFloat(totalOdds.toFixed(2)),
      selections: finalSelections,
    });
    await multiBet.save({ session });

    await new Transaction({
      user: user._id,
      type: "bet",
      amount: -stake,
      balanceAfter: user.walletBalance,
      bet: multiBet._id,
      description: `Multi-bet with ${finalSelections.length} selections.`,
    }).save({ session });

    await session.commitTransaction();
    res.status(201).json({
      msg: "Multi-bet placed successfully!",
      bet: multiBet,
      walletBalance: user.walletBalance,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

exports.placeMultipleSingles = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { stakePerBet, selections } = req.body;
  const userId = req.user._id;
  const totalStake = stakePerBet * selections.length;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error("User not found.");
    if (user.walletBalance < totalStake)
      throw new Error("Insufficient funds for the total stake.");

    const gameIds = selections.map((s) => s.gameId);
    const games = await Game.find({
      _id: { $in: gameIds },
      status: "upcoming",
    }).session(session);
    if (games.length !== selections.length) {
      throw new Error(
        "One or more selected games are not available for betting."
      );
    }

    user.walletBalance -= totalStake;

    const bets = [];
    for (const selection of selections) {
      const game = games.find((g) => g._id.toString() === selection.gameId);
      if (!game) throw new Error(`Game with ID ${selection.gameId} not found.`);

      let selectedOdd;
      if (selection.outcome === "A") selectedOdd = game.odds.home;
      else if (selection.outcome === "B") selectedOdd = game.odds.away;
      else selectedOdd = game.odds.draw;

      const bet = new Bet({
        user: userId,
        betType: "single",
        stake: stakePerBet,
        totalOdds: selectedOdd,
        selections: [
          { game: game._id, outcome: selection.outcome, odds: selectedOdd },
        ],
      });
      bets.push(bet);

      await new Transaction({
        user: user._id,
        type: "bet",
        amount: -stakePerBet,
        balanceAfter:
          user.walletBalance + totalStake - bets.length * stakePerBet,
        bet: bet._id,
        game: game._id,
        description: `Bet on ${game.homeTeam} vs ${game.awayTeam}`,
      }).save({ session });
    }

    await Bet.insertMany(bets, { session });
    await user.save({ session });

    await session.commitTransaction();
    res.status(201).json({
      msg: `${bets.length} single bets placed successfully!`,
      bets,
      walletBalance: user.walletBalance,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

exports.getUserBets = async (req, res, next) => {
  try {
    const { status, gameId, page = 1, limit = 10 } = req.query;

    const filter = { user: req.user._id };
    if (status) filter.status = status;
    if (gameId) filter["selections.game"] = gameId;

    const skip = (page - 1) * limit;

    // FIX: This query now populates BOTH the new `selections.game` path AND the
    // legacy `game` path. This ensures all bets, new and old, have their game data.
    const bets = await Bet.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: "selections.game",
        select: "homeTeam awayTeam league matchDate result",
      })
      .populate({
        path: "game", // Populate the legacy field
        select: "homeTeam awayTeam league matchDate result",
      })
      .lean();

    // This block normalizes the data so the frontend doesn't have to handle two different structures.
    // It creates a `selections` array for legacy bets.
    const normalizedBets = bets.map((bet) => {
      if ((!bet.selections || bet.selections.length === 0) && bet.game) {
        return {
          ...bet,
          selections: [
            {
              game: bet.game,
              outcome: bet.outcome,
              odds: bet.totalOdds,
            },
          ],
        };
      }
      return bet;
    });

    const totalBets = await Bet.countDocuments(filter);

    res.status(200).json({
      bets: normalizedBets,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalBets / limit),
      totalCount: totalBets,
    });
  } catch (error) {
    next(error);
  }
};

exports.getBetById = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const betId = req.params.id;
    const userId = req.user._id;

    const bet = await Bet.findOne({ _id: betId, user: userId })
      .populate({
        path: "selections.game",
        select:
          "homeTeam awayTeam league matchDate result homeTeamLogo awayTeamLogo",
      })
      .populate({
        path: "game",
        select:
          "homeTeam awayTeam league matchDate result homeTeamLogo awayTeamLogo",
      })
      .lean();

    if (!bet) {
      const err = new Error(
        "Bet not found or you do not have permission to view it."
      );
      err.statusCode = 404;
      return next(err);
    }

    // Normalize data for the single bet view as well
    if ((!bet.selections || bet.selections.length === 0) && bet.game) {
      bet.selections = [
        {
          game: bet.game,
          outcome: bet.outcome,
          odds: bet.totalOdds,
        },
      ];
    }

    res.status(200).json(bet);
  } catch (error) {
    next(error);
  }
};
