const express = require("express");
const multer = require("multer");
const { storage } = require("../config/cloudinary"); // Import storage config
const upload = multer({ storage });
const router = express.Router();
const {
  getProfile,
  updateProfile,
  validateUpdateProfile,
  changeEmail,
  changePassword,
  setPassword,
  validateChangeEmail,
  validateChangePassword,
  validateSetPassword,
  setBettingLimits,
  validateSetLimits,
  uploadProfilePicture,
  getUserStats,
  getUserStatsHistory,
} = require("../controllers/userController");
const { auth } = require("../middleware/authMiddleware");
const {
  handleValidationErrors,
} = require("../middleware/validationMiddleware"); // <-- IMPORT MIDDLEWARE

// @route   GET /users/profile
// @desc    Get current logged-in user's profile
// @access  Private (Authenticated User)
router.get("/profile", auth, getProfile);

// @route   PATCH /users/email
// @desc    Change current logged-in user's email
// @access  Private (Authenticated User)
router.patch(
  "/email",
  auth,
  validateChangeEmail,
  handleValidationErrors,
  changeEmail
); // <-- USE MIDDLEWARE

// @route   PATCH /users/password
// @desc    Change current logged-in user's password
// @access  Private (Authenticated User)
router.patch(
  "/password",
  auth,
  validateChangePassword,
  handleValidationErrors,
  changePassword
); // <-- USE MIDDLEWARE

// --- NEW ROUTE ---
// @route   POST /users/set-password
// @desc    Allows a logged-in user to set a password for the first time (e.g., after social login)
// @access  Private (Authenticated User)
router.post(
  "/set-password",
  auth,
  validateSetPassword,
  handleValidationErrors,
  setPassword
); // <-- USE MIDDLEWARE

// @route   POST /users/limits
// @desc    Set or update the user's weekly betting limits
// @access  Private (Authenticated User)
router.post(
  "/limits",
  auth,
  validateSetLimits,
  handleValidationErrors,
  setBettingLimits
); // <-- USE MIDDLEWARE

// --- NEW ROUTE ---
// @route   PATCH /users/profile
// @desc    Update current logged-in user's profile information
// @access  Private (Authenticated User)
router.patch(
  "/profile",
  auth,
  validateUpdateProfile,
  handleValidationErrors,
  updateProfile
); // <-- USE MIDDLEWARE

// @route   POST /users/profile-picture
// @desc    Upload or change a user's profile picture
// @access  Private
router.post(
  "/profile-picture",
  auth,
  upload.single("profilePicture"), // "profilePicture" must match the form field name
  uploadProfilePicture
);

// --- Implementation: Add the new route for user stats ---
// @route   GET /users/stats
// @desc    Get detailed betting statistics for the logged-in user
// @access  Private (Authenticated User)
router.get("/stats", auth, getUserStats);

// @route   GET /users/stats/history
// @desc    Get aggregated historical stats for charts
// @access  Private (Authenticated User)
router.get("/stats/history", auth, getUserStatsHistory);

module.exports = router;
