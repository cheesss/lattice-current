import path from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const RUNTIME_ISSUES_DIR = path.resolve('data', 'runtime-issues');

function todayDir() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return path.join(RUNTIME_ISSUES_DIR, `${yyyy}-${mm}-${dd}`);
}

function truncate(value, maxLen = 2000) {
  const s = String(value ?? '');
  return s.length > maxLen ? s.slice(0, maxLen) + '…[truncated]' : s;
}

/**
 * Classify a runtime issue into one of 7 categories.
 * @param {string} surface
 * @param {string} action
 * @param {number|string} responseStatus
 * @param {string} errorMessage
 * @returns {string}
 */
export function classifyIssue(surface, action, responseStatus, errorMessage) {
  const msg = String(errorMessage || '').toLowerCase();
  const status = Number(responseStatus) || 0;
  if (msg.includes('is not defined') || msg.includes('function')) return 'ui-wiring';
  if (msg.includes('rss') || msg.includes('fetch') || msg.includes('403') || msg.includes('429') || msg.includes('timeout')) return 'external-dependency';
  if (String(action || '').includes('freshness') || String(action || '').includes('stale')) return 'freshness-trust';
  if (String(action || '').includes('bulk')) return 'action-semantics';
  if (status === 404 || status === 500) return 'api-contract';
  return 'api-contract';
}

/**
 * Returns true only for issue types where automatic remediation is safe.
 * @param {string} classification
 * @returns {boolean}
 */
export function safeToAutoFix(classification) {
  return classification === 'ui-wiring' || classification === 'freshness-trust';
}

/**
 * Capture a runtime issue envelope to data/runtime-issues/YYYY-MM-DD/{id}.json.
 * Never throws — capturing failures must not crash the caller.
 * @param {object} envelope
 * @returns {{ id: string, path: string }}
 */
export function captureRuntimeIssue(envelope) {
  const id = `runtime-issue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dirPath = todayDir();
  const filePath = path.join(dirPath, `${id}.json`);

  try {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
    const entry = {
      id,
      createdAt: new Date().toISOString(),
      ...envelope,
      // Truncate potentially large fields
      responseBody: envelope.responseBody != null ? truncate(
        typeof envelope.responseBody === 'string'
          ? envelope.responseBody
          : JSON.stringify(envelope.responseBody),
        2000
      ) : undefined,
      errorMessage: truncate(envelope.errorMessage, 1000),
    };
    writeFileSync(filePath, JSON.stringify(entry, null, 2));
    return { id, path: filePath };
  } catch (err) {
    console.warn('[runtime-issue-writer] Failed to capture issue:', String(err?.message || err));
    return { id, path: filePath };
  }
}
