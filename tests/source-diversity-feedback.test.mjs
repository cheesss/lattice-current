import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildSourceDiversityFeedback,
  normalizeSourceBucket,
  writeSourceDiversityFeedbackArtifact,
} from '../scripts/_shared/source-diversity-feedback.mjs';

test('source diversity feedback normalizes source buckets', () => {
  assert.equal(normalizeSourceBucket({ providerName: 'SEC 10-K filing' }), 'official_filing');
  assert.equal(normalizeSourceBucket({ sourceGroup: 'official_company_ir' }), 'company_ir');
  assert.equal(normalizeSourceBucket({ sourceType: 'PJM grid operator queue report' }), 'grid_operator');
  assert.equal(normalizeSourceBucket({ reportPath: 'final-investment-report-dry-run.html' }), 'generated_report');
});

test('source diversity feedback applies report cooldown and underrepresented class recommendations', () => {
  const payload = buildSourceDiversityFeedback({
    backfillQueue: {
      tasks: [
        { evidenceClass: 'supplier_capacity', providerRoute: 'official_filing' },
        { evidenceClass: 'power_constraint', providerRoute: 'grid_official_readonly' },
      ],
      acceptedPromotionEvidence: [],
    },
    reports: [
      { subject: 'AI data center power interconnection bottleneck', reportPath: 'data/reports/example/report.html' },
    ],
  });
  assert.equal(payload.reportCooldowns.length >= 1, true);
  assert.equal(payload.sourceBucketQuotaWarnings.some((row) => row.warning === 'repeated_grid_power_or_data_center_subject'), true);
  assert.equal(payload.underrepresentedEvidenceClasses.some((row) => row.evidenceClass === 'material_input'), true);
  assert.equal(payload.recommendedNextAction, 'create_targeted_backfill_task');
  assert.equal(payload.mutationBoundary.reportCandidateWrites, 0);
});

test('source diversity feedback exposes bucket distribution without readiness promotion', () => {
  const payload = buildSourceDiversityFeedback({
    sourceProviderActivation: {
      records: [
        { providerName: 'edinet', evidenceClass: 'issuer_exposure' },
        { providerName: 'company_ir_direct_pdf', evidenceClass: 'holdout_validation' },
        { providerName: 'provider_data_gap', evidenceClass: 'provider_data_gap' },
      ],
    },
  });
  assert.equal(payload.sourceBucketDistribution.counts.official_filing, 1);
  assert.equal(payload.sourceBucketDistribution.counts.company_ir, 1);
  assert.equal(payload.sourceBucketDistribution.counts.provider_gap, 1);
  assert.equal(payload.sourceSelectionPolicy.rawEvidenceRaisesReadiness, false);
  assert.equal(payload.mutationBoundary.readinessPromotionWrites, 0);
});

test('source diversity feedback writes artifact', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-source-diversity-'));
  try {
    const payload = buildSourceDiversityFeedback();
    const artifactPath = await writeSourceDiversityFeedbackArtifact(payload, path.join(tmp, 'source-diversity-feedback.latest.json'));
    const saved = JSON.parse(await readFile(artifactPath, 'utf8'));
    assert.equal(saved.version, 'source-diversity-feedback-v1');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
