#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const separatorIndex = args.indexOf('--');

if (separatorIndex <= 0 || separatorIndex === args.length - 1) {
  process.stderr.write('Usage: node scripts/run-with-env.mjs KEY=value [KEY=value ...] -- <command>\n');
  process.exit(1);
}

const envAssignments = args.slice(0, separatorIndex);
const commandTokens = args.slice(separatorIndex + 1);
const [command, ...commandArgs] = commandTokens;

if (!command?.trim()) {
  process.stderr.write('run-with-env: missing command after --\n');
  process.exit(1);
}

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

function resolveWindowsCommand(commandName) {
  if (process.platform !== 'win32') {
    return commandName;
  }

  const normalized = commandName.trim();
  if (!normalized) {
    return normalized;
  }

  const hasPathSeparator = normalized.includes('\\') || normalized.includes('/');
  const hasExplicitExtension = /\.[a-z0-9]+$/i.test(normalized);
  if (hasPathSeparator || hasExplicitExtension) {
    return normalized;
  }

  const searchPaths = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const candidates = ['.cmd', '.exe', '.bat', '.com', ''];
  for (const baseDir of searchPaths) {
    for (const suffix of candidates) {
      const candidate = path.join(baseDir, `${normalized}${suffix}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return normalized;
}

const env = buildSpawnEnv();
for (const assignment of envAssignments) {
  const eqIndex = assignment.indexOf('=');
  if (eqIndex <= 0) {
    process.stderr.write(`run-with-env: invalid env assignment "${assignment}"\n`);
    process.exit(1);
  }
  const key = assignment.slice(0, eqIndex).trim();
  const value = assignment.slice(eqIndex + 1);
  if (!key) {
    process.stderr.write(`run-with-env: invalid env assignment "${assignment}"\n`);
    process.exit(1);
  }
  env[key] = value;
}

const child = spawn(resolveWindowsCommand(command), commandArgs, {
  stdio: 'inherit',
  env,
  windowsHide: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  process.stderr.write(`run-with-env: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
