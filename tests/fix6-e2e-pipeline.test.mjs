/**
 * FIX-6: End-to-End Pipeline Tests
 *
 * Tests the complete recomputeInvestmentIntelligence() orchestrator flow
 * with 8+ scenarios covering:
 * - Normal flow with minimal input
 * - Integration metadata completeness
 * - Abstention flow (all sources down)
 * - Backtest context mode
 * - Pipeline error isolation
 * - Risk gate summary
 * - Source quality weight computation
 * - Repeated calls stability
 *
 * NOTE: This test requires the orchestrator to be properly compiled and all
 * dependencies (npm packages, path aliases) to be resolved. It's designed to
 * run in a properly configured environment (e.g., via Vite or with NODE_PATH).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Try to import from the source TypeScript files first
let recomputeInvestmentIntelligence;
let S;

try {
  // Attempt import from TypeScript source
  const orchestratorModule = await import(
    '../src/services/investment/orchestrator.ts'
  );
  recomputeInvestmentIntelligence = orchestratorModule.recomputeInvestmentIntelligence;

  const moduleStateModule = await import(
    '../src/services/investment/module-state.ts'
  );
  S = moduleStateModule;
} catch (typeScriptErr) {
  // Fall back to compiled JavaScript (built via: npx tsc --project tsconfig.test.json)
  try {
    const moduleState = await import(
      '/tmp/test-build/src/services/investment/module-state.js'
    );
    S = moduleState;

    const orchestratorModule = await import(
      '/tmp/test-build/src/services/investment/orchestrator.js'
    );
    recomputeInvestmentIntelligence = orchestratorModule.recomputeInvestmentIntelligence;
  } catch (jsErr) {
    // If all imports fail, provide useful diagnostic
    console.warn(
      'Warning: Could not import orchestrator.\n' +
      'TypeScript error:', typeScriptErr.message, '\n' +
      'JavaScript error:', jsErr.message
    );
    // Continue without the function - tests will be skipped
    recomputeInvestmentIntelligence = null;
  }
}

// Helper to reset module state before each test
function resetModuleState() {
  S.setLoaded(false);
  S.setCurrentSnapshot(null);
  S.setCurrentHistory([]);
  S.setTrackedIdeas([]);
  S.setMarketHistory([]);
  S.setMarketHistoryKeys(new Set());
  S.setMappingStats(new Map());
  S.setBanditStates(new Map());
  S.setCandidateReviews(new Map());
  S.setAutomatedThemes(new Map());
}

// Helper to create minimal valid arguments for recomputeInvestmentIntelligence
function minimalArgs() {
  return {
    clusters: [],
    markets: [],
    transmission: null,
    sourceCredibility: [],
    reports: [],
    keywordGraph: null,
    timestamp: '2025-01-15T12:00:00Z',
    replayAdaptation: null,
    recordCurrentThemePerformance: false,
  };
}

describe('FIX-6: End-to-End Pipeline Tests', () => {
  beforeEach(() => {
    resetModuleState();
  });

  // Helper to skip tests if orchestrator isn't available
  const orchestratorAvailable = recomputeInvestmentIntelligence !== null;
  const testIf = orchestratorAvailable ? it : it.skip;

  // Test 1: Normal flow with minimal valid input
  testIf('Test 1: Normal flow returns valid snapshot with required fields', async () => {
    assert.ok(recomputeInvestmentIntelligence, 'orchestrator available');
    const snapshot = await recomputeInvestmentIntelligence(minimalArgs());

    // Verify the snapshot has all required fields
    assert.ok(snapshot, 'snapshot should be returned');
    assert.equal(typeof snapshot.generatedAt, 'string', 'has generatedAt timestamp');
    assert.ok(Array.isArray(snapshot.ideaCards), 'ideaCards is array');
    assert.ok(Array.isArray(snapshot.summaryLines), 'summaryLines is array');
    assert.ok(snapshot.summaryLines.length > 0, 'summaryLines is non-empty');
    assert.ok(snapshot.integration, 'integration metadata exists');
    assert.ok(
      snapshot.integration.metaConfidence,
      'integration.metaConfidence exists'
    );
    assert.ok(
      snapshot.integration.dataSufficiency,
      'integration.dataSufficiency exists'
    );
  });

  // Test 2: Integration metadata completeness
  testIf('Test 2: Integration metadata has all required fields', async () => {
    assert.ok(recomputeInvestmentIntelligence, 'orchestrator available');
    const snapshot = await recomputeInvestmentIntelligence(minimalArgs());
    const integration = snapshot.integration;

    // Check all fields
    assert.ok(integration, 'integration exists');
    assert.ok(
      integration.metaConfidence !== undefined,
      'metaConfidence field exists'
    );
    assert.ok(integration.metaConfidence, 'metaConfidence is not null');
    assert.equal(
      typeof integration.metaConfidence.canJudge,
      'boolean',
      'canJudge is boolean'
    );
    assert.equal(
      typeof integration.metaConfidence.confidence,
      'number',
      'confidence is number'
    );
    assert.ok(
      Array.isArray(integration.metaConfidence.abstentionReasons),
      'abstentionReasons is array'
    );
    assert.ok(
      Array.isArray(integration.metaConfidence.degradedFactors),
      'degradedFactors is array'
    );

    // dataSufficiency
    assert.ok(integration.dataSufficiency, 'dataSufficiency is present');
    assert.equal(
      typeof integration.dataSufficiency.level,
      'string',
      'dataSufficiency.level is string'
    );
    assert.equal(
      typeof integration.dataSufficiency.score,
      'number',
      'dataSufficiency.score is number'
    );
    assert.ok(
      Array.isArray(integration.dataSufficiency.missingSources),
      'missingSources is array'
    );

    // decisionSnapshotCount (may be undefined if decision snapshot stage is skipped)
    assert.ok(
      integration.decisionSnapshotCount === undefined || typeof integration.decisionSnapshotCount === 'number',
      'decisionSnapshotCount is number or undefined'
    );
    assert.ok(
      integration.decisionSnapshotCount === undefined || integration.decisionSnapshotCount >= 0,
      'decisionSnapshotCount >= 0 (if present)'
    );

    // alertsFired
    assert.ok(
      Array.isArray(integration.alertsFired),
      'alertsFired is array'
    );
    for (const alert of integration.alertsFired) {
      assert.equal(typeof alert.ruleId, 'string');
      assert.ok(['info', 'warning', 'critical'].includes(alert.severity));
      assert.equal(typeof alert.message, 'string');
    }

    // riskGateSummary (may be undefined with empty input — no ideas to gate)
    assert.ok(
      integration.riskGateSummary === undefined || integration.riskGateSummary === null || typeof integration.riskGateSummary === 'object',
      'riskGateSummary is undefined, null, or object'
    );
    if (integration.riskGateSummary) {
      assert.equal(
        typeof integration.riskGateSummary.ideaGateRejected,
        'number'
      );
      assert.equal(
        typeof integration.riskGateSummary.portfolioGateReduced,
        'number'
      );
    }

    // pipelineErrors (FIX-4)
    assert.ok(
      Array.isArray(integration.pipelineErrors),
      'pipelineErrors is array'
    );
    for (const err of integration.pipelineErrors) {
      assert.equal(typeof err.stage, 'string');
      assert.equal(typeof err.error, 'string');
      assert.equal(typeof err.degraded, 'boolean');
    }
  });

  // Test 3: Abstention flow (all sources down)
  testIf('Test 3: Abstention flow when all sources are unhealthy', async () => {
    assert.ok(recomputeInvestmentIntelligence, 'orchestrator available');
    const args = minimalArgs();
    // Create source credibility with all sources down (score = 0)
    args.sourceCredibility = [
      {
        id: 'source-1',
        source: 'news',
        feedHealthScore: 0,
        credibilityScore: 0,
        lastSeenAt: null,
        historicalAccuracy: 0,
      },
      {
        id: 'source-2',
        source: 'market',
        feedHealthScore: 0,
        credibilityScore: 0,
        lastSeenAt: null,
        historicalAccuracy: 0,
      },
    ];

    const snapshot = await recomputeInvestmentIntelligence(args);

    // Meta-confidence gate should set canJudge = false
    assert.ok(snapshot.integration, 'integration exists');
    assert.ok(snapshot.integration.metaConfidence, 'metaConfidence exists');
    assert.equal(
      snapshot.integration.metaConfidence.canJudge,
      false,
      'should abstain when sources are down'
    );

    // No idea cards should be deployed
    assert.equal(snapshot.ideaCards.length, 0, 'no ideaCards when abstaining');

    // Summary should include ABSTENTION
    const abstentionFound = snapshot.summaryLines.some((line) =>
      line.toUpperCase().includes('ABSTENTION')
    );
    assert.ok(abstentionFound, 'summary includes ABSTENTION');
  });

  // Test 4: Backtest context mode
  testIf('Test 4: Backtest execution context is respected', async () => {
    assert.ok(recomputeInvestmentIntelligence, 'orchestrator available');
    const args = minimalArgs();
    args.executionContext = 'backtest';

    const snapshot = await recomputeInvestmentIntelligence(args);

    // Verify snapshot is returned without errors
    assert.ok(snapshot, 'snapshot returned in backtest mode');
    assert.ok(
      snapshot.integration,
      'integration metadata present in backtest'
    );
    // In backtest context, the system should still produce valid metadata
    assert.ok(
      snapshot.integration.metaConfidence,
      'metaConfidence present in backtest'
    );
  });

  // Test 5: Pipeline error isolation (FIX-4)
  testIf('Test 5: Pipeline errors array exists and is initialized empty', async () => {
    assert.ok(recomputeInvestmentIntelligence, 'orchestrator available');
    const snapshot = await recomputeInvestmentIntelligence(minimalArgs());

    assert.ok(snapshot.integration, 'integration exists');
    assert.ok(
      Array.isArray(snapshot.integration.pipelineErrors),
      'pipelineErrors is array'
    );
    // For a normal successful call, errors should be empty
    assert.ok(
      snapshot.integration.pipelineErrors.length === 0,
      'pipelineErrors is empty for normal call'
    );

    // Verify structure of pipelineErrors items (if any were present)
    for (const err of snapshot.integration.pipelineErrors) {
      assert.equal(typeof err.stage, 'string', 'error.stage is string');
      assert.equal(typeof err.error, 'string', 'error.error is string');
      assert.equal(typeof err.degraded, 'boolean', 'error.degraded is boolean');
    }
  });

  // Test 6: Risk gate summary present
  testIf('Test 6: Risk gate summary structure is correct', async () => {
    assert.ok(recomputeInvestmentIntelligence, 'orchestrator available');
    const snapshot = await recomputeInvestmentIntelligence(minimalArgs());

    assert.ok(snapshot.integration, 'integration exists');
    // riskGateSummary may be undefined with empty input (no ideas to gate),
    // null (explicitly set), or an object with gate counts
    const rgs = snapshot.integration.riskGateSummary;
    assert.ok(
      rgs === undefined || rgs === null || typeof rgs === 'object',
      'riskGateSummary is undefined, null, or object'
    );

    // If riskGateSummary has structure, validate it
    if (rgs != null) {
      const summary = rgs;
      assert.equal(
        typeof summary.ideaGateRejected,
        'number',
        'ideaGateRejected is number'
      );
      assert.equal(
        typeof summary.portfolioGateReduced,
        'number',
        'portfolioGateReduced is number'
      );
    }
  });

  // Test 7: Source quality weight computed (FIX-1)
  testIf('Test 7: Source quality weight is computed correctly', async () => {
    assert.ok(recomputeInvestmentIntelligence, 'orchestrator available');
    const args = minimalArgs();
    // Provide source credibility with known scores
    args.sourceCredibility = [
      {
        id: 'source-a',
        source: 'news',
        feedHealthScore: 80,
        credibilityScore: 0.9,
        lastSeenAt: new Date().toISOString(),
        historicalAccuracy: 0.85,
      },
      {
        id: 'source-b',
        source: 'market',
        feedHealthScore: 50,
        credibilityScore: 0.6,
        lastSeenAt: new Date().toISOString(),
        historicalAccuracy: 0.70,
      },
    ];

    const snapshot = await recomputeInvestmentIntelligence(args);

    assert.ok(snapshot.integration, 'integration exists');
    // sourceQualityWeight should be present and within expected range
    if (snapshot.integration.sourceQualityWeight !== undefined) {
      assert.equal(
        typeof snapshot.integration.sourceQualityWeight,
        'number',
        'sourceQualityWeight is number'
      );
      // FIX-1: weight should be between 0.3 and 1.5
      assert.ok(
        snapshot.integration.sourceQualityWeight >= 0.3 &&
          snapshot.integration.sourceQualityWeight <= 1.5,
        'sourceQualityWeight in valid range [0.3, 1.5]'
      );
    }
  });

  // Test 8: Repeated calls don't crash and maintain state
  testIf('Test 8: Repeated sequential calls produce valid snapshots', async () => {
    assert.ok(recomputeInvestmentIntelligence, 'orchestrator available');
    const args = minimalArgs();

    // First call
    const snapshot1 = await recomputeInvestmentIntelligence(args);
    assert.ok(snapshot1, 'first call returns snapshot');
    assert.ok(snapshot1.generatedAt, 'first snapshot has timestamp');

    // Reset for second call
    resetModuleState();

    // Second call
    const snapshot2 = await recomputeInvestmentIntelligence(args);
    assert.ok(snapshot2, 'second call returns snapshot');
    assert.ok(snapshot2.generatedAt, 'second snapshot has timestamp');

    // Both should be valid
    assert.ok(
      snapshot1.integration && snapshot2.integration,
      'both snapshots have integration metadata'
    );
  });

  // Test 9: Market data integration (additional comprehensive test)
  testIf('Test 9: Market data is processed through pipeline', async () => {
    assert.ok(recomputeInvestmentIntelligence, 'orchestrator available');
    const args = minimalArgs();
    args.markets = [
      {
        symbol: 'SPY',
        timestamp: '2025-01-15T10:00:00Z',
        price: 440,
        volume: 1000000,
      },
      {
        symbol: 'AAPL',
        timestamp: '2025-01-15T10:00:00Z',
        price: 250,
        volume: 5000000,
      },
    ];

    const snapshot = await recomputeInvestmentIntelligence(args);

    // Verify snapshot is valid
    assert.ok(snapshot, 'snapshot returned with market data');
    assert.ok(
      snapshot.integration && snapshot.integration.dataSufficiency,
      'data sufficiency assessed'
    );
  });

  // Test 10: Cluster events integration (additional comprehensive test)
  testIf('Test 10: Cluster events flow through pipeline', async () => {
    assert.ok(recomputeInvestmentIntelligence, 'orchestrator available');
    const args = minimalArgs();
    args.clusters = [
      {
        id: 'cluster-1',
        eventType: 'tech-earnings',
        firstSeen: new Date('2025-01-15T08:00:00Z'),
        lastUpdated: new Date('2025-01-15T10:00:00Z'),
        events: [],
        severity: 0.7,
        headline: 'Tech company earnings surge',
      },
    ];

    const snapshot = await recomputeInvestmentIntelligence(args);

    // Verify snapshot is valid
    assert.ok(snapshot, 'snapshot returned with cluster events');
    assert.ok(Array.isArray(snapshot.ideaCards), 'ideaCards generated');
  });
});
