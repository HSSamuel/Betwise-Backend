const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/authMiddleware");
const aiController = require("../controllers/aiController");
const {
  handleValidationErrors,
} = require("../middleware/validationMiddleware");

// Public Route
router.get("/world-sports-news", aiController.getGeneralSportsNews);

// Private, Authenticated Routes
router.post("/chat", auth, aiController.handleChat);
router.post("/parse-bet-intent", auth, aiController.parseBetIntent);
router.post(
  "/analyze-game",
  auth,
  aiController.validateAnalyzeGame,
  handleValidationErrors,
  aiController.analyzeGame
);
router.get("/my-betting-feedback", auth, aiController.getBettingFeedback);
router.get("/limit-suggestion", auth, aiController.generateLimitSuggestion);
router.post("/game-search", auth, aiController.searchGamesWithAI);
router.post(
  "/news-summary",
  auth,
  aiController.validateNewsQuery,
  handleValidationErrors,
  aiController.getNewsSummary
);
router.get("/recommendations", auth, aiController.getRecommendedGames);

module.exports = router;
