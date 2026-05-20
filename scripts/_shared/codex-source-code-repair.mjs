import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { getSafeEnv, parseJsonObject, resolveCodexCommand } from './codex-json.mjs';

const DEFAULT_ARTIFACT_DIR = path.resolve('data', 'codex-source-repair-runs');
const LOCK_PATH = path.join(DEFAULT_ARTIFACT_DIR, '.codex-source-code-repair.lock');
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_ALLOWED_FILES = Object.freeze([
  'scripts/_shared/source-probe.mjs',
  'scripts/_shared/source-repair.mjs',
  'scripts/proposal-executor.mjs',
  'scripts/self-heal-sources.mjs',
  'scripts/run-source-repair-closed-loop.mjs',
  'scripts/source-adapter-proposal.mjs',
  'tests/source-probe.test.mjs',
  'tests/source-repair.test.mjs',
  'tests/source-repair-closed-loop.test.mjs',
  'tests/source-adapter-proposal.test.mjs',
  'tests/proposal-executor.test.mjs',
  'tests/self-heal-sources.test.mjs',
]);
const DEFAULT_TEST_COMMANDS = Object.freeze([
  'node --test tests/source-probe.test.mjs tests/source-repair.test.mjs tests/source-repair-closed-loop.test.mjs tests/source-adapter-proposal.test.mjs',
  'node --test tests/proposal-executor.test.mjs tests/self-heal-sources.test.mjs',
]);
const DEFAULT_REPAIRABLE_NEXT_ACTIONS = Object.freeze(['manual-adapter', 'reject']);

function normalizeString(value) {
  return String(value || '').trim();
}

function repairableNextActions() {
  const configured = String(process.env.SOURCE_CODE_REPAIR_NEXT_ACTIONS || '')
    .split(',')
    .map((item) => normalizeString(item).toLowerCase())
    .filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_REPAIRABLE_NEXT_ACTIONS);
}

function parseJsonLinesForLastAgentMessage(stdout) {
  let message = '';
  for (const rawLine of String(stdout || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed?.type === 'item.completed' && parsed?.item?.type === 'agent_message') {
        message = String(parsed.item.text || '').trim();
      }
    } catch {
      // Ignore non-JSON log lines.
    }
  }
  return message || String(stdout || '').trim();
}

export function buildCodexSourceCodeRepairPrompt({
  url,
  theme = 'general',
  name = '',
  reason = '',
  probe = null,
  repair = null,
  rootCause = null,
  allowedFiles = DEFAULT_ALLOWED_FILES,
  testCommands = DEFAULT_TEST_COMMANDS,
} = {}) {
  return [
    'You are Codex, running as the source-ingestion code repair agent for Lattice Current.',
    'Do not use Claude Code or Anthropic tooling. Use the local repository and edit files directly.',
    '',
    'Goal:',
    'Fix the source ingestion code so this class of source failure can be handled automatically in the future.',
    'Prefer generic adapters, discovery logic, parser improvements, quality-gate fixes, or tests over hard-coded one-off URLs.',
    '',
    'Strict write scope:',
    ...allowedFiles.map((file) => `- ${file}`),
    '',
    'Rules:',
    '- Do not edit data files, secrets, package lock files, or unrelated UI files.',
    '- Do not touch NAS data, database migrations, or production credentials.',
    '- Do not commit or push.',
    '- If no safe generic code repair is possible, write no code and return a JSON result explaining why.',
    '- Keep changes source-ingestion related and small enough to review.',
    '',
    'Required verification commands:',
    ...testCommands.map((command) => `- ${command}`),
    '',
    'Failed source context:',
    `URL: ${url}`,
    `Name: ${name || '(none)'}`,
    `Theme: ${theme}`,
    `Reason: ${reason || '(none)'}`,
    '',
    'Probe result JSON:',
    JSON.stringify(probe || {}, null, 2),
    '',
    'Structured root-cause analysis JSON:',
    JSON.stringify(rootCause || {}, null, 2),
    '',
    'Previous automatic URL repair attempt JSON:',
    JSON.stringify(repair || {}, null, 2),
    '',
    'Return final answer as JSON only:',
    '{',
    '  "status": "patched|no-safe-patch|failed",',
    '  "changedFiles": [],',
    '  "testsRun": [],',
    '  "summary": "...",',
    '  "residualRisk": "..."',
    '}',
  ].join('\n');
}

export async function runCodexSourceCodeRepair(request = {}) {
  const artifactDir = path.resolve(normalizeString(request.artifactDir) || DEFAULT_ARTIFACT_DIR);
  await mkdir(artifactDir, { recursive: true });
  const runId = normalizeString(request.runId) || `source-code-repair-${Date.now()}-${randomUUID()}`;
  const prompt = buildCodexSourceCodeRepairPrompt(request);
  const promptPath = path.join(artifactDir, `${runId}.prompt.txt`);
  await writeFile(promptPath, prompt, 'utf8');

  if (request.dryRun) {
    return {
      queued: false,
      dryRun: true,
      runId,
      promptPath,
      prompt,
    };
  }

  const command = await resolveCodexCommand();
  const args = ['exec'];
  const model = normalizeString(process.env.CODEX_SOURCE_CODE_REPAIR_MODEL || process.env.CODEX_MODEL);
  if (model) args.push('--model', model);
  args.push('--json', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--full-auto');

  const startedAt = new Date().toISOString();
  const result = await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: path.resolve(normalizeString(request.cwd) || process.cwd()),
      env: getSafeEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, Math.max(30_000, Number(request.timeoutMs || process.env.CODEX_SOURCE_CODE_REPAIR_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)));

    child.stdin?.write(prompt);
    child.stdin?.end();
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const message = parseJsonLinesForLastAgentMessage(stdout);
      resolve({
        code: Number(code ?? 1),
        signal,
        stdout,
        stderr,
        message,
        parsed: parseJsonObject(message),
      });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        code: 1,
        signal: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        message: '',
        parsed: null,
      });
    });
  });

  const finishedAt = new Date().toISOString();
  const resultPath = path.join(artifactDir, `${runId}.result.json`);
  await writeFile(resultPath, `${JSON.stringify({
    runId,
    startedAt,
    finishedAt,
    request: {
      url: request.url,
      theme: request.theme,
      name: request.name,
      reason: request.reason,
      rootCause: request.rootCause || null,
    },
    ...result,
  }, null, 2)}\n`, 'utf8');

  return {
    queued: false,
    runId,
    promptPath,
    resultPath,
    ...result,
  };
}

async function lockIsFresh(lockPath) {
  if (!existsSync(lockPath)) return false;
  try {
    const raw = await readFile(lockPath, 'utf8');
    const parsed = JSON.parse(raw);
    const createdAt = Date.parse(parsed.createdAt || '');
    return Number.isFinite(createdAt) && Date.now() - createdAt < 30 * 60 * 1000;
  } catch {
    return false;
  }
}

export async function queueCodexSourceCodeRepair(request = {}) {
  const enabled = process.env.SOURCE_CODE_REPAIR_CODEX_ENABLED !== 'false';
  if (!enabled) {
    return { queued: false, reason: 'SOURCE_CODE_REPAIR_CODEX_ENABLED=false' };
  }
  const nextAction = normalizeString(request.probe?.nextAction).toLowerCase() || 'unknown';
  const repairable = repairableNextActions();
  if (!repairable.has(nextAction)) {
    return { queued: false, reason: `probe nextAction is ${nextAction}` };
  }

  const artifactDir = path.resolve(normalizeString(request.artifactDir) || DEFAULT_ARTIFACT_DIR);
  await mkdir(artifactDir, { recursive: true });
  const runId = normalizeString(request.runId) || `source-code-repair-${Date.now()}-${randomUUID()}`;
  if (request.dryRun) {
    return {
      queued: true,
      dryRun: true,
      runId,
      reason: `would queue codex source-code repair for ${nextAction}`,
      nextAction,
    };
  }
  const lockPath = path.join(artifactDir, '.codex-source-code-repair.lock');
  if (await lockIsFresh(lockPath)) {
    return { queued: false, reason: 'codex source-code repair already running', lockPath };
  }

  const requestPath = path.join(artifactDir, `${runId}.request.json`);
  await writeFile(requestPath, `${JSON.stringify({ ...request, runId, artifactDir }, null, 2)}\n`, 'utf8');
  await writeFile(lockPath, `${JSON.stringify({ runId, requestPath, createdAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');

  const child = spawn(process.execPath, [
    path.resolve('scripts', 'codex-source-code-repair.mjs'),
    '--request',
    requestPath,
    '--lock',
    lockPath,
  ], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  return {
    queued: true,
    runId,
    pid: child.pid || null,
    requestPath,
    lockPath,
  };
}

export async function releaseCodexSourceCodeRepairLock(lockPath) {
  if (!lockPath) return;
  await rm(lockPath, { force: true }).catch(() => {});
}
