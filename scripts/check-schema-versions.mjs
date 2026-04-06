#!/usr/bin/env node
import { SCHEMA_VERSIONS } from '../src/services/storage/schema-registry.ts';
import { MIGRATIONS } from '../src/services/storage/schema-migrations.ts';

const errors = [];
for (const [source, version] of Object.entries(SCHEMA_VERSIONS)) {
  if (version <= 1) continue;
  for (let v = 1; v < version; v++) {
    if (!MIGRATIONS[source]?.[v]) {
      errors.push(`${source} is at schemaVersion ${version} but has no migration for v${v} -> v${v + 1}`);
    }
  }
}

if (errors.length > 0) {
  console.error('[schema-versions] Missing migrations:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('[schema-versions] OK');

