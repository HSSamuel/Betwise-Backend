const mongoose = require("mongoose");
const crypto = require("crypto");
const AviatorGame = require("../models/AviatorGame");
const AviatorBet = require("../models/AviatorBet");
const User = require("../models/User");
const Transaction = require("../models/Transaction");

class AviatorService {
  constructor(io) {
    this.io = io;
    this.gameState = {
      status: "waiting",
      multiplier: 1.0,
      crashPoint: null,
      startTime: null,
      bets: [],
      publicHash: null,
    };
    this.gameCycleTimeout = null;
  }

  start() {
    console.log("✈️ Aviator game service started.");
    this.gameCycle();
  }

  async gameCycle() {
    try {
      // --- WAITING PHASE ---
      this.gameState.status = "waiting";
      this.io.emit("aviator_state", this.gameState);
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // --- BETTING PHASE ---
      const serverSeed = crypto.randomBytes(32).toString("hex");
      const salt = crypto.randomBytes(16).toString("hex");
      const publicHash = crypto
        .createHash("sha256")
        .update(serverSeed)
        .digest("hex");

      this.gameState.status = "betting";
      this.gameState.bets = [];
      this.gameState.publicHash = publicHash;
      this.io.emit("aviator_state", this.gameState);
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // --- PLAYING PHASE ---
      this.gameState.status = "playing";
      this.gameState.startTime = Date.now();
      this.gameState.crashPoint = this.generateCrashPoint(serverSeed, salt);
      this.gameState.multiplier = 1.0;

      // ** FIX: Create the game with all required fields **
      const newGame = new AviatorGame({
        crashPoint: this.gameState.crashPoint,
        serverSeed,
        publicHash,
        salt,
        bets: this.gameState.bets.map((b) => b.betId),
      });
      await newGame.save();
      this.gameState.gameId = newGame._id;

      this.io.emit("aviator_state", this.gameState);
      this.incrementMultiplier();
    } catch (error) {
      console.error("Error in game cycle:", error);
      this.gameCycleTimeout = setTimeout(() => this.gameCycle(), 5000);
    }
  }

  incrementMultiplier() {
    const timeSinceStart = (Date.now() - this.gameState.startTime) / 1000;
    this.gameState.multiplier = parseFloat(
      (1 + 0.08 * timeSinceStart ** 1.3).toFixed(2)
    );

    this.io.emit("aviator_state", this.gameState);

    if (this.gameState.multiplier >= this.gameState.crashPoint) {
      this.endRound();
    } else {
      this.gameCycleTimeout = setTimeout(() => this.incrementMultiplier(), 100);
    }
  }

  async endRound() {
    this.gameState.status = "crashed";
    this.io.emit("aviator_state", this.gameState);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    this.gameCycle();
  }

  async placeBet(userId, amount, autoCashOutMultiplier) {
    if (this.gameState.status !== "betting") {
      throw new Error("Bets can only be placed during the betting window.");
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const user = await User.findById(userId).session(session);
      if (!user || user.walletBalance < amount) {
        await session.abortTransaction();
        throw new Error("Insufficient balance.");
      }

      user.walletBalance -= amount;

      const bet = new AviatorBet({
        user: userId,
        game: null, // This will be updated when the game starts
        amount,
        autoCashOutMultiplier,
      });
      await bet.save({ session });

      // Associate the bet with the user immediately
      this.gameState.bets.push({
        userId: user._id,
        username: user.username,
        amount,
        autoCashOutMultiplier,
        betId: bet._id,
        status: "pending",
      });

      await new Transaction({
        user: userId,
        type: "bet",
        amount: -amount,
        balanceAfter: user.walletBalance,
        description: `Aviator bet`,
      }).save({ session });

      await user.save({ session });
      await session.commitTransaction();

      this.io.emit("aviator_bet_placed", this.gameState.bets);
      this.io
        .to(userId.toString())
        .emit("wallet_update", { balance: user.walletBalance });
      return bet;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async cashOut(userId) {
    if (this.gameState.status !== "playing") {
      throw new Error("Cannot cash out when the game is not active.");
    }

    const betInfo = this.gameState.bets.find(
      (b) => b.userId.toString() === userId.toString() && b.status === "pending"
    );
    if (!betInfo) {
      throw new Error("No active bet found for this user to cash out.");
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const payout = betInfo.amount * this.gameState.multiplier;
      const user = await User.findById(userId).session(session);
      user.walletBalance += payout;

      const bet = await AviatorBet.findById(betInfo.betId).session(session);
      bet.status = "cashed_out";
      bet.cashedOutAt = this.gameState.multiplier;
      bet.payout = payout;
      await bet.save({ session });

      await new Transaction({
        user: userId,
        type: "win",
        amount: payout,
        balanceAfter: user.walletBalance,
        description: `Aviator cash out for bet #${bet._id}`,
      }).save({ session });
      await user.save({ session });
      await session.commitTransaction();

      betInfo.status = "cashed_out";
      this.io.emit("aviator_bet_cashed_out", betInfo);
      this.io
        .to(userId.toString())
        .emit("wallet_update", { balance: user.walletBalance });
      return { multiplier: this.gameState.multiplier, payout };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  generateCrashPoint(serverSeed, salt) {
    const hash = crypto
      .createHmac("sha256", serverSeed)
      .update(salt)
      .digest("hex");
    const h_int = parseInt(hash.substring(0, 8), 16);
    const e = 2 ** 32;

    // This creates a distribution where lower multipliers are more common
    if (h_int % 15 === 0) return 1.0;

    const crashPoint = Math.floor((100 * e - h_int) / (e - h_int)) / 100;
    return Math.max(1.01, crashPoint);
  }
}

module.exports = AviatorService;
