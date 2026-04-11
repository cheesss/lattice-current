#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { loadEnvFile } from './_seed-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const npmProbeExecutable = process.platform === 'win32' ? 'where.exe' : 'which';

loadEnvFile(import.meta.url);

const sidecarPort = Number(process.env.LOCAL_API_PORT || 46123);
let appPort = Number(process.env.VITE_PORT || 5173);
const smokeTest = process.argv.includes('--smoke-test');
const shouldOpen = !process.argv.includes('--no-open') && !smokeTest;
const localApiToken = randomBytes(24).toString('hex');
const devStackLockPath = join(os.tmpdir(), 'lattice-current-dev-stack.lock');

function buildSpawnEnv(extraEnv = {}) {
  const merged = { ...process.env, ...extraEnv };
  const env = {};
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value !== 'string') continue;
    if (process.platform === 'win32' && key.startsWith('=')) continue;
    env[key] = value;
  }
  return env;
}

function readDevStackLock() {
  try {
    return JSON.parse(readFileSync(devStackLockPath, 'utf8'));
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
    unlinkSync(devStackLockPath);
  } catch {
    // ignore stale cleanup failures
  }
}

function acquireDevStackLock() {
  const payload = JSON.stringify({
    pid: process.pid,
    script: 'chrome-dev.mjs',
    createdAt: new Date().toISOString(),
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(devStackLockPath, payload, { flag: 'wx' });
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      const existing = readDevStackLock();
      if (existing?.pid && isProcessAlive(existing.pid)) {
        throw new Error(`[browser:chrome] another dev stack is already running (pid ${existing.pid}). Stop it before launching browser:chrome.`);
      }

      try {
        unlinkSync(devStackLockPath);
      } catch {
        // retry once after removing a stale lock
      }
    }
  }

  throw new Error(`[browser:chrome] failed to acquire dev stack lock at ${devStackLockPath}`);
}

function assertViteAvailable(viteEntry) {
  if (existsSync(viteEntry)) {
    return;
  }
  const probe = spawnSync(npmProbeExecutable, ['npm'], {
    stdio: 'ignore',
    env: buildSpawnEnv(),
    windowsHide: true,
  });
  if (probe.status !== 0) {
    throw new Error('[browser:chrome] Vite entrypoint missing and npm not found. Install dependencies and reopen your terminal.');
  }
}

function resolveChromeBinary() {
  if (process.platform === 'win32') {
    const candidates = [
      process.env['PROGRAMFILES'] ? join(process.env['PROGRAMFILES'], 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
      process.env['PROGRAMFILES(X86)'] ? join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    ].filter(Boolean);
    return candidates.find((candidate) => existsSync(candidate)) || 'chrome';
  }

  if (process.platform === 'darwin') {
    const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    return existsSync(macChrome) ? macChrome : 'google-chrome';
  }

  return 'google-chrome';
}

async function waitForUrl(url, {
  timeoutMs = 20_000,
  headers,
  validate,
} = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(2_000),
      });
      if (!validate || validate(response)) {
        return response;
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function findAvailablePort(startPort) {
  let candidate = startPort;
  while (candidate < startPort + 25) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(candidate, '127.0.0.1');
    });
    if (available) {
      return candidate;
    }
    candidate += 1;
  }
  throw new Error(`[browser:chrome] no free dev port found near ${startPort}`);
}

function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    windowsHide: true,
    ...options,
  });
  child.on('error', (error) => {
    console.error(`[browser:chrome] failed to start ${command}:`, error);
  });
  return child;
}

function openChrome(url) {
  const chromeBinary = resolveChromeBinary();
  if (process.platform === 'win32') {
    spawnProcess(chromeBinary, ['--new-window', url], {
      detached: true,
      stdio: 'ignore',
      env: buildSpawnEnv(),
    }).unref();
    return;
  }

  spawnProcess(chromeBinary, ['--new-window', url], {
    detached: true,
    stdio: 'ignore',
    env: buildSpawnEnv(),
  }).unref();
}

const viteEntry = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
assertViteAvailable(viteEntry);
acquireDevStackLock();
process.on('exit', () => releaseDevStackLock());
appPort = await findAvailablePort(appPort);

const sidecarEnv = buildSpawnEnv({
  LOCAL_API_PORT: String(sidecarPort),
  LOCAL_API_RESOURCE_DIR: projectRoot,
  LOCAL_API_DATA_DIR: join(projectRoot, 'data'),
  LOCAL_API_MODE: 'browser-dev',
  LOCAL_API_BACKGROUND_AUTOMATION: 'false',
  LOCAL_API_TOKEN: localApiToken,
});

const viteEnv = buildSpawnEnv({
  BROWSER: 'none',
  WM_LOCAL_API_PROXY_TARGET: `http://127.0.0.1:${sidecarPort}`,
  WM_LOCAL_API_TOKEN: localApiToken,
  VITE_WS_API_URL: process.env.VITE_WS_API_URL || 'https://worldmonitor.app',
});

const sidecar = spawnProcess(process.execPath, ['src-tauri/sidecar/local-api-server.mjs'], {
  cwd: projectRoot,
  env: sidecarEnv,
  stdio: 'inherit',
});

const vite = spawnProcess(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'], {
  cwd: projectRoot,
  env: viteEnv,
  stdio: 'inherit',
});

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [vite, sidecar]) {
    if (!child.killed) {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

vite.on('exit', (code) => {
  if (!shuttingDown) {
    console.log(`[browser:chrome] Vite exited (${code ?? 0}), stopping sidecar.`);
    shutdown(code ?? 0);
  }
});

sidecar.on('exit', (code) => {
  if (!shuttingDown) {
    console.log(`[browser:chrome] Local API sidecar exited (${code ?? 0}), stopping dev server.`);
    shutdown(code ?? 0);
  }
});

try {
  await waitForUrl(`http://127.0.0.1:${sidecarPort}/api/service-status`, {
    validate: (response) => response.ok,
  });
  await waitForUrl(`http://127.0.0.1:${appPort}/api/local-intelligence-import`, {
    timeoutMs: 30_000,
    validate: (response) => response.ok,
  });
  await waitForUrl(`http://127.0.0.1:${appPort}/api/local-automation-ops-snapshot`, {
    timeoutMs: 30_000,
    validate: (response) => response.ok || response.status === 401,
  });

  const appUrl = `http://127.0.0.1:${appPort}`;
  console.log(`[browser:chrome] Chrome-ready at ${appUrl}`);
  console.log('[browser:chrome] Local backtest endpoints are available through the dev proxy.');
  console.log('[browser:chrome] Browser mode prefers shell/.env.local secrets, then fills missing keys from the local desktop runtime mirror when available.');

  if (shouldOpen) {
    openChrome(appUrl);
  }

  if (smokeTest) {
    shutdown(0);
  }
} catch (error) {
  console.error('[browser:chrome] startup failed', error);
  shutdown(1);
}
