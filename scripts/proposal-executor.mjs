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

function proposalKey(proposal) {
  return [
    proposal.type || proposal.proposal_type || 'unknown',
    proposal._dbId || proposal.id || proposal.symbol || proposal.url || proposal.theme || proposal.name || 'anonymous',
  ].join('::');
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
  const { url, name, theme } = proposal;
  if (!url) return { dryRun: true, skipped: true, reason: 'missing URL', summary: 'dry-run add-rss: missing URL' };

  try {
    const { probeSource } = await import('./_shared/source-probe.mjs');
    const probe = await probeSource(url, { theme });

    const wouldRegister = probe.nextAction === 'register' || probe.nextAction === 'review';
    const wouldSeedCount = probe.sampleItems.length;

    return {
      dryRun: true,
      skipped: !wouldRegister,
      reason: wouldRegister ? null : `quality ${probe.qualityScore.toFixed(2)} below threshold or feed not found`,
      summary: wouldRegister
        ? `DRY RUN: would register ${name || probe.domain} via ${probe.connectorKind}`
        : `DRY RUN: would skip — ${probe.nextAction}`,
      // probe results
      resolvedUrl: probe.resolvedUrl,
      connectorKind: probe.connectorKind,
      qualityScore: probe.qualityScore,
      qualityBreakdown: probe.qualityBreakdown,
      recentItemCount: probe.qualityBreakdown.recentItemCount,
      sampleItems: probe.sampleItems,
      wouldRegister,
      wouldSeedCount,
      warnings: probe.warnings,
      errors: probe.errors,
      nextAction: probe.nextAction,
      probeStatus: probe.status,
      probeTraceId: probe.traceId,
      // legacy fields for UI compat
      url,
      feedName: name,
      quality: { score: probe.qualityScore, ...probe.qualityBreakdown },
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
  const { url, name, theme } = proposal;
  if (!url) throw new Error('Missing RSS url');

  const { probeSource } = await import('./_shared/source-probe.mjs');
  const probe = await probeSource(url, { theme });
  const effectiveUrl = probe.resolvedUrl || url;

  if (probe.nextAction === 'reject' || probe.nextAction === 'manual-adapter') {
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
      },
    }));
    return result;
  }

  if (!isTrustedFeedUrl(url) && !proposal.human_approved) {
    const queued = await queueForApproval(client, {
      type: 'add-rss',
      params: {
        url,
        name,
        theme,
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
      },
      reason: `untrusted RSS domain requires approval after probe: ${url} (quality=${probe.qualityScore.toFixed(2)})`,
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
    };
    await emitOpenClawEvent(createOpenClawEvent({
      eventType: 'approval-created',
      severity: 'review',
      theme,
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
      },
    }));
    return result;
  }

  const { registerProbedSource } = await import('./_shared/discovered-source-registry.mjs');
  const registration = await registerProbedSource(client, probe, theme || 'politics', {
    feedName: name || 'rss',
    lang: 'en',
    topics: [theme].filter(Boolean),
    autoRegister: true,
    minScore: options.minQualityScore ?? 0.65,
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
    };
    await emitOpenClawEvent(createOpenClawEvent({
      eventType: 'source-rejected',
      severity: 'review',
      theme,
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
      },
    }));
    return result;
  }

  let items = [];
  if (probe.sampleItems && probe.sampleItems.length >= 3) {
    // probe에서 이미 파싱된 sampleItems 사용 — 추가 fetch 없이
    items = probe.sampleItems.map((si) => ({
      title: String(si.title || '').slice(0, 500),
      url: String(si.url || si.link || ''),
      date: si.date || si.publishedAt || new Date().toISOString(),
    }));
  } else {
    // fallback: 직접 fetch + XML 파싱
    const response = await fetch(effectiveUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`RSS fetch ${response.status}`);
    const text = await response.text();

    const itemRegex = /<item>([\s\S]*?)<\/item>|<entry>([\s\S]*?)<\/entry>/gi;
    let match;
    while ((match = itemRegex.exec(text)) !== null) {
      const content = match[1] || match[2] || '';
      const title = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '';
      const link = content.match(/<link[^>]*href="([^"]*)"[^>]*\/?>|<link[^>]*>([\s\S]*?)<\/link>/i);
      const pubDate = content.match(/<pubDate>([\s\S]*?)<\/pubDate>|<published>([\s\S]*?)<\/published>|<updated>([\s\S]*?)<\/updated>/i);
      if (title) {
        items.push({
          title: title.slice(0, 500),
          url: (link?.[1] || link?.[2] || '').trim(),
          date: pubDate ? new Date(pubDate[1] || pubDate[2] || pubDate[3]).toISOString() : new Date().toISOString(),
        });
      }
    }
  }

  let inserted = 0;
  for (const item of items.slice(0, 100)) {
    try {
      const insertResult = await client.query(`
        INSERT INTO articles (source, theme, published_at, title, url)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [name || 'rss', theme || 'tech', item.date, item.title, item.url]);
      inserted += Number(insertResult?.rowCount || 0);
    } catch {
      // ignore duplicates
    }
  }

  await client.query(`
    INSERT INTO auto_article_themes (article_id, auto_theme, confidence, method)
    SELECT a.id, $1, 0.5, 'rss-default'
    FROM articles a
    WHERE a.source = $2
      AND NOT EXISTS (SELECT 1 FROM auto_article_themes t WHERE t.article_id = a.id)
  `, [theme || 'tech', name || 'rss']);

  const result = {
    summary: `RSS ${name}: registered and seeded ${inserted} articles`,
    feedName: name,
    url,
    resolvedUrl: effectiveUrl,
    connectorKind: probe.connectorKind,
    probeTraceId: probe.traceId,
    articleCount: inserted,
    quality: registration.quality,
  };
  await emitOpenClawEvent(createOpenClawEvent({
    eventType: 'source-registered',
    severity: 'info',
    theme,
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
      quality: registration.quality,
      probeTraceId: probe.traceId,
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
