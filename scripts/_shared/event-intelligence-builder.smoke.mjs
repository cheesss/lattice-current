/**
 * Offline smoke test for event-intelligence-builder.mjs.
 * Uses a fake pg Pool that returns canned query results — no NAS access.
 */

import {
  buildHotEventsPayload,
  buildMetaModelHealthPayload,
  buildExplainEventPayload,
  buildSourceDiversityAuditPayload,
} from './event-intelligence-builder.mjs';

function makeFakePool(queryHandler) {
  return {
    query: queryHandler,
    connect: async () => ({
      query: queryHandler,
      release: () => {},
    }),
  };
}

function tableExistsResponse(tableName, exists = true) {
  return { rows: [{ oid: exists ? `public.${tableName}` : null }] };
}

let failures = 0;
function assertEq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'}`);
  if (!ok) failures += 1;
}

async function testHotEvents() {
  console.log('\n=== get_hot_events ===');

  const poolNoTable = makeFakePool(async (sql) => {
    if (sql.includes('to_regclass')) return tableExistsResponse('canonical_events', false);
    throw new Error('unexpected query');
  });
  const empty = await buildHotEventsPayload(poolNoTable);
  assertEq(empty.available, false, 'no canonical_events → available=false');
  assertEq(empty.events.length, 0, 'no canonical_events → events=[]');

  const poolFull = makeFakePool(async (sql, params) => {
    if (sql.includes('to_regclass')) return tableExistsResponse('canonical_events');
    if (sql.includes('recent_events') && sql.includes('uplift_agg')) {
      return {
        rows: [
          {
            id: 101, theme: 'energy', representative_title: 'Oil spike',
            event_date: '2026-04-22', article_count: 24, source_count: 12,
            temperature: 2.3, is_surge: true, raw_best_grade: 'E4', promoted_grade: 'E4',
            uplift_rows: 6, promoted_uplift_rows: 6, raw_max_abs_uplift: 0.045, raw_max_abs_t: 3.1,
            rank_abs_uplift: 0.045, rank_abs_t: 3.1, min_strong_controls: 12, max_strong_controls: 40,
            known_market_relevance_articles: 12, market_relevant_articles: 10, low_relevance_articles: 0,
            controls_blocked: false, relevance_blocked: false,
          },
          {
            id: 102, theme: 'technology', representative_title: 'AI chip news',
            event_date: '2026-04-22', article_count: 14, source_count: 8,
            temperature: 1.1, is_surge: false, raw_best_grade: 'E2', promoted_grade: 'E2',
            uplift_rows: 2, promoted_uplift_rows: 2, raw_max_abs_uplift: 0.012, raw_max_abs_t: 2.4,
            rank_abs_uplift: 0.012, rank_abs_t: 2.4, min_strong_controls: 10, max_strong_controls: 20,
            known_market_relevance_articles: 6, market_relevant_articles: 5, low_relevance_articles: 1,
            controls_blocked: false, relevance_blocked: false,
          },
          {
            id: 103, theme: 'defense', representative_title: 'Weak cluster',
            event_date: '2026-04-21', article_count: 3, source_count: 2,
            temperature: null, is_surge: false, raw_best_grade: null, promoted_grade: null,
            uplift_rows: 0, promoted_uplift_rows: 0, raw_max_abs_uplift: null, raw_max_abs_t: null,
            rank_abs_uplift: null, rank_abs_t: null, min_strong_controls: null, max_strong_controls: null,
            known_market_relevance_articles: 0, market_relevant_articles: 0, low_relevance_articles: 0,
            controls_blocked: false, relevance_blocked: false,
          },
        ],
      };
    }
    throw new Error('unexpected: ' + sql.slice(0, 60));
  });
  const full = await buildHotEventsPayload(poolFull, { limit: 10, lookbackDays: 7 });
  assertEq(full.available, true, 'available=true');
  assertEq(full.totalReturned, 3, '3 events returned');
  assertEq(full.surgeCount, 1, '1 surge event');
  assertEq(full.gradeCounts.E4, 1, 'E4 count=1');
  assertEq(full.gradeCounts.E2, 1, 'E2 count=1');
  assertEq(full.gradeCounts.none, 1, 'none count=1');
  assertEq(full.events[0].id, 101, 'top event = highest t-stat');
}

async function testMetaModelHealth() {
  console.log('\n=== get_meta_model_health ===');

  const poolNo = makeFakePool(async () => tableExistsResponse('model_eval', false));
  const none = await buildMetaModelHealthPayload(poolNo);
  assertEq(none.summary.level, 'warning', 'no tables → warning');
  assertEq(none.summary.hasEvalTable, false, 'hasEvalTable=false');

  let call = 0;
  const poolWithHighBrier = makeFakePool(async (sql) => {
    if (sql.includes('to_regclass')) {
      call += 1;
      // First call: model_eval exists, second: model_predictions exists
      return tableExistsResponse('x', true);
    }
    if (sql.includes('FROM model_eval')) {
      return {
        rows: [
          { model_version: 'v3', eval_date: '2026-04-22', brier_score: 0.32, ece: 0.08, log_loss: 0.6, sample_count: 500 },
        ],
      };
    }
    if (sql.includes('COUNT(*)::int') && sql.includes('FROM model_predictions')) {
      return { rows: [{ total: 1200, model_versions: 2, recent: 45 }] };
    }
    if (sql.includes('FROM model_predictions') && sql.includes('GROUP BY model_version')) {
      return { rows: [{ model_version: 'v3', n: 700, latest: '2026-04-22T10:00:00Z' }] };
    }
    return { rows: [] };
  });
  const high = await buildMetaModelHealthPayload(poolWithHighBrier);
  assertEq(high.summary.level, 'warning', 'high Brier → warning');
  assertEq(
    high.summary.notes.some((n) => n.includes('Brier')),
    true,
    'warning note mentions Brier',
  );
}

async function testExplainEvent() {
  console.log('\n=== explain_event ===');

  const bad = await buildExplainEventPayload(makeFakePool(async () => ({ rows: [] })), { eventId: 'abc' });
  assertEq(bad.ok, false, 'invalid eventId rejected');

  const poolEvent = makeFakePool(async (sql, params) => {
    if (sql.includes('FROM canonical_events') && sql.includes('WHERE id = $1')) {
      return {
        rows: [
          {
            id: 42, theme: 'energy', representative_title: 'Oil surge',
            event_date: '2026-04-22', article_count: 20, source_count: 9,
            created_at: '2026-04-22T12:00:00Z',
          },
        ],
      };
    }
    if (sql.includes('FROM event_uplift')) {
      return {
        rows: [
          { symbol: 'XOM', horizon: '5d', uplift: 0.03, t_stat: 2.5,
            raw_evidence_grade: 'E3', promoted_grade: 'E3',
            event_alpha: 0.02, control_avg_return: -0.01, n_controls: 40,
            known_market_relevance_articles: 2, market_relevant_articles: 2, low_relevance_articles: 0,
            controls_blocked: false, relevance_blocked: false },
        ],
      };
    }
    if (sql.includes('article_event_map')) {
      return {
        rows: [
          { id: 1, title: 'Big oil move', source: 'reuters', published_at: '2026-04-22', url: 'http://x' },
          { id: 2, title: 'Oil redux', source: 'bloomberg', published_at: '2026-04-22', url: 'http://y' },
        ],
      };
    }
    if (sql.includes('FROM matched_controls')) {
      return { rows: [{ control_date: '2026-04-15', vix_distance: 0.5, yield_spread_distance: 0.1 }] };
    }
    if (sql.includes('FROM event_hawkes_intensity')) {
      return { rows: [{ theme: 'energy', event_date: '2026-04-22', normalized_temperature: 2.1, is_surge: true, article_count: 20 }] };
    }
    return { rows: [] };
  });
  const ev = await buildExplainEventPayload(poolEvent, { eventId: 42 });
  assertEq(ev.ok, true, 'event found');
  assertEq(ev.event.id, 42, 'correct id');
  assertEq(ev.articles.length, 2, '2 articles');
  assertEq(ev.uplift[0].evidenceGrade, 'E3', 'uplift grade');
  assertEq(ev.hawkes.isSurge, true, 'hawkes surge');
  assertEq(ev.event.sampledSourceDiversity, 2, 'diversity = distinct sources in sample');

  const poolNoEvent = makeFakePool(async (sql) => {
    if (sql.includes('FROM canonical_events')) return { rows: [] };
    return { rows: [] };
  });
  const missing = await buildExplainEventPayload(poolNoEvent, { eventId: 999 });
  assertEq(missing.ok, false, 'missing event rejected');
}

async function testSourceDiversity() {
  console.log('\n=== get_source_diversity_audit ===');

  const poolCritical = makeFakePool(async (sql) => {
    if (sql.includes('to_regclass')) return tableExistsResponse('articles');
    if (sql.includes('GROUP BY source')) {
      return {
        rows: [
          { source_id: 'google-news', article_count: 600 },
          { source_id: 'reuters', article_count: 200 },
          { source_id: 'bbc', article_count: 100 },
          { source_id: 'iheart-radio', article_count: 100 },
        ],
      };
    }
    if (sql.includes('SELECT COUNT(*)::int AS total')) {
      return { rows: [{ total: 1000 }] };
    }
    return { rows: [] };
  });
  const critical = await buildSourceDiversityAuditPayload(poolCritical);
  assertEq(critical.level, 'critical', 'top source 60% → critical');
  assertEq(critical.totalArticles, 1000, 'total=1000');
  assertEq(critical.sources[0].flag, 'critical', 'google-news flagged critical');
  assertEq(critical.sources[0].isSyndicator, true, 'google-news detected as syndicator');

  const poolBalanced = makeFakePool(async (sql) => {
    if (sql.includes('to_regclass')) return tableExistsResponse('articles');
    if (sql.includes('GROUP BY source')) {
      return {
        rows: [
          { source_id: 'reuters', article_count: 150 },
          { source_id: 'bbc', article_count: 140 },
          { source_id: 'bloomberg', article_count: 130 },
          { source_id: 'nyt', article_count: 120 },
        ],
      };
    }
    if (sql.includes('SELECT COUNT(*)::int AS total')) {
      return { rows: [{ total: 1000 }] };
    }
    return { rows: [] };
  });
  const balanced = await buildSourceDiversityAuditPayload(poolBalanced);
  assertEq(balanced.level, 'ok', 'balanced distribution → ok');
  assertEq(balanced.sources[0].flag, null, 'no flag on top');
}

async function main() {
  await testHotEvents();
  await testMetaModelHealth();
  await testExplainEvent();
  await testSourceDiversity();
  console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke test error:', err);
  process.exit(2);
});
