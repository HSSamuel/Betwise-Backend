const mongoose = require("mongoose");

// This sub-schema will be embedded and doesn't need its own model
const MiniSelectionSchema = new mongoose.Schema(
  {
    gameId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Game",
      required: true,
    },
    outcome: {
      type: String,
      enum: ["A", "B", "Draw"],
      required: true,
    },
  },
  { _id: false }
);

const SharedSlipSchema = new mongoose.Schema(
  {
    // A unique, short, random ID for the URL
    shareId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // The user who shared the slip
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // An array of the selections from the bet slip
    selections: [MiniSelectionSchema],
    // The type of bet that was shared
    betType: {
      type: String,
      enum: ["single", "multi"],
      required: true,
    },
    // Optional: Set an expiry for the link
    expiresAt: {
      type: Date,
      // Link will auto-delete from DB after 7 days
      index: { expires: "7d" },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SharedSlip", SharedSlipSchema);
