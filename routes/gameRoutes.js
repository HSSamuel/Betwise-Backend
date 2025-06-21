// In: Bet/Backend/routes/gameRoutes.js

const express = require("express");
const router = express.Router();
const { auth, isAdmin } = require("../middleware/authMiddleware");
const {
  handleValidationErrors,
} = require("../middleware/validationMiddleware");
const {
  validateGetGames,
  getGames,
  getPersonalizedGames,
  getGameSuggestions,
  validateCreateGame,
  createGame,
  validateCreateMultipleGames,
  createMultipleGames,
  validateGameId,
  getGameOddsHistory,
  getGameById,
  validateSetResult,
  setResult,
  validateUpdateGame,
  updateGame,
  cancelGame,
  validateAdjustOdds,
  getLiveGames,
  adjustOdds,
} = require("../controllers/gameController");

// --- Public Routes ---
router.get("/", validateGetGames, handleValidationErrors, getGames);
router.get("/live", getLiveGames); 
router.get("/feed", auth, getPersonalizedGames);
router.get("/suggestions", auth, getGameSuggestions);
router.get(
  "/:id/odds-history",
  validateGameId,
  handleValidationErrors,
  getGameOddsHistory
);
router.get("/:id", validateGameId, handleValidationErrors, getGameById);

// --- Admin-Only Routes ---
router.post(
  "/",
  auth,
  isAdmin,
  validateCreateGame,
  handleValidationErrors,
  createGame
);
router.post(
  "/bulk",
  auth,
  isAdmin,
  validateCreateMultipleGames,
  handleValidationErrors,
  createMultipleGames
);
router.patch(
  "/:id/result",
  auth,
  isAdmin,
  validateSetResult,
  handleValidationErrors,
  setResult
);
router.put(
  "/:id",
  auth,
  isAdmin,
  validateUpdateGame,
  handleValidationErrors,
  updateGame
);
router.patch(
  "/:id/cancel",
  auth,
  isAdmin,
  validateGameId,
  handleValidationErrors,
  cancelGame
);

// NEW: Route for manually adjusting odds
router.patch(
  "/:id/adjust-odds",
  auth,
  isAdmin,
  validateAdjustOdds,
  handleValidationErrors,
  adjustOdds
);

// --- Public Routes ---
router.get("/", validateGetGames, handleValidationErrors, getGames);
router.get("/live", getLiveGames); // <-- ADD THIS NEW ROUTE
router.get("/feed", auth, getPersonalizedGames);

module.exports = router;
