#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import {
  buildAutoThemeRecord,
  bulkUpsertAutoArticleThemes,
  ensureAutoPipelineTables,
} from './auto-pipeline.mjs';
import { ensureArticleAnalysisTables } from './_shared/article-analysis-schema.mjs';
import { ensureEmergingTechSchema } from './_shared/schema-emerging-tech.mjs';
import { ensureTrendAggregationSchema, runTrendAggregation } from './compute-trend-aggregates.mjs';
import { ensureDailyCuratedNewsSchema, runDailyNewsCuration } from './curate-daily-news.mjs';
import { runEmergingTechDiscovery } from './discover-emerging-tech.mjs';
import { runWeeklyDigestGeneration } from './generate-weekly-digest.mjs';
import {
  evaluateDiscoveryTopicPromotion,
  THEME_TAXONOMY_VERSION,
} from './_shared/theme-taxonomy.mjs';

loadOptionalEnvFile();

const { Client } = pg;
const DEFAULT_BATCH_SIZE = 2000;
const TREND_CACHE_PATTERNS = [
  /^trend-pyramid--/i,
  /^theme-evolution--/i,
  /^daily-digest--/i,
  /^category-trends--/i,
  /^quarterly-insights--/i,
];

export const TAXONOMY_MIGRATION_SCHEMA_STATEMENTS = [
  `
    ALTER TABLE articles
      ADD COLUMN IF NOT EXISTS legacy_theme TEXT;
  `,
  `
    ALTER TABLE articles
      ADD COLUMN IF NOT EXISTS taxonomy_version TEXT;
  `,
  `
    ALTER TABLE labeled_outcomes
      ADD COLUMN IF NOT EXISTS source_theme TEXT;
  `,
  `
    ALTER TABLE labeled_outcomes
      ADD COLUMN IF NOT EXISTS theme_key TEXT;
  `,
  `
    ALTER TABLE labeled_outcomes
      ADD COLUMN IF NOT EXISTS theme_label TEXT;
  `,
  `
    ALTER TABLE labeled_outcomes
      ADD COLUMN IF NOT EXISTS parent_theme TEXT;
  `,
  `
    ALTER TABLE labeled_outcomes
      ADD COLUMN IF NOT EXISTS theme_category TEXT;
  `,
  `
    ALTER TABLE labeled_outcomes
      ADD COLUMN IF NOT EXISTS lifecycle_hint TEXT;
  `,
  `
    ALTER TABLE labeled_outcomes
      ADD COLUMN IF NOT EXISTS taxonomy_version TEXT;
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_labeled_outcomes_theme_key
      ON labeled_outcomes (theme_key, horizon, symbol);
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_labeled_outcomes_parent_theme
      ON labeled_outcomes (parent_theme, horizon, symbol);
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_labeled_outcomes_theme_category
      ON labeled_outcomes (theme_category, horizon, symbol);
  `,
];

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toBoolFlag(value, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeKeywordArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    try {
      return normalizeKeywordArray(JSON.parse(value));
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function buildChangedFieldsPredicate(aliasLeft, aliasRight, columns) {
  return columns
    .map((column) => `${aliasLeft}.${column} IS DISTINCT FROM ${aliasRight}.${column}`)
    .join(' OR ');
}

async function tableExists(client, tableName) {
  const result = await client.query('SELECT to_regclass($1) AS relation_name', [`public.${tableName}`]);
  return Boolean(result.rows[0]?.relation_name);
}

function clearTrendCache() {
  const cacheDir = 'data/event-dashboard-cache';
  if (!existsSync(cacheDir)) return 0;
  let removed = 0;
  for (const entry of readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!TREND_CACHE_PATTERNS.some((pattern) => pattern.test(entry.name))) continue;
    unlinkSync(join(cacheDir, entry.name));
    removed += 1;
  }
  return removed;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    batchSize: DEFAULT_BATCH_SIZE,
    limit: 0,
    fromArticleId: 0,
    asOf: new Date().toISOString().slice(0, 10),
    rewriteOutcomeTheme: false,
    rebuildAggregates: false,
    rebuildCuration: false,
    rebuildDiscovery: false,
    invalidateCache: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--batch-size' && argv[index + 1]) {
      parsed.batchSize = Math.max(200, Math.floor(asNumber(argv[++index], DEFAULT_BATCH_SIZE)));
    } else if (arg === '--limit' && argv[index + 1]) {
      parsed.limit = Math.max(0, Math.floor(asNumber(argv[++index], 0)));
    } else if (arg === '--from-article-id' && argv[index + 1]) {
      parsed.fromArticleId = Math.max(0, Math.floor(asNumber(argv[++index], 0)));
    } else if (arg === '--as-of' && argv[index + 1]) {
      parsed.asOf = String(argv[++index]).trim();
    } else if (arg === '--rewrite-outcome-theme') {
      parsed.rewriteOutcomeTheme = true;
    } else if (arg === '--rebuild-aggregates') {
      parsed.rebuildAggregates = true;
    } else if (arg === '--rebuild-curation') {
      parsed.rebuildCuration = true;
    } else if (arg === '--rebuild-discovery') {
      parsed.rebuildDiscovery = true;
    } else if (arg === '--invalidate-cache') {
      parsed.invalidateCache = true;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--with-rebuild') {
      parsed.rebuildDiscovery = true;
      parsed.rebuildAggregates = true;
      parsed.rebuildCuration = true;
      parsed.invalidateCache = true;
    } else if (arg === '--rewrite-outcome-theme=' && argv[index + 1]) {
      parsed.rewriteOutcomeTheme = toBoolFlag(argv[++index], parsed.rewriteOutcomeTheme);
    }
  }

  return parsed;
}

export async function ensureTaxonomyMigrationSchema(client) {
  for (const statement of TAXONOMY_MIGRATION_SCHEMA_STATEMENTS) {
    try {
      await client.query(statement);
    } catch (error) {
      const message = String(error?.message || error || '');
      if (message.includes('does not exist') && statement.includes('labeled_outcomes')) {
        continue;
      }
      throw error;
    }
  }
}

async function loadArticleBatch(client, lastArticleId, limit) {
  const { rows } = await client.query(`
    SELECT
      a.id AS article_id,
      a.title,
      LOWER(COALESCE(a.source, 'unknown')) AS source,
      COALESCE(aa.keywords, ARRAY[]::text[]) AS keywords,
      COALESCE(NULLIF(t.source_theme, ''), NULLIF(t.auto_theme, ''), NULLIF(t.theme_key, ''), NULLIF(a.theme, ''), 'unknown') AS best_theme,
      COALESCE(t.confidence, 0) AS best_sim,
      COALESCE(t.method, 'taxonomy-migration') AS method
    FROM articles a
    LEFT JOIN auto_article_themes t ON t.article_id = a.id
    LEFT JOIN article_analysis aa ON aa.article_id = a.id
    WHERE a.id > $1
    ORDER BY a.id ASC
    LIMIT $2
  `, [lastArticleId, limit]);

  return rows.map((row) => ({
    article_id: Number(row.article_id),
    title: String(row.title || '').trim(),
    source: String(row.source || 'unknown').trim().toLowerCase(),
    keywords: normalizeKeywordArray(row.keywords),
    best_theme: String(row.best_theme || 'unknown').trim().toLowerCase(),
    best_sim: asNumber(row.best_sim, 0),
    method: String(row.method || 'taxonomy-migration').trim() || 'taxonomy-migration',
  }));
}

async function migrateAutoArticleThemes(client, config) {
  let lastArticleId = Math.max(0, config.fromArticleId);
  let processedArticles = 0;
  let canonicalizedArticles = 0;
  let rewrittenLegacyArticles = 0;
  let unknownArticles = 0;

  while (true) {
    const remaining = config.limit > 0
      ? Math.max(0, config.limit - processedArticles)
      : config.batchSize;
    if (remaining === 0) break;

    const batch = await loadArticleBatch(client, lastArticleId, Math.min(config.batchSize, remaining));
    if (batch.length === 0) break;

    const records = batch.map((row) => buildAutoThemeRecord(row, null, null, row.method || 'taxonomy-migration'));
    processedArticles += records.length;
    canonicalizedArticles += records.filter((row) => row.themeKey).length;
    rewrittenLegacyArticles += records.filter((row) => row.sourceTheme && row.autoTheme !== row.sourceTheme).length;
    unknownArticles += records.filter((row) => row.autoTheme === 'unknown').length;

    if (!config.dryRun) {
      await bulkUpsertAutoArticleThemes(client, records);
      await syncArticleThemes(client, records);
    }

    lastArticleId = batch[batch.length - 1].article_id;
  }

  return {
    processedArticles,
    canonicalizedArticles,
    rewrittenLegacyArticles,
    unknownArticles,
    lastArticleId,
  };
}

async function syncArticleThemes(client, records) {
  if (!records.length) return 0;

  let updated = 0;
  for (let index = 0; index < records.length; index += DEFAULT_BATCH_SIZE) {
    const chunk = records.slice(index, index + DEFAULT_BATCH_SIZE);
    const values = [];
    const placeholders = chunk.map((record, recordIndex) => {
      const base = recordIndex * 4;
      values.push(
        record.articleId,
        record.sourceTheme || record.autoTheme || null,
        record.themeKey || record.autoTheme || null,
        record.taxonomyVersion || THEME_TAXONOMY_VERSION,
      );
      return `($${base + 1}::int, $${base + 2}::text, $${base + 3}::text, $${base + 4}::text)`;
    }).join(',\n');

    const result = await client.query(`
      UPDATE articles
      SET
        legacy_theme = COALESCE(articles.legacy_theme, src.legacy_theme),
        theme = COALESCE(src.theme_key, articles.theme),
        taxonomy_version = src.taxonomy_version
      FROM (
        VALUES ${placeholders}
      ) AS src(article_id, legacy_theme, theme_key, taxonomy_version)
      WHERE articles.id = src.article_id
        AND (
          articles.legacy_theme IS DISTINCT FROM COALESCE(articles.legacy_theme, src.legacy_theme)
          OR articles.theme IS DISTINCT FROM COALESCE(src.theme_key, articles.theme)
          OR articles.taxonomy_version IS DISTINCT FROM src.taxonomy_version
        )
    `, values);
    updated += Number(result.rowCount || 0);
  }

  return updated;
}

async function migrateLabeledOutcomes(client, config) {
  if (!(await tableExists(client, 'labeled_outcomes'))) {
    return { updatedOutcomes: 0, skipped: true };
  }

  const columns = [
    'source_theme',
    'theme_key',
    'theme_label',
    'parent_theme',
    'theme_category',
    'lifecycle_hint',
    'taxonomy_version',
  ];

  const rewriteThemeSql = config.rewriteOutcomeTheme
    ? `,
        theme = COALESCE(NULLIF(source.theme_key, ''), labeled_outcomes.theme)
      `
    : '';

  const candidateSelect = `
    SELECT
      lo.id,
      COALESCE(NULLIF(lo.source_theme, ''), NULLIF(t.source_theme, ''), NULLIF(lo.theme, ''), NULLIF(t.auto_theme, ''), 'unknown') AS source_theme,
      COALESCE(NULLIF(t.theme_key, ''), NULLIF(lo.theme_key, ''), NULLIF(t.auto_theme, ''), NULLIF(lo.theme, ''), 'unknown') AS theme_key,
      COALESCE(NULLIF(t.theme_label, ''), NULLIF(lo.theme_label, ''), COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, ''), NULLIF(lo.theme, '')), 'unknown') AS theme_label,
      COALESCE(NULLIF(t.parent_theme, ''), NULLIF(lo.parent_theme, ''), COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, ''), NULLIF(lo.theme, '')), 'unknown') AS parent_theme,
      COALESCE(NULLIF(t.theme_category, ''), NULLIF(lo.theme_category, ''), 'other') AS theme_category,
      COALESCE(NULLIF(t.lifecycle_hint, ''), NULLIF(lo.lifecycle_hint, ''), 'mainstream') AS lifecycle_hint,
      COALESCE(NULLIF(t.taxonomy_version, ''), NULLIF(lo.taxonomy_version, ''), '2026-04-07') AS taxonomy_version
    FROM labeled_outcomes lo
    JOIN auto_article_themes t ON t.article_id = lo.article_id
  `;

  const result = config.dryRun
    ? await client.query(`
      SELECT COUNT(*)::int AS candidate_count
      FROM (${candidateSelect}) AS source
      JOIN labeled_outcomes lo ON lo.id = source.id
      WHERE ${buildChangedFieldsPredicate('lo', 'source', columns)}${config.rewriteOutcomeTheme ? ' OR lo.theme IS DISTINCT FROM COALESCE(NULLIF(source.theme_key, \'\'), lo.theme)' : ''}
    `)
    : await client.query(`
      UPDATE labeled_outcomes
      SET
        source_theme = source.source_theme,
        theme_key = source.theme_key,
        theme_label = source.theme_label,
        parent_theme = source.parent_theme,
        theme_category = source.theme_category,
        lifecycle_hint = source.lifecycle_hint,
        taxonomy_version = source.taxonomy_version
        ${rewriteThemeSql}
      FROM (${candidateSelect}) AS source
      WHERE labeled_outcomes.id = source.id
        AND (${buildChangedFieldsPredicate('labeled_outcomes', 'source', columns)}${config.rewriteOutcomeTheme ? ' OR labeled_outcomes.theme IS DISTINCT FROM COALESCE(NULLIF(source.theme_key, \'\'), labeled_outcomes.theme)' : ''})
    `);

  return {
    updatedOutcomes: Number(
      config.dryRun
        ? result.rows[0]?.candidate_count || 0
        : result.rowCount || 0,
    ),
  };
}

async function migrateDiscoveryTopics(client, config) {
  if (!(await tableExists(client, 'discovery_topics'))) {
    return { scannedTopics: 0, canonicalTopics: 0, watchTopics: 0, suppressedTopics: 0, skipped: true };
  }

  const { rows } = await client.query(`
    SELECT
      dt.id,
      dt.label,
      dt.description,
      dt.category,
      dt.stage,
      dt.parent_theme,
      dt.keywords,
      dt.article_count,
      dt.momentum,
      dt.research_momentum,
      dt.novelty,
      dt.source_quality_score,
      dt.status,
      ARRAY(
        SELECT a.title
        FROM discovery_topic_articles dta
        JOIN articles a ON a.id = dta.article_id
        WHERE dta.topic_id = dt.id
        ORDER BY a.published_at DESC, a.id DESC
        LIMIT 5
      ) AS representative_titles
    FROM discovery_topics dt
    ORDER BY dt.updated_at DESC NULLS LAST, dt.id ASC
  `);

  const scopedRows = config.limit > 0 ? rows.slice(0, config.limit) : rows;
  const normalized = scopedRows.map((row) => {
    const evaluation = evaluateDiscoveryTopicPromotion({
      id: row.id,
      label: row.label,
      description: row.description,
      category: row.category,
      stage: row.stage,
      parentTheme: row.parent_theme,
      keywords: normalizeKeywordArray(row.keywords),
      representativeTitles: normalizeKeywordArray(row.representative_titles),
      articleCount: row.article_count,
      momentum: row.momentum,
      researchMomentum: row.research_momentum,
      novelty: row.novelty,
      sourceQualityScore: row.source_quality_score,
    });
    return {
      id: String(row.id || ''),
      normalizedTheme: evaluation.canonicalTheme,
      normalizedParentTheme: evaluation.canonicalParentTheme,
      normalizedCategory: evaluation.canonicalCategory,
      promotionState: evaluation.promotionState,
      suppressionReason: evaluation.suppressionReason,
      qualityFlags: evaluation.qualityFlags,
      taxonomyVersion: evaluation.taxonomyVersion || THEME_TAXONOMY_VERSION,
      nextStatus: evaluation.promotionState === 'suppressed' ? 'expired' : String(row.status || 'pending'),
    };
  });

  if (!config.dryRun && normalized.length > 0) {
    for (let index = 0; index < normalized.length; index += DEFAULT_BATCH_SIZE) {
      const chunk = normalized.slice(index, index + DEFAULT_BATCH_SIZE);
      const values = [];
      const placeholders = chunk.map((row, rowIndex) => {
        const base = rowIndex * 8;
        values.push(
          row.id,
          row.normalizedTheme,
          row.normalizedParentTheme,
          row.normalizedCategory,
          row.promotionState,
          row.suppressionReason,
          JSON.stringify(row.qualityFlags || []),
          row.taxonomyVersion,
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::jsonb, $${base + 8})`;
      }).join(',\n');

      await client.query(`
        UPDATE discovery_topics
        SET
          normalized_theme = src.normalized_theme,
          normalized_parent_theme = src.normalized_parent_theme,
          normalized_category = src.normalized_category,
          promotion_state = src.promotion_state,
          suppression_reason = src.suppression_reason,
          quality_flags = src.quality_flags,
          taxonomy_version = src.taxonomy_version,
          parent_theme = COALESCE(src.normalized_parent_theme, discovery_topics.parent_theme),
          category = COALESCE(src.normalized_category, discovery_topics.category),
          status = CASE
            WHEN src.promotion_state = 'suppressed' THEN 'expired'
            ELSE discovery_topics.status
          END,
          updated_at = NOW()
        FROM (
          VALUES ${placeholders}
        ) AS src(id, normalized_theme, normalized_parent_theme, normalized_category, promotion_state, suppression_reason, quality_flags, taxonomy_version)
        WHERE discovery_topics.id = src.id
      `, values);
    }
  }

  return {
    scannedTopics: normalized.length,
    canonicalTopics: normalized.filter((row) => row.promotionState === 'canonical').length,
    watchTopics: normalized.filter((row) => row.promotionState === 'watch').length,
    suppressedTopics: normalized.filter((row) => row.promotionState === 'suppressed').length,
  };
}

async function rebuildTrendOutputs(client, config) {
  const summary = {
    discoveryTopics: 0,
    aggregateRows: 0,
    curatedItems: 0,
    weeklyDigestGenerated: false,
    invalidatedCaches: 0,
  };

  if (!config.rebuildDiscovery && !config.rebuildAggregates && !config.rebuildCuration && !config.invalidateCache) {
    return summary;
  }

  if (config.invalidateCache && !config.dryRun) {
    summary.invalidatedCaches = clearTrendCache();
  }

  if (config.rebuildDiscovery) {
    await client.query(`
      UPDATE discovery_topics
      SET status = CASE
        WHEN COALESCE(promotion_state, 'watch') = 'suppressed' THEN 'expired'
        ELSE status
      END
      WHERE id IS NOT NULL
    `);
    const discoverySummary = await runEmergingTechDiscovery({
      limit: 12000,
      minArticleCount: 20,
      minDiversity: 2,
      minCohesion: 0.72,
      minMomentum: 1.22,
    });
    summary.discoveryTopics = Number(discoverySummary.insertedTopics || 0);
  }

  if (config.rebuildAggregates) {
    if (!config.dryRun) {
      await client.query('TRUNCATE theme_evolution');
      await client.query('TRUNCATE theme_lifecycle_transitions');
      await client.query('TRUNCATE theme_trend_aggregates');
    }
    const aggregateSummary = await runTrendAggregation({
      asOf: config.asOf,
      dryRun: config.dryRun,
      periodTypes: ['week', 'month', 'quarter', 'year'],
    });
    summary.aggregateRows = Number(aggregateSummary.aggregateRows || 0);
  }

  if (config.rebuildCuration) {
    if (!config.dryRun) {
      await client.query(`DELETE FROM daily_curated_news WHERE curated_date = $1::date`, [config.asOf]);
      const curationSummary = await runDailyNewsCuration({
        asOf: config.asOf,
        limit: 5,
        refreshAggregates: false,
      });
      summary.curatedItems = Number(curationSummary.curatedCount || curationSummary.inserted || 0);
      const digestSummary = await runWeeklyDigestGeneration({ asOf: config.asOf });
      summary.weeklyDigestGenerated = Boolean(digestSummary.generated);
    }
  }

  return summary;
}

export async function runTaxonomyMigration(options = {}) {
  const config = { ...parseArgs([]), ...options };
  const client = new Client(resolveNasPgConfig());
  await client.connect();

  const summary = {
    asOf: config.asOf,
    dryRun: config.dryRun,
    rewriteOutcomeTheme: config.rewriteOutcomeTheme,
    rebuildAggregates: config.rebuildAggregates,
    rebuildCuration: config.rebuildCuration,
    rebuildDiscovery: config.rebuildDiscovery,
    invalidateCache: config.invalidateCache,
    autoThemes: null,
    outcomes: null,
    discovery: null,
    rebuild: null,
  };

  try {
    await ensureEmergingTechSchema(client);
    await ensureArticleAnalysisTables(client);
    await ensureAutoPipelineTables(client);
    await ensureTrendAggregationSchema(client);
    await ensureDailyCuratedNewsSchema(client);
    await ensureTaxonomyMigrationSchema(client);

    if (!config.dryRun) {
      await client.query('BEGIN');
    }

    summary.autoThemes = await migrateAutoArticleThemes(client, config);
    summary.outcomes = await migrateLabeledOutcomes(client, config);
    summary.discovery = await migrateDiscoveryTopics(client, config);

    if (!config.dryRun) {
      await client.query('COMMIT');
    }

    summary.rebuild = await rebuildTrendOutputs(client, config);
    return summary;
  } catch (error) {
    if (!config.dryRun) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  const summary = await runTaxonomyMigration(parseArgs());
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

const isDirectRun = (() => {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    return import.meta.url === pathToFileURL(entryArg).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exit(1);
  });
}
