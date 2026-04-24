#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { SIGNAL_STALE_THRESHOLD_HOURS } from './_shared/dashboard-signal-quality.mjs';

const { Pool } = pg;

const DEFAULT_SIGNALS = [
  'vix',
  'yieldSpread',
  'oilPrice',
  'dollarIndex',
  'hy_credit_spread',
  'marketStress',
  'transmissionStrength',
];

const TIMESTAMP_KEYS = new Set([
  'updatedAt',
  'updated_at',
  'dataUpdatedAt',
  'sourceUpdatedAt',
  'generatedAt',
  'createdAt',
  'created_at',
  'publishedAt',
  'published_at',
  'fetchedAt',
  'lastRunAt',
  'last_run_at',
  'ts',
  'date',
]);

const DEFAULT_ACTIVE_CACHE_TTL_MS = 60 * 60 * 1000;

function activeCacheTtlHours() {
  const raw = Number(process.env.DASHBOARD_CACHE_FALLBACK_TTL_MS || DEFAULT_ACTIVE_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw > 0
    ? raw / 36e5
    : DEFAULT_ACTIVE_CACHE_TTL_MS / 36e5;
}

function auditDateToken(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function toIso(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  return null;
}

function ageHours(iso, now = new Date()) {
  const ts = Date.parse(iso || '');
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (now.getTime() - ts) / 36e5);
}

function collectTimestamps(value, keys = TIMESTAMP_KEYS, max = 2000) {
  const out = [];
  const seen = new Set();
  const walk = (node, keyHint = '', depth = 0) => {
    if (out.length >= max || depth > 8 || node == null) return;
    if (typeof node === 'string' || typeof node === 'number' || node instanceof Date) {
      if (keys.has(keyHint)) {
        const iso = toIso(node);
        if (iso && !seen.has(`${keyHint}:${iso}`)) {
          seen.add(`${keyHint}:${iso}`);
          out.push({ key: keyHint, value: iso });
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 500)) walk(item, keyHint, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) walk(child, key, depth + 1);
    }
  };
  walk(value);
  return out;
}

function latestTimestamp(value) {
  const stamps = collectTimestamps(value)
    .map((entry) => entry.value)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return stamps[0] || null;
}

function repeatedRun(rows, valueKey = 'value') {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { repeatedCount: 0, latestValue: null, mirrored: false };
  }
  const latestValue = rows[0]?.[valueKey];
  let repeatedCount = 0;
  for (const row of rows) {
    if (Object.is(Number(row?.[valueKey]), Number(latestValue))) repeatedCount += 1;
    else break;
  }
  return {
    repeatedCount,
    latestValue,
    mirrored: repeatedCount >= 6,
  };
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listJsonFiles(root, limit = 3000) {
  const files = [];
  async function walk(dir) {
    if (!(await exists(dir))) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) files.push(full);
    }
  }
  await walk(root);
  const withStats = await Promise.all(files.map(async (file) => {
    try {
      const stat = await fs.stat(file);
      return { file, mtimeMs: stat.mtimeMs };
    } catch {
      return { file, mtimeMs: 0 };
    }
  }));
  return withStats
    .sort((left, right) => right.mtimeMs - left.mtimeMs || left.file.localeCompare(right.file))
    .slice(0, limit)
    .map((entry) => entry.file);
}

async function readJsonFile(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

function isLegacyCacheArtifact(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (name.includes('--since-')) return true;
  if (/^theme-brief--.+--(?:week|month|quarter|year)--\d+--\d+\.json$/i.test(name)) return true;
  if (/^followed-theme-briefing--.+--(?:week|month|quarter|year)--\d+\.json$/i.test(name)) return true;
  return false;
}

function cacheTimestampMismatch(filePath, payload, now) {
  const meta = payload?.meta || {};
  const generatedAt = toIso(meta.generatedAt || payload?.generatedAt || meta.updatedAt || payload?.updatedAt);
  const dataUpdatedAt = toIso(meta.dataUpdatedAt || meta.sourceUpdatedAt || payload?.dataUpdatedAt);
  const inferredLatest = latestTimestamp(payload);
  const dataTime = dataUpdatedAt || inferredLatest;
  const generatedAge = ageHours(generatedAt, now);
  const dataAge = ageHours(dataTime, now);
  const mismatchHours = Number.isFinite(generatedAge) && Number.isFinite(dataAge)
    ? dataAge - generatedAge
    : null;
  const explicitlyMarkedStale = Boolean(meta.stale === true || payload?.stale === true);
  const activeCacheArtifact = Boolean(!Number.isFinite(generatedAge) || generatedAge <= activeCacheTtlHours());
  const staleFalsePositive = Boolean(
    activeCacheArtifact
      && !explicitlyMarkedStale
      && meta.stale === false
      && Number.isFinite(dataAge)
      && dataAge > 48,
  );
  const wrapperMasksData = Boolean(
    activeCacheArtifact
      && !explicitlyMarkedStale
      && Number.isFinite(mismatchHours)
      && mismatchHours > 24,
  );
  return {
    file: path.relative(process.cwd(), filePath).replace(/\\/g, '/'),
    generatedAt,
    dataUpdatedAt,
    inferredLatest,
    generatedAgeHours: generatedAge,
    dataAgeHours: dataAge,
    mismatchHours,
    explicitlyMarkedStale,
    activeCacheArtifact,
    staleFalsePositive,
    wrapperMasksData,
  };
}

export async function auditCacheFreshness({ cwd = process.cwd(), now = new Date() } = {}) {
  const cacheRoot = path.join(cwd, 'data', 'event-dashboard-cache');
  const files = await listJsonFiles(cacheRoot);
  const items = [];
  for (const file of files) {
    if (isLegacyCacheArtifact(file)) continue;
    try {
      const payload = await readJsonFile(file);
      const result = cacheTimestampMismatch(file, payload, now);
      if (result.staleFalsePositive || result.wrapperMasksData) items.push(result);
    } catch (error) {
      items.push({
        file: path.relative(cwd, file).replace(/\\/g, '/'),
        error: String(error?.message || error),
      });
    }
  }
  return {
    checkedFiles: files.length,
    issues: items.sort((a, b) => Number(b.dataAgeHours || 0) - Number(a.dataAgeHours || 0)).slice(0, 200),
  };
}

export async function auditBackfillState({ cwd = process.cwd(), now = new Date() } = {}) {
  const candidates = [
    path.join(cwd, 'data', 'historical', 'accumulator-state.json'),
    path.join(cwd, 'data', 'arxiv-backfill-state.json'),
    path.join(cwd, 'data', 'hn-backfill-state.json'),
  ];
  const stateFiles = [];
  for (const file of candidates) {
    if (!(await exists(file))) continue;
    try {
      const payload = await readJsonFile(file);
      const latest = latestTimestamp(payload);
      stateFiles.push({
        file: path.relative(cwd, file).replace(/\\/g, '/'),
        latestTimestamp: latest,
        ageHours: ageHours(latest, now),
        stale: Number(ageHours(latest, now)) > 48,
      });
    } catch (error) {
      stateFiles.push({
        file: path.relative(cwd, file).replace(/\\/g, '/'),
        error: String(error?.message || error),
      });
    }
  }

  const automationRoot = path.join(cwd, 'data', 'historical', 'automation');
  const automationFiles = await listJsonFiles(automationRoot, 1000);
  let latestAutomationAt = null;
  let latestAutomationFile = null;
  for (const file of automationFiles) {
    try {
      const latest = latestTimestamp(await readJsonFile(file));
      if (latest && (!latestAutomationAt || Date.parse(latest) > Date.parse(latestAutomationAt))) {
        latestAutomationAt = latest;
        latestAutomationFile = file;
      }
    } catch {
      // Ignore individual malformed historical artifacts; cache audit reports parse errors separately.
    }
  }

  return {
    stateFiles,
    automation: {
      checkedFiles: automationFiles.length,
      latestTimestamp: latestAutomationAt,
      latestFile: latestAutomationFile ? path.relative(cwd, latestAutomationFile).replace(/\\/g, '/') : null,
      ageHours: ageHours(latestAutomationAt, now),
      stale: Number(ageHours(latestAutomationAt, now)) > 48,
    },
  };
}

async function tableExists(pool, tableName) {
  const result = await pool.query('SELECT to_regclass($1) AS name', [tableName]);
  return Boolean(result.rows?.[0]?.name);
}

async function tableColumns(pool, tableName) {
  const result = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1`,
    [tableName],
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function auditArticles(pool) {
  if (!(await tableExists(pool, 'articles'))) return { exists: false };
  const result = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      MAX(published_at) AS latest_published_at,
      COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '24 hours')::int AS count_24h,
      COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '72 hours')::int AS count_72h,
      COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '7 days')::int AS count_7d
    FROM articles
  `);
  const row = result.rows[0] || {};
  return {
    exists: true,
    total: Number(row.total || 0),
    latestPublishedAt: toIso(row.latest_published_at),
    count24h: Number(row.count_24h || 0),
    count72h: Number(row.count_72h || 0),
    count7d: Number(row.count_7d || 0),
    issue: Number(row.count_24h || 0) === 0 || Number(row.count_72h || 0) === 0
      ? 'articles have no 24h/72h rows'
      : null,
  };
}

async function auditSignalHistory(pool, now) {
  if (!(await tableExists(pool, 'signal_history'))) return { exists: false };
  const signals = [];
  for (const signalName of DEFAULT_SIGNALS) {
    const result = await pool.query(
      `SELECT signal_name, ts, value
         FROM signal_history
        WHERE signal_name = $1
        ORDER BY ts DESC
        LIMIT 48`,
      [signalName],
    );
    const rows = result.rows.map((row) => ({
      signalName: row.signal_name,
      ts: toIso(row.ts),
      value: Number(row.value),
    }));
    const latest = rows[0] || null;
    const run = repeatedRun(rows);
    signals.push({
      signalName,
      rowCountSampled: rows.length,
      latestTs: latest?.ts || null,
      latestValue: latest?.value ?? null,
      ageHours: ageHours(latest?.ts, now),
      maxAgeHours: SIGNAL_STALE_THRESHOLD_HOURS[signalName] ?? 48,
      repeatedCount: run.repeatedCount,
      mirrored: run.mirrored,
    });
  }
  return {
    exists: true,
    signals,
    mirroredSignals: signals.filter((signal) => signal.mirrored).map((signal) => signal.signalName),
  };
}

async function auditGenericTable(pool, tableName) {
  if (!(await tableExists(pool, tableName))) return { exists: false };
  const columns = await tableColumns(pool, tableName);
  const timestampColumn = ['updated_at', 'created_at', 'ts', 'published_at', 'event_date', 'date']
    .find((column) => columns.has(column));
  const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM ${tableName}`);
  const payload = {
    exists: true,
    total: Number(countResult.rows?.[0]?.total || 0),
    timestampColumn,
    latestTimestamp: null,
  };
  if (timestampColumn) {
    const latest = await pool.query(`SELECT MAX(${timestampColumn}) AS latest_ts FROM ${tableName}`);
    payload.latestTimestamp = toIso(latest.rows?.[0]?.latest_ts);
  }
  return payload;
}

export async function auditNasFreshness({ now = new Date(), envFile = '.env.local' } = {}) {
  loadOptionalEnvFile(envFile);
  let pool;
  try {
    pool = new Pool({ ...resolveNasPgConfig(), max: 2 });
  } catch (error) {
    return {
      connected: false,
      error: String(error?.message || error),
    };
  }

  try {
    const serverTime = await pool.query('SELECT NOW() AS server_time');
    const [articles, signalHistory, eventUplift, themeEvolution] = await Promise.all([
      auditArticles(pool),
      auditSignalHistory(pool, now),
      auditGenericTable(pool, 'event_uplift'),
      auditGenericTable(pool, 'theme_evolution'),
    ]);
    return {
      connected: true,
      serverTime: toIso(serverTime.rows?.[0]?.server_time),
      articles,
      signalHistory,
      eventUplift,
      themeEvolution,
    };
  } catch (error) {
    return {
      connected: false,
      error: String(error?.message || error),
    };
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function buildFreshnessAudit(options = {}) {
  const cwd = options.cwd || process.cwd();
  const now = options.now || new Date();
  const [cache, backfill, nas] = await Promise.all([
    auditCacheFreshness({ cwd, now }),
    auditBackfillState({ cwd, now }),
    auditNasFreshness({ now, envFile: options.envFile || '.env.local' }),
  ]);

  const findings = [];
  if (nas?.articles?.issue) {
    findings.push({ priority: 'P0', area: 'articles', issue: nas.articles.issue });
  }
  for (const signal of nas?.signalHistory?.signals || []) {
    if (signal.mirrored) {
      findings.push({
        priority: 'P0',
        area: 'signal_history',
        issue: `${signal.signalName} latest value repeats ${signal.repeatedCount} rows`,
      });
    }
    if (Number(signal.ageHours) > Number(signal.maxAgeHours || 48)) {
      findings.push({
        priority: 'P1',
        area: 'signal_history',
        issue: `${signal.signalName} latest timestamp is ${Math.round(signal.ageHours)}h old (threshold ${signal.maxAgeHours}h)`,
      });
    }
  }
  for (const file of backfill.stateFiles || []) {
    if (file.stale) {
      findings.push({
        priority: 'P0',
        area: 'backfill',
        issue: `${file.file} is ${Math.round(file.ageHours)}h old`,
      });
    }
  }
  if (backfill.automation?.stale) {
    findings.push({
      priority: 'P0',
      area: 'backfill',
      issue: `historical automation latest artifact is ${Math.round(backfill.automation.ageHours)}h old`,
    });
  }
  if (cache.issues?.length) {
    findings.push({
      priority: 'P1',
      area: 'cache',
      issue: `${cache.issues.length} cache artifact(s) have stale false positives or wrapper/data mismatch`,
    });
  }

  return {
    generatedAt: now.toISOString(),
    cwd,
    summary: {
      findings: findings.length,
      cacheIssues: cache.issues?.length || 0,
      mirroredSignals: nas?.signalHistory?.mirroredSignals || [],
      articleCount24h: nas?.articles?.count24h ?? null,
      articleCount72h: nas?.articles?.count72h ?? null,
      backfillStateFiles: backfill.stateFiles?.length || 0,
    },
    findings,
    nas,
    backfill,
    cache,
  };
}

async function main() {
  const cwd = process.cwd();
  const now = new Date();
  const audit = await buildFreshnessAudit({ cwd, now });
  const outDir = path.join(cwd, 'data', 'audits');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `data-freshness-${auditDateToken(now)}.json`);
  await fs.writeFile(outPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    output: path.relative(cwd, outPath).replace(/\\/g, '/'),
    findings: audit.summary.findings,
    mirroredSignals: audit.summary.mirroredSignals,
    articleCount24h: audit.summary.articleCount24h,
    articleCount72h: audit.summary.articleCount72h,
    cacheIssues: audit.summary.cacheIssues,
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
