#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile } from './_shared/nas-runtime.mjs';

const RUN_MAX_BUFFER_BYTES = Math.max(1_000_000, Number(process.env.RESEARCH_OS_CYCLE_MAX_BUFFER_BYTES || 8_000_000));
const DEFAULT_STEP_TIMEOUT_MS = Math.max(60_000, Number(process.env.RESEARCH_OS_CYCLE_STEP_TIMEOUT_MS || 1_800_000));
const RUNTIME_DIR = path.join(process.cwd(), 'data', 'runtime');
const LATEST_PATH = path.join(RUNTIME_DIR, 'research-os-cycle.latest.json');

export const RESEARCH_OS_CYCLE_STEPS = Object.freeze([
  {
    name: 'mine-incoming-connections',
    argv: ['scripts/mine-incoming-connections.mjs'],
    timeoutMs: 900_000,
  },
  {
    name: 'research-os-foundation',
    argv: ['scripts/research-os-foundation.mjs', '--import-seeds', '--mine-incoming', '--generate-questions'],
    timeoutMs: 900_000,
  },
  {
    name: 'collect-research-evidence',
    argv: ['scripts/collect-research-evidence.mjs', '--limit=24', '--per-question-limit=16'],
    timeoutMs: 1_800_000,
  },
  {
    name: 'repair-research-os-noisy-relations',
    argv: ['scripts/repair-research-os-noisy-relations.mjs'],
    timeoutMs: 300_000,
  },
  {
    name: 'extract-research-relations',
    argv: ['scripts/extract-research-relations.mjs', '--limit=240'],
    timeoutMs: 1_800_000,
  },
  {
    name: 'refresh-cross-theme-candidates',
    argv: ['scripts/refresh-cross-theme-candidates.mjs', '--limit=16'],
    timeoutMs: 900_000,
  },
  {
    name: 'cross-theme-source-expansion',
    argv: ['scripts/plan-cross-theme-source-expansion.mjs', '--limit=40'],
    timeoutMs: 300_000,
    continueOnFailure: true,
  },
  {
    name: 'execute-source-query-approvals',
    argv: ['scripts/execute-source-query-approvals.mjs', '--limit=25', '--retry-needs-fix'],
    timeoutMs: 900_000,
    continueOnFailure: true,
  },
  {
    name: 'promote-trusted-graph',
    argv: ['scripts/promote-trusted-graph.mjs'],
    timeoutMs: 300_000,
    continueOnFailure: true,
  },
]);

function parseArgs(argv = process.argv.slice(2)) {
  return {
    dryRun: argv.includes('--dry-run'),
    skipApprovals: argv.includes('--skip-approvals'),
    stopOnOptionalFailure: argv.includes('--stop-on-optional-failure'),
  };
}

function runStep(step, options = {}) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  if (options.dryRun) {
    return {
      name: step.name,
      ok: true,
      dryRun: true,
      argv: step.argv,
      startedAt,
      durationMs: 0,
      skipped: false,
    };
  }
  try {
    const output = execFileSync(process.execPath, step.argv, {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: 'pipe',
      timeout: step.timeoutMs || DEFAULT_STEP_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: RUN_MAX_BUFFER_BYTES,
      encoding: 'utf8',
    });
    return {
      name: step.name,
      ok: true,
      argv: step.argv,
      startedAt,
      durationMs: Date.now() - started,
      stdoutTail: String(output || '').slice(-2_000),
      skipped: false,
    };
  } catch (error) {
    const stderr = error?.stderr?.toString?.() || '';
    const stdout = error?.stdout?.toString?.() || '';
    return {
      name: step.name,
      ok: false,
      argv: step.argv,
      startedAt,
      durationMs: Date.now() - started,
      error: String(stderr || stdout || error?.message || error).replace(/\s+/g, ' ').slice(0, 2_000),
      continueOnFailure: Boolean(step.continueOnFailure),
      skipped: false,
    };
  }
}

export function selectResearchOsCycleSteps(options = {}) {
  return RESEARCH_OS_CYCLE_STEPS.filter((step) => {
    if (options.skipApprovals && ['cross-theme-source-expansion', 'execute-source-query-approvals'].includes(step.name)) {
      return false;
    }
    return true;
  });
}

export async function runResearchOsCycle(options = {}) {
  loadOptionalEnvFile();
  const startedAt = new Date().toISOString();
  const steps = [];
  let ok = true;
  for (const step of selectResearchOsCycleSteps(options)) {
    const result = runStep(step, options);
    steps.push(result);
    if (!result.ok) {
      ok = false;
      if (!result.continueOnFailure || options.stopOnOptionalFailure) break;
    }
  }
  const payload = {
    ok,
    dryRun: Boolean(options.dryRun),
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - new Date(startedAt).getTime(),
    steps,
    failedSteps: steps.filter((step) => !step.ok).map((step) => step.name),
  };
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(LATEST_PATH, JSON.stringify(payload, null, 2));
  return payload;
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
  runResearchOsCycle(parseArgs())
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
