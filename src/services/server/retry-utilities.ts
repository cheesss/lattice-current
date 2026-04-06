/**
 * Retry helpers and scheduling utilities extracted from intelligence-automation.ts.
 */

export type AutomationJobKind = 'fetch' | 'import' | 'replay' | 'walk-forward' | 'theme-discovery' | 'theme-proposer' | 'candidate-expansion' | 'source-automation' | 'keyword-lifecycle' | 'dataset-discovery' | 'self-tuning' | 'retention';

export interface AutomationRunRecord {
  id: string;
  datasetId: string | null;
  kind: AutomationJobKind;
  status: 'ok' | 'error' | 'skipped';
  startedAt: string;
  completedAt: string;
  attempts: number;
  detail: string;
}

const MAX_RUN_RECORDS = 480;

export function nowIso(): string {
  return new Date().toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clampUtil(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function averageUtil(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function medianUtil(values: number[]): number {
  if (!values.length) return 0;
  const ranked = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((left, right) => left - right);
  if (!ranked.length) return 0;
  const middle = Math.floor(ranked.length / 2);
  return ranked.length % 2 === 0
    ? (ranked[middle - 1]! + ranked[middle]!) / 2
    : ranked[middle]!;
}

export function slugify(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100) || 'automation';
}

export function asTs(value?: string | null): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

export function sameLocalDay(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const one = new Date(a);
  const two = new Date(b);
  return one.getFullYear() === two.getFullYear()
    && one.getMonth() === two.getMonth()
    && one.getDate() === two.getDate();
}

export function shouldRunEvery(lastAt: string | null | undefined, everyMinutes: number, now = Date.now()): boolean {
  if (!lastAt) return true;
  return now - asTs(lastAt) >= everyMinutes * 60_000;
}

export function shouldRunNightly(lastAt: string | null | undefined, localHour: number, now = new Date()): boolean {
  if (now.getHours() < localHour) return false;
  return !sameLocalDay(lastAt, now.toISOString());
}

export function backoffMs(consecutiveFailures: number): number {
  const bounded = Math.max(1, Math.min(6, consecutiveFailures));
  return Math.min(6 * 60 * 60 * 1000, 5 * 60 * 1000 * (2 ** (bounded - 1)));
}

export function isGdeltRateLimitMessage(message: string | null | undefined): boolean {
  return /429|too many requests/i.test(String(message || ''));
}

export function appendRun(runs: AutomationRunRecord[], run: AutomationRunRecord): AutomationRunRecord[] {
  return [...runs, run].slice(-MAX_RUN_RECORDS);
}

export async function runWithRetry<T>(
  datasetId: string,
  kind: AutomationJobKind,
  maxRetries: number,
  runner: (attempt: number) => Promise<T>,
  _runs: AutomationRunRecord[],
  appendRunFn: (run: AutomationRunRecord) => void,
): Promise<T> {
  let attempt = 0;
  let lastError: Error | null = null;
  while (attempt < maxRetries) {
    attempt += 1;
    const startedAt = nowIso();
    try {
      const result = await runner(attempt);
      appendRunFn({
        id: `${datasetId}:${kind}:${startedAt}`,
        datasetId,
        kind,
        status: 'ok',
        startedAt,
        completedAt: nowIso(),
        attempts: attempt,
        detail: `${kind} succeeded`,
      });
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      appendRunFn({
        id: `${datasetId}:${kind}:${startedAt}`,
        datasetId,
        kind,
        status: 'error',
        startedAt,
        completedAt: nowIso(),
        attempts: attempt,
        detail: lastError.message,
      });
      if (attempt >= maxRetries) break;
      await sleep(1_500 * attempt);
    }
  }
  throw lastError || new Error(`${kind} failed`);
}
