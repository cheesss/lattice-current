export interface TruthObservation {
  sourceId: string;
  value: 0 | 1;
}

export interface TruthClaim {
  id: string;
  prior?: number;
  observations: TruthObservation[];
}

export interface TruthSourceStats {
  sourceId: string;
  sensitivity: number;
  specificity: number;
  reliability: number;
  truthAgreement: number;
  supportCount: number;
  contradictionCount: number;
}

export interface TruthDiscoveryResult {
  claimTruth: Record<string, number>;
  sourceStats: Record<string, TruthSourceStats>;
  iterations: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function logSafe(value: number): number {
  return Math.log(clamp(value, 1e-6, 1 - 1e-6));
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

export function runTruthDiscovery(
  claims: TruthClaim[],
  options: {
    iterations?: number;
    seedReliability?: Record<string, number>;
  } = {},
): TruthDiscoveryResult {
  const relevantClaims = claims.filter((claim) => claim.observations.length >= 2);
  const sources = Array.from(
    new Set(relevantClaims.flatMap((claim) => claim.observations.map((obs) => obs.sourceId))),
  );

  const sensitivity = new Map<string, number>();
  const specificity = new Map<string, number>();
  const seed = options.seedReliability || {};
  for (const sourceId of sources) {
    const initial = clamp((seed[sourceId] ?? 0.72), 0.52, 0.96);
    sensitivity.set(sourceId, initial);
    specificity.set(sourceId, clamp(0.58 + (initial - 0.5) * 0.8, 0.52, 0.96));
  }

  const claimTruth = new Map<string, number>();
  const iterations = Math.max(3, Math.min(10, Math.round(options.iterations ?? 6)));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const claim of relevantClaims) {
      let logTrue = logSafe(clamp(claim.prior ?? 0.5, 0.08, 0.92));
      let logFalse = logSafe(1 - clamp(claim.prior ?? 0.5, 0.08, 0.92));

      for (const observation of claim.observations) {
        const sens = sensitivity.get(observation.sourceId) ?? 0.72;
        const spec = specificity.get(observation.sourceId) ?? 0.68;
        if (observation.value === 1) {
          logTrue += logSafe(sens);
          logFalse += logSafe(1 - spec);
        } else {
          logTrue += logSafe(1 - sens);
          logFalse += logSafe(spec);
        }
      }

      claimTruth.set(claim.id, sigmoid(logTrue - logFalse));
    }

    for (const sourceId of sources) {
      let tp = 0;
      let fn = 0;
      let tn = 0;
      let fp = 0;
      for (const claim of relevantClaims) {
        const truth = claimTruth.get(claim.id) ?? 0.5;
        const observation = claim.observations.find((entry) => entry.sourceId === sourceId);
        if (!observation) continue;
        if (observation.value === 1) {
          tp += truth;
          fp += 1 - truth;
        } else {
          fn += truth;
          tn += 1 - truth;
        }
      }

      sensitivity.set(sourceId, clamp(tp / Math.max(tp + fn, 1e-6), 0.05, 0.995));
      specificity.set(sourceId, clamp(tn / Math.max(tn + fp, 1e-6), 0.05, 0.995));
    }
  }

  const sourceStats: Record<string, TruthSourceStats> = {};
  for (const sourceId of sources) {
    const sens = sensitivity.get(sourceId) ?? 0.72;
    const spec = specificity.get(sourceId) ?? 0.68;
    let agreementSum = 0;
    let supportCount = 0;
    let contradictionCount = 0;
    for (const claim of relevantClaims) {
      const truth = claimTruth.get(claim.id) ?? 0.5;
      const observation = claim.observations.find((entry) => entry.sourceId === sourceId);
      if (!observation) continue;
      if (observation.value === 1) {
        agreementSum += truth;
        supportCount += 1;
      } else {
        agreementSum += 1 - truth;
        contradictionCount += 1;
      }
    }
    const totalObs = supportCount + contradictionCount;
    const truthAgreement = totalObs > 0 ? (agreementSum / totalObs) * 100 : 50;
    sourceStats[sourceId] = {
      sourceId,
      sensitivity: Number((sens * 100).toFixed(2)),
      specificity: Number((spec * 100).toFixed(2)),
      reliability: Number((((sens + spec) / 2) * 100).toFixed(2)),
      truthAgreement: Number(truthAgreement.toFixed(2)),
      supportCount,
      contradictionCount,
    };
  }

  return {
    claimTruth: Object.fromEntries(
      Array.from(claimTruth.entries()).map(([claimId, truth]) => [claimId, Number((truth * 100).toFixed(2))]),
    ),
    sourceStats,
    iterations,
  };
}
