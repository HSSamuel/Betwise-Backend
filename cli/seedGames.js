const mongoose = require("mongoose");
const Game = require("../models/Game");
const config = require("../config/env");
const { syncGames } = require("../services/sportsDataService");
const localGames = require("./localSeedData.json");

const dbUri = config.MONGODB_URI;

const seedDB = async () => {
  if (!dbUri) {
    console.error("❌ Error: MONGODB_URI is not defined in your .env file.");
    process.exit(1);
  }

  const sourceArg = process.argv.find((arg) => arg.startsWith("--source="));
  let source;

  if (sourceArg) {
    source = sourceArg.split("=")[1];
  } else {
    source = process.argv[2] || "apifootball";
  }

  console.log(`ℹ️  Using data source: ${source}`);

  try {
    console.log("⏳ Connecting to MongoDB...");
    await mongoose.connect(dbUri);
    console.log("✅ MongoDB connected successfully.");

    // FIX: The line that clears the database has been removed.
    // This will now ADD games to your database without deleting existing ones.
    // console.log("🔥 Clearing existing game data...");
    // await Game.deleteMany({});
    // console.log("✅ Existing games cleared.");

    if (source === "local") {
      console.log(
        `🌱 Seeding with ${localGames.length} games from localSeedData.json...`
      );
      // Use findOneAndUpdate with upsert to avoid creating duplicates
      for (const gameData of localGames) {
        await Game.findOneAndUpdate(
          {
            homeTeam: gameData.homeTeam,
            awayTeam: gameData.awayTeam,
            league: gameData.league,
          },
          { $set: gameData },
          { upsert: true, new: true }
        );
      }
    } else {
      console.log(
        `🌱 Seeding with fresh upcoming games from the '${source}' API...`
      );
      await syncGames(source);
    }

    const gameCount = await Game.countDocuments();
    console.log(`✅ Database now contains a total of ${gameCount} games.`);
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
