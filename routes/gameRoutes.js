const express = require("express");
const router = express.Router();
const { auth, isAdmin } = require("../middleware/authMiddleware");
const {
  handleValidationErrors,
} = require("../middleware/validationMiddleware"); // <-- IMPORT
const gameController = require("../controllers/gameController");

// GET all games (public)
router.get(
  "/",
  gameController.validateGetGames,
  handleValidationErrors,
  gameController.getGames
);

// GET personalized feed for a logged-in user
router.get("/feed", auth, gameController.getPersonalizedGames); // No validation here

// GET game suggestions for a logged-in user
router.get("/suggestions", auth, gameController.getGameSuggestions); // No validation here

// POST to create a single game (admin only)
router.post(
  "/",
  auth,
  isAdmin,
  gameController.validateCreateGame,
  handleValidationErrors,
  gameController.createGame
);

// POST to create multiple games at once (admin only)
router.post(
  "/bulk",
  auth,
  isAdmin,
  gameController.validateCreateMultipleGames,
  handleValidationErrors,
  gameController.createMultipleGames
);

// GET odds history for a specific game (public)
router.get(
  "/:id/odds-history",
  gameController.validateGameId,
  handleValidationErrors,
  gameController.getGameOddsHistory
);

// GET a single game by its ID (public)
router.get(
  "/:id",
  gameController.validateGameId,
  handleValidationErrors,
  gameController.getGameById
);

// PATCH to set a game's result (admin only)
router.patch(
  "/:id/result",
  auth,
  isAdmin,
  gameController.validateSetResult,
  handleValidationErrors,
  gameController.setResult
);

// PUT to update a game's details (admin only)
router.put(
  "/:id",
  auth,
  isAdmin,
  gameController.validateUpdateGame,
  handleValidationErrors,
  gameController.updateGame
);

// PATCH to cancel a game (admin only)
router.patch(
  "/:id/cancel",
  auth,
  isAdmin,
  gameController.validateGameId,
  handleValidationErrors,
  gameController.cancelGame
);

module.exports = router;
// This code defines the routes for managing games in a betting application, including public access to game listings and personalized feeds for logged-in users, as well as administrative functions for creating, updating, and managing game results. It uses middleware for authentication and validation of requests.
