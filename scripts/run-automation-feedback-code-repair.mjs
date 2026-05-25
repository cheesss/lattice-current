#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_CODE_REPAIR_TIMEOUT_MS,
  runAutomationFeedbackCodeRepair,
} from './_shared/automation-feedback-code-repair.mjs';

const DEFAULT_RUNTIME_ROOT = path.join(process.cwd(), 'data', 'runtime');

function getArg(argv, flag, fallback = '') {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : fallback;
}

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

async function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function helpText() {
  return `Usage:
  node --import tsx scripts/run-automation-feedback-code-repair.mjs --plan
  node --import tsx scripts/run-automation-feedback-code-repair.mjs --execute --max-repairs 1
  node --import tsx scripts/run-automation-feedback-code-repair.mjs --execute --parallel --parallel-workers 3 --max-repairs 3

Reads data/runtime/automation-feedback-remediation.latest.json and asks Codex
CLI to patch the smallest provider/collector/test gap. It never commits,
pushes, promotes readiness, writes report candidates, or enables portfolio
actions. Use --execute only when local code patches are allowed.
Parallel mode uses isolated snapshot workspaces and only merges safe,
non-overlapping allowed-file changes back into the main repo.
After merge, execute mode reruns the automation cycle by default and records
whether the patch produced accepted/promotion evidence delta. Use
--no-effect-verify only for local coordinator tests.
`;
}

export async function runAutomationFeedbackCodeRepairCli(argv = process.argv.slice(2)) {
  if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    return { help: true, text: helpText() };
  }
  const runtimeRoot = path.resolve(getArg(argv, '--runtime-root', DEFAULT_RUNTIME_ROOT));
  const remediationPath = path.resolve(getArg(
    argv,
    '--remediation-artifact',
    path.join(runtimeRoot, 'automation-feedback-remediation.latest.json'),
  ));
  const remediation = await readJson(remediationPath);
  if (!remediation) throw new Error(`missing remediation artifact: ${remediationPath}`);
  const execute = hasFlag(argv, '--execute');
  const maxRepairs = Number(getArg(argv, '--max-repairs', '1'));
  const parallel = hasFlag(argv, '--parallel');
  const parallelWorkers = Number(getArg(argv, '--parallel-workers', '3'));
  const isolation = getArg(argv, '--isolation', 'snapshot-worktree');
  const timeoutMs = Number(getArg(argv, '--timeout-ms', String(DEFAULT_CODE_REPAIR_TIMEOUT_MS)));
  const verify = !hasFlag(argv, '--no-verify');
  const verifyEvidenceDelta = !hasFlag(argv, '--no-effect-verify');
  const rollbackIneffective = !hasFlag(argv, '--keep-ineffective-patches');
  return await runAutomationFeedbackCodeRepair({
    remediation,
    execute,
    maxRepairs,
    parallel,
    parallelWorkers,
    isolation,
    timeoutMs,
    verify,
    verifyEvidenceDelta: execute && verifyEvidenceDelta,
    rollbackIneffective,
    cwd: process.cwd(),
    artifactPath: path.join(runtimeRoot, 'automation-feedback-code-repair.latest.json'),
  });
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileUrlSafe(entry).href;
  } catch {
    return false;
  }
})();

function pathToFileUrlSafe(value) {
  return new URL(`file:///${path.resolve(value).replace(/\\/g, '/')}`);
}

if (isDirectRun) {
  runAutomationFeedbackCodeRepairCli().then((result) => {
    if (result.help) process.stdout.write(result.text);
    else process.stdout.write(`${JSON.stringify({
      ok: result.ok,
      mode: result.mode,
      requestCount: result.requestCount,
      executedCount: result.executedCount,
      skippedRequestCount: result.skippedRequestCount,
      skippedRequests: result.skippedRequests,
      parallel: result.parallel,
      parallelWorkers: result.parallelWorkers,
      isolation: result.isolation,
      parallelExecution: result.parallelExecution ? {
        runId: result.parallelExecution.runId,
        workspaceRoot: result.parallelExecution.workspaceRoot,
        workerStatuses: result.parallelExecution.workerStatuses,
        mergeConflicts: result.parallelExecution.mergeConflicts,
        patchesApplied: result.parallelExecution.patchesApplied,
        patchesRejected: result.parallelExecution.patchesRejected,
        patchesRolledBack: result.parallelExecution.patchesRolledBack,
        evidenceDeltaAfterMerge: result.parallelExecution.evidenceDeltaAfterMerge,
        postRollbackRefresh: result.parallelExecution.postRollbackRefreshResult
          ? { command: result.parallelExecution.postRollbackRefreshResult.command, code: result.parallelExecution.postRollbackRefreshResult.code }
          : null,
        postMergeVerification: result.parallelExecution.postMergeVerificationResults?.map((item) => ({ command: item.command, code: item.code })) || [],
      } : null,
      runs: result.runs.map((run) => ({
        requestId: run.request.requestId,
        providerName: run.request.providerName,
        evidenceClass: run.request.evidenceClass,
        executed: run.executed,
        status: run.status,
        codexExitCode: run.codexResult?.code ?? null,
        parsed: run.codexResult?.parsed || null,
        verification: (run.verificationResults || []).map((item) => ({ command: item.command, code: item.code })),
      })),
      mutationBoundary: result.mutationBoundary,
      artifactPath: result.artifactPath,
    }, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exit(1);
  });
}
