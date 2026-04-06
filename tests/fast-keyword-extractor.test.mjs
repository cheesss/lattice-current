import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs as parseFastKeywordArgs } from '../scripts/fast-keyword-extractor.mjs';
import { buildFastArticleAnalysis, collectTrendKeywordStats, extractTopKeywordsFromText } from '../scripts/_shared/text-keywords.mjs';
import { filterKeywordsToHeadline, parseArgs as parseOllamaArgs } from '../scripts/ollama-article-analyzer.mjs';

test('fast keyword extractor parses durable CLI options', () => {
  const parsed = parseFastKeywordArgs(['--limit', '500', '--since', '2025-01-01', '--batch-size', '200', '--min-trend-count', '4', '--refresh-existing']);
  assert.equal(parsed.limit, 500);
  assert.equal(parsed.since, '2025-01-01');
  assert.equal(parsed.batchSize, 200);
  assert.equal(parsed.minTrendCount, 4);
  assert.equal(parsed.refreshExisting, true);
});

test('fast article analysis extracts stable keywords and metadata', () => {
  const analysis = buildFastArticleAnalysis({
    title: 'Iran oil exports jump as shipping insurers return to Gulf routes',
    summary: 'Tanker traffic, insurers and Gulf shipping lanes recover after de-escalation talks.',
    theme: 'energy',
  });

  assert.ok(analysis.keywords.includes('iran'));
  assert.ok(analysis.keywords.includes('shipping'));
  assert.equal(analysis.theme, 'energy');
  assert.equal(analysis.method, 'fast-keyword-extractor');
  assert.ok(analysis.confidence > 0.2);
  assert.ok(analysis.metadata.tokenCount > 0);
});

test('trend keyword stats aggregate recurring signal words', () => {
  const rows = [
    { publishedAt: '2025-01-01T00:00:00Z', ...buildFastArticleAnalysis({ title: 'Semiconductor export controls tighten in China', summary: '', theme: 'tech' }) },
    { publishedAt: '2025-01-02T00:00:00Z', ...buildFastArticleAnalysis({ title: 'Chip exports face tighter controls as China tensions rise', summary: '', theme: 'tech' }) },
    { publishedAt: '2025-01-03T00:00:00Z', ...buildFastArticleAnalysis({ title: 'China export rules hit semiconductor supply chains', summary: '', theme: 'tech' }) },
  ];

  const trends = collectTrendKeywordStats(rows, 2);
  assert.ok(trends.some((entry) => entry.keyword === 'china'));
  assert.ok(trends.some((entry) => entry.keyword === 'export'));
});

test('ollama analyzer parses new ambiguity-driven CLI options', () => {
  const parsed = parseOllamaArgs(['--mode', 'ambiguous', '--confidence-threshold', '0.4', '--limit', '25']);
  assert.equal(parsed.mode, 'ambiguous');
  assert.equal(parsed.confidenceThreshold, 0.4);
  assert.equal(parsed.limit, 25);
});

test('ollama keyword filter keeps only headline-grounded terms', () => {
  const filtered = filterKeywordsToHeadline(
    ['keywords', 'fast-path', 'iran', 'shipping', 'here'],
    { title: 'Iran shipping insurers return to Gulf routes', existing_keywords: ['iran', 'shipping'] },
  );
  assert.deepEqual(filtered, ['iran', 'shipping']);
});

test('keyword extraction removes stopword-heavy noise', () => {
  const keywords = extractTopKeywordsFromText('The live update says the market is watching the conflict in Iran and oil shipping routes', 6);
  assert.ok(!keywords.includes('the'));
  assert.ok(keywords.includes('iran'));
  assert.ok(keywords.includes('shipping'));
});
