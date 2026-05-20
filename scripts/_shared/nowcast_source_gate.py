"""
Python port of scripts/_shared/nowcast-source-gate.mjs.

Kept in lockstep with the JS implementation so that
compute-rates-nowcast.py and compute-composite-nowcasts.mjs enforce the
same abstain rules.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


DEFAULT_MIN_ELIGIBLE_SOURCES = 2


@dataclass
class GateDecision:
    abstain: bool
    eligible: list[str]
    rejected: list[dict]
    regime: str
    reason: str | None


def evaluate_gate(
    rules: list[dict],
    regime: str,
    available_sources: list[dict],
    recent_mae: float | None = None,
    min_eligible_sources: int = DEFAULT_MIN_ELIGIBLE_SOURCES,
) -> GateDecision:
    """Pure gate evaluator — no DB access. Mirror of JS evaluateGate()."""
    if not rules:
        return GateDecision(abstain=True, eligible=[], rejected=[], regime=regime, reason='no eligibility rules')

    eligible: list[str] = []
    rejected: list[dict] = []
    for src in available_sources or []:
        rule = next((r for r in rules if str(r.get('source_signal')) == str(src.get('name'))), None)
        if rule is None:
            rejected.append({'source': src.get('name'), 'reason': 'no rule'})
            continue
        regime_mask = rule.get('regime_mask') or {'normal': True, 'shock': True}
        if not regime_mask.get(regime, False):
            rejected.append({'source': src.get('name'), 'reason': f'regime={regime} disabled'})
            continue
        try:
            max_lag = float(rule.get('max_lag_hours')) if rule.get('max_lag_hours') is not None else None
        except (TypeError, ValueError):
            max_lag = None
        try:
            src_lag = float(src.get('lagHours')) if src.get('lagHours') is not None else None
        except (TypeError, ValueError):
            src_lag = None
        if src_lag is not None and max_lag is not None and src_lag > max_lag:
            rejected.append({'source': src.get('name'), 'reason': f'lag {src_lag}h > {max_lag}h'})
            continue
        eligible.append(str(src.get('name')))

    drift_exceeded = False
    drift_reason: str | None = None
    try:
        recent_mae_num = float(recent_mae) if recent_mae is not None else None
    except (TypeError, ValueError):
        recent_mae_num = None
    if recent_mae_num is not None:
        thresholds = [float(r.get('holdout_mae_max') or 0) for r in rules]
        worst = max(thresholds) if thresholds else 0.0
        drift_factor = 1 + float(rules[0].get('drift_threshold') or 0.25)
        if recent_mae_num > worst * drift_factor:
            drift_exceeded = True
            drift_reason = f'recent MAE {recent_mae_num} exceeds {worst * drift_factor:.4f} drift threshold'

    abstain = len(eligible) < min_eligible_sources or drift_exceeded
    if not abstain:
        reason = None
    elif drift_exceeded:
        reason = drift_reason
    else:
        reason = f'eligible sources={len(eligible)} < {min_eligible_sources} (regime={regime})'

    return GateDecision(abstain=abstain, eligible=eligible, rejected=rejected, regime=regime, reason=reason)


def _regclass_exists(cur, table_name: str) -> bool:
    cur.execute("SELECT to_regclass(%s) AS t", (table_name,))
    row = cur.fetchone()
    return bool(row and row[0])


def detect_regime(conn) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT value FROM signal_history
            WHERE signal_name = 'vix' AND value_origin = 'observed'
            ORDER BY ts DESC LIMIT 1
            """
        )
        row = cur.fetchone()
    if not row:
        return 'normal'
    try:
        vix = float(row[0])
    except (TypeError, ValueError):
        return 'normal'
    return 'shock' if vix > 30 else 'normal'


def check_eligible_sources(
    conn,
    target_signal: str,
    model_version: str = 'v1',
    available_sources: list[dict] | None = None,
    min_eligible_sources: int = DEFAULT_MIN_ELIGIBLE_SOURCES,
) -> GateDecision:
    available_sources = available_sources or []
    with conn.cursor() as cur:
        if not _regclass_exists(cur, 'nowcast_source_eligibility'):
            # Gate table missing — open mode (treat sources as eligible).
            return GateDecision(
                abstain=False,
                eligible=[str(s.get('name')) for s in available_sources],
                rejected=[],
                regime='unknown',
                reason='gate table missing, open mode',
            )
        cur.execute(
            """
            SELECT source_signal, family_kind, max_lag_hours, holdout_mae_max,
                   drift_threshold, regime_mask, enabled
            FROM nowcast_source_eligibility
            WHERE target_signal = %s AND model_version = %s AND enabled = true
            """,
            (target_signal, model_version),
        )
        cols = ['source_signal', 'family_kind', 'max_lag_hours', 'holdout_mae_max',
                'drift_threshold', 'regime_mask', 'enabled']
        rules = [dict(zip(cols, row)) for row in cur.fetchall()]
        if not rules:
            return GateDecision(abstain=True, eligible=[], rejected=[], regime='unknown',
                                reason=f'no eligibility rules for {target_signal}@{model_version}')
        regime = detect_regime(conn)
        cur.execute(
            """
            SELECT AVG(abs_error)::float AS mae
            FROM nowcast_reconciliation
            WHERE signal_name = %s AND reconciled_at > NOW() - INTERVAL '24 hours'
            """,
            (target_signal,),
        )
        drift_row = cur.fetchone()
        recent_mae = drift_row[0] if drift_row else None
    return evaluate_gate(rules, regime, available_sources, recent_mae, min_eligible_sources)
