/**
 * State Migration — Phase 9
 *
 * Manages schema versioning, state migration between storage backends,
 * and ensures transactional consistency for stateful workloads.
 * Bridges the gap between stateless infrastructure (Vercel/Redis)
 * and stateful application requirements.
 */

import type { StateStore } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Schema version metadata attached to state keys. */
export interface SchemaVersion {
  major: number;
  minor: number;
  patch: number;
  migratedAt: string;
}

/** A state key with its schema version. */
export interface VersionedStateKey {
  key: string;
  schemaVersion: SchemaVersion;
  storageBackend: 'redis' | 'postgres' | 'memory';
  category: 'learning' | 'snapshot' | 'cache' | 'audit' | 'evaluation';
}

/** Migration definition from one version to another. */
export interface StateMigration {
  id: string;
  description: string;
  fromVersion: SchemaVersion;
  toVersion: SchemaVersion;
  keys: string[];
  migrate: (data: unknown) => unknown;
}

/** Result of a migration run. */
export interface MigrationResult {
  migrationId: string;
  success: boolean;
  keysProcessed: number;
  keysFailed: number;
  errors: Array<{ key: string; error: string }>;
  durationMs: number;
  beforeSnapshot: string;  // snapshot ID
  afterSnapshot: string;   // snapshot ID
}

/** Storage tier classification for state keys. */
export interface StorageTierConfig {
  /** Learning state → PostgreSQL (persistent). */
  learning: StorageTierEntry[];
  /** Decision snapshots → PostgreSQL (persistent). */
  audit: StorageTierEntry[];
  /** Real-time cache → Redis (ephemeral). */
  cache: StorageTierEntry[];
  /** Evaluation results → PostgreSQL (persistent). */
  evaluation: StorageTierEntry[];
}

export interface StorageTierEntry {
  keyPattern: string;
  description: string;
  ttlSeconds: number | null; // null = permanent
  priority: 'critical' | 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Schema Version Utilities
// ---------------------------------------------------------------------------

export const CURRENT_SCHEMA_VERSION: SchemaVersion = {
  major: 2,
  minor: 0,
  patch: 0,
  migratedAt: new Date().toISOString(),
};

/** Compare two schema versions. Returns -1, 0, or 1. */
export function compareVersions(a: SchemaVersion, b: SchemaVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/** Format version as string. */
export function formatVersion(v: SchemaVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/** Parse version string. */
export function parseVersion(s: string): SchemaVersion {
  const parts = s.split('.').map(Number);
  return {
    major: parts[0] ?? 0,
    minor: parts[1] ?? 0,
    patch: parts[2] ?? 0,
    migratedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Default Storage Tier Configuration
// ---------------------------------------------------------------------------

export const DEFAULT_STORAGE_TIERS: StorageTierConfig = {
  learning: [
    { keyPattern: 'conviction-model-state', description: 'Conviction model weights and metadata', ttlSeconds: null, priority: 'critical' },
    { keyPattern: 'bandit-states', description: 'Contextual bandit arm states', ttlSeconds: null, priority: 'critical' },
    { keyPattern: 'mapping-stats', description: 'Mapping performance statistics', ttlSeconds: null, priority: 'high' },
    { keyPattern: 'tracked-ideas', description: 'Currently tracked idea states', ttlSeconds: null, priority: 'critical' },
    { keyPattern: 'market-history', description: 'Historical market data index', ttlSeconds: null, priority: 'high' },
  ],
  audit: [
    { keyPattern: 'decision-snapshot-*', description: 'Per-idea decision snapshots', ttlSeconds: 90 * 86400, priority: 'high' },
    { keyPattern: 'audit-report-*', description: 'Periodic audit reports', ttlSeconds: 365 * 86400, priority: 'medium' },
  ],
  cache: [
    { keyPattern: 'current-snapshot', description: 'Latest intelligence snapshot (UI)', ttlSeconds: 3600, priority: 'medium' },
    { keyPattern: 'frame-*', description: 'Active frame data', ttlSeconds: 1800, priority: 'low' },
    { keyPattern: 'market-chart-*', description: 'Chart data cache', ttlSeconds: 900, priority: 'low' },
  ],
  evaluation: [
    { keyPattern: 'evaluation-run-*', description: 'Evaluation run results', ttlSeconds: null, priority: 'medium' },
    { keyPattern: 'walk-forward-*', description: 'Walk-forward validation results', ttlSeconds: null, priority: 'medium' },
  ],
};

// ---------------------------------------------------------------------------
// State Migration Manager
// ---------------------------------------------------------------------------

export class StateMigrationManager {
  private migrations: StateMigration[] = [];
  private appliedMigrations = new Set<string>();
  private currentVersion: SchemaVersion;

  constructor(currentVersion: SchemaVersion = CURRENT_SCHEMA_VERSION, autoRegisterDefaults = false) {
    this.currentVersion = currentVersion;
    if (autoRegisterDefaults) {
      for (const migration of DEFAULT_MIGRATIONS) {
        this.registerMigration(migration);
      }
    }
  }

  /** Register a migration. */
  registerMigration(migration: StateMigration): void {
    this.migrations.push(migration);
    // Keep sorted by fromVersion
    this.migrations.sort((a: StateMigration, b: StateMigration) =>
      compareVersions(a.fromVersion, b.fromVersion),
    );
  }

  /** Get all pending migrations for a given version. */
  getPendingMigrations(fromVersion: SchemaVersion): StateMigration[] {
    return this.migrations.filter((m: StateMigration) =>
      compareVersions(m.fromVersion, fromVersion) >= 0 &&
      compareVersions(m.toVersion, this.currentVersion) <= 0 &&
      !this.appliedMigrations.has(m.id),
    );
  }

  /**
   * Run all pending migrations on a state store.
   * Wraps each migration in a snapshot-restore transaction for safety.
   */
  async runMigrations(
    store: StateStore,
    fromVersion: SchemaVersion,
  ): Promise<MigrationResult[]> {
    const pending = this.getPendingMigrations(fromVersion);
    const results: MigrationResult[] = [];

    for (const migration of pending) {
      const startTime = Date.now();
      const beforeSnap = await store.snapshot();
      const errors: Array<{ key: string; error: string }> = [];
      let keysProcessed = 0;

      try {
        for (const key of migration.keys) {
          try {
            const value = await store.get(key);
            if (value !== null) {
              const migrated = migration.migrate(value);
              await store.set(key, migrated);
              keysProcessed++;
            }
          } catch (err) {
            errors.push({ key, error: String(err) });
          }
        }

        const afterSnap = await store.snapshot();

        if (errors.length > 0 && errors.length === migration.keys.length) {
          // All keys failed → rollback
          await store.restore(beforeSnap);
          results.push({
            migrationId: migration.id,
            success: false,
            keysProcessed: 0,
            keysFailed: errors.length,
            errors,
            durationMs: Date.now() - startTime,
            beforeSnapshot: beforeSnap.id,
            afterSnapshot: beforeSnap.id,
          });
        } else {
          this.appliedMigrations.add(migration.id);
          results.push({
            migrationId: migration.id,
            success: true,
            keysProcessed,
            keysFailed: errors.length,
            errors,
            durationMs: Date.now() - startTime,
            beforeSnapshot: beforeSnap.id,
            afterSnapshot: afterSnap.id,
          });
        }
      } catch (err) {
        await store.restore(beforeSnap);
        results.push({
          migrationId: migration.id,
          success: false,
          keysProcessed: 0,
          keysFailed: migration.keys.length,
          errors: [{ key: '*', error: String(err) }],
          durationMs: Date.now() - startTime,
          beforeSnapshot: beforeSnap.id,
          afterSnapshot: beforeSnap.id,
        });
      }
    }

    return results;
  }

  /** Check if a migration has been applied. */
  isMigrationApplied(migrationId: string): boolean {
    return this.appliedMigrations.has(migrationId);
  }

  /** Get current schema version. */
  getVersion(): SchemaVersion {
    return { ...this.currentVersion };
  }
}

// ---------------------------------------------------------------------------
// Storage Tier Resolver
// ---------------------------------------------------------------------------

/**
 * Determine which storage backend a key should use.
 */
export function resolveStorageTier(
  key: string,
  config: StorageTierConfig = DEFAULT_STORAGE_TIERS,
): { category: string; backend: 'postgres' | 'redis'; entry: StorageTierEntry } | null {
  for (const [category, entries] of Object.entries(config)) {
    for (const entry of entries as StorageTierEntry[]) {
      if (matchesKeyPattern(key, entry.keyPattern)) {
        const backend = category === 'cache' ? 'redis' as const : 'postgres' as const;
        return { category, backend, entry };
      }
    }
  }
  return null;
}

/** Simple glob-like pattern matching for state keys. */
function matchesKeyPattern(key: string, pattern: string): boolean {
  if (pattern.endsWith('*')) {
    return key.startsWith(pattern.slice(0, -1));
  }
  return key === pattern;
}

// ---------------------------------------------------------------------------
// Default Migrations
// ---------------------------------------------------------------------------

/**
 * v1.0.0 → v2.0.0: CacheEnvelope unwrapping.
 * Old format: { data: T, timestamp: number, expiresAt: number | null }
 * New format: T (direct value)
 */
export const DEFAULT_MIGRATIONS: StateMigration[] = [
  {
    id: 'v1-to-v2-unwrap-envelope',
    description: 'Unwrap CacheEnvelope { data: T } to direct T values',
    fromVersion: { major: 1, minor: 0, patch: 0, migratedAt: '' },
    toVersion: { major: 2, minor: 0, patch: 0, migratedAt: '' },
    keys: [
      'investment-intelligence:snapshot',
      'investment-intelligence:history',
      'investment-intelligence:tracked-ideas',
      'investment-intelligence:market-history',
      'investment-intelligence:mapping-stats',
      'investment-intelligence:bandit-states',
      'investment-intelligence:candidate-reviews',
      'investment-intelligence:universe-policy',
      'investment-intelligence:conviction-model',
    ],
    migrate: (data: unknown): unknown => {
      // If data is wrapped in a CacheEnvelope, unwrap it
      if (data && typeof data === 'object' && 'data' in data) {
        return (data as { data: unknown }).data;
      }
      return data;
    },
  },
];
