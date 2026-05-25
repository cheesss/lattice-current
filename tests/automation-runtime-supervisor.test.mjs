import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAutomationRuntimeStatus,
} from '../scripts/_shared/automation-runtime-supervisor.mjs';

test('runtime supervisor surfaces stale daemon and operator actions', () => {
  const payload = buildAutomationRuntimeStatus({
    now: new Date('2026-05-22T00:00:00.000Z'),
    daemonState: {
      tasks: {
        'mechanism-seed-generation': {
          lastRun: '2026-05-20T00:00:00.000Z',
          failure: null,
          budgetUsed: { executions: 1, maxExecutions: 3 },
          mutationBoundary: { canonicalWrites: 0 },
        },
      },
    },
    activationArtifact: {
      summary: {
        needsCredentialsCount: 1,
        needsFixtureCount: 1,
        providerGapProposalRequiredCount: 1,
      },
      boundaries: { sourceRegistryWrites: 1 },
    },
    backfillArtifact: {
      taskCount: 4,
      mutationBoundaries: { rawEvidenceWrites: 4 },
    },
    repairLoopArtifact: {
      mode: 'execute-safe',
      stopReason: 'operator_review_required_provider_gap',
      mutationBoundaries: { readinessPromotionWrites: 0 },
    },
  });
  assert.equal(payload.runtimeStatus.staleDaemon, true);
  assert.equal(payload.runtimeStatus.backfillTaskCount, 4);
  assert.equal(payload.operatorRequiredActions.includes('enter_provider_credentials'), true);
  assert.equal(payload.operatorRequiredActions.includes('approve_provider_fixture'), true);
  assert.equal(payload.operatorRequiredActions.includes('review_provider_gap_proposals'), true);
  assert.equal(payload.mutationBoundaries.canonicalWrites, 0);
  assert.deepEqual(payload.taskRows[0].budgetUsed, { executions: 1, maxExecutions: 3 });
  assert.equal(payload.taskRows[0].mutationBoundary.canonicalWrites, 0);
});

test('runtime supervisor keeps promotion and portfolio boundaries explicit', () => {
  const payload = buildAutomationRuntimeStatus({
    now: new Date('2026-05-22T00:00:00.000Z'),
    daemonState: { tasks: { repair: { lastRun: '2026-05-21T23:59:00.000Z' } } },
    repairLoopArtifact: { mode: 'execute-safe', stopReason: 'max_iterations_reached' },
  });
  assert.equal(payload.mutationBoundaries.readinessPromotionWrites, 0);
  assert.equal(payload.mutationBoundaries.reportCandidateWrites, 0);
  assert.equal(payload.mutationBoundaries.portfolioActionWrites, 0);
  assert.equal(payload.nextRecommendedAction, 'continue_execute_safe_repair_loop');
});

test('runtime supervisor separates stale daemon heartbeat from DB closure blocker', () => {
  const payload = buildAutomationRuntimeStatus({
    now: new Date('2026-05-25T04:00:00.000Z'),
    daemonState: {
      heartbeat: {
        pid: 1234,
        mode: 'persistent',
        masterDaemonAt: '2026-05-25T03:00:00.000Z',
      },
      lastRun: {
        'autonomous-automation-cycle': Date.parse('2026-05-25T03:30:00.000Z'),
        'report-closure': Date.parse('2026-05-25T03:40:00.000Z'),
      },
      failures: {
        'report-closure': 'connect EACCES 192.168.0.2:5433',
      },
      taskResults: {
        'report-closure': {
          ok: false,
          error: 'connect EACCES 192.168.0.2:5433',
        },
      },
    },
  });

  assert.equal(payload.runtimeStatus.daemonHeartbeatObserved, true);
  assert.equal(payload.runtimeStatus.daemonHeartbeatFresh, false);
  assert.equal(payload.runtimeStatus.daemonNotRunning, true);
  assert.equal(payload.runtimeStatus.dbClosureStatus, 'db_closure_blocked');
  assert.equal(payload.stopReason, 'daemon_stale_or_not_running');
});
