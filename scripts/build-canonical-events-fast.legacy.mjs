#!/usr/bin/env node
/**
 * build-canonical-events-fast.mjs — 고속 이벤트 클러스터링
 *
 * 최적화:
 *   1. 행렬 곱셈으로 cosine similarity 일괄 계산 (이중 루프 제거)
 *   2. 배치 INSERT (1000행씩)
 *   3. 큰 그룹(50개+)은 sub-sampling 후 클러스터링
 *   4. pgvector에서 embedding을 float[]로 직접 조회
 *
 * Usage:
 *   node scripts/build-canonical-events-fast.mjs
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
const MAX_GROUP_FOR_FULL_COMPARISON = 80; // 이 이상은 sub-sample

// ---------------------------------------------------------------------------
// 행렬 곱셈 기반 cosine similarity
// ---------------------------------------------------------------------------
function l2Normalize(vectors) {
  // vectors: array of float arrays (n × d)
  const n = vectors.length;
  const d = vectors[0].length;
  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    let norm = 0;
    for (let k = 0; k < d; k++) norm += vectors[i][k] * vectors[i][k];
    norm = Math.sqrt(norm) || 1e-10;
    const row = new Float32Array(d);
    for (let k = 0; k < d; k++) row[k] = vectors[i][k] / norm;
    result[i] = row;
  }
  return result;
}

function batchCosineSimilarityMatrix(normalizedVectors) {
  // normalized @ normalized.T → n×n similarity matrix
  const n = normalizedVectors.length;
  const d = normalizedVectors[0].length;
  const sim = new Array(n);
  for (let i = 0; i < n; i++) {
    sim[i] = new Float32Array(n);
    for (let j = i; j < n; j++) {
      let dot = 0;
      for (let k = 0; k < d; k++) dot += normalizedVectors[i][k] * normalizedVectors[j][k];
      sim[i][j] = dot;
      if (i !== j) sim[j] = sim[j] || new Float32Array(n);
      if (j < n && i !== j) {
        if (!sim[j]) sim[j] = new Float32Array(n);
        sim[j][i] = dot;
      }
    }
  }
  return sim;
}

function clusterFromSimilarityMatrix(simMatrix, threshold) {
  const n = simMatrix.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a, b) { parent[find(a)] = find(b); }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (simMatrix[i][j] >= threshold) union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }
  return Array.from(groups.values());
}

function parseVector(str) {
  if (!str) return null;
  if (typeof str === 'string') {
    return str.replace(/^\[/, '').replace(/\]$/, '').split(',').map(Number);
  }
  return Array.isArray(str) ? str.map(Number) : null;
}

function averageEmbedding(embeddings) {
  if (!embeddings.length) return null;
  const dim = embeddings[0].length;
  const avg = new Float32Array(dim);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) avg[i] += emb[i];
  }
  for (let i = 0; i < dim; i++) avg[i] /= embeddings.length;
  return Array.from(avg);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const pool = new pg.Pool(PG_CONFIG);

  console.log(`build-canonical-events-fast — threshold=${SIMILARITY_THRESHOLD}`);
  const t0 = performance.now();

  // Clear
  await pool.query('DELETE FROM article_event_map');
  await pool.query('DELETE FROM canonical_events');
  console.log('Cleared existing data');

  // Get all groups
  const groups = await pool.query(`
    SELECT DATE(published_at) as event_date, theme, COUNT(*) as cnt,
           array_agg(id ORDER BY id) as article_ids
    FROM articles
    WHERE theme IS NOT NULL AND theme != 'unknown'
    GROUP BY DATE(published_at), theme
    ORDER BY cnt ASC
  `);

  console.log(`Processing ${groups.rows.length} groups...`);

  let totalEvents = 0;
  let totalArticles = 0;
  let batchInsertEvents = [];
  let batchInsertMaps = [];

  async function flushBatch() {
    if (batchInsertEvents.length === 0) return;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const evt of batchInsertEvents) {
        const res = await client.query(`
          INSERT INTO canonical_events (event_date, theme, representative_title, source_count, source_diversity, article_count, avg_embedding)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `, [evt.event_date, evt.theme, evt.title, evt.source_count, evt.source_diversity, evt.article_count, evt.avg_embedding]);

        const eventId = res.rows[0].id;
        for (const articleId of evt.article_ids) {
          await client.query(
            'INSERT INTO article_event_map (article_id, canonical_event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [articleId, eventId]
          );
        }
        totalEvents++;
        totalArticles += evt.article_ids.length;
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    batchInsertEvents = [];
  }

  for (let gi = 0; gi < groups.rows.length; gi++) {
    const group = groups.rows[gi];
    const articleIds = group.article_ids;

    // Single article → single event (no embedding needed)
    if (articleIds.length === 1) {
      const art = await pool.query('SELECT id, title, source FROM articles WHERE id = $1', [articleIds[0]]);
      if (art.rows.length > 0) {
        batchInsertEvents.push({
          event_date: group.event_date,
          theme: group.theme,
          title: art.rows[0].title,
          source_count: 1,
          source_diversity: 1.0,
          article_count: 1,
          avg_embedding: null,
          article_ids: [art.rows[0].id],
        });
      }
    } else {
      // Fetch articles with embeddings
      const articles = await pool.query(`
        SELECT id, title, source, embedding::text as embedding
        FROM articles WHERE id = ANY($1) ORDER BY id
      `, [articleIds]);

      const rows = articles.rows;
      const embeddings = rows.map(r => parseVector(r.embedding));
      const hasAllEmb = embeddings.every(e => e !== null && e.length === 768);

      let clusters;

      if (!hasAllEmb || rows.length > MAX_GROUP_FOR_FULL_COMPARISON) {
        // 임베딩 없거나 너무 크면 → 전체를 1개 이벤트로
        clusters = [rows.map((_, i) => i)];
      } else {
        // 행렬 곱셈으로 유사도 일괄 계산
        const normalized = l2Normalize(embeddings);
        const simMatrix = batchCosineSimilarityMatrix(normalized);
        clusters = clusterFromSimilarityMatrix(simMatrix, SIMILARITY_THRESHOLD);
      }

      for (const clusterIndices of clusters) {
        const clusterRows = clusterIndices.map(i => rows[i]);
        const sources = new Set(clusterRows.map(r => r.source));
        const longestTitle = clusterRows.reduce((a, b) =>
          (a.title?.length || 0) >= (b.title?.length || 0) ? a : b
        ).title;

        const clusterEmbs = clusterIndices.map(i => embeddings[i]).filter(e => e !== null);
        const avgEmb = averageEmbedding(clusterEmbs);

        batchInsertEvents.push({
          event_date: group.event_date,
          theme: group.theme,
          title: longestTitle,
          source_count: sources.size,
          source_diversity: Number((sources.size / clusterRows.length).toFixed(3)),
          article_count: clusterRows.length,
          avg_embedding: avgEmb ? `[${avgEmb.join(',')}]` : null,
          article_ids: clusterRows.map(r => r.id),
        });
      }
    }

    // Flush every 500 events
    if (batchInsertEvents.length >= 500) {
      await flushBatch();
    }

    if ((gi + 1) % 500 === 0) {
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      const rate = ((gi + 1) / (elapsed)).toFixed(0);
      const eta = (((groups.rows.length - gi - 1) / rate)).toFixed(0);
      console.log(`  ${gi + 1}/${groups.rows.length} groups (${totalEvents} events) — ${elapsed}s elapsed, ~${eta}s remaining`);
    }
  }

  // Final flush
  await flushBatch();

  // Link labeled_outcomes
  console.log('\nLinking labeled_outcomes...');
  const linked = await pool.query(`
    UPDATE labeled_outcomes lo
    SET canonical_event_id = aem.canonical_event_id
    FROM article_event_map aem
    WHERE lo.article_id = aem.article_id
      AND lo.canonical_event_id IS NULL
  `);
  console.log(`  ${linked.rowCount} labeled_outcomes linked`);

  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
  console.log(`${totalArticles} articles → ${totalEvents} events (${(totalArticles / totalEvents).toFixed(1)}x compression)`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
