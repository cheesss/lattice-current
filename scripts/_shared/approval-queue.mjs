export const REQUIRES_APPROVAL = new Set([
  'remove-symbol',
  'large-backfill',
  'add-rss-untrusted',
  'change-budget',
  'backfill-source:guardian-keyword',
]);

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

export async function queueForApproval(client, action) {
  const result = await client.query(
    `
      INSERT INTO approval_queue (action_type, payload, status, reasoning)
      VALUES ($1, $2, 'pending', $3)
      RETURNING id, action_type, status, created_at
    `,
    [
      String(action?.type || 'unknown'),
      JSON.stringify(action?.params || {}),
      action?.reason ? String(action.reason).slice(0, 500) : null,
    ],
  );
  return result.rows[0];
}

export async function getPendingApprovals(client, limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
  const { rows } = await client.query(
    `
      SELECT id, action_type, payload, status, reasoning, created_at, reviewed_at, reviewer
      FROM approval_queue
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [safeLimit],
  );
  return rows;
}
