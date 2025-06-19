require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const readline = require("readline");
const User = require("../models/User");
const config = require("../config/env"); // <-- IMPORT the new config

const dbUri = config.MONGODB_URI; // <-- USE config

// --- Helper for secure password prompt ---
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const promptInput = (promptMessage, hideInput = false) => {
  return new Promise((resolve) => {
    let originalStdoutWrite;
    if (hideInput) {
      originalStdoutWrite = process.stdout.write;
      process.stdout.write = (chunk, encoding, callback) => {
        if (
          typeof chunk === "string" &&
          chunk.trim() !== promptMessage.trim()
        ) {
          originalStdoutWrite.call(process.stdout, "*", encoding, callback);
        } else {
          originalStdoutWrite.call(process.stdout, chunk, encoding, callback);
        }
      };
    }

    rl.question(promptMessage, (input) => {
      if (hideInput) {
        process.stdout.write = originalStdoutWrite;
        process.stdout.write("\n");
      }
      resolve(input);
    });
  });
};
// --- End Helper ---

async function main() {
  if (!dbUri) {
    console.error(
      "❌ Error: MONGODB_URI is not defined. Please ensure it is set in your .env file."
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const command = args[0];
  const inputUsername = args[1]; // Username to act upon
  let value = args[2]; // Optional value, depending on the command

  const usage =
    "ℹ️ Usage: node cli/userCLI.js <command> <username> [value]\n" +
    "Commands: change-email, change-username, change-password, check-role, promote, demote, delete";

  if (!command || !inputUsername) {
    console.error(usage);
    process.exit(1);
  }

  try {
    console.log("⏳ Connecting to MongoDB...");
    await mongoose.connect(dbUri);
    console.log("✅ MongoDB connected.");

    // Case-insensitive username lookup
    const usernameToQuery = inputUsername.toLowerCase();
    const user = await User.findOne({ username: usernameToQuery });

    if (!user) {
      console.log(
        `❌ User "${inputUsername}" (queried as "${usernameToQuery}") not found.`
      );
      return; // Exit main function, finally will close connection
    }

    console.log(`ℹ️ Operating on user: "${user.username}" (ID: ${user._id})`);

    switch (command.toLowerCase()) {
      case "change-email":
        if (!value) {
          value = await promptInput("Enter new email: ");
        }
        const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;
        if (!emailRegex.test(value)) {
          console.error("❌ Error: Invalid email format.");
          break;
        }
        const newEmailLower = value.toLowerCase();
        if (user.email === newEmailLower) {
          console.log(
            `ℹ️ New email is the same as the current email. No changes made.`
          );
          break;
        }
        const existingEmailUser = await User.findOne({ email: newEmailLower });
        if (
          existingEmailUser &&
          existingEmailUser._id.toString() !== user._id.toString()
        ) {
          console.error(
            `❌ Error: Email "${newEmailLower}" is already in use by another user.`
          );
          break;
        }
        user.email = newEmailLower;
        await user.save();
        console.log(
          `✅ Email for user "${user.username}" updated to ${user.email}.`
        );
        break;

      case "change-username":
        if (!value) {
          value = await promptInput("Enter new username: ");
        }
        if (value.length < 3) {
          console.error(
            "❌ Error: New username must be at least 3 characters long."
          );
          break;
        }
        const newUsernameLower = value.toLowerCase();
        if (user.username === newUsernameLower) {
          console.log(
            `ℹ️ New username is the same as the current username. No changes made.`
          );
          break;
        }
        const existingUsernameUser = await User.findOne({
          username: newUsernameLower,
        });
        if (
          existingUsernameUser &&
          existingUsernameUser._id.toString() !== user._id.toString()
        ) {
          console.error(
            `❌ Error: Username "${newUsernameLower}" is already taken.`
          );
          break;
        }
        user.username = newUsernameLower;
        await user.save();
        console.log(
          `✅ Username for user (ID: ${user._id}) changed to "${user.username}".`
        );
        break;

      case "change-password":
        const newPassword = await promptInput("Enter new password: ", true);
        if (newPassword.length < 6) {
          console.error(
            "❌ Error: New password must be at least 6 characters long."
          );
          break;
        }
        const confirmPassword = await promptInput(
          "Confirm new password: ",
          true
        );
        if (newPassword !== confirmPassword) {
          console.error("❌ Error: Passwords do not match.");
          break;
        }
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        console.log(
          `✅ Password for user "${user.username}" has been updated.`
        );
        break;

      case "check-role":
        console.log(`ℹ️ User "${user.username}" has role: ${user.role}.`);
        break;

      case "promote":
        if (user.role === "admin") {
          console.log(`ℹ️ User "${user.username}" is already an admin.`);
        } else {
          user.role = "admin";
          await user.save();
          console.log(`✅ User "${user.username}" has been promoted to admin.`);
        }
        break;

      case "demote":
        if (user.role === "user") {
          console.log(`ℹ️ User "${user.username}" is already a user.`);
        } else {
          user.role = "user";
          await user.save();
          console.log(`✅ User "${user.username}" has been demoted to user.`);
        }
        break;

      case "delete":
        const confirmation = await promptInput(
          `❓ Are you sure you want to delete user "${user.username}" (ID: ${user._id})? This cannot be undone. (yes/no): `
        );
        if (confirmation.toLowerCase() === "yes") {
          await User.deleteOne({ _id: user._id }); // Delete by _id for safety
          console.log(`🗑️ User "${user.username}" has been deleted.`);
        } else {
          console.log("ℹ️ User deletion cancelled.");
        }
        break;

      default:
        console.log(`❌ Unknown command: "${command}"`);
        console.error(usage);
    }
  } catch (error) {
    console.error("❌ An unexpected error occurred:", error.message);
    if (error.name === "ValidationError") {
      for (const field in error.errors) {
        console.error(`  - ${error.errors[field].message}`);
      }
    }
  } finally {
    rl.close(); // Close readline interface
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log("ℹ️ MongoDB connection closed.");
    }
  }
}

main();
