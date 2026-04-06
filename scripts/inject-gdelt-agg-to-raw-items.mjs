#!/usr/bin/env node
/**
 * inject-gdelt-agg-to-raw-items.mjs
 * gdelt_daily_agg → raw_items로 변환
 * 날짜별 국가별 이벤트 집계를 "합성 뉴스 항목"으로 변환하여 replay_frames에 포함되도록
 */
import pg from 'pg';
import { SIGNAL_CAMEO_ROOTS } from './_shared/gdelt-cameo.mjs';
import { resolveNasPgConfig } from './_shared/nas-runtime.mjs';

const { Client } = pg;

const PG_CONFIG = resolveNasPgConfig();

async function main() {
  const client = new Client(PG_CONFIG);
  await client.connect();

  const existing = await client.query("SELECT COUNT(*) FROM raw_items WHERE provider = 'gdelt-agg'");
  console.log('기존 gdelt-agg raw_items:', existing.rows[0].count);

  // Get daily aggregations grouped by date, only signal-relevant CAMEO codes
  // Aggregate per day: sum events, avg goldstein, avg tone across all countries
  const signalRootsSql = SIGNAL_CAMEO_ROOTS.map((_, index) => `$${index + 1}`).join(',');
  const days = await client.query(`
    SELECT
      date,
      SUM(event_count) as total_events,
      AVG(avg_goldstein) as avg_goldstein,
      AVG(avg_tone) as avg_tone,
      SUM(num_sources) as total_sources,
      COUNT(DISTINCT country) as country_count,
      ARRAY_AGG(DISTINCT country ORDER BY country) as countries
    FROM gdelt_daily_agg
    WHERE cameo_root IN (${signalRootsSql})
      AND event_count > 0
    GROUP BY date
    HAVING SUM(event_count) >= 5
    ORDER BY date
  `, SIGNAL_CAMEO_ROOTS);
  console.log('변환 대상 일수:', days.rows.length);

  const BATCH = 200;
  let inserted = 0;

  for (let i = 0; i < days.rows.length; i += BATCH) {
    const batch = days.rows.slice(i, i + BATCH);
    const values = [];
    const placeholders = [];
    let idx = 1;

    for (const day of batch) {
      const dateStr = new Date(day.date).toISOString();
      const id = 'gdelt-agg-' + dateStr.slice(0, 10);
      const goldstein = Number(day.avg_goldstein).toFixed(2);
      const tone = Number(day.avg_tone).toFixed(2);
      const events = Number(day.total_events);
      const countries = day.countries.slice(0, 10).join(',');

      const headline = `GDELT: ${events} conflict/tension events across ${day.country_count} countries (goldstein=${goldstein}, tone=${tone})`;
      const payload = JSON.stringify({
        source: 'gdelt-aggregated',
        eventCount: events,
        avgGoldstein: Number(goldstein),
        avgTone: Number(tone),
        totalSources: Number(day.total_sources),
        countryCount: Number(day.country_count),
        countries: countries,
      });

      placeholders.push(`($${idx},$${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5},$${idx+6},$${idx+7},$${idx+8},$${idx+9})`);
      values.push(
        id,                // id
        'gdelt-agg',       // dataset_id
        'gdelt-agg',       // provider
        'aggregated',      // source_kind
        'gdelt',           // source_id
        'event-summary',   // item_kind
        dateStr,           // valid_time_start
        dateStr,           // valid_time_end
        headline,          // headline
        payload,           // payload_json
      );
      idx += 10;
    }

    if (placeholders.length > 0) {
      await client.query(`
        INSERT INTO raw_items (id, dataset_id, provider, source_kind, source_id, item_kind, valid_time_start, valid_time_end, headline, payload_json)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (id) DO NOTHING
      `, values);
      inserted += batch.length;
    }

    if ((i + BATCH) % 1000 === 0 || i + BATCH >= days.rows.length) {
      process.stderr.write(`\r  ${Math.min(i + BATCH, days.rows.length)}/${days.rows.length}`);
    }
  }

  const total = await client.query("SELECT COUNT(*) FROM raw_items WHERE provider = 'gdelt-agg'");
  const range = await client.query("SELECT MIN(valid_time_start) as mn, MAX(valid_time_start) as mx FROM raw_items WHERE provider = 'gdelt-agg'");
  console.log('\n\n=== 결과 ===');
  console.log('gdelt-agg raw_items:', total.rows[0].count);
  console.log('기간:', String(range.rows[0].mn).slice(0, 10), '~', String(range.rows[0].mx).slice(0, 10));

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
