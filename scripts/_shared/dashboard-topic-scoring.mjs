/**
 * Topic-article matching + scoring helpers for the event dashboard API.
 *
 * Extracted from event-dashboard-api.mjs during the mega-file split pilot.
 * Pure helpers — topic-article fit scoring has no DB side effects and is
 * independently unit-tested by
 * tests/event-dashboard-topic-article-matching.test.mjs.
 */

export const TOPIC_ARTICLE_GENERIC_TERMS = new Set([
  'attack', 'attacks', 'attacked', 'killed', 'kill', 'kills', 'strike',
  'strikes', 'war', 'wars', 'conflict', 'military', 'forces', 'state',
  'backed', 'backing', 'global', 'latest', 'threat', 'threats', 'world',
  'policy', 'general', 'public', 'strategic', 'activity', 'infrastructure',
  'investment', 'debate', 'risk', 'security', 'growth', 'industry',
]);

export const TOPIC_ARTICLE_STOPWORDS = new Set([
  'the', 'and', 'for', 'in', 'of', 'to', 'on', 'at', 'by', 'as', 'or',
  'with', 'from', 'into', 'that', 'this', 'these', 'those', 'their',
  'them', 'they', 'have', 'has', 'had', 'are', 'was', 'were', 'will',
  'would', 'could', 'should', 'across', 'about', 'under', 'over', 'after',
  'before', 'between', 'through', 'around', 'against', 'while', 'where',
  'which', 'what', 'when', 'than', 'then', 'onto', 'also', 'still',
  'more', 'most', 'less', 'only', 'very', 'much', 'such', 'because',
  'centers', 'accelerating', 'including', 'rising', 'demand', 'software',
  'systems', 'current', 'cluster', 'topic',
]);

export const GEO_CONTEXT_PATTERNS = [
  /\bukrain/i, /\brussi/i, /\bisrael/i, /\biran/i, /\bgaza/i,
  /\bpalestin/i, /\bsyria?/i, /\byemen/i, /\bsudan/i, /\bhouthi/i,
  /\btaiwan/i, /\bchina/i, /\bodesa\b/i, /\bodessa\b/i, /\bkyiv\b/i,
  /\bmoscow\b/i, /\bkremlin\b/i, /\bblack sea\b/i,
];

export function sanitizeTopicText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitTopicTerms(values, options = {}) {
  const includeWhole = options.includeWhole !== false;
  const maxWholeWords = Number(options.maxWholeWords || 4);
  const terms = new Set();
  for (const value of values) {
    const normalized = sanitizeTopicText(value);
    if (!normalized) continue;
    if (includeWhole && normalized.split(/\s+/).length <= maxWholeWords) {
      terms.add(normalized);
    }
    for (const token of normalized.split(/[\s/]+/)) {
      const cleaned = token.replace(/^-+|-+$/g, '');
      if (!cleaned) continue;
      terms.add(cleaned);
    }
  }
  return Array.from(terms);
}

export function buildTopicArticleProfile(topic) {
  const labelTerms = splitTopicTerms([topic.label], { includeWhole: false });
  const technologyTerms = splitTopicTerms(Array.isArray(topic.key_technologies) ? topic.key_technologies : [], { includeWhole: true, maxWholeWords: 4 });
  const companyTerms = splitTopicTerms(Array.isArray(topic.key_companies) ? topic.key_companies : [], { includeWhole: true, maxWholeWords: 3 });
  const descriptionTerms = splitTopicTerms([topic.description], { includeWhole: false });
  const keywordTerms = splitTopicTerms(Array.isArray(topic.keywords) ? topic.keywords : [], { includeWhole: false });

  const strongTerms = new Set();
  const supportTerms = new Set();

  for (const term of [...technologyTerms, ...companyTerms, ...labelTerms]) {
    const compact = term.replace(/\s+/g, ' ').trim();
    if (!compact || compact.length < 3) continue;
    if (TOPIC_ARTICLE_STOPWORDS.has(compact) || TOPIC_ARTICLE_GENERIC_TERMS.has(compact)) continue;
    strongTerms.add(compact);
  }

  for (const term of [...keywordTerms, ...descriptionTerms]) {
    const compact = term.replace(/\s+/g, ' ').trim();
    if (!compact || compact.length < 4) continue;
    if (TOPIC_ARTICLE_STOPWORDS.has(compact)) continue;
    if (TOPIC_ARTICLE_GENERIC_TERMS.has(compact)) continue;
    if (strongTerms.has(compact)) continue;
    supportTerms.add(compact);
  }

  if (String(topic.parent_theme || '') === 'geopolitics') {
    for (const term of ['ukraine', 'ukrainian', 'russia', 'russian']) {
      supportTerms.add(term);
    }
  }

  const geoContext = Array.from(new Set([...labelTerms, ...keywordTerms, ...descriptionTerms]
    .filter((term) => GEO_CONTEXT_PATTERNS.some((pattern) => pattern.test(term)))))
    .slice(0, 8);

  const focusTerms = Array.from(new Set([...technologyTerms, ...labelTerms]
    .filter((term) => !geoContext.includes(term))
    .filter((term) => !TOPIC_ARTICLE_GENERIC_TERMS.has(term))
    .filter((term) => !TOPIC_ARTICLE_STOPWORDS.has(term))))
    .slice(0, 12);

  const strong = Array.from(strongTerms).slice(0, 16);
  const support = Array.from(supportTerms).slice(0, 24);
  return { strong, support, geoContext, focusTerms };
}

export function buildTopicRecentArticleScore(article, topicId, parentTheme, profile) {
  const text = sanitizeTopicText([article.title, article.summary, article.source].filter(Boolean).join(' '));
  const matchedStrong = [];
  const matchedSupport = [];
  const matchedGeo = [];
  const matchedFocus = [];

  for (const term of profile.strong) {
    if (text.includes(term)) matchedStrong.push(term);
  }
  for (const term of profile.support) {
    if (text.includes(term)) matchedSupport.push(term);
  }
  for (const term of profile.geoContext || []) {
    if (text.includes(term)) matchedGeo.push(term);
  }
  for (const term of profile.focusTerms || []) {
    if (text.includes(term)) matchedFocus.push(term);
  }

  const strongHitCount = matchedStrong.length;
  const supportHitCount = matchedSupport.length;
  const geoHitCount = matchedGeo.length;
  const focusHitCount = matchedFocus.length;

  let score = strongHitCount * 8 + supportHitCount * 2;
  score += geoHitCount * 4 + focusHitCount * 5;
  if (article.legacy_theme && String(article.legacy_theme) === String(topicId)) score += 6;
  if (article.theme && String(article.theme) === String(parentTheme || '')) score += 2;
  if (article.legacy_theme && String(article.legacy_theme) === String(parentTheme || '')) score += 1;

  const publishedAt = article.published_at ? new Date(article.published_at).getTime() : 0;
  const ageHours = publishedAt > 0 ? Math.max(0, (Date.now() - publishedAt) / 36e5) : 99999;
  if (ageHours <= 72) score += 4;
  else if (ageHours <= 24 * 14) score += 3;
  else if (ageHours <= 24 * 30) score += 2;
  else if (ageHours <= 24 * 90) score += 1;

  return {
    score,
    matchedStrong,
    matchedSupport,
    matchedGeo,
    matchedFocus,
    strongHitCount,
    supportHitCount,
    geoHitCount,
    focusHitCount,
  };
}
