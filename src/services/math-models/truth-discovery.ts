export interface TruthObservation {
  sourceId: string;
  value: 0 | 1;
  timestamp?: string | number | Date;
  ageDays?: number;
  weight?: number;
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
  converged: boolean;
  finalDelta: number;
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

function toTimestamp(value: string | number | Date | null | undefined): number | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function runTruthDiscovery(
  claims: TruthClaim[],
  options: {
    iterations?: number;
    seedReliability?: Record<string, number>;
    timeDecayLambda?: number;
    convergenceEpsilon?: number;
    now?: string | number | Date;
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
  const iterations = Math.max(3, Math.min(24, Math.round(options.iterations ?? 12)));
  const convergenceEpsilon = Math.max(1e-6, Number(options.convergenceEpsilon ?? 1e-4));
  const timeDecayLambda = Math.max(0, Number(options.timeDecayLambda ?? 0.045));
  const nowTs = toTimestamp(options.now ?? Date.now()) ?? Date.now();
  const priorPseudoCount = 2;
  let converged = false;
  let finalDelta = Number.POSITIVE_INFINITY;
  let completedIterations = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    completedIterations = iteration + 1;
    const previousTruth = new Map(claimTruth);
    for (const claim of relevantClaims) {
      let logTrue = logSafe(clamp(claim.prior ?? 0.5, 0.08, 0.92));
      let logFalse = logSafe(1 - clamp(claim.prior ?? 0.5, 0.08, 0.92));

      for (const observation of claim.observations) {
        const sens = sensitivity.get(observation.sourceId) ?? 0.72;
        const spec = specificity.get(observation.sourceId) ?? 0.68;
        const inferredAgeDays = observation.ageDays != null
          ? Math.max(0, Number(observation.ageDays) || 0)
          : (() => {
            const ts = toTimestamp(observation.timestamp);
            if (ts == null) return 0;
            return Math.max(0, (nowTs - ts) / 86_400_000);
          })();
        const timeWeight = Math.exp(-timeDecayLambda * inferredAgeDays);
        const observationWeight = clamp(
          Number(observation.weight ?? 1) * timeWeight,
          1e-3,
          1,
        );
        if (observation.value === 1) {
          logTrue += observationWeight * logSafe(sens);
          logFalse += observationWeight * logSafe(1 - spec);
        } else {
          logTrue += observationWeight * logSafe(1 - sens);
          logFalse += observationWeight * logSafe(spec);
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
        const inferredAgeDays = observation.ageDays != null
          ? Math.max(0, Number(observation.ageDays) || 0)
          : (() => {
            const ts = toTimestamp(observation.timestamp);
            if (ts == null) return 0;
            return Math.max(0, (nowTs - ts) / 86_400_000);
          })();
        const timeWeight = Math.exp(-timeDecayLambda * inferredAgeDays);
        const observationWeight = clamp(
          Number(observation.weight ?? 1) * timeWeight,
          1e-3,
          1,
        );
        if (observation.value === 1) {
          tp += truth * observationWeight;
          fp += (1 - truth) * observationWeight;
        } else {
          fn += truth * observationWeight;
          tn += (1 - truth) * observationWeight;
        }
      }

      const previousSens = sensitivity.get(sourceId) ?? 0.72;
      const previousSpec = specificity.get(sourceId) ?? 0.68;
      const sensitivityNumerator = tp + previousSens * priorPseudoCount;
      const sensitivityDenominator = tp + fn + priorPseudoCount;
      const specificityNumerator = tn + previousSpec * priorPseudoCount;
      const specificityDenominator = tn + fp + priorPseudoCount;
      sensitivity.set(
        sourceId,
        clamp(sensitivityNumerator / Math.max(sensitivityDenominator, 1e-6), 0.05, 0.995),
      );
      specificity.set(
        sourceId,
        clamp(specificityNumerator / Math.max(specificityDenominator, 1e-6), 0.05, 0.995),
      );
    }

    const deltas = relevantClaims.map((claim) => {
      const nextTruth = claimTruth.get(claim.id) ?? 0.5;
      const prevTruth = previousTruth.get(claim.id) ?? 0.5;
      return (nextTruth - prevTruth) ** 2;
    });
    finalDelta = Math.sqrt(deltas.reduce((sum, value) => sum + value, 0));
    if (iteration >= 1 && finalDelta <= convergenceEpsilon) {
      converged = true;
      break;
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
    iterations: completedIterations,
    converged,
    finalDelta: Number((Number.isFinite(finalDelta) ? finalDelta : 0).toFixed(8)),
  };
}
