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
      INTEL_PG_PASSWORD: null,
      NAS_PG_PASSWORD: null,
      PG_PASSWORD: null,
      PGPASSWORD: null,
    }, () => resolveNasPgConfig()), /Missing PostgreSQL password/);
  });

  it('resolves PostgreSQL config from env when credentials are present', () => {
    const config = withEnv({
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
