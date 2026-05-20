"""Nowcast trainer acceptance gate. Saved models must clear this bar or the
trainer refuses to write the .pkl. Keeps `candidate` models out of the
production inference path by construction.

Thresholds match docs/NOWCAST_HANDOFF_2026-04-18.md §5.2:
  - holdout MAE < baseline_mae * 0.85
  - coverage_90 >= 0.80
  - total rows (n_train + n_holdout) >= 120

Callers pass the trainer `bundle` dict and get a structured verdict.
"""

from __future__ import annotations

from dataclasses import dataclass

GATE_MAE_RATIO = 0.85
GATE_COV90_MIN = 0.80
GATE_N_MIN = 120


@dataclass
class GateVerdict:
    passed: bool
    mae_ok: bool
    cov_ok: bool
    n_ok: bool
    reasons: list


def evaluate_gate(bundle: dict) -> GateVerdict:
    mae = float(bundle['holdout_mae'])
    baseline = float(bundle['baseline_mae'])
    cov = float(bundle['coverage_90'])
    total_n = int(bundle['n_train']) + int(bundle['n_holdout'])

    mae_ok = baseline > 0 and mae < baseline * GATE_MAE_RATIO
    cov_ok = cov >= GATE_COV90_MIN
    n_ok = total_n >= GATE_N_MIN

    reasons = []
    if not mae_ok:
        reasons.append(f'MAE {mae:.6f} not < {baseline:.6f} * {GATE_MAE_RATIO}')
    if not cov_ok:
        reasons.append(f'cov90 {cov:.2f} < {GATE_COV90_MIN}')
    if not n_ok:
        reasons.append(f'N {total_n} < {GATE_N_MIN}')

    return GateVerdict(
        passed=(mae_ok and cov_ok and n_ok),
        mae_ok=mae_ok,
        cov_ok=cov_ok,
        n_ok=n_ok,
        reasons=reasons,
    )
