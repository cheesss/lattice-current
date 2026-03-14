export interface TransferEntropyResult {
  value: number;
  normalized: number;
  sampleSize: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function bucketize(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > 0.35) return 2;
  if (value < -0.35) return -2;
  if (value > 0.05) return 1;
  if (value < -0.05) return -1;
  return 0;
}

function conditionalProbability(
  jointCounts: Map<string, number>,
  prefixCounts: Map<string, number>,
  jointKey: string,
  prefixKey: string,
): number {
  const joint = jointCounts.get(jointKey) || 0;
  const prefix = prefixCounts.get(prefixKey) || 0;
  if (!joint || !prefix) return 0;
  return joint / prefix;
}

export function estimateTransferEntropy(
  sourceSeries: number[],
  targetSeries: number[],
): TransferEntropyResult {
  const samples = Math.min(sourceSeries.length, targetSeries.length);
  if (samples < 6) {
    return { value: 0, normalized: 0, sampleSize: samples };
  }

  const jointXYZ = new Map<string, number>();
  const jointYZ = new Map<string, number>();
  const jointXY = new Map<string, number>();
  const yPrefix = new Map<string, number>();
  let total = 0;

  for (let index = 0; index < samples - 1; index += 1) {
    const x = bucketize(sourceSeries[index] ?? 0);
    const y = bucketize(targetSeries[index] ?? 0);
    const yNext = bucketize(targetSeries[index + 1] ?? 0);
    const xyzKey = `${yNext}|${y}|${x}`;
    const yzKey = `${yNext}|${y}`;
    const xyKey = `${y}|${x}`;
    const yKey = `${y}`;

    jointXYZ.set(xyzKey, (jointXYZ.get(xyzKey) || 0) + 1);
    jointYZ.set(yzKey, (jointYZ.get(yzKey) || 0) + 1);
    jointXY.set(xyKey, (jointXY.get(xyKey) || 0) + 1);
    yPrefix.set(yKey, (yPrefix.get(yKey) || 0) + 1);
    total += 1;
  }

  if (total === 0) {
    return { value: 0, normalized: 0, sampleSize: samples };
  }

  let te = 0;
  for (const [xyzKey, count] of jointXYZ.entries()) {
    const [rawYNext = '', rawY = '', rawX = ''] = xyzKey.split('|');
    const yNext = rawYNext;
    const y = rawY;
    const x = rawX;
    const pxyz = count / total;
    const pYNextGivenYX = conditionalProbability(jointXYZ, jointXY, xyzKey, `${y}|${x}`);
    const pYNextGivenY = conditionalProbability(jointYZ, yPrefix, `${yNext}|${y}`, y);
    if (pxyz <= 0 || pYNextGivenYX <= 0 || pYNextGivenY <= 0) continue;
    te += pxyz * Math.log2(pYNextGivenYX / pYNextGivenY);
  }

  return {
    value: Number(te.toFixed(6)),
    normalized: Number(clamp(te / 1.5, 0, 1).toFixed(4)),
    sampleSize: samples,
  };
}
