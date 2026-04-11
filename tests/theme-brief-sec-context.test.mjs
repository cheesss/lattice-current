import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearTrendDashboardProbeCachesForTests,
  loadThemeSecContext,
} from '../scripts/_shared/trend-dashboard-queries.mjs';

test('loadThemeSecContext supports sec_filings_evidence and modern sec_entity_profiles columns', async () => {
  clearTrendDashboardProbeCachesForTests();

  const safeQuery = async (sql, params = []) => {
    const query = String(sql);
    if (query.includes('SELECT to_regclass($1) AS relation_name')) {
      const relation = String(params[0] || '');
      const supported = new Set([
        'public.theme_entity_exposure',
        'public.sec_entity_profiles',
        'public.sec_filings_evidence',
      ]);
      return {
        rows: [{ relation_name: supported.has(relation) ? relation.replace('public.', '') : null }],
      };
    }

    if (query.includes('FROM information_schema.columns')) {
      const [tableName, columnName] = params;
      const available = new Set([
        'sec_entity_profiles.entity_name',
        'sec_entity_profiles.sic_description',
        'sec_entity_profiles.category',
      ]);
      return {
        rows: available.has(`${tableName}.${columnName}`) ? [{ exists: 1 }] : [],
      };
    }

    if (query.includes('FROM theme_entity_exposure e')) {
      assert.match(query, /LEFT JOIN sec_filings_evidence f/i);
      assert.match(query, /MAX\(p\.entity_name\) AS company_name/i);
      assert.match(query, /MAX\(p\.sic_description\) AS sector_hint/i);
      return {
        rows: [
          {
            theme: 'ai-ml',
            entity_type: 'company',
            entity_key: 'NVDA',
            relation_type: 'beneficiary',
            sign: 'positive',
            confidence: 0.87,
            horizon: 'long',
            evidence_source: 'sec_connector',
            evidence_note: 'Recent filings reinforce AI infrastructure demand.',
            updated_at: '2026-04-08T05:00:00.000Z',
            cik: '0001045810',
            ticker: 'NVDA',
            company_name: 'NVIDIA CORP',
            sector_hint: 'Semiconductors',
            filing_count: 3,
            latest_filed_at: '2026-03-31',
            recent_forms: ['10-K', '10-Q', '8-K'],
          },
        ],
      };
    }

    throw new Error(`Unexpected query in loadThemeSecContext test: ${query}`);
  };

  const context = await loadThemeSecContext(safeQuery, 'ai-ml');

  assert.equal(context.status, 'connected');
  assert.equal(context.entities.length, 1);
  assert.equal(context.entities[0].entityKey, 'NVDA');
  assert.equal(context.entities[0].ticker, 'NVDA');
  assert.equal(context.entities[0].companyName, 'NVIDIA CORP');
  assert.equal(context.entities[0].sectorHint, 'Semiconductors');
  assert.equal(context.entities[0].filingCount, 3);
  assert.deepEqual(context.entities[0].recentForms, ['10-K', '10-Q', '8-K']);
  assert.equal(context.provenance[0].type, 'sec_connector');
});
