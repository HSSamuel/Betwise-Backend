// In: Bet/Backend/scripts/seedRankings.js

const mongoose = require("mongoose");
const TeamRanking = require("../models/TeamRanking");
const rankingsData = require("../services/team-rankings.json");
const config = require("../config/env");

const seedRankings = async () => {
  console.log("🚀 Starting team rankings seeding script...");
  const dbUri = config.MONGODB_URI;
  if (!dbUri) {
    console.error("❌ Error: MONGODB_URI is not defined.");
    process.exit(1);
  }

  await mongoose.connect(dbUri);
  console.log("✅ MongoDB connected.");

  try {
    const teams = rankingsData.teams;
    const operations = [];

    for (const teamName in teams) {
      const rankValue = teams[teamName];
      // "upsert" will update the rank if the team exists, or insert a new one if it doesn't.
      operations.push({
        updateOne: {
          filter: { teamName_lower: teamName.toLowerCase() },
          update: {
            $set: {
              teamName: teamName.charAt(0).toUpperCase() + teamName.slice(1), // Capitalize for display
              teamName_lower: teamName.toLowerCase(),
              ranking: rankValue,
            },
          },
          upsert: true,
        },
      });
    }

    if (operations.length > 0) {
      console.log(`ℹ️  Preparing to seed/update ${operations.length} teams...`);
      await TeamRanking.bulkWrite(operations);
      console.log(`✅ Successfully seeded/updated team rankings.`);
    } else {
      console.log("ℹ️ No teams found in the JSON file to seed.");
    }
  } catch (error) {
    console.error("❌ An error occurred during seeding:", error);
  } finally {
    await mongoose.disconnect();
    console.log("ℹ️ MongoDB disconnected.");
  }
};

seedRankings();
