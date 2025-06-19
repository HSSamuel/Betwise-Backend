// In: mock_ml_server.js

const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const PORT = 5001; // The port your main app expects the ML model to be on

// This is the /predict endpoint the analysis script calls
app.post("/predict", (req, res) => {
  console.log("✅ Mock ML Server received features for prediction:");
  console.log(req.body);

  // --- Mock Logic ---
  // Here, we can pretend to run a model.
  // Let's say we flag a user as "at_risk" if they bet more than 5 times.
  const features = req.body;
  let isAtRisk = false;
  let reason = "Normal betting activity observed.";

  if (features.bet_count_24h > 5) {
    isAtRisk = true;
    reason = "High frequency of bets in the last 24 hours.";
  }

  // Send back a prediction in the expected format
  const prediction = {
    is_at_risk: isAtRisk,
    risk_score: isAtRisk ? 0.82 : 0.15, // Example score
    reason: reason,
  };

  console.log("✅ Sending back prediction:", prediction);
  res.status(200).json(prediction);
});

app.listen(PORT, () => {
  console.log(`🚀 Mock ML Model API listening on http://localhost:${PORT}`);
});
// This mock server simulates the ML model API that the gambling analysis script would call.
