import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { migrateHotRecordsToWarm, shouldMigrateHotRecord } from '../server/archive/hot-warm-migrator.ts';

describe('hot warm migrator', () => {
  it('migrates records whose TTL is near expiry and policy allows warm retention', async () => {
    const now = new Date('2026-03-24T00:00:00.000Z');
    const records = [
      { key: 'news:insights:v1', expiresAt: '2026-03-24T03:00:00.000Z', value: { id: 1 } },
      { key: 'market:stocks:v1', expiresAt: '2026-03-24T12:00:00.000Z', value: { id: 2 } },
    ];
    assert.equal(shouldMigrateHotRecord(records[0], now), true);
    assert.equal(shouldMigrateHotRecord(records[1], now), false);

    let writes = 0;
    const result = await migrateHotRecordsToWarm(records, async () => {
      writes += 1;
      return { inserted: true };
    }, now);

    assert.equal(writes, 1);
    assert.deepEqual(result, { attempted: 1, migrated: 1 });
  });
});
