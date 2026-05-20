export const REQUIRES_APPROVAL = new Set([
  'remove-symbol',
  'large-backfill',
  'add-rss-untrusted',
  'change-budget',
  'backfill-source:guardian-keyword',
]);

export const FINAL_APPROVAL_STATUSES = new Set(['approved', 'rejected', 'executed']);

export function requiresApproval(actionType, payload = {}) {
  if (REQUIRES_APPROVAL.has(actionType)) return true;
  if (actionType === 'backfill-source') {
    const source = String(payload?.source || '').trim().toLowerCase();
    const limit = Number(payload?.args?.limit ?? payload?.limit ?? 0);
    if (REQUIRES_APPROVAL.has(`backfill-source:${source}`)) return true;
    if (limit > 100000) return true;
  }
  return false;
}

export function normalizeApprovalUrl(value) {
  return String(value || '').trim().toLowerCase().replace(/\/+$/, '');
}

export async function queueForApproval(client, action) {
  const actionType = String(action?.type || 'unknown');
  const payload = action?.params || {};
  const reason = action?.reason ? String(action.reason).slice(0, 500) : null;
  const normalizedUrl = normalizeApprovalUrl(payload?.url);

  if (normalizedUrl) {
    const existing = await client.query(
      `
        SELECT id
        FROM approval_queue
        WHERE action_type = $1
          AND LOWER(REGEXP_REPLACE(payload->>'url', '/+$', '')) = $2
          AND status IN ('pending', 'needs-fix')
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [actionType, normalizedUrl],
    );
    const existingId = existing.rows[0]?.id;
    if (existingId) {
      const result = await client.query(
        `
          UPDATE approval_queue
          SET payload = $2::jsonb,
              status = CASE WHEN status = 'needs-fix' THEN 'pending' ELSE status END,
              reasoning = CASE
                WHEN COALESCE($3, '') = '' THEN reasoning
                WHEN COALESCE(reasoning, '') = '' THEN $3
                WHEN reasoning = $3 THEN reasoning
                WHEN reasoning LIKE '%' || E'\n' || $3 THEN reasoning
                ELSE reasoning || E'\n' || $3
              END
          WHERE id = $1
          RETURNING id, action_type, status, created_at
        `,
        [existingId, JSON.stringify(payload), reason || ''],
      );
      return {
        ...result.rows[0],
        deduped: true,
      };
    }
  }

  const result = await client.query(
    `
      INSERT INTO approval_queue (action_type, payload, status, reasoning)
      VALUES ($1, $2, 'pending', $3)
      RETURNING id, action_type, status, created_at
    `,
    [
      actionType,
      JSON.stringify(payload),
      reason,
    ],
  );
  return result.rows[0];
}

/**
 * Returns approval queue items.
 *
 * Default: actionable items only (status IN ('pending', 'needs-fix')) per
 * S-Level §Phase 2 — "API should return actionable items by default".
 *
 * Pass { includeFinal: true } to include final states (approved, rejected,
 * executed). Use this only for history/audit views, never for the inbox.
 */
export async function getPendingApprovals(client, limit = 100, options = {}) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
  const includeFinal = Boolean(options?.includeFinal);
  const filter = includeFinal ? '' : `WHERE status IN ('pending', 'needs-fix')`;
  const { rows } = await client.query(
    `
      SELECT id, action_type, payload, status, reasoning, created_at, reviewed_at, reviewer
      FROM approval_queue
      ${filter}
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [safeLimit],
  );
  return rows;
}

export async function loadApprovalById(client, approvalId) {
  const normalizedId = Number(approvalId);
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) return null;
  const { rows } = await client.query(
    `
      SELECT id, action_type, payload, status, reasoning, created_at, reviewed_at, reviewer
      FROM approval_queue
      WHERE id = $1
      LIMIT 1
    `,
    [normalizedId],
  );
  return rows[0] || null;
}

export function normalizeApprovalReviewDecision(decision) {
  const normalized = String(decision || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['accept', 'approve', 'approved'].includes(normalized)) return 'approved';
  if (['reject', 'rejected', 'deny', 'denied'].includes(normalized)) return 'rejected';
  if (['execute', 'executed'].includes(normalized)) return 'executed';
  if (['needs-fix', 'needsfix', 'needs_fix'].includes(normalized)) return 'needs-fix';
  return null;
}

export async function markApprovalReviewed(client, approvalId, {
  decision,
  reviewer = 'dashboard-ui',
  note = '',
} = {}) {
  const normalizedId = Number(approvalId);
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
    throw new Error('Invalid approval id');
  }
  const normalizedDecision = String(decision || '').trim().toLowerCase();
  if (!['approved', 'rejected', 'executed', 'needs-fix'].includes(normalizedDecision)) {
    throw new Error(`Unsupported approval decision: ${decision}`);
  }
  const result = await client.query(
    `
      UPDATE approval_queue
      SET status = $2,
          reviewed_at = NOW(),
          reviewer = $3,
          reasoning = CASE
            WHEN COALESCE($4, '') = '' THEN reasoning
            WHEN COALESCE(reasoning, '') = '' THEN $4
            WHEN reasoning = $4 THEN reasoning
            WHEN reasoning LIKE '%' || E'\n' || $4 THEN reasoning
            ELSE reasoning || E'\n' || $4
          END
      WHERE id = $1
      RETURNING id, action_type, payload, status, reasoning, created_at, reviewed_at, reviewer
    `,
    [normalizedId, normalizedDecision, String(reviewer || 'dashboard-ui').slice(0, 120), note ? String(note).slice(0, 500) : ''],
  );
  return result.rows[0] || null;
}

export async function reviewApprovalQueueItemById(client, approvalId, decision, options = {}) {
  const approval = await loadApprovalById(client, approvalId);
  if (!approval) {
    throw new Error(`Approval ${approvalId} not found`);
  }

  const currentStatus = String(approval.status || '').trim().toLowerCase();
  const isReviewable = currentStatus === 'pending' || currentStatus === 'needs-fix';
  if (!isReviewable && FINAL_APPROVAL_STATUSES.has(currentStatus)) {
    return {
      approval,
      status: currentStatus,
      alreadyFinal: true,
    };
  }

  const normalizedDecision = normalizeApprovalReviewDecision(decision);
  if (!normalizedDecision) {
    throw new Error(`Unsupported approval decision: ${decision}`);
  }

  const reviewed = await markApprovalReviewed(client, approvalId, {
    decision: normalizedDecision,
    reviewer: options.reviewer,
    note: options.note ?? options.reason ?? '',
  });
  if (!reviewed) {
    throw new Error(`Approval ${approvalId} disappeared during review`);
  }

  return {
    approval: reviewed,
    status: String(reviewed.status || normalizedDecision).trim().toLowerCase(),
    alreadyFinal: false,
  };
}
