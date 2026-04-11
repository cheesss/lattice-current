export const LIFECYCLE_STAGES = ['nascent', 'emerging', 'growing', 'mainstream', 'declining'];

const STAGE_RANK = {
  declining: 0,
  nascent: 1,
  emerging: 2,
  growing: 3,
  mainstream: 4,
};

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, asNumber(value, minimum)));
}

function normalizePct(value, positiveCap = 200, negativeCap = -100) {
  const numeric = asNumber(value, 0);
  if (numeric >= 0) return clamp(numeric / positiveCap, 0, 1);
  return -clamp(Math.abs(numeric) / Math.abs(negativeCap), 0, 1);
}

export function classifyLifecycle(metrics = {}) {
  const annualizedArticleCount = Math.max(0, asNumber(metrics.annualizedArticleCount));
  const vsPreviousPeriodPct = asNumber(metrics.vsPreviousPeriodPct);
  const vsYearAgoPct = asNumber(metrics.vsYearAgoPct);
  const trendAcceleration = asNumber(metrics.trendAcceleration);
  const sourceDiversity = clamp(metrics.sourceDiversity, 0, 1);
  const recurrenceRatio = clamp(metrics.recurrenceRatio, 0, 1);
  const noveltyScore = clamp(metrics.noveltyScore, 0, 1);
  const themeSharePct = Math.max(0, asNumber(metrics.themeSharePct));

  const growthSignal = normalizePct(vsPreviousPeriodPct, 150, -100);
  const yoySignal = normalizePct(vsYearAgoPct, 250, -100);
  const accelerationSignal = normalizePct(trendAcceleration, 120, -120);
  const maturitySignal = clamp(Math.log10(annualizedArticleCount + 1) / 4, 0, 1);

  let stage = 'nascent';
  const reasons = [];

  if (
    (vsYearAgoPct <= -20 && vsPreviousPeriodPct <= -10)
    || (vsPreviousPeriodPct <= -30 && trendAcceleration < -10)
    || (annualizedArticleCount > 50 && recurrenceRatio < 0.03 && vsPreviousPeriodPct < -20)
  ) {
    stage = 'declining';
    reasons.push('momentum has rolled over versus both prior windows');
  } else if (
    annualizedArticleCount >= 2000
    && vsYearAgoPct <= 35
    && vsYearAgoPct >= -20
    && recurrenceRatio >= 0.1
    && sourceDiversity >= 0.25
  ) {
    stage = 'mainstream';
    reasons.push('coverage is broad and stable at mature scale');
  } else if (
    annualizedArticleCount >= 500
    && (vsYearAgoPct >= 20 || vsPreviousPeriodPct >= 15 || trendAcceleration >= 8 || themeSharePct >= 1.25)
  ) {
    stage = 'growing';
    reasons.push('coverage has reached durable scale with continued expansion');
  } else if (
    annualizedArticleCount >= 50
    && (vsYearAgoPct >= 45 || vsPreviousPeriodPct >= 20 || trendAcceleration >= 12 || noveltyScore >= 0.18)
  ) {
    stage = 'emerging';
    reasons.push('coverage is breaking out from a small base');
  } else {
    stage = 'nascent';
    reasons.push('coverage remains early-stage or sparsely distributed');
  }

  const confidence = clamp(
    (
      maturitySignal * 0.35
      + Math.max(growthSignal, 0) * 0.2
      + Math.max(yoySignal, 0) * 0.2
      + sourceDiversity * 0.1
      + recurrenceRatio * 0.1
      + noveltyScore * 0.05
    ),
    0.15,
    0.99,
  );

  return {
    stage,
    confidence: Number(confidence.toFixed(4)),
    score: Number((
      maturitySignal * 0.35
      + growthSignal * 0.2
      + yoySignal * 0.2
      + accelerationSignal * 0.1
      + sourceDiversity * 0.075
      + recurrenceRatio * 0.05
      + noveltyScore * 0.025
    ).toFixed(4)),
    reasons,
  };
}

export function compareLifecycleStages(previousStage, currentStage) {
  const normalizedPrevious = LIFECYCLE_STAGES.includes(previousStage) ? previousStage : null;
  const normalizedCurrent = LIFECYCLE_STAGES.includes(currentStage) ? currentStage : null;
  if (!normalizedPrevious || !normalizedCurrent || normalizedPrevious === normalizedCurrent) {
    return {
      transitioned: false,
      direction: 'steady',
      distance: 0,
    };
  }

  const previousRank = STAGE_RANK[normalizedPrevious] ?? 0;
  const currentRank = STAGE_RANK[normalizedCurrent] ?? 0;
  const distance = currentRank - previousRank;

  return {
    transitioned: true,
    direction: distance > 0 ? 'upshift' : 'downshift',
    distance,
  };
}

export function buildLifecycleTransition(previousStage, currentStage, context = {}) {
  const transition = compareLifecycleStages(previousStage, currentStage);
  if (!transition.transitioned) return null;

  return {
    fromStage: previousStage,
    toStage: currentStage,
    direction: transition.direction,
    distance: transition.distance,
    confidence: clamp(context.confidence, 0, 1),
    reason: Array.isArray(context.reasons) ? context.reasons[0] || '' : '',
    metrics: {
      annualizedArticleCount: asNumber(context.annualizedArticleCount),
      vsPreviousPeriodPct: asNumber(context.vsPreviousPeriodPct),
      vsYearAgoPct: asNumber(context.vsYearAgoPct),
      trendAcceleration: asNumber(context.trendAcceleration),
      sourceDiversity: clamp(context.sourceDiversity, 0, 1),
      recurrenceRatio: clamp(context.recurrenceRatio, 0, 1),
      noveltyScore: clamp(context.noveltyScore, 0, 1),
      themeSharePct: Math.max(0, asNumber(context.themeSharePct)),
    },
  };
}
