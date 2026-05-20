import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildThemeTaxonomyGraphSeed,
  isReviewLockedCandidateStatus,
  RESEARCH_OS_ALLOWED_WRITE_TABLES,
  RESEARCH_OS_FORBIDDEN_AUTO_WRITE_TABLES,
  REVIEW_LOCKED_CANDIDATE_STATUSES,
} from '../scripts/_shared/adjacency-graph.mjs';
import { scoreCrossThemeConnectors } from '../scripts/_shared/cross-theme-adjacency.mjs';
import { evaluateFrontierParentCandidate } from '../scripts/_shared/frontier-parent-selection.mjs';
import { runAutoresearchHarnessRound } from '../scripts/_shared/autoresearch-harness.mjs';
import { buildIncomingResearchSignalsFromRows } from '../scripts/_shared/incoming-connection-miner.mjs';
import { loadResearchOsPolicy } from '../scripts/_shared/research-os-policy.mjs';
import { generateResearchQuestions } from '../scripts/_shared/research-question-generator.mjs';
import { buildRelationsFromEvidenceBundle, validateExtractedRelations } from '../scripts/_shared/relation-extractor.mjs';
import { extractRelationsWithApiLlm, shouldUseApiLlm } from '../scripts/_shared/llm-relation-provider.mjs';
import { planSourceExpansion } from '../scripts/_shared/source-expansion-planner.mjs';
import {
  buildSourceQueryQuestionPayload,
  buildSourceQueryRetryVariants,
  filterAndScoreSourceQueryBundles,
  isInvalidSourceQueryApproval,
  parseExternalRssItems,
  approvePendingSourceQueries,
  repairSourceQueryApprovalPayload,
  scoreSourceQueryBundle,
  sourceQueryApprovalBlocker,
} from '../scripts/_shared/source-query-executor.mjs';
import { buildPolicyAdvisorProposals } from '../scripts/_shared/policy-advisor.mjs';
import { evaluateTrustedPromotion } from '../scripts/_shared/trusted-graph-promotion.mjs';

function fixtureGraph() {
  const nodes = [
    { id: 'theme:space', nodeType: 'theme', canonicalName: 'space', normalizedKey: 'space' },
    { id: 'theme:quantum-computing', nodeType: 'theme', canonicalName: 'quantum-computing', normalizedKey: 'quantum-computing' },
    { id: 'theme:fusion-energy', nodeType: 'theme', canonicalName: 'fusion-energy', normalizedKey: 'fusion-energy' },
    { id: 'component:cryogenic-cooling', nodeType: 'component', canonicalName: 'Cryogenic Cooling', normalizedKey: 'cryogenic-cooling' },
    { id: 'material:helium-3', nodeType: 'material', canonicalName: 'Helium-3', normalizedKey: 'helium-3' },
    { id: 'component:vacuum-systems', nodeType: 'component', canonicalName: 'Vacuum Systems', normalizedKey: 'vacuum-systems' },
    { id: 'company:linde', nodeType: 'company', canonicalName: 'Linde', normalizedKey: 'linde' },
    { id: 'company:oxford-instruments', nodeType: 'company', canonicalName: 'Oxford Instruments', normalizedKey: 'oxford-instruments' },
  ];
  const edges = [
    { sourceId: 'theme:space', targetId: 'component:cryogenic-cooling', relationType: 'requires', confidence: 0.8, evidenceCount: 3, sourceDiversity: 3 },
    { sourceId: 'theme:quantum-computing', targetId: 'component:cryogenic-cooling', relationType: 'requires', confidence: 0.85, evidenceCount: 3, sourceDiversity: 3 },
    { sourceId: 'component:cryogenic-cooling', targetId: 'material:helium-3', relationType: 'uses', confidence: 0.65, evidenceCount: 2, sourceDiversity: 2 },
    { sourceId: 'component:cryogenic-cooling', targetId: 'company:linde', relationType: 'supplies', confidence: 0.55, evidenceCount: 1, sourceDiversity: 1 },
    { sourceId: 'theme:fusion-energy', targetId: 'component:vacuum-systems', relationType: 'requires', confidence: 0.82, evidenceCount: 3, sourceDiversity: 3 },
    { sourceId: 'theme:quantum-computing', targetId: 'component:vacuum-systems', relationType: 'requires', confidence: 0.78, evidenceCount: 2, sourceDiversity: 2 },
    { sourceId: 'component:vacuum-systems', targetId: 'company:oxford-instruments', relationType: 'supplies', confidence: 0.6, evidenceCount: 2, sourceDiversity: 2 },
  ];
  return { nodes, edges };
}

test('research OS policy is loaded from config and exposes autonomy guardrails', () => {
  const policy = loadResearchOsPolicy();
  assert.equal(policy.seedSimilarityWeightMax <= 0.2, true);
  assert.equal(policy.explorationQuotaMin >= 0.1, true);
  assert.equal(policy.autonomousQuestionRateTarget >= 0.5, true);
  assert.equal(policy.scoring.weights.seedSimilarity <= policy.seedSimilarityWeightMax, true);
});

test('research question generator starts from autonomous triggers instead of user seed only', () => {
  const policy = loadResearchOsPolicy();
  const result = generateResearchQuestions({
    themes: [
      { key: 'space', label: 'Space Economy', heat: 0.9, momentum: 0.4, supplierDiversity: 1 },
      { key: 'quantum-computing', label: 'Quantum Computing', heat: 0.82, momentum: 0.35, supplierDiversity: 1 },
      { key: 'cloud-infrastructure', label: 'Cloud Infrastructure', heat: 0.7, momentum: 0.3, supplierDiversity: 0 },
    ],
    novelPhrases: [
      { phrase: 'orbital data centers', count: 4, themes: ['space', 'cloud-infrastructure'] },
    ],
  }, policy);
  assert.equal(result.ok, true);
  assert.equal(result.questions.some((item) => item.questionType === 'theme_pair'), true);
  assert.equal(result.questions.some((item) => item.questionType === 'explanation_gap'), true);
  assert.equal(result.questions.some((item) => item.questionType === 'novel_phrase'), true);
  assert.equal(result.metrics.autonomousQuestionRate, 1);
});

test('research question generator filters taxonomy labels and numeric HTML noise from novel phrases', () => {
  const policy = loadResearchOsPolicy();
  const result = generateResearchQuestions({
    themes: [
      { key: 'space', label: 'Space Economy', heat: 0.9, momentum: 0.4, supplierDiversity: 1 },
    ],
    novelPhrases: [
      { phrase: 'Science', count: 20 },
      { phrase: '8217', count: 20 },
      { phrase: 'orbital cryogenic transfer depot', count: 5 },
    ],
  }, policy);
  const novelSeeds = result.questions
    .filter((item) => item.questionType === 'novel_phrase')
    .flatMap((item) => item.seedTerms);
  assert.equal(novelSeeds.includes('Science'), false);
  assert.equal(novelSeeds.includes('8217'), false);
  assert.equal(novelSeeds.includes('orbital cryogenic transfer depot'), true);
});

test('incoming miner creates seed-independent signals from new source convergence', () => {
  const policy = loadResearchOsPolicy();
  const signals = buildIncomingResearchSignalsFromRows({
    discoveryTopics: [{
      id: 'topic-1',
      label: 'Orbital Data Center Thermal Management',
      key_technologies: ['thermal management', 'orbital data center'],
      keywords: ['space infrastructure', 'thermal control'],
      normalized_theme: 'space',
      normalized_parent_theme: 'cloud-infrastructure',
      updated_at: '2026-05-03T00:00:00.000Z',
      article_count: 8,
    }],
    openalexWorks: [{
      work_id: 'W1',
      title: 'Thermal management for orbital data centers',
      primary_topic: 'Space infrastructure',
      source_display_name: 'Example Journal',
      publication_date: '2026-05-01',
      updated_at: '2026-05-02T00:00:00.000Z',
    }],
    githubRepos: [{
      repo_key: 'example/orbital-cooling',
      full_name: 'example/orbital-cooling',
      description: 'thermal management for orbital compute platforms',
      topics: ['thermal-management', 'space-infrastructure'],
      pushed_at: '2026-05-02T00:00:00.000Z',
    }],
    graphKeys: ['space', 'cloud-infrastructure'],
    seedExamples: [{
      expectedSuppliers: ['Linde'],
      expectedConnectors: ['cryogenic cooling'],
    }],
  }, policy);
  const thermal = signals.find((signal) => signal.normalizedKey.includes('thermal'));
  assert.equal(Boolean(thermal), true);
  assert.equal(thermal.signalType, 'cross_source_convergence');
  assert.equal(thermal.sourceTypes.length >= 2, true);
  assert.equal(thermal.seedSimilarity < policy.incoming.seedSimilarityStrongThreshold, true);
});

test('research question generator allocates source-first incoming questions', () => {
  const policy = loadResearchOsPolicy();
  const result = generateResearchQuestions({
    themes: [
      { key: 'space', label: 'Space Economy', heat: 0.2, momentum: 0.1, supplierDiversity: 3 },
    ],
    incomingSignals: [{
      id: 'incoming-1',
      signalType: 'cross_source_convergence',
      label: 'thermal management',
      linkedThemes: ['space', 'cloud-infrastructure'],
      sourceTypes: ['discoveryTopic', 'openalex', 'github'],
      sourceCount: 3,
      observationCount: 3,
      priorityScore: 0.82,
      noveltyScore: 0.9,
      seedSimilarity: 0,
    }],
  }, policy);
  assert.equal(result.ok, true);
  assert.equal(result.questions.some((item) => item.questionType === 'cross_source_convergence'), true);
  const incoming = result.questions.find((item) => item.questionType === 'cross_source_convergence');
  assert.equal(incoming.metadata.trigger, 'incoming_signal');
  assert.equal(incoming.seedTerms.includes('thermal management'), true);
});

test('theme taxonomy and entity seeds import into candidate graph without trusted promotion', () => {
  const seed = buildThemeTaxonomyGraphSeed();
  assert.equal(seed.nodes.some((node) => node.nodeType === 'theme' && node.normalizedKey === 'space'), true);
  assert.equal(seed.nodes.some((node) => node.nodeType === 'company' && node.normalizedKey === 'linde'), true);
  const linde = seed.nodes.find((node) => node.nodeType === 'company' && node.normalizedKey === 'linde');
  assert.equal(linde.status, 'candidate');
});

test('theme ontology discovery profile injects bottleneck nodes into graph seed', () => {
  const seed = buildThemeTaxonomyGraphSeed();
  const solidMotor = seed.nodes.find((node) => node.normalizedKey === 'solid-rocket-motor-capacity');
  const gridQueue = seed.nodes.find((node) => node.normalizedKey === 'grid-interconnection-queue');
  assert.equal(Boolean(solidMotor), true);
  assert.equal(solidMotor.nodeType, 'component');
  assert.equal(solidMotor.metadata.discoveryRole, 'constraint');
  assert.equal(solidMotor.metadata.constraintScore > 0.9, true);
  assert.equal(
    solidMotor.metadata.sourceQueries.some((query) => /solid rocket motor.*production capacity/i.test(query)),
    true,
  );
  assert.equal(Boolean(gridQueue), true);
  assert.equal(gridQueue.metadata.source, 'theme-ontology-discovery');
  assert.equal(seed.edges.some((edge) => edge.targetId === solidMotor.id && edge.metadata?.source === 'theme-ontology-discovery'), true);
});

test('cross-theme scorer finds shared connector and keeps seed dependence bounded', () => {
  const policy = loadResearchOsPolicy();
  const result = scoreCrossThemeConnectors({
    graph: fixtureGraph(),
    themes: ['space', 'quantum-computing', 'fusion-energy'],
    hotThemes: [
      { key: 'space', heat: 0.9 },
      { key: 'quantum-computing', heat: 0.85 },
      { key: 'fusion-energy', heat: 0.8 },
    ],
    seedExamples: [
      {
        expectedConnectors: ['cryogenic cooling'],
        expectedSuppliers: ['Linde'],
      },
    ],
  }, policy);
  assert.equal(result.ok, true);
  assert.equal(result.candidates.some((item) => item.node.normalizedKey === 'cryogenic-cooling'), true);
  assert.equal(result.candidates.some((item) => item.node.normalizedKey === 'vacuum-systems'), true, 'non-seed connector should be surfaced');
  assert.equal(result.metrics.seedDependenceRatio < 1, true, 'candidate set must not be seed-only');
  const vacuum = result.candidates.find((item) => item.node.normalizedKey === 'vacuum-systems');
  assert.equal(Boolean(vacuum.evidenceSummary.nonObviousDiscovery), true);
  assert.equal(vacuum.evidenceSummary.nonObviousDiscovery.themeDistanceScore > 0.5, true);
});

test('cross-theme scorer prioritizes discovery ontology bottlenecks without canonical promotion', () => {
  const policy = loadResearchOsPolicy();
  const graph = buildThemeTaxonomyGraphSeed();
  const result = scoreCrossThemeConnectors({
    graph,
    themes: ['defense-industrial', 'space'],
    hotThemes: [
      { key: 'defense-industrial', heat: 0.85 },
      { key: 'space', heat: 0.78 },
    ],
  }, policy);
  const motor = result.candidates.find((item) => item.node.normalizedKey === 'solid-rocket-motor-capacity');
  assert.equal(Boolean(motor), true);
  assert.equal(motor.evidenceSummary.discovery.role, 'constraint');
  assert.equal(motor.evidenceSummary.constraintCriticality > 0.8, true);
  assert.equal(motor.lane, 'needs_evidence');
  assert.match(motor.reason, /shared dependency|Mechanism|solid rocket/i);
});

test('cross-theme scorer tags graph-overlap-only parents as not ready for adjacent expansion', () => {
  const policy = loadResearchOsPolicy();
  const graph = {
    nodes: [
      { id: 'theme:climate-change', nodeType: 'theme', canonicalName: 'climate-change', normalizedKey: 'climate-change' },
      { id: 'theme:cloud-infrastructure', nodeType: 'theme', canonicalName: 'cloud-infrastructure', normalizedKey: 'cloud-infrastructure' },
      { id: 'component:grid-interconnection-queue', nodeType: 'component', canonicalName: 'grid interconnection queue', normalizedKey: 'grid-interconnection-queue' },
    ],
    edges: [
      { sourceId: 'theme:climate-change', targetId: 'component:grid-interconnection-queue', relationType: 'requires', confidence: 0.65, evidenceCount: 0, sourceDiversity: 0 },
      { sourceId: 'theme:cloud-infrastructure', targetId: 'component:grid-interconnection-queue', relationType: 'requires', confidence: 0.65, evidenceCount: 0, sourceDiversity: 0 },
    ],
  };
  const result = scoreCrossThemeConnectors({
    graph,
    themes: ['climate-change', 'cloud-infrastructure'],
    hotThemes: [
      { key: 'climate-change', heat: 0.7 },
      { key: 'cloud-infrastructure', heat: 0.7 },
    ],
  }, policy);
  const grid = [...result.candidates, ...result.backlogCandidates]
    .find((item) => item.node.normalizedKey === 'grid-interconnection-queue');
  assert.equal(Boolean(grid), true);
  assert.equal(grid.evidenceSummary.parentReadyForAdjacent, false);
  assert.equal(grid.evidenceSummary.parentReadinessState, 'graph_overlap_only');
  assert.equal(grid.metadata.parentSelection.selectedBecause, 'graph_overlap_without_direct_or_provider_evidence');
});

test('cross-theme parent readiness recovers when direct evidence and source breadth are present', () => {
  const policy = loadResearchOsPolicy();
  const graph = {
    nodes: [
      { id: 'theme:climate-change', nodeType: 'theme', canonicalName: 'climate-change', normalizedKey: 'climate-change' },
      { id: 'theme:cloud-infrastructure', nodeType: 'theme', canonicalName: 'cloud-infrastructure', normalizedKey: 'cloud-infrastructure' },
      { id: 'component:grid-interconnection-queue', nodeType: 'component', canonicalName: 'grid interconnection queue', normalizedKey: 'grid-interconnection-queue' },
    ],
    edges: [
      { sourceId: 'theme:climate-change', targetId: 'component:grid-interconnection-queue', relationType: 'requires', confidence: 0.8, evidenceCount: 1, sourceDiversity: 2 },
      { sourceId: 'theme:cloud-infrastructure', targetId: 'component:grid-interconnection-queue', relationType: 'requires', confidence: 0.8, evidenceCount: 1, sourceDiversity: 2 },
    ],
  };
  const result = scoreCrossThemeConnectors({
    graph,
    themes: ['climate-change', 'cloud-infrastructure'],
    hotThemes: [
      { key: 'climate-change', heat: 0.7 },
      { key: 'cloud-infrastructure', heat: 0.7 },
    ],
  }, policy);
  const grid = [...result.candidates, ...result.backlogCandidates]
    .find((item) => item.node.normalizedKey === 'grid-interconnection-queue');
  assert.equal(Boolean(grid), true);
  assert.equal(grid.evidenceSummary.parentReadyForAdjacent, true);
  assert.equal(grid.evidenceSummary.parentReadinessState, 'parent_frontier_ready');
});

test('frontier parent selection suppresses issuer roots while keeping narrow nodes reportable', () => {
  const issuer = evaluateFrontierParentCandidate({
    label: 'Representative Power Equipment Company',
    nodeType: 'company',
    role: 'supplier',
    parentReadiness: { parentReadyForAdjacent: true, parentReadinessState: 'parent_frontier_ready' },
    nonObviousDiscovery: {
      frontierScore: 82,
      bottleneckSpecificityScore: 0.52,
      scarcitySignalScore: 0.42,
      themeDistanceScore: 0.7,
      surpriseScore: 0.7,
    },
  });
  assert.equal(issuer.frontierParentReportReady, false);
  assert.equal(issuer.frontierParentCollectionEligible, false);
  assert.equal(issuer.frontierParentState, 'consensus_issuer_suppressed');

  const node = evaluateFrontierParentCandidate({
    label: 'protection relay qualification lead time',
    nodeType: 'component',
    parentReadiness: { parentReadyForAdjacent: true, parentReadinessState: 'parent_frontier_ready' },
    nonObviousDiscovery: {
      frontierScore: 74,
      bottleneckSpecificityScore: 0.66,
      scarcitySignalScore: 0.5,
      themeDistanceScore: 0.68,
      surpriseScore: 0.72,
      consensusPenalty: 0.05,
    },
  });
  assert.equal(node.frontierParentCollectionEligible, true);
  assert.equal(node.frontierParentReportReady, true);
  assert.equal(node.frontierParentState, 'frontier_parent_ready');

  const broad = evaluateFrontierParentCandidate({
    label: 'grid infrastructure',
    nodeType: 'infrastructure',
    parentReadiness: { parentReadyForAdjacent: true, parentReadinessState: 'parent_frontier_ready' },
    nonObviousDiscovery: {
      frontierScore: 55,
      bottleneckSpecificityScore: 0.12,
      scarcitySignalScore: 0,
      themeDistanceScore: 0.4,
      surpriseScore: 0.3,
      consensusPenalty: 0.18,
    },
  });
  assert.equal(broad.frontierParentCollectionEligible, true);
  assert.equal(broad.frontierParentReportReady, false);
  assert.equal(broad.frontierParentState, 'broad_parent_needs_decomposition');
});

test('relation extractor blocks quote-less high confidence claims', () => {
  const result = validateExtractedRelations({
    relations: [
      {
        subject: 'quantum computing',
        subjectType: 'theme',
        relation: 'requires',
        object: 'dilution refrigerator',
        objectType: 'component',
        confidence: 0.9,
      },
      {
        subject: 'space launch',
        subjectType: 'theme',
        relation: 'requires',
        object: 'cryogenic propellant',
        objectType: 'component',
        confidence: 0.7,
        evidenceQuote: 'Launch systems often use cryogenic propellants.',
      },
    ],
  });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.deepEqual(result.rejected[0].errors, ['quote-less-high-confidence']);
});

test('deterministic relation extractor creates candidate-only relations from evidence text', () => {
  const relations = buildRelationsFromEvidenceBundle({
    source_type: 'article',
    source_id: '1',
    metadata: { theme: 'quantum-computing' },
    title: 'Cryogenic cooling systems advance quantum processors',
    text_excerpt: 'Cryogenic cooling systems and dilution refrigerator infrastructure are needed for scalable quantum processor operation.',
  }, {
    id: 1,
    themes: ['quantum-computing', 'space'],
    prompt: 'Find shared physical bottlenecks, components, materials, and suppliers.',
  }, {
    companyNodes: [{ id: 10, canonical_name: 'Linde' }],
    maxPhrases: 4,
  });
  assert.equal(relations.length > 0, true);
  assert.equal(relations.some((relation) => relation.subject === 'quantum-computing'), true);
  assert.equal(relations.every((relation) => relation.evidenceQuote), true);
  assert.equal(relations.every((relation) => relation.metadata.extractionMode), true);
});

test('API LLM relation provider validates JSON and marks output candidate-only', async () => {
  const policy = loadResearchOsPolicy({
    overrides: {
      relationExtraction: {
        enableApiLlm: true,
        llmProvider: 'disabled',
        maxOutputTokens: 100,
      },
    },
  });
  assert.equal(shouldUseApiLlm(policy), true);
  const result = await extractRelationsWithApiLlm({
    policy,
    bundle: {
      id: 1,
      title: 'Cryogenic cooling links launch systems and quantum hardware',
      text_excerpt: 'Cryogenic cooling is cited as a shared bottleneck for launch systems and quantum processors.',
      metadata: { theme: 'space' },
    },
    question: {
      id: 1,
      themes: ['space', 'quantum-computing'],
      prompt: 'Find shared physical bottlenecks.',
    },
    llmExtractor: async () => JSON.stringify({
      relations: [{
        subject: 'space',
        subjectType: 'theme',
        relation: 'requires',
        object: 'cryogenic cooling',
        objectType: 'component',
        confidence: 0.7,
        evidenceQuote: 'Cryogenic cooling is cited as a shared bottleneck',
      }],
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].metadata.extractionMode, 'api-llm');
  assert.equal(result.accepted[0].metadata.provider, 'disabled');
});

test('source expansion planner always routes weak evidence through approval path', () => {
  const plans = planSourceExpansion([
    {
      id: 'candidate-1',
      themes: ['space', 'quantum-computing'],
      node: { canonicalName: 'Cryogenic Cooling' },
      evidenceSummary: { evidenceQuality: 0.1 },
    },
  ]);
  assert.equal(plans.ok, true);
  assert.equal(plans.approvalRequired, true);
  assert.equal(plans.plans[0].bypassAllowed, false);
  assert.equal(plans.plans[0].writePath, 'codex_proposals_or_approval_queue_only');
});

test('source-query executor turns approved query into isolated research question payload', () => {
  const question = buildSourceQueryQuestionPayload({
    id: 145,
    payload: {
      query: '"Linde" space supplier evidence',
      candidateId: '159',
      themes: ['space', 'quantum-computing'],
      supplier: 'Linde',
      connector: 'Cryogenic Cooling',
    },
  });
  assert.equal(question.questionType, 'source_query');
  assert.equal(question.metadata.source, 'source-query-executor');
  assert.equal(question.metadata.candidateId, '159');
  assert.equal(question.seedTerms.includes('Linde'), true);
  assert.equal(question.seedTerms.includes('Cryogenic Cooling'), true);
});

test('source-query executor rejects no-bound report sentinels before collection', () => {
  const invalid = {
    id: 501,
    status: 'approved',
    payload: {
      query: 'theme no-match-theme-air-liquide annual report product customer evidence',
      subjectKey: 'no-match-theme-air-liquide',
      themes: ['no-match-theme-air-liquide'],
      subject: {
        subjectType: 'no_bound_candidate',
        subjectId: 'NO-MATCH-theme-air-liquide',
        displayName: 'No theme report bound to air-liquide',
      },
    },
  };
  const valid = {
    id: 502,
    status: 'approved',
    payload: {
      query: '"Air Liquide" hydrogen supplier annual report evidence',
      subjectKey: 'air-liquide',
      themes: ['hydrogen', 'industrial-gases'],
      subject: {
        subjectType: 'cross_theme_candidate',
        subjectId: 'Air Liquide',
        displayName: 'Air Liquide',
      },
    },
  };

  assert.equal(isInvalidSourceQueryApproval(invalid), true);
  assert.equal(sourceQueryApprovalBlocker(invalid), 'no-bound-candidate-subject');
  assert.equal(isInvalidSourceQueryApproval(valid), false);
});

test('source-query executor filters generic bundles and grades direct evidence', () => {
  const policy = loadResearchOsPolicy();
  const approval = {
    id: 145,
    payload: {
      query: '"Linde" space supplier evidence',
      themes: ['space', 'quantum-computing'],
      supplier: 'Linde',
      connector: 'Cryogenic Cooling',
    },
  };
  const direct = scoreSourceQueryBundle({
    title: 'Linde Cryogenic Cooling supply deal for space launch systems',
    textExcerpt: 'Linde cryogenic cooling and hydrogen infrastructure will support launch operations.',
    metadata: { source: 'example' },
  }, approval, policy);
  const noise = scoreSourceQueryBundle({
    title: 'Space startups raise funding',
    textExcerpt: 'The space economy continues to grow without naming industrial gas suppliers.',
    metadata: { source: 'example' },
  }, approval, policy);
  assert.equal(direct.accepted, true);
  assert.equal(direct.evidenceStrength, 'direct');
  assert.equal(noise.accepted, false);
  const filtered = filterAndScoreSourceQueryBundles([noise, direct], approval, policy);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].title, direct.title);
});

test('source-query executor separates promotion evidence from canonical context memory', () => {
  const policy = loadResearchOsPolicy();
  const approval = {
    id: 606,
    payload: {
      query: '"solid rocket motor capacity" procurement contract award funding budget program trigger defense-industrial space solid rocket motor interceptor production',
      reportType: 'cross_theme_bottleneck_report',
      candidateId: '16776',
      themes: ['defense-industrial', 'space'],
      connector: 'solid rocket motor capacity',
      desiredEvidenceClass: 'procurement_trigger',
    },
  };
  const direct = scoreSourceQueryBundle({
    title: 'Department of Defense contract award expands solid rocket motor production capacity',
    textExcerpt: 'The DoD budget justification lists procurement line item funding and contract obligation for missile interceptor solid rocket motors.',
    sourceType: 'usaspending',
    metadata: { sourceProvider: 'usaspending', publisher: 'Department of Defense' },
  }, approval, policy);
  const context = scoreSourceQueryBundle({
    title: 'Rocket motor industry update mentions defense suppliers',
    textExcerpt: 'The update discusses defense and space suppliers, but does not provide operating detail.',
    metadata: { source: 'example' },
  }, approval, policy);
  const broadThemeOnly = scoreSourceQueryBundle({
    title: 'Havelsan unveils autonomous ground vehicle for defense market',
    textExcerpt: 'The defense supplier discussed unmanned systems and space-adjacent autonomy without naming propulsion constraints.',
    metadata: { source: 'example' },
  }, approval, policy);

  assert.equal(direct.evidenceUse, 'promotion_candidate');
  assert.equal(direct.promotionEligible, true);
  assert.equal(direct.accepted, true);
  assert.equal(context.evidenceUse, 'supporting_context');
  assert.equal(context.persistable, true);
  assert.equal(context.promotionEligible, false);
  assert.equal(context.accepted, false);
  assert.equal(broadThemeOnly.evidenceUse, 'weak_noise');
  assert.equal(broadThemeOnly.persistable, true);
  assert.equal(broadThemeOnly.promotionEligible, false);
});

test('source-query procurement promotion requires official contract or budget evidence', () => {
  const policy = loadResearchOsPolicy();
  const approval = {
    id: 607,
    payload: {
      query: '"solid rocket motor capacity" PAC-3 procurement budget contract award',
      reportType: 'cross_theme_bottleneck_report',
      candidateId: '16776',
      themes: ['defense-industrial', 'space'],
      connector: 'solid rocket motor capacity',
      desiredEvidenceClass: 'procurement_trigger',
    },
  };

  const official = scoreSourceQueryBundle({
    title: 'Department of Defense contract award for solid rocket motor capacity and PAC-3 interceptor procurement',
    textExcerpt: 'DoD budget justification lists procurement line item funding and contract obligation for solid rocket motor capacity.',
    sourceType: 'usaspending',
    metadata: { sourceProvider: 'usaspending', publisher: 'Department of Defense' },
  }, approval, policy);

  const tradeContext = scoreSourceQueryBundle({
    title: 'Solid rocket motor capacity may become a procurement bottleneck',
    textExcerpt: 'Analysts expect suppliers could benefit if procurement demand rises, but no contract award or budget line is cited.',
    sourceType: 'trade-press',
    metadata: { publisher: 'Industry Blog' },
  }, approval, policy);

  assert.equal(official.evidenceUse, 'promotion_candidate');
  assert.equal(official.promotionEligible, true);
  assert.equal(tradeContext.evidenceUse, 'supporting_context');
  assert.equal(tradeContext.promotionEligible, false);
});

test('source-query adjacent mission awards can promote on official query-matched evidence without exact lane label', () => {
  const policy = loadResearchOsPolicy();
  const approval = {
    id: 608,
    payload: {
      query: 'space launch range operations ground systems support contract',
      reportType: 'cross_theme_bottleneck_report',
      subjectKey: 'adjacent-16776-range-operations-or-ground-systems-support',
      collectionKind: 'adjacent_theme_candidate',
      adjacentCandidateKey: 'adjacent-16776-range-operations-or-ground-systems-support',
      target: { type: 'adjacent_theme_candidate' },
      subject: { displayName: 'Range operations or ground systems support' },
      themes: ['space'],
      desiredEvidenceClass: 'mission_award',
    },
  };

  const official = scoreSourceQueryBundle({
    title: 'U.S. Space Force Awards $446.8 Million Agreement to Kratos for MEO Missile Tracking Ground Segment',
    textExcerpt: 'Space Systems Command announced a Space Force agreement awarded to Kratos to support launch and operations ground systems mission program. Contractor provider Kratos.',
    url: 'https://www.ssc.spaceforce.mil/Newsroom/Article-Display/Article/123',
    sourceType: 'external-rss',
    metadata: { source: 'ssc.spaceforce.mil', publisher: 'Space Systems Command' },
  }, approval, policy);

  const tradeContext = scoreSourceQueryBundle({
    title: 'Space industry vendor expands launch range operations support',
    textExcerpt: 'The provider says it can support launch and ground systems operations for commercial customers, but it does not name a customer or signed deal.',
    url: 'https://example.com/space-vendor-range-operations',
    sourceType: 'trade-press',
    metadata: { source: 'trade-press', publisher: 'Industry Blog' },
  }, approval, policy);

  assert.equal(official.evidenceUse, 'promotion_candidate');
  assert.equal(official.promotionEligible, true);
  assert.equal(official.scoring.targetHit, true);
  assert.equal(tradeContext.evidenceUse, 'supporting_context');
  assert.equal(tradeContext.promotionEligible, false);
});

test('source-query adjacent power/cooling rejects broad AI papers without class facts', () => {
  const policy = loadResearchOsPolicy();
  const approval = {
    id: 609,
    payload: {
      query: 'AI / Machine Learning data center power utility interconnection cooling capacity constraint',
      reportType: 'cross_theme_bottleneck_report',
      subjectKey: 'adjacent-ai-ml-power-cooling-or-utility-infrastructure',
      collectionKind: 'adjacent_theme_candidate',
      adjacentCandidateKey: 'adjacent-ai-ml-power-cooling-or-utility-infrastructure',
      target: { type: 'adjacent_theme_candidate' },
      subject: { displayName: 'Power, cooling, or utility infrastructure' },
      themes: ['ai-ml'],
      connector: 'AI / Machine Learning',
      desiredEvidenceClass: 'power_constraint',
    },
  };

  const broadPaper = scoreSourceQueryBundle({
    title: 'DPM++: Dynamic Masked Metric Learning for Occluded Person Re-identification',
    textExcerpt: 'Person re-identification and masked metric learning improve occluded samples in machine learning applications.',
    sourceType: 'article',
    metadata: { source: 'arxiv' },
  }, approval, policy);
  const powerEvidence = scoreSourceQueryBundle({
    title: 'Distributed energy resources can accelerate data center interconnection',
    textExcerpt: 'Utilities and grid operators say data center load growth faces power availability and interconnection queue timing constraints.',
    sourceType: 'external-rss',
    metadata: { source: 'Utility Dive', provider: 'google-news-rss' },
  }, approval, policy);

  assert.equal(broadPaper.evidenceUse, 'weak_noise');
  assert.equal(broadPaper.usableEvidence, false);
  assert.equal(broadPaper.scoring.targetHit, false);
  assert.equal(broadPaper.scoring.rejectedReason, 'missing-adjacent-class-cue');
  assert.equal(powerEvidence.usableEvidence, true);
  assert.equal(['promotion_candidate', 'supporting_context'].includes(powerEvidence.evidenceUse), true);
  assert.equal(powerEvidence.scoring.targetHit, true);
});

test('source-query executor keeps negative controls canonical but out of promotion', () => {
  const policy = loadResearchOsPolicy();
  const approval = {
    id: 609,
    payload: {
      query: '"solid rocket motor capacity" easy substitutes supplier redundancy no capacity constraint non-qualified supplier no procurement timing',
      reportType: 'cross_theme_bottleneck_report',
      candidateId: '16776',
      themes: ['defense-industrial', 'space'],
      connector: 'solid rocket motor capacity',
      desiredEvidenceClass: 'negative_control',
    },
  };
  const scored = scoreSourceQueryBundle({
    title: 'Solid rocket motor capacity has no near-term supplier redundancy',
    textExcerpt: 'The source says substitutes remain difficult and qualified supplier redundancy is limited.',
    metadata: { source: 'example' },
  }, approval, policy);

  assert.equal(scored.evidenceUse, 'negative_control_candidate');
  assert.equal(scored.negativeControlFinding, 'supported_constraint');
  assert.equal(scored.persistable, true);
  assert.equal(scored.promotionEligible, false);
  assert.equal(scored.accepted, false);

  const positiveButTargeted = scoreSourceQueryBundle({
    title: 'Pentagon invests in solid rocket motor capacity expansion',
    textExcerpt: 'The program expands missile production capacity but does not discuss substitutes, redundancy, or absence of constraints.',
    metadata: { source: 'example' },
  }, approval, policy);
  assert.equal(positiveButTargeted.evidenceUse, 'weak_noise');
  assert.equal(positiveButTargeted.persistable, true);
  assert.equal(positiveButTargeted.promotionEligible, false);
});

test('source-query executor recognizes tested rocket motors and chokepoints as class-specific evidence', () => {
  const policy = loadResearchOsPolicy();
  const technicalApproval = {
    id: 644,
    payload: {
      query: '"solid rocket motor" qualification certification propellant test firing supplier',
      reportType: 'cross_theme_bottleneck_report',
      candidateId: '16776',
      themes: ['defense-industrial', 'space'],
      connector: 'solid rocket motor capacity',
      desiredEvidenceClass: 'technical_qualification',
    },
  };
  const technical = scoreSourceQueryBundle({
    title: 'Northrop Grumman successfully tests a new solid rocket motor developed in less than a year',
    textExcerpt: 'The supplier tested and developed a solid rocket motor for missile production qualification.',
    metadata: { source: 'example' },
  }, technicalApproval, policy);

  const substitutionApproval = {
    id: 647,
    payload: {
      query: '"solid rocket motor" chemical chokepoint supply-chain bottleneck',
      reportType: 'cross_theme_bottleneck_report',
      candidateId: '16776',
      themes: ['defense-industrial', 'space'],
      connector: 'solid rocket motor capacity',
      desiredEvidenceClass: 'substitution_limit',
    },
  };
  const substitutionContext = scoreSourceQueryBundle({
    title: 'Anduril opens solid rocket motor factory amid ongoing chemical chokepoint',
    textExcerpt: 'The factory addresses a supply-chain bottleneck for solid rocket motor production.',
    metadata: { source: 'example' },
  }, substitutionApproval, policy);
  const substitutionPromotion = scoreSourceQueryBundle({
    title: 'Solid rocket motor capacity remains hard to substitute',
    textExcerpt: 'The source says solid rocket motor capacity has only limited qualified suppliers, creating a qualification constraint with no near-term alternative.',
    metadata: { source: 'example' },
  }, substitutionApproval, policy);

  assert.equal(technical.evidenceUse, 'promotion_candidate');
  assert.equal(technical.promotionEligible, true);
  assert.equal(substitutionContext.evidenceUse, 'supporting_context');
  assert.equal(substitutionContext.promotionEligible, false);
  assert.equal(substitutionPromotion.evidenceUse, 'promotion_candidate');
  assert.equal(substitutionPromotion.promotionEligible, true);
});

test('source-query auto approval can be limited to report-created source queries', async () => {
  const calls = [];
  const queryable = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: 11 }, { id: 12 }] };
    },
  };
  const result = await approvePendingSourceQueries(queryable, {
    reportCreatedOnly: true,
    limit: 2,
    reviewer: 'test',
  });

  assert.equal(result.approvedCount, 2);
  assert.match(calls[0].sql, /payload \? 'reportId'/);
  assert.match(calls[0].sql, /payload \? 'reportBackfillTaskId'/);
  assert.equal(calls[0].params.at(-1), true);
});

test('source-query report filters include latest report id for deduped report backfill approvals', async () => {
  const calls = [];
  const queryable = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };

  await approvePendingSourceQueries(queryable, {
    reportId: 'RPT-cross-theme-bottleneck-report-16776-current',
    reportCreatedOnly: true,
    limit: 2,
    reviewer: 'test',
  });

  assert.match(calls[0].sql, /payload->>'latestReportId' = \$4::text/);
});

test('source-query executor uses report subject display as primary relevance for report-driven backfill', () => {
  const policy = loadResearchOsPolicy();
  const approval = {
    id: 880,
    payload: {
      query: 'Air Liquide revenue margin capex guidance valuation comparable companies earnings',
      reportType: 'cross_theme_bottleneck_report',
      subjectKey: '880',
      themes: ['hydrogen', 'industrial-gases'],
      subject: {
        subjectId: '880',
        subjectType: 'cross_theme_candidate',
        displayName: 'Air Liquide',
      },
    },
  };
  const scored = scoreSourceQueryBundle({
    title: 'Air Liquide annual results show margin and capex priorities',
    textExcerpt: 'Air Liquide reported revenue growth and discussed hydrogen investment and industrial gas customers.',
    metadata: { source: 'example' },
  }, approval, policy);
  const question = buildSourceQueryQuestionPayload(approval);

  assert.equal(question.metadata.primaryTerms.includes('Air Liquide'), true);
  assert.equal(scored.scoring.primaryHitCount, 1);
  assert.equal(scored.accepted, true);
});

test('source-query executor rejects cross-theme bundles that only match broad themes', () => {
  const policy = loadResearchOsPolicy();
  const approval = {
    id: 574,
    payload: {
      query: '"solid rocket motor" "launch vehicle" missile capacity supplier',
      reportType: 'cross_theme_bottleneck_report',
      candidateId: '16776',
      themes: ['defense-industrial', 'space'],
      connector: 'solid rocket motor capacity',
    },
  };
  const scored = scoreSourceQueryBundle({
    title: 'Havelsan unveils autonomous ground vehicle for defense market',
    textExcerpt: 'The defense supplier discussed unmanned systems and space-adjacent autonomy without naming propulsion constraints.',
    metadata: { source: 'example' },
  }, approval, policy);

  assert.equal(scored.scoring.requiresTargetHit, true);
  assert.equal(scored.scoring.rejectedReason, 'missing-target-or-query-hit');
  assert.equal(scored.accepted, false);
});

test('source-query external RSS parser extracts private evidence items without canonical writes', () => {
  const items = parseExternalRssItems(`
    <rss><channel>
      <item>
        <title><![CDATA[Linde cryogenic hydrogen systems support launch operations]]></title>
        <link>https://example.com/linde-launch</link>
        <description>Linde industrial gas infrastructure for launch customers.</description>
        <pubDate>Sun, 03 May 2026 00:00:00 GMT</pubDate>
        <source>Example Source</source>
      </item>
    </channel></rss>
  `);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Linde cryogenic hydrogen systems support launch operations');
  assert.equal(items[0].source, 'Example Source');
});

test('source-query needs-fix retry rewrites query without canonical writes', () => {
  const policy = loadResearchOsPolicy();
  const approval = {
    id: 245,
    status: 'needs-fix',
    payload: {
      query: 'Linde fusion-energy supplier evidence',
      candidateId: '245',
      themes: ['fusion-energy', 'space'],
      supplier: 'Linde',
    },
  };
  const variants = buildSourceQueryRetryVariants(approval, {
    id: '245',
    supplier_name: 'Linde',
    themes: ['fusion-energy', 'space'],
  }, policy);
  assert.equal(variants.length > 0, true);
  const repaired = repairSourceQueryApprovalPayload(approval, null, policy);
  assert.equal(repaired.changed, true);
  assert.equal(repaired.payload.repair.attempt, 1);
  assert.notEqual(repaired.payload.query, approval.payload.query);
  assert.equal(repaired.payload.candidateId, '245');
  const exhausted = repairSourceQueryApprovalPayload({
    ...approval,
    payload: { ...approval.payload, repair: { attempt: policy.sourceExpansion.retry.maxAttempts } },
  }, null, policy);
  assert.equal(exhausted.exhausted, true);
});

test('source-query retry variants preserve ontology-specific cross-theme source queries', () => {
  const policy = loadResearchOsPolicy();
  const approval = {
    id: 574,
    status: 'needs-fix',
    payload: {
      query: '"solid rocket motor capacity" defense-industrial space "rocket fuel" direct evidence',
      originalQuery: '"solid rocket motor" "launch vehicle" missile capacity supplier',
      candidateId: '16776',
      themes: ['defense-industrial', 'space'],
      connector: 'solid rocket motor capacity',
      target: 'solid rocket motor capacity',
      repair: { attempt: 1 },
    },
  };
  const variants = buildSourceQueryRetryVariants(approval, {
    id: '16776',
    connector_name: 'solid rocket motor capacity',
    themes: ['defense-industrial', 'space'],
    evidence_summary: {
      discovery: {
        sourceQueries: [
          '"solid rocket motor" "production capacity" missile interceptor Aerojet Northrop backlog',
          '"solid rocket motor" "qualified supplier" energetic materials missile production',
          '"solid rocket motor" "launch vehicle" missile capacity supplier',
        ],
      },
    },
  }, policy);

  assert.equal(variants.some((query) => /solid rocket motor.*production capacity.*missile/i.test(query)), true);
  assert.equal(variants.some((query) => /solid rocket motor capacity.*solid rocket motor capacity/i.test(query)), false);
  assert.equal(variants.some((query) => /customer product supplier/i.test(query)), false);
});

test('source-query retry variants stay evidence-class specific for bottleneck discovery', () => {
  const policy = loadResearchOsPolicy();
  const base = {
    id: 16776,
    status: 'needs-fix',
    payload: {
      candidateId: '16776',
      themes: ['defense-industrial', 'space'],
      connector: 'solid rocket motor capacity',
      target: 'solid rocket motor capacity',
      repair: { attempt: 1 },
    },
  };
  const candidate = {
    id: '16776',
    connector_name: 'solid rocket motor capacity',
    themes: ['defense-industrial', 'space'],
  };

  const technical = buildSourceQueryRetryVariants({
    ...base,
    payload: {
      ...base.payload,
      desiredEvidenceClass: 'technical_qualification',
      query: '"solid rocket motor" "qualified supplier" energetic materials missile production',
    },
  }, candidate, policy);
  assert.match(technical[0], /qualified|qualification|certification|energetic|propellant|test/i);
  assert.equal(technical.some((query) => /qualified|qualification|certification|energetic|propellant|test/i.test(query)), true);
  assert.equal(technical.every((query) => /solid rocket motor/i.test(query)), true);

  const substitution = buildSourceQueryRetryVariants({
    ...base,
    payload: {
      ...base.payload,
      desiredEvidenceClass: 'substitution_limit',
      query: '"solid rocket motor capacity" substitute alternative supplier redundancy sole source hard to substitute',
    },
  }, candidate, policy);
  assert.match(substitution[0], /chokepoint|bottleneck|sole source|single source|limited suppliers|hard to substitute|substitution/i);
  assert.equal(substitution.some((query) => /sole source|single source|limited suppliers|hard to substitute|substitution|chokepoint|bottleneck/i.test(query)), true);
  assert.equal(substitution.every((query) => /solid rocket motor/i.test(query)), true);

  const negative = buildSourceQueryRetryVariants({
    ...base,
    payload: {
      ...base.payload,
      desiredEvidenceClass: 'negative_control',
      query: '"solid rocket motor capacity" easy substitutes supplier redundancy no capacity constraint non-qualified supplier no procurement timing',
    },
  }, candidate, policy);
  assert.match(negative[0], /easy substitutes|supplier redundancy|no capacity constraint|no procurement timing|alternative suppliers/i);
  assert.equal(negative.some((query) => /easy substitutes|supplier redundancy|no capacity constraint|no procurement timing|alternative suppliers/i.test(query)), true);
  assert.equal(negative.every((query) => /solid rocket motor/i.test(query)), true);
});

test('source-query retry variants use universal evidence classes outside SRM bottleneck cases', () => {
  const policy = loadResearchOsPolicy();
  const variants = buildSourceQueryRetryVariants({
    id: 944,
    status: 'needs-fix',
    payload: {
      query: 'AI ML hyperscaler capex cloud revenue power demand evidence',
      subjectKey: 'ai-ml',
      reportType: 'theme_report',
      themes: ['ai-ml'],
      subject: {
        subjectType: 'theme',
        subjectId: 'ai-ml',
        displayName: 'AI / Machine Learning',
      },
      repair: { attempt: 1 },
    },
  }, null, policy);

  assert.equal(variants.length > 0, true);
  assert.equal(variants.some((query) => /capex|capital expenditure|infrastructure spending|buildout/i.test(query)), true);
  assert.equal(variants.some((query) => /solid rocket motor|qualified supplier|energetic materials/i.test(query)), false);
});

test('source-query retry variants prioritize provider route query variants', () => {
  const policy = loadResearchOsPolicy();
  const variants = buildSourceQueryRetryVariants({
    id: 1201,
    status: 'needs-fix',
    payload: {
      query: 'missile production procurement trigger evidence',
      subjectKey: 'defense-industrial',
      reportType: 'theme_report',
      themes: ['defense-industrial'],
      subject: {
        subjectType: 'theme',
        subjectId: 'defense-industrial',
        displayName: 'Defense Industrial',
      },
      desiredEvidenceClass: 'procurement_trigger',
      providerRoutePlan: {
        evidenceClass: 'procurement_trigger',
        providerRoute: 'official_contract_or_policy_source',
        executableCollectors: ['dod-contracts', 'usaspending', 'source-query'],
        sourceProviders: ['war.gov-contracts', 'defense.gov', 'usaspending'],
        queryVariants: ['Defense Industrial procurement trigger site:war.gov contract award budget'],
      },
      repair: { attempt: 1 },
    },
  }, null, policy);

  assert.equal(variants[0], 'Defense Industrial procurement trigger site:war.gov contract award budget');
  assert.equal(variants.some((query) => /site:war\.gov|usaspending|defense\.gov/i.test(query)), true);
});

test('candidate refresh preserves reviewed cross-theme states', async () => {
  for (const status of ['trusted', 'accepted', 'watch', 'rejected', 'archived']) {
    assert.equal(isReviewLockedCandidateStatus(status), true);
    assert.equal(REVIEW_LOCKED_CANDIDATE_STATUSES.includes(status), true);
  }
  assert.equal(isReviewLockedCandidateStatus('research_backlog'), false);
  const source = await readFile(path.join(process.cwd(), 'scripts', '_shared', 'adjacency-graph.mjs'), 'utf8');
  assert.match(source, /cross_theme_candidates\.status IN \('accepted','rejected','trusted','watch','archived'\)/);
  assert.match(source, /reviewStatePreserved/);
});

test('trusted promotion requires evidence, source diversity, and positive human review', () => {
  const policy = loadResearchOsPolicy();
  const blocked = evaluateTrustedPromotion({
    status: 'accepted',
    evidence_summary: { evidenceQuality: 0.1, sourceDiversity: 1 },
    metadata: {},
  }, [{ decision: 'accepted' }], policy);
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.blockers.includes('low-source-diversity'), true);
  const eligible = evaluateTrustedPromotion({
    status: 'accepted',
    evidence_summary: { evidenceQuality: 1, sourceDiversity: 3 },
    metadata: {},
  }, [{ decision: 'accepted' }], policy);
  assert.equal(eligible.eligible, true);
});

test('trusted promotion uses raw evidence counts from graph scoring when available', () => {
  const policy = loadResearchOsPolicy();
  const result = evaluateTrustedPromotion({
    status: 'accepted',
    evidence_summary: {
      evidenceQuality: 1,
      sourceDiversity: 1,
      sourceDiversityRaw: 3,
      directEvidenceCount: 2,
    },
    metadata: {},
  }, [{ decision: 'accepted' }], policy);
  assert.equal(result.eligible, true);
  assert.equal(result.metrics.sourceDiversity, 3);
  assert.equal(result.metrics.directEvidence, 2);
});

test('policy advisor suggests changes instead of requiring manual number tuning', () => {
  const result = buildPolicyAdvisorProposals({
    autonomousQuestionRate: 0.2,
    seedDependenceRatio: 0.9,
    explorationRate: 0.4,
  });
  assert.equal(result.ok, true);
  assert.equal(result.requiresApproval, true);
  assert.equal(result.proposals.length >= 2, true);
  assert.equal(result.proposals.every((proposal) => proposal.rollbackRule), true);
});

test('autoresearch harness writes append-only isolated journal entry', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-research-os-'));
  const journalPath = path.join(dir, 'rounds.jsonl');
  try {
    const entry = await runAutoresearchHarnessRound({
      name: 'test-round',
      budgetMs: 10_000,
      journalPath,
      variantGenerator: async () => ({ variant: { explorationQuotaMin: 0.3 }, rationale: 'test' }),
      execute: async (variant) => ({ ok: true, variant }),
      metric: async () => ({ canonicalPollutionCount: 0, evidencePrecision: 1 }),
      acceptanceGate: (metrics) => metrics.canonicalPollutionCount === 0,
    });
    assert.equal(entry.accepted, true);
    assert.equal(entry.livePollutionAllowed, false);
    const journal = await readFile(journalPath, 'utf8');
    assert.match(journal, /"test-round"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('research OS modules declare forbidden write boundaries', async () => {
  assert.equal(RESEARCH_OS_ALLOWED_WRITE_TABLES.includes('incoming_research_signals'), true);
  assert.equal(RESEARCH_OS_FORBIDDEN_AUTO_WRITE_TABLES.includes('discovery_topics'), true);
  assert.equal(RESEARCH_OS_FORBIDDEN_AUTO_WRITE_TABLES.includes('model_predictions'), true);
  assert.equal(RESEARCH_OS_FORBIDDEN_AUTO_WRITE_TABLES.includes('labeled_outcomes'), true);
});

test('dashboard API and HTML expose cross-theme connector review path', async () => {
  const api = await readFile(path.join(process.cwd(), 'scripts', 'event-dashboard-api.mjs'), 'utf8');
  const crossThemeApi = await readFile(path.join(process.cwd(), 'scripts', '_shared', 'cross-theme-api.mjs'), 'utf8');
  const html = await readFile(path.join(process.cwd(), 'event-dashboard.html'), 'utf8');
  assert.match(api, /cross-theme-connectors/);
  assert.match(api, /research-os/);
  assert.match(api, /buildResearchOsStatusPayload/);
  assert.match(crossThemeApi, /seed-dependence-high/);
  assert.match(crossThemeApi, /source-query-exhausted-review/);
  assert.match(api, /buildCrossThemeConnectorsPayload/);
  assert.match(api, /reviewCrossThemeCandidate/);
  assert.match(api, /trackCrossThemeCandidate/);
  assert.match(api, /queueCrossThemeSourceQueries/);
  assert.match(html, /Hidden Bottlenecks/);
  assert.match(html, /function loadCrossThemeConnectors\(includeBacklog=false\)/);
  assert.match(html, /renderResearchOsStatus/);
  assert.match(html, /function reviewCrossThemeConnector/);
  assert.match(html, /function trackCrossThemeConnector/);
  assert.match(html, /function queueCrossThemeSourceQuery/);
  assert.match(html, /loadCrossThemeConnectors\(\)/);
});
