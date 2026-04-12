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

const PG_CONFIG = {
  host: process.env.PG_HOST || '192.168.0.76',
  port: Number(process.env.PG_PORT || 5433),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || process.env.PGPASSWORD || 'lattice1234',
  database: process.env.PG_DATABASE || 'lattice',
  max: 4,
};

const SIMILARITY_THRESHOLD = 0.7;

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

async function main() {
  const pool = new pg.Pool(PG_CONFIG);
  const t0 = performance.now();

  console.log('incremental-event-engine-fast');

  // ═══════════════════════════════════════════════════════════════════
  // STEP 1: 전부 메모리에 로드 (DB 왕복 2번으로 끝)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n>> Loading existing events into memory...');
  const existingEvents = await pool.query(`
    SELECT id, event_date, theme, avg_embedding::text as avg_embedding, article_count
    FROM canonical_events
  `);

  // 날짜+테마 → 이벤트 목록 인덱스
  const eventIndex = new Map();
  for (const evt of existingEvents.rows) {
    const key = `${evt.event_date.toISOString().slice(0, 10)}::${evt.theme}`;
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
    SELECT a.id, a.title, a.source, a.theme, DATE(a.published_at) as event_date,
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
    const key = `${art.event_date.toISOString().slice(0, 10)}::${art.theme}`;
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
    SELECT DATE(ts) as d, signal_name, value FROM signal_history
    WHERE signal_name IN ('vix','yieldSpread','dollarIndex','oilPrice','hy_credit_spread','marketStress','transmissionStrength','eventIntensity')
    ORDER BY d
  `);
  const dailySig = new Map();
  for (const r of signals.rows) {
    const d = r.d.toISOString().slice(0, 10);
    if (!dailySig.has(d)) dailySig.set(d, {});
    dailySig.get(d)[r.signal_name] = Number(r.value);
  }

  const newEvts = await pool.query(`
    SELECT ce.id, ce.event_date, ce.source_count, ce.source_diversity, ce.article_count
    FROM canonical_events ce LEFT JOIN event_features ef ON ef.canonical_event_id = ce.id
    WHERE ef.canonical_event_id IS NULL
  `);

  let fc = 0;
  for (const evt of newEvts.rows) {
    const d = evt.event_date.toISOString().slice(0, 10);
    const sig = dailySig.get(d) || {};
    const vix = sig.vix ?? null;
    const regime = vix != null ? classifyRegime(vix) : 'balanced';
    const rm = { crisis: 2.0, 'risk-off': 1.5, balanced: 1.0, 'risk-on': 0.8, 'risk-on-strong': 0.6 };

    await pool.query(`
      INSERT INTO event_features (canonical_event_id, source_count, source_diversity, article_count,
        hawkes_intensity, hawkes_momentum, hmm_regime, vix_value, vix_zscore, vix_momentum,
        yield_spread, oil_price, dollar_index, credit_spread_hy,
        market_stress, transmission_strength, event_intensity,
        regime_label, regime_multiplier, risk_gauge,
        graph_signal_score, nmi_score, narrative_alignment,
        truth_discovery_score, legacy_conviction, legacy_fpr)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
      ON CONFLICT DO NOTHING
    `, [evt.id, evt.source_count, evt.source_diversity, evt.article_count,
        sig.eventIntensity ?? 0, 0, regime, vix, 0, 0,
        sig.yieldSpread ?? null, sig.oilPrice ?? null, sig.dollarIndex ?? null, sig.hy_credit_spread ?? null,
        sig.marketStress ?? null, sig.transmissionStrength ?? null, sig.eventIntensity ?? null,
        regime, rm[regime] || 1.0, vix != null ? clamp(45 + (vix - 20) * 2, 4, 100) : 45,
        clamp(evt.source_count * 12 + evt.source_diversity * 40, 0, 100),
        clamp((sig.transmissionStrength ?? 0) * 0.6 + (sig.marketStress ?? 0) * 0.4, 0, 1),
        clamp(40 + evt.source_count * 8, 0, 100),
        clamp(evt.source_diversity * 0.7 + 0.3, 0.3, 1),
        clamp(Math.round(24 + evt.source_count * 7 + (sig.eventIntensity ?? 0) * 14), 20, 98),
        clamp(Math.round(82 - evt.source_count * 6 - (sig.eventIntensity ?? 0) * 12), 6, 78)]);
    fc++;
  }
  console.log(`  ${fc} features inserted`);

  // STEP 5: matched_controls + uplift (새 이벤트만)
  console.log('>> Incremental controls + uplift...');
  // 간략 버전: 새 이벤트가 적을 때만 실행 (대량이면 별도 배치)
  if (newEvts.rows.length > 0 && newEvts.rows.length < 5000) {
    const sigSnap = await pool.query(`
      SELECT DATE(ts) as d,
             MAX(CASE WHEN signal_name='vix' THEN value END) as vix,
             MAX(CASE WHEN signal_name='yieldSpread' THEN value END) as ys
      FROM signal_history WHERE signal_name IN ('vix','yieldSpread') GROUP BY DATE(ts)
    `);
    const sm = new Map();
    for (const r of sigSnap.rows) sm.set(r.d.toISOString().slice(0, 10), { vix: Number(r.vix) || 20, ys: Number(r.ys) || 0, dow: new Date(r.d).getDay() });
    const allDates = Array.from(sm.keys()).sort();

    const unmatched = await pool.query(`
      SELECT ce.id, ce.event_date, ce.theme FROM canonical_events ce
      LEFT JOIN matched_controls mc ON mc.canonical_event_id = ce.id
      WHERE mc.canonical_event_id IS NULL
    `);

    let mc = 0;
    for (const evt of unmatched.rows) {
      const d = evt.event_date.toISOString().slice(0, 10);
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
