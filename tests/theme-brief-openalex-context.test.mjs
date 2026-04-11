import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearTrendDashboardProbeCachesForTests,
  loadThemeOpenAlexContext,
} from '../scripts/_shared/trend-dashboard-queries.mjs';

test('loadThemeOpenAlexContext supports modern OpenAlex evidence tables', async () => {
  clearTrendDashboardProbeCachesForTests();

  const safeQuery = async (sql, params = []) => {
    const query = String(sql);
    if (query.includes('SELECT to_regclass($1) AS relation_name')) {
      const relation = String(params[0] || '');
      const supported = new Set([
        'public.theme_openalex_evidence',
        'public.openalex_works',
      ]);
      return {
        rows: [{ relation_name: supported.has(relation) ? relation.replace('public.', '') : null }],
      };
    }

    if (query.includes('FROM information_schema.columns')) {
      const [tableName, columnName] = params;
      const available = new Set([
        'theme_openalex_evidence.search_query',
        'theme_openalex_evidence.matched_keywords',
        'theme_openalex_evidence.research_signal_score',
        'theme_openalex_evidence.theme_match_score',
        'theme_openalex_evidence.evidence_note',
        'openalex_works.title',
        'openalex_works.source_type',
        'openalex_works.primary_topic',
        'openalex_works.language',
        'openalex_works.metadata',
        'openalex_works.landing_page_url',
      ]);
      return {
        rows: available.has(`${tableName}.${columnName}`) ? [{ exists: 1 }] : [],
      };
    }

    if (query.includes('FROM theme_openalex_evidence e')) {
      assert.match(query, /JOIN openalex_works w/i);
      return {
        rows: [
          {
            theme: 'quantum-computing',
            work_id: 'https://openalex.org/W1234567890',
            search_query: 'Quantum Computing qubit quantum processor',
            matched_keywords: ['quantum computing', 'quantum processor'],
            research_signal_score: 0.91,
            cited_by_count: 42,
            publication_year: 2025,
            publication_date: '2025-02-14',
            evidence_note: 'Matched theme keywords: quantum computing, quantum processor',
            updated_at: '2026-04-08T07:00:00.000Z',
            title: 'Fault-Tolerant Quantum Error Correction for Scalable Systems',
            abstract_text: 'Quantum error correction improves resilience in fault-tolerant architectures.',
            source_display_name: 'Quantum Journal',
            source_type: 'research',
            primary_topic: 'Quantum error correction',
            language: 'en',
            concepts: [{ displayName: 'Quantum computing', score: 0.91 }],
            authorships: [{ author: 'Ada Lovelace' }],
            metadata: { type: 'article' },
            landing_page_url: 'https://example.org/quantum-paper',
          },
        ],
      };
    }

    throw new Error(`Unexpected query in loadThemeOpenAlexContext test: ${query}`);
  };

  const context = await loadThemeOpenAlexContext(safeQuery, 'quantum-computing');

  assert.equal(context.status, 'connected');
  assert.equal(context.works.length, 1);
  assert.equal(context.works[0].workId, 'https://openalex.org/W1234567890');
  assert.equal(context.works[0].sourceDisplayName, 'Quantum Journal');
  assert.equal(context.works[0].researchSignalScore, 0.91);
  assert.equal(context.summary.workCount, 1);
  assert.equal(context.summary.totalCitations, 42);
  assert.deepEqual(context.summary.topConcepts, ['Quantum computing']);
  assert.equal(context.provenance[0].type, 'openalex_research');
});
