#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { ensureResearchOsSchema } from './_shared/adjacency-graph.mjs';
import { buildPolicyAdvisorProposals } from './_shared/policy-advisor.mjs';
import { loadResearchOsPolicy, getPolicyValue } from './_shared/research-os-policy.mjs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

const { Client } = pg;

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  return { dryRun: args.has('--dry-run') };
}

async function collectMetrics(client, policy) {
  const questions = await client.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE question_type <> 'user_interest')::int AS autonomous
     FROM research_questions
     WHERE status = 'new'`,
  );
  const candidates = await client.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE lane IN ('exploration','weird_but_rising','needs_evidence'))::int AS exploration,
       COUNT(*) FILTER (WHERE COALESCE((evidence_summary->>'seedSimilarity')::float8, 0) > 0)::int AS seed_similar
     FROM cross_theme_candidates
     WHERE status = 'new'`,
  );
  const candidateBacklog = await client.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE COALESCE((evidence_summary->>'seedSimilarity')::float8, 0) > 0)::int AS seed_similar
     FROM cross_theme_candidates
     WHERE status = 'research_backlog'`,
  );
  const feedback = await client.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE decision IN ('reject','rejected'))::int AS rejected
     FROM adjacency_feedback
     WHERE created_at >= NOW() - INTERVAL '30 days'`,
  );
  const questionRow = questions.rows[0] || {};
  const candidateRow = candidates.rows[0] || {};
  const backlogRow = candidateBacklog.rows[0] || {};
  const feedbackRow = feedback.rows[0] || {};
  const totalQuestions = Number(questionRow.total || 0);
  const totalCandidates = Number(candidateRow.total || 0);
  const totalFeedback = Number(feedbackRow.total || 0);
  return {
    autonomousQuestionRate: totalQuestions ? Number(questionRow.autonomous || 0) / totalQuestions : Number(getPolicyValue(policy, 'autonomousQuestionRateTarget')),
    explorationRate: totalCandidates ? Number(candidateRow.exploration || 0) / totalCandidates : Number(getPolicyValue(policy, 'explorationQuotaMin')),
    seedDependenceRatio: totalCandidates ? Number(candidateRow.seed_similar || 0) / totalCandidates : 0,
    humanRejectRate: totalFeedback ? Number(feedbackRow.rejected || 0) / totalFeedback : 0,
    sample: {
      researchQuestions: totalQuestions,
      crossThemeCandidates: totalCandidates,
      researchBacklogCandidates: Number(backlogRow.total || 0),
      backlogSeedDependenceRatio: Number(backlogRow.total || 0)
        ? Number(backlogRow.seed_similar || 0) / Number(backlogRow.total || 1)
        : 0,
      feedbackActions30d: totalFeedback,
    },
  };
}

async function upsertPolicyProposal(client, proposal) {
  const existing = await client.query(
    `SELECT id
       FROM research_os_policy_proposals
      WHERE policy_key = $1
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1`,
    [proposal.policyKey],
  );
  if (existing.rows[0]?.id) {
    await client.query(
      `UPDATE research_os_policy_proposals
          SET current_value = $2::jsonb,
              proposed_value = $3::jsonb,
              reason = $4,
              expected_effect = $5::jsonb,
              risk_summary = $6,
              rollback_rule = $7::jsonb
        WHERE id = $1`,
      [
        existing.rows[0].id,
        JSON.stringify(proposal.currentValue),
        JSON.stringify(proposal.proposedValue),
        proposal.reason,
        JSON.stringify(proposal.expectedEffect || {}),
        proposal.riskSummary || '',
        JSON.stringify(proposal.rollbackRule || {}),
      ],
    );
    return { id: existing.rows[0].id, deduped: true };
  }
  const { rows } = await client.query(
    `INSERT INTO research_os_policy_proposals (
       policy_key, current_value, proposed_value, reason, expected_effect,
       risk_summary, shadow_result, rollback_rule, status
     ) VALUES ($1,$2::jsonb,$3::jsonb,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb,'pending')
     RETURNING id`,
    [
      proposal.policyKey,
      JSON.stringify(proposal.currentValue),
      JSON.stringify(proposal.proposedValue),
      proposal.reason,
      JSON.stringify(proposal.expectedEffect || {}),
      proposal.riskSummary || '',
      JSON.stringify(proposal.shadowResult || {}),
      JSON.stringify(proposal.rollbackRule || {}),
    ],
  );
  return { id: rows[0].id, deduped: false };
}

export async function runProposeResearchOsPolicyChanges(options = {}) {
  loadOptionalEnvFile();
  const policy = loadResearchOsPolicy();
  const client = options.client || new Client(options.pgConfig || resolveNasPgConfig());
  const ownClient = !options.client;
  if (ownClient) await client.connect();
  try {
    await ensureResearchOsSchema(client);
    const metrics = await collectMetrics(client, policy);
    const advisor = buildPolicyAdvisorProposals(metrics, policy);
    const persisted = [];
    if (!options.dryRun) {
      for (const proposal of advisor.proposals) {
        persisted.push(await upsertPolicyProposal(client, proposal));
      }
    }
    return {
      ok: true,
      dryRun: Boolean(options.dryRun),
      metrics,
      proposalCount: advisor.proposals.length,
      proposals: advisor.proposals,
      persisted,
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
  runProposeResearchOsPolicyChanges(parseArgs())
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
