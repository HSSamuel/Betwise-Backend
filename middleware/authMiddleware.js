const jwt = require("jsonwebtoken");
const User = require("../models/User"); // Adjust path if your models are elsewhere
const TokenBlacklist = require("../models/TokenBlacklist"); // Adjust path if your models are elsewhere

// Custom Error class for Auth errors (optional, but helps standardize)
class AuthError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
  }
}

// Middleware to authenticate users via JWT
exports.auth = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AuthError(
        "No token, authorization denied. Please include a Bearer token.",
        401
      );
    }

    const token = authHeader.replace("Bearer ", "");

    // --- NEW: Check if token is on the blacklist ---
    const blacklistedToken = await TokenBlacklist.findOne({ token });
    if (blacklistedToken) {
      throw new AuthError(
        "Token is invalid or has been revoked (logged out).",
        401
      );
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET); // This can throw JsonWebTokenError or TokenExpiredError

    // Find the user by ID from the token, excluding the password
    const user = await User.findById(decoded.id).select("-password").lean(); // Use lean if not modifying user object here

    if (!user) {
      throw new AuthError("User not found, authorization denied.", 401);
    }

    // Attach the user object to the request for use in subsequent handlers
    req.user = user;
    next(); // Proceed to the next middleware or route handler
  } catch (error) {
    // Handle specific JWT errors and then pass to the global error handler
    if (error.name === "JsonWebTokenError") {
      return next(new AuthError("Token is not valid.", 401));
    }
    if (error.name === "TokenExpiredError") {
      return next(new AuthError("Token has expired.", 401));
    }
    // If it's already an AuthError, pass it on
    if (error instanceof AuthError) {
      return next(error);
    }
    // For other unexpected errors, create a generic server error
    const serverError = new Error("Server error during authentication.");
    serverError.statusCode = 500; // Or let the global handler default it
    next(serverError);
  }
};

// Middleware to authorize admin users
exports.isAdmin = (req, res, next) => {
  // This middleware assumes `auth` middleware has already run and populated `req.user`
  if (req.user && req.user.role === "admin") {
    next(); // User is an admin, proceed
  } else {
    // User is not an admin or user object is not present
    // For consistency, use next(err)
    const err = new Error("Access denied: Admin privileges required.");
    err.statusCode = 403; // Forbidden
    next(err);
  }
};
