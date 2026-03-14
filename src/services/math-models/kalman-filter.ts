export interface KalmanState {
  x: number;
  p: number;
  k: number;
  q: number;
  r: number;
  initialized: boolean;
  updates: number;
}

export interface KalmanUpdateOptions {
  processNoise?: number;
  measurementNoise?: number;
  initialVariance?: number;
}

function sanitize(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function createKalmanState(
  initialValue = 0,
  options: KalmanUpdateOptions = {},
): KalmanState {
  return {
    x: sanitize(initialValue, 0),
    p: sanitize(options.initialVariance ?? 1, 1),
    k: 0,
    q: sanitize(options.processNoise ?? 1.2, 1.2),
    r: sanitize(options.measurementNoise ?? 4, 4),
    initialized: false,
    updates: 0,
  };
}

export function updateKalmanState(
  state: KalmanState | null | undefined,
  measurement: number,
  options: KalmanUpdateOptions = {},
): KalmanState {
  const safeMeasurement = sanitize(measurement, 0);
  const next = state
    ? { ...state }
    : createKalmanState(safeMeasurement, options);

  next.q = sanitize(options.processNoise ?? next.q, next.q);
  next.r = sanitize(options.measurementNoise ?? next.r, next.r);
  next.p = sanitize(next.p, 1);

  if (!next.initialized) {
    next.x = safeMeasurement;
    next.initialized = true;
    next.updates = 1;
    next.k = 1;
    return next;
  }

  next.p += next.q;
  next.k = next.p / Math.max(next.p + next.r, 1e-6);
  next.x = next.x + next.k * (safeMeasurement - next.x);
  next.p = (1 - next.k) * next.p;
  next.updates += 1;

  return {
    ...next,
    x: Number(next.x.toFixed(4)),
    p: Number(next.p.toFixed(6)),
    k: Number(next.k.toFixed(6)),
  };
}
