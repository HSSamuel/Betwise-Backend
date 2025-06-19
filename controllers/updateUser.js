require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"), // Assuming .env is in parent directory
});

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const readline = require("readline");
const User = require("../models/User"); // Adjust path if User model is elsewhere

const dbUri = process.env.MONGODB_URI;

// --- Helper for secure password prompt ---
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const promptPassword = (promptMessage) => {
  return new Promise((resolve) => {
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = (chunk, encoding, callback) => {
      if (typeof chunk === "string" && chunk.trim() !== promptMessage.trim()) {
        originalStdoutWrite.call(process.stdout, "*", encoding, callback);
      } else {
        originalStdoutWrite.call(process.stdout, chunk, encoding, callback);
      }
    };
    rl.question(promptMessage, (password) => {
      process.stdout.write = originalStdoutWrite;
      process.stdout.write("\n");
      resolve(password);
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

  const currentUsernameArg = process.argv[2];
  const newUsernameArg = process.argv[3]; // Can be actual username or a flag like "-" if only changing password
  // Password will be prompted

  const usage =
    "ℹ️ Usage: node updateUser.js <currentUsername> [newUsernameOrSkipFlag]\n" +
    "   - If changing username, provide the new username.\n" +
    "   - If only changing password, provide '-' for [newUsernameOrSkipFlag].\n" +
    "   - You will be prompted for the new password if you choose to change it.";

  if (!currentUsernameArg) {
    console.error(usage);
    process.exit(1);
  }

  let changeUsername = false;
  let newUsernameValidated = null;

  if (newUsernameArg && newUsernameArg !== "-") {
    if (newUsernameArg.length < 3) {
      console.error(
        "❌ Error: New username must be at least 3 characters long."
      );
      process.exit(1);
    }
    newUsernameValidated = newUsernameArg.toLowerCase();
    changeUsername = true;
  }

  const changePasswordChoice = await promptInput(
    "Do you want to change the password? (yes/no): "
  );
  let newPasswordValidated = null;
  if (changePasswordChoice.toLowerCase() === "yes") {
    const tempNewPassword = await promptPassword("Enter new password: ");
    if (tempNewPassword.length < 6) {
      console.error(
        "❌ Error: New password must be at least 6 characters long."
      );
      rl.close();
      process.exit(1);
    }
    const confirmPassword = await promptPassword("Confirm new password: ");
    if (tempNewPassword !== confirmPassword) {
      console.error("❌ Error: Passwords do not match.");
      rl.close();
      process.exit(1);
    }
    newPasswordValidated = tempNewPassword;
  }

  rl.close(); // Close readline as all prompts are done.

  if (!changeUsername && !newPasswordValidated) {
    console.log("ℹ️ No changes specified for username or password.");
    process.exit(0);
  }

  try {
    console.log("⏳ Connecting to MongoDB...");
    await mongoose.connect(dbUri);
    console.log("✅ MongoDB connected.");

    const usernameToQuery = currentUsernameArg.toLowerCase();
    const user = await User.findOne({ username: usernameToQuery });

    if (!user) {
      console.log(
        `❌ User "${currentUsernameArg}" (queried as "${usernameToQuery}") not found.`
      );
      return; // Exits main, finally will close connection
    }

    console.log(`Found user: ${user.username}. Preparing to update...`);
    let updated = false;

    if (changeUsername && newUsernameValidated) {
      if (user.username === newUsernameValidated) {
        console.log(
          `ℹ️ New username "${newUsernameValidated}" is the same as the current one. Skipping username update.`
        );
      } else {
        // Check if the new username is already taken by another user
        const existingUserWithNewName = await User.findOne({
          username: newUsernameValidated,
        });
        if (existingUserWithNewName) {
          console.error(
            `❌ Error: The username "${newUsernameValidated}" is already taken by another user.`
          );
          return; // Exits main, finally will close connection
        }
        user.username = newUsernameValidated;
        console.log(`✔ Username will be updated to "${user.username}".`);
        updated = true;
      }
    }

    if (newPasswordValidated) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPasswordValidated, salt);
      console.log(`✔ Password will be updated.`);
      updated = true;
    }

    if (updated) {
      await user.save();
      console.log(
        `✅ User "${user.username}" (originally "${currentUsernameArg}") was successfully updated.`
      );
    } else {
      console.log("ℹ️ No actual changes were made to the user.");
    }
  } catch (error) {
    console.error("❌ Error during the update process:", error.message);
    if (error.name === "ValidationError") {
      for (const field in error.errors) {
        console.error(`  - ${error.errors[field].message}`);
      }
    }
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log("ℹ️ MongoDB connection closed.");
    }
  }
}

main();
