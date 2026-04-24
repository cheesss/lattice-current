import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { auditCacheFreshness } from '../scripts/audit-data-freshness.mjs';

async function writeCacheFixture(root, name, payload) {
  const cacheRoot = path.join(root, 'data', 'event-dashboard-cache');
  await fs.mkdir(cacheRoot, { recursive: true });
  await fs.writeFile(path.join(cacheRoot, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

test('auditCacheFreshness ignores stale cache artifacts outside the active server fallback TTL', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lattice-cache-audit-'));
  const now = new Date('2026-04-22T00:00:00.000Z');
  await writeCacheFixture(root, 'expired.json', {
    meta: {
      generatedAt: '2026-04-21T22:00:00.000Z',
      dataUpdatedAt: '2026-04-14T00:00:00.000Z',
      stale: false,
    },
    items: [{ title: 'old item', updatedAt: '2026-04-14T00:00:00.000Z' }],
  });

  const audit = await auditCacheFreshness({ cwd: root, now });
  assert.equal(audit.issues.length, 0);
});

test('auditCacheFreshness reports active cache artifacts that mask stale data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lattice-cache-audit-'));
  const now = new Date('2026-04-22T00:00:00.000Z');
  await writeCacheFixture(root, 'active-stale.json', {
    meta: {
      generatedAt: '2026-04-21T23:45:00.000Z',
      dataUpdatedAt: '2026-04-14T00:00:00.000Z',
      stale: false,
    },
    items: [{ title: 'old item', updatedAt: '2026-04-14T00:00:00.000Z' }],
  });

  const audit = await auditCacheFreshness({ cwd: root, now });
  assert.equal(audit.issues.length, 1);
  assert.equal(audit.issues[0].activeCacheArtifact, true);
  assert.equal(audit.issues[0].staleFalsePositive, true);
});
