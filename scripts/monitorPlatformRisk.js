const mongoose = require("mongoose");
const Game = require("../models/Game");
const Bet = require("../models/Bet");
const { sendEmail } = require("../services/emailService");
const config = require("../config/env"); // <-- IMPORT the new config

const RISK_THRESHOLD = config.PLATFORM_RISK_THRESHOLD; // <-- USE config
const ADMIN_EMAIL = config.ADMIN_ALERT_EMAIL; // <-- USE config

const analyzePlatformRisk = async () => {
  console.log("🤖 Starting platform risk analysis...");

  try {
    const upcomingGames = await Game.find({ status: "upcoming" });
    if (upcomingGames.length === 0) {
      return console.log("✅ No upcoming games to analyze.");
    }

    for (const game of upcomingGames) {
      const riskPipeline = [
        { $match: { game: game._id, status: "pending" } },
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
            totalPotentialPayout: { $sum: "$potentialPayout" },
          },
        },
      ];

      const riskAnalysis = await Bet.aggregate(riskPipeline);

      for (const outcome of riskAnalysis) {
        if (outcome.totalPotentialPayout > RISK_THRESHOLD) {
          console.log(
            `🚨 HIGH RISK DETECTED on game ${game._id}! Outcome: ${outcome._id}, Potential Payout: ${outcome.totalPotentialPayout}`
          );

          if (ADMIN_EMAIL) {
            await sendEmail({
              to: ADMIN_EMAIL,
              subject: `🚨 High Risk Alert on Game: ${game.homeTeam} vs ${game.awayTeam}`,
              text: `A high-risk threshold has been breached on an upcoming game.\n\nGame: ${
                game.homeTeam
              } vs ${game.awayTeam}\nLeague: ${
                game.league
              }\nMatch Date: ${new Date(game.matchDate).toLocaleString(
                "en-NG",
                { timeZone: "Africa/Lagos" }
              )}\n\nOutcome with High Exposure: "${
                outcome._id
              }" (A=Home, B=Away)\nTotal Potential Payout: $${outcome.totalPotentialPayout.toFixed(
                2
              )}\nRisk Threshold: $${RISK_THRESHOLD.toFixed(
                2
              )}\n\nPlease review the betting patterns for this game in the admin dashboard.`,
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("❌ An error occurred during risk analysis:", error);
  }
  console.log("🤖 Finished platform risk analysis.");
};

module.exports = { analyzePlatformRisk };
// If this script is run directly, connect to the database and execute the analysis
