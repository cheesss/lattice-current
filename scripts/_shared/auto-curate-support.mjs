import { getBudgetStatus } from './automation-budget.mjs';

async function safeRows(client, text, values = [], fallback = []) {
  try {
    const result = await client.query(text, values);
    return result.rows;
  } catch {
    return fallback;
  }
}

export async function collectCorpusStats(client) {
  const [sourceRows, topicRows, unknownRows] = await Promise.all([
    safeRows(client, `
      SELECT source, COUNT(*)::int AS n, MAX(published_at) AS latest
      FROM articles
      GROUP BY source
      ORDER BY n DESC
    `),
    safeRows(client, `
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS recent
      FROM discovery_topics
    `, [], [{ total: 0, recent: 0 }]),
    safeRows(client, `
      SELECT
        COUNT(*) FILTER (WHERE auto_theme = 'unknown')::float / NULLIF(COUNT(*), 0) AS rate
      FROM auto_article_themes
      WHERE updated_at > NOW() - INTERVAL '30 days'
    `, [], [{ rate: 0 }]),
  ]);

  const totalArticles = sourceRows.reduce((sum, row) => sum + Number(row.n || 0), 0);
  return {
    totalArticles,
    sourcesBreakdown: Object.fromEntries(sourceRows.map((row) => [String(row.source || 'unknown'), Number(row.n || 0)])),
    sources: sourceRows.map((row) => String(row.source || 'unknown')),
    latestBySource: Object.fromEntries(sourceRows.map((row) => [String(row.source || 'unknown'), row.latest || null])),
    recentTopics: Number(topicRows[0]?.recent || 0),
    totalTopics: Number(topicRows[0]?.total || 0),
    unknownRate: Number(unknownRows[0]?.rate || 0),
  };
}

export async function getTopicSummary(client) {
  const rows = await safeRows(client, `
    SELECT id, label, category, article_count, momentum, research_momentum, source_quality_score
    FROM discovery_topics
    ORDER BY updated_at DESC
    LIMIT 50
  `);
  return rows.map((row) => ({
    id: String(row.id || ''),
    label: String(row.label || row.id || ''),
    category: String(row.category || 'other'),
    articleCount: Number(row.article_count || 0),
    momentum: Number(row.momentum || 0),
    researchMomentum: Number(row.research_momentum || 0),
    sourceQualityScore: Number(row.source_quality_score || 0),
  }));
}

export function identifyWeakAreas(stats, topics) {
  const weakAreas = new Set();
  if (Number(stats.totalArticles || 0) < 10000) weakAreas.add('corpus-volume');
  if ((stats.sources || []).length < 4) weakAreas.add('source-diversity');
  if (Number(stats.unknownRate || 0) > 0.2) weakAreas.add('theme-classification');
  if (Number(stats.recentTopics || 0) < 5) weakAreas.add('topic-discovery');

  const byCategory = new Map();
  for (const topic of topics || []) {
    const key = String(topic.category || 'other');
    byCategory.set(key, (byCategory.get(key) || 0) + Number(topic.articleCount || 0));
  }
  for (const [category, count] of byCategory.entries()) {
    if (count < 50) weakAreas.add(`category:${category}`);
  }
  if (byCategory.size === 0) weakAreas.add('emerging-tech-coverage');

  return Array.from(weakAreas);
}

export async function collectAutoCurateContext(client) {
  const [stats, topics, budgets] = await Promise.all([
    collectCorpusStats(client),
    getTopicSummary(client),
    getBudgetStatus(client),
  ]);
  return {
    stats,
    topics,
    budgets,
    weakAreas: identifyWeakAreas(stats, topics),
  };
}
