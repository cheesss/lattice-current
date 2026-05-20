/**
 * Event decision alerts — scan recent canonical events for high-evidence
 * uplift signals and emit OpenClaw `event-decision-alert` webhooks.
 *
 * Trigger criteria (configurable):
 *   - evidence_grade ∈ {E4, E3}
 *   - |t_stat| >= DEFAULT_T_THRESHOLD (2.0)
 *   - event occurred within `sinceHours`
 *
 * Idempotency: each alert carries a deterministic dedupe key
 * `event-decision:${canonical_event_id}:${symbol}:${horizon}:${grade}` so
 * downstream TaskFlow / webhook targets can suppress repeats.
 *
 * State persisted to data/automation/event-decision-alerts-state.json
 * to avoid re-emitting alerts across scheduler cycles.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './nas-runtime.mjs';
import { HOT_EVENTS_MIN_PROMOTION_CONTROLS } from './event-intelligence-builder.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_PATH = path.join(REPO_ROOT, 'data', 'automation', 'event-decision-alerts-state.json');

const DEFAULT_SINCE_HOURS = 24;
const DEFAULT_T_THRESHOLD = 2.0;
const DEFAULT_MAX_ALERTS = 20;
const STATE_RETENTION_DAYS = 14;
// E2 is the current statistically significant production grade, but it is only
// actionable after the promotion gate below: |t| >= 2, enough matched controls,
// and no low-market-relevance block. E3/E4 are kept for future validation layers.
const DEFAULT_HIGH_GRADES = ['E2', 'E3', 'E4'];

async function loadState() {
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.alerted && typeof parsed.alerted === 'object') {
      return parsed;
    }
  } catch {
    // ignore missing/corrupt state
  }
  return { alerted: {} };
}

async function saveState(state) {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function pruneState(state) {
  const cutoffMs = Date.now() - STATE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const kept = {};
  for (const [key, value] of Object.entries(state.alerted || {})) {
    const ts = Date.parse(String(value?.alertedAt || ''));
    if (Number.isFinite(ts) && ts >= cutoffMs) kept[key] = value;
  }
  state.alerted = kept;
}

function dedupeKey({ canonicalEventId, symbol, horizon, evidenceGrade }) {
  return `event-decision:${canonicalEventId}:${String(symbol).toUpperCase()}:${horizon}:${evidenceGrade}`;
}

export async function queryHighUpliftCandidates(pool, { sinceHours = DEFAULT_SINCE_HOURS, tThreshold = DEFAULT_T_THRESHOLD, limit = DEFAULT_MAX_ALERTS, grades = DEFAULT_HIGH_GRADES } = {}) {
  const hours = Math.max(1, Math.min(168, Number(sinceHours) || DEFAULT_SINCE_HOURS));
  const tMin = Math.max(0, Number(tThreshold) || DEFAULT_T_THRESHOLD);
  const lim = Math.max(1, Math.min(50, Number(limit) || DEFAULT_MAX_ALERTS));
  const gradeList = Array.isArray(grades) && grades.length ? grades : DEFAULT_HIGH_GRADES;
  const { rows } = await pool.query(
    `
    WITH article_quality AS (
      SELECT aem.canonical_event_id,
             COUNT(*) FILTER (WHERE a.market_relevance IS NOT NULL)::int AS known_market_relevance_articles,
             COUNT(*) FILTER (WHERE a.market_relevance IN ('high', 'medium'))::int AS market_relevant_articles,
             COUNT(*) FILTER (WHERE a.market_relevance = 'low')::int AS low_relevance_articles
        FROM article_event_map aem
        JOIN articles a ON a.id = aem.article_id
       GROUP BY aem.canonical_event_id
    )
    SELECT eu.canonical_event_id,
           eu.symbol,
           eu.horizon,
           eu.evidence_grade,
           eu.uplift,
           eu.t_stat,
           eu.n_controls,
           ce.theme,
           ce.representative_title,
           ce.event_date
      FROM event_uplift eu
      JOIN canonical_events ce ON ce.id = eu.canonical_event_id
      LEFT JOIN article_quality aq ON aq.canonical_event_id = ce.id
     WHERE eu.evidence_grade = ANY($4::text[])
       AND ABS(COALESCE(eu.t_stat, 0)) >= $2
       AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
       AND NOT (
         COALESCE(aq.known_market_relevance_articles, 0) > 0
         AND COALESCE(aq.market_relevant_articles, 0) = 0
         AND COALESCE(aq.low_relevance_articles, 0) > 0
       )
       AND ce.event_date >= (NOW() - ($1 || ' hours')::interval)::date
     ORDER BY eu.evidence_grade DESC,
              ABS(COALESCE(eu.t_stat, 0)) DESC,
              ABS(COALESCE(eu.uplift, 0)) DESC
     LIMIT $3
    `,
    [String(hours), tMin, lim, gradeList],
  );
  return rows.map((r) => ({
    canonicalEventId: Number(r.canonical_event_id),
    symbol: r.symbol,
    horizon: r.horizon,
    evidenceGrade: r.evidence_grade,
    uplift: r.uplift == null ? null : Number(r.uplift),
    tStat: r.t_stat == null ? null : Number(r.t_stat),
    nControls: r.n_controls == null ? null : Number(r.n_controls),
    theme: r.theme,
    title: r.representative_title,
    eventDate: r.event_date,
  }));
}

export async function emitEventDecisionAlerts(poolOrOptions, maybeOptions) {
  const hasExplicitPool = poolOrOptions && typeof poolOrOptions.query === 'function';
  const options = hasExplicitPool ? (maybeOptions || {}) : (poolOrOptions || {});
  const {
    sinceHours = DEFAULT_SINCE_HOURS,
    tThreshold = DEFAULT_T_THRESHOLD,
    limit = DEFAULT_MAX_ALERTS,
    dryRun = false,
  } = options;
  let pool = hasExplicitPool ? poolOrOptions : null;
  let ownsPool = false;
  if (!pool) {
    loadOptionalEnvFile();
    pool = new pg.Pool(resolveNasPgConfig());
    ownsPool = true;
  }
  try {
  const candidates = await queryHighUpliftCandidates(pool, { sinceHours, tThreshold, limit });
  const state = await loadState();
  pruneState(state);
  const nowIso = new Date().toISOString();

  const toEmit = [];
  for (const c of candidates) {
    const key = dedupeKey(c);
    if (state.alerted[key]) continue;
    toEmit.push({ candidate: c, key });
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      totalCandidates: candidates.length,
      toEmit: toEmit.map(({ candidate, key }) => ({ ...candidate, dedupeKey: key })),
    };
  }

  if (!toEmit.length) {
    return { ok: true, emittedCount: 0, totalCandidates: candidates.length };
  }

  const emitter = await import('./openclaw-webhook-emitter.mjs').catch(() => null);
  if (!emitter?.createOpenClawEvent || !emitter?.emitOpenClawEvents) {
    return { ok: false, error: 'openclaw-webhook-emitter unavailable', totalCandidates: candidates.length };
  }

  const events = toEmit.map(({ candidate, key }) => emitter.createOpenClawEvent({
    eventType: 'event-decision-alert',
    severity: (Math.abs(candidate.tStat ?? 0) >= 3 || candidate.evidenceGrade === 'E4') ? 'warning' : 'info',
    entityType: 'canonical-event',
    entityId: String(candidate.canonicalEventId),
    surface: 'investigate',
    summary: `High-evidence signal: ${candidate.symbol} [${candidate.horizon}] grade ${candidate.evidenceGrade} | t=${candidate.tStat?.toFixed(2) ?? 'n/a'} | uplift=${candidate.uplift != null ? (candidate.uplift * 100).toFixed(2) + '%' : 'n/a'}`,
    payload: {
      dedupeKey: key,
      canonicalEventId: candidate.canonicalEventId,
      symbol: candidate.symbol,
      horizon: candidate.horizon,
      evidenceGrade: candidate.evidenceGrade,
      uplift: candidate.uplift,
      tStat: candidate.tStat,
      nControls: candidate.nControls,
      theme: candidate.theme,
      title: candidate.title,
      eventDate: candidate.eventDate,
    },
  }));

  try {
    await emitter.emitOpenClawEvents(events);
    for (const { key } of toEmit) {
      state.alerted[key] = { alertedAt: nowIso };
    }
    await saveState(state);
    return { ok: true, emittedCount: events.length, totalCandidates: candidates.length };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err),
      emittedCount: 0,
      totalCandidates: candidates.length,
    };
  }
  } finally {
    if (ownsPool && pool) {
      try { await pool.end(); } catch {}
    }
  }
}

export const _internals = {
  dedupeKey,
  DEFAULT_SINCE_HOURS,
  DEFAULT_T_THRESHOLD,
  DEFAULT_MAX_ALERTS,
  STATE_PATH,
};
