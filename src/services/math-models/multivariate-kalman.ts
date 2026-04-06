/**
 * Multivariate Kalman Filter for cross-asset coupling.
 *
 * Extends the scalar Kalman filter to track multiple correlated state
 * variables simultaneously (e.g., oil, gold, equity, FX transmission
 * strengths), capturing cross-asset coupling that the scalar version
 * misses.
 *
 * State vector:  x ∈ ℝ^n  (e.g., [oil_strength, gold_strength, equity_strength, fx_strength])
 * Transition:    F ∈ ℝ^(n×n)  — state transition (default: identity + cross-coupling terms)
 * Observation:   H ∈ ℝ^(m×n)  — observation model mapping state to measurements
 * Process noise: Q ∈ ℝ^(n×n)  — adapted by volatility regime
 * Measurement:   R ∈ ℝ^(m×m)  — scaled by source reliability
 */

export interface MultivariateKalmanState {
  /** State estimate vector (n×1) */
  x: number[];
  /** Error covariance matrix (n×n) */
  P: number[][];
  /** Kalman gain from last update (n×m) */
  K: number[][];
  /** Process noise covariance (n×n) */
  Q: number[][];
  /** Measurement noise covariance (m×m) */
  R: number[][];
  /** State transition matrix (n×n) */
  F: number[][];
  /** Observation matrix (m×n) */
  H: number[][];
  /** Dimension of state vector */
  stateDim: number;
  /** Dimension of measurement vector */
  measureDim: number;
  /** Whether filter has been initialized with at least one measurement */
  initialized: boolean;
  /** Number of updates performed */
  updates: number;
}

export interface MultivariateKalmanOptions {
  /** State transition matrix (n×n). Default: identity */
  F?: number[][];
  /** Observation matrix (m×n). Default: identity (direct observation) */
  H?: number[][];
  /** Process noise covariance (n×n). Default: 1.2 × I */
  Q?: number[][];
  /** Measurement noise covariance (m×m). Default: 4.0 × I */
  R?: number[][];
  /** Initial error covariance (n×n). Default: 1.0 × I */
  P0?: number[][];
}

// ── Matrix utilities (pure, no external deps) ──────────────────────

function sanitize(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

function eye(n: number, scale = 1): number[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? scale : 0)),
  );
}

function zeros(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => Array(cols).fill(0) as number[]);
}

function matAdd(A: number[][], B: number[][]): number[][] {
  return A.map((row, i) => row.map((v, j) => v + (B[i]?.[j] ?? 0)));
}

function matSub(A: number[][], B: number[][]): number[][] {
  return A.map((row, i) => row.map((v, j) => v - (B[i]?.[j] ?? 0)));
}

function matMul(A: number[][], B: number[][]): number[][] {
  const rows = A.length;
  const cols = B[0]?.length ?? 0;
  const inner = B.length;
  const C = zeros(rows, cols);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let sum = 0;
      for (let k = 0; k < inner; k++) {
        sum += (A[i]?.[k] ?? 0) * (B[k]?.[j] ?? 0);
      }
      C[i]![j] = sum;
    }
  }
  return C;
}

function matTranspose(A: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0]?.length ?? 0;
  const T = zeros(cols, rows);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      T[j]![i] = A[i]?.[j] ?? 0;
    }
  }
  return T;
}

/**
 * Invert a small (≤6×6) matrix using Gauss-Jordan elimination.
 * Returns null if singular.
 */
function matInvert(M: number[][]): number[][] | null {
  const n = M.length;
  // Augmented matrix [M | I]
  const aug: number[][] = M.map((row, i) => [
    ...row.map((v) => sanitize(v, 0)),
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    let maxVal = Math.abs(aug[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const absVal = Math.abs(aug[row]![col]!);
      if (absVal > maxVal) {
        maxVal = absVal;
        maxRow = row;
      }
    }
    if (maxVal < 1e-12) return null; // singular

    if (maxRow !== col) {
      [aug[col], aug[maxRow]] = [aug[maxRow]!, aug[col]!];
    }

    const pivot = aug[col]![col]!;
    for (let j = 0; j < 2 * n; j++) {
      aug[col]![j]! /= pivot;
    }

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row]![col]!;
      for (let j = 0; j < 2 * n; j++) {
        aug[row]![j]! -= factor * aug[col]![j]!;
      }
    }
  }

  return aug.map((row) => row.slice(n));
}

// ── Core Multivariate Kalman ────────────────────────────────────────

export function createMultivariateKalmanState(
  stateDim: number,
  measureDim?: number,
  options: MultivariateKalmanOptions = {},
): MultivariateKalmanState {
  const n = Math.max(1, stateDim);
  const m = Math.max(1, measureDim ?? n);

  return {
    x: Array(n).fill(0) as number[],
    P: options.P0 ?? eye(n, 1),
    K: zeros(n, m),
    Q: options.Q ?? eye(n, 1.2),
    R: options.R ?? eye(m, 4),
    F: options.F ?? eye(n),
    H: options.H ?? (n === m ? eye(n) : zeros(m, n).map((row, i) => { row[i] = i < n ? 1 : 0; return row; })),
    stateDim: n,
    measureDim: m,
    initialized: false,
    updates: 0,
  };
}

/**
 * Standard Kalman predict + update cycle.
 *
 * Predict:
 *   x̂⁻ = F · x̂
 *   P⁻  = F · P · Fᵀ + Q
 *
 * Update:
 *   y  = z - H · x̂⁻          (innovation)
 *   S  = H · P⁻ · Hᵀ + R     (innovation covariance)
 *   K  = P⁻ · Hᵀ · S⁻¹       (Kalman gain)
 *   x̂  = x̂⁻ + K · y
 *   P  = (I - K · H) · P⁻
 */
export function updateMultivariateKalman(
  state: MultivariateKalmanState | null | undefined,
  measurement: number[],
  options?: {
    stateDim?: number;
    measureDim?: number;
    /** Override process noise for this step (e.g., regime-adaptive Q) */
    Q?: number[][];
    /** Override measurement noise for this step (e.g., source reliability) */
    R?: number[][];
    /** Override transition for this step */
    F?: number[][];
    kalmanOptions?: MultivariateKalmanOptions;
  },
): MultivariateKalmanState {
  const safeMeasurement = measurement.map((v) => sanitize(v, 0));
  const m = safeMeasurement.length;
  const n = options?.stateDim ?? state?.stateDim ?? m;

  let s = state
    ? { ...state, x: [...state.x], P: state.P.map((r) => [...r]) }
    : createMultivariateKalmanState(n, m, options?.kalmanOptions);

  // Allow per-step overrides
  if (options?.Q) s.Q = options.Q;
  if (options?.R) s.R = options.R;
  if (options?.F) s.F = options.F;

  // First measurement: initialize state directly
  if (!s.initialized) {
    // Map measurement back to state space if dimensions differ
    if (m === n) {
      s.x = safeMeasurement.slice();
    } else {
      // Use pseudoinverse of H to back-project: x = Hᵀ(HHᵀ)⁻¹ z
      const Ht = matTranspose(s.H);
      const HHt = matMul(s.H, Ht);
      const HHtInv = matInvert(HHt);
      if (HHtInv) {
        const proj = matMul(Ht, HHtInv);
        s.x = proj.map((row) =>
          row.reduce((sum, v, j) => sum + v * (safeMeasurement[j] ?? 0), 0),
        );
      } else {
        s.x = Array(n).fill(0) as number[];
        for (let i = 0; i < Math.min(n, m); i++) s.x[i] = safeMeasurement[i]!;
      }
    }
    s.initialized = true;
    s.updates = 1;
    return s;
  }

  // ── Predict ──
  const xPred = matMul(s.F, s.x.map((v) => [v])).map((r) => r[0] ?? 0);
  const Ft = matTranspose(s.F);
  const PPred = matAdd(matMul(matMul(s.F, s.P), Ft), s.Q);

  // ── Update ──
  const Ht = matTranspose(s.H);
  const zPred = matMul(s.H, xPred.map((v) => [v])).map((r) => r[0] ?? 0);
  const innovation = safeMeasurement.map((z, i) => z - (zPred[i] ?? 0));

  const S = matAdd(matMul(matMul(s.H, PPred), Ht), s.R); // m×m
  const SInv = matInvert(S);

  if (!SInv) {
    // Singular S — skip update, return prediction only
    s.x = xPred;
    s.P = PPred;
    s.updates += 1;
    return s;
  }

  const K = matMul(matMul(PPred, Ht), SInv); // n×m

  // x̂ = x̂⁻ + K · y
  const Ky = matMul(K, innovation.map((v) => [v])).map((r) => r[0] ?? 0);
  s.x = xPred.map((v, i) => v + (Ky[i] ?? 0));

  // P = (I - K·H) · P⁻
  const IminKH = matSub(eye(n), matMul(K, s.H));
  s.P = matMul(IminKH, PPred);

  // Symmetrize P for numerical stability
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const avg = ((s.P[i]?.[j] ?? 0) + (s.P[j]?.[i] ?? 0)) / 2;
      s.P[i]![j] = avg;
      s.P[j]![i] = avg;
    }
  }

  s.K = K;
  s.updates += 1;

  return s;
}

/**
 * Extract the innovation covariance (S) for anomaly detection.
 * Mahalanobis distance of innovation vector ~ χ²(m) under null.
 */
export function computeInnovationStats(
  state: MultivariateKalmanState,
  measurement: number[],
): { innovation: number[]; mahalanobis: number; logLikelihood: number } {
  const safeMeasurement = measurement.map((v) => sanitize(v, 0));
  const xPred = matMul(state.F, state.x.map((v) => [v])).map((r) => r[0] ?? 0);
  const Ft = matTranspose(state.F);
  const PPred = matAdd(matMul(matMul(state.F, state.P), Ft), state.Q);
  const Ht = matTranspose(state.H);

  const zPred = matMul(state.H, xPred.map((v) => [v])).map((r) => r[0] ?? 0);
  const innovation = safeMeasurement.map((z, i) => z - (zPred[i] ?? 0));

  const S = matAdd(matMul(matMul(state.H, PPred), Ht), state.R);
  const SInv = matInvert(S);

  if (!SInv) {
    return { innovation, mahalanobis: Infinity, logLikelihood: -Infinity };
  }

  // d² = yᵀ S⁻¹ y
  const SInvY = matMul(SInv, innovation.map((v) => [v])).map((r) => r[0] ?? 0);
  const mahalanobis = Math.sqrt(
    Math.max(0, innovation.reduce((sum, v, i) => sum + v * (SInvY[i] ?? 0), 0)),
  );

  // Log-likelihood: -0.5 * (m·log(2π) + log|S| + d²)
  const m = innovation.length;
  let logDetS = 0;
  for (let i = 0; i < S.length; i++) logDetS += Math.log(Math.max(1e-12, Math.abs(S[i]?.[i] ?? 1e-12)));
  const logLikelihood = -0.5 * (m * Math.log(2 * Math.PI) + logDetS + mahalanobis * mahalanobis);

  return { innovation, mahalanobis, logLikelihood };
}

// ── Regime-Adaptive Process Noise ───────────────────────────────────

export type VolatilityRegime = 'low' | 'normal' | 'high' | 'crisis';

/**
 * Build process noise Q adapted to current volatility regime.
 * Higher volatility → larger Q → filter trusts measurements more.
 */
export function buildRegimeAdaptiveQ(
  baseDiagonal: number[],
  regime: VolatilityRegime,
  crossCoupling?: { i: number; j: number; strength: number }[],
): number[][] {
  const multiplier: Record<VolatilityRegime, number> = {
    low: 0.6,
    normal: 1.0,
    high: 2.0,
    crisis: 4.0,
  };
  const scale = multiplier[regime] ?? 1.0;
  const n = baseDiagonal.length;
  const Q = eye(n, 0);

  for (let i = 0; i < n; i++) {
    Q[i]![i] = (baseDiagonal[i] ?? 1) * scale;
  }

  // Add cross-coupling terms (e.g., oil↔gold during inflation shock)
  if (crossCoupling) {
    for (const { i, j, strength } of crossCoupling) {
      if (i >= 0 && i < n && j >= 0 && j < n && i !== j) {
        const coupling = strength * scale * 0.5;
        Q[i]![j] = coupling;
        Q[j]![i] = coupling;
      }
    }
  }

  return Q;
}

/**
 * Build state transition matrix with cross-asset coupling.
 * Off-diagonal terms represent how one asset's state influences another.
 *
 * Example: Oil price shocks (state[0]) feed into equity (state[2]) with
 * negative coupling, and into gold (state[1]) with positive coupling.
 */
export function buildCoupledTransitionMatrix(
  dim: number,
  couplings?: { from: number; to: number; weight: number }[],
): number[][] {
  const F = eye(dim);

  if (couplings) {
    for (const { from, to, weight } of couplings) {
      if (from >= 0 && from < dim && to >= 0 && to < dim && from !== to) {
        // Clamp coupling to prevent instability
        F[to]![from] = Math.max(-0.3, Math.min(0.3, weight));
      }
    }
  }

  return F;
}
