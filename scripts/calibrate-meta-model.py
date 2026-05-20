#!/usr/bin/env python3
"""
calibrate-meta-model.py - Post-hoc temperature scaling for meta-model.

Existing v1 model (Brier 0.24, ECE 0.10) is well-discriminating but
under-calibrated — predicted probabilities don't match observed
frequencies. The handoff doc explicitly notes this needs "regime-conditional
or temperature scaling" and that simple retrain regresses.

Temperature scaling (Guo et al., 2017) is a 1-parameter post-hoc method
that optimizes a single scalar T to divide logits before sigmoid. Improves
calibration (ECE) without changing rank ordering — so deflated_sharpe and
hit-rate are preserved while ECE typically drops 30-60%.

Pipeline:
  1. Load existing model checkpoint (.pt).
  2. Pull holdout validation set: event_features + actual outcomes.
  3. Convert model alpha_prob predictions to logits via inverse-sigmoid.
  4. Use L-BFGS to find T that minimizes BCE-with-logits on validation set.
  5. Save T alongside checkpoint as <ckpt>.calibration.json so the
     inference server picks it up automatically.

Usage:
  python scripts/calibrate-meta-model.py
  python scripts/calibrate-meta-model.py --model data/meta-v1-20260411-0710.pt
"""

import argparse
import json
import sys
import os
from pathlib import Path

import numpy as np

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("psycopg2 not installed."); sys.exit(1)

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
except ImportError:
    print("PyTorch not installed."); sys.exit(1)



def require_pg_password():
    password = (
        os.environ.get("PG_PASSWORD")
        or os.environ.get("PGPASSWORD")
        or os.environ.get("INTEL_PG_PASSWORD")
        or os.environ.get("NAS_PG_PASSWORD")
    )
    if not password:
        raise RuntimeError(
            "Missing PostgreSQL password. Set PG_PASSWORD, PGPASSWORD, "
            "INTEL_PG_PASSWORD, or NAS_PG_PASSWORD."
        )
    return password


PG_CONFIG = {
    "host": "192.168.0.2", "port": 5433,
    "dbname": "lattice", "user": "postgres", "password": require_pg_password(),
}

FEATURE_COLUMNS = [
    "source_count", "source_diversity", "article_count",
    "hawkes_intensity", "hawkes_momentum",
    "vix_value", "vix_zscore", "vix_momentum",
    "yield_spread", "oil_price", "dollar_index", "credit_spread_hy",
    "market_stress", "transmission_strength", "event_intensity",
    "regime_multiplier", "risk_gauge",
]
REGIME_TO_ID = {"risk-on-strong": 0, "risk-on": 1, "balanced": 2, "risk-off": 3, "crisis": 4}


class EventDecisionModel(nn.Module):
    """Must match train-meta-model.py architecture for state_dict load to work."""
    def __init__(self, n_features, n_themes=1, n_regimes=5):
        super().__init__()
        self.shared = nn.Sequential(
            nn.Linear(n_features, 128), nn.ReLU(), nn.BatchNorm1d(128), nn.Dropout(0.2),
            nn.Linear(128, 64), nn.ReLU(), nn.Dropout(0.1),
        )
        self.head_alpha_prob = nn.Linear(64, 1)
        self.head_expected_alpha = nn.Linear(64, 1)
        self.head_downside = nn.Linear(64, 1)
        self.head_time_to_peak = nn.Linear(64, 3)
        self.regime_bias = nn.Embedding(n_regimes, 4)

    def forward(self, x, regime_id):
        shared = self.shared(x)
        r_bias = self.regime_bias(regime_id)
        alpha_logit = self.head_alpha_prob(shared).squeeze(-1) + r_bias[:, 0]
        return alpha_logit


def load_validation_data(conn):
    """Pull a held-out slice of (event, label) pairs.

    Uses the most recent 20% of labeled events (by event_date) as validation —
    standard time-based holdout. We need actual outcomes (alpha sign per
    horizon) joined to features.
    """
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        WITH ev AS (
          SELECT
            ef.canonical_event_id,
            ce.event_date,
            ef.source_count, ef.source_diversity, ef.article_count,
            ef.hawkes_intensity, ef.hawkes_momentum,
            ef.vix_value, ef.vix_zscore, ef.vix_momentum,
            ef.yield_spread, ef.oil_price, ef.dollar_index, ef.credit_spread_hy,
            ef.market_stress, ef.transmission_strength, ef.event_intensity,
            ef.regime_label, ef.regime_multiplier, ef.risk_gauge,
            (eu.event_alpha > 0)::int AS label
          FROM event_features ef
          JOIN canonical_events ce ON ce.id = ef.canonical_event_id
          JOIN event_uplift eu ON eu.canonical_event_id = ef.canonical_event_id
          WHERE eu.event_alpha IS NOT NULL
        ),
        ranked AS (
          SELECT *, NTILE(5) OVER (ORDER BY event_date) AS bucket FROM ev
        )
        SELECT * FROM ranked WHERE bucket = 5 ORDER BY event_date DESC LIMIT 5000
    """)
    rows = cur.fetchall()
    cur.close()
    return rows


def expected_calibration_error(probs, labels, n_bins=10):
    """Standard ECE: weighted average gap between confidence and accuracy across bins."""
    probs = np.asarray(probs)
    labels = np.asarray(labels)
    bins = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    n = len(probs)
    for i in range(n_bins):
        mask = (probs >= bins[i]) & (probs < bins[i + 1] if i < n_bins - 1 else probs <= bins[i + 1])
        if mask.sum() == 0:
            continue
        bin_conf = probs[mask].mean()
        bin_acc = labels[mask].mean()
        ece += abs(bin_conf - bin_acc) * (mask.sum() / n)
    return float(ece)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=None)
    args = parser.parse_args()

    # Find latest model if not specified
    if args.model:
        model_path = Path(args.model)
    else:
        pt_files = sorted(Path("data").glob("meta-v1-*.pt"))
        if not pt_files:
            print("No model found"); sys.exit(1)
        model_path = pt_files[-1]
    print(f"calibrating: {model_path}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    ckpt = torch.load(model_path, map_location=device, weights_only=False)
    model = EventDecisionModel(ckpt["n_features"], n_themes=1, n_regimes=5)
    model.load_state_dict(ckpt["model_state"])
    model.to(device).eval()

    feature_mean = torch.tensor(ckpt["feature_mean"], dtype=torch.float32, device=device)
    feature_std = torch.tensor(ckpt["feature_std"], dtype=torch.float32, device=device).clamp(min=1e-6)
    model_version = ckpt.get("model_version", "unknown")

    conn = psycopg2.connect(**PG_CONFIG)
    rows = load_validation_data(conn)
    conn.close()
    print(f"validation rows: {len(rows)}")
    if len(rows) < 100:
        print(f"too few validation rows ({len(rows)}) — need ≥100 for stable T estimate")
        sys.exit(2)

    # Build feature matrix
    X = np.array([[float(r[c] or 0) for c in FEATURE_COLUMNS] for r in rows], dtype=np.float32)
    regime_ids = np.array([REGIME_TO_ID.get(r["regime_label"], 2) for r in rows], dtype=np.int64)
    y = np.array([int(r["label"]) for r in rows], dtype=np.float32)

    X_t = torch.tensor(X, dtype=torch.float32, device=device)
    X_norm = (X_t - feature_mean) / feature_std
    regime_t = torch.tensor(regime_ids, dtype=torch.long, device=device)
    y_t = torch.tensor(y, dtype=torch.float32, device=device)

    # Get alpha logits from frozen model
    with torch.no_grad():
        logits = model(X_norm, regime_t)

    # Pre-calibration metrics
    pre_probs = torch.sigmoid(logits).cpu().numpy()
    pre_ece = expected_calibration_error(pre_probs, y)
    pre_brier = float(((pre_probs - y) ** 2).mean())
    print(f"pre-calibration:  Brier={pre_brier:.4f}  ECE={pre_ece:.4f}")

    # Optimize temperature T via L-BFGS on BCE-with-logits
    T = nn.Parameter(torch.ones(1, device=device) * 1.0)
    optimizer = torch.optim.LBFGS([T], lr=0.1, max_iter=100)

    def closure():
        optimizer.zero_grad()
        scaled = logits / T.clamp(min=1e-3, max=10.0)
        loss = F.binary_cross_entropy_with_logits(scaled, y_t)
        loss.backward()
        return loss

    optimizer.step(closure)
    T_opt = float(T.detach().clamp(min=1e-3, max=10.0).item())

    # Post-calibration metrics
    post_probs = torch.sigmoid(logits / T_opt).cpu().numpy()
    post_ece = expected_calibration_error(post_probs, y)
    post_brier = float(((post_probs - y) ** 2).mean())
    print(f"post-calibration: Brier={post_brier:.4f}  ECE={post_ece:.4f}  T={T_opt:.3f}")

    # Save calibration sidecar
    sidecar = model_path.parent / f"{model_path.stem}.calibration.json"
    payload = {
        "model_version": model_version,
        "model_file": str(model_path.name),
        "calibration_method": "temperature_scaling",
        "temperature": T_opt,
        "pre_metrics": {"brier": pre_brier, "ece": pre_ece},
        "post_metrics": {"brier": post_brier, "ece": post_ece},
        "validation_n": len(rows),
    }
    sidecar.write_text(json.dumps(payload, indent=2))
    print(f"saved: {sidecar}")


if __name__ == "__main__":
    main()
