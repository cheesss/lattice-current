/**
 * pipeline-lock.mjs — File-based lock to prevent concurrent pipeline runs.
 *
 * Uses a .lock file with PID + timestamp. Automatically detects and cleans
 * stale locks (process no longer running).
 */

import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const LOCK_DIR = join(process.cwd(), 'data');
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

function lockPath(name) {
  return join(LOCK_DIR, `${name}.lock`);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(name) {
  const path = lockPath(name);

  if (existsSync(path)) {
    try {
      const content = JSON.parse(readFileSync(path, 'utf8'));
      const age = Date.now() - content.ts;

      if (isProcessAlive(content.pid) && age < STALE_THRESHOLD_MS) {
        return { acquired: false, holder: content };
      }
      // Stale lock — remove it
      unlinkSync(path);
    } catch {
      // Corrupted lock file — remove it
      try { unlinkSync(path); } catch { /* ignore */ }
    }
  }

  const lock = { pid: process.pid, ts: Date.now(), name };
  writeFileSync(path, JSON.stringify(lock));
  return { acquired: true, holder: lock };
}

export function releaseLock(name) {
  const path = lockPath(name);
  try {
    if (existsSync(path)) {
      const content = JSON.parse(readFileSync(path, 'utf8'));
      if (content.pid === process.pid) {
        unlinkSync(path);
        return true;
      }
    }
  } catch { /* ignore */ }
  return false;
}

export async function withLock(name, fn) {
  const result = acquireLock(name);
  if (!result.acquired) {
    console.log(`[lock] ${name}: held by PID ${result.holder.pid} since ${new Date(result.holder.ts).toISOString()}, skipping`);
    return null;
  }
  try {
    return await fn();
  } finally {
    releaseLock(name);
  }
}
