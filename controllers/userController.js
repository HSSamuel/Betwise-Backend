const { body, validationResult } = require("express-validator");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Bet = require("../models/Bet");
const Transaction = require("../models/Transaction");
const mongoose = require("mongoose");

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

// --- Controller Functions ---

exports.getProfile = async (req, res, next) => {
  try {
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

exports.changeEmail = async (req, res, next) => {
  const { newEmail, currentPassword } = req.body;
  try {
    const user = await User.findById(req.user._id).select("+password");
    if (!user) {
      const err = new Error("User not found.");
      err.statusCode = 404;
      return next(err);
    }
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      const err = new Error("Incorrect current password provided.");
      err.statusCode = 401;
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

exports.changePassword = async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  try {
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
      err.statusCode = 401;
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

exports.setPassword = async (req, res, next) => {
  const { newPassword } = req.body;
  const userId = req.user._id;
  try {
    const user = await User.findById(userId).select("+password");
    if (!user) {
      const err = new Error("User not found.");
      err.statusCode = 404;
      return next(err);
    }
    if (user.password) {
      const err = new Error(
        "This account already has a password. Please use the 'change password' feature."
      );
      err.statusCode = 400;
      return next(err);
    }
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

exports.setBettingLimits = async (req, res, next) => {
  try {
    const { weeklyBetCountLimit, weeklyStakeAmountLimit } = req.body;
    const user = await User.findById(req.user._id);
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (weeklyBetCountLimit !== undefined) {
      user.limits.weeklyBetCount.limit = weeklyBetCountLimit;
      user.limits.weeklyBetCount.currentCount = 0;
      user.limits.weeklyBetCount.resetDate = sevenDaysFromNow;
    }
    if (weeklyStakeAmountLimit !== undefined) {
      user.limits.weeklyStakeAmount.limit = weeklyStakeAmountLimit;
      user.limits.weeklyStakeAmount.currentAmount = 0;
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

exports.updateProfile = async (req, res, next) => {
  try {
    const { firstName, lastName, state } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) {
      const err = new Error("User not found.");
      err.statusCode = 404;
      return next(err);
    }
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

exports.getUserStats = async (req, res, next) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user._id);
    const stats = await Bet.aggregate([
      { $match: { user: userId, status: { $in: ["won", "lost"] } } },
      {
        $group: {
          _id: "$status",
          totalAmount: { $sum: "$stake" },
          totalPayout: { $sum: "$payout" },
          count: { $sum: 1 },
        },
      },
    ]);
    let totalStaked = 0;
    let totalWon = 0;
    let betsWon = 0;
    let betsLost = 0;
    stats.forEach((stat) => {
      if (stat._id === "won") {
        betsWon = stat.count;
        totalWon = stat.totalPayout;
        totalStaked += stat.totalAmount;
      } else if (stat._id === "lost") {
        betsLost = stat.count;
        totalStaked += stat.totalAmount;
      }
    });
    const netProfit = totalWon - totalStaked;
    const winRate = (betsWon / (betsWon + betsLost)) * 100 || 0;
    res.status(200).json({
      betsWon,
      betsLost,
      totalStaked: parseFloat(totalStaked.toFixed(2)),
      netProfit: parseFloat(netProfit.toFixed(2)),
      winRate: parseFloat(winRate.toFixed(2)),
    });
  } catch (error) {
    next(error);
  }
};

exports.getUserStatsHistory = async (req, res, next) => {
  try {
    if (!req.user || !req.user._id) {
      const err = new Error("Authentication error, user not found.");
      err.statusCode = 401;
      return next(err);
    }
    const userId = new mongoose.Types.ObjectId(req.user._id);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const history = await Transaction.aggregate([
      {
        $match: {
          user: userId,
          createdAt: { $gte: thirtyDaysAgo },
          type: { $in: ["bet", "win"] },
          amount: { $type: "number" },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          totalStaked: {
            $sum: {
              $cond: [{ $eq: ["$type", "bet"] }, { $abs: "$amount" }, 0],
            },
          },
          totalWon: {
            $sum: { $cond: [{ $eq: ["$type", "win"] }, "$amount", 0] },
          },
        },
      },
      {
        $project: {
          date: "$_id",
          netProfit: { $subtract: ["$totalWon", "$totalStaked"] },
          _id: 0,
        },
      },
      { $sort: { date: 1 } },
    ]);

    res.status(200).json({ history });
  } catch (error) {
    console.error("Error in getUserStatsHistory:", error);
    next(error);
  }
};
