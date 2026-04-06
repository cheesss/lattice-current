#!/usr/bin/env node
/**
 * validate-gpr-proxy.mjs — GPR 프록시 상관관계 검증
 *
 * RSS/GDELT 키워드 빈도 기반 자체 GPR 프록시와 공식 GPR 지수 간
 * Pearson 상관계수를 계산. r >= 0.7이면 라이브에서 사용 가능.
 *
 * Usage:
 *   node --import tsx scripts/validate-gpr-proxy.mjs
 *   node --import tsx scripts/validate-gpr-proxy.mjs --from 2021-01-01 --to 2024-12-31
 */

import pg from 'pg';
import { writeFileSync } from 'fs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

const GPR_KEYWORDS = [
  'war', 'military', 'nuclear', 'threat', 'army', 'troops',
  'conflict', 'invasion', 'missile', 'sanctions', 'terrorism',
  'attack', 'bomb', 'weapon', 'airstrike', 'escalation',
  'hostility', 'coup', 'insurgent', 'militia',
];
const GPR_REGEX = new RegExp(`\\b(${GPR_KEYWORDS.join('|')})\\b`, 'i');

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { from: '2021-01-01', to: '2024-12-31' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from') result.from = args[++i];
    if (args[i] === '--to') result.to = args[++i];
  }
  return result;
}

function pearson(x, y) {
  const n = x.length;
  if (n < 3) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i]; sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return den > 0 ? num / den : 0;
}

async function main() {
  const args = parseArgs();
  const client = new Client(PG_CONFIG);

  try {
    await client.connect();
    console.log('[GPR-Proxy Validation]');
    console.log(`  Period: ${args.from} ~ ${args.to}\n`);

    // 1. Load official GPR (monthly aggregated to match proxy granularity)
    const gprRows = await client.query(`
      SELECT date::text, gpr_index
      FROM macro_gpr
      WHERE date >= $1::date AND date <= $2::date AND gpr_index IS NOT NULL
      ORDER BY date
    `, [args.from, args.to]);

    if (gprRows.rows.length === 0) {
      console.error('  No GPR data found. Run import-gpr-epu.mjs first.');
      console.log('\n  Result: SKIPPED (no GPR data)');
      writeFileSync('data/gpr-proxy-validation.json', JSON.stringify({ status: 'skipped', reason: 'no_gpr_data' }, null, 2));
      return;
    }

    console.log(`  Official GPR: ${gprRows.rows.length} data points loaded`);

    // 2. Compute proxy: for each GPR date, count keyword matches in articles within ±3 days
    const proxyValues = [];
    const officialValues = [];
    let matchedDates = 0;

    for (const gpr of gprRows.rows) {
      const articleCount = await client.query(`
        SELECT title FROM articles
        WHERE published_at >= ($1::date - INTERVAL '3 days')
          AND published_at < ($1::date + INTERVAL '3 days')
      `, [gpr.date]);

      if (articleCount.rows.length < 5) continue; // need minimum articles

      let gprMatches = 0;
      for (const a of articleCount.rows) {
        if (GPR_REGEX.test(a.title)) gprMatches++;
      }

      const ratio = gprMatches / articleCount.rows.length;
      proxyValues.push(ratio);
      officialValues.push(Number(gpr.gpr_index));
      matchedDates++;
    }

    if (matchedDates < 10) {
      console.error(`  Only ${matchedDates} matched dates. Need at least 10.`);
      writeFileSync('data/gpr-proxy-validation.json', JSON.stringify({ status: 'insufficient_data', matchedDates }, null, 2));
      return;
    }

    // 3. Compute Pearson correlation
    const r = pearson(proxyValues, officialValues);
    const pass = Math.abs(r) >= 0.7;

    console.log(`  Matched dates: ${matchedDates}`);
    console.log(`  Proxy mean ratio: ${(proxyValues.reduce((a, b) => a + b, 0) / proxyValues.length).toFixed(4)}`);
    console.log(`  GPR mean: ${(officialValues.reduce((a, b) => a + b, 0) / officialValues.length).toFixed(2)}`);
    console.log(`\n  Pearson r = ${r.toFixed(4)}`);
    console.log(`  Verdict: ${pass ? 'PASS — proxy is usable for live inference' : 'FAIL — proxy too divergent, use GPR only for historical'}`);

    const result = {
      status: pass ? 'pass' : 'fail',
      pearsonR: Number(r.toFixed(4)),
      matchedDates,
      proxyMeanRatio: Number((proxyValues.reduce((a, b) => a + b, 0) / proxyValues.length).toFixed(4)),
      gprMean: Number((officialValues.reduce((a, b) => a + b, 0) / officialValues.length).toFixed(2)),
      period: `${args.from} ~ ${args.to}`,
      threshold: 0.7,
    };

    writeFileSync('data/gpr-proxy-validation.json', JSON.stringify(result, null, 2));
    console.log('\n  Saved to data/gpr-proxy-validation.json');

  } finally {
    await client.end();
  }
}

main().catch(err => { console.error('[GPR-Proxy] Fatal:', err); process.exit(1); });
