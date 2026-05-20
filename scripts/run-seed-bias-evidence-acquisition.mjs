#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import {
  ensureOperatorSeedBiasSchema,
  loadLatestOperatorSeedBiasRun,
  loadOperatorSeedBiasAcceptedEvidence,
  loadOperatorSeedBiasBackfillTasks,
  loadOperatorSeedBiasRawEvidence,
  persistOperatorSeedAcceptedEvidence,
  persistOperatorSeedHoldoutResults,
  persistOperatorSeedNegativeControls,
  persistOperatorSeedRawEvidence,
} from './_shared/operator-seed-bias-storage.mjs';
import {
  DEFAULT_SEED_BIAS_ACQUISITION_CLASSES,
  buildSeedBiasEvidenceAcquisition,
  executeSeedBiasSourceQueries,
} from './_shared/seed-bias-evidence-acquisition.mjs';
import {
  loadOptionalEnvFile,
  resolveNasPgConfig,
} from './_shared/nas-runtime.mjs';

const DEFAULT_ARTIFACT_ROOT = path.join(process.cwd(), 'data', 'runtime');

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseCsv(value = '') {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function uniqueStrings(values = [], limit = 80) {
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

export function parseSeedBiasEvidenceAcquisitionArgs(argv = process.argv.slice(2)) {
  const out = {
    apply: false,
    dryRun: true,
    runId: '',
    seedId: '',
    artifactRoot: DEFAULT_ARTIFACT_ROOT,
    evidenceClasses: [...DEFAULT_SEED_BIAS_ACQUISITION_CLASSES],
    writeArtifacts: true,
    executeSourceQuery: false,
    sourceQueryMaxItems: 2,
    sourceQueryTimeoutMs: 8000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--apply') {
      out.apply = true;
      out.dryRun = false;
    } else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--run-id') out.runId = next() || '';
    else if (arg === '--seed-id') out.seedId = next() || '';
    else if (arg === '--artifact-root') out.artifactRoot = path.resolve(next() || out.artifactRoot);
    else if (arg === '--evidence-classes') out.evidenceClasses = parseCsv(next());
    else if (arg === '--execute-source-query') out.executeSourceQuery = true;
    else if (arg === '--source-query-max-items') out.sourceQueryMaxItems = Number(next() || out.sourceQueryMaxItems);
    else if (arg === '--source-query-timeout-ms') out.sourceQueryTimeoutMs = Number(next() || out.sourceQueryTimeoutMs);
    else if (arg === '--no-write') out.writeArtifacts = false;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--run-id=')) out.runId = arg.slice('--run-id='.length);
    else if (arg.startsWith('--seed-id=')) out.seedId = arg.slice('--seed-id='.length);
    else if (arg.startsWith('--artifact-root=')) out.artifactRoot = path.resolve(arg.slice('--artifact-root='.length));
    else if (arg.startsWith('--evidence-classes=')) out.evidenceClasses = parseCsv(arg.slice('--evidence-classes='.length));
    else if (arg.startsWith('--source-query-max-items=')) out.sourceQueryMaxItems = Number(arg.slice('--source-query-max-items='.length));
    else if (arg.startsWith('--source-query-timeout-ms=')) out.sourceQueryTimeoutMs = Number(arg.slice('--source-query-timeout-ms='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  out.evidenceClasses = uniqueStrings(out.evidenceClasses, 12).filter((klass) => DEFAULT_SEED_BIAS_ACQUISITION_CLASSES.includes(klass));
  if (!out.evidenceClasses.length) out.evidenceClasses = [...DEFAULT_SEED_BIAS_ACQUISITION_CLASSES];
  return out;
}

function helpText() {
  return `Usage:
  node --import tsx scripts/run-seed-bias-evidence-acquisition.mjs --dry-run
  node --import tsx scripts/run-seed-bias-evidence-acquisition.mjs --apply --run-id <latest-run-id>
  node --import tsx scripts/run-seed-bias-evidence-acquisition.mjs --apply --execute-source-query --run-id <latest-run-id>

This executes only seed-bias scoped evidence acquisition preparation for one
stored seed. With --execute-source-query it executes source-query RSS searches
only for the selected seed-bias tasks. It does not execute providers, activate
providers, mutate source registry/canonical graph, or promote reports.
`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}

function normalizeTask(row = {}) {
  const payload = row.payload || {};
  return {
    ...payload,
    taskId: payload.taskId || row.task_id,
    seedId: payload.seedId || row.seed_id,
    evidenceClass: payload.evidenceClass || row.evidence_class,
    providerRoute: payload.providerRoute || row.provider_route,
    sourceQuery: payload.sourceQuery || row.source_query,
    acceptanceCriteria: payload.acceptanceCriteria || row.acceptance_criteria || {},
    status: payload.status || row.status,
    reviewRequired: payload.reviewRequired ?? row.review_required,
  };
}

async function loadSeedFromArtifact(run = {}, seedId = '') {
  const artifactPath = compact(run.payload?.seedBatch?.artifactPath);
  if (!artifactPath || !existsSync(artifactPath)) return null;
  const artifact = await readJson(artifactPath);
  return asArray(artifact.seeds).find((seed) => seed.seedId === seedId) || null;
}

async function withClient(options = {}, fn) {
  if (options.client) return fn(options.client);
  loadOptionalEnvFile(options.envFile || '.env.local');
  const client = new pg.Client(options.pgConfig || resolveNasPgConfig(options.pg || {}));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function loadTarget(client, options = {}) {
  await ensureOperatorSeedBiasSchema(client);
  const run = await loadLatestOperatorSeedBiasRun(client, { runId: options.runId });
  if (!run) throw new Error(options.runId ? `seed bias run not found: ${options.runId}` : 'no seed bias run found');
  const runPayload = run.payload || {};
  const gateSeedId = compact(options.seedId || runPayload.gateResults?.[0]?.seedId);
  const tasks = (await loadOperatorSeedBiasBackfillTasks(client, {
    runId: run.run_id,
    seedId: gateSeedId,
    evidenceClasses: options.evidenceClasses || DEFAULT_SEED_BIAS_ACQUISITION_CLASSES,
  })).map(normalizeTask);
  const seedId = gateSeedId || compact(tasks[0]?.seedId);
  const seed = await loadSeedFromArtifact(run, seedId);
  if (!seed) throw new Error(`seed ${seedId || '(unknown)'} not found in run artifact`);
  const existingRawEvidence = await loadOperatorSeedBiasRawEvidence(client, {
    runId: run.run_id,
    seedId,
  });
  const existingAcceptedEvidence = await loadOperatorSeedBiasAcceptedEvidence(client, {
    runId: run.run_id,
    seedId,
  });
  return { run, seed, tasks, existingRawEvidence, existingAcceptedEvidence };
}

async function persistAcquisition(client, runId, acquisition = {}) {
  const raw = await persistOperatorSeedRawEvidence(client, runId, acquisition.newRawEvidence || []);
  const accepted = await persistOperatorSeedAcceptedEvidence(client, runId, acquisition.newAcceptedEvidence || []);
  const holdout = await persistOperatorSeedHoldoutResults(client, runId, acquisition.holdoutValidation || {});
  const negative = await persistOperatorSeedNegativeControls(client, runId, acquisition.negativeControlSurvival || {});
  return {
    ok: true,
    raw,
    accepted,
    holdout,
    negative,
    dbWrites: raw.count + accepted.count + holdout.count + negative.count,
  };
}

export async function runSeedBiasEvidenceAcquisition(options = {}) {
  return withClient(options, async (client) => {
    const target = await loadTarget(client, options);
    const diagnosis = target.run.payload?.diagnosis || { verdict: target.run.verdict };
    const selectedTasks = target.tasks.filter((task) => asArray(options.evidenceClasses || DEFAULT_SEED_BIAS_ACQUISITION_CLASSES).includes(task.evidenceClass));
    const sourceQueryExecution = options.executeSourceQuery
      ? await executeSeedBiasSourceQueries({
        seed: target.seed,
        tasks: selectedTasks,
        generatedAt: options.generatedAt || new Date().toISOString(),
        fetchImpl: options.fetchImpl,
        maxItemsPerQuery: options.sourceQueryMaxItems,
        timeoutMs: options.sourceQueryTimeoutMs,
      })
      : null;
    const acquisition = buildSeedBiasEvidenceAcquisition({
      seed: target.seed,
      tasks: selectedTasks,
      existingRawEvidence: target.existingRawEvidence,
      existingAcceptedEvidence: target.existingAcceptedEvidence,
      collectedRawEvidence: sourceQueryExecution?.rawEvidence || null,
      diagnosis,
      targetedBackfillRan: true,
      generatedAt: options.generatedAt || new Date().toISOString(),
    });
    const payload = {
      ok: true,
      mode: options.apply ? 'apply' : 'dry-run',
      source: 'seed-bias-evidence-acquisition',
      runId: target.run.run_id,
      seedId: acquisition.seedId,
      generatedAt: acquisition.generatedAt,
      selectedEvidenceClasses: acquisition.selectedEvidenceClasses,
      untouchedEvidenceClasses: acquisition.untouchedEvidenceClasses,
      execution: {
        executedTaskCount: acquisition.executedTaskCount,
        providerExecution: false,
        sourceQueryExecution: Boolean(sourceQueryExecution),
        sourceQueryTaskReady: !sourceQueryExecution,
        queryCount: sourceQueryExecution?.queryCount || 0,
        resultCount: sourceQueryExecution?.resultCount || 0,
      },
      sourceQueryRuns: sourceQueryExecution?.queryRuns || [],
      rawEvidenceCount: acquisition.rawEvidenceCount,
      acceptedEvidenceCount: acquisition.acceptedEvidenceCount,
      newRawEvidenceCount: acquisition.newRawEvidence.length,
      newAcceptedEvidenceCount: acquisition.newAcceptedEvidence.length,
      negativeControlStatus: acquisition.negativeControlSurvival.items?.[0]?.survivalStatus || 'INCONCLUSIVE',
      holdoutConfirmed: Boolean(acquisition.holdoutValidation.holdoutConfirmed),
      holdoutValidation: acquisition.holdoutValidation,
      negativeControlSurvival: acquisition.negativeControlSurvival,
      issuerBridgeStatus: acquisition.issuerBridgeStatus,
      gateResult: acquisition.gateResult,
      visualStatus: acquisition.visualStatus,
      finalBlocker: acquisition.finalBlocker,
      acquisition,
      artifactPaths: {},
      boundaries: {
        dbWrites: 0,
        approvalQueueWrites: 0,
        sourceQueryApprovalWrites: 0,
        sourceQueryExecutionWrites: sourceQueryExecution ? acquisition.newRawEvidence.length : 0,
        reportBackfillWrites: 0,
        researchEvidenceBundleWrites: 0,
        canonicalWrites: 0,
        sourceRegistryWrites: 0,
        providerActivationWrites: 0,
      },
    };
    if (options.apply) {
      const persisted = await persistAcquisition(client, target.run.run_id, acquisition);
      payload.persistence = persisted;
      payload.boundaries.dbWrites = persisted.dbWrites;
    }
    if (options.writeArtifacts !== false) {
      const root = options.artifactRoot || DEFAULT_ARTIFACT_ROOT;
      payload.artifactPaths.acquisition = await writeJson(path.join(root, 'seed-bias-evidence-acquisition.latest.json'), payload);
      payload.artifactPaths.rawEvidence = await writeJson(path.join(root, 'seed-bias-evidence-acquisition-raw.latest.json'), {
        ok: true,
        runId: payload.runId,
        seedId: payload.seedId,
        rawEvidence: acquisition.rawEvidence,
        newRawEvidence: acquisition.newRawEvidence,
      });
      payload.artifactPaths.acceptedEvidence = await writeJson(path.join(root, 'seed-bias-evidence-acquisition-accepted.latest.json'), {
        ok: true,
        runId: payload.runId,
        seedId: payload.seedId,
        acceptedEvidence: acquisition.acceptedEvidence,
        newAcceptedEvidence: acquisition.newAcceptedEvidence,
      });
    }
    return payload;
  });
}

async function main() {
  const options = parseSeedBiasEvidenceAcquisitionArgs();
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const result = await runSeedBiasEvidenceAcquisition(options);
  process.stdout.write(`${JSON.stringify({
    ok: result.ok,
    mode: result.mode,
    runId: result.runId,
    seedId: result.seedId,
    selectedEvidenceClasses: result.selectedEvidenceClasses,
    execution: result.execution,
    newRawEvidenceCount: result.newRawEvidenceCount,
    newAcceptedEvidenceCount: result.newAcceptedEvidenceCount,
    rawEvidenceCount: result.rawEvidenceCount,
    acceptedEvidenceCount: result.acceptedEvidenceCount,
    negativeControlStatus: result.negativeControlStatus,
    holdoutConfirmed: result.holdoutConfirmed,
    issuerBridgeStatus: result.issuerBridgeStatus,
    gateResult: result.gateResult.gate,
    visualStatus: result.visualStatus,
    finalBlocker: result.finalBlocker,
    artifactPaths: result.artifactPaths,
    boundaries: result.boundaries,
  }, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
