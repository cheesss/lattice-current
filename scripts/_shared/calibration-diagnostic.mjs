function clamp(value, minimum, maximum) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeProbability(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 1.0001) return clamp(n / 100, 0, 1);
  return clamp(n, 0, 1);
}

function normalizeBinary(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n >= 1 ? 1 : 0;
}

function buildEmptyBucket(index) {
  const start = index * 0.2;
  const end = start + 0.2;
  return {
    range: `${Math.round(start * 100)}-${Math.round(end * 100)}%`,
    predicted: 0,
    actual: 0,
    count: 0,
  };
}

export function summarizeCalibrationRows(rows) {
  const normalized = rows
    .map((row) => ({
      predicted: normalizeProbability(row.predicted ?? row.hit_rate ?? row.predicted_hit_rate),
      actual: normalizeBinary(row.actual ?? row.hit ?? row.actual_hit),
    }))
    .filter((row) => row.predicted !== null && row.actual !== null);

  const buckets = Array.from({ length: 5 }, (_, index) => buildEmptyBucket(index));

  let ece = 0;
  let brierAccumulator = 0;
  const total = normalized.length;

  for (const row of normalized) {
    const bucketIndex = Math.min(4, Math.floor(row.predicted / 0.2));
    const bucket = buckets[bucketIndex];
    bucket.count += 1;
    bucket.predicted += row.predicted;
    bucket.actual += row.actual;
    brierAccumulator += (row.predicted - row.actual) ** 2;
  }

  for (const bucket of buckets) {
    if (bucket.count <= 0) continue;
    bucket.predicted = Number((bucket.predicted / bucket.count).toFixed(4));
    bucket.actual = Number((bucket.actual / bucket.count).toFixed(4));
    ece += Math.abs(bucket.actual - bucket.predicted) * (bucket.count / total);
  }

  const brierScore = total > 0 ? brierAccumulator / total : 0;
  const warning = ece > 0.1 ? 'drift detected' : null;

  return {
    ece: Number(ece.toFixed(4)),
    brierScore: Number(brierScore.toFixed(4)),
    buckets,
    sampleSize: total,
    warning,
  };
}

export async function computeCalibrationDiagnostic(queryable) {
  const result = await queryable.query(`
    WITH actual_outcomes AS (
      SELECT
        theme,
        symbol,
        horizon,
        AVG(hit::int::numeric) AS actual_hit
      FROM labeled_outcomes
      WHERE horizon = '2w'
      GROUP BY theme, symbol, horizon
    )
    SELECT
      s.hit_rate AS predicted,
      a.actual_hit AS actual
    FROM stock_sensitivity_matrix s
    JOIN actual_outcomes a
      ON a.theme = s.theme
     AND a.symbol = s.symbol
     AND a.horizon = s.horizon
    WHERE s.horizon = '2w'
  `);

  return summarizeCalibrationRows(result?.rows ?? []);
}
