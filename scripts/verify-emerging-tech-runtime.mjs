#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { startEventDashboardServer } from './event-dashboard-api.mjs';

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    requireTopics: false,
    requireReports: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '').trim();
    if (arg === '--require-topics') {
      parsed.requireTopics = true;
    } else if (arg === '--require-reports') {
      parsed.requireReports = true;
    }
  }
  return parsed;
}

export function evaluateRuntimeSummary(summary, options = {}) {
  const failures = [];
  if (!summary?.healthOk) failures.push('health endpoint unreachable');
  if (!summary?.topicsOk) failures.push('emerging-tech endpoint failed');
  if (!summary?.timelineOk) failures.push('emerging-tech timeline endpoint failed');
  if (!summary?.reportsOk) failures.push('reports endpoint failed');
  if (!summary?.digestOk) failures.push('weekly digest endpoint failed');
  if (options.requireTopics && Number(summary.topicCount || 0) <= 0) failures.push('topics required but none returned');
  if (options.requireReports && Number(summary.reportCount || 0) <= 0) failures.push('reports required but none returned');
  return failures;
}

async function fetchJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

export async function runEmergingTechRuntimeVerification(options = {}) {
  const server = startEventDashboardServer(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    const [health, topics, timeline, reports, digest] = await Promise.all([
      fetchJson(baseUrl, '/health'),
      fetchJson(baseUrl, '/emerging-tech'),
      fetchJson(baseUrl, '/emerging-tech/timeline'),
      fetchJson(baseUrl, '/reports/latest?limit=5'),
      fetchJson(baseUrl, '/digest/weekly'),
    ]);

    const summary = {
      checkedAt: new Date().toISOString(),
      port,
      healthOk: health.status > 0 && health.payload !== null,
      topicsOk: topics.ok,
      timelineOk: timeline.ok,
      reportsOk: reports.ok,
      digestOk: digest.ok,
      topicCount: Array.isArray(topics.payload?.topics) ? topics.payload.topics.length : 0,
      timelineTopicCount: Array.isArray(timeline.payload?.topics) ? timeline.payload.topics.length : 0,
      reportCount: Array.isArray(reports.payload?.reports) ? reports.payload.reports.length : 0,
      hasDigest: Boolean(digest.payload && Object.prototype.hasOwnProperty.call(digest.payload, 'digest')),
      digestPresent: Boolean(digest.payload?.digest),
      healthStatus: health.payload?.status || null,
    };

    const failures = evaluateRuntimeSummary(summary, options);
    return {
      ok: failures.length === 0,
      summary,
      failures,
    };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function main() {
  const options = parseArgs();
  const result = await runEmergingTechRuntimeVerification(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isDirectRun = (() => {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    return import.meta.url === pathToFileURL(entryArg).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exit(1);
  });
}
