#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { loadEnvFile } from './_seed-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

loadEnvFile(import.meta.url);

const sidecarPort = Number(process.env.LOCAL_API_PORT || 46123);
let appPort = Number(process.env.VITE_PORT || 5173);
const shouldOpen = !process.argv.includes('--no-open');
const smokeTest = process.argv.includes('--smoke-test');
const localApiToken = randomBytes(24).toString('hex');

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

function assertViteAvailable(viteEntry) {
  if (existsSync(viteEntry)) {
    return;
  }
  const probeCommand = process.platform === 'win32' ? 'where npm' : 'command -v npm';
  const probe = spawnSync(probeCommand, {
    shell: true,
    stdio: 'ignore',
    env: buildSpawnEnv(),
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
  const child = spawn(command, args, options);
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
appPort = await findAvailablePort(appPort);

const sidecarEnv = buildSpawnEnv({
  LOCAL_API_PORT: String(sidecarPort),
  LOCAL_API_RESOURCE_DIR: projectRoot,
  LOCAL_API_DATA_DIR: join(projectRoot, 'data'),
  LOCAL_API_MODE: 'browser-dev',
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
