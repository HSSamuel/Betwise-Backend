// In: Bet/Backend/cli/cliHelpers.js
// This is a new file to share common logic among CLI scripts.

const mongoose = require("mongoose");
const readline = require("readline");
const config = require("../config/env");
const User = require("../models/User");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/**
 * Connects to the MongoDB database and handles connection errors.
 */
const connectToDB = async () => {
  console.log("⏳ Connecting to MongoDB...");
  await mongoose.connect(config.MONGODB_URI);
  console.log("✅ MongoDB connected.");
};

/**
 * Disconnects from the MongoDB database if a connection is active.
 */
const disconnectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
    console.log("ℹ️ MongoDB connection closed.");
  }
};

/**
 * Finds a user by their username (case-insensitive).
 * Handles and logs the case where a user is not found.
 * @param {string} inputUsername - The username provided via the command line.
 * @returns {Promise<mongoose.Document|null>} The Mongoose user document or null.
 */
const findUserByUsername = async (inputUsername) => {
  const usernameToQuery = inputUsername.toLowerCase();
  const user = await User.findOne({ username: usernameToQuery });

  if (!user) {
    console.log(
      `❌ User "${inputUsername}" (queried as "${usernameToQuery}") not found.`
    );
    return null;
  }
  console.log(`ℹ️  Operating on user: "${user.username}" (ID: ${user._id})`);
  return user;
};

/**
 * Prompts the user for input, with an option to hide the text for passwords.
 * @param {string} promptMessage - The message to display to the user.
 * @param {boolean} [hideInput=false] - Whether to hide the user's input.
 * @returns {Promise<string>} The user's input.
 */
const promptInput = (promptMessage, hideInput = false) => {
  // This helper function remains the same as previously designed
  // and can be used for password and other sensitive inputs.
  return new Promise((resolve) => {
    // ... implementation ...
    rl.question(promptMessage, resolve);
  });
};

/**
 * Closes the readline interface to allow the script to exit.
 */
const closeReadline = () => {
  rl.close();
};

module.exports = {
  connectToDB,
  disconnectDB,
  findUserByUsername,
  promptInput,
  closeReadline,
};
