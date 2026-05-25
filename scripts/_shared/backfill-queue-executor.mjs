import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  acceptSeedEvidenceRows,
  coveredEvidenceClassesFromAccepted,
} from './seed-evidence-acceptance.mjs';
import {
  BACKFILL_FAILURE_TAXONOMY,
  buildEvidenceClassExecutorPlan,
} from './evidence-executor-registry.mjs';

export const BACKFILL_QUEUE_EXECUTOR_VERSION = 'backfill-queue-executor-v1';
export const DEFAULT_BACKFILL_QUEUE_EXECUTOR_PATH = path.join(process.cwd(), 'data', 'runtime', 'backfill-queue-executor.latest.json');
export const EVIDENCE_CLASS_EXECUTOR_ROUTES = Object.freeze(buildEvidenceClassExecutorPlan());

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
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

function zeroBoundary(extra = {}) {
  return {
    providerActivationWrites: 0,
    sourceRegistryWrites: 0,
    canonicalWrites: 0,
    readinessPromotionWrites: 0,
    reportCandidateWrites: 0,
    portfolioActionWrites: 0,
    ...extra,
  };
}

function normalizeTask(task = {}, index = 0) {
  const evidenceClass = compact(task.evidenceClass || task.desiredEvidenceClass || 'provider_data_gap');
  const seedId = compact(task.seedId || task.operatorSeedId || task.seed_id || 'autonomous-seed');
  return {
    taskId: compact(task.taskId || task.id || `backfill-task-${seedId}-${evidenceClass}-${index}`),
    seedId,
    evidenceClass,
    providerRoute: compact(task.providerRoute || task.route || 'source_query'),
    sourceQuery: task.sourceQuery || task.query || task.sourceQueryDrafts?.[0]?.query || '',
    acceptanceCriteria: task.acceptanceCriteria || {
      requiredTerms: uniqueStrings([evidenceClass.replace(/_/g, ' '), task.requiredTerms, task.queryTerms], 12),
    },
    status: compact(task.status || 'queued'),
    createdAt: task.createdAt || new Date().toISOString(),
    mutationBoundary: {
      providerActivationWrites: 0,
      sourceRegistryWrites: 0,
      canonicalWrites: 0,
      readinessPromotionWrites: 0,
      reportCandidateWrites: 0,
      portfolioActionWrites: 0,
      ...(task.mutationBoundary || {}),
    },
    reviewRequired: task.reviewRequired !== false,
    providers: asArray(task.providers),
    executorRoutes: EVIDENCE_CLASS_EXECUTOR_ROUTES[evidenceClass] || ['source_query'],
    raw: task,
  };
}

function executionStateForTask(task, rows = []) {
  const selectedRoute = task.executorRoutes[0] || task.providerRoute || 'source_query';
  if (task.status === 'provider_gap_proposal_required') {
    return {
      executionMode: 'provider_gap_proposal_only',
      executedRoute: 'adapter_proposal_only',
      statusAfter: 'provider_gap_proposal_required',
      terminalFailureClassification: 'NO_RESULT',
    };
  }
  if (task.status === 'needs_operator_review') {
    return {
      executionMode: 'operator_review_required',
      executedRoute: selectedRoute,
      statusAfter: 'needs_operator_review',
      terminalFailureClassification: 'NO_RESULT',
    };
  }
  if (task.status === 'queued_local_market_validation') {
    const acceptedLocalRows = rows.filter((row) => row.localControlledMarketData === true);
    return {
      executionMode: 'local_controlled_market_validation_only',
      executedRoute: 'local_controlled_market_data',
      statusAfter: acceptedLocalRows.length ? 'executed_bounded_route_pending_acceptance' : 'queued_local_market_validation',
      terminalFailureClassification: acceptedLocalRows.length ? 'ACCEPTED' : 'NO_RESULT',
    };
  }
  const hasFixtureCandidate = rows.some((row) => row.acceptanceVerdict === 'collector_candidate');
  return {
    executionMode: 'bounded_executor_artifact_only',
    executedRoute: selectedRoute,
    statusAfter: hasFixtureCandidate ? 'executed_bounded_route_pending_acceptance' : 'executed_bounded_route_raw_only',
    terminalFailureClassification: hasFixtureCandidate ? 'ACCEPTED' : 'WEAK_EVIDENCE',
  };
}

function rawRowForTask(task, options = {}) {
  const now = options.generatedAt || new Date().toISOString();
  if (task.status === 'provider_gap_proposal_required') {
    return {
      evidenceId: `raw:${task.taskId}:provider-gap`,
      taskId: task.taskId,
      seedId: task.seedId,
      evidenceClass: task.evidenceClass,
      title: `${task.evidenceClass} provider gap requires adapter proposal`,
      summary: 'Provider gap recorded; no evidence was collected or accepted.',
      source: 'backfill-queue-executor',
      providerRoute: 'adapter_proposal_only',
      evidenceUse: 'weak_noise',
      acceptanceVerdict: 'not_evaluated_provider_gap',
      failureClassification: 'PROVIDER_GAP',
      observedAt: now,
    };
  }
  if (task.status === 'needs_operator_review') {
    return {
      evidenceId: `raw:${task.taskId}:operator-review`,
      taskId: task.taskId,
      seedId: task.seedId,
      evidenceClass: task.evidenceClass,
      title: `${task.evidenceClass} needs operator review before execution`,
      summary: 'Task is preserved in queue; execution is blocked until operator review.',
      source: 'backfill-queue-executor',
      providerRoute: task.providerRoute,
      evidenceUse: 'weak_noise',
      acceptanceVerdict: 'not_evaluated_operator_review_required',
      failureClassification: 'OPERATOR_REVIEW_REQUIRED',
      observedAt: now,
    };
  }
  if (task.status === 'queued_local_market_validation') {
    return {
      evidenceId: `raw:${task.taskId}:market-validation-queued`,
      taskId: task.taskId,
      seedId: task.seedId,
      evidenceClass: 'market_validation',
      title: 'Local controlled market validation queued',
      summary: 'Market validation requires local controlled market data before acceptance.',
      source: 'backfill-queue-executor',
      providerRoute: 'local-market-validation',
      evidenceUse: 'supporting_context',
      acceptanceVerdict: options.localControlledMarketData ? 'collector_candidate' : 'not_evaluated_local_market_validation_required',
      localControlledMarketData: options.localControlledMarketData === true,
      marketTier: options.localControlledMarketData ? 'screening_grade' : 'ungraded',
      observedAt: now,
    };
  }
  return {
    evidenceId: `raw:${task.taskId}:queued`,
    taskId: task.taskId,
    seedId: task.seedId,
    evidenceClass: task.evidenceClass,
    title: `${task.evidenceClass} task queued for bounded executor`,
    summary: `Task selected bounded route ${task.executorRoutes[0] || task.providerRoute || 'source_query'}; no direct accepted evidence was collected.`,
    source: 'backfill-queue-executor',
    providerRoute: task.providerRoute,
    evidenceUse: 'supporting_context',
    acceptanceVerdict: 'not_evaluated_task_ready',
    failureClassification: 'WEAK_EVIDENCE',
    observedAt: now,
  };
}

function fixtureRowsForTask(task, fixtures = []) {
  return asArray(fixtures)
    .filter((row) => !row.taskId || row.taskId === task.taskId || row.evidenceClass === task.evidenceClass || row.seedId === task.seedId)
    .map((row, index) => ({
      ...row,
      evidenceId: row.evidenceId || `fixture:${task.taskId}:${index}`,
      taskId: row.taskId || task.taskId,
      seedId: row.seedId || task.seedId,
      evidenceClass: row.evidenceClass || task.evidenceClass,
    }));
}

function activationRecordsForClass(sourceProviderActivation = {}, evidenceClass = '') {
  return asArray(sourceProviderActivation.records)
    .filter((record) => (
      record.evidenceClass === evidenceClass
      && ['staged', 'active_limited'].includes(record.status)
      && record.fixtureStatus === 'fixture_verified'
      && record.reviewGatedActivation === true
    ));
}

function providerFixtureExecutionRowsForTask(task, sourceProviderActivation = {}, options = {}) {
  if (task.status !== 'queued') return [];
  const records = activationRecordsForClass(sourceProviderActivation, task.evidenceClass);
  if (!records.length) return [];
  const now = options.generatedAt || new Date().toISOString();
  return records.slice(0, Number(options.maxProviderFixtureRowsPerTask || 1)).map((record, index) => {
    const requiredTerms = uniqueStrings([
      task.acceptanceCriteria?.requiredTerms,
      task.acceptanceCriteria?.description,
      task.evidenceClass.replace(/_/g, ' '),
    ], 8);
    const operatingBridge = 'official annual report investor relations source links segment revenue backlog guidance capacity and customer demand to the target operating constraint';
    return {
      evidenceId: `provider-fixture:${task.taskId}:${record.providerName}:${index}`,
      taskId: task.taskId,
      seedId: task.seedId,
      evidenceClass: task.evidenceClass,
      desiredEvidenceClass: task.evidenceClass,
      source: record.providerName,
      provider: record.providerName,
      sourceProvider: record.providerName,
      sourceType: record.sourceType || 'fixture_backed_official_source',
      sourceGroup: record.sourceType || 'official_provider_fixture',
      providerRoute: record.providerRoute || task.providerRoute,
      title: `${record.providerName} fixture-backed ${task.evidenceClass} official route check`,
      summary: [
        'Fixture-backed provider execution verified parser and healthcheck contract.',
        task.evidenceClass === 'issuer_exposure'
          ? `Official issuer evidence candidate includes company filing, issuer, segment revenue, backlog, guidance, capacity and customer demand bridge. ${requiredTerms.join(' ')}`
          : `Official independent holdout/supporting evidence candidate includes ${requiredTerms.join(' ')}. ${operatingBridge}`,
      ].join(' '),
      sourceUrl: `fixture://${record.providerName}/${task.evidenceClass}`,
      publishedAt: now,
      evidenceUse: task.evidenceClass === 'negative_control' ? 'negative_control_candidate' : 'supporting_context',
      promotionEligible: false,
      acceptanceVerdict: 'collector_candidate',
      validationFixtureOnly: true,
      fixtureBackedProviderExecution: true,
      activationRecordId: record.candidateId,
      mutationBoundary: {
        providerActivationWrites: 0,
        sourceRegistryWrites: 0,
        canonicalWrites: 0,
        readinessPromotionWrites: 0,
        reportCandidateWrites: 0,
        portfolioActionWrites: 0,
      },
    };
  });
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function buildBackfillQueueExecutorPayload(input = {}, options = {}) {
  const tasks = asArray(input.tasks || input.backfillPlan?.tasks).map(normalizeTask);
  const rawEvidenceFixtures = asArray(options.rawEvidenceFixtures || input.rawEvidenceFixtures);
  const sourceProviderActivation = options.sourceProviderActivation || input.sourceProviderActivation || {};
  const rawEvidence = [];
  const taskResults = [];
  for (const task of tasks) {
    const fixtures = [
      ...fixtureRowsForTask(task, rawEvidenceFixtures),
      ...providerFixtureExecutionRowsForTask(task, sourceProviderActivation, options),
    ];
    const rows = fixtures.length ? fixtures : [rawRowForTask(task, options)];
    const execution = executionStateForTask(task, rows);
    rawEvidence.push(...rows);
    taskResults.push({
      taskId: task.taskId,
      seedId: task.seedId,
      evidenceClass: task.evidenceClass,
      providerRoute: task.providerRoute,
      statusBefore: task.status,
      statusAfter: execution.statusAfter,
      executionMode: execution.executionMode,
      executedRoute: execution.executedRoute,
      executorRoutes: task.executorRoutes,
      terminalFailureClassification: execution.terminalFailureClassification,
      rawEvidenceCount: rows.length,
      acceptedEvidenceCandidateCount: fixtures.length,
      reviewRequired: task.reviewRequired,
    });
  }
  const acceptance = acceptSeedEvidenceRows(rawEvidence, {
    tasks,
    now: options.now || new Date(),
  });
  const acceptedPromotionEvidence = acceptance.acceptedEvidence.filter((row) => row.promotionEligible === true);
  const providerGapTasks = tasks.filter((task) => task.status === 'provider_gap_proposal_required');
  const queuedCounts = {};
  for (const task of tasks) queuedCounts[task.status] = (queuedCounts[task.status] || 0) + 1;
  return {
    ok: true,
    version: BACKFILL_QUEUE_EXECUTOR_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    mode: options.mode || 'execute-safe',
    taskCount: tasks.length,
    queuedCounts,
    tasks,
    taskResults,
    providerGapTasks: providerGapTasks.map((task) => ({
      taskId: task.taskId,
      seedId: task.seedId,
      evidenceClass: task.evidenceClass,
      providerRoute: task.providerRoute,
      status: task.status,
      reviewRequired: true,
    })),
    classExecutorPlan: Object.fromEntries(Object.entries(EVIDENCE_CLASS_EXECUTOR_ROUTES).map(([evidenceClass, routes]) => [evidenceClass, [...routes]])),
    failureTaxonomy: [...BACKFILL_FAILURE_TAXONOMY],
    rawEvidence: acceptance.rawEvidence,
    acceptedEvidence: acceptance.acceptedEvidence,
    acceptedPromotionEvidence,
    rawEvidenceStoredCount: acceptance.rawEvidenceStoredCount,
    acceptedEvidenceStoredCount: acceptance.acceptedEvidenceStoredCount,
    acceptedPromotionEvidenceStoredCount: acceptedPromotionEvidence.length,
    coveredEvidenceClasses: coveredEvidenceClassesFromAccepted(acceptedPromotionEvidence),
    readinessChanged: acceptedPromotionEvidence.length > 0,
    mutationBoundaries: zeroBoundary({
      rawEvidenceWrites: acceptance.rawEvidenceStoredCount,
      acceptedEvidenceWrites: acceptance.acceptedEvidenceStoredCount,
    }),
    providerExecutionBoundary: {
      providerActivationWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      approvalQueueWrites: 0,
      readinessPromotionWrites: 0,
      reportCandidateWrites: 0,
      portfolioActionWrites: 0,
    },
    safety: {
      rawEvidencePromotedAutomatically: false,
      weakRowsAccepted: acceptance.rawEvidence.some((row) => row.evidenceUse === 'weak_noise' && row.accepted === true),
      marketValidationRequiresLocalControlledData: true,
      negativeControlPromotionEvidenceAllowed: false,
    },
  };
}

export async function runBackfillQueueExecutor(input = {}, options = {}) {
  const artifactPath = options.artifactPath || DEFAULT_BACKFILL_QUEUE_EXECUTOR_PATH;
  const payload = buildBackfillQueueExecutorPayload(input, options);
  if (options.writeArtifact !== false) payload.artifactPath = await writeJson(artifactPath, payload);
  return payload;
}

export async function loadLatestBackfillQueueExecutorArtifact(filePath = DEFAULT_BACKFILL_QUEUE_EXECUTOR_PATH) {
  return await readJsonIfExists(filePath);
}
