import {
  ClusteredEvent,
  MarketData,
} from '@/types';
import { EventMarketTransmissionSnapshot } from '../event-market-transmission';
import { SourceCredibilityProfile } from '../source-credibility';
import { ScheduledReport } from '../scheduled-reports';
import { KeywordGraphSnapshot } from '../keyword-registry';
import {
  ReplayAdaptationSnapshot,
  getReplayAdaptationSnapshot,
  recordCurrentThemePerformance,
} from '../replay-adaptation';
import { buildMacroRiskOverlay } from '../macro-risk-overlay';
import { buildShadowControlState } from '../autonomy-constraints';
import {
  getActiveWeightProfileSync,
  getExperimentRegistrySnapshot,
  summarizeWeightProfile,
} from '../experiment-registry';
import { discoverHiddenGraphCandidates } from '../graph-propagation';
import { proposeDatasetsForThemes } from '../dataset-discovery';
import { buildCoverageLedgerFromMappings } from '../coverage-ledger';
import { logSourceOpsEvent } from '../source-ops-log';
// --- Phase module imports (IS-1 integration) ---
import type { MetaConfidenceInput } from './meta-confidence';
import { assessMetaConfidence, summarizeAssessment } from './meta-confidence';
import type { SourceStatus } from '../data-sufficiency';
import { assessDataSufficiency, getDegradationPolicy } from '../data-sufficiency';
import { buildDecisionSnapshot } from '../audit/decision-snapshot';
import { SnapshotStore } from '../audit/snapshot-store';
import type { SystemContext } from '../alerts/alert-system';
import { AlertEngine } from '../alerts/alert-system';
import { assessEdgeStrength } from '../evaluation/edge-hypothesis';
// IS-2: Risk Engine + Temporal Barrier
import { RiskEngine } from '../risk/risk-engine';
import type { SizedIdea, PortfolioPosition } from '../risk/risk-constraints';
import { TemporalBarrier, filterMarketsByBarrier, createPassthroughBarrier } from '../temporal-barrier';
// IS-3: Source Quality + Feedback Loop
import { FeedbackDelayCompensator } from './feedback-delay-compensator';
// IS-5: Config Externalization
import { ConfigManager } from '../alerts/alert-system';
import { setHmmConfig, setHmmParams as _setHmmParams } from '../math-models/hmm-regime';
import { setBanditDiscountFactor } from '../math-models/contextual-bandit';
import { setPortfolioOptimizerConfig } from './portfolio-optimizer';
// FIX-5: setHmmParams kept for backward compatibility if needed elsewhere
export { _setHmmParams as setHmmParams };
// FIX-2: ExecutionContext for backtest mode
import type { ExecutionContext } from '../execution-context';
// --- End Phase module imports ---
import {
  InvestmentIntelligenceSnapshot,
  InvestmentIntelligenceContext,
  IntegrationMetadata,
  EventCandidate,
  InvestmentThemeDefinition,
  InvestmentWorkflowStep,
  FalsePositiveStats,
} from './types';
import { UNIVERSE_ASSET_CATALOG, POSITION_RULES } from './constants';
import * as S from './module-state';
import { average, nowIso } from './utils';
import { getThemeRule, getEffectiveThemeAssets, findMatchingThemes, promoteDiscoveredPatternsToThemes } from './theme-registry';
import {
  buildEventCandidates,
  buildDirectMappings,
  applyAdaptiveConfirmationLayer,
  buildIdeaCards,
  buildSensitivityRows,
  buildHistoricalAnalogs,
  createCurrentHistoryEntries,
  mergeHistory,
  parseReportHistory,
  buildCurrentThemePerformanceMetrics,
  buildRollingThemePerformanceMetrics,
  buildDatasetThemeInputs,
} from './idea-generator';
import { buildIdeaGenerationRuntimeContext, captureSignalContext } from './idea-generation/runtime-context';
import {
  updateMappingPerformanceStats,
  buildEventBacktests,
  enrichIdeaCards,
  autoTriageIdeaCards,
} from './mapping-performance';
import { applyPortfolioExecutionControls } from './portfolio-optimizer';
import { updateTrackedIdeas, appendMarketHistory } from './idea-tracker';
import {
  buildCandidateExpansionReviews,
  applyUniverseExpansionPolicy,
  evaluateCandidateReviewProbation,
  buildCoverageGaps,
  buildUniverseCoverageSummary,
} from './universe-expansion';
import { ensureLoaded, persist } from './learning-state-io';
import { buildWorkflow } from './diagnostics';
import { logPipelineEvent } from './pipeline-logger';
import { scanLeadLagCorrelations, buildFingerprint, registerFingerprint } from '../pattern-discovery';
import { measureResourceOperation } from '../resource-telemetry';

// --- Phase module singletons ---
const snapshotStore = new SnapshotStore();
const alertEngine = new AlertEngine();
const riskEngine = new RiskEngine();
const feedbackCompensator = new FeedbackDelayCompensator();
const configManager = new ConfigManager();

// IS-5: Propagate config to math model modules
function applyConfigToModels(): void {
  const params = configManager.getParams();
  // FIX-5: Pass full HMM config to setHmmConfig
  setHmmConfig(params.hmm);
  setBanditDiscountFactor(params.bandit.discountFactor);
  // FIX-5: Pass portfolio optimizer config
  if (params.portfolioOptimizer) {
    setPortfolioOptimizerConfig(params.portfolioOptimizer);
  }
}
applyConfigToModels();

/** Retrieve the module-level SnapshotStore for external queries / audit. */
export function getSnapshotStore(): SnapshotStore { return snapshotStore; }

/** Retrieve the module-level AlertEngine for external subscription. */
export function getAlertEngine(): AlertEngine { return alertEngine; }

/** Retrieve the module-level RiskEngine for external config. */
export function getRiskEngine(): RiskEngine { return riskEngine; }

/** Retrieve the module-level ConfigManager. */
export function getConfigManager(): ConfigManager { return configManager; }

/** Reload config and propagate to all math model modules. */
export function reloadConfig(config: Parameters<ConfigManager['loadConfig']>[0]): void {
  configManager.loadConfig(config, 'api');
  applyConfigToModels();
}

/**
 * Build a SourceStatus[] from the source credibility array available at call
 * time. This is a lightweight adapter so we don't force callers to provide
 * Phase 8's full SourceStatus interface.
 */
function buildSourceStatuses(
  sourceCredibility: SourceCredibilityProfile[],
): SourceStatus[] {
  return sourceCredibility.map((src) => ({
    id: src.id ?? src.source ?? 'unknown',
    kind: 'news' as SourceStatus['kind'],
    available: src.feedHealthScore > 20,
    lastSeenAt: src.lastSeenAt != null ? new Date(src.lastSeenAt).toISOString() : null,
    staleMinutes: src.lastSeenAt != null
      ? Math.max(0, Math.round((Date.now() - src.lastSeenAt) / 60000))
      : 0,
    errorMessage: null,
  }));
}

export async function recomputeInvestmentIntelligence(args: {
  clusters: ClusteredEvent[];
  markets: MarketData[];
  transmission: EventMarketTransmissionSnapshot | null;
  sourceCredibility: SourceCredibilityProfile[];
  reports: ScheduledReport[];
  keywordGraph?: KeywordGraphSnapshot | null;
  timestamp?: string;
  context?: InvestmentIntelligenceContext;
  replayAdaptation?: ReplayAdaptationSnapshot | null;
  recordCurrentThemePerformance?: boolean;
  executionContext?: ExecutionContext;
}): Promise<InvestmentIntelligenceSnapshot> {
  await ensureLoaded();
  process.stderr.write(`[orch:ENTRY] clusters=${args.clusters?.length} markets=${args.markets?.length} context=${args.context}\n`);
  const timestamp = args.timestamp || nowIso();
  const context = args.context || 'live';
  const integration: IntegrationMetadata = {};
  integration.pipelineErrors = [];

  const stageTimings: Record<string, number> = {};
  const _time = (stage: string): { elapsed: () => number; stop: () => number } => {
    const t0 = performance.now();
    const elapsed = (): number => Math.round((performance.now() - t0) * 100) / 100;
    return {
      elapsed,
      stop: () => {
        const duration = elapsed();
        stageTimings[stage] = duration;
        return duration;
      },
    };
  };

  // --- FIX-2: ExecutionContext integration ---
  // If an executionContext is provided, derive context mode and temporal barrier from it
  const effectiveContext: InvestmentIntelligenceContext = args.executionContext
    ? (args.executionContext.mode === 'evaluation' ? 'validation' : args.executionContext.mode as InvestmentIntelligenceContext)
    : context;

  // --- IS-3: Model Staleness from FeedbackDelayCompensator ---
  const stalenessReport = feedbackCompensator.estimateModelStaleness();

  // --- IS-1: Meta-Confidence Gate (Phase 11) ---
  const edgeAssessment = assessEdgeStrength();
  const metaInput: MetaConfidenceInput = {
    dataSufficiency: 0.8,   // will be refined after data sufficiency check
    modelStaleness: stalenessReport.stalenessScore,
    regimeUncertainty: args.transmission?.regime?.confidence != null
      ? 1 - args.transmission.regime.confidence
      : 0.5,
    edgeStrength: edgeAssessment.overallStrength,
    recentPerformancePct: 0, // placeholder — filled from tracked ideas below
    volatilityRegimeSigma: 1.0, // placeholder
  };

  // Refine recentPerformancePct from existing tracked ideas
  const recentClosed = S.trackedIdeas
    .filter((idea) => idea.status === 'closed')
    .slice(-20);
  if (recentClosed.length > 0) {
    metaInput.recentPerformancePct = average(
      recentClosed.map((idea) => idea.realizedReturnPct ?? idea.currentReturnPct ?? 0),
    );
  }

  // --- IS-1: Data Sufficiency Check (Phase 8) ---
  const sourceStatuses = buildSourceStatuses(args.sourceCredibility);
  const dataSufficiency = assessDataSufficiency(sourceStatuses);
  metaInput.dataSufficiency = dataSufficiency.confidenceMultiplier;

  // --- FIX-1: Source quality weight ---
  const avgSourceQuality = args.sourceCredibility.length > 0
    ? args.sourceCredibility.reduce((sum, src) => sum + (src.credibilityScore ?? 50), 0) / args.sourceCredibility.length
    : 50;
  const sourceQualityWeight = Math.max(0.3, Math.min(1.5, avgSourceQuality / 50));
  integration.sourceQualityWeight = sourceQualityWeight;
  integration.dataSufficiency = {
    level: dataSufficiency.level,
    score: dataSufficiency.confidenceMultiplier,
    missingSources: dataSufficiency.missingSources,
  };

  // Evaluate degradation policy (for future use, currently informational only)
  getDegradationPolicy(dataSufficiency.level, args.transmission?.regime?.label ?? 'normal');
  const metaAssessment = assessMetaConfidence(metaInput);
  integration.metaConfidence = {
    canJudge: metaAssessment.canJudge,
    confidence: metaAssessment.confidence,
    abstentionReasons: metaAssessment.abstentionReasons,
    degradedFactors: metaAssessment.degradedFactors,
  };

  // If system cannot judge, return minimal snapshot preserving tracked ideas
  // In replay/backtest mode, skip abstention to allow historical data evaluation
  if (!metaAssessment.canJudge && effectiveContext === 'live') {
    const abstentionSnapshot: InvestmentIntelligenceSnapshot = {
      generatedAt: timestamp,
      regime: args.transmission?.regime ?? null,
      macroOverlay: buildMacroRiskOverlay({ regime: args.transmission?.regime ?? null, markets: args.markets, clusters: args.clusters, weightProfile: getActiveWeightProfileSync() }),
      topThemes: [],
      workflow: [],
      directMappings: [],
      sectorSensitivity: [],
      analogs: [],
      backtests: [],
      positionSizingRules: POSITION_RULES,
      ideaCards: [],
      trackedIdeas: S.trackedIdeas,
      falsePositive: { screened: 0, rejected: 0, kept: 0, reasons: [] },
      universePolicy: S.universeExpansionPolicy,
      universeCoverage: { totalCatalogAssets: 0, activeAssetKinds: [], activeSectors: [], directMappingCount: 0, dynamicApprovedCount: 0, openReviewCount: 0, gapCount: 0, uncoveredThemeCount: 0 },
      coverageGaps: [],
      candidateReviews: [],
      autonomy: { ...buildShadowControlState(S.trackedIdeas, timestamp), deployCount: 0, shadowCount: 0, watchCount: 0, abstainCount: 0, realityBlockedCount: 0, recentEvidenceWeakCount: 0 },
      hiddenCandidates: [],
      experimentRegistry: getExperimentRegistrySnapshot(),
      datasetAutonomy: { mode: S.universeExpansionPolicy.mode, proposals: [] },
      summaryLines: [`ABSTENTION: ${summarizeAssessment(metaAssessment)}`],
      integration,
    };
    // Fire alerts for abstention
    const alertCtx: SystemContext = {
      sourceFailureStreak: sourceStatuses.filter((s) => !s.available).length,
      weightChangePct: 0,
      convictionCalibrationBiasPct: 0,
      isAbstaining: true,
      portfolioDrawdownPct: 0,
      dataPipelineDelayMinutes: Math.max(...sourceStatuses.map((s) => s.staleMinutes), 0),
      modelStaleness: metaInput.modelStaleness,
      recentHitRatePct: 50,
    };
    const alerts = alertEngine.evaluate(alertCtx);
    integration.alertsFired = alerts.map((a) => ({ ruleId: a.ruleId, severity: a.severity, message: a.message }));
    S.setCurrentSnapshot(abstentionSnapshot);
    await persist();
    await logSourceOpsEvent({
      kind: 'report', action: 'abstained', actor: 'system',
      title: 'Investment intelligence abstained',
      detail: summarizeAssessment(metaAssessment),
      status: 'warning', category: 'investment',
    });
    return abstentionSnapshot;
  }

  // --- IS-2: Temporal Barrier (Phase 3) ---
  // In replay/validation mode, filter data through temporal barrier to prevent look-ahead bias
  let barrier: TemporalBarrier;
  let filteredMarkets: MarketData[];
  let filteredClusters: ClusteredEvent[];

  {
    const stageTimer = _time('temporalBarrier');
    try {
      barrier = effectiveContext === 'replay' || effectiveContext === 'validation' || effectiveContext === 'backtest'
        ? args.executionContext
          ? new TemporalBarrier(args.executionContext.knowledgeBoundary, { strict: effectiveContext === 'backtest' })
          : new TemporalBarrier(new Date(timestamp), { strict: false })
        : createPassthroughBarrier();
      filteredMarkets = filterMarketsByBarrier(args.markets, barrier);
      filteredClusters = args.clusters.filter((cluster) => {
        const clusterDate = cluster.firstSeen ?? cluster.lastUpdated;
        if (!clusterDate) return true;
        const d = clusterDate instanceof Date ? clusterDate : new Date(clusterDate as string);
        if (isNaN(d.getTime())) return true;
        return barrier.validateAccess(d, `cluster:${cluster.id}`);
      });
      logPipelineEvent('temporalBarrier', 'info', 'Applied temporal barrier to markets and clusters.', {
        durationMs: stageTimer.elapsed(),
        context: {
          context: effectiveContext,
          marketCount: filteredMarkets.length,
          clusterCount: filteredClusters.length,
        },
      });
    } catch (stageError) {
      const msg = stageError instanceof Error ? stageError.message : String(stageError);
      process.stderr.write(`[orch:BARRIER-CATCH] ${msg}\n`);
      logPipelineEvent('temporalBarrier', 'error', msg, { context: { degraded: true } });
      integration.pipelineErrors!.push({ stage: 'temporalBarrier', error: msg, degraded: true });
      // Safe defaults: passthrough barrier, unfiltered markets/clusters
      barrier = createPassthroughBarrier();
      filteredMarkets = args.markets;
      filteredClusters = args.clusters;
    } finally {
      stageTimer.stop();
    }
  }

  // --- IS-2: Risk Engine regime setup ---
  const regimeLabel = args.transmission?.regime?.label ?? null;
  if (regimeLabel === 'risk-off' || regimeLabel === 'crisis') {
    riskEngine.setRegime(regimeLabel as 'risk-off' | 'crisis');
  } else {
    riskEngine.setRegime(regimeLabel as null);
  }

  appendMarketHistory(filteredMarkets, timestamp);
  const shadowControl = buildShadowControlState(S.trackedIdeas, timestamp);
  const weightProfile = getActiveWeightProfileSync();
  const replayAdaptation = args.replayAdaptation === undefined
    ? await getReplayAdaptationSnapshot()
    : args.replayAdaptation;
  // Independent computations — run in parallel
  const [macroOverlay, rollingBacktests] = await Promise.all([
    Promise.resolve(buildMacroRiskOverlay({
      regime: args.transmission?.regime ?? null,
      markets: filteredMarkets,
      clusters: filteredClusters,
      weightProfile,
    })),
    Promise.resolve(buildEventBacktests(S.trackedIdeas)),
  ]);
  const rollingThemePerformance = buildRollingThemePerformanceMetrics(S.trackedIdeas, rollingBacktests, timestamp);
  const signalContext = await captureSignalContext();
  const decisionRuntimeContext = buildIdeaGenerationRuntimeContext({
    markets: filteredMarkets,
    transmission: args.transmission,
    macroOverlay,
    signalContext,
  });

  // Declare all variables produced by Stage 2 before the try block
  let kept: EventCandidate[];
  let falsePositive: FalsePositiveStats;
  let effectiveThemes: Array<{ id: string; label: string; triggers: string[]; sectors: string[]; commodities: string[] }>;
  let hiddenCandidates: Array<any>;
  let rawMappings: Array<any>;
  let provisionalCoverageLedger: any;
  let mappings: Array<any>;
  let coverageLedger: any;
  let preIdeaCards: Array<any>;
  let currentHistory: any;
  let analogs: Array<any>;
  let baseIdeaCards: Array<any>;
  let executionControlledIdeaCards: Array<any>;
  let tracked: Array<any>;
  let backtests: Array<any>;
  let updatedReplayAdaptation: ReplayAdaptationSnapshot | null;
  let reviews: Array<any>;
  let sensitivity: Array<any>;
  let enrichedIdeaCards: Array<any>;
  let ideaTriage: { kept: Array<any>; suppressedCount: number };

  {
    const stageTimer = _time('eventCandidates');
    try {
      if (filteredClusters.length > 0 && filteredClusters.length <= 5) {
        process.stderr.write(`[orchestrator] clusters=${filteredClusters.length} sample=${filteredClusters[0]?.primaryTitle?.substring(0, 60)} sourceCount=${filteredClusters[0]?.sourceCount} isAlert=${filteredClusters[0]?.isAlert}\n`);
      }
      const eventCandidatesResult = await measureResourceOperation(
        'investment.event-candidates',
        {
          label: 'Event candidate build',
          kind: 'analytics',
          feature: 'signal-admission',
          inputCount: filteredClusters.length,
        },
        async () => buildEventCandidates({
          clusters: filteredClusters,
          transmission: args.transmission,
          sourceCredibility: args.sourceCredibility,
        }),
        (value) => ({
          outputCount: value.kept.length,
          meta: {
            screened: value.falsePositive.screened,
            rejected: value.falsePositive.rejected,
          },
        }),
      );
      kept = eventCandidatesResult.kept;
      falsePositive = eventCandidatesResult.falsePositive;
      if (filteredClusters.length > 0 && kept.length === 0) {
        process.stderr.write(`[orch:candidates] in=${filteredClusters.length} kept=0 screened=${falsePositive.screened} rejected=${falsePositive.rejected}\n`);
      }
      if (kept.length === 0 && filteredClusters.length > 0) {
        process.stderr.write(`[orchestrator] 0 candidates from ${filteredClusters.length} clusters. FP: screened=${falsePositive.screened} rejected=${falsePositive.rejected} reasons=${JSON.stringify(falsePositive.reasons)}\n`);
      }

      effectiveThemes = Array.from(new Map(kept.flatMap((candidate: EventCandidate) => {
        return findMatchingThemes(candidate);
      }).map((rule) => [rule.id, rule] as const)).values())
        .map((theme: InvestmentThemeDefinition) => ({
          id: theme.id,
          label: theme.label,
          triggers: theme.triggers.slice(),
          sectors: theme.sectors.slice(),
          commodities: theme.commodities.slice(),
        }));

      // Detect theme interactions and conflicts
      if (effectiveThemes.length >= 2) {
        const themeSymbols = new Map<string, Set<string>>();
        for (const theme of effectiveThemes) {
          const rule = getThemeRule(theme.id);
          if (rule) {
            themeSymbols.set(theme.id, new Set(getEffectiveThemeAssets(rule).map(a => a.symbol)));
          }
        }

        // Check for overlapping assets across themes
        for (const [t1, s1] of themeSymbols) {
          for (const [t2, s2] of themeSymbols) {
            if (t1 >= t2) continue;
            const overlap = [...s1].filter(s => s2.has(s));
            if (overlap.length > 0) {
              process.stderr.write(`[orchestrator] theme overlap: ${t1}+${t2} share ${overlap.join(',')}\n`);
            }
          }
        }
      }

      // Carry Hawkes state across frames for each active theme
      for (const theme of effectiveThemes) {
        const prevState = S.getHawkesState(theme.id);
        const currentEvents = kept
          .filter((c: EventCandidate) => findMatchingThemes(c).some((t) => t.id === theme.id))
          .map((c: EventCandidate) => ({ timestamp: Date.parse(timestamp), weight: c.eventIntensity / 100 }));
        const cutoff = Date.parse(timestamp) - 7 * 24 * 60 * 60 * 1000;
        const mergedEvents = [
          ...(prevState?.eventPoints ?? []).filter((e) => e.timestamp > cutoff),
          ...currentEvents,
        ].slice(-200);
        S.setHawkesState(theme.id, {
          themeId: theme.id,
          lastLambda: prevState?.lastLambda ?? 0,
          lastNormalized: prevState?.lastNormalized ?? 0,
          fittedAlpha: prevState?.fittedAlpha ?? 1.0,
          fittedBetaHours: prevState?.fittedBetaHours ?? 36,
          eventPoints: mergedEvents,
          updatedAt: timestamp,
        });
      }

      // --- Pattern Discovery: scan for news→price correlations ---
      {
        // Build price history from current markets
        const priceHistory = new Map<string, Array<{ timestamp: number; price: number }>>();
        for (const market of filteredMarkets) {
          const sym = market.symbol || '';
          if (!sym) continue;
          const existing = priceHistory.get(sym) || [];
          existing.push({ timestamp: Date.parse(timestamp), price: market.price || 0 });
          priceHistory.set(sym, existing);
        }

        // Register fingerprints for all clusters
        for (const cluster of filteredClusters) {
          registerFingerprint(buildFingerprint(cluster));
        }

        // Scan for lead-lag patterns
        scanLeadLagCorrelations({
          clusters: filteredClusters,
          priceHistory,
          horizons: [6, 12, 24, 48, 72],
          currentTimestamp: timestamp,
        });
      }

      hiddenCandidates = discoverHiddenGraphCandidates({
        themes: effectiveThemes,
        candidates: kept.map((candidate: EventCandidate) => ({
          id: candidate.id,
          title: candidate.title,
          text: candidate.text,
          region: candidate.region,
          reasons: candidate.reasons,
          matchedSymbols: candidate.matchedSymbols,
        })),
        assetCatalog: UNIVERSE_ASSET_CATALOG.map((asset) => ({
          symbol: asset.symbol,
          name: asset.name,
          assetKind: asset.assetKind,
          sector: asset.sector,
          commodity: asset.commodity,
          direction: asset.direction,
          role: asset.role,
          themeIds: asset.themeIds.slice(),
          aliases: asset.aliases?.slice(),
        })),
        keywordGraph: args.keywordGraph ?? null,
        transmission: args.transmission,
        existingThemeSymbols: Object.fromEntries(
          effectiveThemes.map((theme) => {
            const rule = getThemeRule(theme.id);
            return [theme.id, rule ? getEffectiveThemeAssets(rule).map((asset) => asset.symbol) : []];
          }),
        ),
      });

      rawMappings = await measureResourceOperation(
        'investment.direct-mappings',
        {
          label: 'Direct mapping build',
          kind: 'graph',
          feature: 'signal-admission',
          inputCount: kept.length,
        },
        async () => buildDirectMappings({
          candidates: kept,
          markets: filteredMarkets,
          transmission: args.transmission,
          timestamp,
          autonomy: shadowControl,
          keywordGraph: args.keywordGraph ?? null,
          weightProfile,
          macroOverlay,
        }),
        (value) => ({ outputCount: value.length }),
      );
      if (rawMappings.length > 0) {
        process.stderr.write(`[orchestrator:map] rawMappings=${rawMappings.length} themes=${[...new Set(rawMappings.map(m=>m.themeId))]} symbols=${[...new Set(rawMappings.map(m=>m.symbol))]}\n`);
      }
      provisionalCoverageLedger = buildCoverageLedgerFromMappings(rawMappings);
      mappings = await measureResourceOperation(
        'investment.confirmation-layer',
        {
          label: 'Adaptive confirmation',
          kind: 'risk',
          feature: 'signal-admission',
          inputCount: rawMappings.length,
        },
        async () => applyAdaptiveConfirmationLayer(rawMappings, replayAdaptation, provisionalCoverageLedger, {
          context: effectiveContext,
          referenceTimestamp: timestamp,
          currentThemePerformance: rollingThemePerformance,
        }),
        (value) => ({ outputCount: value.length }),
      );
      coverageLedger = buildCoverageLedgerFromMappings(mappings);
      if (rawMappings.length > 0) {
        process.stderr.write(`[orchestrator:map] after confirmation: mappings=${mappings.length} directions=${[...new Set(mappings.map(m=>m.direction))]}\n`);
      }
      preIdeaCards = await measureResourceOperation(
        'investment.idea-cards.pre',
        {
          label: 'Pre-analog idea cards',
          kind: 'orchestration',
          feature: 'signal-admission',
          inputCount: mappings.length,
        },
        async () => buildIdeaCards(mappings, [], macroOverlay, replayAdaptation, decisionRuntimeContext),
        (value) => ({ outputCount: value.length }),
      );
      currentHistory = mergeHistory(S.currentHistory, parseReportHistory(args.reports));
      analogs = buildHistoricalAnalogs({ history: currentHistory, ideaCards: preIdeaCards });
      currentHistory = mergeHistory(currentHistory, createCurrentHistoryEntries(preIdeaCards, mappings, timestamp));
      S.setCurrentHistory(currentHistory);
      baseIdeaCards = await measureResourceOperation(
        'investment.idea-cards.final',
        {
          label: 'Final idea cards',
          kind: 'orchestration',
          feature: 'signal-admission',
          inputCount: mappings.length,
        },
        async () => buildIdeaCards(mappings, analogs, macroOverlay, replayAdaptation, decisionRuntimeContext),
        (value) => ({ outputCount: value.length }),
      );
      executionControlledIdeaCards = await measureResourceOperation(
        'investment.execution-controls',
        {
          label: 'Execution controls',
          kind: 'risk',
          feature: 'signal-admission',
          inputCount: baseIdeaCards.length,
        },
        async () => applyPortfolioExecutionControls(baseIdeaCards, macroOverlay),
        (value) => ({ outputCount: value.length }),
      );
      tracked = updateMappingPerformanceStats(updateTrackedIdeas(executionControlledIdeaCards, filteredMarkets, timestamp), sourceQualityWeight);
      backtests = buildEventBacktests(tracked);
      updatedReplayAdaptation = args.recordCurrentThemePerformance === false
        ? replayAdaptation
        : await recordCurrentThemePerformance(
          buildCurrentThemePerformanceMetrics(mappings, tracked, backtests),
        );
      reviews = evaluateCandidateReviewProbation({
        reviews: applyUniverseExpansionPolicy(buildCandidateExpansionReviews({ candidates: kept, markets: filteredMarkets }), S.universeExpansionPolicy),
        activeCandidates: kept,
        mappings,
        backtests,
        policy: S.universeExpansionPolicy,
      });
      S.setCandidateReviews(new Map(reviews.map((review) => [review.id, review] as const)));
      [sensitivity, enrichedIdeaCards] = await Promise.all([
        Promise.resolve(buildSensitivityRows(mappings, backtests, tracked)),
        Promise.resolve(enrichIdeaCards(executionControlledIdeaCards, tracked, backtests)),
      ]);
      ideaTriage = autoTriageIdeaCards(enrichedIdeaCards);
      const admissionSummary = baseIdeaCards.reduce((acc, card) => {
        const state = card.admissionState || 'watch';
        if (state === 'accepted') acc.accepted += 1;
        else if (state === 'rejected') acc.rejected += 1;
        else acc.watch += 1;
        return acc;
      }, { accepted: 0, watch: 0, rejected: 0 });
      logPipelineEvent('eventCandidates', 'info', 'Built event candidates and mapping chain.', {
        durationMs: stageTimer.elapsed(),
        context: {
          clusterCount: filteredClusters.length,
          candidateCount: kept.length,
          rejectedCandidateCount: falsePositive.rejected,
          themeCount: effectiveThemes.length,
          mappingCount: mappings.length,
          analogCount: analogs.length,
        },
      });
      logPipelineEvent('metaAdmission', 'info', 'Built idea cards and applied selective admission.', {
        durationMs: stageTimer.elapsed(),
        context: {
          ideaCardCount: baseIdeaCards.length,
          acceptedCount: admissionSummary.accepted,
          watchCount: admissionSummary.watch,
          rejectedCount: admissionSummary.rejected,
        },
      });
      logPipelineEvent('portfolio', 'info', 'Applied portfolio execution controls.', {
        durationMs: stageTimer.elapsed(),
        context: {
          executionControlledCount: executionControlledIdeaCards.length,
          trackedIdeaCount: tracked.length,
        },
      });
    } catch (stageError) {
      const msg = stageError instanceof Error ? stageError.message : String(stageError);
      process.stderr.write(`[orch:CATCH] eventCandidates stage error: ${msg}\n`);
      logPipelineEvent('eventCandidates', 'error', msg, { context: { degraded: true } });
      integration.pipelineErrors!.push({ stage: 'eventCandidates', error: msg, degraded: true });
      // Safe defaults: empty candidates, mappings, ideaCards
      kept = [];
      falsePositive = { screened: 0, rejected: 0, kept: 0, reasons: [] as FalsePositiveStats['reasons'] };
      effectiveThemes = [];
      hiddenCandidates = [];
      rawMappings = [];
      provisionalCoverageLedger = { globalCoverageDensity: 0, globalCompletenessScore: 0, themeEntries: [] };
      mappings = [];
      coverageLedger = { globalCoverageDensity: 0, globalCompletenessScore: 0, themeEntries: [] };
      preIdeaCards = [];
      currentHistory = S.currentHistory;
      analogs = [];
      baseIdeaCards = [];
      executionControlledIdeaCards = [];
      tracked = [];
      backtests = [];
      updatedReplayAdaptation = replayAdaptation;
      reviews = [];
      sensitivity = [];
      enrichedIdeaCards = [];
      ideaTriage = { kept: [], suppressedCount: 0 };
    } finally {
      stageTimer.stop();
    }
  }

  // --- IS-2: Risk Engine Idea Gate (Phase 4) ---
  let ideaCards: Array<any>;

  {
    const stageTimer = _time('riskGate');
    try {
      const sizedIdeas: SizedIdea[] = ideaTriage.kept.map((card: any) => ({
        id: card.id,
        title: card.title,
        themeId: card.themeId,
        direction: card.direction as SizedIdea['direction'],
        conviction: card.conviction,
        falsePositiveRisk: card.falsePositiveRisk,
        sizePct: card.sizePct,
        symbols: (card.symbols ?? []).map((sym: any) => ({
          symbol: sym.symbol,
          sector: sym.sector,
          assetKind: sym.assetKind,
          liquidityScore: sym.liquidityScore ?? undefined,
          direction: sym.direction,
          correlationGroup: sym.sector,
        })),
      }));
      const existingPositions: PortfolioPosition[] = tracked
        .filter((idea: any) => idea.status === 'open')
        .flatMap((idea: any) =>
          (idea.symbols ?? []).map((sym: any) => ({
            symbol: sym.symbol,
            direction: (idea.direction ?? 'long') as PortfolioPosition['direction'],
            sizePct: idea.sizePct ?? 0,
            sector: sym.sector ?? 'unknown',
            assetKind: 'equity',
            liquidityScore: 50,
            conviction: idea.conviction ?? 0,
            returnPct: idea.currentReturnPct ?? null,
          })),
        );
      const ideaGateResult = riskEngine.applyIdeaGate(sizedIdeas, existingPositions);
      const approvedIdeaIds = new Set(ideaGateResult.passed.map((ci) => ci.id));
      ideaCards = ideaTriage.kept.filter((card) => approvedIdeaIds.has(card.id));

      // --- FIX-1: Portfolio Gate (Phase 4 second gate) ---
      const portfolioSizedIdeas: SizedIdea[] = ideaCards.map((card: any) => ({
        id: card.id,
        title: card.title,
        themeId: card.themeId,
        direction: card.direction as SizedIdea['direction'],
        conviction: card.conviction,
        falsePositiveRisk: card.falsePositiveRisk,
        sizePct: card.sizePct,
        symbols: (card.symbols ?? []).map((sym: any) => ({
          symbol: sym.symbol,
          sector: sym.sector,
          assetKind: sym.assetKind,
          liquidityScore: sym.liquidityScore ?? undefined,
          direction: sym.direction,
          correlationGroup: sym.sector,
        })),
      }));
      const portfolioGateResult = riskEngine.applyPortfolioGate(portfolioSizedIdeas, existingPositions);
      // Apply adjusted sizes from portfolio gate
      for (const constrained of portfolioGateResult.passed) {
        const card = ideaCards.find((c) => c.id === constrained.id);
        if (card && constrained.approvedSizePct < card.sizePct) {
          card.sizePct = constrained.approvedSizePct;
        }
      }
      integration.riskGateSummary = {
        ideaGateRejected: ideaGateResult.summary.totalVetoed,
        portfolioGateReduced: portfolioGateResult.summary.totalReduced,
      };
      logPipelineEvent('riskGate', 'info', 'Applied idea and portfolio risk gates.', {
        durationMs: stageTimer.elapsed(),
        context: {
          inputCount: ideaTriage.kept.length,
          passedCount: ideaCards.length,
          ideaGateRejected: ideaGateResult.summary.totalVetoed,
          portfolioGateReduced: portfolioGateResult.summary.totalReduced,
        },
      });
    } catch (stageError) {
      const msg = stageError instanceof Error ? stageError.message : String(stageError);
      logPipelineEvent('riskGate', 'error', msg, { context: { degraded: true } });
      integration.pipelineErrors!.push({ stage: 'riskGate', error: msg, degraded: true });
      // Safe defaults: let all ideas through without gating
      ideaCards = ideaTriage.kept;
      integration.riskGateSummary = null;
    } finally {
      stageTimer.stop();
    }
  }

  const autonomy = {
    ...buildShadowControlState(tracked, timestamp),
    deployCount: ideaCards.filter((card) => card.autonomyAction === 'deploy').length,
    shadowCount: ideaCards.filter((card) => card.autonomyAction === 'shadow').length,
    watchCount: ideaCards.filter((card) => card.autonomyAction === 'watch').length,
    abstainCount: enrichedIdeaCards.filter((card) => card.autonomyAction === 'abstain').length,
    realityBlockedCount: mappings.filter((item) => item.realityScore < 42 || !item.tradableNow).length,
    recentEvidenceWeakCount: mappings.filter((item) => item.recentEvidenceScore < 36 || item.stalePenalty >= 12).length,
  };
  const workflow = buildWorkflow({
    falsePositive,
    mappings,
    ideaCards,
    analogs,
    sensitivity,
    trackedIdeas: tracked,
    backtests,
    autonomy,
    replayAdaptation: updatedReplayAdaptation,
  });
  const coverageGaps = buildCoverageGaps({ candidates: kept, reviews });
  const universeCoverage = buildUniverseCoverageSummary({ candidates: kept, mappings, reviews, gaps: coverageGaps });
  const datasetAutonomyInputs = buildDatasetThemeInputs(kept, ideaCards, coverageGaps);
  const datasetProposals = proposeDatasetsForThemes({
    themes: datasetAutonomyInputs,
    existingDatasets: [],
    policy: {
      mode: S.universeExpansionPolicy.mode,
      maxRegistrationsPerCycle: 2,
      maxEnabledDatasets: 12,
    },
  });
  const experimentRegistry = getExperimentRegistrySnapshot();
  const topThemes = Array.from(new Set(ideaCards.map((card) => card.title))).slice(0, 8);
  const openTracked = tracked.filter((idea) => idea.status === 'open').length;
  const closedTracked = tracked.filter((idea) => idea.status === 'closed').length;
  const learnedMappings = Array.from(S.mappingStats.values()).filter((entry) => entry.observations > 0).length;

  // --- IS-1: Decision Snapshots (Phase 7) ---
  let snapshotCount = 0;
  {
    const stageTimer = _time('decisionSnapshots');
    try {
      for (const card of ideaCards) {
        try {
          const snapshot = buildDecisionSnapshot({
            ideaId: card.id ?? `idea-${snapshotCount}`,
            themeId: card.title ?? 'unknown',
            context: {
              regime: args.transmission?.regime
                ? { id: args.transmission.regime.label ?? 'unknown', label: args.transmission.regime.label ?? 'unknown', confidence: args.transmission.regime.confidence ?? 0 }
                : null,
              convictionFeatures: {
                corroborationQuality: card.corroborationQuality ?? 0,
                recentEvidenceScore: card.recentEvidenceScore ?? 0,
                realityScore: card.realityScore ?? 0,
                graphSignalScore: card.graphSignalScore ?? 0,
                falsePositiveRisk: card.falsePositiveRisk ?? 0,
              },
              convictionWeights: S.convictionModelState.weights as Record<string, number>,
              convictionBias: S.convictionModelState.bias ?? 0,
              modelObservations: S.convictionModelState.observations ?? 0,
              banditScore: null,
              macroOverlayState: macroOverlay.state,
              sourceProfileIds: [],
              riskAssessment: null,
            },
            decisions: {
              rawConviction: card.conviction ?? 0,
              blendedConviction: card.conviction ?? 0,
              autonomyAction: card.autonomyAction ?? 'watch',
              finalSizePct: card.sizePct ?? 0,
              vetoReasons: [],
              attribution: [],
            },
            reproducibility: {
              stateStoreVersion: 0,
              configHash: '',
              executionMode: effectiveContext,
            },
          });
          snapshotStore.save(snapshot);
          snapshotCount++;
        } catch {
          // Snapshot creation is best-effort; don't break the pipeline
        }
      }
    } finally {
      stageTimer.stop();
    }
  }
  integration.decisionSnapshotCount = snapshotCount;

  // --- IS-1: Alert Evaluation (Phase 12) ---
  {
    const stageTimer = _time('alertEvaluation');
    try {
      const alertCtx: SystemContext = {
        sourceFailureStreak: sourceStatuses.filter((s) => !s.available).length,
        weightChangePct: 0,
        convictionCalibrationBiasPct: 0,
        isAbstaining: false,
        portfolioDrawdownPct: autonomy.recentDrawdownPct ?? 0,
        dataPipelineDelayMinutes: Math.max(...sourceStatuses.map((s) => s.staleMinutes), 0),
        modelStaleness: metaInput.modelStaleness,
        recentHitRatePct: autonomy.recentHitRate ?? 50,
      };
      const alerts = alertEngine.evaluate(alertCtx);
      integration.alertsFired = alerts.map((a) => ({ ruleId: a.ruleId, severity: a.severity, message: a.message }));
    } catch (stageError) {
      const msg = stageError instanceof Error ? stageError.message : String(stageError);
      logPipelineEvent('alertEvaluation', 'error', msg, { context: { degraded: true } });
      integration.pipelineErrors!.push({ stage: 'alertEvaluation', error: msg, degraded: true });
      // Safe default: empty alerts
      integration.alertsFired = [];
    } finally {
      stageTimer.stop();
    }
  }

  const currentSnapshot: InvestmentIntelligenceSnapshot = {
    generatedAt: timestamp,
    regime: args.transmission?.regime ?? null,
    macroOverlay,
    topThemes,
    workflow,
    directMappings: mappings,
    sectorSensitivity: sensitivity,
    analogs,
    backtests,
    positionSizingRules: POSITION_RULES,
    ideaCards,
    trackedIdeas: tracked,
    falsePositive,
    universePolicy: S.universeExpansionPolicy,
    universeCoverage,
    coverageGaps,
    candidateReviews: reviews,
    autonomy,
    hiddenCandidates,
    experimentRegistry,
    datasetAutonomy: {
      mode: S.universeExpansionPolicy.mode,
      proposals: datasetProposals,
    },
    coverageLedger,
    integration,
    summaryLines: [
      `${ideaCards.length} idea cards generated across ${sensitivity.length} sector channels.`,
      `${mappings.length} direct stock or ETF mappings survived ${falsePositive.rejected} false-positive rejects.`,
      `${backtests.length} price-based backtest rows, ${openTracked} open tracked ideas, ${closedTracked} closed samples, and ${learnedMappings} learned mapping priors available.`,
      `${ideaTriage.suppressedCount} low-quality idea cards were auto-suppressed before the operator view.`,
      `Autonomy=${autonomy.rollbackLevel} shadow=${autonomy.shadowMode ? 'on' : 'off'} deploy=${autonomy.deployCount} shadowOnly=${autonomy.shadowCount} watch=${autonomy.watchCount} abstain=${autonomy.abstainCount}.`,
      `Macro overlay=${macroOverlay.state} gauge=${macroOverlay.riskGauge} topDown=${macroOverlay.topDownAction} killSwitch=${macroOverlay.killSwitch ? 'on' : 'off'} netCap=${macroOverlay.netExposureCapPct}% grossCap=${macroOverlay.grossExposureCapPct}%.`,
      `Recent shadow hit-rate=${autonomy.recentHitRate}% avg=${autonomy.recentAvgReturnPct}% drawdown=${autonomy.recentDrawdownPct}% stale=${autonomy.staleIdeaCount}.`,
      `${autonomy.realityBlockedCount} mappings failed reality gates and ${autonomy.recentEvidenceWeakCount} mappings were penalized for weak recent evidence.`,
      `${mappings.filter((mapping) => (mapping.informationFlowScore || 0) >= 55).length} mappings carry positive information-flow support and ${mappings.filter((mapping) => (mapping.knowledgeGraphScore || 0) >= 60).length} have strong KG evidence.`,
      updatedReplayAdaptation
        ? `Replay adaptation: ${updatedReplayAdaptation.themeProfiles.length} themes with learned horizons, quality=${updatedReplayAdaptation.workflow.qualityScore}, execution=${updatedReplayAdaptation.workflow.executionScore}, coverage=${updatedReplayAdaptation.workflow.coverageScore}.`
        : 'Replay adaptation has not been learned yet.',
      updatedReplayAdaptation && updatedReplayAdaptation.themeProfiles.length > 0
        ? `Top learned horizons: ${updatedReplayAdaptation.themeProfiles.slice(0, 4).map((profile) => `${profile.themeId}:${profile.timeframe}`).join(' | ')}.`
        : 'Top learned horizons: unavailable.',
      `Coverage ledger: density=${coverageLedger.globalCoverageDensity} completeness=${coverageLedger.globalCompletenessScore} themeEntries=${coverageLedger.themeEntries.length}.`,
      `${ideaCards.filter((card) => (card.portfolioCrowdingPenalty || 0) > 0.2).length} cards were trimmed by RMT crowding and execution plan score averaged ${Math.round(average(ideaCards.map((card) => card.executionPlanScore || 0)))}.`,
      `${universeCoverage.dynamicApprovedCount} approved expansion candidates, ${universeCoverage.openReviewCount} open review items, and ${universeCoverage.gapCount} current coverage gaps tracked.`,
      `Universe policy=${S.universeExpansionPolicy.mode} scoreThreshold=${S.universeExpansionPolicy.minAutoApproveScore} codexFloor=${S.universeExpansionPolicy.minCodexConfidence} requireMarketData=${S.universeExpansionPolicy.requireMarketData ? 'yes' : 'no'} sectorCap=${S.universeExpansionPolicy.maxAutoApprovalsPerSectorPerTheme} kindCap=${S.universeExpansionPolicy.maxAutoApprovalsPerAssetKindPerTheme}.`,
      `${hiddenCandidates.length} hidden graph candidates are currently being tracked and ${datasetProposals.length} dataset proposals are queued for guarded registration.`,
      `Self-tuning profile: ${summarizeWeightProfile(experimentRegistry.activeProfile).join(', ')}.`,
      `${analogs.length} analog checkpoints and ${workflow.filter((step: InvestmentWorkflowStep) => step.status === 'ready').length} ready workflow stages available.`,
      `Regime=${args.transmission?.regime?.label || 'unknown'} confidence=${args.transmission?.regime?.confidence ?? 0}.`,
    ],
  };

  // --- Stage 5: Persist ---
  {
    const stageTimer = _time('persist');
    try {
      S.setCurrentSnapshot(currentSnapshot);
      await persist();
      await logSourceOpsEvent({
        kind: 'report',
        action: 'generated',
        actor: 'system',
        title: 'Investment intelligence updated',
        detail: `ideas=${ideaCards.length} mappings=${mappings.length} backtests=${backtests.length} priors=${learnedMappings} open=${openTracked} closed=${closedTracked} rejects=${falsePositive.rejected}`,
        status: 'ok',
        category: 'investment',
      });
      logPipelineEvent('persist', 'info', 'Persisted signal snapshot and source ops report.', {
        durationMs: stageTimer.elapsed(),
        context: {
          ideaCount: ideaCards.length,
          mappingCount: mappings.length,
          trackedIdeaCount: tracked.length,
        },
      });
    } catch (stageError) {
      const msg = stageError instanceof Error ? stageError.message : String(stageError);
      logPipelineEvent('persist', 'error', msg, { context: { degraded: true } });
      integration.pipelineErrors!.push({ stage: 'persist', error: msg, degraded: true });
      // Still return the snapshot even if persistence fails
    } finally {
      stageTimer.stop();
    }
  }

  // --- Auto-promote discovered patterns to themes ---
  try {
    const promoted = promoteDiscoveredPatternsToThemes();
    if (promoted.length > 0) {
      process.stderr.write?.(`[orchestrator] promoted ${promoted.length} discovered patterns to themes: ${promoted.map(t => t.id).join(', ')}\n`);
    }
  } catch {
    // Non-fatal
  }

  const totalDuration = Object.values(stageTimings).reduce((a, b) => a + b, 0);
  integration.stageTimings = stageTimings;
  _lastRunMeta = {
    at: new Date().toISOString(),
    durationMs: Math.round(totalDuration),
    errors: (integration.pipelineErrors ?? []).length,
    degraded: (integration.pipelineErrors ?? []).filter(e => e.degraded).map(e => e.stage),
  };

  return currentSnapshot;
}

let _lastRunMeta: { at: string; durationMs: number; errors: number; degraded: string[] } | null = null;

export function getOrchestratorHealth() {
  return _lastRunMeta;
}
