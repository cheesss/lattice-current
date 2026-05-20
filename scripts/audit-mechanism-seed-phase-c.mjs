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
  summarizeOperatorSeedPhaseCAudit,
} from './_shared/operator-seed-phase-c-audit.mjs';

const { Client } = pg;

export const DEFAULT_PHASE_C_AUDIT_ARTIFACT = path.resolve(
  process.cwd(),
  'data/runtime/operator-seed-phase-c-audit.latest.json',
);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function uniqueStrings(values = [], limit = 100) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
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

export function parseMechanismSeedPhaseCAuditArgs(argv = process.argv.slice(2)) {
  const out = {
    statuses: ['review_ready', 'needs_evidence', 'evidence_running'],
    seedIds: [],
    limit: 100,
    artifactOut: DEFAULT_PHASE_C_AUDIT_ARTIFACT,
    writeArtifact: true,
    failOnIncomplete: false,
    maxProviderAttempts: 1,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--statuses') out.statuses = parseCsv(next());
    else if (arg === '--seed-id') out.seedIds.push(next());
    else if (arg === '--seed-ids') out.seedIds = parseCsv(next());
    else if (arg === '--limit') out.limit = Number(next() || out.limit);
    else if (arg === '--artifact-out') out.artifactOut = path.resolve(next() || out.artifactOut);
    else if (arg === '--no-write') out.writeArtifact = false;
    else if (arg === '--fail-on-incomplete') out.failOnIncomplete = true;
    else if (arg === '--max-provider-attempts') out.maxProviderAttempts = Number(next() || out.maxProviderAttempts);
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--statuses=')) out.statuses = parseCsv(arg.slice('--statuses='.length));
    else if (arg.startsWith('--seed-id=')) out.seedIds.push(arg.slice('--seed-id='.length));
    else if (arg.startsWith('--seed-ids=')) out.seedIds = parseCsv(arg.slice('--seed-ids='.length));
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--artifact-out=')) out.artifactOut = path.resolve(arg.slice('--artifact-out='.length));
    else if (arg.startsWith('--max-provider-attempts=')) out.maxProviderAttempts = Number(arg.slice('--max-provider-attempts='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  out.statuses = uniqueStrings(out.statuses, 20);
  out.seedIds = uniqueStrings(out.seedIds, 100);
  out.limit = Math.max(1, Math.min(500, Number(out.limit || 100)));
  out.maxProviderAttempts = Math.max(1, Math.min(10, Number(out.maxProviderAttempts || 1)));
  return out;
}

function helpText() {
  return `Usage:
  node --import tsx scripts/audit-mechanism-seed-phase-c.mjs
  node --import tsx scripts/audit-mechanism-seed-phase-c.mjs --statuses review_ready --limit 100
  node --import tsx scripts/audit-mechanism-seed-phase-c.mjs --fail-on-incomplete

This is a read-only Phase C contract audit for operator mechanism seeds. It
writes only data/runtime/operator-seed-phase-c-audit.latest.json unless
--no-write is passed. It does not enqueue evidence, write approvals, create
reports, mutate canonical graph/source registry, or activate providers.
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
    statuses: options.statuses || [],
    limit: options.limit || 100,
  });
  const seedFilter = new Set(uniqueStrings(options.seedIds || [], 100));
  return rows.filter((row) => !seedFilter.size || seedFilter.has(row.seed_id));
}

async function writeArtifact(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function runMechanismSeedPhaseCAudit(options = {}) {
  const artifactOut = options.artifactOut || DEFAULT_PHASE_C_AUDIT_ARTIFACT;
  const build = async (client = null) => {
    const rows = await loadRows(client, options);
    const summary = summarizeOperatorSeedPhaseCAudit(rows, {
      ...options,
      maxProviderAttempts: options.maxProviderAttempts,
    });
    return {
      ...summary,
      mode: 'phase-c-audit',
      artifactPath: options.writeArtifact === false ? null : artifactOut,
      seedCount: rows.length,
      boundaries: {
        ...(summary.boundaries || {}),
        runtimeArtifactWrites: options.writeArtifact === false ? 0 : 1,
      },
    };
  };

  const result = options.rows ? await build(null) : await withClient(options, build);
  if (options.writeArtifact !== false) await writeArtifact(artifactOut, result);
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
  const options = parseMechanismSeedPhaseCAuditArgs();
  if (options.help) {
    process.stdout.write(helpText());
  } else {
    runMechanismSeedPhaseCAudit(options)
      .then((result) => {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (options.failOnIncomplete && !result.ok) process.exitCode = 2;
      })
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
