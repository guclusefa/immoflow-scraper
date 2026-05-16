const { runValidateFixtures } = require('../src/commands/validate-fixtures');

runValidateFixtures().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});