import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createStorageEnvelope,
  decodeStorageValue,
  isStorageEnvelope,
} from '../src/services/storage/storage-envelope.ts';

describe('storage envelope', () => {
  it('wraps payload with schema, timestamps, source, checksum', async () => {
    const envelope = await createStorageEnvelope({ value: 42 }, {
      source: 'bootstrap-markets',
      ttlMs: 60_000,
    });
    assert.equal(envelope.schemaVersion, 1);
    assert.equal(envelope.source, 'bootstrap-markets');
    assert.equal(typeof envelope.createdAt, 'string');
    assert.equal(typeof envelope.expiresAt, 'string');
    assert.equal(envelope.origin, 'seed');
    assert.equal(typeof envelope.checksum, 'string');
    assert.equal(envelope.data.value, 42);
    assert.ok(isStorageEnvelope(envelope));
  });

  it('treats raw legacy payload as schemaVersion 0 and migrates it', async () => {
    const decoded = await decodeStorageValue({ events: [{ id: 'eq-1' }] }, { source: 'seed-earthquakes' });
    assert.equal(decoded.legacy, true);
    assert.equal(decoded.schemaVersion, 2);
    assert.equal(decoded.checksumVerified, true);
    assert.ok(Array.isArray(decoded.data.events));
    assert.equal(decoded.data.events[0].magnitude_type, 'ml');
  });

  it('rejects checksum mismatches', async () => {
    const envelope = await createStorageEnvelope({ value: 42 }, {
      source: 'bootstrap-markets',
      ttlMs: 60_000,
    });
    envelope.checksum = 'bad-checksum';
    const decoded = await decodeStorageValue(envelope, { source: 'bootstrap-markets' });
    assert.equal(decoded.data, null);
    assert.equal(decoded.checksumVerified, false);
    assert.match(decoded.error, /Checksum mismatch/i);
  });

  it('rejects expired envelopes', async () => {
    const envelope = await createStorageEnvelope({ value: 42 }, {
      source: 'bootstrap-markets',
      ttlMs: 1,
      createdAt: new Date(Date.now() - 10_000),
    });
    const decoded = await decodeStorageValue(envelope, { source: 'bootstrap-markets' });
    assert.equal(decoded.data, null);
    assert.equal(decoded.expired, true);
  });
});
