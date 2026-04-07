import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDeterministicTechThesis,
  computeTrackingScore,
  normalizeTechReportPayload,
  parseArgs,
} from '../scripts/generate-tech-report.mjs';

test('generate-tech-report parseArgs applies defaults and flags', () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.limit, 5);
  assert.equal(defaults.force, false);

  const overridden = parseArgs(['--limit', '12', '--topic-id', 'silicon-photonics', '--force', '--codex-only']);
  assert.equal(overridden.limit, 12);
  assert.equal(overridden.topicId, 'silicon-photonics');
  assert.equal(overridden.force, true);
  assert.equal(overridden.codexOnly, true);
});

test('generate-tech-report tracking score stays bounded', () => {
  const score = computeTrackingScore({
    momentum: 4.2,
    research_momentum: 2.5,
    source_quality_score: 0.81,
    novelty: 0.8,
    diversity: 4,
  }, [{ symbol: 'NVDA' }, { symbol: 'TSM' }]);
  assert.ok(score >= 0 && score <= 100);
  assert.ok(score > 40);
});

test('generate-tech-report tracking score increases with stronger source quality', () => {
  const low = computeTrackingScore({
    momentum: 2,
    research_momentum: 1,
    source_quality_score: 0.3,
    novelty: 0.4,
    diversity: 2,
  }, []);
  const high = computeTrackingScore({
    momentum: 2,
    research_momentum: 1,
    source_quality_score: 0.9,
    novelty: 0.4,
    diversity: 2,
  }, []);
  assert.ok(high > low);
});

test('generate-tech-report normalizes Codex payload and clamps values', () => {
  const normalized = normalizeTechReportPayload({
    investment_thesis: 'Track silicon photonics demand.',
    tracking_score: 140,
    next_review_days: 0,
  }, { momentum: 1.5 }, []);
  assert.equal(normalized.investmentThesis, 'Track silicon photonics demand.');
  assert.equal(normalized.trackingScore, 100);
  assert.equal(normalized.nextReviewDays, 1);
});

test('generate-tech-report deterministic thesis references topic and symbols', () => {
  const thesis = buildDeterministicTechThesis(
    {
      id: 'silicon-photonics',
      label: 'Silicon Photonics',
      description: 'Integrated optics for AI datacenter interconnects.',
      research_momentum: 1.7,
      source_quality_score: 0.78,
    },
    [{ title: 'Photonics startup expands fab line' }],
    [{ symbol: 'COHR' }, { symbol: 'LITE' }],
  );
  assert.match(thesis, /Silicon Photonics/);
  assert.match(thesis, /COHR, LITE/);
  assert.match(thesis, /Source quality/);
});
