#!/usr/bin/env python3
"""
event_engine_full_build.py - Python 전환: regime/hawkes/whatif/anomaly 계산

JS 버전(event-engine-full-build.mjs) 대비:
  - numpy로 Hawkes decay 벡터화 계산
  - pandas로 what-if PnL 배치 계산
  - scipy.stats로 Sharpe/VaR 계산
  - 전체 SQL은 동일 (계산 로직만 Python)

Usage:
  python scripts/event_engine_full_build.py
  python scripts/event_engine_full_build.py --dry-run
"""

import argparse
import math
import sys
import os
import time
from datetime import date as date_type

import numpy as np

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("pip install psycopg2-binary"); sys.exit(1)



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

REGIME_CASE_SQL = """
CASE
  WHEN vix.price > 25 AND hy.value > (
    SELECT AVG(sh2.value) + 1.5 * COALESCE(NULLIF(STDDEV(sh2.value), 0), 1)
    FROM signal_history sh2
    WHERE sh2.signal_name = 'hy_credit_spread'
      AND sh2.ts BETWEEN anchor_ts - INTERVAL '90 days' AND anchor_ts
  ) THEN 'crisis'
  WHEN vix.price > 25 THEN 'risk-off'
  WHEN vix.price < 18 AND hy.value < (
    SELECT AVG(sh3.value) - 0.5 * COALESCE(NULLIF(STDDEV(sh3.value), 0), 1)
    FROM signal_history sh3
    WHERE sh3.signal_name = 'hy_credit_spread'
      AND sh3.ts BETWEEN anchor_ts - INTERVAL '90 days' AND anchor_ts
  ) THEN 'risk-on-strong'
  WHEN vix.price < 18 THEN 'risk-on'
  ELSE 'balanced'
END
"""


def hawkes_decay_per_day(half_life_days=7):
    return math.log(2) / half_life_days


def compute_sharpe(pnls, annualization=52):
    if len(pnls) < 2:
        return 0.0
    arr = np.array(pnls, dtype=np.float64)
    mean = arr.mean()
    std = arr.std()
    if std < 0.001:
        return 0.0
    return float(mean / std * np.sqrt(annualization))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    t0 = time.time()
    print(f"event_engine_full_build.py - dry_run={args.dry_run}")

    conn = psycopg2.connect(**PG_CONFIG)
    cur = conn.cursor()

    # =====================================================================
    # 1. Regime Conditional Impact
    # =====================================================================
    print("\n>> 1. Regime conditional impact...")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS regime_conditional_impact (
            id SERIAL PRIMARY KEY, theme TEXT, symbol TEXT, horizon TEXT DEFAULT '2w',
            regime TEXT, avg_return DOUBLE PRECISION, hit_rate DOUBLE PRECISION,
            avg_abs_return DOUBLE PRECISION, sample_size INT,
            regime_multiplier DOUBLE PRECISION DEFAULT 1.0,
            anomaly_rate DOUBLE PRECISION DEFAULT 0,
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(theme, symbol, horizon, regime)
        )
    """)

    if not args.dry_run:
        regime_sql = REGIME_CASE_SQL.replace("anchor_ts", "a.published_at")
        cur.execute(f"""
            INSERT INTO regime_conditional_impact (theme, symbol, horizon, regime, avg_return, hit_rate, avg_abs_return, sample_size, regime_multiplier)
            SELECT lo.theme, lo.symbol, lo.horizon,
              {regime_sql} AS regime,
              AVG(COALESCE(lo.abnormal_return, lo.forward_return_pct)::numeric),
              AVG(CASE WHEN COALESCE(lo.abnormal_return, lo.forward_return_pct) > 0 THEN 1.0 ELSE 0.0 END::numeric),
              AVG(ABS(COALESCE(lo.abnormal_return, lo.forward_return_pct))::numeric),
              COUNT(*)::int,
              CASE WHEN overall.avg_abs > 0.01
                THEN AVG(ABS(COALESCE(lo.abnormal_return, lo.forward_return_pct))::numeric) / overall.avg_abs
                ELSE 1.0 END
            FROM labeled_outcomes lo
            JOIN articles a ON a.id = lo.article_id
            LEFT JOIN worldmonitor_intel.historical_raw_items vix
              ON vix.provider = 'yahoo-chart' AND vix.symbol = '^VIX'
              AND DATE(vix.valid_time_start) = DATE(a.published_at)
            LEFT JOIN signal_history hy
              ON hy.signal_name = 'hy_credit_spread' AND DATE(hy.ts) = DATE(a.published_at)
            CROSS JOIN LATERAL (
              SELECT AVG(ABS(COALESCE(lo2.abnormal_return, lo2.forward_return_pct))::numeric) AS avg_abs
              FROM labeled_outcomes lo2
              WHERE lo2.symbol = lo.symbol AND lo2.horizon = lo.horizon
            ) overall
            GROUP BY lo.theme, lo.symbol, lo.horizon,
              {regime_sql}, overall.avg_abs
            HAVING COUNT(*) >= 30
            ON CONFLICT (theme, symbol, horizon, regime) DO UPDATE SET
              avg_return = EXCLUDED.avg_return, hit_rate = EXCLUDED.hit_rate,
              avg_abs_return = EXCLUDED.avg_abs_return, sample_size = EXCLUDED.sample_size,
              regime_multiplier = EXCLUDED.regime_multiplier, updated_at = NOW()
        """)
        conn.commit()
        print(f"  {cur.rowcount} rows upserted")

    # =====================================================================
    # 2. Hawkes Intensity (vectorized with numpy)
    # =====================================================================
    print("\n>> 2. Hawkes intensity (numpy vectorized)...")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS event_hawkes_intensity (
            id SERIAL PRIMARY KEY, theme TEXT, event_date DATE,
            article_count INT, hawkes_intensity DOUBLE PRECISION,
            normalized_temperature DOUBLE PRECISION, is_surge BOOLEAN DEFAULT FALSE,
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(theme, event_date)
        )
    """)

    if not args.dry_run:
        # Get daily article counts per theme
        cur.execute("""
            SELECT theme, DATE(published_at) as d, COUNT(*) as n
            FROM articles
            WHERE theme IS NOT NULL AND theme != 'unknown'
            GROUP BY theme, DATE(published_at)
            ORDER BY theme, d
        """)
        rows = cur.fetchall()

        decay = hawkes_decay_per_day(7)
        theme_data = {}
        for theme, d, n in rows:
            if theme not in theme_data:
                theme_data[theme] = []
            theme_data[theme].append((d, n))

        insert_count = 0
        for theme, data in theme_data.items():
            dates = [d for d, _ in data]
            counts = np.array([n for _, n in data], dtype=np.float64)

            # Vectorized Hawkes: exponential decay accumulation
            intensities = np.zeros(len(counts))
            for i in range(len(counts)):
                if i == 0:
                    intensities[i] = counts[i]
                else:
                    days_diff = (dates[i] - dates[i - 1]).days
                    intensities[i] = intensities[i - 1] * np.exp(-decay * days_diff) + counts[i]

            # Normalized temperature (0~1)
            max_intensity = intensities.max() if len(intensities) > 0 else 1
            normalized = 1 - np.exp(-intensities / (max_intensity * 0.3 + 1))

            # Surge detection: intensity > mean + 2*std
            mean_i = intensities.mean()
            std_i = intensities.std()
            surges = intensities > (mean_i + 2 * std_i)

            batch = [(theme, dates[i], int(counts[i]), float(intensities[i]),
                       float(normalized[i]), bool(surges[i]))
                      for i in range(len(dates))]

            psycopg2.extras.execute_batch(cur, """
                INSERT INTO event_hawkes_intensity (theme, event_date, article_count, hawkes_intensity, normalized_temperature, is_surge)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (theme, event_date) DO UPDATE SET
                  hawkes_intensity = EXCLUDED.hawkes_intensity,
                  normalized_temperature = EXCLUDED.normalized_temperature,
                  is_surge = EXCLUDED.is_surge, updated_at = NOW()
            """, batch, page_size=500)
            insert_count += len(batch)

        conn.commit()
        print(f"  {insert_count} rows upserted across {len(theme_data)} themes")

    # =====================================================================
    # 3. What-If Simulations (numpy Sharpe/VaR)
    # =====================================================================
    print("\n>> 3. What-if simulations (numpy)...")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS whatif_simulations (
            id SERIAL PRIMARY KEY, theme TEXT, symbol TEXT, direction TEXT DEFAULT 'long',
            position_pct DOUBLE PRECISION DEFAULT 10, horizon TEXT DEFAULT '2w',
            regime TEXT DEFAULT 'all',
            simulated_trades INT, avg_pnl_pct DOUBLE PRECISION,
            hit_rate DOUBLE PRECISION, max_drawdown_pct DOUBLE PRECISION,
            sharpe_ratio DOUBLE PRECISION, var_95_pct DOUBLE PRECISION,
            total_return_pct DOUBLE PRECISION,
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(theme, symbol, direction, horizon, regime)
        )
    """)

    if not args.dry_run:
        # Get all (theme, symbol, horizon) with enough data
        cur.execute("""
            SELECT theme, symbol, horizon,
                   array_agg(COALESCE(abnormal_return, forward_return_pct) ORDER BY published_at) as returns
            FROM labeled_outcomes
            WHERE forward_return_pct IS NOT NULL
            GROUP BY theme, symbol, horizon
            HAVING COUNT(*) >= 20
        """)
        combos = cur.fetchall()

        sim_count = 0
        for theme, symbol, horizon, returns_list in combos:
            returns = np.array([float(r) for r in returns_list if r is not None], dtype=np.float64)
            if len(returns) < 20:
                continue

            for direction in ["long", "short"]:
                pnls = returns if direction == "long" else -returns
                n = len(pnls)
                mean_pnl = float(pnls.mean())
                hit_rate = float((pnls > 0).mean())
                total_return = float(pnls.sum())
                sharpe = compute_sharpe(pnls.tolist())

                # Max drawdown
                cumulative = np.cumsum(pnls)
                peak = np.maximum.accumulate(cumulative)
                drawdowns = peak - cumulative
                max_dd = float(drawdowns.max()) if len(drawdowns) > 0 else 0

                # VaR 95%
                var_95 = float(np.percentile(pnls, 5))

                cur.execute("""
                    INSERT INTO whatif_simulations (theme, symbol, direction, horizon, regime,
                      simulated_trades, avg_pnl_pct, hit_rate, max_drawdown_pct,
                      sharpe_ratio, var_95_pct, total_return_pct)
                    VALUES (%s,%s,%s,%s,'all',%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (theme, symbol, direction, horizon, regime) DO UPDATE SET
                      simulated_trades=EXCLUDED.simulated_trades, avg_pnl_pct=EXCLUDED.avg_pnl_pct,
                      hit_rate=EXCLUDED.hit_rate, max_drawdown_pct=EXCLUDED.max_drawdown_pct,
                      sharpe_ratio=EXCLUDED.sharpe_ratio, var_95_pct=EXCLUDED.var_95_pct,
                      total_return_pct=EXCLUDED.total_return_pct, updated_at=NOW()
                """, (theme, symbol, direction, horizon, n, mean_pnl, hit_rate,
                      max_dd, sharpe, var_95, total_return))
                sim_count += 1

        conn.commit()
        print(f"  {sim_count} simulations computed")

    # =====================================================================
    # 4. Event Anomalies (z-score)
    # =====================================================================
    print("\n>> 4. Event anomalies (numpy z-score)...")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS event_anomalies (
            id SERIAL PRIMARY KEY, article_id INT, event_date TIMESTAMPTZ,
            title TEXT, theme TEXT, symbol TEXT, horizon TEXT,
            forward_return_pct DOUBLE PRECISION, expected_return DOUBLE PRECISION,
            z_score DOUBLE PRECISION, anomaly_type TEXT, explanation TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)

    if not args.dry_run:
        cur.execute("""
            SELECT theme, symbol, horizon,
                   AVG(COALESCE(abnormal_return, forward_return_pct)::numeric) as mean_ret,
                   STDDEV(COALESCE(abnormal_return, forward_return_pct)::numeric) as std_ret
            FROM labeled_outcomes
            GROUP BY theme, symbol, horizon
            HAVING COUNT(*) >= 30 AND STDDEV(forward_return_pct::numeric) > 0.01
        """)
        baselines = {(r[0], r[1], r[2]): (float(r[3]), float(r[4])) for r in cur.fetchall()}

        # Find anomalies in recent data
        cur.execute("""
            SELECT lo.article_id, a.published_at, a.title, lo.theme, lo.symbol, lo.horizon,
                   COALESCE(lo.abnormal_return, lo.forward_return_pct) as ret
            FROM labeled_outcomes lo
            JOIN articles a ON a.id = lo.article_id
            WHERE lo.forward_return_pct IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM event_anomalies ea WHERE ea.article_id = lo.article_id AND ea.symbol = lo.symbol AND ea.horizon = lo.horizon)
            ORDER BY a.published_at DESC
            LIMIT 50000
        """)
        candidates = cur.fetchall()

        anomaly_count = 0
        for art_id, pub_at, title, theme, symbol, horizon, ret in candidates:
            if ret is None:
                continue
            key = (theme, symbol, horizon)
            if key not in baselines:
                continue
            mean_r, std_r = baselines[key]
            if std_r < 0.01:
                continue
            z = (float(ret) - mean_r) / std_r
            if abs(z) < 2:
                continue
            anomaly_type = "extreme_positive" if z > 0 else "extreme_negative"
            cur.execute("""
                INSERT INTO event_anomalies (article_id, event_date, title, theme, symbol, horizon,
                  forward_return_pct, expected_return, z_score, anomaly_type)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (art_id, pub_at, title, theme, symbol, horizon, float(ret), mean_r, z, anomaly_type))
            anomaly_count += 1

        conn.commit()
        print(f"  {anomaly_count} anomalies detected")

    # =====================================================================
    # 5. Anomaly-Regime Feedback
    # =====================================================================
    print("\n>> 5. Anomaly-regime feedback...")
    if not args.dry_run:
        cur.execute("""
            UPDATE regime_conditional_impact rci
            SET anomaly_rate = LEAST(1, sub.anomaly_count / NULLIF(rci.sample_size, 0)::float)
            FROM (
                SELECT ea.theme, ea.symbol, COUNT(*)::float as anomaly_count
                FROM event_anomalies ea
                GROUP BY ea.theme, ea.symbol
            ) sub
            WHERE rci.theme = sub.theme AND rci.symbol = sub.symbol
              AND rci.sample_size > 0
        """)
        conn.commit()
        print(f"  {cur.rowcount} rows updated with anomaly feedback")

    elapsed = round(time.time() - t0, 1)
    cur.close()
    conn.close()
    print(f"\n== Event engine complete ({elapsed}s) ==")


if __name__ == "__main__":
    main()
