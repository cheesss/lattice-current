import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ARCHIVE_RE } from '../src/services/investment/constants.ts';
import { getRagRuntimeStatus } from '../src/services/investment/rag-retriever.ts';

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

describe('investment source filtering guardrails', () => {
  it('keeps retrospective anniversary language in the archive reject regex', () => {
    assert.equal(ARCHIVE_RE.test('15 years after the crisis, markets still feel the shock'), true);
    assert.equal(ARCHIVE_RE.test('anniversary look back at the 2011 oil spike'), true);
  });

  it('does not reject current news solely because the title mentions a publisher archive', () => {
    assert.equal(ARCHIVE_RE.test('From the Guardian archive: shipping disruption echoes in today\'s freight market'), false);
    assert.equal(ARCHIVE_RE.test('Guardian archive analysis says chip export controls tighten again today'), false);
  });

  it('requires explicit Ollama config before enabling RAG', () => {
    const status = withEnv({
      RAG_PG_URL: 'postgres://wm:secret@10.0.0.2:5432/lattice',
      OLLAMA_API_URL: null,
      OLLAMA_BASE_URL: null,
      OLLAMA_MODEL: null,
    }, () => getRagRuntimeStatus());

    assert.equal(status.databaseConfigured, true);
    assert.equal(status.embeddingConfigured, false);
    assert.equal(status.enabled, false);
    assert.match(String(status.reason || ''), /Ollama embedding config is missing/);
  });
});
