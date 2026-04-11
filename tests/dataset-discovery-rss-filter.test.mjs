import test from 'node:test';
import assert from 'node:assert/strict';

import { proposeDatasetsForThemes } from '../src/services/dataset-discovery.ts';

test('dataset discovery suppresses rss proposals built from generic low-signal terms', () => {
  const proposals = proposeDatasetsForThemes({
    themes: [
      {
        themeId: 'dt-generic-noise',
        label: 'Generic noise topic',
        triggers: ['best', 'you', 'former'],
        sectors: ['minister', 'growth'],
        commodities: [],
        supportingHeadlines: ['best former minister growth'],
        suggestedSymbols: [],
        priority: 72,
      },
    ],
    existingDatasets: [],
  });

  assert.equal(proposals.some((proposal) => proposal.provider === 'rss-feed'), false);
});

test('dataset discovery keeps rss proposals when terms remain specific after filtering', () => {
  const proposals = proposeDatasetsForThemes({
    themes: [
      {
        themeId: 'dt-quantum',
        label: 'Quantum computing',
        triggers: ['quantum computing', 'qubit', 'technology'],
        sectors: ['error correction'],
        commodities: [],
        supportingHeadlines: ['quantum computing qubit roadmap'],
        suggestedSymbols: [],
        priority: 78,
      },
    ],
    existingDatasets: [],
  });

  const rssProposals = proposals.filter((proposal) => proposal.provider === 'rss-feed');
  assert.ok(rssProposals.length > 0);
  assert.equal(rssProposals.some((proposal) => String(proposal.querySummary).includes('technology')), false);
  assert.equal(rssProposals.some((proposal) => String(proposal.querySummary).includes('qubit')), true);
});
