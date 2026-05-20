#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig, resolveOllamaChatConfig } from './_shared/nas-runtime.mjs';
import { ensureArticleAnalysisTables } from './_shared/article-analysis-schema.mjs';
import { classifyArticleAgainstTaxonomy, resolveThemeTaxonomy } from './_shared/theme-taxonomy.mjs';
import { scoreThemeSymbolMappings } from './_shared/theme-symbol-quality.mjs';
import { createWhereBuilder } from './_shared/query-builder.mjs';
import { ensureCuratedThemeSymbols } from './migrations/seed-theme-symbols-curation.mjs';

loadOptionalEnvFile();

const { Client } = pg;
const DEFAULT_LIMIT = 10000;
const STEP_SET = new Set([1, 2, 3, 4, 5]);
export const AUTO_THEME_CONFIDENT_THRESHOLD = 0.72;
export const AUTO_THEME_UNCERTAIN_THRESHOLD = 0.62;
export const OUTCOME_HORIZONS = Object.freeze([
  { name: '1w', days: 7 },
  { name: '2w', days: 14 },
  { name: '1m', days: 30 },
]);
const AUTO_THEME_UPSERT_CHUNK_SIZE = 400;
let pgConfig = null;
let pgConfigError = null;

function getPgConfig() {
  if (!pgConfig && !pgConfigError) {
    try {
      pgConfig = resolveNasPgConfig();
    } catch (error) {
      pgConfigError = error;
    }
  }
  if (!pgConfig) {
    throw pgConfigError;
  }
  return pgConfig;
}

export function classifyAutoThemeCandidate(bestTheme, bestSim) {
  const similarity = Number(bestSim);
  const normalizedTheme = typeof bestTheme === 'string' && bestTheme.trim().length > 0
    ? bestTheme.trim()
    : 'unknown';

  if (Number.isFinite(similarity) && similarity >= AUTO_THEME_CONFIDENT_THRESHOLD) {
    return {
      autoTheme: normalizedTheme,
      confidence: similarity,
      tier: 'confident',
    };
  }
  if (Number.isFinite(similarity) && similarity >= AUTO_THEME_UNCERTAIN_THRESHOLD) {
    return {
      autoTheme: normalizedTheme,
      confidence: similarity,
      tier: 'uncertain',
    };
  }
  return {
    autoTheme: 'unknown',
    confidence: Number.isFinite(similarity) ? similarity : 0,
    tier: 'unknown',
  };
}

function normalizeThemeLabel(value) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeKeywordArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

export function buildAutoThemeRecord(candidate, bestThemeArg, bestSimArg, methodArg = 'embedding-batch') {
  const candidateRow = typeof candidate === 'object' && candidate
    ? candidate
    : {
      article_id: candidate,
      best_theme: bestThemeArg,
      best_sim: bestSimArg,
    };
  const articleId = Number(candidateRow.article_id || candidateRow.articleId);
  const bestTheme = candidateRow.best_theme || candidateRow.bestTheme || bestThemeArg;
  const bestSim = Number(candidateRow.best_sim ?? candidateRow.bestSim ?? bestSimArg ?? 0);
  const taxonomyMatch = classifyArticleAgainstTaxonomy({
    title: candidateRow.title,
    source: candidateRow.source,
    keywords: normalizeKeywordArray(candidateRow.keywords),
    embeddingTheme: bestTheme,
    embeddingSimilarity: bestSim,
  });
  const classification = classifyAutoThemeCandidate(bestTheme, bestSim);
  const sourceTheme = normalizeThemeLabel(bestTheme);
  const taxonomySourceTheme = taxonomyMatch.theme !== 'unknown'
    ? taxonomyMatch.theme
    : classification.autoTheme !== 'unknown'
      ? classification.autoTheme
      : null;
  const taxonomy = resolveThemeTaxonomy(taxonomySourceTheme);
  const canonicalTheme = taxonomy.themeKey
    || (taxonomyMatch.theme !== 'unknown' ? taxonomyMatch.theme : null)
    || (classification.autoTheme !== 'unknown' ? classification.autoTheme : null);
  const effectiveConfidence = Math.max(
    Number(classification.confidence || 0),
    Number(taxonomyMatch.confidence || 0),
  );
  const effectiveClassification = classifyAutoThemeCandidate(canonicalTheme, effectiveConfidence);

  return {
    articleId,
    autoTheme: canonicalTheme || effectiveClassification.autoTheme,
    sourceTheme,
    confidence: effectiveClassification.confidence,
    confidenceTier: effectiveClassification.tier,
    method: methodArg,
    themeKey: taxonomy.themeKey,
    themeLabel: taxonomy.themeLabel,
    themeType: taxonomy.themeType,
    parentTheme: taxonomy.parentTheme,
    parentThemeLabel: taxonomy.parentThemeLabel,
    themeCategory: taxonomy.category,
    lifecycleHint: taxonomy.lifecycleHint,
    taxonomyVersion: taxonomy.taxonomyVersion,
  };
}

export async function bulkUpsertAutoArticleThemes(client, records) {
  if (!Array.isArray(records) || records.length === 0) {
    return 0;
  }

  let processed = 0;
  for (let offset = 0; offset < records.length; offset += AUTO_THEME_UPSERT_CHUNK_SIZE) {
    const chunk = records.slice(offset, offset + AUTO_THEME_UPSERT_CHUNK_SIZE);
    const values = [];
    const placeholders = chunk.map((record, index) => {
      const base = index * 14;
      values.push(
        record.articleId,
        record.autoTheme,
        record.sourceTheme,
        record.confidence,
        record.confidenceTier,
        record.method,
        record.themeKey,
        record.themeLabel,
        record.themeType,
        record.parentTheme,
        record.parentThemeLabel,
        record.themeCategory,
        record.lifecycleHint,
        record.taxonomyVersion,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14})`;
    }).join(',\n');

    await client.query(`
      INSERT INTO auto_article_themes (
        article_id, auto_theme, source_theme, confidence, confidence_tier, method,
        theme_key, theme_label, theme_type, parent_theme, parent_theme_label,
        theme_category, lifecycle_hint, taxonomy_version
      )
      VALUES ${placeholders}
      ON CONFLICT (article_id) DO UPDATE SET
        auto_theme = EXCLUDED.auto_theme,
        source_theme = EXCLUDED.source_theme,
        confidence = EXCLUDED.confidence,
        confidence_tier = EXCLUDED.confidence_tier,
        method = EXCLUDED.method,
        theme_key = EXCLUDED.theme_key,
        theme_label = EXCLUDED.theme_label,
        theme_type = EXCLUDED.theme_type,
        parent_theme = EXCLUDED.parent_theme,
        parent_theme_label = EXCLUDED.parent_theme_label,
        theme_category = EXCLUDED.theme_category,
        lifecycle_hint = EXCLUDED.lifecycle_hint,
        taxonomy_version = EXCLUDED.taxonomy_version,
        updated_at = NOW()
    `, values);

    processed += chunk.length;
  }

  return processed;
}

async function fetchUnclassifiedThemeCandidates(client, options) {
  const builder = createWhereBuilder([
    'a.embedding IS NOT NULL',
    'NOT EXISTS (SELECT 1 FROM auto_article_themes t WHERE t.article_id = a.id)',
  ]);

  if (options.since) {
    builder.addValue(options.since, (placeholder) => `a.published_at >= ${placeholder}::timestamptz`);
  }
  const { whereClause, params } = builder.build();
  params.push(options.limit);
  const limitParamIndex = params.length;

  const { rows } = await client.query(`
    SELECT
      a.id AS article_id,
      a.title,
      a.source,
      aa.keywords,
      (
        SELECT lo.theme
        FROM labeled_outcomes lo
        JOIN articles anchor ON anchor.id = lo.article_id
        WHERE lo.horizon = '2w'
          AND anchor.embedding IS NOT NULL
        ORDER BY anchor.embedding <=> a.embedding
        LIMIT 1
      ) AS best_theme,
      (
        SELECT 1 - (anchor.embedding <=> a.embedding)
        FROM articles anchor
        JOIN labeled_outcomes lo ON lo.article_id = anchor.id
        WHERE lo.horizon = '2w'
          AND anchor.embedding IS NOT NULL
        ORDER BY anchor.embedding <=> a.embedding
        LIMIT 1
      ) AS best_sim
    FROM articles a
    LEFT JOIN article_analysis aa ON aa.article_id = a.id
    ${whereClause}
    ORDER BY a.published_at DESC
    LIMIT $${limitParamIndex}
  `, params);

  return rows;
}

async function backfillThemeTaxonomyMetadata(client, limit) {
  const effectiveLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.floor(Number(limit))
    : DEFAULT_LIMIT;

  const { rows } = await client.query(`
    SELECT article_id, auto_theme, confidence, method
    FROM auto_article_themes
    WHERE theme_key IS NULL
       OR theme_category IS NULL
       OR lifecycle_hint IS NULL
       OR confidence_tier IS NULL
       OR taxonomy_version IS NULL
    ORDER BY updated_at DESC NULLS LAST, article_id DESC
    LIMIT $1
  `, [effectiveLimit]);

  const records = rows.map((row) => buildAutoThemeRecord({
    article_id: row.article_id,
    best_theme: row.auto_theme,
    best_sim: row.confidence,
  }, null, null, row.method || 'embedding-batch'));
  return bulkUpsertAutoArticleThemes(client, records);
}

export function parseArgs(argv = process.argv.slice(2)) {
  const result = {
    steps: [],
    since: null,
    limit: DEFAULT_LIMIT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--step' && argv[index + 1]) {
      const step = Number(argv[++index]);
      if (STEP_SET.has(step) && !result.steps.includes(step)) {
        result.steps.push(step);
      }
    } else if (arg === '--since' && argv[index + 1]) {
      result.since = argv[++index];
    } else if (arg === '--limit' && argv[index + 1]) {
      const parsedLimit = Number(argv[++index]);
      if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
        result.limit = Math.floor(parsedLimit);
      }
    }
  }

  return result;
}

function shouldRunStep(step, options) {
  return options.steps.length === 0 || options.steps.includes(step);
}

export async function ensureAutoPipelineTables(client) {
  await ensureArticleAnalysisTables(client);
  await client.query(`
    CREATE TABLE IF NOT EXISTS auto_article_themes (
      article_id INTEGER PRIMARY KEY REFERENCES articles(id),
      auto_theme TEXT,
      source_theme TEXT,
      confidence DOUBLE PRECISION DEFAULT 0,
      confidence_tier TEXT,
      method TEXT DEFAULT 'embedding-cluster',
      theme_key TEXT,
      theme_label TEXT,
      theme_type TEXT,
      parent_theme TEXT,
      parent_theme_label TEXT,
      theme_category TEXT,
      lifecycle_hint TEXT,
      taxonomy_version TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS source_theme TEXT;
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS confidence_tier TEXT;
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS theme_key TEXT;
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS theme_label TEXT;
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS theme_type TEXT;
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS parent_theme TEXT;
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS parent_theme_label TEXT;
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS theme_category TEXT;
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS lifecycle_hint TEXT;
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS taxonomy_version TEXT;

    CREATE INDEX IF NOT EXISTS idx_auto_article_themes_theme_key
      ON auto_article_themes (theme_key, confidence DESC);
    CREATE INDEX IF NOT EXISTS idx_auto_article_themes_parent_theme
      ON auto_article_themes (parent_theme, confidence DESC);
    CREATE INDEX IF NOT EXISTS idx_auto_article_themes_theme_category
      ON auto_article_themes (theme_category, confidence DESC);

    CREATE TABLE IF NOT EXISTS auto_theme_symbol_candidates (
      id SERIAL PRIMARY KEY,
      theme TEXT NOT NULL,
      symbol TEXT NOT NULL,
      avg_abs_reaction DOUBLE PRECISION,
      reaction_count INTEGER,
      baseline_avg_abs DOUBLE PRECISION,
      reaction_ratio DOUBLE PRECISION,
      event_avg_return DOUBLE PRECISION,
      baseline_avg_return DOUBLE PRECISION,
      event_hit_rate DOUBLE PRECISION,
      baseline_hit_rate DOUBLE PRECISION,
      specificity_score DOUBLE PRECISION,
      directional_edge DOUBLE PRECISION,
      return_shift DOUBLE PRECISION,
      theme_coverage_count INTEGER,
      generic_penalty DOUBLE PRECISION,
      outcome_count INTEGER,
      outcome_hit_rate DOUBLE PRECISION,
      outcome_avg_return DOUBLE PRECISION,
      quality_score DOUBLE PRECISION,
      eligible BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_auto_theme_symbol_candidates_theme
      ON auto_theme_symbol_candidates (theme, quality_score DESC);
    CREATE INDEX IF NOT EXISTS idx_auto_theme_symbol_candidates_symbol
      ON auto_theme_symbol_candidates (symbol, quality_score DESC);

    ALTER TABLE auto_theme_symbol_candidates
      ADD COLUMN IF NOT EXISTS outcome_count INTEGER;
    ALTER TABLE auto_theme_symbol_candidates
      ADD COLUMN IF NOT EXISTS outcome_hit_rate DOUBLE PRECISION;
    ALTER TABLE auto_theme_symbol_candidates
      ADD COLUMN IF NOT EXISTS outcome_avg_return DOUBLE PRECISION;

    CREATE TABLE IF NOT EXISTS auto_theme_symbols (
      id SERIAL PRIMARY KEY,
      theme TEXT NOT NULL,
      symbol TEXT NOT NULL,
      avg_abs_reaction DOUBLE PRECISION,
      reaction_count INTEGER,
      baseline_avg_abs DOUBLE PRECISION,
      correlation DOUBLE PRECISION,
      event_avg_return DOUBLE PRECISION,
      baseline_avg_return DOUBLE PRECISION,
      event_hit_rate DOUBLE PRECISION,
      baseline_hit_rate DOUBLE PRECISION,
      specificity_score DOUBLE PRECISION,
      directional_edge DOUBLE PRECISION,
      return_shift DOUBLE PRECISION,
      theme_coverage_count INTEGER,
      generic_penalty DOUBLE PRECISION,
      outcome_count INTEGER,
      outcome_hit_rate DOUBLE PRECISION,
      outcome_avg_return DOUBLE PRECISION,
      quality_score DOUBLE PRECISION,
      method TEXT DEFAULT 'price-reaction-quality',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(theme, symbol)
    );

    ALTER TABLE auto_theme_symbols
      ADD COLUMN IF NOT EXISTS baseline_avg_abs DOUBLE PRECISION;
    ALTER TABLE auto_theme_symbols
      ADD COLUMN IF NOT EXISTS event_avg_return DOUBLE PRECISION;
    ALTER TABLE auto_theme_symbols
      ADD COLUMN IF NOT EXISTS baseline_avg_return DOUBLE PRECISION;
    ALTER TABLE auto_theme_symbols
      ADD COLUMN IF NOT EXISTS event_hit_rate DOUBLE PRECISION;
    ALTER TABLE auto_theme_symbols
      ADD COLUMN IF NOT EXISTS baseline_hit_rate DOUBLE PRECISION;
    ALTER TABLE auto_theme_symbols
      ADD COLUMN IF NOT EXISTS specificity_score DOUBLE PRECISION;
    ALTER TABLE auto_theme_symbols
      ADD COLUMN IF NOT EXISTS directional_edge DOUBLE PRECISION;
    ALTER TABLE auto_theme_symbols
      ADD COLUMN IF NOT EXISTS return_shift DOUBLE PRECISION;
    ALTER TABLE auto_theme_symbols
      ADD COLUMN IF NOT EXISTS theme_coverage_count INTEGER;
    ALTER TABLE auto_theme_symbols
      ADD COLUMN IF NOT EXISTS generic_penalty DOUBLE PRECISION;
    ALTER TABLE auto_theme_symbols
      ADD COLUMN IF NOT EXISTS outcome_count INTEGER;
    ALTER TABLE auto_theme_symbols
      ADD COLUMN IF NOT EXISTS outcome_hit_rate DOUBLE PRECISION;
    ALTER TABLE auto_theme_symbols
      ADD COLUMN IF NOT EXISTS outcome_avg_return DOUBLE PRECISION;
    ALTER TABLE auto_theme_symbols
      ADD COLUMN IF NOT EXISTS quality_score DOUBLE PRECISION;
  `);
}

async function step1ClassifyThemes(client, options) {
  await ensureAutoPipelineTables(client);
  const scoredRows = await fetchUnclassifiedThemeCandidates(client, options);
  const records = scoredRows.map((row) => buildAutoThemeRecord(row, null, null, 'embedding-batch'));

  await bulkUpsertAutoArticleThemes(client, records);
  await backfillThemeTaxonomyMetadata(
    client,
    Math.max(Number(options.limit) || DEFAULT_LIMIT, AUTO_THEME_UPSERT_CHUNK_SIZE),
  );

  const { rows } = await client.query(`
    SELECT auto_theme, COUNT(*)::int AS count
    FROM auto_article_themes
    GROUP BY auto_theme
    ORDER BY count DESC, auto_theme
  `);
  return rows;
}

async function fetchThemeSymbolMetrics(client) {
  const { rows } = await client.query(`
    WITH event_dates_by_theme AS (
      SELECT t.auto_theme AS theme, DATE(a.published_at) AS d
      FROM auto_article_themes t
      JOIN articles a ON a.id = t.article_id
      WHERE t.auto_theme IS NOT NULL
        AND t.auto_theme <> 'unknown'
      GROUP BY t.auto_theme, DATE(a.published_at)
      UNION
      SELECT dta.topic_id AS theme, DATE(a.published_at) AS d
      FROM discovery_topic_articles dta
      JOIN discovery_topics dt
        ON dt.id = dta.topic_id
       AND dt.status = 'labeled'
      JOIN articles a ON a.id = dta.article_id
      GROUP BY dta.topic_id, DATE(a.published_at)
    ),
    theme_date_counts AS (
      SELECT theme, COUNT(DISTINCT d) AS date_count
      FROM event_dates_by_theme
      GROUP BY theme
      HAVING COUNT(DISTINCT d) >= 10
    ),
    daily_returns AS (
      SELECT
        h.symbol,
        DATE(h.valid_time_start) AS d,
        CASE
          WHEN LAG(h.price::float) OVER (PARTITION BY h.symbol ORDER BY h.valid_time_start) > 0
          THEN (h.price::float - LAG(h.price::float) OVER (PARTITION BY h.symbol ORDER BY h.valid_time_start))
             / LAG(h.price::float) OVER (PARTITION BY h.symbol ORDER BY h.valid_time_start) * 100
          ELSE NULL
        END AS ret
      FROM worldmonitor_intel.historical_raw_items h
      WHERE h.provider = 'yahoo-chart'
        AND h.price IS NOT NULL
    ),
    baselines AS (
      SELECT
        symbol,
        AVG(ABS(ret)) AS baseline_avg_abs,
        AVG(ret) AS baseline_avg_return,
        AVG(CASE WHEN ret > 0 THEN 1 ELSE 0 END) AS baseline_hit_rate
      FROM daily_returns
      WHERE ret IS NOT NULL
      GROUP BY symbol
    ),
    reactions AS (
      SELECT
        e.theme,
        dr.symbol,
        AVG(ABS(dr.ret)) AS event_avg_abs,
        COUNT(*)::int AS reaction_count,
        AVG(dr.ret) AS event_avg_return,
        AVG(CASE WHEN dr.ret > 0 THEN 1 ELSE 0 END) AS event_hit_rate,
        STDDEV(dr.ret) AS event_return_vol
      FROM daily_returns dr
      JOIN event_dates_by_theme e ON e.d = dr.d
      JOIN theme_date_counts tdc ON tdc.theme = e.theme
      WHERE dr.ret IS NOT NULL
      GROUP BY e.theme, dr.symbol
      HAVING COUNT(*) >= 10
    ),
    outcome_metrics AS (
      SELECT
        theme,
        symbol,
        COUNT(*)::int AS outcome_count,
        AVG(hit::int::numeric) AS outcome_hit_rate,
        AVG(forward_return_pct::numeric) AS outcome_avg_return
      FROM labeled_outcomes
      WHERE horizon = '2w'
      GROUP BY theme, symbol
    )
    SELECT
      r.theme,
      r.symbol,
      r.event_avg_abs,
      r.reaction_count,
      b.baseline_avg_abs,
      CASE
        WHEN COALESCE(b.baseline_avg_abs, 0) > 0.01 THEN r.event_avg_abs / b.baseline_avg_abs
        ELSE 1
      END AS reaction_ratio,
      r.event_avg_return,
      b.baseline_avg_return,
      r.event_hit_rate,
      b.baseline_hit_rate,
      r.event_return_vol,
      om.outcome_count,
      om.outcome_hit_rate,
      om.outcome_avg_return
    FROM reactions r
    JOIN baselines b ON b.symbol = r.symbol
    LEFT JOIN outcome_metrics om
      ON om.theme = r.theme
     AND om.symbol = r.symbol
  `);
  return rows;
}

function rankThemeMappings(scoredRows, perThemeLimit = 12) {
  const ranked = [];
  const byTheme = new Map();
  for (const row of scoredRows) {
    const bucket = byTheme.get(row.theme) || [];
    bucket.push(row);
    byTheme.set(row.theme, bucket);
  }

  for (const [theme, rows] of byTheme.entries()) {
    rows.sort((a, b) => b.quality_score - a.quality_score || b.specificity_score - a.specificity_score);
    rows.forEach((row, index) => {
      ranked.push({ ...row, theme_rank: index + 1, theme });
    });
  }

  return ranked.filter((row) => row.theme_rank <= perThemeLimit);
}

async function bulkReplaceThemeSymbolCandidates(client, scoredRows) {
  await client.query('BEGIN');
  try {
    await client.query('TRUNCATE auto_theme_symbol_candidates RESTART IDENTITY');
    if (scoredRows.length > 0) {
      const values = [];
      const placeholders = scoredRows.map((row, index) => {
        const base = index * 19;
        values.push(
          row.theme,
          row.symbol,
          row.event_avg_abs,
          row.reaction_count,
          row.baseline_avg_abs,
          row.reaction_ratio,
          row.event_avg_return,
          row.baseline_avg_return,
          row.event_hit_rate,
          row.baseline_hit_rate,
          row.specificity_score,
          row.directional_edge,
          row.return_shift,
          row.theme_coverage_count,
          row.generic_penalty,
          row.outcome_count,
          row.outcome_hit_rate,
          row.outcome_avg_return,
          row.quality_score,
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18}, $${base + 19}, NOW(), ${row.eligible ? 'TRUE' : 'FALSE'})`;
      }).join(',\n');

      await client.query(`
        INSERT INTO auto_theme_symbol_candidates (
          theme, symbol, avg_abs_reaction, reaction_count, baseline_avg_abs, reaction_ratio,
          event_avg_return, baseline_avg_return, event_hit_rate, baseline_hit_rate,
          specificity_score, directional_edge, return_shift, theme_coverage_count,
          generic_penalty, outcome_count, outcome_hit_rate, outcome_avg_return,
          quality_score, updated_at, eligible
        )
        VALUES ${placeholders}
      `, values);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function bulkReplaceThemeSymbols(client, acceptedRows) {
  await client.query('BEGIN');
  try {
    await client.query('TRUNCATE auto_theme_symbols RESTART IDENTITY');
    if (acceptedRows.length > 0) {
      const values = [];
      const placeholders = acceptedRows.map((row, index) => {
        const base = index * 19;
        values.push(
          row.theme,
          row.symbol,
          row.event_avg_abs,
          row.reaction_count,
          row.baseline_avg_abs,
          row.reaction_ratio,
          row.event_avg_return,
          row.baseline_avg_return,
          row.event_hit_rate,
          row.baseline_hit_rate,
          row.specificity_score,
          row.directional_edge,
          row.return_shift,
          row.theme_coverage_count,
          row.generic_penalty,
          row.outcome_count,
          row.outcome_hit_rate,
          row.outcome_avg_return,
          row.quality_score,
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18}, $${base + 19}, 'price-reaction-quality', NOW())`;
      }).join(',\n');

      await client.query(`
        INSERT INTO auto_theme_symbols (
          theme, symbol, avg_abs_reaction, reaction_count, baseline_avg_abs, correlation,
          event_avg_return, baseline_avg_return, event_hit_rate, baseline_hit_rate,
          specificity_score, directional_edge, return_shift, theme_coverage_count,
          generic_penalty, outcome_count, outcome_hit_rate, outcome_avg_return,
          quality_score, method, updated_at
        )
        VALUES ${placeholders}
      `, values);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function step2RefreshThemeSymbols(client) {
  await ensureAutoPipelineTables(client);
  const rawMetrics = await fetchThemeSymbolMetrics(client);
  const scoredRows = rankThemeMappings(scoreThemeSymbolMappings(rawMetrics));
  await bulkReplaceThemeSymbolCandidates(client, scoredRows);
  const acceptedRows = scoredRows.filter((row) => row.eligible);
  await bulkReplaceThemeSymbols(client, acceptedRows);
  const fallbackSeed = await ensureCuratedThemeSymbols(client);
  return {
    candidateCount: scoredRows.length,
    acceptedCount: acceptedRows.length,
    fallbackInserted: fallbackSeed.inserted,
    fallbackSkipped: fallbackSeed.skipped,
    topAccepted: acceptedRows.slice(0, 15),
  };
}

async function step3LabelOutcomes(client, options) {
  const builder = createWhereBuilder([
    `t.auto_theme <> 'unknown'`,
    `EXISTS (
      WITH ranked_symbols AS (
        SELECT theme, symbol
        FROM (
          SELECT theme, symbol,
                 ROW_NUMBER() OVER (
                   PARTITION BY theme
                   ORDER BY quality_score DESC NULLS LAST, correlation DESC NULLS LAST, symbol
                 ) AS rn
          FROM auto_theme_symbols
          WHERE symbol IS NOT NULL AND symbol <> ''
        ) ranked
        WHERE ranked.rn <= 5
      ),
      outcome_horizons(horizon, days) AS (
        VALUES ${OUTCOME_HORIZONS.map((h) => `('${h.name}', ${h.days})`).join(', ')}
      )
      SELECT 1
      FROM ranked_symbols rs
      JOIN outcome_horizons oh ON TRUE
      LEFT JOIN labeled_outcomes lo
        ON lo.article_id = t.article_id
       AND lo.symbol = rs.symbol
       AND lo.horizon = oh.horizon
      WHERE rs.theme = t.auto_theme
        AND a.published_at <= NOW() - (oh.days::int * INTERVAL '1 day')
        AND lo.article_id IS NULL
    )`,
  ]);
  if (options.since) {
    builder.addValue(options.since, (placeholder) => `a.published_at >= ${placeholder}::timestamptz`);
  }
  const { whereClause, params: queryParams } = builder.build();
  queryParams.push(options.limit);

  const { rows: articles } = await client.query(`
    SELECT t.article_id, t.auto_theme, a.published_at
      FROM auto_article_themes t
      JOIN articles a ON a.id = t.article_id
      ${whereClause}
     ORDER BY a.published_at DESC
     LIMIT $${queryParams.length}
  `, queryParams);

  if (articles.length === 0) {
    return { articleCount: 0, candidateLabelCount: 0, labeledCount: 0, labeledArticles: 0 };
  }

  const themes = Array.from(new Set(articles.map((row) => row.auto_theme).filter(Boolean)));
  const { rows: symbolRows } = await client.query(`
    SELECT theme, symbol
      FROM (
        SELECT theme, symbol,
               ROW_NUMBER() OVER (
                 PARTITION BY theme
                 ORDER BY quality_score DESC NULLS LAST, correlation DESC NULLS LAST, symbol
               ) AS rn
          FROM auto_theme_symbols
         WHERE theme = ANY($1::text[])
           AND symbol IS NOT NULL AND symbol <> ''
      ) ranked
     WHERE rn <= 5
  `, [themes]);

  const symbolsByTheme = new Map();
  for (const row of symbolRows) {
    const bucket = symbolsByTheme.get(row.theme) || [];
    bucket.push(row.symbol);
    symbolsByTheme.set(row.theme, bucket);
  }
  const symbols = Array.from(new Set(symbolRows.map((row) => row.symbol))).sort();
  if (symbols.length === 0) {
    return { articleCount: articles.length, candidateLabelCount: 0, labeledCount: 0, labeledArticles: 0 };
  }

  const times = articles.map((row) => new Date(row.published_at).getTime()).filter(Number.isFinite);
  const minIso = new Date(Math.min(...times)).toISOString();
  const maxIso = new Date(Math.max(...times) + 45 * 86_400_000).toISOString();
  const { rows: priceRows } = await client.query(`
    SELECT symbol, ts, price
      FROM (
        SELECT symbol, valid_time_start::timestamptz AS ts, price::float AS price, 2 AS source_priority
          FROM worldmonitor_intel.historical_raw_items
         WHERE provider = 'yahoo-chart'
           AND symbol = ANY($1::text[])
           AND price IS NOT NULL
           AND valid_time_start::timestamptz >= $2::timestamptz
           AND valid_time_start::timestamptz <= $3::timestamptz
        UNION ALL
        SELECT symbol, valid_time_start::timestamptz AS ts, price::float AS price, 2 AS source_priority
          FROM raw_items
         WHERE provider = 'yahoo-chart'
           AND symbol = ANY($1::text[])
           AND price IS NOT NULL
           AND valid_time_start::timestamptz >= $2::timestamptz
           AND valid_time_start::timestamptz <= $3::timestamptz
        UNION ALL
        SELECT symbol, observed_at::timestamptz AS ts, last_price::float AS price, 3 AS source_priority
          FROM market_quotes
         WHERE symbol = ANY($1::text[])
           AND last_price IS NOT NULL
           AND observed_at >= $2::timestamptz
           AND observed_at <= $3::timestamptz
      ) price_points
     ORDER BY symbol, ts ASC, source_priority DESC
  `, [symbols, minIso, maxIso]);

  const pricesBySymbol = new Map();
  for (const row of priceRows) {
    const ts = new Date(row.ts).getTime();
    const price = Number(row.price);
    if (!Number.isFinite(ts) || !(price > 0)) continue;
    const bucket = pricesBySymbol.get(row.symbol) || [];
    const last = bucket[bucket.length - 1];
    if (last && last.day === new Date(ts).toISOString().slice(0, 10)) {
      // Query ordering puts higher source_priority first for equal timestamps;
      // for same-day duplicates keep the earliest retained point.
      continue;
    }
    bucket.push({ time: ts, day: new Date(ts).toISOString().slice(0, 10), price });
    pricesBySymbol.set(row.symbol, bucket);
  }

  function firstAtOrAfter(series, targetTime) {
    let lo = 0;
    let hi = series.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid].time < targetTime) lo = mid + 1;
      else hi = mid;
    }
    return lo < series.length ? series[lo] : null;
  }

  const values = [];
  const candidateArticleIds = new Set();
  const insertedArticleIds = new Set();
  let candidateLabelCount = 0;

  for (const article of articles) {
    const articleSymbols = symbolsByTheme.get(article.auto_theme) || [];
    const publishedAt = new Date(article.published_at);
    const pubTime = publishedAt.getTime();
    if (!Number.isFinite(pubTime)) continue;
    for (const symbol of articleSymbols) {
      const series = pricesBySymbol.get(symbol) || [];
      if (series.length < 2) continue;
      const entry = firstAtOrAfter(series, pubTime);
      if (!entry) continue;
      for (const horizon of OUTCOME_HORIZONS) {
        candidateLabelCount += 1;
        const exit = firstAtOrAfter(series, pubTime + horizon.days * 86_400_000);
        if (!exit || !(entry.price > 0) || !(exit.price > 0) || exit.time <= entry.time) continue;
        const returnPct = ((exit.price - entry.price) / entry.price) * 100;
        values.push([
          article.article_id,
          article.auto_theme,
          symbol,
          article.published_at,
          horizon.name,
          entry.price,
          exit.price,
          returnPct,
          returnPct > 0,
        ]);
        candidateArticleIds.add(article.article_id);
      }
    }
  }

  let labeled = 0;
  const chunkSize = 1000;
  for (let offset = 0; offset < values.length; offset += chunkSize) {
    const chunk = values.slice(offset, offset + chunkSize);
    const params = [];
    const placeholders = chunk.map((row, rowIndex) => {
      const base = rowIndex * 9;
      params.push(...row);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
    }).join(',\n');
    const result = await client.query(`
      INSERT INTO labeled_outcomes (
        article_id, theme, symbol, published_at, horizon,
        entry_price, exit_price, forward_return_pct, hit
      )
      VALUES ${placeholders}
      ON CONFLICT (article_id, symbol, horizon) DO NOTHING
      RETURNING article_id
    `, params);
    labeled += result.rows.length;
    for (const row of result.rows) insertedArticleIds.add(row.article_id);
  }

  return {
    articleCount: articles.length,
    candidateLabelCount,
    labeledCount: labeled,
    candidateArticles: candidateArticleIds.size,
    labeledArticles: insertedArticleIds.size,
  };
}

async function step4RefreshAnalysisArtifacts(client, options) {
  await ensureArticleAnalysisTables(client);

  await client.query(`
    WITH keyword_rollup AS (
      SELECT
        LOWER(keyword) AS keyword,
        COUNT(*)::int AS article_count,
        MAX(a.analyzed_at)::date AS last_seen,
        MIN(a.analyzed_at)::date AS first_seen,
        SUM(COALESCE(a.confidence, 0)) AS score
      FROM article_analysis a,
      LATERAL UNNEST(COALESCE(a.keywords, '{}'::text[])) AS keyword
      GROUP BY LOWER(keyword)
      HAVING COUNT(*) >= 3
    )
    INSERT INTO auto_trend_keywords (keyword, source, article_count, score, first_seen, last_seen, metadata)
    SELECT keyword, 'analysis-aggregate', article_count, score, first_seen, last_seen, '{}'::jsonb
    FROM keyword_rollup
    ON CONFLICT (keyword) DO UPDATE SET
      article_count = EXCLUDED.article_count,
      score = EXCLUDED.score,
      first_seen = LEAST(auto_trend_keywords.first_seen, EXCLUDED.first_seen),
      last_seen = GREATEST(auto_trend_keywords.last_seen, EXCLUDED.last_seen),
      source = EXCLUDED.source,
      updated_at = NOW()
  `);

  const summary = {
    trendKeywords: Number((await client.query(`
      SELECT COUNT(*)::int AS count
      FROM auto_trend_keywords
      WHERE source IN ('analysis-aggregate', 'fast-keyword-extractor', 'ollama-article-analyzer')
    `)).rows[0]?.count || 0),
    explanationsGenerated: 0,
  };

  let chatConfig = null;
  try {
    chatConfig = resolveOllamaChatConfig();
  } catch (err) {
    console.warn(`[auto-pipeline] Ollama chat config unavailable, skipping explanations: ${err?.message || err}`);
    return summary;
  }

  const explanationCandidates = await client.query(`
    SELECT ranked.theme, ranked.symbol
    FROM (
      SELECT
        ats.theme,
        ats.symbol,
        ats.quality_score,
        ROW_NUMBER() OVER (
          PARTITION BY ats.theme, ats.symbol
          ORDER BY ats.quality_score DESC NULLS LAST
        ) AS rank_in_pair
      FROM auto_theme_symbols ats
    ) ranked
    WHERE ranked.rank_in_pair = 1
      AND NOT EXISTS (
        SELECT 1
        FROM event_impact_profiles e
        WHERE e.theme = ranked.theme
          AND e.symbol = ranked.symbol
          AND e.causal_explanation IS NOT NULL
      )
    ORDER BY ranked.quality_score DESC NULLS LAST
    LIMIT $1
  `, [Math.min(options.limit, 30)]);

  for (const pair of explanationCandidates.rows) {
    const { rows: titles } = await client.query(`
      SELECT a.title
      FROM articles a
      JOIN auto_article_themes t ON t.article_id = a.id
      WHERE t.auto_theme = $1
      ORDER BY a.published_at DESC
      LIMIT 5
    `, [pair.theme]);

    const prompt = [
      `Summarize why ${pair.symbol} reacts to ${pair.theme} news in exactly one concise Korean sentence.`,
      'This is a causal explanation, not a trading opinion.',
      'Use only the supplied headlines.',
      'Focus on transmission mechanism such as demand, supply, regulation, rates, sentiment, or commodity linkage.',
      'Do not mention prompt rules or add bullet points.',
      '',
      'Context:',
      ...titles.map((row) => `- ${row.title}`),
    ].join('\n');
    try {
      const response = await fetch(chatConfig.endpoint.replace(/\/api\/chat$/, '/api/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: chatConfig.model, prompt, stream: false }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) continue;
      const payload = await response.json();
      const explanation = String(payload.response || '').trim().slice(0, 200);
      if (explanation.length < 8) continue;
      await client.query(`
        UPDATE event_impact_profiles
        SET causal_explanation = $1
        WHERE theme = $2
          AND symbol = $3
          AND causal_explanation IS NULL
      `, [explanation, pair.theme, pair.symbol]);
      summary.explanationsGenerated += 1;
    } catch (err) {
      console.warn(`[auto-pipeline] Explanation generation failed for ${pair.theme}/${pair.symbol} (non-fatal): ${err?.message || err}`);
    }
  }

  return summary;
}

async function step5RefreshSensitivity(client) {
  await client.query(`
    INSERT INTO stock_sensitivity_matrix (
      theme, symbol, horizon, sample_size, avg_return,
      hit_rate, return_vol, sensitivity_zscore, baseline_return, baseline_vol
    )
    SELECT
      tr.theme,
      tr.symbol,
      tr.horizon,
      tr.n,
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
    FROM (
      SELECT
        theme,
        symbol,
        horizon,
        COUNT(*) AS n,
        AVG(COALESCE(abnormal_return, forward_return_pct)::numeric) AS avg_return,
        STDDEV(COALESCE(abnormal_return, forward_return_pct)::numeric) AS return_vol,
        AVG(CASE WHEN COALESCE(abnormal_return, forward_return_pct) > 0 THEN 1.0 ELSE 0.0 END::numeric) AS hit_rate
      FROM labeled_outcomes
      GROUP BY theme, symbol, horizon
    ) tr
    JOIN (
      SELECT
        symbol,
        horizon,
        AVG(forward_return_pct::numeric) AS baseline_return,
        STDDEV(forward_return_pct::numeric) AS baseline_vol
      FROM labeled_outcomes
      GROUP BY symbol, horizon
    ) sb
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
  `);

  const { rows } = await client.query(`
    SELECT COUNT(*)::int AS count
    FROM stock_sensitivity_matrix
  `);
  return { sensitivityCount: Number(rows[0]?.count || 0) };
}

export async function runAutoPipeline(options = {}) {
  const client = new Client(getPgConfig());
  await client.connect();
  const summary = {};

  try {
    if (shouldRunStep(1, options)) summary.step1 = await step1ClassifyThemes(client, options);
    if (shouldRunStep(2, options)) summary.step2 = await step2RefreshThemeSymbols(client);
    if (shouldRunStep(3, options)) summary.step3 = await step3LabelOutcomes(client, options);
    if (shouldRunStep(4, options)) summary.step4 = await step4RefreshAnalysisArtifacts(client, options);
    if (shouldRunStep(5, options)) summary.step5 = await step5RefreshSensitivity(client);
    return summary;
  } finally {
    await client.end();
  }
}

async function main() {
  const options = parseArgs();
  const summary = await runAutoPipeline(options);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
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
