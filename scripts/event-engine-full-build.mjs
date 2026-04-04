#!/usr/bin/env node
/**
 * event-engine-full-build.mjs — 이벤트 분석 엔진 완전체 구축
 *
 * 1. HMM Regime 분리: 시장 상태별 종목 반응
 * 2. Hawkes 이슈 온도: 이벤트 연쇄 강도
 * 3. What-if 시뮬레이션: 진입했으면 얼마 벌었나
 *
 * Usage: node --import tsx scripts/event-engine-full-build.mjs
 */

import pg from 'pg';
import { writeFileSync } from 'fs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

async function main() {
  const client = new Client(PG_CONFIG);
  await client.connect();

  console.log('═══ Event Analysis Engine — Full Build ═══\n');

  // ═══ 1. HMM Regime 분리 ═══
  console.log('▶ 1. HMM Regime 분리 — 시장 상태별 종목 반응...');

  await client.query(`
    CREATE TABLE IF NOT EXISTS regime_conditional_impact (
      id SERIAL PRIMARY KEY,
      theme TEXT,
      symbol TEXT,
      horizon TEXT,
      regime TEXT,
      avg_return DOUBLE PRECISION,
      hit_rate DOUBLE PRECISION,
      avg_abs_return DOUBLE PRECISION,
      sample_size INTEGER,
      regime_multiplier DOUBLE PRECISION DEFAULT 1.0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(theme, symbol, horizon, regime)
    )
  `);

  // Use Yahoo VIX + yield spread to classify regime
  // VIX > 25 = risk-off, VIX < 18 = risk-on, else balanced
  // Join with labeled_outcomes via date
  await client.query(`
    INSERT INTO regime_conditional_impact (theme, symbol, horizon, regime, avg_return, hit_rate, avg_abs_return, sample_size, regime_multiplier)
    SELECT
      lo.theme, lo.symbol, lo.horizon,
      CASE
        WHEN vix.price > 25 THEN 'risk-off'
        WHEN vix.price < 18 THEN 'risk-on'
        ELSE 'balanced'
      END AS regime,
      AVG(lo.forward_return_pct::numeric) AS avg_return,
      AVG(lo.hit::int::numeric) AS hit_rate,
      AVG(ABS(lo.forward_return_pct)::numeric) AS avg_abs_return,
      COUNT(*) AS sample_size,
      -- regime_multiplier: how much bigger is the reaction in this regime vs overall
      CASE WHEN overall.avg_abs > 0.01
        THEN AVG(ABS(lo.forward_return_pct)::numeric) / overall.avg_abs
        ELSE 1.0
      END AS regime_multiplier
    FROM labeled_outcomes lo
    JOIN articles a ON lo.article_id = a.id
    LEFT JOIN worldmonitor_intel.historical_raw_items vix
      ON vix.provider = 'fred' AND vix.symbol = 'VIXCLS'
      AND DATE(vix.valid_time_start) = DATE(a.published_at)
    CROSS JOIN LATERAL (
      SELECT AVG(ABS(lo2.forward_return_pct)::numeric) AS avg_abs
      FROM labeled_outcomes lo2
      WHERE lo2.theme = lo.theme AND lo2.symbol = lo.symbol AND lo2.horizon = lo.horizon
    ) overall
    WHERE vix.price IS NOT NULL AND lo.horizon = '2w'
    GROUP BY lo.theme, lo.symbol, lo.horizon,
      CASE WHEN vix.price > 25 THEN 'risk-off' WHEN vix.price < 18 THEN 'risk-on' ELSE 'balanced' END,
      overall.avg_abs
    HAVING COUNT(*) >= 30
    ON CONFLICT (theme, symbol, horizon, regime) DO UPDATE SET
      avg_return=EXCLUDED.avg_return, hit_rate=EXCLUDED.hit_rate,
      avg_abs_return=EXCLUDED.avg_abs_return, sample_size=EXCLUDED.sample_size,
      regime_multiplier=EXCLUDED.regime_multiplier, updated_at=NOW()
  `);

  const regimeCount = await client.query('SELECT COUNT(*) FROM regime_conditional_impact');
  console.log(`  ${regimeCount.rows[0].count} regime-conditional records 생성`);

  // Show regime differences
  const regimeDiff = await client.query(`
    SELECT theme, symbol, regime, avg_return, hit_rate, avg_abs_return, sample_size, regime_multiplier
    FROM regime_conditional_impact
    WHERE horizon = '2w'
    ORDER BY theme, symbol, regime
  `);

  console.log('\n  Theme      Symbol Regime      AvgRet%  Hit%  |Move|%  Mult   N');
  let lastPair = '';
  for (const r of regimeDiff.rows) {
    const pair = `${r.theme}:${r.symbol}`;
    if (pair !== lastPair) { console.log('  ─────────────────────────────────────────────────────────'); lastPair = pair; }
    console.log(
      `  ${r.theme.padEnd(10)} ${r.symbol.padEnd(5)}  ${r.regime.padEnd(10)} ` +
      `${(Number(r.avg_return) >= 0 ? '+' : '') + Number(r.avg_return).toFixed(2).padStart(6)}%  ` +
      `${(Number(r.hit_rate) * 100).toFixed(0).padStart(3)}%  ` +
      `${Number(r.avg_abs_return).toFixed(2).padStart(6)}%  ` +
      `${Number(r.regime_multiplier).toFixed(2).padStart(5)}  ${String(r.sample_size).padStart(5)}`
    );
  }

  // ═══ 2. Hawkes 이슈 온도 ═══
  console.log('\n\n▶ 2. Hawkes 이슈 온도 — 이벤트 연쇄 강도...');

  await client.query(`
    CREATE TABLE IF NOT EXISTS event_hawkes_intensity (
      id SERIAL PRIMARY KEY,
      theme TEXT,
      event_date DATE,
      article_count INTEGER,
      hawkes_intensity DOUBLE PRECISION,
      normalized_temperature DOUBLE PRECISION,
      is_surge BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(theme, event_date)
    )
  `);

  // Compute daily article counts per theme, then calculate Hawkes-like intensity
  // Intensity = exponential moving sum of past events (half-life 7 days)
  const themes = ['conflict', 'tech', 'energy', 'economy', 'politics'];
  for (const theme of themes) {
    const daily = await client.query(`
      SELECT DATE(a.published_at) AS event_date, COUNT(*) AS n
      FROM articles a
      JOIN labeled_outcomes lo ON lo.article_id = a.id AND lo.horizon = '2w'
      WHERE lo.theme = $1
      GROUP BY DATE(a.published_at)
      ORDER BY event_date
    `, [theme]);

    if (daily.rows.length < 10) continue;

    // Compute Hawkes-like intensity (exponential decay sum)
    const halfLifeDays = 7;
    const decay = 0.693 / halfLifeDays;
    const records = [];
    let intensity = 0;
    const counts = daily.rows.map(r => ({ date: r.event_date, n: Number(r.n) }));

    // Compute baseline stats for normalization
    const allCounts = counts.map(c => c.n);
    const mean = allCounts.reduce((a, b) => a + b, 0) / allCounts.length;
    const std = Math.sqrt(allCounts.reduce((s, x) => s + (x - mean) ** 2, 0) / allCounts.length);

    for (let i = 0; i < counts.length; i++) {
      // Decay previous intensity
      if (i > 0) {
        const daysBetween = (new Date(counts[i].date).getTime() - new Date(counts[i - 1].date).getTime()) / (86400000);
        intensity *= Math.exp(-decay * daysBetween);
      }
      intensity += counts[i].n;

      const normalized = std > 0 ? Math.min(1, Math.max(0, (intensity - mean * 3) / (std * 10))) : 0;
      const isSurge = counts[i].n > mean + 2 * std;

      records.push({
        theme,
        date: counts[i].date,
        n: counts[i].n,
        intensity: Number(intensity.toFixed(2)),
        normalized: Number(normalized.toFixed(3)),
        isSurge,
      });
    }

    // Batch insert
    for (let i = 0; i < records.length; i += 200) {
      const batch = records.slice(i, i + 200);
      const values = [];
      const placeholders = [];
      let idx = 1;
      for (const r of batch) {
        placeholders.push(`($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5})`);
        values.push(r.theme, r.date, r.n, r.intensity, r.normalized, r.isSurge);
        idx += 6;
      }
      await client.query(`
        INSERT INTO event_hawkes_intensity (theme, event_date, article_count, hawkes_intensity, normalized_temperature, is_surge)
        VALUES ${placeholders.join(',')}
        ON CONFLICT (theme, event_date) DO UPDATE SET
          article_count=EXCLUDED.article_count, hawkes_intensity=EXCLUDED.hawkes_intensity,
          normalized_temperature=EXCLUDED.normalized_temperature, is_surge=EXCLUDED.is_surge, updated_at=NOW()
      `, values);
    }

    const surges = records.filter(r => r.isSurge).length;
    console.log(`  ${theme.padEnd(10)} ${records.length} days, ${surges} surges, max intensity=${Math.max(...records.map(r => r.intensity)).toFixed(0)}`);
  }

  // Show how intensity correlates with reaction magnitude
  console.log('\n  이슈 온도별 종목 반응 차이:');
  const hawkesImpact = await client.query(`
    SELECT h.theme,
      CASE WHEN h.normalized_temperature > 0.7 THEN 'HOT'
           WHEN h.normalized_temperature > 0.3 THEN 'WARM'
           ELSE 'COOL' END AS temperature,
      AVG(ABS(lo.forward_return_pct)::numeric) AS avg_abs_return,
      AVG(lo.hit::int::numeric) AS hit_rate,
      COUNT(*) AS n
    FROM event_hawkes_intensity h
    JOIN articles a ON DATE(a.published_at) = h.event_date
    JOIN labeled_outcomes lo ON lo.article_id = a.id AND lo.theme = h.theme AND lo.horizon = '2w'
    GROUP BY h.theme,
      CASE WHEN h.normalized_temperature > 0.7 THEN 'HOT'
           WHEN h.normalized_temperature > 0.3 THEN 'WARM'
           ELSE 'COOL' END
    ORDER BY h.theme, temperature
  `);
  for (const r of hawkesImpact.rows) {
    console.log(`  ${r.theme.padEnd(10)} ${r.temperature.padEnd(5)} |move|=${Number(r.avg_abs_return).toFixed(2)}% hit=${(Number(r.hit_rate) * 100).toFixed(0)}% n=${r.n}`);
  }

  // ═══ 3. What-if 시뮬레이션 ═══
  console.log('\n\n▶ 3. What-if 시뮬레이션 테이블 생성...');

  await client.query(`
    CREATE TABLE IF NOT EXISTS whatif_simulations (
      id SERIAL PRIMARY KEY,
      theme TEXT,
      symbol TEXT,
      direction TEXT DEFAULT 'long',
      position_pct DOUBLE PRECISION DEFAULT 10.0,
      horizon TEXT DEFAULT '2w',
      regime TEXT DEFAULT 'all',
      simulated_trades INTEGER,
      avg_pnl_pct DOUBLE PRECISION,
      hit_rate DOUBLE PRECISION,
      max_drawdown_pct DOUBLE PRECISION,
      sharpe_ratio DOUBLE PRECISION,
      var_95_pct DOUBLE PRECISION,
      total_return_pct DOUBLE PRECISION,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(theme, symbol, direction, horizon, regime)
    )
  `);

  // Simulate for each theme-symbol pair
  const pairs = await client.query(`
    SELECT DISTINCT theme, symbol FROM labeled_outcomes WHERE horizon = '2w'
  `);

  for (const pair of pairs.rows) {
    const returns = await client.query(`
      SELECT lo.forward_return_pct
      FROM labeled_outcomes lo
      WHERE lo.theme = $1 AND lo.symbol = $2 AND lo.horizon = '2w'
      ORDER BY lo.published_at
    `, [pair.theme, pair.symbol]);

    const rets = returns.rows.map(r => Number(r.forward_return_pct));
    if (rets.length < 20) continue;

    for (const direction of ['long', 'short']) {
      const positionPct = 10;
      const directedReturns = direction === 'long' ? rets : rets.map(r => -r);
      const pnls = directedReturns.map(r => r * positionPct / 100);

      const avgPnl = pnls.reduce((a, b) => a + b, 0) / pnls.length;
      const hitRate = pnls.filter(p => p > 0).length / pnls.length;

      // Max drawdown
      let peak = 0, equity = 0, maxDD = 0;
      for (const pnl of pnls) {
        equity += pnl;
        if (equity > peak) peak = equity;
        const dd = peak - equity;
        if (dd > maxDD) maxDD = dd;
      }

      // Sharpe
      const mean = avgPnl;
      const std = Math.sqrt(pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / pnls.length);
      const sharpe = std > 0.001 ? (mean / std) * Math.sqrt(52) : 0; // annualized (2w periods)

      // VaR 95%
      const sorted = [...pnls].sort((a, b) => a - b);
      const var95 = sorted[Math.floor(sorted.length * 0.05)] || 0;

      const totalReturn = pnls.reduce((a, b) => a + b, 0);

      await client.query(`
        INSERT INTO whatif_simulations (theme, symbol, direction, position_pct, horizon, regime, simulated_trades, avg_pnl_pct, hit_rate, max_drawdown_pct, sharpe_ratio, var_95_pct, total_return_pct)
        VALUES ($1, $2, $3, $4, '2w', 'all', $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (theme, symbol, direction, horizon, regime) DO UPDATE SET
          simulated_trades=EXCLUDED.simulated_trades, avg_pnl_pct=EXCLUDED.avg_pnl_pct,
          hit_rate=EXCLUDED.hit_rate, max_drawdown_pct=EXCLUDED.max_drawdown_pct,
          sharpe_ratio=EXCLUDED.sharpe_ratio, var_95_pct=EXCLUDED.var_95_pct,
          total_return_pct=EXCLUDED.total_return_pct, updated_at=NOW()
      `, [pair.theme, pair.symbol, direction, positionPct, rets.length, avgPnl, hitRate, -maxDD, sharpe, var95, totalReturn]);
    }
  }

  const simCount = await client.query('SELECT COUNT(*) FROM whatif_simulations');
  console.log(`  ${simCount.rows[0].count} what-if simulations 생성`);

  // Show best strategies
  console.log('\n  Best What-if Strategies (Sharpe > 0):');
  const bestSims = await client.query(`
    SELECT theme, symbol, direction, simulated_trades, avg_pnl_pct, hit_rate, sharpe_ratio, var_95_pct, total_return_pct
    FROM whatif_simulations WHERE horizon = '2w' AND regime = 'all'
    ORDER BY sharpe_ratio DESC LIMIT 15
  `);
  console.log('  Theme      Symbol Dir    Trades  AvgPnL%  Hit%  Sharpe  VaR95%   TotalRet%');
  for (const r of bestSims.rows) {
    console.log(
      `  ${r.theme.padEnd(10)} ${r.symbol.padEnd(5)}  ${r.direction.padEnd(5)} ` +
      `${String(r.simulated_trades).padStart(6)} ` +
      `${(Number(r.avg_pnl_pct) >= 0 ? '+' : '') + Number(r.avg_pnl_pct).toFixed(3).padStart(7)}% ` +
      `${(Number(r.hit_rate) * 100).toFixed(0).padStart(4)}% ` +
      `${Number(r.sharpe_ratio).toFixed(2).padStart(6)} ` +
      `${Number(r.var_95_pct).toFixed(2).padStart(7)}% ` +
      `${Number(r.total_return_pct).toFixed(1).padStart(8)}%`
    );
  }

  console.log('\n✅ Full build 완료');
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
