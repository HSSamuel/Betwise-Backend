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
const Game = require("./models/Game");
const cron = require("node-cron");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { syncGames, syncLiveGames } = require("./services/sportsDataService");
const { analyzePlatformRisk } = require("./scripts/monitorPlatformRisk");
const AviatorService = require("./services/aviatorService");

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:5173",
  "https://betwise-frontend-5uqq.vercel.app",
];

const corsOptions = {
  origin: allowedOrigins,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

const io = new Server(server, {
  cors: corsOptions,
  path: "/betwise-socket/",
});

const aviatorService = new AviatorService(io);
if (process.env.NODE_ENV !== "test") {
  aviatorService.start();
}

app.set("json spaces", 2);
app.use((req, res, next) => {
  req.io = io;
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

const apiVersion = "/api/v1";

// --- START OF FIX: Apply limiters to each route individually ---
app.use(`${apiVersion}/auth`, authLimiter, require("./routes/authRoutes"));
app.use(
  `${apiVersion}/games`,
  generalApiLimiter,
  require("./routes/gameRoutes")
);
app.use(`${apiVersion}/bets`, generalApiLimiter, require("./routes/betRoutes"));
app.use(
  `${apiVersion}/wallet`,
  generalApiLimiter,
  require("./routes/walletRoutes")
);
app.use(
  `${apiVersion}/admin`,
  generalApiLimiter,
  require("./routes/adminRoutes")
);
app.use(
  `${apiVersion}/users`,
  generalApiLimiter,
  require("./routes/userRoutes")
);
app.use(`${apiVersion}/ai`, generalApiLimiter, require("./routes/aiRoutes"));
app.use(
  `${apiVersion}/aviator`,
  generalApiLimiter,
  require("./routes/aviatorRoutes")
);
// --- END OF FIX ---

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    const err = new Error("Authentication error: Token not provided.");
    err.data = { code: "NO_TOKEN" };
    return next(err);
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      const newErr = new Error("Authentication error: Invalid token.");
      newErr.data = { code: "INVALID_TOKEN", reason: err.message };
      return next(newErr);
    }
    socket.user = decoded;
    next();
  });
});

io.on("connection", (socket) => {
  console.log(`✅ Authenticated socket connected: ${socket.id}`);

  const sendCurrentLiveGames = async () => {
    try {
      const liveGames = await Game.find({
        $or: [
          { status: "live" },
          { status: "upcoming", matchDate: { $lte: new Date() } },
        ],
      });
      socket.emit("allLiveGames", liveGames);
    } catch (error) {
      console.error("Error fetching initial live games for socket:", error);
    }
  };
  sendCurrentLiveGames();

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
