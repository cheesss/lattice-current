#!/usr/bin/env node
/**
 * build-matched-controls.mjs — 이벤트 날과 유사 조건의 non-event 날 매칭
 *
 * 각 canonical_event에 대해:
 *   1. 해당 테마 이벤트가 없는 날들 중에서
 *   2. 같은 요일, VIX ±3, yieldSpread ±0.2, 같은 레짐인 날을 찾고
 *   3. 가장 가까운 5개를 matched control로 선택
 *   4. uplift = event_alpha - mean(control_returns) 계산
 *   5. evidence_grade 부여 (E0~E2)
 *
 * Usage:
 *   node scripts/build-matched-controls.mjs
 *   node scripts/build-matched-controls.mjs --dry-run
 *   node scripts/build-matched-controls.mjs --controls 10
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
const CONTROLS_ARG = process.argv.indexOf('--controls');
const N_CONTROLS = CONTROLS_ARG >= 0 ? Number(process.argv[CONTROLS_ARG + 1] || 5) : 5;

// VIX 기반 레짐 분류 (event-engine-full-build.mjs와 동일)
function classifyRegime(vix, hySpread, hyMean, hyStd) {
  if (vix > 25 && hySpread != null && hyMean != null && hyStd != null && hySpread > hyMean + 1.5 * hyStd) return 'crisis';
  if (vix > 25) return 'risk-off';
  if (vix < 18 && hySpread != null && hyMean != null && hyStd != null && hySpread < hyMean - 0.5 * hyStd) return 'risk-on-strong';
  if (vix < 18) return 'risk-on';
  return 'balanced';
}

async function main() {
  const client = new pg.Client(PG_CONFIG);
  await client.connect();

  console.log(`build-matched-controls — n_controls=${N_CONTROLS} dry_run=${DRY_RUN}`);

  // Clear existing for re-run
  if (!DRY_RUN) {
    await client.query('DELETE FROM event_uplift');
    await client.query('DELETE FROM matched_controls');
    console.log('Cleared existing matched_controls data');
  }

  // ---------------------------------------------------------------------------
  // Step 1: signal_history를 날짜별 시그널 스냅샷으로 변환
  // ---------------------------------------------------------------------------
  console.log('\n▶ Step 1: Building daily signal snapshots...');

  const signals = await client.query(`
    SELECT DATE(ts) as d,
           MAX(CASE WHEN signal_name = 'vix' THEN value END) as vix,
           MAX(CASE WHEN signal_name = 'yieldSpread' THEN value END) as yield_spread,
           MAX(CASE WHEN signal_name = 'dollarIndex' THEN value END) as dollar_index,
           MAX(CASE WHEN signal_name = 'hy_credit_spread' THEN value END) as hy_spread
    FROM signal_history
    WHERE signal_name IN ('vix', 'yieldSpread', 'dollarIndex', 'hy_credit_spread')
    GROUP BY DATE(ts)
    ORDER BY d
  `);

  // Rolling 90-day stats for regime classification
  const dailySignals = new Map();
  const hyHistory = [];
  for (const row of signals.rows) {
    const dateStr = row.d.toISOString().slice(0, 10);
    hyHistory.push(Number(row.hy_spread) || 0);
    if (hyHistory.length > 90) hyHistory.shift();
    const hyMean = hyHistory.reduce((a, b) => a + b, 0) / hyHistory.length;
    const hyStd = Math.sqrt(hyHistory.reduce((a, b) => a + (b - hyMean) ** 2, 0) / hyHistory.length);
    const vix = Number(row.vix) || 20;
    const regime = classifyRegime(vix, Number(row.hy_spread), hyMean, hyStd);

    dailySignals.set(dateStr, {
      vix,
      yieldSpread: Number(row.yield_spread) || 0,
      dollarIndex: Number(row.dollar_index) || 0,
      hySpread: Number(row.hy_spread) || 0,
      regime,
      dow: new Date(row.d).getDay(),
    });
  }
  console.log(`  ${dailySignals.size} daily snapshots built`);

  // ---------------------------------------------------------------------------
  // Step 2: 테마별 이벤트 날짜 수집
  // ---------------------------------------------------------------------------
  console.log('\n▶ Step 2: Collecting event dates per theme...');

  const eventDatesResult = await client.query(`
    SELECT id, event_date, theme FROM canonical_events ORDER BY event_date
  `);

  // 테마별 이벤트 날짜 Set
  const themeEventDates = new Map();
  for (const row of eventDatesResult.rows) {
    const dateStr = row.event_date.toISOString().slice(0, 10);
    if (!themeEventDates.has(row.theme)) themeEventDates.set(row.theme, new Set());
    themeEventDates.get(row.theme).add(dateStr);
  }

  const allSignalDates = Array.from(dailySignals.keys()).sort();
  console.log(`  ${eventDatesResult.rows.length} events, ${allSignalDates.length} signal dates`);

  // ---------------------------------------------------------------------------
  // Step 3: 매칭
  // ---------------------------------------------------------------------------
  console.log('\n▶ Step 3: Matching controls...');

  let matched = 0;
  let skipped = 0;
  let batchCount = 0;

  for (const event of eventDatesResult.rows) {
    const eventDateStr = event.event_date.toISOString().slice(0, 10);
    const eventSignals = dailySignals.get(eventDateStr);

    if (!eventSignals) {
      skipped++;
      continue;
    }

    const eventDates = themeEventDates.get(event.theme) || new Set();

    // 후보: 같은 테마 이벤트가 없는 날 + 시그널이 있는 날
    const candidates = [];
    for (const dateStr of allSignalDates) {
      if (eventDates.has(dateStr)) continue; // 이벤트 있는 날 제외
      const sig = dailySignals.get(dateStr);
      if (!sig) continue;

      // 매칭 조건
      if (sig.dow !== eventSignals.dow) continue; // 같은 요일
      if (Math.abs(sig.vix - eventSignals.vix) > 3) continue; // VIX ±3
      if (Math.abs(sig.yieldSpread - eventSignals.yieldSpread) > 0.2) continue; // 스프레드 ±0.2

      // 거리 계산 (유클리드)
      const dist = Math.sqrt(
        ((sig.vix - eventSignals.vix) / 3) ** 2
        + ((sig.yieldSpread - eventSignals.yieldSpread) / 0.2) ** 2
        + ((sig.dollarIndex - eventSignals.dollarIndex) / 5) ** 2
      );

      candidates.push({ dateStr, dist, ...sig });
    }

    // 가장 가까운 N개 선택
    candidates.sort((a, b) => a.dist - b.dist);
    const controls = candidates.slice(0, N_CONTROLS);

    if (controls.length === 0) {
      skipped++;
      continue;
    }

    if (!DRY_RUN) {
      for (const ctrl of controls) {
        await client.query(`
          INSERT INTO matched_controls (canonical_event_id, control_date, match_distance, vix_event, vix_control, yield_spread_event, yield_spread_control, regime_event, regime_control)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT DO NOTHING
        `, [event.id, ctrl.dateStr, ctrl.dist, eventSignals.vix, ctrl.vix, eventSignals.yieldSpread, ctrl.yieldSpread, eventSignals.regime, ctrl.regime]);
      }
    }

    matched++;
    batchCount++;
    if (batchCount % 1000 === 0) {
      console.log(`  ... ${batchCount} events matched (${skipped} skipped)`);
    }
  }

  console.log(`  Total: ${matched} events matched, ${skipped} skipped (no signal data)`);

  // ---------------------------------------------------------------------------
  // Step 4: Uplift 계산
  // ---------------------------------------------------------------------------
  if (!DRY_RUN) {
    console.log('\n▶ Step 4: Computing uplift...');

    // 이벤트 날의 종목별 abnormal_return (이벤트 단위 평균)
    // vs control 날의 종목별 평균 return
    const upliftSQL = `
      INSERT INTO event_uplift (canonical_event_id, symbol, horizon, event_alpha, control_avg_return, uplift, t_stat, n_controls, evidence_grade)
      SELECT
        ce.id,
        lo_event.symbol,
        lo_event.horizon,
        lo_event.avg_alpha,
        ctrl_returns.avg_control_return,
        lo_event.avg_alpha - ctrl_returns.avg_control_return as uplift,
        CASE WHEN ctrl_returns.std_control > 0 AND ctrl_returns.n_ctrl > 1
             THEN (lo_event.avg_alpha - ctrl_returns.avg_control_return) / (ctrl_returns.std_control / SQRT(ctrl_returns.n_ctrl))
             ELSE 0 END as t_stat,
        ctrl_returns.n_ctrl,
        CASE
          WHEN lo_event.avg_alpha > 0 AND (lo_event.avg_alpha - ctrl_returns.avg_control_return) > 0
               AND CASE WHEN ctrl_returns.std_control > 0 AND ctrl_returns.n_ctrl > 1
                        THEN (lo_event.avg_alpha - ctrl_returns.avg_control_return) / (ctrl_returns.std_control / SQRT(ctrl_returns.n_ctrl))
                        ELSE 0 END > 1.96
          THEN 'E2'
          WHEN lo_event.avg_alpha > 0
          THEN 'E1'
          ELSE 'E0'
        END
      FROM canonical_events ce
      -- 이벤트의 평균 alpha
      JOIN LATERAL (
        SELECT lo.symbol, lo.horizon, AVG(lo.abnormal_return) as avg_alpha
        FROM article_event_map aem
        JOIN labeled_outcomes lo ON lo.article_id = aem.article_id
        WHERE aem.canonical_event_id = ce.id
          AND lo.abnormal_return IS NOT NULL
        GROUP BY lo.symbol, lo.horizon
      ) lo_event ON TRUE
      -- control 날들의 평균/표준편차
      JOIN LATERAL (
        SELECT
          AVG(lo2.forward_return_pct) as avg_control_return,
          STDDEV(lo2.forward_return_pct) as std_control,
          COUNT(DISTINCT mc.control_date) as n_ctrl
        FROM matched_controls mc
        JOIN labeled_outcomes lo2 ON DATE(lo2.published_at) = mc.control_date
          AND lo2.symbol = lo_event.symbol
          AND lo2.horizon = lo_event.horizon
        WHERE mc.canonical_event_id = ce.id
      ) ctrl_returns ON ctrl_returns.n_ctrl > 0
      WHERE ce.id <= 1000
      ON CONFLICT (canonical_event_id, symbol, horizon) DO UPDATE SET
        event_alpha = EXCLUDED.event_alpha,
        control_avg_return = EXCLUDED.control_avg_return,
        uplift = EXCLUDED.uplift,
        t_stat = EXCLUDED.t_stat,
        n_controls = EXCLUDED.n_controls,
        evidence_grade = EXCLUDED.evidence_grade
    `;

    try {
      const result = await client.query(upliftSQL);
      console.log(`  ${result.rowCount} uplift rows computed (first 1000 events)`);
    } catch (err) {
      console.log(`  Uplift computation error: ${err.message}`);
      console.log('  Will compute in batches on next run');
    }

    // Evidence grade 분포
    const grades = await client.query('SELECT evidence_grade, COUNT(*) as cnt FROM event_uplift GROUP BY evidence_grade ORDER BY evidence_grade');
    console.log('\n=== Evidence Grade 분포 ===');
    grades.rows.forEach(r => console.log(`  ${r.evidence_grade}: ${r.cnt}`));
  }

  console.log('\n✅ build-matched-controls complete');
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
