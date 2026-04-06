import path from 'node:path';
import { spawn } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';

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

export async function runBackup(config, options = {}) {
  const startedAt = Date.now();
  const backupDir = path.resolve(options.backupDir || DEFAULT_BACKUP_DIR);
  const retentionDays = Math.max(1, Number(options.retentionDays || DEFAULT_RETENTION_DAYS));
  ensureDir(backupDir);

  const filePath = buildBackupFilePath(backupDir);
  const output = createWriteStream(filePath);
  const gzip = createGzip({ level: 6 });
  const pgDump = spawn(resolvePgDumpCommand(), [
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

  let stderr = '';
  pgDump.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  try {
    await pipeline(pgDump.stdout, gzip, output);
    const exitCode = await new Promise((resolve, reject) => {
      pgDump.once('error', reject);
      pgDump.once('close', resolve);
    });
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
    return {
      ok: false,
      filePath: '',
      sizeBytes: 0,
      durationMs: Date.now() - startedAt,
      prunedFiles: 0,
      error: String(error?.message || error || 'backup failed'),
    };
  }
}

