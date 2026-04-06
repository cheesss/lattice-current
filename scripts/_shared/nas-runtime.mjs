import { readFileSync } from 'node:fs';

export function loadOptionalEnvFile(filePath = '.env.local') {
  try {
    const envContent = readFileSync(filePath, 'utf-8');
    for (const rawLine of envContent.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIndex = line.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = line.slice(0, eqIndex).trim();
      const value = line.slice(eqIndex + 1).trim();
      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // Optional file. Missing file is not an error.
  }
}

function firstDefinedEnv(keys) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
}

export function requireEnv(keys, message) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  const value = firstDefinedEnv(keyList);
  if (!value) {
    throw new Error(message || `Missing required environment variable: ${keyList.join(' or ')}`);
  }
  return value;
}

export function resolveNasPgConfig(overrides = {}) {
  const host = String(
    overrides.host
    || firstDefinedEnv(['INTEL_PG_HOST', 'NAS_PG_HOST', 'PG_HOST'])
    || '192.168.0.76',
  ).trim();
  const port = Number(
    overrides.port
    || firstDefinedEnv(['INTEL_PG_PORT', 'NAS_PG_PORT', 'PG_PORT'])
    || 5433,
  );
  const database = String(
    overrides.database
    || firstDefinedEnv(['INTEL_PG_DATABASE', 'NAS_PG_DATABASE', 'PG_DATABASE', 'PGDATABASE'])
    || 'lattice',
  ).trim();
  const user = String(
    overrides.user
    || firstDefinedEnv(['INTEL_PG_USER', 'NAS_PG_USER', 'PG_USER', 'PGUSER'])
    || 'postgres',
  ).trim();
  const password = String(
    overrides.password
    || firstDefinedEnv(['INTEL_PG_PASSWORD', 'NAS_PG_PASSWORD', 'PG_PASSWORD', 'PGPASSWORD']),
  ).trim();

  if (!password) {
    throw new Error(
      'Missing PostgreSQL password. Set INTEL_PG_PASSWORD, NAS_PG_PASSWORD, PG_PASSWORD, or PGPASSWORD.',
    );
  }

  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 5433,
    database,
    user,
    password,
  };
}

export function resolveOllamaEmbedConfig(overrides = {}) {
  const baseUrl = String(
    overrides.baseUrl
    || firstDefinedEnv(['OLLAMA_API_URL', 'OLLAMA_BASE_URL']),
  ).trim();
  const model = String(
    overrides.model
    || firstDefinedEnv(['OLLAMA_MODEL']),
  ).trim();

  if (!baseUrl) {
    throw new Error('Missing Ollama endpoint. Set OLLAMA_API_URL or OLLAMA_BASE_URL.');
  }
  if (!model) {
    throw new Error('Missing Ollama model. Set OLLAMA_MODEL.');
  }

  const endpoint = baseUrl.endsWith('/api/embed')
    ? baseUrl
    : `${baseUrl.replace(/\/+$/, '')}/api/embed`;

  return {
    endpoint,
    model,
  };
}

export function resolveOllamaChatConfig(overrides = {}) {
  const baseUrl = String(
    overrides.baseUrl
    || firstDefinedEnv(['OLLAMA_API_URL', 'OLLAMA_BASE_URL']),
  ).trim();
  const model = String(
    overrides.model
    || firstDefinedEnv(['OLLAMA_CHAT_MODEL', 'CODEX_MODEL', 'OLLAMA_MODEL']),
  ).trim();

  if (!baseUrl) {
    throw new Error('Missing Ollama endpoint. Set OLLAMA_API_URL or OLLAMA_BASE_URL.');
  }
  if (!model) {
    throw new Error('Missing Ollama chat model. Set OLLAMA_CHAT_MODEL or OLLAMA_MODEL.');
  }

  const endpoint = baseUrl.endsWith('/api/chat')
    ? baseUrl
    : `${baseUrl.replace(/\/+$/, '')}/api/chat`;

  return {
    endpoint,
    model,
  };
}
