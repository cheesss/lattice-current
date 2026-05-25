export const OPERATOR_SEED_BIAS_STORAGE_VERSION = 'operator-seed-bias-storage-v1';

export const OPERATOR_SEED_BIAS_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS operator_research_seed_bias_runs (
      run_id TEXT PRIMARY KEY,
      verdict TEXT NOT NULL DEFAULT '',
      seed_count INTEGER NOT NULL DEFAULT 0,
      dominant_class TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_operator_seed_bias_runs_generated_at
      ON operator_research_seed_bias_runs (generated_at DESC)
  `,
  `
    CREATE TABLE IF NOT EXISTS operator_research_seed_backfill_tasks (
      task_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL DEFAULT '',
      seed_id TEXT,
      evidence_class TEXT NOT NULL DEFAULT '',
      provider_route TEXT NOT NULL DEFAULT '',
      source_query TEXT NOT NULL DEFAULT '',
      acceptance_criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'queued',
      mutation_boundary JSONB NOT NULL DEFAULT '{}'::jsonb,
      review_required BOOLEAN NOT NULL DEFAULT TRUE,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_operator_seed_backfill_tasks_status
      ON operator_research_seed_backfill_tasks (status, evidence_class, created_at DESC)
  `,
  `
    CREATE TABLE IF NOT EXISTS operator_research_seed_evidence_raw (
      evidence_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL DEFAULT '',
      task_id TEXT,
      seed_id TEXT,
      evidence_class TEXT NOT NULL DEFAULT '',
      accepted BOOLEAN NOT NULL DEFAULT FALSE,
      acceptance_verdict TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_operator_seed_evidence_raw_seed_class
      ON operator_research_seed_evidence_raw (seed_id, evidence_class, created_at DESC)
  `,
  `
    CREATE TABLE IF NOT EXISTS operator_research_seed_evidence_accepted (
      evidence_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL DEFAULT '',
      task_id TEXT,
      seed_id TEXT,
      evidence_class TEXT NOT NULL DEFAULT '',
      evidence_use TEXT NOT NULL DEFAULT '',
      covered_evidence_classes TEXT[] NOT NULL DEFAULT '{}'::text[],
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_operator_seed_evidence_accepted_seed_class
      ON operator_research_seed_evidence_accepted (seed_id, evidence_class, created_at DESC)
  `,
  `
    CREATE TABLE IF NOT EXISTS operator_research_seed_holdout_results (
      result_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL DEFAULT '',
      seed_id TEXT,
      holdout_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
      confirmation_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_operator_seed_holdout_results_seed
      ON operator_research_seed_holdout_results (seed_id, created_at DESC)
  `,
  `
    CREATE TABLE IF NOT EXISTS operator_research_seed_negative_controls (
      result_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL DEFAULT '',
      seed_id TEXT,
      survival_status TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_operator_seed_negative_controls_seed
      ON operator_research_seed_negative_controls (seed_id, survival_status, created_at DESC)
  `,
];

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stableResultId(prefix = 'result', runId = '', seedId = '', suffix = '') {
  return [prefix, runId, seedId || 'batch', suffix || 'default'].map((part) => compact(part).replace(/[^a-zA-Z0-9_.:-]+/g, '-')).join(':');
}

function json(value = {}) {
  return JSON.stringify(value || {});
}

export async function ensureOperatorSeedBiasSchema(queryable) {
  for (const statement of OPERATOR_SEED_BIAS_SCHEMA_STATEMENTS) {
    await queryable.query(statement);
  }
  return { ok: true, statementCount: OPERATOR_SEED_BIAS_SCHEMA_STATEMENTS.length };
}

export async function persistOperatorSeedBiasRun(client, {
  runId,
  diagnosis = {},
  seedBatch = {},
  payload = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!runId) throw new Error('operator seed bias run requires runId');
  const counts = diagnosis.classDistribution?.counts || {};
  const dominantClass = Object.entries(counts).sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))[0]?.[0] || '';
  await client.query(`
    INSERT INTO operator_research_seed_bias_runs (
      run_id,
      verdict,
      seed_count,
      dominant_class,
      payload,
      generated_at
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
    ON CONFLICT (run_id) DO UPDATE SET
      verdict = EXCLUDED.verdict,
      seed_count = EXCLUDED.seed_count,
      dominant_class = EXCLUDED.dominant_class,
      payload = EXCLUDED.payload,
      generated_at = EXCLUDED.generated_at
  `, [
    runId,
    compact(diagnosis.verdict),
    Number(seedBatch.seedCount || diagnosis.classDistribution?.total || 0),
    dominantClass,
    json(payload || diagnosis),
    generatedAt,
  ]);
  return { ok: true, insertedOrUpdated: 1 };
}

export async function persistOperatorSeedBackfillTasks(client, runId, tasks = []) {
  let count = 0;
  for (const task of asArray(tasks)) {
    if (!task.taskId) continue;
    await client.query(`
      INSERT INTO operator_research_seed_backfill_tasks (
        task_id,
        run_id,
        seed_id,
        evidence_class,
        provider_route,
        source_query,
        acceptance_criteria,
        status,
        mutation_boundary,
        review_required,
        payload,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11::jsonb, COALESCE($12::timestamptz, NOW()))
      ON CONFLICT (task_id) DO UPDATE SET
        run_id = EXCLUDED.run_id,
        seed_id = EXCLUDED.seed_id,
        evidence_class = EXCLUDED.evidence_class,
        provider_route = EXCLUDED.provider_route,
        source_query = EXCLUDED.source_query,
        acceptance_criteria = EXCLUDED.acceptance_criteria,
        status = EXCLUDED.status,
        mutation_boundary = EXCLUDED.mutation_boundary,
        review_required = EXCLUDED.review_required,
        payload = EXCLUDED.payload
    `, [
      task.taskId,
      runId,
      task.seedId || task.operatorSeedId || null,
      compact(task.evidenceClass),
      compact(task.providerRoute),
      compact(task.sourceQuery || task.sourceQueryDrafts?.[0]?.query),
      json(task.acceptanceCriteria || {}),
      compact(task.status || 'queued'),
      json(task.mutationBoundary || {}),
      task.reviewRequired !== false,
      json(task),
      task.createdAt || null,
    ]);
    count += 1;
  }
  return { ok: true, count };
}

export async function persistOperatorSeedRawEvidence(client, runId, rawEvidence = []) {
  let count = 0;
  for (const row of asArray(rawEvidence)) {
    const evidenceId = compact(row.evidenceId || row.id);
    if (!evidenceId) continue;
    await client.query(`
      INSERT INTO operator_research_seed_evidence_raw (
        evidence_id,
        run_id,
        task_id,
        seed_id,
        evidence_class,
        accepted,
        acceptance_verdict,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      ON CONFLICT (evidence_id) DO UPDATE SET
        run_id = EXCLUDED.run_id,
        task_id = EXCLUDED.task_id,
        seed_id = EXCLUDED.seed_id,
        evidence_class = EXCLUDED.evidence_class,
        accepted = EXCLUDED.accepted,
        acceptance_verdict = EXCLUDED.acceptance_verdict,
        payload = EXCLUDED.payload
    `, [
      evidenceId,
      runId,
      row.taskId || null,
      row.seedId || row.operatorSeedId || null,
      compact(row.evidenceClass || row.desiredEvidenceClass),
      Boolean(row.accepted),
      compact(row.acceptanceVerdict),
      json(row),
    ]);
    count += 1;
  }
  return { ok: true, count };
}

export async function persistOperatorSeedAcceptedEvidence(client, runId, acceptedEvidence = []) {
  let count = 0;
  for (const row of asArray(acceptedEvidence)) {
    const evidenceId = compact(row.evidenceId || row.id);
    if (!evidenceId) continue;
    await client.query(`
      INSERT INTO operator_research_seed_evidence_accepted (
        evidence_id,
        run_id,
        task_id,
        seed_id,
        evidence_class,
        evidence_use,
        covered_evidence_classes,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8::jsonb)
      ON CONFLICT (evidence_id) DO UPDATE SET
        run_id = EXCLUDED.run_id,
        task_id = EXCLUDED.task_id,
        seed_id = EXCLUDED.seed_id,
        evidence_class = EXCLUDED.evidence_class,
        evidence_use = EXCLUDED.evidence_use,
        covered_evidence_classes = EXCLUDED.covered_evidence_classes,
        payload = EXCLUDED.payload
    `, [
      evidenceId,
      runId,
      row.taskId || null,
      row.seedId || row.operatorSeedId || null,
      compact(row.evidenceClass || row.desiredEvidenceClass),
      compact(row.evidenceUse || row.evidence_use),
      asArray(row.coveredEvidenceClasses).map(compact).filter(Boolean),
      json(row),
    ]);
    count += 1;
  }
  return { ok: true, count };
}

export async function persistOperatorSeedHoldoutResults(client, runId, holdoutValidation = {}) {
  let count = 0;
  for (const row of asArray(holdoutValidation.items)) {
    const resultId = row.resultId || stableResultId('holdout', runId, row.seedId, row.holdoutSourceGroup);
    await client.query(`
      INSERT INTO operator_research_seed_holdout_results (
        result_id,
        run_id,
        seed_id,
        holdout_confirmed,
        confirmation_rate,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT (result_id) DO UPDATE SET
        run_id = EXCLUDED.run_id,
        seed_id = EXCLUDED.seed_id,
        holdout_confirmed = EXCLUDED.holdout_confirmed,
        confirmation_rate = EXCLUDED.confirmation_rate,
        payload = EXCLUDED.payload
    `, [
      resultId,
      runId,
      row.seedId || null,
      Boolean(row.holdoutConfirmed || row.confirmed),
      Number(row.holdoutConfirmationRate ?? row.confirmationRate ?? 0),
      json(row),
    ]);
    count += 1;
  }
  return { ok: true, count };
}

export async function persistOperatorSeedNegativeControls(client, runId, negativeControlSurvival = {}) {
  let count = 0;
  for (const row of asArray(negativeControlSurvival.items)) {
    const resultId = row.resultId || stableResultId('negative-control', runId, row.seedId, row.survivalStatus);
    await client.query(`
      INSERT INTO operator_research_seed_negative_controls (
        result_id,
        run_id,
        seed_id,
        survival_status,
        payload
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (result_id) DO UPDATE SET
        run_id = EXCLUDED.run_id,
        seed_id = EXCLUDED.seed_id,
        survival_status = EXCLUDED.survival_status,
        payload = EXCLUDED.payload
    `, [
      resultId,
      runId,
      row.seedId || null,
      compact(row.survivalStatus),
      json(row),
    ]);
    count += 1;
  }
  return { ok: true, count };
}

export async function persistOperatorSeedBiasArtifacts(client, {
  runId,
  diagnosis = {},
  seedBatch = {},
  backfillPlan = {},
  backfillResults = {},
  holdoutValidation = {},
  negativeControlSurvival = {},
  payload = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  await ensureOperatorSeedBiasSchema(client);
  const run = await persistOperatorSeedBiasRun(client, { runId, diagnosis, seedBatch, payload, generatedAt });
  const tasks = await persistOperatorSeedBackfillTasks(client, runId, backfillPlan.tasks || []);
  const raw = await persistOperatorSeedRawEvidence(client, runId, backfillResults.rawEvidence || []);
  const accepted = await persistOperatorSeedAcceptedEvidence(client, runId, backfillResults.acceptedEvidence || []);
  const holdout = await persistOperatorSeedHoldoutResults(client, runId, holdoutValidation);
  const negative = await persistOperatorSeedNegativeControls(client, runId, negativeControlSurvival);
  return {
    ok: true,
    run,
    tasks,
    raw,
    accepted,
    holdout,
    negative,
    dbWrites: run.insertedOrUpdated + tasks.count + raw.count + accepted.count + holdout.count + negative.count,
  };
}

export async function loadLatestOperatorSeedBiasRun(client, { runId = '' } = {}) {
  const result = runId
    ? await client.query(`
      SELECT run_id, verdict, seed_count, dominant_class, payload, generated_at
      FROM operator_research_seed_bias_runs
      WHERE run_id = $1
      LIMIT 1
    `, [runId])
    : await client.query(`
      SELECT run_id, verdict, seed_count, dominant_class, payload, generated_at
      FROM operator_research_seed_bias_runs
      ORDER BY generated_at DESC, created_at DESC
      LIMIT 1
    `);
  return result.rows?.[0] || null;
}

export async function loadOperatorSeedBiasBackfillTasks(client, {
  runId,
  seedId = '',
  evidenceClasses = [],
} = {}) {
  if (!runId) throw new Error('loadOperatorSeedBiasBackfillTasks requires runId');
  const classes = asArray(evidenceClasses).map(compact).filter(Boolean);
  const values = [runId];
  const predicates = ['run_id = $1'];
  if (seedId) {
    values.push(seedId);
    predicates.push(`seed_id = $${values.length}`);
  }
  if (classes.length) {
    values.push(classes);
    predicates.push(`evidence_class = ANY($${values.length}::text[])`);
  }
  const result = await client.query(`
    SELECT
      task_id,
      run_id,
      seed_id,
      evidence_class,
      provider_route,
      source_query,
      acceptance_criteria,
      status,
      mutation_boundary,
      review_required,
      payload,
      created_at
    FROM operator_research_seed_backfill_tasks
    WHERE ${predicates.join(' AND ')}
    ORDER BY created_at ASC, evidence_class ASC
  `, values);
  return result.rows || [];
}

export async function loadOperatorSeedBiasRawEvidence(client, {
  runId,
  seedId = '',
  evidenceClasses = [],
} = {}) {
  if (!runId) throw new Error('loadOperatorSeedBiasRawEvidence requires runId');
  const classes = asArray(evidenceClasses).map(compact).filter(Boolean);
  const values = [runId];
  const predicates = ['run_id = $1'];
  if (seedId) {
    values.push(seedId);
    predicates.push(`seed_id = $${values.length}`);
  }
  if (classes.length) {
    values.push(classes);
    predicates.push(`evidence_class = ANY($${values.length}::text[])`);
  }
  const result = await client.query(`
    SELECT evidence_id, run_id, task_id, seed_id, evidence_class, accepted, acceptance_verdict, payload, created_at
    FROM operator_research_seed_evidence_raw
    WHERE ${predicates.join(' AND ')}
    ORDER BY created_at ASC
  `, values);
  return result.rows || [];
}

export async function loadOperatorSeedBiasAcceptedEvidence(client, {
  runId,
  seedId = '',
  evidenceClasses = [],
} = {}) {
  if (!runId) throw new Error('loadOperatorSeedBiasAcceptedEvidence requires runId');
  const classes = asArray(evidenceClasses).map(compact).filter(Boolean);
  const values = [runId];
  const predicates = ['run_id = $1'];
  if (seedId) {
    values.push(seedId);
    predicates.push(`seed_id = $${values.length}`);
  }
  if (classes.length) {
    values.push(classes);
    predicates.push(`evidence_class = ANY($${values.length}::text[])`);
  }
  const result = await client.query(`
    SELECT evidence_id, run_id, task_id, seed_id, evidence_class, evidence_use, covered_evidence_classes, payload, created_at
    FROM operator_research_seed_evidence_accepted
    WHERE ${predicates.join(' AND ')}
    ORDER BY created_at ASC
  `, values);
  return result.rows || [];
}
