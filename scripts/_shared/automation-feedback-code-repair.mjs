import { existsSync } from 'node:fs';
import { cp, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { getSafeEnv, parseJsonObject, resolveCodexCommand } from './codex-json.mjs';
import { buildProviderCollectorRegistry } from './provider-collector-registry.mjs';

export const AUTOMATION_FEEDBACK_CODE_REPAIR_VERSION = 'automation-feedback-code-repair-v1';
export const DEFAULT_CODE_REPAIR_TIMEOUT_MS = 4 * 60 * 1000;
export const DEFAULT_AUTOMATION_FEEDBACK_CODE_REPAIR_PATH = path.join(
  process.cwd(),
  'data',
  'runtime',
  'automation-feedback-code-repair.latest.json',
);
export const DEFAULT_AUTOMATION_FEEDBACK_CODE_REPAIR_WORKSPACE_ROOT = path.join(
  process.cwd(),
  'data',
  'runtime',
  'code-repair-workspaces',
);

const DEFAULT_TEST_COMMANDS = Object.freeze([
  'node --import tsx --test tests/provider-collector-registry.test.mjs tests/staged-provider-live-executor.test.mjs tests/automation-feedback-remediation.test.mjs tests/autonomous-automation-cycle-provider-fixtures.test.mjs',
  'npx tsc --noEmit',
  'git diff --check',
]);

const BASE_ALLOWED_FILES = Object.freeze([
  'config/provider-collectors/*.json',
  'config/source-providers/*.json',
  'scripts/_shared/provider-collector-registry.mjs',
  'scripts/_shared/staged-provider-live-executor.mjs',
  'scripts/_shared/automation-feedback-remediation.mjs',
  'scripts/_shared/automation-feedback-code-repair.mjs',
  'scripts/run-autonomous-automation-cycle.mjs',
  'scripts/run-automation-feedback-code-repair.mjs',
  'tests/provider-collector-registry.test.mjs',
  'tests/staged-provider-live-executor.test.mjs',
  'tests/automation-feedback-remediation.test.mjs',
  'tests/automation-feedback-code-repair.test.mjs',
  'tests/autonomous-automation-cycle-provider-fixtures.test.mjs',
]);

const SHARED_INTEGRATION_FILES = Object.freeze(new Set([
  'scripts/_shared/provider-collector-registry.mjs',
  'scripts/_shared/staged-provider-live-executor.mjs',
  'scripts/_shared/automation-feedback-remediation.mjs',
  'scripts/_shared/automation-feedback-code-repair.mjs',
  'scripts/run-autonomous-automation-cycle.mjs',
  'scripts/run-automation-feedback-code-repair.mjs',
  'tests/provider-collector-registry.test.mjs',
  'tests/staged-provider-live-executor.test.mjs',
  'tests/automation-feedback-remediation.test.mjs',
  'tests/automation-feedback-code-repair.test.mjs',
  'tests/autonomous-automation-cycle-provider-fixtures.test.mjs',
]));

const FORBIDDEN_PATCH_PREFIXES = Object.freeze([
  '.git/',
  'data/runtime/',
  'data/reports/',
  'node_modules/',
  'site/.vitepress/dist/',
  'site/.vitepress/cache/',
]);

const FORBIDDEN_PATCH_FILES = Object.freeze(new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '.env',
  '.env.local',
]));

const WORKSPACE_COPY_EXCLUDE_PREFIXES = Object.freeze([
  '.git',
  'node_modules',
  'data/backups',
  'data/runtime',
  'data/historical',
  'data/runtime/code-repair-workspaces',
  'data/reports',
  'data/verification-screenshots',
  'site/.vitepress/dist',
  'site/.vitepress/cache',
  'coverage',
]);

const WORKSPACE_COPY_EXCLUDE_SEGMENTS = Object.freeze([
  '.cache',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
]);

const WORKSPACE_COPY_EXCLUDE_SUFFIXES = Object.freeze([
  '.duckdb',
  '.duckdb.wal',
  '.sqlite',
  '.sqlite3',
  '.db',
  '.db-wal',
  '.db-shm',
  '.log',
  '.tmp',
]);

const NON_PROVIDER_REPAIR_TARGETS = Object.freeze(new Set([
  'adapter_proposal_only',
  'backfill-queue-executor',
  'automation-cycle',
  'autonomous-automation-cycle',
  'provider-quality-feedback',
  'source-diversity-feedback',
  'automation-feedback-remediation',
  'automation-feedback-code-repair',
  'issuer_filing_transcript_or_contract',
  'technical_or_company_source',
  'trade_or_supplier_input_source',
  'official_filing',
  'technical_standard',
  'local_market_validation',
  'source_query_negative_control',
]));

const PROVIDER_FILE_ALIASES = Object.freeze({
  'company-ir-readonly': {
    moduleSlug: 'company-ir',
    testSlug: 'company-ir',
    collectorSlug: 'company_ir_direct_pdf',
  },
  company_ir_direct_pdf: {
    moduleSlug: 'company-ir',
    testSlug: 'company-ir',
    collectorSlug: 'company_ir_direct_pdf',
  },
  taiwan_mops: {
    moduleSlug: 'taiwan-mops',
    testSlug: 'taiwan-mops',
    collectorSlug: 'taiwan_mops',
  },
  tdnet: {
    moduleSlug: 'tdnet',
    testSlug: 'tdnet',
    collectorSlug: 'tdnet',
  },
  edinet: {
    moduleSlug: 'edinet',
    testSlug: 'edinet',
    collectorSlug: 'edinet',
  },
  dart: {
    moduleSlug: 'dart',
    testSlug: 'dart',
    collectorSlug: 'dart',
  },
});

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function compactKey(value = '') {
  return compact(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function providerNameKey(value = '') {
  return compact(value).toLowerCase().replace(/\s+/g, '_');
}

function providerCoverageKeys(value = '') {
  const base = compactKey(value);
  const keys = new Set([base, providerNameKey(value)]);
  for (const [name, alias] of Object.entries(PROVIDER_FILE_ALIASES)) {
    const aliasKeys = [
      compactKey(name),
      compactKey(alias.collectorSlug),
      compactKey(alias.moduleSlug),
      compactKey(alias.testSlug),
    ].filter(Boolean);
    if (aliasKeys.includes(base)) {
      for (const key of aliasKeys) keys.add(key);
    }
  }
  return [...keys].filter(Boolean);
}

function fileSlug(value = '') {
  return compact(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
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

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function countRows(value) {
  return Array.isArray(value) ? value.length : numeric(value, 0);
}

function automationCycleEvidenceSnapshot(cycle = null) {
  if (!cycle || typeof cycle !== 'object') {
    return {
      available: false,
      rawEvidenceCount: 0,
      acceptedEvidenceCount: 0,
      acceptedPromotionEvidenceCount: 0,
      sourceQualityTerminalBlockers: 0,
      providerQualityRecordCount: 0,
      remediationNextAction: null,
      mutationBoundary: zeroBoundary(),
    };
  }
  const staged = cycle.stagedProviderLiveExecution || {};
  const backfill = cycle.backfillQueue || {};
  const sourceQuality = cycle.sourceQualityScore || cycle.sourceQuality || {};
  const providerQuality = cycle.providerQualityFeedback || {};
  const remediation = cycle.automationFeedbackRemediation || {};
  const rawEvidenceCount = countRows(staged.rawEvidence)
    || numeric(staged.rawEvidenceStoredCount, 0)
    || numeric(staged.rawEvidenceCount, 0);
  const backfillRawEvidenceCount = countRows(backfill.rawEvidence)
    || numeric(backfill.rawEvidenceStoredCount, 0)
    || numeric(backfill.rawEvidenceCount, 0);
  const acceptedEvidenceCount = countRows(staged.acceptedEvidence)
    || numeric(staged.acceptedEvidenceStoredCount, 0)
    || numeric(staged.acceptedEvidenceCount, 0);
  const backfillAcceptedEvidenceCount = countRows(backfill.acceptedEvidence)
    || numeric(backfill.acceptedEvidenceStoredCount, 0)
    || numeric(backfill.acceptedEvidenceCount, 0);
  const acceptedPromotionEvidenceCount = countRows(staged.acceptedPromotionEvidence)
    || numeric(staged.acceptedPromotionEvidenceStoredCount, 0)
    || numeric(staged.acceptedPromotionEvidenceCount, 0);
  const backfillPromotionEvidenceCount = countRows(backfill.acceptedPromotionEvidence)
    || numeric(backfill.acceptedPromotionEvidenceStoredCount, 0)
    || numeric(backfill.acceptedPromotionEvidenceCount, 0);
  return {
    available: true,
    rawEvidenceCount: rawEvidenceCount + backfillRawEvidenceCount,
    acceptedEvidenceCount: acceptedEvidenceCount + backfillAcceptedEvidenceCount,
    acceptedPromotionEvidenceCount: acceptedPromotionEvidenceCount + backfillPromotionEvidenceCount,
    sourceQualityTerminalBlockers: numeric(
      sourceQuality.summary?.terminalBlockerCount,
      numeric(sourceQuality.terminalBlockerCount, countRows(sourceQuality.terminalBlockers)),
    ),
    providerQualityRecordCount: numeric(providerQuality.recordCount, countRows(providerQuality.records)),
    remediationNextAction: remediation.summary?.nextSafeAction
      || providerQuality.recommendedRemediationAction
      || null,
    mutationBoundary: cycle.mutationBoundaries || cycle.mutationBoundary || zeroBoundary(),
  };
}

async function readJsonOrNull(filePath = '') {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function readAutomationCycleEvidenceSnapshot(runtimeRoot = path.join(process.cwd(), 'data', 'runtime')) {
  const cycle = await readJsonOrNull(path.join(runtimeRoot, 'autonomous-automation-cycle.latest.json'));
  return automationCycleEvidenceSnapshot(cycle);
}

function terminateProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('error', () => {});
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // Ignore process termination races.
  }
  setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      // Ignore process termination races.
    }
  }, 2000).unref?.();
}

function buildEvidenceDelta(before = {}, after = {}) {
  return {
    rawEvidenceDelta: numeric(after.rawEvidenceCount) - numeric(before.rawEvidenceCount),
    acceptedEvidenceDelta: numeric(after.acceptedEvidenceCount) - numeric(before.acceptedEvidenceCount),
    acceptedPromotionEvidenceDelta: numeric(after.acceptedPromotionEvidenceCount) - numeric(before.acceptedPromotionEvidenceCount),
    sourceQualityTerminalBlockerDelta: numeric(after.sourceQualityTerminalBlockers) - numeric(before.sourceQualityTerminalBlockers),
    providerQualityRecordDelta: numeric(after.providerQualityRecordCount) - numeric(before.providerQualityRecordCount),
    remediationNextActionChanged: Boolean(before.remediationNextAction || after.remediationNextAction)
      && before.remediationNextAction !== after.remediationNextAction,
  };
}

export function classifyCodeRepairEvidenceEffect(delta = {}) {
  if (
    numeric(delta.acceptedPromotionEvidenceDelta) > 0
    || numeric(delta.acceptedEvidenceDelta) > 0
  ) {
    return {
      effectStatus: 'effective',
      strongEffect: true,
      weakEffect: false,
      reason: 'accepted_or_promotion_evidence_increased',
    };
  }
  if (
    numeric(delta.rawEvidenceDelta) > 0
    || numeric(delta.sourceQualityTerminalBlockerDelta) < 0
    || numeric(delta.providerQualityRecordDelta) > 0
    || delta.remediationNextActionChanged === true
  ) {
    return {
      effectStatus: 'weak_effect',
      strongEffect: false,
      weakEffect: true,
      reason: 'raw_or_blocker_state_changed_without_accepted_delta',
    };
  }
  return {
    effectStatus: 'ineffective',
    strongEffect: false,
    weakEffect: false,
    reason: 'no_evidence_or_blocker_delta',
  };
}

function relPath(filePath = '', root = process.cwd()) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function safeRequestId(value = '') {
  return compact(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'request';
}

function providerFileAlias(providerName = '') {
  const key = providerNameKey(providerName);
  const alias = PROVIDER_FILE_ALIASES[key] || {};
  const fallbackModuleSlug = fileSlug(providerName);
  const fallbackCollectorSlug = compactKey(providerName);
  return {
    moduleSlug: alias.moduleSlug || fallbackModuleSlug,
    testSlug: alias.testSlug || fallbackModuleSlug,
    collectorSlug: alias.collectorSlug || fallbackCollectorSlug,
  };
}

function providerSpecificFilesForRequest(request = {}) {
  const providerFiles = providerSpecificAllowedFiles(request.providerName);
  return asArray(request.allowedFiles).filter((file) => providerFiles.includes(file));
}

function requestMergeKey(request = {}) {
  return [
    providerNameKey(request.providerName),
    compact(request.evidenceClass).toLowerCase(),
    ...providerSpecificFilesForRequest(request),
  ].join('|');
}

function requestRequiresSharedIntegration(request = {}) {
  return asArray(request.allowedFiles).some((file) => SHARED_INTEGRATION_FILES.has(file));
}

function wildcardToRegex(pattern = '') {
  const escaped = String(pattern)
    .replace(/\\/g, '/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

async function pathExists(filePath = '') {
  if (!filePath) return false;
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursive(root, base = root, out = []) {
  if (!(await pathExists(root))) return out;
  const info = await stat(root);
  if (info.isFile()) {
    out.push(relPath(root, base));
    return out;
  }
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await listFilesRecursive(full, base, out);
    else if (entry.isFile()) out.push(relPath(full, base));
  }
  return out;
}

async function expandAllowedPattern(root, pattern = '') {
  const normalized = compact(pattern).replace(/\\/g, '/');
  if (!normalized) return [];
  if (!normalized.includes('*')) {
    return (await pathExists(path.join(root, normalized))) ? [normalized] : [];
  }
  const firstGlob = normalized.indexOf('*');
  const prefixDir = normalized.slice(0, firstGlob).replace(/\/[^/]*$/, '').replace(/\/$/, '');
  const searchRoot = path.join(root, prefixDir || '.');
  const regex = wildcardToRegex(normalized);
  const files = await listFilesRecursive(searchRoot, root);
  return files.filter((file) => regex.test(file));
}

async function expandAllowedFiles(root, patterns = []) {
  const out = new Set();
  for (const pattern of asArray(patterns)) {
    for (const file of await expandAllowedPattern(root, pattern)) out.add(file);
  }
  return [...out].sort();
}

function isForbiddenPatchFile(rel = '') {
  const normalized = rel.replace(/\\/g, '/');
  return FORBIDDEN_PATCH_FILES.has(normalized)
    || FORBIDDEN_PATCH_PREFIXES.some((prefix) => normalized === prefix.replace(/\/$/, '') || normalized.startsWith(prefix));
}

function isWorkspaceCopyExcluded(rel = '') {
  const normalized = rel.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  return WORKSPACE_COPY_EXCLUDE_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))
    || normalized.split('/').some((segment) => WORKSPACE_COPY_EXCLUDE_SEGMENTS.includes(segment))
    || WORKSPACE_COPY_EXCLUDE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function matchesAllowedPattern(rel = '', patterns = []) {
  const normalized = rel.replace(/\\/g, '/');
  return asArray(patterns).some((pattern) => {
    const compactPattern = compact(pattern).replace(/\\/g, '/');
    if (!compactPattern) return false;
    if (!compactPattern.includes('*')) return normalized === compactPattern;
    return wildcardToRegex(compactPattern).test(normalized);
  });
}

function providerCollectorCoverage(providerCollectorRegistry = null) {
  const registry = providerCollectorRegistry || buildProviderCollectorRegistry();
  const rows = asArray(registry?.collectors).filter((collector) => collector.valid !== false);
  return new Set(rows.flatMap((collector) => providerCoverageKeys(collector.providerName)
    .flatMap((providerKey) => asArray(collector.evidenceClasses)
      .map((evidenceClass) => `${providerKey}:${compact(evidenceClass).toLowerCase()}`))));
}

function providerSpecificAllowedFiles(providerName = '') {
  const key = providerNameKey(providerName);
  const normalizedKey = compactKey(providerName);
  if (
    !key
    || key === 'unknown'
    || NON_PROVIDER_REPAIR_TARGETS.has(key)
    || NON_PROVIDER_REPAIR_TARGETS.has(normalizedKey)
  ) return [];
  const { moduleSlug, testSlug, collectorSlug } = providerFileAlias(providerName);
  return [
    `scripts/_shared/external-data/${moduleSlug}-readonly.mjs`,
    `tests/${testSlug}-readonly.test.mjs`,
    `config/provider-collectors/${collectorSlug}.json`,
  ];
}

function parseLastAgentJson(stdout = '') {
  let last = '';
  for (const rawLine of String(stdout || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed?.type === 'item.completed' && parsed?.item?.type === 'agent_message') {
        last = String(parsed.item.text || '').trim();
      }
      if (parsed?.type === 'message' && typeof parsed.message === 'string') {
        last = parsed.message.trim();
      }
    } catch {
      // Ignore non-JSON output from nested Codex.
    }
  }
  return parseJsonObject(last) || parseJsonObject(stdout);
}

function requestFromFixtureRequirement(requirement = {}) {
  const providerName = compact(requirement.providerName || 'unknown_provider');
  const evidenceClass = compact(requirement.evidenceClass || 'unknown_class');
  const providerFiles = providerSpecificAllowedFiles(providerName);
  if (!providerFiles.length) {
    return {
      skipped: true,
      reason: 'not_a_provider_collector_repair_target',
      providerName,
      evidenceClass,
      sourceRequirement: requirement,
    };
  }
  return {
    requestId: `code-repair-${compactKey(providerName)}-${compactKey(evidenceClass)}`,
    actionType: 'implement_provider_fixture_or_collector',
    providerName,
    evidenceClass,
    priority: Number(requirement.priority || 50),
    sourceRequirement: requirement,
    allowedFiles: [
      ...BASE_ALLOWED_FILES,
      ...providerFiles,
    ],
    testCommands: [...DEFAULT_TEST_COMMANDS],
  };
}

function requestFromProviderGap(proposal = {}) {
  const providerName = compact(proposal.providerName || 'unknown_provider');
  const evidenceClass = compact(proposal.fillsEvidenceClass || proposal.evidenceClass || 'unknown_class');
  const providerFiles = providerSpecificAllowedFiles(providerName);
  if (!providerFiles.length) {
    return {
      skipped: true,
      reason: 'not_a_provider_adapter_repair_target',
      providerName,
      evidenceClass,
      sourceRequirement: proposal,
    };
  }
  return {
    requestId: `code-repair-provider-gap-${compactKey(providerName)}-${compactKey(evidenceClass)}`,
    actionType: 'implement_review_gated_provider_adapter_fixture',
    providerName,
    evidenceClass,
    priority: 80,
    sourceRequirement: proposal,
    allowedFiles: [
      ...BASE_ALLOWED_FILES,
      ...providerFiles,
      'scripts/_shared/source-provider-manifest-registry.mjs',
      'tests/source-provider-manifest-registry.test.mjs',
    ],
    testCommands: [...DEFAULT_TEST_COMMANDS],
  };
}

function successfulRepairRequestIds(previousCodeRepair = {}) {
  const runs = asArray(previousCodeRepair?.runs);
  const runIds = runs
    .filter((run) => (
      !String(run.status || '').startsWith('failed')
      && (
        run.effectStatus === 'effective'
        || (!run.effectStatus && (
          run.status === 'patched'
          || (run.status === 'patched_or_no_safe_patch' && asArray(run.mergeAppliedFiles).length > 0)
          || asArray(run.mergeAppliedFiles).length > 0
        ))
      )
    ))
    .map((run) => run.request?.requestId)
    .filter(Boolean);
  return new Set([...asArray(previousCodeRepair?.priorSuccessfulRepairIds), ...runIds]);
}

function recentlyIneffectiveRepairRequestIds(previousCodeRepair = {}) {
  const runs = asArray(previousCodeRepair?.runs);
  const runIds = runs
    .filter((run) => (
      ['weak_effect', 'ineffective'].includes(run.effectStatus)
      || ['patched_weak_effect', 'ineffective_rolled_back'].includes(run.status)
      || run.codexResult?.timedOut === true
      || run.codexResult?.code === 124
    ))
    .map((run) => run.request?.requestId)
    .filter(Boolean);
  return new Set([...asArray(previousCodeRepair?.priorIneffectiveRepairIds), ...runIds]);
}

function providerKeyFromRepairRequestId(requestId = '') {
  let text = compact(requestId);
  if (!text) return '';
  if (text.startsWith('code-repair-provider-gap-')) {
    text = text.slice('code-repair-provider-gap-'.length);
  } else if (text.startsWith('code-repair-')) {
    text = text.slice('code-repair-'.length);
  }
  const splitAt = text.lastIndexOf('-');
  if (splitAt <= 0) return '';
  return providerNameKey(text.slice(0, splitAt));
}

function recentlyIneffectiveProviderKeys(previousCodeRepair = {}) {
  const runs = asArray(previousCodeRepair?.runs);
  const runKeys = runs
    .filter((run) => (
      ['weak_effect', 'ineffective'].includes(run.effectStatus)
      || ['patched_weak_effect', 'ineffective_rolled_back'].includes(run.status)
      || run.codexResult?.timedOut === true
      || run.codexResult?.code === 124
    ))
    .map((run) => providerNameKey(run.request?.providerName || run.providerName))
    .filter(Boolean);
  const priorKeys = asArray(previousCodeRepair?.priorIneffectiveProviderKeys)
    .map(providerNameKey)
    .filter(Boolean);
  const priorRequestKeys = asArray(previousCodeRepair?.priorIneffectiveRepairIds)
    .map(providerKeyFromRepairRequestId)
    .filter(Boolean);
  return new Set([...priorKeys, ...priorRequestKeys, ...runKeys]);
}

export function buildAutomationFeedbackCodeRepairRequests({
  remediation = {},
  maxRepairs = 1,
  dedupeProviders = true,
  previousCodeRepair = null,
  providerCollectorRegistry = null,
} = {}) {
  const alreadyPatched = successfulRepairRequestIds(previousCodeRepair);
  const recentlyIneffective = recentlyIneffectiveRepairRequestIds(previousCodeRepair);
  const recentlyIneffectiveProviders = recentlyIneffectiveProviderKeys(previousCodeRepair);
  const alreadyCovered = providerCollectorCoverage(providerCollectorRegistry);
  const requestCovered = (request) => providerCoverageKeys(request.providerName)
    .some((providerKey) => alreadyCovered.has(`${providerKey}:${compact(request.evidenceClass).toLowerCase()}`));
  const candidates = [
    ...asArray(remediation.providerFixtureRequirements).map(requestFromFixtureRequirement),
    ...asArray(remediation.providerGapProposals).map(requestFromProviderGap),
  ]
    .filter((request) => (
      request.providerName
      && request.evidenceClass
      && request.skipped !== true
      && !alreadyPatched.has(request.requestId)
      && !recentlyIneffective.has(request.requestId)
      && !recentlyIneffectiveProviders.has(providerNameKey(request.providerName))
      && !requestCovered(request)
    ))
    .sort((left, right) => left.priority - right.priority || left.providerName.localeCompare(right.providerName));
  const requests = [];
  const seenProviders = new Set();
  for (const request of candidates) {
    const providerKey = providerNameKey(request.providerName);
    if (dedupeProviders && seenProviders.has(providerKey)) continue;
    seenProviders.add(providerKey);
    requests.push(request);
    if (requests.length >= Math.max(0, Number(maxRepairs || 1))) break;
  }
  return requests;
}

export function buildParallelAutomationFeedbackCodeRepairBatch({
  remediation = {},
  maxRepairs = 3,
  parallelWorkers = 3,
  previousCodeRepair = null,
  providerCollectorRegistry = null,
  avoidSharedIntegrationConflicts = true,
} = {}) {
  const workerLimit = Math.max(0, Number(parallelWorkers || 3));
  const repairLimit = Math.max(0, Number(maxRepairs || workerLimit));
  const selectedLimit = Math.min(workerLimit, repairLimit);
  const candidates = buildAutomationFeedbackCodeRepairRequests({
    remediation,
    maxRepairs: Math.max(selectedLimit * 3, workerLimit, repairLimit),
    dedupeProviders: false,
    previousCodeRepair,
    providerCollectorRegistry,
  });
  const selected = [];
  const seenMergeKeys = new Set();
  const seenProviderClass = new Set();
  const seenProviders = new Set();
  const seenProviderSpecificFiles = new Set();
  let sharedIntegrationRequestSelected = false;
  for (const request of candidates) {
    const providerKey = providerNameKey(request.providerName);
    const providerClassKey = `${providerNameKey(request.providerName)}:${compact(request.evidenceClass).toLowerCase()}`;
    const mergeKey = requestMergeKey(request);
    const providerFiles = providerSpecificFilesForRequest(request);
    const requiresSharedIntegration = requestRequiresSharedIntegration(request);
    if (
      seenProviders.has(providerKey)
      || seenProviderClass.has(providerClassKey)
      || seenMergeKeys.has(mergeKey)
      || providerFiles.some((file) => seenProviderSpecificFiles.has(file))
      || (avoidSharedIntegrationConflicts && requiresSharedIntegration && sharedIntegrationRequestSelected)
    ) continue;
    selected.push(request);
    if (requiresSharedIntegration) sharedIntegrationRequestSelected = true;
    seenProviders.add(providerKey);
    seenProviderClass.add(providerClassKey);
    seenMergeKeys.add(mergeKey);
    for (const file of providerFiles) seenProviderSpecificFiles.add(file);
    if (selected.length >= selectedLimit) break;
  }
  return selected;
}

export function buildAutomationFeedbackCodeRepairSkippedRequests({
  remediation = {},
  previousCodeRepair = null,
  providerCollectorRegistry = null,
} = {}) {
  const alreadyPatched = successfulRepairRequestIds(previousCodeRepair);
  const recentlyIneffective = recentlyIneffectiveRepairRequestIds(previousCodeRepair);
  const recentlyIneffectiveProviders = recentlyIneffectiveProviderKeys(previousCodeRepair);
  const alreadyCovered = providerCollectorCoverage(providerCollectorRegistry);
  const requestCovered = (request) => providerCoverageKeys(request.providerName)
    .some((providerKey) => alreadyCovered.has(`${providerKey}:${compact(request.evidenceClass).toLowerCase()}`));
  const rows = [
    ...asArray(remediation.providerFixtureRequirements).map(requestFromFixtureRequirement),
    ...asArray(remediation.providerGapProposals).map(requestFromProviderGap),
  ];
  const structuralSkips = rows
    .filter((request) => request.skipped === true)
    .map((request) => ({
      providerName: request.providerName,
      evidenceClass: request.evidenceClass,
      reason: request.reason,
    }));
  const recentlyPatchedSkips = rows
    .filter((request) => request.skipped !== true && alreadyPatched.has(request.requestId))
    .map((request) => ({
      providerName: request.providerName,
      evidenceClass: request.evidenceClass,
      reason: 'recently_patched_by_codex_cli',
    }));
  const recentlyIneffectiveSkips = rows
    .filter((request) => (
      request.skipped !== true
      && !alreadyPatched.has(request.requestId)
      && recentlyIneffective.has(request.requestId)
    ))
    .map((request) => ({
      providerName: request.providerName,
      evidenceClass: request.evidenceClass,
      reason: 'recently_ineffective_codex_repair',
    }));
  const recentlyIneffectiveProviderSkips = rows
    .filter((request) => (
      request.skipped !== true
      && !alreadyPatched.has(request.requestId)
      && !recentlyIneffective.has(request.requestId)
      && recentlyIneffectiveProviders.has(providerNameKey(request.providerName))
    ))
    .map((request) => ({
      providerName: request.providerName,
      evidenceClass: request.evidenceClass,
      reason: 'provider_recently_ineffective_codex_repair',
    }));
  const coveredSkips = rows
    .filter((request) => (
      request.skipped !== true
      && !alreadyPatched.has(request.requestId)
      && !recentlyIneffectiveProviders.has(providerNameKey(request.providerName))
      && requestCovered(request)
    ))
    .map((request) => ({
      providerName: request.providerName,
      evidenceClass: request.evidenceClass,
      reason: 'collector_already_registered_for_evidence_class',
    }));
  return [...structuralSkips, ...recentlyPatchedSkips, ...recentlyIneffectiveSkips, ...recentlyIneffectiveProviderSkips, ...coveredSkips];
}

export function buildAutomationFeedbackCodeRepairPrompt(request = {}) {
  return [
    'You are Codex CLI running inside the Lattice Current repository as an autonomous code repair worker.',
    '',
    'Goal:',
    'Implement the smallest generic provider/collector/parser/test improvement that can reduce the current evidence acquisition remediation blocker.',
    'Do not optimize prose. Do not lower evidence gates. Do not make a one-off report look better.',
    '',
    'Selected remediation request:',
    JSON.stringify({
      requestId: request.requestId,
      actionType: request.actionType,
      providerName: request.providerName,
      evidenceClass: request.evidenceClass,
      sourceRequirement: request.sourceRequirement,
    }, null, 2),
    '',
    'Allowed write scope:',
    ...asArray(request.allowedFiles).map((file) => `- ${file}`),
    '',
    'Hard safety rules:',
    '- Do not edit runtime data, generated reports, credentials, package locks, or unrelated UI.',
    '- Do not commit, push, merge, delete data, or rewrite git history.',
    '- Do not enable automatic investment readiness, portfolio actions, canonical graph writes, or report candidate writes.',
    '- Provider activation must remain read-only, fixture-backed, staged/active_limited at most.',
    '- Raw evidence must never auto-promote. Ticker-only, weak RSS/source-query, and metadata-only rows must stay rejected/weak.',
    '- If a safe generic code patch is not possible in the allowed files, write no code and return no-safe-patch.',
    '',
    'Expected implementation shape:',
    '- Add or improve a bounded read-only collector/fixture/parser for the selected provider and evidence class.',
    '- Add fixture-backed tests proving positive operating-bridge extraction and rejection of ticker-only/raw metadata rows.',
    '- Update registries/manifests only if needed for this provider route.',
    '- Keep all mutation boundaries at zero except artifact/test outputs.',
    '',
    'Required verification commands:',
    ...asArray(request.testCommands).map((command) => `- ${command}`),
    '',
    'Return JSON only:',
    '{',
    '  "status": "patched|no-safe-patch|failed",',
    '  "changedFiles": [],',
    '  "testsRun": [],',
    '  "summary": "...",',
    '  "residualRisk": "..."',
    '}',
  ].join('\n');
}

async function runCommand(command, { cwd = process.cwd(), timeoutMs = 120_000 } = {}) {
  const startedAt = new Date().toISOString();
  const result = await new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      env: getSafeEnv(),
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, Math.max(15_000, Number(timeoutMs || 120_000)));
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        command,
        startedAt,
        finishedAt: new Date().toISOString(),
        code: timedOut ? 124 : Number(code ?? 1),
        signal,
        timedOut,
        stdoutTail: stdout.slice(-4000),
        stderrTail: stderr.slice(-4000),
      });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        command,
        startedAt,
        finishedAt: new Date().toISOString(),
        code: 1,
        signal: null,
        stdoutTail: stdout.slice(-4000),
        stderrTail: `${stderr}\n${error.message}`.slice(-4000),
      });
    });
  });
  return result;
}

async function runCodexExec(prompt, {
  cwd = process.cwd(),
  timeoutMs = DEFAULT_CODE_REPAIR_TIMEOUT_MS,
} = {}) {
  const command = await resolveCodexCommand();
  const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--full-auto'];
  const model = compact(process.env.CODEX_AUTOMATION_FEEDBACK_CODE_REPAIR_MODEL || process.env.CODEX_MODEL);
  if (model) args.splice(1, 0, '--model', model);
  const startedAt = new Date().toISOString();
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: getSafeEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, Math.max(30_000, Number(timeoutMs || DEFAULT_CODE_REPAIR_TIMEOUT_MS)));
    child.stdin?.write(prompt);
    child.stdin?.end();
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        startedAt,
        finishedAt: new Date().toISOString(),
        command,
        args,
        code: timedOut ? 124 : Number(code ?? 1),
        signal,
        timedOut,
        stdoutTail: stdout.slice(-8000),
        stderrTail: stderr.slice(-8000),
        parsed: parseLastAgentJson(stdout),
      });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        startedAt,
        finishedAt: new Date().toISOString(),
        command,
        args,
        code: 1,
        signal: null,
        stdoutTail: stdout.slice(-8000),
        stderrTail: `${stderr}\n${error.message}`.slice(-8000),
        parsed: null,
      });
    });
  });
}

async function createSnapshotWorkspace({
  cwd = process.cwd(),
  workspaceRoot = DEFAULT_AUTOMATION_FEEDBACK_CODE_REPAIR_WORKSPACE_ROOT,
  runId = new Date().toISOString().replace(/[:.]/g, '-'),
  requestId = 'request',
} = {}) {
  const workspacePath = path.join(workspaceRoot, runId, safeRequestId(requestId));
  await rm(workspacePath, { recursive: true, force: true });
  await mkdir(path.dirname(workspacePath), { recursive: true });
  const sourceRoot = path.resolve(cwd);
  const tempRoot = path.join(os.tmpdir(), 'lattice-code-repair-snapshots');
  const tempWorkspacePath = path.join(tempRoot, `${safeRequestId(runId)}-${safeRequestId(requestId)}-${process.pid}`);
  await rm(tempWorkspacePath, { recursive: true, force: true });
  await mkdir(tempRoot, { recursive: true });
  try {
    await cp(sourceRoot, tempWorkspacePath, {
      recursive: true,
      force: true,
      dereference: false,
      filter: (source) => {
        const rel = relPath(source, sourceRoot);
        if (!rel || rel === '.') return true;
        return !isWorkspaceCopyExcluded(rel);
      },
    });
  } catch (error) {
    await rm(tempWorkspacePath, { recursive: true, force: true });
    throw error;
  }
  try {
    await rename(tempWorkspacePath, workspacePath);
  } catch {
    await cp(tempWorkspacePath, workspacePath, { recursive: true, force: true, dereference: false });
    await rm(tempWorkspacePath, { recursive: true, force: true });
  }
  return workspacePath;
}

async function readFileOrNull(filePath = '') {
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}

async function detectChangedAllowedFiles({
  cwd = process.cwd(),
  workspacePath,
  request = {},
  declaredFiles = [],
} = {}) {
  const patterns = request.allowedFiles || [];
  const mainFiles = await expandAllowedFiles(cwd, patterns);
  const workerFiles = await expandAllowedFiles(workspacePath, patterns);
  const normalizedDeclaredFiles = asArray(declaredFiles)
    .map((file) => compact(file).replace(/\\/g, '/'))
    .filter(Boolean);
  const allFiles = [...new Set([...mainFiles, ...workerFiles, ...normalizedDeclaredFiles])].sort();
  const changes = [];
  for (const file of allFiles) {
    const mainPath = path.join(cwd, file);
    const workerPath = path.join(workspacePath, file);
    const [mainContent, workerContent] = await Promise.all([
      readFileOrNull(mainPath),
      readFileOrNull(workerPath),
    ]);
    const mainExists = mainContent !== null;
    const workerExists = workerContent !== null;
    const changed = mainExists !== workerExists
      || (mainExists && workerExists && Buffer.compare(mainContent, workerContent) !== 0);
    if (!changed) continue;
    const allowed = matchesAllowedPattern(file, patterns);
    changes.push({
      file,
      action: !mainExists && workerExists ? 'add' : mainExists && !workerExists ? 'delete' : 'modify',
      allowed,
      forbidden: isForbiddenPatchFile(file),
      providerSpecific: allowed && providerSpecificFilesForRequest(request).includes(file),
      commonFile: !allowed || !providerSpecificFilesForRequest(request).includes(file),
    });
  }
  return changes;
}

async function writeWorkerArtifacts(workspacePath, result = {}) {
  const artifactDir = path.join(workspacePath, 'data', 'runtime', 'code-repair-worker');
  await mkdir(artifactDir, { recursive: true });
  await writeFile(path.join(artifactDir, 'worker-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await writeFile(path.join(artifactDir, 'stdout.tail.txt'), result.codexResult?.stdoutTail || '', 'utf8');
  await writeFile(path.join(artifactDir, 'stderr.tail.txt'), result.codexResult?.stderrTail || '', 'utf8');
  await writeFile(path.join(artifactDir, 'patch.diff'), `${JSON.stringify({
    requestId: result.request?.requestId,
    changedFiles: result.changedFiles,
    note: 'Pseudo patch summary. Full file contents remain in the isolated workspace.',
  }, null, 2)}\n`, 'utf8');
  return artifactDir;
}

async function defaultParallelWorkerRunner({ request, prompt, workspacePath, timeoutMs, verify }) {
  const codexResult = await runCodexExec(prompt, { cwd: workspacePath, timeoutMs });
  const verificationResults = verify
    ? await Promise.all(request.testCommands.map((command) => runCommand(command, { cwd: workspacePath, timeoutMs: 180_000 })))
    : [];
  return { codexResult, verificationResults };
}

async function runIsolatedRepairWorker({
  request,
  cwd = process.cwd(),
  workspaceRoot = DEFAULT_AUTOMATION_FEEDBACK_CODE_REPAIR_WORKSPACE_ROOT,
  runId,
  timeoutMs = DEFAULT_CODE_REPAIR_TIMEOUT_MS,
  verify = true,
  workerRunner = defaultParallelWorkerRunner,
} = {}) {
  const prompt = buildAutomationFeedbackCodeRepairPrompt(request);
  const workspacePath = await createSnapshotWorkspace({ cwd, workspaceRoot, runId, requestId: request.requestId });
  const startedAt = new Date().toISOString();
  const runWorker = typeof workerRunner === 'function' ? workerRunner : defaultParallelWorkerRunner;
  const worker = await runWorker({ request, prompt, workspacePath, timeoutMs, verify });
  const changedFiles = await detectChangedAllowedFiles({
    cwd,
    workspacePath,
    request,
    declaredFiles: worker.codexResult?.parsed?.changedFiles || [],
  });
  const verificationResults = asArray(worker.verificationResults);
  const verificationOk = verificationResults.every((result) => result.code === 0);
  const parsedStatus = worker.codexResult?.parsed?.status || '';
  const codexResultAcceptable = worker.codexResult?.code === 0
    || (verificationOk && ['patched', 'no-safe-patch', 'patched_or_no_safe_patch'].includes(parsedStatus));
  const status = codexResultAcceptable && verificationOk
    ? (worker.codexResult?.parsed?.status || 'patched_or_no_safe_patch')
    : 'failed';
  const result = {
    request,
    executed: true,
    isolated: true,
    workspacePath,
    startedAt,
    finishedAt: new Date().toISOString(),
    status,
    codexResult: worker.codexResult,
    verificationResults,
    changedFiles,
    rejectedFiles: changedFiles.filter((change) => change.forbidden),
  };
  result.workerArtifactDir = await writeWorkerArtifacts(workspacePath, result);
  return result;
}

async function mergeParallelWorkerChanges({
  cwd = process.cwd(),
  runs = [],
} = {}) {
  const fileOwners = new Map();
  for (const run of runs) {
    for (const change of asArray(run.changedFiles)) {
      if (!fileOwners.has(change.file)) fileOwners.set(change.file, []);
      fileOwners.get(change.file).push(run.request.requestId);
    }
  }
  const appliedFiles = [];
  const rejectedFiles = [];
  const rollbackSnapshots = [];
  for (const run of runs) {
    for (const change of asArray(run.changedFiles)) {
      const owners = fileOwners.get(change.file) || [];
      const rejectionReason = change.forbidden
        ? 'forbidden_patch_path'
        : change.allowed === false
          ? 'outside_allowed_write_scope'
        : change.action === 'delete'
          ? 'delete_not_allowed'
          : owners.length > 1
            ? 'operator_review_required_merge_conflict'
            : null;
      if (rejectionReason) {
        rejectedFiles.push({
          requestId: run.request.requestId,
          providerName: run.request.providerName,
          evidenceClass: run.request.evidenceClass,
          file: change.file,
          reason: rejectionReason,
          owners,
        });
        continue;
      }
      const source = path.join(run.workspacePath, change.file);
      const target = path.join(cwd, change.file);
      const previousContent = await readFileOrNull(target);
      rollbackSnapshots.push({
        file: change.file,
        existed: previousContent !== null,
        content: previousContent,
      });
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      appliedFiles.push({
        requestId: run.request.requestId,
        providerName: run.request.providerName,
        evidenceClass: run.request.evidenceClass,
        file: change.file,
        action: change.action,
      });
    }
  }
  return {
    appliedFiles,
    rejectedFiles,
    mergeConflicts: rejectedFiles.filter((item) => item.reason === 'operator_review_required_merge_conflict'),
    rollbackSnapshots,
  };
}

async function rollbackParallelWorkerChanges({ cwd = process.cwd(), snapshots = [] } = {}) {
  const rolledBackFiles = [];
  for (const snapshot of asArray(snapshots).reverse()) {
    const target = path.join(cwd, snapshot.file);
    if (snapshot.existed) {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, snapshot.content);
    } else {
      await rm(target, { force: true });
    }
    rolledBackFiles.push(snapshot.file);
  }
  return rolledBackFiles;
}

async function runParallelAutomationFeedbackCodeRepair({
  requests = [],
  cwd = process.cwd(),
  workspaceRoot = DEFAULT_AUTOMATION_FEEDBACK_CODE_REPAIR_WORKSPACE_ROOT,
  timeoutMs = DEFAULT_CODE_REPAIR_TIMEOUT_MS,
  verify = true,
  workerRunner,
  merge = true,
} = {}) {
  const runId = `parallel-code-repair-${Date.now()}`;
  const workerRuns = await Promise.all(requests.map((request) => runIsolatedRepairWorker({
    request,
    cwd,
    workspaceRoot,
    runId,
    timeoutMs,
    verify,
    workerRunner,
  })));
  const mergeResult = merge
    ? await mergeParallelWorkerChanges({ cwd, runs: workerRuns.filter((run) => run.status !== 'failed') })
    : { appliedFiles: [], rejectedFiles: [], mergeConflicts: [] };
  return {
    runId,
    workspaceRoot: path.join(workspaceRoot, runId),
    workerRuns,
    mergeResult,
  };
}

async function defaultEvidenceDeltaVerifier({
  cwd = process.cwd(),
  runtimeRoot = path.join(cwd, 'data', 'runtime'),
  timeoutMs = DEFAULT_CODE_REPAIR_TIMEOUT_MS,
} = {}) {
  const before = await readAutomationCycleEvidenceSnapshot(runtimeRoot);
  const command = 'node --import tsx scripts/run-autonomous-automation-cycle.mjs --apply --limit 25 --staged-provider-max-targets 20';
  const commandResult = await runCommand(command, { cwd, timeoutMs });
  const after = await readAutomationCycleEvidenceSnapshot(runtimeRoot);
  const delta = buildEvidenceDelta(before, after);
  return {
    command,
    commandResult,
    before,
    after,
    delta,
    ...classifyCodeRepairEvidenceEffect(delta),
  };
}

async function refreshAutomationCycleAfterRollback({
  cwd = process.cwd(),
  timeoutMs = DEFAULT_CODE_REPAIR_TIMEOUT_MS,
} = {}) {
  const command = 'node --import tsx scripts/run-autonomous-automation-cycle.mjs --apply --limit 25 --staged-provider-max-targets 20';
  return await runCommand(command, { cwd, timeoutMs });
}

export async function runAutomationFeedbackCodeRepair({
  remediation = {},
  execute = false,
  maxRepairs = 1,
  cwd = process.cwd(),
  timeoutMs = DEFAULT_CODE_REPAIR_TIMEOUT_MS,
  verify = true,
  writeArtifact = true,
  artifactPath = DEFAULT_AUTOMATION_FEEDBACK_CODE_REPAIR_PATH,
  providerCollectorRegistry = null,
  parallel = false,
  parallelWorkers = 3,
  isolation = 'snapshot-worktree',
  workspaceRoot = DEFAULT_AUTOMATION_FEEDBACK_CODE_REPAIR_WORKSPACE_ROOT,
  workerRunner = null,
  avoidSharedIntegrationConflicts = true,
  verifyEvidenceDelta = false,
  evidenceDeltaVerifier = defaultEvidenceDeltaVerifier,
  rollbackIneffective = true,
} = {}) {
  const generatedAt = new Date().toISOString();
  const shouldLoadPreviousCodeRepair = !(
    writeArtifact === false
    && path.resolve(artifactPath) === path.resolve(DEFAULT_AUTOMATION_FEEDBACK_CODE_REPAIR_PATH)
  );
  const previousCodeRepair = shouldLoadPreviousCodeRepair
    ? await loadAutomationFeedbackCodeRepair(artifactPath)
    : null;
  const priorSuccessfulRepairIds = [...successfulRepairRequestIds(previousCodeRepair)].sort();
  const requests = parallel
    ? buildParallelAutomationFeedbackCodeRepairBatch({
      remediation,
      maxRepairs,
      parallelWorkers,
      previousCodeRepair,
      providerCollectorRegistry,
      avoidSharedIntegrationConflicts,
    })
    : buildAutomationFeedbackCodeRepairRequests({
      remediation,
      maxRepairs,
      previousCodeRepair,
      providerCollectorRegistry,
    });
  const skippedRequests = buildAutomationFeedbackCodeRepairSkippedRequests({
    remediation,
    previousCodeRepair,
    providerCollectorRegistry,
  });
  const runs = [];
  let parallelResult = null;
  if (parallel && execute) {
    parallelResult = await runParallelAutomationFeedbackCodeRepair({
      requests,
      cwd,
      workspaceRoot,
      timeoutMs,
      verify,
      workerRunner,
      merge: true,
    });
    runs.push(...parallelResult.workerRuns.map((run) => ({
      ...run,
      mergeAppliedFiles: parallelResult.mergeResult.appliedFiles.filter((item) => item.requestId === run.request.requestId),
      mergeRejectedFiles: parallelResult.mergeResult.rejectedFiles.filter((item) => item.requestId === run.request.requestId),
    })));
  } else {
    for (const request of requests) {
      const prompt = buildAutomationFeedbackCodeRepairPrompt(request);
      if (!execute) {
        runs.push({
          request,
          executed: false,
          prompt,
          status: 'planned',
        });
        continue;
      }
      const codexResult = await runCodexExec(prompt, { cwd, timeoutMs });
      const verificationResults = verify
        ? await Promise.all(request.testCommands.map((command) => runCommand(command, { cwd, timeoutMs: 180_000 })))
        : [];
      runs.push({
        request,
        executed: true,
        codexResult,
        verificationResults,
        status: codexResult.code === 0 && verificationResults.every((result) => result.code === 0)
          ? (codexResult.parsed?.status || 'patched_or_no_safe_patch')
          : 'failed',
      });
    }
  }

  const postMergeVerificationResults = parallel && execute && verify && parallelResult?.mergeResult?.appliedFiles?.length
    ? await Promise.all(DEFAULT_TEST_COMMANDS.map((command) => runCommand(command, { cwd, timeoutMs: 180_000 })))
    : [];
  let patchesRolledBack = [];
  let postRollbackRefreshResult = null;
  if (postMergeVerificationResults.some((result) => result.code !== 0)) {
    patchesRolledBack = await rollbackParallelWorkerChanges({
      cwd,
      snapshots: parallelResult?.mergeResult?.rollbackSnapshots || [],
    });
    postRollbackRefreshResult = await refreshAutomationCycleAfterRollback({ cwd, timeoutMs });
    for (const run of runs) {
      if (run.executed) run.status = 'failed_post_merge_verification';
    }
  }
  const runtimeRoot = path.dirname(artifactPath);
  let evidenceDeltaAfterMerge = null;
  const hasAppliedPatches = Boolean(parallelResult?.mergeResult?.appliedFiles?.length);
  if (
    parallel
    && execute
    && verifyEvidenceDelta === true
    && hasAppliedPatches
    && !patchesRolledBack.length
  ) {
    const verifyEffect = typeof evidenceDeltaVerifier === 'function'
      ? evidenceDeltaVerifier
      : defaultEvidenceDeltaVerifier;
    evidenceDeltaAfterMerge = await verifyEffect({
      cwd,
      runtimeRoot,
      timeoutMs,
      requests,
      runs,
      appliedFiles: parallelResult.mergeResult.appliedFiles,
    });
    for (const run of runs) {
      if (!run.executed || !asArray(run.mergeAppliedFiles).length) continue;
      run.effectStatus = evidenceDeltaAfterMerge.effectStatus;
      run.evidenceDelta = evidenceDeltaAfterMerge.delta;
      if (evidenceDeltaAfterMerge.effectStatus === 'effective') {
        run.status = 'patched_effective';
      } else if (evidenceDeltaAfterMerge.effectStatus === 'weak_effect') {
        run.status = 'patched_weak_effect';
      } else {
        run.status = 'ineffective';
      }
    }
    if (evidenceDeltaAfterMerge.effectStatus === 'ineffective' && rollbackIneffective !== false) {
      patchesRolledBack = await rollbackParallelWorkerChanges({
        cwd,
        snapshots: parallelResult?.mergeResult?.rollbackSnapshots || [],
      });
      postRollbackRefreshResult = await refreshAutomationCycleAfterRollback({ cwd, timeoutMs });
      for (const run of runs) {
        if (run.executed && asArray(run.mergeAppliedFiles).length) {
          run.status = 'ineffective_rolled_back';
          run.effectStatus = 'ineffective';
        }
      }
    }
  }

  const payload = {
    ok: runs.every((run) => !run.executed || !String(run.status).startsWith('failed')),
    version: AUTOMATION_FEEDBACK_CODE_REPAIR_VERSION,
    generatedAt,
    mode: execute ? (parallel ? 'execute_codex_cli_parallel' : 'execute_codex_cli') : 'plan_only',
    codexCliAvailable: true,
    parallel: parallel === true,
    parallelWorkers: parallel ? Number(parallelWorkers || 3) : 1,
    sharedIntegrationConflictAvoidance: parallel ? avoidSharedIntegrationConflicts !== false : false,
    isolation: parallel ? isolation : 'none',
    requestCount: requests.length,
    executedCount: runs.filter((run) => run.executed).length,
    skippedRequestCount: skippedRequests.length,
    skippedRequests,
    priorSuccessfulRepairIds,
    priorIneffectiveRepairIds: [...recentlyIneffectiveRepairRequestIds(previousCodeRepair)].sort(),
    priorIneffectiveProviderKeys: [...recentlyIneffectiveProviderKeys(previousCodeRepair)].sort(),
    runs,
    parallelExecution: parallelResult ? {
      runId: parallelResult.runId,
      workspaceRoot: parallelResult.workspaceRoot,
      workerStatuses: parallelResult.workerRuns.map((run) => ({
        requestId: run.request.requestId,
        providerName: run.request.providerName,
        evidenceClass: run.request.evidenceClass,
        status: run.status,
        workspacePath: run.workspacePath,
        changedFiles: run.changedFiles,
        workerArtifactDir: run.workerArtifactDir,
      })),
      mergeConflicts: parallelResult.mergeResult.mergeConflicts,
      patchesApplied: parallelResult.mergeResult.appliedFiles,
      patchesRejected: parallelResult.mergeResult.rejectedFiles,
      patchesRolledBack,
      postMergeVerificationResults,
      evidenceDeltaAfterMerge,
      postRollbackRefreshResult,
    } : null,
    safetyPolicy: {
      codePatchAllowed: execute === true,
      noCommitOrPush: true,
      providerActivationAllowed: false,
      readinessPromotionAllowed: false,
      reportCandidateWriteAllowed: false,
      portfolioActionAllowed: false,
    },
    mutationBoundary: zeroBoundary(),
  };
  if (writeArtifact !== false) payload.artifactPath = await writeAutomationFeedbackCodeRepairArtifact(payload, artifactPath);
  return payload;
}

export async function writeAutomationFeedbackCodeRepairArtifact(
  payload,
  filePath = DEFAULT_AUTOMATION_FEEDBACK_CODE_REPAIR_PATH,
) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}

export async function loadAutomationFeedbackCodeRepair(filePath = DEFAULT_AUTOMATION_FEEDBACK_CODE_REPAIR_PATH) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}
