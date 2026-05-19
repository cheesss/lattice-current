#!/usr/bin/env node
/**
 * meta-model-infer.mjs - Run meta-model inference on recent event gaps.
 *
 * This script predicts only missing (event, symbol, horizon, model_version)
 * pairs. Event-level "already predicted" checks are intentionally avoided:
 * they hide partial coverage gaps and leave dashboard model cards stale.
 *
 * Inputs (env-overridable):
 *   META_MODEL_URL             default http://127.0.0.1:8100
 *   META_INFER_LIMIT           default 1000  (event cap per cycle)
 *   META_INFER_BATCH           default 64    (server batch size)
 *   META_INFER_LOOKBACK_DAYS   default 21    (recent event window)
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureCuratedThemeSymbols } from './migrations/seed-theme-symbols-curation.mjs';

loadOptionalEnvFile();

const META_URL = (process.env.META_MODEL_URL || 'http://127.0.0.1:8100').replace(/\/$/, '');
const INFER_LIMIT = Math.max(50, Math.min(5000, Number(process.env.META_INFER_LIMIT) || 1000));
const BATCH = Math.max(1, Math.min(256, Number(process.env.META_INFER_BATCH) || 64));
const LOOKBACK_DAYS = Math.max(1, Math.min(3650, Number(process.env.META_INFER_LOOKBACK_DAYS) || 21));
const FORCE_REFRESH = ['1', 'true', 'yes'].includes(String(process.env.META_INFER_FORCE_REFRESH || '').toLowerCase());

const REGIME_TO_ID = {
  'risk-on-strong': 0,
  'risk-on': 1,
  balanced: 2,
  'risk-off': 3,
  crisis: 4,
};

function n(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function modelInputFromEvent(eventRow) {
  return {
    source_count: n(eventRow.source_count, 1),
    source_diversity: n(eventRow.source_diversity, 1),
    article_count: n(eventRow.article_count, 1),
    hawkes_intensity: n(eventRow.hawkes_intensity),
    hawkes_momentum: n(eventRow.hawkes_momentum),
    vix_value: n(eventRow.vix_value, 20),
    vix_zscore: n(eventRow.vix_zscore),
    vix_momentum: n(eventRow.vix_momentum),
    yield_spread: n(eventRow.yield_spread),
    oil_price: n(eventRow.oil_price, 80),
    dollar_index: n(eventRow.dollar_index, 100),
    credit_spread_hy: n(eventRow.credit_spread_hy, 4),
    market_stress: n(eventRow.market_stress),
    transmission_strength: n(eventRow.transmission_strength),
    event_intensity: n(eventRow.event_intensity),
    regime_multiplier: n(eventRow.regime_multiplier, 1),
    risk_gauge: n(eventRow.risk_gauge, 50),
    regime_id: REGIME_TO_ID[eventRow.regime_label] ?? REGIME_TO_ID.balanced,
  };
}

async function loadActiveModelVersion(pool) {
  const { rows } = await pool.query(`
    SELECT model_version
      FROM model_registry
     WHERE promotion_state IN ('active', 'shadow')
     ORDER BY promoted_at DESC NULLS LAST, created_at DESC
     LIMIT 1
  `);
  return rows[0]?.model_version || null;
}

async function loadPendingEvents(pool, modelVersion) {
  const events = await pool.query(`
    WITH horizon(horizon) AS (VALUES ('1w'), ('2w'), ('1m')),
    candidate_events AS (
      SELECT ef.canonical_event_id AS event_id,
             ce.theme,
             ce.event_date,
             ef.source_count, ef.source_diversity, ef.article_count,
             ef.hawkes_intensity, ef.hawkes_momentum,
             ef.vix_value, ef.vix_zscore, ef.vix_momentum,
             ef.yield_spread, ef.oil_price, ef.dollar_index, ef.credit_spread_hy,
             ef.market_stress, ef.transmission_strength, ef.event_intensity,
             ef.regime_label, ef.regime_multiplier, ef.risk_gauge,
             ef.computed_at AS feature_computed_at
        FROM event_features ef
        JOIN canonical_events ce ON ce.id = ef.canonical_event_id
       WHERE ce.event_date >= NOW() - ($2::int * INTERVAL '1 day')
    ),
    missing_pairs AS (
      SELECT ce.event_id,
             COUNT(*)::int AS missing_pair_count
        FROM candidate_events ce
        JOIN LATERAL (
          SELECT symbol
            FROM auto_theme_symbols ats
           WHERE ats.theme = ce.theme
           ORDER BY quality_score DESC NULLS LAST,
                    correlation DESC NULLS LAST,
                    reaction_count DESC NULLS LAST,
                    symbol
           LIMIT 5
        ) ats ON TRUE
        CROSS JOIN horizon h
       WHERE $4::boolean
          OR NOT EXISTS (
         SELECT 1
           FROM model_predictions mp
          WHERE mp.canonical_event_id = ce.event_id
            AND mp.model_version = $1
            AND mp.symbol = ats.symbol
            AND mp.horizon = h.horizon
       )
       OR EXISTS (
         SELECT 1
           FROM model_predictions mp
          WHERE mp.canonical_event_id = ce.event_id
            AND mp.model_version = $1
            AND mp.symbol = ats.symbol
            AND mp.horizon = h.horizon
            AND ce.feature_computed_at IS NOT NULL
            AND mp.created_at < ce.feature_computed_at
       )
       GROUP BY ce.event_id
    )
    SELECT ce.*, mp.missing_pair_count
      FROM candidate_events ce
      JOIN missing_pairs mp ON mp.event_id = ce.event_id
     ORDER BY ce.event_date DESC, ce.event_id DESC
     LIMIT $3
  `, [modelVersion, LOOKBACK_DAYS, INFER_LIMIT, FORCE_REFRESH]);
  return events.rows;
}

async function loadMissingPairs(pool, eventRow, modelVersion) {
  const pairs = await pool.query(`
    WITH horizon(horizon) AS (VALUES ('1w'), ('2w'), ('1m')),
    symbols AS (
      SELECT symbol
        FROM auto_theme_symbols
       WHERE theme = $1
       ORDER BY quality_score DESC NULLS LAST,
                correlation DESC NULLS LAST,
                reaction_count DESC NULLS LAST,
                symbol
       LIMIT 5
    )
    SELECT symbols.symbol, horizon.horizon
      FROM symbols
      CROSS JOIN horizon
     WHERE $4::boolean
        OR NOT EXISTS (
       SELECT 1
         FROM model_predictions mp
        WHERE mp.canonical_event_id = $2
          AND mp.model_version = $3
          AND mp.symbol = symbols.symbol
          AND mp.horizon = horizon.horizon
     )
     OR EXISTS (
       SELECT 1
         FROM model_predictions mp
         JOIN event_features ef ON ef.canonical_event_id = mp.canonical_event_id
        WHERE mp.canonical_event_id = $2
          AND mp.model_version = $3
          AND mp.symbol = symbols.symbol
          AND mp.horizon = horizon.horizon
          AND ef.computed_at IS NOT NULL
          AND mp.created_at < ef.computed_at
     )
     ORDER BY symbols.symbol, horizon.horizon
  `, [eventRow.theme, eventRow.event_id, modelVersion, FORCE_REFRESH]);
  return pairs.rows;
}

async function logReadiness(pool) {
  const readiness = await pool.query(`
    WITH recent_events AS (
      SELECT ce.id, ce.theme
        FROM canonical_events ce
        JOIN event_features ef ON ef.canonical_event_id = ce.id
       WHERE ce.event_date >= NOW() - ($1::int * INTERVAL '1 day')
    )
    SELECT COUNT(*)::int AS recent_events,
           COUNT(*) FILTER (
             WHERE EXISTS (
               SELECT 1 FROM auto_theme_symbols ats WHERE ats.theme = recent_events.theme
             )
           )::int AS mapped_events,
           COUNT(DISTINCT theme)::int AS recent_themes,
           COUNT(DISTINCT theme) FILTER (
             WHERE NOT EXISTS (
               SELECT 1 FROM auto_theme_symbols ats WHERE ats.theme = recent_events.theme
             )
           )::int AS unmapped_themes
      FROM recent_events
  `, [LOOKBACK_DAYS]).catch(() => null);
  const row = readiness?.rows?.[0];
  if (!row) return;
  console.log(
    `readiness: lookback_days=${LOOKBACK_DAYS} recent_events=${row.recent_events} `
    + `mapped_events=${row.mapped_events} unmapped_themes=${row.unmapped_themes}/${row.recent_themes}`,
  );
}

async function insertPredictions(pool, rows, values) {
  if (rows.length === 0) return 0;
  const placeholders = [];
  let p = 1;
  for (let i = 0; i < rows.length; i += 1) {
    placeholders.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, NOW())`);
  }
  const result = await pool.query(
    `INSERT INTO model_predictions
       (canonical_event_id, symbol, horizon, alpha_prob, expected_alpha, downside_risk, time_to_peak, model_version, created_at)
     VALUES ${placeholders.join(',')}
     ON CONFLICT (canonical_event_id, symbol, horizon, model_version) DO UPDATE SET
       alpha_prob = EXCLUDED.alpha_prob,
       expected_alpha = EXCLUDED.expected_alpha,
       downside_risk = EXCLUDED.downside_risk,
       time_to_peak = EXCLUDED.time_to_peak,
       created_at = NOW()`,
    values,
  );
  return result.rowCount || 0;
}

async function main() {
  const pool = new pg.Pool(resolveNasPgConfig());
  try {
    const modelVersion = await loadActiveModelVersion(pool);
    if (!modelVersion) {
      console.log('no active/shadow model in model_registry; nothing to infer');
      return;
    }
    console.log(`active model: ${modelVersion}`);

    const health = await fetch(`${META_URL}/health`, { signal: AbortSignal.timeout(5000) })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    if (!health || health.status !== 'ok') {
      console.log(`meta-model-server unreachable at ${META_URL}/health; skipping cycle`);
      return;
    }
    console.log(`server: ${health.model_version} on ${health.device}`);
    if (health.model_version && health.model_version !== modelVersion) {
      throw new Error(
        `meta-model-server version mismatch: registry active=${modelVersion}, server=${health.model_version}. `
        + 'Restart meta-model-server with the active model before inference.',
      );
    }
    if (FORCE_REFRESH) {
      console.log('force refresh enabled: recomputing current event/symbol/horizon universe');
    }

    const seedStats = await ensureCuratedThemeSymbols(pool);
    if (seedStats.inserted > 0) {
      console.log(`seeded curated theme-symbol fallbacks: inserted=${seedStats.inserted}`);
    }
    await logReadiness(pool);

    const events = await loadPendingEvents(pool, modelVersion);
    if (events.length === 0) {
      console.log(`no event/symbol/horizon pairs pending inference for model_version=${modelVersion} in lookback_days=${LOOKBACK_DAYS}`);
      return;
    }
    const missingPairs = events.reduce((sum, eventRow) => sum + n(eventRow.missing_pair_count), 0);
    console.log(`pending events: ${events.length}, missing pairs: ${missingPairs}`);

    let totalRequests = 0;
    let totalInserted = 0;
    let skippedNoPendingPairs = 0;

    for (const eventRow of events) {
      const pairs = await loadMissingPairs(pool, eventRow, modelVersion);
      if (pairs.length === 0) {
        skippedNoPendingPairs += 1;
        continue;
      }

      const eventInput = modelInputFromEvent(eventRow);
      const requests = pairs.map(() => eventInput);
      const meta = pairs.map((pair) => ({
        event_id: eventRow.event_id,
        symbol: pair.symbol,
        horizon: pair.horizon,
      }));

      for (let i = 0; i < requests.length; i += BATCH) {
        const slice = requests.slice(i, i + BATCH);
        const sliceMeta = meta.slice(i, i + BATCH);
        const response = await fetch(`${META_URL}/predict/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(slice),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          console.warn(`predict/batch ${response.status} for event ${eventRow.event_id}; skipping`);
          break;
        }

        const output = await response.json();
        totalRequests += output.length;
        const values = [];
        for (let k = 0; k < output.length; k += 1) {
          const predictionMeta = sliceMeta[k];
          const prediction = output[k];
          values.push(
            predictionMeta.event_id,
            predictionMeta.symbol,
            predictionMeta.horizon,
            prediction.alpha_prob,
            prediction.expected_alpha,
            prediction.downside_risk,
            prediction.time_to_peak,
            modelVersion,
          );
        }
        totalInserted += await insertPredictions(pool, output, values);
      }
    }

    console.log(
      `done: events_pending=${events.length} skipped_no_pending_pairs=${skippedNoPendingPairs} `
      + `predictions=${totalRequests} inserted=${totalInserted}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error?.message || error) + '\n');
  process.exitCode = 1;
});
