import type { MarketData } from '@/types';
import type { EventMarketTransmissionSnapshot } from '../../event-market-transmission';
import type { MacroRiskOverlay } from '../../macro-risk-overlay';
import type { KNNPrediction } from '../adaptive-params/embedding-knn.js';
import type { TransmissionProxy } from '../adaptive-params/transmission-proxy.js';
import type {
  IdeaGenerationRuntimeContext,
  MacroIndicatorSnapshot,
  SignalContextSnapshot,
  ThemeAdmissionPolicy,
} from '../types';

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process.versions?.node);
}

function marketPriceBySymbol(markets: MarketData[]): Map<string, number> {
  const bySymbol = new Map<string, number>();
  for (const market of markets) {
    const symbol = String(market.symbol || '').trim().toUpperCase();
    const price = finiteOrNull(market.price);
    if (!symbol || price === null) continue;
    bySymbol.set(symbol, price);
  }
  return bySymbol;
}

export function deriveMacroIndicatorsFromMarkets(
  markets: MarketData[],
): MacroIndicatorSnapshot | null {
  const bySymbol = marketPriceBySymbol(markets);
  const indicators: MacroIndicatorSnapshot = {};

  const vix = bySymbol.get('^VIX') ?? bySymbol.get('VIX');
  const yieldSpread = bySymbol.get('T10Y2Y');
  const dollarIndex = bySymbol.get('DTWEXBGS') ?? bySymbol.get('DX-Y.NYB');
  const oilPrice = bySymbol.get('DCOILWTICO') ?? bySymbol.get('CL=F');

  if (vix != null) indicators.vix = vix;
  if (yieldSpread != null) indicators.yieldSpread = yieldSpread;
  if (dollarIndex != null) indicators.dollarIndex = dollarIndex;
  if (oilPrice != null) indicators.oilPrice = oilPrice;

  return Object.keys(indicators).length > 0 ? indicators : null;
}

function latestSignalValue(
  latestSignals: Record<string, { value: number; ts: string }> | null | undefined,
  signalName: string,
): { value: number; ts: string } | null {
  if (!latestSignals) return null;
  const entry = latestSignals[signalName];
  if (!entry || !Number.isFinite(entry.value)) return null;
  return entry;
}

export function deriveSignalContextFromLatestSignals(
  latestSignals: Record<string, { value: number; ts: string }> | null | undefined,
): SignalContextSnapshot | null {
  const vix = latestSignalValue(latestSignals, 'vix');
  const yieldSpread = latestSignalValue(latestSignals, 'yieldSpread');
  const creditSpread = latestSignalValue(latestSignals, 'hy_credit_spread');
  const gdeltStress = latestSignalValue(latestSignals, 'marketStress');
  const transmissionStrength = latestSignalValue(latestSignals, 'transmissionStrength');

  const signalTimestamps = [vix, yieldSpread, creditSpread, gdeltStress, transmissionStrength]
    .map((entry) => entry?.ts)
    .filter((value): value is string => Boolean(value))
    .sort();
  const capturedAt = signalTimestamps.length > 0
    ? signalTimestamps[signalTimestamps.length - 1] ?? null
    : null;

  const snapshot: SignalContextSnapshot = {
    vix: vix?.value ?? null,
    yieldSpread: yieldSpread?.value ?? null,
    creditSpread: creditSpread?.value ?? null,
    gdeltStress: gdeltStress?.value ?? null,
    transmissionStrength: transmissionStrength?.value ?? null,
    capturedAt,
  };

  return Object.values(snapshot).some((value) => value !== null)
    ? snapshot
    : null;
}

export function deriveSignalContextFallback(args: {
  macroIndicators?: MacroIndicatorSnapshot | null;
  transmissionProxy?: TransmissionProxy | null;
  transmission?: EventMarketTransmissionSnapshot | null;
}): SignalContextSnapshot | null {
  const macroIndicators = args.macroIndicators ?? null;
  const transmissionProxy = args.transmissionProxy ?? null;
  const transmission = args.transmission ?? null;
  const capturedAt = transmission?.generatedAt
    ? new Date(transmission.generatedAt).toISOString()
    : null;

  const snapshot: SignalContextSnapshot = {
    vix: finiteOrNull(macroIndicators?.vix),
    yieldSpread: finiteOrNull(macroIndicators?.yieldSpread),
    creditSpread: null,
    gdeltStress: finiteOrNull(transmissionProxy?.marketStress),
    transmissionStrength: finiteOrNull(transmissionProxy?.transmissionStrength),
    capturedAt,
  };

  return Object.values(snapshot).some((value) => value !== null)
    ? snapshot
    : null;
}

type LatestSignalsProvider = () => Promise<Record<string, { value: number; ts: string }>>;

async function defaultLatestSignalsProvider(): Promise<Record<string, { value: number; ts: string }>> {
  if (!isNodeRuntime()) return {};
  const runtimeImport = new Function('specifier', 'return import(specifier);');
  const mod = await runtimeImport('../../signal-history-updater.ts') as {
    getLatestSignals: () => Promise<Record<string, { value: number; ts: string }>>;
  };
  return typeof mod.getLatestSignals === 'function'
    ? mod.getLatestSignals()
    : {};
}

export async function captureSignalContext(
  getLatestSignals: LatestSignalsProvider = defaultLatestSignalsProvider,
): Promise<SignalContextSnapshot | null> {
  try {
    return deriveSignalContextFromLatestSignals(await getLatestSignals());
  } catch {
    return null;
  }
}

function regimeStressFromLabel(label: string | null | undefined): number {
  const normalized = String(label || '').trim().toLowerCase();
  if (normalized === 'crisis') return 0.95;
  if (normalized === 'risk-off') return 0.78;
  if (normalized === 'balanced' || normalized === 'neutral') return 0.45;
  if (normalized === 'risk-on') return 0.18;
  return 0.32;
}

export function deriveTransmissionProxyFromSnapshot(args: {
  transmission: EventMarketTransmissionSnapshot | null;
  macroOverlay?: MacroRiskOverlay | null;
}): TransmissionProxy | null {
  const { transmission, macroOverlay } = args;
  if (!transmission) return null;

  const strengths = transmission.edges
    .map((edge) => finiteOrNull(edge.strength))
    .filter((value): value is number => value !== null)
    .map((value) => clamp(value / 100, 0, 1));
  const informationFlow = transmission.edges
    .map((edge) => finiteOrNull(edge.informationFlowScore))
    .filter((value): value is number => value !== null)
    .map((value) => clamp(value, 0, 1));
  const leadLag = transmission.edges
    .map((edge) => finiteOrNull(edge.leadLagScore))
    .filter((value): value is number => value !== null)
    .map((value) => clamp(value, 0, 1));

  const averageStrength = average(strengths);
  const peakStrength = strengths.length > 0 ? Math.max(...strengths) : 0;
  const regimeStress = regimeStressFromLabel(transmission.regime?.label);
  const regimeConfidence = clamp((Number(transmission.regime?.confidence) || 0) / 100, 0, 1);
  const overlayStress = macroOverlay
    ? clamp(
      macroOverlay.killSwitch
        ? 1
        : Math.max((Number(macroOverlay.riskGauge) || 0) / 100, regimeStress),
      0,
      1,
    )
    : regimeStress;

  const transmissionStrength = clamp(
    averageStrength * 0.65
    + peakStrength * 0.2
    + average(informationFlow) * 0.1
    + average(leadLag) * 0.05,
    0,
    1,
  );
  const marketStress = clamp(
    overlayStress * 0.55
    + transmissionStrength * 0.3
    + regimeConfidence * 0.15,
    0,
    1,
  );
  const reactionSignificance = clamp(
    average(informationFlow) * 0.55
    + average(leadLag) * 0.25
    + peakStrength * 0.2,
    0,
    1,
  );

  if (marketStress <= 0 && transmissionStrength <= 0 && reactionSignificance <= 0) {
    return null;
  }

  return {
    marketStress,
    transmissionStrength,
    reactionSignificance,
  };
}

export function buildIdeaGenerationRuntimeContext(args?: {
  markets?: MarketData[] | null;
  transmission?: EventMarketTransmissionSnapshot | null;
  macroOverlay?: MacroRiskOverlay | null;
  ragHitRate?: number | null;
  ragConfidence?: number | null;
  knnPrediction?: KNNPrediction | null;
  admissionThresholds?: ThemeAdmissionPolicy | null;
  ensembleModels?: unknown | null;
  mlNormalization?: { mean: number[]; std: number[] } | null;
  gdeltProxy?: TransmissionProxy | null;
  macroIndicators?: MacroIndicatorSnapshot | null;
  signalContext?: SignalContextSnapshot | null;
}): IdeaGenerationRuntimeContext {
  const markets = Array.isArray(args?.markets) ? args.markets : [];
  const macroIndicators = args?.macroIndicators ?? deriveMacroIndicatorsFromMarkets(markets);
  const transmissionProxy = args?.gdeltProxy ?? deriveTransmissionProxyFromSnapshot({
    transmission: args?.transmission ?? null,
    macroOverlay: args?.macroOverlay ?? null,
  });
  const signalSnapshot = args?.signalContext ?? deriveSignalContextFallback({
    macroIndicators,
    transmissionProxy,
    transmission: args?.transmission ?? null,
  });

  return {
    rag: {
      hitRate: args?.ragHitRate ?? null,
      confidence: clamp(Number(args?.ragConfidence) || 0, 0, 1),
      knnPrediction: args?.knnPrediction ?? null,
    },
    admission: {
      thresholds: args?.admissionThresholds ?? null,
    },
    ml: {
      ensembleModels: args?.ensembleModels ?? null,
      normalization: args?.mlNormalization ?? null,
    },
    signal: {
      transmissionProxy,
      macroIndicators,
      signalSnapshot,
    },
  };
}
