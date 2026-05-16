require('dotenv').config();

const { runLogin } = require('./commands/login');
const { runScrape } = require('./commands/scrape');
const { runValidateFixtures } = require('./commands/validate-fixtures');
const { runCaptureFixture } = require('./commands/capture-fixture');

async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;

  console.log('✨ immoflow Scraper starting...');
  console.log(`🧾 Command: ${command || 'none'}`);

  if (!command) {
    throw new Error('Missing command. Use: login, scrape, capture, or validate.');
  }

  if (command === 'login') {
    return runLogin(rest);
  }

  if (command === 'scrape') {
    return runScrape(rest);
  }

  if (command === 'capture' || command === 'capture-fixture') {
    return runCaptureFixture(rest);
  }

  if (command === 'validate' || command === 'validate-fixtures') {
    return runValidateFixtures(rest);
  }

  throw new Error(`Unknown command: ${command}. Use: login, scrape, capture, or validate.`);
}

module.exports = {
  main,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`💥 ${error.message || error}`);
    process.exit(1);
  });
}