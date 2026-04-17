/**
 * Runtime source-eligibility gate used by inference scripts before a
 * nowcast is written. Returns { abstain: true, reason } when the current
 * set of available sources is too weak to trust.
 *
 * Split into:
 *   - evaluateGate(): pure function. Takes rules, regime, availableSources,
 *                     recentMae, minEligibleSources. Returns abstain decision.
 *   - detectRegime(), checkEligibleSources(): DB-touching wrappers that
 *                     fetch inputs then call evaluateGate. Used by inference.
 */

export const DEFAULT_MIN_ELIGIBLE_SOURCES = 2;

/**
 * Pure gate evaluator. No DB access. Testable with predetermined inputs.
 *
 * @param {{
 *   rules: Array<{ source_signal: string, max_lag_hours: number|string,
 *                  holdout_mae_max: number|string, drift_threshold?: number|string,
 *                  regime_mask?: Record<string, boolean> }>,
 *   regime: 'normal' | 'shock' | 'unknown',
 *   availableSources: Array<{ name: string, lagHours?: number }>,
 *   recentMae?: number | null,
 *   minEligibleSources?: number,
 * }} input
 */
export function evaluateGate({
  rules, regime, availableSources,
  recentMae = null, minEligibleSources = DEFAULT_MIN_ELIGIBLE_SOURCES,
}) {
  if (!Array.isArray(rules) || rules.length === 0) {
    return { abstain: true, eligible: [], rejected: [], regime, reason: 'no eligibility rules' };
  }

  const eligible = [];
  const rejected = [];
  for (const src of availableSources || []) {
    const rule = rules.find((r) => String(r.source_signal) === String(src.name));
    if (!rule) {
      rejected.push({ source: src.name, reason: 'no rule' });
      continue;
    }
    const regimeMask = rule.regime_mask || { normal: true, shock: true };
    if (!regimeMask[regime]) {
      rejected.push({ source: src.name, reason: `regime=${regime} disabled` });
      continue;
    }
    const maxLag = Number(rule.max_lag_hours);
    const srcLag = Number(src.lagHours);
    if (Number.isFinite(srcLag) && Number.isFinite(maxLag) && srcLag > maxLag) {
      rejected.push({ source: src.name, reason: `lag ${srcLag}h > ${maxLag}h` });
      continue;
    }
    eligible.push(src.name);
  }

  let driftExceeded = false;
  let driftReason = null;
  if (Number.isFinite(Number(recentMae))) {
    const worstThreshold = Math.max(...rules.map((r) => Number(r.holdout_mae_max) || 0));
    const driftFactor = 1 + Number(rules[0].drift_threshold ?? 0.25);
    if (Number(recentMae) > worstThreshold * driftFactor) {
      driftExceeded = true;
      driftReason = `recent MAE ${recentMae} exceeds ${(worstThreshold * driftFactor).toFixed(4)} drift threshold`;
    }
  }

  const abstain = eligible.length < minEligibleSources || driftExceeded;
  const reason = !abstain
    ? null
    : (driftExceeded
      ? driftReason
      : `eligible sources=${eligible.length} < ${minEligibleSources} (regime=${regime})`);
  return { abstain, eligible, rejected, regime, reason };
}

export async function detectRegime(client) {
  const { rows } = await client.query(
    `SELECT value
     FROM signal_history
     WHERE signal_name = 'vix' AND value_origin = 'observed'
     ORDER BY ts DESC
     LIMIT 1`,
  );
  const vix = Number(rows?.[0]?.value);
  if (Number.isFinite(vix) && vix > 30) return 'shock';
  return 'normal';
}

export async function checkEligibleSources(client, {
  targetSignal, modelVersion = 'v1', availableSources = [],
  minEligibleSources = DEFAULT_MIN_ELIGIBLE_SOURCES,
}) {
  const tableCheck = await client.query(`SELECT to_regclass('nowcast_source_eligibility') AS t`);
  if (!tableCheck.rows?.[0]?.t) {
    return { abstain: false, eligible: availableSources.map((s) => s.name), regime: 'unknown', reason: 'gate table missing, open mode' };
  }

  const { rows: rules } = await client.query(
    `SELECT source_signal, family_kind, max_lag_hours, holdout_mae_max,
            drift_threshold, regime_mask, enabled
     FROM nowcast_source_eligibility
     WHERE target_signal = $1 AND model_version = $2 AND enabled = true`,
    [targetSignal, modelVersion],
  );
  if (!rules.length) {
    return { abstain: true, eligible: [], rejected: [], regime: 'unknown', reason: `no eligibility rules for ${targetSignal}@${modelVersion}` };
  }

  const regime = await detectRegime(client);

  const { rows: driftRows } = await client.query(`
    SELECT AVG(abs_error)::float AS mae
    FROM nowcast_reconciliation
    WHERE signal_name = $1 AND reconciled_at > NOW() - INTERVAL '24 hours'
  `, [targetSignal]);
  const recentMae = driftRows?.[0]?.mae;

  return evaluateGate({ rules, regime, availableSources, recentMae, minEligibleSources });
}
