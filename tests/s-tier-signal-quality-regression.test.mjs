import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  classifyEventLane,
  computeEventProductScore,
  getThemeRelevanceTerms,
} from '../scripts/_shared/event-product-score.mjs';

const ROOT = process.cwd();

function relevance(theme, title) {
  return computeEventProductScore({
    theme,
    title,
    eventDate: new Date().toISOString(),
    articleCount: 5,
    sourceCount: 4,
  }).components.themeRelevance;
}

test('theme relevance uses domain terms, not only literal theme tokens', () => {
  assert.ok(getThemeRelevanceTerms('supply-chain-security').includes('hormuz'));
  assert.ok(relevance('supply-chain-security', 'Japan-linked tanker carrying Saudi oil passes Strait of Hormuz') >= 0.6);
  assert.ok(relevance('cybersecurity', 'Researchers uncover pre-Stuxnet malware targeting engineering software') >= 0.6);
  assert.ok(relevance('clean-energy', 'NOAA warns the next El Nino could lock Earth into a hotter climate') >= 0.6);
  assert.ok(relevance('cloud-infrastructure', 'Maine governor vetoes data center moratorium') >= 0.6);
});

test('catch-all themes remain penalized without direct domain evidence', () => {
  const score = relevance('technology-general', 'Best Buy coupon codes and store discounts for weekend shoppers');
  assert.ok(score < 0.6, `expected broad off-topic item to remain below relevance threshold, got ${score}`);
});

test('raw promoted evidence cannot enter validated lane when theme relevance is weak', () => {
  const scored = computeEventProductScore({
    theme: 'technology-general',
    title: 'Best Buy coupon codes and store discounts for weekend shoppers',
    eventDate: new Date().toISOString(),
    articleCount: 5,
    sourceCount: 4,
    bestEvidenceGrade: 'E2',
    rawMaxAbsTStat: 3,
    promotionEligible: true,
  });
  const lane = classifyEventLane({ ...scored, productScore: scored.productScore, promotionEligible: true });
  assert.notEqual(lane, 'validated');
});

test('daemon full-controls task runs the bounded uplift repair, not the fast feature-only engine', async () => {
  const source = await readFile(path.join(ROOT, 'scripts/master-daemon.mjs'), 'utf8');
  assert.match(source, /repair-recent-event-uplift\.mjs/, 'full-controls should call the uplift repair script');
  assert.match(source, /bootstrap-market-quote-history/, 'daemon should bootstrap auto-theme symbol history');
  assert.match(source, /refresh-market-quotes-to-nas\.mjs --include-auto-theme-symbols/, 'quote refresh should include active theme symbols');
  assert.match(source, /node --import tsx scripts\/build-market-returns\.mjs/, 'market returns should not depend on a local Python psycopg2 install');
});

test('release readiness fails when S-tier semantic health is warning', async () => {
  const source = await readFile(path.join(ROOT, 'scripts/check-release-readiness.mjs'), 'utf8');
  assert.match(source, /\/api\/product-quality/, 'release gate should inspect product quality');
  assert.match(source, /\/api\/ops\/status/, 'release gate should inspect ops status');
  assert.match(source, /summary\.level/, 'release gate should check semantic summary level, not only HTTP 200');
  assert.match(source, /semantic-health', 'FAIL'/, 'semantic warning should fail release readiness');
});

test('auto-pipeline labels outcome horizons using entry and target exit prices', async () => {
  const source = await readFile(path.join(ROOT, 'scripts/auto-pipeline.mjs'), 'utf8');
  assert.match(source, /pricesBySymbol/, 'labeler should load a reusable in-memory price series');
  assert.match(source, /FROM market_quotes/, 'labeler should use current market quote history in addition to warm store');
  assert.match(source, /firstAtOrAfter\(series, pubTime \+ horizon\.days \* 86_400_000\)/, 'exit lookup should target the requested horizon date');
});

test('auto-pipeline outcome labeler skips immature latest articles instead of starving mature backlog', async () => {
  const source = await readFile(path.join(ROOT, 'scripts/auto-pipeline.mjs'), 'utf8');
  assert.match(source, /OUTCOME_HORIZONS/, 'outcome horizons should be centralized for maturity checks');
  assert.match(source, /a\.published_at <= NOW\(\) - \(oh\.days::int \* INTERVAL '1 day'\)/, 'candidate query should only select matured horizons');
  assert.match(source, /lo\.article_id IS NULL/, 'candidate query should only select missing matured labels');
});

test('event uplift signal queue ranks fresh validated signals ahead of historical high magnitude archives', async () => {
  const apiSource = await readFile(path.join(ROOT, 'scripts/event-dashboard-api.mjs'), 'utf8');
  const dashboardSource = await readFile(path.join(ROOT, 'event-dashboard.html'), 'utf8');
  assert.match(apiSource, /fresh_validated/, 'API should expose a freshness lane for validated signals');
  assert.match(apiSource, /CASE ce\.freshness_lane/, 'API should order validated signals by freshness lane before raw strength');
  assert.match(dashboardSource, /No fresh E2 signal is available yet/, 'dashboard should explain fallback to historical validated signals');
});
