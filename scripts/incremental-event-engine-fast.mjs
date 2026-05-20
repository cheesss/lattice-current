#!/usr/bin/env node
/**
 * incremental-event-engine-fast.mjs — 고속 증분 이벤트 엔진
 *
 * 최적화:
 *   - 기존 이벤트 + 미매핑 기사를 전부 메모리에 한번에 로드
 *   - DB 왕복 최소화 (조회 2번 + 배치 INSERT)
 *   - 날짜+테마 그룹별 일괄 처리
 *
 * Usage:
 *   node scripts/incremental-event-engine-fast.mjs
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();

const PG_CONFIG = {
  ...resolveNasPgConfig(),
  max: 4,
};

const SIMILARITY_THRESHOLD = 0.7;
const SKIP_CONTROLS = process.argv.includes('--skip-controls') || process.env.EVENT_ENGINE_SKIP_CONTROLS === '1';
const REPAIR_DAYS = Math.max(1, Math.min(3650, Number(process.env.EVENT_ENGINE_REPAIR_DAYS) || 14));
const FEATURE_REFRESH_DAYS = Math.max(1, Math.min(365, Number(process.env.EVENT_ENGINE_FEATURE_REFRESH_DAYS) || 7));

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

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

function classifyRegime(vix) {
  if (vix > 25) return 'risk-off';
  if (vix < 18) return 'risk-on';
  return 'balanced';
}

async function repairCanonicalEventDates(pool) {
  const result = await pool.query(`
    WITH target AS (
      SELECT ce.id,
             MIN(a.published_at::date) AS article_date
        FROM canonical_events ce
        JOIN article_event_map aem ON aem.canonical_event_id = ce.id
        JOIN articles a ON a.id = aem.article_id
       WHERE a.published_at >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY ce.id, ce.event_date
      HAVING COUNT(DISTINCT a.published_at::date) = 1
         AND ce.event_date IS DISTINCT FROM MIN(a.published_at::date)
    )
    UPDATE canonical_events ce
       SET event_date = target.article_date
      FROM target
     WHERE ce.id = target.id
  `, [REPAIR_DAYS]);
  if (result.rowCount > 0) {
    console.log(`  repaired ${result.rowCount} canonical event date keys`);
  }
}

async function main() {
  const pool = new pg.Pool(PG_CONFIG);
  const t0 = performance.now();

  console.log('incremental-event-engine-fast');
  await repairCanonicalEventDates(pool);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 1: 전부 메모리에 로드 (DB 왕복 2번으로 끝)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n>> Loading existing events into memory...');
  const existingEvents = await pool.query(`
    SELECT id, to_char(event_date, 'YYYY-MM-DD') as event_date_key, theme, avg_embedding::text as avg_embedding, article_count
    FROM canonical_events
  `);

  // 날짜+테마 → 이벤트 목록 인덱스
  const eventIndex = new Map();
  for (const evt of existingEvents.rows) {
    const key = `${evt.event_date_key}::${evt.theme}`;
    if (!eventIndex.has(key)) eventIndex.set(key, []);
    eventIndex.get(key).push({
      id: evt.id,
      embedding: parseVector(evt.avg_embedding),
      articleCount: evt.article_count,
    });
  }
  console.log(`  ${existingEvents.rows.length} existing events indexed`);

  console.log('>> Loading unmapped articles...');
  const unmapped = await pool.query(`
    SELECT a.id, a.title, a.source, a.theme, to_char(a.published_at::date, 'YYYY-MM-DD') as event_date_key,
           a.embedding::text as embedding
    FROM articles a
    LEFT JOIN article_event_map aem ON aem.article_id = a.id
    WHERE aem.article_id IS NULL
      AND a.theme IS NOT NULL AND a.theme != 'unknown'
    ORDER BY a.published_at
  `);
  console.log(`  ${unmapped.rows.length} unmapped articles loaded`);

  if (unmapped.rows.length === 0) {
    console.log('  Nothing to process');
    await runStep2to5(pool);
    await pool.end();
    return;
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 2: 메모리에서 일괄 매칭 (DB 왕복 0)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n>> Matching articles to events in memory...');

  // 결과 수집
  const newMappings = [];      // {articleId, eventId}
  const newEvents = [];        // {dateStr, theme, title, embedding, articleIds}
  const eventUpdates = [];     // {eventId, newArticleCount}

  // 날짜+테마 그룹별 처리
  const groups = new Map();
  for (const art of unmapped.rows) {
    const key = `${art.event_date_key}::${art.theme}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(art);
  }

  let mergedCount = 0, newEventCount = 0;

  for (const [key, articles] of groups) {
    const [dateStr, theme] = key.split('::');
    const existing = eventIndex.get(key) || [];

    for (const article of articles) {
      const artEmb = parseVector(article.embedding);
      let merged = false;

      if (artEmb && existing.length > 0) {
        for (const evt of existing) {
          if (evt.embedding && cosineSimilarity(artEmb, evt.embedding) >= SIMILARITY_THRESHOLD) {
            if (evt.id != null) {
              // 기존 DB 이벤트에 병합
              newMappings.push({ articleId: article.id, eventId: evt.id });
            } else {
              // 아직 INSERT 안 된 새 이벤트에 병합 → articleIds에 추가
              newEvents[evt._tempIndex].articleIds.push(article.id);
              newEvents[evt._tempIndex].sources.add(article.source);
            }
            evt.articleCount++;
            merged = true;
            mergedCount++;
            break;
          }
        }
      }

      if (!merged) {
        // 같은 그룹의 이전 새 이벤트와도 비교
        let mergedToNew = false;
        for (const ne of newEvents) {
          if (ne.dateStr === dateStr && ne.theme === theme && ne.embedding && artEmb) {
            if (cosineSimilarity(artEmb, ne.embedding) >= SIMILARITY_THRESHOLD) {
              ne.articleIds.push(article.id);
              ne.sources.add(article.source);
              mergedToNew = true;
              mergedCount++;
              break;
            }
          }
        }

        if (!mergedToNew) {
          const ne = {
            dateStr, theme,
            title: article.title,
            embedding: artEmb,
            articleIds: [article.id],
            sources: new Set([article.source]),
            _tempIndex: newEvents.length,
          };
          newEvents.push(ne);
          // 다음 기사가 이 이벤트에 병합될 수 있도록 existing에도 추가 (실제 DB id는 아직 없음)
          existing.push({ id: null, embedding: artEmb, articleCount: 1, _tempIndex: ne._tempIndex });
          newEventCount++;
        }
      }
    }
  }

  console.log(`  ${mergedCount} merged into existing, ${newEventCount} new events`);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 3: 배치 INSERT (트랜잭션 1번)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n>> Batch writing to DB...');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 새 이벤트 INSERT
    for (const ne of newEvents) {
      const res = await client.query(`
        INSERT INTO canonical_events (event_date, theme, representative_title, source_count, source_diversity, article_count, avg_embedding)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
      `, [ne.dateStr, ne.theme, ne.title, ne.sources.size,
          Number((ne.sources.size / ne.articleIds.length).toFixed(3)),
          ne.articleIds.length,
          ne.embedding ? `[${ne.embedding.join(',')}]` : null]);

      const eventId = res.rows[0].id;
      for (const artId of ne.articleIds) {
        newMappings.push({ articleId: artId, eventId });
      }
    }

    // 매핑 INSERT (기존 이벤트 병합 + 새 이벤트)
    for (const m of newMappings) {
      await client.query(
        'INSERT INTO article_event_map (article_id, canonical_event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [m.articleId, m.eventId]
      );
    }

    // labeled_outcomes 연결
    const linked = await client.query(`
      UPDATE labeled_outcomes lo SET canonical_event_id = aem.canonical_event_id
      FROM article_event_map aem
      WHERE lo.article_id = aem.article_id AND lo.canonical_event_id IS NULL
    `);

    await client.query('COMMIT');
    console.log(`  ${newEvents.length} events created, ${newMappings.length} mappings, ${linked.rowCount} outcomes linked`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 4-5: 나머지 증분 처리
  // ═══════════════════════════════════════════════════════════════════
  await runStep2to5(pool);

  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  const stats = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM canonical_events) as events,
      (SELECT COUNT(*) FROM article_event_map) as mappings,
      (SELECT COUNT(*) FROM labeled_outcomes WHERE abnormal_return IS NOT NULL) as alpha_rows,
      (SELECT COUNT(*) FROM event_features) as features,
      (SELECT COUNT(*) FROM event_uplift) as uplift,
      (SELECT COUNT(*) FROM articles a LEFT JOIN article_event_map aem ON aem.article_id = a.id
       WHERE aem.article_id IS NULL AND a.theme IS NOT NULL AND a.theme != 'unknown') as unmapped
  `);
  const s = stats.rows[0];
  console.log(`\n== DONE (${elapsed}s) ==`);
  console.log(`  Events: ${s.events} | Mappings: ${s.mappings} | Alpha: ${s.alpha_rows}`);
  console.log(`  Features: ${s.features} | Uplift: ${s.uplift} | Unmapped: ${s.unmapped}`);

  await pool.end();
}

async function runStep2to5(pool) {
  // STEP 2: abnormal_return
  console.log('\n>> Incremental abnormal_return...');
  const ar = await pool.query(`
    UPDATE labeled_outcomes lo
    SET market_return = spy.forward_return_pct,
        abnormal_return = lo.forward_return_pct - spy.forward_return_pct
    FROM labeled_outcomes spy
    WHERE spy.symbol = 'SPY' AND spy.article_id = lo.article_id
      AND spy.horizon = lo.horizon AND lo.symbol != 'SPY' AND lo.abnormal_return IS NULL
  `);
  await pool.query(`UPDATE labeled_outcomes SET market_return = forward_return_pct, abnormal_return = 0 WHERE symbol = 'SPY' AND abnormal_return IS NULL`);
  console.log(`  ${ar.rowCount} rows`);

  // STEP 3: market_session + aligned_entry_price
  console.log('>> Incremental time alignment...');
  await pool.query(`
    UPDATE articles SET market_session = CASE
      WHEN EXTRACT(DOW FROM published_at AT TIME ZONE 'America/New_York') IN (0, 6) THEN 'weekend'
      WHEN EXTRACT(HOUR FROM published_at AT TIME ZONE 'America/New_York') < 9
        OR (EXTRACT(HOUR FROM published_at AT TIME ZONE 'America/New_York') = 9
            AND EXTRACT(MINUTE FROM published_at AT TIME ZONE 'America/New_York') < 30) THEN 'pre_market'
      WHEN EXTRACT(HOUR FROM published_at AT TIME ZONE 'America/New_York') >= 16 THEN 'after_hours'
      ELSE 'market_hours'
    END WHERE market_session IS NULL
  `);
  const sp = await pool.query(`UPDATE labeled_outcomes lo SET market_session = a.market_session FROM articles a WHERE lo.article_id = a.id AND lo.market_session IS NULL`);
  await pool.query(`UPDATE labeled_outcomes SET aligned_entry_price = entry_price, alignment_method = 'same_day' WHERE market_session IN ('pre_market','market_hours') AND aligned_entry_price IS NULL`);
  console.log(`  ${sp.rowCount} sessions propagated`);

  // STEP 4: event_features
  console.log('>> Incremental event_features...');
  const signals = await pool.query(`
    SELECT to_char(ts::date, 'YYYY-MM-DD') as d, signal_name, value FROM signal_history
    WHERE signal_name IN ('vix','yieldSpread','dollarIndex','oilPrice','hy_credit_spread','marketStress','transmissionStrength','eventIntensity')
    ORDER BY d
  `);
  const dailySig = new Map();
  for (const r of signals.rows) {
    const d = r.d;
    if (!dailySig.has(d)) dailySig.set(d, {});
    dailySig.get(d)[r.signal_name] = Number(r.value);
  }

  const newEvts = await pool.query(`
    SELECT ce.id, to_char(ce.event_date, 'YYYY-MM-DD') as event_date_key,
           ce.source_count, ce.source_diversity, ce.article_count
    FROM canonical_events ce LEFT JOIN event_features ef ON ef.canonical_event_id = ce.id
    WHERE ef.canonical_event_id IS NULL
       OR ce.event_date >= NOW()::date - ($1::int * INTERVAL '1 day')
       OR COALESCE(ce.source_count, -1) <> COALESCE(ef.source_count, -1)
       OR COALESCE(ce.article_count, -1) <> COALESCE(ef.article_count, -1)
       OR ABS(COALESCE(ce.source_diversity, -1) - COALESCE(ef.source_diversity, -1)) > 0.0001
  `, [FEATURE_REFRESH_DAYS]);

  const rm = { crisis: 2.0, 'risk-off': 1.5, balanced: 1.0, 'risk-on': 0.8, 'risk-on-strong': 0.6 };
  const rows = [];
  for (const evt of newEvts.rows) {
    const d = evt.event_date_key;
    const sig = dailySig.get(d) || {};
    const vix = sig.vix ?? null;
    const regime = vix != null ? classifyRegime(vix) : 'balanced';
    rows.push({
      id: evt.id, sc: evt.source_count, sd: evt.source_diversity, ac: evt.article_count,
      hi: sig.eventIntensity ?? 0, hm: 0, regime, vix, vz: 0, vm: 0,
      ys: sig.yieldSpread ?? null, op: sig.oilPrice ?? null, di: sig.dollarIndex ?? null, cs: sig.hy_credit_spread ?? null,
      ms: sig.marketStress ?? null, ts: sig.transmissionStrength ?? null, ei: sig.eventIntensity ?? null,
      rmul: rm[regime] || 1.0,
      rg: vix != null ? clamp(45 + (vix - 20) * 2, 4, 100) : 45,
      gss: clamp(evt.source_count * 12 + evt.source_diversity * 40, 0, 100),
      nmi: clamp((sig.transmissionStrength ?? 0) * 0.6 + (sig.marketStress ?? 0) * 0.4, 0, 1),
      na: clamp(40 + evt.source_count * 8, 0, 100),
      tds: clamp(evt.source_diversity * 0.7 + 0.3, 0.3, 1),
      lc: clamp(Math.round(24 + evt.source_count * 7 + (sig.eventIntensity ?? 0) * 14), 20, 98),
      lf: clamp(Math.round(82 - evt.source_count * 6 - (sig.eventIntensity ?? 0) * 12), 6, 78),
    });
  }

  let fc = 0;
  if (rows.length) {
    await pool.query(`
      INSERT INTO event_features (canonical_event_id, source_count, source_diversity, article_count,
        hawkes_intensity, hawkes_momentum, hmm_regime, vix_value, vix_zscore, vix_momentum,
        yield_spread, oil_price, dollar_index, credit_spread_hy,
        market_stress, transmission_strength, event_intensity,
        regime_label, regime_multiplier, risk_gauge,
        graph_signal_score, nmi_score, narrative_alignment,
        truth_discovery_score, legacy_conviction, legacy_fpr)
      SELECT * FROM UNNEST(
        $1::bigint[], $2::int[], $3::double precision[], $4::int[],
        $5::double precision[], $6::double precision[], $7::text[],
        $8::double precision[], $9::double precision[], $10::double precision[],
        $11::double precision[], $12::double precision[], $13::double precision[], $14::double precision[],
        $15::double precision[], $16::double precision[], $17::double precision[],
        $18::text[], $19::double precision[], $20::double precision[],
        $21::double precision[], $22::double precision[], $23::double precision[],
        $24::double precision[], $25::double precision[], $26::double precision[]
      )
      ON CONFLICT (canonical_event_id) DO UPDATE SET
        computed_at = NOW(),
        source_count = EXCLUDED.source_count,
        source_diversity = EXCLUDED.source_diversity,
        article_count = EXCLUDED.article_count,
        hawkes_intensity = EXCLUDED.hawkes_intensity,
        hawkes_momentum = EXCLUDED.hawkes_momentum,
        hmm_regime = EXCLUDED.hmm_regime,
        vix_value = EXCLUDED.vix_value,
        vix_zscore = EXCLUDED.vix_zscore,
        vix_momentum = EXCLUDED.vix_momentum,
        yield_spread = EXCLUDED.yield_spread,
        oil_price = EXCLUDED.oil_price,
        dollar_index = EXCLUDED.dollar_index,
        credit_spread_hy = EXCLUDED.credit_spread_hy,
        market_stress = EXCLUDED.market_stress,
        transmission_strength = EXCLUDED.transmission_strength,
        event_intensity = EXCLUDED.event_intensity,
        regime_label = EXCLUDED.regime_label,
        regime_multiplier = EXCLUDED.regime_multiplier,
        risk_gauge = EXCLUDED.risk_gauge,
        graph_signal_score = EXCLUDED.graph_signal_score,
        nmi_score = EXCLUDED.nmi_score,
        narrative_alignment = EXCLUDED.narrative_alignment,
        truth_discovery_score = EXCLUDED.truth_discovery_score,
        legacy_conviction = EXCLUDED.legacy_conviction,
        legacy_fpr = EXCLUDED.legacy_fpr
    `, [
      rows.map((r) => r.id), rows.map((r) => r.sc), rows.map((r) => r.sd), rows.map((r) => r.ac),
      rows.map((r) => r.hi), rows.map((r) => r.hm), rows.map((r) => r.regime),
      rows.map((r) => r.vix), rows.map((r) => r.vz), rows.map((r) => r.vm),
      rows.map((r) => r.ys), rows.map((r) => r.op), rows.map((r) => r.di), rows.map((r) => r.cs),
      rows.map((r) => r.ms), rows.map((r) => r.ts), rows.map((r) => r.ei),
      rows.map((r) => r.regime), rows.map((r) => r.rmul), rows.map((r) => r.rg),
      rows.map((r) => r.gss), rows.map((r) => r.nmi), rows.map((r) => r.na),
      rows.map((r) => r.tds), rows.map((r) => r.lc), rows.map((r) => r.lf),
    ]);
    fc = rows.length;
  }
  console.log(`  ${fc} features upserted`);

  if (SKIP_CONTROLS) {
    console.log('>> Controls + uplift skipped (--skip-controls); feature refresh complete');
    return;
  }

  // STEP 5: matched_controls + uplift (새 이벤트만)
  console.log('>> Incremental controls + uplift...');
  // 간략 버전: 새 이벤트가 적을 때만 실행 (대량이면 별도 배치)
  if (newEvts.rows.length > 0 && newEvts.rows.length < 5000) {
    const sigSnap = await pool.query(`
      SELECT to_char(ts::date, 'YYYY-MM-DD') as d,
             MAX(CASE WHEN signal_name='vix' THEN value END) as vix,
             MAX(CASE WHEN signal_name='yieldSpread' THEN value END) as ys
      FROM signal_history WHERE signal_name IN ('vix','yieldSpread') GROUP BY to_char(ts::date, 'YYYY-MM-DD')
    `);
    const sm = new Map();
    for (const r of sigSnap.rows) sm.set(r.d, { vix: Number(r.vix) || 20, ys: Number(r.ys) || 0, dow: new Date(`${r.d}T00:00:00Z`).getUTCDay() });
    const allDates = Array.from(sm.keys()).sort();

    const unmatched = await pool.query(`
      SELECT ce.id, to_char(ce.event_date, 'YYYY-MM-DD') as event_date_key, ce.theme FROM canonical_events ce
      LEFT JOIN matched_controls mc ON mc.canonical_event_id = ce.id
      WHERE mc.canonical_event_id IS NULL
    `);

    let mc = 0;
    for (const evt of unmatched.rows) {
      const d = evt.event_date_key;
      const es = sm.get(d);
      if (!es) continue;
      const candidates = allDates
        .filter(cd => cd !== d && sm.get(cd)?.dow === es.dow && Math.abs(sm.get(cd).vix - es.vix) <= 3 && Math.abs(sm.get(cd).ys - es.ys) <= 0.2)
        .map(cd => ({ date: cd, dist: Math.sqrt(((sm.get(cd).vix - es.vix) / 3) ** 2 + ((sm.get(cd).ys - es.ys) / 0.2) ** 2) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 5);
      for (const c of candidates) {
        await pool.query(`INSERT INTO matched_controls (canonical_event_id, control_date, match_distance, vix_event, vix_control, yield_spread_event, yield_spread_control, regime_event, regime_control)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
          [evt.id, c.date, c.dist, es.vix, sm.get(c.date).vix, es.ys, sm.get(c.date).ys, 'balanced', 'balanced']);
      }
      if (candidates.length > 0) mc++;
    }
    console.log(`  ${mc} events matched`);
  } else if (newEvts.rows.length >= 5000) {
    console.log(`  Skipped controls (${newEvts.rows.length} new events — run build-matched-controls.mjs separately)`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
