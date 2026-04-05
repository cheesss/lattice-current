#!/usr/bin/env node
/**
 * event-dashboard-api.mjs — 이벤트 분석 대시보드용 REST API
 *
 * Endpoints:
 *   GET /api/sensitivity          전체 민감도 매트릭스
 *   GET /api/regime/:theme/:sym   Regime별 반응
 *   GET /api/hawkes/:theme        Hawkes 이슈 온도 타임라인
 *   GET /api/whatif/:theme/:sym   What-if 시뮬레이션 결과
 *   GET /api/event-search?q=      이벤트 검색
 *   GET /api/stock/:symbol        종목 프로파일
 *   GET /api/trends               기술 트렌드
 *   GET /api/anomalies            이상 반응
 *   GET /api/today                오늘의 주요 이벤트 + 과거 반응
 *   GET /api/heatmap              민감도 히트맵 데이터
 *   GET /api/live-status          시스템 현황
 *   GET /api/pending              대기중 outcome 상태
 *   GET /api/codex-latest         최근 Codex 발견/제안
 *
 * Usage: node --import tsx scripts/event-dashboard-api.mjs
 */

import http from 'http';
import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Pool } = pg;
const PG_CONFIG = { ...resolveNasPgConfig(), max: 5 };
const pool = new Pool(PG_CONFIG);
const PORT = Number(process.env.DASHBOARD_PORT || 46200);

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
  });
  res.end(JSON.stringify(data));
}

function parseUrl(url) {
  const [path, qs] = (url || '/').split('?');
  const params = new URLSearchParams(qs || '');
  const segments = path.split('/').filter(Boolean);
  return { path, segments, params };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { json(res, {}); return; }
  const { segments, params } = parseUrl(req.url);

  try {
    // ── /api/sensitivity ──
    if (segments[0] === 'api' && segments[1] === 'sensitivity') {
      const r = await pool.query(`
        SELECT theme, symbol, horizon, sample_size, avg_return, hit_rate, sensitivity_zscore, interpretation,
          (SELECT avg_abs_return FROM event_volatility_profiles v WHERE v.theme=s.theme AND v.symbol=s.symbol AND v.horizon=s.horizon) AS volatility
        FROM stock_sensitivity_matrix s
        ORDER BY theme, ABS(sensitivity_zscore) DESC
      `);
      json(res, r.rows);
      return;
    }

    // ── /api/regime/:theme/:symbol ──
    if (segments[0] === 'api' && segments[1] === 'regime') {
      const theme = segments[2] || '';
      const symbol = (segments[3] || '').toUpperCase();
      const r = await pool.query(
        'SELECT * FROM regime_conditional_impact WHERE ($1 = \'\' OR theme = $1) AND ($2 = \'\' OR symbol = $2) ORDER BY theme, symbol, regime',
        [theme, symbol]
      );
      json(res, r.rows);
      return;
    }

    // ── /api/hawkes/:theme ──
    if (segments[0] === 'api' && segments[1] === 'hawkes') {
      const theme = segments[2] || 'conflict';
      const r = await pool.query(
        'SELECT event_date, article_count, hawkes_intensity, normalized_temperature, is_surge FROM event_hawkes_intensity WHERE theme = $1 ORDER BY event_date',
        [theme]
      );
      json(res, r.rows);
      return;
    }

    // ── /api/whatif/:theme/:symbol ──
    if (segments[0] === 'api' && segments[1] === 'whatif') {
      const theme = segments[2] || '';
      const symbol = (segments[3] || '').toUpperCase();
      const r = await pool.query(
        'SELECT * FROM whatif_simulations WHERE ($1 = \'\' OR theme = $1) AND ($2 = \'\' OR symbol = $2) ORDER BY sharpe_ratio DESC',
        [theme, symbol]
      );
      json(res, r.rows);
      return;
    }

    // ── /api/event-search?q= ──
    if (segments[0] === 'api' && segments[1] === 'event-search') {
      const q = params.get('q') || '';
      const r = await pool.query(`
        SELECT DISTINCT ON (e.article_id)
          e.article_id, e.event_date, e.title, e.source, e.theme, e.symbol,
          e.forward_return_pct, e.hit, e.reaction_pattern, e.causal_explanation
        FROM event_impact_profiles e
        WHERE e.title ILIKE $1 AND e.horizon = '2w'
        ORDER BY e.article_id, ABS(e.forward_return_pct) DESC
        LIMIT 50
      `, ['%' + q + '%']);
      json(res, r.rows);
      return;
    }

    // ── /api/stock/:symbol ──
    if (segments[0] === 'api' && segments[1] === 'stock') {
      const symbol = (segments[2] || '').toUpperCase();
      const [sens, regime, whatif, patterns] = await Promise.all([
        pool.query('SELECT * FROM stock_sensitivity_matrix WHERE symbol = $1 ORDER BY horizon', [symbol]),
        pool.query('SELECT * FROM regime_conditional_impact WHERE symbol = $1 ORDER BY theme, regime', [symbol]),
        pool.query('SELECT * FROM whatif_simulations WHERE symbol = $1 ORDER BY sharpe_ratio DESC', [symbol]),
        pool.query(`
          SELECT reaction_pattern, COUNT(*) AS n, AVG(forward_return_pct::numeric) AS avg_ret
          FROM event_impact_profiles WHERE symbol = $1 AND horizon = '2w' AND reaction_pattern IS NOT NULL
          GROUP BY reaction_pattern ORDER BY n DESC
        `, [symbol]),
      ]);
      json(res, { sensitivity: sens.rows, regime: regime.rows, whatif: whatif.rows, patterns: patterns.rows });
      return;
    }

    // ── /api/trends ──
    if (segments[0] === 'api' && segments[1] === 'trends') {
      const topics = {
        'AI/LLM': ['AI', 'artificial intelligence', 'GPT', 'LLM'],
        'Semiconductor': ['semiconductor', 'chip', 'TSMC'],
        'Cyber Security': ['cyber', 'ransomware', 'hack'],
        'EV/Battery': ['EV', 'battery', 'electric vehicle'],
        'Drone/Robotics': ['drone', 'robot', 'autonomous'],
        'Nuclear/Fusion': ['nuclear', 'fusion', 'SMR'],
        'Biotech/Gene': ['biotech', 'CRISPR', 'mRNA'],
        'Renewable': ['solar', 'renewable', 'hydrogen'],
      };
      const results = [];
      for (const [name, kws] of Object.entries(topics)) {
        const cond = kws.map((_, i) => `title ILIKE $${i + 1}`).join(' OR ');
        const r = await pool.query(
          `SELECT DATE_TRUNC('month', published_at)::date AS month, COUNT(*) AS n FROM articles WHERE ${cond} GROUP BY month ORDER BY month`,
          kws.map(k => '%' + k + '%')
        );
        const counts = r.rows.map(row => ({ month: row.month, n: Number(row.n) }));
        const recent = counts.slice(-3);
        const prev = counts.slice(-6, -3);
        const recentAvg = recent.length > 0 ? recent.reduce((s, r) => s + r.n, 0) / recent.length : 0;
        const prevAvg = prev.length > 0 ? prev.reduce((s, r) => s + r.n, 0) / prev.length : 0;
        const momentum = prevAvg > 0 ? ((recentAvg - prevAvg) / prevAvg * 100) : 0;
        results.push({ name, momentum, recentAvg, total: counts.reduce((s, c) => s + c.n, 0), timeline: counts });
      }
      json(res, results);
      return;
    }

    // ── /api/anomalies ──
    if (segments[0] === 'api' && segments[1] === 'anomalies') {
      const year = params.get('year');
      const r = await pool.query(`
        SELECT event_date, theme, symbol, forward_return_pct, expected_return, z_score, anomaly_type, title
        FROM event_anomalies
        ${year ? "WHERE EXTRACT(YEAR FROM event_date) = $1" : ''}
        ORDER BY ABS(z_score) DESC LIMIT 30
      `, year ? [year] : []);
      json(res, r.rows);
      return;
    }

    // ── /api/today ── Today's key events + historical reaction data
    if (segments[0] === 'api' && segments[1] === 'today') {
      const articlesR = await pool.query(`
        SELECT id, title, source, published_at
        FROM articles
        WHERE published_at >= NOW() - INTERVAL '24 hours'
        ORDER BY published_at DESC
        LIMIT 50
      `);
      const themesR = await pool.query(`
        SELECT article_id, theme
        FROM auto_article_themes
        WHERE article_id = ANY($1::int[])
      `, [articlesR.rows.map(a => a.id)]);
      const themeMap = {};
      for (const t of themesR.rows) {
        if (!themeMap[t.article_id]) themeMap[t.article_id] = [];
        themeMap[t.article_id].push(t.theme);
      }
      const allThemes = [...new Set(themesR.rows.map(t => t.theme))];
      const [sensR, hawkesR] = await Promise.all([
        allThemes.length > 0
          ? pool.query(`
              SELECT theme, symbol, avg_return, hit_rate
              FROM stock_sensitivity_matrix
              WHERE theme = ANY($1::text[]) AND horizon = '2w'
              ORDER BY theme, ABS(avg_return) DESC
            `, [allThemes])
          : { rows: [] },
        allThemes.length > 0
          ? pool.query(`
              SELECT DISTINCT ON (theme) theme, normalized_temperature
              FROM event_hawkes_intensity
              WHERE theme = ANY($1::text[])
              ORDER BY theme, event_date DESC
            `, [allThemes])
          : { rows: [] },
      ]);
      const sensByTheme = {};
      for (const s of sensR.rows) {
        if (!sensByTheme[s.theme]) sensByTheme[s.theme] = [];
        sensByTheme[s.theme].push({ symbol: s.symbol, avgReturn: s.avg_return, hitRate: s.hit_rate });
      }
      const hawkesByTheme = {};
      for (const h of hawkesR.rows) hawkesByTheme[h.theme] = h.normalized_temperature;
      const result = articlesR.rows.map(a => {
        const themes = themeMap[a.id] || [];
        const primaryTheme = themes[0] || null;
        return {
          title: a.title,
          source: a.source,
          theme: primaryTheme,
          date: a.published_at,
          expectedReactions: primaryTheme ? (sensByTheme[primaryTheme] || []) : [],
          hawkesTemp: primaryTheme ? (hawkesByTheme[primaryTheme] ?? null) : null,
        };
      });
      json(res, result);
      return;
    }

    // ── /api/heatmap ── Full sensitivity heatmap data
    if (segments[0] === 'api' && segments[1] === 'heatmap') {
      const r = await pool.query(`
        SELECT theme, symbol, avg_return, hit_rate
        FROM stock_sensitivity_matrix
        WHERE horizon = '2w'
        ORDER BY theme, symbol
      `);
      const themes = [...new Set(r.rows.map(d => d.theme))];
      const symbols = [...new Set(r.rows.map(d => d.symbol))];
      const data = r.rows.map(d => ({
        theme: d.theme,
        symbol: d.symbol,
        avgReturn: d.avg_return,
        hitRate: d.hit_rate,
      }));
      json(res, { themes, symbols, data });
      return;
    }

    // ── /api/live-status ── Current system status
    if (segments[0] === 'api' && segments[1] === 'live-status') {
      const [signalsR, tempsR, pendingR, todayArticlesR] = await Promise.all([
        pool.query(`
          SELECT DISTINCT ON (signal_name) signal_name AS name, signal_value AS value, recorded_at AS "updatedAt"
          FROM signal_history
          ORDER BY signal_name, recorded_at DESC
        `),
        pool.query(`
          SELECT DISTINCT ON (theme) theme, normalized_temperature AS temp,
            CASE
              WHEN normalized_temperature >= 0.8 THEN 'hot'
              WHEN normalized_temperature >= 0.4 THEN 'warm'
              ELSE 'cool'
            END AS status
          FROM event_hawkes_intensity
          ORDER BY theme, event_date DESC
        `),
        pool.query(`SELECT COUNT(*)::int AS cnt FROM pending_outcomes WHERE status = 'waiting'`),
        pool.query(`SELECT COUNT(*)::int AS cnt FROM articles WHERE published_at >= CURRENT_DATE`),
      ]);
      json(res, {
        signals: signalsR.rows,
        temperatures: tempsR.rows,
        pending: pendingR.rows[0]?.cnt ?? 0,
        todayArticles: todayArticlesR.rows[0]?.cnt ?? 0,
      });
      return;
    }

    // ── /api/pending ── Pending outcomes status
    if (segments[0] === 'api' && segments[1] === 'pending') {
      const r = await pool.query(`
        SELECT
          article_id AS "articleId",
          theme,
          symbol,
          entry_price AS "entryPrice",
          entry_date AS "entryDate",
          target_date AS "targetDate",
          GREATEST(0, (target_date::date - CURRENT_DATE)::int) AS "daysRemaining"
        FROM pending_outcomes
        WHERE status = 'waiting'
        ORDER BY target_date ASC
      `);
      json(res, r.rows);
      return;
    }

    // ── /api/codex-latest ── Latest Codex/analysis discoveries
    if (segments[0] === 'api' && segments[1] === 'codex-latest') {
      let discoveries = null;
      try {
        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.resolve('data/codex-discoveries.json');
        if (fs.existsSync(filePath)) {
          discoveries = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
      } catch { /* file not found or parse error — ignore */ }
      const proposalsR = await pool.query(`
        SELECT *
        FROM codex_proposals
        ORDER BY created_at DESC
        LIMIT 20
      `);
      json(res, { discoveries, proposals: proposalsR.rows });
      return;
    }

    // ── Static file serving for dashboard ──
    if (segments.length === 0 || segments[0] === 'dashboard') {
      const fs = await import('fs');
      const path = await import('path');
      const htmlPath = path.resolve('event-dashboard.html');
      try {
        const html = fs.readFileSync(htmlPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch {
        res.writeHead(404); res.end('Dashboard HTML not found');
      }
      return;
    }

    json(res, { error: 'Not found' }, 404);
  } catch (err) {
    console.error(err);
    json(res, { error: String(err.message || err) }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`Event Dashboard API running at http://localhost:${PORT}`);
  console.log(`Dashboard UI: http://localhost:${PORT}/dashboard`);
});
