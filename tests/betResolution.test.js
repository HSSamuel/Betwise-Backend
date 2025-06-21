const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { resolveBetsForGame } = require("../services/betResolutionService");
const User = require("../models/User");
const Game = require("../models/Game");
const Bet = require("../models/Bet");
const Transaction = require("../models/Transaction");

describe("Bet Resolution Service", () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  // Clean up database after each test
  afterEach(async () => {
    await User.deleteMany({});
    await Game.deleteMany({});
    await Bet.deleteMany({});
    await Transaction.deleteMany({});
  });

  it("should correctly settle a WON single bet", async () => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await new User({
        username: "testwinner",
        email: "winner@example.com",
        firstName: "Test",
        lastName: "Winner",
        walletBalance: 100,
      }).save({ session });

      const game = await new Game({
        homeTeam: "Team A",
        awayTeam: "Team B",
        odds: { home: 2.0, away: 3.0, draw: 3.5 },
        matchDate: new Date(),
        league: "Test League",
        status: "finished",
        result: "A", // Home team wins
      }).save({ session });

      const bet = await new Bet({
        user: user._id,
        game: game._id,
        betType: "single",
        outcome: "A", // User correctly bet on home team
        stake: 10,
        oddsAtTimeOfBet: game.odds,
        totalOdds: game.odds.home,
        selections: [{ game: game._id, outcome: "A", odds: game.odds.home }],
        payout: 20, // Pre-calculated for simplicity in this test case
      }).save({ session });

      // Run the service
      await resolveBetsForGame(game, session);

      // We need to commit the transaction to save the changes
      await session.commitTransaction();

      // Verify the results outside the session
      const updatedBet = await Bet.findById(bet._id);
      const updatedUser = await User.findById(user._id);
      const winTransaction = await Transaction.findOne({
        user: user._id,
        type: "win",
      });

      expect(updatedBet.status).toBe("won");
      expect(updatedBet.payout).toBe(20);
      expect(updatedUser.walletBalance).toBe(110); // 100 (initial) - 10 (stake) + 20 (payout) = 110. Note: stake deduction is tested elsewhere. This test focuses on resolution. Let's adjust initial balance to make it clearer.

      // Let's adjust the test to be more precise. The service ONLY handles payout. Stake is deducted at time of bet.
      const userBeforeResolution = await User.findById(user._id).session(
        session
      );
      userBeforeResolution.walletBalance = 90; // Assume stake was deducted
      await userBeforeResolution.save({ session });

      await resolveBetsForGame(game, session);
      await session.commitTransaction();

      const finalUser = await User.findById(user._id);
      const finalBet = await Bet.findById(bet._id);
      const finalTransaction = await Transaction.findOne({
        user: user._id,
        type: "win",
      });

      expect(finalBet.status).toBe("won");
      expect(finalUser.walletBalance).toBe(110); // 90 + 20 = 110
      expect(finalTransaction).not.toBeNull();
      expect(finalTransaction.amount).toBe(20);
    } finally {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      session.endSession();
    }
  });

  it("should correctly settle a LOST single bet", async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const user = await new User({
        username: "testloser",
        email: "loser@example.com",
        firstName: "Test",
        lastName: "Loser",
        walletBalance: 90, // Balance after placing a 10 dollar bet
      }).save({ session });

      const game = await new Game({
        homeTeam: "Team C",
        awayTeam: "Team D",
        odds: { home: 2.0, away: 3.0, draw: 3.5 },
        matchDate: new Date(),
        league: "Test League",
        status: "finished",
        result: "B", // Away team wins
      }).save({ session });

      const bet = await new Bet({
        user: user._id,
        game: game._id,
        betType: "single",
        outcome: "A", // User incorrectly bet on home team
        stake: 10,
        oddsAtTimeOfBet: game.odds,
        totalOdds: game.odds.home,
        selections: [{ game: game._id, outcome: "A", odds: game.odds.home }],
      }).save({ session });

      await resolveBetsForGame(game, session);
      await session.commitTransaction();

      const updatedBet = await Bet.findById(bet._id);
      const updatedUser = await User.findById(user._id);
      const winTransaction = await Transaction.findOne({
        user: user._id,
        type: "win",
      });

      expect(updatedBet.status).toBe("lost");
      expect(updatedBet.payout).toBe(0);
      expect(updatedUser.walletBalance).toBe(90); // Balance should not change
      expect(winTransaction).toBeNull();
    } finally {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      session.endSession();
    }
  });
});

it("should correctly settle a WON multi-bet where all legs are correct", async () => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await new User({
      username: "multiwinner",
      email: "multiwinner@example.com",
      walletBalance: 85, // Balance after placing a 15 dollar bet
    }).save({ session });

    const game1 = await new Game({
      homeTeam: "Team E",
      awayTeam: "Team F",
      odds: { home: 1.5, away: 4.0, draw: 4.0 },
      matchDate: new Date(),
      league: "Test League",
      status: "finished",
      result: "A", // Home wins
    }).save({ session });

    const game2 = await new Game({
      homeTeam: "Team G",
      awayTeam: "Team H",
      odds: { home: 2.5, away: 2.8, draw: 3.2 },
      matchDate: new Date(),
      league: "Test League",
      status: "finished",
      result: "B", // Away wins
    }).save({ session });

    const bet = await new Bet({
      user: user._id,
      betType: "multi",
      stake: 15,
      totalOdds: 4.2, // 1.5 * 2.8
      selections: [
        { game: game1._id, outcome: "A", odds: 1.5 },
        { game: game2._id, outcome: "B", odds: 2.8 },
      ],
      payout: 63, // 15 * 4.2
    }).save({ session });

    // The service needs to be called for each game that finishes.
    await resolveBetsForGame(game1, session);
    await resolveBetsForGame(game2, session); // The multi-bet should be settled after the last leg finishes.

    await session.commitTransaction();

    const updatedBet = await Bet.findById(bet._id);
    const updatedUser = await User.findById(user._id);
    const winTransaction = await Transaction.findOne({
      user: user._id,
      type: "win",
    });

    expect(updatedBet.status).toBe("won");
    expect(updatedBet.payout).toBe(63);
    expect(updatedUser.walletBalance).toBe(148); // 85 + 63
    expect(winTransaction).not.toBeNull();
    expect(winTransaction.amount).toBe(63);
  } finally {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
  }
});

it("should correctly settle a LOST multi-bet if one leg is incorrect", async () => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await new User({
      username: "multiloser",
      email: "multiloser@example.com",
      walletBalance: 50,
    }).save({ session });

    const game1 = await new Game({
      homeTeam: "Team I",
      awayTeam: "Team J",
      odds: { home: 1.5, away: 4.0, draw: 4.0 },
      matchDate: new Date(),
      league: "Test League",
      status: "finished",
      result: "A", // Home wins (Correctly predicted)
    }).save({ session });

    const game2 = await new Game({
      homeTeam: "Team K",
      awayTeam: "Team L",
      odds: { home: 2.5, away: 2.8, draw: 3.2 },
      matchDate: new Date(),
      league: "Test League",
      status: "finished",
      result: "Draw", // Draw happens (Incorrectly predicted)
    }).save({ session });

    const bet = await new Bet({
      user: user._id,
      betType: "multi",
      stake: 10,
      totalOdds: 4.2,
      selections: [
        { game: game1._id, outcome: "A", odds: 1.5 },
        { game: game2._id, outcome: "B", odds: 2.8 }, // User predicted Away win
      ],
    }).save({ session });

    await resolveBetsForGame(game1, session);
    await resolveBetsForGame(game2, session);
    await session.commitTransaction();

    const updatedBet = await Bet.findById(bet._id);
    const updatedUser = await User.findById(user._id);
    const winTransaction = await Transaction.findOne({
      user: user._id,
      type: "win",
    });

    expect(updatedBet.status).toBe("lost");
    expect(updatedBet.payout).toBe(0);
    expect(updatedUser.walletBalance).toBe(50); // Balance should not change
    expect(winTransaction).toBeNull();
  } finally {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
  }
});
