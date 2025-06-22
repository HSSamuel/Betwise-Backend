const User = require("../models/User");
const Bet = require("../models/Bet");
const Game = require("../models/Game");
const Transaction = require("../models/Transaction");
const Withdrawal = require("../models/Withdrawal");
const { query, body, param, validationResult } = require("express-validator");
const mongoose = require("mongoose");
const { syncGames } = require("../services/sportsDataService");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../config/env"); // <-- IMPORT the new config

// Initialize Gemini AI
if (!config.GEMINI_API_KEY) {
  // <-- USE config
  throw new Error("GEMINI_API_KEY is not defined in the .env file.");
}
const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY); // <-- USE config

// Admin: Get basic platform statistics
exports.getPlatformStats = async (req, res, next) => {
  try {
    const userCount = await User.countDocuments();
    const betCount = await Bet.countDocuments();
    const gameCount = await Game.countDocuments({
      status: { $ne: "cancelled" },
    }); // Active games
    const pendingGames = await Game.countDocuments({ status: "upcoming" });
    const totalTransactions = await Transaction.countDocuments();

    res.status(200).json({
      totalUsers: userCount,
      totalBets: betCount,
      totalGames: gameCount,
      upcomingGames: pendingGames,
      totalTransactionsRecorded: totalTransactions,
    });
  } catch (err) {
    next(err);
  }
};

// Admin: Get financial dashboard
exports.getFinancialDashboard = async (req, res, next) => {
  try {
    const financialData = await Transaction.aggregate([
      {
        $match: {
          type: {
            $in: [
              "topup",
              "bet",
              "win",
              "refund",
              "withdrawal",
              "admin_credit",
              "admin_debit",
            ],
          },
        },
      },
      {
        $group: {
          _id: "$type",
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const dashboardStats = {
      totalTopUps: { amount: 0, count: 0 },
      totalStakes: { amount: 0, count: 0 },
      totalPayoutsToUsers: { amount: 0, count: 0 },
      totalRefunds: { amount: 0, count: 0 },
      platformRevenue: { amount: 0 },
    };

    financialData.forEach((transactionType) => {
      const amount = transactionType.totalAmount || 0;
      const count = transactionType.count || 0;
      switch (transactionType._id) {
        case "topup":
        case "admin_credit":
          dashboardStats.totalTopUps.amount += amount;
          dashboardStats.totalTopUps.count += count;
          break;
        case "bet":
          dashboardStats.totalStakes.amount += Math.abs(amount);
          dashboardStats.totalStakes.count += count;
          break;
        case "win":
          dashboardStats.totalPayoutsToUsers.amount += amount;
          dashboardStats.totalPayoutsToUsers.count += count;
          break;
        case "refund":
        case "withdrawal":
        case "admin_debit":
          dashboardStats.totalRefunds.amount += Math.abs(amount);
          dashboardStats.totalRefunds.count += count;
          break;
      }
    });

    dashboardStats.platformRevenue.amount =
      dashboardStats.totalStakes.amount -
      dashboardStats.totalPayoutsToUsers.amount;

    // Format all amounts to 2 decimal places
    for (const key in dashboardStats) {
      if (dashboardStats[key].hasOwnProperty("amount")) {
        dashboardStats[key].amount = parseFloat(
          dashboardStats[key].amount.toFixed(2)
        );
      }
    }

    res.status(200).json(dashboardStats);
  } catch (err) {
    next(err);
  }
};

// --- Validation rules ---
exports.validateListUsers = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer."),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be an integer between 1 and 100."),
  query("role")
    .optional()
    .isIn(["user", "admin"])
    .withMessage('Role must be either "user" or "admin".'),
  query("sortBy").optional().isString().trim().escape(),
  query("order").optional().isIn(["asc", "desc"]),
  query("search").optional().isString().trim().escape(),
  query("flagged")
    .optional()
    .isBoolean()
    .withMessage("Flagged value must be true or false.")
    .toBoolean(),
];

exports.validateAdminUserAction = [
  param("id")
    .isMongoId()
    .withMessage("A valid user ID must be provided in the URL."),
];

exports.validateAdminUpdateRole = [
  param("id")
    .isMongoId()
    .withMessage("A valid user ID must be provided in the URL."),
  body("role")
    .isIn(["user", "admin"])
    .withMessage('Role must be either "user" or "admin".'),
];

exports.validateAdminAdjustWallet = [
  param("id")
    .isMongoId()
    .withMessage("A valid user ID must be provided in the URL."),
  body("amount")
    .isFloat()
    .withMessage(
      "Amount must be a valid number (can be positive or negative)."
    ),
  body("description")
    .notEmpty()
    .trim()
    .withMessage("A description for the adjustment is required."),
];

exports.validateProcessWithdrawal = [
  param("id")
    .isMongoId()
    .withMessage("A valid withdrawal request ID must be provided in the URL."),
  body("status")
    .isIn(["approved", "rejected"])
    .withMessage('Status must be either "approved" or "rejected".'),
];

// --- Controller functions ---
exports.listUsers = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const {
      page = 1,
      limit = 10,
      role,
      sortBy = "createdAt",
      order = "desc",
      search,
      flagged,
    } = req.query;

    const filter = {};
    if (role) filter.role = role;
    if (search) {
      const searchRegex = new RegExp(search, "i");
      filter.$or = [
        { username: searchRegex },
        { email: searchRegex },
        { firstName: searchRegex },
        { lastName: searchRegex },
      ];
    }
    if (flagged !== undefined) {
      filter["flags.isFlaggedForFraud"] = flagged;
    }

    const sortOptions = { [sortBy]: order === "asc" ? 1 : -1 };

    // Perform two separate queries: one for admins, one for users
    const admins = await User.find({ ...filter, role: "admin" })
      .select("-password")
      .sort(sortOptions)
      .lean();
    const users = await User.find({ ...filter, role: "user" })
      .select("-password")
      .sort(sortOptions)
      .lean();

    // Combine the results, with admins always first
    const allUsers = [...admins, ...users];

    const totalUsers = allUsers.length;
    const paginatedUsers = allUsers.slice((page - 1) * limit, page * limit);

    res.json({
      users: paginatedUsers,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalUsers / parseInt(limit)),
      totalCount: totalUsers,
    });
  } catch (err) {
    next(err);
  }
};

exports.getAllUsersFullDetails = async (req, res, next) => {
  try {
    const allUsers = await User.find({}).lean();
    const formattedUsers = allUsers.map((userObject) => ({
      _id: userObject._id,
      role: userObject.role,
      user: userObject.username,
      email: userObject.email,
      firstName: userObject.firstName,
      lastName: userObject.lastName,
      state: userObject.state,
      createdAt: userObject.createdAt,
      updatedAt: userObject.updatedAt,
      __v: userObject.__v,
    }));
    res.status(200).json({
      msg: "Successfully fetched all user details.",
      allUser: formattedUsers,
    });
  } catch (err) {
    next(err);
  }
};

exports.adminGetUserProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) {
      const err = new Error("User not found.");
      err.statusCode = 404;
      return next(err);
    }
    res.status(200).json(user);
  } catch (err) {
    next(err);
  }
};

exports.adminUpdateUserRole = async (req, res, next) => {
  try {
    const { role } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) {
      const err = new Error("User not found.");
      err.statusCode = 404;
      return next(err);
    }
    user.role = role;
    await user.save();
    res
      .status(200)
      .json({ msg: `User ${user.username}'s role updated to ${role}.`, user });
  } catch (err) {
    next(err);
  }
};

exports.adminAdjustUserWallet = async (req, res, next) => {
  const { amount, description } = req.body;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findById(req.params.id).session(session);
    if (!user) throw new Error("User not found.");
    user.walletBalance += amount;
    if (user.walletBalance < 0)
      throw new Error("Adjustment would result in a negative wallet balance.");
    await new Transaction({
      user: user._id,
      type: amount > 0 ? "admin_credit" : "admin_debit",
      amount: amount,
      balanceAfter: user.walletBalance,
      description: description || "Admin wallet adjustment.",
    }).save({ session });
    await user.save({ session });
    await session.commitTransaction();
    res.status(200).json({
      msg: `User ${user.username}'s wallet adjusted by ${amount}. New balance: ${user.walletBalance}.`,
    });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};

exports.adminDeleteUser = async (req, res, next) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      const err = new Error("User not found.");
      err.statusCode = 404;
      return next(err);
    }
    res.status(200).json({
      msg: `User ${user.username} and their associated data have been deleted.`,
    });
  } catch (err) {
    next(err);
  }
};

exports.adminGetWithdrawals = async (req, res, next) => {
  try {
    const { status = "pending" } = req.query;
    const withdrawals = await Withdrawal.find({ status: status }).populate(
      "user",
      "username email walletBalance"
    );
    res.status(200).json(withdrawals);
  } catch (err) {
    next(err);
  }
};

exports.adminProcessWithdrawal = async (req, res, next) => {
  const { status, adminNotes } = req.body;
  const { id } = req.params;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const withdrawalRequest = await Withdrawal.findById(id)
      .populate("user")
      .session(session);
    if (!withdrawalRequest) throw new Error("Withdrawal request not found.");
    if (withdrawalRequest.status !== "pending")
      throw new Error(
        `This withdrawal request has already been ${withdrawalRequest.status}.`
      );

    withdrawalRequest.status = status;
    withdrawalRequest.adminNotes = adminNotes;
    withdrawalRequest.processedAt = new Date();

    if (status === "approved") {
      const user = withdrawalRequest.user;
      if (user.walletBalance < withdrawalRequest.amount)
        throw new Error(
          "User no longer has sufficient funds for this withdrawal."
        );
      user.walletBalance -= withdrawalRequest.amount;
      await new Transaction({
        user: user._id,
        type: "withdrawal",
        amount: -withdrawalRequest.amount,
        balanceAfter: user.walletBalance,
        description: `Withdrawal of ${withdrawalRequest.amount} approved.`,
      }).save({ session });
      await user.save({ session });
    }
    await withdrawalRequest.save({ session });
    await session.commitTransaction();
    res.status(200).json({
      msg: `Withdrawal request has been ${status}.`,
      withdrawalRequest,
    });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};

// This function has access to syncGames.
exports.manualGameSync = async (req, res, next) => {
  const { source = "apifootball" } = req.body;
  try {
    // FIX: Call the correctly named 'syncGames' function
    await syncGames(source);
    res.status(200).json({
      msg: `Synchronization from '${source}' has been successfully triggered.`,
    });
  } catch (error) {
    next(error);
  }
};

// --- FUNCTION for Platform Risk Analysis ---
exports.getGameRiskAnalysis = async (req, res, next) => {
  try {
    const { id: gameId } = req.params;

    // FIX: The risk pipeline now includes a $project stage to calculate potentialPayout
    const riskPipeline = [
      { $match: { "selections.game": new mongoose.Types.ObjectId(gameId) } },
      { $unwind: "$selections" }, // Deconstruct the selections array to process each one
      { $match: { "selections.game": new mongoose.Types.ObjectId(gameId) } }, // Match again after unwind
      {
        $project: {
          stake: 1,
          outcome: "$selections.outcome",
          odds: "$selections.odds",
          // Dynamically calculate the potential payout for each bet
          potentialPayout: { $multiply: ["$stake", "$selections.odds"] },
        },
      },
      {
        $group: {
          _id: "$outcome", // Group by the outcome (A, B, Draw)
          totalStake: { $sum: "$stake" },
          // Now we can sum the calculated potentialPayout
          totalPotentialPayout: { $sum: "$potentialPayout" },
          betCount: { $sum: 1 },
        },
      },
      { $sort: { totalPotentialPayout: -1 } },
    ];

    const riskAnalysis = await Bet.aggregate(riskPipeline);
    const game = await Game.findById(gameId).lean(); // Fetch game details

    const formattedResponse = {
      gameId,
      totalExposure: 0,
      outcomes: {
        A: { totalStake: 0, totalPotentialPayout: 0, betCount: 0 },
        B: { totalStake: 0, totalPotentialPayout: 0, betCount: 0 },
        Draw: { totalStake: 0, totalPotentialPayout: 0, betCount: 0 },
      },
      gameDetails: {
        homeTeam: game?.homeTeam,
        awayTeam: game?.awayTeam,
        league: game?.league,
      },
    };

    riskAnalysis.forEach((outcome) => {
      formattedResponse.outcomes[outcome._id] = {
        totalStake: parseFloat(outcome.totalStake.toFixed(2)),
        totalPotentialPayout: parseFloat(
          outcome.totalPotentialPayout.toFixed(2)
        ),
        betCount: outcome.betCount,
      };
    });

    formattedResponse.totalExposure = parseFloat(
      Object.values(formattedResponse.outcomes)
        .reduce((sum, outcome) => sum + outcome.totalPotentialPayout, 0)
        .toFixed(2)
    );

    res.status(200).json({
      message: "Platform risk analysis for game.",
      analysis: formattedResponse,
    });
  } catch (error) {
    // Pass the error to the centralized error handler
    next(error);
  }
};

// --- FUNCTION for AI-Powered Risk Summary ---
exports.getGameRiskSummary = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const { id: gameId } = req.params;

    // Step 1: Get the raw numerical risk analysis data.
    // We can reuse the aggregation pipeline logic.
    const riskPipeline = [
      {
        $match: {
          game: new mongoose.Types.ObjectId(gameId),
          status: "pending",
        },
      },
      {
        $project: {
          stake: 1,
          outcome: 1,
          potentialPayout: {
            $switch: {
              branches: [
                {
                  case: { $eq: ["$outcome", "A"] },
                  then: { $multiply: ["$stake", "$oddsAtTimeOfBet.home"] },
                },
                {
                  case: { $eq: ["$outcome", "B"] },
                  then: { $multiply: ["$stake", "$oddsAtTimeOfBet.away"] },
                },
                {
                  case: { $eq: ["$outcome", "Draw"] },
                  then: { $multiply: ["$stake", "$oddsAtTimeOfBet.draw"] },
                },
              ],
              default: 0,
            },
          },
        },
      },
      {
        $group: {
          _id: "$outcome",
          totalStake: { $sum: "$stake" },
          totalPotentialPayout: { $sum: "$potentialPayout" },
          betCount: { $sum: 1 },
        },
      },
    ];

    const riskAnalysis = await Bet.aggregate(riskPipeline);
    const game = await Game.findById(gameId).lean();
    if (!game) {
      return res.status(404).json({ message: "Game not found." });
    }

    // Step 2: Prepare a prompt for the AI with the data.
    const prompt = `
    You are a senior risk analyst for a sports betting company.
    Analyze the following betting data for the upcoming match: "${
      game.homeTeam
    } vs. ${
      game.awayTeam
    }" and provide a concise, 1-2 paragraph risk summary for a non-technical admin.

    Your summary should:
    - Start with a clear "Overall Risk Assessment:" (e.g., Low, Moderate, High).
    - Identify which outcome (Home Win, Away Win, Draw) has the highest financial exposure (potential payout).
    - Mention the total amount staked on that outcome and the number of bets.
    - Conclude with a clear recommendation, such as "No action needed," "Monitor closely," or "Immediate review of betting patterns is recommended."

    Here is the data:
    ${JSON.stringify(riskAnalysis, null, 2)}
  `;

    // Step 3: Call the AI model and send the response.
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const summary = result.response.text();

    res.status(200).json({
      message: "AI-powered risk summary for game.",
      summary: summary.trim(),
      rawData: riskAnalysis, // Also return the raw data for context
    });
  } catch (error) {
    next(error);
  }
};

// FIX: New controller function to get a high-level risk overview.
exports.getRiskOverview = async (req, res, next) => {
  try {
    const RISK_THRESHOLD = config.PLATFORM_RISK_THRESHOLD; // <-- USE config

    // Aggregation pipeline to calculate total potential payout per game
    const riskPipeline = [
      { $match: { status: "pending" } }, // Only consider pending bets
      {
        $group: {
          _id: "$game", // Group bets by game
          totalPotentialPayout: { $sum: "$payout" },
        },
      },
      {
        $lookup: {
          // Join with the games collection to get game details
          from: "games",
          localField: "_id",
          foreignField: "_id",
          as: "gameDetails",
        },
      },
      { $unwind: "$gameDetails" }, // Deconstruct the gameDetails array
      { $match: { "gameDetails.status": "upcoming" } }, // Ensure the game is upcoming
      { $sort: { totalPotentialPayout: -1 } }, // Sort by the highest risk
    ];

    const allGameRisks = await Bet.aggregate(riskPipeline);

    const totalExposure = allGameRisks.reduce(
      (sum, game) => sum + game.totalPotentialPayout,
      0
    );
    const highRiskGamesCount = allGameRisks.filter(
      (game) => game.totalPotentialPayout > RISK_THRESHOLD
    ).length;
    const topExposedGames = allGameRisks.slice(0, 5); // Get the top 5 riskiest games

    res.status(200).json({
      totalExposure,
      highRiskGamesCount,
      topExposedGames,
    });
  } catch (error) {
    next(error);
  }
};
