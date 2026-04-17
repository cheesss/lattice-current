#!/usr/bin/env python3
"""
train-commodity-fx-nowcast.py — Phase 2c nowcast trainer for oilPrice and dollarIndex.

These targets have longer gaps than the FRED rates set: Oil can be stale for
5+ days when futures quotes fail, and DXY has weekend blackouts. Features
rely on liquid ETF proxies that stay updated outside the Yahoo daily chart
path.

Targets:
  - oilPrice      features: XLE, USO, XOM, CVX, oilPrice_lag1
  - dollarIndex   features: UUP, EUR_USD_proxy, dollarIndex_lag1

Weekend / holiday training rows are dropped automatically because ETF closes
only exist for trading days.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg2
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error
from joblib import dump


@dataclass
class TargetSpec:
    target_signal: str
    proxy_market_symbols: list[str]
    extra_signal_features: list[str]


_SYMBOLS_JSON = json.loads(
    (Path(__file__).parent / '_shared' / 'market-quote-symbols.json').read_text(encoding='utf-8')
)
_NOWCAST_FEATURES = _SYMBOLS_JSON['nowcastFeatures']


def _feature_symbols(target: str) -> list[str]:
    if target not in _NOWCAST_FEATURES:
        raise KeyError(f'{target} missing from market-quote-symbols.json nowcastFeatures')
    return list(_NOWCAST_FEATURES[target])


TARGETS: dict[str, TargetSpec] = {
    'oilPrice': TargetSpec(
        target_signal='oilPrice',
        proxy_market_symbols=_feature_symbols('oilPrice'),
        extra_signal_features=[],
    ),
    'dollarIndex': TargetSpec(
        target_signal='dollarIndex',
        proxy_market_symbols=_feature_symbols('dollarIndex'),
        extra_signal_features=[],
    ),
}


def connect_nas():
    return psycopg2.connect(
        host=os.environ.get('PG_HOST', '192.168.0.2'),
        port=int(os.environ.get('PG_PORT', 5433)),
        database=os.environ.get('PG_DATABASE', 'lattice'),
        user=os.environ.get('PG_USER', 'postgres'),
        password=os.environ['PG_PASSWORD'],
    )


def fetch_signal_history(conn, signal_name, lookback_days):
    query = """
        SELECT ts::date AS d, value
        FROM signal_history
        WHERE signal_name = %s
          AND value_origin = 'observed'
          AND ts >= (CURRENT_DATE - (%s || ' days')::interval)
        ORDER BY ts
    """
    df = pd.read_sql(query, conn, params=(signal_name, lookback_days))
    return df.rename(columns={'value': signal_name})


def fetch_daily_quotes(conn, symbol, lookback_days):
    query = """
        SELECT observed_at::date AS d,
               last_price AS value
        FROM (
          SELECT symbol, observed_at, last_price,
                 ROW_NUMBER() OVER (
                   PARTITION BY symbol, observed_at::date ORDER BY observed_at DESC
                 ) AS rn
          FROM market_quotes
          WHERE symbol = %s
            AND observed_at >= (CURRENT_DATE - (%s || ' days')::interval)
        ) t
        WHERE rn = 1
        ORDER BY d
    """
    df = pd.read_sql(query, conn, params=(symbol, lookback_days))
    return df.rename(columns={'value': symbol})


def build_frame(conn, spec, window_days):
    target_df = fetch_signal_history(conn, spec.target_signal, window_days)
    frames = [target_df.set_index('d')]
    for symbol in spec.proxy_market_symbols:
        df = fetch_daily_quotes(conn, symbol, window_days)
        if df.empty:
            print(f'WARN: no quotes for {symbol}', file=sys.stderr)
            continue
        frames.append(df.set_index('d'))
    for signal in spec.extra_signal_features:
        df = fetch_signal_history(conn, signal, window_days)
        if not df.empty:
            frames.append(df.set_index('d'))
    merged = frames[0]
    for df in frames[1:]:
        merged = merged.join(df, how='outer')
    merged = merged.sort_index()
    merged[f'{spec.target_signal}_lag1'] = merged[spec.target_signal].shift(1)
    merged = merged.dropna()
    return merged.reset_index()


def feature_columns(spec):
    cols = list(spec.proxy_market_symbols) + list(spec.extra_signal_features)
    cols.append(f'{spec.target_signal}_lag1')
    return cols


def train_and_validate(df, spec, alpha=1.0):
    cols = feature_columns(spec)
    # Ensure all feature columns are present (some may have been dropped by fetch).
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise RuntimeError(f'missing feature columns: {missing}')

    y = df[spec.target_signal].values
    X = df[cols].values
    if len(df) < 60:
        raise RuntimeError(f'too few training rows ({len(df)}); need ≥60')

    holdout_size = min(30, max(10, int(len(df) * 0.15)))
    train_X, holdout_X = X[:-holdout_size], X[-holdout_size:]
    train_y, holdout_y = y[:-holdout_size], y[-holdout_size:]

    model = Ridge(alpha=alpha, fit_intercept=True)
    model.fit(train_X, train_y)
    pred_holdout = model.predict(holdout_X)
    mae = mean_absolute_error(holdout_y, pred_holdout)

    residuals = train_y - model.predict(train_X)
    resid_std = float(np.std(residuals))
    # Empirical 90th-percentile of |train residuals| — see train-rates-nowcast.py
    # for rationale. Keeps resid_std exposed for inference compatibility.
    halfwidth = float(np.percentile(np.abs(residuals), 90))

    naive = holdout_y.copy(); naive[1:] = holdout_y[:-1]; naive[0] = train_y[-1]
    baseline_mae = mean_absolute_error(holdout_y, naive)
    coverage = float(np.mean(np.abs(holdout_y - pred_holdout) <= halfwidth))

    return {
        'model': model,
        'feature_columns': cols,
        'holdout_mae': float(mae),
        'baseline_mae': float(baseline_mae),
        'mae_improvement': float((baseline_mae - mae) / baseline_mae) if baseline_mae > 0 else 0.0,
        'interval_halfwidth_90': float(halfwidth),
        'coverage_90': coverage,
        'residual_std': resid_std,
        'n_train': int(len(train_y)),
        'n_holdout': int(len(holdout_y)),
    }


def save_model(target, version, bundle, spec):
    models_dir = Path(__file__).parent.parent / 'data' / 'models'
    models_dir.mkdir(parents=True, exist_ok=True)
    path = models_dir / f'{target}-nowcast-{version}.pkl'
    payload = {
        'model': bundle['model'],
        'feature_columns': bundle['feature_columns'],
        'target_signal': spec.target_signal,
        'proxy_market_symbols': spec.proxy_market_symbols,
        'extra_signal_features': spec.extra_signal_features,
        'version': version,
        'train_meta': {k: v for k, v in bundle.items() if k not in ('model',)},
    }
    dump(payload, path)
    dump(payload, models_dir / f'{target}-nowcast-latest.pkl')
    return path


def record_snapshot(conn, target, bundle):
    feature_hash = hashlib.sha256(','.join(bundle['feature_columns']).encode()).hexdigest()[:16]
    eval_summary = {k: v for k, v in bundle.items() if k not in ('model', 'feature_columns')}
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO nowcast_training_snapshots
              (target_signal, training_date, feature_vintage_cutoff,
               feature_set_hash, row_count, feature_columns, eval_summary)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
            """,
            (
                target, datetime.now(timezone.utc), datetime.now(timezone.utc),
                feature_hash,
                bundle['n_train'] + bundle['n_holdout'],
                json.dumps(bundle['feature_columns']),
                json.dumps(eval_summary),
            ),
        )
    conn.commit()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--target', required=True, choices=sorted(TARGETS.keys()))
    ap.add_argument('--window', type=int, default=180)
    ap.add_argument('--alpha', type=float, default=1.0)
    ap.add_argument('--validate', action='store_true')
    args = ap.parse_args()

    spec = TARGETS[args.target]
    conn = connect_nas()
    try:
        sys.path.insert(0, str(Path(__file__).parent / '_shared'))
        from market_quote_coverage import abort_if_missing  # noqa: E402
        cov = abort_if_missing(conn, spec.proxy_market_symbols,
                               window_days=args.window)
        print(f'coverage OK: {cov.row_count_by_symbol}')

        df = build_frame(conn, spec, args.window)
        if df.empty:
            print(f'ERROR: empty training frame for {args.target}', file=sys.stderr)
            sys.exit(2)
        bundle = train_and_validate(df, spec, alpha=args.alpha)
        print(f"{args.target}: MAE {bundle['holdout_mae']:.4f} vs baseline {bundle['baseline_mae']:.4f} "
              f"(improvement {bundle['mae_improvement']*100:.1f}%), coverage90 {bundle['coverage_90']:.2f}")

        from nowcast_acceptance_gate import evaluate_gate  # noqa: E402
        verdict = evaluate_gate(bundle)
        print(f"gate: {'PASS' if verdict.passed else 'FAIL'}" + (
            '' if not verdict.reasons else ' (' + '; '.join(verdict.reasons) + ')'))

        if args.validate:
            return

        if not verdict.passed:
            print('[gate fail — refusing to save .pkl; target stays untrained]',
                  file=sys.stderr)
            sys.exit(3)

        version = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
        save_model(args.target, version, bundle, spec)
        record_snapshot(conn, args.target, bundle)
        print(f'Saved {args.target} nowcast model version={version}')
    finally:
        conn.close()


if __name__ == '__main__':
    main()
