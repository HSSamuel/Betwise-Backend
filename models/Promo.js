const mongoose = require("mongoose");

const promoSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Promotion title is required."],
      trim: true,
    },
    description: {
      type: String,
      required: [true, "A detailed description is required."],
    },
    promoType: {
      type: String,
      enum: ["Bonus", "FreeBet", "OddsBoost"],
      default: "Bonus",
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    expiresAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

promoSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model("Promo", promoSchema);
