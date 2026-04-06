import { getLifecyclePolicy } from './lifecycle-config';

export interface HotCacheRecord<T = unknown> {
  key: string;
  expiresAt: string;
  value: T;
}

export interface WarmWriteResult {
  inserted: boolean;
  datasetId?: string;
}

export function shouldMigrateHotRecord(record: HotCacheRecord, now = new Date()): boolean {
  const policy = getLifecyclePolicy(record.key);
  if (policy.postgresRetentionDays <= 0) return false;
  const expiresAt = new Date(record.expiresAt).getTime();
  const deltaMs = expiresAt - now.getTime();
  return deltaMs <= 6 * 60 * 60 * 1000;
}

export async function migrateHotRecordsToWarm<T>(
  records: HotCacheRecord<T>[],
  writer: (record: HotCacheRecord<T>) => Promise<WarmWriteResult>,
  now = new Date(),
): Promise<{ attempted: number; migrated: number }> {
  let attempted = 0;
  let migrated = 0;
  for (const record of records) {
    if (!shouldMigrateHotRecord(record, now)) continue;
    attempted += 1;
    const result = await writer(record);
    if (result.inserted) migrated += 1;
  }
  return { attempted, migrated };
}
