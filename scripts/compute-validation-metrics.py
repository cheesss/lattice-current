#!/usr/bin/env python3
"""
compute-validation-metrics.py — 모델 검증 지표 계산 + NAS 저장

현재 시스템의 기존 conviction 점수 vs meta-model 예측을 비교하고,
deflated Sharpe, Brier score, ECE, log loss 등을 계산합니다.

Usage:
  python scripts/compute-validation-metrics.py
  python scripts/compute-validation-metrics.py --model-version meta-v1-20260410
"""

import argparse
import sys
from datetime import datetime

import numpy as np

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("pip install psycopg2-binary")
    sys.exit(1)

PG_CONFIG = {
    "host": "192.168.0.76",
    "port": 5433,
    "dbname": "lattice",
    "user": "postgres",
    "password": "lattice1234",
}


def brier_score(probs, labels):
    return float(np.mean((probs - labels) ** 2))


def expected_calibration_error(probs, labels, n_bins=10):
    bins = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    for i in range(n_bins):
        mask = (probs >= bins[i]) & (probs < bins[i + 1])
        if mask.sum() == 0:
            continue
        avg_conf = probs[mask].mean()
        avg_acc = labels[mask].mean()
        ece += mask.sum() / len(probs) * abs(avg_acc - avg_conf)
    return float(ece)


def log_loss(probs, labels, eps=1e-7):
    probs = np.clip(probs, eps, 1 - eps)
    return float(-np.mean(labels * np.log(probs) + (1 - labels) * np.log(1 - probs)))


def deflated_sharpe_ratio(returns, n_trials):
    """Bailey & Lopez de Prado (2014)"""
    if len(returns) < 5 or np.std(returns) == 0:
        return 0.0
    try:
        from scipy import stats
    except ImportError:
        return np.mean(returns) / np.std(returns) * np.sqrt(26)  # raw annualized

    sr = np.mean(returns) / np.std(returns) * np.sqrt(26)
    skew = stats.skew(returns)
    kurt = stats.kurtosis(returns)
    e_max_sr = np.sqrt(2 * np.log(max(n_trials, 2)))
    denom = np.sqrt(1 - skew * sr + (kurt - 1) / 4 * sr ** 2)
    if denom <= 0:
        return 0.0
    psr = stats.norm.cdf((sr - e_max_sr) * np.sqrt(len(returns) - 1) / denom)
    return float(psr)


def information_ratio(returns, benchmark_returns=None):
    """Turnover-adjusted information ratio"""
    if benchmark_returns is not None:
        excess = returns - benchmark_returns
    else:
        excess = returns
    if len(excess) < 2 or np.std(excess) == 0:
        return 0.0
    return float(np.mean(excess) / np.std(excess) * np.sqrt(26))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-version", default=None)
    args = parser.parse_args()

    conn = psycopg2.connect(**PG_CONFIG)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    print("compute-validation-metrics")

    # ---------------------------------------------------------------------------
    # 1. 기존 시스템 평가 (legacy conviction → hit rate)
    # ---------------------------------------------------------------------------
    print("\n▶ 1. Legacy conviction 기반 검증...")

    cur.execute("""
        SELECT
            ef.legacy_conviction,
            AVG(CASE WHEN lo.abnormal_return > 0 THEN 1.0 ELSE 0.0 END) as alpha_hit,
            AVG(lo.abnormal_return) as avg_alpha,
            COUNT(*) as n
        FROM event_features ef
        JOIN article_event_map aem ON aem.canonical_event_id = ef.canonical_event_id
        JOIN labeled_outcomes lo ON lo.article_id = aem.article_id
        WHERE lo.abnormal_return IS NOT NULL AND lo.horizon = '2w'
          AND ef.legacy_conviction IS NOT NULL
        GROUP BY ef.legacy_conviction
        ORDER BY ef.legacy_conviction
    """)
    legacy = cur.fetchall()
    if legacy:
        print("Conviction | Alpha Hit | Avg Alpha | N")
        for r in legacy:
            print(f"  {r['legacy_conviction']:>5}     | {r['alpha_hit']*100:.1f}%     | {float(r['avg_alpha']):+.3f}%   | {r['n']}")

    # ---------------------------------------------------------------------------
    # 2. Meta-model 평가 (model_predictions 있으면)
    # ---------------------------------------------------------------------------
    if args.model_version:
        print(f"\n▶ 2. Meta-model ({args.model_version}) 검증...")

        cur.execute("""
            SELECT mp.alpha_prob, mp.expected_alpha, mp.downside_risk,
                   lo.abnormal_return,
                   CASE WHEN lo.abnormal_return > 0 THEN 1.0 ELSE 0.0 END as label
            FROM model_predictions mp
            JOIN article_event_map aem ON aem.canonical_event_id = mp.canonical_event_id
            JOIN labeled_outcomes lo ON lo.article_id = aem.article_id
              AND lo.symbol = mp.symbol AND lo.horizon = mp.horizon
            WHERE mp.model_version = %s
              AND lo.abnormal_return IS NOT NULL
        """, (args.model_version,))

        rows = cur.fetchall()
        if rows:
            probs = np.array([float(r["alpha_prob"]) for r in rows])
            labels = np.array([float(r["label"]) for r in rows])
            alphas = np.array([float(r["abnormal_return"]) for r in rows])

            print(f"  Samples: {len(rows)}")
            print(f"  Brier Score: {brier_score(probs, labels):.4f}")
            print(f"  ECE: {expected_calibration_error(probs, labels):.4f}")
            print(f"  Log Loss: {log_loss(probs, labels):.4f}")
            print(f"  Top-20 Precision: {labels[probs.argsort()[-20:]].mean():.4f}")

            # Deflated Sharpe
            n_trials = len(set(zip([r["alpha_prob"] for r in rows])))
            print(f"  Deflated Sharpe (PSR): {deflated_sharpe_ratio(alphas, n_trials):.4f}")
            print(f"  Information Ratio: {information_ratio(alphas):.4f}")
        else:
            print("  No predictions found for this model version")

    # ---------------------------------------------------------------------------
    # 3. Evidence grade 분포
    # ---------------------------------------------------------------------------
    print("\n▶ 3. Evidence grade 분포...")
    cur.execute("""
        SELECT evidence_grade, COUNT(*) as cnt,
               ROUND(AVG(uplift)::numeric, 3) as avg_uplift,
               ROUND(AVG(t_stat)::numeric, 2) as avg_t
        FROM event_uplift
        GROUP BY evidence_grade ORDER BY evidence_grade
    """)
    grades = cur.fetchall()
    if grades:
        for r in grades:
            print(f"  {r['evidence_grade']}: {r['cnt']} events, avg uplift={r['avg_uplift']}%, t={r['avg_t']}")
    else:
        print("  No uplift data yet (run build-matched-controls.mjs first)")

    print("\n✅ Validation complete")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
