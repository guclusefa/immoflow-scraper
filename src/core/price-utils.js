/**
 * Price extraction utilities for parsing rental prices from unstructured text.
 *
 * Handles multiple currency symbols (CHF, EUR, USD, €, $) and formats like:
 *   CHF 1500 / month
 *   1500 CHF
 *   € 2000
 */

/**
 * Price extraction regex pattern that matches prices with currency symbols.
 * Supports both patterns:
 *   - Currency before price: "CHF 1500"
 *   - Currency after price: "1500 CHF"
 *
 * Character range {2,8} covers prices up to 9,999,999 with formatting chars like spaces or commas.
 * Examples: "1500", "1 500", "1'500", "2,500", "1500.00"
 */
const PRICE_PATTERN = /(?:CHF|€|EUR|USD|\$)\s?([\d'.\s]{2,8})|([\d'.\s]{2,8})\s?(?:CHF|€|EUR)/i;

/**
 * Extract numeric price from text containing currency symbol.
 *
 * @param {string} text - The text to search for price
 * @returns {number|null} - Parsed price as integer, or null if not found
 *
 * @example
 * extractPrice("CHF 1500 per month") // => 1500
 * extractPrice("1 500 CHF") // => 1500
 * extractPrice("No price here") // => null
 */
function extractPrice(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const match = text.match(PRICE_PATTERN);
  if (!match) {
    return null;
  }

  // match[1] or match[2] contains the price part (one will be empty)
  const raw = (match[1] || match[2] || '').replace(/[^\d]/g, '');
  if (!raw) {
    return null;
  }

  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

module.exports = {
  extractPrice,
  PRICE_PATTERN,
};
