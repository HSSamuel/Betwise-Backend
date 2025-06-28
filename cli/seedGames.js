const mongoose = require("mongoose");
const Game = require("../models/Game");
const config = require("../config/env");
const { syncGames } = require("../services/sportsDataService");
const localGames = require("./localSeedData.json");
const parseArgs = require("yargs-parser");

const dbUri = config.MONGODB_URI;

const seedDB = async () => {
  if (!dbUri) {
    console.error("❌ Error: MONGODB_URI is not defined in your .env file.");
    process.exit(1);
  }

  // Use yargs-parser to reliably get arguments
  const args = parseArgs(process.argv.slice(2));
  const source = args.source || "apifootball";

  console.log(`ℹ️  Using data source: ${source}`);

  try {
    console.log("⏳ Connecting to MongoDB...");
    await mongoose.connect(dbUri);
    console.log("✅ MongoDB connected successfully.");

    if (source === "local") {
      if (!localGames || localGames.length === 0) {
        console.warn(
          "⚠️  Warning: localSeedData.json is empty. No games to seed."
        );
      } else {
        console.log(
          `🌱 Seeding with ${localGames.length} games from localSeedData.json...`
        );
        for (const gameData of localGames) {
          const dataToSave = { ...gameData, isTestGame: true };
          await Game.findOneAndUpdate(
            {
              homeTeam: gameData.homeTeam,
              awayTeam: gameData.awayTeam,
              league: gameData.league,
            },
            { $set: dataToSave },
            { upsert: true, new: true }
          );
        }
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
