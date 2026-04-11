#!/usr/bin/env node
/**
 * compute-abnormal-returns.mjs — labeled_outcomes에 초과수익률 계산
 *
 * 각 labeled_outcome 행에 대해:
 *   market_return  = 같은 기사, 같은 horizon의 SPY forward_return_pct
 *   sector_return  = 같은 기사, 같은 horizon의 섹터 ETF forward_return_pct
 *   abnormal_return = forward_return_pct - market_return
 *
 * 이렇게 하면 "NVDA +21%"가 "시장 +15%, alpha +6%"로 분해됩니다.
 *
 * Usage:
 *   node scripts/compute-abnormal-returns.mjs
 *   node scripts/compute-abnormal-returns.mjs --dry-run
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

// ---------------------------------------------------------------------------
// 종목 → 섹터 ETF 매핑
// ---------------------------------------------------------------------------
const SECTOR_ETF_MAP = {
  // 반도체/기술
  NVDA: 'SMH', AMD: 'SMH', SMH: null,
  QQQ: null,   // QQQ 자체가 벤치마크
  CIBR: null,  // 사이버보안 ETF
  // 에너지
  COP: 'XLE', CVX: 'XLE', USO: 'XLE', XLE: null,
  UNG: 'XLE',
  // 방산
  ITA: null,   // 방산 ETF 자체
  // 원자재
  GLD: 'DBC', DBC: null,
  // 채권
  TLT: null,   // 채권은 별도 자산군
  // 시장 전체
  SPY: null,   // 시장 벤치마크 자체
  EFA: null,
  UUP: null,
  XRT: 'SPY',
};

async function main() {
  const client = new pg.Client(PG_CONFIG);
  await client.connect();

  console.log(`compute-abnormal-returns — dry_run=${DRY_RUN}`);

  // ---------------------------------------------------------------------------
  // Step 1: Market-adjusted returns (SPY 기준)
  // ---------------------------------------------------------------------------
  console.log('\n▶ Step 1: Market-adjusted returns (vs SPY)...');

  // SPY의 (article_id, horizon) → forward_return_pct 를 lookup 테이블로 사용
  const marketUpdateSQL = `
    UPDATE labeled_outcomes lo
    SET market_return = spy.forward_return_pct,
        abnormal_return = lo.forward_return_pct - spy.forward_return_pct
    FROM labeled_outcomes spy
    WHERE spy.symbol = 'SPY'
      AND spy.article_id = lo.article_id
      AND spy.horizon = lo.horizon
      AND lo.symbol != 'SPY'
      AND lo.market_return IS NULL
  `;

  if (DRY_RUN) {
    // Count how many would be updated
    const preview = await client.query(`
      SELECT COUNT(*) as cnt
      FROM labeled_outcomes lo
      JOIN labeled_outcomes spy ON spy.symbol = 'SPY'
        AND spy.article_id = lo.article_id
        AND spy.horizon = lo.horizon
      WHERE lo.symbol != 'SPY' AND lo.market_return IS NULL
    `);
    console.log(`  [DRY RUN] Would update ${preview.rows[0].cnt} rows`);
  } else {
    const result = await client.query(marketUpdateSQL);
    console.log(`  Updated ${result.rowCount} rows with market_return`);
  }

  // ---------------------------------------------------------------------------
  // Step 2: Sector-adjusted returns
  // ---------------------------------------------------------------------------
  console.log('\n▶ Step 2: Sector-adjusted returns...');

  const symbols = Object.entries(SECTOR_ETF_MAP).filter(([, etf]) => etf !== null);
  let sectorUpdated = 0;

  for (const [symbol, sectorEtf] of symbols) {
    const sql = `
      UPDATE labeled_outcomes lo
      SET sector_return = sector.forward_return_pct
      FROM labeled_outcomes sector
      WHERE sector.symbol = $1
        AND sector.article_id = lo.article_id
        AND sector.horizon = lo.horizon
        AND lo.symbol = $2
        AND lo.sector_return IS NULL
    `;

    if (!DRY_RUN) {
      const result = await client.query(sql, [sectorEtf, symbol]);
      sectorUpdated += result.rowCount;
    }
  }
  console.log(`  Updated ${sectorUpdated} rows with sector_return`);

  // ---------------------------------------------------------------------------
  // Step 3: SPY 자체의 abnormal_return = 0 (시장 벤치마크이므로)
  // ---------------------------------------------------------------------------
  if (!DRY_RUN) {
    await client.query(`
      UPDATE labeled_outcomes
      SET market_return = forward_return_pct,
          abnormal_return = 0
      WHERE symbol = 'SPY' AND market_return IS NULL
    `);
  }

  // ---------------------------------------------------------------------------
  // Step 4: 결과 확인
  // ---------------------------------------------------------------------------
  console.log('\n▶ 결과 확인...');

  const stats = await client.query(`
    SELECT symbol,
           COUNT(*) as total,
           COUNT(abnormal_return) as with_alpha,
           ROUND(AVG(forward_return_pct)::numeric, 3) as avg_raw_return,
           ROUND(AVG(abnormal_return)::numeric, 3) as avg_alpha,
           ROUND(AVG(CASE WHEN abnormal_return > 0 THEN 1.0 ELSE 0.0 END)::numeric, 3) as alpha_hit_rate
    FROM labeled_outcomes
    WHERE abnormal_return IS NOT NULL
    GROUP BY symbol
    ORDER BY avg_alpha DESC
  `);

  console.log('\n=== Raw Return vs Alpha 비교 ===');
  console.log('Symbol     | Raw Return | Alpha    | Alpha Hit Rate');
  console.log('-----------|------------|----------|---------------');
  for (const r of stats.rows) {
    console.log(
      `${r.symbol.padEnd(10)} | ${(r.avg_raw_return + '%').padStart(10)} | ${(r.avg_alpha + '%').padStart(8)} | ${(r.alpha_hit_rate * 100).toFixed(1)}%`
    );
  }

  // 기존 sensitivity_matrix와 비교
  const comparison = await client.query(`
    SELECT lo.symbol,
           ROUND(AVG(lo.forward_return_pct)::numeric, 3) as raw_avg,
           ROUND(AVG(lo.abnormal_return)::numeric, 3) as alpha_avg,
           ROUND(AVG(CASE WHEN lo.forward_return_pct > 0 THEN 1.0 ELSE 0.0 END)::numeric, 3) as raw_hit,
           ROUND(AVG(CASE WHEN lo.abnormal_return > 0 THEN 1.0 ELSE 0.0 END)::numeric, 3) as alpha_hit
    FROM labeled_outcomes lo
    WHERE lo.abnormal_return IS NOT NULL AND lo.horizon = '2w'
    GROUP BY lo.symbol
    ORDER BY ABS(AVG(lo.abnormal_return)) DESC
    LIMIT 10
  `);

  console.log('\n=== 2주 기준 Raw vs Alpha (상위 10) ===');
  console.log('Symbol     | Raw Avg  | Alpha Avg | Raw Hit | Alpha Hit');
  console.log('-----------|----------|-----------|---------|----------');
  for (const r of comparison.rows) {
    console.log(
      `${r.symbol.padEnd(10)} | ${(r.raw_avg + '%').padStart(8)} | ${(r.alpha_avg + '%').padStart(9)} | ${(r.raw_hit * 100).toFixed(1).padStart(6)}% | ${(r.alpha_hit * 100).toFixed(1).padStart(6)}%`
    );
  }

  console.log('\n✅ compute-abnormal-returns complete');
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
