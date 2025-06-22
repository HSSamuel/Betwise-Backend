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

// Correctly import all necessary services and routes
const {
  syncGames,
  syncLiveAndFinishedGames,
} = require("./services/sportsDataService");
const { analyzePlatformRisk } = require("./scripts/monitorPlatformRisk");
const AviatorService = require("./services/aviatorService");
const aviatorRoutes = require("./routes/aviatorRoutes");

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

// Initialize services and make them available to routes
const aviatorService = new AviatorService(io);
app.use((req, res, next) => {
  req.io = io;
  req.aviatorService = aviatorService;
  next();
});

// Standard middleware
app.use(helmet());
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === "development" ? "dev" : "combined"));

const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // Reduced from 1000 for a more realistic limit
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", generalApiLimiter);

// Register API routes
const apiVersion = "/api/v1";
app.use(`${apiVersion}/auth`, require("./routes/authRoutes"));
app.use(`${apiVersion}/games`, require("./routes/gameRoutes"));
app.use(`${apiVersion}/bets`, require("./routes/betRoutes"));
app.use(`${apiVersion}/wallet`, require("./routes/walletRoutes"));
app.use(`${apiVersion}/admin`, require("./routes/adminRoutes"));
app.use(`${apiVersion}/users`, require("./routes/userRoutes"));
app.use(`${apiVersion}/ai`, require("./routes/aiRoutes"));
app.use(`${apiVersion}/aviator`, aviatorRoutes);

// Socket.IO Authentication Middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error("Authentication error: Token not provided."));
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return next(new Error("Authentication error: Invalid token."));
    }
    socket.user = decoded;
    next();
  });
});

// Socket.IO Connection Logic
io.on("connection", (socket) => {
  console.log(`✅ Authenticated socket connected: ${socket.id}`);
  socket.on("joinUserRoom", (userId) => {
    if (socket.user.id === userId) {
      socket.join(userId);
      console.log(
        `   - User ${socket.user.username} joined their room: ${userId}`
      );
    }
  });
  socket.on("disconnect", () => {
    console.log(`❌ Socket disconnected: ${socket.id}`);
  });
});

// Server Startup Logic
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

      // --- CORRECTED CRON JOB CONFIGURATION ---

      // 1. Sync LIVE and FINISHED games every minute from API-Football
      cron.schedule("* * * * *", () => {
        console.log("🕒 Cron: Syncing live and finished game data...");
        // This is the corrected line that calls the function
        syncLiveAndFinishedGames(io);
      });

      // 2. Sync UPCOMING games from both providers every 30 minutes
      cron.schedule("*/30 * * * *", () => {
        console.log("🕒 Cron: Fetching upcoming games from all providers...");
        syncGames("apifootball");
        syncGames("thesportsdb");
      });

      // 3. Monitor platform risk every 5 minutes
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
