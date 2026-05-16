/**
 * Room Estate source.
 *
 * Room Estate search pages expose structured room cards with title, city,
 * roommate count, floor, surface, availability, price, and images.
 * Target URLs are read from ROOM_ESTATE_URLS (comma-separated) in .env.
 */

'use strict';

const path = require('path');
const { extractPrice } = require('../../core/price-utils');

const SOURCE_ID = 'room-estate';
const SOURCE_CONST = 'ROOM_ESTATE';
const ID_PREFIX = 'ROOM_ESTATE_';
const DEFAULT_TARGET_URL = 'https://roomestate.com/fr/room-search/Lausanne';

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

  const raw = env.ROOM_ESTATE_URLS;
  if (!raw) return [DEFAULT_TARGET_URL];

  return raw.split(',').map((url) => url.trim()).filter(Boolean);
}

function parseAddressParts(addressRaw) {
  const value = String(addressRaw || '').trim();
  const match = value.match(/^([^,]+)(?:,\s*(.+))?$/);

  if (!match) {
    return {
      zip_code: null,
      city: null,
      street: null,
      street_number: null,
    };
  }

  return {
    zip_code: null,
    city: match[1].trim() || null,
    street: match[2] ? match[2].trim() || null : null,
    street_number: null,
  };
}

function parseNumericText(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const normalized = text.replace(/'/g, '').replace(/\s+/g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFloorText(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const match = text.match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function parseAvailableFrom(value) {
  const text = String(value || '').trim();
  if (!text || /immédiatement/i.test(text)) return null;

  const dateMatch = text.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{4})/);
  if (dateMatch) {
    const parts = dateMatch[1].split(/[./-]/).map((part) => Number.parseInt(part, 10));
    if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
      const [day, month, year] = parts;
      const iso = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
      return iso;
    }
  }

  return null;
}

function extractListingsFromDocument() {
  const results = [];
  const cards = Array.from(document.querySelectorAll('[data-test-id^="roomCard-"]'));
  const text = (node) => String(node?.textContent || '').replace(/\s+/g, ' ').trim();

  const absolutizeUrl = (src) => {
    if (!src) return '';
    try {
      return new URL(src, 'https://roomestate.com').toString();
    } catch (_) {
      return src;
    }
  };

  cards.forEach((card) => {
    try {
      const link = card.querySelector('a.room-link[href]');
      const href = link?.getAttribute('href') || link?.href || '';
      const idMatch = href.match(/\/fr\/room\/(.+)$/);
      if (!idMatch) return;

      const rawId = idMatch[1];
      const roomInfo = card.querySelector('.room-info');
      const roomTypeNode = card.querySelector('.room-type');
      const addressNode = card.querySelector('.address-list');
      const priceNode = card.querySelector('.room-list-price .price');
      const currencyNode = card.querySelector('.room-list-price .currency');
      const availableNode = card.querySelector('.available');
      const detailValues = Array.from(card.querySelectorAll('.room-info-details span'))
        .map((node) => text(node))
        .filter(Boolean);

      const imageUrls = Array.from(card.querySelectorAll('.room-image-slider img'))
        .map((img) => img.getAttribute('src') || img.getAttribute('data-lazy') || img.getAttribute('data-src') || img.currentSrc || img.src || '')
        .map(absolutizeUrl)
        .filter(Boolean);

      const roomTypeText = text(roomTypeNode);
      const addressLabel = text(addressNode);
      const addressRaw = text(roomInfo) || text(card);
      if (!roomTypeText || !addressRaw) return;

      const propertyTypeMatch = roomTypeText.match(/^\S+\s*\|\s*([^|]+?)\s*\|\s*(.+)$/);
      const propertyType = propertyTypeMatch ? propertyTypeMatch[1].trim() : 'Chambre';
      const locationPart = propertyTypeMatch ? propertyTypeMatch[2].trim() : null;

      const roomDetailTexts = detailValues.slice();
      const roommatesText = roomDetailTexts.find((value) => /colocataires?/i.test(value)) || '';
      const floorText = roomDetailTexts.find((value) => /étage/i.test(value)) || '';
      const surfaceText = roomDetailTexts.find((value) => /m2|m²/i.test(value)) || '';

      results.push({
        rawId,
        url: href.startsWith('/') ? `https://roomestate.com${href}` : href,
        address_raw: addressRaw,
        image_urls: [...new Set(imageUrls)],
        title: roomTypeText,
        property_type: propertyType,
        location_part: locationPart,
        price: priceNode ? `${text(priceNode)} ${text(currencyNode)}`.trim() : '',
        available_from_text: text(availableNode),
        rooms: roommatesText,
        floor_text: floorText,
        living_space_m2: surfaceText,
        location_text: locationPart,
      });
    } catch (_) {}
  });

  return results;
}

async function extractListings(page) {
  const raw = await page.evaluate(extractListingsFromDocument);

  return raw.map((item) => {
    const addressParts = parseAddressParts(item.location_text);
    const city = addressParts.city || null;

    return {
      id: `${ID_PREFIX}${item.rawId}`,
      source: SOURCE_CONST,
      url: item.url,
      address_raw: item.address_raw,
      image_urls: item.image_urls || [],
      title: item.title || null,
      description: null,
      price: extractPrice(item.price),
      currency: 'CHF',
      price_period: 'month',
      rooms: null,
      living_space_m2: parseNumericText(item.living_space_m2),
      floor: parseFloorText(item.floor_text),
      total_floors: null,
      street: addressParts.street,
      street_number: addressParts.street_number,
      zip_code: addressParts.zip_code,
      city,
      country_code: 'CH',
      latitude: null,
      longitude: null,
      listing_type: 'share',
      property_type: item.property_type || null,
      available_from: parseAvailableFrom(item.available_from_text),
    };
  });
}

module.exports = {
  id: SOURCE_ID,
  name: 'Room Estate',
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
    sampleHtmlPath: path.resolve(__dirname, '../../../data/room-estate/sample.html'),
    sampleExpectedPath: path.resolve(__dirname, '../../../data/room-estate/sample.expected.json'),
  },
};