const Bet = require("../models/Bet");
const Game = require("../models/Game");
const mongoose = require("mongoose");

/**
 * Analyzes a user's betting history to generate personalized game recommendations.
 * @param {string} userId - The ID of the user to generate recommendations for.
 * @returns {Promise<Array>} A promise that resolves to an array of recommended game objects.
 */
const generateRecommendations = async (userId) => {
  // 1. Fetch all bets for the user to build a preference profile
  const userBets = await Bet.find({ user: userId })
    .populate("selections.game", "league homeTeam awayTeam")
    .lean();

  if (userBets.length < 3) {
    // Not enough data for meaningful recommendations
    return [];
  }

  const preferences = {
    leagues: {},
    teams: {},
  };

  // 2. Analyze bets to quantify preferences
  userBets.forEach((bet) => {
    bet.selections.forEach((selection) => {
      if (selection.game) {
        const { league, homeTeam, awayTeam } = selection.game;
        preferences.leagues[league] = (preferences.leagues[league] || 0) + 1;
        preferences.teams[homeTeam] = (preferences.teams[homeTeam] || 0) + 1;
        preferences.teams[awayTeam] = (preferences.teams[awayTeam] || 0) + 1;
      }
    });
  });

  // 3. Determine the user's top preferences
  const topLeagues = Object.entries(preferences.leagues)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map((entry) => entry[0]);

  const topTeams = Object.entries(preferences.teams)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map((entry) => entry[0]);

  if (topLeagues.length === 0 && topTeams.length === 0) {
    return [];
  }

  // FIX: Make the logic for excluding games more robust and safe.
  // This prevents crashes if a bet is missing a valid game reference.
  const betOnGameIds = userBets
    .flatMap((bet) => bet.selections) // Get all selections from all bets
    .filter((selection) => selection && selection.game && selection.game._id) // Ensure selection and game exist
    .map((selection) => selection.game._id); // Get the ID

  const teamRegex = topTeams.map((team) => new RegExp(team, "i"));

  const filter = {
    status: "upcoming",
    $or: [
      { league: { $in: topLeagues } },
      { homeTeam: { $in: teamRegex } },
      { awayTeam: { $in: teamRegex } },
    ],
    _id: { $nin: betOnGameIds }, // Exclude games the user has already bet on
  };

  const recommendedGames = await Game.find(filter)
    .sort({ matchDate: 1 })
    .limit(10)
    .lean();

  return recommendedGames;
};

module.exports = { generateRecommendations };
