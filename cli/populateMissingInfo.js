const mongoose = require("mongoose");
const User = require("../models/User");
const config = require("../config/env"); // <-- IMPORT the new config

const dbUri = config.MONGODB_URI; // <-- USE config

if (!dbUri) {
  console.error(
    "❌ Error: MONGODB_URI is not defined. Please ensure it is set in your .env file."
  );
  process.exit(1);
}

const inputUsername = process.argv[2];
const newFirstName = process.argv[3];
const newLastName = process.argv[4];
const newEmail = process.argv[5];

const usageMessage =
  "❗ Usage: node scripts/populateMissingInfo.js <username> <newFirstName> <newLastName> <newEmail>";

if (!inputUsername || !newFirstName || !newLastName || !newEmail) {
  console.error(usageMessage);
  process.exit(1);
}

// Basic validation for new inputs
if (newFirstName.trim() === "" || newLastName.trim() === "") {
  console.error("❌ Error: First name and last name cannot be empty.");
  console.error(usageMessage);
  process.exit(1);
}
const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;
if (!emailRegex.test(newEmail)) {
  console.error("❌ Error: Invalid email format provided for the new email.");
  console.error(usageMessage);
  process.exit(1);
}

async function main() {
  try {
    console.log(`ℹ️ Attempting to populate info for user: "${inputUsername}"`);
    console.log("⏳ Connecting to MongoDB...");
    await mongoose.connect(dbUri);
    console.log("✅ MongoDB connected successfully.");

    // Convert input username to lowercase for case-insensitive comparison
    const usernameToQuery = inputUsername.toLowerCase();
    const user = await User.findOne({ username: usernameToQuery });

    if (!user) {
      console.log(
        `❌ User "${inputUsername}" (queried as "${usernameToQuery}") not found.`
      );
      return; // User not found, connection will be closed in finally
    }

    console.log(
      `Found user: ${user.username}. Current details - FirstName: ${user.firstName}, LastName: ${user.lastName}, Email: ${user.email}`
    );

    user.firstName = newFirstName;
    user.lastName = newLastName;
    user.email = newEmail.toLowerCase(); // Store email in lowercase

    // Optional: Check if new email already exists for another user
    const emailOwner = await User.findOne({ email: user.email });
    if (emailOwner && emailOwner._id.toString() !== user._id.toString()) {
      console.error(
        `❌ Error: The new email "${user.email}" is already in use by another user (${emailOwner.username}).`
      );
      return;
    }

    await user.save();
    console.log(
      `✅ User "${user.username}" updated successfully. New details - FirstName: ${user.firstName}, LastName: ${user.lastName}, Email: ${user.email}`
    );
  } catch (error) {
    console.error(`❌ Error during the update process:`, error.message);
    if (error.name === "ValidationError") {
      // Log specific validation errors from Mongoose
      for (const field in error.errors) {
        console.error(`  - ${error.errors[field].message}`);
      }
    }
    // process.exit(1) // Optionally exit if any error in main try block is considered fatal for the script.
  } finally {
    if (mongoose.connection.readyState === 1) {
      // 1 for connected
      await mongoose.connection.close();
      console.log("ℹ️ MongoDB connection closed.");
    }
  }
}

main();
