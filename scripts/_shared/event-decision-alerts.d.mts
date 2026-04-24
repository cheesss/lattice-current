import type { Pool } from 'pg';

export type EventDecisionAlertCandidate = {
  canonicalEventId: number;
  symbol: string;
  horizon: string;
  evidenceGrade: 'E3' | 'E4' | string;
  uplift: number | null;
  tStat: number | null;
  nControls: number | null;
  theme: string | null;
  title: string | null;
  eventDate: string | null;
};

export type EventDecisionAlertOptions = {
  sinceHours?: number;
  tThreshold?: number;
  limit?: number;
  dryRun?: boolean;
  grades?: string[];
};

export type EventDecisionAlertResult = {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
  totalCandidates: number;
  emittedCount?: number;
  toEmit?: Array<EventDecisionAlertCandidate & { dedupeKey: string }>;
};

export function queryHighUpliftCandidates(
  pool: Pool,
  options?: EventDecisionAlertOptions,
): Promise<EventDecisionAlertCandidate[]>;

export function emitEventDecisionAlerts(
  poolOrOptions?: Pool | EventDecisionAlertOptions,
  maybeOptions?: EventDecisionAlertOptions,
): Promise<EventDecisionAlertResult>;

export const _internals: {
  dedupeKey: (c: Pick<EventDecisionAlertCandidate, 'canonicalEventId' | 'symbol' | 'horizon' | 'evidenceGrade'>) => string;
  DEFAULT_SINCE_HOURS: number;
  DEFAULT_T_THRESHOLD: number;
  DEFAULT_MAX_ALERTS: number;
  STATE_PATH: string;
};
