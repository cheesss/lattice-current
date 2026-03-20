export type AutonomyAssetKind = 'etf' | 'equity' | 'commodity' | 'fx' | 'rate' | 'crypto';
export type AutonomyAction = 'deploy' | 'shadow' | 'watch' | 'abstain';
export type ConfidenceBand = 'low' | 'guarded' | 'building' | 'high';
export type RollbackLevel = 'normal' | 'watch' | 'armed';
export type ExecutionSessionState = 'always-on' | 'open' | 'extended' | 'closed';

export interface CrossCorroborationAssessment {
  sourceDiversity: number;
  corroborationQuality: number;
  contradictionPenalty: number;
  rumorPenalty: number;
  hedgedSourceRatio: number;
  notes: string[];
}

export interface RecencyAssessment {
  ageDays: number;
  timeDecayWeight: number;
  recentEvidenceScore: number;
  stalePenalty: number;
  floorBreached: boolean;
  notes: string[];
}

export interface RealityConstraintAssessment {
  sessionState: ExecutionSessionState;
  tradableNow: boolean;
  spreadBps: number;
  slippageBps: number;
  liquidityPenaltyPct: number;
  executionPenaltyPct: number;
  realityScore: number;
  notes: string[];
}

export interface CalibratedDecision {
  calibratedConfidence: number;
  confidenceBand: ConfidenceBand;
  action: AutonomyAction;
  reasons: string[];
}

export interface DecisionExplanationPayload {
  label: string;
  action: AutonomyAction;
  calibratedConfidence: number;
  confidenceBand: ConfidenceBand;
  whyRecommended: string[];
  whySuppressed: string[];
  whyAbstained: string[];
  signals: string[];
}

export interface ShadowIdeaLike {
  status: 'open' | 'closed';
  openedAt: string;
  lastMarkedAt: string;
  closedAt?: string;
  daysHeld: number;
  conviction: number;
  falsePositiveRisk: number;
  currentReturnPct: number | null;
  realizedReturnPct: number | null;
  bestReturnPct: number;
  worstReturnPct: number;
}

export interface ShadowControlState {
  shadowMode: boolean;
  rollbackLevel: RollbackLevel;
  recentSampleCount: number;
  recentHitRate: number;
  recentAvgReturnPct: number;
  recentDrawdownPct: number;
  staleIdeaCount: number;
  notes: string[];
}

const HEDGING_RE = /\b(alleged|apparently|appears|believed|could|expected|likely|may|might|possible|possibly|reportedly|rumor|rumour|said to|sources say|speculation|unclear|unconfirmed)\b/i;
const CONFIRMED_RE = /\b(announced|approved|confirmed|entered|hit|launched|ordered|seized|signed|started|struck|suspended)\b/i;
const DENIAL_RE = /\b(denied|denies|disputed|false|inaccurate|misleading|not true|refuted|unfounded)\b/i;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asTs(value: string | null | undefined): number {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? ts : 0;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalize(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function sourceSpreadBaseline(assetKind: AutonomyAssetKind): number {
  if (assetKind === 'fx') return 4;
  if (assetKind === 'rate') return 6;
  if (assetKind === 'etf') return 9;
  if (assetKind === 'equity') return 14;
  if (assetKind === 'commodity') return 18;
  return 24;
}

function sourceSlippageBaseline(assetKind: AutonomyAssetKind): number {
  if (assetKind === 'fx') return 3;
  if (assetKind === 'rate') return 5;
  if (assetKind === 'etf') return 9;
  if (assetKind === 'equity') return 14;
  if (assetKind === 'commodity') return 16;
  return 18;
}

function inferSessionState(assetKind: AutonomyAssetKind, timestamp: string): ExecutionSessionState {
  const date = new Date(asTs(timestamp));
  const day = date.getUTCDay();
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const minuteOfDay = hour * 60 + minute;
  const isWeekend = day === 0 || day === 6;

  if (assetKind === 'crypto') return 'always-on';
  if ((assetKind === 'fx' || assetKind === 'rate') && isWeekend) return 'closed';
  if (assetKind === 'fx' || assetKind === 'rate') return 'extended';
  if (assetKind === 'commodity' && isWeekend) return 'closed';
  if (assetKind === 'commodity') return minuteOfDay >= 60 && minuteOfDay <= 1380 ? 'extended' : 'closed';
  if (isWeekend) return 'closed';
  if (minuteOfDay >= 810 && minuteOfDay <= 1260) return 'open';
  if (minuteOfDay >= 720 && minuteOfDay < 810) return 'extended';
  if (minuteOfDay > 1260 && minuteOfDay <= 1320) return 'extended';
  return 'closed';
}

export function assessCrossCorroboration(args: {
  primaryTitle: string;
  titles: string[];
  sources: string[];
  baseCredibility: number;
  baseCorroboration: number;
  feedHealthScore?: number | null;
  truthAgreementScore?: number | null;
  relationConfidence?: number | null;
}): CrossCorroborationAssessment {
  const normalizedTitles = Array.from(
    new Set([args.primaryTitle, ...args.titles].map((value) => normalize(value)).filter(Boolean)),
  );
  const normalizedSources = Array.from(new Set(args.sources.map((value) => normalize(value)).filter(Boolean)));
  const hedgedCount = normalizedTitles.filter((value) => HEDGING_RE.test(value)).length;
  const confirmedCount = normalizedTitles.filter((value) => CONFIRMED_RE.test(value)).length;
  const deniedCount = normalizedTitles.filter((value) => DENIAL_RE.test(value)).length;
  const hedgedSourceRatio = normalizedTitles.length > 0 ? hedgedCount / normalizedTitles.length : 0;

  const sourceDiversity = clamp(
    Math.round(
      18
      + normalizedSources.length * 16
      + normalizedTitles.length * 3
      + Math.max(0, (args.feedHealthScore ?? 55) - 50) * 0.2,
    ),
    10,
    98,
  );
  const contradictionPenalty = clamp(
    Math.round(
      (deniedCount > 0 && confirmedCount > 0 ? 16 : 0)
      + (deniedCount > 0 && hedgedCount > 0 ? 8 : 0)
      + Math.max(0, deniedCount - 1) * 4,
    ),
    0,
    28,
  );
  const rumorPenalty = clamp(
    Math.round(hedgedSourceRatio * 28 + (hedgedCount > confirmedCount ? 6 : 0)),
    0,
    24,
  );
  const corroborationQuality = clamp(
    Math.round(
      args.baseCorroboration * 0.42
      + args.baseCredibility * 0.18
      + sourceDiversity * 0.18
      + (args.truthAgreementScore ?? 55) * 0.12
      + (args.relationConfidence ?? 45) * 0.1
      - contradictionPenalty
      - rumorPenalty,
    ),
    8,
    98,
  );

  const notes = [
    `${normalizedSources.length} distinct sources contributed to the cluster.`,
    contradictionPenalty > 0 ? 'Conflicting or denial-style headlines were detected.' : 'Headline direction was broadly aligned across sources.',
    rumorPenalty >= 12 ? 'Rumor or hedge language is elevated inside the cluster.' : 'Hedge language remains contained.',
  ];

  return {
    sourceDiversity,
    corroborationQuality,
    contradictionPenalty,
    rumorPenalty,
    hedgedSourceRatio: Number(hedgedSourceRatio.toFixed(4)),
    notes,
  };
}

export function assessRecency(args: {
  lastUpdatedAt?: string | null;
  observations?: number | null;
  nowIso: string;
}): RecencyAssessment {
  const ageDays = args.lastUpdatedAt
    ? Math.max(0, (asTs(args.nowIso) - asTs(args.lastUpdatedAt)) / 86_400_000)
    : 999;
  const observations = Math.max(0, Number(args.observations) || 0);
  const timeDecayWeight = args.lastUpdatedAt
    ? clamp(Number(Math.exp(-ageDays / 110).toFixed(4)), 0.12, 1)
    : 0.18;
  const recentEvidenceScore = clamp(
    Math.round(
      18
      + Math.min(36, observations * 7)
      + Math.max(0, 60 - ageDays) * 0.28
      + Math.max(0, 14 - ageDays) * 0.8,
    ),
    8,
    98,
  );
  const stalePenalty = clamp(
    Math.round(
      (ageDays > 45 ? (ageDays - 45) * 0.24 : 0)
      + (ageDays > 120 ? 8 : 0)
      + (observations < 3 ? 10 : 0),
    ),
    0,
    34,
  );
  const floorBreached = recentEvidenceScore < 36 || (ageDays > 90 && observations < 5);

  const notes = [
    args.lastUpdatedAt ? `${ageDays.toFixed(1)}d since the last matched realized sample.` : 'No realized sample exists yet for this mapping.',
    floorBreached ? 'Recent evidence floor is weak for live deployment.' : 'Recent evidence floor is acceptable for live consideration.',
  ];

  return {
    ageDays: Number(ageDays.toFixed(2)),
    timeDecayWeight,
    recentEvidenceScore,
    stalePenalty,
    floorBreached,
    notes,
  };
}

export function assessExecutionReality(args: {
  assetKind: AutonomyAssetKind;
  liquidityScore: number;
  marketMovePct: number | null;
  timestamp: string;
}): RealityConstraintAssessment {
  const sessionState = inferSessionState(args.assetKind, args.timestamp);
  const tradableNow = sessionState !== 'closed' || args.assetKind === 'crypto';
  const volatilityBps = Math.max(0, Math.abs(args.marketMovePct ?? 0) * 7);
  const spreadBps = clamp(
    Math.round(sourceSpreadBaseline(args.assetKind) + volatilityBps * 0.32 + Math.max(0, 68 - args.liquidityScore) * 0.28),
    2,
    140,
  );
  const slippageBps = clamp(
    Math.round(sourceSlippageBaseline(args.assetKind) + volatilityBps * 0.48 + Math.max(0, 72 - args.liquidityScore) * 0.52),
    2,
    180,
  );
  const liquidityPenaltyPct = Number((Math.max(0, 62 - args.liquidityScore) * 0.018).toFixed(2));
  const sessionPenaltyPct = sessionState === 'closed'
    ? (args.assetKind === 'equity' || args.assetKind === 'etf' ? 0.55 : 0.28)
    : sessionState === 'extended'
      ? (args.assetKind === 'commodity' ? 0.12 : 0.18)
      : 0;
  const executionPenaltyPct = Number((
    spreadBps / 100
    + slippageBps / 100
    + liquidityPenaltyPct
    + sessionPenaltyPct
  ).toFixed(2));
  const realityScore = clamp(
    Math.round(
      100
      - executionPenaltyPct * 20
      - Math.max(0, 58 - args.liquidityScore) * 0.6
      - (tradableNow ? 0 : 10),
    ),
    10,
    98,
  );

  const notes = [
    `Session=${sessionState}${tradableNow ? '' : ' (deferred execution risk)'}.`,
    `Estimated spread ${spreadBps}bps and slippage ${slippageBps}bps.`,
    args.liquidityScore < 60 ? 'Liquidity is below the preferred execution floor.' : 'Liquidity is sufficient for a pilot-size deployment.',
  ];

  return {
    sessionState,
    tradableNow,
    spreadBps,
    slippageBps,
    liquidityPenaltyPct,
    executionPenaltyPct,
    realityScore,
    notes,
  };
}

export function calibrateDecision(args: {
  conviction: number;
  falsePositiveRisk: number;
  corroborationQuality: number;
  contradictionPenalty: number;
  rumorPenalty: number;
  recentEvidenceScore: number;
  realityScore: number;
  floorBreached: boolean;
  rollbackLevel: RollbackLevel;
  shadowMode: boolean;
  direction: 'long' | 'short' | 'hedge' | 'watch' | 'pair';
}): CalibratedDecision {
  const calibratedConfidence = clamp(
    Math.round(
      args.conviction * 0.36
      + (100 - args.falsePositiveRisk) * 0.24
      + args.corroborationQuality * 0.16
      + args.recentEvidenceScore * 0.12
      + args.realityScore * 0.12
      - args.contradictionPenalty * 0.6
      - args.rumorPenalty * 0.45
      - (args.rollbackLevel === 'armed' ? 10 : args.rollbackLevel === 'watch' ? 4 : 0)
      - (args.shadowMode ? 4 : 0),
    ),
    0,
    99,
  );
  const confidenceBand: ConfidenceBand = calibratedConfidence >= 78
    ? 'high'
    : calibratedConfidence >= 62
      ? 'building'
      : calibratedConfidence >= 44
        ? 'guarded'
        : 'low';

  const reasons: string[] = [];
  if (args.floorBreached) reasons.push('Recent evidence is too thin for direct deployment.');
  if (args.contradictionPenalty >= 14) reasons.push('Cross-source contradiction remains elevated.');
  if (args.rumorPenalty >= 12) reasons.push('Rumor or hedge language is still elevated.');
  if (args.realityScore < 42) reasons.push('Execution reality score is below the deploy threshold.');
  if (args.rollbackLevel === 'armed') reasons.push('Shadow book rollback is armed after recent underperformance.');
  if (args.shadowMode && args.rollbackLevel !== 'armed') reasons.push('Shadow mode is active until recent performance recovers.');

  const adaptiveAbstainFloor = clamp(
    Math.round(
      28
      + (args.floorBreached ? 6 : 0)
      + Math.max(0, 42 - args.realityScore) * 0.18
      + args.contradictionPenalty * 0.14
      + args.rumorPenalty * 0.08
      - Math.max(0, args.corroborationQuality - 55) * 0.06
      - Math.max(0, args.recentEvidenceScore - 48) * 0.05,
    ),
    20,
    44,
  );
  const adaptiveShadowFloor = clamp(
    Math.round(
      52
      + (args.floorBreached ? 4 : 0)
      + args.contradictionPenalty * 0.16
      + args.rumorPenalty * 0.08
      + Math.max(0, 48 - args.realityScore) * 0.08
      - Math.max(0, args.recentEvidenceScore - 50) * 0.05,
    ),
    42,
    64,
  );
  const adaptiveWatchFloor = clamp(
    Math.round(
      68
      + args.rumorPenalty * 0.18
      + Math.max(0, 46 - args.realityScore) * 0.06
      - Math.max(0, args.corroborationQuality - 55) * 0.06,
    ),
    54,
    78,
  );

  let action: AutonomyAction = 'deploy';
  if (args.direction === 'watch') {
    action = 'watch';
  } else if (
    calibratedConfidence < adaptiveAbstainFloor
    || args.realityScore < 30
    || args.falsePositiveRisk >= 78
  ) {
    action = 'abstain';
  } else if (
    args.rollbackLevel === 'armed'
    || args.shadowMode
    || (args.floorBreached && calibratedConfidence < adaptiveWatchFloor)
    || calibratedConfidence < adaptiveShadowFloor
    || args.contradictionPenalty >= 16
  ) {
    action = 'shadow';
  } else if (
    calibratedConfidence < adaptiveWatchFloor
    || args.rollbackLevel === 'watch'
    || args.rumorPenalty >= 10
    || args.realityScore < 48
  ) {
    action = 'watch';
  }

  if (!reasons.length) {
    reasons.push(action === 'deploy'
      ? 'Cross-source evidence, recency, and execution checks are aligned.'
      : action === 'shadow'
        ? 'Keep the idea in paper-trade mode until live evidence improves.'
        : action === 'watch'
          ? 'Monitor for stronger confirmation before deploying capital.'
          : 'Stand down until recent evidence and execution quality improve.');
  }

  return {
    calibratedConfidence,
    confidenceBand,
    action,
    reasons,
  };
}

function pushUnique(target: string[], values: string[]): void {
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (!trimmed || target.includes(trimmed)) continue;
    target.push(trimmed);
  }
}

export function buildDecisionExplanation(args: {
  label?: string;
  calibratedDecision: CalibratedDecision;
  corroboration: CrossCorroborationAssessment;
  recency: RecencyAssessment;
  reality: RealityConstraintAssessment;
  shadow: ShadowControlState;
  extraSignals?: string[];
}): DecisionExplanationPayload {
  const label = String(args.label || 'Decision').trim() || 'Decision';
  const decision = args.calibratedDecision;
  const whyRecommended: string[] = [];
  const whySuppressed: string[] = [];
  const whyAbstained: string[] = [];

  if (decision.action === 'deploy') {
    whyRecommended.push('The decision cleared deploy because evidence, recency, and execution were all aligned.');
  } else if (decision.action === 'shadow') {
    whyRecommended.push('The decision is still actionable, but it is best kept in shadow mode first.');
  } else if (decision.action === 'watch') {
    whyRecommended.push('The decision is worth watching, but not yet strong enough for direct deployment.');
  } else {
    whyRecommended.push('The decision remains valuable as a signal, but not as a deployable trade yet.');
  }

  if (args.corroboration.corroborationQuality >= 70) {
    whyRecommended.push(`Corroboration quality is ${args.corroboration.corroborationQuality}/100.`);
  }
  if (args.recency.recentEvidenceScore >= 60) {
    whyRecommended.push(`Recent evidence score is ${args.recency.recentEvidenceScore}/100.`);
  }
  if (args.reality.realityScore >= 60) {
    whyRecommended.push(`Execution reality score is ${args.reality.realityScore}/100.`);
  }
  if (args.shadow.rollbackLevel === 'normal') {
    whyRecommended.push('Shadow rollback is not armed.');
  }

  if (decision.action !== 'deploy') {
    whySuppressed.push(`Action resolved to ${decision.action}, so the idea was not promoted to full deployment.`);
  }
  if (args.corroboration.contradictionPenalty > 0) {
    whySuppressed.push(`Cross-source contradiction penalty is ${args.corroboration.contradictionPenalty}.`);
  }
  if (args.corroboration.rumorPenalty > 0) {
    whySuppressed.push(`Rumor or hedge language penalty is ${args.corroboration.rumorPenalty}.`);
  }
  if (args.recency.floorBreached) {
    whySuppressed.push('Recent evidence floor was breached.');
  }
  if (!args.reality.tradableNow) {
    whySuppressed.push(`The market is not tradable now (${args.reality.sessionState}).`);
  } else if (args.reality.realityScore < 48) {
    whySuppressed.push(`Execution reality score is ${args.reality.realityScore}/100.`);
  }
  if (args.shadow.rollbackLevel === 'armed') {
    whySuppressed.push('Shadow control rollback is armed.');
  } else if (args.shadow.shadowMode) {
    whySuppressed.push('Shadow mode is active until recent performance recovers.');
  }

  if (decision.action === 'abstain') {
    whyAbstained.push('The calibrated decision dropped below the abstain floor.');
  }
  if (decision.reasons.length) {
    pushUnique(whyAbstained, decision.reasons);
  }
  if (args.corroboration.corroborationQuality < 40) {
    whyAbstained.push(`Corroboration quality is only ${args.corroboration.corroborationQuality}/100.`);
  }
  if (args.recency.recentEvidenceScore < 36) {
    whyAbstained.push(`Recent evidence score is only ${args.recency.recentEvidenceScore}/100.`);
  }
  if (args.reality.realityScore < 30) {
    whyAbstained.push(`Execution reality score is ${args.reality.realityScore}/100, below the deploy floor.`);
  }

  const recommended = whyRecommended.slice();
  const suppressed = whySuppressed.slice();
  const abstained = whyAbstained.slice();
  pushUnique(whyRecommended, recommended);
  pushUnique(whySuppressed, suppressed);
  pushUnique(whyAbstained, abstained);

  const signals = [
    `${label}`,
    `action=${decision.action}`,
    `confidence=${decision.calibratedConfidence}`,
    `band=${decision.confidenceBand}`,
    `corroboration=${args.corroboration.corroborationQuality}`,
    `recency=${args.recency.recentEvidenceScore}`,
    `reality=${args.reality.realityScore}`,
    `shadow=${args.shadow.rollbackLevel}`,
    `tradable=${args.reality.tradableNow ? 'yes' : 'no'}`,
  ];
  pushUnique(signals, Array.isArray(args.extraSignals) ? args.extraSignals : []);

  return {
    label,
    action: decision.action,
    calibratedConfidence: decision.calibratedConfidence,
    confidenceBand: decision.confidenceBand,
    whyRecommended: whyRecommended.slice(0, 8),
    whySuppressed: whySuppressed.slice(0, 8),
    whyAbstained: whyAbstained.slice(0, 8),
    signals,
  };
}

export function buildShadowControlState(ideas: ShadowIdeaLike[], nowIso: string): ShadowControlState {
  const nowTs = asTs(nowIso);
  const recentWindowMs = 21 * 86_400_000;
  const recentClosed = ideas.filter((idea) =>
    idea.status === 'closed'
    && idea.closedAt
    && nowTs - asTs(idea.closedAt) <= recentWindowMs,
  );
  const recentReturns = recentClosed
    .map((idea) => idea.realizedReturnPct)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const recentHitRate = recentReturns.length > 0
    ? Math.round((recentReturns.filter((value) => value > 0).length / recentReturns.length) * 100)
    : 0;
  const recentAvgReturnPct = Number(average(recentReturns).toFixed(2));

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of recentReturns) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }
  const recentDrawdownPct = Number(Math.abs(maxDrawdown).toFixed(2));
  const staleIdeaCount = ideas.filter((idea) =>
    idea.status === 'open'
    && idea.daysHeld >= 7
    && idea.falsePositiveRisk >= 58,
  ).length;

  let rollbackLevel: RollbackLevel = 'normal';
  if (recentReturns.length >= 4 && (recentHitRate < 38 || recentAvgReturnPct <= -0.75 || recentDrawdownPct >= 4.5)) {
    rollbackLevel = 'armed';
  } else if (recentReturns.length >= 2 && (recentHitRate < 48 || recentAvgReturnPct < 0 || recentDrawdownPct >= 2.5)) {
    rollbackLevel = 'watch';
  }

  const shadowMode = rollbackLevel !== 'normal' || staleIdeaCount >= 3;
  const notes = [
    `${recentReturns.length} closed shadow samples inside the last 21d.`,
    rollbackLevel === 'armed'
      ? 'Rollback is armed until the shadow book recovers.'
      : rollbackLevel === 'watch'
        ? 'Shadow book performance is soft and being watched.'
        : 'Shadow book is inside normal bounds.',
  ];
  if (staleIdeaCount > 0) {
    notes.push(`${staleIdeaCount} stale open ideas are dragging the shadow book.`);
  }

  return {
    shadowMode,
    rollbackLevel,
    recentSampleCount: recentReturns.length,
    recentHitRate,
    recentAvgReturnPct,
    recentDrawdownPct,
    staleIdeaCount,
    notes,
  };
}
