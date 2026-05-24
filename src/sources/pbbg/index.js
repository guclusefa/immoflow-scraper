/*
 * PBBG source (initial implementation).
 * Target example: https://pbbg.ch/locations/?type=rent&category=APPT&locality=Lausanne&room_from=0.0&room_to=4.5&area_from=0&area_to=130&price_from=0&price_to=2000
 */

'use strict';

const path = require('path');

const SOURCE_ID = 'pbbg';
const SOURCE_CONST = 'PBBG';
const ID_PREFIX = 'PBBG_';
const DEFAULT_TARGET_URL = 'https://pbbg.ch/locations/?type=rent&category=APPT&locality=Lausanne&room_from=0.0&room_to=4.5&area_from=0&area_to=130&price_from=0&price_to=2000';

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
  const raw = env.PBBG_URLS;
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
    return new URL(url, 'https://pbbg.ch').toString();
  } catch (_) {
    return null;
  }
}

function parseListingText(rawText) {
  const lines = String(rawText || '')
    .split('\n')
    .map((l) => l.replace(/\u00A0/g, ' ').trim())
    .filter(Boolean);

  const priceLine = lines.find((l) => /CHF|fr\.|Fr\.|\bCHF\b/i.test(l)) || '';
  const priceMatch = priceLine.match(/([\d'\s\.]+)\s*-?\.?/);

  const surfaceLine = lines.find((l) => /m2|m²|m 2|m\u00B2/i.test(l)) || '';
  const surfaceMatch = surfaceLine.match(/(\d+(?:[.,]\d+)?)/);

  const roomLine = lines.find((l) => /^\d+(?:[.,]\d+)?\s*$/i.test(l)) || '';
  const rooms = roomLine ? Number.parseFloat(roomLine.replace(',', '.')) : null;

  const titleLine = lines.find((l) => /Appartement|Studio|Chambre|Maison/i.test(l)) || null;
  const description = lines.find((l) => l.length > 10 && !/CHF|m2|m²/i.test(l)) || null;

  return {
    price: priceMatch ? toIntOrNull(priceMatch[1]) : null,
    rooms,
    living_space_m2: surfaceMatch ? Number.parseFloat(String(surfaceMatch[1]).replace(',', '.')) : null,
    property_type: titleLine && /Studio/i.test(titleLine) ? 'studio' : titleLine && /Appartement/i.test(titleLine) ? 'apartment' : null,
    title: titleLine,
    description,
  };
}

async function extractListings(page) {
  let rawListings = await page.evaluate(() => {
    // Prefer structured listing cards
    const listItems = Array.from(document.querySelectorAll('ul.real-estate-listing > li.real-estate-listing-card-wrapper'));
    const results = [];

    if (listItems.length) {
      listItems.forEach((li) => {
        const wrapperId = li.id || null;
        const anchor = li.querySelector('a[href]');
        const href = anchor ? anchor.getAttribute('href') || anchor.href : (li.querySelector('a.btn') ? (li.querySelector('a.btn').getAttribute('href') || '') : '');

        const imgEl = li.querySelector('img');
        let img = null;
        if (imgEl) img = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || imgEl.src || null;

        const refEl = li.querySelector('.real-estate-listing-card-ref a');
        const refText = refEl ? (refEl.textContent || '').trim() : null;

        const titleEl = li.querySelector('.real-estate-listing-card-name a');
        const title = titleEl ? (titleEl.textContent || '').trim() : null;

        const addressEl = li.querySelector('.real-estate-listing-card-address a');
        const address = addressEl ? (addressEl.textContent || '').trim() : null;

        // options: rooms, floor, available, area (not consistently labeled)
        const opts = Array.from(li.querySelectorAll('.real-estate-listing-card-option')).map(o => (o.textContent || '').trim()).filter(Boolean);
        const priceEl = li.querySelector('.real-estate-listing-card-price');
        const priceText = priceEl ? (priceEl.textContent || '').trim() : null;

        results.push({ href: href || '', text: [refText, title, address, priceText || '', opts.join(' ')].filter(Boolean).join(' | '), image_url: img, wrapperId, refText, title, address, opts, priceText });
      });
      return results;
    }

    // Fallback to original anchor-based extraction
    const anchors = Array.from(document.querySelectorAll('a[href*="/locations/"]'));
    const seen = new Set();
    anchors.forEach((a) => {
      const href = a.getAttribute('href') || a.href || '';
      if (!href) return;
      const card = a.closest('.card, .listing, .result, .property') || a.parentElement;
      const context = (card?.textContent || a.textContent || '').trim();
      if (!/CHF\s*[\d'\s\.]+/i.test(context)) return;
      try {
        const resolved = new URL(href, document.baseURI).toString();
        if (seen.has(resolved)) return;
        seen.add(resolved);
      } catch (e) {
        if (seen.has(href)) return;
        seen.add(href);
      }
      let img = null;
      const imgEl = a.querySelector('img') || card?.querySelector('img');
      if (imgEl) {
        img = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || imgEl.src || null;
        if (!img && imgEl.getAttribute('srcset')) {
          img = imgEl.getAttribute('srcset').split(',')[0].trim().split(' ')[0];
        }
      }
      results.push({ href, text: context, image_url: img });
    });

    return results;
  });

  // Fallback: some pages embed listing text in meta description or inline text
  if ((!rawListings || rawListings.length === 0)) {
    const fallbackText = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="description"]');
      if (meta && meta.content && meta.content.length > 50) return meta.content;
      // fallback to main content text
      return document.body ? document.body.innerText : '';
    });

    if (fallbackText && fallbackText.length > 50) {
      const chunks = fallbackText.split(/Détails\s+Réf\s*[:]?/i).map(s => s.trim()).filter(Boolean);
      rawListings = chunks.map((chunk) => {
        // try to extract reference id
        const refMatch = chunk.match(/Réf[:\s]*([0-9]{3,})/i);
        const priceMatch = chunk.match(/([0-9'\s\.]+)\s*CHF/i);
        const href = refMatch ? (`/locations/?ref=${refMatch[1]}`) : '/locations/';
        return { href, text: chunk, image_url: priceMatch ? null : null };
      });
    }
  }

  return rawListings.map((item, idx) => {
    // prefer wrapperId or refText for stable id
    let idRaw = item.wrapperId || item.refText || item.href || `listing_${idx}`;
    if (typeof idRaw === 'string') idRaw = idRaw.replace(/[^0-9A-Za-z_-]/g, '_');

    // parse structured fields when available
    let parsed = {};
    if (item.opts) {
      const optsText = item.opts.join(' ');
      const priceMatch = (item.priceText && item.priceText.match(/([0-9'’\s\.]+)\s*CHF/i)) || optsText.match(/([0-9'’\s\.]+)\s*CHF/i) || (item.text || '').match(/([0-9'’\s\.]+)\s*CHF/i);
      const roomsMatch = item.opts[0] && item.opts[0].match(/(\d+(?:[.,]\d+)?)/);
      const areaMatch = optsText.match(/(\d+(?:[.,]\d+)?)/g);
      const floorMatch = item.opts[1] && item.opts[1].match(/(\d+)/);
      const dateMatch = item.opts.find(o => /\d{2}\.\d{2}\.\d{4}/)?.match(/(\d{2})\.(\d{2})\.(\d{4})/);

      parsed.price = priceMatch ? toIntOrNull(priceMatch[1]) : null;
      parsed.rooms = roomsMatch ? Number.parseFloat(roomsMatch[1].replace(',', '.')) : null;
      // area: try to find a number that looks like m2 (usually the last option)
      parsed.living_space_m2 = null;
      if (areaMatch && areaMatch.length) {
        // prefer the last numeric option (often area)
        const last = areaMatch[areaMatch.length - 1];
        parsed.living_space_m2 = Number.parseFloat(String(last).replace(',', '.'));
      }
      parsed.floor = floorMatch ? parseInt(floorMatch[1], 10) : null;
      parsed.available_from = null;
      if (dateMatch) {
        const [, dd, mm, yyyy] = dateMatch;
        parsed.available_from = `${yyyy}-${mm}-${dd}`;
      }
    } else {
      parsed = parseListingText(item.text || '');
    }

    return {
      id: `${ID_PREFIX}${String(idRaw)}`,
      source: SOURCE_CONST,
      url: absolutizeUrl(item.href) || item.href,
      address_raw: item.address || item.text,
      image_urls: item.image_url ? [absolutizeUrl(item.image_url)].filter(Boolean) : [],
      title: item.title || parsed.title,
      description: parsed.description || null,
      price: parsed.price || null,
      currency: 'CHF',
      price_period: 'month',
      rooms: parsed.rooms || null,
      living_space_m2: parsed.living_space_m2 || null,
      floor: parsed.floor || null,
      total_floors: null,
      street: null,
      street_number: null,
      zip_code: null,
      city: 'Lausanne',
      country_code: 'CH',
      latitude: null,
      longitude: null,
      listing_type: 'rent',
      property_type: parsed.property_type || null,
      available_from: parsed.available_from || null,
    };
  });
}

module.exports = {
  id: SOURCE_ID,
  name: 'PBBG',
  loginRequired: false,
  loginUrl: null,
  initialDelayMs: 2500,
  scrollDelayMs: 1000,
  scrollDistance: 900,
  scrollTargetPreference: 'document',
  normalizeTargetUrl,
  getTargets,
  extractListings,
  fixtures: {
    sampleHtmlPath: path.resolve(__dirname, '../../../data/pbbg/sample.html'),
    sampleExpectedPath: path.resolve(__dirname, '../../../data/pbbg/sample.expected.json'),
  },
};
