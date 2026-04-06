#!/usr/bin/env node

import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();

const { Client } = pg;
const OUTPUT_PATH = path.resolve('data', 'verify-e2e-result.json');

function nowIso() {
  return new Date().toISOString();
}

async function ensureDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
  const db = new Client(resolveNasPgConfig());
  await db.connect();

  const { ingestArticle, checkPendingOutcomes, closeIngestorPool } = await import('../src/services/article-ingestor.ts');
  const { pushSignal, getLatestSignals, closeSignalHistoryUpdaterPool } = await import('../src/services/signal-history-updater.ts');

  const report = {
    startedAt: nowIso(),
    ok: false,
    steps: {},
    cleanup: {},
  };

  let syntheticArticleId = null;
  let syntheticTheme = null;
  let syntheticSeedSymbol = null;

  try {
    const seed = await db.query(`
      SELECT ats.theme, ats.symbol, MIN(h.valid_time_start) AS published_at
      FROM auto_theme_symbols ats
      JOIN worldmonitor_intel.historical_raw_items h
        ON h.provider = 'yahoo-chart'
       AND h.symbol = ats.symbol
      JOIN worldmonitor_intel.historical_raw_items h2
        ON h2.provider = 'yahoo-chart'
       AND h2.symbol = ats.symbol
       AND h2.valid_time_start >= h.valid_time_start + INTERVAL '16 days'
      GROUP BY ats.theme, ats.symbol
      ORDER BY MAX(ats.correlation) DESC NULLS LAST
      LIMIT 1
    `);

    if (!seed.rows[0]) {
      throw new Error('No theme/symbol pair with historical price coverage was found.');
    }

    const chosen = seed.rows[0];
    syntheticTheme = String(chosen.theme);
    syntheticSeedSymbol = String(chosen.symbol);
    const publishedAt = new Date(chosen.published_at).toISOString();
    const syntheticTitle = `[e2e-smoke] ${syntheticTheme} ${syntheticSeedSymbol} ${Date.now()}`;
    const syntheticUrl = `https://local.lattice/e2e/${Date.now()}`;

    const ingest = await ingestArticle({
      title: syntheticTitle,
      source: 'e2e-smoke',
      url: syntheticUrl,
      publishedAt,
      theme: syntheticTheme,
    });
    syntheticArticleId = ingest.articleId;

    report.steps.ingestArticle = {
      ok: syntheticArticleId > 0,
      articleId: syntheticArticleId,
      theme: ingest.theme,
      pendingCount: ingest.pendingCount,
    };

    const articleRows = await db.query(`
      SELECT a.id, a.source, a.title, t.auto_theme
      FROM articles a
      LEFT JOIN auto_article_themes t ON t.article_id = a.id
      WHERE a.id = $1
    `, [syntheticArticleId]);

    report.steps.articleStored = {
      ok: articleRows.rows.length === 1,
      row: articleRows.rows[0] || null,
    };

    const pendingBefore = await db.query(`
      SELECT id, status, symbol, target_date
      FROM pending_outcomes
      WHERE article_id = $1
      ORDER BY target_date
    `, [syntheticArticleId]);

    report.steps.pendingCreated = {
      ok: pendingBefore.rows.length > 0,
      count: pendingBefore.rows.length,
      rows: pendingBefore.rows,
    };

    await pushSignal('e2e_probe', 1.2345, publishedAt);
    const latestSignals = await getLatestSignals();
    report.steps.signalHistory = {
      ok: Boolean(latestSignals.e2e_probe),
      latest: latestSignals.e2e_probe || null,
    };

    const resolution = await checkPendingOutcomes();
    const pendingAfter = await db.query(`
      SELECT status, COUNT(*)::int AS count
      FROM pending_outcomes
      WHERE article_id = $1
      GROUP BY status
      ORDER BY status
    `, [syntheticArticleId]);
    const outcomes = await db.query(`
      SELECT symbol, horizon, forward_return_pct, hit
      FROM labeled_outcomes
      WHERE article_id = $1
      ORDER BY symbol, horizon
    `, [syntheticArticleId]);

    report.steps.pendingResolution = {
      ok: outcomes.rows.length > 0,
      checkPendingSummary: resolution,
      pendingStatuses: pendingAfter.rows,
      labeledOutcomes: outcomes.rows,
    };

    const outcomeSymbols = Array.from(new Set(outcomes.rows.map((row) => String(row.symbol || '').trim()).filter(Boolean)));
    const sensitivity = outcomeSymbols.length > 0
      ? await db.query(`
          SELECT theme, symbol, horizon, sample_size, hit_rate
          FROM stock_sensitivity_matrix
          WHERE theme = $1
            AND symbol = ANY($2::text[])
          ORDER BY symbol, horizon
          LIMIT 20
        `, [syntheticTheme, outcomeSymbols])
      : { rows: [] };

    report.steps.sensitivity = {
      ok: sensitivity.rows.length > 0,
      rows: sensitivity.rows,
    };

    report.ok = Object.values(report.steps).every((step) => step && step.ok === true);
    report.completedAt = nowIso();
  } finally {
    if (syntheticArticleId) {
      try {
        await db.query('DELETE FROM labeled_outcomes WHERE article_id = $1', [syntheticArticleId]);
        await db.query('DELETE FROM pending_outcomes WHERE article_id = $1', [syntheticArticleId]);
        await db.query('DELETE FROM auto_article_themes WHERE article_id = $1', [syntheticArticleId]);
        await db.query('DELETE FROM articles WHERE id = $1', [syntheticArticleId]);
        report.cleanup.syntheticArticleDeleted = true;
      } catch (error) {
        report.cleanup.syntheticArticleDeleted = false;
        report.cleanup.error = String(error?.message || error);
      }
    }

    await ensureDir(OUTPUT_PATH);
    await writeFile(OUTPUT_PATH, JSON.stringify(report, null, 2));
    await closeIngestorPool().catch(() => {});
    await closeSignalHistoryUpdaterPool().catch(() => {});
    await db.end().catch(() => {});
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.ok ? 0 : 1);
}

main().catch(async (error) => {
  const payload = {
    startedAt: nowIso(),
    ok: false,
    fatal: String(error?.message || error),
  };
  await ensureDir(OUTPUT_PATH);
  await writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  process.stderr.write(`${payload.fatal}\n`);
  process.exit(1);
});
