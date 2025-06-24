const Bet = require("../models/Bet");
const User = require("../models/User");
const mongoose = require("mongoose");

// Helper to get date range
const getDateRange = (period) => {
  const end = new Date();
  const start = new Date();
  if (period === "weekly") {
    start.setDate(end.getDate() - 7);
  } else if (period === "monthly") {
    start.setMonth(end.getMonth() - 1);
  } else {
    return {}; // All-time
  }
  return { createdAt: { $gte: start, $lte: end } };
};

// Get leaderboard for top net winners
exports.getTopWinners = async (req, res, next) => {
  try {
    const timePeriod = req.query.period || "all-time";
    const dateFilter = getDateRange(timePeriod);

    const winners = await Bet.aggregate([
      { $match: { status: "won", ...dateFilter } },
      { $group: { _id: "$user", totalWon: { $sum: "$payout" } } },
      {
        $lookup: {
          from: "bets",
          localField: "_id",
          foreignField: "user",
          as: "allBets",
        },
      },
      { $unwind: "$allBets" },
      { $match: { "allBets.status": { $in: ["won", "lost"] } } },
      {
        $group: {
          _id: "$_id",
          totalWon: { $first: "$totalWon" },
          totalStaked: { $sum: "$allBets.stake" },
        },
      },
      { $project: { netProfit: { $subtract: ["$totalWon", "$totalStaked"] } } },
      { $sort: { netProfit: -1 } },
      { $limit: 20 },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userDetails",
        },
      },
      { $unwind: "$userDetails" },
      { $project: { "userDetails.username": 1, netProfit: 1, _id: 0 } },
    ]);

    res.status(200).json({ leaderboard: winners });
  } catch (error) {
    next(error);
  }
};

// Get leaderboard for highest odds wins
exports.getHighestOdds = async (req, res, next) => {
  try {
    const topOdds = await Bet.find({ status: "won" })
      .sort({ totalOdds: -1 })
      .limit(20)
      .populate("user", "username");

    const leaderboard = topOdds.map((bet) => ({
      username: bet.user.username,
      odds: bet.totalOdds,
    }));

    res.status(200).json({ leaderboard });
  } catch (error) {
    next(error);
  }
};
