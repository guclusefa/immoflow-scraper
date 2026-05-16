/**
 * Shared runtime configuration constants.
 * Source-specific overrides belong in each source module, not here.
 */

'use strict';

// ---------------------------------------------------------------------------
// Directory layout
// ---------------------------------------------------------------------------
const STORAGE_DIR = 'storage';
const DATA_DIR    = 'data';

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const BROWSER_VIEWPORT = { width: 1366, height: 768 };

const BROWSER_NAVIGATION_TIMEOUT  = 60_000;
const BROWSER_INTERACTION_TIMEOUT = 30_000;

/** Required on Linux CI / VPS environments. */
const LINUX_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
];

// ---------------------------------------------------------------------------
// Source defaults (overridable per-source)
// ---------------------------------------------------------------------------
const DEFAULT_SOURCE_CONFIG = {
  scrollSafetyLimit: 50,
  scrollIdleRounds:  4,
  initialDelayMs:    6000,
  scrollDelayMs:     1200,
  scrollDistance:    900,
  loginUrl:          'https://www.facebook.com',
};

module.exports = {
  STORAGE_DIR,
  DATA_DIR,
  USER_AGENT,
  BROWSER_VIEWPORT,
  BROWSER_NAVIGATION_TIMEOUT,
  BROWSER_INTERACTION_TIMEOUT,
  LINUX_LAUNCH_ARGS,
  DEFAULT_SOURCE_CONFIG,
};
