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
  summarizeProviderGapReview,
} from './_shared/provider-gap-proposals.mjs';

const { Client } = pg;

export const DEFAULT_PROVIDER_GAP_REVIEW_ARTIFACT = path.resolve(
  process.cwd(),
  'data/runtime/operator-seed-provider-gap-review.latest.json',
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

export function parseProviderGapReviewArgs(argv = process.argv.slice(2)) {
  const out = {
    statuses: ['review_ready'],
    seedIds: [],
    provider: '',
    limit: 50,
    loadLimit: 500,
    includeComplete: false,
    queryLimitPerProposal: 5,
    queryLimitPerSeed: 24,
    queryLimitPerClass: 2,
    maxProviderAttempts: 1,
    artifactOut: DEFAULT_PROVIDER_GAP_REVIEW_ARTIFACT,
    writeArtifact: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--statuses') out.statuses = parseCsv(next());
    else if (arg === '--seed-id') out.seedIds.push(next());
    else if (arg === '--seed-ids') out.seedIds = parseCsv(next());
    else if (arg === '--provider') out.provider = next() || '';
    else if (arg === '--limit') out.limit = Number(next() || out.limit);
    else if (arg === '--load-limit') out.loadLimit = Number(next() || out.loadLimit);
    else if (arg === '--include-complete') out.includeComplete = true;
    else if (arg === '--query-limit-per-proposal') out.queryLimitPerProposal = Number(next() || out.queryLimitPerProposal);
    else if (arg === '--query-limit-per-seed') out.queryLimitPerSeed = Number(next() || out.queryLimitPerSeed);
    else if (arg === '--query-limit-per-class') out.queryLimitPerClass = Number(next() || out.queryLimitPerClass);
    else if (arg === '--max-provider-attempts') out.maxProviderAttempts = Number(next() || out.maxProviderAttempts);
    else if (arg === '--artifact-out') out.artifactOut = path.resolve(next() || out.artifactOut);
    else if (arg === '--no-write') out.writeArtifact = false;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--statuses=')) out.statuses = parseCsv(arg.slice('--statuses='.length));
    else if (arg.startsWith('--seed-id=')) out.seedIds.push(arg.slice('--seed-id='.length));
    else if (arg.startsWith('--seed-ids=')) out.seedIds = parseCsv(arg.slice('--seed-ids='.length));
    else if (arg.startsWith('--provider=')) out.provider = arg.slice('--provider='.length);
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--load-limit=')) out.loadLimit = Number(arg.slice('--load-limit='.length));
    else if (arg.startsWith('--query-limit-per-proposal=')) out.queryLimitPerProposal = Number(arg.slice('--query-limit-per-proposal='.length));
    else if (arg.startsWith('--query-limit-per-seed=')) out.queryLimitPerSeed = Number(arg.slice('--query-limit-per-seed='.length));
    else if (arg.startsWith('--query-limit-per-class=')) out.queryLimitPerClass = Number(arg.slice('--query-limit-per-class='.length));
    else if (arg.startsWith('--max-provider-attempts=')) out.maxProviderAttempts = Number(arg.slice('--max-provider-attempts='.length));
    else if (arg.startsWith('--artifact-out=')) out.artifactOut = path.resolve(arg.slice('--artifact-out='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  out.statuses = uniqueStrings(out.statuses, 20);
  out.seedIds = uniqueStrings(out.seedIds, 100);
  out.provider = String(out.provider || '').trim();
  out.limit = Math.max(1, Math.min(500, Number(out.limit || 50)));
  out.loadLimit = Math.max(out.limit, Math.min(1000, Number(out.loadLimit || 500)));
  out.queryLimitPerProposal = Math.max(1, Math.min(20, Number(out.queryLimitPerProposal || 5)));
  out.queryLimitPerSeed = Math.max(1, Math.min(200, Number(out.queryLimitPerSeed || 24)));
  out.queryLimitPerClass = Math.max(1, Math.min(6, Number(out.queryLimitPerClass || 2)));
  out.maxProviderAttempts = Math.max(1, Math.min(10, Number(out.maxProviderAttempts || 1)));
  return out;
}

function helpText() {
  return `Usage:
  node --import tsx scripts/review-provider-gap-proposals.mjs
  node --import tsx scripts/review-provider-gap-proposals.mjs --statuses review_ready --limit 25
  node --import tsx scripts/review-provider-gap-proposals.mjs --provider dart --artifact-out data/runtime/provider-gap-review.json

This is a read-only provider gap review surface for operator mechanism seeds.
It writes only a local runtime artifact unless --no-write is passed. It does
not create approval_queue rows, report_backfill_tasks, evidence bundles,
canonical graph/source registry rows, or provider activation state.
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
      .slice(0, options.loadLimit || options.limit || 500);
  }
  if (options.ensureSchema !== false) await ensureOperatorResearchSeedSchema(client);
  const rows = await loadOperatorResearchSeeds(client, {
    statuses: options.statuses || ['review_ready'],
    limit: options.loadLimit || 500,
  });
  const seedFilter = new Set(uniqueStrings(options.seedIds || [], 100));
  return rows
    .filter((row) => !seedFilter.size || seedFilter.has(row.seed_id))
    .slice(0, options.loadLimit || options.limit || 500);
}

async function writeArtifact(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function runProviderGapReview(options = {}) {
  const artifactOut = options.artifactOut || DEFAULT_PROVIDER_GAP_REVIEW_ARTIFACT;
  const buildResult = async (client = null) => {
    const rows = await loadRows(client, options);
    const summary = summarizeProviderGapReview(rows, {
      ...options,
      provider: options.provider || '',
      limit: options.limit || 50,
      queryLimitPerProposal: options.queryLimitPerProposal,
      queryLimitPerSeed: options.queryLimitPerSeed,
      queryLimitPerClass: options.queryLimitPerClass,
      maxProviderAttempts: options.maxProviderAttempts,
    });
    return {
      ...summary,
      mode: 'provider-gap-review',
      artifactPath: options.writeArtifact === false ? null : artifactOut,
      seedCount: rows.length,
      boundaries: {
        ...(summary.boundaries || {}),
        runtimeArtifactWrites: options.writeArtifact === false ? 0 : 1,
      },
    };
  };

  const result = options.rows
    ? await buildResult(null)
    : await withClient(options, buildResult);

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
  const options = parseProviderGapReviewArgs();
  if (options.help) {
    process.stdout.write(helpText());
  } else {
    runProviderGapReview(options)
      .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
