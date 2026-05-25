import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildPositivePathCandidateChildSeeds,
  buildChildBottleneckBackfillTasks,
  buildDirectCompanyIrPdfAllowlistProposal,
  buildInterconnectionRouteSplitTracks,
  buildProviderBlockedGapArtifacts,
  classifySeedRouteMismatch,
  classifyChildProviderBlocked,
  decomposeChildBottleneckSeeds,
  selectPositivePathCandidateChildSeed,
  selectPreferredChildBottleneckSeed,
} from '../scripts/_shared/seed-child-bottleneck-decomposition.mjs';
import {
  buildSeedBiasEvidenceAcquisition,
  executeSeedBiasOfficialRoutes,
} from '../scripts/_shared/seed-bias-evidence-acquisition.mjs';
import {
  runSeedBiasEvidenceAcquisition,
} from '../scripts/run-seed-bias-evidence-acquisition.mjs';

function parentSeed() {
  return {
    seedId: 'msd-435f5ea22b83be71',
    seedTitle: 'Semiconductor -> advanced packaging capacity -> advanced packaging and substrate capacity',
    theme: { key: 'semiconductors', label: 'Semiconductor' },
    growthDriver: 'AI accelerator demand requires advanced packaging throughput',
    realActivity: 'advanced packaging ramp',
    physicalProcess: 'advanced packaging, substrate supply, interposer manufacturing, wafer processing, and tool qualification',
    requiredInputs: ['advanced packaging capacity', 'substrates', 'interposers', 'HBM', 'wafer tools'],
    bottleneck: {
      label: 'advanced packaging and substrate capacity',
      class: 'supplier_capacity',
      mechanism: 'qualified supplier and capacity bottleneck',
    },
    supplierCategory: {
      label: 'advanced packaging, substrate, memory, and semiconductor equipment suppliers',
      publicIssuerCandidates: ['TSM', 'ASML', 'AMD', 'NVDA', 'AVGO'],
      privateOnly: false,
    },
    evidenceQueries: ['advanced packaging capacity substrates interposers HBM bottleneck lead time backlog official source'],
    counterEvidenceQueries: ['advanced packaging capacity alternative suppliers substitution risk'],
    expectedEvidenceClasses: ['issuer_exposure', 'negative_control', 'holdout_validation'],
    scores: { knownNarrativeScore: 0.2, seedSimilarityScore: 0.2 },
    lineage: { source: 'research_question', sourceIds: ['auto'] },
  };
}

function fakeTask(evidenceClass, seedId = 'msd-435f5ea22b83be71') {
  return {
    taskId: `task-${evidenceClass}`,
    seedId,
    evidenceClass,
    providerRoute: evidenceClass,
    sourceQuery: `${evidenceClass} source query`,
    acceptanceCriteria: { requiredTerms: ['advanced packaging', evidenceClass.replace(/_/g, ' ')] },
    status: 'queued',
    reviewRequired: false,
  };
}

test('decomposes broad advanced packaging parent into child bottleneck seeds', () => {
  const result = decomposeChildBottleneckSeeds(parentSeed(), {
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(result.decomposed, true);
  assert.equal(result.childSeeds.length >= 8, true);
  assert.equal(result.childSeeds.some((seed) => seed.bottleneckNode === 'underfill and mold compound material capacity'), true);
  assert.equal(result.childSeeds.some((seed) => seed.bottleneckNode === 'probe card and test socket capacity for HBM and accelerators'), true);
  assert.equal(result.childSeeds.some((seed) => seed.bottleneckNode === 'temporary bonding and debonding throughput'), true);
  assert.equal(result.childSeeds.some((seed) => seed.bottleneckNode === 'substrate warpage control process bottleneck'), true);
  assert.equal(Object.keys(result.childClassDistribution).length >= 4, true);
  for (const child of result.childSeeds) {
    assert.equal(child.parentSeedId, 'msd-435f5ea22b83be71');
    assert.equal(Boolean(child.childSeedId), true);
    assert.equal(Boolean(child.mechanism), true);
    assert.equal(child.issuerCandidates.length > 0, true);
    assert.equal(child.requiredEvidenceClasses.includes('issuer_exposure'), true);
    assert.equal(child.requiredEvidenceClasses.includes('negative_control'), true);
    assert.equal(child.negativeControlQueries.length > 0, true);
    assert.equal(child.holdoutRoutes.includes('official_company_filing'), true);
    assert.equal(child.acceptanceCriteria.rejectTickerOnly, true);
    assert.equal(Boolean(child.childClass), true);
    assert.equal(Boolean(child.childDiversityBucket), true);
  }
});

test('child issuer route universe is node-specific while representative tickers are suppressed from early public candidates', () => {
  const { childSeeds } = decomposeChildBottleneckSeeds(parentSeed());
  const byNode = new Map(childSeeds.map((seed) => [seed.bottleneckNode, seed]));
  assert.deepEqual(byNode.get('CoWoS packaging capacity').routeIssuerCandidates, ['TSM', 'ASX', 'AMKR']);
  assert.deepEqual(byNode.get('ABF substrate capacity').routeIssuerCandidates, ['IBIDY', 'UNICY', 'NANYF', 'KINSF', 'ATASY']);
  assert.equal(byNode.get('ABF substrate capacity').routeIssuerCandidates.some((ticker) => ['TSM', 'ASML', 'AMD', 'NVDA', 'AVGO'].includes(ticker)), false);
  assert.equal(byNode.get('ABF substrate capacity').issuerCandidates.includes('NVDA'), false);
  assert.equal(byNode.get('ABF substrate capacity').issuerRoleClasses.includes('substrate_capacity_owner'), true);
  assert.equal(byNode.get('ABF substrate capacity').issuerRoleClasses.includes('customer_pass_through'), true);
  assert.equal(byNode.get('ABF substrate capacity').issuerRoleCandidates.some((item) => item.roleClass === 'material_input_owner'), true);
  assert.equal(byNode.get('ABF substrate capacity').providerGapProposalLinks.some((item) => item.providerName === 'edinet'), true);
  assert.equal(byNode.get('ABF substrate capacity').providerGapProposalLinks.every((item) => item.activationAllowed === false && item.reviewGatedActivation === true), true);
  assert.equal(byNode.get('ABF substrate capacity').providerGapProposalLinks.every((item) => (
    Object.hasOwn(item, 'authRequired')
    && Object.hasOwn(item, 'apiKeyRequired')
    && Object.hasOwn(item, 'rateLimit')
    && Object.hasOwn(item, 'parserOutputSchema')
    && Object.hasOwn(item, 'failureModes')
  )), true);
  assert.equal(byNode.get('HBM integration / packaging capacity').supplierCategory.publicIssuerCandidates.includes('NVDA'), false);
  assert.equal(byNode.get('HBM integration / packaging capacity').supplierCategory.publicIssuerCandidates.includes('AMD'), false);
  assert.equal(byNode.get('HBM integration / packaging capacity').suppressedRepresentativeTickers.includes('NVDA'), true);
  assert.equal(byNode.get('advanced packaging test / bonding / inspection equipment capacity').routeIssuerCandidates.includes('TER'), true);
});

test('preferred child selection chooses ABF child before broad parent or other children', () => {
  const { childSeeds } = decomposeChildBottleneckSeeds(parentSeed());
  const selection = selectPreferredChildBottleneckSeed(childSeeds);
  assert.equal(selection.childSeed.bottleneckNode, 'ABF substrate capacity');
  assert.equal(selection.priorityRank, 1);
  assert.match(selection.selectionReason, /ABF/);
});

test('ABF provider-blocked classification records provider gaps and keeps report candidate blocked', () => {
  const { childSeeds } = decomposeChildBottleneckSeeds(parentSeed());
  const abf = childSeeds.find((seed) => seed.bottleneckNode === 'ABF substrate capacity');
  const companyIrStatus = {
    issuerCoverageSkew: true,
    missingIssuerDocuments: ['UNICY', 'NANYF', 'KINSF', 'ATASY'],
    issuerSpecificProviderGap: [
      { issuer: 'UNICY', providerGap: ['taiwan_mops_required', 'company_ir_direct_pdf_required'] },
      { issuer: 'NANYF', providerGap: ['taiwan_mops_required', 'company_ir_direct_pdf_required'] },
      { issuer: 'KINSF', providerGap: ['taiwan_mops_required', 'company_ir_direct_pdf_required'] },
      { issuer: 'ATASY', providerGap: ['company_ir_direct_pdf_required'] },
    ],
    issuerDocumentCoverage: [
      { issuer: 'IBIDY', selectedDocumentCount: 2 },
      { issuer: 'UNICY', selectedDocumentCount: 0 },
    ],
  };
  const classified = classifyChildProviderBlocked({
    acceptedEvidenceCount: 0,
    issuerBridgeStatus: 'missing',
    finalBlocker: 'child_bottleneck_evidence_not_closed',
    execution: { companyIrCollectorStatus: companyIrStatus },
  }, abf);
  assert.equal(classified.blockType, 'provider_blocked');
  assert.equal(classified.reportCandidateAllowed, false);
  assert.equal(classified.excludedFromReportCandidateEvaluation, true);
  assert.equal(classified.terminalProviderBlocked, true);
  assert.deepEqual(classified.providerGapRequired.sort(), ['company_ir_direct_pdf', 'edinet', 'taiwan_mops', 'tdnet'].sort());
  assert.equal(classified.providerGapArtifacts.every((item) => item.reviewGatedActivation === true && item.activationAllowed === false), true);
  assert.equal(classified.providerGapArtifacts.some((item) => item.providerName === 'taiwan_mops' && item.affectedIssuers.includes('UNICY')), true);
  assert.equal(classified.directCompanyIrPdfAllowlistProposal.activationAllowed, false);
  assert.equal(classified.directCompanyIrPdfAllowlistProposal.manualFixtureRequired, true);
});

test('positive-path candidate selection avoids ABF and prefers interconnection/PWR official-route child', () => {
  const { childSeeds } = decomposeChildBottleneckSeeds(parentSeed());
  const abf = childSeeds.find((seed) => seed.bottleneckNode === 'ABF substrate capacity');
  const positivePool = buildPositivePathCandidateChildSeeds({ generatedAt: '2026-05-20T00:00:00.000Z' });
  const selected = selectPositivePathCandidateChildSeed([...childSeeds, ...positivePool], { excludeChildSeedId: abf.seedId });
  assert.equal(selected.childSeed.bottleneckNode, 'interconnection study capacity');
  assert.match(selected.selectionReason, /positive_path_priority_1/);
  assert.equal(selected.childSeed.routeIssuerCandidates.includes('PWR'), true);
  assert.equal(selected.childSeed.childKnownNarrativeScore < abf.childKnownNarrativeScore, true);
});

test('direct company IR PDF allowlist proposal is review-gated and fixture-bound', () => {
  const abf = decomposeChildBottleneckSeeds(parentSeed()).childSeeds
    .find((seed) => seed.bottleneckNode === 'ABF substrate capacity');
  const proposal = buildDirectCompanyIrPdfAllowlistProposal(abf, {
    missingIssuerDocuments: ['UNICY', 'NANYF'],
  });
  assert.equal(proposal.providerName, 'company_ir_direct_pdf');
  assert.equal(proposal.activationAllowed, false);
  assert.equal(proposal.reviewGatedActivation, true);
  assert.equal(proposal.manualFixtureRequired, true);
  assert.deepEqual(proposal.allowlistEntriesDraft.map((item) => item.issuer), ['UNICY', 'NANYF']);
  const artifacts = buildProviderBlockedGapArtifacts(abf, { missingIssuerDocuments: ['UNICY'] });
  assert.equal(artifacts.some((item) => item.providerName === 'company_ir_direct_pdf'), true);
});

test('official route uses child topic terms for issuer exposure acceptance but keeps gate blocked', async () => {
  const child = decomposeChildBottleneckSeeds(parentSeed()).childSeeds
    .find((seed) => seed.bottleneckNode === 'advanced packaging test / bonding / inspection equipment capacity');
  const tasks = buildChildBottleneckBackfillTasks(child, {
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const fetchImpl = async (url) => {
    const text = String(url);
    if (text.includes('company_tickers.json')) {
      return {
        ok: true,
        json: async () => ({ 0: { ticker: 'TER', cik_str: 97210, title: 'Teradyne Inc' } }),
      };
    }
    if (text.includes('submissions/CIK0000097210.json')) {
      return {
        ok: true,
        json: async () => ({
          filings: {
            recent: {
              form: ['10-K'],
              accessionNumber: ['0000097210-26-000001'],
              primaryDocument: ['ter-20251231.htm'],
              filingDate: ['2026-02-20'],
            },
          },
        }),
      };
    }
    return {
      ok: true,
      text: async () => '<html><body>Official annual report: advanced packaging test systems, wafer probe and final test capacity are tied to customer demand, revenue, backlog, capex allocation, and lead time management.</body></html>',
    };
  };
  const executed = await executeSeedBiasOfficialRoutes({
    seed: child,
    tasks,
    issuerCandidates: child.issuerCandidates,
    fetchImpl,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const result = buildSeedBiasEvidenceAcquisition({
    seed: child,
    tasks,
    collectedRawEvidence: executed.rawEvidence,
    diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(result.acceptedEvidence.some((row) => row.evidenceClass === 'issuer_exposure'), true);
  assert.equal(result.issuerBridgeStatus, 'attached');
  assert.equal(result.gateResult.gate, 'blocked');
  assert.equal(result.gateResult.blockers.includes('negative_control_not_closed'), true);
  assert.equal(result.gateResult.blockers.includes('holdout_confirmation_missing'), true);
});

class FakeClient {
  constructor({ artifactPath }) {
    this.artifactPath = artifactPath;
    this.calls = [];
  }

  async query(sql) {
    const text = String(sql);
    this.calls.push(text);
    const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.includes('from operator_research_seed_bias_runs')) {
      return {
        rows: [{
          run_id: 'seed-bias-child-run',
          verdict: 'DATA_LIMITED_BIAS',
          seed_count: 1,
          dominant_class: 'supplier_capacity',
          generated_at: '2026-05-20T00:00:00.000Z',
          payload: {
            seedBatch: { artifactPath: this.artifactPath },
            diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
            gateResults: [{ seedId: 'msd-435f5ea22b83be71' }],
          },
        }],
      };
    }
    if (normalized.includes('from operator_research_seed_backfill_tasks')) {
      return {
        rows: ['negative_control', 'holdout_validation', 'issuer_exposure'].map((klass) => ({
          task_id: `task-${klass}`,
          run_id: 'seed-bias-child-run',
          seed_id: 'msd-435f5ea22b83be71',
          evidence_class: klass,
          provider_route: klass,
          source_query: `${klass} source query`,
          acceptance_criteria: { requiredTerms: ['advanced packaging', klass.replace(/_/g, ' ')] },
          status: 'queued',
          review_required: false,
          payload: fakeTask(klass),
        })),
      };
    }
    if (normalized.includes('from operator_research_seed_evidence_raw')) return { rows: [] };
    if (normalized.includes('from operator_research_seed_evidence_accepted')) return { rows: [] };
    return { rows: [] };
  }
}

test('runner can decompose parent and keep child results blocked without provider activation', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'seed-child-acq-'));
  const artifactPath = path.join(tmp, 'seeds.json');
  await writeFile(artifactPath, `${JSON.stringify({ seeds: [parentSeed()] }, null, 2)}\n`, 'utf8');
  const client = new FakeClient({ artifactPath });
  try {
    const result = await runSeedBiasEvidenceAcquisition({
      client,
      dryRun: true,
      apply: false,
      artifactRoot: tmp,
      decomposeChildBottlenecks: true,
      selectedChildOnly: true,
      executeOfficialRoute: false,
      childLimit: 8,
      generatedAt: '2026-05-20T00:00:00.000Z',
    });
    assert.equal(result.ok, true);
    assert.equal(result.childResults.length, 1);
    assert.equal(result.selectedChildSeed.bottleneckNode, 'ABF substrate capacity');
    assert.equal(result.selectedChildSeed.issuerRoleClasses.includes('substrate_capacity_owner'), true);
    assert.equal(result.providerGapProposalLinks.length > 0, true);
    assert.equal(result.blockType, 'evidence_blocked');
    assert.deepEqual(result.providerGapRequired.sort(), ['edinet', 'taiwan_mops', 'tdnet'].sort());
    assert.equal(result.directCompanyIrPdfAllowlistProposal, null);
    assert.equal(result.positivePathCandidateSeed.bottleneckNode, 'interconnection study capacity');
    assert.equal(result.childSelection.executedChildCount, 1);
    assert.equal(result.parent.status, 'BROAD_SEED_NEEDS_DECOMPOSITION');
    assert.equal(result.parent.reportCandidateBlocked, true);
    assert.equal(result.gateResult.gate, 'blocked');
    assert.equal(result.boundaries.providerActivationWrites, 0);
    assert.equal(result.boundaries.canonicalWrites, 0);
    assert.equal(result.childResults.every((child) => child.gateResult.gate === 'blocked'), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('runner can execute one positive-path interconnection child without touching ABF provider-blocked path', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'seed-child-positive-acq-'));
  const artifactPath = path.join(tmp, 'seeds.json');
  await writeFile(artifactPath, `${JSON.stringify({ seeds: [parentSeed()] }, null, 2)}\n`, 'utf8');
  const client = new FakeClient({ artifactPath });
  try {
    const fetchImpl = async (url) => {
      const text = String(url);
      if (text.includes('company_tickers.json')) {
        return {
          ok: true,
          json: async () => ({ 0: { ticker: 'PWR', cik_str: 1050915, title: 'Quanta Services Inc' } }),
        };
      }
      if (text.includes('submissions/CIK0001050915.json')) {
        return {
          ok: true,
          json: async () => ({
            filings: {
              recent: {
                form: ['10-K'],
                accessionNumber: ['0001050915-26-000001'],
                primaryDocument: ['pwr-20251231.htm'],
                filingDate: ['2026-02-20'],
              },
            },
          }),
        };
      }
      return {
        ok: true,
        text: async () => '<html><body>Official filing: interconnection study and facilities study work for data center load requests is tied to customer demand, backlog, capacity, revenue growth, capex planning, and lead time management.</body></html>',
      };
    };
    const result = await runSeedBiasEvidenceAcquisition({
      client,
      dryRun: true,
      apply: false,
      artifactRoot: tmp,
      decomposeChildBottlenecks: true,
      selectedChildOnly: true,
      positivePathChild: true,
      executeOfficialRoute: true,
      fetchImpl,
      childLimit: 8,
      generatedAt: '2026-05-20T00:00:00.000Z',
    });
    assert.equal(result.ok, true);
    assert.equal(result.selectedChildSeed.bottleneckNode, 'interconnection study capacity');
    assert.equal(result.selectedChildSeed.routeIssuerCandidates.includes('PWR'), true);
    assert.equal(result.blockType, 'evidence_blocked');
    assert.equal(result.rawEvidenceCount > 0, true);
    assert.equal(result.acceptedEvidenceCount >= 1, true);
    assert.equal(result.issuerBridgeStatus, 'attached');
    assert.equal(result.gateResult.gate, 'blocked');
    assert.equal(result.finalBlocker, 'child_bottleneck_evidence_not_closed');
    assert.equal(result.boundaries.providerActivationWrites, 0);
    assert.equal(result.boundaries.canonicalWrites, 0);
    assert.equal(result.childResults[0].providerBlocked, false);
    assert.equal(result.childResults[0].reportCandidateAllowed, false);
    assert.equal(result.childResults[0].gateResult.blockers.includes('holdout_confirmation_missing'), true);
    assert.equal(result.childResults[0].gateResult.blockers.includes('negative_control_not_closed'), true);
    const negativeFamilies = result.childResults[0].officialRouteRuns
      .filter((run) => run.route === 'official-negative-control')
      .map((run) => run.family);
    assert.equal(negativeFamilies.every((family) => /interconnection|utility study/i.test(family)), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('interconnection process seed with PWR/ACM/J issuer route creates route mismatch split tracks', () => {
  const seed = buildPositivePathCandidateChildSeeds({ generatedAt: '2026-05-20T00:00:00.000Z' })
    .find((item) => item.bottleneckNode === 'interconnection study capacity');
  const classified = classifySeedRouteMismatch({
    acceptedEvidenceCount: 0,
    issuerBridgeStatus: 'missing',
    officialRouteRuns: [
      { route: 'sec-edgar-filing', ticker: 'PWR', error: 'WEAK_EVIDENCE' },
    ],
  }, seed);
  assert.equal(classified.routeMismatchDetected, true);
  assert.equal(classified.blockType, 'mechanism_issuer_route_mismatch');
  assert.equal(classified.directIssuerRouteAllowed, false);

  const tracks = buildInterconnectionRouteSplitTracks(seed, { generatedAt: '2026-05-20T00:00:00.000Z' });
  assert.equal(tracks.routeMismatchDetected, true);
  assert.equal(tracks.mechanismValidationTrack.track, 'mechanism_validation_track');
  assert.equal(tracks.mechanismValidationTrack.investmentReadinessAllowed, false);
  assert.deepEqual(tracks.mechanismValidationTrack.seed.requiredEvidenceClasses, [
    'grid_interconnection',
    'mechanism_validation',
    'operating_kpi',
    'policy_funding',
    'negative_control',
    'holdout_validation',
  ]);
  assert.equal(tracks.mechanismValidationTrack.allowedSourceRoutes.includes('lbnl_interconnection_queue'), true);
  assert.equal(tracks.mechanismValidationTrack.allowedSourceRoutes.includes('ferc_interconnection_reform'), true);
  assert.equal(tracks.issuerBridgeTrack.seed.bottleneckNode, 'transmission and substation EPC backlog');
  assert.deepEqual(tracks.issuerBridgeTrack.seed.routeIssuerCandidates, ['PWR', 'ACM', 'J']);
  assert.equal(tracks.issuerBridgeTrack.seed.acceptanceCriteria.requiredTerms.includes('power delivery'), true);
  assert.equal(tracks.issuerBridgeTrack.seed.acceptanceCriteria.requiredTerms.includes('substation'), true);
});

test('issuer bridge track accepts power-delivery backlog bridge candidate but remains blocked without holdout negative and market validation', async () => {
  const processSeed = buildPositivePathCandidateChildSeeds({ generatedAt: '2026-05-20T00:00:00.000Z' })
    .find((item) => item.bottleneckNode === 'interconnection study capacity');
  const trackSeed = buildInterconnectionRouteSplitTracks(processSeed, { generatedAt: '2026-05-20T00:00:00.000Z' }).issuerBridgeTrack.seed;
  const tasks = buildChildBottleneckBackfillTasks(trackSeed, { generatedAt: '2026-05-20T00:00:00.000Z' });
  const fetchImpl = async (url) => {
    const text = String(url);
    if (text.includes('company_tickers.json')) {
      return {
        ok: true,
        json: async () => ({ 0: { ticker: 'PWR', cik_str: 1050915, title: 'Quanta Services Inc' } }),
      };
    }
    if (text.includes('submissions/CIK0001050915.json')) {
      return {
        ok: true,
        json: async () => ({
          filings: {
            recent: {
              form: ['10-K'],
              accessionNumber: ['0001050915-26-000001'],
              primaryDocument: ['pwr-20251231.htm'],
              filingDate: ['2026-02-20'],
            },
          },
        }),
      };
    }
    return {
      ok: true,
      text: async () => '<html><body>Official filing: power delivery and transmission substation EPC backlog support revenue, guidance, margin, customer demand, and project execution capacity.</body></html>',
    };
  };
  const executed = await executeSeedBiasOfficialRoutes({
    seed: trackSeed,
    tasks,
    issuerCandidates: ['PWR'],
    fetchImpl,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const result = buildSeedBiasEvidenceAcquisition({
    seed: trackSeed,
    tasks,
    collectedRawEvidence: executed.rawEvidence,
    diagnosis: { verdict: 'INCONCLUSIVE_NEEDS_BACKFILL' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(result.acceptedEvidence.some((row) => row.evidenceClass === 'issuer_exposure'), true);
  assert.equal(result.issuerBridgeStatus, 'attached');
  assert.equal(result.gateResult.gate, 'blocked');
  assert.equal(result.gateResult.blockers.includes('negative_control_not_closed'), true);
  assert.equal(result.gateResult.blockers.includes('holdout_confirmation_missing'), true);
  assert.equal(result.gateResult.blockers.includes('market_validation_missing'), true);
});

test('issuer bridge track rejects generic infrastructure text without power-delivery backlog bridge', async () => {
  const processSeed = buildPositivePathCandidateChildSeeds({ generatedAt: '2026-05-20T00:00:00.000Z' })
    .find((item) => item.bottleneckNode === 'interconnection study capacity');
  const trackSeed = buildInterconnectionRouteSplitTracks(processSeed, { generatedAt: '2026-05-20T00:00:00.000Z' }).issuerBridgeTrack.seed;
  const tasks = buildChildBottleneckBackfillTasks(trackSeed, { generatedAt: '2026-05-20T00:00:00.000Z' });
  const fetchImpl = async (url) => {
    const text = String(url);
    if (text.includes('company_tickers.json')) {
      return {
        ok: true,
        json: async () => ({ 0: { ticker: 'PWR', cik_str: 1050915, title: 'Quanta Services Inc' } }),
      };
    }
    if (text.includes('submissions/CIK0001050915.json')) {
      return {
        ok: true,
        json: async () => ({
          filings: {
            recent: {
              form: ['10-K'],
              accessionNumber: ['0001050915-26-000001'],
              primaryDocument: ['pwr-20251231.htm'],
              filingDate: ['2026-02-20'],
            },
          },
        }),
      };
    }
    return {
      ok: true,
      text: async () => '<html><body>Official filing: the company provides broad infrastructure services for customers across many markets.</body></html>',
    };
  };
  const executed = await executeSeedBiasOfficialRoutes({
    seed: trackSeed,
    tasks,
    issuerCandidates: ['PWR'],
    fetchImpl,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const result = buildSeedBiasEvidenceAcquisition({
    seed: trackSeed,
    tasks,
    collectedRawEvidence: executed.rawEvidence,
    diagnosis: { verdict: 'INCONCLUSIVE_NEEDS_BACKFILL' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(result.acceptedEvidence.some((row) => row.evidenceClass === 'issuer_exposure'), false);
  assert.equal(result.issuerBridgeStatus, 'missing');
  assert.equal(result.gateResult.gate, 'blocked');
});
