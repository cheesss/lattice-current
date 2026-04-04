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

// ---------------------------------------------------------------------------
// Credit transmission channel
// ---------------------------------------------------------------------------

export interface CreditSpreadInput {
  hySpread: number;          // current HY spread (bps or ratio)
  hySpread30dAvg: number;    // 30-day average
  igSpread: number;          // current IG spread
  igSpread30dAvg: number;    // 30-day average
}

export function computeCreditTransmissionProxy(input: CreditSpreadInput): TransmissionProxy {
  const { hySpread, hySpread30dAvg, igSpread, igSpread30dAvg } = input;

  // Z-score: how much wider are spreads vs 30d avg
  const hyZScore = hySpread30dAvg > 0.01
    ? (hySpread - hySpread30dAvg) / Math.max(hySpread30dAvg * 0.1, 0.01)
    : 0;
  const igZScore = igSpread30dAvg > 0.01
    ? (igSpread - igSpread30dAvg) / Math.max(igSpread30dAvg * 0.1, 0.01)
    : 0;

  // Widening spreads = stress
  const marketStress = clamp(
    (clamp(hyZScore, 0, 5) / 5) * 0.6 + (clamp(igZScore, 0, 5) / 5) * 0.4,
    0, 1,
  );

  // Transmission = absolute deviation from mean
  const transmissionStrength = clamp(
    (Math.abs(hyZScore) / 4) * 0.55 + (Math.abs(igZScore) / 4) * 0.45,
    0, 1,
  );

  return { marketStress, transmissionStrength, reactionSignificance: 0 };
}

// ---------------------------------------------------------------------------
// Positioning transmission channel
// ---------------------------------------------------------------------------

export interface PositioningInput {
  cotNetPct: number;       // COT net positioning as % of open interest
  cotMomentum: number;     // 1w vs 4w momentum (from signal-history-buffer)
  putCallRatio: number;    // CBOE total put/call ratio
  putCallZScore: number;   // 30-day z-score of put/call
}

export function computePositioningProxy(input: PositioningInput): TransmissionProxy {
  const { cotNetPct, cotMomentum, putCallRatio, putCallZScore } = input;

  // Extreme put/call = market fear = high stress
  // Normal PC ratio ~0.7-0.9, extreme >1.2
  const pcStress = clamp((putCallRatio - 0.7) / 0.8, 0, 1);
  const pcZStress = clamp(putCallZScore / 3, 0, 1);

  const marketStress = clamp(pcStress * 0.5 + pcZStress * 0.5, 0, 1);

  // COT extremes = institutions are positioned = transmission is active
  const cotExtreme = clamp(Math.abs(cotNetPct) / 30, 0, 1); // ±30% as max
  const cotMom = clamp(Math.abs(cotMomentum), 0, 1);

  const transmissionStrength = clamp(
    cotExtreme * 0.6 + cotMom * 0.4,
    0, 1,
  );

  return { marketStress, transmissionStrength, reactionSignificance: 0 };
}

// ---------------------------------------------------------------------------
// Combined 4-channel transmission
// ---------------------------------------------------------------------------

export interface CombineProxiesOptions {
  gdelt?: TransmissionProxy | null;
  priceReaction?: TransmissionProxy | null;
  credit?: TransmissionProxy | null;
  positioning?: TransmissionProxy | null;
}

/**
 * Combine up to 4 transmission channels into a single estimate.
 * Channels that are null/undefined are excluded and weights rebalanced.
 */
export function combineTransmissionProxies(
  gdelt: TransmissionProxy,
  priceReaction: TransmissionProxy,
  options?: { credit?: TransmissionProxy | null; positioning?: TransmissionProxy | null },
): TransmissionProxy {
  const channels: { proxy: TransmissionProxy; stressW: number; txW: number }[] = [
    { proxy: gdelt, stressW: 0.20, txW: 0.20 },
    { proxy: priceReaction, stressW: 0.35, txW: 0.35 },
  ];

  if (options?.credit) {
    channels.push({ proxy: options.credit, stressW: 0.25, txW: 0.25 });
  }
  if (options?.positioning) {
    channels.push({ proxy: options.positioning, stressW: 0.20, txW: 0.20 });
  }

  // Rebalance weights to sum to 1
  const totalStressW = channels.reduce((s, c) => s + c.stressW, 0);
  const totalTxW = channels.reduce((s, c) => s + c.txW, 0);

  let marketStress = 0;
  let transmissionStrength = 0;
  let maxReaction = 0;

  for (const ch of channels) {
    marketStress += ch.proxy.marketStress * (ch.stressW / totalStressW);
    transmissionStrength += ch.proxy.transmissionStrength * (ch.txW / totalTxW);
    maxReaction = Math.max(maxReaction, ch.proxy.reactionSignificance);
  }

  return {
    marketStress: clamp(marketStress, 0, 1),
    transmissionStrength: clamp(transmissionStrength, 0, 1),
    reactionSignificance: clamp(maxReaction, 0, 1),
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
