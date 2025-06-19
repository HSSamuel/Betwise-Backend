const mongoose = require("mongoose");
const Bet = require("../models/Bet");
const Game = require("../models/Game");
const { resolveBetsForGame } = require("../services/betResolutionService");
const config = require("../config/env"); // <-- IMPORT the new config

const resolveAllMultiBets = async () => {
  console.log("🚀 Starting Multi-Bet resolution script...");
  const dbUri = config.MONGODB_URI; // <-- USE config
  if (!dbUri) {
    console.error("❌ Error: MONGODB_URI is not defined.");
    process.exit(1);
  }

  await mongoose.connect(dbUri);
  console.log("✅ MongoDB connected.");

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Find all games that have finished but may have unresolved multi-bets
    const finishedGames = await Game.find({
      status: "finished",
      result: { $ne: null },
    }).session(session);

    if (finishedGames.length === 0) {
      console.log("ℹ️ No finished games found to check for multi-bets.");
      await session.abortTransaction();
      return;
    }

    console.log(
      `ℹ️ Found ${finishedGames.length} finished games to check for related multi-bets.`
    );

    // 2. For each finished game, trigger the consolidated resolution service
    for (const game of finishedGames) {
      // This will check any multi-bets associated with this game and resolve them if all other legs are also complete.
      await resolveBetsForGame(game, session);
    }

    await session.commitTransaction();
    console.log("✅ Multi-Bet resolution check complete.");
  } catch (error) {
    await session.abortTransaction();
    console.error(
      "❌ An error occurred during the multi-bet resolution process:",
      error
    );
  } finally {
    session.endSession();
    await mongoose.disconnect();
    console.log("ℹ️ MongoDB disconnected.");
  }
};

resolveAllMultiBets();
