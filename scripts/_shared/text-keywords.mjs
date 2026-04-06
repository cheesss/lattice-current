const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'has', 'had', 'but', 'not', 'its', 'this', 'that', 'with',
  'from', 'will', 'have', 'been', 'more', 'than', 'what', 'says', 'after', 'over', 'about', 'could',
  'their', 'were', 'they', 'said', 'would', 'year', 'also', 'into', 'first', 'last', 'live', 'news',
  'new', 'how', 'why', 'can', 'may', 'who', 'all', 'one', 'two', 'out', 'now', 'most', 'just',
  'very', 'some', 'when', 'which', 'where', 'being', 'does', 'make', 'amid', 'amidst', 'update',
  'report', 'reports', 'says', 'say', 'show', 'shows', 'week', 'month', 'months', 'years', 'today',
  'tomorrow', 'yesterday', 'into', 'onto', 'under', 'after', 'before', 'near', 'across', 'through',
]);

const COUNTRY_TOKENS = new Set([
  'china', 'taiwan', 'iran', 'russia', 'ukraine', 'israel', 'gaza', 'us', 'usa', 'europe', 'eu',
  'japan', 'korea', 'north', 'south', 'india', 'pakistan', 'turkey', 'saudi', 'arabia',
]);

export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeText(text) {
  return normalizeText(text)
    .split(' ')
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function scoreToken(token, position, totalCount) {
  const positionBoost = position < 4 ? 0.25 : position < 8 ? 0.15 : 0.05;
  const semanticBoost = COUNTRY_TOKENS.has(token) ? 0.2 : 0;
  const lengthBoost = token.length >= 8 ? 0.1 : token.length >= 5 ? 0.05 : 0;
  const tfBoost = Math.min(totalCount, 3) * 0.12;
  return positionBoost + semanticBoost + lengthBoost + tfBoost;
}

export function extractTopKeywordsFromText(text, maxKeywords = 8) {
  const tokens = tokenizeText(text);
  const counts = new Map();
  const firstIndex = new Map();
  tokens.forEach((token, index) => {
    counts.set(token, (counts.get(token) || 0) + 1);
    if (!firstIndex.has(token)) firstIndex.set(token, index);
  });

  return Array.from(counts.entries())
    .map(([token, count]) => ({
      token,
      count,
      score: scoreToken(token, firstIndex.get(token) || 0, count),
    }))
    .sort((a, b) => b.score - a.score || b.count - a.count || a.token.localeCompare(b.token))
    .slice(0, maxKeywords)
    .map((entry) => entry.token);
}

export function extractEntitiesFromText(text) {
  const raw = String(text || '');
  const tickerMatches = raw.match(/\b[A-Z]{2,5}\b/g) || [];
  const tickers = Array.from(new Set(tickerMatches.filter((token) => token !== 'LIVE' && token !== 'NEWS')));
  const countries = Array.from(new Set(tokenizeText(raw).filter((token) => COUNTRY_TOKENS.has(token))));
  return {
    companies: [],
    countries,
    persons: [],
    tickers,
  };
}

export function buildFastArticleAnalysis(article) {
  const body = [article.title, article.summary].filter(Boolean).join(' ');
  const keywords = extractTopKeywordsFromText(body, 8);
  const entities = extractEntitiesFromText(body);
  const tokenCount = tokenizeText(body).length;
  const richness = Math.min(tokenCount / 18, 1);
  const keywordStrength = Math.min(keywords.length / 6, 1);
  const entityStrength = Math.min(
    (entities.countries.length + entities.tickers.length) / 4,
    1,
  );
  const confidence = Number(Math.min(0.95, 0.2 + richness * 0.35 + keywordStrength * 0.3 + entityStrength * 0.15).toFixed(4));

  return {
    keywords,
    entities,
    sentiment: 'neutral',
    confidence,
    theme: String(article.theme || '').trim() || null,
    method: 'fast-keyword-extractor',
    metadata: {
      tokenCount,
      keywordCount: keywords.length,
      source: 'title-summary',
    },
  };
}

export function collectTrendKeywordStats(analyses, minCount = 3) {
  const stats = new Map();
  for (const analysis of analyses) {
    const publishedAt = analysis.publishedAt ? new Date(analysis.publishedAt) : null;
    const day = publishedAt && !Number.isNaN(publishedAt.valueOf())
      ? publishedAt.toISOString().slice(0, 10)
      : null;
    for (const keyword of analysis.keywords || []) {
      const current = stats.get(keyword) || {
        keyword,
        articleCount: 0,
        score: 0,
        firstSeen: day,
        lastSeen: day,
      };
      current.articleCount += 1;
      current.score += 1 + (analysis.confidence || 0);
      current.firstSeen = current.firstSeen && day ? (current.firstSeen < day ? current.firstSeen : day) : (current.firstSeen || day);
      current.lastSeen = current.lastSeen && day ? (current.lastSeen > day ? current.lastSeen : day) : (current.lastSeen || day);
      stats.set(keyword, current);
    }
  }

  return Array.from(stats.values())
    .filter((entry) => entry.articleCount >= minCount)
    .sort((a, b) => b.score - a.score || b.articleCount - a.articleCount || a.keyword.localeCompare(b.keyword));
}

export { STOPWORDS };
