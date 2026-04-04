#!/usr/bin/env node
/**
 * query-event-impact.mjs — 이벤트-종목 반응 분석 조회
 *
 * Examples:
 *   node --import tsx scripts/query-event-impact.mjs stock NVDA
 *   node --import tsx scripts/query-event-impact.mjs event "semiconductor"
 *   node --import tsx scripts/query-event-impact.mjs date 2022-02-24
 *   node --import tsx scripts/query-event-impact.mjs top-movers 2023
 *   node --import tsx scripts/query-event-impact.mjs sensitivity
 *   node --import tsx scripts/query-event-impact.mjs explain conflict GLD
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

const [command, ...args] = process.argv.slice(2);

async function main() {
  const client = new Client(PG_CONFIG);
  await client.connect();

  switch (command) {
    case 'stock': await queryStock(client, args[0]); break;
    case 'event': await queryEvent(client, args.join(' ')); break;
    case 'date': await queryDate(client, args[0]); break;
    case 'top-movers': await queryTopMovers(client, args[0]); break;
    case 'sensitivity': await querySensitivity(client); break;
    case 'explain': await queryExplain(client, args[0], args[1]); break;
    case 'compare': await queryCompare(client, args[0], args[1]); break;
    default:
      console.log(`
이벤트-종목 반응 분석 조회 도구

Commands:
  stock <SYMBOL>              종목별 이벤트 반응 요약
  event "<keyword>"           키워드로 이벤트 검색 + 종목 반응
  date <YYYY-MM-DD>           특정 날짜의 이벤트와 시장 반응
  top-movers [year]           가장 큰 반응을 일으킨 이벤트
  sensitivity                 전체 민감도 매트릭스
  explain <theme> <symbol>    왜 이 종목이 이 이벤트에 반응하는지
  compare <symbol1> <symbol2> 두 종목의 이벤트 반응 비교
      `);
  }

  await client.end();
}

async function queryStock(client, symbol) {
  if (!symbol) { console.log('Usage: stock <SYMBOL>'); return; }
  symbol = symbol.toUpperCase();
  console.log(`\n═══ ${symbol} 이벤트 반응 프로파일 ═══\n`);

  // Sensitivity by theme
  const sens = await client.query(
    'SELECT theme, horizon, sample_size, avg_return, hit_rate, sensitivity_zscore, interpretation FROM stock_sensitivity_matrix WHERE symbol = $1 ORDER BY ABS(sensitivity_zscore) DESC',
    [symbol]
  );
  console.log('── 테마별 민감도 ──');
  console.log('Theme'.padEnd(12), 'Horizon', 'N'.padStart(6), 'AvgRet%'.padStart(8), 'HitRate'.padStart(8), 'Sensitivity'.padStart(11));
  for (const r of sens.rows) {
    const z = Number(r.sensitivity_zscore);
    const bar = z > 0.02 ? '▲' : z < -0.02 ? '▼' : '─';
    console.log(
      r.theme.padEnd(12), r.horizon.padEnd(7),
      String(r.sample_size).padStart(6),
      (Number(r.avg_return) >= 0 ? '+' : '') + Number(r.avg_return).toFixed(2).padStart(7) + '%',
      (Number(r.hit_rate) * 100).toFixed(0).padStart(5) + '%  ',
      bar + ' ' + z.toFixed(3)
    );
  }

  // Recent big reactions
  console.log('\n── 최근 큰 반응 (2주 기준, |return| > 3%) ──');
  const big = await client.query(`
    SELECT event_date, title, theme, forward_return_pct, hit, reaction_pattern, causal_explanation
    FROM event_impact_profiles
    WHERE symbol = $1 AND horizon = '2w' AND ABS(forward_return_pct) > 3
    ORDER BY event_date DESC LIMIT 10
  `, [symbol]);
  for (const r of big.rows) {
    const marker = r.hit ? '✓' : '✗';
    console.log(`  ${marker} ${r.event_date?.toISOString?.()?.slice(0, 10) || r.event_date} | ${r.theme?.padEnd(10)} | ${(r.forward_return_pct >= 0 ? '+' : '')}${Number(r.forward_return_pct).toFixed(2)}% | ${r.reaction_pattern || ''}`);
    console.log(`    ${r.title?.slice(0, 80)}`);
    if (r.causal_explanation) console.log(`    → ${r.causal_explanation}`);
  }

  // Reaction pattern distribution
  console.log('\n── 반응 패턴 분포 ──');
  const patterns = await client.query(`
    SELECT reaction_pattern, COUNT(*) as n, AVG(forward_return_pct::numeric) as avg_ret, AVG(hit::int::numeric) as hit_rate
    FROM event_impact_profiles WHERE symbol = $1 AND horizon = '2w' AND reaction_pattern IS NOT NULL
    GROUP BY reaction_pattern ORDER BY n DESC
  `, [symbol]);
  for (const r of patterns.rows) {
    console.log(`  ${(r.reaction_pattern || 'unknown').padEnd(16)} n=${String(r.n).padStart(5)} avg=${(Number(r.avg_ret) >= 0 ? '+' : '') + Number(r.avg_ret).toFixed(2).padStart(6)}% hit=${(Number(r.hit_rate) * 100).toFixed(0)}%`);
  }
}

async function queryEvent(client, keyword) {
  if (!keyword) { console.log('Usage: event "<keyword>"'); return; }
  console.log(`\n═══ "${keyword}" 관련 이벤트 반응 ═══\n`);

  const events = await client.query(`
    SELECT DISTINCT ON (e.article_id)
      e.article_id, e.event_date, e.title, e.source, e.theme,
      ARRAY_AGG(e.symbol || ': ' || CASE WHEN e.forward_return_pct >= 0 THEN '+' ELSE '' END || ROUND(e.forward_return_pct::numeric, 2) || '% (' || CASE WHEN e.hit THEN '✓' ELSE '✗' END || ')') AS reactions,
      AVG(ABS(e.forward_return_pct)::numeric) AS avg_impact
    FROM event_impact_profiles e
    WHERE e.title ILIKE $1 AND e.horizon = '2w'
    GROUP BY e.article_id, e.event_date, e.title, e.source, e.theme
    ORDER BY e.article_id, avg_impact DESC
    LIMIT 15
  `, [`%${keyword}%`]);

  for (const r of events.rows) {
    console.log(`${r.event_date?.toISOString?.()?.slice(0, 10) || r.event_date} | ${r.source} | ${r.theme}`);
    console.log(`  ${r.title?.slice(0, 90)}`);
    console.log(`  반응: ${r.reactions?.slice(0, 6).join(', ')}`);
    console.log('');
  }
  console.log(`총 ${events.rows.length}건`);
}

async function queryDate(client, date) {
  if (!date) { console.log('Usage: date <YYYY-MM-DD>'); return; }
  console.log(`\n═══ ${date} 이벤트 반응 ═══\n`);

  // GDELT context
  const gdelt = await client.query(`
    SELECT country, AVG(avg_goldstein)::numeric(4,1) as goldstein, AVG(avg_tone)::numeric(4,1) as tone, SUM(event_count) as events
    FROM gdelt_daily_agg WHERE date = $1::date AND country IN ('US','CN','RU','UA','IR')
    GROUP BY country ORDER BY events DESC
  `, [date]);
  if (gdelt.rows.length > 0) {
    console.log('── GDELT 분위기 ──');
    for (const r of gdelt.rows) {
      const mood = Number(r.goldstein) > 2 ? '협력적' : Number(r.goldstein) < -2 ? '갈등적' : '중립';
      console.log(`  ${r.country}: goldstein=${r.goldstein} (${mood}), tone=${r.tone}, events=${r.events}`);
    }
    console.log('');
  }

  const events = await client.query(`
    SELECT e.title, e.source, e.theme, e.symbol, e.forward_return_pct, e.hit, e.reaction_pattern, e.causal_explanation
    FROM event_impact_profiles e
    WHERE e.event_date = $1::date AND e.horizon = '2w'
    ORDER BY ABS(e.forward_return_pct) DESC LIMIT 30
  `, [date]);
  console.log('── 이벤트 → 종목 반응 ──');
  let lastTitle = '';
  for (const r of events.rows) {
    if (r.title !== lastTitle) {
      console.log(`\n  [${r.source}/${r.theme}] ${r.title?.slice(0, 80)}`);
      lastTitle = r.title;
    }
    const marker = r.hit ? '✓' : '✗';
    console.log(`    ${marker} ${r.symbol.padEnd(5)} ${(r.forward_return_pct >= 0 ? '+' : '')}${Number(r.forward_return_pct).toFixed(2)}% ${r.reaction_pattern || ''} ${r.causal_explanation ? '| ' + r.causal_explanation : ''}`);
  }
}

async function queryTopMovers(client, year) {
  console.log(`\n═══ 가장 큰 반응 이벤트 ${year ? '(' + year + ')' : '(전체)'} ═══\n`);
  const q = await client.query(`
    SELECT e.event_date, e.title, e.source, e.theme,
           ARRAY_AGG(e.symbol || ':' || ROUND(e.forward_return_pct::numeric, 1) || '%' ORDER BY ABS(e.forward_return_pct) DESC) AS reactions,
           AVG(ABS(e.forward_return_pct)::numeric) AS avg_impact,
           COUNT(DISTINCT e.symbol) AS symbols_affected
    FROM event_impact_profiles e
    WHERE e.horizon = '2w' ${year ? 'AND EXTRACT(YEAR FROM e.event_date) = $1' : ''}
    GROUP BY e.article_id, e.event_date, e.title, e.source, e.theme
    HAVING COUNT(DISTINCT e.symbol) >= 3
    ORDER BY avg_impact DESC
    LIMIT 20
  `, year ? [year] : []);

  for (const r of q.rows) {
    console.log(`${r.event_date?.toISOString?.()?.slice(0, 10) || r.event_date} | impact=${Number(r.avg_impact).toFixed(1)}% | ${r.symbols_affected} symbols | ${r.theme}`);
    console.log(`  ${r.title?.slice(0, 85)}`);
    console.log(`  → ${r.reactions?.slice(0, 5).join(', ')}`);
    console.log('');
  }
}

async function querySensitivity(client) {
  console.log('\n═══ 종목-이벤트 민감도 매트릭스 (2주 기준) ═══\n');
  const q = await client.query(`
    SELECT theme, symbol, avg_return, hit_rate, sensitivity_zscore, sample_size, interpretation
    FROM stock_sensitivity_matrix WHERE horizon = '2w'
    ORDER BY theme, ABS(sensitivity_zscore) DESC
  `);
  let lastTheme = '';
  for (const r of q.rows) {
    if (r.theme !== lastTheme) {
      console.log(`\n── ${r.theme.toUpperCase()} ──`);
      lastTheme = r.theme;
    }
    const z = Number(r.sensitivity_zscore);
    const bar = '█'.repeat(Math.min(20, Math.round(Math.abs(z) * 50)));
    console.log(
      `  ${r.symbol.padEnd(5)} ${(Number(r.avg_return) >= 0 ? '+' : '') + Number(r.avg_return).toFixed(2).padStart(6)}% hit=${(Number(r.hit_rate) * 100).toFixed(0).padStart(2)}% ${z >= 0 ? '▲' : '▼'}${bar} ${r.interpretation || ''}`
    );
  }
}

async function queryExplain(client, theme, symbol) {
  if (!theme || !symbol) { console.log('Usage: explain <theme> <symbol>'); return; }
  symbol = symbol.toUpperCase();
  console.log(`\n═══ ${theme} → ${symbol} 반응 분석 ═══\n`);

  // Sensitivity
  const sens = await client.query(
    'SELECT * FROM stock_sensitivity_matrix WHERE theme = $1 AND symbol = $2 ORDER BY horizon',
    [theme, symbol]
  );
  console.log('── 기간별 반응 ──');
  for (const r of sens.rows) {
    console.log(`  ${r.horizon}: avg=${(Number(r.avg_return) >= 0 ? '+' : '') + Number(r.avg_return).toFixed(2)}%, hit=${(Number(r.hit_rate) * 100).toFixed(0)}%, vol=${Number(r.return_vol).toFixed(2)}%, n=${r.sample_size}`);
  }

  // Causal
  const causal = await client.query(
    'SELECT DISTINCT causal_explanation FROM event_impact_profiles WHERE theme = $1 AND symbol = $2 AND causal_explanation IS NOT NULL LIMIT 1',
    [theme, symbol]
  );
  if (causal.rows[0]) {
    console.log(`\n── 원인 ──`);
    console.log(`  ${causal.rows[0].causal_explanation}`);
  }

  // Pattern distribution
  console.log('\n── 반응 패턴 분포 ──');
  const patterns = await client.query(`
    SELECT reaction_pattern, COUNT(*) as n, AVG(forward_return_pct::numeric) as avg_ret
    FROM event_impact_profiles WHERE theme = $1 AND symbol = $2 AND horizon = '2w' AND reaction_pattern IS NOT NULL
    GROUP BY reaction_pattern ORDER BY n DESC
  `, [theme, symbol]);
  for (const r of patterns.rows) {
    console.log(`  ${(r.reaction_pattern || '?').padEnd(16)} n=${String(r.n).padStart(5)} avg=${(Number(r.avg_ret) >= 0 ? '+' : '') + Number(r.avg_ret).toFixed(2)}%`);
  }

  // Representative events
  console.log('\n── 대표 이벤트 (큰 반응) ──');
  const examples = await client.query(`
    SELECT event_date, title, forward_return_pct, hit, reaction_pattern
    FROM event_impact_profiles WHERE theme = $1 AND symbol = $2 AND horizon = '2w'
    ORDER BY ABS(forward_return_pct) DESC LIMIT 5
  `, [theme, symbol]);
  for (const r of examples.rows) {
    console.log(`  ${r.event_date?.toISOString?.()?.slice(0, 10) || r.event_date} | ${(r.forward_return_pct >= 0 ? '+' : '')}${Number(r.forward_return_pct).toFixed(2)}% | ${r.reaction_pattern}`);
    console.log(`    ${r.title?.slice(0, 80)}`);
  }
}

async function queryCompare(client, sym1, sym2) {
  if (!sym1 || !sym2) { console.log('Usage: compare <SYM1> <SYM2>'); return; }
  sym1 = sym1.toUpperCase(); sym2 = sym2.toUpperCase();
  console.log(`\n═══ ${sym1} vs ${sym2} 이벤트 반응 비교 ═══\n`);

  const q = await client.query(`
    SELECT e1.theme,
           AVG(e1.forward_return_pct::numeric) AS ret1,
           AVG(e2.forward_return_pct::numeric) AS ret2,
           AVG(e1.hit::int::numeric) AS hit1,
           AVG(e2.hit::int::numeric) AS hit2,
           COUNT(*) AS n,
           CORR(e1.forward_return_pct::numeric, e2.forward_return_pct::numeric) AS correlation
    FROM event_impact_profiles e1
    JOIN event_impact_profiles e2 ON e1.article_id = e2.article_id AND e1.horizon = e2.horizon
    WHERE e1.symbol = $1 AND e2.symbol = $2 AND e1.horizon = '2w'
    GROUP BY e1.theme ORDER BY n DESC
  `, [sym1, sym2]);

  console.log('Theme'.padEnd(12), sym1.padEnd(15), sym2.padEnd(15), 'Corr'.padStart(6), 'N'.padStart(6));
  for (const r of q.rows) {
    console.log(
      r.theme.padEnd(12),
      `${(Number(r.ret1) >= 0 ? '+' : '')}${Number(r.ret1).toFixed(2)}% (${(Number(r.hit1) * 100).toFixed(0)}%)`.padEnd(15),
      `${(Number(r.ret2) >= 0 ? '+' : '')}${Number(r.ret2).toFixed(2)}% (${(Number(r.hit2) * 100).toFixed(0)}%)`.padEnd(15),
      Number(r.correlation).toFixed(3).padStart(6),
      String(r.n).padStart(6),
    );
  }
}

main().catch(e => { console.error(e); process.exit(1); });
