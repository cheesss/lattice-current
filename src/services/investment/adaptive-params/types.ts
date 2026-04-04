export interface AdaptiveParamsConfig {
  enabled: boolean;
  modules: {
    atrStops: boolean;
    kellySizing: boolean;
    convictionRegression: boolean;
    kalmanAutoTune: boolean;
    autonomyPercentiles: boolean;
    sourceCredWeights: boolean;
    themeSensitivity: boolean;
    executionCosts: boolean;
  };
}

export interface AtrStopResult { stopLossPct: number; takeProfitPct: number }
export interface KalmanNoiseResult { processNoise: number; measurementNoise: number }
export interface SourceCredibilityWeights {
  corroboration: number;
  historicalAccuracy: number;
  posteriorAccuracy: number;
  truthAgreement: number;
  emReliability: number;
  feedHealth: number;
  propagandaRisk: number;
}
export interface AutonomyThresholds { abstainFloor: number; shadowFloor: number; watchFloor: number }

export interface PricePoint { ts: number; price: number }

export interface AdaptiveParamsInput {
  priceSeries: Map<string, PricePoint[]>;
  forwardReturns: Array<{ ideaRunId?: string; symbol?: string; signedReturnPct?: number | null; costAdjustedSignedReturnPct?: number | null; spreadBps?: number; slippageBps?: number; horizonHours?: number }>;
  ideaRuns: Array<{ id?: string; themeId?: string; conviction?: number; sizePct?: number; direction?: string; symbols?: Array<{ symbol: string }> }>;
  mappingStats: Map<string, { posteriorWinRate: number; emaReturnPct: number; emaWorstReturnPct?: number; observations: number }>;
  sourceProfiles: Array<{ id: string; credibilityScore: number; corroborationScore: number; historicalAccuracyScore: number; posteriorAccuracyScore: number; truthAgreementScore: number; emReliabilityScore: number; feedHealthScore: number; propagandaRiskScore: number }>;
  themeHorizonProfiles: Array<{ themeId: string; preferredHorizonHours?: number }>;
}

export interface AdaptiveParameterStore {
  readonly ready: boolean;
  readonly computedAt: string | null;
  readonly config: AdaptiveParamsConfig;
  compute(input: AdaptiveParamsInput): void;
  stopLossPct(symbol: string, fallback: number): number;
  takeProfitPct(symbol: string, fallback: number): number;
  maxHoldingDays(themeId: string, fallback: number): number;
  maxPositionPct(themeId: string, symbol: string, direction: string, fallback: number): number;
  kalmanProcessNoise(symbol: string): number;
  kalmanMeasurementNoise(symbol: string): number;
  autonomyThresholds(): AutonomyThresholds;
  sourceCredWeights(): SourceCredibilityWeights;
  baseSensitivity(themeId: string, fallback: number): number;
  spreadBps(assetKind: string): number;
  slippageBps(assetKind: string): number;
}

export const DEFAULT_CONFIG: AdaptiveParamsConfig = {
  enabled: true,
  modules: {
    atrStops: true,
    kellySizing: false,
    convictionRegression: false, // requires prior run data
    kalmanAutoTune: true,
    autonomyPercentiles: false, // requires prior run data
    sourceCredWeights: false,   // requires prior run data
    themeSensitivity: true,     // requires prior run data
    executionCosts: true,       // requires prior run data
  },
};

export const DEFAULT_SOURCE_CRED_WEIGHTS: SourceCredibilityWeights = {
  corroboration: 0.22,
  historicalAccuracy: 0.14,
  posteriorAccuracy: 0.12,
  truthAgreement: 0.14,
  emReliability: 0.14,
  feedHealth: 0.14,
  propagandaRisk: 0.10,
};

export const DEFAULT_AUTONOMY: AutonomyThresholds = {
  abstainFloor: 18,
  shadowFloor: 30,
  watchFloor: 42,
};
