const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required for a transaction."], // Custom message
    },
    type: {
      type: String,
      enum: {
        values: [
          "bet",
          "win",
          "topup",
          "refund",
          "withdrawal",
          "admin_credit",
          "admin_debit",
        ], // <-- ADDED ADMIN TYPES
        message: 'Transaction type "{VALUE}" is not supported.',
      },
      required: [true, "Transaction type is required."],
    },
    amount: {
      type: Number,
      required: [true, "Transaction amount is required."],
    },
    balanceAfter: {
      // User's wallet balance after this transaction
      type: Number,
      required: [true, "User's balance after transaction is required."], // Custom message
    },
    bet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bet",
      default: null,
    },
    game: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Game",
      default: null,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [255, "Description cannot exceed 255 characters."], // Example: adding a maxlength
      default: "",
    },
  },
  { timestamps: true }
);

// Index for querying transactions by user and type
transactionSchema.index({ user: 1, type: 1 });
// Index for fetching user's transaction history, sorted by newest first
transactionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Transaction", transactionSchema);
