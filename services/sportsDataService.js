const axios = require("axios");
const mongoose = require("mongoose");
const Game = require("../models/Game");
const { generateOddsForGame } = require("./oddsService");
const { resolveBetsForGame } = require("./betResolutionService");

// --- Function to fetch UPCOMING games from API-Football ---
const syncUpcomingGames = async () => {
  const apiKey = process.env.APIFOOTBALL_KEY;
  if (!apiKey) {
    console.error(
      "❌ APIFOOTBALL_KEY is not defined. Cannot sync upcoming games."
    );
    return;
  }

  console.log("ℹ️ Fetching UPCOMING games from API-Football...");
  const currentSeason = new Date().getFullYear();
  const leagueIds = ["39", "140", "135", "78", "61"]; // Major leagues
  const toDate = new Date();
  toDate.setDate(toDate.getDate() + 7); // Fetch games for the next 7 days
  const fromDateStr = new Date().toISOString().split("T")[0];
  const toDateStr = toDate.toISOString().split("T")[0];

  for (const leagueId of leagueIds) {
    try {
      const config = {
        method: "get",
        url: `https://v3.football.api-sports.io/fixtures`,
        params: {
          league: leagueId,
          season: currentSeason,
          from: fromDateStr,
          to: toDateStr,
          status: "NS",
        },
        headers: { "x-apisports-key": apiKey },
      };
      const response = await axios(config);
      const fixtures = response.data.response;
      if (!fixtures || fixtures.length === 0) continue;

      for (const fixture of fixtures) {
        const odds = await generateOddsForGame(
          fixture.teams.home.name,
          fixture.teams.away.name
        );
        const gameData = {
          homeTeam: fixture.teams.home.name,
          awayTeam: fixture.teams.away.name,
          homeTeamLogo: fixture.teams.home.logo,
          awayTeamLogo: fixture.teams.away.logo,
          matchDate: new Date(fixture.fixture.date),
          league: fixture.league.name,
          odds,
          externalApiId: `apif_${fixture.fixture.id}`,
          status: "upcoming",
        };
        await Game.findOneAndUpdate(
          { externalApiId: gameData.externalApiId },
          { $set: gameData },
          { upsert: true, new: true }
        );
      }
    } catch (error) {
      console.error(
        `❌ Error fetching upcoming games for league ${leagueId}:`,
        error.message
      );
    }
  }
};

// --- Helper functions ---
const mapApiStatus = (apiStatus) => {
  const finished = ["FT", "AET", "PEN"];
  const live = ["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INTR"];
  if (finished.includes(apiStatus)) return "finished";
  if (live.includes(apiStatus)) return "live";
  return "upcoming";
};

const getResultFromScore = (home, away) => {
  if (home > away) return "A";
  if (away > home) return "B";
  return "Draw";
};

// --- Function to sync LIVE and RECENTLY FINISHED games ---
const syncLiveAndFinishedGames = async (io) => {
  const apiKey = process.env.APIFOOTBALL_KEY;
  if (!apiKey) {
    console.error("❌ APIFOOTBALL_KEY is not defined. Cannot sync live games.");
    return;
  }

  console.log("ℹ️ Fetching LIVE and FINISHED games from API-Football...");
  try {
    const config = {
      method: "get",
      url: `https://v3.football.api-sports.io/fixtures?live=all`,
      headers: { "x-apisports-key": apiKey },
    };

    const response = await axios(config);
    const liveFixtures = response.data.response;
    if (liveFixtures.length === 0) {
      return;
    }

    for (const fixture of liveFixtures) {
      const game = await Game.findOne({
        externalApiId: `apif_${fixture.fixture.id}`,
      });
      if (!game) continue;

      const newStatus = mapApiStatus(fixture.fixture.status.short);
      const hasChanged =
        game.scores.home !== fixture.goals.home ||
        game.scores.away !== fixture.goals.away ||
        game.status !== newStatus;

      if (hasChanged) {
        game.status = newStatus;
        game.scores = { home: fixture.goals.home, away: fixture.goals.away };
        game.elapsedTime = fixture.fixture.status.elapsed;

        if (newStatus === "finished") {
          game.result = getResultFromScore(
            fixture.goals.home,
            fixture.goals.away
          );
        }

        const updatedGame = await game.save();
        io.emit("gameUpdate", updatedGame);

        if (updatedGame.status === "finished" && updatedGame.result) {
          const session = await mongoose.startSession();
          try {
            await session.withTransaction(async () => {
              await resolveBetsForGame(updatedGame, session);
            });
          } finally {
            session.endSession();
          }
        }
      }
    }
  } catch (error) {
    console.error("❌ Error fetching live game data:", error.message);
  }
};

module.exports = { syncUpcomingGames, syncLiveAndFinishedGames };
