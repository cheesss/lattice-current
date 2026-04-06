#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig, resolveOllamaChatConfig } from './_shared/nas-runtime.mjs';
import { ensureArticleAnalysisTables } from './_shared/article-analysis-schema.mjs';
import { normalizeText, tokenizeText } from './_shared/text-keywords.mjs';

loadOptionalEnvFile();

const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();
const BATCH_SIZE = 10;
const PROGRESS_INTERVAL = 25;

export function parseArgs(argv = process.argv.slice(2)) {
  const result = {
    limit: 0,
    since: null,
    mode: 'ambiguous',
    confidenceThreshold: 0.45,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--limit' && argv[index + 1]) result.limit = parseInt(argv[++index], 10);
    else if (arg === '--since' && argv[index + 1]) result.since = argv[++index];
    else if (arg === '--mode' && argv[index + 1]) result.mode = argv[++index];
    else if (arg === '--confidence-threshold' && argv[index + 1]) result.confidenceThreshold = parseFloat(argv[++index]);
  }

  return result;
}

async function chatOllama(prompt) {
  const { endpoint, model } = resolveOllamaChatConfig();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`Ollama ${response.status}: ${await response.text()}`);
  }

  const result = await response.json();
  return result.message?.content || '';
}

function buildPrompt(article) {
  const keywordHint = Array.isArray(article.existing_keywords) && article.existing_keywords.length > 0
    ? `Existing fast-path keywords: ${article.existing_keywords.join(', ')}\n`
    : '';

  return `Extract the following from this news headline. Respond only with valid JSON.\n\nHeadline: "${article.title}"\n${keywordHint}Return JSON with exactly these fields:\n{\n  "keywords": ["keyword1", "keyword2"],\n  "entities": {\n    "companies": ["Company Name"],\n    "countries": ["Country Name"],\n    "persons": ["Person Name"],\n    "tickers": ["TICKER"]\n  },\n  "theme": "conflict|tech|energy|economy|politics|health|environment|finance|other",\n  "sentiment": "positive|negative|neutral",\n  "confidence": 0.0\n}\n\nRules:\n- keywords: 5-8 important terms\n- theme: single best category\n- confidence: 0.0-1.0\n- no markdown, no prose`;
}

const META_KEYWORD_STOPWORDS = new Set(['keyword', 'keywords', 'headline', 'latest', 'here', 'fast', 'path', 'fast-path']);

export function filterKeywordsToHeadline(keywords, article) {
  const headlineTokens = new Set(tokenizeText(article.title || ''));
  const existingTokens = new Set((article.existing_keywords || []).map((value) => normalizeText(value)));
  return keywords.filter((keyword) => {
    const normalized = normalizeText(keyword);
    if (!normalized || META_KEYWORD_STOPWORDS.has(normalized)) return false;
    return headlineTokens.has(normalized) || existingTokens.has(normalized);
  });
}

function parseAnalysis(raw, article) {
  let text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    text = text.slice(start, end + 1);
  }

  const parsed = JSON.parse(text);
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords.map((value) => String(value).trim()).filter(Boolean).slice(0, 12)
    : [];
  const entities = {
    companies: Array.isArray(parsed.entities?.companies) ? parsed.entities.companies.map(String) : [],
    countries: Array.isArray(parsed.entities?.countries) ? parsed.entities.countries.map(String) : [],
    persons: Array.isArray(parsed.entities?.persons) ? parsed.entities.persons.map(String) : [],
    tickers: Array.isArray(parsed.entities?.tickers) ? parsed.entities.tickers.map(String) : [],
  };
  const sentiment = ['positive', 'negative', 'neutral'].includes(parsed.sentiment)
    ? parsed.sentiment
    : 'neutral';
  const theme = typeof parsed.theme === 'string' ? parsed.theme.toLowerCase().trim() : 'other';
  const confidence = Number.isFinite(Number(parsed.confidence))
    ? Math.min(1, Math.max(0, Number(parsed.confidence)))
    : 0.5;

  return {
    keywords: filterKeywordsToHeadline(keywords, article),
    entities,
    sentiment,
    theme,
    confidence,
  };
}

function buildSelectionQuery(options) {
  const conditions = ['a.title IS NOT NULL', 'LENGTH(a.title) >= 10'];
  const params = [];

  if (options.since) {
    params.push(options.since);
    conditions.push(`a.published_at >= $${params.length}::timestamptz`);
  }

  if (options.mode === 'unanalyzed') {
    conditions.push('aa.article_id IS NULL');
  } else if (options.mode === 'all') {
    // no extra filter
  } else {
    params.push(options.confidenceThreshold);
    conditions.push(`(
      aa.article_id IS NULL
      OR aa.method = 'fast-keyword-extractor'
      OR COALESCE(aa.confidence, 0) <= $${params.length}
    )`);
  }

  let limitClause = '';
  if (options.limit > 0) {
    params.push(options.limit);
    limitClause = `LIMIT $${params.length}`;
  }

  return {
    sql: `
      SELECT
        a.id,
        a.title,
        a.theme,
        aa.keywords AS existing_keywords,
        aa.confidence AS existing_confidence
      FROM articles a
      LEFT JOIN article_analysis aa ON aa.article_id = a.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(aa.confidence, 0) ASC, a.published_at DESC
      ${limitClause}
    `,
    params,
  };
}

async function upsertTrendKeyword(client, keyword) {
  const normalized = keyword.toLowerCase().trim();
  if (!normalized) return;
  await client.query(`
    INSERT INTO auto_trend_keywords (keyword, source, article_count, score, first_seen, last_seen, metadata)
    VALUES ($1, 'ollama-article-analyzer', 1, 1, CURRENT_DATE, CURRENT_DATE, '{}'::jsonb)
    ON CONFLICT (keyword) DO UPDATE SET
      article_count = auto_trend_keywords.article_count + 1,
      score = auto_trend_keywords.score + 1,
      last_seen = CURRENT_DATE,
      source = EXCLUDED.source,
      updated_at = NOW()
  `, [normalized]);
}

async function processBatch(client, articles, stats) {
  for (const article of articles) {
    try {
      const raw = await chatOllama(buildPrompt(article));
      const analysis = parseAnalysis(raw, article);
      await client.query(`
        INSERT INTO article_analysis (
          article_id, keywords, entities, sentiment, confidence, theme, method, metadata, analyzed_at
        )
        VALUES ($1, $2, $3::jsonb, $4, $5, $6, 'ollama-article-analyzer', $7::jsonb, NOW())
        ON CONFLICT (article_id) DO UPDATE SET
          keywords = EXCLUDED.keywords,
          entities = EXCLUDED.entities,
          sentiment = EXCLUDED.sentiment,
          confidence = EXCLUDED.confidence,
          theme = EXCLUDED.theme,
          method = EXCLUDED.method,
          metadata = EXCLUDED.metadata,
          analyzed_at = NOW()
      `, [
        article.id,
        analysis.keywords,
        JSON.stringify(analysis.entities),
        analysis.sentiment,
        analysis.confidence,
        analysis.theme || article.theme || null,
        JSON.stringify({
          upgradedFrom: article.existing_confidence ?? null,
          existingKeywords: article.existing_keywords || [],
        }),
      ]);

      for (const keyword of analysis.keywords) {
        await upsertTrendKeyword(client, keyword);
      }

      stats.total += 1;
      stats.sentiments[analysis.sentiment] = (stats.sentiments[analysis.sentiment] || 0) + 1;
      for (const keyword of analysis.keywords) {
        const normalized = keyword.toLowerCase().trim();
        stats.keywords[normalized] = (stats.keywords[normalized] || 0) + 1;
      }

      if (stats.total % PROGRESS_INTERVAL === 0) {
        process.stdout.write(`  analyzed ${stats.total} articles\n`);
      }
    } catch (error) {
      stats.errors += 1;
      if (stats.errors <= 5) {
        process.stderr.write(`  [skip] article ${article.id}: ${String(error?.message || error).slice(0, 120)}\n`);
      }
    }
  }
}

export async function runOllamaArticleAnalyzer(options = {}) {
  const client = new Client(PG_CONFIG);
  await client.connect();

  try {
    await ensureArticleAnalysisTables(client);
    const selection = buildSelectionQuery(options);
    const { rows } = await client.query(selection.sql, selection.params);

    const stats = {
      total: 0,
      errors: 0,
      sentiments: {},
      keywords: {},
    };

    const startedAt = Date.now();
    for (let index = 0; index < rows.length; index += BATCH_SIZE) {
      await processBatch(client, rows.slice(index, index + BATCH_SIZE), stats);
    }

    const topKeywords = Object.entries(stats.keywords)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([keyword, count]) => ({ keyword, count }));

    return {
      selectedCount: rows.length,
      analyzedCount: stats.total,
      errorCount: stats.errors,
      elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      topKeywords,
      sentiments: stats.sentiments,
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const options = parseArgs();
  const { endpoint, model } = resolveOllamaChatConfig();
  process.stdout.write(`Using ${model} at ${endpoint}\n`);
  const result = await runOllamaArticleAnalyzer(options);
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
