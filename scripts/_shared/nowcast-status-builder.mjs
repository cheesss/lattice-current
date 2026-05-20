/**
 * Nowcast status builder — operator-facing snapshot of the Nowcast subsystem
 * for exposure through /api/nowcast-status and the OpenClaw control plane.
 *
 * Surfaces:
 *   - model_registry promotion-state distribution (candidate/shadow/active/deprecated)
 *   - per-signal 24h reconciliation coverage (within_interval rate) + MAE
 *   - drift classification: ok / warning (<0.70) / critical (<0.50)
 *   - latest training snapshots with acceptance-gate verdict
 *
 * Philosophy: expose only aggregate metrics, never raw predictions. Mirrors the
 * dashboard UI's shadow/active fuse filter — candidate models show up in the
 * model count but never in surfaced predictions.
 */

const DRIFT_WARN_COVERAGE = 0.70;
const DRIFT_CRITICAL_COVERAGE = 0.50;
const RECONCILIATION_WINDOW_HOURS = 24;
const TRAINING_SNAPSHOT_LIMIT = 8;

async function tableExists(executor, tableName) {
  const { rows } = await executor.query(
    `SELECT to_regclass($1) AS oid`,
    [`public.${tableName}`],
  );
  return Boolean(rows[0]?.oid);
}

async function loadRegistrySummary(client) {
  const exists = await tableExists(client, 'model_registry');
  if (!exists) return { available: false, states: {}, models: [] };

  const stateRows = await client.query(`
    SELECT promotion_state, COUNT(*)::int AS count
      FROM model_registry
     GROUP BY promotion_state
  `);
  const states = { candidate: 0, shadow: 0, active: 0, deprecated: 0 };
  for (const row of stateRows.rows) {
    if (row.promotion_state in states) states[row.promotion_state] = row.count;
  }

  const detail = await client.query(`
    SELECT model_key, model_version, target_signal, promotion_state,
           eval_summary, created_at, promoted_at, deprecated_at
      FROM model_registry
     WHERE promotion_state IN ('candidate','shadow','active')
     ORDER BY target_signal, promotion_state, created_at DESC
  `);

  return {
    available: true,
    states,
    total: Object.values(states).reduce((a, b) => a + b, 0),
    models: detail.rows.map((r) => ({
      modelKey: r.model_key,
      modelVersion: r.model_version,
      targetSignal: r.target_signal,
      promotionState: r.promotion_state,
      holdoutMae: r.eval_summary?.holdout_mae ?? null,
      baselineMae: r.eval_summary?.baseline_mae ?? null,
      coverage90: r.eval_summary?.coverage_90 ?? null,
      nTrain: r.eval_summary?.n_train ?? null,
      nHoldout: r.eval_summary?.n_holdout ?? null,
      createdAt: r.created_at,
      promotedAt: r.promoted_at,
      deprecatedAt: r.deprecated_at,
    })),
  };
}

function classifyDrift(coverage) {
  if (!Number.isFinite(coverage)) return 'unknown';
  if (coverage < DRIFT_CRITICAL_COVERAGE) return 'critical';
  if (coverage < DRIFT_WARN_COVERAGE) return 'warning';
  return 'ok';
}

async function loadReconciliationSummary(client) {
  const exists = await tableExists(client, 'nowcast_reconciliation');
  if (!exists) return { available: false, signals: [] };

  const { rows } = await client.query(
    `
    SELECT signal_name,
           model_version,
           COUNT(*)::int                                   AS n,
           AVG(abs_error)                                  AS mae,
           AVG(CASE WHEN within_interval THEN 1.0 ELSE 0.0 END) AS coverage,
           MAX(reconciled_at)                              AS latest_reconciled_at
      FROM nowcast_reconciliation
     WHERE reconciled_at > now() - ($1 || ' hours')::interval
     GROUP BY signal_name, model_version
     ORDER BY signal_name
  `,
    [String(RECONCILIATION_WINDOW_HOURS)],
  );

  const signals = rows.map((r) => {
    const coverage = r.coverage == null ? null : Number(r.coverage);
    return {
      signalName: r.signal_name,
      modelVersion: r.model_version,
      sampleCount: r.n,
      mae: r.mae == null ? null : Number(r.mae),
      coverage,
      driftLevel: classifyDrift(coverage),
      latestReconciledAt: r.latest_reconciled_at,
    };
  });

  return {
    available: true,
    windowHours: RECONCILIATION_WINDOW_HOURS,
    signals,
    warnings: signals.filter((s) => s.driftLevel === 'warning').length,
    criticals: signals.filter((s) => s.driftLevel === 'critical').length,
  };
}

function evaluateGateVerdict(evalSummary) {
  if (!evalSummary || typeof evalSummary !== 'object') {
    return { passed: null, reasons: ['no eval_summary'] };
  }
  const holdoutMae = Number(evalSummary.holdout_mae);
  const baselineMae = Number(evalSummary.baseline_mae);
  const cov90 = Number(evalSummary.coverage_90);
  const nTrain = Number(evalSummary.n_train);
  const nHoldout = Number(evalSummary.n_holdout);
  const n = Number.isFinite(nTrain) && Number.isFinite(nHoldout)
    ? nTrain + nHoldout
    : Number(evalSummary.row_count);

  const reasons = [];
  const ratio = Number.isFinite(holdoutMae) && Number.isFinite(baselineMae) && baselineMae > 0
    ? holdoutMae / baselineMae
    : null;
  const maeOk = ratio != null && ratio <= 0.85;
  const covOk = Number.isFinite(cov90) && cov90 >= 0.80;
  const nOk = Number.isFinite(n) && n >= 120;

  if (!maeOk) reasons.push(`mae_ratio=${ratio == null ? 'n/a' : ratio.toFixed(3)} (threshold ≤0.85)`);
  if (!covOk) reasons.push(`coverage_90=${Number.isFinite(cov90) ? cov90.toFixed(3) : 'n/a'} (threshold ≥0.80)`);
  if (!nOk) reasons.push(`n=${Number.isFinite(n) ? n : 'n/a'} (threshold ≥120)`);

  return {
    passed: maeOk && covOk && nOk,
    maeRatio: ratio,
    coverage90: Number.isFinite(cov90) ? cov90 : null,
    sampleCount: Number.isFinite(n) ? n : null,
    reasons,
  };
}

async function loadTrainingSnapshotSummary(client) {
  const exists = await tableExists(client, 'nowcast_training_snapshots');
  if (!exists) return { available: false, snapshots: [] };

  const { rows } = await client.query(
    `
    SELECT target_signal, training_date, feature_set_hash, row_count, eval_summary
      FROM nowcast_training_snapshots
     ORDER BY training_date DESC
     LIMIT $1
  `,
    [TRAINING_SNAPSHOT_LIMIT],
  );

  return {
    available: true,
    snapshots: rows.map((r) => {
      const verdict = evaluateGateVerdict(r.eval_summary);
      return {
        targetSignal: r.target_signal,
        trainingDate: r.training_date,
        featureSetHash: r.feature_set_hash,
        rowCount: r.row_count,
        gate: verdict,
      };
    }),
  };
}

function summarizeStatus({ registry, reconciliation, training }) {
  const activeCount = registry.states?.active ?? 0;
  const shadowCount = registry.states?.shadow ?? 0;
  const candidateCount = registry.states?.candidate ?? 0;
  const driftCritical = reconciliation.criticals ?? 0;
  const driftWarning = reconciliation.warnings ?? 0;
  const lastGatePass = training.snapshots?.find((s) => s.gate.passed === true);
  const lastGateFail = training.snapshots?.find((s) => s.gate.passed === false);

  let level = 'ok';
  if (driftCritical > 0) level = 'critical';
  else if (driftWarning > 0) level = 'warning';

  return {
    level,
    activeModels: activeCount,
    shadowModels: shadowCount,
    candidateModels: candidateCount,
    driftCritical,
    driftWarning,
    lastGatePassAt: lastGatePass?.trainingDate ?? null,
    lastGateFailAt: lastGateFail?.trainingDate ?? null,
  };
}

export async function buildNowcastStatusPayload(pool) {
  const [registry, reconciliation, training] = await Promise.all([
    loadRegistrySummary(pool),
    loadReconciliationSummary(pool),
    loadTrainingSnapshotSummary(pool),
  ]);
  const summary = summarizeStatus({ registry, reconciliation, training });
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    summary,
    registry,
    reconciliation,
    training,
  };
}

export const _internals = {
  classifyDrift,
  evaluateGateVerdict,
  summarizeStatus,
  DRIFT_WARN_COVERAGE,
  DRIFT_CRITICAL_COVERAGE,
  RECONCILIATION_WINDOW_HOURS,
  TRAINING_SNAPSHOT_LIMIT,
};
