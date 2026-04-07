import test from 'node:test';
import assert from 'node:assert/strict';

import { getFeedDomain, isTrustedFeedUrl } from '../scripts/_shared/feed-trust.mjs';

test('feed trust resolves domains and trusted hosts', () => {
  assert.equal(getFeedDomain('https://feeds.bbci.co.uk/news/rss.xml'), 'feeds.bbci.co.uk');
  assert.equal(isTrustedFeedUrl('https://feeds.bbci.co.uk/news/rss.xml'), true);
  assert.equal(isTrustedFeedUrl('https://subdomain.theguardian.com/feed.xml'), false);
  assert.equal(isTrustedFeedUrl('https://totally-unknown-example.invalid/feed.xml'), false);
});
