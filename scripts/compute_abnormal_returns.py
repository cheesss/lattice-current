#!/usr/bin/env python3
"""Python-first abnormal return computation."""

from __future__ import annotations

import argparse
import sys

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("psycopg2-binary is required. Install dependencies from scripts/requirements-compute.txt")
    sys.exit(1)

from _python_runtime import load_optional_env_file, resolve_nas_pg_config


SECTOR_ETF_MAP = {
    "NVDA": "SMH",
    "AMD": "SMH",
    "SMH": None,
    "QQQ": None,
    "CIBR": None,
    "COP": "XLE",
    "CVX": "XLE",
    "USO": "XLE",
    "XLE": None,
    "UNG": "XLE",
    "ITA": None,
    "GLD": "DBC",
    "DBC": None,
    "TLT": None,
    "SPY": None,
    "EFA": None,
    "UUP": None,
    "XRT": "SPY",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compute abnormal returns with Python.")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def print_table(title: str, header: str, divider: str, rows: list[str]) -> None:
    print(f"\n{title}")
    print(header)
    print(divider)
    for row in rows:
        print(row)


def main() -> None:
    args = parse_args()
    load_optional_env_file()
    conn = psycopg2.connect(**resolve_nas_pg_config())

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            print(f"compute_abnormal_returns.py -> dry_run={args.dry_run}")

            print("\n[1/4] Market-adjusted returns (vs SPY)...")
            if args.dry_run:
                cur.execute(
                    """
                    SELECT COUNT(*) AS cnt
                    FROM labeled_outcomes lo
                    JOIN labeled_outcomes spy
                      ON spy.symbol = 'SPY'
                     AND spy.article_id = lo.article_id
                     AND spy.horizon = lo.horizon
                    WHERE lo.symbol != 'SPY'
                      AND lo.market_return IS NULL
                    """
                )
                market_updated = int(cur.fetchone()["cnt"])
                print(f"  [DRY RUN] Would update {market_updated} rows with market_return")
            else:
                cur.execute(
                    """
                    UPDATE labeled_outcomes lo
                    SET market_return = spy.forward_return_pct,
                        abnormal_return = lo.forward_return_pct - spy.forward_return_pct
                    FROM labeled_outcomes spy
                    WHERE spy.symbol = 'SPY'
                      AND spy.article_id = lo.article_id
                      AND spy.horizon = lo.horizon
                      AND lo.symbol != 'SPY'
                      AND lo.market_return IS NULL
                    """
                )
                market_updated = int(cur.rowcount or 0)
                print(f"  Updated {market_updated} rows with market_return")

            print("\n[2/4] Sector-adjusted returns...")
            sector_updated = 0
            for symbol, sector_etf in SECTOR_ETF_MAP.items():
                if not sector_etf:
                    continue
                if args.dry_run:
                    cur.execute(
                        """
                        SELECT COUNT(*) AS cnt
                        FROM labeled_outcomes lo
                        JOIN labeled_outcomes sector
                          ON sector.symbol = %s
                         AND sector.article_id = lo.article_id
                         AND sector.horizon = lo.horizon
                        WHERE lo.symbol = %s
                          AND lo.sector_return IS NULL
                        """,
                        (sector_etf, symbol),
                    )
                    sector_updated += int(cur.fetchone()["cnt"])
                else:
                    cur.execute(
                        """
                        UPDATE labeled_outcomes lo
                        SET sector_return = sector.forward_return_pct
                        FROM labeled_outcomes sector
                        WHERE sector.symbol = %s
                          AND sector.article_id = lo.article_id
                          AND sector.horizon = lo.horizon
                          AND lo.symbol = %s
                          AND lo.sector_return IS NULL
                        """,
                        (sector_etf, symbol),
                    )
                    sector_updated += int(cur.rowcount or 0)
            if args.dry_run:
                print(f"  [DRY RUN] Would update {sector_updated} rows with sector_return")
            else:
                print(f"  Updated {sector_updated} rows with sector_return")

            print("\n[3/4] Benchmark self-baseline for SPY...")
            if args.dry_run:
                cur.execute(
                    """
                    SELECT COUNT(*) AS cnt
                    FROM labeled_outcomes
                    WHERE symbol = 'SPY'
                      AND market_return IS NULL
                    """
                )
                spy_updated = int(cur.fetchone()["cnt"])
                print(f"  [DRY RUN] Would normalize {spy_updated} SPY rows")
            else:
                cur.execute(
                    """
                    UPDATE labeled_outcomes
                    SET market_return = forward_return_pct,
                        abnormal_return = 0
                    WHERE symbol = 'SPY'
                      AND market_return IS NULL
                    """
                )
                spy_updated = int(cur.rowcount or 0)
                print(f"  Updated {spy_updated} SPY rows")
                conn.commit()

            print("\n[4/4] Summary statistics...")
            cur.execute(
                """
                SELECT symbol,
                       COUNT(*) AS total,
                       COUNT(abnormal_return) AS with_alpha,
                       ROUND(AVG(forward_return_pct)::numeric, 3) AS avg_raw_return,
                       ROUND(AVG(abnormal_return)::numeric, 3) AS avg_alpha,
                       ROUND(AVG(CASE WHEN abnormal_return > 0 THEN 1.0 ELSE 0.0 END)::numeric, 3) AS alpha_hit_rate
                FROM labeled_outcomes
                WHERE abnormal_return IS NOT NULL
                GROUP BY symbol
                ORDER BY avg_alpha DESC
                """
            )
            stats_rows = cur.fetchall()

            print_table(
                "=== Raw Return vs Alpha ===",
                "Symbol     | Raw Return | Alpha    | Alpha Hit Rate",
                "-----------|------------|----------|---------------",
                [
                    f"{row['symbol'].ljust(10)} | {str(row['avg_raw_return']) + '%':>10} | {str(row['avg_alpha']) + '%':>8} | {float(row['alpha_hit_rate']) * 100:.1f}%"
                    for row in stats_rows
                ],
            )

            cur.execute(
                """
                SELECT lo.symbol,
                       ROUND(AVG(lo.forward_return_pct)::numeric, 3) AS raw_avg,
                       ROUND(AVG(lo.abnormal_return)::numeric, 3) AS alpha_avg,
                       ROUND(AVG(CASE WHEN lo.forward_return_pct > 0 THEN 1.0 ELSE 0.0 END)::numeric, 3) AS raw_hit,
                       ROUND(AVG(CASE WHEN lo.abnormal_return > 0 THEN 1.0 ELSE 0.0 END)::numeric, 3) AS alpha_hit
                FROM labeled_outcomes lo
                WHERE lo.abnormal_return IS NOT NULL
                  AND lo.horizon = '2w'
                GROUP BY lo.symbol
                ORDER BY ABS(AVG(lo.abnormal_return)) DESC
                LIMIT 10
                """
            )
            comparison_rows = cur.fetchall()

            print_table(
                "=== 2W Raw vs Alpha (Top 10 by |alpha|) ===",
                "Symbol     | Raw Avg  | Alpha Avg | Raw Hit | Alpha Hit",
                "-----------|----------|-----------|---------|----------",
                [
                    f"{row['symbol'].ljust(10)} | {str(row['raw_avg']) + '%':>8} | {str(row['alpha_avg']) + '%':>9} | {float(row['raw_hit']) * 100:>5.1f}% | {float(row['alpha_hit']) * 100:>5.1f}%"
                    for row in comparison_rows
                ],
            )

            print("\ncompute_abnormal_returns.py complete")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
