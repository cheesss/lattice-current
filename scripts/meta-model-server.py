#!/usr/bin/env python3
"""
meta-model-server.py - FastAPI GPU inference server for meta-model

Loads the trained PyTorch model and serves predictions via HTTP.
Runs on port 8100 by default.

Usage:
  python scripts/meta-model-server.py
  python scripts/meta-model-server.py --port 8100 --model data/meta-v1-20260411-0710.pt

  # With GPU:
  CUDA_VISIBLE_DEVICES=0 python scripts/meta-model-server.py
"""

import argparse
import os
import sys
from pathlib import Path

import numpy as np

try:
    import torch
    import torch.nn as nn
except ImportError:
    print("pip install torch"); sys.exit(1)

try:
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel
    import uvicorn
except ImportError:
    print("pip install fastapi uvicorn"); sys.exit(1)


def load_optional_env_file(path: str = ".env.local") -> None:
    env_path = Path(path)
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip().strip('"').strip("'")


def resolve_nas_pg_config() -> dict:
    load_optional_env_file()
    password = (
        os.environ.get("PG_PASSWORD")
        or os.environ.get("NAS_PG_PASSWORD")
        or os.environ.get("INTEL_PG_PASSWORD")
    )
    if not password:
        raise RuntimeError("missing PostgreSQL password")
    return {
        "host": os.environ.get("PG_HOST") or os.environ.get("NAS_PG_HOST") or "192.168.0.76",
        "port": int(os.environ.get("PG_PORT") or os.environ.get("NAS_PG_PORT") or "5433"),
        "dbname": (
            os.environ.get("PG_DATABASE")
            or os.environ.get("PG_DB")
            or os.environ.get("NAS_PG_DATABASE")
            or "lattice"
        ),
        "user": os.environ.get("PG_USER") or os.environ.get("NAS_PG_USER") or "postgres",
        "password": password,
    }


def load_active_model_version() -> str | None:
    try:
        import psycopg2
    except ImportError:
        return None
    try:
        cfg = resolve_nas_pg_config()
        conn = psycopg2.connect(**cfg)
        cur = conn.cursor()
        cur.execute(
            """
            SELECT model_version
              FROM model_registry
             WHERE promotion_state IN ('active', 'shadow')
             ORDER BY promoted_at DESC NULLS LAST, created_at DESC
             LIMIT 1
            """
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        return row[0] if row else None
    except Exception as exc:
        print(f"Could not resolve active model from model_registry: {exc}")
        return None


def resolve_model_path(explicit_model: str | None) -> str:
    if explicit_model:
        return explicit_model

    env_model_path = os.environ.get("META_MODEL_PATH")
    if env_model_path:
        return env_model_path

    data_dir = Path("data")
    env_model_version = os.environ.get("META_MODEL_VERSION")
    active_model_version = env_model_version or load_active_model_version()
    if active_model_version:
        active_path = data_dir / f"{active_model_version}.pt"
        if active_path.exists():
            print(f"Resolved active meta-model from registry/env: {active_model_version}")
            return str(active_path)
        print(f"Active meta-model file not found: {active_path}; falling back to latest artifact")

    pt_files = sorted(data_dir.glob("meta-v1-*.pt"))
    if not pt_files:
        print("No model file found in data/. Train first: python scripts/train-meta-model.py")
        sys.exit(1)
    return str(pt_files[-1])

# ---------------------------------------------------------------------------
# Model definition (must match train-meta-model.py)
# ---------------------------------------------------------------------------
class EventDecisionModel(nn.Module):
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
        nn.init.zeros_(self.regime_bias.weight)

    def forward(self, x, regime_id):
        shared = self.shared(x)
        r_bias = self.regime_bias(regime_id)
        alpha_prob = torch.sigmoid(self.head_alpha_prob(shared).squeeze(-1) + r_bias[:, 0])
        expected_alpha = self.head_expected_alpha(shared).squeeze(-1) + r_bias[:, 1]
        downside = self.head_downside(shared).squeeze(-1) + r_bias[:, 2]
        time_to_peak = self.head_time_to_peak(shared) + r_bias[:, 3].unsqueeze(1)
        return alpha_prob, expected_alpha, downside, time_to_peak


# ---------------------------------------------------------------------------
# API schema
# ---------------------------------------------------------------------------
class PredictRequest(BaseModel):
    source_count: float = 1
    source_diversity: float = 1
    article_count: float = 1
    hawkes_intensity: float = 0
    hawkes_momentum: float = 0
    vix_value: float = 20
    vix_zscore: float = 0
    vix_momentum: float = 0
    yield_spread: float = 0
    oil_price: float = 80
    dollar_index: float = 100
    credit_spread_hy: float = 4
    market_stress: float = 0
    transmission_strength: float = 0
    event_intensity: float = 0
    regime_multiplier: float = 1
    risk_gauge: float = 50
    regime_id: int = 2

class PredictResponse(BaseModel):
    alpha_prob: float
    expected_alpha: float
    downside_risk: float
    time_to_peak: str
    time_to_peak_probs: list[float]
    model_version: str


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
HORIZON_LABELS = ["1w", "2w", "1m"]

def create_app(model_path: str) -> FastAPI:
    import json
    from pathlib import Path

    app = FastAPI(title="Lattice Meta-Model Server", version="1.0")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    # Load model
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Loading model from {model_path} on {device}")

    ckpt = torch.load(model_path, map_location=device, weights_only=False)
    model = EventDecisionModel(ckpt["n_features"], n_themes=1, n_regimes=5)
    model.load_state_dict(ckpt["model_state"])
    model.to(device)
    model.eval()

    feature_mean = torch.tensor(ckpt["feature_mean"], dtype=torch.float32, device=device)
    feature_std = torch.tensor(ckpt["feature_std"], dtype=torch.float32, device=device).clamp(min=1e-6)
    model_version = ckpt.get("model_version", "unknown")

    # Optional post-hoc temperature scaling sidecar (calibrate-meta-model.py).
    # If present, divide alpha_prob logit by T before sigmoid so calibration
    # (ECE) improves without changing rank ordering.
    calibration_path = Path(model_path).parent / f"{Path(model_path).stem}.calibration.json"
    temperature = 1.0
    calibration_meta = None
    if calibration_path.exists():
        try:
            calibration_meta = json.loads(calibration_path.read_text())
            t_val = float(calibration_meta.get("temperature", 1.0))
            if t_val > 0 and t_val < 100:
                temperature = t_val
            print(f"  calibration sidecar loaded: T={temperature:.3f}, "
                  f"ECE {calibration_meta.get('pre_metrics', {}).get('ece', '?'):.4f} → "
                  f"{calibration_meta.get('post_metrics', {}).get('ece', '?'):.4f}")
        except Exception as e:
            print(f"  WARN: failed to parse calibration sidecar: {e}")

    print(f"Model loaded: {model_version}, {ckpt['n_features']} features, device={device}, T={temperature:.3f}")
    if device.type == "cuda":
        print(f"  GPU: {torch.cuda.get_device_name(0)}")

    def apply_temperature(prob_tensor):
        """Apply post-hoc temperature scaling to a sigmoid-output probability tensor.
        Returns the recalibrated probability. T=1.0 is a no-op."""
        if abs(temperature - 1.0) < 1e-6:
            return prob_tensor
        eps = 1e-7
        clamped = prob_tensor.clamp(min=eps, max=1.0 - eps)
        logit = torch.log(clamped / (1 - clamped))
        return torch.sigmoid(logit / temperature)

    @app.get("/health")
    async def health():
        out = {"status": "ok", "model_version": model_version, "device": str(device), "temperature": temperature}
        if calibration_meta:
            out["calibration"] = {
                "temperature": temperature,
                "pre_ece": calibration_meta.get("pre_metrics", {}).get("ece"),
                "post_ece": calibration_meta.get("post_metrics", {}).get("ece"),
                "validation_n": calibration_meta.get("validation_n"),
            }
        return out

    @app.post("/predict", response_model=PredictResponse)
    async def predict(req: PredictRequest):
        features = torch.tensor([[
            req.source_count, req.source_diversity, req.article_count,
            req.hawkes_intensity, req.hawkes_momentum,
            req.vix_value, req.vix_zscore, req.vix_momentum,
            req.yield_spread, req.oil_price, req.dollar_index, req.credit_spread_hy,
            req.market_stress, req.transmission_strength, req.event_intensity,
            req.regime_multiplier, req.risk_gauge,
        ]], dtype=torch.float32, device=device)

        # Normalize
        features = (features - feature_mean) / feature_std
        regime_id = torch.tensor([req.regime_id], dtype=torch.long, device=device)

        with torch.no_grad():
            alpha_prob, expected_alpha, downside, time_logits = model(features, regime_id)
            alpha_prob = apply_temperature(alpha_prob)

        # Softmax for time_to_peak
        time_probs = torch.softmax(time_logits[0], dim=0).cpu().tolist()
        peak_idx = int(np.argmax(time_probs))

        return PredictResponse(
            alpha_prob=round(float(alpha_prob[0].cpu()), 4),
            expected_alpha=round(float(expected_alpha[0].cpu()), 4),
            downside_risk=round(float(downside[0].cpu()), 4),
            time_to_peak=HORIZON_LABELS[peak_idx],
            time_to_peak_probs=[round(p, 4) for p in time_probs],
            model_version=model_version,
        )

    @app.post("/predict/batch")
    async def predict_batch(requests: list[PredictRequest]):
        n = len(requests)
        features = torch.tensor([[
            r.source_count, r.source_diversity, r.article_count,
            r.hawkes_intensity, r.hawkes_momentum,
            r.vix_value, r.vix_zscore, r.vix_momentum,
            r.yield_spread, r.oil_price, r.dollar_index, r.credit_spread_hy,
            r.market_stress, r.transmission_strength, r.event_intensity,
            r.regime_multiplier, r.risk_gauge,
        ] for r in requests], dtype=torch.float32, device=device)

        features = (features - feature_mean) / feature_std
        regime_ids = torch.tensor([r.regime_id for r in requests], dtype=torch.long, device=device)

        with torch.no_grad():
            alpha_prob, expected_alpha, downside, time_logits = model(features, regime_ids)
            alpha_prob = apply_temperature(alpha_prob)

        results = []
        for i in range(n):
            time_probs = torch.softmax(time_logits[i], dim=0).cpu().tolist()
            peak_idx = int(np.argmax(time_probs))
            results.append({
                "alpha_prob": round(float(alpha_prob[i].cpu()), 4),
                "expected_alpha": round(float(expected_alpha[i].cpu()), 4),
                "downside_risk": round(float(downside[i].cpu()), 4),
                "time_to_peak": HORIZON_LABELS[peak_idx],
                "time_to_peak_probs": [round(p, 4) for p in time_probs],
                "model_version": model_version,
            })
        return results

    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8100)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--model", default=None, help="Path to .pt model file")
    args = parser.parse_args()

    model_path = resolve_model_path(args.model)

    app = create_app(model_path)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
