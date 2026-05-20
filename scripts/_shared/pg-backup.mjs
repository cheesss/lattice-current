import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import pg from 'pg';

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_BACKUP_DIR = path.resolve('data', 'backups');

function nowStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function resolvePgDumpCommand() {
  return String(process.env.PG_DUMP_BIN || 'pg_dump').trim() || 'pg_dump';
}

function buildBackupFilePath(backupDir, date = new Date()) {
  return path.join(backupDir, `postgres-backup-${nowStamp(date)}.sql.gz`);
}

function buildFallbackBackupFilePath(backupDir, date = new Date()) {
  return path.join(backupDir, `postgres-backup-${nowStamp(date)}.jsonl.gz`);
}

function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function pruneOldBackups(backupDir, retentionDays = DEFAULT_RETENTION_DAYS) {
  ensureDir(backupDir);
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const fileName of readdirSync(backupDir)) {
    const fullPath = path.join(backupDir, fileName);
    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) continue;
      if (stat.mtimeMs < cutoffMs) {
        unlinkSync(fullPath);
        removed += 1;
      }
    } catch {
      // best-effort pruning
    }
  }
  return removed;
}

function quoteIdent(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

async function writeGzipLine(gzip, value) {
  if (!gzip.write(`${JSON.stringify(value)}\n`)) {
    await once(gzip, 'drain');
  }
}

async function runJsonFallbackBackup(config, options = {}, reason = 'pg_dump unavailable') {
  const startedAt = Date.now();
  const backupDir = path.resolve(options.backupDir || DEFAULT_BACKUP_DIR);
  const retentionDays = Math.max(1, Number(options.retentionDays || DEFAULT_RETENTION_DAYS));
  const batchSize = Math.max(100, Math.min(10_000, Number(options.fallbackBatchSize || process.env.PG_BACKUP_FALLBACK_BATCH_SIZE || 2_000)));
  const filePath = buildFallbackBackupFilePath(backupDir);
  ensureDir(backupDir);

  const client = new pg.Client(config);
  const output = createWriteStream(filePath);
  const gzip = createGzip({ level: 6 });
  gzip.pipe(output);

  let tableCount = 0;
  let rowCount = 0;
  try {
    await client.connect();
    const { rows: tables } = await client.query(`
      SELECT schemaname, tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);

    await writeGzipLine(gzip, {
      type: 'manifest',
      format: 'lattice-jsonl-fallback-v1',
      generatedAt: new Date().toISOString(),
      reason,
      database: config.database,
      tableCount: tables.length,
      batchSize,
    });

    for (const table of tables) {
      const schemaName = String(table.schemaname || 'public');
      const tableName = String(table.tablename || '');
      if (!tableName) continue;
      const qualified = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;
      const { rows: columns } = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `, [schemaName, tableName]);
      await writeGzipLine(gzip, {
        type: 'table',
        schema: schemaName,
        table: tableName,
        columns,
      });

      tableCount += 1;
      let offset = 0;
      for (;;) {
        const { rows } = await client.query(`SELECT * FROM ${qualified} LIMIT $1 OFFSET $2`, [batchSize, offset]);
        if (rows.length === 0) break;
        for (const row of rows) {
          await writeGzipLine(gzip, {
            type: 'row',
            schema: schemaName,
            table: tableName,
            data: row,
          });
        }
        rowCount += rows.length;
        offset += rows.length;
        if (rows.length < batchSize) break;
      }
    }

    gzip.end();
    await once(output, 'finish');
    const stat = statSync(filePath);
    const prunedFiles = pruneOldBackups(backupDir, retentionDays);
    return {
      ok: true,
      fallback: 'jsonl',
      filePath,
      sizeBytes: stat.size,
      durationMs: Date.now() - startedAt,
      prunedFiles,
      tableCount,
      rowCount,
      error: '',
    };
  } catch (error) {
    try {
      gzip.destroy();
    } catch {
      // ignore
    }
    try {
      output.destroy();
    } catch {
      // ignore
    }
    try {
      unlinkSync(filePath);
    } catch {
      // ignore
    }
    return {
      ok: false,
      skipped: false,
      fallback: 'jsonl',
      filePath: '',
      sizeBytes: 0,
      durationMs: Date.now() - startedAt,
      prunedFiles: 0,
      tableCount,
      rowCount,
      error: String(error?.message || error || 'json fallback backup failed'),
    };
  } finally {
    await client.end().catch(() => {});
  }
}

export async function runBackup(config, options = {}) {
  const startedAt = Date.now();
  const backupDir = path.resolve(options.backupDir || DEFAULT_BACKUP_DIR);
  const retentionDays = Math.max(1, Number(options.retentionDays || DEFAULT_RETENTION_DAYS));
  ensureDir(backupDir);

  const filePath = buildBackupFilePath(backupDir);
  const command = resolvePgDumpCommand();

  // Spawn pg_dump with immediate error handler attached BEFORE any other operation
  // (spawn 'error' fires asynchronously; if not handled it becomes uncaughtException
  //  and crashes the daemon — common case is ENOENT when pg_dump is not installed).
  let pgDump;
  try {
    pgDump = spawn(command, [
      '--host', String(config.host),
      '--port', String(config.port),
      '--username', String(config.user),
      '--dbname', String(config.database),
      '--format', 'plain',
      '--no-owner',
      '--no-privileges',
    ], {
      env: {
        ...process.env,
        PGPASSWORD: String(config.password || ''),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (spawnError) {
    return {
      ok: false,
      skipped: true,
      filePath: '',
      sizeBytes: 0,
      durationMs: Date.now() - startedAt,
      prunedFiles: 0,
      error: `pg_dump unavailable: ${String(spawnError?.message || spawnError)}`,
    };
  }

  // CRITICAL: attach error handler before any awaits to prevent uncaughtException
  let spawnErrorMessage = null;
  pgDump.on('error', (err) => {
    spawnErrorMessage = String(err?.message || err);
  });

  let stderr = '';
  pgDump.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const output = createWriteStream(filePath);
  const gzip = createGzip({ level: 6 });

  try {
    // If spawn failed asynchronously (ENOENT), spawnErrorMessage will be set on next tick
    // Wait one tick to let the error event fire
    await new Promise((resolve) => setImmediate(resolve));
    if (spawnErrorMessage) {
      const isMissing = /ENOENT|not found|cannot find/i.test(spawnErrorMessage);
      throw new Error(
        isMissing
          ? `pg_dump command not available on this system (${spawnErrorMessage})`
          : spawnErrorMessage
      );
    }

    await pipeline(pgDump.stdout, gzip, output);
    const exitCode = await new Promise((resolve) => {
      pgDump.once('close', resolve);
    });

    // Check if error occurred during pipeline
    if (spawnErrorMessage) {
      throw new Error(spawnErrorMessage);
    }

    if (Number(exitCode) !== 0) {
      throw new Error(stderr.trim() || `pg_dump exited with code ${exitCode}`);
    }

    const stat = statSync(filePath);
    const prunedFiles = pruneOldBackups(backupDir, retentionDays);
    return {
      ok: true,
      filePath,
      sizeBytes: stat.size,
      durationMs: Date.now() - startedAt,
      prunedFiles,
      error: '',
    };
  } catch (error) {
    try {
      output.destroy();
    } catch {
      // ignore
    }
    try {
      unlinkSync(filePath);
    } catch {
      // ignore
    }
    const errorMessage = String(error?.message || error || 'backup failed');
    const skipped = /ENOENT|not available|not found|cannot find/i.test(errorMessage);
    if (skipped && options.allowJsonFallback !== false) {
      return runJsonFallbackBackup(config, options, errorMessage);
    }
    return {
      ok: false,
      skipped,
      filePath: '',
      sizeBytes: 0,
      durationMs: Date.now() - startedAt,
      prunedFiles: 0,
      error: errorMessage,
    };
  }
}
