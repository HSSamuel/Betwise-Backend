const config = require("./config/env");
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
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { fetchAndSyncGames } = require("./services/sportsDataService");
const { analyzePlatformRisk } = require("./scripts/monitorPlatformRisk");
const { syncGames, syncLiveGames } = require("./services/sportsDataService");
const errorHandler = require("./middleware/errorMiddleware"); // <-- IMPORT the new middleware

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: config.FRONTEND_URL,
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization", "Content-Type"],
    credentials: true,
  },
});

app.set("json spaces", 2);
app.use((req, res, next) => {
  req.io = io;
  next();
});

// --- Essential Middleware ---
app.use(helmet());
app.use(cors({ origin: config.FRONTEND_URL }));
app.use(express.json());
app.use(morgan(config.NODE_ENV === "development" ? "dev" : "combined"));

// --- Rate Limiting Setup ---
const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.API_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    msg: "Too many authentication attempts from this IP, please try again after 15 minutes.",
  },
});

app.use("/api", generalApiLimiter);

// --- Route Definitions (with API Versioning) ---
const apiVersion = "/api/v1";

app.use(`${apiVersion}/auth`, authLimiter, require("./routes/authRoutes"));
app.use(`${apiVersion}/games`, require("./routes/gameRoutes"));
app.use(`${apiVersion}/bets`, require("./routes/betRoutes"));
app.use(`${apiVersion}/wallet`, require("./routes/walletRoutes"));
app.use(`${apiVersion}/admin`, require("./routes/adminRoutes"));
app.use(`${apiVersion}/users`, require("./routes/userRoutes"));
app.use(`${apiVersion}/ai`, require("./routes/aiRoutes"));

// --- Socket.IO Authentication Middleware ---
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error("Authentication error: Token not provided."));
  }
  jwt.verify(token, config.JWT_SECRET, (err, decoded) => {
    // <-- USE config
    if (err) {
      return next(new Error("Authentication error: Invalid token."));
    }
    socket.user = decoded;
    next();
  });
});

// --- Centralized Socket.IO Connection Logic ---
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

// --- Server Startup ---
const startServer = async () => {
  try {
    await connectDB();
    const PORT = config.PORT; // <-- USE config
    server.listen(PORT, () => {
      console.log(
        `🚀 Server running on port ${PORT} in ${config.NODE_ENV} mode.` // <-- USE config
      );

      // Fetch from API-Football once every hour
      cron.schedule("0 * * * *", () => {
        console.log("🕒 Cron: Fetching upcoming games from API-Football...");
        syncGames("apifootball");
      });

      // Fetch from TheSportsDB once every two hours
      cron.schedule("0 */2 * * *", () => {
        console.log("🕒 Cron: Fetching upcoming games from TheSportsDB...");
        syncGames("thesportsdb");
      });

      // FIX: Add a new cron job to fetch LIVE game data every minute
      cron.schedule("* * * * *", () => {
        console.log("🕒 Cron: Fetching LIVE game data...");
        // Pass the io instance so the service can emit updates
        syncLiveGames(io);
      });

      console.log("✅ All background tasks have been scheduled.");
    });
  } catch (dbConnectionError) {
    console.error(
      "❌ Failed to connect to database. Server not started.",
      dbConnectionError.message
    );
    process.exit(1);
  }
};

if (config.NODE_ENV !== "test") {
  // <-- USE config
  startServer();
}

app.use(errorHandler); // <-- USE the new middleware
