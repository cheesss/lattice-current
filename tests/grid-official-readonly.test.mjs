import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGridOfficialRawEvidence,
  collectGridOfficialReadonly,
  DEFAULT_GRID_OFFICIAL_SOURCE_ALLOWLIST,
  findGridMechanismProximity,
} from '../scripts/_shared/external-data/grid-official-readonly.mjs';

test('grid official collector accepts LBNL-style fixture evidence', () => {
  const result = collectGridOfficialReadonly({
    seedId: 'track-a-grid',
    maxSources: 1,
  });
  assert.equal(result.rawEvidence.length, 1);
  assert.equal(result.rawEvidence[0].sourceGroup, 'official_research_dataset');
  assert.equal(result.rawEvidence[0].accepted, true);
  assert.equal(result.rawEvidence[0].evidenceClass, 'mechanism_validation');
  assert.equal(result.rawEvidence[0].promotionEligible, false);
  assert.match(result.rawEvidence[0].matchedSnippet, /interconnection queue/i);
});

test('grid official collector records fixture requirements instead of broadening live access', () => {
  const source = DEFAULT_GRID_OFFICIAL_SOURCE_ALLOWLIST.find((item) => item.sourceId === 'utility-planning-fixture-required');
  const row = buildGridOfficialRawEvidence(source, {
    seedId: 'track-a-grid',
  });
  assert.equal(row.accepted, false);
  assert.equal(row.extractionStatus, 'fixture_required');
  assert.equal(row.failureClassification, 'FIXTURE_REQUIRED');
});

test('grid official dataset fields can support accepted mechanism evidence', () => {
  const row = buildGridOfficialRawEvidence({
    sourceId: 'lbnl-dataset-row',
    sourceGroup: 'official_research_dataset',
    sourceFamily: 'lbnl_interconnection_queue',
    documentTitle: 'LBNL dataset row summary',
    documentType: 'csv',
    allowedForTrack: 'track_a_mechanism_validation',
    extractionMode: 'csv',
    datasetFieldsUsed: ['queue duration', 'withdrawal rate', 'project count in queue'],
    datasetMetricSummary: 'Interconnection queue duration and withdrawal rate show application backlog and backlog growth.',
    bottleneckInterpretation: 'Queue duration and withdrawal rate indicate a processing capacity bottleneck.',
  }, {
    seedId: 'track-a-grid',
  });
  assert.equal(row.accepted, true);
  assert.equal(row.datasetFieldsUsed.includes('queue duration'), true);
  assert.equal(row.promotionEligible, false);
});

test('grid official proximity rejects body terms that are too far apart', () => {
  const body = `interconnection queue ${'unrelated planning text '.repeat(90)} backlog growth`;
  const proximity = findGridMechanismProximity(body, { windowChars: 1000 });
  assert.equal(proximity.matched, false);
  const row = buildGridOfficialRawEvidence({
    sourceId: 'far-apart-terms',
    sourceGroup: 'official_grid_operator',
    sourceFamily: 'iso_queue_report',
    documentTitle: 'ISO queue report',
    documentType: 'html',
    allowedForTrack: 'track_a_mechanism_validation',
    extractionMode: 'html',
    fixtureText: body,
  }, {
    seedId: 'track-a-grid',
  });
  assert.equal(row.accepted, false);
});

test('grid official generic electricity demand text is not accepted', () => {
  const row = buildGridOfficialRawEvidence({
    sourceId: 'generic-demand',
    sourceGroup: 'official_research_dataset',
    sourceFamily: 'generic_power_report',
    documentTitle: 'Electricity demand overview',
    documentType: 'text',
    allowedForTrack: 'track_a_mechanism_validation',
    extractionMode: 'text',
    fixtureText: 'Electricity demand is rising and data centers need more power. Interconnection is discussed as a broad planning topic.',
  }, {
    seedId: 'track-a-grid',
  });
  assert.equal(row.accepted, false);
});
