// In: Bet/Backend/models/AviatorGame.js

const mongoose = require("mongoose");

const aviatorGameSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["waiting", "running", "crashed"],
      default: "waiting",
    },
    // The multiplier at which the game crashed.
    crashMultiplier: {
      type: Number,
      default: 1.0,
    },
    // The public hash shown to players before the round starts for fairness verification.
    publicHash: {
      type: String,
      required: true,
      index: true,
    },
    // The secret server seed used to determine the crash point. Revealed after the game.
    serverSeed: {
      type: String,
      required: true,
    },
    // A random public value combined with the seed. Revealed before the game.
    salt: {
      type: String,
      required: true,
    },
    // Timestamps for the game round's lifecycle.
    startedAt: { type: Date },
    crashedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AviatorGame", aviatorGameSchema);
