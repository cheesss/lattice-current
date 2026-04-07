import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildArticleRecord,
  parseArgs,
  shouldStoreStory,
} from '../scripts/fetch-hackernews-archive.mjs';

test('fetch-hackernews-archive parseArgs applies defaults and overrides', () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.since, '2021-01-01');
  assert.equal(defaults.scoreMin, 50);
  assert.equal(defaults.limit, 0);

  const overridden = parseArgs(['--since', '2024-01-01', '--score-min', '75', '--limit', '100']);
  assert.equal(overridden.since, '2024-01-01');
  assert.equal(overridden.scoreMin, 75);
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
