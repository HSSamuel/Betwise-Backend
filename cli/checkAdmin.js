const mongoose = require("mongoose");
const User = require("../models/User");
const config = require("../config/env"); // <-- IMPORT the new config

const dbUri = config.MONGODB_URI; // <-- USE config

if (!dbUri) {
  console.error("❌ Error: MONGODB_URI is not defined in your .env file.");
  process.exit(1);
}

const inputUsername = process.argv[2];

if (!inputUsername) {
  console.error(
    "❗ Please provide a username as an argument (e.g., node cli/checkAdmin.js <username>)"
  );
  process.exit(1);
}

console.log(`ℹ️ Checking admin status for user: "${inputUsername}"`);
console.log("⏳ Connecting to MongoDB...");

mongoose
  .connect(dbUri)
  .then(async () => {
    console.log("✅ MongoDB connected successfully.");

    // Convert input username to lowercase for case-insensitive comparison,
    // assuming usernames are stored in lowercase.
    const usernameToQuery = inputUsername.toLowerCase();
    const user = await User.findOne({ username: usernameToQuery });

    if (!user) {
      console.log(
        `ℹ️ User "${inputUsername}" (queried as "${usernameToQuery}") not found.`
      );
    } else {
      if (user.role === "admin") {
        console.log(`✅ User "${user.username}" is an admin.`);
      } else {
        console.log(
          `ℹ️ User "${user.username}" is NOT an admin (role: ${user.role}).`
        );
      }
    }
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1); // Exit if connection fails
  })
  .finally(async () => {
    // Ensure the connection is closed in all cases (success or user not found after connection)
    // Note: If connect fails, this .finally() might not be reached if process.exit() is called in .catch()
    // However, if .then() completes, we want to close.
    // Adding a check to see if connection is open before closing.
    if (mongoose.connection.readyState === 1) {
      // 1 for connected
      await mongoose.connection.close();
      console.log("ℹ️ MongoDB connection closed.");
    }
    // It's generally good practice for scripts to explicitly exit.
    // process.exit(0) for success, process.exit(1) for failure (already handled in .catch and for arg errors).
    // If no errors occurred up to this point, we can assume success if not already exited.
    // However, the process will exit naturally when event loop is empty.
    // For clarity, an explicit exit can be added if specific exit codes are desired for different outcomes.
    // For this script, exiting within .then/.catch is sufficient.
  });
