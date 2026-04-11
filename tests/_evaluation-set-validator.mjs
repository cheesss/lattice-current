import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { repoPath } from './_workspace-paths.mjs';

function assertNonEmptyString(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.trim().length > 0, `${label} must not be empty`);
}

function assertArray(value, label, minLength = 1) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.ok(value.length >= minLength, `${label} must have at least ${minLength} item(s)`);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(repoPath(relativePath), 'utf8'));
}

export function listEvaluationSetJson(relativeDir) {
  return readdirSync(repoPath(relativeDir))
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => ({
      fileName: entry,
      relativePath: `${relativeDir}/${entry}`.replace(/\\/g, '/'),
      payload: readJson(`${relativeDir}/${entry}`),
    }));
}

export function validateTaxonomyCoveragePayload(payload, filePath) {
  assertNonEmptyString(payload.schemaVersion, `${filePath}: schemaVersion`);
  assertNonEmptyString(payload.reviewStatus, `${filePath}: reviewStatus`);
  assert.ok(Number.isInteger(payload.targetSampleSize), `${filePath}: targetSampleSize must be an integer`);
  assert.ok(payload.targetSampleSize > 0, `${filePath}: targetSampleSize must be positive`);
  assertArray(payload.items, `${filePath}: items`, 5);

  payload.items.forEach((item, index) => {
    assert.ok(Number.isInteger(item.articleId), `${filePath}: items[${index}].articleId must be an integer`);
    assert.ok(item.articleId > 0, `${filePath}: items[${index}].articleId must be positive`);
    assertNonEmptyString(item.title, `${filePath}: items[${index}].title`);
    assertNonEmptyString(item.source, `${filePath}: items[${index}].source`);
    assertNonEmptyString(item.publishedAt, `${filePath}: items[${index}].publishedAt`);
    assertNonEmptyString(item.expectedTheme, `${filePath}: items[${index}].expectedTheme`);
    assertNonEmptyString(item.expectedParentTheme, `${filePath}: items[${index}].expectedParentTheme`);
    assertNonEmptyString(item.expectedCategory, `${filePath}: items[${index}].expectedCategory`);
    assertNonEmptyString(item.rationale, `${filePath}: items[${index}].rationale`);
  });
}

export function validateDiscoveryQualityPayload(payload, filePath) {
  assertNonEmptyString(payload.schemaVersion, `${filePath}: schemaVersion`);
  assertNonEmptyString(payload.reviewStatus, `${filePath}: reviewStatus`);
  assert.match(
    payload.datasetType,
    /^(known-noise-clusters|known-genuine-emerging)$/,
    `${filePath}: datasetType must describe the discovery set`
  );
  assertArray(payload.items, `${filePath}: items`, 3);

  payload.items.forEach((item, index) => {
    assertNonEmptyString(item.label, `${filePath}: items[${index}].label`);
    assert.match(
      item.expectedDisposition,
      /^(watch|canonical|suppressed)$/,
      `${filePath}: items[${index}].expectedDisposition must be watch, canonical, or suppressed`
    );
    assertNonEmptyString(item.rationale, `${filePath}: items[${index}].rationale`);

    if (item.expectedDisposition !== 'suppressed') {
      assertNonEmptyString(item.expectedTheme, `${filePath}: items[${index}].expectedTheme`);
      assertNonEmptyString(item.expectedParentTheme, `${filePath}: items[${index}].expectedParentTheme`);
      assertNonEmptyString(item.expectedCategory, `${filePath}: items[${index}].expectedCategory`);
    }
  });
}

export function validateThemeBriefPayload(payload, filePath) {
  assertNonEmptyString(payload.theme, `${filePath}: theme`);
  assertNonEmptyString(payload.periodType, `${filePath}: periodType`);
  assertNonEmptyString(payload.reviewStatus, `${filePath}: reviewStatus`);
  assert.ok(payload.sections && typeof payload.sections === 'object', `${filePath}: sections must be an object`);

  const sections = payload.sections;
  const requiredSectionKeys = [
    'whatChanged',
    'whyItMatters',
    'evidence',
    'subtopicMovement',
    'relatedEntities',
    'risks',
    'watchpoints',
    'notebookHooks',
  ];

  requiredSectionKeys.forEach((key) => {
    assert.ok(Object.prototype.hasOwnProperty.call(sections, key), `${filePath}: missing section ${key}`);
  });

  assertArray(sections.whatChanged, `${filePath}: sections.whatChanged`);
  sections.whatChanged.forEach((item, index) => {
    assertNonEmptyString(item.title, `${filePath}: sections.whatChanged[${index}].title`);
    assertNonEmptyString(item.detail, `${filePath}: sections.whatChanged[${index}].detail`);
    assertNonEmptyString(item.importance, `${filePath}: sections.whatChanged[${index}].importance`);
  });

  assert.ok(sections.whyItMatters && typeof sections.whyItMatters === 'object', `${filePath}: sections.whyItMatters must be an object`);
  assertNonEmptyString(sections.whyItMatters.summary, `${filePath}: sections.whyItMatters.summary`);
  assertArray(sections.whyItMatters.statements, `${filePath}: sections.whyItMatters.statements`);
  sections.whyItMatters.statements.forEach((value, index) => {
    assertNonEmptyString(value, `${filePath}: sections.whyItMatters.statements[${index}]`);
  });

  assert.ok(sections.evidence && typeof sections.evidence === 'object', `${filePath}: sections.evidence must be an object`);
  assertArray(sections.evidence.requiredSourceClasses, `${filePath}: sections.evidence.requiredSourceClasses`);
  assertArray(sections.evidence.requiredClaims, `${filePath}: sections.evidence.requiredClaims`);
  assertArray(sections.evidence.provenanceExpectations, `${filePath}: sections.evidence.provenanceExpectations`);
  assert.ok(Array.isArray(sections.evidence.notes), `${filePath}: sections.evidence.notes must be an array`);

  assertArray(sections.subtopicMovement, `${filePath}: sections.subtopicMovement`);
  sections.subtopicMovement.forEach((item, index) => {
    assertNonEmptyString(item.subtheme, `${filePath}: sections.subtopicMovement[${index}].subtheme`);
    assertNonEmptyString(item.direction, `${filePath}: sections.subtopicMovement[${index}].direction`);
    assertNonEmptyString(item.rationale, `${filePath}: sections.subtopicMovement[${index}].rationale`);
  });

  assert.ok(sections.relatedEntities && typeof sections.relatedEntities === 'object', `${filePath}: sections.relatedEntities must be an object`);
  assertArray(sections.relatedEntities.pathways, `${filePath}: sections.relatedEntities.pathways`);
  sections.relatedEntities.pathways.forEach((item, index) => {
    assertNonEmptyString(item.entity, `${filePath}: sections.relatedEntities.pathways[${index}].entity`);
    assertNonEmptyString(item.relationType, `${filePath}: sections.relatedEntities.pathways[${index}].relationType`);
    assertNonEmptyString(item.note, `${filePath}: sections.relatedEntities.pathways[${index}].note`);
    if (item.symbol !== null && item.symbol !== undefined) {
      assertNonEmptyString(item.symbol, `${filePath}: sections.relatedEntities.pathways[${index}].symbol`);
    }
  });

  assertArray(sections.risks, `${filePath}: sections.risks`);
  sections.risks.forEach((item, index) => {
    assertNonEmptyString(item.title, `${filePath}: sections.risks[${index}].title`);
    assertNonEmptyString(item.detail, `${filePath}: sections.risks[${index}].detail`);
  });

  assertArray(sections.watchpoints, `${filePath}: sections.watchpoints`);
  sections.watchpoints.forEach((item, index) => {
    assertNonEmptyString(item.horizon, `${filePath}: sections.watchpoints[${index}].horizon`);
    assertNonEmptyString(item.trigger, `${filePath}: sections.watchpoints[${index}].trigger`);
    assertNonEmptyString(item.implication, `${filePath}: sections.watchpoints[${index}].implication`);
  });

  assert.ok(sections.notebookHooks && typeof sections.notebookHooks === 'object', `${filePath}: sections.notebookHooks must be an object`);
  assertArray(sections.notebookHooks.suggestedTags, `${filePath}: sections.notebookHooks.suggestedTags`);
  assertArray(sections.notebookHooks.prompts, `${filePath}: sections.notebookHooks.prompts`);
}

export function validateThemeProposalFlowPayload(payload, filePath) {
  assertNonEmptyString(payload.schemaVersion, `${filePath}: schemaVersion`);
  assertNonEmptyString(payload.reviewStatus, `${filePath}: reviewStatus`);
  assert.match(
    payload.datasetType,
    /^(theme-proposal-decision-flow)$/,
    `${filePath}: datasetType must describe the theme proposal flow`
  );
  assertArray(payload.items, `${filePath}: items`, 3);

  const decisions = new Set();
  payload.items.forEach((item, index) => {
    assertNonEmptyString(item.topicLabel, `${filePath}: items[${index}].topicLabel`);
    assert.match(
      item.expectedDecision,
      /^(propose|attach|reject)$/,
      `${filePath}: items[${index}].expectedDecision must be propose, attach, or reject`
    );
    assertNonEmptyString(item.rationale, `${filePath}: items[${index}].rationale`);
    assertArray(item.promptMustCover, `${filePath}: items[${index}].promptMustCover`, 2);
    item.promptMustCover.forEach((token, tokenIndex) => {
      assertNonEmptyString(token, `${filePath}: items[${index}].promptMustCover[${tokenIndex}]`);
    });
    decisions.add(item.expectedDecision);

    if (item.expectedDecision === 'propose') {
      assertNonEmptyString(item.expectedThemeId, `${filePath}: items[${index}].expectedThemeId`);
      assert.ok(Number.isInteger(item.minAssetCount), `${filePath}: items[${index}].minAssetCount must be an integer`);
      assert.ok(item.minAssetCount >= 2, `${filePath}: items[${index}].minAssetCount must be at least 2 for propose`);
      assertArray(item.requiredFields, `${filePath}: items[${index}].requiredFields`, 3);
    }

    if (item.expectedDecision === 'attach') {
      assertNonEmptyString(item.expectedTargetTheme, `${filePath}: items[${index}].expectedTargetTheme`);
      assertNonEmptyString(item.expectedRelationType, `${filePath}: items[${index}].expectedRelationType`);
      assert.ok(Number.isInteger(item.minAssetCount), `${filePath}: items[${index}].minAssetCount must be an integer`);
      assert.ok(item.minAssetCount >= 1, `${filePath}: items[${index}].minAssetCount must be at least 1 for attach`);
    }

    if (item.expectedDecision === 'reject') {
      assertNonEmptyString(item.rejectionReasonCategory, `${filePath}: items[${index}].rejectionReasonCategory`);
      assertArray(item.mustNullPaths, `${filePath}: items[${index}].mustNullPaths`, 2);
    }
  });

  assert.deepEqual(
    Array.from(decisions).sort(),
    ['attach', 'propose', 'reject'],
    `${filePath}: items must cover propose, attach, and reject`
  );
}

export function validateFileCollection(files, validator) {
  files.forEach(({ relativePath, payload }) => validator(payload, relativePath));
}

export function summarizeFileCollection(files) {
  return files.map(({ relativePath }) => basename(relativePath)).sort();
}
