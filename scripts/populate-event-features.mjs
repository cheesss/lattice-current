#!/usr/bin/env node
/**
 * populate-event-features.mjs — 기존 60개 수식 출력을 event_features 테이블에 적재
 *
 * canonical_events의 각 이벤트에 대해:
 *   - signal_history에서 해당 날짜의 시그널 값 추출
 *   - GDELT 파생 (marketStress, transmissionStrength, eventIntensity)
 *   - 레짐 분류
 *   - 소스 품질 (source_count, source_diversity)
 *   - Hawkes intensity (gdelt_daily_agg 기반)
 *
 * 학습 모델의 입력 피처로 사용됩니다.
 *
 * Usage:
 *   node scripts/populate-event-features.mjs
 *   node scripts/populate-event-features.mjs --dry-run
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

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// VIX 기반 레짐 분류
function classifyRegime(vix, hySpread, hyMean, hyStd) {
  if (vix > 25 && hySpread != null && hyMean != null && hyStd != null && hySpread > hyMean + 1.5 * hyStd) return 'crisis';
  if (vix > 25) return 'risk-off';
  if (vix < 18 && hySpread != null && hyMean != null && hyStd != null && hySpread < hyMean - 0.5 * hyStd) return 'risk-on-strong';
  if (vix < 18) return 'risk-on';
  return 'balanced';
}

// 레짐 → 기본 리스크 게이지
function regimeBaseGauge(regime) {
  switch (regime) {
    case 'crisis': return 85;
    case 'risk-off': return 70;
    case 'balanced': return 45;
    case 'risk-on': return 25;
    case 'risk-on-strong': return 15;
    default: return 45;
  }
}

// Hawkes decay
function computeHawkesDecay(halfLifeDays = 7) {
  return Math.log(2) / halfLifeDays;
}

async function main() {
  const client = new pg.Client(PG_CONFIG);
  await client.connect();

  console.log(`populate-event-features — dry_run=${DRY_RUN}`);

  // ---------------------------------------------------------------------------
  // Step 1: 날짜별 시그널 스냅샷 구축
  // ---------------------------------------------------------------------------
  console.log('\n▶ Step 1: Building daily signal snapshots...');

  const signals = await client.query(`
    SELECT DATE(ts) as d, signal_name, value
    FROM signal_history
    WHERE signal_name IN ('vix','yieldSpread','dollarIndex','oilPrice',
      'hy_credit_spread','ig_credit_spread','treasury10y','fedFundsRate',
      'marketStress','transmissionStrength','eventIntensity','bdi','gpr')
    ORDER BY d
  `);

  const dailySignals = new Map();
  for (const row of signals.rows) {
    const d = row.d.toISOString().slice(0, 10);
    if (!dailySignals.has(d)) dailySignals.set(d, {});
    dailySignals.get(d)[row.signal_name] = Number(row.value);
  }
  console.log(`  ${dailySignals.size} daily snapshots`);

  // Rolling stats for z-scores (90-day window)
  const vixHistory = [];
  const vixStats = new Map();
  const sortedDates = Array.from(dailySignals.keys()).sort();
  for (const d of sortedDates) {
    const sig = dailySignals.get(d);
    if (sig.vix != null) {
      vixHistory.push(sig.vix);
      if (vixHistory.length > 90) vixHistory.shift();
    }
    const mean = vixHistory.reduce((a, b) => a + b, 0) / vixHistory.length;
    const std = Math.sqrt(vixHistory.reduce((a, b) => a + (b - mean) ** 2, 0) / vixHistory.length) || 1;
    vixStats.set(d, { mean, std });
  }

  // HY spread rolling stats for regime
  const hyHistory = [];
  const hyStats = new Map();
  for (const d of sortedDates) {
    const sig = dailySignals.get(d);
    if (sig.hy_credit_spread != null) {
      hyHistory.push(sig.hy_credit_spread);
      if (hyHistory.length > 90) hyHistory.shift();
    }
    const mean = hyHistory.reduce((a, b) => a + b, 0) / hyHistory.length;
    const std = Math.sqrt(hyHistory.reduce((a, b) => a + (b - mean) ** 2, 0) / hyHistory.length) || 1;
    hyStats.set(d, { mean, std });
  }

  // ---------------------------------------------------------------------------
  // Step 2: GDELT daily agg for Hawkes
  // ---------------------------------------------------------------------------
  console.log('\n▶ Step 2: Loading GDELT daily aggregation...');

  const gdelt = await client.query(`
    SELECT DATE(ts) as d, value as event_count
    FROM signal_history
    WHERE signal_name = 'eventIntensity'
    ORDER BY d
  `);
  const gdeltDaily = new Map();
  for (const row of gdelt.rows) {
    gdeltDaily.set(row.d.toISOString().slice(0, 10), Number(row.event_count));
  }

  // Hawkes intensity computation (exponential decay sum)
  const decay = computeHawkesDecay(7);
  const hawkesMap = new Map();
  let hawkesAccum = 0;
  let prevDate = null;
  for (const d of sortedDates) {
    const count = gdeltDaily.get(d) || 0;
    if (prevDate) {
      const daysDiff = (new Date(d) - new Date(prevDate)) / (24 * 60 * 60 * 1000);
      hawkesAccum = hawkesAccum * Math.exp(-decay * daysDiff) + count;
    } else {
      hawkesAccum = count;
    }
    hawkesMap.set(d, hawkesAccum);
    prevDate = d;
  }

  // Hawkes short/long for momentum
  const hawkesShort = new Map();
  const hawkesLong = new Map();
  const shortWindow = [];
  const longWindow = [];
  for (const d of sortedDates) {
    const h = hawkesMap.get(d) || 0;
    shortWindow.push(h);
    longWindow.push(h);
    if (shortWindow.length > 7) shortWindow.shift();
    if (longWindow.length > 30) longWindow.shift();
    hawkesShort.set(d, shortWindow.reduce((a, b) => a + b, 0) / shortWindow.length);
    hawkesLong.set(d, longWindow.reduce((a, b) => a + b, 0) / longWindow.length);
  }

  // ---------------------------------------------------------------------------
  // Step 3: canonical_events에 피처 적재
  // ---------------------------------------------------------------------------
  console.log('\n▶ Step 3: Populating event_features...');

  const events = await client.query(`
    SELECT ce.id, ce.event_date, ce.theme, ce.source_count, ce.source_diversity, ce.article_count
    FROM canonical_events ce
    LEFT JOIN event_features ef ON ef.canonical_event_id = ce.id
    WHERE ef.canonical_event_id IS NULL
    ORDER BY ce.event_date
  `);

  console.log(`  ${events.rows.length} events to process`);

  let inserted = 0;
  for (const event of events.rows) {
    const d = event.event_date.toISOString().slice(0, 10);
    const sig = dailySignals.get(d) || {};
    const vs = vixStats.get(d) || { mean: 20, std: 5 };
    const hs = hyStats.get(d) || { mean: 4, std: 1 };

    const vix = sig.vix ?? null;
    const vixZscore = vix != null ? clamp((vix - vs.mean) / vs.std, -4, 4) : null;

    // Short vs long VIX momentum
    const prevDates = sortedDates.filter(dd => dd < d).slice(-7);
    const prevVix = prevDates.map(dd => dailySignals.get(dd)?.vix).filter(v => v != null);
    const vixMomentum = prevVix.length > 0 && vix != null
      ? (vix - prevVix.reduce((a, b) => a + b, 0) / prevVix.length) / (vs.std || 1)
      : null;

    const regime = vix != null
      ? classifyRegime(vix, sig.hy_credit_spread, hs.mean, hs.std)
      : 'balanced';

    // Regime multiplier
    const regimeMultMap = { crisis: 2.0, 'risk-off': 1.5, balanced: 1.0, 'risk-on': 0.8, 'risk-on-strong': 0.6 };
    const regimeMultiplier = regimeMultMap[regime] || 1.0;

    // Risk gauge (simplified)
    const riskGauge = vix != null
      ? clamp(regimeBaseGauge(regime) + (vixZscore || 0) * 4.6, 4, 100)
      : null;

    // Hawkes
    const hawkes = hawkesMap.get(d) || null;
    const hShort = hawkesShort.get(d) || 0;
    const hLong = hawkesLong.get(d) || 1;
    const hawkesMomentum = hLong > 0 ? hShort / hLong : null;

    if (!DRY_RUN) {
      await client.query(`
        INSERT INTO event_features (
          canonical_event_id, source_count, source_diversity, article_count,
          hawkes_intensity, hawkes_momentum,
          hmm_regime, hmm_confidence,
          vix_value, vix_zscore, vix_momentum,
          yield_spread, oil_price, dollar_index, credit_spread_hy,
          market_stress, transmission_strength, event_intensity,
          regime_label, regime_multiplier, risk_gauge,
          graph_signal_score, nmi_score, narrative_alignment
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6,
          $7, $8,
          $9, $10, $11,
          $12, $13, $14, $15,
          $16, $17, $18,
          $19, $20, $21,
          $22, $23, $24
        ) ON CONFLICT (canonical_event_id) DO NOTHING
      `, [
        event.id, event.source_count, event.source_diversity, event.article_count,
        hawkes, hawkesMomentum,
        regime, null, // hmm_confidence needs full HMM run
        vix, vixZscore, vixMomentum,
        sig.yieldSpread ?? null, sig.oilPrice ?? null, sig.dollarIndex ?? null, sig.hy_credit_spread ?? null,
        sig.marketStress ?? null, sig.transmissionStrength ?? null, sig.eventIntensity ?? null,
        regime, regimeMultiplier, riskGauge,
        null, null, null, // graph/nmi/narrative need runtime computation
      ]);
    }

    inserted++;
    if (inserted % 5000 === 0) {
      console.log(`  ... ${inserted}/${events.rows.length} events`);
    }
  }

  console.log(`  Inserted ${inserted} event features`);

  // Summary stats
  if (!DRY_RUN) {
    const summary = await client.query(`
      SELECT regime_label, COUNT(*) as cnt,
             ROUND(AVG(vix_value)::numeric, 1) as avg_vix,
             ROUND(AVG(risk_gauge)::numeric, 1) as avg_risk
      FROM event_features
      WHERE regime_label IS NOT NULL
      GROUP BY regime_label
      ORDER BY avg_risk DESC
    `);
    console.log('\n=== Regime 분포 ===');
    summary.rows.forEach(r => console.log(`  ${r.regime_label}: ${r.cnt} events, avg VIX=${r.avg_vix}, risk=${r.avg_risk}`));
  }

  console.log('\n✅ populate-event-features complete');
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
