import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyMarketSession,
  adjustConfidenceForSession,
} from '../scripts/_shared/market-calendar.mjs';

function atEt(dateIso) {
  // Caller passes a wall-clock ET time; convert via UTC offset roughly —
  // the market-calendar implementation uses Intl for the accurate mapping,
  // so we only need inputs that produce unambiguous ET conversion.
  // Using an explicit offset -0400 (EDT) for clarity; the test reference
  // dates below are intentionally during daylight saving time.
  return new Date(dateIso);
}

test('classifyMarketSession returns regular during NYSE hours', () => {
  // Monday 2026-04-13 14:00Z ~ 10:00 ET (EDT, UTC-4) → regular
  const sess = classifyMarketSession(atEt('2026-04-13T14:00:00Z'));
  assert.equal(sess.session, 'regular');
  assert.equal(sess.isOpen, true);
  assert.equal(sess.confidenceFloor, 0.80);
});

test('classifyMarketSession returns weekend for Sunday afternoon', () => {
  const sess = classifyMarketSession(atEt('2026-04-12T18:00:00Z'));
  assert.equal(sess.session, 'weekend');
  assert.equal(sess.isOpen, false);
  assert.equal(sess.abstainEligible, true);
});

test('classifyMarketSession returns holiday when date matches NYSE closure', () => {
  // 2026-04-03 is Good Friday in our lookup table
  const sess = classifyMarketSession(atEt('2026-04-03T15:00:00Z'));
  assert.equal(sess.session, 'holiday');
  assert.equal(sess.holiday, true);
});

test('classifyMarketSession returns post-close after 16:00 ET', () => {
  // Monday 2026-04-13 21:00Z ~ 17:00 ET (EDT) → post-close
  const sess = classifyMarketSession(atEt('2026-04-13T21:00:00Z'));
  assert.equal(sess.session, 'post-close');
  assert.equal(sess.isOpen, false);
});

test('adjustConfidenceForSession applies the session floor', () => {
  // During weekend a raw 0.85 must be clipped downward to at most floor 0.40
  const result = adjustConfidenceForSession(0.2, atEt('2026-04-12T18:00:00Z'));
  assert.equal(result.session.session, 'weekend');
  // 0.2 < weekend floor (0.40), so floor wins
  assert.equal(result.confidence, 0.40);
});

test('adjustConfidenceForSession keeps higher raw confidence during regular session', () => {
  const result = adjustConfidenceForSession(0.92, atEt('2026-04-13T14:00:00Z'));
  assert.equal(result.session.session, 'regular');
  assert.equal(result.confidence, 0.92);
});
