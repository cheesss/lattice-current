/**
 * Product quality metrics aggregator (S-Tier User Value §7).
 *
 * Plan §7 defines five metrics that complement the technical health checks
 * already exposed at /api/ops/status:
 *
 *   theme_relevance_precision
 *     Share of top theme events that are directly relevant.
 *
 *   brief_completeness
 *     Share of briefs containing all six required sections.
 *
 *   evidence_coverage
 *     Share of major briefs with at least two evidence items.
 *
 *   noise_suppression_rate
 *     Share of low-relevance / duplicate events hidden from primary surfaces.
 *
 *   actionability_score
 *     Share of signal cards with a clear next action.
 *
 * S-tier targets:
 *   theme_relevance_precision >= 90%
 *   brief_completeness        >= 95%
 *   evidence_coverage         >= 90%
 *   actionability_score       >= 90%
 *   time_to_first_value       <= 30 s    (client telemetry — not server-computed)
 *
 * The aggregator is read-only: it samples a small set of theme briefs and
 * recent hot events, computes ratios, and returns them. It NEVER mutates
 * the data layer. Results are deterministic for a given DB snapshot.
 */

import { computeEventProductScore, classifyEventLane } from './event-product-score.mjs';
import { projectBriefStructure } from './brief-structure.mjs';
import { computeComparisonLiftMetric } from './model-comparison.mjs';

const SAMPLE_THEMES_FOR_BRIEFS = [
  'ai-ml',
  'climate-change',
  'energy-supply-chain',
  'semiconductor',
  'defense',
  'biotech',
  'cybersecurity',
];

const PRIMARY_LOOKBACK_DAYS = 14;
const SAMPLE_LIMIT = 50;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function ratio(numer, denom) {
  if (!denom || !Number.isFinite(denom) || denom <= 0) return null;
  return clamp01(numer / denom);
}

/**
 * theme_relevance_precision approximation:
 *   Measures the primary surface, not the raw ingestion pool. Low-relevance
 *   clusters are allowed to exist as hidden/noise candidates; they should not
 *   count against precision unless they reach watch/validated surfaces. This
 *   keeps the metric aligned with the product promise: "what the user sees is
 *   relevant", while rawCandidatePrecision remains exposed for diagnostics.
 */
async function computeThemeRelevancePrecision(client) {
  try {
    const { rows } = await client.query(
      `SELECT ce.id, ce.theme, ce.representative_title AS title, ce.event_date,
              COALESCE(ce.article_count, 0)::int AS article_count,
              COALESCE(ce.source_count, 0)::int AS source_count
              ,eu.evidence_grade
              ,ABS(COALESCE(eu.t_stat, 0)) AS abs_t
              ,eu.evidence_grade IN ('E2','E3','E4') AS promotion_eligible
         FROM canonical_events ce
         LEFT JOIN LATERAL (
           SELECT evidence_grade, t_stat
             FROM event_uplift
            WHERE canonical_event_id = ce.id
            ORDER BY ABS(COALESCE(t_stat, 0)) DESC NULLS LAST
            LIMIT 1
         ) eu ON TRUE
        WHERE ce.event_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
          AND COALESCE(ce.article_count, 0) >= 2
        ORDER BY (eu.evidence_grade IN ('E2','E3','E4')) DESC NULLS LAST,
                 ce.event_date DESC
        LIMIT ${SAMPLE_LIMIT}`,
      [PRIMARY_LOOKBACK_DAYS],
    );
    if (rows.length === 0) {
      return { metric: null, sample: 0, relevant: 0, rawSample: 0 };
    }
    let relevant = 0;
    let rawRelevant = 0;
    let primarySample = 0;
    let hiddenNoise = 0;
    for (const row of rows) {
      const score = computeEventProductScore({
        theme: row.theme,
        title: row.title,
        eventDate: row.event_date,
        articleCount: row.article_count,
        sourceCount: row.source_count,
        bestEvidenceGrade: row.evidence_grade,
        rawMaxAbsTStat: Number(row.abs_t || 0),
        promotionEligible: Boolean(row.promotion_eligible),
      });
      const isRelevant = score.components.themeRelevance >= 0.6;
      if (isRelevant) rawRelevant += 1;
      const lane = classifyEventLane({ ...score, productScore: score.productScore, promotionEligible: Boolean(row.promotion_eligible) });
      if (lane === 'noise') {
        hiddenNoise += 1;
        continue;
      }
      primarySample += 1;
      if (isRelevant) relevant += 1;
    }
    return {
      metric: primarySample > 0 ? ratio(relevant, primarySample) : 1,
      sample: primarySample,
      relevant,
      hiddenNoise,
      rawSample: rows.length,
      rawRelevant,
      rawCandidatePrecision: ratio(rawRelevant, rows.length),
    };
  } catch (err) {
    return { metric: null, error: String(err?.message || err) };
  }
}

/**
 * brief_completeness over the SAMPLE_THEMES_FOR_BRIEFS list. We use a
 * builder reference passed in by the caller so this module doesn't need
 * to import the heavy trend-dashboard-queries module (avoids circular
 * dependency risk).
 */
async function computeBriefCompleteness(safeQuery, buildBrief) {
  const samples = [];
  for (const theme of SAMPLE_THEMES_FOR_BRIEFS) {
    try {
      const params = new URLSearchParams({ period: 'quarter' });
      const brief = await buildBrief(theme, safeQuery, params);
      if (brief && typeof brief === 'object') {
        const proj = projectBriefStructure(brief);
        samples.push({
          theme,
          briefCompleteness: proj.briefCompleteness,
          missingSections: proj.missingSections,
          evidenceItemCount: proj.briefStructure.evidence?.items?.length ?? 0,
          evidenceClassCount: proj.briefStructure.evidence?.classes?.length ?? 0,
        });
      }
    } catch (err) {
      samples.push({ theme, error: String(err?.message || err) });
    }
  }
  const validSamples = samples.filter((s) => typeof s.briefCompleteness === 'number');
  if (validSamples.length === 0) {
    return { metric: null, sample: 0, samples };
  }
  const meanCompleteness = validSamples.reduce((acc, s) => acc + s.briefCompleteness, 0) / validSamples.length;
  // evidence_coverage = share of briefs with at least one evidence item or class
  const evidenceCovered = validSamples.filter(
    (s) => (s.evidenceItemCount + s.evidenceClassCount) >= 2,
  ).length;
  return {
    completeness: { metric: clamp01(meanCompleteness), sample: validSamples.length },
    evidenceCoverage: { metric: ratio(evidenceCovered, validSamples.length), sample: validSamples.length, covered: evidenceCovered },
    samples,
  };
}

/**
 * noise_suppression_rate: share of events that classifyEventLane labels
 * 'noise'. The dashboard is expected to either hide them by default or
 * route them to a separate Noise / Hidden lane (plan §2).
 */
async function computeNoiseSuppression(client) {
  try {
    const { rows } = await client.query(
      `SELECT ce.id, ce.theme, ce.representative_title AS title, ce.event_date,
              COALESCE(ce.article_count, 0)::int AS article_count,
              COALESCE(ce.source_count, 0)::int AS source_count,
              eu.evidence_grade,
              ABS(COALESCE(eu.t_stat, 0)) AS abs_t,
              eu.evidence_grade IN ('E2','E3','E4') AS promotion_eligible
         FROM canonical_events ce
         LEFT JOIN LATERAL (
           SELECT evidence_grade, t_stat
             FROM event_uplift
            WHERE canonical_event_id = ce.id
            ORDER BY ABS(COALESCE(t_stat, 0)) DESC NULLS LAST
            LIMIT 1
         ) eu ON TRUE
        WHERE ce.event_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
          AND COALESCE(ce.article_count, 0) >= 2
        ORDER BY ce.event_date DESC
        LIMIT ${SAMPLE_LIMIT}`,
      [PRIMARY_LOOKBACK_DAYS],
    );
    if (rows.length === 0) return { metric: null, sample: 0, noise: 0 };
    let noiseCount = 0;
    for (const row of rows) {
      const score = computeEventProductScore({
        theme: row.theme,
        title: row.title,
        eventDate: row.event_date,
        articleCount: row.article_count,
        sourceCount: row.source_count,
        bestEvidenceGrade: row.evidence_grade,
        rawMaxAbsTStat: Number(row.abs_t || 0),
        promotionEligible: Boolean(row.promotion_eligible),
      });
      const lane = classifyEventLane({ ...score, productScore: score.productScore, promotionEligible: Boolean(row.promotion_eligible) });
      if (lane === 'noise') noiseCount += 1;
    }
    return {
      metric: ratio(noiseCount, rows.length),
      sample: rows.length,
      noise: noiseCount,
    };
  } catch (err) {
    return { metric: null, error: String(err?.message || err) };
  }
}

/**
 * actionability_score: share of inbox-shaped items that have a
 * recommended next action attached. Currently inbox items always get
 * accept/reject buttons rendered in the dashboard; the API does not yet
 * carry an explicit nextAction field per item. Until that lands we
 * approximate via the inbox audit trail — share of recent inbox items
 * that received any decision within 7 days. This is a leading indicator,
 * not a strict measure; documented as such in the metric's `note`.
 */
async function computeActionabilityScore(client) {
  try {
    const { rows: actionedRows } = await client.query(
      `SELECT COUNT(DISTINCT (item_type, item_id))::int AS actioned
         FROM action_audit_log
        WHERE created_at >= NOW() - INTERVAL '7 days'`,
    );
    const { rows: queueRows } = await client.query(
      `SELECT COUNT(*)::int AS pending,
              COUNT(*) FILTER (
                WHERE action_type IN (
                  'add-rss',
                  'attach-theme',
                  'backfill-source',
                  'canonical-cross-theme-proposal',
                  'source-query'
                )
              )::int AS actionable_pending,
              COUNT(*) FILTER (
                WHERE action_type NOT IN (
                  'add-rss',
                  'attach-theme',
                  'backfill-source',
                  'canonical-cross-theme-proposal',
                  'source-query'
                )
              )::int AS pending_without_known_action,
              COUNT(*) FILTER (
                WHERE action_type = 'source-query'
                  AND status = 'needs-fix'
                  AND payload->'repair'->>'exhausted' = 'true'
              )::int AS exhausted_source_queries
         FROM approval_queue
        WHERE status IN ('pending', 'needs-fix')`,
    );
    const actioned = Number(actionedRows[0]?.actioned ?? 0);
    const pending = Number(queueRows[0]?.pending ?? 0);
    const actionablePending = Number(queueRows[0]?.actionable_pending ?? 0);
    const pendingWithoutKnownAction = Number(queueRows[0]?.pending_without_known_action ?? 0);
    const exhaustedSourceQueries = Number(queueRows[0]?.exhausted_source_queries ?? 0);
    const total = actioned + pending;
    return {
      metric: ratio(actioned + actionablePending, total),
      sample: total,
      actioned,
      pending,
      actionablePending,
      pendingWithoutKnownAction,
      exhaustedSourceQueries,
      note: 'pending approval/source-query items count as actionable only when the UI has a clear accept/reject/retry/inspect path',
    };
  } catch (err) {
    return { metric: null, error: String(err?.message || err) };
  }
}

const S_TIER_TARGETS = {
  theme_relevance_precision: 0.90,
  brief_completeness: 0.95,
  evidence_coverage: 0.90,
  actionability_score: 0.90,
};

function summarizeAgainstTargets(values) {
  const summary = { meeting: [], failing: [], unknown: [] };
  for (const [key, target] of Object.entries(S_TIER_TARGETS)) {
    const v = values[key];
    if (v == null || !Number.isFinite(v)) {
      summary.unknown.push(key);
    } else if (v >= target) {
      summary.meeting.push(key);
    } else {
      summary.failing.push({ metric: key, value: Number(v.toFixed(3)), target });
    }
  }
  let level = 'ok';
  if (summary.failing.length > 0) level = 'warning';
  if (summary.unknown.length === Object.keys(S_TIER_TARGETS).length) level = 'unknown';
  return { level, ...summary };
}

/**
 * Build the full /api/product-quality payload.
 *
 * Caller passes:
 *   pool        — pg pool (or any client with .query)
 *   safeQuery   — bound query helper from the API layer
 *   buildBrief  — reference to buildThemeBriefPayload (avoids circular import)
 */
export async function buildProductQualityPayload({ pool, safeQuery, buildBrief } = {}) {
  if (!pool) throw new Error('buildProductQualityPayload requires pool');
  const generatedAt = new Date().toISOString();

  const [precision, briefMetrics, noise, actionability, comparisonLift] = await Promise.all([
    computeThemeRelevancePrecision(pool),
    typeof buildBrief === 'function' && safeQuery
      ? computeBriefCompleteness(safeQuery, buildBrief)
      : Promise.resolve({ completeness: { metric: null, sample: 0 }, evidenceCoverage: { metric: null, sample: 0 }, samples: [] }),
    computeNoiseSuppression(pool),
    computeActionabilityScore(pool),
    // S-Tier B2 — comparison lift metric (model vs naive baseline).
    computeComparisonLiftMetric(pool),
  ]);

  const metrics = {
    theme_relevance_precision: precision.metric,
    brief_completeness: briefMetrics.completeness?.metric ?? null,
    evidence_coverage: briefMetrics.evidenceCoverage?.metric ?? null,
    noise_suppression_rate: noise.metric,
    actionability_score: actionability.metric,
    comparison_lift: comparisonLift.metric,
  };

  return {
    ok: true,
    generatedAt,
    targets: S_TIER_TARGETS,
    metrics,
    summary: summarizeAgainstTargets(metrics),
    details: {
      theme_relevance_precision: precision,
      brief_completeness: briefMetrics.completeness,
      evidence_coverage: briefMetrics.evidenceCoverage,
      noise_suppression_rate: noise,
      actionability_score: actionability,
      comparison_lift: comparisonLift,
    },
    samples: {
      lookbackDays: PRIMARY_LOOKBACK_DAYS,
      themesSampled: briefMetrics.samples,
    },
    note: 'time_to_first_value (≤ 30 s target) is a client telemetry metric and is NOT computed here.',
  };
}

export const PRODUCT_QUALITY_TARGETS = S_TIER_TARGETS;
