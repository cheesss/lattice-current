/**
 * Live readonly test for all new domain-specific builders against actual NAS.
 * No writes, no mutations. Use this to verify schema/column assumptions.
 */
import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './nas-runtime.mjs';
import { buildNowcastStatusPayload } from './nowcast-status-builder.mjs';
import {
  buildHotEventsPayload,
  buildMetaModelHealthPayload,
  buildExplainEventPayload,
  buildSourceDiversityAuditPayload,
} from './event-intelligence-builder.mjs';

loadOptionalEnvFile();
const pool = new pg.Pool(resolveNasPgConfig());

function header(label) {
  console.log(`\n${'='.repeat(60)}\n${label}\n${'='.repeat(60)}`);
}

function compact(obj, depth = 2) {
  return JSON.stringify(obj, (k, v) => {
    if (typeof v === 'string' && v.length > 120) return v.slice(0, 120) + '…';
    return v;
  }, 2);
}

async function run() {
  try {
    header('1. get_nowcast_status');
    const nowcast = await buildNowcastStatusPayload(pool);
    console.log('summary:', compact(nowcast.summary));
    console.log('registry states:', nowcast.registry.states ?? 'n/a');
    console.log('reconciliation available:', nowcast.reconciliation.available, '| signals:', nowcast.reconciliation.signals?.length ?? 0);
    console.log('training snapshots:', nowcast.training.snapshots?.length ?? 0);
    if (nowcast.training.snapshots?.length) {
      console.log('  latest:', compact(nowcast.training.snapshots[0]));
    }

    header('2. get_hot_events (lookback=7d, limit=5)');
    const hot = await buildHotEventsPayload(pool, { limit: 5, lookbackDays: 7 });
    console.log('available:', hot.available, '| total:', hot.totalReturned);
    console.log('gradeCounts:', hot.gradeCounts);
    console.log('surgeCount:', hot.surgeCount);
    for (const ev of (hot.events || []).slice(0, 5)) {
      console.log(`  #${ev.id} [${ev.bestEvidenceGrade || '-'}] ${(ev.title || '').slice(0, 80)} | T=${ev.maxAbsTStat} | art=${ev.articleCount} | temp=${ev.temperature}`);
    }

    header('3. get_meta_model_health');
    const meta = await buildMetaModelHealthPayload(pool);
    console.log('summary:', compact(meta.summary));
    console.log('evalHistory count:', meta.evalHistory.length);
    console.log('activeModelVersions count:', meta.activeModelVersions.length);
    if (meta.activeModelVersions.length) {
      console.log('  top:', compact(meta.activeModelVersions[0]));
    }

    header('4. get_source_diversity_audit (window=24h)');
    const sd = await buildSourceDiversityAuditPayload(pool, { windowHours: 24 });
    console.log('level:', sd.level, '| total:', sd.totalArticles, '| distinct:', sd.distinctSources);
    console.log('topSourceShare:', sd.topSourceShare, '| syndicatorShare:', sd.syndicatorShare);
    for (const s of (sd.sources || []).slice(0, 8)) {
      console.log(`  - ${s.sourceId}: ${s.articleCount} (${(s.share * 100).toFixed(1)}%) flag=${s.flag} synd=${s.isSyndicator}`);
    }

    header('5. explain_event (use first hot event)');
    const firstId = hot.events?.[0]?.id;
    if (!firstId) {
      console.log('no event to explain');
    } else {
      const ev = await buildExplainEventPayload(pool, { eventId: firstId });
      console.log('ok:', ev.ok, '| event:', ev.event?.title?.slice(0, 80));
      console.log('hawkes:', compact(ev.hawkes));
      console.log('articles:', ev.articles?.length, '| uplift:', ev.uplift?.length, '| controls:', ev.controls?.length);
      if (ev.uplift?.length) {
        console.log('  top uplift:', compact(ev.uplift[0]));
      }
    }
  } catch (err) {
    console.error('\n❌ error:', err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

run();
