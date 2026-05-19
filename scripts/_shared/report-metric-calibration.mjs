function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function metricName(metric = {}) {
  return String(metric.name || metric.metricName || metric.metricId || '').toLowerCase();
}

function hasLimitation(metric = {}, pattern) {
  return asArray(metric.limitations).some((limitation) => pattern.test(String(limitation)));
}

function fmt(value, digits = 1) {
  const n = numberOrNull(value);
  if (n == null) return 'unknown';
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

function pct(value, digits = 1) {
  const n = numberOrNull(value);
  if (n == null) return 'unknown';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function inferBaseline(metric = {}, bundle = {}) {
  const name = metricName(metric);
  const value = Math.abs(numberOrNull(metric.value) ?? 0);
  const sourceRows = Number(bundle.sourceSummary?.articleCount ?? bundle.sourceSummary?.article_count ?? 0);
  if (/acceleration|yoy|growth|change|momentum/.test(name)) {
    if (hasLimitation(metric, /near[_ -]?zero|small|sparse|baseline/i)) return 'sparse';
    if (sourceRows > 0 && sourceRows < 10) return 'sparse';
    if (/acceleration/.test(name) && value > 100) return 'sparse';
  }
  if (/article|evidence|source|sample/.test(name) && value < 10) return 'thin_sample';
  return 'stable';
}

export function calibrateMetric(metric = {}, bundle = {}) {
  const name = metricName(metric);
  const value = numberOrNull(metric.value);
  const baseline = inferBaseline(metric, bundle);
  let interpretation = 'context metric';
  let decisionUse = 'supporting context';
  let reliability = baseline === 'stable' ? 0.75 : 0.45;
  let displayValue = value == null ? String(metric.value ?? 'unknown') : fmt(value, 2);
  let useInMainMemo = true;

  if (/acceleration|yoy|growth|change/.test(name)) {
    displayValue = pct(value, Math.abs(value ?? 0) >= 100 ? 0 : 1);
    if (baseline === 'sparse') {
      interpretation = 'directional-only change signal; magnitude is not precise because the comparison base is sparse or unstable';
      decisionUse = 'do not use as a standalone lifecycle conclusion';
      reliability = 0.35;
    } else if ((value ?? 0) > 0) {
      interpretation = 'positive directional trend';
      decisionUse = 'supports a change narrative when source breadth also confirms';
      reliability = 0.75;
    } else if ((value ?? 0) < 0) {
      interpretation = 'negative directional trend';
      decisionUse = 'supports an attention slowdown narrative, not a fundamental decline by itself';
      reliability = 0.75;
    }
  } else if (/article|evidence|sample/.test(name)) {
    displayValue = fmt(value, 0);
    if ((value ?? 0) < 10) {
      interpretation = 'thin sample';
      decisionUse = 'triage only; prohibit broad lifecycle conclusions';
      reliability = 0.35;
    } else if ((value ?? 0) < 30) {
      interpretation = 'moderate sample';
      decisionUse = 'usable for watch-level narrative with caveats';
      reliability = 0.6;
    } else {
      interpretation = 'adequate sample';
      decisionUse = 'usable as one input to memo thesis';
      reliability = 0.8;
    }
  } else if (/source|diversity|breadth/.test(name)) {
    displayValue = value != null && value <= 1 ? fmt(value, 2) : fmt(value, 0);
    if ((value ?? 0) < 0.5) {
      interpretation = 'concentrated source base';
      decisionUse = 'cap conviction and require source expansion';
      reliability = 0.4;
    } else {
      interpretation = 'source breadth supports independent confirmation';
      decisionUse = 'supports evidence quality when paired with fresh evidence';
      reliability = 0.75;
    }
  } else if (/t[_ -]?stat|validation|uplift|alpha|return|market/.test(name)) {
    if ((value ?? 0) === 0) {
      interpretation = 'no measured market evidence';
      decisionUse = 'do not infer market transmission';
      reliability = 0.4;
    } else {
      interpretation = 'measured market or validation signal';
      decisionUse = 'supports market transmission only with stated event window and controls';
      reliability = 0.7;
    }
  } else if (/readiness|depth|coverage|gap|task/.test(name)) {
    interpretation = 'research-operating metric';
    decisionUse = 'use to decide collection priority, not thesis direction';
    reliability = 0.7;
    useInMainMemo = !/gap|task/.test(name);
  }

  return {
    metricId: metric.metricId,
    name: metric.name,
    rawValue: metric.value,
    displayValue,
    baseline,
    interpretation,
    decisionUse,
    reliability: Math.round(reliability * 1000) / 1000,
    useInMainMemo,
  };
}

export function buildMetricCalibrationSummary(bundle = {}) {
  const metrics = asArray(bundle.metrics).map((metric) => calibrateMetric(metric, bundle));
  const weak = metrics.filter((metric) => metric.baseline !== 'stable' || metric.reliability < 0.6);
  const mainMemoMetrics = metrics.filter((metric) => metric.useInMainMemo);
  return {
    metrics,
    weakMetricIds: weak.map((metric) => metric.metricId),
    mainMemoMetricIds: mainMemoMetrics.map((metric) => metric.metricId),
    calibrationScore: metrics.length
      ? Math.round((metrics.reduce((sum, metric) => sum + metric.reliability, 0) / metrics.length) * 1000) / 1000
      : 0,
  };
}
