import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFailureRootCause,
  parseArgs,
  selectAcceptedRepairAttempt,
} from '../scripts/run-source-repair-closed-loop.mjs';

describe('source repair closed loop', () => {
  it('defaults to the production closed-loop repair policy', () => {
    const args = parseArgs([]);

    assert.equal(args.targetSuccesses, 20);
    assert.equal(args.limit, 300);
    assert.equal(args.maxCandidates, 48);
    assert.equal(args.dailyRssBudget, 120);
    assert.equal(args.catalogBootstrap, true);
    assert.equal(args.fullHeuristic, true);
    assert.equal(args.countHistoricalSuccesses, true);
    assert.equal(args.enableCodeRepair, true);
  });

  it('parses apply mode and target controls', () => {
    const args = parseArgs([
      '--apply',
      '--target-successes',
      '12',
      '--limit',
      '140',
      '--daily-rss-budget',
      '90',
      '--catalog-bootstrap',
      '--full-heuristic',
      '--count-historical-successes',
      '--no-probe-original',
      '--no-full-heuristic',
      '--no-catalog-bootstrap',
      '--no-count-historical-successes',
      '--disable-code-repair',
      '--max-code-repair-requests',
      '5',
      '--no-refresh-discovery',
    ]);

    assert.equal(args.apply, true);
    assert.equal(args.targetSuccesses, 12);
    assert.equal(args.limit, 140);
    assert.equal(args.dailyRssBudget, 90);
    assert.equal(args.catalogBootstrap, false);
    assert.equal(args.fullHeuristic, false);
    assert.equal(args.countHistoricalSuccesses, false);
    assert.equal(args.probeOriginal, false);
    assert.equal(args.enableCodeRepair, false);
    assert.equal(args.maxCodeRepairRequests, 5);
    assert.equal(args.refreshDiscovery, false);
  });

  it('keeps adjacent bare boolean flags enabled', () => {
    const args = parseArgs([
      '--catalog-bootstrap',
      '--full-heuristic',
      '--count-historical-successes',
      '--target-successes',
      '20',
    ]);

    assert.equal(args.catalogBootstrap, true);
    assert.equal(args.fullHeuristic, true);
    assert.equal(args.countHistoricalSuccesses, true);
    assert.equal(args.targetSuccesses, 20);
  });

  it('selects a non-active accepted repair candidate by quality', () => {
    const used = new Set(['https://used.example/feed']);
    const active = new Set(['https://active.example/feed']);
    const selected = selectAcceptedRepairAttempt([
      {
        accepted: true,
        url: 'https://active.example/feed',
        qualityScore: 0.99,
      },
      {
        accepted: true,
        url: 'https://candidate-b.example/feed',
        qualityScore: 0.78,
      },
      {
        accepted: true,
        url: 'https://candidate-a.example/feed',
        qualityScore: 0.91,
      },
      {
        accepted: false,
        url: 'https://candidate-c.example/feed',
        qualityScore: 1,
      },
    ], used, active);

    assert.equal(selected.url, 'https://candidate-a.example/feed');
  });

  it('requires event-map linkage for applied end-to-end success accounting', async () => {
    const source = await import('node:fs/promises')
      .then((fs) => fs.readFile(new URL('../scripts/run-source-repair-closed-loop.mjs', import.meta.url), 'utf8'));
    assert.match(source, /eventMapped/);
    assert.match(source, /isEndToEndSourceSuccess[\s\S]*backfill\?\.eventMapped/);
  });

  it('scheduler and daemon run the repair loop with heuristic repair enabled', async () => {
    const [scheduler, daemon] = await Promise.all([
      import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/services/server/intelligence-automation.ts', import.meta.url), 'utf8')),
      import('node:fs/promises').then((fs) => fs.readFile(new URL('../scripts/master-daemon.mjs', import.meta.url), 'utf8')),
    ]);
    assert.match(scheduler, /run-source-repair-closed-loop\.mjs[\s\S]*--full-heuristic/);
    assert.match(scheduler, /SOURCE_REPAIR_MAX_CANDIDATES \|\| 48/);
    assert.match(scheduler, /`--max-candidates \$\{maxCandidates\}`/);
    assert.match(daemon, /run-source-repair-closed-loop\.mjs[\s\S]*--full-heuristic/);
    assert.match(daemon, /SOURCE_REPAIR_MAX_CANDIDATES \|\| 48/);
  });

  it('npm scripts run the repair loop with the same production policy', async () => {
    const packageJson = JSON.parse(await import('node:fs/promises')
      .then((fs) => fs.readFile(new URL('../package.json', import.meta.url), 'utf8')));
    assert.match(packageJson.scripts['source:repair:closed-loop'], /--full-heuristic/);
    assert.match(packageJson.scripts['source:repair:closed-loop'], /--catalog-bootstrap/);
    assert.match(packageJson.scripts['source:repair:closed-loop'], /--count-historical-successes/);
    assert.match(packageJson.scripts['source:repair:closed-loop'], /--target-successes 20/);
  });

  it('builds a structured root cause for failed original probes', () => {
    const rootCause = buildFailureRootCause({
      proposal: { url: 'https://example.com/', theme: 'defense' },
      originalProbe: {
        nextAction: 'reject',
        resolvedUrl: 'https://example.com/sitemap.xml',
        connectorKind: 'sitemap-news',
        qualityScore: 0.52,
        qualityBreakdown: { recentItemCount: 0 },
        errors: [{ adapter: 'rss', message: 'not rss' }],
      },
    });

    assert.equal(rootCause.category, 'no-recent-feed-items');
    assert.equal(rootCause.nextAction, 'reject');
    assert.equal(rootCause.recentItemCount, 0);
    assert.deepEqual(rootCause.failedAdapters, ['rss']);
    assert.match(rootCause.summary, /quality=0\.52/);
  });

  it('keeps human-approved source registration from being blocked by automation budget exhaustion', async () => {
    const source = await import('node:fs/promises')
      .then((fs) => fs.readFile(new URL('../scripts/_shared/discovered-source-registry.mjs', import.meta.url), 'utf8'));
    assert.match(source, /budgetExempt/);
    assert.match(source, /options\.humanApproved/);
    assert.match(source, /if \(!budgetExempt\)[\s\S]*checkBudget/);
  });
});
