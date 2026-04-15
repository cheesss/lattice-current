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

const SPAM_PATTERNS = [
  /click here/i,
  /buy now/i,
  /limited offer/i,
  /\$\d+\s*off/i,
];

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

/**
 * Extract the text content between the first matching open/close tag pair.
 */
function extractTag(xml, tag) {
  const open = new RegExp(`<${tag}[^>]*>`, 'i');
  const close = new RegExp(`</${tag}>`, 'i');
  const start = xml.search(open);
  if (start === -1) return null;
  const afterOpen = xml.indexOf('>', start) + 1;
  const end = xml.search(close);
  if (end === -1) return null;
  return stripCdata(xml.slice(afterOpen, end)).trim();
}

/**
 * Extract all occurrences of a block tag from XML text.
 * Returns array of raw strings between open and close tags.
 */
function extractBlocks(xml, tag) {
  const blocks = [];
  const openRe = new RegExp(`<${tag}[^>]*>`, 'gi');
  const closeStr = `</${tag}>`;
  let match;
  while ((match = openRe.exec(xml)) !== null) {
    const afterOpen = xml.indexOf('>', match.index) + 1;
    const closeIdx = xml.toLowerCase().indexOf(closeStr.toLowerCase(), afterOpen);
    if (closeIdx === -1) break;
    blocks.push(xml.slice(afterOpen, closeIdx));
    openRe.lastIndex = closeIdx + closeStr.length;
  }
  return blocks;
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

  return { title: stripCdata(title).trim(), url: url ? stripCdata(url).trim() : null, publishedAt };
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
    .filter((k) => k.length >= 4);
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

    const isAtomContentType = contentType.includes('application/atom+xml');
    const isRssContentType =
      contentType.includes('application/rss+xml') ||
      contentType.includes('text/xml') ||
      contentType.includes('application/xml');

    const hasRssTag = /<rss[\s>]/i.test(text);
    const hasFeedTag = /<feed[\s>]/i.test(text);

    if (!hasRssTag && !hasFeedTag && !isAtomContentType && !isRssContentType) {
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

    // Look for alternate feed links
    const linkRe = /<link[^>]+rel=["']alternate["'][^>]*>/gi;
    const matches = text.match(linkRe) ?? [];
    let feedHref = null;
    let feedKind = 'rss';

    for (const tag of matches) {
      const typeMatch = tag.match(/type=["']([^"']+)["']/i);
      if (!typeMatch) continue;
      const type = typeMatch[1];
      if (type.includes('rss+xml') || type.includes('atom+xml')) {
        const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
        if (hrefMatch) {
          feedHref = hrefMatch[1];
          feedKind = type.includes('atom+xml') ? 'html-alternate-feed' : 'html-alternate-feed';
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
 * Adapter 4: Try sitemap paths and extract <loc> URLs as sampleItems.
 */
async function trySitemap(url, overallSignal) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return { ok: false, error: 'Invalid URL for sitemap probe' };
  }

  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/news-sitemap.xml`,
  ];

  for (const candidate of candidates) {
    if (overallSignal.aborted) return { ok: false, error: 'Probe timeout' };
    try {
      const res = await fetchWithTimeout(candidate, overallSignal);
      if (!res.ok) continue;
      if (!res.text.includes('<loc>')) continue;

      const locs = [];
      const locRe = /<loc>([\s\S]*?)<\/loc>/gi;
      let match;
      while ((match = locRe.exec(res.text)) !== null && locs.length < 20) {
        locs.push(match[1].trim());
      }

      const items = locs.map((loc) => ({
        title: loc.split('/').filter(Boolean).pop() ?? loc,
        url: loc,
        publishedAt: null,
      }));

      return { ok: true, kind: 'sitemap-news', items, resolvedUrl: candidate };
    } catch {
      // try next
    }
  }

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

  let successResult = null;

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

      successResult = result;
      break;
    }
  } finally {
    clearTimeout(probeTimer);
  }

  // No adapter succeeded
  if (!successResult) {
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

  // Compute quality from parsed items
  const items = successResult.items ?? [];
  const { qualityScore, breakdown } = computeQuality(items, theme);

  // Status determination
  const parseOk = breakdown.parseOk;
  let status;
  if (!parseOk && items.length === 0) {
    status = 'failed';
  } else if (qualityScore >= qualityThreshold) {
    status = 'success';
  } else {
    status = 'partial';
  }

  // If playwright or llm-selector were the only successful adapter (stub returns ok:false
  // so this shouldn't happen, but guard anyway)
  const connectorKind = successResult.kind ?? 'manual';
  if (connectorKind === 'playwright' || connectorKind === 'llm-selector') {
    status = 'manual-required';
  }

  const sampleItems = items.slice(0, MAX_SAMPLE_ITEMS).map((item) => ({
    title: item.title,
    url: item.url,
    publishedAt: item.publishedAt,
  }));

  const nextAction = determineNextAction(status, qualityScore, qualityThreshold, breakdown.recentItemCount);

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
