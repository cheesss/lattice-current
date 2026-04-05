import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test that the module exports the expected functions
describe('article-ingestor', () => {
  it('exports ingestArticle function', async () => {
    const mod = await import('../src/services/article-ingestor.ts');
    assert.equal(typeof mod.ingestArticle, 'function');
  });
  it('exports ingestArticleBatch function', async () => {
    const mod = await import('../src/services/article-ingestor.ts');
    assert.equal(typeof mod.ingestArticleBatch, 'function');
  });
  it('exports checkPendingOutcomes function', async () => {
    const mod = await import('../src/services/article-ingestor.ts');
    assert.equal(typeof mod.checkPendingOutcomes, 'function');
  });
  it('exports getIngestorStats function', async () => {
    const mod = await import('../src/services/article-ingestor.ts');
    assert.equal(typeof mod.getIngestorStats, 'function');
  });
});
