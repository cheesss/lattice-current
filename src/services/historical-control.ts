import type {
  HistoricalBackfillOptions,
  HistoricalBackfillResult,
  HistoricalDatasetSummary,
} from './importer/historical-stream-worker';
import type { IntelligencePostgresConfig, IntelligencePostgresStatus } from './server/intelligence-postgres';
import type {
  HistoricalReplayOptions,
  HistoricalReplayRun,
  WalkForwardBacktestOptions,
} from './historical-intelligence';
import { measureResourceOperation } from './resource-telemetry';

function importEndpoint(): string {
  return '/api/local-intelligence-import';
}

function replayEndpoint(): string {
  return '/api/local-intelligence-replay';
}

function walkForwardEndpoint(): string {
  return '/api/local-intelligence-walk-forward';
}

function postgresEndpoint(): string {
  return '/api/local-intelligence-postgres';
}

export interface HistoricalImportRemoteResult {
  result: HistoricalBackfillResult | null;
  postgresSyncResult?: unknown;
}

export interface HistoricalReplayRemoteResult {
  run: HistoricalReplayRun | null;
  postgresSyncResult?: unknown;
}

async function safeJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function listHistoricalDatasetsRemote(dbPath?: string): Promise<HistoricalDatasetSummary[]> {
  try {
    const query = dbPath ? `?dbPath=${encodeURIComponent(dbPath)}` : '';
    const response = await fetch(`${importEndpoint()}${query}`);
    if (!response.ok) return [];
    const payload = await safeJson<{ datasets?: HistoricalDatasetSummary[] }>(response);
    return Array.isArray(payload?.datasets) ? payload.datasets : [];
  } catch {
    return [];
  }
}

export async function importHistoricalDatasetRemote(
  filePath: string,
  options: HistoricalBackfillOptions = {},
  syncOptions: {
    postgresSync?: boolean;
    pgConfig?: IntelligencePostgresConfig | null;
    postgresPageSize?: number;
  } = {},
): Promise<HistoricalImportRemoteResult> {
  try {
    return await measureResourceOperation(
      'api:historical-import',
      {
        label: 'Historical dataset import',
        kind: 'api',
        feature: 'historical-import',
        sampleStorage: true,
      },
      async () => {
        const response = await fetch(importEndpoint(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            filePath,
            options,
            postgresSync: syncOptions.postgresSync,
            pgConfig: syncOptions.pgConfig,
            postgresPageSize: syncOptions.postgresPageSize,
          }),
        });
        if (!response.ok) return { result: null };
        const payload = await safeJson<{
          result?: HistoricalBackfillResult;
          postgresSyncResult?: unknown;
        }>(response);
        return {
          result: payload?.result || null,
          postgresSyncResult: payload?.postgresSyncResult,
        };
      },
      (result) => ({
        outputCount: result.result?.frameCount ?? result.result?.rawRecordCount ?? 0,
        sampleStorage: true,
      }),
    );
  } catch {
    return { result: null };
  }
}

export async function runHistoricalReplayRemote(
  datasetId: string,
  options: HistoricalReplayOptions = {},
  frameLoadOptions: Record<string, unknown> = {},
  syncOptions: {
    postgresSync?: boolean;
    pgConfig?: IntelligencePostgresConfig | null;
  } = {},
): Promise<HistoricalReplayRemoteResult> {
  try {
    return await measureResourceOperation(
      'api:historical-replay',
      {
        label: 'Historical replay request',
        kind: 'api',
        feature: 'historical-replay',
        sampleStorage: true,
      },
      async () => {
        const response = await fetch(replayEndpoint(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            frameLoadOptions: {
              datasetId,
              includeWarmup: true,
              ...frameLoadOptions,
            },
            options,
            postgresSync: syncOptions.postgresSync,
            pgConfig: syncOptions.pgConfig,
          }),
        });
        if (!response.ok) return { run: null };
        const payload = await safeJson<{
          run?: HistoricalReplayRun;
          postgresSyncResult?: unknown;
        }>(response);
        return {
          run: payload?.run || null,
          postgresSyncResult: payload?.postgresSyncResult,
        };
      },
      (result) => ({
        outputCount: result.run?.ideaRuns.length ?? 0,
        sampleStorage: true,
      }),
    );
  } catch {
    return { run: null };
  }
}

export async function runWalkForwardRemote(
  datasetId: string,
  options: WalkForwardBacktestOptions = {},
  frameLoadOptions: Record<string, unknown> = {},
  syncOptions: {
    postgresSync?: boolean;
    pgConfig?: IntelligencePostgresConfig | null;
  } = {},
): Promise<HistoricalReplayRemoteResult> {
  try {
    return await measureResourceOperation(
      'api:walk-forward',
      {
        label: 'Walk-forward request',
        kind: 'api',
        feature: 'walk-forward',
        sampleStorage: true,
      },
      async () => {
        const response = await fetch(walkForwardEndpoint(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            frameLoadOptions: {
              datasetId,
              includeWarmup: true,
              ...frameLoadOptions,
            },
            options,
            postgresSync: syncOptions.postgresSync,
            pgConfig: syncOptions.pgConfig,
          }),
        });
        if (!response.ok) return { run: null };
        const payload = await safeJson<{
          run?: HistoricalReplayRun;
          postgresSyncResult?: unknown;
        }>(response);
        return {
          run: payload?.run || null,
          postgresSyncResult: payload?.postgresSyncResult,
        };
      },
      (result) => ({
        outputCount: result.run?.ideaRuns.length ?? 0,
        sampleStorage: true,
      }),
    );
  } catch {
    return { run: null };
  }
}

export async function testHistoricalPostgresRemote(
  config: IntelligencePostgresConfig,
): Promise<IntelligencePostgresStatus | null> {
  try {
    const response = await fetch(postgresEndpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'status',
        config,
      }),
    });
    if (!response.ok) return null;
    const payload = await safeJson<{ result?: IntelligencePostgresStatus }>(response);
    return payload?.result || null;
  } catch {
    return null;
  }
}
