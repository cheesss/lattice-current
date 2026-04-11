import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStructuralAlertsPayload,
  dismissStructuralAlert,
} from '../scripts/_shared/trend-workbench.mjs';

test('buildStructuralAlertsPayload supports followed theme filtering alias', async () => {
  let selectValues = null;
  const safeQuery = async (sql, values = []) => {
    const query = String(sql);
    if (query.includes('CREATE TABLE IF NOT EXISTS') || query.includes('CREATE INDEX IF NOT EXISTS')) {
      return { rows: [] };
    }
    if (query.includes('FROM theme_structural_alerts')) {
      selectValues = values;
      return {
        rows: [
          {
            alert_key: 'tsa-1',
            theme: 'quantum-computing',
            label: 'Quantum Computing',
            parent_theme: 'technology-general',
            category: 'technology',
            period_type: 'week',
            alert_type: 'evidence-delta',
            severity: 'high',
            status: 'open',
            headline: 'Quantum Computing is adding new research evidence faster than the prior window',
            detail: 'Latest evidence count rose from 1 to 5.',
            alert_score: 88,
            evidence_classes: [{ evidenceClass: 'openalex_research', count: 5 }],
            provenance: [{ evidenceClass: 'openalex_research', label: 'Quantum evidence delta' }],
            snapshot_date: '2026-04-07',
            first_seen_at: '2026-04-08T00:00:00.000Z',
            last_seen_at: '2026-04-08T00:00:00.000Z',
            updated_at: '2026-04-08T00:00:00.000Z',
            metadata: { currentEvidenceCount: 5 },
          },
        ],
      };
    }
    throw new Error(`Unexpected query: ${query}`);
  };

  const payload = await buildStructuralAlertsPayload(safeQuery, new URLSearchParams([
    ['period', 'week'],
    ['followed_themes', 'quantum-computing,ai-ml'],
    ['limit', '5'],
  ]));

  assert.equal(payload.periodType, 'week');
  assert.equal(payload.filters.scope, 'followed');
  assert.deepEqual(payload.filters.themes, ['quantum-computing', 'ai-ml']);
  assert.equal(selectValues[2][0], 'quantum-computing');
  assert.equal(payload.items[0].alertType, 'evidence-delta');
  assert.equal(payload.items[0].alertKey, 'tsa-1');
});

test('dismissStructuralAlert updates persisted alert state', async () => {
  const queryable = {
    query: async (sql, values = []) => {
      const query = String(sql);
      if (query.includes('CREATE TABLE IF NOT EXISTS') || query.includes('CREATE INDEX IF NOT EXISTS')) {
        return { rows: [] };
      }
      if (query.includes('UPDATE theme_structural_alerts')) {
        assert.equal(values[0], 'tsa-1');
        return {
          rows: [{ alert_key: 'tsa-1', theme: 'quantum-computing', status: 'dismissed' }],
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    },
  };

  const result = await dismissStructuralAlert(queryable, 'tsa-1');
  assert.equal(result.ok, true);
  assert.equal(result.alertKey, 'tsa-1');
  assert.equal(result.status, 'dismissed');
});
