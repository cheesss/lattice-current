import type { ClusteredEvent, MarketData } from '@/types';
import type { MarketRegimeState } from './math-models/regime-model';
import type { SelfTuningWeightProfile } from './experiment-registry';

export type MacroRiskState = 'risk-on' | 'balanced' | 'risk-off' | 'crash';

export interface MacroRiskDriver {
  label: string;
  value: number;
  tone: 'positive' | 'negative' | 'neutral';
}

export interface MacroHedgeSuggestion {
  symbol: string;
  weightPct: number;
  reason: string;
}

export interface MacroRiskOverlay {
  generatedAt: string;
  state: MacroRiskState;
  riskGauge: number;
  netExposureCapPct: number;
  grossExposureCapPct: number;
  killSwitch: boolean;
  topDownAction: 'normal' | 'trim' | 'defend' | 'kill-switch';
  hedgeBias: MacroHedgeSuggestion[];
  drivers: MacroRiskDriver[];
  notes: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function marketChange(markets: MarketData[], symbols: string[]): number {
  const rows = markets
    .filter((market) => symbols.includes(String(market.symbol || '')))
    .map((market) => Number(market.change))
    .filter((value) => Number.isFinite(value));
  if (!rows.length) return 0;
  return rows.reduce((sum, value) => sum + value, 0) / rows.length;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildMacroRiskOverlay(args: {
  regime: MarketRegimeState | null | undefined;
  markets: MarketData[];
  clusters?: ClusteredEvent[];
  weightProfile?: SelfTuningWeightProfile | null;
}): MacroRiskOverlay {
  const regime = args.regime ?? null;
  const weightProfile = args.weightProfile ?? null;
  const vixChange = marketChange(args.markets, ['^VIX']);
  const equityChange = marketChange(args.markets, ['^GSPC', '^DJI']);
  const techChange = marketChange(args.markets, ['^IXIC', 'XLK', 'NVDA']);
  const ratesHedgeChange = marketChange(args.markets, ['TLT', 'SHY', 'GOVT']);
  const goldChange = marketChange(args.markets, ['GLD', 'IAU', 'GC=F']);
  const dollarChange = marketChange(args.markets, ['UUP', 'DX-Y.NYB']);
  const flashSignals = average((args.clusters || []).slice(0, 12).map((cluster) => Number(cluster.sourceCount || 0) + (cluster.isAlert ? 2 : 0)));

  const regimeBase = regime?.id === 'deflation-bust'
    ? 72
    : regime?.id === 'risk-off'
      ? 64
      : regime?.id === 'inflation-shock'
        ? 56
        : 32;
  const regimeConfidenceAdj = (regime?.confidence || 0) * 0.22;
  const vixStress = Math.max(0, vixChange) * 4.6;
  const equityStress = Math.max(0, -equityChange) * 4.3;
  const techStress = Math.max(0, -techChange) * 3.7;
  const hedgeBid = Math.max(0, ratesHedgeChange) * 2 + Math.max(0, goldChange) * 2 + Math.max(0, dollarChange) * 1.8;
  const warStress = (regime?.features.warIntensity || 0) * 0.18;
  const inflationStress = (regime?.features.inflationPressure || 0) * 0.16;
  const growthStress = (regime?.features.growthStress || 0) * 0.2;
  const policyStress = (regime?.features.policyStress || 0) * 0.14;
  const profileAdj = (weightProfile?.riskOffExposureMultiplier || 1) * 6.5 - 6.5;
  const flashStress = Math.min(10, flashSignals * 1.2);

  const riskGauge = clamp(Math.round(
    regimeBase
    + regimeConfidenceAdj
    + vixStress
    + equityStress
    + techStress
    + hedgeBid
    + warStress
    + inflationStress
    + growthStress
    + policyStress
    + flashStress
    + profileAdj
    - (regime?.id === 'risk-on' ? Math.max(0, techChange) * 3.5 : 0)
  ), 4, 100);

  const state: MacroRiskState = riskGauge >= 82
    ? 'crash'
    : riskGauge >= 66
      ? 'risk-off'
      : riskGauge <= 28
        ? 'risk-on'
        : 'balanced';
  const killSwitch = state === 'crash'
    || (state === 'risk-off' && (regime?.confidence || 0) >= 86 && vixChange >= 4.5);

  const baseNetCap = killSwitch
    ? 18
    : state === 'risk-off'
      ? 42
      : state === 'balanced'
        ? 68
        : 100;
  const baseGrossCap = killSwitch
    ? 40
    : state === 'risk-off'
      ? 78
      : state === 'balanced'
        ? 110
        : 145;

  const exposureAdj = clamp((weightProfile?.riskOffExposureMultiplier || 1), 0.6, 1.6);
  const netExposureCapPct = clamp(Math.round(baseNetCap / exposureAdj), 10, 120);
  const grossExposureCapPct = clamp(Math.round(baseGrossCap / Math.max(0.82, exposureAdj * 0.92)), 30, 180);

  const hedgeBias: MacroHedgeSuggestion[] = state === 'risk-on'
    ? []
    : [
      { symbol: 'GLD', weightPct: killSwitch ? 5 : 3, reason: 'Gold absorbs risk-off and escalation stress.' },
      { symbol: 'TLT', weightPct: killSwitch ? 6 : 4, reason: 'Long-duration Treasuries provide macro shock ballast.' },
      { symbol: 'UUP', weightPct: state === 'crash' ? 3 : 2, reason: 'Dollar strength typically accompanies funding stress.' },
      { symbol: '^VIX', weightPct: killSwitch ? 2 : 1, reason: 'Volatility hedges offset abrupt beta compression.' },
    ];

  const notes = [
    killSwitch
      ? 'Macro kill switch is active; new net exposure should collapse toward hedge-only posture.'
      : state === 'risk-off'
        ? 'Top-down risk-off posture is active; new gross exposure should be trimmed and hedges favored.'
        : state === 'balanced'
          ? 'Macro regime is mixed; selective deployment is allowed but net exposure is capped.'
          : 'Macro regime permits normal deployment if idea-level evidence is strong.',
    regime ? `Regime ${regime.label} at ${regime.confidence}% confidence is feeding the overlay.` : 'Regime feed is missing, so the overlay is market-data only.',
  ];

  return {
    generatedAt: new Date().toISOString(),
    state,
    riskGauge,
    netExposureCapPct,
    grossExposureCapPct,
    killSwitch,
    topDownAction: killSwitch ? 'kill-switch' : state === 'risk-off' ? 'defend' : state === 'balanced' ? 'trim' : 'normal',
    hedgeBias,
    drivers: [
      { label: 'VIX', value: Number(vixChange.toFixed(2)), tone: vixChange > 0 ? 'negative' : 'positive' },
      { label: 'Equity Beta', value: Number(equityChange.toFixed(2)), tone: equityChange >= 0 ? 'positive' : 'negative' },
      { label: 'Tech Beta', value: Number(techChange.toFixed(2)), tone: techChange >= 0 ? 'positive' : 'negative' },
      { label: 'Rates Hedge', value: Number(ratesHedgeChange.toFixed(2)), tone: ratesHedgeChange > 0 ? 'negative' : 'neutral' },
      { label: 'Gold', value: Number(goldChange.toFixed(2)), tone: goldChange > 0 ? 'negative' : 'neutral' },
      { label: 'War Stress', value: Number((regime?.features.warIntensity || 0).toFixed(1)), tone: 'negative' },
      { label: 'Growth Stress', value: Number((regime?.features.growthStress || 0).toFixed(1)), tone: 'negative' },
    ],
    notes,
  };
}
