// Type-only stub for intelligence-postgres (server-side Postgres persistence)
// Full implementation lives in the sidecar/server runtime.

export interface IntelligencePostgresConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  schema?: string;
  ssl?: boolean;
}

export interface IntelligencePostgresStatus {
  connected: boolean;
  poolSize: number;
  idleCount: number;
  waitingCount: number;
  latencyMs: number;
}
