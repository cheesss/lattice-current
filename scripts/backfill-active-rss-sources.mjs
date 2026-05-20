#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { resolveThemeTaxonomy } from './_shared/theme-taxonomy.mjs';
import { isLowValueGoogleNewsSource } from './_shared/google-news-source-policy.mjs';
import { classifySeedItemTheme, parseResolvedSourceItems } from './proposal-executor.mjs';

const { Client } = pg;
const SOURCE_REGISTRY_CACHE_KEY = 'source-registry:v1';
const DEFAULT_REGISTRY_PATH = path.resolve('data', 'persistent-cache', `${encodeURIComponent(SOURCE_REGISTRY_CACHE_KEY)}.json`);
const DEFAULT_CURSOR_PATH = path.resolve('data', 'dynamic-rss-backfill-state.json');
const ARTICLE_SOURCE_MAX_LENGTH = 50;
const DOWNSTREAM_LINK_LOOKBACK_DAYS = 45;
const PENDING_OUTCOME_HORIZONS = [
  { name: '1w', days: 7 },
  { name: '2w', days: 14 },
];
const FALLBACK_OUTCOME_SYMBOLS = new Map([
  ['ai-ml', ['^IXIC', '^GSPC']],
  ['cloud-infrastructure', ['^IXIC', '^GSPC']],
  ['semiconductor', ['^IXIC', '^GSPC']],
  ['robotics-automation', ['^IXIC', '^GSPC']],
  ['cybersecurity', ['^IXIC', '^GSPC']],
  ['biotech', ['^GSPC', '^IXIC']],
  ['clean-energy', ['USO', 'XLE', 'CL=F']],
  ['defense', ['^GSPC', 'XLE', 'TLT']],
  ['defense-industrial', ['^GSPC', 'XLE', 'TLT']],
  ['aerospace', ['^GSPC', 'XLE', 'TLT']],
  ['space', ['^GSPC', '^IXIC']],
  ['supply-chain-security', ['USO', 'XLE', 'DX-Y.NYB']],
  ['shipping', ['USO', 'XLE', 'DX-Y.NYB']],
  ['geopolitics', ['TLT', 'GLD', '^GSPC']],
  ['conflict', ['TLT', 'GLD', 'XLE']],
  ['macroeconomics', ['^GSPC', 'TLT', 'DX-Y.NYB']],
]);

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    registry: DEFAULT_REGISTRY_PATH,
    maxSources: 80,
    limit: 100,
    concurrency: Number(process.env.DYNAMIC_RSS_BACKFILL_CONCURRENCY || 6),
    timeoutMs: Number(process.env.DYNAMIC_RSS_BACKFILL_TIMEOUT_MS || 12_000),
    offset: 0,
    cursorPath: DEFAULT_CURSOR_PATH,
    noCursor: false,
    onlyName: '',
    onlyUrl: '',
    dryRun: false,
    refreshDiscovery: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [rawKey, inlineValue] = token.slice(2).split('=');
    const key = rawKey.trim();
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue == null && value && !String(value).startsWith('--')) index += 1;
    if (key === 'registry') out.registry = String(value || out.registry);
    else if (key === 'max-sources' || key === 'maxSources') out.maxSources = Number(value || out.maxSources);
    else if (key === 'limit') out.limit = Number(value || out.limit);
    else if (key === 'concurrency') out.concurrency = Number(value || out.concurrency);
    else if (key === 'timeout-ms' || key === 'timeoutMs') out.timeoutMs = Number(value || out.timeoutMs);
    else if (key === 'offset') out.offset = Number(value || 0);
    else if (key === 'cursor') out.cursorPath = String(value || out.cursorPath);
    else if (key === 'no-cursor' || key === 'noCursor') out.noCursor = true;
    else if (key === 'name' || key === 'source-name') out.onlyName = String(value || '');
    else if (key === 'url') out.onlyUrl = String(value || '');
    else if (key === 'dry-run' || key === 'dryRun') out.dryRun = true;
    else if (key === 'refresh-discovery' || key === 'refreshDiscovery') out.refreshDiscovery = true;
  }
  out.maxSources = Math.max(1, Math.min(500, Math.floor(Number(out.maxSources) || 80)));
  out.limit = Math.max(1, Math.min(500, Math.floor(Number(out.limit) || 100)));
  out.concurrency = Math.max(1, Math.min(20, Math.floor(Number(out.concurrency) || 6)));
  out.timeoutMs = Math.max(3_000, Math.min(60_000, Math.floor(Number(out.timeoutMs) || 12_000)));
  out.offset = Math.max(0, Math.floor(Number(out.offset) || 0));
  return out;
}

export function fallbackOutcomeSymbolsForTheme(theme) {
  const normalized = normalizeText(theme).toLowerCase();
  if (!normalized) return [];
  const taxonomy = resolveThemeTaxonomy(normalized);
  const keys = [
    normalized,
    normalizeText(taxonomy.themeKey).toLowerCase(),
    normalizeText(taxonomy.parentTheme).toLowerCase(),
    normalizeText(taxonomy.category).toLowerCase(),
  ].filter(Boolean);
  for (const key of keys) {
    const symbols = FALLBACK_OUTCOME_SYMBOLS.get(key);
    if (symbols?.length) return symbols;
  }
  return [];
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeUrl(value) {
  return normalizeText(value).replace(/\/+$/, '').toLowerCase();
}

function inferTheme(source) {
  const topic = Array.isArray(source?.topics) ? source.topics.find(Boolean) : null;
  return normalizeText(topic || source?.category || 'general').toLowerCase() || 'general';
}

export async function loadActiveRssSources(registryPath = DEFAULT_REGISTRY_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  } catch {
    return [];
  }
  const sources = parsed?.data?.discoveredSources;
  if (!Array.isArray(sources)) return [];
  return sources
    .filter((source) => String(source?.status || '').toLowerCase() === 'active')
    .filter((source) => /^https?:\/\//i.test(String(source?.url || '')))
    .filter((source) => !isLowValueGoogleNewsSource({
      url: source?.url,
      feedName: source?.feedName,
      category: source?.category,
      theme: inferTheme(source),
      topics: source?.topics,
    }))
    .map((source) => ({
      id: normalizeText(source.id),
      feedName: normalizeText(source.feedName || source.domain || source.url).slice(0, ARTICLE_SOURCE_MAX_LENGTH),
      url: normalizeText(source.url),
      theme: inferTheme(source),
      category: normalizeText(source.category || inferTheme(source)).toLowerCase(),
      lang: normalizeText(source.lang || 'en').slice(0, 12),
      confidence: Number(source.confidence || 0),
    }));
}

async function readCursor(cursorPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(cursorPath, 'utf8'));
    const cursor = Number(parsed?.cursor || 0);
    return Number.isFinite(cursor) && cursor >= 0 ? Math.floor(cursor) : 0;
  } catch {
    return 0;
  }
}

async function writeCursor(cursorPath, cursor, total) {
  await fs.mkdir(path.dirname(cursorPath), { recursive: true });
  await fs.writeFile(cursorPath, JSON.stringify({
    cursor,
    total,
    updatedAt: new Date().toISOString(),
  }, null, 2), 'utf8');
}

function rotateSources(sources, offset) {
  if (!sources.length) return sources;
  const cursor = offset % sources.length;
  return sources.slice(cursor).concat(sources.slice(0, cursor));
}

export function isBackfillRunOk(summary = {}) {
  const activeSourceCount = Math.max(0, Number(summary.activeSourceCount || 0));
  const failed = Math.max(0, Number(summary.failed || 0));
  return activeSourceCount === 0 || failed < activeSourceCount;
}

async function fetchSourceText(source, timeoutMs = 12_000) {
  const headerAttempts = [
    {
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.6',
      'user-agent': 'Lattice-DynamicRssBackfill/1.0',
    },
    {
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.6',
      'user-agent': 'Lattice-SourceProbe/1.0',
    },
    {
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.6,*/*;q=0.5',
      'user-agent': 'Mozilla/5.0 (compatible; LatticeCurrentBot/1.0; +https://localhost/lattice-current)',
    },
  ];
  let lastStatus = 0;
  for (const headers of headerAttempts) {
    try {
      const response = await fetch(source.url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastStatus = response.status;
      if (response.ok) return response.text();
      if (![403, 406, 429].includes(response.status)) break;
    } catch (error) {
      if (headers === headerAttempts[headerAttempts.length - 1]) throw error;
    }
  }
  throw new Error(`fetch ${lastStatus || 'failed'}`);
}

async function fetchSourceItems(source, limit, timeoutMs = 12_000) {
  const text = await fetchSourceText(source, timeoutMs);
  return parseResolvedSourceItems(text, source.url).slice(0, limit);
}

async function ensurePendingOutcomesTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS pending_outcomes (
      id SERIAL PRIMARY KEY,
      article_id INTEGER NOT NULL,
      theme TEXT NOT NULL,
      symbol TEXT NOT NULL,
      horizon TEXT NOT NULL DEFAULT '2w',
      entry_price DOUBLE PRECISION,
      published_at TIMESTAMPTZ NOT NULL,
      target_date DATE NOT NULL,
      exit_price DOUBLE PRECISION,
      forward_return_pct DOUBLE PRECISION,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      UNIQUE(article_id, symbol, horizon)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_pending_outcomes_status_target
    ON pending_outcomes (status, target_date)
  `);
}

async function lookupEntryPrice(client, symbol, publishedAt) {
  const marketQuote = await client.query(`
    SELECT last_price::float AS price
    FROM market_quotes
    WHERE symbol = $1
      AND observed_at >= $2::timestamptz - INTERVAL '18 hours'
      AND observed_at <= $2::timestamptz + INTERVAL '10 days'
    ORDER BY
      CASE WHEN observed_at >= $2::timestamptz THEN 0 ELSE 1 END,
      ABS(EXTRACT(EPOCH FROM (observed_at - $2::timestamptz)))
    LIMIT 1
  `, [symbol, publishedAt]).catch(() => ({ rows: [] }));
  const marketPrice = Number(marketQuote.rows?.[0]?.price || 0);
  if (marketPrice > 0) return marketPrice;

  const legacyQuote = await client.query(`
    SELECT price::float AS price
    FROM worldmonitor_intel.historical_raw_items
    WHERE provider = 'yahoo-chart'
      AND symbol = $1
      AND valid_time_start >= $2::timestamptz - INTERVAL '18 hours'
      AND valid_time_start <= $2::timestamptz + INTERVAL '10 days'
    ORDER BY
      CASE WHEN valid_time_start >= $2::timestamptz THEN 0 ELSE 1 END,
      ABS(EXTRACT(EPOCH FROM (valid_time_start - $2::timestamptz)))
    LIMIT 1
  `, [symbol, publishedAt]).catch(() => ({ rows: [] }));
  const legacyPrice = Number(legacyQuote.rows?.[0]?.price || 0);
  return legacyPrice > 0 ? legacyPrice : null;
}

async function resolveOutcomeSymbols(client, theme) {
  const normalized = normalizeText(theme).toLowerCase();
  if (!normalized || normalized === 'unknown') return [];
  const learned = await client.query(`
    SELECT symbol
    FROM auto_theme_symbols
    WHERE theme = $1
    ORDER BY quality_score DESC NULLS LAST, correlation DESC NULLS LAST
    LIMIT 5
  `, [normalized]).catch(() => ({ rows: [] }));
  const learnedSymbols = learned.rows.map((row) => normalizeText(row.symbol)).filter(Boolean);
  if (learnedSymbols.length) return learnedSymbols;
  return fallbackOutcomeSymbolsForTheme(normalized);
}

async function createPendingOutcomesForArticles(client, articleRefs) {
  const articleIds = [...new Set(articleRefs.map((ref) => Number(ref.articleId || ref.id || 0)).filter((id) => id > 0))];
  if (!articleIds.length) return 0;
  await ensurePendingOutcomesTable(client);

  const { rows } = await client.query(`
    SELECT
      a.id,
      COALESCE(NULLIF(t.auto_theme, ''), NULLIF(a.theme, ''), 'unknown') AS theme,
      a.published_at
    FROM articles a
    LEFT JOIN auto_article_themes t ON t.article_id = a.id
    WHERE a.id = ANY($1::int[])
      AND a.published_at IS NOT NULL
  `, [articleIds]);

  let pendingOutcomes = 0;
  for (const article of rows) {
    const theme = normalizeText(article.theme).toLowerCase();
    const symbols = await resolveOutcomeSymbols(client, theme);
    if (!symbols.length) continue;
    for (const symbol of symbols.slice(0, 5)) {
      const entryPrice = await lookupEntryPrice(client, symbol, article.published_at);
      if (!(Number(entryPrice) > 0)) continue;
      for (const horizon of PENDING_OUTCOME_HORIZONS) {
        const result = await client.query(`
          INSERT INTO pending_outcomes
            (article_id, theme, symbol, horizon, entry_price, published_at, target_date)
          VALUES ($1, $2, $3, $4, $5, $6, ($6::timestamptz + ($7::text || ' days')::interval)::date)
          ON CONFLICT (article_id, symbol, horizon) DO NOTHING
        `, [article.id, theme, symbol, horizon.name, entryPrice, article.published_at, horizon.days]);
        pendingOutcomes += Number(result.rowCount || 0);
      }
    }
  }
  return pendingOutcomes;
}

async function refreshCanonicalEventStats(client, eventIds) {
  const ids = [...new Set(eventIds.map((id) => Number(id || 0)).filter((id) => id > 0))];
  if (!ids.length) return;
  await client.query(`
    WITH source_counts AS (
      SELECT aem.canonical_event_id, a.source, COUNT(*)::float AS source_articles
      FROM article_event_map aem
      JOIN articles a ON a.id = aem.article_id
      WHERE aem.canonical_event_id = ANY($1::int[])
      GROUP BY aem.canonical_event_id, a.source
    ),
    stats AS (
      SELECT
        canonical_event_id,
        SUM(source_articles)::int AS article_count,
        COUNT(*)::int AS source_count,
        MAX(source_articles) / NULLIF(SUM(source_articles), 0) AS top_source_share,
        SUM(POWER(source_articles / NULLIF(total_articles, 0), 2)) AS source_hhi
      FROM (
        SELECT
          sc.*,
          SUM(sc.source_articles) OVER (PARTITION BY sc.canonical_event_id) AS total_articles
        FROM source_counts sc
      ) scoped
      GROUP BY canonical_event_id
    )
    UPDATE canonical_events ce
    SET
      article_count = stats.article_count,
      source_count = stats.source_count,
      source_diversity = CASE
        WHEN stats.source_count <= 1 THEN 1.0
        ELSE LEAST(1.0, stats.source_count::float / NULLIF(stats.article_count, 0))
      END,
      source_hhi = stats.source_hhi,
      effective_source_count = CASE WHEN stats.source_hhi > 0 THEN 1.0 / stats.source_hhi ELSE NULL END,
      top_source_share = stats.top_source_share,
      wire_dominated = COALESCE(stats.top_source_share, 0) >= 0.85
    FROM stats
    WHERE ce.id = stats.canonical_event_id
  `, [ids]).catch(() => {});
}

async function mapArticlesToCanonicalEvents(client, articleRefs) {
  const articleIds = [...new Set(articleRefs.map((ref) => Number(ref.articleId || ref.id || 0)).filter((id) => id > 0))];
  if (!articleIds.length) return 0;

  const { rows } = await client.query(`
    SELECT
      a.id,
      a.title,
      a.source,
      COALESCE(NULLIF(t.auto_theme, ''), NULLIF(a.theme, ''), 'unknown') AS theme,
      DATE(a.published_at) AS event_date
    FROM articles a
    LEFT JOIN auto_article_themes t ON t.article_id = a.id
    LEFT JOIN article_event_map aem ON aem.article_id = a.id
    WHERE a.id = ANY($1::int[])
      AND a.published_at IS NOT NULL
      AND aem.article_id IS NULL
      AND COALESCE(NULLIF(t.auto_theme, ''), NULLIF(a.theme, ''), 'unknown') <> 'unknown'
    ORDER BY a.published_at DESC
  `, [articleIds]);

  const groups = new Map();
  for (const row of rows) {
    const date = row.event_date instanceof Date
      ? row.event_date.toISOString().slice(0, 10)
      : String(row.event_date).slice(0, 10);
    const theme = normalizeText(row.theme).toLowerCase();
    const key = `${date}::${theme}`;
    if (!groups.has(key)) groups.set(key, { date, theme, articles: [] });
    groups.get(key).articles.push(row);
  }

  let eventMapped = 0;
  const eventIds = [];
  for (const group of groups.values()) {
    let eventId = Number((await client.query(`
      SELECT id
      FROM canonical_events
      WHERE event_date = $1::date AND theme = $2
      ORDER BY id
      LIMIT 1
    `, [group.date, group.theme])).rows?.[0]?.id || 0);

    if (!eventId) {
      const inserted = await client.query(`
        INSERT INTO canonical_events (
          event_date, theme, representative_title, source_count, source_diversity, article_count, avg_embedding
        )
        VALUES ($1::date, $2, $3, 1, 1.0, 0, NULL)
        RETURNING id
      `, [group.date, group.theme, normalizeText(group.articles[0]?.title).slice(0, 500) || group.theme]);
      eventId = Number(inserted.rows?.[0]?.id || 0);
    }
    if (!eventId) continue;
    eventIds.push(eventId);

    const values = [];
    const placeholders = group.articles.map((article, index) => {
      values.push(Number(article.id), eventId);
      const base = index * 2;
      return `($${base + 1}, $${base + 2})`;
    });
    if (!placeholders.length) continue;
    const result = await client.query(`
      INSERT INTO article_event_map (article_id, canonical_event_id)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT DO NOTHING
    `, values);
    eventMapped += Number(result.rowCount || 0);
  }

  await refreshCanonicalEventStats(client, eventIds);
  return eventMapped;
}

async function loadExistingArticleRefsForSource(client, source, limit) {
  const { rows } = await client.query(`
    SELECT id AS "articleId", title, theme
    FROM articles
    WHERE source = $1
      AND published_at >= NOW() - ($2::text || ' days')::interval
    ORDER BY published_at DESC
    LIMIT $3
  `, [source.feedName, DOWNSTREAM_LINK_LOOKBACK_DAYS, Math.max(10, Math.min(500, Number(limit || 100)))]);
  return rows;
}

async function retagExistingArticleThemes(client, source, articleRefs) {
  const refs = articleRefs
    .map((ref) => ({
      articleId: Number(ref.articleId || ref.id || 0),
      title: normalizeText(ref.title),
      currentTheme: normalizeText(ref.theme).toLowerCase(),
    }))
    .filter((ref) => ref.articleId > 0 && (!ref.currentTheme || ref.currentTheme === 'unknown'));
  if (!refs.length) return 0;

  let retagged = 0;
  for (const ref of refs) {
    const articleTheme = classifySeedItemTheme({ title: ref.title }, source.feedName, source.theme, {
      qualityBreakdown: { themeRelevance: 0 },
    });
    if (!articleTheme || articleTheme === 'unknown') continue;
    const taxonomy = resolveThemeTaxonomy(articleTheme);
    await client.query(
      `UPDATE articles SET theme = $2 WHERE id = $1 AND (theme IS NULL OR theme = 'unknown')`,
      [ref.articleId, articleTheme],
    );
    const result = await client.query(
      `
        INSERT INTO auto_article_themes (
          article_id, auto_theme, confidence, method,
          theme_key, theme_label, parent_theme, theme_category
        )
        VALUES ($1, $2, 0.55, 'dynamic-rss-source-fallback', $3, $4, $5, $6)
        ON CONFLICT (article_id) DO UPDATE SET
          auto_theme = CASE
            WHEN auto_article_themes.auto_theme IS NULL OR auto_article_themes.auto_theme = 'unknown'
            THEN EXCLUDED.auto_theme
            ELSE auto_article_themes.auto_theme
          END,
          confidence = GREATEST(auto_article_themes.confidence, EXCLUDED.confidence),
          method = CASE
            WHEN auto_article_themes.auto_theme IS NULL OR auto_article_themes.auto_theme = 'unknown'
            THEN EXCLUDED.method
            ELSE auto_article_themes.method
          END,
          theme_key = COALESCE(auto_article_themes.theme_key, EXCLUDED.theme_key),
          theme_label = COALESCE(auto_article_themes.theme_label, EXCLUDED.theme_label),
          parent_theme = COALESCE(auto_article_themes.parent_theme, EXCLUDED.parent_theme),
          theme_category = COALESCE(auto_article_themes.theme_category, EXCLUDED.theme_category),
          updated_at = NOW()
      `,
      [
        ref.articleId,
        articleTheme,
        taxonomy.themeKey || articleTheme,
        taxonomy.themeLabel || null,
        taxonomy.parentTheme || null,
        taxonomy.category || null,
      ],
    );
    retagged += Number(result.rowCount || 0);
  }
  return retagged;
}

async function insertSourceItems(client, source, items, { dryRun = false } = {}) {
  if (dryRun) {
    return { inserted: 0, themed: 0, eventMapped: 0, pendingOutcomes: 0, fetched: items.length };
  }

  let inserted = 0;
  let themed = 0;
  const articleIds = [];
  for (const item of items) {
    const articleTheme = classifySeedItemTheme(item, source.feedName, source.theme, {
      qualityBreakdown: { themeRelevance: 0 },
    });
    const result = await client.query(
      `
        INSERT INTO articles (source, theme, published_at, title, url)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
        RETURNING id
      `,
      [source.feedName, articleTheme, item.date, item.title, item.url],
    );
    inserted += Number(result.rowCount || 0);
    const articleId = Number(result.rows?.[0]?.id || 0);
    if (articleId > 0) articleIds.push({ articleId, articleTheme });
  }

  for (const { articleId, articleTheme } of articleIds) {
    if (!articleTheme || articleTheme === 'unknown') continue;
    const taxonomy = resolveThemeTaxonomy(articleTheme);
    const result = await client.query(
      `
        INSERT INTO auto_article_themes (
          article_id, auto_theme, confidence, method,
          theme_key, theme_label, parent_theme, theme_category
        )
        VALUES ($1, $2, $3, 'dynamic-rss-title-classifier', $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
      `,
      [
        articleId,
        articleTheme,
        articleTheme === source.theme ? 0.65 : 0.58,
        taxonomy.themeKey || articleTheme,
        taxonomy.themeLabel || null,
        taxonomy.parentTheme || null,
        taxonomy.category || null,
      ],
    );
    if (Number(result.rowCount || 0) === 0) {
      const updated = await client.query(
        `
          UPDATE auto_article_themes
          SET auto_theme = $2,
              confidence = GREATEST(confidence, $3),
              method = 'dynamic-rss-title-classifier',
              theme_key = $4,
              theme_label = $5,
              parent_theme = $6,
              theme_category = $7,
              updated_at = NOW()
          WHERE article_id = $1
            AND (auto_theme IS NULL OR auto_theme = 'unknown')
        `,
        [
          articleId,
          articleTheme,
          articleTheme === source.theme ? 0.65 : 0.58,
          taxonomy.themeKey || articleTheme,
          taxonomy.themeLabel || null,
          taxonomy.parentTheme || null,
          taxonomy.category || null,
        ],
      );
      themed += Number(updated.rowCount || 0);
    } else {
      themed += Number(result.rowCount || 0);
    }
  }

  const existingRefs = await loadExistingArticleRefsForSource(client, source, Math.max(items.length, articleIds.length, 60))
    .catch(() => []);
  const downstreamRefs = [...articleIds, ...existingRefs];
  const retagged = await retagExistingArticleThemes(client, source, existingRefs).catch(() => 0);
  const [eventMapped, pendingOutcomes] = await Promise.all([
    mapArticlesToCanonicalEvents(client, downstreamRefs).catch(() => 0),
    createPendingOutcomesForArticles(client, downstreamRefs).catch(() => 0),
  ]);

  return {
    inserted,
    themed: themed + retagged,
    eventMapped,
    pendingOutcomes,
    fetched: items.length,
  };
}

export async function backfillActiveRssSources(options = {}) {
  loadOptionalEnvFile(options.envFile || '.env.local');
  const args = {
    ...parseArgs([]),
    ...options,
  };
  const allActiveSources = (await loadActiveRssSources(args.registry))
    .filter((source) => !args.onlyName || source.feedName.toLowerCase().includes(String(args.onlyName).toLowerCase()))
    .filter((source) => !args.onlyUrl || normalizeUrl(source.url) === normalizeUrl(args.onlyUrl));
  const useCursor = !args.noCursor && !args.dryRun && !args.onlyName && !args.onlyUrl && allActiveSources.length > args.maxSources;
  const cursorStart = useCursor ? await readCursor(args.cursorPath) : args.offset;
  const activeSources = rotateSources(allActiveSources, cursorStart).slice(0, args.maxSources);

  const client = new Client(resolveNasPgConfig());
  await client.connect();
  const summary = {
    ok: true,
    generatedAt: new Date().toISOString(),
    activeSourceCount: activeSources.length,
    totalActiveSourceCount: allActiveSources.length,
    cursorStart: allActiveSources.length ? cursorStart % allActiveSources.length : 0,
    fetched: 0,
    inserted: 0,
    themed: 0,
    eventMapped: 0,
    pendingOutcomes: 0,
    failed: 0,
    sources: [],
  };

  const insertedThemes = new Set();
  try {
    const fetchedResults = new Array(activeSources.length);
    let nextIndex = 0;
    const workerCount = Math.min(args.concurrency, activeSources.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < activeSources.length) {
        const index = nextIndex;
        nextIndex += 1;
        const source = activeSources[index];
        try {
          const items = await fetchSourceItems(source, args.limit, args.timeoutMs);
          fetchedResults[index] = { source, items };
        } catch (error) {
          summary.failed += 1;
          summary.sources.push({
            ...source,
            fetched: 0,
            inserted: 0,
            themed: 0,
            error: String(error?.message || error),
          });
        }
      }
    }));

    for (const entry of fetchedResults.filter(Boolean)) {
      const { source, items } = entry;
      try {
        const result = await insertSourceItems(client, source, items, { dryRun: args.dryRun });
        summary.fetched += result.fetched;
        summary.inserted += result.inserted;
        summary.themed += result.themed;
        summary.eventMapped += result.eventMapped;
        summary.pendingOutcomes += result.pendingOutcomes;
        if (result.inserted > 0 && source.theme) insertedThemes.add(source.theme);
        summary.sources.push({ ...source, ...result });
      } catch (error) {
        summary.failed += 1;
        summary.sources.push({
          ...source,
          fetched: 0,
          inserted: 0,
          themed: 0,
          error: String(error?.message || error),
        });
      }
    }
  } finally {
    await client.end().catch(() => {});
  }

  if (!args.dryRun && args.refreshDiscovery && summary.inserted > 0) {
    const { refreshDiscoveryFromRecentThemes } = await import('./refresh-discovery-from-recent-themes.mjs');
    summary.discoveryRefresh = await refreshDiscoveryFromRecentThemes({
      days: 30,
      limit: 80,
      minCount: 2,
      themes: [...insertedThemes],
    });
  }

  if (useCursor) {
    summary.cursorNext = (summary.cursorStart + activeSources.length) % allActiveSources.length;
    await writeCursor(args.cursorPath, summary.cursorNext, allActiveSources.length);
  }

  summary.ok = isBackfillRunOk(summary);
  return summary;
}

async function main() {
  const summary = await backfillActiveRssSources(parseArgs());
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exitCode = 1;
  });
}

export { parseArgs };
