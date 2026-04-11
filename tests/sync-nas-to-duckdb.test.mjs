import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRawItemsSelectSql,
  parsePgJsonField,
  resolveRawItemsColumnBindings,
} from '../scripts/sync-nas-to-duckdb.mjs';

test('parsePgJsonField handles json strings, objects, and invalid values', () => {
  assert.deepEqual(parsePgJsonField('{"ok":true,"count":2}'), { ok: true, count: 2 });
  assert.deepEqual(parsePgJsonField({ nested: true }), { nested: true });
  assert.deepEqual(parsePgJsonField('not-json'), {});
  assert.deepEqual(parsePgJsonField(null), {});
});

test('resolveRawItemsColumnBindings prefers native json columns when present', async () => {
  const fakeClient = {
    async query() {
      return {
        rows: [
          { column_name: 'payload' },
          { column_name: 'metadata' },
          { column_name: 'headline' },
        ],
      };
    },
  };
  const bindings = await resolveRawItemsColumnBindings(fakeClient);
  assert.deepEqual(bindings, {
    payloadColumn: 'payload',
    metadataColumn: 'metadata',
  });
});

test('resolveRawItemsColumnBindings falls back to payload_json/metadata_json', async () => {
  const fakeClient = {
    async query() {
      return {
        rows: [
          { column_name: 'payload_json' },
          { column_name: 'metadata_json' },
          { column_name: 'headline' },
        ],
      };
    },
  };
  const bindings = await resolveRawItemsColumnBindings(fakeClient);
  assert.deepEqual(bindings, {
    payloadColumn: 'payload_json',
    metadataColumn: 'metadata_json',
  });
});

test('buildRawItemsSelectSql aliases chosen json columns to stable names', () => {
  const sql = buildRawItemsSelectSql({
    payloadColumn: 'payload_json',
    metadataColumn: 'metadata_json',
  });
  assert.match(sql, /payload_json AS payload_value/);
  assert.match(sql, /metadata_json AS metadata_value/);
  assert.match(sql, /FROM raw_items/);
});

