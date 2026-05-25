import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildSourceQualityScore,
  classifySeedSourceCompatibility,
  scoreSourceQuality,
  writeSourceQualityScoreArtifact,
} from '../scripts/_shared/source-quality-score.mjs';

test('official filing with generic business description is raw-only and not accepted eligible', () => {
  const record = scoreSourceQuality({
    providerName: 'sec_10k',
    sourceGroup: 'official_filing',
    evidenceClass: 'issuer_exposure',
    sourceUrl: 'https://www.sec.gov/Archives/example',
    documentTitle: 'Annual Report',
    rawTextSnippet: 'The company provides infrastructure and technology services to customers worldwide.',
    extractedCharCount: 120,
    accepted: true,
    failureClassification: 'ACCEPTED',
  });

  assert.equal(record.sourceAuthorityScore, 1);
  assert.equal(record.acceptedEligible, false);
  assert.equal(record.promotionEligible, false);
  assert.equal(record.failureReasons.includes('OFFICIAL_BUT_GENERIC'), true);
  assert.equal(record.failureReasons.includes('NO_OPERATING_BRIDGE'), true);
  assert.equal(record.failureReasons.includes('NO_BOTTLENECK_DIRECTNESS'), true);
});

test('bottleneck mention without operating bridge is rejected with specific failure', () => {
  const record = scoreSourceQuality({
    providerName: 'company_ir_direct_pdf',
    sourceGroup: 'official_company_ir',
    evidenceClass: 'issuer_exposure',
    documentTitle: 'Investor presentation',
    rawTextSnippet: 'The company discusses ABF substrate and package substrate product features for customers.',
    matchedBottleneckTerms: ['ABF substrate'],
    issuerRoleClass: 'substrate_capacity_owner',
    extractedCharCount: 160,
  });

  assert.equal(record.bottleneckDirectnessScore, 1);
  assert.equal(record.operatingBridgeScore, 0);
  assert.equal(record.acceptedEligible, false);
  assert.equal(record.failureReasons.includes('NO_OPERATING_BRIDGE'), true);
});

test('operating bridge without bottleneck directness is rejected with specific failure', () => {
  const record = scoreSourceQuality({
    providerName: 'company_ir_direct_pdf',
    sourceGroup: 'official_company_ir',
    evidenceClass: 'issuer_exposure',
    documentTitle: 'Earnings presentation',
    rawTextSnippet: 'Revenue guidance improved during the quarter.',
    issuerRoleClass: 'substrate_capacity_owner',
    extractedCharCount: 160,
  });

  assert.equal(record.operatingBridgeScore, 1);
  assert.equal(record.bottleneckDirectnessScore, 0);
  assert.equal(record.acceptedEligible, false);
  assert.equal(record.failureReasons.includes('NO_BOTTLENECK_DIRECTNESS'), true);
});

test('issuer mention without segment or exposure bridge is rejected', () => {
  const record = scoreSourceQuality({
    providerName: 'company_ir_direct_pdf',
    sourceGroup: 'official_company_ir',
    evidenceClass: 'issuer_exposure',
    issuer: 'PWR',
    documentTitle: 'Ticker overview',
    rawTextSnippet: 'PWR is mentioned in a list of companies.',
    extractedCharCount: 90,
  });

  assert.equal(record.issuerSegmentLinkScore, 0);
  assert.equal(record.failureReasons.includes('NO_ISSUER_SEGMENT_LINK'), true);
  assert.equal(record.acceptedEligible, false);
});

test('table-only document without table extraction is routed to extraction repair', () => {
  const record = scoreSourceQuality({
    providerName: 'company_ir_direct_pdf',
    sourceGroup: 'official_company_ir',
    evidenceClass: 'issuer_exposure',
    documentTitle: 'Capacity table',
    rawTextSnippet: 'ABF substrate capacity capex customer demand',
    matchedBottleneckTerms: ['ABF substrate'],
    matchedOperatingTerms: ['capacity', 'capex'],
    issuerRoleClass: 'substrate_capacity_owner',
    tableOnly: true,
    tableExtractionStatus: 'not_available',
    extractedCharCount: 120,
  });

  assert.equal(record.failureReasons.includes('TABLE_ONLY_UNPARSED'), true);
  assert.equal(record.acceptedEligible, false);
  assert.equal(record.extractionQuality.extractionFailureReason, 'table_only_unparsed');
});

test('provider gap rows remain provider gap diagnostics instead of source quality route split', () => {
  const record = scoreSourceQuality({
    providerName: 'adapter_proposal_only',
    providerRoute: 'adapter_proposal_only',
    evidenceClass: 'provider_data_gap',
    title: 'provider_data_gap provider gap requires adapter proposal',
    summary: 'Provider gap recorded; no evidence was collected or accepted.',
    failureClassification: 'PROVIDER_GAP',
  });

  assert.equal(record.diagnosticKind, 'provider_gap');
  assert.deepEqual(record.failureReasons, ['PROVIDER_GAP']);
  assert.equal(record.failureReasons.includes('NO_BOTTLENECK_DIRECTNESS'), false);
  assert.equal(record.failureReasons.includes('NO_OPERATING_BRIDGE'), false);
  assert.equal(record.acceptedEligible, false);
});

test('fixture rejection rows preserve fixture failure without generic source-universe blockers', () => {
  const record = scoreSourceQuality({
    providerName: 'edinet',
    sourceGroup: 'official_filing',
    evidenceClass: 'issuer_exposure',
    documentTitle: 'EDINET no-result fixture',
    fixtureKind: 'no_result_fixture',
    fixtureBackedProviderExecution: true,
    evidenceUse: 'rejected',
    accepted: false,
    failureClassification: 'NO_RESULT',
  });

  assert.equal(record.diagnosticKind, 'provider_fixture_rejection');
  assert.deepEqual(record.failureReasons, ['NO_RESULT']);
  assert.equal(record.failureReasons.includes('OFFICIAL_BUT_GENERIC'), false);
  assert.equal(record.failureReasons.includes('EXTRACTION_WEAK'), false);
  assert.equal(record.failureReasons.includes('NO_BOTTLENECK_DIRECTNESS'), false);
});

test('seed-source compatibility detects process bottleneck pushed through issuer route', () => {
  const mismatch = classifySeedSourceCompatibility({
    providerName: 'sec_10k',
    sourceBucket: 'official_filing',
    evidenceClass: 'issuer_exposure',
    bottleneckNode: 'interconnection study capacity',
    sourceQuery: 'PWR interconnection study capacity backlog',
  });
  assert.equal(mismatch.compatibility, 'mismatch');
  assert.equal(mismatch.blocker, 'SOURCE_SEED_ROUTE_MISMATCH');

  const mechanism = classifySeedSourceCompatibility({
    providerName: 'ferc_interconnection_reform',
    sourceGroup: 'official_government',
    evidenceClass: 'engineering_process',
    bottleneckNode: 'interconnection study capacity',
    sourceQuery: 'FERC interconnection queue duration network upgrade delay',
  });
  assert.equal(mechanism.compatibility, 'mechanism_only');
  assert.equal(mechanism.blocker, null);
});

test('source quality artifact summarizes terminal blockers and mutation boundaries', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-source-quality-'));
  try {
    const payload = buildSourceQualityScore({
      stagedProviderLiveExecution: {
        rawEvidence: [
          {
            providerName: 'sec_10k',
            sourceGroup: 'official_filing',
            evidenceClass: 'issuer_exposure',
            documentTitle: 'Annual report',
            rawTextSnippet: 'The company provides infrastructure services.',
            extractedCharCount: 100,
          },
          {
            providerName: 'ferc_interconnection_reform',
            sourceGroup: 'official_government',
            evidenceClass: 'engineering_process',
            bottleneckNode: 'interconnection study capacity',
            rawTextSnippet: 'Interconnection queue duration and network upgrade delay increased processing cost.',
            matchedBottleneckTerms: ['interconnection queue'],
            matchedOperatingTerms: ['queue duration', 'processing cost'],
            extractedCharCount: 160,
            accepted: true,
            failureClassification: 'ACCEPTED',
          },
        ],
      },
      generatedAt: '2026-05-24T00:00:00.000Z',
    });

    assert.equal(payload.recordCount, 2);
    assert.equal(payload.summary.officialButGenericCount, 1);
    assert.equal(payload.summary.terminalBlockerCount >= 1, true);
    assert.equal(payload.summary.acceptedEligibleCount, 1);
    assert.equal(payload.records[1].compatibility.compatibility, 'mechanism_only');
    assert.equal(payload.records[1].promotionEligible, false);
    assert.equal(payload.mutationBoundary.readinessPromotionWrites, 0);

    const artifactPath = await writeSourceQualityScoreArtifact(payload, path.join(tmp, 'source-quality-score.latest.json'));
    const saved = JSON.parse(await readFile(artifactPath, 'utf8'));
    assert.equal(saved.version, 'source-quality-score-v1');
    assert.equal(saved.failureTaxonomy.includes('OFFICIAL_BUT_GENERIC'), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
