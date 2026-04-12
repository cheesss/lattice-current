#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOptionalEnvFile } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pythonScript = path.join(scriptDir, 'build_matched_controls.py');
const legacyScript = path.join(scriptDir, 'build-matched-controls.legacy.mjs');

function tryRunPython(args) {
  const candidates = [];
  if (process.env.LATTICE_PYTHON) candidates.push([process.env.LATTICE_PYTHON]);
  if (process.env.USERPROFILE) candidates.push([path.join(process.env.USERPROFILE, 'miniconda3', 'python.exe')]);
  candidates.push(['python'], ['py', '-3']);

  for (const [command, ...prefixArgs] of candidates) {
    const result = spawnSync(command, [...prefixArgs, pythonScript, ...args], {
      stdio: 'inherit', env: process.env, cwd: process.cwd(),
    });
    if (result.error?.code === 'ENOENT') continue;
    if (result.status === 0) return true;
    if (result.error) continue;
  }
  return false;
}

const passthrough = process.argv.slice(2);
if (tryRunPython(passthrough)) process.exit(0);

console.warn('[build-matched-controls] Python engine not available, falling back to JS');
const result = spawnSync(process.execPath, [legacyScript, ...passthrough], {
  stdio: 'inherit', env: process.env, cwd: process.cwd(),
});
process.exit(result.status ?? 1);
