/**
 * article-ingestor.ts — Real-time article ingestion into the NAS analysis engine.
 *
 * Takes articles from RSS/news fetchers and stores them in NAS PostgreSQL,
 * auto-classifies themes via pgvector nearest-neighbor, and creates
 * pending_outcomes entries for auto-mapped symbols.
 *
 * NAS PostgreSQL: 192.168.0.76:5433, DB: lattice
 */

import type { PoolClient } from 'pg';
import { createLogger } from '@/utils/logger';
import { createManagedPgPool } from '@/utils/pg-pool';

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

interface SensitivityTarget {
  theme: string;
  symbol: string;
  horizon: string;
}

function resolveOllamaEmbedEndpoint(): string | null {
  const base = String(process.env.OLLAMA_API_URL || process.env.OLLAMA_BASE_URL || '').trim();
  if (!base) return null;
  return base.endsWith('/api/embed') ? base : `${base.replace(/\/+$/, '')}/api/embed`;
}

function resolveOllamaModel(): string {
  return String(process.env.OLLAMA_MODEL || 'nomic-embed-text').trim();
}

const CIRCUIT_BREAKER_FAILS = Math.max(1, Number(process.env.ARTICLE_INGESTOR_POOL_CIRCUIT_FAILS || 3));
const CIRCUIT_BREAKER_OPEN_MS = Math.max(60_000, Number(process.env.ARTICLE_INGESTOR_POOL_CIRCUIT_OPEN_MS || (5 * 60 * 1000)));
const logger = createLogger('article-ingestor');
const poolManager = createManagedPgPool({
  name: 'article-ingestor',
  max: 4,
  idleTimeoutMillis: 30_000,
  allowExitOnIdle: true,
  maxFailures: CIRCUIT_BREAKER_FAILS,
  cooldownMs: CIRCUIT_BREAKER_OPEN_MS,
  logger,
});
const getPool = () => poolManager.getPool();
const recordPoolFailure = (error: unknown) => poolManager.recordFailure(error);
const recordPoolSuccess = () => poolManager.recordSuccess();

export async function closeIngestorPool(): Promise<void> {
  await poolManager.close();
}

export function getArticleIngestorCircuitState(): { consecutiveFailures: number; disabledUntil: number; lastError: string } {
  return poolManager.getCircuitState();
}

// ---------------------------------------------------------------------------
// Schema bootstrap
// ---------------------------------------------------------------------------

let schemaReady = false;

async function ensureSchema(client: PoolClient): Promise<void> {
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
  client: PoolClient,
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
  client: PoolClient,
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

async function refreshSensitivityMatrixForTargets(
  client: PoolClient,
  targets: SensitivityTarget[],
): Promise<void> {
  const uniqueTargets = Array.from(new Map(
    targets
      .filter((target) => target.theme && target.symbol && target.horizon)
      .map((target) => [`${target.theme}|${target.symbol}|${target.horizon}`, target]),
  ).values());

  if (uniqueTargets.length === 0) return;

  const values: unknown[] = [];
  const tuples = uniqueTargets.map((target, index) => {
    const offset = index * 3;
    values.push(target.theme, target.symbol, target.horizon);
    return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
  }).join(', ');

  await client.query(`
    WITH targets(theme, symbol, horizon) AS (
      VALUES ${tuples}
    ),
    theme_returns AS (
      SELECT
        lo.theme,
        lo.symbol,
        lo.horizon,
        COUNT(*)::int AS sample_size,
        AVG(lo.forward_return_pct::numeric)::double precision AS avg_return,
        STDDEV(lo.forward_return_pct::numeric)::double precision AS return_vol,
        AVG(lo.hit::int::numeric)::double precision AS hit_rate
      FROM labeled_outcomes lo
      JOIN targets t
        ON t.theme = lo.theme
       AND t.symbol = lo.symbol
       AND t.horizon = lo.horizon
      GROUP BY lo.theme, lo.symbol, lo.horizon
    ),
    symbol_baselines AS (
      SELECT
        lo.symbol,
        lo.horizon,
        AVG(lo.forward_return_pct::numeric)::double precision AS baseline_return,
        STDDEV(lo.forward_return_pct::numeric)::double precision AS baseline_vol
      FROM labeled_outcomes lo
      JOIN (
        SELECT DISTINCT symbol, horizon
        FROM targets
      ) th
        ON th.symbol = lo.symbol
       AND th.horizon = lo.horizon
      GROUP BY lo.symbol, lo.horizon
    )
    INSERT INTO stock_sensitivity_matrix (
      theme,
      symbol,
      horizon,
      sample_size,
      avg_return,
      hit_rate,
      return_vol,
      sensitivity_zscore,
      baseline_return,
      baseline_vol
    )
    SELECT
      tr.theme,
      tr.symbol,
      tr.horizon,
      tr.sample_size,
      tr.avg_return,
      tr.hit_rate,
      tr.return_vol,
      CASE
        WHEN COALESCE(sb.baseline_vol, 0) > 0.01
          THEN (tr.avg_return - sb.baseline_return) / sb.baseline_vol
        ELSE 0
      END AS sensitivity_zscore,
      sb.baseline_return,
      sb.baseline_vol
    FROM theme_returns tr
    JOIN symbol_baselines sb
      ON sb.symbol = tr.symbol
     AND sb.horizon = tr.horizon
    ON CONFLICT (theme, symbol, horizon) DO UPDATE SET
      sample_size = EXCLUDED.sample_size,
      avg_return = EXCLUDED.avg_return,
      hit_rate = EXCLUDED.hit_rate,
      return_vol = EXCLUDED.return_vol,
      sensitivity_zscore = EXCLUDED.sensitivity_zscore,
      baseline_return = EXCLUDED.baseline_return,
      baseline_vol = EXCLUDED.baseline_vol,
      updated_at = NOW()
  `, values);
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
  if (!db) {
    return {
      articleId: -1,
      theme: article.theme ?? 'unknown',
      pendingCount: 0,
    };
  }
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
      recordPoolSuccess();
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

    // Update Hawkes intensity for this theme (incremental)
    try {
      const today = new Date().toISOString().slice(0, 10);
      // Increment today's article count
      await db.query(`
        INSERT INTO event_hawkes_intensity (theme, event_date, article_count, hawkes_intensity, normalized_temperature, is_surge)
        VALUES ($1, $2::date, 1, 1, 0, false)
        ON CONFLICT (theme, event_date) DO UPDATE SET
          article_count = event_hawkes_intensity.article_count + 1,
          hawkes_intensity = event_hawkes_intensity.hawkes_intensity + 1,
          updated_at = NOW()
      `, [theme, today]);
    } catch { /* non-fatal */ }

    recordPoolSuccess();
    return { articleId, theme, pendingCount };
  } catch (error) {
    recordPoolFailure(error);
    throw error;
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
  if (!db) {
    return { ingested, skippedDuplicates: articles.length };
  }
  const client = await db.connect();
  let existingTitles: Set<string>;

  try {
    await ensureSchema(client);

    const titles = articles.map((a) => a.title);
    const existing = await client.query<{ title: string }>(
      'SELECT title FROM articles WHERE title = ANY($1::text[])',
      [titles],
    );
    recordPoolSuccess();
    existingTitles = new Set(existing.rows.map((r) => r.title));
  } catch (error) {
    recordPoolFailure(error);
    throw error;
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
  if (!db) {
    return { completed: 0, remaining: 0 };
  }
  const client = await db.connect();
  let completed = 0;
  const refreshedTargets: SensitivityTarget[] = [];

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

      refreshedTargets.push({
        theme: row.theme,
        symbol: row.symbol,
        horizon: row.horizon,
      });

      // Update pending_outcomes
      await client.query(`
        UPDATE pending_outcomes
        SET status = 'completed', exit_price = $1, forward_return_pct = $2, resolved_at = NOW()
        WHERE id = $3
      `, [exitPrice, forwardReturnPct, row.id]);

      completed++;
    }

    if (refreshedTargets.length > 0) {
      try {
        await refreshSensitivityMatrixForTargets(client, refreshedTargets);
      } catch (error) {
        logger.error('refreshSensitivityMatrixForTargets failed', { error: String(error) });
      }
    }

    // Count remaining
    const remainingResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pending_outcomes WHERE status = 'pending'`,
    );
    const remaining = Number(remainingResult.rows[0]?.count ?? 0);

    recordPoolSuccess();
    return { completed, remaining };
  } catch (error) {
    recordPoolFailure(error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get aggregate ingestor statistics.
 */
export async function getIngestorStats(): Promise<IngestorStats> {
  const db = getPool();
  if (!db) {
    return {
      totalArticles: 0,
      todayArticles: 0,
      pendingOutcomes: 0,
      recentThemes: [],
    };
  }
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

      recordPoolSuccess();
      return {
        totalArticles: Number(totalRes.rows[0]?.count ?? 0),
        todayArticles: Number(todayRes.rows[0]?.count ?? 0),
        pendingOutcomes: Number(pendingRes.rows[0]?.count ?? 0),
        recentThemes: themesRes.rows.map((r) => r.theme),
      };
    } catch (error) {
      recordPoolFailure(error);
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
