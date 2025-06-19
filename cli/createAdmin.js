const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const readline = require("readline");
const User = require("../models/User");
const config = require("../config/env"); // <-- IMPORT the new config

const dbUri = config.MONGODB_URI; // <-- USE config

if (!dbUri) {
  console.error(
    "❌ Error: MONGODB_URI is not defined. Please ensure it is set in your .env file."
  );
  process.exit(1);
}

// Get username, email, firstName, lastName from CLI arguments
const username = process.argv[2];
const email = process.argv[3];
const firstName = process.argv[4];
const lastName = process.argv[5];

if (!username || !email || !firstName || !lastName) {
  console.error(
    "❗ Usage: node cli/createAdmin.js <username> <email> <firstName> <lastName>"
  );
  console.error("   You will be prompted to enter the password securely.");
  process.exit(1);
}

// Basic validation for provided arguments
if (username.length < 3) {
  console.error("❌ Error: Username must be at least 3 characters long.");
  process.exit(1);
}
const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;
if (!emailRegex.test(email)) {
  console.error("❌ Error: Invalid email format.");
  process.exit(1);
}
if (firstName.trim() === "" || lastName.trim() === "") {
  console.error("❌ Error: First name and last name cannot be empty.");
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const promptPassword = (promptMessage) => {
  return new Promise((resolve) => {
    // Temporarily store the original stdout.write
    const originalStdoutWrite = process.stdout.write;

    // Override stdout.write to suppress echoing for password input
    process.stdout.write = (chunk, encoding, callback) => {
      if (typeof chunk === "string" && chunk.trim() !== promptMessage.trim()) {
        // Write asterisks or nothing instead of the actual characters
        originalStdoutWrite.call(process.stdout, "*", encoding, callback);
      } else {
        originalStdoutWrite.call(process.stdout, chunk, encoding, callback);
      }
    };

    rl.question(promptMessage, (password) => {
      // Restore the original stdout.write
      process.stdout.write = originalStdoutWrite;
      process.stdout.write("\n"); // Add a newline after password input
      resolve(password);
    });
  });
};

async function main() {
  try {
    const password = await promptPassword("Enter password for admin user: ");
    const confirmPassword = await promptPassword("Confirm password: ");

    if (password !== confirmPassword) {
      console.error("❌ Error: Passwords do not match.");
      rl.close();
      process.exit(1);
    }

    if (password.length < 6) {
      console.error("❌ Error: Password must be at least 6 characters long.");
      rl.close();
      process.exit(1);
    }

    rl.close(); // Close readline interface as it's no longer needed

    console.log("⏳ Connecting to MongoDB...");
    await mongoose.connect(dbUri);
    console.log("✅ MongoDB connected.");

    await createAdminUser(username, email, password, firstName, lastName);
  } catch (error) {
    console.error("❌ An unexpected error occurred:", error.message);
    // Ensure readline is closed in case of an error during prompts
    if (!rl.closed) {
      rl.close();
    }
  } finally {
    if (mongoose.connection.readyState === 1) {
      // 1 for connected
      await mongoose.connection.close();
      console.log("ℹ️ MongoDB connection closed.");
    }
    // The script will exit naturally or via process.exit(1) in error cases.
  }
}

async function createAdminUser(username, email, password, firstName, lastName) {
  try {
    const lowercasedUsername = username.toLowerCase();
    const lowercasedEmail = email.toLowerCase();

    const existingUser = await User.findOne({
      $or: [{ username: lowercasedUsername }, { email: lowercasedEmail }],
    });

    if (existingUser) {
      console.log(
        `❌ User with username "${username}" or email "${email}" already exists.`
      );
      return; // Exits function, connection will be closed in finally block of main
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      username: lowercasedUsername,
      email: lowercasedEmail,
      password: hashedPassword,
      firstName: firstName,
      lastName: lastName,
      role: "admin",
      // state: "DefaultState" // Optional: if you want to set a default state
    });

    await newUser.save();
    console.log(
      `✅ Admin user "${newUser.username}" (${firstName} ${lastName}) created successfully.`
    );
  } catch (error) {
    console.error("❌ Error creating admin user:", error.message);
    if (error.name === "ValidationError") {
      // Log specific validation errors
      for (const field in error.errors) {
        console.error(`  - ${error.errors[field].message}`);
      }
    }
    // No explicit process.exit(1) here, let the main function's finally block handle closure.
    // If this function is critical and failure means script failure, consider re-throwing or setting a flag.
  }
}

main();
