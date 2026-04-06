/**
 * Thin re-export layer to supply types needed by backtest-types.ts
 * without importing from historical-intelligence (which would be circular).
 */
export type { ReplayThemeProfile } from '../replay-adaptation';
export type { CoverageLedgerSnapshot } from '../coverage-ledger';
