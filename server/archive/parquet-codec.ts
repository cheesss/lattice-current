export type ArchiveSchemaName = 'events' | 'replay-frames' | 'backtest-runs';

export interface ArchiveSchemaField {
  type: 'UTF8' | 'INT64' | 'DOUBLE' | 'BOOLEAN' | 'JSON';
}

export const ARCHIVE_SCHEMAS: Record<ArchiveSchemaName, Record<string, ArchiveSchemaField>> = {
  events: {
    id: { type: 'UTF8' },
    datasetId: { type: 'UTF8' },
    validTimeStart: { type: 'UTF8' },
    transactionTime: { type: 'UTF8' },
    payload: { type: 'JSON' },
  },
  'replay-frames': {
    id: { type: 'UTF8' },
    datasetId: { type: 'UTF8' },
    bucketStart: { type: 'UTF8' },
    bucketEnd: { type: 'UTF8' },
    payload: { type: 'JSON' },
  },
  'backtest-runs': {
    id: { type: 'UTF8' },
    label: { type: 'UTF8' },
    startedAt: { type: 'UTF8' },
    completedAt: { type: 'UTF8' },
    payload: { type: 'JSON' },
  },
};

export function getArchiveSchema(name: ArchiveSchemaName) {
  return ARCHIVE_SCHEMAS[name];
}

export async function encodeRowsAsParquet(
  schemaName: ArchiveSchemaName,
  rows: Record<string, unknown>[],
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }> {
  try {
    const parquet = await import('parquetjs');
    const schemaDef = getArchiveSchema(schemaName);
    const schema = new parquet.ParquetSchema(
      Object.fromEntries(Object.entries(schemaDef).map(([key, value]) => [key, { type: value.type === 'JSON' ? 'UTF8' : value.type }])),
    );
    const chunks: Uint8Array[] = [];
    const sink = {
      write: (chunk: Uint8Array) => {
        chunks.push(chunk);
      },
      end: () => undefined,
    };
    const writer = await parquet.ParquetWriter.openStream(schema, sink as never);
    for (const row of rows) {
      const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'object' && value !== null ? JSON.stringify(value) : value]));
      await writer.appendRow(normalized);
    }
    await writer.close();
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return { ok: true, bytes: out };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

