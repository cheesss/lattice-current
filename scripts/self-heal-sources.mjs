#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureAutomationSchema } from './_shared/schema-automation.mjs';
import { checkBudget, checkKillSwitch, consumeBudget } from './_shared/automation-budget.mjs';
import { logAutomationAction } from './_shared/automation-audit.mjs';
import { queueForApproval } from './_shared/approval-queue.mjs';
import { isTrustedFeedUrl } from './_shared/feed-trust.mjs';

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
      category: 'politics',
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
    const confidence = toNumber(source?.confidence, 0);
    if (confidence < minConfidence) continue;
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
        + (String(source?.status || '') === 'approved' ? 20 : 0)
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
      discoveryModule,
    ] = await Promise.all([
      import('../src/services/source-registry.ts'),
      import('../src/services/source-healing-suggestions.ts'),
      import('../src/services/server/autonomous-discovery.ts'),
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
    for (const candidate of candidates) {
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

      if (!isTrustedFeedUrl(candidate.url)) {
        // eslint-disable-next-line no-await-in-loop
        const queued = await queueForApproval(client, {
          type: 'add-rss',
          params: {
            url: candidate.url,
            name: candidate.feedName,
            theme: candidate.category,
            reason: candidate.reason,
          },
          reason: `untrusted feed domain queued by self-heal: ${candidate.url}`,
        });
        // eslint-disable-next-line no-await-in-loop
        await logAutomationAction(client, {
          type: 'self-heal-source',
          params: {
            url: candidate.url,
            feedName: candidate.feedName,
            approvalId: queued.id,
          },
          result: 'queued',
          reason: 'untrusted feed domain awaiting approval',
        });
        results.push({
          url: candidate.url,
          action: 'approval',
          approvalId: queued.id,
        });
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const registration = await discoveryModule.evaluateAndRegisterFeed(candidate.url, candidate.category, {
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
        });
        // eslint-disable-next-line no-await-in-loop
        await logAutomationAction(client, {
          type: 'self-heal-source',
          params: {
            url: candidate.url,
            feedName: candidate.feedName,
            confidence: candidate.confidence,
          },
          result: 'success',
          reason: `quality=${registration.quality.score.toFixed(2)}`,
        });
        results.push({
          url: candidate.url,
          action: 'activated',
          qualityScore: registration.quality.score,
        });
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
    }

    return {
      ok: true,
      candidateCount: candidates.length,
      activated: results.filter((item) => item.action === 'activated').length,
      queuedForApproval: results.filter((item) => item.action === 'approval').length,
      rejected: results.filter((item) => item.action === 'rejected').length,
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
