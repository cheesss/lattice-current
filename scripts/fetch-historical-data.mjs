#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

function isoDate(value, fallback) {
  if (!value) return fallback;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date.toISOString();
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
  const params = new URLSearchParams({
    query,
    mode,
    format: 'json',
    maxrecords: String(maxRecords),
  });
  if (args.start) params.set('startdatetime', String(args.start));
  if (args.end) params.set('enddatetime', String(args.end));
  if (args.sort) params.set('sort', String(args.sort));
  return {
    provider: 'gdelt-doc',
    request: { query, mode, maxRecords, start: args.start || null, end: args.end || null },
    data: await fetchJson(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`),
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
  const token = process.env.ACLED_ACCESS_TOKEN;
  if (!token) throw new Error('ACLED_ACCESS_TOKEN is required');
  const startDate = String(args.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const endDate = String(args.end || new Date().toISOString().slice(0, 10));
  const eventTypes = String(args.event_types || 'Battles|Explosions/Remote violence|Violence against civilians');
  const limit = optionalInt(args.limit, 500);
  const params = new URLSearchParams({
    event_type: eventTypes,
    event_date: `${startDate}|${endDate}`,
    event_date_where: 'BETWEEN',
    limit: String(limit),
    _format: 'json',
  });
  if (args.country) params.set('country', String(args.country));
  return {
    provider: 'acled',
    request: { startDate, endDate, eventTypes, limit, country: args.country || null },
    data: await fetchJson(`https://acleddata.com/api/acled/read?${params}`, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
    }),
  };
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
      '  acled      [--country Iran] [--start 2026-01-01] [--end 2026-03-01]',
      '',
      'Optional:',
      '  --out data/historical/custom.json',
    ].join('\n'));
    process.exit(provider ? 0 : 1);
  }

  let envelope;
  switch (provider) {
    case 'fred':
      envelope = await fetchFred(args);
      break;
    case 'alfred':
      envelope = await fetchAlfred(args);
      break;
    case 'gdelt-doc':
      envelope = await fetchGdeltDoc(args);
      break;
    case 'coingecko':
      envelope = await fetchCoingecko(args);
      break;
    case 'acled':
      envelope = await fetchAcled(args);
      break;
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.resolve(String(args.out || `data/historical/${provider}/${timestamp}.json`));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    provider,
    envelope,
  }, null, 2), 'utf8');

  console.log(JSON.stringify({
    ok: true,
    provider,
    outputPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});
