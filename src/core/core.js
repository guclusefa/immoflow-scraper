/**
 * Shared normalization pipeline — mirrors Python scraper's scrapers/core.py.
 *
 * Pipeline:
 *   raw DOM/parse data
 *     → normalizeListing(raw)         coerce types, fill defaults, clean strings
 *     → mergeForUpsert(normalized, existing)   protect user-managed fields
 *     → batch upsert via db.upsert()
 */

'use strict';

const today = () => new Date().toISOString().split('T')[0];
const nowIso = () => new Date().toISOString();

/**
 * Field defaults applied when the scraper produces null/undefined.
 * Matches FIELD_DEFAULTS in the Python scraper.
 */
const FIELD_DEFAULTS = {
  currency:     'CHF',
  price_period: 'month',
  country_code: 'CH',
  listing_type: 'rent',
  status:       'active',
  image_urls:   [],
};

/** Columns the scraper must never overwrite on an existing row. */
const PROTECTED_USER_FIELDS = ['personal_status', 'snooze_until', 'note'];

/**
 * Coerce a raw listing object into the canonical shape expected by the DB.
 * Does NOT touch user-managed fields — that is mergeForUpsert's job.
 *
 * @param {object} raw  - Output of a source's extractListings()
 * @returns {object}    - Normalized listing ready for mergeForUpsert
 */
function normalizeListing(raw) {
  return {
    // ── Identity ────────────────────────────────────────────────────────────
    id:              String(raw.id),
    source:          String(raw.source),
    url:             String(raw.url),

    // ── Images ──────────────────────────────────────────────────────────────
    image_urls:      Array.isArray(raw.image_urls) ? raw.image_urls : FIELD_DEFAULTS.image_urls,

    // ── Scraper availability ─────────────────────────────────────────────────
    status:          FIELD_DEFAULTS.status,   // always 'active' when freshly scraped

    // ── Pricing ──────────────────────────────────────────────────────────────
    price:           toIntOrNull(raw.price),
    currency:        raw.currency        ?? FIELD_DEFAULTS.currency,
    price_period:    raw.price_period    ?? FIELD_DEFAULTS.price_period,

    // ── Property ─────────────────────────────────────────────────────────────
    rooms:           toNumericOrNull(raw.rooms),
    living_space_m2: toNumericOrNull(raw.living_space_m2),
    floor:           toIntOrNull(raw.floor),
    total_floors:    toIntOrNull(raw.total_floors),

    // ── Location ─────────────────────────────────────────────────────────────
    address_raw:     toStrOrNull(raw.address_raw),
    street:          toStrOrNull(raw.street),
    street_number:   toStrOrNull(raw.street_number),
    zip_code:        toStrOrNull(raw.zip_code),
    city:            toStrOrNull(raw.city),
    country_code:    raw.country_code ?? FIELD_DEFAULTS.country_code,
    latitude:        toNumericOrNull(raw.latitude),
    longitude:       toNumericOrNull(raw.longitude),

    // ── Listing metadata ─────────────────────────────────────────────────────
    title:           toStrOrNull(raw.title),
    description:     toStrOrNull(raw.description),
    listing_type:    raw.listing_type  ?? FIELD_DEFAULTS.listing_type,
    property_type:   toStrOrNull(raw.property_type),
    available_from:  toStrOrNull(raw.available_from),

    // ── Scraper timestamps ───────────────────────────────────────────────────
    last_seen:       today(),
    last_scraped_at: nowIso(),
    // first_seen is set by mergeForUpsert (preserve on update, set today on insert)
  };
}

/**
 * Merge a normalized listing with an existing DB row, protecting user fields.
 * Equivalent to the Python scraper's merge_for_upsert().
 *
 * @param {object}      normalized  - Output of normalizeListing()
 * @param {object|null} existing    - Row fetched from DB, or null for new listings
 * @returns {object}                - Final payload ready for upsert
 */
function mergeForUpsert(normalized, existing) {
  const payload = { ...normalized };

  if (existing) {
    // Preserve immutable audit timestamp
    payload.first_seen = existing.first_seen ?? today();

    // Protect user-managed workflow fields
    for (const field of PROTECTED_USER_FIELDS) {
      payload[field] = existing[field] ?? null;
    }

    // Preserve scraper-managed status (don't revert 'inactive' back to 'active')
    payload.status = existing.status ?? FIELD_DEFAULTS.status;
  } else {
    // New listing: set first_seen to today
    payload.first_seen = today();
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Type-coercion helpers
// ---------------------------------------------------------------------------

function toIntOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function toNumericOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function toStrOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

module.exports = {
  normalizeListing,
  mergeForUpsert,
  FIELD_DEFAULTS,
  PROTECTED_USER_FIELDS,
};
