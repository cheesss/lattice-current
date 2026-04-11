import { createHash } from 'node:crypto';
import { getThemeConfig, resolveThemeTaxonomy } from './theme-taxonomy.mjs';

const REVIEW_DECISIONS = new Set(['canonical', 'watch', 'suppressed']);
const ALERT_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const NOTE_STATUS = new Set(['active', 'archived']);

export const TREND_WORKBENCH_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS discovery_topic_reviews (
      review_key TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES discovery_topics(id) ON DELETE CASCADE,
      decision TEXT NOT NULL CHECK (decision IN ('canonical', 'watch', 'suppressed')),
      reason TEXT,
      reviewer TEXT NOT NULL DEFAULT 'dashboard-api',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_discovery_topic_reviews_topic
      ON discovery_topic_reviews (topic_id, decided_at DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS theme_structural_alerts (
      alert_key TEXT PRIMARY KEY,
      theme TEXT NOT NULL,
      label TEXT,
      parent_theme TEXT,
      category TEXT,
      period_type TEXT NOT NULL DEFAULT 'week',
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical', 'high', 'medium', 'low')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed')),
      headline TEXT NOT NULL,
      detail TEXT,
      alert_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      evidence_classes JSONB NOT NULL DEFAULT '[]'::jsonb,
      provenance JSONB NOT NULL DEFAULT '[]'::jsonb,
      snapshot_date DATE,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      dismissed_at TIMESTAMPTZ,
      source TEXT NOT NULL DEFAULT 'structural-alert-generator',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_theme_structural_alerts_lookup
      ON theme_structural_alerts (status, severity, period_type, updated_at DESC);
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_theme_structural_alerts_theme
      ON theme_structural_alerts (theme, status, updated_at DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS theme_brief_notebook_entries (
      entry_key TEXT PRIMARY KEY,
      theme TEXT NOT NULL,
      period_type TEXT NOT NULL DEFAULT 'quarter',
      title TEXT NOT NULL,
      note_text TEXT NOT NULL DEFAULT '',
      tags TEXT[] NOT NULL DEFAULT '{}'::text[],
      pinned BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      share_slug TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_theme_brief_notebook_entries_theme
      ON theme_brief_notebook_entries (theme, status, pinned DESC, updated_at DESC);
  `,
];

function safeTrim(value) {
  return String(value ?? '').trim();
}

function normalizeTheme(value) {
  return safeTrim(value).toLowerCase();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function unique(values = []) {
  return Array.from(new Set(asArray(values).map((value) => safeTrim(value)).filter(Boolean)));
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function round(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function toJson(value) {
  return JSON.stringify(value ?? {});
}

function normalizeCategory(value) {
  return safeTrim(value).toLowerCase();
}

function normalizeParentTheme(value) {
  return normalizeTheme(value);
}

function buildHash(prefix, payload = {}) {
  return `${prefix}-${createHash('sha1').update(JSON.stringify(payload)).digest('hex')}`;
}

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}

function normalizeDecision(value) {
  const normalized = safeTrim(value).toLowerCase();
  return REVIEW_DECISIONS.has(normalized) ? normalized : 'watch';
}

function normalizeSeverity(value) {
  const normalized = safeTrim(value).toLowerCase();
  return ALERT_SEVERITIES.has(normalized) ? normalized : 'medium';
}

function normalizeStatus(value) {
  const normalized = safeTrim(value).toLowerCase();
  return normalized === 'dismissed' ? 'dismissed' : 'open';
}

function normalizeNoteStatus(value) {
  const normalized = safeTrim(value).toLowerCase();
  return NOTE_STATUS.has(normalized) ? normalized : 'active';
}

export async function ensureTrendWorkbenchSchema(queryable) {
  for (const statement of TREND_WORKBENCH_SCHEMA_STATEMENTS) {
    await queryable.query(statement);
  }
}

function deriveDiscoveryStructuralScore(row) {
  const articleCount = clamp(Number(row?.article_count || row?.articleCount || 0) / 60, 0, 1);
  const momentum = clamp(Number(row?.momentum || 0) / 3, 0, 1);
  const researchMomentum = clamp(Number(row?.research_momentum || row?.researchMomentum || 0) / 2, 0, 1);
  const novelty = clamp(Number(row?.novelty || 0), 0, 1);
  const sourceQuality = clamp(Number(row?.source_quality_score || row?.sourceQualityScore || 0), 0, 1);
  return round(
    articleCount * 0.22
    + momentum * 0.22
    + researchMomentum * 0.14
    + novelty * 0.18
    + sourceQuality * 0.24,
    4,
  );
}

function mapDiscoveryTriageRow(row) {
  const review = row?.last_review_decision ? {
    decision: normalizeDecision(row.last_review_decision),
    reason: safeTrim(row.last_review_reason),
    reviewer: safeTrim(row.last_reviewer) || 'unknown',
    decidedAt: row.last_decided_at || null,
  } : null;
  const theme = normalizeTheme(row?.normalized_theme || '');
  const taxonomy = theme ? resolveThemeTaxonomy(theme) : null;
  return {
    id: safeTrim(row?.id),
    label: safeTrim(row?.label) || safeTrim(row?.id),
    category: normalizeCategory(row?.normalized_category || row?.category),
    parentTheme: normalizeParentTheme(row?.normalized_parent_theme || row?.parent_theme),
    normalizedTheme: theme || null,
    normalizedThemeLabel: taxonomy?.themeLabel || null,
    promotionState: normalizeDecision(row?.promotion_state || 'watch'),
    suppressionReason: safeTrim(row?.suppression_reason) || null,
    qualityFlags: asArray(row?.quality_flags),
    status: safeTrim(row?.status || 'reported'),
    articleCount: Number(row?.article_count || 0),
    momentum: round(row?.momentum || 0, 2),
    researchMomentum: round(row?.research_momentum || 0, 2),
    novelty: round(row?.novelty || 0, 2),
    sourceQualityScore: round(row?.source_quality_score || 0, 2),
    structuralScore: deriveDiscoveryStructuralScore(row),
    updatedAt: row?.updated_at || null,
    lastReview: review,
    keywords: unique(row?.keywords || []).slice(0, 8),
  };
}

export async function buildDiscoveryTriagePayload(safeQuery, params = new URLSearchParams()) {
  await ensureTrendWorkbenchSchema({ query: safeQuery });
  const decision = normalizeDecision(params.get('decision') || params.get('promotion_state') || '');
  const category = normalizeCategory(params.get('category') || '');
  const parentTheme = normalizeParentTheme(params.get('parent_theme') || '');
  const limit = clamp(Number(params.get('limit') || 12), 1, 40);
  const includeSuppressed = params.get('include_suppressed') === '1';
  const values = [];
  let index = 1;
  let filterSql = `WHERE dt.status IN ('labeled', 'reported')`;
  if (params.has('decision') || params.has('promotion_state')) {
    filterSql += ` AND COALESCE(dt.promotion_state, 'watch') = $${index++}`;
    values.push(decision);
  } else if (!includeSuppressed) {
    filterSql += ` AND COALESCE(dt.promotion_state, 'watch') <> 'suppressed'`;
  }
  if (category) {
    filterSql += ` AND COALESCE(NULLIF(dt.normalized_category, ''), dt.category) = $${index++}`;
    values.push(category);
  }
  if (parentTheme) {
    filterSql += ` AND COALESCE(NULLIF(dt.normalized_parent_theme, ''), dt.parent_theme) = $${index++}`;
    values.push(parentTheme);
  }
  values.push(limit);
  const rows = await safeQuery(`
    SELECT
      dt.id,
      dt.label,
      dt.category,
      dt.parent_theme,
      dt.normalized_theme,
      dt.normalized_parent_theme,
      dt.normalized_category,
      dt.promotion_state,
      dt.suppression_reason,
      dt.quality_flags,
      dt.status,
      dt.article_count,
      dt.momentum,
      dt.research_momentum,
      dt.novelty,
      dt.source_quality_score,
      dt.keywords,
      dt.updated_at,
      review.decision AS last_review_decision,
      review.reason AS last_review_reason,
      review.reviewer AS last_reviewer,
      review.decided_at AS last_decided_at
    FROM discovery_topics dt
    LEFT JOIN LATERAL (
      SELECT decision, reason, reviewer, decided_at
      FROM discovery_topic_reviews review
      WHERE review.topic_id = dt.id
      ORDER BY review.decided_at DESC
      LIMIT 1
    ) review ON TRUE
    ${filterSql}
    ORDER BY
      CASE COALESCE(dt.promotion_state, 'watch')
        WHEN 'watch' THEN 0
        WHEN 'canonical' THEN 1
        ELSE 2
      END,
      dt.momentum DESC NULLS LAST,
      dt.article_count DESC,
      dt.updated_at DESC
    LIMIT $${index}
  `, values);

  const summaryRows = await safeQuery(`
    SELECT
      COALESCE(dt.promotion_state, 'watch') AS promotion_state,
      COUNT(*)::int AS count
    FROM discovery_topics dt
    WHERE dt.status IN ('labeled', 'reported')
    GROUP BY COALESCE(dt.promotion_state, 'watch')
  `);
  const summary = {
    watch: 0,
    canonical: 0,
    suppressed: 0,
  };
  for (const row of summaryRows.rows) {
    summary[normalizeDecision(row.promotion_state)] = Number(row.count || 0);
  }
  const items = rows.rows.map(mapDiscoveryTriageRow);
  return {
    filters: {
      decision: params.has('decision') || params.has('promotion_state') ? decision : '',
      category,
      parentTheme,
      includeSuppressed,
      limit,
    },
    summary,
    items,
  };
}

export async function applyDiscoveryTriageDecision(queryable, input = {}) {
  await ensureTrendWorkbenchSchema(queryable);
  const topicId = safeTrim(input.topicId || input.topic_id);
  const decision = normalizeDecision(input.decision);
  const reason = safeTrim(input.reason);
  const reviewer = safeTrim(input.reviewer) || 'dashboard-api';
  const normalizedTheme = normalizeTheme(input.normalizedTheme || input.normalized_theme || '');
  const inputParentTheme = normalizeParentTheme(input.normalizedParentTheme || input.normalized_parent_theme || input.parentTheme || input.parent_theme || '');
  const inputCategory = normalizeCategory(input.normalizedCategory || input.normalized_category || input.category || '');
  if (!topicId) {
    throw new Error('topicId is required');
  }
  const topicRow = await queryable.query(`
    SELECT
      id,
      label,
      promotion_state,
      normalized_theme,
      normalized_parent_theme,
      normalized_category
    FROM discovery_topics
    WHERE id = $1
    LIMIT 1
  `, [topicId]);
  if (!topicRow.rows.length) {
    throw new Error(`Unknown discovery topic: ${topicId}`);
  }
  const reviewKey = buildHash('dtr', {
    topicId,
    decision,
    reviewer,
    decidedAt: new Date().toISOString(),
    reason,
  });
  const currentTopic = topicRow.rows[0];
  const nextTheme = normalizedTheme || safeTrim(currentTopic.normalized_theme);
  const taxonomy = nextTheme ? resolveThemeTaxonomy(nextTheme) : null;
  const nextParentTheme = normalizeParentTheme(
    taxonomy?.parentTheme
    || inputParentTheme
    || currentTopic.normalized_parent_theme,
  );
  const nextCategory = normalizeCategory(
    taxonomy?.category
    || inputCategory
    || currentTopic.normalized_category,
  );
  await queryable.query(`
    INSERT INTO discovery_topic_reviews (
      review_key,
      topic_id,
      decision,
      reason,
      reviewer,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
  `, [
    reviewKey,
    topicId,
    decision,
    reason || null,
    reviewer,
    toJson({
      previousPromotionState: normalizeDecision(currentTopic.promotion_state || 'watch'),
      previousTheme: safeTrim(currentTopic.normalized_theme) || null,
      previousParentTheme: safeTrim(currentTopic.normalized_parent_theme) || null,
      previousCategory: safeTrim(currentTopic.normalized_category) || null,
      normalizedTheme: nextTheme || null,
      appliedParentTheme: nextParentTheme || null,
      appliedCategory: nextCategory || null,
    }),
  ]);
  const updated = await queryable.query(`
    UPDATE discovery_topics
    SET
      promotion_state = $2,
      suppression_reason = CASE WHEN $2 = 'suppressed' THEN $3 ELSE NULL END,
      normalized_theme = CASE WHEN $4 <> '' THEN $4 ELSE normalized_theme END,
      normalized_parent_theme = CASE WHEN $5 <> '' THEN $5 ELSE normalized_parent_theme END,
      normalized_category = CASE WHEN $6 <> '' THEN $6 ELSE normalized_category END,
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [
    topicId,
    decision,
    reason || null,
    nextTheme || '',
    nextParentTheme || '',
    nextCategory || '',
  ]);
  return {
    ok: true,
    topic: mapDiscoveryTriageRow(updated.rows[0]),
    review: {
      reviewKey,
      topicId,
      decision,
      reason: reason || null,
      reviewer,
      normalizedTheme: nextTheme || null,
      normalizedParentTheme: nextParentTheme || null,
      normalizedCategory: nextCategory || null,
    },
  };
}

function mapAlertRow(row) {
  return {
    alertKey: safeTrim(row?.alert_key),
    theme: normalizeTheme(row?.theme),
    label: safeTrim(row?.label) || safeTrim(row?.theme),
    parentTheme: normalizeParentTheme(row?.parent_theme),
    category: normalizeCategory(row?.category),
    periodType: safeTrim(row?.period_type || 'week'),
    alertType: safeTrim(row?.alert_type),
    severity: normalizeSeverity(row?.severity),
    status: normalizeStatus(row?.status),
    headline: safeTrim(row?.headline),
    detail: safeTrim(row?.detail),
    alertScore: round(row?.alert_score || 0, 2),
    evidenceClasses: asArray(row?.evidence_classes),
    provenance: asArray(row?.provenance),
    snapshotDate: toIsoDate(row?.snapshot_date),
    firstSeenAt: row?.first_seen_at || null,
    lastSeenAt: row?.last_seen_at || null,
    updatedAt: row?.updated_at || null,
    metadata: row?.metadata || {},
  };
}

export async function buildStructuralAlertsPayload(safeQuery, params = new URLSearchParams()) {
  await ensureTrendWorkbenchSchema({ query: safeQuery });
  const themeSource = params.get('themes') || params.get('followed_themes') || '';
  const themes = unique(String(themeSource || '').split(',').map((value) => normalizeTheme(value))).slice(0, 12);
  const periodType = safeTrim(params.get('period') || 'week').toLowerCase() || 'week';
  const status = params.has('status') ? normalizeStatus(params.get('status')) : 'open';
  const limit = clamp(Number(params.get('limit') || 10), 1, 40);
  const values = [];
  let index = 1;
  let sql = `
    SELECT *
    FROM theme_structural_alerts
    WHERE status = $${index++}
      AND period_type = $${index++}
  `;
  values.push(status, periodType);
  if (themes.length) {
    sql += ` AND theme = ANY($${index++})`;
    values.push(themes);
  }
  sql += `
    ORDER BY
      CASE severity
        WHEN 'critical' THEN 0
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        ELSE 3
      END,
      alert_score DESC,
      updated_at DESC
    LIMIT $${index}
  `;
  values.push(limit);
  const rows = await safeQuery(sql, values);
  return {
    periodType,
    status,
    filters: {
      themes,
      limit,
      scope: themes.length ? 'followed' : 'all',
    },
    items: rows.rows.map(mapAlertRow),
  };
}

export async function upsertStructuralAlerts(queryable, alerts = [], options = {}) {
  await ensureTrendWorkbenchSchema(queryable);
  const source = safeTrim(options.source) || 'structural-alert-generator';
  let upserted = 0;
  for (const alert of alerts) {
    const theme = normalizeTheme(alert.theme);
    if (!theme) continue;
    const config = getThemeConfig(theme);
    const alertKey = safeTrim(alert.alertKey) || buildHash('tsa', {
      theme,
      periodType: alert.periodType || 'week',
      alertType: alert.alertType,
      headline: alert.headline,
    });
    await queryable.query(`
      INSERT INTO theme_structural_alerts (
        alert_key,
        theme,
        label,
        parent_theme,
        category,
        period_type,
        alert_type,
        severity,
        status,
        headline,
        detail,
        alert_score,
        evidence_classes,
        provenance,
        snapshot_date,
        source,
        metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16::jsonb
      )
      ON CONFLICT (alert_key) DO UPDATE
      SET
        label = EXCLUDED.label,
        parent_theme = EXCLUDED.parent_theme,
        category = EXCLUDED.category,
        severity = EXCLUDED.severity,
        headline = EXCLUDED.headline,
        detail = EXCLUDED.detail,
        alert_score = EXCLUDED.alert_score,
        evidence_classes = EXCLUDED.evidence_classes,
        provenance = EXCLUDED.provenance,
        snapshot_date = EXCLUDED.snapshot_date,
        source = EXCLUDED.source,
        metadata = EXCLUDED.metadata,
        status = 'open',
        last_seen_at = NOW(),
        updated_at = NOW(),
        dismissed_at = NULL
    `, [
      alertKey,
      theme,
      safeTrim(alert.label) || config?.label || theme,
      safeTrim(alert.parentTheme) || config?.parentTheme || theme,
      safeTrim(alert.category) || config?.category || 'other',
      safeTrim(alert.periodType || 'week'),
      safeTrim(alert.alertType || 'structural-change'),
      normalizeSeverity(alert.severity),
      safeTrim(alert.headline) || `${config?.label || theme} structural change`,
      safeTrim(alert.detail),
      Number(alert.alertScore || 0),
      JSON.stringify(asArray(alert.evidenceClasses)),
      JSON.stringify(asArray(alert.provenance)),
      toIsoDate(alert.snapshotDate || new Date()),
      source,
      toJson(alert.metadata || {}),
    ]);
    upserted += 1;
  }
  return { ok: true, upserted };
}

export async function dismissStructuralAlert(queryable, alertKey) {
  await ensureTrendWorkbenchSchema(queryable);
  const normalized = safeTrim(alertKey);
  if (!normalized) {
    throw new Error('alertKey is required');
  }
  const result = await queryable.query(`
    UPDATE theme_structural_alerts
    SET status = 'dismissed', dismissed_at = NOW(), updated_at = NOW()
    WHERE alert_key = $1
    RETURNING alert_key, theme, status
  `, [normalized]);
  if (!result.rows.length) {
    throw new Error(`Unknown structural alert: ${normalized}`);
  }
  return {
    ok: true,
    alertKey: result.rows[0].alert_key,
    theme: result.rows[0].theme,
    status: result.rows[0].status,
  };
}

function mapNotebookEntry(row) {
  return {
    entryKey: safeTrim(row?.entry_key),
    theme: normalizeTheme(row?.theme),
    periodType: safeTrim(row?.period_type || 'quarter'),
    title: safeTrim(row?.title),
    noteText: safeTrim(row?.note_text),
    tags: unique(row?.tags),
    pinned: Boolean(row?.pinned),
    status: normalizeNoteStatus(row?.status),
    shareSlug: safeTrim(row?.share_slug) || null,
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
    metadata: row?.metadata || {},
  };
}

export async function buildThemeNotebookPayload(safeQuery, themeParam, params = new URLSearchParams()) {
  await ensureTrendWorkbenchSchema({ query: safeQuery });
  const theme = normalizeTheme(themeParam);
  const status = params.has('status') ? normalizeNoteStatus(params.get('status')) : 'active';
  const limit = clamp(Number(params.get('limit') || 8), 1, 40);
  const rows = await safeQuery(`
    SELECT *
    FROM theme_brief_notebook_entries
    WHERE theme = $1
      AND status = $2
    ORDER BY pinned DESC, updated_at DESC
    LIMIT $3
  `, [theme, status, limit]);
  return {
    theme,
    status,
    items: rows.rows.map(mapNotebookEntry),
  };
}

export async function saveThemeNotebookEntry(queryable, themeParam, input = {}) {
  await ensureTrendWorkbenchSchema(queryable);
  const theme = normalizeTheme(themeParam || input.theme);
  if (!theme) {
    throw new Error('theme is required');
  }
  const title = safeTrim(input.title) || `${resolveThemeTaxonomy(theme)?.themeLabel || theme} note`;
  const noteText = safeTrim(input.noteText || input.note_text);
  const tags = unique(input.tags || []);
  const pinned = Boolean(input.pinned);
  const periodType = safeTrim(input.periodType || input.period_type || 'quarter');
  const status = normalizeNoteStatus(input.status || 'active');
  const shareSlug = safeTrim(input.shareSlug || input.share_slug) || buildHash('share', { theme, title }).slice(0, 24);
  const entryKey = safeTrim(input.entryKey || input.entry_key) || buildHash('tnb', {
    theme,
    title,
    noteText,
    pinned,
    createdAt: new Date().toISOString(),
  });
  const metadata = input.metadata || {};
  const result = await queryable.query(`
    INSERT INTO theme_brief_notebook_entries (
      entry_key,
      theme,
      period_type,
      title,
      note_text,
      tags,
      pinned,
      status,
      share_slug,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10::jsonb)
    ON CONFLICT (entry_key) DO UPDATE
    SET
      period_type = EXCLUDED.period_type,
      title = EXCLUDED.title,
      note_text = EXCLUDED.note_text,
      tags = EXCLUDED.tags,
      pinned = EXCLUDED.pinned,
      status = EXCLUDED.status,
      share_slug = EXCLUDED.share_slug,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING *
  `, [
    entryKey,
    theme,
    periodType,
    title,
    noteText,
    tags,
    pinned,
    status,
    shareSlug,
    toJson(metadata),
  ]);
  return {
    ok: true,
    entry: mapNotebookEntry(result.rows[0]),
  };
}

export async function archiveThemeNotebookEntry(queryable, themeParam, entryKey) {
  await ensureTrendWorkbenchSchema(queryable);
  const theme = normalizeTheme(themeParam);
  const normalizedKey = safeTrim(entryKey);
  if (!theme || !normalizedKey) {
    throw new Error('theme and entryKey are required');
  }
  const result = await queryable.query(`
    UPDATE theme_brief_notebook_entries
    SET status = 'archived', updated_at = NOW()
    WHERE theme = $1 AND entry_key = $2
    RETURNING *
  `, [theme, normalizedKey]);
  if (!result.rows.length) {
    throw new Error(`Unknown notebook entry: ${normalizedKey}`);
  }
  return {
    ok: true,
    entry: mapNotebookEntry(result.rows[0]),
  };
}

function listToMarkdown(items = []) {
  return asArray(items)
    .filter(Boolean)
    .map((item) => `- ${String(item).trim()}`)
    .join('\n');
}

function extractBriefStrings(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractBriefStrings(entry));
  }
  if (typeof value === 'string') {
    return safeTrim(value) ? [safeTrim(value)] : [];
  }
  if (typeof value === 'object') {
    return ['detail', 'summary', 'title', 'trigger', 'implication', 'note', 'watchpoint']
      .map((key) => safeTrim(value[key]))
      .filter(Boolean)
      .slice(0, 1);
  }
  return [];
}

export function buildThemeBriefMarkdownExport(briefPayload = {}, notebookEntries = []) {
  const theme = safeTrim(briefPayload?.label || briefPayload?.theme || 'Theme');
  const periodType = safeTrim(briefPayload?.periodType || 'quarter');
  const sections = briefPayload?.sections || {};
  const summary = briefPayload?.summary || {};
  const lines = [
    `# ${theme} ${periodType[0]?.toUpperCase?.() ? `${periodType[0].toUpperCase()}${periodType.slice(1)}` : periodType} Brief`,
    '',
    `- Lifecycle: ${summary.lifecycleStage || 'n/a'}`,
    `- YoY: ${summary.vsYearAgoPct ?? 'n/a'}`,
    `- Acceleration: ${summary.acceleration ?? 'n/a'}`,
    '',
    '## What Changed',
    listToMarkdown(extractBriefStrings(sections.whatChanged)),
    '',
    '## Why It Matters',
    listToMarkdown(extractBriefStrings([sections.whyItMatters?.summary, ...(sections.whyItMatters?.statements || [])])),
    '',
    '## Risks',
    listToMarkdown(extractBriefStrings(sections.risks)),
    '',
    '## Watch Next',
    listToMarkdown(extractBriefStrings(sections.watchpoints)),
  ];
  if (notebookEntries.length) {
    lines.push('', '## Notebook');
    notebookEntries.forEach((entry) => {
      lines.push(`- ${entry.title}: ${entry.noteText}`);
    });
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
