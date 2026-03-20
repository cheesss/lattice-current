import type { ClusteredEvent, MarketData } from '@/types';
import type { EventMarketTransmissionSnapshot } from './event-market-transmission';
import type { KeywordGraphSnapshot } from './keyword-registry';
import type { SourceCredibilityProfile } from './source-credibility';
import type { ScheduledReport } from './scheduled-reports';
import type { MarketRegimeState } from './math-models/regime-model';
import type { BanditArmState } from './math-models/contextual-bandit';
import type { AutonomyAction, ConfidenceBand, RollbackLevel } from './autonomy-constraints';
import { computeHawkesIntensity } from './math-models/hawkes-process';
import { estimateLaggedNormalizedMutualInformation } from './math-models/normalized-mutual-information';
import { denoiseCorrelationMatrix } from './math-models/rmt-correlation';
import { estimateTransferEntropy } from './math-models/transfer-entropy';
import { createBanditArmState, scoreBanditArm, updateBanditArm } from './math-models/contextual-bandit';
import { regimeMultiplierForTheme } from './math-models/regime-model';
import { estimateDirectionalFlowSummary, type TimedFlowPoint } from './information-flow';
import { optimizeTargetWeights } from './execution-mpc';
import { inferKnowledgeGraphSupport, type KnowledgeGraphRelationEvidence } from './knowledge-graph';
import {
  assessCrossCorroboration,
  assessExecutionReality,
  assessRecency,
  buildDecisionExplanation,
  buildShadowControlState,
  calibrateDecision,
  type DecisionExplanationPayload,
  type ShadowControlState,
} from './autonomy-constraints';
import {
  type DatasetProposal,
  type DatasetDiscoveryThemeInput,
  proposeDatasetsForThemes,
} from './dataset-discovery';
import {
  type ExperimentRegistrySnapshot,
  type SelfTuningWeightProfile,
  getActiveWeightProfileSync,
  getExperimentRegistrySnapshot,
  summarizeWeightProfile,
} from './experiment-registry';
import {
  type HiddenCandidateDiscovery,
  assessGraphSupport,
  discoverHiddenGraphCandidates,
} from './graph-propagation';
import {
  type MacroRiskOverlay,
  buildMacroRiskOverlay,
} from './macro-risk-overlay';
import {
  buildReplayDrivenWorkflow,
  formatLearnedTimeframe,
  getCurrentThemePerformanceFromSnapshot,
  getReplayAdaptationSnapshot,
  getReplayAdaptationSnapshotSync,
  getReplayThemeProfileFromSnapshot,
  parseThemeTimeframeCandidates,
  recordCurrentThemePerformance,
  type CurrentThemePerformanceMetric,
  type ReplayAdaptationSnapshot,
} from './replay-adaptation';
import {
  buildCoverageLedgerFromMappings,
  getCoveragePenaltyForTheme,
  type CoverageLedgerSnapshot,
} from './coverage-ledger';
import {
  type IdeaAttributionBreakdown,
  buildIdeaAttribution,
} from './decision-attribution';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { logSourceOpsEvent } from './source-ops-log';
import { getMarketWatchlistEntries } from './market-watchlist';

export type InvestmentAssetKind = 'etf' | 'equity' | 'commodity' | 'fx' | 'rate' | 'crypto';
export type InvestmentDirection = 'long' | 'short' | 'hedge' | 'watch' | 'pair';
export type InvestmentBias = 'benefit' | 'pressure' | 'mixed';
export type WorkflowStatus = 'ready' | 'watch' | 'blocked';
export type UniverseExpansionMode = 'manual' | 'guarded-auto' | 'full-auto';
export type ConfirmationState = 'confirmed' | 'tentative' | 'fading' | 'contradicted';
export type InvestmentIntelligenceContext = 'live' | 'replay' | 'validation';

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
  calibratedConfidence: number;
  confirmationScore: number;
  confirmationState: ConfirmationState;
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
  timeDecayWeight: number;
  recentEvidenceScore: number;
  confirmationScore: number;
  confirmationState: ConfirmationState;
  sizeMultiplier: number;
  horizonMultiplier: number;
  executionGate: boolean;
  coveragePenalty: number;
  portfolioCrowdingPenalty?: number;
  executionPlanScore?: number;
  optimizedTargetWeightPct?: number;
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
}

interface PersistedSnapshotStore {
  snapshot: InvestmentIntelligenceSnapshot | null;
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

interface PersistedHistoryStore {
  entries: InvestmentHistoryEntry[];
}

interface PersistedTrackedIdeasStore {
  ideas: TrackedIdeaState[];
}

interface PersistedMarketHistoryStore {
  points: MarketHistoryPoint[];
}

interface PersistedMappingStatsStore {
  stats: MappingPerformanceStats[];
}

interface PersistedBanditStateStore {
  states: BanditArmState[];
}

interface PersistedCandidateReviewStore {
  reviews: CandidateExpansionReview[];
}

interface PersistedUniversePolicyStore {
  policy: UniverseExpansionPolicy;
}

export interface InvestmentLearningState {
  snapshot: InvestmentIntelligenceSnapshot | null;
  history: InvestmentHistoryEntry[];
  trackedIdeas: TrackedIdeaState[];
  marketHistory: MarketHistoryPoint[];
  mappingStats: MappingPerformanceStats[];
  banditStates: BanditArmState[];
  candidateReviews: CandidateExpansionReview[];
}

interface EventCandidate {
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
  contradictionPenalty: number;
  rumorPenalty: number;
  graphTerms: string[];
  marketStress: number;
  aftershockIntensity: number;
  regimeId: string | null;
  regimeConfidence: number;
  matchedSymbols: string[];
  reasons: string[];
}

interface AdaptiveEventPolicy {
  minSingleSourceQuality: number;
  stressBypassFloor: number;
  intensityBypassFloor: number;
}

interface ThemeAssetDefinition {
  symbol: string;
  name: string;
  assetKind: InvestmentAssetKind;
  sector: string;
  commodity?: string;
  direction: InvestmentDirection;
  role: 'primary' | 'confirm' | 'hedge';
}

interface UniverseAssetDefinition extends ThemeAssetDefinition {
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
}

interface ThemeRule extends InvestmentThemeDefinition {}

const SNAPSHOT_KEY = 'investment-intelligence:v1';
const HISTORY_KEY = 'investment-intelligence-history:v1';
const TRACKED_IDEAS_KEY = 'investment-intelligence-tracked-ideas:v1';
const MARKET_HISTORY_KEY = 'investment-intelligence-market-history:v1';
const MAPPING_STATS_KEY = 'investment-intelligence-mapping-stats:v1';
const BANDIT_STATE_KEY = 'investment-intelligence-bandit-states:v1';
const CANDIDATE_REVIEWS_KEY = 'investment-intelligence-candidate-reviews:v1';
const UNIVERSE_POLICY_KEY = 'investment-intelligence-universe-policy:v1';
const MAX_HISTORY = 240;
const MAX_MAPPINGS = 72;
const MAX_IDEAS = 10;
const MAX_ANALOGS = 8;
const MAX_TRACKED_IDEAS = 260;
const MAX_MARKET_HISTORY_POINTS = 12_000;
const MAX_MAPPING_STATS = 900;
const MAX_BANDIT_STATES = 1_400;
const MAX_CANDIDATE_REVIEWS = 480;
const MAPPING_POSTERIOR_DECAY = 0.995;
const RETURN_EMA_ALPHA = 0.18;
const BANDIT_DIMENSION = 8;

const DEFAULT_UNIVERSE_EXPANSION_POLICY: UniverseExpansionPolicy = {
  mode: 'guarded-auto',
  minCodexConfidence: 78,
  minAutoApproveScore: 84,
  maxAutoApprovalsPerTheme: 2,
  maxAutoApprovalsPerSectorPerTheme: 1,
  maxAutoApprovalsPerAssetKindPerTheme: 1,
  requireMarketData: true,
  probationCycles: 4,
  autoDemoteMisses: 3,
};

const ARCHIVE_RE = /\barchive\b|\bin 2011\b|\b15 years after\b|\bfrom the .* archive\b|\banniversary\b/i;
const SPORTS_RE = /\b(baseball|mlb|world cup|paralymp|football team|chef|concert|athletics|pokemon|samurai champloo)\b/i;
const LOW_SIGNAL_RE = /\b(routine update|context update|lifestyle|sports|weather feature)\b/i;
const POSITION_RULES: PositionSizingRule[] = [
  {
    id: 'starter',
    label: 'Starter Probe',
    minConviction: 45,
    maxFalsePositiveRisk: 65,
    maxPositionPct: 0.5,
    grossExposurePct: 2.0,
    stopLossPct: 2.2,
    takeProfitPct: 4.5,
    maxHoldingDays: 3,
    notes: ['Use when signal is fresh but corroboration is limited.', 'Size is intentionally small.'],
  },
  {
    id: 'standard',
    label: 'Standard Event Trade',
    minConviction: 60,
    maxFalsePositiveRisk: 45,
    maxPositionPct: 1.25,
    grossExposurePct: 4.0,
    stopLossPct: 3.5,
    takeProfitPct: 7.0,
    maxHoldingDays: 7,
    notes: ['Use after multi-source validation and clean transmission mapping.'],
  },
  {
    id: 'conviction',
    label: 'High Conviction Macro',
    minConviction: 78,
    maxFalsePositiveRisk: 28,
    maxPositionPct: 2.4,
    grossExposurePct: 6.0,
    stopLossPct: 4.8,
    takeProfitPct: 10.0,
    maxHoldingDays: 14,
    notes: ['Requires corroboration, strong thematic transmission, and acceptable liquidity.'],
  },
  {
    id: 'hedge',
    label: 'Hedge Overlay',
    minConviction: 52,
    maxFalsePositiveRisk: 50,
    maxPositionPct: 0.9,
    grossExposurePct: 3.0,
    stopLossPct: 1.8,
    takeProfitPct: 3.2,
    maxHoldingDays: 10,
    notes: ['Use for gold, volatility, or sector hedge overlays against existing book risk.'],
  },
];

const THEME_RULES: ThemeRule[] = [
  {
    id: 'middle-east-energy-shock',
    label: 'Middle East Energy Shock',
    triggers: ['hormuz', 'strait of hormuz', 'oil', 'crude', 'lng', 'tanker', 'shipping', 'minelayer', 'aramco', 'kharg island'],
    sectors: ['energy', 'shipping', 'fertilizers', 'airlines'],
    commodities: ['crude oil', 'natural gas'],
    timeframe: '1d-10d',
    thesis: 'Energy chokepoint stress typically lifts crude and gas proxies while pressuring transport and fertilizer-sensitive names.',
    invalidation: ['Shipping risk premium fades', 'Oil or gas retrace despite continued headlines', 'Escort or clearance restores flow'],
    baseSensitivity: 84,
    assets: [
      { symbol: 'XLE', name: 'Energy Select Sector SPDR', assetKind: 'etf', sector: 'energy', commodity: 'crude oil', direction: 'long', role: 'primary' },
      { symbol: 'USO', name: 'United States Oil Fund', assetKind: 'etf', sector: 'energy', commodity: 'crude oil', direction: 'long', role: 'primary' },
      { symbol: 'XOM', name: 'Exxon Mobil', assetKind: 'equity', sector: 'energy', commodity: 'crude oil', direction: 'long', role: 'confirm' },
      { symbol: 'CVX', name: 'Chevron', assetKind: 'equity', sector: 'energy', commodity: 'crude oil', direction: 'long', role: 'confirm' },
      { symbol: 'JETS', name: 'U.S. Global Jets ETF', assetKind: 'etf', sector: 'airlines', direction: 'short', role: 'hedge' },
    ],
  },
  {
    id: 'defense-escalation',
    label: 'Defense Escalation',
    triggers: [
      'missile',
      'rocket',
      'airstrike',
      'drone',
      'carrier',
      'navy',
      'destroyed vessels',
      'centcom',
      'munition',
      'patriot',
      'attack',
      'attacked',
      'assault',
      'assaulted',
      'offensive',
      'shell',
      'shelled',
      'artillery',
      'clash',
      'clashed',
      'repelled',
    ],
    sectors: ['defense', 'aerospace', 'surveillance'],
    commodities: [],
    timeframe: '2d-20d',
    thesis: 'Escalating kinetic conflict tends to re-rate defense primes and surveillance exposure while lifting security spending expectations.',
    invalidation: ['Ceasefire holds', 'Operational tempo decays', 'Defense names fail to confirm on heavy news flow'],
    baseSensitivity: 81,
    assets: [
      { symbol: 'ITA', name: 'iShares U.S. Aerospace & Defense ETF', assetKind: 'etf', sector: 'defense', direction: 'long', role: 'primary' },
      { symbol: 'RTX', name: 'RTX Corp.', assetKind: 'equity', sector: 'defense', direction: 'long', role: 'confirm' },
      { symbol: 'LMT', name: 'Lockheed Martin', assetKind: 'equity', sector: 'defense', direction: 'long', role: 'confirm' },
      { symbol: 'NOC', name: 'Northrop Grumman', assetKind: 'equity', sector: 'defense', direction: 'long', role: 'confirm' },
    ],
  },
  {
    id: 'semiconductor-export-risk',
    label: 'Semiconductor / Compute Shock',
    triggers: ['semiconductor', 'chip', 'foundry', 'taiwan', 'export control', 'ai', 'data center', 'cloud', 'compute'],
    sectors: ['semiconductors', 'cloud', 'ai infrastructure'],
    commodities: [],
    timeframe: '2d-15d',
    thesis: 'Export-control or compute bottlenecks transmit quickly into semiconductor beta and AI-capex leaders.',
    invalidation: ['Policy clarity removes restriction risk', 'Supply chain normalizes', 'Chip beta underperforms market move'],
    baseSensitivity: 79,
    assets: [
      { symbol: 'SOXX', name: 'iShares Semiconductor ETF', assetKind: 'etf', sector: 'semiconductors', direction: 'long', role: 'primary' },
      { symbol: 'SMH', name: 'VanEck Semiconductor ETF', assetKind: 'etf', sector: 'semiconductors', direction: 'long', role: 'primary' },
      { symbol: 'NVDA', name: 'NVIDIA', assetKind: 'equity', sector: 'ai infrastructure', direction: 'long', role: 'confirm' },
      { symbol: 'AMD', name: 'AMD', assetKind: 'equity', sector: 'semiconductors', direction: 'long', role: 'confirm' },
      { symbol: 'TSM', name: 'TSMC', assetKind: 'equity', sector: 'semiconductors', direction: 'watch', role: 'confirm' },
    ],
  },
  {
    id: 'fertilizer-and-urea',
    label: 'Fertilizer / Urea Stress',
    triggers: ['urea', 'fertilizer', 'ammonia', 'grain', 'nitrogen', 'lng'],
    sectors: ['fertilizers', 'agriculture inputs', 'chemicals'],
    commodities: ['urea', 'ammonia', 'natural gas'],
    timeframe: '3d-20d',
    thesis: 'Gas-linked fertilizer shocks often reprice nitrogen producers faster than the broader chemicals complex.',
    invalidation: ['Gas prices roll over', 'Trade flows reopen', 'Fertilizer producers fail to confirm volume'],
    baseSensitivity: 76,
    assets: [
      { symbol: 'CF', name: 'CF Industries', assetKind: 'equity', sector: 'fertilizers', commodity: 'urea', direction: 'long', role: 'primary' },
      { symbol: 'NTR', name: 'Nutrien', assetKind: 'equity', sector: 'fertilizers', commodity: 'urea', direction: 'long', role: 'confirm' },
      { symbol: 'MOS', name: 'Mosaic', assetKind: 'equity', sector: 'fertilizers', commodity: 'phosphates', direction: 'long', role: 'confirm' },
    ],
  },
  {
    id: 'cyber-infrastructure',
    label: 'Cyber / Critical Infrastructure',
    triggers: ['cyber', 'malware', 'cisa', 'otx', 'abuseipdb', 'ransomware', 'grid', 'critical infrastructure', 'outage'],
    sectors: ['cybersecurity', 'network infrastructure', 'utilities'],
    commodities: [],
    timeframe: '1d-12d',
    thesis: 'High-confidence cyber or infrastructure disruption tends to benefit cyber-defense exposure and pressure vulnerable operators.',
    invalidation: ['Incident downgraded', 'No corroborating IOC or outage spread', 'Sector beta fails to respond'],
    baseSensitivity: 72,
    assets: [
      { symbol: 'CIBR', name: 'First Trust NASDAQ Cybersecurity ETF', assetKind: 'etf', sector: 'cybersecurity', direction: 'long', role: 'primary' },
      { symbol: 'CRWD', name: 'CrowdStrike', assetKind: 'equity', sector: 'cybersecurity', direction: 'long', role: 'confirm' },
      { symbol: 'PANW', name: 'Palo Alto Networks', assetKind: 'equity', sector: 'cybersecurity', direction: 'long', role: 'confirm' },
      { symbol: 'XLU', name: 'Utilities Select Sector SPDR', assetKind: 'etf', sector: 'utilities', direction: 'hedge', role: 'hedge' },
    ],
  },
  {
    id: 'safe-haven-repricing',
    label: 'Safe-Haven Repricing',
    triggers: ['safe haven', 'war', 'risk-off', 'volatility', 'treasury', 'yield shock', 'flight to safety'],
    sectors: ['gold', 'rates', 'volatility'],
    commodities: ['gold'],
    timeframe: '1d-7d',
    thesis: 'Risk-off macro regimes often lift gold and volatility hedges before cyclical equities adjust.',
    invalidation: ['Volatility compresses immediately', 'Gold fails to confirm on escalation', 'Rates reverse'],
    baseSensitivity: 68,
    assets: [
      { symbol: 'GLD', name: 'SPDR Gold Shares', assetKind: 'etf', sector: 'gold', commodity: 'gold', direction: 'long', role: 'primary' },
      { symbol: '^VIX', name: 'CBOE Volatility Index', assetKind: 'rate', sector: 'volatility', direction: 'hedge', role: 'hedge' },
      { symbol: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', assetKind: 'etf', sector: 'rates', direction: 'hedge', role: 'confirm' },
    ],
  },
];

const UNIVERSE_ASSET_CATALOG: UniverseAssetDefinition[] = [
  { symbol: 'MPC', name: 'Marathon Petroleum', assetKind: 'equity', sector: 'energy', commodity: 'crude oil', direction: 'long', role: 'confirm', themeIds: ['middle-east-energy-shock'], liquidityTier: 'high', aliases: ['refining', 'refiner', 'marathon petroleum'] },
  { symbol: 'VLO', name: 'Valero Energy', assetKind: 'equity', sector: 'energy', commodity: 'crude oil', direction: 'long', role: 'confirm', themeIds: ['middle-east-energy-shock'], liquidityTier: 'high', aliases: ['refining', 'refiner', 'valero'] },
  { symbol: 'COP', name: 'ConocoPhillips', assetKind: 'equity', sector: 'energy', commodity: 'crude oil', direction: 'long', role: 'confirm', themeIds: ['middle-east-energy-shock'], liquidityTier: 'high', aliases: ['upstream', 'conocophillips'] },
  { symbol: 'OXY', name: 'Occidental Petroleum', assetKind: 'equity', sector: 'energy', commodity: 'crude oil', direction: 'long', role: 'confirm', themeIds: ['middle-east-energy-shock'], liquidityTier: 'high', aliases: ['permian', 'occidental'] },
  { symbol: 'SLB', name: 'Schlumberger', assetKind: 'equity', sector: 'energy services', commodity: 'crude oil', direction: 'long', role: 'confirm', themeIds: ['middle-east-energy-shock'], liquidityTier: 'high', aliases: ['oil services', 'schlumberger'] },
  { symbol: 'FRO', name: 'Frontline', assetKind: 'equity', sector: 'shipping', commodity: 'crude oil', direction: 'long', role: 'hedge', themeIds: ['middle-east-energy-shock'], liquidityTier: 'medium', aliases: ['tanker', 'tankers', 'frontline'] },
  { symbol: 'TNK', name: 'Teekay Tankers', assetKind: 'equity', sector: 'shipping', commodity: 'crude oil', direction: 'long', role: 'hedge', themeIds: ['middle-east-energy-shock'], liquidityTier: 'medium', aliases: ['tanker', 'teekay'] },
  { symbol: 'STNG', name: 'Scorpio Tankers', assetKind: 'equity', sector: 'shipping', commodity: 'crude oil', direction: 'long', role: 'hedge', themeIds: ['middle-east-energy-shock'], liquidityTier: 'medium', aliases: ['tanker', 'shipping', 'scorpio'] },
  { symbol: 'DAL', name: 'Delta Air Lines', assetKind: 'equity', sector: 'airlines', direction: 'short', role: 'hedge', themeIds: ['middle-east-energy-shock'], liquidityTier: 'high', aliases: ['delta', 'airline fuel'] },
  { symbol: 'UAL', name: 'United Airlines', assetKind: 'equity', sector: 'airlines', direction: 'short', role: 'hedge', themeIds: ['middle-east-energy-shock'], liquidityTier: 'high', aliases: ['united airlines', 'airline fuel'] },
  { symbol: 'GD', name: 'General Dynamics', assetKind: 'equity', sector: 'defense', direction: 'long', role: 'confirm', themeIds: ['defense-escalation'], liquidityTier: 'high', aliases: ['general dynamics', 'munitions'] },
  { symbol: 'HII', name: 'Huntington Ingalls', assetKind: 'equity', sector: 'defense', direction: 'long', role: 'confirm', themeIds: ['defense-escalation'], liquidityTier: 'medium', aliases: ['shipbuilding', 'naval'] },
  { symbol: 'LHX', name: 'L3Harris Technologies', assetKind: 'equity', sector: 'surveillance', direction: 'long', role: 'confirm', themeIds: ['defense-escalation'], liquidityTier: 'high', aliases: ['surveillance', 'signals intelligence'] },
  { symbol: 'AVAV', name: 'AeroVironment', assetKind: 'equity', sector: 'surveillance', direction: 'long', role: 'confirm', themeIds: ['defense-escalation'], liquidityTier: 'medium', aliases: ['drone', 'loitering munition'] },
  { symbol: 'KTOS', name: 'Kratos Defense', assetKind: 'equity', sector: 'defense', direction: 'long', role: 'confirm', themeIds: ['defense-escalation'], liquidityTier: 'medium', aliases: ['drone', 'defense tech'] },
  { symbol: 'AVGO', name: 'Broadcom', assetKind: 'equity', sector: 'semiconductors', direction: 'long', role: 'confirm', themeIds: ['semiconductor-export-risk'], liquidityTier: 'high', aliases: ['broadcom', 'networking silicon'] },
  { symbol: 'MU', name: 'Micron Technology', assetKind: 'equity', sector: 'semiconductors', direction: 'long', role: 'confirm', themeIds: ['semiconductor-export-risk'], liquidityTier: 'high', aliases: ['memory chips', 'micron'] },
  { symbol: 'ASML', name: 'ASML Holding', assetKind: 'equity', sector: 'semiconductors', direction: 'watch', role: 'confirm', themeIds: ['semiconductor-export-risk'], liquidityTier: 'high', aliases: ['lithography', 'asml'] },
  { symbol: 'AMAT', name: 'Applied Materials', assetKind: 'equity', sector: 'semiconductors', direction: 'long', role: 'confirm', themeIds: ['semiconductor-export-risk'], liquidityTier: 'high', aliases: ['wafer fab equipment', 'applied materials'] },
  { symbol: 'KLAC', name: 'KLA', assetKind: 'equity', sector: 'semiconductors', direction: 'long', role: 'confirm', themeIds: ['semiconductor-export-risk'], liquidityTier: 'medium', aliases: ['process control', 'kla'] },
  { symbol: 'BG', name: 'Bunge Global', assetKind: 'equity', sector: 'agriculture inputs', direction: 'long', role: 'confirm', themeIds: ['fertilizer-and-urea'], liquidityTier: 'high', aliases: ['grain trader', 'fertilizer trade'] },
  { symbol: 'ADM', name: 'Archer-Daniels-Midland', assetKind: 'equity', sector: 'agriculture inputs', direction: 'long', role: 'confirm', themeIds: ['fertilizer-and-urea'], liquidityTier: 'high', aliases: ['grain', 'ag inputs'] },
  { symbol: 'ICL', name: 'ICL Group', assetKind: 'equity', sector: 'fertilizers', commodity: 'potash', direction: 'long', role: 'confirm', themeIds: ['fertilizer-and-urea'], liquidityTier: 'medium', aliases: ['potash', 'fertilizers'] },
  { symbol: 'FTNT', name: 'Fortinet', assetKind: 'equity', sector: 'cybersecurity', direction: 'long', role: 'confirm', themeIds: ['cyber-infrastructure'], liquidityTier: 'high', aliases: ['fortinet', 'network security'] },
  { symbol: 'ZS', name: 'Zscaler', assetKind: 'equity', sector: 'cybersecurity', direction: 'long', role: 'confirm', themeIds: ['cyber-infrastructure'], liquidityTier: 'high', aliases: ['zero trust', 'zscaler'] },
  { symbol: 'NET', name: 'Cloudflare', assetKind: 'equity', sector: 'network infrastructure', direction: 'long', role: 'confirm', themeIds: ['cyber-infrastructure'], liquidityTier: 'high', aliases: ['cloudflare', 'edge security'] },
  { symbol: 'PLTR', name: 'Palantir', assetKind: 'equity', sector: 'cybersecurity', direction: 'watch', role: 'confirm', themeIds: ['cyber-infrastructure', 'defense-escalation'], liquidityTier: 'high', aliases: ['palantir', 'defense software'] },
  { symbol: 'IAU', name: 'iShares Gold Trust', assetKind: 'etf', sector: 'gold', commodity: 'gold', direction: 'long', role: 'confirm', themeIds: ['safe-haven-repricing'], liquidityTier: 'high', aliases: ['gold trust'] },
  { symbol: 'UUP', name: 'Invesco DB US Dollar Index Bullish Fund', assetKind: 'etf', sector: 'fx', direction: 'hedge', role: 'hedge', themeIds: ['safe-haven-repricing'], liquidityTier: 'medium', aliases: ['dollar index', 'usd strength'] },
  { symbol: 'SHY', name: 'iShares 1-3 Year Treasury Bond ETF', assetKind: 'etf', sector: 'rates', direction: 'hedge', role: 'confirm', themeIds: ['safe-haven-repricing'], liquidityTier: 'high', aliases: ['short treasury'] },
  { symbol: 'GOVT', name: 'iShares U.S. Treasury Bond ETF', assetKind: 'etf', sector: 'rates', direction: 'hedge', role: 'confirm', themeIds: ['safe-haven-repricing'], liquidityTier: 'high', aliases: ['treasury bond'] },
];

let loaded = false;
let currentSnapshot: InvestmentIntelligenceSnapshot | null = null;
let currentHistory: InvestmentHistoryEntry[] = [];
let trackedIdeas: TrackedIdeaState[] = [];
let marketHistory: MarketHistoryPoint[] = [];
let marketHistoryKeys = new Set<string>();
let mappingStats = new Map<string, MappingPerformanceStats>();
let banditStates = new Map<string, BanditArmState>();
let candidateReviews = new Map<string, CandidateExpansionReview>();
let automatedThemes = new Map<string, InvestmentThemeDefinition>();
let universeExpansionPolicy: UniverseExpansionPolicy = { ...DEFAULT_UNIVERSE_EXPANSION_POLICY };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asTs(value: string | null | undefined): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-/.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMatchable(value: string): string {
  return normalize(value)
    .replace(/[-/.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function paddedTokenMatch(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

function themeTriggerVariants(trigger: string): string[] {
  const normalizedTrigger = normalizeMatchable(trigger);
  if (!normalizedTrigger) return [];
  if (normalizedTrigger.includes(' ') || normalizedTrigger.length < 4) {
    return [normalizedTrigger];
  }
  const variants = new Set([
    normalizedTrigger,
    `${normalizedTrigger}s`,
    `${normalizedTrigger}es`,
    `${normalizedTrigger}ed`,
    `${normalizedTrigger}ing`,
  ]);
  if (normalizedTrigger.endsWith('y')) {
    variants.add(`${normalizedTrigger.slice(0, -1)}ies`);
  }
  return Array.from(variants);
}

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = clamp(quantile, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? 0;
  const weight = index - lower;
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
}

function matchesThemeTrigger(text: string, trigger: string): boolean {
  const normalizedText = normalizeMatchable(text);
  if (!normalizedText) return false;
  return themeTriggerVariants(trigger).some((variant) => paddedTokenMatch(normalizedText, variant));
}

function scoreEventIntensity(args: {
  text: string;
  sourceCount: number;
  isAlert: boolean;
  relationConfidence?: number | null;
}): number {
  const normalizedText = normalizeMatchable(args.text);
  if (!normalizedText) return args.isAlert ? 52 : 28;
  const cueHits = [
    'attack',
    'attacked',
    'assault',
    'assaulted',
    'offensive',
    'shell',
    'shelled',
    'artillery',
    'missile',
    'rocket',
    'drone',
    'explosion',
    'strike',
    'clash',
    'clashed',
    'repelled',
    'killed',
    'wounded',
    'civilian',
    'outage',
    'cyber',
    'sanction',
    'export control',
    'port',
    'pipeline',
    'shipping',
  ].filter((cue) => matchesThemeTrigger(normalizedText, cue)).length;
  return clamp(
    Math.round(
      26
      + cueHits * 6
      + args.sourceCount * 4
      + (args.isAlert ? 12 : 0)
      + (args.relationConfidence ?? 0) * 0.14,
    ),
    18,
    96,
  );
}

function computeAdaptiveEventPolicy(args: {
  clusters: ClusteredEvent[];
  sourceCredibility: SourceCredibilityProfile[];
}): AdaptiveEventPolicy {
  const sourceCounts = args.clusters.map((cluster) => cluster.sourceCount).filter((value) => Number.isFinite(value));
  const alertRate = args.clusters.length > 0
    ? args.clusters.filter((cluster) => cluster.isAlert).length / args.clusters.length
    : 0;
  const articleCounts = args.sourceCredibility.map((profile) => Math.max(0, profile.articleCount || 0));
  const totalArticles = articleCounts.reduce((sum, value) => sum + value, 0);
  const sourceConcentration = totalArticles > 0
    ? Math.max(...articleCounts, 0) / totalArticles
    : 1;
  const lowerCredibility = percentile(args.sourceCredibility.map((profile) => profile.credibilityScore || 0), 0.35) || 52;
  const lowerFeedHealth = percentile(args.sourceCredibility.map((profile) => profile.feedHealthScore || 0), 0.35) || 58;
  const medianSourceCount = percentile(sourceCounts, 0.5) || 1;

  return {
    minSingleSourceQuality: clamp(
      Math.round(
        44
        + sourceConcentration * 12
        + Math.max(0, 52 - lowerCredibility) * 0.22
        + Math.max(0, 58 - lowerFeedHealth) * 0.18
        - alertRate * 8
        - Math.max(0, medianSourceCount - 1) * 4,
      ),
      32,
      62,
    ),
    stressBypassFloor: clamp(
      Number((0.42 + sourceConcentration * 0.08 - alertRate * 0.08).toFixed(2)),
      0.28,
      0.62,
    ),
    intensityBypassFloor: clamp(
      Math.round(
        64
        + sourceConcentration * 8
        - alertRate * 10
        - Math.max(0, medianSourceCount - 1) * 3,
      ),
      50,
      82,
    ),
  };
}

function rankIdeaSymbolRole(role: InvestmentIdeaSymbol['role']): number {
  if (role === 'primary') return 3;
  if (role === 'confirm') return 2;
  return 1;
}

function scoreIdeaSymbolChoice(symbol: InvestmentIdeaSymbol): number {
  return (
    rankIdeaSymbolRole(symbol.role) * 100
    + (typeof symbol.realityScore === 'number' ? symbol.realityScore : 0)
    + (typeof symbol.liquidityScore === 'number' ? symbol.liquidityScore * 0.5 : 0)
    + (typeof symbol.banditScore === 'number' ? symbol.banditScore * 10 : 0)
  );
}

function dedupeIdeaSymbols(symbols: InvestmentIdeaSymbol[]): InvestmentIdeaSymbol[] {
  const bestByKey = new Map<string, InvestmentIdeaSymbol>();
  for (const symbol of symbols) {
    const key = `${symbol.symbol}::${symbol.direction}`;
    const existing = bestByKey.get(key);
    if (!existing || scoreIdeaSymbolChoice(symbol) > scoreIdeaSymbolChoice(existing)) {
      bestByKey.set(key, symbol);
    }
  }
  return Array.from(bestByKey.values()).sort(
    (left, right) =>
      rankIdeaSymbolRole(right.role) - rankIdeaSymbolRole(left.role)
      || (typeof right.banditScore === 'number' ? right.banditScore : -Infinity) - (typeof left.banditScore === 'number' ? left.banditScore : -Infinity)
      || (typeof right.realityScore === 'number' ? right.realityScore : 0) - (typeof left.realityScore === 'number' ? left.realityScore : 0),
  );
}

function resolveIdeaCardHorizonLearning(
  themeId: string,
  fallbackTimeframe: string,
  replayAdaptation: ReplayAdaptationSnapshot | null,
): {
  timeframe: string;
  preferredHorizonHours: number | null;
  horizonCandidatesHours: number[];
  horizonLearningConfidence: number | null;
  timeframeSource: 'theme-default' | 'replay-learned';
} {
  const learned = getReplayThemeProfileFromSnapshot(replayAdaptation, themeId);
  if (learned) {
    return {
      timeframe: learned.timeframe,
      preferredHorizonHours: learned.preferredHorizonHours,
      horizonCandidatesHours: learned.candidateHorizonHours.slice(),
      horizonLearningConfidence: learned.confidence,
      timeframeSource: 'replay-learned',
    };
  }

  const fallbackCandidates = parseThemeTimeframeCandidates(fallbackTimeframe);
  const preferredHorizonHours = fallbackCandidates.length > 0
    ? fallbackCandidates[Math.floor(fallbackCandidates.length / 2)] || fallbackCandidates[0]!
    : null;
  return {
    timeframe: fallbackTimeframe || '1d-7d',
    preferredHorizonHours,
    horizonCandidatesHours: fallbackCandidates,
    horizonLearningConfidence: null,
    timeframeSource: 'theme-default',
  };
}

function scaleHorizonLearning(
  learning: ReturnType<typeof resolveIdeaCardHorizonLearning>,
  multiplier: number,
): ReturnType<typeof resolveIdeaCardHorizonLearning> {
  const scaledCandidates = Array.from(new Set(
    (learning.horizonCandidatesHours || [])
      .map((value) => Math.max(1, Math.round(value * multiplier)))
      .filter(Boolean),
  )).sort((a, b) => a - b);
  const scaledPreferred = typeof learning.preferredHorizonHours === 'number'
    ? Math.max(1, Math.round(learning.preferredHorizonHours * multiplier))
    : null;
  const prunedCandidates = scaledPreferred && multiplier < 0.95
    ? scaledCandidates.filter((value, index) => index === 0 || value <= scaledPreferred * 1.35)
    : scaledCandidates;
  const scaledTimeframe = scaledCandidates.length > 0
    ? formatLearnedTimeframe(prunedCandidates)
    : learning.timeframe;
  return {
    ...learning,
    timeframe: scaledTimeframe,
    preferredHorizonHours: scaledPreferred,
    horizonCandidatesHours: prunedCandidates,
  };
}

function medianPositiveSpacingHours(hours: number[]): number {
  const sorted = Array.from(new Set(
    (hours || [])
      .map((value) => Math.max(1, Math.round(Number(value) || 0)))
      .filter(Boolean),
  )).sort((a, b) => a - b);
  if (sorted.length <= 1) return sorted[0] || 24;
  const spacings: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const spacing = sorted[index]! - sorted[index - 1]!;
    if (spacing > 0) spacings.push(spacing);
  }
  return Math.max(1, Math.round(median(spacings.length > 0 ? spacings : sorted)));
}

function estimateRegimeConditionalHalfLifePolicy(args: {
  learning: ReturnType<typeof resolveIdeaCardHorizonLearning>;
  replayProfile: ReturnType<typeof getReplayThemeProfileFromSnapshot>;
  currentPerformance: ReturnType<typeof getCurrentThemePerformanceFromSnapshot>;
  referenceTimestamp: string;
  macroOverlay: MacroRiskOverlay;
  coveragePenalty?: number;
  marketConfirmation?: number;
}): {
  rho: number | null;
  halfLifeHours: number | null;
  multiplier: number;
} {
  const preferredHours = args.learning.preferredHorizonHours
    ?? args.learning.horizonCandidatesHours[0]
    ?? null;
  if (!(typeof preferredHours === 'number' && Number.isFinite(preferredHours) && preferredHours > 0)) {
    return { rho: null, halfLifeHours: null, multiplier: 1 };
  }

  const currentPerformance = args.currentPerformance;
  const replayProfile = args.replayProfile;
  const sampleCount = currentPerformance
    ? Math.max(0, Number(currentPerformance.activeCount) || 0) + Math.max(0, Number(currentPerformance.closedCount) || 0)
    : 0;
  const sampleConfidence = clamp(Math.log1p(sampleCount) / Math.log(12), 0, 1);
  const ageHours = currentPerformance
    ? Math.abs(asTs(args.referenceTimestamp) - asTs(currentPerformance.updatedAt)) / 3_600_000
    : 24 * 30;
  const freshness = clamp(1 - ageHours / (24 * 14), 0.2, 1);
  const replayReliability = clamp((replayProfile?.confirmationReliability ?? 52) / 100, 0, 1);
  const replayUtility = clamp(((replayProfile?.coverageAdjustedUtility ?? replayProfile?.utilityScore ?? 0) + 12) / 28, 0, 1);
  const currentHitRate = currentPerformance?.hitRate ?? replayProfile?.hitRate ?? 50;
  const currentReturnPct = currentPerformance?.avgReturnPct ?? replayProfile?.costAdjustedAvgReturnPct ?? 0;
  const currentVsReplayDrift = Math.max(0, -(replayProfile?.currentVsReplayDrift ?? 0));
  const coverageSupport = clamp(1 - (Number(args.coveragePenalty) || 0) / 120, 0.2, 1);
  const marketSupport = clamp((Number(args.marketConfirmation) || 50) / 100, 0.18, 0.98);
  const regimePenalty = args.macroOverlay.killSwitch
    ? 0.24
    : args.macroOverlay.state === 'risk-off'
      ? 0.14
      : args.macroOverlay.state === 'balanced'
        ? 0.06
        : 0;
  const rho = clamp(
    0.44
    + replayReliability * 0.12
    + replayUtility * 0.05
    + sampleConfidence * 0.06
    + freshness * 0.04
    + coverageSupport * 0.04
    + marketSupport * 0.04
    + clamp((currentHitRate - 50) / 100, -0.26, 0.08)
    + clamp(currentReturnPct / 20, -0.28, 0.06)
    - clamp(currentVsReplayDrift / 6, 0, 0.4)
    - regimePenalty,
    0.18,
    0.9,
  );
  const baseIntervalHours = medianPositiveSpacingHours([
    preferredHours,
    ...(replayProfile?.candidateHorizonHours || []),
    ...(args.learning.horizonCandidatesHours || []),
  ]);
  const rawHalfLifeHours = baseIntervalHours * (Math.log(0.5) / Math.log(rho));
  const lossPenalty = currentReturnPct < 0 ? clamp(Math.abs(currentReturnPct) / 3.1, 0, 0.72) : 0;
  const hitPenalty = currentHitRate < 50 ? clamp((50 - currentHitRate) / 18, 0, 0.6) : 0;
  const driftPenalty = clamp(currentVsReplayDrift / 3.2, 0, 0.55);
  const halfLifeHours = clamp(
    rawHalfLifeHours * (1 - lossPenalty * 0.68 - hitPenalty * 0.58 - driftPenalty * 0.52),
    Math.min(baseIntervalHours, preferredHours * 0.35),
    Math.max(baseIntervalHours * 1.6, preferredHours * 0.72),
  );
  const multiplier = clamp(halfLifeHours / preferredHours, 0.12, 1);
  return {
    rho: Number(rho.toFixed(4)),
    halfLifeHours: Number(halfLifeHours.toFixed(0)),
    multiplier: Number(multiplier.toFixed(4)),
  };
}

function applyHalfLifePolicyToLearning(
  learning: ReturnType<typeof resolveIdeaCardHorizonLearning>,
  policy: ReturnType<typeof estimateRegimeConditionalHalfLifePolicy>,
): ReturnType<typeof resolveIdeaCardHorizonLearning> {
  if (!(policy.multiplier > 0) || Math.abs(policy.multiplier - 1) < 0.03) {
    return learning;
  }
  const preferredHours = learning.preferredHorizonHours
    ?? learning.horizonCandidatesHours[0]
    ?? null;
  if (!(typeof preferredHours === 'number' && Number.isFinite(preferredHours) && preferredHours > 0)) {
    return learning;
  }
  const halfLifeHours = Math.max(1, Math.round(policy.halfLifeHours || preferredHours));
  const contractedCandidates = Array.from(new Set(
    (learning.horizonCandidatesHours || [])
      .map((value) => Math.max(1, Math.round(Math.min(value, halfLifeHours))))
      .filter(Boolean),
  )).sort((a, b) => a - b);
  const nextCandidates = contractedCandidates.length > 0
    ? contractedCandidates
    : [Math.max(1, Math.round(halfLifeHours))];
  const nextPreferred = Math.min(
    Math.max(1, Math.round(preferredHours * policy.multiplier)),
    Math.max(...nextCandidates),
  );
  return {
    ...learning,
    timeframe: formatLearnedTimeframe(nextCandidates),
    preferredHorizonHours: nextPreferred,
    horizonCandidatesHours: nextCandidates,
  };
}

function shouldRejectSingleSourceLowCredibility(args: {
  cluster: ClusteredEvent;
  profile: SourceCredibilityProfile | null;
  credibility: number;
  corroboration: number;
  corroborationQuality: number;
  marketStress: number;
  eventIntensity: number;
  policy: AdaptiveEventPolicy;
}): boolean {
  const {
    cluster,
    profile,
    credibility,
    corroboration,
    corroborationQuality,
    marketStress,
    eventIntensity,
    policy,
  } = args;
  if (cluster.sourceCount > 1 || cluster.isAlert || marketStress >= policy.stressBypassFloor) {
    return false;
  }
  const articleCount = Math.max(profile?.articleCount ?? 0, cluster.allItems.length);
  const feedHealthScore = profile?.feedHealthScore ?? 0;
  const truthAgreementScore = profile?.truthAgreementScore ?? 0;
  const articleDepth = Math.min(18, Math.log2(articleCount + 1) * 6);
  const qualityScore = clamp(
    Math.round(
      credibility * 0.24
      + corroboration * 0.16
      + corroborationQuality * 0.22
      + feedHealthScore * 0.12
      + truthAgreementScore * 0.1
      + eventIntensity * 0.12
      + articleDepth
      + marketStress * 14,
    ),
    0,
    100,
  );
  if (eventIntensity >= policy.intensityBypassFloor && qualityScore >= policy.minSingleSourceQuality - 8) {
    return false;
  }
  return qualityScore < policy.minSingleSourceQuality;
}

function normalizeThemeDefinition(theme: InvestmentThemeDefinition): InvestmentThemeDefinition {
  return {
    id: String(theme.id || '').trim().toLowerCase(),
    label: String(theme.label || '').trim() || 'Untitled Theme',
    triggers: Array.isArray(theme.triggers) ? theme.triggers.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).slice(0, 20) : [],
    sectors: Array.isArray(theme.sectors) ? theme.sectors.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).slice(0, 10) : [],
    commodities: Array.isArray(theme.commodities) ? theme.commodities.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).slice(0, 10) : [],
    timeframe: String(theme.timeframe || '1d-7d').trim() || '1d-7d',
    thesis: String(theme.thesis || 'Automated theme proposal.').trim() || 'Automated theme proposal.',
    invalidation: Array.isArray(theme.invalidation) ? theme.invalidation.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6) : [],
    baseSensitivity: clamp(Number(theme.baseSensitivity) || 60, 25, 95),
    assets: dedupeThemeAssets(
      Array.isArray(theme.assets)
        ? theme.assets
          .map((asset) => ({
            symbol: String(asset.symbol || '').trim().toUpperCase(),
            name: String(asset.name || asset.symbol || '').trim() || String(asset.symbol || '').trim().toUpperCase(),
            assetKind: asset.assetKind,
            sector: String(asset.sector || 'cross-asset').trim().toLowerCase() || 'cross-asset',
            commodity: asset.commodity ? String(asset.commodity).trim().toLowerCase() : undefined,
            direction: asset.direction,
            role: asset.role,
          }))
          .filter((asset) => asset.symbol && asset.assetKind && asset.direction && asset.role)
        : [],
    ),
  };
}

function listEffectiveThemeCatalog(): ThemeRule[] {
  return [
    ...THEME_RULES,
    ...Array.from(automatedThemes.values()).map((theme) => normalizeThemeDefinition(theme)),
  ];
}

export function listBaseInvestmentThemes(): InvestmentThemeDefinition[] {
  return THEME_RULES.map((theme) => ({
    ...theme,
    triggers: theme.triggers.slice(),
    sectors: theme.sectors.slice(),
    commodities: theme.commodities.slice(),
    invalidation: theme.invalidation.slice(),
    assets: theme.assets.map((asset) => ({ ...asset })),
  }));
}

export function listAutomatedInvestmentThemes(): InvestmentThemeDefinition[] {
  return Array.from(automatedThemes.values()).map((theme) => ({
    ...theme,
    triggers: theme.triggers.slice(),
    sectors: theme.sectors.slice(),
    commodities: theme.commodities.slice(),
    invalidation: theme.invalidation.slice(),
    assets: theme.assets.map((asset) => ({ ...asset })),
  }));
}

export function setAutomatedThemeCatalog(themes: InvestmentThemeDefinition[]): void {
  automatedThemes = new Map(
    (themes || [])
      .map((theme) => normalizeThemeDefinition(theme))
      .filter((theme) => theme.id && theme.triggers.length > 0)
      .map((theme) => [theme.id, theme] as const),
  );
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function weightedAverage(values: number[], weights: number[]): number {
  const sampleSize = Math.min(values.length, weights.length);
  if (sampleSize <= 0) return 0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    const value = Number(values[index] ?? 0);
    const weight = Math.max(0, Number(weights[index] ?? 0));
    if (!Number.isFinite(value) || !(weight > 0)) continue;
    weightedSum += value * weight;
    totalWeight += weight;
  }
  if (!(totalWeight > 0)) return 0;
  return weightedSum / totalWeight;
}

function weightedStdDev(values: number[], weights: number[]): number {
  const sampleSize = Math.min(values.length, weights.length);
  if (sampleSize <= 1) return 0;
  const mean = weightedAverage(values, weights);
  let weightedVariance = 0;
  let totalWeight = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    const value = Number(values[index] ?? 0);
    const weight = Math.max(0, Number(weights[index] ?? 0));
    if (!Number.isFinite(value) || !(weight > 0)) continue;
    weightedVariance += weight * Math.pow(value - mean, 2);
    totalWeight += weight;
  }
  if (!(totalWeight > 0)) return 0;
  return Math.sqrt(weightedVariance / totalWeight);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function temperatureSoftmax(values: number[], temperature = 1): number[] {
  if (!values.length) return [];
  const boundedTemperature = clamp(temperature, 0.08, 5);
  const maxValue = Math.max(...values);
  const exps = values.map((value) => Math.exp((value - maxValue) / boundedTemperature));
  const total = exps.reduce((acc, value) => acc + value, 0);
  if (!(total > 0)) {
    return values.map(() => 1 / values.length);
  }
  return exps.map((value) => value / total);
}

function normalizeWeights(values: number[]): number[] {
  const clean = values.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
  const total = clean.reduce((acc, value) => acc + value, 0);
  if (!(total > 0)) {
    return clean.map(() => (clean.length > 0 ? 1 / clean.length : 0));
  }
  return clean.map((value) => value / total);
}

function titleId(value: string): string {
  return normalize(value).replace(/\s+/g, '-').slice(0, 120);
}

function themeAssetKey(asset: Pick<ThemeAssetDefinition, 'symbol' | 'direction' | 'role'>): string {
  return `${normalize(asset.symbol)}::${asset.direction}::${asset.role}`;
}

function candidateReviewId(themeId: string, symbol: string, direction: InvestmentDirection, role: ThemeAssetDefinition['role']): string {
  return `${normalize(themeId)}::${normalize(symbol)}::${direction}::${role}`;
}

function dedupeThemeAssets(assets: ThemeAssetDefinition[]): ThemeAssetDefinition[] {
  const seen = new Set<string>();
  const output: ThemeAssetDefinition[] = [];
  for (const asset of assets) {
    const key = themeAssetKey(asset);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(asset);
  }
  return output;
}

function reviewToThemeAsset(review: CandidateExpansionReview): ThemeAssetDefinition {
  return {
    symbol: review.symbol,
    name: review.assetName,
    assetKind: review.assetKind,
    sector: review.sector,
    commodity: review.commodity || undefined,
    direction: review.direction,
    role: review.role,
  };
}

function normalizeCandidateReview(review: CandidateExpansionReview): CandidateExpansionReview {
  return {
    ...review,
    supportingSignals: Array.isArray(review.supportingSignals) ? review.supportingSignals.slice(0, 8) : [],
    knowledgeGraphScore: Number(review.knowledgeGraphScore) || 0,
    coverageGainScore: Number(review.coverageGainScore) || 0,
    replayUtilityGainScore: Number(review.replayUtilityGainScore) || 0,
    source: review.source || 'heuristic',
    status: review.status || 'open',
    autoApproved: Boolean(review.autoApproved),
    autoApprovalMode: review.autoApprovalMode || null,
    acceptedAt: review.acceptedAt || null,
    probationStatus: review.probationStatus || (review.autoApproved ? 'active' : 'n/a'),
    probationCycles: Number.isFinite(review.probationCycles) ? review.probationCycles : 0,
    probationHits: Number.isFinite(review.probationHits) ? review.probationHits : 0,
    probationMisses: Number.isFinite(review.probationMisses) ? review.probationMisses : 0,
    lastUpdatedAt: review.lastUpdatedAt || nowIso(),
  };
}

function normalizeUniverseExpansionPolicy(policy?: Partial<UniverseExpansionPolicy> | null): UniverseExpansionPolicy {
  return {
    mode: policy?.mode === 'manual' || policy?.mode === 'guarded-auto' || policy?.mode === 'full-auto'
      ? policy.mode
      : DEFAULT_UNIVERSE_EXPANSION_POLICY.mode,
    minCodexConfidence: clamp(Number(policy?.minCodexConfidence) || DEFAULT_UNIVERSE_EXPANSION_POLICY.minCodexConfidence, 40, 95),
    minAutoApproveScore: clamp(Number(policy?.minAutoApproveScore) || DEFAULT_UNIVERSE_EXPANSION_POLICY.minAutoApproveScore, 45, 98),
    maxAutoApprovalsPerTheme: clamp(Math.round(Number(policy?.maxAutoApprovalsPerTheme) || DEFAULT_UNIVERSE_EXPANSION_POLICY.maxAutoApprovalsPerTheme), 1, 6),
    maxAutoApprovalsPerSectorPerTheme: clamp(Math.round(Number(policy?.maxAutoApprovalsPerSectorPerTheme) || DEFAULT_UNIVERSE_EXPANSION_POLICY.maxAutoApprovalsPerSectorPerTheme), 1, 4),
    maxAutoApprovalsPerAssetKindPerTheme: clamp(Math.round(Number(policy?.maxAutoApprovalsPerAssetKindPerTheme) || DEFAULT_UNIVERSE_EXPANSION_POLICY.maxAutoApprovalsPerAssetKindPerTheme), 1, 4),
    requireMarketData: typeof policy?.requireMarketData === 'boolean' ? policy.requireMarketData : DEFAULT_UNIVERSE_EXPANSION_POLICY.requireMarketData,
    probationCycles: clamp(Math.round(Number(policy?.probationCycles) || DEFAULT_UNIVERSE_EXPANSION_POLICY.probationCycles), 1, 12),
    autoDemoteMisses: clamp(Math.round(Number(policy?.autoDemoteMisses) || DEFAULT_UNIVERSE_EXPANSION_POLICY.autoDemoteMisses), 1, 12),
  };
}

function normalizeUniverseCoverageSummary(summary?: Partial<UniverseCoverageSummary> | null): UniverseCoverageSummary {
  return {
    totalCatalogAssets: Number(summary?.totalCatalogAssets) || 0,
    activeAssetKinds: Array.isArray(summary?.activeAssetKinds) ? summary!.activeAssetKinds.slice() : [],
    activeSectors: Array.isArray(summary?.activeSectors) ? summary!.activeSectors.slice() : [],
    directMappingCount: Number(summary?.directMappingCount) || 0,
    dynamicApprovedCount: Number(summary?.dynamicApprovedCount) || 0,
    openReviewCount: Number(summary?.openReviewCount) || 0,
    gapCount: Number(summary?.gapCount) || 0,
    uncoveredThemeCount: Number(summary?.uncoveredThemeCount) || 0,
  };
}

function normalizeDirectAssetMapping(mapping: DirectAssetMapping): DirectAssetMapping {
  return {
    ...mapping,
    sourceDiversity: Number(mapping.sourceDiversity) || 0,
    corroborationQuality: Number(mapping.corroborationQuality) || Number(mapping.corroboration) || 0,
    contradictionPenalty: Number(mapping.contradictionPenalty) || 0,
    rumorPenalty: Number(mapping.rumorPenalty) || 0,
    recentEvidenceScore: Number(mapping.recentEvidenceScore) || 0,
    timeDecayWeight: Number(mapping.timeDecayWeight) || 0,
    stalePenalty: Number(mapping.stalePenalty) || 0,
    realityScore: Number(mapping.realityScore) || 0,
    executionPenaltyPct: Number(mapping.executionPenaltyPct) || 0,
    sessionState: mapping.sessionState || 'closed',
    tradableNow: typeof mapping.tradableNow === 'boolean' ? mapping.tradableNow : false,
    graphSignalScore: Number(mapping.graphSignalScore) || 0,
    calibratedConfidence: Number(mapping.calibratedConfidence) || Number(mapping.conviction) || 0,
    confirmationScore: clamp(Number(mapping.confirmationScore) || Number(mapping.calibratedConfidence) || 0, 0, 100),
    confirmationState: mapping.confirmationState === 'confirmed' || mapping.confirmationState === 'tentative' || mapping.confirmationState === 'fading'
      ? mapping.confirmationState
      : 'contradicted',
    sizeMultiplier: clamp(Number(mapping.sizeMultiplier) || 1, 0, 1.5),
    horizonMultiplier: clamp(Number(mapping.horizonMultiplier) || 1, 0.4, 1.6),
    executionGate: typeof mapping.executionGate === 'boolean' ? mapping.executionGate : Boolean(mapping.tradableNow),
    coveragePenalty: clamp(Number(mapping.coveragePenalty) || 0, 0, 100),
    autonomyAction: mapping.autonomyAction || 'watch',
    autonomyReasons: Array.isArray(mapping.autonomyReasons) ? mapping.autonomyReasons.slice(0, 6) : [],
    attribution: mapping.attribution || buildIdeaAttribution({
      themeLabel: mapping.themeLabel || mapping.themeId,
      symbol: mapping.symbol,
      corroborationQuality: Number(mapping.corroborationQuality) || 0,
      contradictionPenalty: Number(mapping.contradictionPenalty) || 0,
      recentEvidenceScore: Number(mapping.recentEvidenceScore) || 0,
      stalePenalty: Number(mapping.stalePenalty) || 0,
      realityScore: Number(mapping.realityScore) || 0,
      transferEntropy: Number(mapping.transferEntropy) || 0,
      banditScore: Number(mapping.banditScore) || 0,
      graphSignalScore: Number(mapping.graphSignalScore) || 0,
      regimeMultiplier: Number(mapping.regimeMultiplier) || 1,
      macroPenalty: 0,
      falsePositiveRisk: Number(mapping.falsePositiveRisk) || 0,
      marketMovePct: mapping.marketMovePct ?? null,
    }),
  };
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

function normalizeAutonomyControlState(state?: Partial<AutonomyControlState> | null): AutonomyControlState {
  return {
    shadowMode: Boolean(state?.shadowMode),
    rollbackLevel: state?.rollbackLevel === 'armed' || state?.rollbackLevel === 'watch' ? state.rollbackLevel : 'normal',
    recentSampleCount: Number(state?.recentSampleCount) || 0,
    recentHitRate: Number(state?.recentHitRate) || 0,
    recentAvgReturnPct: Number(state?.recentAvgReturnPct) || 0,
    recentDrawdownPct: Number(state?.recentDrawdownPct) || 0,
    staleIdeaCount: Number(state?.staleIdeaCount) || 0,
    deployCount: Number(state?.deployCount) || 0,
    shadowCount: Number(state?.shadowCount) || 0,
    watchCount: Number(state?.watchCount) || 0,
    abstainCount: Number(state?.abstainCount) || 0,
    realityBlockedCount: Number(state?.realityBlockedCount) || 0,
    recentEvidenceWeakCount: Number(state?.recentEvidenceWeakCount) || 0,
    notes: Array.isArray(state?.notes) ? state!.notes.slice(0, 8) : [],
  };
}

function normalizeInvestmentSnapshot(snapshot: InvestmentIntelligenceSnapshot | null | undefined): InvestmentIntelligenceSnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    macroOverlay: snapshot.macroOverlay || buildMacroRiskOverlay({
      regime: snapshot.regime ?? null,
      markets: [],
      clusters: [],
      weightProfile: getActiveWeightProfileSync(),
    }),
    directMappings: Array.isArray(snapshot.directMappings)
      ? snapshot.directMappings.map((mapping) => normalizeDirectAssetMapping(mapping))
      : [],
    ideaCards: Array.isArray(snapshot.ideaCards)
      ? snapshot.ideaCards.map((card) => normalizeInvestmentIdeaCard(card))
      : [],
    universePolicy: normalizeUniverseExpansionPolicy(snapshot.universePolicy),
    universeCoverage: normalizeUniverseCoverageSummary(snapshot.universeCoverage),
    coverageGaps: Array.isArray(snapshot.coverageGaps)
      ? snapshot.coverageGaps.map((gap) => ({
        ...gap,
        missingAssetKinds: Array.isArray(gap.missingAssetKinds) ? gap.missingAssetKinds.slice() : [],
        missingSectors: Array.isArray(gap.missingSectors) ? gap.missingSectors.slice() : [],
        suggestedSymbols: Array.isArray(gap.suggestedSymbols) ? gap.suggestedSymbols.slice() : [],
      }))
      : [],
    candidateReviews: Array.isArray(snapshot.candidateReviews)
      ? snapshot.candidateReviews.map((review) => normalizeCandidateReview(review))
      : [],
    autonomy: normalizeAutonomyControlState(snapshot.autonomy),
    hiddenCandidates: Array.isArray(snapshot.hiddenCandidates) ? snapshot.hiddenCandidates.slice(0, 24) : [],
    experimentRegistry: snapshot.experimentRegistry || getExperimentRegistrySnapshot(),
    datasetAutonomy: snapshot.datasetAutonomy || {
      mode: 'guarded-auto',
      proposals: [],
    },
    coverageLedger: snapshot.coverageLedger || null,
  };
}

function uniqueId(prefix: string): string {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${random}`;
}

function marketHistoryKey(point: Pick<MarketHistoryPoint, 'symbol' | 'timestamp'>): string {
  return `${point.symbol}::${point.timestamp}`;
}

function rebuildMarketHistoryIndex(): void {
  marketHistory = marketHistory
    .slice()
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  marketHistoryKeys = new Set(marketHistory.map(marketHistoryKey));
  if (marketHistory.length > MAX_MARKET_HISTORY_POINTS) {
    marketHistory = marketHistory.slice(-MAX_MARKET_HISTORY_POINTS);
    marketHistoryKeys = new Set(marketHistory.map(marketHistoryKey));
  }
}

function findMarketHistoryInsertIndex(timestamp: string): number {
  const targetTs = Date.parse(timestamp);
  let lo = 0;
  let hi = marketHistory.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const midTs = Date.parse(marketHistory[mid]?.timestamp || '');
    if (midTs <= targetTs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function estimateAtrLikePct(symbols: string[]): number | null {
  const candidates = symbols
    .map((symbol) => {
      const points = marketHistory
        .filter((point) => point.symbol === symbol)
        .slice(-15);
      if (points.length < 2) return null;
      const returns: number[] = [];
      for (let index = 1; index < points.length; index += 1) {
        const prev = points[index - 1];
        const next = points[index];
        if (!prev || !next || !prev.price || !next.price) continue;
        returns.push(Math.abs(((next.price - prev.price) / prev.price) * 100));
      }
      if (!returns.length) return null;
      return average(returns);
    })
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!candidates.length) return null;
  return Number(average(candidates).toFixed(2));
}

function findSourceCredibility(map: Map<string, SourceCredibilityProfile>, source: string): SourceCredibilityProfile | null {
  return map.get(normalize(source)) || null;
}

function inferRegion(text: string): string {
  if (/iran|israel|qatar|hormuz|tehran|riyadh|saudi|beirut|lebanon/.test(text)) return 'Middle East';
  if (/ukraine|russia|moscow|kyiv|europe|eu|france|germany/.test(text)) return 'Europe';
  if (/china|taiwan|japan|korea|north korea|south china sea|indopacom/.test(text)) return 'Asia-Pacific';
  if (/africa|sahel|sudan|ethiopia|nigeria|congo/.test(text)) return 'Africa';
  if (/latin america|brazil|argentina|venezuela|mexico/.test(text)) return 'Latin America';
  if (/united states|u\.s\.|washington|fed|wall street/.test(text)) return 'United States';
  return 'Global';
}

function reasonCountsFromMap(reasonMap: Map<string, number>): FalsePositiveReasonStat[] {
  return Array.from(reasonMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, 8);
}

function extractGraphTerms(text: string, reasons: string[] = []): string[] {
  const combined = normalize([text, ...reasons].join(' '));
  return Array.from(new Set(combined.split(' ').filter((token) => token.length >= 4))).slice(0, 14);
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const snapshotCached = await getPersistentCache<PersistedSnapshotStore>(SNAPSHOT_KEY);
    currentSnapshot = normalizeInvestmentSnapshot(snapshotCached?.data?.snapshot ?? null);
  } catch (error) {
    console.warn('[investment-intelligence] snapshot load failed', error);
  }
  try {
    const historyCached = await getPersistentCache<PersistedHistoryStore>(HISTORY_KEY);
    currentHistory = historyCached?.data?.entries ?? [];
  } catch (error) {
    console.warn('[investment-intelligence] history load failed', error);
  }
  try {
    const trackedCached = await getPersistentCache<PersistedTrackedIdeasStore>(TRACKED_IDEAS_KEY);
    trackedIdeas = trackedCached?.data?.ideas ?? [];
  } catch (error) {
    console.warn('[investment-intelligence] tracked ideas load failed', error);
  }
  try {
    const marketCached = await getPersistentCache<PersistedMarketHistoryStore>(MARKET_HISTORY_KEY);
    marketHistory = marketCached?.data?.points ?? [];
    rebuildMarketHistoryIndex();
  } catch (error) {
    console.warn('[investment-intelligence] market history load failed', error);
  }
  try {
    const mappingCached = await getPersistentCache<PersistedMappingStatsStore>(MAPPING_STATS_KEY);
    mappingStats = new Map((mappingCached?.data?.stats ?? []).map((entry) => [entry.id, entry] as const));
  } catch (error) {
    console.warn('[investment-intelligence] mapping stats load failed', error);
  }
  try {
    const banditCached = await getPersistentCache<PersistedBanditStateStore>(BANDIT_STATE_KEY);
    banditStates = new Map((banditCached?.data?.states ?? []).map((entry) => [entry.id, entry] as const));
  } catch (error) {
    console.warn('[investment-intelligence] bandit state load failed', error);
  }
  try {
    const reviewCached = await getPersistentCache<PersistedCandidateReviewStore>(CANDIDATE_REVIEWS_KEY);
    candidateReviews = new Map((reviewCached?.data?.reviews ?? []).map((entry) => {
      const normalized = normalizeCandidateReview(entry);
      return [normalized.id, normalized] as const;
    }));
  } catch (error) {
    console.warn('[investment-intelligence] candidate review load failed', error);
  }
  try {
    const policyCached = await getPersistentCache<PersistedUniversePolicyStore>(UNIVERSE_POLICY_KEY);
    universeExpansionPolicy = normalizeUniverseExpansionPolicy(policyCached?.data?.policy);
  } catch (error) {
    console.warn('[investment-intelligence] universe policy load failed', error);
  }
}

async function persist(): Promise<void> {
  await setPersistentCache(SNAPSHOT_KEY, { snapshot: currentSnapshot });
  await setPersistentCache(HISTORY_KEY, { entries: currentHistory.slice(0, MAX_HISTORY) });
  await setPersistentCache(TRACKED_IDEAS_KEY, { ideas: trackedIdeas.slice(0, MAX_TRACKED_IDEAS) });
  await setPersistentCache(MARKET_HISTORY_KEY, { points: marketHistory.slice(-MAX_MARKET_HISTORY_POINTS) });
  await setPersistentCache(MAPPING_STATS_KEY, {
    stats: Array.from(mappingStats.values())
      .sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt) || b.observations - a.observations)
      .slice(0, MAX_MAPPING_STATS),
  });
  await setPersistentCache(BANDIT_STATE_KEY, {
    states: Array.from(banditStates.values())
      .sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt) || b.pulls - a.pulls)
      .slice(0, MAX_BANDIT_STATES),
  });
  await setPersistentCache(CANDIDATE_REVIEWS_KEY, {
    reviews: Array.from(candidateReviews.values())
      .sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt))
      .slice(0, MAX_CANDIDATE_REVIEWS),
  });
  await setPersistentCache(UNIVERSE_POLICY_KEY, {
    policy: universeExpansionPolicy,
  });
}

function parseReportHistory(reports: ScheduledReport[]): InvestmentHistoryEntry[] {
  return reports.map((report) => {
    const summary = String(report.summary || '');
    const themeMatch = summary.match(/Dominant themes:\s*([^.]*)\./i);
    const themes = (themeMatch?.[1] || '')
      .split(',')
      .map((item) => normalize(item))
      .filter(Boolean)
      .slice(0, 6);

    const symbolMoves: Array<{ symbol: string; move: number }> = [];
    const symbolRe = /([A-Z^][A-Z0-9=.-]{1,15})\s*([+-]\d+(?:\.\d+)?)%/g;
    for (const match of summary.matchAll(symbolRe)) {
      const symbol = String(match[1] || '').trim();
      const move = Number(match[2]);
      if (symbol && Number.isFinite(move)) {
        symbolMoves.push({ symbol, move });
      }
    }

    const avgMovePct = average(symbolMoves.map((item) => item.move));
    const bestMovePct = symbolMoves.length > 0
      ? Math.max(...symbolMoves.map((item) => Math.abs(item.move)))
      : 0;

    return {
      id: `report-${report.id}`,
      timestamp: report.generatedAt,
      label: report.title,
      themes,
      regions: ['Global'],
      symbols: symbolMoves.map((item) => item.symbol).slice(0, 6),
      avgMovePct,
      bestMovePct,
      conviction: report.consensusMode === 'multi-agent' ? 72 : 64,
      falsePositiveRisk: report.rebuttalSummary ? 32 : 46,
      direction: avgMovePct >= 0 ? 'long' : 'short',
      summary,
    };
  });
}

function buildAftershockMap(clusters: ClusteredEvent[]): Map<string, number> {
  const sorted = clusters
    .slice(0, 72)
    .slice()
    .sort((a, b) => Date.parse(a.lastUpdated?.toString?.() || '') - Date.parse(b.lastUpdated?.toString?.() || ''));
  const map = new Map<string, number>();
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    const currentTokens = Array.from(new Set(normalize(current.primaryTitle).split(' ').filter((token) => token.length >= 4))).slice(0, 10);
    const currentRegion = inferRegion(normalize([current.primaryTitle, current.primarySource, ...(current.relations?.evidence || [])].join(' ')));
    const points = sorted.slice(0, index).flatMap((candidate) => {
      const region = inferRegion(normalize([candidate.primaryTitle, candidate.primarySource, ...(candidate.relations?.evidence || [])].join(' ')));
      const candidateTokens = Array.from(new Set(normalize(candidate.primaryTitle).split(' ').filter((token) => token.length >= 4))).slice(0, 10);
      const overlap = scoreArrayOverlap(currentTokens, candidateTokens);
      if (region !== currentRegion && overlap < 2) return [];
      return [{
        timestamp: candidate.lastUpdated,
        weight: (candidate.isAlert ? 1.45 : 1) + candidate.sourceCount * 0.08 + overlap * 0.14,
      }];
    });
    const hawkes = computeHawkesIntensity(points, {
      now: current.lastUpdated,
      alpha: 0.82,
      betaHours: 20,
      baseline: current.isAlert ? 0.22 : 0.14,
      scale: 2.6,
    });
    map.set(current.id || titleId(current.primaryTitle), hawkes.normalized);
  }
  return map;
}

function scoreArrayOverlap(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  let count = 0;
  for (const token of left) {
    if (rightSet.has(token)) count += 1;
  }
  return count;
}

function buildEventCandidates(args: {
  clusters: ClusteredEvent[];
  transmission: EventMarketTransmissionSnapshot | null;
  sourceCredibility: SourceCredibilityProfile[];
}): { kept: EventCandidate[]; falsePositive: FalsePositiveStats } {
  const credibilityMap = new Map(args.sourceCredibility.map((profile) => [normalize(profile.source), profile]));
  const transmissionByTitle = new Map<string, { stress: number; symbols: string[]; reasons: string[] }>();
  const regime = args.transmission?.regime ?? null;
  const aftershockByCluster = buildAftershockMap(args.clusters);
  const adaptiveEventPolicy = computeAdaptiveEventPolicy({
    clusters: args.clusters,
    sourceCredibility: args.sourceCredibility,
  });

  for (const edge of args.transmission?.edges || []) {
    const key = normalize(edge.eventTitle);
    const bucket = transmissionByTitle.get(key) || { stress: 0, symbols: [], reasons: [] };
    bucket.stress = Math.max(bucket.stress, edge.strength / 100);
    if (!bucket.symbols.includes(edge.marketSymbol)) bucket.symbols.push(edge.marketSymbol);
    if (!bucket.reasons.includes(edge.reason)) bucket.reasons.push(edge.reason);
    transmissionByTitle.set(key, bucket);
  }

  const reasonMap = new Map<string, number>();
  const kept: EventCandidate[] = [];
  let screened = 0;
  let rejected = 0;

  for (const cluster of args.clusters.slice(0, 72)) {
    const title = String(cluster.primaryTitle || '').trim();
    if (!title) continue;
    screened += 1;
    const text = normalize([
      cluster.primaryTitle,
      cluster.primarySource,
      ...(cluster.relations?.evidence || []),
      cluster.threat?.level || '',
    ].join(' '));

    const profile = findSourceCredibility(credibilityMap, cluster.primarySource || '');
    const credibility = profile?.credibilityScore ?? 55;
    const corroboration = profile?.corroborationScore ?? Math.min(88, 22 + cluster.sourceCount * 11);
    const eventIntensity = scoreEventIntensity({
      text,
      sourceCount: cluster.sourceCount,
      isAlert: cluster.isAlert,
      relationConfidence: cluster.relations?.confidenceScore ?? null,
    });
    const corroborationAssessment = assessCrossCorroboration({
      primaryTitle: title,
      titles: cluster.allItems.map((item) => item.title),
      sources: [
        cluster.primarySource || '',
        ...cluster.allItems.map((item) => item.source),
        ...cluster.topSources.map((item) => item.name),
      ],
      baseCredibility: credibility,
      baseCorroboration: corroboration,
      feedHealthScore: profile?.feedHealthScore ?? null,
      truthAgreementScore: profile?.truthAgreementScore ?? null,
      relationConfidence: cluster.relations?.confidenceScore ?? null,
    });
    const transmissionInfo = transmissionByTitle.get(normalize(title));
    const marketStress = transmissionInfo?.stress ?? 0;
    const aftershockIntensity = aftershockByCluster.get(cluster.id || titleId(title)) ?? 0;

    const rejectReason = (() => {
      if (ARCHIVE_RE.test(title)) return 'archive-or-historical';
      if (SPORTS_RE.test(title) || SPORTS_RE.test(text)) return 'sports-or-entertainment';
      if (LOW_SIGNAL_RE.test(text) && !cluster.isAlert) return 'routine-low-signal';
      if (shouldRejectSingleSourceLowCredibility({
        cluster,
        profile,
        credibility,
        corroboration,
        corroborationQuality: corroborationAssessment.corroborationQuality,
        marketStress,
        eventIntensity,
        policy: adaptiveEventPolicy,
      })) return 'single-source-low-credibility';
      return null;
    })();

    if (rejectReason) {
      rejected += 1;
      reasonMap.set(rejectReason, (reasonMap.get(rejectReason) || 0) + 1);
      continue;
    }

    kept.push({
      id: cluster.id || titleId(title),
      title,
      source: cluster.primarySource || 'cluster',
      region: inferRegion(text),
      text,
      sourceCount: cluster.sourceCount,
      isAlert: cluster.isAlert,
      eventIntensity,
      credibility,
      corroboration,
      sourceDiversity: corroborationAssessment.sourceDiversity,
      corroborationQuality: corroborationAssessment.corroborationQuality,
      contradictionPenalty: corroborationAssessment.contradictionPenalty,
      rumorPenalty: corroborationAssessment.rumorPenalty,
      graphTerms: extractGraphTerms(text, [
        ...transmissionInfo?.reasons.slice(0, 3) ?? [],
        ...corroborationAssessment.notes,
      ]),
      marketStress,
      aftershockIntensity,
      regimeId: regime?.id ?? null,
      regimeConfidence: regime?.confidence ?? 0,
      matchedSymbols: transmissionInfo?.symbols.slice(0, 6) ?? [],
      reasons: [
        ...(transmissionInfo?.reasons.slice(0, 3) ?? []),
        `EventIntensity=${eventIntensity}`,
        ...corroborationAssessment.notes,
      ].slice(0, 5),
    });
  }

  return {
    kept,
    falsePositive: {
      screened,
      rejected,
      kept: kept.length,
      reasons: reasonCountsFromMap(reasonMap),
    },
  };
}

function findMatchingThemes(candidate: EventCandidate): ThemeRule[] {
  const themeCatalog = listEffectiveThemeCatalog();
  const matches = themeCatalog.filter((rule) => rule.triggers.some((trigger) => matchesThemeTrigger(candidate.text, trigger)));
  if (matches.length > 0) return matches;
  if (candidate.matchedSymbols.length > 0 && candidate.marketStress >= 0.55) {
    return themeCatalog.filter((rule) => candidate.matchedSymbols.some((symbol) => themeHasAssetSymbol(rule, symbol)));
  }
  return [];
}

function marketMoveMap(markets: MarketData[]): Map<string, MarketData> {
  const map = new Map<string, MarketData>();
  for (const market of markets) {
    if (market.symbol) map.set(market.symbol, market);
  }
  return map;
}

function marketPriceMap(markets: MarketData[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const market of markets) {
    if (market.symbol && typeof market.price === 'number' && Number.isFinite(market.price)) {
      map.set(market.symbol, market.price);
    }
  }
  return map;
}

function nowIso(): string {
  return new Date().toISOString();
}

function elapsedDays(fromIso: string, toIso: string): number {
  const diff = Date.parse(toIso) - Date.parse(fromIso);
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return diff / 86_400_000;
}

function symbolRoleWeight(role: InvestmentIdeaSymbol['role']): number {
  if (role === 'primary') return 1;
  if (role === 'confirm') return 0.65;
  return 0.4;
}

function computeDirectedReturnPct(direction: InvestmentDirection, entryPrice: number | null, currentPrice: number | null): number | null {
  if (entryPrice == null || currentPrice == null || !Number.isFinite(entryPrice) || !Number.isFinite(currentPrice) || !entryPrice || entryPrice <= 0) {
    return null;
  }
  const safeEntry = entryPrice;
  const safeCurrent = currentPrice;
  const raw = ((safeCurrent - safeEntry) / safeEntry) * 100;
  if (direction === 'short') return Number((-raw).toFixed(2));
  if (direction === 'watch' || direction === 'pair') return Number(raw.toFixed(2));
  return Number(raw.toFixed(2));
}

function computeWeightedIdeaReturn(symbols: TrackedIdeaSymbolState[]): number | null {
  const weighted: Array<{ value: number; weight: number }> = [];
  for (const symbol of symbols) {
    if (typeof symbol.returnPct !== 'number' || !Number.isFinite(symbol.returnPct)) continue;
    weighted.push({ value: symbol.returnPct, weight: symbolRoleWeight(symbol.role) });
  }
  if (!weighted.length) return null;
  const numerator = weighted.reduce((sum, item) => sum + item.value * item.weight, 0);
  const denominator = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(2));
}

function appendMarketHistory(markets: MarketData[], timestamp: string): void {
  const entries = markets
    .filter((market): market is MarketData & { symbol: string; price: number } =>
      Boolean(market.symbol) && typeof market.price === 'number' && Number.isFinite(market.price),
    )
    .map((market) => ({
      symbol: market.symbol,
      timestamp,
      price: market.price,
      change: market.change ?? null,
    }));
  if (!entries.length) return;
  for (const point of entries) {
    const key = marketHistoryKey(point);
    if (marketHistoryKeys.has(key)) continue;
    const insertIndex = findMarketHistoryInsertIndex(point.timestamp);
    marketHistory.splice(insertIndex, 0, point);
    marketHistoryKeys.add(key);
  }
  if (marketHistory.length > MAX_MARKET_HISTORY_POINTS) {
    const trimmed = marketHistory.slice(-MAX_MARKET_HISTORY_POINTS);
    marketHistory = trimmed;
    marketHistoryKeys = new Set(trimmed.map(marketHistoryKey));
  }
}

function mappingStatsId(themeId: string, symbol: string, direction: InvestmentDirection): string {
  return `${themeId}::${symbol}::${direction}`;
}

function getMappingStats(themeId: string, symbol: string, direction: InvestmentDirection): MappingPerformanceStats | null {
  return mappingStats.get(mappingStatsId(themeId, symbol, direction)) || null;
}

function banditArmId(themeId: string, symbol: string, direction: InvestmentDirection): string {
  return `${themeId}::${symbol}::${direction}`;
}

function getBanditState(themeId: string, symbol: string, direction: InvestmentDirection): BanditArmState {
  return banditStates.get(banditArmId(themeId, symbol, direction)) || createBanditArmState(banditArmId(themeId, symbol, direction), BANDIT_DIMENSION);
}

function getThemeRule(themeId: string): ThemeRule | null {
  return listEffectiveThemeCatalog().find((theme) => theme.id === themeId) || null;
}

function getEffectiveThemeAssets(theme: ThemeRule): ThemeAssetDefinition[] {
  const accepted = Array.from(candidateReviews.values())
    .filter((review) => review.themeId === theme.id && review.status === 'accepted')
    .map(reviewToThemeAsset);
  return dedupeThemeAssets([...theme.assets, ...accepted]);
}

function themeHasAssetSymbol(theme: ThemeRule, symbol: string): boolean {
  const normalizedSymbol = normalize(symbol);
  return getEffectiveThemeAssets(theme).some((asset) => normalize(asset.symbol) === normalizedSymbol);
}

function buildWatchlistLookup(): Map<string, { symbol: string; name?: string }> {
  const lookup = new Map<string, { symbol: string; name?: string }>();
  for (const entry of getMarketWatchlistEntries()) {
    lookup.set(normalize(entry.symbol), { symbol: entry.symbol, name: entry.name });
  }
  return lookup;
}

function scoreExpansionCandidate(args: {
  candidate: EventCandidate;
  theme: ThemeRule;
  asset: UniverseAssetDefinition;
  inWatchlist: boolean;
  hasMarketData: boolean;
}): number {
  const aliasBoost = (args.asset.aliases || []).some((alias) => args.candidate.text.includes(normalize(alias))) ? 10 : 0;
  const commodityBoost = args.asset.commodity && args.theme.commodities.includes(args.asset.commodity) ? 5 : 0;
  const watchlistBoost = args.inWatchlist ? 8 : 0;
  const marketBoost = args.hasMarketData ? 6 : 0;
  const liquidityBoost = args.asset.liquidityTier === 'core' ? 8 : args.asset.liquidityTier === 'high' ? 5 : 2;
  return clamp(
    Math.round(
      36
      + args.candidate.credibility * 0.2
      + args.candidate.corroboration * 0.12
      + args.candidate.marketStress * 18
      + args.candidate.aftershockIntensity * 12
      + aliasBoost
      + commodityBoost
      + watchlistBoost
      + marketBoost
      + liquidityBoost,
    ),
    28,
    96,
  );
}

function buildCandidateExpansionReviews(args: {
  candidates: EventCandidate[];
  markets: MarketData[];
}): CandidateExpansionReview[] {
  const marketMap = marketMoveMap(args.markets);
  const watchlistLookup = buildWatchlistLookup();
  const nextReviews = new Map<string, CandidateExpansionReview>();

  for (const candidate of args.candidates) {
    const themes = findMatchingThemes(candidate);
    for (const theme of themes) {
      const effectiveAssets = new Set(getEffectiveThemeAssets(theme).map(themeAssetKey));
      const effectiveThemeAssets = getEffectiveThemeAssets(theme);
      const existingSectors = new Set(effectiveThemeAssets.map((item) => normalize(item.sector)));
      const existingKinds = new Set(effectiveThemeAssets.map((item) => item.assetKind));
      const existingCommodities = new Set(
        effectiveThemeAssets
          .map((item) => normalize(item.commodity || ''))
          .filter(Boolean),
      );
      const themeCatalog = UNIVERSE_ASSET_CATALOG.filter((asset) => asset.themeIds.includes(theme.id));

      for (const asset of themeCatalog) {
        if (effectiveAssets.has(themeAssetKey(asset))) continue;
        const reviewId = candidateReviewId(theme.id, asset.symbol, asset.direction, asset.role);
        const previous = candidateReviews.get(reviewId);
        const inWatchlist = watchlistLookup.has(normalize(asset.symbol));
        const hasMarketData = marketMap.has(asset.symbol);
        const knowledgeGraphSupport = buildKnowledgeGraphMappingSupport({
          theme,
          candidate,
          asset,
          graphSignalScore: clamp(candidate.corroborationQuality + candidate.sourceDiversity * 4, 0, 100),
          transferEntropy: 0,
          informationFlowScore: clamp(candidate.marketStress * 100, 0, 100),
          leadLagScore: clamp((candidate.aftershockIntensity - 0.25) * 100, -100, 100),
          replayUtility: Number(((candidate.marketStress + candidate.aftershockIntensity) * 20).toFixed(2)),
        });
        const coverageGainScore = clamp(
          Math.round(
            32
            + (existingSectors.has(normalize(asset.sector)) ? 0 : 24)
            + (existingKinds.has(asset.assetKind) ? 0 : 18)
            + (asset.commodity && !existingCommodities.has(normalize(asset.commodity)) ? 12 : 0)
            + (hasMarketData ? 6 : 0),
          ),
          12,
          100,
        );
        const replayUtilityGainScore = clamp(
          Math.round(
            20
            + candidate.marketStress * 18
            + candidate.aftershockIntensity * 16
            + candidate.corroborationQuality * 0.14
            + (hasMarketData ? 8 : 0)
            + (inWatchlist ? 4 : 0),
          ),
          12,
          100,
        );
        const confidence = clamp(
          Math.round(
            scoreExpansionCandidate({ candidate, theme, asset, inWatchlist, hasMarketData }) * 0.72
            + knowledgeGraphSupport.supportScore * 0.16
            + coverageGainScore * 0.08
            + replayUtilityGainScore * 0.04,
          ),
          24,
          98,
        );
        const supportingSignals = [
          candidate.title,
          `Theme=${theme.label}`,
          `Credibility=${candidate.credibility}`,
          `Corroboration=${candidate.corroboration}`,
          `Stress=${candidate.marketStress.toFixed(2)}`,
          `Aftershock=${candidate.aftershockIntensity.toFixed(2)}`,
          `KG=${knowledgeGraphSupport.supportScore.toFixed(0)} ${knowledgeGraphSupport.dominantRelationType}`,
          `CoverageGain=${coverageGainScore}`,
          `ReplayValue=${replayUtilityGainScore}`,
          ...(asset.aliases || []).filter((alias) => candidate.text.includes(normalize(alias))).map((alias) => `Alias=${alias}`),
          ...(inWatchlist ? ['User watchlist overlap'] : []),
          ...(hasMarketData ? ['Live market data available'] : ['No live market data yet']),
        ].slice(0, 7);

        const review: CandidateExpansionReview = {
          id: reviewId,
          themeId: theme.id,
          themeLabel: theme.label,
          symbol: asset.symbol,
          assetName: inWatchlist ? (watchlistLookup.get(normalize(asset.symbol))?.name || asset.name) : asset.name,
          assetKind: asset.assetKind,
          sector: asset.sector,
          commodity: asset.commodity || null,
          direction: asset.direction,
          role: asset.role,
          confidence,
          source: previous?.source || (inWatchlist ? 'watchlist' : 'heuristic'),
          status: previous?.status || 'open',
          reason: previous?.reason || `${asset.name} extends ${theme.label} coverage into ${asset.sector}${asset.commodity ? ` / ${asset.commodity}` : ''}.`,
          supportingSignals: previous?.supportingSignals?.length ? previous.supportingSignals.slice(0, 8) : supportingSignals,
          requiresMarketData: !hasMarketData,
          knowledgeGraphScore: Number(knowledgeGraphSupport.supportScore.toFixed(2)),
          coverageGainScore,
          replayUtilityGainScore,
          autoApproved: previous?.autoApproved || false,
          autoApprovalMode: previous?.autoApprovalMode || null,
          acceptedAt: previous?.acceptedAt || null,
          probationStatus: previous?.probationStatus || 'n/a',
          probationCycles: previous?.probationCycles || 0,
          probationHits: previous?.probationHits || 0,
          probationMisses: previous?.probationMisses || 0,
          lastUpdatedAt: nowIso(),
        };
        const existing = nextReviews.get(reviewId);
        if (!existing || existing.confidence < review.confidence) {
          nextReviews.set(reviewId, review);
        }
      }
    }
  }

  for (const existing of candidateReviews.values()) {
    if (!nextReviews.has(existing.id)) nextReviews.set(existing.id, existing);
  }

  return Array.from(nextReviews.values())
    .sort((a, b) => {
      const statusRank = (value: CandidateExpansionReview['status']): number => (value === 'open' ? 0 : value === 'accepted' ? 1 : 2);
      return statusRank(a.status) - statusRank(b.status)
        || b.confidence - a.confidence
        || Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt);
    })
    .slice(0, MAX_CANDIDATE_REVIEWS);
}

function countAutoApprovedByTheme(reviews: CandidateExpansionReview[], themeId: string): number {
  return reviews.filter((review) => review.themeId === themeId && review.status === 'accepted' && review.autoApproved).length;
}

function countAcceptedByThemeSector(reviews: CandidateExpansionReview[], themeId: string, sector: string): number {
  return reviews.filter((review) =>
    review.themeId === themeId
    && review.status === 'accepted'
    && normalize(review.sector) === normalize(sector),
  ).length;
}

function countAcceptedByThemeAssetKind(reviews: CandidateExpansionReview[], themeId: string, assetKind: InvestmentAssetKind): number {
  return reviews.filter((review) =>
    review.themeId === themeId
    && review.status === 'accepted'
    && review.assetKind === assetKind,
  ).length;
}

function countAcceptedByThemeDirection(reviews: CandidateExpansionReview[], themeId: string, direction: InvestmentDirection): number {
  return reviews.filter((review) =>
    review.themeId === themeId
    && review.status === 'accepted'
    && review.direction === direction,
  ).length;
}

interface CandidateAutoApprovalAssessment {
  approved: boolean;
  score: number;
  reason: string;
}

function assessAutoApprovalReview(
  review: CandidateExpansionReview,
  policy: UniverseExpansionPolicy,
  allReviews: CandidateExpansionReview[],
): CandidateAutoApprovalAssessment {
  if (review.status !== 'open') return { approved: false, score: 0, reason: 'not-open' };
  if (policy.mode === 'manual') return { approved: false, score: 0, reason: 'manual-policy' };
  if (policy.requireMarketData && review.requiresMarketData) return { approved: false, score: 0, reason: 'market-data-required' };

  const themeApproved = countAutoApprovedByTheme(allReviews, review.themeId);
  if (themeApproved >= policy.maxAutoApprovalsPerTheme) {
    return { approved: false, score: 0, reason: 'theme-cap-reached' };
  }

  const acceptedInSector = countAcceptedByThemeSector(allReviews, review.themeId, review.sector);
  if (acceptedInSector >= policy.maxAutoApprovalsPerSectorPerTheme) {
    return { approved: false, score: 0, reason: 'sector-cap-reached' };
  }

  const acceptedInAssetKind = countAcceptedByThemeAssetKind(allReviews, review.themeId, review.assetKind);
  if (acceptedInAssetKind >= policy.maxAutoApprovalsPerAssetKindPerTheme) {
    return { approved: false, score: 0, reason: 'asset-kind-cap-reached' };
  }

  if (policy.mode === 'guarded-auto' && review.source === 'codex' && review.confidence < policy.minCodexConfidence) {
    return { approved: false, score: review.confidence, reason: 'codex-confidence-too-low' };
  }

  let score = review.confidence;
  const sourceBonus = review.source === 'codex'
    ? 10
    : review.source === 'market'
      ? 8
      : review.source === 'watchlist'
        ? 6
        : 2;
  const roleBonus = review.role === 'hedge' ? 7 : review.role === 'confirm' ? 4 : 1;
  const signalBonus = Math.min(12, review.supportingSignals.length * 2);
  const assetKindBonus = review.assetKind === 'etf' ? 5 : review.assetKind === 'commodity' || review.assetKind === 'fx' || review.assetKind === 'rate' ? 4 : 2;
  const commodityBonus = review.commodity ? 4 : 0;
  const knowledgeBonus = clamp(Math.round((Number(review.knowledgeGraphScore) || 0) * 0.12), 0, 12);
  const coverageBonus = clamp(Math.round((Number(review.coverageGainScore) || 0) * 0.08), 0, 10);
  const replayValueBonus = clamp(Math.round((Number(review.replayUtilityGainScore) || 0) * 0.06), 0, 8);
  const missingMarketPenalty = review.requiresMarketData ? 14 : 0;
  const sectorCrowdingPenalty = acceptedInSector * 12;
  const assetKindCrowdingPenalty = acceptedInAssetKind * 10;
  const directionCrowdingPenalty = countAcceptedByThemeDirection(allReviews, review.themeId, review.direction) * 4;
  const themeCrowdingPenalty = themeApproved * 5;
  score += sourceBonus + roleBonus + signalBonus + assetKindBonus + commodityBonus + knowledgeBonus + coverageBonus + replayValueBonus;
  score -= missingMarketPenalty + sectorCrowdingPenalty + assetKindCrowdingPenalty + directionCrowdingPenalty + themeCrowdingPenalty;
  score = clamp(Math.round(score), 0, 100);

  const threshold = policy.mode === 'full-auto'
    ? Math.max(52, policy.minAutoApproveScore - 12)
    : policy.minAutoApproveScore;
  const approved = score >= threshold;
  const reason = `score=${score} source=${review.source} role=${review.role} sectorFill=${acceptedInSector}/${policy.maxAutoApprovalsPerSectorPerTheme} kindFill=${acceptedInAssetKind}/${policy.maxAutoApprovalsPerAssetKindPerTheme}`;
  return { approved, score, reason };
}

function applyUniverseExpansionPolicy(reviews: CandidateExpansionReview[], policy: UniverseExpansionPolicy): CandidateExpansionReview[] {
  const output = reviews.map((review) => ({ ...review }));
  for (let index = 0; index < output.length; index += 1) {
    const review = output[index]!;
    const assessment = assessAutoApprovalReview(review, policy, output);
    if (!assessment.approved) continue;
    const acceptedAt = nowIso();
    output[index] = {
      ...review,
      status: 'accepted',
      autoApproved: true,
      autoApprovalMode: policy.mode,
      acceptedAt,
      probationStatus: 'active',
      probationCycles: 0,
      probationHits: 0,
      probationMisses: 0,
      reason: `${review.reason} Auto-approved by ${policy.mode} policy (${assessment.reason}).`,
      lastUpdatedAt: acceptedAt,
    };
  }
  return output;
}

function evaluateCandidateReviewProbation(args: {
  reviews: CandidateExpansionReview[];
  activeCandidates: EventCandidate[];
  mappings: DirectAssetMapping[];
  backtests: EventBacktestRow[];
  policy: UniverseExpansionPolicy;
}): CandidateExpansionReview[] {
  const activeThemeIds = new Set(args.activeCandidates.flatMap((candidate) => findMatchingThemes(candidate).map((theme) => theme.id)));
  return args.reviews.map((review) => {
    if (review.status !== 'accepted' || !review.autoApproved) return review;
    if (!activeThemeIds.has(review.themeId)) return review;

    const hasMapping = args.mappings.some((mapping) =>
      mapping.themeId === review.themeId
      && normalize(mapping.symbol) === normalize(review.symbol)
      && mapping.direction === review.direction,
    );
    const hasBacktest = args.backtests.some((row) =>
      row.themeId === review.themeId
      && normalize(row.symbol) === normalize(review.symbol)
      && row.direction === review.direction,
    );
    const hit = hasMapping || hasBacktest;
    const nextCycles = review.probationCycles + 1;
    const nextHits = review.probationHits + (hit ? 1 : 0);
    const nextMisses = review.probationMisses + (hit ? 0 : 1);
    const next: CandidateExpansionReview = {
      ...review,
      probationCycles: nextCycles,
      probationHits: nextHits,
      probationMisses: nextMisses,
      lastUpdatedAt: nowIso(),
    };

    if (!hit && nextMisses >= args.policy.autoDemoteMisses) {
      return {
        ...next,
        status: 'open',
        autoApproved: false,
        probationStatus: 'demoted',
        autoApprovalMode: review.autoApprovalMode || args.policy.mode,
        reason: `${review.reason} Auto-demoted after ${nextMisses} probation misses.`,
      };
    }
    if (hit && nextCycles >= args.policy.probationCycles) {
      return {
        ...next,
        probationStatus: 'graduated',
      };
    }
    return {
      ...next,
      probationStatus: 'active',
    };
  });
}

function buildCoverageGaps(args: {
  candidates: EventCandidate[];
  reviews: CandidateExpansionReview[];
}): UniverseCoverageGap[] {
  const gaps = new Map<string, UniverseCoverageGap>();

  for (const candidate of args.candidates) {
    const themes = findMatchingThemes(candidate);
    for (const theme of themes) {
      const effectiveAssets = getEffectiveThemeAssets(theme);
      const effectiveKinds = new Set<InvestmentAssetKind>(effectiveAssets.map((asset) => asset.assetKind));
      const effectiveSectors = new Set<string>(effectiveAssets.map((asset) => asset.sector));
      const catalogAssets = UNIVERSE_ASSET_CATALOG.filter((asset) => asset.themeIds.includes(theme.id));
      const availableKinds = new Set<InvestmentAssetKind>([...theme.assets, ...catalogAssets].map((asset) => asset.assetKind));
      const availableSectors = new Set<string>([...theme.sectors, ...catalogAssets.map((asset) => asset.sector)]);
      const missingAssetKinds = Array.from(availableKinds).filter((kind) => !effectiveKinds.has(kind));
      const missingSectors = Array.from(availableSectors).filter((sector) => !effectiveSectors.has(sector));
      const suggestedSymbols = args.reviews
        .filter((review) => review.themeId === theme.id && review.status === 'open')
        .map((review) => review.symbol)
        .slice(0, 5);

      if (!missingAssetKinds.length && !missingSectors.length && effectiveAssets.length >= Math.min(3, theme.assets.length)) {
        continue;
      }

      const severity: UniverseCoverageGap['severity'] =
        effectiveAssets.length < 2 || missingAssetKinds.length >= 2 || missingSectors.length >= 2
          ? 'critical'
          : missingAssetKinds.length > 0 || missingSectors.length > 0
            ? 'elevated'
            : 'watch';

      gaps.set(`${theme.id}::${candidate.region}`, {
        id: `${theme.id}::${candidate.region}`,
        themeId: theme.id,
        themeLabel: theme.label,
        region: candidate.region,
        severity,
        reason: `${theme.label} lacks full cross-sector coverage for ${candidate.region}.`,
        missingAssetKinds,
        missingSectors,
        suggestedSymbols,
      });
    }
  }

  return Array.from(gaps.values())
    .sort((a, b) => {
      const severityRank = (value: UniverseCoverageGap['severity']): number => (value === 'critical' ? 0 : value === 'elevated' ? 1 : 2);
      return severityRank(a.severity) - severityRank(b.severity) || a.themeLabel.localeCompare(b.themeLabel);
    })
    .slice(0, 24);
}

function buildUniverseCoverageSummary(args: {
  candidates: EventCandidate[];
  mappings: DirectAssetMapping[];
  reviews: CandidateExpansionReview[];
  gaps: UniverseCoverageGap[];
}): UniverseCoverageSummary {
  const activeThemeIds = Array.from(new Set(args.candidates.flatMap((candidate) => findMatchingThemes(candidate).map((theme) => theme.id))));
  const activeAssets = dedupeThemeAssets(activeThemeIds.flatMap((themeId) => {
    const theme = getThemeRule(themeId);
    return theme ? getEffectiveThemeAssets(theme) : [];
  }));

  return {
    totalCatalogAssets: UNIVERSE_ASSET_CATALOG.length,
    activeAssetKinds: Array.from(new Set(activeAssets.map((asset) => asset.assetKind))).sort(),
    activeSectors: Array.from(new Set(activeAssets.map((asset) => asset.sector))).sort(),
    directMappingCount: args.mappings.length,
    dynamicApprovedCount: args.reviews.filter((review) => review.status === 'accepted').length,
    openReviewCount: args.reviews.filter((review) => review.status === 'open').length,
    gapCount: args.gaps.length,
    uncoveredThemeCount: Array.from(new Set(args.gaps.map((gap) => gap.themeId))).length,
  };
}

function updateMappingStatEma(previous: number, nextValue: number): number {
  return Number(((1 - RETURN_EMA_ALPHA) * previous + RETURN_EMA_ALPHA * nextValue).toFixed(2));
}

function buildBanditContext(args: {
  credibility: number;
  corroboration: number;
  marketStress: number;
  aftershockIntensity: number;
  regimeMultiplier: number;
  transferEntropy: number;
  posteriorWinRate: number;
  emaReturnPct: number;
}): number[] {
  return [
    Number((args.credibility / 100).toFixed(4)),
    Number((args.corroboration / 100).toFixed(4)),
    Number(clamp(args.marketStress, 0, 1).toFixed(4)),
    Number(clamp(args.aftershockIntensity, 0, 1).toFixed(4)),
    Number(clamp((args.regimeMultiplier - 0.75) / 0.75, 0, 1.5).toFixed(4)),
    Number(clamp(args.transferEntropy, 0, 1).toFixed(4)),
    Number((args.posteriorWinRate / 100).toFixed(4)),
    Number(clamp((args.emaReturnPct + 10) / 20, 0, 1).toFixed(4)),
  ];
}

function buildEventIntensitySeries(themeId: string, region: string): number[] {
  const entries = currentHistory
    .slice()
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-48);
  if (!entries.length) return [];
  return entries.map((entry) => {
    const themeMatch = entry.themes.includes(themeId) || entry.themes.includes(normalize(themeId));
    const regionMatch = region !== 'Global' && entry.regions.some((item) => normalize(item) === normalize(region));
    if (!themeMatch && !regionMatch) return 0;
    const sign = entry.direction === 'short' ? -1 : 1;
    return Number((((entry.conviction / 100) * (1 - entry.falsePositiveRisk / 120)) * sign).toFixed(4));
  });
}

function buildMarketSignalSeries(symbol: string): number[] {
  const points = marketHistory
    .filter((point) => point.symbol === symbol)
    .slice(-48);
  if (!points.length) return [];
  return points.map((point) => {
    if (typeof point.change === 'number' && Number.isFinite(point.change)) return point.change;
    return 0;
  });
}

function buildTimedEventFlowSeries(themeId: string, region: string): TimedFlowPoint[] {
  return currentHistory
    .slice()
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-96)
    .flatMap((entry) => {
      const themeMatch = entry.themes.includes(themeId) || entry.themes.includes(normalize(themeId));
      const regionMatch = region === 'Global'
        ? true
        : entry.regions.some((item) => normalize(item) === normalize(region));
      if (!themeMatch && !regionMatch) return [];
      const sign = entry.direction === 'short' ? -1 : 1;
      const value = Number((((entry.conviction / 100) * (1 - entry.falsePositiveRisk / 120)) * sign).toFixed(4));
      return [{
        at: entry.timestamp,
        value,
        weight: 1 + Math.min(1.8, Math.abs(entry.bestMovePct) / 6),
      }];
    });
}

function buildTimedMarketFlowSeries(symbol: string): TimedFlowPoint[] {
  return marketHistory
    .filter((point) => point.symbol === symbol)
    .slice(-96)
    .map((point) => ({
      at: point.timestamp,
      value: typeof point.change === 'number' && Number.isFinite(point.change) ? point.change : 0,
      weight: 1 + Math.min(1.4, Math.abs(point.change || 0) * 0.12),
    }));
}

function buildKnowledgeGraphMappingSupport(args: {
  theme: ThemeRule;
  candidate: EventCandidate;
  asset: ThemeAssetDefinition;
  graphSignalScore: number;
  transferEntropy: number;
  informationFlowScore: number;
  leadLagScore: number;
  replayUtility: number;
}): {
  supportScore: number;
  dominantRelationType: string;
  notes: string[];
} {
  const nodes = [
    { id: `theme:${args.theme.id}`, prior: clamp(0.42 + args.candidate.corroborationQuality / 180, 0.2, 0.92), kind: 'theme' as const, label: args.theme.label },
    { id: `asset:${args.asset.symbol}`, prior: clamp(0.36 + args.candidate.credibility / 220, 0.16, 0.9), kind: 'asset' as const, label: args.asset.name },
    { id: `region:${normalize(args.candidate.region || 'global')}`, prior: clamp(0.32 + args.candidate.marketStress * 0.24, 0.14, 0.84), kind: 'country' as const, label: args.candidate.region || 'Global' },
    { id: `source:${normalize(args.candidate.source || 'event')}`, prior: clamp(0.24 + args.candidate.credibility / 180, 0.12, 0.88), kind: 'source' as const, label: args.candidate.source || 'event' },
  ];
  const evidence: KnowledgeGraphRelationEvidence[] = [
    {
      from: `theme:${args.theme.id}`,
      to: `asset:${args.asset.symbol}`,
      relationType: args.asset.commodity ? 'commodity-exposure' : `${args.asset.sector}-exposure`,
      strength: args.graphSignalScore,
      confidence: args.candidate.corroborationQuality,
      corroboration: args.candidate.corroborationQuality,
      leadLagScore: args.leadLagScore,
      coverageScore: clamp(58 + args.candidate.sourceDiversity * 6, 20, 100),
      truthAgreement: clamp(args.candidate.credibility, 0, 100),
      contradictionPenalty: clamp(args.candidate.contradictionPenalty, 0, 100),
      supportCount: Math.max(1, args.candidate.sourceCount),
      notes: [
        `Flow=${args.informationFlowScore.toFixed(2)}`,
        `TE=${args.transferEntropy.toFixed(2)}`,
        `ReplayUtility=${args.replayUtility.toFixed(2)}`,
      ],
    },
    {
      from: `region:${normalize(args.candidate.region || 'global')}`,
      to: `asset:${args.asset.symbol}`,
      relationType: 'region-exposure',
      strength: clamp(30 + args.candidate.marketStress * 40 + args.candidate.aftershockIntensity * 26, 0, 100),
      confidence: args.candidate.credibility,
      corroboration: args.candidate.corroborationQuality,
      leadLagScore: args.leadLagScore,
      coverageScore: clamp(48 + args.candidate.sourceDiversity * 8, 10, 100),
      truthAgreement: args.candidate.credibility,
      contradictionPenalty: args.candidate.contradictionPenalty,
      supportCount: Math.max(1, args.candidate.sourceCount),
    },
    {
      from: `source:${normalize(args.candidate.source || 'event')}`,
      to: `theme:${args.theme.id}`,
      relationType: 'source-supports',
      strength: clamp(24 + args.candidate.credibility * 0.56 + args.candidate.corroborationQuality * 0.18, 0, 100),
      confidence: args.candidate.credibility,
      corroboration: args.candidate.corroborationQuality,
      leadLagScore: Math.max(0, args.leadLagScore),
      coverageScore: clamp(40 + args.candidate.sourceDiversity * 10, 0, 100),
      truthAgreement: args.candidate.credibility,
      contradictionPenalty: args.candidate.contradictionPenalty,
      supportCount: Math.max(1, args.candidate.sourceCount),
    },
  ];
  const inference = inferKnowledgeGraphSupport(nodes, evidence, { iterations: 4, damping: 0.82, priorFloor: 0.14 });
  const summary = inference.relationSummaries[0];
  return {
    supportScore: clamp(summary?.supportScore ?? 0, 0, 100),
    dominantRelationType: summary?.dominantRelationType || 'related',
    notes: (summary?.notes || []).slice(0, 4),
  };
}

function pearsonCorrelation(left: number[], right: number[]): number {
  const samples = Math.min(left.length, right.length);
  if (samples < 3) return 0;
  const x = left.slice(-samples);
  const y = right.slice(-samples);
  const meanX = average(x);
  const meanY = average(y);
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let index = 0; index < samples; index += 1) {
    const dx = (x[index] ?? 0) - meanX;
    const dy = (y[index] ?? 0) - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denominator = Math.sqrt(denomX * denomY);
  if (!denominator) return 0;
  return clamp(numerator / denominator, -1, 1);
}

function buildRecentReturnSeries(symbol: string, maxPoints = 48): number[] {
  return marketHistory
    .filter((point) => point.symbol === symbol && typeof point.change === 'number' && Number.isFinite(point.change))
    .slice(-maxPoints)
    .map((point) => Number(point.change) || 0);
}

function estimateMacroStressProbability(macroOverlay: MacroRiskOverlay): number {
  const base = macroOverlay.killSwitch
    ? 1
    : macroOverlay.state === 'risk-off'
      ? 0.84
      : macroOverlay.state === 'balanced'
        ? 0.46
        : 0.16;
  return clamp(Math.max(base, (Number(macroOverlay.riskGauge) || 0) / 100), 0, 1);
}

function isCoreInstrumentSymbol(symbol: InvestmentIdeaSymbol): boolean {
  if (symbol.role === 'hedge') return false;
  return symbol.assetKind === 'etf'
    || symbol.assetKind === 'rate'
    || symbol.assetKind === 'commodity'
    || symbol.assetKind === 'fx';
}

function summarizeInstrumentMix(symbols: InvestmentIdeaSymbol[]): {
  coreCount: number;
  orbitalCount: number;
  hedgeCount: number;
  coreShare: number;
  hasCore: boolean;
  hasOrbital: boolean;
} {
  const nonHedge = symbols.filter((symbol) => symbol.role !== 'hedge');
  const coreCount = nonHedge.filter(isCoreInstrumentSymbol).length;
  const orbitalCount = nonHedge.filter((symbol) => symbol.assetKind === 'equity').length;
  const hedgeCount = symbols.filter((symbol) => symbol.role === 'hedge').length;
  const denominator = Math.max(1, coreCount + orbitalCount);
  return {
    coreCount,
    orbitalCount,
    hedgeCount,
    coreShare: Number((coreCount / denominator).toFixed(4)),
    hasCore: coreCount > 0,
    hasOrbital: orbitalCount > 0,
  };
}

function estimateCoreOrbitalAlignmentScore(
  benchmarkSymbol: string,
  candidateSymbol: InvestmentIdeaSymbol,
): number {
  const benchmarkSeries = buildRecentReturnSeries(benchmarkSymbol);
  const candidateSeries = buildRecentReturnSeries(candidateSymbol.symbol);
  const sampleSize = Math.min(benchmarkSeries.length, candidateSeries.length);
  if (sampleSize < 8) {
    const liquidity = clamp((Number(candidateSymbol.liquidityScore) || 58) / 100, 0.25, 1);
    const bandit = clamp((Number(candidateSymbol.banditScore) || 55) / 100, 0.2, 1);
    return Number((0.58 * liquidity + 0.42 * bandit).toFixed(4));
  }

  const benchmark = benchmarkSeries.slice(-sampleSize);
  const candidate = candidateSeries.slice(-sampleSize);
  const corr = clamp((pearsonCorrelation(benchmark, candidate) + 1) / 2, 0, 1);
  const nmi = estimateLaggedNormalizedMutualInformation(benchmark, candidate, { maxLag: 3 });
  const liquidity = clamp((Number(candidateSymbol.liquidityScore) || 58) / 100, 0.25, 1);
  const bandit = clamp((Number(candidateSymbol.banditScore) || 55) / 100, 0.2, 1);
  return Number((
    corr * 0.34
    + nmi.supportScore * 0.34
    + liquidity * 0.18
    + bandit * 0.14
  ).toFixed(4));
}

function buildCoreOrbitalExecutionPlan(
  card: InvestmentIdeaCard,
  macroOverlay: MacroRiskOverlay,
): {
  symbols: InvestmentIdeaSymbol[];
  reasons: string[];
  coreShare: number;
  orbitalPenalty: number;
  retainedOrbitalCount: number;
  benchmarkSymbol: string | null;
} {
  const nonHedge = card.symbols.filter((symbol) => symbol.role !== 'hedge');
  const coreSymbols = nonHedge.filter(isCoreInstrumentSymbol);
  const orbitalSymbols = nonHedge.filter((symbol) => symbol.assetKind === 'equity');
  if (!coreSymbols.length || !orbitalSymbols.length) {
    const mix = summarizeInstrumentMix(card.symbols);
    return {
      symbols: card.symbols.slice(),
      reasons: [],
      coreShare: mix.coreShare,
      orbitalPenalty: 0,
      retainedOrbitalCount: mix.orbitalCount,
      benchmarkSymbol: coreSymbols[0]?.symbol || null,
    };
  }

  const benchmarkSymbol = coreSymbols
    .slice()
    .sort((left, right) =>
      Number(right.liquidityScore || 0) - Number(left.liquidityScore || 0)
      || Number(right.banditScore || 0) - Number(left.banditScore || 0)
      || (left.role === 'primary' ? -1 : 1),
    )[0]?.symbol || coreSymbols[0]?.symbol || null;
  const online = computeOnlineRankingAdjustment(card, macroOverlay);
  const stressProbability = estimateMacroStressProbability(macroOverlay);
  const scoredOrbital = orbitalSymbols
    .map((symbol) => ({
      symbol,
      alignment: benchmarkSymbol ? estimateCoreOrbitalAlignmentScore(benchmarkSymbol, symbol) : 0.5,
    }))
    .sort((left, right) =>
      right.alignment - left.alignment
      || Number(right.symbol.liquidityScore || 0) - Number(left.symbol.liquidityScore || 0)
      || Number(right.symbol.banditScore || 0) - Number(left.symbol.banditScore || 0),
    );
  const averageAlignment = average(scoredOrbital.map((item) => item.alignment));
  const negativeCurrent = clamp(Math.abs(Math.min(0, online.currentReturnPct)) / 2.5, 0, 2.4);
  const negativeDrift = clamp(Math.abs(Math.min(0, online.drift)) / 1.25, 0, 2.6);
  const hitPenalty = clamp((50 - online.currentHitRate) / 18, 0, 1.4);
  const lambda = 1.05 + negativeCurrent * 0.55 + negativeDrift * 0.72 + hitPenalty * 0.35;
  const orbitalGate = clamp(
    Math.exp(-lambda * stressProbability * Math.max(0.24, 1.08 - averageAlignment)),
    0,
    1,
  );
  const hardGate =
    stressProbability >= 0.78
    || (stressProbability >= 0.6 && (online.drift <= -0.45 || online.currentReturnPct <= -0.8))
    || (stressProbability >= 0.55 && averageAlignment < 0.42);
  const maxOrbitalCount = hardGate
    ? 0
    : stressProbability >= 0.68
      ? 0
      : stressProbability >= 0.5
        ? 1
        : stressProbability >= 0.32
          ? 1
          : 2;
  const minAlignment = stressProbability >= 0.6
    ? 0.62
    : stressProbability >= 0.45
      ? 0.56
      : 0.48;
  const retainedOrbital = hardGate || orbitalGate < 0.2
    ? []
    : scoredOrbital
      .filter((item) => item.alignment >= minAlignment)
      .slice(0, maxOrbitalCount)
      .map((item) => item.symbol);
  const retainedKeys = new Set(
    [...coreSymbols, ...retainedOrbital, ...card.symbols.filter((symbol) => symbol.role === 'hedge')]
      .map((symbol) => `${symbol.symbol}:${symbol.role}`),
  );
  const filteredSymbols = card.symbols.filter((symbol) => retainedKeys.has(`${symbol.symbol}:${symbol.role}`));
  const retainedShare = orbitalSymbols.length > 0 ? retainedOrbital.length / orbitalSymbols.length : 1;
  const orbitalPenalty = Number(clamp(
    (1 - retainedShare) * 0.7
    + Math.max(0, 0.55 - averageAlignment) * 0.75
    + stressProbability * 0.18,
    0,
    1,
  ).toFixed(4));
  const reasons: string[] = [];
  if (retainedOrbital.length < orbitalSymbols.length) {
    reasons.push(
      hardGate
        ? `Stress-aware ETF-first gating removed single-name confirm legs and kept ${coreSymbols.map((symbol) => symbol.symbol).join(', ')} as the cluster core.`
        : `Core-orbital filtering retained ${retainedOrbital.length}/${orbitalSymbols.length} single-name legs behind ETF core ${coreSymbols.map((symbol) => symbol.symbol).join(', ')}.`,
    );
  }
  if (benchmarkSymbol && averageAlignment < 0.52) {
    reasons.push(`Single-name legs showed weak ETF alignment (${(averageAlignment * 100).toFixed(0)}%), so idiosyncratic risk was suppressed.`);
  }
  const filteredMix = summarizeInstrumentMix(filteredSymbols);
  return {
    symbols: filteredSymbols.length ? filteredSymbols : card.symbols.slice(),
    reasons,
    coreShare: filteredMix.coreShare,
    orbitalPenalty,
    retainedOrbitalCount: retainedOrbital.length,
    benchmarkSymbol,
  };
}

function computeCorrelationAwareSizingPenalty(symbols: string[]): {
  globalPenalty: number;
  rowPenaltyBySymbol: Map<string, number>;
  summary: string[];
} {
  const uniqueSymbols = Array.from(new Set(symbols.filter(Boolean)));
  if (uniqueSymbols.length < 2) {
    return { globalPenalty: 0, rowPenaltyBySymbol: new Map(), summary: [] };
  }

  const seriesBySymbol = new Map(uniqueSymbols.map((symbol) => [symbol, buildRecentReturnSeries(symbol)] as const));
  const sampleSize = Math.min(...Array.from(seriesBySymbol.values()).map((series) => series.length));
  if (!Number.isFinite(sampleSize) || sampleSize < 8) {
    return { globalPenalty: 0, rowPenaltyBySymbol: new Map(), summary: [] };
  }

  const matrix = uniqueSymbols.map((leftSymbol) =>
    uniqueSymbols.map((rightSymbol) => {
      if (leftSymbol === rightSymbol) return 1;
      return pearsonCorrelation(
        seriesBySymbol.get(leftSymbol)!.slice(-sampleSize),
        seriesBySymbol.get(rightSymbol)!.slice(-sampleSize),
      );
    }),
  );
  const denoised = denoiseCorrelationMatrix(matrix, { sampleSize });
  const rowPenaltyBySymbol = new Map<string, number>();
  for (let row = 0; row < uniqueSymbols.length; row += 1) {
    const offDiagonal = denoised.denoisedMatrix[row]!
      .filter((_, column) => column !== row)
      .map((value) => Math.abs(value));
    const rowMean = average(offDiagonal);
    rowPenaltyBySymbol.set(uniqueSymbols[row]!, clamp(Number((rowMean * 0.42 + denoised.concentration.crowdingPenalty * 0.38).toFixed(4)), 0, 0.55));
  }

  return {
    globalPenalty: clamp(Number((denoised.concentration.crowdingPenalty * 0.42).toFixed(4)), 0, 0.45),
    rowPenaltyBySymbol,
    summary: denoised.summary.slice(0, 3),
  };
}

function capitalReadinessScore(card: InvestmentIdeaCard): number {
  return clamp(
    card.confirmationScore * 0.3
    + card.realityScore * 0.14
    + card.graphSignalScore * 0.11
    + (100 - card.coveragePenalty) * 0.16
    + clamp(card.calibratedConfidence, 0, 100) * 0.12
    + clamp(100 - (Number(card.portfolioCrowdingPenalty) || 0) * 100, 0, 100) * 0.09
    + clamp(card.sizeMultiplier * 100, 0, 150) * 0.08,
    0,
    100,
  );
}

function calibrateCapitalBudget(
  cards: InvestmentIdeaCard[],
  macroOverlay: MacroRiskOverlay,
): {
  grossBudgetPct: number;
  promotedDeployIds: Set<string>;
  deployRate: number;
  candidateBreadth: number;
  confirmationMedian: number;
  confirmationSpread: number;
  readinessMedian: number;
  readinessSpread: number;
} {
  const eligibleCards = cards.filter((card) => card.confirmationState !== 'contradicted');
  if (macroOverlay.killSwitch || !eligibleCards.length) {
    return {
      grossBudgetPct: 0,
      promotedDeployIds: new Set<string>(),
      deployRate: 0,
      candidateBreadth: 0,
      confirmationMedian: 0,
      confirmationSpread: 0,
      readinessMedian: 0,
      readinessSpread: 0,
    };
  }

  const readinessRows = eligibleCards.map((card) => ({
    card,
    score: capitalReadinessScore(card),
  }));
  const confirmationValues = eligibleCards.map((card) => card.confirmationScore);
  const readinessValues = readinessRows.map((row) => row.score);
  const confirmationMedian = median(confirmationValues);
  const confirmationSpread = percentile(confirmationValues, 0.75) - percentile(confirmationValues, 0.25);
  const readinessMedian = median(readinessValues);
  const readinessSpread = percentile(readinessValues, 0.75) - percentile(readinessValues, 0.25);
  const deployRate = eligibleCards.filter((card) => card.autonomyAction === 'deploy' && card.executionGate).length / eligibleCards.length;
  const candidateBreadth = eligibleCards.filter((card) => card.executionGate && card.confirmationScore >= confirmationMedian).length / eligibleCards.length;
  const budgetBase = macroOverlay.state === 'risk-on'
    ? 30
    : macroOverlay.state === 'balanced'
      ? 20
      : 10;
  const budgetSupport = clamp(
    0.55
    + deployRate * 0.7
    + candidateBreadth * 1
    + clamp((confirmationMedian - 50) / 100, 0, 0.2)
    + clamp(confirmationSpread / 220, 0, 0.14)
    + clamp((readinessMedian - 48) / 110, 0, 0.18)
    + clamp(readinessSpread / 260, 0, 0.1)
    - (average(eligibleCards.map((card) => card.coveragePenalty)) / 100) * 0.18,
    0.35,
    1.55,
  );
  const regimeCap = macroOverlay.state === 'risk-on'
    ? 44
    : macroOverlay.state === 'balanced'
      ? 30
      : 16;
  const grossBudgetPct = clamp(Number((budgetBase * budgetSupport).toFixed(2)), 0, Math.min(macroOverlay.grossExposureCapPct, regimeCap));
  const deploymentShare = clamp(
    (macroOverlay.state === 'risk-on' ? 0.16 : macroOverlay.state === 'balanced' ? 0.12 : 0.08)
    + deployRate * 0.14
    + candidateBreadth * 0.22
    + clamp((readinessMedian - 45) / 220, 0, 0.08)
    + clamp(readinessSpread / 500, 0, 0.06),
    macroOverlay.state === 'risk-off' ? 0.08 : 0.12,
    macroOverlay.state === 'risk-on' ? 0.58 : macroOverlay.state === 'balanced' ? 0.44 : 0.26,
  );
  const targetDeployCount = clamp(
    Math.round(Math.max(
      macroOverlay.state === 'risk-off' ? 1 : 2,
      eligibleCards.length * deploymentShare * 0.78 + Math.sqrt(eligibleCards.length) * 0.2,
    )),
    macroOverlay.state === 'risk-off' ? 1 : 2,
    Math.min(eligibleCards.length, macroOverlay.state === 'risk-on' ? 9 : macroOverlay.state === 'balanced' ? 6 : 3),
  );
  const promotionCandidates = eligibleCards
    .filter((card) => card.executionGate && card.confirmationState !== 'contradicted')
    .map((card) => ({
      ...card,
      autonomyAction: 'deploy' as AutonomyAction,
    }));
  const promotionPlan = buildDeployClusterPlan(promotionCandidates, macroOverlay, grossBudgetPct);
  const promotionClusterPriority = promotionPlan.clusters.map((cluster) => cluster.id);
  const promotionRowsByCluster = new Map<string, DeployClusterCardRow[]>();
  for (const row of promotionPlan.rows.sort((left, right) => right.score - left.score || right.card.confirmationScore - left.card.confirmationScore)) {
    const bucket = promotionRowsByCluster.get(row.clusterId) || [];
    bucket.push(row);
    promotionRowsByCluster.set(row.clusterId, bucket);
  }
  const promotedDeployIds = new Set<string>();
  const promotedPerCluster = new Map<string, number>();
  let promotionCursor = 0;
  while (promotedDeployIds.size < targetDeployCount) {
    let progressed = false;
    for (const clusterId of promotionClusterPriority) {
      if (promotedDeployIds.size >= targetDeployCount) break;
      const clusterRows = promotionRowsByCluster.get(clusterId) || [];
      const limit = promotionPlan.clusters.find((cluster) => cluster.id === clusterId)?.topK ?? 1;
      const alreadyPromoted = promotedPerCluster.get(clusterId) ?? 0;
      if (alreadyPromoted >= limit) continue;
      const nextRow = clusterRows[alreadyPromoted];
      if (!nextRow) continue;
      promotedDeployIds.add(nextRow.card.id);
      promotedPerCluster.set(clusterId, alreadyPromoted + 1);
      progressed = true;
    }
    promotionCursor += 1;
    if (!progressed || promotionCursor > targetDeployCount + promotionClusterPriority.length + 3) break;
  }
  if (!promotedDeployIds.size) {
    readinessRows
      .slice()
      .sort((left, right) => right.score - left.score)
      .slice(0, targetDeployCount)
      .forEach((row) => promotedDeployIds.add(row.card.id));
  }

  return {
    grossBudgetPct,
    promotedDeployIds,
    deployRate,
    candidateBreadth,
    confirmationMedian,
    confirmationSpread,
    readinessMedian,
    readinessSpread,
  };
}

function deployFloorPctForCard(
  card: InvestmentIdeaCard,
  macroOverlay: MacroRiskOverlay,
  grossBudgetPct = 0,
  deployCount = 1,
): number {
  if (macroOverlay.killSwitch || card.confirmationState === 'contradicted') return 0;
  const budgetAwareFloor = grossBudgetPct > 0
    ? (grossBudgetPct / Math.max(1, deployCount)) * (macroOverlay.state === 'risk-on' ? 0.34 : macroOverlay.state === 'balanced' ? 0.28 : 0.22)
    : 0;
  const baseFloor = Math.max(
    budgetAwareFloor,
    macroOverlay.state === 'risk-on'
      ? 1.2
      : macroOverlay.state === 'balanced'
        ? 0.8
        : 0.4,
  );
  const confirmationBoost = clamp((card.confirmationScore - 55) / 35, 0, 1);
  const realityBoost = clamp((card.realityScore - 60) / 30, 0, 1);
  const sizeBoost = clamp(card.sizeMultiplier, 0, 1.5);
  const floor = baseFloor * (0.7 + confirmationBoost * 0.7 + realityBoost * 0.25 + sizeBoost * 0.08);
  const cap = macroOverlay.state === 'risk-on' ? 2.5 : macroOverlay.state === 'balanced' ? 1.8 : 1.1;
  return clamp(Number(floor.toFixed(2)), 0, cap);
}

function zipfRankShares(count: number, alpha: number): number[] {
  if (!(count > 0)) return [];
  const weights = Array.from({ length: count }, (_, index) => 1 / Math.pow(index + 1, alpha));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return total > 0 ? weights.map((value) => value / total) : weights.map(() => 1 / count);
}

function buildConcentratedAllocationShares(
  scores: number[],
  macroOverlay: MacroRiskOverlay,
): number[] {
  if (!scores.length) return [];
  const scoreMedian = median(scores);
  const scoreSpread = Math.max(4, percentile(scores, 0.75) - percentile(scores, 0.25));
  const normalized = scores.map((score) => (score - scoreMedian) / scoreSpread);
  const temperature = clamp(
    (macroOverlay.state === 'risk-off' ? 0.08 : macroOverlay.state === 'balanced' ? 0.13 : 0.2)
    - Math.min(0.12, scoreSpread / 135),
    0.08,
    0.24,
  );
  const alpha = macroOverlay.state === 'risk-off'
    ? 2.25
    : macroOverlay.state === 'balanced'
      ? 1.8
      : 1.42;
  const softmaxShares = temperatureSoftmax(normalized, temperature);
  const rankShares = zipfRankShares(scores.length, alpha);
  const combined = softmaxShares.map((value, index) => Math.pow(value, 0.92) * Math.pow(rankShares[index] || 0, 0.2));
  const normalizedCombined = normalizeWeights(combined);
  const tailFloor = clamp(
    1 / Math.max(4, scores.length * (macroOverlay.state === 'risk-off' ? 1.8 : macroOverlay.state === 'balanced' ? 2.2 : 2.8)),
    0.04,
    0.12,
  );
  return normalizeWeights(
    normalizedCombined.map((share, index) => (index < 2 || share >= tailFloor ? share : 0)),
  );
}

interface DeployClusterCardRow {
  card: InvestmentIdeaCard;
  score: number;
  floor: number;
  family: string;
  label: string;
  clusterId: string;
  clusterLabel: string;
  defensiveScore: number;
  stressLeadSupport: number;
  onlineBoost: number;
  currentReturnPct: number;
  replayReturnPct: number;
  currentHitRate: number;
  drift: number;
  averageAbsVol: number;
  coreShare: number;
  coreCount: number;
  orbitalCount: number;
  representativeSymbols: string[];
}

interface DeployClusterRow {
  id: string;
  label: string;
  family: string;
  share: number;
  cap: number;
  topK: number;
  score: number;
  riskScore: number;
  defensiveScore: number;
  coreShare: number;
  orbitalCount: number;
  currentReturnPct: number;
  replayReturnPct: number;
  icDrift: number;
  multiplier: number;
  regretPenalty: number;
  gateState: 'open' | 'shrunk' | 'gated';
  memberIds: string[];
}

interface DeployClusterPlan {
  rows: DeployClusterCardRow[];
  clusters: DeployClusterRow[];
  clusterByCardId: Map<string, string>;
  clusterCaps: Record<string, number>;
}

function intersectionCount(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  return left.reduce((count, item) => count + (rightSet.has(item) ? 1 : 0), 0);
}

function normalizeSectorFamily(sector: string, assetKind?: InvestmentAssetKind | null): string {
  const normalizedSector = normalizeMatchable(sector || '');
  if (!normalizedSector) {
    if (assetKind === 'rate' || assetKind === 'fx') return 'defensive-macro';
    if (assetKind === 'commodity') return 'commodities';
    if (assetKind === 'crypto') return 'crypto';
    return assetKind || 'general';
  }
  if (/(gold|treasury|rates|volatility|fx|dollar|utilities)/.test(normalizedSector)) return 'defensive-macro';
  if (/(semiconductor|cybersecurity|network infrastructure|software|technology|compute)/.test(normalizedSector)) return 'technology';
  if (/(defense|surveillance|aerospace|drone|munitions)/.test(normalizedSector)) return 'defense';
  if (/(energy|shipping|airlines|transport|oil|gas)/.test(normalizedSector)) return 'energy-transport';
  if (/(fertilizer|agriculture|potash|phosphates|grain)/.test(normalizedSector)) return 'agri-inputs';
  if (/(rates|bond)/.test(normalizedSector)) return 'rates';
  return normalizedSector.replace(/\s+/g, '-');
}

function cardPrimarySymbols(card: InvestmentIdeaCard): string[] {
  const ranked = card.symbols
    .filter((symbol) => symbol.role !== 'hedge')
    .map((symbol) => String(symbol.symbol || '').trim())
    .filter(Boolean);
  const fallback = card.symbols
    .map((symbol) => String(symbol.symbol || '').trim())
    .filter(Boolean);
  return Array.from(new Set((ranked.length ? ranked : fallback).slice(0, 3)));
}

function buildCardCompositeReturnSeries(card: InvestmentIdeaCard, maxPoints = 48): number[] {
  const symbols = cardPrimarySymbols(card);
  if (!symbols.length) return [];
  const series = symbols
    .map((symbol) => buildRecentReturnSeries(symbol, maxPoints))
    .filter((row) => row.length > 0);
  if (!series.length) return [];
  const sampleSize = Math.min(...series.map((row) => row.length));
  if (!Number.isFinite(sampleSize) || sampleSize <= 0) return [];
  const trimmed = series.map((row) => row.slice(-sampleSize));
  return Array.from({ length: sampleSize }, (_, index) =>
    Number(average(trimmed.map((row) => row[index] ?? 0)).toFixed(6)),
  );
}

function estimateAverageAbsoluteVolatility(series: number[]): number {
  if (!series.length) return 0;
  return average(series.map((value) => Math.abs(value)));
}

function estimateDefensiveScore(card: InvestmentIdeaCard): number {
  const families = Array.from(new Set([
    ...card.symbols.map((symbol) => normalizeSectorFamily(symbol.sector || '', symbol.assetKind || null)),
    ...card.sectorExposure.map((sector) => normalizeSectorFamily(sector || '')),
  ].filter(Boolean)));
  const defensiveFamilyShare = families.filter((family) => family === 'defensive-macro').length / Math.max(1, families.length);
  const hedgeRoleShare = card.symbols.filter((symbol) => symbol.role === 'hedge' || symbol.direction === 'hedge').length / Math.max(1, card.symbols.length);
  const defensiveDirection = card.direction === 'hedge' ? 1 : card.direction === 'watch' ? 0.55 : 0;
  return clamp(
    Number((defensiveFamilyShare * 0.5 + hedgeRoleShare * 0.3 + defensiveDirection * 0.2).toFixed(4)),
    0,
    1,
  );
}

function buildStressProxySeries(macroOverlay: MacroRiskOverlay, maxPoints = 48): number[] {
  const proxySymbols = Array.from(new Set([
    '^VIX',
    ...macroOverlay.hedgeBias.map((item) => item.symbol),
  ].filter(Boolean)));
  const series = proxySymbols
    .map((symbol) => buildRecentReturnSeries(symbol, maxPoints))
    .filter((row) => row.length >= 8);
  if (!series.length) return [];
  const sampleSize = Math.min(...series.map((row) => row.length));
  if (!Number.isFinite(sampleSize) || sampleSize < 8) return [];
  const trimmed = series.map((row) => row.slice(-sampleSize));
  return Array.from({ length: sampleSize }, (_, index) =>
    Number(average(trimmed.map((row) => row[index] ?? 0)).toFixed(6)),
  );
}

function estimateStressLeadSupport(
  card: InvestmentIdeaCard,
  macroOverlay: MacroRiskOverlay,
): number {
  const stressSeries = buildStressProxySeries(macroOverlay);
  const targetSeries = buildCardCompositeReturnSeries(card);
  const sampleSize = Math.min(stressSeries.length, targetSeries.length);
  if (!Number.isFinite(sampleSize) || sampleSize < 8) return 0;
  const te = estimateTransferEntropy(
    stressSeries.slice(-sampleSize),
    targetSeries.slice(-sampleSize),
  );
  return te.normalized;
}

interface ThemeStabilityAdjustment {
  scoreDelta: number;
  exposureMultiplier: number;
  stabilityScore: number;
  lcbUtility: number;
  regimeDispersion: number;
  negativeRegimeShare: number;
  sampleReliability: number;
  instabilityPenalty: number;
}

function computeThemeStabilityAdjustment(themeId: string): ThemeStabilityAdjustment {
  const replayAdaptation = getReplayAdaptationSnapshotSync();
  const replayProfile = getReplayThemeProfileFromSnapshot(replayAdaptation, themeId);
  const currentPerformance = getCurrentThemePerformanceFromSnapshot(replayAdaptation, themeId);
  if (!replayProfile) {
    return {
      scoreDelta: 0,
      exposureMultiplier: 1,
      stabilityScore: 50,
      lcbUtility: 0,
      regimeDispersion: 0,
      negativeRegimeShare: 0,
      sampleReliability: 0,
      instabilityPenalty: 0,
    };
  }

  const regimeMetrics = replayProfile.regimeMetrics || [];
  const regimeReturns = regimeMetrics.map((metric) => Number(metric.costAdjustedAvgReturnPct) || 0);
  const regimeWeights = regimeMetrics.map((metric) => Math.max(1, Number(metric.sampleSize) || 0));
  const weightedSamples = Math.max(
    0,
    Number(replayProfile.weightedSampleSize) || regimeWeights.reduce((sum, value) => sum + value, 0),
  );
  const sampleReliability = 1 - Math.exp(-weightedSamples / 22);
  const negativeDrift = clamp(Math.abs(Math.min(0, Number(replayProfile.currentVsReplayDrift) || 0)) / 2.4, 0, 2.4);
  const replayUtility = Number(replayProfile.coverageAdjustedUtility ?? replayProfile.utilityScore ?? 0) || 0;
  const robustUtility = Number(
    replayProfile.robustUtility
    ?? replayUtility
    ?? 0,
  ) || replayUtility;
  const windowDispersion = Math.max(0, Number(replayProfile.windowUtilityStd) || 0);
  const windowFlipRate = clamp(Number(replayProfile.windowFlipRate) || 0, 0, 1);
  const currentHitRate = Number(currentPerformance?.hitRate ?? replayProfile.hitRate ?? 50) || 50;
  const hitPenalty = clamp((50 - currentHitRate) / 18, 0, 1.6);
  const meanRegimeReturn = regimeReturns.length ? weightedAverage(regimeReturns, regimeWeights) : 0;
  const regimeDispersion = regimeReturns.length >= 2 ? weightedStdDev(regimeReturns, regimeWeights) : 0;
  const negativeRegimeShare = regimeReturns.length
    ? weightedAverage(
      regimeReturns.map((value) => (value < 0 ? 1 : 0)),
      regimeWeights,
    )
    : (meanRegimeReturn < 0 ? 1 : 0);
  const downsideMagnitude = regimeReturns.length
    ? weightedAverage(
      regimeReturns.map((value) => Math.max(0, -value)),
      regimeWeights,
    )
    : Math.max(0, -(Number(replayProfile.coverageAdjustedUtility) || 0));
  const signAgreement = regimeReturns.length
    ? Math.abs(weightedAverage(regimeReturns.map((value) => Math.sign(value)), regimeWeights))
    : 1;
  const shrunkenUtility = replayUtility * (0.35 + sampleReliability * 0.65);
  const robustGapPenalty = Math.max(0, replayUtility * 0.18 - robustUtility);
  const lcbUtility = Number((
    shrunkenUtility
    - robustGapPenalty * 0.75
    - regimeDispersion * (0.72 + negativeRegimeShare * 0.44)
    - windowDispersion * 0.08
    - downsideMagnitude * 0.26
    - negativeDrift * 1.45
    - windowFlipRate * 0.95
    - (1 - signAgreement) * 1.35
    - hitPenalty * 0.62
  ).toFixed(3));
  const stabilityScore = clamp(
    Number((
      45
      + sampleReliability * 22
      + signAgreement * 18
      + Math.max(0, lcbUtility) * 3.5
      + Math.max(0, meanRegimeReturn) * 1.6
      - regimeDispersion * 11
      - windowDispersion * 0.3
      - windowFlipRate * 7
      - negativeRegimeShare * 22
      - downsideMagnitude * 1.2
      - negativeDrift * 9
    ).toFixed(2)),
    0,
    100,
  );
  const exposureMultiplier = clamp(
    Number((
      0.34
      + sampleReliability * 0.36
      + signAgreement * 0.22
      + clamp(lcbUtility / 7, -0.26, 0.28)
      - Math.min(0.08, windowDispersion * 0.004)
      - windowFlipRate * 0.03
      - negativeRegimeShare * 0.18
      - negativeDrift * 0.09
    ).toFixed(4)),
    0.12,
    1.18,
  );
  const instabilityPenalty = Number(clamp(
    regimeDispersion * 0.55
    + windowDispersion * 0.04
    + windowFlipRate * 0.7
    + negativeRegimeShare * 2.8
    + downsideMagnitude * 0.24
    + negativeDrift * 0.65
    + (1 - sampleReliability) * 0.9,
    0,
    8,
  ).toFixed(3));
  const scoreDelta = Number((lcbUtility * 2.1 + (stabilityScore - 50) * 0.16).toFixed(3));
  return {
    scoreDelta,
    exposureMultiplier,
    stabilityScore,
    lcbUtility,
    regimeDispersion: Number(regimeDispersion.toFixed(4)),
    negativeRegimeShare: Number(negativeRegimeShare.toFixed(4)),
    sampleReliability: Number(sampleReliability.toFixed(4)),
    instabilityPenalty,
  };
}

function computeOnlineRankingAdjustment(
  card: InvestmentIdeaCard,
  macroOverlay: MacroRiskOverlay,
): {
  scoreDelta: number;
  survivalBoost: number;
  stressLeadSupport: number;
  defensiveScore: number;
  currentReturnPct: number;
  replayReturnPct: number;
  currentHitRate: number;
  drift: number;
  stabilityScore: number;
  stabilityMultiplier: number;
  lcbUtility: number;
  instabilityPenalty: number;
} {
  const replayAdaptation = getReplayAdaptationSnapshotSync();
  const replayProfile = getReplayThemeProfileFromSnapshot(replayAdaptation, card.themeId);
  const currentPerformance = getCurrentThemePerformanceFromSnapshot(replayAdaptation, card.themeId);
  const stability = computeThemeStabilityAdjustment(card.themeId);
  const defensiveScore = estimateDefensiveScore(card);
  const stressLevel = macroOverlay.killSwitch
    ? 1
    : macroOverlay.state === 'risk-off'
      ? 0.84
      : macroOverlay.state === 'balanced'
        ? 0.42
        : 0.12;
  const stressLeadSupport = estimateStressLeadSupport(card, macroOverlay);
  const currentReturnPct = Number(currentPerformance?.avgReturnPct ?? card.liveReturnPct ?? card.backtestAvgReturnPct ?? 0) || 0;
  const currentHitRate = Number(currentPerformance?.hitRate ?? card.backtestHitRate ?? 50) || 50;
  const replayReturnPct = Number(replayProfile?.coverageAdjustedUtility ?? replayProfile?.costAdjustedAvgReturnPct ?? card.backtestAvgReturnPct ?? 0) || 0;
  const drift = Number(replayProfile?.currentVsReplayDrift ?? (currentReturnPct - replayReturnPct)) || 0;
  const replayReliability = clamp((replayProfile?.confirmationReliability ?? card.confirmationScore ?? 50) / 100, 0, 1);
  const positiveCurrent = clamp(currentReturnPct / 3.5, 0, 1.8);
  const negativeCurrent = clamp(Math.abs(Math.min(0, currentReturnPct)) / 3.5, 0, 1.8);
  const hitBonus = clamp((currentHitRate - 50) / 18, 0, 1.4);
  const hitPenalty = clamp((50 - currentHitRate) / 16, 0, 1.6);
  const driftPenalty = clamp(Math.abs(Math.min(0, drift)) / 1.3, 0, 2.6);
  const driftBonus = clamp(Math.max(0, drift) / 2.5, 0, 1.2);
  const survivalBoost = defensiveScore * stressLevel * (
    8
    + stressLeadSupport * 14
    + hitBonus * 5
    + replayReliability * 6
    + driftBonus * 3
    + Math.max(0, stability.exposureMultiplier - 0.7) * 11
  );
  const offensivePenalty = (1 - defensiveScore) * stressLevel * (
    negativeCurrent * 9
    + hitPenalty * 7
    + driftPenalty * 6
    + stressLeadSupport * 4
    + stability.instabilityPenalty * 1.6
  );
  const baselineReward =
    positiveCurrent * 4.5
    + hitBonus * 2.2
    + replayReliability * 2
    + Math.max(0, stability.lcbUtility) * 0.85
    + Math.max(0, stability.stabilityScore - 55) * 0.06;
  const scoreDelta = Number((survivalBoost + baselineReward - offensivePenalty + stability.scoreDelta).toFixed(3));
  return {
    scoreDelta,
    survivalBoost: Number(survivalBoost.toFixed(3)),
    stressLeadSupport: Number(stressLeadSupport.toFixed(4)),
    defensiveScore: Number(defensiveScore.toFixed(4)),
    currentReturnPct: Number(currentReturnPct.toFixed(2)),
    replayReturnPct: Number(replayReturnPct.toFixed(2)),
    currentHitRate: Number(currentHitRate.toFixed(2)),
    drift: Number(drift.toFixed(2)),
    stabilityScore: Number(stability.stabilityScore.toFixed(2)),
    stabilityMultiplier: Number(stability.exposureMultiplier.toFixed(4)),
    lcbUtility: Number(stability.lcbUtility.toFixed(3)),
    instabilityPenalty: Number(stability.instabilityPenalty.toFixed(3)),
  };
}

function estimateClusterRankingCorrelation(
  signal: number[],
  outcome: number[],
): number {
  const sampleSize = Math.min(signal.length, outcome.length);
  if (!Number.isFinite(sampleSize) || sampleSize < 3) return 0;
  const trimmedSignal = signal.slice(-sampleSize);
  const trimmedOutcome = outcome.slice(-sampleSize);
  const signalSpread = Math.max(...trimmedSignal) - Math.min(...trimmedSignal);
  const outcomeSpread = Math.max(...trimmedOutcome) - Math.min(...trimmedOutcome);
  if (!(signalSpread > 1e-6) || !(outcomeSpread > 1e-6)) return 0;
  const corr = pearsonCorrelation(trimmedSignal, trimmedOutcome);
  return Number.isFinite(corr) ? corr : 0;
}

function buildDeployClusterPlan(
  cards: InvestmentIdeaCard[],
  macroOverlay: MacroRiskOverlay,
  grossBudgetPct: number,
): DeployClusterPlan {
  const deployCards = cards.filter((card) => card.autonomyAction === 'deploy' && card.executionGate && card.confirmationState !== 'contradicted');
  if (!deployCards.length) {
    return {
      rows: [],
      clusters: [],
      clusterByCardId: new Map(),
      clusterCaps: {},
    };
  }

  const stressLevel = macroOverlay.killSwitch
    ? 1
    : macroOverlay.state === 'risk-off'
      ? 0.84
      : macroOverlay.state === 'balanced'
        ? 0.42
        : 0.12;
  const rowMeta = deployCards.map((card) => {
    const instrumentMix = summarizeInstrumentMix(card.symbols);
    const primarySymbols = cardPrimarySymbols(card);
    const representativeSymbols = primarySymbols.length
      ? primarySymbols
      : card.symbols.map((symbol) => symbol.symbol).slice(0, 2);
    const family = normalizeSectorFamily(
      card.symbols.find((symbol) => symbol.role !== 'hedge')?.sector
      || card.sectorExposure[0]
      || card.themeId,
      card.symbols.find((symbol) => symbol.role !== 'hedge')?.assetKind || null,
    );
    const label = family.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    const baseFloor = deployFloorPctForCard(card, macroOverlay, grossBudgetPct, deployCards.length);
    const online = computeOnlineRankingAdjustment(card, macroOverlay);
    const score = clamp(
      card.confirmationScore * 0.26
      + card.calibratedConfidence * 0.1
      + card.realityScore * 0.08
      + card.graphSignalScore * 0.08
      + (100 - card.coveragePenalty) * 0.08
      + capitalReadinessScore(card) * 0.24
      + card.sizeMultiplier * 8
      + instrumentMix.coreShare * (stressLevel >= 0.55 ? 10 : 6)
      - instrumentMix.orbitalCount * stressLevel * 2.8
      + (online.stabilityMultiplier - 0.7) * 14
      + Math.max(0, online.lcbUtility) * 0.85
      - online.instabilityPenalty * 1.15
      + online.scoreDelta,
      1,
      100,
    );
    const series = buildCardCompositeReturnSeries(card);
    return {
      card,
      score,
      floor: baseFloor,
      family,
      label,
      representativeSymbols,
      series,
      averageAbsVol: estimateAverageAbsoluteVolatility(series),
      coreShare: instrumentMix.coreShare,
      orbitalCount: instrumentMix.orbitalCount,
      coreCount: instrumentMix.coreCount,
      defensiveScore: online.defensiveScore,
      onlineBoost: online.survivalBoost,
      stressLeadSupport: online.stressLeadSupport,
      currentReturnPct: online.currentReturnPct,
      replayReturnPct: online.replayReturnPct,
      currentHitRate: online.currentHitRate,
      drift: online.drift,
    };
  });

  const parents = rowMeta.map((_, index) => index);
  const findParent = (index: number): number => {
    let cursor = index;
    while (parents[cursor] !== cursor) {
      parents[cursor] = parents[parents[cursor]!]!;
      cursor = parents[cursor]!;
    }
    return cursor;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = findParent(left);
    const rightRoot = findParent(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let leftIndex = 0; leftIndex < rowMeta.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rowMeta.length; rightIndex += 1) {
      const left = rowMeta[leftIndex]!;
      const right = rowMeta[rightIndex]!;
      const sharedSample = Math.min(left.series.length, right.series.length);
      const corrAbs = sharedSample >= 8
        ? Math.abs(pearsonCorrelation(left.series.slice(-sharedSample), right.series.slice(-sharedSample)))
        : 0;
      const sameFamily = left.family === right.family ? 1 : 0;
      const sameTheme = left.card.themeId === right.card.themeId ? 1 : 0;
      const overlap = intersectionCount(left.representativeSymbols, right.representativeSymbols) > 0 ? 1 : 0;
      const sharedDefense = left.defensiveScore >= 0.55 && right.defensiveScore >= 0.55 ? 1 : 0;
      const similarity = corrAbs * 0.66 + sameFamily * 0.18 + sameTheme * 0.1 + overlap * 0.08 + sharedDefense * 0.06;
      const threshold = macroOverlay.state === 'risk-off'
        ? 0.52
        : macroOverlay.state === 'balanced'
          ? 0.56
          : 0.6;
      if (similarity >= threshold) union(leftIndex, rightIndex);
    }
  }

  const buckets = new Map<number, typeof rowMeta>();
  rowMeta.forEach((row, index) => {
    const root = findParent(index);
    const bucket = buckets.get(root) || [];
    bucket.push(row);
    buckets.set(root, bucket);
  });

  const grossBudget = grossBudgetPct / 100;
  const clusterByCardId = new Map<string, string>();
  const clusterRows = Array.from(buckets.values()).map((bucket, index) => {
    const sorted = bucket.slice().sort((left, right) => right.score - left.score || right.card.confirmationScore - left.card.confirmationScore);
    const family = sorted[0]?.family || `cluster-${index + 1}`;
    const clusterId = `${family}-${index + 1}`;
    const clusterLabel = `${sorted[0]?.label || 'General'} Cluster`;
    const pairwiseCorrs: number[] = [];
    for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
        const left = sorted[leftIndex]!;
        const right = sorted[rightIndex]!;
        const sampleSize = Math.min(left.series.length, right.series.length);
        if (sampleSize >= 8) {
          pairwiseCorrs.push(Math.abs(pearsonCorrelation(left.series.slice(-sampleSize), right.series.slice(-sampleSize))));
        }
      }
    }
    const defensiveScore = average(sorted.map((row) => row.defensiveScore));
    const clusterScore = Number((
      (sorted[0]?.score || 0) * 0.54
      + average(sorted.map((row) => row.score)) * 0.22
      + average(sorted.map((row) => Math.max(0, row.onlineBoost))) * 0.16
      + average(sorted.map((row) => row.coreShare)) * stressLevel * 10
      + defensiveScore * stressLevel * 9
    ).toFixed(3));
    const clusterRisk = clamp(
      0.55
      + average(sorted.map((row) => row.averageAbsVol)) * 14
      + average(pairwiseCorrs) * 1.05
      + average(sorted.map((row) => Number(row.card.portfolioCrowdingPenalty) || 0)) * 1.8
      + average(sorted.map((row) => row.orbitalCount)) * stressLevel * 0.28
      - defensiveScore * stressLevel * 0.18,
      0.18,
      4.4,
    );
    const rawShare = Math.max(0.08, clusterScore / Math.max(18, clusterRisk * 28));
    sorted.forEach((row) => {
      clusterByCardId.set(row.card.id, clusterId);
    });
    return {
      id: clusterId,
      label: clusterLabel,
      family,
      score: clusterScore,
      riskScore: Number(clusterRisk.toFixed(4)),
      defensiveScore: Number(defensiveScore.toFixed(4)),
      coreShare: Number(average(sorted.map((row) => row.coreShare)).toFixed(4)),
      orbitalCount: average(sorted.map((row) => row.orbitalCount)),
      memberIds: sorted.map((row) => row.card.id),
      rows: sorted,
      rawShare,
    };
  }).sort((left, right) => right.score - left.score || left.riskScore - right.riskScore);

  const defensiveBenchmarkReturn = clusterRows
    .filter((cluster) => cluster.defensiveScore >= 0.55)
    .slice()
    .sort((left, right) =>
      average(right.rows.map((row) => row.currentReturnPct)) - average(left.rows.map((row) => row.currentReturnPct))
      || right.score - left.score
    )[0];
  const stressBenchmarkReturn = stressLevel >= 0.55
    ? Math.max(0.45, average(defensiveBenchmarkReturn?.rows.map((row) => row.currentReturnPct) || [0]))
    : Math.max(0, average(defensiveBenchmarkReturn?.rows.map((row) => row.currentReturnPct) || [0]));

  const calibratedClusterRows = clusterRows.map((cluster) => {
    const currentReturnPct = average(cluster.rows.map((row) => row.currentReturnPct));
    const replayReturnPct = average(cluster.rows.map((row) => row.replayReturnPct));
    const avgDrift = average(cluster.rows.map((row) => row.drift));
    const avgVol = average(cluster.rows.map((row) => row.averageAbsVol));
    const avgStressLead = average(cluster.rows.map((row) => row.stressLeadSupport));
    const currentIC = estimateClusterRankingCorrelation(
      cluster.rows.map((row) => row.score),
      cluster.rows.map((row) => row.currentReturnPct),
    );
    const replayIC = estimateClusterRankingCorrelation(
      cluster.rows.map((row) => row.score),
      cluster.rows.map((row) => row.replayReturnPct),
    );
    const icDrift = Number((currentIC - replayIC).toFixed(4));
    const driftLoss = clamp(Math.abs(Math.min(0, avgDrift)) / 1.1, 0, 3.2);
    const replayGapLoss = clamp((replayReturnPct - currentReturnPct) / Math.max(0.8, Math.abs(replayReturnPct) + 0.7), 0, 3.2);
    const volatilityLoss = clamp(avgVol * 18, 0, 1.8);
    const icPenalty = clamp(Math.abs(Math.min(0, icDrift)) / 0.22, 0, 3.4);
    const regretPenalty = cluster.defensiveScore >= 0.55
      ? 0
      : clamp(
        Math.max(0, stressBenchmarkReturn - currentReturnPct)
        + Math.max(0, 0.18 - currentReturnPct) * (stressLevel >= 0.55 ? 0.75 : 0.35),
        0,
        6,
      );
    const mwuLoss = replayGapLoss * 1.05 + driftLoss * 0.78 + volatilityLoss * 0.42 + icPenalty * 0.95;
    const multiplicativeWeight = clamp(
      Math.exp(-(stressLevel >= 0.55 ? 0.76 : 0.62) * mwuLoss),
      cluster.defensiveScore >= 0.55 ? 0.08 : 0.03,
      1.45,
    );
    const icMultiplier = clamp(1 - Math.abs(Math.min(0, icDrift)) * 0.95, 0.08, 1.08);
    const regretMultiplier = cluster.defensiveScore >= 0.55
      ? 1
      : clamp(1 - regretPenalty * (stressLevel >= 0.55 ? 0.38 : 0.24), 0.03, 1);
    const survivalMultiplier = cluster.defensiveScore >= 0.55
      ? clamp(1 + stressLevel * 0.65 + avgStressLead * 0.55 + Math.max(0, currentReturnPct) / 7, 1, 2.05)
      : 1;
    const coreMultiplier = clamp(
      0.78 + cluster.coreShare * (stressLevel >= 0.55 ? 0.7 : 0.38),
      cluster.defensiveScore >= 0.55 ? 0.92 : 0.42,
      1.55,
    );
    const multiplier = Number((multiplicativeWeight * icMultiplier * regretMultiplier * survivalMultiplier).toFixed(4));
    const gateState: 'open' | 'shrunk' | 'gated' =
      cluster.defensiveScore < 0.45 && (
        regretPenalty >= (stressLevel >= 0.55 ? 0.85 : 1.2)
        || icDrift <= (stressLevel >= 0.55 ? -0.18 : -0.28)
        || avgDrift <= (stressLevel >= 0.55 ? -0.45 : -0.75)
      )
        ? 'gated'
        : (
          cluster.defensiveScore < 0.55 && (
            regretPenalty >= (stressLevel >= 0.55 ? 0.45 : 0.65)
            || icDrift <= (stressLevel >= 0.55 ? -0.08 : -0.12)
            || avgDrift <= (stressLevel >= 0.55 ? -0.2 : -0.35)
          )
            ? 'shrunk'
            : 'open'
        );
    return {
      ...cluster,
      rawShare: cluster.rawShare * multiplier * coreMultiplier,
      currentReturnPct: Number(currentReturnPct.toFixed(2)),
      replayReturnPct: Number(replayReturnPct.toFixed(2)),
      icDrift: Number(icDrift.toFixed(4)),
      multiplier: Number((multiplier * coreMultiplier).toFixed(4)),
      regretPenalty: Number(regretPenalty.toFixed(3)),
      gateState,
    };
  }).sort((left, right) => right.rawShare - left.rawShare || right.score - left.score);

  const bestDefensiveCluster = calibratedClusterRows
    .filter((cluster) => cluster.defensiveScore >= 0.55)
    .slice()
    .sort((left, right) => right.multiplier - left.multiplier || right.currentReturnPct - left.currentReturnPct)[0];
  if (bestDefensiveCluster && stressLevel >= 0.55) {
    bestDefensiveCluster.rawShare = Math.max(
      bestDefensiveCluster.rawShare,
      average(calibratedClusterRows.map((cluster) => cluster.rawShare)) * 0.95,
    );
  }

  const normalizedShares = normalizeWeights(calibratedClusterRows.map((cluster) => cluster.rawShare));
  const clusters: DeployClusterRow[] = calibratedClusterRows.map((cluster, index) => {
    const share = normalizedShares[index] || 0;
    const clusterBudgetPct = grossBudgetPct * share;
    const medianFloor = Math.max(0.35, median(cluster.rows.map((row) => row.floor).filter((value) => value > 0)));
    const baseTopK = clamp(
      Math.round(
        Math.max(
          1,
          clusterBudgetPct / Math.max(3.2, medianFloor * (macroOverlay.state === 'risk-off' ? 2.6 : macroOverlay.state === 'balanced' ? 2.25 : 1.95)),
        ),
      ),
      1,
      macroOverlay.state === 'risk-off' ? 2 : macroOverlay.state === 'balanced' ? 3 : 4,
    );
    const topK = cluster.gateState === 'gated'
      ? 1
      : cluster.gateState === 'shrunk'
        ? Math.max(1, baseTopK - (stressLevel >= 0.55 ? 2 : 1))
        : baseTopK;
    const baseCap = grossBudget * share * (cluster.defensiveScore >= 0.55 && stressLevel >= 0.55 ? 1.45 : 2.05);
    const coreCapBias = cluster.coreShare >= 0.5
      ? clamp(1 + cluster.coreShare * (stressLevel >= 0.55 ? 0.26 : 0.14), 1, 1.28)
      : clamp(0.82 + cluster.coreShare * 0.2, 0.78, 1);
    const capMultiplier = cluster.gateState === 'gated'
      ? (stressLevel >= 0.55 ? 0.12 : 0.22)
      : cluster.gateState === 'shrunk'
        ? (stressLevel >= 0.55 ? 0.35 : 0.58)
        : 1;
    const cap = clamp(
      baseCap * capMultiplier * coreCapBias,
      cluster.gateState === 'gated'
        ? 0.02
        : macroOverlay.state === 'risk-off' ? 0.05 : 0.06,
      cluster.gateState === 'gated'
        ? 0.03
        : macroOverlay.state === 'risk-off' ? 0.24 : macroOverlay.state === 'balanced' ? 0.28 : 0.34,
    );
    return {
      id: cluster.id,
      label: cluster.label,
      family: cluster.family,
      share: Number(share.toFixed(4)),
      cap: Number(cap.toFixed(4)),
      topK,
      score: Number(cluster.score.toFixed(3)),
      riskScore: cluster.riskScore,
      defensiveScore: cluster.defensiveScore,
      coreShare: Number(cluster.coreShare.toFixed(4)),
      orbitalCount: Number(cluster.orbitalCount.toFixed(2)),
      currentReturnPct: cluster.currentReturnPct,
      replayReturnPct: cluster.replayReturnPct,
      icDrift: cluster.icDrift,
      multiplier: cluster.multiplier,
      regretPenalty: cluster.regretPenalty,
      gateState: cluster.gateState,
      memberIds: cluster.memberIds,
    };
  });

  return {
    rows: calibratedClusterRows.flatMap((cluster) => cluster.rows.map((row) => ({
      ...row,
      clusterId: cluster.id,
      clusterLabel: cluster.label,
    }))),
    clusters,
    clusterByCardId,
    clusterCaps: Object.fromEntries(clusters.map((cluster) => [cluster.id, cluster.cap])),
  };
}

function buildThemeExposureCaps(
  cards: InvestmentIdeaCard[],
  macroOverlay: MacroRiskOverlay,
  grossBudgetPct: number,
): Record<string, number> {
  const deployCards = cards.filter((card) => card.autonomyAction === 'deploy' && card.executionGate);
  const themeRows = Array.from(new Set(deployCards.map((card) => card.themeId))).map((themeId) => {
    const related = deployCards.filter((card) => card.themeId === themeId);
    const stability = computeThemeStabilityAdjustment(themeId);
    const ranked = related
      .slice()
      .sort((left, right) => capitalReadinessScore(right) - capitalReadinessScore(left) || right.confirmationScore - left.confirmationScore);
    const topScore = capitalReadinessScore(ranked[0]!);
    const runnerUpScore = ranked[1] ? capitalReadinessScore(ranked[1]) : topScore * 0.82;
    const rawThemeScore = topScore * 0.76
      + average(related.map((card) =>
        (Number(card.sizePct) || 0) * 2.6
        + card.confirmationScore * 0.18,
      )) * 0.24
      + Math.max(0, topScore - runnerUpScore) * 0.45;
    const themeScore = rawThemeScore * (0.48 + stability.exposureMultiplier * 0.72)
      + stability.scoreDelta * 0.55
      - stability.instabilityPenalty * 1.8
      + Math.max(0, stability.stabilityScore - 55) * 0.14;
    return { themeId, score: themeScore, stability };
  }).sort((left, right) => right.score - left.score);

  if (!themeRows.length) return {};

  const shares = buildConcentratedAllocationShares(
    themeRows.map((row) => row.score),
    macroOverlay,
  );
  const grossBudget = grossBudgetPct / 100;
  const minCap = macroOverlay.state === 'risk-off' ? 0.03 : macroOverlay.state === 'balanced' ? 0.04 : 0.05;
  const maxCap = macroOverlay.state === 'risk-off' ? 0.28 : macroOverlay.state === 'balanced' ? 0.28 : 0.32;
  return Object.fromEntries(themeRows.map((row, index) => {
    const share = shares[index] || 0;
    const stabilityCapMultiplier = clamp(
      0.42 + row.stability.exposureMultiplier * 0.72 + Math.max(0, row.stability.lcbUtility) * 0.02 - row.stability.instabilityPenalty * 0.04,
      0.22,
      1.22,
    );
    const cap = clamp(grossBudget * share * 2.15 * stabilityCapMultiplier, minCap, maxCap);
    return [row.themeId, Number(cap.toFixed(4))];
  }));
}

function inferDynamicMaxPositionWeight(
  cards: InvestmentIdeaCard[],
  macroOverlay: MacroRiskOverlay,
  grossBudgetPct: number,
): number {
  const deployCards = cards.filter((card) => card.autonomyAction === 'deploy' && card.executionGate);
  if (!deployCards.length) {
    return macroOverlay.killSwitch ? 0.04 : macroOverlay.state === 'risk-off' ? 0.1 : 0.18;
  }
  const scores = deployCards.map((card) => capitalReadinessScore(card));
  const averageScore = Math.max(1, average(scores));
  const topScore = Math.max(...scores);
  const grossBudget = grossBudgetPct / 100;
  const averageTicket = grossBudget / Math.max(1, deployCards.length);
  const concentrationBoost = clamp(1 + ((topScore / averageScore) - 1) * 1.7, 1, 3.1);
  const inferredCap = averageTicket * (1.95 + concentrationBoost * 1.35);
  return clamp(
    inferredCap,
    macroOverlay.killSwitch ? 0.04 : macroOverlay.state === 'risk-off' ? 0.12 : 0.14,
    macroOverlay.state === 'risk-off' ? 0.26 : macroOverlay.state === 'balanced' ? 0.28 : 0.34,
  );
}

function allocateDeployBudget(
  cards: InvestmentIdeaCard[],
  macroOverlay: MacroRiskOverlay,
  targetBudgetPct?: number,
): Map<string, number> {
  const allocations = new Map<string, number>();
  const deployCards = cards.filter((card) => card.autonomyAction === 'deploy' && card.executionGate && card.confirmationState !== 'contradicted');
  if (!deployCards.length) return allocations;

  const computedBudgetPct = Number.isFinite(targetBudgetPct)
    ? clamp(Number(targetBudgetPct), 0, Math.min(macroOverlay.grossExposureCapPct, macroOverlay.state === 'risk-on' ? 36 : macroOverlay.state === 'balanced' ? 24 : 12))
    : clamp(
      Number((macroOverlay.state === 'risk-on' ? 24 : macroOverlay.state === 'balanced' ? 16 : 8).toFixed(2)),
      0,
      Math.min(macroOverlay.grossExposureCapPct, macroOverlay.state === 'risk-on' ? 36 : macroOverlay.state === 'balanced' ? 24 : 12),
    );
  if (!(computedBudgetPct > 0)) {
    for (const card of deployCards) allocations.set(card.id, 0);
    return allocations;
  }

  const clusterPlan = buildDeployClusterPlan(cards, macroOverlay, computedBudgetPct);
  const stressProbability = estimateMacroStressProbability(macroOverlay);
  const allocateRows = (
    rows: Array<typeof clusterPlan.rows[number]>,
    budgetPct: number,
    scoreBoost = 1,
  ): void => {
    if (!rows.length || !(budgetPct > 0)) return;
    const shares = buildConcentratedAllocationShares(
      rows.map((row) => (row.score + row.onlineBoost * 0.35 + row.stressLeadSupport * 6) * scoreBoost),
      macroOverlay,
    );
    const rankedFloors = rows.map((row, index) => {
      const rankLift = clamp(
        Math.pow(Math.max(0.03, (shares[index] || 0) * rows.length), 0.9),
        row.defensiveScore >= 0.55 ? 0.22 : 0.16,
        macroOverlay.state === 'risk-on' ? 1.95 : macroOverlay.state === 'balanced' ? 1.68 : 1.4,
      );
      return Number((row.floor * rankLift).toFixed(2));
    });
    const floorTotal = rankedFloors.reduce((sum, value) => sum + value, 0);
    if (floorTotal >= budgetPct) {
      const scale = budgetPct / floorTotal;
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]!;
        allocations.set(row.card.id, Number((rankedFloors[index]! * scale).toFixed(2)));
      }
      return;
    }

    const remainingBudget = budgetPct - floorTotal;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const share = shares[index] || 0;
      allocations.set(row.card.id, Number((rankedFloors[index]! + remainingBudget * share).toFixed(2)));
    }
  };

  for (const cluster of clusterPlan.clusters) {
    const clusterRows = clusterPlan.rows
      .filter((row) => row.clusterId === cluster.id)
      .slice()
      .sort((left, right) => right.score - left.score || right.card.confirmationScore - left.card.confirmationScore);
    const selectedRows = clusterRows.slice(0, cluster.topK);
    if (!selectedRows.length) continue;
    const clusterBudgetPct = computedBudgetPct * cluster.share;
    const coreRows = selectedRows.filter((row) => row.coreCount > 0);
    const orbitalRows = selectedRows.filter((row) => row.coreCount === 0 && row.orbitalCount > 0);
    if (!coreRows.length || !orbitalRows.length) {
      allocateRows(selectedRows, clusterBudgetPct);
      continue;
    }

    const desiredCoreShare = clamp(
      average(coreRows.map((row) => row.coreShare)) * 0.55
      + (cluster.defensiveScore >= 0.55 ? 0.12 : 0)
      + (stressProbability >= 0.65 ? 0.26 : stressProbability >= 0.45 ? 0.18 : 0.08),
      macroOverlay.state === 'risk-off' ? 0.62 : 0.52,
      macroOverlay.state === 'risk-off' ? 0.92 : 0.82,
    );
    const coreBudgetPct = Number((clusterBudgetPct * desiredCoreShare).toFixed(2));
    const orbitalBudgetPct = Math.max(0, Number((clusterBudgetPct - coreBudgetPct).toFixed(2)));
    allocateRows(coreRows, coreBudgetPct, stressProbability >= 0.55 ? 1.08 : 1.03);
    allocateRows(orbitalRows, orbitalBudgetPct, stressProbability >= 0.55 ? 0.92 : 0.97);
  }

  for (const card of deployCards) {
    if (!allocations.has(card.id)) {
      allocations.set(card.id, 0);
    }
  }

  return allocations;
}

function applyPortfolioExecutionControls(
  cards: InvestmentIdeaCard[],
  macroOverlay: MacroRiskOverlay,
): InvestmentIdeaCard[] {
  if (!cards.length) return cards;
  const instrumentAwareCards: InvestmentIdeaCard[] = cards.map((card): InvestmentIdeaCard => {
    const plan = buildCoreOrbitalExecutionPlan(card, macroOverlay);
    if (!plan.reasons.length && plan.symbols.length === card.symbols.length) {
      return card;
    }
    return {
      ...card,
      symbols: plan.symbols,
      sizeMultiplier: Number(clamp(card.sizeMultiplier * (1 - plan.orbitalPenalty * 0.18), 0.18, 3).toFixed(2)),
      autonomyReasons: Array.from(new Set([
        ...card.autonomyReasons,
        ...plan.reasons,
        plan.benchmarkSymbol ? `ETF-first benchmark=${plan.benchmarkSymbol}.` : '',
      ].filter(Boolean))).slice(0, 6),
    };
  });
  const directionalCards = instrumentAwareCards.filter((card) => card.direction === 'long' || card.direction === 'short');
  const correlationPenalty = computeCorrelationAwareSizingPenalty(
    directionalCards.flatMap((card) => card.symbols.filter((symbol) => symbol.role !== 'hedge').map((symbol) => symbol.symbol)),
  );

  const rmtAdjustedCards: InvestmentIdeaCard[] = instrumentAwareCards.map((card): InvestmentIdeaCard => {
    const rowPenalty = average(
      card.symbols
        .filter((symbol) => symbol.role !== 'hedge')
        .map((symbol) => correlationPenalty.rowPenaltyBySymbol.get(symbol.symbol) ?? 0),
    );
    const portfolioCrowdingPenalty = clamp(
      Number((Math.max(correlationPenalty.globalPenalty, rowPenalty) * (card.direction === 'hedge' ? 0.45 : 1)).toFixed(4)),
      0,
      0.55,
    );
    const autonomyAction = portfolioCrowdingPenalty >= 0.34 && card.autonomyAction === 'deploy'
      ? 'shadow'
      : card.autonomyAction;
    return {
      ...card,
      autonomyAction,
      portfolioCrowdingPenalty,
      autonomyReasons: Array.from(new Set([
        ...card.autonomyReasons,
        portfolioCrowdingPenalty > 0 ? `RMT crowding penalty=${(portfolioCrowdingPenalty * 100).toFixed(0)}%.` : '',
        ...correlationPenalty.summary,
      ].filter(Boolean))).slice(0, 6),
    };
  });

  const currentWeightByIdea = new Map(
    trackedIdeas
      .filter((idea) => idea.status === 'open')
      .map((idea) => {
        const signedWeight = (idea.direction === 'short' ? -1 : 1) * (Number(idea.sizePct) || 0) / 100;
        return [idea.ideaKey, signedWeight] as const;
      }),
  );
  const assetClassCaps: Record<string, number> = {
    etf: macroOverlay.killSwitch ? 0.08 : 0.28,
    equity: macroOverlay.killSwitch ? 0.06 : 0.24,
    commodity: macroOverlay.killSwitch ? 0.08 : 0.22,
    rate: 0.18,
    fx: 0.16,
    crypto: macroOverlay.state === 'risk-off' ? 0.04 : 0.1,
  };
  const capitalCalibration = calibrateCapitalBudget(rmtAdjustedCards, macroOverlay);
  const calibratedCards: InvestmentIdeaCard[] = rmtAdjustedCards.map((card): InvestmentIdeaCard => {
    const promotedToDeploy = capitalCalibration.promotedDeployIds.has(card.id);
    const calibratedAction: AutonomyAction = promotedToDeploy
      ? 'deploy'
      : (card.autonomyAction === 'deploy' ? 'shadow' : card.autonomyAction);
    const executionGate = promotedToDeploy ? true : card.executionGate;
    const calibrationReasons: string[] = [];
    if (promotedToDeploy) {
      calibrationReasons.push(
        `Auto-calibration promoted this idea into the deploy set (ranked within top ${Math.min(10, Math.max(1, Math.round(capitalCalibration.promotedDeployIds.size)))} candidates).`,
        `Deploy share=${(capitalCalibration.deployRate * 100).toFixed(0)}% | breadth=${(capitalCalibration.candidateBreadth * 100).toFixed(0)}% | confirmation median=${capitalCalibration.confirmationMedian.toFixed(0)}.`,
        `Readiness median=${capitalCalibration.readinessMedian.toFixed(0)} / spread=${capitalCalibration.readinessSpread.toFixed(0)}.`,
      );
    } else if (card.autonomyAction === 'deploy') {
      calibrationReasons.push(
        'Distribution calibration held this idea in shadow to preserve capital for stronger deploy candidates.',
        `Deploy share=${(capitalCalibration.deployRate * 100).toFixed(0)}% | breadth=${(capitalCalibration.candidateBreadth * 100).toFixed(0)}% | confirmation median=${capitalCalibration.confirmationMedian.toFixed(0)}.`,
      );
    }
    return {
      ...card,
      autonomyAction: calibratedAction,
      executionGate,
      autonomyReasons: Array.from(new Set([
        ...card.autonomyReasons,
        ...calibrationReasons,
      ])).slice(0, 6),
    };
  });
  const deployAllocations = allocateDeployBudget(calibratedCards, macroOverlay, capitalCalibration.grossBudgetPct);
  const normalizedCards: InvestmentIdeaCard[] = calibratedCards.map((card): InvestmentIdeaCard => {
    if (card.autonomyAction !== 'deploy') {
      return {
        ...card,
        sizePct: 0,
        autonomyReasons: Array.from(new Set([
          ...card.autonomyReasons,
          'Shadow/watch ideas are tracked, but their capital allocation is suppressed to zero.',
        ])).slice(0, 6),
      };
    }
    const allocatedSizePct = deployAllocations.get(card.id) ?? 0;
    const allocationSuppressed = !(allocatedSizePct > 0);
    const normalizedAction: AutonomyAction = allocationSuppressed ? 'watch' : card.autonomyAction;
    return {
      ...card,
      autonomyAction: normalizedAction,
      sizePct: allocatedSizePct,
      autonomyReasons: Array.from(new Set([
        ...card.autonomyReasons,
        `Regime gross budget=${capitalCalibration.grossBudgetPct.toFixed(2)}%.`,
        `Auto-calibration deploy count=${capitalCalibration.promotedDeployIds.size}.`,
        allocatedSizePct > 0
          ? `Deploy floor=${deployFloorPctForCard(card, macroOverlay, capitalCalibration.grossBudgetPct, Math.max(1, capitalCalibration.promotedDeployIds.size)).toFixed(2)}%.`
          : 'Cluster-aware Top-K and hierarchical risk budgeting withheld capital from this marginal deploy idea.',
      ])).slice(0, 6),
    };
  });
  const deployClusterPlan = buildDeployClusterPlan(normalizedCards, macroOverlay, capitalCalibration.grossBudgetPct);
  const themeCaps = buildThemeExposureCaps(normalizedCards, macroOverlay, capitalCalibration.grossBudgetPct);
  const dynamicMaxPositionWeight = inferDynamicMaxPositionWeight(
    normalizedCards,
    macroOverlay,
    capitalCalibration.grossBudgetPct,
  );
  const inputs = normalizedCards.map((card) => {
    const primarySymbol = card.symbols.find((symbol) => symbol.role !== 'hedge') || card.symbols[0];
    const instrumentMix = summarizeInstrumentMix(card.symbols);
    const isDeploy = card.autonomyAction === 'deploy';
    const targetWeight = isDeploy
      ? (card.direction === 'short' ? -1 : 1) * (Number(card.sizePct) || 0) / 100
      : 0;
    const coreBias = instrumentMix.hasCore
      ? clamp(0.96 + instrumentMix.coreShare * (macroOverlay.state === 'risk-off' ? 0.34 : 0.18), 0.92, 1.24)
      : (macroOverlay.state === 'risk-off' && instrumentMix.orbitalCount > 0 ? 0.82 : 1);
    const dynamicMaxWeight = isDeploy
      ? clamp(
        Math.max(
          themeCaps[card.themeId] || 0,
          Math.abs(targetWeight) * (macroOverlay.state === 'risk-off' ? 1.45 : 1.25),
        ) * coreBias,
        macroOverlay.killSwitch ? 0.02 : macroOverlay.state === 'risk-off' ? 0.06 : 0.08,
        dynamicMaxPositionWeight,
      )
      : (themeCaps[card.themeId] || dynamicMaxPositionWeight);
    const confidence = isDeploy
      ? clamp(
        (card.confirmationScore / 100) * (0.75 + card.sizeMultiplier * 0.25) * coreBias,
        0,
        1,
      )
      : 0;
    return {
      symbol: card.id,
      currentWeight: isDeploy ? (currentWeightByIdea.get(card.id) ?? 0) : 0,
      targetWeight,
      confidence,
      themeId: card.themeId,
      riskClusterId: deployClusterPlan.clusterByCardId.get(card.id) || undefined,
      assetClass: primarySymbol?.assetKind || 'other',
      tradable: isDeploy && card.executionGate,
      liquidityScore: average(card.symbols.map((symbol) => Number(symbol.liquidityScore) || 0)),
      turnoverCostBps: Math.max(2, (100 - card.realityScore) * 0.4 + card.coveragePenalty * 0.15),
      executionPenaltyPct: Math.max(0, (100 - card.realityScore) * 0.06 + card.coveragePenalty * 0.02),
      minWeight: isDeploy && macroOverlay.killSwitch && card.direction !== 'hedge' ? 0 : undefined,
      maxWeight: dynamicMaxWeight,
    };
  });
  const budgetAwareTicketWeight = (capitalCalibration.grossBudgetPct / 100) / Math.max(1, capitalCalibration.promotedDeployIds.size);
  const adaptiveMinTradeWeight = clamp(
    Math.max(
      median(
      normalizedCards
        .map((card) => Math.abs(Number(card.sizePct) || 0) / 100)
        .filter((value) => value > 0),
      ) * 0.45,
      budgetAwareTicketWeight * 0.2,
    ),
    0.0015,
    0.03,
  );
  const deployWeightBudget = normalizedCards
    .filter((card) => card.autonomyAction === 'deploy')
    .reduce((sum, card) => sum + Math.abs(Number(card.sizePct) || 0), 0);
  const deployConfidenceFloor = clamp(
    percentile(
      normalizedCards
        .filter((card) => card.autonomyAction === 'deploy')
        .map((card) => clamp((card.confirmationScore / 100) * (0.75 + card.sizeMultiplier * 0.25), 0, 1)),
      0.25,
    ) * 0.9,
    macroOverlay.state === 'risk-off' ? 0.12 : 0.1,
    macroOverlay.state === 'risk-off' ? 0.32 : 0.28,
  );
  const underInvestmentPenalty = clamp(
    0.8
    + capitalCalibration.candidateBreadth * 1
    + deployWeightBudget / 18
    + average(
      normalizedCards
        .filter((card) => card.autonomyAction === 'deploy')
        .map((card) => card.confirmationScore),
    ) / 140,
    0.8,
    2.8,
  );
  const plan = optimizeTargetWeights(inputs, {
    longOnly: false,
    grossCap: macroOverlay.grossExposureCapPct / 100,
    netCap: macroOverlay.netExposureCapPct / 100,
    targetGrossExposure: capitalCalibration.grossBudgetPct / 100,
    maxPositionWeight: dynamicMaxPositionWeight,
    maxTurnoverPct: macroOverlay.killSwitch ? 0.08 : macroOverlay.state === 'risk-off' ? 0.18 : 0.3,
    minTradeWeight: adaptiveMinTradeWeight,
    themeCaps,
    clusterCaps: deployClusterPlan.clusterCaps,
    assetClassCaps,
    confidenceFloor: deployConfidenceFloor,
    underInvestmentPenalty,
    iterations: 8,
  });
  const deployRetentionFloorPct = clamp(
    Math.max(
      percentile(
      normalizedCards
        .filter((card) => card.autonomyAction === 'deploy')
        .map((card) => Math.abs(Number((plan.optimizedWeights[card.id] ?? 0) * 100)) || 0)
        .filter((value) => value > 0),
      0.25,
      ) * 0.55,
      (capitalCalibration.grossBudgetPct / Math.max(1, capitalCalibration.promotedDeployIds.size)) * 0.22,
    ),
    0.4,
    4.5,
  );
  const plannedDeployRows = normalizedCards
    .filter((card) => card.autonomyAction === 'deploy')
    .map((card) => ({
      instrumentMix: summarizeInstrumentMix(card.symbols),
      id: card.id,
      themeId: card.themeId,
      clusterId: deployClusterPlan.clusterByCardId.get(card.id) || 'unassigned',
      score:
        capitalReadinessScore(card) * 0.36
        + card.confirmationScore * 0.28
        + Math.abs(Number((plan.optimizedWeights[card.id] ?? 0) * 100)) * 0.26
        + summarizeInstrumentMix(card.symbols).coreShare * (macroOverlay.state === 'risk-off' ? 14 : 8)
        - summarizeInstrumentMix(card.symbols).orbitalCount * (macroOverlay.state === 'risk-off' ? 1.8 : 1.1),
      optimizedSizePct: Math.abs(Number((plan.optimizedWeights[card.id] ?? 0) * 100)),
    }))
    .sort((left, right) => right.score - left.score || right.optimizedSizePct - left.optimizedSizePct);
  const maxDeployPositions = macroOverlay.killSwitch
    ? 1
    : macroOverlay.state === 'risk-off'
      ? Math.min(3, Math.max(1, Math.round(capitalCalibration.grossBudgetPct / 9)))
      : macroOverlay.state === 'balanced'
      ? Math.min(5, Math.max(2, Math.round(capitalCalibration.grossBudgetPct / 8)))
      : Math.min(7, Math.max(3, Math.round(capitalCalibration.grossBudgetPct / 8)));
  const clusterTopKMap = new Map(deployClusterPlan.clusters.map((cluster) => [cluster.id, cluster.topK] as const));
  const clusterPriority = deployClusterPlan.clusters.map((cluster) => cluster.id);
  const plannedByCluster = new Map<string, typeof plannedDeployRows>();
  for (const row of plannedDeployRows) {
    const bucket = plannedByCluster.get(row.clusterId) || [];
    bucket.push(row);
    plannedByCluster.set(row.clusterId, bucket);
  }
  const retainedDeployIds = new Set<string>();
  const retainedPerCluster = new Map<string, number>();
  let cursor = 0;
  while (retainedDeployIds.size < maxDeployPositions) {
    let progressed = false;
    for (const clusterId of clusterPriority) {
      if (retainedDeployIds.size >= maxDeployPositions) break;
      const clusterRows = plannedByCluster.get(clusterId) || [];
      const limit = clusterTopKMap.get(clusterId) ?? 1;
      const alreadyRetained = retainedPerCluster.get(clusterId) ?? 0;
      if (alreadyRetained >= limit) continue;
      const nextRow = clusterRows[alreadyRetained];
      if (!nextRow) continue;
      retainedDeployIds.add(nextRow.id);
      retainedPerCluster.set(clusterId, alreadyRetained + 1);
      progressed = true;
    }
    cursor += 1;
    if (!progressed || cursor > maxDeployPositions + deployClusterPlan.clusters.length + 3) break;
  }
  const totalPlannedDeployPct = plannedDeployRows.reduce((sum, row) => sum + row.optimizedSizePct, 0);
  const retainedPlannedDeployPct = plannedDeployRows
    .filter((row) => retainedDeployIds.has(row.id))
    .reduce((sum, row) => sum + row.optimizedSizePct, 0);
  const retainedBudgetScale = retainedPlannedDeployPct > 0
    ? clamp(totalPlannedDeployPct / retainedPlannedDeployPct, 1, macroOverlay.state === 'risk-off' ? 1.8 : 2.4)
    : 1;

  return normalizedCards.map((card): InvestmentIdeaCard => {
    const optimizedTargetWeightPct = Number((((plan.optimizedWeights[card.id] ?? 0) * 100)).toFixed(2));
    const keepDeploy = card.autonomyAction === 'deploy' && retainedDeployIds.has(card.id);
    const perThemeCapPct = Math.min((themeCaps[card.themeId] ?? dynamicMaxPositionWeight) * 100, dynamicMaxPositionWeight * 100);
    const optimizedSizePct = keepDeploy
      ? clamp(
        Number((Math.abs(optimizedTargetWeightPct) * retainedBudgetScale).toFixed(2)),
        deployRetentionFloorPct,
        perThemeCapPct,
      )
      : 0;
    const autonomyAction: AutonomyAction = card.autonomyAction === 'deploy'
      ? (keepDeploy && optimizedSizePct >= deployRetentionFloorPct ? 'deploy' : 'watch')
      : card.autonomyAction;
    return {
      ...card,
      sizePct: card.autonomyAction === 'deploy' ? optimizedSizePct : 0,
      autonomyAction,
      executionPlanScore: plan.objectiveScore,
      optimizedTargetWeightPct,
      autonomyReasons: Array.from(new Set([
        ...card.autonomyReasons,
        card.autonomyAction === 'deploy'
          ? `Deploy budget used=${deployWeightBudget.toFixed(2)}%.`
          : 'Capital allocation suppressed for non-deploy idea.',
        card.autonomyAction === 'deploy' && !keepDeploy
          ? 'Cluster-aware concentration control removed this marginal deploy idea from capital allocation.'
          : `Deploy concentration scale=${retainedBudgetScale.toFixed(2)}.`,
        `Deploy confidence floor=${deployConfidenceFloor.toFixed(2)}.`,
        `MPC objective=${plan.objectiveScore}.`,
        plan.violations.slice(0, 2).join(' | '),
      ].filter(Boolean))).slice(0, 6),
    };
  });
}

function liquidityBaseline(kind: InvestmentAssetKind): number {
  if (kind === 'etf') return 72;
  if (kind === 'equity') return 64;
  if (kind === 'commodity') return 58;
  if (kind === 'rate') return 70;
  if (kind === 'fx') return 74;
  return 56;
}

function macroPenaltyForAsset(asset: ThemeAssetDefinition, overlay: MacroRiskOverlay): number {
  if (overlay.killSwitch) {
    return asset.direction === 'hedge' ? 0 : 26;
  }
  if (overlay.state === 'risk-off') {
    if (asset.direction === 'hedge') return -4;
    return asset.assetKind === 'equity' || asset.assetKind === 'crypto' ? 16 : 10;
  }
  if (overlay.state === 'balanced') {
    return asset.direction === 'hedge' ? 0 : 6;
  }
  if (overlay.state === 'risk-on' && asset.direction === 'hedge') {
    return 4;
  }
  return 0;
}

function mergeAttributionBreakdown(
  lead: IdeaAttributionBreakdown,
  rows: IdeaAttributionBreakdown[],
): IdeaAttributionBreakdown {
  if (!rows.length) return lead;
  const components = new Map<string, { label: string; contribution: number; explanation: string; count: number }>();
  for (const row of rows) {
    for (const component of row.components) {
      const current = components.get(component.key) || {
        label: component.label,
        contribution: 0,
        explanation: component.explanation,
        count: 0,
      };
      current.contribution += component.contribution;
      current.count += 1;
      components.set(component.key, current);
    }
  }
  const mergedComponents = Array.from(components.entries())
    .map(([key, value]) => ({
      key,
      label: value.label,
      contribution: Number((value.contribution / Math.max(1, value.count)).toFixed(2)),
      explanation: value.explanation,
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const primaryDriver = mergedComponents.find((component) => component.contribution > 0)?.label || lead.primaryDriver;
  const primaryPenalty = [...mergedComponents].reverse().find((component) => component.contribution < 0)?.label || lead.primaryPenalty;
  const failureModes = Array.from(new Set(rows.flatMap((row) => row.failureModes))).slice(0, 6);
  return {
    primaryDriver,
    primaryPenalty,
    components: mergedComponents,
    narrative: lead.narrative,
    failureModes,
  };
}

function buildDirectMappings(args: {
  candidates: EventCandidate[];
  markets: MarketData[];
  transmission: EventMarketTransmissionSnapshot | null;
  timestamp: string;
  autonomy: Pick<AutonomyControlState, 'shadowMode' | 'rollbackLevel'>;
  keywordGraph?: KeywordGraphSnapshot | null;
  weightProfile: SelfTuningWeightProfile;
  macroOverlay: MacroRiskOverlay;
}): DirectAssetMapping[] {
  const marketMap = marketMoveMap(args.markets);
  const regime = args.transmission?.regime ?? null;
  const mappings: DirectAssetMapping[] = [];

  for (const candidate of args.candidates) {
    const themes = findMatchingThemes(candidate);
    if (!themes.length) continue;

    for (const theme of themes) {
      for (const asset of getEffectiveThemeAssets(theme)) {
        const market = marketMap.get(asset.symbol);
        const marketMovePct = market?.change ?? null;
        const learned = getMappingStats(theme.id, asset.symbol, asset.direction);
        const learnedWinRate = learned?.posteriorWinRate ?? 50;
        const learnedReturnPct = learned?.emaReturnPct ?? 0;
        const learnedObservations = learned?.observations ?? 0;
        const recency = assessRecency({
          lastUpdatedAt: learned?.lastUpdatedAt ?? null,
          observations: learnedObservations,
          nowIso: args.timestamp,
        });
        const regimeMultiplier = regimeMultiplierForTheme(
          regime,
          theme.id,
          [candidate.text, theme.label, ...theme.sectors, ...theme.commodities],
        );
        const transferEntropy = estimateTransferEntropy(
          buildEventIntensitySeries(theme.id, candidate.region),
          buildMarketSignalSeries(asset.symbol),
        ).normalized;
        const flowSummary = estimateDirectionalFlowSummary(
          buildTimedEventFlowSeries(theme.id, candidate.region),
          buildTimedMarketFlowSeries(asset.symbol),
          { bucketMs: 24 * 60 * 60 * 1000, maxLag: 4, minBuckets: 8 },
        );
        const graphSupport = assessGraphSupport({
          theme: {
            id: theme.id,
            label: theme.label,
            triggers: theme.triggers,
            sectors: theme.sectors,
            commodities: theme.commodities,
          },
          event: {
            id: candidate.id,
            title: candidate.title,
            text: candidate.text,
            region: candidate.region,
            reasons: candidate.reasons,
            matchedSymbols: candidate.matchedSymbols,
          },
          asset: {
            symbol: asset.symbol,
            name: asset.name,
            assetKind: asset.assetKind,
            sector: asset.sector,
            commodity: asset.commodity,
            direction: asset.direction,
            role: asset.role,
            aliases: UNIVERSE_ASSET_CATALOG.find((entry) => entry.symbol === asset.symbol)?.aliases || [],
          },
          keywordGraph: args.keywordGraph,
          transmission: args.transmission,
        });
        const replayUtilityEstimate = Number((
          (learnedWinRate - 50) * 0.18
          + learnedReturnPct * 1.35
          + Math.log1p(learnedObservations) * 1.8
        ).toFixed(2));
        const knowledgeGraphSupport = buildKnowledgeGraphMappingSupport({
          theme,
          candidate,
          asset,
          graphSignalScore: graphSupport.graphSignalScore,
          transferEntropy,
          informationFlowScore: flowSummary.flowScore,
          leadLagScore: flowSummary.leadLagScore,
          replayUtility: replayUtilityEstimate,
        });
        const banditContext = buildBanditContext({
          credibility: candidate.credibility,
          corroboration: candidate.corroborationQuality,
          marketStress: candidate.marketStress,
          aftershockIntensity: candidate.aftershockIntensity,
          regimeMultiplier,
          transferEntropy,
          posteriorWinRate: learnedWinRate,
          emaReturnPct: learnedReturnPct,
        });
        const bandit = scoreBanditArm(getBanditState(theme.id, asset.symbol, asset.direction), banditContext, 0.72);
        const posteriorBonus = clamp(Math.round((learnedWinRate - 50) * 0.36 * recency.timeDecayWeight), -12, 12);
        const returnBonus = clamp(Math.round(learnedReturnPct * 1.4 * recency.timeDecayWeight), -10, 10);
        const sampleBonus = Math.min(8, Math.round(Math.log2(learnedObservations + 1) * 2 + recency.recentEvidenceScore * 0.04));
        const weightedRegimeMultiplier = regimeMultiplier
          * (args.macroOverlay.state === 'risk-off' ? args.weightProfile.regimeRiskOffMultiplier : 1)
          * (regime?.id === 'inflation-shock' ? args.weightProfile.regimeInflationMultiplier : 1);
        const regimeBonus = clamp(Math.round((weightedRegimeMultiplier - 1) * 18), -10, 14);
        const aftershockBonus = clamp(Math.round(candidate.aftershockIntensity * 16), 0, 14);
        const entropyBonus = clamp(Math.round(transferEntropy * 16), 0, 12);
        const informationFlowBonus = clamp(
          Math.round(Math.max(0, flowSummary.flowScore - 50) * 0.16 + Math.max(0, flowSummary.leadLagScore) * 0.05),
          0,
          14,
        );
        const banditBonus = clamp(Math.round(bandit.score * 10), -10, 14);
        const corroborationBonus = clamp(
          Math.round(((candidate.corroborationQuality - 50) * 0.16) * args.weightProfile.corroborationWeightMultiplier),
          -10,
          14,
        );
        const graphBonus = clamp(
          Math.round(((graphSupport.graphSignalScore - 50) * 0.22) * args.weightProfile.graphPropagationWeightMultiplier),
          -8,
          14,
        );
        const knowledgeBonus = clamp(
          Math.round((knowledgeGraphSupport.supportScore - 50) * 0.16),
          -8,
          14,
        );
        const macroPenalty = macroPenaltyForAsset(asset, args.macroOverlay);
        const contradictionPenalty = Math.round(candidate.contradictionPenalty * args.weightProfile.contradictionPenaltyMultiplier);
        const rumorPenalty = Math.round(candidate.rumorPenalty * (0.92 + (args.weightProfile.contradictionPenaltyMultiplier - 1) * 0.8));
        const stalePenalty = Math.round(recency.stalePenalty * args.weightProfile.recencyPenaltyMultiplier);
        const convictionBase = Math.round(
          26
          + candidate.sourceCount * 7
          + (candidate.isAlert ? 10 : 0)
          + candidate.eventIntensity * 0.14
          + candidate.credibility * 0.15
          + candidate.corroborationQuality * 0.17
          + candidate.sourceDiversity * 0.08
          + candidate.marketStress * 22
          + candidate.aftershockIntensity * 12
          + (marketMovePct != null ? Math.min(12, Math.abs(marketMovePct) * 2.8) : 0),
        );
        const conviction = clamp(
          convictionBase
          + corroborationBonus
          + posteriorBonus
          + returnBonus
          + sampleBonus
          + regimeBonus
          + aftershockBonus
          + entropyBonus
          + informationFlowBonus
          + banditBonus
          + graphBonus
          + knowledgeBonus
          - contradictionPenalty
          - rumorPenalty
          - stalePenalty
          - macroPenalty,
          20,
          98,
        );
        const falsePositiveRisk = clamp(
          Math.round(
            82
            - candidate.sourceCount * 6
            - candidate.credibility * 0.18
            - candidate.corroborationQuality * 0.18
            - candidate.sourceDiversity * 0.07
            - candidate.eventIntensity * 0.12
            - candidate.marketStress * 16
            - (candidate.isAlert ? 6 : 0)
            + contradictionPenalty * 0.85
            + rumorPenalty * 0.7
            + stalePenalty * 0.45
            - Math.max(0, posteriorBonus)
            - Math.max(0, returnBonus)
            - Math.max(0, regimeBonus)
            - Math.max(0, aftershockBonus)
            - Math.max(0, entropyBonus)
            - Math.max(0, informationFlowBonus)
            - Math.max(0, banditBonus),
          ),
          6,
          78,
        );
        const sensitivityScore = clamp(
          Math.round(
            theme.baseSensitivity
            + candidate.marketStress * 10
            + candidate.sourceCount * 1.8
            + candidate.eventIntensity * 0.12
            + candidate.aftershockIntensity * 10
            + candidate.corroborationQuality * 0.08
            + candidate.sourceDiversity * 0.06
            + recency.recentEvidenceScore * 0.08
            + posteriorBonus * 0.35
            + returnBonus * 0.45
            + regimeBonus * 0.8
            + entropyBonus * 0.9
            + informationFlowBonus * 0.7
            + graphBonus * 0.8,
          ),
          35,
          99,
        );
        const liquidityScore = clamp(
          Math.round(liquidityBaseline(asset.assetKind) + (marketMovePct != null ? Math.min(12, Math.abs(marketMovePct) * 2.2) : 0)),
          20,
          98,
        );
        const reality = assessExecutionReality({
          assetKind: asset.assetKind,
          liquidityScore,
          marketMovePct,
          timestamp: args.timestamp,
        });
        const realityPenaltyPct = Number((reality.executionPenaltyPct * args.weightProfile.realityPenaltyMultiplier).toFixed(2));
        const adjustedRealityScore = clamp(
          Math.round(100 - realityPenaltyPct * 20 - Math.max(0, 58 - liquidityScore) * 0.6 - (reality.tradableNow ? 0 : 10)),
          10,
          98,
        );
        const calibration = calibrateDecision({
          conviction,
          falsePositiveRisk,
          corroborationQuality: candidate.corroborationQuality,
          contradictionPenalty,
          rumorPenalty,
          recentEvidenceScore: recency.recentEvidenceScore,
          realityScore: adjustedRealityScore,
          floorBreached: recency.floorBreached,
          rollbackLevel: args.autonomy.rollbackLevel,
          shadowMode: args.autonomy.shadowMode,
          direction: asset.direction,
        });
        const attribution = buildIdeaAttribution({
          themeLabel: theme.label,
          symbol: asset.symbol,
          corroborationQuality: candidate.corroborationQuality,
          contradictionPenalty,
          recentEvidenceScore: recency.recentEvidenceScore,
          stalePenalty,
          realityScore: adjustedRealityScore,
          transferEntropy,
          banditScore: bandit.score,
          graphSignalScore: graphSupport.graphSignalScore,
          regimeMultiplier: weightedRegimeMultiplier,
          macroPenalty,
          falsePositiveRisk,
          marketMovePct,
        });

        mappings.push({
          id: `${candidate.id}:${theme.id}:${asset.symbol}`,
          eventTitle: candidate.title,
          eventSource: candidate.source,
          themeId: theme.id,
          themeLabel: theme.label,
          region: candidate.region,
          symbol: asset.symbol,
          assetName: asset.name,
          assetKind: asset.assetKind,
          sector: asset.sector,
          commodity: asset.commodity || theme.commodities[0] || null,
          direction: asset.direction,
          role: asset.role,
          conviction,
          sensitivityScore,
          falsePositiveRisk,
          eventIntensity: candidate.eventIntensity,
          liquidityScore,
          marketMovePct,
          regimeId: regime?.id ?? candidate.regimeId,
          regimeMultiplier: weightedRegimeMultiplier,
          aftershockIntensity: Number(candidate.aftershockIntensity.toFixed(4)),
          transferEntropy: Number(transferEntropy.toFixed(4)),
          informationFlowScore: Number(flowSummary.flowScore.toFixed(4)),
          leadLagScore: Number(flowSummary.leadLagScore.toFixed(4)),
          knowledgeGraphScore: Number(knowledgeGraphSupport.supportScore.toFixed(4)),
          knowledgeRelationType: knowledgeGraphSupport.dominantRelationType,
          banditScore: Number(bandit.score.toFixed(4)),
          banditMean: Number(bandit.mean.toFixed(4)),
          banditUncertainty: Number(bandit.uncertainty.toFixed(4)),
          corroboration: candidate.corroboration,
          sourceDiversity: candidate.sourceDiversity,
          corroborationQuality: candidate.corroborationQuality,
          contradictionPenalty,
          rumorPenalty,
          recentEvidenceScore: recency.recentEvidenceScore,
          timeDecayWeight: recency.timeDecayWeight,
          stalePenalty,
          realityScore: adjustedRealityScore,
          executionPenaltyPct: realityPenaltyPct,
          sessionState: reality.sessionState,
          tradableNow: reality.tradableNow,
          graphSignalScore: graphSupport.graphSignalScore,
          calibratedConfidence: calibration.calibratedConfidence,
          confirmationScore: calibration.calibratedConfidence,
          confirmationState: calibration.calibratedConfidence >= 70 ? 'confirmed' : calibration.calibratedConfidence >= 52 ? 'tentative' : 'fading',
          sizeMultiplier: 1,
          horizonMultiplier: 1,
          executionGate: reality.tradableNow && adjustedRealityScore >= 36,
          coveragePenalty: 0,
          autonomyAction: calibration.action,
          autonomyReasons: calibration.reasons,
          attribution,
          reasons: [
            theme.thesis,
            ...candidate.reasons,
            `CrossCorr=${candidate.corroborationQuality}`,
            `Intensity=${candidate.eventIntensity}`,
            `Recency=${recency.recentEvidenceScore} decay=${recency.timeDecayWeight.toFixed(2)}`,
            `Reality=${adjustedRealityScore} penalty=${realityPenaltyPct.toFixed(2)}%`,
            `Regime=${regime?.label || candidate.regimeId || 'unknown'} x${weightedRegimeMultiplier.toFixed(2)}`,
            `Aftershock=${candidate.aftershockIntensity.toFixed(2)}`,
            `TransferEntropy=${transferEntropy.toFixed(2)}`,
            `InfoFlow=${flowSummary.flowScore.toFixed(2)} lag=${flowSummary.bestLagHours.toFixed(1)}h`,
            `Bandit=${bandit.score.toFixed(2)}`,
            `Graph=${graphSupport.graphSignalScore}`,
            `KG=${knowledgeGraphSupport.supportScore.toFixed(0)} ${knowledgeGraphSupport.dominantRelationType}`,
            `Macro=${args.macroOverlay.state} gauge=${args.macroOverlay.riskGauge}`,
            ...calibration.reasons,
            ...graphSupport.notes,
            ...knowledgeGraphSupport.notes,
          ].slice(0, 8),
          transmissionPath: [
            ...graphSupport.propagationPath,
            ...knowledgeGraphSupport.notes.map((note) => `KG ${note}`),
            `${asset.symbol} ${asset.name}`,
          ].slice(0, 5),
          tags: [...theme.sectors, ...theme.commodities, ...candidate.matchedSymbols].slice(0, 8),
        });
      }
    }
  }

  return mappings
    .sort((a, b) => b.calibratedConfidence - a.calibratedConfidence || b.conviction - a.conviction || b.sensitivityScore - a.sensitivityScore)
    .slice(0, MAX_MAPPINGS);
}

function marketConfirmationScore(direction: InvestmentDirection, marketMovePct: number | null): number {
  if (typeof marketMovePct !== 'number' || !Number.isFinite(marketMovePct)) return 50;
  const directionalMove = direction === 'short'
    ? -marketMovePct
    : direction === 'hedge' || direction === 'watch' || direction === 'pair'
      ? Math.abs(marketMovePct) * 0.5
      : marketMovePct;
  return clamp(Math.round(50 + directionalMove * 10), 8, 96);
}

function confirmationStateFromScore(score: number): ConfirmationState {
  if (score >= 72) return 'confirmed';
  if (score >= 54) return 'tentative';
  if (score >= 38) return 'fading';
  return 'contradicted';
}

function executionReadinessScore(mapping: Pick<
  DirectAssetMapping,
  'assetKind' | 'tradableNow' | 'sessionState' | 'liquidityScore' | 'executionPenaltyPct'
>): number {
  const tradableScore = mapping.tradableNow
    ? 100
    : mapping.assetKind === 'crypto'
      ? 78
      : 56;
  const sessionScore = mapping.sessionState === 'always-on'
    ? 100
    : mapping.sessionState === 'open'
      ? 96
      : mapping.sessionState === 'extended'
        ? 82
        : 58;
  const liquidityScore = clamp(Number(mapping.liquidityScore) || 0, 0, 100);
  const penaltyScore = clamp(100 - (Number(mapping.executionPenaltyPct) || 0) * 18, 0, 100);
  return clamp(
    Math.round(
      tradableScore * 0.34
      + sessionScore * 0.24
      + liquidityScore * 0.26
      + penaltyScore * 0.16
    ),
    0,
    100,
  );
}

function scoreCurrentPerformanceInfluence(args: {
  context: InvestmentIntelligenceContext;
  referenceTimestamp: string;
  replayProfile: ReturnType<typeof getReplayThemeProfileFromSnapshot>;
  currentPerformance: ReturnType<typeof getCurrentThemePerformanceFromSnapshot>;
  coverage: ReturnType<typeof getCoveragePenaltyForTheme>;
}): {
  weight: number;
  freshness: number;
  sampleConfidence: number;
  driftPenalty: number;
  currentReturn: number;
  currentHitRate: number;
  currentConfirmationScore: number;
} {
  const currentPerformance = args.currentPerformance;
  if (!currentPerformance) {
    return {
      weight: 0,
      freshness: 0,
      sampleConfidence: 0,
      driftPenalty: 0,
      currentReturn: 0,
      currentHitRate: 50,
      currentConfirmationScore: 0,
    };
  }
  const ageHours = Math.abs(asTs(args.referenceTimestamp) - asTs(currentPerformance.updatedAt)) / 3_600_000;
  const freshness = clamp(1 - ageHours / (24 * 21), 0, 1);
  const sampleCount = Math.max(0, Number(currentPerformance.activeCount) || 0) + Math.max(0, Number(currentPerformance.closedCount) || 0);
  const sampleConfidence = clamp(Math.log1p(sampleCount) / Math.log(10), 0, 1);
  const replayReliability = clamp((args.replayProfile?.confirmationReliability ?? 52) / 100, 0, 1);
  const coverageReliability = clamp(args.coverage.completenessScore / 100, 0, 1);
  const contextBase = args.context === 'live'
    ? 1
    : args.context === 'validation'
      ? 0.75
      : 0.55;
  const weight = Number((
    contextBase
    * freshness
    * (0.34 + sampleConfidence * 0.26 + replayReliability * 0.22 + coverageReliability * 0.18)
  ).toFixed(4));
  const driftPenalty = Number((
    weight
    * Math.min(18, Math.abs(args.replayProfile?.currentVsReplayDrift ?? 0) * 8)
  ).toFixed(2));
  return {
    weight,
    freshness,
    sampleConfidence,
    driftPenalty,
    currentReturn: Number(currentPerformance.avgReturnPct) || 0,
    currentHitRate: Number(currentPerformance.hitRate) || 50,
    currentConfirmationScore: Number(currentPerformance.confirmationScore) || 0,
  };
}

function getCurrentThemePerformanceMetric(
  metrics: CurrentThemePerformanceMetric[],
  themeId: string,
): CurrentThemePerformanceMetric | null {
  const normalizedThemeId = normalize(themeId);
  return metrics.find((metric) => normalize(metric.themeId) === normalizedThemeId) || null;
}

function estimateRegimeConditionalHalfLife(args: {
  replayProfile: ReturnType<typeof getReplayThemeProfileFromSnapshot>;
  currentInfluence: ReturnType<typeof scoreCurrentPerformanceInfluence>;
  coverage: ReturnType<typeof getCoveragePenaltyForTheme>;
  marketConfirmation: number;
}): {
  persistenceRho: number;
  multiplier: number;
  estimatedHalfLifeHours: number | null;
} {
  const preferredHorizonHours =
    typeof args.replayProfile?.preferredHorizonHours === 'number'
      ? Math.max(1, Math.round(args.replayProfile.preferredHorizonHours))
      : null;
  const replayReliability = clamp((args.replayProfile?.confirmationReliability ?? 52) / 100, 0, 1);
  const coverageReliability = clamp(args.coverage.completenessScore / 100, 0, 1);
  const positiveReturn = clamp(args.currentInfluence.currentReturn / 4, 0, 1);
  const negativeReturn = clamp(Math.abs(Math.min(0, args.currentInfluence.currentReturn)) / 4, 0, 1);
  const hitBonus = clamp((args.currentInfluence.currentHitRate - 50) / 28, 0, 1);
  const hitPenalty = clamp((50 - args.currentInfluence.currentHitRate) / 24, 0, 1);
  const driftPenalty = clamp(Math.abs(args.replayProfile?.currentVsReplayDrift ?? 0) / 6, 0, 1);
  const marketPenalty = args.marketConfirmation < 46 ? (46 - args.marketConfirmation) / 60 : 0;
  const marketBonus = args.marketConfirmation > 62 ? (args.marketConfirmation - 62) / 80 : 0;
  const persistenceRho = clamp(
    0.26
    + replayReliability * 0.28
    + coverageReliability * 0.12
    + positiveReturn * 0.08
    + hitBonus * 0.08
    + marketBonus * 0.06
    - negativeReturn * 0.18
    - hitPenalty * 0.12
    - driftPenalty * 0.2
    - marketPenalty * 0.08,
    0.2,
    0.94,
  );
  const halfLifePeriods = Math.abs(Math.log(0.5) / Math.log(persistenceRho));
  const multiplier = clamp(halfLifePeriods / 2.4, 0.24, 1.12);
  return {
    persistenceRho: Number(persistenceRho.toFixed(4)),
    multiplier: Number(multiplier.toFixed(4)),
    estimatedHalfLifeHours: preferredHorizonHours
      ? Math.max(12, Math.round(preferredHorizonHours * multiplier))
      : null,
  };
}

function applyAdaptiveConfirmationLayer(
  mappings: DirectAssetMapping[],
  replayAdaptation: ReplayAdaptationSnapshot | null,
  coverageLedger: CoverageLedgerSnapshot | null,
  options: {
    context: InvestmentIntelligenceContext;
    referenceTimestamp: string;
    currentThemePerformance: CurrentThemePerformanceMetric[];
  },
): DirectAssetMapping[] {
  return mappings.map((mapping) => {
    const replayProfile = getReplayThemeProfileFromSnapshot(replayAdaptation, mapping.themeId);
    const currentPerformance =
      getCurrentThemePerformanceMetric(options.currentThemePerformance, mapping.themeId)
      || getCurrentThemePerformanceFromSnapshot(replayAdaptation, mapping.themeId);
    const coverage = getCoveragePenaltyForTheme(coverageLedger, mapping.themeId);
    const marketConfirmation = marketConfirmationScore(mapping.direction, mapping.marketMovePct);
    const replayUtility = replayProfile?.coverageAdjustedUtility ?? replayProfile?.utilityScore ?? 0;
    const regimeConsistency = clamp(Math.round(50 + ((mapping.regimeMultiplier ?? 1) - 1) * 42), 0, 100);
    const sourceDiversityScore = clamp(Math.round(mapping.sourceDiversity * 14), 0, 100);
    const executionReadiness = executionReadinessScore(mapping);
    const informationFlowScore = clamp(Math.round(Number(mapping.informationFlowScore) || 0), 0, 100);
    const knowledgeGraphScore = clamp(Math.round(Number(mapping.knowledgeGraphScore) || 0), 0, 100);
    const currentInfluence = scoreCurrentPerformanceInfluence({
      context: options.context,
      referenceTimestamp: options.referenceTimestamp,
      replayProfile,
      currentPerformance,
      coverage,
    });
    const halfLife = estimateRegimeConditionalHalfLife({
      replayProfile,
      currentInfluence,
      coverage,
      marketConfirmation,
    });
    const confirmationScore = clamp(
      Math.round(
        14
        + mapping.corroborationQuality * 0.18
        + mapping.realityScore * 0.14
        + mapping.recentEvidenceScore * 0.12
        + sourceDiversityScore * 0.08
        + marketConfirmation * 0.18
        + executionReadiness * 0.08
        + regimeConsistency * 0.08
        + informationFlowScore * 0.06
        + knowledgeGraphScore * 0.06
        + Math.max(0, replayUtility) * 0.14
        + (replayProfile?.confirmationReliability ?? 0) * 0.08
        + currentInfluence.currentConfirmationScore * currentInfluence.weight * 0.1
        + (currentInfluence.currentHitRate - 50) * currentInfluence.weight * 0.18
        + currentInfluence.currentReturn * currentInfluence.weight * 6
        - mapping.executionPenaltyPct * 3.4
        - coverage.coveragePenalty * 0.44
        - currentInfluence.driftPenalty,
      ),
      0,
      100,
    );
    const confirmationState = confirmationStateFromScore(confirmationScore);
    const sizeMultiplier = Number(clamp(
      (
        (confirmationScore / 78)
        * (0.48 + marketConfirmation / 100)
        * (0.52 + executionReadiness / 125)
        * (1 - coverage.coveragePenalty / 130)
      ),
      0,
      1.25,
    ).toFixed(4));
    const horizonMultiplier = Number(clamp(
      (
        (replayProfile ? 0.82 + replayProfile.confirmationReliability / 140 : 1)
        * (marketConfirmation < 45 ? 0.72 : marketConfirmation > 62 ? 1.1 : 0.94)
        * clamp(1 + currentInfluence.currentReturn * currentInfluence.weight * 0.05, 0.84, 1.12)
        * halfLife.multiplier
      ),
      0.22,
      1.28,
    ).toFixed(4));
    const executionGate = executionReadiness >= 52 && mapping.realityScore >= 34 && confirmationScore >= 36;
    const calibratedConfidence = clamp(
      Math.round(mapping.calibratedConfidence * 0.58 + confirmationScore * 0.42 - coverage.coveragePenalty * 0.06),
      0,
      99,
    );
    const conviction = clamp(
      Math.round(mapping.conviction * 0.66 + confirmationScore * 0.34 - coverage.coveragePenalty * 0.08),
      12,
      99,
    );
    const falsePositiveRisk = clamp(
      Math.round(mapping.falsePositiveRisk * 0.74 + Math.max(0, 72 - confirmationScore) * 0.34 + coverage.coveragePenalty * 0.24),
      4,
      96,
    );
    const autonomyAction: AutonomyAction = !executionGate || confirmationState === 'contradicted'
      ? 'abstain'
      : confirmationState === 'fading'
        ? 'shadow'
        : confirmationState === 'tentative'
          ? (mapping.autonomyAction === 'deploy' ? 'shadow' : mapping.autonomyAction)
          : mapping.autonomyAction;

    return {
      ...mapping,
      conviction,
      falsePositiveRisk,
      calibratedConfidence,
      confirmationScore,
      confirmationState,
      sizeMultiplier,
      horizonMultiplier,
      executionGate,
      coveragePenalty: coverage.coveragePenalty,
      autonomyAction,
      autonomyReasons: Array.from(new Set([
        ...mapping.autonomyReasons,
        `Confirmation=${confirmationScore}`,
        `MarketConfirm=${marketConfirmation}`,
        `ExecReady=${executionReadiness}`,
        `InfoFlow=${informationFlowScore}`,
        `KG=${knowledgeGraphScore}`,
        `CoveragePenalty=${coverage.coveragePenalty}`,
        replayProfile ? `ReplayUtility=${replayUtility.toFixed(2)}` : 'ReplayUtility=unavailable',
        currentPerformance ? `CurrentWeight=${(currentInfluence.weight * 100).toFixed(0)}` : 'CurrentWeight=0',
        halfLife.estimatedHalfLifeHours ? `HalfLife=${halfLife.estimatedHalfLifeHours}h` : '',
      ])).slice(0, 6),
    };
  }).sort((a, b) =>
    b.confirmationScore - a.confirmationScore
    || b.calibratedConfidence - a.calibratedConfidence
    || b.conviction - a.conviction
  );
}

function buildCurrentThemePerformanceMetrics(
  mappings: DirectAssetMapping[],
  tracked: TrackedIdeaState[],
  backtests: EventBacktestRow[],
): Array<{
  themeId: string;
  activeCount: number;
  closedCount: number;
  hitRate: number;
  avgReturnPct: number;
  confirmationScore: number;
  updatedAt: string;
}> {
  const now = nowIso();
  const themeIds = Array.from(new Set(mappings.map((mapping) => mapping.themeId).filter(Boolean)));
  return themeIds.map((themeId) => {
    const themeMappings = mappings.filter((mapping) => mapping.themeId === themeId);
    const relatedTracked = tracked.filter((idea) => idea.themeId === themeId);
    const relatedBacktests = backtests.filter((row) => row.themeId === themeId);
    const activeCount = relatedTracked.filter((idea) => idea.status === 'open').length;
    const closedCount = relatedTracked.filter((idea) => idea.status === 'closed').length;
    const weightedSamples = relatedBacktests.reduce((sum, row) => sum + row.sampleSize, 0);
    const hitRate = weightedSamples > 0
      ? Math.round(relatedBacktests.reduce((sum, row) => sum + row.hitRate * row.sampleSize, 0) / weightedSamples)
      : 0;
    const avgReturnPct = weightedSamples > 0
      ? Number((relatedBacktests.reduce((sum, row) => sum + row.avgReturnPct * row.sampleSize, 0) / weightedSamples).toFixed(2))
      : Number(average(
        relatedTracked
          .map((idea) => idea.status === 'closed' ? idea.realizedReturnPct : idea.currentReturnPct)
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
      ).toFixed(2));
    const confirmationScore = clamp(
      Math.round(average(themeMappings.map((mapping) => mapping.confirmationScore || 0))),
      0,
      100,
    );
    return {
      themeId,
      activeCount,
      closedCount,
      hitRate,
      avgReturnPct,
      confirmationScore,
      updatedAt: now,
    };
  });
}

function buildRollingThemePerformanceMetrics(
  tracked: TrackedIdeaState[],
  backtests: EventBacktestRow[],
  timestamp: string,
): CurrentThemePerformanceMetric[] {
  const themeIds = Array.from(new Set([
    ...tracked.map((idea) => idea.themeId),
    ...backtests.map((row) => row.themeId),
  ].filter(Boolean)));
  return themeIds.map((themeId) => {
    const relatedTracked = tracked.filter((idea) => idea.themeId === themeId);
    const relatedBacktests = backtests.filter((row) => row.themeId === themeId);
    const activeCount = relatedTracked.filter((idea) => idea.status === 'open').length;
    const closedCount = relatedTracked.filter((idea) => idea.status === 'closed').length;
    const weightedSamples = relatedBacktests.reduce((sum, row) => sum + row.sampleSize, 0);
    const trackedReturns = relatedTracked
      .map((idea) => idea.status === 'closed' ? idea.realizedReturnPct : idea.currentReturnPct)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const trackedHitRate = trackedReturns.length > 0
      ? Math.round((trackedReturns.filter((value) => value > 0).length / trackedReturns.length) * 100)
      : 0;
    const hitRate = weightedSamples > 0
      ? Math.round(relatedBacktests.reduce((sum, row) => sum + row.hitRate * row.sampleSize, 0) / weightedSamples)
      : trackedHitRate;
    const avgReturnPct = weightedSamples > 0
      ? Number((relatedBacktests.reduce((sum, row) => sum + row.avgReturnPct * row.sampleSize, 0) / weightedSamples).toFixed(2))
      : Number(average(trackedReturns).toFixed(2));
    const sampleCount = weightedSamples > 0 ? weightedSamples : trackedReturns.length;
    const confirmationScore = clamp(
      Math.round(
        36
        + Math.log1p(sampleCount) * 9
        + (hitRate - 50) * 0.42
        + avgReturnPct * 6
        + Math.min(8, activeCount * 1.6),
      ),
      0,
      100,
    );
    return {
      themeId,
      activeCount,
      closedCount,
      hitRate,
      avgReturnPct,
      confirmationScore,
      updatedAt: timestamp,
    };
  }).sort((a, b) =>
    b.confirmationScore - a.confirmationScore
    || (b.activeCount + b.closedCount) - (a.activeCount + a.closedCount)
  );
}

function buildSensitivityRows(
  mappings: DirectAssetMapping[],
  backtests: EventBacktestRow[],
  tracked: TrackedIdeaState[],
): SectorSensitivityRow[] {
  const grouped = new Map<string, DirectAssetMapping[]>();
  for (const mapping of mappings) {
    const key = `${mapping.sector}::${mapping.commodity || 'na'}`;
    const bucket = grouped.get(key) || [];
    bucket.push(mapping);
    grouped.set(key, bucket);
  }

  return Array.from(grouped.entries()).map(([key, bucket]) => {
    const [sector = 'unknown', commodityRaw = 'na'] = key.split('::');
    const commodity = commodityRaw === 'na' ? null : commodityRaw;
    const longScore = bucket.filter((item) => item.direction === 'long').reduce((sum, item) => sum + item.sensitivityScore, 0);
    const shortScore = bucket.filter((item) => item.direction === 'short').reduce((sum, item) => sum + item.sensitivityScore, 0);
    const hedgeScore = bucket.filter((item) => item.direction === 'hedge').reduce((sum, item) => sum + item.sensitivityScore, 0);
    const symbols = Array.from(new Set(bucket.map((item) => item.symbol)));
    const themeIds = Array.from(new Set(bucket.map((item) => item.themeId)));
    const relevantBacktests = backtests.filter((row) => symbols.includes(row.symbol) || themeIds.includes(row.themeId));
    const relevantTracked = tracked.filter((idea) =>
      idea.symbols.some((symbol) => symbols.includes(symbol.symbol)),
    );
    const liveReturns = relevantTracked
      .map((idea) => idea.status === 'closed' ? idea.realizedReturnPct : idea.currentReturnPct)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const weightedWinRateDenominator = relevantBacktests.reduce((sum, row) => sum + row.sampleSize, 0);
    const weightedWinRate = weightedWinRateDenominator > 0
      ? Math.round(relevantBacktests.reduce((sum, row) => sum + row.hitRate * row.sampleSize, 0) / weightedWinRateDenominator)
      : null;
    const bias: InvestmentBias = longScore >= shortScore + hedgeScore
      ? 'benefit'
      : shortScore >= longScore + hedgeScore
        ? 'pressure'
        : 'mixed';
    return {
      id: key,
      sector,
      commodity,
      bias,
      sensitivityScore: clamp(Math.round(average(bucket.map((item) => item.sensitivityScore))), 10, 99),
      conviction: clamp(Math.round(average(bucket.map((item) => item.conviction))), 10, 99),
      linkedEvents: new Set(bucket.map((item) => item.eventTitle)).size,
      sampleSize: relevantBacktests.reduce((sum, row) => sum + row.sampleSize, 0),
      liveReturnPct: liveReturns.length > 0 ? Number(average(liveReturns).toFixed(2)) : null,
      backtestWinRate: weightedWinRate,
      drivers: Array.from(new Set(bucket.flatMap((item) => item.reasons))).slice(0, 4),
      symbols: symbols.slice(0, 6),
    };
  }).sort((a, b) => b.sensitivityScore - a.sensitivityScore).slice(0, 14);
}

function chooseSizingRule(conviction: number, falsePositiveRisk: number, direction: InvestmentDirection): PositionSizingRule {
  if (direction === 'hedge') {
    return POSITION_RULES.find((rule) => rule.id === 'hedge') || POSITION_RULES[0]!;
  }
  const matched = POSITION_RULES
    .filter((rule) => rule.id !== 'hedge')
    .slice()
    .sort((a, b) => b.minConviction - a.minConviction)
    .find((rule) => conviction >= rule.minConviction && falsePositiveRisk <= rule.maxFalsePositiveRisk);
  return matched || POSITION_RULES[0]!;
}

function applyAtrAdjustedRule(rule: PositionSizingRule, symbols: InvestmentIdeaSymbol[]): PositionSizingRule {
  const atrLikePct = estimateAtrLikePct(symbols.map((symbol) => symbol.symbol));
  if (atrLikePct == null) return rule;
  const stopLossPct = Number(Math.max(rule.stopLossPct, atrLikePct * 1.5).toFixed(2));
  const takeProfitPct = Number(Math.max(rule.takeProfitPct, stopLossPct * 2).toFixed(2));
  return {
    ...rule,
    stopLossPct,
    takeProfitPct,
    notes: [
      ...rule.notes,
      `ATR-like stop ${stopLossPct.toFixed(2)}% / take ${takeProfitPct.toFixed(2)}%`,
    ].slice(0, 4),
  };
}

function makeTrackingId(ideaKey: string, openedAt: string): string {
  return `${ideaKey}:${openedAt}`;
}

function updateTrackedSymbols(
  symbols: InvestmentIdeaSymbol[],
  existingSymbols: TrackedIdeaSymbolState[] | null,
  priceMap: Map<string, number>,
): TrackedIdeaSymbolState[] {
  return symbols.map((symbol) => {
    const existing = existingSymbols?.find((item) => item.symbol === symbol.symbol && item.role === symbol.role) || null;
    const currentPrice = priceMap.get(symbol.symbol) ?? existing?.currentPrice ?? null;
    const entryPrice = existing?.entryPrice ?? currentPrice ?? null;
    const returnPct = computeDirectedReturnPct(symbol.direction, entryPrice, currentPrice);
    return {
      symbol: symbol.symbol,
      name: symbol.name,
      role: symbol.role,
      direction: symbol.direction,
      sector: symbol.sector,
      contextVector: symbol.contextVector?.slice(),
      banditScore: symbol.banditScore ?? null,
      entryPrice,
      currentPrice,
      returnPct,
    };
  });
}

function applyTrackedExitRules(idea: TrackedIdeaState, timestamp: string): TrackedIdeaState {
  if (idea.status === 'closed') return idea;
  const currentReturn = idea.currentReturnPct;
  const daysHeld = elapsedDays(idea.openedAt, timestamp);
  let exitReason: string | undefined;

  if (typeof currentReturn === 'number' && Number.isFinite(currentReturn)) {
    if (currentReturn <= -idea.stopLossPct) {
      exitReason = 'stop-loss';
    } else if (currentReturn >= idea.takeProfitPct) {
      exitReason = 'take-profit';
    }
  }
  if (!exitReason && daysHeld >= idea.maxHoldingDays) {
    exitReason = 'time-stop';
  }
  if (!exitReason && idea.staleCycles >= 3) {
    exitReason = 'signal-decay';
  }

  if (!exitReason) {
    return {
      ...idea,
      daysHeld: Number(daysHeld.toFixed(2)),
    };
  }

  return {
    ...idea,
    status: 'closed',
    closedAt: timestamp,
    daysHeld: Number(daysHeld.toFixed(2)),
    realizedReturnPct: currentReturn,
    exitReason,
  };
}

function refreshTrackedIdea(
  ideaCard: InvestmentIdeaCard,
  existing: TrackedIdeaState | null,
  priceMap: Map<string, number>,
  timestamp: string,
): TrackedIdeaState {
  const rule = applyAtrAdjustedRule(
    chooseSizingRule(
      ideaCard.conviction,
      ideaCard.falsePositiveRisk,
      ideaCard.direction === 'watch' ? 'hedge' : ideaCard.direction,
    ),
    ideaCard.symbols,
  );
  const symbols = updateTrackedSymbols(ideaCard.symbols, existing?.symbols ?? null, priceMap);
  const currentReturnPct = computeWeightedIdeaReturn(symbols);
  const bestReturnPct = typeof currentReturnPct === 'number'
    ? Math.max(existing?.bestReturnPct ?? currentReturnPct, currentReturnPct)
    : existing?.bestReturnPct ?? 0;
  const worstReturnPct = typeof currentReturnPct === 'number'
    ? Math.min(existing?.worstReturnPct ?? currentReturnPct, currentReturnPct)
    : existing?.worstReturnPct ?? 0;

  const base: TrackedIdeaState = {
    trackingId: existing?.trackingId || makeTrackingId(ideaCard.id, timestamp),
    ideaKey: ideaCard.id,
    title: ideaCard.title,
    themeId: ideaCard.themeId,
    direction: ideaCard.direction,
    status: existing?.status === 'closed' ? 'closed' : 'open',
    openedAt: existing?.openedAt || timestamp,
    lastMarkedAt: timestamp,
    closedAt: existing?.closedAt,
    sizePct: ideaCard.sizePct,
    conviction: ideaCard.conviction,
    falsePositiveRisk: ideaCard.falsePositiveRisk,
    stopLossPct: rule.stopLossPct,
    takeProfitPct: rule.takeProfitPct,
    maxHoldingDays: rule.maxHoldingDays,
    daysHeld: Number(elapsedDays(existing?.openedAt || timestamp, timestamp).toFixed(2)),
    currentReturnPct,
    realizedReturnPct: existing?.realizedReturnPct ?? null,
    bestReturnPct: Number(bestReturnPct.toFixed(2)),
    worstReturnPct: Number(worstReturnPct.toFixed(2)),
    staleCycles: 0,
    exitReason: existing?.exitReason,
    symbols,
    evidence: ideaCard.evidence.slice(0, 6),
    triggers: ideaCard.triggers.slice(0, 6),
    invalidation: ideaCard.invalidation.slice(0, 6),
  };

  if (existing?.status === 'closed') {
    return base;
  }
  return applyTrackedExitRules(base, timestamp);
}

function decayMissingTrackedIdea(existing: TrackedIdeaState, priceMap: Map<string, number>, timestamp: string): TrackedIdeaState {
  if (existing.status === 'closed') return existing;
  const symbols = existing.symbols.map((symbol) => {
    const currentPrice = priceMap.get(symbol.symbol) ?? symbol.currentPrice ?? null;
    const returnPct = computeDirectedReturnPct(symbol.direction, symbol.entryPrice, currentPrice);
    return {
      ...symbol,
      currentPrice,
      returnPct,
    };
  });
  const currentReturnPct = computeWeightedIdeaReturn(symbols);
  const updated: TrackedIdeaState = {
    ...existing,
    lastMarkedAt: timestamp,
    symbols,
    staleCycles: existing.staleCycles + 1,
    daysHeld: Number(elapsedDays(existing.openedAt, timestamp).toFixed(2)),
    currentReturnPct,
    bestReturnPct: typeof currentReturnPct === 'number' ? Math.max(existing.bestReturnPct, currentReturnPct) : existing.bestReturnPct,
    worstReturnPct: typeof currentReturnPct === 'number' ? Math.min(existing.worstReturnPct, currentReturnPct) : existing.worstReturnPct,
  };
  return applyTrackedExitRules(updated, timestamp);
}

function updateTrackedIdeas(ideaCards: InvestmentIdeaCard[], markets: MarketData[], timestamp: string): TrackedIdeaState[] {
  const priceMap = marketPriceMap(markets);
  const nextTracked: TrackedIdeaState[] = [];
  const openExistingByKey = new Map(
    trackedIdeas
      .filter((idea) => idea.status === 'open')
      .map((idea) => [idea.ideaKey, idea] as const),
  );
  const currentKeys = new Set(ideaCards.map((idea) => idea.id));

  for (const idea of ideaCards) {
    const existing = openExistingByKey.get(idea.id) ?? null;
    const refreshed = refreshTrackedIdea(idea, existing, priceMap, timestamp);
    nextTracked.push(refreshed);
  }

  for (const existing of trackedIdeas) {
    if (existing.status === 'closed') {
      nextTracked.push(existing);
      continue;
    }
    if (currentKeys.has(existing.ideaKey)) continue;
    nextTracked.push(decayMissingTrackedIdea(existing, priceMap, timestamp));
  }

  const deduped = new Map<string, TrackedIdeaState>();
  for (const idea of nextTracked) {
    const key = idea.trackingId;
    const prev = deduped.get(key);
    if (!prev || Date.parse(idea.lastMarkedAt) >= Date.parse(prev.lastMarkedAt)) {
      deduped.set(key, idea);
    }
  }
  trackedIdeas = Array.from(deduped.values())
    .sort((a, b) => Date.parse(b.lastMarkedAt) - Date.parse(a.lastMarkedAt))
    .slice(0, MAX_TRACKED_IDEAS);
  return trackedIdeas;
}

function updateMappingPerformanceStats(currentIdeas: TrackedIdeaState[]): TrackedIdeaState[] {
  const updatedIdeas = currentIdeas.map((idea) => {
    if (idea.status !== 'closed' || !idea.closedAt || idea.statsCommittedAt) {
      return idea;
    }

    for (const symbol of idea.symbols) {
      const realized = symbol.returnPct;
      if (typeof realized !== 'number' || !Number.isFinite(realized)) continue;
      const key = mappingStatsId(idea.themeId, symbol.symbol, symbol.direction);
      const previous = mappingStats.get(key);
      const alpha = (previous?.alpha ?? 1) * MAPPING_POSTERIOR_DECAY + (realized > 0 ? 1 : 0);
      const beta = (previous?.beta ?? 1) * MAPPING_POSTERIOR_DECAY + (realized > 0 ? 0 : 1);
      const posteriorWinRate = Number(((alpha / Math.max(alpha + beta, 1e-6)) * 100).toFixed(2));
      const emaReturnPct = updateMappingStatEma(previous?.emaReturnPct ?? realized, realized);
      const emaBestReturnPct = updateMappingStatEma(previous?.emaBestReturnPct ?? idea.bestReturnPct, idea.bestReturnPct);
      const emaWorstReturnPct = updateMappingStatEma(previous?.emaWorstReturnPct ?? idea.worstReturnPct, idea.worstReturnPct);
      const emaHoldingDays = updateMappingStatEma(previous?.emaHoldingDays ?? idea.daysHeld, idea.daysHeld);

      mappingStats.set(key, {
        id: key,
        themeId: idea.themeId,
        symbol: symbol.symbol,
        direction: symbol.direction,
        alpha: Number(alpha.toFixed(4)),
        beta: Number(beta.toFixed(4)),
        posteriorWinRate,
        emaReturnPct,
        emaBestReturnPct,
        emaWorstReturnPct,
        emaHoldingDays,
        observations: (previous?.observations ?? 0) + 1,
        lastUpdatedAt: idea.closedAt,
      });

      const reward = clamp(realized / 10, -1, 1);
      if (Array.isArray(symbol.contextVector) && symbol.contextVector.length === BANDIT_DIMENSION) {
        const armId = banditArmId(idea.themeId, symbol.symbol, symbol.direction);
        const updatedArm = updateBanditArm(
          banditStates.get(armId) || createBanditArmState(armId, BANDIT_DIMENSION),
          symbol.contextVector,
          reward,
        );
        banditStates.set(armId, updatedArm);
      }
    }

    return {
      ...idea,
      statsCommittedAt: idea.closedAt,
    };
  });

  trackedIdeas = updatedIdeas;
  return trackedIdeas;
}

function buildEventBacktests(currentIdeas: TrackedIdeaState[]): EventBacktestRow[] {
  const closed = currentIdeas.filter((idea) => idea.status === 'closed' && typeof idea.realizedReturnPct === 'number');
  const openIdeas = currentIdeas.filter((idea) => idea.status === 'open');
  const grouped = new Map<string, TrackedIdeaState[]>();

  for (const idea of closed) {
    for (const symbol of idea.symbols) {
      const key = `${idea.themeId}::${symbol.symbol}::${symbol.direction}`;
      const bucket = grouped.get(key) || [];
      bucket.push(idea);
      grouped.set(key, bucket);
    }
  }

  return Array.from(grouped.entries()).map(([key, bucket]) => {
    const [themeId = 'unknown', symbol = 'unknown', direction = 'watch'] = key.split('::');
    const returns = bucket.map((idea) => idea.realizedReturnPct).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const bests = bucket.map((idea) => idea.bestReturnPct).filter(Number.isFinite);
    const worsts = bucket.map((idea) => idea.worstReturnPct).filter(Number.isFinite);
    const hits = returns.filter((value) => value > 0).length;
    const activeCount = openIdeas.filter((idea) => idea.themeId === themeId && idea.symbols.some((item) => item.symbol === symbol)).length;
    const avgHoldingDays = average(bucket.map((idea) => idea.daysHeld));
    const confidence = clamp(Math.round(Math.min(100, 35 + returns.length * 11 + Math.max(0, average(returns)) * 2)), 20, 99);
    return {
      id: key,
      themeId,
      symbol,
      direction: direction as InvestmentDirection,
      sampleSize: returns.length,
      hitRate: returns.length > 0 ? Math.round((hits / returns.length) * 100) : 0,
      avgReturnPct: Number(average(returns).toFixed(2)),
      avgBestReturnPct: Number(average(bests).toFixed(2)),
      avgWorstReturnPct: Number(average(worsts).toFixed(2)),
      avgHoldingDays: Number(avgHoldingDays.toFixed(2)),
      activeCount,
      confidence,
      notes: [`${returns.length} closed samples`, activeCount > 0 ? `${activeCount} active signals` : 'no active signals'],
    };
  })
    .filter((row) => row.sampleSize > 0)
    .sort((a, b) => b.confidence - a.confidence || b.sampleSize - a.sampleSize)
    .slice(0, 24);
}

function enrichIdeaCards(
  ideaCards: InvestmentIdeaCard[],
  tracked: TrackedIdeaState[],
  backtests: EventBacktestRow[],
): InvestmentIdeaCard[] {
  return ideaCards.map((card) => {
    const trackedMatch = tracked.find((idea) => idea.ideaKey === card.id)
      || tracked.find((idea) => idea.title === card.title);
    const relatedBacktests = backtests.filter((row) =>
      row.themeId === card.themeId || card.symbols.some((symbol) => symbol.symbol === row.symbol),
    );
    const weightedSamples = relatedBacktests.reduce((sum, row) => sum + row.sampleSize, 0);
    const backtestHitRate = weightedSamples > 0
      ? Math.round(relatedBacktests.reduce((sum, row) => sum + row.hitRate * row.sampleSize, 0) / weightedSamples)
      : null;
    const backtestAvgReturnPct = weightedSamples > 0
      ? Number((relatedBacktests.reduce((sum, row) => sum + row.avgReturnPct * row.sampleSize, 0) / weightedSamples).toFixed(2))
      : null;
    const trackingStatus = trackedMatch
      ? trackedMatch.status
      : card.direction === 'watch'
        ? 'watch'
        : 'new';

    return {
      ...card,
      trackingStatus,
      daysHeld: trackedMatch?.daysHeld,
      liveReturnPct: trackedMatch?.status === 'open' ? trackedMatch.currentReturnPct : trackedMatch?.currentReturnPct ?? null,
      realizedReturnPct: trackedMatch?.realizedReturnPct ?? null,
      backtestHitRate,
      backtestAvgReturnPct,
      exitReason: trackedMatch?.exitReason ?? null,
    };
  });
}

function scoreIdeaCardTriage(card: InvestmentIdeaCard): number {
  const convictionScore = card.conviction * 0.42;
  const fpScore = (100 - card.falsePositiveRisk) * 0.26;
  const confirmationScore = card.confirmationScore * 0.18;
  const evidenceScore = Math.min(10, card.evidence.length * 3 + card.triggers.length);
  const transmissionScore = Math.min(10, card.transmissionPath.length * 2);
  const symbolScore = Math.min(8, card.symbols.length * 2);
  const analogScore = Math.min(8, card.analogRefs.length * 3);
  const backtestScore = (card.backtestHitRate != null ? Math.min(10, card.backtestHitRate * 0.14) : 0)
    + (card.backtestAvgReturnPct != null ? Math.min(8, Math.max(0, card.backtestAvgReturnPct) * 1.6) : 0);
  const calibrationScore = card.calibratedConfidence * 0.12;
  const realityScore = card.realityScore * 0.08;
  const recencyScore = card.recentEvidenceScore * 0.06;
  const coveragePenalty = card.coveragePenalty * 0.18;
  const directionPenalty = card.direction === 'watch' ? 10 : 0;
  const lowEvidencePenalty = card.evidence.length <= 1 && card.triggers.length <= 1 ? 8 : 0;
  const veryHighFpPenalty = card.falsePositiveRisk >= 82 ? 14 : 0;
  const autonomyPenalty = card.autonomyAction === 'abstain'
    ? 30
    : card.autonomyAction === 'shadow'
      ? 12
      : card.autonomyAction === 'watch'
        ? 8
        : 0;
  return clamp(
    Math.round(
      convictionScore
      + fpScore
      + evidenceScore
      + transmissionScore
      + symbolScore
      + analogScore
      + backtestScore
      + calibrationScore
      + realityScore
      + confirmationScore
      + recencyScore
      - coveragePenalty
      - directionPenalty
      - lowEvidencePenalty
      - veryHighFpPenalty
      - autonomyPenalty
    ),
    0,
    100,
  );
}

function autoTriageIdeaCards(ideaCards: InvestmentIdeaCard[]): { kept: InvestmentIdeaCard[]; suppressedCount: number } {
  const scored = ideaCards.map((card) => ({ card, score: scoreIdeaCardTriage(card) }))
    .sort((a, b) => b.score - a.score || b.card.conviction - a.card.conviction || a.card.falsePositiveRisk - b.card.falsePositiveRisk);
  const scoreValues = scored.map((item) => item.score);
  const confidenceValues = ideaCards.map((card) => card.calibratedConfidence);
  const realityValues = ideaCards.map((card) => card.realityScore);
  const directionalFloor = clamp(Math.round(percentile(scoreValues, 0.45) || 44), 36, 56);
  const watchFloor = clamp(directionalFloor + 10, 48, 66);
  const shadowConfidenceFloor = clamp(Math.round(percentile(confidenceValues, 0.35) || 52), 44, 62);
  const shadowRealityFloor = clamp(Math.round(percentile(realityValues, 0.35) || 45), 38, 58);
  const kept = scored.filter(({ card, score }) => {
    if (card.autonomyAction === 'abstain') return false;
    if (!card.executionGate && card.direction !== 'watch') return false;
    if (card.direction !== 'watch' && score >= directionalFloor) return true;
    if (card.direction === 'watch' && score >= watchFloor) return true;
    if ((card.backtestHitRate || 0) >= 58 && (card.backtestAvgReturnPct || 0) > 0.4) return true;
    if (card.autonomyAction === 'shadow' && card.calibratedConfidence >= shadowConfidenceFloor && card.realityScore >= shadowRealityFloor) return true;
    return false;
  }).map(({ card }) => card);
  if (kept.length === 0 && scored.length > 0) {
    const fallback = scored
      .filter(({ card }) => card.autonomyAction !== 'abstain' && (card.executionGate || card.direction === 'watch'))
      .slice(0, Math.min(2, scored.length))
      .map(({ card }) => card);
    return {
      kept: fallback,
      suppressedCount: Math.max(0, scored.length - fallback.length),
    };
  }
  return {
    kept,
    suppressedCount: Math.max(0, scored.length - kept.length),
  };
}

function buildIdeaCards(
  mappings: DirectAssetMapping[],
  analogs: HistoricalAnalog[],
  macroOverlay: MacroRiskOverlay,
  replayAdaptation: ReplayAdaptationSnapshot | null,
): InvestmentIdeaCard[] {
  const grouped = new Map<string, DirectAssetMapping[]>();
  for (const mapping of mappings) {
    const key = `${mapping.themeId}::${mapping.region}`;
    const bucket = grouped.get(key) || [];
    bucket.push(mapping);
    grouped.set(key, bucket);
  }

  const cards: InvestmentIdeaCard[] = [];
  for (const [key, bucket] of grouped.entries()) {
    const primary = bucket.filter((item) => item.direction === 'long' || item.direction === 'short');
    const hedges = bucket.filter((item) => item.direction === 'hedge');
    const hedgeOnly = primary.length === 0 && hedges.length > 0;
    const dominantDirection: InvestmentDirection = primary.length === 0
      ? 'watch'
      : primary.filter((item) => item.direction === 'long').length >= primary.filter((item) => item.direction === 'short').length
        ? 'long'
        : 'short';
    const conviction = clamp(Math.round(average(primary.length > 0 ? primary.map((item) => item.conviction) : bucket.map((item) => item.conviction))), 10, 99);
    const falsePositiveRisk = clamp(Math.round(average(bucket.map((item) => item.falsePositiveRisk))), 5, 95);
    const rule = applyAtrAdjustedRule(
      chooseSizingRule(
        conviction,
        falsePositiveRisk,
        dominantDirection === 'watch' ? 'hedge' : dominantDirection,
      ),
      [
        ...primary.slice(0, 3).map((item): InvestmentIdeaSymbol => ({
          symbol: item.symbol,
          name: item.assetName,
          role: item.role === 'hedge' ? 'hedge' : item.role,
          direction: item.direction,
          sector: item.sector,
        })),
        ...hedges.slice(0, 2).map((item): InvestmentIdeaSymbol => ({
          symbol: item.symbol,
          name: item.assetName,
          role: 'hedge',
          direction: item.direction,
          sector: item.sector,
        })),
      ],
    );
    const symbolStats = bucket
      .map((item) => getMappingStats(item.themeId, item.symbol, item.direction))
      .filter((item): item is MappingPerformanceStats => Boolean(item));
    const avgPosterior = symbolStats.length > 0 ? average(symbolStats.map((item) => item.posteriorWinRate)) : 50;
    const avgReturn = symbolStats.length > 0 ? average(symbolStats.map((item) => item.emaReturnPct)) : 0;
    const edgeAdj = clamp(0.75 + Math.max(0, avgPosterior - 50) / 80 + Math.max(0, avgReturn) / 14, 0.55, 1.35);
    const rawSizePct = clamp(rule.maxPositionPct * (conviction / 100) * (1 - falsePositiveRisk / 125) * edgeAdj, 0.15, rule.maxPositionPct);
    const lead = bucket[0]!;
    const theme = getThemeRule(lead.themeId);
    const relatedAnalogs = analogs
      .filter((analog) => analog.themes.some((item) => item === lead.themeId || item === normalize(lead.themeLabel)))
      .slice(0, 3)
      .map((analog) => analog.label);
    const calibratedConfidence = clamp(Math.round(average(bucket.map((item) => item.calibratedConfidence))), 0, 99);
    const realityScore = clamp(Math.round(average(bucket.map((item) => item.realityScore))), 0, 99);
    const graphSignalScore = clamp(Math.round(average(bucket.map((item) => item.graphSignalScore))), 0, 99);
    const recentEvidenceScore = clamp(Math.round(average(bucket.map((item) => item.recentEvidenceScore))), 0, 99);
    const confirmationScore = clamp(Math.round(average(bucket.map((item) => item.confirmationScore))), 0, 100);
    const confirmationState = confirmationStateFromScore(confirmationScore);
    const coveragePenalty = clamp(Math.round(average(bucket.map((item) => item.coveragePenalty))), 0, 100);
    const sizeMultiplier = Number(average(bucket.map((item) => item.sizeMultiplier)).toFixed(4));
    const horizonMultiplier = Number(average(bucket.map((item) => item.horizonMultiplier)).toFixed(4));
    const executionGate = bucket.some((item) => item.executionGate);
    const timeDecayWeight = Number(average(bucket.map((item) => item.timeDecayWeight)).toFixed(4));
    const contradictionPenalty = average(bucket.map((item) => item.contradictionPenalty));
    const eventIntensity = average(bucket.map((item) => item.eventIntensity));
    const actionCounts = bucket.reduce<Record<AutonomyAction, number>>((acc, item) => {
      acc[item.autonomyAction] += 1;
      return acc;
    }, { deploy: 0, shadow: 0, watch: 0, abstain: 0 });
    const abstainFloor = clamp(
      Math.round(
        30
        + Math.max(0, 44 - recentEvidenceScore) * 0.14
        + Math.max(0, 46 - realityScore) * 0.12
        + contradictionPenalty * 0.18
        - Math.max(0, eventIntensity - 50) * 0.08,
      ),
      20,
      42,
    );
    const shadowFloor = clamp(
      Math.round(
        52
        + Math.max(0, 52 - recentEvidenceScore) * 0.12
        + contradictionPenalty * 0.16
        - Math.max(0, graphSignalScore - 52) * 0.08
        - Math.max(0, eventIntensity - 50) * 0.05,
      ),
      42,
      64,
    );
    const watchFloor = clamp(
      Math.round(
        68
        + Math.max(0, 50 - recentEvidenceScore) * 0.08
        + contradictionPenalty * 0.1
        - Math.max(0, graphSignalScore - 55) * 0.06,
      ),
      54,
      78,
    );
    let autonomyAction: AutonomyAction = actionCounts.abstain >= Math.ceil(bucket.length / 2) || calibratedConfidence < abstainFloor
      ? 'abstain'
      : actionCounts.shadow > 0 || calibratedConfidence < shadowFloor || contradictionPenalty >= 12
        ? 'shadow'
        : actionCounts.watch > 0 || calibratedConfidence < watchFloor
          ? 'watch'
          : 'deploy';
    if (!executionGate || confirmationState === 'contradicted') {
      autonomyAction = 'abstain';
    } else if (confirmationState === 'fading' && autonomyAction === 'deploy') {
      autonomyAction = 'shadow';
    } else if (confirmationState === 'tentative' && autonomyAction === 'deploy') {
      autonomyAction = 'shadow';
    }
    if (macroOverlay.killSwitch && !hedgeOnly) {
      autonomyAction = calibratedConfidence >= 70 && dominantDirection === 'watch' ? 'watch' : 'abstain';
    } else if (
      macroOverlay.state === 'risk-off'
      && !hedgeOnly
      && autonomyAction === 'deploy'
      && calibratedConfidence < watchFloor + 6
    ) {
      autonomyAction = 'shadow';
    }
    const confidenceBand: ConfidenceBand = calibratedConfidence >= 78
      ? 'high'
      : calibratedConfidence >= 62
        ? 'building'
        : calibratedConfidence >= 44
          ? 'guarded'
          : 'low';
    const sizeCap = autonomyAction === 'deploy'
      ? 1
      : autonomyAction === 'shadow'
        ? 0.35
        : autonomyAction === 'watch'
          ? 0.18
          : 0;
    const macroSizeMultiplier = macroOverlay.killSwitch
      ? 0
      : macroOverlay.state === 'risk-off'
        ? (hedgeOnly ? 1.25 : 0.45)
        : macroOverlay.state === 'balanced'
          ? 0.82
          : 1;
    const sizePct = Number((rawSizePct * sizeCap * macroSizeMultiplier).toFixed(2));
    const autonomyReasons = Array.from(new Set([
      ...bucket.flatMap((item) => item.autonomyReasons),
      ...(macroOverlay.killSwitch && !hedgeOnly
        ? ['Macro kill switch blocked net directional deployment.']
        : macroOverlay.state === 'risk-off' && !hedgeOnly
          ? ['Macro risk-off overlay cut directional sizing and forced shadow mode.']
          : []),
    ])).slice(0, 4);
    const attribution = mergeAttributionBreakdown(
      lead.attribution,
      bucket.map((item) => item.attribution),
    );
    const replayThemeProfile = getReplayThemeProfileFromSnapshot(replayAdaptation, lead.themeId);
    const currentThemePerformance = getCurrentThemePerformanceFromSnapshot(replayAdaptation, lead.themeId);
    const baseHorizonLearning = scaleHorizonLearning(
      resolveIdeaCardHorizonLearning(
        lead.themeId,
        theme?.timeframe || '1d-7d',
        replayAdaptation,
      ),
      horizonMultiplier,
    );
    const halfLifePolicy = estimateRegimeConditionalHalfLifePolicy({
      learning: baseHorizonLearning,
      replayProfile: replayThemeProfile,
      currentPerformance: currentThemePerformance,
      referenceTimestamp: nowIso(),
      macroOverlay,
      coveragePenalty,
      marketConfirmation: Math.round(average(bucket.map((item) => marketConfirmationScore(item.direction, item.marketMovePct)))),
    });
    const horizonLearning = applyHalfLifePolicyToLearning(baseHorizonLearning, halfLifePolicy);
    const cardAutonomyReasons = halfLifePolicy.multiplier < 0.98 && halfLifePolicy.halfLifeHours
      ? Array.from(new Set([
        ...autonomyReasons,
        `Half-life policy compressed horizon toward ~${halfLifePolicy.halfLifeHours}h (rho=${halfLifePolicy.rho?.toFixed(2) ?? 'n/a'}).`,
      ])).slice(0, 6)
      : autonomyReasons;

    cards.push({
      id: key,
      title: `${lead.themeLabel} | ${lead.region}`,
      themeId: lead.themeId,
      direction: dominantDirection,
      conviction,
      falsePositiveRisk,
      sizePct: Math.round(sizePct * sizeMultiplier * Math.max(0, 1 - coveragePenalty / 140) * 100) / 100,
      timeframe: horizonLearning.timeframe,
      thesis: theme?.thesis || lead.reasons[0] || 'Event-to-asset transmission detected.',
      calibratedConfidence,
      confidenceBand,
      autonomyAction,
      autonomyReasons: cardAutonomyReasons,
      realityScore,
      graphSignalScore,
      timeDecayWeight,
      recentEvidenceScore,
      confirmationScore,
      confirmationState,
      sizeMultiplier,
      horizonMultiplier,
      executionGate,
      coveragePenalty,
      attribution,
      symbols: dedupeIdeaSymbols([
        ...primary.slice(0, 3).map((item): InvestmentIdeaSymbol => ({
          symbol: item.symbol,
          name: item.assetName,
          role: item.role === 'hedge' ? 'hedge' : item.role,
          direction: item.direction,
          sector: item.sector,
          assetKind: item.assetKind,
          liquidityScore: item.liquidityScore,
          realityScore: item.realityScore,
          contextVector: buildBanditContext({
            credibility: item.corroboration,
            corroboration: item.corroborationQuality,
            marketStress: Math.max(0, Math.min(1, (item.marketMovePct ?? 0) / 10)),
            aftershockIntensity: item.aftershockIntensity ?? 0,
            regimeMultiplier: item.regimeMultiplier ?? 1,
            transferEntropy: item.transferEntropy ?? 0,
            posteriorWinRate: getMappingStats(item.themeId, item.symbol, item.direction)?.posteriorWinRate ?? 50,
            emaReturnPct: getMappingStats(item.themeId, item.symbol, item.direction)?.emaReturnPct ?? 0,
          }),
          banditScore: item.banditScore ?? null,
        })),
        ...hedges.slice(0, 2).map((item): InvestmentIdeaSymbol => ({
          symbol: item.symbol,
          name: item.assetName,
          role: 'hedge' as const,
          direction: item.direction,
          sector: item.sector,
          assetKind: item.assetKind,
          liquidityScore: item.liquidityScore,
          realityScore: item.realityScore,
          contextVector: buildBanditContext({
            credibility: item.corroboration,
            corroboration: item.corroborationQuality,
            marketStress: Math.max(0, Math.min(1, (item.marketMovePct ?? 0) / 10)),
            aftershockIntensity: item.aftershockIntensity ?? 0,
            regimeMultiplier: item.regimeMultiplier ?? 1,
            transferEntropy: item.transferEntropy ?? 0,
            posteriorWinRate: getMappingStats(item.themeId, item.symbol, item.direction)?.posteriorWinRate ?? 50,
            emaReturnPct: getMappingStats(item.themeId, item.symbol, item.direction)?.emaReturnPct ?? 0,
          }),
          banditScore: item.banditScore ?? null,
        })),
      ]).slice(0, 4),
      triggers: Array.from(new Set(bucket.flatMap((item) => item.reasons))).slice(0, 4),
      invalidation: theme?.invalidation.slice(0, 3) || ['Transmission path weakens', 'Cross-asset confirmation disappears'],
      evidence: Array.from(new Set(bucket.map((item) => item.eventTitle))).slice(0, 3),
      transmissionPath: Array.from(new Set(bucket.flatMap((item) => item.transmissionPath))).slice(0, 5),
      sectorExposure: Array.from(new Set(bucket.map((item) => item.sector))).slice(0, 4),
      analogRefs: relatedAnalogs,
      preferredHorizonHours: horizonLearning.preferredHorizonHours,
      horizonCandidatesHours: horizonLearning.horizonCandidatesHours,
      horizonLearningConfidence: horizonLearning.horizonLearningConfidence,
      timeframeSource: horizonLearning.timeframeSource,
    });
  }

  return cards
    .sort((a, b) => b.conviction - a.conviction || a.falsePositiveRisk - b.falsePositiveRisk)
    .slice(0, MAX_IDEAS);
}

function createCurrentHistoryEntries(
  ideaCards: InvestmentIdeaCard[],
  mappings: DirectAssetMapping[],
  timestamp: string,
): InvestmentHistoryEntry[] {
  return ideaCards.slice(0, 8).map((card) => {
    const cardMappings = mappings.filter((mapping) => mapping.themeId === card.themeId && card.title.includes(mapping.region));
    const moves = cardMappings.map((item) => item.marketMovePct).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return {
      id: uniqueId(card.id),
      timestamp,
      label: card.title,
      themes: [card.themeId, normalize(card.title)],
      regions: cardMappings.map((item) => item.region).filter(Boolean).slice(0, 3),
      symbols: card.symbols.map((symbol) => symbol.symbol),
      avgMovePct: average(moves),
      bestMovePct: moves.length > 0 ? Math.max(...moves.map((value) => Math.abs(value))) : 0,
      conviction: card.conviction,
      falsePositiveRisk: card.falsePositiveRisk,
      direction: card.direction,
      summary: card.thesis,
    };
  });
}

function scoreAnalog(entry: InvestmentHistoryEntry, currentThemes: string[], currentSymbols: string[], currentRegions: string[], currentDirection: InvestmentDirection): number {
  const themeOverlap = currentThemes.length > 0
    ? entry.themes.filter((theme) => currentThemes.includes(theme)).length / currentThemes.length
    : 0;
  const symbolOverlap = currentSymbols.length > 0
    ? entry.symbols.filter((symbol) => currentSymbols.includes(symbol)).length / currentSymbols.length
    : 0;
  const regionOverlap = currentRegions.length > 0
    ? entry.regions.filter((region) => currentRegions.includes(region)).length / currentRegions.length
    : 0;
  const directionBonus = entry.direction === currentDirection ? 0.12 : entry.direction === 'hedge' ? 0.06 : 0;
  return clamp(Math.round((themeOverlap * 0.56 + symbolOverlap * 0.18 + regionOverlap * 0.14 + directionBonus) * 100), 0, 100);
}

function buildHistoricalAnalogs(args: {
  history: InvestmentHistoryEntry[];
  ideaCards: InvestmentIdeaCard[];
}): HistoricalAnalog[] {
  const themeSet = Array.from(new Set(args.ideaCards.flatMap((card) => [card.themeId, normalize(card.title)])));
  const symbolSet = Array.from(new Set(args.ideaCards.flatMap((card) => card.symbols.map((symbol) => symbol.symbol))));
  const regionSet = Array.from(new Set(args.ideaCards.map((card) => card.title.split('|')[1]?.trim()).filter(Boolean) as string[]));
  const direction = args.ideaCards[0]?.direction || 'watch';

  const scored = args.history
    .map((entry) => ({ entry, similarity: scoreAnalog(entry, themeSet, symbolSet, regionSet, direction) }))
    .filter((item) => item.similarity >= 28)
    .sort((a, b) => b.similarity - a.similarity || Date.parse(b.entry.timestamp) - Date.parse(a.entry.timestamp));

  return scored.slice(0, MAX_ANALOGS).map(({ entry, similarity }) => {
    const siblings = args.history.filter((item) => item.label === entry.label || item.themes.some((theme) => entry.themes.includes(theme)));
    const positive = siblings.filter((item) => item.avgMovePct >= 0).length;
    return {
      id: entry.id,
      label: entry.label,
      timestamp: entry.timestamp,
      similarity,
      sampleSize: siblings.length,
      avgMovePct: Number(average(siblings.map((item) => item.avgMovePct)).toFixed(2)),
      winRate: siblings.length > 0 ? Math.round((positive / siblings.length) * 100) : 0,
      maxDrawdownPct: Number((Math.min(...siblings.map((item) => item.avgMovePct), 0)).toFixed(2)),
      summary: entry.summary,
      symbols: entry.symbols.slice(0, 6),
      themes: entry.themes.slice(0, 6),
    };
  });
}

function buildWorkflow(snapshot: {
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
  const openTracked = snapshot.trackedIdeas.filter((idea) => idea.status === 'open').length;
  const closedTracked = snapshot.trackedIdeas.filter((idea) => idea.status === 'closed').length;
  return buildReplayDrivenWorkflow(snapshot.replayAdaptation, {
    detectCount: snapshot.falsePositive.kept,
    mappingCount: snapshot.mappings.length,
    ideaCount: snapshot.ideaCards.length,
    trackedOpen: openTracked,
    trackedClosed: closedTracked,
  });
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
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
    ...snapshot.directMappings.map((mapping) => mapping.themeId),
    ...snapshot.ideaCards.map((card) => card.themeId),
    ...(replayAdaptation?.themeProfiles || []).map((profile) => profile.themeId),
    ...(replayAdaptation?.currentThemePerformance || []).map((metric) => metric.themeId),
  ].filter(Boolean)));

  const rows = themeIds.map((themeId) => {
    const themeMappings = snapshot.directMappings.filter((mapping) => normalize(mapping.themeId) === normalize(themeId));
    const themeCards = snapshot.ideaCards.filter((card) => normalize(card.themeId) === normalize(themeId));
    const themeLabel = resolveThemeLabelFor(themeId, snapshot.directMappings, snapshot.ideaCards);
    const coverage = getCoveragePenaltyForTheme(snapshot.coverageLedger || replayAdaptation?.coverageLedger || null, themeId);
    const replayProfile = getReplayThemeProfileFromSnapshot(replayAdaptation, themeId);
    const currentPerformance = getCurrentThemePerformanceFromSnapshot(replayAdaptation, themeId);
    const mappingConfirmation = themeMappings.length > 0
      ? average(themeMappings.map((mapping) => mapping.confirmationScore))
      : 0;
    const cardConfirmation = themeCards.length > 0
      ? average(themeCards.map((card) => card.confirmationScore))
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
        + (themeCards.some((card) => card.executionGate) ? 8 : 0)
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
      !themeCards.some((card) => card.executionGate) ? 'No executable idea card is currently cleared for this theme.' : '',
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
      executionGate: themeCards.some((card) => card.executionGate),
      sizeMultiplier: Number(average(themeCards.map((card) => card.sizeMultiplier || 0)).toFixed(4)) || 0,
      horizonMultiplier: Number(average(themeCards.map((card) => card.horizonMultiplier || 0)).toFixed(4)) || 0,
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
    .filter((row) => row.themeId === card.themeId && (!symbols.length || symbols.includes(row.symbol)))
    .sort((a, b) => b.confidence - a.confidence || b.avgReturnPct - a.avgReturnPct)
    .slice(0, 3);
  const replayAvgReturnPct = matchingBacktests.length > 0
    ? Number(average(matchingBacktests.map((row) => row.avgReturnPct)).toFixed(2))
    : themeRow?.replayAvgReturnPct ?? card.backtestAvgReturnPct ?? null;
  const replayHitRate = matchingBacktests.length > 0
    ? Number(average(matchingBacktests.map((row) => row.hitRate)).toFixed(2))
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
  const diagnosticByTheme = new Map(diagnostics.rows.map((row) => [normalize(row.themeId), row]));
  const explanationRows = snapshot.ideaCards
    .slice()
    .sort((left, right) => right.confirmationScore - left.confirmationScore || right.sizePct - left.sizePct)
    .map((card) => ({
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
    .filter((row) => row.explanation.status === 'recommended')
    .sort((left, right) =>
      right.card.confirmationScore - left.card.confirmationScore
      || right.card.sizePct - left.card.sizePct
      || (right.themeRow?.currentAvgReturnPct ?? 0) - (left.themeRow?.currentAvgReturnPct ?? 0)
    )
    .slice(0, 3)
    .map((row) => buildCurrentDecisionSupportItem({
      bucket: 'act-now',
      card: row.card,
      explanation: row.explanation,
      themeRow: row.themeRow,
      snapshot,
    }));

  let defensive = explanationRows
    .filter((row) =>
      row.card.direction === 'hedge'
      || row.card.themeId === 'safe-haven-repricing'
      || row.card.symbols.some((symbol) => symbol.role === 'hedge'),
    )
    .sort((left, right) =>
      (right.themeRow?.currentAvgReturnPct ?? 0) - (left.themeRow?.currentAvgReturnPct ?? 0)
      || right.card.confirmationScore - left.card.confirmationScore
    )
    .slice(0, 3)
    .map((row) => buildCurrentDecisionSupportItem({
      bucket: 'defensive',
      card: row.card,
      explanation: row.explanation,
      themeRow: row.themeRow,
      snapshot,
    }));

  if (!defensive.length) {
    defensive = snapshot.macroOverlay.hedgeBias.slice(0, 3).map((hedge) => ({
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
    .filter((row) =>
      row.explanation.status === 'abstained'
      || row.explanation.status === 'suppressed'
      || (row.themeRow?.currentVsReplayDrift ?? 0) <= -1.5
      || (row.themeRow?.currentAvgReturnPct ?? 0) <= -1,
    )
    .sort((left, right) =>
      (left.themeRow?.currentAvgReturnPct ?? 0) - (right.themeRow?.currentAvgReturnPct ?? 0)
      || (left.themeRow?.currentVsReplayDrift ?? 0) - (right.themeRow?.currentVsReplayDrift ?? 0)
    )
    .slice(0, 3)
    .map((row) => buildCurrentDecisionSupportItem({
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
    .filter((row) => row.explanation.status === 'watch' || row.explanation.status === 'suppressed')
    .filter((row) => !avoid.some((item) => item.cardId === row.card.id))
    .sort((left, right) =>
      right.card.recentEvidenceScore - left.card.recentEvidenceScore
      || right.card.confirmationScore - left.card.confirmationScore
    )
    .slice(0, 3)
    .map((row) => buildCurrentDecisionSupportItem({
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
    ? average(diagnostics.rows.map((row) => row.diagnosticScore))
    : 0;
  const avgThemeDrift = diagnostics.rows.length > 0
    ? average(diagnostics.rows.map((row) => Math.abs(row.currentVsReplayDrift)))
    : 0;
  const avgCoveragePenalty = diagnostics.rows.length > 0
    ? average(diagnostics.rows.map((row) => row.coveragePenalty))
    : 0;
  const avgSizeMultiplier = snapshot.ideaCards.length > 0
    ? average(snapshot.ideaCards.map((card) => card.sizeMultiplier))
    : 0;
  const avgHorizonConfidence = snapshot.ideaCards.length > 0
    ? average(snapshot.ideaCards.map((card) => card.horizonLearningConfidence ?? 0))
    : 0;

  const stages: WorkflowDropoffStageSummary[] = snapshot.workflow.map((step) => {
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
        keptCount = snapshot.ideaCards.filter((card) => card.autonomyAction !== 'abstain').length;
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
        keptCount = snapshot.directMappings.filter((item) => item.tradableNow && item.realityScore >= 42).length;
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

function mergeHistory(entries: InvestmentHistoryEntry[], additions: InvestmentHistoryEntry[]): InvestmentHistoryEntry[] {
  const merged = new Map<string, InvestmentHistoryEntry>();
  for (const entry of [...additions, ...entries]) {
    if (!entry.id) continue;
    merged.set(entry.id, entry);
  }
  return Array.from(merged.values())
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, MAX_HISTORY);
}

function buildDatasetThemeInputs(
  candidates: EventCandidate[],
  ideas: InvestmentIdeaCard[],
  coverageGaps: UniverseCoverageGap[],
): DatasetDiscoveryThemeInput[] {
  const themeMap = new Map<string, DatasetDiscoveryThemeInput>();
  for (const card of ideas) {
    const theme = getThemeRule(card.themeId);
    const gaps = coverageGaps.filter((gap) => gap.themeId === card.themeId);
    themeMap.set(card.themeId, {
      themeId: card.themeId,
      label: card.title.split('|')[0]?.trim() || theme?.label || card.themeId,
      triggers: theme?.triggers.slice(0, 8) || [],
      sectors: Array.from(new Set([
        ...(theme?.sectors || []),
        ...card.sectorExposure,
        ...gaps.flatMap((gap) => gap.missingSectors),
      ])).slice(0, 8),
      commodities: theme?.commodities.slice(0, 6) || [],
      supportingHeadlines: candidates
        .filter((candidate) => findMatchingThemes(candidate).some((row) => row.id === card.themeId))
        .map((candidate) => candidate.title)
        .slice(0, 4),
      suggestedSymbols: Array.from(new Set([
        ...card.symbols.map((symbol) => symbol.symbol),
        ...gaps.flatMap((gap) => gap.suggestedSymbols),
      ])).slice(0, 8),
      priority: clamp(Math.round(card.calibratedConfidence + card.graphSignalScore * 0.18 + Math.max(0, 68 - card.falsePositiveRisk) * 0.14), 35, 96),
    });
  }
  return Array.from(themeMap.values()).slice(0, 8);
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
}): Promise<InvestmentIntelligenceSnapshot> {
  await ensureLoaded();
  const timestamp = args.timestamp || nowIso();
  const context = args.context || 'live';
  appendMarketHistory(args.markets, timestamp);
  const shadowControl = buildShadowControlState(trackedIdeas, timestamp);
  const weightProfile = getActiveWeightProfileSync();
  const replayAdaptation = args.replayAdaptation === undefined
    ? await getReplayAdaptationSnapshot()
    : args.replayAdaptation;
  const macroOverlay = buildMacroRiskOverlay({
    regime: args.transmission?.regime ?? null,
    markets: args.markets,
    clusters: args.clusters,
    weightProfile,
  });
  const rollingBacktests = buildEventBacktests(trackedIdeas);
  const rollingThemePerformance = buildRollingThemePerformanceMetrics(trackedIdeas, rollingBacktests, timestamp);

  const { kept, falsePositive } = buildEventCandidates({
    clusters: args.clusters,
    transmission: args.transmission,
    sourceCredibility: args.sourceCredibility,
  });
  const effectiveThemes = Array.from(new Set(kept.flatMap((candidate) => findMatchingThemes(candidate))))
    .map((theme) => ({
      id: theme.id,
      label: theme.label,
      triggers: theme.triggers.slice(),
      sectors: theme.sectors.slice(),
      commodities: theme.commodities.slice(),
    }));
  const hiddenCandidates = discoverHiddenGraphCandidates({
    themes: effectiveThemes,
    candidates: kept.map((candidate) => ({
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

  const rawMappings = buildDirectMappings({
    candidates: kept,
    markets: args.markets,
    transmission: args.transmission,
    timestamp,
    autonomy: shadowControl,
    keywordGraph: args.keywordGraph ?? null,
    weightProfile,
    macroOverlay,
  });
  const provisionalCoverageLedger = buildCoverageLedgerFromMappings(rawMappings);
  const mappings = applyAdaptiveConfirmationLayer(rawMappings, replayAdaptation, provisionalCoverageLedger, {
    context,
    referenceTimestamp: timestamp,
    currentThemePerformance: rollingThemePerformance,
  });
  const coverageLedger = buildCoverageLedgerFromMappings(mappings);
  const preIdeaCards = buildIdeaCards(mappings, [], macroOverlay, replayAdaptation);
  currentHistory = mergeHistory(currentHistory, parseReportHistory(args.reports));
  const analogs = buildHistoricalAnalogs({ history: currentHistory, ideaCards: preIdeaCards });
  currentHistory = mergeHistory(currentHistory, createCurrentHistoryEntries(preIdeaCards, mappings, timestamp));
  const baseIdeaCards = buildIdeaCards(mappings, analogs, macroOverlay, replayAdaptation);
  const executionControlledIdeaCards = applyPortfolioExecutionControls(baseIdeaCards, macroOverlay);
  const tracked = updateMappingPerformanceStats(updateTrackedIdeas(executionControlledIdeaCards, args.markets, timestamp));
  const backtests = buildEventBacktests(tracked);
  const updatedReplayAdaptation = args.recordCurrentThemePerformance === false
    ? replayAdaptation
    : await recordCurrentThemePerformance(
      buildCurrentThemePerformanceMetrics(mappings, tracked, backtests),
    );
  const reviews = evaluateCandidateReviewProbation({
    reviews: applyUniverseExpansionPolicy(buildCandidateExpansionReviews({ candidates: kept, markets: args.markets }), universeExpansionPolicy),
    activeCandidates: kept,
    mappings,
    backtests,
    policy: universeExpansionPolicy,
  });
  candidateReviews = new Map(reviews.map((review) => [review.id, review] as const));
  const sensitivity = buildSensitivityRows(mappings, backtests, tracked);
  const enrichedIdeaCards = enrichIdeaCards(executionControlledIdeaCards, tracked, backtests);
  const ideaTriage = autoTriageIdeaCards(enrichedIdeaCards);
  const ideaCards = ideaTriage.kept;
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
      mode: universeExpansionPolicy.mode,
      maxRegistrationsPerCycle: 2,
      maxEnabledDatasets: 12,
    },
  });
  const experimentRegistry = getExperimentRegistrySnapshot();
  const topThemes = Array.from(new Set(ideaCards.map((card) => card.title))).slice(0, 8);
  const openTracked = tracked.filter((idea) => idea.status === 'open').length;
  const closedTracked = tracked.filter((idea) => idea.status === 'closed').length;
  const learnedMappings = Array.from(mappingStats.values()).filter((entry) => entry.observations > 0).length;

  currentSnapshot = {
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
    universePolicy: universeExpansionPolicy,
    universeCoverage,
    coverageGaps,
    candidateReviews: reviews,
    autonomy,
    hiddenCandidates,
    experimentRegistry,
    datasetAutonomy: {
      mode: universeExpansionPolicy.mode,
      proposals: datasetProposals,
    },
    coverageLedger,
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
      `Universe policy=${universeExpansionPolicy.mode} scoreThreshold=${universeExpansionPolicy.minAutoApproveScore} codexFloor=${universeExpansionPolicy.minCodexConfidence} requireMarketData=${universeExpansionPolicy.requireMarketData ? 'yes' : 'no'} sectorCap=${universeExpansionPolicy.maxAutoApprovalsPerSectorPerTheme} kindCap=${universeExpansionPolicy.maxAutoApprovalsPerAssetKindPerTheme}.`,
      `${hiddenCandidates.length} hidden graph candidates are currently being tracked and ${datasetProposals.length} dataset proposals are queued for guarded registration.`,
      `Self-tuning profile: ${summarizeWeightProfile(experimentRegistry.activeProfile).join(', ')}.`,
      `${analogs.length} analog checkpoints and ${workflow.filter((step) => step.status === 'ready').length} ready workflow stages available.`,
      `Regime=${args.transmission?.regime?.label || 'unknown'} confidence=${args.transmission?.regime?.confidence ?? 0}.`,
    ],
  };

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

  return currentSnapshot;
}

export async function getInvestmentIntelligenceSnapshot(): Promise<InvestmentIntelligenceSnapshot | null> {
  await ensureLoaded();
  return currentSnapshot;
}

export async function getUniverseExpansionPolicy(): Promise<UniverseExpansionPolicy> {
  await ensureLoaded();
  return { ...universeExpansionPolicy };
}

export async function setUniverseExpansionPolicyMode(mode: UniverseExpansionMode): Promise<UniverseExpansionPolicy> {
  await ensureLoaded();
  universeExpansionPolicy = normalizeUniverseExpansionPolicy({
    ...universeExpansionPolicy,
    mode,
  });
  if (currentSnapshot) {
    currentSnapshot = {
      ...currentSnapshot,
      universePolicy: { ...universeExpansionPolicy },
    };
  }
  await persist();
  return { ...universeExpansionPolicy };
}

function syncSnapshotReviewState(): void {
  if (!currentSnapshot) return;
  const reviews = Array.from(candidateReviews.values())
    .sort((a, b) => {
      const statusRank = (value: CandidateExpansionReview['status']): number => (value === 'open' ? 0 : value === 'accepted' ? 1 : 2);
      return statusRank(a.status) - statusRank(b.status)
        || b.confidence - a.confidence
        || Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt);
    })
    .slice(0, MAX_CANDIDATE_REVIEWS);
  currentSnapshot = {
    ...currentSnapshot,
    universePolicy: { ...universeExpansionPolicy },
    candidateReviews: reviews,
    universeCoverage: {
      ...currentSnapshot.universeCoverage,
      dynamicApprovedCount: reviews.filter((review) => review.status === 'accepted').length,
      openReviewCount: reviews.filter((review) => review.status === 'open').length,
    },
    summaryLines: [
      ...currentSnapshot.summaryLines.filter((line) =>
        !/^\d+ approved expansion candidates, /i.test(line)
        && !/^Universe policy=/i.test(line),
      ),
      `${reviews.filter((review) => review.status === 'accepted').length} approved expansion candidates, ${reviews.filter((review) => review.status === 'open').length} open review items, and ${currentSnapshot.coverageGaps.length} current coverage gaps tracked.`,
      `Universe policy=${universeExpansionPolicy.mode} scoreThreshold=${universeExpansionPolicy.minAutoApproveScore} codexFloor=${universeExpansionPolicy.minCodexConfidence} requireMarketData=${universeExpansionPolicy.requireMarketData ? 'yes' : 'no'} sectorCap=${universeExpansionPolicy.maxAutoApprovalsPerSectorPerTheme} kindCap=${universeExpansionPolicy.maxAutoApprovalsPerAssetKindPerTheme}.`,
    ],
  };
}

export async function listCandidateExpansionReviews(limit = 48): Promise<CandidateExpansionReview[]> {
  await ensureLoaded();
  return Array.from(candidateReviews.values())
    .sort((a, b) => {
      const statusRank = (value: CandidateExpansionReview['status']): number => (value === 'open' ? 0 : value === 'accepted' ? 1 : 2);
      return statusRank(a.status) - statusRank(b.status)
        || b.confidence - a.confidence
        || Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt);
    })
    .slice(0, Math.max(1, limit))
    .map((review) => ({ ...review, supportingSignals: review.supportingSignals.slice() }));
}

export async function setCandidateExpansionReviewStatus(
  reviewId: string,
  status: CandidateExpansionReview['status'],
): Promise<CandidateExpansionReview | null> {
  await ensureLoaded();
  const existing = candidateReviews.get(reviewId);
  if (!existing) return null;
  const next: CandidateExpansionReview = {
    ...existing,
    status,
    autoApproved: status === 'accepted' ? false : existing.autoApproved,
    autoApprovalMode: status === 'accepted' ? null : existing.autoApprovalMode,
    acceptedAt: status === 'accepted' ? nowIso() : existing.acceptedAt || null,
    probationStatus: status === 'accepted' ? 'n/a' : existing.probationStatus,
    probationCycles: status === 'accepted' ? 0 : existing.probationCycles,
    probationHits: status === 'accepted' ? 0 : existing.probationHits,
    probationMisses: status === 'accepted' ? 0 : existing.probationMisses,
    lastUpdatedAt: nowIso(),
  };
  candidateReviews.set(reviewId, next);
  syncSnapshotReviewState();
  await persist();
  return { ...next, supportingSignals: next.supportingSignals.slice() };
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

interface LocalCodexCandidateExpansionResponse {
  proposals?: CodexCandidateExpansionProposal[];
}

export function getInvestmentThemeDefinition(themeId: string): InvestmentThemeDefinition | null {
  const theme = getThemeRule(themeId);
  if (!theme) return null;
  return {
    ...theme,
    triggers: theme.triggers.slice(),
    sectors: theme.sectors.slice(),
    commodities: theme.commodities.slice(),
    invalidation: theme.invalidation.slice(),
    assets: getEffectiveThemeAssets(theme).map((asset) => ({ ...asset })),
  };
}

function applyCurrentUniversePolicyToReviews(): void {
  const applied = applyUniverseExpansionPolicy(
    Array.from(candidateReviews.values()).map((review) => normalizeCandidateReview(review)),
    universeExpansionPolicy,
  );
  candidateReviews = new Map(applied.map((review) => [review.id, review] as const));
}

export async function ingestCodexCandidateExpansionProposals(
  themeId: string,
  proposals: CodexCandidateExpansionProposal[],
): Promise<CandidateExpansionReview[]> {
  await ensureLoaded();
  const theme = getThemeRule(themeId);
  if (!theme || !currentSnapshot) return [];

  const existingAssets = new Set(getEffectiveThemeAssets(theme).map(themeAssetKey));
  const inserted: CandidateExpansionReview[] = [];

  for (const proposal of (proposals || []).slice(0, 10)) {
    const symbol = String(proposal.symbol || '').trim().toUpperCase();
    if (!symbol) continue;
    const direction = proposal.direction || 'watch';
    const role = proposal.role || (direction === 'hedge' ? 'hedge' : 'confirm');
    const assetKind = proposal.assetKind || 'equity';
    const asset: ThemeAssetDefinition = {
      symbol,
      name: String(proposal.assetName || symbol).trim() || symbol,
      assetKind,
      sector: String(proposal.sector || theme.sectors[0] || 'cross-asset').trim() || 'cross-asset',
      commodity: proposal.commodity || undefined,
      direction,
      role,
    };
    if (existingAssets.has(themeAssetKey(asset))) continue;
    const reviewId = candidateReviewId(theme.id, symbol, direction, role);
    const previous = candidateReviews.get(reviewId);
    const next: CandidateExpansionReview = {
      id: reviewId,
      themeId: theme.id,
      themeLabel: theme.label,
      symbol,
      assetName: asset.name,
      assetKind,
      sector: asset.sector,
      commodity: proposal.commodity || null,
      direction,
      role,
      confidence: clamp(Math.round(Number(proposal.confidence) || 62), 25, 95),
      source: 'codex',
      status: previous?.status || 'open',
      reason: String(proposal.reason || `Codex proposed ${symbol} as an additional ${theme.label} candidate.`).slice(0, 280),
      supportingSignals: Array.isArray(proposal.supportingSignals)
        ? proposal.supportingSignals.map((signal) => String(signal).slice(0, 140)).filter(Boolean).slice(0, 8)
        : [`Theme=${theme.label}`, 'Codex review proposal'],
      requiresMarketData: !currentSnapshot.directMappings.some((mapping) => mapping.symbol === symbol),
      autoApproved: previous?.autoApproved || false,
      autoApprovalMode: previous?.autoApprovalMode || null,
      acceptedAt: previous?.acceptedAt || null,
      probationStatus: previous?.probationStatus || 'n/a',
      probationCycles: previous?.probationCycles || 0,
      probationHits: previous?.probationHits || 0,
      probationMisses: previous?.probationMisses || 0,
      lastUpdatedAt: nowIso(),
    };
    candidateReviews.set(reviewId, next);
  }

  applyCurrentUniversePolicyToReviews();

  for (const proposal of (proposals || []).slice(0, 10)) {
    const symbol = String(proposal.symbol || '').trim().toUpperCase();
    if (!symbol) continue;
    const direction = proposal.direction || 'watch';
    const role = proposal.role || (direction === 'hedge' ? 'hedge' : 'confirm');
    const reviewId = candidateReviewId(theme.id, symbol, direction, role);
    const stored = candidateReviews.get(reviewId);
    if (stored) inserted.push({ ...stored, supportingSignals: stored.supportingSignals.slice() });
  }

  syncSnapshotReviewState();
  await persist();
  return inserted;
}

export async function requestCodexCandidateExpansion(themeId: string): Promise<CandidateExpansionReview[]> {
  await ensureLoaded();
  const theme = getThemeRule(themeId);
  if (!theme || !currentSnapshot) return [];

  const themeMappings = currentSnapshot.directMappings
    .filter((mapping) => mapping.themeId === themeId)
    .slice(0, 8)
    .map((mapping) => ({
      symbol: mapping.symbol,
      assetName: mapping.assetName,
      assetKind: mapping.assetKind,
      sector: mapping.sector,
      commodity: mapping.commodity,
      direction: mapping.direction,
      role: mapping.role,
      conviction: mapping.conviction,
      falsePositiveRisk: mapping.falsePositiveRisk,
      transferEntropy: mapping.transferEntropy ?? 0,
    }));
  const watchlist = getMarketWatchlistEntries().slice(0, 20);
  const response = await fetch('/api/local-codex-candidate-expansion', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      themeId: theme.id,
      themeLabel: theme.label,
      thesis: theme.thesis,
      timeframe: theme.timeframe,
      triggers: theme.triggers.slice(0, 12),
      sectors: theme.sectors,
      commodities: theme.commodities,
      invalidation: theme.invalidation,
      topMappings: themeMappings,
      watchlist,
      existingSymbols: getEffectiveThemeAssets(theme).map((asset) => asset.symbol),
    }),
  });
  if (!response.ok) {
    throw new Error(`Codex candidate expansion failed: ${response.status}`);
  }
  const payload = await response.json() as LocalCodexCandidateExpansionResponse;
  return ingestCodexCandidateExpansionProposals(themeId, Array.isArray(payload.proposals) ? payload.proposals : []);
}

export async function listMappingPerformanceStats(limit = 160): Promise<MappingPerformanceStats[]> {
  await ensureLoaded();
  return Array.from(mappingStats.values())
    .sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt) || b.observations - a.observations)
    .slice(0, Math.max(1, limit))
    .map((entry) => ({ ...entry }));
}

export async function exportInvestmentLearningState(): Promise<InvestmentLearningState> {
  await ensureLoaded();
  return {
    snapshot: currentSnapshot ? {
      ...currentSnapshot,
      workflow: currentSnapshot.workflow.map((step) => ({ ...step })),
      directMappings: currentSnapshot.directMappings.map((item) => ({ ...item, reasons: item.reasons.slice(), transmissionPath: item.transmissionPath.slice(), tags: item.tags.slice() })),
      sectorSensitivity: currentSnapshot.sectorSensitivity.map((row) => ({ ...row, drivers: row.drivers.slice(), symbols: row.symbols.slice() })),
      analogs: currentSnapshot.analogs.map((item) => ({ ...item, symbols: item.symbols.slice(), themes: item.themes.slice() })),
      backtests: currentSnapshot.backtests.map((row) => ({ ...row, notes: row.notes.slice() })),
      positionSizingRules: currentSnapshot.positionSizingRules.map((rule) => ({ ...rule, notes: rule.notes.slice() })),
      ideaCards: currentSnapshot.ideaCards.map((card) => ({
        ...card,
        symbols: card.symbols.map((symbol) => ({ ...symbol })),
        triggers: card.triggers.slice(),
        invalidation: card.invalidation.slice(),
        evidence: card.evidence.slice(),
        transmissionPath: card.transmissionPath.slice(),
        sectorExposure: card.sectorExposure.slice(),
        analogRefs: card.analogRefs.slice(),
      })),
      trackedIdeas: currentSnapshot.trackedIdeas.map((idea) => ({
        ...idea,
        symbols: idea.symbols.map((symbol) => ({ ...symbol })),
        evidence: idea.evidence.slice(),
        triggers: idea.triggers.slice(),
        invalidation: idea.invalidation.slice(),
      })),
      falsePositive: {
        ...currentSnapshot.falsePositive,
        reasons: currentSnapshot.falsePositive.reasons.map((reason) => ({ ...reason })),
      },
      universePolicy: { ...currentSnapshot.universePolicy },
      universeCoverage: {
        ...currentSnapshot.universeCoverage,
        activeAssetKinds: currentSnapshot.universeCoverage.activeAssetKinds.slice(),
        activeSectors: currentSnapshot.universeCoverage.activeSectors.slice(),
      },
      coverageGaps: currentSnapshot.coverageGaps.map((gap) => ({
        ...gap,
        missingAssetKinds: gap.missingAssetKinds.slice(),
        missingSectors: gap.missingSectors.slice(),
        suggestedSymbols: gap.suggestedSymbols.slice(),
      })),
      candidateReviews: currentSnapshot.candidateReviews.map((review) => ({
        ...review,
        supportingSignals: review.supportingSignals.slice(),
      })),
      summaryLines: currentSnapshot.summaryLines.slice(),
    } : null,
    history: currentHistory.map((entry) => ({ ...entry, themes: entry.themes.slice(), regions: entry.regions.slice(), symbols: entry.symbols.slice() })),
    trackedIdeas: trackedIdeas.map((idea) => ({
      ...idea,
      symbols: idea.symbols.map((symbol) => ({ ...symbol })),
      evidence: idea.evidence.slice(),
      triggers: idea.triggers.slice(),
      invalidation: idea.invalidation.slice(),
    })),
    marketHistory: marketHistory.map((point) => ({ ...point })),
    mappingStats: Array.from(mappingStats.values()).map((entry) => ({ ...entry })),
    banditStates: Array.from(banditStates.values()).map((entry) => ({
      ...entry,
      matrixA: entry.matrixA.map((row) => row.slice()),
      vectorB: entry.vectorB.slice(),
    })),
    candidateReviews: Array.from(candidateReviews.values()).map((review) => ({
      ...review,
      supportingSignals: review.supportingSignals.slice(),
    })),
  };
}

export async function resetInvestmentLearningState(seed?: Partial<InvestmentLearningState>): Promise<void> {
  await ensureLoaded();
  currentSnapshot = seed?.snapshot ?? null;
  currentSnapshot = normalizeInvestmentSnapshot(currentSnapshot);
  universeExpansionPolicy = normalizeUniverseExpansionPolicy(currentSnapshot?.universePolicy || universeExpansionPolicy);
  currentHistory = (seed?.history ?? []).map((entry) => ({
    ...entry,
    themes: entry.themes.slice(),
    regions: entry.regions.slice(),
    symbols: entry.symbols.slice(),
  }));
  trackedIdeas = (seed?.trackedIdeas ?? []).map((idea) => ({
    ...idea,
    symbols: idea.symbols.map((symbol) => ({ ...symbol })),
    evidence: idea.evidence.slice(),
    triggers: idea.triggers.slice(),
    invalidation: idea.invalidation.slice(),
  }));
  marketHistory = (seed?.marketHistory ?? []).map((point) => ({ ...point }));
  rebuildMarketHistoryIndex();
  mappingStats = new Map((seed?.mappingStats ?? []).map((entry) => [entry.id, { ...entry }] as const));
  banditStates = new Map((seed?.banditStates ?? []).map((entry) => [entry.id, {
    ...entry,
    matrixA: entry.matrixA.map((row) => row.slice()),
    vectorB: entry.vectorB.slice(),
  }] as const));
  candidateReviews = new Map((seed?.candidateReviews ?? []).map((review) => {
    const normalized = normalizeCandidateReview(review);
    return [normalized.id, normalized] as const;
  }));
  await persist();
}
