/**
 * Inbox action audit log (S-Level §Phase 2).
 *
 * Every operator decision on a Decision Inbox item — Discovery, Approval,
 * Proposal, or E2 Signal — must produce one row here:
 *
 *   item_type       discovery | approval | proposal | e2_signal
 *   item_id         the source row's id (string for portability)
 *   prev_state      pre-decision state, or null if unknown
 *   next_state      post-decision state
 *   decision        accept | reject | snooze | execute | suppress | watch | needs-fix | ...
 *   reviewer        identity from request body or 'dashboard-ui'
 *   request_id      correlation id minted at request entry
 *   body_hash       sha256 of the request body (so identical replays collapse)
 *   note            free-text reason
 *   created_at      NOW()
 *
 * This is intentionally a separate table from automation_actions —
 * automation_actions records system-level automation runs; this records
 * human review decisions.
 */
import { createHash, randomUUID } from 'node:crypto';

const SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS action_audit_log (
     id BIGSERIAL PRIMARY KEY,
     item_type VARCHAR(32) NOT NULL,
     item_id VARCHAR(128) NOT NULL,
     prev_state VARCHAR(64),
     next_state VARCHAR(64),
     decision VARCHAR(64),
     reviewer VARCHAR(160) NOT NULL DEFAULT 'dashboard-ui',
     request_id VARCHAR(64),
     body_hash VARCHAR(64),
     note TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_action_audit_log_created_at
     ON action_audit_log (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_action_audit_log_item
     ON action_audit_log (item_type, item_id, created_at DESC)`,
];

let schemaEnsured = false;

export async function ensureInboxAuditSchema(client) {
  if (schemaEnsured) return;
  for (const ddl of SCHEMA_DDL) {
    await client.query(ddl);
  }
  schemaEnsured = true;
}

export function newRequestId() {
  // 12 hex chars is enough collision resistance for in-process correlation.
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

export function hashRequestBody(body) {
  if (body === null || body === undefined) return null;
  let serialized;
  try {
    serialized = typeof body === 'string' ? body : JSON.stringify(body);
  } catch {
    return null;
  }
  if (!serialized) return null;
  return createHash('sha256').update(serialized).digest('hex');
}

const VALID_ITEM_TYPES = new Set(['discovery', 'approval', 'proposal', 'e2_signal']);

export async function recordInboxAction(client, entry = {}) {
  if (!client) throw new Error('recordInboxAction requires a pg client');
  const itemType = String(entry.itemType || '').trim().toLowerCase();
  if (!VALID_ITEM_TYPES.has(itemType)) {
    throw new Error(`recordInboxAction: invalid item_type "${entry.itemType}"`);
  }
  if (entry.itemId === undefined || entry.itemId === null || String(entry.itemId).trim() === '') {
    throw new Error('recordInboxAction: itemId required');
  }
  await ensureInboxAuditSchema(client);
  await client.query(
    `INSERT INTO action_audit_log
       (item_type, item_id, prev_state, next_state, decision, reviewer,
        request_id, body_hash, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      itemType,
      String(entry.itemId).slice(0, 128),
      entry.prevState ? String(entry.prevState).slice(0, 64) : null,
      entry.nextState ? String(entry.nextState).slice(0, 64) : null,
      entry.decision ? String(entry.decision).slice(0, 64) : null,
      String(entry.reviewer || 'dashboard-ui').slice(0, 160),
      entry.requestId ? String(entry.requestId).slice(0, 64) : null,
      entry.bodyHash ? String(entry.bodyHash).slice(0, 64) : null,
      entry.note ? String(entry.note).slice(0, 4000) : null,
    ],
  );
}

export async function recentInboxActions(client, options = {}) {
  await ensureInboxAuditSchema(client);
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 100));
  const itemType = options.itemType ? String(options.itemType).toLowerCase() : null;
  const itemId = options.itemId ? String(options.itemId) : null;
  const params = [limit];
  let where = '';
  if (itemType && VALID_ITEM_TYPES.has(itemType)) {
    params.push(itemType);
    where = `WHERE item_type = $${params.length}`;
    if (itemId) {
      params.push(itemId);
      where += ` AND item_id = $${params.length}`;
    }
  }
  const { rows } = await client.query(
    `SELECT id, item_type, item_id, prev_state, next_state, decision, reviewer,
            request_id, body_hash, note, created_at
       FROM action_audit_log
       ${where}
       ORDER BY created_at DESC
       LIMIT $1`,
    params,
  );
  return rows;
}
