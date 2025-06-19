const { body, query, param, validationResult } = require("express-validator");
const mongoose = require("mongoose");
const Game = require("../models/Game");
const Bet = require("../models/Bet");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { generateGameSummary } = require("./aiController");
const { generateOddsForGame } = require("../services/oddsService");
const { resolveBetsForGame } = require("../services/betResolutionService"); // UPDATED IMPORT

// --- Validation Rules --- (No changes to validation rules)
// Made odds validation optional for single game creation
exports.validateCreateGame = [
  body("homeTeam")
    .trim()
    .notEmpty()
    .withMessage("Home team is required.")
    .isLength({ min: 2, max: 100 }),
  body("awayTeam")
    .trim()
    .notEmpty()
    .withMessage("Away team is required.")
    .isLength({ min: 2, max: 100 })
    .custom((value, { req }) => {
      if (value.toLowerCase() === req.body.homeTeam.toLowerCase()) {
        throw new Error("Home team and away team cannot be the same.");
      }
      return true;
    }),
  body("odds")
    .optional()
    .isObject()
    .withMessage("Odds, if provided, must be an object."),
  body("odds.home")
    .if(body("odds").exists())
    .isFloat({ min: 1 })
    .withMessage("Home odd must be at least 1.")
    .toFloat(),
  body("odds.away")
    .if(body("odds").exists())
    .isFloat({ min: 1 })
    .withMessage("Away odd must be at least 1.")
    .toFloat(),
  body("odds.draw")
    .if(body("odds").exists())
    .isFloat({ min: 1 })
    .withMessage("Draw odd must be at least 1.")
    .toFloat(),
  body("league")
    .trim()
    .notEmpty()
    .withMessage("League is required.")
    .isLength({ min: 2, max: 100 }),
  body("matchDate")
    .isISO8601()
    .toDate()
    .withMessage("Valid match date is required.")
    .custom((value) => {
      if (value.getTime() < Date.now()) {
        throw new Error("Match date cannot be in the past.");
      }
      return true;
    }),
  body("status").optional().isIn(["upcoming", "live", "finished", "cancelled"]),
];

exports.validateGetGames = [
  query("league").optional().isString().trim().escape(),
  query("status")
    .optional()
    .isIn(["upcoming", "live", "finished", "cancelled"])
    .escape(),
  query("date").optional().isISO8601().toDate(),
  query("page").optional().isInt({ min: 1 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
];

exports.validateGameId = [
  param("id").isMongoId().withMessage("Invalid game ID format."),
];

exports.validateSetResult = [
  param("id").isMongoId().withMessage("Invalid game ID format."),
  body("result")
    .isIn(["A", "B", "Draw"])
    .withMessage("Result must be 'A', 'B', or 'Draw'."),
];

exports.validateUpdateGame = [
  param("id").isMongoId().withMessage("Invalid game ID format."),
  body("homeTeam").optional().trim().isLength({ min: 2, max: 100 }).escape(),
  body("awayTeam").optional().trim().isLength({ min: 2, max: 100 }).escape(),
  body("odds").optional().isObject(),
  body("odds.home").optional().isFloat({ min: 1 }).toFloat(),
  body("odds.away").optional().isFloat({ min: 1 }).toFloat(),
  body("odds.draw").optional().isFloat({ min: 1 }).toFloat(),
  body("league").optional().trim().isLength({ min: 2, max: 100 }).escape(),
  body("matchDate").optional().isISO8601().toDate(),
  body("status").optional().isIn(["upcoming", "live", "finished", "cancelled"]),
];

exports.validateCreateMultipleGames = [
  body()
    .isArray({ min: 1 })
    .withMessage("Request body must be an array of games."),
  body("*.homeTeam").notEmpty().trim().isLength({ min: 2, max: 100 }),
  body("*.awayTeam").notEmpty().trim().isLength({ min: 2, max: 100 }),
  body("*.league").notEmpty().trim(),
  body("*.matchDate").isISO8601().toDate(),
  body("*.odds.home")
    .isFloat({ min: 1 })
    .withMessage("Home odd must be at least 1."),
  body("*.odds.away")
    .isFloat({ min: 1 })
    .withMessage("Away odd must be at least 1."),
  body("*.odds.draw")
    .isFloat({ min: 1 })
    .withMessage("Draw odd must be at least 1."),
  body().custom((gamesArray) => {
    for (const game of gamesArray) {
      if (
        game.homeTeam &&
        game.awayTeam &&
        game.homeTeam.trim().toLowerCase() ===
          game.awayTeam.trim().toLowerCase()
      ) {
        throw new Error(
          `In game "${game.homeTeam} vs ${game.awayTeam}", teams cannot be the same.`
        );
      }
    }
    return true;
  }),
];

// --- Controller Functions --- (No changes to other functions)

exports.createMultipleGames = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const createdGames = await Game.insertMany(req.body, { ordered: false });
    res.status(201).json({
      msg: `Successfully created ${createdGames.length} new games.`,
      createdGames,
    });
  } catch (error) {
    next(error);
  }
};

exports.createGame = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  let { homeTeam, awayTeam, odds, league, matchDate, status } = req.body;

  try {
    if (!odds) {
      console.log("ℹ️ Odds not provided. Calling odds generation service...");
      odds = generateOddsForGame(homeTeam, awayTeam);
    }

    const startOfDay = new Date(new Date(matchDate).setHours(0, 0, 0, 0));
    const endOfDay = new Date(new Date(matchDate).setHours(23, 59, 59, 999));

    const existingGame = await Game.findOne({
      homeTeam: { $regex: new RegExp(`^${homeTeam}$`, "i") },
      awayTeam: { $regex: new RegExp(`^${awayTeam}$`, "i") },
      matchDate: { $gte: startOfDay, $lt: endOfDay },
    });

    if (existingGame) {
      const err = new Error(
        "A game with these teams on this date already exists."
      );
      err.statusCode = 400;
      return next(err);
    }

    const gameSummary = await generateGameSummary(homeTeam, awayTeam, league);

    const game = new Game({
      homeTeam,
      awayTeam,
      odds,
      league,
      matchDate,
      status: status || "upcoming",
      summary: gameSummary,
    });
    await game.save();

    res.status(201).json({
      message: `Match added: ${game.homeTeam} vs ${game.awayTeam}.`,
      game,
    });
  } catch (error) {
    next(error);
  }
};

exports.getGames = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const { league, status, date, page = 1, limit = 10 } = req.query;
    const filter = {};
    if (league) filter.league = { $regex: new RegExp(league, "i") };
    if (status) filter.status = status;
    if (date) {
      const startDate = new Date(new Date(date).setHours(0, 0, 0, 0));
      const endDate = new Date(new Date(date).setHours(23, 59, 59, 999));
      filter.matchDate = { $gte: startDate, $lte: endDate };
    }
    const skip = (page - 1) * limit;
    const games = await Game.find(filter)
      .sort({ matchDate: 1 })
      .limit(limit)
      .skip(skip)
      .lean();
    const totalGames = await Game.countDocuments(filter);
    res.json({
      games,
      currentPage: page,
      totalPages: Math.ceil(totalGames / limit),
      totalCount: totalGames,
    });
  } catch (error) {
    next(error);
  }
};

exports.getGameById = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const game = await Game.findById(req.params.id).lean();
    if (!game) {
      const err = new Error("Game not found.");
      err.statusCode = 404;
      return next(err);
    }
    res.json(game);
  } catch (error) {
    next(error);
  }
};

// --- REFACTORED setResult FUNCTION ---
exports.setResult = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { id } = req.params;
  const { result } = req.body;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const game = await Game.findById(id).session(session);
    if (!game) throw new Error("Game not found.");
    if (game.status === "cancelled")
      throw new Error("Cannot set result for a cancelled game.");
    if (game.result)
      throw new Error(
        `Game result already set to ${game.result}. Cannot change.`
      );

    game.result = result;
    game.status = "finished";
    await game.save({ session });

    // Call the single, consolidated service to resolve all bets for this game
    await resolveBetsForGame(game, session);

    await session.commitTransaction();

    req.io.emit("gameResultUpdated", {
      gameId: game._id,
      result: game.result,
      status: game.status,
    });
    res.json({
      msg: `Result for game ${game.homeTeam} vs ${game.awayTeam} set to '${result}'. Bets resolved.`,
      game,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

exports.updateGame = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { id } = req.params;
  const updates = req.body;
  try {
    const game = await Game.findById(id);
    if (!game) {
      const err = new Error("Game not found.");
      err.statusCode = 404;
      return next(err);
    }
    if (game.status === "finished" || game.status === "cancelled") {
      const err = new Error(
        `Cannot update game details because its status is '${game.status}'.`
      );
      err.statusCode = 400;
      return next(err);
    }
    Object.keys(updates).forEach((key) => {
      if (key === "odds" && typeof updates.odds === "object" && game.odds) {
        game.odds = { ...game.odds, ...updates.odds };
      } else if (key !== "_id" && updates[key] !== undefined) {
        game[key] = updates[key];
      }
    });
    await game.save();
    res.json({ msg: "Game updated successfully.", game });
  } catch (error) {
    next(error);
  }
};

exports.cancelGame = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { id } = req.params;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const game = await Game.findById(id).session(session);
    if (!game) throw new Error("Game not found.");
    if (game.status === "finished" && game.result)
      throw new Error(
        "Cannot cancel a game that has already finished and has a result."
      );
    if (game.status === "cancelled")
      throw new Error("Game is already cancelled.");
    game.status = "cancelled";
    game.result = null;
    await game.save({ session });
    const betsToRefund = await Bet.find({ game: game._id, status: "pending" })
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
          description: `Refund for cancelled game: ${game.homeTeam} vs ${game.awayTeam}`,
        }).save({ session });
      }
      bet.status = "cancelled";
      await bet.save({ session });
    }
    await session.commitTransaction();
    res.json({
      msg: `Game ${game.homeTeam} vs ${game.awayTeam} cancelled. ${betsToRefund.length} pending bets refunded.`,
      game,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

exports.getPersonalizedGames = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).lean();
    let filter = { status: "upcoming" };
    if (user.favoriteLeagues && user.favoriteLeagues.length > 0) {
      filter.league = { $in: user.favoriteLeagues };
    } else {
      filter.league = "English Premier League";
    }
    const games = await Game.find(filter).sort({ matchDate: 1 }).limit(20);
    res.json({ message: "Your personalized game feed.", games });
  } catch (error) {
    next(error);
  }
};

exports.getGameSuggestions = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).lean();
    const userBets = await Bet.find({ user: req.user._id })
      .select("game")
      .lean();

    const betOnGameIds = userBets
      .filter((bet) => bet.game)
      .map((bet) => bet.game.toString());

    let suggestedGames = [];
    const filter = { status: "upcoming", _id: { $nin: betOnGameIds } };
    if (user.favoriteLeagues && user.favoriteLeagues.length > 0) {
      filter.league = { $in: user.favoriteLeagues };
      suggestedGames = await Game.find(filter).sort({ matchDate: 1 }).limit(5);
    }
    if (suggestedGames.length === 0) {
      delete filter.league;
      suggestedGames = await Game.find(filter).sort({ matchDate: 1 }).limit(5);
    }
    res.json({
      message: "Here are some game suggestions for you.",
      suggestions: suggestedGames,
    });
  } catch (error) {
    next(error);
  }
};

exports.getGameOddsHistory = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const game = await Game.findById(req.params.id)
      .select("homeTeam awayTeam odds oddsHistory")
      .lean();
    if (!game) {
      const err = new Error("Game not found.");
      err.statusCode = 404;
      return next(err);
    }
    res.json({ message: "Successfully fetched odds history.", game });
  } catch (error) {
    next(error);
  }
};
