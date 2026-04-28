import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHotEventQualityFlags,
  normalizeHotEventRow,
} from '../scripts/_shared/event-intelligence-builder.mjs';

test('hot event raw E2 is not treated as promoted when quality gates block it', () => {
  const event = normalizeHotEventRow({
    id: 32970,
    theme: 'clean-energy',
    representative_title: 'Sam Altman thank-you to coders draws the memes',
    event_date: '2026-03-17',
    article_count: 2,
    source_count: 2,
    raw_best_grade: 'E2',
    promoted_grade: null,
    uplift_rows: 5,
    promoted_uplift_rows: 0,
    raw_max_abs_uplift: 8.27,
    raw_max_abs_t: 2.78,
    min_strong_controls: 3,
    max_strong_controls: 3,
    known_market_relevance_articles: 1,
    market_relevant_articles: 0,
    low_relevance_articles: 1,
    controls_blocked: true,
    relevance_blocked: true,
  });

  assert.equal(event.bestEvidenceGrade, null);
  assert.equal(event.rawEvidenceGrade, 'E2');
  assert.equal(event.promotionEligible, false);
  assert.deepEqual(event.qualityFlags, [
    'raw-grade-not-promoted',
    'low-control-count',
    'low-market-relevance',
  ]);
  assert.equal(event.qualityGate.minControlsRequired, 8);
});

test('hot event E2 remains promotable when controls and relevance pass', () => {
  const event = normalizeHotEventRow({
    id: 100,
    theme: 'cybersecurity',
    representative_title: 'Validated cyber event',
    event_date: '2026-04-20',
    article_count: 4,
    source_count: 3,
    raw_best_grade: 'E2',
    promoted_grade: 'E2',
    uplift_rows: 3,
    promoted_uplift_rows: 1,
    rank_abs_uplift: 3.5,
    rank_abs_t: 2.4,
    min_strong_controls: 12,
    max_strong_controls: 12,
    known_market_relevance_articles: 3,
    market_relevant_articles: 2,
    low_relevance_articles: 1,
    controls_blocked: false,
    relevance_blocked: false,
  });

  assert.equal(event.bestEvidenceGrade, 'E2');
  assert.equal(event.rawEvidenceGrade, 'E2');
  assert.equal(event.promotionEligible, true);
  assert.deepEqual(event.qualityFlags, []);
});

test('hot event quality flags handle PostgreSQL boolean strings', () => {
  assert.deepEqual(
    buildHotEventQualityFlags({
      raw_best_grade: 'E2',
      promoted_grade: null,
      controls_blocked: 'true',
      relevance_blocked: 'false',
      article_count: 1,
      source_count: 1,
    }),
    ['raw-grade-not-promoted', 'low-control-count', 'single-article', 'single-source'],
  );
});
