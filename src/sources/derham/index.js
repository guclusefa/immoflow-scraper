/**
 * Derham source.
 *
 * Lausanne rental search cards expose postal code, city, price, property type,
 * room count, and living area. Target URLs come from DERHAM_URLS.
 */

'use strict';

const path = require('path');
const { extractPrice } = require('../../core/price-utils');

const SOURCE_ID = 'derham';
const SOURCE_CONST = 'DERHAM';
const ID_PREFIX = 'DERHAM_';
const DEFAULT_TARGET_URL = 'https://www.derham.ch/fr/louer?field_geofield_proximity%5Bvalue%5D=0&field_geofield_proximity%5Bsource_configuration%5D%5Borigin_address%5D=Lausanne&field_property_type_target_id=17&field_total_price%5Bmin%5D=&field_total_price%5Bmax%5D=1750&field_part_number%5Bmin%5D=&field_part_number%5Bmax%5D=&field_living_area%5Bmin%5D=&field_living_area%5Bmax%5D=&sort_by=field_total_price_value_desc';

function normalizeTargetUrl(url) {
  try {
    const normalized = new URL(url);
    normalized.hash = '';
    return normalized.toString();
  } catch (_) {
    return String(url).split('#')[0];
  }
}

function getTargets({ urls = [], env = {} } = {}) {
  if (urls.length) return urls.filter(Boolean);

  const raw = env.DERHAM_URLS;
  if (!raw) return [DEFAULT_TARGET_URL];

  return raw.split(',').map((url) => url.trim()).filter(Boolean);
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
  const seen = new Set();

  const text = (node) => String(node?.textContent || '').replace(/\s+/g, ' ').trim();

  // Iterate over the full listing card containers instead of just anchor links
  const cards = Array.from(document.querySelectorAll('.views-row.loaded'));

  cards.forEach((card) => {
    try {
      const anchor = card.querySelector('.info-sec a');
      if (!anchor) return;

      const href = anchor.getAttribute('href') || anchor.href || '';
      const match = href.match(/\/fr\/louer\/([^/?#]+)/);
      if (!match) return;

      const rawId = match[1];
      if (seen.has(rawId)) return;
      seen.add(rawId);

      // Location extraction
      const locationNode = card.querySelector('.info-sec p');
      const locationText = text(locationNode);
      const postalMatch = locationText.match(/\b(\d{4})\s+(.+)/i);

      // FIX: Reverted to extracting the text content (e.g., "CHF 1'730") 
      // which works perfectly with your extractPrice utility.
      const priceNode = card.querySelector('.field--name-field-total-price');
      const priceValue = priceNode ? text(priceNode) : null;

      // Attributes extraction (Type, rooms, m2)
      const infoSpans = Array.from(card.querySelectorAll('.property-info-sec-common span')).map(n => text(n)).filter(Boolean);
      const propertyType = infoSpans.length > 0 ? infoSpans[0] : null;
      const roomText = infoSpans.find((val) => /pièces?/i.test(val)) || '';
      const areaText = infoSpans.find((val) => /m²?/i.test(val) || /m2/i.test(val)) || '';

      // Image extraction
      const imgNodes = Array.from(card.querySelectorAll('.carousel-item img'));
      const image_urls = imgNodes.map((img) => {
        const src = img.getAttribute('src') || img.src;
        if (!src) return null;
        return src.startsWith('/') ? `https://www.derham.ch${src}` : src;
      }).filter(Boolean);

      results.push({
        rawId,
        url: href.startsWith('/') ? `https://www.derham.ch${href}` : href,
        address_raw: locationText,
        title: null,
        property_type: propertyType,
        location_raw: postalMatch ? postalMatch[2].trim() : null,
        postal_code: postalMatch ? postalMatch[1] : null,
        price: priceValue,
        rooms: roomText,
        living_space_m2: areaText,
        image_urls: image_urls
      });
    } catch (_) {}
  });

  return results;
}

async function extractListings(page) {
  // Wait for the new robust selector
  await page.waitForSelector('.views-row.loaded .info-sec a', { timeout: 15000 });
  const raw = await page.evaluate(extractListingsFromDocument);

  return raw.map((item) => ({
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
    rooms: parseNumericText(item.rooms),
    living_space_m2: parseNumericText(item.living_space_m2),
    floor: null,
    total_floors: null,
    street: null,
    street_number: null,
    zip_code: item.postal_code || null,
    city: item.location_raw || null,
    country_code: 'CH',
    latitude: null,
    longitude: null,
    listing_type: 'rent',
    property_type: item.property_type || null,
    available_from: null,
  }));
}

module.exports = {
  id: SOURCE_ID,
  name: 'Derham',
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
    sampleHtmlPath: path.resolve(__dirname, '../../../data/derham/sample.html'),
    sampleExpectedPath: path.resolve(__dirname, '../../../data/derham/sample.expected.json'),
  },
};