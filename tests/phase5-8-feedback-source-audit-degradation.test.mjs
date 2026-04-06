/**
 * Phase 5-8 Tests
 * Phase 5: Feedback Delay Compensator
 * Phase 6: Source Profiles
 * Phase 7: Decision Snapshots & Audit
 * Phase 8: Data Sufficiency & Graceful Degradation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ===========================================================================
// Phase 5: Feedback Delay Compensator
// ===========================================================================
describe('Phase 5: FeedbackDelayCompensator', () => {
  it('computeRegimeAwareLearningRate: same regime = full rate', async () => {
    const { computeRegimeAwareLearningRate } = await import('../src/services/investment/feedback-delay-compensator.ts');
    const lr = computeRegimeAwareLearningRate({
      baseLearningRate: 0.08,
      currentRegime: 'risk-on',
      regimeAtGeneration: 'risk-on',
      holdingDurationHours: 0,
    });
    assert.ok(Math.abs(lr - 0.08) < 0.001, `Expected ~0.08, got ${lr}`);
  });

  it('computeRegimeAwareLearningRate: different regime = 50% discount', async () => {
    const { computeRegimeAwareLearningRate } = await import('../src/services/investment/feedback-delay-compensator.ts');
    const lr = computeRegimeAwareLearningRate({
      baseLearningRate: 0.08,
      currentRegime: 'risk-off',
      regimeAtGeneration: 'risk-on',
      holdingDurationHours: 0,
    });
    assert.ok(Math.abs(lr - 0.04) < 0.001, `Expected ~0.04, got ${lr}`);
  });

  it('computeRegimeAwareLearningRate: holding duration decays rate', async () => {
    const { computeRegimeAwareLearningRate } = await import('../src/services/investment/feedback-delay-compensator.ts');
    const fresh = computeRegimeAwareLearningRate({
      baseLearningRate: 0.08, currentRegime: 'risk-on', regimeAtGeneration: 'risk-on', holdingDurationHours: 0,
    });
    const old = computeRegimeAwareLearningRate({
      baseLearningRate: 0.08, currentRegime: 'risk-on', regimeAtGeneration: 'risk-on', holdingDurationHours: 72,
    });
    assert.ok(old < fresh, `Old (${old}) should be less than fresh (${fresh})`);
    assert.ok(old > 0, `Old rate should still be positive`);
  });

  it('buildConvictionUpdateEvent captures all metadata', async () => {
    const { buildConvictionUpdateEvent } = await import('../src/services/investment/feedback-delay-compensator.ts');
    const event = buildConvictionUpdateEvent({
      ideaRunId: 'idea-123',
      realizedReturnPct: 5.2,
      regimeAtGeneration: 'risk-on',
      regimeAtClose: 'risk-off',
      currentRegime: 'risk-off',
      convictionAtGeneration: 75,
      holdingDurationHours: 48,
      featureSnapshot: { corroboration: 0.8 },
      weightsBefore: { corroboration: 0.25 },
      weightsAfter: { corroboration: 0.27 },
    });
    assert.equal(event.ideaRunId, 'idea-123');
    assert.equal(event.regimeAtGeneration, 'risk-on');
    assert.equal(event.regimeAtUpdate, 'risk-off');
    assert.equal(event.holdingDurationHours, 48);
    assert.ok(event.timestamp);
  });

  it('FeedbackDelayCompensator tracks pending ideas', async () => {
    const { FeedbackDelayCompensator } = await import('../src/services/investment/feedback-delay-compensator.ts');
    const comp = new FeedbackDelayCompensator();
    comp.registerPendingIdea({ ideaId: 'a', generatedAt: new Date().toISOString(), regimeAtGeneration: 'risk-on', convictionAtGeneration: 70 });
    comp.registerPendingIdea({ ideaId: 'b', generatedAt: new Date().toISOString(), regimeAtGeneration: 'risk-on', convictionAtGeneration: 65 });
    assert.equal(comp.pendingCount, 2);
    const closed = comp.closePendingIdea('a');
    assert.equal(closed.ideaId, 'a');
    assert.equal(comp.pendingCount, 1);
  });

  it('estimateModelStaleness returns valid report', async () => {
    const { FeedbackDelayCompensator } = await import('../src/services/investment/feedback-delay-compensator.ts');
    const comp = new FeedbackDelayCompensator();
    const report = comp.estimateModelStaleness();
    assert.ok(report.stalenessScore >= 0 && report.stalenessScore <= 1);
    assert.ok(report.confidenceMultiplier >= 0.2 && report.confidenceMultiplier <= 1);
    assert.ok(report.explanation.length > 0);
  });

  it('adjustConfidenceForStaleness reduces confidence when stale', async () => {
    const { FeedbackDelayCompensator } = await import('../src/services/investment/feedback-delay-compensator.ts');
    const comp = new FeedbackDelayCompensator();
    // No updates recorded = very stale
    const adjusted = comp.adjustConfidenceForStaleness(80);
    assert.ok(adjusted <= 80, `Adjusted ${adjusted} should be <= 80`);
  });

  it('regime changes increase staleness', async () => {
    const { FeedbackDelayCompensator } = await import('../src/services/investment/feedback-delay-compensator.ts');
    const comp = new FeedbackDelayCompensator();
    // Record update 1 second in the past so regime changes are after it
    const pastTs = new Date(Date.now() - 1000).toISOString();
    comp.recordUpdate({ timestamp: pastTs, ideaRunId: 'x', realizedReturnPct: 2, regimeAtGeneration: 'a', regimeAtClose: 'a', regimeAtUpdate: 'a', convictionAtGeneration: 70, holdingDurationHours: 24, featureSnapshot: {}, weightsBefore: {}, weightsAfter: {} });
    comp.recordRegimeChange('regime-b');
    comp.recordRegimeChange('regime-c');
    comp.recordRegimeChange('regime-d');
    const after = comp.estimateModelStaleness();
    assert.ok(after.regimeChangesSinceUpdate >= 3, `Expected >= 3 regime changes, got ${after.regimeChangesSinceUpdate}`);
  });

  it('bandit key partitioning works', async () => {
    const { FeedbackDelayCompensator } = await import('../src/services/investment/feedback-delay-compensator.ts');
    const key = FeedbackDelayCompensator.buildBanditKey('arm-1', 'risk-on');
    assert.equal(key, 'arm-1::risk-on');
    const parsed = FeedbackDelayCompensator.parseBanditKey(key);
    assert.equal(parsed.armId, 'arm-1');
    assert.equal(parsed.regime, 'risk-on');
    // Global fallback
    const globalKey = FeedbackDelayCompensator.buildBanditKey('arm-1', null);
    assert.equal(globalKey, 'arm-1');
  });
});

// ===========================================================================
// Phase 6: Source Profiles
// ===========================================================================
describe('Phase 6: Source Profiles', () => {
  it('SOURCE_PROFILES contains 24 providers', async () => {
    const { SOURCE_PROFILES } = await import('../src/services/source-profile.ts');
    assert.ok(SOURCE_PROFILES.size >= 24, `Expected >= 24 profiles, got ${SOURCE_PROFILES.size}`);
  });

  it('getSourceProfile returns known profile', async () => {
    const { getSourceProfile } = await import('../src/services/source-profile.ts');
    const gdelt = getSourceProfile('gdelt');
    assert.equal(gdelt.id, 'gdelt');
    assert.equal(gdelt.kind, 'meta-aggregator');
    assert.ok(gdelt.accuracy.baseReliability > 0.5);
  });

  it('getSourceProfile returns default for unknown', async () => {
    const { getSourceProfile } = await import('../src/services/source-profile.ts');
    const unknown = getSourceProfile('totally-unknown-source');
    assert.equal(unknown.accuracy.baseReliability, 0.50);
    assert.equal(unknown.accuracy.verificationLevel, 'none');
  });

  it('computeFreshnessScore: sensor decays fast', async () => {
    const { getSourceProfile, computeFreshnessScore } = await import('../src/services/source-profile.ts');
    const opensky = getSourceProfile('opensky');
    const fresh = computeFreshnessScore(opensky, 0);
    const aged = computeFreshnessScore(opensky, 3);
    assert.ok(fresh > 0.9, `Fresh sensor should be > 0.9, got ${fresh}`);
    assert.ok(aged < 0.3, `3h old sensor should be < 0.3, got ${aged}`);
  });

  it('computeFreshnessScore: research decays slow', async () => {
    const { getSourceProfile, computeFreshnessScore } = await import('../src/services/source-profile.ts');
    const acled = getSourceProfile('acled');
    const aged = computeFreshnessScore(acled, 48); // 2 days old
    assert.ok(aged > 0.7, `2-day-old research should be > 0.7, got ${aged}`);
  });

  it('computeQualityWeight combines reliability and freshness', async () => {
    const { getSourceProfile, computeQualityWeight } = await import('../src/services/source-profile.ts');
    const reuters = getSourceProfile('reuters');
    const weight = computeQualityWeight(reuters, 1);
    assert.ok(weight > 0, 'Quality weight should be positive');
    assert.ok(weight <= 1, 'Quality weight should be <= 1');
  });

  it('evaluateCrossValidation: sensor + research = max confidence boost', async () => {
    const { evaluateCrossValidation } = await import('../src/services/source-profile.ts');
    const result = evaluateCrossValidation(['sensor', 'research', 'news']);
    assert.equal(result.sensorConfirmed, true);
    assert.equal(result.researchConfirmed, true);
    assert.equal(result.confidenceAdjustment, 15);
  });

  it('evaluateCrossValidation: single source = penalty', async () => {
    const { evaluateCrossValidation } = await import('../src/services/source-profile.ts');
    const result = evaluateCrossValidation(['news']);
    assert.equal(result.confidenceAdjustment, -5);
  });

  it('evaluateCrossValidation: conflicting signals = penalty', async () => {
    const { evaluateCrossValidation } = await import('../src/services/source-profile.ts');
    const result = evaluateCrossValidation(['sensor', 'news'], true);
    assert.ok(result.conflictingSignals.length > 0);
    assert.ok(result.confidenceAdjustment < 10); // sensor +10 but conflict -10
  });

  it('computeSourceQualityConvictionAdjustment works', async () => {
    const { getSourceProfile, computeSourceQualityConvictionAdjustment } = await import('../src/services/source-profile.ts');
    const highQ = computeSourceQualityConvictionAdjustment([getSourceProfile('acled'), getSourceProfile('reuters')]);
    const lowQ = computeSourceQualityConvictionAdjustment([getSourceProfile('telegram-osint')]);
    assert.ok(highQ > lowQ, `High quality (${highQ}) should > low quality (${lowQ})`);
  });
});

// ===========================================================================
// Phase 7: Decision Snapshots & Audit
// ===========================================================================
describe('Phase 7: Decision Snapshots', () => {
  it('generateSnapshotId produces unique IDs', async () => {
    const { generateSnapshotId } = await import('../src/services/audit/decision-snapshot.ts');
    const id1 = generateSnapshotId();
    const id2 = generateSnapshotId();
    assert.notEqual(id1, id2);
    assert.ok(id1.startsWith('snap-'));
  });

  it('buildDecisionSnapshot creates complete snapshot', async () => {
    const { buildDecisionSnapshot } = await import('../src/services/audit/decision-snapshot.ts');
    const snap = buildDecisionSnapshot({
      ideaId: 'idea-1',
      themeId: 'energy',
      context: {
        regime: { id: 'risk-on', label: 'Risk On', confidence: 0.85 },
        convictionFeatures: { corroboration: 0.8 },
        convictionWeights: { corroboration: 0.25 },
        convictionBias: 0.1,
        modelObservations: 50,
        banditScore: 0.72,
        macroOverlayState: 'normal',
        sourceProfileIds: ['gdelt', 'reuters'],
        riskAssessment: null,
      },
      decisions: {
        rawConviction: 72,
        blendedConviction: 68,
        autonomyAction: 'deploy',
        finalSizePct: 5,
        vetoReasons: [],
        attribution: [{ key: 'corroboration', label: 'Corroboration', contribution: 22, explanation: 'Strong multi-source support' }],
      },
      reproducibility: { stateStoreVersion: 42, configHash: 'abc123', executionMode: 'live' },
    });
    assert.ok(snap.snapshotId.startsWith('snap-'));
    assert.equal(snap.ideaId, 'idea-1');
    assert.equal(snap.decisions.blendedConviction, 68);
  });

  it('validateSnapshot catches missing fields', async () => {
    const { validateSnapshot } = await import('../src/services/audit/decision-snapshot.ts');
    const errors = validateSnapshot({ snapshotId: '', timestamp: '', ideaId: '', themeId: '', context: null, decisions: null, reproducibility: null });
    assert.ok(errors.length >= 3);
  });

  it('summarizeSnapshot produces readable string', async () => {
    const { buildDecisionSnapshot, summarizeSnapshot } = await import('../src/services/audit/decision-snapshot.ts');
    const snap = buildDecisionSnapshot({
      ideaId: 'idea-2', themeId: 'defense',
      context: { regime: null, convictionFeatures: {}, convictionWeights: {}, convictionBias: 0, modelObservations: 10, banditScore: null, macroOverlayState: null, sourceProfileIds: [], riskAssessment: null },
      decisions: { rawConviction: 80, blendedConviction: 75, autonomyAction: 'shadow', finalSizePct: 3, vetoReasons: [], attribution: [] },
      reproducibility: { stateStoreVersion: 1, configHash: 'x', executionMode: 'live' },
    });
    const summary = summarizeSnapshot(snap);
    assert.ok(summary.includes('idea-2'));
    assert.ok(summary.includes('shadow'));
    assert.ok(summary.includes('75'));
  });
});

describe('Phase 7: Snapshot Store', () => {
  it('saves and retrieves by ideaId', async () => {
    const { SnapshotStore } = await import('../src/services/audit/snapshot-store.ts');
    const { buildDecisionSnapshot } = await import('../src/services/audit/decision-snapshot.ts');
    const store = new SnapshotStore();

    const snap = buildDecisionSnapshot({
      ideaId: 'idea-A', themeId: 'energy',
      context: { regime: null, convictionFeatures: {}, convictionWeights: {}, convictionBias: 0, modelObservations: 0, banditScore: null, macroOverlayState: null, sourceProfileIds: [], riskAssessment: null },
      decisions: { rawConviction: 70, blendedConviction: 65, autonomyAction: 'deploy', finalSizePct: 5, vetoReasons: [], attribution: [] },
      reproducibility: { stateStoreVersion: 1, configHash: 'x', executionMode: 'live' },
    });
    store.save(snap);
    assert.equal(store.count, 1);
    const results = store.getByIdeaId('idea-A');
    assert.equal(results.length, 1);
    assert.equal(results[0].ideaId, 'idea-A');
  });

  it('queries by time range', async () => {
    const { SnapshotStore } = await import('../src/services/audit/snapshot-store.ts');
    const store = new SnapshotStore();

    for (let i = 0; i < 5; i++) {
      store.save({
        snapshotId: `s-${i}`, timestamp: new Date(2025, 5, i + 1).toISOString(),
        ideaId: `idea-${i}`, themeId: 'energy',
        context: { regime: null, convictionFeatures: {}, convictionWeights: { a: 0.1 + i * 0.01 }, convictionBias: 0, modelObservations: i, banditScore: null, macroOverlayState: null, sourceProfileIds: [], riskAssessment: null },
        decisions: { rawConviction: 60 + i, blendedConviction: 58 + i, autonomyAction: 'deploy', finalSizePct: 5, vetoReasons: [], attribution: [] },
        reproducibility: { stateStoreVersion: 1, configHash: 'x', executionMode: 'live' },
      });
    }

    const range = store.getByTimeRange(new Date(2025, 5, 2).toISOString(), new Date(2025, 5, 4).toISOString());
    assert.equal(range.length, 3); // June 2, 3, 4
  });

  it('buildAuditReport generates meaningful report', async () => {
    const { SnapshotStore } = await import('../src/services/audit/snapshot-store.ts');
    const store = new SnapshotStore();

    for (let i = 0; i < 10; i++) {
      store.save({
        snapshotId: `s-${i}`, timestamp: new Date(2025, 5, 10).toISOString(),
        ideaId: `idea-${i}`, themeId: i < 7 ? 'energy' : 'defense',
        context: { regime: null, convictionFeatures: {}, convictionWeights: { a: 0.2 }, convictionBias: 0, modelObservations: 10, banditScore: null, macroOverlayState: null, sourceProfileIds: [], riskAssessment: null },
        decisions: { rawConviction: 50 + i * 5, blendedConviction: 48 + i * 5, autonomyAction: i < 8 ? 'deploy' : 'shadow', finalSizePct: 5, vetoReasons: i === 9 ? ['low liquidity'] : [], attribution: [] },
        reproducibility: { stateStoreVersion: 1, configHash: 'x', executionMode: 'live' },
      });
    }

    const report = store.buildAuditReport(new Date(2025, 5, 1).toISOString(), new Date(2025, 5, 30).toISOString());
    assert.equal(report.totalDecisions, 10);
    assert.ok(report.decisionsByAction['deploy'] >= 8);
    assert.ok(report.convictionDistribution.mean > 0);
    assert.ok(report.topThemes.length >= 1);
    assert.equal(report.topThemes[0].themeId, 'energy');
  });
});

// ===========================================================================
// Phase 8: Data Sufficiency & Graceful Degradation
// ===========================================================================
describe('Phase 8: Data Sufficiency Assessment', () => {
  const mkSource = (id, kind, available = true, stale = 0) => ({
    id, kind, available, lastSeenAt: new Date().toISOString(), staleMinutes: stale, errorMessage: null,
  });

  it('full: all source kinds present', async () => {
    const { assessDataSufficiency } = await import('../src/services/data-sufficiency.ts');
    const sources = [
      mkSource('gdelt', 'news'), mkSource('rss', 'news'), mkSource('reuters', 'news'),
      mkSource('opensky', 'sensor'), mkSource('ais', 'sensor'),
      mkSource('yahoo', 'market-data'),
    ];
    const result = assessDataSufficiency(sources);
    assert.equal(result.level, 'full');
    assert.equal(result.confidenceMultiplier, 1.0);
    assert.equal(result.alertLevel, 'none');
  });

  it('degraded: no sensors', async () => {
    const { assessDataSufficiency } = await import('../src/services/data-sufficiency.ts');
    const sources = [
      mkSource('gdelt', 'news'), mkSource('rss', 'news'), mkSource('reuters', 'news'),
      mkSource('yahoo', 'market-data'),
    ];
    const result = assessDataSufficiency(sources);
    assert.equal(result.level, 'degraded');
    assert.ok(result.confidenceMultiplier < 1.0);
    assert.ok(result.coverageGaps.some(g => g.kind === 'sensor'));
  });

  it('minimal: only news', async () => {
    const { assessDataSufficiency } = await import('../src/services/data-sufficiency.ts');
    const sources = [
      mkSource('rss', 'news'),
      mkSource('opensky', 'sensor', false),
      mkSource('yahoo', 'market-data', false),
    ];
    const result = assessDataSufficiency(sources);
    assert.equal(result.level, 'minimal');
    assert.equal(result.confidenceMultiplier, 0.3);
  });

  it('insufficient: nothing available', async () => {
    const { assessDataSufficiency } = await import('../src/services/data-sufficiency.ts');
    const sources = [
      mkSource('gdelt', 'news', false),
      mkSource('opensky', 'sensor', false),
      mkSource('yahoo', 'market-data', false),
    ];
    const result = assessDataSufficiency(sources);
    assert.equal(result.level, 'insufficient');
    assert.equal(result.confidenceMultiplier, 0);
    assert.equal(result.alertLevel, 'critical');
  });

  it('stale sources treated as unavailable', async () => {
    const { assessDataSufficiency } = await import('../src/services/data-sufficiency.ts');
    const sources = [
      mkSource('gdelt', 'news', true, 400), // 6h+ stale
      mkSource('rss', 'news'),
      mkSource('opensky', 'sensor', true, 500),
      mkSource('yahoo', 'market-data', true, 500),
    ];
    const result = assessDataSufficiency(sources);
    assert.equal(result.level, 'minimal');
    assert.ok(result.missingSources.includes('gdelt'));
  });
});

describe('Phase 8: Degradation Policies', () => {
  it('getDegradationPolicy returns correct policy for regime', async () => {
    const { getDegradationPolicy } = await import('../src/services/data-sufficiency.ts');
    const policy = getDegradationPolicy('degraded', 'risk-off');
    assert.equal(policy.maxAction, 'shadow');
    assert.equal(policy.sizeMultiplier, 0.3);
    assert.equal(policy.requireCrossValidation, true);
  });

  it('getDegradationPolicy falls back to default for unknown regime', async () => {
    const { getDegradationPolicy } = await import('../src/services/data-sufficiency.ts');
    const policy = getDegradationPolicy('degraded', 'unknown-regime');
    assert.equal(policy.maxAction, 'deploy');
    assert.equal(policy.sizeMultiplier, 0.5);
  });

  it('insufficient always returns abstain', async () => {
    const { getDegradationPolicy } = await import('../src/services/data-sufficiency.ts');
    const policy = getDegradationPolicy('insufficient', 'risk-on');
    assert.equal(policy.maxAction, 'abstain');
    assert.equal(policy.sizeMultiplier, 0);
  });

  it('isActionAllowed enforces policy hierarchy', async () => {
    const { getDegradationPolicy, isActionAllowed } = await import('../src/services/data-sufficiency.ts');
    const minimalPolicy = getDegradationPolicy('minimal', null);
    assert.equal(isActionAllowed('watch', minimalPolicy), true);
    assert.equal(isActionAllowed('deploy', minimalPolicy), false);
    assert.equal(isActionAllowed('shadow', minimalPolicy), false);
    assert.equal(isActionAllowed('abstain', minimalPolicy), true);
  });

  it('applyDegradationToSize reduces size correctly', async () => {
    const { getDegradationPolicy, applyDegradationToSize } = await import('../src/services/data-sufficiency.ts');
    const policy = getDegradationPolicy('degraded', 'risk-on');
    const result = applyDegradationToSize(10, 70, policy);
    assert.equal(result.adjustedSizePct, 5); // 10 * 0.5
    assert.ok(result.reason !== null);
  });

  it('applyDegradationToSize rejects below conviction floor', async () => {
    const { getDegradationPolicy, applyDegradationToSize } = await import('../src/services/data-sufficiency.ts');
    const policy = getDegradationPolicy('degraded', 'risk-on');
    const result = applyDegradationToSize(10, 40, policy);
    assert.equal(result.adjustedSizePct, 0);
    assert.ok(result.reason.includes('below floor'));
  });
});

describe('Phase 8: Failure Scenarios', () => {
  it('FAILURE_SCENARIOS has predefined scenarios', async () => {
    const { FAILURE_SCENARIOS } = await import('../src/services/data-sufficiency.ts');
    assert.ok(FAILURE_SCENARIOS.length >= 5);
    assert.ok(FAILURE_SCENARIOS.some(s => s.id === 'total-outage'));
  });

  it('simulateFailureScenario: total outage = insufficient', async () => {
    const { simulateFailureScenario, FAILURE_SCENARIOS } = await import('../src/services/data-sufficiency.ts');
    const mkSource = (id, kind) => ({ id, kind, available: true, lastSeenAt: new Date().toISOString(), staleMinutes: 0, errorMessage: null });
    const allSources = [
      mkSource('gdelt', 'news'), mkSource('gdelt-doc', 'news'), mkSource('rss', 'news'),
      mkSource('acled', 'research'), mkSource('opensky', 'sensor'), mkSource('ais', 'sensor'),
      mkSource('usgs', 'sensor'), mkSource('yahoo-chart', 'market-data'), mkSource('coingecko', 'market-data'),
      mkSource('fred', 'research'),
    ];
    const totalOutage = FAILURE_SCENARIOS.find(s => s.id === 'total-outage');
    const result = simulateFailureScenario(allSources, totalOutage);
    assert.equal(result.level, 'insufficient');
  });

  it('simulateFailureScenario: sensor loss = degraded', async () => {
    const { simulateFailureScenario, FAILURE_SCENARIOS } = await import('../src/services/data-sufficiency.ts');
    const mkSource = (id, kind) => ({ id, kind, available: true, lastSeenAt: new Date().toISOString(), staleMinutes: 0, errorMessage: null });
    const allSources = [
      mkSource('gdelt', 'news'), mkSource('rss', 'news'), mkSource('reuters', 'news'),
      mkSource('opensky', 'sensor'), mkSource('ais', 'sensor'), mkSource('usgs', 'sensor'),
      mkSource('glint', 'sensor'), mkSource('cyber-threats', 'sensor'),
      mkSource('yahoo-chart', 'market-data'), mkSource('coingecko', 'market-data'),
    ];
    const sensorLoss = FAILURE_SCENARIOS.find(s => s.id === 'sensor-loss');
    const result = simulateFailureScenario(allSources, sensorLoss);
    assert.equal(result.level, 'degraded');
  });
});

// ===========================================================================
// Structure Verification
// ===========================================================================
describe('Phase 5-8 structure verification', () => {
  it('feedback-delay-compensator.ts exists and has key exports', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync('./src/services/investment/feedback-delay-compensator.ts', 'utf-8');
    assert.ok(content.includes('FeedbackDelayCompensator'));
    assert.ok(content.includes('computeRegimeAwareLearningRate'));
    assert.ok(content.includes('ConvictionUpdateEvent'));
  });

  it('source-profile.ts exists with 24 providers', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync('./src/services/source-profile.ts', 'utf-8');
    assert.ok(content.includes('SOURCE_PROFILES'));
    assert.ok(content.includes('evaluateCrossValidation'));
    const providerCount = (content.match(/\['/g) || []).length;
    assert.ok(providerCount >= 24, `Expected >= 24 providers, found ~${providerCount}`);
  });

  it('audit modules exist', async () => {
    const fs = await import('node:fs');
    const snap = fs.readFileSync('./src/services/audit/decision-snapshot.ts', 'utf-8');
    const store = fs.readFileSync('./src/services/audit/snapshot-store.ts', 'utf-8');
    assert.ok(snap.includes('DecisionSnapshot'));
    assert.ok(store.includes('SnapshotStore'));
    assert.ok(store.includes('buildAuditReport'));
  });

  it('data-sufficiency.ts exists with degradation policies', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync('./src/services/data-sufficiency.ts', 'utf-8');
    assert.ok(content.includes('assessDataSufficiency'));
    assert.ok(content.includes('getDegradationPolicy'));
    assert.ok(content.includes('FAILURE_SCENARIOS'));
    assert.ok(content.includes('simulateFailureScenario'));
  });
});
