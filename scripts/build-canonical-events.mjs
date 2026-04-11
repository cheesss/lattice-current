#!/usr/bin/env node
/**
 * build-canonical-events.mjs — 기사를 이벤트 클러스터로 묶기
 *
 * 같은 날 + 같은 테마의 기사들을 embedding cosine similarity로 클러스터링해서
 * canonical_events 테이블에 적재합니다.
 *
 * 알고리즘:
 *   1. (date, theme) 그룹별로 기사를 가져옴
 *   2. 기사가 1개면 → 그대로 1개 이벤트
 *   3. 기사가 2개 이상이면 → embedding cosine similarity 계산
 *      - similarity > THRESHOLD(0.7)이면 같은 이벤트로 묶음
 *      - single-linkage agglomerative clustering
 *   4. 클러스터별로 canonical_event 생성
 *   5. article_event_map에 매핑 저장
 *
 * Usage:
 *   node scripts/build-canonical-events.mjs
 *   node scripts/build-canonical-events.mjs --dry-run
 *   node scripts/build-canonical-events.mjs --threshold 0.65
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
const THRESHOLD_ARG = process.argv.indexOf('--threshold');
const SIMILARITY_THRESHOLD = THRESHOLD_ARG >= 0
  ? Number(process.argv[THRESHOLD_ARG + 1] || 0.7)
  : 0.7;

// ---------------------------------------------------------------------------
// Cosine similarity between two float arrays
// ---------------------------------------------------------------------------
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// ---------------------------------------------------------------------------
// Single-linkage agglomerative clustering by cosine similarity
// ---------------------------------------------------------------------------
function clusterBySimilarity(embeddings, threshold) {
  const n = embeddings.length;
  // Union-Find
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a, b) { parent[find(a)] = find(b); }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (cosineSimilarity(embeddings[i], embeddings[j]) >= threshold) {
        union(i, j);
      }
    }
  }

  // Group by root
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }
  return Array.from(groups.values());
}

// ---------------------------------------------------------------------------
// Parse pgvector string "[0.1,0.2,...]" to float array
// ---------------------------------------------------------------------------
function parseVector(str) {
  if (!str) return null;
  if (typeof str === 'string') {
    const inner = str.replace(/^\[/, '').replace(/\]$/, '');
    return inner.split(',').map(Number);
  }
  if (Array.isArray(str)) return str.map(Number);
  return null;
}

// ---------------------------------------------------------------------------
// Average embedding for a cluster
// ---------------------------------------------------------------------------
function averageEmbedding(embeddings) {
  if (!embeddings.length) return null;
  const dim = embeddings[0].length;
  const avg = new Array(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) avg[i] += emb[i];
  }
  for (let i = 0; i < dim; i++) avg[i] /= embeddings.length;
  return avg;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const client = new pg.Client(PG_CONFIG);
  await client.connect();

  console.log(`build-canonical-events — threshold=${SIMILARITY_THRESHOLD} dry_run=${DRY_RUN}`);

  // Clear existing data for re-run
  if (!DRY_RUN) {
    await client.query('DELETE FROM article_event_map');
    await client.query('DELETE FROM canonical_events');
    console.log('Cleared existing canonical_events data');
  }

  // Get all (date, theme) groups with article count > 0
  const groups = await client.query(`
    SELECT DATE(published_at) as event_date, theme,
           COUNT(*) as cnt
    FROM articles
    WHERE theme IS NOT NULL AND theme != 'unknown'
    GROUP BY DATE(published_at), theme
    ORDER BY event_date, theme
  `);

  console.log(`Processing ${groups.rows.length} (date, theme) groups...`);

  let totalEvents = 0;
  let totalArticlesMapped = 0;
  let batchCount = 0;

  for (const group of groups.rows) {
    const { event_date, theme, cnt } = group;
    const dateStr = event_date.toISOString().slice(0, 10);

    // Fetch articles for this group
    const articles = await client.query(`
      SELECT id, title, source, embedding::text as embedding
      FROM articles
      WHERE DATE(published_at) = $1 AND theme = $2
      ORDER BY id
    `, [event_date, theme]);

    const rows = articles.rows;

    if (rows.length === 0) continue;

    // Single article → single event
    if (rows.length === 1) {
      const r = rows[0];
      const emb = parseVector(r.embedding);
      if (!DRY_RUN) {
        const ins = await client.query(`
          INSERT INTO canonical_events (event_date, theme, representative_title, source_count, source_diversity, article_count, avg_embedding)
          VALUES ($1, $2, $3, 1, 1.0, 1, $4)
          RETURNING id
        `, [event_date, theme, r.title, emb ? `[${emb.join(',')}]` : null]);
        await client.query(
          'INSERT INTO article_event_map (article_id, canonical_event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [r.id, ins.rows[0].id]
        );
      }
      totalEvents++;
      totalArticlesMapped++;
      continue;
    }

    // Multiple articles → cluster by embedding similarity
    const embeddings = rows.map(r => parseVector(r.embedding));
    const hasAllEmbeddings = embeddings.every(e => e !== null);

    let clusters;
    if (hasAllEmbeddings) {
      clusters = clusterBySimilarity(embeddings, SIMILARITY_THRESHOLD);
    } else {
      // No embeddings → all articles = 1 event
      clusters = [rows.map((_, i) => i)];
    }

    for (const clusterIndices of clusters) {
      const clusterRows = clusterIndices.map(i => rows[i]);
      const sources = new Set(clusterRows.map(r => r.source));
      const longestTitle = clusterRows.reduce((a, b) =>
        (a.title?.length || 0) >= (b.title?.length || 0) ? a : b
      ).title;

      const clusterEmbeddings = clusterIndices
        .map(i => embeddings[i])
        .filter(e => e !== null);
      const avgEmb = averageEmbedding(clusterEmbeddings);

      if (!DRY_RUN) {
        const ins = await client.query(`
          INSERT INTO canonical_events (event_date, theme, representative_title, source_count, source_diversity, article_count, avg_embedding)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `, [
          event_date, theme, longestTitle,
          sources.size,
          Number((sources.size / clusterRows.length).toFixed(3)),
          clusterRows.length,
          avgEmb ? `[${avgEmb.join(',')}]` : null,
        ]);

        const eventId = ins.rows[0].id;
        for (const r of clusterRows) {
          await client.query(
            'INSERT INTO article_event_map (article_id, canonical_event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [r.id, eventId]
          );
        }
      }

      totalEvents++;
      totalArticlesMapped += clusterRows.length;
    }

    batchCount++;
    if (batchCount % 200 === 0) {
      console.log(`  ... ${batchCount}/${groups.rows.length} groups processed, ${totalEvents} events so far`);
    }
  }

  // Update labeled_outcomes with canonical_event_id
  if (!DRY_RUN) {
    console.log('\nLinking labeled_outcomes to canonical events...');
    await client.query(`
      UPDATE labeled_outcomes lo
      SET canonical_event_id = aem.canonical_event_id
      FROM article_event_map aem
      WHERE lo.article_id = aem.article_id
        AND lo.canonical_event_id IS NULL
    `);
    const linked = await client.query('SELECT COUNT(*) as cnt FROM labeled_outcomes WHERE canonical_event_id IS NOT NULL');
    console.log(`  ${linked.rows[0].cnt} labeled_outcomes linked to canonical events`);
  }

  console.log(`\nDone. ${totalEvents} canonical events from ${totalArticlesMapped} articles`);
  console.log(`Compression ratio: ${totalArticlesMapped} articles → ${totalEvents} events (${(totalArticlesMapped / totalEvents).toFixed(1)}x)`);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
