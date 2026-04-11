import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/generate-codex-theme-proposals.mjs', import.meta.url), 'utf8');

test('theme proposal prompt contract explicitly supports propose, attach, and reject decisions', () => {
  assert.match(source, /Return "reject" if the topic mostly overlaps an existing theme\./);
  assert.match(source, /Return "attach" if the topic is not distinct enough for a new canonical theme/);
  assert.match(source, /Return "propose" only if the topic is distinct, durable, investable, and explainable/);
  assert.match(source, /If decision is "reject", proposal and attachment must both be null\./);
  assert.match(source, /If decision is "attach", proposal must be null and attachment must be populated\./);
  assert.match(source, /If decision is "propose", proposal\.assets must contain 2-8 valid liquid symbols\./);
  assert.match(source, /If decision is "attach", attachment\.assets must contain 1-8 valid liquid symbols/);
  assert.match(source, /attachment\.targetTheme must be one of the existing themes below\./);
});

test('theme proposal prompt schema includes dedicated proposal and attachment objects', () => {
  assert.match(source, /"decision":"propose\|attach\|reject"/);
  assert.match(source, /"proposal":\{/);
  assert.match(source, /"attachment":\{/);
  assert.match(source, /"targetTheme":"existing-theme-id"/);
  assert.match(source, /"relationType":"supplier\|infrastructure\|insurance\|regional-proxy\|hedge\|substitute\|direct-beneficiary"/);
  assert.match(source, /"transmissionOrder":"direct\|second-order\|third-order\|fourth-order\|proxy"/);
});

