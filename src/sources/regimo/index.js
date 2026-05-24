/*
 * Regimo Lausanne source (initial implementation).
 * Target example: https://regimo-lausanne.ch/louer/acheter?place1=Lausanne&type1=Lieu#page
 */

'use strict';

const path = require('path');

const SOURCE_ID = 'regimo';
const SOURCE_CONST = 'REGIMO';
const ID_PREFIX = 'REGIMO_';
const DEFAULT_TARGET_URL = 'https://regimo-lausanne.ch/louer/acheter?place1=Lausanne&type1=Lieu#page';

function normalizeTargetUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch (_) {
    return String(url).split('#')[0];
  }
}

function getTargets({ urls = [], env = {} } = {}) {
  if (urls.length) return urls.filter(Boolean);
  const raw = env.REGIMO_URLS;
  if (!raw) return [DEFAULT_TARGET_URL];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function toIntOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(String(value).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function absolutizeUrl(url) {
  try {
    return new URL(url, 'https://regimo-lausanne.ch').toString();
  } catch (_) {
    return null;
  }
}

function parseListingText(rawText) {
  const txt = String(rawText || '').replace(/\u00A0/g, ' ').trim();
  const priceMatch = txt.match(/([0-9'’\s\.]+)\s*CHF/i);
  const roomsMatch = txt.match(/(\d+(?:[.,]\d+)?)\s*(pi[eè]ces|rooms|P\.?)/i);
  const areaMatch = txt.match(/(\d+(?:[.,]\d+)?)\s*(m2|m²|m2)/i);
  return {
    price: priceMatch ? toIntOrNull(priceMatch[1]) : null,
    rooms: roomsMatch ? Number.parseFloat(roomsMatch[1].replace(',', '.')) : null,
    living_space_m2: areaMatch ? Number.parseFloat(areaMatch[1].replace(',', '.')) : null,
    title: null,
    description: null,
  };
}

async function extractListings(page) {
  // try structured cards first
  const raw = await page.evaluate(() => {
    // Prefer the JSON blob if present (faster and reliable)
    const jsonInput = document.querySelector('#tenant-jsonData');
    if (jsonInput && jsonInput.value) {
      try {
        const arr = JSON.parse(jsonInput.value);
        if (Array.isArray(arr) && arr.length) {
          return arr.map(item => ({
            href: item.objectDetailUrl || item.objectDetailUrl || '',
            text: [item.title, item.objectStreet, item.objectZip, item.objectCity].filter(Boolean).join(' | '),
            image_url: item.objectImage || null,
            rawItem: item,
          }));
        }
      } catch (e) {
        // fall through to DOM parsing
      }
    }

    const results = [];
    // common patterns: article.listing, .property-card, li.result
    const cards = Array.from(document.querySelectorAll('#resultsList a, .card, .card-wrap a, .card-body')).filter(Boolean);
    const seen = new Set();
    cards.forEach((el) => {
      const a = el.tagName === 'A' ? el : el.querySelector('a[href]');
      if (!a) return;
      const href = a.getAttribute('href') || a.href || '';
      if (!href) return;
      try {
        const resolved = new URL(href, document.baseURI).toString();
        if (seen.has(resolved)) return;
        seen.add(resolved);
      } catch (e) {
        if (seen.has(href)) return;
        seen.add(href);
      }
      const card = a.closest('.card') || a.closest('.col-lg-6') || a.closest('div');
      const imgEl = card ? card.querySelector('img') : (a.querySelector('img') || null);
      const img = imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || imgEl.src) : null;
      const context = (card?.textContent || a.textContent || '').trim();
      results.push({ href, text: context, image_url: img });
    });

    return results;
  });

  return raw.map((item, idx) => {
    let idRaw = null;
    try {
      const u = new URL(item.href, 'https://regimo-lausanne.ch');
      const parts = u.pathname.split('/').filter(Boolean);
      idRaw = parts[parts.length - 1] || parts[parts.length - 2] || `regimo_${idx}`;
    } catch (e) {
      idRaw = `regimo_${idx}`;
    }

    // Prefer structured rawItem properties when available (from tenant-jsonData)
    let parsed = parseListingText(item.text || '');
    if (item.rawItem) {
      const ri = item.rawItem;
      parsed = parsed || {};
      parsed.title = ri.title || parsed.title || null;
      parsed.price = ri.sellingPrice || ri.rentPrice || parsed.price || null;
      parsed.rooms = ri.numberOfRooms ? Number.parseFloat(String(ri.numberOfRooms).replace(',', '.')) : parsed.rooms || null;
      parsed.living_space_m2 = (ri.surfaceLiving !== undefined && ri.surfaceLiving !== null) ? Number.parseFloat(String(ri.surfaceLiving)) : parsed.living_space_m2 || null;
      parsed.street = ri.objectStreet || null;
      parsed.zip = ri.objectZip || null;
      parsed.city = ri.objectCity || parsed.city || 'Lausanne';
      // image path might be relative
      if (item.image_url && item.image_url.startsWith('/')) {
        item.image_url = (new URL(item.image_url, 'https://regimo-lausanne.ch')).toString();
      }
    }

    return {
      id: `${ID_PREFIX}${String(idRaw).replace(/[^0-9A-Za-z._-]/g, '_')}`,
      source: SOURCE_CONST,
      url: absolutizeUrl(item.href) || item.href,
      address_raw: item.text,
      image_urls: item.image_url ? [absolutizeUrl(item.image_url)].filter(Boolean) : [],
      title: parsed.title || null,
      description: parsed.description || null,
      price: parsed.price !== undefined ? toIntOrNull(parsed.price) : null,
      currency: 'CHF',
      price_period: 'month',
      rooms: parsed.rooms || null,
      living_space_m2: parsed.living_space_m2 || null,
      floor: null,
      total_floors: null,
      street: parsed.street || null,
      street_number: null,
      zip_code: parsed.zip || null,
      city: parsed.city || 'Lausanne',
      country_code: 'CH',
      latitude: item.rawItem && item.rawItem.latitude ? Number.parseFloat(item.rawItem.latitude) : null,
      longitude: item.rawItem && item.rawItem.longitude ? Number.parseFloat(item.rawItem.longitude) : null,
      listing_type: 'rent',
      property_type: item.rawItem && item.rawItem.objectCategory ? item.rawItem.objectCategory : null,
      available_from: null,
    };
  });
}

module.exports = {
  id: SOURCE_ID,
  name: 'Regimo Lausanne',
  loginRequired: false,
  loginUrl: null,
  initialDelayMs: 2000,
  scrollDelayMs: 800,
  scrollDistance: 800,
  scrollTargetPreference: 'document',
  normalizeTargetUrl,
  getTargets,
  extractListings,
  fixtures: {
    sampleHtmlPath: path.resolve(__dirname, '../../../data/regimo/sample.html'),
    sampleExpectedPath: path.resolve(__dirname, '../../../data/regimo/sample.expected.json'),
  },
};
