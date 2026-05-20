#!/usr/bin/env node
/**
 * Repair recent matched_controls + event_uplift gaps.
 *
 * The hourly fast event engine intentionally prioritizes clustering/features
 * and may skip control/uplift work under backlog. This script is the bounded,
 * idempotent repair pass used by the daemon's daily full-controls task.
 *
 * It only inserts missing rows:
 *   - matched_controls for recent canonical events that have matured outcomes
 *   - event_uplift rows for event/symbol/horizon combinations not yet graded
 *
 * No DELETE/UPDATE is used here.
 */

import process from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

const { Pool } = pg;

function parseArgs(argv) {
  const args = { days: 75, limit: 1000, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--dry-run') args.dryRun = true;
    else if (token === '--days') args.days = Number(argv[++i]);
    else if (token === '--limit') args.limit = Number(argv[++i]);
  }
  args.days = Math.max(7, Math.min(365, Number.isFinite(args.days) ? args.days : 75));
  args.limit = Math.max(1, Math.min(10000, Number.isFinite(args.limit) ? args.limit : 1000));
  return args;
}

async function countRepairTargets(pool, { days, limit }) {
  const { rows } = await pool.query(`
    WITH target_events AS (
      SELECT ce.id
        FROM canonical_events ce
       WHERE ce.event_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
         AND COALESCE(ce.article_count, 0) >= 2
         AND EXISTS (
           SELECT 1
             FROM article_event_map aem
             JOIN labeled_outcomes lo ON lo.article_id = aem.article_id
            WHERE aem.canonical_event_id = ce.id
              AND lo.abnormal_return IS NOT NULL
         )
       ORDER BY ce.event_date DESC, ce.id DESC
       LIMIT $2
    )
    SELECT
      COUNT(*)::int AS target_events,
      COUNT(*) FILTER (
        WHERE NOT EXISTS (
          SELECT 1 FROM matched_controls mc WHERE mc.canonical_event_id = target_events.id
        )
      )::int AS missing_controls,
      COUNT(*) FILTER (
        WHERE NOT EXISTS (
          SELECT 1 FROM event_uplift eu WHERE eu.canonical_event_id = target_events.id
        )
      )::int AS missing_uplift
      FROM target_events
  `, [days, limit]);
  return rows[0] || { target_events: 0, missing_controls: 0, missing_uplift: 0 };
}

async function insertMissingControls(pool, { days, limit }) {
  const result = await pool.query(`
    WITH target_events AS MATERIALIZED (
      SELECT ce.id, ce.event_date::date AS event_date, ce.theme
        FROM canonical_events ce
       WHERE ce.event_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
         AND COALESCE(ce.article_count, 0) >= 2
         AND EXISTS (
           SELECT 1
             FROM article_event_map aem
             JOIN labeled_outcomes lo ON lo.article_id = aem.article_id
            WHERE aem.canonical_event_id = ce.id
              AND lo.abnormal_return IS NOT NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM matched_controls mc WHERE mc.canonical_event_id = ce.id
         )
       ORDER BY ce.event_date DESC, ce.id DESC
       LIMIT $2
    ),
    daily_signals AS MATERIALIZED (
      SELECT DATE(ts) AS d,
             MAX(CASE WHEN signal_name = 'vix' THEN value END)::double precision AS vix,
             MAX(CASE WHEN signal_name = 'yieldSpread' THEN value END)::double precision AS ys
        FROM signal_history
       WHERE signal_name IN ('vix', 'yieldSpread')
       GROUP BY DATE(ts)
    ),
    candidate_controls AS (
      SELECT
        te.id AS canonical_event_id,
        ds.d AS control_date,
        SQRT(
          POWER(COALESCE(es.vix, 0) - COALESCE(ds.vix, 0), 2)
          + POWER(COALESCE(es.ys, 0) - COALESCE(ds.ys, 0), 2)
        ) AS match_distance,
        es.vix AS vix_event,
        ds.vix AS vix_control,
        es.ys AS yield_spread_event,
        ds.ys AS yield_spread_control
      FROM target_events te
      JOIN daily_signals es ON es.d = te.event_date
      JOIN daily_signals ds
        ON ds.d < te.event_date - INTERVAL '14 days'
       AND ds.d >= te.event_date - INTERVAL '730 days'
      WHERE ds.vix IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
            FROM canonical_events near_event
           WHERE near_event.theme = te.theme
             AND ABS(near_event.event_date::date - ds.d) <= 7
        )
    ),
    ranked AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY canonical_event_id
               ORDER BY match_distance ASC, control_date DESC
             ) AS rn
        FROM candidate_controls
    )
    INSERT INTO matched_controls (
      canonical_event_id, control_date, match_distance,
      vix_event, vix_control, yield_spread_event, yield_spread_control,
      regime_event, regime_control
    )
    SELECT
      canonical_event_id, control_date, match_distance,
      vix_event, vix_control, yield_spread_event, yield_spread_control,
      'balanced', 'balanced'
      FROM ranked
     WHERE rn <= 5
    ON CONFLICT DO NOTHING
  `, [days, limit]);
  return result.rowCount || 0;
}

async function insertMissingUplift(pool, { days, limit }) {
  const result = await pool.query(`
    WITH target_events AS MATERIALIZED (
      SELECT ce.id
        FROM canonical_events ce
       WHERE ce.event_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
         AND COALESCE(ce.article_count, 0) >= 2
         AND EXISTS (
           SELECT 1 FROM matched_controls mc WHERE mc.canonical_event_id = ce.id
         )
         AND EXISTS (
           SELECT 1
             FROM article_event_map aem
             JOIN labeled_outcomes lo ON lo.article_id = aem.article_id
            WHERE aem.canonical_event_id = ce.id
              AND lo.abnormal_return IS NOT NULL
         )
       ORDER BY ce.event_date DESC, ce.id DESC
       LIMIT $2
    ),
    event_lo AS (
      SELECT
        aem.canonical_event_id,
        lo.symbol,
        lo.horizon,
        AVG(lo.abnormal_return)::double precision AS avg_alpha
      FROM target_events te
      JOIN article_event_map aem ON aem.canonical_event_id = te.id
      JOIN labeled_outcomes lo ON lo.article_id = aem.article_id
      WHERE lo.abnormal_return IS NOT NULL
      GROUP BY aem.canonical_event_id, lo.symbol, lo.horizon
    ),
    control_returns AS (
      SELECT
        mc.canonical_event_id,
        event_lo.symbol,
        event_lo.horizon,
        COALESCE(lo.abnormal_return, lo.forward_return_pct)::double precision AS control_return,
        mc.control_date
      FROM target_events te
      JOIN matched_controls mc ON mc.canonical_event_id = te.id
      JOIN event_lo ON event_lo.canonical_event_id = te.id
      JOIN articles a ON DATE(a.published_at) = mc.control_date
      JOIN labeled_outcomes lo
        ON lo.article_id = a.id
       AND lo.symbol = event_lo.symbol
       AND lo.horizon = event_lo.horizon
      WHERE COALESCE(lo.abnormal_return, lo.forward_return_pct) IS NOT NULL
    ),
    mc_agg AS (
      SELECT
        canonical_event_id,
        symbol,
        horizon,
        AVG(control_return)::double precision AS avg_ctrl,
        STDDEV(control_return)::double precision AS std_ctrl,
        COUNT(DISTINCT control_date)::int AS n_ctrl
      FROM control_returns
      GROUP BY canonical_event_id, symbol, horizon
      HAVING COUNT(DISTINCT control_date) >= 2
    ),
    scored AS (
      SELECT
        mc_agg.canonical_event_id,
        event_lo.symbol,
        event_lo.horizon,
        event_lo.avg_alpha,
        mc_agg.avg_ctrl,
        event_lo.avg_alpha - mc_agg.avg_ctrl AS uplift,
        CASE
          WHEN mc_agg.std_ctrl > 0 AND mc_agg.n_ctrl > 1
            THEN (event_lo.avg_alpha - mc_agg.avg_ctrl) / (mc_agg.std_ctrl / SQRT(mc_agg.n_ctrl))
          ELSE 0
        END AS t_stat,
        mc_agg.n_ctrl
      FROM mc_agg
      JOIN event_lo
        ON event_lo.canonical_event_id = mc_agg.canonical_event_id
       AND event_lo.symbol = mc_agg.symbol
       AND event_lo.horizon = mc_agg.horizon
    )
    INSERT INTO event_uplift (
      canonical_event_id, symbol, horizon, event_alpha, control_avg_return,
      uplift, t_stat, n_controls, evidence_grade
    )
    SELECT
      canonical_event_id,
      symbol,
      horizon,
      avg_alpha,
      avg_ctrl,
      uplift,
      t_stat,
      n_ctrl,
      CASE
        WHEN avg_alpha > 0 AND uplift > 0 AND n_ctrl >= 3 AND ABS(t_stat) >= 2 THEN 'E2'
        WHEN avg_alpha > 0 AND uplift > 0 THEN 'E1'
        ELSE 'E0'
      END AS evidence_grade
      FROM scored
    ON CONFLICT (canonical_event_id, symbol, horizon) DO NOTHING
  `, [days, limit]);
  return result.rowCount || 0;
}

export async function repairRecentEventUplift(options = {}) {
  const args = {
    days: Math.max(7, Math.min(365, Number(options.days) || 75)),
    limit: Math.max(1, Math.min(10000, Number(options.limit) || 1000)),
    dryRun: Boolean(options.dryRun),
  };
  loadOptionalEnvFile(options.envFile || '.env.local');
  const pool = new Pool({ ...resolveNasPgConfig(), max: 4 });
  const lockKey = 'repair-recent-event-uplift';
  try {
    const lock = await pool.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockKey]);
    if (!lock.rows[0]?.locked) {
      return { ok: false, skipped: true, reason: 'repair lock already held' };
    }
    const before = await countRepairTargets(pool, args);
    if (args.dryRun) {
      return { ok: true, dryRun: true, before };
    }
    const controlsInserted = await insertMissingControls(pool, args);
    const upliftInserted = await insertMissingUplift(pool, args);
    const after = await countRepairTargets(pool, args);
    return { ok: true, dryRun: false, before, controlsInserted, upliftInserted, after };
  } finally {
    await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => {});
    await pool.end().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await repairRecentEventUplift(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
