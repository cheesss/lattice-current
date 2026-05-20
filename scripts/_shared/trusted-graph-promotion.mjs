import { requirePolicyNumber } from './research-os-policy.mjs';

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function evaluateTrustedPromotion(candidate = {}, feedback = [], policy) {
  const minSourceDiversity = requirePolicyNumber(policy, 'trustedPromotion.minSourceDiversity');
  const minDirectEvidence = requirePolicyNumber(policy, 'trustedPromotion.minDirectEvidence');
  const maxRejectRate = requirePolicyNumber(policy, 'trustedPromotion.maxRejectRate');
  const evidence = candidate.evidence_summary || candidate.evidenceSummary || {};
  const sourceDiversity = toNumber(evidence.sourceDiversityRaw ?? evidence.directSourceDiversity ?? evidence.sourceDiversity);
  const directEvidence = Math.floor(toNumber(
    evidence.directEvidenceCount
    ?? evidence.directEvidence
    ?? (toNumber(evidence.evidenceQuality) * Math.max(1, minDirectEvidence * 2)),
  ));
  const accepted = feedback.filter((item) => ['accepted', 'accept', 'watch'].includes(String(item.decision || '').toLowerCase())).length;
  const rejected = feedback.filter((item) => ['rejected', 'reject'].includes(String(item.decision || '').toLowerCase())).length;
  const totalReviewed = accepted + rejected;
  const rejectRate = totalReviewed ? rejected / totalReviewed : 0;
  const unresolvedCriticalCaveat = Boolean(candidate.metadata?.criticalCaveat || candidate.metadata?.unresolvedCriticalCaveat);
  const blockers = [];
  if (sourceDiversity < minSourceDiversity) blockers.push('low-source-diversity');
  if (directEvidence < minDirectEvidence) blockers.push('low-direct-evidence');
  if (accepted < 1 && !['accepted', 'watch'].includes(candidate.status)) blockers.push('no-human-positive-review');
  if (rejectRate > maxRejectRate) blockers.push('high-reject-rate');
  if (unresolvedCriticalCaveat) blockers.push('unresolved-critical-caveat');
  return {
    eligible: blockers.length === 0,
    blockers,
    metrics: {
      sourceDiversity,
      directEvidence,
      accepted,
      rejected,
      rejectRate,
      minSourceDiversity,
      minDirectEvidence,
      maxRejectRate,
    },
  };
}

export async function loadTrustedPromotionCandidates(queryable, limit = 100) {
  const { rows } = await queryable.query(
    `SELECT c.*
       FROM cross_theme_candidates c
      WHERE c.status IN ('accepted','watch')
         OR (c.status IN ('new','research_backlog') AND c.lane = 'watch')
      ORDER BY c.score DESC NULLS LAST, c.updated_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

async function loadFeedback(queryable, candidateIds) {
  if (!candidateIds.length) return new Map();
  const { rows } = await queryable.query(
    `SELECT candidate_id, decision, priority, evidence_quality, reason, created_at
       FROM adjacency_feedback
      WHERE candidate_id = ANY($1::bigint[])`,
    [candidateIds],
  );
  const grouped = new Map();
  for (const row of rows) {
    const key = String(row.candidate_id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
}

async function queueCanonicalProposal(queryable, candidate, evaluation) {
  const existing = await queryable.query(
    `SELECT id
       FROM approval_queue
      WHERE action_type = 'canonical-cross-theme-proposal'
        AND payload->>'candidateId' = $1
        AND status IN ('pending', 'needs-fix')
      LIMIT 1`,
    [String(candidate.id)],
  );
  if (existing.rows[0]?.id) return { id: existing.rows[0].id, deduped: true };
  const { rows } = await queryable.query(
    `INSERT INTO approval_queue (action_type, payload, status, reasoning)
     VALUES ('canonical-cross-theme-proposal', $1::jsonb, 'pending', $2)
     RETURNING id`,
    [
      JSON.stringify({
        candidateId: String(candidate.id),
        themes: candidate.themes || [],
        connectorNodeId: candidate.connector_node_id || null,
        supplierNodeId: candidate.supplier_node_id || null,
        score: candidate.score,
        evidenceSummary: candidate.evidence_summary || {},
        promotionMetrics: evaluation.metrics,
        source: 'trusted-graph-promotion',
      }),
      'Trusted cross-theme candidate is eligible for canonical review; approval is required before canonical mutation.',
    ],
  );
  return { id: rows[0].id, deduped: false };
}

export async function runTrustedPromotion(queryable, policy, options = {}) {
  const candidates = await loadTrustedPromotionCandidates(queryable, options.limit || 100);
  const feedbackByCandidate = await loadFeedback(queryable, candidates.map((candidate) => candidate.id));
  const evaluated = [];
  const promoted = [];
  for (const candidate of candidates) {
    const evaluation = evaluateTrustedPromotion(candidate, feedbackByCandidate.get(String(candidate.id)) || [], policy);
    evaluated.push({ candidateId: String(candidate.id), ...evaluation });
    if (!evaluation.eligible) continue;
    if (!options.dryRun) {
      await queryable.query(
        `UPDATE cross_theme_candidates
            SET status = 'trusted',
                lane = 'validated',
                metadata = metadata || $2::jsonb,
                updated_at = NOW()
          WHERE id = $1`,
        [candidate.id, JSON.stringify({ trustedPromotion: evaluation.metrics, trustedAt: new Date().toISOString() })],
      );
      const proposal = await queueCanonicalProposal(queryable, candidate, evaluation);
      promoted.push({ candidateId: String(candidate.id), proposal });
    } else {
      promoted.push({ candidateId: String(candidate.id), dryRun: true });
    }
  }
  return {
    ok: true,
    dryRun: Boolean(options.dryRun),
    evaluatedCount: evaluated.length,
    eligibleCount: evaluated.filter((item) => item.eligible).length,
    promotedCount: promoted.length,
    promoted,
    blockers: evaluated.reduce((acc, item) => {
      for (const blocker of item.blockers || []) acc[blocker] = (acc[blocker] || 0) + 1;
      return acc;
    }, {}),
  };
}
