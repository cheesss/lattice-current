import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildEvidenceBackfillCyclePlan,
  extractEvidenceContractTasksFromArtifact,
  loadDbBackfillTasks,
  loadTasksFromDbIfNeeded,
  runEvidenceContractBackfillCycle,
  summarizeUnblockDelta,
} from '../scripts/run-evidence-contract-backfill-cycle.mjs';

test('evidence contract backfill cycle builds provider routes from report artifact in dry-run', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-evidence-cycle-'));
  try {
    const bundle = {
      reportId: 'RPT-test',
      reportType: 'theme_report',
      subject: {
        subjectId: 'ai-ml',
        subjectType: 'theme',
        displayName: 'AI / Machine Learning',
      },
      metadata: {
        deepResearchPack: {
          universalEvidenceContract: {
            ontologyKey: 'data_center_infrastructure',
          },
          evidenceClassMatrix: [
            {
              evidenceClass: 'capex_confirmation',
              label: 'Capex confirmation',
              status: 'missing',
              nextQuery: 'AI / Machine Learning capex capital expenditure buildout',
              providerRoute: 'filing_transcript_or_provider_fundamentals',
            },
            {
              evidenceClass: 'power_constraint',
              label: 'Power constraint',
              status: 'context',
              nextQuery: 'AI / Machine Learning power demand grid interconnection',
              providerRoute: 'industry_policy_or_utility_source',
            },
            {
              evidenceClass: 'issuer_commentary',
              label: 'Issuer commentary',
              status: 'direct',
              providerRoute: 'transcript_or_issuer_release',
            },
          ],
        },
      },
      symbols: ['MSFT', 'NVDA', 'SMH'],
    };
    await writeFile(path.join(dir, 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    await writeFile(path.join(dir, 'source-query-drafts.json'), '[]\n', 'utf8');

    const artifact = { reportDir: dir, bundle, drafts: [], manifest: null };
    const tasks = extractEvidenceContractTasksFromArtifact(artifact, { limit: 10 });
    const plan = await buildEvidenceBackfillCyclePlan({
      reportDir: dir,
      statePath: path.join(dir, 'state.json'),
      providers: ['sec', 'fmp', 'polygon', 'eia', 'dod-contracts', 'usaspending'],
      limit: 10,
    });

    assert.equal(tasks.length, 2);
    assert.equal(plan.dryRun, true);
    assert.equal(plan.routeCount, 2);
    assert.equal(plan.routes.some((row) => row.route.evidenceClass === 'capex_confirmation'), true);
    assert.equal(plan.routes.some((row) => row.route.evidenceClass === 'power_constraint'), true);
    assert.equal(plan.providers.includes('eia'), true);
    assert.equal(plan.providers.includes('dod-contracts'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('evidence contract backfill cycle dry-run emits closure and market summaries', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-evidence-cycle-'));
  try {
    const bundle = {
      reportId: 'RPT-market-test',
      reportType: 'theme_report',
      subject: {
        subjectId: 'ai-ml',
        subjectType: 'theme',
        displayName: 'AI / Machine Learning',
      },
      metadata: {
        deepResearchPack: {
          evidenceClassMatrix: [
            {
              evidenceClass: 'market_validation',
              label: 'Market validation',
              status: 'missing',
              nextQuery: 'AI / Machine Learning event study market validation',
              providerRoute: 'market_validation',
            },
          ],
        },
      },
      marketReactions: [{
        symbol: 'MSFT',
        eventWindow: '5d',
        relativeReturnPct: 2.1,
        tStat: 2.3,
        sampleSize: 70,
        eventCount: 6,
        controls: ['matched_controls', 'macro_regime_matched_controls'],
        validationStatus: 'validated',
      }],
      symbols: ['MSFT'],
    };
    await writeFile(path.join(dir, 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    await writeFile(path.join(dir, 'source-query-drafts.json'), '[]\n', 'utf8');

    const result = await runEvidenceContractBackfillCycle({
      dryRun: true,
      reportDir: dir,
      statePath: path.join(dir, 'state.json'),
      providers: ['sec', 'fmp', 'polygon', 'eia'],
      marketValidation: true,
      dashboardSummary: true,
      limit: 10,
    });

    assert.equal(result.apply, false);
    assert.equal(result.marketValidation.tier, 'decision_grade');
    assert.equal(result.closureSummary.reportId, 'RPT-market-test');
    assert.equal(result.closureSummary.marketTier, 'decision_grade');
    assert.equal(result.closureSummary.openClasses.length, 0);
    assert.equal(result.unblockPlan.unblockStatus, 'decision_review_ready');
    assert.equal(result.unblockPlan.routePlans.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('evidence contract backfill cycle summarizes unblock status deltas', () => {
  const delta = summarizeUnblockDelta({
    unblockStatus: 'targeted_backfill_needed',
    blockers: [
      { evidenceClass: 'procurement_trigger', state: 'pending' },
      { evidenceClass: 'substitution_limit', state: 'pending' },
    ],
  }, {
    unblockStatus: 'decision_review_ready',
    blockers: [
      { evidenceClass: 'substitution_limit', state: 'pending' },
    ],
  });

  assert.equal(delta.statusChanged, true);
  assert.equal(delta.beforeStatus, 'targeted_backfill_needed');
  assert.equal(delta.afterStatus, 'decision_review_ready');
  assert.deepEqual(delta.changedClasses, [
    { evidenceClass: 'procurement_trigger', before: 'pending', after: 'closed' },
  ]);
});

test('evidence contract backfill cycle injects resolved issuer universe into SRM routes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-evidence-cycle-'));
  try {
    const bundle = {
      reportId: 'RPT-srm',
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        subjectId: '16776',
        subjectType: 'cross_theme_candidate',
        displayName: 'solid rocket motor capacity',
        metadata: {
          themes: ['defense-industrial', 'space'],
          discovery: {
            triggerTerms: ['Aerojet Rocketdyne', 'Northrop Grumman rocket motor'],
          },
        },
      },
      metadata: {
        deepResearchPack: {
          evidenceClassMatrix: [{
            evidenceClass: 'issuer_exposure',
            label: 'Issuer exposure',
            status: 'missing',
            nextQuery: 'solid rocket motor capacity issuer exposure revenue segment guidance backlog',
            providerRoute: 'issuer_specific_filing_or_transcript',
          }],
        },
      },
    };
    await writeFile(path.join(dir, 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    await writeFile(path.join(dir, 'source-query-drafts.json'), '[]\n', 'utf8');

    const artifact = { reportDir: dir, bundle, drafts: [], manifest: null };
    const tasks = extractEvidenceContractTasksFromArtifact(artifact, { limit: 10 });
    const plan = await buildEvidenceBackfillCyclePlan({
      reportDir: dir,
      statePath: path.join(dir, 'state.json'),
      providers: ['sec', 'fmp', 'polygon'],
      limit: 10,
    });

    assert.deepEqual(tasks[0].metadata.target.issuerUniverseSymbols.sort(), ['LHX', 'NOC']);
    assert.deepEqual(plan.routes[0].route.promotionUniverse.sort(), ['LHX', 'NOC']);
    assert.equal(plan.routes[0].route.collectionUniverse.includes('LHX'), true);
    assert.equal(plan.routes[0].route.collectionUniverse.includes('NOC'), true);
    assert.equal(plan.routes[0].route.blocked, false);
    assert.equal(plan.providers.includes('sec'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('evidence contract backfill cycle blocks issuer routes with no issuer universe', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-evidence-cycle-'));
  try {
    const bundle = {
      reportId: 'RPT-no-issuer',
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        subjectId: '999',
        subjectType: 'cross_theme_candidate',
        displayName: 'unmapped bottleneck',
        metadata: { themes: ['technology-general'] },
      },
      metadata: {
        deepResearchPack: {
          evidenceClassMatrix: [{
            evidenceClass: 'issuer_exposure',
            status: 'missing',
            nextQuery: 'unmapped bottleneck issuer exposure revenue segment guidance',
            providerRoute: 'issuer_specific_filing_or_transcript',
          }],
        },
      },
    };
    await writeFile(path.join(dir, 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    await writeFile(path.join(dir, 'source-query-drafts.json'), '[]\n', 'utf8');

    const plan = await buildEvidenceBackfillCyclePlan({
      reportDir: dir,
      statePath: path.join(dir, 'state.json'),
      providers: ['sec', 'fmp', 'polygon'],
      limit: 10,
    });

    const issuerRoute = plan.routes.find((row) => row.route.evidenceClass === 'issuer_exposure');
    assert.equal(issuerRoute.route.blocked, true);
    assert.equal(issuerRoute.route.blockedReason, 'blocked_missing_issuer_universe');
    assert.equal(issuerRoute.route.executableCollectors.length, 0);
    assert.equal(plan.routes.some((row) => row.route.parentReadyForAdjacent === false), true);
    assert.equal(plan.providers.length > 0, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('evidence contract backfill cycle keeps strict endogenous routes on current candidate universe', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-evidence-cycle-'));
  try {
    const bundle = {
      reportId: 'RPT-strict-clean',
      reportType: 'cross_theme_bottleneck_report',
      issuerUniverse: ['AMZN', 'AMD', 'ASML', 'TSM', 'ENPH'],
      metadata: {
        issuerUniverse: ['AMZN', 'AMD', 'ASML', 'TSM', 'ENPH'],
        candidateIssuerUniverse: ['AMZN', 'AMD', 'ASML', 'TSM', 'ENPH'],
        adjacentCandidate: {
          metadata: {
            discoveryNamespace: 'strict_endogenous_adjacent',
            candidateIssuerUniverse: ['NVDA'],
            domains: ['semiconductor', 'clean_energy', 'industrial_materials'],
          },
        },
        deepResearch: {
          packs: {
            issuerDiscoveryPack: {
              rows: [
                { symbol: 'PWR', issuerName: 'Quanta Services', role: 'service_or_epc', status: 'candidate' },
                { symbol: 'ETN', issuerName: 'Eaton', role: 'equipment_supplier', status: 'candidate' },
              ],
            },
          },
        },
        deepResearchPack: {
          evidenceClassMatrix: [{
            evidenceClass: 'issuer_exposure',
            status: 'missing',
            nextQuery: 'approved-supplier qualification lead time issuer exposure backlog guidance',
            providerRoute: 'issuer_specific_filing_or_transcript',
          }],
        },
      },
      subject: {
        subjectId: 'endogenous-adjacent-clean-energy-generated-approved-supplier-qualification-lead-time',
        subjectType: 'cross_theme_candidate',
        displayName: 'approved-supplier qualification lead time',
        metadata: {
          themes: ['clean-energy'],
          discovery: { discoveryNamespace: 'strict_endogenous_adjacent' },
        },
      },
    };
    await writeFile(path.join(dir, 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    await writeFile(path.join(dir, 'source-query-drafts.json'), JSON.stringify([{
      reportId: 'RPT-strict-clean',
      text: 'AMZN AMD TSM ASML stale broad issuer exposure',
      metadata: {
        collectionKind: 'universal_evidence_contract',
        desiredEvidenceClass: 'issuer_exposure',
        issuerUniverse: ['AMZN', 'AMD', 'ASML', 'TSM'],
        providerRoutePlan: {
          evidenceClass: 'issuer_exposure',
          collectionUniverse: ['AMZN', 'AMD', 'ASML', 'TSM'],
        },
      },
    }], null, 2), 'utf8');

    const tasks = extractEvidenceContractTasksFromArtifact({ reportDir: dir, bundle, drafts: [], manifest: null }, { limit: 10 });
    const plan = await buildEvidenceBackfillCyclePlan({
      reportDir: dir,
      statePath: path.join(dir, 'state.json'),
      providers: ['sec', 'fmp', 'polygon'],
      limit: 10,
    });

    assert.deepEqual(tasks[0].metadata.issuerUniverse, []);
    assert.deepEqual(tasks[0].metadata.candidateIssuerUniverse.sort(), ['ETN', 'PWR']);
    assert.deepEqual(plan.routes[0].route.collectionUniverse.sort(), ['ETN', 'PWR']);
    assert.deepEqual(plan.routes[0].route.promotionUniverse, []);
    assert.equal(plan.routes[0].route.issuerUniverse.includes('AMZN'), false);
    assert.equal(plan.routes[0].stateKey.includes('ETN,PWR'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('evidence contract backfill cycle injects top-level frontier issuer candidates into issuer routes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-frontier-issuer-cycle-'));
  try {
    const bundle = {
      reportId: 'RPT-frontier-node',
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        subjectId: 'endogenous-frontier-parent-28681-substation-equipment-lead-time',
        subjectType: 'cross_theme_candidate',
        displayName: 'substation equipment lead time',
        metadata: {
          themes: ['clean-energy'],
          discovery: { frontierDiscovery: true, generatedLane: true },
        },
      },
      metadata: {
        issuerDiscoveryMap: [
          { symbol: 'ETN', issuerName: 'Eaton', status: 'frontier_node_candidate', sourceTypes: ['evidence_row'] },
          { symbol: 'PWR', issuerName: 'Quanta Services', status: 'frontier_node_candidate', sourceTypes: ['evidence_row'] },
          { symbol: 'AMZN', issuerName: 'Amazon', status: 'candidate', sourceTypes: ['stale_metadata'] },
        ],
        deepResearchPack: {
          evidenceClassMatrix: [{
            evidenceClass: 'issuer_exposure',
            status: 'missing',
            nextQuery: 'substation equipment lead time issuer exposure backlog guidance',
            providerRoute: 'issuer_specific_filing_or_transcript',
          }],
        },
      },
    };
    await writeFile(path.join(dir, 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    await writeFile(path.join(dir, 'source-query-drafts.json'), '[]\n', 'utf8');

    const artifact = { reportDir: dir, bundle, drafts: [], manifest: null };
    const tasks = extractEvidenceContractTasksFromArtifact(artifact, { limit: 10 });
    const plan = await buildEvidenceBackfillCyclePlan({
      reportDir: dir,
      statePath: path.join(dir, 'state.json'),
      providers: ['sec', 'fmp', 'polygon'],
      limit: 10,
    });

    assert.deepEqual(tasks[0].metadata.issuerUniverse, []);
    assert.deepEqual(tasks[0].metadata.candidateIssuerUniverse.sort(), ['ETN', 'PWR']);
    assert.deepEqual(tasks[0].metadata.collectionUniverse.sort(), ['ETN', 'PWR']);
    assert.equal(tasks[0].metadata.collectionUniverse.includes('AMZN'), false);
    assert.deepEqual(plan.routes[0].route.collectionUniverse.sort(), ['ETN', 'PWR']);
    assert.deepEqual(plan.routes[0].route.promotionUniverse, []);
    assert.equal(plan.routes[0].route.blocked, false);
    assert.equal(plan.providers.includes('sec'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('evidence contract backfill cycle creates parent-first routes for graph-overlap-only parents', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-parent-readiness-cycle-'));
  try {
    const bundle = {
      reportId: 'RPT-cross-theme-bottleneck-report-16384-test',
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        subjectId: '16384',
        subjectType: 'cross_theme_candidate',
        displayName: 'grid interconnection queue',
        metadata: {
          themes: ['climate-change', 'cloud-infrastructure'],
          discovery: { ontologyKey: 'data_center_infrastructure' },
        },
      },
      metadata: {
        candidate: {
          reason: 'grid interconnection queue is a constraint candidate connecting climate-change and cloud-infrastructure through shared dependency graph overlap.',
          evidence_summary: {
            evidenceQuality: 0,
            sourceDiversity: 0,
            sourceDiversityRaw: 0,
            directEvidenceCount: 0,
          },
          metadata: {
            sourceQueryFailure: { category: 'weak-noise-only' },
          },
        },
        deepResearchPack: { evidenceClassMatrix: [] },
      },
    };
    await writeFile(path.join(dir, 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    await writeFile(path.join(dir, 'source-query-drafts.json'), '[]\n', 'utf8');

    const tasks = extractEvidenceContractTasksFromArtifact({ reportDir: dir, bundle, drafts: [], manifest: null }, { limit: 10 });
    const plan = await buildEvidenceBackfillCyclePlan({
      reportDir: dir,
      statePath: path.join(dir, 'state.json'),
      providers: ['sec', 'fmp', 'eia', 'public-planning-source'],
      limit: 10,
    });

    assert.equal(tasks.length >= 4, true);
    assert.equal(tasks.every((task) => task.metadata.parentReadyForAdjacent === false), true);
    assert.equal(tasks.every((task) => task.metadata.parentReadinessState === 'graph_overlap_only'), true);
    assert.ok(tasks.some((task) => task.metadata.desiredEvidenceClass === 'mechanism_validation'));
    assert.ok(tasks.some((task) => task.query.includes('direct evidence official provider')));
    assert.equal(plan.routes.some((row) => row.route.parentReadyForAdjacent === false), true);
    assert.equal(plan.routes.some((row) => row.route.parentReadinessState === 'graph_overlap_only'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function recordingClient(rowsToReturn = []) {
  const captured = [];
  return {
    async query(sql, params) {
      captured.push({ sql, params });
      return { rows: rowsToReturn };
    },
    captured,
  };
}

test('loadDbBackfillTasks scopes SQL to reportId/subjectKey and excludes terminal closure states', async () => {
  const client = recordingClient([]);
  await loadDbBackfillTasks(client, { reportId: 'RPT-test', subjectKey: 'subject-key', limit: 12 });
  assert.equal(client.captured.length, 1);
  const { sql, params } = client.captured[0];
  assert.match(sql, /report_id = \$2/);
  assert.match(sql, /metadata->>'reportId' = \$2/);
  assert.match(sql, /subject_key = \$3/);
  assert.match(sql, /metadata->>'closureState'/);
  assert.match(sql, /NOT \(metadata->>'closureState' = ANY/);
  assert.equal(params[0], 12);
  assert.equal(params[1], 'RPT-test');
  assert.equal(params[2], 'subject-key');
  assert.ok(Array.isArray(params[3]));
  assert.ok(params[3].includes('direct_provider_required'));
  assert.ok(params[3].includes('market_validation_pending'));
});

test('loadDbBackfillTasks without reportId still excludes terminal closure states', async () => {
  const client = recordingClient([]);
  await loadDbBackfillTasks(client, { limit: 25 });
  assert.equal(client.captured.length, 1);
  const { sql, params } = client.captured[0];
  assert.doesNotMatch(sql, /report_id = \$/);
  assert.match(sql, /metadata->>'closureState'/);
  assert.equal(params[0], 25);
  assert.ok(Array.isArray(params[1]));
  assert.ok(params[1].includes('direct_provider_required'));
});

test('loadTasksFromDbIfNeeded refuses to load global tasks when scope is set and no artifact present', async () => {
  const client = recordingClient([{ id: 'leaked', subject_key: 'other', query: 'q', metadata: {} }]);
  const cyclePlan = { tasks: [], artifact: null, state: { routes: {} }, reportId: 'RPT-scoped' };
  const result = await loadTasksFromDbIfNeeded(client, cyclePlan, { reportDir: '/tmp/x' });
  assert.equal(result.tasks.length, 0);
  assert.equal(result.strictScopeNoTasks, true);
  assert.equal(client.captured.length, 0);
});

test('loadTasksFromDbIfNeeded falls back to global DB load only in unscoped mode', async () => {
  const client = recordingClient([{ id: 1, subject_key: 'other', query: 'q', task_type: 'source_query', metadata: {} }]);
  const cyclePlan = { tasks: [], artifact: null, state: { routes: {} } };
  const result = await loadTasksFromDbIfNeeded(client, cyclePlan, { limit: 5 });
  assert.equal(client.captured.length, 1);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.strictScopeNoTasks, undefined);
});

test('buildEvidenceBackfillCyclePlan writes state into per-report shard when no explicit state path is provided', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-evidence-cycle-'));
  try {
    const bundle = {
      reportId: 'RPT-shard-test',
      reportType: 'theme_report',
      subject: { subjectId: 'ai-ml', subjectType: 'theme', displayName: 'AI / Machine Learning' },
      metadata: { deepResearchPack: { evidenceClassMatrix: [] } },
      symbols: [],
    };
    await writeFile(path.join(dir, 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    await writeFile(path.join(dir, 'source-query-drafts.json'), '[]\n', 'utf8');
    const plan = await buildEvidenceBackfillCyclePlan({
      reportDir: dir,
      providers: ['sec'],
      limit: 10,
    });
    assert.ok(plan.statePath);
    assert.match(plan.statePath, /evidence-contract-backfill-cycle-state-shards/);
    assert.match(plan.statePath, /\.json$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('buildEvidenceBackfillCyclePlan honors user-provided --state-path', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-evidence-cycle-'));
  try {
    const bundle = {
      reportId: 'RPT-explicit-state',
      reportType: 'theme_report',
      subject: { subjectId: 'ai-ml', subjectType: 'theme', displayName: 'AI / Machine Learning' },
      metadata: { deepResearchPack: { evidenceClassMatrix: [] } },
      symbols: [],
    };
    await writeFile(path.join(dir, 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    await writeFile(path.join(dir, 'source-query-drafts.json'), '[]\n', 'utf8');
    const explicitStatePath = path.join(dir, 'custom-state.json');
    const plan = await buildEvidenceBackfillCyclePlan({
      reportDir: dir,
      providers: ['sec'],
      limit: 10,
      statePath: explicitStatePath,
      userStatePathProvided: true,
    });
    assert.equal(plan.statePath, explicitStatePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
