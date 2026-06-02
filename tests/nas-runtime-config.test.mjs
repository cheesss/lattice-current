import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveNasPgConfig, resolveOllamaEmbedConfig } from '../scripts/_shared/nas-runtime.mjs';

function withEnv(overrides, fn) {
  const prior = new Map();
  for (const key of Object.keys(overrides)) {
    prior.set(key, process.env[key]);
    const value = overrides[key];
    if (value == null) delete process.env[key];
    else process.env[key] = String(value);
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of prior.entries()) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('NAS runtime config helpers', () => {
  it('requires a PostgreSQL password instead of falling back to a hardcoded secret', () => {
    assert.throws(() => withEnv({
      DATABASE_URL: null,
      LATTICE_PG_HOST: null,
      LATTICE_PG_PASSWORD: null,
      INTEL_PG_PASSWORD: null,
      NAS_PG_PASSWORD: null,
      PG_PASSWORD: null,
      PGPASSWORD: null,
    }, () => resolveNasPgConfig()), /Missing PostgreSQL password/);
  });

  it('resolves PostgreSQL config from env when credentials are present', () => {
    const config = withEnv({
      DATABASE_URL: null,
      LATTICE_PG_HOST: null,
      LATTICE_PG_PORT: null,
      LATTICE_PG_DATABASE: null,
      LATTICE_PG_USER: null,
      LATTICE_PG_PASSWORD: null,
      INTEL_PG_HOST: '10.0.0.2',
      INTEL_PG_PORT: '15432',
      INTEL_PG_DATABASE: 'warehouse',
      INTEL_PG_USER: 'wm',
      INTEL_PG_PASSWORD: 'secret',
    }, () => resolveNasPgConfig());

    assert.deepEqual(config, {
      host: '10.0.0.2',
      port: 15432,
      database: 'warehouse',
      user: 'wm',
      password: 'secret',
    });
  });

  it('normalizes DATABASE_URL into discrete connection fields (local demo path)', () => {
    const config = withEnv({
      DATABASE_URL: 'postgres://postgres:lattice@127.0.0.1:5432/lattice',
    }, () => resolveNasPgConfig());

    assert.deepEqual(config, {
      host: '127.0.0.1',
      port: 5432,
      database: 'lattice',
      user: 'postgres',
      password: 'lattice',
    });
  });

  it('prefers LATTICE_PG_* over INTEL_PG_*/NAS_PG_*/PG_*', () => {
    const config = withEnv({
      DATABASE_URL: null,
      LATTICE_PG_HOST: '127.0.0.1',
      LATTICE_PG_PORT: '5432',
      LATTICE_PG_DATABASE: 'lattice',
      LATTICE_PG_USER: 'postgres',
      LATTICE_PG_PASSWORD: 'lattice',
      INTEL_PG_HOST: '192.168.0.2',
      INTEL_PG_PORT: '5433',
      INTEL_PG_PASSWORD: 'nas-secret',
    }, () => resolveNasPgConfig());

    assert.deepEqual(config, {
      host: '127.0.0.1',
      port: 5432,
      database: 'lattice',
      user: 'postgres',
      password: 'lattice',
    });
  });

  it('allows a local (127.0.0.1) Postgres with no password', () => {
    const config = withEnv({
      DATABASE_URL: null,
      LATTICE_PG_HOST: '127.0.0.1',
      LATTICE_PG_PORT: '5432',
      LATTICE_PG_PASSWORD: null,
      INTEL_PG_PASSWORD: null,
      NAS_PG_PASSWORD: null,
      PG_PASSWORD: null,
      PGPASSWORD: null,
    }, () => resolveNasPgConfig());

    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.password, '');
  });

  it('still requires a password for a remote (NAS) host', () => {
    assert.throws(() => withEnv({
      DATABASE_URL: null,
      LATTICE_PG_HOST: '10.0.0.9',
      LATTICE_PG_PASSWORD: null,
      INTEL_PG_PASSWORD: null,
      NAS_PG_PASSWORD: null,
      PG_PASSWORD: null,
      PGPASSWORD: null,
    }, () => resolveNasPgConfig()), /Missing PostgreSQL password/);
  });

  it('requires Ollama endpoint and model instead of silently assuming localhost defaults', () => {
    assert.throws(() => withEnv({
      OLLAMA_API_URL: null,
      OLLAMA_BASE_URL: null,
      OLLAMA_MODEL: null,
    }, () => resolveOllamaEmbedConfig()), /Missing Ollama endpoint/);
  });

  it('normalizes Ollama embed endpoint from env', () => {
    const config = withEnv({
      OLLAMA_API_URL: 'http://10.0.0.5:11434',
      OLLAMA_MODEL: 'nomic-embed-text',
    }, () => resolveOllamaEmbedConfig());

    assert.deepEqual(config, {
      endpoint: 'http://10.0.0.5:11434/api/embed',
      model: 'nomic-embed-text',
    });
  });
});
