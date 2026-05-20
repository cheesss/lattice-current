#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import {
  ensureOperatorResearchSeedSchema,
  loadOperatorResearchSeeds,
  OPERATOR_RESEARCH_SEED_STATUSES,
  reviewOperatorResearchSeed,
  summarizeOperatorResearchSeeds,
} from './_shared/operator-research-seeds.mjs';
import { summarizeOperatorSeedClosure } from './_shared/operator-seed-closure.mjs';

const { Client } = pg;

export function parseMechanismSeedReviewArgs(argv = process.argv.slice(2)) {
  const out = {
    seedId: '',
    status: '',
    reason: '',
    reviewer: 'operator',
    list: false,
    summary: false,
    limit: 25,
    statuses: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--seed-id') out.seedId = next() || '';
    else if (arg === '--status') out.status = next() || '';
    else if (arg === '--reason') out.reason = next() || '';
    else if (arg === '--reviewer') out.reviewer = next() || out.reviewer;
    else if (arg === '--list') out.list = true;
    else if (arg === '--summary') out.summary = true;
    else if (arg === '--limit') out.limit = Number(next() || out.limit);
    else if (arg === '--statuses') out.statuses = String(next() || '').split(',').map((item) => item.trim()).filter(Boolean);
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--seed-id=')) out.seedId = arg.slice('--seed-id='.length);
    else if (arg.startsWith('--status=')) out.status = arg.slice('--status='.length);
    else if (arg.startsWith('--reason=')) out.reason = arg.slice('--reason='.length);
    else if (arg.startsWith('--reviewer=')) out.reviewer = arg.slice('--reviewer='.length);
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--statuses=')) out.statuses = arg.slice('--statuses='.length).split(',').map((item) => item.trim()).filter(Boolean);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function helpText() {
  return `Usage:
  node --import tsx scripts/review-mechanism-seed.mjs --list --statuses needs_evidence
  node --import tsx scripts/review-mechanism-seed.mjs --summary
  node --import tsx scripts/review-mechanism-seed.mjs --seed-id <id> --status review_ready --reason "direct evidence reviewed"

Allowed statuses:
  ${OPERATOR_RESEARCH_SEED_STATUSES.join(', ')}

This CLI only updates operator_research_seeds review metadata. It does not
enqueue evidence, write approval_queue, create reports, or mutate canonical
graph/source registry/provider state.
`;
}

async function withClient(options = {}, fn) {
  if (options.client) return fn(options.client);
  loadOptionalEnvFile();
  const client = new Client(resolveNasPgConfig(options.pg || {}));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function runMechanismSeedReview(options = {}) {
  return withClient(options, async (client) => {
    if (options.ensureSchema !== false) await ensureOperatorResearchSeedSchema(client);
    if (options.summary) {
      const summary = await summarizeOperatorResearchSeeds(client, { limit: options.limit || 500 });
      return { mode: 'summary', ...summary };
    }
    if (options.list) {
      const rows = await loadOperatorResearchSeeds(client, {
        statuses: options.statuses || [],
        limit: options.limit || 25,
      });
      return {
        mode: 'list',
        count: rows.length,
        rows: rows.map((row) => {
          const closure = summarizeOperatorSeedClosure(row);
          return {
            seedId: row.seed_id,
            title: row.seed_title,
            status: row.status,
            theme: row.theme_key,
            score: Number(row.scores?.composite_seed_score || 0),
            providerGaps: row.provider_gaps || [],
            evidenceOutcomes: row.evidence_plan?.outcomeCounts || {},
            negativeControl: closure.negativeControl,
            providerBackfill: {
              status: closure.providerBackfillPlan.status,
              providers: closure.providerBackfillPlan.providers,
              routeCount: closure.providerBackfillPlan.routeCount,
              nextAction: closure.providerBackfillPlan.nextAction,
            },
            evidenceState: closure.evidenceState,
            nextAction: closure.nextAction,
            latestEvidenceOutcome: row.evidence_plan?.latestOutcome
              ? {
                evidenceClass: row.evidence_plan.latestOutcome.evidenceClass || null,
                status: row.evidence_plan.latestOutcome.status || null,
                outcomeTier: row.evidence_plan.latestOutcome.outcomeTier || null,
                failureCategory: row.evidence_plan.latestOutcome.failureCategory || null,
                negativeControlClosure: row.evidence_plan.latestOutcome.negativeControlClosure || null,
              }
              : null,
            updatedAt: row.updated_at,
          };
        }),
      };
    }
    if (!options.seedId || !options.status) {
      throw new Error('--seed-id and --status are required unless --list or --summary is used');
    }
    const result = await reviewOperatorResearchSeed(client, {
      seedId: options.seedId,
      status: options.status,
      reason: options.reason,
      reviewer: options.reviewer,
    });
    return {
      mode: 'review',
      ...result,
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

async function main() {
  const options = parseMechanismSeedReviewArgs();
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const result = await runMechanismSeedReview(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
