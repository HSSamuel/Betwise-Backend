const axios = require("axios");
const mongoose = require("mongoose");
const Game = require("../models/Game");
const { generateOddsForGame } = require("./oddsService");
const config = require("../config/env");
const { resolveBetsForGame } = require("./betResolutionService");
const { generateLiveOdds } = require("./aiLiveOddsService");
const leaguesToSync = require("../config/leagues.json");

// A comprehensive set of all known "live" statuses from the API-Football documentation
const LIVE_STATUSES = new Set([
  "1H",
  "HT",
  "2H",
  "ET",
  "BT",
  "P",
  "SUSP",
  "INT",
]);

const syncLiveAndFinishedGames = async (io) => {
  console.log("-----------------------------------------------------");
  console.log(
    `[Live Sync] Starting check for live and finished games at ${new Date().toLocaleTimeString()}`
  );

  if (!config.APIFOOTBALL_KEY) {
    console.error(
      "[Live Sync] Error: APIFootball Key is missing. Cannot sync live games."
    );
    return;
  }

  // Dynamically create the 'live' parameter string from your config file
  const leagueIds = leaguesToSync
    .map((l) => l.apiFootballId)
    .filter((id) => id)
    .join("-");

  if (!leagueIds) {
    console.log(
      "[Live Sync] No leagues configured in leagues.json. Ending task."
    );
    return;
  }

  try {
    const response = await axios.get(
      `https://v3.football.api-sports.io/fixtures`,
      {
        params: {
          live: leagueIds, // Use the dynamically generated list of league IDs
        },
        headers: { "x-apisports-key": config.APIFOOTBALL_KEY },
      }
    );

    const fixtures = response.data.response;
    if (!fixtures || fixtures.length === 0) {
      console.log(
        "[Live Sync] No live or recently finished games found from the API for your configured leagues."
      );
      console.log("-----------------------------------------------------");
      return;
    }

    console.log(
      `[Live Sync] Fetched ${fixtures.length} live/finished fixtures from API.`
    );
    let updatedCount = 0;
    let settledCount = 0;

    for (const fixture of fixtures) {
      const externalApiId = `apif_${fixture.fixture.id}`;
      const game = await Game.findOne({ externalApiId });

      if (!game) {
        console.warn(
          `[Live Sync] Warning: Found live fixture for a game not in the DB (ID: ${externalApiId}). It might be a new game from a league you recently added.`
        );
        continue;
      }

      const newStatus = fixture.fixture.status.short;
      const homeGoals = fixture.goals.home;
      const awayGoals = fixture.goals.away;
      const scoreHasChanged =
        game.scores.home !== homeGoals || game.scores.away !== awayGoals;

      // Case 1: Game has finished
      if (newStatus === "FT" && game.status !== "finished") {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
          game.status = "finished";
          game.scores.home = homeGoals;
          game.scores.away = awayGoals;

          if (homeGoals > awayGoals) game.result = "A";
          else if (awayGoals > homeGoals) game.result = "B";
          else game.result = "Draw";

          await game.save({ session });
          await resolveBetsForGame(game, session, io);
          await session.commitTransaction();

          settledCount++;
          console.log(
            `[Live Sync] ✅ Game Finished & Settled: ${game.homeTeam} vs ${game.awayTeam}`
          );
          io.emit("gameResultUpdated", {
            gameId: game._id,
            result: game.result,
            status: game.status,
          });
        } catch (error) {
          await session.abortTransaction();
          console.error(
            `[Live Sync] Error settling game ${game._id}:`,
            error.message
          );
        } finally {
          session.endSession();
        }
      }
      // Case 2: Game is live and the status or score has changed
      else if (
        LIVE_STATUSES.has(newStatus) &&
        (game.status !== "live" || scoreHasChanged)
      ) {
        game.status = "live";
        game.scores.home = homeGoals;
        game.scores.away = awayGoals;
        game.elapsedTime = fixture.fixture.status.elapsed;

        // ** Generate and update live odds **
        const newLiveOdds = await generateLiveOdds(game);
        if (newLiveOdds) {
          game.odds = newLiveOdds; // Update the main odds object
          console.log(
            `[Live Odds] AI updated odds for ${game.homeTeam} vs ${game.awayTeam}:`,
            newLiveOdds
          );
          io.emit("liveOddsUpdate", { gameId: game._id, odds: newLiveOdds });
        }

        await game.save();
        updatedCount++;
        console.log(
          `[Live Sync] ⚽ Score Update: ${game.homeTeam} ${game.scores.home} - ${game.scores.away} ${game.awayTeam}`
        );
        io.emit("gameUpdate", game);
      }
    }

    if (updatedCount > 0 || settledCount > 0) {
      console.log(
        `[Live Sync] Summary: ${updatedCount} games updated, ${settledCount} games settled.`
      );
    } else {
      console.log(
        "[Live Sync] No changes to game statuses or scores were needed."
      );
    }
  } catch (error) {
    if (error.response) {
      console.error(
        `[Live Sync] Error fetching live/finished games. Status: ${error.response.status}, Data:`,
        error.response.data
      );
    } else {
      console.error(
        "[Live Sync] Error fetching live/finished games:",
        error.message
      );
    }
  }
  console.log("-----------------------------------------------------");
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
              season: new Date().getFullYear(), // Use current year for the season
              from: fromDateStr,
              to: toDateStr,
              status: "NS", // Not Started
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

const providers = {
  apifootball: apiFootballProvider,
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
