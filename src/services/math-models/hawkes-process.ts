export interface HawkesEventPoint {
  timestamp: string | number | Date;
  weight?: number;
}

export interface HawkesIntensityResult {
  lambda: number;
  normalized: number;
  eventCount: number;
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

export function computeHawkesIntensity(
  points: HawkesEventPoint[],
  options: {
    now?: string | number | Date;
    alpha?: number;
    betaHours?: number;
    baseline?: number;
    scale?: number;
  } = {},
): HawkesIntensityResult {
  const now = asTimestamp(options.now ?? Date.now());
  const alpha = clamp(options.alpha ?? 0.75, 0.05, 5);
  const betaHours = clamp(options.betaHours ?? 18, 1, 240);
  const baseline = clamp(options.baseline ?? 0.18, 0, 5);
  const scale = clamp(options.scale ?? 2.5, 0.2, 10);
  const beta = 1 / betaHours;

  let lambda = baseline;
  let eventCount = 0;
  for (const point of points) {
    const ts = asTimestamp(point.timestamp);
    if (!ts || ts > now) continue;
    const deltaHours = (now - ts) / 3_600_000;
    const weight = clamp(point.weight ?? 1, 0.1, 12);
    lambda += weight * alpha * Math.exp(-beta * deltaHours);
    eventCount += 1;
  }

  return {
    lambda: Number(lambda.toFixed(4)),
    normalized: Number(clamp(1 - Math.exp(-lambda / scale), 0, 1).toFixed(4)),
    eventCount,
  };
}
