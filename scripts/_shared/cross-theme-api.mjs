import { ensureResearchOsSchema } from './adjacency-graph.mjs';
import { upsertTrackedTarget } from './tracking-targets.mjs';
import { buildSourceExpansionQueries } from './source-expansion-planner.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { buildPolicyDiagnostics, loadResearchOsPolicy, requirePolicyNumber } from './research-os-policy.mjs';

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mapCandidateRow(row) {
  return {
    id: String(row.id),
    themes: Array.isArray(row.themes) ? row.themes : [],
    score: toNumber(row.score),
    lane: row.lane || 'exploration',
    status: row.status || 'new',
    reason: row.reason || '',
    connector: row.connector_id ? {
      id: String(row.connector_id),
      type: row.connector_type,
      name: row.connector_name,
      key: row.connector_key,
    } : null,
    supplier: row.supplier_id ? {
      id: String(row.supplier_id),
      type: row.supplier_type,
      name: row.supplier_name,
      key: row.supplier_key,
    } : null,
    evidenceSummary: row.evidence_summary || {},
    metadata: row.metadata || {},
    updatedAt: row.updated_at || row.created_at,
  };
}

function collectPathNodeIds(candidates) {
  return [...new Set(candidates.flatMap((candidate) => [
    ...(candidate.evidenceSummary?.leftPath || []),
    ...(candidate.evidenceSummary?.rightPath || []),
    candidate.connector?.id,
    candidate.supplier?.id,
  ]).filter(Boolean).map(String))];
}

async function attachCandidateContext(queryable, candidates) {
  const ids = collectPathNodeIds(candidates);
  const nodeById = new Map();
  if (ids.length) {
    const { rows } = await queryable.query(
      `SELECT id, node_type, canonical_name, normalized_key
         FROM knowledge_nodes
        WHERE id = ANY($1::bigint[])`,
      [ids],
    );
    for (const row of rows) {
      nodeById.set(String(row.id), {
        id: String(row.id),
        type: row.node_type,
        name: row.canonical_name,
        key: row.normalized_key,
      });
    }
  }
  return candidates.map((candidate) => {
    const evidence = candidate.evidenceSummary || {};
    const leftPath = (evidence.leftPath || []).map((id) => nodeById.get(String(id))).filter(Boolean);
    const rightPath = (evidence.rightPath || []).map((id) => nodeById.get(String(id))).filter(Boolean);
    const caveats = [];
    const evidenceGaps = [];
    const nextActions = [];
    if (Number(evidence.evidenceQuality || 0) <= 0) {
      caveats.push('Needs direct evidence before it can be trusted.');
    }
    if (Number(evidence.directEvidenceCount || 0) < 2) {
      evidenceGaps.push('direct evidence is still thin');
    }
    if (Number(evidence.sourceDiversityRaw ?? evidence.sourceDiversity ?? 0) < 3) {
      evidenceGaps.push('source diversity is below trusted-promotion floor');
    }
    if (Number(evidence.seedSimilarity || 0) > 0) {
      caveats.push('Resembles calibration examples; ranking is seed-capped and evidence must independently support it.');
    }
    if (candidate.status === 'research_backlog') {
      caveats.push('Held in research backlog for source expansion, not shown as an actionable main-surface candidate.');
      nextActions.push({
        label: 'Add source query',
        action: 'source-query',
        reason: 'queue targeted evidence expansion before treating this as actionable',
      });
    }
    if (candidate.status === 'new' || candidate.status === 'watch') {
      nextActions.push({
        label: 'Watch',
        action: 'watch',
        reason: 'keep it visible and prioritize evidence refresh without canonical promotion',
      });
    }
    if (candidate.status === 'trusted') {
      nextActions.push({
        label: 'Accept',
        action: 'accept',
        reason: 'positive review can move it toward a canonical-cross-theme proposal gate',
      });
    }
    nextActions.push({
      label: 'Track privately',
      action: 'track-private',
      reason: 'pin the connector to your private tracking layer without polluting canonical taxonomy',
    });
    const sourceFailure = candidate.metadata?.sourceQueryFailure || null;
    if (sourceFailure?.category) {
      evidenceGaps.push(`last source-query failed: ${sourceFailure.category}`);
    }
    return {
      ...candidate,
      pathway: {
        left: leftPath,
        right: rightPath,
      },
      caveats,
      evidenceGaps,
      nextActions,
      stateExplanation: explainCandidateState(candidate),
      decisionGuide: {
        accept: 'Records positive human review. Canonical promotion is still approval-gated.',
        watch: 'Keeps the candidate in review and raises evidence-refresh priority.',
        reject: 'Records negative feedback and suppresses similar ranking patterns.',
        trackPrivately: 'Creates a private tracked target only; no canonical taxonomy write.',
        addSourceQuery: 'Queues targeted evidence expansion in approval_queue/source-query.',
      },
      contaminationBoundary: {
        candidateOnly: true,
        canonicalPromotion: 'review-gated',
        autoWriteTables: ['cross_theme_candidates', 'adjacency_feedback', 'research_evidence_bundles', 'knowledge_edge_evidence'],
      },
    };
  });
}

function explainCandidateState(candidate = {}) {
  const status = candidate.status || 'new';
  const lane = candidate.lane || 'exploration';
  if (status === 'trusted') return 'Evidence and feedback gates passed; waiting for canonical proposal review before durable taxonomy mutation.';
  if (status === 'accepted') return 'Human-positive candidate; trusted promotion task will verify evidence/source gates.';
  if (status === 'research_backlog') return 'Promising graph overlap held for more source expansion before it becomes a main candidate.';
  if (lane === 'needs_evidence') return 'Connector relationship exists in the graph but needs stronger direct evidence.';
  if (lane === 'weird_but_rising') return 'Novel candidate preserved by exploration quota even before evidence is complete.';
  if (status === 'rejected') return 'Suppressed by human feedback; similar candidates should be penalized.';
  return 'New cross-theme connector candidate awaiting review.';
}

async function loadCandidateSummary(queryable) {
  const { rows } = await queryable.query(
    `SELECT status, lane, COUNT(*)::int AS count
       FROM cross_theme_candidates
      WHERE status NOT IN ('archived')
      GROUP BY status, lane`,
  );
  return rows.reduce((acc, row) => {
    acc.total += Number(row.count || 0);
    acc.byStatus[row.status] = (acc.byStatus[row.status] || 0) + Number(row.count || 0);
    acc.byLane[row.lane] = (acc.byLane[row.lane] || 0) + Number(row.count || 0);
    return acc;
  }, { total: 0, byStatus: {}, byLane: {} });
}

export async function buildCrossThemeConnectorsPayload(queryable, params = new URLSearchParams()) {
  await ensureResearchOsSchema(queryable);
  const includeFinal = params.get('include_final') === '1';
  const includeBacklog = params.get('include_backlog') === '1';
  const lane = params.get('lane');
  const limit = Math.max(1, Math.min(100, Number(params.get('limit') || 24)));
  const where = [];
  const values = [];
  if (!includeFinal && !includeBacklog) {
    where.push(`c.status = 'new'`);
  } else if (!includeFinal) {
    where.push(`c.status NOT IN ('accepted','rejected','archived')`);
  }
  if (lane) {
    values.push(lane);
    where.push(`c.lane = $${values.length}`);
  }
  values.push(limit);
  const { rows } = await queryable.query(
    `SELECT c.*,
            cn.id AS connector_id,
            cn.node_type AS connector_type,
            cn.canonical_name AS connector_name,
            cn.normalized_key AS connector_key,
            sn.id AS supplier_id,
            sn.node_type AS supplier_type,
            sn.canonical_name AS supplier_name,
            sn.normalized_key AS supplier_key
       FROM cross_theme_candidates c
       LEFT JOIN knowledge_nodes cn ON c.connector_node_id = cn.id
       LEFT JOIN knowledge_nodes sn ON c.supplier_node_id = sn.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.score DESC NULLS LAST, c.updated_at DESC
      LIMIT $${values.length}`,
    values,
  );
  const candidates = await attachCandidateContext(queryable, rows.map(mapCandidateRow));
  const summary = await loadCandidateSummary(queryable);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    count: candidates.length,
    candidates,
    summary,
    lanes: candidates.reduce((acc, candidate) => {
      acc[candidate.lane] = (acc[candidate.lane] || 0) + 1;
      return acc;
    }, {}),
    boundary: {
      writeTables: ['cross_theme_candidates', 'adjacency_feedback'],
      canonicalPromotion: 'review-gated',
    },
    emptyState: candidates.length ? null : {
      reason: 'no cross-theme connector candidates yet',
      nextStep: 'Run scripts/research-os-foundation.mjs --all, then refresh-cross-theme-candidates once scorer persistence is enabled.',
    },
  };
}

function readDaemonResearchOsTasks() {
  const path = 'data/daemon-state.json';
  if (!existsSync(path)) return { available: false, tasks: {} };
  try {
    const state = JSON.parse(readFileSync(path, 'utf8'));
    const taskNames = [
      'research-os-foundation',
      'research-os-cycle',
      'mine-incoming-connections',
      'collect-research-evidence',
      'extract-research-relations',
      'refresh-cross-theme-candidates',
      'cross-theme-source-expansion',
      'execute-source-query-approvals',
      'promote-trusted-graph',
      'adjacency-autoresearch',
      'research-os-policy-advisor',
    ];
    return {
      available: true,
      heartbeat: state.heartbeat || null,
      tasks: Object.fromEntries(taskNames.map((name) => [name, {
        lastRun: state.lastRun?.[name] ? new Date(state.lastRun[name]).toISOString() : null,
        ok: state.taskResults?.[name]?.ok ?? null,
        error: state.taskResults?.[name]?.error || state.failures?.[name]?.lastError || '',
        consecutiveFailures: Number(state.taskResults?.[name]?.consecutiveFailures ?? state.failures?.[name]?.consecutive ?? 0),
      }])),
    };
  } catch (error) {
    return { available: false, error: String(error?.message || error), tasks: {} };
  }
}

export async function buildResearchOsStatusPayload(queryable) {
  await ensureResearchOsSchema(queryable);
  const policy = loadResearchOsPolicy();
  const seedDependenceRatioMax = requirePolicyNumber(policy, 'seedDependenceRatioMax');
  const seedSimilarityStrongThreshold = requirePolicyNumber(policy, 'incoming.seedSimilarityStrongThreshold');
  const [
    candidateRows,
    approvalRows,
    evidenceRows,
    edgeRows,
    feedbackRows,
    seedRows,
  ] = await Promise.all([
    queryable.query(
      `SELECT status, lane, COUNT(*)::int AS count
         FROM cross_theme_candidates
        WHERE status <> 'archived'
        GROUP BY status, lane`,
    ),
    queryable.query(
      `SELECT action_type,
              CASE
                WHEN action_type = 'source-query'
                 AND status = 'needs-fix'
                 AND payload->'repair'->>'exhausted' = 'true'
                  THEN 'exhausted'
                ELSE status
              END AS status,
              COUNT(*)::int AS count
         FROM approval_queue
        WHERE action_type IN ('source-query','canonical-cross-theme-proposal','attach-theme')
        GROUP BY action_type, CASE
                WHEN action_type = 'source-query'
                 AND status = 'needs-fix'
                 AND payload->'repair'->>'exhausted' = 'true'
                  THEN 'exhausted'
                ELSE status
              END`,
    ).catch(() => ({ rows: [] })),
    queryable.query(
      `SELECT source_type, COUNT(*)::int AS count, MAX(created_at) AS latest
         FROM research_evidence_bundles
        GROUP BY source_type`,
    ).catch(() => ({ rows: [] })),
    queryable.query(
      `SELECT COUNT(*)::int AS count, MAX(created_at) AS latest
         FROM knowledge_edge_evidence`,
    ).catch(() => ({ rows: [{ count: 0, latest: null }] })),
    queryable.query(
      `SELECT decision, COUNT(*)::int AS count
         FROM adjacency_feedback
        GROUP BY decision`,
    ).catch(() => ({ rows: [] })),
    queryable.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE COALESCE((evidence_summary->>'seedSimilarity')::float8, 0) > 0)::int AS seed_touched,
              COUNT(*) FILTER (WHERE COALESCE((evidence_summary->>'seedSimilarity')::float8, 0) >= $1)::int AS seed_strong,
              AVG(COALESCE((evidence_summary->>'seedSimilarity')::float8, 0))::float8 AS avg_seed_similarity
         FROM cross_theme_candidates
        WHERE status <> 'archived'`,
      [seedSimilarityStrongThreshold],
    ).catch(() => ({ rows: [{ total: 0, seed_touched: 0, seed_strong: 0, avg_seed_similarity: 0 }] })),
  ]);
  const candidateSummary = candidateRows.rows.reduce((acc, row) => {
    const count = Number(row.count || 0);
    acc.total += count;
    acc.byStatus[row.status] = (acc.byStatus[row.status] || 0) + count;
    acc.byLane[row.lane] = (acc.byLane[row.lane] || 0) + count;
    return acc;
  }, { total: 0, byStatus: {}, byLane: {} });
  const approvalSummary = approvalRows.rows.reduce((acc, row) => {
    const key = `${row.action_type}:${row.status}`;
    acc[key] = Number(row.count || 0);
    return acc;
  }, {});
  const evidenceSummary = {
    bundlesBySource: evidenceRows.rows.reduce((acc, row) => {
      acc[row.source_type] = { count: Number(row.count || 0), latest: row.latest || null };
      return acc;
    }, {}),
    edgeEvidence: {
      count: Number(edgeRows.rows[0]?.count || 0),
      latest: edgeRows.rows[0]?.latest || null,
    },
  };
  const feedbackSummary = feedbackRows.rows.reduce((acc, row) => {
    acc[row.decision] = Number(row.count || 0);
    return acc;
  }, {});
  const seedStats = seedRows.rows[0] || {};
  const seedDependenceRatio = Number(seedStats.total || 0)
    ? Number(seedStats.seed_strong || 0) / Number(seedStats.total || 1)
    : 0;
  const seedTouchedRatio = Number(seedStats.total || 0)
    ? Number(seedStats.seed_touched || 0) / Number(seedStats.total || 1)
    : 0;
  const daemon = readDaemonResearchOsTasks();
  const blockers = [];
  if (Number(approvalSummary['source-query:needs-fix'] || 0) > 0) blockers.push('source-query-needs-fix');
  if (Number(approvalSummary['source-query:exhausted'] || 0) > 0) blockers.push('source-query-exhausted-review');
  if (Number(approvalSummary['source-query:pending'] || 0) > 0) blockers.push('source-query-pending-review');
  if (Number(candidateSummary.byLane.needs_evidence || 0) > Number(candidateSummary.byLane.validated || 0) * 3) blockers.push('evidence-backlog-heavy');
  if (seedDependenceRatio > seedDependenceRatioMax) blockers.push('seed-dependence-high');
  const failedTasks = Object.entries(daemon.tasks || {}).filter(([, task]) => task.consecutiveFailures > 0);
  if (failedTasks.length) blockers.push('daemon-task-failures');
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    summary: {
      level: blockers.length ? 'warning' : 'ok',
      blockers,
      status: blockers.length ? 'review-loop-needs-attention' : 'research-loop-healthy',
    },
    candidates: candidateSummary,
    approvals: approvalSummary,
    evidence: evidenceSummary,
    feedback: feedbackSummary,
    autonomy: {
      seedDependenceRatio,
      seedTouchedRatio,
      seedStrongCount: Number(seedStats.seed_strong || 0),
      seedTouchedCount: Number(seedStats.seed_touched || 0),
      avgSeedSimilarity: Number(seedStats.avg_seed_similarity || 0),
      guardrails: buildPolicyDiagnostics(policy).guardrails,
    },
    daemon,
    nextActions: [
      approvalSummary['source-query:pending'] ? 'Review or explicitly approve pending source-query items before execution.' : null,
      approvalSummary['source-query:needs-fix'] ? 'Run execute-source-query-approvals with --retry-needs-fix or inspect failed query rewrites.' : null,
      approvalSummary['source-query:exhausted'] ? 'Inspect exhausted source-query items; they need a better source connector or manual rejection.' : null,
      candidateSummary.byLane?.needs_evidence ? 'Use Add source query on high-score needs_evidence candidates.' : null,
      seedDependenceRatio > seedDependenceRatioMax ? `Strong seed dependence ${Math.round(seedDependenceRatio * 100)}% exceeds policy max ${Math.round(seedDependenceRatioMax * 100)}%; run incoming-source mining and autonomous question generation. Seed-touched ratio is ${Math.round(seedTouchedRatio * 100)}%.` : null,
      approvalSummary['canonical-cross-theme-proposal:pending'] ? 'Review pending canonical-cross-theme proposals before taxonomy promotion.' : null,
    ].filter(Boolean),
    boundary: {
      canonicalPromotion: 'review-gated',
      autoWriteTables: ['incoming_research_signals', 'research_questions', 'cross_theme_candidates', 'adjacency_feedback', 'research_evidence_bundles', 'knowledge_edge_evidence'],
      forbiddenAutoWrites: ['discovery_topics', 'model_predictions', 'labeled_outcomes'],
    },
  };
}

export async function buildResearchQuestionsPayload(queryable, params = new URLSearchParams()) {
  await ensureResearchOsSchema(queryable);
  const status = params.get('status') || 'new';
  const limit = Math.max(1, Math.min(100, Number(params.get('limit') || 24)));
  const { rows } = await queryable.query(
    `SELECT id, deterministic_id, question_type, themes, seed_terms, prompt,
            trigger_reason, novelty_score, heat_score, gap_score, priority_score,
            status, run_count, last_run_at, metadata, created_at, updated_at
       FROM research_questions
      WHERE status = $1
      ORDER BY priority_score DESC NULLS LAST, created_at DESC
      LIMIT $2`,
    [status, limit],
  );
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    count: rows.length,
    questions: rows.map((row) => ({
      id: String(row.id),
      deterministicId: row.deterministic_id,
      questionType: row.question_type,
      themes: row.themes || [],
      seedTerms: row.seed_terms || [],
      prompt: row.prompt,
      triggerReason: row.trigger_reason,
      noveltyScore: toNumber(row.novelty_score),
      heatScore: toNumber(row.heat_score),
      gapScore: toNumber(row.gap_score),
      priorityScore: toNumber(row.priority_score),
      status: row.status,
      runCount: row.run_count,
      lastRunAt: row.last_run_at,
      metadata: row.metadata || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}

export async function reviewCrossThemeCandidate(queryable, candidateId, input = {}) {
  await ensureResearchOsSchema(queryable);
  const decision = String(input.decision || '').trim().toLowerCase();
  if (!['accept', 'accepted', 'watch', 'reject', 'rejected'].includes(decision)) {
    throw new Error(`unsupported cross-theme review decision: ${decision}`);
  }
  const status = decision === 'accept' ? 'accepted' : decision === 'reject' ? 'rejected' : decision;
  const { rows } = await queryable.query(
    `UPDATE cross_theme_candidates
        SET status = $2,
            lane = CASE
              WHEN $2 = 'accepted' THEN 'validated'
              WHEN $2 = 'rejected' THEN 'rejected'
              ELSE lane
            END,
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, status, lane`,
    [candidateId, status],
  );
  if (!rows.length) throw new Error(`cross-theme candidate not found: ${candidateId}`);
  await queryable.query(
    `INSERT INTO adjacency_feedback (
       candidate_id, decision, relation_override, priority, evidence_quality, reason, user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      candidateId,
      status,
      input.relationOverride || null,
      input.priority || null,
      input.evidenceQuality || null,
      input.reason || '',
      input.userId || 'default',
    ],
  );
  return {
    ok: true,
    candidate: {
      id: String(rows[0].id),
      status: rows[0].status,
      lane: rows[0].lane,
    },
  };
}

async function loadCandidateForAction(queryable, candidateId) {
  const { rows } = await queryable.query(
    `SELECT c.*,
            cn.canonical_name AS connector_name,
            sn.canonical_name AS supplier_name
       FROM cross_theme_candidates c
       LEFT JOIN knowledge_nodes cn ON c.connector_node_id = cn.id
       LEFT JOIN knowledge_nodes sn ON c.supplier_node_id = sn.id
      WHERE c.id = $1
      LIMIT 1`,
    [candidateId],
  );
  if (!rows.length) throw new Error(`cross-theme candidate not found: ${candidateId}`);
  return rows[0];
}

export async function trackCrossThemeCandidate(queryable, candidateId, input = {}) {
  await ensureResearchOsSchema(queryable);
  const candidate = await loadCandidateForAction(queryable, candidateId);
  const label = candidate.connector_name || candidate.supplier_name || `Cross-theme candidate ${candidate.id}`;
  const target = await upsertTrackedTarget(queryable, {
    userId: input.userId || 'default',
    label,
    targetType: candidate.supplier_name ? 'company' : 'theme_candidate',
    aliases: [label, ...(candidate.themes || [])],
    priority: input.priority || 'normal',
    pinToHome: input.pinToHome ?? true,
    promoteToMain: false,
    metadata: {
      source: 'cross-theme-candidate',
      candidateId: String(candidate.id),
      themes: candidate.themes || [],
      isolation: 'private-tracking-only',
    },
  });
  return { ok: true, target };
}

export async function queueCrossThemeSourceQueries(queryable, candidateId, input = {}) {
  await ensureResearchOsSchema(queryable);
  const candidate = await loadCandidateForAction(queryable, candidateId);
  const queries = buildSourceExpansionQueries({
    id: String(candidate.id),
    themes: candidate.themes || [],
    connector: candidate.connector_name || '',
    supplier: candidate.supplier_name || '',
    node: { canonicalName: candidate.connector_name || candidate.supplier_name || '' },
    evidenceSummary: candidate.evidence_summary || {},
  }, input);
  const queued = [];
  for (const query of queries) {
    const existing = await queryable.query(
      `SELECT id
         FROM approval_queue
        WHERE action_type = 'source-query'
          AND LOWER(payload->>'query') = LOWER($1)
          AND status IN ('pending', 'needs-fix')
        LIMIT 1`,
      [query.query],
    );
    if (existing.rows[0]?.id) {
      queued.push({ id: existing.rows[0].id, deduped: true, query: query.query });
      continue;
    }
    const { rows } = await queryable.query(
      `INSERT INTO approval_queue (action_type, payload, status, reasoning)
       VALUES ('source-query', $1::jsonb, 'pending', $2)
       RETURNING id`,
      [
        JSON.stringify({
          query: query.query,
          candidateId: String(candidate.id),
          themes: candidate.themes || [],
          connector: candidate.connector_name || null,
          supplier: candidate.supplier_name || null,
          source: 'cross-theme-research-os',
        }),
        query.reason,
      ],
    );
    queued.push({ id: rows[0].id, deduped: false, query: query.query });
  }
  return { ok: true, queuedCount: queued.length, queued };
}
