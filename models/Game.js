const mongoose = require("mongoose");

// Sub-schema for odds to keep it organized
const oddsSchema = new mongoose.Schema(
  {
    home: {
      type: Number,
      required: [true, "Home odd is required."],
      min: [1, "Odds must be at least 1."],
    },
    away: {
      type: Number,
      required: [true, "Away odd is required."],
      min: [1, "Odds must be at least 1."],
    },
    draw: {
      type: Number,
      required: [true, "Draw odd is required."],
      min: [1, "Odds must be at least 1."],
    },
  },
  { _id: false }
);

// --- SUB-SCHEMA for Historical Odds ---
const oddsHistorySchema = new mongoose.Schema({
  odds: {
    type: oddsSchema,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const gameSchema = new mongoose.Schema(
  {
    homeTeam: {
      type: String,
      required: [true, "Home team name is required."],
      trim: true,
    },
    homeTeamLogo: {
      type: String,
      trim: true,
    },
    awayTeam: {
      type: String,
      required: [true, "Away team name is required."],
      trim: true,
    },
    awayTeamLogo: {
      type: String,
      trim: true,
    },
    odds: {
      type: oddsSchema,
      required: [true, "Odds (home, away, draw) are required."],
    },
    oddsHistory: {
      type: [oddsHistorySchema],
      default: [],
    },
    result: {
      type: String,
      enum: {
        values: ["A", "B", "Draw", null],
        message:
          'Game result "{VALUE}" is not supported. Must be "A", "B", "Draw", or null.',
      },
      default: null,
    },
    league: {
      type: String,
      required: [true, "League name is required."],
      trim: true,
    },
    matchDate: {
      type: Date,
      required: [true, "Match date and time are required."],
    },
    scores: {
      home: { type: Number, default: null },
      away: { type: Number, default: null },
    },
    elapsedTime: {
      type: Number,
      default: null,
    },
    status: {
      type: String,
      enum: {
        values: ["upcoming", "live", "finished", "cancelled"],
        message:
          'Game status "{VALUE}" is not supported. Must be upcoming, live, finished, or cancelled.',
      },
      default: "upcoming",
    },
    isTestGame: {
      type: Boolean,
      default: false,
    },
    summary: {
      type: String,
      trim: true,
      default: "",
    },
    externalApiId: {
      type: String,
      unique: true,
      sparse: true,
    },
    // --- Implementation: Add the soft delete flag ---
    isDeleted: {
      type: Boolean,
      default: false,
      index: true, // Index for faster queries
    },
  },
  { timestamps: true }
);

gameSchema.pre("save", function (next) {
  if (
    this.homeTeam &&
    this.awayTeam &&
    this.homeTeam.trim().toLowerCase() === this.awayTeam.trim().toLowerCase()
  ) {
    next(new Error("Home team and away team cannot be the same."));
  } else {
    next();
  }
});

// Index for faster querying of games by date and status
gameSchema.index({ matchDate: 1, status: 1 });
gameSchema.index({ status: 1, league: 1, matchDate: 1 }); // For filtering games

module.exports = mongoose.model("Game", gameSchema);
