const request = require("supertest");
const app = require("../index"); // Your Express app
const mongoose = require("mongoose");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const jwt = require("jsonwebtoken");
const bcryptjs = require("bcryptjs"); // Using bcryptjs for consistency

let token;
let testUser; // Renamed from 'user' to avoid conflict with User model
const testUserData = {
  username: "testwalletuser_unique", // Made username more unique for testing
  email: "testwalletuser_unique@example.com",
  password: "testPassword123",
  firstName: "TestWallet",
  lastName: "User",
  initialWalletBalance: 1000.0,
};

beforeAll(async () => {
  jest.setTimeout(35000); // Slightly increased timeout

  const dbUri = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI;
  if (!dbUri) {
    throw new Error(
      "🔴 MONGODB_TEST_URI or MONGODB_URI not set. Tests cannot run."
    );
  }
  await mongoose.connect(dbUri);

  // Clean up any existing test user and their transactions
  await User.deleteOne({ username: testUserData.username });
  // We'll delete transactions specifically after getting the user ID

  // Create a new test user for this suite
  const hashedPassword = await bcryptjs.hash(testUserData.password, 10);
  testUser = new User({
    username: testUserData.username,
    email: testUserData.email,
    password: hashedPassword,
    firstName: testUserData.firstName,
    lastName: testUserData.lastName,
    walletBalance: testUserData.initialWalletBalance,
    role: "user", // Explicitly set role if needed by tests/auth
  });
  await testUser.save();

  // Now delete any transactions that might have been linked to a previous user with the same ID (unlikely but safe)
  await Transaction.deleteMany({ user: testUser._id });

  token = jwt.sign(
    { id: testUser._id, role: testUser.role, username: testUser.username },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
});

afterAll(async () => {
  if (testUser) {
    await User.deleteOne({ username: testUserData.username });
    await Transaction.deleteMany({ user: testUser._id });
  }
  await mongoose.disconnect();
});

describe("Wallet API Endpoints", () => {
  describe("GET /wallet", () => {
    it("should return the wallet balance, username, and email for the authenticated user", async () => {
      const res = await request(app)
        .get("/wallet")
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty("username", testUserData.username);
      expect(res.body).toHaveProperty("email", testUserData.email);
      expect(res.body).toHaveProperty(
        "walletBalance",
        testUserData.initialWalletBalance
      );
    });

    it("should return 401 if no token is provided", async () => {
      const res = await request(app).get("/wallet");
      expect(res.statusCode).toBe(401);
      expect(res.body.msg).toMatch(/No token, authorization denied/i);
    });
  });

  describe("POST /wallet/topup", () => {
    const validTopUpAmount = 250.75;

    it("should successfully top up the wallet, update balance, and create a transaction record", async () => {
      const userBeforeTopUp = await User.findById(testUser._id);
      const expectedBalance = parseFloat(
        (userBeforeTopUp.walletBalance + validTopUpAmount).toFixed(2)
      );

      const res = await request(app)
        .post("/wallet/topup")
        .set("Authorization", `Bearer ${token}`)
        .send({ amount: validTopUpAmount });

      expect(res.statusCode).toBe(200);
      expect(res.body.msg).toBe("Wallet topped up successfully.");
      expect(res.body.walletBalance).toBe(expectedBalance);
      expect(res.body.transactionId).toBeDefined();

      // Verify DB state
      const userAfterTopUp = await User.findById(testUser._id);
      expect(userAfterTopUp.walletBalance).toBe(expectedBalance);

      const transaction = await Transaction.findById(res.body.transactionId);
      expect(transaction).not.toBeNull();
      expect(transaction.type).toBe("topup");
      expect(transaction.amount).toBe(validTopUpAmount);
      expect(transaction.user.toString()).toBe(testUser._id.toString());
      expect(transaction.balanceAfter).toBe(expectedBalance);
    });

    it("should return 400 for a zero top-up amount", async () => {
      const res = await request(app)
        .post("/wallet/topup")
        .set("Authorization", `Bearer ${token}`)
        .send({ amount: 0 });
      expect(res.statusCode).toBe(400);
      expect(res.body.errors[0].msg).toContain(
        "Top-up amount must be a positive number"
      );
    });

    it("should return 400 for a negative top-up amount", async () => {
      const res = await request(app)
        .post("/wallet/topup")
        .set("Authorization", `Bearer ${token}`)
        .send({ amount: -50 });
      expect(res.statusCode).toBe(400);
      expect(res.body.errors[0].msg).toContain(
        "Top-up amount must be a positive number"
      );
    });

    it("should return 400 for a non-numeric top-up amount", async () => {
      const res = await request(app)
        .post("/wallet/topup")
        .set("Authorization", `Bearer ${token}`)
        .send({ amount: "abc" });
      expect(res.statusCode).toBe(400);
      // The message might be "Invalid value" or specific to float parsing depending on validator
      expect(res.body.errors[0].msg).toMatch(
        /Top-up amount must be a positive number|Invalid value/
      );
    });

    it("should return 400 if amount is missing", async () => {
      const res = await request(app)
        .post("/wallet/topup")
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.statusCode).toBe(400);
      expect(res.body.errors[0].msg).toMatch(
        /Top-up amount must be a positive number|Invalid value/
      );
    });

    it("should return 401 if no token is provided", async () => {
      const res = await request(app)
        .post("/wallet/topup")
        .send({ amount: 100 });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /wallet/transactions", () => {
    // Create some transactions for this user before running these tests
    beforeAll(async () => {
      await Transaction.insertMany([
        {
          user: testUser._id,
          type: "topup",
          amount: 100,
          balanceAfter: testUser.walletBalance + 100,
          description: "TX History Topup",
        },
        {
          user: testUser._id,
          type: "bet",
          amount: -20,
          balanceAfter: testUser.walletBalance + 80,
          description: "TX History Bet",
        },
        {
          user: testUser._id,
          type: "win",
          amount: 40,
          balanceAfter: testUser.walletBalance + 120,
          description: "TX History Win",
        },
      ]);
      // Adjust testUser's balance if needed for consistency, or rely on these being separate from balance tests
      const userToUpdate = await User.findById(testUser._id);
      userToUpdate.walletBalance = testUser.walletBalance + 120; // Example update based on tx
      await userToUpdate.save();
    });

    it("should return a paginated list of transactions for the authenticated user", async () => {
      const res = await request(app)
        .get("/wallet/transactions?limit=2&page=1")
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.transactions).toBeInstanceOf(Array);
      expect(res.body.transactions.length).toBeLessThanOrEqual(2);
      expect(res.body.currentPage).toBe(1);
      expect(res.body.totalCount).toBeGreaterThanOrEqual(3); // Based on beforeAll here
      if (res.body.transactions.length > 0) {
        expect(res.body.transactions[0]).toHaveProperty("type");
        expect(res.body.transactions[0]).toHaveProperty("amount");
      }
    });

    it("should filter transactions by type", async () => {
      const res = await request(app)
        .get("/wallet/transactions?type=bet")
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.transactions).toBeInstanceOf(Array);
      res.body.transactions.forEach((tx) => {
        expect(tx.type).toBe("bet");
      });
      expect(res.body.transactions.length).toBeGreaterThanOrEqual(1);
    });

    it("should return 400 for invalid transaction type filter", async () => {
      const res = await request(app)
        .get("/wallet/transactions?type=invalid")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(400);
      expect(res.body.errors[0].msg).toBe("Invalid transaction type.");
    });

    it("should return 401 if no token is provided", async () => {
      const res = await request(app).get("/wallet/transactions");
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /wallet/summary", () => {
    // Assuming transactions from previous describe block exist.
    // For more isolated tests, create specific transactions here.
    it("should return the wallet summary", async () => {
      const res = await request(app)
        .get("/wallet/summary")
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty("totalTopUps");
      expect(typeof res.body.totalTopUps.amount).toBe("number");
      expect(typeof res.body.totalTopUps.count).toBe("number");
      expect(res.body).toHaveProperty("totalBetsPlaced");
      expect(typeof res.body.totalBetsPlaced.amount).toBe("number");
      expect(res.body).toHaveProperty("totalWinnings");
      expect(typeof res.body.totalWinnings.amount).toBe("number");
      expect(res.body).toHaveProperty("currentWalletBalance");
      expect(typeof res.body.currentWalletBalance).toBe("number");
      // More specific assertions could compare against expected values based on known transactions
    });

    it("should return 401 if no token is provided", async () => {
      const res = await request(app).get("/wallet/summary");
      expect(res.statusCode).toBe(401);
    });
  });
});
