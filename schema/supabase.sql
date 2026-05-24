-- =============================================================================
-- immoflow — Supabase Schema (CLEAN RESET v2)
-- Run once in the Supabase SQL Editor.
--
-- CLEAN RESET: Uncomment and run the DROP block first, then the full file.
-- =============================================================================

-- DROP TABLE IF EXISTS price_history   CASCADE;
-- DROP TABLE IF EXISTS listings        CASCADE;
-- DROP TABLE IF EXISTS api_key_states  CASCADE;
-- DROP FUNCTION IF EXISTS _set_updated_at()       CASCADE;
-- DROP FUNCTION IF EXISTS _enforce_listings_defaults() CASCADE;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- Shared trigger functions
-- =============================================================================

-- Automatically bumps updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION _set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Intercepts any explicit NULL sent by the REST API client and replaces it
-- with the correct business default.  Works on INSERT AND UPDATE so that
-- a PATCH that accidentally sends null: … is also protected.
CREATE OR REPLACE FUNCTION _enforce_listings_defaults()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Scraper-owned fields: fall back to safe values if NULL arrives
    NEW.status          = COALESCE(NEW.status,        'active');
    NEW.currency        = COALESCE(NEW.currency,      'CHF');
    NEW.price_period    = COALESCE(NEW.price_period,  'month');
    NEW.country_code    = COALESCE(NEW.country_code,  'CH');
    NEW.listing_type    = COALESCE(NEW.listing_type,  'rent');
    NEW.image_urls      = COALESCE(NEW.image_urls,    '{}');
    NEW.first_seen      = COALESCE(NEW.first_seen,    CURRENT_DATE);
    NEW.last_seen       = COALESCE(NEW.last_seen,     CURRENT_DATE);
    NEW.last_scraped_at = COALESCE(NEW.last_scraped_at, NOW());

    -- User-workflow fields: only set default on INSERT, never overwrite
    -- existing user choices on UPDATE.
    IF TG_OP = 'INSERT' THEN
        NEW.personal_status = COALESCE(NEW.personal_status, 'inbox');
        IF NEW.personal_status = 'contacted' THEN
            NEW.contacted_at = NOW();
        END IF;
    ELSE
        -- On UPDATE: if the incoming value is NULL, keep the existing value.
        -- This is the correct guard: a scraper upsert must never zero out
        -- a field the user has set in the UI.
        NEW.personal_status = COALESCE(NEW.personal_status, OLD.personal_status, 'inbox');
        NEW.snooze_until    = COALESCE(NEW.snooze_until,    OLD.snooze_until);
        NEW.note            = COALESCE(NEW.note,            OLD.note);

        -- Only stamp the timestamp when the row newly enters contacted.
        IF NEW.personal_status = 'contacted'
           AND OLD.personal_status IS DISTINCT FROM 'contacted' THEN
            NEW.contacted_at = NOW();
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- =============================================================================
-- api_key_states
-- Tracks per-key health: quota, cooldowns, counters.
-- =============================================================================

CREATE TABLE IF NOT EXISTS api_key_states (
    key_id           TEXT        PRIMARY KEY,                  -- last-8-char fingerprint
    label            TEXT        NOT NULL,                     -- e.g. "key_1"
    status           TEXT        NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active', 'rate_limited', 'exhausted', 'invalid')),
    cooldown_until   TIMESTAMPTZ,                              -- NULL = not in cooldown
    reset_at         TIMESTAMPTZ,                              -- estimated quota reset
    total_requests   INTEGER     NOT NULL DEFAULT 0,
    total_failures   INTEGER     NOT NULL DEFAULT 0,
    last_error       TEXT,
    last_failure_at  TIMESTAMPTZ,
    last_success_at  TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_api_key_states_updated_at ON api_key_states;
CREATE TRIGGER trg_api_key_states_updated_at
    BEFORE UPDATE ON api_key_states
    FOR EACH ROW EXECUTE FUNCTION _set_updated_at();

CREATE INDEX IF NOT EXISTS idx_api_key_states_status ON api_key_states (status);

-- =============================================================================
-- listings
-- Core table.  One row per unique listing discovered across all sources.
-- =============================================================================

CREATE TABLE IF NOT EXISTS listings (

    -- ── Identity ─────────────────────────────────────────────────────────────
    id               TEXT        PRIMARY KEY,   -- source-prefixed: "IMMOSCOUT_4002086675"
    source           TEXT        NOT NULL,       -- "IMMOSCOUT" | "FLATFOX" | "IMMOBILIER"
    url              TEXT        NOT NULL,

    -- ── Images ───────────────────────────────────────────────────────────────
    image_urls       TEXT[]      NOT NULL DEFAULT '{}',

    -- ── Scraper availability ─────────────────────────────────────────────────
    status           TEXT        NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active', 'inactive')),

    -- ── Pricing ──────────────────────────────────────────────────────────────
    price            INTEGER     CHECK (price IS NULL OR price >= 0),
    currency         TEXT        NOT NULL DEFAULT 'CHF',
    price_period     TEXT        NOT NULL DEFAULT 'month'
                                 CHECK (price_period IN ('month', 'week', 'day', 'total')),

    -- ── Property ─────────────────────────────────────────────────────────────
    rooms            NUMERIC(4,1),
    living_space_m2  NUMERIC(7,2),
    floor            SMALLINT,
    total_floors     SMALLINT,

    -- ── Location ─────────────────────────────────────────────────────────────
    address_raw      TEXT,
    street           TEXT,
    street_number    TEXT,
    zip_code         TEXT,
    city             TEXT,
    country_code     TEXT        NOT NULL DEFAULT 'CH',
    latitude         NUMERIC(9,6),
    longitude        NUMERIC(9,6),

    -- ── Listing metadata ─────────────────────────────────────────────────────
    title            TEXT,
    description      TEXT,
    listing_type     TEXT        NOT NULL DEFAULT 'rent'
                                 CHECK (listing_type IN ('rent', 'buy', 'share', 'sublet', 'unknown')),
    property_type    TEXT,
    available_from   DATE,

    -- ── Scraper timestamps ───────────────────────────────────────────────────
    first_seen       DATE        NOT NULL DEFAULT CURRENT_DATE,
    last_seen        DATE        NOT NULL DEFAULT CURRENT_DATE,
    last_scraped_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    contacted_at     TIMESTAMPTZ,

    -- ── User workflow (UI-managed; scrapers must NEVER overwrite) ────────────
    personal_status  TEXT        NOT NULL DEFAULT 'inbox'
                                 CHECK (personal_status IN (
                                     'inbox', 'shortlisted', 'contacted',
                                     'followup', 'visit', 'applied',
                                     'accepted', 'refused', 'ignored', 'ghosted'
                                 )),
    snooze_until     DATE,
    note             TEXT,

    -- ── Audit ────────────────────────────────────────────────────────────────
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger order matters: enforce defaults first, then stamp updated_at.
DROP TRIGGER IF EXISTS trg_listings_enforce_defaults ON listings;
CREATE TRIGGER trg_listings_enforce_defaults
    BEFORE INSERT OR UPDATE ON listings
    FOR EACH ROW EXECUTE FUNCTION _enforce_listings_defaults();

DROP TRIGGER IF EXISTS trg_listings_updated_at ON listings;
CREATE TRIGGER trg_listings_updated_at
    BEFORE UPDATE ON listings
    FOR EACH ROW EXECUTE FUNCTION _set_updated_at();

-- Indexes for the access patterns used by the scraper and the UI.
CREATE INDEX IF NOT EXISTS idx_listings_source           ON listings (source);
CREATE INDEX IF NOT EXISTS idx_listings_status           ON listings (status);
CREATE INDEX IF NOT EXISTS idx_listings_personal_status  ON listings (personal_status);
CREATE INDEX IF NOT EXISTS idx_listings_zip_code         ON listings (zip_code);
CREATE INDEX IF NOT EXISTS idx_listings_city             ON listings (city);
CREATE INDEX IF NOT EXISTS idx_listings_price            ON listings (price);
CREATE INDEX IF NOT EXISTS idx_listings_rooms            ON listings (rooms);
CREATE INDEX IF NOT EXISTS idx_listings_last_seen        ON listings (last_seen);
CREATE INDEX IF NOT EXISTS idx_listings_last_scraped_at  ON listings (last_scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_contacted_at     ON listings (contacted_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_listing_type     ON listings (listing_type);
CREATE INDEX IF NOT EXISTS idx_listings_available_from   ON listings (available_from);

-- Auto-ghost contacted listings after 7 days without a reply.
CREATE OR REPLACE FUNCTION ghost_stale_contacted_listings()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
        updated_count INTEGER;
BEGIN
        UPDATE listings
             SET personal_status = 'ghosted'
         WHERE personal_status = 'contacted'
             AND contacted_at IS NOT NULL
             AND contacted_at <= NOW() - INTERVAL '7 days';

        GET DIAGNOSTICS updated_count = ROW_COUNT;
        RETURN updated_count;
END;
$$;

-- =============================================================================
-- price_history
-- Append-only audit trail of price changes.
-- =============================================================================

CREATE TABLE IF NOT EXISTS price_history (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id  TEXT        NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
    old_price   INTEGER,
    new_price   INTEGER,
    currency    TEXT        NOT NULL DEFAULT 'CHF',
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_listing_id ON price_history (listing_id);
CREATE INDEX IF NOT EXISTS idx_price_history_changed_at ON price_history (changed_at DESC);
