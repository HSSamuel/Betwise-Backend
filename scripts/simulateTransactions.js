const mongoose = require("mongoose");
const bcryptjs = require("bcryptjs");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Bet = require("../models/Bet");
const Game = require("../models/Game");
const config = require("../config/env"); // <-- IMPORT the new config

const dbUri = config.MONGODB_URI; // <-- USE config
let exitCode = 0;

async function run() {
  console.log("🚀 Starting transaction simulation script...");

  if (!dbUri) {
    console.error("❌ Error: MONGODB_URI is not defined.");
    process.exit(1);
  }

  try {
    console.log("⏳ Connecting to MongoDB...");
    console.log("DATABASE_URI:", dbUri);
    await mongoose.connect(dbUri);
    console.log("✅ Successfully connected to MongoDB.");

    const username = "testsimuser";
    const email = `${username}@example.com`;
    let user = await User.findOne({ username: username.toLowerCase() });

    if (!user) {
      console.log(`ℹ️ User "${username}" not found. Creating a new one...`);
      user = new User({
        username: username.toLowerCase(),
        email: email.toLowerCase(),
        password: await bcryptjs.hash("testpassword123", 10),
        firstName: "TestSim",
        lastName: "User",
        walletBalance: 1000.0,
      });
      await user.save();
      console.log(
        `👤 User "${
          user.username
        }" created successfully with initial balance: ${user.walletBalance.toFixed(
          2
        )}.`
      );
    } else {
      console.log(
        `👤 Using existing user: "${
          user.username
        }" with balance: ${user.walletBalance.toFixed(2)}.`
      );
    }

    // Find a game to bet on (or create one if none exist)
    let gameToBetOn = await Game.findOne({ status: "upcoming" });
    if (!gameToBetOn) {
      console.log("ℹ️ No upcoming games found. Creating a simulation game...");
      gameToBetOn = new Game({
        homeTeam: "Sim Lions",
        awayTeam: "Test Eagles",
        odds: { home: 1.8, away: 3.5, draw: 3.0 },
        league: "Simulation League",
        matchDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
      });
      await gameToBetOn.save();
      console.log("✅ Simulation game created.");
    }

    // --- Simulate Bet ---
    const betAmount = 200.0;
    if (user.walletBalance >= betAmount) {
      user.walletBalance -= betAmount;
      await user.save();

      // Step 1: Create the actual Bet document
      const newBet = new Bet({
        user: user._id,
        game: gameToBetOn._id,
        outcome: "A", // Bet on home team to win
        stake: betAmount,
      });
      await newBet.save();
      console.log(`🎲 Simulated bet placed with ID: ${newBet._id}`);

      // Step 2: Create the transaction record linked to the new bet
      await new Transaction({
        user: user._id,
        type: "bet",
        amount: -betAmount,
        balanceAfter: user.walletBalance,
        bet: newBet._id, // Link the transaction to the bet document
        game: gameToBetOn._id,
        description: `Simulated bet of ${betAmount.toFixed(2)}`,
      }).save();
      console.log(
        `transaction logged for bet. New balance: ${user.walletBalance.toFixed(
          2
        )}`
      );
    } else {
      console.warn(`⚠️ Could not simulate bet: insufficient balance.`);
    }

    console.log("✅ Simulation completed successfully.");
  } catch (error) {
    console.error("❌ Error during simulation:", error.message);
    exitCode = 1;
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      console.log("ℹ️ MongoDB disconnected.");
    }
    console.log(`🏁 Simulation script finished with exit code ${exitCode}.`);
    // process.exit(exitCode); // Commenting out exit to prevent premature closing in some environments
  }
}

run();
