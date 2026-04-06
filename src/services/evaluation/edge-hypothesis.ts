/**
 * Edge Hypothesis — Phase 10
 *
 * Defines and verifies the system's competitive edges (hypotheses)
 * with falsifiable statements and structured verification protocols.
 * Each hypothesis represents a claimed advantage over baseline strategies.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HypothesisStatus = 'pending' | 'supported' | 'refuted' | 'inconclusive';

export interface EdgeHypothesis {
  id: string;
  name: string;
  description: string;
  falsifiableStatement: string;
  category: 'cross-domain' | 'nonlinear-learning' | 'speed' | 'source-diversification';
  minVerificationMonths: number;
  metrics: HypothesisMetric[];
  status: HypothesisStatus;
  evidence: HypothesisEvidence | null;
}

export interface HypothesisMetric {
  name: string;
  description: string;
  threshold: number;
  direction: 'above' | 'below';
  unit: string;
}

export interface HypothesisEvidence {
  metricResults: MetricResult[];
  verificationStartDate: string;
  verificationEndDate: string;
  sampleSize: number;
  pValue: number | null;
  conclusion: HypothesisStatus;
  notes: string;
}

export interface MetricResult {
  metricName: string;
  observed: number;
  threshold: number;
  passed: boolean;
}

export interface EdgeStrengthAssessment {
  overallStrength: number; // 0-1
  hypothesisStrengths: Array<{ hypothesisId: string; strength: number }>;
  weakestLink: string;
  recommendation: 'strong' | 'moderate' | 'weak' | 'unverified';
}

export interface VerificationPlan {
  hypothesisId: string;
  startDate: string;
  endDate: string;
  baselineStrategyId: string;
  controlVariables: string[];
  requiredSampleSize: number;
}

// ---------------------------------------------------------------------------
// Hypothesis Registry
// ---------------------------------------------------------------------------

const HYPOTHESES: EdgeHypothesis[] = [
  {
    id: 'cross-domain',
    name: 'Cross-Domain Connection',
    description: 'System captures cross-domain impacts (geopolitical + military + economic + sensor) that single-domain analysts miss.',
    falsifiableStatement: 'Cross-domain strategy Sharpe ratio exceeds best single-domain strategy by >= 0.15 over a 6-month period.',
    category: 'cross-domain',
    minVerificationMonths: 6,
    metrics: [
      { name: 'sharpe_delta', description: 'Sharpe ratio improvement over best single-domain', threshold: 0.15, direction: 'above', unit: 'ratio' },
      { name: 'cross_only_hit_rate', description: 'Hit rate of ideas only available via cross-domain', threshold: 0.55, direction: 'above', unit: 'pct' },
    ],
    status: 'pending',
    evidence: null,
  },
  {
    id: 'nonlinear-learning',
    name: 'Non-Linear Pattern Learning',
    description: 'HMM + Hawkes + Bandit combination learns market response patterns better than simple rules.',
    falsifiableStatement: 'Full model ensemble outperforms best single model by >= 0.10 Sharpe over 6 months, and performance improves with training length.',
    category: 'nonlinear-learning',
    minVerificationMonths: 6,
    metrics: [
      { name: 'ensemble_sharpe_delta', description: 'Sharpe improvement of ensemble over best single model', threshold: 0.10, direction: 'above', unit: 'ratio' },
      { name: 'learning_curve_slope', description: 'Performance slope as training data increases', threshold: 0, direction: 'above', unit: 'sharpe/month' },
    ],
    status: 'pending',
    evidence: null,
  },
  {
    id: 'speed-advantage',
    name: 'Real-Time Response Speed',
    description: 'Automated pipeline detects events and generates ideas faster than human analysts, before market pricing.',
    falsifiableStatement: 'Average event-to-idea latency is < 30 minutes, and market has not priced > 50% of the move at idea generation time.',
    category: 'speed',
    minVerificationMonths: 3,
    metrics: [
      { name: 'avg_latency_minutes', description: 'Average event detection to idea generation time', threshold: 30, direction: 'below', unit: 'minutes' },
      { name: 'pre_pricing_pct', description: 'Percentage of move remaining at idea generation', threshold: 50, direction: 'above', unit: 'pct' },
    ],
    status: 'pending',
    evidence: null,
  },
  {
    id: 'source-diversification',
    name: 'Source Diversification Noise Reduction',
    description: '24-source cross-validation achieves lower false positive rate than any single source.',
    falsifiableStatement: 'Full source ensemble false positive rate is <= 70% of best single-source false positive rate.',
    category: 'source-diversification',
    minVerificationMonths: 3,
    metrics: [
      { name: 'fp_ratio', description: 'Ensemble FP rate / best single-source FP rate', threshold: 0.70, direction: 'below', unit: 'ratio' },
      { name: 'min_source_count_for_improvement', description: 'Min sources needed for measurable FP reduction', threshold: 5, direction: 'below', unit: 'count' },
    ],
    status: 'pending',
    evidence: null,
  },
];

/** Get all registered hypotheses (deep copy). */
export function getHypotheses(): EdgeHypothesis[] {
  return HYPOTHESES.map((h) => ({
    ...h,
    metrics: h.metrics.map((m) => ({ ...m })),
    evidence: h.evidence ? { ...h.evidence, metricResults: h.evidence.metricResults.map((r) => ({ ...r })) } : null,
  }));
}

/** Get a single hypothesis by ID. */
export function getHypothesis(id: string): EdgeHypothesis | null {
  const h = HYPOTHESES.find((h) => h.id === id);
  if (!h) return null;
  return {
    ...h,
    metrics: h.metrics.map((m) => ({ ...m })),
    evidence: h.evidence ? { ...h.evidence, metricResults: h.evidence.metricResults.map((r) => ({ ...r })) } : null,
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/** Evaluate metric results against a hypothesis's thresholds. */
export function evaluateHypothesis(
  hypothesisId: string,
  results: Array<{ metricName: string; observed: number }>,
  meta: { startDate: string; endDate: string; sampleSize: number; pValue?: number | null },
): HypothesisEvidence {
  const hypothesis = HYPOTHESES.find((h) => h.id === hypothesisId);
  if (!hypothesis) {
    return {
      metricResults: [],
      verificationStartDate: meta.startDate,
      verificationEndDate: meta.endDate,
      sampleSize: meta.sampleSize,
      pValue: meta.pValue ?? null,
      conclusion: 'inconclusive',
      notes: `Unknown hypothesis: ${hypothesisId}`,
    };
  }

  const metricResults: MetricResult[] = hypothesis.metrics.map((metric) => {
    const result = results.find((r) => r.metricName === metric.name);
    const observed = result?.observed ?? 0;
    const passed = metric.direction === 'above'
      ? observed >= metric.threshold
      : observed <= metric.threshold;
    return { metricName: metric.name, observed, threshold: metric.threshold, passed };
  });

  const allPassed = metricResults.every((r) => r.passed);
  const nonePassed = metricResults.every((r) => !r.passed);

  let conclusion: HypothesisStatus;
  if (allPassed && meta.sampleSize >= 30) {
    conclusion = 'supported';
  } else if (nonePassed && meta.sampleSize >= 30) {
    conclusion = 'refuted';
  } else {
    conclusion = 'inconclusive';
  }

  return {
    metricResults,
    verificationStartDate: meta.startDate,
    verificationEndDate: meta.endDate,
    sampleSize: meta.sampleSize,
    pValue: meta.pValue ?? null,
    conclusion,
    notes: allPassed ? 'All metrics met thresholds.' : nonePassed ? 'No metrics met thresholds.' : 'Mixed results.',
  };
}

/** Apply evidence to update a hypothesis status in the registry. */
export function recordEvidence(hypothesisId: string, evidence: HypothesisEvidence): boolean {
  const idx = HYPOTHESES.findIndex((h) => h.id === hypothesisId);
  if (idx < 0) return false;
  HYPOTHESES[idx]!.evidence = evidence;
  HYPOTHESES[idx]!.status = evidence.conclusion;
  return true;
}

// ---------------------------------------------------------------------------
// Edge Strength Assessment
// ---------------------------------------------------------------------------

/** Compute overall edge strength from all hypothesis results. */
export function assessEdgeStrength(): EdgeStrengthAssessment {
  const strengths = HYPOTHESES.map((h) => {
    let strength: number;
    switch (h.status) {
      case 'supported': strength = 1.0; break;
      case 'inconclusive': strength = 0.4; break;
      case 'refuted': strength = 0.0; break;
      default: strength = 0.2; // pending
    }
    // Refine with evidence detail if available
    if (h.evidence && h.evidence.metricResults.length > 0) {
      const passRate = h.evidence.metricResults.filter((r) => r.passed).length / h.evidence.metricResults.length;
      strength = Math.max(strength, passRate * 0.8);
    }
    return { hypothesisId: h.id, strength };
  });

  const overall = strengths.length > 0
    ? strengths.reduce((s, h) => s + h.strength, 0) / strengths.length
    : 0;

  const weakest = strengths.length > 0
    ? strengths.reduce((min, h) => h.strength < min.strength ? h : min, strengths[0]!)
    : null;

  let recommendation: 'strong' | 'moderate' | 'weak' | 'unverified';
  if (strengths.every((s) => s.strength < 0.3)) {
    recommendation = 'unverified';
  } else if (overall >= 0.7) {
    recommendation = 'strong';
  } else if (overall >= 0.4) {
    recommendation = 'moderate';
  } else {
    recommendation = 'weak';
  }

  return {
    overallStrength: Math.round(overall * 1000) / 1000,
    hypothesisStrengths: strengths,
    weakestLink: weakest?.hypothesisId ?? 'none',
    recommendation,
  };
}

/** Build a verification plan for a hypothesis. */
export function buildVerificationPlan(
  hypothesisId: string,
  startDate: string,
  baselineStrategyId: string = 'buy-and-hold',
): VerificationPlan | null {
  const h = HYPOTHESES.find((h) => h.id === hypothesisId);
  if (!h) return null;

  const start = new Date(startDate);
  const end = new Date(start);
  end.setMonth(end.getMonth() + h.minVerificationMonths);

  return {
    hypothesisId: h.id,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    baselineStrategyId,
    controlVariables: h.category === 'cross-domain'
      ? ['source_domains', 'asset_universe', 'regime']
      : h.category === 'nonlinear-learning'
        ? ['training_length', 'model_set', 'regime']
        : h.category === 'speed'
          ? ['event_source', 'market_session', 'volatility']
          : ['source_count', 'source_selection', 'event_type'],
    requiredSampleSize: h.minVerificationMonths >= 6 ? 100 : 50,
  };
}
