#!/usr/bin/env node
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AUTONOMOUS_DAEMON_LAUNCHER_VERSION = 'autonomous-daemon-launcher-v1';
export const AUTONOMOUS_DAEMON_LAUNCHER_ARTIFACT = path.join(process.cwd(), 'data', 'runtime', 'autonomous-daemon-launcher.latest.json');
export const MASTER_DAEMON_STATE_PATH = path.join(process.cwd(), 'data', 'daemon-state.json');
export const AUTONOMOUS_DAEMON_LOG_DIR = path.join(process.cwd(), 'data', 'runtime', 'autonomous-daemon-logs');
export const DEFAULT_HEARTBEAT_FRESH_MS = 10 * 60 * 1000;
export const DEFAULT_HEARTBEAT_VERIFY_TIMEOUT_MS = 15_000;
export const DEFAULT_HEARTBEAT_VERIFY_POLL_MS = 250;

export const DEFAULT_RESEARCH_OS_TASK_ALLOWLIST = Object.freeze([
  'sidecar-health',
  'data-accumulator-health',
  'mechanism-seed-generation',
  'autonomous-automation-cycle',
  'autonomous-research-repair-loop-execute-safe',
  'report-backfill-drain',
  'report-closure',
]);

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    once: false,
    allowExisting: true,
    writeArtifact: true,
    taskAllowlist: [...DEFAULT_RESEARCH_OS_TASK_ALLOWLIST],
    stagedProviderMaxTargets: 3,
    stagedProviderTimeoutMs: 5000,
    automationCycleLimit: 25,
    reportClosureReportLimit: 1,
    reportClosureLimit: 12,
    reportClosureTimeoutMs: 600000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--once') out.once = true;
    else if (arg === '--no-write') out.writeArtifact = false;
    else if (arg === '--fail-if-existing') out.allowExisting = false;
    else if (arg === '--task-allowlist') out.taskAllowlist = compact(next()).split(',').map((item) => item.trim()).filter(Boolean);
    else if (arg === '--staged-provider-max-targets') out.stagedProviderMaxTargets = Number(next() || out.stagedProviderMaxTargets);
    else if (arg === '--staged-provider-timeout-ms') out.stagedProviderTimeoutMs = Number(next() || out.stagedProviderTimeoutMs);
    else if (arg === '--automation-cycle-limit') out.automationCycleLimit = Number(next() || out.automationCycleLimit);
    else if (arg === '--report-closure-report-limit') out.reportClosureReportLimit = Number(next() || out.reportClosureReportLimit);
    else if (arg === '--report-closure-limit') out.reportClosureLimit = Number(next() || out.reportClosureLimit);
    else if (arg === '--report-closure-timeout-ms') out.reportClosureTimeoutMs = Number(next() || out.reportClosureTimeoutMs);
    else if (arg === '--disable-report-closure') out.taskAllowlist = out.taskAllowlist.filter((task) => task !== 'report-closure');
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--task-allowlist=')) out.taskAllowlist = compact(arg.slice('--task-allowlist='.length)).split(',').map((item) => item.trim()).filter(Boolean);
    else if (arg.startsWith('--staged-provider-max-targets=')) out.stagedProviderMaxTargets = Number(arg.slice('--staged-provider-max-targets='.length));
    else if (arg.startsWith('--staged-provider-timeout-ms=')) out.stagedProviderTimeoutMs = Number(arg.slice('--staged-provider-timeout-ms='.length));
    else if (arg.startsWith('--automation-cycle-limit=')) out.automationCycleLimit = Number(arg.slice('--automation-cycle-limit='.length));
    else if (arg.startsWith('--report-closure-report-limit=')) out.reportClosureReportLimit = Number(arg.slice('--report-closure-report-limit='.length));
    else if (arg.startsWith('--report-closure-limit=')) out.reportClosureLimit = Number(arg.slice('--report-closure-limit='.length));
    else if (arg.startsWith('--report-closure-timeout-ms=')) out.reportClosureTimeoutMs = Number(arg.slice('--report-closure-timeout-ms='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function helpText() {
  return `Usage:
  node scripts/start-autonomous-research-daemons.mjs
  node scripts/start-autonomous-research-daemons.mjs --once

Starts a persistent master-daemon constrained to the autonomous research OS
task allowlist. It does not start the full dashboard/event/news daemon set.

Default task allowlist:
  ${DEFAULT_RESEARCH_OS_TASK_ALLOWLIST.join(', ')}

Report closure is included, but the launcher forces small default limits
so the continuous repair/evidence loop cannot be blocked by a broad
all-reports closure pass.
`;
}

function listRunningNodeProcesses(scriptFragment) {
  const fragment = String(scriptFragment || '').trim();
  if (!fragment) return [];
  try {
    if (process.platform === 'win32') {
      const escaped = fragment.replace(/'/g, "''");
      const output = execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match '${escaped}' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"`,
        {
          stdio: 'pipe',
          timeout: 20_000,
          cwd: process.cwd(),
          windowsHide: true,
        },
      ).toString('utf8').trim();
      if (!output) return [];
      const parsed = JSON.parse(output);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows
        .map((row) => ({
          pid: Number(row?.ProcessId || 0),
          commandLine: String(row?.CommandLine || ''),
        }))
        .filter((row) => row.pid > 0 && row.pid !== process.pid);
    }
    const output = execSync(`pgrep -af "${fragment.replace(/"/g, '\\"')}"`, {
      stdio: 'pipe',
      timeout: 20_000,
      cwd: process.cwd(),
      windowsHide: true,
    }).toString('utf8').trim();
    if (!output) return [];
    return output.split(/\r?\n/).map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      return match ? { pid: Number(match[1]), commandLine: match[2] } : null;
    }).filter((row) => row && row.pid > 0 && row.pid !== process.pid);
  } catch {
    return [];
  }
}

function readJsonFileSafe(filePath, fallback = null) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function isPidAlive(pid) {
  const normalizedPid = Number(pid || 0);
  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0 || normalizedPid === process.pid) return false;
  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch {
    return false;
  }
}

function normalizePeer(row, reason) {
  const pid = Number(row?.pid || 0);
  if (!isPidAlive(pid)) return null;
  return {
    pid,
    commandLine: String(row?.commandLine || ''),
    reason,
  };
}

function peerMap(rows = []) {
  const map = new Map();
  for (const row of rows) {
    if (!row?.pid || map.has(row.pid)) continue;
    map.set(row.pid, row);
  }
  return map;
}

function matchAllowlist(row, taskAllowlist) {
  const expected = taskAllowlist.join(',');
  const commandLine = String(row?.commandLine || '');
  if (commandLine && commandLine.includes('--task-allowlist')) {
    return commandLine.includes(expected);
  }
  const heartbeatAllowlist = Array.isArray(row?.taskAllowlist) ? row.taskAllowlist : [];
  return heartbeatAllowlist.join(',') === expected;
}

function parseTimestampMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function readHeartbeatPeer(taskAllowlist = DEFAULT_RESEARCH_OS_TASK_ALLOWLIST, options = {}) {
  const daemonState = readJsonFileSafe(MASTER_DAEMON_STATE_PATH, null);
  const heartbeat = daemonState?.heartbeat || null;
  if (!heartbeat?.pid || heartbeat?.mode !== 'persistent' || !matchAllowlist(heartbeat, taskAllowlist)) {
    return null;
  }
  const freshWindowMs = Number(options.freshWindowMs || DEFAULT_HEARTBEAT_FRESH_MS);
  const heartbeatAtMs = parseTimestampMs(heartbeat.masterDaemonAt);
  if (freshWindowMs > 0 && heartbeatAtMs > 0 && (Date.now() - heartbeatAtMs) > freshWindowMs) {
    return null;
  }
  const pid = Number(heartbeat.pid || 0);
  const requirePidAlive = options.requirePidAlive ?? (process.platform !== 'win32');
  if (requirePidAlive && !isPidAlive(pid)) return null;
  return {
    pid,
    commandLine: '',
    taskAllowlist: heartbeat.taskAllowlist,
    heartbeatAt: heartbeat.masterDaemonAt || null,
    reason: 'daemon-heartbeat',
  };
}

function fallbackResearchDaemonPeers(taskAllowlist = DEFAULT_RESEARCH_OS_TASK_ALLOWLIST) {
  const peers = [];
  const launcherArtifact = readJsonFileSafe(AUTONOMOUS_DAEMON_LAUNCHER_ARTIFACT, null);
  if (launcherArtifact?.startedPid && matchAllowlist(launcherArtifact, taskAllowlist)) {
    peers.push(normalizePeer({
      pid: launcherArtifact.startedPid,
      commandLine: launcherArtifact?.launch?.command || '',
      taskAllowlist: launcherArtifact?.taskAllowlist,
    }, 'launcher-artifact'));
  }
  peers.push(readHeartbeatPeer(taskAllowlist));
  return Array.from(peerMap(peers.filter(Boolean)).values());
}

export async function waitForHeartbeatVerification(taskAllowlist = DEFAULT_RESEARCH_OS_TASK_ALLOWLIST, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs || DEFAULT_HEARTBEAT_VERIFY_TIMEOUT_MS));
  const pollMs = Math.max(50, Number(options.pollMs || DEFAULT_HEARTBEAT_VERIFY_POLL_MS));
  const startedAfterMs = Number(options.startedAfterMs || 0);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const peer = readHeartbeatPeer(taskAllowlist, { freshWindowMs: DEFAULT_HEARTBEAT_FRESH_MS });
    const heartbeatAtMs = parseTimestampMs(peer?.heartbeatAt);
    if (peer && (!startedAfterMs || heartbeatAtMs >= startedAfterMs)) {
      return {
        ok: true,
        pid: peer.pid,
        heartbeatAt: peer.heartbeatAt,
      };
    }
    if (pollMs <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return {
    ok: false,
    pid: null,
    heartbeatAt: null,
  };
}

function currentResearchDaemonPeers(taskAllowlist = DEFAULT_RESEARCH_OS_TASK_ALLOWLIST) {
  const allowlistText = taskAllowlist.join(',');
  const detected = listRunningNodeProcesses('master-daemon\\.mjs')
    .filter((row) => row.commandLine.includes('--task-allowlist'))
    .filter((row) => row.commandLine.includes(allowlistText));
  if (detected.length > 0) return detected;
  return fallbackResearchDaemonPeers(taskAllowlist);
}

function writeArtifact(payload, filePath = AUTONOMOUS_DAEMON_LAUNCHER_ARTIFACT) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}

function parseWindowsStartProcessPid(output) {
  try {
    const parsed = JSON.parse(String(output || '0').trim() || '0');
    const pid = Number(parsed);
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch {
    return 0;
  }
}

export function buildWindowsStartProcessCommand(command, args = [], options = {}) {
  const stdoutPath = path.resolve(options.stdoutPath || path.join(AUTONOMOUS_DAEMON_LOG_DIR, 'master-daemon.stdout.log'));
  const stderrPath = path.resolve(options.stderrPath || path.join(AUTONOMOUS_DAEMON_LOG_DIR, 'master-daemon.stderr.log'));
  const quotedCommand = JSON.stringify(String(command || ''));
  const quotedArgs = args.map((arg) => JSON.stringify(String(arg))).join(', ');
  const quotedCwd = JSON.stringify(path.resolve(process.cwd()));
  const quotedStdout = JSON.stringify(stdoutPath);
  const quotedStderr = JSON.stringify(stderrPath);
  return [
    '$ErrorActionPreference = "Stop"',
    `$cwd = ${quotedCwd}`,
    `$stdout = ${quotedStdout}`,
    `$stderr = ${quotedStderr}`,
    '[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($stdout)) | Out-Null',
    '[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($stderr)) | Out-Null',
    `$process = Start-Process -FilePath ${quotedCommand} -ArgumentList @(${quotedArgs}) -WorkingDirectory $cwd -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru`,
    '$process.Id | ConvertTo-Json -Compress',
  ].join('; ');
}

function launchMasterDaemon(options = {}) {
  const args = [
    'scripts/master-daemon.mjs',
    '--task-allowlist',
    options.taskAllowlist.join(','),
  ];
  if (options.once) args.push('--once');
  const env = {
    ...process.env,
    AUTONOMOUS_AUTOMATION_CYCLE_LIMIT: String(options.automationCycleLimit),
    AUTONOMOUS_STAGED_PROVIDER_MAX_TARGETS: String(options.stagedProviderMaxTargets),
    AUTONOMOUS_STAGED_PROVIDER_TIMEOUT_MS: String(options.stagedProviderTimeoutMs),
    AUTONOMOUS_REPAIR_LOOP_MAX_ITERATIONS: process.env.AUTONOMOUS_REPAIR_LOOP_MAX_ITERATIONS || '5',
    REPORT_CLOSURE_REPORT_LIMIT: String(options.reportClosureReportLimit),
    REPORT_CLOSURE_LIMIT: String(options.reportClosureLimit),
    REPORT_CLOSURE_TIMEOUT_MS: String(options.reportClosureTimeoutMs),
    REPORT_CLOSURE_REPORT_CONCURRENCY: process.env.REPORT_CLOSURE_REPORT_CONCURRENCY || '1',
    REPORT_CLOSURE_STEP_CONCURRENCY: process.env.REPORT_CLOSURE_STEP_CONCURRENCY || '1',
    REPORT_CLOSURE_PROVIDER_CONCURRENCY: process.env.REPORT_CLOSURE_PROVIDER_CONCURRENCY || '1',
    REPORT_CLOSURE_SOURCE_QUERY_CONCURRENCY: process.env.REPORT_CLOSURE_SOURCE_QUERY_CONCURRENCY || '1',
  };
  if (process.platform === 'win32' && !options.once) {
    mkdirSync(AUTONOMOUS_DAEMON_LOG_DIR, { recursive: true });
    const stdoutPath = path.join(AUTONOMOUS_DAEMON_LOG_DIR, 'master-daemon.stdout.log');
    const stderrPath = path.join(AUTONOMOUS_DAEMON_LOG_DIR, 'master-daemon.stderr.log');
    const launchCommand = `powershell -NoProfile -Command "${buildWindowsStartProcessCommand(process.execPath, args, {
      stdoutPath,
      stderrPath,
    }).replace(/"/g, '\\"')}"`;
    let output = '';
    try {
      output = execSync(launchCommand, {
        cwd: process.cwd(),
        env,
        stdio: 'pipe',
        timeout: 20_000,
        windowsHide: true,
      }).toString('utf8').trim();
    } catch (error) {
      output = String(error?.stdout || '').trim();
      const pidFromTimedOutShell = parseWindowsStartProcessPid(output);
      if (!(pidFromTimedOutShell > 0 && Number(error?.status) === 0)) {
        throw error;
      }
    }
    const pid = parseWindowsStartProcessPid(output);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`failed to launch Windows background daemon (pid=${output || 'unknown'})`);
    }
    return {
      pid,
      command: `${process.execPath} ${args.join(' ')}`,
      taskAllowlist: options.taskAllowlist,
      stdoutPath: path.resolve(stdoutPath),
      stderrPath: path.resolve(stderrPath),
      env: {
        AUTONOMOUS_AUTOMATION_CYCLE_LIMIT: env.AUTONOMOUS_AUTOMATION_CYCLE_LIMIT,
        AUTONOMOUS_STAGED_PROVIDER_MAX_TARGETS: env.AUTONOMOUS_STAGED_PROVIDER_MAX_TARGETS,
        AUTONOMOUS_STAGED_PROVIDER_TIMEOUT_MS: env.AUTONOMOUS_STAGED_PROVIDER_TIMEOUT_MS,
        AUTONOMOUS_REPAIR_LOOP_MAX_ITERATIONS: env.AUTONOMOUS_REPAIR_LOOP_MAX_ITERATIONS,
        REPORT_CLOSURE_REPORT_LIMIT: env.REPORT_CLOSURE_REPORT_LIMIT,
        REPORT_CLOSURE_LIMIT: env.REPORT_CLOSURE_LIMIT,
        REPORT_CLOSURE_TIMEOUT_MS: env.REPORT_CLOSURE_TIMEOUT_MS,
        REPORT_CLOSURE_REPORT_CONCURRENCY: env.REPORT_CLOSURE_REPORT_CONCURRENCY,
        REPORT_CLOSURE_STEP_CONCURRENCY: env.REPORT_CLOSURE_STEP_CONCURRENCY,
        REPORT_CLOSURE_PROVIDER_CONCURRENCY: env.REPORT_CLOSURE_PROVIDER_CONCURRENCY,
        REPORT_CLOSURE_SOURCE_QUERY_CONCURRENCY: env.REPORT_CLOSURE_SOURCE_QUERY_CONCURRENCY,
        DAEMON_START_SIDECAR: env.DAEMON_START_SIDECAR,
        DAEMON_START_ACCUMULATOR: env.DAEMON_START_ACCUMULATOR,
      },
    };
  }
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    detached: !options.once,
    stdio: options.once ? 'inherit' : 'ignore',
    windowsHide: true,
    env,
  });
  if (!options.once) child.unref();
  return {
    pid: child.pid,
    command: `${process.execPath} ${args.join(' ')}`,
    taskAllowlist: options.taskAllowlist,
    env: {
      AUTONOMOUS_AUTOMATION_CYCLE_LIMIT: env.AUTONOMOUS_AUTOMATION_CYCLE_LIMIT,
      AUTONOMOUS_STAGED_PROVIDER_MAX_TARGETS: env.AUTONOMOUS_STAGED_PROVIDER_MAX_TARGETS,
      AUTONOMOUS_STAGED_PROVIDER_TIMEOUT_MS: env.AUTONOMOUS_STAGED_PROVIDER_TIMEOUT_MS,
      AUTONOMOUS_REPAIR_LOOP_MAX_ITERATIONS: env.AUTONOMOUS_REPAIR_LOOP_MAX_ITERATIONS,
      REPORT_CLOSURE_REPORT_LIMIT: env.REPORT_CLOSURE_REPORT_LIMIT,
      REPORT_CLOSURE_LIMIT: env.REPORT_CLOSURE_LIMIT,
      REPORT_CLOSURE_TIMEOUT_MS: env.REPORT_CLOSURE_TIMEOUT_MS,
      REPORT_CLOSURE_REPORT_CONCURRENCY: env.REPORT_CLOSURE_REPORT_CONCURRENCY,
      REPORT_CLOSURE_STEP_CONCURRENCY: env.REPORT_CLOSURE_STEP_CONCURRENCY,
      REPORT_CLOSURE_PROVIDER_CONCURRENCY: env.REPORT_CLOSURE_PROVIDER_CONCURRENCY,
      REPORT_CLOSURE_SOURCE_QUERY_CONCURRENCY: env.REPORT_CLOSURE_SOURCE_QUERY_CONCURRENCY,
      DAEMON_START_SIDECAR: env.DAEMON_START_SIDECAR,
      DAEMON_START_ACCUMULATOR: env.DAEMON_START_ACCUMULATOR,
    },
  };
}

export function buildLauncherPlan(options = {}) {
  const taskAllowlist = options.taskAllowlist?.length ? options.taskAllowlist : [...DEFAULT_RESEARCH_OS_TASK_ALLOWLIST];
  const existing = currentResearchDaemonPeers(taskAllowlist);
  return {
    ok: true,
    version: AUTONOMOUS_DAEMON_LAUNCHER_VERSION,
    generatedAt: new Date().toISOString(),
    taskAllowlist,
    existingPids: existing.map((row) => row.pid),
    alreadyRunning: existing.length > 0,
    mode: options.once ? 'once' : 'persistent',
    mutationBoundary: {
      providerActivationWrites: 0,
      sourceRegistryWrites: 0,
      canonicalWrites: 0,
      readinessPromotionWrites: 0,
      reportCandidateWrites: 0,
      portfolioActionWrites: 0,
    },
  };
}

export async function runAutonomousDaemonLauncher(options = {}) {
  const plan = buildLauncherPlan(options);
  let launch = null;
  let status = 'already_running';
  let verification = {
    ok: plan.alreadyRunning,
    pid: plan.existingPids[0] || null,
    heartbeatAt: null,
  };
  if (!plan.alreadyRunning || options.once) {
    const startedAfterMs = Date.now();
    launch = launchMasterDaemon({ ...options, taskAllowlist: plan.taskAllowlist });
    status = options.once ? 'started_once' : 'started_persistent';
    if (!options.once) {
      verification = await waitForHeartbeatVerification(plan.taskAllowlist, {
        startedAfterMs,
        timeoutMs: options.verifyTimeoutMs,
        pollMs: options.verifyPollMs,
      });
      if (!verification.ok) status = 'launch_unverified';
    } else {
      verification = { ok: true, pid: launch?.pid || null, heartbeatAt: null };
    }
  } else if (options.allowExisting === false) {
    status = 'blocked_existing_process';
  }
  const payload = {
    ...plan,
    ok: plan.ok && verification.ok,
    status,
    launched: Boolean(launch),
    launch,
    verification,
    startedPid: launch?.pid || null,
    artifactPath: null,
  };
  if (options.writeArtifact !== false) {
    payload.artifactPath = path.resolve(AUTONOMOUS_DAEMON_LAUNCHER_ARTIFACT);
    writeArtifact(payload);
  }
  return payload;
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const result = await runAutonomousDaemonLauncher(options);
  process.stdout.write(`${JSON.stringify({
    ok: result.ok,
    status: result.status,
    mode: result.mode,
    alreadyRunning: result.alreadyRunning,
    existingPids: result.existingPids,
    startedPid: result.startedPid,
    verification: result.verification,
    taskAllowlist: result.taskAllowlist,
    mutationBoundary: result.mutationBoundary,
    artifactPath: result.artifactPath,
  }, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
