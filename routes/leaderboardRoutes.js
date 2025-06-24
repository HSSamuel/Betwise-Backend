const express = require("express");
const router = express.Router();
const {
  getTopWinners,
  getHighestOdds,
} = require("../controllers/leaderboardController");

// @route   GET /api/v1/leaderboards/winners
// @desc    Get the leaderboard for top net winners
// @access  Public
router.get("/winners", getTopWinners);

// @route   GET /api/v1/leaderboards/highest-odds
// @desc    Get the leaderboard for highest odds wins
// @access  Public
router.get("/highest-odds", getHighestOdds);

module.exports = router;
