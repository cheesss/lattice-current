import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/generate-codex-theme-proposals.mjs', import.meta.url), 'utf-8');

test('generate-codex-theme-proposals wires codex theme creation with budget and proposal persistence', () => {
  assert.match(source, /runCodexJsonPrompt/);
  assert.match(source, /buildThemeProposalEvidence/);
  assert.match(source, /buildCompactThemePrompt/);
  assert.match(source, /normalizeThemeProposal/);
  assert.match(source, /normalizeThemeAttachment/);
  assert.match(source, /checkBudget\(client, 'codexCalls', 1\)/);
  assert.match(source, /consumeBudget\(client, 'codexCalls', 1/);
  assert.match(source, /INSERT INTO codex_proposals \(proposal_type, payload, status, reasoning, source\)/);
  assert.match(source, /'add-theme'/);
  assert.match(source, /'attach-theme'/);
  assert.match(source, /sourceTopicId/);
  assert.match(source, /topic-discovery-theme/);
  assert.match(source, /attachedCount/);
  assert.match(source, /attachmentKey/);
  assert.match(source, /targetTheme/);
});

test('generate-codex-theme-proposals filters discovery topics toward high-signal labeled candidates', () => {
  assert.match(source, /promotion_state IN \('watch', 'canonical'\)/);
  assert.match(source, /status IN \('labeled', 'reported'\)/);
  assert.match(source, /investmentRelevance/);
  assert.match(source, /GENERIC_NORMALIZED_THEMES/);
  assert.match(source, /SPECIALIZED_LABEL_CATEGORIES/);
  assert.match(source, /proposal_type IN \('add-theme', 'attach-theme'\)/);
});
