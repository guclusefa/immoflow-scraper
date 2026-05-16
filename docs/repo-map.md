# Repository map

```
immoflow-scraper/
├── src/
│   ├── main.js                     CLI dispatcher (login | scrape | capture | validate)
│   ├── commands/
│   │   ├── login.js                Headful cookie capture — run locally, copy cookies to VPS
│   │   ├── scrape.js               Orchestrates sources → pipeline → DB sync
│   │   ├── capture-fixture.js      Saves live HTML + parser output as test fixtures
│   │   └── validate-fixtures.js    Offline regression tests against saved fixtures
│   ├── core/
│   │   ├── config.js               Browser constants, scroll defaults
│   │   ├── core.js                 normalizeListing() + mergeForUpsert() — the data pipeline
│   │   ├── supabase.js             Pure-REST Supabase client (fetch only, zero SDK)
│   │   ├── price-utils.js          extractPrice() — regex price parser
│   │   └── pipeline.js             Browser lifecycle, smart scroll engine, syncListings()
│   └── sources/
│       ├── index.js                Source registry loader
│       ├── loader.js               Dynamic require() for source modules
│       ├── facebook-marketplace/
│       │   └── index.js            Marketplace feed + PDP parser
│       └── facebook-groups/
│           └── index.js            Groups feed parser
├── data/
│   ├── facebook-marketplace/
│   │   ├── sample.html             HTML fixture (captured from live page)
│   │   └── sample.expected.json    Expected parser output
│   └── facebook-groups/
│       ├── sample.html
│       └── sample.expected.json
├── schema/
│   ├── supabase.sql                Canonical schema (source of truth)
│   └── old_supabase.sql            Legacy schema (reference only)
├── storage/
│   └── facebook-cookies.json       Session cookies (gitignored)
├── .env.example
├── package.json
└── README.md
```

## Key design decisions

- **No Supabase SDK** — all DB calls use native `fetch` against the PostgREST REST API, mirroring the Python scraper.
- **PGRST102 guard** — `normalizePgrst102()` in `supabase.js` ensures every row in a batch upsert carries identical keys.
- **Protected user fields** — `mergeForUpsert()` in `core.js` never overwrites `personal_status`, `snooze_until`, or `note`.
- **Batch upsert** — all listings for a source are synced in a single POST, not N individual requests.
- **Source ID convention** — `FACEBOOK_MARKETPLACE_<id>` / `FACEBOOK_GROUPS_<id>`, matching the Python scraper's `SOURCE_PREFIX_ID` pattern.
