const mongoose = require("mongoose");
const axios = require("axios");
const Game = require("../models/Game");
const Bet = require("../models/Bet");
const { generateOddsForGame } = require("../services/oddsService");
const config = require("../config/env"); // <-- IMPORT the new config

/**
 * Fetches a summary of recent news for a given topic using Google Search API.
 * @param {string} topic - The search topic (e.g., a team name).
 * @returns {Promise<string|null>} A string containing the news summary, or null.
 */
const getNewsSummaryForTeam = async (topic) => {
  try {
    const apiKey = config.GOOGLE_API_KEY; // <-- USE config
    const cseId = config.GOOGLE_CSE_ID; // <-- USE config
    if (!apiKey || !cseId) {
      console.warn(
        "Google Search API keys not configured. Skipping news analysis."
      );
      return null;
    }
    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(
      topic + " football news"
    )}`;
    const searchResponse = await axios.get(searchUrl);
    if (!searchResponse.data.items || searchResponse.data.items.length === 0) {
      return null;
    }
    return searchResponse.data.items.map((item) => item.snippet).join(" \n ");
  } catch (error) {
    console.error(`Error fetching news for ${topic}:`, error.message);
    return null;
  }
};

/**
 * Calculates the financial risk/liability for a specific game.
 * @param {string} gameId - The MongoDB ObjectId of the game.
 * @returns {Promise<object|null>} An object representing the risk analysis.
 */
const getRiskAnalysisForGame = async (gameId) => {
  try {
    const riskPipeline = [
      { $match: { game: new mongoose.Types.ObjectId(gameId) } },
      {
        $group: {
          _id: "$outcome",
          totalPotentialPayout: { $sum: "$potentialPayout" },
        },
      },
    ];
    const riskAnalysis = await Bet.aggregate(riskPipeline);

    // Format into a more usable object
    const formattedRisk = {};
    riskAnalysis.forEach((outcome) => {
      formattedRisk[outcome._id] = {
        totalPotentialPayout: outcome.totalPotentialPayout,
      };
    });
    return formattedRisk;
  } catch (error) {
    console.error(`Error calculating risk for game ${gameId}:`, error.message);
    return null;
  }
};

/**
 * The main function to adjust odds for all upcoming games.
 */
const adjustAllUpcomingGameOdds = async () => {
  console.log("🤖 Starting dynamic odds adjustment script...");
  const dbUri = config.MONGODB_URI; // <-- USE config
  if (!dbUri) {
    console.error("❌ Error: MONGODB_URI is not defined.");
    process.exit(1);
  }

  await mongoose.connect(dbUri);
  console.log("✅ MongoDB connected for odds adjustment.");

  try {
    const upcomingGames = await Game.find({ status: "upcoming" });
    console.log(`ℹ️ Found ${upcomingGames.length} upcoming games to analyze.`);

    for (const game of upcomingGames) {
      console.log(
        `--- Adjusting odds for: ${game.homeTeam} vs ${game.awayTeam} ---`
      );

      // 1. Get financial risk
      const riskAnalysis = await getRiskAnalysisForGame(game._id);

      // 2. Get latest news for both teams
      const homeNews = await getNewsSummaryForTeam(game.homeTeam);
      const awayNews = await getNewsSummaryForTeam(game.awayTeam);
      const combinedNews = [homeNews, awayNews].filter(Boolean).join("\n\n");

      // 3. Call the enhanced odds service with all available data
      const newOdds = await generateOddsForGame(game.homeTeam, game.awayTeam, {
        riskAnalysis: riskAnalysis,
        newsSummary: combinedNews,
      });

      // 4. Check if odds have changed and update the database if they have
      if (
        newOdds.home !== game.odds.home ||
        newOdds.away !== game.odds.away ||
        newOdds.draw !== game.odds.draw
      ) {
        console.log(`   - Odds have changed! Updating database...`);
        console.log(
          `   - Old Odds: H ${game.odds.home}, D ${game.odds.draw}, A ${game.odds.away}`
        );
        console.log(
          `   - New Odds: H ${newOdds.home}, D ${newOdds.draw}, A ${newOdds.away}`
        );

        // Archive the current odds before updating
        game.oddsHistory.push({ odds: game.odds, timestamp: new Date() });
        game.odds = newOdds;
        await game.save();
        console.log(`   - ✅ Successfully updated odds for game ${game._id}`);
      } else {
        console.log(`   - Odds remain stable. No update needed.`);
      }
    }
  } catch (error) {
    console.error(
      "❌ An error occurred during the odds adjustment process:",
      error
    );
  } finally {
    await mongoose.disconnect();
    console.log("ℹ️ MongoDB disconnected.");
  }
  console.log("🤖 Finished dynamic odds adjustment script.");
};

adjustAllUpcomingGameOdds();
