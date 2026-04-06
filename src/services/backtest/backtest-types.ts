import type { ClusteredEvent, MarketData, NewsItem } from '@/types';
import type { EventMarketTransmissionSnapshot } from '../event-market-transmission';
import type {
  InvestmentIdeaCard,
  InvestmentDirection,
  InvestmentIntelligenceContext,
  MappingPerformanceStats,
  InvestmentLearningState,
  InvestmentIntelligenceSnapshot,
} from '../investment-intelligence';
import type { ScheduledReport } from '../scheduled-reports';
import type { SourceCredibilityProfile } from '../source-credibility';
import type { PortfolioAccountingSnapshot } from '../portfolio-accounting';
import type {
  ReplayThemeProfile,
  CoverageLedgerSnapshot,
} from './backtest-type-deps';

export interface HistoricalReplayFrame {
  id?: string;
  timestamp: string;
  validTimeStart?: string;
  validTimeEnd?: string | null;
  transactionTime?: string;
  knowledgeBoundary?: string;
  datasetId?: string;
  sourceVersion?: string | null;
  warmup?: boolean;
  news: NewsItem[];
  clusters: ClusteredEvent[];
  markets: MarketData[];
  reports?: ScheduledReport[];
  transmission?: EventMarketTransmissionSnapshot | null;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface BacktestIdeaRunSymbol {
  symbol: string;
  name: string;
  role: 'primary' | 'confirm' | 'hedge';
  direction: InvestmentDirection;
  sector?: string;
  assetKind?: 'etf' | 'equity' | 'commodity' | 'fx' | 'rate' | 'crypto';
  liquidityScore?: number | null;
  realityScore?: number | null;
  entryPrice: number | null;
}

export interface BacktestIdeaRun {
  id: string;
  runId: string;
  frameId: string;
  generatedAt: string;
  title: string;
  themeId: string;
  themeClassification?: InvestmentIdeaCard['themeClassification'];
  region: string;
  direction: InvestmentDirection;
  conviction: number;
  falsePositiveRisk: number;
  sizePct: number;
  timeframe: string;
  calibratedConfidence?: number;
  realityScore?: number;
  graphSignalScore?: number;
  narrativeAlignmentScore?: number;
  narrativeShadowState?: InvestmentIdeaCard['narrativeShadowState'];
  narrativeShadowPosterior?: number;
  narrativeShadowDisagreement?: number;
  narrativeShadowTopThemeId?: string | null;
  recentEvidenceScore?: number;
  corroborationQuality?: number;
  transferEntropy?: number;
  banditScore?: number;
  regimeMultiplier?: number;
  confirmationScore?: number;
  confirmationState?: InvestmentIdeaCard['confirmationState'];
  coveragePenalty?: number;
  metaHitProbability?: number;
  metaExpectedReturnPct?: number;
  metaDecisionScore?: number;
  admissionState?: InvestmentIdeaCard['admissionState'];
  continuousConviction?: number;
  clusterConfidence?: number;
  marketStressPrior?: number;
  transmissionStress?: number | null;
  thesis: string;
  evidence: string[];
  triggers: string[];
  invalidation: string[];
  transmissionPath: string[];
  analogRefs: string[];
  preferredHorizonHours?: number | null;
  horizonCandidatesHours?: number[];
  horizonLearningConfidence?: number | null;
  symbols: BacktestIdeaRunSymbol[];
}

export interface ForwardReturnRecord {
  id: string;
  runId: string;
  ideaRunId: string;
  symbol: string;
  direction: InvestmentDirection;
  horizonHours: number;
  entryTimestamp: string;
  exitTimestamp: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  rawReturnPct: number | null;
  signedReturnPct: number | null;
  costAdjustedSignedReturnPct: number | null;
  maxDrawdownPct: number | null;
  riskAdjustedReturn: number | null;
  bestReturnPct: number | null;
  priceGapPct: number | null;
  maxHoldingHours: number;
  exitReason: 'target-horizon' | 'trailing-stop' | 'max-hold-fallback' | 'no-exit-price';
  executionPenaltyPct: number;
  realityScore: number;
  sessionState: 'always-on' | 'open' | 'extended' | 'closed';
  tradableNow: boolean;
  spreadBps: number;
  slippageBps: number;
  liquidityPenaltyPct: number;
  realityNotes: string[];
}

export interface RealityAwareBacktestSummary {
  primaryHorizonHours: number;
  rawHitRate: number;
  costAdjustedHitRate: number;
  rawAvgReturnPct: number;
  costAdjustedAvgReturnPct: number;
  avgExecutionPenaltyPct: number;
  avgRealityScore: number;
  nonTradableRate: number;
}

export interface ReplayConfidenceInterval {
  lower: number;
  upper: number;
  confidenceLevel: number;
  sampleSize: number;
}

export interface ReplayStatisticalSummary {
  costAdjustedAvgReturnPctCi95: ReplayConfidenceInterval | null;
  costAdjustedHitRateCi95: ReplayConfidenceInterval | null;
  rawAvgReturnPctCi95: ReplayConfidenceInterval | null;
  sharpeRatioCi95: ReplayConfidenceInterval | null;
}

export interface ReplayCpcvPathSummary {
  pathCount: number;
  combinationSize: number;
  returnPct05: number;
  returnPct50: number;
  returnPct95: number;
  sharpePct05: number;
  sharpePct50: number;
  sharpePct95: number;
  maxDrawdownPct05: number;
}

export interface ReplayDsrSummary {
  observedSharpe: number;
  benchmarkSharpe: number;
  deflatedSharpeRatio: number;
  trialCount: number;
  sampleSize: number;
}

export interface ReplayPboSummary {
  probability: number;
  negativePathShare: number;
  pathCount: number;
  method: 'fold-combination-proxy';
}

export interface ReplayPromotionDecision {
  state: 'promote' | 'shadow' | 'reject';
  score: number;
  reasons: string[];
}

export interface ReplayGovernanceSummary {
  cpcv: ReplayCpcvPathSummary | null;
  dsr: ReplayDsrSummary | null;
  pbo: ReplayPboSummary | null;
  cpcvReal?: { pbo: number; oosRankMedian: number; logitPBO: number; pathCount: number } | null;
  permutationTest?: { observedSharpe: number; pValue: number; nPermutations: number } | null;
  promotion: ReplayPromotionDecision;
}

export interface ReplayThemeRegimeMetric {
  themeId: string;
  regimeId: string;
  sampleSize: number;
  hitRate: number;
  costAdjustedAvgReturnPct: number;
  confirmationScore: number;
}

export interface ReplayDiagnosticRow {
  key: string;
  label: string;
  sampleSize: number;
  hitRate: number;
  rawAvgReturnPct: number;
  costAdjustedAvgReturnPct: number;
  avgExecutionPenaltyPct: number;
  tradableRate: number;
  avgConviction: number;
  avgFalsePositiveRisk: number;
  sharePct: number;
}

export interface ReplayDiagnosticsSnapshot {
  generatedAt: string;
  themes: ReplayDiagnosticRow[];
  symbols: ReplayDiagnosticRow[];
  horizons: ReplayDiagnosticRow[];
}

export interface LockedOosSummary {
  frameCount: number;
  ideaRunCount: number;
  forwardReturnCount: number;
  realitySummary: RealityAwareBacktestSummary;
  statisticalSummary?: ReplayStatisticalSummary | null;
  diagnostics?: ReplayDiagnosticsSnapshot | null;
  portfolioAccounting?: PortfolioAccountingSnapshot | null;
  governance?: ReplayGovernanceSummary | null;
  windows?: WalkForwardWindow[];
  summaryLines: string[];
}

export interface ReplayCheckpoint {
  id: string;
  timestamp: string;
  validTimeStart: string;
  validTimeEnd: string | null;
  transactionTime: string;
  knowledgeBoundary: string;
  evaluationEligible: boolean;
  frameId: string;
  newsCount: number;
  clusterCount: number;
  marketCount: number;
  ideaCount: number;
  trackedIdeaCount: number;
  sourceProfileCount: number;
  mappingStatCount: number;
}

export interface WalkForwardWindow {
  fold: number;
  phase: 'train' | 'validate' | 'test' | 'oos';
  from: string;
  to: string;
  frameCount: number;
}

export interface WalkForwardFoldPlan {
  fold: number;
  trainWindow: WalkForwardWindow;
  evaluationWindows: WalkForwardWindow[];
  trainFrames: HistoricalReplayFrame[];
  evaluationFrames: HistoricalReplayFrame[];
}

export interface HistoricalReplayRun {
  id: string;
  label: string;
  mode: 'replay' | 'walk-forward';
  startedAt: string;
  completedAt: string;
  temporalMode: 'bitemporal';
  retainLearningState: boolean;
  frameCount: number;
  warmupFrameCount: number;
  evaluationFrameCount: number;
  horizonsHours: number[];
  checkpoints: ReplayCheckpoint[];
  ideaRuns: BacktestIdeaRun[];
  forwardReturns: ForwardReturnRecord[];
  sourceProfiles: SourceCredibilityProfile[];
  mappingStats: MappingPerformanceStats[];
  banditStates?: InvestmentLearningState['banditStates'];
  candidateReviews?: InvestmentLearningState['candidateReviews'];
  workflow: InvestmentIntelligenceSnapshot['workflow'];
  themeHorizonProfiles?: ReplayThemeProfile[];
  themeRegimeMetrics?: ReplayThemeRegimeMetric[];
  diagnostics?: ReplayDiagnosticsSnapshot | null;
  coverageLedger?: CoverageLedgerSnapshot | null;
  realitySummary: RealityAwareBacktestSummary;
  statisticalSummary?: ReplayStatisticalSummary | null;
  portfolioAccounting?: PortfolioAccountingSnapshot | null;
  lockedOosSummary?: LockedOosSummary | null;
  governance?: ReplayGovernanceSummary | null;
  summaryLines: string[];
  windows?: WalkForwardWindow[];
}

export interface HistoricalReplayOptions {
  label?: string;
  horizonsHours?: number[];
  retainLearningState?: boolean;
  causalIntegrityMode?: 'strict' | 'batched';
  dedupeWindowHours?: number;
  warmupFrameCount?: number;
  warmupUntil?: string;
  transactionTimeCeiling?: string;
  knowledgeBoundaryCeiling?: string;
  seedState?: {
    sourceProfiles?: SourceCredibilityProfile[];
    investmentLearning?: Partial<InvestmentLearningState>;
  };
  recordAdaptation?: boolean;
  investmentContext?: InvestmentIntelligenceContext;
}

export interface WalkForwardBacktestOptions extends HistoricalReplayOptions {
  trainRatio?: number;
  validateRatio?: number;
  foldCount?: number;
  holdoutRatio?: number;
  holdoutMinFrames?: number;
}

export interface PersistedReplayRuns {
  runs: HistoricalReplayRun[];
}

export interface PricePoint {
  timestamp: string;
  ts: number;
  transactionTs: number;
  price: number;
}

// Re-export dependent types needed by HistoricalReplayRun
export type { InvestmentIntelligenceContext } from '../investment-intelligence';
