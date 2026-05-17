/**
 * myHOMIES source.
 *
 * Lausanne colocation search results render as Bubble cards with price,
 * surface, postal code, city, availability, and a canonical flatshare slug.
 * Target URLs are read from MYHOMIES_URLS (comma-separated) in .env.
 */

'use strict';

const path = require('path');
const { extractPrice } = require('../../core/price-utils');

const SOURCE_ID = 'myhomies';
const SOURCE_CONST = 'MYHOMIES';
const ID_PREFIX = 'MYHOMIES_';
const DEFAULT_TARGET_URL = 'https://fr.myhomies.ch/discover/Lausanne-flatshare';

function normalizeTargetUrl(url) {
  try {
    const normalized = new URL(url);
    normalized.search = '';
    normalized.hash = '';
    return normalized.toString();
  } catch (_) {
    return String(url).split('?')[0].split('#')[0];
  }
}

function getTargets({ urls = [], env = {} } = {}) {
  if (urls.length) return urls.filter(Boolean);

  const raw = env.MYHOMIES_URLS;
  if (!raw) return [DEFAULT_TARGET_URL];

  return raw.split(',').map((url) => url.trim()).filter(Boolean);
}

function extractListingsFromDocument() {
  const results = [];
  const seen = new Set();

  const cards = Array.from(document.querySelectorAll('#filter-listing .group-item'));

  cards.forEach((card) => {
    try {
      const fullText = card.innerText || card.textContent || '';
      
      // Skip pagination elements (which just contain a number) and empty cards
      if (/^\d+$/.test(fullText.trim()) || !/CHF/i.test(fullText)) return;

      // Extract the entry ID directly from the class name
      const entryMatch = (card.className || '').match(/\bentry-(\d+)\b/);
      const rawId = entryMatch ? `entry-${entryMatch[1]}` : null;
      if (!rawId || seen.has(rawId)) return;
      seen.add(rawId);

      // Separate the text nodes to avoid concatenating them into one giant string
      const textNodes = Array.from(card.querySelectorAll('.bubble-element.Text'))
        .map((n) => (n.innerText || n.textContent).trim())
        .filter(Boolean);

      let priceText = '';
      let locationText = '';
      let dateText = '';

      textNodes.forEach((line) => {
        if (/CHF/i.test(line)) priceText = line;
        else if (/m²/i.test(line)) locationText = line;
        else if (/Disponible/i.test(line)) dateText = line;
      });

      // Extract the background image url
      let imgUrl = null;
      const imageNode = card.querySelector('[style*="background-image"]');
      if (imageNode) {
        const style = imageNode.getAttribute('style') || '';
        const matchImg = style.match(/background-image:\s*url\((["']?)(.*?)\1\)/i);
        if (matchImg) {
          imgUrl = matchImg[2];
          if (imgUrl.startsWith('//')) imgUrl = `https:${imgUrl}`;
        }
      }

      results.push({
        rawId,
        priceText,
        locationText,
        dateText,
        imgUrl
      });
    } catch (_) {}
  });

  return results;
}

async function extractListings(page) {
  await page.waitForSelector('#filter-listing .group-item', { timeout: 15000 });
  const raw = await page.evaluate(extractListingsFromDocument);

  return raw.map((item) => {
    // 1. Parse Area, Zip Code, and City
    // Matches formats like "165 m² - 1033, Cheseaux-sur-Lausanne" or "91 m² - , Lausanne"
    let zip = null;
    let city = null;
    let area = null;
    const locMatch = item.locationText.match(/([\d\s.,]+)\s*m²\s*-\s*(?:(\d{4})\s*,)?\s*,?\s*(.+)/i);
    
    if (locMatch) {
      area = parseFloat(locMatch[1].replace(/\s+/g, '').replace(',', '.'));
      zip = locMatch[2] ? locMatch[2].trim() : null;
      city = locMatch[3] ? locMatch[3].trim() : null;
    }

    // 2. Parse Date
    // Matches formats like "Disponible à partir du 01/6/26"
    let availableFrom = null;
    const dateMatch = item.dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (dateMatch) {
      const d = parseInt(dateMatch[1], 10);
      const m = parseInt(dateMatch[2], 10);
      let y = parseInt(dateMatch[3], 10);
      if (y < 100) y += 2000;
      availableFrom = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    // 3. Construct clean Address
    const addressRaw = [zip, city].filter(Boolean).join(' ') || item.locationText;

    return {
      id: `${ID_PREFIX}${item.rawId}`,
      source: SOURCE_CONST,
      url: DEFAULT_TARGET_URL, // SPA fallback since distinct routing URLs aren't exposed in the DOM
      address_raw: addressRaw,
      image_urls: item.imgUrl ? [item.imgUrl] : [],
      title: null,
      description: null,
      price: extractPrice(item.priceText),
      currency: 'CHF',
      price_period: 'month',
      rooms: null,
      living_space_m2: Number.isFinite(area) ? area : null,
      floor: null,
      total_floors: null,
      street: null,
      street_number: null,
      zip_code: zip,
      city: city,
      country_code: 'CH',
      latitude: null,
      longitude: null,
      listing_type: 'share',
      property_type: 'colocation',
      available_from: availableFrom,
    };
  });
}

module.exports = {
  id: SOURCE_ID,
  name: 'myHOMIES',
  loginRequired: false,
  loginUrl: null,
  scrollSafetyLimit: 20,
  scrollIdleRounds: 3,
  initialDelayMs: 2500,
  scrollDelayMs: 1000,
  scrollDistance: 900,
  scrollTargetPreference: 'auto',
  normalizeTargetUrl,
  getTargets,
  extractListings,
  fixtures: {
    sampleHtmlPath: path.resolve(__dirname, '../../../data/myhomies/sample.html'),
    sampleExpectedPath: path.resolve(__dirname, '../../../data/myhomies/sample.expected.json'),
  },
};