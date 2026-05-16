const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loadSourceRegistry } = require('../sources');

async function validateSource(source, browser) {
  if (!source.fixtures) {
    return { id: source.id, status: 'skipped', reason: 'no fixtures defined' };
  }

  const { sampleHtmlPath, sampleExpectedPath } = source.fixtures;

  if (!fs.existsSync(sampleHtmlPath)) {
    return {
      id: source.id,
      status: 'skipped',
      reason: `HTML fixture not found: ${path.relative(process.cwd(), sampleHtmlPath)}`,
    };
  }

  if (!fs.existsSync(sampleExpectedPath)) {
    return {
      id: source.id,
      status: 'skipped',
      reason: `Expected JSON not found: ${path.relative(process.cwd(), sampleExpectedPath)}`,
    };
  }

  const fixtureHtml = fs.readFileSync(sampleHtmlPath, 'utf8');
  const expected = JSON.parse(fs.readFileSync(sampleExpectedPath, 'utf8'));

  const page = await browser.newPage();

  try {
    await page.setContent(fixtureHtml, { waitUntil: 'domcontentloaded' });
    const actual = await source.extractListings(page);

    const actualJson = JSON.stringify(actual, null, 2);
    const expectedJson = JSON.stringify(expected, null, 2);

    if (actualJson !== expectedJson) {
      return {
        id: source.id,
        status: 'fail',
        reason: `Parser output does not match expected fixture.\nExpected:\n${expectedJson}\n\nActual:\n${actualJson}`,
      };
    }

    return { id: source.id, status: 'pass' };
  } finally {
    await page.close();
  }
}

async function runValidateFixtures(args = []) {
  const registry = loadSourceRegistry();

  // Allow filtering: npm run validate -- --source facebook-groups
  const sourceIndex = args.indexOf('--source');
  let sources = registry;

  if (sourceIndex !== -1 && args[sourceIndex + 1]) {
    const sourceId = args[sourceIndex + 1];
    sources = registry.filter((s) => s.id === sourceId);

    if (!sources.length) {
      throw new Error(`No source found with id: "${sourceId}"`);
    }
  }

  if (!sources.length) {
    throw new Error('No sources registered.');
  }

  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (const source of sources) {
      console.log(`🔬 Validating: ${source.name} (${source.id})`);
      const result = await validateSource(source, browser);
      results.push(result);
    }
  } finally {
    await browser.close();
  }

  console.log('\n📋 Fixture validation results:');
  let hasFail = false;

  for (const r of results) {
    if (r.status === 'pass') {
      console.log(`  ✅ ${r.id}`);
    } else if (r.status === 'skipped') {
      console.log(`  ⏭️  ${r.id} — skipped (${r.reason})`);
    } else {
      console.log(`  ❌ ${r.id} — FAILED\n${r.reason}`);
      hasFail = true;
    }
  }

  if (hasFail) {
    throw new Error('One or more fixture validations failed.');
  }
}

module.exports = { runValidateFixtures };
