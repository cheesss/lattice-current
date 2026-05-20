import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCrossThemeLongFormSections } from '../scripts/_shared/report-narrative-plan.mjs';

function joinAllText(sections = []) {
  return sections
    .flatMap((section) => (section.paragraphs || []).map((paragraph) => paragraph.text || ''))
    .join(' \n ');
}

function baseBlueprint({ exposedIssuers = [], autoDiscoveredIssuers = [] } = {}) {
  return {
    subject: 'substation equipment lead time',
    crossTheme: {
      subject: 'substation equipment lead time',
      themeText: 'AI / Machine Learning and Clean Energy',
      themeScopeText: 'compute and grid energy',
      themeRelationText: 'across compute and grid energy',
      themeShareText: 'AI build-outs and clean-energy interconnection could share this node',
      themeLinkText: 'links AI build-outs to clean-energy interconnection',
      discoveryRole: 'bottleneck',
      triggerTerms: ['capacity', 'supplier', 'lead time'],
      sourceQueries: ['substation lead time supplier', 'transformer backlog'],
      mechanism: 'Long-lead substation equipment limits how quickly grid capacity can be expanded',
      whyNow: 'Hyperscaler interconnection queue is widening as transformer lead times stretch',
      evidenceQuality: 0.6,
      sourceDiversity: 0.55,
      discoveryFit: 0.7,
      constraintCriticality: 0.7,
      geopoliticalRelevance: 0.4,
      seedSimilarity: 0.3,
      discoveryQuality: {
        tier: 'evidence_backed_bottleneck_candidate',
        metrics: {
          bodyEvidenceCount: 6,
          highFitAnchorCount: 2,
          negativeControlPass: 1,
          evidenceClassesCovered: ['supplier_capacity', 'power_constraint'],
          missingEvidenceClasses: ['issuer_exposure', 'market_validation'],
          sourceDiversity: 0.6,
          directHighFitAnchorCount: 1,
        },
      },
      actionBridge: {
        label: 'partial bridge',
        tier: 'source_expansion_plus_issuer_follow_up',
        exposedIssuers,
        autoDiscoveredIssuers,
        missingClasses: ['issuer_exposure', 'market_validation'],
        marketTranslation: { status: 'unattached' },
      },
      directEvidenceCount: 2,
      sourceQueryPersistedCount: 4,
      readinessBlockers: [],
      ontologyGaps: [],
      evidenceAnchors: [],
    },
    refs: {},
  };
}

test('buildCrossThemeLongFormSections shows partial bridge when an auto-discovered issuer has direct_node_exposure_attached', () => {
  const blueprint = baseBlueprint({
    exposedIssuers: [],
    autoDiscoveredIssuers: [
      { symbol: 'PWR', status: 'direct_node_exposure_attached', issuerBridgeRole: 'engineering' },
      { symbol: 'ETN', status: 'frontier_node_candidate', issuerBridgeRole: 'equipment' },
      { symbol: 'VRT', status: 'frontier_node_candidate', issuerBridgeRole: 'cooling' },
    ],
  });
  const sections = buildCrossThemeLongFormSections(blueprint);
  const text = joinAllText(sections);

  assert.match(text, /direct node-exposure bridge attached/);
  assert.match(text, /\bPWR\b/);
  assert.doesNotMatch(text, /direct bridge evidence is still missing/);
  assert.doesNotMatch(text, /direct issuer translation is not attached yet/);
});

test('buildCrossThemeLongFormSections falls back to legacy "missing" wording when no auto issuer has direct bridge', () => {
  const blueprint = baseBlueprint({
    exposedIssuers: [],
    autoDiscoveredIssuers: [
      { symbol: 'ETN', status: 'frontier_node_candidate', issuerBridgeRole: 'equipment' },
      { symbol: 'VRT', status: 'frontier_node_candidate', issuerBridgeRole: 'cooling' },
    ],
  });
  const sections = buildCrossThemeLongFormSections(blueprint);
  const text = joinAllText(sections);

  assert.match(text, /direct bridge evidence is still missing|direct issuer translation is not attached yet/);
  assert.doesNotMatch(text, /direct node-exposure bridge attached/);
});

test('buildCrossThemeLongFormSections treats issuer_exposure_attached on an auto-discovered issuer as a partial bridge', () => {
  const blueprint = baseBlueprint({
    exposedIssuers: [],
    autoDiscoveredIssuers: [
      { symbol: 'ETN', status: 'issuer_exposure_attached', issuerBridgeRole: 'equipment' },
    ],
  });
  const sections = buildCrossThemeLongFormSections(blueprint);
  const text = joinAllText(sections);

  assert.match(text, /direct node-exposure bridge attached/);
  assert.doesNotMatch(text, /direct bridge evidence is still missing/);
});

test('buildCrossThemeLongFormSections prefers exposedIssuers wording when both are present', () => {
  const blueprint = baseBlueprint({
    exposedIssuers: [
      { symbol: 'PWR', status: 'issuer_exposure_attached' },
    ],
    autoDiscoveredIssuers: [
      { symbol: 'PWR', status: 'direct_node_exposure_attached' },
    ],
  });
  const sections = buildCrossThemeLongFormSections(blueprint);
  const text = joinAllText(sections);

  assert.match(text, /direct issuer-exposure evidence/);
});

test('buildCrossThemeLongFormSections surfaces run-up check text when valuationReadiness is overheated', () => {
  const blueprint = baseBlueprint({
    exposedIssuers: [],
    autoDiscoveredIssuers: [
      { symbol: 'PWR', status: 'direct_node_exposure_attached' },
    ],
  });
  blueprint.crossTheme.actionBridge.valuationReadiness = {
    summary: { tier: 'overheated', overheatedSymbolCount: 1, extendedSymbolCount: 0, missingClass: [] },
    perSymbol: [{ symbol: 'PWR', tier: 'overheated' }],
  };
  const sections = buildCrossThemeLongFormSections(blueprint);
  const text = joinAllText(sections);
  assert.match(text, /Run-up check flags/);
  assert.doesNotMatch(text, /Run-up check is not yet attached/);
});

test('buildCrossThemeLongFormSections falls back to pending run-up text when valuationReadiness is missing', () => {
  const blueprint = baseBlueprint({
    exposedIssuers: [],
    autoDiscoveredIssuers: [
      { symbol: 'ETN', status: 'frontier_node_candidate' },
    ],
  });
  const sections = buildCrossThemeLongFormSections(blueprint);
  const text = joinAllText(sections);
  assert.match(text, /Run-up check is not yet attached/);
});
