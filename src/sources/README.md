Source modules — quick guide

This folder contains per-source modules. Each source is isolated at `src/sources/<id>/index.js`.

Quick rules to make adding a new source trivial:

- Export the required shape (see `docs/source-skeleton.md`). Keep `id` lowercase kebab-case.
- Don't modify `src/core/pipeline.js` or `src/main.js` — the loader auto-discovers `src/sources/*/index.js`.
- Read targets from env var: `<ID_UPPERCASE>_URLS` inside `getTargets({ env })`.
- `extractListings(page)` runs in the browser context via `page.evaluate()`; only use DOM APIs there.
- Post-process results outside `page.evaluate` to prefix IDs, set `source`, and fill missing fields with `null`.
- Fixtures: put `data/<id>/sample.html` and `data/<id>/sample.expected.json` and set `fixtures.sampleHtmlPath`/`sampleExpectedPath` accordingly.

When in doubt, copy `docs/source-skeleton.md` and adapt. Run the capture and validation scripts to iterate quickly:

```bash
npm run capture -- --source <id>
npm run validate -- --source <id>
npm run scrape -- --source <id>
```
