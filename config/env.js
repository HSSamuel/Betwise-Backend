// In: Bet/Backend/config/env.js
// This is a new file to centralize environment variable management.

require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});

/**
 * Asserts that a required environment variable is defined.
 * @param {string} variable - The name of the environment variable.
 * @param {string} description - A description of what the variable is for.
 * @returns {string} The value of the environment variable.
 * @throws {Error} If the environment variable is not defined.
 */
const assertVariable = (variable, description) => {
  const value = process.env[variable];
  if (value === undefined) {
    throw new Error(
      `Missing required environment variable: ${variable}. ${description}`
    );
  }
  return value;
};

const config = {
  // Server Configuration
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: process.env.PORT || 5000,
  API_CALLBACK_URL: assertVariable(
    "API_CALLBACK_URL",
    "The base URL for API callbacks (e.g., OAuth)."
  ),
  FRONTEND_URL: assertVariable(
    "FRONTEND_URL",
    "The URL of the frontend application."
  ),
  APP_NAME: process.env.APP_NAME || "BetWise",

  // Database Configuration
  MONGODB_URI: assertVariable(
    "MONGODB_URI",
    "The primary MongoDB connection string."
  ),
  MONGODB_TEST_URI: assertVariable(
    "MONGODB_TEST_URI",
    "The MongoDB connection string for the test environment."
  ),

  // Security & JWT Configuration
  JWT_SECRET: assertVariable(
    "JWT_SECRET",
    "Secret key for signing JWT access tokens."
  ),
  JWT_REFRESH_SECRET: assertVariable(
    "JWT_REFRESH_SECRET",
    "Secret key for signing JWT refresh tokens."
  ),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "1d",
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  API_RATE_LIMIT_MAX: parseInt(process.env.API_RATE_LIMIT_MAX || "100", 10),

  // External APIs
  GEMINI_API_KEY: assertVariable(
    "GEMINI_API_KEY",
    "API key for Google Gemini."
  ),
  APIFOOTBALL_KEY: assertVariable(
    "APIFOOTBALL_KEY",
    "API key for API-Football."
   ),
  ALLSPORTS_API_KEY: process.env.ALLSPORTS_API_KEY, // Added AllSportsApi key

  // Google APIs (OAuth & Search)
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY, // Optional for some scripts
  GOOGLE_CSE_ID: process.env.GOOGLE_CSE_ID, // Optional for some scripts
  GOOGLE_CLIENT_ID: assertVariable(
    "GOOGLE_CLIENT_ID",
    "Client ID for Google OAuth."
  ),
  GOOGLE_CLIENT_SECRET: assertVariable(
    "GOOGLE_CLIENT_SECRET",
    "Client secret for Google OAuth."
  ),

  // Facebook OAuth
  FACEBOOK_APP_ID: assertVariable(
    "FACEBOOK_APP_ID",
    "App ID for Facebook OAuth."
  ),
  FACEBOOK_APP_SECRET: assertVariable(
    "FACEBOOK_APP_SECRET",
    "App secret for Facebook OAuth."
  ),

  // Cloudinary for Image Storage
  CLOUDINARY_CLOUD_NAME: assertVariable(
    "CLOUDINARY_CLOUD_NAME",
    "Cloud name for Cloudinary."
  ),
  CLOUDINARY_API_KEY: assertVariable(
    "CLOUDINARY_API_KEY",
    "API key for Cloudinary."
  ),
  CLOUDINARY_API_SECRET: assertVariable(
    "CLOUDINARY_API_SECRET",
    "API secret for Cloudinary."
  ),

  // Flutterwave for Payments
  FLUTTERWAVE_PUBLIC_KEY: assertVariable(
    "FLUTTERWAVE_PUBLIC_KEY",
    "Public key for Flutterwave."
  ),
  FLUTTERWAVE_SECRET_KEY: assertVariable(
    "FLUTTERWAVE_SECRET_KEY",
    "Secret key for Flutterwave."
  ),
  FLUTTERWAVE_WEBHOOK_HASH: assertVariable(
    "FLUTTERWAVE_WEBHOOK_HASH",
    "Webhook secret hash for Flutterwave."
  ),

  // Nodemailer for Emails
  EMAIL_SERVICE: process.env.EMAIL_SERVICE || "gmail",
  EMAIL_USER: assertVariable(
    "EMAIL_USER",
    "Username for the email sending service."
  ),
  EMAIL_PASS: assertVariable(
    "EMAIL_PASS",
    "Password for the email sending service."
  ),
  EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || "BetWise",

  // Application Logic & Scripts
  ML_MODEL_API_URL: process.env.ML_MODEL_API_URL, // Optional for a script
  PLATFORM_RISK_THRESHOLD: parseFloat(
    process.env.PLATFORM_RISK_THRESHOLD || "10000"
  ),
  ADMIN_ALERT_EMAIL: process.env.ADMIN_ALERT_EMAIL, // Optional for a script
};

module.exports = config;
