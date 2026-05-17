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
const SOURCE_CONST  = 'FACEBOOK_MARKETPLACE';
const ID_PREFIX     = 'FACEBOOK_MARKETPLACE_';

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

function parseLocation(locText) {
  if (!locText) return null;
  const parts = locText.split(',');
  return parts[0].trim();
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
      
      results.push({ 
          rawId, 
          url: pageUrl.split('?')[0], 
          locationText: desc || title, 
          titleText: title,
          image_urls: image ? [image] : [], 
          priceText: desc 
      });
      return results;
    }
  } catch (_) {}

  // 2. Feed / search page
  const cards = Array.from(document.querySelectorAll('a[href*="/item/"], a[href*="/product/"]'));
  
  cards.forEach((a) => {
    try {
      const href = a.getAttribute('href') || a.href || '';
      const match = href.match(/\/(?:item|product)\/(\d+)/i);
      if (!match) return;

      const rawId = match[1];
      if (!rawId || seen.has(rawId)) return;

      // Prefer aria-label over raw text if it contains structured data
      let ariaLabel = a.getAttribute('aria-label') || '';
      if (!ariaLabel) {
        const inner = a.querySelector('[aria-label]');
        if (inner) ariaLabel = inner.getAttribute('aria-label') || '';
      }

      const innerText  = a.innerText || '';
      const rawText    = (ariaLabel.length > 10 ? ariaLabel : innerText).trim();
      
      if (!rawText) return;

      seen.add(rawId);

      let url = href;
      if (url.startsWith('/')) url = `https://www.facebook.com${url}`;
      url = url.split('?')[0];

      // Anti-ghost-image check
      const images = Array.from(a.querySelectorAll('img'))
        .map((img) => img.getAttribute('src') || '')
        .filter((src) => src && src.startsWith('http'));

      let priceText = null;
      let titleText = null;
      let locationText = null;

      // Split the structured newline text out
      const parts = rawText.split('\n').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 3) {
          priceText = parts[0];
          titleText = parts[1];
          locationText = parts[2];
      } else if (parts.length > 0) {
          titleText = parts.join(', ');
          priceText = parts.find(p => /\d/.test(p) && /CHF|€|\$/i.test(p)) || null;
      }

      results.push({ 
          rawId, 
          url, 
          locationText: locationText || titleText, 
          titleText,
          image_urls: [...new Set(images)], 
          priceText 
      });
    } catch (_) {}
  });

  return results;
}

// ---------------------------------------------------------------------------
// Playwright extractor
// ---------------------------------------------------------------------------

async function extractListings(page) {
  try {
    await page.waitForSelector('a[href*="/item/"], a[href*="/product/"]', { timeout: 10_000 });
  } catch (_) {
    console.log('   [MARKETPLACE] Listings not visible — taking debug screenshot (fb-marketplace-debug.png)');
    await page.screenshot({ path: 'fb-marketplace-debug.png', fullPage: true }).catch(() => {});
  }

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
    address_raw:     item.locationText,
    image_urls:      item.image_urls || [],
    title:           item.titleText || null,
    description:     null,
    price:           extractPrice(item.priceText),
    currency:        'CHF',
    price_period:    'month',
    rooms:           null,
    living_space_m2: null,
    floor:           null,
    total_floors:    null,
    street:          null,
    street_number:   null,
    zip_code:        null,
    city:            parseLocation(item.locationText),
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

  scrollSafetyLimit:       1, // Marketplace feed is very unreliable to scroll, better to stop early and get what we have, rather than risk FB blocking us for too much scrolling. Also 24 listings is already a good amount for Marketplace which often has fewer listings than Groups.
  scrollIdleRounds:        4,
  initialDelayMs:          4000, 
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