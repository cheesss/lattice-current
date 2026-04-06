export interface HawkesEventPoint {
  timestamp: string | number | Date;
  weight?: number;
  kind?: 'excite' | 'inhibit';
  polarity?: number;
}

export interface HawkesIntensityResult {
  lambda: number;
  normalized: number;
  eventCount: number;
  excitationMass: number;
  inhibitionMass: number;
  fittedAlpha: number;
  fittedBetaHours: number;
}

export type HawkesDomainFamily = 'generic' | 'military' | 'cyber' | 'shipping' | 'macro';

export interface HawkesDomainPreset {
  alpha: number;
  betaHours: number;
  inhibitionAlpha: number;
  inhibitionBetaHours: number;
  baseline: number;
  scale: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asTimestamp(value: string | number | Date): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const HAWKES_DOMAIN_PRESETS: Record<HawkesDomainFamily, HawkesDomainPreset> = {
  generic: {
    alpha: 0.75,
    betaHours: 18,
    inhibitionAlpha: 0.6,
    inhibitionBetaHours: 14.4,
    baseline: 0.18,
    scale: 2.5,
  },
  military: {
    alpha: 1.2,
    betaHours: 30,
    inhibitionAlpha: 0.85,
    inhibitionBetaHours: 24,
    baseline: 0.24,
    scale: 3.4,
  },
  cyber: {
    alpha: 0.55,
    betaHours: 10,
    inhibitionAlpha: 0.4,
    inhibitionBetaHours: 8,
    baseline: 0.2,
    scale: 2.1,
  },
  shipping: {
    alpha: 0.95,
    betaHours: 26,
    inhibitionAlpha: 0.72,
    inhibitionBetaHours: 20,
    baseline: 0.22,
    scale: 3.0,
  },
  macro: {
    alpha: 0.7,
    betaHours: 48,
    inhibitionAlpha: 0.55,
    inhibitionBetaHours: 36,
    baseline: 0.15,
    scale: 2.9,
  },
};

export function getHawkesDomainPreset(family: HawkesDomainFamily = 'generic'): HawkesDomainPreset {
  const preset = HAWKES_DOMAIN_PRESETS[family] || HAWKES_DOMAIN_PRESETS.generic;
  return { ...preset };
}

export function computeHawkesIntensity(
  points: HawkesEventPoint[],
  options: {
    now?: string | number | Date;
    family?: HawkesDomainFamily;
    alpha?: number;
    betaHours?: number;
    inhibitionAlpha?: number;
    inhibitionBetaHours?: number;
    baseline?: number;
    scale?: number;
    fitFromData?: boolean;
  } = {},
): HawkesIntensityResult {
  const preset = getHawkesDomainPreset(options.family ?? 'generic');
  const now = asTimestamp(options.now ?? Date.now());
  const sortedPoints = points
    .map((point) => ({ ...point, ts: asTimestamp(point.timestamp) }))
    .filter((point) => point.ts > 0 && point.ts <= now)
    .sort((left, right) => left.ts - right.ts);
  const fitFromData = options.fitFromData ?? true;
  const intervalsHours = sortedPoints
    .slice(1)
    .map((point, index) => (point.ts - sortedPoints[index]!.ts) / 3_600_000)
    .filter((value) => Number.isFinite(value) && value > 0);
  const medianIntervalHours = intervalsHours.length > 0
    ? intervalsHours.slice().sort((a, b) => a - b)[Math.floor(intervalsHours.length / 2)]!
    : null;
  const alpha = clamp(
    fitFromData
      ? (options.alpha ?? preset.alpha) + Math.min(0.9, Math.log1p(sortedPoints.length) * 0.18)
      : (options.alpha ?? preset.alpha),
    0.05,
    5,
  );
  const betaHours = clamp(
    fitFromData
      ? (medianIntervalHours != null
        ? Math.max(options.betaHours ?? preset.betaHours, medianIntervalHours * 1.35)
        : (options.betaHours ?? preset.betaHours))
      : (options.betaHours ?? preset.betaHours),
    1,
    240,
  );
  const inhibitionAlpha = clamp(options.inhibitionAlpha ?? preset.inhibitionAlpha ?? alpha * 0.8, 0.02, 5);
  const inhibitionBetaHours = clamp(options.inhibitionBetaHours ?? preset.inhibitionBetaHours ?? betaHours * 0.8, 1, 240);
  const baseline = clamp(options.baseline ?? preset.baseline, 0, 5);
  const scale = clamp(options.scale ?? preset.scale, 0.2, 10);
  const beta = 1 / betaHours;
  const inhibitionBeta = 1 / inhibitionBetaHours;

  let lambda = baseline;
  let eventCount = 0;
  let excitationMass = 0;
  let inhibitionMass = 0;
  for (const point of sortedPoints) {
    const deltaHours = (now - point.ts) / 3_600_000;
    const weight = clamp(point.weight ?? 1, 0.1, 12);
    const polarity = point.kind === 'inhibit'
      ? -1
      : point.kind === 'excite'
        ? 1
        : clamp(point.polarity ?? 1, -1, 1);
    if (polarity >= 0) {
      const excitation = weight * alpha * Math.exp(-beta * deltaHours);
      lambda += excitation;
      excitationMass += excitation;
    } else {
      const inhibition = weight * inhibitionAlpha * Math.exp(-inhibitionBeta * deltaHours);
      lambda -= inhibition;
      inhibitionMass += inhibition;
    }
    eventCount += 1;
  }
  lambda = Math.max(0, lambda);

  return {
    lambda: Number(lambda.toFixed(4)),
    normalized: Number(clamp(1 - Math.exp(-lambda / scale), 0, 1).toFixed(4)),
    eventCount,
    excitationMass: Number(excitationMass.toFixed(4)),
    inhibitionMass: Number(inhibitionMass.toFixed(4)),
    fittedAlpha: Number(alpha.toFixed(4)),
    fittedBetaHours: Number(betaHours.toFixed(4)),
  };
}

// ---------------------------------------------------------------------------
// Multi-window Hawkes — compare intensity across time horizons
// ---------------------------------------------------------------------------

export interface MultiWindowHawkesEntry {
  label: string;
  betaHours: number;
  result: HawkesIntensityResult;
}

export interface MultiWindowHawkesResult {
  windows: MultiWindowHawkesEntry[];
  /** short.lambda / mid.lambda — >1 means issue is heating up */
  momentum: number;
  /** mid.lambda / long.lambda — >1 means mid-term uptrend */
  trend: number;
}

const DEFAULT_HAWKES_WINDOWS: { label: string; betaHours: number }[] = [
  { label: 'short', betaHours: 24 },
  { label: 'mid', betaHours: 168 },
  { label: 'long', betaHours: 720 },
];

export function computeMultiWindowHawkes(
  points: HawkesEventPoint[],
  windows: { label: string; betaHours: number }[] = DEFAULT_HAWKES_WINDOWS,
  baseOptions?: {
    now?: string | number | Date;
    alpha?: number;
    baseline?: number;
    scale?: number;
    fitFromData?: boolean;
  },
): MultiWindowHawkesResult {
  const entries: MultiWindowHawkesEntry[] = windows.map(w => ({
    label: w.label,
    betaHours: w.betaHours,
    result: computeHawkesIntensity(points, {
      ...baseOptions,
      betaHours: w.betaHours,
      fitFromData: false, // use explicit betaHours, don't auto-fit
    }),
  }));

  // Compute momentum (short / mid) and trend (mid / long)
  const shortLambda = entries.find(e => e.label === 'short')?.result.lambda ?? 0;
  const midLambda = entries.find(e => e.label === 'mid')?.result.lambda ?? 0;
  const longLambda = entries.find(e => e.label === 'long')?.result.lambda ?? 0;

  const momentum = midLambda > 1e-6 ? shortLambda / midLambda : 1;
  const trend = longLambda > 1e-6 ? midLambda / longLambda : 1;

  return {
    windows: entries,
    momentum: Number(clamp(momentum, 0, 5).toFixed(4)),
    trend: Number(clamp(trend, 0, 5).toFixed(4)),
  };
}
