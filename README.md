# immoflow Scraper

Scrapes Sources for Swiss rental listings and pushes them to the shared **immoflow Supabase database** (`listings` table). Coexists with the Python scraper that targets ImmoScout24, Flatfox, and Immobilier.ch.

## Architecture

```
src/
  main.js                       CLI entry point
  commands/
    login.js                    Interactive cookie capture (headful, run locally)
    scrape.js                   Scrape + sync command
    capture-fixture.js          Capture live HTML snapshots for parser dev
    validate-fixtures.js        Offline parser regression tests
  core/
    config.js                   Browser/scroll constants
    core.js                     normalizeListing() + mergeForUpsert() pipeline
    supabase.js                 Pure-REST Supabase client (zero SDK)
    price-utils.js              extractPrice() regex helper
    pipeline.js                 Browser lifecycle + smart scroll engine + DB sync
  sources/
    facebook-marketplace/       Marketplace feed + PDP parser
    facebook-groups/            Groups feed parser
```

## Quick start

```bash
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_ANON_KEY, and target URLs

npm install
npm run install:browsers

# Capture cookies (run once on a machine with a display)
npm run login -- --source facebook-marketplace

# Run scrapers
npm run scrape:marketplace
npm run scrape:groups
npm run scrape:all
```

## ID convention

Listing IDs follow the same convention as the Python scraper:

| Source              | `listings.id`                    | `listings.source`     |
|---------------------|----------------------------------|-----------------------|
| Facebook Marketplace | `FACEBOOK_MARKETPLACE_123456789` | `FACEBOOK_MARKETPLACE` |
| Facebook Groups      | `FACEBOOK_GROUPS_987654321`      | `FACEBOOK_GROUPS`      |

## Data pipeline

```
extractListings(page)       → raw[]
  → normalizeListing(raw)   → coerce types, fill defaults
  → mergeForUpsert(n, existing) → protect personal_status / snooze_until / note
  → db.upsert('listings', payloads)  batch POST, PGRST102-safe
  → db.insert('price_history', …)    when price changed
```

## Protected user fields

The scraper **never overwrites** `personal_status`, `snooze_until`, or `note`. These are user-managed workflow fields set in the frontend UI.

## Cookie auth

Both Facebook sources share a single cookie file: `storage/facebook-cookies.json`.

```bash
# Capture once on a local machine
npm run login -- --source facebook-marketplace

# Deploy to VPS
scp storage/facebook-cookies.json root@VPS:/path/to/immoflow-scraper/storage/
```

## Fixture-based testing

```bash
# Capture a fresh fixture from a live page
npm run capture -- --source facebook-marketplace

# Run offline parser regression test
npm run validate -- --source facebook-marketplace
npm run validate   # all sources
```
