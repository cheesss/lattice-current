import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  fallbackOutcomeSymbolsForTheme,
  isBackfillRunOk,
  loadActiveRssSources,
  parseArgs,
} from '../scripts/backfill-active-rss-sources.mjs';

test('parseArgs supports source filters and discovery refresh', () => {
  const args = parseArgs([
    '--max-sources', '9',
    '--limit=22',
    '--name', 'Register',
    '--url', 'https://example.com/feed',
    '--refresh-discovery',
    '--dry-run',
  ]);
  assert.equal(args.maxSources, 9);
  assert.equal(args.limit, 22);
  assert.equal(args.onlyName, 'Register');
  assert.equal(args.onlyUrl, 'https://example.com/feed');
  assert.equal(args.refreshDiscovery, true);
  assert.equal(args.dryRun, true);
});

test('loadActiveRssSources returns only active HTTP feed records with inferred theme', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lattice-rss-registry-'));
  const registryPath = path.join(root, 'registry.json');
  await fs.writeFile(registryPath, JSON.stringify({
    data: {
      discoveredSources: [
        {
          id: 'technology::example.com::https://example.com/feed',
          status: 'active',
          feedName: 'Example Feed',
          url: 'https://example.com/feed',
          category: 'technology',
          topics: ['ai-ml'],
          lang: 'en',
        },
        {
          id: 'draft',
          status: 'draft',
          feedName: 'Draft Feed',
          url: 'https://draft.example/feed',
          category: 'technology',
        },
        {
          id: 'bad-url',
          status: 'active',
          feedName: 'Bad URL',
          url: 'mailto:test@example.com',
          category: 'technology',
        },
        {
          id: 'dt-ukraine',
          status: 'active',
          feedName: 'Google News: ukraine',
          url: 'https://news.google.com/rss/search?q=ukraine&hl=en-US&gl=US&ceid=US:en',
          category: 'dt-ukraine-conflict',
          topics: ['dt-ukraine-conflict'],
        },
        {
          id: 'site-qualified',
          status: 'active',
          feedName: 'Google News: Kyiv Independent',
          url: 'https://news.google.com/rss/search?q=site:kyivindependent.com+when:3d&hl=en-US&gl=US&ceid=US:en',
          category: 'conflict',
          topics: ['conflict'],
        },
      ],
    },
  }), 'utf8');

  const sources = await loadActiveRssSources(registryPath);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].feedName, 'Example Feed');
  assert.equal(sources[0].theme, 'ai-ml');
  assert.equal(sources[0].category, 'technology');
  assert.equal(sources[1].feedName, 'Google News: Kyiv Independent');
});

test('isBackfillRunOk only fails when every active source fails', () => {
  assert.equal(isBackfillRunOk({ activeSourceCount: 0, failed: 0 }), true);
  assert.equal(isBackfillRunOk({ activeSourceCount: 3, failed: 0 }), true);
  assert.equal(isBackfillRunOk({ activeSourceCount: 3, failed: 1, inserted: 0 }), true);
  assert.equal(isBackfillRunOk({ activeSourceCount: 3, failed: 3, inserted: 0 }), false);
});

test('backfill implementation classifies each RSS item instead of stamping source theme', () => {
  const source = fs.readFile(path.resolve('scripts', 'backfill-active-rss-sources.mjs'), 'utf8');
  return source.then((content) => {
    assert.match(content, /classifySeedItemTheme/);
    assert.doesNotMatch(content, /SELECT a\.id,\s*\$1,\s*0\.55,\s*'dynamic-rss-backfill'/);
    assert.match(content, /dynamic-rss-title-classifier/);
    assert.match(content, /pending_outcomes/);
    assert.match(content, /article_event_map/);
  });
});

test('fallbackOutcomeSymbolsForTheme covers repaired source themes with liquid proxies', () => {
  assert.deepEqual(fallbackOutcomeSymbolsForTheme('ai-ml').slice(0, 2), ['^IXIC', '^GSPC']);
  assert.deepEqual(fallbackOutcomeSymbolsForTheme('defense-industrial').slice(0, 2), ['^GSPC', 'XLE']);
  assert.deepEqual(fallbackOutcomeSymbolsForTheme('supply-chain-security').slice(0, 2), ['USO', 'XLE']);
});
