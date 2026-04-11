import type { PanelConfig, MapLayers } from '@/types';
import type { DataSourceId } from '@/services/data-freshness';
import { SITE_VARIANT } from './variant';

const EXTENDED_LAYER_DEFAULTS: Pick<
  MapLayers,
  'iranAttacks' | 'gpsJamming' | 'ciiChoropleth' | 'dayNight' | 'miningSites' | 'processingPlants' | 'commodityPorts' | 'intelDensity'
> = {
  iranAttacks: false,
  gpsJamming: false,
  ciiChoropleth: false,
  dayNight: false,
  miningSites: false,
  processingPlants: false,
  commodityPorts: false,
  intelDensity: false,
};

export const SOURCE_DRAWER_ONLY_PANEL_KEYS = [
  'politics',
  'intel',
  'glint-feed',
  'events',
  'us',
  'europe',
  'middleeast',
  'africa',
  'latam',
  'asia',
  'energy',
  'gov',
  'thinktanks',
  'tech',
  'finance',
  'ai',
  'startups',
  'vcblogs',
  'regionalStartups',
  'unicorns',
  'accelerators',
  'funding',
  'producthunt',
  'security',
  'policy',
  'hardware',
  'cloud',
  'dev',
  'github',
  'ipo',
  'markets-news',
  'commodities-news',
  'crypto-news',
  'economic-news',
  'forex',
  'bonds',
  'centralbanks',
  'analysis',
  'fintech',
  'regulation',
  'institutional',
  'gccNews',
  'gold-silver',
  'mining-news',
  'critical-minerals',
  'base-metals',
  'mining-companies',
  'commodity-news',
  'layoffs',
] as const;

const SOURCE_DRAWER_ONLY_PANEL_KEY_SET = new Set<string>(SOURCE_DRAWER_ONLY_PANEL_KEYS);

export function isSourceDrawerOnlyPanelKey(key: string): boolean {
  return SOURCE_DRAWER_ONLY_PANEL_KEY_SET.has(key);
}

function buildSignalSurfacePanels(panels: Record<string, PanelConfig>): Record<string, PanelConfig> {
  return Object.fromEntries(
    Object.entries(panels).map(([key, config]) => {
      if (!isSourceDrawerOnlyPanelKey(key)) {
        return [key, config];
      }
      return [key, {
        ...config,
        enabled: false,
        priority: Math.max(config.priority ?? 3, 3),
      }];
    }),
  );
}

// ============================================
// FULL VARIANT (Geopolitical)
// ============================================
// Panel order matters! First panels appear at top of grid.
// Desired order: live-news, AI Insights, AI Strategic Posture, cii, strategic-risk, then rest
const FULL_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Global Map', enabled: true, priority: 1 },
  'live-news': { name: 'Live News', enabled: true, priority: 1 },
  'live-webcams': { name: 'Live Webcams', enabled: true, priority: 2 },
  insights: { name: 'AI Insights', enabled: true, priority: 1 },
  'strategic-posture': { name: 'AI Strategic Posture', enabled: true, priority: 1 },
  cii: { name: 'Country Instability', enabled: true, priority: 1 },
  'strategic-risk': { name: 'Strategic Risk Overview', enabled: true, priority: 1 },
  intel: { name: 'Intel Feed', enabled: true, priority: 2 },
  'glint-feed': { name: 'Glint Feed', enabled: true, priority: 2 },
  'gdelt-intel': { name: 'Live Intelligence', enabled: true, priority: 1 },
  'event-intelligence': { name: 'Event Intelligence', enabled: true, priority: 1 },
  'macro-signals': { name: 'Market Radar', enabled: true, priority: 1 },
  'signal-ridgeline': { name: 'Signal Ridge', enabled: true, priority: 1 },
  'transmission-sankey': { name: 'Flow Sankey', enabled: true, priority: 1 },
  'cross-asset-tape': { name: 'Cross-Asset Tape', enabled: true, priority: 1 },
  'dataflow-ops': { name: 'Data Flow Ops', enabled: true, priority: 1 },
  'source-ops': { name: 'Source Operations', enabled: true, priority: 1 },
  cascade: { name: 'Infrastructure Cascade', enabled: true, priority: 2 },
  politics: { name: 'World News', enabled: true, priority: 2 },
  us: { name: 'United States', enabled: true, priority: 2 },
  europe: { name: 'Europe', enabled: true, priority: 2 },
  middleeast: { name: 'Middle East', enabled: true, priority: 2 },
  africa: { name: 'Africa', enabled: true, priority: 2 },
  latam: { name: 'Latin America', enabled: true, priority: 2 },
  asia: { name: 'Asia-Pacific', enabled: true, priority: 2 },
  energy: { name: 'Energy & Resources', enabled: true, priority: 2 },
  gov: { name: 'Government', enabled: true, priority: 2 },
  thinktanks: { name: 'Think Tanks', enabled: true, priority: 2 },
  polymarket: { name: 'Predictions', enabled: true, priority: 2 },
  commodities: { name: 'Commodities', enabled: true, priority: 2 },
  markets: { name: 'Markets', enabled: true, priority: 2 },
  'event-impact-screener': { name: 'Event Impact Screener', enabled: true, priority: 2 },
  'country-exposure-matrix': { name: 'Country Exposure Matrix', enabled: true, priority: 2 },
  'investment-workflow': { name: 'Decision Workflow', enabled: true, priority: 2 },
  'investment-ideas': { name: 'Signal Candidates', enabled: true, priority: 2 },
  'backtest-lab': { name: 'Replay Validation', enabled: true, priority: 3 },
  'resource-profiler': { name: 'Resource Profiler', enabled: false, priority: 3 },
  'data-qa': { name: 'Data Q&A', enabled: false, priority: 3 },
  economic: { name: 'Economic Indicators', enabled: true, priority: 2 },
  'trade-policy': { name: 'Trade Policy', enabled: true, priority: 2 },
  'supply-chain': { name: 'Supply Chain', enabled: true, priority: 2 },
  finance: { name: 'Financial', enabled: true, priority: 2 },
  tech: { name: 'Technology', enabled: true, priority: 2 },
  crypto: { name: 'Crypto', enabled: true, priority: 2 },
  heatmap: { name: 'Sector Heatmap', enabled: true, priority: 2 },
  ai: { name: 'AI/ML', enabled: true, priority: 2 },
  layoffs: { name: 'Layoffs Tracker', enabled: true, priority: 2 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
  'satellite-fires': { name: 'Fires', enabled: true, priority: 2 },
  'etf-flows': { name: 'BTC ETF Tracker', enabled: true, priority: 2 },
  stablecoins: { name: 'Stablecoins', enabled: true, priority: 2 },
  'ucdp-events': { name: 'UCDP Conflict Events', enabled: true, priority: 2 },
  giving: { name: 'Global Giving', enabled: false, priority: 2 },
  displacement: { name: 'UNHCR Displacement', enabled: true, priority: 2 },
  climate: { name: 'Climate Anomalies', enabled: true, priority: 2 },
  'population-exposure': { name: 'Population Exposure', enabled: true, priority: 2 },
};

const FULL_MAP_LAYERS: MapLayers = {
  ...EXTENDED_LAYER_DEFAULTS,
  conflicts: true,
  bases: true,
  cables: false,
  pipelines: false,
  hotspots: true,
  ais: false,
  nuclear: true,
  irradiators: false,
  sanctions: true,
  weather: true,
  economic: true,
  waterways: true,
  outages: true,
  cyberThreats: false,
  datacenters: false,
  protests: false,
  flights: false,
  military: true,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (disabled in full variant)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance layers (disabled in full variant)
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
  // Happy variant layers
  positiveEvents: false,
  kindness: false,
  happiness: false,
  speciesRecovery: false,
  renewableInstallations: false,
  tradeRoutes: false,
};

const FULL_MOBILE_MAP_LAYERS: MapLayers = {
  ...EXTENDED_LAYER_DEFAULTS,
  conflicts: true,
  bases: false,
  cables: false,
  pipelines: false,
  hotspots: true,
  ais: false,
  nuclear: false,
  irradiators: false,
  sanctions: true,
  weather: true,
  economic: false,
  waterways: false,
  outages: true,
  cyberThreats: false,
  datacenters: false,
  protests: false,
  flights: false,
  military: false,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (disabled in full variant)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance layers (disabled in full variant)
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
  // Happy variant layers
  positiveEvents: false,
  kindness: false,
  happiness: false,
  speciesRecovery: false,
  renewableInstallations: false,
  tradeRoutes: false,
};

// ============================================
// TECH VARIANT (Tech/AI/Startups)
// ============================================
const TECH_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Global Tech Map', enabled: true, priority: 1 },
  'live-news': { name: 'Tech Headlines', enabled: true, priority: 1 },
  'live-webcams': { name: 'Live Webcams', enabled: true, priority: 2 },
  insights: { name: 'AI Insights', enabled: true, priority: 1 },
  ai: { name: 'AI/ML News', enabled: true, priority: 1 },
  tech: { name: 'Technology', enabled: true, priority: 1 },
  startups: { name: 'Startups & VC', enabled: true, priority: 1 },
  vcblogs: { name: 'VC Insights & Essays', enabled: true, priority: 1 },
  regionalStartups: { name: 'Global Startup News', enabled: true, priority: 1 },
  unicorns: { name: 'Unicorn Tracker', enabled: true, priority: 1 },
  accelerators: { name: 'Accelerators & Demo Days', enabled: true, priority: 1 },
  security: { name: 'Cybersecurity', enabled: true, priority: 1 },
  policy: { name: 'AI Policy & Regulation', enabled: true, priority: 1 },
  regulation: { name: 'AI Regulation Dashboard', enabled: true, priority: 1 },
  layoffs: { name: 'Layoffs Tracker', enabled: true, priority: 1 },
  markets: { name: 'Tech Stocks', enabled: true, priority: 2 },
  'cross-asset-tape': { name: 'Cross-Asset Tape', enabled: true, priority: 2 },
  'event-impact-screener': { name: 'Event Impact Screener', enabled: true, priority: 2 },
  'country-exposure-matrix': { name: 'Country Exposure Matrix', enabled: true, priority: 2 },
  finance: { name: 'Financial News', enabled: true, priority: 2 },
  crypto: { name: 'Crypto', enabled: true, priority: 2 },
  hardware: { name: 'Semiconductors & Hardware', enabled: true, priority: 2 },
  cloud: { name: 'Cloud & Infrastructure', enabled: true, priority: 2 },
  dev: { name: 'Developer Community', enabled: true, priority: 2 },
  github: { name: 'GitHub Trending', enabled: true, priority: 1 },
  ipo: { name: 'IPO & SPAC', enabled: true, priority: 2 },
  polymarket: { name: 'Tech Predictions', enabled: true, priority: 2 },
  funding: { name: 'Funding & VC', enabled: true, priority: 1 },
  producthunt: { name: 'Product Hunt', enabled: true, priority: 1 },
  events: { name: 'Tech Events', enabled: true, priority: 1 },
  'event-intelligence': { name: 'Event Intelligence', enabled: true, priority: 1 },
  'macro-signals': { name: 'Market Radar', enabled: true, priority: 1 },
  'signal-ridgeline': { name: 'Signal Ridge', enabled: true, priority: 1 },
  'transmission-sankey': { name: 'Flow Sankey', enabled: true, priority: 1 },
  'dataflow-ops': { name: 'Data Flow Ops', enabled: true, priority: 1 },
  'source-ops': { name: 'Source Operations', enabled: true, priority: 1 },
  'service-status': { name: 'Service Status', enabled: true, priority: 2 },
  economic: { name: 'Economic Indicators', enabled: true, priority: 2 },
  'tech-readiness': { name: 'Tech Readiness Index', enabled: true, priority: 1 },
  'etf-flows': { name: 'BTC ETF Tracker', enabled: true, priority: 2 },
  stablecoins: { name: 'Stablecoins', enabled: true, priority: 2 },
  'investment-workflow': { name: 'Decision Workflow', enabled: true, priority: 2 },
  'investment-ideas': { name: 'Signal Candidates', enabled: true, priority: 2 },
  'backtest-lab': { name: 'Replay Validation', enabled: true, priority: 3 },
  'resource-profiler': { name: 'Resource Profiler', enabled: false, priority: 3 },
  'data-qa': { name: 'Data Q&A', enabled: false, priority: 3 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

const TECH_MAP_LAYERS: MapLayers = {
  ...EXTENDED_LAYER_DEFAULTS,
  conflicts: false,
  bases: false,
  cables: true,
  pipelines: false,
  hotspots: false,
  ais: false,
  nuclear: false,
  irradiators: false,
  sanctions: false,
  weather: true,
  economic: true,
  waterways: false,
  outages: true,
  cyberThreats: false,
  datacenters: true,
  protests: false,
  flights: false,
  military: false,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (enabled in tech variant)
  startupHubs: true,
  cloudRegions: true,
  accelerators: false,
  techHQs: true,
  techEvents: true,
  // Finance layers (disabled in tech variant)
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
  // Happy variant layers
  positiveEvents: false,
  kindness: false,
  happiness: false,
  speciesRecovery: false,
  renewableInstallations: false,
  tradeRoutes: false,
};

const TECH_MOBILE_MAP_LAYERS: MapLayers = {
  ...EXTENDED_LAYER_DEFAULTS,
  conflicts: false,
  bases: false,
  cables: false,
  pipelines: false,
  hotspots: false,
  ais: false,
  nuclear: false,
  irradiators: false,
  sanctions: false,
  weather: false,
  economic: false,
  waterways: false,
  outages: true,
  cyberThreats: false,
  datacenters: true,
  protests: false,
  flights: false,
  military: false,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (limited on mobile)
  startupHubs: true,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: true,
  // Finance layers (disabled in tech variant)
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
  // Happy variant layers
  positiveEvents: false,
  kindness: false,
  happiness: false,
  speciesRecovery: false,
  renewableInstallations: false,
  tradeRoutes: false,
};

// ============================================
// FINANCE VARIANT (Markets/Trading)
// ============================================
const FINANCE_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Global Markets Map', enabled: true, priority: 1 },
  'live-news': { name: 'Market Headlines', enabled: true, priority: 1 },
  'live-webcams': { name: 'Live Webcams', enabled: true, priority: 2 },
  insights: { name: 'AI Market Insights', enabled: true, priority: 1 },
  markets: { name: 'Live Markets', enabled: true, priority: 1 },
  'cross-asset-tape': { name: 'Cross-Asset Tape', enabled: true, priority: 1 },
  'event-impact-screener': { name: 'Event Impact Screener', enabled: true, priority: 1 },
  'country-exposure-matrix': { name: 'Country Exposure Matrix', enabled: true, priority: 1 },
  'event-intelligence': { name: 'Event Intelligence', enabled: true, priority: 1 },
  'macro-signals': { name: 'Market Radar', enabled: true, priority: 1 },
  'signal-ridgeline': { name: 'Signal Ridge', enabled: true, priority: 1 },
  'transmission-sankey': { name: 'Flow Sankey', enabled: true, priority: 1 },
  'dataflow-ops': { name: 'Data Flow Ops', enabled: true, priority: 1 },
  'source-ops': { name: 'Source Operations', enabled: true, priority: 1 },
  'investment-workflow': { name: 'Decision Workflow', enabled: true, priority: 2 },
  'investment-ideas': { name: 'Signal Candidates', enabled: true, priority: 2 },
  'backtest-lab': { name: 'Replay Validation', enabled: true, priority: 3 },
  'resource-profiler': { name: 'Resource Profiler', enabled: false, priority: 3 },
  'data-qa': { name: 'Data Q&A', enabled: false, priority: 3 },
  'markets-news': { name: 'Markets News', enabled: true, priority: 2 },
  forex: { name: 'Forex & Currencies', enabled: true, priority: 1 },
  bonds: { name: 'Fixed Income', enabled: true, priority: 1 },
  commodities: { name: 'Commodities & Futures', enabled: true, priority: 1 },
  'commodities-news': { name: 'Commodities News', enabled: true, priority: 2 },
  crypto: { name: 'Crypto & Digital Assets', enabled: true, priority: 1 },
  'crypto-news': { name: 'Crypto News', enabled: true, priority: 2 },
  centralbanks: { name: 'Central Bank Watch', enabled: true, priority: 1 },
  economic: { name: 'Economic Data', enabled: true, priority: 1 },
  'trade-policy': { name: 'Trade Policy', enabled: true, priority: 1 },
  'supply-chain': { name: 'Supply Chain', enabled: true, priority: 1 },
  'economic-news': { name: 'Economic News', enabled: true, priority: 2 },
  ipo: { name: 'IPOs, Earnings & M&A', enabled: true, priority: 1 },
  heatmap: { name: 'Sector Heatmap', enabled: true, priority: 1 },
  derivatives: { name: 'Derivatives & Options', enabled: true, priority: 2 },
  fintech: { name: 'Fintech & Trading Tech', enabled: true, priority: 2 },
  regulation: { name: 'Financial Regulation', enabled: true, priority: 2 },
  institutional: { name: 'Hedge Funds & PE', enabled: true, priority: 2 },
  analysis: { name: 'Market Analysis', enabled: true, priority: 2 },
  'etf-flows': { name: 'BTC ETF Tracker', enabled: true, priority: 2 },
  stablecoins: { name: 'Stablecoins', enabled: true, priority: 2 },
  'gcc-investments': { name: 'GCC Investments', enabled: true, priority: 2 },
  gccNews: { name: 'GCC Business News', enabled: true, priority: 2 },
  polymarket: { name: 'Predictions', enabled: true, priority: 2 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

const FINANCE_MAP_LAYERS: MapLayers = {
  ...EXTENDED_LAYER_DEFAULTS,
  conflicts: false,
  bases: false,
  cables: true,
  pipelines: true,
  hotspots: false,
  ais: false,
  nuclear: false,
  irradiators: false,
  sanctions: true,
  weather: true,
  economic: true,
  waterways: true,
  outages: true,
  cyberThreats: false,
  datacenters: false,
  protests: false,
  flights: false,
  military: false,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (disabled in finance variant)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance layers (enabled in finance variant)
  stockExchanges: true,
  financialCenters: true,
  centralBanks: true,
  commodityHubs: false,
  gulfInvestments: false,
  // Happy variant layers
  positiveEvents: false,
  kindness: false,
  happiness: false,
  speciesRecovery: false,
  renewableInstallations: false,
  tradeRoutes: true,
};

const FINANCE_MOBILE_MAP_LAYERS: MapLayers = {
  ...EXTENDED_LAYER_DEFAULTS,
  conflicts: false,
  bases: false,
  cables: false,
  pipelines: false,
  hotspots: false,
  ais: false,
  nuclear: false,
  irradiators: false,
  sanctions: false,
  weather: false,
  economic: true,
  waterways: false,
  outages: true,
  cyberThreats: false,
  datacenters: false,
  protests: false,
  flights: false,
  military: false,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (disabled)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance layers (limited on mobile)
  stockExchanges: true,
  financialCenters: false,
  centralBanks: true,
  commodityHubs: false,
  gulfInvestments: false,
  // Happy variant layers
  positiveEvents: false,
  kindness: false,
  happiness: false,
  speciesRecovery: false,
  renewableInstallations: false,
  tradeRoutes: false,
};

// ============================================
// HAPPY VARIANT (Good News & Progress)
// ============================================
const HAPPY_PANELS: Record<string, PanelConfig> = {
  map: { name: 'World Map', enabled: true, priority: 1 },
  'positive-feed': { name: 'Good News Feed', enabled: true, priority: 1 },
  progress: { name: 'Human Progress', enabled: true, priority: 1 },
  counters: { name: 'Live Counters', enabled: true, priority: 1 },
  spotlight: { name: "Today's Hero", enabled: true, priority: 1 },
  breakthroughs: { name: 'Breakthroughs', enabled: true, priority: 1 },
  digest: { name: '5 Good Things', enabled: true, priority: 1 },
  species: { name: 'Conservation Wins', enabled: true, priority: 1 },
  renewable: { name: 'Renewable Energy', enabled: true, priority: 1 },
  giving: { name: 'Global Giving', enabled: true, priority: 1 },
};

const HAPPY_MAP_LAYERS: MapLayers = {
  ...EXTENDED_LAYER_DEFAULTS,
  conflicts: false,
  bases: false,
  cables: false,
  pipelines: false,
  hotspots: false,
  ais: false,
  nuclear: false,
  irradiators: false,
  sanctions: false,
  weather: false,
  economic: false,
  waterways: false,
  outages: false,
  cyberThreats: false,
  datacenters: false,
  protests: false,
  flights: false,
  military: false,
  natural: false,
  spaceports: false,
  minerals: false,
  fires: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (disabled)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance layers (disabled)
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
  // Happy variant layers
  positiveEvents: true,
  kindness: true,
  happiness: true,
  speciesRecovery: true,
  renewableInstallations: true,
  tradeRoutes: false,
};

const HAPPY_MOBILE_MAP_LAYERS: MapLayers = {
  ...EXTENDED_LAYER_DEFAULTS,
  conflicts: false,
  bases: false,
  cables: false,
  pipelines: false,
  hotspots: false,
  ais: false,
  nuclear: false,
  irradiators: false,
  sanctions: false,
  weather: false,
  economic: false,
  waterways: false,
  outages: false,
  cyberThreats: false,
  datacenters: false,
  protests: false,
  flights: false,
  military: false,
  natural: false,
  spaceports: false,
  minerals: false,
  fires: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (disabled)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance layers (disabled)
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
  // Happy variant layers
  positiveEvents: true,
  kindness: true,
  happiness: true,
  speciesRecovery: true,
  renewableInstallations: true,
  tradeRoutes: false,
};

// ============================================
// VARIANT-AWARE EXPORTS
// ============================================
export const DEFAULT_PANELS = SITE_VARIANT === 'happy'
  ? HAPPY_PANELS
  : SITE_VARIANT === 'tech'
    ? buildSignalSurfacePanels(TECH_PANELS)
    : SITE_VARIANT === 'finance'
      ? buildSignalSurfacePanels(FINANCE_PANELS)
      : buildSignalSurfacePanels(FULL_PANELS);
export const DEFAULT_MAP_LAYERS = SITE_VARIANT === 'happy' ? HAPPY_MAP_LAYERS : SITE_VARIANT === 'tech' ? TECH_MAP_LAYERS : SITE_VARIANT === 'finance' ? FINANCE_MAP_LAYERS : FULL_MAP_LAYERS;
export const MOBILE_DEFAULT_MAP_LAYERS = SITE_VARIANT === 'happy' ? HAPPY_MOBILE_MAP_LAYERS : SITE_VARIANT === 'tech' ? TECH_MOBILE_MAP_LAYERS : SITE_VARIANT === 'finance' ? FINANCE_MOBILE_MAP_LAYERS : FULL_MOBILE_MAP_LAYERS;

/** Maps map-layer toggle keys to their data-freshness source IDs (single source of truth). */
export const LAYER_TO_SOURCE: Partial<Record<keyof MapLayers, DataSourceId[]>> = {
  military: ['opensky', 'wingbits'],
  ais: ['ais', 'portwatch'],
  natural: ['usgs'],
  weather: ['weather'],
  outages: ['outages'],
  cyberThreats: ['cyber_threats'],
  protests: ['acled', 'gdelt_doc'],
  ucdpEvents: ['ucdp_events'],
  displacement: ['unhcr'],
  climate: ['climate'],
  intelDensity: ['rss', 'gdelt', 'gdelt_doc', 'opensky', 'wingbits', 'ais', 'outages', 'cyber_threats'],
};

// ============================================
// PANEL CATEGORY MAP
// ============================================
// Settings categories follow the signal-first operator loop rather than the
// historical variant-specific panel walls. A category is shown only when the
// active panel set exposes at least one matching panel.
export interface PanelCategoryDefinition {
  label: string;
  labelKey?: string;
  panelKeys: string[];
  variants?: string[];
}

export const PANEL_CATEGORY_MAP: Record<string, PanelCategoryDefinition> = {
  // All variants — essential panels
  signalLoop: {
    label: 'Signal Loop',
    panelKeys: [
      'live-news',
      'live-webcams',
      'insights',
      'strategic-posture',
      'strategic-risk',
      'cii',
      'gdelt-intel',
      'event-intelligence',
      'signal-ridgeline',
      'positive-feed',
      'progress',
      'counters',
      'spotlight',
      'renewable',
      'giving',
    ],
  },

  briefing: {
    label: 'Briefing',
    panelKeys: [
      'map',
      'cascade',
      'satellite-fires',
      'ucdp-events',
      'displacement',
      'climate',
      'population-exposure',
    ],
  },
  marketImpact: {
    label: 'Market Impact',
    panelKeys: [
      'macro-signals',
      'transmission-sankey',
      'markets',
      'commodities',
      'finance',
      'crypto',
      'economic',
      'polymarket',
      'heatmap',
      'trade-policy',
      'supply-chain',
      'etf-flows',
      'stablecoins',
    ],
  },
  watchlist: {
    label: 'Watchlist',
    panelKeys: [
      'monitors',
      'investment-workflow',
      'investment-ideas',
    ],
  },
  validation: {
    label: 'Validate',
    panelKeys: [
      'backtest-lab',
      'cross-asset-tape',
      'event-impact-screener',
      'country-exposure-matrix',
    ],
  },
  operations: {
    label: 'Operate',
    panelKeys: [
      'dataflow-ops',
      'source-ops',
      'data-qa',
      'resource-profiler',
      'runtime-config',
      'service-status',
      'tech-readiness',
      'codex-ops',
    ],
  },
};

// Monitor palette — fixed category colors persisted to localStorage (not theme-dependent)
export const MONITOR_COLORS = [
  '#44ff88',
  '#ff8844',
  '#4488ff',
  '#ff44ff',
  '#ffff44',
  '#ff4444',
  '#44ffff',
  '#88ff44',
  '#ff88ff',
  '#88ffff',
];

export const STORAGE_KEYS = {
  panels: 'worldmonitor-panels',
  monitors: 'worldmonitor-monitors',
  mapLayers: 'worldmonitor-layers',
  disabledFeeds: 'worldmonitor-disabled-feeds',
} as const;
