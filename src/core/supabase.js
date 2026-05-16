/**
 * Supabase REST client — pure fetch, zero SDK.
 *
 * Mirrors the approach of the Python scraper (requests + PostgREST headers).
 * No @supabase/supabase-js dependency anywhere in this file.
 */

'use strict';

/**
 * Build and return a thin REST client for the Supabase PostgREST API.
 * @returns {{ get: Function, upsert: Function, insert: Function }}
 */
function createSupabaseClient() {
  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('[DB] SUPABASE_URL and SUPABASE_ANON_KEY must be set in the environment.');
  }

  const base = `${url.replace(/\/$/, '')}/rest/v1`;

  const commonHeaders = {
    'Content-Type':  'application/json',
    'apikey':        key,
    'Authorization': `Bearer ${key}`,
  };

  /**
   * GET rows from a table with simple eq-filters.
   * @param {string} table
   * @param {Record<string,string>} filters
   * @param {string} [select]
   * @returns {Promise<object[]>}
   */
  async function get(table, filters = {}, select = '*') {
    const params = new URLSearchParams({ select });
    for (const [col, val] of Object.entries(filters)) {
      params.set(col, `eq.${val}`);
    }

    const res = await fetch(`${base}/${table}?${params}`, {
      headers: commonHeaders,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[DB] GET ${table} failed (${res.status}): ${body}`);
    }

    return res.json();
  }

  /**
   * Upsert one or more rows.
   * Applies the PGRST102 normalization guard before sending.
   * @param {string} table
   * @param {object|object[]} rows
   * @param {string} [onConflict]
   * @returns {Promise<object[]>}
   */
  async function upsert(table, rows, onConflict = 'id') {
    const arr        = Array.isArray(rows) ? rows : [rows];
    const normalized = normalizePgrst102(arr);

    const res = await fetch(`${base}/${table}?on_conflict=${onConflict}`, {
      method:  'POST',
      headers: {
        ...commonHeaders,
        'Prefer': 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(normalized),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[DB] UPSERT ${table} failed (${res.status}): ${body}`);
    }

    return res.json();
  }

  /**
   * Insert one or more rows.
   * @param {string} table
   * @param {object|object[]} rows
   * @returns {Promise<object[]>}
   */
  async function insert(table, rows) {
    const arr        = Array.isArray(rows) ? rows : [rows];
    const normalized = normalizePgrst102(arr);

    const res = await fetch(`${base}/${table}`, {
      method:  'POST',
      headers: { ...commonHeaders, 'Prefer': 'return=representation' },
      body:    JSON.stringify(normalized),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[DB] INSERT ${table} failed (${res.status}): ${body}`);
    }

    return res.json();
  }

  return { get, upsert, insert };
}

/**
 * PGRST102 guard.
 * PostgREST rejects a batch where individual rows carry different key sets.
 * Collect the union of all keys and fill missing ones with null.
 * @param {object[]} rows
 * @returns {object[]}
 */
function normalizePgrst102(rows) {
  if (!rows.length) return rows;
  const allKeys = [...new Set(rows.flatMap(Object.keys))];
  return rows.map((row) => {
    const out = {};
    for (const key of allKeys) {
      out[key] = key in row ? row[key] : null;
    }
    return out;
  });
}

module.exports = { createSupabaseClient, normalizePgrst102 };
