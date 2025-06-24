const mongoose = require("mongoose");
const Game = require("../models/Game");
const config = require("../config/env");
// Import the syncGames function and the specific provider you want to use
const { syncGames } = require("../services/sportsDataService");

const dbUri = config.MONGODB_URI;

const seedDB = async () => {
  if (!dbUri) {
    console.error("❌ Error: MONGODB_URI is not defined in your .env file.");
    process.exit(1);
  }

  try {
    console.log("⏳ Connecting to MongoDB...");
    await mongoose.connect(dbUri);
    console.log("✅ MongoDB connected successfully.");

    console.log("🔥 Clearing existing game data...");
    await Game.deleteMany({});
    console.log("✅ Existing games cleared.");

    console.log("🌱 Seeding with fresh upcoming games from the sports API...");
    // Call the syncGames function to fetch and populate real upcoming games
    // We use "apifootball" here as an example provider.
    await syncGames("apifootball");

    const gameCount = await Game.countDocuments();
    console.log(
      `✅ Successfully seeded the database with ${gameCount} new games.`
    );
  } catch (err) {
    console.error("❌ Error during dynamic database seeding:", err);
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log("ℹ️ MongoDB connection closed.");
    }
  }
};

seedDB();
