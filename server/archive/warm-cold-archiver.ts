import { getLifecyclePolicy } from './lifecycle-config';
import { encodeRowsAsParquet, type ArchiveSchemaName } from './parquet-codec';
import { uploadArchiveObject } from './s3-client';

export interface WarmRecord {
  id: string;
  source: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export function shouldArchiveWarmRecord(record: WarmRecord, now = new Date()): boolean {
  const policy = getLifecyclePolicy(record.source);
  if (policy.coldArchiveAfterDays == null) return false;
  const ageMs = now.getTime() - new Date(record.createdAt).getTime();
  return ageMs >= policy.coldArchiveAfterDays * 24 * 60 * 60 * 1000;
}

export async function archiveWarmRecords(
  schema: ArchiveSchemaName,
  records: WarmRecord[],
  keyPrefix: string,
  env: Record<string, string | undefined> = process.env,
): Promise<{ archived: number; skipped: number; lastUri: string | null }> {
  const eligible = records.filter((record) => shouldArchiveWarmRecord(record));
  if (eligible.length === 0) {
    return { archived: 0, skipped: records.length, lastUri: null };
  }
  const encoded = await encodeRowsAsParquet(schema, eligible.map((record) => ({
    id: record.id,
    createdAt: record.createdAt,
    payload: record.payload,
    source: record.source,
  })));
  if (!encoded.ok) {
    return { archived: 0, skipped: records.length, lastUri: null };
  }
  const key = `${keyPrefix}/${new Date().toISOString().slice(0, 10)}-${schema}.parquet`;
  const upload = await uploadArchiveObject(key, encoded.bytes, env);
  if (!upload.ok) {
    return { archived: 0, skipped: records.length, lastUri: null };
  }
  return { archived: eligible.length, skipped: records.length - eligible.length, lastUri: upload.uri };
}

