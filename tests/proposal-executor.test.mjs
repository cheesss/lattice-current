import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

describe('proposal-executor', () => {
  it('script file exists and is valid JavaScript', () => {
    const content = readFileSync('scripts/proposal-executor.mjs', 'utf-8');
    assert.ok(content.includes('executeProposal'));
    assert.ok(content.includes('handleAddSymbol'));
    assert.ok(content.includes('handleAddRss'));
    assert.ok(content.includes('handleAddTheme'));
    assert.ok(content.includes('handleValidate'));
    assert.ok(content.includes('handleRemoveSymbol'));
  });
  it('supports all 5 proposal types', () => {
    const content = readFileSync('scripts/proposal-executor.mjs', 'utf-8');
    assert.ok(content.includes("'add-symbol'"));
    assert.ok(content.includes("'add-rss'"));
    assert.ok(content.includes("'add-theme'"));
    assert.ok(content.includes("'validate'"));
    assert.ok(content.includes("'remove-symbol'"));
  });
  it('creates codex_proposals table', () => {
    const content = readFileSync('scripts/proposal-executor.mjs', 'utf-8');
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS codex_proposals'));
  });
});
