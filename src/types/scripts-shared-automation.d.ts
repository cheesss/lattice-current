declare module '*backfill-whitelist.mjs' {
  export interface BackfillArgRule {
    type: 'date' | 'int' | 'array' | 'string';
    required?: boolean;
    min?: number;
    max?: number;
    default?: unknown;
    maxLength?: number;
    minLength?: number;
  }

  export interface AllowedBackfillSourceConfig {
    script: string;
    description: string;
    args: Record<string, BackfillArgRule>;
    minIntervalHours: number;
    requiresApproval: boolean;
    estimatedDurationHours: number;
  }

  export const ALLOWED_BACKFILL_SOURCES: Record<string, AllowedBackfillSourceConfig>;
  export function validateBackfillArgs(
    source: string,
    args?: Record<string, unknown>,
  ): { ok: true; value: Record<string, unknown>; config: AllowedBackfillSourceConfig } | { ok: false; error: string };
}

declare module '*nas-runtime.mjs' {
  export function loadOptionalEnvFile(): void;
  export function resolveNasPgConfig(): {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: boolean | object;
  };
}

declare module '*schema-automation.mjs' {
  export function ensureAutomationSchema(queryable: { query: (sql: string, values?: unknown[]) => Promise<unknown> }): Promise<void>;
}

declare module '*automation-budget.mjs' {
  export function checkBudget(
    client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
    action: string,
    amount?: number,
  ): Promise<{ allowed: boolean; remaining: number; reason?: string }>;
  export function consumeBudget(
    client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
    action: string,
    amount?: number,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
}
