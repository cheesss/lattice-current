#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureEmergingTechSchema } from './_shared/schema-emerging-tech.mjs';
import { ensureCodexProposalSchema } from './_shared/schema-proposals.mjs';
import {
  evaluateDiscoveryTopicPromotion,
  listTaxonomyThemes,
  resolveThemeTaxonomy,
  THEME_TAXONOMY_VERSION,
} from './_shared/theme-taxonomy.mjs';
import {
  averageEmbedding,
  buildDocumentFrequencies,
  buildMonthlyCounts,
  chooseClusterCount,
  computeCohesion,
  computeMomentum,
  computeSourceQuality,
  computeSourceDiversity,
  cosineSimilarity,
  deriveTopicId,
  extractTopKeywordsFromDocuments,
  parseEmbeddingVector,
  pickRepresentativeItems,
  runKMeans,
} from './_shared/emerging-tech-discovery.mjs';

loadOptionalEnvFile();

const { Client } = pg;
const MAIN_THEMES = listTaxonomyThemes({ includeParents: false }).map((theme) => theme.key);
const SOURCE_PROPOSAL_MAX_KEYWORDS = 2;
const SOURCE_PROPOSAL_MIN_ARTICLE_COUNT = 45;
const SOURCE_PROPOSAL_MIN_ARTICLE_COUNT_WATCH = 80;
const SOURCE_PROPOSAL_MIN_SOURCE_QUALITY = 0.62;
const SOURCE_PROPOSAL_MIN_SOURCE_QUALITY_WATCH = 0.8;
const SOURCE_PROPOSAL_MIN_DIVERSITY = 3;
const SOURCE_PROPOSAL_MIN_COHESION = 0.72;
const SOURCE_PROPOSAL_MIN_MOMENTUM = 1.45;
const SOURCE_PROPOSAL_MIN_MOMENTUM_WATCH = 2;
const SOURCE_PROPOSAL_MIN_NOVELTY_WATCH = 0.35;
const BLOCKED_SOURCE_PROPOSAL_FLAGS = new Set([
  'sports',
  'entertainment',
  'celebrity',
  'crime',
  'weather',
  'gaming',
  'lottery',
  'gossip',
]);
const GENERIC_SOURCE_PROPOSAL_TERMS = new Set([
  'analysis',
  'analyst',
  'article',
  'articles',
  'business',
  'companies',
  'company',
  'coverage',
  'development',
  'economy',
  'feature',
  'global',
  'growth',
  'industry',
  'industries',
  'latest',
  'market',
  'markets',
  'news',
  'outlook',
  'people',
  'platform',
  'policy',
  'report',
  'reports',
  'research',
  'science',
  'software',
  'startup',
  'startups',
  'story',
  'stories',
  'technology',
  'tech',
  'theme',
  'themes',
  'trend',
  'trends',
  'update',
  'updates',
  'world',
]);
const BROAD_TAXONOMY_TERMS = new Set(
  listTaxonomyThemes({ includeParents: true })
    .flatMap((theme) => [
      theme.key,
      theme.label,
      theme.category,
      theme.parentTheme,
    ])
    .map((value) => normalizeProposalText(value))
    .filter(Boolean),
);

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    limit: 20000,
    knownThreshold: 0.78,
    minArticleCount: 20,
    minDiversity: 2,
    minCohesion: 0.65,
    minMomentum: 1.3,
    sources: ['guardian', 'nyt', 'hackernews', 'arxiv'],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--limit' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.limit = Math.floor(value);
    } else if (arg === '--known-threshold' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0 && value <= 1) parsed.knownThreshold = value;
    } else if (arg === '--min-article-count' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.minArticleCount = Math.floor(value);
    } else if (arg === '--min-diversity' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.minDiversity = Math.floor(value);
    } else if (arg === '--min-cohesion' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0 && value <= 1) parsed.minCohesion = value;
    } else if (arg === '--min-momentum' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.minMomentum = value;
    } else if (arg === '--sources' && argv[index + 1]) {
      const sources = argv[++index]
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      if (sources.length > 0) parsed.sources = sources;
    }
  }
  return parsed;
}

function normalizeProposalText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[^a-z0-9+\-\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueValues(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeTopicStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function humanizeThemeKey(themeKey) {
  return normalizeProposalText(String(themeKey || '').replace(/-general$/g, '').replace(/-/g, ' '));
}

function countPhraseMatchesInTitles(phrase, titles) {
  const normalizedPhrase = normalizeProposalText(phrase);
  if (!normalizedPhrase) return 0;
  return titles.reduce((total, title) => (
    normalizeProposalText(title).includes(normalizedPhrase) ? total + 1 : total
  ), 0);
}

function buildSourceProposalContext(topic = {}) {
  const normalization = topic.codexMetadata?.normalization && typeof topic.codexMetadata.normalization === 'object'
    ? topic.codexMetadata.normalization
    : {};
  const representativeTitles = normalizeTopicStringArray(
    topic.codexMetadata?.representativeTitles || topic.representativeTitles,
  );
  const promotionState = String(
    topic.promotionState
    || normalization.promotionState
    || '',
  ).trim().toLowerCase();
  const suppressionReason = String(
    topic.suppressionReason
    || normalization.suppressionReason
    || '',
  ).trim();
  const normalizedTheme = String(
    topic.normalizedTheme
    || normalization.canonicalTheme
    || '',
  ).trim().toLowerCase();
  const normalizedCategory = String(
    topic.normalizedCategory
    || normalization.canonicalCategory
    || '',
  ).trim().toLowerCase();
  const parentTheme = String(
    topic.parentTheme
    || normalization.canonicalParentTheme
    || '',
  ).trim().toLowerCase();
  const qualityFlags = uniqueValues([
    ...normalizeTopicStringArray(topic.qualityFlags),
    ...normalizeTopicStringArray(normalization.qualityFlags),
  ].map((flag) => normalizeProposalText(flag)));
  const matchedKeywords = uniqueValues(
    normalizeTopicStringArray(normalization.matchedKeywords).map((keyword) => normalizeProposalText(keyword)),
  );
  const resolvedTheme = normalizedTheme ? resolveThemeTaxonomy(normalizedTheme) : resolveThemeTaxonomy(parentTheme);
  const normalizedThemeLabel = normalizeProposalText(
    resolvedTheme.themeType === 'subtheme'
      ? resolvedTheme.themeLabel || humanizeThemeKey(normalizedTheme)
      : '',
  );

  return {
    topicId: String(topic.id || '').trim(),
    promotionState,
    suppressionReason,
    normalizedTheme,
    normalizedThemeLabel,
    normalizedCategory,
    parentTheme,
    parentThemeLabel: normalizeProposalText(resolvedTheme.parentThemeLabel || humanizeThemeKey(parentTheme)),
    representativeTitles,
    qualityFlags,
    matchedKeywords,
    articleCount: Number(topic.articleCount || 0),
    sourceQualityScore: Number(topic.sourceQualityScore || 0),
    diversity: Number(topic.diversity || 0),
    cohesion: Number(topic.cohesion || 0),
    momentum: Number(topic.momentum || 0),
    novelty: Number(topic.novelty || 0),
  };
}

export function assessTopicSourceProposalReadiness(topic = {}) {
  const context = buildSourceProposalContext(topic);
  const blockedFlag = context.qualityFlags.find((flag) => BLOCKED_SOURCE_PROPOSAL_FLAGS.has(flag));

  if (context.promotionState === 'suppressed') {
    return { ready: false, reason: 'suppressed-topic', context };
  }
  if (context.suppressionReason) {
    return { ready: false, reason: 'suppression-reason', context };
  }
  if (blockedFlag) {
    return { ready: false, reason: `blocked-flag:${blockedFlag}`, context };
  }
  if (context.articleCount < SOURCE_PROPOSAL_MIN_ARTICLE_COUNT) {
    return { ready: false, reason: 'article-count-too-low', context };
  }
  if (context.sourceQualityScore < SOURCE_PROPOSAL_MIN_SOURCE_QUALITY) {
    return { ready: false, reason: 'source-quality-too-low', context };
  }
  if (context.diversity < SOURCE_PROPOSAL_MIN_DIVERSITY) {
    return { ready: false, reason: 'diversity-too-low', context };
  }
  if (context.cohesion < SOURCE_PROPOSAL_MIN_COHESION) {
    return { ready: false, reason: 'cohesion-too-low', context };
  }
  if (context.momentum < SOURCE_PROPOSAL_MIN_MOMENTUM) {
    return { ready: false, reason: 'momentum-too-low', context };
  }
  if (!context.normalizedTheme && !context.parentTheme) {
    return { ready: false, reason: 'missing-taxonomy', context };
  }

  if (context.promotionState === 'canonical') {
    return { ready: true, reason: 'canonical-topic', context };
  }
  if (
    context.promotionState === 'watch'
    && context.articleCount >= SOURCE_PROPOSAL_MIN_ARTICLE_COUNT_WATCH
    && context.sourceQualityScore >= SOURCE_PROPOSAL_MIN_SOURCE_QUALITY_WATCH
    && context.momentum >= SOURCE_PROPOSAL_MIN_MOMENTUM_WATCH
    && context.novelty >= SOURCE_PROPOSAL_MIN_NOVELTY_WATCH
  ) {
    return { ready: true, reason: 'strong-watch-topic', context };
  }

  return { ready: false, reason: 'promotion-state-too-weak', context };
}

function isMeaningfulProposalKeyword(keyword, context) {
  const normalizedKeyword = normalizeProposalText(keyword);
  if (!normalizedKeyword || normalizedKeyword.length < 4) return false;
  if (/^\d+$/.test(normalizedKeyword)) return false;
  if (GENERIC_SOURCE_PROPOSAL_TERMS.has(normalizedKeyword)) return false;
  if (
    BROAD_TAXONOMY_TERMS.has(normalizedKeyword)
    && normalizedKeyword !== context.normalizedThemeLabel
  ) {
    return false;
  }
  if (
    normalizedKeyword === context.normalizedCategory
    || normalizedKeyword === context.parentThemeLabel
  ) {
    return false;
  }

  const tokens = normalizedKeyword.split(' ').filter(Boolean);
  if (tokens.every((token) => GENERIC_SOURCE_PROPOSAL_TERMS.has(token))) return false;

  const titleMatches = countPhraseMatchesInTitles(normalizedKeyword, context.representativeTitles);
  const isCanonicalThemePhrase = context.normalizedThemeLabel && normalizedKeyword === context.normalizedThemeLabel;
  const isMatchedKeyword = context.matchedKeywords.includes(normalizedKeyword);

  if (!isCanonicalThemePhrase && !isMatchedKeyword && titleMatches === 0) return false;
  if (tokens.length === 1 && normalizedKeyword.length < 7 && !isCanonicalThemePhrase && titleMatches < 2) return false;
  return true;
}

export function selectTopicSourceProposalKeywords(topic = {}, limit = SOURCE_PROPOSAL_MAX_KEYWORDS) {
  const { context } = assessTopicSourceProposalReadiness(topic);
  const rawKeywords = normalizeTopicStringArray(topic.keywords);
  const candidateKeywords = uniqueValues([
    context.normalizedThemeLabel,
    ...context.matchedKeywords,
    ...rawKeywords,
  ].map((keyword) => normalizeProposalText(keyword)));

  return candidateKeywords
    .filter((keyword) => isMeaningfulProposalKeyword(keyword, context))
    .map((keyword) => {
      const titleMatches = countPhraseMatchesInTitles(keyword, context.representativeTitles);
      const tokenCount = keyword.split(' ').filter(Boolean).length;
      const isCanonicalThemePhrase = context.normalizedThemeLabel && keyword === context.normalizedThemeLabel;
      const isMatchedKeyword = context.matchedKeywords.includes(keyword);
      const score = (
        (isCanonicalThemePhrase ? 5 : 0)
        + (isMatchedKeyword ? 3 : 0)
        + Math.min(4, titleMatches * 1.5)
        + Math.min(2.5, tokenCount * 0.6)
        + Math.min(2, keyword.length / 12)
      );
      return { keyword, score };
    })
    .sort((left, right) => right.score - left.score || left.keyword.localeCompare(right.keyword))
    .slice(0, Math.max(1, Math.floor(limit)))
    .map((row) => row.keyword);
}

function buildGoogleNewsSearchUrl(keyword) {
  const normalizedKeyword = normalizeProposalText(keyword);
  const query = normalizedKeyword.includes(' ')
    ? `"${normalizedKeyword}"`
    : normalizedKeyword;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

async function loadThemeAnchors(client) {
  const { rows } = await client.query(`
    SELECT lo.theme, a.embedding::text AS embedding_text
    FROM labeled_outcomes lo
    JOIN articles a ON a.id = lo.article_id
    WHERE lo.theme = ANY($1::text[])
      AND lo.horizon = '2w'
      AND a.embedding IS NOT NULL
    ORDER BY lo.created_at DESC
    LIMIT 1000
  `, [MAIN_THEMES]);

  const grouped = new Map();
  for (const row of rows) {
    const theme = String(row.theme || '').trim().toLowerCase();
    const embedding = parseEmbeddingVector(row.embedding_text);
    if (!theme || embedding.length === 0) continue;
    const bucket = grouped.get(theme) || [];
    if (bucket.length < 120) {
      bucket.push(embedding);
      grouped.set(theme, bucket);
    }
  }

  const anchors = new Map();
  for (const [theme, vectors] of grouped.entries()) {
    anchors.set(theme, averageEmbedding(vectors));
  }
  return anchors;
}

async function loadCandidateArticles(client, options) {
  const { rows } = await client.query(`
    SELECT
      id,
      title,
      summary,
      source,
      published_at,
      embedding::text AS embedding_text
    FROM articles
    WHERE embedding IS NOT NULL
      AND source = ANY($1::text[])
    ORDER BY published_at DESC
    LIMIT $2
  `, [options.sources, options.limit]);

  return rows
    .map((row) => ({
      id: Number(row.id),
      title: String(row.title || '').trim(),
      summary: String(row.summary || '').trim(),
      source: String(row.source || '').trim().toLowerCase(),
      publishedAt: new Date(row.published_at).toISOString(),
      embedding: parseEmbeddingVector(row.embedding_text),
    }))
    .filter((item) => item.id > 0 && item.embedding.length > 0 && item.title);
}

function classifyPotentiallyEmerging(items, anchors, knownThreshold) {
  return items.filter((item) => {
    let bestSimilarity = 0;
    for (const [, anchor] of anchors.entries()) {
      bestSimilarity = Math.max(bestSimilarity, cosineSimilarity(item.embedding, anchor));
    }
    return bestSimilarity < knownThreshold;
  });
}

function clusterToTopic(cluster, documentFrequencies, options, anchors) {
  const centroid = averageEmbedding(cluster.items.map((item) => item.embedding));
  const keywords = extractTopKeywordsFromDocuments(
    cluster.items.map((item) => `${item.title} ${item.summary}`.trim()),
    documentFrequencies,
    10,
  );
  const monthlyCounts = buildMonthlyCounts(cluster.items);
  const momentum = computeMomentum(monthlyCounts);
  const researchItems = cluster.items.filter((item) => item.source === 'arxiv');
  const researchMonthlyCounts = buildMonthlyCounts(researchItems);
  const researchMomentum = researchItems.length > 0
    ? computeMomentum(researchMonthlyCounts)
    : null;
  const sourceQuality = computeSourceQuality(cluster.items);
  const diversity = computeSourceDiversity(cluster.items);
  const cohesion = computeCohesion(cluster.items, centroid);
  const representativeItems = pickRepresentativeItems(cluster.items, centroid, 5);
  const representativeTitles = representativeItems.map((item) => item.title);

  let parentTheme = 'emerging-tech';
  let parentThemeSimilarity = 0;
  for (const [theme, anchor] of anchors.entries()) {
    const similarity = cosineSimilarity(centroid, anchor);
    if (similarity > parentThemeSimilarity) {
      parentThemeSimilarity = similarity;
      parentTheme = theme;
    }
  }

  const normalization = evaluateDiscoveryTopicPromotion({
    id: deriveTopicId(keywords),
    label: representativeTitles[0] || keywords.slice(0, 3).join(' '),
    description: representativeTitles.slice(0, 3).join('; '),
    category: parentTheme,
    parentTheme,
    keywords,
    representativeTitles,
    articleCount: cluster.items.length,
    momentum: momentum.ratio,
    researchMomentum: researchMomentum?.ratio,
    novelty: Math.max(0, Math.min(1, 1 - parentThemeSimilarity)),
    sourceQualityScore: sourceQuality.sourceQualityScore,
  });

  const qualifies = normalization.promotionState !== 'suppressed'
    && cluster.items.length >= options.minArticleCount
    && diversity >= options.minDiversity
    && cohesion >= options.minCohesion
    && (
      momentum.ratio >= options.minMomentum
      || momentum.recentTotal >= Math.max(50, momentum.previousTotal)
    );

  return {
    qualifies,
    id: deriveTopicId(keywords),
    keywords,
    centroidEmbedding: centroid,
    articleIds: cluster.items.map((item) => item.id),
    representativeArticleIds: representativeItems.map((item) => item.id),
    articleCount: cluster.items.length,
    firstSeen: cluster.items[cluster.items.length - 1]?.publishedAt?.slice(0, 10) || null,
    lastSeen: cluster.items[0]?.publishedAt?.slice(0, 10) || null,
    monthlyCounts,
    momentum: Number.isFinite(momentum.ratio) ? momentum.ratio : null,
    researchMomentum: researchMomentum && Number.isFinite(researchMomentum.ratio)
      ? researchMomentum.ratio
      : null,
    sourceQualityScore: sourceQuality.sourceQualityScore,
    sourceQualityBreakdown: sourceQuality.breakdown,
    diversity,
    cohesion,
    parentTheme: normalization.canonicalParentTheme || parentTheme,
    normalizedTheme: normalization.canonicalTheme,
    normalizedCategory: normalization.canonicalCategory,
    promotionState: normalization.promotionState,
    suppressionReason: normalization.suppressionReason,
    qualityFlags: normalization.qualityFlags,
    novelty: Math.max(0, Math.min(1, 1 - parentThemeSimilarity)),
    codexMetadata: {
      normalization,
      representativeTitles: representativeItems.map((item) => item.title),
      parentThemeSimilarity: Number(parentThemeSimilarity.toFixed(4)),
      recentAverage: Number(momentum.recentAverage.toFixed(4)),
      previousAverage: Number(momentum.previousAverage.toFixed(4)),
      researchRecentAverage: researchMomentum ? Number(researchMomentum.recentAverage.toFixed(4)) : 0,
      researchPreviousAverage: researchMomentum ? Number(researchMomentum.previousAverage.toFixed(4)) : 0,
      researchArticleCount: researchItems.length,
      distinctSourceCount: sourceQuality.distinctSourceCount,
      distinctSourceTypeCount: sourceQuality.distinctSourceTypeCount,
      effectiveSourceCount: sourceQuality.effectiveSourceCount,
      weightedCoverage: sourceQuality.weightedCoverage,
    },
  };
}

async function upsertTopics(client, topics) {
  for (const topic of topics) {
    await client.query(`
      INSERT INTO discovery_topics (
        id, keywords, centroid_embedding, representative_article_ids, article_count,
        first_seen, last_seen, monthly_counts, momentum, research_momentum, source_quality_score,
        source_quality_breakdown, novelty, diversity, cohesion, parent_theme,
        normalized_theme, normalized_parent_theme, normalized_category, promotion_state,
        suppression_reason, quality_flags, taxonomy_version, codex_metadata, updated_at
      )
      VALUES (
        $1, $2::text[], $3::double precision[], $4::integer[], $5,
        $6::date, $7::date, $8::jsonb, $9, $10, $11,
        $12::jsonb, $13, $14, $15, $16,
        $17, $18, $19, $20,
        $21, $22::jsonb, $23, $24::jsonb, NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        keywords = EXCLUDED.keywords,
        centroid_embedding = EXCLUDED.centroid_embedding,
        representative_article_ids = EXCLUDED.representative_article_ids,
        article_count = EXCLUDED.article_count,
        first_seen = EXCLUDED.first_seen,
        last_seen = EXCLUDED.last_seen,
        monthly_counts = EXCLUDED.monthly_counts,
        momentum = EXCLUDED.momentum,
        research_momentum = EXCLUDED.research_momentum,
        source_quality_score = EXCLUDED.source_quality_score,
        source_quality_breakdown = EXCLUDED.source_quality_breakdown,
        novelty = EXCLUDED.novelty,
        diversity = EXCLUDED.diversity,
        cohesion = EXCLUDED.cohesion,
        parent_theme = EXCLUDED.parent_theme,
        normalized_theme = EXCLUDED.normalized_theme,
        normalized_parent_theme = EXCLUDED.normalized_parent_theme,
        normalized_category = EXCLUDED.normalized_category,
        promotion_state = EXCLUDED.promotion_state,
        suppression_reason = EXCLUDED.suppression_reason,
        quality_flags = EXCLUDED.quality_flags,
        taxonomy_version = EXCLUDED.taxonomy_version,
        codex_metadata = EXCLUDED.codex_metadata,
        updated_at = NOW()
    `, [
      topic.id,
      topic.keywords,
      topic.centroidEmbedding,
      topic.representativeArticleIds,
      topic.articleCount,
      topic.firstSeen,
      topic.lastSeen,
      JSON.stringify(topic.monthlyCounts),
      topic.momentum,
      topic.researchMomentum,
      topic.sourceQualityScore,
      JSON.stringify(topic.sourceQualityBreakdown),
      topic.novelty,
      topic.diversity,
      topic.cohesion,
      topic.parentTheme,
      topic.normalizedTheme,
      topic.parentTheme,
      topic.normalizedCategory,
      topic.promotionState,
      topic.suppressionReason,
      JSON.stringify(topic.qualityFlags || []),
      THEME_TAXONOMY_VERSION,
      JSON.stringify(topic.codexMetadata),
    ]);

    await client.query(`
      DELETE FROM discovery_topic_articles
      WHERE topic_id = $1
    `, [topic.id]);

    if (topic.articleIds.length > 0) {
      await client.query(`
        INSERT INTO discovery_topic_articles (topic_id, article_id)
        SELECT $1, value
        FROM unnest($2::int[]) AS value
        ON CONFLICT DO NOTHING
      `, [topic.id, topic.articleIds]);
    }

    await proposeSourcesForNewTopic(client, topic);
  }
}

export async function proposeSourcesForNewTopic(client, topic) {
  const readiness = assessTopicSourceProposalReadiness(topic);
  if (!readiness.ready) return 0;

  const keywords = selectTopicSourceProposalKeywords(topic, SOURCE_PROPOSAL_MAX_KEYWORDS);
  if (keywords.length === 0) return 0;

  let inserted = 0;
  for (const keyword of keywords) {
    const googleNewsUrl = buildGoogleNewsSearchUrl(keyword);
    const exists = await client.query(
      `
        SELECT 1
        FROM codex_proposals
        WHERE proposal_type = 'add-rss'
          AND payload->>'url' = $1
        LIMIT 1
      `,
      [googleNewsUrl],
    );
    if (exists.rows.length > 0) continue;
    const result = await client.query(
      `
        INSERT INTO codex_proposals (proposal_type, payload, status, reasoning, source)
        VALUES ('add-rss', $1, 'pending', $2, 'topic-discovery')
        ON CONFLICT DO NOTHING
        RETURNING id
      `,
      [
        JSON.stringify({
          url: googleNewsUrl,
          name: `Google News: ${keyword}`,
          theme: topic.id,
          normalizedTheme: readiness.context.normalizedTheme || null,
          parentTheme: readiness.context.parentTheme || null,
          promotionState: readiness.context.promotionState || null,
          reason: `auto-generated from topic ${topic.id} (${readiness.reason})`,
        }),
        `auto-generated source proposal for topic ${topic.id} (${readiness.reason})`,
      ],
    );
    inserted += Number(result.rowCount || 0);
  }
  return inserted;
}

export async function runEmergingTechDiscovery(options = {}) {
  const config = { ...parseArgs([]), ...options };
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    await ensureEmergingTechSchema(client);
    await ensureCodexProposalSchema(client);
    const [anchors, candidates] = await Promise.all([
      loadThemeAnchors(client),
      loadCandidateArticles(client, config),
    ]);
    const emergingCandidates = classifyPotentiallyEmerging(candidates, anchors, config.knownThreshold);
    const documentFrequencies = buildDocumentFrequencies(
      emergingCandidates.map((item) => `${item.title} ${item.summary}`.trim()),
    );
    const clusters = runKMeans(emergingCandidates, chooseClusterCount(emergingCandidates.length));
    const topics = clusters
      .map((cluster) => clusterToTopic(cluster, documentFrequencies, config, anchors))
      .filter((topic) => topic.qualifies);
    await upsertTopics(client, topics);
    return {
      totalCandidates: candidates.length,
      emergingCandidates: emergingCandidates.length,
      clusterCount: clusters.length,
      insertedTopics: topics.length,
      canonicalTopics: topics.filter((topic) => topic.promotionState === 'canonical').length,
      watchTopics: topics.filter((topic) => topic.promotionState === 'watch').length,
      topics: topics.slice(0, 20).map((topic) => ({
        id: topic.id,
        keywords: topic.keywords,
        articleCount: topic.articleCount,
        momentum: topic.momentum,
        sourceQualityScore: topic.sourceQualityScore,
        diversity: topic.diversity,
        cohesion: topic.cohesion,
        promotionState: topic.promotionState,
        parentTheme: topic.parentTheme,
      })),
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const summary = await runEmergingTechDiscovery(parseArgs());
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
