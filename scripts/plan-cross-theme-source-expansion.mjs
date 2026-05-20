#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { planSourceExpansion } from './_shared/source-expansion-planner.mjs';
import { loadResearchOsPolicy, requirePolicyNumber } from './_shared/research-os-policy.mjs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

const { Client } = pg;

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const limitArg = argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1];
  return {
    dryRun: args.has('--dry-run'),
    limit: limitArg ? Number(limitArg) : undefined,
  };
}

async function loadCandidates(client, limit) {
  const { rows } = await client.query(
    `SELECT c.id,
            c.themes,
            c.score,
            c.lane,
            c.status,
            c.reason,
            c.evidence_summary,
            cn.canonical_name AS connector_name,
            sn.canonical_name AS supplier_name
       FROM cross_theme_candidates c
       LEFT JOIN knowledge_nodes cn ON cn.id = c.connector_node_id
       LEFT JOIN knowledge_nodes sn ON sn.id = c.supplier_node_id
      WHERE c.status IN ('new', 'research_backlog')
        AND c.lane = 'needs_evidence'
      ORDER BY c.score DESC NULLS LAST, c.updated_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: String(row.id),
    themes: row.themes || [],
    score: Number(row.score || 0),
    lane: row.lane,
    status: row.status,
    reason: row.reason,
    connector: row.connector_name,
    supplier: row.supplier_name,
    node: { canonicalName: row.connector_name || row.supplier_name || 'cross-theme candidate' },
    evidenceSummary: row.evidence_summary || {},
  }));
}

async function usedToday(client) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(amount), 0)::int AS used
       FROM automation_budget_log
      WHERE action = 'researchOsSourceExpansion'
        AND consumed_at >= NOW() - INTERVAL '1 day'`,
  );
  return Number(rows[0]?.used || 0);
}

async function queueSourceQuery(client, query, candidate) {
  const payload = {
    query: query.query,
    source: query.source,
    candidateId: candidate.id,
    themes: candidate.themes,
    connector: candidate.connector || null,
    supplier: candidate.supplier || null,
    reason: query.reason,
    approvalRequired: true,
  };
  const existing = await client.query(
    `SELECT id
       FROM approval_queue
      WHERE action_type = 'source-query'
        AND LOWER(payload->>'query') = LOWER($1)
        AND status IN ('pending', 'needs-fix')
      LIMIT 1`,
    [query.query],
  );
  if (existing.rows[0]?.id) return { id: existing.rows[0].id, deduped: true };
  const { rows } = await client.query(
    `INSERT INTO approval_queue (action_type, payload, status, reasoning)
     VALUES ('source-query', $1::jsonb, 'pending', $2)
     RETURNING id`,
    [JSON.stringify(payload), query.reason],
  );
  return { id: rows[0].id, deduped: false };
}

export async function runPlanCrossThemeSourceExpansion(options = {}) {
  loadOptionalEnvFile();
  const policy = loadResearchOsPolicy();
  const client = options.client || new Client(options.pgConfig || resolveNasPgConfig());
  const ownClient = !options.client;
  if (ownClient) await client.connect();
  try {
    const budgetLimit = requirePolicyNumber(policy, 'automation.sourceExpansionBudgetDaily');
    const used = await usedToday(client);
    const remaining = Math.max(0, budgetLimit - used);
    if (remaining <= 0) {
      return { ok: false, dryRun: Boolean(options.dryRun), reason: 'source expansion budget exhausted', used, budgetLimit };
    }
    const candidateLimit = Number(options.limit || requirePolicyNumber(policy, 'sourceExpansion.candidateLimitDefault'));
    const candidates = await loadCandidates(client, candidateLimit);
    const planned = planSourceExpansion(candidates, { policy });
    const queued = [];
    let budgetUsed = 0;
    const candidateById = new Map(candidates.map((item) => [String(item.id), item]));
    const maxQueriesInPlan = Math.max(0, ...planned.plans.map((plan) => plan.queries.length));
    for (let queryIndex = 0; queryIndex < maxQueriesInPlan; queryIndex += 1) {
      for (const plan of planned.plans) {
        if (budgetUsed >= remaining) break;
        const candidate = candidateById.get(String(plan.candidateId));
        const query = plan.queries[queryIndex];
        if (!candidate || !query) continue;
        if (options.dryRun) {
          queued.push({ dryRun: true, query: query.query, candidateId: candidate.id });
          budgetUsed += 1;
        } else {
          const queuedQuery = await queueSourceQuery(client, query, candidate);
          queued.push(queuedQuery);
          if (!queuedQuery.deduped) budgetUsed += 1;
        }
      }
      if (budgetUsed >= remaining) break;
    }
    if (!options.dryRun && budgetUsed > 0) {
      await client.query(
        `INSERT INTO automation_budget_log (action, amount, metadata)
         VALUES ('researchOsSourceExpansion', $1, $2::jsonb)`,
        [budgetUsed, JSON.stringify({ source: 'plan-cross-theme-source-expansion' })],
      );
    }
    return {
      ok: true,
      dryRun: Boolean(options.dryRun),
      candidateCount: candidates.length,
      planCount: planned.plans.length,
      queuedCount: queued.length,
      budget: { usedBefore: used, usedThisRun: budgetUsed, budgetLimit, remainingAfter: Math.max(0, remaining - budgetUsed) },
      queued,
    };
  } finally {
    if (ownClient) await client.end();
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
  runPlanCrossThemeSourceExpansion(parseArgs())
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
