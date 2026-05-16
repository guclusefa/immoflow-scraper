/**
 * capture-fixture.js
 *
 * Captures a live page render from a source's first target URL and saves it
 * as an HTML fixture under data/<source-id>/sample.html. Used when adding a
 * new source so the parser can be built and validated offline.
 *
 * Usage:
 *   node scripts/capture-fixture.js --source <id>
 *   node scripts/capture-fixture.js --source <id> --url <url>
 *
 * After running, check data/<source-id>/sample.html and then create
 * data/<source-id>/sample.expected.json by hand (or by running the parser
 * against the fixture and reviewing the output).
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loadSourceRegistry } = require('../src/sources');
const { getCookiesPath, buildLaunchOptions } = require('../src/core/pipeline');
const { USER_AGENT, BROWSER_VIEWPORT, BROWSER_NAVIGATION_TIMEOUT, DATA_DIR } = require('../src/core/config');

function parseArgs(argv) {
  const args = { urls: [] };

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source') { args.sourceId = argv[i + 1]; i += 1; }
    else if (argv[i] === '--url') { args.urls.push(argv[i + 1]); i += 1; }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const registry = loadSourceRegistry();
  const source = registry.find((s) => s.id === args.sourceId);

  if (!source) {
    const ids = registry.map((s) => s.id).join(', ');
    throw new Error(`Source "${args.sourceId}" not found. Available: ${ids}`);
  }

  const targets = source.getTargets({ urls: args.urls, env: process.env });

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

  const launchOptions = buildLaunchOptions(true); // Always headless for fixtures
  const browser = await chromium.launch(launchOptions);

  const context = await browser.newContext({
    viewport: BROWSER_VIEWPORT,
    userAgent: USER_AGENT,
  });

  // Load cookies if source needs auth
  if (source.loginRequired) {
    const cookiesPath = getCookiesPath(source);

    if (!fs.existsSync(cookiesPath)) {
      console.warn(
        `⚠️  No cookies found at ${cookiesPath}. Captured HTML may be a login page.`,
      );
    } else {
      const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
      await context.addCookies(cookies);
      console.log(`🍪 Loaded ${cookies.length} cookies`);
    }
  }

  const page = await context.newPage();

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: BROWSER_NAVIGATION_TIMEOUT });
    await page.waitForTimeout(source.initialDelayMs ?? 6000);

    const html = await page.content();
    fs.writeFileSync(outputHtml, html, 'utf8');
    console.log(`✅ Saved HTML fixture: ${outputHtml}`);

    // Run parser on the captured page and save as expected JSON
    const listings = await source.extractListings(page);
    fs.writeFileSync(outputExpected, JSON.stringify(listings, null, 2), 'utf8');
    console.log(`✅ Saved expected JSON: ${outputExpected} (${listings.length} listings)`);

    if (!listings.length) {
      console.warn(
        '⚠️  Parser returned 0 listings. The page may require auth or your selectors need adjustment.',
      );
    }

    console.log('\n📋 Next steps:');
    console.log('  1. Review the expected JSON and correct any bad parses by hand.');
    console.log('  2. Update the parser in src/sources/', source.id, '/index.js if needed.');
    console.log('  3. Run: npm run validate:fixtures -- --source', source.id);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`💥 ${err.message}`);
  process.exit(1);
});
