#!/usr/bin/env node
/**
 * compute-event-intensity-nowcast.mjs — Phase 2e.
 *
 * Produces a clean eventIntensity nowcast that excludes soft news (low
 * market_relevance) and collapses wire syndication so AP/Reuters reprints
 * do not inflate the count.
 *
 * Normalization: divide by the expected event count at the current hour of
 * day, averaged over the past 30 days. This prevents the Asian trading
 * session blackout from being mistaken for low intensity.
 *
 * Writes into estimated_signal_nowcasts with method='event-intensity-v1'.
 * Observed eventIntensity (from master-pipeline GDELT proxy) is NOT modified.
 */

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { withLock } from './_shared/pipeline-lock.mjs';
import { createLogger } from './_shared/structured-logger.mjs';

const { Client } = pg;
loadOptionalEnvFile();

const logger = createLogger('event-intensity-nowcast');

async function cleanEventCountLastHour(client) {
  // Count canonical events in the last hour whose contributing articles are
  // at least market_relevance='medium' and whose wire duplicates are
  // collapsed by publisher_group.
  const { rows } = await client.query(`
    WITH recent_articles AS (
      SELECT a.id,
             COALESCE(a.publisher_group, a.source) AS publisher,
             a.wire_source,
             aem.canonical_event_id
      FROM articles a
      LEFT JOIN article_event_map aem ON aem.article_id = a.id
      WHERE a.published_at >= NOW() - INTERVAL '1 hour'
        AND (a.market_relevance IN ('high', 'medium') OR a.market_relevance IS NULL)
    ),
    event_source_map AS (
      SELECT canonical_event_id,
             COUNT(DISTINCT COALESCE('wire:' || wire_source, publisher)) AS unique_publishers
      FROM recent_articles
      WHERE canonical_event_id IS NOT NULL
      GROUP BY canonical_event_id
    )
    SELECT COUNT(*)::int AS clean_event_count,
           COALESCE(AVG(unique_publishers), 0) AS avg_sources_per_event
    FROM event_source_map
  `);
  return rows[0] || { clean_event_count: 0, avg_sources_per_event: 0 };
}

async function expectedCountForHour(client, hourOfDay) {
  // 30-day rolling average of clean events at this hour of day.
  const { rows } = await client.query(`
    WITH hourly AS (
      SELECT DATE_TRUNC('hour', a.published_at) AS hour_bucket,
             EXTRACT(HOUR FROM a.published_at) AS hour_of_day,
             COUNT(DISTINCT aem.canonical_event_id)::int AS event_count
      FROM articles a
      JOIN article_event_map aem ON aem.article_id = a.id
      WHERE a.published_at >= NOW() - INTERVAL '30 days'
        AND a.published_at < NOW() - INTERVAL '1 hour'
        AND (a.market_relevance IN ('high', 'medium') OR a.market_relevance IS NULL)
      GROUP BY 1, 2
    )
    SELECT COALESCE(AVG(event_count), 0)::float AS expected,
           COALESCE(STDDEV(event_count), 1)::float AS stddev,
           COUNT(*)::int AS samples
    FROM hourly
    WHERE hour_of_day = $1
  `, [hourOfDay]);
  return rows[0] || { expected: 0, stddev: 1, samples: 0 };
}

export async function runEventIntensityNowcast() {
  return withLock('event-intensity-nowcast', async () => {
    const client = new Client(resolveNasPgConfig());
    await client.connect();
    try {
      const tableCheck = await client.query(`SELECT to_regclass('estimated_signal_nowcasts') AS t`);
      if (!tableCheck.rows?.[0]?.t) {
        return { ok: true, skipped: true };
      }

      const articlesCheck = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'articles' AND column_name IN ('market_relevance', 'wire_source', 'publisher_group')
      `);
      const hasAllColumns = articlesCheck.rows.length === 3;
      if (!hasAllColumns) {
        logger.info('article metadata columns missing; skipping event intensity nowcast');
        return { ok: true, skipped: true, reason: 'article source metadata not yet available' };
      }

      const now = new Date();
      const hour = now.getUTCHours();
      const [observed, expected] = await Promise.all([
        cleanEventCountLastHour(client),
        expectedCountForHour(client, hour),
      ]);

      const expectedCount = Math.max(expected.expected, 1);
      const normalized = observed.clean_event_count / expectedCount;
      const zscore = expected.stddev > 0 ? (observed.clean_event_count - expected.expected) / expected.stddev : 0;
      const intervalHalf = Math.max(0.1, 0.3 * expectedCount);
      const confidence = expected.samples >= 20 ? 0.75 : 0.55;

      const targetTs = now;
      const modelVersion = 'event-intensity-v1';

      await client.query(
        `INSERT INTO estimated_signal_nowcasts (
           signal_name, target_ts, model_version,
           estimated_value, estimate_method, estimate_confidence,
           interval_low, interval_high,
           feature_vintage_at, regime, derived_from_sources,
           input_sources_snapshot
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
         ON CONFLICT (signal_name, target_ts, model_version) DO UPDATE
           SET estimated_value = EXCLUDED.estimated_value,
               estimate_confidence = EXCLUDED.estimate_confidence,
               interval_low = EXCLUDED.interval_low,
               interval_high = EXCLUDED.interval_high,
               feature_vintage_at = EXCLUDED.feature_vintage_at,
               derived_from_sources = EXCLUDED.derived_from_sources,
               input_sources_snapshot = EXCLUDED.input_sources_snapshot`,
        [
          'eventIntensity', targetTs, modelVersion,
          normalized, 'clean-events-over-expected-hourly', confidence,
          Math.max(0, normalized - intervalHalf / expectedCount),
          normalized + intervalHalf / expectedCount,
          now, null,
          JSON.stringify({
            method: 'market_relevance-filtered + wire-collapsed + hour-of-day normalized',
          }),
          JSON.stringify({
            cleanEventCountLastHour: observed.clean_event_count,
            avgSourcesPerEvent: Number(observed.avg_sources_per_event),
            expectedCount: expected.expected,
            expectedStddev: expected.stddev,
            hourSamples: expected.samples,
            hourOfDay: hour,
            zscore,
          }),
        ],
      );
      return {
        ok: true,
        eventCount: observed.clean_event_count,
        expected: expected.expected,
        normalized,
        zscore,
      };
    } catch (err) {
      logger.error('event intensity nowcast failed', { error: err.message });
      return { ok: false, error: err.message };
    } finally {
      await client.end();
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runEventIntensityNowcast().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  });
}
