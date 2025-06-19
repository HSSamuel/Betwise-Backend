const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/authMiddleware");
const aiController = require("../controllers/aiController");
const {
  handleValidationErrors,
} = require("../middleware/validationMiddleware");

// @route   POST /api/ai/chat
// @desc    Handles chat requests to the AI model
// @access  Private (Authenticated User)
router.post("/chat", auth, aiController.handleChat);

// @route   POST /api/ai/parse-bet-intent
// @desc    Parses a user's natural language text to determine their betting intent
// @access  Private (Authenticated User)
router.post("/parse-bet-intent", auth, aiController.parseBetIntent);

// @route   POST /api/ai/analyze-game
// @desc    Provides a brief AI-powered analysis of an upcoming game
// @access  Private (Authenticated User)
router.post(
  "/analyze-game",
  auth,
  aiController.validateAnalyzeGame,
  aiController.analyzeGame
);

// @route   GET /api/ai/my-betting-feedback
// @desc    Provides personalized, non-judgmental feedback on recent betting patterns
// @access  Private (Authenticated User)
router.get("/my-betting-feedback", auth, aiController.getBettingFeedback);

// @route   GET /api/ai/limit-suggestion
// @desc    Get an AI-powered suggestion for weekly betting limits
// @access  Private (Authenticated User)
router.get("/limit-suggestion", auth, aiController.generateLimitSuggestion);

// --- ADD THIS NEW ROUTE ---
// @route   POST /api/ai/game-search
// @desc    Uses AI to search for games based on a natural language query
// @access  Private (Authenticated User)
router.post("/game-search", auth, aiController.searchGamesWithAI);

// --- ADD THIS NEW ROUTE AND VALIDATION ---
// @route   POST /api/ai/news-summary
// @desc    Gets a summary of recent news for a team or player
// @access  Private (Authenticated User)
router.post(
  "/news-summary",
  auth,
  aiController.validateNewsQuery,
  aiController.getNewsSummary
);

// --- ADD THE NEW RECOMMENDATIONS ROUTE ---
// @route   GET /api/ai/recommendations
// @desc    Gets personalized game recommendations for the logged-in user
// @access  Private (Authenticated User)
router.get("/recommendations", auth, aiController.getRecommendedGames);

// 2. ADD THE NEW ROUTE FOR GENERAL SPORTS NEWS
// @route   GET /api/ai/world-sports-news
// @desc    Gets general top sports news headlines
// @access  Private (Authenticated User)
router.get("/world-sports-news", auth, aiController.getGeneralSportsNews);

// @route   POST /api/ai/analyze-game
// ...
router.post(
  "/analyze-game",
  auth,
  aiController.validateAnalyzeGame,
  handleValidationErrors, // <-- USE MIDDLEWARE
  aiController.analyzeGame
);

// @route   POST /api/ai/news-summary
// ...
router.post(
  "/news-summary",
  auth,
  aiController.validateNewsQuery,
  handleValidationErrors, // <-- USE MIDDLEWARE
  aiController.getNewsSummary
);

module.exports = router;
