#!/usr/bin/env python3
"""
compare-models.py - v1 MLP vs LightGBM vs Logistic Regression

17개 피처로 P(alpha>0)를 예측할 때 어떤 모델이 가장 좋은지 비교.
Purged walk-forward (event_id group split) 동일 조건 비교.
"""

import sys
from datetime import datetime, timedelta
from datetime import date as date_type

import numpy as np

try:
    import psycopg2, psycopg2.extras
except ImportError:
    print("pip install psycopg2-binary"); sys.exit(1)

try:
    import lightgbm as lgb
    from sklearn.linear_model import LogisticRegression, Ridge
    from sklearn.calibration import CalibratedClassifierCV
    from sklearn.metrics import brier_score_loss, log_loss
except ImportError:
    print("pip install lightgbm scikit-learn"); sys.exit(1)

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False

PG_CONFIG = {
    "host": "192.168.0.76", "port": 5433,
    "dbname": "lattice", "user": "postgres", "password": "lattice1234",
}

FEATURES = [
    "source_count", "source_diversity", "article_count",
    "hawkes_intensity", "hawkes_momentum",
    "vix_value", "vix_zscore", "vix_momentum",
    "yield_spread", "oil_price", "dollar_index", "credit_spread_hy",
    "market_stress", "transmission_strength", "event_intensity",
    "regime_multiplier", "risk_gauge",
]


def compute_ece(probs, labels, n_bins=10):
    bins = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    for i in range(n_bins):
        mask = (probs >= bins[i]) & (probs < bins[i + 1])
        if mask.sum() == 0:
            continue
        ece += mask.sum() / len(probs) * abs(labels[mask].mean() - probs[mask].mean())
    return float(ece)


def load_data():
    conn = psycopg2.connect(**PG_CONFIG)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT
            ce.id as event_id, ce.event_date,
            ef.source_count, ef.source_diversity, ef.article_count,
            ef.hawkes_intensity, ef.hawkes_momentum,
            ef.vix_value, ef.vix_zscore, ef.vix_momentum,
            ef.yield_spread, ef.oil_price, ef.dollar_index, ef.credit_spread_hy,
            ef.market_stress, ef.transmission_strength, ef.event_intensity,
            ef.regime_multiplier, ef.risk_gauge, ef.regime_label,
            lo.symbol, lo.horizon,
            lo.abnormal_return
        FROM event_features ef
        JOIN canonical_events ce ON ce.id = ef.canonical_event_id
        JOIN article_event_map aem ON aem.canonical_event_id = ce.id
        JOIN labeled_outcomes lo ON lo.article_id = aem.article_id
            AND lo.abnormal_return IS NOT NULL
        ORDER BY ce.event_date
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return rows


def rows_to_arrays(rows):
    X_list, y_list, event_ids, dates = [], [], [], []
    for r in rows:
        feat = []
        skip = False
        for col in FEATURES:
            v = r.get(col)
            if v is None:
                skip = True
                break
            feat.append(float(v))
        if skip:
            continue
        X_list.append(feat)
        y_list.append(1.0 if float(r.get("abnormal_return", 0)) > 0 else 0.0)
        event_ids.append(r.get("event_id", 0))
        d = r.get("event_date")
        if isinstance(d, date_type) and not isinstance(d, datetime):
            d = datetime(d.year, d.month, d.day)
        dates.append(d or datetime(2021, 1, 1))
    return np.array(X_list), np.array(y_list), event_ids, dates


def evaluate_probs(probs, labels):
    brier = brier_score_loss(labels, probs)
    acc = np.mean((probs > 0.5) == labels)
    ece = compute_ece(probs, labels)
    n_top = min(20, len(probs))
    top_idx = np.argsort(probs)[-n_top:]
    top20 = labels[top_idx].mean()
    ll = log_loss(labels, np.clip(probs, 1e-7, 1 - 1e-7))
    return {
        "brier": round(brier, 4),
        "accuracy": round(acc, 4),
        "ece": round(ece, 4),
        "top20_precision": round(top20, 4),
        "log_loss": round(ll, 4),
    }


class SimpleMLP(nn.Module):
    def __init__(self, n_features):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_features, 128), nn.ReLU(), nn.Dropout(0.2),
            nn.Linear(128, 64), nn.ReLU(), nn.Dropout(0.1),
            nn.Linear(64, 1),
        )
    def forward(self, x):
        return torch.sigmoid(self.net(x)).squeeze(-1)


def train_mlp(X_train, y_train, X_test, epochs=50, lr=0.001):
    mean = X_train.mean(axis=0)
    std = X_train.std(axis=0) + 1e-6
    X_tr = torch.tensor((X_train - mean) / std, dtype=torch.float32)
    y_tr = torch.tensor(y_train, dtype=torch.float32)
    X_te = torch.tensor((X_test - mean) / std, dtype=torch.float32)

    model = SimpleMLP(X_train.shape[1])
    opt = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)

    model.train()
    for epoch in range(epochs):
        pred = model(X_tr)
        loss = F.binary_cross_entropy(pred, y_tr)
        opt.zero_grad()
        loss.backward()
        opt.step()

    model.eval()
    with torch.no_grad():
        return model(X_te).numpy()


def main():
    print("compare-models: v1 MLP vs LightGBM vs Logistic Regression\n")

    print(">> Loading data...")
    rows = load_data()
    X, y, event_ids, dates = rows_to_arrays(rows)
    print(f"  Samples: {len(X)}, Features: {X.shape[1]}, Alpha positive: {y.mean():.3f}")
    print(f"  Unique events: {len(set(event_ids))}")

    # Purged walk-forward with group split
    n_splits = 5
    n = len(X)
    split_size = n // n_splits
    purge_days = 14

    results = {"logistic": [], "lgbm": [], "mlp": []}

    print(f"\n>> Purged Walk-Forward ({n_splits} splits, {purge_days}-day purge, event group split)\n")

    for i in range(1, n_splits):
        test_start = i * split_size
        test_end = min((i + 1) * split_size, n)
        purge_cutoff = dates[test_start] - timedelta(days=purge_days)

        test_event_set = set(event_ids[test_start:test_end])
        train_mask = np.array([
            dates[j] <= purge_cutoff and event_ids[j] not in test_event_set
            for j in range(test_start)
        ])

        if train_mask.sum() < 200:
            print(f"  Split {i}: skipped (train too small)")
            continue

        X_train = X[:test_start][train_mask]
        y_train = y[:test_start][train_mask]
        X_test = X[test_start:test_end]
        y_test = y[test_start:test_end]

        print(f"  Split {i}: train={len(X_train)} test={len(X_test)}")

        # Standardize
        mean = X_train.mean(axis=0)
        std = X_train.std(axis=0) + 1e-6
        X_tr_s = (X_train - mean) / std
        X_te_s = (X_test - mean) / std

        # --- Logistic Regression ---
        lr_model = LogisticRegression(max_iter=1000, C=1.0)
        lr_model.fit(X_tr_s, y_train)
        lr_probs = lr_model.predict_proba(X_te_s)[:, 1]
        lr_metrics = evaluate_probs(lr_probs, y_test)
        results["logistic"].append(lr_metrics)
        print(f"    Logistic:  brier={lr_metrics['brier']} acc={lr_metrics['accuracy']} ece={lr_metrics['ece']} top20={lr_metrics['top20_precision']}")

        # --- LightGBM ---
        lgb_model = lgb.LGBMClassifier(
            n_estimators=300, max_depth=5, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8, min_child_samples=50,
            reg_alpha=0.1, reg_lambda=1.0, verbose=-1,
        )
        lgb_model.fit(X_train, y_train)  # LightGBM handles scaling internally
        lgb_probs = lgb_model.predict_proba(X_test)[:, 1]
        lgb_metrics = evaluate_probs(lgb_probs, y_test)
        results["lgbm"].append(lgb_metrics)
        print(f"    LightGBM:  brier={lgb_metrics['brier']} acc={lgb_metrics['accuracy']} ece={lgb_metrics['ece']} top20={lgb_metrics['top20_precision']}")

        # --- MLP (v1 style) ---
        if HAS_TORCH:
            mlp_probs = train_mlp(X_train, y_train, X_test, epochs=50)
            mlp_metrics = evaluate_probs(mlp_probs, y_test)
            results["mlp"].append(mlp_metrics)
            print(f"    MLP (v1):  brier={mlp_metrics['brier']} acc={mlp_metrics['accuracy']} ece={mlp_metrics['ece']} top20={mlp_metrics['top20_precision']}")

    # --- Summary ---
    print("\n" + "=" * 70)
    print("=== FINAL COMPARISON (Walk-Forward Average) ===")
    print("=" * 70)
    print(f"{'Model':<15} {'Brier':>8} {'Accuracy':>10} {'ECE':>8} {'Top-20':>8} {'LogLoss':>9}")
    print("-" * 60)
    for name in ["logistic", "lgbm", "mlp"]:
        if not results[name]:
            continue
        avg = {k: np.mean([r[k] for r in results[name]]) for k in results[name][0]}
        winner = ""
        print(f"{name:<15} {avg['brier']:>8.4f} {avg['accuracy']:>9.4f} {avg['ece']:>8.4f} {avg['top20_precision']:>8.4f} {avg['log_loss']:>9.4f}")

    # Best model
    all_brier = {name: np.mean([r["brier"] for r in results[name]]) for name in results if results[name]}
    best = min(all_brier, key=all_brier.get)
    print(f"\nBest model by Brier score: {best} ({all_brier[best]:.4f})")
    print("(lower Brier = better probability calibration)")

    # Feature importance (LightGBM)
    print("\n=== LightGBM Feature Importance ===")
    lgb_final = lgb.LGBMClassifier(n_estimators=300, max_depth=5, learning_rate=0.05, verbose=-1)
    lgb_final.fit(X, y)
    importance = sorted(zip(FEATURES, lgb_final.feature_importances_), key=lambda x: -x[1])
    for fname, imp in importance:
        bar = "#" * (imp // 5)
        print(f"  {fname:<25} {imp:>5} {bar}")


if __name__ == "__main__":
    main()
