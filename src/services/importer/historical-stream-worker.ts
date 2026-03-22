// Type-only stub for historical-stream-worker (server-side DuckDB importer)
// Full implementation lives in the sidecar/server runtime.

export interface HistoricalDatasetSummary {
  datasetId: string;
  provider: string;
  sourceVersion: string | null;
  importedAt: string;
  rawRecordCount: number;
  frameCount: number;
  warmupFrameCount: number;
  bucketHours: number;
  firstValidTime: string | null;
  lastValidTime: string | null;
  firstTransactionTime: string | null;
  lastTransactionTime: string | null;
  metadata: Record<string, unknown>;
}

export interface HistoricalBackfillOptions {
  datasetId: string;
  startTime?: string;
  endTime?: string;
  parallelism?: number;
  force?: boolean;
}

export interface HistoricalBackfillResult {
  jobId: string;
  datasetId: string;
  status: 'running' | 'completed' | 'failed';
  totalFrames: number;
  processedFrames: number;
  rawRecordCount: number;
  frameCount: number;
  error?: string;
}
