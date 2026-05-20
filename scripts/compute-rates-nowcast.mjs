#!/usr/bin/env node
/**
 * Thin Node wrapper that invokes scripts/compute-rates-nowcast.py so
 * master-daemon can schedule nowcast runs alongside existing JS tasks.
 *
 * Uses withLock to avoid overlap between daemon cycles.
 */

import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { withLock } from './_shared/pipeline-lock.mjs';
import { createLogger } from './_shared/structured-logger.mjs';

const logger = createLogger('compute-rates-nowcast');

function resolvePython() {
  return process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

async function runPython(args) {
  const scriptPath = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'compute-rates-nowcast.py');
  // Fallback for Windows where the URL path starts with '/C:/...'
  const adjustedScript = process.platform === 'win32'
    ? scriptPath.replace(/^\\|^\//, '')
    : scriptPath;

  return new Promise((resolve, reject) => {
    const proc = spawn(resolvePython(), [adjustedScript, ...args], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`compute-rates-nowcast exited ${code}: ${stderr || stdout}`));
    });
  });
}

export async function runRatesNowcast(target) {
  return withLock('compute-rates-nowcast', async () => {
    const args = target ? ['--target', target] : ['--all'];
    const start = Date.now();
    try {
      const { stdout } = await runPython(args);
      const elapsedMs = Date.now() - start;
      logger.info('rates nowcast complete', { target: target || 'all', elapsedMs });
      for (const line of stdout.split('\n').filter(Boolean)) {
        logger.info('rates nowcast result', { line });
      }
      return { ok: true, target: target || 'all', elapsedMs };
    } catch (err) {
      logger.error('rates nowcast failed', { error: err.message });
      return { ok: false, target: target || 'all', error: err.message };
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const targetArg = process.argv.includes('--target')
    ? process.argv[process.argv.indexOf('--target') + 1]
    : null;
  runRatesNowcast(targetArg).then((result) => {
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  });
}
