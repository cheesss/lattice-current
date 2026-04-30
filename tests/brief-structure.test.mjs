/**
 * S-Tier §2 — brief 6-section envelope.
 *
 * Verifies the structural normalization works irrespective of which brief
 * fields are present, so the product-quality metric can rely on a stable
 * shape across all themes and time ranges.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  projectBriefStructure,
  decorateBriefWithStructure,
  BRIEF_SECTION_KEYS,
} from '../scripts/_shared/brief-structure.mjs';

test('all six section keys are exported', () => {
  assert.deepEqual(BRIEF_SECTION_KEYS, [
    'whatChanged', 'whyMatters', 'evidence', 'caveats', 'monitor', 'related',
  ]);
});

test('completeness is 1.0 when every section has content', () => {
  const payload = {
    sections: {
      whatChanged: ['Q1 article volume up 38%'],
      whyItMatters: ['SPY +1.2% over prior week'],
      evidence: ['12 confirmed events in cluster'],
      risks: ['Small baseline; YoY 800% is base-effect'],
      watchpoints: ['Watch FOMC commentary next Tuesday'],
      relatedEntities: ['NVDA', 'AVGO'],
      adjacentPathways: ['energy-supply-chain'],
    },
    evidenceLedger: {
      evidenceClasses: [{ class: 'recent_article', count: 12 }],
    },
  };
  const { briefStructure, briefCompleteness, missingSections } = projectBriefStructure(payload);
  assert.equal(briefCompleteness, 1);
  assert.equal(missingSections.length, 0);
  assert.deepEqual(briefStructure.whatChanged, ['Q1 article volume up 38%']);
  assert.equal(briefStructure.evidence.classes[0].class, 'recent_article');
});

test('completeness is 0 for empty sections', () => {
  const { briefCompleteness, missingSections } = projectBriefStructure({});
  assert.equal(briefCompleteness, 0);
  assert.equal(missingSections.length, 6);
});

test('partial sections produce fractional completeness', () => {
  const payload = {
    sections: {
      whatChanged: ['Spike in adoption'],
      whyItMatters: ['Forward guidance change'],
      // evidence, caveats, monitor, related missing
    },
  };
  const { briefCompleteness, missingSections } = projectBriefStructure(payload);
  // 2 of 6 sections present → ~0.333
  assert.ok(Math.abs(briefCompleteness - 2 / 6) < 1e-9, `expected ~0.333, got ${briefCompleteness}`);
  assert.deepEqual(missingSections.sort(), ['caveats', 'evidence', 'monitor', 'related'].sort());
});

test('whyMatters falls back to whyItMatters', () => {
  const a = projectBriefStructure({ sections: { whyMatters: ['from new field'] } });
  const b = projectBriefStructure({ sections: { whyItMatters: ['from legacy field'] } });
  assert.deepEqual(a.briefStructure.whyMatters, ['from new field']);
  assert.deepEqual(b.briefStructure.whyMatters, ['from legacy field']);
});

test('caveats falls back to risks', () => {
  const proj = projectBriefStructure({ sections: { risks: ['Small baseline'] } });
  assert.deepEqual(proj.briefStructure.caveats, ['Small baseline']);
});

test('monitor draws from watchpoints, monitor, or nextActions', () => {
  const wp = projectBriefStructure({ sections: { watchpoints: ['Watch X'] } });
  const m = projectBriefStructure({ sections: { monitor: ['Watch Y'] } });
  const n = projectBriefStructure({ sections: { nextActions: ['Watch Z'] } });
  assert.equal(wp.briefStructure.monitor[0], 'Watch X');
  assert.equal(m.briefStructure.monitor[0], 'Watch Y');
  assert.equal(n.briefStructure.monitor[0], 'Watch Z');
});

test('related groups entities, pathways, assets, sectors', () => {
  const proj = projectBriefStructure({
    sections: {
      relatedEntities: ['NVDA', { label: 'AAPL' }],
      adjacentPathways: [{ summary: 'Quantum supply chain' }],
      relatedSectors: ['semiconductors'],
    },
  });
  const { related } = proj.briefStructure;
  assert.deepEqual(related.entities, ['NVDA', 'AAPL']);
  assert.deepEqual(related.pathways, ['Quantum supply chain']);
  assert.deepEqual(related.sectors, ['semiconductors']);
});

test('object-with-summary form is unwrapped to string', () => {
  const proj = projectBriefStructure({
    sections: {
      whatChanged: [{ summary: 'Ten new events this week' }, { text: 'Volume +30%' }],
    },
  });
  assert.deepEqual(proj.briefStructure.whatChanged, ['Ten new events this week', 'Volume +30%']);
});

test('evidence classes are normalized from ledger', () => {
  const proj = projectBriefStructure({
    sections: { evidence: ['raw'] },
    evidenceLedger: {
      evidenceClasses: [
        { class: 'curated_digest', count: 3 },
        'recent_articles',  // string form should be coerced
        null,
      ],
    },
  });
  assert.equal(proj.briefStructure.evidence.classes[0].class, 'curated_digest');
  assert.equal(proj.briefStructure.evidence.classes[0].count, 3);
  assert.equal(proj.briefStructure.evidence.classes[1].class, 'recent_articles');
});

test('decorateBriefWithStructure mutates and returns the payload', () => {
  const payload = {
    sections: {
      whatChanged: ['x'],
      whyItMatters: ['y'],
      evidence: ['z'],
      risks: ['r'],
      watchpoints: ['w'],
      relatedEntities: ['e'],
    },
  };
  const result = decorateBriefWithStructure(payload);
  assert.equal(result, payload, 'should return the same object reference');
  assert.ok(payload.briefStructure);
  assert.equal(payload.briefCompleteness, 1);
  assert.deepEqual(payload.missingSections, []);
});

test('decorateBriefWithStructure no-op for non-objects', () => {
  assert.equal(decorateBriefWithStructure(null), null);
  assert.equal(decorateBriefWithStructure(undefined), undefined);
  assert.equal(decorateBriefWithStructure('string'), 'string');
});
