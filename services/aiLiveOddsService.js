const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../config/env");
const { extractJson } = require("../utils/jsonExtractor");

if (!config.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not defined in the .env file.");
}
const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * Generates live betting odds based on the current state of a game.
 * @param {object} game - The game object from the database.
 * @returns {Promise<object|null>} A new odds object or null if generation fails.
 */
async function generateLiveOdds(game) {
  if (!game) return null;

  const gameState = {
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    score: `${game.scores.home} - ${game.scores.away}`,
    timeElapsed: `${game.elapsedTime}'`,
    preGameOdds:
      game.oddsHistory.length > 0 ? game.oddsHistory[0].odds : game.odds,
  };

  const prompt = `
    You are a professional sports bookmaker responsible for setting live, in-play betting odds.
    Analyze the following game state and return a new set of odds.

    Game State:
    - Match: ${gameState.homeTeam} vs ${gameState.awayTeam}
    - Current Score: ${gameState.score}
    - Time Elapsed: ${gameState.timeElapsed}
    - Pre-Game Odds: Home: ${gameState.preGameOdds.home}, Draw: ${gameState.preGameOdds.draw}, Away: ${gameState.preGameOdds.away}

    Instructions:
    1.  If a team is winning, significantly decrease their odds to win and increase the opponent's odds.
    2.  The odds for a draw should increase as the game progresses, especially if the score is level.
    3.  As the game nears full time (90 minutes), the odds for the currently winning team should get very low, and the odds for the losing team should get very high.
    4.  Return your response as a JSON object with three keys: "home", "away", and "draw". Example: { "home": 1.5, "away": 4.0, "draw": 3.2 }.
    5.  Return ONLY the raw JSON object. Do not include any extra text or markdown.
  `;

  try {
    const result = await model.generateContent(prompt);
    const rawText = result.response.text();
    const newOdds = extractJson(rawText);

    if (newOdds && newOdds.home && newOdds.away && newOdds.draw) {
      return {
        home: parseFloat(newOdds.home.toFixed(2)),
        away: parseFloat(newOdds.away.toFixed(2)),
        draw: parseFloat(newOdds.draw.toFixed(2)),
      };
    }
    return null; // Return null if AI response is not valid
  } catch (error) {
    console.error("Error generating live odds:", error);
    return null; // Return null on error
  }
}

module.exports = { generateLiveOdds };
