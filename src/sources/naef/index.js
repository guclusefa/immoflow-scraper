/*
 * Naef source (basic implementation).
 * Target: https://www.naef.ch/louer/appartements-maisons/...
 */

'use strict';

const path = require('path');

const SOURCE_ID = 'naef';
const SOURCE_CONST = 'NAEF';
const ID_PREFIX = 'NAEF_';
const DEFAULT_TARGET_URL = 'https://www.naef.ch/louer/appartements-maisons/vaud/lausanne-ville/?budgetMax=1700&sortingField=recent&zoom=14';

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
  const raw = env.NAEF_URLS;
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
    return new URL(url, 'https://www.naef.ch').toString();
  } catch (_) {
    return null;
  }
}

function parseListingText(rawText) {
  const lines = String(rawText || '')
    .split('\n')
    .map((l) => l.replace(/\u00A0/g, ' ').trim())
    .filter((l) => l);

  const priceLine = lines.find((l) => /CHF/i.test(l)) || '';
  const priceMatch = priceLine.match(/([\d'\s\.]+)\s*-?\.?\s*$/);

  const surfaceLine = lines.find((l) => /m2|m²|m2/i.test(l)) || '';
  const surfaceMatch = surfaceLine.match(/(\d+(?:[.,]\d+)?)/);

  // rooms often appear as a standalone line like '2.5' or '1.5' or '3'
  const roomLine = lines.find((l) => /^\d+(?:[.,]\d+)?$/.test(l)) || '';
  const rooms = roomLine ? Number.parseFloat(roomLine.replace(',', '.')) : null;

  const titleLine = lines.find((l) => /Appartement|Studio|Chambre|Maison/i.test(l)) || null;

  const description = (() => {
    // take a short descriptive line (longer than 10 chars, not price/size)
    const desc = lines.find((l) => l.length > 10 && !/CHF|m2|m²|Appartement|Studio|Chambre|Maison/i.test(l));
    return desc || null;
  })();

  return {
    price: priceMatch ? toIntOrNull(priceMatch[1]) : null,
    rooms,
    living_space_m2: surfaceMatch ? Number.parseFloat(String(surfaceMatch[1]).replace(',', '.')) : null,
    property_type: titleLine && /Studio/i.test(titleLine) ? 'studio' : titleLine && /Appartement/i.test(titleLine) ? 'apartment' : titleLine && /Maison/i.test(titleLine) ? 'house' : null,
    title: titleLine,
    description,
  };
}

async function extractListings(page) {
  const raw = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href*="/location/"]'));
    const seen = new Set();
    const results = [];

    anchors.forEach((a) => {
      const href = a.getAttribute('href') || a.href || '';
      if (!href) return;
      // normalize and dedupe by resolved href
      try {
        const resolved = new URL(href, document.baseURI).toString();
        if (seen.has(resolved)) return;
        seen.add(resolved);
      } catch (e) {
        if (seen.has(href)) return;
        seen.add(href);
      }

      const text = (a.textContent || a.innerText || '').trim();
      const card = a.closest('.card') || a.closest('.listing') || a.closest('[data-role]') || a.parentElement;

      // robust image extraction: img, data-src, srcset, background-image
      let img = null;
      const imgEl = a.querySelector('img') || card?.querySelector('img');
      if (imgEl) {
        img = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || imgEl.getAttribute('data-lazy-src') || imgEl.getAttribute('data-srcset') || imgEl.src || null;
        if (!img && imgEl.getAttribute('srcset')) {
          const srcset = imgEl.getAttribute('srcset').split(',')[0].trim().split(' ')[0];
          img = srcset || null;
        }
      }

      if (!img && card) {
        const dataSrc = card.querySelector('[data-src]')?.getAttribute('data-src') || card.querySelector('[data-bg]')?.getAttribute('data-bg') || null;
        if (dataSrc) img = dataSrc;
        if (!img) {
          const styleEl = card.querySelector('[style*="background"]') || card;
          const style = styleEl?.getAttribute('style') || '';
          const m = style.match(/background(?:-image)?:\s*url\((['"]?)(.*?)\1\)/i);
          if (m) img = m[2];
        }
      }

      const context = (card?.textContent || a.textContent || '').trim();
      // Require a price and Lausanne mention to be considered a listing
      if (!/CHF\s*[\d'\s\.]+/i.test(context)) return;
      if (!/lausanne/i.test(context)) return;

      results.push({ href, text: context, image_url: img });
    });

    return results;
  });

  return raw.map((item) => {
    // Build a stable unique id from the last path segment of the URL when possible
    let idRaw = null;
    try {
      const u = new URL(item.href, 'https://www.naef.ch');
      const parts = u.pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1] || parts[parts.length - 2] || '';
      idRaw = String(last || u.search || item.href).replace(/[^0-9A-Za-z._-]/g, '_').slice(-40);
    } catch (e) {
      idRaw = item.href.replace(/[^0-9a-z]/gi, '').slice(-24);
    }
    const parsed = parseListingText(item.text);

    return {
      id: `${ID_PREFIX}${idRaw}`,
      source: SOURCE_CONST,
      url: absolutizeUrl(item.href) || item.href,
      address_raw: item.text,
      image_urls: item.image_url ? [absolutizeUrl(item.image_url)].filter(Boolean) : [],
      title: parsed.title,
      description: parsed.description,
      price: parsed.price,
      currency: 'CHF',
      price_period: 'month',
      rooms: parsed.rooms,
      living_space_m2: parsed.living_space_m2,
      floor: null,
      total_floors: null,
      street: null,
      street_number: null,
      zip_code: null,
      city: 'Lausanne',
      country_code: 'CH',
      latitude: null,
      longitude: null,
      listing_type: 'rent',
      property_type: parsed.property_type,
      available_from: null,
    };
  });
}

module.exports = {
  id: SOURCE_ID,
  name: 'Naef',
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
    sampleHtmlPath: path.resolve(__dirname, '../../../data/naef/sample.html'),
    sampleExpectedPath: path.resolve(__dirname, '../../../data/naef/sample.expected.json'),
  },
};
