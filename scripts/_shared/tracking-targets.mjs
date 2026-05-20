/**
 * User-defined tracking targets.
 *
 * This is intentionally a private/operator tracking layer. Creating a target
 * can pin it to the dashboard and match historical articles, but it must not
 * mutate canonical themes, discovery topics, model features, or training data.
 */

const TRACKED_TARGET_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tracked_targets (
     id BIGSERIAL PRIMARY KEY,
     user_id VARCHAR(120) NOT NULL DEFAULT 'default',
     label TEXT NOT NULL,
     target_type VARCHAR(32) NOT NULL
       CHECK (target_type IN ('keyword', 'symbol', 'company', 'theme_candidate')),
     normalized_key TEXT NOT NULL,
     aliases TEXT[] NOT NULL DEFAULT '{}'::text[],
     symbols TEXT[] NOT NULL DEFAULT '{}'::text[],
     priority VARCHAR(16) NOT NULL DEFAULT 'normal'
       CHECK (priority IN ('low', 'normal', 'high')),
     pin_to_home BOOLEAN NOT NULL DEFAULT true,
     promote_to_main BOOLEAN NOT NULL DEFAULT false,
     status VARCHAR(16) NOT NULL DEFAULT 'active'
       CHECK (status IN ('active', 'muted', 'archived')),
     quality_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
     metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (user_id, normalized_key)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_tracked_targets_user_status
     ON tracked_targets (user_id, status, priority, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tracked_targets_pin
     ON tracked_targets (user_id, pin_to_home, status, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS tracked_target_hits (
     id BIGSERIAL PRIMARY KEY,
     target_id BIGINT NOT NULL REFERENCES tracked_targets(id) ON DELETE CASCADE,
     source_type VARCHAR(32) NOT NULL,
     source_id TEXT NOT NULL,
     matched_alias TEXT,
     confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
     matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     source_published_at TIMESTAMPTZ,
     metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
     UNIQUE (target_id, source_type, source_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_tracked_target_hits_target_time
     ON tracked_target_hits (target_id, source_published_at DESC NULLS LAST, matched_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tracked_target_hits_source
     ON tracked_target_hits (source_type, source_id)`,
];

const VALID_TARGET_TYPES = new Set(['keyword', 'symbol', 'company', 'theme_candidate']);
const VALID_PRIORITIES = new Set(['low', 'normal', 'high']);
const VALID_STATUSES = new Set(['active', 'muted', 'archived']);
const BROAD_TERMS = new Set([
  'ai',
  'oil',
  'gas',
  'war',
  'tech',
  'data',
  'market',
  'energy',
  'china',
  'trump',
]);

let schemaEnsured = false;

function toJson(value) {
  return JSON.stringify(value ?? null);
}

function normalizeUserId(userId) {
  return String(userId || 'default').trim().slice(0, 120) || 'default';
}

function normalizeAlias(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function normalizeSymbol(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-]/g, '')
    .slice(0, 20);
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const normalized = normalizeAlias(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function normalizeTextArray(value) {
  if (Array.isArray(value)) return uniqueStrings(value);
  return uniqueStrings(String(value || '').split(','));
}

function normalizeSymbolArray(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const symbol = normalizeSymbol(item);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

function inferTargetType(input = {}, symbols = []) {
  const raw = String(input.targetType || input.target_type || input.type || '').trim().toLowerCase();
  if (VALID_TARGET_TYPES.has(raw)) return raw;
  return symbols.length ? 'symbol' : 'keyword';
}

function buildQualityFlags({ aliases, symbols, targetType }) {
  const flags = [];
  const shortAliases = aliases.filter((alias) => alias.length < 3 && !symbols.includes(alias.toUpperCase()));
  if (shortAliases.length) flags.push({ code: 'short-alias', detail: shortAliases.slice(0, 5) });
  const broad = aliases.filter((alias) => BROAD_TERMS.has(alias.toLowerCase()));
  if (broad.length) flags.push({ code: 'broad-term', detail: broad.slice(0, 5) });
  if (targetType === 'symbol' && !symbols.length) flags.push({ code: 'missing-symbol', detail: 'symbol target should include at least one ticker' });
  return flags;
}

function normalizeTargetInput(input = {}) {
  const userId = normalizeUserId(input.userId || input.user_id);
  const symbols = normalizeSymbolArray(input.symbols);
  const label = normalizeAlias(input.label || input.name || symbols[0] || input.normalizedKey || input.normalized_key);
  const targetType = inferTargetType(input, symbols);
  if (!label) throw new Error('tracking target label is required');
  if (!VALID_TARGET_TYPES.has(targetType)) throw new Error(`invalid tracking target type: ${targetType}`);
  const rawAliases = normalizeTextArray(input.aliases);
  const aliases = uniqueStrings([label, ...rawAliases, ...symbols]);
  const searchableAliases = aliases.filter((alias) => alias.length >= 3 || symbols.includes(alias.toUpperCase()));
  if (!searchableAliases.length) throw new Error('tracking target needs at least one searchable alias');
  const priority = VALID_PRIORITIES.has(String(input.priority || '').toLowerCase())
    ? String(input.priority).toLowerCase()
    : 'normal';
  const normalizedKey = normalizeKey(input.normalizedKey || input.normalized_key || `${targetType}-${symbols[0] || label}`);
  if (!normalizedKey) throw new Error('tracking target normalized key could not be derived');
  const status = VALID_STATUSES.has(String(input.status || '').toLowerCase())
    ? String(input.status).toLowerCase()
    : 'active';
  const qualityFlags = buildQualityFlags({ aliases, symbols, targetType });
  return {
    userId,
    label,
    targetType,
    normalizedKey,
    aliases,
    searchableAliases,
    symbols,
    priority,
    pinToHome: input.pinToHome ?? input.pin_to_home ?? true,
    promoteToMain: input.promoteToMain ?? input.promote_to_main ?? false,
    status,
    qualityFlags,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  };
}
function mapTargetRow(row = {}) {
  return {
    id: String(row.id),
    userId: row.user_id,
    label: row.label,
    targetType: row.target_type,
    normalizedKey: row.normalized_key,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    symbols: Array.isArray(row.symbols) ? row.symbols : [],
    priority: row.priority,
    pinToHome: Boolean(row.pin_to_home),
    promoteToMain: Boolean(row.promote_to_main),
    status: row.status,
    qualityFlags: Array.isArray(row.quality_flags) ? row.quality_flags : [],
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    hitCount: Number(row.hit_count || 0),
    recentHitCount: Number(row.recent_hit_count || 0),
    latestHitAt: row.latest_hit_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    isolation: 'private-tracking-only',
  };
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (match) => `\\${match}`);
}

function scoreArticleMatch(alias, row = {}) {
  const needle = String(alias || '').toLowerCase();
  const title = String(row.title || '').toLowerCase();
  const summary = String(row.summary || '').toLowerCase();
  if (!needle) return 0;
  if (title === needle) return 0.98;
  if (title.includes(needle)) return 0.86;
  if (summary.includes(needle)) return 0.68;
  return 0.5;
}

export async function ensureTrackingTargetsSchema(client) {
  if (schemaEnsured) return;
  for (const ddl of TRACKED_TARGET_SCHEMA) {
    await client.query(ddl);
  }
  schemaEnsured = true;
}

export async function upsertTrackedTarget(client, input = {}) {
  await ensureTrackingTargetsSchema(client);
  const target = normalizeTargetInput(input);
  const { rows } = await client.query(
    `INSERT INTO tracked_targets (
       user_id, label, target_type, normalized_key, aliases, symbols, priority,
       pin_to_home, promote_to_main, status, quality_flags, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)
     ON CONFLICT (user_id, normalized_key) DO UPDATE
       SET label = EXCLUDED.label,
           target_type = EXCLUDED.target_type,
           aliases = EXCLUDED.aliases,
           symbols = EXCLUDED.symbols,
           priority = EXCLUDED.priority,
           pin_to_home = EXCLUDED.pin_to_home,
           promote_to_main = EXCLUDED.promote_to_main,
           status = EXCLUDED.status,
           quality_flags = EXCLUDED.quality_flags,
           metadata = tracked_targets.metadata || EXCLUDED.metadata,
           updated_at = NOW()
     RETURNING *`,
    [
      target.userId,
      target.label,
      target.targetType,
      target.normalizedKey,
      target.aliases,
      target.symbols,
      target.priority,
      Boolean(target.pinToHome),
      Boolean(target.promoteToMain),
      target.status,
      toJson(target.qualityFlags),
      toJson({
        ...target.metadata,
        pollutionBoundary: 'private-tracking-only',
        promotionRequiresReview: true,
      }),
    ],
  );
  return mapTargetRow(rows[0]);
}

export async function updateTrackedTarget(client, targetId, patch = {}) {
  await ensureTrackingTargetsSchema(client);
  const current = await getTrackedTarget(client, targetId, { includeArchived: true });
  if (!current) throw new Error(`tracking target not found: ${targetId}`);
  return upsertTrackedTarget(client, {
    userId: current.userId,
    label: patch.label ?? current.label,
    targetType: patch.targetType ?? patch.target_type ?? current.targetType,
    normalizedKey: current.normalizedKey,
    aliases: patch.aliases ?? current.aliases,
    symbols: patch.symbols ?? current.symbols,
    priority: patch.priority ?? current.priority,
    pinToHome: patch.pinToHome ?? patch.pin_to_home ?? current.pinToHome,
    promoteToMain: patch.promoteToMain ?? patch.promote_to_main ?? current.promoteToMain,
    status: patch.status ?? current.status,
    metadata: {
      ...current.metadata,
      ...(patch.metadata && typeof patch.metadata === 'object' ? patch.metadata : {}),
    },
  });
}

export async function archiveTrackedTarget(client, targetId, { userId = 'default' } = {}) {
  await ensureTrackingTargetsSchema(client);
  const { rows } = await client.query(
    `UPDATE tracked_targets
        SET status = 'archived', pin_to_home = false, updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [String(targetId), normalizeUserId(userId)],
  );
  return rows[0] ? mapTargetRow(rows[0]) : null;
}

export async function getTrackedTarget(client, targetId, { includeArchived = false, userId = 'default' } = {}) {
  await ensureTrackingTargetsSchema(client);
  const params = [String(targetId), normalizeUserId(userId)];
  let where = `id = $1 AND user_id = $2`;
  if (!includeArchived) where += ` AND status <> 'archived'`;
  const { rows } = await client.query(
    `SELECT * FROM tracked_targets WHERE ${where} LIMIT 1`,
    params,
  );
  return rows[0] ? mapTargetRow(rows[0]) : null;
}

export async function listTrackedTargets(client, options = {}) {
  await ensureTrackingTargetsSchema(client);
  const userId = normalizeUserId(options.userId);
  const status = options.status ? String(options.status).toLowerCase() : null;
  const pinsOnly = options.pinToHome === true;
  const includeArchived = options.includeArchived === true;
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
  const params = [userId];
  let where = `t.user_id = $1`;
  if (status && VALID_STATUSES.has(status)) {
    params.push(status);
    where += ` AND t.status = $${params.length}`;
  } else if (!includeArchived) {
    where += ` AND t.status <> 'archived'`;
  }
  if (pinsOnly) where += ` AND t.pin_to_home = true`;
  params.push(limit);
  const { rows } = await client.query(
    `WITH hit_summary AS (
       SELECT
         target_id,
         COUNT(*)::int AS hit_count,
         COUNT(*) FILTER (WHERE source_published_at >= NOW() - INTERVAL '7 days')::int AS recent_hit_count,
         MAX(source_published_at) AS latest_hit_at
       FROM tracked_target_hits
       GROUP BY target_id
     )
     SELECT t.*,
            COALESCE(h.hit_count, 0) AS hit_count,
            COALESCE(h.recent_hit_count, 0) AS recent_hit_count,
            h.latest_hit_at
       FROM tracked_targets t
       LEFT JOIN hit_summary h ON h.target_id = t.id
      WHERE ${where}
      ORDER BY
        CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
        t.pin_to_home DESC,
        COALESCE(h.latest_hit_at, t.updated_at) DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows.map(mapTargetRow);
}

export async function refreshTrackedTargetHits(client, targetId, options = {}) {
  await ensureTrackingTargetsSchema(client);
  const target = await getTrackedTarget(client, targetId, {
    userId: options.userId || 'default',
    includeArchived: true,
  });
  if (!target) throw new Error(`tracking target not found: ${targetId}`);
  const lookbackDays = Math.max(1, Math.min(1825, Number(options.lookbackDays || options.days || 180)));
  const maxPerAlias = Math.max(1, Math.min(250, Number(options.maxPerAlias || 80)));
  const aliases = uniqueStrings([...(target.aliases || []), ...(target.symbols || [])])
    .filter((alias) => alias.length >= 3 || target.symbols.includes(alias.toUpperCase()))
    .slice(0, 20);
  let scanned = 0;
  let insertedOrUpdated = 0;
  const matchedAliases = new Set();
  for (const alias of aliases) {
    const pattern = `%${escapeLike(alias)}%`;
    const { rows } = await client.query(
      `SELECT id, source, theme, published_at, title, summary, url
         FROM articles
        WHERE published_at >= NOW() - ($1::int * INTERVAL '1 day')
          AND (title ILIKE $2 ESCAPE '\\' OR summary ILIKE $2 ESCAPE '\\')
        ORDER BY published_at DESC NULLS LAST
        LIMIT $3`,
      [lookbackDays, pattern, maxPerAlias],
    );
    scanned += rows.length;
    if (rows.length) matchedAliases.add(alias);
    for (const row of rows) {
      const confidence = scoreArticleMatch(alias, row);
      const result = await client.query(
        `INSERT INTO tracked_target_hits (
           target_id, source_type, source_id, matched_alias, confidence,
           source_published_at, metadata
         ) VALUES ($1,'article',$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT (target_id, source_type, source_id) DO UPDATE
           SET matched_alias = EXCLUDED.matched_alias,
               confidence = GREATEST(tracked_target_hits.confidence, EXCLUDED.confidence),
               source_published_at = COALESCE(EXCLUDED.source_published_at, tracked_target_hits.source_published_at),
               metadata = tracked_target_hits.metadata || EXCLUDED.metadata,
               matched_at = NOW()
         RETURNING id`,
        [
          target.id,
          String(row.id),
          alias,
          confidence,
          row.published_at || null,
          toJson({
            title: row.title || '',
            source: row.source || '',
            theme: row.theme || '',
            url: row.url || '',
            pollutionBoundary: 'tracked_target_hits_only',
          }),
        ],
      );
      insertedOrUpdated += result.rowCount || 0;
    }
  }
  await client.query(
    `UPDATE tracked_targets
        SET metadata = metadata || $2::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [
      target.id,
      toJson({
        lastBackfillAt: new Date().toISOString(),
        lastBackfillDays: lookbackDays,
        lastMatchedAliases: [...matchedAliases],
      }),
    ],
  );
  return {
    ok: true,
    targetId: target.id,
    scanned,
    matchedAliases: [...matchedAliases],
    insertedOrUpdated,
    lookbackDays,
    isolation: 'no-canonical-writes',
  };
}

export async function buildTrackedTargetsPayload(client, params = new URLSearchParams()) {
  const targets = await listTrackedTargets(client, {
    userId: params.get('user') || 'default',
    status: params.get('status'),
    pinToHome: params.get('pin') === '1',
    includeArchived: params.get('include_archived') === '1',
    limit: Number(params.get('limit') || 50),
  });
  const targetIds = targets.map((target) => Number(target.id)).filter(Number.isFinite);
  const hitLimit = Math.max(1, Math.min(100, Number(params.get('hits') || 30)));
  let hits = [];
  if (targetIds.length) {
    const { rows } = await client.query(
      `SELECT h.target_id, h.source_type, h.source_id, h.matched_alias, h.confidence,
              h.matched_at, h.source_published_at, h.metadata
         FROM tracked_target_hits h
        WHERE h.target_id = ANY($1::bigint[])
        ORDER BY h.source_published_at DESC NULLS LAST, h.matched_at DESC
        LIMIT $2`,
      [targetIds, hitLimit],
    );
    hits = rows.map((row) => ({
      targetId: String(row.target_id),
      sourceType: row.source_type,
      sourceId: row.source_id,
      matchedAlias: row.matched_alias,
      confidence: Number(row.confidence || 0),
      matchedAt: row.matched_at,
      sourcePublishedAt: row.source_published_at,
      metadata: row.metadata || {},
    }));
  }
  return {
    ok: true,
    count: targets.length,
    targets,
    hits,
    isolation: {
      writeTables: ['tracked_targets', 'tracked_target_hits'],
      blockedAutoPromotion: true,
      note: 'Tracked targets are private operator preferences until separately reviewed for promotion.',
    },
  };
}

export async function buildTrackingDataPathAudit(client) {
  await ensureTrackingTargetsSchema(client);
  const triggerRows = await client.query(
    `SELECT tgname, tgrelid::regclass::text AS table_name
       FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgrelid IN ('tracked_targets'::regclass, 'tracked_target_hits'::regclass)
      ORDER BY table_name, tgname`,
  );
  const constraintRows = await client.query(
    `SELECT conname,
            conrelid::regclass::text AS source_table,
            confrelid::regclass::text AS target_table
       FROM pg_constraint
      WHERE contype = 'f'
        AND (
          conrelid IN ('tracked_targets'::regclass, 'tracked_target_hits'::regclass)
          OR confrelid IN ('tracked_targets'::regclass, 'tracked_target_hits'::regclass)
        )
      ORDER BY source_table, target_table, conname`,
  );
  const unexpectedFk = constraintRows.rows.filter((row) => !(
    row.source_table === 'tracked_target_hits' && row.target_table === 'tracked_targets'
  ));
  const passed = triggerRows.rows.length === 0 && unexpectedFk.length === 0;
  return {
    ok: passed,
    level: passed ? 'ok' : 'warning',
    flow: [
      'UI/API input',
      'tracked_targets',
      'tracked_target_hits',
      'dashboard surfaces',
    ],
    allowedWriteTables: ['tracked_targets', 'tracked_target_hits'],
    forbiddenAutoWriteTables: [
      'discovery_topics',
      'auto_article_themes',
      'auto_theme_symbols',
      'model_predictions',
      'model_eval',
      'labeled_outcomes',
    ],
    triggers: triggerRows.rows,
    foreignKeys: constraintRows.rows,
    unexpectedForeignKeys: unexpectedFk,
    note: 'No database trigger or foreign-key path should promote user targets into canonical discovery/model tables.',
  };
}
