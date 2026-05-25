import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const AUTOMATION_RUNTIME_SUPERVISOR_VERSION = 'automation-runtime-supervisor-v1';
export const DEFAULT_AUTOMATION_RUNTIME_SUPERVISOR_PATH = path.join(process.cwd(), 'data', 'runtime', 'automation-runtime-supervisor.latest.json');

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function newestDate(values = []) {
  return asArray(values).map(parseDate).filter(Boolean).sort((a, b) => b.getTime() - a.getTime())[0] || null;
}

function daemonHeartbeatStatus(daemonState = {}, nowDate = new Date()) {
  const heartbeat = daemonState?.heartbeat || {};
  const heartbeatAt = parseDate(heartbeat.masterDaemonAt || heartbeat.at || heartbeat.updatedAt);
  const freshWindowMs = 10 * 60 * 1000;
  const heartbeatFresh = Boolean(heartbeatAt && (nowDate.getTime() - heartbeatAt.getTime()) <= freshWindowMs);
  const heartbeatObserved = Boolean(heartbeat?.pid || heartbeatAt);
  return {
    heartbeatObserved,
    heartbeatFresh,
    heartbeatAt: heartbeatAt?.toISOString() || null,
    pid: heartbeat?.pid || null,
    mode: heartbeat?.mode || null,
    taskAllowlist: heartbeat?.taskAllowlist || [],
    daemonNotRunning: heartbeatObserved && !heartbeatFresh,
  };
}

function zeroBoundary(extra = {}) {
  return {
    providerActivationWrites: 0,
    sourceRegistryWrites: 0,
    canonicalWrites: 0,
    readinessPromotionWrites: 0,
    reportCandidateWrites: 0,
    portfolioActionWrites: 0,
    ...extra,
  };
}

function addBoundary(a = {}, b = {}) {
  const out = zeroBoundary(a);
  for (const key of Object.keys(out)) out[key] = Number(out[key] || 0) + Number(b[key] || 0);
  return out;
}

function boundaryFromArtifact(artifact = {}) {
  return zeroBoundary(artifact.boundaries || artifact.mutationBoundaries || artifact.boundary || {});
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}

export function buildAutomationRuntimeStatus({
  daemonState = {},
  activationArtifact = null,
  backfillArtifact = null,
  repairLoopArtifact = null,
  reportSourceQuarantine = null,
  now = new Date(),
} = {}) {
  const nowDate = parseDate(now) || new Date();
  const taskRows = daemonState.lastRun && typeof daemonState.lastRun === 'object'
    ? Object.keys(daemonState.lastRun).map((taskName) => ({
      taskName,
      lastRun: daemonState.lastRun[taskName] || null,
      nextAttempt: daemonState.nextAttempt?.[taskName] || null,
      failure: daemonState.failures?.[taskName] || daemonState.taskResults?.[taskName]?.error || null,
      cooldown: daemonState.cooldown?.[taskName] || null,
      lockOwner: daemonState.lockOwner?.[taskName] || null,
      budgetUsed: daemonState.budgetUsed?.[taskName] || daemonState.taskResults?.[taskName]?.budgetUsed || null,
      mutationBoundary: zeroBoundary(daemonState.mutationBoundary?.[taskName] || daemonState.taskResults?.[taskName]?.mutationBoundary || daemonState.taskResults?.[taskName]?.mutationBoundaries || {}),
      taskResult: daemonState.taskResults?.[taskName] || null,
    }))
    : Object.entries(daemonState.tasks || daemonState || {})
      .filter(([, task]) => task && typeof task === 'object')
      .map(([taskName, task]) => ({
        taskName,
        lastRun: task.lastRun || task.last_run || null,
        nextAttempt: task.nextAttempt || task.next_attempt || null,
        failure: task.failure || task.error || null,
        cooldown: task.cooldown || null,
        lockOwner: task.lockOwner || task.lock_owner || null,
        budgetUsed: task.budgetUsed || task.budget_used || null,
        mutationBoundary: zeroBoundary(task.mutationBoundary || task.mutationBoundaries || {}),
        taskResult: task.taskResult || task.result || null,
      }));
  const latestDaemonRun = newestDate(taskRows.map((task) => task.lastRun));
  const autonomousTaskRows = taskRows.filter((task) => /autonomous|mechanism-seed|repair-loop|report-closure|report-backfill/i.test(task.taskName));
  const latestAutonomousRun = newestDate(autonomousTaskRows.map((task) => task.lastRun));
  const dbClosureBlocked = taskRows.some((task) => (
    /report-closure|report-backfill-drain/i.test(task.taskName)
    && /5433|EACCES|ECONNREFUSED|postgres|database/i.test(String(task.failure || task.taskResult?.error || ''))
  ));
  const heartbeat = daemonHeartbeatStatus(daemonState, nowDate);
  const staleDaemon = heartbeat.daemonNotRunning
    || !latestDaemonRun
    || (nowDate.getTime() - latestDaemonRun.getTime()) > 24 * 60 * 60 * 1000;
  const staleAutonomousCycle = autonomousTaskRows.length > 0 && (
    !latestAutonomousRun
    || (nowDate.getTime() - latestAutonomousRun.getTime()) > 2 * 60 * 60 * 1000
  );
  let boundaries = zeroBoundary();
  for (const artifact of [activationArtifact, backfillArtifact, repairLoopArtifact]) {
    if (artifact) boundaries = addBoundary(boundaries, boundaryFromArtifact(artifact));
  }
  const operatorRequiredActions = [];
  const activationCounts = activationArtifact?.summary || activationArtifact?.counts || {};
  if ((activationCounts.needsCredentialsCount || activationCounts.needsCredentials || 0) > 0) {
    operatorRequiredActions.push('enter_provider_credentials');
  }
  if ((activationCounts.needsFixtureCount || activationCounts.needsFixture || 0) > 0) {
    operatorRequiredActions.push('approve_provider_fixture');
  }
  if ((activationCounts.providerGapProposalRequiredCount || activationCounts.providerGapProposalRequired || 0) > 0) {
    operatorRequiredActions.push('review_provider_gap_proposals');
  }
  if (repairLoopArtifact?.stopReason && /operator_review|human_review|provider|credential|fixture/i.test(repairLoopArtifact.stopReason)) {
    operatorRequiredActions.push(repairLoopArtifact.stopReason);
  }
  return {
    ok: true,
    version: AUTOMATION_RUNTIME_SUPERVISOR_VERSION,
    generatedAt: nowDate.toISOString(),
    runtimeStatus: {
      daemonObserved: taskRows.length > 0,
      daemonHeartbeatObserved: heartbeat.heartbeatObserved,
      daemonHeartbeatFresh: heartbeat.heartbeatFresh,
      daemonNotRunning: heartbeat.daemonNotRunning,
      masterDaemonHeartbeatAt: heartbeat.heartbeatAt,
      masterDaemonPid: heartbeat.pid,
      masterDaemonMode: heartbeat.mode,
      daemonTaskCount: taskRows.length,
      latestDaemonRun: latestDaemonRun?.toISOString() || null,
      latestAutonomousRun: latestAutonomousRun?.toISOString() || null,
      staleDaemon,
      staleAutonomousCycle,
      dbClosureStatus: dbClosureBlocked ? 'db_closure_blocked' : 'available_or_not_checked',
      repairLoopMode: repairLoopArtifact?.mode || null,
      repairLoopStopReason: repairLoopArtifact?.stopReason || null,
      backfillTaskCount: backfillArtifact?.taskCount || 0,
      sourceProviderRecordCount: activationArtifact?.records?.length || 0,
      reportSourceQuarantineCount: reportSourceQuarantine?.activeQuarantineCount || 0,
    },
    taskRows,
    mutationBoundaries: boundaries,
    operatorRequiredActions: [...new Set(operatorRequiredActions)],
    nextRecommendedAction: staleDaemon
      ? 'restart_or_schedule_master_daemon'
      : staleAutonomousCycle
        ? 'run_autonomous_automation_cycle'
      : (repairLoopArtifact?.nextRecommendedAction || repairLoopArtifact?.nextAction || 'continue_execute_safe_repair_loop'),
    stopReason: staleDaemon
      ? 'daemon_stale_or_not_running'
      : staleAutonomousCycle
        ? 'autonomous_cycle_stale'
        : (repairLoopArtifact?.stopReason || null),
  };
}

export async function writeAutomationRuntimeStatus(payload, filePath = DEFAULT_AUTOMATION_RUNTIME_SUPERVISOR_PATH) {
  const artifactPath = await writeJson(filePath, payload);
  return { ...payload, artifactPath };
}

export async function loadAutomationRuntimeStatus(filePath = DEFAULT_AUTOMATION_RUNTIME_SUPERVISOR_PATH) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}
