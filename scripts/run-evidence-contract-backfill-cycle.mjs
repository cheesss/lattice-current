#!/usr/bin/env node

import pg from 'pg';
import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { enqueueReportSourceQueryDrafts } from './_shared/report-deep-research-pack.mjs';
import { evidenceClassProfile } from './_shared/universal-evidence-contract.mjs';
import {
  providerListForRoutes,
  routeEvidenceBackfillTasks,
} from './_shared/evidence-provider-router.mjs';
import {
  buildReportBackfillClosureLedger,
  findLatestReportArtifactDirs,
  loadReportBackfillClosureSummaries,
} from './_shared/report-backfill-closure.mjs';
import {
  buildReportMarketValidation,
  runReportMarketValidation,
} from './_shared/report-market-validation.mjs';
import {
  issuerUniverseForEvidenceClass,
  resolveReportIssuerUniverse,
} from './_shared/report-issuer-universe.mjs';
import { buildGenericEvidenceUnblockPlan } from './_shared/report-unblock-controller.mjs';
import {
  evaluateParentCandidateReadiness,
  parentBackfillQueriesForReadiness,
  parentEvidenceSummaryFromReportArtifact,
} from './_shared/parent-candidate-readiness.mjs';

const { Client } = pg;
const DEFAULT_REPORT_ROOT = path.join('data', 'reports');
const RUNTIME_DIR = path.join(process.cwd(), 'data', 'runtime');
const DEFAULT_STATE_PATH = path.join(RUNTIME_DIR, 'evidence-contract-backfill-cycle-state.json');
const STATE_SHARD_DIR = path.join(RUNTIME_DIR, 'evidence-contract-backfill-cycle-state-shards');
const STEP_LOG_PATH = path.join(RUNTIME_DIR, 'evidence-contract-backfill-cycle.steps.jsonl');
const RESULT_ARTIFACT_DIR = path.join(RUNTIME_DIR, 'evidence-contract-backfill-cycle-results');

const DRAIN_STEP_DEFAULT_TIMEOUT_MS = 5 * 60_000;
const PROVIDER_STEP_DEFAULT_TIMEOUT_MS = 10 * 60_000;
const SOURCE_QUERY_STEP_DEFAULT_TIMEOUT_MS = 15 * 60_000;
const REGENERATE_STEP_DEFAULT_TIMEOUT_MS = 10 * 60_000;
const MAX_BUFFER = Math.max(1_000_000, Number(process.env.EVIDENCE_BACKFILL_MAX_BUFFER_BYTES || 12_000_000));
const STDOUT_TAIL_BYTES = Math.max(256, Number(process.env.EVIDENCE_BACKFILL_STDOUT_TAIL_BYTES || 2_048));

function optionalTimeoutMs(value, fallback = 0, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['0', 'off', 'none', 'false', 'disabled', 'no'].includes(normalized)) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function timeoutLabel(timeoutMs) {
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 'disabled';
}

function stableRunId(prefix = 'evidence-contract-backfill-cycle') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const entropy = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${entropy}`;
}

function compactText(value, maxBytes = STDOUT_TAIL_BYTES) {
  const text = String(value || '');
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const tail = Buffer.from(text, 'utf8').subarray(-maxBytes).toString('utf8');
  return `[truncated ${Buffer.byteLength(text, 'utf8') - Buffer.byteLength(tail, 'utf8')} bytes]\n${tail}`;
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function compactJsonSummary(value) {
  if (!value || typeof value !== 'object') return null;
  const summary = {};
  for (const key of [
    'ok',
    'dryRun',
    'apply',
    'mode',
    'status',
    'reason',
    'reportId',
    'reportDir',
    'statePath',
    'artifactPath',
    'htmlPath',
    'path',
    'generated',
    'inserted',
    'updated',
    'unchanged',
    'queued',
    'executed',
    'accepted',
    'skipped',
    'failed',
    'routeCount',
    'providerCount',
    'taskCount',
    'bundleCount',
    'approvalCount',
    'sourceQueryCount',
    'unblockStatus',
    'evidenceState',
    'visualStatus',
    'marketTier',
  ]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) summary[key] = value[key];
  }
  for (const [sourceKey, targetKey] of [
    ['steps', 'stepCount'],
    ['results', 'resultCount'],
    ['tasks', 'taskCount'],
    ['routes', 'routeCount'],
    ['routePlans', 'routePlanCount'],
    ['openClasses', 'openClassCount'],
    ['criticalOpenClasses', 'criticalOpenClassCount'],
    ['blockers', 'blockerCount'],
    ['warnings', 'warningCount'],
    ['bundles', 'bundleCount'],
    ['items', 'itemCount'],
    ['rows', 'rowCount'],
    ['articles', 'articleCount'],
    ['awards', 'awardCount'],
    ['queryVariants', 'queryVariantCount'],
  ]) {
    if (Array.isArray(value[sourceKey])) summary[targetKey] = value[sourceKey].length;
  }
  if (value.unblockDelta && typeof value.unblockDelta === 'object') {
    summary.unblockDelta = {
      statusChanged: Boolean(value.unblockDelta.statusChanged),
      beforeStatus: value.unblockDelta.beforeStatus || null,
      afterStatus: value.unblockDelta.afterStatus || null,
      changedClassCount: countArray(value.unblockDelta.changedClasses),
    };
  }
  return Object.keys(summary).length ? summary : null;
}

export function compactStepResult(step = {}) {
  const jsonSummary = compactJsonSummary(step.json);
  return {
    name: step.name || 'unnamed-step',
    ok: step.ok !== false,
    skipped: Boolean(step.skipped),
    durationMs: step.durationMs ?? null,
    timeoutMs: step.timeoutMs ?? null,
    error: step.error ? compactText(step.error, 1_000) : null,
    stdoutTail: step.stdoutTail ? compactText(step.stdoutTail, STDOUT_TAIL_BYTES) : null,
    jsonSummary,
  };
}

function compactDashboardSummary(summary) {
  if (!summary) return null;
  const reports = Array.isArray(summary.reports) ? summary.reports : Array.isArray(summary) ? summary : [];
  return {
    ok: summary.ok !== false,
    reportCount: reports.length || Number(summary.reportCount || 0),
    statusCounts: summary.statusCounts || reports.reduce((acc, row) => {
      const key = row?.visualStatus || row?.evidenceState || row?.status || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    blockerCount: reports.reduce((sum, row) => sum + countArray(row?.openClasses || row?.criticalOpenClasses), 0),
    reportIds: reports.map((row) => row?.reportId).filter(Boolean).slice(0, 20),
  };
}

export function compactEvidenceBackfillCycleResult(result = {}) {
  const steps = Array.isArray(result.steps) ? result.steps.map(compactStepResult) : [];
  const childResults = Array.isArray(result.results)
    ? result.results.map((child) => compactEvidenceBackfillCycleResult(child))
    : [];
  const reportIds = [
    result.reportId,
    ...childResults.map((child) => child.reportId),
  ].filter(Boolean);
  const reportDirs = [
    result.reportDir,
    ...(Array.isArray(result.reportDirs) ? result.reportDirs : []),
    ...childResults.map((child) => child.reportDir),
  ].filter(Boolean);
  const stepCounts = [...steps, ...childResults.flatMap((child) => child.steps || [])].reduce((acc, step) => {
    const key = step.ok === false ? 'failed' : step.skipped ? 'skipped' : 'ok';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    ok: result.ok !== false,
    allReports: Boolean(result.allReports),
    apply: Boolean(result.apply),
    dryRun: result.dryRun !== false,
    reportId: result.reportId || null,
    reportDir: result.reportDir || null,
    reportCount: Number(result.reportCount || (reportDirs.length ? reportDirs.length : reportIds.length || 0)),
    reportIds: Array.from(new Set(reportIds)).slice(0, 50),
    reportDirs: Array.from(new Set(reportDirs)).slice(0, 50),
    routeCount: Number(result.routeCount || 0),
    providerCount: Number(result.providerCount || countArray(result.providers)),
    providers: Array.isArray(result.providers) ? result.providers.slice(0, 20) : undefined,
    steps,
    childResults,
    stepCounts,
    dashboardSummary: compactDashboardSummary(result.dashboardSummary),
    closureSummary: compactJsonSummary(result.closureSummary),
    marketValidation: compactJsonSummary(result.marketValidation),
    unblockDeltaSummary: compactJsonSummary({ unblockDelta: result.unblockDelta })?.unblockDelta || null,
    errorSummary: result.error ? compactText(result.error, 1_000) : null,
  };
}

export async function writeEvidenceBackfillCycleResultArtifact(result = {}, options = {}) {
  const artifactPath = options.artifactOut
    ? path.resolve(options.artifactOut)
    : path.join(RESULT_ARTIFACT_DIR, `${stableRunId()}.json`);
  try {
    await writeJson(artifactPath, result);
  } catch (error) {
    await writeJson(artifactPath, {
      ok: false,
      errorKind: /Invalid string length/i.test(String(error?.message || error)) ? 'serialization_failed' : 'artifact_write_failed',
      error: String(error?.message || error),
      compactResult: compactEvidenceBackfillCycleResult(result),
    });
  }
  return artifactPath;
}

function writeStepLog(entry) {
  try {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    appendFileSync(STEP_LOG_PATH, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, 'utf8');
  } catch {
    // Logging must never fail the backfill cycle.
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

function stateShardPathForReport(reportId, reportDir) {
  const basis = reportDir ? path.basename(reportDir) : '';
  const slug = slugify(basis) || slugify(reportId) || 'report';
  return path.join(STATE_SHARD_DIR, `${slug}.json`);
}

function resolveStatePathForCycle(options = {}, cyclePlan = {}) {
  if (options.userStatePathProvided && options.statePath) return options.statePath;
  if (cyclePlan?.reportId || cyclePlan?.reportDir) {
    return stateShardPathForReport(cyclePlan.reportId, cyclePlan.reportDir);
  }
  return options.statePath || DEFAULT_STATE_PATH;
}

function unique(values = [], normalizer = (value) => compact(value)) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const item = normalizer(value);
    if (!item) continue;
    const key = String(item).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  const finite = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, Math.floor(finite)));
}

async function runLimited(items = [], concurrency = 1, worker = async (item) => item) {
  const list = asArray(items);
  const limit = Math.max(1, Math.min(list.length || 1, Math.floor(Number(concurrency || 1))));
  const results = new Array(list.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < list.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

function readArg(argv, name) {
  const eq = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  const next = argv[idx + 1];
  return next && !next.startsWith('--') ? next : true;
}

export function parseEvidenceBackfillCycleArgs(argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply');
  return {
    apply,
    dryRun: !apply || argv.includes('--dry-run'),
    reportDir: readArg(argv, 'report-dir') || null,
    latest: argv.includes('--latest'),
    allReports: argv.includes('--all-reports'),
    subject: readArg(argv, 'subject') || null,
    type: readArg(argv, 'type') || readArg(argv, 'report-type') || null,
    reportRoot: readArg(argv, 'report-root') || DEFAULT_REPORT_ROOT,
    autoApproveSourceQueries: argv.includes('--auto-approve-source-queries'),
    autoReportSourceQuery: argv.includes('--auto-report-source-query'),
    marketValidation: argv.includes('--market-validation'),
    dashboardSummary: argv.includes('--dashboard-summary'),
    regenerate: argv.includes('--regenerate'),
    passes: boundedInt(readArg(argv, 'passes'), 1, 1, 8),
    limit: boundedInt(readArg(argv, 'limit'), 25, 1, 250),
    reportLimit: boundedInt(readArg(argv, 'report-limit'), 5, 1, 50),
    reportConcurrency: boundedInt(readArg(argv, 'report-concurrency') ?? process.env.EVIDENCE_BACKFILL_REPORT_CONCURRENCY, 3, 1, 12),
    stepConcurrency: boundedInt(readArg(argv, 'step-concurrency') ?? process.env.EVIDENCE_BACKFILL_STEP_CONCURRENCY, 2, 1, 6),
    providerConcurrency: boundedInt(readArg(argv, 'provider-concurrency') ?? process.env.EVIDENCE_BACKFILL_PROVIDER_CONCURRENCY, 4, 1, 12),
    sourceQueryConcurrency: boundedInt(readArg(argv, 'source-query-concurrency') ?? process.env.EVIDENCE_BACKFILL_SOURCE_QUERY_CONCURRENCY, 4, 1, 12),
    providers: String(readArg(argv, 'providers') || 'fred,eia,public-planning-source,sec,fmp,polygon,dod-contracts,usaspending')
      .split(',')
      .map((provider) => provider.trim())
      .filter(Boolean),
    throttleHours: boundedInt(readArg(argv, 'throttle-hours'), 6, 0, 24 * 30),
    statePath: readArg(argv, 'state-path') || null,
    artifactOut: readArg(argv, 'artifact-out') || null,
    userStatePathProvided: Boolean(readArg(argv, 'state-path')),
    maxAttempts: boundedInt(readArg(argv, 'max-attempts'), 3, 1, 10),
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readJsonIfExists(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  return readJson(filePath);
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function findFirstKey(value, key, depth = 0) {
  if (!value || depth > 8 || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  for (const child of Object.values(value)) {
    const found = findFirstKey(child, key, depth + 1);
    if (found) return found;
  }
  return null;
}

export async function findLatestReportDir(reportRoot = DEFAULT_REPORT_ROOT) {
  const dirs = await findLatestReportArtifactDirs(path.resolve(reportRoot), 1);
  return dirs[0] || null;
}

async function resolveReportDir(options = {}) {
  if (options.reportDir) return path.resolve(options.reportDir);
  if (options.latest) return findLatestReportDir(options.reportRoot);
  return null;
}

export async function loadEvidenceReportArtifact(reportDir) {
  if (!reportDir) return null;
  const dir = path.resolve(reportDir);
  const bundlePath = path.join(dir, 'bundle.json');
  if (!existsSync(bundlePath)) return null;
  const bundle = await readJson(bundlePath);
  const drafts = await readJsonIfExists(path.join(dir, 'source-query-drafts.json'), []);
  const manifest = await readJsonIfExists(path.join(dir, 'manifest.json'), null);
  const validation = await readJsonIfExists(path.join(dir, 'validation.json'), null);
  const reportPath = existsSync(path.join(dir, 'report.html')) ? path.join(dir, 'report.html') : null;
  return { reportDir: dir, reportPath, bundle, drafts: asArray(drafts), manifest, validation };
}

function bundleSubjectKey(bundle = {}) {
  return slugify(bundle.subject?.subjectId || bundle.subject?.displayName || bundle.subjectId || bundle.theme || bundle.reportType || 'subject');
}

function bundleSubjectDisplay(bundle = {}) {
  return compact(bundle.subject?.displayName || bundle.subject?.subjectId || bundle.subjectId || bundle.theme || 'subject');
}

function bundleThemes(bundle = {}) {
  return unique([
    bundle.subject?.themeId,
    bundle.subject?.theme,
    bundle.subject?.metadata?.theme,
    bundle.subject?.metadata?.themeKey,
    ...asArray(bundle.subject?.metadata?.themes),
    ...asArray(bundle.metadata?.candidate?.themes),
    ...asArray(bundle.metadata?.themeContext?.themes),
  ]);
}

export function extractEvidenceContractTasksFromArtifact(artifact = {}, options = {}) {
  const bundle = artifact.bundle || {};
  const matrix = asArray(findFirstKey(bundle, 'evidenceClassMatrix'));
  const drafts = asArray(artifact.drafts);
  const subjectKey = bundleSubjectKey(bundle);
  const subject = bundleSubjectDisplay(bundle);
  const subjectType = compact(bundle.subject?.subjectType || bundle.subject?.subject_type || artifact.manifest?.subject?.subjectType || artifact.manifest?.subject?.subject_type || '');
  const themes = bundleThemes(bundle);
  const candidateMetadata = bundle.metadata?.candidate?.metadata || {};
  const candidateReason = compact(bundle.metadata?.candidate?.reason || bundle.metadata?.candidateReason || '');
  const parentReadinessGateRequired = Boolean(
    subjectType === 'cross_theme_candidate'
    || bundle.metadata?.candidate
    || /shared dependency graph overlap|cross[-_\s]?theme candidate/i.test(candidateReason)
  );
  const parentReadiness = parentReadinessGateRequired
    ? evaluateParentCandidateReadiness({
      evidenceSummary: parentEvidenceSummaryFromReportArtifact({
        manifest: artifact.manifest,
        bundle,
        validation: artifact.validation,
        drafts,
        artifact,
      }),
      metadata: {
        ...candidateMetadata,
        ...(bundle.metadata || {}),
        nonObviousDiscovery: bundle.metadata?.nonObviousDiscovery || bundle.subject?.metadata?.discovery?.nonObviousDiscovery || {},
        sourceQueryFailure: candidateMetadata.sourceQueryFailure,
        lastSourceQueryExecution: candidateMetadata.lastSourceQueryExecution,
      },
    })
    : {
      parentReadinessState: 'parent_frontier_ready',
      parentReadinessReason: 'non_cross_theme_parent_not_readiness_gated',
      parentDirectEvidenceCount: 1,
      parentSourceDiversityRaw: 2,
      parentOfficialProviderEvidenceCount: 1,
      parentProviderBackedEvidenceCount: 1,
      parentBackfillState: 'none',
      parentReadyForAdjacent: true,
      parentGateRequired: false,
    };
  const adjacentMetadata = bundle.metadata?.adjacentCandidate?.metadata || {};
  const adjacentCandidateKey = bundle.metadata?.adjacentCandidateKey
    || bundle.metadata?.adjacentCandidate?.candidate_key
    || bundle.subject?.metadata?.discovery?.adjacentCandidateKey
    || adjacentMetadata.adjacentCandidateKey
    || null;
  const adjacentLane = bundle.metadata?.adjacentLane
    || bundle.metadata?.adjacentCandidate?.lane
    || bundle.subject?.metadata?.discovery?.adjacentLane
    || adjacentMetadata.adjacentLane
    || null;
  const adjacentStatus = bundle.metadata?.adjacentCandidate?.status || adjacentMetadata.status || null;
  const adjacentSourceTerms = unique([
    ...asArray(bundle.metadata?.adjacentCandidate?.source_terms),
    ...asArray(adjacentMetadata.sourceTerms),
    ...asArray(bundle.subject?.metadata?.discovery?.triggerTerms),
  ]);
  const adjacentSeedTerms = unique([
    ...asArray(bundle.metadata?.adjacentCandidate?.seed_terms),
    ...asArray(adjacentMetadata.seedTerms),
  ]);
  const issuerResolution = resolveReportIssuerUniverse(artifact, options);
  const issuerUniverse = issuerResolution.issuerUniverse;
  const candidateIssuerUniverse = issuerResolution.candidateIssuerUniverse || [];
  const collectionUniverse = issuerResolution.collectionUniverse || unique([
    ...issuerUniverse,
    ...candidateIssuerUniverse,
  ], (value) => compact(value).toUpperCase());
  const rows = [];
  const queuedClasses = new Set();
  const matrixByClass = new Map(matrix
    .filter((row) => row?.evidenceClass)
    .map((row) => [slugify(row.evidenceClass).replace(/-/g, '_'), row]));
  const pushGapTask = (evidenceClass, row = {}, reason = null, currentStatus = row.status || 'missing') => {
    if (!evidenceClass) return;
    const normalizedClass = slugify(evidenceClass).replace(/-/g, '_');
    if (queuedClasses.has(normalizedClass)) return;
    queuedClasses.add(normalizedClass);
    const profile = evidenceClassProfile(normalizedClass);
    const issuerClass = issuerUniverseForEvidenceClass(normalizedClass, issuerResolution, options);
    rows.push({
      report_id: bundle.reportId || artifact.manifest?.reportId || null,
      subject_key: subjectKey,
      pack_name: profile.dataPack || row.dataPack || 'evidencePack',
      task_type: 'source_query',
      query: row.nextQuery || `${subject} ${profile.queryTerms?.join(' ') || normalizedClass}`,
      priority: row.negativeControlIntent ? 82 : (profile.issuerSpecific ? 90 : 86),
      metadata: {
        reason: reason || row.missingReason || `${row.label || normalizedClass} needs provider-specific backfill.`,
        reportType: bundle.reportType || artifact.manifest?.reportType || null,
        subject: bundle.subject || null,
        themes,
        desiredEvidenceClass: normalizedClass,
        evidenceClass: normalizedClass,
        providerRoute: row.providerRoute,
        collectionKind: 'universal_evidence_contract',
        adjacentCandidateKey,
        adjacentLane,
        adjacentStatus,
        sourceTerms: adjacentSourceTerms,
        seedTerms: adjacentSeedTerms,
        issuerUniverse,
        candidateIssuerUniverse,
        collectionUniverse,
        promotionUniverse: issuerResolution.promotionEligibleSymbols || issuerUniverse,
        issuerResolution,
        issuerDiscoveryMap: issuerResolution.issuerDiscoveryMap || [],
        strictEndogenous: Boolean(issuerResolution.strictEndogenous),
        parentReadiness,
        parentReadinessState: parentReadiness.parentReadinessState,
        parentReadinessReason: parentReadiness.parentReadinessReason,
        parentReadyForAdjacent: parentReadiness.parentReadyForAdjacent,
        parentBackfillState: parentReadiness.parentBackfillState,
        closureState: issuerClass.blocked ? 'blocked_missing_issuer_universe' : null,
        nextAction: issuerClass.blocked ? 'resolve issuer universe' : null,
        target: {
          evidenceClass: normalizedClass,
          currentStatus,
          providerRoute: row.providerRoute,
          issuerUniverseSymbols: issuerUniverse,
          candidateIssuerUniverseSymbols: candidateIssuerUniverse,
          collectionUniverseSymbols: collectionUniverse,
          issuerUniverseSource: issuerResolution.sources,
        },
        evidenceContract: {
          ontologyKey: findFirstKey(bundle, 'universalEvidenceContract')?.ontologyKey || null,
          providerRoute: row.providerRoute,
          desiredEvidenceClass: normalizedClass,
          evidenceClass: normalizedClass,
        },
      },
    });
  };
  for (const row of matrix) {
    if (!row?.evidenceClass) continue;
    if (!['missing', 'context'].includes(String(row.status || '').toLowerCase())) continue;
    pushGapTask(row.evidenceClass, row);
  }

  const crossThemeMissing = unique([
    ...asArray(artifact.validation?.quality?.crossThemeDiscoveryQuality?.metrics?.missingEvidenceClasses),
    ...asArray(artifact.validation?.quality?.bottleneckReadiness?.metrics?.missingEvidenceClasses),
  ], (value) => slugify(value).replace(/-/g, '_'));
  for (const evidenceClass of crossThemeMissing) {
    const matrixRow = matrixByClass.get(evidenceClass) || {};
    pushGapTask(
      evidenceClass,
      matrixRow,
      `Cross-theme discovery quality still lacks promotion-grade ${evidenceClass} evidence.`,
      'cross_theme_quality_missing',
    );
  }

  if (parentReadinessGateRequired && !parentReadiness.parentReadyForAdjacent) {
    const parentBackfillClasses = [
      'mechanism_validation',
      'supplier_capacity',
      'substitution_limit',
      'policy_funding',
      'technical_qualification',
      'negative_control',
    ];
    const queries = parentBackfillQueriesForReadiness({
      subject,
      ontologyKey: findFirstKey(bundle, 'universalEvidenceContract')?.ontologyKey || bundle.subject?.metadata?.discovery?.ontologyKey || '',
      evidenceClasses: parentBackfillClasses,
    });
    parentBackfillClasses.forEach((evidenceClass, index) => {
      pushGapTask(evidenceClass, {
        evidenceClass,
        status: 'missing',
        nextQuery: queries[index] || `${subject} ${evidenceClass.replace(/_/g, ' ')} direct evidence official provider`,
        providerRoute: 'parent_readiness_backfill',
      }, `Parent candidate is ${parentReadiness.parentReadinessState}; collect parent-level evidence before adjacent child promotion.`, 'missing');
    });
  }

  for (const draft of drafts) {
    const metadata = draft.metadata || {};
    const desired = metadata.desiredEvidenceClass || metadata.evidenceClass;
    if (!desired || metadata.collectionKind !== 'universal_evidence_contract') continue;
    const scopedIssuerResolution = issuerResolution.strictEndogenous || issuerResolution.frontierParentScoped;
    const draftIssuerUniverse = scopedIssuerResolution ? [] : [
      ...asArray(metadata.issuerUniverse),
      ...asArray(metadata.issuerHints),
      ...asArray(metadata.symbols),
      ...asArray(metadata.target?.issuerUniverseSymbols),
    ];
    const draftCandidateIssuerUniverse = scopedIssuerResolution ? [] : [
      ...asArray(metadata.candidateIssuerUniverse),
      ...asArray(metadata.collectionUniverse),
      ...asArray(metadata.target?.candidateIssuerUniverse),
      ...asArray(metadata.target?.candidateIssuerUniverseSymbols),
      ...asArray(metadata.target?.collectionUniverseSymbols),
    ];
    const mergedIssuerUniverse = unique([
      ...draftIssuerUniverse,
      ...issuerUniverse,
    ], (value) => compact(value).toUpperCase());
    const mergedCandidateIssuerUniverse = unique([
      ...draftCandidateIssuerUniverse,
      ...candidateIssuerUniverse,
    ], (value) => compact(value).toUpperCase());
    const mergedCollectionUniverse = unique([
      ...collectionUniverse,
      ...mergedIssuerUniverse,
      ...mergedCandidateIssuerUniverse,
    ], (value) => compact(value).toUpperCase());
    const issuerClass = issuerUniverseForEvidenceClass(desired, {
      ...issuerResolution,
      issuerUniverse: mergedIssuerUniverse,
      candidateIssuerUniverse: mergedCandidateIssuerUniverse,
      collectionUniverse: mergedCollectionUniverse,
    }, options);
    rows.push({
      report_id: draft.reportId || bundle.reportId || null,
      subject_key: subjectKey,
      pack_name: metadata.packName || metadata.dataPack || evidenceClassProfile(desired).dataPack || 'evidencePack',
      task_type: 'source_query',
      query: metadata.query || draft.text || draft.query,
      priority: metadata.priority || 86,
      metadata: {
        ...metadata,
        reportType: bundle.reportType || artifact.manifest?.reportType || null,
        subject: bundle.subject || metadata.subject || null,
        themes,
        issuerUniverse: mergedIssuerUniverse,
        candidateIssuerUniverse: mergedCandidateIssuerUniverse,
        collectionUniverse: mergedCollectionUniverse,
        promotionUniverse: issuerResolution.promotionEligibleSymbols || mergedIssuerUniverse,
        issuerHints: mergedCollectionUniverse,
        issuerResolution,
        issuerDiscoveryMap: issuerResolution.issuerDiscoveryMap || [],
        strictEndogenous: Boolean(issuerResolution.strictEndogenous),
        frontierParentScoped: Boolean(issuerResolution.frontierParentScoped),
        providerRoutePlan: scopedIssuerResolution ? null : metadata.providerRoutePlan,
        closureState: issuerClass.blocked ? 'blocked_missing_issuer_universe' : metadata.closureState || null,
        nextAction: issuerClass.blocked ? 'resolve issuer universe' : metadata.nextAction || null,
        target: {
          ...(metadata.target || {}),
          issuerUniverseSymbols: mergedIssuerUniverse,
          candidateIssuerUniverseSymbols: mergedCandidateIssuerUniverse,
          collectionUniverseSymbols: mergedCollectionUniverse,
          issuerUniverseSource: issuerResolution.sources,
        },
      },
    });
  }

  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.subject_key}:${row.metadata?.desiredEvidenceClass || row.metadata?.evidenceClass}:${row.query}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(row.query);
  }).slice(0, options.limit || 25);
}

const TERMINAL_CLOSURE_STATES_FOR_DB_PULL = [
  'direct_provider_required',
  'market_validation_pending',
  'provider_no_hit',
  'weak_noise_only',
];

export async function loadDbBackfillTasks(client, options = {}) {
  const params = [options.limit || 25];
  const filters = [];
  const reportId = compact(options.reportId);
  const subjectKey = compact(options.subjectKey);
  if (reportId) {
    params.push(reportId);
    const placeholder = `$${params.length}`;
    filters.push(`(report_id = ${placeholder} OR metadata->>'reportId' = ${placeholder} OR metadata->>'latestReportId' = ${placeholder})`);
  }
  if (subjectKey) {
    params.push(subjectKey);
    filters.push(`subject_key = $${params.length}`);
  }
  params.push(TERMINAL_CLOSURE_STATES_FOR_DB_PULL);
  const terminalPlaceholder = `$${params.length}::text[]`;
  filters.push(`(metadata->>'closureState' IS NULL OR NOT (metadata->>'closureState' = ANY(${terminalPlaceholder})))`);
  const scopeClause = filters.length ? `       AND ${filters.join('\n       AND ')}` : '';
  const result = await client.query(`
    SELECT id, report_id, subject_key, pack_name, task_type, query, status, priority, metadata
      FROM report_backfill_tasks
     WHERE task_type = 'source_query'
       AND status IN ('pending', 'retry_wait', 'needs_fix', 'context_collected', 'negative_control_collected', 'weak_noise_collected')
${scopeClause}
     ORDER BY priority DESC, COALESCE(updated_at, created_at, NOW()) DESC
     LIMIT $1
  `, params).catch(() => ({ rows: [] }));
  return result.rows;
}

function routeStateKey(item = {}) {
  const task = item.task || item;
  const route = item.route || item.providerRoutePlan || {};
  const issuerKey = asArray(route.collectionUniverse?.length ? route.collectionUniverse : route.issuerUniverse)
    .map((symbol) => compact(symbol).toUpperCase())
    .filter(Boolean)
    .sort()
    .join(',') || 'no-issuer';
  return [
    task.subject_key || task.subjectKey || 'subject',
    route.evidenceClass || task.metadata?.desiredEvidenceClass || task.metadata?.evidenceClass || 'evidence',
    issuerKey,
    slugify(task.query || route.queryVariants?.[0] || 'query'),
  ].join('::');
}

function isRouteTerminal(state = {}, item = {}) {
  const entry = state.routes?.[routeStateKey(item)];
  return Boolean(entry?.exhausted);
}

function routeSummary(item = {}) {
  const route = item.route || item.providerRoutePlan || item;
  return {
    evidenceClass: route.evidenceClass,
    providerRoute: route.providerRoute,
    executableCollectors: route.executableCollectors || [],
    sourceProviders: route.sourceProviders || [],
    queryVariants: route.queryVariants || [],
    issuerUniverse: route.issuerUniverse || [],
    candidateIssuerUniverse: route.candidateIssuerUniverse || [],
    collectionUniverse: route.collectionUniverse || [],
    promotionUniverse: route.promotionUniverse || [],
    issuerDiscoveryStatus: route.issuerDiscoveryStatus || null,
    promotionEligible: Boolean(route.promotionEligible),
    negativeControlIntent: Boolean(route.negativeControlIntent),
    requiredFacts: route.requiredFacts || [],
    promotionCriteria: route.promotionCriteria || null,
    contextCriteria: route.contextCriteria || null,
    negativeCriteria: route.negativeCriteria || null,
    collectorCapabilities: route.collectorCapabilities || [],
    terminalFailureModes: route.terminalFailureModes || [],
    parentReadinessState: route.metadata?.parentReadinessState || null,
    parentReadinessReason: route.metadata?.parentReadinessReason || null,
    parentReadyForAdjacent: route.metadata?.parentReadyForAdjacent ?? null,
    blocked: Boolean(route.blocked),
    blockedReason: route.blockedReason || null,
    nextAction: route.nextAction || null,
  };
}

function preferredRouteQuery(item = {}) {
  const original = compact(item.task?.query || '');
  const evidenceClass = item.route?.evidenceClass || item.task?.metadata?.desiredEvidenceClass || item.task?.metadata?.evidenceClass || '';
  const variants = asArray(item.route?.queryVariants).map(compact).filter(Boolean);
  const providerSpecificPattern = /site:war\.gov|site:defense\.gov|site:usaspending\.gov|site:eia\.gov|PAC-3|THAAD|GMLRS|PrSM|SM-6|interceptor|solid rocket motor|qualified supplier|sole source|single-source|budget justification|contract award|qualification|certification|substitution/i;
  const providerVariant = variants.find((query) => query !== original && providerSpecificPattern.test(query));
  if (providerVariant) return providerVariant;
  if (/procurement_trigger|policy_funding|mission_award/i.test(evidenceClass)) {
    return variants.find((query) => /site:war\.gov|site:defense\.gov|site:usaspending\.gov|budget|contract|award/i.test(query)) || variants[0] || original;
  }
  if (/substitution_limit|technical_qualification|propulsion_constraint/i.test(evidenceClass)) {
    return variants.find((query) => /qualified|qualification|certification|sole source|limited suppliers|test|technical/i.test(query)) || variants[0] || original;
  }
  return variants[0] || original;
}

function buildProviderRoutePlan(tasks = [], state = {}, options = {}) {
  const routed = routeEvidenceBackfillTasks(tasks, options)
    .filter((item) => !isRouteTerminal(state, item));
  return {
    routes: routed,
    skippedTerminalCount: tasks.length - routed.length,
    providers: providerListForRoutes(routed.map((item) => item.route), { providers: options.providers }),
  };
}

function taskRouteUniverse(metadata = {}) {
  const route = metadata.providerRoutePlan || {};
  const target = metadata.target || {};
  return unique([
    ...asArray(route.collectionUniverse),
    ...asArray(route.issuerUniverse),
    ...asArray(route.candidateIssuerUniverse),
    ...asArray(metadata.collectionUniverse),
    ...asArray(metadata.issuerUniverse),
    ...asArray(metadata.candidateIssuerUniverse),
    ...asArray(target.collectionUniverseSymbols),
    ...asArray(target.issuerUniverseSymbols),
    ...asArray(target.candidateIssuerUniverseSymbols),
  ], (value) => compact(value).toUpperCase());
}

function taskPromotionUniverse(metadata = {}) {
  const route = metadata.providerRoutePlan || {};
  return unique([
    ...asArray(route.promotionUniverse),
    ...asArray(metadata.promotionUniverse),
  ], (value) => compact(value).toUpperCase());
}

async function supersedeStaleStrictBackfillTasks(client, cyclePlan = {}, options = {}) {
  const artifact = cyclePlan.artifact;
  if (!artifact?.bundle || !cyclePlan.reportId) return { ok: true, inspectedCount: 0, supersededCount: 0, skipped: true };
  const resolution = resolveReportIssuerUniverse(artifact, options);
  if (!resolution.strictEndogenous && !resolution.frontierParentScoped) {
    return { ok: true, inspectedCount: 0, supersededCount: 0, skipped: true };
  }
  const allowedCollection = new Set(asArray(resolution.collectionUniverse).map((symbol) => compact(symbol).toUpperCase()).filter(Boolean));
  const allowedPromotion = new Set(asArray(resolution.promotionEligibleSymbols || resolution.issuerUniverse).map((symbol) => compact(symbol).toUpperCase()).filter(Boolean));
  const rows = await client.query(`
    SELECT id, status, metadata
      FROM report_backfill_tasks
     WHERE task_type = 'source_query'
       AND status NOT IN ('superseded', 'complete', 'rejected', 'cancelled')
       AND (report_id = $1 OR metadata->>'reportId' = $1 OR metadata->>'latestReportId' = $1)
     ORDER BY COALESCE(updated_at, created_at, NOW()) DESC
     LIMIT $2
  `, [cyclePlan.reportId, options.limit || 250]).catch(() => ({ rows: [] }));
  const stale = [];
  for (const row of rows.rows) {
    const metadata = row.metadata || {};
    const universe = taskRouteUniverse(metadata);
    const promotion = taskPromotionUniverse(metadata);
    const hasCollectionLeak = universe.some((symbol) => !allowedCollection.has(symbol));
    const hasPromotionLeak = promotion.some((symbol) => !allowedPromotion.has(symbol));
    if (!universe.length && !promotion.length) continue;
    if (!hasCollectionLeak && !hasPromotionLeak) continue;
    stale.push(row.id);
  }
  for (const id of stale) {
    await client.query(`
      UPDATE report_backfill_tasks
         SET status = 'superseded',
             metadata = metadata || $2::jsonb,
             updated_at = NOW()
       WHERE id = $1
    `, [id, JSON.stringify({
      closureState: 'stale_scoped_issuer_universe',
      closureReason: 'stale_scoped_issuer_universe',
      nextAction: 'regenerate provider route from current scoped issuer universe',
      supersededAt: new Date().toISOString(),
      currentCollectionUniverse: [...allowedCollection],
      currentPromotionUniverse: [...allowedPromotion],
    })]);
  }
  return {
    ok: true,
    inspectedCount: rows.rows.length,
    supersededCount: stale.length,
    currentCollectionUniverse: [...allowedCollection],
    currentPromotionUniverse: [...allowedPromotion],
  };
}

export async function buildEvidenceBackfillCyclePlan(options = {}) {
  const reportDir = await resolveReportDir(options);
  const artifact = await loadEvidenceReportArtifact(reportDir);
  const reportId = artifact?.bundle?.reportId || artifact?.manifest?.reportId || artifact?.validation?.report?.id || null;
  const resolvedStatePath = resolveStatePathForCycle(options, { reportId, reportDir });
  const state = await readJsonIfExists(resolvedStatePath, { version: 1, routes: {} });
  const tasks = artifact
    ? extractEvidenceContractTasksFromArtifact(artifact, options)
    : [];
  const plan = buildProviderRoutePlan(tasks, state, options);
  return {
    ok: Boolean(artifact || tasks.length),
    dryRun: options.dryRun !== false,
    reportDir,
    reportId,
    subject: artifact ? bundleSubjectDisplay(artifact.bundle) : options.subject || null,
    taskCount: tasks.length,
    routeCount: plan.routes.length,
    skippedTerminalCount: plan.skippedTerminalCount,
    providers: plan.providers,
    routes: plan.routes.map((item) => ({
      task: {
        reportId: item.task.report_id || item.task.reportId || null,
        subjectKey: item.task.subject_key || item.task.subjectKey || null,
        packName: item.task.pack_name || item.task.packName || null,
        query: item.task.query,
      },
      route: routeSummary(item.route),
      stateKey: routeStateKey(item),
    })),
    statePath: resolvedStatePath,
    artifact,
    tasks,
    state,
  };
}

function runNodeStep(name, argv, timeoutMs) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const normalizedTimeoutMs = optionalTimeoutMs(timeoutMs, 0, 1_000, 24 * 60 * 60_000);
  const timeoutDisabled = !(Number.isFinite(normalizedTimeoutMs) && normalizedTimeoutMs > 0);
  writeStepLog({
    event: 'start',
    name,
    argv,
    timeoutMs: timeoutLabel(normalizedTimeoutMs),
  });
  try {
    const execOptions = {
      cwd: process.cwd(),
      env: { ...process.env },
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
    };
    if (!timeoutDisabled) execOptions.timeout = normalizedTimeoutMs;
    const stdout = execFileSync(process.execPath, argv, execOptions);
    let json = null;
    try {
      json = JSON.parse(String(stdout || '').trim());
    } catch {
      json = null;
    }
    const result = {
      name,
      ok: true,
      argv,
      startedAt,
      durationMs: Date.now() - started,
      timeoutMs: timeoutLabel(normalizedTimeoutMs),
      json,
      stdoutTail: String(stdout || '').slice(-2_000),
    };
    writeStepLog({
      event: 'finish',
      name,
      ok: result.ok,
      durationMs: result.durationMs,
      timeoutMs: result.timeoutMs,
      stdoutTail: result.stdoutTail,
    });
    return result;
  } catch (error) {
    const stderr = error?.stderr?.toString?.() || '';
    const stdout = error?.stdout?.toString?.() || '';
    const result = {
      name,
      ok: false,
      argv,
      startedAt,
      durationMs: Date.now() - started,
      timeoutMs: timeoutLabel(normalizedTimeoutMs),
      error: String(stderr || stdout || error?.message || error).replace(/\s+/g, ' ').slice(0, 2_000),
    };
    writeStepLog({
      event: 'finish',
      name,
      ok: result.ok,
      durationMs: result.durationMs,
      timeoutMs: result.timeoutMs,
      error: result.error,
    });
    return result;
  }
}

async function runNodeStepAsync(name, argv, timeoutMs) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const normalizedTimeoutMs = optionalTimeoutMs(timeoutMs, 0, 1_000, 24 * 60 * 60_000);
  const timeoutDisabled = !(Number.isFinite(normalizedTimeoutMs) && normalizedTimeoutMs > 0);
  writeStepLog({
    event: 'start',
    name,
    argv,
    timeoutMs: timeoutLabel(normalizedTimeoutMs),
    async: true,
  });
  const execOptions = {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: MAX_BUFFER,
  };
  if (!timeoutDisabled) execOptions.timeout = normalizedTimeoutMs;
  return new Promise((resolve) => {
    execFile(process.execPath, argv, execOptions, (error, stdout = '', stderr = '') => {
      if (error) {
        const result = {
          name,
          ok: false,
          argv,
          startedAt,
          durationMs: Date.now() - started,
          timeoutMs: timeoutLabel(normalizedTimeoutMs),
          error: String(stderr || stdout || error?.message || error).replace(/\s+/g, ' ').slice(0, 2_000),
        };
        writeStepLog({
          event: 'finish',
          name,
          ok: result.ok,
          durationMs: result.durationMs,
          timeoutMs: result.timeoutMs,
          async: true,
          error: result.error,
        });
        resolve(result);
        return;
      }
      let json = null;
      try {
        json = JSON.parse(String(stdout || '').trim());
      } catch {
        json = null;
      }
      const result = {
        name,
        ok: true,
        argv,
        startedAt,
        durationMs: Date.now() - started,
        timeoutMs: timeoutLabel(normalizedTimeoutMs),
        json,
        stdoutTail: String(stdout || '').slice(-2_000),
      };
      writeStepLog({
        event: 'finish',
        name,
        ok: result.ok,
        durationMs: result.durationMs,
        timeoutMs: result.timeoutMs,
        async: true,
        stdoutTail: result.stdoutTail,
      });
      resolve(result);
    });
  });
}

function nestedNumberForKeys(value, keys = new Set(), depth = 0) {
  if (!value || depth > 8) return 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + nestedNumberForKeys(item, keys, depth + 1), 0);
  if (typeof value !== 'object') return 0;
  let total = 0;
  for (const [key, item] of Object.entries(value)) {
    if (keys.has(key)) {
      const parsed = Number(item);
      if (Number.isFinite(parsed)) total += parsed;
    }
    total += nestedNumberForKeys(item, keys, depth + 1);
  }
  return total;
}

function stepProgressed(step = {}) {
  return Boolean(step.ok && nestedNumberForKeys(step.json || {}, new Set([
    'inserted',
    'insertedCount',
    'queuedCount',
    'executedCount',
    'acceptedBundleCount',
    'promotionBundleCount',
    'contextCollectedCount',
    'negativeControlCollectedCount',
  ])) > 0);
}

function unblockClassMap(plan = {}) {
  const map = new Map();
  for (const item of asArray(plan.blockers)) {
    if (!item.evidenceClass) continue;
    map.set(item.evidenceClass, item.state || item.type || 'open');
  }
  return map;
}

export function summarizeUnblockDelta(before = null, after = null) {
  if (!before || !after) return null;
  const beforeMap = unblockClassMap(before);
  const afterMap = unblockClassMap(after);
  const classes = unique([...beforeMap.keys(), ...afterMap.keys()]);
  return {
    statusChanged: before.unblockStatus !== after.unblockStatus,
    beforeStatus: before.unblockStatus,
    afterStatus: after.unblockStatus,
    blockerCountBefore: asArray(before.blockers).length,
    blockerCountAfter: asArray(after.blockers).length,
    changedClasses: classes
      .map((evidenceClass) => ({
        evidenceClass,
        before: beforeMap.get(evidenceClass) || 'closed',
        after: afterMap.get(evidenceClass) || 'closed',
      }))
      .filter((row) => row.before !== row.after),
  };
}

function buildCycleUnblockArtifacts(cyclePlan = {}, marketValidation = null, state = {}, options = {}) {
  if (!cyclePlan.artifact) return { closureSummary: null, unblockPlan: null };
  const artifact = {
    ...cyclePlan.artifact,
    reportId: cyclePlan.reportId,
    reportPath: cyclePlan.artifact?.reportPath,
  };
  const closureSummary = buildReportBackfillClosureLedger({
    artifact,
    taskRows: cyclePlan.tasks,
    marketValidation,
  });
  const unblockPlan = buildGenericEvidenceUnblockPlan({
    artifact,
    closureLedger: closureSummary,
    state,
    options,
  });
  return { closureSummary, unblockPlan };
}

function updateStateForRoutes(state = {}, routes = [], steps = [], options = {}) {
  const next = {
    version: 1,
    routes: { ...(state.routes || {}) },
    updatedAt: new Date().toISOString(),
  };
  const progressed = steps.some(stepProgressed);
  for (const item of routes) {
    const key = routeStateKey(item);
    const previous = next.routes[key] || {};
    const attempts = Number(previous.attempts || 0) + 1;
    next.routes[key] = {
      ...previous,
      attempts,
      exhausted: progressed ? false : attempts >= options.maxAttempts,
      closureReason: progressed
        ? 'progressed'
        : attempts >= options.maxAttempts
          ? 'search_exhausted_not_validated'
          : 'provider_no_hit',
      lastRunAt: new Date().toISOString(),
      lastResult: progressed ? 'progressed' : 'no_progress',
      evidenceClass: item.route?.evidenceClass || null,
      providers: item.route?.executableCollectors || [],
      query: item.task?.query || null,
    };
  }
  return next;
}

async function enqueueArtifactTasks(client, cyclePlan, options = {}) {
  if (!cyclePlan.artifact?.bundle || !cyclePlan.routes.length) {
    return { ok: true, inspectedCount: 0, insertedCount: 0, dedupedCount: 0, skipped: true };
  }
  const drafts = cyclePlan.routes
    .filter((item) => !item.route?.blocked)
    .map((item) => {
      const routedQuery = preferredRouteQuery(item);
      return {
        reportId: item.task.report_id || cyclePlan.reportId || null,
        text: routedQuery,
        reason: item.task.metadata?.reason || `Evidence contract backfill for ${item.route.evidenceClass}`,
        issuerHints: item.route.collectionUniverse || item.route.issuerUniverse || [],
        issuerUniverse: item.route.promotionUniverse || [],
        metadata: {
          ...(item.task.metadata || {}),
          query: routedQuery,
          originalQuery: item.task.query,
          packName: item.task.pack_name || item.task.packName,
          desiredEvidenceClass: item.route.evidenceClass,
          evidenceClass: item.route.evidenceClass,
          issuerHints: item.route.collectionUniverse || item.route.issuerUniverse || [],
          issuerUniverse: item.route.promotionUniverse || [],
          candidateIssuerUniverse: item.route.candidateIssuerUniverse || [],
          collectionUniverse: item.route.collectionUniverse || item.route.issuerUniverse || [],
          promotionUniverse: item.route.promotionUniverse || [],
          providerRoute: item.route.providerRoute,
          providerRoutePlan: item.route,
          collectionKind: 'universal_evidence_contract',
          createdBy: 'evidence-contract-backfill-cycle',
        },
      };
    });
  if (!drafts.length) {
    return {
      ok: true,
      inspectedCount: cyclePlan.routes.length,
      insertedCount: 0,
      dedupedCount: 0,
      skipped: true,
      reason: 'all routes are blocked or non-executable',
    };
  }
  return enqueueReportSourceQueryDrafts(client, cyclePlan.artifact.bundle, drafts, {
    ensureSchema: true,
    limit: options.limit || 25,
  });
}

export async function loadTasksFromDbIfNeeded(client, cyclePlan, options = {}) {
  if (cyclePlan.tasks.length || cyclePlan.artifact) return cyclePlan;
  const strictScope = Boolean(options.reportDir || options.subject || options.latest || cyclePlan.reportId);
  if (strictScope) {
    return {
      ...cyclePlan,
      taskCount: 0,
      routeCount: 0,
      skippedTerminalCount: 0,
      providers: [],
      routes: [],
      tasks: [],
      routedItems: [],
      strictScopeNoTasks: true,
    };
  }
  const tasks = await loadDbBackfillTasks(client, options);
  const plan = buildProviderRoutePlan(tasks, cyclePlan.state, options);
  return {
    ...cyclePlan,
    taskCount: tasks.length,
    routeCount: plan.routes.length,
    skippedTerminalCount: plan.skippedTerminalCount,
    providers: plan.providers,
    routes: plan.routes.map((item) => ({
      task: {
        reportId: item.task.report_id || item.task.reportId || null,
        subjectKey: item.task.subject_key || item.task.subjectKey || null,
        packName: item.task.pack_name || item.task.packName || null,
        query: item.task.query,
      },
      route: routeSummary(item.route),
      stateKey: routeStateKey(item),
    })),
    tasks,
    routedItems: plan.routes,
  };
}

function reportRegenerationArgs(cyclePlan, options) {
  const artifactBundle = cyclePlan.artifact?.bundle || {};
  const rawReportType = options.type || artifactBundle.reportType;
  const reportType = rawReportType === 'cross_theme_bottleneck_report' ? 'cross-theme' : rawReportType;
  const subject = options.subject
    || artifactBundle.metadata?.adjacentCandidateKey
    || artifactBundle.metadata?.adjacentCandidate?.candidate_key
    || artifactBundle.subject?.subjectId
    || bundleSubjectDisplay(artifactBundle);
  if (!reportType || !subject) return null;
  return [
    'scripts/generate-intelligence-report.mjs',
    '--db',
    '--depth', 'deep',
    '--type', reportType,
    '--subject', subject,
    '--report-root', options.reportRoot,
    '--no-enqueue-backfill',
  ];
}

async function dashboardSummaryForOptions(options = {}) {
  let client = null;
  if (options.withDbSummary) {
    try {
      client = new Client(resolveNasPgConfig());
      await client.connect();
    } catch {
      client = null;
    }
  }
  try {
    return await loadReportBackfillClosureSummaries({
      client,
      reportRoot: path.resolve(options.reportRoot || DEFAULT_REPORT_ROOT),
      limit: options.reportLimit || options.limit || 10,
      reportDirs: options.reportDir ? [path.resolve(options.reportDir)] : null,
    });
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

async function runAllReportsEvidenceContractBackfillCycle(options = {}) {
  const reportDirs = await findLatestReportArtifactDirs(path.resolve(options.reportRoot || DEFAULT_REPORT_ROOT), options.reportLimit || 5);
  const results = await runLimited(reportDirs, options.reportConcurrency || 1, async (reportDir) => {
    return runEvidenceContractBackfillCycle({
      ...options,
      allReports: false,
      latest: false,
      reportDir,
      statePath: stateShardPathForReport(null, reportDir),
      userStatePathProvided: true,
    });
  });
  const dashboardSummary = options.dashboardSummary
    ? await loadReportBackfillClosureSummaries({
      reportRoot: path.resolve(options.reportRoot || DEFAULT_REPORT_ROOT),
      limit: options.reportLimit || 5,
      reportDirs,
    })
    : null;
  return {
    ok: results.every((result) => result.ok !== false),
    allReports: true,
    apply: Boolean(options.apply),
    dryRun: options.dryRun !== false,
    reportCount: reportDirs.length,
    reportConcurrency: options.reportConcurrency || 1,
    reportDirs,
    results,
    dashboardSummary,
  };
}

export async function runEvidenceContractBackfillCycle(options = {}) {
  loadOptionalEnvFile();
  if (options.allReports) {
    return runAllReportsEvidenceContractBackfillCycle(options);
  }
  let cyclePlan = await buildEvidenceBackfillCyclePlan(options);
  const steps = [];
  if (options.dryRun) {
    const marketValidation = options.marketValidation && cyclePlan.artifact
      ? await buildReportMarketValidation(null, cyclePlan.artifact, { limit: options.limit })
      : null;
    const { closureSummary, unblockPlan } = buildCycleUnblockArtifacts(cyclePlan, marketValidation, cyclePlan.state, options);
    const { artifact, tasks, state, ...summary } = cyclePlan;
    return { ...summary, apply: false, steps, marketValidation, closureSummary: options.dashboardSummary ? closureSummary : null, unblockPlan };
  }

  const { unblockPlan: initialUnblockPlan } = buildCycleUnblockArtifacts(cyclePlan, null, cyclePlan.state, options);
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    cyclePlan = await loadTasksFromDbIfNeeded(client, cyclePlan, options);
    const superseded = await supersedeStaleStrictBackfillTasks(client, cyclePlan, options);
    if (!superseded.skipped) steps.push({ name: 'supersede-stale-strict-backfill-tasks', ok: superseded.ok !== false, json: superseded });
    const routedItems = cyclePlan.routedItems || routeEvidenceBackfillTasks(cyclePlan.tasks, options)
      .filter((item) => !isRouteTerminal(cyclePlan.state, item));
    const enqueue = await enqueueArtifactTasks(client, { ...cyclePlan, routes: routedItems }, options);
    steps.push({ name: 'enqueue-report-backfill-tasks', ok: enqueue.ok !== false, json: enqueue });
  } finally {
    await client.end().catch(() => {});
  }

  for (let pass = 1; pass <= options.passes; pass += 1) {
    steps.push(runNodeStep(`report-backfill-drain:pass-${pass}`, [
      'scripts/drain-report-backfill-tasks.mjs',
      '--apply',
      '--limit', String(options.limit),
      '--max-attempts', String(options.maxAttempts),
      ...(cyclePlan.reportId ? [`--report-id=${cyclePlan.reportId}`] : []),
    ], optionalTimeoutMs(process.env.EVIDENCE_BACKFILL_DRAIN_STEP_TIMEOUT_MS, DRAIN_STEP_DEFAULT_TIMEOUT_MS, 1_000, 24 * 60 * 60_000)));

    const parallelSteps = [];
    if (cyclePlan.providers.length) {
      parallelSteps.push(() => runNodeStepAsync(`external-provider-backfill:pass-${pass}`, [
        'scripts/collect-free-external-data.mjs',
        '--auto-discover',
        '--providers', cyclePlan.providers.join(','),
        '--limit', String(options.limit),
        '--throttle-hours', String(options.throttleHours),
        '--provider-concurrency', String(options.providerConcurrency || 4),
        '--target-concurrency', String(options.providerConcurrency || 4),
        ...(cyclePlan.reportId ? [`--report-id=${cyclePlan.reportId}`, '--force'] : []),
      ], optionalTimeoutMs(process.env.EVIDENCE_BACKFILL_PROVIDER_STEP_TIMEOUT_MS, PROVIDER_STEP_DEFAULT_TIMEOUT_MS, 1_000, 24 * 60 * 60_000)));
    }

    if (options.autoApproveSourceQueries || options.autoReportSourceQuery) {
      parallelSteps.push(() => runNodeStepAsync(`source-query-execution:pass-${pass}`, [
        'scripts/execute-source-query-approvals.mjs',
        '--approve-pending',
        '--retry-needs-fix',
        '--limit', String(options.limit),
        '--per-query-limit=12',
        `--concurrency=${options.sourceQueryConcurrency || 4}`,
        '--reviewer=evidence-contract-backfill-cycle',
        ...(options.autoReportSourceQuery ? ['--report-created-only'] : []),
        ...(cyclePlan.reportId ? [`--report-id=${cyclePlan.reportId}`] : []),
      ], optionalTimeoutMs(process.env.EVIDENCE_BACKFILL_SOURCE_QUERY_STEP_TIMEOUT_MS, SOURCE_QUERY_STEP_DEFAULT_TIMEOUT_MS, 1_000, 24 * 60 * 60_000)));
    }
    if (parallelSteps.length) {
      steps.push(...await runLimited(parallelSteps, options.stepConcurrency || 2, (step) => step()));
    }
  }

  if (options.marketValidation && cyclePlan.artifact) {
    const client = new Client(resolveNasPgConfig());
    await client.connect();
    try {
      const marketResult = await runReportMarketValidation(client, {
        ...cyclePlan.artifact,
        reportId: cyclePlan.reportId,
        reportPath: cyclePlan.artifact?.reportPath,
      }, { limit: options.limit });
      steps.push({ name: 'market-validation', ok: marketResult.ok !== false, json: marketResult });
    } catch (error) {
      steps.push({ name: 'market-validation', ok: false, error: String(error?.message || error) });
    } finally {
      await client.end().catch(() => {});
    }
  }

  if (options.regenerate) {
    const args = reportRegenerationArgs(cyclePlan, options);
    if (args) steps.push(runNodeStep('regenerate-report', args, optionalTimeoutMs(process.env.EVIDENCE_BACKFILL_REGENERATE_STEP_TIMEOUT_MS, REGENERATE_STEP_DEFAULT_TIMEOUT_MS, 1_000, 24 * 60 * 60_000)));
    else steps.push({ name: 'regenerate-report', ok: true, skipped: true, reason: 'missing report type or subject' });
  }

  const routedItems = routeEvidenceBackfillTasks(cyclePlan.tasks, options)
    .filter((item) => !isRouteTerminal(cyclePlan.state, item));
  const nextState = updateStateForRoutes(cyclePlan.state, routedItems, steps, options);
  const resolvedStatePath = cyclePlan.statePath || resolveStatePathForCycle(options, cyclePlan);
  await writeJson(resolvedStatePath, nextState);

  const dashboardSummary = options.dashboardSummary
    ? await dashboardSummaryForOptions({ ...options, reportDir: cyclePlan.reportDir, withDbSummary: true })
    : null;
  const { unblockPlan: staleUnblockPlan } = buildCycleUnblockArtifacts(cyclePlan, null, nextState, options);
  const regenerateStep = steps.find((step) => step.name === 'regenerate-report' && step.ok && step.json?.reportDir);
  const regeneratedArtifact = regenerateStep?.json?.reportDir
    ? await loadEvidenceReportArtifact(regenerateStep.json.reportDir).catch(() => null)
    : null;
  const regeneratedPlanInput = regeneratedArtifact
    ? {
      ...cyclePlan,
      artifact: regeneratedArtifact,
      reportId: regeneratedArtifact.bundle?.reportId || regeneratedArtifact.manifest?.reportId || cyclePlan.reportId,
      reportDir: regeneratedArtifact.reportDir,
      tasks: extractEvidenceContractTasksFromArtifact(regeneratedArtifact, options),
    }
    : null;
  const { unblockPlan: regeneratedUnblockPlan } = regeneratedPlanInput
    ? buildCycleUnblockArtifacts(regeneratedPlanInput, null, nextState, options)
    : { unblockPlan: null };
  const unblockPlan = regeneratedUnblockPlan || staleUnblockPlan;
  const unblockDelta = summarizeUnblockDelta(initialUnblockPlan, unblockPlan);

  const { artifact, tasks, state, ...summary } = cyclePlan;
  return {
    ...summary,
    dryRun: false,
    apply: true,
    steps,
    statePath: path.resolve(resolvedStatePath),
    dashboardSummary,
    initialUnblockPlan,
    unblockPlan,
    unblockDelta,
  };
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
  runEvidenceContractBackfillCycle(parseEvidenceBackfillCycleArgs())
    .then(async (result) => {
      const options = parseEvidenceBackfillCycleArgs();
      const artifactPath = await writeEvidenceBackfillCycleResultArtifact(result, options);
      const summary = {
        ...compactEvidenceBackfillCycleResult(result),
        artifactPath,
      };
      console.log(JSON.stringify(summary, null, 2));
      if (!result.ok) process.exitCode = 1;
    })
    .catch(async (error) => {
      const failure = {
        ok: false,
        error: String(error?.message || error),
        stack: String(error?.stack || ''),
      };
      let artifactPath = null;
      try {
        const options = parseEvidenceBackfillCycleArgs();
        artifactPath = await writeEvidenceBackfillCycleResultArtifact(failure, options);
      } catch {
        artifactPath = null;
      }
      console.error(JSON.stringify({
        ok: false,
        error: compactText(error?.message || error, 1_000),
        errorKind: /Invalid string length/i.test(String(error?.message || error)) ? 'serialization_failed' : 'execution_failed',
        artifactPath,
      }, null, 2));
      process.exitCode = 1;
    });
}
