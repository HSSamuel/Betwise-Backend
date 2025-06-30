const mongoose = require("mongoose");

// This new sub-schema will represent a single pick within a multi-bet.
const selectionSchema = new mongoose.Schema(
  {
    game: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Game",
      required: true,
    },
    outcome: {
      // The user's predicted outcome for this specific game
      type: String,
      enum: ["A", "B", "Draw"],
      required: true,
    },
    odds: {
      // The odds for this specific selection at the time of the bet
      type: Number,
      required: true,
      min: 1,
    },
  },
  { _id: false }
);

const BetSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    betType: {
      type: String,
      enum: ["single", "multi"],
      required: true,
      default: "single",
    },
    stake: {
      type: Number,
      required: true,
      min: [0.01, "Stake must be a positive amount"],
    },
    totalOdds: {
      // For multi-bets, this is the product of all selection odds
      type: Number,
      required: true,
    },
    // This array will hold all the selections for a multi-bet
    selections: {
      type: [selectionSchema],
      default: [],
    },
    payout: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["pending", "won", "lost", "cancelled"],
      default: "pending",
    },
    // --- LEGACY FIELDS for single bets (optional, for backward compatibility) ---
    // We keep these so your old single bets don't break. New single bets will also use the 'selections' array.
    game: { type: mongoose.Schema.Types.ObjectId, ref: "Game" },
    outcome: { type: String, enum: ["A", "B", "Draw"] },
    oddsAtTimeOfBet: { home: Number, away: Number, draw: Number },
  },
  { timestamps: true }
);

BetSchema.index({ user: 1, status: 1 });
BetSchema.index({ status: 1, "selections.game": 1 }); // Helps find bets that include a specific game

BetSchema.statics.getRiskAnalysisForGame = function (gameId) {
  const riskPipeline = [
    {
      $match: { game: new mongoose.Types.ObjectId(gameId) },
    },
    {
      $group: {
        _id: "$outcome", // Group by the specific outcome (e.g., 'Home', 'Away', 'Draw')
        totalStake: { $sum: "$stake" },
        totalLiability: { $sum: "$potentialPayout" },
        betCount: { $sum: 1 },
      },
    },
    {
      $sort: { totalLiability: -1 }, // Sort by the highest risk
    },
  ];
  return this.aggregate(riskPipeline);
};

module.exports = mongoose.model("Bet", BetSchema);
