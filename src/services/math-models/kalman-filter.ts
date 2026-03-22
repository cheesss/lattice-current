
export interface KalmanState {
  x: number; // Estimated state
  p: number; // Estimated error covariance
}

export interface KalmanOptions {
  processNoise: number; // Q
  measurementNoise: number; // R
}

/**
 * Creates a new Kalman state with initial values.
 */
export function createKalmanState(initialValue: number, options: KalmanOptions): KalmanState {
  return {
    x: initialValue,
    p: options.measurementNoise, // Initial uncertainty
  };
}

/**
 * Performs a 1D Kalman filter update step.
 */
export function updateKalmanState(state: KalmanState, measurement: number, options: KalmanOptions): KalmanState {
  // 1. Prediction (Identity model)
  const x_prior = state.x;
  const p_prior = state.p + options.processNoise;

  // 2. Update
  const k = p_prior / (p_prior + options.measurementNoise); // Kalman Gain
  const x = x_prior + k * (measurement - x_prior);
  const p = (1 - k) * p_prior;

  return { x, p };
}
