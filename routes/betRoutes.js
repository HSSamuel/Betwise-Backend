const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/authMiddleware");
const {
  handleValidationErrors,
} = require("../middleware/validationMiddleware");

const {
  validatePlaceBet,
  placeBet,
  validatePlaceMultiBet,
  placeMultiBet,
  validateGetUserBets,
  getUserBets,
  validateGetBetById,
  getBetById,
  validatePlaceMultipleSingles,
  placeMultipleSingles,
  validateCashOut,
  cashOutBet,
  validateShareSlip,
  createSharedSlip,
  getSharedSlip,
} = require("../controllers/betController");

router.post(
  "/single",
  auth,
  validatePlaceBet,
  handleValidationErrors,
  placeBet
);
router.post(
  "/singles",
  auth,
  validatePlaceMultipleSingles,
  handleValidationErrors,
  placeMultipleSingles
);
router.post(
  "/multi",
  auth,
  validatePlaceMultiBet,
  handleValidationErrors,
  placeMultiBet
);
router.get("/", auth, validateGetUserBets, handleValidationErrors, getUserBets);
router.get(
  "/:id",
  auth,
  validateGetBetById,
  handleValidationErrors,
  getBetById
);
router.post(
  "/:betId/cash-out",
  auth,
  validateCashOut,
  handleValidationErrors,
  cashOutBet
);
router.post(
  "/share",
  auth,
  validateShareSlip,
  handleValidationErrors,
  createSharedSlip
);
router.get("/share/:shareId", getSharedSlip);

module.exports = router;
