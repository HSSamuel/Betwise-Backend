// In: test-flutterwave.js
require("dotenv").config();
const Flutterwave = require("flutterwave-node-v3");

console.log("--- Deep Inspection of 'flw.Charge' Module ---");

try {
  const flw = new Flutterwave(
    process.env.FLUTTERWAVE_PUBLIC_KEY,
    process.env.FLUTTERWAVE_SECRET_KEY
  );

  if (flw && flw.Charge) {
    console.log("✅ The 'flw.Charge' object exists.");
    console.log(
      "--- Inspecting flw.Charge to find the correct payment function ---"
    );

    // This will print an array of all available function names on the Charge object.
    console.log(
      "Available functions on flw.Charge are:",
      Object.keys(flw.Charge)
    );
  } else {
    console.error("❌ The 'flw.Charge' object does NOT exist.");
  }
} catch (e) {
  console.error("❌ An error occurred during the test:", e);
}
