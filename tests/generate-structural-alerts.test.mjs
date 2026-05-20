import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStructuralAlertCandidates,
  parseArgs,
  runStructuralAlertGenerationJob,
} from '../scripts/generate-structural-alerts.mjs';

test('generate-structural-alerts parses CLI args', () => {
  const parsed = parseArgs(['--period', 'month', '--limit', '12', '--dry-run']);
  assert.equal(parsed.period, 'month');
  assert.equal(parsed.limit, 12);
  assert.equal(parsed.dryRun, true);
});

test('generate-structural-alerts emits lifecycle, share, evidence delta, and adjacent pathway alerts', () => {
  const alerts = buildStructuralAlertCandidates({
    snapshots: [
      {
        theme: 'quantum-computing',
        label: 'Quantum Computing',
        parentTheme: 'technology-general',
        category: 'technology',
        periodType: 'week',
        periodEnd: '2026-04-07',
        articleCount: 24,
        vsPreviousPct: 82,
        vsYearAgoPct: 140,
        acceleration: 28,
        lifecycleStage: 'emerging',
        prevLifecycleStage: 'nascent',
      },
    ],
    shareJumps: [
      {
        theme: 'quantum-computing',
        label: 'Quantum Computing',
        parentTheme: 'technology-general',
        parentLabel: 'Technology',
        category: 'technology',
        periodType: 'week',
        periodEnd: '2026-04-07',
        articleCount: 24,
        lastSharePct: 14,
        deltaSharePct: 6,
      },
    ],
    evidenceDeltas: [
      {
        theme: 'quantum-computing',
        label: 'Quantum Computing',
        parentTheme: 'technology-general',
        category: 'technology',
        periodType: 'week',
        currentEvidenceCount: 5,
        previousEvidenceCount: 1,
        deltaEvidenceCount: 4,
        deltaEvidencePct: 400,
        currentCitations: 21,
        previousCitations: 6,
        deltaCitations: 15,
        snapshotDate: '2026-04-07',
        evidenceClass: 'openalex_research',
        evidenceLabel: 'research evidence',
      },
    ],
    attachments: [
      {
        attachmentKey: 'technology-general::robotics-supply-chain',
        targetTheme: 'robotics-automation',
        label: 'Robotics Supply Chain Bottlenecks',
        confidence: 84,
        relationType: 'supplier',
        transmissionOrder: 'second-order',
        transmissionPath: 'Robot deployment ramps tighten servo, sensor, and precision actuator supply.',
        assets: [{ symbol: 'ROK' }, { symbol: 'AME' }],
        createdAt: '2026-04-07T00:00:00.000Z',
        status: 'executed',
        suggestedSources: ['sec.gov'],
      },
    ],
    limit: 10,
  });

  const alertTypes = alerts.map((item) => item.alertType);
  assert.ok(alertTypes.includes('lifecycle-transition'));
  assert.ok(alertTypes.includes('share-jump'));
  assert.ok(alertTypes.includes('evidence-delta'));
  assert.ok(alertTypes.includes('adjacent_pathway'));
});

test('generate-structural-alerts dampens near-zero baseline alerts across breakout and lifecycle paths', () => {
  const alerts = buildStructuralAlertCandidates({
    snapshots: [
      {
        theme: 'conflict',
        label: 'Conflict',
        parentTheme: 'geopolitics',
        category: 'geopolitics',
        periodType: 'quarter',
        periodEnd: '2026-04-11',
        articleCount: 19,
        vsPreviousPct: 19000,
        vsYearAgoPct: 1200,
        acceleration: 19099.4,
        lifecycleStage: 'growing',
        prevLifecycleStage: 'emerging',
      },
    ],
    shareJumps: [],
    evidenceDeltas: [],
    attachments: [],
    limit: 5,
  });

  const breakout = alerts.find((item) => item.alertType === 'acceleration-breakout');
  const lifecycle = alerts.find((item) => item.alertType === 'lifecycle-transition');

  assert.ok(breakout);
  assert.ok(lifecycle);
  assert.ok(breakout.alertScore <= 20);
  assert.ok(lifecycle.alertScore <= 55);
  assert.equal(breakout.severity, 'medium');
  assert.equal(lifecycle.severity, 'medium');
  assert.match(breakout.detail, /near-zero baseline/i);
  assert.match(lifecycle.detail, /near-zero baseline/i);
});

test('generate-structural-alerts suppresses low-count breakout alerts', () => {
  const alerts = buildStructuralAlertCandidates({
    snapshots: [
      {
        theme: 'space',
        label: 'Space Economy',
        parentTheme: 'technology-general',
        category: 'technology',
        periodType: 'week',
        periodEnd: '2026-04-07',
        articleCount: 3,
        vsPreviousPct: 100,
        vsYearAgoPct: 100,
        acceleration: 200,
        lifecycleStage: 'growing',
        prevLifecycleStage: 'growing',
        sourceDiversity: 0.9,
      },
    ],
    shareJumps: [],
    evidenceDeltas: [],
    attachments: [],
    limit: 5,
  });

  assert.equal(alerts.some((item) => item.alertType === 'acceleration-breakout'), false);
});

test('generate-structural-alerts suppresses low-count lifecycle alerts', () => {
  const alerts = buildStructuralAlertCandidates({
    snapshots: [
      {
        theme: 'migration',
        label: 'Migration',
        parentTheme: 'society-general',
        category: 'society',
        periodType: 'week',
        periodEnd: '2026-04-07',
        articleCount: 1,
        vsPreviousPct: 100,
        vsYearAgoPct: 100,
        acceleration: 200,
        lifecycleStage: 'growing',
        prevLifecycleStage: 'emerging',
        sourceDiversity: 0,
      },
    ],
    shareJumps: [],
    evidenceDeltas: [],
    attachments: [],
    limit: 5,
  });

  assert.equal(alerts.some((item) => item.alertType === 'lifecycle-transition'), false);
});

test('generate-structural-alerts suppresses low-count share-shift alerts', () => {
  const alerts = buildStructuralAlertCandidates({
    snapshots: [],
    shareJumps: [
      {
        theme: 'space',
        label: 'Space Economy',
        parentTheme: 'technology-general',
        parentLabel: 'Technology',
        category: 'technology',
        periodType: 'week',
        periodEnd: '2026-04-07',
        articleCount: 3,
        lastSharePct: 33.3,
        deltaSharePct: 25,
      },
    ],
    evidenceDeltas: [],
    attachments: [],
    limit: 5,
  });

  assert.equal(alerts.some((item) => item.alertType === 'share-jump'), false);
});

test('generate-structural-alerts suppresses low-count cooling alerts', () => {
  const alerts = buildStructuralAlertCandidates({
    snapshots: [
      {
        theme: 'quantum-computing',
        label: 'Quantum Computing',
        parentTheme: 'technology-general',
        category: 'technology',
        periodType: 'week',
        periodEnd: '2026-04-07',
        articleCount: 0,
        vsPreviousPct: -100,
        vsYearAgoPct: -100,
        acceleration: -400,
        lifecycleStage: 'cooling',
        prevLifecycleStage: 'growing',
        sourceDiversity: 0,
      },
    ],
    shareJumps: [],
    evidenceDeltas: [],
    attachments: [],
    limit: 5,
  });

  assert.equal(alerts.some((item) => item.alertType === 'cooling-reversal'), false);
});

test('generate-structural-alerts includes article count evidence on breakout alerts', () => {
  const alerts = buildStructuralAlertCandidates({
    snapshots: [
      {
        theme: 'cybersecurity',
        label: 'Cybersecurity',
        parentTheme: 'technology-general',
        category: 'technology',
        periodType: 'week',
        periodEnd: '2026-04-07',
        articleCount: 53,
        previousCount: 20,
        vsPreviousPct: 165,
        vsYearAgoPct: 120,
        acceleration: 185,
        lifecycleStage: 'growing',
        prevLifecycleStage: 'growing',
        sourceDiversity: 0.9,
      },
    ],
    shareJumps: [],
    evidenceDeltas: [],
    attachments: [],
    limit: 5,
  });

  const breakout = alerts.find((item) => item.alertType === 'acceleration-breakout');
  assert.ok(breakout);
  assert.equal(breakout.metadata.articleCount, 53);
  assert.equal(breakout.metadata.previousCount, 20);
});

test('generate-structural-alerts job persists alerts when not dry-run', async () => {
  const persisted = [];
  const summary = await runStructuralAlertGenerationJob({
    period: 'week',
    limit: 5,
    dryRun: false,
  }, {
    client: {
      query: async () => ({ rows: [] }),
    },
    loadSnapshots: async () => ([
      {
        theme: 'robotics-automation',
        label: 'Robotics Automation',
        parentTheme: 'technology-general',
        category: 'technology',
        periodType: 'week',
        periodEnd: '2026-04-07',
        articleCount: 18,
        vsPreviousPct: 51,
        vsYearAgoPct: 66,
        acceleration: 18,
        lifecycleStage: 'growing',
        prevLifecycleStage: 'emerging',
      },
    ]),
    loadShareJumps: async () => ([]),
    loadEvidenceDeltas: async () => ([]),
    loadAttachments: async () => ([
      {
        attachmentKey: 'robotics-automation::warehouse-automation-financing',
        targetTheme: 'robotics-automation',
        label: 'Warehouse Automation Financing',
        confidence: 78,
        relationType: 'financing',
        transmissionOrder: 'third-order',
        transmissionPath: 'Capex financing terms shape adoption for warehouse automation rollouts.',
        assets: [{ symbol: 'SYM1' }],
        createdAt: '2026-04-07T00:00:00.000Z',
        status: 'executed',
        suggestedSources: ['sec.gov'],
      },
    ]),
    upsertStructuralAlertsFn: async (_queryable, alerts) => {
      persisted.push(...alerts);
      return { ok: true, upserted: alerts.length };
    },
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.dryRun, false);
  assert.ok(summary.alertCount >= 1);
  assert.equal(summary.attachmentCount, 1);
  assert.equal(summary.upserted, persisted.length);
  assert.ok(persisted.some((item) => item.theme === 'robotics-automation'));
  assert.ok(persisted.some((item) => item.alertType === 'adjacent_pathway'));
});
