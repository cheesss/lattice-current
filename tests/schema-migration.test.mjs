import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applySchemaMigrations } from '../src/services/storage/schema-migrations.ts';

describe('schema migrations', () => {
  it('migrates seed-earthquakes v1 to current version', () => {
    const migrated = applySchemaMigrations('seed-earthquakes', 1, {
      events: [{ id: 'x' }],
    });
    assert.equal(migrated.version, 2);
    assert.equal(migrated.migrated, true);
    assert.equal(migrated.data.events[0].magnitude_type, 'ml');
  });

  it('throws when migration path is missing', () => {
    assert.throws(() => applySchemaMigrations('replay-frame', 0, { foo: 'bar' }));
  });
});
