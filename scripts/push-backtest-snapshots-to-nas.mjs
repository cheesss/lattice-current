#!/usr/bin/env node
import fs from 'node:fs';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadEnvFile } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const scriptDir = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const projectRoot = path.resolve(scriptDir, '..');
const statePath = path.join(projectRoot, 'data', 'automation', 'nas-snapshot-sync-state.json');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '');
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const body = token.slice(2);
    if (!body) continue;
    if (body.includes('=')) {
      const [key, ...rest] = body.split('=');
      flags[key] = rest.join('=');
      continue;
    }
    const next = argv[i + 1];
    if (next && !String(next).startsWith('--')) {
      flags[body] = String(next);
      i += 1;
    } else {
      flags[body] = true;
    }
  }
  return { positional, flags };
}

function boolFlag(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function intFlag(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

async function readJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

async function saveJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function loadState() {
  return await readJson(statePath, {
    version: 1,
    updatedAt: null,
    files: {},
    lastRun: null,
  });
}

function hashForStat(statEntry, relativePath) {
  return crypto.createHash('sha1')
    .update(`${relativePath}:${statEntry.size}:${statEntry.mtimeMs}`)
    .digest('hex');
}

async function walk(dir) {
  const output = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...await walk(fullPath));
    } else if (entry.isFile()) {
      output.push(fullPath);
    }
  }
  return output;
}

function shouldIncludeSnapshot(filePath) {
  const relative = path.relative(projectRoot, filePath).replace(/\\/g, '/');
  if (relative === 'data/persistent-cache/historical-intelligence-runs%3Av1.json') return true;
  if (relative.startsWith('data/automation/') && relative.endsWith('.json')) return true;
  if (relative.startsWith('data/historical/')) {
    if (relative.endsWith('.duckdb') || relative.endsWith('.wal')) return true;
    if (relative.endsWith('.checkpoint.json')) return true;
    if (relative.endsWith('.json')) return true;
  }
  if (relative.startsWith('data/') && path.basename(relative).startsWith('intelligence-archive.duckdb')) return true;
  return false;
}

async function collectSnapshotFiles() {
  const candidates = [
    path.join(projectRoot, 'data'),
  ];
  const files = [];
  for (const root of candidates) {
    for (const filePath of await walk(root)) {
      if (shouldIncludeSnapshot(filePath)) files.push(filePath);
    }
  }
  return files.sort();
}

async function syncOnce(root, state, force = false) {
  const safeRoot = path.resolve(root);
  const snapshotBase = path.join(safeRoot, 'backtest-snapshots');
  await mkdir(snapshotBase, { recursive: true });

  const files = await collectSnapshotFiles();
  const synced = [];
  const skipped = [];

  for (const filePath of files) {
    const relative = path.relative(projectRoot, filePath).replace(/\\/g, '/');
    const fileStat = await stat(filePath);
    const digest = hashForStat(fileStat, relative);
    const cached = state.files[relative];
    if (!force && cached?.digest === digest && cached?.size === fileStat.size && cached?.mtimeMs === fileStat.mtimeMs) {
      skipped.push(relative);
      continue;
    }
    const targetPath = path.join(snapshotBase, relative);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(filePath, targetPath);
    state.files[relative] = {
      digest,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      lastSyncedAt: nowIso(),
      targetPath,
    };
    synced.push(relative);
  }

  state.updatedAt = nowIso();
  state.lastRun = {
    at: state.updatedAt,
    syncedCount: synced.length,
    skippedCount: skipped.length,
    root: snapshotBase,
  };

  await saveJson(statePath, state);
  await saveJson(path.join(snapshotBase, 'manifest.json'), {
    updatedAt: state.updatedAt,
    syncedCount: synced.length,
    skippedCount: skipped.length,
    files: state.files,
  });

  return {
    ok: true,
    root: snapshotBase,
    syncedCount: synced.length,
    skippedCount: skipped.length,
    synced,
  };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const action = String(positional[0] || 'sync').trim().toLowerCase();
  const root = String(flags.root || process.env.WM_NAS_SNAPSHOT_ROOT || process.env.NAS_SNAPSHOT_ROOT || '').trim();
  if (!root) {
    throw new Error('NAS snapshot root is missing. Set --root or WM_NAS_SNAPSHOT_ROOT.');
  }
  const state = await loadState();

  if (action === 'watch') {
    const intervalMinutes = Math.max(5, intFlag(flags['interval-minutes'], 30));
    while (true) {
      const result = await syncOnce(root, state, boolFlag(flags.force, false));
      console.log(JSON.stringify(result, null, 2));
      await saveJson(statePath, state);
      await new Promise((resolve) => setTimeout(resolve, intervalMinutes * 60_000));
    }
  }

  if (action !== 'sync' && action !== 'once') {
    throw new Error(`Unsupported action: ${action}`);
  }

  const result = await syncOnce(root, state, boolFlag(flags.force, false));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
