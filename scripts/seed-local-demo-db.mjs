// One-command bootstrap for a populated local Lattice demo.
//
//   docker compose up -d
//   npm run demo:seed      # this script
//   npm run dev
//
// Steps (all against the LOCAL database only — see scripts/_shared/local-db.mjs guard):
//   1. apply db/schema.sql   (idempotent base schema)
//   2. apply db/seed.sql     (small coherent "AI / Machine Learning" dataset)
//   3. run mechanism seed generation (built-in static profiles, no API keys) so the
//      research-seeds panel is populated
//   4. generate a real DB-backed theme report so the report list / backfill panels are
//      populated
//
// Steps 3-4 are best-effort: a failure logs a warning and the script continues, so the
// core schema + seed always land. No external API keys, no Ollama, no NAS required.

import { spawnSync } from 'node:child_process';
import { withLocalClient, applySqlFile, toDatabaseUrl } from './_shared/local-db.mjs';

function runStep(label, args) {
  console.log(`\n[seed] ${label}:`);
  console.log(`[seed]   node ${args.join(' ')}`);
  const res = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (res.error) {
    console.warn(`[seed] step "${label}" could not start: ${res.error.message}; continuing.`);
    return false;
  }
  if (res.status !== 0) {
    console.warn(`[seed] step "${label}" exited with code ${res.status ?? res.signal}; continuing.`);
    return false;
  }
  return true;
}

async function main() {
  let dbConfig;
  await withLocalClient(async (client, config) => {
    dbConfig = config;
    console.log(`[seed] target ${config.host}:${config.port}/${config.database}`);
    console.log('[seed] applying db/schema.sql (idempotent) ...');
    await applySqlFile(client, 'db/schema.sql');
    console.log('[seed] applying db/seed.sql ...');
    await applySqlFile(client, 'db/seed.sql');
    console.log('[seed] base schema + demo rows applied.');
  });

  // Hand the SAME local database down to the spawned child scripts. They resolve
  // their own config via resolveNasPgConfig (which honors DATABASE_URL), so without
  // this they would fall back to the NAS default and fail in zero-config mode.
  process.env.DATABASE_URL = toDatabaseUrl(dbConfig);

  // Populate the research-seeds panel from built-in static DISCOVERY_EXPANSION_PROFILES
  // (no DB priors, no API keys, no Ollama). `--source discovery-expansion` is the source
  // that generates from the static profiles; `ontology` needs graph data an empty DB lacks.
  runStep('mechanism seeds (research-seeds panel)', [
    'scripts/run-mechanism-seed-generation.mjs', '--apply', '--source', 'discovery-expansion', '--limit', '30',
  ]);

  // Generate a real DB-backed theme report (writes data/reports/<id>/ artifacts).
  runStep('DB-backed theme report', [
    'scripts/generate-intelligence-report.mjs', '--db', '--depth', 'deep',
    '--type', 'theme_report', '--subject', 'AI / Machine Learning',
  ]);

  console.log('\n[seed] demo seed complete.');
  console.log('[seed] next: npm run dev   then open the printed dashboard URL.');
}

main().catch((err) => {
  console.error(`[seed] FAILED: ${err.message}`);
  process.exitCode = 1;
});
