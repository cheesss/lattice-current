import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GITHUB_THEME_EVIDENCE_SCHEMA_STATEMENTS,
  buildGitHubSearchQuery,
  buildGitHubSearchUrl,
  mapGitHubRepository,
  parseArgs,
  runGitHubThemeEvidence,
} from '../scripts/fetch-github-theme-evidence.mjs';

const SAMPLE_GITHUB_REPO = {
  node_id: 'R_kgDOExample',
  full_name: 'open-quantum/quantum-stack',
  name: 'quantum-stack',
  html_url: 'https://github.com/open-quantum/quantum-stack',
  description: 'Open-source quantum computing toolkit with qubit simulation and error correction examples.',
  homepage: 'https://example.org/quantum-stack',
  language: 'Python',
  topics: ['quantum-computing', 'qubit', 'simulation'],
  stargazers_count: 1420,
  watchers_count: 1420,
  forks_count: 210,
  open_issues_count: 14,
  default_branch: 'main',
  license: { spdx_id: 'Apache-2.0', name: 'Apache License 2.0' },
  archived: false,
  fork: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
  pushed_at: '2026-04-07T00:00:00Z',
  owner: { login: 'open-quantum' },
  score: 1,
  visibility: 'public',
  is_template: false,
};

test('fetch-github-theme-evidence exports schema and parses CLI arguments', () => {
  const joined = GITHUB_THEME_EVIDENCE_SCHEMA_STATEMENTS.join('\n');
  assert.match(joined, /CREATE TABLE IF NOT EXISTS github_repositories/i);
  assert.match(joined, /CREATE TABLE IF NOT EXISTS theme_github_evidence/i);

  const parsed = parseArgs([
    '--themes', 'quantum-computing, ai-ml',
    '--limit', '7',
    '--dry-run',
  ]);
  assert.deepEqual(parsed.themes, ['quantum-computing', 'ai-ml']);
  assert.equal(parsed.limit, 7);
  assert.equal(parsed.maxRepos, 7);
  assert.equal(parsed.dryRun, true);
});

test('fetch-github-theme-evidence builds theme queries and maps repository rows', () => {
  const query = buildGitHubSearchQuery('quantum-computing');
  assert.match(query, /quantum/i);
  const url = buildGitHubSearchUrl('quantum-computing', { maxRepos: 6 });
  assert.match(url, /api\.github\.com\/search\/repositories/i);
  assert.match(url, /per_page=6/i);

  const mapped = mapGitHubRepository(SAMPLE_GITHUB_REPO, {
    label: 'Quantum Computing',
    keywords: ['quantum computing', 'qubit', 'quantum error correction'],
  });
  assert.equal(mapped.fullName, 'open-quantum/quantum-stack');
  assert.ok(mapped.matchedKeywords.includes('qubit'));
  assert.ok(mapped.githubSignalScore > 0);
});

test('fetch-github-theme-evidence dry-run returns summaries without pg access', async () => {
  const summary = await runGitHubThemeEvidence(
    {
      themes: ['quantum-computing'],
      dryRun: true,
      maxRepos: 4,
    },
    {
      fetchImpl: async (url) => {
        const key = typeof url === 'string' ? url : String(url);
        assert.match(key, /github\.com\/search\/repositories/i);
        return {
          ok: true,
          json: async () => ({ items: [SAMPLE_GITHUB_REPO] }),
        };
      },
    },
  ).catch((error) => {
    throw error;
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.themeCount, 1);
  assert.equal(summary.repoCount, 1);
  assert.equal(summary.evidenceCount, 1);
  assert.equal(summary.themes[0].theme, 'quantum-computing');
  assert.equal(summary.themes[0].topRepository, 'open-quantum/quantum-stack');
});
