#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { runSecCompanyFacts } from './fetch-sec-company-facts.mjs';
import { THEME_ENTITY_SEEDS } from './_shared/theme-entity-seeds.mjs';

function safeTrim(value) {
  return String(value ?? '').trim();
}

function parseList(value) {
  return safeTrim(value)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    themes: [],
    symbols: [],
    limit: 0,
    delayMs: 250,
    dryRun: false,
    maxFacts: 100,
    maxFilings: 25,
    forms: ['10-K', '10-Q', '8-K'],
    userAgent: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--themes' || arg === '--theme') && argv[index + 1]) {
      parsed.themes = parseList(argv[++index]);
    } else if ((arg === '--symbols' || arg === '--symbol') && argv[index + 1]) {
      parsed.symbols = safeTrim(argv[++index]).split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
    } else if (arg === '--limit' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value >= 0) parsed.limit = Math.floor(value);
    } else if (arg === '--delay-ms' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value >= 0) parsed.delayMs = Math.floor(value);
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--max-facts' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value >= 0) parsed.maxFacts = Math.floor(value);
    } else if (arg === '--max-filings' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value >= 0) parsed.maxFilings = Math.floor(value);
    } else if (arg === '--forms' && argv[index + 1]) {
      parsed.forms = safeTrim(argv[++index]).split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
    } else if (arg === '--user-agent' && argv[index + 1]) {
      parsed.userAgent = argv[++index];
    }
  }

  return parsed;
}

export function buildSeedUniverse({ themes = [], symbols = [], limit = 0 } = {}) {
  const themeFilter = new Set(parseList(themes.join(',')));
  const symbolFilter = new Set(symbols.map((item) => safeTrim(item).toUpperCase()).filter(Boolean));
  const universe = [];
  const seen = new Set();

  for (const [theme, seeds] of Object.entries(THEME_ENTITY_SEEDS)) {
    if (themeFilter.size > 0 && !themeFilter.has(theme)) continue;
    for (const seed of seeds) {
      const symbol = safeTrim(seed?.symbol || seed?.ticker || '').toUpperCase();
      if (!symbol) continue;
      if (symbolFilter.size > 0 && !symbolFilter.has(symbol)) continue;
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      universe.push({
        symbol,
        themeHints: Object.entries(THEME_ENTITY_SEEDS)
          .filter(([, entries]) => entries.some((entry) => safeTrim(entry?.symbol || entry?.ticker).toUpperCase() === symbol))
          .map(([themeKey]) => themeKey),
      });
      if (limit > 0 && universe.length >= limit) {
        return universe;
      }
    }
  }

  return universe;
}

export async function runSecSeedUniverse(options = {}, dependencies = {}) {
  const config = { ...parseArgs([]), ...options };
  const universe = buildSeedUniverse(config);
  const results = [];
  const ingest = dependencies.runSecCompanyFacts || runSecCompanyFacts;

  for (let index = 0; index < universe.length; index += 1) {
    const item = universe[index];
    try {
      const summary = await ingest(
        {
          ticker: item.symbol,
          dryRun: config.dryRun,
          maxFacts: config.maxFacts,
          maxFilings: config.maxFilings,
          forms: config.forms,
          userAgent: config.userAgent,
        },
        dependencies,
      );
      results.push({
        symbol: item.symbol,
        ok: true,
        factCount: Number(summary.factCount || 0),
        filingCount: Number(summary.filingCount || 0),
        exposureCount: Number(summary.exposureCount || 0),
        upsertedExposures: Number(summary.upsertedExposures || 0),
        themeHints: item.themeHints,
      });
    } catch (error) {
      results.push({
        symbol: item.symbol,
        ok: false,
        error: String(error?.message || error || 'unknown error'),
        themeHints: item.themeHints,
      });
    }
    if (config.delayMs > 0 && index < universe.length - 1) {
      await sleep(config.delayMs);
    }
  }

  const okCount = results.filter((item) => item.ok).length;
  const failCount = results.length - okCount;
  return {
    ok: failCount === 0,
    dryRun: Boolean(config.dryRun),
    universeSize: universe.length,
    okCount,
    failCount,
    totalExposureCount: results.reduce((sum, item) => sum + Number(item.exposureCount || 0), 0),
    totalUpsertedExposures: results.reduce((sum, item) => sum + Number(item.upsertedExposures || 0), 0),
    results,
  };
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
  runSecSeedUniverse(parseArgs())
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      if (!summary.ok) process.exitCode = 1;
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    });
}
