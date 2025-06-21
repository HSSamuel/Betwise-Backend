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
const { syncGames, syncLiveGames } = require("./services/sportsDataService");
const { analyzePlatformRisk } = require("./scripts/monitorPlatformRisk");
const AviatorService = require("./services/aviatorService"); // Import the new Aviator service

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

// Create and start the Aviator game instance
const aviatorService = new AviatorService(io);
if (process.env.NODE_ENV !== "test") {
  aviatorService.start();
}

app.set("json spaces", 2);
app.use((req, res, next) => {
  req.io = io;
  // Make the aviator service instance available to all routes
  req.aviatorService = aviatorService;
  next();
});

app.use(helmet());
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === "development" ? "dev" : "combined"));

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

const apiVersion = "/api/v1";

app.use(`${apiVersion}/auth`, authLimiter, require("./routes/authRoutes"));
app.use(`${apiVersion}/games`, require("./routes/gameRoutes"));
app.use(`${apiVersion}/bets`, require("./routes/betRoutes"));
app.use(`${apiVersion}/wallet`, require("./routes/walletRoutes"));
app.use(`${apiVersion}/admin`, require("./routes/adminRoutes"));
app.use(`${apiVersion}/users`, require("./routes/userRoutes"));
app.use(`${apiVersion}/ai`, require("./routes/aiRoutes"));
// NEW: Add the routes for the Aviator game
app.use(`${apiVersion}/aviator`, require("./routes/aviatorRoutes"));

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

      cron.schedule("*/30 * * * *", () => {
        console.log("🕒 Cron: Fetching upcoming games from API-Football...");
        syncGames("apifootball");
      });

      setInterval(() => {
        console.log("🕒 Interval: Syncing live game data...");
        syncLiveGames(io);
      }, 60000);

      cron.schedule("*/15 * * * *", () => {
        console.log("🕒 Cron: Analyzing platform risk...");
        analyzePlatformRisk();
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
