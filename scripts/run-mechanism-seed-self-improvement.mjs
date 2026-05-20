#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import pg from 'pg';

import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import {
  ensureOperatorResearchSeedSchema,
  loadOperatorResearchSeeds,
} from './_shared/operator-research-seeds.mjs';
import {
  summarizeOperatorSeedSelfImprovement,
} from './_shared/operator-seed-self-improvement.mjs';

const { Client } = pg;

export const DEFAULT_OPERATOR_SEED_SELF_IMPROVEMENT_ARTIFACT = path.resolve(
  process.cwd(),
  'data/runtime/mechanism-seed-self-improvement.latest.json',
);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values = [], limit = 100) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
    const text = compact(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function parseCsv(value = '') {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

export function parseMechanismSeedSelfImprovementArgs(argv = process.argv.slice(2)) {
  const out = {
    statuses: ['review_ready', 'needs_evidence', 'evidence_running', 'rejected', 'report_candidate'],
    seedIds: [],
    limit: 100,
    minCount: 1,
    artifactOut: DEFAULT_OPERATOR_SEED_SELF_IMPROVEMENT_ARTIFACT,
    writeArtifact: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--statuses') out.statuses = parseCsv(next());
    else if (arg === '--seed-id') out.seedIds.push(next());
    else if (arg === '--seed-ids') out.seedIds = parseCsv(next());
    else if (arg === '--limit') out.limit = Number(next() || out.limit);
    else if (arg === '--min-count') out.minCount = Number(next() || out.minCount);
    else if (arg === '--artifact-out') out.artifactOut = path.resolve(next() || out.artifactOut);
    else if (arg === '--no-write') out.writeArtifact = false;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--statuses=')) out.statuses = parseCsv(arg.slice('--statuses='.length));
    else if (arg.startsWith('--seed-id=')) out.seedIds.push(arg.slice('--seed-id='.length));
    else if (arg.startsWith('--seed-ids=')) out.seedIds = parseCsv(arg.slice('--seed-ids='.length));
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--min-count=')) out.minCount = Number(arg.slice('--min-count='.length));
    else if (arg.startsWith('--artifact-out=')) out.artifactOut = path.resolve(arg.slice('--artifact-out='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  out.statuses = uniqueStrings(out.statuses, 20);
  out.seedIds = uniqueStrings(out.seedIds, 100);
  out.limit = Math.max(1, Math.min(1000, Number(out.limit || 100)));
  out.minCount = Math.max(1, Math.min(100, Number(out.minCount || 1)));
  return out;
}

function helpText() {
  return `Usage:
  node --import tsx scripts/run-mechanism-seed-self-improvement.mjs
  node --import tsx scripts/run-mechanism-seed-self-improvement.mjs --statuses review_ready,needs_evidence --limit 100

This is advisory-only. It writes a runtime artifact with repeated seed failure
patterns and proposals, but it does not mutate code, queues, providers, source
registry, canonical graph, reports, or evidence bundles.
`;
}

async function withClient(options = {}, fn) {
  if (options.client) return fn(options.client);
  loadOptionalEnvFile();
  const client = new Client(options.pgConfig || resolveNasPgConfig(options.pg || {}));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function loadRows(client, options = {}) {
  if (options.rows) {
    const seedFilter = new Set(uniqueStrings(options.seedIds || [], 100));
    return asArray(options.rows)
      .filter((row) => !seedFilter.size || seedFilter.has(row.seed_id || row.seedId || row.seed_json?.seedId))
      .slice(0, options.limit || 100);
  }
  if (options.ensureSchema !== false) await ensureOperatorResearchSeedSchema(client);
  const rows = await loadOperatorResearchSeeds(client, {
    statuses: options.statuses || ['review_ready', 'needs_evidence', 'evidence_running', 'rejected', 'report_candidate'],
    limit: options.limit || 100,
  });
  const seedFilter = new Set(uniqueStrings(options.seedIds || [], 100));
  return rows.filter((row) => !seedFilter.size || seedFilter.has(row.seed_id));
}

async function writeArtifact(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function runMechanismSeedSelfImprovement(options = {}) {
  const artifactOut = options.artifactOut || DEFAULT_OPERATOR_SEED_SELF_IMPROVEMENT_ARTIFACT;
  const execute = async (client = null) => {
    const rows = await loadRows(client, options);
    const summary = summarizeOperatorSeedSelfImprovement(rows, {
      ...options,
      minCount: options.minCount || 1,
    });
    return {
      ...summary,
      mode: 'mechanism-seed-self-improvement',
      artifactPath: options.writeArtifact === false ? null : artifactOut,
      boundaries: {
        ...(summary.boundaries || {}),
        runtimeArtifactWrites: options.writeArtifact === false ? 0 : 1,
      },
    };
  };

  const result = options.rows
    ? await execute(null)
    : await withClient(options, execute);

  if (options.writeArtifact !== false) {
    await writeArtifact(artifactOut, result);
  }
  return result;
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
  const options = parseMechanismSeedSelfImprovementArgs();
  if (options.help) {
    process.stdout.write(helpText());
  } else {
    runMechanismSeedSelfImprovement(options)
      .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
