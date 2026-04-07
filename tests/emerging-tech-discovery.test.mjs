import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMonthlyCounts,
  chooseClusterCount,
  computeSourceQuality,
  computeMomentum,
  cosineSimilarity,
  deriveTopicId,
  runKMeans,
  tokenizeDiscoveryText,
} from '../scripts/_shared/emerging-tech-discovery.mjs';

test('emerging-tech tokenization removes stopwords and keeps meaningful keywords', () => {
  const tokens = tokenizeDiscoveryText('The new silicon photonics platform for data-center optics');
  assert.deepEqual(tokens.slice(0, 4), ['silicon', 'photonics', 'platform', 'data-center']);
});

test('emerging-tech momentum compares recent and previous windows', () => {
  const counts = buildMonthlyCounts([
    { publishedAt: '2025-01-05T00:00:00Z' },
    { publishedAt: '2025-01-06T00:00:00Z' },
    { publishedAt: '2025-07-01T00:00:00Z' },
    { publishedAt: '2025-07-02T00:00:00Z' },
    { publishedAt: '2025-07-03T00:00:00Z' },
    { publishedAt: '2025-08-03T00:00:00Z' },
  ]);
  const momentum = computeMomentum(counts, 2, 2);
  assert.ok(momentum.ratio >= 1);
});

test('emerging-tech deriveTopicId is stable for the same keyword set', () => {
  assert.equal(
    deriveTopicId(['silicon', 'photonics', 'optical']),
    deriveTopicId(['silicon', 'photonics', 'optical']),
  );
});

test('emerging-tech kmeans groups simple separated embeddings', () => {
  const clusters = runKMeans([
    { embedding: [1, 0], title: 'a' },
    { embedding: [0.9, 0.1], title: 'b' },
    { embedding: [0, 1], title: 'c' },
    { embedding: [0.1, 0.95], title: 'd' },
  ], 2, 10);
  assert.equal(clusters.length, 2);
  assert.ok(cosineSimilarity(clusters[0].centroid, clusters[1].centroid) < 0.9);
  assert.ok(chooseClusterCount(500) >= 20);
});

test('emerging-tech source quality rewards multi-type coverage over single-source concentration', () => {
  const mixed = computeSourceQuality([
    { source: 'arxiv' },
    { source: 'guardian' },
    { source: 'nyt' },
    { source: 'hackernews' },
  ]);
  const concentrated = computeSourceQuality([
    { source: 'arxiv' },
    { source: 'arxiv' },
    { source: 'arxiv' },
    { source: 'arxiv' },
  ]);
  assert.ok(mixed.sourceQualityScore > concentrated.sourceQualityScore);
  assert.equal(mixed.distinctSourceCount, 4);
  assert.ok(mixed.effectiveSourceCount > concentrated.effectiveSourceCount);
});
