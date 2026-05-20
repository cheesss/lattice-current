import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildFrontierParentBackfillTasks,
  reviewFrontierReportContent,
  selectFrontierParentCandidates,
} from '../scripts/run-frontier-parent-quality-loop.mjs';

test('frontier parent loop suppresses issuer roots and selects narrow bottleneck parents', () => {
  const rows = [
    {
      id: 1,
      label: 'Known Power Equipment Issuer',
      supplier_type: 'company',
      themes: ['ai-ml', 'cloud-infrastructure'],
      score: 1,
      lane: 'validated',
      status: 'new',
      evidence_summary: {
        parentReadyForAdjacent: true,
        parentReadinessState: 'parent_frontier_ready',
        sourceDiversityRaw: 3,
        nonObviousDiscovery: {
          frontierScore: 90,
          bottleneckSpecificityScore: 0.7,
          scarcitySignalScore: 0.6,
          themeDistanceScore: 0.7,
          surpriseScore: 0.7,
        },
      },
      metadata: { role: 'supplier' },
    },
    {
      id: 2,
      label: 'protection relay qualification lead time',
      connector_type: 'component',
      themes: ['ai-ml', 'grid-reliability'],
      score: 0.7,
      lane: 'needs_evidence',
      status: 'new',
      evidence_summary: {
        parentReadyForAdjacent: true,
        parentReadinessState: 'parent_frontier_ready',
        sourceDiversityRaw: 3,
        nonObviousDiscovery: {
          frontierScore: 74,
          bottleneckSpecificityScore: 0.66,
          scarcitySignalScore: 0.5,
          themeDistanceScore: 0.68,
          surpriseScore: 0.72,
        },
      },
      metadata: { role: 'connector' },
    },
  ];

  const result = selectFrontierParentCandidates(rows, { parentLimit: 1 });
  assert.equal(result.selected[0].label, 'protection relay qualification lead time');
  assert.equal(result.selected[0].frontierParent.frontierParentReportReady, true);
  assert.equal(result.candidates.find((item) => item.id === 1).frontierParent.frontierParentState, 'consensus_issuer_suppressed');
});

test('external report review does not accept internal S without direct evidence and market bridge', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'frontier-review-'));
  try {
    await writeFile(path.join(dir, 'report.md'), [
      '# Frontier report',
      'Known narrative suppressed. Frontier bottleneck node: protection relay qualification lead time.',
      'Scarcity test: lead time and qualification are mentioned.',
      'Investment memo candidate.',
    ].join('\n'));
    await writeFile(path.join(dir, 'validation.json'), JSON.stringify({ quality: { grade: 'S', blockers: [] } }));
    const review = reviewFrontierReportContent({
      reportDir: dir,
      candidate: { frontierParent: { frontierParentScore: 0.8 } },
    });
    assert.equal(review.hedgeFundReady, false);
    assert.equal(review.externalGrade === 'S', false);
    assert.equal(review.missing.includes('direct_operating_evidence_insufficient'), true);
    assert.equal(review.missing.includes('controlled_market_validation_insufficient'), true);
    assert.equal(review.missing.includes('headline_overstates_investment_readiness'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('frontier parent selector cools down failed parents and advances to the next node', () => {
  const rows = [
    {
      id: 1,
      label: 'high-voltage switchgear',
      connector_type: 'component',
      themes: ['climate-change', 'cloud-infrastructure'],
      score: 0.8,
      lane: 'needs_evidence',
      status: 'new',
      evidence_summary: {
        frontierParentCollectionEligible: true,
        frontierParentScore: 0.72,
        nonObviousDiscovery: { bottleneckSpecificityScore: 0.76, scarcitySignalScore: 0.44, themeDistanceScore: 0.68, surpriseScore: 0.74 },
      },
      metadata: { role: 'connector' },
    },
    {
      id: 2,
      label: 'electrical steel',
      connector_type: 'material',
      themes: ['climate-change', 'cloud-infrastructure'],
      score: 0.7,
      lane: 'needs_evidence',
      status: 'new',
      evidence_summary: {
        frontierParentCollectionEligible: true,
        frontierParentScore: 0.7,
        nonObviousDiscovery: { bottleneckSpecificityScore: 0.74, scarcitySignalScore: 0.46, themeDistanceScore: 0.66, surpriseScore: 0.7 },
      },
      metadata: { role: 'connector' },
    },
  ];
  const state = {
    parents: {
      'component::high-voltage switchgear': {
        cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
      },
    },
  };

  const result = selectFrontierParentCandidates(rows, { parentLimit: 1, state });
  assert.equal(result.cooldownCount, 1);
  assert.equal(result.selected[0].label, 'electrical steel');
});

test('frontier parent selector decomposes broad parents before report generation', () => {
  const rows = [
    {
      id: 240,
      deterministic_id: 'parent-transformers',
      label: 'transformers',
      connector_type: 'component',
      themes: ['ai-ml', 'cloud-infrastructure'],
      score: 0.89,
      lane: 'validated',
      status: 'new',
      reason: 'transformers is a connector candidate through shared dependency graph overlap.',
      edge_evidence: [
        {
          quote: 'Data center load growth is constrained by transformer lead time and substation equipment backlog.',
          relation_type: 'constrained_by',
          source_type: 'knowledge_edge_evidence',
        },
      ],
      evidence_summary: {
        parentReadyForAdjacent: true,
        parentReadinessState: 'parent_frontier_ready',
        sourceDiversityRaw: 3,
        directEvidenceCount: 12,
        nonObviousDiscovery: {
          frontierScore: 47,
          bottleneckSpecificityScore: 0.28,
          scarcitySignalScore: 0,
          themeDistanceScore: 0.68,
          surpriseScore: 0.57,
        },
      },
      metadata: { role: 'connector' },
    },
  ];

  const result = selectFrontierParentCandidates(rows, { parentLimit: 1 });
  assert.equal(result.decomposedCount > 0, true);
  assert.equal(result.selected[0].decomposedFromParent.label, 'transformers');
  assert.match(result.selected[0].label, /transformer|substation/i);
  assert.match(result.selected[0].reportSubjectKey, /^endogenous-frontier-parent-240-/);
  assert.notEqual(result.selected[0].label, 'transformers');
});

test('frontier parent decomposition filters ambiguous transformer model evidence', () => {
  const rows = [
    {
      id: 28681,
      deterministic_id: 'parent-transformer',
      label: 'transformer',
      connector_type: 'component',
      themes: ['clean-energy', 'supply-chain-security'],
      score: 0.65,
      lane: 'watch',
      status: 'new',
      reason: 'transformer is a connector candidate.',
      edge_evidence: [
        { quote: 'Vision Transformers achieve state-of-the-art performance in text-to-image generation.' },
        { quote: 'U.S. transformer market faces severe supply constraints for utility grid projects.' },
      ],
      evidence_summary: {
        parentReadyForAdjacent: true,
        parentReadinessState: 'parent_frontier_ready',
        sourceDiversityRaw: 2,
        directEvidenceCount: 2,
        nonObviousDiscovery: {
          frontierScore: 48,
          bottleneckSpecificityScore: 0.3,
          scarcitySignalScore: 0,
          themeDistanceScore: 0.7,
          surpriseScore: 0.6,
        },
      },
      metadata: { role: 'connector' },
    },
  ];

  const result = selectFrontierParentCandidates(rows, { parentLimit: 1 });
  const quotes = result.selected[0].adjacentCandidate.metadata.evidenceQuotes.join(' ');
  const sourceTerms = result.selected[0].adjacentCandidate.metadata.sourceTerms.join(' ');
  assert.doesNotMatch(quotes, /Vision Transformers|text-to-image/i);
  assert.doesNotMatch(sourceTerms, /Vision Transformers|text-to-image/i);
  assert.match(quotes, /utility grid|transformer market/i);
});

test('frontier parent selector does not promote academic-only decomposed nodes to report-ready', () => {
  const rows = [
    {
      id: 33775,
      deterministic_id: 'academic-semiconductor',
      label: 'semiconductor',
      connector_type: 'technology',
      themes: ['conducting-polymers-and-applications', 'covalent-organic-framework-applications'],
      score: 0.79,
      lane: 'watch',
      status: 'new',
      reason: 'Semiconductor appears in academic materials evidence.',
      edge_evidence: [
        {
          quote: 'In light of transition metal dichalcogenides as 2D semiconductors for device applications, band engineering becomes important.',
          url: 'https://arxiv.org/abs/2605.13637v1',
          source_type: 'article',
          relation_type: 'requires',
        },
      ],
      evidence_summary: {
        parentReadyForAdjacent: true,
        parentReadinessState: 'parent_frontier_ready',
        sourceDiversityRaw: 7,
        directEvidenceCount: 21,
        nonObviousDiscovery: {
          frontierScore: 35,
          bottleneckSpecificityScore: 0.04,
          scarcitySignalScore: 0,
          themeDistanceScore: 0.68,
          surpriseScore: 0.49,
        },
      },
      metadata: { role: 'connector' },
    },
  ];

  const result = selectFrontierParentCandidates(rows, { parentLimit: 3 });
  assert.equal(result.reportReadyCount, 0);
  assert.equal(result.selected[0].frontierParent.frontierParentReportReady, false);
  assert.match(result.selected[0].frontierParent.frontierParentState, /needs|broad|graph/i);
});

test('frontier parent selector requires commercial evidence before academic-domain financial risk nodes are report-ready', () => {
  const rows = [
    {
      id: 33775,
      deterministic_id: 'academic-semiconductor-risk',
      label: 'semiconductor',
      connector_type: 'technology',
      themes: ['conducting-polymers-and-applications', 'covalent-organic-framework-applications'],
      score: 0.82,
      lane: 'watch',
      status: 'new',
      reason: 'Semiconductor appears in academic materials evidence.',
      edge_evidence: [
        {
          quote: 'Semiconductor warranty claims and risk-transfer capacity may constrain commercialization timelines.',
          source_type: 'article',
          relation_type: 'constrained_by',
        },
      ],
      evidence_summary: {
        parentReadyForAdjacent: true,
        parentReadinessState: 'parent_frontier_ready',
        sourceDiversityRaw: 4,
        directEvidenceCount: 4,
        nonObviousDiscovery: {
          frontierScore: 72,
          bottleneckSpecificityScore: 0.7,
          scarcitySignalScore: 0.5,
          themeDistanceScore: 0.8,
          surpriseScore: 0.8,
        },
      },
      metadata: { role: 'connector' },
    },
  ];

  const result = selectFrontierParentCandidates(rows, { parentLimit: 1 });
  assert.equal(result.reportReadyCount, 0);
  assert.equal(result.selected[0].frontierParent.frontierParentReportReady, false);
  assert.match(result.selected[0].frontierParent.frontierParentReason, /academic_only_parent_needs_commercial_evidence/i);
});

test('frontier parent selector excludes previously generated adjacent themes as top-level parents', () => {
  const rows = [
    {
      id: 55378,
      label: 'hydrogen',
      connector_type: 'material',
      themes: ['space', 'adjacent-16776-launch-fueling-or-cryogenic-infrastructure'],
      score: 0.9,
      lane: 'validated',
      status: 'new',
      evidence_summary: {
        parentReadyForAdjacent: true,
        parentReadinessState: 'parent_frontier_ready',
        sourceDiversityRaw: 3,
        directEvidenceCount: 6,
        nonObviousDiscovery: { frontierScore: 70, bottleneckSpecificityScore: 0.5, scarcitySignalScore: 0.3 },
      },
      metadata: { role: 'connector' },
    },
    {
      id: 2,
      label: 'switchgear testing and delivery capacity',
      connector_type: 'component',
      themes: ['ai-ml', 'grid-reliability'],
      score: 0.7,
      lane: 'needs_evidence',
      status: 'new',
      evidence_summary: {
        parentReadyForAdjacent: true,
        parentReadinessState: 'parent_frontier_ready',
        sourceDiversityRaw: 3,
        nonObviousDiscovery: { frontierScore: 74, bottleneckSpecificityScore: 0.66, scarcitySignalScore: 0.5 },
      },
      metadata: { role: 'connector' },
    },
  ];
  const result = selectFrontierParentCandidates(rows, { parentLimit: 1 });
  assert.equal(result.candidates.find((item) => item.id === 55378).frontierParent.frontierParentState, 'derived_adjacent_parent_excluded');
  assert.equal(result.selected[0].label, 'switchgear testing and delivery capacity');
});

test('frontier parent selector does not repeat cooled ready parents when active pool has no actionable candidate', () => {
  const rows = [
    {
      id: 1,
      label: 'specialist test fixture lead time',
      connector_type: 'process',
      themes: ['space', 'defense-industrial'],
      score: 0.8,
      lane: 'validated',
      status: 'new',
      evidence_summary: {
        parentReadyForAdjacent: true,
        parentReadinessState: 'parent_frontier_ready',
        sourceDiversityRaw: 3,
        directEvidenceCount: 3,
        nonObviousDiscovery: { frontierScore: 82, bottleneckSpecificityScore: 0.7, scarcitySignalScore: 0.6 },
      },
      metadata: { role: 'connector' },
    },
    {
      id: 2,
      label: 'broad graph overlap',
      connector_type: 'concept',
      themes: ['macro', 'cloud-infrastructure'],
      score: 0.2,
      lane: 'watch',
      status: 'new',
      evidence_summary: {
        parentReadyForAdjacent: false,
        parentReadinessState: 'graph_overlap_only',
        nonObviousDiscovery: { frontierScore: 10 },
      },
      metadata: { role: 'connector' },
    },
  ];
  const state = {
    parents: {
      'process::specialist test fixture lead time': {
        cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
      },
    },
  };
  const result = selectFrontierParentCandidates(rows, { parentLimit: 1, state });
  assert.equal(result.selected.length, 0);
  assert.equal(result.reportReadyCount, 0);
  assert.equal(result.cooldownCount, 1);
});

test('frontier parent selector immediately reconsiders nodes after backfill-only attempts', () => {
  const rows = [{
    id: 1,
    label: 'qualification test facility capacity',
    connector_type: 'test_or_certification_process',
    themes: ['space', 'defense-industrial'],
    score: 0.8,
    lane: 'validated',
    status: 'new',
    evidence_summary: {
      parentReadyForAdjacent: true,
      parentReadinessState: 'parent_frontier_ready',
      sourceDiversityRaw: 3,
      directEvidenceCount: 3,
      nonObviousDiscovery: {
        frontierScore: 82,
        bottleneckSpecificityScore: 0.74,
        scarcitySignalScore: 0.62,
        themeDistanceScore: 0.76,
        surpriseScore: 0.72,
      },
    },
    metadata: { role: 'connector' },
  }];
  const state = {
    parents: {
      'test_or_certification_process::qualification test facility capacity': {
        cooldownUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        lastNextAction: 'execute_node_specific_backfill_then_reselect_frontier_parent',
      },
    },
  };

  const result = selectFrontierParentCandidates(rows, { parentLimit: 1, state });

  assert.equal(result.cooldownCount, 0);
  assert.equal(result.selected[0].label, 'qualification test facility capacity');
});

test('frontier parent selector prefers ready decomposed child over the broad original parent', () => {
  const rows = [
    {
      id: 56299,
      deterministic_id: 'parent-transformer',
      label: 'transformer',
      connector_type: 'component',
      themes: ['clean-energy', 'supply-chain-security'],
      score: 0.8,
      lane: 'validated',
      status: 'new',
      reason: 'Transformer constraints mention substation equipment lead time.',
      edge_evidence: [
        { quote: 'Utility grid projects depend on substation equipment lead time and transformer backlog.' },
      ],
      evidence_summary: {
        parentReadyForAdjacent: true,
        parentReadinessState: 'parent_frontier_ready',
        sourceDiversityRaw: 3,
        directEvidenceCount: 3,
        nonObviousDiscovery: { frontierScore: 70, bottleneckSpecificityScore: 0.5, scarcitySignalScore: 0.5 },
      },
      metadata: { role: 'connector' },
    },
  ];
  const result = selectFrontierParentCandidates(rows, { parentLimit: 3 });
  assert.ok(result.selected.some((candidate) => candidate.label === 'substation equipment lead time'));
  assert.equal(result.selected.some((candidate) => candidate.label === 'transformer'), false);
});

test('frontier parent selector reconciles provider-backed promotion evidence into report readiness', () => {
  const rows = [
    {
      id: 28681,
      deterministic_id: 'parent-transformer',
      label: 'transformer',
      connector_type: 'component',
      themes: ['clean-energy', 'supply-chain-security'],
      score: 0.8,
      lane: 'validated',
      status: 'new',
      reason: 'Transformer is broad and must be decomposed before a report.',
      edge_evidence: [],
      evidence_summary: {
        parentReadyForAdjacent: true,
        parentReadinessState: 'parent_frontier_ready',
        sourceDiversityRaw: 0,
        directEvidenceCount: 0,
        nonObviousDiscovery: { frontierScore: 45, bottleneckSpecificityScore: 0.3, scarcitySignalScore: 0.05 },
      },
      metadata: { role: 'connector' },
    },
  ];
  const providerEvidenceByCandidateKey = new Map([
    ['endogenous-frontier-parent-28681-substation-equipment-lead-time', {
      promotionEvidenceCount: 2,
      contextEvidenceCount: 1,
      sourceDiversityRaw: 2,
      providers: ['doe', 'lbl-emp'],
      promotionEvidenceClasses: ['supplier_capacity'],
      desiredEvidenceClasses: ['supplier_capacity'],
    }],
  ]);

  const result = selectFrontierParentCandidates(rows, { parentLimit: 1, providerEvidenceByCandidateKey });

  assert.equal(result.reportReadyCount > 0, true);
  assert.equal(result.selected[0].label, 'substation equipment lead time');
  assert.equal(result.selected[0].frontierParent.frontierParentReportReady, true);
  assert.equal(result.selected[0].metadata.providerBackfillSupported, true);
  assert.equal(result.selected[0].evidenceSummary.providerBackfillPromotionEvidenceCount, 2);
});

test('frontier parent selector does not use context-only provider evidence for report readiness', () => {
  const rows = [
    {
      id: 28681,
      deterministic_id: 'parent-transformer',
      label: 'transformer',
      connector_type: 'component',
      themes: ['clean-energy', 'supply-chain-security'],
      score: 0.8,
      lane: 'validated',
      status: 'new',
      reason: 'Transformer is broad and must be decomposed before a report.',
      edge_evidence: [],
      evidence_summary: {
        parentReadyForAdjacent: true,
        parentReadinessState: 'parent_frontier_ready',
        sourceDiversityRaw: 0,
        directEvidenceCount: 0,
        nonObviousDiscovery: { frontierScore: 45, bottleneckSpecificityScore: 0.3, scarcitySignalScore: 0.05 },
      },
      metadata: { role: 'connector' },
    },
  ];
  const providerEvidenceByCandidateKey = new Map([
    ['endogenous-frontier-parent-28681-substation-equipment-lead-time', {
      promotionEvidenceCount: 0,
      contextEvidenceCount: 5,
      sourceDiversityRaw: 3,
      providers: ['doe', 'eia', 'govinfo'],
      promotionEvidenceClasses: [],
      contextEvidenceClasses: ['supplier_capacity'],
      desiredEvidenceClasses: ['supplier_capacity'],
    }],
  ]);

  const result = selectFrontierParentCandidates(rows, { parentLimit: 1, providerEvidenceByCandidateKey });

  assert.equal(result.reportReadyCount, 0);
  assert.equal(result.selected[0].frontierParent.frontierParentReportReady, false);
  assert.equal(result.selected[0].metadata.providerBackfillSupported, false);
});

test('frontier parent backfill tasks bind graph-overlap parent evidence to the parent candidate id', () => {
  const tasks = buildFrontierParentBackfillTasks({
    id: 16792,
    label: 'radiation-hardened electronics',
    connector_type: 'component',
    themes: ['defense-industrial', 'space'],
    edgeEvidence: [
      { title: 'Space systems require radiation hardened electronics qualification testing.' },
    ],
    evidenceSummary: {
      discovery: { triggerTerms: ['radiation hardened electronics', 'space systems'] },
    },
    frontierParent: {
      frontierParentState: 'graph_overlap_only',
      frontierParentReason: 'graph_overlap_without_direct_or_provider_evidence',
      frontierParentScore: 0.537,
    },
  }, { totalLimit: 4, perClassLimit: 1 });

  assert.equal(tasks.length > 0, true);
  assert.equal(tasks[0].subjectKey, '16792');
  assert.equal(tasks[0].metadata.candidateId, '16792');
  assert.equal(tasks[0].metadata.reportType, 'cross_theme_bottleneck_report');
  assert.equal(tasks[0].metadata.subject.subjectType, 'cross_theme_candidate');
  assert.equal(tasks[0].metadata.providerRoutePlan.discoveryNamespace, 'strict_endogenous_frontier_parent');
  assert.equal(tasks.some((task) => task.metadata.desiredEvidenceClass === 'market_validation'), false);
});
