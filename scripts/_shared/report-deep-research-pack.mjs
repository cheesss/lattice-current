import { ensureAutomationSchema } from './schema-automation.mjs';
import {
  ensureGenericKpiSchema,
  ensureKpiThemeCoverage,
  loadThemeKpiCollectionState,
} from './generic-kpi-collection.mjs';
import {
  buildOntologyBackfillTasks,
  discoveryProfileForTheme,
  evaluateOntologyCoverage,
  filterIssuerSymbols,
} from './theme-ontology.mjs';
import {
  DISCOVERY_EVIDENCE_CLASSES,
  classifyCrossThemeEvidence,
  computeCrossThemeDiscoveryQuality,
  crossThemeBodyEvidence,
  isStrictEndogenousBundle,
} from './cross-theme-discovery-quality.mjs';
import {
  EVIDENCE_CLASS_PROFILES,
  buildEvidenceClassMatrix,
  buildEvidenceContractCollectionTasks,
  buildUniversalActionBridge,
  buildUniversalEvidenceContract,
} from './universal-evidence-contract.mjs';
import { routeEvidenceProvider } from './evidence-provider-router.mjs';
import { extractFactsForEvidenceClass } from './evidence-class-playbooks.mjs';
import { ADJACENT_LANE_PLAYBOOKS } from './report-adjacent-expansion.mjs';
import { marketReactionFromEvidenceRow } from './report-market-validation.mjs';
import { buildReportBackfillClosureLedger } from './report-backfill-closure.mjs';
import {
  ISSUER_DISCOVERY_VERSION,
  buildIssuerDiscoveryMap,
  candidateIssuerUniverseFromMap,
  groupIssuerDiscoveryMap,
  issuerDiscoverySummary,
} from './report-issuer-discovery-map.mjs';

/*
 * Deep research pack.
 *
 * This module upgrades a report bundle from "news/theme summary" to a
 * research operating-system object. It does not assume paid data access.
 * When a dataset is unavailable, it writes an explicit structured gap,
 * source/backfill watch item, and caveat instead of letting the memo pretend
 * the evidence exists.
 */

function asArray(value) { return Array.isArray(value) ? value : []; }

function isCrossThemeDiscoveryReport(bundle = {}) {
  return bundle.reportType === 'cross_theme_bottleneck_report'
    || bundle.subject?.subjectType === 'cross_theme_candidate'
    || bundle.subject?.subject_type === 'cross_theme_candidate';
}

const REPORT_BACKFILL_ACTIVE_STATUSES = Object.freeze(['pending', 'retry_wait', 'queued_review', 'approved', 'needs_fix']);
const REPORT_BACKFILL_QUEUED_STATUSES = Object.freeze(['queued_review', 'approved', 'needs_fix']);
const REPORT_BACKFILL_PENDING_DEDUPE_STATUSES = Object.freeze(['pending', 'retry_wait']);
const REPORT_BACKFILL_DEDUPE_STATUSES = Object.freeze([
  ...REPORT_BACKFILL_ACTIVE_STATUSES,
  'completed',
  'context_collected',
  'negative_control_collected',
  'weak_noise_collected',
  'failed',
  'rejected',
]);
const REPORT_BACKFILL_DEFAULT_LIMIT = 25;
const REPORT_BACKFILL_DEFAULT_MAX_ATTEMPTS = 3;
const REPORT_BACKFILL_DEFAULT_RETRY_BASE_MS = 30 * 60 * 1000;
const REPORT_BACKFILL_DEFAULT_RETRY_MAX_MS = 6 * 60 * 60 * 1000;
const REPORT_BACKFILL_DEFAULT_STALE_HOURS = 48;

function unique(items) {
  return [...new Set(asArray(items).filter(Boolean))];
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function int(value, fallback = 0) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max, fallback) {
  return Math.max(min, Math.min(max, int(value, fallback)));
}

function ratio(numerator, denominator, fallback = 0) {
  const denom = Number(denominator);
  if (!Number.isFinite(denom) || denom <= 0) return fallback;
  const value = Number(numerator) / denom;
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function envInt(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return clamp(raw, min, max, fallback);
}

function slugify(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'unknown';
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function one(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0] || null;
}

async function many(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows;
}

async function tableExists(client, tableName) {
  if (!client || !tableName) return false;
  const row = await one(client, `
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS exists
  `, [tableName]).catch(() => null);
  return row?.exists === true;
}

async function safeRows(client, tableName, sql, params = []) {
  if (!await tableExists(client, tableName)) return [];
  return many(client, sql, params).catch(() => []);
}

function normalizeDrainOptions(options = {}) {
  return {
    dryRun: Boolean(options.dryRun),
    ensureSchema: options.ensureSchema !== false,
    reconcileStale: options.reconcileStale !== false,
    reportId: String(options.reportId || options.report_id || '').trim() || null,
    limit: clamp(options.limit, 1, 250, REPORT_BACKFILL_DEFAULT_LIMIT),
    maxAttempts: clamp(options.maxAttempts, 1, 10, REPORT_BACKFILL_DEFAULT_MAX_ATTEMPTS),
    retryBaseDelayMs: clamp(options.retryBaseDelayMs, 60_000, REPORT_BACKFILL_DEFAULT_RETRY_MAX_MS, REPORT_BACKFILL_DEFAULT_RETRY_BASE_MS),
    retryMaxDelayMs: clamp(options.retryMaxDelayMs, 60_000, 24 * 60 * 60 * 1000, REPORT_BACKFILL_DEFAULT_RETRY_MAX_MS),
    staleHours: clamp(options.staleHours, 0, 24 * 14, REPORT_BACKFILL_DEFAULT_STALE_HOURS),
  };
}

function safeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function reportBackfillTaskId(task = {}) {
  return String(task.id || task.taskId || task.reportBackfillTaskId || '').trim();
}

function reportBackfillPackName(task = {}) {
  return String(task.pack_name || task.packName || 'unknownPack').trim() || 'unknownPack';
}

function reportBackfillQuery(task = {}) {
  return String(task.query || '').replace(/\s+/g, ' ').trim();
}

export function buildReportBackfillApprovalPayload(task = {}) {
  const metadata = safeMetadata(task.metadata);
  const automationMetadata = safeMetadata(metadata.automation);
  const subject = safeMetadata(metadata.subject);
  const subjectMetadata = safeMetadata(subject.metadata);
  const subjectKeyValue = String(task.subject_key || task.subjectKey || '').trim();
  const reportType = metadata.reportType || null;
  const subjectType = String(subject.subjectType || '').toLowerCase();
  const isCrossThemeCandidate = reportType === 'cross_theme_bottleneck_report' || subjectType === 'cross_theme_candidate';
  const candidateThemes = unique([
    ...(Array.isArray(metadata.candidateThemes) ? metadata.candidateThemes : []),
    ...(Array.isArray(subjectMetadata.themes) ? subjectMetadata.themes : []),
    ...(Array.isArray(metadata.candidate?.themes) ? metadata.candidate.themes : []),
  ]);
  const themes = unique([
    subjectMetadata.theme,
    subjectMetadata.themeKey,
    metadata.theme,
    ...(Array.isArray(metadata.themes) ? metadata.themes : []),
    ...candidateThemes,
    ...(isCrossThemeCandidate ? [] : [subjectKeyValue]),
  ])
    .filter((theme) => !isCrossThemeCandidate || !/^\d+$/.test(String(theme || '').trim()))
    .slice(0, 6);
  const packName = reportBackfillPackName(task);
  const query = reportBackfillQuery(task);
  const desiredEvidenceClass = metadata.desiredEvidenceClass || metadata.evidenceClass || null;
  const explicitProviderRoutePlan = safeMetadata(metadata.providerRoutePlan);
  const isAdjacentCandidate = metadata.collectionKind === 'adjacent_theme_candidate'
    || Boolean(metadata.adjacentCandidateKey || metadata.adjacentLane);
  const routedProviderRoutePlan = desiredEvidenceClass ? routeEvidenceProvider({
    evidenceClass: desiredEvidenceClass,
    providerRoute: explicitProviderRoutePlan.providerRoute || metadata.providerRoute || metadata.target?.providerRoute || metadata.evidenceContract?.providerRoute,
    query,
    subject: subject.displayName || subject.subjectId || subjectKeyValue,
    target: metadata.target?.label || metadata.target?.displayName || metadata.target?.connector || metadata.target?.evidenceClass || subject.displayName || subjectKeyValue,
    themes,
    ontologyKey: metadata.evidenceContract?.ontologyKey || metadata.ontologyKey || subjectMetadata.themeKey || subjectMetadata.theme,
    ontologyKeys: metadata.evidenceContract?.ontologyKeys,
    issuerUniverse: [
      ...asArray(metadata.issuerUniverse),
      ...asArray(metadata.symbols),
      ...asArray(metadata.target?.issuerUniverseSymbols),
      ...asArray(metadata.target?.symbols),
    ],
    metadata,
  }) : null;
  const providerRoutePlan = isAdjacentCandidate && explicitProviderRoutePlan && Object.keys(explicitProviderRoutePlan).length
    ? {
      ...explicitProviderRoutePlan,
      executableCollectors: unique(asArray(explicitProviderRoutePlan.executableCollectors)),
      sourceProviders: unique(asArray(explicitProviderRoutePlan.sourceProviders)),
      queryVariants: unique(asArray(explicitProviderRoutePlan.queryVariants)),
      issuerUniverse: unique(asArray(explicitProviderRoutePlan.issuerUniverse)),
    }
    : explicitProviderRoutePlan && Object.keys(explicitProviderRoutePlan).length
    ? {
      ...(routedProviderRoutePlan || {}),
      ...explicitProviderRoutePlan,
      executableCollectors: unique([
        ...asArray(explicitProviderRoutePlan.executableCollectors),
        ...asArray(routedProviderRoutePlan?.executableCollectors),
      ]),
      sourceProviders: unique([
        ...asArray(explicitProviderRoutePlan.sourceProviders),
        ...asArray(routedProviderRoutePlan?.sourceProviders),
      ]),
      queryVariants: unique([
        ...asArray(explicitProviderRoutePlan.queryVariants),
        ...asArray(routedProviderRoutePlan?.queryVariants),
      ]),
      issuerUniverse: unique([
        ...asArray(explicitProviderRoutePlan.issuerUniverse),
        ...asArray(routedProviderRoutePlan?.issuerUniverse),
      ]),
    }
    : routedProviderRoutePlan;
  return {
    query,
    source: 'report-deep-research-pack',
    reportBackfillTaskId: reportBackfillTaskId(task) || null,
    reportId: metadata.latestReportId || automationMetadata.latestDedupedReportId || task.report_id || task.reportId || metadata.reportId || null,
    subjectKey: subjectKeyValue || null,
    packName,
    taskType: task.task_type || task.taskType || 'source_query',
    themes,
    reason: metadata.reason || `Deep report research gap for ${packName}`,
    reportType,
    subject: metadata.subject || null,
    desiredEvidenceClass,
    providerRoutePlan,
    collectionKind: metadata.collectionKind || null,
    adjacentCandidateKey: metadata.adjacentCandidateKey || null,
    adjacentLane: metadata.adjacentLane || null,
    sourceTerms: asArray(metadata.sourceTerms),
    seedTerms: asArray(metadata.seedTerms),
    evidenceClasses: asArray(metadata.evidenceClasses),
    failureReason: metadata.failureReason || null,
    issuerHints: providerRoutePlan?.issuerUniverse || [],
    issuerUniverse: providerRoutePlan?.issuerUniverse || [],
    ...((isCrossThemeCandidate || isAdjacentCandidate) && subjectKeyValue ? { candidateId: subjectKeyValue } : {}),
    ...(isCrossThemeCandidate ? {
      connector: metadata.connector || subjectMetadata.connector || subject.displayName || subjectKeyValue || null,
      supplier: metadata.supplier || null,
      target: subject.displayName || metadata.target || subjectKeyValue || null,
    } : {}),
    approvalRequired: true,
    boundary: 'review-gated queue only; daemon does not execute paid providers or mutate canonical report data',
  };
}

export function computeReportBackfillRetry(task = {}, options = {}) {
  const normalized = normalizeDrainOptions(options);
  const attempt = int(task.attempt_count ?? task.attemptCount, 0) + 1;
  const exhausted = attempt >= normalized.maxAttempts;
  const delayMs = Math.min(
    normalized.retryMaxDelayMs,
    normalized.retryBaseDelayMs * Math.pow(2, Math.max(0, attempt - 1)),
  );
  return {
    attempt,
    maxAttempts: normalized.maxAttempts,
    exhausted,
    delayMs: exhausted ? 0 : delayMs,
    nextAttemptAt: exhausted ? null : new Date(Date.now() + delayMs).toISOString(),
    status: exhausted ? 'failed' : 'retry_wait',
  };
}

export async function ensureDeepResearchSchema(client) {
  if (!client) return { ok: false, reason: 'no db client' };
  await ensureGenericKpiSchema(client).catch(() => ({ ok: false }));
  await client.query(`
    CREATE TABLE IF NOT EXISTS research_atomic_facts (
      id BIGSERIAL PRIMARY KEY,
      subject_type TEXT NOT NULL,
      subject_key TEXT NOT NULL,
      fact_type TEXT NOT NULL,
      fact_text TEXT NOT NULL,
      value_num DOUBLE PRECISION,
      unit TEXT,
      evidence_ref TEXT,
      confidence DOUBLE PRECISION DEFAULT 0.5,
      observed_at TIMESTAMPTZ,
      source_type TEXT DEFAULT 'lattice',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS company_fundamentals (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      period_end DATE,
      metric_name TEXT NOT NULL,
      value_num DOUBLE PRECISION,
      unit TEXT,
      source_type TEXT DEFAULT 'manual_or_adapter',
      evidence_ref TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS valuation_snapshots (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      observed_at TIMESTAMPTZ,
      metric_name TEXT NOT NULL,
      value_num DOUBLE PRECISION,
      peer_group TEXT,
      source_type TEXT DEFAULT 'manual_or_adapter',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS industry_kpi_observations (
      id BIGSERIAL PRIMARY KEY,
      theme TEXT NOT NULL,
      kpi_name TEXT NOT NULL,
      value_num DOUBLE PRECISION,
      unit TEXT,
      geography TEXT,
      observed_at TIMESTAMPTZ,
      source_type TEXT DEFAULT 'manual_or_adapter',
      evidence_ref TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS filing_evidence (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT,
      company_name TEXT,
      filing_type TEXT,
      filed_at TIMESTAMPTZ,
      section TEXT,
      excerpt TEXT NOT NULL,
      evidence_ref TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS transcript_evidence (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT,
      speaker TEXT,
      transcript_at TIMESTAMPTZ,
      topic TEXT,
      excerpt TEXT NOT NULL,
      evidence_ref TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS patent_research_evidence (
      id BIGSERIAL PRIMARY KEY,
      subject_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      title TEXT NOT NULL,
      published_at TIMESTAMPTZ,
      url TEXT,
      relevance_score DOUBLE PRECISION DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS policy_evidence (
      id BIGSERIAL PRIMARY KEY,
      subject_key TEXT NOT NULL,
      geography TEXT,
      policy_type TEXT,
      title TEXT NOT NULL,
      published_at TIMESTAMPTZ,
      url TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS causal_edges (
      id BIGSERIAL PRIMARY KEY,
      source_node TEXT NOT NULL,
      target_node TEXT NOT NULL,
      mechanism TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'unknown',
      lag_days INTEGER,
      confidence DOUBLE PRECISION DEFAULT 0.5,
      edge_type TEXT NOT NULL DEFAULT 'causal_hypothesis',
      evidence_ids TEXT[] NOT NULL DEFAULT '{}',
      caveat_ids TEXT[] NOT NULL DEFAULT '{}',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS historical_analog_cases (
      id BIGSERIAL PRIMARY KEY,
      subject_key TEXT NOT NULL,
      analog_name TEXT NOT NULL,
      period_start DATE,
      period_end DATE,
      similarity_score DOUBLE PRECISION DEFAULT 0,
      similarity_drivers TEXT[] NOT NULL DEFAULT '{}',
      differences TEXT[] NOT NULL DEFAULT '{}',
      market_outcome TEXT,
      what_broke_the_analogy TEXT,
      invalidating_indicators TEXT[] NOT NULL DEFAULT '{}',
      evidence_ids TEXT[] NOT NULL DEFAULT '{}',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS report_feedback (
      id BIGSERIAL PRIMARY KEY,
      report_id TEXT NOT NULL,
      claim_id TEXT,
      action TEXT NOT NULL,
      reason TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS report_backfill_tasks (
      id BIGSERIAL PRIMARY KEY,
      report_id TEXT,
      subject_key TEXT NOT NULL,
      pack_name TEXT NOT NULL,
      task_type TEXT NOT NULL DEFAULT 'source_query',
      query TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 50,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    ALTER TABLE report_backfill_tasks
      ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0
  `);
  await client.query(`
    ALTER TABLE report_backfill_tasks
      ADD COLUMN IF NOT EXISTS last_attempted_at TIMESTAMPTZ
  `);
  await client.query(`
    ALTER TABLE report_backfill_tasks
      ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ
  `);
  await client.query(`
    ALTER TABLE report_backfill_tasks
      ADD COLUMN IF NOT EXISTS last_error TEXT
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS report_backfill_tasks_pending_dedupe_idx
    ON report_backfill_tasks (subject_key, pack_name, query)
    WHERE status = 'pending'
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS report_backfill_tasks_status_priority_idx
    ON report_backfill_tasks (status, priority DESC, created_at ASC)
  `);
  return { ok: true };
}

function subjectKey(bundle = {}) {
  return slugify(bundle.subject?.subjectId || bundle.subject?.displayName || bundle.subject?.metadata?.theme || bundle.reportType);
}

function subjectDisplay(bundle = {}) {
  return bundle.subject?.displayName || bundle.subject?.subjectId || 'subject';
}

function themeKey(bundle = {}) {
  const meta = bundle.subject?.metadata || {};
  return slugify(meta.theme || meta.themeKey || bundle.metadata?.row?.theme || bundle.metadata?.themeContext?.theme || bundle.subject?.subjectId || bundle.subject?.displayName);
}

function symbolsFromBundle(bundle = {}) {
  if (useScopedIssuerEvidence(bundle)) {
    return unique([
      ...asArray(bundle.metadata?.promotionUniverse),
      bundle.subject?.metadata?.ticker,
      bundle.metadata?.sensitivity?.symbol,
    ]).map((symbol) => String(symbol).toUpperCase()).slice(0, 12);
  }
  return unique([
    ...asArray(bundle.issuerUniverse),
    ...asArray(bundle.metadata?.issuerUniverse),
    ...asArray(bundle.metadata?.candidateIssuerUniverse),
    ...asArray(bundle.metadata?.promotionUniverse),
    ...asArray(bundle.metadata?.issuerDiscoveryMap).map((row) => row?.symbol),
    ...asArray(bundle.marketReactions).map((reaction) => reaction.symbol),
    ...asArray(bundle.metadata?.themeContext?.peerSymbols?.positive).map((row) => row.symbol),
    ...asArray(bundle.metadata?.themeContext?.peerSymbols?.negative).map((row) => row.symbol),
    bundle.subject?.metadata?.ticker,
    bundle.metadata?.sensitivity?.symbol,
  ]).map((symbol) => String(symbol).toUpperCase()).slice(0, 12);
}

function issuerSymbolsFromBundle(bundle = {}, symbols = []) {
  if (useScopedIssuerEvidence(bundle)) {
    return filterIssuerSymbols(unique([
      ...strictOntologyIssuerSymbols(bundle),
      ...asArray(bundle.metadata?.promotionUniverse),
      ...inferredIssuerSymbolsFromEvidence(bundle),
    ]));
  }
  return filterIssuerSymbols(unique([
    ...asArray(symbols),
    ...symbolsFromBundle(bundle),
    ...asArray(bundle.metadata?.promotionUniverse),
  ]));
}

function evidence(id, title, metadata = {}) {
  return {
    evidenceId: id,
    kind: 'calculated',
    publisher: metadata.publisher || 'Lattice Research OS',
    title,
    freshnessStatus: metadata.freshnessStatus || 'fresh',
    evidenceGrade: metadata.evidenceGrade || 'calculated',
    sourceQualityScore: metadata.sourceQualityScore ?? 0.72,
    metadata,
  };
}

function metric(metricId, kind, name, value, unit, metadata = {}) {
  return { metricId, kind, name, value, unit, metadata };
}

function caveat(caveatId, type, text, severity = 'medium') {
  return { caveatId, type, text, severity, appliesToClaimIds: ['CLM-DEEP-RESEARCH'] };
}

function watch(watchId, label, source, metadata = {}) {
  return {
    watchId,
    label,
    threshold: metadata.threshold || 'evidence_count>=1',
    direction: metadata.direction || 'at_or_above',
    source,
    horizon: metadata.horizon || 'next research cycle',
    claimIds: ['CLM-DEEP-RESEARCH'],
    metadata,
  };
}

function packAvailable(rows = [], fallbackCount = 0) {
  return rows.length > 0 || fallbackCount > 0;
}

function isFrontierParentScopedBundle(bundle = {}) {
  const summary = bundle.metadata?.candidate?.evidence_summary || bundle.metadata?.candidate?.evidenceSummary || {};
  const metadata = bundle.metadata?.candidate?.metadata || {};
  const discovery = bundle.subject?.metadata?.discovery || {};
  const subjectKey = String(bundle.subject?.subjectId || bundle.subject?.metadata?.candidateId || discovery.adjacentCandidateKey || '').trim().toLowerCase();
  return Boolean(
    summary.frontierParentCollectionEligible
    || summary.frontierParentReportReady
    || metadata.frontierParentCollectionEligible
    || metadata.frontierParentReportReady
    || subjectKey.startsWith('endogenous-frontier-parent-')
  );
}

function useScopedIssuerEvidence(bundle = {}) {
  return isStrictEndogenousBundle(bundle) || isFrontierParentScopedBundle(bundle);
}

function strictEvidenceRowPasses(bundle = {}, row = {}) {
  if (!useScopedIssuerEvidence(bundle)) return true;
  const classified = classifyCrossThemeEvidence(row, bundle);
  return classified.bodyEligible || classified.promotionEligible;
}

function strictEvidenceRows(bundle = {}, rows = []) {
  return useScopedIssuerEvidence(bundle)
    ? asArray(rows).filter((row) => strictEvidenceRowPasses(bundle, row))
    : asArray(rows);
}

function strictIssuerDiscoveryRows(bundle = {}, rowGroups = {}) {
  if (!useScopedIssuerEvidence(bundle)) return rowGroups;
  if (isFrontierParentScopedBundle(bundle)) {
    return rowGroups;
  }
  const filterRows = (rows = []) => strictEvidenceRows(bundle, rows);
  return Object.fromEntries(Object.entries(rowGroups).map(([key, value]) => [key, filterRows(value)]));
}

function strictEvidenceMatrixPacks(bundle = {}, packs = {}) {
  if (!useScopedIssuerEvidence(bundle)) return packs;
  const filtered = {};
  for (const [packName, pack] of Object.entries(packs || {})) {
    if (!pack || typeof pack !== 'object') {
      filtered[packName] = pack;
      continue;
    }
    filtered[packName] = {
      ...pack,
      rows: strictEvidenceRows(bundle, pack.rows),
      fundamentals: strictEvidenceRows(bundle, pack.fundamentals),
      valuations: strictEvidenceRows(bundle, pack.valuations),
      cards: [],
      edges: [],
      analogues: strictEvidenceRows(bundle, pack.analogues),
    };
  }
  return filtered;
}

function issuerDiscoveryCandidateUniverse(bundle = {}) {
  if (!useScopedIssuerEvidence(bundle)) {
    return [
      ...asArray(bundle.metadata?.candidateIssuerUniverse),
      ...asArray(bundle.metadata?.issuerUniverse),
      ...asArray(bundle.issuerUniverse),
    ];
  }
  return issuerSymbolsFromBundle(bundle);
}

function normalizedBackfillPackName(value = '') {
  const packName = String(value || '').trim();
  if (packName === 'marketValidationPack') return 'marketPack';
  return packName;
}

function researchEvidenceUse(row = {}) {
  return String(row.metadata?.evidenceUse || row.metadata?.memoryTier || row.evidenceUse || '').trim();
}

function evidenceClassPackName(evidenceClass = '') {
  const key = String(evidenceClass || '').trim();
  return normalizedBackfillPackName(EVIDENCE_CLASS_PROFILES[key]?.dataPack || '');
}

function researchEvidenceBackfillPackName(row = {}) {
  const metadata = row.metadata || {};
  const explicit = normalizedBackfillPackName(
    metadata.reportBackfillPackName
    || metadata.packName
    || metadata.dataPack
    || metadata.pack
    || metadata.providerRoutePlan?.dataPack
    || ''
  );
  if (explicit) return explicit;
  return evidenceClassPackName(metadata.desiredEvidenceClass || metadata.evidenceClass || row.desiredEvidenceClass || row.evidenceClass);
}

function reportBackfillRowsForPack(rows = {}, packName) {
  return asArray(rows.research)
    .filter((row) => researchEvidenceBackfillPackName(row) === packName)
    .filter((row) => !['weak_noise', 'rejected'].includes(researchEvidenceUse(row)))
    .map((row) => ({
      ...row,
      desiredEvidenceClass: row.desiredEvidenceClass || row.metadata?.desiredEvidenceClass || row.metadata?.evidenceClass || null,
      evidenceUse: researchEvidenceUse(row) || null,
      source_type: row.source_type || 'report_backfill_source_query',
      metadata: {
        ...(row.metadata || {}),
        reportBackfillPackEvidence: true,
      },
    }));
}

function adjacentLaneKeyFromBundle(bundle = {}) {
  return compactText(
    bundle.subject?.metadata?.discovery?.adjacentLane
    || bundle.subject?.metadata?.adjacentLane
    || bundle.metadata?.adjacentLane
    || bundle.metadata?.candidate?.adjacentLane
    || '',
  );
}

function adjacentCandidateKeyFromBundle(bundle = {}) {
  return compactText(
    bundle.subject?.metadata?.discovery?.adjacentCandidateKey
    || bundle.subject?.metadata?.adjacentCandidateKey
    || bundle.subject?.metadata?.candidateId
    || bundle.subject?.subjectId
    || '',
  );
}

function adjacentLanePlaybookFromBundle(bundle = {}) {
  const laneKey = adjacentLaneKeyFromBundle(bundle);
  if (!laneKey && !String(adjacentCandidateKeyFromBundle(bundle)).startsWith('adjacent-')) return null;
  return asArray(ADJACENT_LANE_PLAYBOOKS).find((lane) => lane.lane === laneKey)
    || asArray(ADJACENT_LANE_PLAYBOOKS).find((lane) => adjacentCandidateKeyFromBundle(bundle).includes(lane.lane))
    || null;
}

function rowTextForAdjacentFit(row = {}) {
  const metadata = row.metadata || {};
  return compactText([
    row.title,
    row.excerpt,
    row.fact_text,
    row.factText,
    row.summary,
    row.source_type,
    row.source,
    row.publisher,
    metadata.title,
    metadata.excerpt,
    metadata.source,
    metadata.provider,
    metadata.publisher,
    metadata.sourceType,
  ].filter(Boolean).join(' '));
}

function adjacentLaneTermHit(row = {}, lane = null) {
  if (!lane) return false;
  const text = rowTextForAdjacentFit(row).toLowerCase();
  return asArray(lane.terms).some((term) => {
    const normalized = compactText(term).toLowerCase();
    if (!normalized) return false;
    if (normalized.length >= 8 && text.includes(normalized)) return true;
    const words = normalized.split(/\s+/).filter((word) => word.length >= 4);
    return words.length > 0 && words.every((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(text));
  });
}

function adjacentRowMetadataFactKeys(row = {}) {
  const genericFactKeys = new Set([
    'generic_power_term',
    'generic_supplier_or_bottleneck',
    'generic_bottleneck_or_supplier',
    'generic_propulsion_term',
    'generic_subject_reference',
    'technical_term',
    'direct_subject_link',
  ]);
  return unique([
    ...asArray(row.metadata?.factKeys),
    ...asArray(row.factKeys),
    ...asArray(row.metadata?.factsExtracted).map((fact) => fact?.key || fact),
    ...asArray(row.factsExtracted).map((fact) => fact?.key || fact),
  ])
    .filter(Boolean)
    .filter((key) => !genericFactKeys.has(String(key || '').trim()));
}

function adjacentResearchEvidenceClasses(row = {}, lane = null) {
  const explicit = unique([
    row.desiredEvidenceClass,
    row.evidenceClass,
    row.metadata?.desiredEvidenceClass,
    row.metadata?.evidenceClass,
  ].map((item) => String(item || '').trim()).filter(Boolean));
  return explicit.length ? explicit : unique(asArray(lane?.evidenceClasses).map((item) => String(item || '').trim()).filter(Boolean));
}

function adjacentRowHasClassFacts(row = {}, lane = null) {
  const metadataSpecificFacts = adjacentRowMetadataFactKeys(row);
  const text = rowTextForAdjacentFit(row);
  const classes = adjacentResearchEvidenceClasses(row, lane);
  return metadataSpecificFacts.length > 0 || classes.some((evidenceClass) => {
    const result = extractFactsForEvidenceClass(evidenceClass, {
      text,
      title: row.title,
      textExcerpt: row.excerpt || row.fact_text || row.factText,
      sourceType: row.source_type,
      metadata: {
        source: row.metadata?.source,
        provider: row.metadata?.provider,
        publisher: row.metadata?.publisher,
        url: row.metadata?.url || row.evidence_ref,
      },
    });
    return asArray(result.factsExtracted).length > 0;
  });
}

function rowMatchesReportScope(bundle = {}, row = {}) {
  const metadata = row.metadata || {};
  const keys = unique([
    subjectKey(bundle),
    bundle.subject?.subjectId,
    bundle.subject?.metadata?.candidateId,
    bundle.subject?.metadata?.discovery?.adjacentCandidateKey,
  ].map((item) => compactText(item)));
  const labels = unique([
    subjectDisplay(bundle),
    bundle.subject?.displayName,
  ].map((item) => compactText(item).toLowerCase()));
  const rowKeys = unique([
    metadata.reportSubjectKey,
    metadata.adjacentCandidateKey,
    metadata.subjectKey,
    metadata.candidateId,
  ].map((item) => compactText(item)));
  const rowLabels = unique([
    metadata.reportSubjectDisplay,
    metadata.subjectDisplay,
  ].map((item) => compactText(item).toLowerCase()));
  return rowKeys.some((item) => keys.includes(item))
    || rowLabels.some((item) => labels.includes(item));
}

export function adjacentResearchRowFitsBundle(bundle = {}, row = {}) {
  const lane = adjacentLanePlaybookFromBundle(bundle);
  if (!lane) return true;
  const use = researchEvidenceUse(row);
  if (['weak_noise', 'rejected'].includes(use)) return false;
  if (rowMatchesReportScope(bundle, row) && (
    row.metadata?.reportBackfillPackName
    || row.metadata?.packName
    || row.metadata?.marketValidation
    || row.metadata?.providerRoutePlan
    || row.metadata?.desiredEvidenceClass
  )) return true;
  const hasFacts = adjacentRowHasClassFacts(row, lane);
  const laneHit = adjacentLaneTermHit(row, lane);
  if (!laneHit) return false;
  if (row.metadata?.promotionEligible === true || row.promotionEligible === true || use === 'promotion_candidate') {
    return true;
  }
  if (use === 'supporting_context' || row.metadata?.reportBackfillPackName || row.metadata?.approvalId) {
    return true;
  }
  return hasFacts;
}

export function filterVisibleResearchRows(bundle = {}, researchRows = []) {
  return asArray(researchRows).filter((row) => adjacentResearchRowFitsBundle(bundle, row));
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function humanizeSlug(value) {
  return compactText(String(value || '').replace(/[-_/]+/g, ' '));
}

function regexEscape(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordsFromText(value = '') {
  return compactText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
}

const GENERIC_EVIDENCE_STOPWORDS = new Set([
  'report',
  'theme',
  'cross',
  'bottleneck',
  'generated',
  'adjacent',
  'evidence',
  'candidate',
  'subject',
  'research',
  'source',
  'sources',
  'market',
  'sector',
  'industry',
]);

function evidenceDiscoveryTermsFromBundle(bundle = {}, search = searchTermsFromBundle(bundle)) {
  const metadata = bundle.subject?.metadata || {};
  const discovery = metadata.discovery || {};
  const adjacent = bundle.metadata?.adjacentCandidate || {};
  const adjacentMetadata = adjacent.metadata || {};
  const ontology = bundle.metadata?.deepResearch?.ontologyPack || {};
  const contextText = compactText([
    search.display,
    search.key,
    search.theme,
    metadata.theme,
    metadata.themeKey,
    discovery.ontologyKey,
    discovery.connector,
    discovery.adjacentLane,
    adjacent.lane,
    adjacent.generated_lane,
    adjacentMetadata.generatedLane,
  ].join(' ')).toLowerCase();
  const quotedQueries = asArray(discovery.sourceQueries).flatMap((query) => (
    [...String(query || '').matchAll(/"([^"]+)"/g)].map((match) => match[1])
  ));
  const rawTerms = [
    ...asArray(search.terms),
    search.display,
    search.key,
    search.theme,
    discovery.ontologyKey,
    discovery.connector,
    discovery.adjacentLane,
    ...asArray(discovery.triggerTerms),
    ...quotedQueries,
    ...asArray(adjacent.source_terms),
    ...asArray(adjacentMetadata.sourceTerms),
    ...asArray(adjacentMetadata.source_terms),
    ontology.ontologyKey,
    ontology.ontologyLabel,
    ...asArray(ontology.anchorFitRules?.highTerms),
    ...asArray(ontology.anchorFitRules?.mediumTerms),
    ...asArray(ontology.kpis).flatMap((kpi) => [kpi.displayName, kpi.kpiKey, ...asArray(kpi.queryTerms)]),
    ...asArray(ontology.missingKpis).flatMap((kpi) => [kpi.displayName, kpi.kpiKey, ...asArray(kpi.queryTerms)]),
  ];
  const contextualTerms = [];
  if (/\b(ai|machine learning|data.?center|cloud|accelerator|gpu|compute|interconnection|grid|power|utility)\b/i.test(contextText)) {
    contextualTerms.push(
      'data center',
      'datacenter',
      'cloud infrastructure',
      'ai infrastructure',
      'compute infrastructure',
      'gpu',
      'accelerator',
      'server',
      'capex',
      'capital expenditure',
      'power capacity',
      'energy contract',
      'megawatt',
      'mwh',
      'grid',
      'interconnection',
      'interconnection queue',
      'transmission',
      'substation',
      'utility',
      'large load',
    );
  }
  if (/\b(space|launch|satellite|rocket|propulsion|mission|range)\b/i.test(contextText)) {
    contextualTerms.push('launch', 'propulsion', 'mission support', 'range', 'ground system', 'qualification', 'test');
  }
  if (/\b(defense|missile|munition|interceptor|procurement|dod)\b/i.test(contextText)) {
    contextualTerms.push('procurement', 'contract award', 'budget', 'supplier capacity', 'qualification', 'sole source');
  }
  if (/\b(semiconductor|semis|fab|wafer|foundry|packaging|memory)\b/i.test(contextText)) {
    contextualTerms.push('fab', 'wafer', 'foundry', 'capacity', 'orders', 'backlog', 'tooling', 'packaging');
  }
  if (/\b(clean energy|battery|solar|wind|hydrogen|grid|utility|transmission)\b/i.test(contextText)) {
    contextualTerms.push('grid', 'transmission', 'interconnection', 'battery', 'solar', 'wind', 'utility', 'capacity');
  }
  if (/\b(cyber|security|ransomware|identity|zero trust)\b/i.test(contextText)) {
    contextualTerms.push('customer', 'contract', 'arr', 'net retention', 'incident', 'identity', 'cloud security');
  }
  const directTerms = unique([...rawTerms, ...contextualTerms])
    .map(compactText)
    .filter((term) => {
      if (term.length < 3 || term.length > 80) return false;
      const normalized = term.toLowerCase();
      if (GENERIC_EVIDENCE_STOPWORDS.has(normalized)) return false;
      const tokens = wordsFromText(term).filter((word) => !GENERIC_EVIDENCE_STOPWORDS.has(word));
      return tokens.length >= 1 && (tokens.length >= 2 || tokens[0].length >= 4);
    });
  const tokenTerms = unique(directTerms
    .flatMap((term) => wordsFromText(term))
    .filter((word) => !GENERIC_EVIDENCE_STOPWORDS.has(word))
    .filter((word) => word.length >= 5));
  return unique([
    ...directTerms,
    ...tokenTerms,
  ]).slice(0, 90);
}

function evidenceDiscoveryRegex(bundle = {}, search = searchTermsFromBundle(bundle)) {
  const terms = evidenceDiscoveryTermsFromBundle(bundle, search)
    .map((term) => regexEscape(term))
    .filter(Boolean);
  const fallback = [
    'capacity',
    'demand',
    'supplier',
    'backlog',
    'orders',
    'revenue',
    'guidance',
    'contract',
    'customer',
    'capex',
    'capital expenditure',
    'infrastructure',
    'interconnection',
    'transmission',
  ];
  return `(${(terms.length ? terms : fallback.map(regexEscape)).join('|')})`;
}

function searchTermsFromBundle(bundle = {}) {
  const display = subjectDisplay(bundle);
  const key = subjectKey(bundle);
  const theme = themeKey(bundle);
  const metadata = bundle.subject?.metadata || {};
  const discovery = metadata.discovery || {};
  const rawSubjectId = compactText(bundle.subject?.subjectId || bundle.subject?.subject_id || '');
  const adjacentKey = metadata.adjacentCandidateKey || discovery.adjacentCandidateKey || metadata.candidateId || null;
  const contextText = compactText([
    display,
    rawSubjectId,
    metadata.theme,
    metadata.themeKey,
    metadata.connector,
    discovery.connector,
    discovery.ontologyKey,
    discovery.adjacentLane,
    ...asArray(discovery.triggerTerms),
  ].join(' '));
  const aliasKeys = [];
  if (/\b(ai|machine learning|data.?center|cloud|accelerator|gpu|interconnection|grid|power|cooling|utility)\b/i.test(contextText)) {
    aliasKeys.push('ai-ml', 'cloud-infrastructure', 'data_center_infrastructure');
  }
  if (/\b(space|launch|satellite|rocket|propulsion|mission|range)\b/i.test(contextText)) {
    aliasKeys.push('space', 'space-economy', 'launch-infrastructure');
  }
  if (/\b(defense|missile|munition|interceptor|procurement|dod)\b/i.test(contextText)) {
    aliasKeys.push('defense', 'defense-industrial');
  }
  if (/\b(semiconductor|semis|fab|wafer|foundry|packaging|memory)\b/i.test(contextText)) {
    aliasKeys.push('semiconductors', 'semiconductor');
  }
  if (/\b(clean energy|battery|solar|wind|hydrogen|grid|utility|transmission)\b/i.test(contextText)) {
    aliasKeys.push('clean-energy', 'utilities');
  }
  if (/\b(cyber|security|ransomware|zero trust|identity)\b/i.test(contextText)) {
    aliasKeys.push('cybersecurity');
  }
  const exactKeys = unique([
    key,
    theme,
    display,
    rawSubjectId,
    metadata.candidateId,
    metadata.adjacentCandidateKey,
    discovery.adjacentCandidateKey,
    bundle.metadata?.adjacentCandidateKey,
    bundle.metadata?.resolvedSubjectKey,
    ...aliasKeys,
  ].map(compactText).filter(Boolean));
  const providerExactKeys = unique([
    key,
    theme,
    display,
    rawSubjectId,
    metadata.candidateId,
    metadata.adjacentCandidateKey,
    discovery.adjacentCandidateKey,
    bundle.metadata?.adjacentCandidateKey,
    bundle.metadata?.resolvedSubjectKey,
  ].map(compactText).filter(Boolean));
  const reportScopedKeys = unique([
    key,
    display,
    rawSubjectId,
    metadata.candidateId,
    metadata.adjacentCandidateKey,
    discovery.adjacentCandidateKey,
    bundle.metadata?.adjacentCandidateKey,
    bundle.metadata?.resolvedSubjectKey,
  ].map(compactText).filter(Boolean));
  const baseTerms = unique([
    display,
    key,
    theme,
    adjacentKey,
    rawSubjectId,
    metadata.theme,
    metadata.themeKey,
    metadata.parentTheme,
    discovery.adjacentLane,
    humanizeSlug(display),
    humanizeSlug(key),
    humanizeSlug(theme),
    ...(asArray(metadata.aliases)),
  ]).map(compactText).filter((term) => term.length >= 3);
  const terms = unique(baseTerms)
    .filter((term) => !/^(cross[_ -]?theme[_ -]?bottleneck[_ -]?report|fundamental|industry|policy|causal|historical|feedback|direct evidence|source diversity)$/i.test(term))
    .slice(0, 12);
  const likePatterns = terms.map((term) => `%${term.replace(/[%_]/g, '')}%`);
  const providerTargetKeyPatterns = providerExactKeys
    .map((term) => `${term.replace(/[%_]/g, '')}::%`)
    .filter((term) => term.length >= 6);
  const themeKeys = unique([
    theme,
    key,
    metadata.theme,
    metadata.themeKey,
    discovery.ontologyKey,
    slugify(metadata.connector || ''),
    slugify(discovery.connector || ''),
    ...aliasKeys,
  ].map(compactText).filter(Boolean));
  return { key, theme, display, exactKeys, providerExactKeys, reportScopedKeys, themeKeys, terms, likePatterns, providerTargetKeyPatterns };
}

async function loadThemeSymbols(client, bundle, { key, theme } = {}) {
  const search = searchTermsFromBundle(bundle);
  const themeKeys = search.themeKeys?.length ? search.themeKeys : [theme, key].filter(Boolean);
  const evidencePattern = evidenceDiscoveryRegex(bundle, search);
  const existing = symbolsFromBundle(bundle);
  const crossThemeSymbols = bundle.reportType === 'cross_theme_bottleneck_report'
    ? crossThemeIssuerUniverse(bundle, {}, {})
    : [];
  const exposureRows = await safeRows(client, 'theme_entity_exposure', `
    SELECT entity_key AS symbol, confidence, relation_type, entity_label
      FROM theme_entity_exposure
     WHERE theme = ANY($1::text[])
       AND entity_type IN ('company', 'equity', 'ticker')
     ORDER BY confidence DESC NULLS LAST, updated_at DESC NULLS LAST
     LIMIT 12
  `, [themeKeys]);
  const regimeRows = await safeRows(client, 'regime_conditional_impact', `
    SELECT symbol, MAX(sample_size) AS sample_size, MAX(ABS(avg_return)) AS impact
      FROM regime_conditional_impact
     WHERE theme = ANY($1::text[])
     GROUP BY symbol
     ORDER BY sample_size DESC NULLS LAST, impact DESC NULLS LAST
     LIMIT 12
  `, [themeKeys]);
  const evidenceDiscoveredSymbols = await safeRows(client, 'transcript_evidence', `
    WITH hits AS (
      SELECT UPPER(symbol) AS symbol,
             COUNT(*) AS hit_count,
             MAX(transcript_at) AS latest_at,
             SUM(CASE WHEN topic ~* $1 OR excerpt ~* $1 THEN 1 ELSE 0 END) AS text_hits,
             SUM(CASE
                   WHEN excerpt ~* '(revenue|segment|backlog|orders|customer|contract|guidance|capex|capital expenditure|capacity|demand|megawatt|mwh|gigawatt|grid|interconnection|transmission|substation|utility|data center|datacenter|cloud|gpu|accelerator|server|infrastructure)' THEN 2
                   ELSE 0
                 END) AS operating_hits,
             SUM(CASE
                   WHEN COALESCE(metadata->>'sourceType', '') ~* '(direct_management_commentary|earnings_release|investor_presentation|transcript)' THEN 1
                   ELSE 0
                 END) AS source_quality_hits
        FROM transcript_evidence
       WHERE symbol IS NOT NULL
         AND symbol <> ''
         AND (topic ~* $1 OR excerpt ~* $1 OR metadata::text ~* $1)
       GROUP BY UPPER(symbol)
    )
    SELECT symbol, hit_count, latest_at,
           (text_hits * 3 + operating_hits + source_quality_hits) AS evidence_score
      FROM hits
     WHERE text_hits > 0
     ORDER BY evidence_score DESC NULLS LAST, hit_count DESC, latest_at DESC NULLS LAST
     LIMIT 20
  `, [evidencePattern]);
  return filterIssuerSymbols(unique([
    ...existing,
    ...crossThemeSymbols,
    ...evidenceDiscoveredSymbols.map((row) => row.symbol),
    ...exposureRows.map((row) => row.symbol),
    ...regimeRows.map((row) => row.symbol),
  ]).map((symbol) => String(symbol).toUpperCase())).slice(0, 32);
}

async function loadOptionalPackRows(client, bundle) {
  if (!client) return {};
  const search = searchTermsFromBundle(bundle);
  const { key, theme, display, exactKeys, providerExactKeys, reportScopedKeys, themeKeys, likePatterns, providerTargetKeyPatterns } = search;
  const evidencePattern = evidenceDiscoveryRegex(bundle, search);
  const symbols = await loadThemeSymbols(client, bundle, { key, theme });
  const kpiState = await loadThemeKpiCollectionState(client, {
    themeId: theme,
    key,
    themeLabel: display,
  }).catch(() => ({ observations: [], definitions: [], maps: [], jobs: [], gaps: [], coverage: null }));
  const symbol = symbols[0] || null;
  const conceptPattern = [
    'Revenue',
    'Sales',
    'Cost',
    'GrossProfit',
    'Operating',
    'Income',
    'Assets',
    'Liabilities',
    'Cash',
    'Debt',
    'Capital',
    'Property',
    'Plant',
    'Equipment',
    'CapitalExpenditure',
    'Capital Expenditure',
    'CapitalExpenditures',
    'PaymentsToAcquire',
    'PurchaseOfProperty',
    'ConstructionInProgress',
    'Research',
    'Development',
    'AccountsPayable',
    'PublicFloat',
  ].join('|');
  const customFundamentals = symbol ? await safeRows(client, 'company_fundamentals', `
      SELECT id::text AS id, symbol, period_end, metric_name, value_num, unit,
             source_type, evidence_ref, metadata, created_at,
             period_end::timestamptz AS observed_at,
             CONCAT(symbol, ' ', metric_name, ' ', COALESCE(period_end::text, 'latest')) AS title,
             CONCAT(symbol, ' reported ', metric_name, ' = ', value_num, COALESCE(' ' || unit, ''), '.') AS fact_text
      FROM company_fundamentals
      WHERE symbol = ANY($1::text[])
      ORDER BY period_end DESC NULLS LAST, created_at DESC
      LIMIT 12
    `, [symbols]) : [];
  const targetedFundamentalPattern = [
    'capital expenditure',
    'capex',
    'operating cash flow',
    'free cash flow',
    'cloud',
    'data center',
    'datacenter',
    'infrastructure',
    'power',
    'electric',
    'mw',
    'megawatt',
    'backlog',
    'orders',
    'revenue',
    'segment',
  ].join('|');
  const targetedFundamentals = symbol ? await safeRows(client, 'company_fundamentals', `
      SELECT id::text AS id, symbol, period_end, metric_name, value_num, unit,
             source_type, evidence_ref, metadata, created_at,
             period_end::timestamptz AS observed_at,
             CONCAT(symbol, ' ', metric_name, ' ', COALESCE(period_end::text, 'latest')) AS title,
             CONCAT(symbol, ' reported ', metric_name, ' = ', value_num, COALESCE(' ' || unit, ''), '.') AS fact_text
      FROM company_fundamentals
      WHERE symbol = ANY($1::text[])
        AND (
          metric_name ~* $2
          OR source_type ~* $2
          OR metadata::text ~* $2
          OR metric_name ~* $3
          OR source_type ~* $3
          OR metadata::text ~* $3
        )
      ORDER BY
        CASE
          WHEN metric_name ~* '(capital expenditure|capex)' THEN 0
          WHEN metadata::text ~* '(capitalExpenditure|capital expenditure|capex)' THEN 1
          WHEN metric_name ~* '(operating cash flow|free cash flow)' THEN 2
          WHEN metric_name ~* '(revenue|sales)' THEN 3
          ELSE 4
        END,
        period_end DESC NULLS LAST,
        created_at DESC
      LIMIT 36
    `, [symbols, targetedFundamentalPattern, evidencePattern]) : [];
  const secFundamentals = symbol ? await safeRows(client, 'sec_companyfacts_facts', `
      SELECT fact_key AS id,
             ticker AS symbol,
             entity_name AS company_name,
             period_end,
             filed_at,
             concept_label AS metric_name,
             numeric_value AS value_num,
             unit,
             source_url AS evidence_ref,
             'sec_companyfacts_facts' AS source_type,
             imported_at AS created_at,
             filed_at::timestamptz AS observed_at,
             CONCAT(ticker, ' ', COALESCE(concept_label, concept), ' ', COALESCE(fiscal_year, ''), ' ', COALESCE(fiscal_period, '')) AS title,
             CONCAT(ticker, ' ', COALESCE(concept_label, concept), ' was ', numeric_value, COALESCE(' ' || unit, ''), ' for ', COALESCE(fiscal_year, ''), ' ', COALESCE(fiscal_period, ''), ' filed in ', COALESCE(form, 'SEC filing'), '.') AS fact_text,
             jsonb_build_object(
               'taxonomy', taxonomy,
               'concept', concept,
               'conceptDescription', concept_description,
               'form', form,
               'fiscalYear', fiscal_year,
               'fiscalPeriod', fiscal_period,
               'frame', frame,
               'accession', accession,
               'adapter', 'sec_companyfacts_facts'
             ) AS metadata
      FROM sec_companyfacts_facts
      WHERE ticker = ANY($1::text[])
        AND numeric_value IS NOT NULL
        AND (concept ~* $2 OR concept_label ~* $2)
      ORDER BY filed_at DESC NULLS LAST, period_end DESC NULLS LAST, imported_at DESC
      LIMIT 24
    `, [symbols, conceptPattern]) : [];
  const quoteValuations = symbol ? await safeRows(client, 'market_quotes', `
      SELECT DISTINCT ON (symbol)
             CONCAT('quote-', symbol) AS id,
             symbol,
             observed_at,
             'latest_price' AS metric_name,
             last_price AS value_num,
             currency AS unit,
             'market_quotes' AS source_type,
             NULL::text AS evidence_ref,
             fetched_at AS created_at,
             CONCAT(symbol, ' latest market quote') AS title,
             CONCAT(symbol, ' last price was ', last_price, COALESCE(' ' || currency, ''), ' with change ', COALESCE(change_pct::text, 'n/a'), '%.') AS fact_text,
             jsonb_build_object('changePct', change_pct, 'provider', provider, 'exchange', exchange, 'adapter', 'market_quotes') AS metadata
        FROM market_quotes
       WHERE symbol = ANY($1::text[])
         AND last_price IS NOT NULL
       ORDER BY symbol, observed_at DESC NULLS LAST, fetched_at DESC NULLS LAST
       LIMIT 12
    `, [symbols]) : [];
  const derivedValuations = [];
  const factsBySymbol = new Map();
  for (const row of secFundamentals) {
    const ticker = String(row.symbol || '').toUpperCase();
    if (!ticker) continue;
    if (!factsBySymbol.has(ticker)) factsBySymbol.set(ticker, []);
    factsBySymbol.get(ticker).push(row);
  }
  for (const quote of quoteValuations) {
    const ticker = String(quote.symbol || '').toUpperCase();
    const facts = factsBySymbol.get(ticker) || [];
    const latest = (pattern) => facts.find((row) => pattern.test(`${row.metric_name || ''} ${row.metadata?.concept || ''}`));
    const shares = latest(/shares outstanding|EntityCommonStockSharesOutstanding/i);
    const revenue = latest(/revenue|sales/i);
    const netIncome = latest(/net income|profit loss|netincome/i);
    const lastPrice = num(quote.value_num, null);
    const shareCount = num(shares?.value_num, null);
    if (lastPrice && shareCount) {
      const marketCap = lastPrice * shareCount;
      derivedValuations.push({
        id: `valuation-market-cap-${ticker}`,
        symbol: ticker,
        observed_at: quote.observed_at,
        metric_name: 'derived_market_cap',
        value_num: marketCap,
        unit: quote.unit || 'USD',
        source_type: 'derived_market_quotes_sec_companyfacts',
        evidence_ref: quote.evidence_ref || shares?.evidence_ref || null,
        created_at: quote.created_at,
        title: `${ticker} derived market capitalization`,
        fact_text: `${ticker} derived market capitalization uses latest market quote and SEC shares outstanding.`,
        metadata: {
          adapter: 'market_quotes+sec_companyfacts_facts',
          price: lastPrice,
          sharesOutstanding: shareCount,
          quoteId: quote.id,
          sharesFactId: shares?.id || null,
        },
      });
      const revenueValue = num(revenue?.value_num, null);
      if (revenueValue && revenueValue !== 0) {
        derivedValuations.push({
          id: `valuation-price-sales-${ticker}`,
          symbol: ticker,
          observed_at: quote.observed_at,
          metric_name: 'derived_price_to_sales',
          value_num: marketCap / revenueValue,
          unit: 'ratio',
          source_type: 'derived_market_quotes_sec_companyfacts',
          evidence_ref: revenue?.evidence_ref || quote.evidence_ref || null,
          created_at: quote.created_at,
          title: `${ticker} derived price-to-sales proxy`,
          fact_text: `${ticker} derived price-to-sales proxy uses market capitalization and latest SEC revenue/sales fact.`,
          metadata: {
            adapter: 'market_quotes+sec_companyfacts_facts',
            marketCap,
            revenue: revenueValue,
            revenueFactId: revenue?.id || null,
          },
        });
      }
      const netIncomeValue = num(netIncome?.value_num, null);
      if (netIncomeValue && netIncomeValue !== 0) {
        derivedValuations.push({
          id: `valuation-price-earnings-${ticker}`,
          symbol: ticker,
          observed_at: quote.observed_at,
          metric_name: 'derived_price_to_earnings',
          value_num: marketCap / netIncomeValue,
          unit: 'ratio',
          source_type: 'derived_market_quotes_sec_companyfacts',
          evidence_ref: netIncome?.evidence_ref || quote.evidence_ref || null,
          created_at: quote.created_at,
          title: `${ticker} derived price-to-earnings proxy`,
          fact_text: `${ticker} derived price-to-earnings proxy uses market capitalization and latest SEC net-income fact.`,
          metadata: {
            adapter: 'market_quotes+sec_companyfacts_facts',
            marketCap,
            netIncome: netIncomeValue,
            netIncomeFactId: netIncome?.id || null,
          },
        });
      }
    }
  }
  const customIndustry = await safeRows(client, 'industry_kpi_observations', `
      SELECT id::text AS id, theme, kpi_key, kpi_name, value_num, unit, geography,
             observed_at, period_start, period_end, source_type, source_id,
             evidence_ref, confidence, freshness_status, metadata, created_at,
             CONCAT(theme, ' ', kpi_name, ' KPI') AS title,
             CONCAT(kpi_name, ' = ', value_num, COALESCE(' ' || unit, ''), COALESCE(' in ' || geography, ''), '.') AS fact_text
      FROM industry_kpi_observations
      WHERE theme = ANY($1::text[])
      ORDER BY observed_at DESC NULLS LAST, created_at DESC
      LIMIT 40
    `, [themeKeys]);
  const curatedIndustry = await safeRows(client, 'daily_curated_news', `
      SELECT id::text AS id,
             theme,
             COALESCE(topic_label, metadata->>'title', one_line_summary) AS title,
             one_line_summary AS fact_text,
             why_it_matters AS excerpt,
             importance_score AS value_num,
             'importance_score' AS unit,
             curated_date::timestamptz AS observed_at,
             metadata->>'url' AS evidence_ref,
             'daily_curated_news' AS source_type,
             metadata || jsonb_build_object(
               'rank', rank,
               'parentTheme', parent_theme,
               'category', category,
               'impactScore', impact_score,
               'freshnessScore', freshness_score,
               'sourceQualityScore', source_quality_score,
               'adapter', 'daily_curated_news'
             ) AS metadata,
             created_at
      FROM daily_curated_news
      WHERE theme = ANY($1::text[])
      ORDER BY curated_date DESC NULLS LAST, importance_score DESC NULLS LAST
      LIMIT 12
    `, [themeKeys]);
  const customFilings = symbol ? await safeRows(client, 'filing_evidence', `
      SELECT id::text AS id, symbol, company_name, filing_type, filed_at,
             section, excerpt, evidence_ref, metadata, created_at,
             CONCAT(symbol, ' ', filing_type, ' ', COALESCE(section, 'filing evidence')) AS title,
             'filing_evidence' AS source_type
      FROM filing_evidence
      WHERE symbol = ANY($1::text[])
      ORDER BY
        CASE
          WHEN excerpt ~* $2 OR section ~* $2 OR metadata::text ~* $2 THEN 0
          ELSE 1
        END,
        filed_at DESC NULLS LAST,
        created_at DESC
      LIMIT 8
    `, [symbols, evidencePattern]) : [];
  const secFilings = symbol ? await safeRows(client, 'sec_filings_evidence', `
      SELECT filing_key AS id,
             ticker AS symbol,
             entity_name AS company_name,
             filing_type,
             filing_date::timestamptz AS filed_at,
             COALESCE(primary_doc_description, primary_document, filing_type) AS section,
             CONCAT(entity_name, ' filed ', filing_type, ' on ', filing_date, COALESCE(' for report date ' || report_date::text, ''), '.') AS excerpt,
             primary_doc_url AS evidence_ref,
             'sec_filings_evidence' AS source_type,
             imported_at AS created_at,
             CONCAT(ticker, ' ', filing_type, ' filing ', COALESCE(primary_doc_description, '')) AS title,
             metadata || jsonb_build_object(
               'accession', accession,
               'reportDate', report_date,
               'acceptedAt', accepted_at,
               'isXbrl', is_xbrl,
               'adapter', 'sec_filings_evidence'
             ) AS metadata
      FROM sec_filings_evidence
      WHERE ticker = ANY($1::text[])
      ORDER BY
        CASE
          WHEN primary_doc_description ~* $2 OR primary_document ~* $2 OR metadata::text ~* $2 THEN 0
          ELSE 1
        END,
        filing_date DESC NULLS LAST,
        accepted_at DESC NULLS LAST,
        imported_at DESC
      LIMIT 16
    `, [symbols, evidencePattern]) : [];
  const transcriptRows = symbol ? await safeRows(client, 'transcript_evidence', `
      WITH deduped_transcripts AS (
        SELECT id::text AS id, symbol, speaker, transcript_at, topic, excerpt,
               evidence_ref, metadata, created_at,
               CONCAT(symbol, ' ', COALESCE(topic, 'transcript evidence')) AS title,
               COALESCE(metadata->>'sourceType', 'transcript_evidence') AS source_type,
               (
                 CASE WHEN topic ~* $2 OR excerpt ~* $2 OR metadata::text ~* $2 THEN 5 ELSE 0 END
                 + CASE WHEN excerpt ~* '(grid|interconnection|transmission|substation|utility|large load|megawatt|mwh|gigawatt|power capacity|energy contract)' THEN 4 ELSE 0 END
                 + CASE WHEN excerpt ~* '(data center|datacenter|cloud infrastructure|ai infrastructure|compute infrastructure|gpu|accelerator|server)' THEN 3 ELSE 0 END
                 + CASE WHEN excerpt ~* '(revenue|segment|backlog|orders|customer|contract|guidance|capex|capital expenditure|capacity|demand|book-to-bill|book to bill)' THEN 2 ELSE 0 END
                 + CASE WHEN COALESCE(metadata->>'sourceType', '') ~* '(direct_management_commentary|earnings_release|investor_presentation|transcript)' THEN 1 ELSE 0 END
               ) AS relevance_score,
               ROW_NUMBER() OVER (
                 PARTITION BY symbol, COALESCE(topic, ''), COALESCE(evidence_ref, '')
                 ORDER BY
                   (
                     CASE WHEN topic ~* $2 OR excerpt ~* $2 OR metadata::text ~* $2 THEN 5 ELSE 0 END
                     + CASE WHEN excerpt ~* '(grid|interconnection|transmission|substation|utility|large load|megawatt|mwh|gigawatt|power capacity|energy contract)' THEN 4 ELSE 0 END
                     + CASE WHEN excerpt ~* '(data center|datacenter|cloud infrastructure|ai infrastructure|compute infrastructure|gpu|accelerator|server)' THEN 3 ELSE 0 END
                     + CASE WHEN excerpt ~* '(revenue|segment|backlog|orders|customer|contract|guidance|capex|capital expenditure|capacity|demand|book-to-bill|book to bill)' THEN 2 ELSE 0 END
                     + CASE WHEN COALESCE(metadata->>'sourceType', '') ~* '(direct_management_commentary|earnings_release|investor_presentation|transcript)' THEN 1 ELSE 0 END
                   ) DESC,
                   transcript_at DESC NULLS LAST,
                   created_at DESC
               ) AS dedupe_rank
        FROM transcript_evidence
        WHERE symbol = ANY($1::text[])
      ),
      ranked_transcripts AS (
        SELECT id, symbol, speaker, transcript_at, topic, excerpt,
               evidence_ref, metadata, created_at, title, source_type, relevance_score,
               ROW_NUMBER() OVER (
                 PARTITION BY symbol
                 ORDER BY relevance_score DESC, transcript_at DESC NULLS LAST, created_at DESC
               ) AS symbol_rank
        FROM deduped_transcripts
        WHERE dedupe_rank = 1
      )
      SELECT id::text AS id, symbol, speaker, transcript_at, topic, excerpt,
             evidence_ref, metadata, created_at,
             title, source_type, relevance_score
      FROM ranked_transcripts
      WHERE symbol_rank <= 5
        AND (relevance_score > 0 OR symbol_rank <= 2)
      ORDER BY relevance_score DESC, symbol, transcript_at DESC NULLS LAST, created_at DESC
      LIMIT 80
    `, [symbols, evidencePattern]) : [];
  const managementProxy = symbol ? await safeRows(client, 'sec_filings_evidence', `
      SELECT filing_key AS id,
             ticker AS symbol,
             entity_name AS company_name,
             accepted_at AS transcript_at,
             CONCAT(filing_type, ' management-commentary proxy') AS topic,
             CONCAT(entity_name, ' ', filing_type, ' filing is used as a management-commentary proxy until a transcript adapter supplies call-level evidence.') AS excerpt,
             primary_doc_url AS evidence_ref,
             'sec_filing_management_proxy' AS source_type,
             metadata || jsonb_build_object(
               'proxyCaveat', 'SEC filing proxy; not an earnings-call transcript',
               'filingType', filing_type,
               'filingDate', filing_date,
               'adapter', 'sec_filings_evidence'
             ) AS metadata,
             imported_at AS created_at,
             CONCAT(ticker, ' ', filing_type, ' management-commentary proxy') AS title
      FROM sec_filings_evidence
      WHERE ticker = ANY($1::text[])
        AND filing_type = ANY($2::text[])
      ORDER BY accepted_at DESC NULLS LAST, filing_date DESC NULLS LAST
      LIMIT 8
    `, [symbols, ['8-K', '10-Q', '10-K']]) : [];
  const customResearch = await safeRows(client, 'patent_research_evidence', `
      SELECT id::text AS id, subject_key, source_type, title, published_at,
             url AS evidence_ref, relevance_score, metadata, created_at,
             title AS fact_text
      FROM patent_research_evidence
      WHERE subject_key = ANY($1::text[])
      ORDER BY relevance_score DESC NULLS LAST, published_at DESC NULLS LAST
      LIMIT 8
    `, [[key, theme]]);
  const researchBundles = await safeRows(client, 'research_evidence_bundles', `
      SELECT reb.id::text AS id,
             COALESCE(reb.source_type, reb.metadata->>'source', 'research_evidence_bundles') AS source_type,
             reb.title,
             reb.text_excerpt AS excerpt,
             reb.text_excerpt AS fact_text,
             reb.url AS evidence_ref,
             reb.published_at,
             reb.relevance_score,
             reb.metadata
               || jsonb_build_object('adapter', 'research_evidence_bundles', 'questionId', reb.question_id)
               || CASE WHEN aq.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
                    'reportId', aq.payload->>'reportId',
                    'reportType', aq.payload->>'reportType',
                    'reportBackfillTaskId', aq.payload->>'reportBackfillTaskId',
                    'reportBackfillPackName', aq.payload->>'packName',
                    'reportSubjectKey', aq.payload->>'subjectKey',
                    'reportSubjectDisplay', aq.payload->'subject'->>'displayName'
                  ) END AS metadata,
             reb.created_at
      FROM research_evidence_bundles reb
      LEFT JOIN approval_queue aq
        ON aq.action_type = 'source-query'
       AND (reb.metadata->>'approvalId') ~ '^[0-9]+$'
       AND aq.id = (reb.metadata->>'approvalId')::bigint
      WHERE (
           COALESCE(reb.metadata->>'theme', '') = ANY($1::text[])
        OR reb.metadata->>'reportId' = $2::text
        OR reb.metadata->>'latestReportId' = $2::text
        OR reb.metadata->>'reportSubjectKey' = ANY($1::text[])
        OR reb.metadata->>'adjacentCandidateKey' = ANY($1::text[])
        OR aq.payload->>'subjectKey' = ANY($1::text[])
      )
      AND NOT (
           COALESCE(reb.metadata->>'reportSubjectKey', aq.payload->>'subjectKey', '') ILIKE 'NO-MATCH-%'
        OR COALESCE(reb.metadata->>'reportSubjectDisplay', aq.payload->'subject'->>'displayName', '') ILIKE 'No cross theme bottleneck report bound%'
        OR COALESCE(reb.metadata->>'reportId', reb.metadata->>'latestReportId', '') ILIKE '%no-match%'
      )
      AND reb.source_type IS DISTINCT FROM 'local-market-validation'
      ORDER BY
        CASE
          WHEN reb.source_type = 'public_planning_source'
            AND COALESCE(reb.metadata->>'evidenceUse', '') NOT IN ('weak_noise', 'rejected') THEN 0
          WHEN reb.source_type IN ('dod_contract_awards', 'usaspending_contract_awards')
            AND COALESCE(reb.metadata->>'evidenceUse', '') NOT IN ('weak_noise', 'rejected') THEN 1
          WHEN reb.source_type ~* '(sec|fmp|eia|fred|polygon|filing|transcript)'
            AND COALESCE(reb.metadata->>'evidenceUse', '') NOT IN ('weak_noise', 'rejected') THEN 2
          WHEN reb.metadata ? 'providerRoutePlan'
            AND COALESCE(reb.metadata->>'evidenceUse', '') NOT IN ('weak_noise', 'rejected') THEN 3
          WHEN reb.metadata ? 'marketValidation' THEN 3
          WHEN reb.metadata->>'desiredEvidenceClass' = 'market_validation' THEN 4
          WHEN COALESCE(reb.metadata->>'reportBackfillPackName', reb.metadata->>'packName', aq.payload->>'packName') IS NULL THEN 5
          ELSE 4
        END,
        reb.relevance_score DESC NULLS LAST,
        reb.published_at DESC NULLS LAST,
        reb.created_at DESC
      LIMIT 180
    `, [exactKeys, bundle.reportId || '']);
  const marketValidationBundles = await safeRows(client, 'research_evidence_bundles', `
      SELECT reb.id::text AS id,
             COALESCE(reb.source_type, reb.metadata->>'source', 'local-market-validation') AS source_type,
             reb.title,
             reb.text_excerpt AS excerpt,
             reb.text_excerpt AS fact_text,
             reb.url AS evidence_ref,
             reb.published_at,
             reb.relevance_score,
             reb.metadata || jsonb_build_object('adapter', 'research_evidence_bundles') AS metadata,
             reb.created_at
      FROM research_evidence_bundles reb
      WHERE reb.source_type = 'local-market-validation'
        AND (
             reb.metadata->>'reportId' = $2::text
          OR reb.metadata->>'latestReportId' = $2::text
          OR reb.metadata->>'reportSubjectKey' = ANY($1::text[])
          OR reb.metadata->>'adjacentCandidateKey' = ANY($1::text[])
        )
        AND COALESCE(reb.metadata->>'evidenceUse', '') NOT IN ('rejected')
      ORDER BY
        CASE WHEN COALESCE(reb.metadata->>'evidenceUse', '') = 'promotion_candidate' THEN 0 ELSE 1 END,
        reb.relevance_score DESC NULLS LAST,
        reb.created_at DESC
      LIMIT 80
    `, [exactKeys, bundle.reportId || '']);
  const openAlexRows = await safeRows(client, 'openalex_theme_evidence', `
      SELECT evidence_key AS id,
             'openalex_theme_evidence' AS source_type,
             title,
             abstract_excerpt AS excerpt,
             abstract_excerpt AS fact_text,
             COALESCE(source_url, openalex_url, doi) AS evidence_ref,
             publication_date::timestamptz AS published_at,
             relevance_score,
             jsonb_build_object(
               'theme', theme,
               'workId', work_id,
               'citedByCount', cited_by_count,
               'primarySource', primary_source,
               'authors', authors,
               'concepts', concepts,
               'matchedKeywords', matched_keywords,
               'adapter', 'openalex_theme_evidence'
             ) AS metadata,
             imported_at AS created_at
      FROM openalex_theme_evidence
      WHERE theme = ANY($1::text[])
         OR title ILIKE ANY($2::text[])
         OR abstract_excerpt ILIKE ANY($2::text[])
      ORDER BY relevance_score DESC NULLS LAST, cited_by_count DESC NULLS LAST, publication_date DESC NULLS LAST
      LIMIT 8
    `, [[theme, key], likePatterns]);
  const themeOpenAlexRows = await safeRows(client, 'theme_openalex_evidence', `
      SELECT evidence_key AS id,
             'theme_openalex_evidence' AS source_type,
             COALESCE(metadata->>'title', work_id) AS title,
             evidence_note AS excerpt,
             evidence_note AS fact_text,
             work_id AS evidence_ref,
             publication_date::timestamptz AS published_at,
             research_signal_score AS relevance_score,
             metadata || jsonb_build_object(
               'theme', theme,
               'workId', work_id,
               'citedByCount', cited_by_count,
               'conceptOverlap', concept_overlap,
               'matchedKeywords', matched_keywords,
               'adapter', 'theme_openalex_evidence'
             ) AS metadata,
             imported_at AS created_at
      FROM theme_openalex_evidence
      WHERE theme = ANY($1::text[])
         OR evidence_note ILIKE ANY($2::text[])
         OR search_query ILIKE ANY($2::text[])
      ORDER BY research_signal_score DESC NULLS LAST, cited_by_count DESC NULLS LAST, publication_date DESC NULLS LAST
      LIMIT 8
    `, [[theme, key], likePatterns]);
  const githubRows = await safeRows(client, 'theme_github_evidence', `
      SELECT evidence_key AS id,
             'theme_github_evidence' AS source_type,
             COALESCE(repo.full_name, theme_github_evidence.repo_key) AS title,
             theme_github_evidence.evidence_note AS excerpt,
             theme_github_evidence.evidence_note AS fact_text,
             repo.html_url AS evidence_ref,
             theme_github_evidence.pushed_at AS published_at,
             theme_github_evidence.github_signal_score AS relevance_score,
             theme_github_evidence.metadata || jsonb_build_object(
               'theme', theme_github_evidence.theme,
               'repoKey', theme_github_evidence.repo_key,
               'stargazersCount', theme_github_evidence.stargazers_count,
               'matchedKeywords', theme_github_evidence.matched_keywords,
               'adapter', 'theme_github_evidence'
             ) AS metadata,
             theme_github_evidence.imported_at AS created_at
      FROM theme_github_evidence
      LEFT JOIN github_repositories repo USING (repo_key)
      WHERE theme_github_evidence.theme = ANY($1::text[])
         OR theme_github_evidence.evidence_note ILIKE ANY($2::text[])
         OR COALESCE(repo.description, '') ILIKE ANY($2::text[])
      ORDER BY theme_github_evidence.github_signal_score DESC NULLS LAST,
               theme_github_evidence.stargazers_count DESC NULLS LAST,
               theme_github_evidence.pushed_at DESC NULLS LAST
      LIMIT 8
    `, [[theme, key], likePatterns]);
  const policyRows = await safeRows(client, 'daily_curated_news', `
      SELECT id::text AS id,
             theme,
             COALESCE(topic_label, metadata->>'title', one_line_summary) AS title,
             one_line_summary AS fact_text,
             why_it_matters AS excerpt,
             curated_date::timestamptz AS published_at,
             metadata->>'url' AS evidence_ref,
             'daily_curated_news_policy_proxy' AS source_type,
             importance_score AS relevance_score,
             metadata || jsonb_build_object(
               'rank', rank,
               'parentTheme', parent_theme,
               'category', category,
               'policyProxy', true,
               'adapter', 'daily_curated_news'
             ) AS metadata,
             created_at
      FROM daily_curated_news
      WHERE theme = ANY($1::text[])
        AND (
          one_line_summary ~* $2
          OR why_it_matters ~* $2
          OR COALESCE(metadata->>'title', '') ~* $2
        )
      ORDER BY curated_date DESC NULLS LAST, importance_score DESC NULLS LAST
      LIMIT 8
    `, [[theme, key], 'policy|regulat|government|federal|subsid|sanction|procurement|award|contract|agency|law|tariff|tax|public|state|national|defense|department|ministry|program']);
  const trendHistory = await safeRows(client, 'theme_trend_aggregates', `
      SELECT CONCAT(theme, '::', period_type, '::', period_start::text) AS id,
             theme,
             theme_label,
             parent_theme,
             category,
             period_type,
             period_start,
             period_end,
             article_count,
             unique_sources,
             source_diversity,
             vs_previous_period_pct,
             vs_year_ago_pct,
             trend_acceleration,
             lifecycle_stage,
             lifecycle_confidence,
             metadata,
             computed_at
      FROM theme_trend_aggregates
      WHERE theme = ANY($1::text[])
      ORDER BY period_end DESC NULLS LAST, computed_at DESC NULLS LAST
      LIMIT 36
    `, [themeKeys]);
  const trendKpis = trendHistory.slice(0, 12).map((row) => ({
    id: row.id,
    theme: row.theme,
    kpi_name: `${row.period_type || 'period'} trend aggregate`,
    value_num: row.article_count,
    unit: 'articles',
    geography: null,
    observed_at: row.period_end || row.computed_at,
    source_type: 'theme_trend_aggregates',
    evidence_ref: null,
    title: `${row.theme_label || row.theme} ${row.period_type || 'period'} trend aggregate`,
    fact_text: `${row.theme_label || row.theme} logged ${row.article_count ?? 0} items in the ${row.period_type || 'period'} window with source diversity ${row.source_diversity ?? 'n/a'}.`,
    metadata: {
      parentTheme: row.parent_theme,
      category: row.category,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      uniqueSources: row.unique_sources,
      sourceDiversity: row.source_diversity,
      vsPreviousPeriodPct: row.vs_previous_period_pct,
      vsYearAgoPct: row.vs_year_ago_pct,
      trendAcceleration: row.trend_acceleration,
      lifecycleStage: row.lifecycle_stage,
      lifecycleConfidence: row.lifecycle_confidence,
      adapter: 'theme_trend_aggregates',
    },
    created_at: row.computed_at,
  }));
  const includeBackfillQueueRows = process.env.REPORT_DEEP_PACK_INCLUDE_BACKFILL_ROWS === '1';
  const reportBackfillTasks = includeBackfillQueueRows ? await safeRows(client, 'report_backfill_tasks', `
      SELECT id::text AS id, report_id, subject_key, pack_name, task_type, query, status, priority, metadata, created_at, updated_at
      FROM report_backfill_tasks
      WHERE report_id = $1
      ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, priority DESC
      LIMIT 80
    `, [bundle.reportId || '']) : [];
  const sourceQueryApprovals = includeBackfillQueueRows ? await safeRows(client, 'approval_queue', `
      SELECT id::text AS id, payload, status, reasoning, created_at, reviewed_at
      FROM approval_queue
      WHERE action_type = 'source-query'
        AND (
          payload->>'reportId' = $1
          OR payload->>'latestReportId' = $1
        )
        AND NOT (
             COALESCE(payload->>'subjectKey', '') ILIKE 'NO-MATCH-%'
          OR COALESCE(payload->>'reportId', payload->>'latestReportId', '') ILIKE '%no-match%'
          OR COALESCE(payload->'subject'->>'displayName', '') ILIKE 'No cross theme bottleneck report bound%'
        )
      ORDER BY COALESCE(reviewed_at, created_at) DESC NULLS LAST
      LIMIT 80
    `, [bundle.reportId || '']) : [];
  const providerRunRows = includeBackfillQueueRows ? await safeRows(client, 'external_provider_backfill_runs', `
      SELECT *
      FROM external_provider_backfill_runs
      WHERE (
           summary->'target'->>'reportId' = $1
        OR summary->'target'->>'latestReportId' = $1
        OR summary->'target'->>'report_id' = $1
        OR summary->'target'->>'subjectKey' = ANY($2::text[])
        OR target_key = ANY($2::text[])
        OR target_key LIKE ANY($3::text[])
      )
      ORDER BY created_at DESC
      LIMIT 80
    `, [bundle.reportId || '', providerExactKeys, providerTargetKeyPatterns]) : [];
  return {
    atomicFacts: await safeRows(client, 'research_atomic_facts', `
      SELECT * FROM research_atomic_facts
      WHERE subject_key = $1 OR subject_key = $2
      ORDER BY observed_at DESC NULLS LAST, created_at DESC
      LIMIT 12
    `, [key, theme]),
    fundamentals: [...targetedFundamentals, ...customFundamentals, ...secFundamentals],
    valuations: [
      ...(symbol ? await safeRows(client, 'valuation_snapshots', `
      SELECT * FROM valuation_snapshots
      WHERE symbol = ANY($1::text[])
      ORDER BY observed_at DESC NULLS LAST, created_at DESC
      LIMIT 12
    `, [symbols]) : []),
      ...derivedValuations,
      ...quoteValuations,
    ],
    industry: [...customIndustry, ...curatedIndustry, ...trendKpis],
    filings: [...customFilings, ...secFilings],
    transcripts: [...transcriptRows, ...managementProxy],
    research: [...marketValidationBundles, ...customResearch, ...researchBundles, ...openAlexRows, ...themeOpenAlexRows, ...githubRows],
    policy: [
      ...(await safeRows(client, 'policy_evidence', `
      SELECT * FROM policy_evidence
      WHERE subject_key = $1 OR subject_key = $2
      ORDER BY published_at DESC NULLS LAST, created_at DESC
      LIMIT 8
    `, [key, theme])),
      ...policyRows,
    ],
    causalEdges: await safeRows(client, 'causal_edges', `
      SELECT * FROM causal_edges
      WHERE source_node = $1 OR target_node = $1 OR source_node = $2 OR target_node = $2
      ORDER BY confidence DESC NULLS LAST, updated_at DESC NULLS LAST
      LIMIT 12
    `, [key, theme]),
    historicalAnalogs: await safeRows(client, 'historical_analog_cases', `
      SELECT * FROM historical_analog_cases
      WHERE subject_key = $1 OR subject_key = $2
      ORDER BY similarity_score DESC NULLS LAST, created_at DESC
      LIMIT 5
    `, [key, theme]),
    trendHistory,
    symbols,
    search,
    reportBackfillTasks,
    sourceQueryApprovals,
    providerRunRows,
    genericKpis: kpiState,
    feedback: await safeRows(client, 'report_feedback', `
      SELECT * FROM report_feedback
      WHERE report_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `, [bundle.reportId || '']),
  };
}

async function persistBackfillTasks(client, bundle, summary) {
  const tasks = [
    ...asArray(summary?.gaps).map((gap) => ({
      ...gap,
      taskType: 'source_query',
      priority: gap.severity === 'high' ? 85 : 60,
      metadata: { collectionPlan: false },
    })),
    ...asArray(summary?.collectionPlan),
  ].filter((task) => task?.query && task?.packName);
  if (!client || !tasks.length) return { inserted: 0 };
  const key = subjectKey(bundle);
  let inserted = 0;
  for (const task of tasks.slice(0, 24)) {
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
      bundle.reportId || null,
      key,
      task.packName,
      task.taskType || 'source_query',
      task.query,
      Number(task.priority || (task.severity === 'high' ? 85 : 60)),
      JSON.stringify({
        reason: task.reason,
        reportType: bundle.reportType,
        subject: bundle.subject,
        severity: task.severity || null,
        collectionPlan: Boolean(task.collectionPlan || task.metadata?.collectionPlan),
        collectionKind: task.collectionKind || task.metadata?.collectionKind || null,
        requiredFor: task.requiredFor || null,
        target: task.target || null,
        createdBy: 'deep-research-pack',
        automationPath: 'report-backfill-drain -> approval_queue/source-query',
        reviewGate: true,
        ...(task.metadata || {}),
      }),
      REPORT_BACKFILL_DEDUPE_STATUSES,
    ]).catch(() => ({ rows: [] }));
    inserted += result.rows.length;
  }
  return { inserted };
}

function sourceQueryDraftQuery(draft = {}) {
  const metadata = safeMetadata(draft.metadata);
  return String(metadata.query || draft.text || draft.query || '').replace(/\s+/g, ' ').trim();
}

function sourceQueryDraftPackName(draft = {}) {
  const metadata = safeMetadata(draft.metadata);
  const explicit = metadata.packName || metadata.dataPack || metadata.pack || null;
  if (explicit) return String(explicit).trim();
  const gapKind = String(metadata.gapKind || '').trim();
  if (/theme[_-]?kpi/i.test(gapKind)) return 'industryPack';
  if (/filing/i.test(gapKind)) return 'filingPack';
  if (/transcript|management/i.test(gapKind)) return 'transcriptPack';
  if (/market|event[_-]?study|sensitivity/i.test(`${gapKind} ${draft.text || ''}`)) return 'marketPack';
  if (/causal/i.test(`${gapKind} ${draft.text || ''}`)) return 'causalPack';
  if (/historical|analog/i.test(`${gapKind} ${draft.text || ''}`)) return 'historicalAnalogPack';
  return gapKind ? slugify(gapKind) : 'analystSynthesisPack';
}

function sourceQueryDraftPriority(draft = {}) {
  const metadata = safeMetadata(draft.metadata);
  if (metadata.priority !== undefined) return clamp(metadata.priority, 1, 100, 70);
  const severity = String(metadata.severity || draft.severity || '').toLowerCase();
  if (severity === 'critical') return 95;
  if (severity === 'high') return 88;
  if (severity === 'medium') return 72;
  if (asArray(draft.caveatIds).length) return 82;
  if (/direct|transcript|filing|controlled|event[- ]study/i.test(`${draft.reason || ''} ${draft.text || ''}`)) return 86;
  return 68;
}

export async function enqueueReportSourceQueryDrafts(client, bundle = {}, sourceQueryDrafts = [], options = {}) {
  const drafts = asArray(sourceQueryDrafts)
    .filter((draft) => draft && draft.approvalRequired !== false && sourceQueryDraftQuery(draft));
  if (!client) return { ok: false, reason: 'no db client', inspectedCount: drafts.length, insertedCount: 0, dedupedCount: 0, failedCount: 0 };
  if (!drafts.length) return { ok: true, inspectedCount: 0, insertedCount: 0, dedupedCount: 0, failedCount: 0 };
  if (options.ensureSchema !== false) {
    await ensureDeepResearchSchema(client);
  }

  const key = subjectKey(bundle);
  const limit = clamp(options.limit, 1, 250, 48);
  let insertedCount = 0;
  let dedupedCount = 0;
  let failedCount = 0;
  const errors = [];

  for (const draft of drafts.slice(0, limit)) {
    const metadata = safeMetadata(draft.metadata);
    const query = sourceQueryDraftQuery(draft);
    const packName = sourceQueryDraftPackName(draft);
    const priority = sourceQueryDraftPriority(draft);
    try {
      const result = await client.query(`
        INSERT INTO report_backfill_tasks (
          report_id, subject_key, pack_name, task_type, query, status, priority, metadata
        )
        SELECT $1, $2, $3, 'source_query', $4, 'pending', $5, $6::jsonb
        WHERE NOT EXISTS (
          SELECT 1
            FROM report_backfill_tasks
           WHERE subject_key = $2
             AND pack_name = $3
             AND LOWER(query) = LOWER($4)
             AND status = ANY($7::text[])
        )
        RETURNING id
      `, [
        draft.reportId || bundle.reportId || null,
        key,
        packName,
        query,
        priority,
        JSON.stringify({
          reason: draft.reason || metadata.reason || 'Report source-query draft requires evidence expansion.',
          reportType: bundle.reportType,
          subject: bundle.subject,
          sourceQueryDraftId: draft.queryId || null,
          bundleId: draft.bundleId || bundle.bundleId || null,
          gapKind: metadata.gapKind || null,
          collectionKind: metadata.collectionKind || null,
          requiredFor: metadata.requiredFor || null,
          target: metadata.target || null,
          issuerHints: unique([...asArray(draft.issuerHints), ...asArray(metadata.issuerHints)]),
          issuerUniverse: unique([...asArray(draft.issuerUniverse), ...asArray(metadata.issuerUniverse)]),
          claimIds: asArray(draft.claimIds),
          evidenceIds: asArray(draft.evidenceIds),
          metricIds: asArray(draft.metricIds),
          figureIds: asArray(draft.figureIds),
          caveatIds: asArray(draft.caveatIds),
          createdBy: 'report-source-query-draft',
          automationPath: 'generate-intelligence-report --db -> report_backfill_tasks -> drain-report-backfill-tasks -> approval_queue/source-query',
          reviewGate: true,
          draftBoundary: draft.boundary || null,
          liveQueueBoundary: 'review-gated report_backfill_tasks only; canonical source data changes only after approval and executor ingestion',
          ...(metadata || {}),
        }),
        REPORT_BACKFILL_PENDING_DEDUPE_STATUSES,
      ]);
      if (result.rows.length) insertedCount += 1;
      else {
        dedupedCount += 1;
        const metadataPatch = Object.fromEntries(Object.entries({
          latestReportId: draft.reportId || bundle.reportId || null,
          latestBundleId: draft.bundleId || bundle.bundleId || null,
          candidateId: metadata.candidateId || null,
          candidateThemes: Array.isArray(metadata.candidateThemes) ? metadata.candidateThemes : null,
          connector: metadata.connector || null,
          supplier: metadata.supplier || null,
          target: metadata.target || null,
          issuerHints: unique([...asArray(draft.issuerHints), ...asArray(metadata.issuerHints)]),
          issuerUniverse: unique([...asArray(draft.issuerUniverse), ...asArray(metadata.issuerUniverse)]),
          gapKind: metadata.gapKind || null,
          desiredEvidenceClass: metadata.desiredEvidenceClass || metadata.evidenceClass || null,
          evidenceClass: metadata.evidenceClass || metadata.desiredEvidenceClass || null,
        }).filter(([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)));
        const automationPatch = {
          latestDedupedReportId: draft.reportId || bundle.reportId || null,
          latestDedupedAt: new Date().toISOString(),
          latestSourceQueryDraftId: draft.queryId || null,
        };
        await client.query(`
          UPDATE report_backfill_tasks
             SET metadata = metadata || $5::jsonb ||
                            jsonb_build_object('automation', COALESCE(metadata->'automation', '{}'::jsonb) || $6::jsonb),
                 updated_at = NOW()
           WHERE subject_key = $1
             AND pack_name = $2
             AND LOWER(query) = LOWER($3)
             AND status = ANY($4::text[])
        `, [
          key,
          packName,
          query,
          REPORT_BACKFILL_PENDING_DEDUPE_STATUSES,
          JSON.stringify(metadataPatch),
          JSON.stringify(automationPatch),
        ]);
      }
    } catch (error) {
      failedCount += 1;
      errors.push({ query, packName, error: String(error?.message || error) });
    }
  }

  return {
    ok: failedCount === 0,
    inspectedCount: drafts.length,
    processedCount: Math.min(drafts.length, limit),
    insertedCount,
    dedupedCount,
    failedCount,
    errors,
  };
}

async function loadDueReportBackfillTasks(client, options) {
  const { rows } = await client.query(`
    SELECT id, report_id, subject_key, pack_name, task_type, query, status, priority,
           metadata, created_at, updated_at, attempt_count, last_attempted_at,
           next_attempt_at, last_error
      FROM report_backfill_tasks
     WHERE task_type = 'source_query'
       AND status = ANY($2::text[])
       AND COALESCE(attempt_count, 0) < $3
       AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
       AND (
         $4::text IS NULL
         OR report_id = $4::text
         OR metadata->>'reportId' = $4::text
         OR metadata->>'latestReportId' = $4::text
         OR metadata->'automation'->>'latestDedupedReportId' = $4::text
       )
     ORDER BY priority DESC, created_at ASC
     LIMIT $1
  `, [options.limit, ['pending', 'retry_wait'], options.maxAttempts, options.reportId || null]);
  return rows;
}

async function findLatestReportBackfillApproval(client, task) {
  const taskId = reportBackfillTaskId(task);
  const query = reportBackfillQuery(task);
  const { rows } = await client.query(`
    SELECT id, status, payload, created_at, reviewed_at, reviewer
      FROM approval_queue
     WHERE action_type = 'source-query'
       AND (
         payload->>'reportBackfillTaskId' = $1
         OR (
           LOWER(payload->>'query') = LOWER($2)
           AND COALESCE(payload->>'source', '') = 'report-deep-research-pack'
         )
       )
     ORDER BY created_at DESC
     LIMIT 1
  `, [taskId, query]);
  return rows[0] || null;
}

async function findActiveReportBackfillApproval(client, task) {
  const approval = await findLatestReportBackfillApproval(client, task);
  if (!approval) return null;
  return ['pending', 'approved', 'needs-fix'].includes(String(approval.status || '')) ? approval : null;
}

async function insertReportBackfillApproval(client, task) {
  const payload = buildReportBackfillApprovalPayload(task);
  const reasoning = [
    `Report deep research gap (${payload.packName})`,
    payload.reason,
    'Queued for human review; no canonical report mutation is performed by the daemon.',
  ].filter(Boolean).join(': ');
  const { rows } = await client.query(`
    INSERT INTO approval_queue (action_type, payload, status, reasoning)
    VALUES ('source-query', $1::jsonb, 'pending', $2)
    RETURNING id, status, created_at
  `, [JSON.stringify(payload), reasoning]);
  return rows[0];
}

async function markReportBackfillQueued(client, task, approval, { deduped = false } = {}) {
  const payload = {
    lastQueuedApprovalId: approval?.id ? String(approval.id) : null,
    lastQueuedApprovalStatus: approval?.status || 'pending',
    lastQueuedAt: new Date().toISOString(),
    approvalDeduped: Boolean(deduped),
  };
  await client.query(`
    UPDATE report_backfill_tasks
       SET status = 'queued_review',
           attempt_count = COALESCE(attempt_count, 0) + 1,
           last_attempted_at = NOW(),
           next_attempt_at = NULL,
           last_error = NULL,
           metadata = metadata || $2::jsonb,
           updated_at = NOW()
     WHERE id = $1
  `, [task.id, JSON.stringify({ automation: payload })]);
}

async function markReportBackfillRetry(client, task, error, options) {
  const retry = computeReportBackfillRetry(task, options);
  await client.query(`
    UPDATE report_backfill_tasks
       SET status = $2,
           attempt_count = $3,
           last_attempted_at = NOW(),
           next_attempt_at = $4::timestamptz,
           last_error = $5,
           metadata = metadata || $6::jsonb,
           updated_at = NOW()
     WHERE id = $1
  `, [
    task.id,
    retry.status,
    retry.attempt,
    retry.nextAttemptAt,
    String(error || 'unknown report backfill queue failure').slice(0, 500),
    JSON.stringify({
      automation: {
        lastQueueFailureAt: new Date().toISOString(),
        retryAttempt: retry.attempt,
        maxAttempts: retry.maxAttempts,
        nextAttemptAt: retry.nextAttemptAt,
        exhausted: retry.exhausted,
      },
    }),
  ]);
  return retry;
}

async function updateReportBackfillStatusFromApproval(client, task, approval) {
  const approvalStatus = String(approval?.status || '');
  const statusMap = {
    pending: 'queued_review',
    approved: 'approved',
    'needs-fix': 'needs_fix',
    executed: 'completed',
    'context-collected': 'context_collected',
    'negative-control-collected': 'negative_control_collected',
    'weak-noise-collected': 'weak_noise_collected',
    rejected: 'rejected',
  };
  const nextStatus = statusMap[approvalStatus] || 'queued_review';
  await client.query(`
    UPDATE report_backfill_tasks
       SET status = $2,
           metadata = metadata || $3::jsonb,
           updated_at = NOW()
     WHERE id = $1
  `, [
    task.id,
    nextStatus,
    JSON.stringify({
      automation: {
        lastObservedApprovalId: approval?.id ? String(approval.id) : null,
        lastObservedApprovalStatus: approvalStatus || null,
        lastObservedAt: new Date().toISOString(),
      },
    }),
  ]);
  return nextStatus;
}

async function reconcileStaleReportBackfillTasks(client, options) {
  const { rows } = await client.query(`
    SELECT id, report_id, subject_key, pack_name, task_type, query, status, priority,
           metadata, created_at, updated_at, attempt_count, last_attempted_at,
           next_attempt_at, last_error
      FROM report_backfill_tasks
     WHERE status = ANY($1::text[])
       AND updated_at <= NOW() - ($2::int * INTERVAL '1 hour')
       AND (
         $4::text IS NULL
         OR report_id = $4::text
         OR metadata->>'reportId' = $4::text
         OR metadata->>'latestReportId' = $4::text
         OR metadata->'automation'->>'latestDedupedReportId' = $4::text
       )
     ORDER BY updated_at ASC
     LIMIT $3
  `, [REPORT_BACKFILL_QUEUED_STATUSES, options.staleHours, options.limit, options.reportId || null]);

  const reconciled = [];
  for (const task of rows) {
    const approval = await findLatestReportBackfillApproval(client, task);
    if (!approval) {
      await client.query(`
        UPDATE report_backfill_tasks
           SET status = 'pending',
               next_attempt_at = NULL,
               last_error = 'queued approval missing; re-queued for conservative retry',
               metadata = metadata || $2::jsonb,
               updated_at = NOW()
         WHERE id = $1
      `, [
        task.id,
        JSON.stringify({ automation: { staleRepairAt: new Date().toISOString(), reason: 'approval_missing' } }),
      ]);
      reconciled.push({ taskId: String(task.id), status: 'pending', repaired: true, reason: 'approval_missing' });
      continue;
    }
    const nextStatus = await updateReportBackfillStatusFromApproval(client, task, approval);
    reconciled.push({
      taskId: String(task.id),
      status: nextStatus,
      approvalId: String(approval.id),
      approvalStatus: approval.status,
      repaired: false,
    });
  }
  return reconciled;
}

async function recordReportBackfillAutomationAction(client, summary) {
  await client.query(`
    INSERT INTO automation_actions (action_type, metadata, result, reason)
    VALUES ('report-backfill-drain', $1::jsonb, $2, $3)
  `, [
    JSON.stringify(summary),
    summary.dryRun ? 'dry-run' : (summary.queuedCount > 0 ? 'queued' : 'skipped'),
    'Queued report deep research gap source queries for review-gated backfill.',
  ]).catch(() => {});
}

export async function drainReportBackfillTasks(client, options = {}) {
  if (!client) return { ok: false, reason: 'no db client' };
  const normalized = normalizeDrainOptions(options);
  if (normalized.ensureSchema) {
    await ensureDeepResearchSchema(client);
    await ensureAutomationSchema(client);
  }

  const reconciled = normalized.reconcileStale && !normalized.dryRun
    ? await reconcileStaleReportBackfillTasks(client, normalized)
    : [];
  const tasks = await loadDueReportBackfillTasks(client, normalized);
  const results = [];

  for (const task of tasks) {
    const payload = buildReportBackfillApprovalPayload(task);
    if (!payload.query) {
      if (!normalized.dryRun) {
        await markReportBackfillRetry(client, task, 'missing source query text', normalized);
      }
      results.push({ taskId: String(task.id), ok: false, queued: false, status: 'invalid', error: 'missing source query text' });
      continue;
    }

    if (normalized.dryRun) {
      results.push({
        taskId: String(task.id),
        ok: true,
        dryRun: true,
        queued: false,
        wouldQueue: true,
        status: task.status,
        payload,
      });
      continue;
    }

    try {
      const existing = await findActiveReportBackfillApproval(client, task);
      if (existing) {
        await markReportBackfillQueued(client, task, existing, { deduped: true });
        results.push({
          taskId: String(task.id),
          ok: true,
          queued: false,
          deduped: true,
          approvalId: String(existing.id),
          status: 'queued_review',
        });
        continue;
      }
      const approval = await insertReportBackfillApproval(client, task);
      await markReportBackfillQueued(client, task, approval, { deduped: false });
      results.push({
        taskId: String(task.id),
        ok: true,
        queued: true,
        deduped: false,
        approvalId: String(approval.id),
        status: 'queued_review',
      });
    } catch (error) {
      const retry = await markReportBackfillRetry(client, task, String(error?.message || error), normalized);
      results.push({
        taskId: String(task.id),
        ok: false,
        queued: false,
        status: retry.status,
        retry,
        error: String(error?.message || error).slice(0, 500),
      });
    }
  }

  const summary = {
    ok: true,
    dryRun: normalized.dryRun,
    inspectedCount: tasks.length,
    queuedCount: results.filter((item) => item.queued).length,
    dedupedCount: results.filter((item) => item.deduped).length,
    retryCount: results.filter((item) => item.status === 'retry_wait').length,
    failedCount: results.filter((item) => item.ok === false && item.status !== 'retry_wait').length,
    reconciledCount: reconciled.length,
    reconciled,
    results,
  };
  if (!normalized.dryRun) await recordReportBackfillAutomationAction(client, summary);
  return summary;
}

function derivedCausalEdges(bundle = {}) {
  const subject = subjectDisplay(bundle);
  const paths = asArray(bundle.metadata?.crossAssetPaths?.paths);
  const knowledge = asArray(bundle.metadata?.themeContext?.knowledgeConnections);
  const market = asArray(bundle.marketReactions);
  const edges = [];
  for (const path of paths.slice(0, 4)) {
    const via = path.hop1?.entity;
    const target = path.tradableEndpoint || path.hop2?.entity || path.hop1?.entity;
    if (!via || !target) continue;
    const mechanism = String(target).toLowerCase() === String(via).toLowerCase()
      ? `${subject} is exposed to ${via} as a candidate intermediate dependency or bottleneck`
      : `${subject} may transmit through ${via} toward ${target}`;
    edges.push({
      sourceNode: subject,
      targetNode: target,
      viaNode: via,
      mechanism,
      direction: 'positive_or_pressure',
      lagDays: null,
      confidence: Math.max(0.25, Math.min(0.75, num(path.score, 0.4))),
      edgeType: 'causal_hypothesis_from_knowledge_graph',
      evidenceIds: [],
      caveatIds: ['CAV-DEEP-CAUSAL-HYPOTHESIS'],
    });
  }
  for (const item of knowledge.slice(0, Math.max(0, 4 - edges.length))) {
    edges.push({
      sourceNode: subject,
      targetNode: item.entityName,
      mechanism: `${subject} is linked to ${item.entityName} through ${item.relationType || 'knowledge graph relation'}`,
      direction: 'unknown',
      lagDays: null,
      confidence: Math.max(0.2, Math.min(0.7, num(item.confidence, 0.5))),
      edgeType: 'causal_hypothesis_from_relation_extraction',
      evidenceIds: [`EVID-EDGE-${item.edgeId}`].filter(Boolean),
      caveatIds: ['CAV-DEEP-CAUSAL-HYPOTHESIS'],
    });
  }
  for (const reaction of market.slice(0, Math.max(0, 3 - edges.length))) {
    edges.push({
      sourceNode: subject,
      targetNode: reaction.symbol,
      mechanism: `${subject} has a measured market-reaction row for ${reaction.symbol}`,
      direction: num(reaction.relativeReturnPct, 0) >= 0 ? 'positive_market_link' : 'negative_market_link',
      lagDays: null,
      confidence: String(reaction.validationStatus || '').toLowerCase() === 'validated' ? 0.7 : 0.45,
      edgeType: 'validated_event_market_or_correlation',
      evidenceIds: [],
      caveatIds: [],
    });
  }
  return edges;
}

function normalizedDbCausalEdges(rows = []) {
  return rows.map((row) => ({
    sourceNode: row.source_node,
    targetNode: row.target_node,
    mechanism: row.mechanism,
    direction: row.direction,
    lagDays: row.lag_days,
    confidence: num(row.confidence, 0.5),
    edgeType: row.edge_type,
    evidenceIds: asArray(row.evidence_ids),
    caveatIds: asArray(row.caveat_ids),
    metadata: row.metadata || {},
  }));
}

function causalEdgesFromBackfillRows(bundle = {}, rows = []) {
  const subject = subjectDisplay(bundle);
  return asArray(rows)
    .filter((row) => {
      const evidenceClass = row.desiredEvidenceClass || row.metadata?.desiredEvidenceClass || row.metadata?.evidenceClass;
      return evidenceClass === 'mechanism_validation';
    })
    .slice(0, 6)
    .map((row, index) => {
      const metadata = row.metadata || {};
      const issuerUniverse = asArray(metadata.issuerUniverse || metadata.providerRoutePlan?.issuerUniverse);
      const targetNode = row.symbol || metadata.symbol || metadata.issuerSymbol || issuerUniverse[0] || 'issuer universe';
      const text = compactText(row.fact_text || row.excerpt || row.title || metadata.acceptanceCriteria || metadata.providerRoutePlan?.acceptanceCriteria || '');
      const use = researchEvidenceUse(row);
      return {
        sourceNode: subject,
        targetNode,
        mechanism: text
          ? `${subject} mechanism evidence: ${text.slice(0, 220)}`
          : `${subject} has report-scoped mechanism validation evidence for ${targetNode}`,
        direction: 'mechanism_supported',
        lagDays: null,
        confidence: use === 'promotion_candidate' ? 0.65 : 0.45,
        edgeType: 'evidence_contract_mechanism_validation',
        evidenceIds: [row.id || row.evidence_ref || `backfill-mechanism-${index}`].filter(Boolean),
        caveatIds: use === 'promotion_candidate' ? [] : ['CAV-DEEP-CAUSAL-CONTEXT'],
        metadata: {
          desiredEvidenceClass: 'mechanism_validation',
          evidenceUse: use || null,
          sourceType: row.source_type || null,
          reportBackfillPackEvidence: true,
        },
      };
    });
}

function analoguesFromBackfillRows(bundle = {}, rows = []) {
  const subject = subjectDisplay(bundle);
  return asArray(rows)
    .map((row, index) => {
      const text = compactText(`${row.title || ''} ${row.fact_text || ''} ${row.excerpt || ''}`);
      const hasTemporalMarker = /\b(?:19|20)\d{2}\b|past|prior|previous|historical|analogue|analog|cycle|crisis|shortage|war|ramp/i.test(text);
      const hasOutcomeMarker = /\bmarket|return|outcome|production|capacity|supply|demand|backlog|procurement|funding|price|margin|delivery|deliveries\b/i.test(text);
      if (!hasTemporalMarker || !hasOutcomeMarker) return null;
      const title = compactText(row.title || text.slice(0, 80));
      return {
        analogName: title && !/^historical analogue$/i.test(title) ? title.slice(0, 120) : `${subject} historical evidence analogue ${index + 1}`,
        period: row.published_at ? String(row.published_at).slice(0, 10) : 'historical period identified in evidence',
        similarityScore: Math.max(0.35, Math.min(0.75, Number(row.relevance_score || 0.55))),
        similarityDrivers: [
          'report-scoped historical analogue evidence',
          row.metadata?.desiredEvidenceClass || row.metadata?.evidenceClass || 'historical_analog',
          row.source_type || 'research_evidence_bundles',
        ].filter(Boolean),
        differences: [
          'Derived from report-scoped evidence; issuer-level valuation and regime differences still need analyst review.',
        ],
        marketOutcome: text.slice(0, 260) || 'Historical analogue evidence includes an observed outcome, but full market-outcome normalization is pending.',
        whatBrokeTheAnalogy: 'Treat as reliable only for context until current issuer exposure, market validation, and regime controls agree.',
        invalidatingIndicators: [
          'different procurement timing',
          'different qualified-supplier base',
          'different market regime or valuation setup',
        ],
        evidenceIds: [row.id || row.evidence_ref].filter(Boolean),
        source: row.source_type || 'research_evidence_bundles',
        metadata: {
          desiredEvidenceClass: row.metadata?.desiredEvidenceClass || row.metadata?.evidenceClass || 'historical_analog',
          evidenceUse: researchEvidenceUse(row) || null,
          reportBackfillPackEvidence: true,
        },
      };
    })
    .filter(Boolean)
    .slice(0, 3);
}

function analoguesFromBundle(bundle = {}, rows = [], trendHistory = [], backfillRows = []) {
  const dbAnalogs = rows.map((row) => ({
    analogName: row.analog_name,
    period: [row.period_start, row.period_end].filter(Boolean).join(' to '),
    similarityScore: num(row.similarity_score, 0),
    similarityDrivers: asArray(row.similarity_drivers),
    differences: asArray(row.differences),
    marketOutcome: row.market_outcome,
    whatBrokeTheAnalogy: row.what_broke_the_analogy,
    invalidatingIndicators: asArray(row.invalidating_indicators),
    evidenceIds: asArray(row.evidence_ids),
    source: 'historical_analog_cases',
  }));
  if (dbAnalogs.length) return dbAnalogs;
  const backfillAnalogs = analoguesFromBackfillRows(bundle, backfillRows);
  if (backfillAnalogs.length) return backfillAnalogs;
  const trendRows = asArray(trendHistory)
    .filter((row) => num(row.article_count, 0) > 0)
    .sort((a, b) => {
      const bScore = Math.abs(num(b.vs_previous_period_pct, 0)) + Math.abs(num(b.trend_acceleration, 0)) + num(b.article_count, 0);
      const aScore = Math.abs(num(a.vs_previous_period_pct, 0)) + Math.abs(num(a.trend_acceleration, 0)) + num(a.article_count, 0);
      return bScore - aScore;
    })
    .slice(0, 3);
  if (trendRows.length) {
    return trendRows.map((row, index) => ({
      analogName: `${row.theme_label || row.theme || subjectDisplay(bundle)} prior ${row.period_type || 'period'} state ${index + 1}`,
      period: [row.period_start, row.period_end].filter(Boolean).map((value) => String(value).slice(0, 10)).join(' to '),
      similarityScore: Math.max(0.25, Math.min(0.85, (
        Math.min(1, num(row.article_count, 0) / 150)
        + Math.min(1, Math.abs(num(row.vs_previous_period_pct, 0)) / 200)
        + Math.min(1, Math.abs(num(row.trend_acceleration, 0)) / 500)
      ) / 3)),
      similarityDrivers: [
        `${row.period_type || 'period'} attention regime`,
        `article_count=${row.article_count ?? 0}`,
        `lifecycle=${row.lifecycle_stage || 'unknown'}`,
      ],
      differences: [
        'Same-theme trend memory, not a full macro/valuation analogue.',
        'Use as historical context until event-level analogue matching is available.',
      ],
      marketOutcome: `The theme was in ${row.lifecycle_stage || 'unknown'} state with ${row.article_count ?? 0} articles and source diversity ${row.source_diversity ?? 'n/a'}.`,
      whatBrokeTheAnalogy: 'Macro regime, supplier exposure, and market-reaction rows must agree before treating this as a strong analogue.',
      invalidatingIndicators: [
        'current source diversity diverges from this window',
        'current market reactions are not comparable',
        'current policy or capex backdrop differs materially',
      ],
      evidenceIds: [],
      source: 'theme_trend_aggregates_memory',
      metadata: {
        periodType: row.period_type,
        parentTheme: row.parent_theme,
        vsPreviousPeriodPct: row.vs_previous_period_pct,
        vsYearAgoPct: row.vs_year_ago_pct,
        trendAcceleration: row.trend_acceleration,
        lifecycleConfidence: row.lifecycle_confidence,
      },
    }));
  }
  const computed = bundle.metadata?.historicalAnalogues;
  if (computed?.available && asArray(computed.analogues).length) {
    return computed.analogues.slice(0, 3).map((item, index) => ({
      analogName: `Hawkes-profile analogue ${index + 1}`,
      period: `${String(item.startDate).slice(0, 10)} to ${String(item.endDate).slice(0, 10)}`,
      similarityScore: num(item.similarity, 0),
      similarityDrivers: ['similar attention-intensity profile', 'similar surge distribution'],
      differences: ['macro/fundamental context not yet matched'],
      marketOutcome: asArray(item.contextEvents).slice(0, 2).map((event) => event.title).join('; ') || 'event context unavailable',
      whatBrokeTheAnalogy: 'Requires regime and market-outcome comparison before promotion.',
      invalidatingIndicators: ['different macro regime', 'no comparable market reaction', 'source mix diverges'],
      evidenceIds: [],
      source: 'computed_hawkes_profile',
      contextOnly: true,
    }));
  }
  return [];
}

function isReliableHistoricalAnalogue(analogue = {}) {
  const name = String(analogue.analogName || analogue.name || '').trim();
  if (!name || /^(hawkes[-_ ]profile analogue|historical analogue|analogue)\s*\d*$/i.test(name)) return false;
  if (/computed_hawkes_profile/i.test(String(analogue.source || ''))) return false;
  if (analogue.contextOnly === true) return false;
  const outcome = String(analogue.marketOutcome || '').trim();
  if (!outcome || /event context unavailable/i.test(outcome)) return false;
  return true;
}

const EVIDENCE_CLASS_EXTRACTION_RULES = Object.freeze([
  {
    evidenceClass: 'issuer_exposure',
    evidenceUse: 'promotion_candidate',
    finding: 'direct_issuer_exposure',
    factKey: 'issuer_business_exposure',
    pattern: /\b(segment revenue|revenues? (?:increased|grew|of|were)|remaining performance obligations|backlog|bookings|orders|customer(?:s)?|contract(?:s)?|guidance|outlook|book[-\s]?to[-\s]?bill|data[-\s]?center|grid|transmission|substation|utility|electrical|power infrastructure)\b/i,
  },
  {
    evidenceClass: 'issuer_commentary',
    evidenceUse: 'promotion_candidate',
    finding: 'direct_issuer_commentary',
    factKey: 'management_commentary_or_guidance',
    pattern: /\b(today announced results|announced results|management(?:'s)? estimate|guidance|outlook|demand|capacity|backlog|bookings|orders|remaining performance obligations|customer(?:s)?|contract(?:s)?)\b/i,
  },
  {
    evidenceClass: 'mechanism_validation',
    evidenceUse: 'promotion_candidate',
    finding: 'supported_mechanism',
    factKey: 'causal_or_operating_mechanism',
    pattern: /\b(increases demand|demand .{0,80} solutions|driven by|because|constrained by|exceeds supply|interconnection wait|queue delay|connect(?:ing)? .{0,80} power grid|transmission interconnection infrastructure|power availability|load growth)\b/i,
  },
  {
    evidenceClass: 'compute_demand',
    evidenceUse: 'promotion_candidate',
    finding: 'direct_compute_demand',
    factKey: 'compute_or_ai_workload_demand',
    pattern: /\b(customers expand(?:ing)? their ai|ai usage|ai workload|inference|training workload|compute capacity|compute demand|data[-\s]?center ai accelerator|ai accelerator opportunity|customer demand for cloud infrastructure|demand for cloud infrastructure)\b/i,
  },
  {
    evidenceClass: 'capex_confirmation',
    evidenceUse: 'promotion_candidate',
    finding: 'direct_capex_confirmation',
    factKey: 'capex_or_infrastructure_spend',
    pattern: /\b(capex|capital expenditure|capital expenditures|capitalexpenditure|capital allocation|infrastructure spending|data[-\s]?center investment|cloud capex|ai capex)\b/i,
  },
  {
    evidenceClass: 'power_constraint',
    evidenceUse: 'promotion_candidate',
    finding: 'direct_power_constraint',
    factKey: 'power_or_mw_capacity_constraint',
    pattern: /\b(data[-\s]?center power|power availability|power demand|electricity demand|mw capacity|megawatt|megawatt[-\s]?hours|mwh|utility load|energy contracts?|power capacity|generate .{0,80} power|necessary to power)\b/i,
  },
  {
    evidenceClass: 'grid_interconnection',
    evidenceUse: 'promotion_candidate',
    finding: 'direct_grid_interconnection',
    factKey: 'grid_or_interconnection_constraint',
    pattern: /\b(grid interconnection|interconnection queue|transmission access|utility connection|substation|rto|ferc|transmission interconnection infrastructure|connect(?:ing)? .{0,80} power grid|interconnect data centers)\b/i,
  },
  {
    evidenceClass: 'cloud_revenue',
    evidenceUse: 'promotion_candidate',
    finding: 'direct_cloud_revenue',
    factKey: 'cloud_revenue_or_segment_growth',
    pattern: /\b(cloud services revenue|server products and cloud services revenue|commercial cloud revenue|commercial cloud|aws(?:\b| .{0,80}(?:revenue|growth|demand|capacity|supply|power))|azure(?: and other cloud services)?(?:\b| .{0,80}(?:revenue|growth|demand|capacity|supply|power))|google cloud(?:\b| .{0,80}(?:revenue|growth|demand|capacity|supply|power))|oracle cloud(?:\b| .{0,80}(?:revenue|growth|demand|capacity|supply|power))|cloud infrastructure .{0,100}(?:revenue|growth|demand|capacity|supply|exceeds supply|power)|cloud segment .{0,80}(?:revenue|growth|demand|capacity|supply)|cloud growth|cloud demand|cloud infrastructure exceeds supply)\b/i,
  },
  {
    evidenceClass: 'accelerator_orders',
    evidenceUse: 'promotion_candidate',
    finding: 'direct_accelerator_order_or_commitment',
    factKey: 'accelerator_orders_or_customer_commitment',
    pattern: /\b(purchase agreement .{0,120}(gpu|accelerator|instinct|trainium|asic)|binding commitment .{0,120}(gpu|accelerator|instinct|trainium|asic)|gigawatt equivalent .{0,80}(gpu|accelerator|instinct)|gpu products|accelerator backlog|server shipments|server orders|rack[-\s]?scale ai solutions|ai accelerator opportunity)\b/i,
  },
  {
    evidenceClass: 'data_center_utilization',
    evidenceUse: 'promotion_candidate',
    finding: 'direct_data_center_utilization',
    factKey: 'data_center_capacity_or_load',
    pattern: /\b(data[-\s]?center utilization|leased capacity|absorption|occupancy|load ramp|capacity buildout|data[-\s]?center load|large load|capacity to power|data centers?.{0,80}interconnect)\b/i,
  },
  {
    evidenceClass: 'operating_kpi',
    evidenceUse: 'promotion_candidate',
    finding: 'direct_operating_kpi',
    factKey: 'operating_metric',
    pattern: /\b(revenue increased|operating income|capital expenditure|megawatt[-\s]?hours|mw capacity|backlog|bookings|orders|utilization|capacity buildout|segment revenue|market reaction strength)\b/i,
  },
  {
    evidenceClass: 'supplier_capacity',
    evidenceUse: 'promotion_candidate',
    finding: 'direct_supplier_capacity',
    factKey: 'capacity_or_throughput_supply',
    pattern: /\b(production capacity|capacity expansion|facility|factory|plant|throughput|supplier expansion|manufacturing capacity|lead time|bookings|book-to-bill|backlog|substation|transformer|generation infrastructure)\b/i,
  },
  {
    evidenceClass: 'substitution_limit',
    evidenceUse: 'promotion_candidate',
    finding: 'supported_constraint',
    factKey: 'substitution_or_infrastructure_constraint',
    pattern: /\b(critical[-\s]?path .{0,80} infrastructure|high[-\s]?voltage substation|transmission interconnection infrastructure|connect(?:ing)? .{0,80} power grid|interconnection queue|transmission queue|queue backlog|long lead time|limited grid capacity|hard to substitute|single source|sole source)\b/i,
  },
  {
    evidenceClass: 'negative_control',
    evidenceUse: 'negative_control_candidate',
    finding: 'checked_alternative_or_mitigation',
    factKey: 'negative_control_or_alternative_path',
    pattern: /\b(easy substitutes?|alternative suppliers?|supplier redundancy|no capacity constraint|onsite generation|behind[-\s]?the[-\s]?meter|bridge resource|natural gas .{0,30} bridge|battery storage|energy contracts?|renewable energy .{0,80} generate|power capacity|interconnection reform|reduce .{0,40} queue|mitigat(?:e|ion|es)|self[-\s]?supply)\b/i,
  },
]);

const STRICT_EXTRACTION_STOPWORDS = Object.freeze(new Set([
  'a',
  'an',
  'and',
  'as',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'generated',
  'candidate',
  'adjacent',
  'frontier',
  'evidence',
  'official',
]));

function normalizeExtractionText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractionNgrams(term = '') {
  const words = normalizeExtractionText(term)
    .split(' ')
    .filter((word) => word && !STRICT_EXTRACTION_STOPWORDS.has(word));
  const out = new Set();
  for (let size = Math.min(4, words.length); size >= 2; size -= 1) {
    for (let index = 0; index <= words.length - size; index += 1) {
      const phrase = words.slice(index, index + size).join(' ');
      if (phrase.length >= 10) out.add(phrase);
    }
  }
  return [...out];
}

function strictExtractionTerms(bundle = {}) {
  const discovery = bundle.subject?.metadata?.discovery || {};
  const adjacentMetadata = bundle.metadata?.adjacentCandidate?.metadata || {};
  const parentTerms = new Set([
    discovery.connector,
    ...asArray(bundle.subject?.metadata?.themes),
    ...asArray(bundle.metadata?.themes),
    ...asArray(adjacentMetadata.themes),
  ].map(normalizeExtractionText).filter(Boolean));
  const nodes = asArray(discovery.concreteBottleneckNodes)
    .concat(asArray(bundle.metadata?.generatedLane?.concreteBottleneckNodes))
    .concat(asArray(adjacentMetadata.concreteBottleneckNodes));
  const raw = [
    bundle.subject?.displayName,
    discovery.adjacentLane,
    adjacentMetadata.generatedLane,
    bundle.metadata?.generatedLane?.label,
    ...asArray(discovery.triggerTerms),
    ...asArray(adjacentMetadata.sourceTerms),
    ...nodes.flatMap((node) => [
      node.node,
      node.key,
      node.nodeType,
      ...asArray(node.sourceTerms),
      ...asArray(node.acceptanceCriteria),
    ]),
  ];
  const terms = new Set();
  for (const value of raw) {
    for (const phrase of extractionNgrams(value)) {
      if (parentTerms.has(phrase)) continue;
      terms.add(phrase);
    }
  }
  return [...terms].slice(0, 80);
}

function rowPrimaryEvidenceText(row = {}) {
  const metadata = safeMetadata(row.metadata);
  const excerpt = compactText(row.excerpt || metadata.excerpt || row.summary || metadata.statement || '');
  const factText = excerpt ? '' : compactText(row.fact_text || row.factText || '');
  return compactText([
    row.symbol,
    row.ticker,
    row.company_name,
    row.companyName,
    row.title,
    row.topic,
    row.section,
    row.metric_name,
    row.kpi_name,
    excerpt,
    factText,
    metadata.title,
    metadata.sourceType,
    metadata.provider,
  ].join(' '));
}

function strictFrontierNodeFamilyHits(text = '', bundle = {}) {
  const discovery = bundle.subject?.metadata?.discovery || {};
  const adjacentMetadata = bundle.metadata?.adjacentCandidate?.metadata || {};
  const context = normalizeExtractionText([
    bundle.subject?.displayName,
    discovery.adjacentLane,
    adjacentMetadata.generatedLane,
    bundle.metadata?.generatedLane?.label,
    ...asArray(discovery.triggerTerms),
    ...asArray(adjacentMetadata.sourceTerms),
    ...asArray(discovery.concreteBottleneckNodes).map((node) => node?.node || node?.key || node),
    ...asArray(bundle.metadata?.generatedLane?.concreteBottleneckNodes).map((node) => node?.node || node?.key || node),
    ...asArray(adjacentMetadata.concreteBottleneckNodes).map((node) => node?.node || node?.key || node),
  ].flat().filter(Boolean).join(' '));
  const normalized = normalizeExtractionText(text);
  const patterns = [];
  if (/\b(interconnection|queue|grid|transmission|power|substation|large load|data center)\b/i.test(context)) {
    patterns.push(
      ['grid_interconnection_family', /\b(transmission interconnection infrastructure|interconnection infrastructure|interconnect data centers?|connect .{0,80} power grid|electrical grid modernization|substation|transformer|transmission|power infrastructure|data center infrastructure|large load customers?)\b/i],
    );
  }
  if (/\b(qualification|certification|technical|test|standard|study)\b/i.test(context)) {
    patterns.push(
      ['technical_study_family', /\b(interconnection stud(?:y|ies)|impact stud(?:y|ies)|facilities stud(?:y|ies)|technical review|qualification|certification|standard|test(?:ing)?)\b/i],
    );
  }
  if (/\b(launch|propellant|fuel|ground|mission support|range)\b/i.test(context)) {
    patterns.push(
      ['launch_ground_family', /\b(propellant loading|fuel farm|storage tank|ground support|range support|mission support|launch operations)\b/i],
    );
  }
  return patterns
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([key]) => key);
}

function strictFrontierRequiredTerm(bundle = {}) {
  const discovery = bundle.subject?.metadata?.discovery || {};
  const adjacentMetadata = bundle.metadata?.adjacentCandidate?.metadata || {};
  const raw = compactText(
    bundle.subject?.displayName
    || discovery.connector
    || adjacentMetadata.generatedLane
    || bundle.metadata?.generatedLane?.label
    || '',
  );
  const stop = new Set([
    'high', 'low', 'large', 'small', 'clean', 'energy', 'data', 'center', 'cloud',
    'capacity', 'supply', 'demand', 'cycle', 'system', 'systems', 'infrastructure',
    'queue', 'growth', 'market', 'technology',
  ]);
  const words = normalizeExtractionText(raw)
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !stop.has(word));
  return words[words.length - 1] || words[0] || '';
}

function strictExtractionContextHit(text = '', terms = [], bundle = {}) {
  const normalized = normalizeExtractionText(text);
  const requiredFrontierTerm = isFrontierParentScopedBundle(bundle) ? strictFrontierRequiredTerm(bundle) : '';
  const hits = terms.filter((term) => {
    if (!normalized.includes(term)) return false;
    if (!requiredFrontierTerm) return true;
    return normalizeExtractionText(term).split(/\s+/).includes(requiredFrontierTerm);
  });
  const familyHits = requiredFrontierTerm ? [] : strictFrontierNodeFamilyHits(text, bundle);
  return {
    ok: hits.length > 0 || familyHits.length > 0,
    hits: unique([...hits, ...familyHits]).slice(0, 8),
  };
}

function matchCenteredExcerpt(text = '', pattern, radius = 520) {
  const match = String(text || '').match(pattern);
  if (!match) return compactText(text).slice(0, 1200);
  const index = Math.max(0, match.index || 0);
  const start = Math.max(0, index - radius);
  const end = Math.min(String(text).length, index + String(match[0] || '').length + radius);
  return compactText(String(text).slice(start, end)).slice(0, 1200);
}

function isProviderEvidenceRow(row = {}) {
  const sourceType = String(row.source_type || row.sourceType || row.metadata?.sourceType || row.metadata?.provider || '').toLowerCase();
  if (!sourceType) return false;
  if (/issuer[_-]?thesis|issuer[-_]?discovery|cross[-_]?theme[-_]?action|universal[-_]?evidence|deep[-_]?research|local[-_]?market/.test(sourceType)) return false;
  return /sec|fmp|transcript|filing|company|industry_kpi|daily_curated|eia|ferc|rto|utility|research_evidence|openalex|patent|policy|article/.test(sourceType);
}

export function buildEvidenceClassExtractionRows(bundle = {}, rows = {}) {
  const strictAllowedSymbols = useScopedIssuerEvidence(bundle)
    ? new Set(filterIssuerSymbols([
      ...issuerSymbolsFromBundle(bundle),
      ...asArray(bundle.metadata?.candidateIssuerUniverse),
      ...asArray(bundle.metadata?.issuerUniverse),
      ...asArray(bundle.issuerUniverse),
    ]))
    : null;
  const strictTerms = strictAllowedSymbols ? strictExtractionTerms(bundle) : [];
  const sourceRows = [
    ...asArray(rows.transcripts),
    ...asArray(rows.filings),
    ...asArray(rows.fundamentals),
    ...asArray(rows.industry),
    ...asArray(rows.policy),
    ...asArray(rows.research),
  ].filter((row) => {
    if (!isProviderEvidenceRow(row)) return false;
    if (!strictAllowedSymbols) return true;
    const symbol = filterIssuerSymbols([row.symbol || row.ticker || row.metadata?.symbol || row.metadata?.issuerSymbol || ''])[0] || '';
    return !symbol || strictAllowedSymbols.has(symbol);
  });
  const out = [];
  const seen = new Set();
  for (const row of sourceRows) {
    const text = rowPrimaryEvidenceText(row);
    if (!text) continue;
    const strictContext = strictAllowedSymbols ? strictExtractionContextHit(text, strictTerms, bundle) : { ok: true, hits: [] };
    for (const rule of EVIDENCE_CLASS_EXTRACTION_RULES) {
      if (!rule.pattern.test(text)) continue;
      if (strictAllowedSymbols && rule.evidenceUse === 'promotion_candidate' && !strictContext.ok) continue;
      const rowId = stableRowKey(row, out.length);
      const key = `${rowId}:${rule.evidenceClass}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const symbol = row.symbol || row.ticker || null;
      if (['issuer_exposure', 'issuer_commentary'].includes(rule.evidenceClass) && !symbol) continue;
      const sourceType = row.source_type || row.sourceType || row.metadata?.sourceType || row.metadata?.provider || 'provider_evidence';
      const excerpt = matchCenteredExcerpt(text, rule.pattern);
      out.push({
        id: `class-extract-${rule.evidenceClass}-${slugify(rowId).slice(0, 60)}`,
        symbol,
        desiredEvidenceClass: rule.evidenceClass,
        evidenceClass: rule.evidenceClass,
        evidenceUse: rule.evidenceUse,
        promotionEligible: rule.evidenceUse === 'promotion_candidate',
        negativeControlFinding: rule.evidenceClass === 'negative_control' ? rule.finding : null,
        title: `${symbol ? `${symbol} ` : ''}${humanizeSlug(rule.evidenceClass)} direct evidence extract`,
        source_type: sourceType,
        observed_at: row.observed_at || row.transcript_at || row.filed_at || row.published_at || row.created_at || null,
        published_at: row.published_at || row.transcript_at || row.filed_at || row.observed_at || row.created_at || null,
        evidence_ref: row.evidence_ref || row.url || row.source_url || row.metadata?.url || row.metadata?.sourceUrl || null,
        excerpt,
        fact_text: excerpt,
        relevance_score: Math.max(num(row.relevance_score, 0.72), rule.evidenceUse === 'promotion_candidate' ? 0.78 : 0.68),
        metadata: {
          ...(safeMetadata(row.metadata)),
          adapter: 'evidence_class_direct_extract',
          sourceRowId: row.id || rowId,
          sourceRowTitle: row.title || row.topic || row.section || null,
          desiredEvidenceClass: rule.evidenceClass,
          evidenceClass: rule.evidenceClass,
          evidenceUse: rule.evidenceUse,
          relevanceTier: rule.evidenceUse === 'negative_control_candidate' ? 'negative_control' : 'promotion',
          promotionEligible: rule.evidenceUse === 'promotion_candidate',
          negativeControlFinding: rule.evidenceClass === 'negative_control' ? rule.finding : null,
          acceptanceVerdict: rule.finding,
          closureReason: rule.evidenceUse === 'negative_control_candidate' ? 'negative_control_checked' : 'direct_provider_fact_extracted',
          factsExtracted: [{ key: rule.factKey, value: excerpt.slice(0, 260) }],
          strictContextTerms: strictContext.hits,
          evidenceStrength: 'direct_provider_extract',
          providerRoutePlan: {
            evidenceClass: rule.evidenceClass,
            providerRoute: 'direct-provider-existing-pack',
            sourceProviders: [sourceType],
            executableCollectors: [sourceType],
            promotionEligible: rule.evidenceUse === 'promotion_candidate',
            negativeControlIntent: rule.evidenceClass === 'negative_control',
          },
        },
      });
      if (out.length >= 48) return out;
    }
  }
  return out;
}

const OFFICIAL_EXTERNAL_EVIDENCE_SOURCES = Object.freeze(new Set([
  'eia',
  'fmp',
  'fred',
  'polygon',
  'public_planning_source',
  'sec',
  'sec_direct_management_commentary',
  'sec_filings_evidence',
  'dod_contract_awards',
  'usaspending_contract_awards',
]));

const SOURCE_DIVERSITY_PACKS = Object.freeze(new Set([
  'fundamental',
  'industry',
  'issuer-thesis',
  'research',
  'valuation',
]));

function stableRowKey(row = {}, fallbackIndex = 0) {
  return String(row.id || row.evidence_ref || row.source_id || `${row.source_type || 'row'}::${row.kpi_key || row.title || fallbackIndex}`);
}

function rowProviderKey(row = {}) {
  return String(
    row.metadata?.sourceProvider
    || row.metadata?.provider
    || row.metadata?.source
    || row.publisher
    || row.source_type
    || 'unknown'
  ).toLowerCase();
}

function rowDesiredEvidenceClass(row = {}) {
  return String(row.metadata?.desiredEvidenceClass || row.metadata?.evidenceClass || row.evidenceClass || row.source_type || 'unknown')
    .toLowerCase();
}

function isBlockedPublicPlanningRow(row = {}) {
  const text = [
    row.title,
    row.excerpt,
    row.fact_text,
    row.metadata?.excerpt,
    row.metadata?.textExcerpt,
  ].join(' ');
  return row.source_type === 'public_planning_source'
    && /\b(title:\s*just a moment|target url returned error\s+40[036]|forbidden warning|maybe not yet fully loaded)\b/i.test(text);
}

function prioritizePackEvidenceRows(packName, rows = [], limit = 3) {
  const candidates = asArray(rows).filter((row) => !isBlockedPublicPlanningRow(row));
  if (!SOURCE_DIVERSITY_PACKS.has(packName) || candidates.length <= limit) return candidates.slice(0, limit);

  const selected = [];
  const seen = new Set();
  const add = (row, index = 0) => {
    const key = stableRowKey(row, index);
    if (seen.has(key)) return;
    seen.add(key);
    selected.push(row);
  };

  // Official external providers should not be hidden behind internal proxy KPIs
  // or one provider's fresher rows. Take one representative per provider first.
  const officialProviderKeys = new Set();
  candidates.forEach((row, index) => {
    const sourceType = String(row.source_type || '').toLowerCase();
    const providerKey = rowProviderKey(row);
    if (!OFFICIAL_EXTERNAL_EVIDENCE_SOURCES.has(sourceType) || officialProviderKeys.has(providerKey)) return;
    officialProviderKeys.add(providerKey);
    add(row, index);
  });

  // Then preserve provider/class coverage so one official provider does not
  // only contribute a generic KPI row when it has a more relevant class row.
  const officialProviderClassKeys = new Set();
  candidates.forEach((row, index) => {
    const sourceType = String(row.source_type || '').toLowerCase();
    const providerClassKey = `${rowProviderKey(row)}::${rowDesiredEvidenceClass(row)}`;
    if (!OFFICIAL_EXTERNAL_EVIDENCE_SOURCES.has(sourceType) || officialProviderClassKeys.has(providerClassKey)) return;
    officialProviderClassKeys.add(providerClassKey);
    add(row, index);
  });

  // Preserve source diversity before filling remaining slots by recency/order.
  const sourceTypes = new Set();
  candidates.forEach((row, index) => {
    const sourceKey = `${String(row.source_type || 'unknown').toLowerCase()}::${rowProviderKey(row)}`;
    if (sourceTypes.has(sourceKey)) return;
    sourceTypes.add(sourceKey);
    add(row, index);
  });

  candidates.forEach(add);
  return selected.slice(0, limit);
}

function packRowsToEvidence(packName, rows = [], limit = 3) {
  return prioritizePackEvidenceRows(packName, rows, limit).map((row, index) => evidence(
    `EVID-DEEP-${packName.toUpperCase()}-${row.id || index + 1}`,
    row.title || [row.symbol, row.metric_name].filter(Boolean).join(' ') || row.fact_text || row.excerpt || `${packName} evidence`,
    {
      packName,
      publisher: row.source_type || packName,
      freshnessStatus: row.observed_at || row.published_at || row.created_at ? 'fresh' : 'unknown',
      sourceQualityScore: num(row.confidence ?? row.relevance_score, 0.65),
      row,
    },
  ));
}

function buildGap(packName, reason, query) {
  return {
    packName,
    status: 'gap',
    reason,
    query,
    requiredFor: 'institutional_depth',
  };
}

const INVESTMENT_MEMO_MIN_ARTICLES = envInt('REPORT_INVESTMENT_MIN_ARTICLES', 30, 1, 1_000);
const TRIAGE_MIN_ARTICLES = envInt('REPORT_TRIAGE_MIN_ARTICLES', 10, 1, INVESTMENT_MEMO_MIN_ARTICLES);
const INVESTMENT_MEMO_MIN_CORE_PACKS = envInt('REPORT_INVESTMENT_MIN_CORE_PACKS', 4, 1, 5);
const INVESTMENT_MEMO_MIN_SOURCE_DIVERSITY = Math.max(
  0,
  Math.min(1, Number(process.env.REPORT_INVESTMENT_MIN_SOURCE_DIVERSITY || 0.8)),
);

function metricValue(bundle, name) {
  const metric = asArray(bundle.metrics).find((item) => item.name === name || item.metricId === name);
  const parsed = Number(metric?.value);
  return Number.isFinite(parsed) ? parsed : null;
}

function packEvidenceRows(pack = {}) {
  return [
    ...asArray(pack.rows),
    ...asArray(pack.fundamentals),
    ...asArray(pack.valuations),
    ...asArray(pack.cards),
    ...asArray(pack.analogues),
    ...asArray(pack.edges),
  ];
}

function sourceKindFromRow(row = {}, packName = 'bundle') {
  const metadata = safeMetadata(row.metadata);
  return slugify(
    row.source_type
    || row.sourceType
    || row.source
    || row.publisher
    || row.kind
    || row.edgeType
    || metadata.sourceType
    || metadata.provider
    || metadata.adapter
    || metadata.source
    || metadata.publisher
    || packName,
  );
}

function sourceRefFromRow(row = {}) {
  const metadata = safeMetadata(row.metadata);
  return compactText(
    row.evidence_ref
    || row.evidenceRef
    || row.primary_doc_url
    || row.primaryDocUrl
    || row.url
    || row.source_url
    || row.sourceUrl
    || metadata.url
    || metadata.sourceUrl
    || metadata.primaryDocUrl
    || metadata.evidenceRef
    || '',
  );
}

function buildResearchSourceDiversityProfile(bundle = {}, packs = {}) {
  const summary = bundle.sourceSummary || {};
  const newsSourceDiversity = Math.max(0, Math.min(1, Number(summary.sourceDiversityScore ?? summary.source_diversity_score ?? 0)));
  const summaryDistinctSources = Number(summary.distinctSources ?? summary.distinct_sources ?? 0);
  const sourceKinds = new Set();
  const sourceRefs = new Set();
  let rowCount = 0;

  const addRow = (row = {}, packName = 'bundle') => {
    if (!row || typeof row !== 'object') return;
    rowCount += 1;
    const kind = sourceKindFromRow(row, packName);
    if (kind && kind !== 'unknown') sourceKinds.add(kind);
    const ref = sourceRefFromRow(row);
    if (ref) sourceRefs.add(ref);
  };

  asArray(bundle.evidence).forEach((row) => addRow(row, 'bundleEvidence'));
  Object.entries(packs || {}).forEach(([packName, pack]) => {
    if (packName === 'issuerThesisPack') return;
    packEvidenceRows(pack).forEach((row) => addRow(row, packName));
  });

  const corePacks = ['marketPack', 'fundamentalPack', 'filingPack', 'transcriptPack', 'industryPack'];
  const availableCorePacks = corePacks.filter((packName) => packs[packName]?.status === 'available');
  const sourceKindCount = sourceKinds.size;
  const sourceRefCount = sourceRefs.size;
  const kindScore = Math.min(1, sourceKindCount / 7);
  const refScore = Math.max(
    Math.min(1, sourceRefCount / 12),
    Math.min(1, summaryDistinctSources / 12),
  );
  const volumeScore = Math.min(1, rowCount / 24);
  const corePackScore = Math.min(1, availableCorePacks.length / corePacks.length);
  let researchSourceDiversity = (
    0.35 * kindScore
    + 0.25 * refScore
    + 0.20 * volumeScore
    + 0.20 * corePackScore
  );

  if (sourceKindCount < 3 || availableCorePacks.length < 3) researchSourceDiversity = Math.min(researchSourceDiversity, 0.7);
  if (rowCount < 8) researchSourceDiversity = Math.min(researchSourceDiversity, 0.65);
  researchSourceDiversity = Math.round(Math.max(0, Math.min(1, researchSourceDiversity)) * 1000) / 1000;
  const effectiveSourceDiversity = Math.max(newsSourceDiversity, researchSourceDiversity);

  return {
    newsSourceDiversity,
    researchSourceDiversity,
    effectiveSourceDiversity: Math.round(effectiveSourceDiversity * 1000) / 1000,
    sourceKindCount,
    sourceRefCount,
    rowCount,
    summaryDistinctSources,
    availableCorePackCount: availableCorePacks.length,
    basis: researchSourceDiversity > newsSourceDiversity ? 'deep_research_pack_provenance' : 'news_source_summary',
  };
}

function rowDateMs(row = {}) {
  const raw = row.period_end || row.observed_at || row.transcript_at || row.filed_at || row.published_at || row.created_at || row.asOf || row.as_of;
  const parsed = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowYearSpan(rows = []) {
  const dates = asArray(rows).map(rowDateMs).filter((value) => value > 0).sort((a, b) => a - b);
  if (dates.length < 2) return dates.length ? 0.1 : 0;
  return Math.max(0, (dates[dates.length - 1] - dates[0]) / (365.25 * 24 * 60 * 60 * 1000));
}

function rowSymbolCount(rows = []) {
  return new Set(asArray(rows)
    .map((row) => String(row.symbol || row.ticker || row.metadata?.symbol || '').toUpperCase())
    .filter(Boolean)).size;
}

function rowNumericCount(rows = []) {
  return asArray(rows).filter((row) => Number.isFinite(Number(row.value_num ?? row.numeric_value ?? row.value))).length;
}

function rowSourceProfile(rows = [], packName = 'institutionalEvidencePack') {
  const sourceKinds = new Set();
  const sourceRefs = new Set();
  for (const row of asArray(rows)) {
    const kind = sourceKindFromRow(row, packName);
    const ref = sourceRefFromRow(row);
    if (kind && kind !== 'unknown') sourceKinds.add(kind);
    if (ref) sourceRefs.add(ref);
  }
  return {
    sourceKindCount: sourceKinds.size,
    sourceRefCount: sourceRefs.size,
    sourceKinds: [...sourceKinds].slice(0, 8),
  };
}

function dimensionScore({ rowCount = 0, sourceKindCount = 0, sourceRefCount = 0, symbolCount = 0, yearSpan = 0, numericCount = 0 } = {}, target = {}) {
  const rowScore = ratio(rowCount, target.minRows || 1, 0);
  const sourceScore = Math.max(ratio(sourceKindCount, target.minSourceKinds || 1, 0), ratio(sourceRefCount, target.minSourceRefs || 1, 0));
  const symbolScore = target.minSymbols ? ratio(symbolCount, target.minSymbols, 0) : 1;
  const spanScore = target.minYears ? ratio(yearSpan, target.minYears, 0) : 1;
  const numericScore = target.minNumericRows ? ratio(numericCount, target.minNumericRows, 0) : 1;
  return Math.round((
    0.30 * rowScore
    + 0.20 * sourceScore
    + 0.20 * symbolScore
    + 0.15 * spanScore
    + 0.15 * numericScore
  ) * 1000) / 1000;
}

function dimensionStatus(score) {
  if (score >= 0.85) return 'decision_grade';
  if (score >= 0.6) return 'review_grade';
  if (score >= 0.35) return 'triage_grade';
  return 'gap';
}

function evidenceRowsForDimension(bundle = {}, rows = {}, packs = {}, dimensionKey = '') {
  switch (dimensionKey) {
    case 'long_horizon_history':
      return [
        ...asArray(rows.trendHistory),
        ...asArray(packs.historicalAnalogPack?.analogues),
        ...asArray(rows.historicalAnalogs),
      ];
    case 'issuer_fundamental_table':
      return [
        ...asArray(rows.fundamentals),
        ...asArray(packs.issuerThesisPack?.cards),
      ];
    case 'valuation_expectation_table':
      return [
        ...asArray(rows.valuations),
        ...asArray(packs.issuerThesisPack?.cards).filter((card) => card.dataFlags?.hasValuation || card.dataFlags?.hasConsensus),
      ];
    case 'controlled_market_validation':
      return [
        ...asArray(bundle.marketReactions),
        ...asArray(packs.marketPack?.rows),
      ];
    case 'primary_management_commentary':
      return asArray(rows.transcripts).filter((row) => !/proxy/i.test(`${row.source_type || ''} ${row.metadata?.proxyCaveat || ''}`));
    case 'industry_operating_kpis':
      return [
        ...asArray(rows.industry),
        ...asArray(packs.industryPack?.rows),
      ];
    case 'filing_primary_evidence':
      return [
        ...asArray(rows.filings),
        ...asArray(packs.filingPack?.rows),
      ];
    case 'policy_geopolitical_evidence':
      return [
        ...asArray(rows.policy),
        ...asArray(packs.policyPack?.rows),
      ];
    case 'causal_mechanism_validation':
      return [
        ...asArray(packs.causalPack?.edges),
        ...asArray(rows.causalEdges),
      ];
    default:
      return [];
  }
}

function institutionalEvidenceDimensions(bundle = {}, issuerUniverseSymbols = []) {
  const reportType = String(bundle.reportType || '');
  const subject = String(bundle.subject?.displayName || bundle.subject?.subjectId || '').toLowerCase();
  const issuerTarget = reportType === 'symbol_signal_report' ? 1 : Math.max(2, Math.min(4, issuerUniverseSymbols.length || 3));
  const isCrossTheme = isCrossThemeDiscoveryReport(bundle);
  const crossThemeClassified = isCrossTheme ? crossThemeBodyEvidence(bundle).classified : [];
  const crossThemePromotionRows = crossThemeClassified.filter((row) => row.promotionEligible);
  const crossThemeMechanismRows = crossThemePromotionRows.filter((row) => [
    'supplier_capacity',
    'technical_qualification',
    'procurement_trigger',
    'substitution_limit',
  ].includes(row.desiredEvidenceClass));
  const isOps = reportType === 'system_quality_report';
  const policyHeavy = /defense|geopolitic|policy|regulation|sanction|procurement|energy|space/.test(subject);
  const base = [
    {
      key: 'long_horizon_history',
      label: 'Long-horizon history',
      target: { minRows: 24, minYears: 5, minSourceKinds: 1, minNumericRows: 12 },
      query: 'historical cycle past regime market outcome long-term trend data',
      decisionUse: 'separates one-period noise from repeatable cycle context',
    },
    {
      key: 'issuer_fundamental_table',
      label: 'Issuer fundamentals table',
      target: { minRows: issuerTarget * 4, minSymbols: issuerTarget, minSourceKinds: 1, minNumericRows: issuerTarget * 3 },
      query: 'issuer revenue margin EPS capex backlog segment fundamentals',
      decisionUse: 'connects the theme to revenue, margin, cash flow, and capex lines',
    },
    {
      key: 'valuation_expectation_table',
      label: 'Valuation and expectations table',
      target: { minRows: issuerTarget * 3, minSymbols: issuerTarget, minSourceKinds: 1, minNumericRows: issuerTarget * 2 },
      query: 'valuation multiples consensus estimates revisions peer comparison',
      decisionUse: 'tests whether the theme is already priced or still under-reflected',
    },
    {
      key: 'controlled_market_validation',
      label: 'Controlled market validation',
      target: { minRows: Math.max(5, issuerTarget * 2), minSymbols: Math.min(issuerTarget, 3), minSourceKinds: 1, minNumericRows: Math.max(5, issuerTarget * 2) },
      query: 'event study abnormal return benchmark sector factor regime controls',
      decisionUse: 'keeps raw price moves separate from repeatable theme sensitivity',
    },
    {
      key: 'primary_management_commentary',
      label: 'Primary management commentary',
      target: { minRows: issuerTarget, minSymbols: issuerTarget, minSourceKinds: 1 },
      query: 'earnings call transcript management commentary guidance demand supply capacity',
      decisionUse: 'anchors the thesis in direct issuer language rather than secondary interpretation',
    },
    {
      key: 'industry_operating_kpis',
      label: 'Industry operating KPIs',
      target: { minRows: 8, minSourceKinds: 2, minNumericRows: 5 },
      query: 'industry KPI demand supply capacity utilization orders backlog pricing',
      decisionUse: 'tests whether the theme exists in operating data rather than headlines',
    },
    {
      key: 'filing_primary_evidence',
      label: 'Primary filings evidence',
      target: { minRows: issuerTarget, minSymbols: Math.min(issuerTarget, 3), minSourceKinds: 1 },
      query: '10-K 10-Q MD&A risk factor capex segment guidance filing evidence',
      decisionUse: 'adds audited or issuer-filed evidence for durability and risk framing',
    },
    {
      key: 'causal_mechanism_validation',
      label: 'Mechanism validation',
      target: { minRows: 3, minSourceKinds: 2 },
      query: 'causal mechanism transmission path bottleneck dependency validation',
      decisionUse: 'turns adjacency into a tested transmission path',
      syntheticRows: crossThemeMechanismRows,
    },
  ];
  if (policyHeavy || isCrossTheme) {
    base.push({
      key: 'policy_geopolitical_evidence',
      label: 'Policy and geopolitical evidence',
      target: { minRows: 4, minSourceKinds: 2 },
      query: 'policy budget procurement sanctions regulation geopolitical catalyst evidence',
      decisionUse: 'connects macro or policy catalysts to operating and issuer exposure',
    });
  }
  if (isCrossTheme) {
    base.push({
      key: 'cross_theme_connector_evidence',
      label: 'Cross-theme connector evidence',
      target: { minRows: 4, minSourceKinds: 2 },
      query: 'connector component supplier capacity qualification substitution bottleneck evidence',
      decisionUse: 'proves the connector is not just a coincidental graph edge',
      syntheticRows: crossThemePromotionRows,
    });
  }
  return isOps ? base.filter((dimension) => ['long_horizon_history', 'industry_operating_kpis'].includes(dimension.key)) : base;
}

function buildInstitutionalEvidencePack(bundle = {}, rows = {}, packs = {}, options = {}) {
  const issuerUniverseSymbols = asArray(options.issuerUniverseSymbols);
  const dimensions = institutionalEvidenceDimensions(bundle, issuerUniverseSymbols).map((definition) => {
    const evidenceRows = [
      ...evidenceRowsForDimension(bundle, rows, packs, definition.key),
      ...asArray(definition.syntheticRows),
    ];
    const sourceProfile = rowSourceProfile(evidenceRows, definition.key);
    const profile = {
      key: definition.key,
      label: definition.label,
      rowCount: evidenceRows.length,
      numericRowCount: rowNumericCount(evidenceRows),
      symbolCount: rowSymbolCount(evidenceRows),
      yearSpan: Math.round(rowYearSpan(evidenceRows) * 10) / 10,
      ...sourceProfile,
      target: definition.target,
      decisionUse: definition.decisionUse,
      query: `${subjectDisplay(bundle)} ${definition.query}`.replace(/\s+/g, ' ').trim(),
    };
    const score = dimensionScore(profile, definition.target);
    return {
      ...profile,
      score,
      status: dimensionStatus(score),
    };
  });
  const decisionGradeCount = dimensions.filter((dimension) => dimension.status === 'decision_grade').length;
  const reviewGradeCount = dimensions.filter((dimension) => ['decision_grade', 'review_grade'].includes(dimension.status)).length;
  const coverageScore = dimensions.length ? Math.round((dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length) * 1000) / 1000 : 0;
  const tableCoverage = dimensions.length ? Math.round(ratio(reviewGradeCount, dimensions.length, 0) * 1000) / 1000 : 0;
  const primaryCoverage = dimensions.length ? Math.round(ratio(
    dimensions.filter((dimension) => ['primary_management_commentary', 'filing_primary_evidence', 'industry_operating_kpis'].includes(dimension.key) && ['decision_grade', 'review_grade'].includes(dimension.status)).length,
    dimensions.filter((dimension) => ['primary_management_commentary', 'filing_primary_evidence', 'industry_operating_kpis'].includes(dimension.key)).length || 1,
    0,
  ) * 1000) / 1000 : 0;
  const longHorizon = dimensions.find((dimension) => dimension.key === 'long_horizon_history') || null;
  const blockingDimensions = dimensions.filter((dimension) => !['decision_grade', 'review_grade'].includes(dimension.status));
  const tier = coverageScore >= 0.85 && blockingDimensions.length === 0
    ? 'institutional_decision_grade'
    : coverageScore >= 0.65 && blockingDimensions.length <= 2
      ? 'institutional_review_grade'
      : coverageScore >= 0.4
        ? 'institutional_triage_grade'
        : 'institutional_gap';
  return {
    status: coverageScore >= 0.65 ? 'available' : 'gap',
    tier,
    coverageScore,
    tableCoverage,
    primaryEvidenceCoverage: primaryCoverage,
    longHorizonCoverage: longHorizon ? longHorizon.score : 0,
    decisionGradeCount,
    reviewGradeCount,
    dimensionCount: dimensions.length,
    dimensions,
    blockingDimensions: blockingDimensions.slice(0, 8),
    rows: dimensions.map((dimension) => ({
      id: `institutional-evidence-${dimension.key}`,
      title: `${dimension.label} evidence coverage`,
      source_type: 'institutional_evidence_matrix',
      evidence_ref: null,
      value_num: dimension.score,
      unit: 'score',
      fact_text: `${dimension.label}: ${dimension.status} coverage with ${dimension.rowCount} rows, ${dimension.numericRowCount} numeric rows, ${dimension.symbolCount} symbols, ${dimension.sourceKindCount} source groups, and ${dimension.yearSpan} years of span.`,
      metadata: dimension,
    })),
    boundary: 'Measures whether the report has dense tables and long-horizon evidence; it does not create facts or relax evidence gates.',
  };
}

function buildInstitutionalCollectionTasks(bundle = {}, institutionalEvidencePack = {}) {
  return asArray(institutionalEvidencePack.blockingDimensions).slice(0, 8).map((dimension) => collectionTask({
    packName: 'institutionalEvidencePack',
    query: dimension.query,
    reason: `${dimension.label} is ${dimension.status}; collect ${dimension.decisionUse} before treating the memo as dense institutional research.`,
    priority: dimension.score < 0.35 ? 92 : 82,
    collectionKind: 'institutional_evidence_density',
    target: {
      dimensionKey: dimension.key,
      currentScore: dimension.score,
      currentStatus: dimension.status,
      rowCount: dimension.rowCount,
      numericRowCount: dimension.numericRowCount,
      symbolCount: dimension.symbolCount,
      sourceKindCount: dimension.sourceKindCount,
      yearSpan: dimension.yearSpan,
      requiredTarget: dimension.target,
    },
    metadata: {
      requiredFor: 'institutional_evidence_density',
      desiredEvidenceClass: dimension.key,
    },
  }));
}

function rowTime(row = {}) {
  const raw = row.period_end || row.observed_at || row.transcript_at || row.filed_at || row.created_at;
  const parsed = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestMatchingRow(rows = [], symbol = '', patterns = []) {
  const ticker = String(symbol || '').toUpperCase();
  const regexes = asArray(patterns).map((pattern) => (pattern instanceof RegExp ? pattern : new RegExp(String(pattern), 'i')));
  return asArray(rows)
    .filter((row) => String(row.symbol || row.ticker || '').toUpperCase() === ticker)
    .filter((row) => {
      const text = `${row.metric_name || ''} ${row.concept_label || ''} ${row.concept || ''} ${row.title || ''}`;
      return regexes.some((pattern) => pattern.test(text));
    })
    .sort((a, b) => rowTime(b) - rowTime(a))[0] || null;
}

function formatUsd(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const abs = Math.abs(parsed);
  if (abs >= 1_000_000_000) return `$${(parsed / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 1 : 2)}B`;
  if (abs >= 1_000_000) return `$${(parsed / 1_000_000).toFixed(abs >= 100_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${(parsed / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  return `$${parsed.toFixed(2)}`;
}

function formatMetricValue(row = {}) {
  const value = Number(row.value_num ?? row.numeric_value);
  if (!Number.isFinite(value)) return null;
  const metric = String(row.metric_name || row.concept_label || row.concept || '');
  const unit = String(row.unit || '').toLowerCase();
  if (/usd|dollar/.test(unit) || /revenue|income|cash|expenditure|capex|market[_ -]?cap/i.test(metric)) return formatUsd(value);
  if (/ratio/.test(unit) || /margin|roe|current ratio|p\/e|price\/book|ev\/ebitda/i.test(metric)) return `${value.toFixed(Math.abs(value) >= 10 ? 1 : 2)}x`;
  if (/share/.test(unit) || /eps/i.test(metric)) return `$${value.toFixed(2)}`;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${row.unit ? ` ${row.unit}` : ''}`;
}

function rowNumericValue(row = {}) {
  const parsed = Number(row?.value_num ?? row?.numeric_value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSignedPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return `${parsed >= 0 ? '+' : ''}${parsed.toFixed(Math.abs(parsed) >= 10 ? 1 : 2)}%`;
}

function buildIssuerExpectationBridge({
  symbol = '',
  revenue = null,
  revenueEstimate = null,
  pe = null,
  evEbitda = null,
  market = null,
} = {}) {
  const actualRevenue = rowNumericValue(revenue);
  const consensusRevenue = rowNumericValue(revenueEstimate);
  const spreadPct = Number.isFinite(actualRevenue) && Math.abs(actualRevenue) > 0 && Number.isFinite(consensusRevenue)
    ? ((consensusRevenue - actualRevenue) / Math.abs(actualRevenue)) * 100
    : null;
  const hasConsensus = Boolean(revenueEstimate);
  const hasValuationMultiple = Boolean(pe || evEbitda);
  const marketT = Number(market?.tStat);
  const marketAbsT = Math.abs(Number.isFinite(marketT) ? marketT : 0);
  const hasMarket = Boolean(market);
  const marketTier = !hasMarket
    ? 'market evidence missing'
    : marketAbsT >= 1.96
      ? 'market evidence decision-grade'
      : marketAbsT >= 1
        ? 'market evidence screening-grade'
        : 'market evidence weak';
  const tier = hasConsensus && hasValuationMultiple && hasMarket && marketAbsT >= 1.96
    ? 'expectation_validation'
    : hasConsensus && hasValuationMultiple && hasMarket
      ? 'expectation_review'
      : hasConsensus || hasValuationMultiple || hasMarket
        ? 'expectation_context'
        : 'incomplete';
  const parts = [];
  if (hasMarket) {
    parts.push(`${marketTier}: ${Number(market.relativeReturnPct || 0).toFixed(2)}% relative move, t-stat ${Number(market.tStat || 0).toFixed(2)}`);
  }
  if (hasConsensus && revenue) {
    const spreadText = Number.isFinite(spreadPct)
      ? ` (${formatSignedPercent(spreadPct)} spread; period alignment required)`
      : '';
    parts.push(`consensus revenue proxy ${formatMetricValue(revenueEstimate)} vs attached revenue ${formatMetricValue(revenue)}${spreadText}`);
  } else if (hasConsensus) {
    parts.push(`consensus revenue proxy ${formatMetricValue(revenueEstimate)} is attached`);
  }
  const valuationBits = [
    pe ? `P/E ${formatMetricValue(pe)}` : null,
    evEbitda ? `EV/EBITDA ${formatMetricValue(evEbitda)}` : null,
  ].filter(Boolean);
  if (valuationBits.length) parts.push(`valuation multiple context: ${valuationBits.join('; ')}`);
  const missing = [
    hasConsensus ? null : 'consensus revenue proxy',
    hasValuationMultiple ? null : 'valuation multiple',
    hasMarket ? null : 'controlled market read',
  ].filter(Boolean);
  const text = parts.length
    ? `${parts.join('; ')}${missing.length ? `; missing ${missing.join(', ')}` : ''}`
    : `expectation bridge incomplete for ${String(symbol || 'issuer').toUpperCase()}`;
  const interpretation = tier === 'expectation_validation'
    ? 'issuer has enough evidence to test whether market sensitivity, expectations, and valuation context point to the same thesis'
    : tier === 'expectation_review'
      ? 'issuer has enough evidence for review, but not enough for decision-grade expectation translation'
      : tier === 'expectation_context'
        ? 'issuer has partial expectation context; collect missing consensus, valuation, or controlled market evidence'
        : 'issuer cannot yet be translated into expectation or valuation language';
  return {
    tier,
    text,
    interpretation,
    spreadPct: Number.isFinite(spreadPct) ? Math.round(spreadPct * 100) / 100 : null,
    marketTier,
    missing,
  };
}

function issuerRoleForSubject(symbol = '', subject = '') {
  const ticker = String(symbol || '').toUpperCase();
  const lowered = String(subject || '').toLowerCase();
  if (/defense|defence|military|munitions|missile/.test(lowered)) {
    const roles = {
      RTX: 'missile and air-defense exposure, aerospace systems, and supply-chain/program execution risk',
      LMT: 'missile defense, aeronautics, space systems, and backlog-to-revenue conversion',
      NOC: 'space, sensors, missile-defense programs, and segment execution',
      GD: 'shipbuilding, combat systems, aerospace backlog, and yard-throughput execution',
    };
    return roles[ticker] || 'defense-prime exposure through backlog, funded programs, and segment execution';
  }
  return `${ticker || 'Theme'} issuer exposure requiring operating validation`;
}

function issuerKpiRows(rows = [], symbol = '') {
  const ticker = String(symbol || '').toUpperCase();
  return asArray(rows).filter((row) => {
    const rowSymbols = [
      row.symbol,
      row.ticker,
      row.metadata?.symbol,
      ...asArray(row.metadata?.issuerSymbols),
    ].map((item) => String(item || '').toUpperCase()).filter(Boolean);
    return rowSymbols.includes(ticker);
  });
}

function globalThemeKpiRows(rows = []) {
  return asArray(rows).filter((row) => !row.symbol && !row.ticker && !row.metadata?.symbol);
}

function bestMarketReaction(bundle = {}, symbol = '') {
  const ticker = String(symbol || '').toUpperCase();
  return asArray(bundle.marketReactions)
    .filter((row) => String(row.symbol || '').toUpperCase() === ticker)
    .map((row) => ({
      ...row,
      strength: Math.abs(Number(row.tStat || 0)) + Math.abs(Number(row.relativeReturnPct || 0)) / 10,
    }))
    .sort((a, b) => b.strength - a.strength)[0] || null;
}

function buildIssuerThesisPack(bundle = {}, rows = {}, ontologyCoverage = {}) {
  const subject = subjectDisplay(bundle);
  const symbols = issuerSymbolsFromBundle(bundle, ontologyCoverage.issuerUniverseSymbols).slice(0, 8);
  const industryRows = asArray(rows.industry);
  const ontologyKpiKeys = new Set(asArray(ontologyCoverage.kpis).map((row) => String(row.kpiKey || row.kpi_key || '').trim()).filter(Boolean));
  const ontologyKpiNames = asArray(ontologyCoverage.kpis)
    .filter((row) => row.satisfied)
    .map((row) => row.displayName || row.kpiName || row.kpiKey)
    .filter(Boolean);
  const globalKpis = unique([
    ...ontologyKpiNames,
    ...globalThemeKpiRows(industryRows)
      .filter((row) => (
        ontologyKpiKeys.has(String(row.kpi_key || '').trim())
        || String(row.kpi_key || '').startsWith('defense_')
        || row.source_type === 'dod_contract_awards'
      ))
      .map((row) => row.kpi_name || row.kpi_key)
      .filter(Boolean),
  ]);
  const cards = symbols.map((symbol) => {
    const fundamentals = asArray(rows.fundamentals).filter((row) => String(row.symbol || row.ticker || '').toUpperCase() === symbol);
    const valuations = asArray(rows.valuations).filter((row) => String(row.symbol || '').toUpperCase() === symbol);
    const transcripts = asArray(rows.transcripts).filter((row) => (
      String(row.symbol || '').toUpperCase() === symbol
      && !/proxy/i.test(`${row.source_type || ''} ${row.metadata?.proxyCaveat || ''}`)
    ));
    const symbolKpis = issuerKpiRows(industryRows, symbol);
    const revenue = latestMatchingRow(fundamentals, symbol, [/^Revenue$/i, /\bRevenue\b/i, /\bSales\b/i]);
    const operatingIncome = latestMatchingRow(fundamentals, symbol, [/Operating Income/i]);
    const netIncome = latestMatchingRow(fundamentals, symbol, [/Net Income/i]);
    const eps = latestMatchingRow(fundamentals, symbol, [/^EPS$/i]);
    const fcf = latestMatchingRow(fundamentals, symbol, [/Free Cash Flow/i]);
    const capex = latestMatchingRow(fundamentals, symbol, [/Capital Expenditure/i]);
    const revenueEstimate = latestMatchingRow(fundamentals, symbol, [/Analyst Estimated Revenue Avg/i]);
    const pe = latestMatchingRow(valuations, symbol, [/P\/E|price_to_earnings|price-to-earnings/i]);
    const evEbitda = latestMatchingRow(valuations, symbol, [/EV\/EBITDA/i]);
    const close = latestMatchingRow(valuations, symbol, [/Previous Close|latest_price/i]);
    const market = bestMarketReaction(bundle, symbol);
    const expectation = buildIssuerExpectationBridge({ symbol, revenue, revenueEstimate, pe, evEbitda, market });
    const issuerKpiNames = unique(symbolKpis.map((row) => row.kpi_name || row.kpi_key)).slice(0, 6);
    const themeKpiContext = unique(globalKpis).slice(0, 6);
    const partialOperatingBridge = transcripts.length > 0 && fundamentals.length > 0 && themeKpiContext.length > 0;
    const operatingBridge = issuerKpiNames.length
      ? `${symbol} issuer operating bridge: ${issuerKpiNames.join(', ')}`
      : partialOperatingBridge
        ? `${symbol} bridge: management commentary and issuer facts are present; ${symbol} theme-KPI context includes ${themeKpiContext.slice(0, 4).join(', ')}; ${symbol} attribution still requires analyst validation`
        : themeKpiContext.length
          ? `${symbol} issuer operating bridge pending; ${symbol} theme-KPI context includes ${themeKpiContext.slice(0, 4).join(', ')}`
          : `${symbol} issuer operating bridge pending`;
    const dataFlags = {
      hasFundamentals: fundamentals.length > 0,
      hasValuation: valuations.some((row) => !/Previous Volume/i.test(row.metric_name || '')),
      hasConsensus: Boolean(revenueEstimate),
      hasIssuerCommentary: transcripts.length > 0,
      hasThemeKpiContext: themeKpiContext.length > 0,
      hasIssuerOperatingKpi: issuerKpiNames.length > 0,
      hasIssuerOperatingBridge: issuerKpiNames.length > 0 || partialOperatingBridge,
      hasMarketReaction: Boolean(market),
      hasExpectationBridge: expectation.tier === 'expectation_validation' || expectation.tier === 'expectation_review',
    };
    const valuationBridge = [
      revenueEstimate ? `consensus revenue proxy ${formatMetricValue(revenueEstimate)}` : null,
      pe ? `P/E ${formatMetricValue(pe)}` : null,
      evEbitda ? `EV/EBITDA ${formatMetricValue(evEbitda)}` : null,
      close ? `recent price ${formatMetricValue(close)}` : null,
    ].filter(Boolean).join('; ') || 'valuation/consensus bridge is incomplete';
    const fundamentalBridge = [
      revenue ? `revenue ${formatMetricValue(revenue)}` : null,
      operatingIncome ? `operating income ${formatMetricValue(operatingIncome)}` : null,
      netIncome ? `net income ${formatMetricValue(netIncome)}` : null,
      eps ? `EPS ${formatMetricValue(eps)}` : null,
      fcf ? `FCF ${formatMetricValue(fcf)}` : null,
      capex ? `capex ${formatMetricValue(capex)}` : null,
    ].filter(Boolean).slice(0, 4).join('; ') || `${symbol} issuer fundamentals are not yet deep enough`;
    const marketBridge = market
      ? `${Number(market.relativeReturnPct || 0).toFixed(2)}% relative return, t-stat ${Number(market.tStat || 0).toFixed(2)}`
      : 'no calibrated market-reaction row';
    const role = issuerRoleForSubject(symbol, subject);
    return {
      id: `issuer-thesis-${symbol}`,
      symbol,
      title: `${symbol} issuer thesis bridge`,
      source_type: 'issuer_thesis_pack',
      evidence_ref: null,
      observed_at: new Date().toISOString(),
      role,
      fundamentalBridge,
      valuationBridge,
      marketBridge,
      operatingBridge,
      expectationBridge: expectation.text,
      expectationBridgeTier: expectation.tier,
      expectationBridgeInterpretation: expectation.interpretation,
      expectationSpreadPct: expectation.spreadPct,
      kpiEvidence: issuerKpiNames,
      themeKpiContext,
      commentaryCount: transcripts.length,
      dataFlags,
      thesisUse: (dataFlags.hasIssuerOperatingKpi || dataFlags.hasIssuerOperatingBridge) && dataFlags.hasConsensus && dataFlags.hasIssuerCommentary && dataFlags.hasMarketReaction
        ? 'thesis_validation'
        : 'research_prioritization',
      fact_text: `${symbol} thesis bridge: ${role}. ${operatingBridge}. ${fundamentalBridge}. ${valuationBridge}. Market read: ${marketBridge}.`,
      metadata: {
        role,
        fundamentalBridge,
        valuationBridge,
        marketBridge,
        operatingBridge,
        expectationBridge: expectation.text,
        expectationBridgeTier: expectation.tier,
        expectationBridgeInterpretation: expectation.interpretation,
        expectationSpreadPct: expectation.spreadPct,
        kpiEvidence: issuerKpiNames,
        themeKpiContext,
        dataFlags,
        commentaryCount: transcripts.length,
        marketReactionId: market?.reactionId || null,
      },
    };
  });
  const coverage = cards.length
    ? cards.reduce((sum, card) => sum + Object.values(card.dataFlags).filter(Boolean).length / Object.keys(card.dataFlags).length, 0) / cards.length
    : 0;
  return {
    status: cards.length ? 'available' : 'gap',
    cards,
    coverage: Math.round(coverage * 1000) / 1000,
    consensusSymbols: cards.filter((card) => card.dataFlags.hasConsensus).map((card) => card.symbol),
    valuationSymbols: cards.filter((card) => card.dataFlags.hasValuation).map((card) => card.symbol),
    missingConsensusSymbols: cards.filter((card) => !card.dataFlags.hasConsensus).map((card) => card.symbol),
    missingValuationSymbols: cards.filter((card) => !card.dataFlags.hasValuation).map((card) => card.symbol),
    boundary: 'Issuer thesis cards translate existing evidence into company-level research hypotheses; they are not recommendations.',
  };
}

function crossThemeThemes(bundle = {}) {
  const candidate = bundle.metadata?.candidate || {};
  const candidateThemes = asArray(candidate.themes).filter(Boolean);
  const subjectMetadataThemes = asArray(bundle.subject?.metadata?.themes).filter(Boolean);
  const subjectThemes = asArray(bundle.subject?.themes).filter(Boolean);
  const adjacentThemes = asArray(bundle.metadata?.adjacentCandidate?.metadata?.themes).filter(Boolean);
  return unique(
    candidateThemes.length ? candidateThemes
      : subjectMetadataThemes.length ? subjectMetadataThemes
        : adjacentThemes.length ? adjacentThemes
    : subjectThemes,
  ).filter(Boolean);
}

function strictOntologyIssuerSymbols(bundle = {}) {
  const themes = crossThemeThemes(bundle);
  const symbols = themes.flatMap((theme) => {
    const profile = discoveryProfileForTheme({ themeId: theme, themeLabel: theme, metadata: { theme } });
    return asArray(profile.entries).map((entry) => entry.symbol).filter(Boolean);
  });
  return filterIssuerSymbols(unique(symbols));
}

function crossThemeDiscovery(bundle = {}) {
  const candidate = bundle.metadata?.candidate || {};
  const summary = candidate.evidence_summary || candidate.evidenceSummary || {};
  return candidate.discovery || summary.discovery || bundle.subject?.metadata?.discovery || bundle.metadata?.discovery || {};
}

function inferredIssuerSymbolsFromEvidence(bundle = {}) {
  const text = asArray(bundle.evidence)
    .map((row) => `${row.title || ''} ${row.publisher || ''} ${row.summary || ''} ${row.fact_text || ''}`)
    .join(' ')
    .toLowerCase();
  const matches = [
    [/l3harris|aerojet rocketdyne|aerojet\b/, 'LHX'],
    [/northrop grumman|\bnorthrop\b/, 'NOC'],
    [/lockheed martin|\blockheed\b/, 'LMT'],
    [/raytheon|\brtx\b/, 'RTX'],
    [/general dynamics/, 'GD'],
  ];
  return matches.filter(([pattern]) => pattern.test(text)).map(([, symbol]) => symbol);
}

function crossThemeIssuerUniverse(bundle = {}, ontologyCoverage = {}, rows = {}) {
  if (useScopedIssuerEvidence(bundle)) {
    return filterIssuerSymbols(unique([
      ...strictOntologyIssuerSymbols(bundle),
      ...asArray(bundle.metadata?.promotionUniverse),
      ...inferredIssuerSymbolsFromEvidence(bundle),
    ]), {
      excludeSymbols: ontologyCoverage.excludedSymbols || [],
    }).slice(0, 24);
  }
  const discovery = crossThemeDiscovery(bundle);
  const themes = crossThemeThemes(bundle);
  const ontologySupplierSymbols = themes.flatMap((theme) => {
    const profile = discoveryProfileForTheme({ themeId: theme, themeLabel: theme, metadata: { theme } });
    return asArray(profile.entries).map((entry) => entry.symbol).filter(Boolean);
  });
  const symbols = unique([
    ...asArray(ontologyCoverage.issuerUniverseSymbols),
    ...asArray(rows.symbols),
    ...asArray(bundle.issuerUniverse),
    ...asArray(bundle.metadata?.issuerUniverse),
    ...asArray(bundle.metadata?.candidateIssuerUniverse),
    ...asArray(bundle.metadata?.promotionUniverse),
    ...asArray(bundle.metadata?.issuerDiscoveryMap).map((row) => row?.symbol),
    ...asArray(bundle.marketReactions).map((row) => row.symbol),
    discovery.symbol,
    discovery.ticker,
    ...ontologySupplierSymbols,
    ...inferredIssuerSymbolsFromEvidence(bundle),
  ]).map((symbol) => String(symbol || '').toUpperCase()).filter(Boolean);
  return filterIssuerSymbols(symbols, {
    excludeSymbols: ontologyCoverage.excludedSymbols || [],
  }).slice(0, 24);
}

function crossThemeEvidenceClassLabel(evidenceClass = '') {
  return String(evidenceClass || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function crossThemeClassValidationNeed(evidenceClass = '') {
  return ({
    supplier_capacity: 'capacity, facility, throughput, or production-line evidence tied to the connector',
    technical_qualification: 'qualification, certification, test, material, or technical substitution evidence',
    procurement_trigger: 'contract award, funding, procurement, budget, or program-timing evidence',
    substitution_limit: 'evidence that substitutes are scarce, slow to qualify, or not redundant',
    issuer_exposure: 'issuer-level backlog, segment, guidance, supplier, or customer exposure evidence',
    negative_control: 'invalidator evidence covering easy substitutes, supplier redundancy, or no timing pressure',
  })[evidenceClass] || 'class-specific operating evidence';
}

function crossThemeEvidenceClassQuery(connector = '', evidenceClass = '', themes = []) {
  const quotedConnector = connector ? `"${String(connector).replace(/"/g, '').trim()}"` : '"cross-theme connector"';
  const themeSuffix = asArray(themes).slice(0, 2).join(' ');
  return ({
    supplier_capacity: `${quotedConnector} production capacity facility throughput supplier ${themeSuffix}`,
    technical_qualification: `${quotedConnector} qualified supplier technical qualification certification energetic materials ${themeSuffix}`,
    procurement_trigger: `${quotedConnector} procurement contract award funding budget program trigger ${themeSuffix}`,
    substitution_limit: `${quotedConnector} substitute alternative supplier redundancy sole source hard to substitute ${themeSuffix}`,
    issuer_exposure: `${quotedConnector} issuer exposure revenue segment guidance backlog book-to-bill ${themeSuffix}`,
    negative_control: `${quotedConnector} easy substitutes supplier redundancy no capacity constraint non-qualified supplier no procurement timing`,
  })[evidenceClass]?.replace(/\s+/g, ' ').trim() || `${quotedConnector} operating evidence ${themeSuffix}`.replace(/\s+/g, ' ').trim();
}

function negativeControlOutcome(row = {}) {
  const metadata = row.metadata || {};
  const finding = String(
    row.negativeControlFinding
    || metadata.negativeControlFinding
    || metadata.negativeControl?.finding
    || metadata.finding
    || '',
  ).toLowerCase();
  if (/invalidator|reject|invalidated/.test(finding)) return 'invalidator';
  if (/supported_constraint|constraint_supported|support/.test(finding)) return 'supported_constraint';
  if (/checked_no_direct|no_direct|checked/.test(finding)) return 'checked_no_direct';
  const text = String(row.text || `${row.title || ''} ${row.summary || ''} ${row.fact_text || ''}`).toLowerCase();
  if (/\b(limited qualified substitutes?|no near-term supplier redundancy|hard to substitute|sole source|single source|non-qualified supplier|qualification constraint|chemical constraint|chokepoint|bottleneck)\b/i.test(text)) return 'supported_constraint';
  if (/\b(easy substitutes?|supplier redundancy|redundant capacity|no capacity constraint|no procurement timing|alternative suppliers?)\b/i.test(text)) return 'invalidator';
  return 'checked_no_direct';
}

function negativeControlStatusFromRows(rows = []) {
  const negativeRows = asArray(rows).filter((row) => row.desiredEvidenceClass === 'negative_control' && row.crossThemeRole === 'negative_control');
  if (!negativeRows.length) return 'unchecked';
  if (negativeRows.some((row) => negativeControlOutcome(row) === 'invalidator')) return 'invalidated';
  if (negativeRows.some((row) => negativeControlOutcome(row) === 'supported_constraint')) return 'supported_constraint';
  return 'checked_no_direct';
}

function reportNegativeControlRows(rows = {}) {
  return asArray(rows.research)
    .filter((row) => {
      const metadata = row.metadata || {};
      return metadata.desiredEvidenceClass === 'negative_control'
        || metadata.evidenceClass === 'negative_control'
        || metadata.evidenceUse === 'negative_control_candidate';
    })
    .map((row) => ({
      ...row,
      desiredEvidenceClass: 'negative_control',
      crossThemeRole: 'negative_control',
      text: row.fact_text || row.excerpt || row.text,
      sourceQueryEvidenceUse: row.metadata?.evidenceUse || 'negative_control_candidate',
    }));
}

function matrixStatusForRows(evidenceClass = '', rows = []) {
  const relevant = asArray(rows);
  if (evidenceClass === 'negative_control' && relevant.some((row) => negativeControlOutcome(row) === 'invalidator')) return 'invalidated';
  if (relevant.some((row) => row.promotionEligible)) return 'promotion_eligible';
  if (relevant.some((row) => row.crossThemeFit?.label === 'high' && row.bodyEligible)) return 'high_fit';
  if (relevant.some((row) => row.direct && row.bodyEligible)) return 'direct';
  if (relevant.some((row) => row.bodyEligible || ['supporting_context', 'weak_noise', 'negative_control_candidate'].includes(row.sourceQueryEvidenceUse))) return 'context';
  return 'missing';
}

function promotionEligibleForMatrixStatus(status = '') {
  return ['promotion_eligible', 'high_fit', 'direct'].includes(status);
}

function buildCrossThemeEvidenceMatrix(bundle = {}, options = {}) {
  const classified = asArray(options.classifiedRows).length
    ? asArray(options.classifiedRows)
    : crossThemeBodyEvidence(bundle).classified;
  const connector = subjectDisplay(bundle);
  const themes = crossThemeThemes(bundle);
  const requiredClassList = unique([
    ...asArray(options.requiredEvidenceClasses),
    ...asArray(options.discoveryQuality?.metrics?.requiredEvidenceClasses),
  ]).filter(Boolean);
  const classList = requiredClassList.length ? requiredClassList : DISCOVERY_EVIDENCE_CLASSES;
  return classList.map((evidenceClass) => {
    const rows = classified.filter((row) => row.desiredEvidenceClass === evidenceClass);
    const eligibleRows = evidenceClass === 'negative_control'
      ? rows.filter((row) => row.crossThemeRole === 'negative_control')
      : rows.filter((row) => row.promotionEligible);
    const contextRows = rows.filter((row) => row.bodyEligible || ['supporting_context', 'weak_noise', 'negative_control_candidate'].includes(row.sourceQueryEvidenceUse));
    const sourceGroups = unique([...eligibleRows, ...contextRows].map((row) => row.sourceGroup).filter(Boolean));
    const directCount = rows.filter((row) => row.direct && row.bodyEligible).length;
    const highFitCount = rows.filter((row) => row.crossThemeFit?.label === 'high' && row.bodyEligible).length;
    const promotionEligibleCount = evidenceClass === 'negative_control' ? 0 : eligibleRows.filter((row) => row.promotionEligible).length;
    const status = matrixStatusForRows(evidenceClass, rows);
    return {
      evidenceClass,
      label: crossThemeEvidenceClassLabel(evidenceClass),
      status,
      rowCount: rows.length,
      directCount,
      highFitCount,
      promotionEligibleCount,
      sourceGroups,
      evidenceIds: eligibleRows.slice(0, 5).map((row) => row.evidenceId || row.evidence_id).filter(Boolean),
      validationNeed: crossThemeClassValidationNeed(evidenceClass),
      missingReason: status === 'missing'
        ? `${crossThemeEvidenceClassLabel(evidenceClass)} evidence has not reached context/direct threshold.`
        : null,
      nextQuery: crossThemeEvidenceClassQuery(connector, evidenceClass, themes),
      rows: eligibleRows.slice(0, 5).map((row) => ({
        evidenceId: row.evidenceId || row.evidence_id,
        title: row.title,
        publisher: row.publisher,
        sourceGroup: row.sourceGroup,
        direct: row.direct,
        fit: row.crossThemeFit?.label || 'unknown',
        promotionEligible: Boolean(row.promotionEligible),
      })),
    };
  });
}

function marketTierScore(tier = '') {
  if (tier === 'decision_grade') return 1;
  if (tier === 'screening_grade') return 0.65;
  if (tier === 'watchlist_grade') return 0.4;
  return 0;
}

const CROSS_THEME_ISSUER_PATTERNS = [
  { symbol: 'LHX', issuer: 'L3Harris', issuerBridgeRole: 'bottleneck_owner', exposureType: 'rocket motor supplier / Aerojet exposure', patterns: [/l3harris|l3 harris|aerojet/i] },
  { symbol: 'NOC', issuer: 'Northrop Grumman', issuerBridgeRole: 'bottleneck_owner', exposureType: 'solid rocket motor qualification and missile/space systems exposure', patterns: [/northrop grumman|\bnorthrop\b/i] },
  { symbol: 'LMT', issuer: 'Lockheed Martin', issuerBridgeRole: 'customer_pass_through', exposureType: 'missile and air-defense demand exposure', patterns: [/lockheed martin|\blockheed\b|\blmt\b/i] },
  { symbol: 'RTX', issuer: 'RTX', issuerBridgeRole: 'customer_pass_through', exposureType: 'missile, propulsion, and air-defense program exposure', patterns: [/\brtx\b|raytheon/i] },
  { symbol: 'GD', issuer: 'General Dynamics', issuerBridgeRole: 'unclear', exposureType: 'munitions and defense production exposure needing issuer-specific validation', patterns: [/general dynamics|\bgd\b/i] },
  { symbol: 'RKLB', issuer: 'Rocket Lab', issuerBridgeRole: 'beneficiary', exposureType: 'space launch and vertical-integration exposure', patterns: [/rocket lab|\brklb\b/i] },
];

function issuerHitsFromText(text = '') {
  return CROSS_THEME_ISSUER_PATTERNS
    .filter((issuer) => issuer.patterns.some((pattern) => pattern.test(text)))
    .map((issuer) => issuer.symbol);
}

function issuerProfile(symbol = '') {
  return CROSS_THEME_ISSUER_PATTERNS.find((issuer) => issuer.symbol === String(symbol || '').toUpperCase())
    || { symbol: String(symbol || '').toUpperCase(), issuer: String(symbol || '').toUpperCase(), issuerBridgeRole: 'unclear', exposureType: 'issuer exposure requires classification' };
}

const DIRECT_ISSUER_BRIDGE_CLASSES = new Set([
  'issuer_exposure',
  'capex_confirmation',
  'cloud_revenue',
  'accelerator_orders',
  'compute_demand',
  'power_constraint',
  'grid_interconnection',
  'data_center_utilization',
  'supplier_capacity',
  'substitution_limit',
  'operating_kpi',
]);

const OPERATING_ANCHOR_CLASSES = new Set([
  ...DIRECT_ISSUER_BRIDGE_CLASSES,
  'mechanism_validation',
  'technical_qualification',
  'procurement_trigger',
  'policy_funding',
  'mission_award',
]);

function roleAllowsDirectIssuerBridge(role = 'unclear', evidenceClass = '') {
  const normalizedRole = String(role || 'unclear').replace(/-/g, '_').toLowerCase();
  const klass = String(evidenceClass || '').toLowerCase();
  if (klass === 'issuer_exposure') return true;
  if (['issuer_commentary', 'primary_filing'].includes(klass)) return normalizedRole !== 'unclear';
  if (['demand_owner', 'infrastructure_operator'].includes(normalizedRole)) {
    return [
      'capex_confirmation',
      'cloud_revenue',
      'compute_demand',
      'power_constraint',
      'grid_interconnection',
      'data_center_utilization',
    ].includes(klass);
  }
  if (['equipment_supplier', 'service_or_epc', 'capacity_owner'].includes(normalizedRole)) {
    return [
      'supplier_capacity',
      'operating_kpi',
      'power_constraint',
      'grid_interconnection',
      'capex_confirmation',
      'substitution_limit',
      'technical_qualification',
      'procurement_trigger',
      'policy_funding',
      'mission_award',
    ].includes(klass);
  }
  if (normalizedRole === 'customer_pass_through') {
    return ['issuer_exposure', 'capex_confirmation', 'cloud_revenue'].includes(klass);
  }
  return false;
}

function rowSymbolCandidates(row = {}) {
  const metadata = safeMetadata(row.metadata);
  const nested = safeMetadata(metadata.row);
  const values = [
    row.symbol,
    row.ticker,
    row.issuerSymbol,
    row.issuer_symbol,
    metadata.symbol,
    metadata.ticker,
    metadata.issuerSymbol,
    metadata.issuer_symbol,
    nested.symbol,
    nested.ticker,
    nested.issuerSymbol,
    nested.issuer_symbol,
  ];
  return filterIssuerSymbols(unique(values.map((value) => String(value || '').toUpperCase()).filter(Boolean)));
}

function issuerHitsForRow(row = {}, allowedSymbols = []) {
  const allowed = new Set(filterIssuerSymbols(asArray(allowedSymbols).map((symbol) => String(symbol || '').toUpperCase())));
  const text = `${row.text || ''} ${row.title || ''} ${row.summary || ''} ${row.fact_text || ''} ${row.excerpt || ''}`;
  const symbols = unique([
    ...rowSymbolCandidates(row),
    ...issuerHitsFromText(text),
  ]).map((symbol) => String(symbol || '').toUpperCase()).filter(Boolean);
  const filtered = filterIssuerSymbols(symbols);
  if (!allowed.size) return filtered;
  return filtered.filter((symbol) => allowed.has(symbol));
}

function issuerActionEvidenceBySymbol(classified = [], issuerSymbols = [], roleBySymbol = new Map()) {
  const map = new Map();
  for (const row of asArray(classified)) {
    const hits = issuerHitsForRow(row, issuerSymbols);
    const hasSymbolEvidence = hits.length > 0;
    const operatingAnchor = hasSymbolEvidence
      && row.promotionEligible
      && OPERATING_ANCHOR_CLASSES.has(row.desiredEvidenceClass);
    if (!operatingAnchor) continue;
    for (const symbol of hits) {
      const directIssuer = DIRECT_ISSUER_BRIDGE_CLASSES.has(row.desiredEvidenceClass)
        && roleAllowsDirectIssuerBridge(roleBySymbol.get(symbol) || 'unclear', row.desiredEvidenceClass);
      if (!map.has(symbol)) map.set(symbol, { directIssuerRows: [], operatingRows: [] });
      const bucket = map.get(symbol);
      if (directIssuer) bucket.directIssuerRows.push(row);
      bucket.operatingRows.push(row);
    }
  }
  return map;
}

function issuerAcceptanceCriteria(symbol = '', connector = '') {
  const profile = issuerProfile(symbol);
  return `direct evidence that ${profile.issuer} has ${connector} exposure through backlog, segment revenue, guidance, supplier/customer link, or management commentary`;
}

function autoIssuerBridgeRows(packs = {}, directIssuerSymbols = []) {
  const direct = new Set(asArray(directIssuerSymbols).map((symbol) => String(symbol || '').toUpperCase()));
  return asArray(packs.issuerDiscoveryPack?.rows).map((row) => {
    const symbol = String(row.symbol || '').toUpperCase();
    const directAttached = direct.has(symbol);
    const status = directAttached
      ? 'issuer_exposure_attached'
      : (row.status === 'market_attached'
        ? 'market_attached'
        : row.status === 'issuer_exposure_attached'
          ? 'exposure_collecting'
          : row.status || 'candidate');
    return {
      symbol,
      issuer: row.issuerName || symbol,
      issuerBridgeRole: row.role || 'unclear',
      exposureType: row.whyRelated || 'auto-discovered related issuer candidate',
      status,
      confidence: row.confidence,
      sourceTerms: asArray(row.sourceTerms),
      sourceTypes: asArray(row.sourceTypes),
      requiredValidation: directAttached
        ? 'validate whether the attached direct exposure changes economics, backlog, guidance, or market sensitivity'
        : (row.nextValidation || issuerAcceptanceCriteria(symbol, 'the connector')),
      promotionEligible: directAttached,
      candidateOnly: !directAttached,
    };
  }).filter((row) => row.symbol);
}

function buildCrossThemeActionBridge(bundle = {}, rows = {}, packs = {}, ontologyCoverage = {}, investmentReadiness = {}) {
  if (!isCrossThemeDiscoveryReport(bundle)) return null;
  const discoveryQuality = computeCrossThemeDiscoveryQuality(bundle);
  const classified = [
    ...crossThemeBodyEvidence(bundle).classified,
    ...asArray(packs.evidenceClassExtractionPack?.rows).map((row) => classifyCrossThemeEvidence(row, bundle)),
  ];
  const discovery = crossThemeDiscovery(bundle);
  const connector = subjectDisplay(bundle);
  const themes = crossThemeThemes(bundle);
  const themeText = themes.length ? themes.join(' + ') : 'connected themes';
  const evidenceMatrix = buildCrossThemeEvidenceMatrix(bundle, { discoveryQuality, classifiedRows: classified });
  const negativeControlStatus = negativeControlStatusFromRows([...classified, ...reportNegativeControlRows(rows)]);
  const negativeControlReady = ['supported_constraint', 'checked_no_direct', 'checked_alternative_or_mitigation'].includes(negativeControlStatus);
  const negativeControlChecked = ['supported_constraint', 'checked_no_direct', 'checked_alternative_or_mitigation'].includes(negativeControlStatus);
  const coveredClasses = evidenceMatrix
    .filter((item) => promotionEligibleForMatrixStatus(item.status)
      || (item.evidenceClass === 'negative_control' && negativeControlChecked))
    .map((item) => item.evidenceClass);
  const missingClasses = evidenceMatrix
    .filter((item) => !coveredClasses.includes(item.evidenceClass) || item.status === 'invalidated')
    .map((item) => item.evidenceClass);
  const issuerSymbols = crossThemeIssuerUniverse(bundle, ontologyCoverage, rows);
  const issuerCards = asArray(packs.issuerThesisPack?.cards)
    .filter((card) => issuerSymbols.includes(String(card.symbol || '').toUpperCase()));
  const candidateIssuerSymbols = unique([
    ...issuerSymbols,
    ...asArray(packs.issuerDiscoveryPack?.candidateIssuerUniverse),
    ...asArray(packs.issuerDiscoveryPack?.rows).map((row) => row.symbol),
  ]).map((symbol) => String(symbol || '').toUpperCase()).filter(Boolean);
  const roleBySymbol = new Map(asArray(packs.issuerDiscoveryPack?.rows)
    .map((row) => [String(row.symbol || '').toUpperCase(), row.role || 'unclear'])
    .filter(([symbol]) => Boolean(symbol)));
  const issuerEvidenceBySymbol = issuerActionEvidenceBySymbol(classified, candidateIssuerSymbols, roleBySymbol);
  const directIssuerMapSymbols = asArray(packs.issuerDiscoveryPack?.rows)
    .filter((row) => row.promotionEligible === true
      || ['issuer_exposure_attached', 'market_attached'].includes(String(row.status || '')))
    .map((row) => String(row.symbol || '').toUpperCase())
    .filter(Boolean);
  const directIssuerSymbols = unique([
    ...directIssuerMapSymbols,
    ...[...issuerEvidenceBySymbol.entries()]
    .filter(([, evidence]) => evidence.directIssuerRows.length)
      .map(([symbol]) => symbol),
  ]);
  const operatingIssuerSymbols = unique([...issuerEvidenceBySymbol.entries()]
    .filter(([, evidence]) => evidence.operatingRows.length)
    .map(([symbol]) => symbol));
  const marketValidation = investmentReadiness.marketValidation || {};
  const marketRows = asArray(marketValidation.rows)
    .filter((row) => directIssuerSymbols.includes(String(row.symbol || '').toUpperCase()));
  const issuerBridgeCount = directIssuerSymbols.length;
  const issuerOperatingAnchorCount = operatingIssuerSymbols.length;
  const autoDiscoveredIssuers = autoIssuerBridgeRows(packs, directIssuerSymbols);
  const issuerDiscoverySummary = packs.issuerDiscoveryPack?.summary || null;
  const issuerTranslationScore = issuerBridgeCount
    ? Math.min(1, 0.65 + 0.35 * (issuerBridgeCount / Math.max(1, Math.min(3, issuerSymbols.length || issuerBridgeCount))))
    : (issuerOperatingAnchorCount ? 0.55 : (issuerSymbols.length ? 0.45 : 0));
  const marketTranslationScore = marketRows.length && issuerBridgeCount
    ? Math.max(marketTierScore(marketValidation.tier), 0.4)
    : 0;
  const promotableMatrixRows = evidenceMatrix.filter((item) => item.evidenceClass !== 'negative_control');
  const evidenceClassCoverage = Math.min(1, coveredClasses.filter((klass) => klass !== 'negative_control').length / Math.max(1, promotableMatrixRows.length));
  const coreActionClasses = new Set(DISCOVERY_EVIDENCE_CLASSES.filter((klass) => klass !== 'negative_control'));
  const coreActionRows = evidenceMatrix.filter((item) => coreActionClasses.has(item.evidenceClass));
  const coreEvidenceClassCoverage = Math.min(1, coreActionRows
    .filter((item) => coveredClasses.includes(item.evidenceClass))
    .length / Math.max(1, coreActionRows.length));
  const scoreEvidenceClassCoverage = Math.max(evidenceClassCoverage, coreEvidenceClassCoverage);
  const actionPlanCompleteness = Math.min(1, evidenceMatrix.filter((item) => item.validationNeed).length / Math.max(1, evidenceMatrix.length));
  const negativeControlScore = ({
    supported_constraint: 1,
    checked_no_direct: 0.65,
    checked_alternative_or_mitigation: 0.65,
    invalidated: 0,
    unchecked: 0,
  })[negativeControlStatus] ?? 0;
  const score = Math.round((
    0.35 * Math.max(0, Math.min(1, scoreEvidenceClassCoverage))
    + 0.25 * issuerTranslationScore
    + 0.05 * marketTranslationScore
    + 0.20 * negativeControlScore
    + 0.15 * actionPlanCompleteness
  ) * 1000) / 1000;
  const tier = score >= 0.8 && issuerBridgeCount && marketRows.length && negativeControlReady
    ? 'analyst_action_review_ready'
    : score >= 0.55 && issuerBridgeCount
      ? 'issuer_follow_up_ready'
    : score >= 0.35
      ? 'discovery_to_action_bridge'
        : 'source_expansion_only';
  const label = ({
    analyst_action_review_ready: 'Analyst action bridge ready',
    issuer_follow_up_ready: 'Issuer follow-up ready',
    discovery_to_action_bridge: 'Discovery-to-action bridge',
    source_expansion_only: 'Source expansion only',
  })[tier] || tier;
  const exposedIssuers = issuerSymbols.map((symbol) => {
    const card = issuerCards.find((item) => String(item.symbol || '').toUpperCase() === symbol);
    const evidence = issuerEvidenceBySymbol.get(symbol) || { directIssuerRows: [], operatingRows: [] };
    const directIssuerRows = evidence.directIssuerRows || [];
    const operatingRows = evidence.operatingRows || [];
    const evidenceRows = directIssuerRows.length ? directIssuerRows : operatingRows;
    const market = marketRows.find((item) => String(item.symbol || '').toUpperCase() === symbol);
    const profile = issuerProfile(symbol);
    const hasDirectBridge = Boolean(directIssuerRows.length);
    const hasOperatingAnchor = Boolean(operatingRows.length);
    const status = hasDirectBridge
      ? 'issuer_exposure_attached'
      : (hasOperatingAnchor ? 'operating_anchor_attached' : 'follow_up_required');
    return {
      symbol,
      issuer: profile.issuer,
      issuerBridgeRole: profile.issuerBridgeRole || 'unclear',
      exposureType: card?.role || profile.exposureType,
      status,
      operatingBridge: hasOperatingAnchor
        ? `${symbol} has connector-specific ${unique(operatingRows.map((row) => crossThemeEvidenceClassLabel(row.desiredEvidenceClass))).join(', ')} anchor evidence; issuer-level economics still need validation`
        : (card?.operatingBridge || 'issuer operating bridge requires direct evidence'),
      expectationBridge: card?.expectationBridge || 'issuer expectation bridge requires fundamentals, consensus, valuation, or market evidence',
      marketBridge: market
        ? `${Number(market.relativeReturnPct || 0).toFixed(2)}% relative return, t-stat ${Number(market.tStat || 0).toFixed(2)}`
        : 'controlled market row not attached',
      supportingEvidenceIds: evidenceRows.slice(0, 5).map((row) => row.evidenceId || row.evidence_id).filter(Boolean),
      requiredValidation: hasDirectBridge
        ? 'validate whether connector exposure changes backlog, segment revenue, guidance, capacity, or market sensitivity'
        : (hasOperatingAnchor
          ? 'convert operating anchor into issuer exposure with backlog, segment revenue, guidance, supplier/customer, or management commentary'
          : issuerAcceptanceCriteria(symbol, connector)),
      promotionEligible: hasDirectBridge,
    };
  });
  const rowsOut = [
    ...evidenceMatrix.map((item) => ({
      id: `cross-theme-action-${item.evidenceClass}`,
      title: `${item.label} action bridge`,
      source_type: 'cross_theme_action_bridge',
      evidence_ref: item.evidenceIds.join(',') || null,
      fact_text: `${item.label}: ${item.status}; ${item.validationNeed}.`,
      value_num: item.rowCount,
      unit: 'rows',
      connector,
      theme: themeText,
      evidenceClass: item.evidenceClass,
      issuer: null,
      symbol: null,
      exposureType: 'evidence_class',
      requiredValidation: item.validationNeed,
      promotionEligible: promotionEligibleForMatrixStatus(item.status),
      metadata: item,
    })),
    ...exposedIssuers.map((issuer) => ({
      id: `cross-theme-action-issuer-${issuer.symbol}`,
      title: `${issuer.symbol} issuer translation`,
      source_type: 'cross_theme_action_bridge',
      evidence_ref: issuer.symbol,
      fact_text: `${issuer.symbol}: ${issuer.status}; ${issuer.requiredValidation}.`,
      value_num: issuer.promotionEligible ? 1 : 0,
      unit: 'binary',
      connector,
      theme: themeText,
      evidenceClass: 'issuer_exposure',
      issuer: issuer.issuer,
      symbol: issuer.symbol,
      exposureType: issuer.exposureType,
      requiredValidation: issuer.requiredValidation,
      promotionEligible: issuer.promotionEligible,
      metadata: issuer,
    })),
    ...autoDiscoveredIssuers.map((issuer) => ({
      id: `cross-theme-auto-issuer-${issuer.symbol}`,
      title: `${issuer.symbol} auto-discovered related issuer`,
      source_type: 'cross_theme_auto_issuer_map',
      evidence_ref: issuer.symbol,
      fact_text: `${issuer.symbol}: ${issuer.status}; ${issuer.requiredValidation}.`,
      value_num: issuer.promotionEligible ? 1 : 0,
      unit: 'binary',
      connector,
      theme: themeText,
      evidenceClass: 'issuer_discovery_map',
      issuer: issuer.issuer,
      symbol: issuer.symbol,
      exposureType: issuer.exposureType,
      requiredValidation: issuer.requiredValidation,
      promotionEligible: false,
      metadata: issuer,
    })),
  ];
  const validationTasks = [
    ...missingClasses.map((evidenceClass) => ({
      evidenceClass,
      query: `${connector} ${crossThemeClassValidationNeed(evidenceClass)} ${themeText}`.replace(/\s+/g, ' ').trim(),
      reason: `${crossThemeEvidenceClassLabel(evidenceClass)} is missing from the cross-theme action bridge.`,
    })),
    ...exposedIssuers.filter((issuer) => issuer.status === 'follow_up_required').map((issuer) => ({
      evidenceClass: 'issuer_exposure',
      symbol: issuer.symbol,
      query: `${issuer.symbol} ${connector} backlog segment guidance management commentary`,
      reason: `${issuer.symbol} is an ontology/evidence-linked issuer but lacks an issuer thesis bridge.`,
    })),
    ...autoDiscoveredIssuers
      .filter((issuer) => issuer.candidateOnly && issuer.status !== 'rejected_or_invalidated')
      .slice(0, 8)
      .map((issuer) => ({
        evidenceClass: 'issuer_exposure',
        symbol: issuer.symbol,
        query: `${issuer.symbol} ${connector} exposure segment backlog guidance customer supplier management commentary`,
        reason: `${issuer.symbol} is auto-discovered as a related issuer candidate but lacks direct issuer exposure evidence.`,
      })),
  ];
  return {
    status: 'available',
    tier,
    label,
    score,
    connector,
    themes,
    mechanism: discovery.mechanism || null,
    discoveryTier: discoveryQuality?.tier || null,
    evidenceClassCoverage: Math.round(evidenceClassCoverage * 1000) / 1000,
    coveredClasses,
    missingClasses,
    negativeControlStatus,
    evidenceMatrix,
    exposedIssuers,
    autoDiscoveredIssuers,
    autoIssuerGroups: packs.issuerDiscoveryPack?.groups || [],
    issuerBridgeSummary: issuerDiscoverySummary,
    marketTranslation: {
      status: marketRows.length ? 'attached' : 'follow_up_required',
      tier: marketValidation.tier || 'not_attached',
      rowCount: marketRows.length,
      interpretation: marketRows.length
        ? 'market rows can help prioritize issuer follow-up; portfolio action remains analyst-gated'
        : 'discovery may be valid while tradable expression remains undefined',
    },
    metrics: {
      issuerTranslationScore,
      marketTranslationScore,
      negativeControlScore,
      actionPlanCompleteness,
      evidenceClassCoverage: Math.round(evidenceClassCoverage * 1000) / 1000,
      coreEvidenceClassCoverage: Math.round(coreEvidenceClassCoverage * 1000) / 1000,
      issuerCount: issuerSymbols.length,
      issuerBridgeCount,
      issuerOperatingAnchorCount,
      candidateIssuerCount: num(issuerDiscoverySummary?.candidateIssuerCount, autoDiscoveredIssuers.filter((row) => row.candidateOnly).length),
      probableExposureCount: num(issuerDiscoverySummary?.probableExposureCount, autoDiscoveredIssuers.filter((row) => row.status === 'probable_exposure').length),
      bridgeAttachedCount: num(issuerDiscoverySummary?.bridgeAttachedCount, autoDiscoveredIssuers.filter((row) => row.status === 'issuer_exposure_attached').length),
      issuerMappingGapCount: num(issuerDiscoverySummary?.issuerMappingGapCount, autoDiscoveredIssuers.filter((row) => row.candidateOnly && row.status !== 'rejected_or_invalidated').length),
      marketRowCount: marketRows.length,
      negativeControlStatus,
      missingClasses,
    },
    rows: rowsOut,
    validationTasks,
    boundary: 'Translates a cross-theme discovery into issuer, market, and validation follow-up; it is not a buy/sell/price-target engine.',
  };
}

function marketSampleSize(row = {}) {
  const direct = Number(row.sampleSize ?? row.sample_size ?? row.nControls ?? row.n_controls);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const fromControls = asArray(row.controls)
    .map(String)
    .map((item) => item.match(/(?:sample_size|sample|n_controls|n)=([0-9.]+)/i)?.[1])
    .find(Boolean);
  const parsed = Number(fromControls);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function marketControlContext(row = {}) {
  const controls = asArray(row.controls).map(String);
  const joined = controls.join(' ').replace(/[_-]+/g, ' ');
  const hasOnlySampleStats = controls.length > 0
    && controls.every((item) => /^(sample_size|sample|n_controls|n|hit_rate)=/i.test(item));
  return {
    hasBenchmarkControl: /\bbenchmark|SPY|QQQ|SOXX|XLI|ITA|sector|peer|basket|matched[_ -]?controls?|control[_ -]?group\b/i.test(joined),
    hasFactorControl: /\bfactor|beta|market beta|rates?|duration|regime|risk[- ]?on|risk[- ]?off\b/i.test(joined),
    hasOnlySampleStats,
    controlCount: controls.length,
  };
}

function marketRegimeConsistency(row = {}, relativeReturnPct = null) {
  const regimes = asArray(row.metadata?.regimeControls?.regimes || row.metadata?.regimes)
    .map((item) => ({
      regime: String(item.regime || 'unknown'),
      horizon: String(item.horizon || row.eventWindow || row.event_window || row.window || row.horizon || 'unknown'),
      avgReturn: Number(item.avg_return ?? item.avgReturn),
      hitRate: Number(item.hit_rate ?? item.hitRate),
      sampleSize: Number(item.sample_size ?? item.sampleSize),
      regimeMultiplier: Number(item.regime_multiplier ?? item.regimeMultiplier),
    }))
    .filter((item) => Number.isFinite(item.avgReturn) && Number.isFinite(item.sampleSize) && item.sampleSize > 0);
  if (!regimes.length) {
    return {
      regimeConsistencyGrade: 'not_attached',
      regimeSupportCount: 0,
      regimeDistinctCount: 0,
      regimeHorizonCount: 0,
      regimeSupportLabel: 'no regime consistency evidence',
      regimeConsistent: false,
    };
  }

  const direction = Number(relativeReturnPct) < 0 ? -1 : 1;
  const supporting = regimes.filter((item) => {
    const sameDirection = direction > 0 ? item.avgReturn > 0 : item.avgReturn < 0;
    const hitRate = Number.isFinite(item.hitRate) ? item.hitRate : 0.5;
    const hitRateSupport = direction > 0 ? hitRate >= 0.55 : hitRate <= 0.45;
    const sampleSupport = item.sampleSize >= 100;
    return sameDirection && hitRateSupport && sampleSupport;
  });
  const distinctRegimes = unique(supporting.map((item) => item.regime));
  const horizons = unique(supporting.map((item) => item.horizon));
  const regimeSupportCount = supporting.length;
  const regimeDistinctCount = distinctRegimes.length;
  const regimeHorizonCount = horizons.length;
  const regimeConsistent = regimeSupportCount >= 2 && regimeDistinctCount >= 2;
  const regimeConsistencyGrade = regimeConsistent
    ? 'regime_consistent_screen'
    : regimeSupportCount
      ? 'partial_regime_support'
      : 'regime_not_supportive';
  const strongest = supporting
    .slice()
    .sort((a, b) => Math.abs(b.avgReturn) - Math.abs(a.avgReturn))[0];
  const directionLabel = direction > 0 ? 'positive' : 'negative';
  const supportBits = [
    `${regimeSupportCount}/${regimes.length} same-direction regime/horizon rows`,
    regimeDistinctCount ? `${regimeDistinctCount} regimes` : null,
    regimeHorizonCount ? `${regimeHorizonCount} horizons` : null,
    strongest ? `strongest ${strongest.regime}/${strongest.horizon} ${Math.round(strongest.avgReturn * 100) / 100}%` : null,
  ].filter(Boolean).join('; ');
  return {
    regimeConsistencyGrade,
    regimeSupportCount,
    regimeDistinctCount,
    regimeHorizonCount,
    regimeSupportLabel: supportBits || `${directionLabel} direction not repeated across regimes`,
    regimeConsistent,
  };
}

const ANOMALOUS_TSTAT_WITHOUT_REGIME = 12;

function marketStatAnomalyReason({ absTStat = 0, regimeSupportCount = 0, regimeConsistent = false } = {}) {
  if (Number(absTStat || 0) >= ANOMALOUS_TSTAT_WITHOUT_REGIME && !regimeConsistent && Number(regimeSupportCount || 0) <= 0) {
    return 'extreme_tstat_without_regime_consistency';
  }
  return null;
}

function buildMarketValidationProfile(bundle = {}, options = {}) {
  const excluded = new Set(['SPY', 'QQQ', 'DIA', 'IWM', 'GLD', 'TLT', 'UUP', 'USO', 'UNG', 'DBC', 'XLE', 'XLK', 'XLV', 'EFA', 'EEM', 'ITA', 'XAR', 'PPA']);
  const restrictToAllowedSymbols = Array.isArray(options.allowedSymbols);
  const allowedSymbols = new Set(filterIssuerSymbols(asArray(options.allowedSymbols).map((symbol) => String(symbol || '').toUpperCase())));
  const rawRows = asArray(bundle.marketReactions)
    .filter((row) => row?.symbol && !excluded.has(String(row.symbol).toUpperCase()))
    .filter((row) => !restrictToAllowedSymbols || allowedSymbols.has(String(row.symbol || '').toUpperCase()))
    .map((row) => {
      const tStat = Number(row.tStat ?? row.t_stat);
      const relativeReturnPct = Number(row.relativeReturnPct ?? row.relative_return_pct);
      const sampleSize = marketSampleSize(row);
      const controls = marketControlContext(row);
      const validationStatus = String(row.validationStatus ?? row.validation_status ?? '').toLowerCase();
      const absTStat = Number.isFinite(tStat) ? Math.abs(tStat) : 0;
      const hasRealControls = controls.hasBenchmarkControl && controls.hasFactorControl && !controls.hasOnlySampleStats;
      const regimeConsistency = marketRegimeConsistency(row, relativeReturnPct);
      const statisticalAnomaly = marketStatAnomalyReason({ absTStat, ...regimeConsistency });
      const decisionGradeBase = validationStatus === 'validated' && absTStat >= 1.96 && sampleSize >= 30 && hasRealControls;
      return {
        symbol: String(row.symbol || '').toUpperCase(),
        eventWindow: row.eventWindow || row.event_window || row.window || row.horizon || null,
        relativeReturnPct: Number.isFinite(relativeReturnPct) ? relativeReturnPct : null,
        tStat: Number.isFinite(tStat) ? tStat : null,
        absTStat,
        sampleSize,
        validationStatus,
        hasBenchmarkControl: controls.hasBenchmarkControl,
        hasFactorControl: controls.hasFactorControl,
        hasRealControls,
        ...regimeConsistency,
        statisticalAnomaly,
        decisionGradeBase,
        decisionGrade: decisionGradeBase && !statisticalAnomaly,
        screeningGrade: validationStatus === 'validated' && absTStat >= 1.25 && sampleSize >= 30,
      };
    });
  const seenRows = new Set();
  const rows = rawRows.filter((row) => {
    const key = [
      row.symbol,
      row.eventWindow || '',
      Number(row.relativeReturnPct || 0).toFixed(4),
      Number(row.tStat || 0).toFixed(4),
      Number(row.sampleSize || 0),
      Boolean(row.decisionGrade),
      Boolean(row.screeningGrade),
      Boolean(row.hasBenchmarkControl),
      Boolean(row.hasFactorControl),
    ].join('|').toLowerCase();
    if (seenRows.has(key)) return false;
    seenRows.add(key);
    return true;
  });
  const decisionRows = rows.filter((row) => row.decisionGrade);
  const screeningRows = rows.filter((row) => row.screeningGrade);
  const weakRows = rows.filter((row) => !row.decisionGrade && !row.screeningGrade);
  const rankMarketRows = (items = []) => [...items].sort((a, b) => {
    const aScore = a.absTStat + Math.abs(Number(a.relativeReturnPct || 0)) / 25;
    const bScore = b.absTStat + Math.abs(Number(b.relativeReturnPct || 0)) / 25;
    return bScore - aScore;
  });
  const headlineRows = decisionRows.length ? decisionRows : (screeningRows.length ? screeningRows : rows);
  const best = rankMarketRows(headlineRows)[0] || null;
  const screenedOutliers = rankMarketRows(rows.filter((row) => row.statisticalAnomaly || (!row.decisionGrade && (row.absTStat >= 1.96 || row.sampleSize < 30)))).slice(0, 6);
  const maxAbsTStat = headlineRows.reduce((max, row) => Math.max(max, row.absTStat || 0), 0);
  const maxSampleSize = rows.reduce((max, row) => Math.max(max, row.sampleSize || 0), 0);
  const controlledRowCount = rows.filter((row) => row.hasRealControls).length;
  const regimeSupportRowCount = rows.filter((row) => row.regimeConsistent).length;
  const statisticalAnomalyCount = rows.filter((row) => row.statisticalAnomaly).length;
  const score = Math.round((
    0.40 * Math.min(1, maxAbsTStat / 2.25)
    + 0.20 * Math.min(1, maxSampleSize / 250)
    + 0.15 * Math.min(1, controlledRowCount / 2)
    + 0.10 * Math.min(1, regimeSupportRowCount / 2)
    + 0.15 * Math.min(1, decisionRows.length / 2)
  ) * 1000) / 1000;
  const tier = decisionRows.length
    ? 'decision_grade'
    : screeningRows.length
      ? 'screening_grade'
      : rows.length
        ? 'weak_screen'
        : 'missing';
  const gap = tier === 'decision_grade'
    ? null
    : tier === 'missing'
      ? (options.missingReason === 'no_direct_issuer_bridge'
        ? 'controlled market validation is missing because no direct issuer bridge is attached'
        : 'controlled market validation is missing')
      : statisticalAnomalyCount
        ? `controlled market validation is ${tier.replace(/_/g, '-')}; ${statisticalAnomalyCount} extreme t-stat row(s) lack regime-consistency support`
        : `controlled market validation is ${tier.replace(/_/g, '-')}; strongest t-stat ${maxAbsTStat.toFixed(2)} is below decision-grade or lacks benchmark/factor/regime controls`;
  return {
    tier,
    score,
    rowCount: rows.length,
    decisionGradeRowCount: decisionRows.length,
    screeningGradeRowCount: screeningRows.length,
    controlledRowCount,
    regimeSupportRowCount,
    statisticalAnomalyCount,
    maxAbsTStat: Math.round(maxAbsTStat * 1000) / 1000,
    maxSampleSize,
    best,
    rows: rows.slice(0, 12),
    screenedOutliers,
    gap,
    missingReason: tier === 'missing' ? options.missingReason || 'no_market_rows' : null,
  };
}

function buildInvestmentReadiness(bundle = {}, packs = {}, deepResearch = {}) {
  const corePacks = ['marketPack', 'fundamentalPack', 'filingPack', 'transcriptPack', 'industryPack'];
  const availableCorePacks = corePacks.filter((packName) => packs[packName]?.status === 'available');
  const articleCount = metricValue(bundle, 'article_count');
  const crossThemeDiscovery = isCrossThemeDiscoveryReport(bundle);
  const ontologyCoverage = deepResearch.ontologyCoverage || {};
  const sourceDiversityProfile = deepResearch.limitations?.sourceDiversityProfile || buildResearchSourceDiversityProfile(bundle, packs);
  const sourceDiversity = Number(sourceDiversityProfile.effectiveSourceDiversity ?? 0);
  const transcriptProxyCount = Number(deepResearch.limitations?.transcriptProxyCount || 0);
  const marketBackfillReactions = asArray(packs.marketPack?.rows)
    .filter((row) => {
      const metadata = row?.metadata || {};
      return metadata.desiredEvidenceClass === 'market_validation' || metadata.marketValidation;
    })
    .map(marketReactionFromEvidenceRow);
  const strictEndogenousMarket = useScopedIssuerEvidence(bundle);
  const strictMarketSymbols = strictEndogenousMarket
    ? asArray(packs.issuerDiscoveryPack?.rows)
      .filter((row) => ['issuer_exposure_attached', 'direct_node_exposure_attached'].includes(row.status))
      .map((row) => row.symbol)
    : [];
  const marketValidation = buildMarketValidationProfile({
    ...bundle,
    marketReactions: [...asArray(bundle.marketReactions), ...marketBackfillReactions],
  }, strictEndogenousMarket ? {
    allowedSymbols: strictMarketSymbols,
    missingReason: !strictMarketSymbols.length ? 'no_direct_issuer_bridge' : null,
  } : {});
  const strictDirectIssuerCount = strictEndogenousMarket ? strictMarketSymbols.length : null;
  const rawDirectTranscriptSymbolCount = Number(deepResearch.limitations?.directTranscriptSymbolCount || 0);
  const directTranscriptSymbolCount = strictEndogenousMarket
    ? Math.min(rawDirectTranscriptSymbolCount, strictDirectIssuerCount || 0)
    : rawDirectTranscriptSymbolCount;
  const rawDirectManagementFromRows = Number(deepResearch.limitations?.directManagementCommentarySymbolCount || rawDirectTranscriptSymbolCount || 0);
  const directManagementFromRows = strictEndogenousMarket
    ? Math.min(rawDirectManagementFromRows, strictDirectIssuerCount || 0)
    : rawDirectManagementFromRows;
  const directManagementCommentarySymbolCount = strictEndogenousMarket
    ? directManagementFromRows
    : Math.max(
      directManagementFromRows,
      Number(ontologyCoverage.directManagementCommentarySymbolCount || 0),
    );
  const requiredTranscriptSymbolCount = Math.max(
    Number(deepResearch.limitations?.requiredTranscriptSymbolCount || 0),
    Number(ontologyCoverage.requiredIssuerCommentarySymbolCount || 0),
  );
  const sampleAdequacy = articleCount == null
    ? (crossThemeDiscovery ? 'cross_theme_discovery' : 'unknown')
    : articleCount >= INVESTMENT_MEMO_MIN_ARTICLES
      ? 'investment_memo'
      : articleCount >= TRIAGE_MIN_ARTICLES
        ? 'triage'
        : 'thin';
  const blockers = [];
  if (availableCorePacks.length < INVESTMENT_MEMO_MIN_CORE_PACKS) {
    blockers.push(`only ${availableCorePacks.length}/${corePacks.length} core investment packs are available`);
  }
  if (sampleAdequacy !== 'investment_memo' && sampleAdequacy !== 'cross_theme_discovery') {
    blockers.push(articleCount == null
      ? 'article sample size is unknown'
      : `article sample is ${articleCount}, below investment memo threshold ${INVESTMENT_MEMO_MIN_ARTICLES}`);
  }
  if (sourceDiversity < INVESTMENT_MEMO_MIN_SOURCE_DIVERSITY) {
    blockers.push(`source diversity ${sourceDiversity.toFixed(2)} is below ${INVESTMENT_MEMO_MIN_SOURCE_DIVERSITY}`);
  }
  if (Number(ontologyCoverage.investmentCriticalGapCount || 0) > 0) {
    const missing = asArray(ontologyCoverage.missingKpis)
      .filter((item) => item.critical && item.requiredFor === 'investment_memo')
      .slice(0, 5)
      .map((item) => item.displayName || item.kpiKey)
      .join(', ');
    blockers.push(`theme ontology critical KPI coverage ${Math.round(Number(ontologyCoverage.requiredKpiCoverage || 0) * 100)}%; missing ${missing || 'theme-specific operating KPIs'}`);
  }
  if (requiredTranscriptSymbolCount > 0 && directManagementCommentarySymbolCount < requiredTranscriptSymbolCount) {
    blockers.push(`direct issuer management-commentary coverage ${directManagementCommentarySymbolCount}/${requiredTranscriptSymbolCount} is below ontology threshold`);
  } else if (transcriptProxyCount > 0 && directManagementCommentarySymbolCount === 0) {
    blockers.push('transcript pack still uses proxy evidence');
  }
  const decisionValidationGaps = marketValidation.gap ? [marketValidation.gap] : [];
  if (strictEndogenousMarket && marketValidation.missingReason === 'no_direct_issuer_bridge') {
    blockers.push('scoped frontier candidate has no direct issuer bridge; market validation cannot attach to issuer actionability yet');
  }
  const tier = blockers.length
    ? 'signal_triage'
    : decisionValidationGaps.length
      ? 'thesis_validation'
    : ontologyCoverage.readinessTier === 'thesis_validation'
      ? 'thesis_validation'
      : 'investment_memo_candidate';
  return {
    tier,
    corePacks,
    availableCorePacks,
    availableCorePackCount: availableCorePacks.length,
    requiredCorePackCount: INVESTMENT_MEMO_MIN_CORE_PACKS,
    articleCount,
    sampleAdequacy,
    sourceDiversity,
    newsSourceDiversity: Number(sourceDiversityProfile.newsSourceDiversity ?? 0),
    researchSourceDiversity: Number(sourceDiversityProfile.researchSourceDiversity ?? 0),
    sourceDiversityBasis: sourceDiversityProfile.basis || 'unknown',
    sourceDiversityProfile,
    transcriptProxyCount,
    marketValidation,
    decisionValidationGaps,
    directTranscriptSymbolCount,
    directManagementCommentarySymbolCount,
    requiredTranscriptSymbolCount,
    ontologyCoverage: {
      ontologyKey: ontologyCoverage.ontologyKey || null,
      ontologyLabel: ontologyCoverage.ontologyLabel || null,
      requiredKpiCoverage: ontologyCoverage.requiredKpiCoverage ?? null,
      investmentCriticalGapCount: ontologyCoverage.investmentCriticalGapCount || 0,
      industryKpiCoverage: ontologyCoverage.industryKpiCoverage ?? null,
      issuerCommentaryCoverage: ontologyCoverage.issuerCommentaryCoverage ?? null,
      readinessTier: ontologyCoverage.readinessTier || null,
    },
    blockers,
    interpretation: tier === 'investment_memo_candidate'
      ? 'The bundle has enough core pack coverage for thesis validation memo review; portfolio use still requires decision-grade mechanism and market validation.'
      : tier === 'thesis_validation'
        ? 'The bundle is ready for thesis validation review, but portfolio use still requires decision-grade mechanism and market validation.'
      : 'The bundle is useful as thematic signal triage and research prioritization, not as a final investment decision memo.',
  };
}

function collectionTask({
  packName,
  query,
  reason,
  severity = 'high',
  priority = 80,
  collectionKind = 'evidence_expansion',
  target = null,
  metadata = {},
}) {
  return {
    packName,
    taskType: 'source_query',
    query: String(query || '').replace(/\s+/g, ' ').trim(),
    reason,
    severity,
    priority,
    collectionPlan: true,
    collectionKind,
    target,
    requiredFor: 'investment_memo_depth',
    metadata: {
      collectionPlan: true,
      collectionKind,
      ...metadata,
    },
  };
}

function buildInvestmentCollectionPlan(bundle = {}, packs = {}, readiness = {}, ontologyCoverage = {}) {
  const name = subjectDisplay(bundle);
  const key = subjectKey(bundle);
  const symbols = issuerSymbolsFromBundle(bundle, ontologyCoverage.issuerUniverseSymbols).slice(0, 8);
  const symbolPhrase = symbols.length ? ` ${symbols.join(' ')}` : '';
  const plan = [];
  const missingCorePacks = asArray(readiness.corePacks).filter((packName) => !asArray(readiness.availableCorePacks).includes(packName));

  if (readiness.sampleAdequacy !== 'investment_memo' && readiness.sampleAdequacy !== 'cross_theme_discovery') {
    plan.push(collectionTask({
      packName: 'evidenceSamplePack',
      query: `${name} ${key} recent industry news adoption deployment demand supply capex customers orders backlog`,
      reason: `Article sample is ${readiness.articleCount ?? 'unknown'}; collect a broader independent evidence sample before treating the report as an investment memo.`,
      priority: 94,
      collectionKind: 'sample_expansion',
      target: { minArticles: INVESTMENT_MEMO_MIN_ARTICLES, currentArticles: readiness.articleCount },
      metadata: { sampleAdequacy: readiness.sampleAdequacy },
    }));
  }

  if (readiness.sourceDiversity < INVESTMENT_MEMO_MIN_SOURCE_DIVERSITY) {
    plan.push(collectionTask({
      packName: 'sourceDiversityPack',
      query: `${name} independent sources customers competitors suppliers regulators industry association procurement deployment`,
      reason: `Source diversity ${readiness.sourceDiversity.toFixed(2)} is below target; collect non-duplicative independent evidence before raising conviction.`,
      priority: 90,
      collectionKind: 'source_diversity_expansion',
      target: { minSourceDiversity: INVESTMENT_MEMO_MIN_SOURCE_DIVERSITY, currentSourceDiversity: readiness.sourceDiversity },
    }));
  }

  for (const packName of missingCorePacks) {
    if (packName === 'marketPack') {
      plan.push(collectionTask({
        packName,
        query: `${name}${symbolPhrase} ETF peer basket price reaction relative performance commodity rates FX regime`,
        reason: 'Market pack is missing or too thin; collect price, peer, and regime evidence before making asset-transmission claims.',
        priority: 88,
        collectionKind: 'market_pack_expansion',
      }));
    } else if (packName === 'fundamentalPack') {
      plan.push(collectionTask({
        packName,
        query: `${name}${symbolPhrase} revenue margin capex guidance valuation comparable companies earnings`,
        reason: 'Fundamental and valuation evidence is missing or too thin; collect company-level facts before writing investment-memo conclusions.',
        priority: 88,
        collectionKind: 'fundamental_pack_expansion',
      }));
    } else if (packName === 'filingPack') {
      plan.push(collectionTask({
        packName,
        query: `${name}${symbolPhrase} SEC 10-K 10-Q MD&A risk factors capex guidance backlog customer demand`,
        reason: 'Filing evidence is missing or too thin; collect primary company disclosures before treating management or risk-factor claims as grounded.',
        priority: 86,
        collectionKind: 'filing_pack_expansion',
      }));
    } else if (packName === 'transcriptPack') {
      plan.push(collectionTask({
        packName,
        query: `${name}${symbolPhrase} earnings call transcript management commentary guidance demand supply capex`,
        reason: 'Transcript evidence is missing or proxy-only; collect management commentary before inferring company-level demand or capex intent.',
        priority: 84,
        collectionKind: 'transcript_pack_expansion',
      }));
    } else if (packName === 'industryPack') {
      plan.push(collectionTask({
        packName,
        query: `${name} industry KPI demand supply capacity utilization orders backlog pricing capex deployment bottleneck`,
        reason: 'Industry KPI evidence is missing or too thin; collect physical demand/supply indicators before interpreting attention as industry-cycle movement.',
        priority: 92,
        collectionKind: 'industry_pack_expansion',
      }));
    }
  }

  if (readiness.availableCorePackCount < readiness.requiredCorePackCount) {
    plan.push(collectionTask({
      packName: 'corePackExpansion',
      query: `${name} thesis evidence market fundamentals filings transcript industry KPI historical analog causal mechanism`,
      reason: `Only ${readiness.availableCorePackCount}/${readiness.corePacks?.length || 5} core investment packs are available; collect cross-pack evidence to make the next report deeper.`,
      priority: 82,
      collectionKind: 'core_pack_expansion',
      target: {
        minCorePacks: readiness.requiredCorePackCount,
        availableCorePacks: readiness.availableCorePacks,
      },
    }));
  }

  const transcriptCoverageShortfall = Number(readiness.requiredTranscriptSymbolCount || 0) > Number(readiness.directManagementCommentarySymbolCount || readiness.directTranscriptSymbolCount || 0);
  if ((Number(readiness.transcriptProxyCount || 0) > 0 || transcriptCoverageShortfall) && !missingCorePacks.includes('transcriptPack')) {
    plan.push(collectionTask({
      packName: 'transcriptPack',
      query: `${name}${symbolPhrase} earnings call transcript management commentary backlog book-to-bill contract awards guidance`,
      reason: transcriptCoverageShortfall
        ? `Direct management-commentary coverage is ${readiness.directManagementCommentarySymbolCount || 0}/${readiness.requiredTranscriptSymbolCount || 0}; collect issuer commentary for more monitored symbols before upgrading to investment memo.`
        : 'Transcript pack is currently proxy-based; collect issuer management commentary before upgrading from signal triage to investment memo.',
      priority: 84,
      collectionKind: 'transcript_proxy_replacement',
      target: {
        proxyRows: readiness.transcriptProxyCount,
        directTranscriptSymbolCount: readiness.directTranscriptSymbolCount || 0,
        directManagementCommentarySymbolCount: readiness.directManagementCommentarySymbolCount || 0,
        requiredTranscriptSymbolCount: readiness.requiredTranscriptSymbolCount || 0,
        desiredEvidence: 'direct_management_commentary',
      },
    }));
  }

  if (readiness.marketValidation?.tier && readiness.marketValidation.tier !== 'decision_grade') {
    plan.push(collectionTask({
      packName: 'marketValidationPack',
      query: `${name}${symbolPhrase} controlled event study abnormal return benchmark sector factor regime controls`,
      reason: readiness.marketValidation.gap || 'Market validation is not decision-grade; recompute controlled event studies before using the memo for investment conclusions.',
      priority: 89,
      collectionKind: 'controlled_market_validation',
      target: {
        currentTier: readiness.marketValidation.tier,
        maxAbsTStat: readiness.marketValidation.maxAbsTStat,
        desiredEvidence: 'benchmark_factor_regime_controlled_event_study',
      },
    }));
  }

  plan.push(...buildOntologyBackfillTasks(ontologyCoverage, { subject: name }));

  const seen = new Set();
  return plan.filter((task) => {
    if (!task.query) return false;
    const keyValue = `${task.packName}::${task.query.toLowerCase()}`;
    if (seen.has(keyValue)) return false;
    seen.add(keyValue);
    return true;
  }).slice(0, 12);
}

function ontologyEvaluationOptions(rows, kpiState, issuerUniverseSymbols, transcriptRows, backfillRows = {}) {
  return {
    rows,
    kpiState,
    symbols: issuerUniverseSymbols,
    transcripts: transcriptRows,
    packEvidenceRows: {
      evidencePack: backfillRows.research || [],
      marketPack: [...asArray(backfillRows.market), ...asArray(backfillRows.fundamental), ...asArray(backfillRows.research)],
      fundamentalPack: [...asArray(backfillRows.fundamental), ...asArray(backfillRows.research)],
      filingPack: [...asArray(backfillRows.filing), ...asArray(backfillRows.research)],
      industryPack: [...asArray(backfillRows.industry), ...asArray(backfillRows.research)],
      transcriptPack: [...asArray(backfillRows.transcript), ...asArray(backfillRows.research)],
      policyPack: [...asArray(backfillRows.policy), ...asArray(backfillRows.research)],
    },
  };
}

function evaluateReportOntologyCoverage(bundle = {}, options = {}) {
  const subjectThemes = asArray(bundle.subject?.metadata?.themes)
    .map((theme) => String(theme || '').trim())
    .filter((theme) => theme && !/^\d+$/.test(theme));
  if (bundle.reportType !== 'cross_theme_bottleneck_report' || subjectThemes.length < 2) {
    return evaluateOntologyCoverage(bundle, options);
  }
  const coverages = subjectThemes.map((theme) => evaluateOntologyCoverage({
    ...bundle,
    subject: {
      ...(bundle.subject || {}),
      subjectId: theme,
      displayName: theme,
      metadata: {
        ...(bundle.subject?.metadata || {}),
        theme,
      },
    },
  }, options));
  const required = coverages.reduce((sum, item) => sum + num(item.requiredKpiCount, 0), 0);
  const satisfied = coverages.reduce((sum, item) => sum + num(item.satisfiedKpiCount, 0), 0);
  const missingKpis = coverages.flatMap((coverage) => asArray(coverage.missingKpis).map((gap) => ({
    ...gap,
    ontologyKey: gap.ontologyKey || coverage.ontologyKey,
    ontologyLabel: coverage.ontologyLabel,
    displayName: `${coverage.ontologyLabel || coverage.ontologyKey || 'Theme'}: ${gap.displayName || gap.kpiKey}`,
  })));
  const kpis = coverages.flatMap((coverage) => asArray(coverage.kpis).map((kpi) => ({
    ...kpi,
    ontologyKey: kpi.ontologyKey || coverage.ontologyKey,
    ontologyLabel: coverage.ontologyLabel,
  })));
  const investmentCriticalGapCount = missingKpis.filter((item) => item.critical && item.requiredFor === 'investment_memo').length;
  const thesisCriticalGapCount = missingKpis.filter((item) => item.critical).length;
  const blockers = unique(coverages.flatMap((coverage) => asArray(coverage.blockers)));
  const issuerUniverseSymbols = unique(coverages.flatMap((coverage) => asArray(coverage.issuerUniverseSymbols)));
  const requiredIssuerCommentarySymbolCount = Math.max(...coverages.map((coverage) => num(coverage.requiredIssuerCommentarySymbolCount, 0)), 0);
  const directManagementCommentarySymbolCount = Math.max(...coverages.map((coverage) => num(coverage.directManagementCommentarySymbolCount, 0)), 0);
  const industryRequired = kpis.filter((item) => item.dataPack === 'industryPack').length;
  const industrySatisfied = kpis.filter((item) => item.dataPack === 'industryPack' && item.satisfied).length;
  const readinessTier = blockers.length
    ? 'signal_triage'
    : thesisCriticalGapCount
      ? 'thesis_validation'
      : 'investment_memo_candidate';
  return {
    version: coverages[0]?.version || 'theme-ontology',
    ontologyKey: 'cross_theme_combined',
    ontologyLabel: coverages.map((coverage) => coverage.ontologyLabel || coverage.ontologyKey).join(' + '),
    matchedArchetypes: unique(coverages.flatMap((coverage) => asArray(coverage.matchedArchetypes))),
    isGenericFallback: coverages.every((coverage) => coverage.isGenericFallback),
    requiredKpiCount: required,
    satisfiedKpiCount: satisfied,
    requiredKpiCoverage: Math.round(ratio(satisfied, required, required ? 0 : 1) * 1000) / 1000,
    investmentCriticalGapCount,
    thesisCriticalGapCount,
    issuerUniverseSymbols,
    excludedSymbols: unique(coverages.flatMap((coverage) => asArray(coverage.excludedSymbols))),
    directManagementCommentarySymbolCount,
    requiredIssuerCommentarySymbolCount,
    issuerCommentaryCoverage: Math.round(ratio(directManagementCommentarySymbolCount, requiredIssuerCommentarySymbolCount, requiredIssuerCommentarySymbolCount ? 0 : 1) * 1000) / 1000,
    industryKpiCoverage: Math.round(ratio(industrySatisfied, industryRequired, industryRequired ? 0 : 1) * 1000) / 1000,
    anchorFitDistribution: coverages.reduce((acc, coverage) => {
      for (const [key, value] of Object.entries(coverage.anchorFitDistribution || {})) acc[key] = (acc[key] || 0) + Number(value || 0);
      return acc;
    }, { high: 0, medium: 0, low: 0, unknown: 0 }),
    topAnchorFits: coverages.flatMap((coverage) => asArray(coverage.topAnchorFits)).slice(0, 8),
    kpis,
    missingKpis,
    blockers,
    readinessTier,
    componentCoverages: coverages.map((coverage) => ({
      ontologyKey: coverage.ontologyKey,
      ontologyLabel: coverage.ontologyLabel,
      requiredKpiCoverage: coverage.requiredKpiCoverage,
      investmentCriticalGapCount: coverage.investmentCriticalGapCount,
      readinessTier: coverage.readinessTier,
    })),
    boundary: 'combined cross-theme ontology coverage; each connected theme contributes its own KPI gates',
  };
}

function buildDeepResearchSummary(bundle = {}, rows = {}) {
  const fallbackMarketCount = asArray(bundle.marketReactions).length;
  const fallbackResearchCount = adjacentLanePlaybookFromBundle(bundle)
    ? 0
    : asArray(bundle.evidence).filter((item) => /openalex|arxiv|paper|research|patent/i.test(`${item.kind} ${item.publisher} ${item.title}`)).length;
  const transcriptRows = asArray(rows.transcripts);
  const issuerUniverseSymbols = issuerSymbolsFromBundle(bundle, rows.symbols);
  const directTranscriptRows = transcriptRows.filter((row) => (
    (!row.symbol || issuerUniverseSymbols.includes(String(row.symbol).toUpperCase()))
    &&
    !/proxy/i.test(`${row.source_type} ${row.metadata?.proxyCaveat || ''}`)
    && (
      row.metadata?.directTranscriptEvidence === true
      || row.metadata?.directTranscriptEvidence === 'true'
      || /earning[_-]?call|transcript/i.test(`${row.source_type} ${row.topic}`)
    )
  ));
  const directManagementCommentaryRows = transcriptRows.filter((row) => (
    (!row.symbol || issuerUniverseSymbols.includes(String(row.symbol).toUpperCase()))
    &&
    !/proxy/i.test(`${row.source_type} ${row.metadata?.proxyCaveat || ''}`)
    && (
      row.metadata?.directTranscriptEvidence === true
      || row.metadata?.directTranscriptEvidence === 'true'
      || row.metadata?.directManagementCommentaryEvidence === true
      || row.metadata?.directManagementCommentaryEvidence === 'true'
      || /direct_management_commentary|earnings[_-]?release|8-k direct management/i.test(`${row.source_type} ${row.topic}`)
    )
  ));
  const transcriptProxyRows = transcriptRows.filter((row) => /proxy/i.test(`${row.source_type} ${row.metadata?.proxyCaveat || ''}`));
  const transcriptProxyCount = directManagementCommentaryRows.length ? 0 : transcriptProxyRows.length;
  const directTranscriptSymbolCount = new Set(directTranscriptRows.map((row) => String(row.symbol || '').toUpperCase()).filter(Boolean)).size;
  const directManagementCommentarySymbolCount = new Set(directManagementCommentaryRows.map((row) => String(row.symbol || '').toUpperCase()).filter(Boolean)).size;
  const kpiState = rows.genericKpis || {};
  const kpiGaps = asArray(kpiState.gaps).slice(0, 20);
  const kpiCoverage = Number.isFinite(Number(kpiState.coverage)) ? Number(kpiState.coverage) : null;
  const backfillMarketRows = reportBackfillRowsForPack(rows, 'marketPack');
  const backfillFundamentalRows = reportBackfillRowsForPack(rows, 'fundamentalPack');
  const backfillFilingRows = reportBackfillRowsForPack(rows, 'filingPack');
  const backfillTranscriptRows = reportBackfillRowsForPack(rows, 'transcriptPack');
  const backfillIndustryRows = reportBackfillRowsForPack(rows, 'industryPack');
  const backfillPolicyRows = reportBackfillRowsForPack(rows, 'policyPack');
  const backfillCausalRows = reportBackfillRowsForPack(rows, 'causalPack');
  const backfillHistoricalRows = reportBackfillRowsForPack(rows, 'historicalAnalogPack');
  const visibleResearchRows = filterVisibleResearchRows(bundle, rows.research);
  const backfillResearchRows = filterVisibleResearchRows(bundle, [
    ...reportBackfillRowsForPack(rows, 'researchPack'),
    ...reportBackfillRowsForPack(rows, 'evidencePack'),
    ...reportBackfillRowsForPack(rows, 'evidenceSamplePack'),
    ...reportBackfillRowsForPack(rows, 'corePackExpansion'),
  ]);
  const evidenceClassExtractionRows = buildEvidenceClassExtractionRows(bundle, {
    ...rows,
    research: [...visibleResearchRows, ...backfillResearchRows],
    market: [...asArray(rows.market), ...backfillMarketRows],
    fundamental: [...asArray(rows.fundamentals), ...backfillFundamentalRows],
    industry: [...asArray(rows.industry), ...backfillIndustryRows],
    transcript: [...asArray(rows.transcripts), ...backfillTranscriptRows],
    transcripts: [...asArray(rows.transcripts), ...backfillTranscriptRows],
    filings: [...asArray(rows.filings), ...backfillFilingRows],
    policy: [...asArray(rows.policy), ...backfillPolicyRows],
  });
  const ontologyCoverage = evaluateReportOntologyCoverage(bundle, ontologyEvaluationOptions(
    rows,
    kpiState,
    issuerUniverseSymbols,
    transcriptRows,
    {
      research: [...backfillResearchRows, ...evidenceClassExtractionRows],
      market: backfillMarketRows,
      fundamental: backfillFundamentalRows,
      filing: backfillFilingRows,
      industry: backfillIndustryRows,
      transcript: backfillTranscriptRows,
      policy: backfillPolicyRows,
    },
  ));
  const transcriptUniverseSize = issuerUniverseSymbols.length;
  const requiredTranscriptSymbolCount = Math.max(
    transcriptUniverseSize ? Math.min(3, transcriptUniverseSize) : 0,
    Number(ontologyCoverage.requiredIssuerCommentarySymbolCount || 0),
  );
  const causalEdges = [
    ...normalizedDbCausalEdges(rows.causalEdges),
    ...derivedCausalEdges(bundle),
    ...causalEdgesFromBackfillRows(bundle, backfillCausalRows),
  ].slice(0, 10);
  const historicalMemoryCandidates = analoguesFromBundle(bundle, rows.historicalAnalogs, rows.trendHistory, backfillHistoricalRows);
  const reliableHistoricalAnalogues = historicalMemoryCandidates.filter(isReliableHistoricalAnalogue);
  const analogues = reliableHistoricalAnalogues.length ? reliableHistoricalAnalogues : historicalMemoryCandidates;
  const issuerDiscoveryRows = strictIssuerDiscoveryRows(bundle, {
    ...rows,
    research: [...visibleResearchRows, ...backfillResearchRows],
    fundamentals: [...asArray(rows.fundamentals), ...backfillFundamentalRows],
    filings: [...asArray(rows.filings), ...backfillFilingRows],
    transcripts: [...asArray(rows.transcripts), ...backfillTranscriptRows],
    policy: [...asArray(rows.policy), ...backfillPolicyRows],
    industry: [...asArray(rows.industry), ...backfillIndustryRows],
    evidenceClassExtractions: evidenceClassExtractionRows,
  });
  const issuerDiscoveryMap = buildIssuerDiscoveryMap({
    bundle,
    rows: issuerDiscoveryRows,
    ontologyCoverage,
    candidateIssuerUniverse: issuerDiscoveryCandidateUniverse(bundle),
    promotionEligibleSymbols: asArray(bundle.metadata?.promotionUniverse),
    strictEndogenous: useScopedIssuerEvidence(bundle),
  });
  const issuerDiscoveryPack = {
    status: issuerDiscoveryMap.length ? 'available' : 'gap',
    version: ISSUER_DISCOVERY_VERSION,
    rows: issuerDiscoveryMap,
    groups: groupIssuerDiscoveryMap(issuerDiscoveryMap),
    candidateIssuerUniverse: candidateIssuerUniverseFromMap(issuerDiscoveryMap),
    summary: issuerDiscoverySummary(issuerDiscoveryMap),
    boundary: 'Auto-discovered related issuers are report-visible collection targets; they do not raise actionability until direct issuer evidence attaches.',
  };
  const issuerThesisPack = buildIssuerThesisPack(bundle, rows, ontologyCoverage);
  const packs = {
    marketPack: {
      status: packAvailable(backfillMarketRows, fallbackMarketCount) ? 'available' : 'gap',
      rows: [...asArray(bundle.marketReactions).slice(0, 8), ...backfillMarketRows],
      basis: fallbackMarketCount ? 'bundle.marketReactions' : (backfillMarketRows.length ? 'report_backfill_source_query' : 'missing'),
    },
    fundamentalPack: {
      status: packAvailable([...asArray(rows.fundamentals), ...backfillFundamentalRows], rows.valuations?.length) ? 'available' : 'gap',
      fundamentals: [...asArray(rows.fundamentals), ...backfillFundamentalRows],
      valuations: rows.valuations || [],
    },
    filingPack: { status: packAvailable([...asArray(rows.filings), ...backfillFilingRows]) ? 'available' : 'gap', rows: [...asArray(rows.filings), ...backfillFilingRows] },
    transcriptPack: { status: packAvailable([...asArray(rows.transcripts), ...backfillTranscriptRows]) ? 'available' : 'gap', rows: [...asArray(rows.transcripts), ...backfillTranscriptRows] },
    industryPack: { status: packAvailable([...asArray(rows.industry), ...backfillIndustryRows]) ? 'available' : 'gap', rows: [...asArray(rows.industry), ...backfillIndustryRows] },
    issuerDiscoveryPack,
    issuerThesisPack,
    evidenceClassExtractionPack: {
      status: evidenceClassExtractionRows.length ? 'available' : 'gap',
      rows: evidenceClassExtractionRows,
      boundary: 'Direct provider rows can satisfy multiple evidence classes when class-specific facts are explicitly extracted; negative-control extracts remain separate from promotion.',
    },
    researchPack: { status: packAvailable([...visibleResearchRows, ...backfillResearchRows], fallbackResearchCount) ? 'available' : 'gap', rows: [...visibleResearchRows, ...backfillResearchRows], fallbackEvidenceCount: fallbackResearchCount },
    policyPack: { status: packAvailable([...asArray(rows.policy), ...backfillPolicyRows]) ? 'available' : 'gap', rows: [...asArray(rows.policy), ...backfillPolicyRows] },
    causalPack: { status: causalEdges.length ? 'available' : 'gap', edges: causalEdges },
    historicalAnalogPack: {
      status: reliableHistoricalAnalogues.length ? 'available' : (historicalMemoryCandidates.length ? 'context_only' : 'no_reliable_analog'),
      analogues,
      candidateCount: historicalMemoryCandidates.length,
      reliableCount: reliableHistoricalAnalogues.length,
    },
    feedbackPack: { status: asArray(rows.feedback).length ? 'available' : 'gap', rows: rows.feedback || [] },
    ontologyPack: {
      status: 'available',
      coverage: ontologyCoverage,
      rows: [{
        id: `ontology-${ontologyCoverage.ontologyKey || 'generic'}`,
        title: `${ontologyCoverage.ontologyLabel || 'Theme'} ontology coverage`,
        source_type: 'theme_ontology',
        evidence_ref: ontologyCoverage.version || 'theme-ontology',
        metadata: ontologyCoverage,
      }],
    },
  };
  const institutionalEvidencePack = buildInstitutionalEvidencePack(bundle, rows, packs, {
    issuerUniverseSymbols,
  });
  packs.institutionalEvidencePack = institutionalEvidencePack;
  const sourceDiversityProfile = buildResearchSourceDiversityProfile(bundle, packs);
  const investmentReadiness = buildInvestmentReadiness(bundle, packs, {
    ontologyCoverage,
    limitations: {
      transcriptProxyCount,
      directTranscriptCount: directTranscriptRows.length,
      directTranscriptSymbolCount,
      directManagementCommentaryCount: directManagementCommentaryRows.length,
      directManagementCommentarySymbolCount,
      requiredTranscriptSymbolCount,
      sourceDiversityProfile,
    },
  });
  const crossThemeActionBridge = buildCrossThemeActionBridge(bundle, rows, packs, ontologyCoverage, investmentReadiness);
  if (crossThemeActionBridge) packs.crossThemeActionBridge = crossThemeActionBridge;
  const crossThemeEvidenceMatrix = crossThemeActionBridge?.evidenceMatrix || null;
  const matrixPacks = strictEvidenceMatrixPacks(bundle, packs);
  const universalEvidenceContract = buildUniversalEvidenceContract(bundle, {
    ontologyCoverage,
    issuerUniverseSymbols,
    investmentReadiness,
    crossThemeActionBridge,
  });
  const evidenceClassMatrix = buildEvidenceClassMatrix({
    bundle,
    contract: universalEvidenceContract,
    packs: matrixPacks,
    crossThemeEvidenceMatrix,
  });
  const reportClosureLedger = buildReportBackfillClosureLedger({
    artifact: {
      reportId: bundle.reportId,
      bundle: {
        ...bundle,
        evidenceContractMatrix: evidenceClassMatrix,
      },
    },
    taskRows: rows.reportBackfillTasks || [],
    approvalRows: rows.sourceQueryApprovals || [],
    evidenceRows: strictEvidenceRows(bundle, [...visibleResearchRows, ...evidenceClassExtractionRows]),
    providerRunRows: rows.providerRunRows || [],
    marketValidation: investmentReadiness.marketValidation || null,
  });
  const actionBridge = buildUniversalActionBridge({
    bundle,
    contract: universalEvidenceContract,
    matrix: evidenceClassMatrix,
    crossThemeActionBridge,
  });
  if (actionBridge) packs.actionBridge = actionBridge;
  const evidenceContractCollectionTasks = buildEvidenceContractCollectionTasks({
    bundle,
    contract: universalEvidenceContract,
    matrix: evidenceClassMatrix,
    limit: 12,
  });
  const investmentCollectionPlan = [
    ...buildInstitutionalCollectionTasks(bundle, institutionalEvidencePack),
    ...buildInvestmentCollectionPlan(bundle, packs, investmentReadiness, ontologyCoverage),
    ...asArray(crossThemeActionBridge?.validationTasks).map((task) => collectionTask({
      packName: 'crossThemeActionBridge',
      query: task.query,
      reason: task.reason,
      priority: 88,
      collectionKind: 'cross_theme_action_bridge',
      target: {
        evidenceClass: task.evidenceClass,
        symbol: task.symbol || null,
        connector: crossThemeActionBridge.connector,
      },
      metadata: {
        requiredFor: 'cross_theme_actionability',
        desiredEvidenceClass: task.evidenceClass,
      },
    })),
    ...evidenceContractCollectionTasks,
  ];
  const packProfiles = Object.fromEntries(Object.entries(packs).map(([packName, pack]) => {
    const packRows = packEvidenceRows(pack);
    const sourceKinds = unique(packRows.map((row) => row.source_type || row.source || row.edgeType || row.metadata?.adapter || 'bundle'));
    const sourceRefs = unique(packRows.map((row) => row.evidence_ref || row.url || row.source_url || row.metadata?.url || row.metadata?.sourceUrl));
    const subjectBindings = unique([
      ...packRows.flatMap((row) => [row.theme, row.subject_key, row.subjectKey, row.symbol, row.ticker, row.entity_key]),
      ...(packName === 'marketPack' ? asArray(bundle.marketReactions).map((row) => row.symbol) : []),
    ]);
    const profile = {
      status: pack.status,
      rowCount: packRows.length,
      sourceKinds,
      sourceRefCount: sourceRefs.length,
      subjectBindings: subjectBindings.slice(0, 12),
      contextOnly: ['causalPack', 'historicalAnalogPack'].includes(packName) && pack.status !== 'available' ? true : false,
      provenance: sourceKinds.length ? 'source_table_or_bundle' : 'missing',
    };
    if (packName === 'industryPack' && kpiCoverage !== null) {
      profile.kpiCoverage = kpiCoverage;
      profile.kpiMappedCount = asArray(kpiState.maps).length;
      profile.kpiObservationCount = asArray(kpiState.observations).length;
      profile.kpiGapCount = kpiGaps.length;
    }
    return [packName, profile];
  }));
  const gaps = [];
  const name = subjectDisplay(bundle);
  if (packs.fundamentalPack.status === 'gap') gaps.push(buildGap('fundamentalPack', 'No fundamentals or valuation rows are attached.', `${name} fundamentals capex margin valuation peer comps`));
  if (packs.filingPack.status === 'gap') gaps.push(buildGap('filingPack', 'No filing evidence rows are attached.', `${name} 10-K 10-Q risk factor MD&A capex guidance`));
  if (packs.transcriptPack.status === 'gap') gaps.push(buildGap('transcriptPack', 'No transcript evidence rows are attached.', `${name} earnings call transcript guidance capex management commentary`));
  if (packs.industryPack.status === 'gap') gaps.push(buildGap('industryPack', 'No industry KPI rows are attached.', `${name} industry KPI capacity demand supply orders backlog`));
  if (packs.researchPack.status === 'gap') gaps.push(buildGap('researchPack', 'No paper, patent, or technical maturity rows are attached.', `${name} patent paper OpenAlex arXiv technical maturity`));
  if (packs.policyPack.status === 'gap') gaps.push(buildGap('policyPack', 'No policy/regulatory evidence rows are attached.', `${name} regulation subsidy procurement sanctions policy`));
  if (packs.causalPack.status === 'gap') gaps.push(buildGap('causalPack', 'No causal edges or graph-derived causal hypotheses are attached.', `${name} causal mechanism transmission path affected assets`));
  if (packs.historicalAnalogPack.status !== 'available') gaps.push(buildGap('historicalAnalogPack', 'No reliable historical analogue is available.', `${name} historical cycle analogous regime past market outcome`));
  if (packs.institutionalEvidencePack.status !== 'available') {
    gaps.push(buildGap(
      'institutionalEvidencePack',
      `Institutional evidence density is ${packs.institutionalEvidencePack.tier}; weak dimensions include ${asArray(packs.institutionalEvidencePack.blockingDimensions).slice(0, 4).map((item) => item.label).join(', ') || 'none'}.`,
      `${name} issuer fundamentals valuation event study management commentary industry KPI historical evidence`,
    ));
  }
  const availableCount = Object.values(packs).filter((pack) => pack.status === 'available').length;
  const observedKpiCoverage = Number.isFinite(Number(kpiCoverage)) ? Number(kpiCoverage) : null;
  const ontologyKpiCoverage = Number.isFinite(Number(ontologyCoverage.requiredKpiCoverage))
    ? Number(ontologyCoverage.requiredKpiCoverage)
    : null;
  const effectiveKpiCoverage = observedKpiCoverage === null
    ? ontologyKpiCoverage
    : Math.max(observedKpiCoverage, ontologyKpiCoverage ?? 0);
  const effectiveKpiGaps = ontologyKpiCoverage !== null
    && observedKpiCoverage !== null
    && ontologyKpiCoverage > observedKpiCoverage
    ? asArray(ontologyCoverage.missingKpis)
    : kpiGaps;
  return {
    version: 'deep-research-pack-v1',
    subjectKey: subjectKey(bundle),
    subjectDisplay: name,
    packs,
    packProfiles,
    gaps,
    dataDepthScore: Math.round((availableCount / Object.keys(packs).length) * 1000) / 1000,
    causalChainScore: Math.min(1, causalEdges.length / 4),
    historicalContextScore: reliableHistoricalAnalogues.length ? Math.min(1, reliableHistoricalAnalogues.length / 2) : 0,
    feedbackLearningScore: asArray(rows.feedback).length ? 1 : 0,
    investmentReadiness,
    crossThemeActionBridge,
    crossThemeEvidenceMatrix,
    universalEvidenceContract,
    evidenceClassMatrix,
    reportClosureLedger,
    actionBridge,
    collectionPlan: investmentCollectionPlan,
    ontologyPack: ontologyCoverage,
    kpiRegistry: {
      version: 'generic-kpi-collection-v1',
      coverage: effectiveKpiCoverage,
      observedCoverage: kpiCoverage,
      packEvidenceCoverage: ontologyKpiCoverage,
      mappedCount: asArray(kpiState.maps).length,
      definitionCount: asArray(kpiState.definitions).length,
      observationCount: asArray(kpiState.observations).length,
      packEvidenceSatisfiedCount: Math.max(0, num(ontologyCoverage.satisfiedKpiCount, 0) - asArray(kpiState.observations).length),
      missingCount: effectiveKpiGaps.length,
      jobCount: asArray(kpiState.jobs).length,
      gaps: effectiveKpiGaps,
      jobs: asArray(kpiState.jobs).slice(0, 20),
      boundary: 'theme-generic KPI ontology; direct report-pack evidence can satisfy KPI coverage, while missing KPIs remain collection jobs',
    },
    limitations: {
      transcriptProxyCount,
      directTranscriptCount: directTranscriptRows.length,
      directTranscriptSymbolCount,
      directManagementCommentaryCount: directManagementCommentaryRows.length,
      directManagementCommentarySymbolCount,
      requiredTranscriptSymbolCount,
      sourceDiversityProfile,
      newsSourceDiversity: sourceDiversityProfile.newsSourceDiversity,
      researchSourceDiversity: sourceDiversityProfile.researchSourceDiversity,
      effectiveSourceDiversity: sourceDiversityProfile.effectiveSourceDiversity,
      symbols: issuerUniverseSymbols,
      excludedNonIssuerSymbols: ontologyCoverage.excludedSymbols || [],
      searchTerms: rows.search?.terms || [],
      historicalMemoryCandidateCount: historicalMemoryCandidates.length,
      reliableHistoricalAnalogueCount: reliableHistoricalAnalogues.length,
    },
  };
}

function mergeDeepBundle(bundle = {}, deepResearch = {}) {
  const gaps = asArray(deepResearch.gaps);
  const kpiGaps = asArray(deepResearch.kpiRegistry?.gaps);
  const collectionPlan = asArray(deepResearch.collectionPlan);
  const evidenceClassMatrix = asArray(deepResearch.evidenceClassMatrix);
  const evidenceContractCoveredCount = evidenceClassMatrix.filter((row) => row.status && row.status !== 'missing').length;
  const evidenceContractCoverage = ratio(evidenceContractCoveredCount, evidenceClassMatrix.length, 1);
  const missingEvidenceContractClasses = evidenceClassMatrix.filter((row) => row.status === 'missing');
  const edges = asArray(deepResearch.packs?.causalPack?.edges);
  const analogues = asArray(deepResearch.packs?.historicalAnalogPack?.analogues);
  const reliableAnalogueCount = deepResearch.packs?.historicalAnalogPack?.status === 'available'
    ? num(deepResearch.packs?.historicalAnalogPack?.reliableCount, analogues.length)
    : 0;
  const sourceDiversityProfile = deepResearch.investmentReadiness?.sourceDiversityProfile
    || deepResearch.limitations?.sourceDiversityProfile
    || {};
  const priorSourceSummary = bundle.sourceSummary || {};
  const updatedSourceSummary = {
    ...priorSourceSummary,
    distinctSources: Math.max(
      num(priorSourceSummary.distinctSources ?? priorSourceSummary.distinct_sources, 0),
      num(sourceDiversityProfile.sourceRefCount, 0),
      num(sourceDiversityProfile.sourceKindCount, 0),
    ),
    sourceDiversityScore: Math.max(
      num(priorSourceSummary.sourceDiversityScore ?? priorSourceSummary.source_diversity_score, 0),
      num(sourceDiversityProfile.effectiveSourceDiversity, 0),
    ),
    lowDiversityFlag: num(sourceDiversityProfile.effectiveSourceDiversity, 0) < 0.5
      && num(sourceDiversityProfile.sourceKindCount, 0) < 3,
  };
  const baseCaveats = asArray(bundle.caveats).filter((item) => !(
    !updatedSourceSummary.lowDiversityFlag
    && item.caveatId === 'CAV-AUTO-SOURCE-DIVERSITY'
  ));
  const packStatuses = Object.entries(deepResearch.packs || {}).map(([name, pack]) => `${name}:${pack.status}`);
  const extraEvidence = [
    evidence('EVID-DEEP-PACK-SUMMARY', `Deep research pack summary for ${deepResearch.subjectDisplay}`, { deepResearch }),
    evidence('EVID-DEEP-EVIDENCE-CONTRACT', `Universal evidence contract for ${deepResearch.subjectDisplay}`, {
      universalEvidenceContract: deepResearch.universalEvidenceContract || null,
      evidenceClassMatrix: evidenceClassMatrix.slice(0, 24),
      actionBridge: deepResearch.actionBridge || null,
    }),
    ...packRowsToEvidence('fundamental', deepResearch.packs?.fundamentalPack?.fundamentals || [], 18),
    ...packRowsToEvidence('valuation', deepResearch.packs?.fundamentalPack?.valuations || [], 8),
    ...packRowsToEvidence('issuer-thesis', deepResearch.packs?.issuerThesisPack?.cards || [], 6),
    ...packRowsToEvidence('filing', deepResearch.packs?.filingPack?.rows || [], 16),
    ...packRowsToEvidence('transcript', deepResearch.packs?.transcriptPack?.rows || [], 32),
    ...packRowsToEvidence('industry', deepResearch.packs?.industryPack?.rows || [], 16),
    ...packRowsToEvidence('research', deepResearch.packs?.researchPack?.rows || [], 20),
    ...packRowsToEvidence('policy', deepResearch.packs?.policyPack?.rows || []),
    ...packRowsToEvidence('evidence-class-extract', deepResearch.packs?.evidenceClassExtractionPack?.rows || [], 32),
    ...packRowsToEvidence('issuer-discovery-map', deepResearch.packs?.issuerDiscoveryPack?.rows || [], 16),
    ...packRowsToEvidence('cross-theme-action', deepResearch.crossThemeActionBridge?.rows || [], 10),
    ...packRowsToEvidence('institutional-evidence', deepResearch.packs?.institutionalEvidencePack?.rows || [], 12),
  ];
  const extraMetrics = [
    metric('MET-DEEP-DATA-DEPTH', 'research_depth', 'data_depth_score', deepResearch.dataDepthScore, 'score', { packStatuses }),
    metric('MET-DEEP-CAUSAL-EDGES', 'causal_graph', 'causal_edge_count', edges.length, 'edges', { topEdge: edges[0] || null }),
    metric('MET-DEEP-HISTORICAL-ANALOGS', 'historical_memory', 'historical_analog_count', reliableAnalogueCount, 'analogues', {
      topAnalogue: reliableAnalogueCount ? analogues[0] || null : null,
      candidateCount: deepResearch.packs?.historicalAnalogPack?.candidateCount ?? analogues.length,
      reliableCount: reliableAnalogueCount,
      status: deepResearch.packs?.historicalAnalogPack?.status || 'unknown',
    }),
    metric('MET-DEEP-GAPS', 'research_gap', 'structured_gap_count', gaps.length, 'gaps', { gaps }),
    metric('MET-DEEP-FEEDBACK', 'feedback_learning', 'feedback_rows', deepResearch.packs?.feedbackPack?.rows?.length || 0, 'rows'),
    metric('MET-DEEP-KPI-COVERAGE', 'generic_kpi_collection', 'kpi_registry_coverage', deepResearch.kpiRegistry?.coverage ?? 0, 'score', { registry: deepResearch.kpiRegistry }),
    metric('MET-DEEP-ONTOLOGY-COVERAGE', 'theme_ontology', 'required_kpi_coverage', deepResearch.ontologyPack?.requiredKpiCoverage ?? 1, 'score', { ontologyPack: deepResearch.ontologyPack }),
    metric('MET-DEEP-ISSUER-THESIS-COVERAGE', 'issuer_thesis', 'issuer_thesis_coverage', deepResearch.packs?.issuerThesisPack?.coverage ?? 0, 'score', { issuerThesisPack: deepResearch.packs?.issuerThesisPack || null }),
    metric('MET-DEEP-AUTO-ISSUER-MAP', 'issuer_discovery', 'candidate_issuer_count', deepResearch.packs?.issuerDiscoveryPack?.summary?.candidateIssuerCount ?? 0, 'issuers', {
      issuerDiscoveryPack: deepResearch.packs?.issuerDiscoveryPack || null,
    }),
    metric('MET-DEEP-INSTITUTIONAL-EVIDENCE-DENSITY', 'institutional_evidence', 'institutional_evidence_density', deepResearch.packs?.institutionalEvidencePack?.coverageScore ?? 0, 'score', { institutionalEvidencePack: deepResearch.packs?.institutionalEvidencePack || null }),
    metric('MET-DEEP-QUANT-TABLE-COVERAGE', 'institutional_evidence', 'quant_table_coverage', deepResearch.packs?.institutionalEvidencePack?.tableCoverage ?? 0, 'score', { institutionalEvidencePack: deepResearch.packs?.institutionalEvidencePack || null }),
    metric('MET-DEEP-PRIMARY-EVIDENCE-COVERAGE', 'institutional_evidence', 'primary_evidence_coverage', deepResearch.packs?.institutionalEvidencePack?.primaryEvidenceCoverage ?? 0, 'score', { institutionalEvidencePack: deepResearch.packs?.institutionalEvidencePack || null }),
    metric('MET-DEEP-LONG-HORIZON-COVERAGE', 'institutional_evidence', 'long_horizon_coverage', deepResearch.packs?.institutionalEvidencePack?.longHorizonCoverage ?? 0, 'score', { institutionalEvidencePack: deepResearch.packs?.institutionalEvidencePack || null }),
    metric('MET-DEEP-EVIDENCE-CONTRACT-COVERAGE', 'universal_evidence_contract', 'evidence_contract_coverage', evidenceContractCoverage, 'score', {
      universalEvidenceContract: deepResearch.universalEvidenceContract || null,
      evidenceClassMatrix: evidenceClassMatrix.slice(0, 24),
      coveredCount: evidenceContractCoveredCount,
      requiredCount: evidenceClassMatrix.length,
    }),
    metric('MET-DEEP-MARKET-VALIDATION', 'market_validation', 'controlled_market_validation_score', deepResearch.investmentReadiness?.marketValidation?.score ?? 0, 'score', { marketValidation: deepResearch.investmentReadiness?.marketValidation || null }),
    ...(deepResearch.crossThemeActionBridge ? [metric('MET-DEEP-CROSS-THEME-ACTIONABILITY', 'cross_theme_actionability', 'cross_theme_actionability_score', deepResearch.crossThemeActionBridge.score ?? 0, 'score', { crossThemeActionBridge: deepResearch.crossThemeActionBridge })] : []),
    metric('MET-DEEP-INVESTMENT-READINESS', 'report_scope', 'investment_memo_readiness', deepResearch.investmentReadiness?.tier === 'investment_memo_candidate' ? 1 : 0, 'binary', { investmentReadiness: deepResearch.investmentReadiness }),
    metric('MET-DEEP-SOURCE-DIVERSITY', 'research_provenance', 'effective_source_diversity', deepResearch.investmentReadiness?.sourceDiversity ?? deepResearch.limitations?.effectiveSourceDiversity ?? 0, 'score', {
      newsSourceDiversity: deepResearch.investmentReadiness?.newsSourceDiversity ?? deepResearch.limitations?.newsSourceDiversity ?? 0,
      researchSourceDiversity: deepResearch.investmentReadiness?.researchSourceDiversity ?? deepResearch.limitations?.researchSourceDiversity ?? 0,
      basis: deepResearch.investmentReadiness?.sourceDiversityBasis || deepResearch.limitations?.sourceDiversityProfile?.basis || 'unknown',
      sourceDiversityProfile: deepResearch.investmentReadiness?.sourceDiversityProfile || deepResearch.limitations?.sourceDiversityProfile || null,
    }),
    metric('MET-DEEP-SAMPLE-ADEQUACY', 'sample_depth', 'article_sample_adequacy', deepResearch.investmentReadiness?.sampleAdequacy === 'investment_memo' ? 1 : 0, 'binary', { investmentReadiness: deepResearch.investmentReadiness }),
    metric('MET-DEEP-COLLECTION-TASKS', 'collection_plan', 'collection_task_count', collectionPlan.length, 'tasks', { collectionPlan: collectionPlan.slice(0, 12) }),
  ];
  const extraCaveats = [
    ...(edges.length ? [caveat('CAV-DEEP-CAUSAL-HYPOTHESIS', 'causality_boundary', 'Some causal edges are graph-derived hypotheses. They must stay separate from measured causal evidence until independent evidence supports them.')] : []),
    ...(analogues.length ? [] : [caveat('CAV-DEEP-NO-RELIABLE-ANALOG', 'historical_context_gap', 'No reliable historical analogue is attached; the report must not invent one.')]),
    ...(num(deepResearch.limitations?.transcriptProxyCount, 0) > 0 ? [caveat('CAV-DEEP-TRANSCRIPT-PROXY', 'transcript_proxy', 'Transcript pack uses SEC filing or earnings-release proxy evidence where call-level transcript excerpts are unavailable. Treat this as management-commentary context, not a verbatim call transcript.')] : []),
    ...(deepResearch.investmentReadiness?.tier === 'signal_triage' ? [caveat('CAV-DEEP-SIGNAL-TRIAGE-SCOPE', 'report_scope', `This is a signal-triage memo, not a final investment memo. Blockers: ${asArray(deepResearch.investmentReadiness.blockers).slice(0, 4).join('; ')}.`)] : []),
    ...(asArray(deepResearch.investmentReadiness?.decisionValidationGaps).length ? [caveat('CAV-DEEP-DECISION-VALIDATION', 'decision_validation_gap', `No report-blocking evidence gap is attached, but decision-grade validation remains incomplete: ${asArray(deepResearch.investmentReadiness.decisionValidationGaps).slice(0, 4).join('; ')}.`)] : []),
    ...(deepResearch.crossThemeActionBridge?.tier === 'source_expansion_only' ? [caveat('CAV-DEEP-CROSS-THEME-ACTION-BRIDGE', 'cross_theme_actionability_gap', 'Cross-theme discovery has not yet translated into issuer, market, or validation follow-up evidence. Treat it as source expansion only.')] : []),
    ...(missingEvidenceContractClasses.length ? [caveat('CAV-DEEP-EVIDENCE-CONTRACT', 'universal_evidence_contract_gap', `Universal evidence contract has missing classes: ${missingEvidenceContractClasses.slice(0, 8).map((row) => row.label || row.evidenceClass).join(', ')}. These gaps become backfill tasks and cannot support thesis promotion until collected.`)] : []),
    ...(num(deepResearch.ontologyPack?.investmentCriticalGapCount, 0) > 0 ? [caveat('CAV-DEEP-ONTOLOGY-COVERAGE', 'theme_ontology_gap', `${deepResearch.ontologyPack?.ontologyLabel || 'Theme'} ontology identifies missing investment-critical operating KPIs: ${asArray(deepResearch.ontologyPack?.missingKpis).filter((item) => item.critical && item.requiredFor === 'investment_memo').slice(0, 6).map((item) => item.displayName || item.kpiKey).join(', ')}.`)] : []),
    ...(deepResearch.kpiRegistry?.mappedCount > 0 && num(deepResearch.kpiRegistry?.coverage, 0) < 0.5 ? [caveat('CAV-DEEP-KPI-COVERAGE', 'kpi_collection_gap', 'Generic theme KPI coverage is below 50%; missing KPIs are queued as collection jobs before raising conviction.')] : []),
    ...(num(deepResearch.packs?.institutionalEvidencePack?.coverageScore, 0) < 0.65 ? [caveat('CAV-DEEP-INSTITUTIONAL-EVIDENCE-DENSITY', 'institutional_evidence_gap', `Institutional evidence density is ${deepResearch.packs?.institutionalEvidencePack?.tier || 'unknown'}; weak evidence lanes include ${asArray(deepResearch.packs?.institutionalEvidencePack?.blockingDimensions).slice(0, 5).map((item) => item.label).join(', ') || 'none'}.`)] : []),
    ...gaps.slice(0, 6).map((gap) => caveat(`CAV-DEEP-GAP-${slugify(gap.packName).toUpperCase()}`, 'data_gap', `${gap.packName}: ${gap.reason}`)),
  ];
  const extraWatch = [
    ...collectionPlan.slice(0, 10).map((task) => watch(`WATCH-COLLECT-${slugify(task.packName).toUpperCase()}`, `Collect ${task.packName}: ${task.query}`, 'report-backfill-tasks', { packName: task.packName, query: task.query, collectionKind: task.collectionKind, target: task.target })),
    ...gaps.slice(0, 8).map((gap) => watch(`WATCH-DEEP-${slugify(gap.packName).toUpperCase()}`, `Backfill ${gap.packName}: ${gap.query}`, 'deep-research-backfill', { packName: gap.packName, query: gap.query })),
    ...kpiGaps.slice(0, 8).map((gap) => watch(`WATCH-KPI-${slugify(gap.kpiKey).toUpperCase()}`, `Collect KPI ${gap.displayName || gap.kpiKey}: ${gap.query}`, 'generic-kpi-collection', { kpiKey: gap.kpiKey, dataPack: gap.dataPack, query: gap.query })),
    ...(edges.length ? [watch('WATCH-DEEP-CAUSAL-VALIDATION', 'Validate top causal edge with independent evidence or downgrade it to context-only.', 'causal_edges', { threshold: 'independent_evidence>=2' })] : []),
  ];
  const deepClaim = {
    claimId: 'CLM-DEEP-RESEARCH',
    claimType: 'deep_research_readiness',
    canonicalText: `${deepResearch.subjectDisplay} requires a deep research read across market, fundamental, industry, policy, causal, historical, feedback, and theme-ontology evidence; missing theme-specific KPIs become explicit backfill tasks rather than hidden assumptions.`,
    supportingEvidenceIds: ['EVID-DEEP-PACK-SUMMARY'],
    supportingMetricIds: extraMetrics.map((item) => item.metricId),
    supportingFigureIds: [],
    caveatIds: extraCaveats.map((item) => item.caveatId),
    confidenceLevel: deepResearch.dataDepthScore >= 0.7 ? 'medium' : 'low',
    validationStatus: 'candidate',
    metadata: { deepResearch },
  };
  const issuerDiscoveryRows = asArray(deepResearch.packs?.issuerDiscoveryPack?.rows);
  const scopedIssuerEvidence = useScopedIssuerEvidence(bundle);
  const directIssuerUniverse = filterIssuerSymbols([
    ...(scopedIssuerEvidence ? [] : asArray(bundle.issuerUniverse)),
    ...(scopedIssuerEvidence ? [] : asArray(bundle.metadata?.issuerUniverse)),
    ...issuerDiscoveryRows
      .filter((row) => row.promotionEligible === true
        || ['issuer_exposure_attached', 'direct_node_exposure_attached'].includes(String(row.status || '')))
      .map((row) => row.symbol),
  ]);
  const candidateIssuerUniverse = filterIssuerSymbols([
    ...asArray(bundle.metadata?.candidateIssuerUniverse),
    ...asArray(deepResearch.packs?.issuerDiscoveryPack?.candidateIssuerUniverse),
    ...issuerDiscoveryRows.map((row) => row.symbol),
  ]);
  const issuerMetadataPatch = issuerDiscoveryRows.length
    ? {
      issuerDiscoveryVersion: ISSUER_DISCOVERY_VERSION,
      issuerDiscoveryMap: issuerDiscoveryRows,
      autoIssuerGroups: deepResearch.packs?.issuerDiscoveryPack?.groups || groupIssuerDiscoveryMap(issuerDiscoveryRows),
      issuerBridgeSummary: deepResearch.packs?.issuerDiscoveryPack?.summary || issuerDiscoverySummary(issuerDiscoveryRows),
      candidateIssuerUniverse,
      issuerUniverse: directIssuerUniverse,
    }
    : {};
  return {
    ...bundle,
    issuerUniverse: directIssuerUniverse.length ? directIssuerUniverse : asArray(bundle.issuerUniverse),
    sourceSummary: updatedSourceSummary,
    evidence: [...asArray(bundle.evidence), ...extraEvidence.filter((item) => !asArray(bundle.evidence).some((existing) => existing.evidenceId === item.evidenceId))],
    metrics: [...asArray(bundle.metrics), ...extraMetrics.filter((item) => !asArray(bundle.metrics).some((existing) => existing.metricId === item.metricId))],
    caveats: [...baseCaveats, ...extraCaveats.filter((item) => !baseCaveats.some((existing) => existing.caveatId === item.caveatId))],
    watchIndicators: [...asArray(bundle.watchIndicators), ...extraWatch.filter((item) => !asArray(bundle.watchIndicators).some((existing) => existing.watchId === item.watchId))],
    claims: [...asArray(bundle.claims).filter((claim) => claim.claimId !== deepClaim.claimId), deepClaim],
    metadata: {
      ...(bundle.metadata || {}),
      ...issuerMetadataPatch,
      deepResearch,
    },
  };
}

export async function attachDeepResearchPack(bundle = {}, { client = null, ensureSchema = false } = {}) {
  if (!bundle) return bundle;
  if (!client && bundle.metadata?.deepResearch?.version === 'deep-research-pack-v1') return bundle;
  if (client && ensureSchema) await ensureDeepResearchSchema(client).catch(() => ({ ok: false }));
  if (client && ensureSchema) {
    const search = searchTermsFromBundle(bundle);
    const row = bundle.metadata?.row || {};
    await ensureKpiThemeCoverage(client, {
      themeId: search.theme || search.key,
      themeLabel: search.display,
      category: row.category || bundle.subject?.metadata?.category || null,
      parentTheme: row.parent_theme || bundle.subject?.metadata?.parentTheme || null,
    }).catch(() => ({ ok: false }));
  }
  const rows = await loadOptionalPackRows(client, bundle);
  const summary = buildDeepResearchSummary(bundle, rows);
  if (client && ensureSchema) await persistBackfillTasks(client, bundle, summary).catch(() => ({ inserted: 0 }));
  return mergeDeepBundle(bundle, summary);
}
