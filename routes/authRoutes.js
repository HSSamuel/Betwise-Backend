const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const {
  handleValidationErrors,
} = require("../middleware/validationMiddleware");
const { auth } = require("../middleware/authMiddleware");
const passport = require("passport");

// This route now correctly uses the imported auth and authController.getMe
router.get("/me", auth, authController.getMe);

router.post(
  "/register",
  authController.validateRegister,
  handleValidationErrors,
  authController.register
);
router.post(
  "/login",
  authController.validateLogin,
  handleValidationErrors,
  authController.login
);
router.post("/logout", auth, authController.logout);
router.post("/refresh-token", authController.refreshToken);
router.post(
  "/request-password-reset",
  authController.validateRequestPasswordReset,
  handleValidationErrors,
  authController.requestPasswordReset
);
router.post(
  "/reset-password/:token",
  authController.validateResetPassword,
  handleValidationErrors,
  authController.resetPassword
);

router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);
router.get(
  "/google/callback",
  passport.authenticate("google", { session: false }),
  authController.socialLoginCallback
);
router.get(
  "/facebook",
  passport.authenticate("facebook", { scope: ["email"] })
);
router.get(
  "/facebook/callback",
  passport.authenticate("facebook", { session: false }),
  authController.socialLoginCallback
);

module.exports = router;
