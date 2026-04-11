import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { getThemeConfig } from '../scripts/_shared/theme-taxonomy.mjs';

const EVALUATION_ROOT = new URL('../data/evaluation-set/', import.meta.url);
const VALID_PERIODS = new Set(['week', 'month', 'quarter', 'year']);
const VALID_CATEGORIES = new Set(['technology', 'science', 'macro', 'geopolitics', 'environment', 'society', 'health', 'other']);

async function readJsonFile(fileUrl) {
  return JSON.parse(await readFile(fileUrl, 'utf8'));
}

async function listJsonFiles(directoryUrl) {
  const directoryPath = fileURLToPath(directoryUrl);
  const entries = await readdir(directoryPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => new URL(entry.name, directoryUrl));
}

test('evaluation taxonomy coverage scaffold is well-formed', async () => {
  const payload = await readJsonFile(new URL('./taxonomy-coverage/article-theme-labels.golden.json', EVALUATION_ROOT));
  assert.equal(typeof payload.reviewStatus, 'string');
  assert.ok(Number.isInteger(payload.targetSampleSize));
  assert.ok(Array.isArray(payload.items));
  assert.ok(payload.items.length >= 1);
  for (const item of payload.items) {
    assert.equal(typeof item.title, 'string');
    assert.equal(typeof item.expectedTheme, 'string');
    assert.ok(getThemeConfig(item.expectedTheme), `unknown canonical theme ${item.expectedTheme}`);
    assert.equal(typeof item.expectedParentTheme, 'string');
    assert.ok(VALID_CATEGORIES.has(item.expectedCategory), `unexpected category ${item.expectedCategory}`);
  }
});

test('evaluation discovery quality scaffolds are well-formed', async () => {
  const files = await listJsonFiles(new URL('./discovery-quality/', EVALUATION_ROOT));
  assert.ok(files.length >= 2);
  for (const file of files) {
    const payload = await readJsonFile(file);
    assert.equal(typeof payload.reviewStatus, 'string');
    assert.ok(Array.isArray(payload.items));
    for (const item of payload.items) {
      assert.equal(typeof item.label, 'string');
      assert.equal(typeof item.expectedDisposition, 'string');
      assert.ok(['suppressed', 'watch', 'canonical'].includes(item.expectedDisposition));
      assert.ok(
        typeof item.reason === 'string' || typeof item.rationale === 'string',
        `discovery scaffold ${file.href} needs reason or rationale`,
      );
    }
  }
});

test('evaluation theme brief goldens carry the Theme Brief contract scaffolds', async () => {
  const files = await listJsonFiles(new URL('./theme-briefs/', EVALUATION_ROOT));
  assert.ok(files.length >= 2);
  for (const file of files) {
    const payload = await readJsonFile(file);
    assert.equal(typeof payload.theme, 'string');
    assert.ok(getThemeConfig(payload.theme), `unknown canonical theme ${payload.theme}`);
    assert.ok(VALID_PERIODS.has(payload.periodType), `unexpected period ${payload.periodType}`);
    assert.equal(typeof payload.reviewStatus, 'string');
    assert.equal(typeof payload.sections, 'object');
    assert.ok(Array.isArray(payload.sections.whatChanged));
    assert.ok(
      Array.isArray(payload.sections.whyItMatters)
      || typeof payload.sections.whyItMatters === 'object',
      `whyItMatters contract missing for ${payload.theme}`,
    );
    assert.equal(typeof payload.sections.evidence, 'object');
    assert.ok(Array.isArray(payload.sections.subtopicMovement));
    assert.ok(
      Array.isArray(payload.sections.relatedEntities)
      || typeof payload.sections.relatedEntities === 'object',
      `relatedEntities contract missing for ${payload.theme}`,
    );
    assert.ok(Array.isArray(payload.sections.risks));
    assert.ok(Array.isArray(payload.sections.watchpoints));
    assert.equal(typeof payload.sections.notebookHooks, 'object');
  }
});

test('evaluation theme proposal flow scaffold covers propose, attach, and reject contracts', async () => {
  const payload = await readJsonFile(new URL('./theme-proposals/proposal-decision-flow.golden.json', EVALUATION_ROOT));
  assert.equal(typeof payload.reviewStatus, 'string');
  assert.equal(payload.datasetType, 'theme-proposal-decision-flow');
  assert.ok(Array.isArray(payload.items));
  assert.ok(payload.items.length >= 3);

  const decisions = new Set();
  for (const item of payload.items) {
    assert.equal(typeof item.topicLabel, 'string');
    assert.ok(['propose', 'attach', 'reject'].includes(item.expectedDecision));
    assert.ok(Array.isArray(item.promptMustCover));
    assert.ok(item.promptMustCover.length >= 2);
    decisions.add(item.expectedDecision);

    if (item.expectedDecision === 'propose') {
      assert.equal(typeof item.expectedThemeId, 'string');
      assert.ok(Number.isInteger(item.minAssetCount));
      assert.ok(Array.isArray(item.requiredFields));
    }

    if (item.expectedDecision === 'attach') {
      assert.equal(typeof item.expectedTargetTheme, 'string');
      assert.ok(getThemeConfig(item.expectedTargetTheme), `unknown canonical target theme ${item.expectedTargetTheme}`);
      assert.equal(typeof item.expectedRelationType, 'string');
      assert.ok(Number.isInteger(item.minAssetCount));
    }

    if (item.expectedDecision === 'reject') {
      assert.equal(typeof item.rejectionReasonCategory, 'string');
      assert.ok(Array.isArray(item.mustNullPaths));
      assert.ok(item.mustNullPaths.length >= 2);
    }
  }

  assert.deepEqual(Array.from(decisions).sort(), ['attach', 'propose', 'reject']);
});
