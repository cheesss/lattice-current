import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { repoPath } from './_workspace-paths.mjs';

describe('signal-first product surface guardrails', () => {
  it('promotes signal-first panels and demotes replay validation in panel defaults', () => {
    const source = readFileSync(repoPath('src/config/panels.ts'), 'utf8');
    assert.equal(source.includes("'event-intelligence': { name: 'Event Intelligence', enabled: true, priority: 1 }"), true);
    assert.equal(source.includes("'source-ops': { name: 'Source Operations', enabled: true, priority: 1 }"), true);
    assert.equal(source.includes("'investment-workflow': { name: 'Decision Workflow', enabled: true, priority: 2 }"), true);
    assert.equal(source.includes("'investment-ideas': { name: 'Signal Candidates', enabled: true, priority: 2 }"), true);
    assert.equal(source.includes("'backtest-lab': { name: 'Replay Validation', enabled: false, priority: 3 }"), true);
  });

  it('reframes workspaces around signal and decision support instead of replay-first workflows', () => {
    const source = readFileSync(repoPath('src/config/workspaces.ts'), 'utf8');
    assert.equal(source.includes("featuredPanels: ['live-news', 'insights', 'event-intelligence', 'macro-signals']"), true);
    assert.equal(source.includes("title: 'Decision Workspace'"), true);
    assert.equal(source.includes("featuredPanels: ['macro-signals', 'event-intelligence', 'investment-workflow', 'investment-ideas']"), true);
    assert.equal(source.includes("featuredPanels: ['dataflow-ops', 'source-ops', 'runtime-config', 'resource-profiler']"), true);
  });
});
