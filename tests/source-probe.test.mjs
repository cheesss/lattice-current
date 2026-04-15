/**
 * tests/source-probe.test.mjs
 *
 * Unit tests for scripts/_shared/source-probe.mjs
 * Uses node:test. No external network access — fetch is mocked per test.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { probeSource } from '../scripts/_shared/source-probe.mjs';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal RSS XML string with `count` items.
 * `recentCount` items will have a pubDate within the last 24 hours.
 * Remaining items get a date from 30 days ago.
 */
function buildRssFixture(count = 10, recentCount = 5) {
  const now = Date.now();
  const recentDate = new Date(now - 24 * 60 * 60 * 1000).toUTCString();      // yesterday
  const oldDate = new Date(now - 30 * 24 * 60 * 60 * 1000).toUTCString();    // 30 days ago

  let items = '';
  for (let i = 1; i <= count; i++) {
    const pubDate = i <= recentCount ? recentDate : oldDate;
    items += `
    <item>
      <title>Article ${i} about geopolitics and trade</title>
      <link>https://example.com/article-${i}</link>
      <pubDate>${pubDate}</pubDate>
    </item>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <link>https://example.com</link>
    <description>Example news feed</description>
    ${items}
  </channel>
</rss>`;
}

/**
 * Build a minimal HTML page with an alternate RSS feed link.
 */
function buildHtmlWithAlternateFeed(feedHref = '/feed.xml') {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Example Site</title>
  <link rel="alternate" type="application/rss+xml" title="RSS Feed" href="${feedHref}" />
</head>
<body><p>Welcome to Example Site</p></body>
</html>`;
}

/**
 * Build a plain HTML page with no feed links.
 */
function buildPlainHtml() {
  return `<!DOCTYPE html>
<html>
<head><title>Plain Site</title></head>
<body>
  <p>No feed here.</p>
  <a href="/about">About</a>
</body>
</html>`;
}

/**
 * Create a mock fetch function that returns a fixed response.
 */
function mockFetchFixed({ body, contentType = 'text/html; charset=utf-8', status = 200 }) {
  return async (_url, _opts) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
      text: async () => body,
    };
  };
}

/**
 * Create a mock fetch function that routes responses based on URL substring matches.
 * `routes` is an array of { match: string|RegExp, response: { body, contentType, status } }.
 * Falls through to `defaultResponse` if no match.
 */
function mockFetchRouter(routes, defaultResponse = { body: '', contentType: 'text/html', status: 404 }) {
  return async (url, _opts) => {
    for (const route of routes) {
      const matches =
        typeof route.match === 'string' ? url.includes(route.match) : route.match.test(url);
      if (matches) {
        const { body, contentType = 'text/html; charset=utf-8', status = 200 } = route.response;
        return {
          ok: status >= 200 && status < 300,
          status,
          headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
          text: async () => body,
        };
      }
    }
    // Default: 404
    const { body, contentType = 'text/html', status } = defaultResponse;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
      text: async () => body,
    };
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('source-probe', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -------------------------------------------------------------------------
  // Test 1: valid RSS URL returns success
  // -------------------------------------------------------------------------
  it('valid RSS URL returns success', async () => {
    const rssBody = buildRssFixture(10, 5);
    globalThis.fetch = mockFetchFixed({
      body: rssBody,
      contentType: 'application/rss+xml',
    });

    const result = await probeSource('https://example.com/feed.xml', { theme: 'geopolitics' });

    assert.equal(result.status, 'success', `Expected status=success, got ${result.status}`);
    assert.equal(result.connectorKind, 'rss', `Expected connectorKind=rss, got ${result.connectorKind}`);
    assert.ok(result.qualityScore > 0, `Expected qualityScore > 0, got ${result.qualityScore}`);
    assert.ok(result.qualityBreakdown.itemCount >= 10, 'Expected at least 10 items');
    assert.ok(result.qualityBreakdown.recentItemCount >= 5, 'Expected at least 5 recent items');
    assert.ok(result.sampleItems.length > 0, 'Expected sampleItems to be populated');
    assert.ok(result.traceId.startsWith('probe-'), 'Expected traceId to start with "probe-"');
    assert.equal(result.resolvedUrl, 'https://example.com/feed.xml');
  });

  // -------------------------------------------------------------------------
  // Test 2: homepage with alternate feed link resolves to feed
  // -------------------------------------------------------------------------
  it('homepage with alternate feed link resolves to feed', async () => {
    const rssBody = buildRssFixture(10, 5);
    const htmlBody = buildHtmlWithAlternateFeed('/feed.xml');

    globalThis.fetch = mockFetchRouter([
      {
        match: '/feed.xml',
        response: { body: rssBody, contentType: 'application/rss+xml', status: 200 },
      },
      {
        match: 'example.com',
        response: { body: htmlBody, contentType: 'text/html', status: 200 },
      },
    ]);

    const result = await probeSource('https://example.com/', { theme: 'geopolitics' });

    assert.equal(
      result.connectorKind,
      'html-alternate-feed',
      `Expected connectorKind=html-alternate-feed, got ${result.connectorKind}`
    );
    assert.ok(
      result.resolvedUrl && result.resolvedUrl.includes('/feed.xml'),
      `Expected resolvedUrl to include /feed.xml, got ${result.resolvedUrl}`
    );
    assert.ok(result.qualityBreakdown.itemCount >= 10, 'Expected at least 10 items from the alternate feed');
  });

  // -------------------------------------------------------------------------
  // Test 3: homepage without feed returns failed or partial, nextAction reject or manual-adapter
  // -------------------------------------------------------------------------
  it('homepage without feed returns failed or manual-required', async () => {
    const plainHtml = buildPlainHtml();

    // All adapters get plain HTML with no feed indicators, no sitemap, no JSON-LD
    globalThis.fetch = mockFetchFixed({ body: plainHtml, contentType: 'text/html', status: 200 });

    const result = await probeSource('https://nofeed.example.com/', { theme: 'finance' });

    assert.ok(
      result.status === 'failed' || result.status === 'partial' || result.status === 'manual-required',
      `Expected failed/partial/manual-required, got ${result.status}`
    );
    assert.ok(
      result.nextAction === 'reject' || result.nextAction === 'manual-adapter',
      `Expected nextAction=reject or manual-adapter, got ${result.nextAction}`
    );
  });

  // -------------------------------------------------------------------------
  // Test 4: WordPress /feed/ convention resolves
  // -------------------------------------------------------------------------
  it('WordPress /feed/ convention resolves', async () => {
    const rssBody = buildRssFixture(8, 4);
    const plainHtml = buildPlainHtml(); // no alternate feed link

    globalThis.fetch = mockFetchRouter(
      [
        {
          // The WordPress /feed/ path
          match: /example\.com\/feed\//,
          response: { body: rssBody, contentType: 'application/rss+xml', status: 200 },
        },
        {
          // Everything else (homepage, alternate feed attempt, other WP paths) → plain HTML
          match: 'example.com',
          response: { body: plainHtml, contentType: 'text/html', status: 200 },
        },
      ],
      { body: plainHtml, contentType: 'text/html', status: 404 }
    );

    const result = await probeSource('https://example.com/', { theme: 'defense' });

    assert.equal(
      result.connectorKind,
      'wordpress-rss',
      `Expected connectorKind=wordpress-rss, got ${result.connectorKind}`
    );
    assert.ok(
      result.resolvedUrl && result.resolvedUrl.includes('/feed/'),
      `Expected resolvedUrl to include /feed/, got ${result.resolvedUrl}`
    );
  });

  // -------------------------------------------------------------------------
  // Test 5: probe result contains real quality info (not generic skipped message)
  // -------------------------------------------------------------------------
  it('probe result contains real quality information, not a generic message', async () => {
    const rssBody = buildRssFixture(10, 5);
    globalThis.fetch = mockFetchFixed({
      body: rssBody,
      contentType: 'application/rss+xml',
    });

    const result = await probeSource('https://example.com/feed.xml', { theme: 'shipping' });

    // The result must include structured quality data — not just a generic message
    assert.ok(typeof result.qualityScore === 'number', 'qualityScore should be a number');
    assert.ok(result.qualityBreakdown !== null, 'qualityBreakdown should be present');
    assert.ok(typeof result.qualityBreakdown.itemCount === 'number', 'qualityBreakdown.itemCount should be a number');
    assert.ok(Array.isArray(result.sampleItems), 'sampleItems should be an array');
    assert.ok(result.sampleItems.length > 0, 'sampleItems should not be empty for a valid feed');
    assert.ok(result.resolvedUrl !== null, 'resolvedUrl should be set for a successful probe');
    assert.ok(result.traceId, 'traceId should be present');

    // Verify sampleItems shape
    const first = result.sampleItems[0];
    assert.ok('title' in first, 'sampleItem should have title');
    assert.ok('url' in first, 'sampleItem should have url');
    assert.ok('publishedAt' in first, 'sampleItem should have publishedAt');
  });

  // -------------------------------------------------------------------------
  // Test 6: invalid URL returns failed + reject immediately
  // -------------------------------------------------------------------------
  it('invalid URL returns reject immediately', async () => {
    // fetch should never be called for an invalid URL
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error('fetch should not be called for invalid URL');
    };

    const result = await probeSource('not-a-url');

    assert.equal(result.status, 'failed', `Expected status=failed, got ${result.status}`);
    assert.equal(result.nextAction, 'reject', `Expected nextAction=reject, got ${result.nextAction}`);
    assert.ok(result.errors.length > 0, 'Expected at least one error entry');
    assert.ok(
      result.errors.some((e) => e.adapter === 'validation'),
      'Expected a validation error entry'
    );
    assert.equal(fetchCalled, false, 'fetch should not be called for invalid URL');
    assert.equal(result.resolvedUrl, null, 'resolvedUrl should be null for invalid URL');
    assert.equal(result.domain, '', 'domain should be empty for invalid URL');
  });
});
