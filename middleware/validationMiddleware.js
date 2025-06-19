const { validationResult } = require("express-validator");

/**
 * This middleware checks for validation errors from express-validator.
 * If errors are found, it sends a 400 response. Otherwise, it passes to the next handler.
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

module.exports = { handleValidationErrors };
// This middleware is used to validate incoming requests in Express.js applications.
