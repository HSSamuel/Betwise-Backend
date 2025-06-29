const winston = require("winston");
const config = require("../config/env");

// Create a logger instance
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    // - Write all logs with importance level of `error` or less to `error.log`
    // - Write all logs with importance level of `info` or less to `combined.log`
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

// If we're not in production, then log to the `console` with a simple format.
if (config.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
    })
  );
}

const errorHandler = (err, req, res, next) => {
  // Use the status code from the error object, or default to 500 (Internal Server Error)
  const statusCode = err.statusCode || 500;

  // Log the error using our new Winston logger
  logger.error(err.message, {
    statusCode,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

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
