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
  persistProviderAdapterProposalReviews,
  summarizeProviderAdapterProposals,
} from './_shared/provider-adapter-factory.mjs';

const { Client } = pg;

export const DEFAULT_PROVIDER_ADAPTER_PROPOSAL_ARTIFACT = path.resolve(
  process.cwd(),
  'data/runtime/provider-adapter-proposals.latest.json',
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

export function parseProviderAdapterProposalArgs(argv = process.argv.slice(2)) {
  const out = {
    apply: false,
    statuses: ['review_ready'],
    seedIds: [],
    provider: '',
    limit: 50,
    loadLimit: 500,
    minSeedCount: 1,
    queryLimit: 12,
    includeComplete: false,
    artifactOut: DEFAULT_PROVIDER_ADAPTER_PROPOSAL_ARTIFACT,
    writeArtifact: true,
    status: 'human-review',
    confirm: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--statuses') out.statuses = parseCsv(next());
    else if (arg === '--seed-id') out.seedIds.push(next());
    else if (arg === '--seed-ids') out.seedIds = parseCsv(next());
    else if (arg === '--provider') out.provider = next() || '';
    else if (arg === '--limit') out.limit = Number(next() || out.limit);
    else if (arg === '--load-limit') out.loadLimit = Number(next() || out.loadLimit);
    else if (arg === '--min-seed-count') out.minSeedCount = Number(next() || out.minSeedCount);
    else if (arg === '--query-limit') out.queryLimit = Number(next() || out.queryLimit);
    else if (arg === '--include-complete') out.includeComplete = true;
    else if (arg === '--artifact-out') out.artifactOut = path.resolve(next() || out.artifactOut);
    else if (arg === '--no-write') out.writeArtifact = false;
    else if (arg === '--status') out.status = next() || out.status;
    else if (arg === '--confirm') out.confirm = next() || '';
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--statuses=')) out.statuses = parseCsv(arg.slice('--statuses='.length));
    else if (arg.startsWith('--seed-id=')) out.seedIds.push(arg.slice('--seed-id='.length));
    else if (arg.startsWith('--seed-ids=')) out.seedIds = parseCsv(arg.slice('--seed-ids='.length));
    else if (arg.startsWith('--provider=')) out.provider = arg.slice('--provider='.length);
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--load-limit=')) out.loadLimit = Number(arg.slice('--load-limit='.length));
    else if (arg.startsWith('--min-seed-count=')) out.minSeedCount = Number(arg.slice('--min-seed-count='.length));
    else if (arg.startsWith('--query-limit=')) out.queryLimit = Number(arg.slice('--query-limit='.length));
    else if (arg.startsWith('--artifact-out=')) out.artifactOut = path.resolve(arg.slice('--artifact-out='.length));
    else if (arg.startsWith('--status=')) out.status = arg.slice('--status='.length);
    else if (arg.startsWith('--confirm=')) out.confirm = arg.slice('--confirm='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  out.statuses = uniqueStrings(out.statuses, 20);
  out.seedIds = uniqueStrings(out.seedIds, 100);
  out.provider = compact(out.provider);
  out.limit = Math.max(1, Math.min(500, Number(out.limit || 50)));
  out.loadLimit = Math.max(out.limit, Math.min(1000, Number(out.loadLimit || 500)));
  out.minSeedCount = Math.max(1, Math.min(100, Number(out.minSeedCount || 1)));
  out.queryLimit = Math.max(1, Math.min(50, Number(out.queryLimit || 12)));
  out.status = compact(out.status || 'human-review') || 'human-review';
  return out;
}

function helpText() {
  return `Usage:
  node --import tsx scripts/propose-provider-adapter.mjs
  node --import tsx scripts/propose-provider-adapter.mjs --provider patent_api --limit 25
  node --import tsx scripts/propose-provider-adapter.mjs --apply --confirm provider-adapter-proposal

Default mode writes only data/runtime/provider-adapter-proposals.latest.json.
--apply writes review-only codex_proposals rows with status human-review. It
does not create approval_queue rows, source-query approvals, source registry
entries, canonical graph rows, provider credentials, or provider activation.
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

export async function runProviderAdapterProposal(options = {}) {
  const artifactOut = options.artifactOut || DEFAULT_PROVIDER_ADAPTER_PROPOSAL_ARTIFACT;
  const execute = async (client = null) => {
    const rows = await loadRows(client, options);
    let result = summarizeProviderAdapterProposals(rows, {
      ...options,
      provider: options.provider || '',
      limit: options.limit || 50,
      queryLimit: options.queryLimit || 12,
      minSeedCount: options.minSeedCount || 1,
    });
    if (options.provider) {
      result = {
        ...result,
        proposals: result.proposals.filter((proposal) => proposal.provider === options.provider),
      };
      result.proposalCount = result.proposals.length;
    }
    let persist = {
      ok: true,
      insertedCount: 0,
      dedupedCount: 0,
      failedCount: 0,
      inserted: [],
      deduped: [],
      errors: [],
      boundaries: {
        dbWrites: 0,
        codexProposalWrites: 0,
        approvalQueueWrites: 0,
        sourceQueryApprovalWrites: 0,
        reportBackfillWrites: 0,
        researchEvidenceBundleWrites: 0,
        canonicalWrites: 0,
        sourceRegistryWrites: 0,
        providerActivationWrites: 0,
      },
    };
    if (options.apply) {
      if (options.confirm !== 'provider-adapter-proposal') {
        throw new Error('--apply requires --confirm provider-adapter-proposal');
      }
      persist = await persistProviderAdapterProposalReviews(client, result.proposals, {
        status: options.status || 'human-review',
      });
    }
    const output = {
      ...result,
      ok: result.ok && persist.ok,
      mode: options.apply ? 'provider-adapter-proposal-apply' : 'provider-adapter-proposal',
      dryRun: !options.apply,
      artifactPath: options.writeArtifact === false ? null : artifactOut,
      seedCount: rows.length,
      persist,
      boundaries: {
        ...(result.boundaries || {}),
        ...(persist.boundaries || {}),
        runtimeArtifactWrites: options.writeArtifact === false ? 0 : 1,
      },
    };
    return output;
  };

  const result = options.rows && !options.apply
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
  const options = parseProviderAdapterProposalArgs();
  if (options.help) {
    process.stdout.write(helpText());
  } else {
    runProviderAdapterProposal(options)
      .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
