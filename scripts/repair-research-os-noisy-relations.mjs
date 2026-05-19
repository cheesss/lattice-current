#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { normalizeKnowledgeKey, ensureResearchOsSchema } from './_shared/adjacency-graph.mjs';
import { loadResearchOsPolicy } from './_shared/research-os-policy.mjs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

const { Client } = pg;

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  return { dryRun: args.has('--dry-run') };
}

export async function runRepairResearchOsNoisyRelations(options = {}) {
  loadOptionalEnvFile();
  const policy = loadResearchOsPolicy();
  const allowedTargets = [...new Set((policy.relationExtraction?.technicalCueTerms || [])
    .map(normalizeKnowledgeKey)
    .filter(Boolean)
    .map((key) => key.replace(/-/g, ' ')))];
  const client = options.client || new Client(options.pgConfig || resolveNasPgConfig());
  const ownClient = !options.client;
  if (ownClient) await client.connect();
  try {
    await ensureResearchOsSchema(client);
    const { rows } = await client.query(
      `SELECT e.id, n2.canonical_name AS target
         FROM knowledge_edges e
         JOIN knowledge_nodes n2 ON n2.id = e.target_node_id
        WHERE e.created_by = 'relation-extractor'
          AND e.status <> 'archived'
          AND NOT (n2.normalized_key = ANY($1::text[]))`,
      [allowedTargets.map(normalizeKnowledgeKey)],
    );
    if (!options.dryRun && rows.length) {
      await client.query(
        `UPDATE knowledge_edges
            SET status = 'archived',
                updated_at = NOW(),
                metadata = metadata || jsonb_build_object(
                  'archivedBy', 'repair-research-os-noisy-relations',
                  'archivedReason', 'target no longer matches canonical technical cue policy'
                )
          WHERE id = ANY($1::bigint[])`,
        [rows.map((row) => row.id)],
      );
    }
    return {
      ok: true,
      dryRun: Boolean(options.dryRun),
      archivedCount: options.dryRun ? 0 : rows.length,
      matchedNoisyCount: rows.length,
      sample: rows.slice(0, 10),
    };
  } finally {
    if (ownClient) await client.end();
  }
}

const isDirectRun = (() => {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    return import.meta.url === pathToFileURL(entryArg).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runRepairResearchOsNoisyRelations(parseArgs())
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
