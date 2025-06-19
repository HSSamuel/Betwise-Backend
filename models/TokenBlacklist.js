// In: models/TokenBlacklist.js

const mongoose = require("mongoose");

const tokenBlacklistSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true, // Each token can only be blacklisted once
  },
  // This field will automatically expire and delete the document from MongoDB
  // which is perfect for cleaning up expired tokens from our blacklist.
  expiresAt: {
    type: Date,
    required: true,
    // Create a TTL (Time-To-Live) index. MongoDB will auto-delete documents
    // when the 'expiresAt' time is reached.
    index: { expires: "1s" },
  },
});

module.exports = mongoose.model("TokenBlacklist", tokenBlacklistSchema);
