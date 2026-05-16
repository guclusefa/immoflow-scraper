/**
 * Facebook Marketplace (property rentals) source.
 *
 * ID convention: FACEBOOK_MARKETPLACE_<numeric_id>
 * Source string:  FACEBOOK_MARKETPLACE
 *
 * Target URLs: FACEBOOK_MARKETPLACE_URLS (comma-separated) in .env
 * Auth:        storage/facebook-cookies.json  (shared with Groups source)
 */

'use strict';

const path = require('path');
const { extractPrice } = require('../../core/price-utils');
const { DEFAULT_SOURCE_CONFIG } = require('../../core/config');

const SOURCE_ID     = 'facebook-marketplace';
const SOURCE_CONST  = 'FACEBOOK_MARKETPLACE';   // written to listings.source
const ID_PREFIX     = 'FACEBOOK_MARKETPLACE_';  // prepended to listings.id

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

function normalizeTargetUrl(url) {
  try {
    const u = new URL(url);
    u.search = '';
    return u.toString();
  } catch (_) {
    return String(url).split('?')[0];
  }
}

function getTargets({ urls = [], env = {} } = {}) {
  if (urls.length) return urls.filter(Boolean);
  const raw = env.FACEBOOK_MARKETPLACE_URLS;
  if (!raw) return [];
  return raw.split(',').map((u) => u.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// DOM parser — runs inside page.evaluate (browser context only)
// ---------------------------------------------------------------------------

function extractListingsFromDocument() {
  const results = [];
  const seen    = new Set();

  // 1. Single listing PDP (direct link)
  try {
    const ogUrl      = document.querySelector('meta[property="og:url"]')?.getAttribute('content') || '';
    const canonical  = document.querySelector('link[rel="canonical"]')?.getAttribute('href')      || '';
    const pageUrl    = ogUrl || canonical || '';
    const pdpMatch   = pageUrl.match(/\/marketplace\/(?:item|product)\/(\d+)/i);

    if (pdpMatch) {
      const rawId     = pdpMatch[1];
      const title     = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.title || '';
      const desc      = document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
      const image     = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || null;
      const bodyText  = document.body?.innerText || '';
      results.push({ rawId, url: pageUrl.split('?')[0], address_raw: desc || title, image_urls: image ? [image] : [], price: bodyText });
      return results;
    }
  } catch (_) {}

  // 2. Feed / search page — aria-label-first strategy (battle-tested)
  for (const a of Array.from(document.querySelectorAll('a'))) {
    try {
      const href = a.getAttribute('href') || a.href || '';
      if (!href.includes('/item/') && !href.includes('/product/')) continue;

      const match = href.match(/\/(?:item|product)\/(\d+)/i);
      if (!match) continue;

      const rawId = match[1];
      if (!rawId || seen.has(rawId)) continue;

      // Prefer aria-label over raw text — it is the intended machine-readable label
      let ariaLabel = a.getAttribute('aria-label') || '';
      if (!ariaLabel) {
        const inner = a.querySelector('[aria-label]');
        if (inner) ariaLabel = inner.getAttribute('aria-label') || '';
      }

      const innerText  = a.innerText || '';
      const rawText    = (ariaLabel.length > 10 ? ariaLabel : innerText).replace(/\n/g, ', ').trim();
      const textContent = rawText.length > 5 ? rawText : 'Détails non disponibles';

      seen.add(rawId);

      let url = href;
      if (url.startsWith('/')) url = `https://www.facebook.com${url}`;
      url = url.split('?')[0];

      // Anti-ghost-image check: exclude base64 data URIs (loading placeholders)
      const images = Array.from(a.querySelectorAll('img'))
        .map((img) => img.getAttribute('src') || '')
        .filter((src) => src && src.startsWith('http'));

      results.push({ rawId, url, address_raw: textContent, image_urls: [...new Set(images)], price: textContent });
    } catch (_) {}
  }

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
  // Wait for React Suspense to resolve and inject listing anchors
  try {
    await page.waitForSelector('a[href*="/item/"], a[href*="/product/"]', { timeout: 10_000 });
  } catch (_) {
    console.log('   [MARKETPLACE] Listings not visible — taking debug screenshot (fb-marketplace-debug.png)');
    await page.screenshot({ path: 'fb-marketplace-debug.png', fullPage: true }).catch(() => {});
  }

  // DOM cleanup: hide the map overlay that blocks scroll
  await page.evaluate(() => {
    try {
      Array.from(document.querySelectorAll(
        '[aria-label="Map"], [aria-label="Carte"], [aria-label*="map" i], [data-pagelet="MarketplaceMap"]'
      )).forEach((el) => { el.style.display = 'none'; });
      document.body.style.overflow = 'unset';
    } catch (_) {}
  }).catch(() => {});

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
  name:           'Facebook Marketplace',
  cookieSourceId: 'facebook',
  loginRequired:  true,

  // Scroll config — explicitly defined so DEFAULT_SOURCE_CONFIG spread cannot clobber them
  scrollSafetyLimit:       50,
  scrollIdleRounds:        4,
  initialDelayMs:          4000,   // shorter: waitForSelector already waits for React
  scrollDelayMs:           1200,
  scrollDistance:          900,
  scrollTargetPreference:  'auto',
  loginUrl:                DEFAULT_SOURCE_CONFIG.loginUrl,

  normalizeTargetUrl,
  getTargets,
  extractListings,

  fixtures: {
    sampleHtmlPath:     path.resolve(__dirname, '../../../data/facebook-marketplace/sample.html'),
    sampleExpectedPath: path.resolve(__dirname, '../../../data/facebook-marketplace/sample.expected.json'),
  },
};
