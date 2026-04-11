#!/usr/bin/env node
/**
 * fix-time-alignment.mjs — 기사 발행 시각 기반 entry_price 보정
 *
 * 문제:
 *   현재 entry_price는 기사 발행일의 종가(close)를 사용
 *   → 장후(16:00 ET 이후) 발행된 기사는 이미 가격에 반영된 정보를 포함
 *   → 라벨 누수(label leakage) 발생
 *
 * 보정:
 *   장전 (< 09:30 ET): entry = 당일 open
 *   장중 (09:30~16:00 ET): entry = 당일 close (현재와 동일)
 *   장후 (> 16:00 ET): entry = 다음 거래일 open
 *   주말/공휴일: entry = 다음 거래일 open
 *
 * 현재 Yahoo 데이터에 open 가격이 없으므로,
 * 이 스크립트는 먼저 시간대 분포를 분석하고,
 * labeled_outcomes에 market_session 컬럼을 추가합니다.
 *
 * Usage:
 *   node scripts/fix-time-alignment.mjs
 *   node scripts/fix-time-alignment.mjs --dry-run
 */

import pg from 'pg';

const PG_CONFIG = {
  host: process.env.PG_HOST || '192.168.0.76',
  port: Number(process.env.PG_PORT || 5433),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || process.env.PGPASSWORD || 'lattice1234',
  database: process.env.PG_DATABASE || 'lattice',
};

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const client = new pg.Client(PG_CONFIG);
  await client.connect();

  console.log(`fix-time-alignment — dry_run=${DRY_RUN}`);

  // ---------------------------------------------------------------------------
  // Step 1: market_session 컬럼 추가
  // ---------------------------------------------------------------------------
  await client.query(`
    ALTER TABLE articles ADD COLUMN IF NOT EXISTS market_session TEXT
  `);
  await client.query(`
    ALTER TABLE labeled_outcomes ADD COLUMN IF NOT EXISTS market_session TEXT
  `);
  await client.query(`
    ALTER TABLE labeled_outcomes ADD COLUMN IF NOT EXISTS aligned_entry_price DOUBLE PRECISION
  `);
  await client.query(`
    ALTER TABLE labeled_outcomes ADD COLUMN IF NOT EXISTS alignment_method TEXT
  `);
  console.log('Columns added');

  // ---------------------------------------------------------------------------
  // Step 2: 기사 발행 시각 분포 분석
  // ---------------------------------------------------------------------------
  console.log('\n▶ Step 2: 발행 시각 분포 분석...');

  // ET(미국 동부시간) 기준 시간대 분포
  // UTC-5 (EST) 또는 UTC-4 (EDT) — 간단히 UTC-5로 계산
  const hourDist = await client.query(`
    SELECT
      EXTRACT(HOUR FROM published_at AT TIME ZONE 'America/New_York') as et_hour,
      COUNT(*) as cnt
    FROM articles
    WHERE published_at IS NOT NULL
    GROUP BY et_hour
    ORDER BY et_hour
  `);

  console.log('ET Hour | Count');
  console.log('--------|------');
  let preMarket = 0, market = 0, afterMarket = 0;
  for (const r of hourDist.rows) {
    const h = Number(r.et_hour);
    const label = h < 9 || (h === 9) ? 'pre' : h < 16 ? 'market' : 'after';
    if (h < 9 || (h === 9)) preMarket += Number(r.cnt);
    else if (h < 16) market += Number(r.cnt);
    else afterMarket += Number(r.cnt);
    console.log(`  ${String(h).padStart(2, '0')}:00  | ${String(r.cnt).padStart(6)} | ${label}`);
  }

  const total = preMarket + market + afterMarket;
  console.log(`\nSummary:`);
  console.log(`  Pre-market  (<09:30 ET): ${preMarket} (${(preMarket/total*100).toFixed(1)}%)`);
  console.log(`  Market hours (09:30-16): ${market} (${(market/total*100).toFixed(1)}%)`);
  console.log(`  After-hours  (>16:00 ET): ${afterMarket} (${(afterMarket/total*100).toFixed(1)}%)`);

  // ---------------------------------------------------------------------------
  // Step 3: articles에 market_session 태그
  // ---------------------------------------------------------------------------
  console.log('\n▶ Step 3: Tagging market_session...');

  if (!DRY_RUN) {
    // 장전: 00:00~09:29 ET
    const pre = await client.query(`
      UPDATE articles SET market_session = 'pre_market'
      WHERE market_session IS NULL
        AND EXTRACT(HOUR FROM published_at AT TIME ZONE 'America/New_York') < 9
        OR (EXTRACT(HOUR FROM published_at AT TIME ZONE 'America/New_York') = 9
            AND EXTRACT(MINUTE FROM published_at AT TIME ZONE 'America/New_York') < 30)
    `);
    console.log(`  pre_market: ${pre.rowCount}`);

    // 장중: 09:30~15:59 ET
    const mkt = await client.query(`
      UPDATE articles SET market_session = 'market_hours'
      WHERE market_session IS NULL
        AND (EXTRACT(HOUR FROM published_at AT TIME ZONE 'America/New_York') > 9
             OR (EXTRACT(HOUR FROM published_at AT TIME ZONE 'America/New_York') = 9
                 AND EXTRACT(MINUTE FROM published_at AT TIME ZONE 'America/New_York') >= 30))
        AND EXTRACT(HOUR FROM published_at AT TIME ZONE 'America/New_York') < 16
    `);
    console.log(`  market_hours: ${mkt.rowCount}`);

    // 장후: 16:00~23:59 ET
    const after = await client.query(`
      UPDATE articles SET market_session = 'after_hours'
      WHERE market_session IS NULL
        AND EXTRACT(HOUR FROM published_at AT TIME ZONE 'America/New_York') >= 16
    `);
    console.log(`  after_hours: ${after.rowCount}`);

    // 주말 체크
    const weekend = await client.query(`
      UPDATE articles SET market_session = 'weekend'
      WHERE EXTRACT(DOW FROM published_at AT TIME ZONE 'America/New_York') IN (0, 6)
    `);
    console.log(`  weekend (override): ${weekend.rowCount}`);

    // labeled_outcomes에 전파
    await client.query(`
      UPDATE labeled_outcomes lo
      SET market_session = a.market_session
      FROM articles a
      WHERE lo.article_id = a.id
        AND lo.market_session IS NULL
    `);
    console.log('  Propagated to labeled_outcomes');
  }

  // ---------------------------------------------------------------------------
  // Step 4: 세션별 entry_price 편향 분석
  // ---------------------------------------------------------------------------
  console.log('\n▶ Step 4: 세션별 수익률 편향 분석...');

  const bias = await client.query(`
    SELECT
      lo.market_session,
      lo.horizon,
      COUNT(*) as cnt,
      ROUND(AVG(lo.forward_return_pct)::numeric, 3) as avg_return,
      ROUND(STDDEV(lo.forward_return_pct)::numeric, 3) as std_return,
      ROUND(AVG(CASE WHEN lo.forward_return_pct > 0 THEN 1.0 ELSE 0.0 END)::numeric, 3) as hit_rate
    FROM labeled_outcomes lo
    WHERE lo.market_session IS NOT NULL AND lo.symbol = 'SPY'
    GROUP BY lo.market_session, lo.horizon
    ORDER BY lo.market_session, lo.horizon
  `);

  console.log('\nSession       | Horizon | Count  | Avg Return | Std    | Hit Rate');
  console.log('--------------|---------|--------|------------|--------|--------');
  for (const r of bias.rows) {
    console.log(
      `${(r.market_session || '?').padEnd(13)} | ${r.horizon.padEnd(7)} | ${String(r.cnt).padStart(6)} | ${(r.avg_return + '%').padStart(10)} | ${(r.std_return + '%').padStart(6)} | ${(r.hit_rate * 100).toFixed(1)}%`
    );
  }

  console.log('\n✅ fix-time-alignment complete');
  console.log('Note: aligned_entry_price 보정은 Yahoo open price 데이터 확보 후 적용합니다.');
  console.log('현재는 market_session 태깅 + 편향 분석까지 완료.');

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
