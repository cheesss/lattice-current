#!/usr/bin/env node

import pg from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ensureResearchOsSchema,
  upsertKnowledgeNode,
  upsertKnowledgeEdge,
} from './_shared/adjacency-graph.mjs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

const { Client } = pg;

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  return { dryRun: args.has('--dry-run') };
}

function readGoldset() {
  return JSON.parse(readFileSync(path.join(process.cwd(), 'data', 'eval', 'adjacency-goldset.json'), 'utf8'));
}

function connectorType(value) {
  const text = String(value || '').toLowerCase();
  if (/(helium|hydrogen|oxygen|propellant|fuel)/.test(text)) return 'material';
  if (/(vacuum|cooling|refrigerator|magnet|transformer|grid|power)/.test(text)) return 'component';
  return 'technology';
}

export async function runImportAdjacencyGoldsetSeeds(options = {}) {
  loadOptionalEnvFile();
  const client = options.client || new Client(options.pgConfig || resolveNasPgConfig());
  const ownClient = !options.client;
  if (ownClient) await client.connect();
  try {
    await ensureResearchOsSchema(client);
    const goldset = readGoldset();
    let nodes = 0;
    let edges = 0;
    for (const example of goldset) {
      for (const themeKey of example.themes || []) {
        if (options.dryRun) continue;
        const theme = await upsertKnowledgeNode(client, {
          nodeType: 'theme',
          canonicalName: themeKey,
          status: 'candidate',
          createdBy: 'adjacency-goldset-seed',
          metadata: { calibrationOnly: true },
        }, { skipEnsure: true });
        nodes += 1;
        for (const connector of example.expectedConnectors || []) {
          const connectorNode = await upsertKnowledgeNode(client, {
            nodeType: connectorType(connector),
            canonicalName: connector,
            status: 'candidate',
            createdBy: 'adjacency-goldset-seed',
            metadata: { calibrationOnly: true },
          }, { skipEnsure: true });
          nodes += 1;
          await upsertKnowledgeEdge(client, {
            sourceNodeId: theme.id,
            targetNodeId: connectorNode.id,
            relationType: 'requires',
            confidence: 0.35,
            evidenceCount: 0,
            sourceDiversity: 0,
            status: 'candidate',
            createdBy: 'adjacency-goldset-seed',
            metadata: { calibrationOnly: true },
          }, new Map(), { skipEnsure: true });
          edges += 1;
          for (const supplier of example.expectedSuppliers || []) {
            const supplierNode = await upsertKnowledgeNode(client, {
              nodeType: 'company',
              canonicalName: supplier,
              status: 'candidate',
              createdBy: 'adjacency-goldset-seed',
              metadata: { calibrationOnly: true },
            }, { skipEnsure: true });
            nodes += 1;
            await upsertKnowledgeEdge(client, {
              sourceNodeId: connectorNode.id,
              targetNodeId: supplierNode.id,
              relationType: 'supplies',
              confidence: 0.25,
              evidenceCount: 0,
              sourceDiversity: 0,
              status: 'candidate',
              createdBy: 'adjacency-goldset-seed',
              metadata: { calibrationOnly: true },
            }, new Map(), { skipEnsure: true });
            edges += 1;
          }
        }
      }
    }
    return { ok: true, dryRun: Boolean(options.dryRun), nodes, edges, calibrationOnly: true };
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
  runImportAdjacencyGoldsetSeeds(parseArgs())
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
