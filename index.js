require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const helmet = require("helmet");
const morgan = require("morgan");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const connectDB = require("./config/db");
require("./config/passport-setup");
const cron = require("node-cron");
const jwt = require("jsonwebtoken");

// ** UPDATE: Added User model import for Socket.IO logic **
const User = require("./models/User");

const {
  syncGames,
  syncLiveAndFinishedGames,
} = require("./services/sportsDataService");
const { analyzePlatformRisk } = require("./scripts/monitorPlatformRisk");
const { cleanupStaleGames } = require("./scripts/cleanupStaleGames");
// ** UPDATE: Import functions from scripts directly **
const { analyzePlayerChurn } = require("./scripts/analyzePlayerChurn");
const { sendPreGameTips } = require("./scripts/sendPreGameTips");

const AviatorService = require("./services/aviatorService");
const aviatorRoutes = require("./routes/aviatorRoutes");
// ** UPDATE: Add notification routes import **
const notificationRoutes = require("./routes/notificationRoutes");

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:5173",
  "https://betwise-frontend-5uqq.vercel.app",
  "https://betwise-frontend-5uqq-hunsa-semakos-projects.vercel.app",
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));
const io = new Server(server, {
  cors: corsOptions,
});

const aviatorService = new AviatorService(io);
app.use((req, res, next) => {
  req.io = io;
  req.aviatorService = aviatorService;
  next();
});

app.use(helmet());
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === "development" ? "dev" : "combined"));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit auth-related requests to 20 per 15 mins
  message:
    "Too many login or registration attempts, please try again after 15 minutes.",
  standardHeaders: true,
  legacyHeaders: false,
});

const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200, // Adjusted for development
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", generalApiLimiter);

const apiVersion = "/api/v1";
app.use(`${apiVersion}/auth`, require("./routes/authRoutes"));
app.use(`${apiVersion}/games`, require("./routes/gameRoutes"));
app.use(`${apiVersion}/bets`, require("./routes/betRoutes"));
app.use(`${apiVersion}/wallet`, require("./routes/walletRoutes"));
app.use(`${apiVersion}/admin`, require("./routes/adminRoutes"));
app.use(`${apiVersion}/users`, require("./routes/userRoutes"));
app.use(`${apiVersion}/ai`, require("./routes/aiRoutes"));
app.use(`${apiVersion}/aviator`, aviatorRoutes);
app.use(`${apiVersion}/promotions`, require("./routes/promoRoutes"));
// NOTE: These are duplicates and can be cleaned up later.
// app.use(`${apiVersion}/aviator`, aviatorRoutes);
// app.use(`${apiVersion}/promotions`, require("./routes/promoRoutes"));
app.use(`${apiVersion}/admin/rankings`, require("./routes/rankingRoutes"));
// --- Leaderboard routes ---
app.use(`${apiVersion}/leaderboards`, require("./routes/leaderboardRoutes"));
// ** UPDATE: Add notification routes **
app.use(`${apiVersion}/notifications`, notificationRoutes);

// ** UPDATE: Modified middleware to handle authentication more gracefully **
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (token) {
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        console.warn("Socket auth error: Invalid token. Proceeding as guest.");
        return next();
      }
      socket.user = decoded; // Attach user payload (id, role, etc.)
      next();
    });
  } else {
    // No token, proceed as a guest
    next();
  }
});

// ** UPDATE: Modified connection handler for authentic presence **
io.on("connection", async (socket) => {
  // ** UPDATE: Get userId from the authenticated socket.user object **
  const userId = socket.user?.id;

  if (userId) {
    console.log(`⚡: User connected: ${userId} with socket ID: ${socket.id}`);
    socket.join(userId);
    try {
      // ** UPDATE: Set 'isOnline' to true and update 'lastSeen' on connection **
      const now = new Date();
      await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: now });
      // ** UPDATE: Broadcast the new status to all clients **
      io.emit("userStatusUpdate", { userId, isOnline: true, lastSeen: now });
      console.log(`🟢 User ${userId} is now online.`);
    } catch (error) {
      console.error(`Error setting user ${userId} to online:`, error);
    }
  } else {
    console.log(`⚡: Guest connected with socket ID: ${socket.id}`);
  }

  socket.on("disconnect", async () => {
    // ** UPDATE: This logic now correctly uses the userId established on connection **
    if (userId) {
      try {
        const lastSeenTime = new Date();
        await User.findByIdAndUpdate(userId, {
          isOnline: false,
          lastSeen: lastSeenTime,
        });
        io.emit("userStatusUpdate", {
          userId,
          isOnline: false,
          lastSeen: lastSeenTime,
        });
        console.log(`🔴 User ${userId} has disconnected.`);
      } catch (error) {
        console.error(`Error setting user ${userId} to offline:`, error);
      }
    } else {
      console.log("🔥: A guest disconnected");
    }
  });
});

const startServer = async () => {
  try {
    await connectDB();
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, "0.0.0.0", () => {
      console.log(
        `🚀 Server running on port ${PORT} in ${
          process.env.NODE_ENV || "development"
        } mode.`
      );

      aviatorService.start();

      cron.schedule("* * * * *", async () => {
        console.log("🕒 Cron: Syncing live and finished game data...");
        try {
          await syncLiveAndFinishedGames(io);
        } catch (error) {
          console.error(
            "❌ Error during scheduled live/finished games sync:",
            error.message
          );
        }
      });

      cron.schedule("*/30 * * * *", async () => {
        console.log("🕒 Cron: Fetching upcoming games from all providers...");
        try {
          await syncGames("apifootball"); // Using a single provider for consistency
        } catch (error) {
          console.error(
            "❌ Error during scheduled upcoming games sync:",
            error.message
          );
        }
      });

      cron.schedule("*/5 * * * *", async () => {
        console.log("🤖 Cron: Monitoring platform risk...");
        try {
          await analyzePlatformRisk();
        } catch (error) {
          console.error(
            "❌ Error during scheduled risk analysis:",
            error.message
          );
        }
      });

      // FIX: Add the new cron job for cleaning up stale games, scheduled to run every hour.
      cron.schedule("0 * * * *", async () => {
        console.log("🕒 Cron: Running stale game cleanup...");
        try {
          await cleanupStaleGames();
        } catch (error) {
          console.error(
            "❌ Error during scheduled game cleanup:",
            error.message
          );
        }
      });

      // Add this new cron job
      cron.schedule("0 */6 * * *", async () => {
        // Runs every 6 hours
        console.log("🤖 Cron: Sending Pre-Game Intelligent Tips...");
        try {
          // ** UPDATE: Call the imported function directly and pass 'io' for notifications **
          await sendPreGameTips(io);
        } catch (error) {
          console.error(
            "❌ Error during scheduled pre-game tips job:",
            error.message
          );
        }
      });

      cron.schedule("0 3 * * *", async () => {
        console.log("🤖 Cron: Analyzing player churn patterns...");
        try {
          await analyzePlayerChurn();
        } catch (error) {
          console.error(
            "❌ Error during scheduled player churn analysis:",
            error.message
          );
        }
      });

      console.log("✅ All background tasks have been scheduled correctly.");
    });
  } catch (dbConnectionError) {
    console.error(
      "❌ Failed to connect to database. Server not started.",
      dbConnectionError.message
    );
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== "test") {
  startServer();
}

module.exports = app;
