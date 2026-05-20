import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyPublisher,
  detectWireSource,
  classifyArticleSource,
} from '../scripts/_shared/source-classifier.mjs';

test('classifyPublisher collapses multilingual EuroNews feeds into one group', () => {
  const en = classifyPublisher({ url: 'https://euronews.com/news/1' });
  const fr = classifyPublisher({ url: 'https://fr.euronews.com/news/1' });
  const de = classifyPublisher({ url: 'https://de.euronews.com/news/1' });
  assert.equal(en.publisherGroup, 'euronews');
  assert.equal(fr.publisherGroup, 'euronews');
  assert.equal(de.publisherGroup, 'euronews');
});

test('classifyPublisher resolves parent domain when exact host misses', () => {
  const result = classifyPublisher({ url: 'https://www.cnbc.com/2026/04/17/story' });
  assert.equal(result.publisherGroup, 'cnbc');
  assert.equal(result.marketRelevance, 'high');
});

test('classifyPublisher returns low relevance for unmapped domains', () => {
  const result = classifyPublisher({ url: 'https://example-unknown.test/article' });
  assert.equal(result.publisherGroup, null);
  assert.equal(result.marketRelevance, 'low');
});

test('detectWireSource detects AP via google-news syndication URL', () => {
  const wire = detectWireSource({
    url: 'https://news.google.com/rss/search?q=site:apnews.com/story-123',
    title: 'Apple shares rise',
    body: 'NEW YORK (AP) - Apple shares rose...',
  });
  assert.equal(wire, 'ap');
});

test('detectWireSource detects Reuters by body lead', () => {
  const wire = detectWireSource({
    url: 'https://www.marketwatch.com/story',
    title: 'Oil edges higher',
    body: 'LONDON (Reuters) - Oil prices ticked higher on Monday...',
  });
  assert.equal(wire, 'reuters');
});

test('detectWireSource returns null when no pattern matches', () => {
  const wire = detectWireSource({
    url: 'https://www.bbc.com/news/1',
    title: 'BBC original report',
    body: 'In an exclusive BBC investigation ...',
  });
  assert.equal(wire, null);
});

test('classifyArticleSource returns combined metadata', () => {
  const result = classifyArticleSource({
    url: 'https://www.ft.com/content/abc',
    source: 'Financial Times',
    title: 'Markets end week lower',
    body: 'Equities fell...',
  });
  assert.equal(result.publisherGroup, 'ft');
  assert.equal(result.marketRelevance, 'high');
  assert.equal(result.wireSource, null);
});
