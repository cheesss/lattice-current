export interface KalmanState {
  x: number;
  p: number;
  k: number;
  q: number;
  r: number;
  innovation: number;
  innovationVariance: number;
  mahalanobis: number;
  stateDeltaVariance: number;
  lastMeasurement: number;
  initialized: boolean;
  updates: number;
}

export interface KalmanUpdateOptions {
  processNoise?: number;
  measurementNoise?: number;
  initialVariance?: number;
  adaptive?: boolean;
  adaptationRate?: number;
  minProcessNoise?: number;
  maxProcessNoise?: number;
  minMeasurementNoise?: number;
  maxMeasurementNoise?: number;
}

function sanitize(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
    innovation: 0,
    innovationVariance: Math.max(1e-6, sanitize(options.measurementNoise ?? 4, 4)),
    mahalanobis: 0,
    stateDeltaVariance: Math.max(1e-6, sanitize(options.processNoise ?? 1.2, 1.2)),
    lastMeasurement: sanitize(initialValue, 0),
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
  const adaptationRate = clamp(sanitize(options.adaptationRate ?? 0.08, 0.08), 0.01, 0.35);
  const adaptive = options.adaptive ?? true;
  const minProcessNoise = Math.max(1e-6, sanitize(options.minProcessNoise ?? 0.08, 0.08));
  const maxProcessNoise = Math.max(minProcessNoise, sanitize(options.maxProcessNoise ?? 12, 12));
  const minMeasurementNoise = Math.max(1e-6, sanitize(options.minMeasurementNoise ?? 0.4, 0.4));
  const maxMeasurementNoise = Math.max(minMeasurementNoise, sanitize(options.maxMeasurementNoise ?? 24, 24));
  const next = state
    ? { ...state }
    : createKalmanState(safeMeasurement, options);

  next.q = sanitize(options.processNoise ?? next.q, next.q);
  next.r = sanitize(options.measurementNoise ?? next.r, next.r);
  next.p = sanitize(next.p, 1);
  next.innovationVariance = Math.max(1e-6, sanitize(next.innovationVariance, next.r));
  next.stateDeltaVariance = Math.max(1e-6, sanitize(next.stateDeltaVariance, next.q));

  if (!next.initialized) {
    next.x = safeMeasurement;
    next.initialized = true;
    next.updates = 1;
    next.k = 1;
    next.lastMeasurement = safeMeasurement;
    return next;
  }

  const predictedX = next.x;
  const predictedP = next.p + next.q;
  const innovation = safeMeasurement - predictedX;
  const expectedInnovationVariance = Math.max(predictedP + next.r, 1e-6);
  const innovationVariance = Math.max(
    1e-6,
    (1 - adaptationRate) * next.innovationVariance + adaptationRate * innovation * innovation,
  );

  next.innovation = innovation;
  next.innovationVariance = innovationVariance;
  next.mahalanobis = Math.abs(innovation) / Math.sqrt(expectedInnovationVariance);

  if (adaptive) {
    const measurementTarget = clamp(innovationVariance - predictedP, minMeasurementNoise, maxMeasurementNoise);
    next.r = clamp(
      (1 - adaptationRate) * next.r + adaptationRate * measurementTarget,
      minMeasurementNoise,
      maxMeasurementNoise,
    );
  }

  next.k = predictedP / Math.max(predictedP + next.r, 1e-6);
  next.x = predictedX + next.k * innovation;
  next.p = (1 - next.k) * predictedP;

  const stateDelta = next.x - predictedX;
  next.stateDeltaVariance = Math.max(
    1e-6,
    (1 - adaptationRate) * next.stateDeltaVariance + adaptationRate * stateDelta * stateDelta,
  );
  if (adaptive) {
    const processTarget = clamp(next.stateDeltaVariance, minProcessNoise, maxProcessNoise);
    next.q = clamp(
      (1 - adaptationRate) * next.q + adaptationRate * processTarget,
      minProcessNoise,
      maxProcessNoise,
    );
  }

  next.lastMeasurement = safeMeasurement;
  next.updates += 1;

  return {
    ...next,
    x: Number(next.x.toFixed(4)),
    p: Number(next.p.toFixed(6)),
    k: Number(next.k.toFixed(6)),
    q: Number(next.q.toFixed(6)),
    r: Number(next.r.toFixed(6)),
    innovation: Number(next.innovation.toFixed(6)),
    innovationVariance: Number(next.innovationVariance.toFixed(6)),
    mahalanobis: Number(next.mahalanobis.toFixed(6)),
    stateDeltaVariance: Number(next.stateDeltaVariance.toFixed(6)),
  };
}

/**
 * Run Kalman filter over an entire measurement sequence at once.
 * Returns the final state after processing all measurements.
 */
export function runKalmanSequence(
  measurements: number[],
  options: KalmanUpdateOptions = {},
): KalmanState {
  let state: KalmanState | null = null;
  for (const m of measurements) {
    state = updateKalmanState(state, m, options);
  }
  return state ?? createKalmanState(0, options);
}
