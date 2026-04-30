/**
 * S-Tier §1 — composite event product score.
 *
 * Verifies the multiplicative product-score formula behaves the way the plan
 * requires: each of the six components must be necessary, and weak components
 * must drag the total down even if other components are strong.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeEventProductScore,
  rankByProductScore,
  classifyEventLane,
  computeThemeRelevance,
  computeEvidenceWeight,
  computeFreshnessWeight,
  computeSourceCredibility,
  computeImpactWeight,
  computeDuplicatePenalty,
} from '../scripts/_shared/event-product-score.mjs';

const NOW = new Date('2026-04-30T00:00:00Z');

function makeEvent(overrides = {}) {
  return {
    id: 1,
    theme: 'energy-supply-chain',
    eventDate: '2026-04-29',
    articleCount: 6,
    sourceCount: 5,
    publisherGroups: 4,
    bestEvidenceGrade: 'E2',
    rawEvidenceGrade: 'E2',
    rawMaxAbsTStat: 3.2,
    promotionEligible: true,
    qualityFlags: [],
    knownMarketRelevanceArticles: 4,
    marketRelevantArticles: 3,
    lowRelevanceArticles: 1,
    ...overrides,
  };
}

test('strong event scores in the high band', () => {
  const event = makeEvent();
  const { productScore, components } = computeEventProductScore(event, { now: NOW });
  assert.ok(productScore > 0.20, `expected high-band score, got ${productScore}`);
  for (const [name, value] of Object.entries(components)) {
    assert.ok(value >= 0 && value <= 1, `${name} component out of [0,1]: ${value}`);
  }
});

test('dynamic dt-* theme drops themeRelevance vs explicit theme', () => {
  // Compare against a clean baseline (no market relevance boost) so the dt-*
  // penalty is the only signal under test.
  const baseFixture = {
    knownMarketRelevanceArticles: 0,
    marketRelevantArticles: 0,
    lowRelevanceArticles: 0,
    qualityFlags: [],
  };
  const explicit = computeThemeRelevance({ ...baseFixture, theme: 'energy-supply-chain' });
  const dynamic = computeThemeRelevance({ ...baseFixture, theme: 'dt-abc123' });
  assert.ok(
    dynamic.value < explicit.value,
    `dt-* should drop relevance below explicit theme: dynamic=${dynamic.value} explicit=${explicit.value}`,
  );
  assert.ok(dynamic.value < 0.5, `dt-* baseline should be < 0.5, got ${dynamic.value}`);
  assert.ok(dynamic.rationale.includes('dynamic-theme-code'));
});

test('catch-all theme reduces relevance', () => {
  const event = makeEvent({ theme: 'technology-general' });
  const { value, rationale } = computeThemeRelevance(event);
  assert.ok(value <= 0.75, `catch-all should reduce relevance, got ${value}`);
  assert.ok(rationale.includes('catch-all-theme'));
});

test('strong market relevance boosts theme score', () => {
  const weak = computeThemeRelevance(makeEvent({
    knownMarketRelevanceArticles: 0,
    marketRelevantArticles: 0,
    lowRelevanceArticles: 0,
  }));
  const strong = computeThemeRelevance(makeEvent({
    knownMarketRelevanceArticles: 5,
    marketRelevantArticles: 5,
    lowRelevanceArticles: 0,
  }));
  assert.ok(strong.value > weak.value, `market relevance should raise score: weak=${weak.value} strong=${strong.value}`);
});

test('evidence grade weights are ordered E4 > E3 > E2 > E1 > E0 > none', () => {
  const grades = ['E4', 'E3', 'E2', 'E1', 'E0'];
  let prev = 1.01;
  for (const grade of grades) {
    const { value } = computeEvidenceWeight({ bestEvidenceGrade: grade });
    assert.ok(value < prev, `expected ${grade} < previous (${prev}), got ${value}`);
    prev = value;
  }
  const none = computeEvidenceWeight({ bestEvidenceGrade: null });
  assert.ok(none.value <= 0.20, `none should be very low, got ${none.value}`);
});

test('freshness decays exponentially', () => {
  const today = computeFreshnessWeight({ eventDate: '2026-04-30' }, NOW);
  const oneWeek = computeFreshnessWeight({ eventDate: '2026-04-23' }, NOW);
  const oneMonth = computeFreshnessWeight({ eventDate: '2026-03-30' }, NOW);
  assert.ok(today.value > oneWeek.value, 'today should be > 1 week ago');
  assert.ok(oneWeek.value > oneMonth.value, '1 week should be > 1 month');
  assert.ok(today.value > 0.9, `today should be near 1, got ${today.value}`);
});

test('source credibility rewards multi-publisher coverage', () => {
  const single = computeSourceCredibility({ sourceCount: 1, publisherGroups: 1 });
  const narrow = computeSourceCredibility({ sourceCount: 3, publisherGroups: 1 });
  const wide = computeSourceCredibility({ sourceCount: 5, publisherGroups: 4 });
  assert.ok(wide.value > narrow.value, 'wide publisher coverage > narrow');
  assert.ok(narrow.value >= single.value, 'multi-source >= single-source');
});

test('impact weight reflects |t-stat|', () => {
  const t4 = computeImpactWeight({ rawMaxAbsTStat: 4 });
  const t2 = computeImpactWeight({ rawMaxAbsTStat: 2 });
  const t0 = computeImpactWeight({ rawMaxAbsTStat: 0 });
  assert.ok(t4.value > t2.value && t2.value > t0.value);
});

test('duplicate penalty drops when all from same publisher group', () => {
  const independent = computeDuplicatePenalty({ sourceCount: 5, publisherGroups: 4 });
  const collapsed = computeDuplicatePenalty({ sourceCount: 5, publisherGroups: 1 });
  assert.ok(independent.value > collapsed.value, 'independent > collapsed publisher groups');
});

test('weak component on E0 ungraded item kills the composite score', () => {
  // Strong on freshness/source/impact but null evidence → score must be small.
  const ungraded = makeEvent({
    bestEvidenceGrade: null,
    rawEvidenceGrade: null,
    promotionEligible: false,
  });
  const promoted = makeEvent();
  const a = computeEventProductScore(ungraded, { now: NOW });
  const b = computeEventProductScore(promoted, { now: NOW });
  assert.ok(b.productScore > a.productScore, `promoted > ungraded; got ${b.productScore} vs ${a.productScore}`);
  assert.ok(a.productScore < 0.05, `ungraded should fall into noise band, got ${a.productScore}`);
});

test('rankByProductScore sorts descending', () => {
  const events = [
    makeEvent({ id: 1, bestEvidenceGrade: 'E2', eventDate: '2026-04-29' }),
    makeEvent({ id: 2, bestEvidenceGrade: 'E4', eventDate: '2026-04-29' }),
    makeEvent({ id: 3, bestEvidenceGrade: 'E0', eventDate: '2026-04-29' }),
  ];
  const ranked = rankByProductScore(events, { now: NOW });
  assert.equal(ranked[0].id, 2, 'E4 should rank first');
  assert.equal(ranked[2].id, 3, 'E0 should rank last');
  for (const item of ranked) {
    assert.ok(item.scoreBreakdown);
    assert.ok(typeof item.productScore === 'number');
  }
});

test('classifyEventLane: validated requires promoted + score >= 0.20', () => {
  const validated = { promotionEligible: true, productScore: 0.30 };
  const watch = { promotionEligible: false, productScore: 0.10 };
  const noise = { promotionEligible: false, productScore: 0.01 };
  const watchEvenIfPromoted = { promotionEligible: true, productScore: 0.10 };
  assert.equal(classifyEventLane(validated), 'validated');
  assert.equal(classifyEventLane(watch), 'watch');
  assert.equal(classifyEventLane(noise), 'noise');
  assert.equal(classifyEventLane(watchEvenIfPromoted), 'watch');
});

test('rationale array is non-empty for every event', () => {
  const score = computeEventProductScore(makeEvent(), { now: NOW });
  assert.ok(Array.isArray(score.rationale));
  assert.ok(score.rationale.length >= 5, 'should collect rationale from each component');
});

test('rankByProductScore preserves original event metadata', () => {
  const events = [
    makeEvent({ id: 7, theme: 'energy-supply-chain', extraField: 'preserved' }),
  ];
  const ranked = rankByProductScore(events);
  assert.equal(ranked[0].id, 7);
  assert.equal(ranked[0].extraField, 'preserved', 'extra fields must pass through');
  assert.ok(typeof ranked[0].productScore === 'number');
  assert.ok(ranked[0].scoreBreakdown);
});
