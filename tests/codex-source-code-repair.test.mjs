import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCodexSourceCodeRepairPrompt,
  queueCodexSourceCodeRepair,
} from '../scripts/_shared/codex-source-code-repair.mjs';

function makeProbe(nextAction = 'manual-adapter') {
  return {
    inputUrl: 'https://example.com/',
    resolvedUrl: 'https://example.com/',
    connectorKind: 'manual',
    nextAction,
    qualityScore: 0,
    qualityBreakdown: { recentItemCount: 0 },
    errors: [{ adapter: 'html-list', message: 'selector failed' }],
    warnings: [],
    traceId: 'probe-test',
  };
}

test('buildCodexSourceCodeRepairPrompt restricts agent and write scope', () => {
  const prompt = buildCodexSourceCodeRepairPrompt({
    url: 'https://example.com/',
    theme: 'defense',
    name: 'Example source',
    reason: 'manual adapter needed',
    probe: makeProbe(),
    rootCause: {
      category: 'adapter-gap',
      summary: 'selector failed in html-list',
      failedAdapters: ['html-list'],
    },
  });

  assert.match(prompt, /You are Codex/);
  assert.match(prompt, /Do not use Claude Code/);
  assert.match(prompt, /scripts\/_shared\/source-probe\.mjs/);
  assert.match(prompt, /tests\/source-probe\.test\.mjs/);
  assert.match(prompt, /Do not commit or push/);
  assert.match(prompt, /node --test tests\/source-probe\.test\.mjs/);
  assert.match(prompt, /Structured root-cause analysis JSON/);
  assert.match(prompt, /adapter-gap/);
  assert.match(prompt, /selector failed in html-list/);
});

test('queueCodexSourceCodeRepair queues manual-adapter and reject probes', async () => {
  const result = await queueCodexSourceCodeRepair({
    url: 'https://example.com/',
    theme: 'general',
    probe: makeProbe('reject'),
    dryRun: true,
  });

  assert.equal(result.queued, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.nextAction, 'reject');
});

test('queueCodexSourceCodeRepair skips non-repairable probe actions', async () => {
  const result = await queueCodexSourceCodeRepair({
    url: 'https://example.com/',
    theme: 'general',
    probe: makeProbe('register'),
  });

  assert.equal(result.queued, false);
  assert.match(result.reason, /register/);
});

test('queueCodexSourceCodeRepair respects disable switch', async () => {
  const previous = process.env.SOURCE_CODE_REPAIR_CODEX_ENABLED;
  process.env.SOURCE_CODE_REPAIR_CODEX_ENABLED = 'false';
  try {
    const result = await queueCodexSourceCodeRepair({
      url: 'https://example.com/',
      theme: 'general',
      probe: makeProbe(),
    });

    assert.equal(result.queued, false);
    assert.equal(result.reason, 'SOURCE_CODE_REPAIR_CODEX_ENABLED=false');
  } finally {
    if (previous == null) delete process.env.SOURCE_CODE_REPAIR_CODEX_ENABLED;
    else process.env.SOURCE_CODE_REPAIR_CODEX_ENABLED = previous;
  }
});
