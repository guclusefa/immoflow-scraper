'use strict';

const { createSupabaseClient } = require('../core/supabase');
const { runScrapePipeline }    = require('../core/pipeline');
const { loadSourceRegistry, resolveSourceFromArgs } = require('../sources');

function parseScrapeArgs(args = []) {
  const options = { urls: [] };

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '--source')  { options.sourceId = args[++i]; continue; }
    if (token === '--url')     { options.urls.push(args[++i]); continue; }
    if (token === '--headful') { options.headless = false;     continue; }
  }

  return options;
}

async function runScrape(args = []) {
  const registry = loadSourceRegistry();
  const options  = parseScrapeArgs(args);

  let sources;
  if (options.sourceId) {
    const source = resolveSourceFromArgs(registry, args, options.sourceId);
    if (!source) throw new Error(`No source found: "${options.sourceId}"`);
    sources = [source];
    console.log(`🎯 Running source: ${source.name} (${source.id})`);
  } else {
    sources = registry;
    console.log(`🧩 Running all ${sources.length} source(s): ${sources.map((s) => s.id).join(', ')}`);
  }

  if (!sources.length) {
    throw new Error('No sources registered. Add a source under src/sources/<id>/index.js');
  }

  const db = createSupabaseClient();
  console.log('🗄️  Supabase REST client ready.');

  await runScrapePipeline({ sources, db, options });
}

module.exports = { runScrape };
