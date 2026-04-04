import type {
  AdaptiveParameterStore, AdaptiveParamsConfig, AdaptiveParamsInput,
  AtrStopResult, KalmanNoiseResult, SourceCredibilityWeights, AutonomyThresholds,
} from './types';
import { DEFAULT_CONFIG, DEFAULT_SOURCE_CRED_WEIGHTS, DEFAULT_AUTONOMY } from './types';
import { computeAtrStops } from './atr-stops';
import { computeKellySizing } from './kelly-sizing';
import { computeKalmanNoise } from './kalman-auto-tune';
import { computeAutonomyThresholds } from './autonomy-percentiles';
import { computeThemeSensitivities } from './theme-sensitivity';

export class AdaptiveParameterStoreImpl implements AdaptiveParameterStore {
  readonly config: AdaptiveParamsConfig;
  ready = false;
  computedAt: string | null = null;

  private atrStops = new Map<string, AtrStopResult>();
  private kellySizes = new Map<string, number>();
  private kalmanNoise = new Map<string, KalmanNoiseResult>();
  private _autonomyThresholds: AutonomyThresholds = { ...DEFAULT_AUTONOMY };
  private _sourceCredWeights: SourceCredibilityWeights = { ...DEFAULT_SOURCE_CRED_WEIGHTS };
  private themeSensitivities = new Map<string, number>();
  private execCosts = new Map<string, { spreadBps: number; slippageBps: number }>();

  constructor(config?: Partial<AdaptiveParamsConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config, modules: { ...DEFAULT_CONFIG.modules, ...config?.modules } };
  }

  compute(input: AdaptiveParamsInput): void {
    const m = this.config.modules;

    if (m.atrStops) {
      this.atrStops = computeAtrStops(input.priceSeries);
    }
    if (m.kellySizing) {
      this.kellySizes = computeKellySizing(input.mappingStats);
    }
    if (m.kalmanAutoTune) {
      this.kalmanNoise = computeKalmanNoise(input.priceSeries);
    }
    if (m.autonomyPercentiles && input.ideaRuns.length > 0) {
      this._autonomyThresholds = computeAutonomyThresholds(input.ideaRuns);
    }
    if (m.themeSensitivity && input.forwardReturns.length > 0) {
      const current = new Map<string, number>();
      this.themeSensitivities = computeThemeSensitivities(input.forwardReturns, input.ideaRuns, current);
    }

    this.ready = true;
    this.computedAt = new Date().toISOString();
    process.stderr.write(`[adaptive-params] computed: atr=${this.atrStops.size} kelly=${this.kellySizes.size} kalman=${this.kalmanNoise.size} themes=${this.themeSensitivities.size}\n`);
  }

  stopLossPct(symbol: string, fallback: number): number {
    return this.atrStops.get(symbol)?.stopLossPct ?? fallback;
  }

  takeProfitPct(symbol: string, fallback: number): number {
    return this.atrStops.get(symbol)?.takeProfitPct ?? fallback;
  }

  maxHoldingDays(_themeId: string, fallback: number): number {
    // TODO: learn from themeHorizonProfiles
    return fallback;
  }

  maxPositionPct(themeId: string, symbol: string, direction: string, fallback: number): number {
    const key = `${themeId}::${symbol}::${direction}`.toLowerCase();
    return this.kellySizes.get(key) ?? fallback;
  }

  kalmanProcessNoise(symbol: string): number {
    return this.kalmanNoise.get(symbol)?.processNoise ?? 1.2;
  }

  kalmanMeasurementNoise(symbol: string): number {
    return this.kalmanNoise.get(symbol)?.measurementNoise ?? 4;
  }

  autonomyThresholds(): AutonomyThresholds {
    return this._autonomyThresholds;
  }

  sourceCredWeights(): SourceCredibilityWeights {
    return this._sourceCredWeights;
  }

  baseSensitivity(themeId: string, fallback: number): number {
    return this.themeSensitivities.get(themeId) ?? fallback;
  }

  spreadBps(assetKind: string): number {
    return this.execCosts.get(assetKind)?.spreadBps ?? 14;
  }

  slippageBps(assetKind: string): number {
    return this.execCosts.get(assetKind)?.slippageBps ?? 14;
  }
}
