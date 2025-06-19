// In: models/TeamRanking.js

const mongoose = require("mongoose");

const teamRankingSchema = new mongoose.Schema({
  teamName: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  teamName_lower: {
    // For case-insensitive searching
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  ranking: {
    type: Number,
    required: true,
    default: 75,
  },
});

// Index for efficient searching
teamRankingSchema.index({ teamName_lower: 1 });

module.exports = mongoose.model("TeamRanking", teamRankingSchema);
