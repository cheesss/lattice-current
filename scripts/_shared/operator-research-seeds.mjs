import crypto from 'node:crypto';

import { buildRouteAwareSeedEvidencePlan } from './seed-evidence-plan.mjs';
import { summarizeOperatorSeedClosure } from './operator-seed-closure.mjs';

export const OPERATOR_RESEARCH_SEED_STATUSES = Object.freeze([
  'draft',
  'needs_evidence',
  'evidence_running',
  'review_ready',
  'rejected',
  'promoted',
  'report_candidate',
  'report_generated',
  'exhausted',
]);

const PROTECTED_REVIEW_STATUSES = Object.freeze([
  'rejected',
  'promoted',
  'report_candidate',
  'report_generated',
  'exhausted',
]);

export const OPERATOR_RESEARCH_SEED_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS operator_research_seeds (
      id BIGSERIAL PRIMARY KEY,
      seed_id TEXT NOT NULL UNIQUE,
      seed_key TEXT NOT NULL,
      seed_title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      theme_key TEXT NOT NULL DEFAULT '',
      theme_label TEXT NOT NULL DEFAULT '',
      seed_hash TEXT NOT NULL DEFAULT '',
      seed_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      scores JSONB NOT NULL DEFAULT '{}'::jsonb,
      bias_audit JSONB NOT NULL DEFAULT '{}'::jsonb,
      provider_gaps TEXT[] NOT NULL DEFAULT '{}'::text[],
      evidence_plan JSONB NOT NULL DEFAULT '{}'::jsonb,
      lineage JSONB NOT NULL DEFAULT '{}'::jsonb,
      review_state JSONB NOT NULL DEFAULT '{}'::jsonb,
      latest_report_id TEXT,
      last_evidence_run_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    DO $$
    BEGIN
      ALTER TABLE operator_research_seeds DROP CONSTRAINT IF EXISTS operator_research_seeds_status_check;
      ALTER TABLE operator_research_seeds
        ADD CONSTRAINT operator_research_seeds_status_check
        CHECK (status IN (
          'draft',
          'needs_evidence',
          'evidence_running',
          'review_ready',
          'rejected',
          'promoted',
          'report_candidate',
          'report_generated',
          'exhausted'
        ));
    END
    $$;
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_operator_research_seeds_status_score
      ON operator_research_seeds (
        status,
        ((scores->>'composite_seed_score')::double precision) DESC,
        updated_at DESC
      )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_operator_research_seeds_theme_status
      ON operator_research_seeds (theme_key, status, updated_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_operator_research_seeds_provider_gaps
      ON operator_research_seeds USING GIN (provider_gaps)
  `,
  `
    CREATE TABLE IF NOT EXISTS operator_research_seed_runs (
      id BIGSERIAL PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'apply',
      source TEXT NOT NULL DEFAULT 'all',
      artifact_path TEXT,
      options JSONB NOT NULL DEFAULT '{}'::jsonb,
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      seed_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_operator_research_seed_runs_time
      ON operator_research_seed_runs (started_at DESC)
  `,
];

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function uniqueStrings(values = [], limit = 80) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
    const text = String(value || '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashOperatorResearchSeed(seed = {}) {
  const semanticSeed = {
    ...seed,
    lineage: {
      ...(seed.lineage || {}),
      generatedAt: undefined,
    },
  };
  return crypto.createHash('sha256').update(stableJson(semanticSeed)).digest('hex');
}

function normalizeStatus(status = 'draft') {
  const text = String(status || 'draft').trim();
  return OPERATOR_RESEARCH_SEED_STATUSES.includes(text) ? text : 'draft';
}

function normalizeSeedRow(seed = {}) {
  if (!seed.seedId) throw new Error('operator research seed requires seedId');
  const evidencePlan = buildRouteAwareSeedEvidencePlan(seed);
  return {
    seedId: String(seed.seedId),
    seedKey: String(seed.seedKey || seed.seedId),
    seedTitle: String(seed.seedTitle || seed.bottleneck?.label || seed.theme?.label || seed.seedId),
    status: normalizeStatus(seed.status),
    themeKey: String(seed.theme?.key || ''),
    themeLabel: String(seed.theme?.label || ''),
    seedHash: hashOperatorResearchSeed({ ...seed, evidencePlan }),
    seedJson: seed,
    scores: seed.scores || {},
    biasAudit: seed.biasAudit || {},
    providerGaps: uniqueStrings(seed.providerGaps || seed.biasAudit?.provider_gap_labels || [], 80),
    evidencePlan,
    lineage: seed.lineage || {},
  };
}

export async function ensureOperatorResearchSeedSchema(queryable) {
  for (const statement of OPERATOR_RESEARCH_SEED_SCHEMA_STATEMENTS) {
    await queryable.query(statement);
  }
  return { ok: true, statementCount: OPERATOR_RESEARCH_SEED_SCHEMA_STATEMENTS.length };
}

async function existingSeedHash(client, seedId) {
  const result = await client.query(
    'SELECT seed_id, seed_hash, status FROM operator_research_seeds WHERE seed_id = $1',
    [seedId],
  );
  return result.rows?.[0] || null;
}

async function persistSeedRow(client, row) {
  const protectedStatuses = PROTECTED_REVIEW_STATUSES;
  const result = await client.query(`
    INSERT INTO operator_research_seeds (
      seed_id,
      seed_key,
      seed_title,
      status,
      theme_key,
      theme_label,
      seed_hash,
      seed_json,
      scores,
      bias_audit,
      provider_gaps,
      evidence_plan,
      lineage,
      updated_at
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8::jsonb,
      $9::jsonb,
      $10::jsonb,
      $11::text[],
      $12::jsonb,
      $13::jsonb,
      NOW()
    )
    ON CONFLICT (seed_id) DO UPDATE SET
      seed_key = EXCLUDED.seed_key,
      seed_title = EXCLUDED.seed_title,
      status = CASE
        WHEN operator_research_seeds.status = ANY($14::text[]) THEN operator_research_seeds.status
        ELSE EXCLUDED.status
      END,
      theme_key = EXCLUDED.theme_key,
      theme_label = EXCLUDED.theme_label,
      seed_hash = EXCLUDED.seed_hash,
      seed_json = EXCLUDED.seed_json,
      scores = EXCLUDED.scores,
      bias_audit = EXCLUDED.bias_audit,
      provider_gaps = EXCLUDED.provider_gaps,
      evidence_plan = EXCLUDED.evidence_plan
        || CASE
             WHEN operator_research_seeds.evidence_plan ? 'latestOutcome'
             THEN jsonb_build_object('latestOutcome', operator_research_seeds.evidence_plan->'latestOutcome')
             ELSE '{}'::jsonb
           END
        || CASE
             WHEN operator_research_seeds.evidence_plan ? 'outcomeCounts'
             THEN jsonb_build_object('outcomeCounts', operator_research_seeds.evidence_plan->'outcomeCounts')
             ELSE '{}'::jsonb
           END
        || CASE
             WHEN operator_research_seeds.evidence_plan ? 'outcomeLedger'
             THEN jsonb_build_object('outcomeLedger', operator_research_seeds.evidence_plan->'outcomeLedger')
             ELSE '{}'::jsonb
           END,
      lineage = EXCLUDED.lineage,
      updated_at = NOW()
    RETURNING seed_id, status, seed_hash
  `, [
    row.seedId,
    row.seedKey,
    row.seedTitle,
    row.status,
    row.themeKey,
    row.themeLabel,
    row.seedHash,
    JSON.stringify(row.seedJson),
    JSON.stringify(row.scores),
    JSON.stringify(row.biasAudit),
    row.providerGaps,
    JSON.stringify(row.evidencePlan),
    JSON.stringify(row.lineage),
    protectedStatuses,
  ]);
  return result.rows?.[0] || null;
}

async function recordOperatorResearchSeedRun(client, runContext = {}, summary = {}, seedIds = []) {
  const result = await client.query(`
    INSERT INTO operator_research_seed_runs (
      mode,
      source,
      artifact_path,
      options,
      summary,
      seed_ids,
      finished_at
    )
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::text[], NOW())
    RETURNING id
  `, [
    runContext.mode || 'apply',
    runContext.source || 'all',
    runContext.artifactPath || null,
    JSON.stringify(runContext.options || {}),
    JSON.stringify(summary || {}),
    uniqueStrings(seedIds, 500),
  ]);
  return result.rows?.[0]?.id || null;
}

export async function upsertOperatorResearchSeeds(client, seeds = [], runContext = {}) {
  const insertedRows = [];
  const updatedRows = [];
  const unchangedRows = [];
  const skippedRows = [];

  for (const seed of asArray(seeds)) {
    let row;
    try {
      row = normalizeSeedRow(seed);
    } catch (error) {
      skippedRows.push({ seedId: seed?.seedId || null, reason: String(error?.message || error) });
      continue;
    }
    const existing = await existingSeedHash(client, row.seedId);
    if (existing?.seed_hash === row.seedHash) {
      unchangedRows.push({ seedId: row.seedId, status: existing.status || row.status });
      continue;
    }
    const persisted = await persistSeedRow(client, row);
    if (existing) updatedRows.push(persisted || { seedId: row.seedId, status: row.status });
    else insertedRows.push(persisted || { seedId: row.seedId, status: row.status });
  }

  const summary = {
    ok: true,
    inserted: insertedRows.length,
    updated: updatedRows.length,
    unchanged: unchangedRows.length,
    skipped: skippedRows.length,
    runLedgerWrites: 1,
    dbWrites: insertedRows.length + updatedRows.length + 1,
    approvalQueueWrites: 0,
    reportBackfillWrites: 0,
    canonicalWrites: 0,
    sourceRegistryWrites: 0,
    providerActivationWrites: 0,
  };
  const runId = await recordOperatorResearchSeedRun(
    client,
    runContext,
    summary,
    [...insertedRows, ...updatedRows, ...unchangedRows].map((row) => row.seed_id || row.seedId),
  );
  return {
    ...summary,
    runId,
    insertedRows,
    updatedRows,
    unchangedRows,
    skippedRows,
  };
}

export async function loadOperatorResearchSeeds(client, filters = {}) {
  const clauses = [];
  const values = [];
  const add = (clause, value) => {
    values.push(value);
    clauses.push(clause.replace('?', `$${values.length}`));
  };
  const statuses = uniqueStrings(filters.statuses || filters.status || [], 20).filter((status) => OPERATOR_RESEARCH_SEED_STATUSES.includes(status));
  if (statuses.length) add('status = ANY(?::text[])', statuses);
  const seedIds = uniqueStrings([filters.seedId, filters.seedIds], 100);
  if (seedIds.length) add('seed_id = ANY(?::text[])', seedIds);
  if (filters.themeKey) add('theme_key = ?', String(filters.themeKey));
  if (Number.isFinite(Number(filters.minScore))) add("(scores->>'composite_seed_score')::double precision >= ?", Number(filters.minScore));
  if (filters.providerGap) add('? = ANY(provider_gaps)', String(filters.providerGap));
  const limit = Math.max(1, Math.min(500, Number(filters.limit || 50)));
  values.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await client.query(`
    SELECT seed_id, seed_key, seed_title, status, theme_key, theme_label,
           seed_json, scores, bias_audit, provider_gaps, evidence_plan,
           lineage, review_state, latest_report_id, last_evidence_run_at,
           created_at, updated_at
      FROM operator_research_seeds
      ${where}
     ORDER BY (scores->>'composite_seed_score')::double precision DESC NULLS LAST,
              updated_at DESC
     LIMIT $${values.length}
  `, values);
  return result.rows || [];
}

export async function reviewOperatorResearchSeed(client, {
  seedId,
  status,
  reason = '',
  reviewer = 'operator',
  metadata = {},
} = {}) {
  if (!seedId) throw new Error('reviewOperatorResearchSeed requires seedId');
  const normalizedStatus = normalizeStatus(status);
  if (normalizedStatus !== status) throw new Error(`unsupported operator research seed status: ${status}`);
  const reviewEvent = {
    status: normalizedStatus,
    reason: String(reason || ''),
    reviewer: String(reviewer || 'operator'),
    reviewedAt: new Date().toISOString(),
    metadata: metadata || {},
  };
  const result = await client.query(`
    UPDATE operator_research_seeds
       SET status = $2,
           review_state = jsonb_build_object(
             'latest',
             $3::jsonb,
             'history',
             COALESCE(review_state->'history', '[]'::jsonb) || jsonb_build_array($3::jsonb)
           ),
           updated_at = NOW()
     WHERE seed_id = $1
     RETURNING seed_id, status, review_state, updated_at
  `, [String(seedId), normalizedStatus, JSON.stringify(reviewEvent)]);
  if (!result.rows?.length) {
    return { ok: false, seedId, status: 'not_found' };
  }
  return { ok: true, row: result.rows[0] };
}

function outcomeStatusFromCounts(outcome = {}) {
  if (outcome.negativeControlClosure === 'invalidator' || outcome.negativeControlFinding === 'invalidator') return 'negative_control_candidate';
  if (outcome.negativeControlClosure === 'supported_constraint' || outcome.negativeControlFinding === 'supported_constraint') return 'negative_control_candidate';
  if (Number(outcome.promotionBundleCount || 0) > 0 || Number(outcome.acceptedBundleCount || 0) > 0) return 'promotion_candidate';
  if (Number(outcome.negativeControlCount || 0) > 0) return 'negative_control_candidate';
  if (Number(outcome.contextBundleCount || 0) > 0) return 'supporting_context';
  if (Number(outcome.noiseCount || 0) > 0 || Number(outcome.persistedBundleCount || 0) > 0) return 'weak_noise';
  if (String(outcome.status || '') === 'needs-fix') return 'needs_fix';
  return 'rejected';
}

function nextSeedStatusForOutcome(currentStatus = '', outcome = {}) {
  if (PROTECTED_REVIEW_STATUSES.includes(String(currentStatus || ''))) return currentStatus;
  const outcomeTier = outcomeStatusFromCounts(outcome);
  const failureCategory = String(outcome.failureCategory || '');
  if (String(currentStatus || '') === 'review_ready' && !['promotion_candidate', 'supporting_context', 'negative_control_candidate'].includes(outcomeTier)) {
    return 'review_ready';
  }
  if (outcomeTier === 'promotion_candidate' || outcomeTier === 'supporting_context' || outcomeTier === 'negative_control_candidate') {
    return 'review_ready';
  }
  if (failureCategory === 'no-results' || failureCategory === 'source-fetch-failed' || String(outcome.status || '') === 'needs-fix') {
    return 'needs_evidence';
  }
  return 'needs_evidence';
}

export async function recordOperatorSeedEvidenceOutcome(client, {
  seedId,
  approvalId = null,
  evidenceClass = '',
  query = '',
  status = '',
  failureCategory = '',
  collectedCount = 0,
  externalCollectedCount = 0,
  acceptedBundleCount = 0,
  persistedBundleCount = 0,
  promotionBundleCount = 0,
  contextBundleCount = 0,
  negativeControlCount = 0,
  negativeControlFinding = null,
  negativeControlClosure = null,
  negativeControlFindingCounts = {},
  noiseCount = 0,
  sourceQueryFailure = null,
  metadata = {},
} = {}) {
  const normalizedSeedId = String(seedId || '').trim();
  if (!normalizedSeedId) return { ok: false, skipped: true, reason: 'missing-operator-seed-id' };
  const outcome = {
    approvalId: approvalId ? String(approvalId) : null,
    evidenceClass: String(evidenceClass || ''),
    query: String(query || '').slice(0, 600),
    status: String(status || ''),
    failureCategory: String(failureCategory || ''),
    collectedCount: Number(collectedCount || 0),
    externalCollectedCount: Number(externalCollectedCount || 0),
    acceptedBundleCount: Number(acceptedBundleCount || 0),
    persistedBundleCount: Number(persistedBundleCount || 0),
    promotionBundleCount: Number(promotionBundleCount || 0),
    contextBundleCount: Number(contextBundleCount || 0),
    negativeControlCount: Number(negativeControlCount || 0),
    negativeControlFinding: negativeControlFinding || null,
    negativeControlClosure: negativeControlClosure || null,
    negativeControlFindingCounts: negativeControlFindingCounts || {},
    noiseCount: Number(noiseCount || 0),
    outcomeTier: outcomeStatusFromCounts({
      status,
      acceptedBundleCount,
      persistedBundleCount,
      promotionBundleCount,
      contextBundleCount,
      negativeControlCount,
      negativeControlFinding,
      negativeControlClosure,
      noiseCount,
    }),
    sourceQueryFailure,
    metadata,
    recordedAt: new Date().toISOString(),
  };
  const current = await client.query(
    'SELECT status, evidence_plan, review_state FROM operator_research_seeds WHERE seed_id = $1',
    [normalizedSeedId],
  );
  const row = current.rows?.[0];
  if (!row) return { ok: false, skipped: true, reason: 'operator-seed-not-found', seedId: normalizedSeedId };
  const nextStatus = nextSeedStatusForOutcome(row.status, outcome);
  const result = await client.query(`
    UPDATE operator_research_seeds
       SET status = $2,
           evidence_plan = COALESCE(evidence_plan, '{}'::jsonb)
             || jsonb_build_object(
               'latestOutcome',
               $3::jsonb,
               'outcomeCounts',
               jsonb_build_object(
                 'promotion_candidate', COALESCE((evidence_plan->'outcomeCounts'->>'promotion_candidate')::int, 0) + CASE WHEN $4 = 'promotion_candidate' THEN 1 ELSE 0 END,
                 'supporting_context', COALESCE((evidence_plan->'outcomeCounts'->>'supporting_context')::int, 0) + CASE WHEN $4 = 'supporting_context' THEN 1 ELSE 0 END,
                 'negative_control_candidate', COALESCE((evidence_plan->'outcomeCounts'->>'negative_control_candidate')::int, 0) + CASE WHEN $4 = 'negative_control_candidate' THEN 1 ELSE 0 END,
                 'weak_noise', COALESCE((evidence_plan->'outcomeCounts'->>'weak_noise')::int, 0) + CASE WHEN $4 = 'weak_noise' THEN 1 ELSE 0 END,
                 'needs_fix', COALESCE((evidence_plan->'outcomeCounts'->>'needs_fix')::int, 0) + CASE WHEN $4 = 'needs_fix' THEN 1 ELSE 0 END,
                 'rejected', COALESCE((evidence_plan->'outcomeCounts'->>'rejected')::int, 0) + CASE WHEN $4 = 'rejected' THEN 1 ELSE 0 END
               ),
               'outcomeLedger',
               COALESCE(evidence_plan->'outcomeLedger', '[]'::jsonb) || jsonb_build_array($3::jsonb)
             ),
           review_state = COALESCE(review_state, '{}'::jsonb)
             || jsonb_build_object(
               'latestEvidenceOutcome',
               $3::jsonb,
               'evidenceOutcomeHistory',
               COALESCE(review_state->'evidenceOutcomeHistory', '[]'::jsonb) || jsonb_build_array($3::jsonb)
             ),
           last_evidence_run_at = NOW(),
           updated_at = NOW()
     WHERE seed_id = $1
     RETURNING seed_id, status, evidence_plan, review_state, updated_at
  `, [normalizedSeedId, nextStatus, JSON.stringify(outcome), outcome.outcomeTier]);
  return { ok: true, seedId: normalizedSeedId, status: nextStatus, outcome, row: result.rows?.[0] || null };
}

export async function summarizeOperatorResearchSeeds(client, filters = {}) {
  const rows = await loadOperatorResearchSeeds(client, { ...filters, limit: filters.limit || 500 });
  const statusCounts = {};
  const providerGapCounts = {};
  const themeCounts = {};
  const evidenceOutcomeCounts = {};
  const sourceQueryStatusCounts = {};
  const negativeControlStatusCounts = {};
  const providerBackfillStatusCounts = {};
  for (const row of rows) {
    statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    if (row.theme_key) themeCounts[row.theme_key] = (themeCounts[row.theme_key] || 0) + 1;
    for (const gap of row.provider_gaps || []) providerGapCounts[gap] = (providerGapCounts[gap] || 0) + 1;
    for (const [key, value] of Object.entries(row.evidence_plan?.outcomeCounts || {})) {
      evidenceOutcomeCounts[key] = (evidenceOutcomeCounts[key] || 0) + Number(value || 0);
    }
    const latest = row.evidence_plan?.latestOutcome;
    if (latest?.status) sourceQueryStatusCounts[latest.status] = (sourceQueryStatusCounts[latest.status] || 0) + 1;
    const closure = summarizeOperatorSeedClosure(row);
    const negativeStatus = closure.negativeControl?.closure || closure.negativeControl?.status || 'unchecked';
    negativeControlStatusCounts[negativeStatus] = (negativeControlStatusCounts[negativeStatus] || 0) + 1;
    const providerStatus = closure.providerBackfillPlan?.status || 'unknown';
    providerBackfillStatusCounts[providerStatus] = (providerBackfillStatusCounts[providerStatus] || 0) + 1;
  }
  return {
    ok: true,
    total: rows.length,
    statusCounts,
    providerGapCounts,
    themeCounts,
    evidenceOutcomeCounts,
    sourceQueryStatusCounts,
    negativeControlStatusCounts,
    providerBackfillStatusCounts,
  };
}
