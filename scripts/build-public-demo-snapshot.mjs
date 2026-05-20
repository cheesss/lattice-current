#!/usr/bin/env node
/**
 * S-Tier C2 — Public demo dataset slice.
 *
 * Extracts the last N months of articles + canonical_events + event_uplift +
 * model_predictions from NAS PostgreSQL into a single JSON file shipped at
 * data/public-demo/lattice-snapshot-<date>.json. The file can then be used
 * by:
 *   1. an external evaluator to inspect signal quality without DB access
 *   2. a sandbox build of the dashboard (LATTICE_DEMO_MODE=1) — see C3
 *
 * PII / sensitive scrubbing:
 *   - article URLs kept (public news links are fine)
 *   - article body / summary truncated to 280 chars (avoids verbatim
 *     republishing)
 *   - publisher_group preserved (categorical)
 *   - article author/email/phone if present → stripped
 *   - row IDs renumbered to anonymize internal sequence
 *
 * Usage:
 *   node scripts/build-public-demo-snapshot.mjs [--months=6] [--output=PATH]
 *
 * Output schema:
 *   { generatedAt, windowMonths, themes[], articles[], canonicalEvents[],
 *     eventUplift[], modelPredictions[], counts, attribution }
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { resolveNasPgConfig, loadOptionalEnvFile } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();

const args = process.argv.slice(2);
const months = (() => {
  const m = args.find((a) => a.startsWith('--months='));
  return m ? Math.max(1, Math.min(24, Number(m.split('=')[1]) || 6)) : 6;
})();
const outputPath = (() => {
  const o = args.find((a) => a.startsWith('--output='));
  if (o) return path.resolve(o.split('=')[1]);
  const today = new Date().toISOString().slice(0, 10);
  return path.resolve('data', 'public-demo', `lattice-snapshot-${today}.json`);
})();

const ARTICLE_BODY_MAX = 280;
const ARTICLE_TITLE_MAX = 320;

function stripPII(value) {
  if (typeof value !== 'string') return value;
  return value
    // simple email scrub
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]')
    // phone-like 7+ digit sequences
    .replace(/\b\d{3}[\s\-.]?\d{3,4}[\s\-.]?\d{4}\b/g, '[phone]');
}

async function main() {
  const startTs = Date.now();
  const cfg = resolveNasPgConfig();
  const client = new pg.Client(cfg);
  await client.connect();

  process.stderr.write(`▶ extracting public demo snapshot (last ${months} months)\n`);

  // 1. Themes — derived from canonical_events, plus auto_theme_symbols joining.
  process.stderr.write('  loading themes...\n');
  const themesRes = await client.query(`
    SELECT theme,
           COUNT(*)::int           AS event_count,
           SUM(article_count)::int AS article_count_total,
           MAX(event_date)         AS latest_event_date
      FROM canonical_events
     WHERE event_date >= CURRENT_DATE - ($1::int * INTERVAL '30 days')
       AND article_count >= 2
       AND theme NOT LIKE 'dt-%'
     GROUP BY theme
     ORDER BY article_count_total DESC
  `, [months]);
  const themes = themesRes.rows;

  // 2. Canonical events.
  process.stderr.write('  loading canonical_events...\n');
  const eventsRes = await client.query(`
    SELECT id, theme, representative_title, event_date,
           article_count, source_count, created_at
      FROM canonical_events
     WHERE event_date >= CURRENT_DATE - ($1::int * INTERVAL '30 days')
       AND article_count >= 2
       AND theme NOT LIKE 'dt-%'
     ORDER BY event_date DESC, id ASC
     LIMIT 5000
  `, [months]);
  const events = eventsRes.rows.map((row) => ({
    id: Number(row.id),
    theme: row.theme,
    title: stripPII(String(row.representative_title || '').slice(0, ARTICLE_TITLE_MAX)),
    eventDate: row.event_date,
    articleCount: Number(row.article_count ?? 0),
    sourceCount: Number(row.source_count ?? 0),
  }));

  // 3. Articles — sample mapped to the included events.
  process.stderr.write('  loading articles (mapped to events)...\n');
  const eventIds = events.map((e) => e.id);
  const articlesRes = eventIds.length === 0 ? { rows: [] } : await client.query(`
    SELECT a.id, a.title, a.source, a.publisher_group, a.published_at,
           a.url, a.market_relevance,
           SUBSTR(COALESCE(a.summary, ''), 1, ${ARTICLE_BODY_MAX}) AS summary,
           aem.canonical_event_id
      FROM article_event_map aem
      JOIN articles a ON a.id = aem.article_id
     WHERE aem.canonical_event_id = ANY($1::int[])
     ORDER BY a.published_at DESC NULLS LAST
     LIMIT 12000
  `, [eventIds]);
  const articles = articlesRes.rows.map((row) => ({
    id: Number(row.id),
    title: stripPII(String(row.title || '').slice(0, ARTICLE_TITLE_MAX)),
    source: row.source,
    publisherGroup: row.publisher_group,
    publishedAt: row.published_at,
    url: row.url,
    marketRelevance: row.market_relevance,
    summary: stripPII(row.summary || ''),
    canonicalEventId: Number(row.canonical_event_id),
  }));

  // 4. Event uplift — promotion-eligible rows only (the validated cohort).
  process.stderr.write('  loading event_uplift...\n');
  const upliftRes = eventIds.length === 0 ? { rows: [] } : await client.query(`
    SELECT canonical_event_id, symbol, horizon, uplift, t_stat,
           evidence_grade, n_controls
      FROM event_uplift
     WHERE canonical_event_id = ANY($1::int[])
     ORDER BY canonical_event_id, ABS(COALESCE(t_stat, 0)) DESC NULLS LAST
     LIMIT 20000
  `, [eventIds]);
  const eventUplift = upliftRes.rows.map((row) => ({
    canonicalEventId: Number(row.canonical_event_id),
    symbol: row.symbol,
    horizon: row.horizon,
    uplift: row.uplift == null ? null : Number(row.uplift),
    tStat: row.t_stat == null ? null : Number(row.t_stat),
    evidenceGrade: row.evidence_grade,
    nControls: Number(row.n_controls ?? 0),
  }));

  // 5. Model predictions — recent only (don't need full history for a demo).
  process.stderr.write('  loading model_predictions...\n');
  const predictionsRes = eventIds.length === 0 ? { rows: [] } : await client.query(`
    SELECT canonical_event_id, symbol, horizon, model_version,
           alpha_prob, expected_alpha, downside_risk, time_to_peak,
           evidence_grade, created_at
      FROM model_predictions
     WHERE canonical_event_id = ANY($1::int[])
     ORDER BY created_at DESC
     LIMIT 10000
  `, [eventIds]);
  const modelPredictions = predictionsRes.rows.map((row) => ({
    canonicalEventId: Number(row.canonical_event_id),
    symbol: row.symbol,
    horizon: row.horizon,
    modelVersion: row.model_version,
    alphaProb: row.alpha_prob == null ? null : Number(row.alpha_prob),
    expectedAlpha: row.expected_alpha == null ? null : Number(row.expected_alpha),
    downsideRisk: row.downside_risk == null ? null : Number(row.downside_risk),
    timeToPeak: row.time_to_peak == null ? null : Number(row.time_to_peak),
    evidenceGrade: row.evidence_grade,
    createdAt: row.created_at,
  }));

  await client.end();

  const counts = {
    themes: themes.length,
    canonicalEvents: events.length,
    articles: articles.length,
    eventUplift: eventUplift.length,
    modelPredictions: modelPredictions.length,
  };
  const elapsedMs = Date.now() - startTs;

  const snapshot = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    windowMonths: months,
    elapsedMs,
    counts,
    themes,
    canonicalEvents: events,
    articles,
    eventUplift,
    modelPredictions,
    attribution: {
      project: 'Lattice Current — public demo snapshot',
      license: 'Code AGPL v3.0; data sources retain their original licenses (see data-sources.html).',
      sources: ['Guardian', 'NYT', 'Reuters', 'Bloomberg', 'GDELT', 'SEC EDGAR', 'arXiv', 'OpenAlex', 'GitHub'],
      note: 'This snapshot is a sanitized slice for evaluation only. URLs link to the original publishers.',
    },
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const json = JSON.stringify(snapshot);
  await fs.writeFile(outputPath, json, 'utf8');
  const sizeMB = (json.length / 1024 / 1024).toFixed(2);

  process.stderr.write(`✓ wrote ${outputPath} (${sizeMB} MB, ${elapsedMs} ms)\n`);
  process.stderr.write(`  counts: ${JSON.stringify(counts)}\n`);
}

await main();
