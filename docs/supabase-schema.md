# Supabase schema

The canonical schema lives in `schema/supabase.sql`. Run it once in the Supabase SQL Editor.

Key design points relevant to the scraper:

- **`id`** — source-prefixed string PK: `FACEBOOK_MARKETPLACE_123456789`
- **`source`** — clean constant: `FACEBOOK_MARKETPLACE` | `FACEBOOK_GROUPS`
- **Protected fields** — `personal_status`, `snooze_until`, `note` are user-managed. The scraper never writes to them on upsert.
- **`first_seen`** — set on first insert, preserved forever. The scraper uses `mergeForUpsert()` to carry it through on updates.
- **`last_seen`** / **`last_scraped_at`** — updated on every scrape run.
- **`price_history`** — append-only table populated by the scraper when `price` changes between runs.
- **DB triggers** — `_enforce_listings_defaults()` enforces field defaults and protects user fields server-side as a secondary safety net.
