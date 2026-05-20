#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runDrainReportBackfillTasks } from './drain-report-backfill-tasks.mjs';
import { runExecuteSourceQueryApprovals } from './execute-source-query-approvals.mjs';

function readArg(argv, name) {
  const prefix = `--${name}=`;
  const eqValue = argv.find((arg) => arg.startsWith(prefix));
  if (eqValue) return eqValue.slice(prefix.length);
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  const next = argv[idx + 1];
  return next && !next.startsWith('--') ? next : true;
}

function hasFlag(argv, name) {
  return argv.includes(`--${name}`) || argv.includes(`--${name}=true`);
}

function parseArgs(argv = process.argv.slice(2)) {
  const candidate = String(readArg(argv, 'candidate') || readArg(argv, 'subject') || '').trim();
  if (!candidate) throw new Error('--candidate is required');
  return {
    candidate,
    reportDir: readArg(argv, 'report-dir') || readArg(argv, 'out-dir') || null,
    reportId: readArg(argv, 'report-id') || null,
    enqueueMissing: hasFlag(argv, 'enqueue-missing'),
    executeApproved: hasFlag(argv, 'execute-approved'),
    regenerate: hasFlag(argv, 'regenerate'),
    dryRun: hasFlag(argv, 'dry-run'),
    limit: Number(readArg(argv, 'limit') || 25),
    perQueryLimit: Number(readArg(argv, 'per-query-limit') || 8),
    provider: readArg(argv, 'provider') || 'deterministic',
  };
}

function runNodeScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        const error = new Error(`${path.basename(scriptPath)} exited with ${code}: ${stderr || stdout}`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      let parsed = null;
      try {
        parsed = stdout.trim() ? JSON.parse(stdout) : null;
      } catch {
        parsed = null;
      }
      resolve({ ok: true, stdout, stderr, parsed });
    });
  });
}

async function regenerateReport(options = {}) {
  const args = [
    '--db',
    '--depth', 'deep',
    '--type', 'cross_theme_bottleneck_report',
    '--subject', options.candidate,
    '--provider', options.provider || 'deterministic',
  ];
  if (options.reportDir) args.push('--out-dir', options.reportDir);
  return runNodeScript(path.resolve('scripts', 'generate-intelligence-report.mjs'), args);
}

export async function runCrossThemeActionBridgeCycle(options = {}) {
  const summary = {
    ok: true,
    candidate: String(options.candidate),
    reportId: options.reportId || null,
    dryRun: Boolean(options.dryRun),
    steps: [],
    boundary: 'No canonical promotion is performed by this cycle; evidence memory, source-query approvals, and regenerated reports are the only write paths.',
  };

  if (options.regenerate) {
    const before = await regenerateReport(options);
    summary.reportId = before.parsed?.reportId || summary.reportId || null;
    summary.steps.push({ step: 'regenerate_before_collection', result: before.parsed || before.stdout.trim() });
  }

  if (options.enqueueMissing) {
    const queued = await runDrainReportBackfillTasks({
      dryRun: Boolean(options.dryRun),
      ensureSchema: true,
      limit: options.limit,
    });
    summary.steps.push({ step: 'enqueue_missing_backfill_tasks', result: queued });
  }

  if (options.executeApproved) {
    const executed = await runExecuteSourceQueryApprovals({
      dryRun: Boolean(options.dryRun),
      approvePending: true,
      retryNeedsFix: true,
      reprocessExecuted: true,
      reopenExhausted: true,
      limit: options.limit,
      perQueryLimit: options.perQueryLimit,
      reviewer: 'cross-theme-action-bridge-cycle',
      reportId: options.reportId || summary.reportId || undefined,
    });
    summary.steps.push({ step: 'execute_approved_source_queries', result: executed });
  }

  if (options.regenerate) {
    const after = await regenerateReport(options);
    summary.reportId = after.parsed?.reportId || summary.reportId || null;
    summary.steps.push({ step: 'regenerate_after_collection', result: after.parsed || after.stdout.trim() });
  }

  return summary;
}

const isDirectRun = (() => {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    return import.meta.url === pathToFileURL(entryArg).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runCrossThemeActionBridgeCycle(parseArgs())
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
