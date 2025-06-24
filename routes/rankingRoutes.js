const express = require("express");
const router = express.Router();
const { auth, isAdmin } = require("../middleware/authMiddleware");
const {
  handleValidationErrors,
} = require("../middleware/validationMiddleware");

const {
  getPlatformStats,
  getFinancialDashboard,
  listUsers,
  // ... other admin controllers
  adminDeleteGame,
} = require("../controllers/adminController");

// --- Implementation: Import Ranking Controllers here ---
const {
  getRankings,
  createRanking,
  updateRanking,
  deleteRanking,
  validateCreateRanking,
  validateUpdateRanking,
} = require("../controllers/rankingControllers");

const { manualGameSync } = require("../controllers/adminController");
const { validateGameId } = require("../controllers/gameController");
const { param } = require("express-validator");

// ... existing admin routes for Dashboard, Users, Withdrawals, etc.

// --- Implementation: Add routes for Team Power Rankings ---

// @route   GET /api/v1/admin/rankings
// @desc    Admin: Get all team rankings
// @access  Private (Admin)
router.get("/rankings", getRankings);

// @route   POST /api/v1/admin/rankings
// @desc    Admin: Create a new team ranking
// @access  Private (Admin)
router.post(
  "/rankings",
  validateCreateRanking,
  handleValidationErrors,
  createRanking
);

// @route   PATCH /api/v1/admin/rankings/:id
// @desc    Admin: Update an existing team ranking
// @access  Private (Admin)
router.patch(
  "/rankings/:id",
  [param("id").isMongoId()],
  validateUpdateRanking,
  handleValidationErrors,
  updateRanking
);

// @route   DELETE /api/v1/admin/rankings/:id
// @desc    Admin: Delete a team ranking
// @access  Private (Admin)
router.delete(
  "/rankings/:id",
  [param("id").isMongoId()],
  handleValidationErrors,
  deleteRanking
);

module.exports = router;
