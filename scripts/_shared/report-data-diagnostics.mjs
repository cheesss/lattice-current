/*
 * Report data diagnostics.
 *
 * Detects internally inconsistent bundle state that the existing pipeline
 * accepted silently. Examples:
 *   - article_count = 0 in the aggregate window, but acceleration = -145%
 *     (the YoY/acceleration math is computed on a different window or the
 *     row simply has stale aggregate values that have not been recomputed
 *     against the current article-to-theme mapping)
 *   - recent_evidence_items > 0 while the aggregate metric for the same
 *     window reports 0 articles
 *   - regime_multiplier > 5 with sample_size < 10 (almost certainly overfit)
 *   - t_stat present without a sample_size parameter (cannot interpret)
 *   - acceleration absolute value > 500% (baseline near zero — multiplier is
 *     not a meaningful trend strength reading)
 *
 * The output is a list of caveat records that the caller appends to
 * bundle.caveats. The caller decides whether the diagnostic is severe enough
 * to gate the grade.
 */

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function findMetric(bundle, predicate) {
  return (bundle.metrics || []).find(predicate) || null;
}

function getMetricValue(bundle, name) {
  const metric = findMetric(bundle, (m) => m.name === name);
  return metric ? num(metric.value) : null;
}

function getMetricLimitations(bundle, name) {
  const metric = findMetric(bundle, (m) => m.name === name);
  return metric ? (metric.limitations || []).map((item) => String(item || '')) : [];
}

function envInt(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.floor(Number(process.env[name]));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const LOW_ATTENTION_SAMPLE_ARTICLES = envInt('REPORT_TRIAGE_MIN_ARTICLES', 10, 1, 1_000);
const INVESTMENT_MEMO_SAMPLE_ARTICLES = envInt('REPORT_INVESTMENT_MIN_ARTICLES', 30, LOW_ATTENTION_SAMPLE_ARTICLES, 1_000);

/*
 * Run all diagnostics. Returns { caveats, signals } where:
 *   caveats — appendable to bundle.caveats
 *   signals — { hasAggregateOrphan, hasEvidenceMismatch, hasOverfitRisk, ... }
 *             so quality.mjs can use the booleans for grade caps.
 */
export function runReportDataDiagnostics(bundle) {
  const caveats = [];
  const signals = {
    hasAggregateOrphan: false,
    hasEvidenceMismatch: false,
    hasOverfitRisk: false,
    hasBaselineDistortion: false,
    hasUnsampledTStat: false,
    hasRecentEvidenceWithEmptyAggregate: false,
    hasLowAttentionSample: false,
  };
  if (!bundle) return { caveats, signals };

  const articleCount = getMetricValue(bundle, 'article_count');
  const recentEvidence = getMetricValue(bundle, 'recent_evidence_items');
  const yoy = getMetricValue(bundle, 'YoY');
  const acceleration = getMetricValue(bundle, 'acceleration');
  const accelerationLimitations = getMetricLimitations(bundle, 'acceleration');
  const novelty = getMetricValue(bundle, 'novelty_score');

  /* (0) Sample-size boundary: trend/lifecycle metrics can be useful for
   * triage with small samples, but they should not be read as industry-cycle
   * conclusions or investment-memo evidence. */
  if (bundle.reportType === 'theme_report'
    && articleCount !== null
    && articleCount < LOW_ATTENTION_SAMPLE_ARTICLES) {
    signals.hasLowAttentionSample = true;
    caveats.push({
      caveatId: 'CAV-DIAG-LOW-ATTENTION-SAMPLE',
      severity: articleCount < 5 ? 'high' : 'medium',
      type: 'low_attention_sample',
      text: `Theme lifecycle and attention momentum are based on ${articleCount} article${articleCount === 1 ? '' : 's'} in the aggregate window. This is enough for signal triage, not enough for an investment memo; industry-cycle claims require at least ${INVESTMENT_MEMO_SAMPLE_ARTICLES} articles plus independent industry, fundamental, and market data.`,
      appliesToClaimIds: bundle.claims?.map((c) => c.claimId) || [],
    });
  }

  /* (1) Aggregate orphan: aggregate metrics exist but the article_count is 0 */
  if (articleCount === 0
    && [yoy, acceleration, novelty].some((value) => value !== null && Math.abs(value) > 0)) {
    signals.hasAggregateOrphan = true;
    caveats.push({
      caveatId: 'CAV-DIAG-AGGREGATE-ORPHAN',
      severity: 'high',
      type: 'aggregate_orphan',
      text: 'The selected trend aggregate reports zero articles, but its year-over-year, acceleration, and novelty metrics are non-zero. It was likely produced against a different window than the current article-to-theme mapping. Treat the aggregate metrics as stale.',
      appliesToClaimIds: bundle.claims?.map((c) => c.claimId) || [],
    });
  }

  /* (2) Recent-evidence vs aggregate mismatch */
  if (articleCount === 0 && recentEvidence !== null && recentEvidence > 0) {
    signals.hasRecentEvidenceWithEmptyAggregate = true;
    signals.hasEvidenceMismatch = true;
    caveats.push({
      caveatId: 'CAV-DIAG-EVIDENCE-AGGREGATE-MISMATCH',
      severity: 'medium',
      type: 'evidence_aggregate_mismatch',
      text: `The bundle attaches ${recentEvidence} recent evidence items but the aggregate metric reports 0 articles in its window. The two are computed against different windows — do not infer trend velocity from the aggregate row.`,
      appliesToClaimIds: bundle.claims?.map((c) => c.claimId) || [],
    });
  }

  /* (3) Baseline distortion. For theme trend aggregates, values above 100%
   *     usually mean the comparison window was zero/sparse rather than a
   *     trustworthy magnitude reading. */
  if (
    acceleration !== null
    && (Math.abs(acceleration) > 100 || accelerationLimitations.some((item) => /baseline|sparse|zero/i.test(item)))
  ) {
    signals.hasBaselineDistortion = true;
    caveats.push({
      caveatId: 'CAV-DIAG-BASELINE-DISTORTION',
      severity: 'medium',
      type: 'baseline_distortion',
      text: `Acceleration is ${acceleration.toFixed(0)}%, but the comparison baseline is sparse or unstable. Treat the sign as directional only; the magnitude is not a meaningful trend-strength reading.`,
      appliesToClaimIds: bundle.claims?.map((c) => c.claimId) || [],
    });
  }

  /* (4) Overfit risk in market reactions: |multiplier| > 5 with sample_size < 10 */
  for (const reaction of (bundle.marketReactions || [])) {
    const mult = num(reaction.uplift ?? reaction.multiplier);
    const controls = (reaction.controls || []).join(' ');
    const sampleSize = (() => {
      const m = controls.match(/(?:sample_size|n_controls|event_count|n)=(\d+)/);
      return m ? Number(m[1]) : null;
    })();
    if (mult !== null && Math.abs(mult) > 5 && sampleSize !== null && sampleSize < 10) {
      signals.hasOverfitRisk = true;
      caveats.push({
        caveatId: `CAV-DIAG-OVERFIT-${reaction.reactionId}`,
        severity: 'high',
        type: 'low_sample_overfit',
        text: `Market reaction ${reaction.reactionId} on ${reaction.symbol || 'unknown'} reports a multiplier of ${mult.toFixed(2)} on sample_size=${sampleSize}. Below sample_size=10 the multiplier is an overfit estimate, not a regime statistic.`,
        appliesToClaimIds: bundle.claims?.map((c) => c.claimId) || [],
      });
      break; // one caveat per pattern is enough
    }
    /* (5) t_stat present without sample_size */
    if (num(reaction.tStat) !== null && sampleSize === null) {
      signals.hasUnsampledTStat = true;
      caveats.push({
        caveatId: `CAV-DIAG-UNSAMPLED-TSTAT-${reaction.reactionId}`,
        severity: 'low',
        type: 'tstat_no_sample',
        text: `Market reaction ${reaction.reactionId} reports t_stat=${reaction.tStat} but no sample_size control. The t-stat cannot be interpreted without n; treat as candidate.`,
        appliesToClaimIds: bundle.claims?.map((c) => c.claimId) || [],
      });
      break;
    }
  }

  return { caveats, signals };
}

/*
 * Apply diagnostics in-place — appends caveats to bundle and stamps
 * bundle.metadata.diagnosticSignals so downstream quality scoring can
 * read the booleans.
 */
export function applyReportDataDiagnostics(bundle) {
  const { caveats, signals } = runReportDataDiagnostics(bundle);
  bundle.caveats = bundle.caveats || [];
  for (const caveat of caveats) {
    if (!bundle.caveats.some((existing) => existing.caveatId === caveat.caveatId)) {
      bundle.caveats.push(caveat);
    }
  }
  bundle.metadata = bundle.metadata || {};
  bundle.metadata.diagnosticSignals = signals;
  return bundle;
}
