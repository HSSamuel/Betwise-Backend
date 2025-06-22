const axios = require("axios");
const mongoose = require("mongoose");
const Game = require("../models/Game");
const { generateOddsForGame } = require("./oddsService");
const config = require("../config/env");

// --- Provider for API-Football ---
const apiFootballProvider = {
  name: "API-Football",
  enabled: !!config.APIFOOTBALL_KEY,

  async syncUpcomingGames() {
    if (!this.enabled) return;
    console.log(`[${this.name}] Fetching upcoming games...`);

    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 7);
    const fromDateStr = new Date().toISOString().split("T")[0];
    const toDateStr = toDate.toISOString().split("T")[0];
    const leagueIds = [
      // Already included major leagues
      "39", // Premier League (England)
      "140", // La Liga (Spain)
      "135", // Serie A (Italy)
      "78", // Bundesliga (Germany)
      "61", // Ligue 1 (France)

      // Expanded additions
      "2", // UEFA Champions League
      "3", // UEFA Europa League
      "848", // UEFA Europa Conference League
      "210", // FIFA Club World Cup
      "1", // World Cup (FIFA)
      "135", // Serie A (Italy)
      "262", // African Nations Championship (CHAN)
      "203", // CAF Champions League
      "266", // CAF Confederation Cup
      "302", // NPFL (Nigeria Premier Football League)
      "94", // MLS (USA)
      "253", // Saudi Pro League
      "256", // Qatar Stars League
      "195", // Brasileiro Série A (Brazil)
      "129", // Argentine Primera División
      "88", // Eredivisie (Netherlands)
      "144", // Portuguese Primeira Liga
      "292", // Indian Super League
    ];

    for (const leagueId of leagueIds) {
      try {
        const response = await axios.get(
          `https://v3.football.api-sports.io/fixtures`,
          {
            params: {
              league: leagueId,
              season: new Date().getFullYear(),
              from: fromDateStr,
              to: toDateStr,
              status: "NS",
            },
            headers: { "x-apisports-key": config.APIFOOTBALL_KEY },
          }
        );

        if (!response || !response.data.response) continue;

        for (const fixture of response.data.response) {
          // Inner try...catch to handle errors for a single game
          try {
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
              { upsert: true }
            );
          } catch (singleGameError) {
            console.error(
              `[${this.name}] Skipping game due to error: ${fixture.fixture.id}`,
              singleGameError.message
            );
          }
        }
      } catch (error) {
        console.error(
          `[${this.name}] Failed to fetch league ${leagueId}:`,
          error.message
        );
      }
    }
    console.log(`[${this.name}] Finished syncing upcoming games.`);
  },
};

// --- Provider for TheSportsDB ---
const theSportsDbProvider = {
  name: "TheSportsDB",
  enabled: !!config.X_RAPIDAPI_KEY,

  async syncUpcomingGames() {
    if (!this.enabled) return;
    console.log(`[${this.name}] Fetching upcoming games...`);

    const leagueIds = [
      "4328", // English Premier League
      "4335", // Spanish La Liga
      "4332", // Italian Serie A
      "4331", // German Bundesliga
      "4334", // French Ligue 1
      "4480", // UEFA Champions League
      "4484", // UEFA Europa League
      "4491", // FIFA World Cup
      "4504", // FIFA Club World Cup
      "4346", // Dutch Eredivisie
      "4344", // Portuguese Primeira Liga
      "4347", // Turkish Super Lig
      "4396", // MLS (USA)
      "4351", // Argentine Primera División
      "4354", // Brasileiro Série A (Brazil)
      "4393", // Indian Super League
      "4482", // CAF Champions League
      "4483", // AFC Champions League
      "4340", // Scottish Premiership
      "4356", // Belgian Pro League
    ];

    for (const leagueId of leagueIds) {
      try {
        const response = await axios.get(
          `https://thesportsdb.p.rapidapi.com/eventsnextleague.php`,
          {
            params: { l: leagueId },
            headers: {
              "x-rapidapi-host": "thesportsdb.p.rapidapi.com",
              "x-rapidapi-key": config.X_RAPIDAPI_KEY,
            },
          }
        );

        if (!response || !response.data || !response.data.events) continue;

        for (const event of response.data.events) {
          try {
            if (
              !event.strHomeTeam ||
              !event.strAwayTeam ||
              !event.dateEvent ||
              !event.strTime
            ) {
              throw new Error("Incomplete event data from API.");
            }
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
              league: event.strLeague,
              odds,
              externalApiId: `tsdb_${event.idEvent}`,
              status: "upcoming",
            };
            await Game.findOneAndUpdate(
              { externalApiId: gameData.externalApiId },
              { $set: gameData },
              { upsert: true }
            );
          } catch (singleGameError) {
            console.error(
              `[${this.name}] Skipping event due to error: ${event.idEvent}`,
              singleGameError.message
            );
          }
        }
      } catch (error) {
        console.error(
          `[${this.name}] Failed to fetch league ${leagueId}:`,
          error.message
        );
      }
    }
    console.log(`[${this.name}] Finished syncing upcoming games.`);
  },
};

// --- Main Service ---
const providers = {
  apifootball: apiFootballProvider,
  thesportsdb: theSportsDbProvider,
};

const syncGames = async (source = "apifootball") => {
  const provider = providers[source.toLowerCase()];
  if (provider && provider.enabled) {
    await provider.syncUpcomingGames();
  } else {
    throw new Error(
      `[syncGames] Provider "${source}" is not enabled or does not exist.`
    );
  }
};

module.exports = { syncGames };
