import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Integration-level test for compute-composite-nowcasts: verifies that the
 * gate is actually consulted before an INSERT, and that an abstain result
 * prevents the write path from running.
 *
 * We can't easily instantiate the module's internal Client + pipeline-lock
 * wrapper in a unit test, so we instead verify the shape of the gate
 * wiring: `compute-composite-nowcasts.mjs` imports checkEligibleSources
 * AND calls it before writing marketStress.
 */

import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../scripts/compute-composite-nowcasts.mjs', import.meta.url),
  'utf8',
);

test('compute-composite-nowcasts imports checkEligibleSources', () => {
  assert.match(source, /import \{\s*checkEligibleSources\s*\}/);
});

test('compute-composite-nowcasts calls the gate before writeComposite (marketStress)', () => {
  const marketStressFn = source.slice(source.indexOf('async function computeMarketStress'));
  assert.match(marketStressFn, /checkEligibleSources\(client, \{\s*targetSignal: 'marketStress'/);
  // Abstain branch must short-circuit before writeComposite is invoked
  const abstainBlock = marketStressFn.slice(0, marketStressFn.indexOf('return writeComposite'));
  assert.match(abstainBlock, /gateCheck\.abstain/);
  assert.match(abstainBlock, /return \{ signalName: 'marketStress', skipped: true/);
});

test('compute-composite-nowcasts maps input signals to gate source names', () => {
  assert.match(source, /name: i\.signal/);
});
