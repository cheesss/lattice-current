#!/usr/bin/env node
/**
 * meta-model-infer.mjs — Run meta-model inference on recent events without predictions.
 *
 * Pulls event_features rows whose canonical_event_id is NOT already in
 * model_predictions for the active model_version, batches them through
 * the FastAPI inference server (default :8100), and writes results to
 * model_predictions.
 *
 * Inputs (env-overridable):
 *   META_MODEL_URL      default http://127.0.0.1:8100
 *   META_INFER_LIMIT    default 1000  (per-cycle cap)
 *   META_INFER_BATCH    default 64    (server batch size)
 *
 * Picks model_version from the most recently registered active row in
 * model_registry (filtered by promotion_state IN ('active','shadow')).
 *
 * For each event, fans out across symbols mapped to the event's theme
 * via auto_theme_symbols (top 5 by quality_score) and 3 horizons
 * (1w/2w/1m). Existing (event, symbol, horizon) pairs are skipped via
 * INSERT ON CONFLICT DO NOTHING.
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();

const META_URL = (process.env.META_MODEL_URL || 'http://127.0.0.1:8100').replace(/\/$/, '');
const INFER_LIMIT = Math.max(50, Math.min(5000, Number(process.env.META_INFER_LIMIT) || 1000));
const BATCH = Math.max(1, Math.min(256, Number(process.env.META_INFER_BATCH) || 64));
const HORIZONS = ['1w', '2w', '1m'];

const REGIME_TO_ID = {
  'risk-on-strong': 0,
  'risk-on': 1,
  balanced: 2,
  'risk-off': 3,
  crisis: 4,
};

const FEATURE_KEYS = [
  'source_count', 'source_diversity', 'article_count',
  'hawkes_intensity', 'hawkes_momentum',
  'vix_value', 'vix_zscore', 'vix_momentum',
  'yield_spread', 'oil_price', 'dollar_index', 'credit_spread_hy',
  'market_stress', 'transmission_strength', 'event_intensity',
  'regime_multiplier', 'risk_gauge',
];

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

async function main() {
  const pool = new pg.Pool(resolveNasPgConfig());
  try {
    const reg = await pool.query(`
      SELECT model_version
        FROM model_registry
       WHERE promotion_state IN ('active', 'shadow')
       ORDER BY promoted_at DESC NULLS LAST, created_at DESC
       LIMIT 1
    `);
    if (reg.rows.length === 0) {
      console.log('no active/shadow model in model_registry — nothing to infer');
      return;
    }
    const modelVersion = reg.rows[0].model_version;
    console.log(`active model: ${modelVersion}`);

    const health = await fetch(`${META_URL}/health`, { signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!health || health.status !== 'ok') {
      console.log(`meta-model-server unreachable at ${META_URL}/health — skipping cycle`);
      return;
    }
    console.log(`server: ${health.model_version} on ${health.device}`);

    const events = await pool.query(`
      SELECT ef.canonical_event_id AS event_id,
             ce.theme,
             ce.event_date,
             ef.source_count, ef.source_diversity, ef.article_count,
             ef.hawkes_intensity, ef.hawkes_momentum,
             ef.vix_value, ef.vix_zscore, ef.vix_momentum,
             ef.yield_spread, ef.oil_price, ef.dollar_index, ef.credit_spread_hy,
             ef.market_stress, ef.transmission_strength, ef.event_intensity,
             ef.regime_label, ef.regime_multiplier, ef.risk_gauge
        FROM event_features ef
        JOIN canonical_events ce ON ce.id = ef.canonical_event_id
       WHERE NOT EXISTS (
         SELECT 1 FROM model_predictions mp
          WHERE mp.canonical_event_id = ef.canonical_event_id
            AND mp.model_version = $1
       )
       ORDER BY ce.event_date DESC, ef.canonical_event_id DESC
       LIMIT $2
    `, [modelVersion, INFER_LIMIT]);

    if (events.rows.length === 0) {
      console.log('no events pending inference for this model_version');
      return;
    }
    console.log(`pending events: ${events.rows.length}`);

    let totalRequests = 0;
    let totalInserted = 0;
    let skippedNoSymbols = 0;

    for (const ev of events.rows) {
      const syms = await pool.query(`
        SELECT symbol
          FROM auto_theme_symbols
         WHERE theme = $1
         ORDER BY quality_score DESC NULLS LAST, correlation DESC NULLS LAST
         LIMIT 5
      `, [ev.theme]);
      if (syms.rows.length === 0) {
        skippedNoSymbols += 1;
        continue;
      }

      const requests = [];
      const meta = [];
      for (const { symbol } of syms.rows) {
        for (const horizon of HORIZONS) {
          const req = {
            source_count: n(ev.source_count, 1),
            source_diversity: n(ev.source_diversity, 1),
            article_count: n(ev.article_count, 1),
            hawkes_intensity: n(ev.hawkes_intensity),
            hawkes_momentum: n(ev.hawkes_momentum),
            vix_value: n(ev.vix_value, 20),
            vix_zscore: n(ev.vix_zscore),
            vix_momentum: n(ev.vix_momentum),
            yield_spread: n(ev.yield_spread),
            oil_price: n(ev.oil_price, 80),
            dollar_index: n(ev.dollar_index, 100),
            credit_spread_hy: n(ev.credit_spread_hy, 4),
            market_stress: n(ev.market_stress),
            transmission_strength: n(ev.transmission_strength),
            event_intensity: n(ev.event_intensity),
            regime_multiplier: n(ev.regime_multiplier, 1),
            risk_gauge: n(ev.risk_gauge, 50),
            regime_id: REGIME_TO_ID[ev.regime_label] ?? REGIME_TO_ID.balanced,
          };
          requests.push(req);
          meta.push({ event_id: ev.event_id, symbol, horizon });
        }
      }

      for (let i = 0; i < requests.length; i += BATCH) {
        const slice = requests.slice(i, i + BATCH);
        const sliceMeta = meta.slice(i, i + BATCH);
        const res = await fetch(`${META_URL}/predict/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(slice),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          console.warn(`predict/batch ${res.status} for event ${ev.event_id} — skipping`);
          break;
        }
        const out = await res.json();
        totalRequests += out.length;

        // Multi-row INSERT — previous per-row pattern caused N round-trips
        // per event (15 INSERTs per event × hundreds of events per cycle).
        // Single bulk INSERT cuts cycle time roughly 5-8x and stays within
        // the pg parameter limit (PG_MAX_PARAMS≈65535 / 8 cols = 8192 rows).
        if (out.length === 0) continue;
        const values = [];
        const placeholders = [];
        let p = 1;
        for (let k = 0; k < out.length; k += 1) {
          const m = sliceMeta[k];
          const r = out[k];
          placeholders.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, NOW())`);
          values.push(m.event_id, m.symbol, m.horizon, r.alpha_prob, r.expected_alpha, r.downside_risk, r.time_to_peak, modelVersion);
        }
        const ins = await pool.query(
          `INSERT INTO model_predictions
             (canonical_event_id, symbol, horizon, alpha_prob, expected_alpha, downside_risk, time_to_peak, model_version, created_at)
           VALUES ${placeholders.join(',')}
           ON CONFLICT DO NOTHING`,
          values,
        );
        totalInserted += ins.rowCount || 0;
      }
    }

    console.log(`done: events_pending=${events.rows.length} skipped_no_symbols=${skippedNoSymbols} predictions=${totalRequests} inserted=${totalInserted}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error?.message || error) + '\n');
  process.exitCode = 1;
});
