import { applySchemaMigrations } from './schema-migrations';
import { resolveSchemaVersion, resolveStorageSource } from './schema-registry';

export interface StorageEnvelope<T> {
  schemaVersion: number;
  createdAt: string;
  expiresAt: string;
  source: string;
  origin: 'seed' | 'live' | 'unknown';
  checksum: string;
  data: T;
}

export interface StorageEnvelopeOptions {
  source: string;
  ttlMs?: number;
  createdAt?: string | Date;
  schemaVersion?: number;
  origin?: 'seed' | 'live' | 'unknown';
}

export interface DecodedStorageValue<T> {
  data: T | null;
  envelope: StorageEnvelope<T> | null;
  legacy: boolean;
  migrated: boolean;
  schemaVersion: number;
  expired: boolean;
  checksumVerified: boolean;
  error?: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj).sort().reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = stableValue(obj[key]);
      return acc;
    }, {});
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

async function sha256Hex(input: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const encoded = new TextEncoder().encode(input);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(input).digest('hex');
}

export async function computeStorageChecksum(data: unknown): Promise<string> {
  return sha256Hex(stableStringify(data));
}

function inferEnvelopeOrigin(source: string): 'seed' | 'live' | 'unknown' {
  if (/^seed-|^bootstrap-|^seismology:|^market:|^economic:|^conflict:|^positive-events:/.test(source)) {
    return 'seed';
  }
  if (/^historical-|^backtest-|^replay-|^source-score|^mapping-stat/.test(source)) {
    return 'live';
  }
  return 'unknown';
}

export function isStorageEnvelope<T>(value: unknown): value is StorageEnvelope<T> {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.schemaVersion === 'number'
    && typeof obj.createdAt === 'string'
    && typeof obj.expiresAt === 'string'
    && typeof obj.source === 'string'
    && typeof obj.checksum === 'string'
    && 'data' in obj;
}

export async function createStorageEnvelope<T>(
  data: T,
  options: StorageEnvelopeOptions,
): Promise<StorageEnvelope<T>> {
  const source = resolveStorageSource(options.source);
  const schemaVersion = options.schemaVersion ?? resolveSchemaVersion(source);
  const createdAtDate = options.createdAt ? new Date(options.createdAt) : new Date();
  const createdAt = createdAtDate.toISOString();
  const ttlMs = Math.max(0, options.ttlMs ?? 0);
  const expiresAt = ttlMs > 0 ? new Date(createdAtDate.getTime() + ttlMs).toISOString() : '';
  const checksum = await computeStorageChecksum(data);
  return {
    schemaVersion,
    createdAt,
    expiresAt,
    source,
    origin: options.origin ?? inferEnvelopeOrigin(source),
    checksum,
    data,
  };
}

export async function decodeStorageValue<T>(
  value: unknown,
  options: { source?: string } = {},
): Promise<DecodedStorageValue<T>> {
  const source = resolveStorageSource(options.source);
  const targetSchemaVersion = resolveSchemaVersion(source);

  if (!isStorageEnvelope<T>(value)) {
    let migrated;
    try {
      migrated = applySchemaMigrations(source, 0, value);
    } catch (error) {
      return {
        data: null,
        envelope: null,
        legacy: true,
        migrated: false,
        schemaVersion: 0,
        expired: false,
        checksumVerified: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const envelope = await createStorageEnvelope(migrated.data as T, {
      source,
      schemaVersion: migrated.version,
      ttlMs: 0,
    });
    return {
      data: migrated.data as T,
      envelope,
      legacy: true,
      migrated: migrated.migrated,
      schemaVersion: migrated.version,
      expired: false,
      checksumVerified: true,
    };
  }

  const expectedChecksum = await computeStorageChecksum(value.data);
  if (expectedChecksum !== value.checksum) {
    return {
      data: null,
      envelope: value,
      legacy: false,
      migrated: false,
      schemaVersion: value.schemaVersion,
      expired: false,
      checksumVerified: false,
      error: `Checksum mismatch for ${value.source}`,
    };
  }

  const expired = Boolean(value.expiresAt) && Number.isFinite(Date.parse(value.expiresAt)) && Date.parse(value.expiresAt) <= Date.now();
  if (expired) {
    return {
      data: null,
      envelope: value,
      legacy: false,
      migrated: false,
      schemaVersion: value.schemaVersion,
      expired: true,
      checksumVerified: true,
      error: `Envelope expired for ${value.source}`,
    };
  }

  if (value.source !== source || value.schemaVersion !== targetSchemaVersion) {
    let migrated;
    try {
      migrated = applySchemaMigrations(source, value.schemaVersion, value.data);
    } catch (error) {
      return {
        data: null,
        envelope: value,
        legacy: false,
        migrated: false,
        schemaVersion: value.schemaVersion,
        expired: false,
        checksumVerified: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const envelope = await createStorageEnvelope(migrated.data as T, {
      source,
      schemaVersion: migrated.version,
      createdAt: value.createdAt,
      ttlMs: value.expiresAt
        ? Math.max(0, new Date(value.expiresAt).getTime() - new Date(value.createdAt).getTime())
        : 0,
      origin: value.origin ?? inferEnvelopeOrigin(source),
    });
    return {
      data: migrated.data as T,
      envelope,
      legacy: false,
      migrated: migrated.migrated || value.source !== source,
      schemaVersion: migrated.version,
      expired: false,
      checksumVerified: true,
    };
  }

  return {
    data: value.data,
    envelope: value,
    legacy: false,
    migrated: false,
    schemaVersion: value.schemaVersion,
    expired: false,
    checksumVerified: true,
  };
}
