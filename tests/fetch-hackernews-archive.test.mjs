import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildArticleRecord,
  initializeHackerNewsState,
  normalizeAlgoliaStory,
  parseArgs,
  shouldResetHackerNewsResume,
  shouldStoreStory,
} from '../scripts/fetch-hackernews-archive.mjs';

test('fetch-hackernews-archive parseArgs applies defaults and overrides', () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.since, '2021-01-01');
  assert.equal(defaults.scoreMin, 50);
  assert.equal(defaults.hitsPerPage, 100);
  assert.equal(defaults.limit, 0);

  const overridden = parseArgs(['--since', '2024-01-01', '--score-min', '75', '--hits-per-page', '250', '--max-pages', '6', '--limit', '100']);
  assert.equal(overridden.since, '2024-01-01');
  assert.equal(overridden.scoreMin, 75);
  assert.equal(overridden.hitsPerPage, 250);
  assert.equal(overridden.maxPages, 6);
  assert.equal(overridden.limit, 100);
});

test('fetch-hackernews-archive only stores story items with score, title, url, and recent timestamp', () => {
  const options = { scoreMin: 50, sinceUnix: 1_700_000_000 };
  assert.equal(shouldStoreStory({ type: 'story', score: 80, title: 'A', url: 'https://x', time: 1_700_000_001 }, options), true);
  assert.equal(shouldStoreStory({ type: 'comment', score: 80, title: 'A', url: 'https://x', time: 1_700_000_001 }, options), false);
  assert.equal(shouldStoreStory({ type: 'story', score: 10, title: 'A', url: 'https://x', time: 1_700_000_001 }, options), false);
  assert.equal(shouldStoreStory({ type: 'story', score: 80, title: '', url: 'https://x', time: 1_700_000_001 }, options), false);
  assert.equal(shouldStoreStory({ type: 'story', score: 80, title: 'A', url: 'https://x', time: 1_600_000_000 }, options), false);
});

test('fetch-hackernews-archive builds normalized article records', () => {
  const record = buildArticleRecord({
    id: 123,
    score: 88,
    descendants: 17,
    by: 'pg',
    time: 1_700_000_000,
    title: 'Silicon photonics startup raises funding',
    url: 'https://example.com/story',
  });
  assert.equal(record.source, 'hackernews');
  assert.equal(record.theme, 'emerging-tech');
  assert.match(record.summary, /Hacker News score 88/);
  assert.equal(record.url, 'https://example.com/story');
});

test('fetch-hackernews-archive normalizes Algolia story hits', () => {
  const item = normalizeAlgoliaStory({
    objectID: '123',
    points: 77,
    num_comments: 19,
    author: 'pg',
    created_at_i: 1_700_000_000,
    story_title: 'Quantum compiler release',
    story_url: 'https://example.com/qc',
  });
  assert.equal(item.type, 'story');
  assert.equal(item.id, 123);
  assert.equal(item.score, 77);
  assert.equal(item.descendants, 19);
  assert.equal(item.title, 'Quantum compiler release');
  assert.equal(item.url, 'https://example.com/qc');
});

test('fetch-hackernews-archive resets resume when query mode or filters change', () => {
  const previousState = {
    stateVersion: 1,
    queryMode: 'firebase',
    since: '2021-01-01',
    scoreMin: 50,
    hitsPerPage: 100,
    lastProcessedPage: 9,
  };
  assert.equal(
    shouldResetHackerNewsResume({ since: '2021-01-01', scoreMin: 50, hitsPerPage: 100 }, previousState),
    true,
  );

  const nextState = initializeHackerNewsState(
    { since: '2021-01-01', scoreMin: 20, hitsPerPage: 100 },
    {
      stateVersion: 2,
      queryMode: 'algolia',
      since: '2021-01-01',
      scoreMin: 50,
      hitsPerPage: 100,
      lastProcessedPage: 9,
    },
  );
  assert.equal(nextState.resumeReset, true);
  assert.equal(nextState.lastProcessedPage, 0);
});

test('fetch-hackernews-archive resumes from next page when config matches', () => {
  const state = initializeHackerNewsState(
    { since: '2021-01-01', scoreMin: 20, hitsPerPage: 100 },
    {
      stateVersion: 2,
      queryMode: 'algolia',
      since: '2021-01-01',
      scoreMin: 20,
      hitsPerPage: 100,
      lastProcessedPage: 10,
    },
  );
  assert.equal(state.resumeReset, false);
  assert.equal(state.resumeFromPage, 10);
  assert.equal(state.lastProcessedPage, 10);
});
