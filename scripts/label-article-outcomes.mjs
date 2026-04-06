#!/usr/bin/env node
/**
 * label-article-outcomes.mjs
 * 기사 → 관련 심볼의 forward return 레이블링
 *
 * 사용법:
 *   node scripts/label-article-outcomes.mjs
 *   node scripts/label-article-outcomes.mjs --limit 1000
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
const { Client } = pg;

loadOptionalEnvFile();

const PG_CONFIG = resolveNasPgConfig();

// 테마 → 대표 심볼/ETF 매핑
// 각 테마에 대해 가장 직접적으로 반응하는 ETF를 매핑
const THEME_SYMBOLS = {
  conflict: ['ITA', 'XLE', 'GLD', 'USO', 'TLT'],  // 방산, 에너지, 금, 유가, 국채
  economy:  ['SPY', 'TLT', 'DBC', 'UUP', 'XRT'],   // S&P, 국채, 원자재, 달러, 소매
  energy:   ['XLE', 'USO', 'COP', 'CVX', 'UNG'],   // 에너지 섹터, 유가, 석유사, 천연가스
  tech:     ['QQQ', 'SMH', 'NVDA', 'AMD', 'CIBR'],  // 나스닥, 반도체, AI, 사이버보안
  politics: ['SPY', 'GLD', 'TLT', 'EFA', 'UUP'],   // S&P, 금, 국채, 선진국, 달러
};

const HORIZONS = [
  { name: '1w', days: 7 },
  { name: '2w', days: 14 },
  { name: '1m', days: 30 },
];

// Binary search: find first index where time >= target
function bisect(arr, targetTime) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].time < targetTime) lo = mid + 1;
    else hi = mid;
  }
  return lo < arr.length ? lo : -1;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { limit: 0 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) result.limit = parseInt(args[++i]);
  }
  return result;
}

async function main() {
  const { limit } = parseArgs();
  const client = new Client(PG_CONFIG);
  await client.connect();

  // Create labeled_outcomes table
  await client.query(`
    CREATE TABLE IF NOT EXISTS labeled_outcomes (
      id SERIAL PRIMARY KEY,
      article_id INTEGER REFERENCES articles(id),
      theme TEXT,
      symbol TEXT,
      published_at TIMESTAMPTZ,
      horizon TEXT,
      entry_price DOUBLE PRECISION,
      exit_price DOUBLE PRECISION,
      forward_return_pct DOUBLE PRECISION,
      hit BOOLEAN,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(article_id, symbol, horizon)
    )
  `);

  // Load all Yahoo prices into memory for fast lookup (grouped by symbol)
  console.log('Yahoo 가격 데이터 로딩...');
  const priceRows = await client.query(`
    SELECT symbol, valid_time_start, price
    FROM raw_items
    WHERE provider='yahoo-chart' AND price IS NOT NULL AND symbol IS NOT NULL
    ORDER BY symbol, valid_time_start
  `);

  const prices = {};
  for (const r of priceRows.rows) {
    if (!prices[r.symbol]) prices[r.symbol] = [];
    prices[r.symbol].push({ time: new Date(r.valid_time_start).getTime(), price: r.price });
  }
  console.log(`  ${Object.keys(prices).length}개 심볼, ${priceRows.rows.length}건 가격 로딩 완료`);

  // Get articles not yet labeled
  const limitClause = limit > 0 ? `LIMIT ${limit}` : '';
  const articles = await client.query(`
    SELECT a.id, a.theme, a.published_at
    FROM articles a
    WHERE a.published_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM labeled_outcomes lo WHERE lo.article_id = a.id)
    ORDER BY a.published_at
    ${limitClause}
  `);
  console.log(`레이블링 대상: ${articles.rows.length}건`);

  let labeled = 0;
  let skipped = 0;

  for (let i = 0; i < articles.rows.length; i++) {
    const art = articles.rows[i];
    const symbols = THEME_SYMBOLS[art.theme];
    if (!symbols) { skipped++; continue; }

    const pubTime = new Date(art.published_at).getTime();
    const values = [];
    const placeholders = [];
    let paramIdx = 1;

    for (const sym of symbols) {
      const symPrices = prices[sym];
      if (!symPrices) continue;

      // Find entry price: closest price at or after published_at
      const entryIdx = bisect(symPrices, pubTime);
      if (entryIdx < 0) continue;
      const entryPrice = symPrices[entryIdx].price;

      for (const h of HORIZONS) {
        const targetTime = pubTime + h.days * 86400000;
        // Find exit price: closest price at or after target time
        const exitIdx = bisect(symPrices, targetTime);
        if (exitIdx < 0 || exitIdx <= entryIdx) continue; // must be a different, later data point
        const exitPrice = symPrices[exitIdx].price;
        const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
        const hit = returnPct > 0; // positive return = hit

        placeholders.push(`($${paramIdx},$${paramIdx+1},$${paramIdx+2},$${paramIdx+3},$${paramIdx+4},$${paramIdx+5},$${paramIdx+6},$${paramIdx+7})`);
        values.push(art.id, art.theme, sym, art.published_at, h.name, entryPrice, exitPrice, returnPct);
        paramIdx += 8;
      }
    }

    if (values.length > 0) {
      await client.query(`
        INSERT INTO labeled_outcomes (article_id, theme, symbol, published_at, horizon, entry_price, exit_price, forward_return_pct)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (article_id, symbol, horizon) DO NOTHING
      `, values);
      labeled++;
    } else {
      skipped++;
    }

    if ((i + 1) % 1000 === 0 || i === articles.rows.length - 1) {
      const pct = Math.floor(((i + 1) / articles.rows.length) * 100);
      process.stderr.write(`\r  ${i + 1}/${articles.rows.length} (${pct}%) labeled=${labeled} skipped=${skipped}`);
    }
  }

  // Update hit column based on theme-specific logic
  // For conflict: GLD/ITA up = hit (defense/gold benefit from conflict)
  // For energy: XLE/USO up = hit
  // General: positive return = hit
  await client.query(`UPDATE labeled_outcomes SET hit = (forward_return_pct > 0) WHERE hit IS NULL`);

  const total = await client.query('SELECT COUNT(*) FROM labeled_outcomes');
  const hitRate = await client.query('SELECT horizon, AVG(forward_return_pct) as avg_ret, AVG(hit::int) as hit_rate FROM labeled_outcomes GROUP BY horizon ORDER BY horizon');

  console.log(`\n\n완료: labeled_outcomes ${total.rows[0].count}건`);
  console.log('=== 호라이즌별 통계 ===');
  hitRate.rows.forEach(r => console.log(`  ${r.horizon}: avg_return=${Number(r.avg_ret).toFixed(2)}% hit_rate=${(Number(r.hit_rate)*100).toFixed(1)}%`));

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
