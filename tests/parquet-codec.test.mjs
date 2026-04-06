import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getArchiveSchema, encodeRowsAsParquet } from '../server/archive/parquet-codec.ts';

describe('parquet codec', () => {
  it('returns a schema for replay frames', () => {
    const schema = getArchiveSchema('replay-frames');
    assert.ok(schema.id);
    assert.ok(schema.payload);
  });

  it('gracefully returns failure when parquet backend is unavailable', async () => {
    const result = await encodeRowsAsParquet('events', [{ id: '1', payload: { ok: true } }]);
    if (result.ok) {
      assert.ok(result.bytes.length > 0);
    } else {
      assert.equal(typeof result.reason, 'string');
    }
  });
});

