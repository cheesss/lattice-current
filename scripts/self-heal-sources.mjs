#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureAutomationSchema } from './_shared/schema-automation.mjs';
import { checkBudget, checkKillSwitch, consumeBudget } from './_shared/automation-budget.mjs';
import { logAutomationAction } from './_shared/automation-audit.mjs';
import { queueForApproval } from './_shared/approval-queue.mjs';
import { isTrustedFeedUrl } from './_shared/feed-trust.mjs';
import { probeSource } from './_shared/source-probe.mjs';
import { attemptSourceRepair } from './_shared/source-repair.mjs';
import { queueCodexSourceCodeRepair } from './_shared/codex-source-code-repair.mjs';
import { registerProbedSource } from './_shared/discovered-source-registry.mjs';
import { createOpenClawEvent, emitOpenClawEvent } from './_shared/openclaw-webhook-emitter.mjs';
import { isLowValueGoogleNewsSource } from './_shared/google-news-source-policy.mjs';

loadOptionalEnvFile();

const { Client } = pg;
const DEFAULT_MIN_CONFIDENCE = 70;
const DEFAULT_MIN_QUALITY_SCORE = 0.65;
const DEFAULT_LIMIT = 10;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeString(value) {
  return String(value || '').trim();
}

function candidateId(url) {
  return normalizeString(url).toLowerCase();
}

export function buildSelfHealingCandidates({
  suggestions = [],
  discoveredSources = [],
  registryRecords = [],
  minConfidence = DEFAULT_MIN_CONFIDENCE,
} = {}) {
  const degradedFeedNames = new Set(
    registryRecords
      .filter((record) => String(record?.status || '') !== 'healthy')
      .map((record) => normalizeString(record.feedName).toLowerCase())
      .filter(Boolean),
  );

  const merged = new Map();
  for (const suggestion of suggestions) {
    const url = normalizeString(suggestion?.suggestedUrl);
    if (!url) continue;
    const confidence = toNumber(suggestion?.confidence, 0);
    if (confidence < minConfidence) continue;
    const key = candidateId(url);
    const existing = merged.get(key);
    merged.set(key, {
      ...(existing || {}),
      id: key,
      url,
      feedName: normalizeString(suggestion?.feedName) || 'Recovered feed',
      lang: normalizeString(suggestion?.lang) || 'en',
      category: normalizeString(suggestion?.category || suggestion?.theme || suggestion?.sourceCategory) || 'politics',
      confidence,
      reason: normalizeString(suggestion?.reason) || 'source healing suggestion',
      topics: asArray(suggestion?.topics).filter(Boolean),
      suggestionId: normalizeString(suggestion?.id) || null,
      discoveredSourceId: null,
      degradedFeed: degradedFeedNames.has(normalizeString(suggestion?.feedName).toLowerCase()),
      priority: 40
        + confidence
        + (String(suggestion?.type || '') === 'rss-replacement' ? 15 : 0)
        + (degradedFeedNames.has(normalizeString(suggestion?.feedName).toLowerCase()) ? 15 : 0),
    });
  }

  for (const source of discoveredSources) {
    const url = normalizeString(source?.url);
    if (!url) continue;
    const status = String(source?.status || '').toLowerCase();
    if (status !== 'approved') continue;
    const confidence = toNumber(source?.confidence, 0);
    if (confidence < minConfidence) continue;
    if (isLowValueGoogleNewsSource({
      url,
      feedName: source?.feedName,
      category: source?.category,
      theme: source?.category,
      topics: source?.topics,
    })) {
      continue;
    }
    const key = candidateId(url);
    const degradedFeed = degradedFeedNames.has(normalizeString(source?.feedName).toLowerCase());
    const existing = merged.get(key);
    const next = {
      ...(existing || {}),
      id: key,
      url,
      feedName: normalizeString(source?.feedName) || 'Discovered feed',
      lang: normalizeString(source?.lang) || 'en',
      category: normalizeString(source?.category) || 'politics',
      confidence,
      reason: normalizeString(source?.reason) || 'approved discovered source',
      topics: asArray(source?.topics).filter(Boolean),
      suggestionId: existing?.suggestionId || null,
      discoveredSourceId: normalizeString(source?.id) || null,
      degradedFeed,
      priority: 45
        + confidence
        + 20
        + (degradedFeed ? 15 : 0),
    };
    merged.set(key, !existing || next.priority >= existing.priority ? next : {
      ...existing,
      topics: Array.from(new Set([...(existing.topics || []), ...(next.topics || [])])).slice(0, 12),
      suggestionId: existing.suggestionId || next.suggestionId,
      discoveredSourceId: existing.discoveredSourceId || next.discoveredSourceId,
      degradedFeed: existing.degradedFeed || next.degradedFeed,
      priority: Math.max(existing.priority || 0, next.priority || 0),
      confidence: Math.max(existing.confidence || 0, next.confidence || 0),
    });
  }

  return Array.from(merged.values())
    .sort((left, right) => right.priority - left.priority || right.confidence - left.confidence)
    .slice(0, 100);
}

function parseArgs(argv = []) {
  const getValue = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : null;
  };
  const limit = Math.max(1, Math.min(100, Number(getValue('--limit')) || DEFAULT_LIMIT));
  const minConfidence = Math.max(0, Math.min(100, Number(getValue('--min-confidence')) || DEFAULT_MIN_CONFIDENCE));
  const minQualityScore = Math.max(0, Math.min(1, Number(getValue('--min-quality')) || DEFAULT_MIN_QUALITY_SCORE));
  return { limit, minConfidence, minQualityScore };
}

function sourceProbePassesGate(probe) {
  return (probe?.nextAction === 'register' || probe?.nextAction === 'review')
    && Number(probe?.qualityBreakdown?.recentItemCount || 0) >= 3;
}

function summarizeRepair(repair) {
  if (!repair?.attempted) return null;
  return {
    repaired: Boolean(repair.best),
    reason: repair.reason,
    candidateCount: repair.candidates.length,
    attempts: repair.attempts.map((attempt) => ({
      url: attempt.url,
      resolvedUrl: attempt.resolvedUrl,
      connectorKind: attempt.connectorKind,
      qualityScore: attempt.qualityScore,
      recentItemCount: attempt.recentItemCount,
      nextAction: attempt.nextAction,
      accepted: attempt.accepted,
      source: attempt.source,
    })).slice(0, 5),
    selected: repair.best ? {
      url: repair.best.url,
      resolvedUrl: repair.best.resolvedUrl,
      connectorKind: repair.best.connectorKind,
      qualityScore: repair.best.qualityScore,
      recentItemCount: repair.best.recentItemCount,
      source: repair.best.source,
      reason: repair.best.reason,
    } : null,
    llmSkippedReason: repair.llmSkippedReason,
  };
}

export async function runSourceSelfHeal(options = {}) {
  checkKillSwitch();
  const settings = {
    limit: Math.max(1, Math.min(100, Number(options.limit) || DEFAULT_LIMIT)),
    minConfidence: Math.max(0, Math.min(100, Number(options.minConfidence) || DEFAULT_MIN_CONFIDENCE)),
    minQualityScore: Math.max(0, Math.min(1, Number(options.minQualityScore) || DEFAULT_MIN_QUALITY_SCORE)),
  };

  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    await ensureAutomationSchema(client);

    const [
      registryModule,
      healingModule,
    ] = await Promise.all([
      import('../src/services/source-registry.ts'),
      import('../src/services/source-healing-suggestions.ts'),
    ]);

    const registrySnapshot = await registryModule.listSourceRegistrySnapshot();
    const suggestions = await healingModule.listSourceHealingSuggestions(200);
    const discoveredSources = await registryModule.listDiscoveredSources();
    const candidates = buildSelfHealingCandidates({
      suggestions,
      discoveredSources,
      registryRecords: registrySnapshot.records,
      minConfidence: settings.minConfidence,
    }).slice(0, settings.limit);

    const results = [];
    for (const originalCandidate of candidates) {
      let candidate = originalCandidate;
      let repair = null;
      const originalUrl = candidate.url;
      // eslint-disable-next-line no-await-in-loop
      const budget = await checkBudget(client, 'selfHealingActions', 1);
      if (!budget.allowed) {
        results.push({
          url: candidate.url,
          action: 'stopped',
          reason: budget.reason,
        });
        break;
      }

      // eslint-disable-next-line no-await-in-loop
      let probe = await probeSource(candidate.url, {
        theme: candidate.category,
        qualityThreshold: settings.minQualityScore,
      });
      let passGate = sourceProbePassesGate(probe);

      if (!passGate) {
        // eslint-disable-next-line no-await-in-loop
        repair = await attemptSourceRepair({
          inputUrl: candidate.url,
          theme: candidate.category,
          name: candidate.feedName,
          reason: candidate.reason,
          probe,
          minQualityScore: settings.minQualityScore,
          maxCandidates: Number(process.env.SOURCE_REPAIR_MAX_CANDIDATES || 48),
        });

        if (repair.best) {
          const repairedUrl = repair.best.resolvedUrl || repair.best.url;
          candidate = {
            ...candidate,
            url: repairedUrl,
            feedName: candidate.feedName,
            reason: `${candidate.reason}; auto-repaired from ${candidate.url}`,
            repairOf: originalUrl,
          };
          probe = repair.best.probe;
          passGate = sourceProbePassesGate(probe);
        }
      }

      if (!passGate) {
        const repairSummary = summarizeRepair(repair);
        // eslint-disable-next-line no-await-in-loop
        const codexCodeRepair = await queueCodexSourceCodeRepair({
          url: candidate.url,
          theme: candidate.category,
          name: candidate.feedName,
          reason: candidate.reason,
          probe,
          repair: repairSummary,
        });
        // eslint-disable-next-line no-await-in-loop
        await logAutomationAction(client, {
          type: 'self-heal-source',
          params: {
            url: candidate.url,
            feedName: candidate.feedName,
            probeStatus: probe.status,
            probeNextAction: probe.nextAction,
            qualityScore: probe.qualityScore,
            probeTraceId: probe.traceId,
            repair: repairSummary,
            codexCodeRepair,
          },
          result: probe.nextAction === 'manual-adapter' ? 'needs-adapter' : 'rejected',
          reason: repairSummary
            ? `probe gate after repair: ${probe.nextAction}, quality=${probe.qualityScore.toFixed(2)}, repair=${repairSummary.reason}`
            : `probe gate: ${probe.nextAction}, quality=${probe.qualityScore.toFixed(2)}, errors=${probe.errors.map((e) => e.message).join('; ') || 'none'}`,
        });
        results.push({
          url: candidate.url,
          action: probe.nextAction === 'manual-adapter' ? 'needs-adapter' : 'rejected',
          reason: repairSummary
            ? `repair failed: ${repairSummary.reason}`
            : `probe gate: quality=${probe.qualityScore.toFixed(2)}, nextAction=${probe.nextAction}`,
          probeTraceId: probe.traceId,
          repair: repairSummary,
          codexCodeRepair,
        });
        // eslint-disable-next-line no-await-in-loop
        await emitOpenClawEvent(createOpenClawEvent({
          eventType: 'source-probe-failed',
          severity: probe.nextAction === 'manual-adapter' ? 'review' : 'warning',
          theme: candidate.category,
          entityType: 'source',
          entityId: candidate.url,
          surface: 'decision-inbox',
          summary: `Self-heal probe gate rejected ${candidate.feedName || candidate.url}`,
          payload: {
            url: candidate.url,
            feedName: candidate.feedName,
            nextAction: probe.nextAction,
            qualityScore: probe.qualityScore,
            resolvedUrl: probe.resolvedUrl,
            connectorKind: probe.connectorKind,
            probeTraceId: probe.traceId,
            repair: repairSummary,
            codexCodeRepair,
          },
        }));
        continue;
      }

      if (!isTrustedFeedUrl(candidate.url)) {
        // Phase 1 gate: probe before queuing
        // probe passed — queue with evidence
        // eslint-disable-next-line no-await-in-loop
        const queued = await queueForApproval(client, {
          type: 'add-rss',
          params: {
            url: candidate.url,
            name: candidate.feedName,
            theme: candidate.category,
            reason: candidate.reason,
            repairOf: candidate.repairOf || null,
            repair: summarizeRepair(repair),
            // probe evidence
            inputUrl: probe.inputUrl,
            resolvedUrl: probe.resolvedUrl,
            connectorKind: probe.connectorKind,
            nextAction: probe.nextAction,
            qualityScore: probe.qualityScore,
            recentItemCount: probe.qualityBreakdown.recentItemCount,
            sampleItems: probe.sampleItems.slice(0, 3),
            warnings: probe.warnings,
            probeTraceId: probe.traceId,
          },
          reason: `untrusted feed queued by self-heal after probe: ${candidate.url} (quality=${probe.qualityScore.toFixed(2)}, connector=${probe.connectorKind})`,
        });
        // eslint-disable-next-line no-await-in-loop
        await logAutomationAction(client, {
          type: 'self-heal-source',
          params: {
            url: candidate.url,
            feedName: candidate.feedName,
            approvalId: queued.id,
            resolvedUrl: probe.resolvedUrl,
            connectorKind: probe.connectorKind,
            nextAction: probe.nextAction,
            qualityScore: probe.qualityScore,
            probeTraceId: probe.traceId,
            repairOf: candidate.repairOf || null,
            repair: summarizeRepair(repair),
          },
          result: 'queued',
          reason: candidate.repairOf
            ? `auto-repaired from ${candidate.repairOf}; probe passed (quality=${probe.qualityScore.toFixed(2)}, connector=${probe.connectorKind}), awaiting approval`
            : `probe passed (quality=${probe.qualityScore.toFixed(2)}, connector=${probe.connectorKind}), awaiting approval`,
        });
        results.push({
          url: candidate.url,
          action: 'approval',
          approvalId: queued.id,
          resolvedUrl: probe.resolvedUrl,
          connectorKind: probe.connectorKind,
          qualityScore: probe.qualityScore,
          probeTraceId: probe.traceId,
          repairOf: candidate.repairOf || null,
          repair: summarizeRepair(repair),
        });
        // eslint-disable-next-line no-await-in-loop
        await emitOpenClawEvent(createOpenClawEvent({
          eventType: 'approval-created',
          severity: 'review',
          theme: candidate.category,
          entityType: 'approval',
          entityId: String(queued.id),
          surface: 'decision-inbox',
          summary: `Self-heal queued untrusted source ${candidate.feedName || candidate.url}`,
          payload: {
            approvalId: queued.id,
            url: candidate.url,
            feedName: candidate.feedName,
            resolvedUrl: probe.resolvedUrl,
            connectorKind: probe.connectorKind,
            qualityScore: probe.qualityScore,
            probeTraceId: probe.traceId,
            repairOf: candidate.repairOf || null,
            repair: summarizeRepair(repair),
          },
        }));
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const registration = await registerProbedSource(client, probe, candidate.category, {
        minScore: settings.minQualityScore,
        autoRegister: true,
        feedName: candidate.feedName,
        lang: candidate.lang,
        topics: candidate.topics,
      });

      if (registration.registered) {
        if (candidate.discoveredSourceId) {
          // eslint-disable-next-line no-await-in-loop
          await registryModule.setDiscoveredSourceStatus(candidate.discoveredSourceId, 'active', {
            actor: 'system',
            note: `self-heal activated feed after quality score ${registration.quality.score.toFixed(2)}`,
          });
        }
        if (candidate.suggestionId) {
          // eslint-disable-next-line no-await-in-loop
          await healingModule.setSourceHealingSuggestionStatus(candidate.suggestionId, 'resolved');
        }
        // eslint-disable-next-line no-await-in-loop
        await consumeBudget(client, 'selfHealingActions', 1, {
          url: candidate.url,
          confidence: candidate.confidence,
          qualityScore: registration.quality.score,
          resolvedUrl: registration.feedUrl,
          connectorKind: probe.connectorKind,
          repairOf: candidate.repairOf || null,
        });
        // eslint-disable-next-line no-await-in-loop
        await logAutomationAction(client, {
          type: 'self-heal-source',
          params: {
            url: candidate.url,
            feedName: candidate.feedName,
            confidence: candidate.confidence,
            resolvedUrl: registration.feedUrl,
            connectorKind: probe.connectorKind,
            repairOf: candidate.repairOf || null,
            repair: summarizeRepair(repair),
          },
          result: 'success',
          reason: candidate.repairOf
            ? `auto-repaired from ${candidate.repairOf}; probe quality=${registration.quality.score.toFixed(2)}, connector=${probe.connectorKind}`
            : `probe quality=${registration.quality.score.toFixed(2)}, connector=${probe.connectorKind}`,
        });
        results.push({
          url: candidate.url,
          action: 'activated',
          qualityScore: registration.quality.score,
          resolvedUrl: registration.feedUrl,
          connectorKind: probe.connectorKind,
          repairOf: candidate.repairOf || null,
          repair: summarizeRepair(repair),
        });
        // eslint-disable-next-line no-await-in-loop
        await emitOpenClawEvent(createOpenClawEvent({
          eventType: 'source-repaired',
          severity: 'info',
          theme: candidate.category,
          entityType: 'source',
          entityId: candidate.url,
          surface: 'ops',
          summary: `Self-heal activated ${candidate.feedName || candidate.url}`,
          payload: {
            url: candidate.url,
            feedName: candidate.feedName,
            resolvedUrl: registration.feedUrl,
            connectorKind: probe.connectorKind,
            qualityScore: registration.quality.score,
            confidence: candidate.confidence,
            repairOf: candidate.repairOf || null,
            repair: summarizeRepair(repair),
          },
        }));
        continue;
      }

      if (candidate.suggestionId) {
        // eslint-disable-next-line no-await-in-loop
        await healingModule.setSourceHealingSuggestionStatus(candidate.suggestionId, 'rejected');
      }
      // eslint-disable-next-line no-await-in-loop
      await logAutomationAction(client, {
        type: 'self-heal-source',
        params: {
          url: candidate.url,
          feedName: candidate.feedName,
          confidence: candidate.confidence,
        },
        result: 'skipped',
        reason: registration.reason || 'quality gate rejected source',
      });
      results.push({
        url: candidate.url,
        action: 'rejected',
        reason: registration.reason || 'quality gate rejected source',
      });
      // eslint-disable-next-line no-await-in-loop
      await emitOpenClawEvent(createOpenClawEvent({
        eventType: 'source-rejected',
        severity: 'review',
        theme: candidate.category,
        entityType: 'source',
        entityId: candidate.url,
        surface: 'decision-inbox',
        summary: `Self-heal registration rejected ${candidate.feedName || candidate.url}`,
        payload: {
          url: candidate.url,
          feedName: candidate.feedName,
          reason: registration.reason || 'quality gate rejected source',
          confidence: candidate.confidence,
        },
      }));
    }

    return {
      ok: true,
      candidateCount: candidates.length,
      activated: results.filter((item) => item.action === 'activated').length,
      queuedForApproval: results.filter((item) => item.action === 'approval').length,
      rejected: results.filter((item) => item.action === 'rejected').length,
      needsAdapter: results.filter((item) => item.action === 'needs-adapter').length,
      results,
    };
  } finally {
    await client.end().catch(() => {});
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
  runSourceSelfHeal(parseArgs(process.argv.slice(2)))
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    });
}
