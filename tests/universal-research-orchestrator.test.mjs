import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chooseReportSubjects,
  inferUniversalSubjectType,
  normalizeUniversalSubjects,
  reportSubjectArgumentForUniversalSubject,
  reportTypeForUniversalSubjectType,
  selectDataPacksForSubject,
  sortStrictEndogenousSubjects,
} from '../scripts/_shared/universal-research-orchestrator.mjs';
import {
  genericKpiArgs,
  hasCoverageProgress,
  parseArgs as parseUniversalResearchArgs,
  providerArgs,
} from '../scripts/run-universal-research-orchestrator.mjs';

test('universal subject classifier handles symbols, sources, materials, and themes', () => {
  assert.equal(inferUniversalSubjectType({ label: 'LIN', symbols: ['LIN'] }), 'company_or_symbol');
  assert.equal(inferUniversalSubjectType({ label: 'FreightWaves feed', sourceTypes: ['add-rss'] }), 'source');
  assert.equal(inferUniversalSubjectType({ label: 'liquid hydrogen cryogenic cooling' }), 'material_or_bottleneck');
  assert.equal(inferUniversalSubjectType({ label: 'cloud-infrastructure', sourceTypes: ['theme_kpi_map'] }), 'theme');
});

test('data pack planner is generic and type-driven', () => {
  assert.deepEqual(
    selectDataPacksForSubject({ subjectType: 'company_or_symbol' }).includes('fundamentalPack'),
    true,
  );
  assert.deepEqual(
    selectDataPacksForSubject({ subjectType: 'material_or_bottleneck' }).includes('industryPack'),
    true,
  );
  assert.deepEqual(
    selectDataPacksForSubject({ subjectType: 'source' }).includes('sourceQualityPack'),
    true,
  );
});

test('normalizer merges duplicate subjects without hardcoding a theme', () => {
  const [subject] = normalizeUniversalSubjects([
    {
      subjectKey: 'linde-cryogenic-cooling',
      label: 'Linde cryogenic cooling',
      symbols: ['LIN'],
      sourceTypes: ['tracked_targets'],
    },
    {
      subjectKey: 'Linde cryogenic cooling',
      label: 'Linde',
      aliases: ['liquid hydrogen'],
      sourceTypes: ['approval_queue'],
    },
  ]);
  assert.equal(subject.subjectKey, 'linde-cryogenic-cooling');
  assert.equal(subject.symbols.includes('LIN'), true);
  assert.equal(subject.aliases.includes('liquid hydrogen'), true);
  assert.equal(subject.sourceTypes.includes('approval_queue'), true);
  assert.equal(subject.dataPacks.includes('fundamentalPack'), true);
});

test('normalizer lets adjacent evidence correct a stale subject type', () => {
  const [subject] = normalizeUniversalSubjects([
    {
      subjectKey: 'adjacent-16776-range-operations-or-ground-systems-support',
      label: 'range operations contract',
      subjectType: 'event',
      sourceTypes: ['provider_target'],
    },
    {
      subjectKey: 'adjacent-16776-range-operations-or-ground-systems-support',
      label: 'Range operations or ground systems support',
      subjectType: 'material_or_bottleneck',
      sourceTypes: ['adjacent_theme_candidates'],
      metadata: {
        adjacentStatus: 'ready_for_deep_report',
        lane: 'range_operations_or_ground_systems_support',
      },
    },
  ]);
  assert.equal(subject.subjectType, 'material_or_bottleneck');
  assert.equal(subject.metadata.adjacentStatus, 'ready_for_deep_report');
});

test('report subject selector returns multiple reportable themes for closure loops', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/jsonb_to_recordset/.test(sql)) {
        return { rows: [{ theme: 'defense-industrial' }, { theme: 'ai-ml' }] };
      }
      return { rows: [] };
    },
  };
  const subjects = [
    { subject_key: 'defense-industrial', subject_type: 'theme', priority_score: 88 },
    { subject_key: 'ai-ml', subject_type: 'theme', priority_score: 84 },
    { subject_key: 'LIN', subject_type: 'company_or_symbol', priority_score: 99 },
  ];
  const selected = await chooseReportSubjects(client, subjects, 2);
  assert.deepEqual(selected, ['defense-industrial', 'ai-ml']);
  assert.equal(queries[0].params[1], 2);
});

test('report subject selector supplements sparse theme coverage with top universal subjects', async () => {
  const client = {
    async query(sql) {
      if (/jsonb_to_recordset/.test(sql)) return { rows: [{ theme: 'conflict' }] };
      return { rows: [] };
    },
  };
  const subjects = [
    { subject_key: 'air-liquide', subject_type: 'cross_theme_candidate', priority_score: 100 },
    { subject_key: 'conflict', subject_type: 'theme', priority_score: 70 },
    { subject_key: 'source-only-item', subject_type: 'source', priority_score: 99 },
    { subject_key: 'linde', subject_type: 'company_or_symbol', priority_score: 95 },
  ];
  const selected = await chooseReportSubjects(client, subjects, 3);
  assert.deepEqual(selected, ['conflict', 'air-liquide', 'linde']);
});

test('report subject selector promotes ready adjacent candidates before ordinary themes', async () => {
  const client = {
    async query(sql) {
      if (/jsonb_to_recordset/.test(sql)) return { rows: [{ theme: 'space' }, { theme: 'defense-industrial' }] };
      return { rows: [] };
    },
  };
  const subjects = [
    { subject_key: 'space', subject_type: 'theme', priority_score: 95 },
    { subject_key: 'defense-industrial', subject_type: 'theme', priority_score: 94 },
    {
      subject_key: 'adjacent-16776-material-supply-or-substitution',
      subject_type: 'material_or_bottleneck',
      priority_score: 100,
      metadata: { adjacentStatus: 'ready_for_deep_report', lane: 'material_supply_or_substitution' },
    },
    {
      subject_key: 'adjacent-16776-launch-fueling-or-cryogenic-infrastructure',
      subject_type: 'material_or_bottleneck',
      priority_score: 71,
      metadata: { adjacentStatus: 'ready_for_deep_report', lane: 'launch_fueling_or_cryogenic_infrastructure' },
    },
  ];
  const selected = await chooseReportSubjects(client, subjects, 2);
  assert.deepEqual(selected, [
    'adjacent-16776-launch-fueling-or-cryogenic-infrastructure',
    'adjacent-16776-material-supply-or-substitution',
  ]);
});

test('report subject selector prioritizes non-obvious frontier candidates before static adjacent candidates', async () => {
  const client = {
    async query(sql) {
      if (/jsonb_to_recordset/.test(sql)) return { rows: [{ theme: 'space' }] };
      return { rows: [] };
    },
  };
  const subjects = [
    { subject_key: 'space', subject_type: 'theme', priority_score: 95 },
    {
      subject_key: 'adjacent-static-launch-fueling',
      subject_type: 'material_or_bottleneck',
      priority_score: 99,
      metadata: { adjacentStatus: 'ready_for_deep_report', lane: 'launch_fueling_or_cryogenic_infrastructure' },
    },
    {
      subject_key: 'frontier-protection-relay-lead-time',
      subject_type: 'material_or_bottleneck',
      priority_score: 80,
      metadata: { adjacentStatus: 'non_obvious_bottleneck_ready', lane: 'generated_protection_relay_lead_time' },
    },
  ];
  const selected = await chooseReportSubjects(client, subjects, 2);
  assert.deepEqual(selected, [
    'frontier-protection-relay-lead-time',
    'adjacent-static-launch-fueling',
  ]);
});

test('strict report selector can surface frontier research leads without investment-ready status', async () => {
  const client = {
    async query(sql) {
      if (/jsonb_to_recordset/.test(sql)) return { rows: [{ theme: 'ai-ml' }] };
      return { rows: [] };
    },
  };
  const subjects = [
    { subject_key: 'ai-ml', subject_type: 'theme', priority_score: 95 },
    {
      subject_key: 'frontier-protection-relay-qualification',
      subject_type: 'material_or_bottleneck',
      priority_score: 83,
      metadata: {
        adjacentStatus: 'needs_scarcity_evidence',
        lane: 'generated_protection_relay_qualification',
        discoveryNamespace: 'strict_endogenous_adjacent',
        frontierDiscovery: true,
        parentReadyForAdjacent: true,
        nonObviousDiscovery: { frontierScore: 78 },
      },
    },
    {
      subject_key: 'frontier-broad-grid-interconnection',
      subject_type: 'material_or_bottleneck',
      priority_score: 85,
      metadata: {
        adjacentStatus: 'frontier_candidate',
        lane: 'generated_grid_interconnection_queue',
        discoveryNamespace: 'strict_endogenous_adjacent',
        frontierDiscovery: true,
        parentReadyForAdjacent: true,
        nonObviousDiscovery: { frontierScore: 52 },
      },
    },
  ];
  const selected = await chooseReportSubjects(client, subjects, 2, { strictEndogenousAdjacent: true });
  assert.deepEqual(selected, [
    'frontier-protection-relay-qualification',
    'frontier-broad-grid-interconnection',
  ]);
});

test('strict report selector skips adjacent candidates whose parent is not ready', async () => {
  const client = {
    async query(sql) {
      if (/jsonb_to_recordset/.test(sql)) return { rows: [{ theme: 'ai-ml' }] };
      return { rows: [] };
    },
  };
  const subjects = [
    { subject_key: 'ai-ml', subject_type: 'theme', priority_score: 95 },
    {
      subject_key: 'frontier-unready-parent-child',
      subject_type: 'material_or_bottleneck',
      priority_score: 99,
      metadata: {
        adjacentStatus: 'non_obvious_bottleneck_ready',
        lane: 'generated_interconnection_study_capacity',
        discoveryNamespace: 'strict_endogenous_adjacent',
        frontierDiscovery: true,
        parentReadyForAdjacent: false,
        parentReadinessState: 'graph_overlap_only',
      },
    },
    {
      subject_key: 'adjacent-16384-qualification-testing-or-mission-support',
      subject_type: 'theme',
      source_types: ['adjacent_theme_candidates'],
      priority_score: 100,
      metadata: {},
    },
    {
      subject_key: 'frontier-ready-parent-child',
      subject_type: 'material_or_bottleneck',
      priority_score: 80,
      metadata: {
        adjacentStatus: 'ready_for_deep_report',
        lane: 'generated_protection_relay_qualification',
        discoveryNamespace: 'strict_endogenous_adjacent',
        frontierDiscovery: true,
        parentReadyForAdjacent: true,
      },
    },
  ];
  const selected = await chooseReportSubjects(client, subjects, 2, { strictEndogenousAdjacent: true });
  assert.deepEqual(selected, ['frontier-ready-parent-child', 'ai-ml']);
});

test('strict report selector uses report-ready frontier parents before theme fallback', async () => {
  const client = {
    async query(sql) {
      if (/jsonb_to_recordset/.test(sql)) return { rows: [{ theme: 'ai-ml' }] };
      return { rows: [] };
    },
  };
  const subjects = [
    { subject_key: 'ai-ml', subject_type: 'theme', priority_score: 95 },
    {
      subject_key: 'known-power-equipment-issuer',
      subject_type: 'cross_theme_candidate',
      source_types: ['cross_theme_candidates'],
      priority_score: 100,
      metadata: {
        evidenceSummary: {
          parentReadyForAdjacent: true,
          frontierParentReportReady: false,
          frontierParentCollectionEligible: false,
          frontierParentState: 'consensus_issuer_suppressed',
          frontierParentScore: 0.9,
        },
      },
    },
    {
      subject_key: 'protection-relay-qualification-lead-time',
      subject_type: 'cross_theme_candidate',
      source_types: ['cross_theme_candidates'],
      priority_score: 70,
      metadata: {
        evidenceSummary: {
          parentReadyForAdjacent: true,
          frontierParentReportReady: true,
          frontierParentCollectionEligible: true,
          frontierParentState: 'frontier_parent_ready',
          frontierParentScore: 0.72,
          nonObviousDiscovery: { frontierScore: 74 },
        },
      },
    },
    {
      subject_key: 'broad-grid-infrastructure',
      subject_type: 'cross_theme_candidate',
      source_types: ['cross_theme_candidates'],
      priority_score: 90,
      metadata: {
        evidenceSummary: {
          parentReadyForAdjacent: true,
          frontierParentReportReady: false,
          frontierParentCollectionEligible: true,
          frontierParentState: 'broad_parent_needs_decomposition',
          frontierParentScore: 0.31,
          nonObviousDiscovery: { frontierScore: 55 },
        },
      },
    },
  ];
  const selected = await chooseReportSubjects(client, subjects, 2, { strictEndogenousAdjacent: true });
  assert.deepEqual(selected, ['protection-relay-qualification-lead-time', 'broad-grid-infrastructure']);
});

test('strict subject ordering suppresses consensus issuer subjects behind frontier nodes', () => {
  const ordered = sortStrictEndogenousSubjects(normalizeUniversalSubjects([
    {
      subjectKey: 'eaton',
      label: 'Eaton',
      subjectType: 'cross_theme_candidate',
      sourceTypes: ['cross_theme_candidates'],
      priorityScore: 100,
    },
    {
      subjectKey: 'vertiv',
      label: 'Vertiv',
      subjectType: 'cross_theme_candidate',
      sourceTypes: ['cross_theme_candidates'],
      priorityScore: 100,
    },
    {
      subjectKey: 'frontier-approved-supplier-lead-time',
      label: 'approved-supplier qualification lead time',
      subjectType: 'material_or_bottleneck',
      sourceTypes: ['adjacent_theme_candidates'],
      priorityScore: 70,
      metadata: {
        adjacentStatus: 'needs_scarcity_evidence',
        discoveryNamespace: 'strict_endogenous_adjacent',
        frontierDiscovery: true,
        parentReadyForAdjacent: true,
        nonObviousDiscovery: { frontierScore: 67 },
      },
    },
  ]));

  assert.equal(ordered[0].subjectKey, 'frontier-approved-supplier-lead-time');
  assert.deepEqual(ordered.slice(1).map((subject) => subject.subjectKey), ['eaton', 'vertiv']);
});

test('strict subject ordering prefers concrete source-derived nodes over generic class labels', () => {
  const ordered = sortStrictEndogenousSubjects(normalizeUniversalSubjects([
    {
      subjectKey: 'frontier-approved-supplier-lead-time',
      label: 'approved-supplier qualification lead time',
      subjectType: 'material_or_bottleneck',
      sourceTypes: ['adjacent_theme_candidates', 'generated_approved-supplier-qualification-lead-time'],
      priorityScore: 100,
      metadata: {
        adjacentStatus: 'needs_scarcity_evidence',
        discoveryNamespace: 'strict_endogenous_adjacent',
        frontierDiscovery: true,
        parentReadyForAdjacent: true,
        sourceTerms: ['raw evidence', 'production capacity matches mechanism'],
        nonObviousDiscovery: { frontierScore: 90 },
      },
    },
    {
      subjectKey: 'frontier-interconnection-study-capacity',
      label: 'interconnection study capacity',
      subjectType: 'material_or_bottleneck',
      sourceTypes: ['adjacent_theme_candidates', 'generated_interconnection-study-capacity'],
      priorityScore: 80,
      metadata: {
        adjacentStatus: 'needs_scarcity_evidence',
        discoveryNamespace: 'strict_endogenous_adjacent',
        frontierDiscovery: true,
        parentReadyForAdjacent: true,
        sourceTerms: ['interconnection studies', 'queue processing times'],
        nonObviousDiscovery: { frontierScore: 60 },
      },
    },
  ]));

  assert.equal(ordered[0].subjectKey, 'frontier-interconnection-study-capacity');
});

test('universal report generation maps subject type to report type and DB match argument', () => {
  const crossTheme = { subject_key: 'air-liquide', subject_label: 'Air Liquide', subject_type: 'cross_theme_candidate' };
  const symbol = { subject_key: 'LIN', subject_label: 'LIN', subject_type: 'company_or_symbol' };
  const theme = { subject_key: 'conflict', subject_label: 'Conflict', subject_type: 'theme' };
  const adjacent = {
    subject_key: 'adjacent-16776-launch-fueling-or-cryogenic-infrastructure',
    subject_label: 'Launch fueling or cryogenic infrastructure',
    subject_type: 'material_or_bottleneck',
    metadata: { adjacentStatus: 'ready_for_deep_report' },
  };
  const truncatedAdjacent = {
    subject_key: 'endogenous-adjacent-truncated-key',
    subject_label: 'protection relay lead time',
    subject_type: 'material_or_bottleneck',
    metadata: {
      adjacentStatus: 'needs_scarcity_evidence',
      adjacentCandidateKey: 'endogenous-adjacent-ai-ml-generated-protection-relay-lead-time-qualification',
    },
  };

  assert.equal(reportTypeForUniversalSubjectType(crossTheme.subject_type), 'cross_theme_bottleneck_report');
  assert.equal(reportSubjectArgumentForUniversalSubject(crossTheme), 'Air Liquide');
  assert.equal(reportTypeForUniversalSubjectType(adjacent.subject_type), 'cross_theme_bottleneck_report');
  assert.equal(reportSubjectArgumentForUniversalSubject(adjacent), 'adjacent-16776-launch-fueling-or-cryogenic-infrastructure');
  assert.equal(
    reportSubjectArgumentForUniversalSubject(truncatedAdjacent),
    'endogenous-adjacent-ai-ml-generated-protection-relay-lead-time-qualification',
  );
  assert.equal(reportTypeForUniversalSubjectType(symbol.subject_type), 'symbol_signal_report');
  assert.equal(reportSubjectArgumentForUniversalSubject(symbol), 'LIN');
  assert.equal(reportTypeForUniversalSubjectType(theme.subject_type), 'theme_report');
  assert.equal(reportSubjectArgumentForUniversalSubject(theme), 'conflict');
});

test('universal research CLI exposes bounded multi-subject closure controls', () => {
  const parsed = parseUniversalResearchArgs([
    '--report-subject-limit', '99',
    '--coverage-passes', '99',
    '--closure-passes', '8',
    '--providers', 'sec,fmp,polygon',
    '--provider-throttle-hours', '999',
    '--provider-step-timeout-ms', '0',
    '--adjacent-limit', '999',
    '--no-adjacent-expansion',
    '--strict-endogenous-adjacent',
    '--auto-report-mode', 'adjacent-first',
    '--limit', 'bad-number',
  ]);
  assert.equal(parsed.reportSubjectLimit, 10);
  assert.equal(parsed.coveragePasses, 6);
  assert.equal(parsed.closurePasses, 5);
  assert.equal(parsed.providerThrottleHours, 24 * 30);
  assert.equal(parsed.providerStepTimeoutMs, 0);
  assert.equal(parsed.adjacentLimit, 100);
  assert.equal(parsed.adjacentExpansion, true);
  assert.equal(parsed.strictEndogenousAdjacent, true);
  assert.equal(parsed.autoReportMode, 'adjacent-first');
  assert.deepEqual(parsed.providers, ['sec', 'fmp', 'polygon']);
  assert.equal(parsed.limit, 40);
});

test('coverage closure detects nested provider evidence and queued KPI work', () => {
  assert.equal(hasCoverageProgress({
    ok: true,
    json: {
      targets: [{
        results: [{ provider: 'sec', inserted: 0 }, { provider: 'dod-contracts', inserted: 2 }],
      }],
    },
  }), true);

  assert.equal(hasCoverageProgress({
    ok: true,
    json: {
      materialized: { insertedCount: 0 },
      jobs: { insertedCount: 3 },
    },
  }), true);

  assert.equal(hasCoverageProgress({
    ok: true,
    json: {
      targets: [{ results: [{ provider: 'fmp', inserted: 0, rateLimited: true }] }],
      skippedCount: 1,
    },
  }), false);
});

test('coverage closure command builders re-enter providers and theme KPI mode safely', () => {
  const options = {
    providerLimit: 25,
    sinceHours: 168,
    providerThrottleHours: 6,
    providers: ['sec', 'fmp', 'dod-contracts'],
    limit: 40,
  };

  assert.deepEqual(providerArgs(options, ['defense-industrial']).slice(0, 8), [
    'scripts/collect-free-external-data.mjs',
    '--auto-discover',
    '--providers',
    'sec,fmp,dod-contracts',
    '--limit',
    '25',
    '--since-hours',
    '168',
  ]);
  assert.equal(providerArgs(options, ['defense-industrial']).includes('--themes'), true);
  assert.deepEqual(genericKpiArgs(options, 'defense-industrial').slice(-4), ['--mode', 'theme', '--theme', 'defense-industrial']);
  assert.equal(genericKpiArgs(options, 'RTX').includes('--mode'), false);
});
