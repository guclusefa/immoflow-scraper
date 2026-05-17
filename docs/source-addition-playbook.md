# Source Addition Playbook

Use this when a session receives: `Add this source: <url>` or similar.

This playbook is self-contained. You do not need anything beyond this repo to
add a working source.

---

## Step 1 — Understand the site

Before writing code, answer these questions:

1. Is it a feed / search results page, or individual listing pages?
2. Does it require login?
3. Is the content server-rendered (visible in raw HTML) or lazy-loaded by JS?
4. What is a reliable container selector for each listing?
5. What structured fields are available? (price, rooms, surface, address, coordinates, …)

If the site exposes a stable public JSON or API endpoint, use that instead of parsing rendered HTML. Parse the DOM only when the API is unavailable or missing fields you need.

Open the URL in a browser, inspect the DOM, find the repeating element that
wraps each listing. That is your `LISTING_SELECTOR`.

---

## Step 2 — Create the source module

```
src/sources/<id>/index.js
```

Use `docs/source-skeleton.md` as the starting template. Replace all `<placeholders>`.

Key decisions:
- `id` must be unique, lowercase, kebab-case. It drives the cookie file name
  and the env var name.
- `loginRequired` — if the site shows different content when logged in, set
  this to `true` and define `loginUrl`.
- `getTargets` reads `env.<ID_UPPERCASE>_URLS`. Match this exactly.
- `extractListings` should prefer the site's public API if one exists. When DOM
  parsing is necessary, it runs inside the browser via `page.evaluate()`. Only
  use browser APIs (no Node.js modules inside the callback). Post-processing
  (regex parsing, id prefixing) happens outside `page.evaluate`, in Node.js.

### Required return shape from `extractListings`

```js
{
  id,             // "<source>_<externalId>" — stable across runs
  source,         // source module id (the SOURCE_ID constant)
  url,            // string or 'none'
  image_urls,     // string[] — may be []
  address_raw,    // string — full raw text
  price,          // integer or null
  currency,       // 'CHF', 'EUR', etc.
  price_period,   // 'month' | 'week' | 'day' | 'total'
  rooms,          // number or null
  living_space_m2, // number or null
  floor,          // integer or null
  total_floors,   // integer or null
  street,         // string or null
  street_number,  // string or null
  zip_code,       // string or null
  city,           // string or null
  country_code,   // 'CH', 'FR', etc.
  latitude,       // number or null
  longitude,      // number or null
  title,          // string or null
  description,    // string or null
  listing_type,   // 'rent' | 'buy' | 'share' | 'sublet' | 'unknown'
  property_type,  // string or null
  available_from, // ISO date string or null
}
```

Never include `personal_status`, `snooze_until`, or `note` — the pipeline
manages them separately.

---

## Step 3 — Capture a fixture

```bash
npm run capture -- --source <id>
```

This opens a headless browser, navigates to the first target URL, waits for
content to load, saves the full page HTML to `data/<id>/sample.html`, and runs
the parser to generate `data/<id>/sample.expected.json`.

If the source requires login, load cookies first:
```bash
npm run login -- --source <id>
```
Then re-run `npm run capture -- --source <id>`.

Review `sample.expected.json` — if the parser missed listings or produced bad
data, fix `extractListings` and re-run capture or validate manually.

---

## Step 4 — Validate offline

```bash
npm run validate:fixtures -- --source <id>
```

This runs the parser against the saved HTML without touching the live site.
Iterate until it passes.

---

## Step 5 — Smoke test against live site

```bash
npm run scrape -- --source <id>
```

Watch the output. Verify:
- Target URLs resolve
- No redirect to login
- Listings are extracted and synced to Supabase
- `id` values are stable (run twice, same ids)

---

## Step 6 — Update env and docs

1. Add the new env var to `.env.example`:
   ```
   <ID_UPPERCASE>_URLS=https://example.com/listings
   ```

2. Add a one-line note to `docs/ai-context.md` under "Registered sources":
   ```
   - `<id>` — Short description. Requires login: yes/no. Env: `<ID_UPPERCASE>_URLS`.
     Returns: list which structured fields are reliably populated vs always null.
   ```

---

## Rules

- Do not edit `src/core/pipeline.js` or `src/main.js` for a new source.
- Do not edit the Supabase schema.
- The source loader discovers `src/sources/<id>/index.js` automatically.
- `extractListings` must always return objects with all fields listed above (null for missing).
- `id` must be stable across scrape runs — same listing = same id.
- Do not overwrite `personal_status`, `snooze_until`, or `note`.
- Prefix all ids with the source id: `"<source>_<externalId>"`.
