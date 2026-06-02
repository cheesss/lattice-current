// Create the Lattice base schema on a local Postgres (the docker compose demo DB).
//
//   docker compose up -d
//   npm run db:init        # this script
//
// Applies db/schema.sql (idempotent CREATE TABLE IF NOT EXISTS for the foundational
// base tables the repo assumes pre-exist on the NAS). Safe to run repeatedly.
// Refuses to run against a non-local host (see scripts/_shared/local-db.mjs).

import { withLocalClient, applySqlFile } from './_shared/local-db.mjs';

async function main() {
  await withLocalClient(async (client, config) => {
    console.log(`[init-local-db] applying db/schema.sql -> ${config.host}:${config.port}/${config.database}`);
    await applySqlFile(client, 'db/schema.sql');
    console.log('[init-local-db] base schema applied (idempotent).');
    console.log('[init-local-db] done. Next: npm run demo:seed');
  });
}

main().catch((err) => {
  console.error(`[init-local-db] FAILED: ${err.message}`);
  process.exitCode = 1;
});
