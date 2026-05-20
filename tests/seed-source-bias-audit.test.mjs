import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  auditSeedSourceCoverage,
  normalizeMechanismSeed,
} from '../scripts/_shared/mechanism-seed-generator.mjs';
import {
  runMechanismSeedGeneration,
} from '../scripts/run-mechanism-seed-generation.mjs';

const generatedAt = '2026-05-19T00:00:00.000Z';

test('bias audit flags missing official, non-US, trade, and provider gaps during Phase A', () => {
  const seed = normalizeMechanismSeed({
    source: 'direct',
    themeKey: 'ai-ml',
    themeLabel: 'AI / Machine Learning',
    prompt: 'AI data center rack density grid interconnection transformer switchgear cooling bottleneck',
    seedTerms: ['AI data center power'],
  }, { generatedAt });

  const audit = auditSeedSourceCoverage(seed, {});
  assert.equal(audit.missing_sources.includes('missing_non_us_source'), true);
  assert.equal(audit.missing_sources.includes('missing_official_company_source'), true);
  assert.equal(audit.missing_sources.includes('missing_trade_press_source'), true);
  assert.equal(audit.provider_gap_labels.includes('provider_gap_dart'), true);
  assert.equal(audit.provider_gap_labels.includes('provider_gap_edinet'), true);
  assert.equal(audit.provider_gap_labels.includes('provider_gap_eu_ted'), true);
  assert.equal(audit.provider_gap_labels.includes('provider_gap_grid_interconnection_queue'), true);
});

test('bias audit improves when official and trade source refs are present', () => {
  const seed = normalizeMechanismSeed({
    source: 'direct',
    themeKey: 'defense-industrial',
    themeLabel: 'Defense Industrial',
    prompt: 'Defense missile solid rocket motor capacity energetic binder qualified supplier bottleneck',
    seedTerms: ['solid rocket motor capacity'],
    sourceRefs: [
      { sourceType: 'sec_filing', region: 'us' },
      { sourceType: 'defense.gov_contract', region: 'us' },
      { sourceType: 'trade_media', region: 'eu' },
    ],
  }, { generatedAt });

  assert.equal(seed.biasAudit.source_type_diversity >= 3, true);
  assert.equal(seed.biasAudit.official_source_count >= 1, true);
  assert.equal(seed.biasAudit.trade_source_count >= 1, true);
  assert.equal(seed.biasAudit.missing_sources.includes('missing_official_company_source'), false);
});

test('dry-run CLI runner writes only runtime artifact and reports no DB or queue writes', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-seed-'));
  const artifactOut = path.join(tmp, 'mechanism-seed-generation.latest.json');
  try {
    const artifact = await runMechanismSeedGeneration({
      dryRun: true,
      source: 'ontology',
      limit: 8,
      artifactOut,
      writeJsonl: false,
    });
    const persisted = JSON.parse(await readFile(artifactOut, 'utf8'));
    assert.equal(artifact.mode, 'dry-run');
    assert.equal(artifact.boundaries.dbWrites, 0);
    assert.equal(artifact.boundaries.approvalQueueWrites, 0);
    assert.equal(artifact.boundaries.canonicalWrites, 0);
    assert.equal(persisted.summary.generated > 0, true);
    assert.equal(persisted.seeds.every((seed) => seed.counterEvidenceQueries.length > 0), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
