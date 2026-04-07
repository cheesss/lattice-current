import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSelfHealingCandidates } from '../scripts/self-heal-sources.mjs';

test('self-heal candidates prioritize degraded feed replacements and approved sources', () => {
  const candidates = buildSelfHealingCandidates({
    suggestions: [
      {
        id: 'suggestion-1',
        feedName: 'Broken Feed',
        lang: 'en',
        type: 'rss-replacement',
        suggestedUrl: 'https://feeds.bbci.co.uk/news/rss.xml',
        confidence: 91,
        reason: 'replacement found',
        topics: ['bbc'],
      },
    ],
    discoveredSources: [
      {
        id: 'source-1',
        feedName: 'Broken Feed',
        lang: 'en',
        category: 'politics',
        url: 'https://feeds.bbci.co.uk/news/rss.xml',
        status: 'approved',
        confidence: 88,
        reason: 'candidate',
        topics: ['bbc'],
      },
    ],
    registryRecords: [
      {
        feedName: 'Broken Feed',
        status: 'degraded',
      },
    ],
    minConfidence: 70,
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].degradedFeed, true);
  assert.equal(candidates[0].url, 'https://feeds.bbci.co.uk/news/rss.xml');
  assert.equal(candidates[0].discoveredSourceId, 'source-1');
  assert.equal(candidates[0].suggestionId, 'suggestion-1');
});
