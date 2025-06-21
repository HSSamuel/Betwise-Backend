// In: Bet/Backend/services/aviatorService.js

const crypto = require("crypto");
const AviatorGame = require("../models/AviatorGame");

// --- Game State and Constants ---
const GAME_STATE = {
  WAITING: "waiting", // Waiting for the previous round to finish
  BETTING: "betting", // Players can place bets (e.g., 5 seconds)
  RUNNING: "running", // Plane is flying, multiplier is increasing
  CRASHED: "crashed", // Plane has flown away, round is over
};
const BETTING_DURATION = 5000; // 5 seconds
const WAITING_DURATION = 3000; // 3 seconds between rounds

class AviatorService {
  constructor(io) {
    this.io = io; // Socket.IO server instance
    this.gameState = GAME_STATE.WAITING;
    this.currentGame = null;
    this.multiplier = 1.0;
    this.crashPoint = 1.0;
    this.roundStartTime = null;

    console.log("✈️  Aviator Service Initialized.");
  }

  // --- Core Game Loop ---
  start() {
    console.log("✈️  Starting Aviator Game Loop...");
    this.runGameCycle();
  }

  async runGameCycle() {
    try {
      // 1. WAITING state
      this.gameState = GAME_STATE.WAITING;
      this.io.emit("aviator:state", { state: this.gameState });
      await new Promise((resolve) => setTimeout(resolve, WAITING_DURATION));

      // 2. BETTING state
      this.gameState = GAME_STATE.BETTING;
      const newGame = await this.createNewGame();
      this.currentGame = newGame;
      this.io.emit("aviator:state", {
        state: this.gameState,
        publicHash: newGame.publicHash,
      });
      await new Promise((resolve) => setTimeout(resolve, BETTING_DURATION));

      // 3. RUNNING state
      this.gameState = GAME_STATE.RUNNING;
      this.roundStartTime = Date.now();
      this.io.emit("aviator:state", { state: this.gameState });

      const tick = () => {
        if (this.gameState !== GAME_STATE.RUNNING) return;

        const elapsedTime = (Date.now() - this.roundStartTime) / 1000;
        this.multiplier = parseFloat(Math.pow(1.05, elapsedTime).toFixed(2));

        if (this.multiplier >= this.crashPoint) {
          this.crash();
        } else {
          this.io.emit("aviator:tick", { multiplier: this.multiplier });
          setTimeout(tick, 50); // Broadcast multiplier update ~20 times/sec
        }
      };
      tick();
    } catch (error) {
      console.error("Error in game cycle:", error);
      // In case of error, reset the cycle after a delay
      setTimeout(() => this.runGameCycle(), 5000);
    }
  }

  // --- Game State Management ---
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

    // TODO: Add logic here to resolve all pending bets for this round

    // Start the next game cycle
    this.runGameCycle();
  }

  // --- Provably Fair Logic ---
  async createNewGame() {
    const serverSeed = crypto.randomBytes(32).toString("hex");
    const salt = crypto.randomBytes(16).toString("hex");

    // The public hash shown to players before the round starts (a commitment to the server seed)
    const publicHash = crypto
      .createHash("sha256")
      .update(serverSeed)
      .digest("hex");

    // The actual hash that determines the outcome, created using HMAC for security.
    // This cannot be predicted by the player, but can be verified later.
    const gameHash = crypto
      .createHmac("sha256", serverSeed)
      .update(salt)
      .digest("hex");

    // The determined crash point for this round, calculated from the secure gameHash
    this.crashPoint = this.getCrashPoint(gameHash);
    this.multiplier = 1.0;

    const game = new AviatorGame({
      serverSeed,
      salt,
      publicHash,
      crashMultiplier: this.crashPoint,
      status: "running", // Set initial status
    });

    await game.save();
    return game;
  }

  getCrashPoint(gameHash) {
    // This is a more standard and robust provably fair algorithm.

    // 1. Introduce a house edge. For example, a 3% chance of an instant 1.00x crash.
    // This creates more realistic game variance.
    const instantCrashChance = 3; // 3%
    const isInstantCrash =
      parseInt(gameHash.slice(0, 2), 16) % (100 / instantCrashChance) === 0;

    if (isInstantCrash) {
      return 1.0;
    }

    // 2. Use the standard formula for calculating the crash point.
    // We use a 52-bit integer from the hash for a wide range of outcomes.
    const h = parseInt(gameHash.slice(0, 13), 16);
    const e = Math.pow(2, 52);

    const crashPoint = Math.floor((100 * e - h) / (e - h)) / 100;

    return Math.max(1, crashPoint);
  }
}

module.exports = AviatorService;
