#!/usr/bin/env node
/**
 * event-impact-analysis.mjs — 이벤트-종목 반응 분석 엔진
 *
 * 618k labeled_outcomes + 60k articles + GDELT를 기반으로:
 * 1. 이벤트 유형별 종목 반응 프로파일
 * 2. 종목별 이벤트 민감도 매트릭스
 * 3. 시간대별 반응 곡선 (1w, 2w, 1m)
 * 4. 원인 분석 (왜 이 종목이 이 이벤트에 반응하는가)
 * 5. 유사 이벤트 검색 + 비교
 *
 * Usage:
 *   node --import tsx scripts/event-impact-analysis.mjs
 *   node --import tsx scripts/event-impact-analysis.mjs --symbol SOXX --theme tech
 *   node --import tsx scripts/event-impact-analysis.mjs --event-search "semiconductor export"
 */

import pg from 'pg';
import { writeFileSync } from 'fs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { symbol: null, theme: null, eventSearch: null, limit: 50, year: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--symbol') result.symbol = args[++i];
    if (args[i] === '--theme') result.theme = args[++i];
    if (args[i] === '--event-search') result.eventSearch = args[++i];
    if (args[i] === '--limit') result.limit = parseInt(args[++i]);
    if (args[i] === '--year') result.year = args[++i];
  }
  return result;
}

async function main() {
  const opts = parseArgs();
  const client = new Client(PG_CONFIG);
  await client.connect();

  const report = {
    generatedAt: new Date().toISOString(),
    filters: opts,
    sensitivityMatrix: null,
    eventProfiles: null,
    topEvents: null,
    reactionCurves: null,
    causalChains: null,
  };

  // ══════════════════════════════════════════════════════════
  // 1. 종목별 이벤트 유형 민감도 매트릭스
  // ══════════════════════════════════════════════════════════
  console.log('▶ 1. 종목-이벤트 민감도 매트릭스 생성...');
  const sensitivity = await client.query(`
    WITH stock_baseline AS (
      SELECT symbol, horizon,
             AVG(forward_return_pct::numeric) AS baseline_return,
             STDDEV(forward_return_pct::numeric) AS baseline_vol,
             COUNT(*) AS total_n
      FROM labeled_outcomes
      GROUP BY symbol, horizon
    ),
    theme_reaction AS (
      SELECT lo.theme, lo.symbol, lo.horizon,
             COUNT(*) AS n,
             AVG(lo.forward_return_pct::numeric) AS avg_return,
             STDDEV(lo.forward_return_pct::numeric) AS return_vol,
             AVG(lo.hit::int::numeric) AS hit_rate,
             PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY lo.forward_return_pct::numeric) AS p25,
             PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY lo.forward_return_pct::numeric) AS p75
      FROM labeled_outcomes lo
      GROUP BY lo.theme, lo.symbol, lo.horizon
    )
    SELECT tr.theme, tr.symbol, tr.horizon,
           tr.n, tr.avg_return, tr.return_vol, tr.hit_rate, tr.p25, tr.p75,
           sb.baseline_return, sb.baseline_vol,
           CASE WHEN sb.baseline_vol > 0.01
                THEN (tr.avg_return - sb.baseline_return) / sb.baseline_vol
                ELSE 0 END AS sensitivity_zscore,
           CASE WHEN sb.baseline_vol > 0.01
                THEN ABS(tr.avg_return - sb.baseline_return) / sb.baseline_vol
                ELSE 0 END AS abs_sensitivity
    FROM theme_reaction tr
    JOIN stock_baseline sb ON sb.symbol = tr.symbol AND sb.horizon = tr.horizon
    ORDER BY abs_sensitivity DESC
  `);

  report.sensitivityMatrix = sensitivity.rows.map(r => ({
    theme: r.theme,
    symbol: r.symbol,
    horizon: r.horizon,
    sampleSize: Number(r.n),
    avgReturn: Number(Number(r.avg_return).toFixed(3)),
    hitRate: Number(Number(r.hit_rate).toFixed(3)),
    returnVol: Number(Number(r.return_vol).toFixed(3)),
    sensitivityZScore: Number(Number(r.sensitivity_zscore).toFixed(3)),
    absSensitivity: Number(Number(r.abs_sensitivity).toFixed(3)),
    p25: Number(Number(r.p25).toFixed(3)),
    p75: Number(Number(r.p75).toFixed(3)),
    baselineReturn: Number(Number(r.baseline_return).toFixed(3)),
    baselineVol: Number(Number(r.baseline_vol).toFixed(3)),
    interpretation: interpretSensitivity(r),
  }));

  console.log(`  ${report.sensitivityMatrix.length}건 생성`);
  printSensitivityHighlights(report.sensitivityMatrix);

  // ══════════════════════════════════════════════════════════
  // 2. 시간대별 반응 곡선 (1w → 2w → 1m)
  // ══════════════════════════════════════════════════════════
  console.log('\n▶ 2. 시간대별 반응 곡선...');
  const curves = await client.query(`
    SELECT lo.theme, lo.symbol,
           MAX(CASE WHEN lo.horizon='1w' THEN lo.forward_return_pct END)::numeric AS ret_1w,
           MAX(CASE WHEN lo.horizon='2w' THEN lo.forward_return_pct END)::numeric AS ret_2w,
           MAX(CASE WHEN lo.horizon='1m' THEN lo.forward_return_pct END)::numeric AS ret_1m,
           a.id AS article_id, a.title, a.published_at::date AS event_date
    FROM labeled_outcomes lo
    JOIN articles a ON lo.article_id = a.id
    ${opts.symbol ? 'WHERE lo.symbol = $1' : opts.theme ? 'WHERE lo.theme = $1' : ''}
    GROUP BY lo.theme, lo.symbol, a.id, a.title, a.published_at
    HAVING COUNT(DISTINCT lo.horizon) >= 2
    ORDER BY a.published_at DESC
    LIMIT $${opts.symbol || opts.theme ? 2 : 1}
  `, opts.symbol ? [opts.symbol, opts.limit] : opts.theme ? [opts.theme, opts.limit] : [opts.limit]);

  report.reactionCurves = curves.rows.map(r => ({
    eventDate: r.event_date,
    title: r.title,
    theme: r.theme,
    symbol: r.symbol,
    returns: {
      '1w': r.ret_1w != null ? Number(Number(r.ret_1w).toFixed(3)) : null,
      '2w': r.ret_2w != null ? Number(Number(r.ret_2w).toFixed(3)) : null,
      '1m': r.ret_1m != null ? Number(Number(r.ret_1m).toFixed(3)) : null,
    },
    pattern: classifyReactionPattern(r),
  }));

  console.log(`  ${report.reactionCurves.length}건 반응 곡선 생성`);

  // ══════════════════════════════════════════════════════════
  // 3. 가장 큰 반응을 일으킨 이벤트 TOP 30
  // ══════════════════════════════════════════════════════════
  console.log('\n▶ 3. 최대 반응 이벤트 TOP 30...');
  const topEvents = await client.query(`
    WITH event_impact AS (
      SELECT a.id AS article_id, a.title, a.source, a.theme AS article_theme,
             a.published_at::date AS event_date,
             COUNT(DISTINCT lo.symbol) AS affected_symbols,
             AVG(ABS(lo.forward_return_pct)::numeric) AS avg_abs_impact,
             MAX(ABS(lo.forward_return_pct)::numeric) AS max_abs_impact,
             ARRAY_AGG(DISTINCT lo.symbol || ':' || lo.horizon || ':' || ROUND(lo.forward_return_pct::numeric, 2) || '%') AS reactions
      FROM articles a
      JOIN labeled_outcomes lo ON lo.article_id = a.id
      WHERE lo.horizon = '2w'
      ${opts.year ? "AND EXTRACT(YEAR FROM a.published_at) = $1" : ''}
      GROUP BY a.id, a.title, a.source, a.theme, a.published_at
      HAVING COUNT(*) >= 3
    )
    SELECT * FROM event_impact
    ORDER BY avg_abs_impact DESC
    LIMIT 30
  `, opts.year ? [opts.year] : []);

  report.topEvents = topEvents.rows.map(r => ({
    eventDate: r.event_date,
    title: r.title,
    source: r.source,
    theme: r.article_theme,
    affectedSymbols: r.affected_symbols,
    avgAbsImpact: Number(Number(r.avg_abs_impact).toFixed(3)),
    maxAbsImpact: Number(Number(r.max_abs_impact).toFixed(3)),
    reactions: r.reactions?.slice(0, 10),
  }));

  console.log(`  TOP 30 이벤트 (2주 기준):`);
  for (const e of report.topEvents.slice(0, 10)) {
    console.log(`  ${e.eventDate} | ${e.theme?.padEnd(10)} | impact=${e.avgAbsImpact.toFixed(1)}% | ${e.title?.slice(0, 70)}`);
    console.log(`    → ${e.reactions?.slice(0, 5).join(', ')}`);
  }

  // ══════════════════════════════════════════════════════════
  // 4. 원인 분석: 테마 → 종목 전파 경로
  // ══════════════════════════════════════════════════════════
  console.log('\n▶ 4. 원인 분석 (이벤트 유형 → 종목 반응 이유)...');
  report.causalChains = buildCausalChains(report.sensitivityMatrix);
  for (const chain of report.causalChains.slice(0, 8)) {
    console.log(`  ${chain.theme} → ${chain.symbol} (${chain.horizon}): ${chain.explanation}`);
  }

  // ══════════════════════════════════════════════════════════
  // 5. 유사 이벤트 검색 (임베딩 기반)
  // ══════════════════════════════════════════════════════════
  if (opts.eventSearch) {
    console.log(`\n▶ 5. 유사 이벤트 검색: "${opts.eventSearch}"...`);
    const similar = await client.query(`
      SELECT a.id, a.title, a.published_at::date AS event_date, a.source, a.theme,
             lo.symbol, lo.horizon, lo.forward_return_pct, lo.hit
      FROM articles a
      JOIN labeled_outcomes lo ON lo.article_id = a.id
      WHERE a.title ILIKE $1 AND lo.horizon = '2w'
      ORDER BY a.published_at DESC
      LIMIT 50
    `, [`%${opts.eventSearch}%`]);

    const grouped = {};
    for (const r of similar.rows) {
      const key = r.id;
      if (!grouped[key]) grouped[key] = { title: r.title, date: r.event_date, source: r.source, theme: r.theme, reactions: [] };
      grouped[key].reactions.push({ symbol: r.symbol, return: Number(r.forward_return_pct).toFixed(2) + '%', hit: r.hit });
    }
    report.eventSearch = { query: opts.eventSearch, results: Object.values(grouped) };

    console.log(`  ${Object.keys(grouped).length}건 유사 이벤트:`);
    for (const [, evt] of Object.entries(grouped).slice(0, 5)) {
      console.log(`  ${evt.date} | ${evt.title?.slice(0, 60)}`);
      for (const rx of evt.reactions) {
        const marker = rx.hit ? '✓' : '✗';
        console.log(`    ${marker} ${rx.symbol}: ${rx.return}`);
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // 6. 전체 통계 요약
  // ══════════════════════════════════════════════════════════
  console.log('\n▶ 6. 전체 통계 요약...');
  const summary = await client.query(`
    SELECT
      COUNT(DISTINCT a.id) AS total_events,
      COUNT(*) AS total_outcomes,
      COUNT(DISTINCT lo.symbol) AS total_symbols,
      MIN(a.published_at)::date AS first_event,
      MAX(a.published_at)::date AS last_event,
      AVG(lo.hit::int::numeric) AS overall_hit_rate,
      AVG(lo.forward_return_pct::numeric) AS overall_avg_return
    FROM labeled_outcomes lo
    JOIN articles a ON lo.article_id = a.id
  `);
  const s = summary.rows[0];
  report.summary = {
    totalEvents: Number(s.total_events),
    totalOutcomes: Number(s.total_outcomes),
    totalSymbols: Number(s.total_symbols),
    dateRange: `${s.first_event} ~ ${s.last_event}`,
    overallHitRate: Number(Number(s.overall_hit_rate).toFixed(3)),
    overallAvgReturn: Number(Number(s.overall_avg_return).toFixed(3)),
  };
  console.log(`  이벤트: ${s.total_events}건, 반응 측정: ${s.total_outcomes}건, 종목: ${s.total_symbols}종`);
  console.log(`  기간: ${s.first_event} ~ ${s.last_event}`);
  console.log(`  전체 평균 hit rate: ${(Number(s.overall_hit_rate) * 100).toFixed(1)}%, 평균 수익: ${Number(s.overall_avg_return).toFixed(3)}%`);

  // Save report
  const outFile = './data/event-impact-report.json';
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\n결과 저장: ${outFile}`);

  await client.end();
}

// ═══ Helper Functions ═══════════════════════════════════════

function interpretSensitivity(row) {
  const z = Number(row.sensitivity_zscore);
  const hit = Number(row.hit_rate);
  const ret = Number(row.avg_return);
  const horizon = row.horizon;

  let direction = z > 0.3 ? '양의 반응 (상승)' : z < -0.3 ? '음의 반응 (하락)' : '중립';
  let strength = Math.abs(z) > 1.0 ? '강한' : Math.abs(z) > 0.5 ? '중간' : '약한';
  let reliability = hit > 0.6 ? '신뢰도 높음' : hit > 0.5 ? '보통' : '신뢰도 낮음';

  return `${strength} ${direction}, ${horizon} 기준 평균 ${ret > 0 ? '+' : ''}${ret.toFixed(2)}%, ${reliability} (hit ${(hit * 100).toFixed(0)}%)`;
}

function classifyReactionPattern(row) {
  const w1 = Number(row.ret_1w) || 0;
  const w2 = Number(row.ret_2w) || 0;
  const m1 = Number(row.ret_1m) || 0;

  if (w1 > 0 && w2 > w1 && m1 > w2) return 'momentum (지속 상승)';
  if (w1 < 0 && w2 < w1 && m1 < w2) return 'momentum (지속 하락)';
  if (w1 > 0 && m1 < 0) return 'reversal (초기 상승 → 반전)';
  if (w1 < 0 && m1 > 0) return 'reversal (초기 하락 → 반전)';
  if (Math.abs(w1) > Math.abs(m1)) return 'fade (초기 충격 → 소멸)';
  if (Math.abs(m1) > Math.abs(w1) * 2) return 'delayed (지연 반응)';
  return 'mixed';
}

const CAUSAL_MAP = {
  conflict: {
    GLD: '지정학 불안 → 안전자산 수요 증가 → 금 가격 상승',
    ITA: '군사 긴장 → 방산주 수주 기대 → 방산 ETF 상승',
    TLT: '위험 회피 → 국채 수요 → 금리 하락/채권 상승',
    USO: '분쟁 지역 공급 차질 우려 → 유가 상승',
    XLE: '유가 상승 → 에너지 기업 수익 증가 기대',
  },
  tech: {
    SMH: '반도체 수출규제/기술패권 이슈 → 반도체 공급망 재편 → 반도체 ETF 영향',
    QQQ: '기술주 전반 센티먼트 변화 → 나스닥 ETF 연동',
    NVDA: 'AI/반도체 직접 수혜/피해 기업 → 고베타 반응',
    AMD: '반도체 경쟁 구도 변화 → 시장점유율 기대 변화',
    CIBR: '사이버보안 위협/규제 → 보안 ETF 수혜',
  },
  energy: {
    USO: '산유국 정책/분쟁 → 원유 공급 변화 → 유가 직접 반응',
    XLE: '유가 변동 → 에너지 기업 수익 변화',
    COP: '원유 메이저 기업 → 유가 민감도 높음',
    CVX: '통합 에너지 기업 → 유가+정제마진 복합 반응',
    UNG: '천연가스 가격 → 독립적 공급/수요 요인',
  },
  economy: {
    SPY: '거시경제 지표 → 시장 전체 센티먼트 변화',
    TLT: '금리 기대 변화 → 채권 가격 역상관',
    DBC: '경기 사이클 → 원자재 수요 변화',
    UUP: '금리 차이/경제 강세 → 달러 강세/약세',
    XRT: '소비자 심리/소매 판매 → 소매 섹터 반응',
  },
  politics: {
    SPY: '정치적 불확실성 → 시장 위험 프리미엄 변화',
    GLD: '정책 불확실성 → 안전자산 선호',
    TLT: '재정정책/통화정책 기대 → 금리 변화',
    EFA: '국제관계 변화 → 선진국 시장 영향',
    UUP: '무역정책/지정학 → 달러 수요 변화',
  },
};

function buildCausalChains(sensitivityMatrix) {
  const chains = [];
  const seen = new Set();

  for (const row of sensitivityMatrix) {
    const key = `${row.theme}:${row.symbol}`;
    if (seen.has(key) || row.horizon !== '2w') continue;
    seen.add(key);

    const explanation = CAUSAL_MAP[row.theme]?.[row.symbol]
      || `${row.theme} 이벤트 → ${row.symbol} ${row.avgReturn > 0 ? '상승' : '하락'} 반응 (메커니즘 분석 필요)`;

    chains.push({
      theme: row.theme,
      symbol: row.symbol,
      horizon: row.horizon,
      avgReturn: row.avgReturn,
      hitRate: row.hitRate,
      sensitivity: row.sensitivityZScore,
      explanation,
      evidence: `${row.sampleSize}건 기반, 평균 ${row.avgReturn > 0 ? '+' : ''}${row.avgReturn.toFixed(2)}%, hit ${(row.hitRate * 100).toFixed(0)}%`,
    });
  }

  return chains.sort((a, b) => Math.abs(b.sensitivity) - Math.abs(a.sensitivity));
}

function printSensitivityHighlights(matrix) {
  console.log('\n  ── 2주 기준 민감도 TOP 10 (양의 반응) ──');
  const twoWeek = matrix.filter(r => r.horizon === '2w').sort((a, b) => b.sensitivityZScore - a.sensitivityZScore);
  for (const r of twoWeek.slice(0, 10)) {
    console.log(`  ${r.theme.padEnd(10)} → ${r.symbol.padEnd(5)} z=${r.sensitivityZScore.toFixed(2).padStart(6)} avg=${(r.avgReturn > 0 ? '+' : '') + r.avgReturn.toFixed(2).padStart(6)}% hit=${(r.hitRate * 100).toFixed(0).padStart(3)}% n=${r.sampleSize}`);
  }

  console.log('\n  ── 2주 기준 민감도 TOP 10 (음의 반응) ──');
  for (const r of twoWeek.slice(-10).reverse()) {
    console.log(`  ${r.theme.padEnd(10)} → ${r.symbol.padEnd(5)} z=${r.sensitivityZScore.toFixed(2).padStart(6)} avg=${(r.avgReturn > 0 ? '+' : '') + r.avgReturn.toFixed(2).padStart(6)}% hit=${(r.hitRate * 100).toFixed(0).padStart(3)}% n=${r.sampleSize}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
