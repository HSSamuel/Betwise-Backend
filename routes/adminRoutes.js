const express = require("express");
const router = express.Router();
const { auth, isAdmin } = require("../middleware/authMiddleware");
const {
  handleValidationErrors,
} = require("../middleware/validationMiddleware");
const { param } = require("express-validator");

const adminController = require("../controllers/adminController");
const { validateGameId } = require("../controllers/gameController");

// --- Implementation: Import Ranking Controllers ---
const {
  getRankings,
  createRanking,
  updateRanking,
  deleteRanking,
  validateCreateRanking,
  validateUpdateRanking,
} = require("../controllers/rankingControllers");

// --- Admin Dashboard & Stats ---
router.get("/dashboard/financial", adminController.getFinancialDashboard);
router.get("/stats/platform", adminController.getPlatformStats);

// --- User Management by Admin ---
router.get(
  "/users",
  adminController.validateListUsers,
  handleValidationErrors,
  adminController.listUsers
);
router.get("/all-users-full", adminController.getAllUsersFullDetails);
router.get(
  "/users/:id/details",
  adminController.validateAdminUserAction,
  handleValidationErrors,
  adminController.adminGetUserDetail
);
router.patch(
  "/users/:id/role",
  adminController.validateAdminUpdateRole,
  handleValidationErrors,
  adminController.adminUpdateUserRole
);
router.patch(
  "/users/:id/wallet",
  adminController.validateAdminAdjustWallet,
  handleValidationErrors,
  adminController.adminAdjustUserWallet
);
router.delete(
  "/users/:id",
  adminController.validateAdminUserAction,
  adminController.adminDeleteUser
);

// --- Withdrawal Management ---
router.get("/withdrawals", adminController.adminGetWithdrawals);
router.patch(
  "/withdrawals/:id/process",
  adminController.validateProcessWithdrawal,
  handleValidationErrors,
  adminController.adminProcessWithdrawal
);

// --- Game Management & Risk ---
router.post("/games/sync", adminController.manualGameSync);
router.get(
  "/games/:id/risk",
  validateGameId,
  handleValidationErrors,
  adminController.getGameRiskAnalysis
);
router.get(
  "/games/:id/risk-summary",
  validateGameId,
  handleValidationErrors,
  adminController.getGameRiskSummary
);
router.get("/risk/overview", adminController.getRiskOverview);
router.delete(
  "/games/:id",
  validateGameId,
  handleValidationErrors,
  adminController.adminDeleteGame
);

// --- Team Power Rankings Routes ---
router.get("/rankings", getRankings);
router.post(
  "/rankings",
  validateCreateRanking,
  handleValidationErrors,
  createRanking
);
router.patch(
  "/rankings/:id",
  [param("id").isMongoId()],
  validateUpdateRanking,
  handleValidationErrors,
  updateRanking
);
router.delete(
  "/rankings/:id",
  [param("id").isMongoId()],
  handleValidationErrors,
  deleteRanking
);

module.exports = router;
