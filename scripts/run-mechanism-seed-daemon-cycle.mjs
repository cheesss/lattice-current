#!/usr/bin/env node

import { appendFile, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const MECHANISM_SEED_DAEMON_CYCLE_VERSION = 'mechanism-seed-daemon-cycle-v1';
export const DEFAULT_MECHANISM_SEED_DAEMON_STATE_PATH = path.resolve(
  process.cwd(),
  'data/runtime/mechanism-seed-generation-daemon-state.json',
);
export const DEFAULT_MECHANISM_SEED_DAEMON_STEPS_PATH = path.resolve(
  process.cwd(),
  'data/runtime/mechanism-seed-generation.steps.jsonl',
);
export const DEFAULT_MECHANISM_SEED_DAEMON_LOCK_PATH = path.resolve(
  process.cwd(),
  'data/runtime/mechanism-seed-generation.lock',
);

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseCsv(value = '') {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function uniqueStrings(values = [], limit = 100) {
  const flat = Array.isArray(values) ? values.flat(Infinity) : [values];
  const seen = new Set();
  const out = [];
  for (const value of flat) {
    const text = compact(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function numberOption(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function parseMechanismSeedDaemonCycleArgs(argv = process.argv.slice(2)) {
  const out = {
    limit: 25,
    source: 'all',
    statuses: ['review_ready', 'needs_evidence', 'evidence_running', 'rejected', 'report_candidate'],
    auditStatuses: ['review_ready', 'needs_evidence', 'evidence_running'],
    applyGeneration: true,
    artifactRoot: path.resolve(process.cwd(), 'data/runtime'),
    stateFile: DEFAULT_MECHANISM_SEED_DAEMON_STATE_PATH,
    stepsFile: DEFAULT_MECHANISM_SEED_DAEMON_STEPS_PATH,
    lockFile: DEFAULT_MECHANISM_SEED_DAEMON_LOCK_PATH,
    lockStaleMinutes: 180,
    maxConsecutiveFailures: 3,
    timeoutMs: 900_000,
    force: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--limit') out.limit = Number(next() || out.limit);
    else if (arg === '--source') out.source = next() || out.source;
    else if (arg === '--statuses') out.statuses = parseCsv(next());
    else if (arg === '--audit-statuses') out.auditStatuses = parseCsv(next());
    else if (arg === '--skip-storage' || arg === '--dry-run-generation') out.applyGeneration = false;
    else if (arg === '--artifact-root') out.artifactRoot = path.resolve(next() || out.artifactRoot);
    else if (arg === '--state-file') out.stateFile = path.resolve(next() || out.stateFile);
    else if (arg === '--steps-file') out.stepsFile = path.resolve(next() || out.stepsFile);
    else if (arg === '--lock-file') out.lockFile = path.resolve(next() || out.lockFile);
    else if (arg === '--lock-stale-minutes') out.lockStaleMinutes = Number(next() || out.lockStaleMinutes);
    else if (arg === '--max-consecutive-failures') out.maxConsecutiveFailures = Number(next() || out.maxConsecutiveFailures);
    else if (arg === '--timeout-ms') out.timeoutMs = Number(next() || out.timeoutMs);
    else if (arg === '--force') out.force = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--source=')) out.source = arg.slice('--source='.length);
    else if (arg.startsWith('--statuses=')) out.statuses = parseCsv(arg.slice('--statuses='.length));
    else if (arg.startsWith('--audit-statuses=')) out.auditStatuses = parseCsv(arg.slice('--audit-statuses='.length));
    else if (arg.startsWith('--artifact-root=')) out.artifactRoot = path.resolve(arg.slice('--artifact-root='.length));
    else if (arg.startsWith('--state-file=')) out.stateFile = path.resolve(arg.slice('--state-file='.length));
    else if (arg.startsWith('--steps-file=')) out.stepsFile = path.resolve(arg.slice('--steps-file='.length));
    else if (arg.startsWith('--lock-file=')) out.lockFile = path.resolve(arg.slice('--lock-file='.length));
    else if (arg.startsWith('--lock-stale-minutes=')) out.lockStaleMinutes = Number(arg.slice('--lock-stale-minutes='.length));
    else if (arg.startsWith('--max-consecutive-failures=')) out.maxConsecutiveFailures = Number(arg.slice('--max-consecutive-failures='.length));
    else if (arg.startsWith('--timeout-ms=')) out.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  out.limit = numberOption(out.limit, 25, 1, 250);
  out.statuses = uniqueStrings(out.statuses, 30);
  out.auditStatuses = uniqueStrings(out.auditStatuses, 30);
  out.lockStaleMinutes = numberOption(out.lockStaleMinutes, 180, 1, 24 * 60);
  out.maxConsecutiveFailures = numberOption(out.maxConsecutiveFailures, 3, 1, 20);
  out.timeoutMs = numberOption(out.timeoutMs, 900_000, 30_000, 24 * 60 * 60 * 1000);
  return out;
}

function helpText() {
  return `Usage:
  node --import tsx scripts/run-mechanism-seed-daemon-cycle.mjs --limit 25
  node --import tsx scripts/run-mechanism-seed-daemon-cycle.mjs --skip-storage --limit 25

Runs a bounded mechanism seed recurring cycle:
  1. seed generation (DB seed/run ledger only unless --skip-storage)
  2. Phase C audit artifact
  3. provider gap review artifact
  4. provider adapter proposal artifact
  5. self-improvement proposal artifact

It never enqueues evidence, activates providers, mutates canonical graph/source
registry, or writes research evidence bundles.
`;
}

function emptyState() {
  return {
    version: MECHANISM_SEED_DAEMON_CYCLE_VERSION,
    updatedAt: new Date().toISOString(),
    steps: {},
    runs: [],
  };
}

async function loadState(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return {
      ...emptyState(),
      ...parsed,
      steps: parsed.steps || {},
      runs: parsed.runs || [],
    };
  } catch {
    return emptyState();
  }
}

async function saveState(filePath, state) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = {
    ...state,
    version: MECHANISM_SEED_DAEMON_CYCLE_VERSION,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function stepExhausted(state = {}, stepName = '', options = {}) {
  const step = state.steps?.[stepName] || {};
  return Boolean(step.exhausted) && !options.force;
}

function recordStep(state = emptyState(), stepName = '', result = {}, options = {}) {
  const previous = state.steps?.[stepName] || {};
  const ok = result.ok !== false;
  const consecutiveFailures = ok ? 0 : Number(previous.consecutiveFailures || 0) + 1;
  const attempts = Number(previous.attempts || 0) + 1;
  return {
    ...state,
    updatedAt: new Date().toISOString(),
    steps: {
      ...(state.steps || {}),
      [stepName]: {
        stepName,
        attempts,
        consecutiveFailures,
        exhausted: consecutiveFailures >= Number(options.maxConsecutiveFailures || 3),
        lastResult: result,
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

async function appendStepLog(filePath, entry) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

async function acquireLock(filePath, options = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const staleMs = Number(options.lockStaleMinutes || 180) * 60_000;
  try {
    const existing = JSON.parse(await readFile(filePath, 'utf8'));
    const createdAt = Date.parse(existing.createdAt || '');
    if (Number.isFinite(createdAt) && Date.now() - createdAt > staleMs) {
      await rm(filePath, { force: true });
    }
  } catch {
    // no lock or unreadable lock: create below
  }
  const handle = await open(filePath, 'wx');
  const lock = {
    version: MECHANISM_SEED_DAEMON_CYCLE_VERSION,
    createdAt: new Date().toISOString(),
    pid: process.pid,
  };
  await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  await handle.close();
  return async () => rm(filePath, { force: true });
}

function parseJsonOutput(stdout = '') {
  const text = String(stdout || '').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    return { ok: true, raw: text.slice(0, 2000) };
  }
}

function defaultRunStep(step) {
  const stdout = execFileSync(process.execPath, ['--import', 'tsx', step.script, ...step.args.map(String)], {
    cwd: process.cwd(),
    env: { ...process.env },
    windowsHide: true,
    timeout: step.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    stdio: 'pipe',
  }).toString('utf8');
  return parseJsonOutput(stdout);
}

function artifactPath(root = '', fileName = '') {
  return path.join(root, fileName);
}

function buildSteps(options = {}) {
  const root = options.artifactRoot || path.resolve(process.cwd(), 'data/runtime');
  const statuses = uniqueStrings(options.statuses || [], 30).join(',');
  const auditStatuses = uniqueStrings(options.auditStatuses || [], 30).join(',');
  return [
    {
      name: 'seed-generation',
      script: 'scripts/run-mechanism-seed-generation.mjs',
      args: [
        options.applyGeneration ? '--apply' : '--dry-run',
        '--source', options.source || 'all',
        '--limit', options.limit,
        '--artifact-out', artifactPath(root, 'mechanism-seed-generation.latest.json'),
      ],
    },
    {
      name: 'phase-c-audit',
      script: 'scripts/audit-mechanism-seed-phase-c.mjs',
      args: [
        '--statuses', auditStatuses,
        '--limit', Math.max(options.limit, 50),
        '--artifact-out', artifactPath(root, 'operator-seed-phase-c-audit.latest.json'),
      ],
    },
    {
      name: 'provider-gap-review',
      script: 'scripts/review-provider-gap-proposals.mjs',
      args: [
        '--statuses', statuses,
        '--limit', options.limit,
        '--artifact-out', artifactPath(root, 'operator-seed-provider-gap-review.latest.json'),
      ],
    },
    {
      name: 'provider-adapter-proposals',
      script: 'scripts/propose-provider-adapter.mjs',
      args: [
        '--statuses', statuses,
        '--limit', options.limit,
        '--artifact-out', artifactPath(root, 'provider-adapter-proposals.latest.json'),
      ],
    },
    {
      name: 'self-improvement',
      script: 'scripts/run-mechanism-seed-self-improvement.mjs',
      args: [
        '--statuses', statuses,
        '--limit', Math.max(options.limit, 100),
        '--artifact-out', artifactPath(root, 'mechanism-seed-self-improvement.latest.json'),
      ],
    },
  ].map((step) => ({ ...step, timeoutMs: options.timeoutMs || 900_000 }));
}

export async function runMechanismSeedDaemonCycle(options = {}) {
  const startedAt = new Date().toISOString();
  const stateFile = options.stateFile || DEFAULT_MECHANISM_SEED_DAEMON_STATE_PATH;
  const stepsFile = options.stepsFile || DEFAULT_MECHANISM_SEED_DAEMON_STEPS_PATH;
  const lockFile = options.lockFile || DEFAULT_MECHANISM_SEED_DAEMON_LOCK_PATH;
  let releaseLock = async () => {};
  if (options.lock !== false) releaseLock = await acquireLock(lockFile, options);
  let state = await loadState(stateFile);
  const steps = buildSteps(options);
  const stepResults = [];
  try {
    for (const step of steps) {
      if (stepExhausted(state, step.name, options)) {
        const skipped = {
          ok: true,
          skipped: true,
          reason: 'terminal_state_exhausted',
          stepName: step.name,
        };
        stepResults.push({ stepName: step.name, ...skipped });
        await appendStepLog(stepsFile, { ts: new Date().toISOString(), ...skipped });
        continue;
      }
      const started = Date.now();
      let result;
      try {
        result = await (options.runStep || defaultRunStep)(step);
        result = { ok: result?.ok !== false, ...result };
      } catch (error) {
        result = {
          ok: false,
          error: String(error?.message || error),
        };
      }
      const durationMs = Date.now() - started;
      const entry = {
        ts: new Date().toISOString(),
        stepName: step.name,
        script: step.script,
        args: step.args,
        ok: result.ok !== false,
        durationMs,
        result,
      };
      stepResults.push(entry);
      state = recordStep(state, step.name, {
        ok: entry.ok,
        durationMs,
        mode: result.mode || null,
        dryRun: result.dryRun ?? null,
        artifactPath: result.artifactPath || null,
        proposalCount: result.proposalCount ?? null,
        seedCount: result.seedCount ?? result.total ?? null,
        error: result.error || null,
      }, options);
      await appendStepLog(stepsFile, entry);
      await saveState(stateFile, state);
      if (!entry.ok && !options.continueOnError) break;
    }
    const ok = stepResults.every((step) => step.ok !== false);
    state = {
      ...state,
      runs: [
        {
          startedAt,
          finishedAt: new Date().toISOString(),
          ok,
          stepCount: stepResults.length,
        },
        ...(state.runs || []),
      ].slice(0, 50),
    };
    await saveState(stateFile, state);
    return {
      ok,
      mode: 'mechanism-seed-daemon-cycle',
      version: MECHANISM_SEED_DAEMON_CYCLE_VERSION,
      startedAt,
      finishedAt: new Date().toISOString(),
      stateFile,
      stepsFile,
      lockFile,
      stepCount: stepResults.length,
      steps: stepResults.map((step) => ({
        stepName: step.stepName,
        ok: step.ok,
        skipped: Boolean(step.skipped),
        durationMs: step.durationMs || 0,
        mode: step.result?.mode || null,
        artifactPath: step.result?.artifactPath || null,
        error: step.result?.error || null,
      })),
      boundaries: {
        evidenceEnqueueWrites: 0,
        approvalQueueWrites: 0,
        sourceQueryApprovalWrites: 0,
        reportBackfillWrites: 0,
        researchEvidenceBundleWrites: 0,
        canonicalWrites: 0,
        sourceRegistryWrites: 0,
        providerActivationWrites: 0,
      },
    };
  } finally {
    await releaseLock();
  }
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
  const options = parseMechanismSeedDaemonCycleArgs();
  if (options.help) {
    process.stdout.write(helpText());
  } else {
    runMechanismSeedDaemonCycle(options)
      .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}

export const __test = {
  buildSteps,
  recordStep,
  stepExhausted,
  parseJsonOutput,
};
