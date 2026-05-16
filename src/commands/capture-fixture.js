/**
 * Capture fixture from live page
 *
 * Saves HTML snapshot and parser output as test fixtures under data/<source-id>/
 * Used when adding a new source to build and validate parsers offline.
 *
 * Usage:
 *   npm run capture -- --source <id>
 *   npm run capture -- --source <id> --url <url>
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loadSourceRegistry, resolveSourceFromArgs } = require('../sources');
const { getCookiesPath, buildLaunchOptions } = require('../core/pipeline');
const { USER_AGENT, BROWSER_VIEWPORT, BROWSER_NAVIGATION_TIMEOUT, DATA_DIR } = require('../core/config');

function parseArgs(args = []) {
  const options = { urls: [] };

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--source') {
      options.sourceId = args[i + 1];
      i += 1;
    } else if (args[i] === '--url') {
      options.urls.push(args[i + 1]);
      i += 1;
    }
  }

  return options;
}

async function runCaptureFixture(args = []) {
  const registry = loadSourceRegistry();
  const options = parseArgs(args);

  if (!options.sourceId) {
    throw new Error('--source is required. Usage: npm run capture -- --source <id>');
  }

  const source = resolveSourceFromArgs(registry, args, options.sourceId);

  if (!source) {
    const ids = registry.map((s) => s.id).join(', ');
    throw new Error(`Source "${options.sourceId}" not found. Available: ${ids}`);
  }

  const targets = source.getTargets({ urls: options.urls, env: process.env });

  if (!targets.length) {
    throw new Error(
      `No target URLs for source "${source.id}". Pass --url or set the env variable.`,
    );
  }

  const targetUrl = targets[0];
  const outputDir = path.resolve(process.cwd(), DATA_DIR, source.id);
  const outputHtml = path.join(outputDir, 'sample.html');
  const outputExpected = path.join(outputDir, 'sample.expected.json');

  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`📸 Capturing fixture for: ${source.name}`);
  console.log(`   URL: ${targetUrl}`);
  console.log(`   Output: ${outputHtml}`);

  const browser = await chromium.launch(buildLaunchOptions(true));
  const context = await browser.newContext({
    viewport: BROWSER_VIEWPORT,
    userAgent: USER_AGENT,
  });

  try {
    // Load cookies if source needs auth
    if (source.loginRequired) {
      const cookiesPath = getCookiesPath(source);
      if (fs.existsSync(cookiesPath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
        await context.addCookies(cookies);
        console.log(`🍪 Loaded ${cookies.length} cookies`);
      } else {
        console.warn(`⚠️  No cookies found at ${cookiesPath}. Captured HTML may be a login page.`);
      }
    }

    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: BROWSER_NAVIGATION_TIMEOUT });
    await page.waitForTimeout(source.initialDelayMs ?? 6000);

    // Save HTML
    const html = await page.content();
    fs.writeFileSync(outputHtml, html, 'utf8');
    console.log(`✅ Saved HTML fixture: ${outputHtml}`);

    // Save parser output as expected JSON
    const listings = await source.extractListings(page);
    fs.writeFileSync(outputExpected, JSON.stringify(listings, null, 2), 'utf8');
    console.log(`✅ Saved expected JSON: ${outputExpected} (${listings.length} listings)`);

    if (!listings.length) {
      console.warn('⚠️  Parser returned 0 listings. Page may require auth or selectors need adjustment.');
    }

    console.log('\n📋 Next steps:');
    console.log('  1. Review the expected JSON and correct any bad parses.');
    console.log(`  2. Update parser in src/sources/${source.id}/index.js if needed.`);
    console.log(`  3. Run: npm run validate -- --source ${source.id}`);

    await page.close();
  } finally {
    await browser.close();
  }
}

module.exports = {
  runCaptureFixture,
};
