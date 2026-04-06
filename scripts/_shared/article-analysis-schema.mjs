export async function ensureArticleAnalysisTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS article_analysis (
      article_id INTEGER PRIMARY KEY,
      keywords TEXT[] DEFAULT '{}',
      entities JSONB DEFAULT '{}'::jsonb,
      sentiment TEXT DEFAULT 'neutral',
      confidence DOUBLE PRECISION DEFAULT 0,
      theme TEXT,
      method TEXT DEFAULT 'unknown',
      metadata JSONB DEFAULT '{}'::jsonb,
      analyzed_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE article_analysis
      ADD COLUMN IF NOT EXISTS theme TEXT;
    ALTER TABLE article_analysis
      ADD COLUMN IF NOT EXISTS method TEXT DEFAULT 'unknown';
    ALTER TABLE article_analysis
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

    CREATE INDEX IF NOT EXISTS idx_article_analysis_theme
      ON article_analysis (theme);
    CREATE INDEX IF NOT EXISTS idx_article_analysis_method
      ON article_analysis (method);

    CREATE TABLE IF NOT EXISTS auto_trend_keywords (
      id SERIAL PRIMARY KEY,
      keyword TEXT UNIQUE,
      source TEXT DEFAULT 'auto-extracted',
      article_count INTEGER DEFAULT 0,
      score DOUBLE PRECISION DEFAULT 0,
      first_seen DATE,
      last_seen DATE,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      metadata JSONB DEFAULT '{}'::jsonb
    );

    ALTER TABLE auto_trend_keywords
      ADD COLUMN IF NOT EXISTS score DOUBLE PRECISION DEFAULT 0;
    ALTER TABLE auto_trend_keywords
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

    CREATE INDEX IF NOT EXISTS idx_auto_trend_keywords_score
      ON auto_trend_keywords (score DESC, article_count DESC);
  `);
}
