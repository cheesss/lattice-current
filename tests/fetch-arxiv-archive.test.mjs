import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildArticleRecord,
  buildArxivQuery,
  extractArxivEntries,
  parseArgs,
} from '../scripts/fetch-arxiv-archive.mjs';

test('fetch-arxiv-archive parseArgs applies defaults and overrides', () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.since, '2021-01-01');
  assert.equal(defaults.batchSize, 100);
  assert.ok(defaults.categories.includes('cs.AI'));

  const overridden = parseArgs(['--since', '2024-01-01', '--batch-size', '50', '--categories', 'cs.AI,cs.LG']);
  assert.equal(overridden.since, '2024-01-01');
  assert.equal(overridden.batchSize, 50);
  assert.deepEqual(overridden.categories, ['cs.AI', 'cs.LG']);
});

test('fetch-arxiv-archive builds OR query from categories', () => {
  assert.equal(buildArxivQuery(['cs.AI', 'cs.LG']), 'cat:cs.AI+OR+cat:cs.LG');
});

test('fetch-arxiv-archive extracts normalized entries from arxiv atom feed', () => {
  const entries = extractArxivEntries(`
    <feed>
      <entry>
        <id>http://arxiv.org/abs/1234.5678v1</id>
        <updated>2026-04-01T10:00:00Z</updated>
        <published>2026-03-31T09:00:00Z</published>
        <title>  Optical AI  Accelerator </title>
        <summary>  New photonic model for inference. </summary>
        <author><name>Jane Doe</name></author>
        <author><name>John Roe</name></author>
        <link rel="alternate" href="https://arxiv.org/abs/1234.5678v1" />
        <category term="cs.AI" />
        <category term="cs.LG" />
      </entry>
    </feed>
  `);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, 'Optical AI Accelerator');
  assert.deepEqual(entries[0].categories, ['cs.AI', 'cs.LG']);
  assert.deepEqual(entries[0].authors, ['Jane Doe', 'John Roe']);
});

test('fetch-arxiv-archive builds normalized article records', () => {
  const record = buildArticleRecord({
    publishedAt: '2026-03-31T09:00:00Z',
    title: 'Optical AI Accelerator',
    summary: 'New photonic model for inference.',
    authors: ['Jane Doe'],
    categories: ['cs.AI', 'cs.LG'],
    url: 'https://arxiv.org/abs/1234.5678v1',
  });
  assert.equal(record.source, 'arxiv');
  assert.equal(record.theme, 'emerging-tech');
  assert.match(record.summary, /New photonic model/);
  assert.match(record.summary, /categories cs\.AI, cs\.LG/);
});
