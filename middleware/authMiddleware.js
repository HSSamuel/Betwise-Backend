const jwt = require("jsonwebtoken");
const User = require("../models/User");
const TokenBlacklist = require("../models/TokenBlacklist");

class AuthError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
  }
}

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

    const blacklistedToken = await TokenBlacklist.findOne({ token });
    if (blacklistedToken) {
      throw new AuthError(
        "Token is invalid or has been revoked (logged out).",
        401
      );
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password").lean();

    if (!user) {
      throw new AuthError("User not found, authorization denied.", 401);
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return next(new AuthError("Token is not valid.", 401));
    }
    if (error.name === "TokenExpiredError") {
      return next(new AuthError("Token has expired.", 401));
    }
    if (error instanceof AuthError) {
      return next(error);
    }
    const serverError = new Error("Server error during authentication.");
    serverError.statusCode = 500;
    next(serverError);
  }
};

exports.isAdmin = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    const err = new Error("Access denied: Admin privileges required.");
    err.statusCode = 403;
    next(err);
  }
};
