const { extractJson } = require("../utils/jsonExtractor");
const aiProvider = require("./aiProviderService"); // Import the new provider service

/**
 * Generates "smart-bet" combination suggestions.
 * @param {Array} selections - The user's current bet slip selections.
 * @returns {Promise<Array>} An array of suggested additional bets.
 */
async function getCombinationSuggestions(selections) {
  if (!selections || selections.length === 0) {
    return [];
  }

  const prompt = `
    A user has the following selections in their bet slip:
    ${JSON.stringify(selections, null, 2)}

    Based on these selections, suggest 1-2 additional bets that are statistically compatible or have a strong correlation.
    For each suggestion, provide the game details, the suggested outcome, and a brief justification.
    Return the suggestions as a JSON array. Return ONLY the JSON array.
  `;

  try {
    // FIX: Use the aiProvider service instead of the direct model
    const rawText = await aiProvider.generateContent(prompt);
    const suggestions = extractJson(rawText);
    return suggestions || [];
  } catch (error) {
    console.error("Error generating combination suggestions:", error);
    return [];
  }
}

/**
 * Recommends an alternative, safer bet if the user's multi-bet is too risky.
 * @param {Array} selections - The user's current bet slip selections.
 * @param {number} totalOdds - The total odds of the multi-bet.
 * @returns {Promise<object|null>} A safer bet alternative or null.
 */
async function getAlternativeBet(selections, totalOdds) {
  // If the bet isn't very risky, don't suggest an alternative.
  if (totalOdds < 20) {
    return null;
  }

  const prompt = `
    A user has a multi-bet with the following selections and very high total odds of ${totalOdds.toFixed(
      2
    )}:
    ${JSON.stringify(selections, null, 2)}

    This is a high-risk bet. Propose a "safer" alternative with fewer selections (e.g., a double or treble from the user's slip) that still offers a good potential return.
    Return the alternative as a JSON object with the suggested selections and a brief explanation. Return ONLY the JSON object.
  `;

  try {
    // FIX: Use the aiProvider service here as well
    const rawText = await aiProvider.generateContent(prompt);
    const alternative = extractJson(rawText);
    return alternative;
  } catch (error) {
    console.error("Error generating alternative bet:", error);
    return null;
  }
}

module.exports = {
  getCombinationSuggestions,
  getAlternativeBet,
};
