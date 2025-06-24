const express = require("express");
const router = express.Router();
const { auth, isAdmin } = require("../middleware/authMiddleware");
const {
  handleValidationErrors,
} = require("../middleware/validationMiddleware");
const {
  getActivePromotions,
  getAllPromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
  validatePromo,
} = require("../controllers/promoController");
const { param } = require("express-validator");

// --- Public Route ---
// @route   GET /api/v1/promotions
// @desc    Get all active promotions for users
// @access  Public
router.get("/", getActivePromotions);

// --- Admin Routes ---
// @route   GET /api/v1/promotions/all
// @desc    Admin: Get all promotions (active and inactive)
// @access  Private (Admin)
router.get("/all", auth, isAdmin, getAllPromotions);

// @route   POST /api/v1/promotions
// @desc    Admin: Create a new promotion
// @access  Private (Admin)
router.post(
  "/",
  auth,
  isAdmin,
  validatePromo,
  handleValidationErrors,
  createPromotion
);

// @route   PATCH /api/v1/promotions/:id
// @desc    Admin: Update an existing promotion
// @access  Private (Admin)
router.patch(
  "/:id",
  auth,
  isAdmin,
  [param("id").isMongoId()],
  validatePromo,
  handleValidationErrors,
  updatePromotion
);

// @route   DELETE /api/v1/promotions/:id
// @desc    Admin: Delete a promotion
// @access  Private (Admin)
router.delete(
  "/:id",
  auth,
  isAdmin,
  [param("id").isMongoId()],
  handleValidationErrors,
  deletePromotion
);

module.exports = router;
