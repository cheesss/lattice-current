#!/usr/bin/env node

import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import {
  discoverAdjacentCandidatesFromLatestReports,
  enqueueAdjacentCandidateSourceQueries,
  recordAdjacentDeepReportResult,
  reconcileAdjacentCandidateEvidenceStatus,
  upsertAdjacentThemeCandidates,
} from './_shared/report-adjacent-expansion.mjs';
import {
  chooseReportSubjects,
  discoverUniversalResearchSubjects,
  ensureUniversalResearchSchema,
  recordUniversalResearchAction,
  reportSubjectArgumentForUniversalSubject,
  reportTypeForUniversalSubjectType,
  upsertUniversalResearchSubjects,
} from './_shared/universal-research-orchestrator.mjs';

const { Client } = pg;
const RUNTIME_DIR = path.join(process.cwd(), 'data', 'runtime');
const LATEST_PATH = path.join(RUNTIME_DIR, 'universal-research-orchestrator.latest.json');
const STEP_LOG_PATH = path.join(RUNTIME_DIR, 'universal-research-orchestrator.steps.jsonl');
const MAX_BUFFER = Math.max(1_000_000, Number(process.env.UNIVERSAL_RESEARCH_MAX_BUFFER_BYTES || 12_000_000));
const ADJACENT_READY_STATUSES = new Set(['ready_for_deep_report', 'non_obvious_bottleneck_ready']);

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

function writeStepLog(entry) {
  try {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    appendFileSync(STEP_LOG_PATH, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, 'utf8');
  } catch {
    // Logging must never fail the research loop.
  }
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  const finite = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, Math.floor(finite)));
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    dryRun: false,
    limit: 40,
    sinceHours: 24 * 14,
    execute: true,
    generateReport: true,
    reportRoot: path.join('data', 'reports'),
    providerLimit: 50,
    providerThrottleHours: boundedInt(process.env.UNIVERSAL_RESEARCH_PROVIDER_THROTTLE_HOURS, 6, 0, 24 * 30),
    providers: String(process.env.UNIVERSAL_RESEARCH_PROVIDERS || 'fred,eia,public-planning-source,sec,fmp,polygon,dod-contracts')
      .split(',')
      .map((provider) => provider.trim())
      .filter(Boolean),
    reportSubjectLimit: boundedInt(process.env.UNIVERSAL_RESEARCH_REPORT_SUBJECT_LIMIT, 3, 1, 10),
    coveragePasses: boundedInt(process.env.UNIVERSAL_RESEARCH_COVERAGE_PASSES, 2, 1, 6),
    closurePasses: boundedInt(process.env.UNIVERSAL_RESEARCH_CLOSURE_PASSES, 1, 1, 5),
    providerStepTimeoutMs: optionalTimeoutMs(process.env.UNIVERSAL_RESEARCH_PROVIDER_STEP_TIMEOUT_MS, 0, 1_000, 24 * 60 * 60_000),
    autoApproveSourceQueries: process.env.UNIVERSAL_RESEARCH_AUTO_APPROVE_SOURCE_QUERIES !== '0',
    adjacentExpansion: process.env.UNIVERSAL_RESEARCH_ADJACENT_EXPANSION !== '0',
    adjacentLimit: boundedInt(process.env.UNIVERSAL_RESEARCH_ADJACENT_LIMIT, 25, 1, 100),
    strictEndogenousAdjacent: process.env.UNIVERSAL_RESEARCH_STRICT_ENDOGENOUS_ADJACENT === '1',
    autoReportMode: String(process.env.UNIVERSAL_RESEARCH_AUTO_REPORT_MODE || 'wide'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--no-execute') out.execute = false;
    else if (arg === '--no-report') out.generateReport = false;
    else if (arg === '--limit') out.limit = boundedInt(argv[++i], out.limit, 1, 250);
    else if (arg === '--since-hours') out.sinceHours = boundedInt(argv[++i], out.sinceHours, 1, 24 * 365);
    else if (arg === '--provider-limit') out.providerLimit = boundedInt(argv[++i], out.providerLimit, 1, 250);
    else if (arg === '--provider-throttle-hours') out.providerThrottleHours = boundedInt(argv[++i], out.providerThrottleHours, 0, 24 * 30);
    else if (arg === '--providers') out.providers = String(argv[++i] || '').split(',').map((provider) => provider.trim()).filter(Boolean);
    else if (arg === '--report-subject-limit') out.reportSubjectLimit = boundedInt(argv[++i], out.reportSubjectLimit, 1, 10);
    else if (arg === '--coverage-passes') out.coveragePasses = boundedInt(argv[++i], out.coveragePasses, 1, 6);
    else if (arg === '--closure-passes') out.closurePasses = boundedInt(argv[++i], out.closurePasses, 1, 5);
    else if (arg === '--provider-step-timeout-ms') out.providerStepTimeoutMs = optionalTimeoutMs(argv[++i], out.providerStepTimeoutMs, 1_000, 24 * 60 * 60_000);
    else if (arg === '--report-root') out.reportRoot = argv[++i] || out.reportRoot;
    else if (arg === '--no-auto-source-query') out.autoApproveSourceQueries = false;
    else if (arg === '--adjacent-expansion') out.adjacentExpansion = true;
    else if (arg === '--no-adjacent-expansion') out.adjacentExpansion = false;
    else if (arg === '--strict-endogenous-adjacent') {
      out.strictEndogenousAdjacent = true;
      out.adjacentExpansion = true;
    }
    else if (arg === '--no-strict-endogenous-adjacent') out.strictEndogenousAdjacent = false;
    else if (arg === '--adjacent-limit') out.adjacentLimit = boundedInt(argv[++i], out.adjacentLimit, 1, 100);
    else if (arg === '--auto-report-mode') out.autoReportMode = String(argv[++i] || out.autoReportMode);
  }
  return out;
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

async function updateSubjectReport(client, reportSubject, report) {
  if (!report?.ok || !report.json?.reportId) return;
  await client.query(`
    UPDATE universal_research_subjects
       SET last_report_id = $2,
           last_report_path = $3,
           last_report_quality = $4::jsonb,
           last_report_at = NOW(),
           updated_at = NOW()
     WHERE subject_key = $1
  `, [
    reportSubject,
    report.json.reportId,
    report.json.html || report.json.reportDir || '',
    JSON.stringify({ validationStatus: report.json.validationStatus, quality: report.json.quality || null }),
  ]).catch(() => {});
}

async function ensureReportSubjectRow(client, reportSubject) {
  const key = String(reportSubject || '').trim();
  if (!key) return;
  const label = key
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  await client.query(`
    INSERT INTO universal_research_subjects (
      subject_key, subject_label, subject_type, aliases, source_types,
      data_packs, priority_score, status, last_seen_at, metadata, updated_at
    )
    VALUES ($1, $2, 'theme', ARRAY[$2]::text[], ARRAY['report_subject_selector']::text[],
            ARRAY['marketPack','industryPack','researchPack','policyPack','historicalAnalogPack']::text[],
            50, 'active', NOW(), $3::jsonb, NOW())
    ON CONFLICT (subject_key) DO UPDATE SET
      subject_label = COALESCE(NULLIF(universal_research_subjects.subject_label, ''), EXCLUDED.subject_label),
      source_types = ARRAY(SELECT DISTINCT x FROM unnest(universal_research_subjects.source_types || EXCLUDED.source_types) AS x WHERE x IS NOT NULL AND x <> ''),
      data_packs = ARRAY(SELECT DISTINCT x FROM unnest(universal_research_subjects.data_packs || EXCLUDED.data_packs) AS x WHERE x IS NOT NULL AND x <> ''),
      last_seen_at = NOW(),
      metadata = universal_research_subjects.metadata || EXCLUDED.metadata,
      updated_at = NOW()
  `, [key, label || key, JSON.stringify({ source: 'report_subject_selector' })]);
}

function nestedNumberForKeys(value, keys = new Set(), depth = 0) {
  if (!value || depth > 8) return 0;
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + nestedNumberForKeys(item, keys, depth + 1), 0);
  }
  if (typeof value !== 'object') return 0;
  let total = 0;
  for (const [key, item] of Object.entries(value)) {
    if (keys.has(key)) {
      const parsed = Number(item);
      if (Number.isFinite(parsed)) total += parsed;
    }
    if (item && typeof item === 'object') total += nestedNumberForKeys(item, keys, depth + 1);
  }
  return total;
}

function hasInsertedEvidence(step = {}) {
  const json = step.json || {};
  return nestedNumberForKeys(json, new Set([
    'evidenceInserted',
    'inserted',
    'insertedCount',
    'processedCount',
    'materializedCount',
  ])) > 0;
}

function hasQueuedCoverageWork(step = {}) {
  const json = step.json || {};
  return nestedNumberForKeys(json, new Set([
    'queuedCount',
    'queued',
    'createdCount',
    'jobCount',
  ])) > 0;
}

function hasCoverageProgress(step = {}) {
  return Boolean(step?.ok && (hasInsertedEvidence(step) || hasQueuedCoverageWork(step)));
}

function reportArtifactProduced(reportStep = {}) {
  return Boolean(reportStep?.ok && reportStep.json?.reportId && (reportStep.json?.html || reportStep.json?.reportDir));
}

function subjectByKey(subjects = [], key = '') {
  const lookupKey = String(key || '').toLowerCase();
  return subjects.find((subject) => String(subject.subject_key || subject.subjectKey || '').toLowerCase() === lookupKey) || null;
}

function providerArgs(options = {}, themes = []) {
  const providers = options.providers?.length ? options.providers : ['fred', 'eia', 'sec', 'fmp', 'polygon', 'dod-contracts'];
  const args = [
    'scripts/collect-free-external-data.mjs',
    '--auto-discover',
    '--providers', providers.join(','),
    '--limit', String(options.providerLimit),
    '--since-hours', String(options.sinceHours),
    '--throttle-hours', String(options.providerThrottleHours),
  ];
  const filteredThemes = [...new Set((themes || []).map((theme) => String(theme || '').trim()).filter(Boolean))];
  if (filteredThemes.length) args.push('--themes', filteredThemes.join(','));
  return args;
}

function genericKpiArgs(options = {}, theme = '') {
  const args = [
    'scripts/run-generic-kpi-collection.mjs',
    '--limit', String(Math.max(20, Math.min(120, options.limit * 2))),
    '--job-limit', '160',
  ];
  if (theme && !/^[A-Z]{1,6}([.-][A-Z])?$/.test(String(theme))) {
    args.push('--mode', 'theme', '--theme', theme);
  }
  return args;
}

async function runCoverageExpansionPass(client, options, steps, {
  phase = 'coverage-expansion',
  subjectKey = '',
  themes = [],
  runResearchCycle = false,
} = {}) {
  const provider = runNodeStep(`${phase}:external-provider-backfill`, providerArgs(options, themes), options.providerStepTimeoutMs);
  steps.push(provider);
  await recordUniversalResearchAction(client, {
    subjectKey: subjectKey || null,
    actionType: `${phase}:external-provider-backfill`,
    status: provider.ok ? 'ok' : 'failed',
    reason: 'Re-enter provider backfill after newly discovered source, keyword, symbol, or report-gap targets.',
    payload: { themes, providers: options.providers, providerLimit: options.providerLimit, throttleHours: options.providerThrottleHours },
    result: provider.json || { error: provider.error, stdoutTail: provider.stdoutTail },
  });

  const kpi = runNodeStep(`${phase}:generic-kpi-collection`, genericKpiArgs(options, themes?.[0] || ''), options.providerStepTimeoutMs);
  steps.push(kpi);
  await recordUniversalResearchAction(client, {
    subjectKey: subjectKey || null,
    actionType: `${phase}:generic-kpi-collection`,
    status: kpi.ok ? 'ok' : 'failed',
    reason: 'Materialize ontology/generic KPI observations and queue missing data jobs after provider/source expansion.',
    result: kpi.json || { error: kpi.error, stdoutTail: kpi.stdoutTail },
  });

  let research = null;
  if (runResearchCycle) {
    research = runNodeStep(`${phase}:research-os-cycle`, [
      'scripts/run-research-os-cycle.mjs',
    ], options.providerStepTimeoutMs);
    steps.push(research);
    await recordUniversalResearchAction(client, {
      subjectKey: subjectKey || null,
      actionType: `${phase}:research-os-cycle`,
      status: research.ok ? 'ok' : 'failed',
      reason: 'Run relation mining after evidence expansion so new subjects and connections feed the next reports.',
      result: research.json || { error: research.error, stdoutTail: research.stdoutTail },
    });
  }

  return {
    provider,
    kpi,
    research,
    progressed: [provider, kpi, research].filter(Boolean).some(hasCoverageProgress),
  };
}

async function runReportClosureForSubject(client, reportSubject, options, steps, subjectMeta = null) {
  await ensureReportSubjectRow(client, reportSubject);
  const reportType = reportTypeForUniversalSubjectType(subjectMeta?.subject_type || subjectMeta?.subjectType || 'theme');
  const subjectArg = reportSubjectArgumentForUniversalSubject(subjectMeta || { subject_key: reportSubject, subject_type: 'theme' });
  let report = runNodeStep('generate-db-deep-report', [
    'scripts/generate-intelligence-report.mjs',
    '--db',
    '--depth', 'deep',
    '--type', reportType,
    '--subject', subjectArg,
    '--report-root', options.reportRoot,
  ], options.providerStepTimeoutMs);
  steps.push(report);
  await recordUniversalResearchAction(client, {
    subjectKey: reportSubject,
    actionType: 'generate-db-deep-report',
    status: report.ok ? 'ok' : 'failed',
    reason: 'Regenerate a deep DB-backed report after the research/backfill loop.',
    payload: { reportSubject, subjectArg, reportType, reportRoot: options.reportRoot },
    result: report.json || { error: report.error, stdoutTail: report.stdoutTail },
  });
  await updateSubjectReport(client, reportSubject, report);
  if (subjectMeta?.metadata?.adjacentCandidateKey || String(reportSubject || '').startsWith('adjacent-')) {
    await recordAdjacentDeepReportResult(client, {
      candidateKey: subjectMeta?.metadata?.adjacentCandidateKey || reportSubject,
      reportId: report.json?.reportId || null,
      reportDir: report.json?.reportDir || null,
      reportPath: report.json?.html || report.json?.htmlPath || null,
      ok: Boolean(report.json?.ok),
      validationStatus: report.json?.validationStatus || null,
      grade: report.json?.quality?.grade || null,
      publishable: Boolean(report.json?.quality?.publishable),
      blockers: report.json?.quality?.blockers || report.json?.blockers || [],
      warnings: report.json?.warnings || [],
      quality: report.json?.quality || {},
    });
  }

  if (!(options.execute && options.autoApproveSourceQueries && report.ok)) {
    return report;
  }

  const reportDir = report.json?.reportDir
    || (report.json?.htmlPath ? path.dirname(report.json.htmlPath) : null)
    || (report.json?.html ? path.dirname(report.json.html) : null);
  const closureCycle = runNodeStep(`evidence-contract-closure-cycle:${reportSubject}`, [
    'scripts/run-evidence-contract-backfill-cycle.mjs',
    '--apply',
    ...(reportDir ? ['--report-dir', reportDir] : ['--latest']),
    '--auto-report-source-query',
    '--market-validation',
    '--dashboard-summary',
    '--regenerate',
    '--passes', String(options.closurePasses),
    '--limit', '75',
    '--providers', options.providers.join(','),
    '--throttle-hours', String(options.providerThrottleHours),
    '--subject', subjectArg,
    '--type', reportType,
    '--report-root', options.reportRoot,
  ], options.providerStepTimeoutMs);
  steps.push(closureCycle);
  await recordUniversalResearchAction(client, {
    subjectKey: reportSubject,
    actionType: 'evidence-contract-closure-cycle',
    status: closureCycle.ok ? 'ok' : 'failed',
    reason: 'Close report-scoped evidence contracts with provider routing, report-only source-query execution, local market validation, and regeneration.',
    payload: { reportSubject, subjectArg, reportType, reportRoot: options.reportRoot, reportDir },
    result: closureCycle.json || { error: closureCycle.error, stdoutTail: closureCycle.stdoutTail },
  });
  return report;
}

async function main(options = parseArgs()) {
  loadOptionalEnvFile();
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  const runStartedAt = new Date().toISOString();
  let runId = null;
  try {
    await ensureUniversalResearchSchema(client);
    const runInsert = await client.query(`
      INSERT INTO universal_research_runs (status, options, started_at)
      VALUES ('running', $1::jsonb, NOW())
      RETURNING id
    `, [JSON.stringify(options)]);
    runId = runInsert.rows[0]?.id || null;

    let adjacentExpansion = { candidates: [], diagnostics: [], reportDirs: [] };
    let adjacentBackfill = { inspectedCount: 0, insertedCount: 0, dedupedCount: 0, failedCount: 0, errors: [] };
    let adjacentReconciliation = { inspectedCount: 0, updatedCount: 0, rows: [] };
    if (options.adjacentExpansion) {
      adjacentExpansion = await discoverAdjacentCandidatesFromLatestReports({
        reportRoot: options.reportRoot,
        limit: options.adjacentLimit,
        strictEndogenousAdjacent: options.strictEndogenousAdjacent,
      });
      const adjacentRows = options.dryRun
        ? []
        : await upsertAdjacentThemeCandidates(client, adjacentExpansion.candidates);
      adjacentBackfill = (options.execute && !options.dryRun)
        ? await enqueueAdjacentCandidateSourceQueries(client, adjacentExpansion.candidates, {
          limit: options.adjacentLimit,
          perCandidateLimit: 2,
        })
        : { inspectedCount: 0, insertedCount: 0, dedupedCount: 0, failedCount: 0, errors: [] };
      await recordUniversalResearchAction(client, {
        actionType: 'adjacent-theme-expansion',
        status: adjacentBackfill.failedCount ? 'failed' : 'ok',
        reason: 'Scan recent report artifacts for no-seed adjacent lanes and persist evidence-seeking candidates.',
        payload: {
          reportRoot: options.reportRoot,
          adjacentLimit: options.adjacentLimit,
          autoReportMode: options.autoReportMode,
          strictEndogenousAdjacent: options.strictEndogenousAdjacent,
          dryRun: options.dryRun,
        },
        result: {
          scannedReports: adjacentExpansion.reportDirs.length,
          candidates: adjacentExpansion.candidates.length,
          upserted: adjacentRows.length,
          backfillTasks: adjacentBackfill,
          readyForDeepReport: adjacentExpansion.candidates.filter((candidate) => ADJACENT_READY_STATUSES.has(candidate.status)).length,
          nonObviousBottleneckReady: adjacentExpansion.candidates.filter((candidate) => candidate.status === 'non_obvious_bottleneck_ready').length,
          failureReasons: adjacentExpansion.diagnostics.reduce((acc, item) => {
            const key = item.failureReason || 'none';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {}),
        },
      });
    }

    const discovered = await discoverUniversalResearchSubjects(client, {
      limit: options.limit,
      sinceHours: options.sinceHours,
      adjacentLimit: options.adjacentLimit,
      strictEndogenousAdjacent: options.strictEndogenousAdjacent,
    });
    const subjects = await upsertUniversalResearchSubjects(client, discovered);
    await recordUniversalResearchAction(client, {
      actionType: 'discover-subjects',
      status: 'ok',
      reason: 'Unified queue ingestion from tracking, approvals, sources, report gaps, and research signals.',
      payload: { limit: options.limit, sinceHours: options.sinceHours },
      result: { discovered: discovered.length, upserted: subjects.length },
    });

    const steps = [];
    if (options.execute && !options.dryRun) {
      for (let pass = 1; pass <= options.coveragePasses; pass += 1) {
        await runCoverageExpansionPass(client, options, steps, {
          phase: `coverage-pass-${pass}`,
          runResearchCycle: pass === 1,
        });
      }

      const drain = runNodeStep('report-backfill-drain', [
        'scripts/drain-report-backfill-tasks.mjs',
        '--apply',
        '--limit', '50',
        '--max-attempts', '3',
      ], options.providerStepTimeoutMs);
      steps.push(drain);
      await recordUniversalResearchAction(client, {
        actionType: 'report-backfill-drain',
        status: drain.ok ? 'ok' : 'failed',
        reason: 'Move deep report gaps into review-gated source-query approvals.',
        result: drain.json || { error: drain.error, stdoutTail: drain.stdoutTail },
      });

      if (options.autoApproveSourceQueries) {
        const sourceExec = runNodeStep('source-query-execution', [
          'scripts/execute-source-query-approvals.mjs',
          '--approve-pending',
          '--retry-needs-fix',
          '--limit=50',
          '--per-query-limit=12',
          '--reviewer=universal-research-orchestrator',
          '--report-created-only',
        ], options.providerStepTimeoutMs);
        steps.push(sourceExec);
        await recordUniversalResearchAction(client, {
          actionType: 'source-query-execution',
          status: sourceExec.ok ? 'ok' : 'failed',
          reason: 'Execute review-gated report/research source queries into private evidence bundles so future reports gain sample depth.',
          result: sourceExec.json || { error: sourceExec.error, stdoutTail: sourceExec.stdoutTail },
        });
      }

      if (options.adjacentExpansion) {
        adjacentReconciliation = await reconcileAdjacentCandidateEvidenceStatus(client);
        await recordUniversalResearchAction(client, {
          actionType: 'adjacent-theme-evidence-reconcile',
          status: 'ok',
          reason: 'Reflect adjacent source-query outcomes in candidate status and dashboard metadata.',
          result: adjacentReconciliation,
        });
      }
    }

    let report = null;
    const reports = [];
    const reportSubjects = [];
    if (options.generateReport && !options.dryRun) {
      const selectedSubjects = await chooseReportSubjects(client, subjects, options.reportSubjectLimit, {
        strictEndogenousAdjacent: options.strictEndogenousAdjacent,
      });
      for (const reportSubject of selectedSubjects) {
        reportSubjects.push(reportSubject);
        const meta = subjectByKey(subjects, reportSubject);
        const subjectReport = await runReportClosureForSubject(client, reportSubject, options, steps, meta);
        reports.push({
          subject: reportSubject,
          subjectArg: reportSubjectArgumentForUniversalSubject(meta || { subject_key: reportSubject, subject_type: 'theme' }),
          reportType: reportTypeForUniversalSubjectType(meta?.subject_type || meta?.subjectType || 'theme'),
          report: subjectReport?.json || null,
          ok: reportArtifactProduced(subjectReport),
        });
        if (!report) report = subjectReport;
      }
      const firstOkReport = reports.find((item) => item.ok && item.report)?.report || null;
      if (firstOkReport) report = { ok: true, json: firstOkReport };
    }

    const reportQuality = report?.json?.quality || null;
    const reportQualityChecks = reports.length
      ? reports.map((item) => ({
        subject: item.subject,
        ok: item.ok,
        publishable: item.report?.quality?.publishable !== false,
        grade: item.report?.quality?.grade || null,
        productTier: item.report?.quality?.productTier || null,
        investmentReadiness: item.report?.quality?.investmentReadiness?.tier || null,
        reasons: item.report?.quality?.publishabilityReasons || [],
      }))
      : [];
    const reportPublishable = reportQuality?.publishable !== false;
    const reportGrade = reportQuality?.grade || null;
    const reportQualityOk = !reports.length
      ? (!report || (reportPublishable && ['S', 'A'].includes(reportGrade)))
      : reportQualityChecks.every((item) => item.ok && item.publishable);
    const operationalReportsOk = !reports.length || reports.every((item) => item.ok);
    const ok = steps.every((step) => step.ok) && operationalReportsOk;
    const payload = {
      ok,
      runId,
      dryRun: options.dryRun,
      options,
      startedAt: runStartedAt,
      finishedAt: new Date().toISOString(),
      subjectCount: subjects.length,
      adjacentExpansion: {
        enabled: options.adjacentExpansion,
        scannedReports: adjacentExpansion.reportDirs.length,
        candidateCount: adjacentExpansion.candidates.length,
        readyForDeepReport: adjacentExpansion.candidates.filter((candidate) => ADJACENT_READY_STATUSES.has(candidate.status)).length,
        nonObviousBottleneckReady: adjacentExpansion.candidates.filter((candidate) => candidate.status === 'non_obvious_bottleneck_ready').length,
        strictEndogenousAdjacent: options.strictEndogenousAdjacent,
        backfillTasks: adjacentBackfill,
        evidenceReconciliation: adjacentReconciliation,
        diagnostics: adjacentExpansion.diagnostics.slice(0, 20),
        candidates: adjacentExpansion.candidates.slice(0, 12).map((candidate) => ({
          candidateKey: candidate.candidateKey,
          label: candidate.label,
          lane: candidate.lane,
          status: candidate.status,
          confidenceScore: candidate.confidenceScore,
          failureReason: candidate.failureReason,
          nextAction: candidate.nextAction,
          parentReportId: candidate.parentReportId,
          sourceTerms: candidate.sourceTerms,
          evidenceClasses: candidate.evidenceClasses,
          generatedLane: Boolean(candidate.metadata?.generatedLane),
          discoveryNamespace: candidate.metadata?.discoveryNamespace || 'static_adjacent_playbook',
          seedLeakageScore: Number(candidate.metadata?.seedLeakageScore || 0),
          sourceDiversity: Number(candidate.metadata?.sourceDiversity || 0),
          relationSupport: Number(candidate.metadata?.relationSupport || 0),
          frontierDiscovery: Boolean(candidate.metadata?.frontierDiscovery),
          nonObviousDiscovery: candidate.metadata?.nonObviousDiscovery || null,
        })),
      },
      topSubjects: subjects.slice(0, 12).map((subject) => ({
        subjectKey: subject.subject_key,
        label: subject.subject_label,
        subjectType: subject.subject_type,
        priorityScore: Number(subject.priority_score || 0),
        dataPacks: subject.data_packs,
        sourceTypes: subject.source_types,
      })),
      steps,
      report: report?.json || null,
      reports,
      reportSubjects,
      qualityStatus: {
        ok: reportQualityOk,
        operationalOk: operationalReportsOk,
        publishable: reportPublishable,
        grade: reportGrade,
        reports: reportQualityChecks,
        reasons: reportQuality?.publishabilityReasons || [],
      },
      failedSteps: steps.filter((step) => !step.ok).map((step) => ({ name: step.name, error: step.error })),
    };
    await client.query(`
      UPDATE universal_research_runs
         SET status = $2,
             summary = $3::jsonb,
             finished_at = NOW()
       WHERE id = $1
    `, [runId, ok ? 'ok' : 'warning', JSON.stringify(payload)]);
    mkdirSync(RUNTIME_DIR, { recursive: true });
    writeFileSync(LATEST_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return payload;
  } finally {
    await client.end();
  }
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
  main()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

export {
  main as runUniversalResearchOrchestrator,
  parseArgs,
  hasCoverageProgress,
  providerArgs,
  genericKpiArgs,
};
