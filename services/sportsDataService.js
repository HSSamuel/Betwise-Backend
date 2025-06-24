const axios = require("axios");
const mongoose = require("mongoose");
const Game = require("../models/Game");
const { generateOddsForGame } = require("./oddsService");
const config = require("../config/env");
const { resolveBetsForGame } = require("./betResolutionService");
const leaguesToSync = require("../config/leagues.json");

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
          live: "all",
        },
        headers: { "x-apisports-key": config.APIFOOTBALL_KEY },
      }
    );

    const fixtures = response.data.response;
    if (!fixtures || fixtures.length === 0) {
      console.log("... No live or recently finished games found from API.");
      return;
    }

    console.log(
      `[Sync] Fetched ${fixtures.length} live/finished fixtures from API.`
    );
    let updatedCount = 0;
    let settledCount = 0;

    for (const fixture of response.data.response) {
      const game = await Game.findOne({
        externalApiId: `apif_${fixture.fixture.id}`,
      });
      if (!game) continue;

      const newStatus = fixture.fixture.status.short;

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
          await resolveBetsForGame(game, session, io);
          await session.commitTransaction();

          settledCount++;
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
      } else if (
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
          updatedCount++;
          console.log(
            `⚽ Score Update: ${game.homeTeam} ${game.scores.home} - ${game.scores.away} ${game.awayTeam}`
          );
          io.emit("gameUpdate", game);
        }
      }
    }

    console.log(
      `[Sync] Summary: ${updatedCount} games updated, ${settledCount} games settled.`
    );
  } catch (error) {
    console.error("Error fetching live/finished games:", error.message);
    throw error;
  }
};

const apiFootballProvider = {
  name: "API-Football",
  enabled: !!config.APIFOOTBALL_KEY,
  async syncUpcomingGames() {
    if (!this.enabled) return;
    console.log(
      `[${this.name}] Fetching upcoming games based on leagues.json...`
    );
    const fromDate = new Date();
    const toDate = new Date();
    toDate.setDate(fromDate.getDate() + 30);
    const fromDateStr = fromDate.toISOString().split("T")[0];
    const toDateStr = toDate.toISOString().split("T")[0];

    try {
      for (const league of leaguesToSync) {
        if (!league.apiFootballId) continue;
        const leagueId = league.apiFootballId;
        console.log(
          `-- Checking for games in: ${league.name} (ID: ${leagueId})`
        );
        const response = await axios.get(
          `https://v3.football.api-sports.io/fixtures`,
          {
            params: {
              league: leagueId,
              from: fromDateStr,
              to: toDateStr,
              status: "NS",
            },
            headers: { "x-apisports-key": config.APIFOOTBALL_KEY },
          }
        );

        if (!response.data || response.data.results === 0) {
          console.log(`   -> No upcoming games found for this league.`);
          continue;
        }

        console.log(
          `   -> Found ${response.data.results} game(s). Processing...`
        );

        for (const fixture of response.data.response) {
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
            { upsert: true, runValidators: true }
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(
        `[${this.name}] Failed to fetch or process games:`,
        error.message
      );
      throw error;
    }
    console.log(`[${this.name}] Finished syncing upcoming games.`);
  },
};

const allSportsApiProvider = {
  name: "AllSportsApi",
  enabled: !!config.ALLSPORTS_API_KEY,
  async syncUpcomingGames() {
    if (!this.enabled) return;
    console.log(
      `[${this.name}] Fetching upcoming games based on leagues.json...`
    );
    const fromDate = new Date();
    const toDate = new Date();
    toDate.setDate(fromDate.getDate() + 30);
    const fromDateStr = fromDate.toISOString().split("T")[0];
    const toDateStr = toDate.toISOString().split("T")[0];

    try {
      for (const league of leaguesToSync) {
        if (!league.allSportsApiId) continue;
        const leagueId = league.allSportsApiId;
        console.log(
          `-- Checking for games in: ${league.name} (ID: ${leagueId})`
        );
        const response = await axios.get(
          `https://apiv2.allsportsapi.com/football/`,
          {
            params: {
              met: "Fixtures",
              APIkey: config.ALLSPORTS_API_KEY,
              from: fromDateStr,
              to: toDateStr,
              leagueId: leagueId,
            },
          }
        );

        if (!response.data || !response.data.result) {
          console.log(`   -> No upcoming games found for this league.`);
          continue;
        }

        console.log(
          `   -> Found ${response.data.result.length} game(s). Processing...`
        );

        for (const fixture of response.data.result) {
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
            { upsert: true, runValidators: true }
          );
        }
      }
    } catch (error) {
      console.error(
        `[${this.name}] Failed to fetch or process games:`,
        error.message
      );
      throw error;
    }
    console.log(`[${this.name}] Finished syncing upcoming games.`);
  },
};

const theSportsDbProvider = {
  name: "TheSportsDB",
  enabled: !!config.X_RAPIDAPI_KEY,
  async syncUpcomingGames() {
    if (!this.enabled) {
      console.log(`[${this.name}] Provider is not enabled. Skipping sync.`);
      return;
    }
    console.log(`[${this.name}] Fetching upcoming games...`);

    const leagues = [
      { id: "4328", name: "English Premier League" },
      { id: "4335", name: "La Liga" },
      { id: "4332", name: "Bundesliga" },
    ];
    const headers = {
      "x-rapidapi-host": "thesportsdb.p.rapidapi.com",
      "x-rapidapi-key": config.X_RAPIDAPI_KEY,
    };

    try {
      for (const league of leagues) {
        const response = await axios.get(
          `https://thesportsdb.p.rapidapi.com/v1/json/3/eventsround.php`,
          { params: { id: league.id, r: "38" }, headers }
        );

        if (!response.data || !response.data.events) {
          console.log(
            `[${this.name}] No upcoming games found for league ${league.name}.`
          );
          continue;
        }

        for (const event of response.data.events) {
          if (new Date(event.dateEvent) < new Date() || !event.strTime)
            continue;

          const odds = await generateOddsForGame(
            event.strHomeTeam,
            event.strAwayTeam
          );

          const gameData = {
            homeTeam: event.strHomeTeam,
            awayTeam: event.strAwayTeam,
            homeTeamLogo: event.strHomeTeamBadge,
            awayTeamLogo: event.strAwayTeamBadge,
            matchDate: new Date(`${event.dateEvent}T${event.strTime}`),
            league: league.name,
            odds,
            externalApiId: `tsdb_${event.idEvent}`,
            status: "upcoming",
          };

          await Game.findOneAndUpdate(
            { externalApiId: gameData.externalApiId },
            { $set: gameData },
            { upsert: true, runValidators: true }
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(
        `[${this.name}] Failed to fetch or process games:`,
        error.message
      );
      throw error;
    }
    console.log(`[${this.name}] Finished syncing upcoming games.`);
  },
};

const providers = {
  apifootball: apiFootballProvider,
  thesportsdb: theSportsDbProvider,
  allsportsapi: allSportsApiProvider,
};

const syncGames = async (source = "apifootball") => {
  const provider = providers[source.toLowerCase()];
  if (provider && provider.enabled) {
    await provider.syncUpcomingGames();
  } else {
    const err = new Error(
      `Sync failed: The provider "${source}" is not configured on the server. Make sure the correct API key is in the .env file.`
    );
    err.statusCode = 400;
    throw err;
  }
};

module.exports = { syncGames, syncLiveAndFinishedGames };
