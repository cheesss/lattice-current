import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildProviderQualityFeedback,
  writeProviderQualityFeedbackArtifact,
} from '../scripts/_shared/provider-quality-feedback.mjs';

test('provider quality feedback turns repeated weak evidence into fixture remediation', () => {
  const payload = buildProviderQualityFeedback({
    stagedProviderLiveExecution: {
      rawEvidence: [
        { provider: 'company_ir_direct_pdf', evidenceClass: 'issuer_exposure', failureClassification: 'WEAK_EVIDENCE' },
        { provider: 'company_ir_direct_pdf', evidenceClass: 'issuer_exposure', failureClassification: 'WEAK_EVIDENCE' },
      ],
      acceptedEvidence: [],
      acceptedPromotionEvidence: [],
    },
  });
  const row = payload.records.find((item) => item.providerName === 'company_ir_direct_pdf');
  assert.equal(row.acceptedCount, 0);
  assert.equal(row.recommendedRemediation, 'create_fixture_requirement');
  assert.equal(payload.repeatedFailureProviders.length, 1);
  assert.equal(payload.summary.remediationCounts.create_fixture_requirement, 1);
  assert.equal(payload.mutationBoundary.readinessPromotionWrites, 0);
});

test('provider quality feedback routes no-result and unavailable failures to bounded remediation', () => {
  const payload = buildProviderQualityFeedback({
    stagedProviderLiveExecution: {
      rawEvidence: [
        { provider: 'taiwan_mops', evidenceClass: 'issuer_exposure', failureClassification: 'NO_RESULT' },
        { provider: 'taiwan_mops', evidenceClass: 'issuer_exposure', failureClassification: 'NO_RESULT' },
        { provider: 'grid_official_readonly', evidenceClass: 'mechanism_validation', failureClassification: 'SOURCE_UNAVAILABLE' },
        { provider: 'grid_official_readonly', evidenceClass: 'mechanism_validation', failureClassification: 'SOURCE_UNAVAILABLE' },
      ],
    },
  });
  const noResult = payload.records.find((row) => row.providerName === 'taiwan_mops');
  const unavailable = payload.records.find((row) => row.providerName === 'grid_official_readonly');
  assert.equal(noResult.recommendedRemediation, 'select_alternative_source_bucket_or_decompose_seed');
  assert.equal(unavailable.recommendedRemediation, 'quarantine_source_or_provider');
  assert.match(unavailable.cooldownUntil, /^\d{4}-/);
  assert.equal(payload.quarantinedOrCooldownProviders.length, 1);
});

test('provider quality feedback creates collector requirements for staged providers without collectors', () => {
  const payload = buildProviderQualityFeedback({
    sourceProviderActivation: {
      records: [
        {
          providerName: 'edinet',
          evidenceClass: 'issuer_exposure',
          status: 'staged',
          fixtureStatus: 'fixture_verified',
        },
        {
          providerName: 'company_ir_direct_pdf',
          evidenceClass: 'issuer_exposure',
          status: 'staged',
          fixtureStatus: 'fixture_verified',
        },
      ],
    },
    providerCollectorRegistry: {
      providersWithCollectors: ['company_ir_direct_pdf'],
    },
  });
  assert.equal(payload.collectorRequirements.length, 1);
  assert.equal(payload.collectorRequirements[0].providerName, 'edinet');
  assert.equal(payload.summary.collectorRequirementCount, 1);
  assert.equal(payload.recommendedRemediationAction, 'create_fixture_requirement');
});

test('provider quality feedback turns source quality blockers into precise remediation', () => {
  const payload = buildProviderQualityFeedback({
    sourceQualityScore: {
      recordCount: 4,
      summary: { terminalBlockerCount: 4 },
      terminalBlockers: [
        { providerName: 'sec_10k', evidenceClass: 'issuer_exposure', blockType: 'source_seed_route_mismatch' },
      ],
      records: [
        {
          providerName: 'sec_10k',
          evidenceClass: 'issuer_exposure',
          failureReasons: ['SOURCE_SEED_ROUTE_MISMATCH'],
        },
        {
          providerName: 'sec_10k',
          evidenceClass: 'issuer_exposure',
          failureReasons: ['SOURCE_SEED_ROUTE_MISMATCH'],
        },
        {
          providerName: 'company_ir_direct_pdf',
          evidenceClass: 'issuer_exposure',
          failureReasons: ['NO_OPERATING_BRIDGE', 'OFFICIAL_BUT_GENERIC'],
        },
        {
          providerName: 'company_ir_direct_pdf',
          evidenceClass: 'issuer_exposure',
          failureReasons: ['NO_OPERATING_BRIDGE', 'OFFICIAL_BUT_GENERIC'],
        },
        {
          providerName: 'table_pdf_provider',
          evidenceClass: 'material_input',
          failureReasons: ['TABLE_ONLY_UNPARSED'],
        },
        {
          providerName: 'table_pdf_provider',
          evidenceClass: 'material_input',
          failureReasons: ['TABLE_ONLY_UNPARSED'],
        },
        {
          providerName: 'valuation_cache',
          evidenceClass: 'market_validation',
          failureReasons: ['VALUATION_BRIDGE_MISSING'],
        },
        {
          providerName: 'valuation_cache',
          evidenceClass: 'market_validation',
          failureReasons: ['VALUATION_BRIDGE_MISSING'],
        },
      ],
    },
  });

  const mismatch = payload.records.find((row) => row.providerName === 'sec_10k');
  const generic = payload.records.find((row) => row.providerName === 'company_ir_direct_pdf');
  const table = payload.records.find((row) => row.providerName === 'table_pdf_provider');
  const valuation = payload.records.find((row) => row.providerName === 'valuation_cache');
  assert.equal(mismatch.recommendedRemediation, 'split_route_or_decompose_seed');
  assert.equal(generic.recommendedRemediation, 'create_operating_bridge_fixture_requirement');
  assert.equal(table.recommendedRemediation, 'improve_document_extraction');
  assert.equal(valuation.recommendedRemediation, 'create_valuation_bridge_requirement');
  assert.equal(payload.summary.sourceQualityRecordCount, 4);
  assert.equal(payload.summary.sourceQualityTerminalBlockerCount, 4);
  assert.equal(payload.repeatedFailureProviders.some((row) => row.dominantFailureClass === 'SOURCE_SEED_ROUTE_MISMATCH'), true);
});

test('provider quality feedback sends bottleneck-directness misses to query refinement, not route split', () => {
  const payload = buildProviderQualityFeedback({
    sourceQualityScore: {
      recordCount: 2,
      summary: { terminalBlockerCount: 2 },
      records: [
        {
          providerName: 'company_ir_direct_pdf',
          evidenceClass: 'holdout_validation',
          failureReasons: ['NO_BOTTLENECK_DIRECTNESS'],
        },
        {
          providerName: 'company_ir_direct_pdf',
          evidenceClass: 'holdout_validation',
          failureReasons: ['NO_BOTTLENECK_DIRECTNESS'],
        },
      ],
    },
  });
  const row = payload.records.find((item) => item.providerName === 'company_ir_direct_pdf');
  assert.equal(row.recommendedRemediation, 'refine_child_seed_or_query');
  assert.equal(row.terminalStatus, 'bottleneck_directness_missing');
  assert.equal(payload.repeatedFailureProviders[0].recommendedRemediation, 'refine_child_seed_or_query');
});

test('provider quality feedback writes artifact', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-provider-quality-'));
  try {
    const payload = buildProviderQualityFeedback({
      backfillQueue: {
        rawEvidence: [
          { provider: 'backfill', evidenceClass: 'material_input', failureClassification: 'FIXTURE_REQUIRED' },
        ],
      },
    });
    const artifactPath = await writeProviderQualityFeedbackArtifact(payload, path.join(tmp, 'provider-quality-feedback.latest.json'));
    const saved = JSON.parse(await readFile(artifactPath, 'utf8'));
    assert.equal(saved.version, 'provider-quality-feedback-v1');
    assert.equal(saved.records[0].recommendedRemediation, 'create_provider_gap_proposal');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
