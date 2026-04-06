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

console.log(`${GREEN}[dev]${RESET} Starting sidecar + Vite dev server...`);
console.log(`${GREEN}[dev]${RESET} Press Ctrl+C to stop all services.\n`);

const sidecar = spawnHidden('node', [sidecarScript], { LOCAL_API_MODE: 'standalone-dev' });
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
