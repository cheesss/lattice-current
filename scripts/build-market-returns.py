#!/usr/bin/env python3
"""
build-market-returns.py — Build independent market_returns table from labeled_outcomes + Yahoo Finance.

Solves the coverage gap: current abnormal_return only computes for articles that also
have SPY in labeled_outcomes (same article_id). This script builds a date-based table
so ALL labeled_outcomes can get abnormal_return via date join.

Usage:
    python scripts/build-market-returns.py
    python scripts/build-market-returns.py --dry-run
"""

import os
import sys
import psycopg2
import psycopg2.extras

DRY_RUN = "--dry-run" in sys.argv

PG = {
    "host": os.environ.get("PG_HOST", "192.168.0.2"),
    "port": int(os.environ.get("PG_PORT", 5433)),
    "user": os.environ.get("PG_USER", "postgres"),
    "password": os.environ.get("PG_PASSWORD", os.environ.get("PGPASSWORD", "lattice1234")),
    "dbname": os.environ.get("PG_DATABASE", "lattice"),
}

SECTOR_ETF_MAP = {
    "XLK": ["AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CRM", "AMD", "ADBE", "CSCO", "ACN", "IBM", "INTC", "QCOM", "TXN", "AMAT"],
    "SMH": ["NVDA", "AMD", "INTC", "QCOM", "TXN", "AMAT", "LRCX", "MU", "MRVL", "KLAC", "TSM", "ASML"],
    "XLE": ["XOM", "CVX", "COP", "SLB", "EOG", "MPC", "PSX", "VLO", "OXY", "HES", "HAL", "DVN", "FANG"],
    "XLF": ["JPM", "BAC", "WFC", "GS", "MS", "BLK", "C", "SCHW", "AXP", "USB", "PNC", "TFC"],
    "XLV": ["UNH", "JNJ", "LLY", "PFE", "ABBV", "MRK", "TMO", "ABT", "DHR", "BMY", "AMGN", "GILD"],
    "XLY": ["AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "TJX", "BKNG", "CMG"],
    "XLP": ["PG", "KO", "PEP", "COST", "WMT", "PM", "MDLZ", "MO", "CL", "GIS"],
    "XLI": ["GE", "CAT", "HON", "UNP", "BA", "RTX", "DE", "LMT", "MMM", "UPS", "FDX"],
    "XLU": ["NEE", "SO", "DUK", "D", "SRE", "AEP", "EXC", "ED", "WEC", "ES"],
    "XLRE": ["PLD", "AMT", "CCI", "EQIX", "SPG", "O", "PSA", "DLR", "WELL", "AVB"],
    "XLC": ["META", "GOOGL", "GOOG", "NFLX", "DIS", "CMCSA", "CHTR", "TMUS", "VZ", "T"],
    "XLB": ["LIN", "APD", "SHW", "FCX", "ECL", "NEM", "NUE", "VMC", "MLM", "DOW"],
    "GLD": ["GLD", "IAU"],
    "DBC": ["DBC", "USO", "UNG"],
}

# Invert: symbol -> sector ETF
SYMBOL_TO_SECTOR = {}
for etf, symbols in SECTOR_ETF_MAP.items():
    for sym in symbols:
        SYMBOL_TO_SECTOR[sym] = etf


def main():
    conn = psycopg2.connect(**PG)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    print(">> Building market_returns table")

    # Create table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS market_returns (
            trade_date DATE NOT NULL,
            symbol TEXT NOT NULL DEFAULT 'SPY',
            horizon TEXT NOT NULL,
            forward_return_pct DOUBLE PRECISION,
            PRIMARY KEY (trade_date, symbol, horizon)
        )
    """)
    conn.commit()

    if DRY_RUN:
        print("  [dry-run] Would build market_returns from labeled_outcomes")
        cur.close()
        conn.close()
        return

    # Step 1: Extract SPY returns from labeled_outcomes (date-based)
    cur.execute("""
        INSERT INTO market_returns (trade_date, symbol, horizon, forward_return_pct)
        SELECT DISTINCT ON (DATE(a.published_at), lo.horizon)
            DATE(a.published_at), 'SPY', lo.horizon, lo.forward_return_pct
        FROM labeled_outcomes lo
        JOIN articles a ON a.id = lo.article_id
        WHERE lo.symbol = 'SPY' AND lo.forward_return_pct IS NOT NULL
        ORDER BY DATE(a.published_at), lo.horizon, a.published_at DESC
        ON CONFLICT (trade_date, symbol, horizon) DO UPDATE
            SET forward_return_pct = EXCLUDED.forward_return_pct
    """)
    spy_count = cur.rowcount
    print(f"  SPY daily returns: {spy_count} rows")

    # Step 2: Extract sector ETF returns
    sector_etfs = list(SECTOR_ETF_MAP.keys())
    cur.execute("""
        INSERT INTO market_returns (trade_date, symbol, horizon, forward_return_pct)
        SELECT DISTINCT ON (DATE(a.published_at), lo.symbol, lo.horizon)
            DATE(a.published_at), lo.symbol, lo.horizon, lo.forward_return_pct
        FROM labeled_outcomes lo
        JOIN articles a ON a.id = lo.article_id
        WHERE lo.symbol = ANY(%s) AND lo.forward_return_pct IS NOT NULL
        ORDER BY DATE(a.published_at), lo.symbol, lo.horizon, a.published_at DESC
        ON CONFLICT (trade_date, symbol, horizon) DO UPDATE
            SET forward_return_pct = EXCLUDED.forward_return_pct
    """, (sector_etfs,))
    sector_count = cur.rowcount
    print(f"  Sector ETF returns: {sector_count} rows")

    conn.commit()

    # Step 3: Update abnormal_return using date-based join (covers previously NULL rows)
    # NOTE: PostgreSQL UPDATE...FROM cannot reference the target table's alias inside
    # the FROM/JOIN ON clauses. Move alias-dependent predicates to WHERE.
    cur.execute("""
        UPDATE labeled_outcomes lo
        SET market_return = mr.forward_return_pct,
            abnormal_return = lo.forward_return_pct - mr.forward_return_pct
        FROM articles a
        JOIN market_returns mr ON mr.trade_date = DATE(a.published_at)
            AND mr.symbol = 'SPY'
        WHERE a.id = lo.article_id
            AND mr.horizon = lo.horizon
            AND lo.symbol != 'SPY'
            AND lo.forward_return_pct IS NOT NULL
            AND lo.abnormal_return IS NULL
    """)
    updated = cur.rowcount
    print(f"  abnormal_return updated (date-based): {updated} rows")

    # Step 4: Update sector_return where possible
    sector_cases = []
    for sym, etf in SYMBOL_TO_SECTOR.items():
        sector_cases.append(f"WHEN '{sym}' THEN '{etf}'")
    sector_case_sql = "CASE lo.symbol " + " ".join(sector_cases) + " ELSE NULL END"

    cur.execute(f"""
        UPDATE labeled_outcomes lo
        SET sector_return = mr.forward_return_pct
        FROM articles a
        JOIN market_returns mr ON mr.trade_date = DATE(a.published_at)
        WHERE a.id = lo.article_id
            AND mr.symbol = ({sector_case_sql})
            AND mr.horizon = lo.horizon
            AND lo.sector_return IS NULL
            AND lo.forward_return_pct IS NOT NULL
    """)
    sector_updated = cur.rowcount
    print(f"  sector_return updated: {sector_updated} rows")

    conn.commit()

    # Summary
    cur.execute("SELECT COUNT(*) AS total, COUNT(abnormal_return) AS with_ar FROM labeled_outcomes WHERE forward_return_pct IS NOT NULL")
    stats = cur.fetchone()
    pct = round(stats["with_ar"] / max(stats["total"], 1) * 100, 1)
    print(f"\n  Coverage: {stats['with_ar']}/{stats['total']} ({pct}%) have abnormal_return")

    cur.close()
    conn.close()
    print("  Done.")


if __name__ == "__main__":
    main()
