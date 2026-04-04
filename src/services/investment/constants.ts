import type {
  UniverseExpansionPolicy,
  PositionSizingRule,
  InvestmentThemeDefinition,
  UniverseAssetDefinition,
  ThemeSymbolAdjustment,
} from './types';

// String key constants
export const SNAPSHOT_KEY = 'investment-intelligence:v1';
export const HISTORY_KEY = 'investment-intelligence-history:v1';
export const TRACKED_IDEAS_KEY = 'investment-intelligence-tracked-ideas:v1';
export const MARKET_HISTORY_KEY = 'investment-intelligence-market-history:v1';
export const MAPPING_STATS_KEY = 'investment-intelligence-mapping-stats:v1';
export const BANDIT_STATE_KEY = 'investment-intelligence-bandit-states:v1';
export const CANDIDATE_REVIEWS_KEY = 'investment-intelligence-candidate-reviews:v1';
export const UNIVERSE_POLICY_KEY = 'investment-intelligence-universe-policy:v1';
export const CONVICTION_MODEL_KEY = 'investment-intelligence-conviction-model:v1';
export const HAWKES_STATES_KEY = 'investment-intelligence-hawkes-states:v1';
export const DISCOVERED_LINKS_KEY = 'investment-intelligence-discovered-links:v1';
export const FINGERPRINTS_KEY = 'investment-intelligence-fingerprints:v1';

// Numeric constants
export const MAX_HISTORY = 240;
export const MAX_MAPPINGS = 72;
export const MAX_IDEAS = 20;
export const MAX_ANALOGS = 8;
export const MAX_TRACKED_IDEAS = 260;
export const MAX_MARKET_HISTORY_POINTS = 12_000;
export const MAX_MAPPING_STATS = 900;
export const MAX_BANDIT_STATES = 1_400;
export const MAX_CANDIDATE_REVIEWS = 480;
export const MAPPING_POSTERIOR_DECAY = 0.995;
export const RETURN_EMA_ALPHA = 0.18;
export const BANDIT_DIMENSION = 8;

// Default policy
export const DEFAULT_UNIVERSE_EXPANSION_POLICY: UniverseExpansionPolicy = {
  mode: 'guarded-auto',
  minCodexConfidence: 58,
  minAutoApproveScore: 84,
  maxAutoApprovalsPerTheme: 2,
  maxAutoApprovalsPerSectorPerTheme: 1,
  maxAutoApprovalsPerAssetKindPerTheme: 1,
  requireMarketData: true,
  probationCycles: 4,
  autoDemoteMisses: 3,
};

// Regex constants
export const ARCHIVE_RE = /\bin 2011\b|\b15 years after\b|\banniversary\b|\bretrospective\b|\blooking back\b|\byears? after\b/i;
export const SPORTS_RE = /\b(baseball|mlb|world cup|paralymp|football team|chef|concert|athletics|pokemon|samurai champloo)\b/i;
export const LOW_SIGNAL_RE = /\b(routine update|context update|lifestyle|sports|weather feature)\b/i;

// Position sizing rules
export const POSITION_RULES: PositionSizingRule[] = [
  {
    id: 'starter',
    label: 'Starter Probe',
    minConviction: 25,
    maxFalsePositiveRisk: 80,
    maxPositionPct: 15,
    grossExposurePct: 70,
    stopLossPct: 6.0,
    takeProfitPct: 12.0,
    maxHoldingDays: 14,
    notes: ['Starter position with 2-week horizon.'],
  },
  {
    id: 'standard',
    label: 'Standard Event Trade',
    minConviction: 40,
    maxFalsePositiveRisk: 65,
    maxPositionPct: 25,
    grossExposurePct: 90,
    stopLossPct: 8.0,
    takeProfitPct: 16.0,
    maxHoldingDays: 21,
    notes: ['Standard position for 2-3 week events.'],
  },
  {
    id: 'conviction',
    label: 'High Conviction Macro',
    minConviction: 55,
    maxFalsePositiveRisk: 55,
    maxPositionPct: 35,
    grossExposurePct: 120,
    stopLossPct: 10.0,
    takeProfitPct: 22.0,
    maxHoldingDays: 30,
    notes: ['High conviction macro trade.'],
  },
  {
    id: 'hedge',
    label: 'Hedge Overlay',
    minConviction: 30,
    maxFalsePositiveRisk: 70,
    maxPositionPct: 20,
    grossExposurePct: 80,
    stopLossPct: 5.0,
    takeProfitPct: 10.0,
    maxHoldingDays: 21,
    notes: ['Hedge overlay for portfolio protection.'],
  },
];

export const SPECIAL_SYMBOL_POLICY: Record<string, ThemeSymbolAdjustment> = {
  GLD: {
    metaScorePenalty: 3,
    sizeMultiplier: 0.82,
    maxWeightMultiplier: 0.78,
  },
  TLT: {
    metaScorePenalty: 4,
    sizeMultiplier: 0.76,
    maxWeightMultiplier: 0.72,
  },
  TAIL: {
    metaScorePenalty: 6,
    sizeMultiplier: 0.62,
    maxWeightMultiplier: 0.55,
  },
  '^VIX': {
    metaScorePenalty: 12,
    sizeMultiplier: 0.24,
    maxWeightMultiplier: 0.2,
    requireRiskOff: true,
  },
};

// Theme rules
export const THEME_RULES: InvestmentThemeDefinition[] = [
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
      { symbol: 'USO', name: 'United States Oil Fund', assetKind: 'etf', sector: 'energy', commodity: 'crude oil', direction: 'long', role: 'confirm' },
      { symbol: 'XOM', name: 'Exxon Mobil', assetKind: 'equity', sector: 'energy', commodity: 'crude oil', direction: 'long', role: 'confirm' },
      { symbol: 'CVX', name: 'Chevron', assetKind: 'equity', sector: 'energy', commodity: 'crude oil', direction: 'long', role: 'confirm' },
      { symbol: 'JETS', name: 'U.S. Global Jets ETF', assetKind: 'etf', sector: 'airlines', direction: 'short', role: 'hedge' },
    ],
  },
  {
    id: 'defense-escalation',
    label: 'Defense Escalation',
    triggers: [
      'missile strike',
      'airstrike',
      'drone strike',
      'carrier group',
      'navy deployment',
      'centcom',
      'patriot missile',
      'thaad',
      'iron dome',
      'arms deal',
      'defense budget',
      'military escalation',
      'artillery barrage',
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
    triggers: ['safe haven', 'flight to safety', 'risk-off', 'volatility spike', 'yield shock', 'treasury rally', 'panic hedging'],
    sectors: ['gold', 'rates', 'volatility'],
    commodities: ['gold'],
    timeframe: '1d-7d',
    thesis: 'Risk-off macro regimes often lift gold and volatility hedges before cyclical equities adjust.',
    invalidation: ['Volatility compresses immediately', 'Gold fails to confirm on escalation', 'Rates reverse'],
    baseSensitivity: 68,
    policy: {
      classification: 'hedge-heavy',
      trigger: {
        minTriggerHits: 2,
        minStress: 0.42,
        requireDirectionalTerms: ['flight to safety', 'safe haven', 'risk-off', 'yield shock', 'panic hedging', 'volatility spike'],
      },
      assets: {
        maxPrimaryAssets: 1,
        maxConfirmAssets: 1,
        maxHedgeAssets: 1,
      },
      admission: {
        rejectHitProbability: 0.48,
        watchHitProbability: 0.56,
        rejectExpectedReturnPct: -0.02,
        watchExpectedReturnPct: 0.12,
        rejectScore: 46,
        watchScore: 58,
      },
      narrative: {
        enabled: true,
        minAlignmentScore: 52,
        weakPenalty: 4,
        mismatchPenalty: 9,
      },
      symbolAdjustments: {
        GLD: { metaScorePenalty: 2, sizeMultiplier: 0.85, maxWeightMultiplier: 0.8 },
        TLT: { metaScorePenalty: 4, sizeMultiplier: 0.78, maxWeightMultiplier: 0.72 },
        TAIL: { metaScorePenalty: 7, sizeMultiplier: 0.58, maxWeightMultiplier: 0.5 },
        '^VIX': { metaScorePenalty: 14, sizeMultiplier: 0.18, maxWeightMultiplier: 0.16, requireRiskOff: true },
      },
    },
    assets: [
      { symbol: 'GLD', name: 'SPDR Gold Shares', assetKind: 'etf', sector: 'gold', commodity: 'gold', direction: 'long', role: 'primary' },
      { symbol: '^VIX', name: 'CBOE Volatility Index', assetKind: 'rate', sector: 'volatility', direction: 'hedge', role: 'hedge' },
      { symbol: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', assetKind: 'etf', sector: 'rates', direction: 'hedge', role: 'confirm' },
      { symbol: 'TAIL', name: 'Cambria Tail Risk ETF', assetKind: 'etf', sector: 'volatility', direction: 'hedge', role: 'hedge' },
    ],
  },
  {
    id: 'russia-ukraine-war',
    label: 'Russia-Ukraine War Escalation',
    triggers: ['ukraine offensive', 'russian offensive', 'black sea corridor', 'grain corridor', 'missile barrage', 'drone strike', 'artillery barrage', 'black sea', 'crimea', 'donbas'],
    sectors: ['energy', 'agriculture', 'defense', 'shipping'],
    commodities: ['wheat', 'natural gas', 'crude oil', 'fertilizer'],
    timeframe: '2d-14d',
    thesis: 'Escalation in Russia-Ukraine conflict disrupts European energy supply, grain exports, and fertilizer production.',
    invalidation: ['Ceasefire agreement', 'De-escalation talks succeed'],
    baseSensitivity: 78,
    policy: {
      classification: 'mixed',
      trigger: {
        minTriggerHits: 2,
        minStress: 0.24,
        requireDirectionalTerms: ['offensive', 'strike', 'barrage', 'black sea', 'corridor', 'escalation', 'sanction', 'pipeline'],
      },
      assets: {
        maxPrimaryAssets: 2,
        maxConfirmAssets: 1,
        maxHedgeAssets: 1,
      },
      admission: {
        rejectHitProbability: 0.46,
        watchHitProbability: 0.54,
        rejectExpectedReturnPct: -0.06,
        watchExpectedReturnPct: 0.1,
        rejectScore: 44,
        watchScore: 56,
      },
      narrative: {
        enabled: true,
        minAlignmentScore: 50,
        weakPenalty: 3,
        mismatchPenalty: 7,
      },
      symbolAdjustments: {
        EWG: { metaScorePenalty: 4, sizeMultiplier: 0.72, maxWeightMultiplier: 0.68 },
      },
    },
    assets: [
      { symbol: 'WEAT', name: 'Teucrium Wheat Fund', assetKind: 'etf', sector: 'agriculture', commodity: 'wheat', direction: 'long', role: 'primary' },
      { symbol: 'UNG', name: 'United States Natural Gas Fund', assetKind: 'etf', sector: 'energy', commodity: 'natural gas', direction: 'long', role: 'primary' },
      { symbol: 'MOS', name: 'Mosaic Company', assetKind: 'equity', sector: 'fertilizers', commodity: 'potash', direction: 'long', role: 'confirm' },
      { symbol: 'CF', name: 'CF Industries', assetKind: 'equity', sector: 'fertilizers', commodity: 'nitrogen', direction: 'long', role: 'confirm' },
      { symbol: 'EWG', name: 'iShares MSCI Germany ETF', assetKind: 'etf', sector: 'broad-market', commodity: undefined, direction: 'short', role: 'hedge' },
    ],
  },
  {
    id: 'supply-chain-disruption',
    label: 'Global Supply Chain Disruption',
    triggers: ['supply chain', 'port congestion', 'shipping delay', 'container shortage', 'suez canal', 'panama canal', 'red sea shipping', 'freight rate', 'logistics crisis'],
    sectors: ['shipping', 'logistics', 'retail', 'manufacturing'],
    commodities: ['fertilizer', 'urea'],
    timeframe: '3d-20d',
    thesis: 'Supply chain disruptions (war, weather, labor) cause shipping rates to spike and downstream shortages in fertilizer, chemicals, and consumer goods.',
    invalidation: ['Shipping lanes reopen', 'Freight rates normalize'],
    baseSensitivity: 72,
    assets: [
      { symbol: 'BDRY', name: 'Breakwave Dry Bulk Shipping ETF', assetKind: 'etf', sector: 'shipping', commodity: undefined, direction: 'long', role: 'primary' },
      { symbol: 'FRO', name: 'Frontline', assetKind: 'equity', sector: 'shipping', commodity: undefined, direction: 'long', role: 'primary' },
      { symbol: 'STNG', name: 'Scorpio Tankers', assetKind: 'equity', sector: 'shipping', commodity: undefined, direction: 'long', role: 'confirm' },
      { symbol: 'MOS', name: 'Mosaic Company', assetKind: 'equity', sector: 'fertilizers', commodity: 'potash', direction: 'long', role: 'confirm' },
      { symbol: 'XRT', name: 'SPDR S&P Retail ETF', assetKind: 'etf', sector: 'retail', commodity: undefined, direction: 'short', role: 'hedge' },
    ],
  },
  {
    id: 'global-inflation-regime',
    label: 'Global Inflation Regime Shift',
    triggers: ['inflation', 'CPI', 'rate hike', 'interest rate', 'federal reserve', 'ECB', 'central bank', 'tightening', 'stagflation'],
    sectors: ['financials', 'real-estate', 'utilities', 'commodities'],
    commodities: ['gold', 'treasury bonds'],
    timeframe: '5d-30d',
    thesis: 'Persistent inflation forces central banks to tighten, hurting rate-sensitive sectors while benefiting commodities and short-duration assets.',
    invalidation: ['Inflation drops below target', 'Dovish policy pivot'],
    baseSensitivity: 68,
    assets: [
      { symbol: 'TIP', name: 'iShares TIPS Bond ETF', assetKind: 'etf', sector: 'fixed-income', commodity: undefined, direction: 'long', role: 'primary' },
      { symbol: 'DBC', name: 'Invesco DB Commodity Index', assetKind: 'etf', sector: 'commodities', commodity: undefined, direction: 'long', role: 'primary' },
      { symbol: 'SHY', name: 'iShares 1-3 Year Treasury', assetKind: 'etf', sector: 'fixed-income', commodity: undefined, direction: 'long', role: 'confirm' },
      { symbol: 'XLRE', name: 'Real Estate Select Sector SPDR', assetKind: 'etf', sector: 'real-estate', commodity: undefined, direction: 'short', role: 'hedge' },
      { symbol: 'XLU', name: 'Utilities Select Sector SPDR', assetKind: 'etf', sector: 'utilities', commodity: undefined, direction: 'short', role: 'hedge' },
    ],
  },
  {
    id: 'china-taiwan-risk',
    label: 'China-Taiwan Geopolitical Risk',
    triggers: ['taiwan', 'taiwan strait', 'china military', 'PLA', 'TSMC', 'chip blockade', 'south china sea', 'xi jinping'],
    sectors: ['semiconductor', 'technology', 'defense', 'shipping'],
    commodities: [],
    timeframe: '2d-14d',
    thesis: 'Rising China-Taiwan tensions threaten global semiconductor supply (TSMC produces 90% of advanced chips) and Asian shipping routes.',
    invalidation: ['Diplomatic resolution', 'US-China talks succeed'],
    baseSensitivity: 82,
    assets: [
      { symbol: 'TSM', name: 'Taiwan Semiconductor', assetKind: 'equity', sector: 'semiconductor', commodity: undefined, direction: 'short', role: 'primary' },
      { symbol: 'SMH', name: 'VanEck Semiconductor ETF', assetKind: 'etf', sector: 'semiconductor', commodity: undefined, direction: 'short', role: 'primary' },
      { symbol: 'KWEB', name: 'KraneShares CSI China Internet ETF', assetKind: 'etf', sector: 'technology', commodity: undefined, direction: 'short', role: 'confirm' },
      { symbol: 'LMT', name: 'Lockheed Martin', assetKind: 'equity', sector: 'defense', commodity: undefined, direction: 'long', role: 'hedge' },
      { symbol: 'GLD', name: 'SPDR Gold Shares', assetKind: 'etf', sector: 'precious-metals', commodity: 'gold', direction: 'long', role: 'hedge' },
    ],
  },
  {
    id: 'ai-regulation-disruption',
    label: 'AI Regulation & Disruption',
    triggers: ['AI regulation', 'artificial intelligence ban', 'AI safety', 'AI executive order', 'deepfake', 'AI copyright', 'generative AI'],
    sectors: ['technology', 'cloud', 'software'],
    commodities: [],
    timeframe: '3d-14d',
    thesis: 'Aggressive AI regulation creates winners (compliance tools) and losers (AI-dependent growth stocks) while data center demand shifts.',
    invalidation: ['Pro-innovation policy shift', 'Industry self-regulation accepted'],
    baseSensitivity: 65,
    assets: [
      { symbol: 'NVDA', name: 'NVIDIA', assetKind: 'equity', sector: 'semiconductor', commodity: undefined, direction: 'short', role: 'primary' },
      { symbol: 'MSFT', name: 'Microsoft', assetKind: 'equity', sector: 'technology', commodity: undefined, direction: 'short', role: 'confirm' },
      { symbol: 'PLTR', name: 'Palantir Technologies', assetKind: 'equity', sector: 'software', commodity: undefined, direction: 'long', role: 'hedge' },
      { symbol: 'CIBR', name: 'First Trust Cybersecurity ETF', assetKind: 'etf', sector: 'cybersecurity', commodity: undefined, direction: 'long', role: 'hedge' },
    ],
  },
];

// Universe asset catalog
export const UNIVERSE_ASSET_CATALOG: UniverseAssetDefinition[] = [
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
  { symbol: 'IAU', name: 'iShares Gold Trust', assetKind: 'etf', sector: 'gold', commodity: 'gold', direction: 'watch', role: 'hedge', themeIds: ['safe-haven-repricing'], liquidityTier: 'high', aliases: ['gold trust'] },
  { symbol: 'TAIL', name: 'Cambria Tail Risk ETF', assetKind: 'etf', sector: 'volatility', direction: 'hedge', role: 'hedge', themeIds: ['safe-haven-repricing'], liquidityTier: 'medium', aliases: ['tail risk', 'put hedge'] },
  { symbol: 'UUP', name: 'Invesco DB US Dollar Index Bullish Fund', assetKind: 'etf', sector: 'fx', direction: 'hedge', role: 'hedge', themeIds: ['safe-haven-repricing'], liquidityTier: 'medium', aliases: ['dollar index', 'usd strength'] },
  { symbol: 'SHY', name: 'iShares 1-3 Year Treasury Bond ETF', assetKind: 'etf', sector: 'rates', direction: 'hedge', role: 'confirm', themeIds: ['safe-haven-repricing'], liquidityTier: 'high', aliases: ['short treasury'] },
  { symbol: 'GOVT', name: 'iShares U.S. Treasury Bond ETF', assetKind: 'etf', sector: 'rates', direction: 'hedge', role: 'confirm', themeIds: ['safe-haven-repricing'], liquidityTier: 'high', aliases: ['treasury bond'] },
];
