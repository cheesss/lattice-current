import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isLowValueGoogleNewsSource,
  isLowValueGoogleNewsSourceName,
  normalizeGoogleNewsQueryText,
  parseGoogleNewsSearchQuery,
} from '../scripts/_shared/google-news-source-policy.mjs';

test('Google News policy blocks dynamic single-keyword query feeds', () => {
  assert.equal(isLowValueGoogleNewsSource({
    url: 'https://news.google.com/rss/search?q=ukraine&hl=en-US&gl=US&ceid=US:en',
    feedName: 'Google News: ukraine',
    category: 'dt-ukraine-conflict',
    topics: ['dt-ukraine-conflict'],
  }), true);
});

test('Google News policy allows site-qualified proxy feeds', () => {
  assert.equal(isLowValueGoogleNewsSource({
    url: 'https://news.google.com/rss/search?q=site:kyivindependent.com+when:3d&hl=en-US&gl=US&ceid=US:en',
    feedName: 'Google News: Kyiv Independent',
    category: 'conflict',
    topics: ['conflict'],
  }), false);
});

test('Google News policy ignores curated non-dynamic broad feeds', () => {
  assert.equal(isLowValueGoogleNewsSource({
    url: 'https://news.google.com/rss/search?q=OpenAI+ChatGPT+when:7d&hl=en-US&gl=US&ceid=US:en',
    feedName: 'OpenAI News',
    category: 'ai-ml',
    topics: ['ai-ml'],
  }), false);
});

test('Google News policy can suppress existing article source labels', () => {
  assert.equal(isLowValueGoogleNewsSourceName('Google News: ukraine'), true);
  assert.equal(isLowValueGoogleNewsSourceName('Google News: qubit'), false);
  assert.equal(isLowValueGoogleNewsSourceName('Reuters'), false);
});

test('Google News query parsing normalizes quotes and operators', () => {
  const query = parseGoogleNewsSearchQuery('https://news.google.com/rss/search?q=%22ukraine%20war%22+OR+military&hl=en-US');
  assert.equal(query, '"ukraine war" OR military');
  assert.equal(normalizeGoogleNewsQueryText(query), 'ukraine war military');
});
