const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { body, validationResult } = require("express-validator");
const Game = require("../models/Game");
const Bet = require("../models/Bet");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Withdrawal = require("../models/Withdrawal");
const bettingService = require("../services/bettingService");
const { fetchGeneralSportsNews } = require("../services/newsService");

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

const getGameResultInfo = async (teamName) => {
  if (!teamName) return null;

  const teamRegex = new RegExp(
    teamName.replace(/game|match/gi, "").trim(),
    "i"
  );
  const finishedGame = await Game.findOne({
    status: "finished",
    $or: [{ homeTeam: teamRegex }, { awayTeam: teamRegex }],
  })
    .sort({ matchDate: -1 })
    .lean();

  if (finishedGame) {
    return `The last match result for ${teamName} was: ${finishedGame.homeTeam} ${finishedGame.scores.home} - ${finishedGame.scores.away} ${finishedGame.awayTeam}.`;
  }

  return `I couldn't find a recent result for a team matching "${teamName}".`;
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

exports.handleChat = async (req, res, next) => {
  try {
    if (!genAI) throw new Error("AI Service not initialized. Check API Key.");

    let { message, history = [], context = null } = req.body;
    context = context || {};
    if (!message) {
      return res.status(400).json({ msg: 'A "message" field is required.' });
    }
    const user = await User.findById(req.user._id).lean();
    const lowerCaseMessage = message.toLowerCase();

    // 1. Handle bet confirmations first (stateful)
    if (context.conversationState === "confirming_bet") {
      if (
        ["yes", "y", "correct", "ok", "yep", "confirm"].includes(
          lowerCaseMessage
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
          reply:
            "Okay, I've cancelled that bet. Is there anything else I can help with?",
          context: {},
        });
      }
    }

    // 2. Intent: Live Scores
    if (
      lowerCaseMessage.includes("score") ||
      lowerCaseMessage.includes("winning")
    ) {
      const teamName = message.split(" ").pop();
      const scoreUpdate = await getLiveScoreUpdate(teamName.replace("?", ""));
      if (scoreUpdate) return res.json({ reply: scoreUpdate, context: {} });
    }

    // 3. Intent: Game Results
    if (
      lowerCaseMessage.includes("result") ||
      lowerCaseMessage.includes("who won")
    ) {
      const teamName = message.split(" ").pop();
      const resultInfo = await getGameResultInfo(teamName.replace("?", ""));
      if (resultInfo) return res.json({ reply: resultInfo, context: {} });
    }

    // 4. Intent: General Sports News
    if (
      lowerCaseMessage.includes("news") ||
      lowerCaseMessage.includes("headlines")
    ) {
      const newsData = await fetchGeneralSportsNews();
      if (newsData && newsData.news.length > 0) {
        const newsReply =
          "Here are the latest headlines:\n" +
          newsData.news.map((n) => `- ${n.title}`).join("\n");
        return res.json({ reply: newsReply, context: {} });
      }
    }

    // 5. Intent: Parse a bet
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

    // 6. Fallback: General conversation with user context
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

    const systemPrompt = `You are "BetWise AI", a helpful assistant for a sports betting app. The user is "${
      user.username
    }". Your role is conversational. You can answer questions about the user's account, find games, provide sports news, and give game results.
      
        ### LIVE DATA FOR THIS USER (for context only):
        - Wallet Balance: $${user.walletBalance.toFixed(2)}
        - Recent Bets: ${formatBetsForPrompt(recentBets)}
        - Recent Transactions: ${formatTransactionsForPrompt(
          recentTransactions
        )}
        
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

exports.parseBetIntent = async (req, res, next) => {
  try {
    if (!genAI) throw new Error("AI Service not initialized. Check API Key.");
    const { text } = req.body;
    if (!text) {
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
    return { isBetIntent: false };
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

exports.getGeneralSportsNews = async (req, res, next) => {
  try {
    const newsData = await fetchGeneralSportsNews();
    res.status(200).json(newsData);
  } catch (error) {
    next(error);
  }
};

exports.getRecommendedGames = async (req, res, next) => {
  try {
    const randomGames = await Game.aggregate([
      { $match: { status: "upcoming", isDeleted: { $ne: true } } },
      { $sample: { size: 3 } },
    ]);

    res.status(200).json({
      message: "Successfully fetched random game suggestions.",
      games: randomGames,
    });
  } catch (error) {
    console.error("Error in getRecommendedGames:", error);
    next(error);
  }
};
