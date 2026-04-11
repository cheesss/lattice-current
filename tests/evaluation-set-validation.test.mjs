import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listEvaluationSetJson,
  summarizeFileCollection,
  validateDiscoveryQualityPayload,
  validateFileCollection,
  validateTaxonomyCoveragePayload,
  validateThemeBriefPayload,
  validateThemeProposalFlowPayload,
} from './_evaluation-set-validator.mjs';

test('taxonomy coverage gold file has required v0 fields', () => {
  const files = listEvaluationSetJson('data/evaluation-set/taxonomy-coverage');
  validateFileCollection(files, validateTaxonomyCoveragePayload);

  assert.deepEqual(summarizeFileCollection(files), ['article-theme-labels.golden.json']);
});

test('discovery quality gold files have required v0 fields', () => {
  const files = listEvaluationSetJson('data/evaluation-set/discovery-quality');
  validateFileCollection(files, validateDiscoveryQualityPayload);

  assert.deepEqual(summarizeFileCollection(files), [
    'known-genuine-emerging.json',
    'known-noise-clusters.json',
  ]);
});

test('theme brief gold files satisfy the eight-section contract', () => {
  const files = listEvaluationSetJson('data/evaluation-set/theme-briefs');
  const jsonFiles = files.filter(({ relativePath }) => !relativePath.endsWith('/README.md'));
  validateFileCollection(jsonFiles, validateThemeBriefPayload);

  assert.ok(jsonFiles.length >= 6, 'theme brief gold set should contain multiple reference briefs');
});

test('theme proposal flow gold file covers propose, attach, and reject decisions', () => {
  const files = listEvaluationSetJson('data/evaluation-set/theme-proposals');
  validateFileCollection(files, validateThemeProposalFlowPayload);

  assert.deepEqual(summarizeFileCollection(files), [
    'proposal-decision-flow.golden.json',
  ]);
});
