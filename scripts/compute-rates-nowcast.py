#!/usr/bin/env python3
"""
compute-rates-nowcast.py — Phase 2a inference driver.

Loads the trained rate nowcast models (trained by train-rates-nowcast.py),
gathers current market_quotes + signal_history features with vintage rules,
and writes predictions into estimated_signal_nowcasts.

Run per-target or all-at-once:
  python scripts/compute-rates-nowcast.py --target hy_credit_spread
  python scripts/compute-rates-nowcast.py --all
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import psycopg2
from joblib import load


TARGETS = ['hy_credit_spread', 'treasury10y', 'yieldSpread', 'ig_credit_spread']


def connect_nas():
    return psycopg2.connect(
        host=os.environ.get('PG_HOST', '192.168.0.2'),
        port=int(os.environ.get('PG_PORT', 5433)),
        database=os.environ.get('PG_DATABASE', 'lattice'),
        user=os.environ.get('PG_USER', 'postgres'),
        password=os.environ['PG_PASSWORD'],
    )


def load_latest_market_quote(cur, symbol: str):
    cur.execute(
        """
        SELECT last_price, observed_at
        FROM market_quotes
        WHERE symbol = %s
        ORDER BY observed_at DESC
        LIMIT 1
        """,
        (symbol,),
    )
    row = cur.fetchone()
    return row if row else (None, None)


def load_previous_close_market_quote(cur, symbol: str):
    """Latest quote that is strictly older than today's 00:00 UTC — serves as
    the lag_1 feature during inference."""
    cur.execute(
        """
        SELECT last_price, observed_at
        FROM market_quotes
        WHERE symbol = %s
          AND observed_at < DATE_TRUNC('day', NOW())
        ORDER BY observed_at DESC
        LIMIT 1
        """,
        (symbol,),
    )
    row = cur.fetchone()
    return row if row else (None, None)


def load_latest_observed_signal(cur, signal_name: str):
    cur.execute(
        """
        SELECT value, ts
        FROM signal_history
        WHERE signal_name = %s
          AND value_origin = 'observed'
        ORDER BY ts DESC
        LIMIT 1
        """,
        (signal_name,),
    )
    row = cur.fetchone()
    return row if row else (None, None)


def build_feature_vector(cur, feature_columns: list[str]):
    """Materialize feature values using vintage rules.
    Feature names map:
      - '<symbol>'      → latest market_quote
      - '<symbol>_lag1' → yesterday's close (pre-midnight snapshot)
      - '<signal>_lag1' → latest observed signal_history value (T+1 FRED lag)
      - '<signal>'      → latest observed signal_history value
    """
    values: list[float] = []
    sources: list[dict] = []
    for col in feature_columns:
        # Resolve based on suffix
        if col.endswith('_lag1'):
            base = col[:-5]
            # Try market_quote previous close first
            val, ts = load_previous_close_market_quote(cur, base)
            if val is None:
                # Fallback: latest observed signal (T+1 FRED lag used this way)
                val, ts = load_latest_observed_signal(cur, base)
            if val is None:
                return None, f'missing feature {col}'
            values.append(float(val))
            sources.append({'feature': col, 'value': float(val), 'observed_at': ts.isoformat() if ts else None})
        else:
            val, ts = load_latest_market_quote(cur, col)
            if val is None:
                val, ts = load_latest_observed_signal(cur, col)
            if val is None:
                return None, f'missing feature {col}'
            values.append(float(val))
            sources.append({'feature': col, 'value': float(val), 'observed_at': ts.isoformat() if ts else None})
    return np.array(values, dtype=float), sources


def predict_and_write(conn, target: str):
    models_dir = Path(__file__).parent.parent / 'data' / 'models'
    model_path = models_dir / f'{target}-nowcast-latest.pkl'
    if not model_path.exists():
        return {'target': target, 'ok': False, 'reason': 'no trained model', 'abstain': True}
    bundle = load(model_path)

    with conn.cursor() as cur:
        features, sources_or_reason = build_feature_vector(cur, bundle['feature_columns'])
        if features is None:
            return {'target': target, 'ok': False, 'reason': sources_or_reason, 'abstain': True}
        pred = float(bundle['model'].predict(features.reshape(1, -1))[0])
        interval = float(bundle['train_meta']['interval_halfwidth_90'])
        resid_std = float(bundle['train_meta']['residual_std'])
        # Raw model confidence: derive from coverage_90 of the holdout period.
        raw_confidence = float(bundle['train_meta']['coverage_90'])

        method = f"{target}-ridge-{bundle['version']}"
        target_ts = datetime.now(timezone.utc)
        feature_vintage_at = target_ts

        derived_from = [{'name': s['feature'], 'observed_at': s['observed_at']} for s in sources_or_reason]
        input_snapshot = {s['feature']: s['value'] for s in sources_or_reason}

        cur.execute(
            """
            INSERT INTO estimated_signal_nowcasts (
              signal_name, target_ts, model_version,
              estimated_value, estimate_method, estimate_confidence,
              interval_low, interval_high,
              feature_vintage_at, derived_from_sources,
              input_sources_snapshot
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
            ON CONFLICT (signal_name, target_ts, model_version) DO UPDATE
              SET estimated_value = EXCLUDED.estimated_value,
                  estimate_confidence = EXCLUDED.estimate_confidence,
                  interval_low = EXCLUDED.interval_low,
                  interval_high = EXCLUDED.interval_high,
                  feature_vintage_at = EXCLUDED.feature_vintage_at,
                  derived_from_sources = EXCLUDED.derived_from_sources,
                  input_sources_snapshot = EXCLUDED.input_sources_snapshot
            """,
            (
                target, target_ts, bundle['version'],
                pred, method, raw_confidence,
                pred - interval, pred + interval,
                feature_vintage_at, json.dumps(derived_from),
                json.dumps(input_snapshot),
            ),
        )
    conn.commit()
    return {
        'target': target,
        'ok': True,
        'abstain': False,
        'predicted': pred,
        'interval': [pred - interval, pred + interval],
        'confidence': raw_confidence,
        'model_version': bundle['version'],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--target', choices=TARGETS)
    ap.add_argument('--all', action='store_true')
    args = ap.parse_args()
    if not args.target and not args.all:
        ap.error('must pass --target or --all')

    targets = TARGETS if args.all else [args.target]
    conn = connect_nas()
    try:
        results = []
        for t in targets:
            try:
                result = predict_and_write(conn, t)
            except Exception as exc:  # pragma: no cover — surfaced in stderr
                result = {'target': t, 'ok': False, 'reason': str(exc), 'abstain': True}
            results.append(result)
            prefix = 'OK' if result['ok'] else 'SKIP'
            print(f"[{prefix}] {json.dumps(result, default=str)}")
    finally:
        conn.close()


if __name__ == '__main__':
    main()
