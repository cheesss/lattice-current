/**
 * Runtime source-eligibility gate used by inference scripts before a
 * nowcast is written. Returns { abstain: true, reason } when the current
 * set of available sources is too weak to trust.
 */

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
}) {
  const tableCheck = await client.query(`SELECT to_regclass('nowcast_source_eligibility') AS t`);
  if (!tableCheck.rows?.[0]?.t) {
    return { abstain: false, eligible: availableSources, regime: 'unknown', reason: 'gate table missing, open mode' };
  }

  const { rows: rules } = await client.query(
    `SELECT source_signal, family_kind, max_lag_hours, holdout_mae_max,
            drift_threshold, regime_mask, enabled
     FROM nowcast_source_eligibility
     WHERE target_signal = $1 AND model_version = $2 AND enabled = true`,
    [targetSignal, modelVersion],
  );
  if (!rules.length) {
    return { abstain: true, reason: `no eligibility rules for ${targetSignal}@${modelVersion}` };
  }

  const regime = await detectRegime(client);
  const eligible = [];
  const rejected = [];

  for (const src of availableSources) {
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
    if (Number.isFinite(Number(src.lagHours)) && Number(src.lagHours) > Number(rule.max_lag_hours)) {
      rejected.push({ source: src.name, reason: `lag ${src.lagHours}h > ${rule.max_lag_hours}h` });
      continue;
    }
    eligible.push(src.name);
  }

  // Recent drift check: compare last-24h reconciliation MAE against holdout threshold.
  const { rows: driftRows } = await client.query(`
    SELECT AVG(abs_error)::float AS mae
    FROM nowcast_reconciliation
    WHERE signal_name = $1 AND reconciled_at > NOW() - INTERVAL '24 hours'
  `, [targetSignal]);
  const recentMae = driftRows?.[0]?.mae;
  let driftExceeded = false;
  if (Number.isFinite(Number(recentMae))) {
    const worstThreshold = Math.max(...rules.map((r) => Number(r.holdout_mae_max) || 0));
    if (Number(recentMae) > worstThreshold * (1 + rules[0].drift_threshold)) {
      driftExceeded = true;
    }
  }

  const abstain = eligible.length < 2 || driftExceeded;
  const reason = abstain
    ? (driftExceeded
      ? `recent MAE ${recentMae} exceeds drift threshold`
      : `eligible sources=${eligible.length} < 2 (regime=${regime})`)
    : null;
  return { abstain, eligible, rejected, regime, reason };
}
