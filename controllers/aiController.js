const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { body, validationResult } = require("express-validator");
const Game = require("../models/Game");
const Bet = require("../models/Bet");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Withdrawal = require("../models/Withdrawal");
const bettingService = require("../services/bettingService");
const {
  generateRecommendations,
} = require("../services/recommendationService");

// This global variable will hold the initialized AI client.
let genAI;

try {
  if (!process.env.GEMINI_API_KEY) {
    console.error(
      "GEMINI_API_KEY is not defined. AI features will be disabled."
    );
  } else {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
} catch (e) {
  console.error("Could not initialize GoogleGenerativeAI. Check API Key.", e);
}

const formatTransactionsForPrompt = (transactions) => {
  if (!transactions || transactions.length === 0)
    return "No recent transactions found.";
  return transactions
    .map(
      (t, index) =>
        `${index + 1}. Type: ${t.type}, Amount: $${t.amount.toFixed(
          2
        )}, Date: ${t.createdAt.toDateString()}`
    )
    .join("\n  ");
};

const formatBetsForPrompt = (bets) => {
  if (!bets || bets.length === 0) return "No recent bets found.";
  return bets
    .map((bet, index) => {
      const betDetails =
        bet.selections && bet.selections.length > 0
          ? bet.selections
              .map((s) =>
                s.game
                  ? `${s.game.homeTeam} vs ${s.game.awayTeam} (Your pick: ${s.outcome})`
                  : "[Game data unavailable]"
              )
              .join(" | ")
          : "Details unavailable";
      return `${index + 1}. Stake: $${bet.stake.toFixed(2)}, Status: ${
        bet.status
      }, Details: ${betDetails}`;
    })
    .join("\n  ");
};

const formatResultsForPrompt = (games) => {
  if (!games || games.length === 0)
    return "No recent results found in the database.";
  return games
    .map(
      (game) =>
        `- ${game.homeTeam} ${game.scores.home} - ${game.scores.away} ${
          game.awayTeam
        } (League: ${game.league}, Date: ${game.matchDate.toDateString()})`
    )
    .join("\n  ");
};

// --- NEW HELPER FUNCTION 1 ---
const getLiveScoreUpdate = async (teamName) => {
  if (!teamName) return null;

  const teamRegex = new RegExp(teamName, "i");
  const liveGame = await Game.findOne({
    status: "live",
    $or: [{ homeTeam: teamRegex }, { awayTeam: teamRegex }],
  }).lean();

  if (liveGame) {
    return `The current score is: ${liveGame.homeTeam} ${liveGame.scores.home} - ${liveGame.scores.away} ${liveGame.awayTeam} (${liveGame.elapsedTime}' elapsed).`;
  }

  return null;
};

// --- NEW HELPER FUNCTION 2 ---
const getGameOddsInfo = async (teamName) => {
  if (!teamName) return null;

  const teamRegex = new RegExp(teamName, "i");
  const upcomingGame = await Game.findOne({
    status: "upcoming",
    $or: [{ homeTeam: teamRegex }, { awayTeam: teamRegex }],
  }).lean();

  if (upcomingGame) {
    return `Here are the odds for ${upcomingGame.homeTeam} vs ${
      upcomingGame.awayTeam
    }:
- ${upcomingGame.homeTeam} (Home Win): ${upcomingGame.odds.home.toFixed(2)}
- Draw: ${upcomingGame.odds.draw.toFixed(2)}
- ${upcomingGame.awayTeam} (Away Win): ${upcomingGame.odds.away.toFixed(2)}`;
  }

  return null;
};

// --- NEW HELPER FUNCTION 3 ---
const findGamesByLeague = async (leagueName) => {
  if (!leagueName) return null;

  const leagueRegex = new RegExp(leagueName.replace("league", "").trim(), "i");
  const games = await Game.find({
    status: "upcoming",
    league: leagueRegex,
  })
    .sort({ matchDate: 1 })
    .limit(5)
    .lean();

  if (games.length > 0) {
    const gameList = games
      .map((game) => `- ${game.homeTeam} vs ${game.awayTeam}`)
      .join("\n");
    return `Here are some upcoming games in the ${games[0].league}:\n${gameList}`;
  }

  return `I couldn't find any upcoming games for the "${leagueName}".`;
};

exports.validateNewsQuery = [
  body("topic")
    .trim()
    .notEmpty()
    .withMessage("A topic (team or player name) is required.")
    .isLength({ min: 3, max: 50 })
    .withMessage("Topic must be between 3 and 50 characters."),
];

exports.validateAnalyzeGame = [
  body("gameId").isMongoId().withMessage("A valid gameId is required."),
];

// Corrected main chat handler function
exports.handleChat = async (req, res, next) => {
  try {
    if (!genAI) throw new Error("AI Service not initialized. Check API Key.");

    let { message, history = [], context = null } = req.body;
    context = context || {};
    if (!message) {
      return res.status(400).json({ msg: 'A "message" field is required.' });
    }
    const user = await User.findById(req.user._id).lean();

    // First, check for bet confirmation
    if (context.conversationState === "confirming_bet") {
      if (
        ["yes", "y", "correct", "ok", "yep"].includes(
          message.toLowerCase().trim()
        )
      ) {
        const betData = context.betSlip;
        await bettingService.placeSingleBet(
          user._id,
          betData.gameId,
          betData.outcome,
          betData.stake
        );
        return res.json({
          reply: "I've placed that bet for you! Good luck!",
          context: {},
        });
      } else {
        return res.json({
          reply: "Okay, I've cancelled that bet. Anything else?",
          context: {},
        });
      }
    }

    // Next, check for Live Score requests
    const scoreKeywords = ["score", "who is winning", "what's the score"];
    if (
      scoreKeywords.some((keyword) => message.toLowerCase().includes(keyword))
    ) {
      const teamMatch = message.match(
        /(?:in the|for the|on the|of the|on)\s+([A-Za-z\s]+)\s+game/i
      );
      const teamName = teamMatch ? teamMatch[1] : message.split(" ").pop();

      const scoreUpdate = await getLiveScoreUpdate(
        teamName.replace("game", "").trim()
      );
      if (scoreUpdate) {
        return res.json({ reply: scoreUpdate, context: {} });
      }
    }

    // Check for Odds requests
    const oddsKeywords = ["odds", "what are the odds"];
    if (
      oddsKeywords.some((keyword) => message.toLowerCase().includes(keyword))
    ) {
      const teamMatch =
        message.match(/(?:for|on)\s+([A-Za-z\s]+)\s+match/i) ||
        message.match(/(?:for|on)\s+([A-Za-z\s]+)/i);
      const teamName = teamMatch ? teamMatch[1] : null;

      const oddsInfo = await getGameOddsInfo(teamName);
      if (oddsInfo) {
        return res.json({ reply: oddsInfo, context: {} });
      }
    }

    // Check for League Game requests
    const leagueKeywords = ["games in the", "matches in the", "league games"];
    if (
      leagueKeywords.some((keyword) => message.toLowerCase().includes(keyword))
    ) {
      const leagueMatch = message.match(
        /(?:in the|in)\s+([A-Za-z\s]+ league)/i
      );
      const leagueName = leagueMatch ? leagueMatch[1] : null;

      if (leagueName) {
        const leagueGamesResponse = await findGamesByLeague(leagueName);
        return res.json({ reply: leagueGamesResponse, context: {} });
      }
    }

    // If it's not any of the above, try to parse the message as a bet intent
    const betIntentResult = await exports.parseBetIntent(
      { body: { text: message } },
      res,
      next
    );

    if (res.headersSent) return;

    if (betIntentResult && betIntentResult.isBetIntent) {
      return res.json({
        reply: betIntentResult.reply,
        context: betIntentResult.context,
      });
    }

    // If nothing else matches, proceed with general conversation
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const recentBets = await Bet.find({ user: user._id })
      .sort({ createdAt: -1 })
      .limit(3)
      .populate("selections.game", "homeTeam awayTeam")
      .lean();
    const recentTransactions = await Transaction.find({ user: user._id })
      .sort({ createdAt: -1 })
      .limit(3)
      .lean();
    const pendingWithdrawal = await Withdrawal.findOne({
      user: user._id,
      status: "pending",
    }).lean();
    const withdrawalStatus = pendingWithdrawal
      ? `Yes, $${pendingWithdrawal.amount.toFixed(2)} is pending.`
      : "No.";
    const recentResults = await Game.find({ status: "finished" })
      .sort({ matchDate: -1 })
      .limit(10)
      .lean();

    const systemPrompt = `You are "BetWise AI", a friendly and helpful assistant for a sports betting app. The user is "${
      user.username
    }". Your role is purely conversational. Do not try to parse bets or return JSON. Just chat naturally.
      
        ### LIVE DATA FOR THIS USER (for context):
        - Wallet Balance: $${user.walletBalance.toFixed(2)}
        - Recent Bets: ${formatBetsForPrompt(recentBets)}
        - Recent Transactions: ${formatTransactionsForPrompt(
          recentTransactions
        )}
        - Pending Withdrawal: ${withdrawalStatus}
        
        Now, respond to the user's message: "${message}"`;

    const result = await model.generateContent(systemPrompt);
    const rawAiText = result.response.text();

    return res.json({
      reply: rawAiText.replace(/```/g, "").trim(),
      context: {},
    });
  } catch (error) {
    console.error("AI chat handler error:", error);
    next(error);
  }
};

// All other exported functions from aiController.js remain the same...
// (parseBetIntent, generateGameSummary, analyzeGame, getBettingFeedback, etc.)

exports.parseBetIntent = async (req, res, next) => {
  try {
    if (!genAI) throw new Error("AI Service not initialized. Check API Key.");
    const { text } = req.body;
    if (!text) {
      // Return a specific structure that the caller can check
      return { isBetIntent: false };
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `From the user's text, extract betting information into a valid JSON object. The JSON must have "stake" (number), and "teamToBetOn" (string).
          Here are some examples:
          - User text: "I want to put 500 on manchester united to win"
          - JSON: { "stake": 500, "teamToBetOn": "Manchester United" }
          - User text: "bet $25 on Real Madrid"
          - JSON: { "stake": 25, "teamToBetOn": "Real Madrid" }
          - User text: "Can you place a hundred on chelsea for me"
          - JSON: { "stake": 100, "teamToBetOn": "Chelsea" }
          Now, analyze this user's text and return only the JSON object: "${text}"`;

    const result = await model.generateContent(prompt);
    const rawAiText = result.response.text();

    const jsonMatch = rawAiText.match(/\{[\s\S]*\}/);
    if (!jsonMatch || !jsonMatch[0]) {
      return { isBetIntent: false };
    }

    const intent = JSON.parse(jsonMatch[0]);
    if (!intent.stake || !intent.teamToBetOn) {
      return { isBetIntent: false };
    }

    const teamToBetOnRegex = new RegExp(intent.teamToBetOn, "i");
    const game = await Game.findOne({
      status: "upcoming",
      $or: [{ homeTeam: teamToBetOnRegex }, { awayTeam: teamToBetOnRegex }],
    });

    if (game) {
      const outcome = game.homeTeam
        .toLowerCase()
        .includes(intent.teamToBetOn.toLowerCase())
        ? "A"
        : "B";

      const context = {
        conversationState: "confirming_bet",
        betSlip: {
          gameId: game._id,
          stake: intent.stake,
          outcome,
          oddsAtTimeOfBet: game.odds,
        },
      };

      return {
        isBetIntent: true,
        reply: `I found a match: ${game.homeTeam} vs ${game.awayTeam}. You want to bet $${intent.stake} on ${intent.teamToBetOn} to win. Is this correct? (yes/no)`,
        context,
      };
    }
    return {
      isBetIntent: false,
      reply: `I couldn't find an upcoming game for ${intent.teamToBetOn}.`,
    };
  } catch (error) {
    console.error("AI parseBetIntent error:", error);
    // In case of an error, it's not a valid bet intent
    return { isBetIntent: false };
  }
};

// The rest of your functions (generateGameSummary, analyzeGame, etc.) go here...
exports.generateGameSummary = async (homeTeam, awayTeam, league) => {
  try {
    if (!genAI) throw new Error("AI Service not initialized. Check API Key.");
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `You are a sports writer for a betting app called "BetWise". Write a short, exciting, and neutral 1-2 sentence match preview for an upcoming game in the "${league}" between "${homeTeam}" (home) and "${awayTeam}" (away). Do not predict a winner.`;
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.error("Error generating game summary:", error);
    return "A highly anticipated match is coming up.";
  }
};

exports.analyzeGame = async (req, res, next) => {
  try {
    if (!genAI) throw new Error("AI Service not initialized. Check API Key.");
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { gameId } = req.body;
    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ msg: "Game not found." });
    }
    if (game.status !== "upcoming") {
      return res
        .status(400)
        .json({ msg: "AI analysis is only available for upcoming games." });
    }
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Provide a brief, data-driven analysis for the upcoming match between ${game.homeTeam} and ${game.awayTeam}. Focus on recent form or key matchups. Do not predict a winner. Keep it to 2-3 sentences.`;
    const result = await model.generateContent(prompt);
    res.status(200).json({ analysis: result.response.text().trim() });
  } catch (error) {
    console.error("AI game analysis error:", error);
    next(error);
  }
};

exports.getBettingFeedback = async (req, res, next) => {
  try {
    if (!genAI) throw new Error("AI Service not initialized. Check API Key.");
    const userId = req.user._id;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentBets = await Bet.find({
      user: userId,
      createdAt: { $gte: sevenDaysAgo },
    });

    if (recentBets.length === 0) {
      return res.status(200).json({
        feedback:
          "You haven't placed any bets in the last 7 days. Remember to always play responsibly.",
      });
    }

    const totalStaked = recentBets.reduce((sum, bet) => sum + bet.stake, 0);
    const betCount = recentBets.length;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `You are a caring and non-judgmental responsible gambling assistant. A user named ${
      req.user.username
    } has asked for feedback. Their data for the last 7 days: ${betCount} bets totaling $${totalStaked.toFixed(
      2
    )}. Based on this, provide a short, supportive message. If activity seems high (e.g., >15 bets or >$500), gently suggest considering tools like setting limits. Do not give financial advice. Focus on well-being.`;
    const result = await model.generateContent(prompt);
    res.status(200).json({ feedback: result.response.text().trim() });
  } catch (error) {
    console.error("AI betting feedback error:", error);
    next(error);
  }
};

exports.generateLimitSuggestion = async (req, res, next) => {
  try {
    if (!genAI) throw new Error("AI Service not initialized. Check API Key.");
    const userId = req.user._id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const recentBets = await Bet.find({
      user: userId,
      createdAt: { $gte: thirtyDaysAgo },
    });

    if (recentBets.length < 5) {
      return res.status(200).json({
        suggestion:
          "We need a bit more betting history before we can suggest personalized limits. Keep playing responsibly!",
      });
    }

    const totalStaked = recentBets.reduce((sum, bet) => sum + bet.stake, 0);
    const averageWeeklyStake = (totalStaked / 4.28).toFixed(0);
    const averageWeeklyBetCount = (recentBets.length / 4.28).toFixed(0);

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `
            You are a caring and supportive responsible gambling assistant for "BetWise".
            A user named "${req.user.username}" has asked for a weekly limit suggestion.
            Their average activity over the last 30 days is:
            - Average weekly bet count: ~${averageWeeklyBetCount} bets
            - Average weekly amount staked: ~$${averageWeeklyStake}
  
            Your task is to generate a short, helpful, and non-judgmental message suggesting weekly limits based on their average activity.
            - Suggest a bet count limit slightly above their average (e.g., average + 5).
            - Suggest a stake amount limit slightly above their average (e.g., average + 25%).
            - Frame it as a helpful tool for staying in control.
            - Do NOT be alarming or give financial advice.
        `;

    const result = await model.generateContent(prompt);
    const suggestionText = result.response.text().trim();

    res.status(200).json({
      suggestion: suggestionText,
      suggestedLimits: {
        betCount: Math.ceil(averageWeeklyBetCount / 5) * 5 + 5,
        stakeAmount: Math.ceil((averageWeeklyStake * 1.25) / 10) * 10,
      },
    });
  } catch (error) {
    console.error("AI limit suggestion error:", error);
    next(error);
  }
};

exports.searchGamesWithAI = async (req, res, next) => {
  try {
    if (!genAI) throw new Error("AI Service not initialized. Check API Key.");
    const { query } = req.body;
    if (!query) {
      const err = new Error("A search query is required.");
      err.statusCode = 400;
      return next(err);
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
        You are an intelligent search assistant for a betting app.
        Analyze the user's search query: "${query}"
        Your task is to return a JSON object with any of the following keys you can identify: 'team', 'league', or 'date'.
        - For 'team', extract the full team name.
        - For 'league', extract the league name.
        - For 'date', extract only one of the keywords: "today", "tomorrow", or an "YYYY-MM-DD" formatted date if specified.
        - If you cannot identify a parameter, omit its key from the JSON object.
  
        Examples:
        - Query: "Real Madrid games" -> {"team": "Real Madrid"}
        - Query: "Show me premier league matches today" -> {"league": "Premier League", "date": "today"}
        - Query: "who is barcelona playing on 2025-06-25" -> {"team": "Barcelona", "date": "2025-06-25"}
        - Query: "tomorrow's games" -> {"date": "tomorrow"}
  
        Return ONLY the JSON object.
      `;

    const result = await model.generateContent(prompt);
    const rawAiText = result.response.text();
    const jsonMatch = rawAiText.match(/\{[\s\S]*\}/);

    if (!jsonMatch || !jsonMatch[0]) {
      throw new Error("AI could not process the search query.");
    }

    const params = JSON.parse(jsonMatch[0]);
    const filter = { status: "upcoming" };

    if (params.team) {
      const teamRegex = new RegExp(params.team, "i");
      filter.$or = [{ homeTeam: teamRegex }, { awayTeam: teamRegex }];
    }
    if (params.league) {
      filter.league = { $regex: new RegExp(params.league, "i") };
    }

    if (params.date) {
      let targetDate;
      if (params.date === "today") {
        targetDate = new Date();
      } else if (params.date === "tomorrow") {
        targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + 1);
      } else {
        targetDate = new Date(params.date);
      }

      if (!isNaN(targetDate.getTime())) {
        const startDate = new Date(targetDate.setHours(0, 0, 0, 0));
        const endDate = new Date(targetDate.setHours(23, 59, 59, 999));
        filter.matchDate = { $gte: startDate, $lte: endDate };
      }
    }

    const games = await Game.find(filter).limit(20).sort({ matchDate: 1 });

    res.status(200).json({
      message: `Found ${games.length} games matching your search.`,
      games: games,
    });
  } catch (error) {
    next(error);
  }
};

exports.getNewsSummary = async (req, res, next) => {
  try {
    if (!genAI) throw new Error("AI Service not initialized. Check API Key.");
    const { topic } = req.body;
    const apiKey = process.env.GOOGLE_API_KEY;
    const cseId = process.env.GOOGLE_CSE_ID;

    if (!apiKey || !cseId) {
      throw new Error(
        "Google Search API Key or CSE ID is not configured on the server."
      );
    }

    const searchUrl = `[https://www.googleapis.com/customsearch/v1?key=$](https://www.googleapis.com/customsearch/v1?key=$){apiKey}&cx=${cseId}&q=${encodeURIComponent(
      topic + " football news"
    )}`;

    const searchResponse = await axios.get(searchUrl);

    if (!searchResponse.data.items || searchResponse.data.items.length === 0) {
      return res.status(404).json({
        summary: `Sorry, I couldn't find any recent news for "${topic}".`,
      });
    }

    const context = searchResponse.data.items
      .map((item) => item.snippet)
      .join("\n\n");

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `
        You are a sports news analyst for the BetWise app.
        Based only on the following context, provide a brief, neutral, 2-4 sentence summary about "${topic}".
        Mention recent form, injuries, or significant transfer news found in the text.
        Do not invent information.
  
        CONTEXT:
        ---
        ${context}
      `;

    const result = await model.generateContent(prompt);
    const summaryText = result.response.text().trim();

    res.status(200).json({ summary: summaryText });
  } catch (error) {
    next(error);
  }
};

let newsCache = { data: null, timestamp: null };
const CACHE_DURATION_MS = 3600000;

exports.getGeneralSportsNews = async (req, res, next) => {
  try {
    const now = Date.now();
    if (newsCache.data && now - newsCache.timestamp < CACHE_DURATION_MS) {
      return res.status(200).json(newsCache.data);
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    const cseId = process.env.GOOGLE_CSE_ID;
    if (!apiKey || !cseId) {
      throw new Error("Google Search API Key or CSE ID is not configured.");
    }
    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=top+world+football+news`;
    const searchResponse = await axios.get(searchUrl);
    if (!searchResponse.data.items || searchResponse.data.items.length === 0) {
      return res
        .status(404)
        .json({ message: "Could not find any recent sports news." });
    }
    const newsItems = searchResponse.data.items.slice(0, 5).map((item) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      source: item.displayLink,
    }));
    const responseData = { news: newsItems };
    newsCache = { data: responseData, timestamp: now };
    res.status(200).json(responseData);
  } catch (error) {
    next(error);
  }
};

exports.getRecommendedGames = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const recommendations = await generateRecommendations(userId);
    res.status(200).json({
      message: "Successfully fetched personalized game recommendations.",
      games: recommendations,
    });
  } catch (error) {
    console.error("Error in getRecommendedGames:", error);
    next(error);
  }
};
