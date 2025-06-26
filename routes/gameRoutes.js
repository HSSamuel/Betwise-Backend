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
router.get(
  "/:id/odds-history",
  validateGameId,
  handleValidationErrors,
  getGameOddsHistory
);
router.get("/:id", validateGameId, handleValidationErrors, getGameById);

// --- Authenticated User Routes ---
router.get("/feed", auth, getPersonalizedGames);
router.get("/suggestions", auth, getGameSuggestions);

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
router.patch(
  "/:id/adjust-odds",
  auth,
  isAdmin,
  validateAdjustOdds,
  handleValidationErrors,
  adjustOdds
);

module.exports = router;
