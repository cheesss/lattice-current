import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPENALEX_THEME_EVIDENCE_SCHEMA_STATEMENTS,
  buildOpenAlexUrl,
  buildThemeOpenAlexSearch,
  mapOpenAlexWork,
  parseArgs,
  reconstructAbstractFromInvertedIndex,
  runOpenAlexThemeEvidence,
} from '../scripts/fetch-openalex-theme-evidence.mjs';

const SAMPLE_OPENALEX_RESULT = {
  id: 'https://openalex.org/W1234567890',
  display_name: 'Fault-Tolerant Quantum Error Correction for Scalable Systems',
  publication_date: '2025-02-14',
  publication_year: 2025,
  cited_by_count: 42,
  relevance_score: 0.87,
  doi: 'https://doi.org/10.5555/quantum.2025.1',
  primary_location: {
    landing_page_url: 'https://example.org/quantum-paper',
    source: {
      display_name: 'Quantum Journal',
    },
  },
  authorships: [
    { author: { display_name: 'Ada Lovelace' }, institutions: [{ display_name: 'Cambridge Quantum Lab' }] },
    { author: { display_name: 'Grace Hopper' }, institutions: [{ display_name: 'US Naval Research Lab' }] },
  ],
  concepts: [
    { display_name: 'Quantum computing', score: 0.91 },
    { display_name: 'Error correction', score: 0.74 },
  ],
  abstract_inverted_index: {
    fault: [0],
    tolerant: [1],
    quantum: [2],
    error: [3],
    correction: [4],
  },
  primary_topic: {
    display_name: 'Quantum error correction',
  },
  language: 'en',
};

test('fetch-openalex-theme-evidence exports modern and legacy schema tables', () => {
  const joined = OPENALEX_THEME_EVIDENCE_SCHEMA_STATEMENTS.join('\n');
  assert.match(joined, /CREATE TABLE IF NOT EXISTS openalex_works/i);
  assert.match(joined, /CREATE TABLE IF NOT EXISTS theme_openalex_evidence/i);
  assert.match(joined, /CREATE TABLE IF NOT EXISTS openalex_theme_evidence/i);
});

test('fetch-openalex-theme-evidence parses CLI arguments and builds theme queries', () => {
  const parsed = parseArgs([
    '--themes', 'quantum-computing, ai-ml',
    '--limit', '8',
    '--theme-limit', '5',
    '--from-date', '2021-01-01',
    '--dry-run',
  ]);

  assert.deepEqual(parsed.themes, ['quantum-computing', 'ai-ml']);
  assert.equal(parsed.limit, 8);
  assert.equal(parsed.maxWorks, 8);
  assert.equal(parsed.themeLimit, 5);
  assert.equal(parsed.fromDate, '2021-01-01');
  assert.equal(parsed.dryRun, true);

  const search = buildThemeOpenAlexSearch('quantum-computing');
  assert.equal(search.theme, 'quantum-computing');
  assert.match(search.query, /quantum/i);

  const url = buildOpenAlexUrl('quantum-computing', { limit: 8, fromDate: '2021-01-01' });
  assert.match(url, /api\.openalex\.org\/works/i);
  assert.match(url, /from_publication_date%3A2021-01-01|from_publication_date:2021-01-01/i);
});

test('fetch-openalex-theme-evidence rebuilds abstract and maps work/evidence rows', () => {
  const rebuilt = reconstructAbstractFromInvertedIndex(SAMPLE_OPENALEX_RESULT.abstract_inverted_index);
  assert.match(rebuilt, /quantum error correction/i);

  const mapped = mapOpenAlexWork('quantum-computing', SAMPLE_OPENALEX_RESULT);
  assert.ok(mapped);
  assert.equal(mapped.workRow.workId, 'https://openalex.org/W1234567890');
  assert.equal(mapped.workRow.sourceDisplayName, 'Quantum Journal');
  assert.equal(mapped.evidenceRow.theme, 'quantum-computing');
  assert.ok(mapped.evidenceRow.themeMatchScore > 0);
  assert.ok(mapped.evidenceRow.matchedKeywords.includes('quantum computing'));
});

test('fetch-openalex-theme-evidence dry-run returns sample summaries without pg access', async () => {
  const summary = await runOpenAlexThemeEvidence(
    {
      themes: ['quantum-computing'],
      dryRun: true,
      limit: 4,
      fromDate: '2021-01-01',
    },
    {
      fetchImpl: async (url) => {
        const key = typeof url === 'string' ? url : String(url);
        assert.match(key, /openalex/i);
        return {
          ok: true,
          json: async () => ({
            results: [SAMPLE_OPENALEX_RESULT],
          }),
        };
      },
    },
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.themeCount, 1);
  assert.equal(summary.workCount, 1);
  assert.equal(summary.evidenceCount, 1);
  assert.equal(summary.themes[0].theme, 'quantum-computing');
  assert.equal(summary.sample.works[0].title, 'Fault-Tolerant Quantum Error Correction for Scalable Systems');
});
