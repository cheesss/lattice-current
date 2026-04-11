#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';

import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import {
  buildFollowedThemeBriefingPayload,
  buildFollowedThemeBriefingSnapshotDate,
} from './_shared/trend-dashboard-queries.mjs';
import { THEME_TAXONOMY, getThemeConfig } from './_shared/theme-taxonomy.mjs';

loadOptionalEnvFile();

const { Pool } = pg;
const LEGACY_THEME_KEYS = new Set(['conflict', 'tech', 'energy', 'economy', 'politics']);

function safeTrim(value) {
  return String(value ?? '').trim();
}

function parseThemeList(value) {
  return safeTrim(value)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isSupportedFollowedTheme(theme) {
  const normalized = safeTrim(theme).toLowerCase();
  const config = getThemeConfig(normalized);
  if (!normalized || !config) return false;
  if (LEGACY_THEME_KEYS.has(normalized)) return false;
  if (normalized.startsWith('dt-')) return false;
  if (!config.parentTheme) return false;
  return true;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    themes: [],
    period: 'week',
    limit: 6,
    snapshotDate: '',
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--themes' || arg === '--theme') && argv[index + 1]) {
      parsed.themes = parseThemeList(argv[++index]);
    } else if (arg === '--period' && argv[index + 1]) {
      parsed.period = safeTrim(argv[++index]).toLowerCase() || 'week';
    } else if (arg === '--limit' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.limit = Math.floor(value);
    } else if (arg === '--snapshot-date' && argv[index + 1]) {
      parsed.snapshotDate = safeTrim(argv[++index]);
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    }
  }

  return parsed;
}

function fallbackThemes(limit = 6) {
  return Object.entries(THEME_TAXONOMY)
    .filter(([theme]) => isSupportedFollowedTheme(theme))
    .map(([theme]) => theme)
    .slice(0, limit);
}

export async function selectDefaultFollowedThemes(client, periodType = 'week', limit = 6) {
  const query = await client.query(`
    SELECT theme
    FROM theme_trend_aggregates
    WHERE period_type = $1
      AND theme <> 'unknown'
      AND position('dt-' in theme) <> 1
    ORDER BY COALESCE(trend_acceleration, 0) DESC, COALESCE(article_count, 0) DESC, theme
    LIMIT $2
  `, [periodType, limit]).catch(() => ({ rows: [] }));

  const themes = Array.from(new Set(query.rows
    .map((row) => safeTrim(row.theme).toLowerCase())
    .filter((theme) => isSupportedFollowedTheme(theme))));
  if (themes.length >= limit) {
    return themes.slice(0, limit);
  }
  const fallback = fallbackThemes(limit).filter((theme) => !themes.includes(theme));
  return [...themes, ...fallback].slice(0, limit);
}

export async function runGenerateFollowedThemeBriefingsJob(options = {}, dependencies = {}) {
  const config = { ...parseArgs([]), ...options };
  const client = dependencies.client || new Pool({ ...(dependencies.pgConfig || resolveNasPgConfig()), max: 6 });
  const buildBriefingPayload = dependencies.buildBriefingPayload || buildFollowedThemeBriefingPayload;
  const ownsClient = !dependencies.client;

  try {
    const themes = config.themes.length > 0
      ? config.themes.filter((theme) => isSupportedFollowedTheme(theme)).slice(0, config.limit)
      : await selectDefaultFollowedThemes(client, config.period, config.limit);
    const snapshotDate = config.snapshotDate || buildFollowedThemeBriefingSnapshotDate(config.period);
    const params = new URLSearchParams([
      ['period', config.period],
      ['themes', themes.join(',')],
      ['limit', String(config.limit)],
      ['snapshot_date', snapshotDate],
      ['refresh', '1'],
      ['persist', config.dryRun ? '0' : '1'],
    ]);
    const payload = await buildBriefingPayload(
      (...args) => client.query(...args),
      params,
    );

    return {
      ok: true,
      dryRun: config.dryRun,
      periodType: config.period,
      snapshotDate,
      themeCount: Number(payload?.themeCount || payload?.itemCount || 0),
      themes: Array.isArray(payload?.themes) ? payload.themes : themes,
      snapshot: payload?.snapshot || null,
      headline: payload?.headline || '',
      itemCount: Array.isArray(payload?.items) ? payload.items.length : 0,
    };
  } finally {
    if (ownsClient) {
      await client.end();
    }
  }
}

const isDirectRun = (() => {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    return import.meta.url === pathToFileURL(entryArg).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runGenerateFollowedThemeBriefingsJob(parseArgs())
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    });
}
