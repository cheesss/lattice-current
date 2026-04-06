#!/usr/bin/env node
/**
 * master-pipeline.mjs — 전체 엔진을 하나로 연결하는 마스터 파이프라인
 *
 * 세 조각 (시계열 인프라 + 분석 엔진 + Codex/Executor)을 한 흐름으로 연결.
 * 데이터 갭을 메우고, 피처를 맞추고, 자동으로 순환.
 *
 * Steps:
 *   0. 데이터 갭 메우기 (signal_history 누락분 + 테이블 생성)
 *   1. signal_history 적재 (GDELT → marketStress/transmissionStrength)
 *   2. auto-pipeline (기사 분류 → 종목 매핑 → outcome 생성 → 분석 갱신)
 *   3. 분석 테이블 갱신 (regime, hawkes, whatif, anomaly)
 *   4. Codex 에이전트 → 제안 생성
 *   5. Executor → 제안 실행 + 검증
 *   6. 결과 리포트
 *
 * Usage:
 *   node --import tsx scripts/master-pipeline.mjs              # 전체 실행
 *   node --import tsx scripts/master-pipeline.mjs --step 0     # 데이터 갭만
 *   node --import tsx scripts/master-pipeline.mjs --no-codex   # Codex 없이
 *   node --import tsx scripts/master-pipeline.mjs --auto       # 무한 반복 (5분 간격)
 */

import pg from 'pg';
import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

const REQUESTED_STEPS = process.argv.reduce((steps, arg, index, argv) => {
  if (arg === '--step' && argv[index + 1]) {
    const step = Number(argv[index + 1]);
    if (Number.isFinite(step)) steps.add(step);
  }
  return steps;
}, new Set());
const NO_CODEX = process.argv.includes('--no-codex');
const AUTO_MODE = process.argv.includes('--auto');
const AUTO_INTERVAL_MS = 5 * 60 * 1000; // 5분

function shouldRunStep(step) {
  return REQUESTED_STEPS.size === 0 || REQUESTED_STEPS.has(step);
}
function run(cmd, timeout = 120000) {
  console.log(`  $ ${cmd.slice(0, 80)}...`);
  try {
    execSync(cmd, { stdio: 'pipe', timeout, env: { ...process.env }, cwd: process.cwd() });
    return true;
  } catch (e) {
    console.log(`  ⚠ 실패 (non-fatal): ${e.message?.slice(0, 80)}`);
    return false;
  }
}

async function runPipeline() {
  const client = new Client(PG_CONFIG);
  await client.connect();
  const startTime = Date.now();
  const results = { steps: [], timestamp: new Date().toISOString() };

  console.log('═══════════════════════════════════════════════════');
  console.log('  MASTER PIPELINE — 전체 엔진 통합 실행');
  console.log('═══════════════════════════════════════════════════\n');

  // ═══ STEP 0: 데이터 갭 메우기 ═══
  if (shouldRunStep(0)) {
    console.log('▶ STEP 0: 데이터 갭 메우기...');

    // 0-1. signal_history에 marketStress 적재 (GDELT goldstein → stress)
    await client.query(`
      CREATE TABLE IF NOT EXISTS signal_history (
        signal_name TEXT NOT NULL,
        ts TIMESTAMPTZ NOT NULL,
        value DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (signal_name, ts)
      )
    `);

    // GDELT goldstein → marketStress: 높은 갈등(-goldstein) = 높은 stress
    const gdeltStress = await client.query(`
      INSERT INTO signal_history (signal_name, ts, value)
      SELECT 'marketStress',
             date::timestamptz,
             LEAST(1.0, GREATEST(0.0, (-AVG(avg_goldstein) + 5) / 10.0))
      FROM gdelt_daily_agg
      WHERE cameo_root IN ('14','17','18','19','20') AND country = 'US'
      GROUP BY date
      ON CONFLICT (signal_name, ts) DO NOTHING
    `);
    console.log(`  marketStress: ${gdeltStress.rowCount} rows from GDELT goldstein`);

    // GDELT tone → transmissionStrength: 극단적 tone = 높은 transmission
    const gdeltTx = await client.query(`
      INSERT INTO signal_history (signal_name, ts, value)
      SELECT 'transmissionStrength',
             date::timestamptz,
             LEAST(1.0, GREATEST(0.0, ABS(AVG(avg_tone)) / 10.0))
      FROM gdelt_daily_agg
      WHERE cameo_root IN ('14','17','18','19','20') AND country = 'US'
      GROUP BY date
      ON CONFLICT (signal_name, ts) DO NOTHING
    `);
    console.log(`  transmissionStrength: ${gdeltTx.rowCount} rows from GDELT tone`);

    // GDELT event count → hawkes proxy (normalized event intensity)
    const gdeltHawkes = await client.query(`
      INSERT INTO signal_history (signal_name, ts, value)
      SELECT 'eventIntensity',
             date::timestamptz,
             LEAST(1.0, GREATEST(0.0, LN(1 + SUM(event_count)) / 10.0))
      FROM gdelt_daily_agg
      WHERE cameo_root IN ('14','17','18','19','20') AND country = 'US'
      GROUP BY date
      ON CONFLICT (signal_name, ts) DO NOTHING
    `);
    console.log(`  eventIntensity: ${gdeltHawkes.rowCount} rows`);

    // GPR proxy from GDELT keywords (if macro_gpr doesn't exist)
    await client.query(`
      CREATE TABLE IF NOT EXISTS macro_gpr (
        date DATE PRIMARY KEY,
        gpr_index DOUBLE PRECISION,
        source TEXT DEFAULT 'gdelt-proxy'
      )
    `);
    const gprProxy = await client.query(`
      INSERT INTO macro_gpr (date, gpr_index)
      SELECT DATE(a.published_at),
             COUNT(*)::float / GREATEST(1, total.n) * 100
      FROM articles a
      CROSS JOIN (SELECT COUNT(*)::float / 365 AS n FROM articles) total
      WHERE a.title ILIKE ANY(ARRAY['%war%','%military%','%nuclear%','%threat%','%troops%','%attack%','%missile%','%conflict%','%invasion%','%sanctions%'])
      GROUP BY DATE(a.published_at), total.n
      ON CONFLICT (date) DO NOTHING
    `);
    console.log(`  macro_gpr proxy: ${gprProxy.rowCount} rows from article keywords`);

    // GPR → signal_history
    await client.query(`
      INSERT INTO signal_history (signal_name, ts, value)
      SELECT 'gpr', date::timestamptz, LEAST(1.0, gpr_index / 50.0)
      FROM macro_gpr
      ON CONFLICT (signal_name, ts) DO NOTHING
    `);

    // Verify
    const shCount = await client.query('SELECT signal_name, COUNT(*) n FROM signal_history GROUP BY signal_name ORDER BY signal_name');
    console.log('  signal_history 현황:');
    for (const r of shCount.rows) console.log(`    ${r.signal_name.padEnd(25)} ${r.n} rows`);

    results.steps.push({ step: 0, status: 'ok', detail: 'data gaps filled' });
    console.log('');
  }

  // ═══ STEP 1: 분석 테이블에 시계열 데이터 통합 ═══
  if (shouldRunStep(1)) {
    console.log('▶ STEP 1: 분석 테이블에 시계열 통합...');

    // conditional_sensitivity에 시계열 기반 조건 추가
    // VIX momentum (signal_history vix 1d vs 7d)
    try {
      await client.query(`
        INSERT INTO conditional_sensitivity (theme, symbol, horizon, condition_type, condition_value, avg_return, hit_rate, avg_abs_return, sample_size)
        SELECT lo.theme, lo.symbol, lo.horizon,
          'vix_momentum',
          CASE WHEN sh_recent.value > sh_week.value * 1.1 THEN 'vix_rising'
               WHEN sh_recent.value < sh_week.value * 0.9 THEN 'vix_falling'
               ELSE 'vix_stable' END,
          AVG(lo.forward_return_pct::numeric),
          AVG(lo.hit::int::numeric),
          AVG(ABS(lo.forward_return_pct)::numeric),
          COUNT(*)::int
        FROM labeled_outcomes lo
        JOIN articles a ON lo.article_id = a.id
        LEFT JOIN signal_history sh_recent ON sh_recent.signal_name='vix' AND DATE(sh_recent.ts) = DATE(a.published_at)
        LEFT JOIN signal_history sh_week ON sh_week.signal_name='vix' AND DATE(sh_week.ts) = DATE(a.published_at) - 7
        WHERE lo.horizon = '2w' AND sh_recent.value IS NOT NULL AND sh_week.value IS NOT NULL
        GROUP BY lo.theme, lo.symbol, lo.horizon,
          CASE WHEN sh_recent.value > sh_week.value * 1.1 THEN 'vix_rising'
               WHEN sh_recent.value < sh_week.value * 0.9 THEN 'vix_falling'
               ELSE 'vix_stable' END
        HAVING COUNT(*) >= 30
        ON CONFLICT (theme, symbol, horizon, condition_type, condition_value) DO UPDATE SET
          avg_return=EXCLUDED.avg_return, hit_rate=EXCLUDED.hit_rate,
          avg_abs_return=EXCLUDED.avg_abs_return, sample_size=EXCLUDED.sample_size, updated_at=NOW()
      `);
      const vixCount = await client.query("SELECT COUNT(*) FROM conditional_sensitivity WHERE condition_type='vix_momentum'");
      console.log(`  vix_momentum 조건: ${vixCount.rows[0].count} rows`);
    } catch (e) { console.log(`  vix_momentum: skipped (${e.message.slice(0, 50)})`); }

    // Stress level condition
    try {
      await client.query(`
        INSERT INTO conditional_sensitivity (theme, symbol, horizon, condition_type, condition_value, avg_return, hit_rate, avg_abs_return, sample_size)
        SELECT lo.theme, lo.symbol, lo.horizon,
          'stress_level',
          CASE WHEN sh.value > 0.7 THEN 'high_stress'
               WHEN sh.value > 0.3 THEN 'medium_stress'
               ELSE 'low_stress' END,
          AVG(lo.forward_return_pct::numeric),
          AVG(lo.hit::int::numeric),
          AVG(ABS(lo.forward_return_pct)::numeric),
          COUNT(*)::int
        FROM labeled_outcomes lo
        JOIN articles a ON lo.article_id = a.id
        LEFT JOIN signal_history sh ON sh.signal_name='marketStress' AND DATE(sh.ts) = DATE(a.published_at)
        WHERE lo.horizon = '2w' AND sh.value IS NOT NULL
        GROUP BY lo.theme, lo.symbol, lo.horizon,
          CASE WHEN sh.value > 0.7 THEN 'high_stress'
               WHEN sh.value > 0.3 THEN 'medium_stress'
               ELSE 'low_stress' END
        HAVING COUNT(*) >= 30
        ON CONFLICT (theme, symbol, horizon, condition_type, condition_value) DO UPDATE SET
          avg_return=EXCLUDED.avg_return, hit_rate=EXCLUDED.hit_rate,
          avg_abs_return=EXCLUDED.avg_abs_return, sample_size=EXCLUDED.sample_size, updated_at=NOW()
      `);
      const stressCount = await client.query("SELECT COUNT(*) FROM conditional_sensitivity WHERE condition_type='stress_level'");
      console.log(`  stress_level 조건: ${stressCount.rows[0].count} rows`);
    } catch (e) { console.log(`  stress_level: skipped (${e.message.slice(0, 50)})`); }

    results.steps.push({ step: 1, status: 'ok' });
    console.log('');
  }

  // ═══ STEP 2: auto-pipeline (기사분류 → 종목매핑 → outcome → 분석갱신) ═══
  if (shouldRunStep(2)) {
    console.log('▶ STEP 2: auto-pipeline 실행...');
    run('node --import tsx scripts/auto-pipeline.mjs --limit 1000', 300000);
    results.steps.push({ step: 2, status: 'ok' });
    console.log('');
  }

  // ═══ STEP 3: 분석 테이블 전체 갱신 (regime, hawkes, whatif) ═══
  if (shouldRunStep(3)) {
    console.log('▶ STEP 3: 분석 테이블 갱신...');
    run('node --import tsx scripts/event-engine-full-build.mjs', 300000);
    run('node --import tsx scripts/event-analysis-ml-upgrade.mjs build', 300000);
    results.steps.push({ step: 3, status: 'ok' });
    console.log('');
  }

  // ═══ STEP 4: Codex 에이전트 → 패턴 발견 + 제안 ═══
  if (shouldRunStep(4) && !NO_CODEX) {
    console.log('▶ STEP 4: Codex 에이전트 실행...');
    // Codex에 시계열 + 분석 결과 함께 전달
    run('node --import tsx scripts/codex-from-analysis.mjs', 300000);
    results.steps.push({ step: 4, status: 'ok' });
    console.log('');
  }

  // ═══ STEP 5: Executor → 제안 실행 + 검증 ═══
  if (shouldRunStep(5)) {
    console.log('▶ STEP 5: Executor 실행...');
    run('node --import tsx scripts/proposal-executor.mjs', 300000);
    results.steps.push({ step: 5, status: 'ok' });
    console.log('');
  }

  // ═══ STEP 6: 리포트 ═══
  if (shouldRunStep(6)) {
    console.log('▶ STEP 6: 최종 리포트...');

    const stats = {};
    try { stats.articles = (await client.query('SELECT COUNT(*) n FROM articles')).rows[0].n; } catch { stats.articles = '?'; }
    try { stats.outcomes = (await client.query('SELECT COUNT(*) n FROM labeled_outcomes')).rows[0].n; } catch { stats.outcomes = '?'; }
    try { stats.signals = (await client.query('SELECT signal_name, COUNT(*) n FROM signal_history GROUP BY signal_name')).rows; } catch { stats.signals = []; }
    try { stats.sensitivity = (await client.query('SELECT COUNT(*) n FROM stock_sensitivity_matrix')).rows[0].n; } catch { stats.sensitivity = '?'; }
    try { stats.conditions = (await client.query('SELECT condition_type, COUNT(*) n FROM conditional_sensitivity GROUP BY condition_type ORDER BY n DESC')).rows; } catch { stats.conditions = []; }
    try { stats.proposals = (await client.query("SELECT status, COUNT(*) n FROM codex_proposals GROUP BY status")).rows; } catch { stats.proposals = []; }
    try { stats.autoSymbols = (await client.query('SELECT COUNT(*) n FROM auto_theme_symbols')).rows[0].n; } catch { stats.autoSymbols = '?'; }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

    console.log('═══════════════════════════════════════════════════');
    console.log('  PIPELINE COMPLETE');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  소요: ${elapsed}초`);
    console.log(`  기사: ${stats.articles}건`);
    console.log(`  outcomes: ${stats.outcomes}건`);
    console.log(`  signal_history:`);
    for (const s of stats.signals) console.log(`    ${s.signal_name.padEnd(25)} ${s.n} rows`);
    console.log(`  sensitivity matrix: ${stats.sensitivity}건`);
    console.log(`  conditional_sensitivity:`);
    for (const c of stats.conditions) console.log(`    ${c.condition_type.padEnd(25)} ${c.n} rows`);
    console.log(`  auto-mapped symbols: ${stats.autoSymbols}건`);
    console.log(`  proposals:`);
    for (const p of stats.proposals) console.log(`    ${p.status.padEnd(12)} ${p.n}건`);

    results.steps.push({ step: 6, status: 'ok', stats });
    results.elapsedSeconds = elapsed;

    writeFileSync('data/pipeline-report.json', JSON.stringify(results, null, 2));
    console.log(`\n  리포트: data/pipeline-report.json`);
  }

  await client.end();
}

async function main() {
  if (AUTO_MODE) {
    console.log(`AUTO MODE: ${AUTO_INTERVAL_MS / 1000}초 간격으로 무한 반복\n`);
    while (true) {
      try {
        await runPipeline();
      } catch (e) {
        console.error('Pipeline error:', e.message);
      }
      console.log(`\n다음 실행: ${new Date(Date.now() + AUTO_INTERVAL_MS).toLocaleTimeString()}\n`);
      await new Promise(r => setTimeout(r, AUTO_INTERVAL_MS));
    }
  } else {
    await runPipeline();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
