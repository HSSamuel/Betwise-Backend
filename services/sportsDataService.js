const axios = require("axios");
const mongoose = require("mongoose");
const Game = require("../models/Game");
const { generateOddsForGame } = require("./oddsService");
const { resolveBetsForGame } = require("./betResolutionService");
const config = require("../config/env");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const axiosWithRetry = async (config, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios(config);
    } catch (error) {
      // Check if the error is a network error that's worth retrying
      if (error.code === "ECONNRESET" || error.code === "ETIMEDOUT") {
        console.warn(
          `⚠️ Network error (${
            error.code
          }) detected. Retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`
        );
        await sleep(delay);
      } else {
        // For other errors (like 4xx or 5xx responses), throw immediately
        throw error;
      }
    }
  }
  // If all retries fail, throw the last error
  throw new Error(`Failed to fetch data after ${retries} attempts.`);
};

const fetchFromTheSportsDB = async () => {
  const apiKey = config.X_RAPIDAPI_KEY;
  if (!apiKey) {
    console.error("❌ X_RAPIDAPI_KEY (for TheSportsDB) is not defined.");
    return;
  }
  console.log("ℹ️ Starting game sync with TheSportsDB via RapidAPI...");

  const leagueIds = ["4328", "4335", "4332", "4331", "4334"];
  let totalGamesProcessed = 0;

  for (const leagueId of leagueIds) {
    try {
      const options = {
        method: "GET",
        url: `https://thesportsdb.p.rapidapi.com/eventsnextleague.php`,
        params: { id: leagueId },
        headers: {
          "X-RapidAPI-Key": apiKey,
          "X-RapidAPI-Host": "thesportsdb.p.rapidapi.com",
        },
      };

      const response = await axiosWithRetry(options);

      const events = response.data.events;
      if (!events) continue;

      for (const event of events) {
        if (event.strSport !== "Soccer") continue;
        const odds = await generateOddsForGame(
          event.strHomeTeam,
          event.strAwayTeam
        );
        const gameData = {
          homeTeam: event.strHomeTeam,
          awayTeam: event.strAwayTeam,
          homeTeamLogo: event.strHomeTeamBadge,
          awayTeamLogo: event.strAwayTeamBadge,
          matchDate: new Date(
            `${event.dateEvent}T${event.strTime || "12:00:00"}`
          ),
          league: event.strLeague,
          odds,
          externalApiId: `tsdb_${event.idEvent}`,
          status: "upcoming",
        };
        await Game.findOneAndUpdate(
          { externalApiId: gameData.externalApiId },
          { $set: gameData },
          { upsert: true, new: true }
        );
        totalGamesProcessed++;
      }
    } catch (error) {
      console.error(
        `❌ Error fetching from TheSportsDB for league ${leagueId}:`,
        error.message
      );
    }
    await sleep(1000);
  }
  console.log(
    `✅ TheSportsDB Sync complete. Processed ${totalGamesProcessed} games.`
  );
};

const fetchFromApiFootball = async () => {
  const apiKey = config.APIFOOTBALL_KEY;
  if (!apiKey) {
    console.error("❌ APIFOOTBALL_KEY is not defined.");
    return;
  }
  console.log("ℹ️ Starting game sync with API-Football...");

  let totalGamesProcessed = 0;
  const currentSeason = new Date().getFullYear();
  const leagueIds = ["39", "140", "135", "78", "61"];

  const today = new Date();
  const toDate = new Date();
  toDate.setDate(today.getDate() + 7);

  const formatDate = (date) => date.toISOString().split("T")[0];

  for (const leagueId of leagueIds) {
    try {
      const config = {
        method: "get",
        url: `https://v3.football.api-sports.io/fixtures`,
        params: {
          league: leagueId,
          season: currentSeason,
          from: formatDate(today),
          to: formatDate(toDate),
        },
        headers: { "x-apisports-key": apiKey },
      };

      const response = await axiosWithRetry(apiConfig);

      const fixtures = response.data.response;
      if (!fixtures || fixtures.length === 0) continue;

      for (const fixture of fixtures) {
        if (fixture.fixture.status.short !== "NS") continue;

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
        totalGamesProcessed++;
      }
    } catch (error) {
      console.error(
        `❌ Error fetching from API-Football for league ${leagueId}:`,
        error.message
      );
    }
  }
  console.log(
    `✅ API-Football Sync complete. Processed ${totalGamesProcessed} games.`
  );
};

const syncGames = async (source = "apifootball") => {
  if (source === "thesportsdb") {
    await fetchFromTheSportsDB();
  } else {
    await fetchFromApiFootball();
  }
};

const mapApiStatus = (apiStatus) => {
  const finished_statuses = ["FT", "AET", "PEN"];
  if (finished_statuses.includes(apiStatus)) return "finished";
  if (apiStatus === "PST") return "postponed";
  const live_statuses = ["1H", "HT", "2H", "ET", "P", "LIVE", "INTR"];
  if (live_statuses.includes(apiStatus)) return "live";
  return "upcoming";
};

const getResultFromScore = (homeScore, awayScore) => {
  if (homeScore > awayScore) return "A";
  if (awayScore > homeScore) return "B";
  return "Draw";
};

const syncLiveGames = async (io) => {
  const apiKey = config.APIFOOTBALL_KEY;
  if (!apiKey) {
    console.error("❌ APIFOOTBALL_KEY is not defined. Cannot sync live games.");
    return;
  }

  // --- THIS IS THE FIX ---
  // The query now looks for games that are either already live OR are upcoming
  // but their match date has passed, meaning they should be live.
  const gamesToUpdate = await Game.find({
    $or: [
      { status: "live" },
      { status: "upcoming", matchDate: { $lte: new Date() } },
    ],
  });
  // --- END OF FIX ---

  if (gamesToUpdate.length === 0) {
    return;
  }

  const gameIds = gamesToUpdate
    .map((game) => game.externalApiId.split("_")[1])
    .join("-");

  try {
    const config = {
      method: "get",
      url: `https://v3.football.api-sports.io/fixtures?ids=${gameIds}`,
      headers: { "x-apisports-key": apiKey },
    };

    const response = await axiosWithRetry(apiConfig);

    const liveFixtures = response.data.response;

    for (const liveFixture of liveFixtures) {
      const game = gamesToUpdate.find(
        (g) => g.externalApiId === `apif_${liveFixture.fixture.id}`
      );
      if (!game) continue;

      let hasChanged = false;
      const newStatus = mapApiStatus(liveFixture.fixture.status.short);

      if (
        game.scores.home !== liveFixture.goals.home ||
        game.scores.away !== liveFixture.goals.away ||
        game.elapsedTime !== liveFixture.fixture.status.elapsed ||
        game.status !== newStatus
      ) {
        hasChanged = true;
        game.scores.home = liveFixture.goals.home;
        game.scores.away = liveFixture.goals.away;
        game.elapsedTime = liveFixture.fixture.status.elapsed;
        game.status = newStatus;

        if (newStatus === "finished") {
          game.result = getResultFromScore(
            liveFixture.goals.home,
            liveFixture.goals.away
          );
        }
      }

      if (hasChanged) {
        const updatedGame = await game.save();
        console.log(
          `UPDATED: ${updatedGame.homeTeam} ${updatedGame.scores.home} - ${updatedGame.scores.away} ${updatedGame.awayTeam}`
        );
        io.emit("gameUpdate", updatedGame);

        if (updatedGame.status === "finished") {
          console.log(`SETTLING BETS for finished game: ${updatedGame._id}`);
          const session = await mongoose.startSession();
          session.startTransaction();
          try {
            await resolveBetsForGame(updatedGame, session);
            await session.commitTransaction();
          } catch (error) {
            await session.abortTransaction();
            console.error(
              `Error resolving bets for game ${updatedGame._id}:`,
              error
            );
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

module.exports = { syncGames, syncLiveGames };