/**
 * Facebook Groups source.
 *
 * ID convention: FACEBOOK_GROUPS_<id>
 * Source string:  FACEBOOK_GROUPS
 *
 * Target URLs: FACEBOOK_GROUPS_URLS (comma-separated) in .env
 * Auth:        storage/facebook-cookies.json  (shared with Marketplace source)
 *
 * Posts are unstructured text. Reliably extracts:
 *   id, source, url, address_raw, image_urls, price
 *
 * Structured fields (rooms, zip_code, city …) are null for this source.
 */

'use strict';

const path = require('path');
const { extractPrice } = require('../../core/price-utils');
const { DEFAULT_SOURCE_CONFIG } = require('../../core/config');

const SOURCE_ID    = 'facebook-groups';
const SOURCE_CONST = 'FACEBOOK_GROUPS';   // written to listings.source
const ID_PREFIX    = 'FACEBOOK_GROUPS_';  // prepended to listings.id

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

function normalizeTargetUrl(url) {
  return url.split('?')[0].split('&')[0];
}

function getTargets({ urls = [], env = {} } = {}) {
  if (urls.length) return urls.filter(Boolean);
  const raw = env.FACEBOOK_GROUPS_URLS;
  if (!raw) return [];
  return raw.split(',').map((u) => u.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// DOM parser — runs inside page.evaluate (browser context only)
// ---------------------------------------------------------------------------

function extractListingsFromDocument() {
  const results = [];
  const feedItems = document.querySelectorAll('div[aria-posinset]');

  const normalizeWhitespace = (str) =>
    str
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const dedupeLines = (text) => {
    const seen = new Set();

    return text
      .split('\n')
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean)
      .filter((line) => {
        if (seen.has(line)) return false;
        seen.add(line);
        return true;
      })
      .join('\n');
  };

  feedItems.forEach((item) => {
    try {
      if (!item.innerText || item.innerText.trim().length === 0) return;

      // Clone node to safely mutate
      const postClone = item.cloneNode(true);

      // Remove noisy interactive elements
      postClone.querySelectorAll([
        'form',
        '[role="button"]',
        '[aria-label*="comment" i]',
        '[aria-label*="réponse" i]',
        '[aria-label*="like" i]',
        '[aria-label*="j’aime" i]',
        '[aria-label*="share" i]',
        '[aria-label*="partager" i]',
        'svg',
        'video',
      ].join(',')).forEach((node) => node.remove());

      // Facebook text nodes
      const textNodes = Array.from(
        postClone.querySelectorAll('div[dir="auto"]')
      );

      const texts = textNodes
        .map((n) => normalizeWhitespace(n.innerText))
        .filter(Boolean)
        .filter((t) => t.length > 2);

      let mainContent = dedupeLines(texts.join('\n'));

      // Skip obvious junk
      if (mainContent.length < 20) return;

      if (
        mainContent.includes('Vendre un article') &&
        mainContent.length < 150
      ) {
        return;
      }

      // -------------------------------------------------------------------
      // Extract canonical listing URL + ID
      // -------------------------------------------------------------------

      const links = Array.from(item.querySelectorAll('a'));

      let postUrl = null;
      let fbId = null;
      let fallbackUserId = null;

      for (const link of links) {
        const href = link.href || '';

        // Marketplace listing
        const listingMatch = href.match(/listing\/(\d+)/);
        if (listingMatch) {
          fbId = listingMatch[1];
          postUrl = `https://www.facebook.com/commerce/listing/${fbId}/`;
          break;
        }

        // Group post permalink
        const postMatch = href.match(/(?:posts|permalink)\/(\d+)/);
        if (postMatch) {
          fbId = postMatch[1];
          postUrl = href.split('?')[0].split('&')[0];
          break;
        }

        // fallback identity
        const userMatch = href.match(/\/user\/(\d+)/);
        if (userMatch && !fallbackUserId) {
          fallbackUserId = userMatch[1];
        }
      }

      const fingerprint = mainContent
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 40);

      const rawId =
        fbId ||
        `fp_${fallbackUserId || 'anon'}_${fingerprint}`;

      // -------------------------------------------------------------------
      // Images
      // -------------------------------------------------------------------

      const imageUrls = Array.from(item.querySelectorAll('img'))
        .map((img) => img.src)
        .filter(Boolean)
        .filter((src) => src.includes('scontent'))
        .filter((src) => !src.includes('emoji'))
        .filter((src, index, arr) => arr.indexOf(src) === index);

      results.push({
        rawId,
        url: postUrl || 'none',
        address_raw: mainContent,
        image_urls: imageUrls,
        price: mainContent,
      });
    } catch (err) {
      console.error(err);
    }
  });

  return results;
}

// ---------------------------------------------------------------------------
// Playwright extractor
// ---------------------------------------------------------------------------

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<object[]>}
 */
async function extractListings(page) {
  const raw = await page.evaluate(extractListingsFromDocument);

  return raw.map((item) => ({
    id:              `${ID_PREFIX}${item.rawId}`,
    source:          SOURCE_CONST,
    url:             item.url,
    address_raw:     item.address_raw,
    image_urls:      item.image_urls || [],
    title:           null,
    description:     null,
    price:           extractPrice(item.price),
    currency:        'CHF',
    price_period:    'month',
    rooms:           null,
    living_space_m2: null,
    floor:           null,
    total_floors:    null,
    street:          null,
    street_number:   null,
    zip_code:        null,
    city:            null,
    country_code:    'CH',
    latitude:        null,
    longitude:       null,
    listing_type:    'rent',
    property_type:   null,
    available_from:  null,
  }));
}

// ---------------------------------------------------------------------------
// Source descriptor
// ---------------------------------------------------------------------------

module.exports = {
  id:             SOURCE_ID,
  name:           'Facebook Groups',
  cookieSourceId: 'facebook',
  loginRequired:  true,

  // Facebook's feed scrolls on window/document — forcing 'document' mode
  // avoids the engine latching onto a high-scoring inner div that moves
  // independently of the actual post feed.
  scrollTargetPreference:  'document',

  scrollSafetyLimit:       10,
  scrollIdleRounds:        6,       // FB lazy-loads slowly, give it more rounds
  initialDelayMs:          8000,    // extra time for FB's heavy initial render
  scrollDelayMs:           1200,
  scrollSettleMs:          4000,    // wait longer after each scroll for XHR
  scrollDistance:          900,
  loginUrl:                DEFAULT_SOURCE_CONFIG.loginUrl,

  normalizeTargetUrl,
  getTargets,
  extractListings,

  fixtures: {
    sampleHtmlPath:     path.resolve(__dirname, '../../../data/facebook-groups/sample.html'),
    sampleExpectedPath: path.resolve(__dirname, '../../../data/facebook-groups/sample.expected.json'),
  },
};