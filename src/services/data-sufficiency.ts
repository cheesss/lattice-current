/**
 * Data Sufficiency — Phase 8
 *
 * Defines explicit degradation strategies when data sources are
 * unavailable or degraded. Maps data sufficiency levels to behavioral
 * policies so the system fails gracefully instead of silently degrading.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DataSufficiencyLevel = 'full' | 'degraded' | 'minimal' | 'insufficient';

export type SourceKind = 'sensor' | 'news' | 'research' | 'meta-aggregator' | 'market-data';

export type RegimeState = string;

export type AutonomyAction = 'deploy' | 'shadow' | 'watch' | 'abstain';

export type AlertLevel = 'none' | 'info' | 'warning' | 'critical';

/** Status of a single data source. */
export interface SourceStatus {
  id: string;
  kind: SourceKind;
  available: boolean;
  lastSeenAt: string | null;
  staleMinutes: number;
  errorMessage: string | null;
}

/** Assessment of current data availability. */
export interface DataSufficiencyAssessment {
  level: DataSufficiencyLevel;
  availableSourceKinds: SourceKind[];
  missingSources: string[];
  coverageGaps: CoverageGap[];
  confidenceMultiplier: number;
  alertLevel: AlertLevel;
  explanation: string;
}

/** A gap in data coverage. */
export interface CoverageGap {
  kind: SourceKind;
  description: string;
  impact: 'high' | 'medium' | 'low';
}

/** Policy that governs system behavior at a degradation level. */
export interface DegradationPolicy {
  maxAction: AutonomyAction;
  sizeMultiplier: number;
  convictionFloor: number;
  requireCrossValidation: boolean;
  alertLevel: AlertLevel;
  humanMessage: string;
}

/** Scenario for testing source failure. */
export interface FailureScenario {
  id: string;
  name: string;
  description: string;
  disabledSources: string[];
  expectedLevel: DataSufficiencyLevel;
}

// ---------------------------------------------------------------------------
// Policy Matrix: DataLevel × RegimeState → DegradationPolicy
// ---------------------------------------------------------------------------

const POLICY_MATRIX: Record<DataSufficiencyLevel, Record<string, DegradationPolicy>> = {
  full: {
    default: { maxAction: 'deploy', sizeMultiplier: 1.0, convictionFloor: 0, requireCrossValidation: false, alertLevel: 'none', humanMessage: 'All systems nominal.' },
  },
  degraded: {
    'risk-on': { maxAction: 'deploy', sizeMultiplier: 0.5, convictionFloor: 55, requireCrossValidation: false, alertLevel: 'info', humanMessage: 'Some data sources unavailable. Position sizes reduced by 50%.' },
    'risk-off': { maxAction: 'shadow', sizeMultiplier: 0.3, convictionFloor: 60, requireCrossValidation: true, alertLevel: 'warning', humanMessage: 'Data degraded in risk-off regime. Maximum action: shadow only. Sizes reduced 70%.' },
    'inflation-shock': { maxAction: 'deploy', sizeMultiplier: 0.4, convictionFloor: 58, requireCrossValidation: false, alertLevel: 'warning', humanMessage: 'Data degraded during inflation shock. Position sizes reduced 60%.' },
    'deflation-bust': { maxAction: 'shadow', sizeMultiplier: 0.3, convictionFloor: 60, requireCrossValidation: true, alertLevel: 'warning', humanMessage: 'Data degraded during deflation bust. Maximum action: shadow only.' },
    default: { maxAction: 'deploy', sizeMultiplier: 0.5, convictionFloor: 55, requireCrossValidation: false, alertLevel: 'info', humanMessage: 'Some data sources unavailable. Position sizes reduced.' },
  },
  minimal: {
    'risk-on': { maxAction: 'watch', sizeMultiplier: 0, convictionFloor: 70, requireCrossValidation: true, alertLevel: 'warning', humanMessage: 'Minimal data available. Watch mode only.' },
    'risk-off': { maxAction: 'abstain', sizeMultiplier: 0, convictionFloor: 100, requireCrossValidation: true, alertLevel: 'critical', humanMessage: 'Minimal data in risk-off regime. System abstaining from all actions.' },
    default: { maxAction: 'watch', sizeMultiplier: 0, convictionFloor: 70, requireCrossValidation: true, alertLevel: 'warning', humanMessage: 'Minimal data available. Watch mode only — no deployments.' },
  },
  insufficient: {
    default: { maxAction: 'abstain', sizeMultiplier: 0, convictionFloor: 100, requireCrossValidation: true, alertLevel: 'critical', humanMessage: 'Insufficient data. System fully abstaining. Human intervention required.' },
  },
};

// ---------------------------------------------------------------------------
// Data Sufficiency Assessment
// ---------------------------------------------------------------------------

/** Minimum requirements for each sufficiency level (exported for reference). */
export const LEVEL_REQUIREMENTS: Record<DataSufficiencyLevel, { requiredKinds: SourceKind[]; minSources: number }> = {
  full: { requiredKinds: ['news', 'sensor', 'market-data'], minSources: 5 },
  degraded: { requiredKinds: ['news', 'market-data'], minSources: 3 },
  minimal: { requiredKinds: ['news'], minSources: 1 },
  insufficient: { requiredKinds: [], minSources: 0 },
};

/**
 * Assess data sufficiency from a list of source statuses.
 */
export function assessDataSufficiency(sources: SourceStatus[]): DataSufficiencyAssessment {
  const available = sources.filter((s: SourceStatus) => s.available && s.staleMinutes < 360);
  const availableKinds = [...new Set(available.map((s: SourceStatus) => s.kind))];
  const missingSources = sources
    .filter((s: SourceStatus) => !s.available || s.staleMinutes >= 360)
    .map((s: SourceStatus) => s.id);

  // Determine level
  let level: DataSufficiencyLevel = 'insufficient';
  const hasKind = (kind: SourceKind): boolean => availableKinds.includes(kind);

  if (hasKind('news') && hasKind('sensor') && hasKind('market-data') && available.length >= 5) {
    level = 'full';
  } else if (hasKind('news') && hasKind('market-data') && available.length >= 3) {
    level = 'degraded';
  } else if (hasKind('news') && available.length >= 1) {
    level = 'minimal';
  }

  // Build coverage gaps
  const gaps: CoverageGap[] = [];
  if (!hasKind('sensor')) {
    gaps.push({ kind: 'sensor', description: 'No sensor data (OpenSky, AIS, USGS)', impact: 'high' });
  }
  if (!hasKind('market-data')) {
    gaps.push({ kind: 'market-data', description: 'No market data feeds', impact: 'high' });
  }
  if (!hasKind('research')) {
    gaps.push({ kind: 'research', description: 'No research sources (ACLED, FRED)', impact: 'medium' });
  }
  if (!hasKind('news')) {
    gaps.push({ kind: 'news', description: 'No news sources available', impact: 'high' });
  }

  // Confidence multiplier
  const confidenceMultiplier = level === 'full' ? 1.0
    : level === 'degraded' ? 0.7
      : level === 'minimal' ? 0.3
        : 0;

  const alertLevel: AlertLevel = level === 'full' ? 'none'
    : level === 'degraded' ? 'info'
      : level === 'minimal' ? 'warning'
        : 'critical';

  const explanation = level === 'full'
    ? `All ${available.length} sources operational. Full coverage.`
    : level === 'degraded'
      ? `${available.length}/${sources.length} sources available. ${missingSources.length} sources missing: ${missingSources.join(', ')}.`
      : level === 'minimal'
        ? `Only ${available.length} source(s) available (news only). Most capabilities disabled.`
        : `No reliable sources available. System cannot make informed decisions.`;

  return {
    level,
    availableSourceKinds: availableKinds,
    missingSources,
    coverageGaps: gaps,
    confidenceMultiplier,
    alertLevel,
    explanation,
  };
}

// ---------------------------------------------------------------------------
// Degradation Policy Resolution
// ---------------------------------------------------------------------------

/**
 * Get the degradation policy for a given data level and regime.
 */
export function getDegradationPolicy(
  level: DataSufficiencyLevel,
  regime: RegimeState | null,
): DegradationPolicy {
  const levelPolicies = POLICY_MATRIX[level];
  if (regime && levelPolicies[regime]) {
    return levelPolicies[regime];
  }
  return levelPolicies['default']!;
}

/**
 * Check if a proposed action is allowed under the current degradation policy.
 */
export function isActionAllowed(
  proposedAction: AutonomyAction,
  policy: DegradationPolicy,
): boolean {
  const hierarchy: AutonomyAction[] = ['abstain', 'watch', 'shadow', 'deploy'];
  const proposedIdx = hierarchy.indexOf(proposedAction);
  const maxIdx = hierarchy.indexOf(policy.maxAction);
  return proposedIdx <= maxIdx;
}

/**
 * Apply degradation policy to a proposed position size.
 */
export function applyDegradationToSize(
  proposedSizePct: number,
  conviction: number,
  policy: DegradationPolicy,
): { adjustedSizePct: number; reason: string | null } {
  if (conviction < policy.convictionFloor) {
    return { adjustedSizePct: 0, reason: `Conviction ${conviction} below floor ${policy.convictionFloor}` };
  }
  const adjusted = proposedSizePct * policy.sizeMultiplier;
  const reason = policy.sizeMultiplier < 1
    ? `Size reduced by ${Math.round((1 - policy.sizeMultiplier) * 100)}% due to ${policy.alertLevel} data degradation`
    : null;
  return { adjustedSizePct: Math.round(adjusted * 100) / 100, reason };
}

// ---------------------------------------------------------------------------
// Predefined Failure Scenarios (for testing)
// ---------------------------------------------------------------------------

export const FAILURE_SCENARIOS: readonly FailureScenario[] = [
  {
    id: 'gdelt-down',
    name: 'GDELT Outage',
    description: 'Primary news meta-aggregator unavailable',
    disabledSources: ['gdelt', 'gdelt-doc'],
    expectedLevel: 'degraded',
  },
  {
    id: 'market-data-delay',
    name: 'Market Data Delay',
    description: 'Yahoo Finance and CoinGecko experiencing delays',
    disabledSources: ['yahoo-chart', 'coingecko'],
    expectedLevel: 'degraded',
  },
  {
    id: 'sensor-loss',
    name: 'Sensor Data Loss',
    description: 'All sensor sources (OpenSky, AIS, USGS) offline',
    disabledSources: ['opensky', 'ais', 'usgs', 'glint', 'cyber-threats'],
    expectedLevel: 'degraded',
  },
  {
    id: 'multi-failure',
    name: 'Multi-Source Failure',
    description: 'Simultaneous failure of sensors and market data (common in geopolitical crisis)',
    disabledSources: ['opensky', 'ais', 'usgs', 'yahoo-chart', 'coingecko'],
    expectedLevel: 'minimal',
  },
  {
    id: 'total-outage',
    name: 'Total Data Outage',
    description: 'All sources offline',
    disabledSources: ['gdelt', 'gdelt-doc', 'acled', 'opensky', 'ais', 'usgs', 'rss', 'yahoo-chart', 'coingecko', 'fred'],
    expectedLevel: 'insufficient',
  },
  {
    id: 'news-only',
    name: 'News Only',
    description: 'Only RSS feeds available, all other sources down',
    disabledSources: ['gdelt', 'gdelt-doc', 'acled', 'opensky', 'ais', 'usgs', 'yahoo-chart', 'coingecko', 'fred', 'glint', 'cyber-threats'],
    expectedLevel: 'minimal',
  },
];

/**
 * Simulate a failure scenario and return the resulting assessment.
 */
export function simulateFailureScenario(
  allSources: SourceStatus[],
  scenario: FailureScenario,
): DataSufficiencyAssessment {
  const disabled = new Set(scenario.disabledSources);
  const simulated = allSources.map((s: SourceStatus) => ({
    ...s,
    available: disabled.has(s.id) ? false : s.available,
    staleMinutes: disabled.has(s.id) ? 999 : s.staleMinutes,
    errorMessage: disabled.has(s.id) ? `Simulated outage: ${scenario.name}` : s.errorMessage,
  }));
  return assessDataSufficiency(simulated);
}
