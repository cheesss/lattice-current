#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { CHROME_UA, sleep } from './_seed-utils.mjs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { writeSignalHistoryRow, SIGNAL_ORIGIN } from './_shared/signal-history-writer.mjs';

const { Pool } = pg;

const FRED_CANONICAL_SIGNAL_NAMES = new Set([
  'yieldSpread',
  'hy_credit_spread',
  'ig_credit_spread',
]);

export const DEFAULT_FRED_SERIES = [
  { id: 'T10Y2Y', signal: 'yieldSpread' },
  { id: 'BAMLH0A0HYM2', signal: 'hy_credit_spread' },
  { id: 'BAMLC0A0CM', signal: 'ig_credit_spread' },
  { id: 'DGS10', signal: 'treasury10y' },
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [rawKey, inlineValue] = token.slice(2).split('=');
    if (inlineValue != null) {
      args[rawKey] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[rawKey] = true;
    else {
      args[rawKey] = next;
      i += 1;
    }
  }
  return args;
}

function defaultFromDate() {
  const date = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function asFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export function parseFredCsv(csvText, { seriesId, signalName }) {
  const rows = [];
  const lines = String(csvText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.slice(1)) {
    const [date, rawValue] = line.split(',');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '').trim())) continue;
    if (rawValue === '.') continue;
    const value = asFiniteNumber(rawValue);
    if (value == null) continue;
    rows.push({
      seriesId,
      signalName,
      observationDate: date,
      value,
    });
  }
  return rows;
}

export function latestFredObservation(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows.reduce((latest, row) => (
    !latest || String(row.observationDate) > String(latest.observationDate) ? row : latest
  ), null);
}

export function computeDerivedMarketStress({ vix, hyCreditSpread, yieldSpread }) {
  const vixValue = asFiniteNumber(vix);
  const hyValue = asFiniteNumber(hyCreditSpread);
  const spreadValue = asFiniteNumber(yieldSpread);
  if (vixValue == null || hyValue == null || spreadValue == null) return null;

  const vixComponent = clamp((vixValue - 12) / 28);
  const creditComponent = clamp((hyValue - 2.5) / 5);
  const inversionComponent = clamp((0 - spreadValue) / 1.5);
  const stress = (vixComponent * 0.5) + (creditComponent * 0.35) + (inversionComponent * 0.15);
  return Number(stress.toFixed(4));
}

async function fetchFredSeries(series, { fromDate } = {}) {
  const params = new URLSearchParams({ id: series.id });
  if (fromDate) params.set('cosd', fromDate);
  const response = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?${params.toString()}`, {
    headers: { 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`FRED ${series.id} HTTP ${response.status}`);
  }
  return parseFredCsv(await response.text(), {
    seriesId: series.id,
    signalName: series.signal,
  });
}

export async function fetchFredSignals(seriesList = DEFAULT_FRED_SERIES, options = {}) {
  const fromDate = options.fromDate || defaultFromDate();
  const delayMs = Number(options.delayMs ?? 600);
  const observations = [];
  const latest = [];
  const errors = [];
  for (let index = 0; index < seriesList.length; index += 1) {
    const series = seriesList[index];
    if (index > 0 && delayMs > 0) await sleep(delayMs);
    try {
      const rows = await fetchFredSeries(series, { fromDate });
      observations.push(...rows);
      const latestRow = latestFredObservation(rows);
      if (latestRow) latest.push(latestRow);
      else errors.push({ seriesId: series.id, error: 'empty FRED observation payload' });
    } catch (error) {
      errors.push({ seriesId: series.id, error: String(error?.message || error) });
    }
  }
  return { observations, latest, errors, fromDate };
}

async function ensureFredSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fred_observations (
      series_id text NOT NULL,
      signal_name text NOT NULL,
      observation_date date NOT NULL,
      value double precision NOT NULL,
      fetched_at timestamptz NOT NULL DEFAULT NOW(),
      provider text NOT NULL DEFAULT 'fred-csv',
      PRIMARY KEY (series_id, observation_date)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fred_observations_signal_date
      ON fred_observations (signal_name, observation_date DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS signal_history (
      signal_name text NOT NULL,
      ts timestamptz NOT NULL,
      value double precision NOT NULL,
      PRIMARY KEY (signal_name, ts)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_signal_history_name_ts
      ON signal_history (signal_name, ts DESC)
  `);
}

async function deriveAndWriteMarketStress(pool) {
  const result = await pool.query(`
    SELECT DISTINCT ON (signal_name) signal_name, ts, value
    FROM signal_history
    WHERE signal_name = ANY($1::text[])
    ORDER BY signal_name, ts DESC
  `, [['vix', 'hy_credit_spread', 'yieldSpread']]);
  const latest = new Map(result.rows.map((row) => [String(row.signal_name), row]));
  const stress = computeDerivedMarketStress({
    vix: latest.get('vix')?.value,
    hyCreditSpread: latest.get('hy_credit_spread')?.value,
    yieldSpread: latest.get('yieldSpread')?.value,
  });
  if (stress == null) return null;

  const componentDates = ['vix', 'hy_credit_spread', 'yieldSpread']
    .map((name) => latest.get(name)?.ts)
    .map((value) => (value ? new Date(value) : null))
    .filter((value) => value && Number.isFinite(value.valueOf()));
  if (!componentDates.length) return null;
  const observedAt = new Date(Math.min(...componentDates.map((value) => value.valueOf()))).toISOString();
  await writeSignalHistoryRow(pool, {
    signalName: 'marketStress',
    ts: observedAt,
    value: stress,
    valueOrigin: SIGNAL_ORIGIN.COMPOSITE,
    writerId: 'refresh-fred-marketstress-composite',
  });
  const pruned = await pool.query(`
    DELETE FROM signal_history
    WHERE signal_name = 'marketStress'
      AND ts > $1::timestamptz
  `, [observedAt]);
  return {
    signalName: 'marketStress',
    observedAt,
    value: stress,
    prunedFutureRows: Number(pruned.rowCount || 0),
  };
}

async function cleanupCopiedFredSignalRows(pool, signalNames, fromDate) {
  const cleanupSignals = [...new Set((signalNames || [])
    .filter((signalName) => FRED_CANONICAL_SIGNAL_NAMES.has(signalName)))];
  if (!cleanupSignals.length) return 0;
  const result = await pool.query(`
    DELETE FROM signal_history sh
    WHERE sh.signal_name = ANY($1::text[])
      AND sh.ts >= $2::date
      AND NOT EXISTS (
        SELECT 1
        FROM fred_observations fo
        WHERE fo.signal_name = sh.signal_name
          AND sh.ts = fo.observation_date::timestamptz
      )
  `, [cleanupSignals, fromDate || defaultFromDate()]);
  return Number(result.rowCount || 0);
}

export async function writeFredSignals(pool, fetched, { updateSignalHistory = true } = {}) {
  await ensureFredSchema(pool);
  const observations = Array.isArray(fetched?.observations) ? fetched.observations : [];
  const latest = Array.isArray(fetched?.latest) ? fetched.latest : [];
  const signalNames = [...new Set(latest.map((row) => row.signalName).filter(Boolean))];
  let observationCount = 0;
  for (const row of observations) {
    await pool.query(`
      INSERT INTO fred_observations (series_id, signal_name, observation_date, value, fetched_at, provider)
      VALUES ($1, $2, $3::date, $4, NOW(), 'fred-csv')
      ON CONFLICT (series_id, observation_date) DO UPDATE
        SET signal_name = EXCLUDED.signal_name,
            value = EXCLUDED.value,
            fetched_at = EXCLUDED.fetched_at,
            provider = EXCLUDED.provider
    `, [row.seriesId, row.signalName, row.observationDate, row.value]);
    observationCount += 1;
  }

  let signalCount = 0;
  if (updateSignalHistory) {
    for (const row of latest) {
      await writeSignalHistoryRow(pool, {
        signalName: row.signalName,
        ts: row.observationDate,
        value: row.value,
        valueOrigin: SIGNAL_ORIGIN.OBSERVED,
        writerId: 'refresh-fred-observations',
      });
      signalCount += 1;
    }
  }

  const prunedCopiedRows = updateSignalHistory
    ? await cleanupCopiedFredSignalRows(pool, signalNames, fetched?.fromDate)
    : 0;
  const derived = updateSignalHistory ? await deriveAndWriteMarketStress(pool) : null;
  return { observationCount, signalCount, prunedCopiedRows, derived };
}

export async function refreshFredSignalsToNas(options = {}) {
  loadOptionalEnvFile(options.envFile || '.env.local');
  const seriesList = Array.isArray(options.seriesList) && options.seriesList.length
    ? options.seriesList
    : DEFAULT_FRED_SERIES;
  const fetched = await fetchFredSignals(seriesList, options);
  if (!fetched.latest.length) {
    return {
      ok: false,
      written: { observationCount: 0, signalCount: 0, derived: null },
      errors: fetched.errors,
      error: 'no FRED observations fetched',
    };
  }
  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      fetched,
      written: { observationCount: 0, signalCount: 0, derived: null },
      errors: fetched.errors,
    };
  }
  const pool = new Pool({ ...resolveNasPgConfig(), max: 2 });
  try {
    const written = await writeFredSignals(pool, fetched, {
      updateSignalHistory: options.updateSignalHistory !== false,
    });
    return {
      ok: true,
      fromDate: fetched.fromDate,
      written,
      latest: fetched.latest,
      errors: fetched.errors,
    };
  } finally {
    await pool.end().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seriesList = args.series
    ? String(args.series).split(',').map((id) => {
      const trimmed = id.trim();
      return DEFAULT_FRED_SERIES.find((series) => series.id === trimmed || series.signal === trimmed)
        || { id: trimmed, signal: trimmed };
    }).filter((series) => series.id)
    : DEFAULT_FRED_SERIES;
  const result = await refreshFredSignalsToNas({
    seriesList,
    fromDate: args.from || args['from-date'] || defaultFromDate(),
    dryRun: Boolean(args['dry-run']),
    updateSignalHistory: args['skip-signal-history'] ? false : true,
    delayMs: args['delay-ms'] ? Number(args['delay-ms']) : undefined,
  });
  process.stdout.write(`${JSON.stringify({
    ok: result.ok,
    dryRun: Boolean(result.dryRun),
    fromDate: result.fromDate || result.fetched?.fromDate || null,
    observations: result.written?.observationCount || result.fetched?.observations?.length || 0,
    signals: result.written?.signalCount || result.fetched?.latest?.length || 0,
    prunedCopiedRows: result.written?.prunedCopiedRows || 0,
    derived: result.written?.derived || null,
    errors: result.errors || [],
  }, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
