#!/usr/bin/env python3
"""
train-meta-model-v2.py - Three-Tower Event Decision Model

v1 대비 변경사항:
  1. Three-tower 구조: Event tower + Market tower + Asset tower
  2. Event embedding (768->64) + theme embedding 추가
  3. Symbol embedding + horizon embedding 추가
  4. Regime FiLM conditioning (additive bias -> feature-wise scaling+shift)
  5. Quantile loss (pinball) for downside q05
  6. Ordinal classification for time_to_peak
  7. Uplift head 추가 (matched control 대비 초과반응)
  8. LayerNorm (BatchNorm 대신, regime drift에 안정적)
  9. LightGBM baseline 비교
  10. Group split by canonical_event_id
  11. Inverse-frequency weighting for imbalanced alpha

Usage:
  python scripts/train-meta-model-v2.py
  python scripts/train-meta-model-v2.py --epochs 80 --lr 0.0005
"""

import argparse
import sys
from datetime import datetime, timedelta
from datetime import date as date_type
from pathlib import Path
from collections import Counter

import numpy as np

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("pip install psycopg2-binary"); sys.exit(1)

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
except ImportError:
    print("pip install torch"); sys.exit(1)

PG_CONFIG = {
    "host": "192.168.0.76", "port": 5433,
    "dbname": "lattice", "user": "postgres", "password": "lattice1234",
}

MARKET_FEATURES = [
    "source_count", "source_diversity", "article_count",
    "hawkes_intensity", "hawkes_momentum",
    "vix_value", "vix_zscore", "vix_momentum",
    "yield_spread", "oil_price", "dollar_index", "credit_spread_hy",
    "market_stress", "transmission_strength", "event_intensity",
    "regime_multiplier", "risk_gauge",
]

REGIME_TO_ID = {"risk-on-strong": 0, "risk-on": 1, "balanced": 2, "risk-off": 3, "crisis": 4}
HORIZON_TO_ID = {"1w": 0, "2w": 1, "1m": 2}
SESSION_TO_ID = {"pre_market": 0, "market_hours": 1, "after_hours": 2, "weekend": 3}

EVENT_EMB_DIM = 64
THEME_EMB_DIM = 16
SYMBOL_EMB_DIM = 16
HORIZON_EMB_DIM = 4
SESSION_EMB_DIM = 4


# ---------------------------------------------------------------------------
# Model v2: Three-Tower + FiLM + Quantile/Ordinal/Uplift
# ---------------------------------------------------------------------------
class FiLMLayer(nn.Module):
    """Feature-wise Linear Modulation: gamma * x + beta (regime-conditioned)"""
    def __init__(self, n_regimes, feature_dim):
        super().__init__()
        self.gamma = nn.Embedding(n_regimes, feature_dim)
        self.beta = nn.Embedding(n_regimes, feature_dim)
        nn.init.ones_(self.gamma.weight)
        nn.init.zeros_(self.beta.weight)

    def forward(self, x, regime_id):
        g = self.gamma(regime_id)  # [batch, dim]
        b = self.beta(regime_id)
        return g * x + b


class EventDecisionModelV2(nn.Module):
    def __init__(self, n_market_features, n_themes, n_symbols, n_regimes=5):
        super().__init__()

        # --- Event Tower ---
        self.event_proj = nn.Sequential(
            nn.Linear(768, 128), nn.ReLU(), nn.Linear(128, EVENT_EMB_DIM)
        )
        self.theme_emb = nn.Embedding(n_themes, THEME_EMB_DIM)
        event_tower_dim = EVENT_EMB_DIM + THEME_EMB_DIM

        # --- Market Tower ---
        self.market_proj = nn.Sequential(
            nn.Linear(n_market_features + SESSION_EMB_DIM, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
        )
        self.session_emb = nn.Embedding(4, SESSION_EMB_DIM)
        market_tower_dim = 32

        # --- Asset Tower ---
        self.symbol_emb = nn.Embedding(n_symbols, SYMBOL_EMB_DIM)
        self.horizon_emb = nn.Embedding(3, HORIZON_EMB_DIM)
        asset_tower_dim = SYMBOL_EMB_DIM + HORIZON_EMB_DIM

        # --- Fusion ---
        fusion_dim = event_tower_dim + market_tower_dim + asset_tower_dim
        self.fusion = nn.Sequential(
            nn.Linear(fusion_dim, 128),
            nn.LayerNorm(128),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(128, 64),
            nn.LayerNorm(64),
            nn.ReLU(),
            nn.Dropout(0.1),
        )

        # --- FiLM conditioning (regime modulates fused representation) ---
        self.film = FiLMLayer(n_regimes, 64)

        # --- Output Heads ---
        self.head_alpha_prob = nn.Linear(64, 1)       # P(alpha > 0)
        self.head_expected_alpha = nn.Linear(64, 1)   # E[alpha]
        self.head_downside_q05 = nn.Linear(64, 1)     # 5th percentile (quantile)
        self.head_time_ordinal = nn.Linear(64, 2)     # ordinal: P(>=2w), P(>=1m)
        self.head_uplift_prob = nn.Linear(64, 1)      # P(uplift > 0)
        self.head_expected_uplift = nn.Linear(64, 1)  # E[uplift]

    def forward(self, event_emb, market_features, session_id, theme_id,
                symbol_id, horizon_id, regime_id):
        # Event tower
        e = self.event_proj(event_emb)
        t = self.theme_emb(theme_id)
        event_tower = torch.cat([e, t], dim=-1)

        # Market tower
        s = self.session_emb(session_id)
        m_in = torch.cat([market_features, s], dim=-1)
        market_tower = self.market_proj(m_in)

        # Asset tower
        sym = self.symbol_emb(symbol_id)
        hor = self.horizon_emb(horizon_id)
        asset_tower = torch.cat([sym, hor], dim=-1)

        # Fusion + FiLM
        fused = self.fusion(torch.cat([event_tower, market_tower, asset_tower], dim=-1))
        fused = self.film(fused, regime_id)

        # Heads
        alpha_prob = torch.sigmoid(self.head_alpha_prob(fused).squeeze(-1))
        expected_alpha = self.head_expected_alpha(fused).squeeze(-1)
        downside_q05 = self.head_downside_q05(fused).squeeze(-1)
        time_logits = self.head_time_ordinal(fused)  # [batch, 2]
        uplift_prob = torch.sigmoid(self.head_uplift_prob(fused).squeeze(-1))
        expected_uplift = self.head_expected_uplift(fused).squeeze(-1)

        return alpha_prob, expected_alpha, downside_q05, time_logits, uplift_prob, expected_uplift


# ---------------------------------------------------------------------------
# Losses
# ---------------------------------------------------------------------------
def pinball_loss(pred, target, quantile=0.05):
    """Quantile (pinball) loss for q05 downside"""
    diff = target - pred
    return torch.mean(torch.max(quantile * diff, (quantile - 1) * diff))


def ordinal_loss(logits, target_class):
    """
    Ordinal classification: predict P(Y >= k) for k=1,2
    target_class: 0=1w, 1=2w, 2=1m
    Binary targets: [Y>=2w, Y>=1m]
    """
    binary_targets = torch.stack([
        (target_class >= 1).float(),
        (target_class >= 2).float(),
    ], dim=-1)
    return F.binary_cross_entropy_with_logits(logits, binary_targets)


def multi_task_loss_v2(pred, target, pos_weight=1.0):
    alpha_prob, expected_alpha, downside_q05, time_logits, uplift_prob, expected_uplift = pred
    w = pos_weight

    loss_alpha_cls = F.binary_cross_entropy(alpha_prob, target["alpha_positive"], weight=torch.where(target["alpha_positive"] > 0.5, w, 1.0))
    loss_alpha_reg = F.huber_loss(expected_alpha, target["expected_alpha"], delta=2.0)
    loss_downside = pinball_loss(downside_q05, target["downside"], quantile=0.05)
    loss_time = ordinal_loss(time_logits, target["horizon_class"])
    loss_uplift_cls = F.binary_cross_entropy(uplift_prob, target["uplift_positive"])
    loss_uplift_reg = F.huber_loss(expected_uplift, target["expected_uplift"], delta=3.0)

    return (1.0 * loss_alpha_cls + 0.4 * loss_alpha_reg + 0.3 * loss_downside
            + 0.2 * loss_time + 0.3 * loss_uplift_cls + 0.2 * loss_uplift_reg)


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------
def load_training_data(conn):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT
            ce.id as event_id, ce.event_date, ce.theme, ce.avg_embedding,
            ef.*,
            a.market_session,
            lo.symbol, lo.horizon,
            lo.abnormal_return as avg_alpha,
            eu.uplift, eu.t_stat, eu.evidence_grade
        FROM event_features ef
        JOIN canonical_events ce ON ce.id = ef.canonical_event_id
        JOIN article_event_map aem ON aem.canonical_event_id = ce.id
        JOIN labeled_outcomes lo ON lo.article_id = aem.article_id
            AND lo.abnormal_return IS NOT NULL
        LEFT JOIN articles a ON a.id = aem.article_id
        LEFT JOIN event_uplift eu ON eu.canonical_event_id = ce.id
            AND eu.symbol = lo.symbol AND eu.horizon = lo.horizon
        ORDER BY ce.event_date
    """)
    rows = cur.fetchall()
    cur.close()
    print(f"Loaded {len(rows)} raw training rows")
    return rows


def build_vocab(rows):
    themes = sorted(set(r.get("theme") or "unknown" for r in rows))
    symbols = sorted(set(r.get("symbol") or "UNK" for r in rows))
    theme_to_id = {t: i for i, t in enumerate(themes)}
    symbol_to_id = {s: i for i, s in enumerate(symbols)}
    return theme_to_id, symbol_to_id


def parse_embedding(emb_str):
    if emb_str is None:
        return np.zeros(768, dtype=np.float32)
    if isinstance(emb_str, str):
        return np.array([float(x) for x in emb_str.strip("[]").split(",")], dtype=np.float32)
    if isinstance(emb_str, (list, np.ndarray)):
        return np.array(emb_str, dtype=np.float32)
    return np.zeros(768, dtype=np.float32)


def prepare_tensors_v2(rows, theme_to_id, symbol_to_id):
    event_embs = []
    market_feats = []
    session_ids = []
    theme_ids = []
    symbol_ids = []
    horizon_ids = []
    regime_ids = []
    event_ids = []

    y_alpha_pos = []
    y_alpha_val = []
    y_downside = []
    y_horizon_cls = []
    y_uplift_pos = []
    y_uplift_val = []
    dates = []

    for row in rows:
        # Market features
        feat = []
        skip = False
        for col in MARKET_FEATURES:
            val = row.get(col)
            if val is None:
                skip = True
                break
            feat.append(float(val))
        if skip:
            continue

        alpha = float(row.get("avg_alpha") or 0)
        uplift = float(row.get("uplift") or 0)
        theme = row.get("theme") or "unknown"
        symbol = row.get("symbol") or "UNK"
        horizon = row.get("horizon") or "2w"
        regime = row.get("regime_label") or "balanced"
        session = row.get("market_session") or "market_hours"
        emb = parse_embedding(row.get("avg_embedding"))

        if len(emb) != 768:
            emb = np.zeros(768, dtype=np.float32)

        event_embs.append(emb)
        market_feats.append(feat)
        session_ids.append(SESSION_TO_ID.get(session, 1))
        theme_ids.append(theme_to_id.get(theme, 0))
        symbol_ids.append(symbol_to_id.get(symbol, 0))
        horizon_ids.append(HORIZON_TO_ID.get(horizon, 1))
        regime_ids.append(REGIME_TO_ID.get(regime, 2))
        event_ids.append(row.get("event_id", 0))

        y_alpha_pos.append(1.0 if alpha > 0 else 0.0)
        y_alpha_val.append(alpha)
        y_downside.append(alpha - 1.645 * abs(alpha) * 0.5)  # rough q05 proxy
        y_horizon_cls.append(HORIZON_TO_ID.get(horizon, 1))
        y_uplift_pos.append(1.0 if uplift > 0 else 0.0)
        y_uplift_val.append(uplift)

        d = row.get("event_date")
        if isinstance(d, date_type) and not isinstance(d, datetime):
            d = datetime(d.year, d.month, d.day)
        dates.append(d or datetime(2021, 1, 1))

    X_market = torch.tensor(market_feats, dtype=torch.float32)
    mean = X_market.mean(dim=0)
    std = X_market.std(dim=0).clamp(min=1e-6)
    X_market = (X_market - mean) / std

    # Inverse frequency weight for alpha imbalance
    pos_count = sum(y_alpha_pos)
    neg_count = len(y_alpha_pos) - pos_count
    pos_weight = neg_count / max(pos_count, 1)

    return {
        "event_emb": torch.tensor(np.array(event_embs), dtype=torch.float32),
        "market_features": X_market,
        "session_ids": torch.tensor(session_ids, dtype=torch.long),
        "theme_ids": torch.tensor(theme_ids, dtype=torch.long),
        "symbol_ids": torch.tensor(symbol_ids, dtype=torch.long),
        "horizon_ids": torch.tensor(horizon_ids, dtype=torch.long),
        "regime_ids": torch.tensor(regime_ids, dtype=torch.long),
        "event_ids": event_ids,
        "y_alpha_positive": torch.tensor(y_alpha_pos, dtype=torch.float32),
        "y_expected_alpha": torch.tensor(y_alpha_val, dtype=torch.float32),
        "y_downside": torch.tensor(y_downside, dtype=torch.float32),
        "y_horizon_class": torch.tensor(y_horizon_cls, dtype=torch.long),
        "y_uplift_positive": torch.tensor(y_uplift_pos, dtype=torch.float32),
        "y_expected_uplift": torch.tensor(y_uplift_val, dtype=torch.float32),
        "dates": dates,
        "feature_mean": mean,
        "feature_std": std,
        "pos_weight": pos_weight,
    }


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------
def train_epoch(model, optimizer, data, batch_size=256):
    model.train()
    n = data["event_emb"].shape[0]
    indices = torch.randperm(n)
    total_loss = 0
    n_batches = 0

    for start in range(0, n, batch_size):
        end = min(start + batch_size, n)
        idx = indices[start:end]

        pred = model(
            data["event_emb"][idx], data["market_features"][idx],
            data["session_ids"][idx], data["theme_ids"][idx],
            data["symbol_ids"][idx], data["horizon_ids"][idx],
            data["regime_ids"][idx],
        )
        target = {
            "alpha_positive": data["y_alpha_positive"][idx],
            "expected_alpha": data["y_expected_alpha"][idx],
            "downside": data["y_downside"][idx],
            "horizon_class": data["y_horizon_class"][idx],
            "uplift_positive": data["y_uplift_positive"][idx],
            "expected_uplift": data["y_expected_uplift"][idx],
        }
        loss = multi_task_loss_v2(pred, target, pos_weight=data["pos_weight"])

        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()

        total_loss += loss.item()
        n_batches += 1

    return total_loss / max(n_batches, 1)


def evaluate(model, data):
    model.eval()
    with torch.no_grad():
        pred = model(
            data["event_emb"], data["market_features"],
            data["session_ids"], data["theme_ids"],
            data["symbol_ids"], data["horizon_ids"],
            data["regime_ids"],
        )
        alpha_prob, expected_alpha, downside, time_logits, uplift_prob, expected_uplift = pred

        brier = F.mse_loss(alpha_prob, data["y_alpha_positive"]).item()
        accuracy = ((alpha_prob > 0.5).float() == data["y_alpha_positive"]).float().mean().item()
        alpha_mae = F.l1_loss(expected_alpha, data["y_expected_alpha"]).item()

        n_top = min(20, len(alpha_prob))
        top_idx = alpha_prob.topk(n_top).indices
        top_precision = data["y_alpha_positive"][top_idx].mean().item()

        ece = compute_ece(alpha_prob.numpy(), data["y_alpha_positive"].numpy())

        uplift_acc = ((uplift_prob > 0.5).float() == data["y_uplift_positive"]).float().mean().item()

    return {
        "brier_score": round(brier, 4),
        "accuracy": round(accuracy, 4),
        "alpha_mae": round(alpha_mae, 4),
        "top20_precision": round(top_precision, 4),
        "ece": round(ece, 4),
        "uplift_accuracy": round(uplift_acc, 4),
    }


def compute_ece(probs, labels, n_bins=10):
    bin_boundaries = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    for i in range(n_bins):
        mask = (probs >= bin_boundaries[i]) & (probs < bin_boundaries[i + 1])
        if mask.sum() == 0:
            continue
        ece += mask.sum() / len(probs) * abs(labels[mask].mean() - probs[mask].mean())
    return ece


# ---------------------------------------------------------------------------
# Purged Walk-Forward (group split by event_id)
# ---------------------------------------------------------------------------
def purged_walk_forward_v2(rows, theme_to_id, symbol_to_id, n_market_features,
                           n_themes, n_symbols, n_splits=5, purge_days=14, epochs=50, lr=0.0005):
    def parse_date(r):
        d = r.get("event_date")
        if isinstance(d, date_type) and not isinstance(d, datetime):
            return datetime(d.year, d.month, d.day)
        return d or datetime(2021, 1, 1)

    sorted_rows = sorted(rows, key=parse_date)
    dates = [parse_date(r) for r in sorted_rows]
    n = len(sorted_rows)
    split_size = n // n_splits
    results = []

    for i in range(1, n_splits):
        test_start = i * split_size
        test_end = min((i + 1) * split_size, n)
        purge_cutoff = dates[test_start] - timedelta(days=purge_days)

        # Group split: ensure no event_id leaks
        test_event_ids = set(r.get("event_id") for r in sorted_rows[test_start:test_end])
        train_rows = [r for r in sorted_rows[:test_start]
                       if parse_date(r) <= purge_cutoff and r.get("event_id") not in test_event_ids]
        test_rows = sorted_rows[test_start:test_end]

        if len(train_rows) < 200 or len(test_rows) < 50:
            print(f"  Split {i}: skipped (train={len(train_rows)}, test={len(test_rows)})")
            continue

        train_data = prepare_tensors_v2(train_rows, theme_to_id, symbol_to_id)
        test_data = prepare_tensors_v2(test_rows, theme_to_id, symbol_to_id)

        if train_data["event_emb"].shape[0] < 100 or test_data["event_emb"].shape[0] < 30:
            continue

        # Standardize test with train stats
        test_data["market_features"] = (
            test_data["market_features"] * test_data["feature_std"] + test_data["feature_mean"]
            - train_data["feature_mean"]
        ) / train_data["feature_std"]

        model = EventDecisionModelV2(n_market_features, n_themes, n_symbols)
        optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-3)
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

        best_loss = float("inf")
        patience = 0
        for epoch in range(epochs):
            loss = train_epoch(model, optimizer, train_data)
            scheduler.step()
            if loss < best_loss:
                best_loss = loss
                patience = 0
            else:
                patience += 1
                if patience >= 10:
                    break

        metrics = evaluate(model, test_data)
        metrics["split"] = i
        metrics["train_size"] = train_data["event_emb"].shape[0]
        metrics["test_size"] = test_data["event_emb"].shape[0]
        results.append(metrics)

        print(f"  Split {i}: train={metrics['train_size']} test={metrics['test_size']} "
              f"brier={metrics['brier_score']} acc={metrics['accuracy']} "
              f"top20={metrics['top20_precision']} ece={metrics['ece']} "
              f"uplift_acc={metrics['uplift_accuracy']}")

    return results


# ---------------------------------------------------------------------------
# LightGBM Baseline
# ---------------------------------------------------------------------------
def run_lgbm_baseline(rows, theme_to_id, symbol_to_id):
    try:
        import lightgbm as lgb
    except ImportError:
        print("  LightGBM not installed, skipping baseline (pip install lightgbm)")
        return None

    data = prepare_tensors_v2(rows, theme_to_id, symbol_to_id)
    X = torch.cat([
        data["market_features"],
        data["theme_ids"].unsqueeze(1).float(),
        data["symbol_ids"].unsqueeze(1).float(),
        data["horizon_ids"].unsqueeze(1).float(),
        data["regime_ids"].unsqueeze(1).float(),
        data["session_ids"].unsqueeze(1).float(),
    ], dim=1).numpy()
    y = data["y_alpha_positive"].numpy()

    n = len(y)
    split = int(n * 0.7)
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]

    model = lgb.LGBMClassifier(n_estimators=200, max_depth=6, learning_rate=0.05,
                                 subsample=0.8, colsample_bytree=0.8, verbose=-1)
    model.fit(X_train, y_train)
    probs = model.predict_proba(X_test)[:, 1]

    brier = float(np.mean((probs - y_test) ** 2))
    acc = float(np.mean((probs > 0.5) == y_test))
    ece = compute_ece(probs, y_test)

    print(f"  LightGBM: brier={brier:.4f} acc={acc:.4f} ece={ece:.4f}")
    return {"brier": brier, "accuracy": acc, "ece": ece}


# ---------------------------------------------------------------------------
# Save
# ---------------------------------------------------------------------------
def save_eval_to_nas(conn, results, model_version):
    cur = conn.cursor()
    for r in results:
        cur.execute("""
            INSERT INTO model_eval (model_version, eval_date, split_type,
                brier_score, ece, top20_precision, alpha_hit_rate, n_samples)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (model_version, eval_date, split_type) DO UPDATE SET
                brier_score = EXCLUDED.brier_score, ece = EXCLUDED.ece,
                top20_precision = EXCLUDED.top20_precision, n_samples = EXCLUDED.n_samples
        """, (model_version, datetime.now().date(), f"purged_wf_split_{r['split']}",
              float(r["brier_score"]), float(r["ece"]),
              float(r["top20_precision"]), float(r["accuracy"]), int(r["test_size"])))
    conn.commit()
    cur.close()
    print(f"  Saved {len(results)} eval results to model_eval")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--lr", type=float, default=0.0005)
    parser.add_argument("--splits", type=int, default=5)
    parser.add_argument("--no-lgbm", action="store_true")
    args = parser.parse_args()

    print(f"train-meta-model-v2 - epochs={args.epochs} lr={args.lr} splits={args.splits}")

    conn = psycopg2.connect(**PG_CONFIG)

    print("\n>> Loading training data...")
    rows = load_training_data(conn)
    if len(rows) < 500:
        print(f"Not enough data ({len(rows)}). Need >= 500.")
        conn.close(); return

    theme_to_id, symbol_to_id = build_vocab(rows)
    n_themes = len(theme_to_id)
    n_symbols = len(symbol_to_id)
    print(f"  Themes: {n_themes}, Symbols: {n_symbols}")

    print("\n>> Preparing tensors...")
    data = prepare_tensors_v2(rows, theme_to_id, symbol_to_id)
    n_samples = data["event_emb"].shape[0]
    n_market = data["market_features"].shape[1]
    print(f"  Samples: {n_samples}, Market features: {n_market}")
    print(f"  Alpha positive rate: {data['y_alpha_positive'].mean():.3f}")
    print(f"  Uplift positive rate: {data['y_uplift_positive'].mean():.3f}")
    print(f"  Pos weight: {data['pos_weight']:.2f}")
    unique_events = len(set(data["event_ids"]))
    print(f"  Unique events: {unique_events} (effective independence ratio: {unique_events/n_samples:.2f})")

    # LightGBM baseline
    if not args.no_lgbm:
        print("\n>> LightGBM Baseline...")
        run_lgbm_baseline(rows, theme_to_id, symbol_to_id)

    # Purged walk-forward
    print(f"\n>> Purged Walk-Forward V2 ({args.splits} splits, 14-day purge, group split)...")
    wf_results = purged_walk_forward_v2(
        rows, theme_to_id, symbol_to_id, n_market, n_themes, n_symbols,
        n_splits=args.splits, epochs=args.epochs, lr=args.lr,
    )

    if wf_results:
        avg = {k: np.mean([r[k] for r in wf_results]) for k in wf_results[0] if isinstance(wf_results[0][k], float)}
        print(f"\n=== Walk-Forward V2 Average ===")
        for k, v in avg.items():
            print(f"  {k}: {v:.4f}")

    # Train final model
    print(f"\n>> Training final model on all {n_samples} samples...")
    model = EventDecisionModelV2(n_market, n_themes, n_symbols)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-3)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    for epoch in range(args.epochs):
        loss = train_epoch(model, optimizer, data)
        scheduler.step()
        if (epoch + 1) % 10 == 0:
            metrics = evaluate(model, data)
            print(f"  Epoch {epoch+1}: loss={loss:.4f} brier={metrics['brier_score']} "
                  f"acc={metrics['accuracy']} uplift_acc={metrics['uplift_accuracy']}")

    # Save
    model_version = f"meta-v2-{datetime.now().strftime('%Y%m%d-%H%M')}"
    model_path = Path("data") / f"{model_version}.pt"
    model_path.parent.mkdir(exist_ok=True)

    torch.save({
        "model_state": model.state_dict(),
        "feature_columns": MARKET_FEATURES,
        "feature_mean": data["feature_mean"],
        "feature_std": data["feature_std"],
        "theme_to_id": theme_to_id,
        "symbol_to_id": symbol_to_id,
        "model_version": model_version,
        "n_market_features": n_market,
        "n_themes": n_themes,
        "n_symbols": n_symbols,
        "architecture": "three-tower-film-v2",
    }, model_path)
    print(f"\n  Model saved: {model_path}")

    if wf_results:
        save_eval_to_nas(conn, wf_results, model_version)

    total_params = sum(p.numel() for p in model.parameters())
    print(f"  Total parameters: {total_params:,}")
    print(f"\n>> Training complete. Model version: {model_version}")
    conn.close()


if __name__ == "__main__":
    main()
