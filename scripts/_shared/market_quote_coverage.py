"""Python port of market-quote-coverage.mjs. Kept field-by-field in sync.

Used by train-rates-nowcast.py, train-commodity-fx-nowcast.py, and
compute-rates-nowcast.py to abort early when Yahoo feature history is
missing.
"""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_WINDOW_DAYS = 180
DEFAULT_MIN_TRADING_DAYS = 120

COVERAGE_HINT_MESSAGE = (
    'Run: node scripts/bootstrap-market-quotes-history.mjs — fuses '
    'worldmonitor_intel warm store + Yahoo 1y fetch. Re-check after.'
)


@dataclass
class CoverageReport:
    ok: bool
    window_days: int
    min_trading_days: int
    missing: list
    row_count_by_symbol: dict


def evaluate_coverage(row_count_by_symbol: dict, required_symbols: list,
                      window_days: int = DEFAULT_WINDOW_DAYS,
                      min_trading_days: int = DEFAULT_MIN_TRADING_DAYS) -> CoverageReport:
    missing = []
    for sym in required_symbols:
        days = int(row_count_by_symbol.get(sym, 0) or 0)
        if days < min_trading_days:
            missing.append({'symbol': sym, 'days': days, 'gap': min_trading_days - days})
    return CoverageReport(
        ok=len(missing) == 0,
        window_days=window_days,
        min_trading_days=min_trading_days,
        missing=missing,
        row_count_by_symbol=row_count_by_symbol,
    )


def check_coverage(conn, required_symbols: list,
                   window_days: int = DEFAULT_WINDOW_DAYS,
                   min_trading_days: int = DEFAULT_MIN_TRADING_DAYS) -> CoverageReport:
    cur = conn.cursor()
    cur.execute("""
        SELECT symbol, COUNT(DISTINCT DATE(observed_at)) AS days
        FROM market_quotes
        WHERE symbol = ANY(%s::text[])
          AND observed_at >= NOW() - (%s || ' days')::interval
        GROUP BY symbol
    """, (list(required_symbols), str(window_days)))
    row_count_by_symbol = {}
    for symbol, days in cur.fetchall():
        row_count_by_symbol[symbol] = int(days)
    return evaluate_coverage(row_count_by_symbol, required_symbols,
                             window_days=window_days,
                             min_trading_days=min_trading_days)


def abort_if_missing(conn, required_symbols: list,
                     window_days: int = DEFAULT_WINDOW_DAYS,
                     min_trading_days: int = DEFAULT_MIN_TRADING_DAYS) -> CoverageReport:
    """Raise RuntimeError with an actionable message if coverage is insufficient.

    Returns the report on success. Callers should receive the report and
    log rowCountBySymbol for observability.
    """
    report = check_coverage(conn, required_symbols,
                            window_days=window_days,
                            min_trading_days=min_trading_days)
    if not report.ok:
        gaps = ', '.join(f"{m['symbol']}({m['days']}/{min_trading_days})" for m in report.missing)
        raise RuntimeError(
            f'market_quotes coverage insufficient for {len(report.missing)} symbol(s): '
            f'{gaps}. {COVERAGE_HINT_MESSAGE}'
        )
    return report
