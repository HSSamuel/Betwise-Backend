const express = require("express");
const router = express.Router();
const { auth, isAdmin } = require("../middleware/authMiddleware");
const {
  handleValidationErrors,
} = require("../middleware/validationMiddleware");
const { param } = require("express-validator");
const {
  getRankings,
  createRanking,
  updateRanking,
  deleteRanking,
  validateCreateRanking,
  validateUpdateRanking,
} = require("../controllers/rankingControllers");

// @route   GET /api/v1/admin/rankings
router.get("/", getRankings);

// @route   POST /api/v1/admin/rankings
router.post(
  "/",
  auth,
  isAdmin,
  validateCreateRanking,
  handleValidationErrors,
  createRanking
);

// @route   PATCH /api/v1/admin/rankings/:id
router.patch(
  "/:id",
  auth,
  isAdmin,
  [param("id").isMongoId()],
  validateUpdateRanking,
  handleValidationErrors,
  updateRanking
);

// @route   DELETE /api/v1/admin/rankings/:id
router.delete(
  "/:id",
  auth,
  isAdmin,
  [param("id").isMongoId()],
  handleValidationErrors,
  deleteRanking
);

module.exports = router;
