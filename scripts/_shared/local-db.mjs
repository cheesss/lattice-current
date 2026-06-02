// Shared helpers for the local Postgres demo tooling (init + seed).
//
// SAFETY: these helpers refuse to run against a non-local host so the demo schema
// and seed can never be accidentally written to the maintainer's NAS Postgres.
// Point at the local database via DATABASE_URL or LATTICE_PG_HOST=127.0.0.1
// (see .env.example). Set LATTICE_ALLOW_REMOTE_DB=1 only to deliberately override.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './nas-runtime.mjs';

const REPO_ROOT = new URL('../../', import.meta.url);

export function repoFile(relPath) {
  return fileURLToPath(new URL(relPath, REPO_ROOT));
}

export function assertLocalDatabase(config) {
  const host = String(config.host || '').trim();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const forced = process.env.LATTICE_ALLOW_REMOTE_DB === '1';
  if (!isLocal && !forced) {
    throw new Error(
      `Refusing to run local DB tooling against a non-local host (${host || 'unset'}).\n`
      + 'This guard prevents accidentally writing the demo schema/seed to the NAS.\n'
      + 'For the local demo set DATABASE_URL=postgres://postgres:lattice@127.0.0.1:5432/lattice\n'
      + 'or LATTICE_PG_HOST=127.0.0.1 in .env.local (see .env.example).\n'
      + 'To override deliberately, set LATTICE_ALLOW_REMOTE_DB=1.',
    );
  }
  return { host, isLocal };
}

function hasExplicitDbEnv() {
  return Boolean(
    process.env.DATABASE_URL
    || process.env.LATTICE_PG_HOST
    || process.env.INTEL_PG_HOST
    || process.env.NAS_PG_HOST
    || process.env.PG_HOST,
  );
}

// Resolve the connection for the local demo tooling.
// Zero-config (no DB env set anywhere) -> the bundled docker-compose defaults
// (127.0.0.1:5432 / lattice / postgres / lattice), so `npm run demo:seed` works
// immediately after `docker compose up -d` with no .env.local editing.
// If the user set DATABASE_URL / LATTICE_PG_* / a NAS host explicitly, honor it
// (and assertLocalDatabase still refuses a non-local host).
export function resolveLocalDemoConfig() {
  loadOptionalEnvFile('.env.local');
  if (!hasExplicitDbEnv()) {
    return {
      host: '127.0.0.1',
      port: Number(process.env.LATTICE_PG_PORT || 5432),
      database: process.env.LATTICE_PG_DATABASE || 'lattice',
      user: process.env.LATTICE_PG_USER || 'postgres',
      password: process.env.LATTICE_PG_PASSWORD || 'lattice',
    };
  }
  return resolveNasPgConfig();
}

// Build a libpq connection URL from a resolved config. Used to hand the local
// connection down to spawned child scripts (which resolve their own config and
// now honor DATABASE_URL), so every demo step targets the SAME local database.
export function toDatabaseUrl(config) {
  const auth = config.password
    ? `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}`
    : encodeURIComponent(config.user);
  return `postgres://${auth}@${config.host}:${config.port}/${encodeURIComponent(config.database)}`;
}

export async function withLocalClient(fn) {
  const config = resolveLocalDemoConfig();
  assertLocalDatabase(config);
  const client = new pg.Client(config);
  await client.connect();
  try {
    return await fn(client, config);
  } finally {
    await client.end();
  }
}

export async function applySqlFile(client, relPath) {
  const sql = readFileSync(repoFile(relPath), 'utf-8');
  await client.query(sql);
}
