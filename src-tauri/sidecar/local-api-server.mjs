#!/usr/bin/env node
import http, { createServer } from 'node:http';
import https from 'node:https';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { brotliCompress, gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const brotliCompressAsync = promisify(brotliCompress);

// Monkey-patch globalThis.fetch to force IPv4 for HTTPS requests.
// Node.js built-in fetch (undici) tries IPv6 first via Happy Eyeballs.
// Government APIs (EIA, NASA FIRMS, FRED) publish AAAA records but their
// IPv6 endpoints time out, causing ETIMEDOUT. This override ensures ALL
// fetch() calls in dynamically-loaded handler modules (api/*.js) use IPv4.
const _originalFetch = globalThis.fetch;

function normalizeRequestBody(body) {
  if (body == null) return null;
  if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array) return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  return body;
}

async function resolveRequestBody(input, init, method, isRequest) {
  if (method === 'GET' || method === 'HEAD') return null;

  if (init?.body != null) {
    return normalizeRequestBody(init.body);
  }

  if (isRequest && input?.body) {
    const clone = typeof input.clone === 'function' ? input.clone() : input;
    const buffer = await clone.arrayBuffer();
    return normalizeRequestBody(buffer);
  }

  return null;
}

function buildSafeResponse(statusCode, statusText, headers, bodyBuffer) {
  const status = Number.isInteger(statusCode) ? statusCode : 500;
  const body = (status === 204 || status === 205 || status === 304) ? null : bodyBuffer;
  return new Response(body, { status, statusText, headers });
}

function isTransientVerificationError(error) {
  if (!(error instanceof Error)) return false;
  const code = typeof error.code === 'string' ? error.code : '';
  if (code && ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) {
    return true;
  }
  if (error.name === 'AbortError') return true;
  return /timed out|timeout|network|fetch failed|failed to fetch|socket hang up/i.test(error.message);
}

globalThis.fetch = async function ipv4Fetch(input, init) {
  const isRequest = input && typeof input === 'object' && 'url' in input;
  let url;
  try { url = new URL(typeof input === 'string' ? input : input.url); } catch { return _originalFetch(input, init); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return _originalFetch(input, init);
  const mod = url.protocol === 'https:' ? https : http;
  const method = init?.method || (isRequest ? input.method : 'GET');
  const body = await resolveRequestBody(input, init, method, isRequest);
  const headers = {};
  const rawHeaders = init?.headers || (isRequest ? input.headers : null);
  if (rawHeaders) {
    const h = rawHeaders instanceof Headers ? Object.fromEntries(rawHeaders.entries())
      : Array.isArray(rawHeaders) ? Object.fromEntries(rawHeaders) : rawHeaders;
    Object.assign(headers, h);
  }
  return new Promise((resolve, reject) => {
    const req = mod.request({ hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname + url.search, method, headers, family: 4 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const responseHeaders = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v) responseHeaders.set(k, Array.isArray(v) ? v.join(', ') : v);
        }
        try {
          resolve(buildSafeResponse(res.statusCode, res.statusMessage, responseHeaders, buf));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    if (init?.signal) { init.signal.addEventListener('abort', () => req.destroy()); }
    if (body != null) req.write(body);
    req.end();
  });
};

const ALLOWED_ENV_KEYS = new Set([
  'GROQ_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'FRED_API_KEY', 'EIA_API_KEY',
  'CLOUDFLARE_API_TOKEN', 'ACLED_ACCESS_TOKEN', 'URLHAUS_AUTH_KEY',
  'OTX_API_KEY', 'ABUSEIPDB_API_KEY', 'WINGBITS_API_KEY', 'WS_RELAY_URL',
  'VITE_OPENSKY_RELAY_URL', 'OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET',
  'AISSTREAM_API_KEY', 'VITE_WS_RELAY_URL', 'FINNHUB_API_KEY', 'NASA_FIRMS_API_KEY',
  'OLLAMA_API_URL', 'OLLAMA_MODEL', 'WORLDMONITOR_API_KEY', 'WTO_API_KEY',
  'OPENBB_API_URL', 'OPENBB_API_KEY',
]);

const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CODEX_WORKDIR = path.join(os.tmpdir(), 'worldmonitor-codex-cli');
const CODEX_TIMEOUT_MS = 45_000;
const LOCAL_SOURCE_DISCOVERY_TIMEOUT_MS = 20_000;
const ENABLE_PLAYWRIGHT_DISCOVERY = String(process.env.LOCAL_SOURCE_DISCOVERY_PLAYWRIGHT ?? 'true').toLowerCase() !== 'false';
const ENABLE_CODEX_SOURCE_DISCOVERY = String(process.env.LOCAL_SOURCE_DISCOVERY_CODEX ?? 'true').toLowerCase() !== 'false';
const INTELLIGENCE_ARCHIVE_DB = 'intelligence-archive.duckdb';

let duckDbModulePromise = null;
let intelligenceArchivePromise = null;
let intelligenceArchiveVacuumTimer = null;

const SAFE_CODEX_ENV_KEYS = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'CODEX_HOME',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'LANG',
  'TERM',
];

let codexRunnerOverride = null;
let cachedCodexCommand = null;

export function __setCodexRunnerForTests(fn) {
  codexRunnerOverride = (typeof fn === 'function') ? fn : null;
}

function getSafeCodexEnv() {
  const env = {};
  for (const key of SAFE_CODEX_ENV_KEYS) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }
  return env;
}

function splitWindowsPath(pathValue) {
  if (!pathValue || typeof pathValue !== 'string') return [];
  return pathValue.split(';').map((item) => item.trim()).filter(Boolean);
}

function pushPathUnique(buffer, entry) {
  if (!entry || typeof entry !== 'string') return;
  const trimmed = entry.trim();
  if (!trimmed) return;
  const lower = trimmed.toLowerCase();
  if (buffer.some((item) => item.toLowerCase() === lower)) return;
  buffer.push(trimmed);
}

async function resolveCodexCommand() {
  if (cachedCodexCommand) return cachedCodexCommand;

  const fromEnv = (process.env.CODEX_BIN || '').trim();
  if (fromEnv && existsSync(fromEnv)) {
    cachedCodexCommand = fromEnv;
    return cachedCodexCommand;
  }

  const candidates = [];
  const userHome = process.env.USERPROFILE || os.homedir();
  const appData = process.env.APPDATA || path.join(userHome, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(userHome, 'AppData', 'Local');

  // Prefer native executable when available.
  pushPathUnique(candidates, path.join(localAppData, 'Programs', 'OpenAI', 'codex', 'codex.exe'));

  const vscodeExtRoot = path.join(userHome, '.vscode', 'extensions');
  if (existsSync(vscodeExtRoot)) {
    try {
      const entries = await readdir(vscodeExtRoot, { withFileTypes: true });
      const extensionBins = entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('openai.chatgpt-'))
        .map((entry) => path.join(vscodeExtRoot, entry.name, 'bin', 'windows-x86_64', 'codex.exe'))
        .filter((candidate) => existsSync(candidate))
        .sort()
        .reverse();
      for (const candidate of extensionBins) pushPathUnique(candidates, candidate);
    } catch {
      // Ignore VSCode extension scan failures.
    }
  }

  // Fallback to npm shim only when native executable is unavailable.
  pushPathUnique(candidates, path.join(appData, 'npm', 'codex.cmd'));
  pushPathUnique(candidates, path.join(appData, 'npm', 'codex'));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedCodexCommand = candidate;
      return cachedCodexCommand;
    }
  }

  cachedCodexCommand = 'codex';
  return cachedCodexCommand;
}

function withCodexPathHints(env, codexCommand) {
  if (process.platform !== 'win32') return env;

  const merged = [];
  for (const existing of splitWindowsPath(env.PATH || env.Path || process.env.PATH || process.env.Path || '')) {
    pushPathUnique(merged, existing);
  }

  const userHome = process.env.USERPROFILE || os.homedir();
  const appData = process.env.APPDATA || path.join(userHome, 'AppData', 'Roaming');
  pushPathUnique(merged, path.join(appData, 'npm'));
  if (codexCommand && codexCommand !== 'codex') {
    pushPathUnique(merged, path.dirname(codexCommand));
  }

  const mergedPath = merged.join(';');
  if (mergedPath) {
    env.PATH = mergedPath;
    env.Path = mergedPath;
  }
  return env;
}

function ensureCodexWorkdir() {
  if (!existsSync(CODEX_WORKDIR)) {
    mkdirSync(CODEX_WORKDIR, { recursive: true });
  }
}

async function runCodexCli(args, options = {}) {
  if (codexRunnerOverride) {
    return codexRunnerOverride(args, options);
  }

  ensureCodexWorkdir();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : CODEX_TIMEOUT_MS;
  const stdin = typeof options.stdin === 'string' ? options.stdin : '';
  const codexCommand = await resolveCodexCommand();
  const codexEnv = withCodexPathHints(getSafeCodexEnv(), codexCommand);
  const useShell = process.platform === 'win32' && codexCommand.toLowerCase().endsWith('.cmd');

  return new Promise((resolve, reject) => {
    let done = false;
    let timedOut = false;
    let stdout = '';
    let stderr = '';

    const child = spawn(codexCommand, args, {
      cwd: CODEX_WORKDIR,
      env: codexEnv,
      windowsHide: true,
      shell: useShell,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500).unref();
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      finish({ code: code ?? -1, stdout, stderr, timedOut });
    });

    if (stdin) {
      child.stdin?.write(stdin);
    }
    child.stdin?.end();
  });
}

function isCodexLoggedIn(outputText) {
  return /logged in/i.test(outputText);
}

function parseCodexJsonOutput(stdout) {
  let lastAgentMessage = '';
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed?.type === 'item.completed' && parsed?.item?.type === 'agent_message' && typeof parsed.item.text === 'string') {
      lastAgentMessage = parsed.item.text.trim();
    }
  }
  return lastAgentMessage;
}

function buildCodexPrompt({ headlines, mode = 'brief', geoContext = '', variant = 'full', lang = 'en' }) {
  if (mode === 'translate') {
    const target = (variant || lang || 'en').toString().trim();
    return [
      `Translate the following text to ${target}.`,
      'Rules:',
      '- Preserve journalistic tone.',
      '- Output only the translated text.',
      '',
      (headlines[0] || '').toString(),
    ].join('\n');
  }

  const deduped = [];
  const maxHeadlines = mode === 'deep' ? 1600 : mode === 'chat' ? 1200 : 120;
  for (const raw of headlines) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) continue;
    if (!deduped.includes(value)) deduped.push(value);
    if (deduped.length >= maxHeadlines) break;
  }

  const structuredLines = deduped.map((item) => `- ${item}`).join('\n');
  const langLine = lang && lang !== 'en' ? `Output language: ${String(lang).toUpperCase()}.` : 'Output language: EN.';
  const geoLine = geoContext ? `Context: ${geoContext.slice(0, 12000)}` : '';

  if (mode === 'chat') {
    return [
      'You are the World Monitor assistant.',
      'Handle both casual conversation and data analysis naturally.',
      'If the user asks a casual question, respond conversationally.',
      'If the user asks about events/markets/risks, analyze using the provided data lines only.',
      'When evidence is insufficient, state that explicitly.',
      'Do not output URL-only answers. Keep response readable and direct.',
      'Do not mention line numbers, prompt structure, or editorial process.',
      'Do not answer with meta-commentary about the input format.',
      langLine,
      geoLine,
      'Input lines:',
      structuredLines,
    ].filter(Boolean).join('\n');
  }

  if (mode === 'deep') {
    return [
      'You are a strict geopolitical intelligence editor.',
      'Use ALL relevant headlines. Do not merge factual details from separate stories into a single factual claim.',
      'You may synthesize patterns only when explicitly marked as inference.',
      'No filler, no preamble, no meta commentary.',
      'Do not reference line numbers or prompt structure.',
      'Do not invent citation IDs like [EVID:line-3]. Use only provided [EVID:<id>] tokens when available.',
      'Output plain text with EXACT sections:',
      'Executive Brief:',
      '- 3 bullets',
      'Critical Drivers:',
      '- 3 bullets',
      'Scenarios:',
      '- 24h: one line with probability %',
      '- 7d: one line with probability %',
      '- 30d: one line with probability %',
      'Watchlist:',
      '- up to 6 bullet items (entities, geographies, assets, indicators)',
      langLine,
      geoLine,
      'Headlines:',
      structuredLines,
    ].filter(Boolean).join('\n');
  }

  const modeLine = mode === 'analysis'
    ? 'Analyze the most important one headline in exactly 2 concise sentences (under 60 words).'
    : 'Summarize the most important one headline in exactly 2 concise sentences (under 60 words).';

  return [
    'You are a strict news editor.',
    modeLine,
    'Each numbered line is a separate story. Pick one only. Do not merge stories.',
    'No bullet points, no preamble, no meta commentary.',
    langLine,
    geoLine,
    'Headlines:',
    structuredLines,
  ].filter(Boolean).join('\n');
}

function buildCodexExecArgs(prompt, includeApprovalFlag = true) {
  const args = ['exec'];
  if (process.env.CODEX_MODEL && process.env.CODEX_MODEL.trim()) {
    args.push('--model', process.env.CODEX_MODEL.trim());
  }
  args.push('--json', '--skip-git-repo-check', '--sandbox', 'read-only');
  if (includeApprovalFlag) {
    args.push('--ask-for-approval', 'never');
  }
  args.push(prompt);
  return args;
}

function safeParseJsonObject(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    // Continue with fenced/raw object extraction below.
  }

  const fenced = text.match(/```(?:json)?\\s*([\\s\\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      const parsed = JSON.parse(fenced[1].trim());
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      // continue
    }
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function toNormalizedTopic(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\\s+/g, ' ')
    .slice(0, 180);
}

function dedupeTopics(values, limit = 12) {
  const output = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = toNormalizedTopic(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function normalizeDiscoveredSources(rawSources, fallbackName = 'Discovered') {
  const output = [];
  const seen = new Set();
  for (const source of Array.isArray(rawSources) ? rawSources : []) {
    if (!source || typeof source !== 'object') continue;
    const url = String(source.url || '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    output.push({
      name: String(source.name || fallbackName).slice(0, 120),
      url,
      confidence: Math.max(0, Math.min(100, Number(source.confidence) || 60)),
      reason: String(source.reason || 'codex-planner candidate').slice(0, 300),
      category: String(source.category || '').trim().toLowerCase() || undefined,
      topics: dedupeTopics(source.topics || []),
    });
    if (output.length >= 16) break;
  }
  return output;
}

function buildCodexDiscoveryPlannerPrompt({ origin = '', feedName = '', reason = '', topicHints = [] }) {
  const originLine = origin ? `Origin: ${origin}` : 'Origin: (none)';
  const feedLine = feedName ? `Feed: ${feedName}` : 'Feed: (none)';
  const reasonLine = reason ? `Reason: ${reason}` : 'Reason: (none)';
  const topicsLine = topicHints.length > 0 ? topicHints.join(' | ') : '(none)';
  return [
    'You are a source-discovery planner for RSS/Atom ingestion.',
    'Return strict JSON only. No markdown.',
    'Find candidate search queries and likely feed/source URLs.',
    'Focus on geopolitics, markets, technology, maritime, and security only.',
    'Reject entertainment, spam, and low-quality rumor domains.',
    'Schema:',
    '{',
    '  "searchQueries": string[],',
    '  "candidatePaths": string[],',
    '  "discoveredTopics": [{"topic": string, "rationale": string, "relevanceScore": number}],',
    '  "discoveredSources": [{"name": string, "url": string, "confidence": number, "reason": string, "category": string, "topics": string[]}]',
    '}',
    originLine,
    feedLine,
    reasonLine,
    `TopicHints: ${topicsLine}`,
  ].join('\\n');
}

function normalizeCandidateExpansionProposals(rawProposals) {
  const output = [];
  const seen = new Set();
  for (const proposal of Array.isArray(rawProposals) ? rawProposals : []) {
    if (!proposal || typeof proposal !== 'object') continue;
    const symbol = String(proposal.symbol || '').trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    const direction = ['long', 'short', 'hedge', 'watch', 'pair'].includes(String(proposal.direction || '').trim())
      ? String(proposal.direction).trim()
      : 'watch';
    const role = ['primary', 'confirm', 'hedge'].includes(String(proposal.role || '').trim())
      ? String(proposal.role).trim()
      : (direction === 'hedge' ? 'hedge' : 'confirm');
    const assetKind = ['etf', 'equity', 'commodity', 'fx', 'rate', 'crypto'].includes(String(proposal.assetKind || '').trim())
      ? String(proposal.assetKind).trim()
      : 'equity';
    output.push({
      symbol,
      assetName: String(proposal.assetName || symbol).slice(0, 140),
      assetKind,
      sector: String(proposal.sector || 'cross-asset').slice(0, 120),
      commodity: proposal.commodity == null ? null : String(proposal.commodity).slice(0, 80),
      direction,
      role,
      confidence: Math.max(0, Math.min(100, Number(proposal.confidence) || 60)),
      reason: String(proposal.reason || '').slice(0, 320),
      supportingSignals: Array.isArray(proposal.supportingSignals)
        ? proposal.supportingSignals.map((value) => String(value).slice(0, 140)).filter(Boolean).slice(0, 8)
        : [],
    });
    if (output.length >= 12) break;
  }
  return output;
}

function buildCodexCandidateExpansionPrompt(payload) {
  const topMappings = Array.isArray(payload?.topMappings) ? payload.topMappings : [];
  const watchlist = Array.isArray(payload?.watchlist) ? payload.watchlist : [];
  const existingSymbols = Array.isArray(payload?.existingSymbols) ? payload.existingSymbols.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean) : [];
  const themeId = String(payload?.themeId || '').trim();
  const themeLabel = String(payload?.themeLabel || '').trim();
  const thesis = String(payload?.thesis || '').trim();
  const timeframe = String(payload?.timeframe || '').trim();
  const sectors = Array.isArray(payload?.sectors) ? payload.sectors.map((value) => String(value || '').trim()).filter(Boolean) : [];
  const commodities = Array.isArray(payload?.commodities) ? payload.commodities.map((value) => String(value || '').trim()).filter(Boolean) : [];
  const triggers = Array.isArray(payload?.triggers) ? payload.triggers.map((value) => String(value || '').trim()).filter(Boolean) : [];
  const invalidation = Array.isArray(payload?.invalidation) ? payload.invalidation.map((value) => String(value || '').trim()).filter(Boolean) : [];
  const mappingLines = topMappings.slice(0, 8).map((item) => {
    const symbol = String(item?.symbol || '').trim();
    const name = String(item?.assetName || '').trim();
    const sector = String(item?.sector || '').trim();
    const direction = String(item?.direction || '').trim();
    const role = String(item?.role || '').trim();
    const conviction = Number(item?.conviction) || 0;
    return `- ${symbol} | ${name} | ${sector} | ${direction} | ${role} | conviction=${conviction}`;
  }).join('\n');
  const watchlistLines = watchlist.slice(0, 20).map((item) => {
    const symbol = String(item?.symbol || '').trim();
    const name = String(item?.name || '').trim();
    return `- ${symbol}${name ? ` | ${name}` : ''}`;
  }).join('\n');

  return [
    'You are a candidate-expansion analyst for a macro and geopolitical investment engine.',
    'Return strict JSON only. No markdown.',
    'Goal: propose additional liquid symbols or ETFs that should be reviewed for this theme.',
    'Do not repeat any symbol already in ExistingSymbols.',
    'Prefer liquid U.S.-listed ETFs and large liquid equities unless a more direct proxy is clearly better.',
    'Avoid illiquid microcaps, leveraged ETFs, options, or instruments without clear thematic linkage.',
    'Schema:',
    '{',
    '  "proposals": [',
    '    {',
    '      "symbol": "string",',
    '      "assetName": "string",',
    '      "assetKind": "etf|equity|commodity|fx|rate|crypto",',
    '      "sector": "string",',
    '      "commodity": "string|null",',
    '      "direction": "long|short|hedge|watch|pair",',
    '      "role": "primary|confirm|hedge",',
    '      "confidence": 0,',
    '      "reason": "string",',
    '      "supportingSignals": ["string"]',
    '    }',
    '  ]',
    '}',
    `ThemeId: ${themeId || '(none)'}`,
    `ThemeLabel: ${themeLabel || '(none)'}`,
    `Thesis: ${thesis || '(none)'}`,
    `Timeframe: ${timeframe || '(none)'}`,
    `Sectors: ${sectors.join(', ') || '(none)'}`,
    `Commodities: ${commodities.join(', ') || '(none)'}`,
    `Triggers: ${triggers.join(', ') || '(none)'}`,
    `Invalidation: ${invalidation.join(' | ') || '(none)'}`,
    `ExistingSymbols: ${existingSymbols.join(', ') || '(none)'}`,
    'TopMappings:',
    mappingLines || '(none)',
    'UserWatchlist:',
    watchlistLines || '(none)',
  ].join('\n');
}

async function runCodexDiscoveryPlanner({ origin = '', feedName = '', reason = '', topicHints = [], timeoutMs = LOCAL_SOURCE_DISCOVERY_TIMEOUT_MS }) {
  if (!ENABLE_CODEX_SOURCE_DISCOVERY) return null;
  try {
    const loginStatus = await runCodexCli(['login', 'status'], { timeoutMs: 8_000 });
    const loginOutput = `${loginStatus.stdout || ''}\\n${loginStatus.stderr || ''}`;
    if (loginStatus.code !== 0 || !isCodexLoggedIn(loginOutput)) return null;
  } catch {
    return null;
  }

  try {
    const prompt = buildCodexDiscoveryPlannerPrompt({ origin, feedName, reason, topicHints });
    const plannerTimeoutMs = Math.max(12_000, Math.min(Number(timeoutMs) || LOCAL_SOURCE_DISCOVERY_TIMEOUT_MS, 38_000));
    let args = buildCodexExecArgs(prompt, true);
    let result = await runCodexCli(args, { timeoutMs: plannerTimeoutMs });
    if (result.code !== 0) {
      const errText = `${result.stderr || ''}\\n${result.stdout || ''}`;
      if (/unexpected argument '--ask-for-approval'/i.test(errText)) {
        args = buildCodexExecArgs(prompt, false);
        result = await runCodexCli(args, { timeoutMs: plannerTimeoutMs });
      }
    }
    if (result.timedOut || result.code !== 0) return null;
    const message = parseCodexJsonOutput(result.stdout || '');
    const parsed = safeParseJsonObject(message);
    if (!parsed) return null;

    const searchQueries = dedupeTopics(parsed.searchQueries || []).slice(0, 8);
    const candidatePaths = (Array.isArray(parsed.candidatePaths) ? parsed.candidatePaths : [])
      .map((pathValue) => String(pathValue || '').trim())
      .filter(Boolean)
      .slice(0, 24);
    const discoveredTopics = (Array.isArray(parsed.discoveredTopics) ? parsed.discoveredTopics : [])
      .map((topic) => ({
        topic: toNormalizedTopic(topic?.topic || ''),
        rationale: String(topic?.rationale || '').slice(0, 260),
        relevanceScore: Math.max(0, Math.min(10, Number(topic?.relevanceScore) || 0)),
      }))
      .filter((topic) => topic.topic)
      .slice(0, 8);
    const discoveredSources = normalizeDiscoveredSources(parsed.discoveredSources || [], feedName || 'Discovered');

    return {
      usedCodex: true,
      searchQueries,
      candidatePaths,
      discoveredTopics,
      discoveredSources,
    };
  } catch {
    return null;
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

async function loadDuckDbModule() {
  if (!duckDbModulePromise) {
    duckDbModulePromise = import('@duckdb/node-api');
  }
  return duckDbModulePromise;
}

async function ensureIntelligenceArchive(context) {
  if (!intelligenceArchivePromise) {
    intelligenceArchivePromise = (async () => {
      mkdirSync(context.dataDir, { recursive: true });
      const dbPath = path.join(context.dataDir, INTELLIGENCE_ARCHIVE_DB);
      const duckdb = await loadDuckDbModule();
      const instance = await duckdb.DuckDBInstance.fromCache(dbPath);
      const connection = await instance.connect();
      await connection.run(`
        CREATE TABLE IF NOT EXISTS backtest_runs (
          id VARCHAR PRIMARY KEY,
          label VARCHAR,
          mode VARCHAR,
          started_at VARCHAR,
          completed_at VARCHAR,
          retain_learning_state BOOLEAN,
          frame_count INTEGER,
          checkpoint_count INTEGER,
          idea_run_count INTEGER,
          forward_return_count INTEGER,
          source_profile_count INTEGER,
          mapping_stat_count INTEGER,
          horizons_hours_json JSON,
          windows_json JSON,
          summary_json JSON,
          payload_json JSON
        )
      `);
      await connection.run(`
        CREATE TABLE IF NOT EXISTS idea_runs (
          id VARCHAR PRIMARY KEY,
          run_id VARCHAR,
          frame_id VARCHAR,
          generated_at VARCHAR,
          title VARCHAR,
          theme_id VARCHAR,
          region VARCHAR,
          direction VARCHAR,
          conviction DOUBLE,
          false_positive_risk DOUBLE,
          size_pct DOUBLE,
          payload_json JSON
        )
      `);
      await connection.run(`
        CREATE TABLE IF NOT EXISTS forward_returns (
          id VARCHAR PRIMARY KEY,
          run_id VARCHAR,
          idea_run_id VARCHAR,
          symbol VARCHAR,
          direction VARCHAR,
          horizon_hours INTEGER,
          entry_timestamp VARCHAR,
          exit_timestamp VARCHAR,
          entry_price DOUBLE,
          exit_price DOUBLE,
          raw_return_pct DOUBLE,
          signed_return_pct DOUBLE,
          payload_json JSON
        )
      `);
      for (const alterSql of [
        'ALTER TABLE backtest_runs ALTER COLUMN horizons_hours_json TYPE JSON',
        'ALTER TABLE backtest_runs ALTER COLUMN windows_json TYPE JSON',
        'ALTER TABLE backtest_runs ALTER COLUMN summary_json TYPE JSON',
        'ALTER TABLE backtest_runs ALTER COLUMN payload_json TYPE JSON',
        'ALTER TABLE idea_runs ALTER COLUMN payload_json TYPE JSON',
        'ALTER TABLE forward_returns ALTER COLUMN payload_json TYPE JSON',
      ]) {
        try {
          await connection.run(alterSql);
        } catch {
          // existing installations may already be migrated or contain values DuckDB cannot coerce inline
        }
      }
      if (!intelligenceArchiveVacuumTimer) {
        intelligenceArchiveVacuumTimer = setInterval(async () => {
          try {
            await connection.run('VACUUM');
          } catch {
            // Ignore maintenance failures.
          }
        }, 6 * 60 * 60 * 1000);
      }
      return { dbPath, connection };
    })().catch((error) => {
      intelligenceArchivePromise = null;
      throw error;
    });
  }
  return intelligenceArchivePromise;
}

function runArchiveSummary(run) {
  return {
    id: String(run?.id || ''),
    label: String(run?.label || ''),
    mode: run?.mode === 'walk-forward' ? 'walk-forward' : 'replay',
    startedAt: String(run?.startedAt || ''),
    completedAt: String(run?.completedAt || ''),
    frameCount: Number(run?.frameCount || 0),
    ideaRunCount: Array.isArray(run?.ideaRuns) ? run.ideaRuns.length : 0,
    forwardReturnCount: Array.isArray(run?.forwardReturns) ? run.forwardReturns.length : 0,
  };
}

async function archiveReplayRunToDuckDb(run, context) {
  const archive = await ensureIntelligenceArchive(context);
  const { connection } = archive;
  const summary = runArchiveSummary(run);

  await connection.run('BEGIN TRANSACTION');
  try {
    await connection.run(`
      INSERT INTO backtest_runs (
        id, label, mode, started_at, completed_at, retain_learning_state, frame_count,
        checkpoint_count, idea_run_count, forward_return_count, source_profile_count,
        mapping_stat_count, horizons_hours_json, windows_json, summary_json, payload_json
      ) VALUES (
        $id, $label, $mode, $startedAt, $completedAt, $retainLearningState, $frameCount,
        $checkpointCount, $ideaRunCount, $forwardReturnCount, $sourceProfileCount,
        $mappingStatCount, $horizons, $windows, $summary, $payload
      )
      ON CONFLICT(id) DO UPDATE SET
        label = EXCLUDED.label,
        mode = EXCLUDED.mode,
        started_at = EXCLUDED.started_at,
        completed_at = EXCLUDED.completed_at,
        retain_learning_state = EXCLUDED.retain_learning_state,
        frame_count = EXCLUDED.frame_count,
        checkpoint_count = EXCLUDED.checkpoint_count,
        idea_run_count = EXCLUDED.idea_run_count,
        forward_return_count = EXCLUDED.forward_return_count,
        source_profile_count = EXCLUDED.source_profile_count,
        mapping_stat_count = EXCLUDED.mapping_stat_count,
        horizons_hours_json = EXCLUDED.horizons_hours_json,
        windows_json = EXCLUDED.windows_json,
        summary_json = EXCLUDED.summary_json,
        payload_json = EXCLUDED.payload_json
    `, {
      id: summary.id,
      label: summary.label,
      mode: summary.mode,
      startedAt: summary.startedAt,
      completedAt: summary.completedAt,
      retainLearningState: Boolean(run?.retainLearningState),
      frameCount: summary.frameCount,
      checkpointCount: Array.isArray(run?.checkpoints) ? run.checkpoints.length : 0,
      ideaRunCount: summary.ideaRunCount,
      forwardReturnCount: summary.forwardReturnCount,
      sourceProfileCount: Array.isArray(run?.sourceProfiles) ? run.sourceProfiles.length : 0,
      mappingStatCount: Array.isArray(run?.mappingStats) ? run.mappingStats.length : 0,
      horizons: JSON.stringify(Array.isArray(run?.horizonsHours) ? run.horizonsHours : []),
      windows: JSON.stringify(Array.isArray(run?.windows) ? run.windows : []),
      summary: JSON.stringify(Array.isArray(run?.summaryLines) ? run.summaryLines : []),
      payload: JSON.stringify(run ?? {}),
    });

    for (const idea of (Array.isArray(run?.ideaRuns) ? run.ideaRuns : [])) {
      await connection.run(`
        INSERT INTO idea_runs (
          id, run_id, frame_id, generated_at, title, theme_id, region, direction,
          conviction, false_positive_risk, size_pct, payload_json
        ) VALUES (
          $id, $runId, $frameId, $generatedAt, $title, $themeId, $region, $direction,
          $conviction, $falsePositiveRisk, $sizePct, $payload
        )
        ON CONFLICT(id) DO UPDATE SET
          run_id = EXCLUDED.run_id,
          frame_id = EXCLUDED.frame_id,
          generated_at = EXCLUDED.generated_at,
          title = EXCLUDED.title,
          theme_id = EXCLUDED.theme_id,
          region = EXCLUDED.region,
          direction = EXCLUDED.direction,
          conviction = EXCLUDED.conviction,
          false_positive_risk = EXCLUDED.false_positive_risk,
          size_pct = EXCLUDED.size_pct,
          payload_json = EXCLUDED.payload_json
      `, {
        id: String(idea?.id || ''),
        runId: summary.id,
        frameId: String(idea?.frameId || ''),
        generatedAt: String(idea?.generatedAt || ''),
        title: String(idea?.title || ''),
        themeId: String(idea?.themeId || ''),
        region: String(idea?.region || ''),
        direction: String(idea?.direction || ''),
        conviction: Number(idea?.conviction || 0),
        falsePositiveRisk: Number(idea?.falsePositiveRisk || 0),
        sizePct: Number(idea?.sizePct || 0),
        payload: JSON.stringify(idea ?? {}),
      });
    }

    for (const row of (Array.isArray(run?.forwardReturns) ? run.forwardReturns : [])) {
      await connection.run(`
        INSERT INTO forward_returns (
          id, run_id, idea_run_id, symbol, direction, horizon_hours, entry_timestamp,
          exit_timestamp, entry_price, exit_price, raw_return_pct, signed_return_pct, payload_json
        ) VALUES (
          $id, $runId, $ideaRunId, $symbol, $direction, $horizonHours, $entryTimestamp,
          $exitTimestamp, $entryPrice, $exitPrice, $rawReturnPct, $signedReturnPct, $payload
        )
        ON CONFLICT(id) DO UPDATE SET
          run_id = EXCLUDED.run_id,
          idea_run_id = EXCLUDED.idea_run_id,
          symbol = EXCLUDED.symbol,
          direction = EXCLUDED.direction,
          horizon_hours = EXCLUDED.horizon_hours,
          entry_timestamp = EXCLUDED.entry_timestamp,
          exit_timestamp = EXCLUDED.exit_timestamp,
          entry_price = EXCLUDED.entry_price,
          exit_price = EXCLUDED.exit_price,
          raw_return_pct = EXCLUDED.raw_return_pct,
          signed_return_pct = EXCLUDED.signed_return_pct,
          payload_json = EXCLUDED.payload_json
      `, {
        id: String(row?.id || ''),
        runId: summary.id,
        ideaRunId: String(row?.ideaRunId || ''),
        symbol: String(row?.symbol || ''),
        direction: String(row?.direction || ''),
        horizonHours: Number(row?.horizonHours || 0),
        entryTimestamp: String(row?.entryTimestamp || ''),
        exitTimestamp: row?.exitTimestamp == null ? null : String(row.exitTimestamp),
        entryPrice: row?.entryPrice == null ? null : Number(row.entryPrice),
        exitPrice: row?.exitPrice == null ? null : Number(row.exitPrice),
        rawReturnPct: row?.rawReturnPct == null ? null : Number(row.rawReturnPct),
        signedReturnPct: row?.signedReturnPct == null ? null : Number(row.signedReturnPct),
        payload: JSON.stringify(row ?? {}),
      });
    }

    await connection.run('COMMIT');
    return {
      ok: true,
      dbPath: archive.dbPath,
      summary,
    };
  } catch (error) {
    try {
      await connection.run('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw error;
  }
}

async function listReplayRunsFromDuckDb(limit, context) {
  const archive = await ensureIntelligenceArchive(context);
  const safeLimit = Math.max(1, Math.min(200, Math.round(Number(limit) || 20)));
  const reader = await archive.connection.runAndReadAll(`
    SELECT id, label, mode, started_at AS startedAt, completed_at AS completedAt,
           frame_count AS frameCount, idea_run_count AS ideaRunCount, forward_return_count AS forwardReturnCount
    FROM backtest_runs
    ORDER BY completed_at DESC
    LIMIT ${safeLimit}
  `);
  return reader.getRowObjectsJS();
}

async function getReplayRunFromDuckDb(runId, context) {
  const archive = await ensureIntelligenceArchive(context);
  const reader = await archive.connection.runAndReadAll(`
    SELECT payload_json AS payload
    FROM backtest_runs
    WHERE id = $runId
    LIMIT 1
  `, { runId: String(runId || '') });
  const row = reader.getRowObjectsJS()[0];
  if (!row?.payload) return null;
  try {
    return JSON.parse(String(row.payload));
  } catch {
    return null;
  }
}

async function runIntelligenceJob(action, payload, context, timeoutMs = 120_000) {
  const cwd = context.resourceDir || process.cwd();
  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', path.join('scripts', 'intelligence-job.mjs'), action],
      {
        cwd,
        env: {
          ...process.env,
          LOCAL_API_RESOURCE_DIR: context.resourceDir,
          LOCAL_API_DATA_DIR: context.dataDir,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, Math.max(5_000, Math.min(timeoutMs, 30 * 60 * 1000)));

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString('utf8').trim();
      const err = Buffer.concat(stderr).toString('utf8').trim();
      if (timedOut) {
        reject(new Error(`intelligence job timed out: ${action}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(err || out || `intelligence job failed: ${action}`));
        return;
      }
      try {
        resolve(out ? JSON.parse(out) : { ok: true });
      } catch (error) {
        reject(new Error(`invalid intelligence job output: ${String(error?.message || error)}`));
      }
    });

    child.stdin.write(JSON.stringify(payload || {}));
    child.stdin.end();
  });
}

function canCompress(headers, body) {
  return body.length > 1024 && !headers['content-encoding'];
}

function appendVary(existing, token) {
  const value = typeof existing === 'string' ? existing : '';
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.some((p) => p.toLowerCase() === token.toLowerCase())) {
    parts.push(token);
  }
  return parts.join(', ');
}

async function maybeCompressResponseBody(body, headers, acceptEncoding = '') {
  if (!canCompress(headers, body)) return body;
  headers['vary'] = appendVary(headers['vary'], 'Accept-Encoding');

  if (acceptEncoding.includes('br')) {
    headers['content-encoding'] = 'br';
    return brotliCompressAsync(body);
  }

  if (acceptEncoding.includes('gzip')) {
    headers['content-encoding'] = 'gzip';
    return gzipSync(body);
  }

  return body;
}

function isBracketSegment(segment) {
  return segment.startsWith('[') && segment.endsWith(']');
}

function splitRoutePath(routePath) {
  return routePath.split('/').filter(Boolean);
}

function routePriority(routePath) {
  const parts = splitRoutePath(routePath);
  return parts.reduce((score, part) => {
    if (part.startsWith('[[...') && part.endsWith(']]')) return score + 0;
    if (part.startsWith('[...') && part.endsWith(']')) return score + 1;
    if (isBracketSegment(part)) return score + 2;
    return score + 10;
  }, 0);
}

function matchRoute(routePath, pathname) {
  const routeParts = splitRoutePath(routePath);
  const pathParts = splitRoutePath(pathname.replace(/^\/api/, ''));

  let i = 0;
  let j = 0;

  while (i < routeParts.length && j < pathParts.length) {
    const routePart = routeParts[i];
    const pathPart = pathParts[j];

    if (routePart.startsWith('[[...') && routePart.endsWith(']]')) {
      return true;
    }

    if (routePart.startsWith('[...') && routePart.endsWith(']')) {
      return true;
    }

    if (isBracketSegment(routePart)) {
      i += 1;
      j += 1;
      continue;
    }

    if (routePart !== pathPart) {
      return false;
    }

    i += 1;
    j += 1;
  }

  if (i === routeParts.length && j === pathParts.length) return true;

  if (i === routeParts.length - 1) {
    const tail = routeParts[i];
    if (tail?.startsWith('[[...') && tail.endsWith(']]')) {
      return true;
    }
    if (tail?.startsWith('[...') && tail.endsWith(']')) {
      return j < pathParts.length;
    }
  }

  return false;
}

async function buildRouteTable(root) {
  if (!existsSync(root)) return [];

  const files = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      if (entry.name.startsWith('_')) continue;

      const relative = path.relative(root, absolute).replace(/\\/g, '/');
      const routePath = relative.replace(/\.js$/, '').replace(/\/index$/, '');
      files.push({ routePath, modulePath: absolute });
    }
  }

  await walk(root);

  files.sort((a, b) => routePriority(b.routePath) - routePriority(a.routePath));
  return files;
}

const REQUEST_BODY_CACHE = Symbol('requestBodyCache');

async function readBody(req) {
  if (Object.prototype.hasOwnProperty.call(req, REQUEST_BODY_CACHE)) {
    return req[REQUEST_BODY_CACHE];
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  req[REQUEST_BODY_CACHE] = body;
  return body;
}

function toHeaders(nodeHeaders, options = {}) {
  const stripOrigin = options.stripOrigin === true;
  const headers = new Headers();
  Object.entries(nodeHeaders).forEach(([key, value]) => {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'host') return;
    if (stripOrigin && (lowerKey === 'origin' || lowerKey === 'referer' || lowerKey.startsWith('sec-fetch-'))) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(v => headers.append(key, v));
    } else if (typeof value === 'string') {
      headers.set(key, value);
    }
  });
  return headers;
}

async function proxyToCloud(requestUrl, req, remoteBase) {
  const target = `${remoteBase}${requestUrl.pathname}${requestUrl.search}`;
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
  return fetch(target, {
    method: req.method,
    // Strip browser-origin headers for server-to-server parity.
    headers: toHeaders(req.headers, { stripOrigin: true }),
    body,
  });
}

function pickModule(pathname, routes) {
  const apiPath = pathname.startsWith('/api') ? pathname.slice(4) || '/' : pathname;

  for (const candidate of routes) {
    if (matchRoute(candidate.routePath, apiPath)) {
      return candidate.modulePath;
    }
  }

  return null;
}

const moduleCache = new Map();
const failedImports = new Set();
const fallbackCounts = new Map();
const cloudPreferred = new Set();

const TRAFFIC_LOG_MAX = 200;
const trafficLog = [];
let verboseMode = false;
let _verboseStatePath = null;

function loadVerboseState(dataDir) {
  _verboseStatePath = path.join(dataDir, 'verbose-mode.json');
  try {
    const data = JSON.parse(readFileSync(_verboseStatePath, 'utf-8'));
    verboseMode = !!data.verboseMode;
  } catch { /* file missing or invalid — keep default false */ }
}

function saveVerboseState() {
  if (!_verboseStatePath) return;
  try { writeFileSync(_verboseStatePath, JSON.stringify({ verboseMode })); } catch { /* ignore */ }
}

function recordTraffic(entry) {
  trafficLog.push(entry);
  if (trafficLog.length > TRAFFIC_LOG_MAX) trafficLog.shift();
  if (verboseMode) {
    const ts = entry.timestamp.split('T')[1].replace('Z', '');
    console.log(`[traffic] ${ts} ${entry.method} ${entry.path} → ${entry.status} ${entry.durationMs}ms`);
  }
}

function logOnce(logger, route, message) {
  const key = `${route}:${message}`;
  const count = (fallbackCounts.get(key) || 0) + 1;
  fallbackCounts.set(key, count);
  if (count === 1) {
    logger.warn(`[local-api] ${route} → ${message}`);
  } else if (count === 5 || count % 100 === 0) {
    logger.warn(`[local-api] ${route} → ${message} (x${count})`);
  }
}

async function importHandler(modulePath) {
  if (failedImports.has(modulePath)) {
    throw new Error(`cached-failure:${path.basename(modulePath)}`);
  }

  const cached = moduleCache.get(modulePath);
  if (cached) return cached;

  try {
    const mod = await import(pathToFileURL(modulePath).href);
    moduleCache.set(modulePath, mod);
    return mod;
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      failedImports.add(modulePath);
    }
    throw error;
  }
}

function resolveConfig(options = {}) {
  const port = Number(options.port ?? process.env.LOCAL_API_PORT ?? 46123);
  const remoteBase = String(options.remoteBase ?? process.env.LOCAL_API_REMOTE_BASE ?? 'https://worldmonitor.app').replace(/\/$/, '');
  const resourceDir = String(options.resourceDir ?? process.env.LOCAL_API_RESOURCE_DIR ?? process.cwd());
  const apiDir = options.apiDir
    ? String(options.apiDir)
    : [
      path.join(resourceDir, 'api'),
      path.join(resourceDir, '_up_', 'api'),
    ].find((candidate) => existsSync(candidate)) ?? path.join(resourceDir, 'api');
  const dataDir = String(options.dataDir ?? process.env.LOCAL_API_DATA_DIR ?? resourceDir);
  const mode = String(options.mode ?? process.env.LOCAL_API_MODE ?? 'desktop-sidecar');
  const cloudFallback = String(options.cloudFallback ?? process.env.LOCAL_API_CLOUD_FALLBACK ?? '') === 'true';
  const logger = options.logger ?? console;

  return {
    port,
    remoteBase,
    resourceDir,
    dataDir,
    apiDir,
    mode,
    cloudFallback,
    logger,
  };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return pathToFileURL(process.argv[1]).href === import.meta.url;
}

async function handleLocalServiceStatus(context) {
  return json({
    success: true,
    timestamp: new Date().toISOString(),
    summary: { operational: 2, degraded: 0, outage: 0, unknown: 0 },
    services: [
      { id: 'local-api', name: 'Local Desktop API', category: 'dev', status: 'operational', description: `Running on 127.0.0.1:${context.port}` },
      { id: 'cloud-pass-through', name: 'Cloud pass-through', category: 'cloud', status: 'operational', description: `Fallback target ${context.remoteBase}` },
    ],
    local: { enabled: true, mode: context.mode, port: context.port, remoteBase: context.remoteBase },
  });
}

async function tryCloudFallback(requestUrl, req, context, reason) {
  if (reason) {
    const route = requestUrl.pathname;
    const count = (fallbackCounts.get(route) || 0) + 1;
    fallbackCounts.set(route, count);
    if (count === 1) {
      const brief = reason instanceof Error
        ? (reason.code === 'ERR_MODULE_NOT_FOUND' ? 'missing npm dependency' : reason.message)
        : reason;
      context.logger.warn(`[local-api] ${route} → cloud (${brief})`);
    } else if (count === 5 || count % 100 === 0) {
      context.logger.warn(`[local-api] ${route} → cloud x${count}`);
    }
  }
  try {
    return await proxyToCloud(requestUrl, req, context.remoteBase);
  } catch (error) {
    context.logger.error('[local-api] cloud fallback failed', requestUrl.pathname, error);
    return null;
  }
}

const SIDECAR_ALLOWED_ORIGINS = [
  /^tauri:\/\/localhost$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/tauri\.localhost(:\d+)?$/,
  /^https:\/\/(.*\.)?worldmonitor\.app$/,
];

function getSidecarCorsOrigin(req) {
  const origin = req.headers?.origin || req.headers?.get?.('origin') || '';
  if (origin && SIDECAR_ALLOWED_ORIGINS.some(p => p.test(origin))) return origin;
  return 'tauri://localhost';
}

function makeCorsHeaders(req) {
  return {
    'Access-Control-Allow-Origin': getSidecarCorsOrigin(req),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  // Use node:https with IPv4 forced — Node.js built-in fetch (undici) tries IPv6
  // first and some servers (EIA, NASA FIRMS) have broken IPv6 causing ETIMEDOUT.
  const u = new URL(url);
  if (u.protocol === 'https:') {
    return new Promise((resolve, reject) => {
      const reqOpts = {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        family: 4,
      };
      const req = https.request(reqOpts, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: { get: (k) => res.headers[k.toLowerCase()] || null },
            text: () => Promise.resolve(body),
            json: () => Promise.resolve(JSON.parse(body)),
          });
        });
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => { req.destroy(new Error('Request timed out')); });
      if (options.body) {
        const body = normalizeRequestBody(options.body);
        if (body != null) req.write(body);
      }
      req.end();
    });
  }
  // HTTP fallback (localhost sidecar, etc.)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractUpstreamFeedUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';

  const pickFromProxy = (input) => {
    try {
      const parsed = new URL(input, 'http://127.0.0.1');
      if (!parsed.pathname.endsWith('/api/rss-proxy')) return '';
      const encoded = parsed.searchParams.get('url');
      return encoded ? String(encoded).trim() : '';
    } catch {
      return '';
    }
  };

  const proxied = pickFromProxy(value);
  if (proxied) return proxied;
  if (/^https?:\/\//i.test(value)) return value;
  return '';
}

function normalizeCandidateUrl(rawValue, baseUrl) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  try {
    const resolved = new URL(value, baseUrl);
    if (!/^https?:$/.test(resolved.protocol)) return '';
    return resolved.toString();
  } catch {
    return '';
  }
}

function scoreFeedCandidate(rawValue) {
  const value = String(rawValue || '').toLowerCase();
  let score = 0;
  if (value.includes('/rss')) score += 30;
  if (value.includes('/feed')) score += 28;
  if (value.includes('atom')) score += 22;
  if (value.endsWith('.xml') || value.includes('.xml?')) score += 15;
  if (value.includes('news')) score += 8;
  if (value.includes('blog')) score += 4;
  return score;
}

function collectFeedCandidatesFromHtml(html, baseUrl) {
  const candidates = new Set();
  const add = (candidate) => {
    const normalized = normalizeCandidateUrl(candidate, baseUrl);
    if (normalized) candidates.add(normalized);
  };

  const defaults = [
    '/feed',
    '/rss',
    '/feed.xml',
    '/rss.xml',
    '/atom.xml',
    '/index.xml',
    '/news/feed',
    '/news/rss',
  ];
  for (const fallback of defaults) add(fallback);

  const source = String(html || '');
  if (!source) return Array.from(candidates);

  const linkRegex = /<(?:a|link)\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match = null;
  let scanned = 0;
  while ((match = linkRegex.exec(source)) && scanned < 600) {
    scanned += 1;
    const href = String(match[1] || '').trim();
    if (!href) continue;
    const tag = String(match[0] || '').toLowerCase();
    const hint = `${href.toLowerCase()} ${tag}`;
    if (/(rss|feed|atom|xml)/.test(hint)) {
      add(href);
    }
  }

  return Array.from(candidates);
}

async function validateFeedCandidate(url) {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': CHROME_UA,
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
      },
    }, 12_000);
    if (!response.ok) return false;
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    const body = String(await response.text() || '');
    if (!body) return false;
    const hasFeedRoot = /<(rss|feed)\b/i.test(body);
    const hasItems = /<(item|entry)\b/i.test(body);
    const isXmlType = /xml|rss|atom/.test(contentType);
    return hasFeedRoot && hasItems && (isXmlType || body.startsWith('<?xml') || body.startsWith('<rss') || body.startsWith('<feed'));
  } catch {
    return false;
  }
}

function candidateToDiscoveredSource(feedName, url) {
  try {
    const parsed = new URL(url);
    return {
      name: `${feedName || 'Discovered'} (${parsed.hostname})`,
      url,
      confidence: Math.max(35, Math.min(95, scoreFeedCandidate(url))),
      reason: 'playwright/source-discovery candidate',
    };
  } catch {
    return {
      name: feedName || 'Discovered',
      url,
      confidence: 40,
      reason: 'playwright/source-discovery candidate',
    };
  }
}

async function discoverCandidatesWithPlaywright(baseUrl, timeoutMs) {
  if (!ENABLE_PLAYWRIGHT_DISCOVERY) return [];
  let browser = null;
  try {
    const playwright = await import('playwright');
    if (!playwright?.chromium) return [];

    browser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const context = await browser.newContext({ userAgent: CHROME_UA });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: Math.max(6_000, Math.min(timeoutMs, 16_000)) });
    const hrefs = await page.$$eval('a[href],link[href]', (nodes) => {
      const values = [];
      for (const node of nodes) {
        const href = node.getAttribute('href');
        if (href) values.push(href);
      }
      return values.slice(0, 700);
    });
    await context.close();
    return hrefs.map(href => normalizeCandidateUrl(href, baseUrl)).filter(Boolean);
  } catch {
    return [];
  } finally {
    try {
      if (browser) await browser.close();
    } catch {
      // Ignore browser close failures.
    }
  }
}

async function discoverSearchResultLinksWithPlaywright(query, timeoutMs) {
  if (!ENABLE_PLAYWRIGHT_DISCOVERY) return [];
  const q = String(query || '').trim();
  if (!q) return [];

  let browser = null;
  try {
    const playwright = await import('playwright');
    if (!playwright?.chromium) return [];

    browser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const context = await browser.newContext({ userAgent: CHROME_UA });
    const page = await context.newPage();
    const targetUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: Math.max(8_000, Math.min(timeoutMs, 18_000)) });
    const links = await page.$$eval('a[href]', (nodes) => {
      const out = [];
      for (const node of nodes) {
        const href = node.getAttribute('href') || '';
        if (!href) continue;
        if (href.startsWith('http://') || href.startsWith('https://')) {
          out.push(href);
        }
      }
      return out.slice(0, 120);
    });
    await context.close();
    return Array.from(new Set(links));
  } catch {
    return [];
  } finally {
    try {
      if (browser) await browser.close();
    } catch {
      // ignore
    }
  }
}

function mergeDiscoveredSourceLists(...lists) {
  const merged = [];
  const seen = new Set();
  for (const list of lists) {
    for (const source of Array.isArray(list) ? list : []) {
      if (!source || typeof source !== 'object') continue;
      const url = String(source.url || '').trim();
      if (!/^https?:\/\//i.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      merged.push({
        name: String(source.name || 'Discovered').slice(0, 120),
        url,
        confidence: Math.max(0, Math.min(100, Number(source.confidence) || 55)),
        reason: String(source.reason || 'discovered source candidate').slice(0, 300),
        category: String(source.category || '').trim().toLowerCase() || undefined,
        topics: dedupeTopics(source.topics || []),
      });
      if (merged.length >= 32) return merged;
    }
  }
  return merged;
}

function isDiscoveryNoiseDomain(urlValue) {
  let host = '';
  try {
    host = new URL(urlValue).hostname.toLowerCase();
  } catch {
    return true;
  }
  return [
    'facebook.com',
    'instagram.com',
    'youtube.com',
    'tiktok.com',
    'linkedin.com',
    'pinterest.com',
  ].some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function hostLabel(urlValue) {
  try {
    return new URL(urlValue).hostname;
  } catch {
    return 'unknown';
  }
}

async function discoverSourceCandidatesComposite({
  origin,
  upstream,
  feedName,
  reason,
  topicHints,
  timeoutMs,
}) {
  const candidateScore = new Map();
  const discoveredSourceCandidates = [];
  const networkCaptures = [];

  const addCandidate = (candidate, boost = 0) => {
    const normalized = normalizeCandidateUrl(candidate, origin);
    if (!normalized) return;
    const nextScore = scoreFeedCandidate(normalized) + boost;
    const prevScore = candidateScore.get(normalized) ?? -1;
    if (nextScore > prevScore) candidateScore.set(normalized, nextScore);
  };

  addCandidate(upstream, 12);

  let homepageHtml = '';
  try {
    const homepage = await fetchWithTimeout(origin, {
      headers: {
        'User-Agent': CHROME_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }, Math.max(6_000, Math.min(timeoutMs, 15_000)));
    homepageHtml = await homepage.text();
  } catch {
    homepageHtml = '';
  }

  for (const candidate of collectFeedCandidatesFromHtml(homepageHtml, origin)) {
    addCandidate(candidate, 10);
  }

  const playwrightCandidates = await discoverCandidatesWithPlaywright(origin, timeoutMs);
  for (const candidate of playwrightCandidates) {
    addCandidate(candidate, /(rss|feed|atom|xml)/i.test(candidate) ? 16 : 4);
  }
  for (const capture of await captureNetworkStructuredResponses(origin, timeoutMs)) {
    networkCaptures.push(capture);
    if (capture.schemaHint === 'json' || /\/api\/|graphql/i.test(capture.requestUrl)) {
      addCandidate(capture.requestUrl, 12);
    }
  }

  const planner = await runCodexDiscoveryPlanner({
    origin,
    feedName,
    reason,
    topicHints,
    timeoutMs,
  });
  const plannerTopics = dedupeTopics([
    ...(topicHints || []),
    ...(planner?.discoveredTopics || []).map((item) => item.topic),
  ]);
  for (const candidatePath of planner?.candidatePaths || []) {
    addCandidate(candidatePath, 18);
  }

  const searchQueries = dedupeTopics([
    ...(planner?.searchQueries || []),
    ...(topicHints || []),
    `${feedName} rss feed`,
  ]).slice(0, 5);

  for (const query of searchQueries) {
    const links = await discoverSearchResultLinksWithPlaywright(query, timeoutMs);
    for (const link of links.slice(0, 10)) {
      if (isDiscoveryNoiseDomain(link)) continue;
      if (/(rss|feed|atom|xml)/i.test(link)) addCandidate(link, 14);
      discoveredSourceCandidates.push({
        name: `${feedName || 'Discovered'} (${hostLabel(link)})`,
        url: link,
        confidence: 52,
        reason: `search candidate: ${query}`,
        topics: plannerTopics,
      });
      try {
        const page = await fetchWithTimeout(link, {
          headers: {
            'User-Agent': CHROME_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        }, Math.max(5_000, Math.min(timeoutMs, 12_000)));
        if (!page.ok) continue;
        const html = await page.text();
        for (const candidate of collectFeedCandidatesFromHtml(html, link)) {
          addCandidate(candidate, 12);
        }
      } catch {
        // ignore per-link failures
      }
    }
  }

  const rankedCandidates = Array.from(candidateScore.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url)
    .slice(0, 40);

  let discoveredFeedUrl = '';
  for (const candidate of rankedCandidates.slice(0, 14)) {
    if (await validateFeedCandidate(candidate)) {
      discoveredFeedUrl = candidate;
      break;
    }
  }

  const rankedSourceCandidates = rankedCandidates
    .filter((candidate) => candidate !== discoveredFeedUrl)
    .slice(0, 12)
    .map((candidate) => candidateToDiscoveredSource(feedName, candidate))
    .map((candidate) => ({ ...candidate, topics: plannerTopics }));

  const discoveredSources = mergeDiscoveredSourceLists(
    planner?.discoveredSources || [],
    rankedSourceCandidates,
    discoveredSourceCandidates,
  );

  return {
    success: Boolean(discoveredFeedUrl || discoveredSources.length > 0),
    discoveredFeedUrl: discoveredFeedUrl || undefined,
    discoveredSources,
    networkCaptures,
    discoveredTopics: planner?.discoveredTopics || [],
    usedCodex: Boolean(planner?.usedCodex),
    reason: discoveredFeedUrl
      ? 'validated replacement RSS discovered via codex+playwright'
      : 'no validated RSS found, returning codex+playwright source candidates',
  };
}

async function runAutonomousSourceHunt({ topics = [], timeoutMs = LOCAL_SOURCE_DISCOVERY_TIMEOUT_MS }) {
  const normalizedTopics = dedupeTopics(topics).slice(0, 8);
  const planner = await runCodexDiscoveryPlanner({
    origin: '',
    feedName: 'Autonomous Discovery',
    reason: 'autonomous source hunt',
    topicHints: normalizedTopics,
    timeoutMs,
  });

  const queryPool = dedupeTopics([
    ...(planner?.searchQueries || []),
    ...normalizedTopics,
  ]).slice(0, 8);

  const candidateScore = new Map();
  const addCandidate = (candidate, boost = 0) => {
    const url = String(candidate || '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    const score = scoreFeedCandidate(url) + boost;
    const prev = candidateScore.get(url) ?? -1;
    if (score > prev) candidateScore.set(url, score);
  };

  for (const candidatePath of planner?.candidatePaths || []) {
    if (/^https?:\/\//i.test(candidatePath)) addCandidate(candidatePath, 18);
  }

  const harvestedSources = [];
  for (const query of queryPool) {
    const links = await discoverSearchResultLinksWithPlaywright(query, timeoutMs);
    for (const link of links.slice(0, 12)) {
      if (isDiscoveryNoiseDomain(link)) continue;
      if (/(rss|feed|atom|xml)/i.test(link)) addCandidate(link, 14);
      harvestedSources.push({
        name: `Autonomous (${hostLabel(link)})`,
        url: link,
        confidence: 50,
        reason: `autonomous search: ${query}`,
        topics: dedupeTopics([query, ...normalizedTopics]),
      });
      try {
        const response = await fetchWithTimeout(link, {
          headers: {
            'User-Agent': CHROME_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        }, Math.max(5_000, Math.min(timeoutMs, 12_000)));
        if (!response.ok) continue;
        const html = await response.text();
        for (const candidate of collectFeedCandidatesFromHtml(html, link)) {
          addCandidate(candidate, 12);
        }
      } catch {
        // ignore per-link failures
      }
    }
  }

  const rankedCandidates = Array.from(candidateScore.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url)
    .slice(0, 50);

  let discoveredFeedUrl = '';
  for (const candidate of rankedCandidates.slice(0, 16)) {
    if (await validateFeedCandidate(candidate)) {
      discoveredFeedUrl = candidate;
      break;
    }
  }

  const rankedSources = rankedCandidates
    .filter((candidate) => candidate !== discoveredFeedUrl)
    .slice(0, 14)
    .map((candidate) => ({
      ...candidateToDiscoveredSource('Autonomous Discovery', candidate),
      topics: normalizedTopics,
    }));

  const discoveredSources = mergeDiscoveredSourceLists(
    planner?.discoveredSources || [],
    rankedSources,
    harvestedSources,
  );

  return {
    success: Boolean(discoveredFeedUrl || discoveredSources.length > 0),
    discoveredFeedUrl: discoveredFeedUrl || undefined,
    discoveredSources,
    discoveredTopics: planner?.discoveredTopics || normalizedTopics.map((topic) => ({
      topic,
      rationale: 'topic hint',
      relevanceScore: 7,
    })),
    usedCodex: Boolean(planner?.usedCodex),
    reason: discoveredFeedUrl
      ? 'autonomous hunt found validated RSS'
      : 'autonomous hunt found candidate sources',
  };
}

function collectApiCandidatesFromHtml(html, baseUrl) {
  const candidates = new Set();
  const source = String(html || '');
  if (!source) return [];

  const add = (candidate) => {
    const normalized = normalizeCandidateUrl(candidate, baseUrl);
    if (!normalized) return;
    if (!/^https?:\/\//i.test(normalized)) return;
    candidates.add(normalized);
  };

  const hrefRegex = /<(?:a|link|script)\b[^>]*(?:href|src)=["']([^"']+)["'][^>]*>/gi;
  let match = null;
  let scanned = 0;
  while ((match = hrefRegex.exec(source)) && scanned < 900) {
    scanned += 1;
    const href = String(match[1] || '').trim();
    if (!href) continue;
    const hint = href.toLowerCase();
    if (/(swagger|openapi|graphql|\/api\/|api-doc|rapidapi|developer)/.test(hint)) {
      add(href);
    }
  }

  const urlRegex = /(https?:\/\/[^\s"'<>]+(?:\/api\/[^\s"'<>]*|\/graphql(?:\b|\/)?|\/openapi[^\s"'<>]*|\/swagger[^\s"'<>]*))/gi;
  let urlMatch = null;
  let urlScanned = 0;
  while ((urlMatch = urlRegex.exec(source)) && urlScanned < 200) {
    urlScanned += 1;
    add(urlMatch[1]);
  }

  return Array.from(candidates);
}

function inferApiCategoryFromTopic(topics) {
  const blob = String((topics || []).join(' ')).toLowerCase();
  if (/(ship|port|ais|maritime)/.test(blob)) return 'supply-chain';
  if (/(flight|aviation|air)/.test(blob)) return 'crisis';
  if (/(stock|market|bond|fx|commodity|crypto)/.test(blob)) return 'finance';
  if (/(energy|oil|gas|grid|power)/.test(blob)) return 'energy';
  if (/(ai|chip|semiconductor|quantum|robot)/.test(blob)) return 'tech';
  return 'intel';
}

function inferApiSchemaHint(urlValue, contentType = '', body = '') {
  const url = String(urlValue || '').toLowerCase();
  const ct = String(contentType || '').toLowerCase();
  const text = String(body || '').trim();
  if (ct.includes('json') || url.endsWith('.json') || text.startsWith('{') || text.startsWith('[')) return 'json';
  if (ct.includes('xml') || url.endsWith('.xml') || text.startsWith('<')) return 'xml';
  return 'unknown';
}

function extractStructuredSampleKeys(body) {
  const text = String(body || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const keys = new Set();
    const visit = (value, depth = 0) => {
      if (depth > 2 || keys.size >= 16 || value == null) return;
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 4)) visit(item, depth + 1);
        return;
      }
      if (typeof value === 'object') {
        for (const [key, entry] of Object.entries(value).slice(0, 12)) {
          keys.add(String(key));
          visit(entry, depth + 1);
          if (keys.size >= 16) break;
        }
      }
    };
    visit(parsed);
    return Array.from(keys);
  } catch {
    return [];
  }
}

async function captureNetworkStructuredResponses(pageUrl, timeoutMs) {
  if (!ENABLE_PLAYWRIGHT_DISCOVERY) return [];
  let browser = null;
  try {
    const playwright = await import('playwright');
    if (!playwright?.chromium) return [];

    browser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const context = await browser.newContext({ userAgent: CHROME_UA });
    const page = await context.newPage();
    const captures = [];
    const seen = new Set();

    page.on('response', async (response) => {
      try {
        const request = response.request();
        const requestUrl = String(response.url() || '').trim();
        if (!/^https?:\/\//i.test(requestUrl)) return;
        const resourceType = request.resourceType();
        const headers = response.headers?.() || {};
        const contentType = String(headers['content-type'] || '').toLowerCase();
        const isStructured =
          resourceType === 'xhr'
          || resourceType === 'fetch'
          || contentType.includes('json')
          || /\/api\/|graphql|openapi|swagger/i.test(requestUrl);
        if (!isStructured) return;

        const dedupeKey = `${request.method().toUpperCase()}::${requestUrl}`;
        if (seen.has(dedupeKey) || captures.length >= 24) return;
        seen.add(dedupeKey);

        let bodyText = '';
        try {
          if (contentType.includes('json') || resourceType === 'xhr' || resourceType === 'fetch') {
            bodyText = String(await response.text() || '').slice(0, 3000);
          }
        } catch {
          bodyText = '';
        }

        captures.push({
          pageUrl,
          requestUrl,
          method: request.method().toUpperCase(),
          status: response.status(),
          contentType: contentType || 'unknown',
          schemaHint: inferApiSchemaHint(requestUrl, contentType, bodyText),
          sampleKeys: extractStructuredSampleKeys(bodyText),
          notes: [
            resourceType,
            ...(Object.keys(headers).some((key) => /ratelimit/i.test(key)) ? ['rate-limit-header'] : []),
          ].filter(Boolean),
        });
      } catch {
        // ignore interception errors
      }
    });

    await page.goto(pageUrl, {
      waitUntil: 'domcontentloaded',
      timeout: Math.max(8_000, Math.min(timeoutMs, 18_000)),
    });
    await page.waitForLoadState('networkidle', {
      timeout: Math.max(2_500, Math.min(timeoutMs, 7_000)),
    }).catch(() => {});
    await page.waitForTimeout(1200).catch(() => {});
    await context.close();
    return captures;
  } catch {
    return [];
  } finally {
    try {
      if (browser) await browser.close();
    } catch {
      // ignore
    }
  }
}

async function probeApiCandidate(urlValue, timeoutMs) {
  const sampleUrl = normalizeCandidateUrl(urlValue, urlValue);
  if (!sampleUrl) return null;
  try {
    const response = await fetchWithTimeout(sampleUrl, {
      headers: {
        'User-Agent': CHROME_UA,
        'Accept': 'application/json, application/xml, text/xml, */*',
      },
    }, Math.max(6_000, Math.min(timeoutMs, 16_000)));
    const text = String(await response.text() || '');
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    const schemaHint = inferApiSchemaHint(sampleUrl, contentType, text);
    const hasRateLimitInfo = ['x-ratelimit-limit', 'x-rate-limit-limit', 'ratelimit-limit']
      .some((header) => Boolean(response.headers?.get?.(header)));
    const hasTosInfo = /terms|rate limit|api key|usage/i.test(text.slice(0, 1500));
    const healthStatus = !response.ok ? (response.status >= 500 ? 'down' : 'degraded') : (text.length > 0 ? 'ok' : 'degraded');
    const confidenceBase = response.ok ? 62 : 32;
    const confidence = Math.max(0, Math.min(100,
      confidenceBase
      + (schemaHint !== 'unknown' ? 10 : 0)
      + (hasRateLimitInfo ? 6 : 0)
      + (hasTosInfo ? 4 : 0)
      + (/graphql|openapi|swagger|\/api\//i.test(sampleUrl) ? 10 : 0)
    ));
    return {
      sampleUrl,
      schemaHint,
      hasRateLimitInfo,
      hasTosInfo,
      healthStatus,
      confidence,
    };
  } catch {
    return null;
  }
}

async function runAutonomousApiSourceHunt({ topics = [], timeoutMs = LOCAL_SOURCE_DISCOVERY_TIMEOUT_MS }) {
  const normalizedTopics = dedupeTopics(topics).slice(0, 10);
  if (normalizedTopics.length === 0) {
    return { success: false, reason: 'topics required', candidates: [] };
  }

  const planner = await runCodexDiscoveryPlanner({
    origin: '',
    feedName: 'API Discovery',
    reason: 'autonomous api source hunt',
    topicHints: normalizedTopics,
    timeoutMs,
  });

  const queryPool = dedupeTopics([
    ...(planner?.searchQueries || []),
    ...normalizedTopics.map((topic) => `${topic} api`),
    ...normalizedTopics.map((topic) => `${topic} openapi`),
    ...normalizedTopics.map((topic) => `${topic} graphql`),
  ]).slice(0, 10);

  const seedLinks = new Set();
  for (const candidatePath of planner?.candidatePaths || []) {
    if (/^https?:\/\//i.test(candidatePath)) seedLinks.add(candidatePath);
  }

  for (const query of queryPool) {
    const links = await discoverSearchResultLinksWithPlaywright(query, timeoutMs);
    for (const link of links.slice(0, 14)) {
      if (isDiscoveryNoiseDomain(link)) continue;
      seedLinks.add(link);
    }
  }

  const apiCandidateSet = new Set();
  for (const seed of Array.from(seedLinks).slice(0, 50)) {
    if (/(swagger|openapi|graphql|\/api\/|api-doc|rapidapi|developer)/i.test(seed)) {
      apiCandidateSet.add(seed);
    }
    try {
      const response = await fetchWithTimeout(seed, {
        headers: {
          'User-Agent': CHROME_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      }, Math.max(5_000, Math.min(timeoutMs, 14_000)));
      if (!response.ok) continue;
      const html = await response.text();
      const discovered = collectApiCandidatesFromHtml(html, seed);
      for (const candidate of discovered.slice(0, 25)) {
        apiCandidateSet.add(candidate);
      }
    } catch {
      // ignore per-seed errors
    }
  }

  const candidates = [];
  for (const urlValue of Array.from(apiCandidateSet).slice(0, 60)) {
    const probe = await probeApiCandidate(urlValue, timeoutMs);
    if (!probe) continue;
    const domain = hostLabel(probe.sampleUrl);
    const category = inferApiCategoryFromTopic(normalizedTopics);
    candidates.push({
      name: `API (${domain})`,
      baseUrl: `https://${domain}`,
      sampleUrl: probe.sampleUrl,
      category,
      confidence: probe.confidence,
      reason: 'playwright/codex api-source discovery',
      discoveredBy: planner?.usedCodex ? 'codex-playwright' : 'playwright',
      schemaHint: probe.schemaHint,
      hasRateLimitInfo: probe.hasRateLimitInfo,
      hasTosInfo: probe.hasTosInfo,
      healthStatus: probe.healthStatus,
    });
    if (candidates.length >= 24) break;
  }

  return {
    success: candidates.length > 0,
    reason: candidates.length > 0 ? 'api source candidates discovered' : 'no api source candidates discovered',
    candidates,
    usedCodex: Boolean(planner?.usedCodex),
    discoveredTopics: planner?.discoveredTopics || normalizedTopics.map((topic) => ({
      topic,
      rationale: 'topic hint',
      relevanceScore: 6,
    })),
  };
}

function htmlToTextSummary(html, maxChars = 5000) {
  const source = String(html || '');
  if (!source) return '';
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

function extractImageSignalsFromHtml(html, baseUrl) {
  const source = String(html || '');
  const signals = [];
  const imgRegex = /<img\b[^>]*>/gi;
  let match = null;
  let scanned = 0;
  while ((match = imgRegex.exec(source)) && scanned < 80) {
    scanned += 1;
    const tag = match[0] || '';
    const altMatch = tag.match(/\balt=["']([^"']+)["']/i);
    const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
    const alt = String(altMatch?.[1] || '').trim();
    const srcRaw = String(srcMatch?.[1] || '').trim();
    const src = normalizeCandidateUrl(srcRaw, baseUrl) || srcRaw;
    if (!alt && !src) continue;
    signals.push({ alt, src });
    if (signals.length >= 12) break;
  }
  return signals;
}

async function runVisionModelOnImage({ imageUrl, topic = '', timeoutMs = 25_000 }) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey || !/^https?:\/\//i.test(String(imageUrl || ''))) return null;
  const model = String(process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini').trim();
  try {
    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': CHROME_UA,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `Extract intelligence-relevant clues from this image. Topic: ${String(topic || '').slice(0, 120)}. Return one concise paragraph.` },
              { type: 'image_url', image_url: { url: String(imageUrl) } },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 220,
      }),
    }, Math.max(8_000, Math.min(timeoutMs, 30_000)));
    if (!response.ok) return null;
    const payload = await response.json();
    const text = String(payload?.choices?.[0]?.message?.content || '').trim();
    if (!text) return null;
    return { model, text: text.slice(0, 700) };
  } catch {
    return null;
  }
}

async function resolveEntityViaWikidata(term, timeoutMs = 10_000) {
  const query = String(term || '').trim();
  if (!query) return { ok: false, reason: 'term required' };
  try {
    const params = new URLSearchParams({
      action: 'wbsearchentities',
      format: 'json',
      language: 'en',
      uselang: 'en',
      type: 'item',
      limit: '1',
      search: query,
    });
    const url = `https://www.wikidata.org/w/api.php?${params.toString()}`;
    const response = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': CHROME_UA,
        'Accept': 'application/json, */*',
      },
    }, Math.max(4_000, Math.min(timeoutMs, 15_000)));
    if (!response.ok) {
      return { ok: false, reason: `wikidata http ${response.status}` };
    }
    const payload = await response.json();
    const first = payload?.search?.[0];
    if (!first?.id || !first?.label) {
      return { ok: false, reason: 'no match' };
    }
    const aliases = [];
    if (first.match?.text) aliases.push(String(first.match.text));
    if (first.description) aliases.push(String(first.description));
    return {
      ok: true,
      id: String(first.id),
      canonicalName: String(first.label),
      aliases: dedupeTopics(aliases).slice(0, 12),
      confidence: 84,
    };
  } catch (error) {
    return { ok: false, reason: String(error?.message || 'wikidata lookup failed') };
  }
}

async function extractMultimodalIntel({ url, topic = '', timeoutMs = 30_000 }) {
  const targetUrl = String(url || '').trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    return { success: false, reason: 'valid url required' };
  }

  const response = await fetchWithTimeout(targetUrl, {
    headers: {
      'User-Agent': CHROME_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  }, Math.max(8_000, Math.min(timeoutMs, 45_000)));

  if (!response.ok) {
    return { success: false, reason: `target http ${response.status}` };
  }

  const html = await response.text();
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  const metaDescription = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] || '').trim();
  const textSummary = htmlToTextSummary(html, 7000);
  const imageSignals = extractImageSignalsFromHtml(html, targetUrl);
  const imageHints = imageSignals.map((signal) => `img alt=${signal.alt || 'na'} src=${signal.src || 'na'}`);
  const networkCaptures = await captureNetworkStructuredResponses(targetUrl, timeoutMs);

  const evidence = dedupeTopics([
    title,
    metaDescription,
    ...imageHints,
  ]).slice(0, 12);

  let summary = [title, metaDescription, textSummary.slice(0, 360)].filter(Boolean).join(' | ').slice(0, 700);
  let model = 'playwright-dom';
  let usedVision = false;

  const primaryImageUrl = imageSignals.find(signal => /^https?:\/\//i.test(signal.src))?.src || null;
  if (primaryImageUrl) {
    const vision = await runVisionModelOnImage({ imageUrl: primaryImageUrl, topic, timeoutMs });
    if (vision?.text) {
      summary = `${summary}\nVision cue: ${vision.text}`.slice(0, 900);
      evidence.unshift(`vision:${vision.text.slice(0, 160)}`);
      model = vision.model;
      usedVision = true;
    }
  }

  try {
    const loginStatus = await runCodexCli(['login', 'status'], { timeoutMs: 8_000 });
    const loginOutput = `${loginStatus.stdout || ''}\n${loginStatus.stderr || ''}`;
    if (loginStatus.code === 0 && isCodexLoggedIn(loginOutput)) {
      const prompt = [
        'You are extracting intelligence signals from one webpage.',
        'Return strict JSON object only:',
        '{"summary":"...","evidence":["..."]}',
        `TOPIC: ${String(topic || '').slice(0, 200)}`,
        `URL: ${targetUrl}`,
        `TITLE: ${title}`,
        `META_DESCRIPTION: ${metaDescription}`,
        `IMAGE_HINTS: ${imageHints.join(' || ') || 'none'}`,
        `TEXT_SNIPPET: ${textSummary.slice(0, 5000)}`,
      ].join('\n');
      let args = buildCodexExecArgs(prompt, true);
      let result = await runCodexCli(args, { timeoutMs: Math.max(CODEX_TIMEOUT_MS, 55_000) });
      if (result.code !== 0) {
        const errText = `${result.stderr || ''}\n${result.stdout || ''}`;
        if (/unexpected argument '--ask-for-approval'/i.test(errText)) {
          args = buildCodexExecArgs(prompt, false);
          result = await runCodexCli(args, { timeoutMs: Math.max(CODEX_TIMEOUT_MS, 55_000) });
        }
      }
      if (result.code === 0 && !result.timedOut) {
        const raw = parseCodexJsonOutput(result.stdout || '');
        const parsed = safeParseJsonObject(raw || '');
        if (parsed && typeof parsed.summary === 'string' && parsed.summary.trim()) {
          summary = parsed.summary.trim().slice(0, 900);
          if (Array.isArray(parsed.evidence)) {
            evidence.splice(0, evidence.length, ...dedupeTopics(parsed.evidence.map((entry) => String(entry || ''))).slice(0, 12));
          }
          model = process.env.CODEX_MODEL?.trim() || 'codex-cli';
        }
      }
    }
  } catch {
    // Keep fallback summary.
  }

  return {
    success: true,
    topic: String(topic || '').trim() || 'multimodal-scan',
    summary: summary || textSummary.slice(0, 500),
    evidence,
    networkCaptures,
    model,
    usedVision,
    capturedAt: new Date().toISOString(),
  };
}

async function runLocalOllamaChat({ messages = [], timeoutMs = 20_000 }) {
  const baseUrl = String(process.env.OLLAMA_API_URL || '').trim();
  const model = String(process.env.OLLAMA_MODEL || '').trim();
  if (!baseUrl || !model) {
    return { ok: false, reason: 'OLLAMA_API_URL or OLLAMA_MODEL missing' };
  }

  const normalizedMessages = Array.isArray(messages)
    ? messages
        .map((message) => ({
          role: String(message?.role || 'user'),
          content: String(message?.content || '').trim(),
        }))
        .filter((message) => message.content)
        .slice(0, 24)
    : [];
  if (normalizedMessages.length === 0) {
    return { ok: false, reason: 'messages required' };
  }

  const openAiCompatibleUrl = new URL('/v1/chat/completions', baseUrl).toString();
  try {
    const response = await fetchWithTimeout(openAiCompatibleUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: normalizedMessages,
        temperature: 0.15,
      }),
    }, Math.max(8_000, Math.min(timeoutMs, 45_000)));
    if (response.ok) {
      const payload = await response.json();
      const content = String(payload?.choices?.[0]?.message?.content || '').trim();
      if (content) {
        return { ok: true, summary: content, model };
      }
    }
  } catch {
    // fall through
  }

  try {
    const nativeUrl = new URL('/api/chat', baseUrl).toString();
    const response = await fetchWithTimeout(nativeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: normalizedMessages,
        stream: false,
      }),
    }, Math.max(8_000, Math.min(timeoutMs, 45_000)));
    if (!response.ok) {
      return { ok: false, reason: `ollama http ${response.status}` };
    }
    const payload = await response.json();
    const content = String(payload?.message?.content || '').trim();
    if (!content) {
      return { ok: false, reason: 'ollama returned empty response' };
    }
    return { ok: true, summary: content, model };
  } catch (error) {
    return { ok: false, reason: String(error?.message || 'ollama chat failed') };
  }
}

function relayToHttpUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
    if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function isAuthFailure(status, text = '') {
  // Intentionally broad for provider auth responses.
  // Callers MUST check isCloudflareChallenge403() first or CF challenge pages
  // may be misclassified as credential failures.
  if (status === 401 || status === 403) return true;
  return /unauthori[sz]ed|forbidden|invalid api key|invalid token|bad credentials/i.test(text);
}

function isCloudflareChallenge403(response, text = '') {
  if (response.status !== 403 || !response.headers.get('cf-ray')) return false;
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const body = String(text || '').toLowerCase();
  const looksLikeHtml = contentType.includes('text/html') || body.includes('<html');
  if (!looksLikeHtml) return false;
  const matches = [
    'attention required',
    'cf-browser-verification',
    '__cf_chl',
    'ray id',
  ].filter((marker) => body.includes(marker)).length;
  return matches >= 2;
}

async function validateSecretAgainstProvider(key, rawValue, context = {}) {
  const value = String(rawValue || '').trim();
  if (!value) return { valid: false, message: 'Value is required' };

  const fail = (message) => ({ valid: false, message });
  const ok = (message) => ({ valid: true, message });

  try {
    switch (key) {
    case 'GROQ_API_KEY': {
      const response = await fetchWithTimeout('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${value}`, 'User-Agent': CHROME_UA },
      });
      const text = await response.text();
      if (isCloudflareChallenge403(response, text)) return ok('Groq key stored (Cloudflare blocked verification)');
      if (isAuthFailure(response.status, text)) return fail('Groq rejected this key');
      if (!response.ok) return fail(`Groq probe failed (${response.status})`);
      return ok('Groq key verified');
    }

    case 'OPENROUTER_API_KEY': {
      const response = await fetchWithTimeout('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${value}`, 'User-Agent': CHROME_UA },
      });
      const text = await response.text();
      if (isCloudflareChallenge403(response, text)) return ok('OpenRouter key stored (Cloudflare blocked verification)');
      if (isAuthFailure(response.status, text)) return fail('OpenRouter rejected this key');
      if (!response.ok) return fail(`OpenRouter probe failed (${response.status})`);
      return ok('OpenRouter key verified');
    }

    case 'OPENAI_API_KEY': {
      const response = await fetchWithTimeout('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${value}`, 'User-Agent': CHROME_UA },
      });
      const text = await response.text();
      if (isCloudflareChallenge403(response, text)) return ok('OpenAI key stored (Cloudflare blocked verification)');
      if (isAuthFailure(response.status, text)) return fail('OpenAI rejected this key');
      if (response.status === 429) return ok('OpenAI key accepted (rate limited)');
      if (!response.ok) return fail(`OpenAI probe failed (${response.status})`);
      return ok('OpenAI key verified');
    }

    case 'FRED_API_KEY': {
      const response = await fetchWithTimeout(
        `https://api.stlouisfed.org/fred/series?series_id=GDP&api_key=${encodeURIComponent(value)}&file_type=json`,
        { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }
      );
      const text = await response.text();
      if (!response.ok) return fail(`FRED probe failed (${response.status})`);
      let payload = null;
      try { payload = JSON.parse(text); } catch { /* ignore */ }
      if (payload?.error_code || payload?.error_message) return fail('FRED rejected this key');
      if (!Array.isArray(payload?.seriess)) return fail('Unexpected FRED response');
      return ok('FRED key verified');
    }

    case 'EIA_API_KEY': {
      const response = await fetchWithTimeout(
        `https://api.eia.gov/v2/?api_key=${encodeURIComponent(value)}`,
        { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }
      );
      const text = await response.text();
      if (isCloudflareChallenge403(response, text)) return ok('EIA key stored (Cloudflare blocked verification)');
      if (isAuthFailure(response.status, text)) return fail('EIA rejected this key');
      if (!response.ok) return fail(`EIA probe failed (${response.status})`);
      let payload = null;
      try { payload = JSON.parse(text); } catch { /* ignore */ }
      if (payload?.response?.id === undefined && !payload?.response?.routes) return fail('Unexpected EIA response');
      return ok('EIA key verified');
    }

    case 'CLOUDFLARE_API_TOKEN': {
      const response = await fetchWithTimeout(
        'https://api.cloudflare.com/client/v4/radar/annotations/outages?dateRange=1d&limit=1',
        { headers: { Authorization: `Bearer ${value}`, 'User-Agent': CHROME_UA } }
      );
      const text = await response.text();
      if (isCloudflareChallenge403(response, text)) return ok('Cloudflare token stored (Cloudflare blocked verification)');
      if (isAuthFailure(response.status, text)) return fail('Cloudflare rejected this token');
      if (!response.ok) return fail(`Cloudflare probe failed (${response.status})`);
      let payload = null;
      try { payload = JSON.parse(text); } catch { /* ignore */ }
      if (payload?.success !== true) return fail('Cloudflare Radar API did not return success');
      return ok('Cloudflare token verified');
    }

    case 'ACLED_ACCESS_TOKEN': {
      const response = await fetchWithTimeout('https://acleddata.com/api/acled/read?_format=json&limit=1', {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${value}`,
          'User-Agent': CHROME_UA,
        },
      });
      const text = await response.text();
      if (isCloudflareChallenge403(response, text)) return ok('ACLED token stored (Cloudflare blocked verification)');
      if (isAuthFailure(response.status, text)) return fail('ACLED rejected this token');
      if (!response.ok) return fail(`ACLED probe failed (${response.status})`);
      return ok('ACLED token verified');
    }

    case 'URLHAUS_AUTH_KEY': {
      const response = await fetchWithTimeout('https://urlhaus-api.abuse.ch/v1/urls/recent/limit/1/', {
        headers: {
          Accept: 'application/json',
          'Auth-Key': value,
          'User-Agent': CHROME_UA,
        },
      });
      const text = await response.text();
      if (isCloudflareChallenge403(response, text)) return ok('URLhaus key stored (Cloudflare blocked verification)');
      if (isAuthFailure(response.status, text)) return fail('URLhaus rejected this key');
      if (!response.ok) return fail(`URLhaus probe failed (${response.status})`);
      return ok('URLhaus key verified');
    }

    case 'OTX_API_KEY': {
      const response = await fetchWithTimeout('https://otx.alienvault.com/api/v1/user/me', {
        headers: {
          Accept: 'application/json',
          'X-OTX-API-KEY': value,
          'User-Agent': CHROME_UA,
        },
      });
      const text = await response.text();
      if (isCloudflareChallenge403(response, text)) return ok('OTX key stored (Cloudflare blocked verification)');
      if (isAuthFailure(response.status, text)) return fail('OTX rejected this key');
      if (!response.ok) return fail(`OTX probe failed (${response.status})`);
      return ok('OTX key verified');
    }

    case 'ABUSEIPDB_API_KEY': {
      const response = await fetchWithTimeout('https://api.abuseipdb.com/api/v2/check?ipAddress=8.8.8.8&maxAgeInDays=90', {
        headers: {
          Accept: 'application/json',
          Key: value,
          'User-Agent': CHROME_UA,
        },
      });
      const text = await response.text();
      if (isCloudflareChallenge403(response, text)) return ok('AbuseIPDB key stored (Cloudflare blocked verification)');
      if (isAuthFailure(response.status, text)) return fail('AbuseIPDB rejected this key');
      if (!response.ok) return fail(`AbuseIPDB probe failed (${response.status})`);
      return ok('AbuseIPDB key verified');
    }

    case 'WINGBITS_API_KEY': {
      const response = await fetchWithTimeout('https://customer-api.wingbits.com/v1/flights/details/3c6444', {
        headers: {
          Accept: 'application/json',
          'x-api-key': value,
          'User-Agent': CHROME_UA,
        },
      });
      const text = await response.text();
      if (isCloudflareChallenge403(response, text)) return ok('Wingbits key stored (Cloudflare blocked verification)');
      if (isAuthFailure(response.status, text)) return fail('Wingbits rejected this key');
      if (response.status >= 500) return fail(`Wingbits probe failed (${response.status})`);
      return ok('Wingbits key accepted');
    }

    case 'FINNHUB_API_KEY': {
      const response = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(value)}`, {
        headers: { Accept: 'application/json', 'User-Agent': CHROME_UA },
      });
      const text = await response.text();
      if (isCloudflareChallenge403(response, text)) return ok('Finnhub key stored (Cloudflare blocked verification)');
      if (isAuthFailure(response.status, text)) return fail('Finnhub rejected this key');
      if (response.status === 429) return ok('Finnhub key accepted (rate limited)');
      if (!response.ok) return fail(`Finnhub probe failed (${response.status})`);
      let payload = null;
      try { payload = JSON.parse(text); } catch { /* ignore */ }
      if (typeof payload?.error === 'string' && payload.error.toLowerCase().includes('invalid')) {
        return fail('Finnhub rejected this key');
      }
      if (typeof payload?.c !== 'number') return fail('Unexpected Finnhub response');
      return ok('Finnhub key verified');
    }

    case 'NASA_FIRMS_API_KEY': {
      const response = await fetchWithTimeout(
        `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(value)}/VIIRS_SNPP_NRT/22,44,40,53/1`,
        { headers: { Accept: 'text/csv', 'User-Agent': CHROME_UA } }
      );
      const text = await response.text();
      if (isCloudflareChallenge403(response, text)) return ok('NASA FIRMS key stored (Cloudflare blocked verification)');
      if (isAuthFailure(response.status, text)) return fail('NASA FIRMS rejected this key');
      if (!response.ok) return fail(`NASA FIRMS probe failed (${response.status})`);
      if (/invalid api key|not authorized|forbidden/i.test(text)) return fail('NASA FIRMS rejected this key');
      return ok('NASA FIRMS key verified');
    }

    case 'OLLAMA_API_URL': {
      let probeUrl;
      try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)) return fail('Must be an http(s) URL');
        // Probe the OpenAI-compatible models endpoint
        probeUrl = new URL('/v1/models', value).toString();
      } catch {
        return fail('Invalid URL');
      }
      const response = await fetchWithTimeout(probeUrl, { method: 'GET' }, 8000);
      if (!response.ok) {
        // Fall back to native Ollama /api/tags endpoint
        try {
          const tagsUrl = new URL('/api/tags', value).toString();
          const tagsResponse = await fetchWithTimeout(tagsUrl, { method: 'GET' }, 8000);
          if (!tagsResponse.ok) return fail(`Ollama probe failed (${tagsResponse.status})`);
          return ok('Ollama endpoint verified (native API)');
        } catch {
          return fail(`Ollama probe failed (${response.status})`);
        }
      }
      return ok('Ollama endpoint verified');
    }

    case 'OLLAMA_MODEL':
      return ok('Model name stored');

    case 'OPENBB_API_URL': {
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        return fail('Invalid OpenBB URL');
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return fail('OpenBB URL must be http(s)');
      }

      // Probe a lightweight public endpoint path used by OpenBB platform API.
      const probe = new URL('/api/v1/equity/price/quote?provider=yfinance&symbol=AAPL', value).toString();
      const response = await fetchWithTimeout(probe, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': CHROME_UA },
      }, 8000);
      if (response.status >= 500) {
        return fail(`OpenBB probe failed (${response.status})`);
      }
      return ok('OpenBB URL accepted');
    }

    case 'OPENBB_API_KEY': {
      const contextBaseUrl = typeof context.OPENBB_API_URL === 'string' ? context.OPENBB_API_URL.trim() : '';
      const baseUrl = contextBaseUrl || String(process.env.OPENBB_API_URL || '').trim();
      if (!baseUrl) {
        return ok('OpenBB key stored (set OPENBB_API_URL to verify)');
      }
      try {
        const probe = new URL('/api/v1/equity/price/quote?provider=yfinance&symbol=AAPL', baseUrl).toString();
        const response = await fetchWithTimeout(probe, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${value}`,
            'x-api-key': value,
            'User-Agent': CHROME_UA,
          },
        }, 8000);
        const text = await response.text();
        if (isAuthFailure(response.status, text)) return fail('OpenBB rejected this key');
        if (response.status >= 500) return fail(`OpenBB probe failed (${response.status})`);
      } catch {
        return ok('OpenBB key stored (verification unavailable)');
      }
      return ok('OpenBB key accepted');
    }

    case 'WS_RELAY_URL':
    case 'VITE_WS_RELAY_URL':
    case 'VITE_OPENSKY_RELAY_URL': {
      const probeUrl = relayToHttpUrl(value);
      if (!probeUrl) return fail('Relay URL is invalid');
      const response = await fetchWithTimeout(probeUrl, { method: 'GET' });
      if (response.status >= 500) return fail(`Relay probe failed (${response.status})`);
      return ok('Relay URL is reachable');
    }

    case 'OPENSKY_CLIENT_ID':
    case 'OPENSKY_CLIENT_SECRET': {
      const contextClientId = typeof context.OPENSKY_CLIENT_ID === 'string' ? context.OPENSKY_CLIENT_ID.trim() : '';
      const contextClientSecret = typeof context.OPENSKY_CLIENT_SECRET === 'string' ? context.OPENSKY_CLIENT_SECRET.trim() : '';
      const clientId = key === 'OPENSKY_CLIENT_ID'
        ? value
        : (contextClientId || String(process.env.OPENSKY_CLIENT_ID || '').trim());
      const clientSecret = key === 'OPENSKY_CLIENT_SECRET'
        ? value
        : (contextClientSecret || String(process.env.OPENSKY_CLIENT_SECRET || '').trim());
      if (!clientId || !clientSecret) {
        return fail('Set both OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET before verification');
      }
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      });
      const response = await fetchWithTimeout(
        'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': CHROME_UA },
          body,
        }
      );
      const text = await response.text();
      if (isCloudflareChallenge403(response, text)) return ok('OpenSky credentials stored (Cloudflare blocked verification)');
      if (isAuthFailure(response.status, text)) return fail('OpenSky rejected these credentials');
      if (!response.ok) return fail(`OpenSky auth probe failed (${response.status})`);
      let payload = null;
      try { payload = JSON.parse(text); } catch { /* ignore */ }
      if (!payload?.access_token) return fail('OpenSky auth response did not include an access token');
      return ok('OpenSky credentials verified');
    }

    case 'AISSTREAM_API_KEY':
      return ok('AISSTREAM key stored (live verification not available in sidecar)');

    case 'WTO_API_KEY':
      return ok('WTO API key stored (live verification not available in sidecar)');

      default:
        return ok('Key stored');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'provider probe failed';
    if (isTransientVerificationError(error)) {
      return { valid: true, message: `Saved (could not verify: ${message})` };
    }
    return fail(`Verification request failed: ${message}`);
  }
}

async function dispatch(requestUrl, req, routes, context) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: makeCorsHeaders(req) });
  }

  // Health check — exempt from auth to support external monitoring tools
  if (requestUrl.pathname === '/api/service-status') {
    return handleLocalServiceStatus(context);
  }

  // YouTube embed bridge — exempt from auth because iframe src cannot carry
  // Authorization headers.  Serves a minimal HTML page that loads the YouTube
  // IFrame Player API from a localhost origin (which YouTube accepts, unlike
  // tauri://localhost).  No sensitive data is exposed.
  if (requestUrl.pathname === '/api/youtube-embed') {
    const videoId = requestUrl.searchParams.get('videoId');
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      return new Response('Invalid videoId', { status: 400, headers: { 'content-type': 'text/plain' } });
    }
    const autoplay = requestUrl.searchParams.get('autoplay') === '0' ? '0' : '1';
    const mute = requestUrl.searchParams.get('mute') === '0' ? '0' : '1';
    const vq = ['small','medium','large','hd720','hd1080'].includes(requestUrl.searchParams.get('vq') || '') ? requestUrl.searchParams.get('vq') : '';
    const origin = `http://127.0.0.1:${context.port}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}#player{width:100%;height:100%}#play-overlay{position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(0,0,0,0.4)}#play-overlay svg{width:72px;height:72px;opacity:0.9;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.5))}#play-overlay.hidden{display:none}</style></head><body><div id="player"></div><div id="play-overlay"><svg viewBox="0 0 68 48"><path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55C3.97 2.33 2.27 4.81 1.48 7.74.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="red"/><path d="M45 24L27 14v20" fill="#fff"/></svg></div><script>var tag=document.createElement('script');tag.src='https://www.youtube.com/iframe_api';document.head.appendChild(tag);var player,overlay=document.getElementById('play-overlay'),started=false,parentOrigin='${origin}';function hideOverlay(){overlay.classList.add('hidden')}function onYouTubeIframeAPIReady(){player=new YT.Player('player',{videoId:'${videoId}',host:'https://www.youtube.com',playerVars:{autoplay:${autoplay},mute:${mute},playsinline:1,rel:0,controls:1,modestbranding:1,enablejsapi:1,origin:'${origin}',widget_referrer:'${origin}'},events:{onReady:function(){window.parent.postMessage({type:'yt-ready'},parentOrigin);${vq ? `if(player.setPlaybackQuality)player.setPlaybackQuality('${vq}');` : ''}if(${autoplay}===1){player.playVideo()}},onError:function(e){window.parent.postMessage({type:'yt-error',code:e.data},parentOrigin)},onStateChange:function(e){window.parent.postMessage({type:'yt-state',state:e.data},parentOrigin);if(e.data===1||e.data===3){hideOverlay();started=true}}}})}overlay.addEventListener('click',function(){if(player&&player.playVideo){player.playVideo();player.unMute();hideOverlay()}});setTimeout(function(){if(!started)overlay.classList.remove('hidden')},3000);window.addEventListener('message',function(e){if(e.origin!==parentOrigin)return;if(!player||!player.getPlayerState)return;var m=e.data;if(!m||!m.type)return;switch(m.type){case'play':player.playVideo();break;case'pause':player.pauseVideo();break;case'mute':player.mute();break;case'unmute':player.unMute();break;case'loadVideo':if(m.videoId)player.loadVideoById(m.videoId);break;case'setQuality':if(m.quality&&player.setPlaybackQuality)player.setPlaybackQuality(m.quality);break}})<\/script></body></html>`;
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...makeCorsHeaders(req) } });
  }

  if (requestUrl.pathname === '/api/local-status') {
    return json({
      success: true,
      mode: context.mode,
      port: context.port,
      apiDir: context.apiDir,
      remoteBase: context.remoteBase,
      cloudFallback: context.cloudFallback,
      routes: routes.length,
    });
  }

  if (requestUrl.pathname === '/api/local-resource-stats') {
    if (req.method !== 'GET') {
      return json({ error: 'GET required' }, 405);
    }
    const archivePath = path.join(context.dataDir, INTELLIGENCE_ARCHIVE_DB);
    const archiveDbBytes = existsSync(archivePath) ? statSync(archivePath).size : 0;
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    return json({
      success: true,
      stats: {
        timestamp: new Date().toISOString(),
        rssMB: Number((memory.rss / (1024 * 1024)).toFixed(2)),
        heapUsedMB: Number((memory.heapUsed / (1024 * 1024)).toFixed(2)),
        heapTotalMB: Number((memory.heapTotal / (1024 * 1024)).toFixed(2)),
        externalMB: Number(((memory.external || 0) / (1024 * 1024)).toFixed(2)),
        arrayBuffersMB: Number(((memory.arrayBuffers || 0) / (1024 * 1024)).toFixed(2)),
        cpuUserSec: Number((cpu.user / 1_000_000).toFixed(3)),
        cpuSystemSec: Number((cpu.system / 1_000_000).toFixed(3)),
        uptimeSec: Number(process.uptime().toFixed(2)),
        loadAvg1m: Number((os.loadavg?.()[0] || 0).toFixed(3)),
        archiveDbMB: Number((archiveDbBytes / (1024 * 1024)).toFixed(2)),
      },
    });
  }

  if (requestUrl.pathname === '/api/local-codex-status') {
    if (req.method !== 'GET') {
      return json({ error: 'GET required' }, 405);
    }
    try {
      const status = await runCodexCli(['login', 'status'], { timeoutMs: 8000 });
      const output = `${status.stdout || ''}\n${status.stderr || ''}`;
      const loggedIn = status.code === 0 && isCodexLoggedIn(output);
      return json({
        available: true,
        loggedIn,
        message: loggedIn ? 'Codex CLI logged in' : 'Codex CLI not logged in',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to probe Codex CLI';
      return json({
        available: false,
        loggedIn: false,
        message,
      }, 503);
    }
  }

  if (requestUrl.pathname === '/api/local-codex-summarize') {
    if (req.method !== 'POST') {
      return json({ error: 'POST required' }, 405);
    }
    const body = await readBody(req);
    if (!body) return json({ error: 'expected request body' }, 400);

    let payload = null;
    try {
      payload = JSON.parse(body.toString());
    } catch {
      return json({ error: 'expected JSON body' }, 400);
    }

    const mode = payload?.mode === 'translate'
      ? 'translate'
      : payload?.mode === 'chat'
        ? 'chat'
      : payload?.mode === 'analysis'
        ? 'analysis'
        : payload?.mode === 'deep'
          ? 'deep'
          : 'brief';
    const geoContext = typeof payload?.geoContext === 'string' ? payload.geoContext.slice(0, 2000) : '';
    const variant = typeof payload?.variant === 'string' ? payload.variant.slice(0, 32) : 'full';
    const lang = typeof payload?.lang === 'string' ? payload.lang.slice(0, 32) : 'en';
    const rawHeadlines = Array.isArray(payload?.headlines) ? payload.headlines : [];
    const maxHeadlines = mode === 'deep' ? 1800 : mode === 'chat' ? 1200 : 180;
    const headlines = rawHeadlines
      .slice(0, maxHeadlines)
      .map((item) => typeof item === 'string' ? item.slice(0, 500) : '')
      .filter(Boolean);

    if (headlines.length === 0) {
      return json({ error: 'headlines array required' }, 400);
    }

    try {
      const loginStatus = await runCodexCli(['login', 'status'], { timeoutMs: 8000 });
      const loginOutput = `${loginStatus.stdout || ''}\n${loginStatus.stderr || ''}`;
      if (loginStatus.code !== 0 || !isCodexLoggedIn(loginOutput)) {
        return json({ error: 'Codex CLI is not logged in' }, 412);
      }

      const prompt = buildCodexPrompt({ headlines, mode, geoContext, variant, lang });
      let execArgs = buildCodexExecArgs(prompt, true);

      const timeoutMs = mode === 'deep' ? Math.max(CODEX_TIMEOUT_MS, 180_000) : CODEX_TIMEOUT_MS;
      let result = await runCodexCli(execArgs, { timeoutMs });
      if (result.code !== 0) {
        const errText = `${result.stderr || ''}\n${result.stdout || ''}`;
        if (/unexpected argument '--ask-for-approval'/i.test(errText)) {
          execArgs = buildCodexExecArgs(prompt, false);
          result = await runCodexCli(execArgs, { timeoutMs });
        }
      }
      if (result.timedOut) {
        return json({ error: 'Codex CLI timed out' }, 504);
      }
      if (result.code !== 0) {
        const detail = (result.stderr || result.stdout || '').trim().slice(0, 300);
        return json({ error: 'Codex CLI execution failed', detail }, 502);
      }

      const summary = parseCodexJsonOutput(result.stdout || '');
      if (!summary) {
        return json({ error: 'Codex CLI returned empty response' }, 502);
      }

      return json({
        summary,
        model: process.env.CODEX_MODEL?.trim() || 'codex-cli',
        provider: 'codex',
        cached: false,
        fallback: false,
        skipped: false,
        tokens: 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Codex CLI execution failed';
      return json({ error: message }, 502);
    }
  }

  if (requestUrl.pathname === '/api/local-traffic-log') {
    if (req.method === 'DELETE') {
      trafficLog.length = 0;
      return json({ cleared: true });
    }
    return json({ entries: [...trafficLog], verboseMode, maxEntries: TRAFFIC_LOG_MAX });
  }
  if (requestUrl.pathname === '/api/local-debug-toggle') {
    if (req.method === 'POST') {
      verboseMode = !verboseMode;
      saveVerboseState();
      context.logger.log(`[local-api] verbose logging ${verboseMode ? 'ON' : 'OFF'}`);
    }
    return json({ verboseMode });
  }
  // Registration — call Convex directly (desktop frontend bypasses sidecar for this endpoint;
  // this handler only runs when CONVEX_URL is available, e.g. self-hosted deployments)
  if (requestUrl.pathname === '/api/register-interest' && req.method === 'POST') {
    const convexUrl = process.env.CONVEX_URL;
    if (!convexUrl) {
      return json({ error: 'Registration service not configured — use cloud endpoint directly' }, 503);
    }
    try {
      const body = await new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
        req.on('error', reject);
      });
      const parsed = JSON.parse(body);
      const email = parsed.email;
      if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: 'Invalid email address' }, 400);
      }
      const response = await fetchWithTimeout(`${convexUrl}/api/mutation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'registerInterest:register',
          args: { email, source: parsed.source || 'desktop', appVersion: parsed.appVersion || 'unknown' },
          format: 'json',
        }),
      }, 15000);
      const responseBody = await response.text();
      let result;
      try { result = JSON.parse(responseBody); } catch { result = { status: 'registered' }; }
      if (result.status === 'error') {
        return json({ error: result.errorMessage || 'Registration failed' }, 500);
      }
      return json(result.value || result);
    } catch (e) {
      context.logger.error(`[register-interest] error: ${e.message}`);
      return json({ error: 'Registration service unreachable' }, 502);
    }
  }

  // RSS proxy — fetch public feeds directly from desktop, no auth needed
  if (requestUrl.pathname === '/api/rss-proxy') {
    const feedUrl = requestUrl.searchParams.get('url');
    if (!feedUrl) return json({ error: 'Missing url parameter' }, 400);

    try {
      const parsed = new URL(feedUrl);
      const response = await fetchWithTimeout(feedUrl, {
        headers: {
          'User-Agent': CHROME_UA,
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }, parsed.hostname.includes('news.google.com') ? 20000 : 12000);
      const contentType = response.headers?.get?.('content-type') || 'application/xml';
      const rssBody = await response.text();
      return new Response(rssBody || '', {
        status: response.status,
        headers: { 'content-type': contentType },
      });
    } catch (e) {
      const isTimeout = e.name === 'AbortError' || e.message?.includes('timeout');
      return json({ error: isTimeout ? 'Feed timeout' : 'Failed to fetch feed', url: feedUrl }, isTimeout ? 504 : 502);
    }
  }

  // Token auth — required for env mutations and all API handlers
  if (requestUrl.pathname === '/api/local-source-discover') {
    if (req.method !== 'POST') {
      return json({ error: 'POST required' }, 405);
    }

    const body = await readBody(req);
    if (!body) return json({ error: 'expected request body' }, 400);

    let payload = null;
    try {
      payload = JSON.parse(body.toString());
    } catch {
      return json({ error: 'expected JSON body' }, 400);
    }

    const feedName = String(payload?.feedName || '').trim().slice(0, 120);
    const failedUrl = String(payload?.failedUrl || '').trim();
    const timeoutMs = Number(payload?.timeoutMs) > 0
      ? Math.min(Number(payload.timeoutMs), 30_000)
      : LOCAL_SOURCE_DISCOVERY_TIMEOUT_MS;
    const topicHints = dedupeTopics(payload?.topicHints || []).slice(0, 12);
    const reason = String(payload?.reason || '').trim().slice(0, 300);

    const upstream = extractUpstreamFeedUrl(failedUrl);
    if (!upstream) {
      return json({
        success: false,
        reason: 'failedUrl does not include a valid upstream URL',
      }, 422);
    }

    let origin = '';
    try {
      origin = new URL(upstream).origin;
    } catch {
      return json({
        success: false,
        reason: 'upstream URL is invalid',
      }, 422);
    }

    const result = await discoverSourceCandidatesComposite({
      origin,
      upstream,
      feedName,
      reason,
      topicHints,
      timeoutMs,
    });
    return json(result);
  }

  if (requestUrl.pathname === '/api/local-codex-candidate-expansion') {
    if (req.method !== 'POST') {
      return json({ error: 'POST required' }, 405);
    }
    const body = await readBody(req);
    if (!body) return json({ error: 'expected request body' }, 400);

    let payload = null;
    try {
      payload = JSON.parse(body.toString());
    } catch {
      return json({ error: 'expected JSON body' }, 400);
    }

    try {
      const loginStatus = await runCodexCli(['login', 'status'], { timeoutMs: 8000 });
      const loginOutput = `${loginStatus.stdout || ''}\n${loginStatus.stderr || ''}`;
      if (loginStatus.code !== 0 || !isCodexLoggedIn(loginOutput)) {
        return json({ error: 'Codex CLI is not logged in' }, 412);
      }

      const prompt = buildCodexCandidateExpansionPrompt(payload);
      let execArgs = buildCodexExecArgs(prompt, true);
      let result = await runCodexCli(execArgs, { timeoutMs: Math.max(CODEX_TIMEOUT_MS, 90_000) });
      if (result.code !== 0) {
        const errText = `${result.stderr || ''}\n${result.stdout || ''}`;
        if (/unexpected argument '--ask-for-approval'/i.test(errText)) {
          execArgs = buildCodexExecArgs(prompt, false);
          result = await runCodexCli(execArgs, { timeoutMs: Math.max(CODEX_TIMEOUT_MS, 90_000) });
        }
      }
      if (result.timedOut) {
        return json({ error: 'Codex CLI timed out' }, 504);
      }
      if (result.code !== 0) {
        const detail = (result.stderr || result.stdout || '').trim().slice(0, 300);
        return json({ error: 'Codex CLI execution failed', detail }, 502);
      }

      const message = parseCodexJsonOutput(result.stdout || '');
      const parsed = safeParseJsonObject(message);
      if (!parsed) {
        return json({ error: 'Codex CLI returned invalid JSON' }, 502);
      }

      return json({
        proposals: normalizeCandidateExpansionProposals(parsed.proposals || []),
        provider: 'codex',
        model: process.env.CODEX_MODEL?.trim() || 'codex-cli',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Codex CLI execution failed';
      return json({ error: message }, 502);
    }
  }

  if (requestUrl.pathname === '/api/local-source-hunt') {
    if (req.method !== 'POST') {
      return json({ error: 'POST required' }, 405);
    }

    const body = await readBody(req);
    if (!body) return json({ error: 'expected request body' }, 400);

    let payload = null;
    try {
      payload = JSON.parse(body.toString());
    } catch {
      return json({ error: 'expected JSON body' }, 400);
    }

    const timeoutMs = Number(payload?.timeoutMs) > 0
      ? Math.min(Number(payload.timeoutMs), 40_000)
      : LOCAL_SOURCE_DISCOVERY_TIMEOUT_MS;
    const topics = dedupeTopics(payload?.topics || []).slice(0, 12);
    if (topics.length === 0) {
      return json({ success: false, reason: 'topics required' }, 422);
    }

    const result = await runAutonomousSourceHunt({ topics, timeoutMs });
    return json(result);
  }

  if (requestUrl.pathname === '/api/local-api-source-hunt') {
    if (req.method !== 'POST') {
      return json({ error: 'POST required' }, 405);
    }

    const body = await readBody(req);
    if (!body) return json({ error: 'expected request body' }, 400);

    let payload = null;
    try {
      payload = JSON.parse(body.toString());
    } catch {
      return json({ error: 'expected JSON body' }, 400);
    }

    const timeoutMs = Number(payload?.timeoutMs) > 0
      ? Math.min(Number(payload.timeoutMs), 45_000)
      : LOCAL_SOURCE_DISCOVERY_TIMEOUT_MS;
    const topics = dedupeTopics(payload?.topics || []).slice(0, 14);
    if (topics.length === 0) {
      return json({ success: false, reason: 'topics required', candidates: [] }, 422);
    }

    const result = await runAutonomousApiSourceHunt({ topics, timeoutMs });
    return json(result);
  }

  if (requestUrl.pathname === '/api/local-entity-resolve') {
    if (req.method !== 'POST') {
      return json({ error: 'POST required' }, 405);
    }
    const body = await readBody(req);
    if (!body) return json({ error: 'expected request body' }, 400);

    let payload = null;
    try {
      payload = JSON.parse(body.toString());
    } catch {
      return json({ error: 'expected JSON body' }, 400);
    }

    const term = String(payload?.term || '').trim();
    if (!term) return json({ ok: false, reason: 'term required' }, 422);
    const timeoutMs = Number(payload?.timeoutMs) > 0
      ? Math.min(Number(payload.timeoutMs), 20_000)
      : 10_000;

    const result = await resolveEntityViaWikidata(term, timeoutMs);
    return json(result, result.ok ? 200 : 404);
  }

  if (requestUrl.pathname === '/api/local-multimodal-extract') {
    if (req.method !== 'POST') {
      return json({ error: 'POST required' }, 405);
    }
    const body = await readBody(req);
    if (!body) return json({ error: 'expected request body' }, 400);

    let payload = null;
    try {
      payload = JSON.parse(body.toString());
    } catch {
      return json({ error: 'expected JSON body' }, 400);
    }

    const url = String(payload?.url || '').trim();
    const topic = String(payload?.topic || '').trim();
    const timeoutMs = Number(payload?.timeoutMs) > 0
      ? Math.min(Number(payload.timeoutMs), 45_000)
      : 30_000;
    if (!/^https?:\/\//i.test(url)) {
      return json({ success: false, reason: 'valid url required' }, 422);
    }
    try {
      const result = await extractMultimodalIntel({ url, topic, timeoutMs });
      return json(result, 200);
    } catch (error) {
      return json({ success: false, reason: String(error?.message || 'multimodal extract failed') }, 200);
    }
  }

  if (requestUrl.pathname === '/api/local-ollama-chat') {
    if (req.method !== 'POST') {
      return json({ error: 'POST required' }, 405);
    }
    const body = await readBody(req);
    if (!body) return json({ error: 'expected request body' }, 400);

    let payload = null;
    try {
      payload = JSON.parse(body.toString());
    } catch {
      return json({ error: 'expected JSON body' }, 400);
    }

    const timeoutMs = Number(payload?.timeoutMs) > 0
      ? Math.min(Number(payload.timeoutMs), 45_000)
      : 20_000;
    const result = await runLocalOllamaChat({
      messages: payload?.messages,
      timeoutMs,
    });
    return json(result, result.ok ? 200 : 502);
  }

  if (requestUrl.pathname === '/api/local-intelligence-archive') {
    if (req.method === 'GET') {
      const action = String(requestUrl.searchParams.get('action') || 'list').trim().toLowerCase();
      try {
        if (action === 'get') {
          const runId = String(requestUrl.searchParams.get('runId') || '').trim();
          if (!runId) return json({ error: 'runId required' }, 422);
          const run = await getReplayRunFromDuckDb(runId, context);
          return json({ ok: true, run, found: Boolean(run) }, run ? 200 : 404);
        }
        const limit = Number(requestUrl.searchParams.get('limit') || 20);
        const runs = await listReplayRunsFromDuckDb(limit, context);
        return json({ ok: true, runs });
      } catch (error) {
        return json({ ok: false, error: String(error?.message || 'archive read failed') }, 502);
      }
    }

    if (req.method !== 'POST') {
      return json({ error: 'GET or POST required' }, 405);
    }
    const body = await readBody(req);
    if (!body) return json({ error: 'expected request body' }, 400);

    let payload = null;
    try {
      payload = JSON.parse(body.toString());
    } catch {
      return json({ error: 'expected JSON body' }, 400);
    }

    const action = String(payload?.action || '').trim().toLowerCase();
    if (action !== 'archive-replay-run') {
      return json({ error: 'unsupported action' }, 422);
    }
    if (!payload?.run || typeof payload.run !== 'object') {
      return json({ error: 'run payload required' }, 422);
    }
    try {
      const result = await archiveReplayRunToDuckDb(payload.run, context);
      return json(result);
    } catch (error) {
      return json({ ok: false, error: String(error?.message || 'archive write failed') }, 502);
    }
  }

  if (requestUrl.pathname === '/api/local-intelligence-import') {
    if (req.method === 'GET') {
      try {
        const dbPath = String(requestUrl.searchParams.get('dbPath') || '').trim() || undefined;
        const result = await runIntelligenceJob(
          'list-datasets',
          { dbPath },
          context,
          60_000,
        );
        return json(result, 200);
      } catch (error) {
        return json({ ok: false, error: String(error?.message || 'dataset list failed') }, 502);
      }
    }

    if (req.method !== 'POST') {
      return json({ error: 'GET or POST required' }, 405);
    }
    const body = await readBody(req);
    if (!body) return json({ error: 'expected request body' }, 400);

    let payload = null;
    try {
      payload = JSON.parse(body.toString());
    } catch {
      return json({ error: 'expected JSON body' }, 400);
    }

    const filePath = String(payload?.filePath || '').trim();
    if (!filePath) return json({ error: 'filePath required' }, 422);
    try {
      const result = await runIntelligenceJob(
        'import-historical',
        {
          filePath,
          options: payload?.options || {},
        },
        context,
        Number(payload?.timeoutMs) > 0 ? Number(payload.timeoutMs) : 10 * 60_000,
      );
      let postgresSyncResult = null;
      if (payload?.postgresSync && payload?.pgConfig && result?.result) {
        postgresSyncResult = await runIntelligenceJob(
          'postgres-sync-dataset-bulk',
          {
            config: payload.pgConfig,
            dbPath: payload?.options?.dbPath,
            datasetId: result.result.datasetId,
            pageSize: payload?.postgresPageSize,
          },
          context,
          10 * 60_000,
        );
      }
      return json({ ...result, postgresSyncResult }, 200);
    } catch (error) {
      return json({ ok: false, error: String(error?.message || 'historical import failed') }, 502);
    }
  }

  if (requestUrl.pathname === '/api/local-intelligence-replay') {
    if (req.method !== 'POST') {
      return json({ error: 'POST required' }, 405);
    }
    const body = await readBody(req);
    if (!body) return json({ error: 'expected request body' }, 400);
    let payload = null;
    try {
      payload = JSON.parse(body.toString());
    } catch {
      return json({ error: 'expected JSON body' }, 400);
    }

    try {
      const result = await runIntelligenceJob(
        'run-replay',
        {
          frames: Array.isArray(payload?.frames) ? payload.frames : undefined,
          frameLoadOptions: payload?.frameLoadOptions || {},
          options: payload?.options || {},
        },
        context,
        Number(payload?.timeoutMs) > 0 ? Number(payload.timeoutMs) : 10 * 60_000,
      );
      if (payload?.archive !== false && result?.run) {
        await archiveReplayRunToDuckDb(result.run, context);
      }
      let postgresSyncResult = null;
      if (payload?.postgresSync && payload?.pgConfig && result?.run) {
        postgresSyncResult = await runIntelligenceJob(
          'postgres-upsert-run',
          { config: payload.pgConfig, run: result.run },
          context,
          60_000,
        );
      }
      return json({ ...result, postgresSyncResult }, 200);
    } catch (error) {
      return json({ ok: false, error: String(error?.message || 'historical replay failed') }, 502);
    }
  }

  if (requestUrl.pathname === '/api/local-intelligence-walk-forward') {
    if (req.method !== 'POST') {
      return json({ error: 'POST required' }, 405);
    }
    const body = await readBody(req);
    if (!body) return json({ error: 'expected request body' }, 400);
    let payload = null;
    try {
      payload = JSON.parse(body.toString());
    } catch {
      return json({ error: 'expected JSON body' }, 400);
    }

    try {
      const result = await runIntelligenceJob(
        'run-walk-forward',
        {
          frames: Array.isArray(payload?.frames) ? payload.frames : undefined,
          frameLoadOptions: payload?.frameLoadOptions || {},
          options: payload?.options || {},
        },
        context,
        Number(payload?.timeoutMs) > 0 ? Number(payload.timeoutMs) : 15 * 60_000,
      );
      if (payload?.archive !== false && result?.run) {
        await archiveReplayRunToDuckDb(result.run, context);
      }
      let postgresSyncResult = null;
      if (payload?.postgresSync && payload?.pgConfig && result?.run) {
        postgresSyncResult = await runIntelligenceJob(
          'postgres-upsert-run',
          { config: payload.pgConfig, run: result.run },
          context,
          60_000,
        );
      }
      return json({ ...result, postgresSyncResult }, 200);
    } catch (error) {
      return json(
        { ok: false, error: String(error?.message || 'walk-forward replay failed') },
        502,
      );
    }
  }

  if (requestUrl.pathname === '/api/local-intelligence-backtest-runs') {
    if (req.method !== 'GET') {
      return json({ error: 'GET required' }, 405);
    }
    const storage = String(requestUrl.searchParams.get('storage') || 'local').trim().toLowerCase();
    const limit = Number(requestUrl.searchParams.get('limit') || 20);
    const runId = String(requestUrl.searchParams.get('runId') || '').trim();
    try {
      if (storage === 'postgres') {
        if (runId) {
          const result = await runIntelligenceJob(
            'postgres-get-run',
            {
              config: null,
              runId,
            },
            context,
            60_000,
          );
          return json(result, result?.found ? 200 : 404);
        }
        const result = await runIntelligenceJob(
          'postgres-list-runs',
          { config: null, limit },
          context,
          60_000,
        );
        return json(result, 200);
      }

      if (runId) {
        const run = await getReplayRunFromDuckDb(runId, context);
        return json({ ok: true, run, found: Boolean(run) }, run ? 200 : 404);
      }
      const runs = await listReplayRunsFromDuckDb(limit, context);
      return json({ ok: true, runs }, 200);
    } catch (error) {
      return json({ ok: false, error: String(error?.message || 'backtest read failed') }, 502);
    }
  }

  if (requestUrl.pathname === '/api/local-intelligence-postgres') {
    if (req.method !== 'POST') {
      return json({ error: 'POST required' }, 405);
    }
    const body = await readBody(req);
    if (!body) return json({ error: 'expected request body' }, 400);
    let payload = null;
    try {
      payload = JSON.parse(body.toString());
    } catch {
      return json({ error: 'expected JSON body' }, 400);
    }
    const action = String(payload?.action || '').trim().toLowerCase();
    try {
      if (action === 'init') {
        const result = await runIntelligenceJob(
          'postgres-init',
          { config: payload?.config || null },
          context,
          60_000,
        );
        return json(result, 200);
      }
      if (action === 'status') {
        const result = await runIntelligenceJob(
          'postgres-status',
          { config: payload?.config || null },
          context,
          60_000,
        );
        return json(result, 200);
      }
      return json({ error: 'unsupported action' }, 422);
    } catch (error) {
      return json({ ok: false, error: String(error?.message || 'postgres action failed') }, 502);
    }
  }

  const expectedToken = process.env.LOCAL_API_TOKEN;
  if (expectedToken) {
    const authHeader = req.headers.authorization || '';
    if (authHeader !== `Bearer ${expectedToken}`) {
      context.logger.warn(`[local-api] unauthorized request to ${requestUrl.pathname}`);
      return json({ error: 'Unauthorized' }, 401);
    }
  }

  if (requestUrl.pathname === '/api/local-env-update') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (body) {
        try {
          const { key, value } = JSON.parse(body.toString());
          if (typeof key === 'string' && key.length > 0 && ALLOWED_ENV_KEYS.has(key)) {
            if (value == null || value === '') {
              delete process.env[key];
              context.logger.log(`[local-api] env unset: ${key}`);
            } else {
              process.env[key] = String(value);
              context.logger.log(`[local-api] env set: ${key}`);
            }
            moduleCache.clear();
            failedImports.clear();
            cloudPreferred.clear();
            return json({ ok: true, key });
          }
          return json({ error: 'key not in allowlist' }, 403);
        } catch { /* bad JSON */ }
      }
      return json({ error: 'expected { key, value }' }, 400);
    }
    return json({ error: 'POST required' }, 405);
  }

  if (requestUrl.pathname === '/api/local-validate-secret') {
    if (req.method !== 'POST') {
      return json({ error: 'POST required' }, 405);
    }
    const body = await readBody(req);
    if (!body) return json({ error: 'expected { key, value }' }, 400);
    try {
      const { key, value, context } = JSON.parse(body.toString());
      if (typeof key !== 'string' || !ALLOWED_ENV_KEYS.has(key)) {
        return json({ error: 'key not in allowlist' }, 403);
      }
      const safeContext = (context && typeof context === 'object') ? context : {};
      const result = await validateSecretAgainstProvider(key, value, safeContext);
      return json(result, result.valid ? 200 : 422);
    } catch {
      return json({ error: 'expected { key, value }' }, 400);
    }
  }

  if (context.cloudFallback && cloudPreferred.has(requestUrl.pathname)) {
    const cloudResponse = await tryCloudFallback(requestUrl, req, context);
    if (cloudResponse) return cloudResponse;
  }

  const modulePath = pickModule(requestUrl.pathname, routes);
  if (!modulePath || !existsSync(modulePath)) {
    if (context.cloudFallback) {
      const cloudResponse = await tryCloudFallback(requestUrl, req, context, 'handler missing');
      if (cloudResponse) return cloudResponse;
    }
    logOnce(context.logger, requestUrl.pathname, 'no local handler');
    return json({ error: 'No local handler for this endpoint', endpoint: requestUrl.pathname }, 404);
  }

  try {
    const mod = await importHandler(modulePath);
    if (typeof mod.default !== 'function') {
      logOnce(context.logger, requestUrl.pathname, 'invalid handler module');
      if (context.cloudFallback) {
        const cloudResponse = await tryCloudFallback(requestUrl, req, context, `invalid handler module`);
        if (cloudResponse) return cloudResponse;
      }
      return json({ error: 'Invalid handler module', endpoint: requestUrl.pathname }, 500);
    }

    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
    const request = new Request(requestUrl.toString(), {
      method: req.method,
      headers: toHeaders(req.headers, { stripOrigin: true }),
      body,
    });

    const response = await mod.default(request);
    if (!(response instanceof Response)) {
      logOnce(context.logger, requestUrl.pathname, 'handler returned non-Response');
      if (context.cloudFallback) {
        const cloudResponse = await tryCloudFallback(requestUrl, req, context, 'handler returned non-Response');
        if (cloudResponse) return cloudResponse;
      }
      return json({ error: 'Handler returned invalid response', endpoint: requestUrl.pathname }, 500);
    }

    if (!response.ok && context.cloudFallback) {
      const cloudResponse = await tryCloudFallback(requestUrl, req, context, `local status ${response.status}`);
      if (cloudResponse) { cloudPreferred.add(requestUrl.pathname); return cloudResponse; }
    }

    return response;
  } catch (error) {
    const reason = error.code === 'ERR_MODULE_NOT_FOUND' ? 'missing dependency' : error.message;
    context.logger.error(`[local-api] ${requestUrl.pathname} → ${reason}`);
    if (context.cloudFallback) {
      const cloudResponse = await tryCloudFallback(requestUrl, req, context, error);
      if (cloudResponse) { cloudPreferred.add(requestUrl.pathname); return cloudResponse; }
    }
    return json({ error: 'Local handler error', reason, endpoint: requestUrl.pathname }, 502);
  }
}

export async function createLocalApiServer(options = {}) {
  const context = resolveConfig(options);
  loadVerboseState(context.dataDir);
  const routes = await buildRouteTable(context.apiDir);

  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${context.port}`);

    if (!requestUrl.pathname.startsWith('/api/')) {
      res.writeHead(404, { 'content-type': 'application/json', ...makeCorsHeaders(req) });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const start = Date.now();
    const skipRecord = req.method === 'OPTIONS'
      || requestUrl.pathname === '/api/local-resource-stats'
      || requestUrl.pathname === '/api/local-traffic-log'
      || requestUrl.pathname === '/api/local-debug-toggle'
      || requestUrl.pathname === '/api/local-env-update'
      || requestUrl.pathname === '/api/local-validate-secret'
      || requestUrl.pathname === '/api/local-codex-status'
      || requestUrl.pathname === '/api/local-codex-summarize'
      || requestUrl.pathname === '/api/local-codex-candidate-expansion'
      || requestUrl.pathname === '/api/local-source-discover'
      || requestUrl.pathname === '/api/local-source-hunt'
      || requestUrl.pathname === '/api/local-api-source-hunt'
      || requestUrl.pathname === '/api/local-entity-resolve'
      || requestUrl.pathname === '/api/local-multimodal-extract'
      || requestUrl.pathname === '/api/local-ollama-chat'
      || requestUrl.pathname === '/api/local-intelligence-archive'
      || requestUrl.pathname === '/api/local-intelligence-import'
      || requestUrl.pathname === '/api/local-intelligence-replay'
      || requestUrl.pathname === '/api/local-intelligence-walk-forward'
      || requestUrl.pathname === '/api/local-intelligence-backtest-runs'
      || requestUrl.pathname === '/api/local-intelligence-postgres';

    try {
      const response = await dispatch(requestUrl, req, routes, context);
      const durationMs = Date.now() - start;
      let body = Buffer.from(await response.arrayBuffer());
      const headers = Object.fromEntries(response.headers.entries());
      const corsOrigin = getSidecarCorsOrigin(req);
      headers['access-control-allow-origin'] = corsOrigin;
      headers['vary'] = appendVary(headers['vary'], 'Origin');

      if (!skipRecord) {
        recordTraffic({
          timestamp: new Date().toISOString(),
          method: req.method,
          path: requestUrl.pathname + (requestUrl.search || ''),
          status: response.status,
          durationMs,
        });
      }

      const acceptEncoding = req.headers['accept-encoding'] || '';
      body = await maybeCompressResponseBody(body, headers, acceptEncoding);

      if (headers['content-encoding']) {
        delete headers['content-length'];
      }

      res.writeHead(response.status, headers);
      res.end(body);
    } catch (error) {
      const durationMs = Date.now() - start;
      context.logger.error('[local-api] fatal', error);

      if (!skipRecord) {
        recordTraffic({
          timestamp: new Date().toISOString(),
          method: req.method,
          path: requestUrl.pathname + (requestUrl.search || ''),
          status: 500,
          durationMs,
          error: error.message,
        });
      }

      res.writeHead(500, { 'content-type': 'application/json', ...makeCorsHeaders(req) });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });

  return {
    context,
    routes,
    server,
    async start() {
      const tryListen = (port) => new Promise((resolve, reject) => {
        const onListening = () => { server.off('error', onError); resolve(); };
        const onError = (error) => { server.off('listening', onListening); reject(error); };
        server.once('listening', onListening);
        server.once('error', onError);
        server.listen(port, '127.0.0.1');
      });

      try {
        await tryListen(context.port);
      } catch (err) {
        if (err?.code === 'EADDRINUSE') {
          context.logger.log(`[local-api] port ${context.port} busy, falling back to OS-assigned port`);
          await tryListen(0);
        } else {
          throw err;
        }
      }

      const address = server.address();
      const boundPort = typeof address === 'object' && address?.port ? address.port : context.port;
      context.port = boundPort;

      const portFile = process.env.LOCAL_API_PORT_FILE;
      if (portFile) {
        try { writeFileSync(portFile, String(boundPort)); } catch {}
      }

      context.logger.log(`[local-api] listening on http://127.0.0.1:${boundPort} (apiDir=${context.apiDir}, routes=${routes.length}, cloudFallback=${context.cloudFallback})`);
      return { port: boundPort };
    },
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

if (isMainModule()) {
  try {
    const app = await createLocalApiServer();
    await app.start();
  } catch (error) {
    console.error('[local-api] startup failed', error);
    process.exit(1);
  }
}
