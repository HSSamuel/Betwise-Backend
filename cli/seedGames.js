// node cli/seedGames.js --source=local

const mongoose = require("mongoose");
const Game = require("../models/Game");
const config = require("../config/env");
const { syncGames } = require("../services/sportsDataService");
const localGames = require("./localSeedData.json"); // Import local data

const dbUri = config.MONGODB_URI;

const seedDB = async () => {
  if (!dbUri) {
    console.error("❌ Error: MONGODB_URI is not defined in your .env file.");
    process.exit(1);
  }

  // Check for a --source flag, e.g., --source local
  const sourceArg = process.argv.find((arg) => arg.startsWith("--source"));
  const source = sourceArg ? sourceArg.split("=")[1] : "apifootball";

  console.log(`ℹ️  Using data source: ${source}`);

  try {
    await mongoose.connect(dbUri);
    console.log("✅ MongoDB connected successfully.");

    console.log("🔥 Clearing existing game data...");
    await Game.deleteMany({});
    console.log("✅ Existing games cleared.");

    if (source === "local") {
      console.log(
        `🌱 Seeding with ${localGames.length} games from localSeedData.json...`
      );
      await Game.insertMany(localGames);
    } else {
      console.log(
        `🌱 Seeding with fresh upcoming games from the '${source}' API...`
      );
      await syncGames(source);
    }

    const gameCount = await Game.countDocuments();
    console.log(
      `✅ Successfully seeded the database with ${gameCount} new games.`
    );
  } catch (err) {
    console.error("❌ Error during dynamic database seeding:", err);
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    console.log("ℹ️ MongoDB disconnected.");
  }
};

seedDB();
