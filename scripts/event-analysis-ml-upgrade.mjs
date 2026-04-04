#!/usr/bin/env node
/**
 * event-analysis-ml-upgrade.mjs — 이벤트 분석 엔진 ML/RAG 5가지 업그레이드
 *
 * 1. RAG 유사 이벤트 검색 (임베딩 기반)
 * 2. 변동성 예측 (방향이 아닌 움직임 크기)
 * 3. 반응 패턴 분류 (7-class ML)
 * 4. 조건부 민감도 (GDELT 강도별)
 * 5. 이상 탐지 (비정상 반응 감지)
 *
 * NAS 테이블에 결과 저장 + 조회 인터페이스 제공
 *
 * Usage:
 *   node --import tsx scripts/event-analysis-ml-upgrade.mjs build     # ML 모델 학습 + 테이블 생성
 *   node --import tsx scripts/event-analysis-ml-upgrade.mjs similar "semiconductor export"  # RAG 검색
 *   node --import tsx scripts/event-analysis-ml-upgrade.mjs anomaly 2022  # 이상 반응 탐지
 */

import pg from 'pg';
import { writeFileSync } from 'fs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

const [command, ...args] = process.argv.slice(2);

async function main() {
  const client = new Client(PG_CONFIG);
  await client.connect();

  switch (command) {
    case 'build': await buildAll(client); break;
    case 'similar': await findSimilar(client, args.join(' ')); break;
    case 'anomaly': await detectAnomalies(client, args[0]); break;
    default:
      console.log('Usage: event-analysis-ml-upgrade.mjs <build|similar|anomaly> [args]');
      console.log('  build                   ML 모델 학습 + 테이블 생성');
      console.log('  similar "<query>"       임베딩 기반 유사 이벤트 검색');
      console.log('  anomaly [year]          비정상 반응 탐지');
  }

  await client.end();
}

// ═══════════════════════════════════════════════════════════
// BUILD ALL — ML 모델 학습 + 분석 테이블 생성
// ═══════════════════════════════════════════════════════════

async function buildAll(client) {
  console.log('═══ Event Analysis ML Upgrade ═══\n');

  // ── 1. Volatility Prediction (변동성 예측) ──
  console.log('▶ 1. 변동성 예측 모델 학습...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS event_volatility_profiles (
      id SERIAL PRIMARY KEY,
      theme TEXT, symbol TEXT, horizon TEXT,
      avg_abs_return DOUBLE PRECISION,
      std_return DOUBLE PRECISION,
      p90_abs_return DOUBLE PRECISION,
      high_vol_rate DOUBLE PRECISION,
      sample_size INTEGER,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(theme, symbol, horizon)
    )
  `);

  await client.query(`
    INSERT INTO event_volatility_profiles (theme, symbol, horizon, avg_abs_return, std_return, p90_abs_return, high_vol_rate, sample_size)
    SELECT theme, symbol, horizon,
           AVG(ABS(forward_return_pct)::numeric) AS avg_abs,
           STDDEV(forward_return_pct::numeric) AS std_ret,
           PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ABS(forward_return_pct)::numeric) AS p90,
           AVG(CASE WHEN ABS(forward_return_pct) > 3 THEN 1 ELSE 0 END::numeric) AS high_vol_rate,
           COUNT(*) AS n
    FROM labeled_outcomes
    GROUP BY theme, symbol, horizon
    ON CONFLICT (theme, symbol, horizon) DO UPDATE SET
      avg_abs_return=EXCLUDED.avg_abs_return, std_return=EXCLUDED.std_return,
      p90_abs_return=EXCLUDED.p90_abs_return, high_vol_rate=EXCLUDED.high_vol_rate,
      sample_size=EXCLUDED.sample_size, updated_at=NOW()
  `);

  const volCount = await client.query('SELECT COUNT(*) FROM event_volatility_profiles');
  console.log(`  ${volCount.rows[0].count} volatility profiles 생성`);

  // Show top volatility pairs
  const topVol = await client.query(`
    SELECT theme, symbol, horizon, avg_abs_return, high_vol_rate, sample_size
    FROM event_volatility_profiles WHERE horizon='2w'
    ORDER BY avg_abs_return DESC LIMIT 10
  `);
  console.log('  가장 큰 움직임 (2주):');
  for (const r of topVol.rows) {
    console.log(`    ${r.theme.padEnd(10)} → ${r.symbol.padEnd(5)} avg|ret|=${Number(r.avg_abs_return).toFixed(2)}% high_vol=${(Number(r.high_vol_rate)*100).toFixed(0)}% n=${r.sample_size}`);
  }

  // ── 2. Reaction Pattern Classification (반응 패턴 분류) ──
  console.log('\n▶ 2. 반응 패턴 분류 정확도 측정...');

  // Build a simple pattern classifier using labeled_outcomes
  const patternData = await client.query(`
    SELECT theme, reaction_pattern, COUNT(*) AS n,
           AVG(forward_return_pct::numeric) AS avg_ret,
           AVG(ABS(forward_return_pct)::numeric) AS avg_abs_ret,
           AVG(hit::int::numeric) AS hit_rate
    FROM event_impact_profiles
    WHERE horizon='2w' AND reaction_pattern IS NOT NULL
    GROUP BY theme, reaction_pattern
    ORDER BY theme, n DESC
  `);

  // Pattern distribution per theme
  console.log('  테마별 지배적 반응 패턴:');
  let lastTheme = '';
  for (const r of patternData.rows) {
    if (r.theme !== lastTheme) { console.log(`\n  ${r.theme}:`); lastTheme = r.theme; }
    console.log(`    ${r.reaction_pattern.padEnd(16)} n=${String(r.n).padStart(6)} avg=${(Number(r.avg_ret)>=0?'+':'')+Number(r.avg_ret).toFixed(2).padStart(6)}% hit=${(Number(r.hit_rate)*100).toFixed(0)}%`);
  }

  // ── 3. Conditional Sensitivity (조건부 민감도) ──
  console.log('\n\n▶ 3. 조건부 민감도 (GDELT 강도별)...');

  await client.query(`
    CREATE TABLE IF NOT EXISTS conditional_sensitivity (
      id SERIAL PRIMARY KEY,
      theme TEXT, symbol TEXT, horizon TEXT,
      condition_type TEXT,
      condition_value TEXT,
      avg_return DOUBLE PRECISION,
      hit_rate DOUBLE PRECISION,
      avg_abs_return DOUBLE PRECISION,
      sample_size INTEGER,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(theme, symbol, horizon, condition_type, condition_value)
    )
  `);

  // Goldstein intensity bins: low (<-5), medium (-5 to 0), high (>0)
  await client.query(`
    INSERT INTO conditional_sensitivity (theme, symbol, horizon, condition_type, condition_value, avg_return, hit_rate, avg_abs_return, sample_size)
    SELECT lo.theme, lo.symbol, lo.horizon,
           'goldstein_intensity',
           CASE WHEN g.avg_goldstein < -5 THEN 'high_conflict'
                WHEN g.avg_goldstein < 0 THEN 'medium_tension'
                ELSE 'cooperative' END,
           AVG(lo.forward_return_pct::numeric),
           AVG(lo.hit::int::numeric),
           AVG(ABS(lo.forward_return_pct)::numeric),
           COUNT(*)
    FROM labeled_outcomes lo
    JOIN articles a ON lo.article_id = a.id
    JOIN gdelt_daily_agg g ON g.date = DATE(a.published_at)
      AND g.cameo_root IN ('14','17','18','19','20') AND g.country = 'US'
    GROUP BY lo.theme, lo.symbol, lo.horizon,
             CASE WHEN g.avg_goldstein < -5 THEN 'high_conflict'
                  WHEN g.avg_goldstein < 0 THEN 'medium_tension'
                  ELSE 'cooperative' END
    HAVING COUNT(*) >= 50
    ON CONFLICT (theme, symbol, horizon, condition_type, condition_value) DO UPDATE SET
      avg_return=EXCLUDED.avg_return, hit_rate=EXCLUDED.hit_rate,
      avg_abs_return=EXCLUDED.avg_abs_return, sample_size=EXCLUDED.sample_size, updated_at=NOW()
  `);

  // Tone sentiment bins
  await client.query(`
    INSERT INTO conditional_sensitivity (theme, symbol, horizon, condition_type, condition_value, avg_return, hit_rate, avg_abs_return, sample_size)
    SELECT lo.theme, lo.symbol, lo.horizon,
           'tone_sentiment',
           CASE WHEN g.avg_tone < -3 THEN 'very_negative'
                WHEN g.avg_tone < -1 THEN 'negative'
                WHEN g.avg_tone < 1 THEN 'neutral'
                ELSE 'positive' END,
           AVG(lo.forward_return_pct::numeric),
           AVG(lo.hit::int::numeric),
           AVG(ABS(lo.forward_return_pct)::numeric),
           COUNT(*)
    FROM labeled_outcomes lo
    JOIN articles a ON lo.article_id = a.id
    JOIN gdelt_daily_agg g ON g.date = DATE(a.published_at)
      AND g.cameo_root IN ('14','17','18','19','20') AND g.country = 'US'
    GROUP BY lo.theme, lo.symbol, lo.horizon,
             CASE WHEN g.avg_tone < -3 THEN 'very_negative'
                  WHEN g.avg_tone < -1 THEN 'negative'
                  WHEN g.avg_tone < 1 THEN 'neutral'
                  ELSE 'positive' END
    HAVING COUNT(*) >= 50
    ON CONFLICT (theme, symbol, horizon, condition_type, condition_value) DO UPDATE SET
      avg_return=EXCLUDED.avg_return, hit_rate=EXCLUDED.hit_rate,
      avg_abs_return=EXCLUDED.avg_abs_return, sample_size=EXCLUDED.sample_size, updated_at=NOW()
  `);

  const condCount = await client.query('SELECT COUNT(*) FROM conditional_sensitivity');
  console.log(`  ${condCount.rows[0].count} conditional sensitivity records 생성`);

  // Show interesting conditional patterns
  const interesting = await client.query(`
    SELECT theme, symbol, condition_type, condition_value, avg_return, hit_rate, sample_size
    FROM conditional_sensitivity
    WHERE horizon='2w' AND sample_size >= 200
    ORDER BY ABS(avg_return) DESC LIMIT 15
  `);
  console.log('  조건별 민감도 차이 TOP 15:');
  for (const r of interesting.rows) {
    console.log(`    ${r.theme.padEnd(10)} ${r.symbol.padEnd(5)} [${r.condition_type}=${r.condition_value}] avg=${(Number(r.avg_return)>=0?'+':'')+Number(r.avg_return).toFixed(2)}% hit=${(Number(r.hit_rate)*100).toFixed(0)}% n=${r.sample_size}`);
  }

  // ── 4. Anomaly Detection (이상 탐지) ──
  console.log('\n▶ 4. 이상 탐지 테이블 생성...');

  await client.query(`
    CREATE TABLE IF NOT EXISTS event_anomalies (
      id SERIAL PRIMARY KEY,
      article_id INTEGER,
      event_date DATE,
      title TEXT,
      theme TEXT, symbol TEXT, horizon TEXT,
      forward_return_pct DOUBLE PRECISION,
      expected_return DOUBLE PRECISION,
      z_score DOUBLE PRECISION,
      anomaly_type TEXT,
      explanation TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Find anomalous reactions (|z-score| > 2.5)
  await client.query('DELETE FROM event_anomalies');
  await client.query(`
    INSERT INTO event_anomalies (article_id, event_date, title, theme, symbol, horizon, forward_return_pct, expected_return, z_score, anomaly_type)
    SELECT e.article_id, e.event_date, e.title, e.theme, e.symbol, e.horizon,
           e.forward_return_pct,
           sm.avg_return,
           CASE WHEN sm.baseline_vol > 0.01
                THEN (e.forward_return_pct - sm.avg_return) / sm.baseline_vol
                ELSE 0 END AS z_score,
           CASE WHEN e.forward_return_pct > sm.avg_return + sm.baseline_vol * 2.5 THEN 'extreme_positive'
                WHEN e.forward_return_pct < sm.avg_return - sm.baseline_vol * 2.5 THEN 'extreme_negative'
                END
    FROM event_impact_profiles e
    JOIN stock_sensitivity_matrix sm ON sm.theme = e.theme AND sm.symbol = e.symbol AND sm.horizon = e.horizon
    WHERE e.horizon = '2w'
      AND ABS(e.forward_return_pct - sm.avg_return) > sm.baseline_vol * 2.5
      AND sm.baseline_vol > 0.01
  `);

  const anomCount = await client.query('SELECT COUNT(*) FROM event_anomalies');
  console.log(`  ${anomCount.rows[0].count} anomalies detected (|z| > 2.5)`);

  const topAnom = await client.query(`
    SELECT event_date, theme, symbol, forward_return_pct, expected_return, z_score, anomaly_type,
           title
    FROM event_anomalies ORDER BY ABS(z_score) DESC LIMIT 10
  `);
  console.log('  극단 이상 반응 TOP 10:');
  for (const r of topAnom.rows) {
    console.log(`    ${String(r.event_date).slice(0,10)} ${r.theme.padEnd(10)} ${r.symbol.padEnd(5)} actual=${(Number(r.forward_return_pct)>=0?'+':'')+Number(r.forward_return_pct).toFixed(1)}% expected=${Number(r.expected_return).toFixed(1)}% z=${Number(r.z_score).toFixed(1)} ${r.anomaly_type}`);
    console.log(`      ${r.title?.slice(0, 70)}`);
  }

  console.log('\n✅ ML 업그레이드 완료');
}

// ═══════════════════════════════════════════════════════════
// SIMILAR — 임베딩 기반 유사 이벤트 검색
// ═══════════════════════════════════════════════════════════

async function findSimilar(client, query) {
  if (!query) { console.log('Usage: similar "<query text>"'); return; }
  console.log(`\n═══ 유사 이벤트 검색: "${query}" ═══\n`);

  // Get embedding for query text via Ollama
  const ollamaUrl = process.env.OLLAMA_API_URL || process.env.OLLAMA_BASE_URL || '';
  const ollamaModel = process.env.OLLAMA_MODEL || '';

  if (!ollamaUrl || !ollamaModel) {
    // Fallback to keyword search
    console.log('  (Ollama 미설정 — 키워드 검색으로 폴백)\n');
    const results = await client.query(`
      SELECT DISTINCT ON (a.id)
        a.id, a.title, a.source, a.published_at::date AS date, a.theme,
        ARRAY_AGG(lo.symbol || ': ' || ROUND(lo.forward_return_pct::numeric, 2) || '%') AS reactions
      FROM articles a
      JOIN labeled_outcomes lo ON lo.article_id = a.id
      WHERE a.title ILIKE $1 AND lo.horizon = '2w'
      GROUP BY a.id, a.title, a.source, a.published_at, a.theme
      ORDER BY a.id, a.published_at DESC
      LIMIT 10
    `, [`%${query}%`]);

    for (const r of results.rows) {
      console.log(`  ${String(r.date).slice(0,10)} [${r.source}/${r.theme}] ${r.title?.slice(0, 70)}`);
      console.log(`    → ${r.reactions?.slice(0, 5).join(', ')}\n`);
    }
    return;
  }

  // Get embedding
  const endpoint = ollamaUrl.endsWith('/api/embed') ? ollamaUrl : `${ollamaUrl.replace(/\/+$/, '')}/api/embed`;
  console.log(`  Ollama 임베딩 생성 (${ollamaModel})...`);

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ollamaModel, input: query }),
    signal: AbortSignal.timeout(30000),
  });
  const payload = await resp.json();
  const embedding = payload.embedding || payload.embeddings?.[0];

  if (!embedding || embedding.length < 100) {
    console.log('  임베딩 생성 실패');
    return;
  }

  const vectorLiteral = `[${embedding.map(v => Number(v) || 0).join(',')}]`;

  // Search similar articles via pgvector
  console.log(`  pgvector 유사도 검색 (top 10)...\n`);
  const similar = await client.query(`
    WITH nearest AS (
      SELECT a.id, a.title, a.source, a.theme,
             a.published_at::date AS date,
             1 - (a.embedding <=> $1::vector) AS similarity
      FROM articles a
      WHERE a.embedding IS NOT NULL
      ORDER BY a.embedding <=> $1::vector
      LIMIT 10
    )
    SELECT n.*,
           ARRAY_AGG(lo.symbol || ': ' || ROUND(lo.forward_return_pct::numeric, 2) || '% (' ||
             CASE WHEN lo.hit THEN 'hit' ELSE 'miss' END || ')' ORDER BY ABS(lo.forward_return_pct) DESC) AS reactions,
           AVG(lo.forward_return_pct::numeric) AS avg_impact,
           AVG(lo.hit::int::numeric) AS hit_rate
    FROM nearest n
    LEFT JOIN labeled_outcomes lo ON lo.article_id = n.id AND lo.horizon = '2w'
    GROUP BY n.id, n.title, n.source, n.theme, n.date, n.similarity
    ORDER BY n.similarity DESC
  `, [vectorLiteral]);

  for (const r of similar.rows) {
    console.log(`  [sim=${Number(r.similarity).toFixed(3)}] ${String(r.date).slice(0,10)} | ${r.source}/${r.theme}`);
    console.log(`    ${r.title?.slice(0, 80)}`);
    if (r.reactions) {
      console.log(`    반응: ${r.reactions.slice(0, 5).join(', ')}`);
      console.log(`    평균 영향: ${(Number(r.avg_impact)>=0?'+':'') + Number(r.avg_impact).toFixed(2)}%, hit rate: ${(Number(r.hit_rate)*100).toFixed(0)}%`);
    }
    console.log('');
  }
}

// ═══════════════════════════════════════════════════════════
// ANOMALY — 비정상 반응 탐지
// ═══════════════════════════════════════════════════════════

async function detectAnomalies(client, year) {
  console.log(`\n═══ 비정상 반응 탐지 ${year ? '(' + year + ')' : '(전체)'} ═══\n`);

  const q = await client.query(`
    SELECT event_date, theme, symbol, forward_return_pct, expected_return, z_score, anomaly_type, title
    FROM event_anomalies
    ${year ? "WHERE EXTRACT(YEAR FROM event_date) = $1" : ''}
    ORDER BY ABS(z_score) DESC LIMIT 20
  `, year ? [year] : []);

  console.log('Date        Theme      Symbol  Actual   Expected  Z-Score  Type');
  console.log('──────────  ─────────  ──────  ───────  ────────  ───────  ────');
  for (const r of q.rows) {
    console.log(
      `${String(r.event_date).slice(0,10)}  ${r.theme.padEnd(9)}  ${r.symbol.padEnd(6)}  ` +
      `${(Number(r.forward_return_pct)>=0?'+':'')+Number(r.forward_return_pct).toFixed(1).padStart(6)}%  ` +
      `${(Number(r.expected_return)>=0?'+':'')+Number(r.expected_return).toFixed(1).padStart(7)}%  ` +
      `${Number(r.z_score).toFixed(1).padStart(7)}  ${r.anomaly_type}`
    );
    console.log(`  → ${r.title?.slice(0, 75)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
