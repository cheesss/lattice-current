import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDiscoveryTopicRepairRecord,
  parseRepairArgs,
  summarizeLowSignalProposalRows,
} from '../scripts/repair-theme-shell-data.mjs';
import {
  classifyRssProposalSignal,
  isLowSignalAddRssProposal,
} from '../scripts/_shared/rss-proposal-quality.mjs';

test('repair args default to dry-run topic and proposal repair', () => {
  const parsed = parseRepairArgs([]);
  assert.equal(parsed.apply, false);
  assert.equal(parsed.repairTopics, true);
  assert.equal(parsed.pruneLowSignalProposals, true);
});

test('repair record preserves pending topic status unless suppression is newly applied', () => {
  const record = buildDiscoveryTopicRepairRecord({
    id: 'dt-generic-tech',
    label: 'Technology market update',
    description: 'Generic technology coverage',
    category: 'technology',
    stage: 'mature',
    parent_theme: 'technology-general',
    keywords: ['technology', 'market', 'growth'],
    article_count: 120,
    momentum: 1.26,
    research_momentum: 0,
    novelty: 0.08,
    source_quality_score: 0.56,
    status: 'pending',
    has_manual_review: false,
    representative_titles: [
      'Technology market update for software platforms',
      'Latest technology growth report and startup trends',
    ],
    codex_metadata: {},
  });

  assert.equal(record.promotionState, 'watch');
  assert.equal(record.nextStatus, 'pending');
  assert.equal(record.normalizedTheme, null);
});

test('repair record preserves operator-reviewed topics even when reevaluation suppresses them', () => {
  const record = buildDiscoveryTopicRepairRecord({
    id: 'dt-reviewed',
    label: 'Technology market update',
    description: 'Generic technology coverage',
    category: 'technology',
    stage: 'mature',
    parent_theme: 'technology-general',
    keywords: ['technology', 'market', 'growth'],
    article_count: 120,
    momentum: 1.26,
    research_momentum: 0,
    novelty: 0.08,
    source_quality_score: 0.56,
    status: 'reported',
    has_manual_review: true,
    representative_titles: [
      'Technology market update for software platforms',
    ],
    codex_metadata: {},
  });

  assert.equal(record.hasManualReview, true);
  assert.equal(record.nextStatus, 'reported');
});

test('low-signal RSS proposals are detected only for junk auto-generated Google News queries', () => {
  const lowSignal = {
    id: 1,
    proposal_type: 'add-rss',
    payload: {
      url: 'https://news.google.com/rss/search?q=best&hl=en-US&gl=US&ceid=US:en',
      name: 'Google News: best',
    },
    source: 'topic-discovery',
    reasoning: 'auto-generated source proposal for topic dt-123',
  };
  const highSignal = {
    id: 2,
    proposal_type: 'add-rss',
    payload: {
      url: 'https://news.google.com/rss/search?q=%22quantum%20computing%22&hl=en-US&gl=US&ceid=US:en',
      name: 'Google News: quantum computing',
    },
    source: 'topic-discovery',
    reasoning: 'auto-generated source proposal for topic dt-456',
  };
  const realDomain = {
    id: 3,
    proposal_type: 'add-rss',
    payload: {
      url: 'https://www.reuters.com/world/middle-east/',
      name: 'Reuters Middle East',
    },
    source: 'human-review',
    reasoning: 'queued by self-heal',
  };

  assert.equal(isLowSignalAddRssProposal(lowSignal), true);
  assert.equal(isLowSignalAddRssProposal(highSignal), false);
  assert.equal(isLowSignalAddRssProposal(realDomain), false);

  const signal = classifyRssProposalSignal(highSignal);
  assert.equal(signal.meaningfulTerms.includes('quantum computing'), true);
  assert.equal(signal.lowSignal, false);
});

test('proposal repair summary returns only low-signal ids', () => {
  const summary = summarizeLowSignalProposalRows([
    {
      id: 1,
      proposal_type: 'add-rss',
      payload: { url: 'https://news.google.com/rss/search?q=best&hl=en-US&gl=US&ceid=US:en' },
      source: 'topic-discovery',
      reasoning: 'auto-generated source proposal',
    },
    {
      id: 2,
      proposal_type: 'add-rss',
      payload: { url: 'https://www.reuters.com/world/middle-east/' },
      source: 'human-review',
      reasoning: 'queued by self-heal',
    },
  ]);

  assert.equal(summary.scanned, 2);
  assert.deepEqual(summary.lowSignalIds, [1]);
});
