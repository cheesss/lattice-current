#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';

import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import {
  ensureOperatorResearchSeedSchema,
  loadOperatorResearchSeeds,
  recordOperatorSeedEvidenceOutcome,
} from './_shared/operator-research-seeds.mjs';
import {
  operatorSeedProviderTarget,
  summarizeOperatorSeedClosure,
} from './_shared/operator-seed-closure.mjs';
import {
  collectForTarget,
  ensureExternalProviderBackfillSchema,
  persistProviderRouteEvidenceBundles,
  providerRunStatus,
} from './collect-free-external-data.mjs';

const { Client } = pg;

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function uniqueStrings(values = [], limit = 80) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function parseCsv(value = '') {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

export function parseMechanismSeedProviderBackfillArgs(argv = process.argv.slice(2)) {
  const out = {
    apply: false,
    dryRun: true,
    statuses: ['needs_evidence', 'review_ready'],
    seedIds: [],
    providers: ['dod-contracts', 'usaspending', 'public-planning-source', 'sec', 'fmp', 'eia'],
    limit: 5,
    throttleHours: 12,
    maxProviderAttempts: 1,
    force: false,
    providerConcurrency: 2,
    targetConcurrency: 1,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--apply') {
      out.apply = true;
      out.dryRun = false;
    } else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--statuses') out.statuses = parseCsv(next());
    else if (arg === '--seed-id') out.seedIds.push(next());
    else if (arg === '--seed-ids') out.seedIds = parseCsv(next());
    else if (arg === '--providers') out.providers = parseCsv(next());
    else if (arg === '--limit') out.limit = Number(next() || out.limit);
    else if (arg === '--throttle-hours') out.throttleHours = Number(next() || out.throttleHours);
    else if (arg === '--max-provider-attempts') out.maxProviderAttempts = Number(next() || out.maxProviderAttempts);
    else if (arg === '--force') out.force = true;
    else if (arg === '--provider-concurrency') out.providerConcurrency = Number(next() || out.providerConcurrency);
    else if (arg === '--target-concurrency') out.targetConcurrency = Number(next() || out.targetConcurrency);
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--statuses=')) out.statuses = parseCsv(arg.slice('--statuses='.length));
    else if (arg.startsWith('--seed-id=')) out.seedIds.push(arg.slice('--seed-id='.length));
    else if (arg.startsWith('--seed-ids=')) out.seedIds = parseCsv(arg.slice('--seed-ids='.length));
    else if (arg.startsWith('--providers=')) out.providers = parseCsv(arg.slice('--providers='.length));
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--throttle-hours=')) out.throttleHours = Number(arg.slice('--throttle-hours='.length));
    else if (arg.startsWith('--max-provider-attempts=')) out.maxProviderAttempts = Number(arg.slice('--max-provider-attempts='.length));
    else if (arg.startsWith('--provider-concurrency=')) out.providerConcurrency = Number(arg.slice('--provider-concurrency='.length));
    else if (arg.startsWith('--target-concurrency=')) out.targetConcurrency = Number(arg.slice('--target-concurrency='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  out.limit = Math.max(1, Math.min(50, Number(out.limit || 5)));
  out.providerConcurrency = Math.max(1, Math.min(8, Number(out.providerConcurrency || 2)));
  out.targetConcurrency = Math.max(1, Math.min(4, Number(out.targetConcurrency || 1)));
  out.maxProviderAttempts = Math.max(1, Math.min(10, Number(out.maxProviderAttempts || 1)));
  return out;
}

function helpText() {
  return `Usage:
  node --import tsx scripts/run-mechanism-seed-provider-backfill.mjs --dry-run --statuses needs_evidence
  node --import tsx scripts/run-mechanism-seed-provider-backfill.mjs --apply --statuses needs_evidence --limit 2 --providers sec,fmp,public-planning-source

Default mode is dry-run. --apply runs official/provider collectors and stores only
operator seed-scoped research_evidence_bundles plus operator seed outcome ledger.
It does not create canonical graph/source registry/provider activation writes.
--max-provider-attempts controls when recorded no-hit/weak provider outcomes
become exhausted instead of being retried forever.
`;
}

async function withClient(options = {}, fn) {
  if (options.client) return fn(options.client);
  loadOptionalEnvFile();
  const client = new Client(options.pgConfig || resolveNasPgConfig(options.pg || {}));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function providerOutcomeStatus(counts = {}) {
  if (Number(counts.promotion_candidate || 0) > 0) return 'executed';
  if (Number(counts.supporting_context || 0) > 0) return 'context-collected';
  if (Number(counts.weak_noise || 0) > 0) return 'weak-noise-collected';
  return 'needs-fix';
}

async function recordProviderOutcomes(client, seedId, providerEvidence = {}, metadata = {}, evidenceClasses = []) {
  const results = [];
  const classEntries = Object.keys(providerEvidence.classCounts || {}).length
    ? Object.entries(providerEvidence.classCounts || {})
    : uniqueStrings(evidenceClasses, 30).map((evidenceClass) => [evidenceClass, {}]);
  for (const [evidenceClass, counts] of classEntries) {
    const promotion = Number(counts.promotion_candidate || 0);
    const context = Number(counts.supporting_context || 0);
    const noise = Number(counts.weak_noise || 0);
    const persisted = promotion + context + noise + Number(counts.negative_control_candidate || 0);
    results.push(await recordOperatorSeedEvidenceOutcome(client, {
      seedId,
      evidenceClass,
      query: `official provider backfill for ${evidenceClass}`,
      status: providerOutcomeStatus(counts),
      failureCategory: persisted ? 'official-provider-collected' : (providerEvidence.reason || 'provider-no-hit'),
      persistedBundleCount: persisted,
      acceptedBundleCount: promotion,
      promotionBundleCount: promotion,
      contextBundleCount: context,
      noiseCount: noise,
      metadata: {
        ...metadata,
        providerEvidenceClassCounts: counts,
        providerEvidenceSkipped: Boolean(providerEvidence.skipped),
        providerEvidenceReason: providerEvidence.reason || null,
      },
    }));
  }
  return results;
}

export async function runMechanismSeedProviderBackfill(options = {}) {
  return withClient(options, async (client) => {
    if (options.ensureSchema !== false) {
      await ensureOperatorResearchSeedSchema(client);
      if (options.apply) await ensureExternalProviderBackfillSchema(client);
    }
    const rows = await loadOperatorResearchSeeds(client, {
      statuses: options.statuses || [],
      limit: Math.max(1, Math.min(500, Number(options.loadLimit || 500))),
    });
    const seedIdFilter = new Set(uniqueStrings(options.seedIds || [], 100));
    const candidates = rows
      .filter((row) => !seedIdFilter.size || seedIdFilter.has(row.seed_id))
      .map((row) => {
        const closure = summarizeOperatorSeedClosure(row, {
          providers: options.providers,
          maxProviderAttempts: options.maxProviderAttempts,
        });
        const target = operatorSeedProviderTarget(row, {
          providers: options.providers,
          maxProviderAttempts: options.maxProviderAttempts,
        });
        return { row, closure, target };
      })
      .filter((item) => item.closure.providerBackfillPlan.routeCount > 0)
      .slice(0, options.limit || 5);

    const dryRunTargets = candidates.map((item) => ({
      seedId: item.row.seed_id,
      title: item.row.seed_title,
      status: item.row.status,
      negativeControl: item.closure.negativeControl,
      providerBackfill: item.closure.providerBackfillPlan,
      target: {
        targetKey: item.target.targetKey,
        theme: item.target.theme,
        label: item.target.label,
        symbols: item.target.symbols,
        providers: item.closure.providerBackfillPlan.providers,
        desiredEvidenceClasses: item.target.desiredEvidenceClasses,
      },
    }));

    if (!options.apply) {
      return {
        ok: true,
        dryRun: true,
        targetCount: dryRunTargets.length,
        targets: dryRunTargets,
        boundaries: {
          approvalQueueWrites: 0,
          reportBackfillWrites: 0,
          canonicalWrites: 0,
          sourceRegistryWrites: 0,
          providerActivationWrites: 0,
        },
      };
    }

    const applied = [];
    for (const item of candidates) {
      const result = await collectForTarget(client, item.target, {
        providers: options.providers,
        force: Boolean(options.force),
        throttleHours: Number(options.throttleHours || 12),
        providerConcurrency: options.providerConcurrency || 2,
        targetConcurrency: options.targetConcurrency || 1,
        symbols: item.target.symbols || [],
        theme: item.target.theme,
        label: item.target.label,
      });
      const providerEvidence = await persistProviderRouteEvidenceBundles(client, item.target, result, {
        operatorSeedId: item.row.seed_id,
      });
      const outcomeResults = await recordProviderOutcomes(client, item.row.seed_id, providerEvidence, {
        source: 'run-mechanism-seed-provider-backfill',
        collectionKind: 'operator_mechanism_seed_provider',
        providers: result.target?.providers || item.closure.providerBackfillPlan.providers,
        providerRunStatus: providerRunStatus(result.results),
      }, item.target.desiredEvidenceClasses);
      applied.push({
        seedId: item.row.seed_id,
        providerRunStatus: providerRunStatus(result.results),
        providers: result.target?.providers || [],
        providerEvidence,
        outcomeCount: outcomeResults.filter((row) => row?.ok).length,
      });
    }

    return {
      ok: true,
      dryRun: false,
      targetCount: candidates.length,
      applied,
      boundaries: {
        approvalQueueWrites: 0,
        reportBackfillWrites: 0,
        canonicalWrites: 0,
        sourceRegistryWrites: 0,
        providerActivationWrites: 0,
      },
    };
  });
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
  const options = parseMechanismSeedProviderBackfillArgs();
  if (options.help) {
    process.stdout.write(helpText());
  } else {
    runMechanismSeedProviderBackfill(options)
      .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
