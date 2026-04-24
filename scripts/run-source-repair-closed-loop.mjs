#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { probeSource } from './_shared/source-probe.mjs';
import { markApprovalReviewed } from './_shared/approval-queue.mjs';
import { queueCodexSourceCodeRepair } from './_shared/codex-source-code-repair.mjs';
import {
  attemptSourceRepair,
  buildCatalogRepairCandidates,
  getRepairCatalogEntries,
} from './_shared/source-repair.mjs';
import { registerProbedSource } from './_shared/discovered-source-registry.mjs';
import { backfillActiveRssSources } from './backfill-active-rss-sources.mjs';
import { refreshDiscoveryFromRecentThemes } from './refresh-discovery-from-recent-themes.mjs';

const { Client } = pg;

const DEFAULT_AUDIT_DIR = path.resolve('data', 'audits');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    parsed.hash = '';
    return parsed.href.replace(/\/+$/, '').toLowerCase();
  } catch {
    return '';
  }
}

function parseBool(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    apply: false,
    limit: 300,
    targetSuccesses: 20,
    minQualityScore: 0.65,
    maxCandidates: 48,
    backfillLimit: 60,
    dailyRssBudget: 120,
    enableLlm: false,
    fullHeuristic: true,
    probeOriginal: true,
    catalogBootstrap: true,
    countHistoricalSuccesses: true,
    enableCodeRepair: true,
    maxCodeRepairRequests: 3,
    codeRepairArtifactDir: path.resolve('data', 'codex-source-repair-runs'),
    refreshDiscovery: true,
    auditDir: DEFAULT_AUDIT_DIR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [rawKey, inlineValue] = token.slice(2).split('=');
    const key = rawKey.trim();
    let value = inlineValue ?? null;
    if (inlineValue == null) {
      const next = argv[index + 1];
      if (next && !String(next).startsWith('--')) {
        value = next;
        index += 1;
      }
    }
    if (key === 'apply') out.apply = true;
    else if (key === 'dry-run' || key === 'dryRun') out.apply = false;
    else if (key === 'limit') out.limit = Number(value || out.limit);
    else if (key === 'target-successes' || key === 'targetSuccesses') out.targetSuccesses = Number(value || out.targetSuccesses);
    else if (key === 'min-quality' || key === 'minQualityScore') out.minQualityScore = Number(value || out.minQualityScore);
    else if (key === 'max-candidates' || key === 'maxCandidates') out.maxCandidates = Number(value || out.maxCandidates);
    else if (key === 'backfill-limit' || key === 'backfillLimit') out.backfillLimit = Number(value || out.backfillLimit);
    else if (key === 'daily-rss-budget' || key === 'dailyRssBudget') out.dailyRssBudget = Number(value || out.dailyRssBudget);
    else if (key === 'enable-llm' || key === 'enableLlm') out.enableLlm = value == null ? true : parseBool(value);
    else if (key === 'full-heuristic' || key === 'fullHeuristic') out.fullHeuristic = value == null ? true : parseBool(value);
    else if (key === 'no-full-heuristic') out.fullHeuristic = false;
    else if (key === 'no-probe-original') out.probeOriginal = false;
    else if (key === 'catalog-bootstrap' || key === 'catalogBootstrap') out.catalogBootstrap = value == null ? true : parseBool(value);
    else if (key === 'no-catalog-bootstrap') out.catalogBootstrap = false;
    else if (key === 'count-historical-successes' || key === 'countHistoricalSuccesses') out.countHistoricalSuccesses = value == null ? true : parseBool(value);
    else if (key === 'no-count-historical-successes') out.countHistoricalSuccesses = false;
    else if (key === 'disable-code-repair' || key === 'no-code-repair') out.enableCodeRepair = false;
    else if (key === 'enable-code-repair' || key === 'enableCodeRepair') out.enableCodeRepair = value == null ? true : parseBool(value);
    else if (key === 'max-code-repair-requests' || key === 'maxCodeRepairRequests') out.maxCodeRepairRequests = Number(value || out.maxCodeRepairRequests);
    else if (key === 'code-repair-artifact-dir' || key === 'codeRepairArtifactDir') out.codeRepairArtifactDir = path.resolve(String(value || out.codeRepairArtifactDir));
    else if (key === 'no-refresh-discovery') out.refreshDiscovery = false;
    else if (key === 'audit-dir' || key === 'auditDir') out.auditDir = String(value || out.auditDir);
  }
  out.limit = Math.max(1, Math.min(500, Math.floor(Number(out.limit) || 80)));
  out.targetSuccesses = Math.max(1, Math.min(50, Math.floor(Number(out.targetSuccesses) || 10)));
  out.minQualityScore = Math.max(0.1, Math.min(1, Number(out.minQualityScore) || 0.65));
  out.maxCandidates = Math.max(1, Math.min(80, Math.floor(Number(out.maxCandidates) || 36)));
  out.backfillLimit = Math.max(1, Math.min(300, Math.floor(Number(out.backfillLimit) || 60)));
  out.dailyRssBudget = Math.max(0, Math.min(500, Math.floor(Number(out.dailyRssBudget) || 80)));
  out.maxCodeRepairRequests = Math.max(0, Math.min(10, Math.floor(Number(out.maxCodeRepairRequests) || 3)));
  return out;
}

function proposalFromApproval(row) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    sourceTable: 'approval_queue',
    approvalId: row.id,
    proposalId: null,
    status: row.status,
    actionType: row.action_type,
    url: normalizeText(payload.url || payload.inputUrl || payload.resolvedUrl),
    name: normalizeText(payload.name || payload.feedName || `repaired source ${row.id}`),
    theme: normalizeText(payload.theme || payload.normalizedTheme || payload.parentTheme || 'general').toLowerCase() || 'general',
    reason: normalizeText(payload.reason || row.reasoning || `closed-loop repair for approval ${row.id}`),
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

function proposalFromCodexProposal(row) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    sourceTable: 'codex_proposals',
    approvalId: null,
    proposalId: row.id,
    status: row.status,
    actionType: row.proposal_type,
    url: normalizeText(payload.url || payload.inputUrl || payload.resolvedUrl),
    name: normalizeText(payload.name || payload.feedName || `repaired source proposal ${row.id}`),
    theme: normalizeText(payload.theme || payload.normalizedTheme || payload.parentTheme || 'general').toLowerCase() || 'general',
    reason: normalizeText(payload.reason || row.reasoning || `closed-loop repair for proposal ${row.id}`),
    createdAt: row.created_at,
    reviewedAt: row.executed_at,
  };
}

async function loadRejectedAddRssApprovals(client, limit) {
  const { rows } = await client.query(
    `
      SELECT id, action_type, payload, status, reasoning, created_at, reviewed_at
      FROM approval_queue
      WHERE action_type = 'add-rss'
        AND status IN ('rejected', 'needs-fix')
        AND COALESCE(payload->>'url', payload->>'inputUrl', payload->>'resolvedUrl', '') <> ''
      ORDER BY
        CASE status WHEN 'needs-fix' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
        COALESCE(reviewed_at, created_at) DESC,
        id DESC
      LIMIT $1
    `,
    [limit],
  );
  return rows.map(proposalFromApproval).filter((proposal) => proposal.url);
}

async function loadRejectedAddRssCodexProposals(client, limit) {
  const { rows } = await client.query(
    `
      SELECT id, proposal_type, payload, status, result, reasoning, source, created_at, executed_at
      FROM codex_proposals
      WHERE proposal_type = 'add-rss'
        AND status IN ('rejected', 'needs-fix', 'failed', 'dead')
        AND COALESCE(payload->>'url', payload->>'inputUrl', payload->>'resolvedUrl', '') <> ''
      ORDER BY
        CASE status WHEN 'needs-fix' THEN 0 WHEN 'failed' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,
        COALESCE(executed_at, created_at) DESC,
        id DESC
      LIMIT $1
    `,
    [limit],
  );
  return rows.map(proposalFromCodexProposal).filter((proposal) => proposal.url);
}

function dedupeRepairProposals(proposals = []) {
  const seen = new Set();
  const deduped = [];
  for (const proposal of proposals) {
    const key = [
      normalizeUrl(proposal.url),
      normalizeText(proposal.theme).toLowerCase(),
      normalizeText(proposal.name).toLowerCase(),
    ].join('|');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(proposal);
  }
  return deduped;
}

async function loadRepairProposals(client, limit) {
  const [approvals, codexProposals] = await Promise.all([
    loadRejectedAddRssApprovals(client, limit),
    loadRejectedAddRssCodexProposals(client, limit),
  ]);
  return dedupeRepairProposals([...approvals, ...codexProposals]).slice(0, limit);
}

async function loadActiveRegistrySources(registryPath = path.resolve('data', 'persistent-cache', 'source-registry%3Av1.json')) {
  try {
    const parsed = JSON.parse(await fs.readFile(registryPath, 'utf8'));
    const sources = parsed?.data?.discoveredSources;
    if (!Array.isArray(sources)) return [];
    return sources
        .filter((source) => String(source?.status || '').toLowerCase() === 'active')
      .map((source) => ({
        url: normalizeText(source?.url),
        normalizedUrl: normalizeUrl(source?.url),
        feedName: normalizeText(source?.feedName || source?.domain || source?.url),
        category: normalizeText(source?.category || ''),
        discoveredBy: normalizeText(source?.discoveredBy || source?.actor || ''),
      }))
      .filter((source) => source.normalizedUrl);
  } catch {
    return [];
  }
}

async function loadActiveRegistryUrls(registryPath = path.resolve('data', 'persistent-cache', 'source-registry%3Av1.json')) {
  return new Set((await loadActiveRegistrySources(registryPath)).map((source) => source.normalizedUrl));
}

async function loadHistoricalPipelineSummary(client) {
  const sources = await loadActiveRegistrySources();
  const feedNames = [...new Set(sources.map((source) => source.feedName).filter(Boolean))];
  if (feedNames.length === 0) {
    return {
      activeSources: sources.length,
      seededSources: 0,
      themedSources: 0,
      eventMappedSources: 0,
      pendingOutcomeSources: 0,
      pendingOutcomes: 0,
      codexRepairActiveSources: 0,
      codexRepairSeededSources: 0,
      codexRepairThemedSources: 0,
      codexRepairEventMappedSources: 0,
      codexRepairPendingOutcomeSources: 0,
      codexRepairPendingOutcomes: 0,
    };
  }
  const codexRepairFeedNames = new Set(sources
    .filter((source) => source.discoveredBy === 'codex-source-repair-closed-loop')
    .map((source) => source.feedName)
    .filter(Boolean));
  const { rows } = await client.query(
    `
      SELECT
        a.source,
        COUNT(DISTINCT a.id)::int AS article_count,
        COUNT(DISTINCT t.article_id)::int AS themed_count,
        COUNT(DISTINCT aem.article_id)::int AS event_mapped_count,
        COUNT(DISTINCT po.id)::int AS pending_outcome_count
      FROM articles a
      LEFT JOIN auto_article_themes t ON t.article_id = a.id
      LEFT JOIN article_event_map aem ON aem.article_id = a.id
      LEFT JOIN pending_outcomes po ON po.article_id = a.id
      WHERE a.source = ANY($1::text[])
      GROUP BY a.source
    `,
    [feedNames],
  );
  const bySource = new Map(rows.map((row) => [String(row.source || ''), {
    articleCount: Number(row.article_count || 0),
    themedCount: Number(row.themed_count || 0),
    eventMappedCount: Number(row.event_mapped_count || 0),
    pendingOutcomeCount: Number(row.pending_outcome_count || 0),
  }]));
  const codexSources = sources.filter((source) => codexRepairFeedNames.has(source.feedName));
  return {
    activeSources: sources.length,
    seededSources: sources.filter((source) => Number(bySource.get(source.feedName)?.articleCount || 0) > 0).length,
    themedSources: sources.filter((source) => Number(bySource.get(source.feedName)?.themedCount || 0) > 0).length,
    eventMappedSources: sources.filter((source) => Number(bySource.get(source.feedName)?.eventMappedCount || 0) > 0).length,
    pendingOutcomeSources: sources.filter((source) => Number(bySource.get(source.feedName)?.pendingOutcomeCount || 0) > 0).length,
    pendingOutcomes: [...bySource.values()].reduce((sum, row) => sum + Number(row.pendingOutcomeCount || 0), 0),
    codexRepairActiveSources: codexSources.length,
    codexRepairSeededSources: codexSources.filter((source) => Number(bySource.get(source.feedName)?.articleCount || 0) > 0).length,
    codexRepairThemedSources: codexSources.filter((source) => Number(bySource.get(source.feedName)?.themedCount || 0) > 0).length,
    codexRepairEventMappedSources: codexSources.filter((source) => Number(bySource.get(source.feedName)?.eventMappedCount || 0) > 0).length,
    codexRepairPendingOutcomeSources: codexSources.filter((source) => Number(bySource.get(source.feedName)?.pendingOutcomeCount || 0) > 0).length,
    codexRepairPendingOutcomes: codexSources.reduce((sum, source) => sum + Number(bySource.get(source.feedName)?.pendingOutcomeCount || 0), 0),
  };
}

export function selectAcceptedRepairAttempt(attempts = [], usedUrls = new Set(), activeUrls = new Set()) {
  return attempts
    .filter((attempt) => attempt?.accepted)
    .map((attempt) => ({
      ...attempt,
      normalizedUrl: normalizeUrl(attempt.resolvedUrl || attempt.url),
    }))
    .filter((attempt) => attempt.normalizedUrl && !usedUrls.has(attempt.normalizedUrl) && !activeUrls.has(attempt.normalizedUrl))
    .sort((a, b) => Number(b.qualityScore || 0) - Number(a.qualityScore || 0) || String(a.label || a.url).localeCompare(String(b.label || b.url)))[0] || null;
}

function feedNameForAttempt(proposal, attempt) {
  const label = normalizeText(attempt?.label);
  if (label && label.length >= 3 && !/^https?:\/\//i.test(label)) return label.slice(0, 120);
  return normalizeText(proposal.name || 'Repaired RSS source').slice(0, 120);
}

function isAcceptedProbe(probe, minQualityScore) {
  return (
    (probe?.nextAction === 'register' || probe?.nextAction === 'review')
    && Number(probe?.qualityScore || 0) >= minQualityScore
    && Number(probe?.qualityBreakdown?.recentItemCount || 0) >= 3
  );
}

async function probeCatalogRepairCandidates(proposal, activeUrls, usedUrls, options) {
  const attempts = [];
  const candidates = buildCatalogRepairCandidates({
    inputUrl: proposal.url,
    theme: proposal.theme,
    name: proposal.name,
    reason: proposal.reason,
  }).slice(0, options.maxCandidates);

  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate.url);
    if (!normalized || activeUrls.has(normalized) || usedUrls.has(normalized)) continue;
    try {
      const candidateProbe = await probeSource(candidate.url, {
        theme: proposal.theme,
        qualityThreshold: options.minQualityScore,
      });
      const attempt = {
        ...candidate,
        accepted: isAcceptedProbe(candidateProbe, options.minQualityScore),
        probe: candidateProbe,
        qualityScore: candidateProbe.qualityScore,
        recentItemCount: candidateProbe.qualityBreakdown?.recentItemCount || 0,
        connectorKind: candidateProbe.connectorKind,
        resolvedUrl: candidateProbe.resolvedUrl,
        nextAction: candidateProbe.nextAction,
        normalizedUrl: normalizeUrl(candidateProbe.resolvedUrl || candidate.url),
      };
      attempts.push(attempt);
      if (attempt.accepted) return { selected: attempt, attempts };
    } catch (error) {
      attempts.push({
        ...candidate,
        accepted: false,
        error: String(error?.message || error),
        normalizedUrl: normalized,
      });
    }
  }

  return { selected: null, attempts };
}

async function backfillRegisteredSource(attempt, options) {
  return backfillActiveRssSources({
    onlyUrl: attempt.resolvedUrl || attempt.url,
    maxSources: 1,
    limit: options.backfillLimit,
    concurrency: 1,
    noCursor: true,
    refreshDiscovery: false,
    dryRun: !options.apply,
  });
}

function summarizeAttempt(attempt) {
  return {
    url: attempt?.url,
    resolvedUrl: attempt?.resolvedUrl,
    accepted: attempt?.accepted,
    qualityScore: attempt?.qualityScore,
    recentItemCount: attempt?.recentItemCount,
    connectorKind: attempt?.connectorKind,
    nextAction: attempt?.nextAction,
    source: attempt?.source,
    label: attempt?.label,
  };
}

function isEndToEndSourceSuccess(success) {
  return Number(success?.backfill?.inserted || 0) > 0
    && Number(success?.backfill?.themed || 0) > 0
    && Number(success?.backfill?.eventMapped || 0) > 0
    && !success?.backfill?.error;
}

async function probeOriginalProposal(proposal, options) {
  if (!options.probeOriginal) return { probe: null, error: null };
  try {
    const probe = await probeSource(proposal.url, {
      theme: proposal.theme,
      qualityThreshold: options.minQualityScore,
    });
    return { probe, error: null };
  } catch (error) {
    return { probe: null, error: String(error?.message || error) };
  }
}

export function buildFailureRootCause({ proposal, originalProbe = null, originalProbeError = null, repair = null } = {}) {
  const errors = Array.isArray(originalProbe?.errors) ? originalProbe.errors : [];
  const warnings = Array.isArray(originalProbe?.warnings) ? originalProbe.warnings : [];
  const nextAction = normalizeText(originalProbe?.nextAction || (originalProbeError ? 'probe-error' : 'not-probed'));
  const recentItemCount = Number(originalProbe?.qualityBreakdown?.recentItemCount || 0);
  const qualityScore = Number(originalProbe?.qualityScore || 0);
  let category = 'unknown';
  if (originalProbeError) category = 'probe-error';
  else if (nextAction === 'manual-adapter') category = 'adapter-gap';
  else if (nextAction === 'reject' && recentItemCount <= 0) category = 'no-recent-feed-items';
  else if (nextAction === 'reject' && qualityScore < 0.65) category = 'quality-below-threshold';
  else if (nextAction === 'register' || nextAction === 'review') category = 'candidate-acceptable-but-conflicted';
  else if (nextAction) category = nextAction;

  const failedAdapters = errors
    .map((item) => normalizeText(item?.adapter || item?.connector || item?.type || item?.message))
    .filter(Boolean)
    .slice(0, 8);
  const attemptedRepairCount = Array.isArray(repair?.attempts) ? repair.attempts.length : 0;
  const acceptedRepairCount = Array.isArray(repair?.attempts)
    ? repair.attempts.filter((item) => item?.accepted).length
    : 0;
  return {
    category,
    nextAction,
    originalUrl: proposal?.url || originalProbe?.inputUrl || '',
    resolvedUrl: originalProbe?.resolvedUrl || '',
    connectorKind: originalProbe?.connectorKind || '',
    qualityScore: Number.isFinite(qualityScore) ? qualityScore : null,
    recentItemCount,
    failedAdapters,
    warnings: warnings.map((item) => normalizeText(item?.message || item)).filter(Boolean).slice(0, 8),
    originalProbeError,
    attemptedRepairCount,
    acceptedRepairCount,
    summary: [
      category,
      nextAction ? `nextAction=${nextAction}` : '',
      Number.isFinite(qualityScore) ? `quality=${qualityScore.toFixed(2)}` : '',
      `recentItems=${recentItemCount}`,
      failedAdapters.length ? `failedAdapters=${failedAdapters.join(',')}` : '',
    ].filter(Boolean).join(' | '),
  };
}

function summarizeCodexCodeRepairResult(parsed) {
  const result = parsed?.parsed && typeof parsed.parsed === 'object' ? parsed.parsed : {};
  const request = parsed?.request && typeof parsed.request === 'object' ? parsed.request : {};
  return {
    runId: parsed?.runId || null,
    finishedAt: parsed?.finishedAt || null,
    exitCode: Number.isFinite(Number(parsed?.code)) ? Number(parsed.code) : null,
    status: normalizeText(result.status || (parsed?.code === 0 ? 'completed' : 'failed')),
    changedFiles: Array.isArray(result.changedFiles) ? result.changedFiles.slice(0, 12) : [],
    testsRun: Array.isArray(result.testsRun) ? result.testsRun.slice(0, 12) : [],
    summary: normalizeText(result.summary || parsed?.message || '').slice(0, 1000),
    residualRisk: normalizeText(result.residualRisk || '').slice(0, 1000),
    request: {
      url: request.url || '',
      theme: request.theme || '',
      rootCause: request.rootCause || null,
    },
  };
}

async function loadCodeRepairResults(artifactDir, limit = 12) {
  try {
    const names = (await fs.readdir(artifactDir))
      .filter((name) => name.endsWith('.result.json'));
    const ranked = await Promise.all(names.map(async (name) => {
      const filePath = path.join(artifactDir, name);
      try {
        const stat = await fs.stat(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      } catch {
        return { filePath, mtimeMs: 0 };
      }
    }));
    ranked.sort((a, b) => b.mtimeMs - a.mtimeMs || b.filePath.localeCompare(a.filePath));
    const results = [];
    for (const item of ranked.slice(0, limit)) {
      try {
        const parsed = JSON.parse(await fs.readFile(item.filePath, 'utf8'));
        results.push({ ...summarizeCodexCodeRepairResult(parsed), resultPath: item.filePath });
      } catch {
        // Ignore malformed historical artifacts.
      }
    }
    return results;
  } catch {
    return [];
  }
}

async function markOriginalRepaired(client, proposal, result) {
  const repairedUrl = result?.repairedUrl || result?.selected?.resolvedUrl || result?.selected?.url || '';
  const note = `source-repaired: selected ${repairedUrl}`.slice(0, 500);
  if (proposal.sourceTable === 'approval_queue' && Number.isFinite(Number(proposal.approvalId))) {
    await markApprovalReviewed(client, proposal.approvalId, {
      decision: 'executed',
      reviewer: 'source-repair-closed-loop',
      note,
    });
    return { updated: true, table: 'approval_queue', id: proposal.approvalId, status: 'executed' };
  }

  if (proposal.sourceTable === 'codex_proposals' && Number.isFinite(Number(proposal.proposalId))) {
    await client.query(
      `
        UPDATE codex_proposals
        SET status = 'executed',
            result = $2::jsonb,
            executed_at = NOW()
        WHERE id = $1
      `,
      [
        proposal.proposalId,
        JSON.stringify({
          sourceRepairClosedLoop: true,
          repairedUrl,
          feedName: result?.feedName || null,
          qualityScore: result?.qualityScore ?? null,
          backfill: result?.backfill || null,
        }),
      ],
    );
    return { updated: true, table: 'codex_proposals', id: proposal.proposalId, status: 'executed' };
  }

  return { updated: false, reason: 'no original DB row' };
}

async function queueCodeRepairForFailure({ proposal, originalProbe, originalProbeError, repair, rootCause, options }) {
  if (!options.enableCodeRepair) return { queued: false, reason: 'disabled' };
  return queueCodexSourceCodeRepair({
    url: proposal.url,
    theme: proposal.theme,
    name: proposal.name,
    reason: proposal.reason,
    probe: originalProbe,
    repair,
    rootCause: rootCause || buildFailureRootCause({ proposal, originalProbe, originalProbeError, repair }),
    dryRun: !options.apply,
  });
}

async function applySelectedRepair({
  client,
  proposal,
  selected,
  originalProbe = null,
  originalProbeError = null,
  options,
  activeUrls,
  usedUrls,
  insertedThemes,
}) {
  const feedName = feedNameForAttempt(proposal, selected);
  const sourceTheme = normalizeText(selected.category || proposal.theme || 'general').toLowerCase() || 'general';
  const inheritedProposalTopics = sourceTheme === proposal.theme ? [proposal.theme] : [];
  const sourceTopics = Array.from(new Set([
    sourceTheme,
    ...inheritedProposalTopics,
    ...(Array.isArray(selected.topics) ? selected.topics : []),
    'source-repair-closed-loop',
  ].filter(Boolean))).slice(0, 12);

  let registration = { registered: false, reason: 'dry-run' };
  let backfill = null;
  let originalStatusUpdate = null;
  if (options.apply) {
    registration = await registerProbedSource(client, selected.probe, sourceTheme, {
      feedName,
      lang: 'en',
      topics: sourceTopics,
      autoRegister: true,
      minScore: options.minQualityScore,
      actor: 'codex-source-repair-closed-loop',
      discoveredBy: 'codex-source-repair-closed-loop',
    });
    if (!registration.registered) {
      return {
        ok: false,
        activeUrls,
        failure: {
          approvalId: proposal.approvalId,
          proposalId: proposal.proposalId,
          sourceTable: proposal.sourceTable,
          url: proposal.url,
          repairedUrl: selected.resolvedUrl || selected.url,
          feedName,
          reason: registration.reason,
          quality: registration.quality,
        },
      };
    }
    activeUrls = await loadActiveRegistryUrls();
    backfill = await backfillRegisteredSource(selected, options);
  } else {
    backfill = await backfillRegisteredSource(selected, options);
  }

  const backfillSource = backfill?.sources?.[0] || null;
  usedUrls.add(selected.normalizedUrl || normalizeUrl(selected.resolvedUrl || selected.url));
  if (sourceTheme) insertedThemes.add(sourceTheme);

  const success = {
    approvalId: proposal.approvalId,
    proposalId: proposal.proposalId,
    sourceTable: proposal.sourceTable,
    originalUrl: proposal.url,
    originalQualityScore: originalProbe?.qualityScore ?? null,
    originalNextAction: originalProbe?.nextAction ?? (originalProbeError ? 'probe-error' : 'not-reprobed'),
    originalProbeError,
    repairedUrl: selected.resolvedUrl || selected.url,
    feedName,
    originalTheme: proposal.theme,
    theme: sourceTheme,
    topics: sourceTopics,
    qualityScore: selected.qualityScore,
    recentItemCount: selected.recentItemCount,
    connectorKind: selected.connectorKind,
    repairSource: selected.source,
    registration,
    backfill: backfillSource
      ? {
        fetched: backfillSource.fetched,
        inserted: backfillSource.inserted,
        themed: backfillSource.themed,
        eventMapped: backfillSource.eventMapped,
        pendingOutcomes: backfillSource.pendingOutcomes,
        error: backfillSource.error || null,
      }
      : {
        fetched: backfill?.fetched || 0,
        inserted: backfill?.inserted || 0,
        themed: backfill?.themed || 0,
        eventMapped: backfill?.eventMapped || 0,
        pendingOutcomes: backfill?.pendingOutcomes || 0,
        error: null,
      },
  };

  if (options.apply) {
    try {
      originalStatusUpdate = await markOriginalRepaired(client, proposal, success);
    } catch (error) {
      originalStatusUpdate = { updated: false, error: String(error?.message || error) };
    }
  }
  success.originalStatusUpdate = originalStatusUpdate;

  return { ok: true, activeUrls, success };
}

async function probeCatalogBootstrapCandidate(entry, activeUrls, usedUrls, options) {
  const normalized = normalizeUrl(entry.url);
  if (!normalized || activeUrls.has(normalized) || usedUrls.has(normalized)) return null;
  const candidateProbe = await probeSource(entry.url, {
    theme: entry.category,
    qualityThreshold: options.minQualityScore,
  });
  const accepted = isAcceptedProbe(candidateProbe, options.minQualityScore);
  if (!accepted) {
    return {
      skipped: {
        url: entry.url,
        theme: entry.category,
        reason: 'catalog bootstrap candidate failed source probe',
        attempt: summarizeAttempt({
          ...entry,
          accepted,
          probe: candidateProbe,
          qualityScore: candidateProbe.qualityScore,
          recentItemCount: candidateProbe.qualityBreakdown?.recentItemCount || 0,
          connectorKind: candidateProbe.connectorKind,
          resolvedUrl: candidateProbe.resolvedUrl,
          nextAction: candidateProbe.nextAction,
          normalizedUrl: normalizeUrl(candidateProbe.resolvedUrl || entry.url),
        }),
      },
    };
  }
  return {
    selected: {
      ...entry,
      accepted,
      probe: candidateProbe,
      qualityScore: candidateProbe.qualityScore,
      recentItemCount: candidateProbe.qualityBreakdown?.recentItemCount || 0,
      connectorKind: candidateProbe.connectorKind,
      resolvedUrl: candidateProbe.resolvedUrl,
      nextAction: candidateProbe.nextAction,
      normalizedUrl: normalizeUrl(candidateProbe.resolvedUrl || entry.url),
    },
  };
}

export async function runSourceRepairClosedLoop(options = {}) {
  loadOptionalEnvFile(options.envFile || '.env.local');
  const args = { ...parseArgs([]), ...options };
  if (args.dailyRssBudget > 0 && !process.env.AUTOMATION_BUDGET_DAILY_RSS_REGISTRATIONS) {
    process.env.AUTOMATION_BUDGET_DAILY_RSS_REGISTRATIONS = String(args.dailyRssBudget);
  }
  process.env.SOURCE_REPAIR_ALLOW_CROSS_DOMAIN_AUTO_APPLY ||= 'true';

  const client = new Client(resolveNasPgConfig());
  await client.connect();

  const audit = {
    ok: false,
    dryRun: !args.apply,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    targetSuccesses: args.targetSuccesses,
    inputs: {
      catalogBootstrap: Boolean(args.catalogBootstrap),
      fullHeuristic: Boolean(args.fullHeuristic),
      probeOriginal: Boolean(args.probeOriginal),
      countHistoricalSuccesses: Boolean(args.countHistoricalSuccesses),
      enableCodeRepair: Boolean(args.enableCodeRepair),
    },
    successes: [],
    skipped: [],
    failures: [],
    codeRepairQueued: [],
    codeRepairResults: await loadCodeRepairResults(args.codeRepairArtifactDir),
    discoveryRefresh: null,
  };
  const usedUrls = new Set();
  const insertedThemes = new Set();
  let activeUrls = await loadActiveRegistryUrls();
  const historical = args.countHistoricalSuccesses
    ? await loadHistoricalPipelineSummary(client)
    : null;
  const historicalSuccessCount = Number(historical?.eventMappedSources || historical?.themedSources || 0);
  const targetForThisRun = args.countHistoricalSuccesses
    ? Math.max(0, args.targetSuccesses - historicalSuccessCount)
    : args.targetSuccesses;
  audit.historical = historical;
  audit.targetForThisRun = targetForThisRun;

  try {
    const proposals = await loadRepairProposals(client, args.limit);
    for (const proposal of proposals) {
      if (audit.successes.length >= targetForThisRun) break;
      try {
        const original = await probeOriginalProposal(proposal, args);
        const originalProbe = original.probe;
        const originalProbeError = original.error;
        let repair = null;
        const catalogRepair = await probeCatalogRepairCandidates(proposal, activeUrls, usedUrls, args);
        let selected = catalogRepair.selected;

        if (!selected && args.fullHeuristic) {
          repair = await attemptSourceRepair({
            inputUrl: proposal.url,
            theme: proposal.theme,
            name: proposal.name,
            reason: proposal.reason,
            probe: originalProbe,
            minQualityScore: args.minQualityScore,
            maxCandidates: args.maxCandidates,
            enableLlm: Boolean(args.enableLlm),
          });
          selected = selectAcceptedRepairAttempt(repair.attempts, usedUrls, activeUrls);
        }

        if (!selected) {
          let codexCodeRepair = null;
          const rootCause = buildFailureRootCause({ proposal, originalProbe, originalProbeError, repair });
          if (audit.codeRepairQueued.length < args.maxCodeRepairRequests) {
            codexCodeRepair = await queueCodeRepairForFailure({
              proposal,
              originalProbe,
              originalProbeError,
              repair,
              rootCause,
              options: args,
            });
            if (codexCodeRepair?.queued) {
              audit.codeRepairQueued.push({
                approvalId: proposal.approvalId,
                proposalId: proposal.proposalId,
                sourceTable: proposal.sourceTable,
                url: proposal.url,
                runId: codexCodeRepair.runId || null,
                dryRun: Boolean(codexCodeRepair.dryRun),
              });
            }
          }
          audit.skipped.push({
            approvalId: proposal.approvalId,
            proposalId: proposal.proposalId,
            sourceTable: proposal.sourceTable,
            url: proposal.url,
            theme: proposal.theme,
            reason: 'no non-active accepted repaired source',
            originalQualityScore: originalProbe?.qualityScore ?? null,
            originalNextAction: originalProbe?.nextAction ?? (originalProbeError ? 'probe-error' : 'not-reprobed'),
            originalProbeError,
            rootCause,
            codexCodeRepair,
            attempts: [...catalogRepair.attempts, ...(repair?.attempts || [])].map(summarizeAttempt),
          });
          continue;
        }

        const applied = await applySelectedRepair({
          client,
          proposal,
          selected,
          originalProbe,
          originalProbeError,
          options: args,
          activeUrls,
          usedUrls,
          insertedThemes,
        });
        activeUrls = applied.activeUrls;
        if (applied.ok) audit.successes.push(applied.success);
        else audit.failures.push(applied.failure);
      } catch (error) {
        audit.failures.push({
          approvalId: proposal.approvalId,
          proposalId: proposal.proposalId,
          sourceTable: proposal.sourceTable,
          url: proposal.url,
          theme: proposal.theme,
          error: String(error?.message || error),
        });
      }
    }

    if (args.catalogBootstrap && audit.successes.length < targetForThisRun) {
      const catalogEntries = getRepairCatalogEntries()
        .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || String(a.label || a.url).localeCompare(String(b.label || b.url)));
      for (const entry of catalogEntries) {
        if (audit.successes.length >= targetForThisRun) break;
        try {
          const probed = await probeCatalogBootstrapCandidate(entry, activeUrls, usedUrls, args);
          if (!probed) continue;
          if (probed.skipped) {
            audit.skipped.push({
              ...probed.skipped,
              sourceTable: 'catalog_bootstrap',
            });
            continue;
          }
          const proposal = {
            sourceTable: 'catalog_bootstrap',
            approvalId: null,
            proposalId: null,
            status: 'bootstrap',
            actionType: 'add-rss',
            url: `https://lattice.local/source-repair-bootstrap/${encodeURIComponent(entry.label || entry.category || 'source')}`,
            name: entry.label || 'Catalog bootstrap source',
            theme: entry.category || 'general',
            reason: `catalog bootstrap: ${entry.reason || 'prevalidated source catalog'}`,
            createdAt: new Date().toISOString(),
            reviewedAt: null,
          };
          const applied = await applySelectedRepair({
            client,
            proposal,
            selected: probed.selected,
            originalProbe: null,
            originalProbeError: null,
            options: args,
            activeUrls,
            usedUrls,
            insertedThemes,
          });
          activeUrls = applied.activeUrls;
          if (applied.ok) audit.successes.push(applied.success);
          else audit.failures.push(applied.failure);
        } catch (error) {
          audit.failures.push({
            sourceTable: 'catalog_bootstrap',
            url: entry.url,
            theme: entry.category,
            error: String(error?.message || error),
          });
        }
      }
    }

    if (args.apply && args.refreshDiscovery && audit.successes.length > 0 && insertedThemes.size > 0) {
      audit.discoveryRefresh = await refreshDiscoveryFromRecentThemes({
        days: 30,
        limit: 80,
        minCount: 2,
        themes: [...insertedThemes],
        dryRun: false,
      });
    }
    audit.pipelineSuccesses = audit.successes.filter(isEndToEndSourceSuccess).length;
    audit.registrationSuccesses = audit.successes.length;
    const countedSuccesses = (audit.dryRun ? audit.registrationSuccesses : audit.pipelineSuccesses)
      + (args.countHistoricalSuccesses ? historicalSuccessCount : 0);
    audit.countedSuccesses = countedSuccesses;
    audit.ok = countedSuccesses >= args.targetSuccesses;
  } finally {
    audit.finishedAt = new Date().toISOString();
    await client.end().catch(() => {});
    await fs.mkdir(args.auditDir, { recursive: true });
    const suffix = audit.finishedAt.replace(/[:.]/g, '-');
    audit.auditPath = path.join(args.auditDir, `source-repair-closed-loop-${suffix}.json`);
    await fs.writeFile(audit.auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  }

  return audit;
}

async function main() {
  const result = await runSourceRepairClosedLoop(parseArgs());
  process.stdout.write(`${JSON.stringify({
    ok: result.ok,
    dryRun: result.dryRun,
    successes: result.successes.length,
    pipelineSuccesses: result.pipelineSuccesses ?? 0,
    countedSuccesses: result.countedSuccesses ?? result.pipelineSuccesses ?? 0,
    targetForThisRun: result.targetForThisRun ?? result.targetSuccesses,
    skipped: result.skipped.length,
    failures: result.failures.length,
    auditPath: result.auditPath,
    feeds: result.successes.map((success) => ({
      feedName: success.feedName,
      repairedUrl: success.repairedUrl,
      qualityScore: success.qualityScore,
      backfill: success.backfill,
    })),
  }, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
