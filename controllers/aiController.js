const axios = require("axios");
const { body, validationResult } = require("express-validator");
const Game = require("../models/Game");
const Bet = require("../models/Bet");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Withdrawal = require("../models/Withdrawal");
const bettingService = require("../services/bettingService");
const {
  fetchNewsForTopic,
  fetchGeneralSportsNews,
} = require("../services/newsService");
const aiBetSuggestionService = require("../services/aiBetSuggestionService");
const aiProvider = require("../services/aiProviderService");
const { extractJson } = require("../utils/jsonExtractor");

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
    let { message, history = [], context = null } = req.body;
    context = context || {};
    if (!message) {
      return res.status(400).json({ msg: 'A "message" field is required.' });
    }
    const user = await User.findById(req.user._id).lean();
    const lowerCaseMessage = message.toLowerCase();

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

    if (
      lowerCaseMessage.includes("score") ||
      lowerCaseMessage.includes("winning")
    ) {
      const teamName = message.split(" ").pop();
      const scoreUpdate = await getLiveScoreUpdate(teamName.replace("?", ""));
      if (scoreUpdate) return res.json({ reply: scoreUpdate, context: {} });
    }

    if (
      lowerCaseMessage.includes("result") ||
      lowerCaseMessage.includes("who won")
    ) {
      const teamName = message.split(" ").pop();
      const resultInfo = await getGameResultInfo(teamName.replace("?", ""));
      if (resultInfo) return res.json({ reply: resultInfo, context: {} });
    }

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

    const rawAiText = await aiProvider.generateContent(systemPrompt, false);

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
    const { text } = req.body;
    if (!text) {
      return { isBetIntent: false };
    }

    const prompt = `From the user's text, extract betting information into a valid JSON object. The JSON must have "stake" (number), and "teamToBetOn" (string).
          Here are some examples:
          - User text: "I want to put 500 on manchester united to win" -> { "stake": 500, "teamToBetOn": "Manchester United" }
          - User text: "bet $25 on Real Madrid" -> { "stake": 25, "teamToBetOn": "Real Madrid" }
          Now, analyze this user's text and return only the JSON object: "${text}"`;

    const rawAiText = await aiProvider.generateContent(prompt);
    const intent = extractJson(rawAiText);

    if (!intent || !intent.stake || !intent.teamToBetOn) {
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
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { gameId } = req.body;
    const game = await Game.findById(gameId).lean();

    if (!game) return res.status(404).json({ msg: "Game not found." });
    if (game.status !== "upcoming")
      return res
        .status(400)
        .json({ msg: "AI analysis is only available for upcoming games." });

    const homeTeamNews = await fetchNewsForTopic(game.homeTeam);
    const awayTeamNews = await fetchNewsForTopic(game.awayTeam);
    const context = `News for ${game.homeTeam}: ${
      homeTeamNews.join("\n") || "No recent news found."
    }\n\nNews for ${game.awayTeam}: ${
      awayTeamNews.join("\n") || "No recent news found."
    }`;

    const prompt = `You are a sports betting analyst. Based ONLY on the following news context, provide a brief, neutral, 2-4 sentence analysis for the upcoming match between ${game.homeTeam} and ${game.awayTeam}. Mention recent form, key player status (injuries, transfers), or team morale if found in the text. Do not invent information or predict a winner.\n\nCONTEXT:\n---\n${context}`;

    const analysis = await aiProvider.generateContent(prompt);
    res.status(200).json({ analysis: analysis.trim() });
  } catch (error) {
    console.error("AI game analysis error:", error);
    next(error);
  }
};

exports.getBettingFeedback = async (req, res, next) => {
  try {
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

    const prompt = `You are a caring and non-judgmental responsible gambling assistant. A user named ${
      req.user.username
    } has asked for feedback. Their data for the last 7 days: ${betCount} bets totaling $${totalStaked.toFixed(
      2
    )}. Based on this, provide a short, supportive message. If activity seems high (e.g., >15 bets or >$500), gently suggest considering tools like setting limits. Do not give financial advice. Focus on well-being.`;

    const feedback = await aiProvider.generateContent(prompt, false);
    res.status(200).json({ feedback: feedback.trim() });
  } catch (error) {
    console.error("AI betting feedback error:", error);
    next(error);
  }
};

exports.generateLimitSuggestion = async (req, res, next) => {
  try {
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

    const prompt = `You are a caring and supportive responsible gambling assistant for "BetWise". A user named "${req.user.username}" has asked for a weekly limit suggestion. Their average activity over the last 30 days is: ~${averageWeeklyBetCount} bets/week and ~$${averageWeeklyStake}/week. Generate a short, helpful, and non-judgmental message suggesting weekly limits based on their average activity. Suggest a bet count limit slightly above their average (e.g., average + 5) and a stake amount limit slightly above their average (e.g., average + 25%). Frame it as a helpful tool for staying in control. Do NOT be alarming or give financial advice.`;

    const suggestionText = await aiProvider.generateContent(prompt, false);

    res.status(200).json({
      suggestion: suggestionText.trim(),
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
    const { query } = req.body;
    if (!query) {
      const err = new Error("A search query is required.");
      err.statusCode = 400;
      return next(err);
    }

    const prompt = `You are an intelligent search assistant for a betting app. Analyze the user's search query: "${query}". Your task is to return a JSON object with any of the following keys you can identify: 'team', 'league', or 'date'. - For 'team', extract the full team name. - For 'league', extract the league name. - For 'date', extract only one of the keywords: "today", "tomorrow", or an "YYYY-MM-DD" formatted date if specified. - If you cannot identify a parameter, omit its key. Examples: - "Real Madrid games" -> {"team": "Real Madrid"} - "Show me premier league matches today" -> {"league": "Premier League", "date": "today"} Return ONLY the JSON object.`;

    const rawAiText = await aiProvider.generateContent(prompt);
    const params = extractJson(rawAiText);

    if (!params) throw new Error("AI could not process the search query.");

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
      if (params.date === "today") targetDate = new Date();
      else if (params.date === "tomorrow") {
        targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + 1);
      } else targetDate = new Date(params.date);

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
    const { topic } = req.body;
    const newsSnippets = await fetchNewsForTopic(topic);
    if (newsSnippets.length === 0) {
      return res.status(404).json({
        summary: `Sorry, I couldn't find any recent news for "${topic}".`,
      });
    }

    const context = newsSnippets.join("\n\n");
    const prompt = `You are a sports news analyst. Based only on the following context, provide a brief, neutral, 2-4 sentence summary about "${topic}". Mention recent form, injuries, or significant transfer news found in the text. Do not invent information.\n\nCONTEXT:\n---\n${context}`;

    const summaryText = await aiProvider.generateContent(prompt);
    res.status(200).json({ summary: summaryText.trim() });
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
      { $sample: { size: 2 } },
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

exports.generateSocialPost = async (req, res, next) => {
  try {
    const { gameId } = req.body;
    if (!gameId) {
      const err = new Error("A gameId is required.");
      err.statusCode = 400;
      return next(err);
    }
    const game = await Game.findById(gameId).lean();
    if (!game) {
      const err = new Error("Game not found.");
      err.statusCode = 404;
      return next(err);
    }
    const prompt = `You are a social media manager for a sports betting app called "BetWise". Your tone is exciting and engaging. Create a short social media post for the upcoming match: "${game.homeTeam} vs. ${game.awayTeam}" in the "${game.league}". The post should build hype and end with a call to action to place bets on BetWise. Include 3-4 relevant hashtags.`;
    const post = await aiProvider.generateContent(prompt);
    res.status(200).json({ post: post.trim() });
  } catch (error) {
    next(error);
  }
};

exports.analyzeBetSlip = async (req, res, next) => {
  try {
    const { selections } = req.body;
    if (!Array.isArray(selections) || selections.length < 2) {
      const err = new Error(
        "At least two selections are required for analysis."
      );
      err.statusCode = 400;
      return next(err);
    }

    const totalOdds = selections.reduce((acc, s) => acc * s.odds, 1);
    const impliedProbability = (1 / totalOdds) * 100;
    const riskiestLeg = selections.reduce((riskiest, current) =>
      current.odds > riskiest.odds ? current : riskiest
    );

    const prompt = `You are a sports betting analyst providing a risk summary for a multi-bet slip. The user's slip has ${
      selections.length
    } selections with total odds of ${totalOdds.toFixed(
      2
    )}. The implied probability is ~${impliedProbability.toFixed(
      2
    )}%. The single riskiest leg is "${riskiestLeg.gameDetails.homeTeam} vs ${
      riskiestLeg.gameDetails.awayTeam
    }" with odds of ${
      riskiestLeg.odds
    }. Based on this data, provide a concise, 2-3 sentence analysis. Classify the risk level (e.g., "This is a high-risk, high-reward bet..."), mention the low probability, and point out the riskiest leg as a key factor. Be direct and analytical.`;

    const analysis = await aiProvider.generateContent(prompt, true);
    res.status(200).json({ analysis });
  } catch (error) {
    next(error);
  }
};

exports.getBetSlipSuggestions = async (req, res, next) => {
  try {
    const { selections, totalOdds } = req.body;
    const [combinationSuggestions, alternativeBet] = await Promise.all([
      aiBetSuggestionService.getCombinationSuggestions(selections),
      aiBetSuggestionService.getAlternativeBet(selections, totalOdds),
    ]);
    res.status(200).json({ combinationSuggestions, alternativeBet });
  } catch (error) {
    next(error);
  }
};

exports.getPersonalizedNewsFeed = async (req, res, next) => {
  try {
    const userBets = await Bet.find({ user: req.user._id })
      .populate({
        path: "selections.game",
        model: "Game",
        select: "homeTeam awayTeam",
      })
      .lean();

    if (!userBets || userBets.length === 0) {
      return res.status(200).json({ news: [] });
    }

    const teamCounts = {};
    userBets.forEach((bet) => {
      bet.selections.forEach((selection) => {
        if (
          selection.game &&
          selection.game.homeTeam &&
          selection.game.awayTeam
        ) {
          teamCounts[selection.game.homeTeam] =
            (teamCounts[selection.game.homeTeam] || 0) + 1;
          teamCounts[selection.game.awayTeam] =
            (teamCounts[selection.game.awayTeam] || 0) + 1;
        }
      });
    });

    const sortedTeams = Object.entries(teamCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 1)
      .map(([team]) => team);

    const teamNames = sortedTeams.filter(Boolean);

    if (teamNames.length === 0) {
      return res.status(200).json({ news: [] });
    }

    const newsPromises = teamNames.map(async (team) => {
      // fetchNewsForTopic will return an array of snippets
      const snippets = await fetchNewsForTopic(team);
      // FIX: Join the snippets into a single string with newlines
      const summary = snippets
        ? snippets.join("\n\n")
        : "No recent news found.";
      return { team, summary };
    });

    const news = await Promise.all(newsPromises);

    res.status(200).json({ news });
  } catch (error) {
    console.error("ERROR in getPersonalizedNewsFeed:", error);
    next(error);
  }
};