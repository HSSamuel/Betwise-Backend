const axios = require("axios");
const config = require("../config/env");

const newsCache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * Fetches news headlines for a specific topic, with a fallback provider.
 * @param {string} topic - The topic to search for (e.g., a team name).
 * @returns {Promise<Array>} A list of news item snippets.
 */
async function fetchNewsForTopic(topic) {
  const cacheKey = `topic_${topic.toLowerCase()}`;
  const cached = newsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`✅ Serving news for "${topic}" from cache.`);
    return cached.data;
  }

  // --- Primary Provider: Google Custom Search ---
  try {
    if (!config.GOOGLE_API_KEY || !config.GOOGLE_CSE_ID) {
      throw new Error("Google Search API not configured.");
    }
    console.log(`🔥 Fetching news for "${topic}" from Google API.`);
    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${
      config.GOOGLE_API_KEY
    }&cx=${config.GOOGLE_CSE_ID}&q=${encodeURIComponent(
      topic + " football news"
    )}`;
    const response = await axios.get(searchUrl);
    if (response.data.items && response.data.items.length > 0) {
      const snippets = response.data.items.map((item) => item.snippet);
      newsCache.set(cacheKey, { data: snippets, timestamp: Date.now() });
      return snippets;
    }
  } catch (error) {
    if (error.response && error.response.status === 429) {
      console.warn(
        `⚠️ Google Search API rate limit hit. Falling back to NewsAPI.org...`
      );
    } else {
      console.error(`Error with Google Search API:`, error.message);
    }
  }

  // --- Fallback Provider: NewsAPI.org ---
  try {
    if (!config.NEWS_API_KEY) {
      console.warn("NewsAPI.org key not configured. Cannot use fallback.");
      return [];
    }
    console.log(
      `🔥 Fetching news for "${topic}" from NewsAPI.org as fallback.`
    );
    const fallbackUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(
      topic
    )}&searchIn=title,description&language=en&sortBy=relevancy&apiKey=${
      config.NEWS_API_KEY
    }`;
    const response = await axios.get(fallbackUrl);
    if (response.data.articles && response.data.articles.length > 0) {
      const snippets = response.data.articles.map(
        (item) => item.description || item.title
      );
      newsCache.set(cacheKey, { data: snippets, timestamp: Date.now() });
      return snippets;
    }
  } catch (error) {
    console.error(`Error with NewsAPI.org fallback:`, error.message);
  }

  // If both providers fail
  return [];
}

/**
 * Fetches general sports news headlines, with a fallback provider.
 * @returns {Promise<object>} An object containing a list of news items.
 */
async function fetchGeneralSportsNews() {
  const cacheKey = "general_news";
  const cached = newsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log("✅ Serving general news from cache.");
    return cached.data;
  }

  // --- Primary Provider: Google Custom Search ---
  try {
    if (!config.GOOGLE_API_KEY || !config.GOOGLE_CSE_ID) {
      throw new Error("Google Search API not configured.");
    }
    console.log("🔥 Fetching general news from Google API.");
    const searchQuery = "top world football news headlines";
    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${
      config.GOOGLE_API_KEY
    }&cx=${config.GOOGLE_CSE_ID}&q=${encodeURIComponent(searchQuery)}`;
    const response = await axios.get(searchUrl);
    if (response.data.items && response.data.items.length > 0) {
      const newsItems = response.data.items
        .slice(0, 5)
        .map((item) => ({
          title: item.title,
          link: item.link,
          snippet: item.snippet,
          source: item.displayLink,
        }));
      const responseData = { news: newsItems };
      newsCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
      return responseData;
    }
  } catch (error) {
    if (error.response && error.response.status === 429) {
      console.warn(
        `⚠️ Google Search API rate limit hit for general news. Falling back to NewsAPI.org...`
      );
    } else {
      console.error(
        `Error with Google Search API for general news:`,
        error.message
      );
    }
  }

  // --- Fallback Provider: NewsAPI.org ---
  try {
    if (!config.NEWS_API_KEY) {
      console.warn(
        "NewsAPI.org key not configured. Cannot use fallback for general news."
      );
      return { news: [] };
    }
    console.log("🔥 Fetching general news from NewsAPI.org as fallback.");
    const fallbackUrl = `https://newsapi.org/v2/top-headlines?category=sports&language=en&apiKey=${config.NEWS_API_KEY}`;
    const response = await axios.get(fallbackUrl);
    if (response.data.articles && response.data.articles.length > 0) {
      const newsItems = response.data.articles
        .slice(0, 5)
        .map((item) => ({
          title: item.title,
          link: item.url,
          snippet: item.description,
          source: item.source.name,
        }));
      const responseData = { news: newsItems };
      newsCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
      return responseData;
    }
  } catch (error) {
    console.error(
      `Error with NewsAPI.org fallback for general news:`,
      error.message
    );
  }

  return { news: [] };
}

module.exports = {
  fetchNewsForTopic,
  fetchGeneralSportsNews,
};
