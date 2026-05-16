'use strict';

const { createSupabaseClient } = require('../core/supabase');
const { runScrapePipeline }    = require('../core/pipeline');
const { loadSourceRegistry, resolveSourceFromArgs } = require('../sources');

function isTruthy(value) {
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function buildRunStats(summary = []) {
  return summary.reduce((acc, row) => {
    if (row.error) acc.failed += 1;
    else if (row.skipped) acc.skipped += 1;
    else {
      acc.succeeded += 1;
      acc.newCount += Number(row.newCount || 0);
      acc.updatedCount += Number(row.updatedCount || 0);
    }
    return acc;
  }, { succeeded: 0, failed: 0, skipped: 0, newCount: 0, updatedCount: 0 });
}

async function sendDiscordRunAlert({ summary, startedAt, endedAt, sourceId }) {
  const webhookUrl = (process.env.DISCORD_WEBHOOK_URL || '').trim();
  if (!webhookUrl) return;

  const stats = buildRunStats(summary);
  const hasFailure = stats.failed > 0;
  const alertOnSuccess = isTruthy(process.env.DISCORD_ALERT_ON_SUCCESS || '');
  if (!hasFailure && !alertOnSuccess) return;

  const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
  const modeLabel = sourceId ? `source=${sourceId}` : 'all-sources';
  const header = hasFailure ? 'immoflow scrape FAILED' : 'immoflow scrape OK';

  const details = summary
    .map((row) => {
      if (row.error) return `• **${row.id}**: ❌ FAILED — ${row.error}`;
      if (row.skipped) return `• **${row.id}**: ⚠️ SKIPPED`;
      return `• **${row.id}**: ✅ OK — ${row.newCount} new, ${row.updatedCount} updated`;
    })
    .join('\n');

  // Short list of failed items for quick scan
  const failedDetails = summary
    .filter((r) => r.error)
    .map((r) => `• ${r.id}: ${r.error}`)
    .slice(0, 6)
    .join('\n');

  const color = hasFailure ? 0xE74C3C : 0x2ECC71; // red / green
  const elapsedSec = (durationMs / 1000).toFixed(1) + 's';

  const embed = {
    title: `${hasFailure ? '❌' : '✅'} ${header}`,
    color,
    fields: [
      { name: 'Mode', value: modeLabel, inline: true },
      { name: 'Duration', value: elapsedSec, inline: true },
      { name: 'Sources', value: `ok=${stats.succeeded}, failed=${stats.failed}, skipped=${stats.skipped}`, inline: true },
      { name: 'Rows', value: `new=${stats.newCount}, updated=${stats.updatedCount}`, inline: true },
    ],
    description: details.slice(0, 3800) || '—',
    timestamp: endedAt.toISOString(),
    footer: { text: 'immoflow scraper' },
  };

  // If there are failures, add a concise failed-details field for quick scanning
  if (hasFailure && failedDetails) {
    embed.fields.push({ name: 'Failures (first 6)', value: failedDetails.slice(0, 1024) });
  }

  const body = {
    username: 'immoflow',
    embeds: [embed],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const respText = await res.text().catch(() => '');
      console.error(`⚠️  Discord webhook failed (${res.status}): ${respText}`);
    }
  } catch (err) {
    console.error(`⚠️  Discord webhook error: ${err.message}`);
  }
}

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
  const startedAt = new Date();

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

  const summary = await runScrapePipeline({ sources, db, options });
  const endedAt = new Date();

  await sendDiscordRunAlert({
    summary,
    startedAt,
    endedAt,
    sourceId: options.sourceId,
  });

  const failed = summary.filter((row) => row.error);
  if (failed.length) {
    const failedSources = failed.map((row) => row.id).join(', ');
    throw new Error(`Scrape completed with ${failed.length} failed source(s): ${failedSources}`);
  }
}

module.exports = { runScrape };
