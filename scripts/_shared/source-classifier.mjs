/**
 * Source classifier — resolves (wire_source, publisher_group, market_relevance)
 * for an article given its URL / source string / title / content.
 *
 * Backed by shared/publisher-groups.json. Loaded once and cached.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.resolve(__dirname, '..', '..', 'shared', 'publisher-groups.json');

let cachedConfig = null;
let cachedDomainIndex = null;

function loadConfig() {
  if (cachedConfig) return cachedConfig;
  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  cachedConfig = JSON.parse(raw);
  return cachedConfig;
}

function buildDomainIndex() {
  if (cachedDomainIndex) return cachedDomainIndex;
  const config = loadConfig();
  const index = new Map();
  for (const [groupId, info] of Object.entries(config.groups || {})) {
    for (const domain of info.domains || []) {
      index.set(String(domain).toLowerCase(), {
        publisherGroup: groupId,
        marketRelevance: info.relevance || 'low',
      });
    }
  }
  cachedDomainIndex = index;
  return index;
}

function extractHostname(url) {
  if (!url) return null;
  try {
    const parsed = new URL(String(url));
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Look up (publisher_group, market_relevance) by article URL or source text.
 * Returns { publisherGroup: null, marketRelevance: 'low' } when unmapped.
 */
export function classifyPublisher({ url, source }) {
  const index = buildDomainIndex();
  const hostname = extractHostname(url);
  if (hostname) {
    const direct = index.get(hostname);
    if (direct) return direct;
    // Try parent domain (e.g. `en.euronews.com` → `euronews.com`)
    const parts = hostname.split('.');
    for (let i = 1; i < parts.length - 1; i += 1) {
      const parent = parts.slice(i).join('.');
      const hit = index.get(parent);
      if (hit) return hit;
    }
  }
  if (source) {
    const lowered = String(source).toLowerCase();
    for (const [domain, info] of index.entries()) {
      const name = domain.split('.')[0];
      if (name && lowered.includes(name)) return info;
    }
  }
  return { publisherGroup: null, marketRelevance: 'low' };
}

/**
 * Detect wire service (AP / Reuters / Bloomberg / AFP). Returns the wire name
 * or null when no match.
 */
export function detectWireSource({ url, title, body }) {
  const config = loadConfig();
  const patterns = Array.isArray(config.wire_patterns) ? config.wire_patterns : [];
  const hostname = extractHostname(url) || '';
  const loweredTitle = title ? String(title) : '';
  const loweredBody = body ? String(body).slice(0, 400) : '';

  for (const pattern of patterns) {
    if (pattern.domain_contains && hostname.includes(pattern.domain_contains)) {
      return pattern.name;
    }
    if (pattern.title_prefix && loweredTitle.startsWith(pattern.title_prefix)) {
      return pattern.name;
    }
    if (pattern.body_lead && loweredBody.includes(pattern.body_lead)) {
      return pattern.name;
    }
  }
  return null;
}

/**
 * Convenience: classify everything at once.
 */
export function classifyArticleSource({ url, source, title, body }) {
  const { publisherGroup, marketRelevance } = classifyPublisher({ url, source });
  const wireSource = detectWireSource({ url, title, body });
  return { publisherGroup, marketRelevance, wireSource };
}
