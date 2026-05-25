import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HOUR_2_MS,
  DAEMON_TASK_INTERVALS_MS,
} from '../scripts/_shared/daemon-contract.mjs';

const source = readFileSync(new URL('../scripts/master-daemon.mjs', import.meta.url), 'utf-8');
const accumulatorSource = readFileSync(new URL('../scripts/data-accumulator.mjs', import.meta.url), 'utf-8');

test('master daemon includes circuit breaker and pending outcome resolution', () => {
  assert.match(source, /CIRCUIT_BREAKER_FAILS/);
  assert.match(source, /computeCircuitBackoffMs/);
  assert.match(source, /normalizeDaemonState/);
  assert.match(source, /cleared stale serialization_failed circuit/);
  assert.match(source, /checkPendingOutcomes/);
  assert.match(source, /dashboard-health/);
  assert.match(source, /sidecar-health/);
  assert.match(source, /taskSidecarHealth/);
  assert.match(source, /SIDECAR_HEALTH_URL/);
  assert.match(source, /DAEMON_START_SIDECAR/);
  assert.match(source, /data-accumulator-health/);
  assert.match(source, /taskDataAccumulatorHealth/);
  assert.match(source, /DAEMON_START_ACCUMULATOR/);
  assert.match(source, /data-accumulator\.mjs/);
  assert.match(source, /src-tauri\/sidecar\/local-api-server\.mjs/);
  assert.match(source, /windowsHide: true/);
  assert.match(source, /db-health/);
  assert.match(source, /daily-backup/);
  assert.match(source, /LEGACY_DUCKDB_SYNC_ENABLED/);
  assert.match(source, /ENABLE_LEGACY_DUCKDB_SYNC/);
  assert.match(source, /data-quality/);
  assert.match(source, /arxiv-backfill/);
  assert.match(source, /hackernews-backfill/);
  assert.match(source, /discover-emerging-tech/);
  assert.match(source, /label-discovery-topics/);
  assert.match(source, /generate-tech-report/);
  assert.match(source, /migrate-taxonomy/);
  assert.match(source, /compute-trend-aggregates/);
  assert.match(source, /curate-daily-news/);
  assert.match(source, /sec-seed-universe/);
  assert.match(source, /generate-followed-theme-briefings/);
  assert.match(source, /openalex-theme-evidence/);
  assert.match(source, /--summary-only/);
  assert.match(source, /github-theme-evidence/);
  assert.match(source, /generate-structural-alerts/);
  assert.match(source, /refresh-event-market-transmission/);
  assert.match(source, /generate-codex-theme-proposals/);
  assert.match(source, /generate-weekly-digest/);
  assert.match(source, /auto-curate/);
  assert.match(source, /coverage-gap-analysis/);
  assert.match(source, /source-self-heal/);
  assert.match(source, /self-heal-sources\.mjs --limit 1/);
  assert.match(source, /sendAlert/);
  assert.match(source, /unhandledRejection/);
  assert.match(source, /createLogger/);
  assert.match(source, /task\.duration_ms/);
  assert.match(source, /backfill-new-sources\.mjs --source fred/);
  assert.match(source, /const periods = \['week', 'month', 'quarter', 'year'\]/);
  assert.match(source, /refresh-event-market-transmission\.mjs --days 14 --limit 180/);
  assert.match(source, /DASHBOARD_HEALTH_TIMEOUT_MS/);
  assert.match(source, /DUCKDB_SYNC_TIMEOUT_MS/);
  assert.match(source, /RUN_MAX_BUFFER_BYTES/);
  assert.match(source, /maxBuffer: RUN_MAX_BUFFER_BYTES/);
  assert.match(source, /optionalTimeoutMs/);
  assert.match(source, /timeoutLabel/);
  assert.match(source, /EXTERNAL_PROVIDER_BACKFILL_TIMEOUT_MS, 0/);
  assert.match(source, /UNIVERSAL_RESEARCH_TIMEOUT_MS, 0/);
  assert.match(source, /UNIVERSAL_RESEARCH_ADJACENT_EXPANSION/);
  assert.match(source, /UNIVERSAL_RESEARCH_ADJACENT_LIMIT/);
  assert.match(source, /UNIVERSAL_RESEARCH_AUTO_REPORT_MODE/);
  assert.match(source, /--adjacent-expansion/);
  assert.match(source, /--adjacent-limit/);
  assert.match(source, /--auto-report-mode/);
  assert.match(source, /listRunningNodeProcesses/);
  assert.match(source, /\.\.\.\(LEGACY_DUCKDB_SYNC_ENABLED/);
  assert.match(source, /duckdb-sync: skipped; set ENABLE_LEGACY_DUCKDB_SYNC=true/);
  assert.match(source, /duckdb-sync: skip because another sync process is already running/);
  assert.match(source, /markHeartbeat/);
  assert.match(source, /const ONCE = process\.argv\.includes\('--once'\) \|\| Boolean\(TASK_ONLY\)/);
  assert.match(source, /--task-allowlist/);
  assert.match(source, /DAEMON_TASK_ALLOWLIST/);
  assert.match(source, /TASK_ALLOWLIST\.size && !TASK_ALLOWLIST\.has\(taskName\)/);
  assert.match(source, /Unknown task\(s\) in --task-allowlist\/DAEMON_TASK_ALLOWLIST/);
  assert.match(source, /findPersistentMasterDaemonPeers/);
  assert.match(source, /refusing duplicate persistent daemon/);
  assert.match(source, /event-engine-incremental/);
  assert.match(source, /incremental-event-engine-fast\.mjs --skip-controls/);
  assert.match(source, /meta-model-infer: refresh event features/);
  assert.match(source, /metric_mismatch_count/);
  assert.match(source, /metric mismatches/);
  assert.match(source, /research-os-cycle/);
  assert.match(source, /run-research-os-cycle\.mjs/);
  assert.match(source, /ordered incoming->questions->evidence->relations->candidates cycle/);
  assert.match(source, /schedule-intelligence-reports/);
  assert.match(source, /scripts\/schedule-intelligence-reports\.mjs/);
  assert.match(source, /report-backfill-drain/);
  assert.match(source, /scripts\/drain-report-backfill-tasks\.mjs/);
  assert.match(source, /report-closure/);
  assert.match(source, /scripts\/run-evidence-contract-backfill-cycle\.mjs/);
  assert.match(source, /--auto-report-source-query/);
  assert.match(source, /--market-validation/);
  assert.match(source, /artifactPath/);
  assert.match(source, /REPORT_BACKFILL_DRAIN_LIMIT/);
  assert.match(source, /review-gated source-query approvals/);
  assert.match(source, /generic-kpi-collection/);
  assert.match(source, /scripts\/run-generic-kpi-collection\.mjs/);
  assert.match(source, /GENERIC_KPI_COLLECTION_LIMIT/);
  assert.match(source, /mechanism-seed-generation/);
  assert.match(source, /scripts\/run-mechanism-seed-daemon-cycle\.mjs/);
  assert.match(source, /MECHANISM_SEED_GENERATION_LIMIT/);
  assert.match(source, /MECHANISM_SEED_DAEMON_SKIP_STORAGE/);
  assert.match(source, /no evidence enqueue/);
  assert.match(source, /autonomous-research-repair-loop-plan/);
  assert.match(source, /scripts\/run-autonomous-research-repair-loop\.mjs/);
  assert.match(source, /--mode', 'plan'/);
  assert.match(source, /autonomous-research-repair-loop-execute-safe/);
  assert.match(source, /--mode', 'execute-safe'/);
  assert.match(source, /--continue-safe', 'true'/);
  assert.match(source, /autonomous-automation-cycle/);
  assert.match(source, /scripts\/run-autonomous-automation-cycle\.mjs/);
  assert.match(source, /--staged-provider-max-targets/);
  assert.match(source, /AUTONOMOUS_STAGED_PROVIDER_MAX_TARGETS/);
  assert.match(source, /AUTONOMOUS_STAGED_PROVIDER_TIMEOUT_MS/);
  assert.match(source, /state\.nextAttempt/);
  assert.match(source, /state\.budgetUsed/);
  assert.match(source, /state\.mutationBoundary/);
  assert.match(source, /providerActivationWrites/);
  assert.match(source, /portfolioActionWrites/);
});

test('continuous data accumulator refuses duplicate persistent instances', () => {
  assert.match(accumulatorSource, /listRunningAccumulatorPeers/);
  assert.ok(accumulatorSource.includes('data-accumulator\\\\.mjs'));
  assert.match(accumulatorSource, /refusing duplicate persistent daemon/);
  assert.match(accumulatorSource, /if \(isDirectRun && !runOnce\)/);
  assert.match(accumulatorSource, /markAccumulatorHeartbeat/);
  assert.match(accumulatorSource, /cycle-start/);
  assert.match(accumulatorSource, /cycle-complete/);
  assert.match(accumulatorSource, /pendingImports/);
  assert.match(accumulatorSource, /drainPendingImports/);
  assert.match(accumulatorSource, /DATA_ACCUMULATOR_POSTGRES_SYNC/);
  assert.match(accumulatorSource, /DATA_ACCUMULATOR_REPLAY_MAX_FRAMES/);
  assert.match(accumulatorSource, /latestFirst/);
  assert.match(accumulatorSource, /maxFrames/);
  assert.match(accumulatorSource, /replay_skipped_sidecar_unreachable/);
  assert.match(accumulatorSource, /gdeltRetryQueue/);
  assert.match(accumulatorSource, /fetchWithRetry/);
});

test('research OS daemon cadences stay at or below two hours', () => {
  const required = [
    'mechanism-seed-generation',
    'autonomous-research-repair-loop-plan',
    'autonomous-research-repair-loop-execute-safe',
    'autonomous-automation-cycle',
    'report-backfill-drain',
    'report-closure',
  ];
  for (const taskName of required) {
    assert.equal(
      DAEMON_TASK_INTERVALS_MS[taskName] <= HOUR_2_MS,
      true,
      `${taskName} interval should be <= 2h`,
    );
  }
  assert.match(source, /'mechanism-seed-generation': \{ interval: HOUR_2_MS/);
  assert.match(source, /'report-closure': \{ interval: HOUR_2_MS/);
  assert.match(source, /'autonomous-research-repair-loop-plan': \{ interval: HOUR_2_MS/);
});
