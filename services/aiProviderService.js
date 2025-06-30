const { GoogleGenerativeAI } = require("@google/generative-ai");
const { CohereClient } = require("cohere-ai");
const NodeCache = require("node-cache");
const config = require("../config/env");

// Initialize clients and cache
let genAI;
let cohere;
const aiCache = new NodeCache({ stdTTL: 300, checkperiod: 120 }); // Cache for 5 minutes

if (config.GEMINI_API_KEY) {
  try {
    genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
    console.log("✅ Google AI Service Initialized.");
  } catch (e) {
    console.error("Could not initialize GoogleGenerativeAI:", e);
  }
}

if (config.COHERE_API_KEY) {
  try {
    cohere = new CohereClient({
      token: config.COHERE_API_KEY,
    });
    console.log("✅ Cohere AI Service Initialized.");
  } catch (e) {
    console.error("Could not initialize CohereClient:", e);
  }
}

async function generateContent(prompt, useCache = true) {
  const cacheKey = `ai-prompt-${prompt}`;

  if (useCache) {
    const cachedResult = aiCache.get(cacheKey);
    if (cachedResult) {
      console.log("✅ Serving AI response from cache.");
      return cachedResult;
    }
  }

  // 1. Try Google Gemini first
  if (genAI) {
    try {
      console.log("🔥 Attempting to generate content with Google AI...");
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      if (useCache) aiCache.set(cacheKey, text);
      return text;
    } catch (error) {
      console.warn(
        "⚠️ Google AI failed, attempting fallback to Cohere:",
        error.message
      );
    }
  }

  // 2. If Google fails, try Cohere
  if (cohere) {
    try {
      console.log(
        "🔥 Attempting to generate content with Cohere as fallback..."
      );
      const response = await cohere.chat({
        message: prompt,
      });
      const text = response.text;
      if (useCache) aiCache.set(cacheKey, text);
      return text;
    } catch (error) {
      console.error("❌ Cohere fallback also failed:", error.message);
      throw new Error("All AI providers are currently unavailable.");
    }
  }

  throw new Error("No AI providers are configured or available.");
}

module.exports = { generateContent };
