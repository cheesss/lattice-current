import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  quarantineLowValueGoogleNewsSources,
} from '../scripts/quarantine-low-value-google-news-sources.mjs';

test('quarantine script marks only low-value dynamic Google News sources', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lattice-google-news-quarantine-'));
  const registry = path.join(root, 'registry.json');
  await fs.writeFile(registry, JSON.stringify({
    data: {
      discoveredSources: [
        {
          id: 'bad',
          status: 'active',
          feedName: 'Google News: ukraine',
          url: 'https://news.google.com/rss/search?q=ukraine&hl=en-US&gl=US&ceid=US:en',
          category: 'dt-ukraine',
          topics: ['dt-ukraine'],
        },
        {
          id: 'good',
          status: 'active',
          feedName: 'Google News: Kyiv Independent',
          url: 'https://news.google.com/rss/search?q=site:kyivindependent.com+when:3d&hl=en-US&gl=US&ceid=US:en',
          category: 'conflict',
          topics: ['conflict'],
        },
      ],
    },
  }, null, 2), 'utf8');

  const dryRun = await quarantineLowValueGoogleNewsSources({ registry, apply: false });
  assert.equal(dryRun.updateCount, 1);
  assert.equal(dryRun.updates[0].id, 'bad');

  const applied = await quarantineLowValueGoogleNewsSources({ registry, apply: true });
  assert.equal(applied.updateCount, 1);
  const parsed = JSON.parse(await fs.readFile(registry, 'utf8'));
  assert.equal(parsed.data.discoveredSources.find((source) => source.id === 'bad').status, 'quarantined');
  assert.equal(parsed.data.discoveredSources.find((source) => source.id === 'good').status, 'active');
});
