const axios = require("axios");
const config = require("../config/env");

const newsCache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * Fetches news headlines for a specific topic from the Google API, with caching.
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

  console.log(`🔥 Fetching new news for "${topic}" from API.`);
  const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${
    config.GOOGLE_API_KEY
  }&cx=${config.GOOGLE_CSE_ID}&q=${encodeURIComponent(
    topic + " football news"
  )}`;

  const response = await axios.get(searchUrl);
  if (!response.data.items || response.data.items.length === 0) {
    return [];
  }

  const snippets = response.data.items.map((item) => item.snippet);
  newsCache.set(cacheKey, { data: snippets, timestamp: Date.now() });
  return snippets;
}

/**
 * Fetches general sports news headlines, utilizing an in-memory cache.
 * @returns {Promise<object>} An object containing a list of news items.
 */
async function fetchGeneralSportsNews() {
  const cacheKey = "general_news";
  const cached = newsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log("✅ Serving general news from cache.");
    return cached.data;
  }

  console.log("🔥 Fetching new general sports news from API.");
  const searchQuery = "top world football news headlines";
  const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${
    config.GOOGLE_API_KEY
  }&cx=${config.GOOGLE_CSE_ID}&q=${encodeURIComponent(searchQuery)}`;

  const response = await axios.get(searchUrl);

  if (!response.data.items || response.data.items.length === 0) {
    return { news: [] };
  }

  const newsItems = response.data.items.slice(0, 5).map((item) => ({
    title: item.title,
    link: item.link,
    snippet: item.snippet,
    source: item.displayLink,
  }));

  const responseData = { news: newsItems };
  newsCache.set(cacheKey, { data: responseData, timestamp: Date.now() });

  return responseData;
}

module.exports = {
  fetchNewsForTopic,
  fetchGeneralSportsNews,
};
