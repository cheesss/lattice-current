import path from 'node:path';
import { readFileSync } from 'node:fs';

const ALLOWED_DOMAINS_PATH = path.resolve('shared', 'rss-allowed-domains.json');

let cachedDomains = null;

function loadAllowedDomains() {
  if (cachedDomains) return cachedDomains;
  try {
    const parsed = JSON.parse(readFileSync(ALLOWED_DOMAINS_PATH, 'utf8'));
    cachedDomains = new Set(
      (Array.isArray(parsed) ? parsed : [])
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean),
    );
  } catch {
    cachedDomains = new Set();
  }
  return cachedDomains;
}

export function getAllowedFeedDomains() {
  return Array.from(loadAllowedDomains()).sort();
}

export function getFeedDomain(feedUrl) {
  try {
    return new URL(String(feedUrl || '').trim()).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isTrustedFeedUrl(feedUrl) {
  const domain = getFeedDomain(feedUrl);
  if (!domain) return false;
  const allowed = loadAllowedDomains();
  if (allowed.has(domain)) return true;
  const parts = domain.split('.');
  for (let index = 1; index < parts.length - 1; index += 1) {
    const suffix = parts.slice(index).join('.');
    if (allowed.has(suffix)) return true;
  }
  return false;
}
