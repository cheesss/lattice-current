/**
 * source-probe.mjs
 * Dynamic Source Probe and Adapter Cascade for Lattice Current.
 *
 * Design: docs/SOURCE_PROPOSAL_INGESTION_REDESIGN_2026-04-16.md
 *
 * Rules:
 *  - Never throws to caller. All failures are structured SourceProbeResult.
 *  - Per-adapter fetch timeout: 8 s
 *  - Overall probe timeout: 15 s
 *  - User-Agent: 'Lattice-SourceProbe/1.0'
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADAPTER_TIMEOUT_MS = 8_000;
const PROBE_TIMEOUT_MS = 15_000;
const USER_AGENT = 'Lattice-SourceProbe/1.0';
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days
const MAX_SAMPLE_ITEMS = 10;
const MAX_SITEMAP_ITEMS = 40;
const MAX_SITEMAP_FETCHES = 8;
const MAX_SITEMAP_DEPTH = 2;

const SPAM_PATTERNS = [
  /click here/i,
  /buy now/i,
  /limited offer/i,
  /\$\d+\s*off/i,
];

const BROAD_THEME_TOKENS = new Set([
  'ai',
  'ml',
  'macro',
  'economy',
  'finance',
  'market',
  'markets',
  'news',
  'politics',
  'policy',
  'defense',
  'technology',
  'tech',
  'cyber',
  'cybersecurity',
  'climate',
  'environment',
  'energy',
  'space',
  'science',
  'general',
  'source',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTraceId() {
  return `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Strip CDATA wrappers from an XML string.
 */
function stripCdata(text) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeXmlText(text) {
  return stripCdata(String(text ?? ''))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

/**
 * Extract the text content between the first matching open/close tag pair.
 */
function extractTag(xml, tag) {
  const escapedTag = escapeRegExp(tag);
  const open = new RegExp(`<${escapedTag}(?:\\s[^>]*)?>`, 'i');
  const close = new RegExp(`</${escapedTag}>`, 'i');
  const start = xml.search(open);
  if (start === -1) return null;
  const afterOpen = xml.indexOf('>', start) + 1;
  const closeOffset = xml.slice(afterOpen).search(close);
  if (closeOffset === -1) return null;
  return decodeXmlText(xml.slice(afterOpen, afterOpen + closeOffset));
}

/**
 * Extract all occurrences of a block tag from XML text.
 * Returns array of raw strings between open and close tags.
 */
function extractBlocks(xml, tag) {
  const blocks = [];
  const escapedTag = escapeRegExp(tag);
  const openRe = new RegExp(`<${escapedTag}(?:\\s[^>]*)?>`, 'gi');
  const closeRe = new RegExp(`</${escapedTag}>`, 'i');
  let match;
  while ((match = openRe.exec(xml)) !== null) {
    const afterOpen = xml.indexOf('>', match.index) + 1;
    const closeOffset = xml.slice(afterOpen).search(closeRe);
    if (closeOffset === -1) break;
    const closeIdx = afterOpen + closeOffset;
    blocks.push(xml.slice(afterOpen, closeIdx));
    openRe.lastIndex = closeIdx + tag.length + 3;
  }
  return blocks;
}

function titleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').filter(Boolean).pop();
    return segment || parsed.hostname;
  } catch {
    return String(url || '').split('/').filter(Boolean).pop() || String(url || '');
  }
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

/**
 * Parse RSS <item> or Atom <entry> blocks into normalized item objects.
 */
function parseItemBlock(block, kind) {
  const title = extractTag(block, 'title') ?? '';
  let url = null;
  let publishedAt = null;

  if (kind === 'rss') {
    url = extractTag(block, 'link');
    publishedAt = extractTag(block, 'pubDate') ?? extractTag(block, 'dc:date');
  } else {
    // Atom: prefer <link href="..."/>
    const linkHref = block.match(/<link[^>]+href=["']([^"']+)["']/i);
    url = linkHref ? linkHref[1] : extractTag(block, 'link');
    publishedAt = extractTag(block, 'published') ?? extractTag(block, 'updated');
  }

  return {
    title: decodeXmlText(title),
    url: url ? decodeXmlText(url) : null,
    publishedAt: publishedAt ? decodeXmlText(publishedAt) : null,
  };
}

function isLikelySitemapUrl(url) {
  try {
    const parsed = new URL(url);
    const haystack = `${parsed.pathname}${parsed.search}`.toLowerCase();
    return /sitemap|site-map/.test(haystack);
  } catch {
    return /sitemap|site-map/i.test(String(url || ''));
  }
}

function normalizeSitemapLoc(loc, baseUrl) {
  const value = decodeXmlText(loc);
  if (!value) return null;
  try {
    const parsed = new URL(value, baseUrl);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    parsed.hash = '';
    return parsed.href;
  } catch {
    return null;
  }
}

function parseSitemapDocument(xml, documentUrl) {
  const items = [];
  const childSitemaps = [];

  for (const block of extractBlocks(xml, 'sitemap')) {
    const loc = normalizeSitemapLoc(extractTag(block, 'loc'), documentUrl);
    if (!loc) continue;
    childSitemaps.push({
      url: loc,
      lastmod: extractTag(block, 'lastmod'),
    });
  }

  for (const block of extractBlocks(xml, 'url')) {
    const loc = normalizeSitemapLoc(extractTag(block, 'loc'), documentUrl);
    if (!loc) continue;
    if (isLikelySitemapUrl(loc)) {
      childSitemaps.push({
        url: loc,
        lastmod: extractTag(block, 'lastmod'),
      });
      continue;
    }
    const title = extractTag(block, 'news:title') || titleFromUrl(loc);
    const publishedAt =
      extractTag(block, 'news:publication_date') ||
      extractTag(block, 'lastmod') ||
      null;
    items.push({ title, url: loc, publishedAt });
  }

  if (items.length === 0 && childSitemaps.length === 0) {
    const locRe = /<loc[^>]*>([\s\S]*?)<\/loc>/gi;
    let match;
    while ((match = locRe.exec(xml)) !== null) {
      const loc = normalizeSitemapLoc(match[1], documentUrl);
      if (!loc) continue;
      if (isLikelySitemapUrl(loc)) {
        childSitemaps.push({ url: loc, lastmod: null });
      } else {
        items.push({ title: titleFromUrl(loc), url: loc, publishedAt: null });
      }
    }
  }

  return { items, childSitemaps };
}

function countRecentSitemapItems(items) {
  const now = Date.now();
  return items.filter((item) => {
    if (!item.publishedAt) return false;
    const ts = Date.parse(item.publishedAt);
    return !isNaN(ts) && now - ts <= RECENT_WINDOW_MS;
  }).length;
}

function countDatedSitemapItems(items) {
  return items.filter((item) => item.publishedAt && !isNaN(Date.parse(item.publishedAt))).length;
}

function compareSitemapResults(left, right) {
  const recentDiff = countRecentSitemapItems(left.items) - countRecentSitemapItems(right.items);
  if (recentDiff !== 0) return recentDiff;
  const datedDiff = countDatedSitemapItems(left.items) - countDatedSitemapItems(right.items);
  if (datedDiff !== 0) return datedDiff;
  return left.items.length - right.items.length;
}

/**
 * Detect language from a string of text (titles concatenated).
 */
function detectLanguage(text) {
  if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(text)) return 'ko';
  if (/[\u3041-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(text)) return 'ja';
  return 'en';
}

/**
 * Compute theme relevance: fraction of items whose title contains at least one
 * keyword from the theme string (space/dash-split, 4+ chars). Returns 0.5 if
 * no theme provided.
 */
function computeThemeRelevance(items, theme) {
  if (!theme || typeof theme !== 'string' || theme.trim() === '') return 0.5;
  const keywords = theme
    .split(/[\s-]+/)
    .map((k) => k.toLowerCase())
    .filter((k) => k.length >= 2 && !BROAD_THEME_TOKENS.has(k));
  if (keywords.length === 0) return 0.5;
  if (items.length === 0) return 0;
  const matched = items.filter((item) =>
    keywords.some((kw) => item.title.toLowerCase().includes(kw))
  );
  return matched.length / items.length;
}

/**
 * Compute the quality breakdown and score from a list of parsed items.
 */
function computeQuality(items, theme) {
  const now = Date.now();

  // Recent items: has publishedAt and within 7 days
  const recentItems = items.filter((item) => {
    if (!item.publishedAt) return false;
    const ts = Date.parse(item.publishedAt);
    return !isNaN(ts) && now - ts <= RECENT_WINDOW_MS;
  });

  // Title diversity
  const uniqueTitles = new Set(items.map((i) => i.title.toLowerCase().trim()));
  const titleDiversity = items.length > 0 ? uniqueTitles.size / items.length : 0;

  // Duplicate rate
  const duplicateRate = items.length > 0 ? 1 - titleDiversity : 0;

  // Spam rate
  const spamCount = items.filter((item) =>
    SPAM_PATTERNS.some((re) => re.test(item.title))
  ).length;
  const spamRate = items.length > 0 ? spamCount / items.length : 0;

  // Language from all titles
  const allTitles = items.map((i) => i.title).join(' ');
  const language = items.length > 0 ? detectLanguage(allTitles) : null;

  // Theme relevance
  const themeRelevance = computeThemeRelevance(items, theme);

  // Source freshness: fraction of items with a parseable publishedAt
  const withDate = items.filter((i) => i.publishedAt && !isNaN(Date.parse(i.publishedAt)));
  const sourceFreshness = items.length > 0 ? withDate.length / items.length : 0;

  const itemCount = items.length;
  const recentItemCount = recentItems.length;

  // Weighted score (weights sum to 1.0; sourceFreshness is stored but not scored)
  const qualityScore =
    Math.min(itemCount / 30, 1) * 0.20 +
    Math.min(recentItemCount / 10, 1) * 0.20 +
    titleDiversity * 0.15 +
    (1 - duplicateRate) * 0.15 +
    (1 - spamRate) * 0.15 +
    themeRelevance * 0.15;

  return {
    qualityScore: Math.round(qualityScore * 1000) / 1000,
    breakdown: {
      fetchOk: true,
      parseOk: itemCount > 0,
      itemCount,
      recentItemCount,
      titleDiversity: Math.round(titleDiversity * 1000) / 1000,
      duplicateRate: Math.round(duplicateRate * 1000) / 1000,
      spamRate: Math.round(spamRate * 1000) / 1000,
      language,
      themeRelevance: Math.round(themeRelevance * 1000) / 1000,
      sourceFreshness: Math.round(sourceFreshness * 1000) / 1000,
    },
  };
}

/**
 * Determine nextAction from status, qualityScore, threshold, and recentItemCount.
 */
function determineNextAction(status, qualityScore, threshold, recentItemCount) {
  if (status === 'failed') return 'reject';
  if (status === 'manual-required') return 'manual-adapter';
  if (qualityScore >= threshold && recentItemCount >= 3) {
    return qualityScore >= 0.85 ? 'register' : 'review';
  }
  return 'reject';
}

function probeStatusFromResult(result, qualityScore, threshold, breakdown) {
  const connectorKind = result.kind ?? 'manual';
  if (connectorKind === 'playwright' || connectorKind === 'llm-selector') return 'manual-required';
  if (!breakdown.parseOk && (result.items ?? []).length === 0) return 'failed';
  return qualityScore >= threshold ? 'success' : 'partial';
}

function nextActionRank(nextAction) {
  return {
    register: 4,
    review: 3,
    'manual-adapter': 2,
    reject: 1,
  }[nextAction] ?? 0;
}

function connectorRank(kind) {
  return {
    rss: 7,
    atom: 7,
    'html-alternate-feed': 6,
    'wordpress-rss': 5,
    'sitemap-news': 4,
    'json-ld': 3,
    'open-graph': 2,
    'html-list': 1,
  }[kind] ?? 0;
}

function buildProbeCandidate(adapterName, result, theme, qualityThreshold) {
  const items = result.items ?? [];
  const { qualityScore, breakdown } = computeQuality(items, theme);
  const status = probeStatusFromResult(result, qualityScore, qualityThreshold, breakdown);
  const connectorKind = result.kind ?? 'manual';
  const nextAction = determineNextAction(status, qualityScore, qualityThreshold, breakdown.recentItemCount);
  return {
    adapterName,
    result,
    status,
    connectorKind,
    qualityScore,
    breakdown,
    nextAction,
  };
}

function compareProbeCandidates(left, right) {
  const actionDiff = nextActionRank(right.nextAction) - nextActionRank(left.nextAction);
  if (actionDiff !== 0) return actionDiff;
  const qualityDiff = right.qualityScore - left.qualityScore;
  if (qualityDiff !== 0) return qualityDiff;
  const recentDiff = right.breakdown.recentItemCount - left.breakdown.recentItemCount;
  if (recentDiff !== 0) return recentDiff;
  const itemDiff = right.breakdown.itemCount - left.breakdown.itemCount;
  if (itemDiff !== 0) return itemDiff;
  return connectorRank(right.connectorKind) - connectorRank(left.connectorKind);
}

/**
 * Fetch with per-call timeout AND overall probe AbortSignal.
 * Returns { ok, status, text, contentType } or throws on network error.
 */
async function fetchWithTimeout(url, overallSignal) {
  const adapterController = new AbortController();
  const adapterTimer = setTimeout(() => adapterController.abort(), ADAPTER_TIMEOUT_MS);

  // Combine: if overall signal fires, also abort adapter
  const onOverallAbort = () => adapterController.abort();
  overallSignal.addEventListener('abort', onOverallAbort, { once: true });

  try {
    const res = await fetch(url, {
      signal: adapterController.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    const text = await res.text();
    const contentType = res.headers.get('content-type') ?? '';
    return { ok: res.ok, status: res.status, text, contentType };
  } finally {
    clearTimeout(adapterTimer);
    overallSignal.removeEventListener('abort', onOverallAbort);
  }
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/**
 * Adapter 1: Try URL directly as RSS or Atom feed.
 */
async function tryDirectFeed(url, overallSignal) {
  try {
    const { ok, text, contentType } = await fetchWithTimeout(url, overallSignal);
    if (!ok) return { ok: false, error: `HTTP error fetching ${url}` };

    const hasRssTag = /<rss[\s>]/i.test(text);
    const hasRdfRssTag = /<rdf:RDF[\s>]/i.test(text);
    const hasFeedTag = /<feed[\s>]/i.test(text);
    const isAtomContentType = contentType.includes('application/atom+xml');

    if (!hasRssTag && !hasRdfRssTag && !hasFeedTag && !isAtomContentType) {
      return { ok: false, error: 'Not RSS or Atom content' };
    }

    const kind = hasFeedTag || isAtomContentType ? 'atom' : 'rss';
    const blockTag = kind === 'atom' ? 'entry' : 'item';
    const rawBlocks = extractBlocks(text, blockTag);
    const items = rawBlocks.map((b) => parseItemBlock(b, kind));

    return { ok: true, kind, items, resolvedUrl: url };
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

/**
 * Adapter 2: Fetch HTML and look for <link rel="alternate" type="application/rss+xml"> or atom+xml.
 */
async function tryHtmlAlternateFeed(url, overallSignal) {
  try {
    const { ok, text, contentType } = await fetchWithTimeout(url, overallSignal);
    if (!ok) return { ok: false, error: `HTTP error fetching ${url}` };
    if (contentType.includes('application/rss+xml') || contentType.includes('application/atom+xml')) {
      return { ok: false, error: 'Direct feed, not HTML' };
    }

    // Look for alternate feed links. Attribute order and rel token lists vary by site.
    const linkRe = /<link\b[^>]*>/gi;
    const matches = text.match(linkRe) ?? [];
    let feedHref = null;

    for (const tag of matches) {
      const relMatch = tag.match(/\brel=["']([^"']+)["']/i);
      if (!relMatch) continue;
      const relTokens = relMatch[1].toLowerCase().split(/\s+/).filter(Boolean);
      if (!relTokens.includes('alternate')) continue;
      const typeMatch = tag.match(/type=["']([^"']+)["']/i);
      if (!typeMatch) continue;
      const type = typeMatch[1];
      if (type.includes('rss+xml') || type.includes('atom+xml')) {
        const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
        if (hrefMatch) {
          feedHref = hrefMatch[1];
          break;
        }
      }
    }

    if (!feedHref) return { ok: false, error: 'No alternate feed link found in HTML' };

    // Resolve relative href
    const resolvedFeedUrl = new URL(feedHref, url).href;

    // Fetch the found feed
    const feedRes = await fetchWithTimeout(resolvedFeedUrl, overallSignal);
    if (!feedRes.ok) return { ok: false, error: `HTTP error fetching alternate feed ${resolvedFeedUrl}` };

    const hasRssTag = /<rss[\s>]/i.test(feedRes.text);
    const hasFeedTag = /<feed[\s>]/i.test(feedRes.text);
    const kind = hasFeedTag ? 'atom' : 'rss';
    const blockTag = kind === 'atom' ? 'entry' : 'item';
    const rawBlocks = extractBlocks(feedRes.text, blockTag);
    const items = rawBlocks.map((b) => parseItemBlock(b, kind));

    return { ok: true, kind: 'html-alternate-feed', items, resolvedUrl: resolvedFeedUrl };
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

/**
 * Adapter 3: Try WordPress feed conventions.
 */
async function tryWordPressFeed(url, overallSignal) {
  let origin, pathname;
  try {
    const parsed = new URL(url);
    origin = parsed.origin;
    pathname = parsed.pathname;
  } catch {
    return { ok: false, error: 'Invalid URL for WordPress probe' };
  }

  const candidates = [
    `${origin}/feed/`,
    `${origin}/rss/`,
    `${origin}/atom.xml`,
    `${origin}${pathname.replace(/\/$/, '')}/feed/`,
  ];

  for (const candidate of candidates) {
    if (overallSignal.aborted) return { ok: false, error: 'Probe timeout' };
    try {
      const res = await fetchWithTimeout(candidate, overallSignal);
      if (!res.ok) continue;
      const hasRssTag = /<rss[\s>]/i.test(res.text);
      const hasFeedTag = /<feed[\s>]/i.test(res.text);
      if (!hasRssTag && !hasFeedTag) continue;
      const kind = hasFeedTag ? 'atom' : 'rss';
      const blockTag = kind === 'atom' ? 'entry' : 'item';
      const rawBlocks = extractBlocks(res.text, blockTag);
      const items = rawBlocks.map((b) => parseItemBlock(b, kind));
      return { ok: true, kind: 'wordpress-rss', items, resolvedUrl: candidate };
    } catch {
      // try next candidate
    }
  }

  return { ok: false, error: 'No WordPress feed convention matched' };
}

/**
 * Adapter 4: Try sitemap paths and extract article/page URLs as sampleItems.
 * Follows sitemap indexes and paginated sitemap documents with tight limits.
 */
async function trySitemap(url, overallSignal) {
  let parsedInput;
  try {
    parsedInput = new URL(url);
  } catch {
    return { ok: false, error: 'Invalid URL for sitemap probe' };
  }

  const origin = parsedInput.origin;
  const candidates = unique([
    isLikelySitemapUrl(url) ? url : null,
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/news-sitemap.xml`,
  ]);
  let bestResult = null;

  for (const candidate of candidates) {
    if (overallSignal.aborted) return { ok: false, error: 'Probe timeout' };

    const queue = [{ url: candidate, depth: 0 }];
    const seen = new Set();
    const items = [];
    let fetchCount = 0;

    while (
      queue.length > 0 &&
      items.length < MAX_SITEMAP_ITEMS &&
      fetchCount < MAX_SITEMAP_FETCHES &&
      !overallSignal.aborted
    ) {
      const current = queue.shift();
      const currentUrl = normalizeSitemapLoc(current.url, candidate);
      if (!currentUrl || seen.has(currentUrl)) continue;
      seen.add(currentUrl);
      fetchCount += 1;

      try {
        const res = await fetchWithTimeout(currentUrl, overallSignal);
        if (!res.ok || !/<loc[\s>]/i.test(res.text)) continue;

        const parsed = parseSitemapDocument(res.text, currentUrl);
        items.push(...parsed.items.slice(0, Math.max(0, MAX_SITEMAP_ITEMS - items.length)));

        if (current.depth >= MAX_SITEMAP_DEPTH) continue;
        const childSitemaps = parsed.childSitemaps
          .slice()
          .sort((a, b) => (Date.parse(b.lastmod || '') || 0) - (Date.parse(a.lastmod || '') || 0));
        for (const child of childSitemaps) {
          if (queue.length + seen.size >= MAX_SITEMAP_FETCHES) break;
          queue.push({ url: child.url, depth: current.depth + 1 });
        }
      } catch {
        // try next sitemap candidate or child
      }
    }

    if (items.length > 0) {
      const result = { ok: true, kind: 'sitemap-news', items, resolvedUrl: candidate };
      if (!bestResult || compareSitemapResults(result, bestResult) > 0) bestResult = result;
      if (countRecentSitemapItems(items) >= 3) return result;
    }
  }

  if (bestResult) return bestResult;

  return { ok: false, error: 'No sitemap found' };
}

/**
 * Adapter 5: Extract JSON-LD Article/NewsArticle from HTML.
 */
async function tryJsonLd(url, overallSignal) {
  try {
    const res = await fetchWithTimeout(url, overallSignal);
    if (!res.ok) return { ok: false, error: `HTTP error fetching ${url}` };

    const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    const items = [];
    let match;

    while ((match = scriptRe.exec(res.text)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        const entries = Array.isArray(data) ? data : [data];
        for (const entry of entries) {
          const type = entry['@type'];
          if (type === 'Article' || type === 'NewsArticle') {
            items.push({
              title: entry.headline ?? entry.name ?? '',
              url: entry.url ?? entry.mainEntityOfPage ?? null,
              publishedAt: entry.datePublished ?? entry.dateModified ?? null,
            });
          }
        }
      } catch {
        // skip malformed JSON-LD
      }
    }

    if (items.length === 0) return { ok: false, error: 'No JSON-LD Article found' };
    return { ok: true, kind: 'json-ld', items, resolvedUrl: url };
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

/**
 * Adapter 6: Extract OpenGraph article metadata from HTML.
 */
async function tryOpenGraph(url, overallSignal) {
  try {
    const res = await fetchWithTimeout(url, overallSignal);
    if (!res.ok) return { ok: false, error: `HTTP error fetching ${url}` };

    const ogType = res.text.match(/<meta[^>]+property=["']og:type["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? '';
    if (!ogType.includes('article')) return { ok: false, error: 'og:type is not article' };

    const title =
      res.text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      res.text.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] ??
      '';
    const ogUrl =
      res.text.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      res.text.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i)?.[1] ??
      null;

    if (!title) return { ok: false, error: 'No og:title found' };

    const items = [{ title, url: ogUrl, publishedAt: null }];
    return { ok: true, kind: 'open-graph', items, resolvedUrl: url };
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

/**
 * Adapter 7: Collect external links from HTML whose text is >= 15 chars.
 */
async function tryHtmlList(url, overallSignal) {
  try {
    const res = await fetchWithTimeout(url, overallSignal);
    if (!res.ok) return { ok: false, error: `HTTP error fetching ${url}` };

    const anchorRe = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const items = [];
    let match;

    while ((match = anchorRe.exec(res.text)) !== null && items.length < 20) {
      const href = match[1];
      const rawText = match[2].replace(/<[^>]+>/g, '').trim();
      if (rawText.length >= 15) {
        items.push({ title: rawText, url: href, publishedAt: null });
      }
    }

    if (items.length === 0) return { ok: false, error: 'No qualifying anchor links found' };
    return { ok: true, kind: 'html-list', items, resolvedUrl: url };
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

/**
 * Adapter 8: Playwright stub (not implemented).
 */
async function tryPlaywright(_url, _overallSignal) {
  return { ok: false, error: 'not implemented' };
}

/**
 * Adapter 9: LLM selector stub (not implemented).
 */
async function tryLlmSelector(_url, _overallSignal) {
  return { ok: false, error: 'not implemented' };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Probe a source URL and return a structured SourceProbeResult.
 * Never throws. All failures are returned as structured results.
 *
 * @param {string} inputUrl
 * @param {{ theme?: string, qualityThreshold?: number }} [options]
 * @returns {Promise<SourceProbeResult>}
 */
export async function probeSource(inputUrl, options = {}) {
  const traceId = makeTraceId();
  const theme = options.theme ?? '';
  const qualityThreshold = typeof options.qualityThreshold === 'number' ? options.qualityThreshold : 0.65;

  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(inputUrl);
  } catch {
    return {
      inputUrl,
      resolvedUrl: null,
      domain: '',
      status: 'failed',
      connectorKind: 'manual',
      adapterTried: [],
      qualityScore: 0,
      qualityBreakdown: {
        fetchOk: false,
        parseOk: false,
        itemCount: 0,
        recentItemCount: 0,
        titleDiversity: 0,
        duplicateRate: 0,
        spamRate: 0,
        language: null,
        themeRelevance: 0,
        sourceFreshness: 0,
      },
      sampleItems: [],
      errors: [{ adapter: 'validation', message: `Invalid URL: ${inputUrl}` }],
      warnings: [],
      nextAction: 'reject',
      traceId,
    };
  }

  const domain = parsedUrl.hostname;

  // Overall probe timeout
  const probeController = new AbortController();
  const probeTimer = setTimeout(() => probeController.abort(), PROBE_TIMEOUT_MS);

  const adapterTried = [];
  const errors = [];
  const warnings = [];

  // Tier 1: structural feed adapters — high quality ceiling, try all before falling back
  // Tier 2: content extraction adapters — lower quality ceiling, only if Tier 1 insufficient
  // Stubs: always record as tried, never produce candidates
  const adapters = [
    { name: 'direct-feed', fn: tryDirectFeed },
    { name: 'html-alternate-feed', fn: tryHtmlAlternateFeed },
    { name: 'wordpress-rss', fn: tryWordPressFeed },
    { name: 'sitemap-news', fn: trySitemap },
    { name: 'json-ld', fn: tryJsonLd },
    { name: 'open-graph', fn: tryOpenGraph },
    { name: 'html-list', fn: tryHtmlList },
    { name: 'playwright', fn: tryPlaywright },
    { name: 'llm-selector', fn: tryLlmSelector },
  ];

  const successCandidates = [];

  try {
    for (const adapter of adapters) {
      if (probeController.signal.aborted) {
        warnings.push('Probe overall timeout reached; remaining adapters skipped');
        break;
      }
      adapterTried.push(adapter.name);
      let result;
      try {
        result = await adapter.fn(inputUrl, probeController.signal);
      } catch (err) {
        result = { ok: false, error: err.message ?? String(err) };
      }
      if (!result.ok) {
        errors.push({ adapter: adapter.name, message: result.error ?? 'Unknown error' });
        continue;
      }
      successCandidates.push(buildProbeCandidate(adapter.name, result, theme, qualityThreshold));
    }
  } finally {
    clearTimeout(probeTimer);
  }

  // No adapter succeeded
  if (!successCandidates.length) {
    // If only playwright/llm-selector succeeded as stubs, treat as manual-required
    const allStubs = adapterTried.every(
      (a) => a === 'playwright' || a === 'llm-selector'
    );
    const status = allStubs ? 'manual-required' : 'failed';

    return {
      inputUrl,
      resolvedUrl: null,
      domain,
      status,
      connectorKind: 'manual',
      adapterTried,
      qualityScore: 0,
      qualityBreakdown: {
        fetchOk: false,
        parseOk: false,
        itemCount: 0,
        recentItemCount: 0,
        titleDiversity: 0,
        duplicateRate: 0,
        spamRate: 0,
        language: null,
        themeRelevance: 0,
        sourceFreshness: 0,
      },
      sampleItems: [],
      errors,
      warnings,
      nextAction: determineNextAction(status, 0, qualityThreshold, 0),
      traceId,
    };
  }

  const firstSuccessfulAdapter = successCandidates[0].adapterName;
  const selectedCandidate = successCandidates.slice().sort(compareProbeCandidates)[0];
  const successResult = selectedCandidate.result;
  const items = successResult.items ?? [];
  const { qualityScore, breakdown, status, connectorKind, nextAction } = selectedCandidate;
  if (selectedCandidate.adapterName !== firstSuccessfulAdapter) {
    warnings.push(
      `Selected ${selectedCandidate.adapterName} over first successful adapter ${firstSuccessfulAdapter} because it produced a stronger probe result`,
    );
  }

  const sampleItems = items.slice(0, MAX_SAMPLE_ITEMS).map((item) => ({
    title: item.title,
    url: item.url,
    publishedAt: item.publishedAt,
  }));

  return {
    inputUrl,
    resolvedUrl: successResult.resolvedUrl ?? null,
    domain,
    status,
    connectorKind,
    adapterTried,
    qualityScore,
    qualityBreakdown: { ...breakdown },
    sampleItems,
    errors,
    warnings,
    nextAction,
    traceId,
  };
}
