import allowedDomains from '../../../shared/rss-allowed-domains.json';

import { addDiscoveredSource, listDiscoveredSources, listSourceRegistrySnapshot, setDiscoveredSourceStatus } from '../source-registry';
import { adjustKeywordConfidence, extractKeywordCandidatesFromText, listKeywordRegistry, upsertKeywordCandidates } from '../keyword-registry';
import { proposeGdeltTopicsFromKeywords } from '../gdelt-topic-registry';
import { AUTOMATION_THRESHOLDS } from '@/config/automation-thresholds';

export interface AutonomousDiscoveryResult {
  gdeltTopicsProposed: number;
  keywordSourceProposals: number;
  playwrightFeedProposals: number;
  sourceKeywordUpserts: number;
  keywordConfidenceAdjustments: number;
}

export interface FeedQualityScore {
  score: number;
  articleCount: number;
  avgTitleLength: number;
  languageDiversity: number;
  topicDiversity: number;
  spamRate: number;
  freshness: number;
}

const PLAYWRIGHT_DOMAIN_LIMIT = 40;

type PlaywrightModule = typeof import('playwright');

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFeedTitles(xml: string): Array<{ title: string; publishedAt: string | null }> {
  const titles = Array.from(String(xml || '').matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi))
    .map((match) => String(match[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim());
  const dates = Array.from(String(xml || '').matchAll(/<(?:pubDate|published|updated)>([\s\S]*?)<\/(?:pubDate|published|updated)>/gi))
    .map((match) => String(match[1] || '').trim());
  return titles
    .filter((title) => title.length >= 8)
    .slice(0, 50)
    .map((title, index) => ({
      title,
      publishedAt: dates[index] || null,
    }));
}

function detectLanguageHeuristic(text: string): string {
  const value = String(text || '');
  if (/[ㄱ-ㅎ가-힣]/.test(value)) return 'ko';
  if (/[ぁ-ゔァ-ヴー々〆〤]/.test(value)) return 'ja';
  return 'en';
}

export async function evaluateFeedQuality(feedUrl: string): Promise<FeedQualityScore> {
  const response = await fetch(feedUrl, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    return {
      score: 0,
      articleCount: 0,
      avgTitleLength: 0,
      languageDiversity: 0,
      topicDiversity: 0,
      spamRate: 1,
      freshness: 0,
    };
  }

  const xml = await response.text();
  const articles = parseFeedTitles(xml);
  if (articles.length < 5) {
    return {
      score: 0,
      articleCount: articles.length,
      avgTitleLength: articles.reduce((sum, article) => sum + article.title.length, 0) / Math.max(1, articles.length),
      languageDiversity: 1,
      topicDiversity: 0,
      spamRate: 0,
      freshness: 0,
    };
  }

  const avgTitleLength = articles.reduce((sum, article) => sum + article.title.length, 0) / articles.length;
  const languages = new Set(articles.map((article) => detectLanguageHeuristic(article.title)));
  const titleHashes = new Set(articles.map((article) => normalize(article.title).slice(0, 60)));
  const uniqueRate = titleHashes.size / articles.length;
  const spamPatterns = [/click here/i, /buy now/i, /limited offer/i, /\$\d+/];
  const spamCount = articles.filter((article) => spamPatterns.some((pattern) => pattern.test(article.title))).length;
  const spamRate = spamCount / articles.length;
  const recentCount = articles.filter((article) => {
    if (!article.publishedAt) return false;
    const timestamp = new Date(article.publishedAt).getTime();
    return Number.isFinite(timestamp) && (Date.now() - timestamp) < (7 * 86400000);
  }).length;
  const freshness = recentCount / articles.length;
  const score = Math.min(articles.length / 30, 1) * 0.2
    + Math.min(avgTitleLength / 80, 1) * 0.1
    + uniqueRate * 0.25
    + (1 - spamRate) * 0.25
    + freshness * 0.2;

  return {
    score: Math.max(0, Math.min(1, Number(score.toFixed(4)))),
    articleCount: articles.length,
    avgTitleLength: Number(avgTitleLength.toFixed(2)),
    languageDiversity: languages.size,
    topicDiversity: Number(uniqueRate.toFixed(4)),
    spamRate: Number(spamRate.toFixed(4)),
    freshness: Number(freshness.toFixed(4)),
  };
}

export async function evaluateAndRegisterFeed(
  feedUrl: string,
  source: string,
  options: {
    minScore?: number;
    autoRegister?: boolean;
    feedName?: string;
    lang?: string;
    topics?: string[];
  } = {},
): Promise<{ registered: boolean; quality: FeedQualityScore; reason?: string }> {
  const minScore = options.minScore ?? 0.65;
  const quality = await evaluateFeedQuality(feedUrl);
  if (quality.score < minScore) {
    return {
      registered: false,
      quality,
      reason: `quality ${quality.score.toFixed(2)} below threshold ${minScore}`,
    };
  }

  const [{ default: pg }, nasRuntime, schemaAutomation, budget] = await Promise.all([
    import('pg'),
    import('../../../scripts/_shared/nas-runtime.mjs'),
    import('../../../scripts/_shared/schema-automation.mjs'),
    import('../../../scripts/_shared/automation-budget.mjs'),
  ]);
  nasRuntime.loadOptionalEnvFile();
  const client = new pg.Client(nasRuntime.resolveNasPgConfig());
  await client.connect();
  try {
    await schemaAutomation.ensureAutomationSchema(client);
    const budgetCheck = await budget.checkBudget(client, 'rssRegistrations', 1);
    if (!budgetCheck.allowed) {
      return { registered: false, quality, reason: budgetCheck.reason };
    }

    const record = await addDiscoveredSource({
      category: source,
      feedName: options.feedName || `${source} auto feed`,
      url: feedUrl,
      lang: options.lang || 'en',
      discoveredBy: 'heuristic',
      confidence: Math.round(quality.score * 100),
      reason: `quality=${quality.score.toFixed(2)} auto-registered`,
      topics: options.topics || [],
    });
    if (!record) {
      return { registered: false, quality, reason: 'source registry rejected feed' };
    }

    if (options.autoRegister !== false) {
      await setDiscoveredSourceStatus(record.id, 'active', {
        actor: 'system',
        note: `auto-registered after quality screen ${quality.score.toFixed(2)}`,
      });
    }

    await budget.consumeBudget(client, 'rssRegistrations', 1, { feedUrl, score: quality.score, source });
    return { registered: true, quality };
  } finally {
    await client.end().catch(() => {});
  }
}

function domainCandidatesForKeyword(term: string, domain: string): string[] {
  const shortlist = new Set<string>();
  for (const host of allowedDomains) {
    const normalizedHost = String(host || '').toLowerCase();
    if (domain === 'defense' && /(defense|military|war|security|usni|oryx|rusi|warontherocks)/.test(normalizedHost)) shortlist.add(normalizedHost);
    if (domain === 'energy' && /(oil|energy|eia|mining|commodity|rigzone|kitco)/.test(normalizedHost)) shortlist.add(normalizedHost);
    if (domain === 'macro' && /(federalreserve|treasury|imf|worldbank|marketwatch|cnbc|ft|nikkei)/.test(normalizedHost)) shortlist.add(normalizedHost);
  }
  if (shortlist.size === 0) {
    for (const host of allowedDomains.slice(0, 12)) shortlist.add(String(host).toLowerCase());
  }
  return Array.from(shortlist).slice(0, 6).map((host) => (
    `https://news.google.com/rss/search?q=${encodeURIComponent(`"${term}" site:${host}`)}&hl=${AUTOMATION_THRESHOLDS.locale.newsLanguage}-${AUTOMATION_THRESHOLDS.locale.newsRegion}&gl=${AUTOMATION_THRESHOLDS.locale.newsRegion}&ceid=${AUTOMATION_THRESHOLDS.locale.newsRegion}:${AUTOMATION_THRESHOLDS.locale.newsLanguage}`
  ));
}

async function proposeSourcesFromKeywords(): Promise<number> {
  const keywords = await listKeywordRegistry();
  let created = 0;
  for (const keyword of keywords
    .filter((record) => record.confidence >= 85 && record.repeatCount >= 5)
    .slice(0, 24)) {
    for (const url of domainCandidatesForKeyword(keyword.term, keyword.domain)) {
      // eslint-disable-next-line no-await-in-loop
      const source = await addDiscoveredSource({
        category: keyword.domain,
        feedName: `${keyword.term} monitor`,
        url,
        lang: keyword.lang,
        discoveredBy: 'heuristic',
        confidence: keyword.confidence,
        reason: `Keyword-driven source proposal for ${keyword.term}`,
        topics: [keyword.term, keyword.canonicalName].filter(Boolean),
      });
      if (source) created += 1;
    }
  }
  return created;
}

function extractAlternateFeedUrls(html: string, host: string): string[] {
  const matches = Array.from(
    html.matchAll(/<link[^>]+rel=["']alternate["'][^>]+type=["']application\/(?:rss\+xml|atom\+xml|xml)["'][^>]+href=["']([^"']+)["']/gi),
  );
  return matches
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean)
    .map((href) => {
      try {
        return new URL(href, `https://${host}`).toString();
      } catch {
        return '';
      }
    })
    .filter(Boolean)
    .slice(0, 3);
}

async function loadPlaywright(): Promise<PlaywrightModule | null> {
  try {
    return await import('playwright');
  } catch {
    return null;
  }
}

async function fetchFeedUrlsWithPlaywright(host: string): Promise<string[]> {
  const playwright = await loadPlaywright();
  if (!playwright) return [];

  let browser: Awaited<ReturnType<PlaywrightModule['chromium']['launch']>> | null = null;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`https://${host}`, { waitUntil: 'domcontentloaded', timeout: 8_000 });
    const urls = await page.evaluate(() => Array.from(
      document.querySelectorAll('link[rel="alternate"][href]'),
    )
      .map((node) => ({
        href: node.getAttribute('href') || '',
        type: (node.getAttribute('type') || '').toLowerCase(),
      }))
      .filter((entry) => /application\/(rss\+xml|atom\+xml|xml)/.test(entry.type))
      .map((entry) => entry.href));

    return urls
      .map((href) => {
        try {
          return new URL(href, `https://${host}`).toString();
        } catch {
          return '';
        }
      })
      .filter(Boolean)
      .slice(0, 3);
  } catch {
    return [];
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function discoverPlaywrightFeedsFromAllowedDomains(): Promise<number> {
  let created = 0;
  const existing = await listDiscoveredSources();
  const existingUrls = new Set(existing.map((source) => source.url.toLowerCase()));
  for (const host of allowedDomains.slice(0, PLAYWRIGHT_DOMAIN_LIMIT)) {
    try {
      // Prefer browser-rendered alternate feed discovery when Playwright is available.
      // Fall back to a plain fetch so the sweep still runs in constrained environments.
      // eslint-disable-next-line no-await-in-loop
      let feeds = await fetchFeedUrlsWithPlaywright(host);
      if (feeds.length === 0) {
        // eslint-disable-next-line no-await-in-loop
        const resp = await fetch(`https://${host}`, { signal: AbortSignal.timeout(8_000) });
        if (!resp.ok) continue;
        // eslint-disable-next-line no-await-in-loop
        const html = await resp.text();
        feeds = extractAlternateFeedUrls(html, host);
      }
      for (const url of feeds) {
        if (existingUrls.has(url.toLowerCase())) continue;
        // eslint-disable-next-line no-await-in-loop
        const record = await addDiscoveredSource({
          category: 'politics',
          feedName: `${host} feed`,
          url,
          lang: 'en',
          discoveredBy: 'playwright',
          confidence: 72,
          reason: `Auto-discovered RSS/Atom alternate on ${host}`,
          topics: [host],
        });
        if (record) {
          created += 1;
          existingUrls.add(url.toLowerCase());
        }
      }
    } catch {
      continue;
    }
  }
  return created;
}

function extractTitlesFromXml(xml: string): string[] {
  return Array.from(xml.matchAll(/<title>([^<]+)<\/title>/gi))
    .map((match) => String(match[1] || '').trim())
    .filter((title) => title.length >= 12)
    .slice(0, 8);
}

async function extractKeywordsFromDiscoveredSources(): Promise<number> {
  const discovered = await listDiscoveredSources();
  let upserts = 0;
  for (const source of discovered.filter((item) => item.status === 'active' || item.status === 'approved').slice(0, 12)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const resp = await fetch(source.url, { signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) continue;
      // eslint-disable-next-line no-await-in-loop
      const xml = await resp.text();
      const titles = extractTitlesFromXml(xml);
      const candidates = titles.flatMap((title) => extractKeywordCandidatesFromText(title, {
        domain: source.category.includes('macro') ? 'macro' : source.category.includes('energy') ? 'energy' : source.category.includes('defense') ? 'defense' : 'mixed',
        lang: source.lang || 'en',
        ingress: 'playwright',
      }));
      if (candidates.length === 0) continue;
      // eslint-disable-next-line no-await-in-loop
      const records = await upsertKeywordCandidates(candidates.slice(0, 16));
      upserts += records.length;
    } catch {
      continue;
    }
  }
  return upserts;
}

async function applySourceHealthFeedback(): Promise<number> {
  const registry = await listSourceRegistrySnapshot();
  const degradedTopics = registry.records
    .filter((record) => record.status === 'degraded')
    .map((record) => normalize(record.feedName));
  if (degradedTopics.length === 0) return 0;
  const keywords = await listKeywordRegistry();
  let adjusted = 0;
  for (const keyword of keywords.slice(0, 120)) {
    if (!degradedTopics.some((topic) => topic.includes(keyword.term) || normalize(keyword.term).includes(topic))) continue;
    // eslint-disable-next-line no-await-in-loop
    const result = await adjustKeywordConfidence(keyword.term, -10);
    if (result) adjusted += 1;
  }
  return adjusted;
}

export async function runAutonomousDiscoverySweep(): Promise<AutonomousDiscoveryResult> {
  const gdeltTopics = await proposeGdeltTopicsFromKeywords();
  const keywordSourceProposals = await proposeSourcesFromKeywords();
  const playwrightFeedProposals = await discoverPlaywrightFeedsFromAllowedDomains();
  const sourceKeywordUpserts = await extractKeywordsFromDiscoveredSources();
  const keywordConfidenceAdjustments = await applySourceHealthFeedback();

  return {
    gdeltTopicsProposed: gdeltTopics.length,
    keywordSourceProposals,
    playwrightFeedProposals,
    sourceKeywordUpserts,
    keywordConfidenceAdjustments,
  };
}
