import { Pool, type PoolConfig } from 'pg';
import type {
  HistoricalDatasetSummary,
  HistoricalRawReplayRecord,
  HistoricalReplayFrameArchiveRow,
} from '../importer/historical-stream-worker';
import type { HistoricalReplayRun } from '../historical-intelligence';
import { createStorageEnvelope, decodeStorageValue } from '../storage/storage-envelope';
import { resolveSchemaVersion } from '../storage/schema-registry';

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

export interface ReplayRunSummary {
  id: string;
  label: string;
  mode: 'replay' | 'walk-forward';
  startedAt: string;
  completedAt: string;
  frameCount: number;
  ideaRunCount: number;
  forwardReturnCount: number;
}

export interface HistoricalBulkSyncResult {
  ok: true;
  datasetId: string;
  rawRecordCount: number;
  frameCount: number;
}

export interface IntelligencePostgresStatus {
  ok: true;
  connected: true;
  schema: string;
  database: string;
  serverTime: string;
  version: string;
}

const DEFAULT_SCHEMA = 'worldmonitor_intel';

function qident(value: string): string {
  return `"${String(value || '').replace(/"/g, '""')}"`;
}

function schemaName(config?: IntelligencePostgresConfig): string {
  return String(config?.schema || DEFAULT_SCHEMA).trim() || DEFAULT_SCHEMA;
}

function poolConfig(config: IntelligencePostgresConfig): PoolConfig {
  if (config.connectionString) {
    return {
      connectionString: config.connectionString,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      max: 4,
    };
  }
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    max: 4,
  };
}

async function withPool<T>(
  config: IntelligencePostgresConfig,
  fn: (pool: Pool, schema: string) => Promise<T>,
): Promise<T> {
  const pool = new Pool(poolConfig(config));
  try {
    return await fn(pool, schemaName(config));
  } finally {
    await pool.end();
  }
}

function replayRunSummary(run: HistoricalReplayRun): ReplayRunSummary {
  return {
    id: run.id,
    label: run.label,
    mode: run.mode,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    frameCount: run.frameCount,
    ideaRunCount: run.ideaRuns.length,
    forwardReturnCount: run.forwardReturns.length,
  };
}

async function wrapJsonEnvelope(source: string, data: unknown): Promise<string> {
  return JSON.stringify(await createStorageEnvelope(data, { source, ttlMs: 0 }));
}

async function unwrapJsonEnvelope<T>(source: string, payload: unknown): Promise<T | null> {
  if (payload == null) return null;
  const decoded = await decodeStorageValue<T>(payload, { source });
  return decoded.data;
}

export async function initIntelligencePostgresSchema(
  config: IntelligencePostgresConfig,
): Promise<{ ok: true; schema: string }> {
  return withPool(config, async (pool, schema) => {
    const s = qident(schema);
    let timescaleAvailable = false;
    try {
      const availability = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') AS available`,
      );
      timescaleAvailable = Boolean(availability.rows[0]?.available);
      if (timescaleAvailable) {
        await pool.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
      }
    } catch {
      // Plain Postgres deployments can ignore Timescale extension installation.
    }
    if (!timescaleAvailable) {
      try {
        const extensionCheck = await pool.query(
          `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') AS installed`,
        );
        timescaleAvailable = Boolean(extensionCheck.rows[0]?.installed);
      } catch {
        timescaleAvailable = false;
      }
    }
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${s}`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${s}.historical_raw_items (
        id TEXT PRIMARY KEY,
        dataset_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_id TEXT NOT NULL,
        item_kind TEXT NOT NULL,
        valid_time_start TIMESTAMPTZ NOT NULL,
        valid_time_end TIMESTAMPTZ,
        transaction_time TIMESTAMPTZ NOT NULL,
        knowledge_boundary TIMESTAMPTZ NOT NULL,
        headline TEXT,
        link TEXT,
        symbol TEXT,
        region TEXT,
        price DOUBLE PRECISION,
        schema_version INTEGER NOT NULL DEFAULT 1,
        archive_status TEXT NOT NULL DEFAULT 'warm',
        archive_uri TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${s}.historical_replay_frames (
        id TEXT PRIMARY KEY,
        dataset_id TEXT NOT NULL,
        bucket_hours INTEGER NOT NULL,
        bucket_start TIMESTAMPTZ NOT NULL,
        bucket_end TIMESTAMPTZ NOT NULL,
        valid_time_start TIMESTAMPTZ NOT NULL,
        valid_time_end TIMESTAMPTZ,
        transaction_time TIMESTAMPTZ NOT NULL,
        knowledge_boundary TIMESTAMPTZ NOT NULL,
        warmup BOOLEAN NOT NULL DEFAULT FALSE,
        news_count INTEGER NOT NULL DEFAULT 0,
        cluster_count INTEGER NOT NULL DEFAULT 0,
        market_count INTEGER NOT NULL DEFAULT 0,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${s}.historical_datasets (
        dataset_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        source_version TEXT,
        imported_at TIMESTAMPTZ NOT NULL,
        raw_record_count INTEGER NOT NULL,
        frame_count INTEGER NOT NULL,
        warmup_frame_count INTEGER NOT NULL,
        bucket_hours INTEGER NOT NULL,
        first_valid_time TIMESTAMPTZ,
        last_valid_time TIMESTAMPTZ,
        first_transaction_time TIMESTAMPTZ,
        last_transaction_time TIMESTAMPTZ,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${s}.backtest_runs (
        backtest_run_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        mode TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ NOT NULL,
        temporal_mode TEXT NOT NULL DEFAULT 'bitemporal',
        frame_count INTEGER NOT NULL,
        warmup_frame_count INTEGER NOT NULL DEFAULT 0,
        evaluation_frame_count INTEGER NOT NULL DEFAULT 0,
        summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        windows JSONB,
        snapshot_uri TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${s}.data_lifecycle_log (
        id BIGSERIAL PRIMARY KEY,
        dataset_id TEXT,
        record_id TEXT,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        archive_uri TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${s}.idea_runs (
        idea_run_id TEXT PRIMARY KEY,
        backtest_run_id TEXT REFERENCES ${s}.backtest_runs(backtest_run_id) ON DELETE CASCADE,
        frame_id TEXT,
        generated_at TIMESTAMPTZ NOT NULL,
        title TEXT NOT NULL,
        theme_id TEXT NOT NULL,
        region TEXT NOT NULL,
        direction TEXT NOT NULL,
        conviction DOUBLE PRECISION NOT NULL,
        false_positive_risk DOUBLE PRECISION NOT NULL,
        size_pct DOUBLE PRECISION NOT NULL,
        properties JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${s}.forward_returns (
        forward_return_id TEXT PRIMARY KEY,
        backtest_run_id TEXT REFERENCES ${s}.backtest_runs(backtest_run_id) ON DELETE CASCADE,
        idea_run_id TEXT REFERENCES ${s}.idea_runs(idea_run_id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL,
        horizon_hours INTEGER NOT NULL,
        entry_timestamp TIMESTAMPTZ NOT NULL,
        exit_timestamp TIMESTAMPTZ,
        entry_price DOUBLE PRECISION,
        exit_price DOUBLE PRECISION,
        raw_return_pct DOUBLE PRECISION,
        signed_return_pct DOUBLE PRECISION
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${s}.source_scores (
        source_id TEXT PRIMARY KEY,
        posterior_alpha DOUBLE PRECISION NOT NULL,
        posterior_beta DOUBLE PRECISION NOT NULL,
        posterior_accuracy_score DOUBLE PRECISION NOT NULL,
        credibility_score DOUBLE PRECISION NOT NULL,
        feed_health_score DOUBLE PRECISION NOT NULL,
        propaganda_risk_score DOUBLE PRECISION NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        properties JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${s}.mapping_stats (
        mapping_id TEXT PRIMARY KEY,
        theme_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL,
        alpha DOUBLE PRECISION NOT NULL,
        beta DOUBLE PRECISION NOT NULL,
        posterior_win_rate DOUBLE PRECISION NOT NULL,
        ema_return_pct DOUBLE PRECISION NOT NULL,
        ema_holding_days DOUBLE PRECISION NOT NULL,
        observations INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);
    if (timescaleAvailable) {
      try {
        await pool.query(
          `SELECT create_hypertable('${schema}.historical_raw_items', 'transaction_time', if_not_exists => TRUE, migrate_data => TRUE)`,
        );
      } catch {
        // Ignore when Timescale is unavailable or the table shape is not eligible.
      }
      try {
        await pool.query(
          `SELECT create_hypertable('${schema}.historical_replay_frames', 'transaction_time', if_not_exists => TRUE, migrate_data => TRUE)`,
        );
      } catch {
        // Ignore when Timescale is unavailable or the table shape is not eligible.
      }
    }
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${qident(`${schema}_hist_raw_dataset_tx_idx`)} ON ${s}.historical_raw_items (dataset_id, transaction_time, valid_time_start)`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${qident(`${schema}_hist_frames_dataset_tx_idx`)} ON ${s}.historical_replay_frames (dataset_id, transaction_time, bucket_start)`,
    );
    return { ok: true, schema };
  });
}

export async function checkIntelligencePostgresConnection(
  config: IntelligencePostgresConfig,
): Promise<IntelligencePostgresStatus> {
  return withPool(config, async (pool, schema) => {
    const result = await pool.query(`
      SELECT
        current_database() AS database_name,
        now() AS server_time,
        version() AS server_version
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return {
      ok: true,
      connected: true,
      schema,
      database: String(row?.database_name || ''),
      serverTime: new Date(String(row?.server_time || new Date().toISOString())).toISOString(),
      version: String(row?.server_version || ''),
    };
  });
}

export async function upsertHistoricalDatasetToPostgres(
  config: IntelligencePostgresConfig,
  dataset: HistoricalDatasetSummary,
): Promise<{ ok: true; datasetId: string }> {
  return withPool(config, async (pool, schema) => {
    const s = qident(schema);
    await pool.query(
      `
      INSERT INTO ${s}.historical_datasets (
        dataset_id, provider, source_version, imported_at, raw_record_count, frame_count,
        warmup_frame_count, bucket_hours, first_valid_time, last_valid_time,
        first_transaction_time, last_transaction_time, metadata
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
      )
      ON CONFLICT (dataset_id) DO UPDATE SET
        provider = EXCLUDED.provider,
        source_version = EXCLUDED.source_version,
        imported_at = EXCLUDED.imported_at,
        raw_record_count = EXCLUDED.raw_record_count,
        frame_count = EXCLUDED.frame_count,
        warmup_frame_count = EXCLUDED.warmup_frame_count,
        bucket_hours = EXCLUDED.bucket_hours,
        first_valid_time = EXCLUDED.first_valid_time,
        last_valid_time = EXCLUDED.last_valid_time,
        first_transaction_time = EXCLUDED.first_transaction_time,
        last_transaction_time = EXCLUDED.last_transaction_time,
        metadata = EXCLUDED.metadata
    `,
      [
        dataset.datasetId,
        dataset.provider,
        dataset.sourceVersion,
        dataset.importedAt,
        dataset.rawRecordCount,
        dataset.frameCount,
        dataset.warmupFrameCount,
        dataset.bucketHours,
        dataset.firstValidTime,
        dataset.lastValidTime,
        dataset.firstTransactionTime,
        dataset.lastTransactionTime,
        JSON.stringify(dataset.metadata || {}),
      ],
    );
    return { ok: true, datasetId: dataset.datasetId };
  });
}

export async function upsertHistoricalReplayRunToPostgres(
  config: IntelligencePostgresConfig,
  run: HistoricalReplayRun,
): Promise<{ ok: true; runId: string }> {
  return withPool(config, async (pool, schema) => {
    const s = qident(schema);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM ${s}.forward_returns WHERE backtest_run_id = $1`, [run.id]);
      await client.query(`DELETE FROM ${s}.idea_runs WHERE backtest_run_id = $1`, [run.id]);
      await client.query(`DELETE FROM ${s}.backtest_runs WHERE backtest_run_id = $1`, [run.id]);

      await client.query(
        `
        INSERT INTO ${s}.backtest_runs (
          backtest_run_id, label, mode, started_at, completed_at, temporal_mode,
          frame_count, warmup_frame_count, evaluation_frame_count, summary, payload, windows, snapshot_uri
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      `,
        [
          run.id,
          run.label,
          run.mode,
          run.startedAt,
          run.completedAt,
          run.temporalMode,
          run.frameCount,
          run.warmupFrameCount,
          run.evaluationFrameCount,
          JSON.stringify({
            workflow: run.workflow,
            summaryLines: run.summaryLines,
            horizonsHours: run.horizonsHours,
          }),
          await wrapJsonEnvelope('backtest-run', run),
          run.windows ? await wrapJsonEnvelope('backtest-run-window', run.windows) : null,
          null,
        ],
      );

      for (const idea of run.ideaRuns) {
        await client.query(
          `
          INSERT INTO ${s}.idea_runs (
            idea_run_id, backtest_run_id, frame_id, generated_at, title, theme_id,
            region, direction, conviction, false_positive_risk, size_pct, properties
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `,
          [
            idea.id,
            run.id,
            idea.frameId,
            idea.generatedAt,
            idea.title,
            idea.themeId,
            idea.region,
            idea.direction,
            idea.conviction,
            idea.falsePositiveRisk,
            idea.sizePct,
            JSON.stringify({
              thesis: idea.thesis,
              evidence: idea.evidence,
              triggers: idea.triggers,
              invalidation: idea.invalidation,
              transmissionPath: idea.transmissionPath,
              analogRefs: idea.analogRefs,
              symbols: idea.symbols,
            }),
          ],
        );
      }

      {
        const CHUNK = 500;
        for (let c = 0; c < run.forwardReturns.length; c += CHUNK) {
          const chunk = run.forwardReturns.slice(c, c + CHUNK);
          const values: unknown[] = [];
          const placeholders: string[] = [];
          let idx = 1;
          for (const result of chunk) {
            placeholders.push(
              `($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5},$${idx + 6},$${idx + 7},$${idx + 8},$${idx + 9},$${idx + 10},$${idx + 11})`,
            );
            values.push(
              result.id, run.id, result.ideaRunId, result.symbol, result.direction,
              result.horizonHours, result.entryTimestamp, result.exitTimestamp,
              result.entryPrice, result.exitPrice, result.rawReturnPct, result.signedReturnPct,
            );
            idx += 12;
          }
          await client.query(
            `INSERT INTO ${s}.forward_returns (
              forward_return_id, backtest_run_id, idea_run_id, symbol, direction,
              horizon_hours, entry_timestamp, exit_timestamp, entry_price, exit_price,
              raw_return_pct, signed_return_pct
            ) VALUES ${placeholders.join(',')}`,
            values,
          );
        }
      }

      {
        const CHUNK = 500;
        for (let c = 0; c < run.sourceProfiles.length; c += CHUNK) {
          const chunk = run.sourceProfiles.slice(c, c + CHUNK);
          const values: unknown[] = [];
          const placeholders: string[] = [];
          let idx = 1;
          for (const profile of chunk) {
            placeholders.push(
              `($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5},$${idx + 6},$${idx + 7},$${idx + 8})`,
            );
            values.push(
              profile.id, profile.posteriorAlpha, profile.posteriorBeta,
              profile.posteriorAccuracyScore, profile.credibilityScore,
              profile.feedHealthScore, profile.propagandaRiskScore,
              new Date(profile.lastEvaluatedAt).toISOString(), JSON.stringify(profile),
            );
            idx += 9;
          }
          if (placeholders.length > 0) {
            await client.query(
              `INSERT INTO ${s}.source_scores (
                source_id, posterior_alpha, posterior_beta, posterior_accuracy_score,
                credibility_score, feed_health_score, propaganda_risk_score, updated_at, properties
              ) VALUES ${placeholders.join(',')}
              ON CONFLICT (source_id) DO UPDATE SET
                posterior_alpha = EXCLUDED.posterior_alpha,
                posterior_beta = EXCLUDED.posterior_beta,
                posterior_accuracy_score = EXCLUDED.posterior_accuracy_score,
                credibility_score = EXCLUDED.credibility_score,
                feed_health_score = EXCLUDED.feed_health_score,
                propaganda_risk_score = EXCLUDED.propaganda_risk_score,
                updated_at = EXCLUDED.updated_at,
                properties = EXCLUDED.properties`,
              values,
            );
          }
        }
      }

      {
        const CHUNK = 500;
        for (let c = 0; c < run.mappingStats.length; c += CHUNK) {
          const chunk = run.mappingStats.slice(c, c + CHUNK);
          const values: unknown[] = [];
          const placeholders: string[] = [];
          let idx = 1;
          for (const stat of chunk) {
            placeholders.push(
              `($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5},$${idx + 6},$${idx + 7},$${idx + 8},$${idx + 9},$${idx + 10})`,
            );
            values.push(
              stat.id, stat.themeId, stat.symbol, stat.direction,
              stat.alpha, stat.beta, stat.posteriorWinRate,
              stat.emaReturnPct, stat.emaHoldingDays, stat.observations,
              stat.lastUpdatedAt,
            );
            idx += 11;
          }
          if (placeholders.length > 0) {
            await client.query(
              `INSERT INTO ${s}.mapping_stats (
                mapping_id, theme_id, symbol, direction, alpha, beta, posterior_win_rate,
                ema_return_pct, ema_holding_days, observations, updated_at
              ) VALUES ${placeholders.join(',')}
              ON CONFLICT (mapping_id) DO UPDATE SET
                theme_id = EXCLUDED.theme_id,
                symbol = EXCLUDED.symbol,
                direction = EXCLUDED.direction,
                alpha = EXCLUDED.alpha,
                beta = EXCLUDED.beta,
                posterior_win_rate = EXCLUDED.posterior_win_rate,
                ema_return_pct = EXCLUDED.ema_return_pct,
                ema_holding_days = EXCLUDED.ema_holding_days,
                observations = EXCLUDED.observations,
                updated_at = EXCLUDED.updated_at`,
              values,
            );
          }
        }
      }

      await client.query('COMMIT');
      return { ok: true, runId: run.id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}

export async function bulkSyncHistoricalRawItemsToPostgres(
  config: IntelligencePostgresConfig,
  records: HistoricalRawReplayRecord[],
): Promise<{ ok: true; rowCount: number }> {
  if (records.length === 0) {
    return { ok: true, rowCount: 0 };
  }
  return withPool(config, async (pool, schema) => {
    const s = qident(schema);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const record of records) {
        await client.query(
          `
          INSERT INTO ${s}.historical_raw_items (
            id, dataset_id, provider, source_kind, source_id, item_kind,
            valid_time_start, valid_time_end, transaction_time, knowledge_boundary,
            headline, link, symbol, region, price, schema_version, archive_status, archive_uri, payload, metadata
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
          )
          ON CONFLICT (id) DO UPDATE SET
            dataset_id = EXCLUDED.dataset_id,
            provider = EXCLUDED.provider,
            source_kind = EXCLUDED.source_kind,
            source_id = EXCLUDED.source_id,
            item_kind = EXCLUDED.item_kind,
            valid_time_start = EXCLUDED.valid_time_start,
            valid_time_end = EXCLUDED.valid_time_end,
            transaction_time = EXCLUDED.transaction_time,
            knowledge_boundary = EXCLUDED.knowledge_boundary,
            headline = EXCLUDED.headline,
            link = EXCLUDED.link,
            symbol = EXCLUDED.symbol,
            region = EXCLUDED.region,
            price = EXCLUDED.price,
            schema_version = EXCLUDED.schema_version,
            archive_status = EXCLUDED.archive_status,
            archive_uri = EXCLUDED.archive_uri,
            payload = EXCLUDED.payload,
            metadata = EXCLUDED.metadata
        `,
          [
            record.id,
            record.datasetId,
            record.provider,
            record.sourceKind,
            record.sourceId,
            record.itemKind,
            record.validTimeStart,
            record.validTimeEnd,
            record.transactionTime,
            record.knowledgeBoundary,
            record.headline,
            record.link,
            record.symbol,
            record.region,
            record.price,
            resolveSchemaVersion('historical-raw-item'),
            'warm',
            null,
            await wrapJsonEnvelope('historical-raw-item', record.payload || {}),
            await wrapJsonEnvelope('historical-raw-item', record.metadata || {}),
          ],
        );
      }
      await client.query('COMMIT');
      return { ok: true, rowCount: records.length };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}

export async function bulkSyncHistoricalReplayFramesToPostgres(
  config: IntelligencePostgresConfig,
  frames: HistoricalReplayFrameArchiveRow[],
): Promise<{ ok: true; rowCount: number }> {
  if (frames.length === 0) {
    return { ok: true, rowCount: 0 };
  }
  return withPool(config, async (pool, schema) => {
    const s = qident(schema);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const frame of frames) {
        await client.query(
          `
          INSERT INTO ${s}.historical_replay_frames (
            id, dataset_id, bucket_hours, bucket_start, bucket_end,
            valid_time_start, valid_time_end, transaction_time, knowledge_boundary,
            warmup, news_count, cluster_count, market_count, payload
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
          )
          ON CONFLICT (id) DO UPDATE SET
            dataset_id = EXCLUDED.dataset_id,
            bucket_hours = EXCLUDED.bucket_hours,
            bucket_start = EXCLUDED.bucket_start,
            bucket_end = EXCLUDED.bucket_end,
            valid_time_start = EXCLUDED.valid_time_start,
            valid_time_end = EXCLUDED.valid_time_end,
            transaction_time = EXCLUDED.transaction_time,
            knowledge_boundary = EXCLUDED.knowledge_boundary,
            warmup = EXCLUDED.warmup,
            news_count = EXCLUDED.news_count,
            cluster_count = EXCLUDED.cluster_count,
            market_count = EXCLUDED.market_count,
            payload = EXCLUDED.payload
        `,
          [
            frame.id,
            frame.datasetId,
            frame.bucketHours,
            frame.bucketStart,
            frame.bucketEnd,
            frame.validTimeStart,
            frame.validTimeEnd,
            frame.transactionTime,
            frame.knowledgeBoundary,
            frame.warmup,
            frame.newsCount,
            frame.clusterCount,
            frame.marketCount,
            await wrapJsonEnvelope('historical-replay-frame', frame.payload),
          ],
        );
      }
      await client.query('COMMIT');
      return { ok: true, rowCount: frames.length };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}

export async function bulkSyncHistoricalDatasetContentsToPostgres(
  config: IntelligencePostgresConfig,
  dataset: HistoricalDatasetSummary,
  records: HistoricalRawReplayRecord[],
  frames: HistoricalReplayFrameArchiveRow[],
): Promise<HistoricalBulkSyncResult> {
  await upsertHistoricalDatasetToPostgres(config, dataset);
  const rawResult = await bulkSyncHistoricalRawItemsToPostgres(config, records);
  const frameResult = await bulkSyncHistoricalReplayFramesToPostgres(config, frames);
  return {
    ok: true,
    datasetId: dataset.datasetId,
    rawRecordCount: rawResult.rowCount,
    frameCount: frameResult.rowCount,
  };
}

export async function listHistoricalReplayRunsFromPostgres(
  config: IntelligencePostgresConfig,
  limit = 20,
): Promise<ReplayRunSummary[]> {
  return withPool(config, async (pool, schema) => {
    const s = qident(schema);
    const result = await pool.query(
      `
      SELECT
        backtest_run_id, label, mode, started_at, completed_at, frame_count,
        (summary->'workflow'->>'trackedIdeaCount')::int AS tracked_ideas,
        COALESCE((summary->>'forwardReturnCount')::int, 0) AS forward_returns
      FROM ${s}.backtest_runs
      ORDER BY completed_at DESC
      LIMIT $1
    `,
      [Math.max(1, Math.min(200, Math.round(limit || 20)))],
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      id: String(row.backtest_run_id),
      label: String(row.label),
      mode: row.mode === 'walk-forward' ? 'walk-forward' : 'replay',
      startedAt: new Date(String(row.started_at || 0)).toISOString(),
      completedAt: new Date(String(row.completed_at || 0)).toISOString(),
      frameCount: Number(row.frame_count || 0),
      ideaRunCount: Number(row.tracked_ideas || 0),
      forwardReturnCount: Number(row.forward_returns || 0),
    }));
  });
}

export async function getHistoricalReplayRunFromPostgres(
  config: IntelligencePostgresConfig,
  runId: string,
): Promise<HistoricalReplayRun | null> {
  return withPool(config, async (pool, schema) => {
    const s = qident(schema);
    const result = await pool.query(
      `SELECT payload FROM ${s}.backtest_runs WHERE backtest_run_id = $1 LIMIT 1`,
      [runId],
    );
    if (result.rowCount === 0) return null;
    const payload = result.rows[0]?.payload;
    return await unwrapJsonEnvelope<HistoricalReplayRun>('backtest-run', payload);
  });
}

export function getIntelligencePostgresConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): IntelligencePostgresConfig | null {
  const connectionString = env.INTEL_PG_URL || env.DATABASE_URL;
  const host = env.INTEL_PG_HOST;
  const database = env.INTEL_PG_DATABASE;
  if (!connectionString && !(host && database)) return null;
  return {
    connectionString: connectionString || undefined,
    host: host || undefined,
    port: env.INTEL_PG_PORT ? Number(env.INTEL_PG_PORT) : undefined,
    user: env.INTEL_PG_USER || undefined,
    password: env.INTEL_PG_PASSWORD || undefined,
    database: database || undefined,
    schema: env.INTEL_PG_SCHEMA || DEFAULT_SCHEMA,
    ssl: /^(1|true|yes)$/i.test(env.INTEL_PG_SSL || ''),
  };
}

export function summarizeHistoricalReplayRun(run: HistoricalReplayRun): ReplayRunSummary {
  return replayRunSummary(run);
}
