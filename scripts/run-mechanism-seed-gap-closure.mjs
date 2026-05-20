#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import {
  ensureOperatorResearchSeedSchema,
  loadOperatorResearchSeeds,
} from './_shared/operator-research-seeds.mjs';
import {
  DEFAULT_OPERATOR_SEED_GAP_STATE_PATH,
  buildProviderGapClosureSummary,
  enqueueProviderGapSourceQueryApprovals,
  loadOperatorSeedGapClosureState,
  saveOperatorSeedGapClosureState,
} from './_shared/provider-gap-proposals.mjs';

const { Client } = pg;

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function uniqueStrings(values = [], limit = 80) {
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

export function parseMechanismSeedGapClosureArgs(argv = process.argv.slice(2)) {
  const out = {
    apply: false,
    dryRun: true,
    statuses: ['needs_evidence'],
    includeReviewReady: false,
    seedIds: [],
    limit: 5,
    sourceQueryLimit: 100,
    queryLimitPerSeed: 6,
    queryLimitPerClass: 2,
    maxAttempts: 1,
    throttleHours: 24,
    force: false,
    stateFile: DEFAULT_OPERATOR_SEED_GAP_STATE_PATH,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--apply') {
      out.apply = true;
      out.dryRun = false;
    } else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--statuses') out.statuses = parseCsv(next());
    else if (arg === '--include-review-ready') out.includeReviewReady = true;
    else if (arg === '--seed-id') out.seedIds.push(next());
    else if (arg === '--seed-ids') out.seedIds = parseCsv(next());
    else if (arg === '--limit') out.limit = Number(next() || out.limit);
    else if (arg === '--source-query-limit') out.sourceQueryLimit = Number(next() || out.sourceQueryLimit);
    else if (arg === '--query-limit-per-seed') out.queryLimitPerSeed = Number(next() || out.queryLimitPerSeed);
    else if (arg === '--query-limit-per-class') out.queryLimitPerClass = Number(next() || out.queryLimitPerClass);
    else if (arg === '--max-attempts') out.maxAttempts = Number(next() || out.maxAttempts);
    else if (arg === '--throttle-hours') out.throttleHours = Number(next() || out.throttleHours);
    else if (arg === '--state-file') out.stateFile = path.resolve(next() || out.stateFile);
    else if (arg === '--force') out.force = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--statuses=')) out.statuses = parseCsv(arg.slice('--statuses='.length));
    else if (arg.startsWith('--seed-id=')) out.seedIds.push(arg.slice('--seed-id='.length));
    else if (arg.startsWith('--seed-ids=')) out.seedIds = parseCsv(arg.slice('--seed-ids='.length));
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--source-query-limit=')) out.sourceQueryLimit = Number(arg.slice('--source-query-limit='.length));
    else if (arg.startsWith('--query-limit-per-seed=')) out.queryLimitPerSeed = Number(arg.slice('--query-limit-per-seed='.length));
    else if (arg.startsWith('--query-limit-per-class=')) out.queryLimitPerClass = Number(arg.slice('--query-limit-per-class='.length));
    else if (arg.startsWith('--max-attempts=')) out.maxAttempts = Number(arg.slice('--max-attempts='.length));
    else if (arg.startsWith('--throttle-hours=')) out.throttleHours = Number(arg.slice('--throttle-hours='.length));
    else if (arg.startsWith('--state-file=')) out.stateFile = path.resolve(arg.slice('--state-file='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  out.limit = Math.max(1, Math.min(100, Number(out.limit || 5)));
  out.sourceQueryLimit = Math.max(1, Math.min(1000, Number(out.sourceQueryLimit || 100)));
  out.queryLimitPerSeed = Math.max(1, Math.min(100, Number(out.queryLimitPerSeed || 6)));
  out.queryLimitPerClass = Math.max(1, Math.min(6, Number(out.queryLimitPerClass || 2)));
  out.maxAttempts = Math.max(1, Math.min(10, Number(out.maxAttempts || 1)));
  out.throttleHours = Math.max(0, Math.min(24 * 30, Number(out.throttleHours || 0)));
  return out;
}

function helpText() {
  return `Usage:
  node --import tsx scripts/run-mechanism-seed-gap-closure.mjs --dry-run --statuses needs_evidence
  node --import tsx scripts/run-mechanism-seed-gap-closure.mjs --apply --statuses needs_evidence --limit 5 --query-limit-per-seed 6

Default mode is dry-run. --apply creates only seed-scoped source-query approvals
for provider/source coverage gaps and writes terminal attempt state to:
  data/runtime/operator-seed-gap-closure-state.json

It does not activate providers, mutate canonical graph/source registry, create
report_backfill_tasks, or write research_evidence_bundles.
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

function statusesForOptions(options = {}) {
  return uniqueStrings([
    options.statuses || ['needs_evidence'],
    options.includeReviewReady ? ['review_ready'] : [],
  ], 20);
}

async function loadSeedRows(client, options = {}) {
  if (options.rows) {
    const seedFilter = new Set(uniqueStrings(options.seedIds || [], 100));
    return asArray(options.rows)
      .filter((row) => !seedFilter.size || seedFilter.has(row.seed_id || row.seedId || row.seed_json?.seedId))
      .slice(0, options.limit || 5);
  }
  if (options.ensureSchema !== false) await ensureOperatorResearchSeedSchema(client);
  const rows = await loadOperatorResearchSeeds(client, {
    statuses: statusesForOptions(options),
    limit: Math.max(1, Math.min(500, Number(options.loadLimit || 500))),
  });
  const seedFilter = new Set(uniqueStrings(options.seedIds || [], 100));
  return rows
    .filter((row) => !seedFilter.size || seedFilter.has(row.seed_id))
    .slice(0, options.limit || 5);
}

function rowSummary(row = {}, state = {}, options = {}) {
  const summary = buildProviderGapClosureSummary(row, { ...options, state });
  return {
    seedId: row.seed_id || row.seedId || row.seed_json?.seedId || null,
    title: row.seed_title || row.seedTitle || row.seed_json?.seedTitle || '',
    status: row.status || row.seed_json?.status || '',
    providerGaps: uniqueStrings([row.provider_gaps, row.providerGaps, row.seed_json?.providerGaps], 40),
    proposalCount: summary.proposalCount,
    draftCount: summary.draftCount,
    readyDraftCount: summary.readyDraftCount,
    skippedDraftCount: summary.skippedDraftCount,
    providers: summary.providers,
    evidenceClasses: summary.evidenceClasses,
    nextAction: summary.nextAction,
    sampleQueries: (summary.readyDrafts || summary.drafts).slice(0, 3).map((draft) => ({
      provider: draft.providerGapProvider,
      evidenceClass: draft.desiredEvidenceClass,
      query: draft.query,
    })),
  };
}

function summarizeTargets(targets = []) {
  return targets.reduce((acc, item) => {
    acc.proposalCount += item.proposalCount || 0;
    acc.draftCount += item.draftCount || 0;
    acc.readyDraftCount += item.readyDraftCount || 0;
    acc.skippedDraftCount += item.skippedDraftCount || 0;
    for (const provider of item.providers || []) acc.providers[provider] = (acc.providers[provider] || 0) + 1;
    for (const evidenceClass of item.evidenceClasses || []) acc.evidenceClasses[evidenceClass] = (acc.evidenceClasses[evidenceClass] || 0) + 1;
    return acc;
  }, {
    proposalCount: 0,
    draftCount: 0,
    readyDraftCount: 0,
    skippedDraftCount: 0,
    providers: {},
    evidenceClasses: {},
  });
}

export async function runMechanismSeedGapClosure(options = {}) {
  const stateFile = options.stateFile || DEFAULT_OPERATOR_SEED_GAP_STATE_PATH;
  const state = options.state || await loadOperatorSeedGapClosureState(stateFile);
  const execute = async (client = null) => {
    const rows = await loadSeedRows(client, options);
    const targets = rows.map((row) => rowSummary(row, state, options)).filter((item) => item.proposalCount > 0);
    const aggregate = summarizeTargets(targets);

    if (!options.apply) {
      return {
        ok: true,
        dryRun: true,
        stateFile,
        seedCount: rows.length,
        targetCount: targets.length,
        ...aggregate,
        targets,
        boundaries: {
          dbWrites: 0,
          approvalQueueWrites: 0,
          sourceQueryApprovalWrites: 0,
          reportBackfillWrites: 0,
          researchEvidenceBundleWrites: 0,
          canonicalWrites: 0,
          sourceRegistryWrites: 0,
          providerActivationWrites: 0,
          stateFileWrites: 0,
        },
      };
    }

    const enqueue = await enqueueProviderGapSourceQueryApprovals(client, rows, {
      ...options,
      state,
      limit: options.sourceQueryLimit,
      queryLimitPerSeed: options.queryLimitPerSeed,
      queryLimitPerClass: options.queryLimitPerClass,
      maxAttempts: options.maxAttempts,
      throttleHours: options.throttleHours,
      force: options.force,
    });
    const savedState = await saveOperatorSeedGapClosureState(enqueue.state, stateFile);

    return {
      ok: enqueue.ok,
      dryRun: false,
      stateFile,
      seedCount: rows.length,
      targetCount: targets.length,
      ...aggregate,
      targets,
      enqueue: {
        inspectedCount: enqueue.inspectedCount,
        insertedCount: enqueue.insertedCount,
        dedupedCount: enqueue.dedupedCount,
        skippedCount: enqueue.skippedCount,
        failedCount: enqueue.failedCount,
        queued: enqueue.queued,
        deduped: enqueue.deduped,
        skipped: enqueue.skipped,
        errors: enqueue.errors,
      },
      state: {
        version: savedState.version,
        updatedAt: savedState.updatedAt,
        attemptCount: Object.keys(savedState.attempts || {}).length,
      },
      boundaries: {
        dbWrites: enqueue.approvalQueueWrites,
        approvalQueueWrites: enqueue.approvalQueueWrites,
        sourceQueryApprovalWrites: enqueue.sourceQueryApprovalWrites,
        reportBackfillWrites: 0,
        researchEvidenceBundleWrites: 0,
        canonicalWrites: 0,
        sourceRegistryWrites: 0,
        providerActivationWrites: 0,
        stateFileWrites: 1,
      },
    };
  };

  if (options.rows && !options.apply) return execute(null);
  return withClient(options, execute);
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
  const options = parseMechanismSeedGapClosureArgs();
  if (options.help) {
    process.stdout.write(helpText());
  } else {
    runMechanismSeedGapClosure(options)
      .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
