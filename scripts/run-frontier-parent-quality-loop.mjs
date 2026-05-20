#!/usr/bin/env node

import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { runRefreshCrossThemeCandidates } from './refresh-cross-theme-candidates.mjs';
import { evaluateFrontierParentCandidate, sortFrontierParentCandidates } from './_shared/frontier-parent-selection.mjs';
import {
  deriveConcreteBottleneckNodes,
  summarizeConcreteBottleneckNodes,
} from './_shared/bottleneck-node-decomposer.mjs';
import {
  enqueueAdjacentCandidateSourceQueries,
  upsertAdjacentThemeCandidates,
} from './_shared/report-adjacent-expansion.mjs';
import { drainReportBackfillTasks } from './_shared/report-deep-research-pack.mjs';
import { routeEvidenceProvider } from './_shared/evidence-provider-router.mjs';

const { Client } = pg;
const RUNTIME_DIR = path.join(process.cwd(), 'data', 'runtime');
const LATEST_PATH = path.join(RUNTIME_DIR, 'frontier-parent-quality-loop.latest.json');
const STEP_LOG_PATH = path.join(RUNTIME_DIR, 'frontier-parent-quality-loop.steps.jsonl');
const STATE_PATH = path.join(RUNTIME_DIR, 'frontier-parent-quality-loop-state.json');
const MAX_BUFFER = Math.max(1_000_000, Number(process.env.FRONTIER_PARENT_MAX_BUFFER_BYTES || 24_000_000));

function compactText(value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'object') return Object.values(value);
  return String(value).split(',');
}

function uniqueStrings(values = [], limit = 80) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
    const text = compactText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function slugify(value = '') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return slug || 'frontier-node';
}

function parentStateKey(candidate = {}) {
  return `${String(candidate.nodeType || '').toLowerCase()}::${String(candidate.label || candidate.subject || '').toLowerCase()}`;
}

function hasDerivedAdjacentTheme(candidate = {}) {
  return asArray(candidate.themes).some((theme) => /^(adjacent|endogenous-adjacent|frontier-parent)-/i.test(String(theme || '')));
}

function loadLoopState() {
  const state = readJsonIfExists(STATE_PATH) || {};
  return {
    version: 'frontier-parent-quality-loop-state-v1',
    parents: state.parents && typeof state.parents === 'object' ? state.parents : {},
  };
}

function writeLoopState(state = {}) {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify({
    version: 'frontier-parent-quality-loop-state-v1',
    updatedAt: new Date().toISOString(),
    parents: state.parents || {},
  }, null, 2));
}

function parentCooldownActive(candidate = {}, state = {}, now = Date.now()) {
  const entry = state.parents?.[parentStateKey(candidate)];
  if (/^execute_(node_specific|parent)_backfill/i.test(String(entry?.lastNextAction || ''))) {
    return false;
  }
  const until = entry?.cooldownUntil ? Date.parse(entry.cooldownUntil) : 0;
  return Number.isFinite(until) && until > now;
}

function updateParentAttemptState(state = {}, candidate = {}, review = {}, reportDir = '') {
  const key = parentStateKey(candidate);
  if (!key || key === '::') return state;
  const current = state.parents?.[key] || {};
  const attempts = num(current.attempts, 0) + 1;
  const hedgeFundReady = Boolean(review.hedgeFundReady);
  const backfillOnly = !reportDir && /^execute_(node_specific|parent)_backfill/i.test(String(review.nextAction || ''));
  const cooldownMs = hedgeFundReady || backfillOnly ? 0 : 6 * 60 * 60 * 1000;
  return {
    ...state,
    parents: {
      ...(state.parents || {}),
      [key]: {
        ...current,
        attempts,
        lastAttemptAt: new Date().toISOString(),
        cooldownUntil: cooldownMs ? new Date(Date.now() + cooldownMs).toISOString() : null,
        lastReportDir: reportDir || current.lastReportDir || null,
        lastExternalGrade: review.externalGrade || null,
        lastExternalScore: review.externalScore ?? null,
        lastHedgeFundReady: hedgeFundReady,
        lastMissing: review.missing || [],
        lastNextAction: review.nextAction || null,
      },
    },
  };
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    dryRun: false,
    apply: false,
    refresh: true,
    limit: 80,
    parentLimit: 6,
    reportRoot: path.join('data', 'reports'),
    providers: ['sec', 'fmp', 'eia', 'public-planning-source', 'polygon', 'dod-contracts', 'usaspending'],
    passes: 1,
    generate: true,
    closure: true,
    drainBackfill: true,
    drainLimit: 200,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--apply') out.apply = true;
    else if (arg === '--no-refresh') out.refresh = false;
    else if (arg === '--no-report') out.generate = false;
    else if (arg === '--no-closure') out.closure = false;
    else if (arg === '--no-drain-backfill') out.drainBackfill = false;
    else if (arg === '--limit') out.limit = Math.max(1, Math.min(500, Math.floor(num(argv[++i], out.limit))));
    else if (arg === '--parent-limit') out.parentLimit = Math.max(1, Math.min(50, Math.floor(num(argv[++i], out.parentLimit))));
    else if (arg === '--drain-limit') out.drainLimit = Math.max(1, Math.min(500, Math.floor(num(argv[++i], out.drainLimit))));
    else if (arg === '--report-root') out.reportRoot = argv[++i] || out.reportRoot;
    else if (arg === '--providers') out.providers = uniqueStrings(String(argv[++i] || '').split(','), 30);
    else if (arg === '--passes') out.passes = Math.max(1, Math.min(6, Math.floor(num(argv[++i], out.passes))));
  }
  if (!out.apply) out.dryRun = true;
  return out;
}

function appendStepLog(entry) {
  try {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    writeFileSync(STEP_LOG_PATH, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, {
      encoding: 'utf8',
      flag: 'a',
    });
  } catch {
    // The loop should not fail because a diagnostic log could not be written.
  }
}

function parseJsonLoose(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') inString = false;
          continue;
        }
        if (char === '"') {
          inString = true;
          continue;
        }
        if (char === '{') depth += 1;
        else if (char === '}') {
          depth -= 1;
          if (depth === 0) {
            const candidate = text.slice(start, index + 1);
            try {
              return JSON.parse(candidate);
            } catch {
              break;
            }
          }
        }
      }
    }
  }
  return null;
}

function runNodeStep(name, argv) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  appendStepLog({ event: 'start', name, argv, timeoutMs: 'disabled' });
  try {
    const stdout = execFileSync(process.execPath, argv, {
      cwd: process.cwd(),
      env: { ...process.env },
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
    });
    const json = parseJsonLoose(stdout);
    const result = {
      name,
      ok: true,
      argv,
      startedAt,
      durationMs: Date.now() - started,
      json,
      stdoutTail: String(stdout || '').slice(-3000),
    };
    appendStepLog({ event: 'finish', name, ok: true, durationMs: result.durationMs, stdoutTail: result.stdoutTail });
    return result;
  } catch (error) {
    const stderr = error?.stderr?.toString?.() || '';
    const stdout = error?.stdout?.toString?.() || '';
    const combined = String(stdout || stderr || error?.message || '');
    const json = parseJsonLoose(stdout) || parseJsonLoose(stderr) || (/"ok"\s*:\s*true/.test(combined) ? { ok: true, recoveredFromText: true } : null);
    if (json?.ok === true) {
      const result = {
        name,
        ok: true,
        argv,
        startedAt,
        durationMs: Date.now() - started,
        json,
        stdoutTail: String(stdout || stderr || '').slice(-3000),
        recoveredExitCode: error?.status ?? error?.code ?? null,
      };
      appendStepLog({
        event: 'finish',
        name,
        ok: true,
        durationMs: result.durationMs,
        recoveredExitCode: result.recoveredExitCode,
        stdoutTail: result.stdoutTail,
      });
      return result;
    }
    const result = {
      name,
      ok: false,
      argv,
      startedAt,
      durationMs: Date.now() - started,
      error: String(stderr || stdout || error?.message || error).replace(/\s+/g, ' ').slice(0, 3000),
    };
    appendStepLog({ event: 'finish', name, ok: false, durationMs: result.durationMs, error: result.error });
    return result;
  }
}

function candidateLabel(row = {}) {
  return compactText(row.label || row.canonical_name || row.reason || row.deterministic_id || `candidate-${row.id}`, 180);
}

function mapCandidateRow(row = {}) {
  const evidenceSummary = row.evidence_summary || {};
  const metadata = row.metadata || {};
  const label = candidateLabel(row);
  const nodeType = row.connector_type || row.supplier_type || metadata.parentNodeType || evidenceSummary.parentNodeType;
  const role = metadata.role || (row.supplier_id ? 'supplier' : 'connector');
  const scopedEdgeEvidence = relevantEdgeEvidence({ label, edgeEvidence: row.edge_evidence || [] });
  let frontierParent = evaluateFrontierParentCandidate({
    label,
    nodeType,
    role,
    evidenceSummary,
    metadata,
    parentReadiness: {
      parentReadyForAdjacent: evidenceSummary.parentReadyForAdjacent ?? metadata.parentReadyForAdjacent,
      parentReadinessState: evidenceSummary.parentReadinessState || metadata.parentReadinessState,
      parentReadinessReason: evidenceSummary.parentReadinessReason || metadata.parentReadinessReason,
    },
  });
  if (hasDerivedAdjacentTheme({ themes: row.themes || [] })) {
    frontierParent = {
      ...frontierParent,
      frontierParentState: 'derived_adjacent_parent_excluded',
      frontierParentReason: 'previously_generated_adjacent_themes_are_not_allowed_as_top_level_parent_roots',
      frontierParentCollectionEligible: false,
      frontierParentReportReady: false,
    };
  } else {
    const operatingEvidence = scopedEdgeEvidence.filter((item) => edgeEvidenceHasOperatingConstraint(item));
    const commercialEvidence = operatingEvidence.filter((item) => rowHasCommercialSource(item));
    if (academicThemeOnly({ ...row, label, nodeType, themes: row.themes || [] }, commercialEvidence)) {
      frontierParent = {
        ...frontierParent,
        frontierParentState: 'academic_only_parent_needs_commercial_evidence',
        frontierParentReason: 'academic_only_parent_needs_commercial_evidence_before_report_generation',
        frontierParentCollectionEligible: true,
        frontierParentReportReady: false,
      };
    }
  }
  return {
    id: row.id,
    deterministicId: row.deterministic_id,
    label,
    subject: label,
    themes: row.themes || [],
    score: num(row.score, 0),
    lane: row.lane,
    status: row.status,
    reason: row.reason || '',
    nodeType,
    connectorId: row.connector_id,
    supplierId: row.supplier_id,
    edgeEvidence: scopedEdgeEvidence || row.edge_evidence || [],
    evidenceSummary,
    metadata: {
      ...metadata,
      parentSourceContaminationScore: asArray(row.edge_evidence).length
        ? Math.round((1 - (scopedEdgeEvidence.length / asArray(row.edge_evidence).length)) * 1000) / 1000
        : 0,
    },
    frontierParent,
  };
}

function candidateEvidenceCorpus(candidate = {}) {
  return parentScopedTerms(candidate, [
    candidate.label,
    candidate.reason,
    ...asArray(candidate.themes),
    ...asArray(candidate.evidenceSummary?.discovery?.triggerTerms),
    ...asArray(candidate.evidenceSummary?.discovery?.sourceQueries),
    ...asArray(candidate.metadata?.discovery?.triggerTerms),
    ...asArray(candidate.metadata?.discovery?.sourceQueries),
    ...asArray(candidate.edgeEvidence).flatMap((row) => [
      row?.quote,
      row?.title,
      row?.relation_type || row?.relationType,
      row?.source_type || row?.sourceType,
    ]),
  ], 120).join(' ');
}

function evidenceClassesForParent(candidate = {}) {
  return uniqueStrings([
    'mechanism_validation',
    ...asArray(candidate.evidenceSummary?.evidenceClasses),
    ...asArray(candidate.metadata?.evidenceClasses),
    ...asArray(candidate.metadata?.desiredEvidenceClasses),
    ...asArray(candidate.metadata?.discovery?.evidenceClasses),
    'supplier_capacity',
    'technical_qualification',
    'substitution_limit',
    'issuer_exposure',
    'market_validation',
    'negative_control',
  ], 12);
}

function parentBackfillSubjectKey(candidate = {}) {
  return compactText(candidate.id || candidate.deterministicId || slugify(candidate.label), 160);
}

function parentBackfillEvidenceClasses(candidate = {}) {
  const blockedUntilIssuerBridge = new Set(['market_validation', 'issuer_exposure', 'issuer_commentary', 'primary_filing']);
  return evidenceClassesForParent(candidate)
    .filter((evidenceClass) => !blockedUntilIssuerBridge.has(String(evidenceClass || '').toLowerCase()))
    .slice(0, 7);
}

function normalizeEvidenceClass(value = '') {
  return compactText(value, 80).toLowerCase();
}

function normalizeProviderEvidenceMap(input) {
  if (input instanceof Map) return input;
  const map = new Map();
  if (!input || typeof input !== 'object') return map;
  for (const [key, value] of Object.entries(input)) {
    if (!key || !value) continue;
    map.set(String(key), value);
  }
  return map;
}

function summarizeProviderEvidenceRows(rows = []) {
  const map = new Map();
  for (const row of asArray(rows)) {
    const key = compactText(row?.candidate_key || row?.candidateKey || row?.adjacentCandidateKey, 220);
    if (!key) continue;
    const current = map.get(key) || {
      candidateKey: key,
      promotionEvidenceCount: 0,
      contextEvidenceCount: 0,
      negativeEvidenceCount: 0,
      weakNoiseCount: 0,
      rejectedCount: 0,
      totalEvidenceCount: 0,
      sourceDiversityRaw: 0,
      providers: [],
      desiredEvidenceClasses: [],
      promotionEvidenceClasses: [],
      contextEvidenceClasses: [],
    };
    const count = Math.max(1, Math.floor(num(row?.n ?? row?.count, 1)));
    const evidenceUse = normalizeEvidenceClass(row?.evidence_use || row?.evidenceUse || row?.use || row?.tier);
    const evidenceClass = normalizeEvidenceClass(row?.evidence_class || row?.desiredEvidenceClass || row?.evidenceClass);
    const provider = compactText(row?.provider || row?.sourceProvider || row?.source_type || row?.sourceType || 'unknown', 80);
    current.totalEvidenceCount += count;
    if (provider) current.providers = uniqueStrings([...current.providers, provider], 40);
    if (evidenceClass) current.desiredEvidenceClasses = uniqueStrings([...current.desiredEvidenceClasses, evidenceClass], 40);
    if (evidenceUse === 'promotion_candidate') {
      current.promotionEvidenceCount += count;
      if (evidenceClass) current.promotionEvidenceClasses = uniqueStrings([...current.promotionEvidenceClasses, evidenceClass], 40);
    } else if (evidenceUse === 'supporting_context' || evidenceUse === 'screening_context') {
      current.contextEvidenceCount += count;
      if (evidenceClass) current.contextEvidenceClasses = uniqueStrings([...current.contextEvidenceClasses, evidenceClass], 40);
    } else if (evidenceUse === 'negative_control_candidate') {
      current.negativeEvidenceCount += count;
    } else if (evidenceUse === 'weak_noise') {
      current.weakNoiseCount += count;
    } else if (evidenceUse === 'rejected') {
      current.rejectedCount += count;
    }
    current.sourceDiversityRaw = current.providers.length;
    map.set(key, current);
  }
  return map;
}

function providerEvidenceSupportsFrontierNode(providerEvidence = {}, node = {}) {
  if (!providerEvidence || typeof providerEvidence !== 'object') return false;
  const promotionEvidenceCount = num(providerEvidence.promotionEvidenceCount, 0);
  const sourceDiversityRaw = num(providerEvidence.sourceDiversityRaw, 0);
  if (promotionEvidenceCount < 1 || sourceDiversityRaw < 1) return false;
  const promotionClasses = new Set(asArray(providerEvidence.promotionEvidenceClasses).map(normalizeEvidenceClass).filter(Boolean));
  if (!promotionClasses.size) return false;
  const nodeClasses = new Set([
    ...asArray(node.evidenceClasses),
    'supplier_capacity',
    'technical_qualification',
    'substitution_limit',
    'mechanism_validation',
    'policy_funding',
    'procurement_trigger',
  ].map(normalizeEvidenceClass).filter(Boolean));
  const issuerOnly = new Set(['issuer_exposure', 'issuer_commentary', 'primary_filing', 'market_validation']);
  return [...promotionClasses].some((evidenceClass) => nodeClasses.has(evidenceClass) && !issuerOnly.has(evidenceClass));
}

async function loadFrontierProviderEvidenceSummary(client, { sinceHours = 720 } = {}) {
  if (!client?.query) return new Map();
  const hours = Math.max(1, Math.min(8760, Math.floor(num(sinceHours, 720))));
  const { rows } = await client.query(`
    SELECT COALESCE(NULLIF(metadata->>'adjacentCandidateKey', ''), NULLIF(metadata->>'candidateKey', '')) AS candidate_key,
           LOWER(COALESCE(NULLIF(metadata->>'desiredEvidenceClass', ''), NULLIF(metadata->>'evidenceClass', ''), 'unknown')) AS evidence_class,
           LOWER(COALESCE(NULLIF(metadata->>'evidenceUse', ''), NULLIF(metadata->>'tier', ''), 'unknown')) AS evidence_use,
           COALESCE(NULLIF(metadata->>'sourceProvider', ''), NULLIF(source_type, ''), NULLIF(metadata->>'provider', ''), 'unknown') AS provider,
           COUNT(*)::int AS n
      FROM research_evidence_bundles
     WHERE created_at >= NOW() - ($1::int * INTERVAL '1 hour')
       AND COALESCE(NULLIF(metadata->>'adjacentCandidateKey', ''), NULLIF(metadata->>'candidateKey', '')) LIKE 'endogenous-frontier-parent-%'
     GROUP BY 1, 2, 3, 4
  `, [hours]);
  return summarizeProviderEvidenceRows(rows);
}

export function buildFrontierParentBackfillTasks(candidate = {}, {
  perClassLimit = 2,
  totalLimit = 8,
} = {}) {
  const subjectKey = parentBackfillSubjectKey(candidate);
  const label = compactText(candidate.label || candidate.subject || subjectKey, 160);
  if (!subjectKey || !label) return [];
  const themes = uniqueStrings(candidate.themes || [], 8);
  const discovery = {
    ontologyKey: candidate.metadata?.discovery?.ontologyKey || candidate.evidenceSummary?.discovery?.ontologyKey || null,
    triggerTerms: parentScopedTerms(candidate, [
      label,
      ...asArray(candidate.evidenceSummary?.discovery?.triggerTerms),
      ...asArray(candidate.metadata?.discovery?.triggerTerms),
      ...asArray(candidate.edgeEvidence).flatMap((row) => [row?.title, row?.quote]),
    ], 24),
    sourceQueries: uniqueStrings([
      ...asArray(candidate.evidenceSummary?.discovery?.sourceQueries),
      ...asArray(candidate.metadata?.discovery?.sourceQueries),
    ], 12),
  };
  const tasks = [];
  for (const evidenceClass of parentBackfillEvidenceClasses(candidate)) {
    const route = routeEvidenceProvider({
      evidenceClass,
      subject: label,
      target: label,
      themes,
      ontologyKey: discovery.ontologyKey,
      metadata: {
        parentReadinessState: candidate.frontierParent?.frontierParentState || null,
        parentReadinessReason: candidate.frontierParent?.frontierParentReason || null,
        parentReadyForAdjacent: false,
      },
      queryVariantLimit: Math.max(1, Math.min(4, Number(perClassLimit) || 2)),
    });
    const queries = uniqueStrings([
      ...asArray(route.queryVariants),
      `${label} ${evidenceClass.replace(/_/g, ' ')} direct evidence source`,
    ], Math.max(1, Math.min(5, Number(perClassLimit) || 2)));
    for (const query of queries) {
      tasks.push({
        reportId: null,
        subjectKey,
        packName: `frontier_parent:${evidenceClass}`,
        taskType: 'source_query',
        query,
        priority: Math.max(50, Math.round(num(candidate.frontierParent?.frontierParentScore, 0.5) * 100)),
        metadata: {
          source: 'frontier-parent-quality-loop',
          reason: 'Top-level frontier parent requires direct evidence before adjacent child report generation.',
          collectionKind: 'frontier_parent_candidate',
          createdBy: 'frontier-parent-quality-loop',
          automationPath: 'frontier-parent-quality-loop -> report_backfill_tasks -> approval_queue/source-query -> research_evidence_bundles',
          reviewGate: true,
          reportType: 'cross_theme_bottleneck_report',
          candidateId: subjectKey,
          candidateThemes: themes,
          connector: label,
          target: {
            type: 'frontier_parent_candidate',
            label,
            connector: label,
          },
          subject: {
            subjectType: 'cross_theme_candidate',
            subjectId: subjectKey,
            displayName: label,
            metadata: {
              themes,
              connector: label,
              discovery,
              frontierParentCandidate: true,
            },
          },
          parentReadinessState: candidate.frontierParent?.frontierParentState || null,
          parentReadinessReason: candidate.frontierParent?.frontierParentReason || null,
          parentReadyForAdjacent: false,
          desiredEvidenceClass: evidenceClass,
          evidenceClass,
          evidenceClasses: parentBackfillEvidenceClasses(candidate),
          evidenceUse: 'supporting_context',
          sourceTerms: uniqueStrings([label, ...themes, ...discovery.triggerTerms], 24),
          seedTerms: [],
          failureReason: candidate.frontierParent?.frontierParentReason || null,
          providerRoutePlan: {
            ...route,
            queryVariants: queries,
            parentReadinessState: candidate.frontierParent?.frontierParentState || null,
            parentReadinessReason: candidate.frontierParent?.frontierParentReason || null,
            parentReadyForAdjacent: false,
            discoveryNamespace: 'strict_endogenous_frontier_parent',
          },
        },
      });
      if (tasks.length >= Math.max(1, Math.min(40, Number(totalLimit) || 8))) return tasks;
    }
  }
  return tasks;
}

export async function enqueueFrontierParentBackfillTasks(client, candidates = [], {
  perCandidateLimit = 8,
} = {}) {
  if (!client?.query || !Array.isArray(candidates) || !candidates.length) {
    return { inspectedCount: 0, insertedCount: 0, dedupedCount: 0, failedCount: 0, errors: [] };
  }
  let inspectedCount = 0;
  let insertedCount = 0;
  let dedupedCount = 0;
  let failedCount = 0;
  const errors = [];
  for (const candidate of candidates) {
    const tasks = buildFrontierParentBackfillTasks(candidate, {
      totalLimit: perCandidateLimit,
      perClassLimit: 2,
    });
    for (const task of tasks) {
      inspectedCount += 1;
      try {
        const result = await client.query(`
          INSERT INTO report_backfill_tasks (
            report_id, subject_key, pack_name, task_type, query, status, priority, metadata
          )
          SELECT $1, $2, $3, $4, $5, 'pending', $6, $7::jsonb
          WHERE NOT EXISTS (
            SELECT 1
              FROM report_backfill_tasks
             WHERE subject_key = $2
               AND pack_name = $3
               AND LOWER(query) = LOWER($5)
               AND status = ANY($8::text[])
          )
          RETURNING id
        `, [
          task.reportId,
          task.subjectKey,
          task.packName,
          task.taskType,
          task.query,
          task.priority,
          JSON.stringify(task.metadata || {}),
          ['pending', 'retry_wait', 'queued_review'],
        ]);
        if (result.rows.length) insertedCount += 1;
        else dedupedCount += 1;
      } catch (error) {
        failedCount += 1;
        errors.push({ subjectKey: task.subjectKey, packName: task.packName, query: task.query, error: String(error?.message || error) });
      }
    }
  }
  return { inspectedCount, insertedCount, dedupedCount, failedCount, errors };
}

function edgeEvidenceRelevantToParent(candidate = {}, row = {}) {
  const label = compactText(candidate.label, 120).toLowerCase();
  const quote = compactText(row?.quote || row?.title || '', 1000);
  if (!quote) return false;
  if (/\btransformers?\b/i.test(label)) {
    const aiTransformerNoise = /\b(large language models?|llms?|vision transformers?|diffusion transformers?|text-to-image|neural|attention|training dataset|algorithm)\b/i.test(quote);
    const electricalContext = /\b(power|grid|utility|substation|electric|electrical|transmission|distribution|energy link|voltage|siemens energy|transformer market)\b/i.test(quote);
    if (aiTransformerNoise && !electricalContext) return false;
  }
  return true;
}

function sourceTermRelevantToParent(candidate = {}, value = '') {
  const label = compactText(candidate.label || candidate.subject, 120).toLowerCase();
  const text = compactText(value, 1000);
  if (!text) return false;
  if (/\btransformers?\b/i.test(label)) {
    const aiTransformerNoise = /\b(large language models?|llms?|vision transformers?|diffusion transformers?|text-to-image|neural|attention|training dataset|algorithm|latent geometry|foundation models?|generative models?)\b/i.test(text);
    const electricalContext = /\b(power|grid|utility|substation|electric|electrical|transmission|distribution|energy link|voltage|siemens energy|transformer market|solid-state transformer|high-voltage|switchgear)\b/i.test(text);
    if (aiTransformerNoise && !electricalContext) return false;
  }
  return true;
}

function parentScopedTerms(candidate = {}, values = [], limit = 80) {
  return uniqueStrings(asArray(values).filter((value) => sourceTermRelevantToParent(candidate, value)), limit);
}

function relevantEdgeEvidence(candidate = {}) {
  return asArray(candidate.edgeEvidence).filter((row) => edgeEvidenceRelevantToParent(candidate, row));
}

function edgeEvidenceHasOperatingConstraint(row = {}) {
  const text = compactText([
    row?.quote,
    row?.title,
    row?.url,
    row?.source_type || row?.sourceType,
    row?.relation_type || row?.relationType,
  ].filter(Boolean).join(' '), 1600);
  if (!text) return false;
  if (/\b(arxiv|openalex|paper|journal|preprint|abstract|conference|dataset|benchmark|foundation model|latent geometry|unsupervised|mechanistic study)\b/i.test(text)) {
    return false;
  }
  return /\b(lead.?time|backlog|shortage|supply constraints?|capacity|facility|factory|production|supplier|qualified|qualification|certification|testing|single.?source|sole.?source|permitting|queue|delay|underwriting|insurance|warranty|claims?|reserve|pricing|margin|allocation)\b/i.test(text);
}

function rowHasCommercialSource(row = {}) {
  const text = compactText([
    row?.quote,
    row?.title,
    row?.url,
    row?.publisher,
    row?.source,
    row?.source_type || row?.sourceType,
    row?.provider,
  ].filter(Boolean).join(' '), 1600);
  if (!text) return false;
  if (/\b(arxiv|openalex|paper|journal|preprint|abstract|conference|academic|university|research article)\b/i.test(text)) {
    return false;
  }
  return /\b(sec|edgar|10-k|10-q|8-k|annual report|investor|transcript|company|official|contract|award|usaspending|department|dod|doe|eia|ferc|government|budget|industry|trade|market|exchange|regulator|utility)\b/i.test(text);
}

function academicThemeOnly(candidate = {}, commercialEvidence = []) {
  const themeText = asArray(candidate.themes).join(' ');
  const label = `${candidate.label || ''} ${candidate.nodeType || ''}`;
  const academicTheme = /\b(polymer|covalent|organic|framework|molecular|chemistry|physics|materials|applications|academic|research|paper|journal|arxiv|preprint|foundation-model|benchmark)\b/i.test(themeText);
  const commercialTheme = /\b(defense|space|aerospace|industrial|supply-chain|cyber|security|cloud|data-center|clean-energy|energy|utility|semiconductor|biotech|healthcare|transport|insurance|financial|manufacturing)\b/i.test(themeText);
  const abstractFinancialNode = /\binsurance or warranty risk-transfer capacity\b/i.test(label) && academicTheme;
  return ((academicTheme && !commercialTheme) || abstractFinancialNode) && !commercialEvidence.length;
}

function contextualNodeLabel(node = {}, parentLabel = '') {
  const label = compactText(node.node || node.label || '', 160);
  const parent = compactText(parentLabel, 80).replace(/\s+s$/i, '');
  if (!label || !parent) return label;
  if (/^(input material availability|insurance or warranty risk-transfer capacity|maintenance and replacement cycle capacity|specialist labor or service queue)$/i.test(label)) {
    return `${parent} ${label}`;
  }
  return label;
}

function genericNodeNeedsSpecificEvidence(node = {}) {
  return ['input_material_availability'].includes(String(node.key || ''));
}

function decomposeParentCandidate(candidate = {}, { perParentLimit = 4, providerEvidenceByCandidateKey = new Map() } = {}) {
  const parent = candidate.frontierParent || {};
  const shouldDecompose = parent.frontierParentState === 'broad_parent_needs_decomposition'
    || (parent.frontierParentCollectionEligible && !parent.parentHasNarrowCue);
  if (!shouldDecompose) return [];
  const scopedEdgeEvidence = relevantEdgeEvidence(candidate);
  const scopedOperatingEvidence = scopedEdgeEvidence.filter((row) => edgeEvidenceHasOperatingConstraint(row));
  const scopedCommercialOperatingEvidence = scopedOperatingEvidence.filter((row) => rowHasCommercialSource(row));
  const corpus = candidateEvidenceCorpus({ ...candidate, edgeEvidence: scopedEdgeEvidence });
  const context = {
    parentSubject: candidate.label,
    ontologyKey: candidate.metadata?.discovery?.ontologyKey || candidate.evidenceSummary?.discovery?.ontologyKey || '',
    themes: candidate.themes,
    triggerTerms: parentScopedTerms(candidate, [
      candidate.label,
      ...asArray(candidate.evidenceSummary?.discovery?.triggerTerms),
      ...asArray(candidate.metadata?.discovery?.triggerTerms),
    ], 24),
    corpus,
  };
  const nodes = deriveConcreteBottleneckNodes({
    phrase: candidate.label,
    sourceTerms: parentScopedTerms(candidate, [
      candidate.label,
      ...asArray(candidate.themes),
      ...asArray(scopedEdgeEvidence).map((row) => row?.quote || row?.title || ''),
    ], 24),
    context,
    evidenceClasses: evidenceClassesForParent(candidate),
    limit: perParentLimit,
  });
  const summary = summarizeConcreteBottleneckNodes(nodes);
  const providerEvidenceMap = normalizeProviderEvidenceMap(providerEvidenceByCandidateKey);
  return nodes.map((node, index) => {
    const nodeLabel = contextualNodeLabel(node, candidate.label);
    const candidateKey = [
      'endogenous-frontier-parent',
      candidate.id || slugify(candidate.label),
      slugify(nodeLabel),
    ].join('-').slice(0, 180);
    const providerEvidence = providerEvidenceMap.get(candidateKey) || null;
    const providerSupported = providerEvidenceSupportsFrontierNode(providerEvidence, node);
    const academicOnly = academicThemeOnly({
      ...candidate,
      label: nodeLabel,
      nodeType: node.nodeType,
    }, scopedCommercialOperatingEvidence);
    const parentNonObvious = candidate.evidenceSummary?.nonObviousDiscovery || candidate.metadata?.nonObviousDiscovery || {};
    const sourceDiversityRaw = Math.max(
      num(candidate.evidenceSummary?.sourceDiversityRaw ?? candidate.metadata?.parentSourceDiversityRaw, 0),
      num(providerEvidence?.sourceDiversityRaw, 0),
    );
    const directEvidenceCount = Math.max(
      num(candidate.evidenceSummary?.directEvidenceCount ?? candidate.metadata?.parentDirectEvidenceCount, 0),
      num(providerEvidence?.promotionEvidenceCount, 0),
    );
    const providerOperatingEvidenceCount = num(providerEvidence?.promotionEvidenceCount, 0) + num(providerEvidence?.contextEvidenceCount, 0);
    const nodeSupported = !academicOnly && !genericNodeNeedsSpecificEvidence(node) && (
      (Boolean(node.sourceDerived) && scopedOperatingEvidence.length > 0)
      || (node.score >= 0.58 && directEvidenceCount >= 2 && sourceDiversityRaw >= 2 && scopedOperatingEvidence.length > 0)
      || providerSupported
    );
    const nonObviousDiscovery = {
      ...parentNonObvious,
      frontierScore: Math.max(num(parentNonObvious.frontierScore, 0), Math.round(node.score * 100)),
      bottleneckSpecificityScore: Math.max(num(parentNonObvious.bottleneckSpecificityScore, 0), node.score),
      scarcitySignalScore: Math.max(num(parentNonObvious.scarcitySignalScore, 0), node.score >= 0.62 ? 0.34 : 0.18),
      frontierNodeScore: Math.max(num(parentNonObvious.frontierNodeScore, 0), node.score),
      consensusPenalty: Math.min(num(parentNonObvious.consensusPenalty, 0), 0.12),
    };
    const childEvidenceSummary = {
      ...candidate.evidenceSummary,
      parentReadyForAdjacent: candidate.evidenceSummary?.parentReadyForAdjacent ?? candidate.metadata?.parentReadyForAdjacent ?? true,
      parentReadinessState: candidate.evidenceSummary?.parentReadinessState || candidate.metadata?.parentReadinessState || 'parent_frontier_ready',
      parentReadinessReason: candidate.evidenceSummary?.parentReadinessReason || candidate.metadata?.parentReadinessReason || 'parent_decomposition_from_evidence_backed_candidate',
      sourceDiversityRaw,
      directEvidenceCount,
      providerBackfillEvidence: providerEvidence || null,
      providerBackfillEvidenceCount: providerOperatingEvidenceCount,
      providerBackfillPromotionEvidenceCount: num(providerEvidence?.promotionEvidenceCount, 0),
      providerBackfillSourceDiversityRaw: num(providerEvidence?.sourceDiversityRaw, 0),
      frontierOperatingEvidenceCount: scopedOperatingEvidence.length + providerOperatingEvidenceCount,
      frontierCommercialOperatingEvidenceCount: scopedCommercialOperatingEvidence.length,
      academicOnlyParentNeedsCommercialEvidence: academicOnly,
      sourceDerivedNodeCount: (node.sourceDerived ? 1 : 0) + (providerSupported ? 1 : 0),
      frontierNodeSupported: nodeSupported,
      nonObviousDiscovery,
      concreteBottleneckNodeSummary: summary,
      decomposedFromParent: {
        id: candidate.id,
        label: candidate.label,
        nodeType: candidate.nodeType,
      },
    };
    const frontierParent = evaluateFrontierParentCandidate({
      label: nodeLabel,
      nodeType: node.nodeType,
      role: 'frontier_node',
      evidenceSummary: childEvidenceSummary,
      metadata: {
        role: 'frontier_node',
        parentNodeType: node.nodeType,
        frontierNodeSupported: nodeSupported,
        academicOnlyParentNeedsCommercialEvidence: academicOnly,
        frontierCommercialOperatingEvidenceCount: scopedCommercialOperatingEvidence.length,
        sourceDerivedNodeCount: (node.sourceDerived ? 1 : 0) + (providerSupported ? 1 : 0),
        frontierOperatingEvidenceCount: scopedOperatingEvidence.length + providerOperatingEvidenceCount,
        providerBackfillPromotionEvidenceCount: num(providerEvidence?.promotionEvidenceCount, 0),
        providerBackfillSourceDiversityRaw: num(providerEvidence?.sourceDiversityRaw, 0),
      },
      parentReadiness: {
        parentReadyForAdjacent: true,
        parentReadinessState: 'parent_frontier_ready',
        parentReadinessReason: 'decomposed_from_parent_with_frontier_node_support',
      },
    });
    const reportReady = frontierParent.frontierParentReportReady && nodeSupported;
    const adjacentCandidate = {
      candidateKey,
      parentSubjectKey: String(candidate.deterministicId || candidate.id || slugify(candidate.label)),
      parentSubject: candidate.label,
      parentReportId: `frontier-parent-${candidate.id || slugify(candidate.label)}`,
      parentReportPath: null,
      lane: `generated_${slugify(nodeLabel)}`.slice(0, 160),
      label: nodeLabel,
      status: reportReady ? 'non_obvious_bottleneck_ready' : 'needs_scarcity_evidence',
      seedTerms: [],
      sourceTerms: parentScopedTerms(candidate, [candidate.label, ...asArray(node.sourceTerms), ...asArray(candidate.themes)], 24),
      issuerCandidates: [],
      evidenceClasses: node.evidenceClasses || [],
      confidenceScore: Math.round(Math.min(95, 55 + node.score * 28 + (node.sourceDerived ? 8 : 0))),
      failureReason: reportReady ? null : (academicOnly
        ? 'academic_only_parent_needs_commercial_evidence'
        : 'decomposed_parent_needs_direct_scarcity_evidence'),
      nextAction: reportReady
        ? 'Generate a deep frontier bottleneck report, then run direct evidence closure.'
        : 'Run node-specific source-query/provider backfill before report promotion.',
      queryVariants: node.queryVariants || [],
      metadata: {
        discoveryNamespace: 'strict_endogenous_adjacent',
        strictEndogenousAdjacent: true,
        frontierDiscovery: true,
        generatedLane: true,
        generatedFromTopParentLoop: true,
        parentCandidateId: candidate.id,
        parentSubject: candidate.label,
        generatedNodeLabel: nodeLabel,
        parentThemes: candidate.themes || [],
        parentNodeType: candidate.nodeType || null,
        parentFrontierState: parent.frontierParentState || null,
        parentFrontierReason: parent.frontierParentReason || null,
        frontierNodeSupported: nodeSupported,
        providerBackfillEvidence: providerEvidence || null,
        providerBackfillSupported: providerSupported,
        academicOnlyParentNeedsCommercialEvidence: academicOnly,
        frontierCommercialOperatingEvidenceCount: scopedCommercialOperatingEvidence.length,
        sourceDerivedNodeCount: (node.sourceDerived ? 1 : 0) + (providerSupported ? 1 : 0),
        scarcityEvidenceScore: node.score,
        concreteBottleneckNodes: [node],
        concreteBottleneckNodeSummary: summary,
        nonObviousDiscovery,
        evidenceQuotes: uniqueStrings(asArray(scopedOperatingEvidence.length ? scopedOperatingEvidence : scopedEdgeEvidence).map((row) => row?.quote || row?.title || ''), 8),
        sourceTerms: parentScopedTerms(candidate, [candidate.label, ...asArray(node.sourceTerms)], 24),
        queryVariants: node.queryVariants || [],
        strictEndogenousVersion: 2,
      },
    };
    return {
      ...candidate,
      id: `${candidate.id}:node:${index + 1}`,
      label: nodeLabel,
      subject: nodeLabel,
      nodeType: node.nodeType,
      lane: adjacentCandidate.lane,
      status: adjacentCandidate.status,
      evidenceSummary: childEvidenceSummary,
      metadata: {
        ...candidate.metadata,
        ...adjacentCandidate.metadata,
        adjacentCandidateKey: candidateKey,
        adjacentStatus: adjacentCandidate.status,
      },
      frontierParent: {
        ...frontierParent,
        frontierParentReportReady: reportReady,
        frontierParentState: reportReady ? frontierParent.frontierParentState : 'decomposed_parent_needs_scarcity_evidence',
        frontierParentReason: reportReady
          ? frontierParent.frontierParentReason
          : (academicOnly
            ? 'academic_only_parent_needs_commercial_evidence_before_report_generation'
            : 'decomposed_node_requires_node_specific_backfill_before_report_generation'),
      },
      decomposedFromParent: {
        id: candidate.id,
        label: candidate.label,
        nodeType: candidate.nodeType,
        frontierParent: candidate.frontierParent,
      },
      concreteBottleneckNode: node,
      adjacentCandidate,
      reportSubjectKey: candidateKey,
    };
  });
}

export function selectFrontierParentCandidates(rows = [], options = {}) {
  const state = options.state || { parents: {} };
  const now = Date.now();
  const providerEvidenceByCandidateKey = normalizeProviderEvidenceMap(options.providerEvidenceByCandidateKey);
  const parentCandidates = rows.map(mapCandidateRow);
  const decomposedCandidates = parentCandidates.flatMap((candidate) => decomposeParentCandidate(candidate, {
    perParentLimit: options.perParentLimit || 4,
    providerEvidenceByCandidateKey,
  }));
  const candidates = [...decomposedCandidates, ...parentCandidates];
  const sortedRaw = sortFrontierParentCandidates(candidates.map((candidate) => ({
    ...candidate,
    label: candidate.label,
    node: { nodeType: candidate.nodeType, canonicalName: candidate.label },
    frontierParent: candidate.frontierParent,
  })));
  const sorted = [];
  const seenParentKeys = new Set();
  for (const candidate of sortedRaw) {
    const key = `${String(candidate.nodeType || '').toLowerCase()}::${String(candidate.label || '').toLowerCase()}`;
    if (seenParentKeys.has(key)) continue;
    seenParentKeys.add(key);
    sorted.push(candidate);
  }
  const activeSorted = sorted.filter((candidate) => !parentCooldownActive(candidate, state, now));
  const activeReportReady = activeSorted.filter((candidate) => candidate.frontierParent.frontierParentReportReady);
  const activeCollectionEligible = activeSorted.filter((candidate) => (
    !candidate.frontierParent.frontierParentReportReady
    && candidate.frontierParent.frontierParentCollectionEligible
  ));
  const activeHasActionable = activeReportReady.length || activeCollectionEligible.length;
  const cooledCollectionEligible = sorted.filter((candidate) => (
    parentCooldownActive(candidate, state, now)
    && !candidate.frontierParent.frontierParentReportReady
    && candidate.frontierParent.frontierParentCollectionEligible
  ));
  const eligiblePool = activeHasActionable ? activeSorted : cooledCollectionEligible;
  const decomposedReadyParentIds = new Set(eligiblePool
    .filter((candidate) => candidate.decomposedFromParent && candidate.frontierParent.frontierParentReportReady)
    .map((candidate) => String(candidate.decomposedFromParent?.id || ''))
    .filter(Boolean));
  const blocked = eligiblePool.filter((candidate) => !candidate.frontierParent.frontierParentReportReady);
  const reportReady = eligiblePool.filter((candidate) => (
    candidate.frontierParent.frontierParentReportReady
    && (candidate.decomposedFromParent || !decomposedReadyParentIds.has(String(candidate.id || '')))
  ));
  const collectionEligible = eligiblePool.filter((candidate) => (
    !candidate.frontierParent.frontierParentReportReady
    && candidate.frontierParent.frontierParentCollectionEligible
  ));
  const decomposedCollectionEligible = collectionEligible.filter((candidate) => candidate.decomposedFromParent);
  const selected = reportReady.length
    ? reportReady
    : (decomposedCollectionEligible.length ? decomposedCollectionEligible : collectionEligible);
  return {
    candidates: sorted,
    selected: selected.slice(0, Math.max(1, Math.min(50, num(options.parentLimit, 6)))),
    reportReadyCount: reportReady.length,
    collectionEligibleCount: collectionEligible.length,
    blockedCount: blocked.length,
    cooldownCount: sorted.length - activeSorted.length,
    stateCounts: sorted.reduce((acc, candidate) => {
      const key = candidate.frontierParent.frontierParentState || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    decomposedCount: decomposedCandidates.length,
  };
}

async function loadParentRows(client, limit = 80) {
  const { rows } = await client.query(`
    SELECT c.id,
           c.deterministic_id,
           c.connector_node_id AS connector_id,
           c.supplier_node_id AS supplier_id,
           cn.node_type AS connector_type,
           sn.node_type AS supplier_type,
           COALESCE(sn.canonical_name, cn.canonical_name, c.reason, c.deterministic_id) AS label,
           c.themes,
           c.score,
           c.lane,
           c.status,
           c.reason,
           c.evidence_summary,
           c.metadata,
           c.updated_at,
           COALESCE((
             SELECT jsonb_agg(to_jsonb(ev))
               FROM (
                 SELECT kee.quote,
                        kee.source_type,
                        kee.source_id,
                        kee.url,
                        kee.evidence_strength,
                        ke.relation_type,
                        kee.created_at
                   FROM knowledge_edges ke
                   JOIN knowledge_edge_evidence kee ON kee.edge_id = ke.id
                  WHERE ke.source_node_id IN (c.connector_node_id, c.supplier_node_id)
                     OR ke.target_node_id IN (c.connector_node_id, c.supplier_node_id)
                  ORDER BY kee.created_at DESC NULLS LAST
                  LIMIT 16
               ) ev
           ), '[]'::jsonb) AS edge_evidence
      FROM cross_theme_candidates c
      LEFT JOIN knowledge_nodes cn ON c.connector_node_id = cn.id
      LEFT JOIN knowledge_nodes sn ON c.supplier_node_id = sn.id
     WHERE c.status <> 'archived'
     ORDER BY COALESCE((c.evidence_summary->>'parentReadyForAdjacent')::boolean, false) DESC,
              COALESCE((c.evidence_summary->>'frontierParentReportReady')::boolean, false) DESC,
              COALESCE((c.evidence_summary->>'frontierParentScore')::float8, 0) DESC,
              COALESCE((c.evidence_summary->'nonObviousDiscovery'->>'frontierScore')::float8, 0) DESC,
              c.score DESC NULLS LAST,
              c.updated_at DESC NULLS LAST
     LIMIT $1
  `, [Math.max(1, Math.min(500, Math.floor(num(limit, 80))))]);
  return rows;
}

function readJsonIfExists(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function reportDirFromStep(step = {}) {
  if (!step) return null;
  const json = step.json || {};
  return json.reportDir
    || json.report_dir
    || (json.html ? path.dirname(json.html) : null)
    || (json.htmlPath ? path.dirname(json.htmlPath) : null)
    || null;
}

function countMatches(text = '', re) {
  return (String(text || '').match(re) || []).length;
}

export function reviewFrontierReportContent({ reportDir = '', reportText = '', candidate = {} } = {}) {
  const dir = reportDir || '';
  const text = compactText(reportText || (dir && existsSync(path.join(dir, 'report.md')) ? readFileSync(path.join(dir, 'report.md'), 'utf8') : ''), 160000);
  const validation = readJsonIfExists(path.join(dir, 'validation.json')) || {};
  const manifest = readJsonIfExists(path.join(dir, 'manifest.json')) || {};
  const quality = validation.quality || manifest.validation?.quality || {};
  const lower = text.toLowerCase();
  const hasFrontierSection = /non-obvious connector|known narrative suppressed|frontier bottleneck node|scarcity test|pricing-power path/i.test(text);
  const directEvidenceMentions = countMatches(lower, /\b(?:primary filing|management commentary|official|sec filing|contract|direct evidence|issuer exposure attached|promotion_candidate)\b/g);
  const issuerBridgeMentions = countMatches(lower, /\b(?:issuer bridge|direct bridge|issuer exposure attached|issuer translation|auto-discovered related issuer map)\b/g);
  const marketMentions = countMatches(lower, /\b(?:market validation|event uplift|matched controls|t-stat|market reaction)\b/g);
  const negativeMentions = countMatches(lower, /\b(?:negative control|substitution limit|invalidator|redundancy|checked no direct)\b/g);
  const valuationMentions = countMatches(lower, /\b(?:valuation|multiple|consensus|estimate|revision|price action|drawdown|run-up|total return)\b/g);
  const crowdedCaveat = /consensus|known narrative|crowded|already reflected|valuation gap|price run-up/i.test(text);
  const noContradictoryHeadline = !/investment memo candidate/i.test(text) || /not investment-ready|investment not ready|research priority/i.test(text);
  const validationGrade = String(quality.grade || quality.productTier || '').toUpperCase();
  const blockerCount = asArray(quality.blockers || validation.blockers).length + asArray(quality.publishabilityReasons).length;
  const diagnostic = quality.decisionDiagnostic || {};
  const researchUtility = quality.researchUtility || {};
  const utilityMetrics = researchUtility.metrics || {};
  const bridgeAttachedCount = num(
    utilityMetrics.bridgeAttachedCount
    ?? diagnostic.metrics?.completionLedgerCounts?.issuer_bridge_attached
    ?? 0,
    0,
  );
  const marketTier = String(
    diagnostic.metrics?.marketValidationTier
    || quality.investmentReadiness?.marketValidation?.tier
    || '',
  ).toLowerCase();
  const marketRowCount = num(quality.investmentReadiness?.marketValidation?.rowCount, 0);
  const directProviderRequired = num(diagnostic.metrics?.completionLedgerCounts?.direct_provider_required, 0);
  const providerRateLimited = num(diagnostic.metrics?.completionLedgerCounts?.provider_rate_limited, 0);
  const promotionEvidenceCount = num(utilityMetrics.promotionEvidenceCount, 0);
  const parentScore = num(candidate.frontierParent?.frontierParentScore, 0);
  const noveltyScore = Math.min(1, parentScore + (hasFrontierSection ? 0.18 : 0));
  const evidenceScore = Math.min(1, Math.max(directEvidenceMentions / 12, promotionEvidenceCount / 14));
  const bridgeScore = bridgeAttachedCount > 0 ? Math.min(1, Math.max(bridgeAttachedCount / 3, issuerBridgeMentions / 8)) : 0;
  const marketScore = marketTier === 'decision_grade'
    ? Math.min(1, Math.max(0.7, marketRowCount / 8))
    : marketTier === 'screening_grade'
      ? 0.45
      : marketTier === 'weak_screen'
        ? 0.25
        : 0;
  const riskScore = Math.min(1, (negativeMentions + valuationMentions) / 8);
  const externalScore = Math.round(100 * (
    noveltyScore * 0.26
    + evidenceScore * 0.24
    + bridgeScore * 0.18
    + marketScore * 0.12
    + riskScore * 0.14
    + (crowdedCaveat ? 0.04 : 0)
    + (noContradictoryHeadline ? 0.02 : 0)
    - Math.min(0.18, blockerCount * 0.03)
    - Math.min(0.12, directProviderRequired * 0.03 + providerRateLimited * 0.01)
  ));
  const externalGrade = externalScore >= 90 && ['S', 'A'].includes(validationGrade || 'S') ? 'S' : externalScore >= 80 ? 'A' : externalScore >= 68 ? 'B' : externalScore >= 52 ? 'C' : 'D';
  const hedgeFundReady = externalGrade === 'S'
    && evidenceScore >= 0.75
    && bridgeScore >= 0.6
    && marketScore >= 0.5
    && riskScore >= 0.55
    && crowdedCaveat
    && noContradictoryHeadline
    && blockerCount === 0;
  const missing = [];
  if (noveltyScore < 0.72 || !hasFrontierSection) missing.push('frontier_node_novelty_not_explicit_enough');
  if (evidenceScore < 0.75) missing.push('direct_operating_evidence_insufficient');
  if (bridgeScore < 0.6) missing.push('issuer_bridge_insufficient');
  if (marketScore < 0.5) missing.push('controlled_market_validation_insufficient');
  if (riskScore < 0.55) missing.push('valuation_consensus_negative_control_insufficient');
  if (!crowdedCaveat) missing.push('crowdedness_or_price_runup_not_tested');
  if (!noContradictoryHeadline) missing.push('headline_overstates_investment_readiness');
  if (blockerCount > 0) missing.push('report_quality_blockers_remaining');
  return {
    reportDir: dir,
    externalScore,
    externalGrade,
    hedgeFundReady,
    validationGrade: validationGrade || null,
    blockerCount,
    criteria: {
      noveltyScore: Math.round(noveltyScore * 1000) / 1000,
      evidenceScore: Math.round(evidenceScore * 1000) / 1000,
      bridgeScore: Math.round(bridgeScore * 1000) / 1000,
      marketScore: Math.round(marketScore * 1000) / 1000,
      riskScore: Math.round(riskScore * 1000) / 1000,
      crowdedCaveat,
      noContradictoryHeadline,
      hasFrontierSection,
    },
    missing,
    nextAction: hedgeFundReady
      ? 'ready_for_human_portfolio_review'
      : (candidate.frontierParent?.frontierParentReportReady ? 'run_report_closure_and_direct_evidence_backfill' : 'return_to_parent_selection_and_parent_backfill'),
  };
}

function reportSubjectForCandidate(candidate = {}) {
  return candidate.label || candidate.subject || candidate.deterministicId || `candidate-${candidate.id}`;
}

async function runLoop(options = parseArgs()) {
  loadOptionalEnvFile();
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  const startedAt = new Date().toISOString();
  const steps = [];
  try {
    let refresh = null;
    if (options.refresh) {
      refresh = await runRefreshCrossThemeCandidates({ dryRun: options.dryRun, limit: options.limit, client });
    }
    let loopState = loadLoopState();
    const rows = await loadParentRows(client, options.limit);
    const providerEvidenceByCandidateKey = await loadFrontierProviderEvidenceSummary(client);
    const selection = selectFrontierParentCandidates(rows, {
      parentLimit: options.parentLimit,
      state: loopState,
      providerEvidenceByCandidateKey,
    });
    const selected = selection.selected;
    const reports = [];
    let nodeBackfillDrain = null;
    let queuedNodeBackfillCount = 0;
    if (options.apply) {
      for (const candidate of selected.slice(0, options.parentLimit)) {
        let adjacentUpsert = null;
        let adjacentBackfill = null;
        let parentBackfill = null;
        if (candidate.adjacentCandidate) {
          adjacentUpsert = await upsertAdjacentThemeCandidates(client, [candidate.adjacentCandidate]);
          adjacentBackfill = await enqueueAdjacentCandidateSourceQueries(client, [candidate.adjacentCandidate], {
            limit: 8,
            perCandidateLimit: 3,
          });
          queuedNodeBackfillCount += num(adjacentBackfill?.insertedCount, 0) + num(adjacentBackfill?.queuedCount, 0);
          appendStepLog({
            event: 'decomposed-parent-upsert',
            parent: candidate.decomposedFromParent?.label || null,
            node: candidate.label,
            candidateKey: candidate.adjacentCandidate.candidateKey,
            status: candidate.adjacentCandidate.status,
            backfill: adjacentBackfill,
          });
        } else if (!candidate.frontierParent?.frontierParentReportReady) {
          parentBackfill = await enqueueFrontierParentBackfillTasks(client, [candidate], {
            perCandidateLimit: 8,
          });
          queuedNodeBackfillCount += num(parentBackfill?.insertedCount, 0) + num(parentBackfill?.queuedCount, 0);
          appendStepLog({
            event: 'frontier-parent-backfill',
            parent: candidate.label,
            subjectKey: parentBackfillSubjectKey(candidate),
            state: candidate.frontierParent?.frontierParentState || null,
            backfill: parentBackfill,
          });
        }
        if (!candidate.frontierParent?.frontierParentReportReady || !options.generate) {
          const review = {
            reportDir: '',
            externalScore: 0,
            externalGrade: candidate.frontierParent?.frontierParentReportReady ? 'deferred' : 'D',
            hedgeFundReady: false,
            validationGrade: null,
            blockerCount: 0,
            criteria: {},
            missing: !options.generate
              ? ['report_generation_skipped_for_parent_selection_backfill']
              : (candidate.decomposedFromParent
              ? ['node_specific_scarcity_evidence_pending']
              : ['parent_backfill_pending']),
            nextAction: !options.generate
              ? 'drain_and_execute_node_backfill_then_reselect_frontier_parent'
              : (candidate.decomposedFromParent
              ? 'execute_node_specific_backfill_then_reselect_frontier_parent'
              : 'execute_parent_backfill_then_reselect_frontier_parent'),
          };
          loopState = updateParentAttemptState(loopState, candidate, review, '');
          reports.push({
            candidate: {
              id: candidate.id,
              label: candidate.label,
              themes: candidate.themes,
              nodeType: candidate.nodeType,
              decomposedFromParent: candidate.decomposedFromParent || null,
              frontierParent: candidate.frontierParent,
            },
            adjacentUpsert,
            adjacentBackfill,
            parentBackfill,
            generate: null,
            closure: null,
            review,
          });
          continue;
        }
        const subject = candidate.reportSubjectKey || reportSubjectForCandidate(candidate);
        const generate = runNodeStep(`generate-parent-report:${subject}`, [
          'scripts/generate-intelligence-report.mjs',
          '--db',
          '--depth', 'deep',
          '--type', 'cross_theme_bottleneck_report',
          '--subject', subject,
          '--report-root', options.reportRoot,
        ]);
        steps.push(generate);
        let reportDir = reportDirFromStep(generate);
        let closure = null;
        if (options.closure && generate.ok && reportDir) {
          closure = runNodeStep(`parent-report-closure:${subject}`, [
            'scripts/run-evidence-contract-backfill-cycle.mjs',
            '--apply',
            '--report-dir', reportDir,
            '--auto-report-source-query',
            '--market-validation',
            '--regenerate',
            '--dashboard-summary',
            '--passes', String(options.passes),
            '--limit', '75',
            '--providers', options.providers.join(','),
            '--throttle-hours', '0',
            '--subject', subject,
            '--type', 'cross_theme_bottleneck_report',
            '--report-root', options.reportRoot,
          ]);
          steps.push(closure);
          reportDir = reportDirFromStep(closure) || reportDir;
        }
        const review = generate.ok && reportDir
          ? reviewFrontierReportContent({ reportDir, candidate })
          : { hedgeFundReady: false, externalGrade: 'D', missing: ['report_generation_failed'], nextAction: 'fix_report_generation' };
        loopState = updateParentAttemptState(loopState, candidate, review, reportDir);
        reports.push({
          candidate: {
            id: candidate.id,
            label: candidate.label,
            themes: candidate.themes,
            nodeType: candidate.nodeType,
            decomposedFromParent: candidate.decomposedFromParent || null,
            reportSubjectKey: candidate.reportSubjectKey || null,
            frontierParent: candidate.frontierParent,
          },
          adjacentUpsert,
          adjacentBackfill,
          parentBackfill,
          generate,
          closure,
          review,
        });
        if (review.hedgeFundReady) break;
      }
      if (options.drainBackfill) {
        nodeBackfillDrain = await drainReportBackfillTasks(client, {
          dryRun: false,
          ensureSchema: false,
          reconcileStale: true,
          staleHours: 0,
          limit: options.drainLimit,
        });
        appendStepLog({
          event: 'node-backfill-drain',
          queuedNodeBackfillCount,
          drain: {
            inspectedCount: nodeBackfillDrain?.inspectedCount,
            queuedCount: nodeBackfillDrain?.queuedCount,
            dedupedCount: nodeBackfillDrain?.dedupedCount,
            failedCount: nodeBackfillDrain?.failedCount,
          },
        });
      }
      writeLoopState(loopState);
    }
    const payload = {
      ok: steps.every((step) => step.ok),
      dryRun: options.dryRun,
      startedAt,
      finishedAt: new Date().toISOString(),
      options,
      refresh,
      parentSelection: {
        reportReadyCount: selection.reportReadyCount,
        collectionEligibleCount: selection.collectionEligibleCount,
        blockedCount: selection.blockedCount,
        cooldownCount: selection.cooldownCount,
        decomposedCount: selection.decomposedCount,
        providerEvidenceCandidateCount: providerEvidenceByCandidateKey.size,
        stateCounts: selection.stateCounts,
        selected: selected.map((candidate) => ({
          id: candidate.id,
          label: candidate.label,
          themes: candidate.themes,
          nodeType: candidate.nodeType,
          score: candidate.score,
          lane: candidate.lane,
          decomposedFromParent: candidate.decomposedFromParent || null,
          reportSubjectKey: candidate.reportSubjectKey || null,
          frontierParent: candidate.frontierParent,
          plannedAction: candidate.frontierParent.frontierParentReportReady
            ? 'generate_report_then_closure'
            : (candidate.decomposedFromParent ? 'node_specific_backfill_before_report' : 'parent_backfill_before_child_discovery'),
        })),
      },
      reports: reports.map((item) => ({
        candidate: item.candidate,
        reportDir: reportDirFromStep(item.closure) || reportDirFromStep(item.generate),
        generateOk: item.generate?.ok,
        closureOk: item.closure?.ok ?? null,
        adjacentUpserted: Array.isArray(item.adjacentUpsert) ? item.adjacentUpsert.length : null,
        adjacentBackfill: item.adjacentBackfill || null,
        parentBackfill: item.parentBackfill || null,
        review: item.review,
      })),
      nodeBackfillDrain,
      acceptance: {
        hedgeFundReadyReportFound: reports.some((item) => item.review?.hedgeFundReady),
        nextLoopAction: reports.some((item) => item.review?.hedgeFundReady)
          ? 'ready_for_human_portfolio_review'
          : (nodeBackfillDrain?.queuedCount || nodeBackfillDrain?.dedupedCount
            ? 'execute_source_query_approvals_then_reconcile_parent_evidence'
            : (selection.reportReadyCount ? 'continue_direct_evidence_backfill_for_selected_parent' : 'continue_parent_backfill_and_decomposition')),
      },
    };
    writeFileSync(LATEST_PATH, JSON.stringify(payload, null, 2), 'utf8');
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
  runLoop(parseArgs())
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

export { parseArgs, runLoop };
