// In: Bet/Backend/tests/bettingService.test.js

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const bettingService = require("../services/bettingService");
const aiHelperService = require("../services/aiHelperService");
const User = require("../models/User");
const Game = require("../models/Game");
const Bet = require("../models/Bet");
const Transaction = require("../models/Transaction");

// Mock the AI helper to avoid actual AI calls during tests
jest.mock("../services/aiHelperService", () => ({
  generateInterventionMessage: jest
    .fn()
    .mockResolvedValue("This is a friendly intervention message."),
}));

describe("Betting Service", () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  afterEach(async () => {
    await User.deleteMany({});
    await Game.deleteMany({});
    await Bet.deleteMany({});
    await Transaction.deleteMany({});
    jest.clearAllMocks();
  });

  describe("checkBettingLimits", () => {
    it("should not throw an error if user is within limits", () => {
      const user = new User({
        limits: {
          weeklyBetCount: { limit: 10, currentCount: 5 },
          weeklyStakeAmount: { limit: 500, currentAmount: 200 },
        },
      });
      const stake = 50;
      expect(() =>
        bettingService.checkBettingLimits(user, stake)
      ).not.toThrow();
    });

    it("should throw an error if weekly bet count is exceeded", () => {
      const user = new User({
        limits: {
          weeklyBetCount: { limit: 10, currentCount: 10 },
          weeklyStakeAmount: { limit: 500, currentAmount: 200 },
        },
      });
      const stake = 50;
      expect(() => bettingService.checkBettingLimits(user, stake)).toThrow(
        /You have reached your weekly limit/
      );
    });

    it("should throw an error if weekly stake amount is exceeded", () => {
      const user = new User({
        limits: {
          weeklyBetCount: { limit: 10, currentCount: 5 },
          weeklyStakeAmount: { limit: 500, currentAmount: 480 },
        },
      });
      const stake = 50;
      expect(() => bettingService.checkBettingLimits(user, stake)).toThrow(
        /This bet would exceed your weekly stake limit/
      );
    });
  });

  describe("checkForLossChasing", () => {
    it("should not throw if the last bet was a win", async () => {
      const user = await new User({ username: "testuser" }).save();
      await new Bet({ user: user._id, status: "won", stake: 10 }).save();
      const stake = 50;
      await expect(
        bettingService.checkForLossChasing(user, stake)
      ).resolves.not.toThrow();
    });

    it("should throw an intervention error if stake significantly increases after a loss", async () => {
      const user = await new User({ username: "chaser" }).save();
      await new Bet({ user: user._id, status: "lost", stake: 10 }).save();
      const stake = 50; // 5x the previous stake
      await expect(
        bettingService.checkForLossChasing(user, stake)
      ).rejects.toThrow("This is a friendly intervention message.");
      expect(aiHelperService.generateInterventionMessage).toHaveBeenCalledWith(
        user.username,
        10,
        50
      );
    });
  });

  describe("placeSingleBetTransaction", () => {
    let user;
    let game;

    beforeEach(async () => {
      user = await new User({ username: "bettor", walletBalance: 100 }).save();
      game = await new Game({
        homeTeam: "Team A",
        awayTeam: "Team B",
        odds: { home: 2.0, away: 3.0, draw: 3.2 },
        matchDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
        league: "Test League",
      }).save();
    });

    it("should successfully place a bet and create a transaction", async () => {
      const stake = 20;
      const outcome = "A";

      const result = await bettingService.placeSingleBetTransaction(
        user._id,
        game._id,
        outcome,
        stake
      );

      const updatedUser = await User.findById(user._id);
      const createdBet = await Bet.findById(result.bet._id);
      const createdTransaction = await Transaction.findOne({
        bet: result.bet._id,
      });

      expect(updatedUser.walletBalance).toBe(80);
      expect(createdBet).not.toBeNull();
      expect(createdBet.stake).toBe(stake);
      expect(createdBet.outcome).toBe(outcome);
      expect(createdTransaction).not.toBeNull();
      expect(createdTransaction.amount).toBe(-stake);
    });

    it("should throw an error for insufficient funds", async () => {
      const stake = 200; // More than the user's balance
      const outcome = "A";

      await expect(
        bettingService.placeSingleBetTransaction(
          user._id,
          game._id,
          outcome,
          stake
        )
      ).rejects.toThrow("Insufficient funds in your wallet.");
    });

    it("should throw an error if the game is not upcoming", async () => {
      game.status = "live";
      await game.save();
      const stake = 20;
      const outcome = "A";

      await expect(
        bettingService.placeSingleBetTransaction(
          user._id,
          game._id,
          outcome,
          stake
        )
      ).rejects.toThrow("Betting is closed for this game.");
    });
  });
});
