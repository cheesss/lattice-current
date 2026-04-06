export interface AssetRecommendation {
  symbol: string;
  name: string;
  direction: 'long' | 'short' | 'hedge';
  themeId: string;
  themeLabel: string;
  score: number;
  optimalHorizonHours: number;
  horizonReturns: HorizonReturnStat[];
  rationale: RecommendationRationale;
}

export interface HorizonReturnStat {
  horizonHours: number;
  avgReturnPct: number;
  bestReturnPct: number;
  worstReturnPct: number;
  maxDrawdownPct: number;
  winRate: number;
  sampleCount: number;
  confidenceLevel: 'high' | 'medium' | 'low';
}

export interface RecommendationRationale {
  newsCount24h: number;
  topHeadlines: string[];
  transmissionStrength: number;
  transferEntropy: number;
  leadLagHours: number;
  regimeContext: string;
  corroborationSources: number;
  confirmationState: string;
}

export interface SwimlaneData {
  themeId: string;
  themeLabel: string;
  intensityTimeSeries: { timestamp: number; intensity: number }[];
  predictedDecay: { timestamp: number; intensity: number; uncertainty: number }[];
}

export interface TimelineEvent {
  id: string;
  timestamp: number;
  title: string;
  intensity: number;
  sources: string[];
  themeIds: string[];
}

export interface ThemeOverlapResult {
  themeIds: string[];
  overlapStart: number;
  overlapEnd: number | null;
  combinedEffect: { symbol: string; avgReturnPct: number; singleThemeAvg: number }[];
}

export interface ScrubberSnapshot {
  timestamp: number;
  topRecommendations: { symbol: string; score: number; actual48hReturn: number | null }[];
  themeIntensities: { themeId: string; intensity: number }[];
}

export interface ScenarioInput {
  themeId: string;
  intensity: number;
}

export interface ScenarioInterpretation {
  themeId: string;
  intensity: number;
  direction: 'escalation' | 'de-escalation' | 'stable';
  expectedImpact: string;
  riskFactors: string[];
  topBeneficiaries: string[];
}

export interface ScenarioResult {
  currentState: Record<string, Record<string, number>>;
  scenarioState: Record<string, Record<string, number>>;
  decayCurve: { currentBetaHours: number; scenarioBetaHours: number };
  interpretation?: ScenarioInterpretation[];
}

export interface UserAlert {
  id: string;
  type: 'theme-intensity' | 'asset-momentum' | 'event-similarity';
  target: string;
  condition: 'above' | 'below';
  threshold: number;
  enabled: boolean;
  createdAt: string;
}

export interface ThemeIntensityData {
  themeId: string;
  themeLabel: string;
  currentIntensity: number;
  fittedBetaHours: number;
  excitationMass: number;
  alpha: number;
  intensityTimeSeries: { timestamp: string; intensity: number }[];
  predictedDecay: { hoursFromNow: number; intensity: number; uncertainty: number }[];
}

export interface SankeyFlowData {
  events: { id: string; label: string }[];
  themes: { id: string; label: string }[];
  assets: { id: string; label: string; returnPct: number }[];
  links: { source: string; target: string; strength: number; direction: 'positive' | 'negative' }[];
}

export interface RecommendationsResponse {
  recommendations: AssetRecommendation[];
  correlationMatrix: { symbols: string[]; correlations: number[][] };
  regime: { id: string; confidence: number } | null;
}

export interface ThemeIntensityResponse {
  themes: ThemeIntensityData[];
  sankeyFlow: SankeyFlowData;
}

export interface ImpactTimelineResponse {
  events: (TimelineEvent & { assetImpacts: Record<string, Record<string, number>> })[];
  overlaps: ThemeOverlapResult[];
  scrubberSnapshots: ScrubberSnapshot[];
}
