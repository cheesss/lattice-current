import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  attemptSourceRepair,
  buildCatalogRepairCandidates,
  buildHeuristicRepairCandidates,
  getRepairCatalogEntries,
  isSameHostname,
  normalizeCandidateUrl,
} from '../scripts/_shared/source-repair.mjs';

function makeProbe(overrides = {}) {
  return {
    inputUrl: 'https://example.com/',
    resolvedUrl: null,
    domain: 'example.com',
    status: 'partial',
    connectorKind: 'sitemap-news',
    adapterTried: ['direct-feed', 'html-alternate-feed', 'wordpress-rss', 'sitemap-news'],
    qualityScore: 0.58,
    qualityBreakdown: {
      fetchOk: true,
      parseOk: true,
      itemCount: 20,
      recentItemCount: 0,
      titleDiversity: 1,
      duplicateRate: 0,
      spamRate: 0,
      language: 'en',
      themeRelevance: 0.2,
      sourceFreshness: 0,
    },
    sampleItems: [],
    errors: [],
    warnings: [],
    nextAction: 'reject',
    traceId: 'probe-test',
    ...overrides,
  };
}

function acceptedProbe(url) {
  return {
    ...makeProbe({
      inputUrl: url,
      resolvedUrl: url,
      status: 'success',
      connectorKind: 'rss',
      qualityScore: 0.91,
      qualityBreakdown: {
        fetchOk: true,
        parseOk: true,
        itemCount: 12,
        recentItemCount: 6,
        titleDiversity: 1,
        duplicateRate: 0,
        spamRate: 0,
        language: 'en',
        themeRelevance: 0.6,
        sourceFreshness: 1,
      },
      sampleItems: [
        { title: 'Airspace insurance risk update', url: `${url}#1`, publishedAt: new Date().toISOString() },
      ],
      nextAction: 'register',
    }),
  };
}

describe('source-repair', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('normalizes candidate URLs and compares hostnames', () => {
    assert.equal(normalizeCandidateUrl('/feed.xml', 'https://example.com/root/'), 'https://example.com/feed.xml');
    assert.equal(isSameHostname('https://example.com/a', 'https://example.com/b'), true);
    assert.equal(isSameHostname('https://example.com/a', 'https://other.example.com/b'), false);
  });

  it('discovers candidate feed links from source HTML', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => `
        <html>
          <head><link rel="alternate" type="application/rss+xml" href="/news/feed.xml"></head>
          <body><a href="/pressroom/">Press room</a></body>
        </html>
      `,
    });

    const candidates = await buildHeuristicRepairCandidates({
      inputUrl: 'https://example.com/',
      theme: 'airspace insurance',
      name: 'Example source',
      probe: makeProbe(),
      maxCandidates: 80,
    });

    assert.ok(candidates.some((candidate) => candidate.url === 'https://example.com/news/feed.xml'));
    assert.ok(candidates.some((candidate) => candidate.url === 'https://example.com/pressroom/'));
  });

  it('adds matched catalog candidates for failed defense and shipping sources', () => {
    const candidates = buildCatalogRepairCandidates({
      inputUrl: 'https://www.iata.org/',
      theme: 'defense',
      name: 'Eastern Mediterranean war-risk insurance source',
      reason: 'airspace and shipping insurance repricing',
    });

    assert.ok(candidates.some((candidate) => candidate.url === 'https://breakingdefense.com/feed/'));
    assert.ok(candidates.some((candidate) => candidate.url === 'https://gcaptain.com/feed/'));
    assert.ok(candidates.find((candidate) => candidate.url === 'https://breakingdefense.com/feed/')?.matchedTags.length > 0);
  });

  it('exposes vetted catalog bootstrap entries across non-defense themes', () => {
    const entries = getRepairCatalogEntries();
    assert.ok(entries.some((candidate) => candidate.url === 'https://www.securityweek.com/feed/'));
    assert.ok(entries.some((candidate) => candidate.url === 'https://techcrunch.com/category/artificial-intelligence/feed/'));
    assert.ok(entries.some((candidate) => candidate.url === 'https://www.datacenterdynamics.com/en/rss/'));
    assert.ok(entries.every((candidate) => candidate.source === 'catalog-bootstrap'));
  });

  it('re-probes candidates and selects a passing repair', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => `
        <html>
          <head><link rel="alternate" type="application/rss+xml" href="/news/feed.xml"></head>
          <body>plain source homepage</body>
        </html>
      `,
    });

    const attempts = [];
    const probeFn = async (url) => {
      attempts.push(url);
      if (url === 'https://example.com/news/feed.xml') return acceptedProbe(url);
      return makeProbe({ inputUrl: url, nextAction: 'reject', qualityScore: 0.2 });
    };

    const repair = await attemptSourceRepair({
      inputUrl: 'https://example.com/',
      theme: 'airspace insurance',
      name: 'Example source',
      probe: makeProbe(),
      probeFn,
      enableLlm: false,
      maxCandidates: 4,
    });

    assert.equal(repair.attempted, true);
    assert.equal(repair.repaired, true);
    assert.equal(repair.best.url, 'https://example.com/news/feed.xml');
    assert.ok(attempts.includes('https://example.com/news/feed.xml'));
  });

  it('can repair failed homepages through catalog candidates without LLM', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => '<html><body>no feed links here</body></html>',
    });

    const attempts = [];
    const probeFn = async (url) => {
      attempts.push(url);
      if (url === 'https://breakingdefense.com/feed/') return acceptedProbe(url);
      return makeProbe({ inputUrl: url, nextAction: 'reject', qualityScore: 0.25 });
    };

    const repair = await attemptSourceRepair({
      inputUrl: 'https://www.icao.int/',
      theme: 'defense',
      name: 'East Med airspace and war-risk insurance source',
      reason: 'war-risk insurance and airspace monitoring',
      probe: makeProbe({ inputUrl: 'https://www.icao.int/' }),
      probeFn,
      enableLlm: false,
      maxCandidates: 80,
    });

    assert.equal(repair.repaired, true);
    assert.equal(repair.best.url, 'https://breakingdefense.com/feed/');
    assert.ok(attempts.includes('https://breakingdefense.com/feed/'));
  });
});
