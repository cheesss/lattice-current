import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const REPORT_FEEDBACK_TYPES = Object.freeze([
  'useful',
  'too_speculative',
  'missing_evidence',
  'wrong_framing',
  'need_source_query',
  'promote_to_watch',
  'reject_claim',
]);

function sanitizeReportId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_.-]{3,180}$/.test(id)) {
    throw new Error('invalid report id');
  }
  return id;
}

function normalizeFeedback(feedback = {}) {
  const type = String(feedback.type || feedback.feedbackType || '').trim();
  if (!REPORT_FEEDBACK_TYPES.includes(type)) {
    throw new Error(`unsupported report feedback type: ${type}`);
  }
  return {
    feedbackId: feedback.feedbackId || `RFB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    reportId: feedback.reportId || null,
    claimId: feedback.claimId || null,
    figureId: feedback.figureId || null,
    evidenceId: feedback.evidenceId || null,
    note: String(feedback.note || '').slice(0, 2000),
    reviewer: String(feedback.reviewer || 'operator').slice(0, 120),
    createdAt: new Date().toISOString(),
    metadata: feedback.metadata || {},
  };
}
export async function appendReportFeedback(reportId, feedback = {}, options = {}) {
  const safeId = sanitizeReportId(reportId);
  const reportDir = options.reportDir || path.join('data', 'reports', safeId);
  await mkdir(reportDir, { recursive: true });
  const normalized = normalizeFeedback({ ...feedback, reportId: safeId });
  const filePath = path.join(reportDir, 'feedback.jsonl');
  await appendFile(filePath, `${JSON.stringify(normalized)}\n`, 'utf8');
  return { ok: true, feedback: normalized, filePath: path.resolve(filePath) };
}

export async function readReportFeedback(reportId, options = {}) {
  const safeId = sanitizeReportId(reportId);
  const reportDir = options.reportDir || path.join('data', 'reports', safeId);
  const filePath = path.join(reportDir, 'feedback.jsonl');
  try {
    const raw = await readFile(filePath, 'utf8');
    return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function summarizeReportFeedback(rows = []) {
  const byType = {};
  for (const row of rows) {
    byType[row.type] = (byType[row.type] || 0) + 1;
  }
  return {
    total: rows.length,
    byType,
    needsSourceQuery: Number(byType.need_source_query || 0),
    tooSpeculative: Number(byType.too_speculative || 0),
    missingEvidence: Number(byType.missing_evidence || 0),
  };
}
