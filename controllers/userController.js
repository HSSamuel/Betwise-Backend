const { body, validationResult } = require("express-validator");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

// --- Validation Rules ---
exports.validateChangeEmail = [
  body("newEmail")
    .isEmail()
    .withMessage("Please provide a valid new email address.")
    .normalizeEmail(),
  body("currentPassword")
    .notEmpty()
    .withMessage("Current password is required."),
];

exports.setPassword = async (req, res, next) => {
  const { newPassword } = req.body;
  const userId = req.user._id; // Get user ID from their auth token

  try {
    const user = await User.findById(userId);
    if (!user) {
      const err = new Error("User not found.");
      err.statusCode = 404;
      return next(err);
    }

    // Check if user already has a password. If so, they should use the "change password" flow instead.
    if (user.password) {
      const err = new Error(
        "This account already has a password. Please use the 'change password' feature."
      );
      err.statusCode = 400;
      return next(err);
    }

    // Hash and set the new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    res.json({
      msg: "Password has been successfully created for your account.",
    });
  } catch (error) {
    next(error);
  }
};

exports.validateUpdateProfile = [
  body("firstName")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("First name cannot be empty."),
  body("lastName")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Last name cannot be empty."),
  body("state").optional().trim(),
];

exports.validateSetPassword = [
  body("newPassword")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long."),
  body("confirmPassword").custom((value, { req }) => {
    if (value !== req.body.newPassword) {
      throw new Error("Passwords do not match.");
    }
    return true;
  }),
];

exports.validateChangePassword = [
  body("currentPassword")
    .notEmpty()
    .withMessage("Current password is required."),
  body("newPassword")
    .isLength({ min: 6 })
    .withMessage("New password must be at least 6 characters long."),
  body("confirmNewPassword").custom((value, { req }) => {
    if (value !== req.body.newPassword) {
      throw new Error("New password and confirmation password do not match.");
    }
    return true;
  }),
];

exports.validateSetLimits = [
  body("weeklyBetCountLimit")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Bet count limit must be a positive number or 0."),
  body("weeklyStakeAmountLimit")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Stake amount limit must be a positive number or 0."),
];

exports.setBettingLimits = async (req, res, next) => {
  try {
    const { weeklyBetCountLimit, weeklyStakeAmountLimit } = req.body;
    const user = await User.findById(req.user._id);

    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    if (weeklyBetCountLimit !== undefined) {
      user.limits.weeklyBetCount.limit = weeklyBetCountLimit;
      user.limits.weeklyBetCount.currentCount = 0; // Reset counter
      user.limits.weeklyBetCount.resetDate = sevenDaysFromNow;
    }
    if (weeklyStakeAmountLimit !== undefined) {
      user.limits.weeklyStakeAmount.limit = weeklyStakeAmountLimit;
      user.limits.weeklyStakeAmount.currentAmount = 0; // Reset counter
      user.limits.weeklyStakeAmount.resetDate = sevenDaysFromNow;
    }

    await user.save();
    res.status(200).json({
      message: "Your betting limits have been updated successfully.",
      limits: user.limits,
    });
  } catch (error) {
    next(error);
  }
};

// Get current user's profile
exports.getProfile = async (req, res, next) => {
  try {
    // FIX #2: Use req.user._id instead of req.user.id
    const user = await User.findById(req.user._id).select("-password").lean();

    if (!user) {
      const err = new Error("User profile not found.");
      err.statusCode = 404;
      return next(err);
    }
    res.json(user);
  } catch (error) {
    next(error);
  }
};

// Change current user's email
exports.changeEmail = async (req, res, next) => {
  const { newEmail, currentPassword } = req.body;

  try {
    // FIX #1 & #2: Use req.user._id AND add .select('+password')
    const user = await User.findById(req.user._id).select("+password");

    if (!user) {
      const err = new Error("User not found.");
      err.statusCode = 404;
      return next(err);
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      const err = new Error("Incorrect current password provided.");
      err.statusCode = 401; // Unauthorized
      return next(err);
    }

    if (newEmail === user.email) {
      const err = new Error(
        "New email cannot be the same as the current email."
      );
      err.statusCode = 400;
      return next(err);
    }

    const emailExists = await User.findOne({ email: newEmail });
    if (emailExists && emailExists._id.toString() !== user._id.toString()) {
      const err = new Error(
        "This email address is already in use by another account."
      );
      err.statusCode = 400;
      return next(err);
    }

    user.email = newEmail;
    await user.save();

    res.json({ msg: "Email updated successfully." });
  } catch (error) {
    if (error.code === 11000) {
      const customError = new Error("This email address is already in use.");
      customError.statusCode = 400;
      return next(customError);
    }
    next(error);
  }
};

// Change current user's password
exports.changePassword = async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  try {
    // FIX #1 & #2: Use req.user._id AND add .select('+password')
    const user = await User.findById(req.user._id).select("+password");

    if (!user) {
      const err = new Error("User not found.");
      err.statusCode = 404;
      return next(err);
    }

    const isCurrentPasswordMatch = await bcrypt.compare(
      currentPassword,
      user.password
    );
    if (!isCurrentPasswordMatch) {
      const err = new Error("Incorrect current password.");
      err.statusCode = 401; // Unauthorized
      return next(err);
    }

    const isNewPasswordSameAsOld = await bcrypt.compare(
      newPassword,
      user.password
    );
    if (isNewPasswordSameAsOld) {
      const err = new Error(
        "New password cannot be the same as the current password."
      );
      err.statusCode = 400;
      return next(err);
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    res.json({ msg: "Password updated successfully." });
  } catch (error) {
    next(error);
  }
};

// --- Controller function to update user profile ---
exports.updateProfile = async (req, res, next) => {
  try {
    const { firstName, lastName, state } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      const err = new Error("User not found.");
      err.statusCode = 404;
      return next(err);
    }

    // Update fields only if they are provided in the request
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (state) user.state = state;

    await user.save();

    res.status(200).json({
      msg: "Profile updated successfully.",
      user,
    });
  } catch (error) {
    next(error);
  }
};

// --- NEW: Controller function to handle profile picture upload ---
exports.uploadProfilePicture = async (req, res, next) => {
  try {
    if (!req.file) {
      const err = new Error("No image file provided.");
      err.statusCode = 400;
      return next(err);
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      const err = new Error("User not found.");
      err.statusCode = 404;
      return next(err);
    }

    // req.file.path contains the URL from Cloudinary
    user.profilePicture = req.file.path;
    await user.save();

    res.status(200).json({
      msg: "Profile picture updated successfully.",
      profilePictureUrl: user.profilePicture,
    });
  } catch (error) {
    next(error);
  }
};
