/**
 * transmission-proxy.ts — Fill the event-market transmission data gap.
 *
 * NAS replay frames lack transmission edges that the GDELT DOC path had.
 * This module constructs a proxy using:
 * 1. GDELT daily aggregation (goldstein score, tone, event count)
 * 2. Price-based market reaction estimation
 *
 * The proxy replaces zero-valued marketStress and transmissionStress fields
 * in the scoring chain.
 */

export interface TransmissionProxy {
  marketStress: number;       // [0, 1] proxy for market stress
  transmissionStrength: number; // [0, 1] strength of event-market link
  reactionSignificance: number; // [0, 1] how significant the market moved
}

export interface GDELTDailyAgg {
  date: string;
  avgGoldstein: number;   // [-10, 10]
  avgTone: number;        // [-100, 100]
  eventCount: number;
  country?: string;
}

export interface PriceChange {
  symbol: string;
  date: string;
  changePct: number;       // daily % change
  volume?: number;
}

/**
 * Compute transmission proxy from GDELT daily aggregation data.
 *
 * The proxy uses:
 * - Goldstein score magnitude as conflict intensity
 * - Tone deviation from mean as sentiment extremity
 * - Event count surge as attention proxy
 */
export function computeGDELTTransmissionProxy(
  aggs: GDELTDailyAgg[],
  lookbackDays: number = 30,
): TransmissionProxy {
  if (aggs.length === 0) {
    return { marketStress: 0, transmissionStrength: 0, reactionSignificance: 0 };
  }

  const recent = aggs.slice(-lookbackDays);
  const latest = recent[recent.length - 1]!;

  // Goldstein: negative = conflict, positive = cooperation. Extremes = stress.
  const goldsteinValues = recent.map(a => a.avgGoldstein);
  const goldsteinMean = mean(goldsteinValues);
  const goldsteinStd = std(goldsteinValues);
  const goldsteinZScore = goldsteinStd > 0.01
    ? Math.abs(latest.avgGoldstein - goldsteinMean) / goldsteinStd
    : 0;

  // Tone: negative = negative sentiment. Z-score measures extremity.
  const toneValues = recent.map(a => a.avgTone);
  const toneMean = mean(toneValues);
  const toneStd = std(toneValues);
  const toneZScore = toneStd > 0.01
    ? Math.abs(latest.avgTone - toneMean) / toneStd
    : 0;

  // Event count surge: how much above average
  const countValues = recent.map(a => a.eventCount);
  const countMean = mean(countValues);
  const countSurge = countMean > 0
    ? (latest.eventCount - countMean) / countMean
    : 0;

  // Market stress = conflict intensity (negative goldstein = more stress)
  const conflictIntensity = clamp((-latest.avgGoldstein + 5) / 10, 0, 1); // [-5, 5] → [1, 0]
  const sentimentExtremity = clamp(toneZScore / 3, 0, 1);
  const attentionSurge = clamp(countSurge / 2, 0, 1);

  const marketStress = clamp(
    conflictIntensity * 0.45
    + sentimentExtremity * 0.30
    + attentionSurge * 0.25,
    0, 1,
  );

  // Transmission strength = how much goldstein/tone deviates from baseline
  const transmissionStrength = clamp(
    (goldsteinZScore / 3) * 0.5 + (toneZScore / 3) * 0.5,
    0, 1,
  );

  return { marketStress, transmissionStrength, reactionSignificance: 0 };
}

/**
 * Estimate market reaction from price changes around event timestamps.
 *
 * Computes how much the market moved in response to news,
 * relative to typical daily moves (z-score of price change).
 */
export function estimateMarketReaction(
  priceChanges: PriceChange[],
  eventDate: string,
  lookbackDays: number = 60,
): TransmissionProxy {
  if (priceChanges.length === 0) {
    return { marketStress: 0, transmissionStrength: 0, reactionSignificance: 0 };
  }

  const eventTime = new Date(eventDate).getTime();
  const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;

  // Split into baseline and event window
  const baseline: number[] = [];
  const eventWindow: number[] = []; // ±1 day from event

  for (const pc of priceChanges) {
    const pcTime = new Date(pc.date).getTime();
    const diff = pcTime - eventTime;
    const absDiffDays = Math.abs(diff) / (24 * 60 * 60 * 1000);

    if (absDiffDays <= 1) {
      eventWindow.push(Math.abs(pc.changePct));
    } else if (diff < 0 && diff > -lookbackMs) {
      baseline.push(Math.abs(pc.changePct));
    }
  }

  if (baseline.length < 10 || eventWindow.length === 0) {
    return { marketStress: 0, transmissionStrength: 0, reactionSignificance: 0 };
  }

  const baselineMean = mean(baseline);
  const baselineStd = std(baseline);
  const eventMagnitude = mean(eventWindow);

  // Z-score of event-day move relative to baseline
  const reactionZScore = baselineStd > 0.01
    ? (eventMagnitude - baselineMean) / baselineStd
    : 0;

  const reactionSignificance = clamp(reactionZScore / 3, 0, 1);
  const transmissionStrength = clamp(reactionZScore / 2.5, 0, 1);
  const marketStress = clamp(
    reactionSignificance * 0.6 + (eventMagnitude > baselineMean * 2 ? 0.4 : 0),
    0, 1,
  );

  return { marketStress, transmissionStrength, reactionSignificance };
}

/**
 * Combine GDELT proxy and price-based reaction into a single transmission estimate.
 */
export function combineTransmissionProxies(
  gdelt: TransmissionProxy,
  priceReaction: TransmissionProxy,
): TransmissionProxy {
  // Weighted average: price reaction is more direct evidence
  return {
    marketStress: clamp(gdelt.marketStress * 0.4 + priceReaction.marketStress * 0.6, 0, 1),
    transmissionStrength: clamp(gdelt.transmissionStrength * 0.35 + priceReaction.transmissionStrength * 0.65, 0, 1),
    reactionSignificance: clamp(
      Math.max(gdelt.reactionSignificance, priceReaction.reactionSignificance),
      0, 1,
    ),
  };
}

/**
 * SQL query to fetch GDELT daily aggregation for a given date range.
 * To be executed against NAS PostgreSQL.
 */
export function buildGDELTProxyQuery(startDate: string, endDate: string): {
  text: string;
  values: string[];
} {
  return {
    text: `
      SELECT
        date::text as date,
        AVG(avg_goldstein)::float as avg_goldstein,
        AVG(avg_tone)::float as avg_tone,
        SUM(event_count)::int as event_count
      FROM gdelt_daily_agg
      WHERE date >= $1::date AND date <= $2::date
        AND cameo_root IN ('14','17','18','19','20')
      GROUP BY date
      ORDER BY date
    `,
    values: [startDate, endDate],
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, arr.length - 1));
}
