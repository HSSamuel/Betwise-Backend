// In: Backend/index.js

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
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { syncGames } = require("./services/sportsDataService");
const { analyzePlatformRisk } = require("./scripts/monitorPlatformRisk");

const app = express();
const server = http.createServer(app);

// --- FIX: A more robust and flexible CORS configuration ---
const allowedOrigins = [
  "http://localhost:5173",
  "https://betwise-frontend-5uqq.vercel.app",
  "https://betwise-frontend-5uqq-hunsa-semakos-projects.vercel.app",
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg =
        "The CORS policy for this site does not allow access from the specified Origin.";
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
};

const io = new Server(server, {
  cors: corsOptions,
});

app.set("json spaces", 2);
app.use((req, res, next) => {
  req.io = io;
  next();
});

// --- Essential Middleware ---
app.use(helmet());
app.use(cors(corsOptions)); // Use the new flexible options
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === "development" ? "dev" : "combined"));

// --- Rate Limiting Setup ---
const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.API_RATE_LIMIT_MAX) || 100,
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
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
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
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(
        `🚀 Server running on port ${PORT} in ${
          process.env.NODE_ENV || "development"
        } mode.`
      );

      cron.schedule("*/30 * * * *", () => {
        console.log("🕒 Cron: Fetching upcoming games from API-Football...");
        syncGames("apifootball");
      });
      cron.schedule("0 */6 * * *", () => {
        console.log("🕒 Cron: Fetching upcoming games from TheSportsDB...");
        syncGames("thesportsdb");
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

if (process.env.NODE_ENV !== "test") {
  startServer();
}

module.exports = app;
