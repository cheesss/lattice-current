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
  DEFAULT_OFFICIAL_ISSUER_CANDIDATES,
  buildSeedBiasEvidenceAcquisition,
  executeSeedBiasOfficialRoutes,
  executeSeedBiasSourceQueries,
} from './_shared/seed-bias-evidence-acquisition.mjs';
import {
  buildPositivePathCandidateChildSeeds,
  buildChildBottleneckBackfillTasks,
  buildInterconnectionRouteSplitTracks,
  classifySeedRouteMismatch,
  classifyChildProviderBlocked,
  decomposeChildBottleneckSeeds,
  selectPositivePathCandidateChildSeed,
  selectPreferredChildBottleneckSeed,
  summarizeChildBottleneckAcquisitions,
} from './_shared/seed-child-bottleneck-decomposition.mjs';
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

function seedId(seed = {}) {
  return compact(seed.seedId || seed.seed_id || seed.id);
}

export function parseSeedBiasEvidenceAcquisitionArgs(argv = process.argv.slice(2)) {
  const out = {
    apply: false,
    dryRun: true,
    runId: '',
    seedId: '',
    seedArtifact: '',
    orchestratorArtifact: '',
    artifactRoot: DEFAULT_ARTIFACT_ROOT,
    evidenceClasses: [...DEFAULT_SEED_BIAS_ACQUISITION_CLASSES],
    writeArtifacts: true,
    executeSourceQuery: false,
    executeOfficialRoute: false,
    executeCompanyIr: false,
    issuerCandidates: [...DEFAULT_OFFICIAL_ISSUER_CANDIDATES],
    sourceQueryMaxItems: 2,
    sourceQueryTimeoutMs: 8000,
    officialRouteTimeoutMs: 10000,
    decomposeChildBottlenecks: false,
    selectedChildOnly: false,
    positivePathChild: false,
    includePositivePathCandidates: false,
    childNode: '',
    childSeedId: '',
    childLimit: 8,
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
    else if (arg === '--seed-artifact') out.seedArtifact = path.resolve(next() || out.seedArtifact);
    else if (arg === '--orchestrator-artifact') out.orchestratorArtifact = path.resolve(next() || out.orchestratorArtifact);
    else if (arg === '--artifact-root') out.artifactRoot = path.resolve(next() || out.artifactRoot);
    else if (arg === '--evidence-classes') out.evidenceClasses = parseCsv(next());
    else if (arg === '--execute-source-query') out.executeSourceQuery = true;
    else if (arg === '--execute-official-route') out.executeOfficialRoute = true;
    else if (arg === '--execute-company-ir') {
      out.executeCompanyIr = true;
      out.executeOfficialRoute = true;
    }
    else if (arg === '--decompose-child-bottlenecks') out.decomposeChildBottlenecks = true;
    else if (arg === '--selected-child-only' || arg === '--single-child') out.selectedChildOnly = true;
    else if (arg === '--positive-path-child') out.positivePathChild = true;
    else if (arg === '--include-positive-path-candidates') out.includePositivePathCandidates = true;
    else if (arg === '--child-node') out.childNode = next() || '';
    else if (arg === '--child-seed-id') out.childSeedId = next() || '';
    else if (arg === '--issuer-candidates') out.issuerCandidates = parseCsv(next());
    else if (arg === '--child-limit') out.childLimit = Number(next() || out.childLimit);
    else if (arg === '--source-query-max-items') out.sourceQueryMaxItems = Number(next() || out.sourceQueryMaxItems);
    else if (arg === '--source-query-timeout-ms') out.sourceQueryTimeoutMs = Number(next() || out.sourceQueryTimeoutMs);
    else if (arg === '--official-route-timeout-ms') out.officialRouteTimeoutMs = Number(next() || out.officialRouteTimeoutMs);
    else if (arg === '--no-write') out.writeArtifacts = false;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--run-id=')) out.runId = arg.slice('--run-id='.length);
    else if (arg.startsWith('--seed-id=')) out.seedId = arg.slice('--seed-id='.length);
    else if (arg.startsWith('--seed-artifact=')) out.seedArtifact = path.resolve(arg.slice('--seed-artifact='.length));
    else if (arg.startsWith('--orchestrator-artifact=')) out.orchestratorArtifact = path.resolve(arg.slice('--orchestrator-artifact='.length));
    else if (arg.startsWith('--artifact-root=')) out.artifactRoot = path.resolve(arg.slice('--artifact-root='.length));
    else if (arg.startsWith('--evidence-classes=')) out.evidenceClasses = parseCsv(arg.slice('--evidence-classes='.length));
    else if (arg.startsWith('--issuer-candidates=')) out.issuerCandidates = parseCsv(arg.slice('--issuer-candidates='.length));
    else if (arg.startsWith('--child-node=')) out.childNode = arg.slice('--child-node='.length);
    else if (arg.startsWith('--child-seed-id=')) out.childSeedId = arg.slice('--child-seed-id='.length);
    else if (arg.startsWith('--child-limit=')) out.childLimit = Number(arg.slice('--child-limit='.length));
    else if (arg.startsWith('--source-query-max-items=')) out.sourceQueryMaxItems = Number(arg.slice('--source-query-max-items='.length));
    else if (arg.startsWith('--source-query-timeout-ms=')) out.sourceQueryTimeoutMs = Number(arg.slice('--source-query-timeout-ms='.length));
    else if (arg.startsWith('--official-route-timeout-ms=')) out.officialRouteTimeoutMs = Number(arg.slice('--official-route-timeout-ms='.length));
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
  node --import tsx scripts/run-seed-bias-evidence-acquisition.mjs --apply --execute-official-route --run-id <latest-run-id>
  node --import tsx scripts/run-seed-bias-evidence-acquisition.mjs --apply --execute-official-route --decompose-child-bottlenecks --run-id <latest-run-id>
  node --import tsx scripts/run-seed-bias-evidence-acquisition.mjs --apply --execute-official-route --decompose-child-bottlenecks --single-child --run-id <latest-run-id>
  node --import tsx scripts/run-seed-bias-evidence-acquisition.mjs --apply --execute-company-ir --decompose-child-bottlenecks --single-child --run-id <latest-run-id>
  node --import tsx scripts/run-seed-bias-evidence-acquisition.mjs --dry-run --execute-official-route --decompose-child-bottlenecks --single-child --positive-path-child --run-id <latest-run-id>
  node --import tsx scripts/run-seed-bias-evidence-acquisition.mjs --dry-run --seed-artifact data/runtime/mechanism-seed-generation.latest.json --decompose-child-bottlenecks --single-child

This executes only seed-bias scoped evidence acquisition preparation for one
stored seed. With --execute-source-query it executes source-query RSS searches
only for the selected seed-bias tasks. With --execute-official-route it runs
limited SEC/issuer official checks. It does not activate providers, mutate
source registry/canonical graph, approval queue, or promote reports.
With --decompose-child-bottlenecks it keeps the broad parent blocked and runs
the selected acquisition path against narrower child bottleneck seeds. With
--single-child/--selected-child-only it executes only the preferred child
bottleneck seed, defaulting to ABF/build-up substrate before probe/test,
underfill, bonding, and interposer/metrology candidates. --execute-company-ir
adds a read-only allowlist-bound company IR collector; it does not activate
providers or mutate source/canonical registries.
--positive-path-child selects a separate provider-coverage validation child
such as interconnection study capacity / PWR instead of the ABF child.
--seed-artifact enables a local artifact-only dry-run path without DB reads or
writes; it is intended for no-manual, no-positive-path validation starts.
In local --seed-artifact mode, positive-path candidate suggestions are hidden
unless --positive-path-child or --include-positive-path-candidates is explicit.
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

function prioritizedGateBlocker(gateResult = {}) {
  const blockers = asArray(gateResult.blockers);
  return blockers.find((item) => item === 'negative_control_not_closed')
    || blockers.find((item) => item === 'holdout_confirmation_missing')
    || blockers.find((item) => item === 'market_validation_missing')
    || blockers.find((item) => item === 'independent_source_breadth_missing')
    || blockers.find((item) => item === 'accepted_evidence_missing')
    || blockers[0]
    || null;
}

async function loadSeedFromArtifact(run = {}, seedId = '') {
  const artifactPath = compact(run.payload?.seedBatch?.artifactPath);
  if (!artifactPath || !existsSync(artifactPath)) return null;
  const artifact = await readJson(artifactPath);
  return asArray(artifact.seeds).find((seed) => seed.seedId === seedId) || null;
}

async function loadLocalTargetFromSeedArtifact(options = {}) {
  const seedArtifact = path.resolve(options.seedArtifact || '');
  if (!seedArtifact || !existsSync(seedArtifact)) throw new Error(`seed artifact not found: ${seedArtifact}`);
  const artifact = await readJson(seedArtifact);
  const seeds = asArray(artifact.seeds);
  const seed = seeds.find((row) => row.seedId === options.seedId) || seeds[0] || null;
  if (!seed) throw new Error(`no seeds found in artifact: ${seedArtifact}`);
  const plan = asArray(artifact.seedEvidencePlans).find((row) => row.seedId === seed.seedId) || {};
  const tasks = asArray(plan.backfillTasks || plan.tasks || plan.sourceQueryDrafts).map(normalizeTask);
  const orchestratorPath = options.orchestratorArtifact
    || path.join(options.artifactRoot || DEFAULT_ARTIFACT_ROOT, 'seed-bias-backfill-orchestrator.latest.json');
  const orchestrator = existsSync(orchestratorPath) ? await readJson(orchestratorPath) : {};
  const runId = compact(options.runId || orchestrator.runId || `local-seed-artifact-${Date.now()}`);
  return {
    run: {
      run_id: runId,
      payload: {
        seedBatch: {
          artifactPath: seedArtifact,
          source: artifact.source || artifact.summary?.source || 'local_seed_artifact',
          seedCount: seeds.length,
          manualOriginCount: Number(artifact.summary?.manualOriginCount || 0),
        },
        diagnosis: orchestrator.diagnosis || { verdict: orchestrator.verdict || 'INCONCLUSIVE_NEEDS_BACKFILL' },
        gateResults: orchestrator.gateResults || [],
      },
      verdict: orchestrator.verdict || orchestrator.diagnosis?.verdict || 'INCONCLUSIVE_NEEDS_BACKFILL',
    },
    seed,
    tasks,
    existingRawEvidence: [],
    existingAcceptedEvidence: [],
    localArtifactOnly: true,
  };
}

async function withClient(options = {}, fn) {
  if (options.seedArtifact && !options.apply) {
    return fn({ __localTarget: await loadLocalTargetFromSeedArtifact(options) });
  }
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
  if (client?.__localTarget) return client.__localTarget;
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
    const generatedAt = options.generatedAt || new Date().toISOString();
    if (options.decomposeChildBottlenecks) {
      const decomposition = decomposeChildBottleneckSeeds(target.seed, {
        limit: options.childLimit,
        generatedAt,
        parentAcceptedEvidenceCount: target.existingAcceptedEvidence.length,
        parentIssuerBridgeStatus: 'missing',
        parentNegativeControlStatus: 'INCONCLUSIVE',
        parentHoldoutConfirmed: false,
      });
      const positivePathCandidatePool = buildPositivePathCandidateChildSeeds({ generatedAt });
      const selection = options.positivePathChild
        ? selectPositivePathCandidateChildSeed(positivePathCandidatePool, {
          childNode: options.childNode,
          childSeedId: options.childSeedId,
        })
        : selectPreferredChildBottleneckSeed(decomposition.childSeeds, {
          childNode: options.childNode,
          childSeedId: options.childSeedId,
        });
      const childSeedsToRun = options.selectedChildOnly
        ? asArray(selection.childSeed)
        : options.positivePathChild
          ? positivePathCandidatePool
          : decomposition.childSeeds;
      const childResults = [];
      let totalDbWrites = 0;
      for (const childSeed of childSeedsToRun) {
        const childTasks = buildChildBottleneckBackfillTasks(childSeed, { generatedAt })
          .filter((task) => asArray(options.evidenceClasses || DEFAULT_SEED_BIAS_ACQUISITION_CLASSES).includes(task.evidenceClass));
        const officialRouteExecution = options.executeOfficialRoute
          ? await executeSeedBiasOfficialRoutes({
            seed: childSeed,
            tasks: childTasks,
            issuerCandidates: childSeed.routeIssuerCandidates || childSeed.issuerCandidates,
            generatedAt,
            fetchImpl: options.fetchImpl,
            timeoutMs: options.officialRouteTimeoutMs,
            executeCompanyIr: options.executeCompanyIr,
            companyIrAllowlist: options.companyIrAllowlist,
          })
          : null;
        const sourceQueryExecution = options.executeSourceQuery
          ? await executeSeedBiasSourceQueries({
            seed: childSeed,
            tasks: childTasks,
            generatedAt,
            fetchImpl: options.fetchImpl,
            maxItemsPerQuery: options.sourceQueryMaxItems,
            timeoutMs: options.sourceQueryTimeoutMs,
          })
          : null;
        const collectedRawEvidence = officialRouteExecution?.rawEvidence || sourceQueryExecution?.rawEvidence || null;
        const acquisition = buildSeedBiasEvidenceAcquisition({
          seed: childSeed,
          tasks: childTasks,
          collectedRawEvidence,
          diagnosis,
          targetedBackfillRan: true,
          generatedAt,
        });
        let persistence = null;
        if (options.apply) {
          persistence = await persistAcquisition(client, target.run.run_id, acquisition);
          totalDbWrites += persistence.dbWrites;
        }
        const providerBlockedClassification = classifyChildProviderBlocked({
          seedId: childSeed.seedId,
          childSeedId: childSeed.seedId,
          acceptedEvidenceCount: acquisition.acceptedEvidenceCount,
          issuerBridgeStatus: acquisition.issuerBridgeStatus,
          finalBlocker: acquisition.finalBlocker,
          execution: {
            companyIrCollectorStatus: officialRouteExecution?.companyIrCollectorStatus || null,
          },
        }, childSeed);
        const routeMismatchClassification = classifySeedRouteMismatch({
          seedId: childSeed.seedId,
          childSeedId: childSeed.seedId,
          acceptedEvidenceCount: acquisition.acceptedEvidenceCount,
          issuerBridgeStatus: acquisition.issuerBridgeStatus,
          officialRouteRuns: officialRouteExecution?.routeRuns || [],
        }, childSeed);
        const splitTracks = routeMismatchClassification.routeMismatchDetected
          ? buildInterconnectionRouteSplitTracks(childSeed, { generatedAt })
          : null;
        let issuerBridgeTrackResult = null;
        if (splitTracks?.issuerBridgeTrack?.seed && options.executeOfficialRoute) {
          const trackSeed = splitTracks.issuerBridgeTrack.seed;
          const trackTasks = buildChildBottleneckBackfillTasks(trackSeed, { generatedAt })
            .filter((task) => asArray(options.evidenceClasses || DEFAULT_SEED_BIAS_ACQUISITION_CLASSES).includes(task.evidenceClass));
          const trackOfficialRouteExecution = await executeSeedBiasOfficialRoutes({
            seed: trackSeed,
            tasks: trackTasks,
            issuerCandidates: trackSeed.routeIssuerCandidates || trackSeed.issuerCandidates,
            generatedAt,
            fetchImpl: options.fetchImpl,
            timeoutMs: options.officialRouteTimeoutMs,
            executeCompanyIr: false,
          });
          const trackAcquisition = buildSeedBiasEvidenceAcquisition({
            seed: trackSeed,
            tasks: trackTasks,
            collectedRawEvidence: trackOfficialRouteExecution.rawEvidence,
            diagnosis,
            targetedBackfillRan: true,
            generatedAt,
          });
          issuerBridgeTrackResult = {
            track: 'issuer_bridge_track',
            seedId: trackSeed.seedId,
            bottleneckNode: trackSeed.bottleneckNode,
            rawEvidenceCount: trackAcquisition.rawEvidenceCount,
            acceptedEvidenceCount: trackAcquisition.acceptedEvidenceCount,
            acceptedPromotionEvidenceCount: trackAcquisition.acceptedEvidence.filter((row) => row.promotionEligible === true).length,
            acceptedEvidenceClasses: uniqueStrings(trackAcquisition.acceptedEvidence.flatMap((row) => row.coveredEvidenceClasses || row.evidenceClass), 20),
            independentSourceBreadth: uniqueStrings(trackAcquisition.acceptedEvidence.map((row) => row.source || row.providerRoute || row.evidenceId), 20).length,
            issuerBridgeStatus: trackAcquisition.issuerBridgeStatus,
            negativeControlStatus: trackAcquisition.negativeControlSurvival.items?.[0]?.survivalStatus || 'INCONCLUSIVE',
            holdoutConfirmed: Boolean(trackAcquisition.holdoutValidation.holdoutConfirmed),
            gateResult: trackAcquisition.gateResult,
            visualStatus: trackAcquisition.visualStatus,
            finalBlocker: prioritizedGateBlocker(trackAcquisition.gateResult) || trackAcquisition.finalBlocker,
            officialRouteRuns: trackOfficialRouteExecution.routeRuns || [],
            acquisition: trackAcquisition,
          };
          splitTracks.issuerBridgeTrack = {
            ...splitTracks.issuerBridgeTrack,
            status: trackAcquisition.acceptedEvidenceCount > 0 ? 'issuer_bridge_partial_evidence_collected' : 'issuer_bridge_blocked',
            acceptedEvidenceCount: trackAcquisition.acceptedEvidenceCount,
            acceptedPromotionEvidenceCount: issuerBridgeTrackResult.acceptedPromotionEvidenceCount,
            issuerBridgeStatus: trackAcquisition.issuerBridgeStatus,
            holdoutConfirmed: issuerBridgeTrackResult.holdoutConfirmed,
            negativeControlStatus: issuerBridgeTrackResult.negativeControlStatus,
            gateResult: trackAcquisition.gateResult,
            visualStatus: trackAcquisition.visualStatus,
            finalBlocker: issuerBridgeTrackResult.finalBlocker,
          };
        }
        const routeMismatchBlockType = routeMismatchClassification.routeMismatchDetected
          ? routeMismatchClassification.blockType
          : null;
        childResults.push({
          seedId: childSeed.seedId,
          childSeedId: childSeed.seedId,
          parentSeedId: childSeed.parentSeedId,
          bottleneckNode: childSeed.bottleneckNode,
          bottleneckClass: childSeed.bottleneckClass,
          mechanism: childSeed.mechanism,
          likelyIssuerRoles: childSeed.likelyIssuerRoles,
          issuerCandidates: childSeed.issuerCandidates,
          routeIssuerCandidates: childSeed.routeIssuerCandidates,
          issuerUniverse: childSeed.issuerUniverse,
          issuerRoleCandidates: childSeed.issuerRoleCandidates,
          issuerRoleClasses: childSeed.issuerRoleClasses,
          suppressedRepresentativeTickers: childSeed.suppressedRepresentativeTickers,
          providerGapProposalLinks: childSeed.providerGapProposalLinks || [],
          requiredEvidenceClasses: childSeed.requiredEvidenceClasses,
          negativeControlQueries: childSeed.negativeControlQueries,
          holdoutRoutes: childSeed.holdoutRoutes,
          acceptanceCriteria: childSeed.acceptanceCriteria,
          execution: {
            providerExecution: false,
            officialRouteExecution: Boolean(officialRouteExecution),
            companyIrExecution: Boolean(officialRouteExecution?.companyIrExecution),
            companyIrCollectorStatus: officialRouteExecution?.companyIrCollectorStatus || null,
            sourceQueryExecution: Boolean(sourceQueryExecution),
            officialRouteCount: officialRouteExecution?.queryCount || 0,
            officialRouteResultCount: officialRouteExecution?.resultCount || 0,
            sourceQueryCount: sourceQueryExecution?.queryCount || 0,
            sourceQueryResultCount: sourceQueryExecution?.resultCount || 0,
          },
          officialRouteRuns: officialRouteExecution?.routeRuns || [],
          sourceQueryRuns: sourceQueryExecution?.queryRuns || [],
          rawEvidenceCount: acquisition.rawEvidenceCount,
          acceptedEvidenceCount: acquisition.acceptedEvidenceCount,
          acceptedEvidenceClasses: uniqueStrings(acquisition.acceptedEvidence.flatMap((row) => row.coveredEvidenceClasses || row.evidenceClass), 20),
          independentSourceBreadth: uniqueStrings(acquisition.acceptedEvidence.map((row) => row.source || row.providerRoute || row.evidenceId), 20).length,
          negativeControlStatus: acquisition.negativeControlSurvival.items?.[0]?.survivalStatus || 'INCONCLUSIVE',
          negativeControlScope: acquisition.negativeControlScope || acquisition.negativeControlSurvival.items?.[0]?.negativeControlScope || 'insufficient',
          holdoutConfirmed: Boolean(acquisition.holdoutValidation.holdoutConfirmed),
          issuerBridgeStatus: acquisition.issuerBridgeStatus,
          blockType: routeMismatchBlockType || providerBlockedClassification.blockType,
          providerBlocked: providerBlockedClassification.providerBlocked,
          routeMismatchDetected: routeMismatchClassification.routeMismatchDetected,
          routeMismatchClassification,
          splitTracks,
          trackResults: issuerBridgeTrackResult ? [issuerBridgeTrackResult] : [],
          providerGapRequired: providerBlockedClassification.providerGapRequired,
          providerGapArtifacts: providerBlockedClassification.providerGapArtifacts,
          directCompanyIrPdfAllowlistProposal: providerBlockedClassification.directCompanyIrPdfAllowlistProposal,
          affectedIssuers: providerBlockedClassification.affectedIssuers,
          missingIssuerDocuments: providerBlockedClassification.missingIssuerDocuments,
          issuerCoverageSkew: providerBlockedClassification.issuerCoverageSkew,
          selectedIssuerCoverage: providerBlockedClassification.selectedIssuerCoverage,
          reportCandidateAllowed: providerBlockedClassification.providerBlocked ? false : acquisition.gateResult?.gate === 'report_candidate_allowed',
          excludedFromReportCandidateEvaluation: providerBlockedClassification.excludedFromReportCandidateEvaluation,
          terminalProviderBlocked: providerBlockedClassification.terminalProviderBlocked,
          gateResult: acquisition.gateResult,
          visualStatus: acquisition.visualStatus,
          finalBlocker: routeMismatchClassification.routeMismatchDetected
            ? 'mechanism_issuer_route_mismatch'
            : acquisition.finalBlocker,
          failureClassification: acquisition.failureClassification,
          acquisition,
          persistence,
        });
      }
      const childSummary = summarizeChildBottleneckAcquisitions(target.seed, childResults);
      const providerBlockedChild = childResults.find((item) => item.blockType === 'provider_blocked') || null;
      const routeMismatchChild = childResults.find((item) => item.routeMismatchDetected === true) || null;
      const exposePositivePathCandidates = Boolean(options.positivePathChild || options.includePositivePathCandidates || !options.seedArtifact);
      const positivePathSelection = selectPositivePathCandidateChildSeed(positivePathCandidatePool, {
        excludeChildSeedId: providerBlockedChild?.seedId || selection.childSeed?.seedId,
      });
      const payload = {
        ok: true,
        mode: options.apply ? 'apply' : 'dry-run',
        source: 'seed-bias-child-bottleneck-acquisition',
        runId: target.run.run_id,
        seedId: seedId(target.seed),
        parentSeedId: seedId(target.seed),
        generatedAt,
        selectedEvidenceClasses: options.evidenceClasses,
        selectedChildOnly: Boolean(options.selectedChildOnly),
        selectedChildSeed: selection.childSeed ? {
          childSeedId: selection.childSeed.seedId,
          parentSeedId: selection.childSeed.parentSeedId,
          bottleneckNode: selection.childSeed.bottleneckNode,
          childClass: selection.childSeed.childClass,
          mechanism: selection.childSeed.mechanism,
          issuerCandidates: selection.childSeed.issuerCandidates,
          routeIssuerCandidates: selection.childSeed.routeIssuerCandidates,
          issuerUniverse: selection.childSeed.issuerUniverse,
          issuerRoleCandidates: selection.childSeed.issuerRoleCandidates,
          issuerRoleClasses: selection.childSeed.issuerRoleClasses,
          requiredEvidenceClasses: selection.childSeed.requiredEvidenceClasses,
          negativeControlQueries: selection.childSeed.negativeControlQueries,
          holdoutRoutes: selection.childSeed.holdoutRoutes,
          acceptanceCriteria: selection.childSeed.acceptanceCriteria,
        } : null,
        childSelection: {
          selectedChildOnly: Boolean(options.selectedChildOnly),
          selectionReason: selection.selectionReason,
          priorityRank: selection.priorityRank,
          candidateCount: decomposition.childSeeds.length,
          executedChildCount: childSeedsToRun.length,
          positivePathChild: Boolean(options.positivePathChild),
        },
        issuerRoleClasses: uniqueStrings(childResults.flatMap((item) => item.issuerRoleClasses || []), 40),
        providerGapProposalLinks: uniqueStrings(
          childResults.flatMap((item) => item.providerGapProposalLinks || [])
            .map((item) => JSON.stringify(item)),
          100,
        ).map((item) => JSON.parse(item)),
        blockType: options.selectedChildOnly && childResults.length === 1
          ? childResults[0].blockType
          : routeMismatchChild ? 'mechanism_issuer_route_mismatch' : providerBlockedChild ? 'provider_blocked' : null,
        routeMismatchDetected: Boolean(routeMismatchChild),
        routeMismatchClassification: routeMismatchChild?.routeMismatchClassification || null,
        splitTracks: routeMismatchChild?.splitTracks || null,
        splitTrackResults: childResults.flatMap((item) => item.trackResults || []),
        trackStatus: routeMismatchChild?.splitTracks ? {
          mechanismValidationTrack: routeMismatchChild.splitTracks.mechanismValidationTrack?.status,
          issuerBridgeTrack: routeMismatchChild.splitTracks.issuerBridgeTrack?.status,
        } : null,
        acceptedEvidenceCountByTrack: routeMismatchChild?.splitTracks ? {
          mechanismValidationTrack: Number(routeMismatchChild.splitTracks.mechanismValidationTrack?.acceptedEvidenceCount || 0),
          issuerBridgeTrack: Number(routeMismatchChild.splitTracks.issuerBridgeTrack?.acceptedEvidenceCount || 0),
        } : null,
        finalBlockerByTrack: routeMismatchChild?.splitTracks ? {
          mechanismValidationTrack: routeMismatchChild.splitTracks.mechanismValidationTrack?.finalBlocker,
          issuerBridgeTrack: routeMismatchChild.splitTracks.issuerBridgeTrack?.finalBlocker,
        } : null,
        providerGapRequired: uniqueStrings(childResults.flatMap((item) => item.providerGapRequired || []), 20),
        providerGapArtifacts: uniqueStrings(
          childResults.flatMap((item) => item.providerGapArtifacts || [])
            .map((item) => JSON.stringify(item)),
          100,
        ).map((item) => JSON.parse(item)),
        directCompanyIrPdfAllowlistProposal: providerBlockedChild?.directCompanyIrPdfAllowlistProposal || null,
        affectedIssuers: uniqueStrings(childResults.flatMap((item) => item.affectedIssuers || []), 40),
        issuerCoverageSkew: childResults.some((item) => item.issuerCoverageSkew === true),
        selectedIssuerCoverage: options.selectedChildOnly && childResults.length === 1
          ? childResults[0].selectedIssuerCoverage || []
          : childResults.flatMap((item) => item.selectedIssuerCoverage || []),
        positivePathCandidateSeed: exposePositivePathCandidates && positivePathSelection.childSeed ? {
          childSeedId: positivePathSelection.childSeed.seedId,
          parentSeedId: positivePathSelection.childSeed.parentSeedId,
          bottleneckNode: positivePathSelection.childSeed.bottleneckNode,
          childClass: positivePathSelection.childSeed.childClass,
          mechanism: positivePathSelection.childSeed.mechanism,
          issuerCandidates: positivePathSelection.childSeed.issuerCandidates,
          requiredEvidenceClasses: positivePathSelection.childSeed.requiredEvidenceClasses,
          selectionReason: positivePathSelection.selectionReason,
          selectionCriteria: positivePathSelection.selectionCriteria,
          providerGapProposalLinks: positivePathSelection.childSeed.providerGapProposalLinks || [],
        } : null,
        companyIrCollectorStatus: childResults.find((item) => item.execution?.companyIrCollectorStatus)?.execution?.companyIrCollectorStatus || null,
        positivePathCandidatePool: exposePositivePathCandidates ? positivePathCandidatePool.map((child) => ({
          childSeedId: child.seedId,
          parentSeedId: child.parentSeedId,
          bottleneckNode: child.bottleneckNode,
          childClass: child.childClass,
          issuerCandidates: child.issuerCandidates,
          routeIssuerCandidates: child.routeIssuerCandidates,
          requiredEvidenceClasses: child.requiredEvidenceClasses,
        })) : [],
        parent: {
          seedId: seedId(target.seed),
          bottleneckNode: target.seed.bottleneck?.label || null,
          acceptedEvidenceCount: target.existingAcceptedEvidence.length,
          issuerBridgeStatus: 'missing',
          negativeControlStatus: 'INCONCLUSIVE',
          holdoutConfirmed: false,
          status: childSummary.parentStatus,
          reportCandidateBlocked: true,
        },
        childDecomposition: decomposition,
        childResults,
        childSummary,
        rawEvidenceCount: childSummary.rawEvidenceTotal,
        acceptedEvidenceCount: childSummary.acceptedEvidenceTotal,
        negativeControlStatus: options.selectedChildOnly && childResults.length === 1
          ? childResults[0].negativeControlStatus
          : childResults.some((item) => ['SURVIVED', 'CHECKED_NO_DIRECT', 'CHECKED_NO_DIRECT_SUFFICIENT_SCOPE'].includes(item.negativeControlStatus))
            ? 'PARTIAL_CLOSED'
            : 'INCONCLUSIVE',
        negativeControlScope: options.selectedChildOnly && childResults.length === 1
          ? childResults[0].negativeControlScope
          : childResults.some((item) => item.negativeControlScope === 'sufficient')
            ? 'partial_sufficient'
            : 'limited_or_insufficient',
        holdoutConfirmed: options.selectedChildOnly && childResults.length === 1
          ? Boolean(childResults[0].holdoutConfirmed)
          : childResults.some((item) => item.holdoutConfirmed),
        issuerBridgeStatus: options.selectedChildOnly && childResults.length === 1
          ? childResults[0].issuerBridgeStatus
          : childResults.some((item) => item.issuerBridgeStatus === 'attached') ? 'child_attached' : 'missing',
        gateResult: {
          gate: childSummary.reportCandidateChildSeeds.length ? 'child_report_candidate_available' : 'blocked',
          allowedChildSeedIds: childSummary.reportCandidateChildSeeds,
          blockedChildSeedIds: childResults
            .filter((item) => item.gateResult?.gate !== 'report_candidate_allowed')
            .map((item) => item.seedId),
        },
        visualStatus: childSummary.reportCandidateChildSeeds.length ? 'review-ready' : 'pending',
        finalBlocker: childSummary.reportCandidateChildSeeds.length
          ? null
          : routeMismatchChild ? 'mechanism_issuer_route_mismatch'
          : providerBlockedChild ? 'provider_blocked'
          : 'child_bottleneck_evidence_not_closed',
        artifactPaths: {},
        boundaries: {
          dbWrites: totalDbWrites,
          approvalQueueWrites: 0,
          sourceQueryApprovalWrites: 0,
          sourceQueryExecutionWrites: childResults.reduce((sum, item) => sum + Number(item.execution.sourceQueryResultCount || 0), 0),
          officialRouteWrites: childResults.reduce((sum, item) => sum + Number(item.acquisition?.newRawEvidence?.length || 0), 0),
          reportBackfillWrites: 0,
          researchEvidenceBundleWrites: 0,
          canonicalWrites: 0,
          sourceRegistryWrites: 0,
          providerActivationWrites: 0,
        },
      };
      if (options.writeArtifacts !== false) {
        const root = options.artifactRoot || DEFAULT_ARTIFACT_ROOT;
        payload.artifactPaths.rawEvidence = await writeJson(path.join(root, 'seed-bias-child-bottleneck-raw.latest.json'), {
          ok: true,
          runId: payload.runId,
          parentSeedId: payload.parentSeedId,
          rawEvidence: childResults.flatMap((item) => item.acquisition?.rawEvidence || []),
        });
        payload.artifactPaths.acceptedEvidence = await writeJson(path.join(root, 'seed-bias-child-bottleneck-accepted.latest.json'), {
          ok: true,
          runId: payload.runId,
          parentSeedId: payload.parentSeedId,
          acceptedEvidence: childResults.flatMap((item) => item.acquisition?.acceptedEvidence || []),
        });
        payload.artifactPaths.selfImprovement = await writeJson(path.join(root, 'seed-bias-child-bottleneck-self-improvement.latest.json'), {
          ok: true,
          runId: payload.runId,
          parentSeedId: payload.parentSeedId,
          parentStatus: childSummary.parentStatus,
          childSummary,
          blockType: payload.blockType,
          routeMismatchDetected: payload.routeMismatchDetected,
          routeMismatchClassification: payload.routeMismatchClassification,
          splitTracks: payload.splitTracks,
          splitTrackResults: payload.splitTrackResults,
          trackStatus: payload.trackStatus,
          acceptedEvidenceCountByTrack: payload.acceptedEvidenceCountByTrack,
          finalBlockerByTrack: payload.finalBlockerByTrack,
          providerGapRequired: payload.providerGapRequired,
          providerGapArtifacts: payload.providerGapArtifacts,
          directCompanyIrPdfAllowlistProposal: payload.directCompanyIrPdfAllowlistProposal,
          affectedIssuers: payload.affectedIssuers,
          positivePathCandidateSeed: payload.positivePathCandidateSeed,
          failureClassification: childResults.map((item) => ({
            childSeedId: item.seedId,
            bottleneckNode: item.bottleneckNode,
            failureClassification: item.failureClassification,
            finalBlocker: item.finalBlocker,
          })),
        });
        payload.artifactPaths.childAcquisition = await writeJson(path.join(root, 'seed-bias-child-bottleneck-acquisition.latest.json'), payload);
        payload.artifactPaths.acquisition = await writeJson(path.join(root, 'seed-bias-evidence-acquisition.latest.json'), payload);
      }
      return payload;
    }
    const sourceQueryExecution = options.executeSourceQuery
      ? await executeSeedBiasSourceQueries({
        seed: target.seed,
        tasks: selectedTasks,
        generatedAt,
        fetchImpl: options.fetchImpl,
        maxItemsPerQuery: options.sourceQueryMaxItems,
        timeoutMs: options.sourceQueryTimeoutMs,
      })
      : null;
    const officialRouteExecution = options.executeOfficialRoute
      ? await executeSeedBiasOfficialRoutes({
        seed: target.seed,
        tasks: selectedTasks,
        issuerCandidates: options.issuerCandidates,
        generatedAt,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.officialRouteTimeoutMs,
        executeCompanyIr: options.executeCompanyIr,
        companyIrAllowlist: options.companyIrAllowlist,
      })
      : null;
    const collectedRawEvidence = officialRouteExecution?.rawEvidence || sourceQueryExecution?.rawEvidence || null;
    const acquisition = buildSeedBiasEvidenceAcquisition({
      seed: target.seed,
      tasks: selectedTasks,
      existingRawEvidence: target.existingRawEvidence,
      existingAcceptedEvidence: target.existingAcceptedEvidence,
      collectedRawEvidence,
      diagnosis,
      targetedBackfillRan: true,
      generatedAt,
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
        officialRouteExecution: Boolean(officialRouteExecution),
        companyIrExecution: Boolean(officialRouteExecution?.companyIrExecution),
        sourceQueryTaskReady: !sourceQueryExecution,
        queryCount: sourceQueryExecution?.queryCount || 0,
        resultCount: sourceQueryExecution?.resultCount || 0,
        officialRouteCount: officialRouteExecution?.queryCount || 0,
        officialRouteResultCount: officialRouteExecution?.resultCount || 0,
      },
      sourceQueryRuns: sourceQueryExecution?.queryRuns || [],
      officialRouteRuns: officialRouteExecution?.routeRuns || [],
      companyIrCollectorStatus: officialRouteExecution?.companyIrCollectorStatus || null,
      rawEvidenceCount: acquisition.rawEvidenceCount,
      acceptedEvidenceCount: acquisition.acceptedEvidenceCount,
      newRawEvidenceCount: acquisition.newRawEvidence.length,
      newAcceptedEvidenceCount: acquisition.newAcceptedEvidence.length,
      negativeControlStatus: acquisition.negativeControlSurvival.items?.[0]?.survivalStatus || 'INCONCLUSIVE',
      negativeControlScope: acquisition.negativeControlScope || acquisition.negativeControlSurvival.items?.[0]?.negativeControlScope || 'insufficient',
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
        officialRouteWrites: officialRouteExecution ? acquisition.newRawEvidence.length : 0,
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
      payload.artifactPaths.selfImprovement = await writeJson(path.join(root, 'seed-bias-self-improvement.latest.json'), {
        ok: true,
        runId: payload.runId,
        seedId: payload.seedId,
        generatedAt: payload.generatedAt,
        source: 'seed-bias-evidence-acquisition',
        selfImprovement: acquisition.selfImprovement,
        failureClassification: acquisition.failureClassification,
        finalBlocker: payload.finalBlocker,
      });
      payload.artifactPaths.acquisition = await writeJson(path.join(root, 'seed-bias-evidence-acquisition.latest.json'), payload);
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
    selectedChildOnly: result.selectedChildOnly,
    selectedChildSeed: result.selectedChildSeed,
    childSelection: result.childSelection,
    execution: result.execution,
    companyIrCollectorStatus: result.companyIrCollectorStatus,
    blockType: result.blockType,
    providerGapRequired: result.providerGapRequired,
    affectedIssuers: result.affectedIssuers,
    issuerCoverageSkew: result.issuerCoverageSkew,
    positivePathCandidateSeed: result.positivePathCandidateSeed,
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
