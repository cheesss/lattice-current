import type { AutonomyAction, ConfidenceBand, RollbackLevel, DecisionExplanationPayload } from '../autonomy-constraints';
import type { IdeaAttributionBreakdown } from '../decision-attribution';
import type { MacroRiskOverlay } from '../macro-risk-overlay';
import type { MarketRegimeState } from '../math-models/regime-model';
import type { BanditArmState } from '../math-models/contextual-bandit';
import type { ExperimentRegistrySnapshot } from '../experiment-registry';
import type { HiddenCandidateDiscovery } from '../graph-propagation';
import type { DatasetProposal } from '../dataset-discovery';
import type { CoverageLedgerSnapshot } from '../coverage-ledger';
import type { KNNPrediction } from './adaptive-params/embedding-knn.js';
import type { TransmissionProxy } from './adaptive-params/transmission-proxy.js';

export type InvestmentAssetKind = 'etf' | 'equity' | 'commodity' | 'fx' | 'rate' | 'crypto';
export type InvestmentDirection = 'long' | 'short' | 'hedge' | 'watch' | 'pair';
export type InvestmentBias = 'benefit' | 'pressure' | 'mixed';
export type WorkflowStatus = 'ready' | 'watch' | 'blocked';
export type UniverseExpansionMode = 'manual' | 'guarded-auto' | 'full-auto';
export type ConfirmationState = 'confirmed' | 'tentative' | 'fading' | 'contradicted';
export type InvestmentIntelligenceContext = 'live' | 'replay' | 'validation' | 'backtest';
export type ThemeClassification = 'directional' | 'mixed' | 'hedge-heavy';
export type NarrativeShadowState = 'aligned' | 'weak' | 'mismatch';

export interface NarrativeFactorShadowThemeScore {
  themeId: string;
  themeLabel: string;
  rawScore: number;
  posterior: number;
  alignmentScore: number;
  patternSupportScore: number;
  lexiconHitCount: number;
  symbolOverlapCount: number;
  evidence: string[];
}

export interface InvestmentWorkflowStep {
  id: string;
  label: string;
  status: WorkflowStatus;
  metric: number;
  summary: string;
}

export interface DirectAssetMapping {
  id: string;
  eventTitle: string;
  eventSource: string;
  themeId: string;
  themeLabel: string;
  themeClassification?: ThemeClassification;
  region: string;
  symbol: string;
  assetName: string;
  assetKind: InvestmentAssetKind;
  sector: string;
  commodity: string | null;
  direction: InvestmentDirection;
  role: 'primary' | 'confirm' | 'hedge';
  conviction: number;
  sensitivityScore: number;
  falsePositiveRisk: number;
  eventIntensity: number;
  liquidityScore: number;
  marketMovePct: number | null;
  regimeId?: string | null;
  regimeMultiplier?: number;
  aftershockIntensity?: number;
  transferEntropy?: number;
  informationFlowScore?: number;
  leadLagScore?: number;
  knowledgeGraphScore?: number;
  knowledgeRelationType?: string | null;
  banditScore?: number;
  banditMean?: number;
  banditUncertainty?: number;
  corroboration: number;
  sourceDiversity: number;
  corroborationQuality: number;
  clusterConfidence: number;
  marketStressPrior: number;
  transmissionStress?: number | null;
  contradictionPenalty: number;
  rumorPenalty: number;
  recentEvidenceScore: number;
  timeDecayWeight: number;
  stalePenalty: number;
  realityScore: number;
  executionPenaltyPct: number;
  sessionState: 'always-on' | 'open' | 'extended' | 'closed';
  tradableNow: boolean;
  graphSignalScore: number;
  narrativeAlignmentScore?: number;
  narrativeShadowState?: NarrativeShadowState;
  narrativeShadowPosterior?: number;
  narrativeShadowDisagreement?: number;
  narrativeShadowTopThemeId?: string | null;
  calibratedConfidence: number;
  confirmationScore: number;
  confirmationState: ConfirmationState;
  convictionFeatures?: ConvictionFeatureSnapshot;
  sizeMultiplier: number;
  horizonMultiplier: number;
  executionGate: boolean;
  coveragePenalty: number;
  autonomyAction: AutonomyAction;
  autonomyReasons: string[];
  attribution: IdeaAttributionBreakdown;
  reasons: string[];
  transmissionPath: string[];
  tags: string[];
}

export interface SectorSensitivityRow {
  id: string;
  sector: string;
  commodity: string | null;
  bias: InvestmentBias;
  sensitivityScore: number;
  conviction: number;
  linkedEvents: number;
  sampleSize: number;
  liveReturnPct: number | null;
  backtestWinRate: number | null;
  drivers: string[];
  symbols: string[];
}

export interface HistoricalAnalog {
  id: string;
  label: string;
  timestamp: string;
  similarity: number;
  sampleSize: number;
  avgMovePct: number;
  winRate: number;
  maxDrawdownPct: number;
  summary: string;
  symbols: string[];
  themes: string[];
}

export interface PositionSizingRule {
  id: string;
  label: string;
  minConviction: number;
  maxFalsePositiveRisk: number;
  maxPositionPct: number;
  grossExposurePct: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxHoldingDays: number;
  notes: string[];
}

export interface InvestmentIdeaSymbol {
  symbol: string;
  name: string;
  role: 'primary' | 'confirm' | 'hedge';
  direction: InvestmentDirection;
  sector?: string;
  assetKind?: InvestmentAssetKind;
  liquidityScore?: number | null;
  realityScore?: number | null;
  contextVector?: number[];
  banditScore?: number | null;
}

export interface InvestmentIdeaCard {
  id: string;
  title: string;
  themeId: string;
  themeClassification?: ThemeClassification;
  direction: InvestmentDirection;
  conviction: number;
  falsePositiveRisk: number;
  sizePct: number;
  timeframe: string;
  thesis: string;
  calibratedConfidence: number;
  confidenceBand: ConfidenceBand;
  autonomyAction: AutonomyAction;
  autonomyReasons: string[];
  realityScore: number;
  graphSignalScore: number;
  narrativeAlignmentScore?: number;
  narrativeShadowState?: NarrativeShadowState;
  narrativeShadowPosterior?: number;
  narrativeShadowDisagreement?: number;
  narrativeShadowTopThemeId?: string | null;
  timeDecayWeight: number;
  recentEvidenceScore: number;
  corroborationQuality?: number;
  clusterConfidence?: number;
  marketStressPrior?: number;
  transmissionStress?: number | null;
  transferEntropy?: number;
  banditScore?: number;
  regimeMultiplier?: number;
  convictionFeatures?: ConvictionFeatureSnapshot;
  confirmationScore: number;
  confirmationState: ConfirmationState;
  sizeMultiplier: number;
  horizonMultiplier: number;
  executionGate: boolean;
  coveragePenalty: number;
  portfolioCrowdingPenalty?: number;
  executionPlanScore?: number;
  optimizedTargetWeightPct?: number;
  metaHitProbability?: number;
  metaExpectedReturnPct?: number;
  metaDecisionScore?: number;
  admissionState?: 'accepted' | 'watch' | 'rejected';
  continuousConviction?: number;
  attribution: IdeaAttributionBreakdown;
  symbols: InvestmentIdeaSymbol[];
  triggers: string[];
  invalidation: string[];
  evidence: string[];
  transmissionPath: string[];
  sectorExposure: string[];
  analogRefs: string[];
  preferredHorizonHours?: number | null;
  horizonCandidatesHours?: number[];
  horizonLearningConfidence?: number | null;
  timeframeSource?: 'theme-default' | 'replay-learned';
  trackingStatus?: 'new' | 'open' | 'closed' | 'watch';
  daysHeld?: number;
  liveReturnPct?: number | null;
  realizedReturnPct?: number | null;
  backtestHitRate?: number | null;
  backtestAvgReturnPct?: number | null;
  exitReason?: string | null;
}

export interface ThemeDiagnosticsRow {
  themeId: string;
  themeLabel: string;
  status: 'ready' | 'watch' | 'blocked';
  diagnosticScore: number;
  confirmationScore: number;
  confirmationState: ConfirmationState;
  coveragePenalty: number;
  coverageDensity: number;
  completenessScore: number;
  currentHitRate: number | null;
  currentAvgReturnPct: number | null;
  replayHitRate: number | null;
  replayAvgReturnPct: number | null;
  currentVsReplayDrift: number;
  executionGate: boolean;
  sizeMultiplier: number;
  horizonMultiplier: number;
  preferredHorizonHours: number | null;
  horizonLearningConfidence: number | null;
  mappingCount: number;
  cardCount: number;
  reasons: string[];
}

export interface ThemeDiagnosticsSnapshot {
  generatedAt: string;
  globalCoverageDensity: number;
  globalCompletenessScore: number;
  readyCount: number;
  watchCount: number;
  blockedCount: number;
  rows: ThemeDiagnosticsRow[];
}

export interface IdeaCardExplanationPayload extends DecisionExplanationPayload {
  cardId: string;
  title: string;
  themeId: string;
  themeLabel: string;
  direction: InvestmentDirection;
  confirmationScore: number;
  confirmationState: ConfirmationState;
  coveragePenalty: number;
  currentVsReplayDrift: number;
  executionGate: boolean;
  sizeMultiplier: number;
  horizonMultiplier: number;
  status: 'recommended' | 'suppressed' | 'abstained' | 'watch';
}

export interface CurrentDecisionSupportItem {
  bucket: 'act-now' | 'defensive' | 'avoid' | 'watch';
  cardId: string | null;
  title: string;
  themeId: string;
  themeLabel: string;
  action: AutonomyAction;
  direction: InvestmentDirection;
  symbols: string[];
  sizePct: number;
  preferredHorizonHours: number | null;
  replayAvgReturnPct: number | null;
  replayHitRate: number | null;
  currentAvgReturnPct: number | null;
  currentHitRate: number | null;
  currentVsReplayDrift: number;
  rationale: string[];
  caution: string[];
  suggestedAction: string;
}

export interface CurrentDecisionSupportSnapshot {
  generatedAt: string;
  regimeLabel: string;
  regimeConfidence: number;
  summary: string[];
  actNow: CurrentDecisionSupportItem[];
  defensive: CurrentDecisionSupportItem[];
  avoid: CurrentDecisionSupportItem[];
  watch: CurrentDecisionSupportItem[];
}

export interface WorkflowDropoffStageSummary {
  id: string;
  label: string;
  status: WorkflowStatus;
  metric: number;
  keptCount: number;
  droppedCount: number;
  reasons: string[];
}

export interface WorkflowDropoffSummary {
  generatedAt: string;
  readyCount: number;
  watchCount: number;
  blockedCount: number;
  stages: WorkflowDropoffStageSummary[];
}

export interface TrackedIdeaSymbolState {
  symbol: string;
  name: string;
  role: 'primary' | 'confirm' | 'hedge';
  direction: InvestmentDirection;
  sector?: string;
  contextVector?: number[];
  banditScore?: number | null;
  entryPrice: number | null;
  currentPrice: number | null;
  returnPct: number | null;
}

export interface TrackedIdeaState {
  trackingId: string;
  ideaKey: string;
  title: string;
  themeId: string;
  direction: InvestmentDirection;
  status: 'open' | 'closed';
  openedAt: string;
  lastMarkedAt: string;
  closedAt?: string;
  sizePct: number;
  conviction: number;
  falsePositiveRisk: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxHoldingDays: number;
  daysHeld: number;
  currentReturnPct: number | null;
  realizedReturnPct: number | null;
  bestReturnPct: number;
  worstReturnPct: number;
  staleCycles: number;
  exitReason?: string;
  statsCommittedAt?: string;
  convictionFeatures?: ConvictionFeatureSnapshot;
  symbols: TrackedIdeaSymbolState[];
  evidence: string[];
  triggers: string[];
  invalidation: string[];
}

export interface MappingPerformanceStats {
  id: string;
  themeId: string;
  symbol: string;
  direction: InvestmentDirection;
  alpha: number;
  beta: number;
  posteriorWinRate: number;
  emaReturnPct: number;
  emaBestReturnPct: number;
  emaWorstReturnPct: number;
  emaHoldingDays: number;
  observations: number;
  lastUpdatedAt: string;
}

export interface EventBacktestRow {
  id: string;
  themeId: string;
  symbol: string;
  direction: InvestmentDirection;
  sampleSize: number;
  hitRate: number;
  avgReturnPct: number;
  avgBestReturnPct: number;
  avgWorstReturnPct: number;
  avgHoldingDays: number;
  activeCount: number;
  confidence: number;
  notes: string[];
}

export interface MarketHistoryPoint {
  symbol: string;
  timestamp: string;
  price: number;
  change: number | null;
}

export interface FalsePositiveReasonStat {
  reason: string;
  count: number;
}

export interface FalsePositiveStats {
  screened: number;
  rejected: number;
  kept: number;
  reasons: FalsePositiveReasonStat[];
}

export interface UniverseCoverageGap {
  id: string;
  themeId: string;
  themeLabel: string;
  region: string;
  severity: 'watch' | 'elevated' | 'critical';
  reason: string;
  missingAssetKinds: InvestmentAssetKind[];
  missingSectors: string[];
  suggestedSymbols: string[];
}

export interface CandidateExpansionReview {
  id: string;
  themeId: string;
  themeLabel: string;
  symbol: string;
  assetName: string;
  assetKind: InvestmentAssetKind;
  sector: string;
  commodity: string | null;
  direction: InvestmentDirection;
  role: 'primary' | 'confirm' | 'hedge';
  confidence: number;
  source: 'heuristic' | 'watchlist' | 'market' | 'codex';
  status: 'open' | 'accepted' | 'rejected';
  reason: string;
  supportingSignals: string[];
  requiresMarketData: boolean;
  knowledgeGraphScore?: number;
  coverageGainScore?: number;
  replayUtilityGainScore?: number;
  autoApproved: boolean;
  autoApprovalMode?: UniverseExpansionMode | null;
  acceptedAt?: string | null;
  probationStatus: 'n/a' | 'active' | 'graduated' | 'demoted';
  probationCycles: number;
  probationHits: number;
  probationMisses: number;
  lastUpdatedAt: string;
}

export interface UniverseExpansionPolicy {
  mode: UniverseExpansionMode;
  minCodexConfidence: number;
  minAutoApproveScore: number;
  maxAutoApprovalsPerTheme: number;
  maxAutoApprovalsPerSectorPerTheme: number;
  maxAutoApprovalsPerAssetKindPerTheme: number;
  requireMarketData: boolean;
  probationCycles: number;
  autoDemoteMisses: number;
}

export interface UniverseCoverageSummary {
  totalCatalogAssets: number;
  activeAssetKinds: InvestmentAssetKind[];
  activeSectors: string[];
  directMappingCount: number;
  dynamicApprovedCount: number;
  openReviewCount: number;
  gapCount: number;
  uncoveredThemeCount: number;
}

export interface AutonomyControlState {
  shadowMode: boolean;
  rollbackLevel: RollbackLevel;
  recentSampleCount: number;
  recentHitRate: number;
  recentAvgReturnPct: number;
  recentDrawdownPct: number;
  staleIdeaCount: number;
  deployCount: number;
  shadowCount: number;
  watchCount: number;
  abstainCount: number;
  realityBlockedCount: number;
  recentEvidenceWeakCount: number;
  notes: string[];
}

export interface DatasetAutonomySummary {
  mode: 'manual' | 'guarded-auto' | 'full-auto';
  proposals: DatasetProposal[];
}

/** Integration layer metadata added by Phase modules. */
export interface IntegrationMetadata {
  metaConfidence?: { canJudge: boolean; confidence: number; abstentionReasons: string[]; degradedFactors: string[] } | null;
  dataSufficiency?: { level: string; score: number; missingSources: string[] } | null;
  decisionSnapshotCount?: number;
  alertsFired?: Array<{ ruleId: string; severity: string; message: string }>;
  riskGateSummary?: { ideaGateRejected: number; portfolioGateReduced: number } | null;
  sourceQualityWeight?: number;
  stageTimings?: Record<string, number>;
  pipelineErrors?: Array<{ stage: string; error: string; degraded: boolean }>;
}

export interface InvestmentIntelligenceSnapshot {
  generatedAt: string;
  regime?: MarketRegimeState | null;
  macroOverlay: MacroRiskOverlay;
  topThemes: string[];
  workflow: InvestmentWorkflowStep[];
  directMappings: DirectAssetMapping[];
  sectorSensitivity: SectorSensitivityRow[];
  analogs: HistoricalAnalog[];
  backtests: EventBacktestRow[];
  positionSizingRules: PositionSizingRule[];
  ideaCards: InvestmentIdeaCard[];
  trackedIdeas: TrackedIdeaState[];
  falsePositive: FalsePositiveStats;
  universePolicy: UniverseExpansionPolicy;
  universeCoverage: UniverseCoverageSummary;
  coverageGaps: UniverseCoverageGap[];
  candidateReviews: CandidateExpansionReview[];
  autonomy: AutonomyControlState;
  hiddenCandidates: HiddenCandidateDiscovery[];
  experimentRegistry: ExperimentRegistrySnapshot;
  datasetAutonomy: DatasetAutonomySummary;
  coverageLedger?: CoverageLedgerSnapshot | null;
  summaryLines: string[];
  integration?: IntegrationMetadata | null;
}

export interface InvestmentHistoryEntry {
  id: string;
  timestamp: string;
  label: string;
  themes: string[];
  regions: string[];
  symbols: string[];
  avgMovePct: number;
  bestMovePct: number;
  conviction: number;
  falsePositiveRisk: number;
  direction: InvestmentDirection;
  summary: string;
}

export interface ConvictionFeatureSnapshot {
  corroborationQuality: number;
  recentEvidenceScore: number;
  realityScore: number;
  graphSignalScore: number;
  transferEntropy: number;
  banditScore: number;
  regimeMultiplier: number;
  coveragePenalty: number;
  falsePositiveRisk: number;
}

export interface ConvictionModelState {
  weights: Record<keyof ConvictionFeatureSnapshot, number>;
  bias: number;
  observations: number;
  learningRate: number;
  updatedAt: string;
}

export interface InvestmentLearningState {
  snapshot: InvestmentIntelligenceSnapshot | null;
  history: InvestmentHistoryEntry[];
  trackedIdeas: TrackedIdeaState[];
  marketHistory: MarketHistoryPoint[];
  mappingStats: MappingPerformanceStats[];
  banditStates: BanditArmState[];
  candidateReviews: CandidateExpansionReview[];
  convictionModel?: ConvictionModelState | null;
}

export interface EventCandidate {
  id: string;
  title: string;
  source: string;
  region: string;
  text: string;
  sourceCount: number;
  isAlert: boolean;
  eventIntensity: number;
  credibility: number;
  corroboration: number;
  sourceDiversity: number;
  corroborationQuality: number;
  clusterConfidence: number;
  contradictionPenalty: number;
  rumorPenalty: number;
  graphTerms: string[];
  marketStress: number;
  marketStressPrior: number;
  transmissionStress?: number | null;
  aftershockIntensity: number;
  regimeId: string | null;
  regimeConfidence: number;
  matchedSymbols: string[];
  reasons: string[];
}

export interface AdaptiveEventPolicy {
  minSingleSourceQuality: number;
  stressBypassFloor: number;
  intensityBypassFloor: number;
}

export interface ThemeAssetDefinition {
  symbol: string;
  name: string;
  assetKind: InvestmentAssetKind;
  sector: string;
  commodity?: string;
  direction: InvestmentDirection;
  role: 'primary' | 'confirm' | 'hedge';
}

export interface ThemeTriggerPolicy {
  minTriggerHits?: number;
  minStress?: number;
  requireDirectionalTerms?: string[];
}

export interface ThemeAssetPolicy {
  maxPrimaryAssets?: number;
  maxConfirmAssets?: number;
  maxHedgeAssets?: number;
}

export interface ThemeAdmissionPolicy {
  rejectHitProbability?: number;
  watchHitProbability?: number;
  rejectExpectedReturnPct?: number;
  watchExpectedReturnPct?: number;
  rejectScore?: number;
  watchScore?: number;
}

export interface MacroIndicatorSnapshot {
  vix?: number;
  yieldSpread?: number;
  dollarIndex?: number;
  oilPrice?: number;
}

export interface SignalContextSnapshot {
  vix: number | null;
  yieldSpread: number | null;
  creditSpread: number | null;
  gdeltStress: number | null;
  transmissionStrength: number | null;
  capturedAt: string | null;
}

export interface IdeaGenerationRuntimeContext {
  rag: {
    hitRate: number | null;
    confidence: number;
    knnPrediction: KNNPrediction | null;
  };
  admission: {
    thresholds: ThemeAdmissionPolicy | null;
  };
  ml: {
    ensembleModels: unknown | null;
    normalization: { mean: number[]; std: number[] } | null;
  };
  signal: {
    transmissionProxy: TransmissionProxy | null;
    macroIndicators: MacroIndicatorSnapshot | null;
    signalSnapshot: SignalContextSnapshot | null;
  };
}

export interface ThemeNarrativePolicy {
  enabled?: boolean;
  minAlignmentScore?: number;
  weakPenalty?: number;
  mismatchPenalty?: number;
}

export interface ThemeSymbolAdjustment {
  metaScorePenalty?: number;
  sizeMultiplier?: number;
  maxWeightMultiplier?: number;
  requireRiskOff?: boolean;
}

export interface ThemePolicyDefinition {
  classification?: ThemeClassification;
  trigger?: ThemeTriggerPolicy;
  assets?: ThemeAssetPolicy;
  admission?: ThemeAdmissionPolicy;
  narrative?: ThemeNarrativePolicy;
  symbolAdjustments?: Record<string, ThemeSymbolAdjustment>;
}

export interface UniverseAssetDefinition extends ThemeAssetDefinition {
  aliases?: string[];
  themeIds: string[];
  liquidityTier: 'core' | 'high' | 'medium';
  regionBias?: string[];
}

export interface InvestmentThemeDefinition {
  id: string;
  label: string;
  triggers: string[];
  sectors: string[];
  commodities: string[];
  timeframe: string;
  thesis: string;
  invalidation: string[];
  baseSensitivity: number;
  assets: ThemeAssetDefinition[];
  policy?: ThemePolicyDefinition;
}

export interface CodexCandidateExpansionProposal {
  symbol: string;
  assetName?: string;
  assetKind?: InvestmentAssetKind;
  sector?: string;
  commodity?: string | null;
  direction?: InvestmentDirection;
  role?: ThemeAssetDefinition['role'];
  confidence?: number;
  reason?: string;
  supportingSignals?: string[];
}

export interface LocalCodexCandidateExpansionResponse {
  proposals?: CodexCandidateExpansionProposal[];
}

export interface PersistedSnapshotStore {
  snapshot: InvestmentIntelligenceSnapshot | null;
}

export interface PersistedHistoryStore {
  entries: InvestmentHistoryEntry[];
}

export interface PersistedTrackedIdeasStore {
  ideas: TrackedIdeaState[];
}

export interface PersistedMarketHistoryStore {
  points: MarketHistoryPoint[];
}

export interface PersistedMappingStatsStore {
  stats: MappingPerformanceStats[];
}

export interface PersistedBanditStateStore {
  states: BanditArmState[];
}

export interface PersistedConvictionModelStore {
  model: ConvictionModelState;
}

export interface PersistedCandidateReviewStore {
  reviews: CandidateExpansionReview[];
}

export interface PersistedUniversePolicyStore {
  policy: UniverseExpansionPolicy;
}
