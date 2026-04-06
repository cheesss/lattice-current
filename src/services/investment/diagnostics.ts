import type {
  ThemeDiagnosticsSnapshot,
  ThemeDiagnosticsRow,
  IdeaCardExplanationPayload,
  CurrentDecisionSupportItem,
  CurrentDecisionSupportSnapshot,
  WorkflowDropoffSummary,
  WorkflowDropoffStageSummary,
  InvestmentWorkflowStep,
  WorkflowStatus,
  DirectAssetMapping,
  InvestmentIdeaCard,
  TrackedIdeaState,
  EventBacktestRow,
  SectorSensitivityRow,
  FalsePositiveStats,
  AutonomyControlState,
  HistoricalAnalog,
  ConfirmationState,
  InvestmentDirection,
} from './types';
import { average, clamp, nowIso, dedupeStrings } from './utils';
import { getThemeRule } from './theme-registry';
import {
  calibrateDecision,
  buildDecisionExplanation,
  type ShadowControlState,
  type AutonomyAction,
} from '../autonomy-constraints';
import {
  getCurrentThemePerformanceFromSnapshot,
  getReplayThemeProfileFromSnapshot,
  type ReplayAdaptationSnapshot,
} from '../replay-adaptation';
import {
  getCoveragePenaltyForTheme,
} from '../coverage-ledger';

type InvestmentIntelligenceSnapshot = any;

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-/.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeInvestmentIdeaCard(card: InvestmentIdeaCard): InvestmentIdeaCard {
  return {
    ...card,
    calibratedConfidence: Number(card.calibratedConfidence) || Number(card.conviction) || 0,
    confidenceBand: card.confidenceBand || 'guarded',
    autonomyAction: card.autonomyAction || (card.direction === 'watch' ? 'watch' : 'shadow'),
    autonomyReasons: Array.isArray(card.autonomyReasons) ? card.autonomyReasons.slice(0, 6) : [],
    realityScore: Number(card.realityScore) || 0,
    graphSignalScore: Number(card.graphSignalScore) || 0,
    timeDecayWeight: Number(card.timeDecayWeight) || 0,
    recentEvidenceScore: Number(card.recentEvidenceScore) || 0,
    corroborationQuality: Number(card.corroborationQuality) || 0,
    transferEntropy: Number(card.transferEntropy) || 0,
    banditScore: Number(card.banditScore) || 0,
    regimeMultiplier: Number(card.regimeMultiplier) || 1,
    convictionFeatures: card.convictionFeatures || undefined,
    confirmationScore: clamp(Number(card.confirmationScore) || Number(card.calibratedConfidence) || 0, 0, 100),
    confirmationState: card.confirmationState === 'confirmed' || card.confirmationState === 'tentative' || card.confirmationState === 'fading'
      ? card.confirmationState
      : 'contradicted',
    sizeMultiplier: clamp(Number(card.sizeMultiplier) || 1, 0, 1.5),
    horizonMultiplier: clamp(Number(card.horizonMultiplier) || 1, 0.4, 1.6),
    executionGate: typeof card.executionGate === 'boolean' ? card.executionGate : card.autonomyAction !== 'abstain',
    coveragePenalty: clamp(Number(card.coveragePenalty) || 0, 0, 100),
    attribution: card.attribution || {
      primaryDriver: 'Unspecified',
      primaryPenalty: 'Unspecified',
      components: [],
      narrative: '',
      failureModes: [],
    },
    symbols: Array.isArray(card.symbols) ? card.symbols.map((symbol) => ({
      ...symbol,
      liquidityScore: typeof symbol.liquidityScore === 'number' ? symbol.liquidityScore : null,
      realityScore: typeof symbol.realityScore === 'number' ? symbol.realityScore : null,
    })) : [],
    preferredHorizonHours: typeof card.preferredHorizonHours === 'number' ? Math.max(1, Math.round(card.preferredHorizonHours)) : null,
    horizonCandidatesHours: Array.isArray(card.horizonCandidatesHours)
      ? Array.from(new Set(card.horizonCandidatesHours.map((value) => Math.max(1, Math.round(Number(value) || 0))).filter(Boolean))).sort((a, b) => a - b)
      : [],
    horizonLearningConfidence: typeof card.horizonLearningConfidence === 'number' ? clamp(Math.round(card.horizonLearningConfidence), 0, 99) : null,
    timeframeSource: card.timeframeSource === 'replay-learned' ? 'replay-learned' : 'theme-default',
  };
}

function confirmationStateFromScore(score: number): ConfirmationState {
  if (score >= 72) return 'confirmed';
  if (score >= 54) return 'tentative';
  if (score >= 38) return 'fading';
  return 'contradicted';
}

function emptyShadowControlState(): ShadowControlState {
  return {
    shadowMode: false,
    rollbackLevel: 'normal',
    recentSampleCount: 0,
    recentHitRate: 0,
    recentAvgReturnPct: 0,
    recentDrawdownPct: 0,
    staleIdeaCount: 0,
    notes: [],
  };
}

function resolveThemeLabelFor(themeId: string, mappings: DirectAssetMapping[], ideaCards: InvestmentIdeaCard[]): string {
  const mapping = mappings.find((item) => normalize(item.themeId) === normalize(themeId));
  if (mapping?.themeLabel) return mapping.themeLabel;
  const card = ideaCards.find((item) => normalize(item.themeId) === normalize(themeId));
  if (card?.title) return card.title.split('|')[0]?.trim() || card.title;
  return getThemeRule(themeId)?.label || themeId;
}

function statusFromDiagnosticScore(score: number): 'ready' | 'watch' | 'blocked' {
  if (score >= 68) return 'ready';
  if (score >= 44) return 'watch';
  return 'blocked';
}

export function buildThemeDiagnosticsSnapshot(args: {
  snapshot: InvestmentIntelligenceSnapshot | null;
  replayAdaptation?: ReplayAdaptationSnapshot | null;
}): ThemeDiagnosticsSnapshot {
  const snapshot = args.snapshot;
  const replayAdaptation = args.replayAdaptation ?? null;
  const generatedAt = snapshot?.generatedAt || nowIso();
  if (!snapshot) {
    return {
      generatedAt,
      globalCoverageDensity: 0,
      globalCompletenessScore: 0,
      readyCount: 0,
      watchCount: 0,
      blockedCount: 0,
      rows: [],
    };
  }

  const themeIds = Array.from(new Set([
    ...snapshot.directMappings.map((mapping: DirectAssetMapping) => mapping.themeId),
    ...snapshot.ideaCards.map((card: InvestmentIdeaCard) => card.themeId),
    ...(replayAdaptation?.themeProfiles || []).map((profile) => profile.themeId),
    ...(replayAdaptation?.currentThemePerformance || []).map((metric) => metric.themeId),
  ].filter(Boolean)));

  const rows = themeIds.map((themeId) => {
    const themeMappings = snapshot.directMappings.filter((mapping: DirectAssetMapping) => normalize(mapping.themeId) === normalize(themeId));
    const themeCards = snapshot.ideaCards.filter((card: InvestmentIdeaCard) => normalize(card.themeId) === normalize(themeId));
    const themeLabel = resolveThemeLabelFor(themeId, snapshot.directMappings, snapshot.ideaCards);
    const coverage = getCoveragePenaltyForTheme(snapshot.coverageLedger || replayAdaptation?.coverageLedger || null, themeId);
    const replayProfile = getReplayThemeProfileFromSnapshot(replayAdaptation, themeId);
    const currentPerformance = getCurrentThemePerformanceFromSnapshot(replayAdaptation, themeId);
    const mappingConfirmation = themeMappings.length > 0
      ? average(themeMappings.map((mapping: DirectAssetMapping) => mapping.confirmationScore))
      : 0;
    const cardConfirmation = themeCards.length > 0
      ? average(themeCards.map((card: InvestmentIdeaCard) => card.confirmationScore))
      : 0;
    const confirmationScore = clamp(
      Math.round(
        (mappingConfirmation * 0.44)
        + (cardConfirmation * 0.34)
        + ((replayProfile?.confirmationReliability ?? currentPerformance?.confirmationScore ?? 0) * 0.22),
      ),
      0,
      100,
    );
    const currentHitRate = currentPerformance?.hitRate ?? null;
    const currentAvgReturnPct = currentPerformance?.avgReturnPct ?? null;
    const replayHitRate = replayProfile?.hitRate ?? null;
    const replayAvgReturnPct = replayProfile?.costAdjustedAvgReturnPct ?? null;
    const currentVsReplayDrift = replayProfile?.currentVsReplayDrift
      ?? (currentAvgReturnPct != null && replayAvgReturnPct != null
        ? Number((currentAvgReturnPct - replayAvgReturnPct).toFixed(2))
        : 0);
    const diagnosticScore = clamp(
      Math.round(
        confirmationScore * 0.34
        + coverage.completenessScore * 0.22
        + coverage.coverageDensity * 0.08
        + (themeCards.some((card: InvestmentIdeaCard) => card.executionGate) ? 8 : 0)
        + (replayProfile?.coverageAdjustedUtility ?? 0) * 0.08
        + (replayProfile?.confirmationReliability ?? 0) * 0.1
        + (currentPerformance ? currentPerformance.confirmationScore * 0.08 : 0)
        - coverage.coveragePenalty * 0.32
        - Math.min(24, Math.abs(currentVsReplayDrift) * 6),
      ),
      0,
      100,
    );
    const status = statusFromDiagnosticScore(diagnosticScore);
    const reasons = dedupeStrings([
      coverage.coveragePenalty >= 30 ? `Coverage penalty is ${coverage.coveragePenalty}.` : '',
      coverage.completenessScore < 55 ? `Coverage completeness is only ${coverage.completenessScore}/100.` : '',
      currentPerformance && currentPerformance.hitRate < 45 ? `Current hit-rate is ${currentPerformance.hitRate}%.` : '',
      replayProfile && replayProfile.confirmationReliability < 55
        ? `Replay reliability is ${Math.round(replayProfile.confirmationReliability)}/100.`
        : '',
      Math.abs(currentVsReplayDrift) >= 1.5 ? `Current-vs-replay drift is ${currentVsReplayDrift.toFixed(2)}.` : '',
      !themeCards.some((card: InvestmentIdeaCard) => card.executionGate) ? 'No executable idea card is currently cleared for this theme.' : '',
    ]);

    return {
      themeId,
      themeLabel,
      status,
      diagnosticScore,
      confirmationScore,
      confirmationState: confirmationStateFromScore(confirmationScore),
      coveragePenalty: coverage.coveragePenalty,
      coverageDensity: coverage.coverageDensity,
      completenessScore: coverage.completenessScore,
      currentHitRate,
      currentAvgReturnPct,
      replayHitRate,
      replayAvgReturnPct,
      currentVsReplayDrift: Number(currentVsReplayDrift.toFixed(2)),
      executionGate: themeCards.some((card: InvestmentIdeaCard) => card.executionGate),
      sizeMultiplier: Number(average(themeCards.map((card: InvestmentIdeaCard) => card.sizeMultiplier || 0)).toFixed(4)) || 0,
      horizonMultiplier: Number(average(themeCards.map((card: InvestmentIdeaCard) => card.horizonMultiplier || 0)).toFixed(4)) || 0,
      preferredHorizonHours: replayProfile?.preferredHorizonHours ?? themeCards[0]?.preferredHorizonHours ?? null,
      horizonLearningConfidence: replayProfile?.confidence ?? themeCards[0]?.horizonLearningConfidence ?? null,
      mappingCount: themeMappings.length,
      cardCount: themeCards.length,
      reasons,
    };
  }).sort((a, b) =>
    b.diagnosticScore - a.diagnosticScore
    || b.confirmationScore - a.confirmationScore
    || b.cardCount - a.cardCount
  );

  return {
    generatedAt,
    globalCoverageDensity: snapshot.coverageLedger?.globalCoverageDensity ?? replayAdaptation?.coverageLedger?.globalCoverageDensity ?? 0,
    globalCompletenessScore: snapshot.coverageLedger?.globalCompletenessScore ?? replayAdaptation?.coverageLedger?.globalCompletenessScore ?? 0,
    readyCount: rows.filter((row) => row.status === 'ready').length,
    watchCount: rows.filter((row) => row.status === 'watch').length,
    blockedCount: rows.filter((row) => row.status === 'blocked').length,
    rows,
  };
}

export function buildIdeaCardExplanationPayload(args: {
  card: InvestmentIdeaCard;
  snapshot?: InvestmentIntelligenceSnapshot | null;
  replayAdaptation?: ReplayAdaptationSnapshot | null;
  themeDiagnostics?: ThemeDiagnosticsSnapshot | null;
}): IdeaCardExplanationPayload {
  const card = normalizeInvestmentIdeaCard(args.card);
  const replayAdaptation = args.replayAdaptation ?? null;
  const shadow = args.snapshot?.autonomy || emptyShadowControlState();
  const themeDiagnostics = args.themeDiagnostics || buildThemeDiagnosticsSnapshot({
    snapshot: args.snapshot ?? null,
    replayAdaptation,
  });
  const themeRow = themeDiagnostics.rows.find((row) => normalize(row.themeId) === normalize(card.themeId)) || null;
  const corroboration: Parameters<typeof buildDecisionExplanation>[0]['corroboration'] = {
    sourceDiversity: clamp(Math.round(card.symbols.length * 18 + card.evidence.length * 7), 10, 98),
    corroborationQuality: clamp(Math.round(card.confirmationScore * 0.72 + (100 - card.falsePositiveRisk) * 0.22), 8, 98),
    contradictionPenalty: clamp(Math.round(Math.max(0, 62 - card.confirmationScore) * 0.28 + (card.confirmationState === 'contradicted' ? 10 : 0)), 0, 28),
    rumorPenalty: clamp(Math.round(card.direction === 'watch' ? 4 : 0), 0, 16),
    hedgedSourceRatio: card.direction === 'watch' ? 0.5 : 0.12,
    notes: [],
  };
  const recency: Parameters<typeof buildDecisionExplanation>[0]['recency'] = {
    ageDays: Math.max(0, 30 - Math.min(30, card.recentEvidenceScore / 3)),
    timeDecayWeight: clamp(Number((card.timeDecayWeight || 0.5).toFixed(4)), 0.12, 1),
    recentEvidenceScore: clamp(Math.round(card.recentEvidenceScore), 0, 100),
    stalePenalty: clamp(Math.round(Math.max(0, 48 - card.recentEvidenceScore) * 0.4), 0, 34),
    floorBreached: card.recentEvidenceScore < 36,
    notes: [],
  };
  const reality: Parameters<typeof buildDecisionExplanation>[0]['reality'] = {
    sessionState: card.executionGate ? 'open' : 'closed',
    tradableNow: card.executionGate,
    spreadBps: clamp(Math.round((100 - card.realityScore) * 1.1), 2, 140),
    slippageBps: clamp(Math.round((100 - card.realityScore) * 1.4), 2, 180),
    liquidityPenaltyPct: Number(Math.max(0, 60 - card.realityScore).toFixed(2)),
    executionPenaltyPct: Number(Math.max(0, (100 - card.realityScore) / 12).toFixed(2)),
    realityScore: clamp(Math.round(card.realityScore), 0, 100),
    notes: [],
  };
  const calibratedDecision = calibrateDecision({
    conviction: card.conviction,
    falsePositiveRisk: card.falsePositiveRisk,
    corroborationQuality: corroboration.corroborationQuality,
    contradictionPenalty: corroboration.contradictionPenalty,
    rumorPenalty: corroboration.rumorPenalty,
    recentEvidenceScore: recency.recentEvidenceScore,
    realityScore: reality.realityScore,
    floorBreached: recency.floorBreached,
    rollbackLevel: args.snapshot?.autonomy.rollbackLevel || 'normal',
    shadowMode: args.snapshot?.autonomy.shadowMode || false,
    direction: card.direction,
  });
  const explanation = buildDecisionExplanation({
    label: `${card.themeId} | ${card.title}`,
    calibratedDecision,
    corroboration,
    recency,
    reality,
    shadow,
    extraSignals: [
      `confirmation=${card.confirmationScore}`,
      `coveragePenalty=${card.coveragePenalty}`,
      `drift=${themeRow?.currentVsReplayDrift ?? 0}`,
      `sizeMultiplier=${card.sizeMultiplier.toFixed(4)}`,
      `horizonMultiplier=${card.horizonMultiplier.toFixed(4)}`,
    ],
  });
  const whyRecommended = dedupeStrings([
    ...explanation.whyRecommended,
    card.confirmationState === 'confirmed' ? 'Theme confirmation is strong enough for a live recommendation.' : '',
    card.executionGate ? 'Execution gate is open for this card.' : '',
    card.confirmationScore >= 70 ? `Confirmation score is ${card.confirmationScore}/100.` : '',
    themeRow && themeRow.status === 'ready' ? 'Theme diagnostics place this theme in the ready bucket.' : '',
  ]);
  const whySuppressed = dedupeStrings([
    ...explanation.whySuppressed,
    !card.executionGate ? 'Execution gate is closed for this card.' : '',
    card.confirmationState === 'fading' ? 'The theme is fading relative to replay history.' : '',
    card.confirmationState === 'contradicted' ? 'Current evidence contradicts the theme thesis.' : '',
    card.coveragePenalty >= 28 ? `Coverage penalty is ${card.coveragePenalty}.` : '',
    Math.abs(themeRow?.currentVsReplayDrift ?? 0) >= 1.5
      ? `Current-vs-replay drift is ${(themeRow?.currentVsReplayDrift || 0).toFixed(2)}.`
      : '',
    card.autonomyAction !== 'deploy' ? `Autonomy action is ${card.autonomyAction}.` : '',
  ]);
  const whyAbstained = dedupeStrings([
    ...explanation.whyAbstained,
    card.autonomyAction === 'abstain' ? 'The card was dropped into abstain by the autonomy layer.' : '',
    card.confirmationScore < 36 ? `Confirmation score is only ${card.confirmationScore}/100.` : '',
    card.realityScore < 42 ? `Execution reality score is ${card.realityScore}/100.` : '',
    card.coveragePenalty >= 35 ? `Coverage penalty is ${card.coveragePenalty}.` : '',
    themeRow && themeRow.status === 'blocked' ? 'Theme diagnostics are blocked for the current regime.' : '',
  ]);

  let status: IdeaCardExplanationPayload['status'] = 'watch';
  if (card.autonomyAction === 'abstain' || card.confirmationState === 'contradicted') {
    status = 'abstained';
  } else if (card.autonomyAction === 'deploy' && card.executionGate && card.confirmationState === 'confirmed') {
    status = 'recommended';
  } else if (card.autonomyAction === 'watch') {
    status = 'watch';
  } else {
    status = 'suppressed';
  }

  return {
    ...explanation,
    cardId: card.id,
    title: card.title,
    themeId: card.themeId,
    themeLabel: themeRow?.themeLabel || card.title.split('|')[0]?.trim() || card.themeId,
    direction: card.direction,
    confirmationScore: card.confirmationScore,
    confirmationState: card.confirmationState,
    coveragePenalty: card.coveragePenalty,
    currentVsReplayDrift: Number((themeRow?.currentVsReplayDrift ?? 0).toFixed(2)),
    executionGate: card.executionGate,
    sizeMultiplier: card.sizeMultiplier,
    horizonMultiplier: card.horizonMultiplier,
    whyRecommended,
    whySuppressed,
    whyAbstained,
    status,
  };
}

function buildCurrentDecisionSupportItem(args: {
  bucket: CurrentDecisionSupportItem['bucket'];
  card: InvestmentIdeaCard;
  explanation: IdeaCardExplanationPayload;
  themeRow: ThemeDiagnosticsRow | null;
  snapshot: InvestmentIntelligenceSnapshot;
}): CurrentDecisionSupportItem {
  const { bucket, card, explanation, themeRow, snapshot } = args;
  const primarySymbols = card.symbols
    .filter((symbol) => symbol.role !== 'hedge')
    .map((symbol) => String(symbol.symbol || '').trim())
    .filter(Boolean);
  const allSymbols = card.symbols
    .map((symbol) => String(symbol.symbol || '').trim())
    .filter(Boolean);
  const symbols = Array.from(new Set((primarySymbols.length ? primarySymbols : allSymbols).slice(0, 3)));
  const matchingBacktests = snapshot.backtests
    .filter((row: EventBacktestRow) => row.themeId === card.themeId && (!symbols.length || symbols.includes(row.symbol)))
    .sort((a: EventBacktestRow, b: EventBacktestRow) => b.confidence - a.confidence || b.avgReturnPct - a.avgReturnPct)
    .slice(0, 3);
  const replayAvgReturnPct = matchingBacktests.length > 0
    ? Number(average(matchingBacktests.map((row: EventBacktestRow) => row.avgReturnPct)).toFixed(2))
    : themeRow?.replayAvgReturnPct ?? card.backtestAvgReturnPct ?? null;
  const replayHitRate = matchingBacktests.length > 0
    ? Number(average(matchingBacktests.map((row: EventBacktestRow) => row.hitRate)).toFixed(2))
    : themeRow?.replayHitRate ?? card.backtestHitRate ?? null;
  const currentAvgReturnPct = themeRow?.currentAvgReturnPct ?? card.liveReturnPct ?? null;
  const currentHitRate = themeRow?.currentHitRate ?? null;
  const currentVsReplayDrift = Number((themeRow?.currentVsReplayDrift ?? 0).toFixed(2));
  const assetKinds = new Set(card.symbols.map((symbol) => symbol.assetKind).filter(Boolean));
  const singleNameRisk = card.symbols.some((symbol) => symbol.assetKind === 'equity' && symbol.role !== 'hedge')
    && !card.symbols.some((symbol) => /\^/.test(symbol.symbol || '') || /(ETF|FUND)/i.test(symbol.name || ''));
  const rationaleBase = bucket === 'act-now'
    ? explanation.whyRecommended
    : bucket === 'defensive'
      ? explanation.whyRecommended
      : bucket === 'avoid'
        ? explanation.whySuppressed
        : explanation.whyRecommended;
  const cautionBase = bucket === 'avoid'
    ? explanation.whyAbstained.concat(explanation.whySuppressed)
    : explanation.whySuppressed.concat(explanation.whyAbstained);
  const rationale = dedupeStrings([
    ...rationaleBase,
    replayAvgReturnPct != null ? `Historical average return for similar theme/symbol paths is ${replayAvgReturnPct.toFixed(2)}%.` : '',
    replayHitRate != null ? `Historical hit rate is ${replayHitRate.toFixed(0)}%.` : '',
    currentAvgReturnPct != null ? `Recent live/current average is ${currentAvgReturnPct.toFixed(2)}%.` : '',
    bucket === 'defensive' ? 'This is useful as a downside cushion if the current regime stays stressed.' : '',
  ]).slice(0, 4);
  const caution = dedupeStrings([
    ...cautionBase,
    Math.abs(currentVsReplayDrift) >= 1.25 ? `Current-vs-replay drift is ${currentVsReplayDrift.toFixed(2)}.` : '',
    themeRow?.coveragePenalty != null && themeRow.coveragePenalty >= 24 ? `Coverage penalty is ${themeRow.coveragePenalty}.` : '',
    singleNameRisk ? 'Single-name exposure increases idiosyncratic risk relative to ETF/hedge expressions.' : '',
    assetKinds.has('crypto') ? 'Crypto-linked symbols can widen realized volatility quickly.' : '',
  ]).slice(0, 4);
  const suggestedAction = bucket === 'act-now'
    ? `Prefer ${symbols.join(', ') || card.themeId} on a ${card.direction} bias for roughly ${card.preferredHorizonHours ?? 'n/a'}h.`
    : bucket === 'defensive'
      ? `Keep ${symbols.join(', ') || card.themeId} available as defensive cover while regime stress stays elevated.`
      : bucket === 'avoid'
        ? `Avoid adding ${symbols.join(', ') || card.themeId} until drift and confirmation improve.`
        : `Watch ${symbols.join(', ') || card.themeId} for confirmation before committing capital.`;
  return {
    bucket,
    cardId: card.id,
    title: card.title,
    themeId: card.themeId,
    themeLabel: themeRow?.themeLabel || card.title.split('|')[0]?.trim() || card.themeId,
    action: card.autonomyAction,
    direction: card.direction,
    symbols,
    sizePct: card.sizePct,
    preferredHorizonHours: card.preferredHorizonHours ?? themeRow?.preferredHorizonHours ?? null,
    replayAvgReturnPct,
    replayHitRate,
    currentAvgReturnPct,
    currentHitRate,
    currentVsReplayDrift,
    rationale,
    caution,
    suggestedAction,
  };
}

export function buildCurrentDecisionSupportSnapshot(args: {
  snapshot: InvestmentIntelligenceSnapshot | null;
  replayAdaptation?: ReplayAdaptationSnapshot | null;
  themeDiagnostics?: ThemeDiagnosticsSnapshot | null;
}): CurrentDecisionSupportSnapshot {
  const snapshot = args.snapshot;
  const generatedAt = snapshot?.generatedAt || nowIso();
  if (!snapshot) {
    return {
      generatedAt,
      regimeLabel: 'Unavailable',
      regimeConfidence: 0,
      summary: ['No investment intelligence snapshot is available yet.'],
      actNow: [],
      defensive: [],
      avoid: [],
      watch: [],
    };
  }
  const replayAdaptation = args.replayAdaptation ?? null;
  const diagnostics = args.themeDiagnostics || buildThemeDiagnosticsSnapshot({
    snapshot,
    replayAdaptation,
  });
  const diagnosticByTheme = new Map(diagnostics.rows.map((row: ThemeDiagnosticsRow) => [normalize(row.themeId), row]));
  const explanationRows = snapshot.ideaCards
    .slice()
    .sort((left: InvestmentIdeaCard, right: InvestmentIdeaCard) => right.confirmationScore - left.confirmationScore || right.sizePct - left.sizePct)
    .map((card: InvestmentIdeaCard) => ({
      card,
      explanation: buildIdeaCardExplanationPayload({
        card,
        snapshot,
        replayAdaptation,
        themeDiagnostics: diagnostics,
      }),
      themeRow: diagnosticByTheme.get(normalize(card.themeId)) || null,
    }));

  const actNow = explanationRows
    .filter((row: any) => row.explanation.status === 'recommended')
    .sort((left: any, right: any) =>
      right.card.confirmationScore - left.card.confirmationScore
      || right.card.sizePct - left.card.sizePct
      || (right.themeRow?.currentAvgReturnPct ?? 0) - (left.themeRow?.currentAvgReturnPct ?? 0)
    )
    .slice(0, 3)
    .map((row: any) => buildCurrentDecisionSupportItem({
      bucket: 'act-now',
      card: row.card,
      explanation: row.explanation,
      themeRow: row.themeRow,
      snapshot,
    }));

  let defensive = explanationRows
    .filter((row: any) =>
      row.card.direction === 'hedge'
      || row.card.themeId === 'safe-haven-repricing'
      || row.card.symbols.some((symbol: any) => symbol.role === 'hedge'),
    )
    .sort((left: any, right: any) =>
      (right.themeRow?.currentAvgReturnPct ?? 0) - (left.themeRow?.currentAvgReturnPct ?? 0)
      || right.card.confirmationScore - left.card.confirmationScore
    )
    .slice(0, 3)
    .map((row: any) => buildCurrentDecisionSupportItem({
      bucket: 'defensive',
      card: row.card,
      explanation: row.explanation,
      themeRow: row.themeRow,
      snapshot,
    }));

  if (!defensive.length) {
    defensive = snapshot.macroOverlay.hedgeBias.slice(0, 3).map((hedge: any) => ({
      bucket: 'defensive' as const,
      cardId: null,
      title: `Macro Hedge Overlay | ${hedge.symbol}`,
      themeId: 'safe-haven-repricing',
      themeLabel: 'Safe-Haven Repricing',
      action: 'watch' as AutonomyAction,
      direction: 'hedge' as InvestmentDirection,
      symbols: [hedge.symbol],
      sizePct: hedge.weightPct,
      preferredHorizonHours: 72,
      replayAvgReturnPct: null,
      replayHitRate: null,
      currentAvgReturnPct: null,
      currentHitRate: null,
      currentVsReplayDrift: 0,
      rationale: [
        hedge.reason,
        `Macro overlay is ${snapshot.macroOverlay.topDownAction.toUpperCase()} in a ${snapshot.macroOverlay.state.toUpperCase()} state.`,
      ],
      caution: ['This is a top-down hedge suggestion, not a fully confirmed idea card.'],
      suggestedAction: `Use ${hedge.symbol} as defensive ballast around ${hedge.weightPct}% if risk stress persists.`,
    }));
  }

  let avoid = explanationRows
    .filter((row: any) =>
      row.explanation.status === 'abstained'
      || row.explanation.status === 'suppressed'
      || (row.themeRow?.currentVsReplayDrift ?? 0) <= -1.5
      || (row.themeRow?.currentAvgReturnPct ?? 0) <= -1,
    )
    .sort((left: any, right: any) =>
      (left.themeRow?.currentAvgReturnPct ?? 0) - (right.themeRow?.currentAvgReturnPct ?? 0)
      || (left.themeRow?.currentVsReplayDrift ?? 0) - (right.themeRow?.currentVsReplayDrift ?? 0)
    )
    .slice(0, 3)
    .map((row: any) => buildCurrentDecisionSupportItem({
      bucket: 'avoid',
      card: row.card,
      explanation: row.explanation,
      themeRow: row.themeRow,
      snapshot,
    }));

  if (!avoid.length) {
    avoid = diagnostics.rows
      .filter((row) => row.status === 'blocked' || row.currentVsReplayDrift <= -1.5 || (row.currentAvgReturnPct ?? 0) <= -1)
      .sort((left, right) =>
        (left.currentAvgReturnPct ?? 0) - (right.currentAvgReturnPct ?? 0)
        || left.currentVsReplayDrift - right.currentVsReplayDrift
      )
      .slice(0, 3)
      .map((row) => ({
        bucket: 'avoid' as const,
        cardId: null,
        title: `${row.themeLabel} | Theme-level Avoid`,
        themeId: row.themeId,
        themeLabel: row.themeLabel,
        action: 'abstain' as AutonomyAction,
        direction: 'watch' as InvestmentDirection,
        symbols: [],
        sizePct: 0,
        preferredHorizonHours: row.preferredHorizonHours ?? null,
        replayAvgReturnPct: row.replayAvgReturnPct ?? null,
        replayHitRate: row.replayHitRate ?? null,
        currentAvgReturnPct: row.currentAvgReturnPct ?? null,
        currentHitRate: row.currentHitRate ?? null,
        currentVsReplayDrift: row.currentVsReplayDrift,
        rationale: [
          ...(row.reasons.slice(0, 2)),
          row.currentAvgReturnPct != null ? `Recent theme average is ${row.currentAvgReturnPct.toFixed(2)}%.` : '',
        ].filter(Boolean),
        caution: [
          row.coveragePenalty >= 24 ? `Coverage penalty is ${row.coveragePenalty}.` : '',
          Math.abs(row.currentVsReplayDrift) >= 1.5 ? `Current-vs-replay drift is ${row.currentVsReplayDrift.toFixed(2)}.` : '',
        ].filter(Boolean),
        suggestedAction: `Underweight ${row.themeLabel} until drift, confirmation, and current performance recover.`,
      }));
  }

  let watch = explanationRows
    .filter((row: any) => row.explanation.status === 'watch' || row.explanation.status === 'suppressed')
    .filter((row: any) => !avoid.some((item: CurrentDecisionSupportItem) => item.cardId === row.card.id))
    .sort((left: any, right: any) =>
      right.card.recentEvidenceScore - left.card.recentEvidenceScore
      || right.card.confirmationScore - left.card.confirmationScore
    )
    .slice(0, 3)
    .map((row: any) => buildCurrentDecisionSupportItem({
      bucket: 'watch',
      card: row.card,
      explanation: row.explanation,
      themeRow: row.themeRow,
      snapshot,
    }));

  if (!watch.length) {
    watch = diagnostics.rows
      .filter((row) => row.status === 'watch')
      .sort((left, right) => right.diagnosticScore - left.diagnosticScore)
      .slice(0, 3)
      .map((row) => ({
        bucket: 'watch' as const,
        cardId: null,
        title: `${row.themeLabel} | Theme-level Watch`,
        themeId: row.themeId,
        themeLabel: row.themeLabel,
        action: 'watch' as AutonomyAction,
        direction: 'watch' as InvestmentDirection,
        symbols: [],
        sizePct: 0,
        preferredHorizonHours: row.preferredHorizonHours ?? null,
        replayAvgReturnPct: row.replayAvgReturnPct ?? null,
        replayHitRate: row.replayHitRate ?? null,
        currentAvgReturnPct: row.currentAvgReturnPct ?? null,
        currentHitRate: row.currentHitRate ?? null,
        currentVsReplayDrift: row.currentVsReplayDrift,
        rationale: row.reasons.slice(0, 3),
        caution: ['Theme diagnostics are not strong enough yet for direct deployment.'],
        suggestedAction: `Monitor ${row.themeLabel} for better confirmation and execution conditions.`,
      }));
  }

  const regimeLabel = snapshot.regime?.label || snapshot.macroOverlay.state.toUpperCase();
  const regimeConfidence = snapshot.regime?.confidence ?? snapshot.macroOverlay.riskGauge ?? 0;
  const summary = dedupeStrings([
    `Regime is ${regimeLabel} with confidence ${Math.round(regimeConfidence)} and top-down action ${snapshot.macroOverlay.topDownAction.toUpperCase()}.`,
    actNow.length > 0
      ? `${actNow.length} ideas are strong enough to act on now.`
      : 'No current card is strong enough for a clean act-now recommendation.',
    defensive.length > 0
      ? `${defensive.length} defensive/hedge expressions remain useful if stress persists.`
      : 'No clear defensive expression is currently surviving the ranking layer.',
    avoid.length > 0
      ? `${avoid.length} themes or cards should stay underweight until drift improves.`
      : 'No major avoid bucket is currently dominating the snapshot.',
  ]).slice(0, 4);

  return {
    generatedAt,
    regimeLabel,
    regimeConfidence: Number(regimeConfidence.toFixed(2)),
    summary,
    actNow,
    defensive,
    avoid,
    watch,
  };
}

export function buildWorkflowDropoffSummary(args: {
  snapshot: InvestmentIntelligenceSnapshot | null;
  replayAdaptation?: ReplayAdaptationSnapshot | null;
}): WorkflowDropoffSummary {
  const snapshot = args.snapshot;
  const replayAdaptation = args.replayAdaptation ?? null;
  const generatedAt = snapshot?.generatedAt || nowIso();
  if (!snapshot) {
    return {
      generatedAt,
      readyCount: 0,
      watchCount: 0,
      blockedCount: 0,
      stages: [],
    };
  }

  const diagnostics = buildThemeDiagnosticsSnapshot({ snapshot, replayAdaptation });
  const avgThemeDiagnostic = diagnostics.rows.length > 0
    ? average(diagnostics.rows.map((row: ThemeDiagnosticsRow) => row.diagnosticScore))
    : 0;
  const avgThemeDrift = diagnostics.rows.length > 0
    ? average(diagnostics.rows.map((row: ThemeDiagnosticsRow) => Math.abs(row.currentVsReplayDrift)))
    : 0;
  const avgCoveragePenalty = diagnostics.rows.length > 0
    ? average(diagnostics.rows.map((row: ThemeDiagnosticsRow) => row.coveragePenalty))
    : 0;
  const avgSizeMultiplier = snapshot.ideaCards.length > 0
    ? average(snapshot.ideaCards.map((card: InvestmentIdeaCard) => card.sizeMultiplier))
    : 0;
  const avgHorizonConfidence = snapshot.ideaCards.length > 0
    ? average(snapshot.ideaCards.map((card: InvestmentIdeaCard) => card.horizonLearningConfidence ?? 0))
    : 0;

  const stages: WorkflowDropoffStageSummary[] = snapshot.workflow.map((step: InvestmentWorkflowStep) => {
    const reasons: string[] = [];
    let keptCount = 0;
    let droppedCount = 0;

    switch (step.id) {
      case 'detect':
        keptCount = snapshot.falsePositive.kept;
        droppedCount = snapshot.falsePositive.rejected;
        if (snapshot.falsePositive.rejected > snapshot.falsePositive.kept) {
          reasons.push('More raw candidates were rejected than kept by the detector.');
        }
        if (snapshot.falsePositive.reasons.length > 0) {
          reasons.push(`Top reject reason: ${snapshot.falsePositive.reasons[0]!.reason}.`);
        }
        if (snapshot.coverageLedger && snapshot.coverageLedger.globalCompletenessScore < 55) {
          reasons.push(`Coverage completeness is only ${snapshot.coverageLedger.globalCompletenessScore}/100.`);
        }
        break;
      case 'validate':
        keptCount = snapshot.ideaCards.filter((card: InvestmentIdeaCard) => card.autonomyAction !== 'abstain').length;
        droppedCount = snapshot.autonomy.abstainCount;
        if (snapshot.autonomy.abstainCount > 0) {
          reasons.push(`${snapshot.autonomy.abstainCount} idea cards were pushed into abstain.`);
        }
        if (avgThemeDiagnostic < 55) {
          reasons.push(`Average theme diagnostic score is ${avgThemeDiagnostic.toFixed(0)}/100.`);
        }
        if (avgThemeDrift >= 1.5) {
          reasons.push(`Average current-vs-replay drift is ${avgThemeDrift.toFixed(2)}.`);
        }
        break;
      case 'map':
        keptCount = snapshot.directMappings.length;
        droppedCount = snapshot.autonomy.realityBlockedCount;
        if (snapshot.autonomy.realityBlockedCount > 0) {
          reasons.push(`${snapshot.autonomy.realityBlockedCount} mappings failed reality gates.`);
        }
        if (avgCoveragePenalty >= 24) {
          reasons.push(`Average coverage penalty is ${avgCoveragePenalty.toFixed(0)}.`);
        }
        if (keptCount === 0) {
          reasons.push('No theme-to-asset mappings survived the map stage.');
        }
        break;
      case 'stress-test':
        keptCount = snapshot.backtests.length;
        droppedCount = Math.max(0, snapshot.ideaCards.length - snapshot.backtests.length);
        if (replayAdaptation?.workflow.qualityScore && replayAdaptation.workflow.qualityScore < 55) {
          reasons.push(`Replay quality is only ${replayAdaptation.workflow.qualityScore}/100.`);
        }
        if (replayAdaptation?.workflow.executionScore && replayAdaptation.workflow.executionScore < 60) {
          reasons.push(`Replay execution score is only ${replayAdaptation.workflow.executionScore}/100.`);
        }
        if (keptCount === 0) {
          reasons.push('No backtest rows are available for stress testing.');
        }
        break;
      case 'size':
        keptCount = snapshot.autonomy.deployCount;
        droppedCount = snapshot.autonomy.shadowCount + snapshot.autonomy.watchCount + snapshot.autonomy.abstainCount;
        if (avgSizeMultiplier < 0.72) {
          reasons.push(`Average size multiplier is only ${avgSizeMultiplier.toFixed(2)}.`);
        }
        if (snapshot.autonomy.shadowCount > snapshot.autonomy.deployCount) {
          reasons.push('Shadow ideas outnumber deployable ideas.');
        }
        if (avgHorizonConfidence < 50) {
          reasons.push(`Average horizon confidence is only ${avgHorizonConfidence.toFixed(0)}/100.`);
        }
        break;
      case 'constrain':
        keptCount = snapshot.directMappings.filter((item: DirectAssetMapping) => item.tradableNow && item.realityScore >= 42).length;
        droppedCount = snapshot.autonomy.realityBlockedCount;
        if (snapshot.autonomy.realityBlockedCount > 0) {
          reasons.push(`${snapshot.autonomy.realityBlockedCount} signals were blocked by execution reality.`);
        }
        if (snapshot.autonomy.rollbackLevel !== 'normal') {
          reasons.push(`Rollback level is ${snapshot.autonomy.rollbackLevel}.`);
        }
        break;
      case 'monitor':
        keptCount = snapshot.autonomy.shadowMode ? snapshot.autonomy.shadowCount : snapshot.autonomy.deployCount + snapshot.autonomy.shadowCount;
        droppedCount = snapshot.autonomy.staleIdeaCount;
        if (snapshot.autonomy.shadowMode) {
          reasons.push('Shadow mode is active for live monitoring.');
        }
        if (snapshot.autonomy.recentHitRate < 48) {
          reasons.push(`Recent hit-rate is only ${snapshot.autonomy.recentHitRate}%.`);
        }
        if (snapshot.autonomy.staleIdeaCount > 0) {
          reasons.push(`${snapshot.autonomy.staleIdeaCount} stale ideas are still open.`);
        }
        break;
      default:
        keptCount = 0;
        droppedCount = 0;
        break;
    }

    if (!reasons.length) {
      reasons.push(step.summary);
    }

    return {
      id: step.id,
      label: step.label,
      status: step.status,
      metric: step.metric,
      keptCount,
      droppedCount,
      reasons: dedupeStrings(reasons).slice(0, 5),
    };
  });

  return {
    generatedAt,
    readyCount: stages.filter((stage) => stage.status === 'ready').length,
    watchCount: stages.filter((stage) => stage.status === 'watch').length,
    blockedCount: stages.filter((stage) => stage.status === 'blocked').length,
    stages,
  };
}

export function buildWorkflow(args: {
  falsePositive: FalsePositiveStats;
  mappings: DirectAssetMapping[];
  ideaCards: InvestmentIdeaCard[];
  analogs: HistoricalAnalog[];
  sensitivity: SectorSensitivityRow[];
  trackedIdeas: TrackedIdeaState[];
  backtests: EventBacktestRow[];
  autonomy: AutonomyControlState;
  replayAdaptation: ReplayAdaptationSnapshot | null;
}): InvestmentWorkflowStep[] {
  const steps: InvestmentWorkflowStep[] = [];

  // Build workflow steps based on diagnostic scores
  const themeIds = Array.from(new Set([
    ...args.mappings.map((m) => m.themeId),
    ...args.ideaCards.map((c) => c.themeId),
    ...(args.replayAdaptation?.themeProfiles || []).map((p) => p.themeId),
  ].filter(Boolean)));

  for (const themeId of themeIds) {
    const themeMappings = args.mappings.filter((m) => m.themeId === themeId);
    const themeCards = args.ideaCards.filter((c) => c.themeId === themeId);
    const themeLabel = themeCards[0]?.themeId || themeMappings[0]?.themeLabel || themeId;

    const confirmationScore = themeMappings.length > 0
      ? average(themeMappings.map((m) => m.confirmationScore))
      : 0;

    const diagnosticScore = clamp(
      Math.round(confirmationScore * 0.5 + (themeCards.length > 0 ? 50 : 0)),
      0,
      100,
    );

    const status: WorkflowStatus = diagnosticScore >= 68 ? 'ready' : diagnosticScore >= 44 ? 'watch' : 'blocked';

    steps.push({
      id: `workflow-${themeId}`,
      label: String(themeLabel),
      status,
      metric: diagnosticScore,
      summary: `${themeCards.length} idea cards, ${themeMappings.length} mappings`,
    });
  }

  return steps;
}
