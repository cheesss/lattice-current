import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearTrendDashboardProbeCachesForTests,
  loadThemeGitHubContext,
} from '../scripts/_shared/trend-dashboard-queries.mjs';

test('loadThemeGitHubContext supports theme_github_evidence and github_repositories', async () => {
  clearTrendDashboardProbeCachesForTests();

  const safeQuery = async (sql, params = []) => {
    const query = String(sql);
    if (query.includes('SELECT to_regclass($1) AS relation_name')) {
      const relation = String(params[0] || '');
      const supported = new Set([
        'public.theme_github_evidence',
        'public.github_repositories',
      ]);
      return {
        rows: [{ relation_name: supported.has(relation) ? relation.replace('public.', '') : null }],
      };
    }

    if (query.includes('FROM information_schema.columns')) {
      const [tableName, columnName] = params;
      const available = new Set([
        'github_repositories.homepage_url',
        'github_repositories.created_at_github',
        'github_repositories.updated_at_github',
      ]);
      return {
        rows: available.has(`${tableName}.${columnName}`) ? [{ exists: 1 }] : [],
      };
    }

    if (query.includes('FROM theme_github_evidence e')) {
      return {
        rows: [
          {
            theme: 'quantum-computing',
            search_query: '"Quantum Computing" OR "qubit"',
            matched_keywords: ['quantum computing', 'qubit'],
            github_signal_score: 7.2,
            stargazers_count: 1420,
            pushed_at: '2026-04-07T00:00:00.000Z',
            evidence_note: 'Matched theme keywords and recent code activity',
            updated_at: '2026-04-08T00:00:00.000Z',
            repo_key: 'R_kgDOExample',
            full_name: 'open-quantum/quantum-stack',
            owner_login: 'open-quantum',
            name: 'quantum-stack',
            html_url: 'https://github.com/open-quantum/quantum-stack',
            description: 'Open-source quantum computing toolkit.',
            homepage_url: 'https://example.org/quantum-stack',
            language: 'Python',
            topics: ['quantum-computing', 'simulation'],
            forks_count: 210,
            watchers_count: 1420,
            open_issues_count: 14,
            default_branch: 'main',
            license_name: 'Apache-2.0',
            created_at_github: '2024-01-01T00:00:00.000Z',
            updated_at_github: '2026-04-01T00:00:00.000Z',
            metadata: { visibility: 'public' },
          },
        ],
      };
    }

    throw new Error(`Unexpected query in loadThemeGitHubContext test: ${query}`);
  };

  const context = await loadThemeGitHubContext(safeQuery, 'quantum-computing');

  assert.equal(context.status, 'connected');
  assert.equal(context.repos.length, 1);
  assert.equal(context.repos[0].fullName, 'open-quantum/quantum-stack');
  assert.equal(context.repos[0].ownerLogin, 'open-quantum');
  assert.equal(context.summary.repoCount, 1);
  assert.equal(context.summary.totalStars, 1420);
  assert.equal(context.provenance[0].type, 'github_code');
});
