import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeDataQualityMetrics,
  summarizeDataQualityRows,
} from '../scripts/_shared/data-quality-check.mjs';

test('summarizeDataQualityRows produces weighted overall score', () => {
  const report = summarizeDataQualityRows({
    articleLastAt: '2026-04-06T00:00:00.000Z',
    articleAgeMs: 2 * 60 * 60 * 1000,
    signalLastAt: '2026-04-06T05:50:00.000Z',
    signalAgeMs: 10 * 60 * 1000,
    maturedArticles: 100,
    labeledArticles: 92,
    labeledRows: 300,
    nullCount: 3,
    outlierCount: 2,
  });

  assert.equal(report.articleFreshness.score, 1);
  assert.equal(report.signalFreshness.score, 1);
  assert.equal(report.outcomeCompleteness.score, 1);
  assert.ok(report.overall > 0.8);
});

test('computeDataQualityMetrics queries freshness and integrity inputs', async () => {
  const queries = [];
  const report = await computeDataQualityMetrics({
    async query(sql) {
      queries.push(String(sql));
      if (String(sql).includes('WITH matured AS')) {
        return { rows: [{ matured_articles: 40, labeled_articles: 30 }] };
      }
      if (String(sql).includes('FROM articles')) {
        return { rows: [{ last_at: '2026-04-06T00:00:00.000Z', age_ms: 1_000 }] };
      }
      if (String(sql).includes('FROM signal_history')) {
        return { rows: [{ last_at: '2026-04-06T00:00:00.000Z', age_ms: 2_000 }] };
      }
      return { rows: [{ labeled_rows: 100, null_count: 2, outlier_count: 1 }] };
    },
  });

  assert.equal(queries.length, 4);
  assert.equal(report.outcomeCompleteness.total, 40);
  assert.equal(report.outcomeCompleteness.labeled, 30);
  assert.equal(report.nullRate.count, 2);
  assert.equal(report.outlierRate.count, 1);
});
