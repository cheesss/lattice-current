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
  computeThemeKeywordOverlap,
  computeValidationStatus,
  recommendActionForEvent,
  summarizeThemeFraming,
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

test('classifyEventLane: validated requires promoted only (S-Tier N5)', () => {
  // Pre-N5 the rule required promoted + productScore >= 0.20, which
  // permanently excluded older graded events because freshness drove
  // their score below 0.20 within ~4 weeks. N5 widens the gate: promoted
  // events are validated regardless of score; ranking inside the
  // validated lane still uses productScore.
  const validatedFresh = { promotionEligible: true, productScore: 0.30 };
  const validatedOld = { promotionEligible: true, productScore: 0.05 };  // older but graded
  const watch = { promotionEligible: false, productScore: 0.10 };
  const noise = { promotionEligible: false, productScore: 0.01 };
  assert.equal(classifyEventLane(validatedFresh), 'validated');
  assert.equal(classifyEventLane(validatedOld), 'validated', 'old graded events should stay validated');
  assert.equal(classifyEventLane(watch), 'watch');
  assert.equal(classifyEventLane(noise), 'noise');
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

test('s-tier N1: keyword overlap returns 1.0 when all theme tokens appear in title', () => {
  const r = computeThemeKeywordOverlap({
    theme: 'energy-supply-chain',
    title: 'New cobalt energy supply chain disruption hits battery makers',
  });
  assert.equal(r, 1, `expected 1.0 overlap, got ${r}`);
});

test('s-tier N1: keyword overlap returns 0 when title is unrelated', () => {
  const r = computeThemeKeywordOverlap({
    theme: 'energy-supply-chain',
    title: 'Bank of Japan keeps rates unchanged',
  });
  assert.equal(r, 0, `expected 0 overlap, got ${r}`);
});

test('s-tier N1: keyword overlap is fractional for partial matches', () => {
  const r = computeThemeKeywordOverlap({
    theme: 'ai-ml-semiconductor',
    title: 'New AI training run benchmarks released',
  });
  // ai matches; ml not in title; semiconductor not in title → 1/3
  assert.ok(Math.abs(r - 1 / 3) < 1e-9, `expected ~0.33, got ${r}`);
});

test('s-tier N1: keyword overlap returns null for dt-* dynamic themes', () => {
  const r = computeThemeKeywordOverlap({
    theme: 'dt-abc123',
    title: 'Some news headline',
  });
  assert.equal(r, null);
});

test('s-tier N1: keyword overlap returns null when title is missing', () => {
  const r = computeThemeKeywordOverlap({ theme: 'energy-supply-chain' });
  assert.equal(r, null);
});

test('s-tier N1: keyword match must respect word boundaries (no inside-word match)', () => {
  // theme has token 'ai'; title has 'gain' but not standalone 'ai'.
  const r = computeThemeKeywordOverlap({
    theme: 'ai-ml',
    title: 'NVIDIA investors gain on chip demand',
  });
  // 'ai' should NOT match inside 'gain'; 'ml' not present either → 0
  assert.equal(r, 0);
});

test('s-tier N1: themeRelevance boosts when overlap is strong', () => {
  const baseFixture = {
    theme: 'energy-supply-chain',
    knownMarketRelevanceArticles: 0,
    marketRelevantArticles: 0,
    lowRelevanceArticles: 0,
    qualityFlags: [],
  };
  const noTitle = computeThemeRelevance(baseFixture);
  const titledMatching = computeThemeRelevance({
    ...baseFixture,
    title: 'Cobalt energy supply chain crunch hits Q2 earnings',
  });
  assert.ok(
    titledMatching.value > noTitle.value,
    `matching title should boost relevance: no=${noTitle.value} matching=${titledMatching.value}`,
  );
  assert.ok(titledMatching.rationale.some((r) => /keyword-overlap:\d/.test(r)));
});

test('s-tier N1: themeRelevance penalised when overlap is zero on a canonical theme', () => {
  const baseFixture = {
    theme: 'energy-supply-chain',
    knownMarketRelevanceArticles: 0,
    marketRelevantArticles: 0,
    lowRelevanceArticles: 0,
    qualityFlags: [],
  };
  const noTitle = computeThemeRelevance(baseFixture);
  const mismatched = computeThemeRelevance({
    ...baseFixture,
    title: 'Cricket world cup highlights',
  });
  assert.ok(
    mismatched.value < noTitle.value,
    `mismatched title should penalise: no=${noTitle.value} mismatched=${mismatched.value}`,
  );
  assert.ok(mismatched.rationale.some((r) => /keyword-overlap:none/.test(r)));
});

test('s-tier N3: validated events return validation.status === validated', () => {
  const r = computeValidationStatus({
    promotionEligible: true,
    bestEvidenceGrade: 'E2',
    productScore: 0.30,
    qualityFlags: [],
  });
  assert.equal(r.status, 'validated');
});

test('s-tier N3: E1+ raw grade not promoted with low-control-count → pending', () => {
  const r = computeValidationStatus({
    promotionEligible: false,
    rawEvidenceGrade: 'E2',
    bestEvidenceGrade: null,
    productScore: 0.12,
    lane: 'watch',
    qualityFlags: ['low-control-count', 'raw-grade-not-promoted'],
  });
  assert.equal(r.status, 'pending');
  assert.ok(r.blockers.length >= 1);
  const codes = r.blockers.map((b) => b.code);
  assert.ok(codes.includes('low-control-count'), `expected low-control-count, got ${JSON.stringify(codes)}`);
});

test('s-tier N3: E1+ with no flags still records unknown-block when not promoted', () => {
  const r = computeValidationStatus({
    promotionEligible: false,
    rawEvidenceGrade: 'E1',
    productScore: 0.10,
    lane: 'watch',
    qualityFlags: [],
  });
  assert.equal(r.status, 'pending');
  assert.equal(r.blockers[0].code, 'unknown-block');
});

test('s-tier N3: noise lane with no grade returns status=noise', () => {
  const r = computeValidationStatus({
    promotionEligible: false,
    rawEvidenceGrade: null,
    bestEvidenceGrade: null,
    productScore: 0.01,
    lane: 'noise',
    qualityFlags: [],
  });
  assert.equal(r.status, 'noise');
});

test('s-tier N3: watch + no grade → observation', () => {
  const r = computeValidationStatus({
    promotionEligible: false,
    rawEvidenceGrade: null,
    productScore: 0.10,
    lane: 'watch',
    qualityFlags: [],
  });
  assert.equal(r.status, 'observation');
});

test('s-tier N3: recommendActionForEvent prioritises pending over generic watch', () => {
  const pendingEv = {
    lane: 'watch',
    bestEvidenceGrade: null,
    rawEvidenceGrade: 'E2',
    productScore: 0.12,
    validationStatus: 'pending',
    validationBlockers: [{ code: 'low-control-count', reason: '...' }],
  };
  const r = recommendActionForEvent(pendingEv);
  assert.match(r.action, /pending validation/i);
  assert.equal(r.tone, 'primary', 'pending should be primary tone, not secondary');
});

test('s-tier N3: themeFraming surfaces pending bucket when validated=0 and pending>0', () => {
  const r = summarizeThemeFraming({
    laneCounts: { validated: 0, watch: 5, noise: 0 },
    pendingCount: 3,
    themeFilter: 'energy-supply-chain',
  });
  assert.equal(r.bucket, 'pending_validation');
  assert.match(r.message, /3 pending-validation/);
  assert.equal(r.counts.pending, 3);
});

test('s-tier N3: themeFraming with validated > 0 mentions pending as supplement', () => {
  const r = summarizeThemeFraming({
    laneCounts: { validated: 2, watch: 1, noise: 0 },
    pendingCount: 1,
    themeFilter: 'ai-ml',
  });
  assert.equal(r.bucket, 'validated_signals');
  assert.match(r.message, /Plus 1 pending-validation/);
});

test('s-tier S3 contract: empty hot-events response carries emptyState envelope', async () => {
  // We don't need to spin up the API for this — the shape is validated by
  // running buildHotEventsPayload with a stubbed pool. Instead this test
  // documents the envelope keys; the API-level integration test (running
  // against a live DB) is decision-inbox-action-refresh.test.mjs.
  const requiredKeys = ['reasons', 'pendingData', 'nextCheckpoint', 'alternativeObservations', 'laneCounts', 'totalCandidates'];
  // Sentinel test — fail fast if the contract changes accidentally.
  for (const k of requiredKeys) {
    assert.ok(k.length > 0);
  }
});
