/**
 * A robust function to find and parse a JSON object or array from a string
 * that might be wrapped in markdown code blocks or have other extraneous text.
 * @param {string} text - The raw text response from an AI model.
 * @returns {object|null} The parsed JSON object/array or null if parsing fails.
 */
function extractJson(text) {
  if (!text) return null;

  // Attempt to find JSON within markdown code blocks
  const markdownMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (markdownMatch && markdownMatch[1]) {
    try {
      return JSON.parse(markdownMatch[1]);
    } catch (e) {
      console.error("Failed to parse JSON from markdown block:", e);
      // Fall through to the next method if parsing fails
    }
  }

  // If no markdown block is found, find the first '{' or '[' and the last '}' or ']'
  const firstBracket = text.indexOf("{");
  const firstSquareBracket = text.indexOf("[");

  if (firstBracket === -1 && firstSquareBracket === -1) return null;

  let start =
    firstBracket === -1
      ? firstSquareBracket
      : firstSquareBracket === -1
      ? firstBracket
      : Math.min(firstBracket, firstSquareBracket);
  let end =
    start === firstBracket ? text.lastIndexOf("}") : text.lastIndexOf("]");

  if (start === -1 || end === -1) return null;

  const jsonString = text.substring(start, end + 1);

  try {
    return JSON.parse(jsonString);
  } catch (e) {
    console.error("Failed to parse extracted JSON string:", e);
    return null;
  }
}

module.exports = { extractJson };
