const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/authMiddleware");
const {
  handleValidationErrors,
} = require("../middleware/validationMiddleware");

// Import all the specific validators and controllers
const {
  validatePlaceBet,
  validatePlaceMultiBet,
  placeBet,
  placeMultiBet,
  validateGetUserBets,
  getUserBets,
  validateGetBetById,
  getBetById,
  validatePlaceMultipleSingles,
  placeMultipleSingles,
} = require("../controllers/betController");

// @desc    Place a single bet
// @access  Private
router.post(
  "/single",
  auth,
  validatePlaceBet,
  handleValidationErrors,
  placeBet
);

// @desc    Place multiple single bets at once
// @access  Private
router.post(
  "/singles",
  auth,
  validatePlaceMultipleSingles,
  handleValidationErrors,
  placeMultipleSingles
);

// @desc    Place a multi-bet (accumulator)
// @access  Private
router.post(
  "/multi",
  auth,
  validatePlaceMultiBet,
  handleValidationErrors,
  placeMultiBet
);

// @desc    Get user's bets
// @access  Private
router.get("/", auth, validateGetUserBets, handleValidationErrors, getUserBets);

// @desc    Get a single bet by its ID
// @access  Private
router.get(
  "/:id",
  auth,
  validateGetBetById,
  handleValidationErrors,
  getBetById
);

module.exports = router;
