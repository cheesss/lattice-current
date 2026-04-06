#!/usr/bin/env node
/**
 * inject-articles-to-raw-items.mjs
 * articles 테이블 → raw_items 테이블로 변환 INSERT
 * replay_frames 재빌드를 위해 Guardian/NYT 기사를 raw_items에 뉴스 항목으로 추가
 */
import pg from 'pg';
import { resolveNasPgConfig } from './_shared/nas-runtime.mjs';

const { Client } = pg;

const PG_CONFIG = resolveNasPgConfig();

async function main() {
  const client = new Client(PG_CONFIG);
  await client.connect();

  // Check existing article-sourced raw_items
  const existing = await client.query("SELECT COUNT(*) FROM raw_items WHERE provider IN ('guardian','nyt')");
  console.log('기존 guardian/nyt raw_items:', existing.rows[0].count);

  // Get articles not yet in raw_items
  const articles = await client.query(`
    SELECT a.id, a.source, a.theme, a.published_at, a.title, a.summary, a.url
    FROM articles a
    WHERE a.published_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM raw_items r 
        WHERE r.id = 'article-' || a.id::text
      )
    ORDER BY a.published_at
  `);
  console.log('변환 대상:', articles.rows.length, '건');

  const BATCH = 200;
  let inserted = 0;

  for (let i = 0; i < articles.rows.length; i += BATCH) {
    const batch = articles.rows.slice(i, i + BATCH);
    const values = [];
    const placeholders = [];
    let idx = 1;

    for (const a of batch) {
      const id = 'article-' + a.id;
      const datasetId = a.source + '-archive';
      const validTimeStart = a.published_at;
      const headline = a.title || '';
      const payload = JSON.stringify({
        source: a.source,
        theme: a.theme,
        summary: a.summary || '',
        url: a.url || '',
      });

      placeholders.push(`($${idx},$${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5},$${idx+6},$${idx+7},$${idx+8},$${idx+9})`);
      values.push(
        id,              // id
        datasetId,       // dataset_id
        a.source,        // provider
        'news-api',      // source_kind
        a.source,        // source_id
        'news',          // item_kind
        validTimeStart,  // valid_time_start
        validTimeStart,  // valid_time_end
        headline,        // headline
        payload,         // payload_json
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

    if ((i + BATCH) % 2000 === 0 || i + BATCH >= articles.rows.length) {
      const pct = Math.floor(((i + BATCH) / articles.rows.length) * 100);
      process.stderr.write(`\r  ${Math.min(i + BATCH, articles.rows.length)}/${articles.rows.length} (${pct}%)`);
    }
  }

  // Verify
  const total = await client.query("SELECT provider, COUNT(*) as cnt FROM raw_items WHERE provider IN ('guardian','nyt') GROUP BY provider");
  console.log('\n\n=== 결과 ===');
  total.rows.forEach(r => console.log(r.provider + ':', r.cnt));

  const newsRange = await client.query("SELECT MIN(valid_time_start) as mn, MAX(valid_time_start) as mx FROM raw_items WHERE provider IN ('guardian','nyt')");
  console.log('기간:', String(newsRange.rows[0].mn).slice(0,10), '~', String(newsRange.rows[0].mx).slice(0,10));

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
