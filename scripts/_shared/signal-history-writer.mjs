/**
 * Shared helper for writing into signal_history with explicit value_origin
 * and writer_id. Replaces bare INSERT so that downstream quality classifiers
 * can distinguish observed vs derived/proxy/composite rows.
 *
 * The underlying table must have been migrated via
 * scripts/migrations/add-signal-history-origin.mjs first.
 */

export const SIGNAL_ORIGIN = Object.freeze({
  OBSERVED: 'observed',
  PROXY: 'proxy',
  COMPOSITE: 'composite',
  IMPUTED: 'imputed',
  MIRRORED: 'mirrored',
});

const VALID_ORIGINS = new Set(Object.values(SIGNAL_ORIGIN));

/**
 * Insert or update a signal_history row with explicit origin metadata.
 *
 * @param {import('pg').Client | import('pg').Pool} client
 * @param {{signalName: string, ts: string|Date, value: number,
 *          valueOrigin?: string, writerId: string}} row
 */
export async function writeSignalHistoryRow(client, row) {
  const {
    signalName,
    ts,
    value,
    valueOrigin = SIGNAL_ORIGIN.OBSERVED,
    writerId,
  } = row;

  if (!signalName || typeof signalName !== 'string') {
    throw new Error('signalName required');
  }
  if (!writerId || typeof writerId !== 'string') {
    throw new Error(`writerId required for signal=${signalName}`);
  }
  if (!VALID_ORIGINS.has(valueOrigin)) {
    throw new Error(`invalid valueOrigin=${valueOrigin} for signal=${signalName}`);
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`non-finite value for signal=${signalName}: ${value}`);
  }

  const result = await client.query(
    `INSERT INTO signal_history (signal_name, ts, value, value_origin, writer_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (signal_name, ts) DO UPDATE
       SET value = EXCLUDED.value,
           value_origin = EXCLUDED.value_origin,
           writer_id = EXCLUDED.writer_id`,
    [signalName, ts, numericValue, valueOrigin, writerId],
  );
  return Number(result.rowCount || 0);
}
