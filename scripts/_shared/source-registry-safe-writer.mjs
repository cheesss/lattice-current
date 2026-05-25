import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  evaluateSourceProviderActivation,
  normalizeSourceProviderCandidate,
  summarizeActivationEvaluations,
} from './source-provider-activation-policy.mjs';

export const SOURCE_REGISTRY_SAFE_WRITER_VERSION = 'source-registry-safe-writer-v1';
export const DEFAULT_SOURCE_PROVIDER_ACTIVATION_PATH = path.join(process.cwd(), 'data', 'runtime', 'source-provider-activation.latest.json');

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

function addBoundary(a = {}, b = {}) {
  const out = zeroBoundary(a);
  for (const key of Object.keys(out)) out[key] = Number(out[key] || 0) + Number(b[key] || 0);
  return out;
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}

function historyEntry(status, reason, at, actor) {
  return {
    status,
    reason: compact(reason || 'source/provider lifecycle update'),
    at,
    actor: compact(actor || 'automation'),
  };
}

function recordFromEvaluation(evaluation, existingRecord = null, options = {}) {
  const now = options.generatedAt || new Date().toISOString();
  const candidate = evaluation.candidate || normalizeSourceProviderCandidate(evaluation.candidate || {});
  const previousStatus = existingRecord?.status || candidate.status || 'discovered_untrusted';
  const statusHistory = asArray(existingRecord?.statusHistory);
  if (!statusHistory.length || previousStatus !== evaluation.status) {
    statusHistory.push(historyEntry(evaluation.status, evaluation.reasons?.[0], now, options.actor));
  }
  return {
    ...(existingRecord || {}),
    candidateId: candidate.candidateId,
    providerName: candidate.providerName,
    evidenceClass: candidate.evidenceClass,
    sourceUrl: candidate.sourceUrl,
    sourceType: candidate.sourceType,
    providerRoute: candidate.providerRoute,
    discoveredBy: candidate.discoveredBy,
    status: evaluation.status,
    activationTier: evaluation.activationTier,
    activationAllowed: evaluation.activationAllowed,
    registryWriteKind: evaluation.registryWriteKind,
    fixtureStatus: evaluation.fixtureStatus,
    parserStatus: evaluation.parserStatus,
    healthcheckStatus: evaluation.healthcheckStatus,
    activationBlocker: evaluation.activationBlocker,
    lifecycleReadiness: evaluation.lifecycleReadiness || null,
    reviewGatedActivation: true,
    candidate,
    evaluation: {
      version: evaluation.version,
      reasons: evaluation.reasons || [],
      warnings: evaluation.warnings || [],
      fixtureStatus: evaluation.fixtureStatus,
      parserStatus: evaluation.parserStatus,
      healthcheckStatus: evaluation.healthcheckStatus,
      activationBlocker: evaluation.activationBlocker,
      boundaries: evaluation.boundaries,
    },
    probe: candidate.probe || existingRecord?.probe || null,
    statusHistory,
    createdAt: existingRecord?.createdAt || candidate.createdAt || now,
    updatedAt: now,
  };
}

export async function readSourceProviderActivationArtifact(filePath = DEFAULT_SOURCE_PROVIDER_ACTIVATION_PATH) {
  const parsed = await readJsonIfExists(filePath);
  if (!parsed) {
    return {
      ok: true,
      version: SOURCE_REGISTRY_SAFE_WRITER_VERSION,
      generatedAt: null,
      records: [],
      summary: summarizeActivationEvaluations([]),
      boundaries: zeroBoundary(),
    };
  }
  return {
    ok: true,
    version: SOURCE_REGISTRY_SAFE_WRITER_VERSION,
    records: asArray(parsed.records),
    summary: parsed.summary || summarizeActivationEvaluations([]),
    boundaries: { ...zeroBoundary(), ...(parsed.boundaries || {}) },
    artifactPath: path.resolve(filePath),
    ...parsed,
  };
}

export function buildSourceProviderActivationRecords(candidates = [], options = {}) {
  const existingRecords = asArray(options.existing?.records || options.existingRecords);
  const byId = new Map(existingRecords.map((record) => [String(record.candidateId || '').toLowerCase(), record]));
  const probesByCandidateId = options.probesByCandidateId || {};
  const evaluations = [];
  const records = [];
  let boundaries = zeroBoundary();

  for (const candidateInput of asArray(candidates)) {
    const normalized = normalizeSourceProviderCandidate(candidateInput);
    const probe = candidateInput.probe || probesByCandidateId[normalized.candidateId] || probesByCandidateId[normalized.sourceUrl] || normalized.probe;
    const evaluation = evaluateSourceProviderActivation({ ...normalized, probe }, options);
    const record = recordFromEvaluation(evaluation, byId.get(normalized.candidateId), options);
    byId.set(normalized.candidateId, record);
    evaluations.push(evaluation);
    records.push(record);
    boundaries = addBoundary(boundaries, evaluation.boundaries);
  }

  const merged = [
    ...existingRecords.filter((record) => !records.some((next) => next.candidateId === record.candidateId)),
    ...records,
  ];

  return {
    ok: true,
    version: SOURCE_REGISTRY_SAFE_WRITER_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    mode: options.mode || 'artifact_only',
    records: merged,
    updatedRecords: records,
    evaluations,
    summary: summarizeActivationEvaluations(evaluations),
    boundaries,
    mutationPolicy: 'artifact registry only; canonical/source registry active writes remain gated by activation policy',
  };
}

export async function runSourceProviderActivation(candidates = [], options = {}) {
  const artifactPath = options.artifactPath || DEFAULT_SOURCE_PROVIDER_ACTIVATION_PATH;
  const existing = options.existing || await readSourceProviderActivationArtifact(artifactPath);
  const payload = buildSourceProviderActivationRecords(candidates, {
    ...options,
    existing,
  });
  if (options.writeArtifact !== false) {
    payload.artifactPath = await writeJson(artifactPath, payload);
  }
  return payload;
}

export async function upsertSourceProviderCandidates(candidates = [], options = {}) {
  return runSourceProviderActivation(candidates, {
    ...options,
    mode: options.mode || 'discovered_untrusted_ingest',
  });
}

export function buildSourceProviderActivationSurface(payload = {}) {
  const records = asArray(payload.records);
  const byStatus = {};
  const byFixtureStatus = {};
  const byParserStatus = {};
  const byHealthcheckStatus = {};
  for (const record of records) byStatus[record.status] = (byStatus[record.status] || 0) + 1;
  for (const record of records) {
    if (record.fixtureStatus) byFixtureStatus[record.fixtureStatus] = (byFixtureStatus[record.fixtureStatus] || 0) + 1;
    if (record.parserStatus) byParserStatus[record.parserStatus] = (byParserStatus[record.parserStatus] || 0) + 1;
    if (record.healthcheckStatus) byHealthcheckStatus[record.healthcheckStatus] = (byHealthcheckStatus[record.healthcheckStatus] || 0) + 1;
  }
  return {
    ok: true,
    source: 'source-provider-activation-surface',
    available: records.length > 0,
    generatedAt: payload.generatedAt || null,
    counts: {
      total: records.length,
      byStatus,
      staged: byStatus.staged || 0,
      activeLimited: byStatus.active_limited || 0,
      quarantined: byStatus.quarantined || 0,
      needsCredentials: byStatus.needs_credentials || 0,
      needsFixture: byStatus.needs_fixture || 0,
      providerGapProposalRequired: byStatus.provider_gap_proposal_required || 0,
      byFixtureStatus,
      byParserStatus,
      byHealthcheckStatus,
    },
    candidates: records.slice(0, 50).map((record) => ({
      candidateId: record.candidateId,
      providerName: record.providerName,
      evidenceClass: record.evidenceClass,
      status: record.status,
      activationTier: record.activationTier,
      registryWriteKind: record.registryWriteKind,
      fixtureStatus: record.fixtureStatus || null,
      parserStatus: record.parserStatus || null,
      healthcheckStatus: record.healthcheckStatus || null,
      activationBlocker: record.activationBlocker || null,
      reason: record.evaluation?.reasons?.[0] || null,
    })),
    boundaries: { ...zeroBoundary(), ...(payload.boundaries || {}) },
    audit: {
      artifactPath: payload.artifactPath || null,
      rawRecords: records,
    },
  };
}
