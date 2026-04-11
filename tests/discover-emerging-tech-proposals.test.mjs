import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessTopicSourceProposalReadiness,
  proposeSourcesForNewTopic,
  selectTopicSourceProposalKeywords,
} from '../scripts/discover-emerging-tech.mjs';

function createMockProposalClient(existingUrls = []) {
  const knownUrls = new Set(existingUrls);
  const insertedPayloads = [];

  return {
    insertedPayloads,
    async query(sql, values = []) {
      if (sql.includes('FROM codex_proposals') && sql.includes('payload->>\'url\'')) {
        const url = String(values[0] || '');
        return knownUrls.has(url)
          ? { rows: [{ exists: 1 }], rowCount: 1, command: 'SELECT' }
          : { rows: [], rowCount: 0, command: 'SELECT' };
      }
      if (sql.includes('INSERT INTO codex_proposals')) {
        const payload = JSON.parse(values[0]);
        knownUrls.add(payload.url);
        insertedPayloads.push(payload);
        return { rows: [{ id: insertedPayloads.length }], rowCount: 1, command: 'INSERT' };
      }
      throw new Error(`Unexpected query in mock client: ${sql.slice(0, 80)}`);
    },
  };
}

function buildTopic(overrides = {}) {
  return {
    id: 'dt-quantum-computing',
    articleCount: 86,
    momentum: 2.1,
    sourceQualityScore: 0.88,
    diversity: 4,
    cohesion: 0.82,
    novelty: 0.56,
    promotionState: 'canonical',
    suppressionReason: null,
    normalizedTheme: 'quantum-computing',
    normalizedCategory: 'technology',
    parentTheme: 'technology-general',
    keywords: ['technology', 'quantum computing', 'qubit', 'research'],
    qualityFlags: [],
    codexMetadata: {
      normalization: {
        canonicalTheme: 'quantum-computing',
        canonicalParentTheme: 'technology-general',
        canonicalCategory: 'technology',
        promotionState: 'canonical',
        matchedKeywords: ['quantum computing', 'qubit'],
      },
      representativeTitles: [
        'IBM advances quantum computing error correction with 1000 qubit hardware',
        'Quantum computing startups focus on qubit stability and error correction',
        'Researchers push qubit networking for scalable quantum computing',
      ],
    },
    ...overrides,
  };
}

test('discovery source proposals reject suppressed or noisy topics', async () => {
  const client = createMockProposalClient();
  const topic = buildTopic({
    id: 'dt-sports-noise',
    promotionState: 'suppressed',
    suppressionReason: 'sports',
    qualityFlags: ['sports'],
    normalizedTheme: 'ai-ml',
  });

  const readiness = assessTopicSourceProposalReadiness(topic);
  assert.equal(readiness.ready, false);

  const inserted = await proposeSourcesForNewTopic(client, topic);
  assert.equal(inserted, 0);
  assert.equal(client.insertedPayloads.length, 0);
});

test('discovery source proposals suppress generic parent-theme keywords', async () => {
  const client = createMockProposalClient();
  const topic = buildTopic({
    id: 'dt-generic-tech',
    normalizedTheme: 'technology-general',
    parentTheme: 'technology-general',
    normalizedCategory: 'technology',
    keywords: ['technology', 'market', 'platform', 'news'],
    codexMetadata: {
      normalization: {
        canonicalTheme: 'technology-general',
        canonicalParentTheme: 'technology-general',
        canonicalCategory: 'technology',
        promotionState: 'canonical',
        matchedKeywords: ['technology'],
      },
      representativeTitles: [
        'Technology market update for software platforms',
        'Global technology trends and startup news roundup',
      ],
    },
  });

  assert.deepEqual(selectTopicSourceProposalKeywords(topic), []);

  const inserted = await proposeSourcesForNewTopic(client, topic);
  assert.equal(inserted, 0);
  assert.equal(client.insertedPayloads.length, 0);
});

test('discovery source proposals keep only specific high-signal keywords', async () => {
  const client = createMockProposalClient();
  const topic = buildTopic();

  const keywords = selectTopicSourceProposalKeywords(topic);
  assert.deepEqual(keywords, ['quantum computing', 'qubit']);
  assert.equal(keywords.includes('technology'), false);

  const inserted = await proposeSourcesForNewTopic(client, topic);
  assert.equal(inserted, 2);
  assert.equal(client.insertedPayloads.length, 2);
  assert.ok(client.insertedPayloads[0].url.includes(encodeURIComponent('"quantum computing"')));
  assert.ok(client.insertedPayloads.some((payload) => payload.url.includes('qubit')));
});

test('discovery source proposals stay conservative for ordinary watch topics', () => {
  const topic = buildTopic({
    id: 'dt-watch-only',
    promotionState: 'watch',
    articleCount: 58,
    momentum: 1.65,
    sourceQualityScore: 0.73,
    novelty: 0.22,
  });

  const readiness = assessTopicSourceProposalReadiness(topic);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'promotion-state-too-weak');
});
