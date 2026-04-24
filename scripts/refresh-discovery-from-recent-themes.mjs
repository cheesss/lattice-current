#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureEmergingTechSchema } from './_shared/schema-emerging-tech.mjs';
import {
  buildDocumentFrequencies,
  buildMonthlyCounts,
  computeMomentum,
  computeSourceQuality,
  extractTopKeywordsFromDocuments,
} from './_shared/emerging-tech-discovery.mjs';
import { resolveThemeTaxonomy, THEME_TAXONOMY_VERSION } from './_shared/theme-taxonomy.mjs';
import { isLowValueGoogleNewsSourceName } from './_shared/google-news-source-policy.mjs';

loadOptionalEnvFile();

const { Client } = pg;

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    days: 7,
    previousDays: 7,
    limit: 20,
    minCount: 2,
    themes: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const next = argv[index + 1];
    if (key === '--days' && next) parsed.days = Math.max(1, Number(next) || parsed.days);
    if (key === '--previous-days' && next) parsed.previousDays = Math.max(1, Number(next) || parsed.previousDays);
    if (key === '--limit' && next) parsed.limit = Math.max(1, Number(next) || parsed.limit);
    if (key === '--min-count' && next) parsed.minCount = Math.max(1, Number(next) || parsed.minCount);
    if ((key === '--theme' || key === '--themes') && next) {
      parsed.themes.push(...String(next).split(',').map(normalizeTheme).filter(Boolean));
    }
    if (key.startsWith('--') && next) index += 1;
  }
  return parsed;
}

function normalizeTheme(value) {
  return String(value || '').trim().toLowerCase();
}

export function isOpaqueDiscoveryTheme(value) {
  return /^dt-[0-9a-f]{8,}$/i.test(normalizeTheme(value));
}

function humanize(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function stableTopicId(theme) {
  return `dt-live-${createHash('sha1').update(String(theme || '')).digest('hex').slice(0, 12)}`;
}

function toDateOnly(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}

function monthCountsFromRows(rows) {
  return buildMonthlyCounts(rows.map((row) => ({
    publishedAt: row.published_at instanceof Date ? row.published_at.toISOString() : String(row.published_at || ''),
  })));
}

async function loadThemeGroups(client, options) {
  const themes = Array.isArray(options.themes)
    ? [...new Set(options.themes.map(normalizeTheme).filter(Boolean))]
    : [];
  const { rows } = await client.query(`
    WITH recent AS (
      SELECT
        COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, ''), 'unknown') AS theme,
        MAX(NULLIF(t.theme_label, '')) AS theme_label,
        MAX(NULLIF(t.parent_theme, '')) AS parent_theme,
        MAX(NULLIF(t.theme_category, '')) AS theme_category,
        COUNT(*)::int AS article_count,
        MIN(a.published_at) AS first_seen,
        MAX(a.published_at) AS last_seen,
        AVG(COALESCE(t.confidence, 0))::float AS avg_confidence
      FROM auto_article_themes t
      JOIN articles a ON a.id = t.article_id
      WHERE a.published_at >= NOW() - ($1::int * INTERVAL '1 day')
        AND COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, ''), 'unknown') <> 'unknown'
        AND COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, ''), 'unknown') !~* '^dt-[0-9a-f]{8,}$'
        AND ($5::text[] IS NULL OR COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, ''), 'unknown') = ANY($5::text[]))
      GROUP BY COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, ''), 'unknown')
      HAVING COUNT(*) >= $2
    ),
    previous AS (
      SELECT
        COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, ''), 'unknown') AS theme,
        COUNT(*)::int AS previous_count
      FROM auto_article_themes t
      JOIN articles a ON a.id = t.article_id
      WHERE a.published_at < NOW() - ($1::int * INTERVAL '1 day')
        AND a.published_at >= NOW() - (($1::int + $3::int) * INTERVAL '1 day')
        AND COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, ''), 'unknown') !~* '^dt-[0-9a-f]{8,}$'
        AND ($5::text[] IS NULL OR COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, ''), 'unknown') = ANY($5::text[]))
      GROUP BY COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, ''), 'unknown')
    )
    SELECT
      recent.*,
      COALESCE(previous.previous_count, 0)::int AS previous_count
    FROM recent
    LEFT JOIN previous ON previous.theme = recent.theme
    ORDER BY recent.article_count DESC, recent.last_seen DESC
    LIMIT $4
  `, [options.days, options.minCount, options.previousDays, options.limit, themes.length ? themes : null]);
  return rows;
}

async function loadThemeArticles(client, theme, days) {
  const { rows } = await client.query(`
    SELECT
      a.id,
      a.title,
      a.summary,
      a.source,
      a.published_at
    FROM articles a
    JOIN auto_article_themes t ON t.article_id = a.id
    WHERE a.published_at >= NOW() - ($2::int * INTERVAL '1 day')
      AND COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, ''), 'unknown') = $1
    ORDER BY a.published_at DESC
    LIMIT 240
  `, [theme, days]);
  return rows.filter((row) => !isLowValueGoogleNewsSourceName(row.source));
}

async function upsertLiveTopic(client, group, articles, options) {
  const theme = normalizeTheme(group.theme);
  const topicId = stableTopicId(theme);
  const taxonomy = resolveThemeTaxonomy(theme);
  const documents = articles.map((row) => `${row.title || ''} ${row.summary || ''}`.trim()).filter(Boolean);
  const keywords = extractTopKeywordsFromDocuments(documents, buildDocumentFrequencies(documents), 10);
  const sourceQuality = computeSourceQuality(articles.map((row) => ({ source: row.source })));
  const monthlyCounts = monthCountsFromRows(articles);
  const momentum = computeMomentum(monthlyCounts, 1, 1);
  const recentCount = Number(articles.length || group.article_count || 0);
  const previousCount = Number(group.previous_count || 0);
  const liveMomentum = previousCount > 0 ? recentCount / previousCount : recentCount > 0 ? recentCount : 0;
  const representativeArticleIds = articles.slice(0, 5).map((row) => Number(row.id)).filter(Number.isFinite);
  const label = group.theme_label || taxonomy.themeLabel || humanize(theme);
  const parentTheme = normalizeTheme(group.parent_theme) || taxonomy.parentTheme || theme;
  const category = normalizeTheme(group.theme_category) || taxonomy.category || 'other';

  await client.query(`
    INSERT INTO discovery_topics (
      id, label, description, category, stage, keywords, centroid_embedding,
      representative_article_ids, article_count, first_seen, last_seen,
      monthly_counts, momentum, research_momentum, source_quality_score,
      source_quality_breakdown, novelty, diversity, cohesion, parent_theme,
      normalized_theme, normalized_parent_theme, normalized_category, promotion_state,
      suppression_reason, quality_flags, taxonomy_version, codex_metadata, status, updated_at
    )
    VALUES (
      $1, $2, $3, $4, 'live-recent', $5::text[], NULL,
      $6::integer[], $7, $8::date, $9::date,
      $10::jsonb, $11, NULL, $12,
      $13::jsonb, $14, $15, $16, $17,
      $18, $19, $20, 'watch',
      NULL, $21::jsonb, $22, $23::jsonb, 'reported', NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      label = EXCLUDED.label,
      description = EXCLUDED.description,
      category = EXCLUDED.category,
      stage = EXCLUDED.stage,
      keywords = EXCLUDED.keywords,
      representative_article_ids = EXCLUDED.representative_article_ids,
      article_count = EXCLUDED.article_count,
      first_seen = EXCLUDED.first_seen,
      last_seen = EXCLUDED.last_seen,
      monthly_counts = EXCLUDED.monthly_counts,
      momentum = EXCLUDED.momentum,
      source_quality_score = EXCLUDED.source_quality_score,
      source_quality_breakdown = EXCLUDED.source_quality_breakdown,
      novelty = EXCLUDED.novelty,
      diversity = EXCLUDED.diversity,
      cohesion = EXCLUDED.cohesion,
      parent_theme = EXCLUDED.parent_theme,
      normalized_theme = EXCLUDED.normalized_theme,
      normalized_parent_theme = EXCLUDED.normalized_parent_theme,
      normalized_category = EXCLUDED.normalized_category,
      taxonomy_version = EXCLUDED.taxonomy_version,
      codex_metadata = EXCLUDED.codex_metadata,
      status = EXCLUDED.status,
      updated_at = NOW()
  `, [
    topicId,
    label,
    `Live recent ${label} article cluster from the last ${options.days} days.`,
    category,
    keywords,
    representativeArticleIds,
    recentCount,
    toDateOnly(group.first_seen),
    toDateOnly(group.last_seen),
    JSON.stringify(monthlyCounts),
    Number.isFinite(liveMomentum) ? liveMomentum : momentum.ratio,
    sourceQuality.sourceQualityScore,
    JSON.stringify(sourceQuality.breakdown),
    0,
    sourceQuality.distinctSourceCount,
    0.65,
    parentTheme,
    theme,
    parentTheme,
    category,
    JSON.stringify([]),
    THEME_TAXONOMY_VERSION,
    JSON.stringify({
      source: 'refresh-discovery-from-recent-themes',
      days: options.days,
      previousDays: options.previousDays,
      previousCount,
      avgConfidence: Number(group.avg_confidence || 0),
      embeddingFallback: true,
    }),
  ]);

  await client.query('DELETE FROM discovery_topic_articles WHERE topic_id = $1', [topicId]);
  if (articles.length > 0) {
    await client.query(`
      INSERT INTO discovery_topic_articles (topic_id, article_id)
      SELECT $1, value
      FROM unnest($2::int[]) AS value
      ON CONFLICT DO NOTHING
    `, [topicId, articles.map((row) => Number(row.id)).filter(Number.isFinite)]);
  }
  return { topicId, theme, articleCount: recentCount, lastSeen: toDateOnly(group.last_seen) };
}

export async function refreshDiscoveryFromRecentThemes(options = {}) {
  const config = { ...parseArgs([]), ...options };
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    await ensureEmergingTechSchema(client);
    const groups = await loadThemeGroups(client, config);
    const topics = [];
    for (const group of groups) {
      if (isOpaqueDiscoveryTheme(group.theme)) continue;
      const articles = await loadThemeArticles(client, normalizeTheme(group.theme), config.days);
      if (articles.length < config.minCount) continue;
      topics.push(await upsertLiveTopic(client, group, articles, config));
    }
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      groups: groups.length,
      topics,
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const result = await refreshDiscoveryFromRecentThemes(parseArgs());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
