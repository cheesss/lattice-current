import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Wiring-level checks for compute-rates-nowcast.py so the gate cannot be
 * accidentally dropped in future edits. Mirrors the integration assertions
 * that the .mjs composite test performs.
 */

const source = readFileSync(
  new URL('../scripts/compute-rates-nowcast.py', import.meta.url),
  'utf8',
);

test('compute-rates-nowcast.py imports check_eligible_sources', () => {
  assert.match(source, /from nowcast_source_gate import/);
  assert.match(source, /check_eligible_sources/);
});

test('predict_and_write calls the gate before INSERTing into estimated_signal_nowcasts', () => {
  // Gate call precedes INSERT statement textually. We require both strings and
  // a strict ordering to prevent a future edit from moving the write above the gate.
  const gateIdx = source.indexOf('check_eligible_sources(');
  const insertIdx = source.indexOf('INSERT INTO estimated_signal_nowcasts');
  assert.ok(gateIdx > -1, 'gate call missing');
  assert.ok(insertIdx > -1, 'INSERT statement missing');
  assert.ok(gateIdx < insertIdx, 'gate must be called before INSERT');
});

test('abstain branch returns early without touching the INSERT path', () => {
  // The abstain branch must return a dict with abstain=True and NOT call the INSERT.
  const abstainBlock = source.slice(source.indexOf('if gate.abstain'));
  const firstReturn = abstainBlock.slice(0, abstainBlock.indexOf('with conn.cursor()'));
  assert.match(firstReturn, /'abstain': True/);
  assert.match(firstReturn, /'reason': f'source gate abstained/);
});

test('gate receives lagHours derived from observed_at timestamps', () => {
  assert.match(source, /_lag_hours_for\(/);
  assert.match(source, /'lagHours': _lag_hours_for/);
});
