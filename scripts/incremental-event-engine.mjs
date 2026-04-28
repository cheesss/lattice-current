#!/usr/bin/env node
/**
 * incremental-event-engine.mjs — 증분 이벤트 결정 엔진
 *
 * 기존 데이터를 절대 삭제하지 않고, 새로운 것만 추가/병합합니다.
 *
 * 5단계:
 *   1. 새 기사 → canonical_events 증분 클러스터링 (기존 이벤트에 병합 가능)
 *   2. 새 labeled_outcomes → abnormal_return 증분 계산
 *   3. 새 기사 → market_session 태그 + aligned_entry_price 보정
 *   4. 새 이벤트 → event_features 증분 적재
 *   5. 새 이벤트 → matched_controls + uplift 증분 매칭
 *
 * 안전성:
 *   - DELETE 문 없음
 *   - ON CONFLICT DO NOTHING 또는 DO UPDATE
 *   - 이미 처리된 기사/이벤트는 자동 건너뜀
 *
 * Usage:
 *   node scripts/incremental-event-engine.mjs
 *   node scripts/incremental-event-engine.mjs --dry-run
 *   node scripts/incremental-event-engine.mjs --since 2026-04-10
 */

import pg from 'pg';
import { withLock } from './_shared/pipeline-lock.mjs';

const PG_CONFIG = {
  host: process.env.PG_HOST || '192.168.0.2',
  port: Number(process.env.PG_PORT || 5433),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || process.env.PGPASSWORD || process.env.INTEL_PG_PASSWORD || process.env.NAS_PG_PASSWORD || (() => { throw new Error('Missing PostgreSQL password. Set PG_PASSWORD, PGPASSWORD, INTEL_PG_PASSWORD, or NAS_PG_PASSWORD.'); })(),
  database: process.env.PG_DATABASE || 'lattice',
  max: 4,
};

const DRY_RUN = process.argv.includes('--dry-run');
const SINCE_ARG = process.argv.indexOf('--since');
const SINCE_DATE = SINCE_ARG >= 0 ? process.argv[SINCE_ARG + 1] : null;
const SIMILARITY_THRESHOLD = 0.7;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ---------------------------------------------------------------------------
// Embedding utilities
// ---------------------------------------------------------------------------
function parseVector(str) {
  if (!str) return null;
  if (typeof str === 'string') return str.replace(/^\[/, '').replace(/\]$/, '').split(',').map(Number);
  return Array.isArray(str) ? str.map(Number) : null;
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; nA += a[i] * a[i]; nB += b[i] * b[i]; }
  const d = Math.sqrt(nA) * Math.sqrt(nB);
  return d > 0 ? dot / d : 0;
}

function averageEmbedding(embeddings) {
  if (!embeddings.length) return null;
  const dim = embeddings[0].length;
  const avg = new Float32Array(dim);
  for (const e of embeddings) for (let i = 0; i < dim; i++) avg[i] += e[i];
  for (let i = 0; i < dim; i++) avg[i] /= embeddings.length;
  return Array.from(avg);
}

// VIX 기반 레짐
function classifyRegime(vix, hySpread, hyMean, hyStd) {
  if (vix > 25 && hySpread != null && hyMean != null && hyStd != null && hySpread > hyMean + 1.5 * hyStd) return 'crisis';
  if (vix > 25) return 'risk-off';
  if (vix < 18 && hySpread != null && hyMean != null && hyStd != null && hySpread < hyMean - 0.5 * hyStd) return 'risk-on-strong';
  if (vix < 18) return 'risk-on';
  return 'balanced';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const pool = new pg.Pool(PG_CONFIG);
  const t0 = performance.now();

  console.log(`incremental-event-engine — dry_run=${DRY_RUN} since=${SINCE_DATE || 'auto'}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: 새 기사 → canonical_events 증분 클러스터링
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n▶ STEP 1: 증분 이벤트 클러스터링...');

  // 아직 매핑되지 않은 기사 찾기
  const unmapped = await pool.query(`
    SELECT a.id, a.title, a.source, a.theme, DATE(a.published_at) as event_date,
           a.embedding::text as embedding
    FROM articles a
    LEFT JOIN article_event_map aem ON aem.article_id = a.id
    WHERE aem.article_id IS NULL
      AND a.theme IS NOT NULL AND a.theme != 'unknown'
      ${SINCE_DATE ? `AND a.published_at >= '${SINCE_DATE}'::date` : ''}
    ORDER BY a.published_at
  `);

  console.log(`  ${unmapped.rows.length} unmapped articles found`);

  if (unmapped.rows.length > 0 && !DRY_RUN) {
    // 날짜+테마별로 그룹
    const groups = new Map();
    for (const row of unmapped.rows) {
      const key = `${row.event_date.toISOString().slice(0, 10)}::${row.theme}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    let newEvents = 0, mergedInto = 0, newMappings = 0;

    for (const [key, articles] of groups) {
      const [dateStr, theme] = key.split('::');

      // 같은 날+테마의 기존 이벤트가 있는지 확인
      const existing = await pool.query(`
        SELECT id, representative_title, avg_embedding::text as avg_embedding,
               article_count, source_count
        FROM canonical_events
        WHERE event_date = $1 AND theme = $2
      `, [dateStr, theme]);

      for (const article of articles) {
        const articleEmb = parseVector(article.embedding);
        let merged = false;

        // 기존 이벤트와 유사도 비교 → 병합 가능한지 확인
        if (articleEmb && existing.rows.length > 0) {
          for (const evt of existing.rows) {
            const evtEmb = parseVector(evt.avg_embedding);
            if (evtEmb && cosineSimilarity(articleEmb, evtEmb) >= SIMILARITY_THRESHOLD) {
              // 기존 이벤트에 병합
              await pool.query(
                'INSERT INTO article_event_map (article_id, canonical_event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [article.id, evt.id]
              );
              // article_count, source_count 업데이트
              await pool.query(`
                UPDATE canonical_events SET
                  article_count = article_count + 1,
                  source_count = (
                    SELECT COUNT(DISTINCT a.source)
                    FROM article_event_map aem
                    JOIN articles a ON a.id = aem.article_id
                    WHERE aem.canonical_event_id = $1
                  )
                WHERE id = $1
              `, [evt.id]);
              merged = true;
              mergedInto++;
              newMappings++;
              break;
            }
          }
        }

        if (!merged) {
          // 새 이벤트 생성
          const ins = await pool.query(`
            INSERT INTO canonical_events (event_date, theme, representative_title, source_count, source_diversity, article_count, avg_embedding)
            VALUES ($1, $2, $3, 1, 1.0, 1, $4)
            RETURNING id
          `, [dateStr, theme, article.title, articleEmb ? `[${articleEmb.join(',')}]` : null]);

          await pool.query(
            'INSERT INTO article_event_map (article_id, canonical_event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [article.id, ins.rows[0].id]
          );

          // 다음 기사가 이 이벤트에 병합될 수 있도록 existing에 추가
          existing.rows.push({
            id: ins.rows[0].id,
            representative_title: article.title,
            avg_embedding: articleEmb ? `[${articleEmb.join(',')}]` : null,
            article_count: 1,
            source_count: 1,
          });
          newEvents++;
          newMappings++;
        }
      }
    }

    // labeled_outcomes에 canonical_event_id 연결
    const linked = await pool.query(`
      UPDATE labeled_outcomes lo
      SET canonical_event_id = aem.canonical_event_id
      FROM article_event_map aem
      WHERE lo.article_id = aem.article_id AND lo.canonical_event_id IS NULL
    `);

    console.log(`  ${newEvents} new events, ${mergedInto} merged into existing, ${newMappings} mappings`);
    console.log(`  ${linked.rowCount} labeled_outcomes linked`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: 새 labeled_outcomes → abnormal_return 증분 계산
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n▶ STEP 2: 증분 abnormal_return 계산...');

  if (!DRY_RUN) {
    // Method 1: article_id-based join (original, high precision)
    const marketAdj = await pool.query(`
      UPDATE labeled_outcomes lo
      SET market_return = spy.forward_return_pct,
          abnormal_return = lo.forward_return_pct - spy.forward_return_pct
      FROM labeled_outcomes spy
      WHERE spy.symbol = 'SPY'
        AND spy.article_id = lo.article_id
        AND spy.horizon = lo.horizon
        AND lo.symbol != 'SPY'
        AND lo.abnormal_return IS NULL
    `);
    console.log(`  ${marketAdj.rowCount} rows updated (article-based SPY join)`);

    // Method 2: date-based join from market_returns table (broader coverage)
    // NOTE: PostgreSQL UPDATE ... FROM cannot correlate the target alias (lo) inside
    // a JOIN ON condition. Move mr.horizon = lo.horizon to WHERE (2026-04-23 fix).
    const dateAdj = await pool.query(`
      UPDATE labeled_outcomes lo
      SET market_return = mr.forward_return_pct,
          abnormal_return = lo.forward_return_pct - mr.forward_return_pct
      FROM articles a
      JOIN market_returns mr ON mr.trade_date = DATE(a.published_at)
        AND mr.symbol = 'SPY'
      WHERE a.id = lo.article_id
        AND mr.horizon = lo.horizon
        AND lo.symbol != 'SPY'
        AND lo.forward_return_pct IS NOT NULL
        AND lo.abnormal_return IS NULL
    `);
    console.log(`  ${dateAdj.rowCount} rows updated (date-based market_returns join)`);

    // SPY itself
    await pool.query(`
      UPDATE labeled_outcomes SET market_return = forward_return_pct, abnormal_return = 0
      WHERE symbol = 'SPY' AND abnormal_return IS NULL
    `);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: 새 기사 → market_session 태그 + aligned_entry_price
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n▶ STEP 3: 증분 시간 정렬...');

  if (!DRY_RUN) {
    // market_session 태그 (아직 안 된 기사만)
    await pool.query(`
      UPDATE articles SET market_session = CASE
        WHEN EXTRACT(DOW FROM published_at AT TIME ZONE 'America/New_York') IN (0, 6) THEN 'weekend'
        WHEN EXTRACT(HOUR FROM published_at AT TIME ZONE 'America/New_York') < 9
          OR (EXTRACT(HOUR FROM published_at AT TIME ZONE 'America/New_York') = 9
              AND EXTRACT(MINUTE FROM published_at AT TIME ZONE 'America/New_York') < 30) THEN 'pre_market'
        WHEN EXTRACT(HOUR FROM published_at AT TIME ZONE 'America/New_York') >= 16 THEN 'after_hours'
        ELSE 'market_hours'
      END
      WHERE market_session IS NULL
    `);

    // labeled_outcomes에 전파
    const sessionProp = await pool.query(`
      UPDATE labeled_outcomes lo SET market_session = a.market_session
      FROM articles a WHERE lo.article_id = a.id AND lo.market_session IS NULL
    `);
    console.log(`  ${sessionProp.rowCount} market_session propagated`);

    // aligned_entry_price (아직 안 된 것만)
    // 장전/장중 → 기존 entry_price 유지
    await pool.query(`
      UPDATE labeled_outcomes SET aligned_entry_price = entry_price, alignment_method = 'same_day'
      WHERE market_session IN ('pre_market', 'market_hours') AND aligned_entry_price IS NULL
    `);

    // 장후/주말 → 다음 거래일 가격
    const aligned = await pool.query(`
      UPDATE labeled_outcomes lo
      SET aligned_entry_price = next_day.price, alignment_method = 'next_trading_day'
      FROM (
        SELECT DISTINCT ON (lo2.id) lo2.id as outcome_id, hip.price
        FROM labeled_outcomes lo2
        JOIN articles a ON a.id = lo2.article_id
        JOIN worldmonitor_intel.historical_raw_items hip
          ON hip.provider = 'yahoo-chart' AND hip.symbol = lo2.symbol
          AND hip.valid_time_start > a.published_at
          AND hip.valid_time_start <= a.published_at + INTERVAL '5 days'
        WHERE lo2.market_session IN ('after_hours', 'weekend')
          AND lo2.aligned_entry_price IS NULL
        ORDER BY lo2.id, hip.valid_time_start ASC
      ) next_day
      WHERE lo.id = next_day.outcome_id
    `);
    console.log(`  ${aligned.rowCount} entry_price aligned to next trading day`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: 새 이벤트 → event_features 증분 적재
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n▶ STEP 4: 증분 event_features 적재...');

  if (!DRY_RUN) {
    // signal_history 스냅샷
    const signals = await pool.query(`
      SELECT DATE(ts) as d, signal_name, value FROM signal_history
      WHERE signal_name IN ('vix','yieldSpread','dollarIndex','oilPrice',
        'hy_credit_spread','marketStress','transmissionStrength','eventIntensity')
      ORDER BY d
    `);
    const dailySignals = new Map();
    for (const row of signals.rows) {
      const d = row.d.toISOString().slice(0, 10);
      if (!dailySignals.has(d)) dailySignals.set(d, {});
      dailySignals.get(d)[row.signal_name] = Number(row.value);
    }

    // 아직 피처가 없는 이벤트만
    const newEvents = await pool.query(`
      SELECT ce.id, ce.event_date, ce.theme, ce.source_count, ce.source_diversity, ce.article_count
      FROM canonical_events ce
      LEFT JOIN event_features ef ON ef.canonical_event_id = ce.id
      WHERE ef.canonical_event_id IS NULL
    `);

    // Pre-compute sorted date list for lookback calculations
    const sortedDates = [...dailySignals.keys()].sort();

    function computeVixFeatures(d, vix) {
      if (vix == null) return { vixZscore: 0, vixMomentum: 0 };
      // vix_momentum: 7-day change rate
      const dt = new Date(d);
      dt.setDate(dt.getDate() - 7);
      const d7ago = dt.toISOString().slice(0, 10);
      const vixPrev = dailySignals.get(d7ago)?.vix;
      const vixMomentum = vixPrev ? (vix - vixPrev) / Math.max(vixPrev, 1) : 0;
      // vix_zscore: 90-day rolling z-score
      const vixHistory = [];
      for (const dd of sortedDates) {
        if (dd > d) break;
        const v = dailySignals.get(dd)?.vix;
        if (v != null) vixHistory.push(v);
      }
      const recent = vixHistory.slice(-90);
      let vixZscore = 0;
      if (recent.length >= 10) {
        const mean = recent.reduce((s, v) => s + v, 0) / recent.length;
        const std = Math.sqrt(recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length) || 1;
        vixZscore = (vix - mean) / Math.max(std, 0.01);
      }
      return { vixZscore: Math.round(vixZscore * 1e4) / 1e4, vixMomentum: Math.round(vixMomentum * 1e4) / 1e4 };
    }

    function computeHawkesMomentum(d, ei) {
      if (!ei) return 0;
      const dt = new Date(d);
      dt.setDate(dt.getDate() - 7);
      const d7ago = dt.toISOString().slice(0, 10);
      const eiPrev = dailySignals.get(d7ago)?.eventIntensity ?? 0;
      if (!eiPrev) return 0;
      return Math.round((ei - eiPrev) / Math.max(eiPrev, 0.01) * 1e4) / 1e4;
    }

    // Collect features first, then bulk-INSERT via UNNEST — one round-trip
    // instead of N per-event round-trips.
    const regimeMultMap = { crisis: 2.0, 'risk-off': 1.5, balanced: 1.0, 'risk-on': 0.8, 'risk-on-strong': 0.6 };
    const featureRows = [];
    for (const event of newEvents.rows) {
      const d = event.event_date.toISOString().slice(0, 10);
      const sig = dailySignals.get(d) || {};
      const vix = sig.vix ?? null;
      const regime = vix != null ? classifyRegime(vix, sig.hy_credit_spread, null, null) : 'balanced';
      const ei = sig.eventIntensity ?? 0;
      const { vixZscore, vixMomentum } = computeVixFeatures(d, vix);
      const hawkesMom = computeHawkesMomentum(d, ei);
      featureRows.push({
        canonical_event_id: event.id,
        source_count: event.source_count,
        source_diversity: event.source_diversity,
        article_count: event.article_count,
        hawkes_intensity: ei,
        hawkes_momentum: hawkesMom,
        hmm_regime: regime,
        vix_value: vix,
        vix_zscore: vixZscore,
        vix_momentum: vixMomentum,
        yield_spread: sig.yieldSpread ?? null,
        oil_price: sig.oilPrice ?? null,
        dollar_index: sig.dollarIndex ?? null,
        credit_spread_hy: sig.hy_credit_spread ?? null,
        market_stress: sig.marketStress ?? null,
        transmission_strength: sig.transmissionStrength ?? null,
        event_intensity: sig.eventIntensity ?? null,
        regime_label: regime,
        regime_multiplier: regimeMultMap[regime] || 1.0,
        risk_gauge: vix != null ? clamp(45 + (vix - 20) * 2, 4, 100) : 45,
        graph_signal_score: clamp(event.source_count * 12 + event.source_diversity * 40, 0, 100),
        nmi_score: clamp((sig.transmissionStrength ?? 0) * 0.6 + (sig.marketStress ?? 0) * 0.4, 0, 1),
        narrative_alignment: clamp(40 + event.source_count * 8, 0, 100),
        truth_discovery_score: clamp(event.source_diversity * 0.7 + 0.3, 0.3, 1),
        legacy_conviction: clamp(Math.round(24 + event.source_count * 7 + (sig.eventIntensity ?? 0) * 14), 20, 98),
        legacy_fpr: clamp(Math.round(82 - event.source_count * 6 - (sig.eventIntensity ?? 0) * 12), 6, 78),
      });
    }

    let featureCount = 0;
    if (featureRows.length) {
      await pool.query(`
        INSERT INTO event_features (
          canonical_event_id, source_count, source_diversity, article_count,
          hawkes_intensity, hawkes_momentum, hmm_regime,
          vix_value, vix_zscore, vix_momentum,
          yield_spread, oil_price, dollar_index, credit_spread_hy,
          market_stress, transmission_strength, event_intensity,
          regime_label, regime_multiplier, risk_gauge,
          graph_signal_score, nmi_score, narrative_alignment,
          truth_discovery_score, legacy_conviction, legacy_fpr
        )
        SELECT * FROM UNNEST(
          $1::bigint[],  $2::int[],              $3::double precision[], $4::int[],
          $5::double precision[], $6::double precision[], $7::text[],
          $8::double precision[], $9::double precision[], $10::double precision[],
          $11::double precision[], $12::double precision[], $13::double precision[], $14::double precision[],
          $15::double precision[], $16::double precision[], $17::double precision[],
          $18::text[], $19::double precision[], $20::double precision[],
          $21::double precision[], $22::double precision[], $23::double precision[],
          $24::double precision[], $25::double precision[], $26::double precision[]
        )
        ON CONFLICT (canonical_event_id) DO NOTHING
      `, [
        featureRows.map((r) => r.canonical_event_id),
        featureRows.map((r) => r.source_count),
        featureRows.map((r) => r.source_diversity),
        featureRows.map((r) => r.article_count),
        featureRows.map((r) => r.hawkes_intensity),
        featureRows.map((r) => r.hawkes_momentum),
        featureRows.map((r) => r.hmm_regime),
        featureRows.map((r) => r.vix_value),
        featureRows.map((r) => r.vix_zscore),
        featureRows.map((r) => r.vix_momentum),
        featureRows.map((r) => r.yield_spread),
        featureRows.map((r) => r.oil_price),
        featureRows.map((r) => r.dollar_index),
        featureRows.map((r) => r.credit_spread_hy),
        featureRows.map((r) => r.market_stress),
        featureRows.map((r) => r.transmission_strength),
        featureRows.map((r) => r.event_intensity),
        featureRows.map((r) => r.regime_label),
        featureRows.map((r) => r.regime_multiplier),
        featureRows.map((r) => r.risk_gauge),
        featureRows.map((r) => r.graph_signal_score),
        featureRows.map((r) => r.nmi_score),
        featureRows.map((r) => r.narrative_alignment),
        featureRows.map((r) => r.truth_discovery_score),
        featureRows.map((r) => r.legacy_conviction),
        featureRows.map((r) => r.legacy_fpr),
      ]);
      featureCount = featureRows.length;
    }
    console.log(`  ${featureCount} new event features inserted`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: 새 이벤트 → matched_controls + uplift 증분 매칭
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n▶ STEP 5: 증분 matched controls + uplift...');

  if (!DRY_RUN) {
    // signal 스냅샷 (STEP 4에서 이미 로드됨)
    const signals2 = await pool.query(`
      SELECT DATE(ts) as d,
             MAX(CASE WHEN signal_name = 'vix' THEN value END) as vix,
             MAX(CASE WHEN signal_name = 'yieldSpread' THEN value END) as ys
      FROM signal_history
      WHERE signal_name IN ('vix', 'yieldSpread')
      GROUP BY DATE(ts)
    `);
    const sigMap = new Map();
    for (const row of signals2.rows) {
      sigMap.set(row.d.toISOString().slice(0, 10), {
        vix: Number(row.vix) || 20,
        ys: Number(row.ys) || 0,
        dow: new Date(row.d).getDay(),
      });
    }

    // 아직 control이 없는 이벤트만
    const unmatched = await pool.query(`
      SELECT ce.id, ce.event_date, ce.theme
      FROM canonical_events ce
      LEFT JOIN matched_controls mc ON mc.canonical_event_id = ce.id
      WHERE mc.canonical_event_id IS NULL
    `);

    // 테마별 이벤트 날짜
    const themeEventDates = new Map();
    const allEventDates = await pool.query('SELECT event_date, theme FROM canonical_events');
    for (const r of allEventDates.rows) {
      const d = r.event_date.toISOString().slice(0, 10);
      if (!themeEventDates.has(r.theme)) themeEventDates.set(r.theme, new Set());
      themeEventDates.get(r.theme).add(d);
    }

    const allDates = Array.from(sigMap.keys()).sort();
    let matchCount = 0;

    for (const event of unmatched.rows) {
      const d = event.event_date.toISOString().slice(0, 10);
      const eSig = sigMap.get(d);
      if (!eSig) continue;

      const eventDates = themeEventDates.get(event.theme) || new Set();
      const candidates = [];
      for (const cd of allDates) {
        if (eventDates.has(cd)) continue;
        const cs = sigMap.get(cd);
        if (!cs || cs.dow !== eSig.dow) continue;
        if (Math.abs(cs.vix - eSig.vix) > 3) continue;
        if (Math.abs(cs.ys - eSig.ys) > 0.2) continue;
        const dist = Math.sqrt(((cs.vix - eSig.vix) / 3) ** 2 + ((cs.ys - eSig.ys) / 0.2) ** 2);
        candidates.push({ date: cd, dist, vix: cs.vix, ys: cs.ys });
      }

      candidates.sort((a, b) => a.dist - b.dist);
      for (const ctrl of candidates.slice(0, 5)) {
        await pool.query(`
          INSERT INTO matched_controls (canonical_event_id, control_date, match_distance,
            vix_event, vix_control, yield_spread_event, yield_spread_control, regime_event, regime_control)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT DO NOTHING
        `, [event.id, ctrl.date, ctrl.dist, eSig.vix, ctrl.vix, eSig.ys, ctrl.ys, 'balanced', 'balanced']);
      }
      if (candidates.length > 0) matchCount++;
    }
    console.log(`  ${matchCount} new events matched with controls`);

    // 증분 uplift (아직 없는 것만)
    const upliftResult = await pool.query(`
      INSERT INTO event_uplift (canonical_event_id, symbol, horizon, event_alpha, control_avg_return, uplift, t_stat, n_controls, evidence_grade)
      SELECT
        mc_agg.canonical_event_id, event_lo.symbol, event_lo.horizon,
        event_lo.avg_alpha, mc_agg.avg_ctrl,
        event_lo.avg_alpha - mc_agg.avg_ctrl,
        CASE WHEN mc_agg.std_ctrl > 0 AND mc_agg.n_ctrl > 1
             THEN (event_lo.avg_alpha - mc_agg.avg_ctrl) / (mc_agg.std_ctrl / SQRT(mc_agg.n_ctrl))
             ELSE 0 END,
        mc_agg.n_ctrl,
        CASE
          WHEN event_lo.avg_alpha > 0 AND (event_lo.avg_alpha - mc_agg.avg_ctrl) > 0
               AND CASE WHEN mc_agg.std_ctrl > 0 AND mc_agg.n_ctrl > 1
                        THEN (event_lo.avg_alpha - mc_agg.avg_ctrl) / (mc_agg.std_ctrl / SQRT(mc_agg.n_ctrl))
                        ELSE 0 END > 1.96
          THEN 'E2'
          WHEN event_lo.avg_alpha > 0 THEN 'E1'
          ELSE 'E0'
        END
      FROM (
        SELECT mc.canonical_event_id,
               AVG(lo.forward_return_pct) as avg_ctrl,
               STDDEV(lo.forward_return_pct) as std_ctrl,
               COUNT(DISTINCT mc.control_date) as n_ctrl
        FROM matched_controls mc
        JOIN articles a ON DATE(a.published_at) = mc.control_date
        JOIN labeled_outcomes lo ON lo.article_id = a.id
        WHERE NOT EXISTS (SELECT 1 FROM event_uplift eu WHERE eu.canonical_event_id = mc.canonical_event_id)
        GROUP BY mc.canonical_event_id
      ) mc_agg
      JOIN (
        SELECT aem.canonical_event_id, lo.symbol, lo.horizon, AVG(lo.abnormal_return) as avg_alpha
        FROM article_event_map aem
        JOIN labeled_outcomes lo ON lo.article_id = aem.article_id
        WHERE lo.abnormal_return IS NOT NULL
        GROUP BY aem.canonical_event_id, lo.symbol, lo.horizon
      ) event_lo ON event_lo.canonical_event_id = mc_agg.canonical_event_id
      ON CONFLICT (canonical_event_id, symbol, horizon) DO NOTHING
    `);
    console.log(`  ${upliftResult.rowCount} new uplift rows`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════════
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

  const stats = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM canonical_events) as events,
      (SELECT COUNT(*) FROM article_event_map) as mappings,
      (SELECT COUNT(*) FROM labeled_outcomes WHERE abnormal_return IS NOT NULL) as alpha_rows,
      (SELECT COUNT(*) FROM labeled_outcomes WHERE aligned_entry_price IS NOT NULL) as aligned_rows,
      (SELECT COUNT(*) FROM event_features) as features,
      (SELECT COUNT(*) FROM matched_controls) as controls,
      (SELECT COUNT(*) FROM event_uplift) as uplift,
      (SELECT COUNT(*) FROM event_uplift WHERE evidence_grade = 'E2') as e2_count,
      (SELECT COUNT(*) FROM articles LEFT JOIN article_event_map aem ON aem.article_id = articles.id
       WHERE aem.article_id IS NULL AND articles.theme IS NOT NULL AND articles.theme != 'unknown') as unmapped_remaining
  `);

  const s = stats.rows[0];
  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`  INCREMENTAL EVENT ENGINE COMPLETE (${elapsed}s)`);
  console.log(`═══════════════════════════════════════════════════`);
  console.log(`  Events:          ${s.events}`);
  console.log(`  Mappings:        ${s.mappings}`);
  console.log(`  Alpha rows:      ${s.alpha_rows}`);
  console.log(`  Aligned prices:  ${s.aligned_rows}`);
  console.log(`  Features:        ${s.features}`);
  console.log(`  Controls:        ${s.controls}`);
  console.log(`  Uplift (E2):     ${s.e2_count} / ${s.uplift}`);
  console.log(`  Unmapped articles: ${s.unmapped_remaining}`);

  await pool.end();
}

withLock('event-engine', main).catch(e => { console.error(e); process.exit(1); });
