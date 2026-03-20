export interface MPCAssetTarget {
  symbol: string;
  currentWeight: number;
  targetWeight: number;
  confidence?: number;
  minWeight?: number;
  maxWeight?: number;
  themeId?: string;
  riskClusterId?: string;
  assetClass?: string;
  tradable?: boolean;
  liquidityScore?: number;
  turnoverCostBps?: number;
  executionPenaltyPct?: number;
}

export interface MPCOptimizerOptions {
  longOnly?: boolean;
  grossCap?: number;
  netCap?: number;
  targetGrossExposure?: number;
  maxPositionWeight?: number;
  maxTurnoverPct?: number;
  minTradeWeight?: number;
  underInvestmentPenalty?: number;
  themeCaps?: Record<string, number>;
  clusterCaps?: Record<string, number>;
  assetClassCaps?: Record<string, number>;
  confidenceFloor?: number;
  iterations?: number;
}

export interface MPCOptimizationResult {
  optimizedWeights: Record<string, number>;
  deltasBySymbol: Record<string, number>;
  grossExposure: number;
  netExposure: number;
  turnoverPct: number;
  objectiveScore: number;
  iterations: number;
  violations: string[];
  perSymbol: Record<string, {
    currentWeight: number;
    targetWeight: number;
    optimizedWeight: number;
    delta: number;
    confidenceUsed: number;
    tradable: boolean;
  }>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function roundWeight(value: number): number {
  return Number(value.toFixed(6));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function computeTurnover(currentWeights: number[], targetWeights: number[]): number {
  const deltaSum = sum(targetWeights.map((value, index) => Math.abs(value - (currentWeights[index] ?? 0))));
  return deltaSum / 2;
}

function applyBoxConstraints(
  weights: number[],
  inputs: MPCAssetTarget[],
  longOnly: boolean,
  maxPositionWeight: number,
): number[] {
  return weights.map((weight, index) => {
    const input = inputs[index];
    if (!input) return weight;
    const lowerBound = longOnly ? Math.max(0, input.minWeight ?? 0) : (input.minWeight ?? -1);
    const upperBound = Math.min(input.maxWeight ?? Number.POSITIVE_INFINITY, maxPositionWeight);
    return clamp(weight, lowerBound, upperBound);
  });
}

function applyUniformScale(weights: number[], scale: number): number[] {
  return weights.map((value) => value * scale);
}

function sumAbsoluteWeights(weights: number[]): number {
  return sum(weights.map((value) => Math.abs(value)));
}

function buildSignalStrength(input: MPCAssetTarget, confidenceFloor: number, longOnly: boolean): number {
  const target = Math.abs(Number(input.targetWeight) || 0);
  if (target <= 0) return 0;
  const rawConfidence = isFiniteNumber(input.confidence) ? clamp(input.confidence, 0, 1) : 0;
  const softenedConfidence = rawConfidence < confidenceFloor
    ? (rawConfidence * 0.8) + (confidenceFloor * 0.2)
    : rawConfidence;
  const confidence = clamp(Math.max(softenedConfidence, confidenceFloor * (longOnly ? 0.3 : 0.22)), 0, 1);
  const executionPenalty = clamp(1 - (Number(input.executionPenaltyPct) || 0) / 100, 0.1, 1);
  const liquidityFactor = isFiniteNumber(input.liquidityScore)
    ? clamp(0.35 + (Number(input.liquidityScore) / 160), 0.2, 1)
    : 1;
  const costFactor = isFiniteNumber(input.turnoverCostBps)
    ? clamp(1 - Number(input.turnoverCostBps) / 450, 0.25, 1)
    : 1;
  const tradableFactor = input.tradable === false ? 0 : 1;
  return target * (0.42 + confidence * 0.58) * executionPenalty * liquidityFactor * costFactor * tradableFactor;
}

function groupIndicesByKey(inputs: MPCAssetTarget[], key: 'themeId' | 'assetClass' | 'riskClusterId'): Map<string, number[]> {
  const map = new Map<string, number[]>();
  inputs.forEach((input, index) => {
    const value = String(input[key] || '').trim();
    if (!value) return;
    const bucket = map.get(value) || [];
    bucket.push(index);
    map.set(value, bucket);
  });
  return map;
}

function enforceGroupedCaps(
  weights: number[],
  inputs: MPCAssetTarget[],
  caps: Record<string, number> | undefined,
  key: 'themeId' | 'assetClass' | 'riskClusterId',
  longOnly: boolean,
  violations: string[],
): number[] {
  if (!caps) return weights;
  const next = weights.slice();
  const groups = groupIndicesByKey(inputs, key);

  for (const [groupKey, indices] of groups.entries()) {
    const cap = caps[groupKey];
    if (!isFiniteNumber(cap) || cap <= 0) continue;
    const exposure = longOnly
      ? sum(indices.map((index) => Math.max(0, next[index] ?? 0)))
      : sum(indices.map((index) => Math.abs(next[index] ?? 0)));
    if (exposure <= cap) continue;
    const scale = cap / exposure;
    for (const index of indices) {
      next[index] = (next[index] ?? 0) * scale;
    }
    violations.push(`${key}:${groupKey} capped at ${cap.toFixed(4)}.`);
  }

  return next;
}

function enforceGrossNetCaps(
  weights: number[],
  options: MPCOptimizerOptions,
  longOnly: boolean,
  violations: string[],
): number[] {
  let next = weights.slice();
  const grossCap = isFiniteNumber(options.grossCap) && options.grossCap > 0 ? options.grossCap : Number.POSITIVE_INFINITY;
  const netCap = isFiniteNumber(options.netCap) && options.netCap > 0 ? options.netCap : Number.POSITIVE_INFINITY;

  const gross = sum(next.map((value) => Math.abs(value)));
  if (gross > grossCap) {
    const scale = grossCap / gross;
    next = applyUniformScale(next, scale);
    violations.push(`gross exposure scaled to ${grossCap.toFixed(4)}.`);
  }

  const net = sum(next);
  if (!longOnly && Math.abs(net) > netCap) {
    const scale = netCap / Math.abs(net);
    next = applyUniformScale(next, scale);
    violations.push(`net exposure scaled to ${netCap.toFixed(4)}.`);
  }

  return next;
}

function inferTargetGrossExposure(
  inputs: MPCAssetTarget[],
  options: MPCOptimizerOptions,
  longOnly: boolean,
  confidenceFloor: number,
): number {
  const grossCap = isFiniteNumber(options.grossCap) && options.grossCap > 0
    ? options.grossCap
    : Number.POSITIVE_INFINITY;
  if (isFiniteNumber(options.targetGrossExposure) && (options.targetGrossExposure || 0) > 0) {
    return clamp(Number(options.targetGrossExposure), 0, grossCap);
  }

  const deployableInputs = inputs.filter((input) => input.tradable !== false && Math.abs(Number(input.targetWeight) || 0) > 0);
  if (!deployableInputs.length) return 0;

  const averageConfidence = sum(deployableInputs.map((input) => clamp(Number(input.confidence) || 0, 0, 1))) / deployableInputs.length;
  const signalMass = sum(deployableInputs.map((input) => buildSignalStrength(input, confidenceFloor, longOnly)));
  const breadthFloor = deployableInputs.length >= 4 ? 0.16 : deployableInputs.length >= 2 ? 0.11 : 0.07;
  const confidenceFloorLift = Math.min(0.18, averageConfidence * 0.2);
  const signalFloor = Math.min(grossCap, signalMass * (1.05 + averageConfidence * 0.25));
  return clamp(Math.max(breadthFloor, confidenceFloorLift, signalFloor), 0, grossCap);
}

function reinforceTargetGrossExposure(
  desiredWeights: number[],
  inputs: MPCAssetTarget[],
  options: MPCOptimizerOptions,
  longOnly: boolean,
  targetGrossExposure: number,
  confidenceFloor: number,
  violations: string[],
): number[] {
  if (!(targetGrossExposure > 0)) return desiredWeights;
  const currentGross = sumAbsoluteWeights(desiredWeights);
  if (currentGross >= targetGrossExposure) return desiredWeights;

  const activeEntries = inputs
    .map((input, index) => ({ input, index }))
    .filter(({ input }) => input.tradable !== false && Math.abs(Number(input.targetWeight) || 0) > 0);
  if (!activeEntries.length) return desiredWeights;

  const priorities = activeEntries
    .map(({ input, index }) => ({
      input,
      index,
      priority: Math.max(1e-6, buildSignalStrength(input, confidenceFloor, longOnly)),
    }))
    .sort((left, right) => right.priority - left.priority);
  const priorityTotal = sum(priorities.map((entry) => entry.priority));
  if (priorityTotal <= 0) return desiredWeights;

  const scale = clamp(targetGrossExposure / Math.max(currentGross, 1e-8), 1, 3.5);
  let next = applyUniformScale(desiredWeights, scale);
  next = applyBoxConstraints(next, inputs, longOnly, isFiniteNumber(options.maxPositionWeight) && options.maxPositionWeight > 0
    ? options.maxPositionWeight
    : Number.POSITIVE_INFINITY);
  next = enforceGroupedCaps(next, inputs, options.themeCaps, 'themeId', longOnly, violations);
  next = enforceGroupedCaps(next, inputs, options.clusterCaps, 'riskClusterId', longOnly, violations);
  next = enforceGroupedCaps(next, inputs, options.assetClassCaps, 'assetClass', longOnly, violations);
  next = enforceGrossNetCaps(next, options, longOnly, violations);

  let filledGross = sumAbsoluteWeights(next);
  let fillIteration = 0;
  while (filledGross < targetGrossExposure * 0.95 && fillIteration < 4) {
    const remainder = targetGrossExposure - filledGross;
    if (remainder <= 1e-8) break;
    for (const { input, index, priority } of priorities) {
      if (filledGross >= targetGrossExposure * 0.995) break;
      const current = next[index] ?? 0;
      const sign = current !== 0
        ? Math.sign(current)
        : (longOnly ? 1 : Math.sign(Number(input.targetWeight) || 1));
      const currentAbs = Math.abs(current);
      const maxRoom = isFiniteNumber(input.maxWeight) && input.maxWeight > 0
        ? Math.max(0, input.maxWeight - currentAbs)
        : remainder;
      if (maxRoom <= 0) continue;
      const share = priorityTotal > 0 ? priority / priorityTotal : 1 / priorities.length;
      const increment = Math.min(maxRoom, remainder * share);
      if (increment <= 0) continue;
      next[index] = current + sign * increment;
    }
    next = applyBoxConstraints(next, inputs, longOnly, isFiniteNumber(options.maxPositionWeight) && options.maxPositionWeight > 0
      ? options.maxPositionWeight
      : Number.POSITIVE_INFINITY);
    next = enforceGroupedCaps(next, inputs, options.themeCaps, 'themeId', longOnly, violations);
    next = enforceGroupedCaps(next, inputs, options.clusterCaps, 'riskClusterId', longOnly, violations);
    next = enforceGroupedCaps(next, inputs, options.assetClassCaps, 'assetClass', longOnly, violations);
    next = enforceGrossNetCaps(next, options, longOnly, violations);
    filledGross = sumAbsoluteWeights(next);
    fillIteration += 1;
  }

  if (sumAbsoluteWeights(next) > 0 && currentGross < targetGrossExposure) {
    violations.push(`under-investment corrected toward ${targetGrossExposure.toFixed(4)}.`);
  }
  return next;
}

function initializeDesiredWeights(
  inputs: MPCAssetTarget[],
  longOnly: boolean,
  confidenceFloor: number,
): number[] {
  return inputs.map((input) => {
    const current = Number(input.currentWeight) || 0;
    const target = Number(input.targetWeight) || 0;
    const rawConfidence = isFiniteNumber(input.confidence) ? clamp(input.confidence, 0, 1) : 0.7;
    const executionPenalty = clamp(1 - (Number(input.executionPenaltyPct) || 0) / 100, 0.15, 1);
    const liquidityFactor = isFiniteNumber(input.liquidityScore)
      ? clamp(0.35 + (Number(input.liquidityScore) / 160), 0.2, 1)
      : 1;
    const costFactor = isFiniteNumber(input.turnoverCostBps)
      ? clamp(1 - Number(input.turnoverCostBps) / 450, 0.3, 1)
      : 1;
    const tradableFactor = input.tradable === false ? 0 : 1;
    const confidence = clamp(rawConfidence * executionPenalty * liquidityFactor * costFactor * tradableFactor, 0, 1);
    const softenedConfidence = confidence < confidenceFloor
      ? (confidence * 0.8) + (confidenceFloor * 0.45)
      : (confidence * 0.92) + (confidenceFloor * 0.08);
    const effectiveConfidence = clamp(Math.max(softenedConfidence, Math.min(0.4, confidenceFloor * 0.65)), 0, 1);
    const mix = clamp(0.58 + (effectiveConfidence * 0.42), 0.35, 1);
    const desired = current + (target - current) * mix;
    const lowerBound = longOnly ? Math.max(0, input.minWeight ?? 0) : (input.minWeight ?? -1);
    const upperBound = input.maxWeight ?? Number.POSITIVE_INFINITY;
    return clamp(desired, lowerBound, upperBound);
  });
}

function enforceMinimumTradeSize(
  currentWeights: number[],
  desiredWeights: number[],
  minTradeWeight: number,
): number[] {
  if (!(minTradeWeight > 0)) return desiredWeights;
  return desiredWeights.map((weight, index) => {
    const current = currentWeights[index] ?? 0;
    const delta = weight - current;
    if (Math.abs(delta) < minTradeWeight) return current;
    return weight;
  });
}

export function optimizeTargetWeights(
  inputs: MPCAssetTarget[],
  options: MPCOptimizerOptions = {},
): MPCOptimizationResult {
  const longOnly = options.longOnly ?? true;
  const iterations = Math.max(1, Math.min(12, Math.round(options.iterations ?? 5)));
  const confidenceFloor = clamp(options.confidenceFloor ?? 0.35, 0, 0.95);
  const minTradeWeight = Math.max(0, Number(options.minTradeWeight) || 0);
  const currentWeights = inputs.map((input) => Number(input.currentWeight) || 0);
  const maxPositionWeight = isFiniteNumber(options.maxPositionWeight) && options.maxPositionWeight > 0
    ? options.maxPositionWeight
    : Number.POSITIVE_INFINITY;
  const targetGrossExposure = inferTargetGrossExposure(inputs, options, longOnly, confidenceFloor);
  let desiredWeights = initializeDesiredWeights(inputs, longOnly, confidenceFloor);
  const violations: string[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const before = desiredWeights.slice();
    desiredWeights = applyBoxConstraints(desiredWeights, inputs, longOnly, maxPositionWeight);
    desiredWeights = enforceGroupedCaps(desiredWeights, inputs, options.themeCaps, 'themeId', longOnly, violations);
    desiredWeights = enforceGroupedCaps(desiredWeights, inputs, options.clusterCaps, 'riskClusterId', longOnly, violations);
    desiredWeights = enforceGroupedCaps(desiredWeights, inputs, options.assetClassCaps, 'assetClass', longOnly, violations);
    desiredWeights = enforceGrossNetCaps(desiredWeights, options, longOnly, violations);

    const turnoverPct = computeTurnover(currentWeights, desiredWeights);
    if (options.maxTurnoverPct && options.maxTurnoverPct > 0 && turnoverPct > options.maxTurnoverPct) {
      const blend = clamp(options.maxTurnoverPct / turnoverPct, 0, 1);
      desiredWeights = desiredWeights.map((weight, index) => {
        const current = currentWeights[index] ?? 0;
        return current + (weight - current) * blend;
      });
      violations.push(`turnover capped at ${options.maxTurnoverPct.toFixed(4)}.`);
    }

    desiredWeights = enforceMinimumTradeSize(currentWeights, desiredWeights, minTradeWeight);
    desiredWeights = applyBoxConstraints(desiredWeights, inputs, longOnly, maxPositionWeight);
    desiredWeights = enforceGrossNetCaps(desiredWeights, options, longOnly, violations);
    desiredWeights = reinforceTargetGrossExposure(
      desiredWeights,
      inputs,
      options,
      longOnly,
      targetGrossExposure,
      confidenceFloor,
      violations,
    );

    const maxDelta = desiredWeights.reduce((max, weight, index) => {
      const current = currentWeights[index] ?? 0;
      return Math.max(max, Math.abs(weight - current));
    }, 0);
    if (maxDelta < 1e-7 || before.every((value, index) => Math.abs(value - (desiredWeights[index] ?? 0)) < 1e-7)) {
      break;
    }
  }

  const optimizedWeights = Object.fromEntries(
    inputs.map((input, index) => [input.symbol, roundWeight(desiredWeights[index] ?? 0)]),
  );
  const deltasBySymbol = Object.fromEntries(
    inputs.map((input, index) => [input.symbol, roundWeight((desiredWeights[index] ?? 0) - (currentWeights[index] ?? 0))]),
  );
  const grossExposure = roundWeight(sum(desiredWeights.map((value) => Math.abs(value))));
  const netExposure = roundWeight(sum(desiredWeights));
  const turnoverPct = roundWeight(computeTurnover(currentWeights, desiredWeights));
  const underInvestmentGap = Math.max(0, targetGrossExposure - grossExposure);
  const underInvestmentPenalty = isFiniteNumber(options.underInvestmentPenalty)
    ? clamp(options.underInvestmentPenalty ?? 1, 0, 5)
    : 1;
  const objectiveScore = clamp(
    Math.round(
      100
      - turnoverPct * 18
      - Math.max(0, grossExposure - (options.grossCap ?? grossExposure)) * 14
      - Math.max(0, Math.abs(netExposure) - (options.netCap ?? Math.abs(netExposure))) * 12
      - underInvestmentGap * 110 * underInvestmentPenalty
      - violations.length * 2,
    ),
    0,
    100,
  );

  const perSymbol = Object.fromEntries(inputs.map((input, index) => {
    const optimizedWeight = roundWeight(desiredWeights[index] ?? 0);
    const currentWeight = roundWeight(currentWeights[index] ?? 0);
    const delta = roundWeight(optimizedWeight - currentWeight);
    const rawConfidence = isFiniteNumber(input.confidence) ? clamp(input.confidence, 0, 1) : 0.7;
    return [input.symbol, {
      currentWeight,
      targetWeight: roundWeight(Number(input.targetWeight) || 0),
      optimizedWeight,
      delta,
      confidenceUsed: roundWeight(rawConfidence),
      tradable: input.tradable !== false,
    }];
  }));

  return {
    optimizedWeights,
    deltasBySymbol,
    grossExposure,
    netExposure,
    turnoverPct,
    objectiveScore,
    iterations,
    violations: Array.from(new Set(violations)),
    perSymbol,
  };
}
