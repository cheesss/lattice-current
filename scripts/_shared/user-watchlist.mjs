/**
 * User watchlist persistence (S-Tier User Value §4 + §3).
 *
 * Plan §4: "Follow / Mute / Accept / Reject / Snooze / Dismiss must persist
 * after refresh." This module is the server-side state store for those
 * actions on items that currently have no DB-side review queue (the
 * "e2_signal" item type from §Phase 2 of the maturity plan, plus per-theme
 * Follow / Mute toggles).
 *
 * Single-operator mode: until the auth track lands (§9, deferred), we treat
 * 'default' as the user id. The schema is forward-compatible so adding real
 * user ids later is a column-level change, not a migration of meaning.
 *
 * States:
 *   follow      user wants this in their primary surfaces
 *   mute        user wants this hidden (still searchable)
 *   dismiss     user has explicitly rejected this item
 *   snooze      user wants this hidden until snooze_until (timestamp)
 *
 * Audit trail: every transition writes through scripts/_shared/inbox-audit.mjs
 * with item_type 'e2_signal' so the existing /api/inbox/audit endpoint shows
 * watchlist actions alongside discovery/approval/proposal decisions.
 */

const SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS user_watchlist_state (
     id BIGSERIAL PRIMARY KEY,
     user_id VARCHAR(120) NOT NULL DEFAULT 'default',
     item_type VARCHAR(32) NOT NULL,
     item_id VARCHAR(160) NOT NULL,
     state VARCHAR(32) NOT NULL,
     snooze_until TIMESTAMPTZ,
     note TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (user_id, item_type, item_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_user_watchlist_lookup
     ON user_watchlist_state (user_id, item_type, state)`,
  `CREATE INDEX IF NOT EXISTS idx_user_watchlist_snooze
     ON user_watchlist_state (snooze_until)
     WHERE state = 'snooze'`,
];

let schemaEnsured = false;

export const VALID_WATCHLIST_STATES = new Set(['follow', 'mute', 'dismiss', 'snooze']);
export const VALID_WATCHLIST_ITEM_TYPES = new Set(['theme', 'event', 'symbol', 'e2_signal']);

export async function ensureWatchlistSchema(client) {
  if (schemaEnsured) return;
  for (const ddl of SCHEMA_DDL) {
    await client.query(ddl);
  }
  schemaEnsured = true;
}

function normalizeUserId(userId) {
  return String(userId || 'default').trim().slice(0, 120) || 'default';
}

function validateOrThrow(itemType, itemId, state) {
  if (!VALID_WATCHLIST_ITEM_TYPES.has(itemType)) {
    throw new Error(`watchlist: invalid item_type "${itemType}"`);
  }
  if (itemId === undefined || itemId === null || String(itemId).trim() === '') {
    throw new Error('watchlist: itemId required');
  }
  if (state !== null && !VALID_WATCHLIST_STATES.has(state)) {
    throw new Error(`watchlist: invalid state "${state}"`);
  }
}

/**
 * Upsert a watchlist entry. Returns the row after the upsert.
 *
 * Pass state=null to remove the entry entirely (use removeWatchlistEntry
 * if you prefer the explicit verb).
 */
export async function setWatchlistState(client, entry = {}) {
  const userId = normalizeUserId(entry.userId);
  const itemType = String(entry.itemType || '').toLowerCase();
  const itemId = String(entry.itemId ?? '').trim();
  const state = entry.state ? String(entry.state).toLowerCase() : null;
  validateOrThrow(itemType, itemId, state);
  await ensureWatchlistSchema(client);

  if (state === null) {
    return removeWatchlistEntry(client, { userId, itemType, itemId });
  }

  const snoozeUntil = entry.snoozeUntil ? new Date(entry.snoozeUntil) : null;
  if (snoozeUntil && Number.isNaN(snoozeUntil.getTime())) {
    throw new Error('watchlist: invalid snoozeUntil timestamp');
  }
  if (state === 'snooze' && !snoozeUntil) {
    throw new Error('watchlist: snooze state requires snoozeUntil timestamp');
  }

  const note = entry.note ? String(entry.note).slice(0, 4000) : null;
  const { rows } = await client.query(
    `INSERT INTO user_watchlist_state (user_id, item_type, item_id, state, snooze_until, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, item_type, item_id) DO UPDATE
       SET state = EXCLUDED.state,
           snooze_until = EXCLUDED.snooze_until,
           note = COALESCE(EXCLUDED.note, user_watchlist_state.note),
           updated_at = NOW()
     RETURNING id, user_id, item_type, item_id, state, snooze_until, note,
               created_at, updated_at`,
    [userId, itemType, itemId, state, snoozeUntil, note],
  );
  return rows[0];
}

export async function removeWatchlistEntry(client, { userId, itemType, itemId } = {}) {
  const u = normalizeUserId(userId);
  const t = String(itemType || '').toLowerCase();
  const i = String(itemId ?? '').trim();
  validateOrThrow(t, i, null);
  await ensureWatchlistSchema(client);
  const { rowCount } = await client.query(
    `DELETE FROM user_watchlist_state WHERE user_id=$1 AND item_type=$2 AND item_id=$3`,
    [u, t, i],
  );
  return { removed: rowCount > 0 };
}

export async function getWatchlistEntry(client, { userId, itemType, itemId } = {}) {
  const u = normalizeUserId(userId);
  const t = String(itemType || '').toLowerCase();
  const i = String(itemId ?? '').trim();
  validateOrThrow(t, i, null);
  await ensureWatchlistSchema(client);
  const { rows } = await client.query(
    `SELECT id, user_id, item_type, item_id, state, snooze_until, note,
            created_at, updated_at
       FROM user_watchlist_state
      WHERE user_id = $1 AND item_type = $2 AND item_id = $3
      LIMIT 1`,
    [u, t, i],
  );
  return rows[0] || null;
}

/**
 * List entries for a user. Filters:
 *   itemType  optional restrict
 *   state     optional restrict
 *   active    if true, exclude expired snooze entries (default true)
 */
export async function listWatchlist(client, options = {}) {
  await ensureWatchlistSchema(client);
  const userId = normalizeUserId(options.userId);
  const itemType = options.itemType ? String(options.itemType).toLowerCase() : null;
  const state = options.state ? String(options.state).toLowerCase() : null;
  const active = options.active !== false;
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 200));

  const params = [userId];
  let where = `user_id = $1`;
  if (itemType) {
    params.push(itemType);
    where += ` AND item_type = $${params.length}`;
  }
  if (state) {
    params.push(state);
    where += ` AND state = $${params.length}`;
  }
  if (active) {
    where += ` AND (state <> 'snooze' OR snooze_until IS NULL OR snooze_until > NOW())`;
  }
  params.push(limit);
  const { rows } = await client.query(
    `SELECT id, user_id, item_type, item_id, state, snooze_until, note,
            created_at, updated_at
       FROM user_watchlist_state
      WHERE ${where}
      ORDER BY updated_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

/**
 * Sweep expired snoozes — convert them back to absent (delete the row) so
 * the item reappears in primary surfaces. Intended to run on a daemon cron.
 */
export async function purgeExpiredSnoozes(client) {
  await ensureWatchlistSchema(client);
  const { rowCount } = await client.query(
    `DELETE FROM user_watchlist_state
       WHERE state = 'snooze' AND snooze_until IS NOT NULL AND snooze_until <= NOW()`,
  );
  return { purgedCount: rowCount };
}
