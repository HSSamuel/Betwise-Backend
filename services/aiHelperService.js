const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../config/env");

if (!config.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not defined in the .env file.");
}
const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);

exports.generateInterventionMessage = async (
  username,
  lastBetStake,
  newBetStake
) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `You are a caring and supportive responsible gambling assistant for "BetWise". A user named "${username}" lost a bet of $${lastBetStake.toFixed(
      2
    )} and is now trying to place a much larger bet of $${newBetStake.toFixed(
      2
    )}. This could be "loss chasing". Generate a short, gentle, non-judgmental pop-up message. Suggest taking a brief pause. Do not use the term "loss chasing".`;
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.error("Error generating intervention message:", error);
    return "Just a friendly check-in. It's always a good idea to bet responsibly. Are you sure you wish to proceed?";
  }
};
