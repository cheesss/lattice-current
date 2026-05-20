/**
 * Automatic source repair for failed add-rss proposals.
 *
 * The repair loop is intentionally two-stage:
 * 1. Deterministic candidate discovery from common feed/news paths and page links.
 * 2. Optional Codex candidate generation when SOURCE_REPAIR_LLM_ENABLED is not "false".
 *
 * The module never writes to the database. Callers decide whether a repaired
 * source can be applied directly or should be re-queued for human approval.
 */

import { probeSource as defaultProbeSource } from './source-probe.mjs';
import { runCodexJsonPrompt } from './codex-json.mjs';

const DEFAULT_MIN_QUALITY_SCORE = 0.65;
const DEFAULT_MAX_CANDIDATES = 12;
const FETCH_TIMEOUT_MS = 8_000;

const STOPWORDS = new Set([
  'about',
  'after',
  'against',
  'and',
  'are',
  'defense',
  'from',
  'into',
  'news',
  'risk',
  'source',
  'that',
  'the',
  'this',
  'with',
]);

const COMMON_PATHS = [
  '/feed.xml',
  '/rss.xml',
  '/atom.xml',
  '/feed/',
  '/rss/',
  '/news/feed/',
  '/news/rss.xml',
  '/newsroom/feed/',
  '/newsroom/rss.xml',
  '/pressroom/feed/',
  '/pressroom/rss.xml',
  '/press-releases/feed/',
  '/press-releases/rss.xml',
  '/media/feed/',
  '/media/rss.xml',
  '/blog/feed/',
  '/en/feed.xml',
  '/en/rss.xml',
  '/en/feed/',
  '/en/news/feed/',
  '/en/news/rss.xml',
  '/en/newsroom/',
  '/en/pressroom/',
  '/en/pressroom/pr/',
  '/en/pressroom/feed/',
  '/en/pressroom/rss.xml',
  '/en/media-centre/',
  '/en/media-center/',
  '/en/press-releases/',
];

const REPAIR_CATALOG = Object.freeze([
  {
    url: 'https://breakingdefense.com/feed/',
    label: 'Breaking Defense',
    category: 'defense-industrial',
    tags: ['defense', 'military', 'airspace', 'war', 'insurance', 'geopolitics', 'security'],
    reason: 'specialized defense industry RSS with frequent military and procurement coverage',
    confidence: 0.82,
  },
  {
    url: 'https://www.defenseone.com/rss/all/',
    label: 'Defense One',
    category: 'defense-industrial',
    tags: ['defense', 'military', 'geopolitics', 'security', 'policy', 'airspace'],
    reason: 'specialized defense policy RSS with broad security coverage',
    confidence: 0.82,
  },
  {
    url: 'https://www.militarytimes.com/arc/outboundfeeds/rss/?outputType=xml',
    label: 'Military Times',
    category: 'defense-industrial',
    tags: ['defense', 'military', 'war', 'troops', 'security'],
    reason: 'military news RSS with high article freshness',
    confidence: 0.8,
  },
  {
    url: 'https://www.navalnews.com/feed/',
    label: 'Naval News',
    category: 'defense-industrial',
    tags: ['defense', 'military', 'naval', 'shipping', 'suez', 'maritime', 'security'],
    reason: 'specialized naval and maritime defense feed',
    confidence: 0.76,
  },
  {
    url: 'https://www.airandspaceforces.com/feed/',
    label: 'Air & Space Forces Magazine',
    category: 'defense-industrial',
    tags: ['defense', 'military', 'airspace', 'aviation', 'space', 'security'],
    reason: 'airpower and space force RSS relevant to airspace risk monitoring',
    confidence: 0.75,
  },
  {
    url: 'https://www.armytimes.com/arc/outboundfeeds/rss/?outputType=xml',
    label: 'Army Times',
    category: 'defense-industrial',
    tags: ['defense', 'military', 'army', 'war', 'troops'],
    reason: 'military branch RSS with frequent operational coverage',
    confidence: 0.78,
  },
  {
    url: 'https://www.c4isrnet.com/arc/outboundfeeds/rss/?outputType=xml',
    label: 'C4ISRNET',
    category: 'defense-industrial',
    tags: ['defense', 'military', 'cybersecurity', 'drones', 'autonomy', 'ai', 'security'],
    reason: 'defense technology RSS for C4ISR, drones, cyber, and autonomy',
    confidence: 0.8,
  },
  {
    url: 'https://www.freightwaves.com/news/feed',
    label: 'FreightWaves',
    category: 'supply-chain-security',
    tags: ['supply', 'shipping', 'logistics', 'suez', 'maritime', 'insurance', 'freight'],
    reason: 'logistics RSS with frequent freight and supply-chain coverage',
    confidence: 0.84,
  },
  {
    url: 'https://gcaptain.com/feed/',
    label: 'gCaptain',
    category: 'supply-chain-security',
    tags: ['shipping', 'maritime', 'suez', 'insurance', 'freight', 'war', 'risk'],
    reason: 'maritime news RSS relevant to shipping lanes and war-risk insurance',
    confidence: 0.78,
  },
  {
    url: 'https://theloadstar.com/feed/',
    label: 'The Loadstar',
    category: 'supply-chain-security',
    tags: ['shipping', 'logistics', 'supply', 'freight', 'suez', 'ports'],
    reason: 'logistics and freight RSS for supply-chain disruption monitoring',
    confidence: 0.74,
  },
  {
    url: 'https://www.marinelink.com/news/rss',
    label: 'MarineLink',
    category: 'supply-chain-security',
    tags: ['shipping', 'maritime', 'suez', 'freight', 'ports', 'insurance'],
    reason: 'maritime industry RSS with vessel, port, and shipping coverage',
    confidence: 0.73,
  },
  {
    url: 'https://splash247.com/feed/',
    label: 'Splash247',
    category: 'supply-chain-security',
    tags: ['shipping', 'maritime', 'freight', 'ports', 'suez', 'insurance', 'risk'],
    reason: 'shipping and maritime RSS with frequent vessel, ports, and disruption coverage',
    confidence: 0.73,
  },
  {
    url: 'https://www.joc.com/rss.xml',
    label: 'Journal of Commerce',
    category: 'supply-chain-security',
    tags: ['shipping', 'logistics', 'freight', 'ports', 'supply', 'container'],
    reason: 'transportation and logistics RSS for freight and port disruption monitoring',
    confidence: 0.82,
  },
  {
    url: 'https://www.offshore-energy.biz/feed/',
    label: 'Offshore Energy',
    category: 'supply-chain-security',
    tags: ['shipping', 'energy', 'maritime', 'offshore', 'ports', 'supply'],
    reason: 'offshore energy and maritime RSS with infrastructure and vessel coverage',
    confidence: 0.72,
  },
  {
    url: 'https://feeds.feedburner.com/TheHackersNews',
    label: 'The Hacker News',
    category: 'cybersecurity',
    tags: ['cybersecurity', 'security', 'breach', 'malware', 'infrastructure'],
    reason: 'high-freshness cybersecurity RSS',
    confidence: 0.9,
  },
  {
    url: 'https://cyberscoop.com/feed/',
    label: 'CyberScoop',
    category: 'cybersecurity',
    tags: ['cybersecurity', 'security', 'policy', 'infrastructure'],
    reason: 'cybersecurity policy and threat RSS',
    confidence: 0.8,
  },
  {
    url: 'https://www.securityweek.com/feed/',
    label: 'SecurityWeek',
    category: 'cybersecurity',
    tags: ['cybersecurity', 'security', 'vulnerability', 'breach', 'malware', 'infrastructure'],
    reason: 'security operations RSS with high freshness across vulnerabilities and threat activity',
    confidence: 0.84,
  },
  {
    url: 'https://www.bleepingcomputer.com/feed/',
    label: 'BleepingComputer',
    category: 'cybersecurity',
    tags: ['cybersecurity', 'security', 'ransomware', 'malware', 'breach', 'infrastructure'],
    reason: 'high-frequency cybersecurity RSS focused on malware, ransomware, and incident response',
    confidence: 0.86,
  },
  {
    url: 'https://therecord.media/feed',
    label: 'The Record',
    category: 'cybersecurity',
    tags: ['cybersecurity', 'security', 'policy', 'breach', 'ransomware', 'infrastructure'],
    reason: 'cybersecurity news RSS with policy and threat reporting',
    confidence: 0.75,
  },
  {
    url: 'https://www.infosecurity-magazine.com/rss/news/',
    label: 'Infosecurity Magazine',
    category: 'cybersecurity',
    tags: ['cybersecurity', 'security', 'breach', 'privacy', 'policy', 'enterprise'],
    reason: 'security industry RSS with broad enterprise and policy coverage',
    confidence: 0.84,
  },
  {
    url: 'https://www.csoonline.com/feed/',
    label: 'CSO Online',
    category: 'cybersecurity',
    tags: ['cybersecurity', 'security', 'enterprise', 'risk', 'infrastructure', 'policy'],
    reason: 'enterprise security RSS relevant to cyber risk and infrastructure monitoring',
    confidence: 0.8,
  },
  {
    url: 'https://www.darkreading.com/rss.xml',
    label: 'Dark Reading',
    category: 'cybersecurity',
    tags: ['cybersecurity', 'security', 'ransomware', 'breach', 'vulnerability', 'enterprise'],
    reason: 'high-freshness security operations RSS for vulnerabilities, ransomware, and enterprise threats',
    confidence: 0.86,
  },
  {
    url: 'https://www.technologyreview.com/feed/',
    label: 'MIT Technology Review',
    category: 'ai-ml',
    tags: ['ai', 'ml', 'emerging', 'technology', 'semiconductor', 'robotics'],
    reason: 'technology RSS for AI and emerging-tech monitoring',
    confidence: 0.79,
  },
  {
    url: 'https://venturebeat.com/feed/',
    label: 'VentureBeat',
    category: 'ai-ml',
    tags: ['ai', 'ml', 'cloud', 'technology', 'semiconductor', 'enterprise'],
    reason: 'technology and AI RSS with frequent enterprise coverage',
    confidence: 0.73,
  },
  {
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    label: 'TechCrunch AI',
    category: 'ai-ml',
    tags: ['ai', 'ml', 'technology', 'startup', 'cloud', 'semiconductor'],
    reason: 'AI-focused technology RSS with frequent market and product coverage',
    confidence: 0.78,
  },
  {
    url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
    label: 'The Verge AI',
    category: 'ai-ml',
    tags: ['ai', 'ml', 'technology', 'consumer', 'software', 'cloud'],
    reason: 'AI-focused technology RSS useful for product, platform, and consumer adoption signals',
    confidence: 0.74,
  },
  {
    url: 'https://spectrum.ieee.org/feeds/feed.rss',
    label: 'IEEE Spectrum',
    category: 'emerging-tech',
    tags: ['technology', 'robotics', 'semiconductor', 'ai', 'ml', 'quantum', 'engineering'],
    reason: 'engineering and emerging-technology RSS for broad technical trend monitoring',
    confidence: 0.78,
  },
  {
    url: 'https://www.therobotreport.com/feed/',
    label: 'The Robot Report',
    category: 'robotics-automation',
    tags: ['robotics', 'automation', 'manufacturing', 'ai', 'industrial', 'technology'],
    reason: 'robotics RSS for automation, industrial robots, and commercial deployments',
    confidence: 0.77,
  },
  {
    url: 'https://semiengineering.com/feed/',
    label: 'Semiconductor Engineering',
    category: 'semiconductor',
    tags: ['semiconductor', 'chips', 'technology', 'manufacturing', 'supply', 'hardware'],
    reason: 'semiconductor industry RSS for chips, fabs, design, and manufacturing constraints',
    confidence: 0.76,
  },
  {
    url: 'https://www.datacenterdynamics.com/en/rss/',
    label: 'Data Center Dynamics',
    category: 'cloud-infrastructure',
    tags: ['cloud', 'infrastructure', 'data', 'energy', 'ai', 'technology'],
    reason: 'data center RSS for cloud infrastructure, capacity, power, and AI compute demand',
    confidence: 0.78,
  },
  {
    url: 'https://siliconangle.com/feed/',
    label: 'SiliconANGLE',
    category: 'cloud-infrastructure',
    tags: ['cloud', 'infrastructure', 'ai', 'enterprise', 'data', 'technology'],
    reason: 'enterprise technology RSS covering cloud, data infrastructure, AI platforms, and security',
    confidence: 0.78,
  },
  {
    url: 'https://www.pv-magazine.com/feed/',
    label: 'PV Magazine',
    category: 'clean-energy',
    tags: ['energy', 'solar', 'climate', 'grid', 'battery', 'supply'],
    reason: 'solar and clean-energy RSS with project, grid, and supply-chain coverage',
    confidence: 0.78,
  },
  {
    url: 'https://www.utilitydive.com/feeds/news/',
    label: 'Utility Dive',
    category: 'clean-energy',
    tags: ['energy', 'utilities', 'grid', 'climate', 'power', 'policy'],
    reason: 'utility-sector RSS for grid, generation, and power-policy monitoring',
    confidence: 0.77,
  },
  {
    url: 'https://insideclimatenews.org/feed/',
    label: 'Inside Climate News',
    category: 'clean-energy',
    tags: ['climate', 'energy', 'policy', 'grid', 'emissions', 'environment'],
    reason: 'climate and energy RSS for policy, emissions, and transition-risk monitoring',
    confidence: 0.76,
  },
  {
    url: 'https://www.canarymedia.com/rss',
    label: 'Canary Media',
    category: 'clean-energy',
    tags: ['energy', 'climate', 'grid', 'solar', 'storage', 'policy'],
    reason: 'clean-energy RSS with grid, storage, solar, and policy coverage',
    confidence: 0.82,
  },
  {
    url: 'https://www.energy-storage.news/feed/',
    label: 'Energy Storage News',
    category: 'clean-energy',
    tags: ['energy', 'storage', 'battery', 'grid', 'solar', 'infrastructure'],
    reason: 'energy storage RSS for batteries, grid-scale storage, and infrastructure capacity',
    confidence: 0.8,
  },
  {
    url: 'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml',
    label: 'Defense News',
    category: 'defense-industrial',
    tags: ['defense', 'military', 'security', 'procurement', 'geopolitics', 'airspace'],
    reason: 'defense industry RSS with military, acquisition, and security coverage',
    confidence: 0.82,
  },
  {
    url: 'https://www.twz.com/feed/',
    label: 'The War Zone',
    category: 'defense-industrial',
    tags: ['defense', 'military', 'airspace', 'drones', 'geopolitics', 'security'],
    reason: 'defense and military aviation RSS relevant to airspace, drones, and escalation monitoring',
    confidence: 0.8,
  },
  {
    url: 'https://warontherocks.com/feed/',
    label: 'War on the Rocks',
    category: 'defense-industrial',
    tags: ['defense', 'military', 'geopolitics', 'war', 'policy', 'security'],
    reason: 'defense policy RSS with military strategy and geopolitical risk analysis',
    confidence: 0.79,
  },
  {
    url: 'https://spacenews.com/feed/',
    label: 'SpaceNews',
    category: 'space',
    tags: ['space', 'satellite', 'defense', 'technology', 'launch', 'infrastructure'],
    reason: 'space industry RSS for satellite, launch, and defense-space infrastructure signals',
    confidence: 0.8,
  },
  {
    url: 'https://payloadspace.com/feed/',
    label: 'Payload Space',
    category: 'space',
    tags: ['space', 'satellite', 'launch', 'technology', 'defense', 'infrastructure'],
    reason: 'commercial space RSS for satellite, launch, and space infrastructure coverage',
    confidence: 0.76,
  },
  {
    url: 'https://www.flightglobal.com/rss',
    label: 'FlightGlobal',
    category: 'aerospace',
    tags: ['aerospace', 'aviation', 'airspace', 'airlines', 'defense', 'supply'],
    reason: 'aviation RSS for aerospace, airline operations, and airspace monitoring',
    confidence: 0.75,
  },
  {
    url: 'https://www.smartcitiesdive.com/feeds/news/',
    label: 'Smart Cities Dive',
    category: 'urban-infrastructure',
    tags: ['infrastructure', 'transport', 'cities', 'mobility', 'energy', 'policy'],
    reason: 'urban infrastructure RSS for transit, cities, mobility, and municipal policy signals',
    confidence: 0.75,
  },
  {
    url: 'https://www.biopharmadive.com/feeds/news/',
    label: 'BioPharma Dive',
    category: 'biotech',
    tags: ['biotech', 'pharma', 'healthcare', 'drug', 'clinical', 'technology'],
    reason: 'biopharma RSS for clinical, drug-development, and healthcare market signals',
    confidence: 0.76,
  },
  {
    url: 'https://medcitynews.com/feed/',
    label: 'MedCity News',
    category: 'biotech',
    tags: ['biotech', 'healthcare', 'pharma', 'medical', 'startup', 'technology'],
    reason: 'healthcare innovation RSS for biotech, care delivery, and medical technology signals',
    confidence: 0.76,
  },
]);

function safeString(value) {
  return String(value || '').trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function parseUrl(value, baseUrl = undefined) {
  try {
    return new URL(value, baseUrl);
  } catch {
    return null;
  }
}

export function normalizeCandidateUrl(value, baseUrl = undefined) {
  const parsed = parseUrl(value, baseUrl);
  if (!parsed || !/^https?:$/.test(parsed.protocol)) return '';
  parsed.hash = '';
  return parsed.href;
}

export function getRepairCatalogEntries() {
  return REPAIR_CATALOG
    .map((entry) => {
      const tags = toArray(entry.tags).map((tag) => safeString(tag).toLowerCase()).filter(Boolean);
      return {
        url: normalizeCandidateUrl(entry.url),
        label: entry.label,
        source: 'catalog-bootstrap',
        category: entry.category,
        topics: unique([entry.category, ...tags]).slice(0, 8),
        reason: entry.reason,
        confidence: Number(entry.confidence || 0.6),
        tags,
      };
    })
    .filter((entry) => entry.url);
}

export function isSameHostname(left, right) {
  const leftUrl = parseUrl(left);
  const rightUrl = parseUrl(right);
  return Boolean(leftUrl && rightUrl && leftUrl.hostname.toLowerCase() === rightUrl.hostname.toLowerCase());
}

function tokenize(value) {
  return unique(
    safeString(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 4 && !STOPWORDS.has(term)),
  ).slice(0, 12);
}

function stripHtml(value) {
  return safeString(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyBinaryOrDocument(url) {
  return /\.(pdf|docx?|xlsx?|pptx?|zip|png|jpe?g|gif|webp|svg)(?:[?#]|$)/i.test(url);
}

function scoreCandidate(candidate, { inputUrl, themeTerms }) {
  const url = safeString(candidate.url).toLowerCase();
  const label = safeString(candidate.label).toLowerCase();
  if (!url || isLikelyBinaryOrDocument(url)) return -1;

  let score = Number(candidate.confidence || 0) * 20;
  if (/rss|atom|feed/.test(url)) score += 45;
  if (/news|press|media|release|article|blog|update|alert|safety|security|advisory/.test(url)) score += 25;
  if (/sitemap/.test(url)) score -= 15;
  if (isSameHostname(inputUrl, url)) score += 8;

  let termHits = 0;
  for (const term of themeTerms) {
    if (url.includes(term) || label.includes(term)) termHits += 1;
  }
  score += Math.min(termHits * 7, 28);

  if (candidate.source === 'llm') score += 10;
  if (candidate.source === 'catalog-match') score += 18;
  if (candidate.source === 'catalog-fallback') score += 4;
  if (candidate.source === 'html-alternate') score += 80;
  if (candidate.source === 'html-link') score += 6;
  return score;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Lattice-SourceRepair/1.0' },
    });
    if (!response.ok) return '';
    return await response.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function extractHtmlCandidates(html, baseUrl) {
  const candidates = [];
  const linkRe = /<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let linkMatch;
  while ((linkMatch = linkRe.exec(html)) !== null) {
    const tag = linkMatch[0] || '';
    const url = normalizeCandidateUrl(linkMatch[1], baseUrl);
    if (!url) continue;
    const isFeed = /alternate|rss|atom|feed/i.test(tag);
    const isNews = /news|press|media|release|blog/i.test(tag + ' ' + url);
    if (!isFeed && !isNews) continue;
    candidates.push({
      url,
      label: stripHtml(tag).slice(0, 120),
      source: isFeed ? 'html-alternate' : 'html-link',
      reason: 'found in page link metadata',
      confidence: isFeed ? 0.9 : 0.55,
    });
  }

  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let anchorMatch;
  while ((anchorMatch = anchorRe.exec(html)) !== null) {
    const url = normalizeCandidateUrl(anchorMatch[1], baseUrl);
    if (!url) continue;
    const label = stripHtml(anchorMatch[2]).slice(0, 160);
    const haystack = `${url} ${label}`.toLowerCase();
    if (!/rss|atom|feed|news|press|media|release|blog|updates?|alerts?|advisor/.test(haystack)) continue;
    candidates.push({
      url,
      label,
      source: 'html-link',
      reason: 'found candidate news/feed link on source page',
      confidence: /rss|atom|feed/.test(haystack) ? 0.8 : 0.55,
    });
  }
  return candidates;
}

function buildCommonPathCandidates(inputUrl) {
  const parsed = parseUrl(inputUrl);
  if (!parsed) return [];
  return COMMON_PATHS.map((pathname) => ({
    url: normalizeCandidateUrl(pathname, parsed.origin),
    label: pathname,
    source: 'common-path',
    reason: 'common feed/news path probe',
    confidence: /rss|atom|feed/.test(pathname) ? 0.72 : 0.42,
  }));
}

export function buildCatalogRepairCandidates({
  inputUrl,
  theme = '',
  name = '',
  reason = '',
} = {}) {
  const normalizedInput = normalizeCandidateUrl(inputUrl);
  if (!normalizedInput) return [];
  const haystackTerms = tokenize([theme, name, reason].join(' '));
  const haystack = ` ${haystackTerms.join(' ')} `;
  return REPAIR_CATALOG
    .map((entry) => {
      const tags = toArray(entry.tags).map((tag) => safeString(tag).toLowerCase()).filter(Boolean);
      const matchedTags = tags.filter((tag) => haystack.includes(` ${tag} `) || haystackTerms.some((term) => tag.includes(term) || term.includes(tag)));
      const source = matchedTags.length > 0 ? 'catalog-match' : 'catalog-fallback';
      const confidence = Math.min(0.98, Number(entry.confidence || 0.6) + Math.min(matchedTags.length * 0.03, 0.12));
      return {
        url: normalizeCandidateUrl(entry.url),
        label: entry.label,
        source,
        category: entry.category,
        topics: unique([entry.category, ...tags]).slice(0, 8),
        reason: matchedTags.length
          ? `${entry.reason}; matched tags: ${matchedTags.slice(0, 5).join(', ')}`
          : entry.reason,
        confidence,
        tags,
        matchedTags,
      };
    })
    .filter((candidate) => candidate.url && candidate.url !== normalizedInput)
    .sort((a, b) => {
      const tagDelta = Number(b.matchedTags?.length || 0) - Number(a.matchedTags?.length || 0);
      return tagDelta || Number(b.confidence || 0) - Number(a.confidence || 0) || a.url.localeCompare(b.url);
    });
}

export async function buildHeuristicRepairCandidates({
  inputUrl,
  theme = '',
  name = '',
  reason = '',
  probe = null,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
} = {}) {
  const normalizedInput = normalizeCandidateUrl(inputUrl);
  if (!normalizedInput) return [];
  const parsed = parseUrl(normalizedInput);
  const themeTerms = tokenize([theme, name, reason].join(' '));

  const pageCandidates = [];
  for (const pageUrl of unique([normalizedInput, parsed.origin + '/'])) {
    const html = await fetchText(pageUrl);
    if (html) pageCandidates.push(...extractHtmlCandidates(html, pageUrl));
  }

  const sampleCandidates = toArray(probe?.sampleItems).map((item) => ({
    url: normalizeCandidateUrl(item?.url || item?.link, normalizedInput),
    label: safeString(item?.title),
    source: 'probe-sample',
    reason: 'reusing candidate found by the original probe',
    confidence: 0.35,
  }));

  const all = [
    ...pageCandidates,
    ...buildCatalogRepairCandidates({ inputUrl: normalizedInput, theme, name, reason }),
    ...buildCommonPathCandidates(normalizedInput),
    ...sampleCandidates,
  ].filter((candidate) => candidate.url && candidate.url !== normalizedInput);

  const byUrl = new Map();
  for (const candidate of all) {
    const existing = byUrl.get(candidate.url);
    if (!existing || scoreCandidate(candidate, { inputUrl: normalizedInput, themeTerms }) > scoreCandidate(existing, { inputUrl: normalizedInput, themeTerms })) {
      byUrl.set(candidate.url, candidate);
    }
  }

  return Array.from(byUrl.values())
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate, { inputUrl: normalizedInput, themeTerms }),
    }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, maxCandidates);
}

function extractJsonFromText(text) {
  const raw = safeString(text);
  if (!raw) return null;
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] || raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function normalizeLlmCandidates(payload, inputUrl) {
  const list = Array.isArray(payload?.candidates)
    ? payload.candidates
    : Array.isArray(payload)
      ? payload
      : payload?.suggestedResolvedUrl
        ? [payload]
        : [];

  return list
    .map((item) => ({
      url: normalizeCandidateUrl(item?.url || item?.suggestedResolvedUrl || item?.resolvedUrl, inputUrl),
      label: safeString(item?.name || item?.label || item?.connectorKind || ''),
      source: 'llm',
      reason: safeString(item?.reason || item?.reasoning || item?.extractionDetails || 'LLM repair candidate'),
      confidence: Math.max(0, Math.min(1, Number(item?.confidence || 0.5))),
      connectorKind: safeString(item?.connectorKind || ''),
    }))
    .filter((candidate) => candidate.url);
}

export async function buildCodexRepairCandidates({
  inputUrl,
  theme = '',
  name = '',
  reason = '',
  probe = null,
  maxCandidates = 5,
} = {}) {
  if (process.env.SOURCE_REPAIR_LLM_ENABLED === 'false') {
    return { candidates: [], skippedReason: 'SOURCE_REPAIR_LLM_ENABLED=false' };
  }

  const prompt = [
    'You are Codex repairing failed source ingestion candidates for Lattice Current.',
    'Do not use Claude Code or Anthropic tooling.',
    'Return JSON only. Do not include markdown.',
    '',
    `Input URL: ${inputUrl}`,
    `Source name: ${name || '(none)'}`,
    `Theme: ${theme || '(none)'}`,
    `Reason: ${reason || '(none)'}`,
    `Probe nextAction: ${probe?.nextAction || '(unknown)'}`,
    `Probe connector: ${probe?.connectorKind || '(unknown)'}`,
    `Probe qualityScore: ${probe?.qualityScore ?? '(unknown)'}`,
    `Probe recentItemCount: ${probe?.qualityBreakdown?.recentItemCount ?? 0}`,
    `Probe sample titles: ${toArray(probe?.sampleItems).slice(0, 5).map((item) => item.title).filter(Boolean).join(' | ') || '(none)'}`,
    '',
    'Find better machine-ingestable sources for the same monitoring intent.',
    'Prefer RSS, Atom, official news/press listing pages, or stable sitemap-backed news pages.',
    'If the original organization has no usable feed, suggest a better domain, but mark confidence lower.',
    '',
    'JSON schema:',
    '{',
    '  "candidates": [',
    '    { "url": "https://...", "name": "...", "connectorKind": "rss|atom|html-list|sitemap-news|manual", "confidence": 0.0, "reason": "..." }',
    '  ]',
    '}',
  ].join('\n');

  const result = await runCodexJsonPrompt(
    prompt,
    Math.max(30_000, Number(process.env.SOURCE_REPAIR_CODEX_TIMEOUT_MS || 120_000)),
    { label: 'source-repair-candidates' },
  );
  try {
    const parsed = result.parsed || extractJsonFromText(result.message);
    return {
      candidates: normalizeLlmCandidates(parsed, inputUrl).slice(0, maxCandidates),
      rawText: result.message,
      skippedReason: result.code === 0 ? null : `Codex repair failed: ${result.stderr || result.message || 'non-zero exit'}`,
    };
  } catch (error) {
    return {
      candidates: [],
      skippedReason: `Codex repair failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export const buildLlmRepairCandidates = buildCodexRepairCandidates;

function isAcceptedProbe(probe, minQualityScore) {
  return (
    (probe?.nextAction === 'register' || probe?.nextAction === 'review')
    && Number(probe?.qualityScore || 0) >= minQualityScore
    && Number(probe?.qualityBreakdown?.recentItemCount || 0) >= 3
  );
}

export async function attemptSourceRepair({
  inputUrl,
  theme = '',
  name = '',
  reason = '',
  probe = null,
  probeFn = defaultProbeSource,
  minQualityScore = DEFAULT_MIN_QUALITY_SCORE,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  enableLlm = true,
} = {}) {
  const normalizedInput = normalizeCandidateUrl(inputUrl);
  if (!normalizedInput) {
    return {
      attempted: false,
      repaired: false,
      reason: 'invalid input URL',
      candidates: [],
      attempts: [],
      best: null,
    };
  }

  const heuristicCandidates = await buildHeuristicRepairCandidates({
    inputUrl: normalizedInput,
    theme,
    name,
    reason,
    probe,
    maxCandidates,
  });
  const attempts = [];
  let best = null;
  const byUrl = new Map();

  const probeCandidates = async (candidateList) => {
    for (const candidate of candidateList) {
      if (!candidate.url || candidate.url === normalizedInput || byUrl.has(candidate.url)) continue;
      byUrl.set(candidate.url, candidate);
      const candidateProbe = await probeFn(candidate.url, {
        theme,
        qualityThreshold: minQualityScore,
      });
      const accepted = isAcceptedProbe(candidateProbe, minQualityScore);
      const attempt = {
        ...candidate,
        accepted,
        probe: candidateProbe,
        qualityScore: candidateProbe.qualityScore,
        recentItemCount: candidateProbe.qualityBreakdown?.recentItemCount || 0,
        connectorKind: candidateProbe.connectorKind,
        resolvedUrl: candidateProbe.resolvedUrl,
        nextAction: candidateProbe.nextAction,
      };
      attempts.push(attempt);
      if (accepted && (!best || candidateProbe.qualityScore > best.probe.qualityScore)) {
        best = attempt;
      }
    }
  };

  await probeCandidates(heuristicCandidates.slice(0, maxCandidates));

  const llmResult = best
    ? { candidates: [], skippedReason: 'Codex repair skipped because heuristic repair passed' }
    : enableLlm
      ? await buildCodexRepairCandidates({ inputUrl: normalizedInput, theme, name, reason, probe })
      : { candidates: [], skippedReason: 'Codex repair disabled by caller' };

  if (!best && llmResult.candidates.length > 0) {
    await probeCandidates(llmResult.candidates.slice(0, Math.max(0, maxCandidates - attempts.length)));
  }

  const candidates = Array.from(byUrl.values()).slice(0, maxCandidates);

  return {
    attempted: true,
    repaired: Boolean(best),
    reason: best
      ? `selected ${best.resolvedUrl || best.url} with quality ${best.probe.qualityScore.toFixed(2)}`
      : 'no repair candidate passed source probe',
    candidates,
    attempts,
    best,
    codexSkippedReason: llmResult.skippedReason || null,
    llmSkippedReason: llmResult.skippedReason || null,
  };
}
