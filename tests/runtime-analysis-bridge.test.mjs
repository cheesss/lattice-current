import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { repoPath } from './_workspace-paths.mjs';

describe('runtime analysis bridge guardrails', () => {
  it('data-loader does not statically import pg-backed ingestion modules', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(repoPath('src/app/data-loader.ts'), 'utf8');
    assert.equal(source.includes("@/services/article-ingestor"), false);
    assert.equal(source.includes("@/services/signal-history-updater"), false);
    assert.equal(source.includes("@/services/analysis-runtime-bridge"), true);
  });

  it('runtime bridge isolates browser code from pg imports', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(repoPath('src/services/analysis-runtime-bridge.ts'), 'utf8');
    assert.equal(source.includes('/api/local-analysis-engine'), true);
    assert.equal(source.includes("from 'pg'"), false);
    assert.equal(source.includes('article-ingestor'), false);
    assert.equal(source.includes('signal-history-updater'), false);
  });

  it('runtime-config does not poll local runtime secrets unless a local API base is present', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(repoPath('src/services/runtime-config.ts'), 'utf8');
    assert.equal(source.includes('function shouldHydrateBrowserSecretsFromLocalSidecar()'), true);
    assert.equal(source.includes('return Boolean(getApiBaseUrl());'), true);
  });
});
