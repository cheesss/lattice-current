import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStructuralAlertsPayload } from '../scripts/_shared/trend-dashboard-queries.mjs';

test('buildStructuralAlertsPayload accepts open/active alerts and signal_score fallback', async () => {
  let selectSql = '';
  const safeQuery = async (sql, values = []) => {
    const query = String(sql);
    if (query.includes('CREATE TABLE IF NOT EXISTS') || query.includes('CREATE INDEX IF NOT EXISTS')) {
      return { rows: [] };
    }
    if (query.includes('FROM theme_structural_alerts')) {
      selectSql = query;
      assert.equal(values[0], 'week');
      assert.deepEqual(values[1], ['quantum-computing']);
      return {
        rows: [
          {
            alert_key: 'tsa-compat-001',
            theme: 'quantum-computing',
            label: 'Quantum Computing',
            parent_theme: 'technology-general',
            category: 'technology',
            period_type: 'week',
            alert_type: 'structural-change',
            severity: 'high',
            status: 'open',
            headline: 'Quantum Computing continues to build momentum',
            detail: 'Compatibility fixture',
            signal_score: 81.4,
            evidence_classes: [],
            provenance: [],
            metadata: {},
            source: 'structural-alert-generator',
            updated_at: '2026-04-08T00:00:00.000Z',
          },
        ],
      };
    }
    throw new Error(`Unexpected query: ${query}`);
  };

  const payload = await buildStructuralAlertsPayload(safeQuery, new URLSearchParams([
    ['period', 'week'],
    ['themes', 'quantum-computing'],
    ['limit', '5'],
  ]));

  assert.match(selectSql, /COALESCE\(status, 'open'\) IN \('active', 'open'\)/);
  assert.equal(payload.itemCount, 1);
  assert.equal(payload.alerts[0].alertKey, 'tsa-compat-001');
  assert.equal(payload.alerts[0].signalScore, 81.4);
  assert.equal(payload.alerts[0].alertScore, 81.4);
});
