// models/Withdrawal.js

const mongoose = require("mongoose");

const withdrawalSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [1, "Withdrawal amount must be at least 1."], // Or your desired minimum
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    // Optional notes from the admin who processes the request
    adminNotes: {
      type: String,
      trim: true,
    },
    processedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

withdrawalSchema.index({ status: 1, user: 1 });

module.exports = mongoose.model("Withdrawal", withdrawalSchema);
