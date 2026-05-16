const { loadSourceModules } = require('./loader');

function loadSourceRegistry() {
  return loadSourceModules();
}

function resolveSourceFromArgs(registry, args = [], explicitSourceId) {
  if (explicitSourceId) {
    return registry.find((entry) => entry.id === explicitSourceId || entry.name === explicitSourceId);
  }

  const sourceFlagIndex = args.indexOf('--source');

  if (sourceFlagIndex !== -1 && args[sourceFlagIndex + 1]) {
    const sourceId = args[sourceFlagIndex + 1];
    return registry.find((entry) => entry.id === sourceId || entry.name === sourceId);
  }

  return registry[0] || null;
}

module.exports = {
  loadSourceRegistry,
  resolveSourceFromArgs,
};