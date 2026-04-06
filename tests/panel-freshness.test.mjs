import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Panel Freshness tests — Phase 3.3
 *
 * Tests the core logic of freshness state computation.
 * DOM-dependent applyFreshnessStyles() is tested indirectly via integration.
 */

// ── Inline logic (mirrors panel-freshness.ts core) ──────────────────────────

const FRESH_THRESHOLD_MS = 30 * 60 * 1000;
const STALE_THRESHOLD_MS = 60 * 60 * 1000;

const panelUpdateTimes = new Map();
const criticalPanels = new Set();

function markPanelUpdated(panelKey) {
  panelUpdateTimes.set(panelKey, Date.now());
}

function markPanelCritical(panelKey, isCritical) {
  if (isCritical) criticalPanels.add(panelKey);
  else criticalPanels.delete(panelKey);
}

function getPanelFreshnessState(panelKey) {
  const lastUpdate = panelUpdateTimes.get(panelKey);
  if (!lastUpdate) return 'normal';
  const age = Date.now() - lastUpdate;
  if (age < FRESH_THRESHOLD_MS) return 'fresh';
  if (age > STALE_THRESHOLD_MS) return 'stale';
  return 'normal';
}

function resetFreshnessTracking() {
  panelUpdateTimes.clear();
  criticalPanels.clear();
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetFreshnessTracking();
});

describe('Panel Freshness', () => {
  it('returns normal for unknown panels', () => {
    assert.equal(getPanelFreshnessState('non-existent'), 'normal');
  });

  it('returns fresh for recently updated panels', () => {
    markPanelUpdated('markets');
    assert.equal(getPanelFreshnessState('markets'), 'fresh');
  });

  it('returns normal for panels updated 30-60 min ago', () => {
    // Simulate update 45 min ago
    panelUpdateTimes.set('politics', Date.now() - 45 * 60 * 1000);
    assert.equal(getPanelFreshnessState('politics'), 'normal');
  });

  it('returns stale for panels updated > 60 min ago', () => {
    panelUpdateTimes.set('energy', Date.now() - 90 * 60 * 1000);
    assert.equal(getPanelFreshnessState('energy'), 'stale');
  });

  it('markPanelCritical tracks critical state', () => {
    markPanelCritical('middleeast', true);
    assert.ok(criticalPanels.has('middleeast'));
    markPanelCritical('middleeast', false);
    assert.ok(!criticalPanels.has('middleeast'));
  });

  it('resetFreshnessTracking clears all', () => {
    markPanelUpdated('a');
    markPanelCritical('b', true);
    resetFreshnessTracking();
    assert.equal(panelUpdateTimes.size, 0);
    assert.equal(criticalPanels.size, 0);
  });
});
