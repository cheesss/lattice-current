#!/usr/bin/env node
/**
 * Run the local development stack in one command:
 * - sidecar local API
 * - Vite frontend
 *
 * Usage:
 *   npm run dev
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

const sidecarScript = path.join(projectRoot, 'src-tauri', 'sidecar', 'local-api-server.mjs');
const devStackLockPath = path.join(os.tmpdir(), 'lattice-current-dev-stack.lock');

const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';

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
    script: path.basename(process.argv[1] || 'dev-full.mjs'),
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
        console.error(`${GREEN}[dev]${RESET} Another dev stack is already running (pid ${existing.pid}). Stop it before starting a new one.`);
        process.exit(1);
      }

      try {
        fs.unlinkSync(devStackLockPath);
      } catch {
        // retry once if a stale lock could not be removed immediately
      }
    }
  }

  console.error(`${GREEN}[dev]${RESET} Failed to acquire the dev stack lock at ${devStackLockPath}.`);
  process.exit(1);
}

acquireDevStackLock();
process.on('exit', () => releaseDevStackLock());

console.log(`${GREEN}[dev]${RESET} Starting sidecar + Vite dev server...`);
console.log(`${GREEN}[dev]${RESET} Press Ctrl+C to stop all services.\n`);

const sidecar = spawnHidden(process.execPath, [sidecarScript], {
  LOCAL_API_MODE: 'standalone-dev',
  LOCAL_API_BACKGROUND_AUTOMATION: 'false',
});
wireLogging(sidecar, CYAN, 'sidecar');

const cleanup = (vite) => {
  vite?.kill();
  sidecar.kill();
};

setTimeout(async () => {
  const vite = spawnHidden(viteCommand, viteArgs);
  wireLogging(vite, YELLOW, 'vite');

  vite.on('close', (code) => {
    console.log(`${YELLOW}[vite]${RESET} exited with code ${code}`);
    cleanup(vite);
    process.exit(code ?? 0);
  });

  process.on('SIGINT', () => {
    console.log(`\n${GREEN}[dev]${RESET} Shutting down...`);
    cleanup(vite);
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanup(vite);
    process.exit(0);
  });
}, 1000);

sidecar.on('close', (code) => {
  if (code !== null && code !== 0) {
    console.error(`${CYAN}[sidecar]${RESET} exited with code ${code}`);
  }
});
