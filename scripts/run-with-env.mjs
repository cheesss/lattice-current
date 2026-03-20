#!/usr/bin/env node

import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const separatorIndex = args.indexOf('--');

if (separatorIndex <= 0 || separatorIndex === args.length - 1) {
  process.stderr.write('Usage: node scripts/run-with-env.mjs KEY=value [KEY=value ...] -- <command>\n');
  process.exit(1);
}

const envAssignments = args.slice(0, separatorIndex);
const command = args.slice(separatorIndex + 1).join(' ').trim();

if (!command) {
  process.stderr.write('run-with-env: missing command after --\n');
  process.exit(1);
}

const env = { ...process.env };
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

const child = spawn(command, {
  stdio: 'inherit',
  shell: true,
  env,
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
