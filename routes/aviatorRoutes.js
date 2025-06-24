// In: Bet/Backend/routes/aviatorRoutes.js

const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/authMiddleware");
const {
  handleValidationErrors,
} = require("../middleware/validationMiddleware");
const {
  validatePlaceBet,
  placeBet,
  cashOut,
  getGameState,
} = require("../controllers/aviatorController");

// @route   POST /api/v1/aviator/place-bet
// @desc    Place a bet on the current Aviator round
// @access  Private
router.post(
  "/place-bet",
  auth,
  validatePlaceBet,
  handleValidationErrors,
  placeBet
);

// @route   POST /api/v1/aviator/cash-out
// @desc    Cash out the user's current running bet
// @access  Private
router.post("/cash-out", auth, cashOut);

// @route   GET /api/v1/aviator/state
// @desc    Get the current state of the Aviator game
// @access  Public
router.get("/state", getGameState);

module.exports = router;
