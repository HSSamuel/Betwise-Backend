const mongoose = require("mongoose");
const Game = require("../models/Game");
const config = require("../config/env"); // <-- IMPORT the new config

const dbUri = config.MONGODB_URI; // <-- USE config

/**
 * Creates a valid Date object from a date string and a time string.
 * @param {string} dateStr - The date string (e.g., "August 15, 2025").
 * @param {string} timeStr - The time string in 24-hour format (e.g., "20:00:00").
 * @returns {Date}
 */
const createDate = (dateStr, timeStr) => {
  return new Date(`${dateStr} ${timeStr}`);
};

// --- Expanded list of Authentic Upcoming Game Data ---
const sampleGames = [
  // --- FINISHED GAMES (for the Results tab) ---
  {
    homeTeam: "Real Madrid",
    awayTeam: "Borussia Dortmund",
    homeTeamLogo: "https://media.api-sports.io/football/teams/541.png",
    awayTeamLogo: "https://media.api-sports.io/football/teams/167.png",
    odds: { home: 1.35, away: 8.0, draw: 5.5 },
    league: "Champions League Final",
    matchDate: createDate("June 1, 2024", "20:00:00"),
    status: "finished",
    result: "A", // 'A' for home team win
    scores: { home: 2, away: 0 },
  },
  {
    homeTeam: "Atalanta",
    awayTeam: "Bayer Leverkusen",
    homeTeamLogo: "https://media.api-sports.io/football/teams/499.png",
    awayTeamLogo: "https://media.api-sports.io/football/teams/168.png",
    odds: { home: 4.2, away: 1.8, draw: 3.9 },
    league: "Europa League Final",
    matchDate: createDate("May 22, 2024", "20:00:00"),
    status: "finished",
    result: "A",
    scores: { home: 3, away: 0 },
  },
  // Premier League Opening Weekend
  {
    homeTeam: "Liverpool",
    awayTeam: "AFC Bournemouth",
    homeTeamLogo: "https://media.api-sports.io/football/teams/40.png",
    awayTeamLogo: "https://media.api-sports.io/football/teams/35.png",
    odds: { home: 1.22, away: 12.0, draw: 7.0 },
    league: "Premier League",
    matchDate: createDate("August 16, 2025", "20:00:00"),
    status: "upcoming",
  },
  {
    homeTeam: "Aston Villa",
    awayTeam: "Newcastle United",
    homeTeamLogo: "https://media.api-sports.io/football/teams/66.png",
    awayTeamLogo: "https://media.api-sports.io/football/teams/34.png",
    odds: { home: 2.5, away: 2.7, draw: 3.6 },
    league: "Premier League",
    matchDate: createDate("August 17, 2025", "12:30:00"),
    status: "upcoming",
  },
  {
    homeTeam: "Manchester United",
    awayTeam: "Arsenal",
    homeTeamLogo: "https://media.api-sports.io/football/teams/33.png",
    awayTeamLogo: "https://media.api-sports.io/football/teams/42.png",
    odds: { home: 2.8, away: 2.4, draw: 3.5 },
    league: "Premier League",
    matchDate: createDate("August 17, 2025", "16:30:00"),
    status: "upcoming",
  },
  {
    homeTeam: "Chelsea",
    awayTeam: "Crystal Palace",
    homeTeamLogo: "https://media.api-sports.io/football/teams/49.png",
    awayTeamLogo: "https://media.api-sports.io/football/teams/52.png",
    odds: { home: 1.5, away: 6.5, draw: 4.2 },
    league: "Premier League",
    matchDate: createDate("August 17, 2025", "14:00:00"),
    status: "upcoming",
  },
  {
    homeTeam: "Wolverhampton Wanderers",
    awayTeam: "Manchester City",
    homeTeamLogo: "https://media.api-sports.io/football/teams/39.png",
    awayTeamLogo: "https://media.api-sports.io/football/teams/50.png",
    odds: { home: 8.0, away: 1.35, draw: 5.5 },
    league: "Premier League",
    matchDate: createDate("August 16, 2025", "17:30:00"),
    status: "upcoming",
  },

  // La Liga (Based on last season's top teams, as 25/26 fixtures are placeholders)
  {
    homeTeam: "Real Madrid",
    awayTeam: "Real Betis",
    homeTeamLogo: "https://media.api-sports.io/football/teams/541.png",
    awayTeamLogo: "https://media.api-sports.io/football/teams/543.png",
    odds: { home: 1.3, away: 9.0, draw: 6.0 },
    league: "La Liga",
    matchDate: createDate("August 18, 2025", "21:00:00"),
    status: "upcoming",
  },
  {
    homeTeam: "FC Barcelona",
    awayTeam: "Sevilla FC",
    homeTeamLogo: "https://media.api-sports.io/football/teams/529.png",
    awayTeamLogo: "https://media.api-sports.io/football/teams/536.png",
    odds: { home: 1.45, away: 6.8, draw: 4.75 },
    league: "La Liga",
    matchDate: createDate("August 19, 2025", "20:00:00"),
    status: "upcoming",
  },

  // Champions League Qualification
  {
    homeTeam: "FC Iberia 1999",
    awayTeam: "Malmö FF",
    homeTeamLogo: "https://media.api-sports.io/football/teams/3606.png",
    awayTeamLogo: "https://media.api-sports.io/football/teams/377.png",
    odds: { home: 4.5, away: 1.7, draw: 3.8 },
    league: "Champions League Qualification",
    matchDate: createDate("July 8, 2025", "18:00:00"),
    status: "upcoming",
  },
  {
    homeTeam: "PFC Ludogorets Razgrad",
    awayTeam: "FC Dinamo Minsk",
    homeTeamLogo: "https://media.api-sports.io/football/teams/731.png",
    awayTeamLogo: "https://media.api-sports.io/football/teams/391.png",
    odds: { home: 1.4, away: 7.0, draw: 4.8 },
    league: "Champions League Qualification",
    matchDate: createDate("July 8, 2025", "20:00:00"),
    status: "upcoming",
  },
  {
    homeTeam: "NK Olimpija Ljubljana",
    awayTeam: "FC Kairat",
    homeTeamLogo: "https://media.api-sports.io/football/teams/683.png",
    awayTeamLogo: "https://media.api-sports.io/football/teams/2279.png",
    odds: { home: 1.9, away: 3.9, draw: 3.4 },
    league: "Champions League Qualification",
    matchDate: createDate("July 8, 2025", "19:00:00"),
    status: "upcoming",
  },
];

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

    console.log("🌱 Seeding with a larger list of authentic upcoming games...");
    await Game.insertMany(sampleGames);
    console.log(`✅ Successfully seeded ${sampleGames.length} new games.`);
  } catch (err) {
    console.error("❌ Error during database seeding:", err);
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log("ℹ️ MongoDB connection closed.");
    }
  }
};

seedDB();
