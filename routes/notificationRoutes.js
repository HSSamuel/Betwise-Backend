const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/authMiddleware");
const {
  getNotifications,
  markAsRead,
} = require("../controllers/notificationController");

router.get("/", auth, getNotifications);
router.patch("/read", auth, markAsRead);

module.exports = router;
