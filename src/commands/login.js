const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');
const { loadSourceRegistry, resolveSourceFromArgs } = require('../sources');
const { getCookiesPath } = require('../core/pipeline');

async function runLogin(args = []) {
  const registry = loadSourceRegistry();
  const source = resolveSourceFromArgs(registry, args);

  if (!source) {
    const ids = registry.map((s) => s.id).join(', ');
    throw new Error(
      `No source matched login command. Available sources: ${ids}`,
    );
  }

  if (!source.loginRequired) {
    console.log(`ℹ️  Source "${source.name}" does not require login. Nothing to do.`);
    return;
  }

  const storageDir = path.resolve(process.cwd(), 'storage');

  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  const cookiesPath = getCookiesPath(source);

  console.log(`🌐 Opening login page for: ${source.name}`);
  console.log(`📂 Cookies will be saved to: ${cookiesPath}`);
  console.log(
    '\n⚠️  The login command requires a graphical desktop.',
    '\n    Run it on your local Windows/macOS machine.',
    '\n    Then copy the cookies to your VPS:',
    `\n      scp ${cookiesPath} root@YOUR_VPS_IP:/root/immoflow-scraper/storage/`,
  );

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(source.loginUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  await new Promise((resolve) => {
    rl.question(
      '\n👉 Log in manually in the browser, then press ENTER here...\n',
      () => {
        rl.close();
        resolve();
      },
    );
  });

  const cookies = await context.cookies();
  fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));

  console.log(`\n✅ Saved ${cookies.length} cookies to: ${cookiesPath}`);
  console.log(
    `\n📋 Next: copy this file to your VPS:`,
    `\n   scp ${cookiesPath} root@YOUR_VPS_IP:/root/immoflow-scraper/storage/`,
  );

  await browser.close();
}

module.exports = { runLogin };
