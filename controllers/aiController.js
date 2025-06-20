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

// --- Controller functions ---

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

exports.handleChat = async (req, res, next) => {
  try {
    if (!genAI) throw new Error("AI Service not initialized. Check API Key.");

    let { message, history = [], context = null } = req.body;
    context = context || {};
    if (!message) {
      return res.status(400).json({ msg: 'A "message" field is required.' });
    }
    const user = await User.findById(req.user._id).lean();
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // State machine for handling multi-turn conversations like confirming a bet
    if (context.conversationState === "confirming_bet") {
      if (
        ["yes", "y", "correct", "ok", "yep"].includes(
          message.toLowerCase().trim()
        )
      ) {
        const betData = context.betSlip;
        await bettingService.placeSingleBetTransaction(
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

    // Fetch fresh data from the database to give the AI context
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

    // A much more detailed prompt for the AI
    const systemPrompt = `You are an advanced, multi-turn conversational AI for "BetWise". The user is "${
      user.username
    }". Your goal is to be helpful and accurate.
      CURRENT CONTEXT: ${JSON.stringify(context, null, 2)}
      USER'S LIVE DATA:
      - Wallet Balance: $${user.walletBalance.toFixed(2)}
      - Recent Bets: ${formatBetsForPrompt(recentBets)}
      - Recent Transactions: ${formatTransactionsForPrompt(recentTransactions)}
      - Pending Withdrawal: ${withdrawalStatus}
      RECENT GAME RESULTS:
      ${formatResultsForPrompt(recentResults)}
      YOUR TASK:
      1. Analyze the user's message: "${message}".
      2. If the user asks for a game result, check the "RECENT GAME RESULTS" list first. If the game is there, provide the score.
      3. Only if the result is NOT in the list, state you don't have the information.
      4. If you identify a bet intent, ask for confirmation and return a JSON with "newContext.conversationState": "confirming_bet" and a "betSlip".
      Return ONLY the JSON object.`;

    const result = await model.generateContent(systemPrompt);
    const rawAiText = result.response.text();
    const jsonMatch = rawAiText.match(/{[\s\S]*}/);

    if (!jsonMatch || !jsonMatch[0]) {
      return res.json({
        reply: "Sorry, I had a little trouble. Could you rephrase?",
        context,
      });
    }
    const aiResponse = JSON.parse(jsonMatch[0]);

    // If the AI identified a bet, find the game details before responding
    if (
      aiResponse.newContext?.conversationState === "confirming_bet" &&
      aiResponse.newContext.betSlip.teamToBetOn
    ) {
      const intent = aiResponse.newContext.betSlip;
      const teamRegex = new RegExp(intent.teamToBetOn, "i");
      const game = await Game.findOne({
        status: "upcoming",
        $or: [{ homeTeam: teamRegex }, { awayTeam: teamRegex }],
      });
      if (game) {
        aiResponse.newContext.betSlip = {
          gameId: game._id,
          stake: intent.stake,
          outcome: game.homeTeam.match(teamRegex) ? "A" : "B",
          oddsAtTimeOfBet: game.odds,
        };
      } else {
        aiResponse.reply = `I couldn't find an upcoming game for ${intent.teamToBetOn}.`;
        aiResponse.newContext = {};
      }
    }

    res.json({
      reply:
        aiResponse.reply ||
        "I'm not sure how to respond to that. Please try again.",
      context: aiResponse.newContext || {},
    });
  } catch (error) {
    console.error("AI chat handler error:", error);
    next(error);
  }
};

exports.parseBetIntent = async (req, res, next) => {
  try {
    if (!genAI) throw new Error("AI Service not initialized. Check API Key.");
    const { message: text } = req.body;
    if (!text) return null;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `From the user's text, extract betting information into a valid JSON object. The JSON object must have "stake" (number) and "teamToBetOn" (string).
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
    if (!jsonMatch || !jsonMatch[0]) return null;

    const intent = JSON.parse(jsonMatch[0]);
    if (!intent.stake || !intent.teamToBetOn) return null;

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
      return {
        reply: `I found a match: ${game.homeTeam} vs ${
          game.awayTeam
        }. You want to bet $${
          intent.stake
        } on ${intent.teamToBetOn.toLowerCase()} to win. Is this correct? (yes/no)`,
        betSlip: {
          gameId: game._id,
          gameDetails: { homeTeam: game.homeTeam, awayTeam: game.awayTeam },
          stake: intent.stake,
          outcome: outcome,
          oddsAtTimeOfBet: game.odds,
        },
      };
    }
    return null;
  } catch (error) {
    console.error("AI parseBetIntent error:", error);
    return null;
  }
};

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
    if (!genAI) throw new Error("AI Service not initialized.");
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { gameId } = req.body;
    const game = await Game.findById(gameId);
    if (!game) return res.status(404).json({ msg: "Game not found." });
    if (game.status !== "upcoming")
      return res
        .status(400)
        .json({ msg: "AI analysis is only available for upcoming games." });

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

    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(
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

// Caching logic remains the same
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
    if (!apiKey || !cseId)
      throw new Error("Google Search API Key or CSE ID is not configured.");

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
    console.error("General sports news error:", error.message);
    next(error);
  }
};
