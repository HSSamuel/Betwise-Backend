// In: Bet/Backend/middleware/errorMiddleware.js
// This is a new file for centralized error handling.

const config = require("../config/env");

const errorHandler = (err, req, res, next) => {
  // Use the status code from the error object, or default to 500 (Internal Server Error)
  const statusCode = err.statusCode || 500;

  // In development mode, log the full error stack for easier debugging.
  // In production, a more sophisticated logger like Winston or Sentry would be ideal.
  if (config.NODE_ENV === "development") {
    console.error(err.stack);
  }

  // Default error response structure
  const errorResponse = {
    msg: err.message || "An unexpected server error occurred.",
    // Only include the stack trace in the response if in development mode
    ...(config.NODE_ENV === "development" && { stack: err.stack }),
  };

  // Handle specific Mongoose validation errors for more user-friendly messages
  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map((val) => val.message);
    errorResponse.msg = messages.join(" ");
    return res.status(400).json(errorResponse);
  }

  // Handle Mongoose duplicate key errors (e.g., unique username or email)
  if (err.code && err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const value = err.keyValue[field];
    errorResponse.msg = `The ${field} '${value}' is already taken.`;
    return res.status(400).json(errorResponse);
  }

  // Send the final formatted error response to the client
  res.status(statusCode).json(errorResponse);
};

module.exports = errorHandler;
