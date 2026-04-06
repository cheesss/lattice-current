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

function formatGdeltDate(date) {
  return date.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
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

// If GDELT completely fails after all retries, try alternative sources
async function fetchGdeltWithFallback(query, params) {
  const url = `http://api.gdeltproject.org/api/v2/doc/doc?${params}`;
  try {
    return await fetchGdeltJson(url);
  } catch (gdeltError) {
    // Fallback: try Google News RSS as alternative
    try {
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
      const response = await fetch(rssUrl, {
        headers: {
          accept: 'application/rss+xml, application/xml, text/xml',
          'user-agent': 'Mozilla/5.0',
        },
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Google News RSS fallback failed: ${response.status}`);
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
      // Convert RSS items to GDELT-like article format
      const articles = rssItems.slice(0, 50).map((item) => ({
        url: typeof item?.link === 'string' ? item.link : '',
        title: String(item?.title?.['#text'] || item?.title || '').trim(),
        seendate: String(item?.pubDate || new Date().toISOString()),
        domain: 'news.google.com',
        language: 'English',
        sourcecountry: 'United States',
        _fallbackSource: 'google-news-rss',
      }));
      return { articles, _fallback: true };
    } catch {
      throw gdeltError; // Re-throw original error
    }
  }
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
      // GDELT requires OR'd terms to be wrapped in parentheses
      const wrappedQuery = shardQuery.includes(' OR ') ? `(${shardQuery})` : shardQuery;
      const params = new URLSearchParams({
        query: wrappedQuery,
        mode,
        format: 'json',
        maxrecords: String(maxRecords),
      });
      if (window.start) params.set('startdatetime', String(window.start));
      if (window.end) params.set('enddatetime', String(window.end));
      if (args.sort) params.set('sort', String(args.sort));
      try {
        const data = await fetchGdeltJson(`http://api.gdeltproject.org/api/v2/doc/doc?${params}`);
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

async function runAutoThemes(args) {
  const { THEME_RULES, UNIVERSE_ASSET_CATALOG } = await import('../src/services/investment/constants.ts');
  const days = optionalInt(args.days, 30);
  const outDir = String(args['out-dir'] || 'data/historical/automation');
  const yahooRange = String(args.range || '6mo');
  const yahooInterval = String(args.interval || '1d');

  const now = Date.now();
  const endIso = new Date(now).toISOString();
  const startIso = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

  // Build GDELT queries from theme triggers (top 8 per theme)
  function buildQueryFromTriggers(triggers) {
    const top = triggers.slice(0, 8);
    const terms = top.map((t) => (t.includes(' ') ? `"${t}"` : t));
    return `(${terms.join(' OR ')})`;
  }

  // Collect unique Yahoo symbols from theme assets + universe catalog
  const symbolSet = new Set();
  for (const theme of THEME_RULES) {
    for (const asset of theme.assets) {
      if (!asset.symbol.startsWith('^')) symbolSet.add(asset.symbol);
    }
  }
  for (const asset of UNIVERSE_ASSET_CATALOG) {
    if (!asset.symbol.startsWith('^')) symbolSet.add(asset.symbol);
  }
  const uniqueSymbols = [...symbolSet].sort();

  const windows = partitionDateWindows(
    startIso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'),
    endIso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'),
    10,
  );

  let gdeltQueries = 0;
  let gdeltArticles = 0;
  let yahooRecords = 0;
  const themeIds = THEME_RULES.map((t) => t.id);

  // Fetch GDELT for each theme
  for (const theme of THEME_RULES) {
    const query = buildQueryFromTriggers(theme.triggers);
    const themeDir = path.resolve(outDir, `gdelt-${theme.id}`);
    await mkdir(themeDir, { recursive: true });

    for (const window of windows) {
      process.stderr.write(`[auto] fetching theme: ${theme.id} window ${window.start}..${window.end}\n`);
      await sleep(5500);
      try {
        const result = await fetchGdeltDoc({
          query,
          start: window.start,
          end: window.end,
          max: '250',
        });
        const articleCount = result?.data?.articles?.length || 0;
        gdeltArticles += articleCount;
        gdeltQueries += 1;
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        await writeFile(
          path.join(themeDir, `${ts}.json`),
          JSON.stringify({ fetchedAt: new Date().toISOString(), provider: 'gdelt-doc', envelope: result }, null, 2),
          'utf8',
        );
      } catch (error) {
        process.stderr.write(`[auto] GDELT error for ${theme.id}: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  }

  // Fetch global category queries for keyword-free discovery
  const globalCategories = [
    { name: 'global-conflict', query: '(war OR conflict OR military OR ceasefire)' },
    { name: 'global-economy', query: '(inflation OR recession OR GDP OR trade)' },
    { name: 'global-energy', query: '(oil OR gas OR renewable OR OPEC)' },
    { name: 'global-tech', query: '(AI OR semiconductor OR regulation OR cyber)' },
    { name: 'global-politics', query: '(election OR sanctions OR diplomacy OR summit)' },
  ];

  for (const cat of globalCategories) {
    const catDir = path.resolve(outDir, `gdelt-${cat.name}`);
    await mkdir(catDir, { recursive: true });

    for (const window of windows) {
      process.stderr.write(`[auto] fetching global category: ${cat.name} window ${window.start}..${window.end}\n`);
      await sleep(5500);
      try {
        const result = await fetchGdeltDoc({
          query: cat.query,
          start: window.start,
          end: window.end,
          max: '250',
        });
        const articleCount = result?.data?.articles?.length || 0;
        gdeltArticles += articleCount;
        gdeltQueries += 1;
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        await writeFile(
          path.join(catDir, `${ts}.json`),
          JSON.stringify({ fetchedAt: new Date().toISOString(), provider: 'gdelt-doc', envelope: result }, null, 2),
          'utf8',
        );
      } catch (error) {
        process.stderr.write(`[auto] GDELT error for ${cat.name}: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  }

  // Fetch Yahoo for each unique symbol
  for (const symbol of uniqueSymbols) {
    const symbolDir = path.resolve(outDir, `yahoo-${symbol}`);
    await mkdir(symbolDir, { recursive: true });
    process.stderr.write(`[auto] fetching yahoo: ${symbol}\n`);
    try {
      const result = await fetchYahooChart({
        symbol,
        range: yahooRange,
        interval: yahooInterval,
      });
      const itemCount = result?.data?.items?.length || 0;
      yahooRecords += itemCount;
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await writeFile(
        path.join(symbolDir, `${ts}.json`),
        JSON.stringify({ fetchedAt: new Date().toISOString(), provider: 'yahoo-chart', envelope: result }, null, 2),
        'utf8',
      );
    } catch (error) {
      process.stderr.write(`[auto] Yahoo error for ${symbol}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  // --- FRED macro series collection ---
  const fredSeries = [
    { id: 'CPIAUCSL', name: 'CPI' },
    { id: 'FEDFUNDS', name: 'Fed Funds Rate' },
    { id: 'UNRATE', name: 'Unemployment Rate' },
    { id: 'T10Y2Y', name: 'Yield Curve' },
    { id: 'DTWEXBGS', name: 'Dollar Index' },
    { id: 'BAMLH0A0HYM2', name: 'HY Spread' },
    { id: 'VIXCLS', name: 'VIX' },
  ];

  let fredRecords = 0;
  process.stderr.write(`[auto] fetching ${fredSeries.length} FRED series\n`);
  for (const series of fredSeries) {
    try {
      const fredDir = path.resolve(outDir, `fred-${series.id.toLowerCase()}`);
      await mkdir(fredDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const outPath = path.join(fredDir, `${ts}.json`);
      const result = await fetchFred({ series: series.id, observation_start: startIso.slice(0, 10) });
      await writeFile(
        outPath,
        JSON.stringify({ fetchedAt: new Date().toISOString(), provider: 'fred', envelope: result }, null, 2),
        'utf8',
      );
      fredRecords += 1;
      process.stderr.write(`[auto] FRED ${series.id}: ok\n`);
    } catch (e) {
      process.stderr.write(`[auto] FRED ${series.id}: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }

  const summary = {
    ok: true,
    themes: themeIds,
    gdeltQueries,
    gdeltArticles,
    yahooSymbols: uniqueSymbols,
    yahooRecords,
    fredSeries: fredSeries.map((s) => s.id),
    fredRecords,
  };
  console.log(JSON.stringify(summary, null, 2));
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
      '  fred        --series CPIAUCSL [--observation_start 2020-01-01]',
      '  alfred      --series GDP [--realtime_start 2024-01-01] [--realtime_end 2024-12-31]',
      '  gdelt-doc   --query "iran OR hormuz" [--start YYYYMMDDhhmmss] [--end YYYYMMDDhhmmss]',
      '  coingecko   --id bitcoin [--days 365] or [--from 2024-01-01 --to 2024-12-31]',
      '  yahoo-chart --symbol ITA [--range 6mo] [--interval 1d]',
      '  rss-feed    --url https://example.com/feed.xml [--name "Provider"] [--limit 80]',
      '  acled       [--country Iran] [--start 2026-01-01] [--end 2026-03-01]',
      '  auto-themes [--days 30] [--out-dir data/historical/automation]',
      '  global-news [--days 30] [--out-dir data/historical/automation] [--max 250]',
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

  if (provider === 'auto-themes') {
    return runAutoThemes(args);
  }

  if (provider === 'global-news') {
    const days = optionalInt(args.days, 30);
    const outDir = String(args.out_dir || args['out-dir'] || 'data/historical/automation').trim();
    const maxPerWindow = optionalInt(args.max, 250);

    // Broad queries covering major global categories
    const globalQueries = [
      '(war OR conflict OR military OR troops OR missile)',
      '(economy OR inflation OR recession OR GDP OR unemployment)',
      '(sanctions OR trade war OR tariff OR embargo)',
      '(oil OR energy OR gas OR nuclear power)',
      '(technology OR AI OR semiconductor OR regulation)',
      '(election OR protest OR coup OR political crisis)',
      '(central bank OR interest rate OR Fed OR ECB OR BOJ)',
      '(climate OR disaster OR earthquake OR hurricane)',
      '(cyber attack OR hacking OR ransomware)',
      '(supply chain OR shipping OR logistics OR port)',
    ];

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    const windows = partitionDateWindows(
      formatGdeltDate(startDate),
      formatGdeltDate(endDate),
      10, // 10-day windows
    );

    let totalArticles = 0;
    let totalQueries = 0;

    for (const query of globalQueries) {
      const categoryName = query.replace(/[()]/g, '').split(' OR ')[0].trim().toLowerCase().replace(/\s+/g, '-');
      const categoryDir = path.join(outDir, `global-${categoryName}`);
      await mkdir(categoryDir, { recursive: true });

      for (const window of windows) {
        await sleep(5500); // GDELT rate limit
        try {
          const params = new URLSearchParams({
            query: query + ' sourcelang:english',
            mode: 'ArtList',
            format: 'json',
            maxrecords: String(maxPerWindow),
          });
          if (window.start) params.set('startdatetime', String(window.start));
          if (window.end) params.set('enddatetime', String(window.end));

          const data = await fetchGdeltJson(`http://api.gdeltproject.org/api/v2/doc/doc?${params}`);
          const articles = Array.isArray(data?.articles) ? data.articles : [];
          totalArticles += articles.length;
          totalQueries++;

          if (articles.length > 0) {
            const outPath = path.join(categoryDir, `${window.start || 'latest'}.json`);
            const envelope = {
              fetchedAt: new Date().toISOString(),
              provider: 'gdelt-doc',
              envelope: {
                provider: 'gdelt-doc',
                request: { query, mode: 'ArtList', maxRecords: maxPerWindow },
                data: { articles },
                meta: { totalArticles: articles.length },
              },
            };
            await writeFile(outPath, JSON.stringify(envelope));
            process.stderr.write(`[global] ${categoryName} ${window.start || 'latest'}: ${articles.length} articles\n`);
          }
        } catch (error) {
          process.stderr.write(`[global] ${categoryName} error: ${error.message}\n`);
        }
      }
    }

    console.log(JSON.stringify({
      ok: true,
      provider: 'global-news',
      categories: globalQueries.length,
      totalQueries,
      totalArticles,
    }));
    return;
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
