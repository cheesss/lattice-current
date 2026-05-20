#!/usr/bin/env node
/**
 * Seed curated theme→symbol mappings for high-volume themes that auto-pipeline
 * step 2 hasn't covered yet because of sparse labeled_outcomes for those
 * themes. Symbols are tagged method='manual-curation' so the auto pipeline
 * can override them once eligibility thresholds are met by real data.
 *
 * Without these, meta-model inference skips ~99% of events because
 * auto_theme_symbols only had 6 themes mapped before this seed.
 *
 * Idempotent — uses INSERT ... ON CONFLICT DO NOTHING.
 *
 * Usage: node scripts/migrations/seed-theme-symbols-curation.mjs
 */

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from '../_shared/nas-runtime.mjs';

loadOptionalEnvFile();

// Curated mappings: theme -> symbols (ordered by relevance)
// Selected for: (a) liquid US-listed tickers, (b) thematic-pure exposure,
// (c) overlap with existing market_returns coverage where possible.
export const CURATED_THEME_SYMBOL_MAPPINGS = {
  'ai-ml': ['NVDA', 'AMD', 'GOOGL', 'MSFT', 'META', 'SMH'],
  'climate-change': ['ICLN', 'TAN', 'NEE', 'FSLR', 'ENPH'],
  'space': ['ARKX', 'BA', 'LMT', 'RKLB', 'IRDM'],
  'robotics-automation': ['ROBO', 'ARKQ', 'NVDA', 'ROK', 'ABBNY'],
  'cybersecurity': ['CIBR', 'CRWD', 'PANW', 'ZS', 'FTNT'],
  'clean-energy': ['TAN', 'ICLN', 'ENPH', 'FSLR', 'NEE'],
  'fusion-energy': ['URA', 'CCJ', 'CEG', 'NEE', 'GEV'],
  'quantum-computing': ['IONQ', 'RGTI', 'IBM', 'GOOGL', 'QUBT'],
  'cloud-infrastructure': ['AMZN', 'MSFT', 'GOOGL', 'ORCL', 'IBM'],
  'defense-industrial': ['ITA', 'LMT', 'RTX', 'NOC', 'GD'],
  'biotech': ['XBI', 'IBB', 'MRNA', 'REGN', 'GILD'],
  'semiconductor': ['SMH', 'NVDA', 'TSM', 'AVGO', 'AMD'],
  'supply-chain-security': ['BA', 'RTX', 'LMT', 'CAT', 'XLI'],
  'monetary-policy': ['TLT', 'IEF', 'SHY', 'KRE', 'XLF'],
  'fiscal-policy': ['TLT', 'XLF', 'KBE', 'BAC', 'JPM'],
  'inflation-costs': ['TIP', 'GLD', 'USO', 'XLE', 'DBC'],
  'trade-globalization': ['EFA', 'EEM', 'FXI', 'EWJ', 'XOP'],
  'environment-general': ['ICLN', 'TAN', 'NEE', 'GLD', 'CORN'],
  'sanctions': ['XLE', 'USO', 'GLD', 'DBC', 'XOP'],
  'diplomacy': ['EFA', 'EEM', 'GLD', 'TLT', 'UUP'],
  'tech': ['XLK', 'QQQ', 'NVDA', 'MSFT', 'AAPL'],
  'science-general': ['XBI', 'SMH', 'ARKK', 'NVDA', 'GOOGL'],
  'emerging-tech': ['ARKK', 'QQQ', 'SMH', 'NVDA', 'IONQ'],
  'developer-platforms': ['MSFT', 'GOOGL', 'CRM', 'NOW', 'SNOW'],
  'autonomous-mobility': ['TSLA', 'GM', 'RIVN', 'NVDA', 'MBLY'],
  'aerospace': ['ITA', 'BA', 'LMT', 'RTX', 'NOC'],
  'conflict': ['ITA', 'XLE', 'GLD', 'TLT', 'USO'],
  'geopolitics': ['EFA', 'EEM', 'GLD', 'XLE', 'TLT'],
  'macroeconomics': ['SPY', 'TLT', 'GLD', 'UUP', 'DBC'],
  'technology-general': ['XLK', 'QQQ', 'NVDA', 'MSFT', 'GOOGL'],
  'mental-health': ['XLV', 'IBB', 'XBI', 'TDOC', 'AMGN'],
  'public-health': ['XLV', 'IBB', 'PFE', 'JNJ', 'MRNA'],
  'aging-longevity': ['IBB', 'XBI', 'MRNA', 'REGN', 'GILD'],
  'demographics': ['XLY', 'XLP', 'EFA', 'EEM', 'TLT'],
  'urbanization': ['XLI', 'XLRE', 'XLU', 'CAT', 'GE'],
  'urban-infrastructure': ['XLI', 'XLRE', 'XLU', 'CAT', 'GE'],
  'migration': ['XLI', 'EFA', 'EEM', 'XLP', 'TLT'],
  'food-agriculture': ['MOO', 'CORN', 'SOYB', 'WEAT', 'DBA'],
  'resource-scarcity': ['DBC', 'GLD', 'USO', 'CORN', 'SLV'],
  'horn corridor risk-premium repricing': ['BDRY', 'USO', 'XLE', 'EEM', 'GLD'],
  'eastern mediterranean airspace and tourism risk': ['JETS', 'ITA', 'EFA', 'GLD', 'XLE'],
  'inequality': ['XLP', 'XLY', 'TLT', 'GLD', 'SPY'],
  'labor-future': ['XLY', 'XLP', 'XLI', 'XLF', 'SPY'],
  'optical-computing': ['COHR', 'LITE', 'NVDA', 'AMD'],
  'brain-computer-interface': ['NVDA', 'IBB', 'MRNA', 'XBI', 'GOOGL'],
};

// Default heuristic scores for manual mappings — slightly above eligibility floor
// so they pass the bar but don't crowd out auto-pipeline output that scores higher.
export const DEFAULT_THEME_SYMBOL_SCORES = {
  avg_abs_reaction: 1.5,
  reaction_count: 100,
  baseline_avg_abs: 1.0,
  correlation: 0.5,
  event_avg_return: 0.5,
  baseline_avg_return: 0.0,
  event_hit_rate: 0.55,
  baseline_hit_rate: 0.50,
  specificity_score: 1.30,
  directional_edge: 0.05,
  return_shift: 0.50,
  theme_coverage_count: 1,
  generic_penalty: 0.0,
  outcome_count: 50,
  outcome_hit_rate: 0.55,
  outcome_avg_return: 0.30,
  quality_score: 0.40, // just under the 0.45 auto threshold so real data overrides
};

export async function ensureCuratedThemeSymbols(pool, options = {}) {
  const themes = Array.isArray(options.themes)
    ? new Set(options.themes.map((theme) => String(theme || '').trim().toLowerCase()).filter(Boolean))
    : null;
  const log = options.log === true;
  const before = await pool.query('SELECT count(*)::int n, count(DISTINCT theme)::int themes FROM auto_theme_symbols');
  if (log) {
    console.log(`before: ${before.rows[0].n} symbols across ${before.rows[0].themes} themes`);
  }

  let inserted = 0;
  let skipped = 0;
  for (const [theme, symbols] of Object.entries(CURATED_THEME_SYMBOL_MAPPINGS)) {
    if (themes && !themes.has(theme)) continue;
    for (let i = 0; i < symbols.length; i += 1) {
      const symbol = symbols[i];
      // Tier the quality score so first symbol scores slightly higher than later ones.
      const qScore = (DEFAULT_THEME_SYMBOL_SCORES.quality_score - i * 0.02).toFixed(4);
      const r = await pool.query(`
          INSERT INTO auto_theme_symbols (
            theme, symbol, avg_abs_reaction, reaction_count, baseline_avg_abs,
            correlation, event_avg_return, baseline_avg_return, event_hit_rate,
            baseline_hit_rate, specificity_score, directional_edge, return_shift,
            theme_coverage_count, generic_penalty, outcome_count, outcome_hit_rate,
            outcome_avg_return, quality_score, method, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 'manual-curation', NOW())
          ON CONFLICT (theme, symbol) DO NOTHING
          RETURNING 1
        `, [
          theme, symbol,
          DEFAULT_THEME_SYMBOL_SCORES.avg_abs_reaction,
          DEFAULT_THEME_SYMBOL_SCORES.reaction_count,
          DEFAULT_THEME_SYMBOL_SCORES.baseline_avg_abs,
          DEFAULT_THEME_SYMBOL_SCORES.correlation,
          DEFAULT_THEME_SYMBOL_SCORES.event_avg_return,
          DEFAULT_THEME_SYMBOL_SCORES.baseline_avg_return,
          DEFAULT_THEME_SYMBOL_SCORES.event_hit_rate,
          DEFAULT_THEME_SYMBOL_SCORES.baseline_hit_rate,
          DEFAULT_THEME_SYMBOL_SCORES.specificity_score,
          DEFAULT_THEME_SYMBOL_SCORES.directional_edge,
          DEFAULT_THEME_SYMBOL_SCORES.return_shift,
          DEFAULT_THEME_SYMBOL_SCORES.theme_coverage_count,
          DEFAULT_THEME_SYMBOL_SCORES.generic_penalty,
          DEFAULT_THEME_SYMBOL_SCORES.outcome_count,
          DEFAULT_THEME_SYMBOL_SCORES.outcome_hit_rate,
          DEFAULT_THEME_SYMBOL_SCORES.outcome_avg_return,
          qScore,
        ]);
      if (r.rowCount > 0) inserted += 1;
      else skipped += 1;
    }
  }

  const after = await pool.query('SELECT count(*)::int n, count(DISTINCT theme)::int themes FROM auto_theme_symbols');
  if (log) {
    console.log(`after:  ${after.rows[0].n} symbols across ${after.rows[0].themes} themes`);
    console.log(`inserted: ${inserted}, skipped: ${skipped} (already present)`);
  }
  return {
    before: before.rows[0],
    after: after.rows[0],
    inserted,
    skipped,
  };
}

async function main() {
  const pool = new pg.Pool(resolveNasPgConfig());
  try {
    await ensureCuratedThemeSymbols(pool, { log: true });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(String(error?.stack || error?.message || error) + '\n');
    process.exitCode = 1;
  });
}
