#!/usr/bin/env node

import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    const eqIndex = body.indexOf('=');
    if (eqIndex >= 0) {
      parsed[body.slice(0, eqIndex)] = body.slice(eqIndex + 1);
      continue;
    }
    const next = String(argv[index + 1] || '').trim();
    if (next && !next.startsWith('--')) {
      parsed[body] = next;
      index += 1;
      continue;
    }
    parsed[body] = true;
  }
  return parsed;
}

function asNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asTs(value) {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? ts : 0;
}

function yearKey(value) {
  const iso = String(value || '');
  return iso.length >= 4 ? iso.slice(0, 4) : 'unknown';
}

function summarizeCoverage(frames) {
  const years = new Map();
  for (const frame of frames) {
    const year = yearKey(frame.timestamp || frame.validTimeStart || frame.transactionTime);
    const bucket = years.get(year) || {
      year,
      totalFrames: 0,
      newsFrames: 0,
      marketFrames: 0,
      newsAndMarketFrames: 0,
      clusterFrames: 0,
      firstTimestamp: null,
      lastTimestamp: null,
    };
    const hasNews = Array.isArray(frame.news) && frame.news.length > 0;
    const hasMarkets = Array.isArray(frame.markets) && frame.markets.length > 0;
    const hasClusters = Array.isArray(frame.clusters) && frame.clusters.length > 0;
    bucket.totalFrames += 1;
    if (hasNews) bucket.newsFrames += 1;
    if (hasMarkets) bucket.marketFrames += 1;
    if (hasNews && hasMarkets) bucket.newsAndMarketFrames += 1;
    if (hasClusters) bucket.clusterFrames += 1;
    bucket.firstTimestamp = bucket.firstTimestamp && asTs(bucket.firstTimestamp) < asTs(frame.timestamp)
      ? bucket.firstTimestamp
      : frame.timestamp;
    bucket.lastTimestamp = bucket.lastTimestamp && asTs(bucket.lastTimestamp) > asTs(frame.timestamp)
      ? bucket.lastTimestamp
      : frame.timestamp;
    years.set(year, bucket);
  }
  return Array.from(years.values()).sort((left, right) => left.year.localeCompare(right.year));
}

function assertCoverage(summary, expectedYears) {
  const byYear = new Map(summary.map((row) => [row.year, row]));
  const failures = [];
  for (const year of expectedYears) {
    const row = byYear.get(year);
    if (!row) {
      failures.push(`missing year ${year}`);
      continue;
    }
    if (row.totalFrames <= 0) failures.push(`year ${year} has no frames`);
    if (row.newsFrames <= 0) failures.push(`year ${year} has no news frames`);
    if (row.marketFrames <= 0) failures.push(`year ${year} has no market frames`);
  }
  return failures;
}

function summarizeWalkForward(run) {
  return {
    frameCount: run.frameCount,
    evaluationFrameCount: run.evaluationFrameCount,
    ideaRunCount: run.ideaRuns?.length || 0,
    forwardReturnCount: run.forwardReturns?.length || 0,
    lockedOosFrameCount: run.lockedOosSummary?.frameCount || 0,
    lockedOosIdeaRunCount: run.lockedOosSummary?.ideaRunCount || 0,
    lockedOosForwardReturnCount: run.lockedOosSummary?.forwardReturnCount || 0,
    promotionState: run.governance?.promotion?.state || null,
    promotionScore: run.governance?.promotion?.score ?? null,
    dsr: run.governance?.dsr?.deflatedSharpeRatio ?? null,
    pbo: run.governance?.pbo?.probability ?? null,
    summaryLines: Array.isArray(run.summaryLines) ? run.summaryLines.slice(0, 12) : [],
  };
}

function assertWalkForward(summary) {
  const failures = [];
  if (summary.frameCount <= 0) failures.push('walk-forward frameCount is 0');
  if (summary.evaluationFrameCount <= 0) failures.push('walk-forward evaluationFrameCount is 0');
  if (summary.ideaRunCount <= 0) failures.push('walk-forward ideaRunCount is 0');
  if (summary.forwardReturnCount <= 0) failures.push('walk-forward forwardReturnCount is 0');
  if (summary.lockedOosFrameCount <= 0) failures.push('locked OOS frameCount is 0');
  return failures;
}

async function main() {
  await loadOptionalEnvFile(path.resolve('.env.local'));
  const args = parseArgs(process.argv.slice(2));
  const start = String(args.start || '2020-01-01T00:00:00Z');
  const end = String(args.end || '2025-12-31T23:59:59Z');
  const walkStart = String(args['walk-start'] || args.walkStart || start);
  const walkEnd = String(args['walk-end'] || args.walkEnd || end);
  const outFile = args.out ? path.resolve(String(args.out)) : null;
  const expectedYears = String(args.years || '2020,2021,2022,2023,2024,2025')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const maxFrames = args['max-frames'] ? asNumber(args['max-frames'], undefined) : undefined;
  const walkMaxFrames = args['walk-max-frames'] ? asNumber(args['walk-max-frames'], undefined) : undefined;
  const foldCount = asNumber(args.folds || args.foldCount, 4);
  const holdoutRatio = asNumber(args['holdout-ratio'] || args.holdoutRatio, 0.2);
  const holdoutMinFrames = asNumber(args['holdout-min-frames'] || args.holdoutMinFrames, 24);
  const skipWalkForward = Boolean(args['skip-walk-forward'] || args.skipWalkForward);

  const pgConfig = resolveNasPgConfig({
    host: args['pg-host'],
    port: args['pg-port'],
    database: args['pg-database'],
    user: args['pg-user'],
    password: args['pg-password'],
  });

  const importer = await import('../src/services/importer/historical-stream-worker.ts');
  const replay = await import('../src/services/historical-intelligence.ts');

  const frames = await importer.loadHistoricalReplayFramesFromPostgres({
    includeWarmup: true,
    startTransactionTime: start,
    endTransactionTime: end,
    maxFrames,
    pgConfig,
  });

  const coverage = summarizeCoverage(frames);
  const coverageFailures = assertCoverage(coverage, expectedYears);
  const result = {
    ok: false,
    generatedAt: new Date().toISOString(),
    source: 'postgres',
    range: { start, end },
    totalFrames: frames.length,
    firstTimestamp: frames[0]?.timestamp || null,
    lastTimestamp: frames[frames.length - 1]?.timestamp || null,
    coverage,
    coverageFailures,
    walkForward: null,
    walkForwardFailures: [],
  };

  if (!skipWalkForward && frames.length > 0) {
    const walkFrames = walkStart === start && walkEnd === end && (walkMaxFrames ?? 0) === (maxFrames ?? 0)
      ? frames
      : await importer.loadHistoricalReplayFramesFromPostgres({
          includeWarmup: true,
          startTransactionTime: walkStart,
          endTransactionTime: walkEnd,
          maxFrames: walkMaxFrames,
          pgConfig,
        });
    const run = await replay.runWalkForwardBacktest(walkFrames, {
      label: 'NAS E2E Smoke',
      foldCount,
      holdoutRatio,
      holdoutMinFrames,
      retainLearningState: false,
      recordAdaptation: false,
    });
    result.walkForward = {
      range: {
        start: walkStart,
        end: walkEnd,
        totalFrames: walkFrames.length,
      },
      ...summarizeWalkForward(run),
    };
    result.walkForwardFailures = assertWalkForward(result.walkForward);
  }

  result.ok = result.coverageFailures.length === 0 && result.walkForwardFailures.length === 0;

  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outFile) {
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, serialized, 'utf8');
  }
  process.stdout.write(serialized);

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exit(1);
});
