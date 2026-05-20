#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import {
  buildRouteAwareSeedEvidencePlan,
} from './_shared/seed-evidence-plan.mjs';
import {
  buildBiasBackfillPlan,
  buildBiasBackfillResults,
  buildBiasSelfImprovement,
  diagnoseSeedBias,
  evaluateAutonomousSeedReportCandidateGate,
  evaluateHoldoutValidation,
  evaluateNegativeControlSurvival,
  runSeedProviderAblation,
} from './_shared/seed-bias-diagnostics.mjs';
import {
  runMechanismSeedGeneration,
} from './run-mechanism-seed-generation.mjs';
import {
  persistOperatorSeedBiasArtifacts,
} from './_shared/operator-seed-bias-storage.mjs';
import {
  loadOptionalEnvFile,
  resolveNasPgConfig,
} from './_shared/nas-runtime.mjs';

const DEFAULT_ARTIFACT_ROOT = path.join(process.cwd(), 'data', 'runtime');
const DEFAULT_SEED_ARTIFACT = path.join(DEFAULT_ARTIFACT_ROOT, 'mechanism-seed-generation.latest.json');

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function parseCsv(value = '') {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
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

export function parseSeedBiasBackfillOrchestratorArgs(argv = process.argv.slice(2)) {
  const out = {
    dryRun: true,
    apply: false,
    source: 'all',
    limit: 25,
    seedArtifact: DEFAULT_SEED_ARTIFACT,
    artifactRoot: DEFAULT_ARTIFACT_ROOT,
    generateSeeds: false,
    topSeedLimit: 3,
    targetedBackfillRan: false,
    executeBackfill: false,
    writeArtifacts: true,
    conditions: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--apply') {
      out.apply = true;
      out.dryRun = false;
    } else if (arg === '--source') out.source = next() || out.source;
    else if (arg === '--limit') out.limit = Number(next() || out.limit);
    else if (arg === '--seed-artifact') out.seedArtifact = path.resolve(next() || out.seedArtifact);
    else if (arg === '--artifact-root') out.artifactRoot = path.resolve(next() || out.artifactRoot);
    else if (arg === '--generate-seeds') out.generateSeeds = true;
    else if (arg === '--execute-backfill') out.executeBackfill = true;
    else if (arg === '--top-seed-limit') out.topSeedLimit = Number(next() || out.topSeedLimit);
    else if (arg === '--targeted-backfill-ran') out.targetedBackfillRan = true;
    else if (arg === '--conditions') out.conditions = parseCsv(next());
    else if (arg === '--no-write') out.writeArtifacts = false;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--source=')) out.source = arg.slice('--source='.length);
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--seed-artifact=')) out.seedArtifact = path.resolve(arg.slice('--seed-artifact='.length));
    else if (arg.startsWith('--artifact-root=')) out.artifactRoot = path.resolve(arg.slice('--artifact-root='.length));
    else if (arg.startsWith('--top-seed-limit=')) out.topSeedLimit = Number(arg.slice('--top-seed-limit='.length));
    else if (arg.startsWith('--conditions=')) out.conditions = parseCsv(arg.slice('--conditions='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function helpText() {
  return `Usage:
  node --import tsx scripts/run-seed-bias-backfill-orchestrator.mjs --dry-run --limit 25
  node --import tsx scripts/run-seed-bias-backfill-orchestrator.mjs --dry-run --generate-seeds --source all --limit 25

Default mode is dry-run. It writes local runtime artifacts only and does not
enqueue evidence, activate providers, mutate canonical graph/source registry,
or promote reports.

--apply writes only the seed-bias run/task/raw/accepted/holdout/negative-control
ledger tables. --execute-backfill is a separate opt-in and is restricted to
seed-bias scoped tasks.
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

async function loadSeedBatch(options = {}) {
  if (options.generateSeeds || !existsSync(options.seedArtifact || DEFAULT_SEED_ARTIFACT)) {
    const artifactOut = path.join(options.artifactRoot || DEFAULT_ARTIFACT_ROOT, 'mechanism-seed-generation.bias-input.json');
    return runMechanismSeedGeneration({
      dryRun: true,
      source: options.source || 'all',
      limit: options.limit || 25,
      planEvidence: true,
      artifactOut,
    });
  }
  const artifact = await readJson(options.seedArtifact || DEFAULT_SEED_ARTIFACT);
  if (!artifact.seedEvidencePlans?.length) {
    artifact.seedEvidencePlans = asArray(artifact.seeds).map((seed) => buildRouteAwareSeedEvidencePlan(seed));
    artifact.summary = {
      ...(artifact.summary || {}),
      evidencePlanCount: artifact.seedEvidencePlans.length,
      sourceQueryDraftCount: artifact.seedEvidencePlans.reduce((sum, plan) => sum + asArray(plan.sourceQueryDrafts).length, 0),
    };
  }
  return artifact;
}

function gateRows(seeds = [], plans = [], diagnosis = {}, options = {}) {
  const byPlan = new Map(asArray(plans).map((plan) => [plan.seedId, plan]));
  return asArray(seeds).slice(0, Number(options.topSeedLimit || 3)).map((seed) => {
    const gate = evaluateAutonomousSeedReportCandidateGate(seed, {
      evidencePlan: byPlan.get(seed.seedId),
      biasDiagnosis: diagnosis,
      requireAutonomous: true,
      targetedBackfillRan: Boolean(options.targetedBackfillRan),
      rawEvidence: options.rawEvidence || [],
      acceptedEvidence: options.acceptedEvidence || [],
      holdoutValidation: options.holdoutValidation || {},
      negativeControlSurvival: options.negativeControlSurvival || {},
      issuerBridge: options.issuerBridge || {},
      marketValidation: options.marketValidation || {},
    });
    return {
      seedId: seed.seedId,
      title: seed.seedTitle || seed.bottleneck?.label || seed.seedId,
      gate: gate.gate,
      ok: gate.ok,
      blockers: gate.blockers,
      warnings: gate.warnings,
      visualStatus: gate.visualStatus,
      reason: gate.reason,
    };
  });
}

async function persistApplyLedger(payload, options = {}) {
  if (options.client) {
    return persistOperatorSeedBiasArtifacts(options.client, {
      runId: payload.runId,
      diagnosis: payload.diagnosis,
      seedBatch: payload.seedBatch,
      backfillPlan: payload.backfillPlan,
      backfillResults: payload.backfillResults,
      holdoutValidation: payload.holdoutValidation,
      negativeControlSurvival: payload.negativeControlSurvival,
      payload,
      generatedAt: payload.generatedAt,
    });
  }
  loadOptionalEnvFile(options.envFile || '.env.local');
  const client = new pg.Client(options.pgConfig || resolveNasPgConfig(options.pg || {}));
  await client.connect();
  try {
    return await persistOperatorSeedBiasArtifacts(client, {
      runId: payload.runId,
      diagnosis: payload.diagnosis,
      seedBatch: payload.seedBatch,
      backfillPlan: payload.backfillPlan,
      backfillResults: payload.backfillResults,
      holdoutValidation: payload.holdoutValidation,
      negativeControlSurvival: payload.negativeControlSurvival,
      payload,
      generatedAt: payload.generatedAt,
    });
  } finally {
    await client.end();
  }
}

export async function runSeedBiasBackfillOrchestrator(options = {}) {
  const artifactRoot = options.artifactRoot || DEFAULT_ARTIFACT_ROOT;
  const runId = options.runId || `seed-bias-${Date.now()}`;
  const seedBatch = await loadSeedBatch(options);
  const seeds = asArray(seedBatch.seeds).slice(0, Number(options.limit || seedBatch.seeds?.length || 25));
  const evidencePlans = asArray(seedBatch.seedEvidencePlans).filter((plan) => seeds.some((seed) => seed.seedId === plan.seedId));
  const providerAblations = runSeedProviderAblation(seeds, {
    conditions: options.conditions,
    topSeedLimit: 5,
  });
  const holdoutValidation = evaluateHoldoutValidation(seeds, options.holdoutEvidence || []);
  const negativeControlSurvival = evaluateNegativeControlSurvival(seeds, options.negativeControlEvidence || []);
  const diagnosis = diagnoseSeedBias({
    seeds,
    evidencePlans,
    providerAblations,
    marketValidation: { holdoutValidation },
    negativeControls: negativeControlSurvival,
  });
  const backfillPlan = buildBiasBackfillPlan({ seeds, diagnosis, evidencePlans });
  const backfillResults = buildBiasBackfillResults(backfillPlan, {
    rawEvidence: options.rawEvidence || [],
    acceptedEvidence: options.acceptedEvidence || [],
  });
  const gateResults = gateRows(seeds, evidencePlans, diagnosis, {
    ...options,
    rawEvidence: backfillResults.rawEvidence,
    acceptedEvidence: backfillResults.acceptedEvidence,
    holdoutValidation,
    negativeControlSurvival,
  });
  const selfImprovement = buildBiasSelfImprovement({
    diagnosis,
    backfillPlan,
    ablations: providerAblations,
    gateResults,
  });
  const payload = {
    ok: true,
    runId,
    mode: options.apply ? 'apply' : 'dry-run',
    source: 'seed-bias-backfill-orchestrator',
    generatedAt: new Date().toISOString(),
    seedBatch: {
      artifactPath: seedBatch.artifactPath || options.seedArtifact || null,
      source: seedBatch.source || options.source || 'all',
      seedCount: seeds.length,
      evidencePlanCount: evidencePlans.length,
      manualOriginCount: seeds.filter((seed) => /manual|user|prompt/i.test(compact(seed.lineage?.source))).length,
    },
    diagnosis,
    providerAblations,
    holdoutValidation,
    negativeControlSurvival,
    backfillPlan,
    backfillResults,
    acceptedEvidence: {
      ok: true,
      coveredEvidenceClasses: backfillResults.coveredEvidenceClasses || [],
      acceptedEvidence: backfillResults.acceptedEvidence,
      acceptedEvidenceStoredCount: backfillResults.acceptedEvidenceStoredCount,
      readinessChanged: backfillResults.readinessChanged,
      acceptanceBoundary: backfillResults.acceptanceBoundary,
    },
    gateResults,
    selfImprovement,
    artifactPaths: {},
    boundaries: {
      dbWrites: 0,
      approvalQueueWrites: 0,
      sourceQueryApprovalWrites: 0,
      reportBackfillWrites: 0,
      researchEvidenceBundleWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      providerActivationWrites: 0,
    },
  };
  if (options.executeBackfill) {
    payload.executeBackfill = {
      requested: true,
      executed: false,
      reason: 'provider/source-query execution remains opt-in and seed-bias task-scoped; this run only persisted scoped tasks',
    };
  }
  if (options.writeArtifacts !== false) {
    payload.artifactPaths.diagnostics = await writeJson(path.join(artifactRoot, 'seed-bias-diagnostics.latest.json'), diagnosis);
    payload.artifactPaths.backfillPlan = await writeJson(path.join(artifactRoot, 'seed-bias-backfill-plan.latest.json'), backfillPlan);
    payload.artifactPaths.backfillResults = await writeJson(path.join(artifactRoot, 'seed-bias-backfill-results.latest.json'), backfillResults);
    payload.artifactPaths.acceptedEvidence = await writeJson(path.join(artifactRoot, 'seed-bias-accepted-evidence.latest.json'), payload.acceptedEvidence);
    payload.artifactPaths.selfImprovement = await writeJson(path.join(artifactRoot, 'seed-bias-self-improvement.latest.json'), selfImprovement);
    payload.artifactPaths.orchestrator = await writeJson(path.join(artifactRoot, 'seed-bias-backfill-orchestrator.latest.json'), payload);
  }
  if (options.apply) {
    const persistResult = await persistApplyLedger(payload, options);
    payload.persistence = persistResult;
    payload.boundaries.dbWrites = persistResult.dbWrites || 0;
    if (options.writeArtifacts !== false) {
      payload.artifactPaths.orchestrator = await writeJson(path.join(artifactRoot, 'seed-bias-backfill-orchestrator.latest.json'), payload);
    }
  }
  return payload;
}

async function main() {
  const options = parseSeedBiasBackfillOrchestratorArgs();
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const result = await runSeedBiasBackfillOrchestrator(options);
  process.stdout.write(`${JSON.stringify({
    ok: result.ok,
    mode: result.mode,
    seedCount: result.seedBatch.seedCount,
    verdict: result.diagnosis.verdict,
    dominantClass: Object.entries(result.diagnosis.classDistribution.counts || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    underrepresentedClasses: result.diagnosis.underrepresentedClasses.map((item) => item.evidenceClass),
    backfillTaskCount: result.backfillPlan.taskCount,
    rawEvidenceStoredCount: result.backfillResults.rawEvidenceStoredCount,
    acceptedEvidenceStoredCount: result.backfillResults.acceptedEvidenceStoredCount,
    gateBlockedCount: result.gateResults.filter((item) => !item.ok).length,
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
