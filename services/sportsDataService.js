const axios = require("axios");
const mongoose = require("mongoose");
const Game = require("../models/Game");
const { generateOddsForGame } = require("./oddsService");
const config = require("../config/env");

// Import the bet resolution service, which is needed for finished games.
const { resolveBetsForGame } = require("./betResolutionService");

// --- NEW FUNCTION: To sync live and finished games ---
const syncLiveAndFinishedGames = async (io) => {
  console.log("... Checking for live and finished games from API-Football...");
  const leagueIds = [
    "39", // Premier League (England)
    "140", // La Liga (Spain)
    "135", // Serie A (Italy)
    "78", // Bundesliga (Germany)
    "61", // Ligue 1 (France)
    "2", // UEFA Champions League
    "3", // UEFA Europa League
  ];

  try {
    const response = await axios.get(
      `https://v3.football.api-sports.io/fixtures`,
      {
        params: {
          live: "all", // This parameter gets all live and recently finished games
        },
        headers: { "x-apisports-key": config.APIFOOTBALL_KEY },
      }
    );

    if (!response.data.response || response.data.response.length === 0) {
      console.log("... No live or recently finished games found.");
      return;
    }

    for (const fixture of response.data.response) {
      const game = await Game.findOne({
        externalApiId: `apif_${fixture.fixture.id}`,
      });
      if (!game) continue;

      const newStatus = fixture.fixture.status.short;

      // If the game is FINISHED ('FT') and was previously not finished
      if (newStatus === "FT" && game.status !== "finished") {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
          game.status = "finished";
          game.scores.home = fixture.goals.home;
          game.scores.away = fixture.goals.away;

          if (fixture.goals.home > fixture.goals.away) game.result = "A";
          else if (fixture.goals.away > fixture.goals.home) game.result = "B";
          else game.result = "Draw";

          await game.save({ session });
          await resolveBetsForGame(game, session);
          await session.commitTransaction();

          console.log(
            `✅ Game Finished & Settled: ${game.homeTeam} vs ${game.awayTeam}`
          );
          io.emit("gameResultUpdated", {
            gameId: game._id,
            result: game.result,
            status: game.status,
          });
        } catch (error) {
          await session.abortTransaction();
          console.error(`Error settling game ${game._id}:`, error.message);
        } finally {
          session.endSession();
        }
      }
      // If the game is LIVE and the score has changed
      else if (
        newStatus.startsWith("1H") ||
        newStatus.startsWith("2H") ||
        newStatus === "HT"
      ) {
        if (
          game.scores.home !== fixture.goals.home ||
          game.scores.away !== fixture.goals.away
        ) {
          game.status = "live";
          game.scores.home = fixture.goals.home;
          game.scores.away = fixture.goals.away;
          game.elapsedTime = fixture.fixture.status.elapsed;
          await game.save();
          console.log(
            `⚽ Score Update: ${game.homeTeam} ${game.scores.home} - ${game.scores.away} ${game.awayTeam}`
          );
          io.emit("gameUpdate", game);
        }
      }
    }
  } catch (error) {
    console.error("Error fetching live/finished games:", error.message);
  }
};

// --- NEW: Provider for AllSportsApi ---
const allSportsApiProvider = {
  name: "AllSportsApi",
  enabled: !!config.ALLSPORTS_API_KEY,

  async syncUpcomingGames() {
    if (!this.enabled) return;
    console.log(`[${this.name}] Fetching upcoming games...`);

    const fromDate = new Date();
    const toDate = new Date();
    toDate.setDate(fromDate.getDate() + 7); // Fetch games for the next 7 days

    const fromDateStr = fromDate.toISOString().split("T")[0];
    const toDateStr = toDate.toISOString().split("T")[0];

    try {
      const response = await axios.get(
        `https://apiv2.allsportsapi.com/football/`,
        {
          params: {
            met: "Fixtures",
            APIkey: config.ALLSPORTS_API_KEY,
            from: fromDateStr,
            to: toDateStr,
          },
        }
      );

      if (!response.data || !response.data.result) {
        console.log(`[${this.name}] No games found in the response.`);
        return;
      }

      for (const fixture of response.data.result) {
        try {
          const odds = await generateOddsForGame(
            fixture.event_home_team,
            fixture.event_away_team
          );

          const gameData = {
            homeTeam: fixture.event_home_team,
            awayTeam: fixture.event_away_team,
            homeTeamLogo: fixture.home_team_logo,
            awayTeamLogo: fixture.away_team_logo,
            matchDate: new Date(`${fixture.event_date}T${fixture.event_time}`),
            league: fixture.league_name,
            odds,
            externalApiId: `allsports_${fixture.event_key}`,
            status: "upcoming",
          };

          await Game.findOneAndUpdate(
            { externalApiId: gameData.externalApiId },
            { $set: gameData },
            { upsert: true }
          );
        } catch (singleGameError) {
          console.error(
            `[${this.name}] Skipping game due to error: ${fixture.event_key}`,
            singleGameError.message
          );
        }
      }
    } catch (error) {
      console.error(`[${this.name}] Failed to fetch games:`, error.message);
    }
    console.log(`[${this.name}] Finished syncing upcoming games.`);
  },
};

// --- Provider for API-Football ---
const apiFootballProvider = {
  name: "API-Football",
  enabled: !!config.APIFOOTBALL_KEY,
  // ... (code for this provider remains the same)
};

// --- Provider for TheSportsDB ---
const theSportsDbProvider = {
  name: "TheSportsDB",
  enabled: !!config.X_RAPIDAPI_KEY,
  // ... (code for this provider remains the same, including the delay)
};

// --- Main Service ---
const providers = {
  apifootball: apiFootballProvider,
  thesportsdb: theSportsDbProvider,
  allsportsapi: allSportsApiProvider, // Add the new provider to the list
};

const syncGames = async (source = "allsportsapi") => {
  // Default to the new provider
  const provider = providers[source.toLowerCase()];
  if (provider && provider.enabled) {
    await provider.syncUpcomingGames();
  } else {
    throw new Error(
      `[syncGames] Provider "${source}" is not enabled or does not exist.`
    );
  }
};

module.exports = { syncGames, syncLiveAndFinishedGames };
