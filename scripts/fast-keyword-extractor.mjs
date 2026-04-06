#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureArticleAnalysisTables } from './_shared/article-analysis-schema.mjs';
import { buildFastArticleAnalysis, collectTrendKeywordStats } from './_shared/text-keywords.mjs';

loadOptionalEnvFile();

const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();
const DEFAULT_BATCH_SIZE = 500;

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    limit: 0,
    since: null,
    batchSize: DEFAULT_BATCH_SIZE,
    minTrendCount: 3,
    refreshExisting: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--limit' && argv[index + 1]) parsed.limit = Number(argv[++index]);
    else if (arg === '--since' && argv[index + 1]) parsed.since = argv[++index];
    else if (arg === '--batch-size' && argv[index + 1]) parsed.batchSize = Number(argv[++index]);
    else if (arg === '--min-trend-count' && argv[index + 1]) parsed.minTrendCount = Number(argv[++index]);
    else if (arg === '--refresh-existing') parsed.refreshExisting = true;
  }

  return parsed;
}

function buildArticleQuery(options) {
  const conditions = ['a.title IS NOT NULL', 'LENGTH(a.title) >= 10'];
  const params = [];

  if (!options.refreshExisting) {
    conditions.push(`NOT EXISTS (
      SELECT 1
      FROM article_analysis aa
      WHERE aa.article_id = a.id
        AND aa.method IN ('fast-keyword-extractor', 'ollama-article-analyzer')
    )`);
  }

  if (options.since) {
    params.push(options.since);
    conditions.push(`a.published_at >= $${params.length}::timestamptz`);
  }

  let limitClause = '';
  if (options.limit > 0) {
    params.push(options.limit);
    limitClause = `LIMIT $${params.length}`;
  }

  return {
    sql: `
      SELECT a.id, a.title, a.summary, a.theme, a.published_at
      FROM articles a
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.published_at DESC
      ${limitClause}
    `,
    params,
  };
}

async function upsertArticleAnalysis(client, rows) {
  if (rows.length === 0) return;

  const values = [];
  const placeholders = rows.map((row, rowIndex) => {
    const base = rowIndex * 8;
    values.push(
      row.articleId,
      row.keywords,
      JSON.stringify(row.entities),
      row.sentiment,
      row.confidence,
      row.theme,
      row.method,
      JSON.stringify(row.metadata),
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}::jsonb, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}::jsonb, NOW())`;
  }).join(',\n');

  await client.query(`
    INSERT INTO article_analysis (
      article_id, keywords, entities, sentiment, confidence, theme, method, metadata, analyzed_at
    )
    VALUES ${placeholders}
    ON CONFLICT (article_id) DO UPDATE SET
      keywords = EXCLUDED.keywords,
      entities = EXCLUDED.entities,
      sentiment = EXCLUDED.sentiment,
      confidence = EXCLUDED.confidence,
      theme = EXCLUDED.theme,
      method = EXCLUDED.method,
      metadata = EXCLUDED.metadata,
      analyzed_at = NOW()
  `, values);
}

async function upsertTrendKeywords(client, entries) {
  if (entries.length === 0) return;

  const chunkSize = 1000;
  for (let offset = 0; offset < entries.length; offset += chunkSize) {
    const chunk = entries.slice(offset, offset + chunkSize);
    const values = [];
    const placeholders = chunk.map((entry, index) => {
      const base = index * 6;
      values.push(
        entry.keyword,
        'fast-keyword-extractor',
        entry.articleCount,
        entry.score,
        entry.firstSeen,
        entry.lastSeen,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::date, $${base + 6}::date, NOW(), '{}'::jsonb)`;
    }).join(',\n');

    await client.query(`
      INSERT INTO auto_trend_keywords (
        keyword, source, article_count, score, first_seen, last_seen, updated_at, metadata
      )
      VALUES ${placeholders}
      ON CONFLICT (keyword) DO UPDATE SET
        article_count = GREATEST(auto_trend_keywords.article_count, EXCLUDED.article_count),
        score = GREATEST(auto_trend_keywords.score, EXCLUDED.score),
        first_seen = LEAST(auto_trend_keywords.first_seen, EXCLUDED.first_seen),
        last_seen = GREATEST(auto_trend_keywords.last_seen, EXCLUDED.last_seen),
        source = EXCLUDED.source,
        updated_at = NOW()
    `, values);
  }
}

export async function runFastKeywordExtraction(options = {}) {
  const client = new Client(PG_CONFIG);
  await client.connect();

  try {
    await ensureArticleAnalysisTables(client);
    const { sql, params } = buildArticleQuery(options);
    const { rows } = await client.query(sql, params);
    const analyses = [];
    const analysisRows = [];

    for (let index = 0; index < rows.length; index += 1) {
      const article = rows[index];
      const analysis = buildFastArticleAnalysis(article);
      analysisRows.push({ publishedAt: article.published_at, ...analysis });
      analyses.push({
        articleId: article.id,
        publishedAt: article.published_at,
        ...analysis,
      });

      if (analyses.length >= options.batchSize) {
        await upsertArticleAnalysis(client, analyses.splice(0, analyses.length));
      }
    }

    if (analyses.length > 0) {
      await upsertArticleAnalysis(client, analyses.splice(0, analyses.length));
    }

    const trendEntries = collectTrendKeywordStats(analysisRows, options.minTrendCount);
    await upsertTrendKeywords(client, trendEntries);

    const [{ rows: analysisSummary }, { rows: trendSummary }] = await Promise.all([
      client.query(`
        SELECT COUNT(*)::int AS count
        FROM article_analysis
        WHERE method = 'fast-keyword-extractor'
      `),
      client.query(`
        SELECT COUNT(*)::int AS count
        FROM auto_trend_keywords
        WHERE source = 'fast-keyword-extractor'
      `),
    ]);

    return {
      processedCount: rows.length,
      articleAnalysisCount: Number(analysisSummary[0]?.count || 0),
      trendKeywordCount: Number(trendSummary[0]?.count || 0),
      topTrendKeywords: trendEntries.slice(0, 10),
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const options = parseArgs();
  const result = await runFastKeywordExtraction(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const entryHref = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (entryHref && import.meta.url === entryHref) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || error}\n`);
    process.exit(1);
  });
}
