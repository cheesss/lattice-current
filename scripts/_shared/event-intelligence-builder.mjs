/**
 * Event intelligence builders — expose the project's core domain data
 * (events, evidence grades, meta-model predictions, source diversity)
 * through read-only payloads for dashboard APIs and OpenClaw tools.
 *
 * Philosophy:
 *   - aggregate metrics only, no raw predictions beyond small samples
 *   - include evidence grade (E0–E4) so consumers never mistake weak
 *     signals for strong ones
 *   - every payload carries generatedAt and explicit zero-result markers
 *
 * Tables touched (all read-only):
 *   canonical_events, event_hawkes_intensity, event_uplift,
 *   model_predictions, model_eval, matched_controls, article_event_map,
 *   articles
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { rankByProductScore, classifyEventLane } from './event-product-score.mjs';

const HOT_EVENTS_LIMIT = 10;
const HOT_EVENTS_LOOKBACK_DAYS = 7;
export const HOT_EVENTS_MIN_PROMOTION_CONTROLS = 8;
const EXPLAIN_EVENT_ARTICLE_LIMIT = 12;
const EXPLAIN_EVENT_SYMBOL_LIMIT = 10;
const SOURCE_DIVERSITY_WINDOW_HOURS = 24;
const SOURCE_DIVERSITY_TOP_LIMIT = 15;
const SOURCE_DOMINANCE_WARN_PCT = 0.30;
const SOURCE_DOMINANCE_CRITICAL_PCT = 0.50;
const META_MODEL_RECENT_HOURS = 24;
export const META_MODEL_PROMOTION_GATES = Object.freeze({
  maxAggregateBrier: 0.25,
  maxWorstBrier: 0.25,
  maxAggregateEce: 0.10,
  maxWorstRawEceForWatch: 0.15,
  maxEffectiveEce: 0.08,
  minTop20Precision: 0.20,
  minSampleCount: 10_000,
  maxFeatureLagDays: 0,
  maxFeatureStaleRows: 0,
  maxPredictionStaleRows: 0,
  recentPredictionWindowHours: META_MODEL_RECENT_HOURS,
});

async function tableExists(executor, tableName) {
  const { rows } = await executor.query(
    `SELECT to_regclass($1) AS oid`,
    [`public.${tableName}`],
  );
  return Boolean(rows[0]?.oid);
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function gateResult(name, value, threshold, pass, warning = false) {
  return {
    name,
    value: value == null ? null : Number(value),
    threshold,
    status: pass ? 'pass' : warning ? 'watch' : 'fail',
  };
}

async function loadMetaModelCalibrationSidecar(modelVersion) {
  const safeVersion = String(modelVersion || '').trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(safeVersion)) return null;
  const calibrationPath = path.resolve('data', `${safeVersion}.calibration.json`);
  try {
    const parsed = JSON.parse(await readFile(calibrationPath, 'utf8'));
    const postMetrics = parsed?.post_metrics || {};
    const preMetrics = parsed?.pre_metrics || {};
    return {
      source: 'calibration-sidecar',
      modelVersion: parsed.model_version || safeVersion,
      method: parsed.calibration_method || 'unknown',
      temperature: finiteNumber(parsed.temperature),
      validationN: finiteNumber(parsed.validation_n),
      preMetrics: {
        brier: finiteNumber(preMetrics.brier),
        ece: finiteNumber(preMetrics.ece),
      },
      postMetrics: {
        brier: finiteNumber(postMetrics.brier),
        ece: finiteNumber(postMetrics.ece),
      },
    };
  } catch {
    return null;
  }
}

export function evaluateMetaModelTrust({
  hasEval,
  hasPredictions,
  latestEval,
  recentPredictions,
  pipelineFreshness,
  symbolCoverage,
  calibration,
} = {}) {
  const notes = [];
  const recommendedActions = [];
  const gates = [];

  if (!hasEval && !hasPredictions) {
    return {
      level: 'warning',
      healthStatus: 'disabled',
      effectiveMetrics: null,
      gates,
      notes: ['model_eval / model_predictions tables missing; meta-model pipeline is not initialized'],
      recommendedActions: ['Run model table migrations, train-meta-model, then meta-model-infer.'],
    };
  }
  if (!hasEval) {
    return {
      level: 'warning',
      healthStatus: 'disabled',
      effectiveMetrics: null,
      gates,
      notes: ['model_eval table missing; Brier/ECE tracking is unavailable'],
      recommendedActions: ['Create model_eval and run the validation job before trusting model scores.'],
    };
  }
  if (!latestEval) {
    return {
      level: 'warning',
      healthStatus: 'disabled',
      effectiveMetrics: null,
      gates,
      notes: ['model_eval is empty; run the first validation job'],
      recommendedActions: ['Run train-meta-model or compare-models to populate model_eval.'],
    };
  }

  const aggregateBrier = finiteNumber(latestEval.brierScore);
  const worstBrier = finiteNumber(latestEval.worstBrierScore) ?? aggregateBrier;
  const aggregateEce = finiteNumber(latestEval.ece);
  const worstEce = finiteNumber(latestEval.worstEce) ?? aggregateEce;
  const calibratedEce = finiteNumber(calibration?.postMetrics?.ece);
  const calibratedBrier = finiteNumber(calibration?.postMetrics?.brier);
  const effectiveEce = calibratedEce ?? aggregateEce;
  const effectiveBrier = calibratedBrier ?? aggregateBrier;
  const top20Precision = finiteNumber(latestEval.top20Precision);
  const sampleCount = finiteNumber(latestEval.sampleCount);
  const featureLagDays = finiteNumber(pipelineFreshness?.featureLagDays);
  const featureStaleRows = finiteNumber(pipelineFreshness?.featureStaleEventCount) ?? 0;
  const predictionStaleRows = finiteNumber(pipelineFreshness?.predictionStaleCount) ?? 0;

  gates.push(gateResult('aggregate-brier', aggregateBrier, `<= ${META_MODEL_PROMOTION_GATES.maxAggregateBrier}`, aggregateBrier != null && aggregateBrier <= META_MODEL_PROMOTION_GATES.maxAggregateBrier));
  gates.push(gateResult('worst-split-brier', worstBrier, `<= ${META_MODEL_PROMOTION_GATES.maxWorstBrier}`, worstBrier != null && worstBrier <= META_MODEL_PROMOTION_GATES.maxWorstBrier));
  gates.push(gateResult('aggregate-ece', aggregateEce, `<= ${META_MODEL_PROMOTION_GATES.maxAggregateEce}`, aggregateEce != null && aggregateEce <= META_MODEL_PROMOTION_GATES.maxAggregateEce));
  gates.push(gateResult(
    'effective-ece',
    effectiveEce,
    `<= ${META_MODEL_PROMOTION_GATES.maxEffectiveEce}`,
    effectiveEce != null && effectiveEce <= META_MODEL_PROMOTION_GATES.maxEffectiveEce,
    effectiveEce != null && effectiveEce <= META_MODEL_PROMOTION_GATES.maxAggregateEce,
  ));
  gates.push(gateResult('top20-precision', top20Precision, `>= ${META_MODEL_PROMOTION_GATES.minTop20Precision}`, top20Precision != null && top20Precision >= META_MODEL_PROMOTION_GATES.minTop20Precision));
  gates.push(gateResult('sample-count', sampleCount, `>= ${META_MODEL_PROMOTION_GATES.minSampleCount}`, sampleCount != null && sampleCount >= META_MODEL_PROMOTION_GATES.minSampleCount));
  gates.push(gateResult('feature-lag-days', featureLagDays ?? 0, `<= ${META_MODEL_PROMOTION_GATES.maxFeatureLagDays}`, (featureLagDays ?? 0) <= META_MODEL_PROMOTION_GATES.maxFeatureLagDays));
  gates.push(gateResult('stale-feature-rows', featureStaleRows, `<= ${META_MODEL_PROMOTION_GATES.maxFeatureStaleRows}`, featureStaleRows <= META_MODEL_PROMOTION_GATES.maxFeatureStaleRows));
  gates.push(gateResult('stale-prediction-rows', predictionStaleRows, `<= ${META_MODEL_PROMOTION_GATES.maxPredictionStaleRows}`, predictionStaleRows <= META_MODEL_PROMOTION_GATES.maxPredictionStaleRows));

  let healthStatus = 'ok';
  if (Number.isFinite(worstEce) && worstEce > META_MODEL_PROMOTION_GATES.maxAggregateEce) {
    if (calibratedEce != null && calibratedEce <= META_MODEL_PROMOTION_GATES.maxEffectiveEce) {
      notes.push(`Raw worst split ECE ${worstEce.toFixed(4)} > ${META_MODEL_PROMOTION_GATES.maxAggregateEce.toFixed(2)}, but active temperature calibration lowers operational ECE to ${calibratedEce.toFixed(4)}`);
      recommendedActions.push('No operator action required now; keep the model active and refresh calibration on the next retrain cycle.');
    } else if (worstEce <= META_MODEL_PROMOTION_GATES.maxWorstRawEceForWatch) {
      healthStatus = 'calibration-warning';
      notes.push(`Worst split ECE ${worstEce.toFixed(4)} is above target; calibration sidecar is missing or insufficient`);
      recommendedActions.push('Run python scripts/calibrate-meta-model.py, restart meta-model-server, then rerun meta-model-infer.');
    } else {
      healthStatus = 'calibration-warning';
      notes.push(`Worst split ECE ${worstEce.toFixed(4)} exceeds the hard watch gate ${META_MODEL_PROMOTION_GATES.maxWorstRawEceForWatch.toFixed(2)}`);
      recommendedActions.push('Move the model to shadow/deprecated and retrain before using new predictions for operator priority.');
    }
  }
  if (Number.isFinite(worstBrier) && worstBrier > META_MODEL_PROMOTION_GATES.maxWorstBrier) {
    healthStatus = 'calibration-warning';
    notes.push(`Worst split Brier ${worstBrier.toFixed(4)} > ${META_MODEL_PROMOTION_GATES.maxWorstBrier}; probability calibration may be weak`);
    recommendedActions.push('Recalibrate or retrain before promoting a new model version.');
  }
  if (top20Precision != null && top20Precision < META_MODEL_PROMOTION_GATES.minTop20Precision) {
    healthStatus = 'calibration-warning';
    notes.push(`Top20 precision ${top20Precision.toFixed(3)} < ${META_MODEL_PROMOTION_GATES.minTop20Precision}; high-priority ranking is weak`);
    recommendedActions.push('Audit feature quality and keep predictions advisory-only until ranking improves.');
  }
  if (recentPredictions && recentPredictions.recentCount === 0 && recentPredictions.total > 0) {
    healthStatus = 'stale';
    notes.push(`No model_predictions created in the last ${META_MODEL_RECENT_HOURS}h; check daemon meta-model-infer`);
    recommendedActions.push('Run node --import tsx scripts/meta-model-infer.mjs and inspect daemon logs.');
  }
  if (featureLagDays != null && featureLagDays >= 1 && Number(pipelineFreshness?.articles24h ?? 0) > 0) {
    healthStatus = 'stale';
    notes.push(`event_features lag latest article date by ${featureLagDays.toFixed(0)}d; run event-engine-incremental before inference`);
    recommendedActions.push('Run master-daemon repair-stale-features, then meta-model-infer.');
  }
  if (featureStaleRows > 0) {
    healthStatus = 'stale';
    notes.push(`${featureStaleRows} recent event_features rows are stale versus canonical event stats; run event-engine-incremental`);
    recommendedActions.push('Run node scripts/master-daemon.mjs --task repair-stale-features.');
  }
  if (predictionStaleRows > 0) {
    healthStatus = 'stale';
    notes.push(`${predictionStaleRows} model prediction rows are older than current event features; rerun meta-model-infer`);
    recommendedActions.push('Run node --import tsx scripts/meta-model-infer.mjs.');
  }
  if (symbolCoverage && symbolCoverage.coveragePct < 0.9) {
    healthStatus = 'stale';
    notes.push(`Only ${(symbolCoverage.coveragePct * 100).toFixed(0)}% of recent themes have symbol mappings; curated fallback seed is required`);
    recommendedActions.push('Run seed-theme-symbols-curation and review missing theme mappings.');
  }

  const hasFailGate = gates.some((gate) => gate.status === 'fail');
  const level = healthStatus === 'stale' || healthStatus === 'disabled' || healthStatus === 'calibration-warning'
    ? 'warning'
    : 'ok';

  return {
    level: hasFailGate ? 'warning' : level,
    healthStatus,
    effectiveMetrics: {
      brier: effectiveBrier,
      ece: effectiveEce,
      calibrated: Boolean(calibratedEce != null || calibratedBrier != null),
      rawAggregateBrier: aggregateBrier,
      rawAggregateEce: aggregateEce,
      rawWorstBrier: worstBrier,
      rawWorstEce: worstEce,
    },
    gates,
    notes,
    recommendedActions: Array.from(new Set(recommendedActions)),
  };
}

/* ===================== get_hot_events ===================== */

function asBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function buildHotEventQualityFlags(row = {}) {
  const flags = [];
  const rawGrade = row.raw_best_grade || row.raw_evidence_grade || row.best_grade || null;
  const promotedGrade = row.promoted_grade || null;
  const controlsBlocked = asBoolean(row.controls_blocked);
  const relevanceBlocked = asBoolean(row.relevance_blocked);

  if (rawGrade && !promotedGrade) {
    flags.push('raw-grade-not-promoted');
  }
  if (controlsBlocked) {
    flags.push('low-control-count');
  }
  if (relevanceBlocked) {
    flags.push('low-market-relevance');
  }
  if (Number(row.article_count ?? 0) < 2) {
    flags.push('single-article');
  }
  if (Number(row.source_count ?? 0) < 2) {
    flags.push('single-source');
  }
  return flags;
}

export function normalizeHotEventRow(row = {}) {
  const qualityFlags = buildHotEventQualityFlags(row);
  const promotedGrade = row.promoted_grade || null;
  const rawGrade = row.raw_best_grade || row.raw_evidence_grade || row.best_grade || null;

  return {
    id: Number(row.id),
    theme: row.theme,
    title: row.representative_title,
    eventDate: row.event_date,
    articleCount: Number(row.article_count ?? 0),
    sourceCount: Number(row.source_count ?? 0),
    temperature: row.temperature == null ? null : Number(row.temperature),
    isSurge: Boolean(row.is_surge),
    bestEvidenceGrade: promotedGrade,
    rawEvidenceGrade: rawGrade,
    upliftRows: Number(row.uplift_rows ?? 0),
    promotedUpliftRows: Number(row.promoted_uplift_rows ?? 0),
    maxAbsUplift: row.rank_abs_uplift == null ? null : Number(row.rank_abs_uplift),
    rawMaxAbsUplift: row.raw_max_abs_uplift == null ? null : Number(row.raw_max_abs_uplift),
    maxAbsTStat: row.rank_abs_t == null ? null : Number(row.rank_abs_t),
    rawMaxAbsTStat: row.raw_max_abs_t == null ? null : Number(row.raw_max_abs_t),
    minStrongControls: row.min_strong_controls == null ? null : Number(row.min_strong_controls),
    maxStrongControls: row.max_strong_controls == null ? null : Number(row.max_strong_controls),
    marketRelevantArticles: Number(row.market_relevant_articles ?? 0),
    knownMarketRelevanceArticles: Number(row.known_market_relevance_articles ?? 0),
    lowRelevanceArticles: Number(row.low_relevance_articles ?? 0),
    publisherGroups: Number(row.publisher_groups ?? 0),
    qualityFlags,
    promotionEligible: ['E2', 'E3', 'E4'].includes(String(promotedGrade || '').toUpperCase()),
    qualityGate: {
      minControlsRequired: HOT_EVENTS_MIN_PROMOTION_CONTROLS,
      controlsBlocked: asBoolean(row.controls_blocked),
      relevanceBlocked: asBoolean(row.relevance_blocked),
    },
  };
}

const VALID_LANES = ['validated', 'watch', 'noise'];

function normalizeLaneFilter(input) {
  if (input == null) return null;
  if (Array.isArray(input)) return input.map((s) => String(s).toLowerCase()).filter((s) => VALID_LANES.includes(s));
  const tokens = String(input)
    .toLowerCase()
    .split(/[,\s]+/)
    .filter(Boolean);
  if (tokens.includes('all')) return null;
  const valid = tokens.filter((t) => VALID_LANES.includes(t));
  return valid.length ? valid : null;
}

export async function buildHotEventsPayload(pool, {
  limit = HOT_EVENTS_LIMIT,
  lookbackDays = HOT_EVENTS_LOOKBACK_DAYS,
  laneFilter = null,
  themeFilter = null,
} = {}) {
  const client = pool;
  try {
    const haveCanonical = await tableExists(client, 'canonical_events');
    if (!haveCanonical) {
      return {
        ok: true,
        generatedAt: new Date().toISOString(),
        available: false,
        lookbackDays,
        events: [],
        note: 'canonical_events table missing — event engine not initialized',
      };
    }

    const safeLimit = Math.min(25, Math.max(1, Number(limit) || HOT_EVENTS_LIMIT));
    // Widened cap: old 30d cap meant the outcome-window lag (E2 events are ~2-4 weeks
    // behind real-time by design) could never surface. Allow up to 90d so graded events
    // from the outcome-completed zone are visible alongside recent-but-pending items.
    const safeLookback = Math.min(90, Math.max(1, Number(lookbackDays) || HOT_EVENTS_LOOKBACK_DAYS));

    const { rows } = await client.query(
      `
      WITH recent_events AS (
        -- UNION two pools: (a) most recent events by volume, (b) top graded events by |t|
        -- so the 200-row cap doesn't clip out the event_uplift-labeled zone (~2w older).
        --
        -- Filters applied to both pools:
        --   article_count >= 2   excludes singleton arXiv-style entries that are
        --                        publications, not multi-source confirmed events.
        --                        Without this, the volume pool fills with ~500/day
        --                        emerging-tech singletons.
        --   theme NOT LIKE 'dt-%' excludes auto-generated dynamic theme codes
        --                        (hash-named, missing canonical classification).
        (SELECT ce.id, ce.theme, ce.representative_title, ce.event_date,
                COALESCE(ce.article_count, 0) AS article_count,
                COALESCE(ce.source_count, 0)  AS source_count
           FROM canonical_events ce
          WHERE ce.event_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
            AND COALESCE(ce.article_count, 0) >= 2
            AND ce.theme NOT LIKE 'dt-%'
          ORDER BY ce.event_date DESC, ce.article_count DESC NULLS LAST
          LIMIT 120)
        UNION
        (SELECT ce.id, ce.theme, ce.representative_title, ce.event_date,
                COALESCE(ce.article_count, 0) AS article_count,
                COALESCE(ce.source_count, 0)  AS source_count
           FROM canonical_events ce
           JOIN event_uplift eu ON eu.canonical_event_id = ce.id
          WHERE ce.event_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
            AND eu.evidence_grade IN ('E2','E3','E4')
            AND ABS(COALESCE(eu.t_stat, 0)) >= 2
            AND COALESCE(ce.article_count, 0) >= 2
            AND ce.theme NOT LIKE 'dt-%'
          ORDER BY ce.event_date DESC
          LIMIT 80)
      ),
      hawkes AS (
        SELECT theme, event_date,
               MAX(normalized_temperature) AS temperature,
               BOOL_OR(is_surge)           AS is_surge
          FROM event_hawkes_intensity
         WHERE event_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
         GROUP BY theme, event_date
      ),
      article_quality AS (
        SELECT aem.canonical_event_id,
               COUNT(*)::int AS mapped_articles,
               COUNT(DISTINCT COALESCE(NULLIF(a.publisher_group, ''), NULLIF(a.source, '')))::int AS publisher_groups,
               COUNT(*) FILTER (WHERE a.market_relevance IS NOT NULL)::int AS known_market_relevance_articles,
               COUNT(*) FILTER (WHERE a.market_relevance IN ('high', 'medium'))::int AS market_relevant_articles,
               COUNT(*) FILTER (WHERE a.market_relevance = 'low')::int AS low_relevance_articles
          FROM article_event_map aem
          JOIN recent_events re ON re.id = aem.canonical_event_id
          JOIN articles a ON a.id = aem.article_id
         GROUP BY aem.canonical_event_id
      ),
      uplift_agg AS (
        SELECT eu.canonical_event_id,
               MAX(eu.evidence_grade) AS raw_best_grade,
               MAX(eu.evidence_grade) FILTER (
                 WHERE eu.evidence_grade IN ('E2','E3','E4')
                   AND ABS(COALESCE(eu.t_stat, 0)) >= 2
                   AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
               ) AS control_qualified_grade,
               COUNT(*)::int AS uplift_rows,
               COUNT(*) FILTER (
                 WHERE eu.evidence_grade IN ('E2','E3','E4')
                   AND ABS(COALESCE(eu.t_stat, 0)) >= 2
               )::int AS strong_uplift_rows,
               COUNT(*) FILTER (
                 WHERE eu.evidence_grade IN ('E2','E3','E4')
                   AND ABS(COALESCE(eu.t_stat, 0)) >= 2
                   AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
               )::int AS promoted_uplift_rows,
               MAX(ABS(COALESCE(eu.uplift, 0))) AS raw_max_abs_uplift,
               MAX(ABS(COALESCE(eu.t_stat, 0))) AS raw_max_abs_t,
               MAX(ABS(COALESCE(eu.uplift, 0))) FILTER (
                 WHERE eu.evidence_grade IN ('E2','E3','E4')
                   AND ABS(COALESCE(eu.t_stat, 0)) >= 2
                   AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
               ) AS promoted_max_abs_uplift,
               MAX(ABS(COALESCE(eu.t_stat, 0))) FILTER (
                 WHERE eu.evidence_grade IN ('E2','E3','E4')
                   AND ABS(COALESCE(eu.t_stat, 0)) >= 2
                   AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
               ) AS promoted_max_abs_t,
               MIN(NULLIF(eu.n_controls, 0)) FILTER (
                 WHERE eu.evidence_grade IN ('E2','E3','E4')
                   AND ABS(COALESCE(eu.t_stat, 0)) >= 2
               ) AS min_strong_controls,
               MAX(NULLIF(eu.n_controls, 0)) FILTER (
                 WHERE eu.evidence_grade IN ('E2','E3','E4')
                   AND ABS(COALESCE(eu.t_stat, 0)) >= 2
               ) AS max_strong_controls
          FROM event_uplift eu
          JOIN recent_events re ON re.id = eu.canonical_event_id
         GROUP BY eu.canonical_event_id
      ),
      ranked AS (
        SELECT re.id,
               re.theme,
               re.representative_title,
               re.event_date,
               re.article_count,
               re.source_count,
               h.temperature,
               h.is_surge,
               ua.raw_best_grade,
               CASE
                 WHEN ua.control_qualified_grade IS NULL THEN NULL
                 WHEN COALESCE(aq.known_market_relevance_articles, 0) > 0
                  AND COALESCE(aq.market_relevant_articles, 0) = 0
                  AND COALESCE(aq.low_relevance_articles, 0) > 0 THEN NULL
                 ELSE ua.control_qualified_grade
               END AS promoted_grade,
               ua.uplift_rows,
               ua.strong_uplift_rows,
               ua.promoted_uplift_rows,
               ua.raw_max_abs_uplift,
               ua.raw_max_abs_t,
               CASE
                 WHEN ua.control_qualified_grade IS NULL THEN NULL
                 WHEN COALESCE(aq.known_market_relevance_articles, 0) > 0
                  AND COALESCE(aq.market_relevant_articles, 0) = 0
                  AND COALESCE(aq.low_relevance_articles, 0) > 0 THEN NULL
                 ELSE ua.promoted_max_abs_uplift
               END AS rank_abs_uplift,
               CASE
                 WHEN ua.control_qualified_grade IS NULL THEN NULL
                 WHEN COALESCE(aq.known_market_relevance_articles, 0) > 0
                  AND COALESCE(aq.market_relevant_articles, 0) = 0
                  AND COALESCE(aq.low_relevance_articles, 0) > 0 THEN NULL
                 ELSE ua.promoted_max_abs_t
               END AS rank_abs_t,
               ua.min_strong_controls,
               ua.max_strong_controls,
               COALESCE(aq.known_market_relevance_articles, 0) AS known_market_relevance_articles,
               COALESCE(aq.market_relevant_articles, 0) AS market_relevant_articles,
               COALESCE(aq.low_relevance_articles, 0) AS low_relevance_articles,
               COALESCE(aq.publisher_groups, 0) AS publisher_groups,
               (COALESCE(ua.strong_uplift_rows, 0) > 0 AND COALESCE(ua.promoted_uplift_rows, 0) = 0) AS controls_blocked,
               (COALESCE(aq.known_market_relevance_articles, 0) > 0
                AND COALESCE(aq.market_relevant_articles, 0) = 0
                AND COALESCE(aq.low_relevance_articles, 0) > 0) AS relevance_blocked
          FROM recent_events re
          LEFT JOIN hawkes h          ON h.theme = re.theme AND h.event_date = re.event_date
          LEFT JOIN uplift_agg ua     ON ua.canonical_event_id = re.id
          LEFT JOIN article_quality aq ON aq.canonical_event_id = re.id
      )
      SELECT *
        FROM ranked
       ORDER BY
         CASE WHEN promoted_grade IN ('E4','E3') THEN 0
              WHEN promoted_grade IN ('E2','E1') THEN 1
              ELSE 2 END,
         COALESCE(rank_abs_t, 0) DESC,
         COALESCE(temperature, 0) DESC,
         event_date DESC,
         article_count DESC
       LIMIT $1::int
      `,
      // Pull 3x candidates from SQL so JS-side product-score re-ranking has
      // headroom; final slice happens after rankByProductScore (S-Tier §1).
      [safeLimit * 3, safeLookback],
    );

    const normalized = rows.map(normalizeHotEventRow);

    // S-Tier §1 — composite product score replaces Hawkes-temperature-only
    // ordering. Adds productScore + scoreBreakdown + lane to every event so
    // consumers can show the calculation path and split lanes.
    let ranked = rankByProductScore(normalized);
    let allLanedEvents = ranked.map((ev) => ({ ...ev, lane: classifyEventLane(ev) }));

    // S-Tier §2 — optional theme filter for theme-page relevance precision.
    if (themeFilter) {
      const tf = String(themeFilter).toLowerCase();
      allLanedEvents = allLanedEvents.filter((e) => String(e.theme || '').toLowerCase() === tf);
    }

    // S-Tier §2 — caller-controlled lane filter. Default behaviour returns
    // all lanes so consumers can render their own grouping. Pass laneFilter
    // = ['validated'] to surface only validated, etc. Null/missing/'all'
    // returns everything.
    const laneAllowed = normalizeLaneFilter(laneFilter);
    const filtered = laneAllowed
      ? allLanedEvents.filter((e) => laneAllowed.includes(e.lane))
      : allLanedEvents;

    const events = filtered.slice(0, safeLimit);

    const gradeCounts = { E4: 0, E3: 0, E2: 0, E1: 0, E0: 0, none: 0 };
    const laneCounts = { validated: 0, watch: 0, noise: 0 };
    // Aggregate lane counts over ALL ranked candidates (pre-filter) so the
    // dashboard knows e.g. "0 validated / 17 noise" even when the caller
    // requested only validated lane.
    for (const ev of allLanedEvents) {
      const g = ev.bestEvidenceGrade;
      if (g && g in gradeCounts) gradeCounts[g] += 1;
      else gradeCounts.none += 1;
      const lane = ev.lane || 'watch';
      if (lane in laneCounts) laneCounts[lane] += 1;
    }

    // S-Tier §2 — group filtered events by lane for caller convenience.
    // The plan requires Hot Events split into Validated/Emerging Watch/Noise
    // visually distinct lanes.
    const eventsByLane = {
      validated: events.filter((e) => e.lane === 'validated'),
      watch: events.filter((e) => e.lane === 'watch'),
      noise: events.filter((e) => e.lane === 'noise'),
    };

    // S-Tier §3 — empty-state envelope. When events.length === 0 (either
    // because no candidates matched, or because the lane filter excluded
    // everything) the plan requires the response to explain WHY rather
    // than show a blank screen. We surface:
    //   reasons         human-readable strings describing the cause
    //   pendingData     what upstream data was checked
    //   nextCheckpoint  when more data is expected (operational hint)
    //   alternativeObservations  noise-lane / fallback events the user
    //                            can still inspect even though they
    //                            don't qualify as actionable signals
    let emptyState = null;
    if (events.length === 0) {
      const reasons = [];
      const pendingData = [];
      const nextCheckpoint = [];
      let alternativeObservations = [];

      if (laneAllowed && allLanedEvents.length > 0) {
        // Filter excluded everything — surface what's outside the requested lane.
        reasons.push(
          `No events in lane(s) [${laneAllowed.join(', ')}] for the current window. ${allLanedEvents.length} candidate event(s) exist but they fall in other lane(s).`,
        );
        const otherLanes = allLanedEvents.filter((e) => !laneAllowed.includes(e.lane));
        if (otherLanes.length > 0) {
          alternativeObservations = otherLanes.slice(0, 5).map((e) => ({
            id: e.id,
            theme: e.theme,
            lane: e.lane,
            title: e.title,
            eventDate: e.eventDate,
            productScore: e.productScore,
            scoreBreakdown: e.scoreBreakdown,
          }));
        }
      } else if (themeFilter && allLanedEvents.length === 0) {
        reasons.push(`No events for theme "${themeFilter}" in the last ${safeLookback} days.`);
        pendingData.push('canonical_events table for this theme');
        pendingData.push('article_event_map links');
        nextCheckpoint.push('Check that articles for this theme are being ingested. Try a wider lookback (?lookback=30) or remove the theme filter.');
      } else if (allLanedEvents.length === 0) {
        reasons.push(`No canonical events with article_count >= 2 in the last ${safeLookback} days.`);
        pendingData.push('canonical_events / article_event_map');
        nextCheckpoint.push('Check daemon: incremental-event-engine and meta-model-infer should have produced rows.');
      } else {
        // allLanedEvents > 0 but events == 0 after slicing/filtering — shouldn't
        // happen after the slice but cover the case.
        reasons.push('All ranked candidates were filtered out by the requested constraints.');
      }

      // For ALL empty results, also surface noise-lane items as observable
      // alternatives — plan says "검증 신호 없음, 대신 볼 만한 관찰 항목".
      if (alternativeObservations.length === 0 && eventsByLane.noise.length > 0) {
        alternativeObservations = eventsByLane.noise.slice(0, 5).map((e) => ({
          id: e.id,
          theme: e.theme,
          lane: e.lane,
          title: e.title,
          eventDate: e.eventDate,
          productScore: e.productScore,
          scoreBreakdown: e.scoreBreakdown,
        }));
      }

      emptyState = {
        reasons,
        pendingData,
        nextCheckpoint,
        alternativeObservations,
        laneCounts,
        totalCandidates: allLanedEvents.length,
      };
    }

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      available: true,
      lookbackDays: safeLookback,
      limit: safeLimit,
      qualityGate: {
        minControlsRequired: HOT_EVENTS_MIN_PROMOTION_CONTROLS,
        note: 'Raw E2/E3/E4 grades are promoted only when the uplift row has enough matched controls and is not market-relevance blocked.',
      },
      ranking: {
        method: 'product-score',
        components: ['themeRelevance', 'evidenceWeight', 'freshnessWeight', 'sourceCredibility', 'impactWeight', 'duplicatePenalty'],
        note: 'Each event includes productScore (0..1) and scoreBreakdown.components/rationale.',
      },
      filters: {
        lane: laneAllowed,
        theme: themeFilter || null,
      },
      totalReturned: events.length,
      totalCandidates: allLanedEvents.length,
      gradeCounts,
      laneCounts,
      eventsByLane,
      emptyState,
      surgeCount: events.filter((e) => e.isSurge).length,
      events,
    };
  } catch (err) {
    throw err;
  }
}

/* ===================== get_meta_model_health ===================== */

export async function buildMetaModelHealthPayload(pool) {
  const client = pool;
  try {
    const haveEval = await tableExists(client, 'model_eval');
    const havePredictions = await tableExists(client, 'model_predictions');
    const haveModelRegistry = await tableExists(client, 'model_registry');

    let activeModel = null;
    if (haveModelRegistry) {
      const registry = await client.query(`
        SELECT model_key, model_version, target_signal, feature_set_hash, promotion_state,
               train_window_start, train_window_end, eval_summary, promoted_at, created_at
          FROM model_registry
         WHERE promotion_state = 'active'
         ORDER BY promoted_at DESC NULLS LAST, created_at DESC NULLS LAST
         LIMIT 1
      `).catch(() => null);
      const row = registry?.rows?.[0] || null;
      if (row) {
        activeModel = {
          modelKey: row.model_key,
          modelVersion: row.model_version,
          targetSignal: row.target_signal,
          featureSetHash: row.feature_set_hash,
          promotionState: row.promotion_state,
          trainWindowStart: row.train_window_start,
          trainWindowEnd: row.train_window_end,
          evalSummary: row.eval_summary || null,
          promotedAt: row.promoted_at,
          createdAt: row.created_at,
        };
      }
    }

    let latestEval = null;
    let evalHistory = [];
    if (haveEval) {
      const { rows } = await client.query(`
        SELECT model_version, eval_date, brier_score, ece, log_loss, n_samples,
               deflated_sharpe, top20_precision, alpha_hit_rate, split_type
          FROM model_eval
         ORDER BY eval_date DESC, model_version DESC, split_type ASC
         LIMIT 8
      `);
      evalHistory = rows.map((r) => ({
        modelVersion: r.model_version,
        evalDate: r.eval_date,
        splitType: r.split_type ?? null,
        brierScore: r.brier_score == null ? null : Number(r.brier_score),
        ece: r.ece == null ? null : Number(r.ece),
        logLoss: r.log_loss == null ? null : Number(r.log_loss),
        sampleCount: r.n_samples == null ? null : Number(r.n_samples),
        deflatedSharpe: r.deflated_sharpe == null ? null : Number(r.deflated_sharpe),
        top20Precision: r.top20_precision == null ? null : Number(r.top20_precision),
        alphaHitRate: r.alpha_hit_rate == null ? null : Number(r.alpha_hit_rate),
      }));
      const aggregate = await client.query(`
        WITH target_model AS (
          SELECT COALESCE(
            $1::text,
            (SELECT model_version FROM model_eval ORDER BY eval_date DESC, model_version DESC LIMIT 1)
          ) AS model_version
        )
        SELECT me.model_version,
               MAX(me.eval_date) AS eval_date,
               COUNT(*)::int AS split_count,
               AVG(me.brier_score) AS brier_score,
               MAX(me.brier_score) AS worst_brier_score,
               AVG(me.ece) AS ece,
               MAX(me.ece) AS worst_ece,
               AVG(me.log_loss) AS log_loss,
               SUM(me.n_samples)::int AS n_samples,
               AVG(me.deflated_sharpe) AS deflated_sharpe,
               AVG(me.top20_precision) AS top20_precision,
               AVG(me.alpha_hit_rate) AS alpha_hit_rate
          FROM model_eval me
          JOIN target_model tm ON tm.model_version = me.model_version
         GROUP BY me.model_version
      `, [activeModel?.modelVersion || null]).catch(() => null);
      const agg = aggregate?.rows?.[0] || null;
      latestEval = agg ? {
        modelVersion: agg.model_version,
        evalDate: agg.eval_date,
        splitType: 'purged_wf_aggregate',
        splitCount: Number(agg.split_count ?? 0),
        brierScore: agg.brier_score == null ? null : Number(agg.brier_score),
        worstBrierScore: agg.worst_brier_score == null ? null : Number(agg.worst_brier_score),
        ece: agg.ece == null ? null : Number(agg.ece),
        worstEce: agg.worst_ece == null ? null : Number(agg.worst_ece),
        logLoss: agg.log_loss == null ? null : Number(agg.log_loss),
        sampleCount: agg.n_samples == null ? null : Number(agg.n_samples),
        deflatedSharpe: agg.deflated_sharpe == null ? null : Number(agg.deflated_sharpe),
        top20Precision: agg.top20_precision == null ? null : Number(agg.top20_precision),
        alphaHitRate: agg.alpha_hit_rate == null ? null : Number(agg.alpha_hit_rate),
      } : (evalHistory[0] ?? null);
    }

    let recentPredictions = null;
    let activeModelVersions = [];
    let pipelineFreshness = null;
    let symbolCoverage = null;
    if (havePredictions) {
      const counts = await client.query(
        `
        SELECT COUNT(*)::int AS total,
               COUNT(DISTINCT mp.model_version)::int AS model_versions,
               COUNT(*) FILTER (
                 WHERE mp.created_at > now() - ($1 || ' hours')::interval
               )::int AS recent_created,
               COUNT(*) FILTER (
                 WHERE ce.event_date >= NOW()::date - INTERVAL '1 day'
               )::int AS recent_event_predictions,
               MAX(ce.event_date) AS latest_predicted_event_date,
               to_char(MAX(ce.event_date), 'YYYY-MM-DD') AS latest_predicted_event_date_key,
               (
                 SELECT MAX(a.published_at)
                   FROM (SELECT DISTINCT canonical_event_id FROM model_predictions) pe
                   JOIN article_event_map aem ON aem.canonical_event_id = pe.canonical_event_id
                   JOIN articles a ON a.id = aem.article_id
               ) AS latest_predicted_article_at,
               (
                 SELECT to_char(MAX(a.published_at)::date, 'YYYY-MM-DD')
                   FROM (SELECT DISTINCT canonical_event_id FROM model_predictions) pe
                   JOIN article_event_map aem ON aem.canonical_event_id = pe.canonical_event_id
                   JOIN articles a ON a.id = aem.article_id
               ) AS latest_predicted_article_date_key
          FROM model_predictions mp
          LEFT JOIN canonical_events ce ON ce.id = mp.canonical_event_id
        `,
        [String(META_MODEL_RECENT_HOURS)],
      ).catch(() => null);
      if (counts) {
        recentPredictions = {
          total: counts.rows[0]?.total ?? 0,
          modelVersions: counts.rows[0]?.model_versions ?? 0,
          recentWindowHours: META_MODEL_RECENT_HOURS,
          recentCount: counts.rows[0]?.recent_created ?? 0,
          recentCreatedCount: counts.rows[0]?.recent_created ?? 0,
          recentEventPredictionCount: counts.rows[0]?.recent_event_predictions ?? 0,
          latestPredictedEventDate: counts.rows[0]?.latest_predicted_event_date ?? null,
          latestPredictedEventDateKey: counts.rows[0]?.latest_predicted_event_date_key ?? null,
          latestPredictedArticleAt: counts.rows[0]?.latest_predicted_article_at ?? null,
          latestPredictedArticleDateKey: counts.rows[0]?.latest_predicted_article_date_key ?? null,
          countBasis: 'created_at',
        };
      }
      const versions = await client.query(`
        SELECT model_version, COUNT(*)::int AS n, MAX(created_at) AS latest
          FROM model_predictions
         GROUP BY model_version
         ORDER BY latest DESC NULLS LAST
         LIMIT 5
      `).catch(() => null);
      if (versions) {
        activeModelVersions = versions.rows.map((r) => ({
          modelVersion: r.model_version,
          predictionCount: Number(r.n ?? 0),
          latestAt: r.latest,
        }));
      }
    }

    const [
      haveArticles,
      haveCanonicalEvents,
      haveEventFeatures,
      haveAutoThemeSymbols,
    ] = await Promise.all([
      tableExists(client, 'articles'),
      tableExists(client, 'canonical_events'),
      tableExists(client, 'event_features'),
      tableExists(client, 'auto_theme_symbols'),
    ]).catch(() => [false, false, false, false]);

    if (haveArticles && haveCanonicalEvents && haveEventFeatures) {
      const freshness = await client.query(`
        SELECT
          (SELECT MAX(published_at) FROM articles) AS latest_article_at,
          (SELECT to_char(MAX(published_at)::date, 'YYYY-MM-DD') FROM articles) AS latest_article_date_key,
          (SELECT COUNT(*)::int FROM articles WHERE published_at > NOW() - INTERVAL '24 hours') AS articles_24h,
          (SELECT MAX(event_date) FROM canonical_events) AS latest_event_date,
          (SELECT COUNT(*)::int FROM canonical_events WHERE event_date > NOW() - INTERVAL '24 hours') AS events_24h,
          (
            SELECT MAX(ce.event_date)
              FROM event_features ef
              JOIN canonical_events ce ON ce.id = ef.canonical_event_id
          ) AS latest_feature_event_date,
          (
            SELECT to_char(MAX(ce.event_date), 'YYYY-MM-DD')
              FROM event_features ef
              JOIN canonical_events ce ON ce.id = ef.canonical_event_id
          ) AS latest_feature_event_date_key,
          (
            SELECT MAX(a.published_at)
              FROM event_features ef
              JOIN article_event_map aem ON aem.canonical_event_id = ef.canonical_event_id
              JOIN articles a ON a.id = aem.article_id
          ) AS latest_feature_article_at,
          (
            SELECT to_char(MAX(a.published_at)::date, 'YYYY-MM-DD')
              FROM event_features ef
              JOIN article_event_map aem ON aem.canonical_event_id = ef.canonical_event_id
              JOIN articles a ON a.id = aem.article_id
          ) AS latest_feature_article_date_key,
          (
            SELECT COUNT(*)::int
              FROM event_features ef
              JOIN canonical_events ce ON ce.id = ef.canonical_event_id
             WHERE ce.event_date > NOW() - INTERVAL '24 hours'
          ) AS feature_events_24h,
          (
            SELECT COUNT(*)::int
              FROM canonical_events ce
              JOIN event_features ef ON ef.canonical_event_id = ce.id
             WHERE ce.event_date >= NOW()::date - INTERVAL '14 days'
               AND (
                 COALESCE(ce.source_count, -1) <> COALESCE(ef.source_count, -1)
                 OR COALESCE(ce.article_count, -1) <> COALESCE(ef.article_count, -1)
                 OR ABS(COALESCE(ce.source_diversity, -1) - COALESCE(ef.source_diversity, -1)) > 0.0001
               )
          ) AS feature_stale_event_count
      `).catch(() => null);
      const row = freshness?.rows?.[0] || null;
      if (row) {
        const latestArticleAt = row.latest_article_at ? new Date(row.latest_article_at) : null;
        const latestFeatureArticleAt = row.latest_feature_article_at
          ? new Date(row.latest_feature_article_at)
          : (row.latest_feature_event_date ? new Date(row.latest_feature_event_date) : null);
        const featureLagHours = latestArticleAt && latestFeatureArticleAt
          ? Math.max(0, (latestArticleAt.getTime() - latestFeatureArticleAt.getTime()) / 3_600_000)
          : null;
        const featureDateKey = row.latest_feature_article_date_key || row.latest_feature_event_date_key;
        const featureLagDays = row.latest_article_date_key && featureDateKey
          ? Math.max(
            0,
            (Date.parse(`${row.latest_article_date_key}T00:00:00Z`) - Date.parse(`${featureDateKey}T00:00:00Z`)) / 86_400_000,
          )
          : null;
        pipelineFreshness = {
          latestArticleAt: row.latest_article_at,
          latestArticleDateKey: row.latest_article_date_key,
          articles24h: Number(row.articles_24h ?? 0),
          latestEventDate: row.latest_event_date,
          events24h: Number(row.events_24h ?? 0),
          latestFeatureEventDate: row.latest_feature_event_date,
          latestFeatureEventDateKey: row.latest_feature_event_date_key,
          latestFeatureArticleAt: row.latest_feature_article_at,
          latestFeatureArticleDateKey: row.latest_feature_article_date_key,
          featureEvents24h: Number(row.feature_events_24h ?? 0),
          featureStaleEventCount: Number(row.feature_stale_event_count ?? 0),
          featureLagHours,
          featureLagDays,
        };
      }
    }

    if (pipelineFreshness && recentPredictions) {
      const latestArticleAt = pipelineFreshness.latestArticleAt ? new Date(pipelineFreshness.latestArticleAt) : null;
      const latestPredictedArticleAt = recentPredictions.latestPredictedArticleAt ? new Date(recentPredictions.latestPredictedArticleAt) : null;
      const predictionLagHours = latestArticleAt && latestPredictedArticleAt
        ? Math.max(0, (latestArticleAt.getTime() - latestPredictedArticleAt.getTime()) / 3_600_000)
        : null;
      const predictionLagDays = pipelineFreshness.latestArticleDateKey && recentPredictions.latestPredictedArticleDateKey
        ? Math.max(
          0,
          (Date.parse(`${pipelineFreshness.latestArticleDateKey}T00:00:00Z`) - Date.parse(`${recentPredictions.latestPredictedArticleDateKey}T00:00:00Z`)) / 86_400_000,
        )
        : null;
      pipelineFreshness.latestPredictedEventDate = recentPredictions.latestPredictedEventDate;
      pipelineFreshness.latestPredictedEventDateKey = recentPredictions.latestPredictedEventDateKey;
      pipelineFreshness.latestPredictedArticleAt = recentPredictions.latestPredictedArticleAt;
      pipelineFreshness.latestPredictedArticleDateKey = recentPredictions.latestPredictedArticleDateKey;
      pipelineFreshness.recentPredictionCount = recentPredictions.recentCount;
      pipelineFreshness.recentEventPredictionCount = recentPredictions.recentEventPredictionCount;
      pipelineFreshness.predictionLagHours = predictionLagHours;
      pipelineFreshness.predictionLagDays = predictionLagDays;
    }

    if (pipelineFreshness && havePredictions && haveEventFeatures && haveCanonicalEvents) {
      const activeModelVersion = activeModel?.modelVersion || latestEval?.modelVersion || null;
      const stalePredictions = await client.query(`
        WITH current_universe AS (
          SELECT ce.id AS canonical_event_id, ats.symbol, h.horizon
            FROM canonical_events ce
            CROSS JOIN (VALUES ('1w'), ('2w'), ('1m')) h(horizon)
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
           WHERE ce.event_date >= NOW()::date - INTERVAL '14 days'
        )
        SELECT COUNT(*)::int AS stale_prediction_count
          FROM model_predictions mp
          JOIN event_features ef ON ef.canonical_event_id = mp.canonical_event_id
          JOIN current_universe cu
            ON cu.canonical_event_id = mp.canonical_event_id
           AND cu.symbol = mp.symbol
           AND cu.horizon = mp.horizon
         WHERE mp.model_version = $1
           AND ef.computed_at > mp.created_at
      `, [activeModelVersion]).catch(() => null);
      pipelineFreshness.predictionStaleCount = Number(stalePredictions?.rows?.[0]?.stale_prediction_count ?? 0);
    } else if (pipelineFreshness) {
      pipelineFreshness.predictionStaleCount = null;
    }

    if (haveCanonicalEvents && haveAutoThemeSymbols) {
      const coverage = await client.query(`
        WITH recent_themes AS (
          SELECT DISTINCT theme
            FROM canonical_events
           WHERE event_date >= NOW() - INTERVAL '7 days'
             AND theme IS NOT NULL
             AND theme <> 'unknown'
        ),
        theme_status AS (
          SELECT rt.theme,
                 EXISTS (
                   SELECT 1 FROM auto_theme_symbols ats WHERE ats.theme = rt.theme
                 ) AS has_symbols
            FROM recent_themes rt
        )
        SELECT COUNT(*)::int AS theme_count,
               COUNT(*) FILTER (WHERE has_symbols)::int AS covered_theme_count,
               COALESCE(
                 ARRAY_AGG(theme ORDER BY theme) FILTER (WHERE NOT has_symbols),
                 ARRAY[]::text[]
               ) AS missing_themes
          FROM theme_status
      `).catch(() => null);
      const row = coverage?.rows?.[0] || null;
      if (row) {
        const themeCount = Number(row.theme_count ?? 0);
        const coveredThemeCount = Number(row.covered_theme_count ?? 0);
        symbolCoverage = {
          lookbackDays: 7,
          themeCount,
          coveredThemeCount,
          coveragePct: themeCount > 0 ? coveredThemeCount / themeCount : 1,
          missingThemes: Array.isArray(row.missing_themes) ? row.missing_themes.slice(0, 12) : [],
        };
      }
    }

    const calibration = await loadMetaModelCalibrationSidecar(activeModel?.modelVersion || latestEval?.modelVersion);
    const trust = evaluateMetaModelTrust({
      hasEval: haveEval,
      hasPredictions: havePredictions,
      latestEval,
      recentPredictions,
      pipelineFreshness,
      symbolCoverage,
      calibration,
    });

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      summary: {
        level: trust.level,
        healthStatus: trust.healthStatus,
        hasEvalTable: haveEval,
        hasPredictionsTable: havePredictions,
        activeModel,
        latestEval,
        calibration,
        effectiveMetrics: trust.effectiveMetrics,
        promotionGates: trust.gates,
        recentPredictions,
        pipelineFreshness,
        symbolCoverage,
        notes: trust.notes,
        recommendedActions: trust.recommendedActions,
      },
      evalHistory,
      activeModelVersions,
    };
  } catch (err) {
    throw err;
  }
}

/* ===================== explain_event ===================== */

export async function buildExplainEventPayload(pool, { eventId }) {
  const id = Number(eventId);
  if (!Number.isFinite(id) || id < 1) {
    return { ok: false, error: 'eventId required (positive integer)' };
  }

  const client = pool;
  try {
    const eventRes = await client.query(
      `
      SELECT id, theme, representative_title, event_date,
             COALESCE(article_count, 0)::int AS article_count,
             COALESCE(source_count, 0)::int  AS source_count,
             created_at
        FROM canonical_events
       WHERE id = $1
      `,
      [id],
    );
    if (!eventRes.rows.length) {
      return { ok: false, error: `event ${id} not found` };
    }
    const event = eventRes.rows[0];

    const [articlesRes, upliftRes, controlsRes, hawkesRes] = await Promise.all([
      client.query(
        `
        SELECT a.id, a.title, a.source, a.published_at, a.url
          FROM article_event_map aem
          JOIN articles a ON a.id = aem.article_id
         WHERE aem.canonical_event_id = $1
         ORDER BY a.published_at DESC NULLS LAST
         LIMIT $2
        `,
        [id, EXPLAIN_EVENT_ARTICLE_LIMIT],
      ).catch(() => ({ rows: [] })),
      client.query(
        `
        WITH article_quality AS (
          SELECT aem.canonical_event_id,
                 COUNT(*) FILTER (WHERE a.market_relevance IS NOT NULL)::int AS known_market_relevance_articles,
                 COUNT(*) FILTER (WHERE a.market_relevance IN ('high', 'medium'))::int AS market_relevant_articles,
                 COUNT(*) FILTER (WHERE a.market_relevance = 'low')::int AS low_relevance_articles
            FROM article_event_map aem
            JOIN articles a ON a.id = aem.article_id
           WHERE aem.canonical_event_id = $1
           GROUP BY aem.canonical_event_id
        )
        SELECT eu.symbol, eu.horizon, eu.uplift, eu.t_stat,
               eu.evidence_grade AS raw_evidence_grade,
               CASE
                 WHEN eu.evidence_grade IN ('E2','E3','E4')
                  AND (
                    ABS(COALESCE(eu.t_stat, 0)) < 2
                    OR COALESCE(eu.n_controls, 0) < ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
                    OR (
                      COALESCE(aq.known_market_relevance_articles, 0) > 0
                      AND COALESCE(aq.market_relevant_articles, 0) = 0
                      AND COALESCE(aq.low_relevance_articles, 0) > 0
                    )
                  ) THEN NULL
                 ELSE eu.evidence_grade
               END AS promoted_grade,
               eu.event_alpha, eu.control_avg_return, eu.n_controls,
               COALESCE(aq.known_market_relevance_articles, 0) AS known_market_relevance_articles,
               COALESCE(aq.market_relevant_articles, 0) AS market_relevant_articles,
               COALESCE(aq.low_relevance_articles, 0) AS low_relevance_articles,
               (
                 eu.evidence_grade IN ('E2','E3','E4')
                 AND COALESCE(eu.n_controls, 0) < ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
               ) AS controls_blocked,
               (
                 eu.evidence_grade IN ('E2','E3','E4')
                 AND COALESCE(aq.known_market_relevance_articles, 0) > 0
                 AND COALESCE(aq.market_relevant_articles, 0) = 0
                 AND COALESCE(aq.low_relevance_articles, 0) > 0
               ) AS relevance_blocked
          FROM event_uplift eu
          LEFT JOIN article_quality aq ON aq.canonical_event_id = eu.canonical_event_id
         WHERE eu.canonical_event_id = $1
         ORDER BY ABS(COALESCE(eu.t_stat, 0)) DESC NULLS LAST,
                  ABS(COALESCE(eu.uplift, 0)) DESC NULLS LAST
         LIMIT $2
        `,
        [id, EXPLAIN_EVENT_SYMBOL_LIMIT],
      ).catch(() => ({ rows: [] })),
      client.query(
        `
        SELECT control_date, match_distance,
               (vix_event - vix_control)                 AS vix_delta,
               (yield_spread_event - yield_spread_control) AS yield_delta,
               regime_event, regime_control
          FROM matched_controls
         WHERE canonical_event_id = $1
         ORDER BY control_date
         LIMIT 10
        `,
        [id],
      ).catch(() => ({ rows: [] })),
      client.query(
        `
        SELECT theme, event_date, normalized_temperature, is_surge, article_count
          FROM event_hawkes_intensity
         WHERE theme = $1 AND event_date = $2
         LIMIT 1
        `,
        [event.theme, event.event_date],
      ).catch(() => ({ rows: [] })),
    ]);

    const sourceSet = new Set(
      articlesRes.rows.map((a) => String(a.source || '')).filter(Boolean),
    );

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      event: {
        id: Number(event.id),
        theme: event.theme,
        title: event.representative_title,
        eventDate: event.event_date,
        articleCount: event.article_count,
        sourceCount: event.source_count,
        sampledSourceDiversity: sourceSet.size,
        createdAt: event.created_at,
      },
      hawkes: hawkesRes.rows[0]
        ? {
            temperature: hawkesRes.rows[0].normalized_temperature == null
              ? null
              : Number(hawkesRes.rows[0].normalized_temperature),
            isSurge: Boolean(hawkesRes.rows[0].is_surge),
            articleCount: Number(hawkesRes.rows[0].article_count ?? 0),
          }
        : null,
      articles: articlesRes.rows.map((a) => ({
        id: Number(a.id),
        title: a.title,
        sourceId: a.source,
        publishedAt: a.published_at,
        url: a.url,
      })),
      uplift: upliftRes.rows.map((u) => ({
        ...(() => {
          const qualityFlags = buildHotEventQualityFlags({
            raw_evidence_grade: u.raw_evidence_grade,
            promoted_grade: u.promoted_grade,
            controls_blocked: u.controls_blocked,
            relevance_blocked: u.relevance_blocked,
            article_count: event.article_count,
            source_count: event.source_count,
          });
          return {
            rawEvidenceGrade: u.raw_evidence_grade,
            evidenceGrade: u.promoted_grade,
            qualityFlags,
            promotionEligible: ['E2', 'E3', 'E4'].includes(String(u.promoted_grade || '').toUpperCase()),
            qualityGate: {
              minControlsRequired: HOT_EVENTS_MIN_PROMOTION_CONTROLS,
              controlsBlocked: asBoolean(u.controls_blocked),
              relevanceBlocked: asBoolean(u.relevance_blocked),
            },
          };
        })(),
        symbol: u.symbol,
        horizon: u.horizon,
        uplift: u.uplift == null ? null : Number(u.uplift),
        tStat: u.t_stat == null ? null : Number(u.t_stat),
        eventAlphaMean: u.event_alpha == null ? null : Number(u.event_alpha),
        controlAlphaMean: u.control_avg_return == null ? null : Number(u.control_avg_return),
        nControls: u.n_controls == null ? null : Number(u.n_controls),
        marketRelevantArticles: Number(u.market_relevant_articles ?? 0),
        knownMarketRelevanceArticles: Number(u.known_market_relevance_articles ?? 0),
        lowRelevanceArticles: Number(u.low_relevance_articles ?? 0),
      })),
      controls: controlsRes.rows.map((c) => ({
        controlDate: c.control_date,
        matchDistance: c.match_distance == null ? null : Number(c.match_distance),
        vixDelta: c.vix_delta == null ? null : Number(c.vix_delta),
        yieldSpreadDelta: c.yield_delta == null ? null : Number(c.yield_delta),
        regimeEvent: c.regime_event ?? null,
        regimeControl: c.regime_control ?? null,
      })),
    };
  } catch (err) {
    throw err;
  }
}

/* ===================== get_source_diversity_audit ===================== */

export async function buildSourceDiversityAuditPayload(pool, { windowHours = SOURCE_DIVERSITY_WINDOW_HOURS } = {}) {
  const client = pool;
  try {
    const haveArticles = await tableExists(client, 'articles');
    if (!haveArticles) {
      return {
        ok: true,
        generatedAt: new Date().toISOString(),
        available: false,
        windowHours,
        sources: [],
        note: 'articles table missing',
      };
    }

    const safeWindow = Math.min(168, Math.max(1, Number(windowHours) || SOURCE_DIVERSITY_WINDOW_HOURS));

    const { rows } = await client.query(
      `
      SELECT COALESCE(NULLIF(source, ''), '(unknown)') AS source_id,
             COUNT(*)::int AS article_count
        FROM articles
       WHERE published_at > now() - ($1 || ' hours')::interval
       GROUP BY source
       ORDER BY article_count DESC
       LIMIT $2
      `,
      [String(safeWindow), SOURCE_DIVERSITY_TOP_LIMIT],
    );

    const totalRes = await client.query(
      `
      SELECT COUNT(*)::int AS total
        FROM articles
       WHERE published_at > now() - ($1 || ' hours')::interval
      `,
      [String(safeWindow)],
    );
    const total = totalRes.rows[0]?.total ?? 0;

    const SYNDICATOR_PATTERNS = [/google.?news/i, /iheart/i, /msn\b/i, /yahoo.?news/i, /feedburner/i];
    const sources = rows.map((r) => {
      const share = total > 0 ? r.article_count / total : 0;
      const syndicator = SYNDICATOR_PATTERNS.some((re) => re.test(String(r.source_id)));
      let flag = null;
      if (share >= SOURCE_DOMINANCE_CRITICAL_PCT) flag = 'critical';
      else if (share >= SOURCE_DOMINANCE_WARN_PCT) flag = 'warning';
      return {
        sourceId: r.source_id,
        articleCount: Number(r.article_count),
        share,
        isSyndicator: syndicator,
        flag,
      };
    });

    let level = 'ok';
    if (sources.some((s) => s.flag === 'critical')) level = 'critical';
    else if (sources.some((s) => s.flag === 'warning')) level = 'warning';

    const syndicatorShare = sources
      .filter((s) => s.isSyndicator)
      .reduce((acc, s) => acc + s.share, 0);
    if (syndicatorShare >= 0.25 && level === 'ok') level = 'warning';

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      available: true,
      windowHours: safeWindow,
      totalArticles: total,
      distinctSources: sources.length,
      topSourceShare: sources[0]?.share ?? 0,
      syndicatorShare,
      level,
      sources,
    };
  } catch (err) {
    throw err;
  }
}

/* ===================== get_theme_impact ===================== */

export async function buildThemeImpactPayload(pool, { theme, horizon = null, symbolLimit = 12 } = {}) {
  const t = String(theme || '').trim().toLowerCase();
  if (!t) return { ok: false, error: 'theme required' };
  const safeLimit = Math.min(30, Math.max(1, Number(symbolLimit) || 12));
  const horizonFilter = horizon ? String(horizon).trim() : null;

  const [haveSens, haveRegime, haveCond, haveAuto] = await Promise.all([
    tableExists(pool, 'stock_sensitivity_matrix'),
    tableExists(pool, 'regime_conditional_impact'),
    tableExists(pool, 'conditional_sensitivity'),
    tableExists(pool, 'auto_theme_symbols'),
  ]);

  const [sens, regime, conds, auto] = await Promise.all([
    haveSens
      ? pool.query(
          `
          SELECT symbol, horizon, sample_size, avg_return, hit_rate, return_vol,
                 sensitivity_zscore, baseline_return, baseline_vol, interpretation
            FROM stock_sensitivity_matrix
           WHERE LOWER(theme) = $1
             AND ($2::text IS NULL OR horizon = $2)
           ORDER BY ABS(COALESCE(sensitivity_zscore, 0)) DESC NULLS LAST,
                    sample_size DESC
           LIMIT $3
          `,
          [t, horizonFilter, safeLimit],
        ).catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] }),
    haveRegime
      ? pool.query(
          `
          SELECT symbol, horizon, regime, sample_size,
                 avg_return, hit_rate, avg_abs_return, regime_multiplier, anomaly_rate
            FROM regime_conditional_impact
           WHERE LOWER(theme) = $1
             AND ($2::text IS NULL OR horizon = $2)
           ORDER BY ABS(COALESCE(regime_multiplier, 0)) DESC NULLS LAST,
                    sample_size DESC
           LIMIT $3
          `,
          [t, horizonFilter, safeLimit * 2],
        ).catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] }),
    haveCond
      ? pool.query(
          `
          SELECT symbol, horizon, condition_type, condition_value,
                 avg_return, hit_rate, avg_abs_return, sample_size
            FROM conditional_sensitivity
           WHERE LOWER(theme) = $1
             AND ($2::text IS NULL OR horizon = $2)
           ORDER BY sample_size DESC
           LIMIT $3
          `,
          [t, horizonFilter, safeLimit * 3],
        ).catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] }),
    haveAuto
      ? pool.query(
          `
          SELECT symbol, avg_abs_reaction, reaction_count, correlation, method,
                 quality_score, directional_edge, outcome_hit_rate, outcome_avg_return
            FROM auto_theme_symbols
           WHERE LOWER(theme) = $1
           ORDER BY COALESCE(quality_score, 0) DESC NULLS LAST,
                    reaction_count DESC
           LIMIT $2
          `,
          [t, safeLimit],
        ).catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] }),
  ]);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    theme: t,
    horizon: horizonFilter,
    sensitivityAvailable: haveSens,
    regimeAvailable: haveRegime,
    conditionalAvailable: haveCond,
    autoMappingAvailable: haveAuto,
    sensitivity: sens.rows.map((r) => ({
      symbol: r.symbol,
      horizon: r.horizon,
      sampleSize: Number(r.sample_size ?? 0),
      avgReturn: r.avg_return == null ? null : Number(r.avg_return),
      hitRate: r.hit_rate == null ? null : Number(r.hit_rate),
      returnVol: r.return_vol == null ? null : Number(r.return_vol),
      sensitivityZScore: r.sensitivity_zscore == null ? null : Number(r.sensitivity_zscore),
      baselineReturn: r.baseline_return == null ? null : Number(r.baseline_return),
      baselineVol: r.baseline_vol == null ? null : Number(r.baseline_vol),
      interpretation: r.interpretation,
    })),
    regime: regime.rows.map((r) => ({
      symbol: r.symbol,
      horizon: r.horizon,
      regime: r.regime,
      sampleSize: Number(r.sample_size ?? 0),
      avgReturn: r.avg_return == null ? null : Number(r.avg_return),
      hitRate: r.hit_rate == null ? null : Number(r.hit_rate),
      regimeMultiplier: r.regime_multiplier == null ? null : Number(r.regime_multiplier),
      anomalyRate: r.anomaly_rate == null ? null : Number(r.anomaly_rate),
    })),
    conditional: conds.rows.map((r) => ({
      symbol: r.symbol,
      horizon: r.horizon,
      conditionType: r.condition_type,
      conditionValue: r.condition_value,
      avgReturn: r.avg_return == null ? null : Number(r.avg_return),
      hitRate: r.hit_rate == null ? null : Number(r.hit_rate),
      sampleSize: Number(r.sample_size ?? 0),
    })),
    autoMapping: auto.rows.map((r) => ({
      symbol: r.symbol,
      avgAbsReaction: r.avg_abs_reaction == null ? null : Number(r.avg_abs_reaction),
      reactionCount: Number(r.reaction_count ?? 0),
      correlation: r.correlation == null ? null : Number(r.correlation),
      method: r.method,
      qualityScore: r.quality_score == null ? null : Number(r.quality_score),
      directionalEdge: r.directional_edge == null ? null : Number(r.directional_edge),
      outcomeHitRate: r.outcome_hit_rate == null ? null : Number(r.outcome_hit_rate),
      outcomeAvgReturn: r.outcome_avg_return == null ? null : Number(r.outcome_avg_return),
    })),
  };
}

export const _internals = {
  HOT_EVENTS_LIMIT,
  HOT_EVENTS_LOOKBACK_DAYS,
  SOURCE_DOMINANCE_WARN_PCT,
  SOURCE_DOMINANCE_CRITICAL_PCT,
  META_MODEL_RECENT_HOURS,
};
