import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRepairPrompt } from '../scripts/source-adapter-proposal.mjs';

function makeFailedProbe(overrides = {}) {
  return {
    inputUrl: 'https://example.com',
    resolvedUrl: null,
    domain: 'example.com',
    status: 'failed',
    connectorKind: 'manual',
    adapterTried: ['direct-feed', 'html-alternate-feed', 'wordpress-rss'],
    qualityScore: 0,
    qualityBreakdown: {
      fetchOk: false,
      parseOk: false,
      itemCount: 0,
      recentItemCount: 0,
      titleDiversity: 0,
      duplicateRate: 0,
      spamRate: 0,
      language: null,
      themeRelevance: 0,
      sourceFreshness: 0,
    },
    sampleItems: [],
    errors: [
      { adapter: 'direct-feed', message: 'Not RSS or Atom content' },
      { adapter: 'html-alternate-feed', message: 'No alternate feed link found in HTML' },
      { adapter: 'wordpress-rss', message: 'No WordPress feed convention matched' },
    ],
    warnings: [],
    nextAction: 'reject',
    traceId: 'probe-test-abc123',
    ...overrides,
  };
}

function makePassedProbe(overrides = {}) {
  return {
    inputUrl: 'https://example.com',
    resolvedUrl: 'https://example.com/feed',
    domain: 'example.com',
    status: 'success',
    connectorKind: 'html-alternate-feed',
    adapterTried: ['direct-feed', 'html-alternate-feed'],
    qualityScore: 0.82,
    qualityBreakdown: {
      fetchOk: true,
      parseOk: true,
      itemCount: 15,
      recentItemCount: 8,
      titleDiversity: 1,
      duplicateRate: 0,
      spamRate: 0,
      language: 'en',
      themeRelevance: 0.5,
      sourceFreshness: 0.9,
    },
    sampleItems: [
      { title: 'Breaking: Market Rally', url: 'https://example.com/1', publishedAt: new Date().toUTCString() },
    ],
    errors: [
      { adapter: 'direct-feed', message: 'Not RSS or Atom content' },
    ],
    warnings: [],
    nextAction: 'review',
    traceId: 'probe-test-def456',
    ...overrides,
  };
}

test('buildRepairPrompt contains URL and errors', () => {
  const url = 'https://failing-site.example.com/news';
  const theme = 'geopolitics';
  const probe = makeFailedProbe({ inputUrl: url });

  const prompt = buildRepairPrompt(url, theme, probe);

  assert.ok(prompt.includes(url), 'prompt should contain the input URL');
  assert.ok(prompt.includes(theme), 'prompt should contain the theme');
  assert.ok(prompt.includes('Codex'), 'prompt should identify Codex as the repair agent');
  assert.ok(prompt.includes('Do not use Claude Code'), 'prompt should forbid Claude Code');
  assert.ok(prompt.includes('direct-feed'), 'prompt should list direct-feed adapter');
  assert.ok(prompt.includes('html-alternate-feed'), 'prompt should list html-alternate-feed adapter');
  assert.ok(prompt.includes('wordpress-rss'), 'prompt should list wordpress-rss adapter');
  assert.ok(prompt.includes('Not RSS or Atom content'), 'prompt should contain direct-feed error message');
  assert.ok(prompt.includes('No alternate feed link found in HTML'), 'prompt should contain html-alternate-feed error message');
  assert.ok(prompt.includes('probe-test-abc123'), 'prompt should include the traceId');
  assert.ok(prompt.includes('failed'), 'prompt should include probe status');
  assert.ok(prompt.includes('reject'), 'prompt should include nextAction');
  assert.ok(prompt.includes(`"inputUrl": "${url}"`), 'prompt should embed inputUrl in the JSON template');
  assert.ok(prompt.includes('proposalType'), 'prompt should include proposalType field hint');
  assert.ok(prompt.includes('requiresManualReview'), 'prompt should include requiresManualReview hint');
});

test('probe passed skips repair', () => {
  const probe = makePassedProbe({ nextAction: 'review' });
  const skipRepair = probe.nextAction === 'register' || probe.nextAction === 'review';
  assert.ok(skipRepair, "nextAction 'review' should bypass the repair path");

  const output = {
    message: 'Source probe passed - no repair needed',
    probe: {
      status: probe.status,
      resolvedUrl: probe.resolvedUrl,
      connectorKind: probe.connectorKind,
      qualityScore: probe.qualityScore,
      nextAction: probe.nextAction,
    },
  };

  assert.equal(output.message, 'Source probe passed - no repair needed');
  assert.equal(output.probe.nextAction, 'review');
  assert.equal(output.probe.status, 'success');
  assert.ok(output.probe.qualityScore > 0, 'passed probe should have non-zero quality score');
  assert.doesNotThrow(() => buildRepairPrompt(probe.inputUrl, 'general', probe));
});

test('probe failed generates structured packet with codexPrompt', () => {
  const url = 'https://broken-source.example.org';
  const theme = 'energy';
  const probe = makeFailedProbe({
    inputUrl: url,
    status: 'failed',
    nextAction: 'reject',
    connectorKind: 'manual',
    adapterTried: ['direct-feed', 'html-alternate-feed', 'wordpress-rss', 'sitemap-news', 'json-ld'],
    errors: [
      { adapter: 'direct-feed', message: 'HTTP error fetching https://broken-source.example.org' },
      { adapter: 'sitemap-news', message: 'No sitemap found' },
    ],
    warnings: ['Probe overall timeout reached; remaining adapters skipped'],
    traceId: 'probe-test-ghi789',
  });

  const needsRepair = probe.nextAction !== 'register' && probe.nextAction !== 'review';
  assert.ok(needsRepair, "nextAction 'reject' should enter the repair path");

  const codexPrompt = buildRepairPrompt(url, theme, probe);
  const packet = {
    url,
    theme,
    probe: {
      status: probe.status,
      connectorKind: probe.connectorKind,
      qualityScore: probe.qualityScore,
      nextAction: probe.nextAction,
      adapterTried: probe.adapterTried,
      errors: probe.errors,
      warnings: probe.warnings,
      traceId: probe.traceId,
    },
    codexPrompt,
  };

  assert.ok('codexPrompt' in packet, 'packet must contain codexPrompt');
  assert.ok('probe' in packet, 'packet must contain probe');
  assert.equal(packet.probe.status, 'failed');
  assert.equal(packet.probe.nextAction, 'reject');
  assert.equal(packet.probe.connectorKind, 'manual');
  assert.equal(packet.probe.qualityScore, 0);
  assert.equal(packet.probe.traceId, 'probe-test-ghi789');
  assert.equal(packet.probe.warnings.length, 1);
  assert.ok(packet.probe.warnings[0].includes('timeout'), 'warning should mention timeout');
  assert.ok(typeof packet.codexPrompt === 'string', 'codexPrompt must be a string');
  assert.ok(packet.codexPrompt.length > 200, 'codexPrompt should be substantive');
  assert.ok(packet.codexPrompt.includes(url), 'codexPrompt must embed the URL');
  assert.ok(packet.codexPrompt.includes(theme), 'codexPrompt must embed the theme');
  assert.ok(packet.codexPrompt.includes('HTTP error fetching'), 'codexPrompt must include adapter error text');
  assert.ok(packet.codexPrompt.includes('probe-test-ghi789'), 'codexPrompt must include traceId');
  assert.ok(packet.codexPrompt.includes('human review'), 'codexPrompt must mention human review');
});
