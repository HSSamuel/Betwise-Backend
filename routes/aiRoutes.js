const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/authMiddleware");
const aiController = require("../controllers/aiController");

// --- Public Route ---
// FIX: This route is now public and does not require authentication.
router.get("/world-sports-news", aiController.getGeneralSportsNews);

// --- Private, Authenticated Routes ---
router.post("/chat", auth, aiController.handleChat);
router.post("/parse-bet-intent", auth, aiController.parseBetIntent);
router.post(
  "/analyze-game",
  auth,
  aiController.validateAnalyzeGame,
  aiController.analyzeGame
);
router.get("/my-betting-feedback", auth, aiController.getBettingFeedback);
router.get("/limit-suggestion", auth, aiController.generateLimitSuggestion);
router.post("/game-search", auth, aiController.searchGamesWithAI);
router.post(
  "/news-summary",
  auth,
  aiController.validateNewsQuery,
  aiController.getNewsSummary
);
router.get("/recommendations", auth, aiController.getRecommendedGames);

module.exports = router;
