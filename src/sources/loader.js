const fs = require('fs');
const path = require('path');

function loadSourceModules() {
  const sourcesRoot = __dirname;
  const entries = fs.readdirSync(sourcesRoot, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(sourcesRoot, entry.name, 'index.js'))
    .filter((modulePath) => fs.existsSync(modulePath))
    .map((modulePath) => require(modulePath));
}

module.exports = {
  loadSourceModules,
};