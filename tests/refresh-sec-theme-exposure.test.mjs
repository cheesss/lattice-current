import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSeedUniverse,
  parseArgs,
  runSecSeedUniverse,
} from '../scripts/refresh-sec-theme-exposure.mjs';

test('refresh-sec-theme-exposure parses practical batch flags', () => {
  const parsed = parseArgs([
    '--themes', 'ai-ml,quantum-computing',
    '--symbols', 'nvda,ibm',
    '--limit', '3',
    '--delay-ms', '50',
    '--dry-run',
    '--max-facts', '25',
    '--max-filings', '10',
  ]);

  assert.deepEqual(parsed.themes, ['ai-ml', 'quantum-computing']);
  assert.deepEqual(parsed.symbols, ['NVDA', 'IBM']);
  assert.equal(parsed.limit, 3);
  assert.equal(parsed.delayMs, 50);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.maxFacts, 25);
  assert.equal(parsed.maxFilings, 10);
});

test('refresh-sec-theme-exposure builds a deduplicated seed universe', () => {
  const universe = buildSeedUniverse({ themes: ['ai-ml', 'semiconductor'] });
  const symbols = universe.map((item) => item.symbol);

  assert.ok(symbols.includes('NVDA'));
  assert.ok(symbols.includes('AMD'));
  assert.equal(symbols.filter((symbol) => symbol === 'NVDA').length, 1);
  assert.ok(universe.find((item) => item.symbol === 'NVDA')?.themeHints.includes('ai-ml'));
  assert.ok(universe.find((item) => item.symbol === 'NVDA')?.themeHints.includes('semiconductor'));
});

test('refresh-sec-theme-exposure runs the seed universe through SEC ingest and accumulates results', async () => {
  const seen = [];
  const synthetic = await runSecSeedUniverse(
    {
      themes: ['ai-ml'],
      symbols: ['NVDA', 'MSFT'],
      dryRun: true,
      delayMs: 0,
      limit: 2,
    },
    {
      runSecCompanyFacts: async ({ ticker }) => {
        seen.push(ticker);
        return {
          factCount: 2,
          filingCount: 1,
          exposureCount: 1,
          upsertedExposures: 1,
        };
      },
    },
  );

  assert.equal(synthetic.ok, true);
  assert.equal(synthetic.universeSize, 2);
  assert.equal(synthetic.okCount, 2);
  assert.equal(synthetic.failCount, 0);
  assert.equal(synthetic.totalExposureCount, 2);
  assert.deepEqual(seen, ['NVDA', 'MSFT']);
});
