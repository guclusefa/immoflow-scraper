'use strict';

const { createSupabaseClient } = require('../core/supabase');
const { runScrapePipeline }    = require('../core/pipeline');
const { loadSourceRegistry, resolveSourceFromArgs } = require('../sources');

function isTruthy(value) {
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Discord Alert Engine
// ---------------------------------------------------------------------------

function buildRunStats(summary = []) {
  const stats = {
    totalSources: summary.length,
    okSources: 0,
    warningSources: 0,
    failedSources: 0,
    skippedSources: 0,
    newCount: 0,
    updatedCount: 0,
    status: 'GREEN' // Default to green
  };

  summary.forEach((row) => {
    stats.newCount += Number(row.newCount || 0);
    stats.updatedCount += Number(row.updatedCount || 0);

    // 1. Total Source Crash
    if (row.error) {
      stats.failedSources++;
      return;
    }

    // 2. Skipped Source (Treat as a warning for overall run health)
    if (row.skipped) {
      stats.skippedSources++;
      stats.warningSources++;
      return;
    }

    // 3. Inspect URL-level results
    let hasUrlError = false;
    let hasWarning = false;

    (row.urlResults || []).forEach((res) => {
      if (res.error || res.sessionExpired) hasUrlError = true;
      else if (res.warnings && res.warnings.length > 0) hasWarning = true;
    });

    if (hasUrlError) {
      stats.failedSources++; // Treat source as failed if any URL had a hard error
    } else if (hasWarning) {
      stats.warningSources++; // Treat source as warning if any URL had a warning
    } else {
      stats.okSources++;
    }
  });

  // Determine overarching color status
  if (stats.failedSources === stats.totalSources && stats.totalSources > 0) {
    stats.status = 'RED'; // Total failure
  } else if (stats.failedSources > 0 || stats.warningSources > 0) {
    stats.status = 'ORANGE'; // Partial failure or warnings present
  }

  return stats;
}

async function sendDiscordRunAlert({ summary, startedAt, endedAt, sourceId }) {
  const webhookUrl = (process.env.DISCORD_WEBHOOK_URL || '').trim();
  if (!webhookUrl) return;

  const stats = buildRunStats(summary);
  const alertOnSuccess = isTruthy(process.env.DISCORD_ALERT_ON_SUCCESS || '');
  
  // Only skip if it's completely GREEN and the user turned off success alerts
  if (stats.status === 'GREEN' && !alertOnSuccess) return;

  const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
  const elapsedSec = (durationMs / 1000).toFixed(1) + 's';
  const modeLabel = sourceId ? `Source: ${sourceId}` : 'All Sources';

  // Map status to colors and icons
  const colorMap = {
    GREEN: 0x2ECC71,  // Success
    ORANGE: 0xF39C12, // Warnings / Partial Failures
    RED: 0xE74C3C     // Fatal
  };
  
  const iconMap = {
    GREEN: '✅',
    ORANGE: '⚠️',
    RED: '❌'
  };

  const embed = {
    title: `${iconMap[stats.status]} immoflow scrape finished`,
    color: colorMap[stats.status],
    fields: [
      { name: 'Run Details', value: `**Mode:** ${modeLabel}\n**Time:** ${elapsedSec}`, inline: true },
      { name: 'Summary', value: `✅ ${stats.okSources} | ⚠️ ${stats.warningSources} | ❌ ${stats.failedSources} | ⏭️ ${stats.skippedSources}`, inline: true },
      { name: 'Database', value: `✨ **${stats.newCount}** new\n🔄 **${stats.updatedCount}** updated`, inline: true },
    ],
    timestamp: endedAt.toISOString(),
    footer: { text: 'immoflow scraper engine' },
  };

  // Build a detailed breakdown per source
  for (const row of summary) {
    let fieldName = '';
    let lines = [];

    if (row.error) {
      fieldName = `❌ ${row.id.toUpperCase()}`;
      lines.push(`**Fatal Error**: ${row.error}`);
    } else if (row.skipped) {
      fieldName = `⏭️ ${row.id.toUpperCase()}`;
      lines.push(`*Skipped: ${row.skipReason}*`);
    } else {
      fieldName = `📊 ${row.id.toUpperCase()} (+${row.newCount} / ~${row.updatedCount})`;
      
      // Breakdown each URL
      for (const res of (row.urlResults || [])) {
        // Truncate URL for readable discord logs
        let shortUrl = res.url;
        try { 
          const u = new URL(res.url); 
          shortUrl = (u.pathname + u.search).replace(/\/$/, ''); 
        } catch(e){}
        if (shortUrl.length > 45) shortUrl = shortUrl.substring(0, 42) + '...';

        if (res.sessionExpired) {
          lines.push(`❌ \`${shortUrl}\`\n↳ Session expired (Needs login)`);
        } else if (res.error) {
          lines.push(`❌ \`${shortUrl}\`\n↳ Error: ${res.error}`);
        } else if (res.warnings && res.warnings.length > 0) {
          lines.push(`⚠️ \`${shortUrl}\`\n↳ ${res.listingCount} items. *${res.warnings.join(', ')}*`);
        } else {
          lines.push(`✅ \`${shortUrl}\`\n↳ ${res.listingCount} items (${res.scrollAttempts} scrolls)`);
        }
      }
      
      if (lines.length === 0) lines.push('*No URLs processed*');
    }

    let fieldValue = lines.join('\n');
    // Discord max length per field value is 1024
    if (fieldValue.length > 1024) {
      fieldValue = fieldValue.substring(0, 1010) + '... (truncated)';
    }

    embed.fields.push({
      name: fieldName,
      value: fieldValue,
      inline: false
    });
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'immoflow', embeds: [embed] }),
    });

    if (!res.ok) {
      const respText = await res.text().catch(() => '');
      console.error(`⚠️  Discord webhook failed (${res.status}): ${respText}`);
    }
  } catch (err) {
    console.error(`⚠️  Discord webhook error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main CLI Runner
// ---------------------------------------------------------------------------

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

  // Determine if we should crash the script (only if ALL failed or a fatal error happened)
  const stats = buildRunStats(summary);
  if (stats.status === 'RED') {
    const failedSources = summary.filter((row) => row.error).map((row) => row.id).join(', ');
    throw new Error(`Scrape completed with total failure. Failed source(s): ${failedSources || 'All URLs failed'}`);
  }
}

module.exports = { runScrape };