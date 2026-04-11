import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDiscoveryTriageDecision,
  buildDiscoveryTriagePayload,
  buildStructuralAlertsPayload,
} from '../scripts/_shared/trend-workbench.mjs';

test('buildDiscoveryTriagePayload maps triage rows and summary', async () => {
  const safeQuery = async (sql) => {
    if (/FROM discovery_topics dt/.test(sql) && /LEFT JOIN LATERAL/.test(sql)) {
      return {
        rows: [{
          id: 'dt-quantum-lab',
          label: 'Quantum Lab Momentum',
          category: 'technology',
          parent_theme: 'technology-general',
          normalized_theme: 'quantum-computing',
          normalized_parent_theme: 'technology-general',
          normalized_category: 'technology',
          promotion_state: 'watch',
          suppression_reason: null,
          quality_flags: ['cross-domain-confirmed'],
          status: 'reported',
          article_count: 42,
          momentum: 1.8,
          research_momentum: 0.9,
          novelty: 0.55,
          source_quality_score: 0.88,
          keywords: ['quantum computing', 'qubit'],
          updated_at: '2026-04-08T00:00:00.000Z',
          last_review_decision: 'watch',
          last_review_reason: 'Needs one more cycle',
          last_reviewer: 'qa',
          last_decided_at: '2026-04-07T00:00:00.000Z',
        }],
      };
    }
    if (/GROUP BY COALESCE\(dt.promotion_state/.test(sql)) {
      return {
        rows: [
          { promotion_state: 'watch', count: 9 },
          { promotion_state: 'canonical', count: 2 },
          { promotion_state: 'suppressed', count: 3 },
        ],
      };
    }
    return { rows: [], rowCount: 0, command: 'OK' };
  };

  const payload = await buildDiscoveryTriagePayload(safeQuery, new URLSearchParams('limit=5'));
  assert.equal(payload.summary.watch, 9);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].normalizedTheme, 'quantum-computing');
  assert.equal(payload.items[0].lastReview.decision, 'watch');
  assert.ok(payload.items[0].structuralScore > 0);
});

test('applyDiscoveryTriageDecision updates topic and returns review metadata', async () => {
  const writes = [];
  const queryable = {
    async query(sql, values = []) {
      writes.push({ sql, values });
      if (/SELECT\s+id,\s+label,\s+promotion_state,\s+normalized_theme/s.test(sql)) {
        return {
          rows: [{
            id: 'dt-robotics',
            label: 'Robotics Cluster',
            promotion_state: 'watch',
            normalized_theme: 'robotics-automation',
            normalized_parent_theme: 'technology-general',
            normalized_category: 'technology',
          }],
        };
      }
      if (/UPDATE discovery_topics/.test(sql)) {
        return {
          rows: [{
            id: 'dt-robotics',
            label: 'Robotics Cluster',
            category: 'technology',
            parent_theme: 'technology-general',
            normalized_theme: 'robotics-automation',
            normalized_parent_theme: 'technology-general',
            normalized_category: 'technology',
            promotion_state: 'canonical',
            suppression_reason: null,
            quality_flags: [],
            status: 'reported',
            article_count: 50,
            momentum: 2.1,
            research_momentum: 1.2,
            novelty: 0.4,
            source_quality_score: 0.9,
            keywords: ['robotics'],
            updated_at: '2026-04-08T00:00:00.000Z',
          }],
        };
      }
      return { rows: [], rowCount: 1, command: 'OK' };
    },
  };

  const result = await applyDiscoveryTriageDecision(queryable, {
    topicId: 'dt-robotics',
    decision: 'canonical',
    reviewer: 'tester',
  });
  assert.equal(result.ok, true);
  assert.equal(result.topic.promotionState, 'canonical');
  assert.equal(result.review.reviewer, 'tester');
  assert.equal(result.review.normalizedParentTheme, 'technology-general');
  assert.equal(result.review.normalizedCategory, 'technology');
  assert.ok(writes.some((entry) => /INSERT INTO discovery_topic_reviews/.test(entry.sql)));
});

test('applyDiscoveryTriageDecision preserves explicit parent/category hints when theme is absent', async () => {
  const queryable = {
    async query(sql) {
      if (/SELECT\s+id,\s+label,\s+promotion_state,\s+normalized_theme/s.test(sql)) {
        return {
          rows: [{
            id: 'dt-frontier-materials',
            label: 'Frontier Materials',
            promotion_state: 'watch',
            normalized_theme: '',
            normalized_parent_theme: '',
            normalized_category: '',
          }],
        };
      }
      if (/UPDATE discovery_topics/.test(sql)) {
        return {
          rows: [{
            id: 'dt-frontier-materials',
            label: 'Frontier Materials',
            category: 'science',
            parent_theme: 'materials-science',
            normalized_theme: '',
            normalized_parent_theme: 'materials-science',
            normalized_category: 'science',
            promotion_state: 'watch',
            suppression_reason: null,
            quality_flags: [],
            status: 'reported',
            article_count: 18,
            momentum: 0.8,
            research_momentum: 0.7,
            novelty: 0.5,
            source_quality_score: 0.66,
            keywords: ['metamaterials'],
            updated_at: '2026-04-08T00:00:00.000Z',
          }],
        };
      }
      return { rows: [], rowCount: 1, command: 'OK' };
    },
  };

  const result = await applyDiscoveryTriageDecision(queryable, {
    topicId: 'dt-frontier-materials',
    decision: 'watch',
    reviewer: 'tester',
    normalizedParentTheme: 'materials-science',
    normalizedCategory: 'science',
  });
  assert.equal(result.review.normalizedTheme, null);
  assert.equal(result.review.normalizedParentTheme, 'materials-science');
  assert.equal(result.review.normalizedCategory, 'science');
  assert.equal(result.topic.parentTheme, 'materials-science');
  assert.equal(result.topic.category, 'science');
});

test('buildStructuralAlertsPayload returns mapped alert rows', async () => {
  const safeQuery = async (sql) => {
    if (/FROM theme_structural_alerts/.test(sql)) {
      return {
        rows: [{
          alert_key: 'tsa-1',
          theme: 'quantum-computing',
          label: 'Quantum Computing',
          parent_theme: 'technology-general',
          category: 'technology',
          period_type: 'week',
          alert_type: 'acceleration-breakout',
          severity: 'high',
          status: 'open',
          headline: 'Quantum Computing is breaking out on structural momentum',
          detail: 'Acceleration remains elevated.',
          alert_score: 82.4,
          evidence_classes: [{ evidenceClass: 'trend_snapshot', label: 'Trend aggregate', count: 1 }],
          provenance: [{ evidenceClass: 'trend_snapshot', sourceType: 'trend_snapshot', label: 'baseline' }],
          snapshot_date: '2026-04-07',
          first_seen_at: '2026-04-08T00:00:00.000Z',
          last_seen_at: '2026-04-08T00:00:00.000Z',
          updated_at: '2026-04-08T00:00:00.000Z',
          metadata: { acceleration: 22.1 },
        }],
      };
    }
    return { rows: [], rowCount: 0, command: 'OK' };
  };

  const payload = await buildStructuralAlertsPayload(safeQuery, new URLSearchParams('period=week&limit=4'));
  assert.equal(payload.periodType, 'week');
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].severity, 'high');
  assert.equal(payload.items[0].theme, 'quantum-computing');
});
