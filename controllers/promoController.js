const { body, param, validationResult } = require("express-validator");
const Promo = require("../models/Promo");

// --- Validation Rules for Creating/Updating a Promotion ---
exports.validatePromo = [
  body("title").trim().notEmpty().withMessage("Title is required."),
  body("description").trim().notEmpty().withMessage("Description is required."),
  body("promoType")
    .isIn(["Bonus", "FreeBet", "OddsBoost"])
    .withMessage("Invalid promotion type selected."),
  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("isActive must be a boolean value."),
  body("expiresAt")
    .optional({ checkFalsy: true })
    .isISO8601()
    .toDate()
    .withMessage("Invalid date format for expiry."),
];

// --- Public Controller: Get Active Promotions ---
exports.getActivePromotions = async (req, res, next) => {
  try {
    const promotions = await Promo.find({
      isActive: true,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } },
      ],
    }).sort({ createdAt: -1 });

    res.status(200).json({
      message: "Active promotions fetched successfully.",
      promotions,
    });
  } catch (error) {
    next(error);
  }
};

// --- Admin Controller: Get All Promotions ---
exports.getAllPromotions = async (req, res, next) => {
  try {
    const promotions = await Promo.find().sort({ createdAt: -1 });
    res.status(200).json({ promotions });
  } catch (error) {
    next(error);
  }
};

// --- Admin Controller: Create Promotion ---
exports.createPromotion = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const newPromo = new Promo(req.body);
    await newPromo.save();
    res
      .status(201)
      .json({ msg: "Promotion created successfully.", promo: newPromo });
  } catch (error) {
    next(error);
  }
};

// --- Admin Controller: Update Promotion ---
exports.updatePromotion = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const updatedPromo = await Promo.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!updatedPromo) {
      return res.status(404).json({ msg: "Promotion not found." });
    }
    res
      .status(200)
      .json({ msg: "Promotion updated successfully.", promo: updatedPromo });
  } catch (error) {
    next(error);
  }
};

// --- Admin Controller: Delete Promotion ---
exports.deletePromotion = async (req, res, next) => {
  try {
    const deletedPromo = await Promo.findByIdAndDelete(req.params.id);
    if (!deletedPromo) {
      return res.status(404).json({ msg: "Promotion not found." });
    }
    res.status(200).json({ msg: "Promotion deleted successfully." });
  } catch (error) {
    next(error);
  }
};
