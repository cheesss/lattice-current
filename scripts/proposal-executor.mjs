#!/usr/bin/env node

import pg from 'pg';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync } from 'node:fs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureAutomationSchema } from './_shared/schema-automation.mjs';
import { ensureCodexProposalSchema } from './_shared/schema-proposals.mjs';
import { checkBudget, checkKillSwitch, consumeBudget } from './_shared/automation-budget.mjs';
import { executeOrSimulate, isDryRun } from './_shared/dry-run.mjs';
import { logAutomationAction } from './_shared/automation-audit.mjs';
import { queueForApproval, requiresApproval } from './_shared/approval-queue.mjs';
import { ALLOWED_BACKFILL_SOURCES, validateBackfillArgs } from './_shared/backfill-whitelist.mjs';
import { isTrustedFeedUrl } from './_shared/feed-trust.mjs';
import { createOpenClawEvent, emitOpenClawEvent } from './_shared/openclaw-webhook-emitter.mjs';
import { attemptSourceRepair, isSameHostname } from './_shared/source-repair.mjs';
import { queueCodexSourceCodeRepair } from './_shared/codex-source-code-repair.mjs';
import {
  isLowValueGoogleNewsSource,
  lowValueGoogleNewsReason,
} from './_shared/google-news-source-policy.mjs';
import {
  classifyArticleAgainstTaxonomy,
  getCanonicalParentTheme,
  mapThemeToTaxonomy,
  resolveThemeTaxonomy,
} from './_shared/theme-taxonomy.mjs';

loadOptionalEnvFile();

const { Client } = pg;
const DRY_RUN = process.argv.includes('--dry-run') || isDryRun();
const FILE_ARG = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : null;
const FAILED_QUEUE_PATH = path.resolve('data', 'failed-proposals.json');
const DEAD_QUEUE_PATH = path.resolve('data', 'dead-proposals.json');
const RESULTS_PATH = path.resolve('data', 'executor-results.json');
const BACKFILL_LOG_DIR = path.resolve('data', 'backfill-logs');
const MAX_RETRIES = Math.max(1, Number(process.env.PROPOSAL_EXECUTOR_MAX_RETRIES || 2));
const SPECIALIST_SOURCE_THEME_FALLBACKS = new Set([
  'aerospace',
  'ai-ml',
  'biotech',
  'clean-energy',
  'cloud-infrastructure',
  'cybersecurity',
  'defense-industrial',
  'robotics-automation',
  'semiconductor',
  'space',
  'supply-chain-security',
]);

const SPECIALIST_SOURCE_NAME_PATTERNS = new Map([
  ['aerospace', /\b(aerospace|flightglobal|aviation|airspace)\b/i],
  ['ai-ml', /\b(ai|machine learning|techcrunch|the verge)\b/i],
  ['biotech', /\b(biopharma|biotech|medcity)\b/i],
  ['clean-energy', /\b(clean energy|pv magazine|utility dive|canary|energy storage|climate)\b/i],
  ['cloud-infrastructure', /\b(data center|datacenter|cloud|siliconangle|dcd)\b/i],
  ['cybersecurity', /\b(securityweek|bleepingcomputer|infosecurity|dark reading|the record|cso)\b/i],
  ['defense-industrial', /\b(defense|war zone|war on the rocks|military)\b/i],
  ['robotics-automation', /\b(robot|robotics|automation)\b/i],
  ['semiconductor', /\b(semiconductor|chip|foundry)\b/i],
  ['space', /\b(space|payload|satellite|rocket)\b/i],
  ['supply-chain-security', /\b(offshore energy|splash247|joc|shipping|maritime|freight|logistics|supply chain)\b/i],
]);

export const FINAL_PROPOSAL_STATUSES = new Set(['executed', 'rejected', 'skipped', 'dead']);

function getPgConfig() {
  return resolveNasPgConfig();
}

function loadJsonArray(filePath) {
  try {
    if (!existsSync(filePath)) return [];
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveJsonArray(filePath, items) {
  writeFileSync(filePath, JSON.stringify(items, null, 2));
}

export function proposalKey(proposal) {
  const type = proposal.type || proposal.proposal_type || 'unknown';
  const payload = proposal.payload && typeof proposal.payload === 'object' ? proposal.payload : proposal;
  const typeSpecificKey = [
    payload.attachmentKey,
    payload.targetTheme,
    payload.id,
    payload.theme,
    payload.symbol,
    payload.url,
    payload.name,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('|');
  return [
    type,
    proposal._dbId || typeSpecificKey || 'anonymous',
  ].join('::');
}

export function resolveAddRssApprovalGate({
  url,
  originalUrl,
  proposal = {},
  repaired = false,
} = {}) {
  const normalizedUrl = String(url || '').trim();
  const normalizedOriginalUrl = String(originalUrl || normalizedUrl).trim();
  const crossDomainRepairRequiresApproval = Boolean(repaired)
    && !isSameHostname(normalizedOriginalUrl, normalizedUrl)
    && process.env.SOURCE_REPAIR_ALLOW_CROSS_DOMAIN_AUTO_APPLY !== 'true';
  const trustedOrApproved = isTrustedFeedUrl(normalizedUrl)
    || proposal.human_approved === true
    || proposal.humanApproved === true;
  const requiresApproval = (!trustedOrApproved) || crossDomainRepairRequiresApproval;
  return {
    requiresApproval,
    crossDomainRepairRequiresApproval,
    reason: crossDomainRepairRequiresApproval
      ? `auto-repaired source changed domain and requires approval: ${normalizedOriginalUrl} -> ${normalizedUrl}`
      : `untrusted RSS domain requires approval after probe: ${normalizedUrl}`,
  };
}

function mergeUniqueProposals(...groups) {
  const merged = new Map();
  for (const proposals of groups) {
    for (const proposal of proposals || []) {
      merged.set(proposalKey(proposal), proposal);
    }
  }
  return Array.from(merged.values());
}

function loadRetryQueue() {
  return loadJsonArray(FAILED_QUEUE_PATH);
}

function saveRetryQueue(queue) {
  saveJsonArray(FAILED_QUEUE_PATH, queue);
}

function moveToDeadQueue(entry) {
  const deadQueue = loadJsonArray(DEAD_QUEUE_PATH);
  deadQueue.push({
    ...entry,
    deadAt: new Date().toISOString(),
  });
  saveJsonArray(DEAD_QUEUE_PATH, deadQueue);
}

function clearFailedProposal(proposal) {
  saveRetryQueue(loadRetryQueue().filter((entry) => proposalKey(entry) !== proposalKey(proposal)));
}

function onProposalFailed(proposal, error) {
  const queue = loadRetryQueue();
  const key = proposalKey(proposal);
  const existing = queue.find((entry) => proposalKey(entry) === key);
  if (existing) {
    existing.retryCount = Number(existing.retryCount || 0) + 1;
    existing.lastError = error;
    existing.failedAt = new Date().toISOString();
    if (existing.retryCount >= MAX_RETRIES) {
      moveToDeadQueue(existing);
      saveRetryQueue(queue.filter((entry) => proposalKey(entry) !== key));
      return { movedToDeadQueue: true, retryCount: existing.retryCount };
    }
    saveRetryQueue(queue);
    return { movedToDeadQueue: false, retryCount: existing.retryCount };
  }

  queue.push({
    ...proposal,
    retryCount: 1,
    lastError: error,
    failedAt: new Date().toISOString(),
  });
  saveRetryQueue(queue);
  return { movedToDeadQueue: false, retryCount: 1 };
}

async function ensureProposalTable(client) {
  await ensureCodexProposalSchema(client);
}

export async function ensureExecutorSchema(client) {
  await ensureProposalTable(client);
  await ensureAutomationSchema(client);
}

async function loadProposals(client) {
  let proposals = [];
  if (FILE_ARG) {
    const raw = JSON.parse(readFileSync(FILE_ARG, 'utf-8'));
    proposals = extractProposalsFromCodexOutput(raw);
    console.log(`Loaded ${proposals.length} proposals from ${FILE_ARG}`);
  } else {
    const pending = await client.query(
      "SELECT id, proposal_type, payload FROM codex_proposals WHERE status = 'pending' ORDER BY created_at",
    );
    proposals = pending.rows.map((row) => ({ ...row.payload, _dbId: row.id, type: row.proposal_type }));
    console.log(`Found ${proposals.length} pending proposals in DB`);
  }

  proposals = mergeUniqueProposals(loadRetryQueue(), proposals);
  if (proposals.length === 0 && existsSync('data/codex-discoveries.json')) {
    const discoveries = JSON.parse(readFileSync('data/codex-discoveries.json', 'utf-8'));
    proposals = extractProposalsFromDiscoveries(discoveries);
    console.log(`Extracted ${proposals.length} proposals from codex-discoveries.json`);
  }
  return proposals;
}

async function ensureDbIds(client, proposals) {
  for (const proposal of proposals) {
    if (proposal._dbId) continue;
    const result = await client.query(
      'INSERT INTO codex_proposals (proposal_type, payload) VALUES ($1, $2) RETURNING id',
      [proposal.type, JSON.stringify(proposal)],
    );
    proposal._dbId = result.rows[0].id;
  }
}

async function main() {
  const client = new Client(getPgConfig());
  await client.connect();

  console.log('Proposal Executor');
  await ensureExecutorSchema(client);

  const proposals = await loadProposals(client);
  if (proposals.length === 0) {
    console.log('No proposals to execute.');
    await client.end();
    return;
  }

  await ensureDbIds(client, proposals);

  const results = [];
  for (const proposal of proposals) {
    console.log(`\n[${proposal.type}] ${proposal.symbol || proposal.name || proposal.id || '?'}`);

    try {
      const result = await executeProposal(client, proposal, { dryRun: DRY_RUN });
      const status = DRY_RUN
        ? 'dry-run'
        : result?.pendingApproval
          ? 'queued'
          : result?.skipped
            ? 'skipped'
            : 'success';
      results.push({ type: proposal.type, status, ...result });
      clearFailedProposal(proposal);
      await logAutomationAction(client, {
        type: proposal.type,
        params: {
          proposalId: proposal._dbId || null,
          ...proposal,
          ...(('pid' in (result || {})) ? { pid: result.pid } : {}),
        },
        result: status,
        reason: result?.reason || result?.summary || '',
      });
      const dbStatus = deriveProposalExecutionStatus(result, { dryRun: DRY_RUN });
      await updateProposalExecutionState(client, proposal._dbId, dbStatus, result);
      console.log(`  OK ${result.summary || result.reason || 'Done'}`);
    } catch (error) {
      const message = String(error?.message || error || 'proposal execution failed');
      const failure = onProposalFailed(proposal, message);
      results.push({ type: proposal.type, status: 'error', error: message, ...failure });
      await logAutomationAction(client, {
        type: proposal.type,
        params: {
          proposalId: proposal._dbId || null,
          ...proposal,
        },
        result: 'failed',
        reason: message,
      });
      await updateProposalExecutionState(
        client,
        proposal._dbId,
        failure.movedToDeadQueue ? 'dead' : 'failed',
        { error: message, ...failure },
      );
      console.log(`  FAIL ${message} (retry ${failure.retryCount}/${MAX_RETRIES})`);
    }
  }

  const success = results.filter((row) => row.status === 'success').length;
  const failed = results.filter((row) => row.status === 'error').length;
  console.log(`\nExecution Summary: total=${results.length} success=${success} failed=${failed}`);
  writeFileSync(RESULTS_PATH, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  // Trigger incremental event engine if any proposals were successfully executed
  if (success > 0 && !DRY_RUN) {
    console.log('\nTriggering incremental event engine...');
    try {
      const { execSync } = await import('child_process');
      const py = process.env.LATTICE_PYTHON || (process.env.USERPROFILE ? `${process.env.USERPROFILE}/miniconda3/python.exe` : 'python');
      try {
        execSync(`${py} scripts/incremental_event_engine.py`, { stdio: 'inherit', timeout: 300000 });
      } catch {
        execSync('node scripts/incremental-event-engine-fast.mjs', { stdio: 'inherit', timeout: 300000 });
      }
    } catch (err) {
      console.warn(`Event engine trigger failed (non-fatal): ${err?.message || err}`);
    }
  }

  await client.end();
}

export function deriveProposalExecutionStatus(result, { dryRun = false } = {}) {
  if (dryRun) return 'dry-run';
  if (result?.pendingApproval) return 'pending-approval';
  if (result?.skipped) return 'skipped';
  return 'executed';
}

export async function updateProposalExecutionState(client, proposalId, status, result) {
  if (!proposalId) return;
  await client.query(
    'UPDATE codex_proposals SET status = $1, result = $2, executed_at = NOW() WHERE id = $3',
    [status, JSON.stringify(result ?? null), proposalId],
  );
}

export async function loadProposalById(client, proposalId) {
  const normalizedId = Number(proposalId);
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) return null;
  const { rows } = await client.query(
    `
      SELECT id, proposal_type, payload, status, result, reasoning, source, created_at, executed_at
      FROM codex_proposals
      WHERE id = $1
      LIMIT 1
    `,
    [normalizedId],
  );
  return rows[0] || null;
}

export async function reviewCodexProposalById(client, proposalId, decision, options = {}) {
  await ensureExecutorSchema(client);
  const row = await loadProposalById(client, proposalId);
  if (!row) {
    throw new Error(`Proposal ${proposalId} not found`);
  }

  const normalizedDecision = String(decision || '').trim().toLowerCase();
  const reviewer = String(options.reviewer || 'dashboard-ui').slice(0, 120);
  if (!['accept', 'reject'].includes(normalizedDecision)) {
    throw new Error(`Unsupported proposal decision: ${decision}`);
  }

  const currentStatus = String(row.status || '').trim().toLowerCase();
  if (FINAL_PROPOSAL_STATUSES.has(currentStatus)) {
    return {
      proposal: row,
      status: currentStatus,
      result: row.result || null,
      alreadyFinal: true,
    };
  }

  if (normalizedDecision === 'reject') {
    const result = {
      decision: 'reject',
      reviewer,
      reviewedAt: new Date().toISOString(),
      reason: String(options.reason || 'Rejected in proposal inbox'),
      skipped: true,
    };
    await updateProposalExecutionState(client, row.id, 'rejected', result);
    return {
      proposal: row,
      status: 'rejected',
      result,
      alreadyFinal: false,
    };
  }

  const proposal = {
    ...(row.payload && typeof row.payload === 'object' ? row.payload : {}),
    _dbId: row.id,
    type: row.proposal_type,
    human_approved: true,
  };

  try {
    const result = await executeProposal(client, proposal, {
      dryRun: Boolean(options.dryRun),
      humanApproved: true,
    });
    const dbStatus = deriveProposalExecutionStatus(result, {
      dryRun: Boolean(options.dryRun),
    });
    await updateProposalExecutionState(client, row.id, dbStatus, {
      reviewer,
      reviewedAt: new Date().toISOString(),
      ...result,
    });
    return {
      proposal: row,
      status: dbStatus,
      result,
      alreadyFinal: false,
    };
  } catch (error) {
    const message = String(error?.message || error || 'proposal execution failed');
    const failure = onProposalFailed(proposal, message);
    await updateProposalExecutionState(
      client,
      row.id,
      failure.movedToDeadQueue ? 'dead' : 'failed',
      {
        reviewer,
        reviewedAt: new Date().toISOString(),
        error: message,
        ...failure,
      },
    );
    throw error;
  }
}

async function handleAddRssDryRun(proposal, options) {
  const { url, name } = proposal;
  const theme = resolveAddRssTheme(proposal);
  if (!url) return { dryRun: true, skipped: true, reason: 'missing URL', summary: 'dry-run add-rss: missing URL' };
  const feedNameForPolicy = sanitizeFeedDisplayName(name, url);
  if (isLowValueGoogleNewsSource({
    url,
    feedName: feedNameForPolicy,
    category: theme,
    theme: proposal.theme,
    topics: [proposal.theme, proposal.normalizedTheme, proposal.parentTheme].filter(Boolean),
  })) {
    const reason = lowValueGoogleNewsReason({ url });
    return {
      dryRun: true,
      skipped: true,
      reason,
      summary: `DRY RUN: would reject ${feedNameForPolicy || url} (${reason})`,
      url,
      feedName: feedNameForPolicy,
      nextAction: 'reject',
    };
  }

  try {
    const { probeSource } = await import('./_shared/source-probe.mjs');
    const probe = await probeSource(url, { theme });

    const wouldRegister = probe.nextAction === 'register' || probe.nextAction === 'review';
    const repair = wouldRegister ? null : await attemptSourceRepair({
      inputUrl: url,
      theme,
      name,
      reason: proposal.reason || '',
      probe,
      minQualityScore: options.minQualityScore ?? 0.65,
      maxCandidates: Number(process.env.SOURCE_REPAIR_MAX_CANDIDATES || 48),
      enableLlm: options.enableSourceRepairLlm === true
        || process.env.SOURCE_REPAIR_DRY_RUN_LLM_ENABLED === 'true',
    });
    const repairedWouldRegister = Boolean(repair?.best);
    const activeProbe = repair?.best?.probe || probe;
    const activeUrl = repair?.best
      ? (repair.best.resolvedUrl || repair.best.url)
      : (activeProbe.resolvedUrl || url);
    const feedName = sanitizeFeedDisplayName(name, activeUrl);
    const approvalGate = (wouldRegister || repairedWouldRegister)
      ? resolveAddRssApprovalGate({
        url: activeUrl,
        originalUrl: url,
        proposal,
        repaired: repairedWouldRegister,
      })
      : { requiresApproval: false, reason: null, crossDomainRepairRequiresApproval: false };
    const wouldSeedCount = activeProbe.sampleItems.length;

    return {
      dryRun: true,
      skipped: !(wouldRegister || repairedWouldRegister),
      pendingApproval: approvalGate.requiresApproval || undefined,
      reason: wouldRegister || repairedWouldRegister
        ? (approvalGate.requiresApproval ? approvalGate.reason : null)
        : `quality ${probe.qualityScore.toFixed(2)} below threshold or feed not found`,
      summary: approvalGate.requiresApproval
        ? `DRY RUN: would queue approval for ${feedName || activeProbe.domain || activeUrl}`
        : wouldRegister
        ? `DRY RUN: would register ${feedName || probe.domain} via ${probe.connectorKind}`
        : repairedWouldRegister
          ? `DRY RUN: would auto-repair ${feedName || probe.domain} via ${repair.best.connectorKind}`
          : `DRY RUN: would skip ${probe.nextAction}`,
      // probe results
      resolvedUrl: activeProbe.resolvedUrl,
      connectorKind: activeProbe.connectorKind,
      qualityScore: activeProbe.qualityScore,
      qualityBreakdown: activeProbe.qualityBreakdown,
      recentItemCount: activeProbe.qualityBreakdown.recentItemCount,
      sampleItems: activeProbe.sampleItems,
      wouldRegister: (wouldRegister || repairedWouldRegister) && !approvalGate.requiresApproval,
      wouldQueueApproval: approvalGate.requiresApproval || undefined,
      wouldSeedCount,
      warnings: activeProbe.warnings,
      errors: activeProbe.errors,
      nextAction: activeProbe.nextAction,
      probeStatus: activeProbe.status,
      probeTraceId: activeProbe.traceId,
      originalProbe: {
        resolvedUrl: probe.resolvedUrl,
        connectorKind: probe.connectorKind,
        qualityScore: probe.qualityScore,
        recentItemCount: probe.qualityBreakdown.recentItemCount,
        nextAction: probe.nextAction,
        probeTraceId: probe.traceId,
      },
      repair: repair ? summarizeSourceRepair(repair) : null,
      repaired: repairedWouldRegister,
      repairedUrl: repair?.best?.resolvedUrl || repair?.best?.url || null,
      crossDomainRepairRequiresApproval: approvalGate.crossDomainRepairRequiresApproval || undefined,
      // legacy fields for UI compat
      url,
      feedName,
      quality: { score: activeProbe.qualityScore, ...activeProbe.qualityBreakdown },
    };
  } catch (err) {
    return {
      dryRun: true,
      skipped: true,
      reason: String(err?.message || err),
      summary: `dry-run add-rss: probe failed`,
      url,
    };
  }
}

function summarizeSourceRepair(repair) {
  if (!repair) return null;
  return {
    attempted: Boolean(repair.attempted),
    repaired: Boolean(repair.repaired),
    reason: repair.reason || null,
    llmSkippedReason: repair.llmSkippedReason || null,
    best: repair.best ? {
      url: repair.best.url,
      resolvedUrl: repair.best.resolvedUrl,
      connectorKind: repair.best.connectorKind,
      qualityScore: repair.best.qualityScore,
      recentItemCount: repair.best.recentItemCount,
      reason: repair.best.reason || null,
      source: repair.best.source || null,
    } : null,
    attempts: (repair.attempts || []).slice(0, 8).map((attempt) => ({
      url: attempt.url,
      resolvedUrl: attempt.resolvedUrl,
      connectorKind: attempt.connectorKind,
      qualityScore: attempt.qualityScore,
      recentItemCount: attempt.recentItemCount,
      nextAction: attempt.nextAction,
      accepted: Boolean(attempt.accepted),
      source: attempt.source || null,
    })),
  };
}

function resolveAddRssTheme(proposal = {}) {
  const candidates = [
    proposal.normalizedTheme,
    proposal.parentTheme,
    proposal.theme,
  ];
  for (const candidate of candidates) {
    const mapped = mapThemeToTaxonomy(candidate);
    if (mapped && mapped !== 'unknown') return mapped;
  }
  return String(proposal.theme || 'politics').trim() || 'politics';
}

function stripXmlCdata(value) {
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function stripHtmlTags(value) {
  return stripXmlCdata(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractXmlTag(block, tag) {
  const match = String(block || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? stripXmlCdata(match[1]) : '';
}

function extractXmlBlocks(xml, tag) {
  const blocks = [];
  const blockRe = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  let match;
  while ((match = blockRe.exec(String(xml || ''))) !== null) {
    blocks.push(match[1] || '');
  }
  return blocks;
}

function resolveMaybeRelativeUrl(value, baseUrl) {
  const raw = stripXmlCdata(value);
  if (!raw) return '';
  try {
    return new URL(raw, baseUrl).href;
  } catch {
    return raw;
  }
}

function titleFromUrl(value) {
  try {
    const parsed = new URL(value);
    const segment = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname;
    return decodeURIComponent(segment).replace(/[-_]+/g, ' ').trim() || parsed.hostname;
  } catch {
    return String(value || '').slice(0, 120);
  }
}

function publisherNameFromUrl(value) {
  try {
    const hostname = new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '');
    const base = hostname.split('.')[0] || hostname;
    const known = {
      'bleepingcomputer': 'BleepingComputer',
      'csoonline': 'CSO Online',
      'darkreading': 'Dark Reading',
      'defensenews': 'Defense News',
      'iata': 'IATA',
      'icao': 'ICAO',
      'infosecurity-magazine': 'Infosecurity Magazine',
      'securityweek': 'SecurityWeek',
      'spacenews': 'SpaceNews',
      'theregister': 'The Register',
    };
    if (known[base]) return known[base];
    return base
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || hostname;
  } catch {
    return '';
  }
}

export function sanitizeFeedDisplayName(name, url = '') {
  const original = String(name || '').trim();
  let clean = original
    .replace(/^Codex\s+(?:E2E|Retest)\s+/i, '')
    .replace(/\s+source\s+\d{8}$/i, '')
    .replace(/\s+source$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const wordCount = clean ? clean.split(/\s+/).length : 0;
  const generatedTopicName = /\bsource(?:\s+\d{8})?$/i.test(original) && wordCount > 4;
  if (!clean || /^(?:rss|feed|source)$/i.test(clean) || generatedTopicName) {
    clean = publisherNameFromUrl(url);
  }
  return clean || 'RSS';
}

export function classifySeedItemTheme(item, sourceName, sourceTheme, probe) {
  const classified = classifyArticleAgainstTaxonomy({
    title: item?.title || '',
  });
  if (classified.theme && classified.theme !== 'unknown') return classified.theme;

  const canonicalSourceTheme = mapThemeToTaxonomy(sourceTheme);
  if (canonicalSourceTheme !== 'unknown') {
    const themeRelevance = Number(probe?.qualityBreakdown?.themeRelevance ?? 0);
    if (themeRelevance >= 0.65) return canonicalSourceTheme;
    const specialistSourceName = SPECIALIST_SOURCE_NAME_PATTERNS.get(canonicalSourceTheme)?.test(String(sourceName || ''));
    if (
      SPECIALIST_SOURCE_THEME_FALLBACKS.has(canonicalSourceTheme)
      && (themeRelevance >= 0.5 || specialistSourceName)
    ) {
      return canonicalSourceTheme;
    }
    const sourceMeta = resolveThemeTaxonomy(canonicalSourceTheme);
    if (sourceMeta.parentTheme === 'geopolitics' || canonicalSourceTheme === 'geopolitics') {
      return 'unknown';
    }
    return getCanonicalParentTheme(canonicalSourceTheme) || canonicalSourceTheme;
  }

  return sourceTheme || 'tech';
}

function normalizeSeedItem(item, baseUrl) {
  const url = resolveMaybeRelativeUrl(item?.url || item?.link || '', baseUrl);
  const title = stripHtmlTags(item?.title || '') || titleFromUrl(url);
  const rawDate = item?.date || item?.publishedAt || item?.updatedAt || item?.lastmod;
  const parsedDate = rawDate && !Number.isNaN(Date.parse(rawDate))
    ? new Date(rawDate).toISOString()
    : new Date().toISOString();
  if (!title || !url) return null;
  return {
    title: title.slice(0, 500),
    url,
    date: parsedDate,
  };
}

export function parseResolvedSourceItems(sourceText, baseUrl = '') {
  const text = String(sourceText || '');
  const items = [];

  for (const block of extractXmlBlocks(text, 'item')) {
    items.push({
      title: extractXmlTag(block, 'title'),
      url: extractXmlTag(block, 'link') || extractXmlTag(block, 'guid'),
      publishedAt: extractXmlTag(block, 'pubDate') || extractXmlTag(block, 'dc:date'),
    });
  }

  for (const block of extractXmlBlocks(text, 'entry')) {
    const linkHref = String(block || '').match(/<link[^>]+href=["']([^"']+)["']/i)?.[1];
    items.push({
      title: extractXmlTag(block, 'title'),
      url: linkHref || extractXmlTag(block, 'link') || extractXmlTag(block, 'id'),
      publishedAt: extractXmlTag(block, 'published') || extractXmlTag(block, 'updated'),
    });
  }

  for (const block of extractXmlBlocks(text, 'url')) {
    const loc = extractXmlTag(block, 'loc');
    if (!loc) continue;
    items.push({
      title: extractXmlTag(block, 'news:title') || titleFromUrl(loc),
      url: loc,
      publishedAt: extractXmlTag(block, 'news:publication_date') || extractXmlTag(block, 'lastmod'),
    });
  }

  if (items.length === 0 && /<html[\s>]/i.test(text)) {
    const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorRe.exec(text)) !== null && items.length < 100) {
      const title = stripHtmlTags(match[2]);
      const url = resolveMaybeRelativeUrl(match[1], baseUrl);
      if (title.length >= 10 && url) {
        items.push({ title, url, publishedAt: null });
      }
    }
  }

  const seen = new Set();
  return items
    .map((item) => normalizeSeedItem(item, baseUrl))
    .filter(Boolean)
    .filter((item) => {
      const key = item.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function fetchResolvedSourceItems(effectiveUrl, fallbackItems = []) {
  const fallback = (fallbackItems || [])
    .map((item) => normalizeSeedItem(item, effectiveUrl))
    .filter(Boolean);
  try {
    const response = await fetch(effectiveUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`source fetch ${response.status}`);
    const text = await response.text();
    const parsed = parseResolvedSourceItems(text, effectiveUrl);
    if (parsed.length > 0) {
      return { items: parsed, source: 'resolved-url' };
    }
    return { items: fallback, source: 'probe-sample-fallback', warning: 'resolved URL parsed zero items' };
  } catch (error) {
    return {
      items: fallback,
      source: 'probe-sample-fallback',
      warning: String(error?.message || error || 'resolved URL fetch failed'),
    };
  }
}

export async function executeProposal(client, proposal, options = {}) {
  if (options.dryRun && proposal.type !== 'backfill-source') {
    // add-rss는 dryRun이어도 실제 Source Probe 수행
    if (proposal.type === 'add-rss') {
      return handleAddRssDryRun(proposal, options);
    }
    return {
      dryRun: true,
      reason: `would execute ${proposal.type}`,
      summary: `dry-run ${proposal.type}`,
    };
  }
  switch (proposal.type) {
    case 'add-symbol': return handleAddSymbol(client, proposal, options);
    case 'add-rss': return handleAddRss(client, proposal, options);
    case 'add-theme': return handleAddTheme(client, proposal, options);
    case 'attach-theme': return handleAttachTheme(client, proposal, options);
    case 'validate': return handleValidate(client, proposal, options);
    case 'remove-symbol': return handleRemoveSymbol(client, proposal, options);
    case 'add-conditional-sensitivity': return handleAddConditionalSensitivity(client, proposal, options);
    case 'backfill-source': return handleBackfillSource(client, proposal, options);
    default: throw new Error(`Unknown proposal type: ${proposal.type}`);
  }
}

function estimateDurationMinutes(source, limit = 0) {
  const config = ALLOWED_BACKFILL_SOURCES[String(source || '').trim().toLowerCase()];
  const hours = Number(config?.estimatedDurationHours || 1);
  if (!Number.isFinite(limit) || limit <= 0) return Math.round(hours * 60);
  return Math.max(10, Math.round(hours * 60 * Math.min(1.5, Math.max(0.25, limit / 10000))));
}

function buildBackfillCommandArgs(source, args) {
  const normalizedSource = String(source || '').trim().toLowerCase();
  switch (normalizedSource) {
    case 'hackernews': {
      const cliArgs = ['--limit', String(args.limit || 10000)];
      if (args.since) cliArgs.push('--since', String(args.since));
      if (args.minScore != null) cliArgs.push('--score-min', String(args.minScore));
      return cliArgs;
    }
    case 'arxiv': {
      const batchSize = Math.min(200, Math.max(25, Math.floor(Math.min(Number(args.limit || 10000), 30000) / 5) || 100));
      const maxBatches = Math.max(1, Math.ceil(Number(args.limit || 10000) / batchSize));
      const cliArgs = ['--batch-size', String(batchSize), '--max-batches', String(maxBatches)];
      if (args.from) cliArgs.push('--since', String(args.from));
      if (Array.isArray(args.categories) && args.categories.length > 0) {
        cliArgs.push('--categories', args.categories.join(','));
      }
      return cliArgs;
    }
    case 'gdelt-articles': {
      const cliArgs = ['--limit', String(args.limit || 20000)];
      if (args.from) cliArgs.push('--from', String(args.from));
      if (Array.isArray(args.keywords) && args.keywords.length > 0) {
        cliArgs.push('--keywords', args.keywords.join(','));
      }
      return cliArgs;
    }
    case 'guardian-keyword': {
      const cliArgs = ['--query', String(args.query || ''), '--limit', String(args.limit || 1000)];
      if (args.from) cliArgs.push('--from', String(args.from));
      return cliArgs;
    }
    default:
      return [];
  }
}

async function handleBackfillSource(client, proposal, options = {}) {
  const payload = proposal.payload && typeof proposal.payload === 'object'
    ? proposal.payload
    : proposal;
  const source = String(payload.source || '').trim().toLowerCase();
  const rawArgs = payload.args && typeof payload.args === 'object' ? payload.args : {};
  const reason = payload.reason ? String(payload.reason) : '';
  const validation = validateBackfillArgs(source, rawArgs);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const normalizedArgs = validation.value;
  const config = validation.config;
  const limit = Number(normalizedArgs.limit || config.args?.limit?.default || 0);

  checkKillSwitch();

  const lastRun = await client.query(
    `
      SELECT MAX(executed_at) AS last
      FROM automation_actions
      WHERE action_type = 'backfill-source'
        AND metadata->>'source' = $1
        AND result = 'success'
    `,
    [source],
  );
  const lastRunAt = lastRun.rows[0]?.last ? new Date(lastRun.rows[0].last).getTime() : 0;
  if (lastRunAt > 0) {
    const hoursSince = (Date.now() - lastRunAt) / 3600000;
    if (hoursSince < Number(config.minIntervalHours || 0)) {
      return {
        skipped: true,
        reason: `min interval ${config.minIntervalHours}h not met (${hoursSince.toFixed(1)}h since last run)`,
        source,
        args: normalizedArgs,
      };
    }
  }

  const backfillBudget = await checkBudget(client, 'backfillCalls', 1);
  if (!backfillBudget.allowed) {
    return { skipped: true, reason: backfillBudget.reason, source, args: normalizedArgs };
  }
  const itemsBudget = await checkBudget(client, 'backfillItems', limit);
  if (!itemsBudget.allowed) {
    return { skipped: true, reason: itemsBudget.reason, source, args: normalizedArgs };
  }

  const needsApproval = Boolean(config.requiresApproval)
    || requiresApproval('backfill-source', { source, args: normalizedArgs, limit });
  if (needsApproval && !payload.human_approved && !proposal.human_approved) {
    const queued = await queueForApproval(client, {
      type: 'backfill-source',
      params: { source, args: normalizedArgs, reason },
      reason: reason || `manual approval required for ${source} backfill`,
    });
    return {
      pendingApproval: true,
      reason: 'awaiting human approval',
      approvalId: queued.id,
      source,
      args: normalizedArgs,
    };
  }

  return executeOrSimulate('backfill-source', {
    source,
    args: normalizedArgs,
    script: config.script,
    estimatedDurationMinutes: estimateDurationMinutes(source, limit),
  }, async () => {
    mkdirSync(BACKFILL_LOG_DIR, { recursive: true });
    const stamp = Date.now();
    const logFile = path.join(BACKFILL_LOG_DIR, `${source}-${stamp}.log`);
    const errFile = path.join(BACKFILL_LOG_DIR, `${source}-${stamp}.err`);
    const child = spawn(
      'node',
      ['--import', 'tsx', config.script, ...buildBackfillCommandArgs(source, normalizedArgs)],
      {
        detached: true,
        stdio: ['ignore', openSync(logFile, 'w'), openSync(errFile, 'w')],
        windowsHide: true,
      },
    );
    child.unref();

    await consumeBudget(client, 'backfillCalls', 1, { source, pid: child.pid, logFile });
    await consumeBudget(client, 'backfillItems', limit, { source, reason });

    return {
      ok: true,
      source,
      pid: child.pid,
      logFile,
      errFile,
      expectedItems: limit,
      estimatedDurationMinutes: estimateDurationMinutes(source, limit),
      summary: `backfill ${source} launched (pid ${child.pid})`,
    };
  });
}

async function handleAddSymbol(client, proposal) {
  const { symbol, theme, direction } = proposal;
  if (!symbol || !theme) throw new Error('Missing symbol or theme');

  const existing = await client.query(
    "SELECT COUNT(*) n FROM worldmonitor_intel.historical_raw_items WHERE provider='yahoo-chart' AND symbol=$1",
    [symbol],
  );
  let priceCount = Number(existing.rows[0].n);

  if (priceCount === 0) {
    console.log(`  Fetching ${symbol} from Yahoo Finance...`);
    try {
      const endDate = Math.floor(Date.now() / 1000);
      const startDate = endDate - 5 * 365 * 24 * 60 * 60;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${startDate}&period2=${endDate}&interval=1d`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Yahoo ${response.status}`);
      const data = await response.json();
      const result = data.chart?.result?.[0];
      if (!result?.timestamp) throw new Error('No price data from Yahoo');

      const timestamps = result.timestamp;
      const closes = result.indicators?.quote?.[0]?.close || [];
      for (let index = 0; index < timestamps.length; index += 1) {
        const price = closes[index];
        if (price == null) continue;
        const ts = new Date(timestamps[index] * 1000).toISOString();
        const itemId = `yahoo-auto::yahoo-chart::${symbol}:${timestamps[index]}::${ts}::${index}`;
        await client.query(`
          INSERT INTO worldmonitor_intel.historical_raw_items
            (id, dataset_id, provider, source_kind, source_id, item_kind, valid_time_start, transaction_time, knowledge_boundary, symbol, price)
          VALUES ($1, 'yahoo-auto', 'yahoo-chart', 'market', $3, 'market', $2, $2, $2, $3, $4)
          ON CONFLICT DO NOTHING
        `, [itemId, ts, symbol, price]);
      }
      priceCount = timestamps.length;
    } catch (error) {
      throw new Error(`Yahoo fetch failed for ${symbol}: ${error.message}`);
    }
  }

  await client.query(`
    INSERT INTO auto_theme_symbols (theme, symbol, avg_abs_reaction, reaction_count, correlation, method)
    VALUES ($1, $2, 0, 0, 1.0, 'codex-proposal')
    ON CONFLICT (theme, symbol) DO NOTHING
  `, [theme, symbol]);

  const articles = await client.query(`
    SELECT a.id, a.published_at
    FROM articles a
    JOIN auto_article_themes t ON t.article_id = a.id
    WHERE t.auto_theme = $1
    ORDER BY RANDOM()
    LIMIT 500
  `, [theme]);

  let outcomeCount = 0;
  for (const article of articles.rows) {
    for (const horizon of [{ name: '1w', days: 7 }, { name: '2w', days: 14 }, { name: '1m', days: 30 }]) {
      const prices = await client.query(`
        SELECT price
        FROM worldmonitor_intel.historical_raw_items
        WHERE provider='yahoo-chart' AND symbol=$1
          AND valid_time_start >= $2::timestamptz
          AND valid_time_start <= $2::timestamptz + INTERVAL '${horizon.days + 2} days'
        ORDER BY valid_time_start
        LIMIT 2
      `, [symbol, article.published_at]);
      if (prices.rows.length < 2) continue;
      const entry = Number(prices.rows[0].price);
      const exit = Number(prices.rows[1].price);
      if (entry <= 0) continue;
      const ret = ((exit - entry) / entry) * 100;

      await client.query(`
        INSERT INTO labeled_outcomes (article_id, theme, symbol, published_at, horizon, entry_price, exit_price, forward_return_pct, hit)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (article_id, symbol, horizon) DO NOTHING
      `, [article.id, theme, symbol, article.published_at, horizon.name, entry, exit, ret, ret > 0]);
      outcomeCount += 1;
    }
  }

  const sensitivity = await client.query(`
    SELECT AVG(forward_return_pct::numeric) AS avg_ret, AVG(hit::int::numeric) AS hit_rate, COUNT(*) AS n
    FROM labeled_outcomes
    WHERE theme=$1 AND symbol=$2 AND horizon='2w'
  `, [theme, symbol]);
  const hitRate = Number(sensitivity.rows[0]?.hit_rate || 0);
  const avgRet = Number(sensitivity.rows[0]?.avg_ret || 0);
  const sampleSize = Number(sensitivity.rows[0]?.n || 0);
  const validated = hitRate >= 0.45;
  if (!validated && sampleSize >= 20) {
    await client.query('DELETE FROM auto_theme_symbols WHERE theme=$1 AND symbol=$2', [theme, symbol]);
  }

  return {
    summary: `${symbol}/${theme}: ${priceCount} prices, ${outcomeCount} outcomes, hit=${(hitRate * 100).toFixed(0)}%, avg=${avgRet.toFixed(2)}%, validated=${validated}`,
    symbol,
    theme,
    direction,
    priceCount,
    outcomeCount,
    hitRate,
    avgRet,
    sampleSize,
    validated,
  };
}

async function handleAddRss(client, proposal, options = {}) {
  let { url, name } = proposal;
  const theme = resolveAddRssTheme(proposal);
  if (!url) throw new Error('Missing RSS url');
  name = sanitizeFeedDisplayName(name, url);
  if (isLowValueGoogleNewsSource({
    url,
    feedName: name,
    category: theme,
    theme: proposal.theme,
    topics: [proposal.theme, proposal.normalizedTheme, proposal.parentTheme].filter(Boolean),
  })) {
    return {
      skipped: true,
      reason: lowValueGoogleNewsReason({ url }),
      url,
      feedName: name,
      nextAction: 'reject',
    };
  }

  const { probeSource } = await import('./_shared/source-probe.mjs');
  let probe = await probeSource(url, { theme });
  const originalUrl = url;
  const originalProbe = probe;
  let effectiveUrl = probe.resolvedUrl || url;
  let repair = null;

  if (probe.nextAction === 'reject' || probe.nextAction === 'manual-adapter') {
    repair = await attemptSourceRepair({
      inputUrl: url,
      theme,
      name,
      reason: proposal.reason || '',
      probe,
      minQualityScore: options.minQualityScore ?? 0.65,
      maxCandidates: Number(process.env.SOURCE_REPAIR_MAX_CANDIDATES || 48),
      enableLlm: options.enableSourceRepairLlm === true
        || process.env.SOURCE_REPAIR_SYNC_LLM_ENABLED === 'true',
    });

    if (repair?.best) {
      url = repair.best.resolvedUrl || repair.best.url;
      probe = repair.best.probe;
      effectiveUrl = probe.resolvedUrl || url;
      name = sanitizeFeedDisplayName(name, effectiveUrl);
    } else {
      const codexCodeRepair = await queueCodexSourceCodeRepair({
        url,
        theme,
        name,
        reason: proposal.reason || '',
        probe,
        repair: repair ? summarizeSourceRepair(repair) : null,
      });
      const result = {
        skipped: true,
        reason: `probe ${probe.nextAction}: quality ${probe.qualityScore.toFixed(2)}`,
        url,
        resolvedUrl: effectiveUrl,
        connectorKind: probe.connectorKind,
        nextAction: probe.nextAction,
        qualityScore: probe.qualityScore,
        recentItemCount: probe.qualityBreakdown?.recentItemCount || 0,
        sampleItems: probe.sampleItems,
        warnings: probe.warnings,
        errors: probe.errors,
        probeTraceId: probe.traceId,
        codexCodeRepair,
        repair: summarizeSourceRepair(repair),
      };
      await emitOpenClawEvent(createOpenClawEvent({
        eventType: 'source-probe-failed',
        severity: probe.nextAction === 'manual-adapter' ? 'review' : 'warning',
        theme,
        entityType: 'source',
        entityId: url,
        surface: 'decision-inbox',
        summary: `Source probe rejected ${name || url}`,
        payload: {
          name,
          url,
          resolvedUrl: effectiveUrl,
          connectorKind: probe.connectorKind,
          nextAction: probe.nextAction,
          qualityScore: probe.qualityScore,
          recentItemCount: probe.qualityBreakdown?.recentItemCount || 0,
          probeTraceId: probe.traceId,
          repair: summarizeSourceRepair(repair),
          codexCodeRepair,
        },
      }));
      return result;
    }
  }
  name = sanitizeFeedDisplayName(name, effectiveUrl);
  const effectiveTheme = String(repair?.best?.category || theme || 'politics').trim().toLowerCase() || 'politics';
  const inheritedProposalTopics = effectiveTheme === theme ? [theme] : [];
  const effectiveTopics = Array.from(new Set([
    effectiveTheme,
    ...inheritedProposalTopics,
    ...(Array.isArray(repair?.best?.topics) ? repair.best.topics : []),
  ].filter(Boolean))).slice(0, 12);

  const approvalGate = resolveAddRssApprovalGate({
    url,
    originalUrl,
    proposal,
    repaired: Boolean(repair?.best),
  });

  if (approvalGate.requiresApproval) {
    const queued = await queueForApproval(client, {
      type: 'add-rss',
      params: {
        url,
        name,
        theme: effectiveTheme,
        reason: proposal.reason || '',
        inputUrl: probe.inputUrl,
        resolvedUrl: effectiveUrl,
        connectorKind: probe.connectorKind,
        nextAction: probe.nextAction,
        qualityScore: probe.qualityScore,
        recentItemCount: probe.qualityBreakdown?.recentItemCount || 0,
        sampleItems: probe.sampleItems.slice(0, 3),
        warnings: probe.warnings,
        probeTraceId: probe.traceId,
        repairOf: repair?.best ? originalUrl : null,
        repair: repair ? summarizeSourceRepair(repair) : null,
      },
      reason: `${approvalGate.reason} (quality=${probe.qualityScore.toFixed(2)})`,
    });
    const result = {
      pendingApproval: true,
      reason: 'awaiting human approval',
      approvalId: queued.id,
      url,
      resolvedUrl: effectiveUrl,
      connectorKind: probe.connectorKind,
      nextAction: probe.nextAction,
      qualityScore: probe.qualityScore,
      repaired: Boolean(repair?.best),
      repair: repair ? summarizeSourceRepair(repair) : null,
      theme: effectiveTheme,
      topics: effectiveTopics,
    };
    await emitOpenClawEvent(createOpenClawEvent({
      eventType: 'approval-created',
      severity: 'review',
      theme: effectiveTheme,
      entityType: 'approval',
      entityId: String(queued.id),
      surface: 'decision-inbox',
      summary: `Untrusted source queued for approval: ${name || url}`,
      payload: {
        approvalId: queued.id,
        proposalType: 'add-rss',
        url,
        resolvedUrl: effectiveUrl,
        connectorKind: probe.connectorKind,
        qualityScore: probe.qualityScore,
        nextAction: probe.nextAction,
        theme: effectiveTheme,
        topics: effectiveTopics,
        repaired: Boolean(repair?.best),
        repairOf: repair?.best ? originalUrl : null,
      },
    }));
    return result;
  }

  const { registerProbedSource } = await import('./_shared/discovered-source-registry.mjs');
  const registration = await registerProbedSource(client, probe, effectiveTheme, {
    feedName: name || 'rss',
    lang: 'en',
    topics: effectiveTopics,
    autoRegister: true,
    minScore: options.minQualityScore ?? 0.65,
    humanApproved: options.humanApproved === true || proposal.human_approved === true,
    budgetExempt: options.humanApproved === true || proposal.human_approved === true,
  });
  if (!registration.registered) {
    const result = {
      skipped: true,
      reason: registration.reason || 'feed quality below threshold',
      quality: registration.quality,
      url,
      resolvedUrl: effectiveUrl,
      connectorKind: probe.connectorKind,
      nextAction: probe.nextAction,
      qualityScore: probe.qualityScore,
      recentItemCount: probe.qualityBreakdown?.recentItemCount || 0,
      sampleItems: probe.sampleItems,
      warnings: probe.warnings,
      errors: probe.errors,
      probeTraceId: probe.traceId,
      repair: repair ? summarizeSourceRepair(repair) : null,
      theme: effectiveTheme,
      topics: effectiveTopics,
    };
    await emitOpenClawEvent(createOpenClawEvent({
      eventType: 'source-rejected',
      severity: 'review',
      theme: effectiveTheme,
      entityType: 'source',
      entityId: url,
      surface: 'decision-inbox',
      summary: `Source registration rejected ${name || url}`,
      payload: {
        name,
        url,
        resolvedUrl: effectiveUrl,
        reason: result.reason,
        quality: registration.quality,
        connectorKind: probe.connectorKind,
        probeTraceId: probe.traceId,
        repair: repair ? summarizeSourceRepair(repair) : null,
      },
    }));
    return result;
  }

  const seeded = await fetchResolvedSourceItems(effectiveUrl, probe.sampleItems);
  const items = seeded.items;

  let inserted = 0;
  for (const item of items.slice(0, 100)) {
    const articleTheme = classifySeedItemTheme(item, name, effectiveTheme || 'tech', probe);
    try {
      const insertResult = await client.query(`
        INSERT INTO articles (source, theme, published_at, title, url)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [name || 'rss', articleTheme, item.date, item.title, item.url]);
      inserted += Number(insertResult?.rowCount || 0);
      const articleId = Number(insertResult?.rows?.[0]?.id || 0);
      if (articleId > 0) {
        await client.query(`
          INSERT INTO auto_article_themes (article_id, auto_theme, confidence, method)
          VALUES ($1, $2, $3, 'rss-title-classifier')
          ON CONFLICT (article_id) DO UPDATE SET
            auto_theme = CASE
              WHEN auto_article_themes.auto_theme IS NULL OR auto_article_themes.auto_theme = 'unknown'
              THEN EXCLUDED.auto_theme
              ELSE auto_article_themes.auto_theme
            END,
            confidence = GREATEST(auto_article_themes.confidence, EXCLUDED.confidence),
            method = CASE
              WHEN auto_article_themes.auto_theme IS NULL OR auto_article_themes.auto_theme = 'unknown'
              THEN EXCLUDED.method
              ELSE auto_article_themes.method
            END,
            updated_at = NOW()
        `, [articleId, articleTheme, articleTheme === effectiveTheme ? 0.65 : 0.58]);
      }
    } catch {
      // ignore duplicates
    }
  }

  let downstreamBackfill = null;
  try {
    const { backfillActiveRssSources } = await import('./backfill-active-rss-sources.mjs');
    downstreamBackfill = await backfillActiveRssSources({
      onlyUrl: effectiveUrl,
      maxSources: 1,
      limit: Math.max(10, Math.min(100, items.length || 30)),
      concurrency: 1,
      noCursor: true,
      refreshDiscovery: false,
      dryRun: false,
    });
  } catch (error) {
    downstreamBackfill = {
      ok: false,
      error: String(error?.message || error || 'downstream backfill/link failed'),
    };
  }

  let discoveryRefresh = null;
  if (inserted > 0 && options.refreshDiscovery !== false) {
    try {
      const { refreshDiscoveryFromRecentThemes } = await import('./refresh-discovery-from-recent-themes.mjs');
      discoveryRefresh = await refreshDiscoveryFromRecentThemes({
        days: 30,
        limit: 80,
        minCount: 2,
        themes: [effectiveTheme || 'tech'],
        dryRun: false,
      });
    } catch (error) {
      discoveryRefresh = {
        ok: false,
        error: String(error?.message || error || 'discovery refresh failed'),
      };
    }
  }

  const result = {
    summary: `RSS ${name}: registered and seeded ${inserted} articles`,
    feedName: name,
    url,
    resolvedUrl: effectiveUrl,
    connectorKind: probe.connectorKind,
    probeTraceId: probe.traceId,
    articleCount: inserted,
    downstreamBackfill: downstreamBackfill
      ? {
        ok: downstreamBackfill.ok !== false,
        inserted: downstreamBackfill.inserted || 0,
        themed: downstreamBackfill.themed || 0,
        eventMapped: downstreamBackfill.eventMapped || 0,
        pendingOutcomes: downstreamBackfill.pendingOutcomes || 0,
        error: downstreamBackfill.error || null,
      }
      : null,
    seedSource: seeded.source,
    seedWarning: seeded.warning || null,
    quality: registration.quality,
    repaired: Boolean(repair?.best),
    repairOf: repair?.best ? originalUrl : null,
    originalProbeTraceId: repair?.best ? originalProbe.traceId : null,
    repair: repair ? summarizeSourceRepair(repair) : null,
    discoveryRefresh,
    theme: effectiveTheme,
    topics: effectiveTopics,
  };
  await emitOpenClawEvent(createOpenClawEvent({
    eventType: repair?.best ? 'source-repaired' : 'source-registered',
    severity: 'info',
    theme: effectiveTheme,
    entityType: 'source',
    entityId: url,
    surface: 'ops',
    summary: `Source registered ${name || url}`,
    payload: {
      name,
      url,
      resolvedUrl: effectiveUrl,
      connectorKind: probe.connectorKind,
      articleCount: inserted,
      seedSource: seeded.source,
      seedWarning: seeded.warning || null,
      quality: registration.quality,
      probeTraceId: probe.traceId,
      repaired: Boolean(repair?.best),
      repairOf: repair?.best ? originalUrl : null,
    },
  }));
  return result;
}

async function handleAddTheme(client, proposal) {
  const { id, triggers } = proposal;
  const symbols = Array.isArray(proposal?.symbols) ? proposal.symbols : [];
  const assets = Array.isArray(proposal?.assets) ? proposal.assets : [];
  if (!id || !triggers?.length) throw new Error('Missing theme id or triggers');

  const triggerCondition = triggers.map((_, index) => `title ILIKE $${index + 1}`).join(' OR ');
  const matched = await client.query(`SELECT id FROM articles WHERE ${triggerCondition}`, triggers.map((term) => `%${term}%`));

  if (matched.rows.length) {
    await client.query(`
      INSERT INTO auto_article_themes (article_id, auto_theme, confidence, method)
      SELECT * FROM UNNEST($1::bigint[], $2::text[], $3::double precision[], $4::text[])
        AS t(article_id, auto_theme, confidence, method)
      ON CONFLICT (article_id) DO UPDATE
      SET auto_theme = EXCLUDED.auto_theme
      WHERE auto_article_themes.confidence < 0.7
    `, [
      matched.rows.map((r) => r.id),
      matched.rows.map(() => id),
      matched.rows.map(() => 0.7),
      matched.rows.map(() => 'codex-theme-proposal'),
    ]);
  }

  const resolvedSymbols = [
    ...symbols,
    ...assets,
  ]
    .map((sym) => (typeof sym === 'string' ? sym : sym?.symbol))
    .filter(Boolean);

  if (resolvedSymbols.length) {
    await client.query(`
      INSERT INTO auto_theme_symbols
        (theme, symbol, avg_abs_reaction, reaction_count, correlation, method)
      SELECT * FROM UNNEST(
        $1::text[], $2::text[], $3::double precision[], $4::int[],
        $5::double precision[], $6::text[]
      ) AS t(theme, symbol, avg_abs_reaction, reaction_count, correlation, method)
      ON CONFLICT (theme, symbol) DO NOTHING
    `, [
      resolvedSymbols.map(() => id),
      resolvedSymbols,
      resolvedSymbols.map(() => 0),
      resolvedSymbols.map(() => 0),
      resolvedSymbols.map(() => 1.0),
      resolvedSymbols.map(() => 'codex-theme-proposal'),
    ]);
  }

  // --- Backfill labeled_outcomes for every matched article × symbol × horizon ---
  // Bulk pattern: fetch published_at once, fetch each symbol's full price
  // window once, compute all outcomes in memory, then a single bulk INSERT.
  // Replaces a prior 3-nested loop that issued up to ~12k round-trips on
  // large proposals (100 articles × 20 symbols × 3 horizons × 2 queries each).
  const HORIZONS = [
    { name: '1w', days: 7 },
    { name: '2w', days: 14 },
    { name: '1m', days: 30 },
  ];
  const MAX_HORIZON_SLACK_DAYS = Math.max(...HORIZONS.map((h) => h.days)) + 2;
  let outcomeCount = 0;

  if (matched.rows.length && resolvedSymbols.length) {
    const articleIds = matched.rows.map((r) => r.id);
    const { rows: artRows } = await client.query(
      'SELECT id, published_at FROM articles WHERE id = ANY($1::bigint[])',
      [articleIds],
    );
    const publishedAtById = new Map(artRows.map((r) => [r.id, r.published_at]));

    const publishedMs = artRows
      .map((r) => (r.published_at ? new Date(r.published_at).getTime() : null))
      .filter((t) => Number.isFinite(t));
    const priceSeriesBySymbol = new Map();
    if (publishedMs.length) {
      const minStart = new Date(Math.min(...publishedMs));
      const maxEnd = new Date(Math.max(...publishedMs) + MAX_HORIZON_SLACK_DAYS * 86_400_000);
      for (const symbol of resolvedSymbols) {
        const { rows: priceRows } = await client.query(`
          SELECT valid_time_start, price
          FROM worldmonitor_intel.historical_raw_items
          WHERE provider = 'yahoo-chart' AND symbol = $1
            AND valid_time_start >= $2::timestamptz
            AND valid_time_start <= $3::timestamptz
          ORDER BY valid_time_start
        `, [symbol, minStart, maxEnd]);
        priceSeriesBySymbol.set(
          symbol,
          priceRows.map((r) => ({ t: new Date(r.valid_time_start).getTime(), p: Number(r.price) })),
        );
      }
    }

    const outcomes = [];
    for (const row of matched.rows) {
      const articleId = row.id;
      const publishedAt = publishedAtById.get(articleId);
      if (!publishedAt) continue;
      const pubTs = new Date(publishedAt).getTime();
      for (const symbol of resolvedSymbols) {
        const series = priceSeriesBySymbol.get(symbol);
        if (!series?.length) continue;
        for (const horizon of HORIZONS) {
          const endTs = pubTs + (horizon.days + 2) * 86_400_000;
          const within = series.filter((s) => s.t >= pubTs && s.t <= endTs);
          if (within.length < 2) continue;
          const entry = within[0].p;
          const exit = within[1].p;
          if (!(entry > 0) || !Number.isFinite(exit)) continue;
          const ret = ((exit - entry) / entry) * 100;
          outcomes.push({ articleId, symbol, publishedAt, horizon: horizon.name, entry, exit, ret });
        }
      }
    }

    if (outcomes.length) {
      await client.query(`
        INSERT INTO labeled_outcomes
          (article_id, theme, symbol, published_at, horizon,
           entry_price, exit_price, forward_return_pct, hit)
        SELECT * FROM UNNEST(
          $1::bigint[], $2::text[], $3::text[], $4::timestamptz[], $5::text[],
          $6::double precision[], $7::double precision[],
          $8::double precision[], $9::bool[]
        ) AS t(article_id, theme, symbol, published_at, horizon,
               entry_price, exit_price, forward_return_pct, hit)
        ON CONFLICT (article_id, symbol, horizon) DO NOTHING
      `, [
        outcomes.map((o) => o.articleId),
        outcomes.map(() => id),
        outcomes.map((o) => o.symbol),
        outcomes.map((o) => o.publishedAt),
        outcomes.map((o) => o.horizon),
        outcomes.map((o) => o.entry),
        outcomes.map((o) => o.exit),
        outcomes.map((o) => o.ret),
        outcomes.map((o) => o.ret > 0),
      ]);
      outcomeCount = outcomes.length;
    }
  }

  // --- Refresh sensitivity matrix for the new theme ---
  await client.query(`
    INSERT INTO stock_sensitivity_matrix (theme, symbol, horizon, avg_return, hit_rate, sensitivity_zscore, sample_size)
    SELECT lo.theme, lo.symbol, lo.horizon,
      AVG(lo.forward_return_pct::numeric),
      AVG(lo.hit::int::numeric),
      CASE WHEN base.vol > 0.01 THEN (AVG(lo.forward_return_pct::numeric) - base.avg) / base.vol ELSE 0 END,
      COUNT(*)::int
    FROM labeled_outcomes lo
    CROSS JOIN LATERAL (
      SELECT AVG(forward_return_pct::numeric) AS avg, STDDEV(forward_return_pct::numeric) AS vol
      FROM labeled_outcomes WHERE symbol = lo.symbol AND horizon = lo.horizon
    ) base
    WHERE lo.theme = $1
    GROUP BY lo.theme, lo.symbol, lo.horizon, base.avg, base.vol
    HAVING COUNT(*) >= 10
    ON CONFLICT (theme, symbol, horizon) DO UPDATE SET
      avg_return=EXCLUDED.avg_return, hit_rate=EXCLUDED.hit_rate,
      sensitivity_zscore=EXCLUDED.sensitivity_zscore, sample_size=EXCLUDED.sample_size
  `, [id]);

  return {
    summary: `Theme ${id}: ${matched.rows.length} articles matched, ${symbols?.length || 0} symbols registered, ${outcomeCount} outcomes generated`,
    themeId: id,
    matchedArticles: matched.rows.length,
    outcomeCount,
  };
}

async function handleAttachTheme(client, proposal) {
  const targetTheme = String(proposal?.targetTheme || '').trim().toLowerCase();
  const attachmentKey = String(proposal?.attachmentKey || '').trim().toLowerCase();
  const label = String(proposal?.label || proposal?.name || attachmentKey || '').trim();
  if (!targetTheme || !attachmentKey) throw new Error('Missing targetTheme or attachmentKey');

  const symbols = Array.isArray(proposal?.symbols) ? proposal.symbols : [];
  const assets = Array.isArray(proposal?.assets) ? proposal.assets : [];
  const resolvedSymbols = [
    ...symbols,
    ...assets,
  ]
    .map((sym) => (typeof sym === 'string' ? sym : sym?.symbol))
    .filter(Boolean);

  return {
    summary: `Attachment ${attachmentKey} recorded for ${targetTheme} with ${resolvedSymbols.length} symbol${resolvedSymbols.length === 1 ? '' : 's'}.`,
    targetTheme,
    attachmentKey,
    label,
    symbolCount: resolvedSymbols.length,
    relationType: proposal?.relationType || null,
    transmissionOrder: proposal?.transmissionOrder || null,
  };
}

async function handleValidate(client, proposal) {
  const { theme, symbol } = proposal;
  if (!theme || !symbol) throw new Error('Missing theme or symbol');

  const sensitivity = await client.query(`
    SELECT
      AVG(forward_return_pct::numeric) AS avg_ret,
      AVG(hit::int::numeric) AS hit_rate,
      STDDEV(forward_return_pct::numeric) AS vol,
      COUNT(*) AS n
    FROM labeled_outcomes
    WHERE theme=$1 AND symbol=$2 AND horizon='2w'
  `, [theme, symbol]);

  const row = sensitivity.rows[0];
  const hitRate = Number(row?.hit_rate || 0);
  const avgRet = Number(row?.avg_ret || 0);
  const n = Number(row?.n || 0);
  const sharpe = Number(row?.vol) > 0 ? (avgRet / Number(row.vol)) * Math.sqrt(26) : 0;
  const verdict = n < 20 ? 'insufficient-data' : hitRate >= 0.55 ? 'strong' : hitRate >= 0.45 ? 'marginal' : 'weak';

  if (n >= 20) {
    await client.query(`
      INSERT INTO stock_sensitivity_matrix (theme, symbol, horizon, sample_size, avg_return, hit_rate, return_vol, sensitivity_zscore, baseline_return, baseline_vol)
      VALUES ($1, $2, '2w', $3, $4, $5, $6, 0, 0, 1)
      ON CONFLICT (theme, symbol, horizon) DO UPDATE SET
        sample_size = EXCLUDED.sample_size,
        avg_return = EXCLUDED.avg_return,
        hit_rate = EXCLUDED.hit_rate,
        updated_at = NOW()
    `, [theme, symbol, n, avgRet, hitRate, Number(row?.vol || 0)]);
  }

  return {
    summary: `${theme}/${symbol}: hit=${(hitRate * 100).toFixed(0)}% avg=${avgRet.toFixed(2)}% n=${n} sharpe=${sharpe.toFixed(2)} => ${verdict}`,
    hitRate,
    avgRet,
    n,
    sharpe,
    verdict,
  };
}

async function handleRemoveSymbol(client, proposal) {
  const { theme, symbol, reason } = proposal;
  if (!theme || !symbol) throw new Error('Missing theme or symbol');

  await client.query('DELETE FROM auto_theme_symbols WHERE theme=$1 AND symbol=$2', [theme, symbol]);
  await client.query('DELETE FROM stock_sensitivity_matrix WHERE theme=$1 AND symbol=$2', [theme, symbol]);

  return {
    summary: `Removed ${symbol} from ${theme}: ${reason || 'no reason'}`,
    symbol,
    theme,
    reason,
  };
}

async function handleAddConditionalSensitivity(client, proposal) {
  const { signalName, binMethod = 'quantile' } = proposal.payload && typeof proposal.payload === 'object'
    ? proposal.payload
    : proposal;
  if (!signalName) throw new Error('Missing signalName');

  const check = await client.query(
    'SELECT COUNT(*)::int AS n FROM signal_history WHERE signal_name = $1',
    [signalName],
  );
  const count = Number(check.rows[0]?.n || 0);
  if (count < 100) {
    throw new Error(`not enough signal data for ${signalName}`);
  }
  if (binMethod !== 'quantile') {
    throw new Error(`unsupported binMethod: ${binMethod}`);
  }

  await client.query(`
    INSERT INTO conditional_sensitivity (theme, symbol, horizon, condition_type, condition_value, avg_return, hit_rate, avg_abs_return, sample_size)
    WITH signal_stats AS (
      SELECT
        percentile_cont(0.25) WITHIN GROUP (ORDER BY value) AS p25,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75
      FROM signal_history WHERE signal_name = $1
    )
    SELECT lo.theme, lo.symbol, lo.horizon,
      $2::text AS condition_type,
      CASE
        WHEN sh.value > ss.p75 THEN 'high'
        WHEN sh.value < ss.p25 THEN 'low'
        ELSE 'mid'
      END AS condition_value,
      AVG(lo.forward_return_pct::numeric),
      AVG(lo.hit::int::numeric),
      AVG(ABS(lo.forward_return_pct)::numeric),
      COUNT(*)::int
    FROM labeled_outcomes lo
    JOIN articles a ON lo.article_id = a.id
    LEFT JOIN signal_history sh ON sh.signal_name = $1 AND DATE(sh.ts) = DATE(a.published_at)
    CROSS JOIN signal_stats ss
    WHERE sh.value IS NOT NULL AND lo.horizon = '2w'
    GROUP BY lo.theme, lo.symbol, lo.horizon,
      CASE
        WHEN sh.value > ss.p75 THEN 'high'
        WHEN sh.value < ss.p25 THEN 'low'
        ELSE 'mid'
      END
    HAVING COUNT(*) >= 30
    ON CONFLICT (theme, symbol, horizon, condition_type, condition_value) DO UPDATE SET
      avg_return=EXCLUDED.avg_return,
      hit_rate=EXCLUDED.hit_rate,
      avg_abs_return=EXCLUDED.avg_abs_return,
      sample_size=EXCLUDED.sample_size,
      updated_at=NOW()
  `, [signalName, `signal_${signalName}`]);

  const total = await client.query(
    'SELECT COUNT(*)::int AS n FROM conditional_sensitivity WHERE condition_type = $1',
    [`signal_${signalName}`],
  );
  return {
    ok: true,
    signalName,
    summary: `signal_${signalName}: ${Number(total.rows[0]?.n || 0)} records`,
  };
}

function extractProposalsFromCodexOutput(raw) {
  const proposals = [];
  if (raw.themes) {
    for (const theme of raw.themes) {
      proposals.push({
        type: 'add-theme',
        id: theme.id,
        label: theme.label,
        triggers: theme.triggers || [],
        symbols: theme.assets || [],
      });
    }
  }
  if (raw.proposals) {
    for (const proposal of raw.proposals) {
      proposals.push({
        type: 'add-symbol',
        symbol: proposal.symbol,
        theme: proposal.theme,
        direction: proposal.direction,
        reason: proposal.reason,
      });
    }
  }
  return proposals;
}

function extractProposalsFromDiscoveries(discoveries) {
  const proposals = [];
  const pairs = discoveries.matrixRanking?.mostPredictiveBySensitivity || [];
  for (const pair of pairs) {
    proposals.push({ type: 'validate', theme: pair.theme, symbol: pair.symbol });
  }
  return proposals;
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
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
