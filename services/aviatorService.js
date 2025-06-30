const crypto = require("crypto");
const AviatorGame = require("../models/AviatorGame");
const AviatorBet = require("../models/AviatorBet");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const mongoose = require("mongoose");

const GAME_STATE = {
  WAITING: "waiting",
  BETTING: "betting",
  RUNNING: "running",
  CRASHED: "crashed",
};
const BETTING_DURATION = 5000;
const WAITING_DURATION = 3000;

class AviatorService {
  constructor(io) {
    this.io = io;
    this.gameState = GAME_STATE.WAITING;
    this.currentGame = null;
    this.multiplier = 1.0;
    this.crashPoint = 1.0;
    this.roundStartTime = null;

    console.log("✈️  Aviator Service Initialized.");
  }

  start() {
    console.log("✈️  Starting Aviator Game Loop...");
    this.runGameCycle();
  }

  async runGameCycle() {
    try {
      this.gameState = GAME_STATE.WAITING;
      this.io.emit("aviator:state", { state: this.gameState });
      await new Promise((resolve) => setTimeout(resolve, WAITING_DURATION));

      this.gameState = GAME_STATE.BETTING;
      const newGame = await this.createNewGame();
      this.currentGame = newGame;
      this.io.emit("aviator:state", {
        state: this.gameState,
        publicHash: newGame.publicHash,
      });
      await new Promise((resolve) => setTimeout(resolve, BETTING_DURATION));

      this.gameState = GAME_STATE.RUNNING;
      this.roundStartTime = Date.now();
      this.io.emit("aviator:state", { state: this.gameState });

      const tick = async () => {
        if (this.gameState !== GAME_STATE.RUNNING) return;
        const elapsedTime = (Date.now() - this.roundStartTime) / 1000;
        this.multiplier = parseFloat(Math.pow(1.05, elapsedTime).toFixed(2));

        await this.checkForAutoCashOuts(this.multiplier);

        if (this.multiplier >= this.crashPoint) {
          this.crash();
        } else {
          this.io.emit("aviator:tick", { multiplier: this.multiplier });
          setTimeout(tick, 50);
        }
      };
      tick();
    } catch (error) {
      console.error("Error in game cycle:", error);
      setTimeout(() => this.runGameCycle(), 5000);
    }
  }

  async checkForAutoCashOuts(currentMultiplier) {
    const betsToCashOut = await AviatorBet.find({
      game: this.currentGame._id,
      status: "pending",
      autoCashOutAt: { $lte: currentMultiplier, $ne: null },
    });

    for (const bet of betsToCashOut) {
      // Use a separate session for each auto cash-out to prevent one failure from blocking others
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const user = await User.findById(bet.user).session(session);
        if (!user) continue;

        const payout = bet.stake * bet.autoCashOutAt;
        bet.status = "won";
        bet.payout = parseFloat(payout.toFixed(2));
        bet.cashOutAt = bet.autoCashOutAt;
        user.walletBalance += bet.payout;

        await new Transaction({
          /* ... */
        }).save({ session });
        await user.save({ session });
        await bet.save({ session });

        await session.commitTransaction();

        this.io.to(user._id.toString()).emit("aviator:cashed_out", {
          /* ... */
        });
      } catch (error) {
        await session.abortTransaction();
        console.error(`Failed to auto cash out bet ${bet._id}:`, error);
      } finally {
        session.endSession();
      }
    }
  }

  async crash() {
    this.gameState = GAME_STATE.CRASHED;
    this.currentGame.status = "crashed";
    this.currentGame.crashedAt = new Date();
    await this.currentGame.save();

    console.log(`✈️  CRASH! Multiplier: ${this.crashPoint}`);

    this.io.emit("aviator:crash", {
      multiplier: this.crashPoint,
      gameData: {
        serverSeed: this.currentGame.serverSeed,
        salt: this.currentGame.salt,
      },
    });

    // --- Implementation: Resolve pending bets ---
    await this.resolveBetsForRound(this.currentGame);

    this.runGameCycle();
  }

  // --- Implementation: New method to resolve all bets for a round ---
  async resolveBetsForRound(game) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const pendingBets = await AviatorBet.find({
        game: game._id,
        status: "pending",
      }).session(session);

      for (const bet of pendingBets) {
        // Bets that were not cashed out are considered lost.
        bet.status = "lost";
        await bet.save({ session });
      }

      console.log(
        `Resolved ${pendingBets.length} pending (lost) bets for Aviator round ${game._id}.`
      );

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      console.error(
        `Error resolving Aviator bets for round ${game._id}:`,
        error
      );
    } finally {
      session.endSession();
    }
  }

  async createNewGame() {
    const serverSeed = crypto.randomBytes(32).toString("hex");
    const salt = crypto.randomBytes(16).toString("hex");
    const publicHash = crypto
      .createHash("sha256")
      .update(serverSeed)
      .digest("hex");
    const gameHash = crypto
      .createHmac("sha256", serverSeed)
      .update(salt)
      .digest("hex");
    this.crashPoint = this.getCrashPoint(gameHash);
    this.multiplier = 1.0;

    const game = new AviatorGame({
      serverSeed,
      salt,
      publicHash,
      crashMultiplier: this.crashPoint,
      status: "running",
    });

    await game.save();
    return game;
  }

  getCrashPoint(gameHash) {
    const instantCrashChance = 3;
    const isInstantCrash =
      parseInt(gameHash.slice(0, 2), 16) % (100 / instantCrashChance) === 0;

    if (isInstantCrash) {
      return 1.0;
    }

    const h = parseInt(gameHash.slice(0, 13), 16);
    const e = Math.pow(2, 52);
    const crashPoint = Math.floor((100 * e - h) / (e - h)) / 100;

    return Math.max(1, crashPoint);
  }
}

module.exports = AviatorService;
