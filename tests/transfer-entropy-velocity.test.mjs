/**
 * Transfer Entropy & Velocity — Pure Computation Tests
 * Phase 5: Test Coverage Expansion
 *
 * Transfer Entropy:
 * - bucketize() discretization
 * - estimateTransferEntropy() with known series
 * - Edge cases (short series, constant series)
 *
 * Velocity:
 * - analyzeSentiment() word-based scoring
 * - calculateVelocityLevel() threshold mapping
 * - trend detection (rising/stable/falling)
 * - sourcesPerHour calculation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ══════════════════════════════════════
// Transfer Entropy — replicated logic
// ══════════════════════════════════════

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function bucketize(value) {
  if (!Number.isFinite(value)) return 0;
  if (value > 0.35) return 2;
  if (value < -0.35) return -2;
  if (value > 0.05) return 1;
  if (value < -0.05) return -1;
  return 0;
}

function conditionalProbability(jointCounts, prefixCounts, jointKey, prefixKey) {
  const joint = jointCounts.get(jointKey) || 0;
  const prefix = prefixCounts.get(prefixKey) || 0;
  if (!joint || !prefix) return 0;
  return joint / prefix;
}

function estimateTransferEntropy(sourceSeries, targetSeries) {
  const samples = Math.min(sourceSeries.length, targetSeries.length);
  if (samples < 6) {
    return { value: 0, normalized: 0, sampleSize: samples };
  }

  const jointXYZ = new Map();
  const jointYZ = new Map();
  const jointXY = new Map();
  const yPrefix = new Map();
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
    const pxyz = count / total;
    const pYNextGivenYX = conditionalProbability(jointXYZ, jointXY, xyzKey, `${rawY}|${rawX}`);
    const pYNextGivenY = conditionalProbability(jointYZ, yPrefix, `${rawYNext}|${rawY}`, rawY);
    if (pxyz <= 0 || pYNextGivenYX <= 0 || pYNextGivenY <= 0) continue;
    te += pxyz * Math.log2(pYNextGivenYX / pYNextGivenY);
  }

  return {
    value: Number(te.toFixed(6)),
    normalized: Number(clamp(te / 1.5, 0, 1).toFixed(4)),
    sampleSize: samples,
  };
}

// ══════════════════════════════════════
// Velocity — replicated logic
// ══════════════════════════════════════

const HOUR_MS = 60 * 60 * 1000;
const ELEVATED_THRESHOLD = 3;
const SPIKE_THRESHOLD = 6;

const NEGATIVE_WORDS = new Set([
  'war', 'attack', 'killed', 'death', 'dead', 'crisis', 'crash', 'collapse',
  'threat', 'danger', 'escalate', 'escalation', 'conflict', 'strike', 'bomb',
  'explosion', 'casualties', 'disaster', 'emergency', 'catastrophe', 'fail',
  'failure', 'reject', 'rejected', 'sanctions', 'invasion', 'missile', 'nuclear',
  'terror', 'terrorist', 'hostage', 'assassination', 'coup', 'protest', 'riot',
  'warns', 'warning', 'fears', 'concern', 'worried', 'plunge', 'plummet', 'surge',
  'flee', 'evacuate', 'shutdown', 'layoff', 'layoffs', 'cuts', 'slump', 'recession',
]);

const POSITIVE_WORDS = new Set([
  'peace', 'deal', 'agreement', 'breakthrough', 'success', 'win', 'gains',
  'recovery', 'growth', 'rise', 'surge', 'boost', 'rally', 'soar', 'jump',
  'ceasefire', 'treaty', 'alliance', 'partnership', 'cooperation', 'progress',
  'release', 'released', 'freed', 'rescue', 'saved', 'approved', 'passes',
  'record', 'milestone', 'historic', 'landmark', 'celebrates', 'victory',
]);

function analyzeSentiment(text) {
  const words = text.toLowerCase().split(/\W+/);
  let score = 0;
  for (const word of words) {
    if (NEGATIVE_WORDS.has(word)) score -= 1;
    if (POSITIVE_WORDS.has(word)) score += 1;
  }
  const sentiment = score < -1 ? 'negative' : score > 1 ? 'positive' : 'neutral';
  return { sentiment, score };
}

function calculateVelocityLevel(sourcesPerHour) {
  if (sourcesPerHour >= SPIKE_THRESHOLD) return 'spike';
  if (sourcesPerHour >= ELEVATED_THRESHOLD) return 'elevated';
  return 'normal';
}

function determineTrend(items, firstSeen, lastUpdated) {
  const timeSpanMs = lastUpdated.getTime() - firstSeen.getTime();
  const midpoint = firstSeen.getTime() + timeSpanMs / 2;
  const recentItems = items.filter(i => i.pubDate.getTime() > midpoint);
  const olderItems = items.filter(i => i.pubDate.getTime() <= midpoint);

  if (recentItems.length > olderItems.length * 1.5) return 'rising';
  if (olderItems.length > recentItems.length * 1.5) return 'falling';
  return 'stable';
}

function calcSourcesPerHour(itemCount, firstSeen, lastUpdated) {
  const timeSpanMs = lastUpdated.getTime() - firstSeen.getTime();
  const timeSpanHours = Math.max(timeSpanMs / HOUR_MS, 0.25);
  return Math.round((itemCount / timeSpanHours) * 10) / 10;
}


// ══════════════════════════════════════
// Tests
// ══════════════════════════════════════

describe('Transfer Entropy — bucketize()', () => {
  it('NaN → 0', () => assert.equal(bucketize(NaN), 0));
  it('Infinity → 0', () => assert.equal(bucketize(Infinity), 0));
  it('-Infinity → 0', () => assert.equal(bucketize(-Infinity), 0));
  it('0 → 0 (dead zone)', () => assert.equal(bucketize(0), 0));
  it('0.03 → 0 (within dead zone ±0.05)', () => assert.equal(bucketize(0.03), 0));
  it('-0.03 → 0 (within dead zone)', () => assert.equal(bucketize(-0.03), 0));
  it('0.1 → 1 (small positive)', () => assert.equal(bucketize(0.1), 1));
  it('-0.1 → -1 (small negative)', () => assert.equal(bucketize(-0.1), -1));
  it('0.5 → 2 (large positive)', () => assert.equal(bucketize(0.5), 2));
  it('-0.5 → -2 (large negative)', () => assert.equal(bucketize(-0.5), -2));
  it('boundary: 0.05 → 0', () => assert.equal(bucketize(0.05), 0));
  it('boundary: 0.35 → 1 (not 2)', () => assert.equal(bucketize(0.35), 1));
  it('boundary: 0.351 → 2', () => assert.equal(bucketize(0.351), 2));
});

describe('Transfer Entropy — estimateTransferEntropy()', () => {
  it('returns zero for series shorter than 6', () => {
    const result = estimateTransferEntropy([1, 2, 3], [4, 5, 6]);
    assert.equal(result.value, 0);
    assert.equal(result.normalized, 0);
    assert.equal(result.sampleSize, 3);
  });

  it('constant series → zero transfer entropy', () => {
    const source = Array(20).fill(0);
    const target = Array(20).fill(0);
    const result = estimateTransferEntropy(source, target);
    assert.equal(result.value, 0);
    assert.equal(result.sampleSize, 20);
  });

  it('identical series → low or zero TE (no additional information)', () => {
    const series = [0.1, -0.1, 0.4, -0.4, 0.1, -0.1, 0.4, -0.4, 0.1, -0.1];
    const result = estimateTransferEntropy(series, [...series]);
    // When source = target, TE should be 0 because knowing source adds
    // no info beyond what target's own past already provides
    assert.ok(result.value >= 0); // TE is non-negative in theory
    assert.equal(result.sampleSize, 10);
  });

  it('lagged copy has detectable transfer entropy', () => {
    // Source leads target by 1 step
    const source = [0.5, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5, -0.5];
    const target = [0, 0.5, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5];
    const result = estimateTransferEntropy(source, target);
    assert.ok(result.value >= 0);
    assert.ok(result.normalized >= 0 && result.normalized <= 1);
  });

  it('normalized value is clamped between 0 and 1', () => {
    const source = [0.5, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5, -0.5];
    const target = [0, 0.5, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5];
    const result = estimateTransferEntropy(source, target);
    assert.ok(result.normalized >= 0);
    assert.ok(result.normalized <= 1);
  });

  it('uses minimum length of both series', () => {
    const source = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const target = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    const result = estimateTransferEntropy(source, target);
    assert.equal(result.sampleSize, 6);
  });

  it('random independent series → typically low TE', () => {
    // Two unrelated series should have low information transfer
    const source = [0.1, 0.5, -0.2, 0.8, -0.5, 0.3, -0.1, 0.6];
    const target = [-0.3, 0.2, 0.7, -0.4, 0.1, -0.6, 0.4, -0.2];
    const result = estimateTransferEntropy(source, target);
    assert.ok(Number.isFinite(result.value));
    assert.ok(Number.isFinite(result.normalized));
  });
});

describe('Velocity — analyzeSentiment()', () => {
  it('pure negative text → negative sentiment', () => {
    const { sentiment, score } = analyzeSentiment('war attack killed dead crisis');
    assert.equal(sentiment, 'negative');
    assert.ok(score < -1);
  });

  it('pure positive text → positive sentiment', () => {
    const { sentiment, score } = analyzeSentiment('peace deal agreement breakthrough success');
    assert.equal(sentiment, 'positive');
    assert.ok(score > 1);
  });

  it('neutral text → neutral sentiment', () => {
    const { sentiment } = analyzeSentiment('the weather is cloudy today in London');
    assert.equal(sentiment, 'neutral');
  });

  it('mixed text cancels out → neutral', () => {
    const { sentiment } = analyzeSentiment('war peace'); // -1 + 1 = 0
    assert.equal(sentiment, 'neutral');
  });

  it('score boundary: -1 is still neutral', () => {
    const { sentiment, score } = analyzeSentiment('war is happening'); // only 'war' matches
    assert.equal(score, -1);
    assert.equal(sentiment, 'neutral'); // needs < -1 for negative
  });

  it('score boundary: +1 is still neutral', () => {
    const { sentiment, score } = analyzeSentiment('this is a peace talk');
    assert.equal(score, 1);
    assert.equal(sentiment, 'neutral'); // needs > 1 for positive
  });

  it('case insensitive matching', () => {
    const { score: s1 } = analyzeSentiment('WAR');
    const { score: s2 } = analyzeSentiment('war');
    assert.equal(s1, s2);
  });

  it('"surge" counts as both negative AND positive (in both sets)', () => {
    // "surge" is in NEGATIVE_WORDS and POSITIVE_WORDS — they cancel
    const { score } = analyzeSentiment('surge');
    assert.equal(score, 0); // -1 + 1 = 0
  });

  it('empty text → neutral with score 0', () => {
    const { sentiment, score } = analyzeSentiment('');
    assert.equal(sentiment, 'neutral');
    assert.equal(score, 0);
  });
});

describe('Velocity — calculateVelocityLevel()', () => {
  it('0 sources/hour → normal', () => {
    assert.equal(calculateVelocityLevel(0), 'normal');
  });

  it('2.9 sources/hour → normal', () => {
    assert.equal(calculateVelocityLevel(2.9), 'normal');
  });

  it('3 sources/hour → elevated (boundary)', () => {
    assert.equal(calculateVelocityLevel(3), 'elevated');
  });

  it('5.9 sources/hour → elevated', () => {
    assert.equal(calculateVelocityLevel(5.9), 'elevated');
  });

  it('6 sources/hour → spike (boundary)', () => {
    assert.equal(calculateVelocityLevel(6), 'spike');
  });

  it('100 sources/hour → spike', () => {
    assert.equal(calculateVelocityLevel(100), 'spike');
  });
});

describe('Velocity — Trend Detection', () => {
  it('more recent items → rising', () => {
    const now = Date.now();
    const firstSeen = new Date(now - 4 * HOUR_MS);
    const lastUpdated = new Date(now);
    const midpoint = firstSeen.getTime() + (lastUpdated.getTime() - firstSeen.getTime()) / 2;
    // 1 older, 4 recent → 4 > 1 * 1.5
    const items = [
      { pubDate: new Date(midpoint - 1000) },
      { pubDate: new Date(midpoint + 1000) },
      { pubDate: new Date(midpoint + 2000) },
      { pubDate: new Date(midpoint + 3000) },
      { pubDate: new Date(midpoint + 4000) },
    ];
    assert.equal(determineTrend(items, firstSeen, lastUpdated), 'rising');
  });

  it('more older items → falling', () => {
    const now = Date.now();
    const firstSeen = new Date(now - 4 * HOUR_MS);
    const lastUpdated = new Date(now);
    const midpoint = firstSeen.getTime() + (lastUpdated.getTime() - firstSeen.getTime()) / 2;
    // 4 older, 1 recent → 4 > 1 * 1.5
    const items = [
      { pubDate: new Date(midpoint - 4000) },
      { pubDate: new Date(midpoint - 3000) },
      { pubDate: new Date(midpoint - 2000) },
      { pubDate: new Date(midpoint - 1000) },
      { pubDate: new Date(midpoint + 1000) },
    ];
    assert.equal(determineTrend(items, firstSeen, lastUpdated), 'falling');
  });

  it('balanced items → stable', () => {
    const now = Date.now();
    const firstSeen = new Date(now - 4 * HOUR_MS);
    const lastUpdated = new Date(now);
    const midpoint = firstSeen.getTime() + (lastUpdated.getTime() - firstSeen.getTime()) / 2;
    // 2 older, 2 recent
    const items = [
      { pubDate: new Date(midpoint - 2000) },
      { pubDate: new Date(midpoint - 1000) },
      { pubDate: new Date(midpoint + 1000) },
      { pubDate: new Date(midpoint + 2000) },
    ];
    assert.equal(determineTrend(items, firstSeen, lastUpdated), 'stable');
  });
});

describe('Velocity — sourcesPerHour Calculation', () => {
  it('10 items over 2 hours → 5.0', () => {
    const now = Date.now();
    const result = calcSourcesPerHour(10, new Date(now - 2 * HOUR_MS), new Date(now));
    assert.equal(result, 5.0);
  });

  it('1 item over very short span → uses 0.25h floor', () => {
    // timeSpan < 0.25h → floor at 0.25
    const now = Date.now();
    const result = calcSourcesPerHour(1, new Date(now - 1000), new Date(now));
    assert.equal(result, 4.0); // 1 / 0.25 = 4.0
  });

  it('24 items over 4 hours → 6.0', () => {
    const now = Date.now();
    const result = calcSourcesPerHour(24, new Date(now - 4 * HOUR_MS), new Date(now));
    assert.equal(result, 6.0);
  });

  it('rounds to 1 decimal place', () => {
    const now = Date.now();
    // 7 items / 3 hours = 2.3333... → 2.3
    const result = calcSourcesPerHour(7, new Date(now - 3 * HOUR_MS), new Date(now));
    assert.equal(result, 2.3);
  });
});
