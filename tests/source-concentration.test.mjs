import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSourceConcentration,
  computeLegacyDiversity,
} from '../scripts/_shared/source-concentration.mjs';

test('computeSourceConcentration returns HHI=1 for single source', () => {
  const articles = [
    { publisher_group: 'ft' },
    { publisher_group: 'ft' },
    { publisher_group: 'ft' },
  ];
  const c = computeSourceConcentration(articles);
  assert.equal(c.hhi, 1);
  assert.equal(c.effectiveSourceCount, 1);
  assert.equal(c.topShare, 1);
});

test('computeSourceConcentration returns low HHI for many balanced sources', () => {
  const articles = Array.from({ length: 10 }, (_, i) => ({ publisher_group: `pub${i}` }));
  const c = computeSourceConcentration(articles);
  assert.equal(c.hhi, 0.1);
  assert.equal(c.effectiveSourceCount, 10);
});

test('computeSourceConcentration collapses wire duplicates by default', () => {
  // 4 different publishers all republishing the same Reuters wire.
  const articles = [
    { publisher_group: 'bbc', wire_source: 'reuters' },
    { publisher_group: 'guardian', wire_source: 'reuters' },
    { publisher_group: 'cnbc', wire_source: 'reuters' },
    { publisher_group: 'marketwatch', wire_source: 'reuters' },
  ];
  const c = computeSourceConcentration(articles);
  assert.equal(c.hhi, 1);
  assert.equal(c.wireDominated, true);
  assert.equal(c.bucketCount, 1);
});

test('computeSourceConcentration keeps wire separate when collapseWire=false', () => {
  const articles = [
    { publisher_group: 'bbc', wire_source: 'reuters' },
    { publisher_group: 'guardian', wire_source: 'reuters' },
  ];
  const c = computeSourceConcentration(articles, { collapseWire: false });
  assert.equal(c.bucketCount, 2);
  assert.equal(c.wireDominated, false);
});

test('computeLegacyDiversity still reflects unique publishers/articles ratio', () => {
  const articles = [
    { publisher_group: 'bbc' },
    { publisher_group: 'cnbc' },
    { publisher_group: 'cnbc' },
  ];
  const diversity = computeLegacyDiversity(articles);
  // 2 unique groups / 3 articles
  assert.equal(diversity, 0.667);
});

test('computeSourceConcentration handles empty inputs gracefully', () => {
  const c = computeSourceConcentration([]);
  assert.equal(c.hhi, null);
  assert.equal(c.effectiveSourceCount, 0);
  assert.equal(c.wireDominated, false);
});
