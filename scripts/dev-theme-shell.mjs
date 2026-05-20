#!/usr/bin/env node
/**
 * Run the theme-shell development stack in one command:
 * - event dashboard API
 * - Vite frontend
 *
 * Usage:
 *   npm run dev
 *   npm run dev:theme-shell
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'),
  '..',
);
const viteEntry = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const viteCommand = process.execPath;
const forwardedViteArgs = process.argv.slice(2);
const viteArgs = [viteEntry, ...forwardedViteArgs];
const apiScript = path.join(projectRoot, 'scripts', 'event-dashboard-api.mjs');
const devStackLockPath = path.join(os.tmpdir(), 'lattice-current-dev-stack.lock');

const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const MAGENTA = '\x1b[35m';

const metaModelScript = path.join(projectRoot, 'scripts', 'meta-model-server.py');
function findPythonBin() {
  const candidates = [
    process.env.PYTHON_BIN,
    'C:/Users/chohj/miniconda3/python.exe',
    'python3',
    'python',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (path.isAbsolute(c) && fs.existsSync(c)) return c;
      if (!path.isAbsolute(c)) return c; // shell will resolve via PATH
    } catch {}
  }
  return null;
}

function prefix(color, tag) {
  return (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        process.stdout.write(`${color}[${tag}]${RESET} ${line}\n`);
      }
    }
  };
}

function spawnHidden(command, args, extraEnv = {}) {
  return spawn(command, args, {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
    windowsHide: true,
  });
}

function wireLogging(child, color, tag) {
  child.stdout.on('data', prefix(color, tag));
  child.stderr.on('data', prefix(color, tag));
}

function readDevStackLock() {
  try {
    return JSON.parse(fs.readFileSync(devStackLockPath, 'utf8'));
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseDevStackLock() {
  const lock = readDevStackLock();
  if (!lock || lock.pid !== process.pid) return;
  try {
    fs.unlinkSync(devStackLockPath);
  } catch {
    // ignore stale cleanup failures
  }
}

function acquireDevStackLock() {
  const payload = JSON.stringify({
    pid: process.pid,
    script: path.basename(process.argv[1] || 'dev-theme-shell.mjs'),
    createdAt: new Date().toISOString(),
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(devStackLockPath, payload, { flag: 'wx' });
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      const existing = readDevStackLock();
      if (existing?.pid && isProcessAlive(existing.pid)) {
        console.error(`${GREEN}[theme-shell]${RESET} Another dev stack is already running (pid ${existing.pid}). Stop it before starting a new one.`);
        process.exit(1);
      }

      try {
        fs.unlinkSync(devStackLockPath);
      } catch {
        // retry once if a stale lock could not be removed immediately
      }
    }
  }

  console.error(`${GREEN}[theme-shell]${RESET} Failed to acquire the dev stack lock at ${devStackLockPath}.`);
  process.exit(1);
}

if (!fs.existsSync(viteEntry)) {
  console.error(`${GREEN}[theme-shell]${RESET} Vite entrypoint missing at ${viteEntry}. Run npm install first.`);
  process.exit(1);
}

acquireDevStackLock();
process.on('exit', () => releaseDevStackLock());

console.log(`${GREEN}[theme-shell]${RESET} Starting event dashboard API + Vite dev server${fs.existsSync(metaModelScript) ? ' + meta-model GPU inference' : ''}...`);
console.log(`${GREEN}[theme-shell]${RESET} Press Ctrl+C to stop all services.\n`);

const api = spawnHidden(process.execPath, [apiScript]);
wireLogging(api, CYAN, 'theme-api');

// Spawn meta-model-server (FastAPI on :8100). Non-fatal if Python missing —
// dashboard works without it, just `Conviction vs Realized Alpha` plot stays
// empty and `model_predictions` doesn't fill. Historically this was only
// spawned by `dev-full.mjs`; users running plain `npm run dev` were silently
// missing it for weeks. Including it here closes that operational gap.
let metaModel = null;
const pythonBin = findPythonBin();
if (pythonBin && fs.existsSync(metaModelScript)) {
  metaModel = spawnHidden(pythonBin, [metaModelScript], { PYTHONIOENCODING: 'utf-8' });
  wireLogging(metaModel, MAGENTA, 'meta-model');
  metaModel.on('close', (code) => {
    console.log(`${MAGENTA}[meta-model]${RESET} exited with code ${code} (inference unavailable until restart)`);
  });
} else {
  console.log(`${MAGENTA}[meta-model]${RESET} skipping (python or meta-model-server.py missing)`);
}

const cleanup = (vite) => {
  vite?.kill();
  api.kill();
  metaModel?.kill();
};

setTimeout(() => {
  const vite = spawnHidden(viteCommand, viteArgs);
  wireLogging(vite, YELLOW, 'vite');

  vite.on('close', (code) => {
    console.log(`${YELLOW}[vite]${RESET} exited with code ${code}`);
    cleanup(vite);
    process.exit(code ?? 0);
  });

  process.on('SIGINT', () => {
    console.log(`\n${GREEN}[theme-shell]${RESET} Shutting down...`);
    cleanup(vite);
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanup(vite);
    process.exit(0);
  });
}, 500);

api.on('close', (code) => {
  if (code !== null && code !== 0) {
    console.error(`${CYAN}[theme-api]${RESET} exited with code ${code}`);
  }
});
