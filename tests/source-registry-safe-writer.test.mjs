import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  runSourceProviderActivation,
  buildSourceProviderActivationSurface,
} from '../scripts/_shared/source-registry-safe-writer.mjs';

test('safe writer persists staged/source-provider artifact without readiness or canonical writes', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-source-registry-'));
  const artifactPath = path.join(tmp, 'source-provider-activation.latest.json');
  const payload = await runSourceProviderActivation([
    {
      candidateId: 'official-grid-rss',
      providerName: 'official-grid-rss',
      evidenceClass: 'grid_interconnection',
      sourceUrl: 'https://example.com/rss',
      probe: {
        status: 'ok',
        connectorKind: 'rss',
        qualityScore: 0.82,
        qualityBreakdown: { recentItemCount: 5, itemCount: 12 },
      },
    },
  ], { artifactPath });

  const onDisk = JSON.parse(await readFile(artifactPath, 'utf8'));
  assert.equal(onDisk.records.length, 1);
  assert.equal(payload.records[0].status, 'active_limited');
  assert.equal(payload.records[0].reviewGatedActivation, true);
  assert.equal(payload.records[0].fixtureStatus, 'fixture_missing');
  assert.equal(payload.records[0].parserStatus, 'schema_missing');
  assert.equal(payload.boundaries.canonicalWrites, 0);
  assert.equal(payload.boundaries.readinessPromotionWrites, 0);
  assert.equal(payload.boundaries.reportCandidateWrites, 0);
  assert.equal(payload.boundaries.portfolioActionWrites, 0);
});

test('safe writer maintains status history and dashboard-safe surface', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-source-registry-'));
  const artifactPath = path.join(tmp, 'source-provider-activation.latest.json');
  const first = await runSourceProviderActivation([
    {
      candidateId: 'weak-source',
      providerName: 'weak-source',
      evidenceClass: 'issuer_exposure',
      sourceUrl: 'https://example.com/weak',
    },
  ], { artifactPath });
  const second = await runSourceProviderActivation([
    {
      candidateId: 'weak-source',
      providerName: 'weak-source',
      evidenceClass: 'issuer_exposure',
      sourceUrl: 'https://example.com/weak',
      probe: {
        status: 'failed',
        connectorKind: 'html-list',
        qualityScore: 0.1,
        qualityBreakdown: { recentItemCount: 0, itemCount: 0 },
      },
    },
  ], { artifactPath, existing: first });
  assert.equal(second.records[0].status, 'quarantined');
  assert.equal(second.records[0].statusHistory.length >= 2, true);
  const surface = buildSourceProviderActivationSurface(second);
  assert.equal(surface.counts.quarantined, 1);
  assert.equal(surface.candidates[0].activationBlocker, 'probe_failed_or_quality_below_threshold');
  assert.equal(surface.counts.byFixtureStatus.fixture_missing, 1);
  assert.equal(surface.audit.rawRecords.length, 1);
});
