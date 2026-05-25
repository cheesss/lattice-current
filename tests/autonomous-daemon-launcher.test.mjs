import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const launcherModuleUrl = pathToFileURL(path.resolve('scripts/start-autonomous-research-daemons.mjs')).href;

test('launcher falls back to heartbeat/artifact pid when process enumeration is unavailable', async () => {
  const originalCwd = process.cwd();
  const originalKill = process.kill;
  const tmpRoot = path.join(os.tmpdir(), `lattice-daemon-launcher-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const runtimeDir = path.join(tmpRoot, 'data', 'runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(path.join(runtimeDir, 'autonomous-daemon-launcher.latest.json'), JSON.stringify({
    startedPid: 42424,
    taskAllowlist: ['sidecar-health', 'report-closure'],
    launch: {
      command: 'node scripts/master-daemon.mjs --task-allowlist sidecar-health,report-closure',
    },
  }));
  writeFileSync(path.join(tmpRoot, 'data', 'daemon-state.json'), JSON.stringify({
    heartbeat: {
      pid: 42424,
      mode: 'persistent',
      taskAllowlist: ['sidecar-health', 'report-closure'],
    },
  }));

  try {
    process.chdir(tmpRoot);
    process.kill = ((pid, signal) => {
      if (signal === 0 && Number(pid) === 42424) return true;
      return originalKill(pid, signal);
    });
    const mod = await import(`${launcherModuleUrl}?t=${Date.now()}`);
    const plan = mod.buildLauncherPlan({
      taskAllowlist: ['sidecar-health', 'report-closure'],
    });
    assert.equal(plan.alreadyRunning, true);
    assert.deepEqual(plan.existingPids, [42424]);
  } finally {
    process.kill = originalKill;
    process.chdir(originalCwd);
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('readHeartbeatPeer rejects stale heartbeat even when pid is alive', async () => {
  const originalCwd = process.cwd();
  const originalKill = process.kill;
  const tmpRoot = path.join(os.tmpdir(), `lattice-daemon-heartbeat-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
  writeFileSync(path.join(tmpRoot, 'data', 'daemon-state.json'), JSON.stringify({
    heartbeat: {
      pid: 43434,
      mode: 'persistent',
      taskAllowlist: ['sidecar-health', 'report-closure'],
      masterDaemonAt: '2026-05-20T00:00:00.000Z',
    },
  }));

  try {
    process.chdir(tmpRoot);
    process.kill = ((pid, signal) => {
      if (signal === 0 && Number(pid) === 43434) return true;
      return originalKill(pid, signal);
    });
    const mod = await import(`${launcherModuleUrl}?t=${Date.now()}`);
    const peer = mod.readHeartbeatPeer(['sidecar-health', 'report-closure'], {
      freshWindowMs: 60_000,
    });
    assert.equal(peer, null);
  } finally {
    process.kill = originalKill;
    process.chdir(originalCwd);
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('waitForHeartbeatVerification accepts fresh matching heartbeat', async () => {
  const originalCwd = process.cwd();
  const originalKill = process.kill;
  const tmpRoot = path.join(os.tmpdir(), `lattice-daemon-verify-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });

  try {
    process.chdir(tmpRoot);
    process.kill = ((pid, signal) => {
      if (signal === 0 && Number(pid) === 45454) return true;
      return originalKill(pid, signal);
    });
    const mod = await import(`${launcherModuleUrl}?t=${Date.now()}`);
    const startedAfterMs = Date.now() - 1_000;
    writeFileSync(path.join(tmpRoot, 'data', 'daemon-state.json'), JSON.stringify({
      heartbeat: {
        pid: 45454,
        mode: 'persistent',
        taskAllowlist: ['sidecar-health', 'report-closure'],
        masterDaemonAt: new Date().toISOString(),
      },
    }));
    const verification = await mod.waitForHeartbeatVerification(['sidecar-health', 'report-closure'], {
      startedAfterMs,
      timeoutMs: 250,
      pollMs: 50,
    });
    assert.equal(verification.ok, true);
    assert.equal(verification.pid, 45454);
  } finally {
    process.kill = originalKill;
    process.chdir(originalCwd);
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('launcher uses Start-Process with redirected logs for Windows persistent mode', async () => {
  const mod = await import(`${launcherModuleUrl}?t=${Date.now()}`);
  const command = mod.buildWindowsStartProcessCommand('C:\\Program Files\\nodejs\\node.exe', [
    'scripts/master-daemon.mjs',
    '--task-allowlist',
    'sidecar-health,report-closure',
  ], {
    stdoutPath: 'data/runtime/autonomous-daemon-logs/stdout.log',
    stderrPath: 'data/runtime/autonomous-daemon-logs/stderr.log',
  });
  assert.match(command, /Start-Process -FilePath/);
  assert.match(command, /-RedirectStandardOutput \$stdout/);
  assert.match(command, /-RedirectStandardError \$stderr/);
  assert.match(command, /-WindowStyle Hidden/);
  assert.match(command, /ConvertTo-Json -Compress/);
});
