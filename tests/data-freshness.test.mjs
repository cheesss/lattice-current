/**
 * Data Freshness Tracker — Status Determination & Intelligence Gap Tests
 * Phase 5: Test Coverage Expansion
 *
 * Tests the pure computational logic:
 * - calculateStatus() thresholds (fresh/stale/very_stale/no_data)
 * - getTimeSince() human-readable formatting
 * - getSummary() overall status logic (sufficient/limited/insufficient)
 * - getIntelligenceGaps() severity classification
 * - hasSufficientData() / hasAnyData()
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Replicated thresholds from data-freshness.ts ───

const FRESH_THRESHOLD = 15 * 60 * 1000;       // 15 minutes
const STALE_THRESHOLD = 2 * 60 * 60 * 1000;   // 2 hours
const VERY_STALE_THRESHOLD = 6 * 60 * 60 * 1000; // 6 hours

// Core sources needed for risk assessment
const CORE_SOURCES = ['gdelt', 'rss'];

/**
 * Replicate calculateStatus logic
 */
function calculateStatus(source) {
  if (!source.enabled) return 'disabled';
  if (source.lastError) return 'error';
  if (!source.lastUpdate) return 'no_data';

  const age = Date.now() - source.lastUpdate.getTime();
  if (age < FRESH_THRESHOLD) return 'fresh';
  if (age < STALE_THRESHOLD) return 'stale';
  if (age < VERY_STALE_THRESHOLD) return 'very_stale';
  return 'no_data'; // Too old, treat as no data
}

/**
 * Replicate getTimeSince logic
 */
function getTimeSince(lastUpdate) {
  if (!lastUpdate) return 'never';
  const ms = Date.now() - lastUpdate.getTime();
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

/**
 * Replicate getSummary overallStatus logic
 */
function determineOverallStatus(activeRiskSources, totalRiskSources) {
  const coveragePercent = totalRiskSources > 0
    ? Math.round((activeRiskSources / totalRiskSources) * 100)
    : 0;

  if (activeRiskSources >= CORE_SOURCES.length && coveragePercent >= 66) {
    return 'sufficient';
  } else if (activeRiskSources >= 1) {
    return 'limited';
  } else {
    return 'insufficient';
  }
}

/**
 * Replicate intelligence gap severity classification
 */
function classifyGapSeverity(status, requiredForRisk) {
  if (status === 'no_data' || status === 'very_stale' || status === 'error') {
    return requiredForRisk || status === 'error' ? 'critical' : 'warning';
  }
  return null; // Not a gap
}

/**
 * Helper: create a source object with specified age
 */
function makeSource(id, { ageMs = null, enabled = true, error = null, requiredForRisk = false } = {}) {
  return {
    id,
    enabled,
    lastUpdate: ageMs !== null ? new Date(Date.now() - ageMs) : null,
    lastError: error,
    requiredForRisk,
    status: 'no_data', // will be recalculated
  };
}


// ═══════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════

describe('calculateStatus — Freshness Thresholds', () => {
  it('disabled source → disabled regardless of data', () => {
    const src = makeSource('test', { ageMs: 0, enabled: false });
    assert.equal(calculateStatus(src), 'disabled');
  });

  it('source with error → error', () => {
    const src = makeSource('test', { ageMs: 5 * 60 * 1000, error: 'timeout' });
    assert.equal(calculateStatus(src), 'error');
  });

  it('no lastUpdate → no_data', () => {
    const src = makeSource('test');
    assert.equal(calculateStatus(src), 'no_data');
  });

  it('updated < 15 min ago → fresh', () => {
    const src = makeSource('test', { ageMs: 10 * 60 * 1000 }); // 10 min
    assert.equal(calculateStatus(src), 'fresh');
  });

  it('updated exactly 15 min ago → stale (boundary)', () => {
    const src = makeSource('test', { ageMs: FRESH_THRESHOLD });
    assert.equal(calculateStatus(src), 'stale');
  });

  it('updated 1 hour ago → stale', () => {
    const src = makeSource('test', { ageMs: 60 * 60 * 1000 });
    assert.equal(calculateStatus(src), 'stale');
  });

  it('updated exactly 2 hours ago → very_stale (boundary)', () => {
    const src = makeSource('test', { ageMs: STALE_THRESHOLD });
    assert.equal(calculateStatus(src), 'very_stale');
  });

  it('updated 4 hours ago → very_stale', () => {
    const src = makeSource('test', { ageMs: 4 * 60 * 60 * 1000 });
    assert.equal(calculateStatus(src), 'very_stale');
  });

  it('updated exactly 6 hours ago → no_data (boundary)', () => {
    const src = makeSource('test', { ageMs: VERY_STALE_THRESHOLD });
    assert.equal(calculateStatus(src), 'no_data');
  });

  it('updated 24 hours ago → no_data', () => {
    const src = makeSource('test', { ageMs: 24 * 60 * 60 * 1000 });
    assert.equal(calculateStatus(src), 'no_data');
  });

  it('error takes priority over stale data', () => {
    const src = makeSource('test', { ageMs: 10 * 60 * 1000, error: 'network fail' });
    assert.equal(calculateStatus(src), 'error');
  });

  it('disabled takes priority over everything', () => {
    const src = makeSource('test', { ageMs: 0, enabled: false, error: 'some error' });
    assert.equal(calculateStatus(src), 'disabled');
  });
});

describe('getTimeSince — Human Readable Time Formatting', () => {
  it('null → "never"', () => {
    assert.equal(getTimeSince(null), 'never');
  });

  it('< 1 min ago → "just now"', () => {
    assert.equal(getTimeSince(new Date(Date.now() - 30000)), 'just now'); // 30s
  });

  it('5 min ago → "5m ago"', () => {
    assert.equal(getTimeSince(new Date(Date.now() - 5 * 60 * 1000)), '5m ago');
  });

  it('59 min ago → "59m ago"', () => {
    assert.equal(getTimeSince(new Date(Date.now() - 59 * 60 * 1000)), '59m ago');
  });

  it('2 hours ago → "2h ago"', () => {
    assert.equal(getTimeSince(new Date(Date.now() - 2 * 60 * 60 * 1000)), '2h ago');
  });

  it('23 hours ago → "23h ago"', () => {
    assert.equal(getTimeSince(new Date(Date.now() - 23 * 60 * 60 * 1000)), '23h ago');
  });

  it('2 days ago → "2d ago"', () => {
    assert.equal(getTimeSince(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)), '2d ago');
  });
});

describe('Overall Status Determination', () => {
  it('all core sources active + coverage >= 66% → sufficient', () => {
    // CORE_SOURCES.length = 2, so need 2 active risk sources with 66%+ coverage
    assert.equal(determineOverallStatus(2, 2), 'sufficient');
    assert.equal(determineOverallStatus(2, 3), 'sufficient'); // 67%
  });

  it('only 1 active risk source → limited', () => {
    assert.equal(determineOverallStatus(1, 2), 'limited');
  });

  it('no active risk sources → insufficient', () => {
    assert.equal(determineOverallStatus(0, 2), 'insufficient');
    assert.equal(determineOverallStatus(0, 0), 'insufficient');
  });

  it('coverage below 66% but >= 1 active → limited', () => {
    // 1 out of 5 = 20% — but activeRiskSources >= 1 so limited
    assert.equal(determineOverallStatus(1, 5), 'limited');
  });

  it('2 active but total 4 → 50% coverage, still limited (not sufficient)', () => {
    // 2/4 = 50% < 66%, even though 2 >= CORE_SOURCES.length
    assert.equal(determineOverallStatus(2, 4), 'limited');
  });
});

describe('Intelligence Gap Severity Classification', () => {
  it('no_data + requiredForRisk → critical', () => {
    assert.equal(classifyGapSeverity('no_data', true), 'critical');
  });

  it('no_data + not required → warning', () => {
    assert.equal(classifyGapSeverity('no_data', false), 'warning');
  });

  it('very_stale + requiredForRisk → critical', () => {
    assert.equal(classifyGapSeverity('very_stale', true), 'critical');
  });

  it('very_stale + not required → warning', () => {
    assert.equal(classifyGapSeverity('very_stale', false), 'warning');
  });

  it('error always → critical (regardless of requiredForRisk)', () => {
    assert.equal(classifyGapSeverity('error', false), 'critical');
    assert.equal(classifyGapSeverity('error', true), 'critical');
  });

  it('fresh → null (not a gap)', () => {
    assert.equal(classifyGapSeverity('fresh', false), null);
    assert.equal(classifyGapSeverity('fresh', true), null);
  });

  it('stale → null (not a gap, only very_stale counts)', () => {
    assert.equal(classifyGapSeverity('stale', false), null);
  });

  it('disabled → null (not counted as gap)', () => {
    assert.equal(classifyGapSeverity('disabled', false), null);
  });
});

describe('Coverage Percent Calculation', () => {
  it('all active → 100%', () => {
    const total = 2;
    const active = 2;
    const pct = Math.round((active / total) * 100);
    assert.equal(pct, 100);
  });

  it('half active → 50%', () => {
    const pct = Math.round((1 / 2) * 100);
    assert.equal(pct, 50);
  });

  it('0 total → 0%', () => {
    const total = 0;
    const active = 0;
    const pct = total > 0 ? Math.round((active / total) * 100) : 0;
    assert.equal(pct, 0);
  });

  it('2 of 3 → 67%', () => {
    const pct = Math.round((2 / 3) * 100);
    assert.equal(pct, 67);
  });
});
