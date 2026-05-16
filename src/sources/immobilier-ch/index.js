/**
 * immobilier.ch source.
 *
 * Search results pages expose server-rendered listing cards with price,
 * property type, address, surface, room count, and images.
 * Target URLs are read from IMMOBILIER_CH_URLS (comma-separated) in .env.
 */

'use strict';

const path = require('path');
const { extractPrice } = require('../../core/price-utils');

const SOURCE_ID = 'immobilier-ch';
const SOURCE_CONST = 'IMMOBILIER_CH';
const ID_PREFIX = 'IMMOBILIER_CH_';
const DEFAULT_TARGET_URL = 'https://www.immobilier.ch/fr/louer/appartement-maison/vaud/lausanne/page-1?t=rent&c=1;2&p=c11115&px=1700&nb=false&gr=1';

function normalizeTargetUrl(url) {
  try {
    const normalized = new URL(url);
    normalized.search = '';
    return normalized.toString();
  } catch (_) {
    return String(url).split('?')[0];
  }
}

function getTargets({ urls = [], env = {} } = {}) {
  if (urls.length) return urls.filter(Boolean);

  const raw = env.IMMOBILIER_CH_URLS;
  if (!raw) return [DEFAULT_TARGET_URL];

  return raw.split(',').map((url) => url.trim()).filter(Boolean);
}

function parseAddressParts(addressRaw) {
  const value = String(addressRaw || '').trim();
  const match = value.match(/^(\d{4})\s+([^,]+)(?:,\s*(.+))?$/);

  if (!match) {
    return {
      zip_code: null,
      city: null,
      street: null,
      street_number: null,
    };
  }

  const zipCode = match[1];
  const city = match[2].trim();
  const streetRaw = (match[3] || '').trim();

  if (!streetRaw || /agence/i.test(streetRaw)) {
    return {
      zip_code: zipCode,
      city,
      street: null,
      street_number: null,
    };
  }

  const streetMatch = streetRaw.match(/^(.*?)(?:\s+(\d+[a-zA-Z]?))?$/);

  return {
    zip_code: zipCode,
    city,
    street: streetMatch ? streetMatch[1].trim() || null : streetRaw,
    street_number: streetMatch && streetMatch[2] ? streetMatch[2].trim() : null,
  };
}

function parseNumericText(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const normalized = text.replace(/'/g, '').replace(/\s+/g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractListingsFromDocument() {
  const results = [];
  const cards = Array.from(document.querySelectorAll('div.filter-item-container a[id^="link-result-item-"]'));
  const absolutizeUrl = (src) => {
    if (!src) return '';
    try {
      return new URL(src, 'https://www.immobilier.ch').toString();
    } catch (_) {
      return src;
    }
  };

  cards.forEach((anchor) => {
    try {
      const href = anchor.getAttribute('href') || anchor.href || '';
      const idMatch = href.match(/-(\d+)(?:\/?)$/);
      if (!idMatch) return;

      const rawId = idMatch[1];
      const content = anchor.querySelector('.filter-item-content');
      const characteristics = anchor.querySelector('.filter-item-characteristic');
      if (!content) return;

      const title = (content.querySelector('.title')?.innerText || '').trim() || null;
      const propertyType = (content.querySelector('.object-type')?.innerText || '').trim() || null;
      const paragraphs = Array.from(content.querySelectorAll('p')).map((p) => (p.innerText || '').trim()).filter(Boolean);
      const addressRaw = paragraphs[1] || paragraphs[0] || '';
      if (!addressRaw) return;

      const imageUrls = Array.from(anchor.querySelectorAll('img'))
        .map((img) => img.getAttribute('src') || img.getAttribute('data-src') || img.currentSrc || img.src || '')
        .map(absolutizeUrl)
        .filter(Boolean);

      const surfaceText = characteristics?.querySelector('.space')?.innerText || '';
      const roomsText = characteristics?.querySelector('i[title*="pièce" i]')?.getAttribute('title') || characteristics?.querySelector('i[title*="pièce" i]')?.parentElement?.innerText || '';
      const roomMatch = roomsText.match(/([\d.]+)\s*pièce/i);

      results.push({
        rawId,
        url: href.startsWith('/') ? `https://www.immobilier.ch${href}` : href,
        address_raw: addressRaw,
        image_urls: [...new Set(imageUrls)],
        title: null,
        property_type: propertyType,
        price: content.querySelector('.title')?.innerText || '',
        rooms: roomMatch ? roomMatch[1] : '',
        living_space_m2: surfaceText.replace(/\D+/g, ''),
      });
    } catch (_) {}
  });

  return results;
}

async function extractListings(page) {
  const raw = await page.evaluate(extractListingsFromDocument);

  return raw.map((item) => {
    const addressParts = parseAddressParts(item.address_raw);

    return {
      id: `${ID_PREFIX}${item.rawId}`,
      source: SOURCE_CONST,
      url: item.url,
      address_raw: item.address_raw,
      image_urls: item.image_urls || [],
      title: item.title,
      description: null,
      price: extractPrice(item.price),
      currency: 'CHF',
      price_period: 'month',
      rooms: parseNumericText(item.rooms),
      living_space_m2: parseNumericText(item.living_space_m2),
      floor: null,
      total_floors: null,
      street: addressParts.street,
      street_number: addressParts.street_number,
      zip_code: addressParts.zip_code,
      city: addressParts.city,
      country_code: 'CH',
      latitude: null,
      longitude: null,
      listing_type: 'rent',
      property_type: item.property_type,
      available_from: null,
    };
  });
}

module.exports = {
  id: SOURCE_ID,
  name: 'immobilier.ch',
  loginRequired: false,
  loginUrl: null,
  scrollSafetyLimit: 10,
  scrollIdleRounds: 2,
  initialDelayMs: 2500,
  scrollDelayMs: 1000,
  scrollDistance: 900,
  scrollTargetPreference: 'auto',
  normalizeTargetUrl,
  getTargets,
  extractListings,
  fixtures: {
    sampleHtmlPath: path.resolve(__dirname, '../../../data/immobilier-ch/sample.html'),
    sampleExpectedPath: path.resolve(__dirname, '../../../data/immobilier-ch/sample.expected.json'),
  },
};