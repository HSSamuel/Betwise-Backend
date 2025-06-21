// In: Bet/Backend/models/AviatorBet.js

const mongoose = require("mongoose");

const aviatorBetSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    game: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AviatorGame",
      required: true,
      index: true,
    },
    stake: {
      type: Number,
      required: true,
      min: [0.01, "Stake must be a positive amount"],
    },
    status: {
      type: String,
      enum: ["pending", "won", "lost"],
      default: "pending",
    },
    // The multiplier at which the user cashed out. Null if they did not cash out in time.
    cashOutAt: {
      type: Number,
      default: null,
    },
    payout: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AviatorBet", aviatorBetSchema);
