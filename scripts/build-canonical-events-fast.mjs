#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOptionalEnvFile } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pythonScript = path.join(scriptDir, 'build_canonical_events.py');
const legacyScript = path.join(scriptDir, 'build-canonical-events-fast.legacy.mjs');

function parseArgs(argv) {
  const passthrough = [];
  let engine = String(process.env.LATTICE_CANONICAL_ENGINE || 'auto').trim().toLowerCase();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--engine' && argv[index + 1]) {
      engine = String(argv[index + 1]).trim().toLowerCase();
      index += 1;
      continue;
    }
    passthrough.push(arg);
  }

  return { engine, passthrough };
}

function runProcess(command, args) {
  return spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    cwd: process.cwd(),
  });
}

function tryRunPython(args, allowFallback) {
  const candidates = [];
  if (process.env.LATTICE_PYTHON) candidates.push([process.env.LATTICE_PYTHON]);
  if (process.env.PYTHON) candidates.push([process.env.PYTHON]);
  if (process.env.USERPROFILE) {
    candidates.push([path.join(process.env.USERPROFILE, 'miniconda3', 'python.exe')]);
    candidates.push([path.join(process.env.USERPROFILE, 'anaconda3', 'python.exe')]);
  }
  candidates.push(['python']);
  candidates.push(['py', '-3']);

  for (const candidate of candidates) {
    const [command, ...prefixArgs] = candidate;
    const result = runProcess(command, [...prefixArgs, pythonScript, ...args]);
    if (result.error?.code === 'ENOENT') continue;
    if (result.error) {
      console.error(`[canonical-events] failed to start ${command}: ${result.error.message}`);
      if (!allowFallback) process.exit(1);
      return false;
    }
    if (result.status === 0) {
      return true;
    }
    if (!allowFallback) {
      process.exit(result.status ?? 1);
    }
    console.warn('[canonical-events] Python engine exited non-zero, falling back to legacy JS engine.');
    return false;
  }

  if (!allowFallback) {
    console.error('[canonical-events] no Python interpreter found. Set LATTICE_PYTHON or install python.');
    process.exit(1);
  }
  return false;
}

function runLegacy(args) {
  const result = runProcess(process.execPath, [legacyScript, ...args]);
  if (result.error) {
    console.error(`[canonical-events] legacy JS engine failed: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

const { engine, passthrough } = parseArgs(process.argv.slice(2));
const requestsDryRun = passthrough.includes('--dry-run');

if (engine === 'js') {
  runLegacy(passthrough);
}

const allowFallback = engine === 'auto' && !requestsDryRun;
const ranPython = tryRunPython(passthrough, allowFallback);
if (ranPython) {
  process.exit(0);
}

runLegacy(passthrough);
