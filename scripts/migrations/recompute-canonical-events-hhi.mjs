#!/usr/bin/env node
/**
 * Recompute canonical_events.source_hhi / effective_source_count /
 * wire_dominated / top_source_share based on publisher_group and wire_source
 * annotations on articles.
 *
 * Requires:
 *   - add-canonical-events-hhi.mjs   (schema)
 *   - add-articles-source-metadata.mjs (schema)
 *   - backfill-article-source-metadata.mjs (data populated)
 *
 * Run: node scripts/migrations/recompute-canonical-events-hhi.mjs [--limit 1000]
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from '../_shared/nas-runtime.mjs';
import { computeSourceConcentration, computeLegacyDiversity } from '../_shared/source-concentration.mjs';

const { Client } = pg;

loadOptionalEnvFile();

const LIMIT_ARG = process.argv.indexOf('--limit');
const TOTAL_LIMIT = LIMIT_ARG >= 0 && process.argv[LIMIT_ARG + 1]
  ? Number(process.argv[LIMIT_ARG + 1])
  : Infinity;

const UPDATE_BATCH_SIZE = 5000;

async function main() {
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    console.log('loading article-event pairs...');
    const { rows: pairs } = await client.query(`
      SELECT aem.canonical_event_id AS event_id,
             a.publisher_group, a.source, a.wire_source
      FROM article_event_map aem
      JOIN articles a ON a.id = aem.article_id
      ORDER BY aem.canonical_event_id
    `);
    console.log(`loaded ${pairs.length} pairs`);

    const byEvent = new Map();
    for (const p of pairs) {
      if (!byEvent.has(p.event_id)) byEvent.set(p.event_id, []);
      byEvent.get(p.event_id).push(p);
    }

    const eventIds = [];
    const hhis = [];
    const eclts = [];
    const wireDoms = [];
    const topShares = [];
    const legacyDivs = [];
    let wireDominatedTotal = 0;

    for (const [eventId, articles] of byEvent) {
      if (eventIds.length >= TOTAL_LIMIT) break;
      const c = computeSourceConcentration(articles);
      const legacyDiv = computeLegacyDiversity(articles);
      eventIds.push(eventId);
      hhis.push(c.hhi);
      eclts.push(c.effectiveSourceCount);
      wireDoms.push(c.wireDominated);
      topShares.push(c.topShare);
      legacyDivs.push(legacyDiv);
      if (c.wireDominated) wireDominatedTotal += 1;
    }
    console.log(`computed metrics for ${eventIds.length} events (wireDominated=${wireDominatedTotal})`);

    for (let i = 0; i < eventIds.length; i += UPDATE_BATCH_SIZE) {
      const end = Math.min(i + UPDATE_BATCH_SIZE, eventIds.length);
      await client.query(`
        UPDATE canonical_events a
        SET source_hhi = v.hhi,
            effective_source_count = v.esc,
            wire_dominated = v.wd,
            top_source_share = v.ts,
            source_diversity = v.sd
        FROM UNNEST($1::bigint[], $2::double precision[], $3::double precision[],
                    $4::bool[], $5::double precision[], $6::double precision[])
             AS v(id, hhi, esc, wd, ts, sd)
        WHERE a.id = v.id
      `, [
        eventIds.slice(i, end),
        hhis.slice(i, end),
        eclts.slice(i, end),
        wireDoms.slice(i, end),
        topShares.slice(i, end),
        legacyDivs.slice(i, end),
      ]);
      console.log(`updated ${end}/${eventIds.length}`);
    }

    console.log(`\nFinal: processed=${eventIds.length}, wireDominated=${wireDominatedTotal}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err?.message || err));
  process.exit(1);
});
