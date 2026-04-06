import allowedDomains from '../../../shared/rss-allowed-domains.json';

import { addDiscoveredSource, listDiscoveredSources, listSourceRegistrySnapshot } from '../source-registry';
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

const PLAYWRIGHT_DOMAIN_LIMIT = 40;

type PlaywrightModule = typeof import('playwright');

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
