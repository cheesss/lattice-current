import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { buildSelfHealingCandidates } from '../scripts/self-heal-sources.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

test('self-heal suggestion candidates preserve explicit non-politics category', () => {
  const candidates = buildSelfHealingCandidates({
    suggestions: [
      {
        id: 'suggestion-defense',
        feedName: 'Defense Feed',
        lang: 'en',
        type: 'rss-replacement',
        suggestedUrl: 'https://example.com/defense.xml',
        confidence: 91,
        category: 'defense',
        reason: 'replacement found',
      },
    ],
    discoveredSources: [],
    registryRecords: [],
    minConfidence: 70,
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].category, 'defense');
});

test('self-heal discovered-source candidates ignore draft and low-value dynamic Google News feeds', () => {
  const candidates = buildSelfHealingCandidates({
    suggestions: [],
    discoveredSources: [
      {
        id: 'draft-source',
        feedName: 'Draft Feed',
        category: 'cybersecurity',
        url: 'https://example.com/feed.xml',
        status: 'draft',
        confidence: 95,
      },
      {
        id: 'google-ukraine',
        feedName: 'Google News: ukraine',
        category: 'dt-ukraine-conflict',
        url: 'https://news.google.com/rss/search?q=ukraine&hl=en-US&gl=US&ceid=US:en',
        status: 'approved',
        confidence: 99,
      },
      {
        id: 'approved-source',
        feedName: 'Approved Feed',
        category: 'cybersecurity',
        url: 'https://example.org/feed.xml',
        status: 'approved',
        confidence: 88,
      },
    ],
    registryRecords: [],
    minConfidence: 70,
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].discoveredSourceId, 'approved-source');
});

test('self-heal suggestions can still propose explicit replacement URLs', () => {
  const candidates = buildSelfHealingCandidates({
    suggestions: [
      {
        id: 'replacement',
        feedName: 'Google News: ukraine',
        category: 'conflict',
        suggestedUrl: 'https://news.google.com/rss/search?q=site:kyivindependent.com+when:3d&hl=en-US&gl=US&ceid=US:en',
        confidence: 91,
      },
    ],
    discoveredSources: [],
    registryRecords: [],
    minConfidence: 70,
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].suggestionId, 'replacement');
});

test('self-heal runs source repair before rejecting failed probe candidates', () => {
  const source = readFileSync(resolve(__dirname, '../scripts/self-heal-sources.mjs'), 'utf8');
  assert.match(source, /attemptSourceRepair/);
  assert.match(source, /auto-repaired from/);
  assert.match(source, /sourceProbePassesGate/);
});
