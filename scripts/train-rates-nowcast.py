#!/usr/bin/env python3
"""
train-rates-nowcast.py — Phase 2a nowcast trainer for FRED-delayed rate signals.

Trains linear (ridge) models that predict the FRED publication value using
today's ETF proxies. Models are vintage-safe: for each training timestamp t,
features include only values that would have been observable at t's market
close (FRED values that had been published by then, plus ETF closes from day t).

Targets (one model each, selected via --target):
  - hy_credit_spread   features: HYG_close_t, log(HYG_close_t), vix_t,
                                 HYG_close_{t-1}, hy_spread_{t-1}
  - treasury10y        features: ^TNX_close_t, TLT_close_t, treasury10y_{t-1}
  - yieldSpread        features: ^TNX_t, short_rate_proxy_t, yieldSpread_{t-1}
  - ig_credit_spread   features: LQD_close_t, vix_t, ig_spread_{t-1}

Outputs:
  - data/models/<target>-nowcast.pkl (joblib bundle: model, feature_columns,
                                       train_meta)
  - NAS table nowcast_training_snapshots row

Evaluation: walk-forward over the most recent 30 trading days. Baseline is the
last-known FRED value (naive carry-forward). Acceptance gate: MAE < baseline *
0.85 AND coverage90 >= 0.80 before promoting to prod inference.

Usage:
  python scripts/train-rates-nowcast.py --target hy_credit_spread --window 180
  python scripts/train-rates-nowcast.py --target hy_credit_spread --validate
  python scripts/train-rates-nowcast.py --target treasury10y
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg2
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error
from joblib import dump


# ---------------------------------------------------------------------------
# Target model specs
# ---------------------------------------------------------------------------

@dataclass
class TargetSpec:
    target_signal: str
    proxy_market_symbols: list[str]   # pulled from market_quotes.last_price
    extra_signal_features: list[str]  # pulled from signal_history (observed only)
    horizon_days: int = 1             # T+1 FRED release


_SYMBOLS_JSON = json.loads(
    (Path(__file__).parent / '_shared' / 'market-quote-symbols.json').read_text(encoding='utf-8')
)
_NOWCAST_FEATURES = _SYMBOLS_JSON['nowcastFeatures']


def _feature_symbols(target: str) -> list[str]:
    if target not in _NOWCAST_FEATURES:
        raise KeyError(f'{target} missing from market-quote-symbols.json nowcastFeatures')
    return list(_NOWCAST_FEATURES[target])


TARGETS: dict[str, TargetSpec] = {
    'hy_credit_spread': TargetSpec(
        target_signal='hy_credit_spread',
        proxy_market_symbols=_feature_symbols('hy_credit_spread'),
        extra_signal_features=['vix'],
    ),
    'treasury10y': TargetSpec(
        target_signal='treasury10y',
        proxy_market_symbols=_feature_symbols('treasury10y'),
        extra_signal_features=[],
    ),
    'yieldSpread': TargetSpec(
        target_signal='yieldSpread',
        proxy_market_symbols=_feature_symbols('yieldSpread'),
        extra_signal_features=[],
    ),
    'ig_credit_spread': TargetSpec(
        target_signal='ig_credit_spread',
        proxy_market_symbols=_feature_symbols('ig_credit_spread'),
        extra_signal_features=['vix'],
    ),
}


# ---------------------------------------------------------------------------
# DB utilities
# ---------------------------------------------------------------------------

def connect_nas():
    return psycopg2.connect(
        host=os.environ.get('PG_HOST', '192.168.0.2'),
        port=int(os.environ.get('PG_PORT', 5433)),
        database=os.environ.get('PG_DATABASE', 'lattice'),
        user=os.environ.get('PG_USER', 'postgres'),
        password=os.environ['PG_PASSWORD'],
    )


def fetch_fred_target_history(conn, signal_name: str, lookback_days: int) -> pd.DataFrame:
    """Load FRED-observed values for the target signal, keeping only observed rows."""
    query = """
        SELECT ts::date AS d, value
        FROM signal_history
        WHERE signal_name = %s
          AND value_origin = 'observed'
          AND ts >= (CURRENT_DATE - (%s || ' days')::interval)
        ORDER BY ts
    """
    return pd.read_sql(query, conn, params=(signal_name, lookback_days))


def fetch_signal_feature(conn, signal_name: str, lookback_days: int) -> pd.DataFrame:
    """Pull observed-only values for a signal feature (e.g. vix)."""
    query = """
        SELECT ts::date AS d, value
        FROM signal_history
        WHERE signal_name = %s
          AND value_origin = 'observed'
          AND ts >= (CURRENT_DATE - (%s || ' days')::interval)
        ORDER BY ts
    """
    df = pd.read_sql(query, conn, params=(signal_name, lookback_days))
    df = df.rename(columns={'value': signal_name})
    return df


def fetch_market_quote_history(conn, symbol: str, lookback_days: int) -> pd.DataFrame:
    """Load market_quotes last_price series for a symbol."""
    # market_quotes may hold intraday ticks; use the latest per-day for training.
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
    df = df.rename(columns={'value': symbol})
    return df


def build_training_frame(conn, spec: TargetSpec, window_days: int) -> pd.DataFrame:
    target_df = fetch_fred_target_history(conn, spec.target_signal, window_days)
    target_df = target_df.rename(columns={'value': spec.target_signal})

    frames = [target_df.set_index('d')]
    for symbol in spec.proxy_market_symbols:
        df = fetch_market_quote_history(conn, symbol, window_days)
        if df.empty:
            raise RuntimeError(f'no market_quotes rows for {symbol}')
        frames.append(df.set_index('d'))
    for signal in spec.extra_signal_features:
        df = fetch_signal_feature(conn, signal, window_days)
        if df.empty:
            raise RuntimeError(f'no signal_history rows for {signal}')
        frames.append(df.set_index('d'))

    merged = frames[0]
    for df in frames[1:]:
        merged = merged.join(df, how='outer')
    merged = merged.sort_index()
    # Vintage-aware lags: yesterday's target + yesterday's main proxy.
    merged[f'{spec.target_signal}_lag1'] = merged[spec.target_signal].shift(1)
    if spec.proxy_market_symbols:
        primary_proxy = spec.proxy_market_symbols[0]
        merged[f'{primary_proxy}_lag1'] = merged[primary_proxy].shift(1)
    # Drop rows with any NaN — keeps us strictly on days where every feature
    # would have been observable at day's close.
    merged = merged.dropna()
    return merged.reset_index()


def feature_columns(spec: TargetSpec) -> list[str]:
    cols: list[str] = []
    for symbol in spec.proxy_market_symbols:
        cols.append(symbol)
        cols.append(f'{symbol}_lag1' if symbol == spec.proxy_market_symbols[0] else symbol)
    # dedup while preserving order
    seen: set[str] = set()
    unique_proxies: list[str] = []
    for c in cols:
        if c not in seen:
            seen.add(c); unique_proxies.append(c)
    cols = unique_proxies
    cols.extend(spec.extra_signal_features)
    cols.append(f'{spec.target_signal}_lag1')
    return cols


def train_and_validate(df: pd.DataFrame, spec: TargetSpec, alpha: float = 1.0) -> dict:
    cols = feature_columns(spec)
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

    # Residual-based interval (90%). Empirical 90th-percentile of |train residuals|
    # is more robust than a Gaussian 1.645*σ when residuals are heavy-tailed or
    # when holdout variance exceeds train variance. We keep resid_std for
    # compatibility with inference code that exposes it in train_meta.
    train_residuals = train_y - model.predict(train_X)
    resid_std = float(np.std(train_residuals))
    interval_halfwidth = float(np.percentile(np.abs(train_residuals), 90))

    # Naive baseline: predict today = yesterday.
    naive_baseline = holdout_y.copy()
    naive_baseline[1:] = holdout_y[:-1]
    naive_baseline[0] = train_y[-1]
    baseline_mae = mean_absolute_error(holdout_y, naive_baseline)

    coverage = float(np.mean(np.abs(holdout_y - pred_holdout) <= interval_halfwidth))

    return {
        'model': model,
        'feature_columns': cols,
        'holdout_mae': float(mae),
        'baseline_mae': float(baseline_mae),
        'mae_improvement': float((baseline_mae - mae) / baseline_mae) if baseline_mae > 0 else 0.0,
        'interval_halfwidth_90': float(interval_halfwidth),
        'coverage_90': coverage,
        'residual_std': resid_std,
        'n_train': int(len(train_y)),
        'n_holdout': int(len(holdout_y)),
        'train_start': df['d'].iloc[0].isoformat() if hasattr(df['d'].iloc[0], 'isoformat') else str(df['d'].iloc[0]),
        'train_end': df['d'].iloc[-holdout_size - 1].isoformat() if hasattr(df['d'].iloc[-holdout_size - 1], 'isoformat') else str(df['d'].iloc[-holdout_size - 1]),
    }


def save_model(target: str, version: str, bundle: dict, spec: TargetSpec) -> Path:
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
    # Also write a latest pointer so inference can load without knowing version.
    latest_path = models_dir / f'{target}-nowcast-latest.pkl'
    dump(payload, latest_path)
    return path


def record_training_snapshot(conn, target: str, version: str, bundle: dict, spec: TargetSpec):
    feature_hash = hashlib.sha256(','.join(bundle['feature_columns']).encode()).hexdigest()[:16]
    vintage_cutoff = datetime.now(timezone.utc)  # now() snapshot for reproducibility
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
                target,
                datetime.now(timezone.utc),
                vintage_cutoff,
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
    ap.add_argument('--validate', action='store_true',
                    help='Print eval summary without saving model / snapshot')
    args = ap.parse_args()

    spec = TARGETS[args.target]
    conn = connect_nas()

    try:
        sys.path.insert(0, str(Path(__file__).parent / '_shared'))
        from market_quote_coverage import abort_if_missing  # noqa: E402
        cov = abort_if_missing(conn, spec.proxy_market_symbols,
                               window_days=args.window)
        print(f'coverage OK: {cov.row_count_by_symbol}')

        df = build_training_frame(conn, spec, args.window)
        if df.empty:
            print(f'ERROR: empty training frame for {args.target}', file=sys.stderr)
            sys.exit(2)
        print(f'training rows: {len(df)}  features: {feature_columns(spec)}')
        bundle = train_and_validate(df, spec, alpha=args.alpha)

        print('\nEvaluation:')
        print(f"  MAE              {bundle['holdout_mae']:.6f}")
        print(f"  baseline MAE     {bundle['baseline_mae']:.6f}")
        print(f"  improvement      {bundle['mae_improvement']*100:.1f}%")
        print(f"  coverage(90%)    {bundle['coverage_90']:.2f}")
        print(f"  interval ±       {bundle['interval_halfwidth_90']:.6f}")
        print(f"  train/holdout    {bundle['n_train']}/{bundle['n_holdout']}")

        from nowcast_acceptance_gate import evaluate_gate  # noqa: E402
        verdict = evaluate_gate(bundle)
        print(f"\nAcceptance gate: {'PASS' if verdict.passed else 'FAIL'}")
        if verdict.reasons:
            for r in verdict.reasons:
                print(f'  - {r}')

        if args.validate:
            print('\n[validate mode — not saving]')
            return

        if not verdict.passed:
            print('\n[gate fail — refusing to save .pkl; target stays untrained]',
                  file=sys.stderr)
            sys.exit(3)

        version = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
        path = save_model(args.target, version, bundle, spec)
        record_training_snapshot(conn, args.target, version, bundle, spec)
        print(f'\nSaved: {path}')
        print(f'Recorded training snapshot for {args.target} version={version}')
    finally:
        conn.close()


if __name__ == '__main__':
    main()
