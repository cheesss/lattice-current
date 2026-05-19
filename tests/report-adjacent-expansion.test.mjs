import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ADJACENT_FAILURE_REASONS,
  ADJACENT_REPORT_READY_STATUSES,
  STRICT_ENDOGENOUS_HOLDOUT_TERMS,
  adjacentStatusFromSourceQueryClosure,
  buildAdjacentThemeCandidatesFromArtifact,
  buildAdjacentThemeCandidatesFromReportDir,
  enqueueAdjacentCandidateSourceQueries,
  isRecursiveAdjacentCandidateKey,
  recordAdjacentDeepReportResult,
} from '../scripts/_shared/report-adjacent-expansion.mjs';
import {
  scoreBottleneckSpecificity,
  scoreNonObviousBottleneckDiscovery,
  scoreThemeDistance,
} from '../scripts/_shared/non-obvious-bottleneck-discovery.mjs';
import {
  deriveConcreteBottleneckNodes,
} from '../scripts/_shared/bottleneck-node-decomposer.mjs';

function srmArtifact(extra = {}) {
  return {
    manifest: {
      reportId: 'RPT-cross-theme-bottleneck-report-16776-test',
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        subjectType: 'cross_theme_candidate',
        subjectId: '16776',
        displayName: 'solid rocket motor capacity',
        metadata: {
          themes: ['defense-industrial', 'space'],
          discovery: {
            ontologyKey: 'defense_industrial',
            connector: 'solid rocket motor capacity',
            mechanism: 'missile replenishment depends on motor production capacity and qualified energetic-material supply',
            triggerTerms: [
              'solid rocket motor',
              'interceptor production',
              'energetic materials',
              'rocket motor qualification',
            ],
            sourceQueries: [
              '"solid rocket motor" "qualified supplier" energetic materials missile production',
            ],
          },
        },
      },
    },
    drafts: [
      {
        desiredEvidenceClass: 'supplier_capacity',
        queryVariants: [
          'solid rocket motor production capacity propellant qualified supplier expansion',
        ],
      },
      {
        desiredEvidenceClass: 'technical_qualification',
        queryVariants: [
          'solid rocket motor test firing qualification certification acceptance test',
        ],
      },
      {
        desiredEvidenceClass: 'substitution_limit',
        queryVariants: [
          'solid rocket motor sole source qualified supplier substitution limit',
        ],
      },
    ],
    bundle: {
      metadata: {
        candidate: {
          reason: 'solid rocket motor capacity has direct evidence connecting defense-industrial and space.',
          evidence_summary: {
            evidenceQuality: 0.72,
            sourceDiversity: 0.7,
            sourceDiversityRaw: 2,
            directEvidenceCount: 1,
            independentSourceGroups: ['company-ir', 'defense.gov'],
          },
        },
      },
    },
    ...extra,
  };
}

test('no-seed SRM artifact creates adjacent propulsion and qualification candidates', () => {
  const { candidates, diagnostics } = buildAdjacentThemeCandidatesFromArtifact(srmArtifact());
  const lanes = candidates.map((candidate) => candidate.lane);
  assert.ok(lanes.includes('propulsion_input_materials'));
  assert.ok(lanes.includes('qualification_testing_or_mission_support'));
  assert.ok(candidates.some((candidate) => candidate.status === 'ready_for_deep_report'));
  assert.equal(candidates.some((candidate) => /linde|amtm/i.test(candidate.label)), false);
  assert.ok(diagnostics.length >= candidates.length);
});

test('no-seed space artifact creates launch infrastructure lane before issuer promotion', () => {
  const { candidates } = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-space-economy-test',
      reportType: 'theme_report',
      subject: {
        displayName: 'Space Economy',
        metadata: {
          themes: ['space'],
          discovery: {
            ontologyKey: 'space',
            mechanism: 'launch cadence and mission awards are rising but support infrastructure evidence is incomplete',
            triggerTerms: ['launch cadence', 'spaceport throughput', 'mission award'],
          },
        },
      },
    },
    drafts: [
      { desiredEvidenceClass: 'launch_manifest', queryVariants: ['launch cadence mission backlog manifest'] },
      { desiredEvidenceClass: 'mission_award', queryVariants: ['space launch mission award ground support contract'] },
      { desiredEvidenceClass: 'supplier_capacity', queryVariants: ['launch capacity support infrastructure'] },
    ],
  });
  const cryo = candidates.find((candidate) => candidate.lane === 'launch_fueling_or_cryogenic_infrastructure');
  const range = candidates.find((candidate) => candidate.lane === 'range_operations_or_ground_systems_support');
  assert.ok(cryo || range);
  assert.equal(cryo?.status || range?.status, 'needs_evidence');
  assert.equal(cryo?.failureReason || range?.failureReason, 'source_coverage_gap');
  assert.match((cryo || range).queryVariants.join(' '), /cryogenic|LOX|range operations|ground systems/i);
});

test('adjacent expansion records root cause when vocabulary cannot create a lane', () => {
  const { candidates, diagnostics } = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-consumer-media-test',
      reportType: 'theme_report',
      subject: {
        displayName: 'consumer media advertising',
        metadata: { themes: ['consumer'], discovery: { triggerTerms: ['advertising impressions'] } },
      },
    },
    drafts: [],
  });
  assert.equal(candidates.length, 0);
  assert.ok(ADJACENT_FAILURE_REASONS.includes(diagnostics[0].failureReason));
  assert.match(diagnostics[0].nextAction, /evidence contract|vocabulary|source/i);
});

test('strict endogenous mode does not use static adjacent lane labels or seed terms', () => {
  const { candidates, diagnostics } = buildAdjacentThemeCandidatesFromArtifact(srmArtifact(), {
    strictEndogenousAdjacent: true,
  });
  assert.ok(candidates.length > 0 || diagnostics.length > 0);
  for (const candidate of candidates) {
    assert.match(candidate.lane, /^generated_/);
    assert.equal(candidate.metadata.discoveryNamespace, 'strict_endogenous_adjacent');
    assert.equal(candidate.metadata.staticLanePlaybookUsed, false);
    assert.deepEqual(candidate.seedTerms, []);
    assert.doesNotMatch(candidate.queryVariants.join(' '), /space launch fueling cryogenic infrastructure|range operations ground systems support/i);
    assert.equal(candidate.metadata.seedLeakageScore, 0);
  }
  assert.ok(Array.isArray(STRICT_ENDOGENOUS_HOLDOUT_TERMS));
});

test('strict endogenous mode excludes legacy adjacent/no-bound artifacts from scoring', () => {
  const { candidates, diagnostics, context } = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-cross-theme-bottleneck-report-no-match-theme-launch-fueling-or-cryogenic-infrastructure-test',
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        subjectType: 'no_bound_candidate',
        subjectId: 'NO-MATCH-theme-launch-fueling-or-cryogenic-infrastructure-test',
        displayName: 'No cross theme bottleneck report bound to Launch fueling or cryogenic infrastructure',
      },
    },
    validation: {
      decisionDiagnostic: { status: 'acceptance_failed', reasons: ['search exhausted'] },
    },
  }, { strictEndogenousAdjacent: true });
  assert.equal(candidates.length, 0);
  assert.equal(context.strictExcluded, true);
  assert.equal(diagnostics[0].failureReason, 'seed_contamination_holdout');
});

test('strict endogenous space corpus induces a source-derived launch input lane', () => {
  const { candidates } = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-strict-space-source-test',
      reportType: 'theme_report',
      subject: {
        displayName: 'Space Economy',
        metadata: {
          themes: ['space'],
          discovery: { ontologyKey: 'space', triggerTerms: [] },
        },
      },
    },
    drafts: [
      { desiredEvidenceClass: 'supplier_capacity', queryVariants: [] },
      { desiredEvidenceClass: 'technical_qualification', queryVariants: [] },
    ],
    extraText: [
      'Spaceport operators require liquid oxygen storage capacity before launch cadence can increase.',
      'Launch teams depend on propellant loading infrastructure and fuel farm throughput during high-cadence campaigns.',
      'The same launch providers cite qualification lead time for loading equipment as a schedule constraint.',
    ],
  }, { strictEndogenousAdjacent: true });
  assert.ok(candidates.length > 0);
  const candidate = candidates[0];
  assert.match(candidate.lane, /^generated_/);
  assert.match(candidate.sourceTerms.join(' '), /liquid oxygen|propellant loading|fuel farm|loading equipment|qualification lead time/i);
  assert.equal(ADJACENT_REPORT_READY_STATUSES.includes(candidate.status), true);
  assert.equal(candidate.metadata.frontierDiscovery, true);
  assert.equal(candidate.metadata.seedLeakageScore, 0);
});

test('strict endogenous space corpus induces range support without static range lane', () => {
  const { candidates } = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-strict-space-range-test',
      reportType: 'theme_report',
      subject: {
        displayName: 'Space Economy',
        metadata: {
          themes: ['space'],
          discovery: { ontologyKey: 'space', triggerTerms: [] },
        },
      },
    },
    drafts: [
      { desiredEvidenceClass: 'mission_award', queryVariants: [] },
      { desiredEvidenceClass: 'launch_manifest', queryVariants: [] },
    ],
    extraText: [
      'Launch operations depend on range support contract execution when mission cadence rises.',
      'Mission support infrastructure requires task order coverage and operations staffing before launch windows can clear.',
    ],
  }, { strictEndogenousAdjacent: true });
  assert.ok(candidates.length > 0);
  const text = candidates.flatMap((candidate) => candidate.sourceTerms).join(' ');
  assert.match(text, /range support|mission support|task order|operations staffing/i);
  assert.equal(candidates.some((candidate) => candidate.lane === 'range_operations_or_ground_systems_support'), false);
});

test('strict endogenous AI corpus induces power infrastructure from source phrases only', () => {
  const { candidates } = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-strict-ai-source-test',
      reportType: 'theme_report',
      subject: {
        displayName: 'AI infrastructure',
        metadata: {
          themes: ['ai-ml'],
          discovery: { ontologyKey: 'data_center_infrastructure', triggerTerms: [] },
        },
      },
    },
    drafts: [
      { desiredEvidenceClass: 'power_constraint', queryVariants: [] },
      { desiredEvidenceClass: 'supplier_capacity', queryVariants: [] },
    ],
    extraText: [
      'AI data center deployments are constrained by interconnection queue delays and substation availability.',
      'Operators require MW capacity commitments and cooling water availability before new accelerator halls can open.',
    ],
  }, { strictEndogenousAdjacent: true });
  assert.ok(candidates.length > 0);
  const allTerms = candidates.flatMap((candidate) => candidate.sourceTerms).join(' ');
  assert.match(allTerms, /interconnection queue|substation|mw capacity|cooling water/i);
  assert.equal(candidates.some((candidate) => candidate.lane === 'power_cooling_or_utility_infrastructure'), false);
});

test('non-obvious scoring favors distant theme pairs over nearby consensus pairs', () => {
  const near = scoreThemeDistance({
    themes: ['ai-ml', 'clean-energy'],
    domains: ['ai_data_center', 'clean_energy'],
    sourceTerms: ['data center power'],
  });
  const far = scoreThemeDistance({
    themes: ['space', 'insurance'],
    domains: ['space', 'insurance_finance'],
    sourceTerms: ['launch outage insurance'],
  });
  assert.equal(far > near, true);
});

test('non-obvious scoring prefers narrow bottleneck nodes over broad narrative nodes', () => {
  const broad = scoreBottleneckSpecificity('grid interconnection queue', {
    parentSubject: 'grid interconnection queue',
    themes: ['ai-ml', 'clean-energy'],
  });
  const narrow = scoreBottleneckSpecificity('substation protection relay qualification lead time', {
    parentSubject: 'grid interconnection queue',
    themes: ['ai-ml', 'clean-energy'],
  });
  assert.equal(narrow > broad, true);
});

test('strict endogenous consensus subject echo is suppressed below narrower bottleneck nodes', () => {
  const { candidates } = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-strict-consensus-suppression-test',
      reportType: 'theme_report',
      subject: {
        displayName: 'grid interconnection queue',
        metadata: {
          themes: ['ai-ml', 'clean-energy'],
          discovery: { ontologyKey: 'data_center_infrastructure', triggerTerms: [] },
        },
      },
    },
    drafts: [
      { desiredEvidenceClass: 'power_constraint', queryVariants: [] },
      { desiredEvidenceClass: 'technical_qualification', queryVariants: [] },
    ],
    extraText: [
      'AI campuses depend on grid interconnection queue clearance before new data center halls can open.',
      'Utility projects cite substation protection relay qualification lead time as an equipment gating item.',
      'Interconnection studies require protection relay settings and certified substation automation before approval.',
    ],
  }, { strictEndogenousAdjacent: true });
  assert.ok(candidates.length > 0);
  assert.match(candidates[0].sourceTerms.join(' '), /protection relay|substation automation|qualification lead time/i);
  assert.notEqual(candidates[0].status, 'consensus_suppressed');
  assert.equal(candidates.some((candidate) => candidate.status === 'consensus_suppressed'), true);
});

test('strict endogenous broad consensus lane cannot become report-ready without source-derived frontier support', () => {
  const { candidates } = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-strict-broad-consensus-gate-test',
      reportType: 'theme_report',
      subject: {
        displayName: 'grid interconnection queue',
        metadata: {
          themes: ['ai-ml', 'clean-energy'],
          discovery: { ontologyKey: 'data_center_infrastructure', triggerTerms: [] },
        },
      },
    },
    metadata: { candidateIssuerUniverse: ['ACME', 'GRID'] },
    drafts: [{ desiredEvidenceClass: 'power_constraint', queryVariants: [] }],
    extraText: [
      'AI data centers depend on grid interconnection queue clearance before new halls can open.',
      'Power infrastructure demand requires grid interconnection queue relief across the buildout.',
    ],
  }, { strictEndogenousAdjacent: true });
  assert.ok(candidates.length > 0);
  assert.equal(candidates.some((candidate) => ADJACENT_REPORT_READY_STATUSES.includes(candidate.status)), false);
  assert.equal(candidates.every((candidate) => candidate.metadata.frontierNodeSupported === false), true);
  assert.ok(candidates.some((candidate) => ['needs_scarcity_evidence', 'consensus_suppressed'].includes(candidate.status)));
});

test('strict endogenous graph-overlap-only parent blocks child report promotion and creates parent backfill route', () => {
  const { candidates } = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-cross-theme-bottleneck-report-16384-test',
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        subjectType: 'cross_theme_candidate',
        subjectId: '16384',
        displayName: 'grid interconnection queue',
        metadata: {
          themes: ['climate-change', 'cloud-infrastructure'],
          discovery: {
            ontologyKey: 'data_center_infrastructure',
            connector: 'grid interconnection queue',
          },
        },
      },
    },
    bundle: {
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
      },
    },
    drafts: [
      { desiredEvidenceClass: 'power_constraint', queryVariants: [] },
      { desiredEvidenceClass: 'technical_qualification', queryVariants: [] },
    ],
    extraText: [
      'Data center energization requires substation protection relay qualification lead time before utility approval.',
      'Utility interconnection studies require protection relay settings and certified substation automation before approval.',
      'New MW blocks are constrained by substation automation integration capacity and specialist labor queue.',
    ],
  }, { strictEndogenousAdjacent: true });
  assert.ok(candidates.length > 0);
  assert.equal(candidates.some((candidate) => ADJACENT_REPORT_READY_STATUSES.includes(candidate.status)), false);
  assert.equal(candidates.every((candidate) => candidate.status === 'needs_parent_evidence'), true);
  assert.equal(candidates.every((candidate) => candidate.failureReason === 'parent_readiness_gap'), true);
  assert.equal(candidates.every((candidate) => candidate.metadata.parentReadyForAdjacent === false), true);
  assert.match(candidates[0].queryVariants.join(' '), /grid interconnection queue .*direct evidence official provider/i);
});

test('strict endogenous frontier node support promotes node-specific queries before broad narrative', () => {
  const { candidates } = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-strict-frontier-node-support-test',
      reportType: 'theme_report',
      subject: {
        displayName: 'grid interconnection queue',
        metadata: {
          themes: ['ai-ml', 'clean-energy'],
          discovery: { ontologyKey: 'data_center_infrastructure', triggerTerms: [] },
        },
      },
    },
    drafts: [
      { desiredEvidenceClass: 'power_constraint', queryVariants: [] },
      { desiredEvidenceClass: 'technical_qualification', queryVariants: [] },
    ],
    extraText: [
      'Data center energization requires substation protection relay qualification lead time before utility approval.',
      'Utility interconnection studies require protection relay settings and certified substation automation before approval.',
      'New MW blocks are constrained by substation automation integration capacity and specialist labor queue.',
    ],
  }, { strictEndogenousAdjacent: true });
  assert.ok(candidates.length > 0);
  const top = candidates[0];
  assert.equal(top.metadata.frontierNodeSupported, true);
  assert.equal(ADJACENT_REPORT_READY_STATUSES.includes(top.status), true);
  assert.match(top.queryVariants[0], /protection relay|substation automation|interconnection study/i);
  assert.ok(top.metadata.concreteBottleneckNodes.some((node) => node.sourceDerived));
});

test('non-obvious score exposes scarcity and consensus components', () => {
  const score = scoreNonObviousBottleneckDiscovery({
    phrase: 'launch propellant loading storage tank qualification lead time',
    sentence: 'Launch cadence depends on propellant loading storage tank qualification lead time and approved supplier capacity.',
    context: {
      themes: ['space', 'industrial materials'],
      domains: ['space', 'industrial_materials'],
      parentSubject: 'space economy',
    },
    relationSupport: 2,
    sourceDiversity: 2,
    evidenceClasses: ['technical_qualification', 'supplier_capacity'],
  });
  assert.equal(score.frontierScore > 60, true);
  assert.equal(score.scarcitySignalScore > 0.25, true);
  assert.equal(score.consensusPenalty < 0.45, true);
});

test('strict endogenous mode can induce lanes from relation graph text', () => {
  const { candidates } = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-strict-relation-graph-test',
      reportType: 'theme_report',
      subject: {
        displayName: 'Semiconductor capacity',
        metadata: {
          themes: ['semiconductor'],
          discovery: { ontologyKey: 'semiconductor', triggerTerms: [] },
        },
      },
    },
    drafts: [{ desiredEvidenceClass: 'supplier_capacity', queryVariants: [] }],
    relations: [
      {
        subject: 'semiconductor',
        relation: 'depends_on',
        object: 'advanced packaging substrate capacity',
        evidenceQuote: 'AI accelerator output depends on advanced packaging substrate capacity and supplier throughput.',
      },
      {
        subject: 'semiconductor',
        relation: 'requires',
        object: 'tooling lead time',
        evidenceQuote: 'New packaging lines require tooling lead time and qualification capacity before volume ramps.',
      },
    ],
  }, { strictEndogenousAdjacent: true });
  assert.ok(candidates.length > 0);
  assert.match(candidates.flatMap((candidate) => candidate.sourceTerms).join(' '), /advanced packaging substrate|tooling lead time|qualification capacity/i);
});

test('strict endogenous report-dir scan reads markdown and evidence table when bundle is skipped', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-strict-adjacent-'));
  try {
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
      reportId: 'RPT-strict-artifact-text-test',
      reportType: 'theme_report',
      subject: {
        displayName: 'AI infrastructure',
        metadata: { themes: ['ai-ml'], discovery: { ontologyKey: 'data_center_infrastructure' } },
      },
    }));
    await writeFile(path.join(dir, 'source-query-drafts.json'), JSON.stringify([
      { desiredEvidenceClass: 'power_constraint', queryVariants: [] },
    ]));
    await writeFile(path.join(dir, 'validation.json'), JSON.stringify({ ok: true }));
    await writeFile(path.join(dir, 'bundle.json'), JSON.stringify({ huge: 'x'.repeat(3000) }));
    await writeFile(path.join(dir, 'report.md'), [
      'AI infrastructure requires interconnection queue relief before accelerator halls can open.',
      'Operators depend on substation availability and MW capacity commitments for new campuses.',
    ].join('\n'));
    await writeFile(path.join(dir, 'evidence_table.csv'), 'id,kind,title\nE1,knowledge_edge,substation availability constrained_by ai-ml\n');
    const result = await buildAdjacentThemeCandidatesFromReportDir(dir, {
      strictEndogenousAdjacent: true,
      maxBundleBytes: 10,
    });
    assert.equal(result.context.bundleSkipped, true);
    assert.ok(result.candidates.length > 0);
    assert.match(result.candidates.flatMap((candidate) => candidate.sourceTerms).join(' '), /interconnection queue|substation availability|mw capacity/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('strict endogenous false positives stay out of generated lanes', () => {
  const broad = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-strict-ai-noise-test',
      reportType: 'theme_report',
      subject: {
        displayName: 'AI models',
        metadata: { themes: ['ai-ml'], discovery: { ontologyKey: 'ai_ml' } },
      },
    },
    drafts: [{ desiredEvidenceClass: 'supplier_capacity', queryVariants: [] }],
    extraText: [
      'A new DPM++ paper improves benchmark accuracy for metric learning and model performance.',
      'The study reports better training efficiency but does not discuss supplier capacity or infrastructure dependency.',
    ],
  }, { strictEndogenousAdjacent: true });
  assert.equal(broad.candidates.length, 0);

  const singleSource = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-strict-single-source-test',
      reportType: 'theme_report',
      subject: { displayName: 'Space Economy', metadata: { themes: ['space'], discovery: { ontologyKey: 'space' } } },
    },
    drafts: [{ desiredEvidenceClass: 'supplier_capacity', queryVariants: [] }],
    extraText: ['Launch operations require fuel farm capacity before cadence can increase.'],
  }, { strictEndogenousAdjacent: true });
  assert.ok(singleSource.candidates.length > 0);
  assert.equal(ADJACENT_REPORT_READY_STATUSES.includes(singleSource.candidates[0].status), false);
  assert.equal(singleSource.candidates[0].failureReason, 'source_coverage_gap');
});

test('strict endogenous ignores internal report/backfill boilerplate', () => {
  const result = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-strict-internal-boilerplate-test',
      reportType: 'theme_report',
      subject: { displayName: 'AI/ML', metadata: { themes: ['ai-ml'], discovery: { ontologyKey: 'ai_ml' } } },
    },
    drafts: [{ desiredEvidenceClass: 'supplier_capacity', queryVariants: [] }],
    extraText: [
      'Universal evidence contract v1 queued to backfill missing supplier capacity.',
      'Promotion requires playbook facts and an acceptable source boundary before memo upgrade.',
      'Acceptance failed search exhausted in the audit appendix evidence matrix.',
    ],
  }, { strictEndogenousAdjacent: true });
  assert.equal(result.candidates.length, 0);
  assert.match(result.diagnostics[0].nextAction, /source evidence|dependency-cue|Open-vocabulary/i);
});

test('strict endogenous ignores generic report prose without an evidence class', () => {
  const result = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-strict-generic-report-prose-test',
      reportType: 'theme_report',
      subject: { displayName: 'Theme', metadata: { themes: ['theme'], discovery: { ontologyKey: 'theme' } } },
    },
    drafts: [{ desiredEvidenceClass: 'supplier_capacity', queryVariants: [] }],
    extraText: [
      'The thesis on operating support depends on operating support and repeated analyst validation language.',
      'Operating support remains linked to operating support in the client memo and audit appendix.',
    ],
  }, { strictEndogenousAdjacent: true });
  const text = JSON.stringify(result.candidates);
  assert.doesNotMatch(text, /action bridge|nbsp/i);
  assert.equal(result.candidates.every((candidate) => candidate.status === 'consensus_suppressed'), true);
});

test('strict endogenous suppresses generic evidence-template phrases as frontier nodes', () => {
  const result = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-strict-generic-frontier-template-test',
      reportType: 'theme_report',
      subject: { displayName: 'AI/ML', metadata: { themes: ['ai-ml'], discovery: { ontologyKey: 'ai_ml' } } },
    },
    drafts: [{ desiredEvidenceClass: 'supplier_capacity', queryVariants: [] }],
    extraText: [
      'Pressure capacity utilization orders affects earnings capacity pricing and company supplier component or capacity allocation.',
      'Adoption deployment demand supply capex customers orders depends on pressure capacity utilization orders.',
    ],
  }, { strictEndogenousAdjacent: true });
  const candidateText = JSON.stringify(result.candidates);
  assert.doesNotMatch(candidateText, /action bridge|nbsp/i);
  assert.equal(result.candidates.every((candidate) => candidate.status === 'consensus_suppressed'), true);
});

test('strict endogenous suppresses rendered action bridge boilerplate', () => {
  const result = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-strict-rendered-action-bridge-test',
      reportType: 'cross_theme_bottleneck_report',
      subject: { displayName: 'solid rocket motor capacity', metadata: { themes: ['space'], discovery: { ontologyKey: 'space' } } },
    },
    drafts: [{ desiredEvidenceClass: 'technical_qualification', queryVariants: [] }],
    extraText: [
      'Technical Qualification action bridge test qualification site nbsp bridge technical qualification action.',
      'Issuer Exposure action bridge and Mechanism Validation action bridge are audit sections.',
    ],
  }, { strictEndogenousAdjacent: true });
  const candidateText = JSON.stringify(result.candidates);
  assert.doesNotMatch(candidateText, /action bridge|nbsp/i);
  assert.equal(result.candidates.every((candidate) => candidate.status === 'consensus_suppressed'), true);
});

test('concrete bottleneck decomposer turns abstract permitting into collection nodes', () => {
  const nodes = deriveConcreteBottleneckNodes({
    phrase: 'subsidy permitting cycle',
    sourceTerms: ['subsidy permitting cycle', 'interconnection queue capacity'],
    context: {
      parentSubject: 'clean energy bottleneck',
      ontologyKey: 'clean_energy',
      themes: ['clean-energy'],
      corpus: 'Clean energy deployment is constrained by interconnection queue delays and permitting cycle time.',
    },
    evidenceClasses: ['policy_funding', 'supplier_capacity'],
  });
  const names = nodes.map((node) => node.node);
  assert.ok(names.includes('permit queue processing capacity'));
  assert.ok(names.includes('interconnection study capacity'));
  assert.ok(nodes.every((node) => node.status === 'probe_needs_evidence'));
});

test('concrete bottleneck decomposer does not treat generic range wording as launch support', () => {
  const nodes = deriveConcreteBottleneckNodes({
    phrase: 'transformer',
    sourceTerms: ['transformer lead time', 'range of delivery outcomes'],
    context: {
      parentSubject: 'transformer',
      themes: ['clean-energy', 'supply-chain-security'],
      corpus: 'Transformer delivery lead time has a wide range of outcomes across utility projects.',
    },
    evidenceClasses: ['supplier_capacity'],
  });
  assert.equal(nodes.some((node) => node.key === 'range_or_ground_support_capacity'), false);
  assert.equal(nodes.some((node) => node.key === 'substation_equipment_lead_time'), true);
});

test('issuer candidates remain unverified until exposure evidence exists', () => {
  const { candidates } = buildAdjacentThemeCandidatesFromArtifact(srmArtifact({
    issuerCandidates: [
      { label: 'Linde', symbol: 'LIN', evidence: 'source title mentioned industrial gas supplier' },
    ],
    drafts: [
      {
        desiredEvidenceClass: 'supplier_capacity',
        queryVariants: [
          'launch vehicle fueling infrastructure industrial gas supplier annual report cryogenic hydrogen helium',
        ],
      },
    ],
  }));
  const candidate = candidates.find((item) => item.lane === 'launch_fueling_or_cryogenic_infrastructure');
  assert.ok(candidate);
  assert.equal(candidate.issuerCandidates[0].label, 'Linde');
  assert.equal(candidate.issuerCandidates[0].status, 'issuer_candidate_unverified');
  assert.equal(candidate.metadata.issuerPromotionAllowed, false);
  assert.equal(Object.hasOwn(candidate, 'symbols'), false);
});

test('source coverage gaps produce class-specific next action instead of query repetition', () => {
  const { candidates } = buildAdjacentThemeCandidatesFromArtifact({
    manifest: {
      reportId: 'RPT-space-gap-test',
      reportType: 'theme_report',
      subject: {
        displayName: 'launch vehicle capacity',
        metadata: {
          themes: ['space'],
          discovery: {
            ontologyKey: 'space',
            triggerTerms: ['launch manifest'],
          },
        },
      },
    },
    drafts: [
      { desiredEvidenceClass: 'launch_manifest', queryVariants: ['launch manifest cadence'] },
    ],
  });
  const candidate = candidates.find((item) => item.failureReason === 'source_coverage_gap');
  assert.ok(candidate);
  assert.match(candidate.nextAction, /source-query|provider|collection/i);
  assert.ok(candidate.queryVariants.length > 0);
});

test('cryogenic adjacent queries decouple from solid rocket parent subject', () => {
  const { candidates } = buildAdjacentThemeCandidatesFromArtifact(srmArtifact());
  const candidate = candidates.find((item) => item.lane === 'launch_fueling_or_cryogenic_infrastructure');
  assert.ok(candidate);
  assert.match(candidate.queryVariants.join(' '), /cryogenic|LOX|liquid oxygen|hydrogen|helium/i);
  assert.doesNotMatch(candidate.queryVariants[0], /solid rocket motor/i);
  assert.match(candidate.queryVariants[0], /space launch fueling/i);
});

test('range operations adjacent queries decouple from solid rocket parent subject', () => {
  const { candidates } = buildAdjacentThemeCandidatesFromArtifact(srmArtifact());
  const candidate = candidates.find((item) => item.lane === 'range_operations_or_ground_systems_support');
  assert.ok(candidate);
  assert.match(candidate.queryVariants.join(' '), /range operations|ground systems|mission support/i);
  assert.doesNotMatch(candidate.queryVariants[0], /solid rocket motor/i);
  assert.match(candidate.queryVariants[0], /space launch range operations/i);
});

test('adjacent candidates enqueue report-scoped source-query backfill tasks', async () => {
  const { candidates } = buildAdjacentThemeCandidatesFromArtifact(srmArtifact());
  const candidate = candidates.find((item) => item.lane === 'launch_fueling_or_cryogenic_infrastructure');
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: calls.length }] };
    },
  };
  const result = await enqueueAdjacentCandidateSourceQueries(client, [candidate], { limit: 1, perCandidateLimit: 1 });
  assert.equal(result.insertedCount, 1);
  assert.match(calls[0].sql, /report_backfill_tasks/);
  const metadata = JSON.parse(calls[0].params[5]);
  assert.equal(metadata.collectionKind, 'adjacent_theme_candidate');
  assert.equal(metadata.createdBy, 'report-adjacent-expansion');
  assert.notEqual(metadata.providerRoutePlan.providerRoute, 'adjacent_lane_source_query');
  assert.equal(metadata.providerRoutePlan.executableCollectors.includes('source-query'), true);
  assert.equal(metadata.providerRoutePlan.sourceProviders.length > 0, true);
});

test('adjacent source-query enqueue assigns contract queries to mission/procurement lanes', async () => {
  const { candidates } = buildAdjacentThemeCandidatesFromArtifact(srmArtifact());
  const candidate = candidates.find((item) => item.lane === 'range_operations_or_ground_systems_support');
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: calls.length }] };
    },
  };

  const result = await enqueueAdjacentCandidateSourceQueries(client, [candidate], { limit: 1, perCandidateLimit: 1 });

  assert.equal(result.insertedCount, 1);
  assert.match(calls[0].params[2], /mission_award|procurement_trigger/);
  const metadata = JSON.parse(calls[0].params[5]);
  assert.ok(['mission_award', 'procurement_trigger'].includes(metadata.desiredEvidenceClass));
  assert.ok(metadata.providerRoutePlan.sourceProviders.some((provider) => /government|usaspending|dod/.test(provider)));
});

test('adjacent enqueue repairs weak source-query-only tasks into provider-routed tasks', async () => {
  const candidate = {
    candidateKey: 'endogenous-frontier-parent-1-interconnection-study-capacity',
    parentReportId: 'frontier-parent-1',
    parentSubject: 'transformer',
    lane: 'generated_interconnection-study-capacity',
    label: 'interconnection study capacity',
    status: 'needs_scarcity_evidence',
    queryVariants: ['interconnection study capacity lead time backlog qualification official evidence'],
    evidenceClasses: ['supplier_capacity'],
    confidenceScore: 82,
    sourceTerms: ['interconnection study capacity'],
    seedTerms: [],
    metadata: {
      frontierDiscovery: true,
      generatedLane: true,
      discoveryNamespace: 'strict_endogenous_adjacent',
      parentThemes: ['clean-energy', 'cloud-infrastructure'],
    },
  };
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/INSERT INTO report_backfill_tasks/.test(sql)) return { rows: [] };
      if (/UPDATE report_backfill_tasks/.test(sql)) return { rows: [{ id: 99 }] };
      return { rows: [] };
    },
  };

  const result = await enqueueAdjacentCandidateSourceQueries(client, [candidate], { limit: 1, perCandidateLimit: 1 });

  assert.equal(result.insertedCount, 0);
  assert.equal(result.repairedCount, 1);
  const updateCall = calls.find((call) => /UPDATE report_backfill_tasks/.test(call.sql));
  assert.ok(updateCall);
  const metadata = JSON.parse(updateCall.params[4]);
  assert.notEqual(metadata.providerRoutePlan.providerRoute, 'adjacent_lane_source_query');
  assert.equal(metadata.providerRoutePlan.executableCollectors.includes('source-query'), true);
  assert.equal(metadata.providerRoutePlan.executableCollectors.some((collector) => collector !== 'source-query'), true);
});

test('strict endogenous report result cannot stay review-ready without direct evidence bridge', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'adjacent-review-gate-'));
  try {
    await writeFile(path.join(dir, 'bundle.json'), JSON.stringify({
      metadata: {
        strictEndogenousAdjacent: true,
        issuerBridgeSummary: {
          candidateIssuerCount: 2,
          bridgeAttachedCount: 0,
          marketAttachedCount: 0,
        },
        deepResearch: {
          investmentReadiness: {
            marketValidation: {
              tier: 'missing',
              missingReason: 'no_direct_issuer_bridge',
              rowCount: 0,
            },
          },
          reportClosureLedger: { counts: { provider_rate_limited: 0, pending: 0 } },
          packs: {
            evidenceClassExtractionPack: {
              rows: [{
                evidenceClass: 'mechanism_validation',
                evidenceUse: 'promotion_candidate',
                symbol: null,
              }],
            },
          },
        },
      },
    }));
    const calls = [];
    const client = {
      async query(sql, params = []) {
        calls.push({ sql, params });
        if (/SELECT candidate_key, status, failure_reason, metadata/i.test(sql)) {
          return {
            rows: [{
              candidate_key: 'endogenous-adjacent-test',
              status: 'review_ready',
              failure_reason: 'source_coverage_gap',
              metadata: {
                discoveryNamespace: 'strict_endogenous_adjacent',
                frontierDiscovery: true,
                relationSupport: 1,
                sourceDiversity: 1,
              },
            }],
          };
        }
        if (/UPDATE adjacent_theme_candidates/i.test(sql)) {
          return { rows: [{ candidate_key: params[0], status: params[1], next_action: params[2] }] };
        }
        return { rows: [] };
      },
    };
    const result = await recordAdjacentDeepReportResult(client, {
      candidateKey: 'endogenous-adjacent-test',
      reportDir: dir,
      ok: true,
      grade: 'B',
      publishable: true,
      quality: { grade: 'B', publishable: true },
    });
    assert.equal(result.rows[0].status, 'needs_scarcity_evidence');
    const update = calls.find((call) => /UPDATE adjacent_theme_candidates/i.test(call.sql));
    assert.equal(update.params[1], 'needs_scarcity_evidence');
    assert.equal(update.params[5], false);
    const latest = JSON.parse(update.params[3]);
    assert.equal(latest.gate.reviewAllowed, false);
    assert.equal(latest.gate.failureReason, 'source_coverage_gap');
    assert.equal(latest.gate.gateReason, 'no_direct_issuer_bridge');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('recursive adjacent-derived candidates are quarantined during evidence reconciliation', () => {
  assert.equal(isRecursiveAdjacentCandidateKey('adjacent-adjacent-space-material-supply-or-substitution'), true);
  assert.equal(isRecursiveAdjacentCandidateKey('adjacent-endogenous-adjacent-16384-generated-grid-interconnection-queue-power-cooling'), true);
  assert.equal(isRecursiveAdjacentCandidateKey('endogenous-frontier-parent-242-utility-service-upgrade-queue'), false);
  const status = adjacentStatusFromSourceQueryClosure({
    candidate_key: 'adjacent-adjacent-space-material-supply-or-substitution',
    context_count: 5,
    confidence_score: 92,
    source_diversity: 3,
    relation_support: 3,
    parent_ready_for_adjacent: true,
  });
  assert.equal(status, 'needs_fix');
});
