#!/usr/bin/env node

const DEFAULT_DASHBOARD_BASE = 'http://127.0.0.1:46200';
const DEFAULT_SIDECAR_BASE = 'http://127.0.0.1:46123';
const DEFAULT_TIMEOUT_MS = 10_000;

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
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
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function trimPreview(value, limit = 240) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function resolveBase(args, key, fallback) {
  const value = String(args[key] || '').trim();
  return value || fallback;
}

async function fetchJson(name, baseUrl, pathname, { method = 'GET', body = null, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} } = {}) {
  const url = new URL(pathname, baseUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    let response;
    try {
      response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body,
      });
    } catch (error) {
      throw new Error(`${name} fetch failed for ${url}: ${String(error?.message || error)}`);
    }
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`${name} returned non-JSON payload: ${trimPreview(text)}`);
    }
    return {
      name,
      url,
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      json,
      preview: trimPreview(json),
    };
  } finally {
    clearTimeout(timer);
  }
}

function requireObject(result) {
  if (!result.json || typeof result.json !== 'object') {
    throw new Error(`${result.name} returned an empty or invalid JSON object`);
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const dashboardBase = resolveBase(args, 'dashboard-base', DEFAULT_DASHBOARD_BASE);
  const sidecarBase = resolveBase(args, 'sidecar-base', DEFAULT_SIDECAR_BASE);
  const timeoutMs = Number(args['timeout-ms'] || args.timeout || DEFAULT_TIMEOUT_MS);
  const themeBriefId = String(args['theme-brief-id'] || '').trim();
  const sidecarToken = String(args['sidecar-token'] || '').trim();
  const skipDashboard = Boolean(args['skip-dashboard']);
  const skipSidecar = Boolean(args['skip-sidecar']);
  if (skipDashboard && skipSidecar) {
    throw new Error('At least one of dashboard or sidecar must be checked');
  }
  const results = [];

  if (!skipDashboard) {
    const dashboardChecks = [
      ['/api/health', 'health'],
      ['/api/kpi-summary', 'kpi-summary'],
      ['/api/live-status', 'live-status'],
      ['/api/signals', 'signals'],
      ['/api/data-quality', 'data-quality'],
      ['/api/data-freshness-audit', 'data-freshness-audit'],
      ['/api/automation-budget', 'automation-budget'],
      ['/api/proposal-inbox', 'proposal-inbox'],
      ['/api/approval-queue', 'approval-queue'],
      ['/api/discovery-triage', 'discovery-triage'],
    ];

    for (const [pathname, label] of dashboardChecks) {
      const result = await fetchJson(label, dashboardBase, pathname, { timeoutMs });
      requireObject(result);
      results.push(result);
    }
  }

  if (!skipDashboard && themeBriefId) {
    const result = await fetchJson('theme-brief', dashboardBase, `/api/theme-brief/${encodeURIComponent(themeBriefId)}`, { timeoutMs });
    requireObject(result);
    results.push(result);
  }

  if (!skipSidecar) {
    const sidecarChecks = [
      ['/api/local-runtime-observability', 'local-runtime-observability'],
      ['/api/local-automation-ops-snapshot', 'local-automation-ops-snapshot'],
    ];

    for (const [pathname, label] of sidecarChecks) {
      const result = await fetchJson(label, sidecarBase, pathname, {
        timeoutMs,
        headers: sidecarToken ? { Authorization: `Bearer ${sidecarToken}` } : {},
      });
      requireObject(result);
      results.push(result);
    }
  }

  for (const result of results) {
    process.stdout.write(`[ok] ${result.name} ${result.status} ${result.url}\n`);
    process.stdout.write(`     ${result.preview}\n`);
  }

  process.stdout.write(`\nValidated ${results.length} read-only endpoints.\n`);
}

run().catch((error) => {
  process.stderr.write(`[smoke-check] ${String(error?.stack || error?.message || error)}\n`);
  process.exitCode = 1;
});
