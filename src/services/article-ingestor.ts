/**
 * article-ingestor.ts — Real-time article ingestion into the NAS analysis engine.
 *
 * Takes articles from RSS/news fetchers and stores them in NAS PostgreSQL,
 * auto-classifies themes via pgvector nearest-neighbor, and creates
 * pending_outcomes entries for auto-mapped symbols.
 *
 * NAS PostgreSQL: 192.168.0.76:5433, DB: lattice
 */

import pg from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestArticleInput {
  title: string;
  source: string;
  url?: string;
  publishedAt: string;
  theme?: string;
}

export interface IngestArticleResult {
  articleId: number;
  theme: string;
  pendingCount: number;
}

export interface IngestBatchResult {
  ingested: IngestArticleResult[];
  skippedDuplicates: number;
}

export interface CheckPendingResult {
  completed: number;
  remaining: number;
}

export interface IngestorStats {
  totalArticles: number;
  todayArticles: number;
  pendingOutcomes: number;
  recentThemes: string[];
}

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

function resolveNasPgConfig(): pg.PoolConfig {
  const env = (keys: string[], fallback: string): string => {
    for (const k of keys) {
      const v = String(process.env[k] || '').trim();
      if (v) return v;
    }
    return fallback;
  };

  const host = env(['INTEL_PG_HOST', 'NAS_PG_HOST', 'PG_HOST'], '192.168.0.76');
  const portRaw = Number(env(['INTEL_PG_PORT', 'NAS_PG_PORT', 'PG_PORT'], '5433'));
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 5433;
  const database = env(['INTEL_PG_DATABASE', 'NAS_PG_DATABASE', 'PG_DATABASE', 'PGDATABASE'], 'lattice');
  const user = env(['INTEL_PG_USER', 'NAS_PG_USER', 'PG_USER', 'PGUSER'], 'postgres');
  const password = env(['INTEL_PG_PASSWORD', 'NAS_PG_PASSWORD', 'PG_PASSWORD', 'PGPASSWORD'], '');

  return {
    host,
    port,
    database,
    user,
    password: password || undefined,
    max: 4,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  };
}

function resolveOllamaEmbedEndpoint(): string | null {
  const base = String(process.env.OLLAMA_API_URL || process.env.OLLAMA_BASE_URL || '').trim();
  if (!base) return null;
  return base.endsWith('/api/embed') ? base : `${base.replace(/\/+$/, '')}/api/embed`;
}

function resolveOllamaModel(): string {
  return String(process.env.OLLAMA_MODEL || 'nomic-embed-text').trim();
}

// ---------------------------------------------------------------------------
// Pool management
// ---------------------------------------------------------------------------

let pool: pg.Pool | null = null;
let poolCacheKey = '';

function getPool(): pg.Pool {
  const config = resolveNasPgConfig();
  const key = JSON.stringify({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
  });

  if (pool && poolCacheKey === key) return pool;

  if (pool) {
    void pool.end().catch(() => { /* ignore */ });
  }

  pool = new pg.Pool(config);
  poolCacheKey = key;
  return pool;
}

export async function closeIngestorPool(): Promise<void> {
  if (!pool) return;
  const ref = pool;
  pool = null;
  poolCacheKey = '';
  await ref.end().catch(() => { /* ignore */ });
}

// ---------------------------------------------------------------------------
// Schema bootstrap
// ---------------------------------------------------------------------------

let schemaReady = false;

async function ensureSchema(client: pg.PoolClient): Promise<void> {
  if (schemaReady) return;

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

  schemaReady = true;
}

// ---------------------------------------------------------------------------
// Embedding helpers
// ---------------------------------------------------------------------------

function toVectorLiteral(values: number[]): string {
  return `[${values.map((v) => Number(v) || 0).join(',')}]`;
}

async function generateEmbedding(text: string): Promise<number[] | null> {
  const endpoint = resolveOllamaEmbedEndpoint();
  if (!endpoint) return null;

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: resolveOllamaModel(), input: [text.slice(0, 2000)] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      embeddings?: number[][];
      embedding?: number[];
    };

    const vec = data.embeddings?.[0] ?? data.embedding ?? null;
    return Array.isArray(vec) ? vec : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Auto-classify theme via pgvector nearest-neighbor
// ---------------------------------------------------------------------------

async function autoClassifyTheme(
  client: pg.PoolClient,
  articleId: number,
): Promise<string> {
  const result = await client.query<{ theme: string; sim: number }>(`
    SELECT lo.theme, 1 - (anchor.embedding <=> target.embedding) AS sim
    FROM articles target
    JOIN articles anchor ON anchor.embedding IS NOT NULL AND anchor.id != target.id
    JOIN labeled_outcomes lo ON lo.article_id = anchor.id AND lo.horizon = '2w'
    WHERE target.id = $1 AND target.embedding IS NOT NULL
    ORDER BY anchor.embedding <=> target.embedding
    LIMIT 1
  `, [articleId]);

  const row = result.rows[0];
  return row ? row.theme : 'unknown';
}

// ---------------------------------------------------------------------------
// Create pending outcomes for auto-mapped symbols
// ---------------------------------------------------------------------------

async function createPendingOutcomes(
  client: pg.PoolClient,
  articleId: number,
  theme: string,
  publishedAt: string,
): Promise<number> {
  const symbols = await client.query<{ symbol: string }>(
    'SELECT symbol FROM auto_theme_symbols WHERE theme = $1 ORDER BY correlation DESC LIMIT 5',
    [theme],
  );

  if (symbols.rows.length === 0) return 0;

  let created = 0;

  for (const row of symbols.rows) {
    const horizons: Array<{ name: string; days: number }> = [
      { name: '1w', days: 7 },
      { name: '2w', days: 14 },
    ];

    for (const h of horizons) {
      // Fetch entry price (closest available price on or after published date)
      const priceResult = await client.query<{ price: string }>(`
        SELECT price::text AS price
        FROM worldmonitor_intel.historical_raw_items
        WHERE provider = 'yahoo-chart' AND symbol = $1
          AND valid_time_start >= $2::timestamptz
          AND valid_time_start <= $2::timestamptz + INTERVAL '3 days'
        ORDER BY valid_time_start
        LIMIT 1
      `, [row.symbol, publishedAt]);

      const priceRow = priceResult.rows[0];
      const entryPrice = priceRow ? Number(priceRow.price) : null;

      const targetDate = new Date(publishedAt);
      targetDate.setDate(targetDate.getDate() + h.days);
      const targetDateStr = targetDate.toISOString().slice(0, 10);

      try {
        await client.query(`
          INSERT INTO pending_outcomes
            (article_id, theme, symbol, horizon, entry_price, published_at, target_date)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (article_id, symbol, horizon) DO NOTHING
        `, [articleId, theme, row.symbol, h.name, entryPrice, publishedAt, targetDateStr]);
        created++;
      } catch {
        // Duplicate or constraint violation — skip
      }
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ingest a single article into NAS PostgreSQL.
 *
 * - Inserts the article row (skips if duplicate by title).
 * - Generates an embedding via Ollama if OLLAMA_API_URL is set.
 * - Auto-classifies theme using pgvector nearest-neighbor if no theme provided.
 * - Creates pending_outcomes entries for auto-mapped symbols.
 */
export async function ingestArticle(
  article: IngestArticleInput,
): Promise<IngestArticleResult> {
  const db = getPool();
  const client = await db.connect();

  try {
    await ensureSchema(client);

    // Insert article, skip duplicate by title
    const insertResult = await client.query<{ id: number }>(`
      INSERT INTO articles (source, theme, published_at, title, url)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [
      article.source,
      article.theme ?? null,
      article.publishedAt,
      article.title,
      article.url ?? null,
    ]);

    const insertedRow = insertResult.rows[0];
    if (!insertedRow) {
      // Duplicate — look up existing article
      const existing = await client.query<{ id: number; theme: string | null }>(
        'SELECT id, theme FROM articles WHERE title = $1 LIMIT 1',
        [article.title],
      );
      const existingRow = existing.rows[0];
      return {
        articleId: existingRow?.id ?? -1,
        theme: existingRow?.theme ?? article.theme ?? 'unknown',
        pendingCount: 0,
      };
    }

    const articleId = insertedRow.id;

    // Generate embedding via Ollama (optional)
    const embedding = await generateEmbedding(article.title);
    if (embedding) {
      await client.query(
        'UPDATE articles SET embedding = $1 WHERE id = $2',
        [toVectorLiteral(embedding), articleId],
      );
    }

    // Determine theme
    let theme = article.theme ?? null;
    if (!theme && embedding) {
      theme = await autoClassifyTheme(client, articleId);
    }
    theme = theme ?? 'unknown';

    // Update theme on article if it was auto-classified
    if (!article.theme && theme !== 'unknown') {
      await client.query('UPDATE articles SET theme = $1 WHERE id = $2', [theme, articleId]);
    }

    // Record in auto_article_themes
    try {
      await client.query(`
        INSERT INTO auto_article_themes (article_id, auto_theme, confidence, method)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (article_id) DO UPDATE SET
          auto_theme = EXCLUDED.auto_theme, updated_at = NOW()
      `, [articleId, theme, embedding ? 0.5 : 0, embedding ? 'embedding-ingest' : 'manual-ingest']);
    } catch {
      // Table may not exist yet in some environments — non-fatal
    }

    // Create pending outcomes for auto-mapped symbols
    let pendingCount = 0;
    if (theme !== 'unknown') {
      try {
        pendingCount = await createPendingOutcomes(client, articleId, theme, article.publishedAt);
      } catch {
        // auto_theme_symbols or historical_raw_items may not be present — non-fatal
      }
    }

    return { articleId, theme, pendingCount };
  } finally {
    client.release();
  }
}

/**
 * Batch ingest articles. Skips duplicates by title.
 */
export async function ingestArticleBatch(
  articles: IngestArticleInput[],
): Promise<IngestBatchResult> {
  const ingested: IngestArticleResult[] = [];
  let skippedDuplicates = 0;

  // Pre-check which titles already exist to skip them early
  const db = getPool();
  const client = await db.connect();
  let existingTitles: Set<string>;

  try {
    await ensureSchema(client);

    const titles = articles.map((a) => a.title);
    const existing = await client.query<{ title: string }>(
      'SELECT title FROM articles WHERE title = ANY($1::text[])',
      [titles],
    );
    existingTitles = new Set(existing.rows.map((r) => r.title));
  } finally {
    client.release();
  }

  for (const article of articles) {
    if (existingTitles.has(article.title)) {
      skippedDuplicates++;
      continue;
    }

    try {
      const result = await ingestArticle(article);
      if (result.articleId === -1) {
        skippedDuplicates++;
      } else {
        ingested.push(result);
      }
    } catch {
      // Individual article failure should not crash the batch
      skippedDuplicates++;
    }
  }

  return { ingested, skippedDuplicates };
}

/**
 * Check pending_outcomes where target_date <= now.
 *
 * Fetches exit_price from Yahoo data in NAS, computes forward return,
 * and moves completed entries to labeled_outcomes.
 */
export async function checkPendingOutcomes(): Promise<CheckPendingResult> {
  const db = getPool();
  const client = await db.connect();
  let completed = 0;

  try {
    await ensureSchema(client);

    // Find all pending outcomes whose target date has arrived
    const pending = await client.query<{
      id: number;
      article_id: number;
      theme: string;
      symbol: string;
      horizon: string;
      entry_price: number | null;
      published_at: string;
      target_date: string;
    }>(`
      SELECT id, article_id, theme, symbol, horizon, entry_price, published_at, target_date
      FROM pending_outcomes
      WHERE status = 'pending' AND target_date <= CURRENT_DATE
      ORDER BY target_date
      LIMIT 500
    `);

    for (const row of pending.rows) {
      // Fetch exit price from Yahoo data
      const exitResult = await client.query<{ price: string }>(`
        SELECT price::text AS price
        FROM worldmonitor_intel.historical_raw_items
        WHERE provider = 'yahoo-chart' AND symbol = $1
          AND valid_time_start >= $2::date
          AND valid_time_start <= $2::date + INTERVAL '3 days'
        ORDER BY valid_time_start
        LIMIT 1
      `, [row.symbol, row.target_date]);

      const exitRow = exitResult.rows[0];
      if (!exitRow) {
        // Price not available yet — leave pending
        continue;
      }

      const exitPrice = Number(exitRow.price);
      const entryPrice = Number(row.entry_price ?? 0);

      if (entryPrice <= 0) {
        // No valid entry price — mark as skipped
        await client.query(
          `UPDATE pending_outcomes SET status = 'skipped', resolved_at = NOW() WHERE id = $1`,
          [row.id],
        );
        completed++;
        continue;
      }

      const forwardReturnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
      const hit = forwardReturnPct > 0;

      // Insert into labeled_outcomes
      try {
        await client.query(`
          INSERT INTO labeled_outcomes
            (article_id, theme, symbol, published_at, horizon, entry_price, exit_price, forward_return_pct, hit)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (article_id, symbol, horizon) DO UPDATE SET
            exit_price = EXCLUDED.exit_price,
            forward_return_pct = EXCLUDED.forward_return_pct,
            hit = EXCLUDED.hit
        `, [
          row.article_id, row.theme, row.symbol, row.published_at,
          row.horizon, entryPrice, exitPrice, forwardReturnPct, hit,
        ]);
      } catch {
        // labeled_outcomes insert failure — still mark pending as resolved
      }

      // Update pending_outcomes
      await client.query(`
        UPDATE pending_outcomes
        SET status = 'completed', exit_price = $1, forward_return_pct = $2, resolved_at = NOW()
        WHERE id = $3
      `, [exitPrice, forwardReturnPct, row.id]);

      completed++;
    }

    // Count remaining
    const remainingResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pending_outcomes WHERE status = 'pending'`,
    );
    const remaining = Number(remainingResult.rows[0]?.count ?? 0);

    return { completed, remaining };
  } finally {
    client.release();
  }
}

/**
 * Get aggregate ingestor statistics.
 */
export async function getIngestorStats(): Promise<IngestorStats> {
  const db = getPool();
  const client = await db.connect();

  try {
    const [totalRes, todayRes, pendingRes, themesRes] = await Promise.all([
      client.query<{ count: string }>('SELECT COUNT(*) AS count FROM articles'),
      client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM articles WHERE published_at >= CURRENT_DATE`,
      ),
      client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM pending_outcomes WHERE status = 'pending'`,
      ),
      client.query<{ theme: string }>(
        `SELECT DISTINCT auto_theme AS theme FROM auto_article_themes
         WHERE updated_at >= NOW() - INTERVAL '7 days'
         ORDER BY auto_theme
         LIMIT 20`,
      ),
    ]);

    return {
      totalArticles: Number(totalRes.rows[0]?.count ?? 0),
      todayArticles: Number(todayRes.rows[0]?.count ?? 0),
      pendingOutcomes: Number(pendingRes.rows[0]?.count ?? 0),
      recentThemes: themesRes.rows.map((r) => r.theme),
    };
  } catch {
    // Graceful fallback if tables don't exist yet
    return {
      totalArticles: 0,
      todayArticles: 0,
      pendingOutcomes: 0,
      recentThemes: [],
    };
  } finally {
    client.release();
  }
}
