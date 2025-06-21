// In: Bet/Backend/tests/oddsService.test.js

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { generateOddsForGame } = require("../services/oddsService");
const TeamRanking = require("../models/TeamRanking");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Mock the entire GoogleGenerativeAI library
jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn(),
    }),
  })),
}));

describe("Odds Service", () => {
  let mongoServer;
  let genAI;
  let mockGenerateContent;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    // Setup mock instance for use in tests
    genAI = new GoogleGenerativeAI();
    mockGenerateContent = genAI.getGenerativeModel().generateContent;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Seed database with team rankings before each test
    await TeamRanking.insertMany([
      { teamName: "Strong Team", teamName_lower: "strong team", ranking: 90 },
      { teamName: "Weak Team", teamName_lower: "weak team", ranking: 70 },
    ]);
    // Reset mocks before each test
    mockGenerateContent.mockClear();
  });

  afterEach(async () => {
    await TeamRanking.deleteMany({});
  });

  it("should generate lower odds for a stronger team", async () => {
    // No risk or news adjustments
    const odds = await generateOddsForGame("Strong Team", "Weak Team");

    expect(odds.home).toBeLessThan(odds.away);
  });

  it("should use default ranking for teams not in the database", async () => {
    const odds = await generateOddsForGame("Unknown Team A", "Unknown Team B");

    // With default rankings, odds should be very close
    expect(odds.home).toBeCloseTo(odds.away, 1);
  });

  it("should adjust odds based on high platform risk", async () => {
    const riskAnalysis = {
      A: { totalPotentialPayout: 20000 }, // High liability on home team
      B: { totalPotentialPayout: 1000 },
      Draw: { totalPotentialPayout: 500 },
    };

    const oddsNoRisk = await generateOddsForGame("Strong Team", "Weak Team");
    const oddsWithRisk = await generateOddsForGame("Strong Team", "Weak Team", {
      riskAnalysis,
    });

    // Expect the odds for the home team to be lowered to discourage more bets
    expect(oddsWithRisk.home).toBeLessThan(oddsNoRisk.home);
  });

  it("should adjust odds based on AI news analysis", async () => {
    // Mock the AI to return a negative impact for the home team
    const mockAiResponse = {
      response: { text: () => '{ "home": 1.2, "away": 1.0, "draw": 1.0 }' },
    };
    mockGenerateContent.mockResolvedValue(mockAiResponse);

    const newsSummary = "Strong Team's star player is injured.";

    const oddsNoNews = await generateOddsForGame("Strong Team", "Weak Team");
    const oddsWithNews = await generateOddsForGame("Strong Team", "Weak Team", {
      newsSummary,
    });

    // Expect the odds for the home team to be higher (worse) due to the news
    expect(oddsWithNews.home).toBeGreaterThan(oddsNoNews.home);
    expect(mockGenerateContent).toHaveBeenCalled();
  });

  it("should return valid odds even if AI service fails", async () => {
    // Mock the AI to throw an error
    mockGenerateContent.mockRejectedValue(new Error("AI service unavailable"));

    const newsSummary = "Some news that will cause an error.";

    const odds = await generateOddsForGame("Strong Team", "Weak Team", {
      newsSummary,
    });

    // Ensure we still get valid odds back (the default impact factor of 1.0 should be used)
    expect(odds).toBeDefined();
    expect(odds.home).toBeGreaterThan(1);
    expect(odds.away).toBeGreaterThan(1);
  });
});
