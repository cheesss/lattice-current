#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split('=');
    const key = rawKey.trim();
    if (!key) continue;
    if (inlineValue != null) {
      args[key] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function requireArg(args, key, message) {
  const value = args[key];
  if (value == null || value === '') {
    throw new Error(message || `Missing --${key}`);
  }
  return String(value);
}

function optionalInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function buildAcledEqualityValue(fieldName, rawValue) {
  const parts = String(rawValue ?? '')
    .split('|')
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  return parts
    .map((value, index) => (index === 0 ? value : `${fieldName}=${value}`))
    .join(':OR:');
}

function isoDate(value, fallback) {
  if (!value) return fallback;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date.toISOString();
}

function chunk(items, size) {
  const safeSize = Math.max(1, Number(size) || 1);
  const pages = [];
  for (let index = 0; index < items.length; index += safeSize) {
    pages.push(items.slice(index, index + safeSize));
  }
  return pages;
}

function partitionDateWindows(startIso, endIso, windowDays) {
  const safeWindowDays = Math.max(1, Number(windowDays) || 0);
  if (!safeWindowDays || !startIso || !endIso) return [{ start: startIso || null, end: endIso || null }];
  const startTs = new Date(startIso).getTime();
  const endTs = new Date(endIso).getTime();
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) {
    return [{ start: startIso || null, end: endIso || null }];
  }
  const windows = [];
  let cursor = startTs;
  while (cursor < endTs) {
    const next = Math.min(endTs, cursor + safeWindowDays * 24 * 60 * 60 * 1000);
    windows.push({
      start: new Date(cursor).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'),
      end: new Date(next).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'),
    });
    cursor = next;
  }
  return windows;
}

function dedupeArticles(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item?.url || item?.title || item?.seendate || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const GDELT_MIN_INTERVAL_MS = Math.max(7000, optionalInt(process.env.GDELT_MIN_INTERVAL_MS, 8000));
const GDELT_MAX_ATTEMPTS = Math.max(1, optionalInt(process.env.GDELT_MAX_ATTEMPTS, 3));
const GDELT_RATE_LIMIT_JITTER_MS = Math.max(250, optionalInt(process.env.GDELT_RATE_LIMIT_JITTER_MS, 1250));
let lastGdeltDocRequestAt = 0;

function isGdeltRateLimitError(error) {
  return /429|Too Many Requests/i.test(error instanceof Error ? error.message : String(error || ''));
}

async function waitForGdeltWindow() {
  const elapsed = Date.now() - lastGdeltDocRequestAt;
  const waitMs = Math.max(0, GDELT_MIN_INTERVAL_MS - elapsed);
  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

async function fetchGdeltJson(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= GDELT_MAX_ATTEMPTS; attempt += 1) {
    await waitForGdeltWindow();
    lastGdeltDocRequestAt = Date.now();
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
      if (!isGdeltRateLimitError(error) || attempt >= GDELT_MAX_ATTEMPTS) {
        throw error;
      }
      const jitter = Math.round(Math.random() * GDELT_RATE_LIMIT_JITTER_MS);
      await sleep((GDELT_MIN_INTERVAL_MS * (attempt + 1)) + jitter);
    }
  }
  throw lastError || new Error('GDELT fetch failed');
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 400)}`);
  }
  return json;
}

function readCookieHeader(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    const cookies = response.headers.getSetCookie()
      .map((value) => String(value || '').split(';', 1)[0].trim())
      .filter(Boolean);
    if (cookies.length) return cookies.join('; ');
  }

  const fallback = response.headers.get('set-cookie');
  if (!fallback) return null;
  const firstCookie = String(fallback).split(';', 1)[0].trim();
  return firstCookie || null;
}

function decodeJwtPayload(token) {
  const parts = String(token || '').trim().split('.');
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function readAcledTokenExpiry(token) {
  const payload = decodeJwtPayload(token);
  const exp = Number(payload?.exp);
  if (!Number.isFinite(exp) || exp <= 0) return null;
  return new Date(Math.floor(exp) * 1000);
}

function formatAcledExpiry(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'unknown time';
  return date.toLocaleString('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(',', '') + ' KST';
}

async function getAcledAuthHeaders() {
  const email = String(process.env.ACLED_EMAIL || '').trim();
  const password = String(process.env.ACLED_PASSWORD || '').trim();
  return getAcledAuthHeadersWithPreference({
    token: String(process.env.ACLED_ACCESS_TOKEN || '').trim(),
    email,
    password,
  });
}

async function getAcledAuthHeadersWithPreference({ token, email, password, forceCookie = false }) {
  if (token) {
    const expiry = readAcledTokenExpiry(token);
    if (!forceCookie && (!expiry || expiry.getTime() > Date.now())) {
      return {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      };
    }
    if (expiry && expiry.getTime() <= Date.now()) {
      if (!email || !password) {
        throw new Error(`ACLED_ACCESS_TOKEN expired at ${formatAcledExpiry(expiry)}. Refresh the ACLED access token or set ACLED_EMAIL and ACLED_PASSWORD for cookie login fallback.`);
      }
    }
  }

  if (!email || !password) {
    throw new Error('ACLED_ACCESS_TOKEN is required (or set ACLED_EMAIL and ACLED_PASSWORD for cookie login)');
  }

  const response = await fetch('https://acleddata.com/user/login?_format=json', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: email,
      pass: password,
    }),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`ACLED cookie login failed: ${response.status} ${response.statusText}: ${text.slice(0, 400)}`);
  }

  const cookie = readCookieHeader(response);
  if (!cookie) {
    throw new Error('ACLED cookie login succeeded but no session cookie was returned');
  }

  return {
    accept: 'application/json',
    cookie,
    ...(json?.csrf_token ? { 'x-csrf-token': String(json.csrf_token) } : {}),
  };
}

async function fetchFred(args) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error('FRED_API_KEY is required');
  const seriesId = requireArg(args, 'series', 'Missing --series for fred');
  const limit = optionalInt(args.limit, 1000);
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    limit: String(limit),
    sort_order: String(args.sort || 'asc'),
  });
  if (args.observation_start) params.set('observation_start', String(args.observation_start));
  if (args.observation_end) params.set('observation_end', String(args.observation_end));
  return {
    provider: 'fred',
    request: { seriesId, limit, observationStart: args.observation_start || null, observationEnd: args.observation_end || null },
    data: await fetchJson(`https://api.stlouisfed.org/fred/series/observations?${params}`),
  };
}

async function fetchAlfred(args) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error('FRED_API_KEY is required for ALFRED as well');
  const seriesId = requireArg(args, 'series', 'Missing --series for alfred');
  const realtimeStart = String(args.realtime_start || '1776-07-04');
  const realtimeEnd = String(args.realtime_end || '9999-12-31');
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    realtime_start: realtimeStart,
    realtime_end: realtimeEnd,
    sort_order: String(args.sort || 'asc'),
    output_type: String(args.output_type || '2'),
  });
  if (args.observation_start) params.set('observation_start', String(args.observation_start));
  if (args.observation_end) params.set('observation_end', String(args.observation_end));

  const vintagesParams = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
  });

  const [observations, vintages] = await Promise.all([
    fetchJson(`https://api.stlouisfed.org/fred/series/observations?${params}`),
    fetchJson(`https://api.stlouisfed.org/fred/series/vintagedates?${vintagesParams}`),
  ]);

  return {
    provider: 'alfred',
    request: { seriesId, realtimeStart, realtimeEnd },
    data: {
      observations,
      vintages,
    },
  };
}

async function fetchGdeltDoc(args) {
  const query = requireArg(args, 'query', 'Missing --query for gdelt-doc');
  const mode = String(args.mode || 'ArtList');
  const maxRecords = optionalInt(args.max, 250);
  const shardTerms = String(args.query_terms || '')
    .split(/[|\n]/)
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const shardSize = Math.max(1, optionalInt(args.shard_size, shardTerms.length > 0 ? 3 : 0));
  const queryShards = shardTerms.length > 0
    ? chunk(shardTerms, shardSize).map((terms) => terms.map((term) => term.includes(' ') ? `"${term}"` : term).join(' OR '))
    : [query];
  const windows = partitionDateWindows(args.start ? String(args.start) : null, args.end ? String(args.end) : null, args.window_days);
  const articles = [];
  const partialErrors = [];
  for (const shardQuery of queryShards) {
    for (const window of windows) {
      const params = new URLSearchParams({
        query: shardQuery,
        mode,
        format: 'json',
        maxrecords: String(maxRecords),
      });
      if (window.start) params.set('startdatetime', String(window.start));
      if (window.end) params.set('enddatetime', String(window.end));
      if (args.sort) params.set('sort', String(args.sort));
      try {
        const data = await fetchGdeltJson(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`);
        const rows = Array.isArray(data?.articles) ? data.articles : [];
        articles.push(...rows);
      } catch (error) {
        partialErrors.push({
          query: shardQuery,
          start: window.start || null,
          end: window.end || null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  const dedupedArticles = dedupeArticles(articles);
  if (dedupedArticles.length === 0 && partialErrors.length > 0) {
    throw new Error(`GDELT fetch failed across all shards: ${partialErrors[0]?.error || 'unknown error'}`);
  }
  return {
    provider: 'gdelt-doc',
    request: {
      query,
      mode,
      maxRecords,
      start: args.start || null,
      end: args.end || null,
      queryShards,
      windowCount: windows.length,
      partialFailureCount: partialErrors.length,
    },
    data: {
      articles: dedupedArticles,
      meta: {
        query,
        queryShards,
        windows,
        partialErrors,
        rateLimitLossEstimate: queryShards.length * windows.length > 0
          ? Number((partialErrors.length / (queryShards.length * windows.length)).toFixed(4))
          : 0,
      },
    },
  };
}

async function fetchCoingecko(args) {
  const id = requireArg(args, 'id', 'Missing --id for coingecko');
  const vs = String(args.vs || 'usd');
  let url = '';
  if (args.from && args.to) {
    const fromTs = Math.floor(new Date(String(args.from)).getTime() / 1000);
    const toTs = Math.floor(new Date(String(args.to)).getTime() / 1000);
    if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) {
      throw new Error('Invalid --from/--to for coingecko');
    }
    url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart/range?vs_currency=${encodeURIComponent(vs)}&from=${fromTs}&to=${toTs}`;
  } else {
    const days = String(args.days || '365');
    url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=${encodeURIComponent(vs)}&days=${encodeURIComponent(days)}&interval=daily`;
  }
  return {
    provider: 'coingecko',
    request: { id, vs, from: args.from || null, to: args.to || null, days: args.days || null },
    data: await fetchJson(url, {
      headers: {
        accept: 'application/json',
      },
    }),
  };
}

async function fetchAcled(args) {
  const explicitWindow = Boolean(args.start || args.end);
  const endDate = String(args.end || new Date().toISOString().slice(0, 10));
  const eventTypes = buildAcledEqualityValue(
    'event_type',
    args.event_types || 'Battles|Explosions/Remote violence|Violence against civilians',
  );
  const limit = optionalInt(args.limit, 500);
  const headers = await getAcledAuthHeaders();
  const attemptWindows = explicitWindow
    ? [String(args.start)]
    : ['180d', '365d', '540d', '730d'];
  let lastResponse = null;

  for (const windowStart of attemptWindows) {
    const startDate = explicitWindow
      ? String(windowStart || new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
      : new Date(Date.now() - Number.parseInt(windowStart, 10) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const params = new URLSearchParams({
      event_type: eventTypes,
      event_date: `${startDate}|${endDate}`,
      event_date_where: 'BETWEEN',
      limit: String(limit),
      _format: 'json',
    });
    if (args.country) params.set('country', buildAcledEqualityValue('country', args.country));
    let data;
    try {
      data = await fetchJson(`https://acleddata.com/api/acled/read?${params}`, {
        headers,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '');
      const hasCookieFallback = String(process.env.ACLED_EMAIL || '').trim() && String(process.env.ACLED_PASSWORD || '').trim();
      const usedBearer = Boolean(headers?.authorization);
      if (!usedBearer || !hasCookieFallback || !/^401\b/i.test(message)) {
        throw error;
      }
      const fallbackHeaders = await getAcledAuthHeadersWithPreference({
        token: String(process.env.ACLED_ACCESS_TOKEN || '').trim(),
        email: String(process.env.ACLED_EMAIL || '').trim(),
        password: String(process.env.ACLED_PASSWORD || '').trim(),
        forceCookie: true,
      });
      data = await fetchJson(`https://acleddata.com/api/acled/read?${params}`, {
        headers: fallbackHeaders,
      });
    }
    const count = Number(data?.count || data?.total_count || (Array.isArray(data?.data) ? data.data.length : 0) || 0);
    lastResponse = {
      provider: 'acled',
      request: {
        startDate,
        endDate,
        eventTypes,
        limit,
        country: args.country || null,
        attemptedWindows: attemptWindows,
        fallbackApplied: !explicitWindow && windowStart !== attemptWindows[0],
      },
      data,
    };
    if (explicitWindow || count > 0) {
      return lastResponse;
    }
  }

  return lastResponse;
}

async function fetchYahooChart(args) {
  const symbol = requireArg(args, 'symbol', 'Missing --symbol for yahoo-chart');
  const range = String(args.range || '1mo');
  const interval = String(args.interval || '1d');
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
  const raw = await fetchJson(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0',
    },
  });
  const result = raw?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = Array.isArray(result?.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close : [];
  const items = timestamps.flatMap((timestamp, index) => {
    const price = Number(closes[index]);
    if (!Number.isFinite(price)) return [];
    return [{
      id: `${symbol}:${timestamp}`,
      sourceId: `yahoo-chart:${symbol}`,
      sourceName: 'Yahoo Finance',
      validTimeStart: new Date(Number(timestamp) * 1000).toISOString(),
      symbol: symbol.toUpperCase(),
      price,
      headline: `${symbol.toUpperCase()} price`,
      region: String(args.region || ''),
      link: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
    }];
  });
  return {
    provider: 'yahoo-chart',
    request: { symbol, range, interval, region: args.region || null },
    data: { items },
  };
}

async function fetchRssFeed(args) {
  const url = requireArg(args, 'url', 'Missing --url for rss-feed');
  const limit = optionalInt(args.limit, 80);
  const response = await fetch(url, {
    headers: {
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      'user-agent': 'Mozilla/5.0',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 400)}`);
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    textNodeName: '#text',
    parseTagValue: true,
    trimValues: true,
  });
  const xml = parser.parse(text);
  const rssItems = Array.isArray(xml?.rss?.channel?.item)
    ? xml.rss.channel.item
    : xml?.rss?.channel?.item
      ? [xml.rss.channel.item]
      : [];
  const atomEntries = Array.isArray(xml?.feed?.entry)
    ? xml.feed.entry
    : xml?.feed?.entry
      ? [xml.feed.entry]
      : [];
  const items = [...rssItems, ...atomEntries].slice(0, Math.max(1, limit)).map((item, index) => {
    const link = typeof item?.link === 'string'
      ? item.link
      : typeof item?.link?.href === 'string'
        ? item.link.href
        : null;
    const title = String(item?.title?.['#text'] || item?.title || item?.summary || item?.description || 'Feed item').trim();
    const validTimeStart = isoDate(item?.pubDate || item?.published || item?.updated || item?.dc_date, new Date().toISOString());
    return {
      id: `${url}:${validTimeStart}:${index}`,
      sourceId: `rss-feed:${url}`,
      sourceName: String(args.name || xml?.rss?.channel?.title || xml?.feed?.title || url),
      validTimeStart,
      headline: title,
      link,
      region: String(args.region || ''),
      sourceFamily: String(args.source_family || ''),
      featureFamily: String(args.feature_family || ''),
    };
  });
  return {
    provider: 'rss-feed',
    request: {
      url,
      name: args.name || null,
      limit,
      sourceFamily: args.source_family || null,
      featureFamily: args.feature_family || null,
    },
    data: { items },
  };
}

export async function fetchHistoricalEnvelope(provider, args = {}) {
  const normalizedProvider = String(provider || args.provider || args._?.[0] || '').trim().toLowerCase();
  switch (normalizedProvider) {
    case 'fred':
      return fetchFred(args);
    case 'alfred':
      return fetchAlfred(args);
    case 'gdelt-doc':
      return fetchGdeltDoc(args);
    case 'coingecko':
      return fetchCoingecko(args);
    case 'yahoo-chart':
      return fetchYahooChart(args);
    case 'rss-feed':
      return fetchRssFeed(args);
    case 'acled':
      return fetchAcled(args);
    default:
      throw new Error(`Unsupported provider: ${normalizedProvider || '(empty)'}`);
  }
}

export async function writeHistoricalEnvelope(outputPath, provider, envelope) {
  const resolved = path.resolve(String(outputPath || ''));
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    provider: String(provider || '').trim().toLowerCase(),
    envelope,
  }, null, 2), 'utf8');
  return resolved;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const provider = String(args.provider || args._[0] || '').trim().toLowerCase();
  if (!provider || args.help) {
    console.log([
      'Usage:',
      '  node scripts/fetch-historical-data.mjs <provider> [options]',
      '',
      'Providers:',
      '  fred       --series CPIAUCSL [--observation_start 2020-01-01]',
      '  alfred     --series GDP [--realtime_start 2024-01-01] [--realtime_end 2024-12-31]',
      '  gdelt-doc  --query "iran OR hormuz" [--start YYYYMMDDhhmmss] [--end YYYYMMDDhhmmss]',
      '  coingecko  --id bitcoin [--days 365] or [--from 2024-01-01 --to 2024-12-31]',
      '  yahoo-chart --symbol ITA [--range 6mo] [--interval 1d]',
      '  rss-feed   --url https://example.com/feed.xml [--name "Provider"] [--limit 80]',
      '  acled      [--country Iran] [--start 2026-01-01] [--end 2026-03-01]',
      '',
      'Optional:',
      '  --out data/historical/custom.json',
      '',
      'ACLED auth:',
      '  Prefer ACLED_ACCESS_TOKEN',
      '  Or set ACLED_EMAIL and ACLED_PASSWORD for cookie login fallback',
    ].join('\n'));
    process.exit(provider ? 0 : 1);
  }

  const envelope = await fetchHistoricalEnvelope(provider, args);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = await writeHistoricalEnvelope(
    String(args.out || `data/historical/${provider}/${timestamp}.json`),
    provider,
    envelope,
  );

  console.log(JSON.stringify({
    ok: true,
    provider,
    outputPath,
  }, null, 2));
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exit(1);
  });
}
