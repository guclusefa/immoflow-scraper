/**
 * Galland 1889 source
 *
 * Site: https://1889.galland.ch
 * This source requires login to view user selections — set `loginRequired: true` and
 * point `loginUrl` to the selection/login page. Use the interactive `npm run login` command
 * to open a browser, log in manually and save cookies to storage/galland-cookies.json.
 */

const path = require('path');

const SOURCE_ID = 'galland';

function normalizeTargetUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch (_) {
    return url;
  }
}

function getTargets({ urls = [], env = {} } = {}) {
  if (urls.length) return urls.filter(Boolean);
  const envVar = env.GALLAND_URLS;
  if (!envVar) return [];
  return envVar.split(',').map((u) => u.trim()).filter(Boolean);
}

async function extractListings(page) {
  return page.evaluate(() => {
    const results = [];

    // The captured fixture uses articles with class 'box_object_item_userauth_selection'
    const items = Array.from(document.querySelectorAll('article.box_object_item_userauth_selection'));

    items.forEach((it) => {
      const objectId = it.getAttribute('data-object-id') || null;
      const linkEl = it.querySelector('a.box_inner_link[href]');
      const href = linkEl ? (linkEl.href.split('?')[0]) : null;
      const title = (it.querySelector('.box_body h2')?.innerText || '').trim() || null;

      const addr = (it.querySelector('.loc_addr')?.innerText || '').trim() || null;
      const city = (it.querySelector('.loc_city')?.innerText || '').trim() || null;

      const priceText = (it.querySelector('.caract_row.caract_price .value span')?.innerText || '').trim() || null;
      const priceMatch = priceText ? priceText.match(/(?:CHF|Fr)\s?([0-9'\s,.]+)/i) : null;
      const price = priceMatch ? parseInt((priceMatch[1] || priceMatch[0]).replace(/[^0-9]/g, ''), 10) : null;

      const surfaceText = (it.querySelector('.caract_surface .value')?.innerText || '').trim() || null;
      const livingMatch = surfaceText ? surfaceText.match(/([0-9]+)\s*m/i) : null;
      const living = livingMatch ? Number.parseInt(livingMatch[1], 10) : null;

      const roomsText = (it.querySelector('.caract_decimal.caract_rooms .value')?.innerText || '').trim() || null;
      const rooms = roomsText ? Number.parseFloat(roomsText.replace(',', '.')) : null;

      const floorText = (it.querySelector('.caract_floor .value')?.innerText || '').trim() || null;

      const imgEls = Array.from(it.querySelectorAll('img'))
        .map((i) => i.src || i.getAttribute('data-src') || '')
        .filter(Boolean);

      const address_raw = [title, addr, city].filter(Boolean).join(' | ');

      results.push({
        objectId,
        url: href,
        title,
        address_raw,
        street: addr,
        city,
        price,
        rooms,
        living_space_m2: living,
        floor: floorText,
        image_urls: imgEls,
      });
    });

    return results;
  }).then((raw) => raw.map((item) => ({
    id: item.objectId ? `GALLAND_${item.objectId}` : `GALLAND_${String(item.url || item.title).replace(/[^0-9A-Za-z._-]/g, '_')}`,
    source: 'GALLAND',
    url: item.url ? (item.url.startsWith('http') ? item.url : `https://1889.galland.ch${item.url}`) : null,
    address_raw: item.address_raw || null,
    image_urls: item.image_urls || [],
    title: item.title || null,
    description: null,
    price: item.price ?? null,
    currency: 'CHF',
    price_period: 'month',
    rooms: item.rooms ?? null,
    living_space_m2: item.living_space_m2 ?? null,
    floor: item.floor || null,
    total_floors: null,
    street: item.street || null,
    street_number: null,
    zip_code: null,
    city: item.city || null,
    country_code: 'CH',
    latitude: null,
    longitude: null,
    listing_type: 'rent',
    property_type: null,
    available_from: null,
  })));
}

module.exports = {
  id: SOURCE_ID,
  name: 'Galland 1889',
  loginRequired: true,
  // Use the selection page — user will be prompted to log in manually
  loginUrl: 'https://1889.galland.ch/fr/user/selection',
  maxScrolls: 40,
  initialDelayMs: 3000,
  scrollDelayMs: 1200,
  scrollDistance: 800,
  normalizeTargetUrl,
  getTargets,
  extractListings,
  fixtures: {
    sampleHtmlPath: path.resolve(__dirname, '../../../data/galland/sample.html'),
    sampleExpectedPath: path.resolve(__dirname, '../../../data/galland/sample.expected.json'),
  },
};
