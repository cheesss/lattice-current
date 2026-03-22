
export interface TruthClaim {
  id: string;
  prior: number;
  observations: {
    sourceId: string;
    value: number; // 1 for reporting, 0 for silent but could have reported
  }[];
}

export interface TruthDiscoveryOptions {
  iterations: number;
  seedReliability: Record<string, number>;
}

export interface TruthDiscoveryResult {
  sourceStats: Record<string, { truthAgreement: number; reliability: number }>;
  claimsTrustworthiness: Record<string, number>;
}

/**
 * Basic EM-inspired Truth Discovery Algorithm.
 * Iteratively estimates the truth of claims and the reliability of sources.
 */
export function runTruthDiscovery(claims: TruthClaim[], options: TruthDiscoveryOptions): TruthDiscoveryResult {
  const sourceReliability: Record<string, number> = { ...options.seedReliability };
  const claimsTrustworthiness: Record<string, number> = {};
  
  const allSourceIds = new Set<string>();
  for (const claim of claims) {
    for (const obs of claim.observations) {
      allSourceIds.add(obs.sourceId);
    }
  }

  // Initialize unknown sources
  for (const sid of allSourceIds) {
    if (sourceReliability[sid] === undefined) {
      sourceReliability[sid] = 0.6; // Baseline
    }
  }

  for (let i = 0; i < options.iterations; i++) {
    // 1. Estimate Claim Trustworthiness (Truthfulness)
    for (const claim of claims) {
      let positiveEvidence = Math.log(claim.prior / (1 - claim.prior));
      
      for (const obs of claim.observations) {
        const reliability = Math.max(0.01, Math.min(0.99, sourceReliability[obs.sourceId] || 0.6));
        const weight = Math.log(reliability / (1 - reliability));
        
        if (obs.value === 1) {
          positiveEvidence += weight;
        } else {
          positiveEvidence -= weight;
        }
      }
      
      // Logistic sigmoid to get 0-1 probability
      claimsTrustworthiness[claim.id] = 1 / (1 + Math.exp(-positiveEvidence));
    }

    // 2. Estimate Source Reliability
    const sourcePerformance: Record<string, { sum: number; count: number }> = {};
    for (const claim of claims) {
      const truth = claimsTrustworthiness[claim.id] ?? 0.5;
      for (const obs of claim.observations) {
        if (!sourcePerformance[obs.sourceId]) sourcePerformance[obs.sourceId] = { sum: 0, count: 0 };
        const perf = sourcePerformance[obs.sourceId]!;
        // Source is 'correct' if it reports truth or is silent on falsehood
        const agreement = obs.value === 1 ? truth : (1 - truth);
        perf.sum += agreement;
        perf.count += 1;
      }
    }

    for (const sid of allSourceIds) {
      const perf = sourcePerformance[sid];
      if (perf && perf.count > 0) {
        const newReliability = perf.sum / perf.count;
        // Dampen updates
        sourceReliability[sid] = (sourceReliability[sid] ?? 0.6) * 0.4 + newReliability * 0.6;
      }
    }
  }

  const sourceStats: Record<string, { truthAgreement: number; reliability: number }> = {};
  for (const sid of allSourceIds) {
    sourceStats[sid] = {
      truthAgreement: Math.round((sourceReliability[sid] ?? 0) * 100),
      reliability: Math.round((sourceReliability[sid] ?? 0) * 100),
    };
  }

  return { sourceStats, claimsTrustworthiness };
}
