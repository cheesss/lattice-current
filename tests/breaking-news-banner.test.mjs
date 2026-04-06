/**
 * BreakingNewsBanner — Phase 3.2 Logic Tests
 * Phase 5: Test Coverage Expansion
 *
 * Tests the pure computational/state logic:
 * - Alert timer behavior (critical=manual only, high=shrink after 120s)
 * - History management (max 50 entries, newest first)
 * - Missed badge logic (increment when hidden, clear on toggle)
 * - escapeText() XSS prevention
 * - isDismissedRecently() 30-minute cooldown
 * - Visibility handler: timer pause/resume, critical never auto-shrink
 * - MAX_ALERTS eviction (oldest removed when cap exceeded)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Replicated constants and logic ───

const MAX_ALERTS = 3;
const CRITICAL_DISMISS_MS = 0;  // Manual dismiss only
const HIGH_DISMISS_MS = 120_000; // Shrink after 120s
const MAX_HISTORY = 50;

/**
 * escapeText — prevents XSS in innerHTML
 */
function escapeText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * isDismissedRecently — checks 30-minute cooldown window
 */
function isDismissedRecently(dismissed, id) {
  const ts = dismissed.get(id);
  if (ts === undefined) return false;
  if (Date.now() - ts >= 30 * 60 * 1000) {
    dismissed.delete(id);
    return false;
  }
  return true;
}

/**
 * Determine dismiss behavior by threat level
 */
function getDismissMs(threatLevel) {
  return threatLevel === 'critical' ? CRITICAL_DISMISS_MS : HIGH_DISMISS_MS;
}

/**
 * Simulate addToHistory logic
 */
function addToHistory(history, alert, isTabHidden) {
  history.unshift({
    alert,
    receivedAt: Date.now(),
    wasRead: !isTabHidden,
  });
  if (history.length > MAX_HISTORY) {
    history.length = MAX_HISTORY;
  }
  return history;
}

/**
 * Simulate toggleHistory logic (opening)
 */
function openHistory(history, missedCount) {
  // Clear missed count
  missedCount = 0;
  // Mark all as read
  for (const entry of history) {
    entry.wasRead = true;
  }
  return { history, missedCount };
}

/**
 * Simulate missed badge text
 */
function missedBadgeText(count) {
  if (count <= 0) return null; // hidden
  return count > 9 ? '9+' : `${count}`;
}

/**
 * Simulate visibility handler: should timer resume on return?
 */
function shouldResumeTimer(active) {
  // Critical alerts never auto-dismiss/shrink
  if (active.threatLevel === 'critical') return false;
  if (active.remainingMs > 0 && !active.shrunk && !active.timer) return true;
  return false;
}

/**
 * Simulate visibility handler: should immediately shrink on return?
 */
function shouldImmediateShrink(active) {
  if (active.threatLevel === 'critical') return false;
  return active.remainingMs <= 0 && !active.shrunk;
}

/**
 * Simulate MAX_ALERTS eviction
 */
function evictIfNeeded(activeAlerts) {
  const evicted = [];
  while (activeAlerts.length >= MAX_ALERTS) {
    evicted.push(activeAlerts.shift());
  }
  return evicted;
}


// ═══════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════

describe('Alert Timer Configuration', () => {
  it('critical alerts have 0ms dismiss time (manual only)', () => {
    assert.equal(getDismissMs('critical'), 0);
  });

  it('high alerts shrink after 120 seconds', () => {
    assert.equal(getDismissMs('high'), 120_000);
  });

  it('non-critical alerts default to HIGH_DISMISS_MS', () => {
    assert.equal(getDismissMs('medium'), 120_000);
  });

  it('critical timer should NOT auto-start (dismissMs === 0)', () => {
    const dismissMs = getDismissMs('critical');
    const shouldAutoStart = dismissMs > 0;
    assert.equal(shouldAutoStart, false);
  });

  it('high timer should auto-start (dismissMs > 0)', () => {
    const dismissMs = getDismissMs('high');
    const shouldAutoStart = dismissMs > 0;
    assert.equal(shouldAutoStart, true);
  });
});

describe('escapeText — XSS Prevention', () => {
  it('escapes ampersand', () => {
    assert.equal(escapeText('a&b'), 'a&amp;b');
  });

  it('escapes less-than', () => {
    assert.equal(escapeText('<script>'), '&lt;script&gt;');
  });

  it('escapes greater-than', () => {
    assert.equal(escapeText('a>b'), 'a&gt;b');
  });

  it('handles all special chars together', () => {
    assert.equal(escapeText('<img src="x" onerror="alert(1)">'), '&lt;img src="x" onerror="alert(1)"&gt;');
  });

  it('does not modify safe text', () => {
    assert.equal(escapeText('Normal headline'), 'Normal headline');
  });

  it('empty string → empty string', () => {
    assert.equal(escapeText(''), '');
  });
});

describe('isDismissedRecently — 30-Minute Cooldown', () => {
  it('unknown ID → not dismissed', () => {
    const dismissed = new Map();
    assert.equal(isDismissedRecently(dismissed, 'unknown'), false);
  });

  it('recently dismissed → returns true', () => {
    const dismissed = new Map();
    dismissed.set('alert-1', Date.now() - 5 * 60 * 1000); // 5 min ago
    assert.equal(isDismissedRecently(dismissed, 'alert-1'), true);
  });

  it('dismissed > 30 min ago → returns false and cleans up', () => {
    const dismissed = new Map();
    dismissed.set('alert-1', Date.now() - 31 * 60 * 1000); // 31 min ago
    assert.equal(isDismissedRecently(dismissed, 'alert-1'), false);
    assert.equal(dismissed.has('alert-1'), false); // cleaned up
  });

  it('exactly 30 min → returns false (boundary)', () => {
    const dismissed = new Map();
    dismissed.set('alert-1', Date.now() - 30 * 60 * 1000);
    assert.equal(isDismissedRecently(dismissed, 'alert-1'), false);
  });
});

describe('Alert History Management', () => {
  it('adds to front (newest first)', () => {
    const history = [];
    addToHistory(history, { id: 'a1', headline: 'First' }, false);
    addToHistory(history, { id: 'a2', headline: 'Second' }, false);
    assert.equal(history[0].alert.id, 'a2');
    assert.equal(history[1].alert.id, 'a1');
  });

  it('caps at MAX_HISTORY (50) entries', () => {
    const history = [];
    for (let i = 0; i < 55; i++) {
      addToHistory(history, { id: `a${i}`, headline: `Alert ${i}` }, false);
    }
    assert.equal(history.length, MAX_HISTORY);
  });

  it('marks as read when tab is visible', () => {
    const history = [];
    addToHistory(history, { id: 'a1', headline: 'Test' }, false);
    assert.equal(history[0].wasRead, true);
  });

  it('marks as unread when tab is hidden', () => {
    const history = [];
    addToHistory(history, { id: 'a1', headline: 'Test' }, true);
    assert.equal(history[0].wasRead, false);
  });
});

describe('Missed Badge Logic', () => {
  it('count 0 → hidden (null)', () => {
    assert.equal(missedBadgeText(0), null);
  });

  it('count 1 → "1"', () => {
    assert.equal(missedBadgeText(1), '1');
  });

  it('count 9 → "9"', () => {
    assert.equal(missedBadgeText(9), '9');
  });

  it('count 10 → "9+"', () => {
    assert.equal(missedBadgeText(10), '9+');
  });

  it('count 99 → "9+"', () => {
    assert.equal(missedBadgeText(99), '9+');
  });
});

describe('Toggle History — Missed Count Reset', () => {
  it('opening history resets missed count to 0', () => {
    const history = [
      { alert: { id: 'a1' }, receivedAt: Date.now(), wasRead: false },
      { alert: { id: 'a2' }, receivedAt: Date.now(), wasRead: false },
    ];
    const result = openHistory(history, 5);
    assert.equal(result.missedCount, 0);
  });

  it('opening history marks all entries as read', () => {
    const history = [
      { alert: { id: 'a1' }, receivedAt: Date.now(), wasRead: false },
      { alert: { id: 'a2' }, receivedAt: Date.now(), wasRead: false },
    ];
    openHistory(history, 3);
    assert.ok(history.every(e => e.wasRead === true));
  });
});

describe('Visibility Handler Logic', () => {
  it('critical alert never resumes timer on tab return', () => {
    assert.equal(shouldResumeTimer({ threatLevel: 'critical', remainingMs: 1000, shrunk: false, timer: null }), false);
  });

  it('high alert with remaining time resumes timer', () => {
    assert.equal(shouldResumeTimer({ threatLevel: 'high', remainingMs: 5000, shrunk: false, timer: null }), true);
  });

  it('already shrunk alert does not resume', () => {
    assert.equal(shouldResumeTimer({ threatLevel: 'high', remainingMs: 5000, shrunk: true, timer: null }), false);
  });

  it('alert with active timer does not double-start', () => {
    assert.equal(shouldResumeTimer({ threatLevel: 'high', remainingMs: 5000, shrunk: false, timer: 'exists' }), false);
  });

  it('critical alert never immediately shrinks', () => {
    assert.equal(shouldImmediateShrink({ threatLevel: 'critical', remainingMs: 0, shrunk: false }), false);
  });

  it('high alert with 0 remaining → should immediately shrink', () => {
    assert.equal(shouldImmediateShrink({ threatLevel: 'high', remainingMs: 0, shrunk: false }), true);
  });

  it('already shrunk → should not shrink again', () => {
    assert.equal(shouldImmediateShrink({ threatLevel: 'high', remainingMs: 0, shrunk: true }), false);
  });
});

describe('MAX_ALERTS Eviction', () => {
  it('evicts oldest when at capacity', () => {
    const alerts = [
      { id: 'a1' },
      { id: 'a2' },
      { id: 'a3' },
    ];
    const evicted = evictIfNeeded(alerts);
    assert.equal(evicted.length, 1);
    assert.equal(evicted[0].id, 'a1');
    assert.equal(alerts.length, MAX_ALERTS - 1);
  });

  it('no eviction when under capacity', () => {
    const alerts = [{ id: 'a1' }, { id: 'a2' }];
    const evicted = evictIfNeeded(alerts);
    assert.equal(evicted.length, 0);
    assert.equal(alerts.length, 2);
  });

  it('evicts multiple if well over capacity', () => {
    const alerts = [
      { id: 'a1' }, { id: 'a2' }, { id: 'a3' }, { id: 'a4' },
    ];
    const evicted = evictIfNeeded(alerts);
    assert.equal(evicted.length, 2);
    assert.equal(alerts.length, MAX_ALERTS - 1);
  });
});
