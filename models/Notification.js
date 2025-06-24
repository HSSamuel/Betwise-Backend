const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: [
        "bet_won",
        "bet_lost",
        "withdrawal_approved",
        "withdrawal_rejected",
        "promo",
        "announcement",
      ],
      default: "announcement",
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    // Optional: A link to navigate to when the notification is clicked
    link: {
      type: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
