import type { ClusteredEvent, MarketData } from '@/types';
import type { EventMarketTransmissionSnapshot } from './event-market-transmission';
import type { SourceCredibilityProfile } from './source-credibility';
import type { ScheduledReport } from './scheduled-reports';
import type { MarketRegimeState } from './math-models/regime-model';
import type { BanditArmState } from './math-models/contextual-bandit';
import { computeHawkesIntensity } from './math-models/hawkes-process';
import { estimateTransferEntropy } from './math-models/transfer-entropy';
import { createBanditArmState, scoreBanditArm, updateBanditArm } from './math-models/contextual-bandit';
import { regimeMultiplierForTheme } from './math-models/regime-model';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { logSourceOpsEvent } from './source-ops-log';
import { getMarketWatchlistEntries } from './market-watchlist';

export type InvestmentAssetKind = 'etf' | 'equity' | 'commodity' | 'fx' | 'rate' | 'crypto';
export type InvestmentDirection = 'long' | 'short' | 'hedge' | 'watch' | 'pair';
export type InvestmentBias = 'benefit' | 'pressure' | 'mixed';
export type WorkflowStatus = 'ready' | 'watch' | 'blocked';
export type UniverseExpansionMode = 'manual' | 'guarded-auto' | 'full-auto';

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
  liquidityScore: number;
  marketMovePct: number | null;
  regimeId?: string | null;
  regimeMultiplier?: number;
  aftershockIntensity?: number;
  transferEntropy?: number;
  banditScore?: number;
  banditMean?: number;
  banditUncertainty?: number;
  corroboration: number;
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
  symbols: InvestmentIdeaSymbol[];
  triggers: string[];
  invalidation: string[];
  evidence: string[];
  transmissionPath: string[];
  sectorExposure: string[];
  analogRefs: string[];
  trackingStatus?: 'new' | 'open' | 'closed' | 'watch';
  daysHeld?: number;
  liveReturnPct?: number | null;
  realizedReturnPct?: number | null;
  backtestHitRate?: number | null;
  backtestAvgReturnPct?: number | null;
  exitReason?: string | null;
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
  maxAutoApprovalsPerTheme: number;
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

export interface InvestmentIntelligenceSnapshot {
  generatedAt: string;
  regime?: MarketRegimeState | null;
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
  credibility: number;
  corroboration: number;
  marketStress: number;
  aftershockIntensity: number;
  regimeId: string | null;
  regimeConfidence: number;
  matchedSymbols: string[];
  reasons: string[];
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

interface ThemeRule {
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
  maxAutoApprovalsPerTheme: 2,
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
    triggers: ['missile', 'airstrike', 'drone', 'carrier', 'navy', 'destroyed vessels', 'centcom', 'munition', 'patriot'],
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
let universeExpansionPolicy: UniverseExpansionPolicy = { ...DEFAULT_UNIVERSE_EXPANSION_POLICY };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-/.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
    maxAutoApprovalsPerTheme: clamp(Math.round(Number(policy?.maxAutoApprovalsPerTheme) || DEFAULT_UNIVERSE_EXPANSION_POLICY.maxAutoApprovalsPerTheme), 1, 6),
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

function normalizeInvestmentSnapshot(snapshot: InvestmentIntelligenceSnapshot | null | undefined): InvestmentIntelligenceSnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
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
    const transmissionInfo = transmissionByTitle.get(normalize(title));
    const marketStress = transmissionInfo?.stress ?? 0;
    const aftershockIntensity = aftershockByCluster.get(cluster.id || titleId(title)) ?? 0;

    const rejectReason = (() => {
      if (ARCHIVE_RE.test(title)) return 'archive-or-historical';
      if (SPORTS_RE.test(title) || SPORTS_RE.test(text)) return 'sports-or-entertainment';
      if (LOW_SIGNAL_RE.test(text) && !cluster.isAlert) return 'routine-low-signal';
      if (cluster.sourceCount <= 1 && credibility < 52 && !cluster.isAlert && marketStress < 0.45) return 'single-source-low-credibility';
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
      credibility,
      corroboration,
      marketStress,
      aftershockIntensity,
      regimeId: regime?.id ?? null,
      regimeConfidence: regime?.confidence ?? 0,
      matchedSymbols: transmissionInfo?.symbols.slice(0, 6) ?? [],
      reasons: transmissionInfo?.reasons.slice(0, 4) ?? [],
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
  const matches = THEME_RULES.filter((rule) => rule.triggers.some((trigger) => candidate.text.includes(trigger)));
  if (matches.length > 0) return matches;
  if (candidate.matchedSymbols.length > 0 && candidate.marketStress >= 0.55) {
    return THEME_RULES.filter((rule) => candidate.matchedSymbols.some((symbol) => themeHasAssetSymbol(rule, symbol)));
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
  return THEME_RULES.find((theme) => theme.id === themeId) || null;
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
      const themeCatalog = UNIVERSE_ASSET_CATALOG.filter((asset) => asset.themeIds.includes(theme.id));

      for (const asset of themeCatalog) {
        if (effectiveAssets.has(themeAssetKey(asset))) continue;
        const reviewId = candidateReviewId(theme.id, asset.symbol, asset.direction, asset.role);
        const previous = candidateReviews.get(reviewId);
        const inWatchlist = watchlistLookup.has(normalize(asset.symbol));
        const hasMarketData = marketMap.has(asset.symbol);
        const confidence = scoreExpansionCandidate({ candidate, theme, asset, inWatchlist, hasMarketData });
        const supportingSignals = [
          candidate.title,
          `Theme=${theme.label}`,
          `Credibility=${candidate.credibility}`,
          `Corroboration=${candidate.corroboration}`,
          `Stress=${candidate.marketStress.toFixed(2)}`,
          `Aftershock=${candidate.aftershockIntensity.toFixed(2)}`,
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

function shouldAutoApproveReview(review: CandidateExpansionReview, policy: UniverseExpansionPolicy, allReviews: CandidateExpansionReview[]): boolean {
  if (review.status !== 'open') return false;
  if (policy.mode === 'manual') return false;
  if (countAutoApprovedByTheme(allReviews, review.themeId) >= policy.maxAutoApprovalsPerTheme) return false;
  if (policy.requireMarketData && review.requiresMarketData) return false;
  if (policy.mode === 'guarded-auto') {
    return review.source === 'codex' && review.confidence >= policy.minCodexConfidence;
  }
  return review.confidence >= Math.max(52, policy.minCodexConfidence - 16);
}

function applyUniverseExpansionPolicy(reviews: CandidateExpansionReview[], policy: UniverseExpansionPolicy): CandidateExpansionReview[] {
  const output = reviews.map((review) => ({ ...review }));
  for (let index = 0; index < output.length; index += 1) {
    const review = output[index]!;
    if (!shouldAutoApproveReview(review, policy, output)) continue;
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
      reason: `${review.reason} Auto-approved by ${policy.mode} policy.`,
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

function liquidityBaseline(kind: InvestmentAssetKind): number {
  if (kind === 'etf') return 72;
  if (kind === 'equity') return 64;
  if (kind === 'commodity') return 58;
  if (kind === 'rate') return 70;
  if (kind === 'fx') return 74;
  return 56;
}

function buildDirectMappings(args: {
  candidates: EventCandidate[];
  markets: MarketData[];
  transmission: EventMarketTransmissionSnapshot | null;
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
        const regimeMultiplier = regimeMultiplierForTheme(
          regime,
          theme.id,
          [candidate.text, theme.label, ...theme.sectors, ...theme.commodities],
        );
        const transferEntropy = estimateTransferEntropy(
          buildEventIntensitySeries(theme.id, candidate.region),
          buildMarketSignalSeries(asset.symbol),
        ).normalized;
        const banditContext = buildBanditContext({
          credibility: candidate.credibility,
          corroboration: candidate.corroboration,
          marketStress: candidate.marketStress,
          aftershockIntensity: candidate.aftershockIntensity,
          regimeMultiplier,
          transferEntropy,
          posteriorWinRate: learnedWinRate,
          emaReturnPct: learnedReturnPct,
        });
        const bandit = scoreBanditArm(getBanditState(theme.id, asset.symbol, asset.direction), banditContext, 0.72);
        const posteriorBonus = clamp(Math.round((learnedWinRate - 50) * 0.36), -12, 12);
        const returnBonus = clamp(Math.round(learnedReturnPct * 1.4), -10, 10);
        const sampleBonus = Math.min(8, Math.round(Math.log2(learnedObservations + 1) * 2));
        const regimeBonus = clamp(Math.round((regimeMultiplier - 1) * 18), -8, 12);
        const aftershockBonus = clamp(Math.round(candidate.aftershockIntensity * 16), 0, 14);
        const entropyBonus = clamp(Math.round(transferEntropy * 16), 0, 12);
        const banditBonus = clamp(Math.round(bandit.score * 10), -10, 14);
        const conviction = clamp(
          Math.round(
            28
            + candidate.sourceCount * 8
            + (candidate.isAlert ? 10 : 0)
            + candidate.credibility * 0.18
            + candidate.corroboration * 0.14
            + candidate.marketStress * 24
            + candidate.aftershockIntensity * 12
            + (marketMovePct != null ? Math.min(12, Math.abs(marketMovePct) * 3) : 0),
          ) + posteriorBonus + returnBonus + sampleBonus + regimeBonus + aftershockBonus + entropyBonus + banditBonus,
          20,
          98,
        );
        const falsePositiveRisk = clamp(
          Math.round(
            76
            - candidate.sourceCount * 7
            - candidate.credibility * 0.22
            - candidate.corroboration * 0.16
            - candidate.marketStress * 18
            - (candidate.isAlert ? 6 : 0)
            - Math.max(0, posteriorBonus)
            - Math.max(0, returnBonus)
            - Math.max(0, regimeBonus)
            - Math.max(0, aftershockBonus)
            - Math.max(0, entropyBonus)
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
            + candidate.aftershockIntensity * 10
            + posteriorBonus * 0.35
            + returnBonus * 0.45
            + regimeBonus * 0.8
            + entropyBonus * 0.9,
          ),
          35,
          99,
        );
        const liquidityScore = clamp(
          Math.round(liquidityBaseline(asset.assetKind) + (marketMovePct != null ? Math.min(12, Math.abs(marketMovePct) * 2.2) : 0)),
          20,
          98,
        );

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
          liquidityScore,
          marketMovePct,
          regimeId: regime?.id ?? candidate.regimeId,
          regimeMultiplier,
          aftershockIntensity: Number(candidate.aftershockIntensity.toFixed(4)),
          transferEntropy: Number(transferEntropy.toFixed(4)),
          banditScore: Number(bandit.score.toFixed(4)),
          banditMean: Number(bandit.mean.toFixed(4)),
          banditUncertainty: Number(bandit.uncertainty.toFixed(4)),
          corroboration: candidate.corroboration,
          reasons: [
            theme.thesis,
            ...candidate.reasons,
            `Regime=${regime?.label || candidate.regimeId || 'unknown'} x${regimeMultiplier.toFixed(2)}`,
            `Aftershock=${candidate.aftershockIntensity.toFixed(2)}`,
            `TransferEntropy=${transferEntropy.toFixed(2)}`,
            `Bandit=${bandit.score.toFixed(2)}`,
          ].slice(0, 6),
          transmissionPath: [candidate.title, theme.label, `${asset.symbol} ${asset.name}`],
          tags: [...theme.sectors, ...theme.commodities, ...candidate.matchedSymbols].slice(0, 8),
        });
      }
    }
  }

  return mappings
    .sort((a, b) => b.conviction - a.conviction || b.sensitivityScore - a.sensitivityScore)
    .slice(0, MAX_MAPPINGS);
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

function buildIdeaCards(mappings: DirectAssetMapping[], analogs: HistoricalAnalog[]): InvestmentIdeaCard[] {
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
    const sizePct = clamp(rule.maxPositionPct * (conviction / 100) * (1 - falsePositiveRisk / 125) * edgeAdj, 0.15, rule.maxPositionPct);
    const lead = bucket[0]!;
    const theme = THEME_RULES.find((item) => item.id === lead.themeId);
    const relatedAnalogs = analogs
      .filter((analog) => analog.themes.some((item) => item === lead.themeId || item === normalize(lead.themeLabel)))
      .slice(0, 3)
      .map((analog) => analog.label);

    cards.push({
      id: key,
      title: `${lead.themeLabel} | ${lead.region}`,
      themeId: lead.themeId,
      direction: dominantDirection,
      conviction,
      falsePositiveRisk,
      sizePct: Math.round(sizePct * 100) / 100,
      timeframe: theme?.timeframe || '1d-7d',
      thesis: theme?.thesis || lead.reasons[0] || 'Event-to-asset transmission detected.',
      symbols: [
        ...primary.slice(0, 3).map((item): InvestmentIdeaSymbol => ({
          symbol: item.symbol,
          name: item.assetName,
          role: item.role === 'hedge' ? 'hedge' : item.role,
          direction: item.direction,
          sector: item.sector,
          contextVector: buildBanditContext({
            credibility: item.corroboration,
            corroboration: item.corroboration,
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
          contextVector: buildBanditContext({
            credibility: item.corroboration,
            corroboration: item.corroboration,
            marketStress: Math.max(0, Math.min(1, (item.marketMovePct ?? 0) / 10)),
            aftershockIntensity: item.aftershockIntensity ?? 0,
            regimeMultiplier: item.regimeMultiplier ?? 1,
            transferEntropy: item.transferEntropy ?? 0,
            posteriorWinRate: getMappingStats(item.themeId, item.symbol, item.direction)?.posteriorWinRate ?? 50,
            emaReturnPct: getMappingStats(item.themeId, item.symbol, item.direction)?.emaReturnPct ?? 0,
          }),
          banditScore: item.banditScore ?? null,
        })),
      ].slice(0, 4),
      triggers: Array.from(new Set(bucket.flatMap((item) => item.reasons))).slice(0, 4),
      invalidation: theme?.invalidation.slice(0, 3) || ['Transmission path weakens', 'Cross-asset confirmation disappears'],
      evidence: Array.from(new Set(bucket.map((item) => item.eventTitle))).slice(0, 3),
      transmissionPath: Array.from(new Set(bucket.flatMap((item) => item.transmissionPath))).slice(0, 5),
      sectorExposure: Array.from(new Set(bucket.map((item) => item.sector))).slice(0, 4),
      analogRefs: relatedAnalogs,
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
}): InvestmentWorkflowStep[] {
  const multiSourceIdeas = snapshot.mappings.filter((item) => item.corroboration >= 60).length;
  const openTracked = snapshot.trackedIdeas.filter((idea) => idea.status === 'open').length;
  const closedTracked = snapshot.trackedIdeas.filter((idea) => idea.status === 'closed').length;
  const strongBacktests = snapshot.backtests.filter((row) => row.sampleSize >= 2 && row.hitRate >= 50).length;
  return [
    {
      id: 'detect',
      label: 'Detect',
      status: snapshot.falsePositive.kept > 0 ? 'ready' : 'blocked',
      metric: snapshot.falsePositive.kept,
      summary: `${snapshot.falsePositive.kept} event candidates survived the signal screen.`,
    },
    {
      id: 'validate',
      label: 'Validate',
      status: multiSourceIdeas >= 6 ? 'ready' : multiSourceIdeas >= 2 ? 'watch' : 'blocked',
      metric: multiSourceIdeas,
      summary: `${multiSourceIdeas} mappings have corroboration strong enough for execution review.`,
    },
    {
      id: 'map',
      label: 'Map',
      status: snapshot.mappings.length >= 8 ? 'ready' : snapshot.mappings.length > 0 ? 'watch' : 'blocked',
      metric: snapshot.mappings.length,
      summary: `${snapshot.mappings.length} direct stock or ETF paths identified from live events.`,
    },
    {
      id: 'stress-test',
      label: 'Stress Test',
      status: strongBacktests >= 3 || snapshot.analogs.length >= 3
        ? 'ready'
        : strongBacktests > 0 || snapshot.analogs.length > 0
          ? 'watch'
          : 'blocked',
      metric: snapshot.backtests.length,
      summary: `${snapshot.backtests.length} price-backed replay rows and ${snapshot.analogs.length} analog checkpoints available.`,
    },
    {
      id: 'size',
      label: 'Size',
      status: snapshot.ideaCards.length > 0 ? 'ready' : 'blocked',
      metric: snapshot.ideaCards.length,
      summary: `${snapshot.ideaCards.length} auto-sized idea cards ready for trader review.`,
    },
    {
      id: 'monitor',
      label: 'Monitor',
      status: openTracked >= 3 ? 'ready' : openTracked > 0 || closedTracked > 0 ? 'watch' : 'blocked',
      metric: openTracked,
      summary: `${openTracked} live tracked ideas and ${closedTracked} closed samples are being monitored.`,
    },
  ];
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

export async function recomputeInvestmentIntelligence(args: {
  clusters: ClusteredEvent[];
  markets: MarketData[];
  transmission: EventMarketTransmissionSnapshot | null;
  sourceCredibility: SourceCredibilityProfile[];
  reports: ScheduledReport[];
}): Promise<InvestmentIntelligenceSnapshot> {
  await ensureLoaded();
  const timestamp = nowIso();
  appendMarketHistory(args.markets, timestamp);

  const { kept, falsePositive } = buildEventCandidates({
    clusters: args.clusters,
    transmission: args.transmission,
    sourceCredibility: args.sourceCredibility,
  });

  const mappings = buildDirectMappings({ candidates: kept, markets: args.markets, transmission: args.transmission });
  const preIdeaCards = buildIdeaCards(mappings, []);
  currentHistory = mergeHistory(currentHistory, parseReportHistory(args.reports));
  const analogs = buildHistoricalAnalogs({ history: currentHistory, ideaCards: preIdeaCards });
  currentHistory = mergeHistory(currentHistory, createCurrentHistoryEntries(preIdeaCards, mappings, timestamp));
  const baseIdeaCards = buildIdeaCards(mappings, analogs);
  const tracked = updateMappingPerformanceStats(updateTrackedIdeas(baseIdeaCards, args.markets, timestamp));
  const backtests = buildEventBacktests(tracked);
  const reviews = evaluateCandidateReviewProbation({
    reviews: applyUniverseExpansionPolicy(buildCandidateExpansionReviews({ candidates: kept, markets: args.markets }), universeExpansionPolicy),
    activeCandidates: kept,
    mappings,
    backtests,
    policy: universeExpansionPolicy,
  });
  candidateReviews = new Map(reviews.map((review) => [review.id, review] as const));
  const sensitivity = buildSensitivityRows(mappings, backtests, tracked);
  const ideaCards = enrichIdeaCards(baseIdeaCards, tracked, backtests);
  const workflow = buildWorkflow({ falsePositive, mappings, ideaCards, analogs, sensitivity, trackedIdeas: tracked, backtests });
  const coverageGaps = buildCoverageGaps({ candidates: kept, reviews });
  const universeCoverage = buildUniverseCoverageSummary({ candidates: kept, mappings, reviews, gaps: coverageGaps });
  const topThemes = Array.from(new Set(ideaCards.map((card) => card.title))).slice(0, 8);
  const openTracked = tracked.filter((idea) => idea.status === 'open').length;
  const closedTracked = tracked.filter((idea) => idea.status === 'closed').length;
  const learnedMappings = Array.from(mappingStats.values()).filter((entry) => entry.observations > 0).length;

  currentSnapshot = {
    generatedAt: timestamp,
    regime: args.transmission?.regime ?? null,
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
    summaryLines: [
      `${ideaCards.length} idea cards generated across ${sensitivity.length} sector channels.`,
      `${mappings.length} direct stock or ETF mappings survived ${falsePositive.rejected} false-positive rejects.`,
      `${backtests.length} price-based backtest rows, ${openTracked} open tracked ideas, ${closedTracked} closed samples, and ${learnedMappings} learned mapping priors available.`,
      `${universeCoverage.dynamicApprovedCount} approved expansion candidates, ${universeCoverage.openReviewCount} open review items, and ${universeCoverage.gapCount} current coverage gaps tracked.`,
      `Universe policy=${universeExpansionPolicy.mode} threshold=${universeExpansionPolicy.minCodexConfidence} requireMarketData=${universeExpansionPolicy.requireMarketData ? 'yes' : 'no'}.`,
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
      `Universe policy=${universeExpansionPolicy.mode} threshold=${universeExpansionPolicy.minCodexConfidence} requireMarketData=${universeExpansionPolicy.requireMarketData ? 'yes' : 'no'}.`,
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

interface LocalCodexCandidateProposal {
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
  proposals?: LocalCodexCandidateProposal[];
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
  const proposals = Array.isArray(payload.proposals) ? payload.proposals : [];
  const existingAssets = new Set(getEffectiveThemeAssets(theme).map(themeAssetKey));
  const inserted: CandidateExpansionReview[] = [];

  for (const proposal of proposals.slice(0, 10)) {
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
    inserted.push({ ...next, supportingSignals: next.supportingSignals.slice() });
  }

  syncSnapshotReviewState();
  await persist();
  return inserted;
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
