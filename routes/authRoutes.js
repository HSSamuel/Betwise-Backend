const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const {
  handleValidationErrors,
} = require("../middleware/validationMiddleware"); // <-- IMPORT
const {
  validateRegister,
  validateLogin,
  validateRequestPasswordReset,
  validateResetPassword,
} = require("../controllers/authController");
const { auth } = require("../middleware/authMiddleware");
const passport = require("passport");
const { isAuthenticated } = require("../middleware/authMiddleware");

/**
 * @desc    Get logged in user data from cookie session
 * @route   GET /api/auth/me
 * @access  Private
 */
exports.getMe = async (req, res, next) => {
  // The isAuthenticated middleware already attaches the user to the request.
  res.status(200).json({
    success: true,
    user: req.user,
  });
};

// ## --- SOCIAL LOGIN---
// @route   GET /api/v1/auth/google
// @desc    Initiate Google OAuth login
// @access  Public
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// @route   GET /api/v1/auth/google/callback
// @desc    Google OAuth callback URL
// @access  Public
router.get(
  "/google/callback",
  passport.authenticate("google", { session: false }),
  authController.socialLoginCallback
);

// @route   GET /api/v1/auth/facebook
// @desc    Initiate Facebook OAuth login
// @access  Public
router.get(
  "/facebook",
  passport.authenticate("facebook", { scope: ["email"] })
);

// @route   GET /api/v1/auth/facebook/callback
// @desc    Facebook OAuth callback URL
// @access  Public
router.get(
  "/facebook/callback",
  passport.authenticate("facebook", { session: false }),
  authController.socialLoginCallback
);

router.post(
  "/register",
  validateRegister,
  handleValidationErrors,
  authController.register
);
router.post(
  "/login",
  validateLogin,
  handleValidationErrors,
  authController.login
);
router.post("/logout", auth, authController.logout); // No validation here
router.post("/refresh-token", authController.refreshToken); // No validation here

router.post(
  "/request-password-reset",
  validateRequestPasswordReset,
  handleValidationErrors,
  authController.requestPasswordReset
);
router.post(
  "/reset-password/:token",
  validateResetPassword,
  handleValidationErrors,
  authController.resetPassword
);

module.exports = router;
// This code defines the authentication routes for user registration, login, password reset, and social logins in an Express application.
