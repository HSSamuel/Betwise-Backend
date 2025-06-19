const rankings = require("./team-rankings.json");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../config/env"); // <-- IMPORT the new config

if (!config.GEMINI_API_KEY) {
  // <-- USE config
  throw new Error("GEMINI_API_KEY is not defined in the .env file.");
}
const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY); // <-- USE config

const BASE_ODDS = 5.0;
const RANKING_SENSITIVITY = 0.05;
const RISK_ADJUSTMENT_FACTOR = 0.02; // How much liability affects odds

/**
 * Interprets a news summary to determine its impact on a game's outcome.
 * @param {string} newsSummary - A summary of recent news about the teams.
 * @param {string} homeTeam - The name of the home team.
 * @param {string} awayTeam - The name of the away team.
 * @returns {Promise<object>} An object with adjustment factors, e.g., { home: 1.0, away: 1.0, draw: 1.0 }
 */
const analyzeNewsImpact = async (newsSummary, homeTeam, awayTeam) => {
  if (!newsSummary) {
    return { home: 1.0, away: 1.0, draw: 1.0 };
  }
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `
      You are a sports betting analyst. Based on the following news summary, determine the impact on the upcoming match between ${homeTeam} and ${awayTeam}.
      Return a JSON object with three keys: "home", "away", and "draw".
      - If the news is negative for a team (e.g., key player injury), its factor should be > 1.0 (e.g., 1.15 to reflect higher odds/lower chance of winning).
      - If the news is positive, its factor should be < 1.0 (e.g., 0.9).
      - If the news is neutral or doesn't affect a team/outcome, the factor should be 1.0.
      - The draw factor should typically remain 1.0 unless the news strongly suggests a stalemate (e.g., both teams missing key strikers).

      NEWS SUMMARY: "${newsSummary}"

      Return ONLY the JSON object.
    `;
    const result = await model.generateContent(prompt);
    const rawAiText = result.response.text();
    const jsonMatch = rawAiText.match(/\{[\s\S]*\}/);
    if (jsonMatch && jsonMatch[0]) {
      const impact = JSON.parse(jsonMatch[0]);
      console.log(`- AI News Impact Analysis:`, impact);
      return impact;
    }
    return { home: 1.0, away: 1.0, draw: 1.0 };
  } catch (error) {
    console.error("Error analyzing news impact:", error);
    // Return neutral factors in case of an error
    return { home: 1.0, away: 1.0, draw: 1.0 };
  }
};

/**
 * Generates dynamic betting odds for a game based on team rankings, platform risk, and real-time news.
 * @param {string} homeTeamName - The name of the home team.
 * @param {string} awayTeamName - The name of the away team.
 * @param {object} [options] - Optional parameters for dynamic adjustments.
 * @param {object} [options.riskAnalysis] - Data on financial exposure for the game.
 * @param {string} [options.newsSummary] - A summary of recent news.
 * @returns {Promise<object>} An object containing home, away, and draw odds.
 */
const generateOddsForGame = async (
  homeTeamName,
  awayTeamName,
  options = {}
) => {
  console.log(
    `- Generating dynamic odds for ${homeTeamName} vs ${awayTeamName}...`
  );
  const { riskAnalysis, newsSummary } = options;

  // 1. Base odds from team rankings
  const homeRank =
    rankings.teams[homeTeamName.toLowerCase()] || rankings.default_ranking;
  const awayRank =
    rankings.teams[awayTeamName.toLowerCase()] || rankings.default_ranking;
  const rankDifference = homeRank - awayRank;

  let homeOdds = BASE_ODDS - rankDifference * RANKING_SENSITIVITY;
  let awayOdds = BASE_ODDS + rankDifference * RANKING_SENSITIVITY;
  let drawOdds = 2.5 + Math.abs(rankDifference) * (RANKING_SENSITIVITY / 2);

  // 2. Adjust odds based on platform risk (liability)
  if (riskAnalysis) {
    const totalLiability =
      (riskAnalysis.A?.totalPotentialPayout || 0) +
      (riskAnalysis.B?.totalPotentialPayout || 0) +
      (riskAnalysis.Draw?.totalPotentialPayout || 0);

    if (totalLiability > 0) {
      const homeLiability = riskAnalysis.A?.totalPotentialPayout || 0;
      const awayLiability = riskAnalysis.B?.totalPotentialPayout || 0;
      const drawLiability = riskAnalysis.Draw?.totalPotentialPayout || 0;

      // Lower the odds for outcomes with high liability to discourage more bets on them
      homeOdds -= (homeLiability / totalLiability) * RISK_ADJUSTMENT_FACTOR;
      awayOdds -= (awayLiability / totalLiability) * RISK_ADJUSTMENT_FACTOR;
      drawOdds -= (drawLiability / totalLiability) * RISK_ADJUSTMENT_FACTOR;
    }
  }

  // 3. Adjust odds based on AI analysis of recent news
  const newsImpact = await analyzeNewsImpact(
    newsSummary,
    homeTeamName,
    awayTeamName
  );
  homeOdds *= newsImpact.home;
  awayOdds *= newsImpact.away;
  drawOdds *= newsImpact.draw;

  // 4. Final formatting and validation
  const finalOdds = {
    home: parseFloat(Math.max(1.01, homeOdds).toFixed(2)),
    away: parseFloat(Math.max(1.01, awayOdds).toFixed(2)),
    draw: parseFloat(Math.max(1.01, drawOdds).toFixed(2)),
  };

  console.log(`- Generated Dynamic Odds:`, finalOdds);
  return finalOdds;
};

module.exports = { generateOddsForGame };
