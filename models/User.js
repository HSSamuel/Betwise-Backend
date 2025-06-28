const mongoose = require("mongoose");

const payoutDetailsSchema = new mongoose.Schema(
  {
    bankName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    accountName: { type: String, trim: true },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "Username is required."],
      unique: true,
      trim: true,
      minlength: [3, "Username must be at least 3 characters long."],
    },
    firstName: {
      type: String,
      required: [true, "First name is required."],
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, "Last name is required."],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email address is required."],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        "Please provide a valid email address.",
      ],
    },
    profilePicture: {
      type: String,
      default: "",
    },
    password: {
      type: String,
      minlength: [
        6,
        "Password must be at least 6 characters long if provided.",
      ],
      select: false,
    },
    state: { type: String, trim: true },
    googleId: { type: String, unique: true, sparse: true },
    facebookId: { type: String, unique: true, sparse: true },
    walletBalance: {
      type: Number,
      required: [true, "Wallet balance is required."],
      default: 1000,
      min: [0, "Wallet balance cannot be negative."],
    },
    role: {
      type: String,
      enum: {
        values: ["user", "admin"],
        message: 'Role "{VALUE}" is not supported.',
      },
      default: "user",
    },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },

    // ** NEW & UPDATED FIELDS **
    isOnline: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },

    favoriteLeagues: { type: [String], default: [] },
    responsibleGambling: {
      status: {
        type: String,
        enum: ["ok", "at_risk", "restricted"],
        default: "ok",
      },
      lastChecked: { type: Date },
      riskFactors: [String],
    },
    flags: {
      isFlaggedForFraud: { type: Boolean, default: false },
      fraudReason: { type: String, default: "" },
    },
    limits: {
      weeklyBetCount: {
        limit: { type: Number, default: 0 },
        currentCount: { type: Number, default: 0 },
        resetDate: {
          type: Date,
          default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
      weeklyStakeAmount: {
        limit: { type: Number, default: 0 },
        currentAmount: { type: Number, default: 0 },
        resetDate: {
          type: Date,
          default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
    },
    payoutDetails: {
      type: payoutDetailsSchema,
      default: {},
    },
  },
  { timestamps: true }
);

userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.virtual("hasPassword").get(function () {
  return !!this.password;
});

userSchema.set("toJSON", { virtuals: true });
userSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("User", userSchema);
