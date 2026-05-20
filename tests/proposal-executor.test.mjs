import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifySeedItemTheme,
  parseResolvedSourceItems,
  proposalKey,
  resolveAddRssApprovalGate,
  sanitizeFeedDisplayName,
} from '../scripts/proposal-executor.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executorPath = resolve(repoRoot, 'scripts/proposal-executor.mjs');

function readExecutorSource() {
  return readFileSync(executorPath, 'utf-8');
}

describe('proposal-executor', () => {
  it('script file exists and is valid JavaScript', () => {
    const content = readExecutorSource();
    assert.ok(content.includes('executeProposal'));
    assert.ok(content.includes('handleAddSymbol'));
    assert.ok(content.includes('handleAddRss'));
    assert.ok(content.includes('handleAddTheme'));
    assert.ok(content.includes('handleValidate'));
    assert.ok(content.includes('handleRemoveSymbol'));
  });
it('supports all 6 proposal types', () => {
  const content = readExecutorSource();
  assert.ok(content.includes("'add-symbol'"));
  assert.ok(content.includes("'add-rss'"));
  assert.ok(content.includes("'add-theme'"));
  assert.ok(content.includes("'attach-theme'"));
  assert.ok(content.includes("'validate'"));
  assert.ok(content.includes("'remove-symbol'"));
});
  it('creates codex_proposals table', () => {
    const content = readExecutorSource();
    assert.ok(content.includes('ensureCodexProposalSchema'));
    assert.ok(content.includes('codex_proposals'));
  });
it('handles add-theme assets as symbol inputs', () => {
  const content = readExecutorSource();
  assert.ok(content.includes('const assets = Array.isArray(proposal?.assets) ? proposal.assets : [];'));
  assert.ok(content.includes('...assets'));
  assert.ok(content.includes('.map((sym) => (typeof sym === \'string\' ? sym : sym?.symbol))'));
});

it('supports attach-theme execution summaries', () => {
  const content = readExecutorSource();
  assert.ok(content.includes('handleAttachTheme'));
  assert.ok(content.includes('attachmentKey'));
  assert.ok(content.includes('targetTheme'));
  assert.ok(content.includes('transmissionOrder'));
});

it('uses source-probe registration for add-rss execution and counts inserted rows', () => {
  const content = readExecutorSource();
  assert.ok(content.includes('registerProbedSource'));
  assert.ok(content.includes('fetchResolvedSourceItems(effectiveUrl, probe.sampleItems)'));
  assert.ok(content.includes('backfillActiveRssSources'));
  assert.ok(content.includes('downstreamBackfill'));
  assert.ok(content.includes('insertResult?.rowCount'));
  assert.ok(content.includes("probe.nextAction === 'reject' || probe.nextAction === 'manual-adapter'"));
  assert.ok(content.includes('attemptSourceRepair'));
  assert.ok(content.includes('source-repaired'));
  assert.ok(content.includes('repair?.best?.category'));
  assert.ok(content.includes('topics: effectiveTopics'));
  assert.match(content, /humanApproved:\s*options\.humanApproved/);
  assert.match(content, /budgetExempt:\s*options\.humanApproved/);
});

it('sanitizes generated source proposal names before article seeding', () => {
  assert.equal(
    sanitizeFeedDisplayName('Codex E2E The Register source 20260422', 'https://www.theregister.com/headlines.atom'),
    'The Register',
  );
  assert.equal(
    sanitizeFeedDisplayName('Eastern Mediterranean War-Risk Insurance Repricing source', 'https://www.iata.org/feed.xml'),
    'IATA',
  );
  assert.equal(
    sanitizeFeedDisplayName('BleepingComputer source', 'https://www.bleepingcomputer.com/feed/'),
    'BleepingComputer',
  );
});

it('classifies seeded RSS items by article title before falling back to source theme', () => {
  const broadProbe = { qualityBreakdown: { themeRelevance: 0.2 } };
  assert.equal(
    classifySeedItemTheme({ title: 'Apple expands AI tooling for developers' }, 'The Register', 'cybersecurity', broadProbe),
    'ai-ml',
  );
  assert.equal(
    classifySeedItemTheme({ title: 'Ransomware group claims new breach' }, 'The Register', 'cybersecurity', broadProbe),
    'cybersecurity',
  );
  assert.equal(
    classifySeedItemTheme({ title: 'General technology platform update' }, 'The Register', 'cybersecurity', broadProbe),
    'technology-general',
  );
  assert.equal(
    classifySeedItemTheme({ title: 'Ship Owners Move Towards Second Hand Vessels' }, 'Hellenic Shipping News', 'defense', broadProbe),
    'supply-chain-security',
  );
  assert.equal(
    classifySeedItemTheme({ title: 'Analysts view: UK unemployment masks labour market weakness' }, 'Hellenic Shipping News', 'defense', broadProbe),
    'unknown',
  );
  assert.equal(
    classifySeedItemTheme({ title: 'Pentagon wants $54B for drones and air defense procurement' }, 'Defense News', 'defense', broadProbe),
    'defense-industrial',
  );
  assert.equal(
    classifySeedItemTheme({ title: 'Offshore vessel completes port operation' }, 'Offshore Energy', 'supply-chain-security', broadProbe),
    'supply-chain-security',
  );
});

it('keeps distinct attach-theme proposals separate in retry identity', () => {
  const first = proposalKey({
    type: 'attach-theme',
    targetTheme: 'semiconductor',
    attachmentKey: 'packaging-bottleneck',
  });
  const second = proposalKey({
    type: 'attach-theme',
    targetTheme: 'semiconductor',
    attachmentKey: 'china-export-controls',
  });

  assert.notEqual(first, second);
  assert.match(first, /packaging-bottleneck/);
  assert.match(second, /china-export-controls/);
});

it('uses the same approval gate for add-rss dry-run and execution paths', () => {
  const untrusted = resolveAddRssApprovalGate({
    url: 'https://example.com/feed.xml',
    proposal: {},
  });
  assert.equal(untrusted.requiresApproval, true);

  const humanApproved = resolveAddRssApprovalGate({
    url: 'https://example.com/feed.xml',
    proposal: { human_approved: true },
  });
  assert.equal(humanApproved.requiresApproval, false);

  const crossDomainRepair = resolveAddRssApprovalGate({
    url: 'https://other.example.com/feed.xml',
    originalUrl: 'https://example.com/',
    proposal: { human_approved: true },
    repaired: true,
  });
  assert.equal(crossDomainRepair.requiresApproval, true);
  assert.equal(crossDomainRepair.crossDomainRepairRequiresApproval, true);
});

it('parses resolved RSS and sitemap documents for canonical seeding', () => {
  const rssItems = parseResolvedSourceItems(`
    <rss><channel>
      <item>
        <title><![CDATA[First item]]></title>
        <link>/first</link>
        <pubDate>Tue, 21 Apr 2026 00:00:00 GMT</pubDate>
      </item>
    </channel></rss>
  `, 'https://example.com/feed.xml');
  assert.deepEqual(rssItems, [{
    title: 'First item',
    url: 'https://example.com/first',
    date: '2026-04-21T00:00:00.000Z',
  }]);

  const sitemapItems = parseResolvedSourceItems(`
    <urlset>
      <url>
        <loc>https://example.com/news/source-one</loc>
        <lastmod>2026-04-20</lastmod>
      </url>
    </urlset>
  `, 'https://example.com/sitemap.xml');
  assert.equal(sitemapItems.length, 1);
  assert.equal(sitemapItems[0].url, 'https://example.com/news/source-one');
  assert.equal(sitemapItems[0].date, '2026-04-20T00:00:00.000Z');
});
});
