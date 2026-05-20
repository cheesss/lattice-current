/**
 * ai-analysis-builder.mjs — Investigate surface의 AI 분석 기능 7종 백엔드
 *
 * P0:
 *   buildEventTimelinePayload       — 90d events + regime bands + VIX overlay
 *   buildEventNarrativePayload      — Codex exec로 이벤트 narrative 생성
 *   buildSimilarEventsPayload       — pgvector cosine으로 유사 이벤트
 *
 * P1:
 *   buildRegimeScenarioPayload      — regime_conditional_impact 기반 what-if
 *   buildAssetDossierPayload        — 종목별 이벤트/테마/매크로 집계
 *
 * P2:
 *   buildWeeklyDigestPayload        — Codex exec로 주간 AI 브리핑
 *   buildCorrelationBreaksPayload   — 90d vs 30d signal correlation 차이
 *
 * 모든 함수는 read-only SELECT만 수행. Write는 proposal-executor 경유.
 */

import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { HOT_EVENTS_MIN_PROMOTION_CONTROLS, buildHotEventQualityFlags } from './event-intelligence-builder.mjs';

const DEFAULT_TIMELINE_DAYS = 90;
const WEEKLY_DIGEST_CACHE_TTL_MS = Number(process.env.WEEKLY_DIGEST_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const WEEKLY_DIGEST_CACHE_FILE = path.resolve('data', 'event-dashboard-cache', 'weekly-ai-digest.json');

async function tableExists(executor, t) {
  const { rows } = await executor.query(`SELECT to_regclass($1) AS oid`, [`public.${t}`]);
  return Boolean(rows[0]?.oid);
}

/* ============================================================ */
/* P0-1: Event Timeline                                         */
/* ============================================================ */
export async function buildEventTimelinePayload(pool, { days = DEFAULT_TIMELINE_DAYS, theme = null } = {}) {
  const safeDays = Math.min(180, Math.max(7, Number(days) || DEFAULT_TIMELINE_DAYS));

  const [events, regime, vix] = await Promise.all([
    pool.query(
      `
      WITH ev AS (
        SELECT ce.id, ce.theme, ce.representative_title, ce.event_date,
               COALESCE(ce.article_count, 0) AS article_count,
               COALESCE(ce.source_count, 0) AS source_count
          FROM canonical_events ce
         WHERE ce.event_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
           AND ($2::text IS NULL OR LOWER(ce.theme) = LOWER($2))
      ),
      article_quality AS (
        SELECT aem.canonical_event_id,
               COUNT(*) FILTER (WHERE a.market_relevance IS NOT NULL)::int AS known_market_relevance_articles,
               COUNT(*) FILTER (WHERE a.market_relevance IN ('high', 'medium'))::int AS market_relevant_articles,
               COUNT(*) FILTER (WHERE a.market_relevance = 'low')::int AS low_relevance_articles
          FROM article_event_map aem
          JOIN articles a ON a.id = aem.article_id
         GROUP BY aem.canonical_event_id
      ),
      upl AS (
        SELECT eu.canonical_event_id,
               MAX(eu.evidence_grade) FILTER (
                 WHERE eu.evidence_grade IN ('E2','E3','E4')
                   AND ABS(COALESCE(eu.t_stat, 0)) >= 2
                   AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
                   AND NOT (
                     COALESCE(aq.known_market_relevance_articles, 0) > 0
                     AND COALESCE(aq.market_relevant_articles, 0) = 0
                     AND COALESCE(aq.low_relevance_articles, 0) > 0
                   )
               ) AS best_grade,
               MAX(ABS(COALESCE(eu.t_stat, 0))) FILTER (
                 WHERE eu.evidence_grade IN ('E2','E3','E4')
                   AND ABS(COALESCE(eu.t_stat, 0)) >= 2
                   AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
                   AND NOT (
                     COALESCE(aq.known_market_relevance_articles, 0) > 0
                     AND COALESCE(aq.market_relevant_articles, 0) = 0
                     AND COALESCE(aq.low_relevance_articles, 0) > 0
                   )
               ) AS max_abs_t,
               MAX(ABS(COALESCE(eu.uplift, 0))) FILTER (
                 WHERE eu.evidence_grade IN ('E2','E3','E4')
                   AND ABS(COALESCE(eu.t_stat, 0)) >= 2
                   AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
                   AND NOT (
                     COALESCE(aq.known_market_relevance_articles, 0) > 0
                     AND COALESCE(aq.market_relevant_articles, 0) = 0
                     AND COALESCE(aq.low_relevance_articles, 0) > 0
                   )
               ) AS max_abs_uplift
          FROM event_uplift eu
          LEFT JOIN article_quality aq ON aq.canonical_event_id = eu.canonical_event_id
         GROUP BY eu.canonical_event_id
      ),
      haw AS (
        SELECT theme, event_date, MAX(normalized_temperature) AS temperature
          FROM event_hawkes_intensity
         WHERE event_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
         GROUP BY theme, event_date
      )
      SELECT ev.id, ev.theme, ev.representative_title AS title, ev.event_date,
             ev.article_count, ev.source_count,
             upl.best_grade, upl.max_abs_t, upl.max_abs_uplift,
             haw.temperature
        FROM ev
        LEFT JOIN upl ON upl.canonical_event_id = ev.id
        LEFT JOIN haw ON haw.theme = ev.theme AND haw.event_date = ev.event_date
       ORDER BY ev.event_date ASC, upl.best_grade DESC NULLS LAST
       LIMIT 500
      `,
      [safeDays, theme],
    ),
    pool.query(
      `
      SELECT event_date::text AS d, regime, COUNT(*) AS n
        FROM matched_controls
       WHERE event_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
         AND regime_event IS NOT NULL
       GROUP BY event_date, regime
       ORDER BY event_date
      `,
      [safeDays],
    ).catch(() => ({ rows: [] })),
    pool.query(
      `
      SELECT ts::date AS d, AVG(value) AS v
        FROM signal_history
       WHERE signal_name = 'vix'
         AND ts >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
       GROUP BY ts::date
       ORDER BY d
      `,
      [safeDays],
    ),
  ]);

  const evList = events.rows.map((r) => ({
    id: Number(r.id),
    theme: r.theme,
    title: r.title,
    eventDate: r.event_date,
    articleCount: Number(r.article_count ?? 0),
    sourceCount: Number(r.source_count ?? 0),
    bestEvidenceGrade: r.best_grade || null,
    maxAbsT: r.max_abs_t == null ? null : Number(r.max_abs_t),
    maxAbsUplift: r.max_abs_uplift == null ? null : Number(r.max_abs_uplift),
    temperature: r.temperature == null ? null : Number(r.temperature),
  }));

  const vixSeries = vix.rows.map((r) => ({
    date: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10),
    value: r.v == null ? null : Number(r.v),
  }));

  // Regime: collapse to one regime per date (the mode / most common)
  const regimeByDate = {};
  for (const r of regime.rows) {
    const d = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
    if (!regimeByDate[d] || Number(r.n) > regimeByDate[d].n) {
      regimeByDate[d] = { regime: r.regime, n: Number(r.n) };
    }
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    days: safeDays,
    theme,
    events: evList,
    regimeByDate,
    vixSeries,
    counts: {
      total: evList.length,
      e2: evList.filter((e) => e.bestEvidenceGrade === 'E2').length,
      surge: evList.filter((e) => e.temperature != null && e.temperature >= 2).length,
    },
  };
}

/* ============================================================ */
/* P0-2: AI Event Narrative via Codex                           */
/* ============================================================ */
export async function buildEventNarrativePayload(pool, { eventId, forceRefresh = false } = {}) {
  const id = Number(eventId);
  if (!Number.isFinite(id) || id < 1) return { ok: false, error: 'eventId required' };

  const cacheCheck = await pool.query(
    `SELECT to_regclass('public.event_narrative_cache') AS oid`,
  );
  const hasCache = Boolean(cacheCheck.rows[0]?.oid);

  if (hasCache && !forceRefresh) {
    const { rows } = await pool.query(
      `SELECT narrative, citations, generated_at FROM event_narrative_cache WHERE canonical_event_id = $1 AND generated_at > now() - INTERVAL '24 hours'`,
      [id],
    ).catch(() => ({ rows: [] }));
    if (rows.length) {
      return {
        ok: true,
        cached: true,
        eventId: id,
        narrative: rows[0].narrative,
        citations: rows[0].citations || [],
        generatedAt: rows[0].generated_at,
      };
    }
  }

  const eventRes = await pool.query(
    `SELECT id, theme, representative_title, event_date, article_count, source_count FROM canonical_events WHERE id = $1`,
    [id],
  );
  if (!eventRes.rows.length) return { ok: false, error: 'event not found' };
  const event = eventRes.rows[0];

  const articlesRes = await pool.query(
    `
    SELECT a.id, a.title, a.source, a.published_at, a.summary
      FROM article_event_map aem JOIN articles a ON a.id = aem.article_id
     WHERE aem.canonical_event_id = $1
     ORDER BY a.published_at DESC NULLS LAST
     LIMIT 8
    `,
    [id],
  );

  const upliftRes = await pool.query(
    `
    WITH article_quality AS (
      SELECT aem.canonical_event_id,
             COUNT(*) FILTER (WHERE a.market_relevance IS NOT NULL)::int AS known_market_relevance_articles,
             COUNT(*) FILTER (WHERE a.market_relevance IN ('high', 'medium'))::int AS market_relevant_articles,
             COUNT(*) FILTER (WHERE a.market_relevance = 'low')::int AS low_relevance_articles
        FROM article_event_map aem
        JOIN articles a ON a.id = aem.article_id
       WHERE aem.canonical_event_id = $1
       GROUP BY aem.canonical_event_id
    )
    SELECT eu.symbol, eu.horizon, eu.uplift, eu.t_stat,
           eu.evidence_grade AS raw_evidence_grade,
           CASE
             WHEN eu.evidence_grade IN ('E2','E3','E4')
              AND (
                ABS(COALESCE(eu.t_stat, 0)) < 2
                OR COALESCE(eu.n_controls, 0) < ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
                OR (
                  COALESCE(aq.known_market_relevance_articles, 0) > 0
                  AND COALESCE(aq.market_relevant_articles, 0) = 0
                  AND COALESCE(aq.low_relevance_articles, 0) > 0
                )
              ) THEN NULL
             ELSE eu.evidence_grade
           END AS promoted_grade,
           eu.n_controls,
           COALESCE(aq.known_market_relevance_articles, 0) AS known_market_relevance_articles,
           COALESCE(aq.market_relevant_articles, 0) AS market_relevant_articles,
           COALESCE(aq.low_relevance_articles, 0) AS low_relevance_articles,
           (
             eu.evidence_grade IN ('E2','E3','E4')
             AND COALESCE(eu.n_controls, 0) < ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
           ) AS controls_blocked,
           (
             eu.evidence_grade IN ('E2','E3','E4')
             AND COALESCE(aq.known_market_relevance_articles, 0) > 0
             AND COALESCE(aq.market_relevant_articles, 0) = 0
             AND COALESCE(aq.low_relevance_articles, 0) > 0
           ) AS relevance_blocked
      FROM event_uplift eu
      LEFT JOIN article_quality aq ON aq.canonical_event_id = eu.canonical_event_id
     WHERE eu.canonical_event_id = $1
     ORDER BY ABS(COALESCE(eu.t_stat, 0)) DESC NULLS LAST
     LIMIT 6
    `,
    [id],
  ).catch(() => ({ rows: [] }));

  const prompt = buildNarrativePrompt({
    event,
    articles: articlesRes.rows,
    uplift: upliftRes.rows,
  });

  const { runCodexJsonPrompt } = await import('./codex-json.mjs');
  const result = await runCodexJsonPrompt(prompt, 80_000, {
    label: 'event-narrative',
    eventId: id,
  });

  const parsed = result.parsed;
  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      eventId: id,
      error: 'codex output not JSON',
      codexCode: result.code,
      codexMessage: String(result.message || '').slice(0, 800),
      stderr: String(result.stderr || '').slice(0, 400),
    };
  }

  const narrative = String(parsed.narrative || '').slice(0, 3000);
  const citations = Array.isArray(parsed.citations) ? parsed.citations.slice(0, 8) : [];
  const payload = {
    ok: true,
    cached: false,
    eventId: id,
    event: {
      theme: event.theme,
      title: event.representative_title,
      eventDate: event.event_date,
      articleCount: Number(event.article_count ?? 0),
    },
    narrative,
    citations,
    upliftHighlights: upliftRes.rows.map((u) => ({
      symbol: u.symbol,
      horizon: u.horizon,
      uplift: u.uplift == null ? null : Number(u.uplift),
      tStat: u.t_stat == null ? null : Number(u.t_stat),
      rawEvidenceGrade: u.raw_evidence_grade,
      evidenceGrade: u.promoted_grade,
      nControls: u.n_controls == null ? null : Number(u.n_controls),
      qualityFlags: buildHotEventQualityFlags({
        raw_evidence_grade: u.raw_evidence_grade,
        promoted_grade: u.promoted_grade,
        controls_blocked: u.controls_blocked,
        relevance_blocked: u.relevance_blocked,
      }),
    })),
    generatedAt: new Date().toISOString(),
  };

  if (hasCache) {
    await pool.query(
      `
      INSERT INTO event_narrative_cache (canonical_event_id, narrative, citations, generated_at)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (canonical_event_id) DO UPDATE
      SET narrative = EXCLUDED.narrative, citations = EXCLUDED.citations, generated_at = EXCLUDED.generated_at
      `,
      [id, narrative, JSON.stringify(citations)],
    ).catch(() => {});
  }

  return payload;
}

function buildNarrativePrompt({ event, articles, uplift }) {
  const articleLines = articles.slice(0, 6).map((a, i) =>
    `[${i + 1}] (${a.source || '?'} · ${String(a.published_at || '').slice(0, 10)}) ${a.title || ''}`,
  ).join('\n');
  const upliftLines = uplift.length
    ? uplift.map((u) => {
        const promoted = u.promoted_grade || null;
        const raw = u.raw_evidence_grade || null;
        const gradeLabel = promoted || (raw ? `${raw} quarantined` : 'none');
        const gate = raw && !promoted
          ? ' quality_gate=blocked_do_not_treat_as_validated_evidence'
          : ' quality_gate=passed_or_not_required';
        return `  ${u.symbol} ${u.horizon} uplift=${u.uplift} t=${u.t_stat} grade=${gradeLabel} n=${u.n_controls}${gate}`;
      }).join('\n')
    : '  (no uplift labeled yet)';
  return `You are a financial intelligence analyst. Summarize this event in 2-3 short paragraphs grounded in the provided articles. Keep it analytical, factual, and specific about market implications. Only cite promoted uplift grades as validated market evidence. If a raw grade is quarantined, describe it as an unvalidated hint or omit it.

EVENT
- id: ${event.id}
- theme: ${event.theme}
- date: ${String(event.event_date || '').slice(0, 10)}
- title: ${event.representative_title}
- articles: ${event.article_count} · sources: ${event.source_count}

ARTICLES
${articleLines || '(none)'}

UPLIFT (symbol reactions)
${upliftLines}

Output ONLY a single JSON object with this schema (no markdown, no prose outside JSON):
{
  "narrative": "2-3 short paragraphs in English. Analytical tone. Cite articles by [1], [2] references. Include why it mattered to markets and which sector(s) absorb the shock.",
  "citations": [{"index": 1, "source": "...", "title": "..."}, ...]
}

Keep narrative under 700 characters. Cite at most 4 articles. If uplift exists, reference it as evidence.`;
}

/* ============================================================ */
/* S-Tier D1: Theme brief LLM narrative                         */
/* ============================================================ */

const THEME_NARRATIVE_DAILY_BUDGET = Number(process.env.LATTICE_LLM_DAILY_BUDGET || 20);

/**
 * Build a 6-section theme brief narrative via Codex.
 *
 * Output schema (JSON):
 *   {
 *     whatChanged: string[],   // 1-3 lines
 *     whyMatters:  string[],
 *     evidence:    string[],
 *     caveats:     string[],
 *     monitor:     string[],
 *     related:     string[]
 *   }
 *
 * Caching: theme_narrative_cache table (auto-created), 24h TTL keyed by
 * (theme, period). Cost guard: respects LATTICE_LLM_DAILY_BUDGET env
 * (default 20). When budget exhausted, returns { ok: true, exhausted:
 * true } and the caller falls back to existing templated content.
 *
 * Inputs:
 *   theme       — canonical theme key
 *   period      — 'week' | 'month' | 'quarter' | 'year'
 *   briefPayload — the existing templated brief (with whatChanged, etc.)
 *                   Used to provide context for the LLM and to extract
 *                   fallback content on failure.
 */
export async function buildThemeNarrativePayload(pool, {
  theme,
  period = 'quarter',
  briefPayload = null,
  forceRefresh = false,
} = {}) {
  if (!theme || typeof theme !== 'string') {
    return { ok: false, error: 'theme required' };
  }
  const themeKey = String(theme).trim().toLowerCase();
  if (!themeKey) return { ok: false, error: 'theme required' };

  // Ensure cache table exists (idempotent).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS theme_narrative_cache (
      theme TEXT NOT NULL,
      period TEXT NOT NULL,
      narrative_json JSONB NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      tokens_used INT,
      PRIMARY KEY (theme, period)
    )
  `).catch(() => {});

  // Cache lookup.
  if (!forceRefresh) {
    const cached = await pool.query(
      `SELECT narrative_json, generated_at FROM theme_narrative_cache
        WHERE theme = $1 AND period = $2 AND generated_at > NOW() - INTERVAL '24 hours'`,
      [themeKey, period],
    ).catch(() => ({ rows: [] }));
    if (cached.rows.length > 0) {
      return {
        ok: true,
        cached: true,
        theme: themeKey,
        period,
        narrative: cached.rows[0].narrative_json,
        generatedAt: cached.rows[0].generated_at,
      };
    }
  }

  // Daily budget guard — count today's narrative generations across all themes.
  const usage = await pool.query(
    `SELECT COUNT(*)::int AS used
       FROM theme_narrative_cache
      WHERE generated_at >= CURRENT_DATE`,
  ).catch(() => ({ rows: [{ used: 0 }] }));
  const usedToday = Number(usage.rows[0]?.used ?? 0);
  if (usedToday >= THEME_NARRATIVE_DAILY_BUDGET) {
    return {
      ok: true,
      exhausted: true,
      theme: themeKey,
      period,
      reason: `Daily LLM budget reached (${usedToday}/${THEME_NARRATIVE_DAILY_BUDGET}). Falling back to templated brief content.`,
    };
  }

  const prompt = buildThemeNarrativePrompt({ theme: themeKey, period, briefPayload });
  let result;
  try {
    const { runCodexJsonPrompt } = await import('./codex-json.mjs');
    result = await runCodexJsonPrompt(prompt, 90_000, {
      label: 'theme-narrative',
      theme: themeKey,
      period,
    });
  } catch (err) {
    return {
      ok: false,
      theme: themeKey,
      period,
      error: `Codex CLI unavailable: ${String(err?.message || err).slice(0, 200)}`,
    };
  }

  const parsed = result?.parsed;
  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      theme: themeKey,
      period,
      error: 'codex output not JSON',
      codexCode: result?.code,
      stderr: String(result?.stderr || '').slice(0, 400),
    };
  }

  // Validate the 6-section shape.
  const narrative = {
    whatChanged: Array.isArray(parsed.whatChanged) ? parsed.whatChanged.slice(0, 4) : [],
    whyMatters: Array.isArray(parsed.whyMatters) ? parsed.whyMatters.slice(0, 4) : [],
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.slice(0, 6) : [],
    caveats: Array.isArray(parsed.caveats) ? parsed.caveats.slice(0, 4) : [],
    monitor: Array.isArray(parsed.monitor) ? parsed.monitor.slice(0, 4) : [],
    related: Array.isArray(parsed.related) ? parsed.related.slice(0, 6) : [],
  };

  // Persist.
  await pool.query(
    `INSERT INTO theme_narrative_cache (theme, period, narrative_json, generated_at, tokens_used)
     VALUES ($1, $2, $3::jsonb, NOW(), $4)
     ON CONFLICT (theme, period)
     DO UPDATE SET narrative_json = EXCLUDED.narrative_json,
                   generated_at = EXCLUDED.generated_at,
                   tokens_used = EXCLUDED.tokens_used`,
    [themeKey, period, JSON.stringify(narrative), result?.tokensUsed ?? null],
  ).catch(() => {});

  return {
    ok: true,
    cached: false,
    theme: themeKey,
    period,
    narrative,
    generatedAt: new Date().toISOString(),
  };
}

function buildThemeNarrativePrompt({ theme, period, briefPayload }) {
  const summary = briefPayload?.summary || {};
  const sections = briefPayload?.sections || briefPayload?.briefStructure || {};
  const articleCount = Number(summary.articleCount ?? 0);
  const acc = Number(summary.acceleration ?? 0);
  const vsYear = Number(summary.vsYearAgoPct ?? 0);
  const lifecycle = String(summary.lifecycleStage || 'unknown');

  // Provide existing templated content as context — the LLM should produce
  // something better than these, not just rephrase them.
  const ctxBlock = (key, items) => {
    const arr = Array.isArray(items) ? items.slice(0, 5) : [];
    if (arr.length === 0) return `${key}: (none)`;
    return `${key}:\n${arr.map((s) => `  - ${String(s).slice(0, 200)}`).join('\n')}`;
  };

  return `You are a senior intelligence analyst writing a ${period} brief on the theme "${theme}".

CONTEXT (current numbers, do not just repeat):
- articleCount: ${articleCount}
- acceleration: ${acc}
- vsYearAgoPct: ${vsYear}
- lifecycleStage: ${lifecycle}

CURRENT TEMPLATED CONTENT (replace, don't paraphrase — produce sharper, more specific lines):
${ctxBlock('whatChanged (templated)', sections.whatChanged?.map?.((c) => c?.detail || c) || sections.whatChanged)}
${ctxBlock('whyMatters (templated)', sections.whyMatters || sections.whyItMatters?.statements?.map?.((s) => s.statement || s) || [])}
${ctxBlock('caveats (templated)', sections.caveats || sections.risks)}
${ctxBlock('monitor (templated)', sections.monitor || sections.watchpoints)}

Write a brief that is:
1. Specific (name companies/sectors/regulators when clear).
2. Honest about base-effect or small samples.
3. Actionable (what an analyst should monitor or check next).
4. Concise (each line ≤ 160 chars, ≤ 4 lines per section).

Output ONLY a single JSON object with this schema (no markdown, no prose outside JSON):
{
  "whatChanged": ["...", "..."],
  "whyMatters":  ["...", "..."],
  "evidence":    ["..."],
  "caveats":     ["..."],
  "monitor":     ["..."],
  "related":     ["..."]
}

Total narrative under 1200 characters across all sections.`;
}

/* ============================================================ */
/* P0-3: Similar Events Finder (pgvector cosine)                */
/* ============================================================ */
export async function buildSimilarEventsPayload(pool, { eventId, limit = 6 } = {}) {
  const id = Number(eventId);
  if (!Number.isFinite(id) || id < 1) return { ok: false, error: 'eventId required' };
  const safeLimit = Math.min(15, Math.max(1, Number(limit) || 6));

  const seedRes = await pool.query(
    `
    SELECT a.embedding, ce.theme, ce.representative_title, ce.event_date
      FROM canonical_events ce
      JOIN article_event_map aem ON aem.canonical_event_id = ce.id
      JOIN articles a ON a.id = aem.article_id
     WHERE ce.id = $1 AND a.embedding IS NOT NULL
     ORDER BY a.published_at DESC
     LIMIT 1
    `,
    [id],
  );
  if (!seedRes.rows.length) {
    return { ok: false, error: 'no seed embedding for this event' };
  }

  const seedEmbedding = seedRes.rows[0].embedding;
  const seedTitle = seedRes.rows[0].representative_title;

  const { rows } = await pool.query(
    `
    WITH seed AS (SELECT $1::vector AS emb),
    near AS (
      SELECT a.id AS article_id, aem.canonical_event_id,
             1 - (a.embedding <=> seed.emb) AS similarity
        FROM articles a CROSS JOIN seed
        JOIN article_event_map aem ON aem.article_id = a.id
       WHERE a.embedding IS NOT NULL
         AND aem.canonical_event_id <> $2
       ORDER BY a.embedding <=> seed.emb
       LIMIT 200
    ),
    best AS (
      SELECT canonical_event_id, MAX(similarity) AS sim
        FROM near
       GROUP BY canonical_event_id
       ORDER BY sim DESC
       LIMIT $3::int
    ),
    article_quality AS (
      SELECT aem.canonical_event_id,
             COUNT(*) FILTER (WHERE a.market_relevance IS NOT NULL)::int AS known_market_relevance_articles,
             COUNT(*) FILTER (WHERE a.market_relevance IN ('high', 'medium'))::int AS market_relevant_articles,
             COUNT(*) FILTER (WHERE a.market_relevance = 'low')::int AS low_relevance_articles
        FROM article_event_map aem
        JOIN articles a ON a.id = aem.article_id
       GROUP BY aem.canonical_event_id
    ),
    uplift_qualified AS (
      SELECT eu.canonical_event_id,
             MAX(eu.evidence_grade) FILTER (
               WHERE eu.evidence_grade IN ('E2','E3','E4')
                 AND ABS(COALESCE(eu.t_stat, 0)) >= 2
                 AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
                 AND NOT (
                   COALESCE(aq.known_market_relevance_articles, 0) > 0
                   AND COALESCE(aq.market_relevant_articles, 0) = 0
                   AND COALESCE(aq.low_relevance_articles, 0) > 0
                 )
             ) AS best_grade,
             MAX(ABS(eu.t_stat)) FILTER (
               WHERE eu.evidence_grade IN ('E2','E3','E4')
                 AND ABS(COALESCE(eu.t_stat, 0)) >= 2
                 AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
                 AND NOT (
                   COALESCE(aq.known_market_relevance_articles, 0) > 0
                   AND COALESCE(aq.market_relevant_articles, 0) = 0
                   AND COALESCE(aq.low_relevance_articles, 0) > 0
                 )
             ) AS max_abs_t,
             MAX(ABS(eu.uplift)) FILTER (
               WHERE eu.evidence_grade IN ('E2','E3','E4')
                 AND ABS(COALESCE(eu.t_stat, 0)) >= 2
                 AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
                 AND NOT (
                   COALESCE(aq.known_market_relevance_articles, 0) > 0
                   AND COALESCE(aq.market_relevant_articles, 0) = 0
                   AND COALESCE(aq.low_relevance_articles, 0) > 0
                 )
             ) AS max_abs_uplift
        FROM event_uplift eu
        LEFT JOIN article_quality aq ON aq.canonical_event_id = eu.canonical_event_id
       GROUP BY eu.canonical_event_id
    )
    SELECT ce.id, ce.theme, ce.representative_title AS title, ce.event_date,
           ce.article_count, b.sim AS similarity,
           uq.best_grade,
           uq.max_abs_t,
           uq.max_abs_uplift
      FROM best b JOIN canonical_events ce ON ce.id = b.canonical_event_id
      LEFT JOIN uplift_qualified uq ON uq.canonical_event_id = ce.id
     ORDER BY b.sim DESC
    `,
    [seedEmbedding, id, safeLimit],
  );

  const similar = rows.map((r) => ({
    id: Number(r.id),
    theme: r.theme,
    title: r.title,
    eventDate: r.event_date,
    articleCount: Number(r.article_count ?? 0),
    similarity: Number(r.similarity),
    bestEvidenceGrade: r.best_grade || null,
    maxAbsT: r.max_abs_t == null ? null : Number(r.max_abs_t),
    maxAbsUplift: r.max_abs_uplift == null ? null : Number(r.max_abs_uplift),
  }));

  const withUplift = similar.filter((s) => s.maxAbsUplift != null);
  const avgUplift = withUplift.length
    ? withUplift.reduce((acc, s) => acc + s.maxAbsUplift, 0) / withUplift.length
    : null;
  const e2Count = similar.filter((s) => s.bestEvidenceGrade === 'E2').length;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    seedEventId: id,
    seedTitle,
    similar,
    summary: {
      count: similar.length,
      e2Count,
      avgSimilarity: similar.length ? similar.reduce((a, s) => a + s.similarity, 0) / similar.length : null,
      avgUplift,
      withUpliftCount: withUplift.length,
    },
  };
}

/* ============================================================ */
/* P1-1: Regime Scenario Lab                                     */
/* ============================================================ */
export async function buildRegimeScenarioPayload(pool, { vix = null, yieldSpread = null, oilPrice = null } = {}) {
  // Determine target regime from inputs (rough heuristic matching regime_conditional_impact convention)
  const targetRegime = classifyRegime({ vix, yieldSpread, oilPrice });

  const { rows } = await pool.query(
    `
    SELECT theme, symbol, horizon, regime, sample_size, avg_return, hit_rate, regime_multiplier
      FROM regime_conditional_impact
     WHERE ($1::text IS NULL OR regime = $1)
       AND sample_size >= 8
     ORDER BY ABS(COALESCE(regime_multiplier, 0)) DESC NULLS LAST,
              sample_size DESC
     LIMIT 50
    `,
    [targetRegime],
  ).catch(() => ({ rows: [] }));

  const predictions = rows.map((r) => ({
    theme: r.theme,
    symbol: r.symbol,
    horizon: r.horizon,
    regime: r.regime,
    sampleSize: Number(r.sample_size ?? 0),
    avgReturn: r.avg_return == null ? null : Number(r.avg_return),
    hitRate: r.hit_rate == null ? null : Number(r.hit_rate),
    regimeMultiplier: r.regime_multiplier == null ? null : Number(r.regime_multiplier),
  }));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    inputs: { vix, yieldSpread, oilPrice },
    targetRegime,
    predictions,
    summary: {
      totalPairs: predictions.length,
      posAvg: predictions.filter((p) => (p.avgReturn ?? 0) > 0).length,
      negAvg: predictions.filter((p) => (p.avgReturn ?? 0) < 0).length,
    },
  };
}

function classifyRegime({ vix, yieldSpread, oilPrice }) {
  const v = Number(vix);
  const y = Number(yieldSpread);
  if (Number.isFinite(v) && v > 30) return 'crisis';
  if (Number.isFinite(v) && v > 22) return 'risk-off';
  if (Number.isFinite(v) && v < 15) return 'risk-on';
  return 'balanced';
}

/* ============================================================ */
/* P1-1b: Current Regime Brief                                  */
/* ============================================================ */
export async function buildCurrentRegimeBriefPayload(pool, { useCodex = false, forceRefresh = false } = {}) {
  const [latestSignals, eventStats, topUplift, transitions] = await Promise.all([
    pool.query(
      `
      SELECT DISTINCT ON (signal_name)
             signal_name, value, ts
        FROM signal_history
       WHERE signal_name IN ('vix', 'yieldSpread', 'oilPrice', 'dollarIndex', 'hyCreditSpread', 'marketStress')
       ORDER BY signal_name, ts DESC
      `,
    ).catch(() => ({ rows: [] })),
    pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE event_date >= CURRENT_DATE - INTERVAL '7 days')::int AS events_7d,
        COALESCE(SUM(article_count) FILTER (WHERE event_date >= CURRENT_DATE - INTERVAL '7 days'), 0)::int AS articles_7d,
        COUNT(DISTINCT theme) FILTER (WHERE event_date >= CURRENT_DATE - INTERVAL '7 days')::int AS themes_7d,
        COUNT(*)::int AS events_30d,
        COALESCE(SUM(article_count), 0)::int AS articles_30d,
        COUNT(DISTINCT theme)::int AS themes_30d
      FROM canonical_events
      WHERE event_date >= CURRENT_DATE - INTERVAL '30 days'
      `,
    ).catch(() => ({ rows: [{}] })),
    pool.query(
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
      SELECT ce.id, ce.theme, ce.representative_title AS title, ce.event_date,
             ce.article_count, ce.source_count,
             eu.symbol, eu.horizon, eu.uplift, eu.t_stat, eu.n_controls, eu.evidence_grade
        FROM event_uplift eu
        JOIN canonical_events ce ON ce.id = eu.canonical_event_id
        LEFT JOIN article_quality aq ON aq.canonical_event_id = ce.id
       WHERE ce.event_date >= CURRENT_DATE - INTERVAL '30 days'
         AND eu.evidence_grade = 'E2'
         AND ABS(COALESCE(eu.t_stat, 0)) >= 2
         AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
         AND NOT (
           COALESCE(aq.known_market_relevance_articles, 0) > 0
           AND COALESCE(aq.market_relevant_articles, 0) = 0
           AND COALESCE(aq.low_relevance_articles, 0) > 0
         )
       ORDER BY ABS(COALESCE(eu.t_stat, 0)) DESC NULLS LAST,
                ce.event_date DESC
       LIMIT 10
      `,
    ).catch(() => ({ rows: [] })),
    pool.query(
      `
      SELECT theme, lifecycle_stage, previous_lifecycle_stage, period_end
        FROM theme_trend_aggregates
       WHERE period_end >= CURRENT_DATE - INTERVAL '30 days'
         AND previous_lifecycle_stage IS NOT NULL
         AND lifecycle_stage <> previous_lifecycle_stage
       ORDER BY period_end DESC
       LIMIT 10
      `,
    ).catch(() => ({ rows: [] })),
  ]);

  const signalMap = Object.fromEntries(latestSignals.rows.map((row) => [
    row.signal_name,
    {
      value: row.value == null ? null : Number(row.value),
      ts: row.ts,
    },
  ]));
  const inputs = {
    vix: signalMap.vix?.value ?? null,
    yieldSpread: signalMap.yieldSpread?.value ?? null,
    oilPrice: signalMap.oilPrice?.value ?? null,
    dollarIndex: signalMap.dollarIndex?.value ?? null,
    hyCreditSpread: signalMap.hyCreditSpread?.value ?? null,
    marketStress: signalMap.marketStress?.value ?? null,
  };
  const currentRegime = classifyRegime(inputs);
  const scenario = await buildRegimeScenarioPayload(pool, {
    vix: inputs.vix,
    yieldSpread: inputs.yieldSpread,
    oilPrice: inputs.oilPrice,
  }).catch(() => ({
    ok: false,
    targetRegime: currentRegime,
    predictions: [],
    summary: { totalPairs: 0, posAvg: 0, negAvg: 0 },
  }));

  const stats = eventStats.rows[0] || {};
  const topEvents = topUplift.rows.map((row) => ({
    id: Number(row.id),
    theme: row.theme,
    title: row.title,
    eventDate: row.event_date,
    articleCount: Number(row.article_count ?? 0),
    sourceCount: Number(row.source_count ?? 0),
    symbol: row.symbol,
    horizon: row.horizon,
    uplift: row.uplift == null ? null : Number(row.uplift),
    tStat: row.t_stat == null ? null : Number(row.t_stat),
    nControls: row.n_controls == null ? null : Number(row.n_controls),
    evidenceGrade: row.evidence_grade,
  }));
  const lifecycleTransitions = transitions.rows.map((row) => ({
    theme: row.theme,
    from: row.previous_lifecycle_stage,
    to: row.lifecycle_stage,
    periodEnd: row.period_end,
  }));
  const topPredictions = (scenario.predictions || []).slice(0, 8);
  const deterministic = buildDeterministicRegimeBrief({
    currentRegime,
    inputs,
    signalMap,
    stats,
    topEvents,
    transitions: lifecycleTransitions,
    topPredictions,
  });

  let codex = { attempted: false, ok: false };
  let synthesis = deterministic.synthesis;
  if (useCodex) {
    codex = { attempted: true, ok: false };
    try {
      const prompt = buildCurrentRegimeBriefPrompt({
        currentRegime,
        inputs,
        stats,
        topEvents,
        transitions: lifecycleTransitions,
        topPredictions,
      });
      const { runCodexJsonPrompt } = await import('./codex-json.mjs');
      const result = await runCodexJsonPrompt(prompt, 100_000, {
        label: 'current-regime-brief',
        forceRefresh: Boolean(forceRefresh),
      });
      if (result.parsed && typeof result.parsed === 'object') {
        synthesis = mergeCodexRegimeSynthesis(synthesis, result.parsed);
        codex = { attempted: true, ok: true };
      } else {
        codex = {
          attempted: true,
          ok: false,
          error: 'codex output not JSON',
          message: String(result.message || result.stderr || '').slice(0, 600),
        };
      }
    } catch (err) {
      codex = {
        attempted: true,
        ok: false,
        error: String(err?.message || err).slice(0, 600),
      };
    }
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    mode: codex.ok ? 'codex+deterministic' : 'deterministic',
    codex,
    regime: {
      current: currentRegime,
      confidence: deterministic.confidence,
      inputs,
      drivers: deterministic.drivers,
    },
    synthesis,
    evidence: {
      eventStats: {
        events7d: Number(stats.events_7d ?? 0),
        articles7d: Number(stats.articles_7d ?? 0),
        themes7d: Number(stats.themes_7d ?? 0),
        events30d: Number(stats.events_30d ?? 0),
        articles30d: Number(stats.articles_30d ?? 0),
        themes30d: Number(stats.themes_30d ?? 0),
      },
      latestSignals: Object.fromEntries(Object.entries(signalMap).map(([name, item]) => [
        name,
        { value: item.value, ts: item.ts },
      ])),
      topEvents,
      transitions: lifecycleTransitions,
      topPredictions,
      scenarioSummary: scenario.summary || {},
    },
    provenance: [
      'signal_history.latest(vix,yieldSpread,oilPrice,dollarIndex,hyCreditSpread,marketStress)',
      'canonical_events.30d aggregate',
      `event_uplift.promoted_E2 last 30d (n_controls>=${HOT_EVENTS_MIN_PROMOTION_CONTROLS})`,
      'theme_trend_aggregates lifecycle transitions',
      'regime_conditional_impact scenario pairs',
      codex.attempted ? 'optional Codex synthesis' : 'deterministic synthesis only',
    ],
  };
}

function buildDeterministicRegimeBrief({ currentRegime, inputs, signalMap, stats, topEvents, transitions, topPredictions }) {
  const availableSignals = ['vix', 'yieldSpread', 'oilPrice'].filter((key) => Number.isFinite(inputs[key]));
  const confidence = Math.min(0.95, 0.45 + availableSignals.length * 0.14 + Math.min(0.18, topEvents.length * 0.02));
  const drivers = [];
  if (Number.isFinite(inputs.vix)) {
    if (inputs.vix > 30) drivers.push(`VIX ${inputs.vix.toFixed(1)} is in crisis territory.`);
    else if (inputs.vix > 22) drivers.push(`VIX ${inputs.vix.toFixed(1)} is elevated.`);
    else if (inputs.vix < 15) drivers.push(`VIX ${inputs.vix.toFixed(1)} supports a risk-on read.`);
    else drivers.push(`VIX ${inputs.vix.toFixed(1)} is consistent with a balanced tape.`);
  }
  if (Number.isFinite(inputs.yieldSpread)) {
    drivers.push(`Yield spread latest value is ${inputs.yieldSpread.toFixed(2)}.`);
  }
  if (Number.isFinite(inputs.oilPrice)) {
    drivers.push(`Oil latest value is ${inputs.oilPrice.toFixed(1)}.`);
  }
  if (Number.isFinite(inputs.marketStress)) {
    drivers.push(`Market stress channel is ${inputs.marketStress.toFixed(2)}.`);
  }
  if (!drivers.length) drivers.push('Macro signal coverage is thin; regime label is low-confidence.');

  const events7d = Number(stats.events_7d ?? 0);
  const articles7d = Number(stats.articles_7d ?? 0);
  const themes7d = Number(stats.themes_7d ?? 0);
  const strongest = topEvents[0];
  const transition = transitions[0];
  const positives = topPredictions.filter((row) => (row.avgReturn ?? 0) > 0).slice(0, 3);
  const negatives = topPredictions.filter((row) => (row.avgReturn ?? 0) < 0).slice(0, 3);
  const signalAge = Object.entries(signalMap)
    .filter(([, item]) => item?.ts)
    .map(([name, item]) => `${name}: ${String(item.ts).slice(0, 10)}`)
    .slice(0, 4)
    .join(', ');

  const executiveSummary = [
    `Current regime reads as ${currentRegime} from the latest macro signal set.`,
    `The last 7 days contain ${events7d} canonical events across ${themes7d} themes and ${articles7d} linked articles.`,
    strongest
      ? `Strongest E2 evidence currently links ${strongest.theme} to ${strongest.symbol} (${formatSigned(strongest.uplift)} uplift, t=${formatMaybe(strongest.tStat)}).`
      : 'No high-grade E2 event impact row is available in the last 30 days.',
  ];
  const marketImplications = [
    positives.length
      ? `Positive scenario leaders: ${positives.map((p) => `${p.symbol}/${p.theme} ${formatSigned(p.avgReturn)}`).join(', ')}.`
      : 'No positive regime-conditioned pairs cleared the current sample filter.',
    negatives.length
      ? `Downside-sensitive pairs: ${negatives.map((p) => `${p.symbol}/${p.theme} ${formatSigned(p.avgReturn)}`).join(', ')}.`
      : 'No negative regime-conditioned pairs cleared the current sample filter.',
  ];
  const watchlist = [
    transition ? `Watch ${transition.theme}: lifecycle moved ${transition.from} -> ${transition.to}.` : 'Watch lifecycle transitions; no fresh transition dominates this window.',
    strongest ? `Recheck evidence for ${strongest.symbol} if the ${strongest.theme} cluster keeps adding sources.` : 'Prioritize new E2-grade events before acting on weak clusters.',
    signalAge ? `Confirm signal freshness (${signalAge}).` : 'Refresh macro signal channels before using this brief operationally.',
  ];
  const risks = [
    confidence < 0.7 ? 'Regime confidence is limited by incomplete or stale macro inputs.' : 'Regime confidence is moderate, but this is still a decision-support brief, not an execution signal.',
    'Event evidence can be duplicated by syndication or source clustering; validate citations before escalation.',
  ];
  const opportunities = [
    topEvents.length ? `Use the ${topEvents.length} recent E2 rows as the first investigation queue.` : 'Backfill event impacts before relying on opportunity ranking.',
    transitions.length ? `${transitions.length} lifecycle transitions can seed the next thematic watchlist.` : 'Low lifecycle churn suggests focusing on anomaly and correlation-break surfaces.',
  ];

  return {
    confidence,
    drivers,
    synthesis: {
      headline: `${titleCase(currentRegime)} regime brief`,
      executiveSummary,
      marketImplications,
      watchlist,
      risks,
      opportunities,
    },
  };
}

function buildCurrentRegimeBriefPrompt({ currentRegime, inputs, stats, topEvents, transitions, topPredictions }) {
  const eventLines = topEvents.slice(0, 6).map((e) =>
    `  - ${e.theme}/${e.symbol}: uplift=${e.uplift} t=${e.tStat} title="${String(e.title || '').slice(0, 90)}"`,
  ).join('\n') || '  - none';
  const transitionLines = transitions.slice(0, 6).map((t) =>
    `  - ${t.theme}: ${t.from} -> ${t.to}`,
  ).join('\n') || '  - none';
  const predictionLines = topPredictions.slice(0, 8).map((p) =>
    `  - ${p.theme}/${p.symbol}: avgReturn=${p.avgReturn} hitRate=${p.hitRate} sample=${p.sampleSize}`,
  ).join('\n') || '  - none';

  return `You are producing a current market-regime intelligence brief for a signal-first decision-support dashboard.

Do not invent data. Use only the supplied context. If evidence is weak, say so.

CURRENT REGIME: ${currentRegime}
INPUTS: ${JSON.stringify(inputs)}
EVENT STATS: ${JSON.stringify(stats)}

TOP E2 EVENT IMPACTS
${eventLines}

LIFECYCLE TRANSITIONS
${transitionLines}

REGIME-CONDITIONED PAIRS
${predictionLines}

Output ONLY a single JSON object:
{
  "headline": "under 110 chars",
  "executiveSummary": ["2-4 bullets"],
  "marketImplications": ["1-3 bullets"],
  "watchlist": ["2-4 bullets"],
  "risks": ["1-3 bullets"],
  "opportunities": ["1-3 bullets"]
}`;
}

function mergeCodexRegimeSynthesis(fallback, parsed) {
  return {
    headline: sanitizeOneLine(parsed.headline, fallback.headline, 120),
    executiveSummary: sanitizeStringList(parsed.executiveSummary, fallback.executiveSummary, 4, 220),
    marketImplications: sanitizeStringList(parsed.marketImplications, fallback.marketImplications, 4, 220),
    watchlist: sanitizeStringList(parsed.watchlist, fallback.watchlist, 4, 220),
    risks: sanitizeStringList(parsed.risks, fallback.risks, 4, 220),
    opportunities: sanitizeStringList(parsed.opportunities, fallback.opportunities, 4, 220),
  };
}

function sanitizeStringList(value, fallback, maxItems, maxLen) {
  if (!Array.isArray(value)) return fallback;
  const out = value
    .map((item) => sanitizeOneLine(item, '', maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
  return out.length ? out : fallback;
}

function sanitizeOneLine(value, fallback, maxLen) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLen) : fallback;
}

function titleCase(value) {
  return String(value || '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatMaybe(value) {
  return Number.isFinite(value) ? value.toFixed(2) : 'n/a';
}

function formatSigned(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/* ============================================================ */
/* P1-2: Asset Dossier                                          */
/* ============================================================ */
export async function buildAssetDossierPayload(pool, { symbol }) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return { ok: false, error: 'symbol required' };

  const [themes, upliftStats, recentEvents, macroCorr] = await Promise.all([
    pool.query(
      `
      SELECT theme, avg_abs_reaction, reaction_count, correlation, quality_score,
             outcome_hit_rate, outcome_avg_return
        FROM auto_theme_symbols
       WHERE symbol = $1
       ORDER BY COALESCE(quality_score, 0) DESC NULLS LAST, reaction_count DESC
       LIMIT 8
      `,
      [sym],
    ).catch(() => ({ rows: [] })),
    pool.query(
      `
      WITH article_quality AS (
        SELECT aem.canonical_event_id,
               COUNT(*) FILTER (WHERE a.market_relevance IS NOT NULL)::int AS known_market_relevance_articles,
               COUNT(*) FILTER (WHERE a.market_relevance IN ('high', 'medium'))::int AS market_relevant_articles,
               COUNT(*) FILTER (WHERE a.market_relevance = 'low')::int AS low_relevance_articles
          FROM article_event_map aem
          JOIN articles a ON a.id = aem.article_id
         GROUP BY aem.canonical_event_id
      ),
      qualified AS (
        SELECT eu.*,
               CASE
                 WHEN eu.evidence_grade IN ('E2','E3','E4')
                  AND (
                    ABS(COALESCE(eu.t_stat, 0)) < 2
                    OR COALESCE(eu.n_controls, 0) < ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
                    OR (
                      COALESCE(aq.known_market_relevance_articles, 0) > 0
                      AND COALESCE(aq.market_relevant_articles, 0) = 0
                      AND COALESCE(aq.low_relevance_articles, 0) > 0
                    )
                  ) THEN NULL
                 ELSE eu.evidence_grade
               END AS promoted_grade
          FROM event_uplift eu
          LEFT JOIN article_quality aq ON aq.canonical_event_id = eu.canonical_event_id
         WHERE eu.symbol = $1
      )
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE promoted_grade = 'E2')::int AS e2,
             COUNT(*) FILTER (WHERE promoted_grade = 'E1')::int AS e1,
             COUNT(*) FILTER (WHERE promoted_grade = 'E0')::int AS e0,
             AVG(uplift) FILTER (WHERE promoted_grade = 'E2') AS avg_e2_uplift,
             AVG(ABS(t_stat)) FILTER (WHERE promoted_grade = 'E2') AS avg_e2_t
        FROM qualified
      `,
      [sym],
    ).catch(() => ({ rows: [] })),
    pool.query(
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
      SELECT ce.id, ce.theme, ce.representative_title AS title, ce.event_date,
             CASE
               WHEN eu.evidence_grade IN ('E2','E3','E4')
                AND (
                  ABS(COALESCE(eu.t_stat, 0)) < 2
                  OR COALESCE(eu.n_controls, 0) < ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
                  OR (
                    COALESCE(aq.known_market_relevance_articles, 0) > 0
                    AND COALESCE(aq.market_relevant_articles, 0) = 0
                    AND COALESCE(aq.low_relevance_articles, 0) > 0
                  )
                ) THEN NULL
               ELSE eu.evidence_grade
             END AS evidence_grade,
             eu.uplift, eu.t_stat, eu.n_controls, eu.horizon
       FROM event_uplift eu
        JOIN canonical_events ce ON ce.id = eu.canonical_event_id
        LEFT JOIN article_quality aq ON aq.canonical_event_id = ce.id
       WHERE eu.symbol = $1
         AND NOT (
           eu.evidence_grade IN ('E2','E3','E4')
           AND (
             ABS(COALESCE(eu.t_stat, 0)) < 2
             OR COALESCE(eu.n_controls, 0) < ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
             OR (
               COALESCE(aq.known_market_relevance_articles, 0) > 0
               AND COALESCE(aq.market_relevant_articles, 0) = 0
               AND COALESCE(aq.low_relevance_articles, 0) > 0
             )
           )
         )
       ORDER BY ce.event_date DESC
       LIMIT 8
      `,
      [sym],
    ).catch(() => ({ rows: [] })),
    pool.query(
      `
      SELECT 'macro_events' AS bucket, COUNT(*)::int AS cnt
        FROM event_uplift WHERE symbol = $1
      `,
      [sym],
    ).catch(() => ({ rows: [] })),
  ]);

  const stats = upliftStats.rows[0] || {};
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    symbol: sym,
    themes: themes.rows.map((t) => ({
      theme: t.theme,
      avgAbsReaction: t.avg_abs_reaction == null ? null : Number(t.avg_abs_reaction),
      reactionCount: Number(t.reaction_count ?? 0),
      correlation: t.correlation == null ? null : Number(t.correlation),
      qualityScore: t.quality_score == null ? null : Number(t.quality_score),
      outcomeHitRate: t.outcome_hit_rate == null ? null : Number(t.outcome_hit_rate),
      outcomeAvgReturn: t.outcome_avg_return == null ? null : Number(t.outcome_avg_return),
    })),
    upliftStats: {
      total: Number(stats.total ?? 0),
      e2: Number(stats.e2 ?? 0),
      e1: Number(stats.e1 ?? 0),
      e0: Number(stats.e0 ?? 0),
      avgE2Uplift: stats.avg_e2_uplift == null ? null : Number(stats.avg_e2_uplift),
      avgE2T: stats.avg_e2_t == null ? null : Number(stats.avg_e2_t),
    },
    recentEvents: recentEvents.rows.map((e) => ({
      id: Number(e.id),
      theme: e.theme,
      title: e.title,
      eventDate: e.event_date,
      evidenceGrade: e.evidence_grade,
      uplift: e.uplift == null ? null : Number(e.uplift),
      tStat: e.t_stat == null ? null : Number(e.t_stat),
      horizon: e.horizon,
    })),
  };
}

/* ============================================================ */
/* P2-1: Weekly AI Digest via Codex                              */
/* ============================================================ */
export async function buildWeeklyDigestPayload(pool, { forceRefresh = false } = {}) {
  const cached = await readWeeklyDigestCache();
  if (cached && !forceRefresh && isFreshWeeklyDigestCache(cached)) {
    return {
      ...cached,
      ok: true,
      cached: true,
      cacheTtlMs: WEEKLY_DIGEST_CACHE_TTL_MS,
    };
  }

  // 7d aggregate of what changed
  const [events7d, transitions, topUplift, signals] = await Promise.all([
    pool.query(
      `
      SELECT COUNT(*)::int AS new_events,
             SUM(article_count)::int AS total_articles,
             COUNT(DISTINCT theme)::int AS themes
        FROM canonical_events
       WHERE event_date >= CURRENT_DATE - INTERVAL '7 days'
      `,
    ).catch(() => ({ rows: [{}] })),
    pool.query(
      `
      SELECT theme, COUNT(*)::int AS n
        FROM theme_trend_aggregates
       WHERE period_end >= CURRENT_DATE - INTERVAL '7 days'
         AND previous_lifecycle_stage IS NOT NULL
         AND lifecycle_stage <> previous_lifecycle_stage
       GROUP BY theme
       ORDER BY n DESC
       LIMIT 6
      `,
    ).catch(() => ({ rows: [] })),
    pool.query(
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
      SELECT ce.representative_title AS title, ce.theme, ce.event_date,
             eu.symbol, eu.uplift, eu.t_stat, eu.n_controls, eu.evidence_grade
        FROM event_uplift eu JOIN canonical_events ce ON ce.id = eu.canonical_event_id
        LEFT JOIN article_quality aq ON aq.canonical_event_id = ce.id
       WHERE ce.event_date >= CURRENT_DATE - INTERVAL '30 days'
         AND eu.evidence_grade = 'E2'
         AND ABS(COALESCE(eu.t_stat, 0)) >= 2
         AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
         AND NOT (
           COALESCE(aq.known_market_relevance_articles, 0) > 0
           AND COALESCE(aq.market_relevant_articles, 0) = 0
           AND COALESCE(aq.low_relevance_articles, 0) > 0
         )
       ORDER BY ABS(eu.t_stat) DESC
       LIMIT 6
      `,
    ).catch(() => ({ rows: [] })),
    pool.query(
      `
      SELECT signal_name, AVG(value) AS avg_val, MAX(ts) AS latest
        FROM signal_history
       WHERE ts >= CURRENT_DATE - INTERVAL '7 days'
         AND signal_name IN ('vix', 'yieldSpread', 'oilPrice', 'dollarIndex', 'hyCreditSpread')
       GROUP BY signal_name
      `,
    ).catch(() => ({ rows: [] })),
  ]);

  const prompt = buildDigestPrompt({
    window: '7 days',
    stats: events7d.rows[0] || {},
    transitions: transitions.rows,
    topUplift: topUplift.rows,
    signals: signals.rows,
  });

  const deterministicPayload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    window: '7 days',
    stats: events7d.rows[0] || {},
    transitions: transitions.rows,
    topUplift: topUplift.rows,
    signals: signals.rows,
    digest: buildDeterministicWeeklyDigest({
      stats: events7d.rows[0] || {},
      transitions: transitions.rows,
      topUplift: topUplift.rows,
      signals: signals.rows,
    }),
    codex: {
      attempted: false,
      reason: forceRefresh ? 'pre-codex fallback' : 'use refresh=1 to request Codex synthesis',
    },
  };

  if (!forceRefresh) {
    await writeWeeklyDigestCache(deterministicPayload).catch(() => {});
    return deterministicPayload;
  }

  const { runCodexJsonPrompt } = await import('./codex-json.mjs');
  const result = await runCodexJsonPrompt(prompt, 120_000, { label: 'weekly-digest' });

  if (!result.parsed) {
    if (cached) {
      return {
        ...cached,
        ok: true,
        cached: true,
        stale: true,
        refreshError: 'codex output not JSON',
        cacheTtlMs: WEEKLY_DIGEST_CACHE_TTL_MS,
      };
    }
    return {
      ...deterministicPayload,
      codex: { attempted: true, ok: false },
      error: 'codex output not JSON',
      stderr: String(result.stderr || '').slice(0, 400),
      message: String(result.message || '').slice(0, 600),
    };
  }

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    window: '7 days',
    stats: events7d.rows[0],
    transitions: transitions.rows,
    topUplift: topUplift.rows,
    signals: signals.rows,
    digest: result.parsed,
    codex: { attempted: true, ok: true },
  };
  await writeWeeklyDigestCache(payload).catch(() => {});
  return payload;
}

function buildDigestPrompt({ window, stats, transitions, topUplift, signals }) {
  const tLines = transitions.map((t) => `  ${t.theme}: ${t.n} transitions`).join('\n') || '  (none)';
  const uLines = topUplift.slice(0, 5).map((u) =>
    `  ${u.symbol} (${u.theme}): uplift=${u.uplift} t=${u.t_stat} - "${(u.title || '').slice(0, 60)}"`,
  ).join('\n') || '  (none)';
  const sLines = signals.map((s) => `  ${s.signal_name}: ${Number(s.avg_val).toFixed(2)} (latest ${String(s.latest).slice(0, 10)})`).join('\n');

  return `You are a financial intelligence analyst producing a weekly brief.

WINDOW: past ${window}

STATS
- new events: ${stats.new_events || 0}
- total articles: ${stats.total_articles || 0}
- themes touched: ${stats.themes || 0}

LIFECYCLE TRANSITIONS
${tLines}

TOP E2 UPLIFT (last 30d)
${uLines}

MACRO SIGNALS
${sLines}

Output ONLY a single JSON object (no markdown):
{
  "headline": "one-sentence summary (under 120 chars)",
  "regime": "one phrase naming the market regime currently dominating",
  "what_changed": "2-3 sentences on what shifted this week",
  "watch_next": "2-3 sentences on what to monitor next",
  "top_tickers": ["SYM1","SYM2","SYM3"]
}`;
}

async function readWeeklyDigestCache() {
  try {
    const raw = await readFile(WEEKLY_DIGEST_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function writeWeeklyDigestCache(payload) {
  await mkdir(path.dirname(WEEKLY_DIGEST_CACHE_FILE), { recursive: true });
  await writeFile(WEEKLY_DIGEST_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

function isFreshWeeklyDigestCache(payload) {
  const ts = Date.parse(payload?.generatedAt || '');
  return Number.isFinite(ts) && Date.now() - ts <= WEEKLY_DIGEST_CACHE_TTL_MS;
}

function buildDeterministicWeeklyDigest({ stats, transitions, topUplift, signals }) {
  const topTransition = transitions[0];
  const topSignal = signals
    .map((signal) => ({
      name: String(signal.signal_name || ''),
      avg: Number(signal.avg_val),
      latest: signal.latest,
    }))
    .filter((signal) => Number.isFinite(signal.avg))
    .sort((a, b) => Math.abs(b.avg) - Math.abs(a.avg))[0];
  const topEvidence = topUplift[0];
  const tickers = Array.from(new Set(topUplift.map((row) => String(row.symbol || '').trim()).filter(Boolean))).slice(0, 5);
  const eventCount = Number(stats?.new_events || 0);
  const themeCount = Number(stats?.themes || 0);
  const articleCount = Number(stats?.total_articles || 0);

  const headlineParts = [];
  if (eventCount > 0) headlineParts.push(`${eventCount} new events`);
  if (themeCount > 0) headlineParts.push(`${themeCount} themes`);
  if (topTransition?.theme) headlineParts.push(`${topTransition.theme} lifecycle shift`);
  const headline = headlineParts.length
    ? `Weekly signal scan: ${headlineParts.join(', ')}`
    : 'Weekly signal scan: no material event expansion detected';

  const regime = topSignal
    ? `${topSignal.name} led the macro tape`
    : topTransition?.theme
      ? `${topTransition.theme} transition-led regime`
      : 'quiet evidence regime';

  const transitionText = topTransition?.theme
    ? `${topTransition.theme} recorded ${topTransition.n} lifecycle transitions.`
    : 'No lifecycle transitions cleared the weekly threshold.';
  const evidenceText = topEvidence
    ? `Top quality-gated uplift was ${topEvidence.symbol || 'unknown'} in ${topEvidence.theme || 'unknown'} with t=${Number(topEvidence.t_stat || 0).toFixed(2)}.`
    : 'No quality-gated E2 uplift rows cleared the promotion controls.';
  const signalText = topSignal
    ? `${topSignal.name} averaged ${topSignal.avg.toFixed(2)} over the window.`
    : 'Macro signal coverage was limited for this window.';

  return {
    headline,
    regime,
    what_changed: `${articleCount} articles mapped into ${eventCount} canonical events across ${themeCount} themes. ${transitionText}`,
    watch_next: `${evidenceText} ${signalText}`,
    top_tickers: tickers,
    mode: 'deterministic',
    weekEnding: new Date().toISOString().slice(0, 10),
    summary: `${transitionText} ${evidenceText}`,
    watchlist: tickers,
  };
}

/* ============================================================ */
/* P2-2: Correlation Break Anomaly Detector                     */
/* ============================================================ */
export async function buildCorrelationBreaksPayload(pool) {
  const signals = ['vix', 'yieldSpread', 'oilPrice', 'dollarIndex', 'hyCreditSpread', 'marketStress'];

  // Fetch each signal's 90d series
  const series = {};
  for (const s of signals) {
    const { rows } = await pool.query(
      `
      SELECT ts::date AS d, AVG(value) AS v
        FROM signal_history
       WHERE signal_name = $1
         AND ts >= CURRENT_DATE - INTERVAL '90 days'
       GROUP BY ts::date
       ORDER BY d
      `,
      [s],
    );
    series[s] = rows.map((r) => ({ d: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10), v: Number(r.v) }));
  }

  // Align by date, compute correlation on last 30d vs 90d
  const allDates = Array.from(new Set(Object.values(series).flat().map((r) => r.d))).sort();
  const last30 = allDates.slice(-30);
  const last90 = allDates;

  function corr(xs, ys) {
    const n = Math.min(xs.length, ys.length);
    if (n < 5) return null;
    const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      const vx = xs[i] - mx, vy = ys[i] - my;
      num += vx * vy; dx += vx * vx; dy += vy * vy;
    }
    if (dx === 0 || dy === 0) return null;
    return num / Math.sqrt(dx * dy);
  }

  function pickSeries(sigName, dates) {
    const map = new Map(series[sigName].map((r) => [r.d, r.v]));
    return dates.map((d) => map.get(d)).filter(Number.isFinite);
  }

  const breaks = [];
  for (let i = 0; i < signals.length; i++) {
    for (let j = i + 1; j < signals.length; j++) {
      const a = signals[i], b = signals[j];
      const aligned30 = { a: pickSeries(a, last30), b: pickSeries(b, last30) };
      const aligned90 = { a: pickSeries(a, last90), b: pickSeries(b, last90) };
      if (aligned30.a.length < 5 || aligned90.a.length < 20) continue;
      const c30 = corr(aligned30.a, aligned30.b);
      const c90 = corr(aligned90.a, aligned90.b);
      if (c30 == null || c90 == null) continue;
      const delta = c30 - c90;
      breaks.push({
        pair: `${a} x ${b}`,
        corr30d: c30,
        corr90d: c90,
        delta,
        absDelta: Math.abs(delta),
        direction: delta > 0 ? 'tightening' : 'breaking',
      });
    }
  }

  breaks.sort((x, y) => y.absDelta - x.absDelta);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    window30d: last30.length,
    window90d: last90.length,
    breaks: breaks.slice(0, 15),
    alerts: breaks.filter((b) => b.absDelta >= 0.3).slice(0, 5),
  };
}

export const _internals = {
  classifyRegime,
  buildNarrativePrompt,
  buildDigestPrompt,
  buildCurrentRegimeBriefPrompt,
};
