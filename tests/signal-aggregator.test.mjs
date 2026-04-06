/**
 * Signal Aggregator — Convergence Scoring & Clustering Tests
 * Phase 5: Test Coverage Expansion
 *
 * Tests the pure computational logic of signal aggregation:
 * - Convergence score formula
 * - Country clustering
 * - Regional convergence detection
 * - Severity mapping from ingestion sources
 * - Signal pruning (24h window)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Replicated core formulas from signal-aggregator.ts ───

/**
 * Convergence score formula:
 *   typeBonus     = uniqueSignalTypes * 20
 *   countBonus    = min(30, signalCount * 5)
 *   severityBonus = highSeverityCount * 10
 *   total         = min(100, typeBonus + countBonus + severityBonus)
 */
function calcConvergenceScore(signalTypeCount, signalCount, highSeverityCount) {
  const typeBonus = signalTypeCount * 20;
  const countBonus = Math.min(30, signalCount * 5);
  const severityBonus = highSeverityCount * 10;
  return Math.min(100, typeBonus + countBonus + severityBonus);
}

/**
 * Flight severity: count >= 10 → high, >= 5 → medium, else low
 */
function flightSeverity(count) {
  return count >= 10 ? 'high' : count >= 5 ? 'medium' : 'low';
}

/**
 * Vessel severity: count >= 5 → high, >= 2 → medium, else low
 */
function vesselSeverity(count) {
  return count >= 5 ? 'high' : count >= 2 ? 'medium' : 'low';
}

/**
 * Protest severity: count >= 10 → high, >= 5 → medium, else low
 */
function protestSeverity(count) {
  return count >= 10 ? 'high' : count >= 5 ? 'medium' : 'low';
}

/**
 * Outage severity mapping: total → high, major → medium, else low
 */
function outageSeverity(severity) {
  return severity === 'total' ? 'high' : severity === 'major' ? 'medium' : 'low';
}

/**
 * Satellite fire severity by brightness: >360 → high, >320 → medium, else low
 */
function fireSeverity(brightness) {
  return brightness > 360 ? 'high' : brightness > 320 ? 'medium' : 'low';
}

/**
 * Temporal anomaly severity mapping: critical|high → high, else medium
 */
function temporalSeverity(sev) {
  return sev === 'critical' ? 'high' : sev === 'high' ? 'high' : 'medium';
}

/**
 * Glint severity:
 *   critical > 0 || high >= 3 → 'high'
 *   high > 0 || medium >= 3 → 'medium'
 *   else → 'low'
 */
function glintSeverity(severityCounts) {
  if (severityCounts.critical > 0 || severityCounts.high >= 3) return 'high';
  if (severityCounts.high > 0 || severityCounts.medium >= 3) return 'medium';
  return 'low';
}

// Region definitions (replicated from source)
const REGION_DEFINITIONS = {
  middle_east: {
    name: 'Middle East',
    countries: ['IR', 'IL', 'SA', 'AE', 'IQ', 'SY', 'YE', 'JO', 'LB', 'KW', 'QA', 'OM', 'BH'],
  },
  east_asia: {
    name: 'East Asia',
    countries: ['CN', 'TW', 'JP', 'KR', 'KP', 'HK', 'MN'],
  },
  south_asia: {
    name: 'South Asia',
    countries: ['IN', 'PK', 'BD', 'AF', 'NP', 'LK', 'MM'],
  },
  europe_east: {
    name: 'Eastern Europe',
    countries: ['UA', 'RU', 'BY', 'PL', 'RO', 'MD', 'HU', 'CZ', 'SK', 'BG'],
  },
  africa_north: {
    name: 'North Africa',
    countries: ['EG', 'LY', 'DZ', 'TN', 'MA', 'SD', 'SS'],
  },
  africa_sahel: {
    name: 'Sahel Region',
    countries: ['ML', 'NE', 'BF', 'TD', 'NG', 'CM', 'CF'],
  },
};

/**
 * Simulate getCountryClusters logic.
 * Groups signals by country, calculates convergence scores.
 */
function buildClusters(signals) {
  const byCountry = new Map();
  for (const s of signals) {
    if (!byCountry.has(s.country)) byCountry.set(s.country, []);
    byCountry.get(s.country).push(s);
  }

  const clusters = [];
  for (const [country, sigs] of byCountry) {
    const signalTypes = new Set(sigs.map(s => s.type));
    const highCount = sigs.filter(s => s.severity === 'high').length;
    const convergenceScore = calcConvergenceScore(signalTypes.size, sigs.length, highCount);
    clusters.push({
      country,
      signals: sigs,
      signalTypes,
      totalCount: sigs.length,
      highSeverityCount: highCount,
      convergenceScore,
    });
  }

  return clusters.sort((a, b) => b.convergenceScore - a.convergenceScore);
}

/**
 * Simulate getRegionalConvergence logic.
 */
function buildRegionalConvergence(clusters) {
  const convergences = [];

  for (const [, def] of Object.entries(REGION_DEFINITIONS)) {
    const regionClusters = clusters.filter(c => def.countries.includes(c.country));
    if (regionClusters.length < 2) continue;

    const allTypes = new Set();
    let totalSignals = 0;
    for (const cluster of regionClusters) {
      cluster.signalTypes.forEach(t => allTypes.add(t));
      totalSignals += cluster.totalCount;
    }

    if (allTypes.size >= 2) {
      convergences.push({
        region: def.name,
        countries: regionClusters.map(c => c.country),
        signalTypes: [...allTypes],
        totalSignals,
      });
    }
  }

  return convergences.sort((a, b) => b.signalTypes.length - a.signalTypes.length);
}

/**
 * Simulate pruneOld: filter signals older than 24h
 */
function pruneOld(signals) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return signals.filter(s => s.timestamp.getTime() > cutoff);
}


// ═══════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════

describe('Convergence Score Formula', () => {
  it('single type, single signal, no high severity → typeBonus only', () => {
    // 1 type * 20 + min(30, 1*5) + 0*10 = 20 + 5 + 0 = 25
    assert.equal(calcConvergenceScore(1, 1, 0), 25);
  });

  it('multiple types increase score linearly', () => {
    // 3 types * 20 + min(30, 3*5) + 0 = 60 + 15 + 0 = 75
    assert.equal(calcConvergenceScore(3, 3, 0), 75);
  });

  it('countBonus caps at 30', () => {
    // 1 type * 20 + min(30, 10*5) + 0 = 20 + 30 + 0 = 50
    assert.equal(calcConvergenceScore(1, 10, 0), 50);
    // Even more signals → still 30
    assert.equal(calcConvergenceScore(1, 100, 0), 50);
  });

  it('high severity adds 10 per high signal', () => {
    // 1*20 + min(30, 2*5) + 3*10 = 20 + 10 + 30 = 60
    assert.equal(calcConvergenceScore(1, 2, 3), 60);
  });

  it('total score caps at 100', () => {
    // 5*20 + min(30, 20*5) + 10*10 = 100 + 30 + 100 → min(100, 230) = 100
    assert.equal(calcConvergenceScore(5, 20, 10), 100);
  });

  it('zero inputs → zero score', () => {
    assert.equal(calcConvergenceScore(0, 0, 0), 0);
  });
});

describe('Severity Mapping — Military Flights', () => {
  it('10+ aircraft → high', () => {
    assert.equal(flightSeverity(10), 'high');
    assert.equal(flightSeverity(50), 'high');
  });

  it('5-9 aircraft → medium', () => {
    assert.equal(flightSeverity(5), 'medium');
    assert.equal(flightSeverity(9), 'medium');
  });

  it('<5 aircraft → low', () => {
    assert.equal(flightSeverity(1), 'low');
    assert.equal(flightSeverity(4), 'low');
  });
});

describe('Severity Mapping — Naval Vessels', () => {
  it('5+ vessels → high', () => {
    assert.equal(vesselSeverity(5), 'high');
  });

  it('2-4 vessels → medium', () => {
    assert.equal(vesselSeverity(2), 'medium');
    assert.equal(vesselSeverity(4), 'medium');
  });

  it('<2 vessels → low', () => {
    assert.equal(vesselSeverity(1), 'low');
  });
});

describe('Severity Mapping — Protests', () => {
  it('10+ events → high', () => {
    assert.equal(protestSeverity(10), 'high');
  });

  it('5-9 events → medium', () => {
    assert.equal(protestSeverity(5), 'medium');
    assert.equal(protestSeverity(9), 'medium');
  });

  it('<5 events → low', () => {
    assert.equal(protestSeverity(3), 'low');
  });
});

describe('Severity Mapping — Outages', () => {
  it('total → high', () => assert.equal(outageSeverity('total'), 'high'));
  it('major → medium', () => assert.equal(outageSeverity('major'), 'medium'));
  it('minor → low', () => assert.equal(outageSeverity('minor'), 'low'));
  it('unknown string → low', () => assert.equal(outageSeverity('partial'), 'low'));
});

describe('Severity Mapping — Satellite Fires', () => {
  it('>360K brightness → high', () => assert.equal(fireSeverity(400), 'high'));
  it('321-360K brightness → medium', () => assert.equal(fireSeverity(340), 'medium'));
  it('<=320K brightness → low', () => assert.equal(fireSeverity(300), 'low'));
  it('boundary: 360 → medium (not high)', () => assert.equal(fireSeverity(360), 'medium'));
  it('boundary: 320 → low (not medium)', () => assert.equal(fireSeverity(320), 'low'));
});

describe('Severity Mapping — Temporal Anomalies', () => {
  it('critical → high', () => assert.equal(temporalSeverity('critical'), 'high'));
  it('high → high', () => assert.equal(temporalSeverity('high'), 'high'));
  it('medium → medium', () => assert.equal(temporalSeverity('medium'), 'medium'));
});

describe('Severity Mapping — Glint Signals', () => {
  it('critical > 0 → high', () => {
    assert.equal(glintSeverity({ critical: 1, high: 0, medium: 0 }), 'high');
  });

  it('high >= 3 → high', () => {
    assert.equal(glintSeverity({ critical: 0, high: 3, medium: 0 }), 'high');
  });

  it('high > 0 but < 3 → medium', () => {
    assert.equal(glintSeverity({ critical: 0, high: 1, medium: 0 }), 'medium');
  });

  it('medium >= 3, no high → medium', () => {
    assert.equal(glintSeverity({ critical: 0, high: 0, medium: 3 }), 'medium');
  });

  it('all zero → low', () => {
    assert.equal(glintSeverity({ critical: 0, high: 0, medium: 0 }), 'low');
  });
});

describe('Country Clustering', () => {
  it('groups signals by country', () => {
    const signals = [
      { type: 'protest', country: 'IR', severity: 'low', timestamp: new Date() },
      { type: 'military_flight', country: 'IR', severity: 'high', timestamp: new Date() },
      { type: 'protest', country: 'UA', severity: 'medium', timestamp: new Date() },
    ];
    const clusters = buildClusters(signals);
    assert.equal(clusters.length, 2);
    // IR has 2 types so higher score → first
    const ir = clusters.find(c => c.country === 'IR');
    assert.ok(ir);
    assert.equal(ir.totalCount, 2);
    assert.equal(ir.signalTypes.size, 2);
    assert.equal(ir.highSeverityCount, 1);
  });

  it('sorts clusters by convergence score descending', () => {
    const signals = [
      { type: 'protest', country: 'A', severity: 'low', timestamp: new Date() },
      { type: 'protest', country: 'B', severity: 'high', timestamp: new Date() },
      { type: 'military_flight', country: 'B', severity: 'high', timestamp: new Date() },
      { type: 'internet_outage', country: 'B', severity: 'high', timestamp: new Date() },
    ];
    const clusters = buildClusters(signals);
    assert.equal(clusters[0].country, 'B');
    assert.ok(clusters[0].convergenceScore > clusters[1].convergenceScore);
  });

  it('empty signals → empty clusters', () => {
    assert.deepStrictEqual(buildClusters([]), []);
  });
});

describe('Regional Convergence Detection', () => {
  it('detects convergence when 2+ countries in same region have 2+ signal types', () => {
    const signals = [
      { type: 'protest', country: 'IR', severity: 'low', timestamp: new Date() },
      { type: 'military_flight', country: 'IL', severity: 'high', timestamp: new Date() },
    ];
    const clusters = buildClusters(signals);
    const convergences = buildRegionalConvergence(clusters);
    assert.equal(convergences.length, 1);
    assert.equal(convergences[0].region, 'Middle East');
    assert.deepStrictEqual(convergences[0].countries.sort(), ['IL', 'IR']);
    assert.equal(convergences[0].signalTypes.length, 2);
  });

  it('no convergence if only 1 country in region has signals', () => {
    const signals = [
      { type: 'protest', country: 'IR', severity: 'low', timestamp: new Date() },
      { type: 'military_flight', country: 'IR', severity: 'high', timestamp: new Date() },
    ];
    const clusters = buildClusters(signals);
    const convergences = buildRegionalConvergence(clusters);
    assert.equal(convergences.length, 0);
  });

  it('no convergence if 2 countries in region but same signal type', () => {
    const signals = [
      { type: 'protest', country: 'IR', severity: 'low', timestamp: new Date() },
      { type: 'protest', country: 'IL', severity: 'low', timestamp: new Date() },
    ];
    const clusters = buildClusters(signals);
    const convergences = buildRegionalConvergence(clusters);
    assert.equal(convergences.length, 0);
  });

  it('detects multiple regions simultaneously', () => {
    const signals = [
      // Middle East
      { type: 'protest', country: 'IR', severity: 'low', timestamp: new Date() },
      { type: 'military_flight', country: 'SA', severity: 'high', timestamp: new Date() },
      // East Asia
      { type: 'internet_outage', country: 'CN', severity: 'high', timestamp: new Date() },
      { type: 'ais_disruption', country: 'TW', severity: 'medium', timestamp: new Date() },
    ];
    const clusters = buildClusters(signals);
    const convergences = buildRegionalConvergence(clusters);
    assert.equal(convergences.length, 2);
    const regions = convergences.map(c => c.region).sort();
    assert.deepStrictEqual(regions, ['East Asia', 'Middle East']);
  });

  it('sorts by number of signal types descending', () => {
    const signals = [
      // Middle East — 3 types
      { type: 'protest', country: 'IR', severity: 'low', timestamp: new Date() },
      { type: 'military_flight', country: 'SA', severity: 'high', timestamp: new Date() },
      { type: 'internet_outage', country: 'IQ', severity: 'low', timestamp: new Date() },
      // East Asia — 2 types
      { type: 'ais_disruption', country: 'CN', severity: 'medium', timestamp: new Date() },
      { type: 'protest', country: 'TW', severity: 'low', timestamp: new Date() },
    ];
    const clusters = buildClusters(signals);
    const convergences = buildRegionalConvergence(clusters);
    assert.equal(convergences[0].region, 'Middle East');
    assert.ok(convergences[0].signalTypes.length >= convergences[1].signalTypes.length);
  });
});

describe('Signal Pruning (24h Window)', () => {
  it('keeps signals within 24h', () => {
    const now = new Date();
    const signals = [
      { type: 'protest', country: 'US', severity: 'low', timestamp: now },
    ];
    const pruned = pruneOld(signals);
    assert.equal(pruned.length, 1);
  });

  it('removes signals older than 24h', () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
    const signals = [
      { type: 'protest', country: 'US', severity: 'low', timestamp: old },
    ];
    const pruned = pruneOld(signals);
    assert.equal(pruned.length, 0);
  });

  it('keeps recent and removes old in mixed set', () => {
    const now = new Date();
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const signals = [
      { type: 'protest', country: 'US', severity: 'low', timestamp: now },
      { type: 'military_flight', country: 'RU', severity: 'high', timestamp: old },
    ];
    const pruned = pruneOld(signals);
    assert.equal(pruned.length, 1);
    assert.equal(pruned[0].country, 'US');
  });
});
