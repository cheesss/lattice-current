export const SOURCE_PROVIDER_QUARANTINE_VERSION = 'source-provider-quarantine-v1';

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const QUARANTINE_STATUSES = new Set([
  'probe_failed',
  'quarantined',
  'needs_credentials',
  'needs_fixture',
  'provider_gap_proposal_required',
]);

export function isQuarantinedSourceProvider(record = {}) {
  return QUARANTINE_STATUSES.has(record.status)
    || record.quarantined === true
    || asArray(record.evaluation?.reasons).some((reason) => /failed|below|insufficient|credential|fixture|provider_gap/i.test(reason));
}

export function quarantineSourceProviderCandidate(record = {}, reason = 'operator_review_required') {
  const now = new Date().toISOString();
  return {
    ...record,
    status: 'quarantined',
    quarantined: true,
    quarantineReason: compact(reason || record.quarantineReason || 'operator_review_required'),
    updatedAt: now,
    statusHistory: [
      ...asArray(record.statusHistory),
      {
        status: 'quarantined',
        reason: compact(reason || 'source/provider quarantined'),
        at: now,
        actor: 'source-provider-quarantine',
      },
    ],
  };
}

export function buildSourceProviderQuarantineSummary(records = []) {
  const rows = asArray(records);
  const quarantined = rows.filter(isQuarantinedSourceProvider);
  const byReason = {};
  const byStatus = {};
  for (const record of quarantined) {
    byStatus[record.status] = (byStatus[record.status] || 0) + 1;
    const reason = record.quarantineReason
      || record.evaluation?.reasons?.[0]
      || record.status
      || 'unknown';
    byReason[reason] = (byReason[reason] || 0) + 1;
  }
  return {
    ok: true,
    version: SOURCE_PROVIDER_QUARANTINE_VERSION,
    totalRecords: rows.length,
    quarantinedCount: quarantined.length,
    byStatus,
    byReason,
    quarantined: quarantined.map((record) => ({
      candidateId: record.candidateId,
      providerName: record.providerName,
      evidenceClass: record.evidenceClass,
      status: record.status,
      reason: record.quarantineReason || record.evaluation?.reasons?.[0] || null,
    })),
  };
}
