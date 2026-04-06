import { resolveSchemaVersion, resolveStorageSource } from './schema-registry';

export type MigrationFn = (data: unknown) => unknown;

export const MIGRATIONS: Record<string, Record<number, MigrationFn>> = {
  'seed-earthquakes': {
    0: (data) => data,
    1: (data) => {
      if (!data || typeof data !== 'object') return data;
      const obj = data as Record<string, unknown>;
      if (Array.isArray(obj.events)) {
        return {
          ...obj,
          events: obj.events.map((event) => (
            event && typeof event === 'object' && !('magnitude_type' in (event as Record<string, unknown>))
              ? { ...(event as Record<string, unknown>), magnitude_type: 'ml' }
              : event
          )),
        };
      }
      return obj;
    },
  },
  'replay-frame': {
    1: (data) => data,
    2: (data) => {
      if (!data || typeof data !== 'object') return data;
      const obj = data as Record<string, unknown>;
      return {
        ...obj,
        replayMode: obj.replayMode || 'bitemporal',
      };
    },
  },
};

export function applySchemaMigrations(
  sourceOrKey: string,
  fromVersion: number,
  data: unknown,
): { data: unknown; version: number; migrated: boolean } {
  const source = resolveStorageSource(sourceOrKey);
  const targetVersion = resolveSchemaVersion(source);
  if (fromVersion >= targetVersion) {
    return { data, version: fromVersion, migrated: false };
  }

  let currentData = data;
  let currentVersion = fromVersion;
  let migrated = false;

  while (currentVersion < targetVersion) {
    const migration = MIGRATIONS[source]?.[currentVersion];
    if (!migration) {
      throw new Error(`No schema migration from v${currentVersion} for ${source}`);
    }
    currentData = migration(currentData);
    currentVersion += 1;
    migrated = true;
  }

  return { data: currentData, version: currentVersion, migrated };
}
