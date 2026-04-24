const LOW_VALUE_SINGLE_TERM_QUERIES = new Set([
  'attack',
  'bill',
  'budget',
  'climate',
  'company',
  'cup',
  'defence',
  'defense',
  'drone',
  'drones',
  'deal',
  'firm',
  'emissions',
  'government',
  'israeli',
  'jobs',
  'killed',
  'league',
  'lives',
  'manchester',
  'military',
  'missile',
  'missiles',
  'obituary',
  'pay',
  'prices',
  'reeves',
  'review',
  'russian',
  'strong',
  'tech',
  'tax',
  'ukraine',
  'war',
  'workers',
  'your',
]);

const LOW_VALUE_MULTI_TERM_QUERIES = new Set([
  'climate',
  'defence news',
  'defense news',
  'military news',
  'russian news',
  'ukraine news',
]);

export function normalizeGoogleNewsQueryText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^"+|"+$/g, '')
    .replace(/[()]/g, ' ')
    .replace(/\bor\b/g, ' ')
    .replace(/\bwhen:\S+/g, ' ')
    .replace(/[^a-z0-9:.\-\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseGoogleNewsSearchQuery(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    const host = parsed.hostname.toLowerCase();
    if (host !== 'news.google.com') return null;
    if (!parsed.pathname.toLowerCase().includes('/rss/search')) return null;
    return parsed.searchParams.get('q') || '';
  } catch {
    return null;
  }
}

function hasSiteQualifier(query) {
  return /\bsite:/i.test(String(query || ''));
}

function isDynamicSourceHint({ feedName = '', category = '', theme = '', topics = [] } = {}) {
  const topicList = Array.isArray(topics) ? topics : [];
  return /^google news:/i.test(String(feedName || '').trim())
    || /^dt-[a-z0-9]+$/i.test(String(category || '').trim())
    || /^dt-[a-z0-9]+$/i.test(String(theme || '').trim())
    || topicList.some((topic) => /^dt-[a-z0-9]+$/i.test(String(topic || '').trim()));
}

export function isLowValueGoogleNewsSource(input = {}) {
  const rawQuery = parseGoogleNewsSearchQuery(input.url);
  if (rawQuery == null) return false;
  if (hasSiteQualifier(rawQuery)) return false;
  if (!isDynamicSourceHint(input)) return false;

  const normalizedQuery = normalizeGoogleNewsQueryText(rawQuery);
  if (!normalizedQuery) return true;
  if (LOW_VALUE_MULTI_TERM_QUERIES.has(normalizedQuery)) return true;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return LOW_VALUE_SINGLE_TERM_QUERIES.has(normalizedQuery);
  return tokens.every((token) => LOW_VALUE_SINGLE_TERM_QUERIES.has(token));
}

export function isLowValueGoogleNewsSourceName(source = '') {
  const match = String(source || '').trim().match(/^Google News:\s*(.+)$/i);
  if (!match) return false;
  const normalized = normalizeGoogleNewsQueryText(match[1]);
  if (!normalized) return true;
  if (LOW_VALUE_MULTI_TERM_QUERIES.has(normalized)) return true;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return LOW_VALUE_SINGLE_TERM_QUERIES.has(normalized);
  return tokens.every((token) => LOW_VALUE_SINGLE_TERM_QUERIES.has(token));
}

export function lowValueGoogleNewsReason(input = {}) {
  const rawQuery = parseGoogleNewsSearchQuery(input.url);
  const normalizedQuery = normalizeGoogleNewsQueryText(rawQuery || '');
  return `low-value dynamic Google News query${normalizedQuery ? `: ${normalizedQuery}` : ''}`;
}
