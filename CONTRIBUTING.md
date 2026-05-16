# Contributing — Add a new source

Follow this checklist to add a new source quickly and consistently.

1. Create `src/sources/<id>/index.js` using `docs/source-skeleton.md`.
2. Add fixture placeholders in `data/<id>/sample.html` and `data/<id>/sample.expected.json`.
3. Add env var to `.env.example`: `<ID_UPPERCASE>_URLS=https://...`.
4. Capture a live fixture (if site requires login, run `npm run login` first):

```bash
npm run capture -- --source <id>
```

5. Validate fixtures offline:

```bash
npm run validate -- --source <id>
```

6. Run a smoke scrape locally:

```bash
npm run scrape -- --source <id>
```
