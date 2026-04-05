#!/usr/bin/env node
/**
 * ollama-article-analyzer.mjs — 기사 제목 분석 (Ollama LLM, 비용 $0)
 *
 * 로컬 Ollama gemma3:4b를 사용하여 기사 제목에서 추출:
 * - 키워드 (핵심 용어 5-8개)
 * - 엔티티 (회사명, 국가명, 인물명, 티커 심볼)
 * - 테마 분류
 * - 감성 분석 (positive / negative / neutral)
 *
 * Usage:
 *   node --import tsx scripts/ollama-article-analyzer.mjs              # 미처리 기사 분석
 *   node --import tsx scripts/ollama-article-analyzer.mjs --limit 100  # 배치 크기 제한
 *   node --import tsx scripts/ollama-article-analyzer.mjs --since 2025-01-01
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

const OLLAMA_URL = (process.env.OLLAMA_API_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || 'gemma3:4b';
const BATCH_SIZE = 10;
const PROGRESS_INTERVAL = 50;

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { limit: 0, since: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) result.limit = parseInt(args[++i]);
    if (args[i] === '--since' && args[i + 1]) result.since = args[++i];
  }
  return result;
}

/**
 * Send a chat prompt to the local Ollama instance and return the text response.
 */
async function chatOllama(prompt) {
  const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${await resp.text()}`);
  const result = await resp.json();
  return result.message?.content || '';
}

/**
 * Build the analysis prompt for a single headline.
 */
function buildPrompt(title) {
  return `Extract the following from this news headline. Respond ONLY with valid JSON, no explanation.

Headline: "${title}"

Return JSON with exactly these fields:
{
  "keywords": ["keyword1", "keyword2", ...],
  "entities": {
    "companies": ["Company Name"],
    "countries": ["Country Name"],
    "persons": ["Person Name"],
    "tickers": ["TICKER"]
  },
  "theme": "one of: conflict, tech, energy, economy, politics, health, environment, finance, other",
  "sentiment": "positive or negative or neutral",
  "confidence": 0.0 to 1.0
}

Rules:
- keywords: 5-8 important terms from the headline
- entities: extract company names, country names, person names, ticker symbols. Use empty arrays if none found.
- theme: pick the single best category
- sentiment: the overall tone of the headline
- confidence: how confident you are in the analysis (0.0-1.0)`;
}

/**
 * Attempt to parse the LLM response as JSON. Handles common quirks like
 * markdown code blocks or trailing text outside the JSON object.
 */
function parseAnalysis(raw) {
  let text = raw.trim();

  // Strip markdown code fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();

  // Try to isolate the JSON object
  const objStart = text.indexOf('{');
  const objEnd = text.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) {
    text = text.slice(objStart, objEnd + 1);
  }

  const parsed = JSON.parse(text);

  // Normalise / validate fields
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords.map(String).filter(k => k.length > 0).slice(0, 12)
    : [];

  const entities = {
    companies: Array.isArray(parsed.entities?.companies) ? parsed.entities.companies.map(String) : [],
    countries: Array.isArray(parsed.entities?.countries) ? parsed.entities.countries.map(String) : [],
    persons: Array.isArray(parsed.entities?.persons) ? parsed.entities.persons.map(String) : [],
    tickers: Array.isArray(parsed.entities?.tickers) ? parsed.entities.tickers.map(String) : [],
  };

  const validSentiments = new Set(['positive', 'negative', 'neutral']);
  const sentiment = validSentiments.has(parsed.sentiment) ? parsed.sentiment : 'neutral';

  let confidence = parseFloat(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) confidence = 0.5;

  const theme = typeof parsed.theme === 'string' ? parsed.theme.toLowerCase().trim() : 'other';

  return { keywords, entities, sentiment, confidence, theme };
}

/**
 * Process a single batch of articles through Ollama (sequentially within batch).
 */
async function processBatch(client, articles, stats) {
  for (const article of articles) {
    try {
      const prompt = buildPrompt(article.title);
      const raw = await chatOllama(prompt);
      const analysis = parseAnalysis(raw);

      // Insert into article_analysis
      await client.query(`
        INSERT INTO article_analysis (article_id, keywords, entities, sentiment, confidence, analyzed_at)
        VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
        ON CONFLICT (article_id) DO UPDATE SET
          keywords = EXCLUDED.keywords,
          entities = EXCLUDED.entities,
          sentiment = EXCLUDED.sentiment,
          confidence = EXCLUDED.confidence,
          analyzed_at = NOW()
      `, [
        article.id,
        analysis.keywords,
        JSON.stringify(analysis.entities),
        analysis.sentiment,
        analysis.confidence,
      ]);

      // Update auto_trend_keywords with new keywords
      for (const kw of analysis.keywords) {
        const normalised = kw.toLowerCase().trim();
        if (normalised.length < 2) continue;
        await client.query(`
          INSERT INTO auto_trend_keywords (keyword, source, article_count, first_seen, last_seen)
          VALUES ($1, 'ollama-article-analyzer', 1, CURRENT_DATE, CURRENT_DATE)
          ON CONFLICT (keyword) DO UPDATE SET
            article_count = auto_trend_keywords.article_count + 1,
            last_seen = CURRENT_DATE,
            updated_at = NOW()
        `, [normalised]);
      }

      // Track stats
      stats.total++;
      stats.sentiments[analysis.sentiment] = (stats.sentiments[analysis.sentiment] || 0) + 1;
      for (const kw of analysis.keywords) {
        const normalised = kw.toLowerCase().trim();
        stats.keywords[normalised] = (stats.keywords[normalised] || 0) + 1;
      }
      for (const category of ['companies', 'countries', 'persons', 'tickers']) {
        for (const entity of analysis.entities[category]) {
          const key = `${category}:${entity}`;
          stats.entities[key] = (stats.entities[key] || 0) + 1;
        }
      }

      if (stats.total % PROGRESS_INTERVAL === 0) {
        console.log(`  ... ${stats.total} articles analyzed`);
      }
    } catch (err) {
      stats.errors++;
      if (stats.errors <= 5) {
        console.warn(`  [skip] article ${article.id}: ${err.message.slice(0, 80)}`);
      } else if (stats.errors === 6) {
        console.warn('  (suppressing further error messages)');
      }
    }
  }
}

async function main() {
  const opts = parseArgs();
  const client = new Client(PG_CONFIG);
  await client.connect();

  console.log(`═══ Ollama Article Analyzer (${CHAT_MODEL}) ═══`);
  console.log(`Ollama endpoint: ${OLLAMA_URL}`);
  if (opts.limit) console.log(`Batch limit: ${opts.limit}`);
  if (opts.since) console.log(`Since: ${opts.since}`);
  console.log();

  // ── Ensure tables exist ──
  await client.query(`
    CREATE TABLE IF NOT EXISTS article_analysis (
      article_id INTEGER PRIMARY KEY,
      keywords TEXT[],
      entities JSONB,
      sentiment TEXT,
      confidence DOUBLE PRECISION,
      analyzed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS auto_trend_keywords (
      id SERIAL PRIMARY KEY,
      keyword TEXT UNIQUE,
      source TEXT DEFAULT 'auto-extracted',
      article_count INTEGER DEFAULT 0,
      first_seen DATE,
      last_seen DATE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── Fetch unanalyzed articles ──
  const conditions = ['NOT EXISTS (SELECT 1 FROM article_analysis aa WHERE aa.article_id = a.id)'];
  const params = [];
  if (opts.since) {
    params.push(opts.since);
    conditions.push(`a.published_at >= $${params.length}::timestamptz`);
  }

  let limitClause = '';
  if (opts.limit > 0) {
    params.push(opts.limit);
    limitClause = `LIMIT $${params.length}`;
  }

  const articlesResult = await client.query(`
    SELECT a.id, a.title
    FROM articles a
    WHERE ${conditions.join(' AND ')}
      AND a.title IS NOT NULL
      AND LENGTH(a.title) > 10
    ORDER BY a.published_at DESC
    ${limitClause}
  `, params);

  const articles = articlesResult.rows;
  console.log(`Found ${articles.length} unanalyzed articles\n`);

  if (articles.length === 0) {
    console.log('Nothing to do.');
    await client.end();
    return;
  }

  // ── Process in batches ──
  const stats = {
    total: 0,
    errors: 0,
    sentiments: {},
    keywords: {},
    entities: {},
  };

  const startTime = Date.now();

  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);
    await processBatch(client, batch, stats);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── Summary ──
  console.log('\n═══ Analysis Summary ═══\n');
  console.log(`Total analyzed: ${stats.total} (${stats.errors} errors) in ${elapsed}s`);
  console.log(`Avg per article: ${stats.total > 0 ? (parseFloat(elapsed) / stats.total).toFixed(2) : 0}s`);

  // Top 10 keywords
  const topKeywords = Object.entries(stats.keywords)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (topKeywords.length > 0) {
    console.log('\nTop 10 keywords:');
    for (const [kw, count] of topKeywords) {
      console.log(`  ${kw.padEnd(25)} ${count}`);
    }
  }

  // Sentiment distribution
  console.log('\nSentiment distribution:');
  for (const [sent, count] of Object.entries(stats.sentiments).sort((a, b) => b[1] - a[1])) {
    const pct = stats.total > 0 ? ((count / stats.total) * 100).toFixed(1) : '0.0';
    console.log(`  ${sent.padEnd(12)} ${String(count).padStart(6)}  (${pct}%)`);
  }

  // New entities discovered
  const topEntities = Object.entries(stats.entities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  if (topEntities.length > 0) {
    console.log('\nTop entities discovered:');
    for (const [entity, count] of topEntities) {
      console.log(`  ${entity.padEnd(35)} ${count}`);
    }
  }

  await client.end();
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
