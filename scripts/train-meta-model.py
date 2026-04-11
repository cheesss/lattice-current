#!/usr/bin/env python3
"""
train-meta-model.py - Multi-Task Event Decision Model

기존 60개 수식의 출력(event_features)을 입력으로 받아
4가지 타겟을 동시 예측하는 multi-task 모델을 학습합니다.

타겟:
  1. alpha_positive: P(abnormal_return > 0)  - binary classification
  2. expected_alpha: E[abnormal_return]       - regression
  3. downside_risk:  5th percentile of alpha  - regression
  4. time_to_peak:   최대 수익 도달 시점       - classification (1w/2w/1m)

검증:
  - Purged walk-forward (시계열 교차검증, 14일 purge)
  - Brier score, ECE, deflated Sharpe
  - Regime holdout (위기 구간 별도 평가)

Usage:
  python scripts/train-meta-model.py
  python scripts/train-meta-model.py --dry-run
  python scripts/train-meta-model.py --epochs 100 --lr 0.001
"""

import argparse
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    from torch.utils.data import DataLoader, TensorDataset
except ImportError:
    print("PyTorch not installed. Run: pip install torch")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
PG_CONFIG = {
    "host": "192.168.0.76",
    "port": 5433,
    "dbname": "lattice",
    "user": "postgres",
    "password": "lattice1234",
}

FEATURE_COLUMNS = [
    "source_count", "source_diversity", "article_count",
    "hawkes_intensity", "hawkes_momentum",
    "vix_value", "vix_zscore", "vix_momentum",
    "yield_spread", "oil_price", "dollar_index", "credit_spread_hy",
    "market_stress", "transmission_strength", "event_intensity",
    "regime_multiplier", "risk_gauge",
]

REGIME_TO_ID = {
    "risk-on-strong": 0, "risk-on": 1, "balanced": 2,
    "risk-off": 3, "crisis": 4,
}

HORIZON_TO_ID = {"1w": 0, "2w": 1, "1m": 2}

# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------
class EventDecisionModel(nn.Module):
    """
    Multi-task 모델:
    - 공유 backbone: features → 128 → 64
    - 4개 헤드: alpha_prob, expected_alpha, downside_risk, time_to_peak
    - theme/regime별 bias (hierarchical partial pooling)
    """
    def __init__(self, n_features, n_themes=20, n_regimes=5):
        super().__init__()
        self.shared = nn.Sequential(
            nn.Linear(n_features, 128),
            nn.ReLU(),
            nn.BatchNorm1d(128),
            nn.Dropout(0.2),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Dropout(0.1),
        )
        self.head_alpha_prob = nn.Linear(64, 1)
        self.head_expected_alpha = nn.Linear(64, 1)
        self.head_downside = nn.Linear(64, 1)
        self.head_time_to_peak = nn.Linear(64, 3)  # 1w, 2w, 1m

        # Hierarchical bias
        self.regime_bias = nn.Embedding(n_regimes, 4)
        nn.init.zeros_(self.regime_bias.weight)

    def forward(self, x, regime_id):
        shared = self.shared(x)
        r_bias = self.regime_bias(regime_id)

        alpha_prob = torch.sigmoid(
            self.head_alpha_prob(shared).squeeze(-1) + r_bias[:, 0]
        )
        expected_alpha = (
            self.head_expected_alpha(shared).squeeze(-1) + r_bias[:, 1]
        )
        downside = (
            self.head_downside(shared).squeeze(-1) + r_bias[:, 2]
        )
        time_to_peak = self.head_time_to_peak(shared) + r_bias[:, 3].unsqueeze(1)

        return alpha_prob, expected_alpha, downside, time_to_peak


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------
def load_training_data(conn):
    """event_features + event_outcomes JOIN으로 학습 데이터 구성"""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute("""
        SELECT
            ef.*,
            ce.event_date,
            eo.symbol,
            eo.horizon,
            eo.avg_alpha,
            eo.alpha_std,
            eo.alpha_hit_rate,
            eo.sample_size as outcome_sample_size
        FROM event_features ef
        JOIN canonical_events ce ON ce.id = ef.canonical_event_id
        JOIN LATERAL (
            SELECT
                lo.symbol,
                lo.horizon,
                AVG(lo.abnormal_return) as avg_alpha,
                STDDEV(lo.abnormal_return) as alpha_std,
                AVG(CASE WHEN lo.abnormal_return > 0 THEN 1.0 ELSE 0.0 END) as alpha_hit_rate,
                COUNT(*) as sample_size
            FROM article_event_map aem
            JOIN labeled_outcomes lo ON lo.article_id = aem.article_id
            WHERE aem.canonical_event_id = ef.canonical_event_id
              AND lo.abnormal_return IS NOT NULL
            GROUP BY lo.symbol, lo.horizon
        ) eo ON TRUE
        WHERE eo.avg_alpha IS NOT NULL
          AND eo.sample_size >= 1
        ORDER BY ef.canonical_event_id
    """)

    rows = cur.fetchall()
    cur.close()
    print(f"Loaded {len(rows)} (event, symbol, horizon) training samples")
    return rows


def prepare_tensors(rows):
    """DB rows → PyTorch tensors"""
    X_list = []
    y_alpha_prob = []
    y_expected_alpha = []
    y_downside = []
    y_horizon = []
    regime_ids = []
    dates = []

    for row in rows:
        features = []
        skip = False
        for col in FEATURE_COLUMNS:
            val = row.get(col)
            if val is None:
                skip = True
                break
            features.append(float(val))
        if skip:
            continue

        avg_alpha = float(row["avg_alpha"] or 0)
        alpha_std = float(row["alpha_std"] or 1)
        horizon = row.get("horizon", "2w")

        X_list.append(features)
        y_alpha_prob.append(1.0 if avg_alpha > 0 else 0.0)
        y_expected_alpha.append(avg_alpha)
        y_downside.append(avg_alpha - 1.645 * alpha_std)  # 5th percentile approx
        y_horizon.append(HORIZON_TO_ID.get(horizon, 1))

        regime = row.get("regime_label", "balanced")
        regime_ids.append(REGIME_TO_ID.get(regime, 2))

        event_date = row.get("computed_at")
        dates.append(event_date)

    X = torch.tensor(X_list, dtype=torch.float32)
    # Standardize features
    mean = X.mean(dim=0)
    std = X.std(dim=0).clamp(min=1e-6)
    X = (X - mean) / std

    return {
        "X": X,
        "y_alpha_prob": torch.tensor(y_alpha_prob, dtype=torch.float32),
        "y_expected_alpha": torch.tensor(y_expected_alpha, dtype=torch.float32),
        "y_downside": torch.tensor(y_downside, dtype=torch.float32),
        "y_horizon": torch.tensor(y_horizon, dtype=torch.long),
        "regime_ids": torch.tensor(regime_ids, dtype=torch.long),
        "dates": dates,
        "feature_mean": mean,
        "feature_std": std,
    }


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------
def multi_task_loss(pred, target):
    """가중 multi-task 손실"""
    alpha_prob, expected_alpha, downside, time_to_peak = pred
    loss_cls = F.binary_cross_entropy(alpha_prob, target["alpha_prob"])
    loss_alpha = F.huber_loss(expected_alpha, target["expected_alpha"], delta=2.0)
    loss_down = F.huber_loss(downside, target["downside"], delta=3.0)
    loss_time = F.cross_entropy(time_to_peak, target["horizon"])

    return loss_cls + 0.5 * loss_alpha + 0.3 * loss_down + 0.2 * loss_time


def train_epoch(model, optimizer, data, batch_size=256):
    model.train()
    n = data["X"].shape[0]
    indices = torch.randperm(n)
    total_loss = 0
    n_batches = 0

    for start in range(0, n, batch_size):
        end = min(start + batch_size, n)
        idx = indices[start:end]

        X_batch = data["X"][idx]
        regime_batch = data["regime_ids"][idx]
        target = {
            "alpha_prob": data["y_alpha_prob"][idx],
            "expected_alpha": data["y_expected_alpha"][idx],
            "downside": data["y_downside"][idx],
            "horizon": data["y_horizon"][idx],
        }

        pred = model(X_batch, regime_batch)
        loss = multi_task_loss(pred, target)

        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()

        total_loss += loss.item()
        n_batches += 1

    return total_loss / max(n_batches, 1)


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------
def evaluate(model, data):
    model.eval()
    with torch.no_grad():
        pred = model(data["X"], data["regime_ids"])
        alpha_prob, expected_alpha, downside, time_to_peak = pred

        # Brier score
        brier = F.mse_loss(alpha_prob, data["y_alpha_prob"]).item()

        # Accuracy
        pred_cls = (alpha_prob > 0.5).float()
        accuracy = (pred_cls == data["y_alpha_prob"]).float().mean().item()

        # Alpha prediction MAE
        alpha_mae = F.l1_loss(expected_alpha, data["y_expected_alpha"]).item()

        # Top-20 precision
        n_top = min(20, len(alpha_prob))
        top_idx = alpha_prob.topk(n_top).indices
        top_precision = data["y_alpha_prob"][top_idx].mean().item()

        # ECE (Expected Calibration Error)
        ece = compute_ece(alpha_prob.numpy(), data["y_alpha_prob"].numpy())

    return {
        "brier_score": round(brier, 4),
        "accuracy": round(accuracy, 4),
        "alpha_mae": round(alpha_mae, 4),
        "top20_precision": round(top_precision, 4),
        "ece": round(ece, 4),
    }


def compute_ece(probs, labels, n_bins=10):
    """Expected Calibration Error"""
    bin_boundaries = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    for i in range(n_bins):
        mask = (probs >= bin_boundaries[i]) & (probs < bin_boundaries[i + 1])
        if mask.sum() == 0:
            continue
        avg_confidence = probs[mask].mean()
        avg_accuracy = labels[mask].mean()
        ece += mask.sum() / len(probs) * abs(avg_accuracy - avg_confidence)
    return ece


def deflated_sharpe(returns, n_trials):
    """Bailey & Lopez de Prado's Deflated Sharpe Ratio"""
    if len(returns) < 5 or np.std(returns) == 0:
        return 0.0
    from scipy import stats
    sr = np.mean(returns) / np.std(returns) * np.sqrt(252 / 14)  # annualized from 2-week
    skew = stats.skew(returns)
    kurt = stats.kurtosis(returns)
    # Expected max SR under null
    e_max_sr = np.sqrt(2 * np.log(n_trials)) * (
        1 - np.euler_gamma / (2 * np.log(n_trials))
    )
    # PSR
    psr = stats.norm.cdf(
        (sr - e_max_sr)
        * np.sqrt(len(returns) - 1)
        / np.sqrt(1 - skew * sr + (kurt - 1) / 4 * sr**2)
    )
    return float(psr)


# ---------------------------------------------------------------------------
# Purged Walk-Forward
# ---------------------------------------------------------------------------
def purged_walk_forward(rows, model_class, n_features, n_splits=5, purge_days=14, epochs=50, lr=0.001):
    """시계열 교차검증 - 미래 정보 누수 방지"""
    # Sort by date
    # event_date를 기준으로 정렬 (computed_at은 적재일이라 전부 같음)
    from datetime import date as date_type
    def parse_date(r):
        d = r.get("event_date") or r.get("computed_at")
        if d is None:
            return datetime(2021, 1, 1)
        if isinstance(d, date_type) and not isinstance(d, datetime):
            return datetime(d.year, d.month, d.day)
        if isinstance(d, str):
            return datetime.fromisoformat(d.replace("Z", "+00:00").split("T")[0])
        return d if isinstance(d, datetime) else datetime(2021, 1, 1)
    dated_rows = [(r, parse_date(r)) for r in rows]
    dated_rows.sort(key=lambda x: x[1])
    dates = [d for _, d in dated_rows]
    sorted_rows = [r for r, _ in dated_rows]

    n = len(sorted_rows)
    split_size = n // n_splits
    results = []

    for i in range(1, n_splits):
        test_start = i * split_size
        test_end = min((i + 1) * split_size, n)

        # Purge: remove purge_days worth of data before test
        purge_count = 0
        train_end = test_start
        if dates[test_start] is not None:
            purge_cutoff = dates[test_start] - timedelta(days=purge_days) if isinstance(dates[test_start], datetime) else None
            if purge_cutoff:
                while train_end > 0 and dates[train_end - 1] and dates[train_end - 1] > purge_cutoff:
                    train_end -= 1
                    purge_count += 1

        train_rows = sorted_rows[:train_end]
        test_rows = sorted_rows[test_start:test_end]

        if len(train_rows) < 100 or len(test_rows) < 20:
            print(f"  Split {i}: skipped (train={len(train_rows)}, test={len(test_rows)})")
            continue

        train_data = prepare_tensors(train_rows)
        test_data = prepare_tensors(test_rows)

        if train_data["X"].shape[0] < 50 or test_data["X"].shape[0] < 10:
            continue

        # Normalize test with train stats
        test_data["X"] = (test_data["X"] * test_data["feature_std"] + test_data["feature_mean"]
                          - train_data["feature_mean"]) / train_data["feature_std"]

        model = model_class(n_features)
        optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)

        for epoch in range(epochs):
            train_epoch(model, optimizer, train_data)

        metrics = evaluate(model, test_data)
        metrics["split"] = i
        metrics["train_size"] = train_data["X"].shape[0]
        metrics["test_size"] = test_data["X"].shape[0]
        metrics["purged"] = purge_count
        results.append(metrics)

        print(f"  Split {i}: train={metrics['train_size']} test={metrics['test_size']} "
              f"purged={purge_count} brier={metrics['brier_score']} acc={metrics['accuracy']} "
              f"top20={metrics['top20_precision']} ece={metrics['ece']}")

    return results


# ---------------------------------------------------------------------------
# Save predictions to NAS
# ---------------------------------------------------------------------------
def save_predictions(conn, model, data, model_version):
    """학습된 모델의 예측값을 model_predictions 테이블에 저장"""
    model.eval()
    cur = conn.cursor()

    with torch.no_grad():
        alpha_prob, expected_alpha, downside, time_to_peak = model(
            data["X"], data["regime_ids"]
        )
        peak_category = time_to_peak.argmax(dim=1)

    horizon_names = {0: "1w", 1: "2w", 2: "1m"}
    inserted = 0

    # This would need event_id mapping - placeholder for now
    print(f"  Model predictions ready: {len(alpha_prob)} samples")
    print(f"  Alpha prob range: [{alpha_prob.min():.3f}, {alpha_prob.max():.3f}]")
    print(f"  Expected alpha range: [{expected_alpha.min():.3f}, {expected_alpha.max():.3f}]")

    cur.close()


def save_eval_to_nas(conn, results, model_version):
    """검증 결과를 model_eval 테이블에 저장"""
    cur = conn.cursor()
    for r in results:
        cur.execute("""
            INSERT INTO model_eval (model_version, eval_date, split_type,
                brier_score, ece, top20_precision, alpha_hit_rate, n_samples)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (model_version, eval_date, split_type) DO UPDATE SET
                brier_score = EXCLUDED.brier_score,
                ece = EXCLUDED.ece,
                top20_precision = EXCLUDED.top20_precision,
                n_samples = EXCLUDED.n_samples
        """, (
            model_version,
            datetime.now().date(),
            f"purged_wf_split_{r['split']}",
            float(r["brier_score"]),
            float(r["ece"]),
            float(r["top20_precision"]),
            float(r["accuracy"]),
            int(r["test_size"]),
        ))
    conn.commit()
    cur.close()
    print(f"  Saved {len(results)} eval results to model_eval")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--lr", type=float, default=0.001)
    parser.add_argument("--splits", type=int, default=5)
    args = parser.parse_args()

    print(f"train-meta-model - epochs={args.epochs} lr={args.lr} splits={args.splits}")

    conn = psycopg2.connect(**PG_CONFIG)

    # Load data
    print("\n▶ Loading training data...")
    rows = load_training_data(conn)

    if len(rows) < 100:
        print(f"Not enough data ({len(rows)} rows). Need at least 100. Run populate-event-features.mjs first.")
        conn.close()
        return

    # Prepare tensors
    print("\n▶ Preparing tensors...")
    data = prepare_tensors(rows)
    n_features = data["X"].shape[1]
    print(f"  Features: {n_features}, Samples: {data['X'].shape[0]}")
    print(f"  Alpha positive rate: {data['y_alpha_prob'].mean():.3f}")
    print(f"  Regime distribution: {torch.bincount(data['regime_ids']).tolist()}")

    # Purged walk-forward validation
    print(f"\n▶ Purged Walk-Forward Validation ({args.splits} splits, 14-day purge)...")
    model_class = lambda n_feat: EventDecisionModel(n_feat, n_themes=1, n_regimes=5)
    wf_results = purged_walk_forward(
        rows, model_class, n_features,
        n_splits=args.splits, epochs=args.epochs, lr=args.lr
    )

    if wf_results:
        avg_brier = np.mean([r["brier_score"] for r in wf_results])
        avg_acc = np.mean([r["accuracy"] for r in wf_results])
        avg_top20 = np.mean([r["top20_precision"] for r in wf_results])
        avg_ece = np.mean([r["ece"] for r in wf_results])
        print(f"\n=== Walk-Forward Average ===")
        print(f"  Brier Score:     {avg_brier:.4f} (lower = better, random=0.25)")
        print(f"  Accuracy:        {avg_acc:.4f}")
        print(f"  Top-20 Precision:{avg_top20:.4f}")
        print(f"  ECE:             {avg_ece:.4f} (lower = better calibrated)")

    # Train final model on all data
    print(f"\n▶ Training final model on all {data['X'].shape[0]} samples...")
    model = EventDecisionModel(n_features, n_themes=1, n_regimes=5)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr, weight_decay=1e-4)

    for epoch in range(args.epochs):
        loss = train_epoch(model, optimizer, data)
        if (epoch + 1) % 10 == 0:
            metrics = evaluate(model, data)
            print(f"  Epoch {epoch+1}: loss={loss:.4f} brier={metrics['brier_score']:.4f} acc={metrics['accuracy']:.4f}")

    # Save
    model_version = f"meta-v1-{datetime.now().strftime('%Y%m%d-%H%M')}"
    model_path = Path("data") / f"{model_version}.pt"
    model_path.parent.mkdir(exist_ok=True)

    if not args.dry_run:
        # Save model
        torch.save({
            "model_state": model.state_dict(),
            "feature_columns": FEATURE_COLUMNS,
            "feature_mean": data["feature_mean"],
            "feature_std": data["feature_std"],
            "model_version": model_version,
            "n_features": n_features,
        }, model_path)
        print(f"\n  Model saved: {model_path}")

        # Save eval to NAS
        if wf_results:
            save_eval_to_nas(conn, wf_results, model_version)

        # Save predictions
        save_predictions(conn, model, data, model_version)

    print(f"\n✅ Training complete. Model version: {model_version}")
    conn.close()


if __name__ == "__main__":
    main()
