import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const COVERAGE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 18;
const MAX_SYMBOLS = 120;
const MIN_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 40;
const DEFAULT_OPENBB_BASE_URL = 'http://127.0.0.1:6900';
const OPENBB_BOOT_TIMEOUT_MS = 30_000;
const OPENBB_BOOT_POLL_MS = 650;
const OPENBB_BOOT_COOLDOWN_MS = 4_000;

const COMMANDS = {
  equityHistorical: '/equity/price/historical',
  equityQuote: '/equity/price/quote',
  cryptoHistorical: '/crypto/price/historical',
  commoditySpot: '/commodity/price/spot',
};

let coverageCache = null;
let openbbBootPromise = null;
let openbbLastBootAttemptAt = 0;
let openbbChildProcess = null;
let openbbExitHooksRegistered = false;

function jsonResponse(body, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

function getOpenbbBaseUrl() {
  const raw = (typeof process !== 'undefined' ? (process.env.OPENBB_API_URL || '') : '').trim();
  if (!raw) return DEFAULT_OPENBB_BASE_URL;
  return raw.replace(/\/$/, '');
}

function getOpenbbHeaders() {
  const headers = {
    Accept: 'application/json',
  };
  const key = (typeof process !== 'undefined' ? (process.env.OPENBB_API_KEY || '') : '').trim();
  if (key) {
    headers.Authorization = `Bearer ${key}`;
    headers['x-api-key'] = key;
  }
  return headers;
}

function isNodeRuntime() {
  return typeof process !== 'undefined' && Boolean(process?.versions?.node);
}

function getEnvVar(name) {
  if (!isNodeRuntime()) return '';
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLocalBaseUrl(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  } catch {
    return false;
  }
}

function parseBaseHostPort(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname || '127.0.0.1';
    const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
    return {
      host,
      port: Number.isFinite(port) && port > 0 ? port : 6900,
    };
  } catch {
    return {
      host: '127.0.0.1',
      port: 6900,
    };
  }
}

function getOpenbbSpawnCandidates(host, port) {
  const args = ['--host', host, '--port', String(port)];
  const candidates = [];
  const seen = new Set();
  const add = (command, shell = false) => {
    if (!command) return;
    const key = `${command}|${shell ? '1' : '0'}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ command, args, shell });
  };

  const explicit = getEnvVar('OPENBB_API_CMD');
  if (explicit) {
    add(explicit, true);
  }

  const isWindows = isNodeRuntime() && process.platform === 'win32';
  add('openbb-api', false);
  if (isWindows) {
    add('openbb-api', true);
    add('openbb-api.exe', false);
  }

  if (isWindows) {
    const userProfile = getEnvVar('USERPROFILE');
    const localAppData = getEnvVar('LOCALAPPDATA');
    if (userProfile) {
      add(`${userProfile}\\anaconda3\\Scripts\\openbb-api.exe`);
      add(`${userProfile}\\miniconda3\\Scripts\\openbb-api.exe`);
    }
    if (localAppData) {
      add(`${localAppData}\\Programs\\Python\\Python313\\Scripts\\openbb-api.exe`);
      add(`${localAppData}\\Programs\\Python\\Python312\\Scripts\\openbb-api.exe`);
      add(`${localAppData}\\Programs\\Python\\Python311\\Scripts\\openbb-api.exe`);
    }
  }

  return candidates;
}

function registerOpenbbExitHooks() {
  if (!isNodeRuntime() || openbbExitHooksRegistered) return;
  openbbExitHooksRegistered = true;

  const shutdown = () => {
    try {
      if (openbbChildProcess && !openbbChildProcess.killed) {
        openbbChildProcess.kill();
      }
    } catch {
      // no-op
    }
  };

  process.once('exit', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

async function spawnOpenbbCandidate(candidate) {
  if (!isNodeRuntime()) {
    return { ok: false, reason: 'Node runtime unavailable' };
  }

  let spawn;
  try {
    ({ spawn } = await import('node:child_process'));
  } catch {
    return { ok: false, reason: 'child_process unavailable' };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const child = spawn(candidate.command, candidate.args, {
        stdio: 'ignore',
        windowsHide: true,
        shell: candidate.shell,
      });

      child.once('error', (error) => {
        finish({ ok: false, reason: error?.message || 'spawn error' });
      });

      child.once('spawn', () => {
        finish({ ok: true, child });
      });

      setTimeout(() => {
        if (!settled) {
          finish(
            typeof child.pid === 'number' && child.pid > 0
              ? { ok: true, child }
              : { ok: false, reason: 'spawn timeout' }
          );
        }
      }, 500);
    } catch (error) {
      finish({ ok: false, reason: error?.message || 'spawn failed' });
    }
  });
}

async function startOpenbbLocalProcess(baseUrl) {
  const { host, port } = parseBaseHostPort(baseUrl);
  const candidates = getOpenbbSpawnCandidates(host, port);
  if (candidates.length === 0) {
    return { ok: false, reason: 'No openbb-api launch candidates' };
  }

  registerOpenbbExitHooks();

  for (const candidate of candidates) {
    const launched = await spawnOpenbbCandidate(candidate);
    if (!launched.ok || !launched.child) {
      continue;
    }
    openbbChildProcess = launched.child;
    openbbChildProcess.once('exit', () => {
      if (openbbChildProcess === launched.child) {
        openbbChildProcess = null;
      }
    });

    return {
      ok: true,
      command: candidate.command,
    };
  }

  return {
    ok: false,
    reason: 'openbb-api command not found',
  };
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeSymbols(raw) {
  const deduped = [];
  const seen = new Set();
  for (const value of raw.split(',')) {
    const symbol = value.trim();
    if (!symbol) continue;
    const key = symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(symbol);
    if (deduped.length >= MAX_SYMBOLS) break;
  }
  return deduped;
}

function normalizeBatchSize(raw) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_BATCH_SIZE;
  return Math.max(MIN_BATCH_SIZE, Math.min(MAX_BATCH_SIZE, Math.floor(parsed)));
}

function chunkSymbols(symbols, size) {
  const chunks = [];
  for (let i = 0; i < symbols.length; i += size) {
    chunks.push(symbols.slice(i, i + size));
  }
  return chunks;
}

function isCryptoSymbol(symbol) {
  return typeof symbol === 'string' && symbol.toUpperCase().endsWith('-USD');
}

function hasCommand(commands, command) {
  return Array.isArray(commands) && commands.includes(command);
}

function buildCoverageSummary(commands) {
  const unique = Array.from(new Set(commands.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))).sort();
  return {
    commandCount: unique.length,
    commands: unique,
    hasEquityPriceHistorical: hasCommand(unique, COMMANDS.equityHistorical),
    hasEquityPriceQuote: hasCommand(unique, COMMANDS.equityQuote),
    hasCryptoPriceHistorical: hasCommand(unique, COMMANDS.cryptoHistorical),
    hasCommodityPriceSpot: hasCommand(unique, COMMANDS.commoditySpot),
  };
}

function toCoveragePayload(coverage) {
  const summary = buildCoverageSummary(coverage.commands || []);
  return {
    ...summary,
    providers: coverage.providers || {},
    fetchedAt: coverage.fetchedAt,
    cached: Boolean(coverage.cached),
  };
}

async function fetchJson(url, headers, timeoutMs = 9000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, payload: null };
    }
    const payload = await response.json();
    return { ok: true, status: response.status, payload };
  } catch {
    return { ok: false, status: 0, payload: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseCoveragePayload(providersPayload, commandsPayload) {
  const providers = {};
  if (providersPayload && typeof providersPayload === 'object') {
    for (const [provider, commandList] of Object.entries(providersPayload)) {
      if (!Array.isArray(commandList)) continue;
      providers[provider] = commandList
        .map((item) => typeof item === 'string' ? item.trim() : '')
        .filter(Boolean);
    }
  }

  const commandSet = new Set();

  if (commandsPayload && typeof commandsPayload === 'object') {
    for (const [command, providerList] of Object.entries(commandsPayload)) {
      if (typeof command === 'string' && command.trim()) {
        commandSet.add(command.trim());
      }
      if (Array.isArray(providerList)) {
        for (const maybeCommand of providerList) {
          if (typeof maybeCommand === 'string' && maybeCommand.startsWith('/')) {
            commandSet.add(maybeCommand.trim());
          }
        }
      }
    }
  }

  for (const commandList of Object.values(providers)) {
    for (const command of commandList) {
      commandSet.add(command);
    }
  }

  return {
    providers,
    commands: Array.from(commandSet).sort(),
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchOpenbbCoverage(baseUrl, headers, { force = false } = {}) {
  const now = Date.now();
  if (
    !force
    && coverageCache
    && coverageCache.baseUrl === baseUrl
    && (now - coverageCache.fetchedAtMs) < COVERAGE_TTL_MS
  ) {
    return {
      ok: true,
      data: {
        ...coverageCache.data,
        cached: true,
      },
    };
  }

  const [providersResult, commandsResult] = await Promise.all([
    fetchJson(`${baseUrl}/api/v1/coverage/providers`, headers, 9000),
    fetchJson(`${baseUrl}/api/v1/coverage/commands`, headers, 9000),
  ]);

  if (!providersResult.ok || !commandsResult.ok) {
    return {
      ok: false,
      reason: 'OpenBB coverage endpoint failed',
    };
  }

  const data = parseCoveragePayload(providersResult.payload, commandsResult.payload);
  coverageCache = {
    baseUrl,
    fetchedAtMs: now,
    data,
  };

  return {
    ok: true,
    data: {
      ...data,
      cached: false,
    },
  };
}

function pushPoint(map, symbol, point) {
  if (!symbol) return;
  const row = {
    symbol,
    date: point.date || point.datetime || point.timestamp || point.last_timestamp || point.lastTimestamp || new Date().toISOString(),
    close: toNumber(point.close ?? point.adj_close ?? point.last_price ?? point.price),
    volume: toNumber(point.volume ?? point.vol ?? point.turnover ?? point.exchange_volume),
    prevClose: toNumber(point.prev_close ?? point.previous_close),
    changePct: toNumber(point.change_percent ?? point.changePct),
    changeAbs: toNumber(point.change),
  };

  if (row.close == null) return;
  const bucket = map.get(symbol) || [];
  bucket.push(row);
  map.set(symbol, bucket);
}

function collectRows(payload, requestedSymbols, targetMap) {
  if (!payload || typeof payload !== 'object') return;
  const fallbackSymbol = requestedSymbols.length === 1 ? requestedSymbols[0] : '';

  const parseArray = (rows, forcedSymbol = '') => {
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const symbol = typeof row.symbol === 'string'
        ? row.symbol
        : typeof row.ticker === 'string'
          ? row.ticker
          : forcedSymbol || fallbackSymbol;
      pushPoint(targetMap, symbol, row);
    }
  };

  if (Array.isArray(payload)) {
    parseArray(payload);
    return;
  }

  const results = payload.results;
  if (Array.isArray(results)) {
    parseArray(results);
  } else if (results && typeof results === 'object') {
    for (const [symbol, rows] of Object.entries(results)) {
      if (Array.isArray(rows)) parseArray(rows, symbol);
    }
  }

  const data = payload.data;
  if (Array.isArray(data)) {
    parseArray(data);
  } else if (data && typeof data === 'object') {
    for (const [symbol, rows] of Object.entries(data)) {
      if (Array.isArray(rows)) parseArray(rows, symbol);
    }
  }

  for (const [symbol, rows] of Object.entries(payload)) {
    if (symbol === 'results' || symbol === 'data') continue;
    if (Array.isArray(rows)) parseArray(rows, symbol);
  }
}

function buildTapeRows(pointsBySymbol) {
  const rows = [];
  for (const [symbol, rowsForSymbol] of pointsBySymbol.entries()) {
    if (!Array.isArray(rowsForSymbol) || rowsForSymbol.length === 0) continue;

    rowsForSymbol.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const latest = rowsForSymbol[rowsForSymbol.length - 1];
    const prev = rowsForSymbol.length > 1 ? rowsForSymbol[rowsForSymbol.length - 2] : null;
    if (!latest || latest.close == null) continue;

    const prevClose = latest.prevClose ?? prev?.close ?? null;
    let changeAbs = latest.changeAbs ?? null;
    let changePct = latest.changePct ?? null;

    if (prevClose != null && prevClose !== 0) {
      if (changeAbs == null) changeAbs = latest.close - prevClose;
      if (changePct == null) changePct = (changeAbs / prevClose) * 100;
    } else {
      if (changeAbs == null) changeAbs = 0;
      if (changePct == null) changePct = 0;
    }

    rows.push({
      symbol,
      price: latest.close,
      prevClose,
      changeAbs,
      changePct,
      volume: latest.volume ?? null,
    });
  }

  rows.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  return rows;
}

async function fetchEndpointBatches({
  baseUrl,
  path,
  symbols,
  batchSize,
  staticParams,
  headers,
  pointsBySymbol,
}) {
  const batches = chunkSymbols(symbols, batchSize);
  for (const batch of batches) {
    const query = new URLSearchParams(staticParams);
    query.set('symbol', batch.join(','));
    const url = `${baseUrl}${path}?${query.toString()}`;
    const result = await fetchJson(url, headers, 9000);
    if (!result.ok || !result.payload) continue;
    collectRows(result.payload, batch, pointsBySymbol);
  }
}

async function fetchTapeFromOpenbb(baseUrl, symbols, batchSize) {
  const headers = getOpenbbHeaders();
  const coverageResult = await fetchOpenbbCoverage(baseUrl, headers);

  if (!coverageResult.ok) {
    return { ok: false, rows: [], reason: coverageResult.reason || 'Coverage unavailable', coverage: null };
  }

  const coverage = coverageResult.data;
  const coverageSummary = buildCoverageSummary(coverage.commands || []);

  const supportsEquity = coverageSummary.hasEquityPriceHistorical || coverageSummary.hasEquityPriceQuote;
  const supportsCrypto = coverageSummary.hasCryptoPriceHistorical;

  const equities = symbols.filter((symbol) => !isCryptoSymbol(symbol));
  const cryptos = symbols.filter((symbol) => isCryptoSymbol(symbol));

  const pointsBySymbol = new Map();

  const endDate = new Date();
  const startDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  if (supportsEquity && equities.length > 0 && coverageSummary.hasEquityPriceHistorical) {
    await fetchEndpointBatches({
      baseUrl,
      path: '/api/v1/equity/price/historical',
      symbols: equities,
      batchSize,
      staticParams: {
        provider: 'yfinance',
        interval: '1d',
        start_date: startDate.toISOString().slice(0, 10),
        end_date: endDate.toISOString().slice(0, 10),
      },
      headers,
      pointsBySymbol,
    });
  }

  if (supportsEquity && equities.length > 0 && coverageSummary.hasEquityPriceQuote) {
    await fetchEndpointBatches({
      baseUrl,
      path: '/api/v1/equity/price/quote',
      symbols: equities,
      batchSize,
      staticParams: {
        provider: 'yfinance',
      },
      headers,
      pointsBySymbol,
    });
  }

  if (supportsCrypto && cryptos.length > 0) {
    await fetchEndpointBatches({
      baseUrl,
      path: '/api/v1/crypto/price/historical',
      symbols: cryptos,
      batchSize,
      staticParams: {
        provider: 'yfinance',
        interval: '1d',
        start_date: startDate.toISOString().slice(0, 10),
        end_date: endDate.toISOString().slice(0, 10),
      },
      headers,
      pointsBySymbol,
    });
  }

  const rows = buildTapeRows(pointsBySymbol);
  if (rows.length === 0) {
    return {
      ok: false,
      rows: [],
      coverage,
      reason: 'No tape rows returned from OpenBB',
    };
  }

  return {
    ok: true,
    rows,
    coverage,
  };
}

async function probeOpenbbHealth(baseUrl, headers) {
  const coverage = await fetchOpenbbCoverage(baseUrl, headers);
  if (coverage.ok) {
    return {
      ok: true,
      coverage: coverage.data,
      reason: coverage.data.cached ? 'Coverage cache hit' : 'Coverage probe ok',
    };
  }

  const probe = await fetchJson(
    `${baseUrl}/api/v1/equity/price/quote?provider=yfinance&symbol=AAPL`,
    headers,
    7000,
  );

  if (probe.ok || (probe.status > 0 && probe.status < 500)) {
    return {
      ok: true,
      coverage: null,
      reason: 'Quote probe reachable',
    };
  }

  return {
    ok: false,
    coverage: null,
    reason: 'OpenBB health probe failed',
  };
}

async function waitForOpenbbReady(baseUrl, headers) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < OPENBB_BOOT_TIMEOUT_MS) {
    const health = await probeOpenbbHealth(baseUrl, headers);
    if (health.ok) {
      return {
        ok: true,
        coverage: health.coverage,
        reason: 'OpenBB became reachable',
      };
    }
    await sleep(OPENBB_BOOT_POLL_MS);
  }

  return {
    ok: false,
    coverage: null,
    reason: 'OpenBB auto-start timed out',
  };
}

async function ensureOpenbbReady(baseUrl, headers) {
  const initial = await probeOpenbbHealth(baseUrl, headers);
  if (initial.ok) {
    return {
      ok: true,
      coverage: initial.coverage,
      reason: initial.reason || 'OpenBB reachable',
      autoStarted: false,
    };
  }

  if (!isLocalBaseUrl(baseUrl) || !isNodeRuntime()) {
    return {
      ok: false,
      coverage: null,
      reason: initial.reason || 'OpenBB unreachable',
      autoStarted: false,
    };
  }

  const now = Date.now();
  if (openbbBootPromise) {
    return openbbBootPromise;
  }
  if (now - openbbLastBootAttemptAt < OPENBB_BOOT_COOLDOWN_MS) {
    // Do not fail fast during cooldown; keep probing in case OpenBB is still
    // finishing startup from a previous launch attempt.
    const waited = await waitForOpenbbReady(baseUrl, headers);
    return {
      ok: waited.ok,
      coverage: waited.coverage,
      reason: waited.reason || 'OpenBB startup probe during cooldown',
      autoStarted: false,
    };
  }

  openbbLastBootAttemptAt = now;
  openbbBootPromise = (async () => {
    const started = await startOpenbbLocalProcess(baseUrl);
    if (!started.ok) {
      return {
        ok: false,
        coverage: null,
        reason: started.reason || 'Failed to launch openbb-api',
        autoStarted: false,
      };
    }

    const waited = await waitForOpenbbReady(baseUrl, headers);
    if (!waited.ok) {
      return {
        ok: false,
        coverage: null,
        reason: waited.reason || 'OpenBB start failed',
        autoStarted: true,
      };
    }

    return {
      ok: true,
      coverage: waited.coverage,
      reason: `OpenBB auto-started via ${started.command || 'openbb-api'}`,
      autoStarted: true,
    };
  })();

  try {
    return await openbbBootPromise;
  } finally {
    openbbBootPromise = null;
  }
}

export default async function handler(request) {
  if (isDisallowedOrigin(request)) {
    return jsonResponse({ error: 'Origin not allowed' }, 403);
  }

  const corsHeaders = getCorsHeaders(request, 'GET, OPTIONS');
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'GET required' }, 405, corsHeaders);
  }

  const requestUrl = new URL(request.url);
  const action = (requestUrl.searchParams.get('action') || '').trim().toLowerCase();

  const baseUrl = getOpenbbBaseUrl();
  const headers = getOpenbbHeaders();

  if (!baseUrl) {
    return jsonResponse({
      ok: false,
      reason: 'OPENBB_API_URL not configured',
      rows: [],
    }, 200, corsHeaders);
  }

  if (action === 'health') {
    const health = await ensureOpenbbReady(baseUrl, headers);
    return jsonResponse({
      ok: health.ok,
      reason: health.reason,
      coverage: health.coverage ? toCoveragePayload(health.coverage) : null,
      source: 'openbb',
      autoStarted: Boolean(health.autoStarted),
      baseUrl,
    }, 200, corsHeaders);
  }

  if (action === 'coverage') {
    const ensured = await ensureOpenbbReady(baseUrl, headers);
    if (!ensured.ok) {
      return jsonResponse({
        ok: false,
        reason: ensured.reason || 'OpenBB coverage unavailable',
        source: 'openbb',
        autoStarted: Boolean(ensured.autoStarted),
        baseUrl,
      }, 200, corsHeaders);
    }

    const force = requestUrl.searchParams.get('force') === '1';
    const coverage = await fetchOpenbbCoverage(baseUrl, headers, { force });
    if (!coverage.ok || !coverage.data) {
      return jsonResponse({
        ok: false,
        reason: coverage.reason || 'OpenBB coverage unavailable',
      }, 200, corsHeaders);
    }

    return jsonResponse({
      ok: true,
      source: 'openbb',
      coverage: toCoveragePayload(coverage.data),
      autoStarted: Boolean(ensured.autoStarted),
      baseUrl,
    }, 200, corsHeaders);
  }

  if (action === 'tape') {
    const ensured = await ensureOpenbbReady(baseUrl, headers);
    if (!ensured.ok) {
      return jsonResponse({
        ok: false,
        rows: [],
        reason: ensured.reason || 'OpenBB request failed',
        coverage: ensured.coverage ? toCoveragePayload(ensured.coverage) : null,
        source: 'openbb',
        autoStarted: Boolean(ensured.autoStarted),
        baseUrl,
      }, 200, corsHeaders);
    }

    const symbols = normalizeSymbols(requestUrl.searchParams.get('symbols') || '');
    if (symbols.length === 0) {
      return jsonResponse({ ok: false, rows: [], reason: 'No symbols' }, 200, corsHeaders);
    }

    const batchSize = normalizeBatchSize(requestUrl.searchParams.get('batch_size') || String(DEFAULT_BATCH_SIZE));
    const result = await fetchTapeFromOpenbb(baseUrl, symbols, batchSize);

    if (!result.ok) {
      return jsonResponse({
        ok: false,
        rows: [],
        reason: result.reason || 'OpenBB request failed',
        coverage: result.coverage ? toCoveragePayload(result.coverage) : null,
        source: 'openbb',
        autoStarted: Boolean(ensured.autoStarted),
        baseUrl,
      }, 200, corsHeaders);
    }

    return jsonResponse({
      ok: true,
      rows: result.rows,
      source: 'openbb',
      coverage: result.coverage ? toCoveragePayload(result.coverage) : null,
      batchSize,
      autoStarted: Boolean(ensured.autoStarted),
      baseUrl,
    }, 200, corsHeaders);
  }

  return jsonResponse({
    error: 'Unsupported action',
    supported: ['health', 'coverage', 'tape'],
  }, 400, corsHeaders);
}
