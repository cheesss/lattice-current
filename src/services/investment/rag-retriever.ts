import pg from 'pg';

export interface SimilarCaseOutcome {
  symbol: string;
  horizon: string;
  returnPct: number;
  hit: boolean;
}

export interface SimilarCase {
  articleId: number;
  title: string;
  publishedAt: Date;
  similarity: number;
  outcomes: SimilarCaseOutcome[];
}

export interface RetrieveSimilarCasesOptions {
  topK?: number;
  theme?: string;
  minSimilarity?: number;
}

export interface RagHitRateSummary {
  hitRate: number;
  avgReturn: number;
  caseCount: number;
  confidence: number;
}

interface SimilarCaseRow {
  article_id: number;
  title: string;
  published_at: Date | string;
  similarity: number | string;
  symbol: string | null;
  horizon: string | null;
  forward_return_pct: number | string | null;
  hit: boolean | null;
}

interface OllamaEmbedResponse {
  embedding?: unknown;
  embeddings?: unknown;
}

interface RagDatabaseConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  max: number;
  idleTimeoutMillis: number;
  allowExitOnIdle: boolean;
}

export interface RagRuntimeStatus {
  enabled: boolean;
  reason: string | null;
  databaseConfigured: boolean;
  embeddingConfigured: boolean;
}

const DEFAULT_TOP_K = 10;
const DEFAULT_MIN_SIMILARITY = 0.3;
const DEFAULT_HORIZON = '2w';

let ragPool: pg.Pool | null = null;
let ragPoolCacheKey: string | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parsePort(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolveEmbedEndpoint(): string | null {
  const base = String(process.env.OLLAMA_API_URL || process.env.OLLAMA_BASE_URL || '').trim();
  if (!base) return null;
  return base.endsWith('/api/embed') ? base : `${base.replace(/\/+$/, '')}/api/embed`;
}

function resolveOllamaModel(): string | null {
  const model = String(process.env.OLLAMA_MODEL || '').trim();
  return model || null;
}

function resolveRagDatabaseConfig(): RagDatabaseConfig | null {
  const connectionString = String(process.env.RAG_PG_URL || process.env.INTEL_PG_URL || '').trim();
  if (connectionString) {
    return {
      connectionString,
      max: 4,
      idleTimeoutMillis: 30_000,
      allowExitOnIdle: true,
    };
  }

  const host = String(process.env.RAG_PG_HOST || process.env.PG_HOST || '').trim();
  const port = parsePort(process.env.RAG_PG_PORT || process.env.PG_PORT);
  const database = String(process.env.RAG_PG_DATABASE || process.env.PG_DATABASE || process.env.PGDATABASE || '').trim();
  const user = String(process.env.RAG_PG_USER || process.env.PG_USER || process.env.PGUSER || '').trim();
  const password = String(process.env.RAG_PG_PASSWORD || process.env.PG_PASSWORD || process.env.PGPASSWORD || '').trim();

  if (!(host && port && database && user && password)) {
    return null;
  }

  return {
    host,
    port,
    database,
    user,
    password,
    max: 4,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  };
}

function ragPoolKey(config: RagDatabaseConfig): string {
  return JSON.stringify({
    connectionString: config.connectionString || null,
    host: config.host || null,
    port: config.port || null,
    database: config.database || null,
    user: config.user || null,
  });
}

function getRagPool(): pg.Pool | null {
  const config = resolveRagDatabaseConfig();
  if (!config) return null;
  const nextKey = ragPoolKey(config);
  if (ragPool && ragPoolCacheKey === nextKey) return ragPool;
  if (ragPool) {
    void ragPool.end().catch(() => {});
  }
  ragPool = new pg.Pool(config);
  ragPoolCacheKey = nextKey;
  return ragPool;
}

export async function closeRagPool(): Promise<void> {
  if (!ragPool) return;
  const pool = ragPool;
  ragPool = null;
  ragPoolCacheKey = null;
  await pool.end().catch(() => {});
}

export function getRagRuntimeStatus(): RagRuntimeStatus {
  const dbConfig = resolveRagDatabaseConfig();
  const embeddingConfigured = Boolean(resolveEmbedEndpoint() && resolveOllamaModel());
  return {
    enabled: Boolean(dbConfig) && embeddingConfigured,
    reason: dbConfig
      ? (embeddingConfigured ? null : 'Ollama embedding config is missing. Set OLLAMA_API_URL or OLLAMA_BASE_URL plus OLLAMA_MODEL.')
      : 'RAG database config is missing. Set RAG_PG_URL or RAG_PG_HOST/RAG_PG_PORT/RAG_PG_DATABASE/RAG_PG_USER/RAG_PG_PASSWORD.',
    databaseConfigured: Boolean(dbConfig),
    embeddingConfigured,
  };
}

function toVectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number(value) || 0).join(',')}]`;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function asNumber(value: number | string | null | undefined): number {
  return Number(value) || 0;
}

function readEmbeddingFromResponse(payload: OllamaEmbedResponse): number[] {
  if (Array.isArray(payload.embedding) && payload.embedding.every((value) => typeof value === 'number')) {
    return payload.embedding;
  }
  if (Array.isArray(payload.embeddings) && Array.isArray(payload.embeddings[0])) {
    const embedding = payload.embeddings[0];
    if (embedding.every((value) => typeof value === 'number')) {
      return embedding;
    }
  }
  throw new Error('[rag-retriever] Ollama returned an invalid embedding payload');
}

export async function getEmbedding(text: string): Promise<number[]> {
  const endpoint = resolveEmbedEndpoint();
  const model = resolveOllamaModel();
  if (!(endpoint && model)) {
    throw new Error('[rag-retriever] Missing Ollama embed config. Set OLLAMA_API_URL or OLLAMA_BASE_URL and OLLAMA_MODEL.');
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: text,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`[rag-retriever] Ollama ${response.status}: ${await response.text()}`);
  }
  const payload = await response.json() as OllamaEmbedResponse;
  const embedding = readEmbeddingFromResponse(payload);
  if (embedding.length === 0) {
    throw new Error('[rag-retriever] Ollama returned an empty embedding');
  }
  return embedding;
}

export async function retrieveSimilarCases(
  queryEmbedding: number[],
  beforeTimestamp: Date,
  options: RetrieveSimilarCasesOptions = {},
): Promise<SimilarCase[]> {
  if (queryEmbedding.length === 0) return [];
  const pool = getRagPool();
  if (!pool) return [];

  const topK = Math.max(1, Math.floor(options.topK ?? DEFAULT_TOP_K));
  const minSimilarity = clamp(options.minSimilarity ?? DEFAULT_MIN_SIMILARITY, 0, 1);
  const result = await pool.query<SimilarCaseRow>(
    `
      WITH ranked_articles AS (
        SELECT
          a.id,
          a.title,
          a.published_at,
          1 - (a.embedding <=> $1::vector) AS similarity
        FROM articles a
        WHERE a.embedding IS NOT NULL
          AND a.published_at < $2
          AND ($3::text IS NULL OR a.theme = $3)
          AND (1 - (a.embedding <=> $1::vector)) >= $4
        ORDER BY a.embedding <=> $1::vector ASC, a.published_at DESC
        LIMIT $5
      )
      SELECT
        ranked_articles.id AS article_id,
        ranked_articles.title,
        ranked_articles.published_at,
        ranked_articles.similarity,
        labeled_outcomes.symbol,
        labeled_outcomes.horizon,
        labeled_outcomes.forward_return_pct,
        labeled_outcomes.hit
      FROM ranked_articles
      LEFT JOIN labeled_outcomes
        ON labeled_outcomes.article_id = ranked_articles.id
      ORDER BY ranked_articles.similarity DESC, ranked_articles.published_at DESC, labeled_outcomes.symbol ASC, labeled_outcomes.horizon ASC
    `,
    [
      toVectorLiteral(queryEmbedding),
      beforeTimestamp.toISOString(),
      options.theme ?? null,
      minSimilarity,
      topK,
    ],
  );

  const cases = new Map<number, SimilarCase>();
  for (const row of result.rows) {
    const existing = cases.get(row.article_id);
    const baseCase = existing ?? {
      articleId: row.article_id,
      title: row.title,
      publishedAt: asDate(row.published_at),
      similarity: clamp(asNumber(row.similarity), 0, 1),
      outcomes: [],
    };
    if (row.symbol && row.horizon && row.forward_return_pct !== null) {
      baseCase.outcomes.push({
        symbol: row.symbol,
        horizon: row.horizon,
        returnPct: asNumber(row.forward_return_pct),
        hit: Boolean(row.hit),
      });
    }
    cases.set(row.article_id, baseCase);
  }

  return Array.from(cases.values());
}

export function computeRagHitRate(
  cases: SimilarCase[],
  horizon = DEFAULT_HORIZON,
): RagHitRateSummary {
  const caseSummaries = cases
    .map((similarCase) => {
      const outcomes = similarCase.outcomes.filter((outcome) => outcome.horizon === horizon);
      if (outcomes.length === 0) return null;
      const avgReturn = outcomes.reduce((sum, outcome) => sum + outcome.returnPct, 0) / outcomes.length;
      return {
        hit: outcomes.some((outcome) => outcome.hit),
        avgReturn,
      };
    })
    .filter((summary): summary is { hit: boolean; avgReturn: number } => Boolean(summary));

  if (caseSummaries.length === 0) {
    return {
      hitRate: 0,
      avgReturn: 0,
      caseCount: 0,
      confidence: 0,
    };
  }

  const hitCount = caseSummaries.filter((summary) => summary.hit).length;
  const avgReturn = caseSummaries.reduce((sum, summary) => sum + summary.avgReturn, 0) / caseSummaries.length;
  const caseCount = caseSummaries.length;
  return {
    hitRate: hitCount / caseCount,
    avgReturn,
    caseCount,
    confidence: Math.min(caseCount / 10, 1),
  };
}

if (typeof process !== 'undefined' && process.on) {
  const shutdownRagPool = () => { void closeRagPool(); };
  process.on('SIGTERM', shutdownRagPool);
  process.on('SIGINT', shutdownRagPool);
}
