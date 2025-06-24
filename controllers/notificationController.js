const Notification = require("../models/Notification");

// Get all notifications for the logged-in user
exports.getNotifications = async (req, res, next) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(100); // Limit to the last 100 notifications

    res.status(200).json({ notifications });
  } catch (error) {
    next(error);
  }
};

// Mark notifications as read
exports.markAsRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { $set: { isRead: true } }
    );
    res.status(200).json({ msg: "All notifications marked as read." });
  } catch (error) {
    next(error);
  }
};
