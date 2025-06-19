const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../config/env");
const Game = require("../models/Game");
const Bet = require("../models/Bet");
const { fetchNewsForTopic } = require("./newsService");

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * Generates a non-judgmental feedback message based on recent betting history.
 * @param {string} userId - The ID of the user.
 * @param {string} username - The username of the user.
 * @returns {Promise<string>} The AI-generated feedback.
 */
async function getBettingFeedback(userId, username) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentBets = await Bet.find({
    user: userId,
    createdAt: { $gte: sevenDaysAgo },
  });

  if (recentBets.length === 0) {
    return "You haven't placed any bets in the last 7 days. Remember to always play responsibly.";
  }

  const totalStaked = recentBets.reduce((sum, bet) => sum + bet.stake, 0);
  const betCount = recentBets.length;

  const prompt = `You are a caring and non-judgmental responsible gambling assistant. A user named ${username} has asked for feedback. Their data for the last 7 days: ${betCount} bets totaling $${totalStaked.toFixed(
    2
  )}. Based on this, provide a short, supportive message. If activity seems high (e.g., >15 bets or >$500), gently suggest considering tools like setting limits. Do not give financial advice. Focus on well-being.`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

/**
 * Generates a suggestion for weekly betting limits.
 * @param {string} userId - The ID of the user.
 * @param {string} username - The username of the user.
 * @returns {Promise<object>} An object containing the suggestion text and limit values.
 */
async function generateLimitSuggestion(userId, username) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentBets = await Bet.find({
    user: userId,
    createdAt: { $gte: thirtyDaysAgo },
  });

  if (recentBets.length < 5) {
    return {
      suggestion:
        "We need a bit more betting history to suggest personalized limits. Keep playing responsibly!",
      suggestedLimits: null,
    };
  }

  const totalStaked = recentBets.reduce((sum, bet) => sum + bet.stake, 0);
  const averageWeeklyStake = (totalStaked / 4.28).toFixed(0);
  const averageWeeklyBetCount = (recentBets.length / 4.28).toFixed(0);

  const prompt = `You are a caring responsible gambling assistant for "BetWise". A user named "${username}" has asked for a weekly limit suggestion. Their 30-day average activity is: ~${averageWeeklyBetCount} bets/week and ~$${averageWeeklyStake}/week. Generate a short, helpful message suggesting weekly limits slightly above their average. Frame it as a helpful tool for staying in control.`;

  const result = await model.generateContent(prompt);

  return {
    suggestion: result.response.text().trim(),
    suggestedLimits: {
      betCount: Math.ceil(averageWeeklyBetCount / 5) * 5 + 5,
      stakeAmount: Math.ceil((averageWeeklyStake * 1.25) / 10) * 10,
    },
  };
}

/**
 * Generates a summary of news for a given topic.
 * @param {string} topic - The team or player to get news for.
 * @returns {Promise<string>} The AI-generated summary.
 */
async function getNewsSummary(topic) {
  const newsSnippets = await fetchNewsForTopic(topic);
  if (newsSnippets.length === 0) {
    return `Sorry, I couldn't find any recent news for "${topic}".`;
  }

  const context = newsSnippets.join("\n\n");
  const prompt = `You are a sports news analyst. Based only on the following context, provide a brief, neutral, 2-4 sentence summary about "${topic}". Mention recent form, injuries, or significant transfer news if found. Do not invent information.\n\nCONTEXT:\n---\n${context}`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

module.exports = {
  getBettingFeedback,
  generateLimitSuggestion,
  getNewsSummary,
};
