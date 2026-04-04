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
