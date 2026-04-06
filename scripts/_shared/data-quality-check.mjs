#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './nas-runtime.mjs';

loadOptionalEnvFile();

const { Client } = pg;

function clamp(value, minimum, maximum) {
  if (!Number.isFinite(Number(value))) return minimum;
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

function freshnessScore(ageMs, strongMs, weakMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  if (ageMs <= strongMs) return 1;
  if (ageMs <= weakMs) return 0.5;
  return 0;
}

function completenessScore(pct) {
  if (pct >= 0.9) return 1;
  if (pct >= 0.7) return 0.5;
  return 0;
}

function percent(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

function buildWindowMetric(name, total, matched) {
  const pct = percent(matched, total);
  return {
    name,
    total,
    labeled: matched,
    pct,
    score: completenessScore(pct),
  };
}

export function summarizeDataQualityRows(input) {
  const articleAgeMs = Number(input.articleAgeMs);
  const signalAgeMs = Number(input.signalAgeMs);
  const maturedArticles = Number(input.maturedArticles || 0);
  const labeledArticles = Number(input.labeledArticles || 0);
  const nullCount = Number(input.nullCount || 0);
  const labeledRows = Number(input.labeledRows || 0);
  const outlierCount = Number(input.outlierCount || 0);

  const articleFreshness = {
    lastAt: input.articleLastAt || null,
    ageHours: Number.isFinite(articleAgeMs) ? Number((articleAgeMs / 3_600_000).toFixed(2)) : null,
    score: freshnessScore(articleAgeMs, 6 * 3_600_000, 24 * 3_600_000),
  };
  const signalFreshness = {
    lastAt: input.signalLastAt || null,
    ageMinutes: Number.isFinite(signalAgeMs) ? Number((signalAgeMs / 60_000).toFixed(2)) : null,
    score: freshnessScore(signalAgeMs, 30 * 60_000, 2 * 3_600_000),
  };
  const outcomeCompleteness = buildWindowMetric('matured-articles', maturedArticles, labeledArticles);
  const nullRate = {
    count: nullCount,
    total: labeledRows,
    pct: percent(nullCount, labeledRows),
  };
  const outlierRate = {
    count: outlierCount,
    total: labeledRows,
    pct: percent(outlierCount, labeledRows),
  };
  const integrityPenalty = clamp(1 - nullRate.pct * 3 - outlierRate.pct * 2, 0, 1);
  const overall = Number(clamp(
    articleFreshness.score * 0.3
    + signalFreshness.score * 0.25
    + outcomeCompleteness.score * 0.3
    + integrityPenalty * 0.15,
    0,
    1,
  ).toFixed(4));

  return {
    articleFreshness,
    outcomeCompleteness,
    signalFreshness,
    nullRate,
    outlierRate,
    integrityPenalty: Number(integrityPenalty.toFixed(4)),
    overall,
  };
}

export async function computeDataQualityMetrics(queryable) {
  const [articleFreshness, signalFreshness, outcomeCompleteness, integrity] = await Promise.all([
    queryable.query(`
      SELECT MAX(published_at) AS last_at,
             EXTRACT(EPOCH FROM (NOW() - MAX(published_at))) * 1000 AS age_ms
      FROM articles
    `),
    queryable.query(`
      SELECT MAX(ts) AS last_at,
             EXTRACT(EPOCH FROM (NOW() - MAX(ts))) * 1000 AS age_ms
      FROM signal_history
    `),
    queryable.query(`
      WITH matured AS (
        SELECT id
        FROM articles
        WHERE published_at >= NOW() - INTERVAL '45 days'
          AND published_at <= NOW() - INTERVAL '14 days'
      ),
      labeled AS (
        SELECT DISTINCT article_id
        FROM labeled_outcomes
        WHERE published_at >= NOW() - INTERVAL '45 days'
          AND published_at <= NOW() - INTERVAL '14 days'
      )
      SELECT
        (SELECT COUNT(*) FROM matured)::int AS matured_articles,
        (SELECT COUNT(*) FROM labeled)::int AS labeled_articles
    `),
    queryable.query(`
      SELECT
        COUNT(*)::int AS labeled_rows,
        COUNT(*) FILTER (
          WHERE entry_price IS NULL OR exit_price IS NULL OR entry_price <= 0 OR exit_price <= 0
        )::int AS null_count,
        COUNT(*) FILTER (
          WHERE ABS(COALESCE(forward_return_pct, 0)) > 50
        )::int AS outlier_count
      FROM labeled_outcomes
    `),
  ]);

  return summarizeDataQualityRows({
    articleLastAt: articleFreshness.rows[0]?.last_at || null,
    articleAgeMs: Number(articleFreshness.rows[0]?.age_ms),
    signalLastAt: signalFreshness.rows[0]?.last_at || null,
    signalAgeMs: Number(signalFreshness.rows[0]?.age_ms),
    maturedArticles: Number(outcomeCompleteness.rows[0]?.matured_articles || 0),
    labeledArticles: Number(outcomeCompleteness.rows[0]?.labeled_articles || 0),
    labeledRows: Number(integrity.rows[0]?.labeled_rows || 0),
    nullCount: Number(integrity.rows[0]?.null_count || 0),
    outlierCount: Number(integrity.rows[0]?.outlier_count || 0),
  });
}

export async function runDataQualityCheck(config = resolveNasPgConfig()) {
  const client = new Client(config);
  await client.connect();
  try {
    return await computeDataQualityMetrics(client);
  } finally {
    await client.end();
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
  runDataQualityCheck()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    });
}
