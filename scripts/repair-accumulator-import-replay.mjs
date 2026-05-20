#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  drainPendingImports,
  importToSidecar,
  sidecarPost,
  triggerReplay,
} from './data-accumulator.mjs';

function readArg(argv, name) {
  const eq = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  const next = argv[idx + 1];
  return next && !next.startsWith('--') ? next : true;
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  const finite = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, Math.floor(finite)));
}

function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function inferCandidateFromFile(filePath) {
  const dir = path.basename(path.dirname(filePath));
  let provider = dir.replace(/^([^-]+).*/, '$1') || 'automation';
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    provider = String(parsed.provider || parsed?.envelope?.provider || provider);
  } catch {
    // keep inferred provider
  }
  return {
    key: `${dir}|${path.resolve(filePath)}`,
    filePath: path.resolve(filePath),
    datasetId: dir,
    provider,
    source: 'historical-scan',
  };
}

function scanHistoricalAutomation(rootDir, limit) {
  const candidates = [];
  const base = path.resolve(rootDir);
  if (!fs.existsSync(base)) return candidates;
  for (const dir of fs.readdirSync(base, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const fullDir = path.join(base, dir.name);
    const files = fs.readdirSync(fullDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(fullDir, entry.name))
      .sort();
    for (const filePath of files) {
      candidates.push(inferCandidateFromFile(filePath));
      if (candidates.length >= limit) return candidates;
    }
  }
  return candidates;
}

async function checkSidecar() {
  const response = await sidecarPost('/api/local-intelligence-import', { dryRun: true, options: { datasetId: 'health-check' } }, { timeoutMs: 5_000 });
  if (response.ok || response.statusCode === 400) return { ok: true, status: 'reachable', statusCode: response.statusCode };
  return { ok: false, status: response.error || 'sidecar_unreachable', statusCode: response.statusCode };
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply');
  const replay = argv.includes('--replay');
  const limit = boundedInt(readArg(argv, 'limit'), 50, 1, 2_000);
  const projectRoot = path.resolve(readArg(argv, 'project-root') || process.cwd());
  const rootDir = path.resolve(readArg(argv, 'root') || path.join(projectRoot, 'data', 'historical', 'automation'));
  const statePath = path.resolve(readArg(argv, 'state-path') || path.join(projectRoot, 'data', 'historical', 'accumulator-state.json'));
  const state = readJsonIfExists(statePath, { pendingImports: [] });
  state.pendingImports = Array.isArray(state.pendingImports) ? state.pendingImports : [];

  const pending = state.pendingImports.slice(0, limit).map((row) => ({ ...row, source: 'pending-import-state' }));
  const scanned = scanHistoricalAutomation(rootDir, Math.max(0, limit - pending.length));
  const byKey = new Map();
  for (const row of [...pending, ...scanned]) byKey.set(row.key || `${row.datasetId}|${row.filePath}`, row);
  const candidates = Array.from(byKey.values()).slice(0, limit);
  const sidecar = await checkSidecar();

  const summary = {
    ok: true,
    apply,
    replay,
    rootDir,
    statePath,
    sidecar,
    pendingCount: pending.length,
    scannedCount: scanned.length,
    candidateCount: candidates.length,
    imported: 0,
    failed: 0,
    replayResult: null,
  };

  if (!apply) {
    console.log(JSON.stringify({ ...summary, dryRun: true, sample: candidates.slice(0, 10) }, null, 2));
    return;
  }

  if (!sidecar.ok) {
    summary.ok = false;
    summary.error = 'sidecar_unreachable';
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const pendingDrain = await drainPendingImports(state, { limit });
  summary.pendingDrain = pendingDrain;
  for (const candidate of candidates.filter((row) => row.source !== 'pending-import-state')) {
    const result = await importToSidecar(candidate.filePath, candidate.datasetId, candidate.provider, state);
    if (result.ok) summary.imported += 1;
    else summary.failed += 1;
  }

  if (replay) {
    summary.replayResult = await triggerReplay(state);
  }

  writeJson(statePath, state);
  summary.remainingPendingImports = state.pendingImports.length;
  summary.ok = summary.failed === 0 && (summary.replayResult?.ok !== false);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
  process.exitCode = 1;
});
