const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/authMiddleware");
const {
  handleValidationErrors,
} = require("../middleware/validationMiddleware");

// CORRECTED: Imports now include the Flutterwave deposit functions and remove the old topUpWallet
const {
  getWallet,
  getTransactionHistory,
  getWalletSummary,
  requestWithdrawal,
  initializeDeposit,
  handleFlutterwaveWebhook,
  validateInitializeDeposit,
  validateGetTransactionHistory,
  validateRequestWithdrawal,
} = require("../controllers/walletController");

// --- GET Routes for wallet info ---
router.get("/", auth, getWallet);
router.get("/summary", auth, getWalletSummary);
router.get(
  "/transactions",
  auth,
  validateGetTransactionHistory,
  handleValidationErrors,
  getTransactionHistory
);

// --- POST Routes for Payments & Withdrawals ---

// @route   POST /wallet/deposit/initialize
// @desc    User initiates a deposit to get a Flutterwave payment link
// @access  Private (Authenticated User)
router.post(
  "/deposit/initialize",
  auth,
  validateInitializeDeposit,
  handleValidationErrors,
  initializeDeposit
);

// @route   POST /wallet/deposit/webhook
// @desc    Webhook endpoint for Flutterwave to send payment confirmations
// @access  Public (but verified with a secret hash)
router.post("/deposit/webhook", handleFlutterwaveWebhook);

// @route   POST /wallet/request-withdrawal
// @desc    User requests a withdrawal of funds
// @access  Private (Authenticated User)
router.post(
  "/request-withdrawal",
  auth,
  validateRequestWithdrawal,
  handleValidationErrors,
  requestWithdrawal
);

module.exports = router;
// This router handles all wallet-related routes, including deposits and withdrawals.
