const { body, query, param, validationResult } = require("express-validator");
const TeamRanking = require("../models/TeamRanking");

// --- Validation Rules ---

exports.validateCreateRanking = [
  body("teamName").trim().notEmpty().withMessage("Team name is required."),
  body("ranking")
    .isInt({ min: 1, max: 100 })
    .withMessage("Ranking must be a number between 1 and 100."),
];

exports.validateUpdateRanking = [
  param("id").isMongoId().withMessage("Invalid ID format."),
  body("ranking")
    .isInt({ min: 1, max: 100 })
    .withMessage("Ranking must be a number between 1 and 100."),
];

// --- Controller Functions ---

exports.getRankings = async (req, res, next) => {
  try {
    const { page = 1, limit = 15, search = "" } = req.query;
    const filter = {};
    if (search) {
      const searchRegex = new RegExp(search, "i");
      filter.teamName = searchRegex;
    }

    const rankings = await TeamRanking.find(filter)
      .sort({ ranking: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    const totalRankings = await TeamRanking.countDocuments(filter);
    res.json({
      rankings,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalRankings / parseInt(limit)),
      totalCount: totalRankings,
    });
  } catch (error) {
    next(error);
  }
};

exports.createRanking = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { teamName, ranking } = req.body;
  try {
    const teamName_lower = teamName.toLowerCase();
    const existingRanking = await TeamRanking.findOne({ teamName_lower });
    if (existingRanking) {
      const err = new Error("A ranking for this team already exists.");
      err.statusCode = 400;
      return next(err);
    }

    const newRanking = new TeamRanking({ teamName, teamName_lower, ranking });
    await newRanking.save();
    res
      .status(201)
      .json({
        message: "Team ranking created successfully.",
        ranking: newRanking,
      });
  } catch (error) {
    next(error);
  }
};

exports.updateRanking = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { id } = req.params;
  const { ranking } = req.body;
  try {
    const updatedRanking = await TeamRanking.findByIdAndUpdate(
      id,
      { ranking },
      { new: true }
    );
    if (!updatedRanking) {
      const err = new Error("Ranking not found.");
      err.statusCode = 404;
      return next(err);
    }
    res.json({
      message: "Team ranking updated successfully.",
      ranking: updatedRanking,
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteRanking = async (req, res, next) => {
  const { id } = req.params;
  try {
    const deletedRanking = await TeamRanking.findByIdAndDelete(id);
    if (!deletedRanking) {
      const err = new Error("Ranking not found.");
      err.statusCode = 404;
      return next(err);
    }
    res.json({ message: "Team ranking deleted successfully." });
  } catch (error) {
    next(error);
  }
};
