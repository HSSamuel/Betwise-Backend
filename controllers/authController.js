const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { body, validationResult } = require("express-validator");
const User = require("../models/User");
const TokenBlacklist = require("../models/TokenBlacklist");
const { sendEmail } = require("../services/emailService"); // <-- IMPORT from new service
const config = require("../config/env"); // <-- IMPORT the new config

// --- Helper Functions ---
const generateAccessToken = (user) => {
  const payload = { id: user._id, role: user.role, username: user.username };
  return jwt.sign(payload, config.JWT_SECRET, {
    // <-- USE config
    expiresIn: config.JWT_EXPIRES_IN, // <-- USE config
  });
};

const generateRefreshToken = (user) => {
  const payload = { id: user._id, username: user.username };
  return jwt.sign(payload, config.JWT_REFRESH_SECRET, {
    // <-- USE config
    expiresIn: config.JWT_REFRESH_EXPIRES_IN, // <-- USE config
  });
};

// --- Validation Rules ---
// --- Validation Rules ---
exports.validateRegister = [
  body("username")
    .trim()
    .isLength({ min: 3 })
    .withMessage("Username must be at least 3 characters long.")
    .escape(),
  body("email")
    .isEmail()
    .withMessage("Please provide a valid email address.")
    .normalizeEmail(),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long.")
    // FIX: Add password complexity enforcement
    .matches(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/
    )
    .withMessage(
      "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character."
    ),
  body("firstName")
    .trim()
    .notEmpty()
    .withMessage("First name is required.")
    .escape(),
  body("lastName")
    .trim()
    .notEmpty()
    .withMessage("Last name is required.")
    .escape(),
  body("state").optional().trim().escape(),
];
exports.validateLogin = [
  body("email")
    .isEmail()
    .withMessage("Please provide a valid email address.")
    .normalizeEmail(),
  body("password").notEmpty().withMessage("Password is required."),
];
exports.validateRequestPasswordReset = [
  body("email")
    .isEmail()
    .withMessage("Please provide a valid email address.")
    .normalizeEmail(),
];
exports.validateResetPassword = [
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long."),
  body("confirmPassword").custom((value, { req }) => {
    if (value !== req.body.password) {
      throw new Error("Passwords do not match.");
    }
    return true;
  }),
];

// --- Controller Functions ---

exports.register = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { username, email, password, firstName, lastName, state } = req.body;
  try {
    let user = await User.findOne({
      $or: [
        { username: username.toLowerCase() },
        { email: email.toLowerCase() },
      ],
    });
    if (user) {
      return res.status(400).json({ msg: "Username or email already exists." });
    }
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    user = new User({
      username: username.toLowerCase(),
      firstName,
      lastName,
      email: email.toLowerCase(),
      password: hashedPassword,
      state: state ? state.trim() : undefined,
    });
    await user.save();
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    res.status(201).json({
      msg: "User registered successfully.",
      accessToken: accessToken,
      refreshToken: refreshToken,
      user: {
        id: user._id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        state: user.state,
        role: user.role,
        walletBalance: user.walletBalance,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ msg: "Username or email already exists." });
    }
    next(error);
  }
};

// --- MODIFIED LOGIN FUNCTION ---
exports.login = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+password"
    );

    // Specific check for user not found
    if (!user) {
      const err = new Error("No account found with that email address.");
      err.statusCode = 401; // Unauthorized
      return next(err);
    }

    // Handle cases where user signed up with social media and has no password
    if (!user.password) {
      const err = new Error(
        "This account was created using a social login. Please sign in with Google or Facebook."
      );
      err.statusCode = 400; // Bad Request
      return next(err);
    }

    if (!user) {
      const err = new Error("No account found with that email address.");
      err.statusCode = 401;
      return next(err);
    }
    //...
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      const err = new Error("Incorrect password. Please try again.");
      err.statusCode = 401;
      return next(err);
    }

    // If successful, generate tokens and send user data
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    res.json({
      message: "Login successful",
      accessToken: accessToken,
      refreshToken: refreshToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        state: user.state,
        role: user.role,
        profilePicture: user.profilePicture,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.logout = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");
    const token = authHeader.replace("Bearer ", "");
    const decoded = jwt.decode(token);
    const expiresAt = new Date(decoded.exp * 1000);
    await new TokenBlacklist({ token, expiresAt }).save();
    res.status(200).json({ msg: "You have been logged out successfully." });
  } catch (error) {
    next(error);
  }
};

exports.refreshToken = async (req, res, next) => {
  const { token } = req.body;
  if (!token) {
    const err = new Error("Refresh token is required.");
    err.statusCode = 401;
    return next(err);
  }
  try {
    const decoded = jwt.verify(token, config.JWT_REFRESH_SECRET); // <-- USE config
    const user = await User.findById(decoded.id);
    if (!user) {
      const err = new Error("Invalid refresh token or user not found.");
      err.statusCode = 403; // Forbidden
      return next(err);
    }
    const newAccessToken = generateAccessToken(user);
    res.json({ accessToken: newAccessToken });
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      const error = new Error("Refresh token is invalid or expired.");
      error.statusCode = 403;
      return next(error);
    }
    next(err);
  }
};

exports.socialLoginCallback = async (req, res, next) => {
  try {
    const user = req.user;

    if (!user) {
      return res
        .status(401)
        .redirect(`${config.FRONTEND_URL}/login?error=auth_failed`); // <-- USE config
    }
    // 1. Generate Tokens
    const accessToken = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();

    // ... (cookie options)
    const cookieOptions = {
      httpOnly: true,
      secure: config.NODE_ENV === "production", // <-- USE config
      sameSite: "Strict",
    };

    res.cookie("accessToken", accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie("refreshToken", refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // 3. Instead of tokens, redirect to a dedicated success page
    // The frontend will use this page to confirm the login status.
    res.redirect(`${config.FRONTEND_URL}/social-auth-success`); // <-- USE config
  } catch (error) {
    console.error("Social login callback error:", error);
    res.redirect(`${config.FRONTEND_URL}/login?error=server_error`); // <-- USE config
  }
};

// --- Password Management Functions ---
exports.requestPasswordReset = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { email } = req.body;
  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // To prevent email enumeration, we always return a success-like message.
      return res.status(200).json({
        msg: "If your email address is registered with us, you will receive a password reset link shortly.",
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    user.passwordResetToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    user.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save({ validateBeforeSave: false });

    // --- MODIFICATION IS HERE ---

    const appName = config.APP_NAME; // <-- USE config
    // Create the full reset URL for the frontend
    const resetUrl = `${config.FRONTEND_URL}/reset-password/${resetToken}`; // <-- USE config

    // Create a more user-friendly HTML message
    const messageHtml = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Password Reset for ${appName}</h2>
        <p>You are receiving this email because you (or someone else) have requested the reset of a password for your account.</p>
        <p>Please click on the button below to complete the process. This link is only valid for 10 minutes.</p>
        <a href="${resetUrl}" style="background-color: #28a745; color: white; padding: 12px 25px; text-align: center; text-decoration: none; display: inline-block; border-radius: 5px; font-size: 16px;">Reset Your Password</a>
        <p style="margin-top: 20px;">If you did not request this, please ignore this email and your password will remain unchanged.</p>
        <hr>
        <p style="font-size: 12px; color: #777;">If you're having trouble clicking the button, copy and paste the following URL into your web browser:</p>
        <p style="font-size: 12px; color: #777;"><a href="${resetUrl}">${resetUrl}</a></p>
      </div>
    `;

    // --- END MODIFICATION ---

    try {
      // Send the email with the new HTML body
      await sendEmail({
        to: user.email,
        subject: `Your ${appName} Password Reset Link (valid for 10 min)`,
        html: messageHtml, // Use the 'html' property instead of 'message' for HTML content
      });

      res.status(200).json({
        msg: "If your email address is registered with us, you will receive a password reset link shortly.",
      });
    } catch (emailError) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      const serverError = new Error(
        "The server encountered an error trying to send the password reset email. Please try again later."
      );
      serverError.statusCode = 500;
      next(serverError);
    }
  } catch (error) {
    next(error);
  }
};

exports.resetPassword = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { password } = req.body;
  const plainTokenFromUrl = req.params.token;
  try {
    const hashedToken = crypto
      .createHash("sha256")
      .update(plainTokenFromUrl)
      .digest("hex");
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    });
    if (!user) {
      return res
        .status(400)
        .json({ msg: "Password reset token is invalid or has expired." });
    }
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();
    res.status(200).json({
      msg: "Password has been reset successfully. You can now log in with your new password.",
    });
  } catch (error) {
    next(error);
  }
};
