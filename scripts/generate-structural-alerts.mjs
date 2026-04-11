#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { getThemeConfig } from './_shared/theme-taxonomy.mjs';
import { ensureTrendWorkbenchSchema, upsertStructuralAlerts } from './_shared/trend-workbench.mjs';

loadOptionalEnvFile();

const { Client } = pg;
const DEFAULT_PERIOD = 'week';
export const PERIOD_WINDOW_DAYS = Object.freeze({
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
});

const ATTACHMENT_LOOKBACK_DAYS = Object.freeze({
  week: 21,
  month: 45,
  quarter: 120,
  year: 400,
});

function safeTrim(value) {
  return String(value ?? '').trim();
}

function normalizeTheme(value) {
  return safeTrim(value).toLowerCase();
}

function round(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function unique(values = []) {
  return Array.from(new Set(asArray(values).map((value) => safeTrim(value)).filter(Boolean)));
}

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    period: DEFAULT_PERIOD,
    limit: 80,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--period') {
      parsed.period = safeTrim(argv[index + 1] || DEFAULT_PERIOD).toLowerCase() || DEFAULT_PERIOD;
      index += 1;
    } else if (token === '--limit') {
      parsed.limit = Math.max(1, Math.min(200, Number(argv[index + 1]) || parsed.limit));
      index += 1;
    } else if (token === '--dry-run') {
      parsed.dryRun = true;
    }
  }
  return parsed;
}

function buildLifecycleAlert(snapshot) {
  if (!snapshot.prevLifecycleStage || snapshot.prevLifecycleStage === snapshot.lifecycleStage) return null;
  const label = snapshot.label || snapshot.theme;
  const severity = ['nascent', 'emerging'].includes(String(snapshot.lifecycleStage || '')) ? 'high' : 'medium';
  return {
    theme: snapshot.theme,
    label,
    parentTheme: snapshot.parentTheme,
    category: snapshot.category,
    periodType: snapshot.periodType,
    alertType: 'lifecycle-transition',
    severity,
    headline: `${label} shifted from ${snapshot.prevLifecycleStage} to ${snapshot.lifecycleStage}`,
    detail: `${label} changed lifecycle state on the latest ${snapshot.periodType} aggregate. YoY is ${round(snapshot.vsYearAgoPct, 1)}% and acceleration is ${round(snapshot.acceleration, 1)}%.`,
    alertScore: round(Math.abs(Number(snapshot.vsYearAgoPct || 0)) * 0.35 + Math.abs(Number(snapshot.acceleration || 0)) * 0.25 + 30, 2),
    evidenceClasses: [{ evidenceClass: 'trend_snapshot', label: 'Trend aggregate', count: 1 }],
    provenance: [{
      evidenceClass: 'trend_snapshot',
      sourceType: 'trend_snapshot',
      label: `${label} lifecycle transition`,
      detail: `${snapshot.prevLifecycleStage} -> ${snapshot.lifecycleStage}`,
      periodType: snapshot.periodType,
      snapshotDate: snapshot.periodEnd,
    }],
    snapshotDate: snapshot.periodEnd,
    metadata: {
      previousLifecycleStage: snapshot.prevLifecycleStage,
      currentLifecycleStage: snapshot.lifecycleStage,
    },
  };
}

function buildMomentumAlert(snapshot) {
  const vsPrevious = Number(snapshot.vsPreviousPct || 0);
  const acceleration = Number(snapshot.acceleration || 0);
  if (!(vsPrevious >= 45 && acceleration >= 12)) return null;
  const label = snapshot.label || snapshot.theme;
  const severity = vsPrevious >= 90 || acceleration >= 25 ? 'critical' : 'high';
  return {
    theme: snapshot.theme,
    label,
    parentTheme: snapshot.parentTheme,
    category: snapshot.category,
    periodType: snapshot.periodType,
    alertType: 'acceleration-breakout',
    severity,
    headline: `${label} is breaking out on structural momentum`,
    detail: `${label} rose ${round(vsPrevious, 1)}% versus the previous ${snapshot.periodType} window with acceleration at ${round(acceleration, 1)}%.`,
    alertScore: round(vsPrevious * 0.5 + acceleration * 0.5, 2),
    evidenceClasses: [{ evidenceClass: 'trend_snapshot', label: 'Trend aggregate', count: 1 }],
    provenance: [{
      evidenceClass: 'trend_snapshot',
      sourceType: 'trend_snapshot',
      label: `${label} acceleration breakout`,
      detail: `vsPrevious ${round(vsPrevious, 1)}%, acceleration ${round(acceleration, 1)}%`,
      periodType: snapshot.periodType,
      snapshotDate: snapshot.periodEnd,
    }],
    snapshotDate: snapshot.periodEnd,
    metadata: {
      vsPreviousPct: round(vsPrevious, 2),
      acceleration: round(acceleration, 2),
      sourceDiversity: snapshot.sourceDiversity,
    },
  };
}

function buildCoolingAlert(snapshot) {
  const vsPrevious = Number(snapshot.vsPreviousPct || 0);
  const acceleration = Number(snapshot.acceleration || 0);
  const vsYearAgo = Number(snapshot.vsYearAgoPct || 0);
  if (!(vsPrevious <= -25 || acceleration <= -15 || vsYearAgo <= -20)) return null;
  const label = snapshot.label || snapshot.theme;
  return {
    theme: snapshot.theme,
    label,
    parentTheme: snapshot.parentTheme,
    category: snapshot.category,
    periodType: snapshot.periodType,
    alertType: 'cooling-reversal',
    severity: vsYearAgo <= -35 ? 'high' : 'medium',
    headline: `${label} is cooling versus its recent structural trend`,
    detail: `${label} shows weakening confirmation with ${round(vsPrevious, 1)}% vs previous period, ${round(vsYearAgo, 1)}% YoY, and acceleration ${round(acceleration, 1)}%.`,
    alertScore: round(Math.abs(vsPrevious) * 0.35 + Math.abs(vsYearAgo) * 0.35 + Math.abs(acceleration) * 0.3, 2),
    evidenceClasses: [{ evidenceClass: 'trend_snapshot', label: 'Trend aggregate', count: 1 }],
    provenance: [{
      evidenceClass: 'trend_snapshot',
      sourceType: 'trend_snapshot',
      label: `${label} cooling reversal`,
      detail: `vsPrevious ${round(vsPrevious, 1)}%, YoY ${round(vsYearAgo, 1)}%, acceleration ${round(acceleration, 1)}%`,
      periodType: snapshot.periodType,
      snapshotDate: snapshot.periodEnd,
    }],
    snapshotDate: snapshot.periodEnd,
  };
}

function buildShareJumpAlert(row) {
  const delta = Number(row.deltaSharePct || 0);
  if (Math.abs(delta) < 4) return null;
  const label = row.label || row.theme;
  const parentLabel = row.parentLabel || row.parentTheme;
  return {
    theme: row.theme,
    label,
    parentTheme: row.parentTheme,
    category: row.category,
    periodType: row.periodType,
    alertType: delta > 0 ? 'share-jump' : 'share-fade',
    severity: Math.abs(delta) >= 8 ? 'high' : 'medium',
    headline: `${label} ${delta > 0 ? 'gained' : 'lost'} share inside ${parentLabel}`,
    detail: `${label} moved ${round(delta, 1)} percentage points inside ${parentLabel}, ending at ${round(row.lastSharePct, 1)}% share.`,
    alertScore: round(Math.abs(delta) * 8 + Math.abs(Number(row.lastSharePct || 0)) * 0.5, 2),
    evidenceClasses: [{ evidenceClass: 'theme_evolution', label: 'Theme evolution', count: 1 }],
    provenance: [{
      evidenceClass: 'theme_evolution',
      sourceType: 'theme_evolution',
      label: `${label} relative share shift`,
      detail: `delta ${round(delta, 1)}pp inside ${parentLabel}`,
      periodType: row.periodType,
      snapshotDate: row.periodEnd,
    }],
    snapshotDate: row.periodEnd,
    metadata: {
      lastSharePct: round(row.lastSharePct, 2),
      deltaSharePct: round(delta, 2),
    },
  };
}

function buildEvidenceDeltaAlert(row) {
  const currentCount = Number(row.currentEvidenceCount || 0);
  const previousCount = Number(row.previousEvidenceCount || 0);
  const deltaCount = Number(row.deltaEvidenceCount || 0);
  const deltaPct = Number(row.deltaEvidencePct || 0);
  const citationDelta = Number(row.deltaCitations || 0);
  if (!(currentCount >= 2 && (deltaCount >= 2 || deltaPct >= 60 || citationDelta >= 10))) return null;
  const label = row.label || row.theme;
  const evidenceLabel = row.evidenceLabel || 'research evidence';
  return {
    theme: row.theme,
    label,
    parentTheme: row.parentTheme,
    category: row.category,
    periodType: row.periodType,
    alertType: 'evidence-delta',
    severity: deltaPct >= 120 || citationDelta >= 25 ? 'high' : 'medium',
    headline: `${label} is adding new ${evidenceLabel} faster than the prior window`,
    detail: `${label} logged ${currentCount} ${evidenceLabel} item${currentCount === 1 ? '' : 's'} in the latest ${row.periodType} window versus ${previousCount} previously, with citations delta ${round(citationDelta, 1)}.`,
    alertScore: round(currentCount * 8 + deltaCount * 10 + Math.max(deltaPct, 0) * 0.25 + Math.max(citationDelta, 0) * 0.6, 2),
    evidenceClasses: [{ evidenceClass: row.evidenceClass || 'openalex_research', label: evidenceLabel, count: currentCount }],
    provenance: [{
      evidenceClass: row.evidenceClass || 'openalex_research',
      sourceType: row.evidenceClass || 'openalex_research',
      label: `${label} evidence delta`,
      detail: `current ${currentCount}, previous ${previousCount}, delta ${deltaCount}, citations delta ${round(citationDelta, 1)}`,
      periodType: row.periodType,
      snapshotDate: row.snapshotDate,
    }],
    snapshotDate: row.snapshotDate,
    metadata: {
      currentEvidenceCount: currentCount,
      previousEvidenceCount: previousCount,
      deltaEvidenceCount: deltaCount,
      deltaEvidencePct: round(deltaPct, 2),
      currentCitations: Number(row.currentCitations || 0),
      previousCitations: Number(row.previousCitations || 0),
      deltaCitations: round(citationDelta, 2),
      evidenceClass: row.evidenceClass || 'openalex_research',
    },
  };
}

function attachmentLookbackDays(periodType) {
  return ATTACHMENT_LOOKBACK_DAYS[safeTrim(periodType || DEFAULT_PERIOD).toLowerCase()] || ATTACHMENT_LOOKBACK_DAYS.week;
}

function transmissionOrderWeight(order) {
  switch (safeTrim(order).toLowerCase()) {
    case 'direct':
      return 1;
    case 'second-order':
      return 0.88;
    case 'third-order':
      return 0.76;
    case 'fourth-order':
      return 0.64;
    case 'proxy':
      return 0.52;
    default:
      return 0.7;
  }
}

function summarizeTopSymbols(assets = []) {
  return unique(asArray(assets).map((asset) => safeTrim(asset?.symbol)).filter(Boolean)).slice(0, 4);
}

function humanizeIdentifier(value) {
  return safeTrim(value)
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function buildAttachmentAlert(row) {
  const targetTheme = normalizeTheme(row.targetTheme || row.theme);
  if (!targetTheme) return null;
  const config = getThemeConfig(targetTheme);
  const label = config?.label || safeTrim(row.targetThemeLabel) || humanizeIdentifier(targetTheme);
  const attachmentLabel = safeTrim(row.label || row.attachmentLabel);
  if (!attachmentLabel) return null;
  const relationType = safeTrim(row.relationType || 'adjacent');
  const transmissionOrder = safeTrim(row.transmissionOrder || 'proxy');
  const confidence = clamp(Number(row.confidence || 0), 0, 100);
  const weight = transmissionOrderWeight(transmissionOrder);
  const severity = confidence >= 85 ? 'high' : confidence >= 70 ? 'medium' : 'low';
  const topSymbols = summarizeTopSymbols(row.assets);
  return {
    dedupeKey: `adjacent_pathway:${safeTrim(row.attachmentKey) || `${targetTheme}:${attachmentLabel}`}`,
    alertKey: safeTrim(row.attachmentKey) ? `tsa-attach-${safeTrim(row.attachmentKey)}` : null,
    theme: targetTheme,
    label,
    parentTheme: config?.parentTheme || normalizeTheme(row.parentTheme || row.targetParentTheme || targetTheme),
    category: config?.category || normalizeTheme(row.category || row.targetCategory || 'other'),
    periodType: safeTrim(row.periodType || DEFAULT_PERIOD),
    alertType: 'adjacent_pathway',
    severity,
    headline: `${label} gained a new adjacent pathway`,
    detail: `${attachmentLabel} attaches as a ${transmissionOrder} ${relationType} route. ${safeTrim(row.transmissionPath || row.thesis || row.reason)}`,
    alertScore: round((confidence * 0.55) + (weight * 20) + (topSymbols.length * 2), 2),
    evidenceClasses: [{ evidenceClass: 'codex_attachment', label: 'Adjacent pathway', count: 1 }],
    provenance: [{
      evidenceClass: 'codex_attachment',
      sourceType: 'codex_attachment',
      label: attachmentLabel,
      detail: safeTrim(row.transmissionPath || row.reason || row.thesis),
      periodType: safeTrim(row.periodType || DEFAULT_PERIOD),
      snapshotDate: row.createdAt || row.snapshotDate || new Date().toISOString(),
    }],
    snapshotDate: toIsoDate(row.createdAt || row.snapshotDate || new Date()),
    metadata: {
      attachmentKey: safeTrim(row.attachmentKey) || null,
      attachmentLabel,
      relationType,
      transmissionOrder,
      transmissionPath: safeTrim(row.transmissionPath) || null,
      attachmentStatus: safeTrim(row.status || 'pending') || 'pending',
      attachmentConfidence: confidence,
      topSymbols,
      suggestedSources: unique(row.suggestedSources || []).slice(0, 6),
    },
  };
}

async function loadLatestSnapshots(client, periodType) {
  const result = await client.query(`
    WITH ranked AS (
      SELECT
        theme,
        period_type,
        period_start,
        period_end,
        article_count,
        vs_previous_period_pct,
        vs_year_ago_pct,
        trend_acceleration AS acceleration,
        lifecycle_stage,
        source_diversity,
        geographic_spread,
        ROW_NUMBER() OVER (PARTITION BY theme ORDER BY period_end DESC, computed_at DESC) AS rn
      FROM theme_trend_aggregates
      WHERE period_type = $1
    )
    SELECT
      cur.theme,
      cur.period_type,
      cur.period_start,
      cur.period_end,
      cur.article_count,
      cur.vs_previous_period_pct,
      cur.vs_year_ago_pct,
      cur.acceleration,
      cur.lifecycle_stage,
      cur.source_diversity,
      cur.geographic_spread,
      prev.lifecycle_stage AS prev_lifecycle_stage
    FROM ranked cur
    LEFT JOIN ranked prev
      ON prev.theme = cur.theme
     AND prev.rn = 2
    WHERE cur.rn = 1
  `, [periodType]);
  return result.rows
    .map((row) => {
      const theme = normalizeTheme(row.theme);
      const config = getThemeConfig(theme);
      if (!config || config.parentTheme == null) return null;
      return {
        theme,
        label: config.label,
        parentTheme: config.parentTheme,
        category: config.category,
        periodType: safeTrim(row.period_type || periodType),
        periodStart: row.period_start,
        periodEnd: row.period_end,
        articleCount: Number(row.article_count || 0),
        vsPreviousPct: Number(row.vs_previous_period_pct || 0),
        vsYearAgoPct: Number(row.vs_year_ago_pct || 0),
        acceleration: Number(row.acceleration || 0),
        lifecycleStage: safeTrim(row.lifecycle_stage || ''),
        prevLifecycleStage: safeTrim(row.prev_lifecycle_stage || ''),
        sourceDiversity: Number(row.source_diversity || 0),
        geographicSpread: Number(row.geographic_spread || 0),
      };
    })
    .filter(Boolean);
}

async function loadShareJumps(client, periodType) {
  const result = await client.query(`
    WITH ranked AS (
      SELECT
        parent_theme,
        sub_theme,
        period_start,
        period_end,
        share_pct,
        rank_in_parent,
        ROW_NUMBER() OVER (PARTITION BY parent_theme, sub_theme ORDER BY period_end DESC) AS rn
      FROM theme_evolution
    )
    SELECT
      cur.parent_theme,
      cur.sub_theme,
      cur.period_end,
      cur.share_pct AS last_share_pct,
      COALESCE(cur.share_pct - prev.share_pct, cur.share_pct) AS delta_share_pct,
      cur.rank_in_parent
    FROM ranked cur
    LEFT JOIN ranked prev
      ON prev.parent_theme = cur.parent_theme
     AND prev.sub_theme = cur.sub_theme
     AND prev.rn = 2
    WHERE cur.rn = 1
  `);
  return result.rows
    .map((row) => {
      const theme = normalizeTheme(row.sub_theme);
      const config = getThemeConfig(theme);
      if (!config || config.parentTheme == null) return null;
      return {
        theme,
        label: config.label,
        parentTheme: normalizeTheme(row.parent_theme),
        parentLabel: getThemeConfig(row.parent_theme)?.label || row.parent_theme,
        category: config.category,
        periodType,
        periodEnd: row.period_end,
        lastSharePct: Number(row.last_share_pct || 0),
        deltaSharePct: Number(row.delta_share_pct || 0),
        rankInParent: Number(row.rank_in_parent || 0),
      };
    })
    .filter(Boolean);
}

async function loadEvidenceTableName(client) {
  const result = await client.query(`
    SELECT to_regclass('public.theme_openalex_evidence') AS modern_name,
           to_regclass('public.openalex_theme_evidence') AS legacy_name
  `);
  const row = result.rows[0] || {};
  return safeTrim(row.modern_name || row.legacy_name || '');
}

export async function loadEvidenceDeltas(client, periodType) {
  const tableName = await loadEvidenceTableName(client);
  if (!tableName) return [];
  const windowDays = PERIOD_WINDOW_DAYS[periodType] || PERIOD_WINDOW_DAYS.week;
  const currentDate = new Date();
  const currentStart = new Date(currentDate);
  currentStart.setUTCDate(currentStart.getUTCDate() - windowDays);
  const previousStart = new Date(currentStart);
  previousStart.setUTCDate(previousStart.getUTCDate() - windowDays);
  const query = `
    SELECT
      theme,
      COUNT(*) FILTER (
        WHERE COALESCE(publication_date, imported_at::date) >= $1
          AND COALESCE(publication_date, imported_at::date) < $2
      )::int AS current_evidence_count,
      COUNT(*) FILTER (
        WHERE COALESCE(publication_date, imported_at::date) >= $3
          AND COALESCE(publication_date, imported_at::date) < $1
      )::int AS previous_evidence_count,
      COALESCE(SUM(cited_by_count) FILTER (
        WHERE COALESCE(publication_date, imported_at::date) >= $1
          AND COALESCE(publication_date, imported_at::date) < $2
      ), 0)::int AS current_citations,
      COALESCE(SUM(cited_by_count) FILTER (
        WHERE COALESCE(publication_date, imported_at::date) >= $3
          AND COALESCE(publication_date, imported_at::date) < $1
      ), 0)::int AS previous_citations,
      MAX(COALESCE(publication_date, imported_at::date)) AS snapshot_date
    FROM ${tableName}
    GROUP BY theme
  `;
  const result = await client.query(query, [
    currentStart.toISOString().slice(0, 10),
    currentDate.toISOString().slice(0, 10),
    previousStart.toISOString().slice(0, 10),
  ]);
  return result.rows
    .map((row) => {
      const theme = normalizeTheme(row.theme);
      const config = getThemeConfig(theme);
      if (!config || config.parentTheme == null) return null;
      const currentEvidenceCount = Number(row.current_evidence_count || 0);
      const previousEvidenceCount = Number(row.previous_evidence_count || 0);
      const deltaEvidenceCount = currentEvidenceCount - previousEvidenceCount;
      const deltaEvidencePct = previousEvidenceCount > 0
        ? ((currentEvidenceCount - previousEvidenceCount) / previousEvidenceCount) * 100
        : currentEvidenceCount > 0 ? 100 : 0;
      return {
        theme,
        label: config.label,
        parentTheme: config.parentTheme,
        category: config.category,
        periodType,
        currentEvidenceCount,
        previousEvidenceCount,
        deltaEvidenceCount,
        deltaEvidencePct,
        currentCitations: Number(row.current_citations || 0),
        previousCitations: Number(row.previous_citations || 0),
        deltaCitations: Number(row.current_citations || 0) - Number(row.previous_citations || 0),
        snapshotDate: row.snapshot_date,
        evidenceClass: 'openalex_research',
        evidenceLabel: 'research evidence',
      };
    })
    .filter(Boolean);
}

export async function loadRecentAttachments(client, periodType) {
  const lookbackDays = attachmentLookbackDays(periodType);
  const result = await client.query(`
    SELECT
      id,
      status,
      created_at,
      payload
    FROM codex_proposals
    WHERE proposal_type = 'attach-theme'
      AND status IN ('pending', 'executed', 'queued', 'pending-approval', 'approved', 'dry-run')
      AND created_at >= NOW() - ($1::text || ' days')::interval
    ORDER BY created_at DESC
  `, [String(lookbackDays)]);
  return result.rows.map((row) => {
    const payload = row.payload || {};
    return {
      attachmentKey: safeTrim(payload.attachmentKey || row.id),
      targetTheme: safeTrim(payload.targetTheme),
      targetThemeLabel: safeTrim(payload.targetThemeLabel),
      attachmentLabel: safeTrim(payload.label),
      label: safeTrim(payload.label),
      confidence: Number(payload.confidence || 0),
      parentTheme: safeTrim(payload.targetParentTheme || payload.parentTheme),
      category: safeTrim(payload.targetCategory || payload.category),
      relationType: safeTrim(payload.relationType),
      transmissionOrder: safeTrim(payload.transmissionOrder),
      transmissionPath: safeTrim(payload.transmissionPath),
      reason: safeTrim(payload.reason),
      thesis: safeTrim(payload.thesis),
      assets: asArray(payload.assets),
      suggestedSources: asArray(payload.suggestedSources).map((item) => {
        if (typeof item === 'string') return safeTrim(item);
        return safeTrim(item?.label || item?.name || item?.domain || item?.url);
      }).filter(Boolean),
      createdAt: payload.createdAt || row.created_at || null,
      status: safeTrim(row.status || payload.status),
      periodType,
    };
  }).filter((row) => row.targetTheme && row.label);
}

export function buildStructuralAlertCandidates({ snapshots = [], shareJumps = [], evidenceDeltas = [], attachments = [], limit = 80 } = {}) {
  const alerts = [];
  for (const snapshot of snapshots) {
    [buildLifecycleAlert(snapshot), buildMomentumAlert(snapshot), buildCoolingAlert(snapshot)]
      .filter(Boolean)
      .forEach((alert) => alerts.push(alert));
  }
  for (const row of shareJumps) {
    const alert = buildShareJumpAlert(row);
    if (alert) alerts.push(alert);
  }
  for (const row of evidenceDeltas) {
    const alert = buildEvidenceDeltaAlert(row);
    if (alert) alerts.push(alert);
  }
  for (const row of attachments) {
    const alert = buildAttachmentAlert(row);
    if (alert) alerts.push(alert);
  }
  const deduped = Array.from(new Map(alerts.map((alert) => [alert.dedupeKey || `${alert.theme}:${alert.alertType}`, alert])).values())
    .sort((left, right) => Number(right.alertScore || 0) - Number(left.alertScore || 0));
  const adjacent = deduped.filter((alert) => alert.alertType === 'adjacent_pathway');
  const nonAdjacent = deduped.filter((alert) => alert.alertType !== 'adjacent_pathway');
  if (!adjacent.length) {
    return deduped.slice(0, limit);
  }
  const retainedAdjacent = adjacent.slice(0, Math.min(adjacent.length, Math.max(3, Math.floor(limit / 4) || 1)));
  const retainedKeys = new Set(retainedAdjacent.map((alert) => alert.dedupeKey || `${alert.theme}:${alert.alertType}`));
  const filled = [...retainedAdjacent];
  for (const alert of nonAdjacent) {
    const key = alert.dedupeKey || `${alert.theme}:${alert.alertType}`;
    if (retainedKeys.has(key)) continue;
    filled.push(alert);
    if (filled.length >= limit) break;
  }
  return filled
    .sort((left, right) => Number(right.alertScore || 0) - Number(left.alertScore || 0))
    .slice(0, limit);
}

export async function runStructuralAlertGenerationJob(options = {}, dependencies = {}) {
  const config = { ...parseArgs([]), ...options };
  const client = dependencies.client || new Client(resolveNasPgConfig());
  const ownsClient = !dependencies.client;
  const loadSnapshots = dependencies.loadSnapshots || loadLatestSnapshots;
  const loadShareShifts = dependencies.loadShareJumps || loadShareJumps;
  const loadEvidenceShiftRows = dependencies.loadEvidenceDeltas || loadEvidenceDeltas;
  const loadAttachmentRows = dependencies.loadAttachments || loadRecentAttachments;
  const persistAlerts = dependencies.upsertStructuralAlertsFn || upsertStructuralAlerts;
  if (ownsClient) {
    await client.connect();
  }
  try {
    await ensureTrendWorkbenchSchema(client);
    const snapshots = await loadSnapshots(client, config.period);
    const shareJumps = await loadShareShifts(client, config.period);
    const evidenceDeltas = await loadEvidenceShiftRows(client, config.period);
    const attachments = await loadAttachmentRows(client, config.period);
    const deduped = buildStructuralAlertCandidates({
      snapshots,
      shareJumps,
      evidenceDeltas,
      attachments,
      limit: config.limit,
    });
    if (config.dryRun) {
      return {
        ok: true,
        dryRun: true,
        periodType: config.period,
        snapshotCount: snapshots.length,
        shareShiftCount: shareJumps.length,
        evidenceDeltaCount: evidenceDeltas.length,
        attachmentCount: attachments.length,
        alertCount: deduped.length,
        alerts: deduped,
      };
    }
    const persisted = await persistAlerts(client, deduped, { source: 'generate-structural-alerts' });
    return {
      ok: true,
      dryRun: false,
      periodType: config.period,
      snapshotCount: snapshots.length,
      shareShiftCount: shareJumps.length,
      evidenceDeltaCount: evidenceDeltas.length,
      attachmentCount: attachments.length,
      alertCount: deduped.length,
      upserted: persisted.upserted,
    };
  } finally {
    if (ownsClient) {
      await client.end();
    }
  }
}

export async function runStructuralAlertGeneration(options = {}) {
  return runStructuralAlertGenerationJob(options);
}

const isDirectRun = (() => {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    return import.meta.url === pathToFileURL(entryArg).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runStructuralAlertGenerationJob(parseArgs())
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    });
}
