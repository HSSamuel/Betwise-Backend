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
    unique: true, // This option implicitly creates the necessary index.
    lowercase: true,
  },
  ranking: {
    type: Number,
    required: true,
    default: 75,
  },
});

module.exports = mongoose.model("TeamRanking", teamRankingSchema);
