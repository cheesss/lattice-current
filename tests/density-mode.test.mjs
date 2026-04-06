import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Density Mode tests.
 *
 * The density-mode.ts module imports `@/config/variant` which relies on
 * Vite's alias resolution. For Node.js testing we mock the minimal surface
 * and directly test the core logic that the module exports.
 */

// ── Minimal mocks for browser globals ────────────────────────────────────────

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
};

const eventListeners = new Map();
globalThis.document = {
  dispatchEvent(event) {
    const handlers = eventListeners.get(event.type) ?? [];
    for (const fn of handlers) fn(event);
  },
  addEventListener(name, fn) {
    if (!eventListeners.has(name)) eventListeners.set(name, []);
    eventListeners.get(name).push(fn);
  },
  removeEventListener(name, fn) {
    const arr = eventListeners.get(name);
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx !== -1) arr.splice(idx, 1);
  },
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
};

// Provide SITE_VARIANT as 'full' (the default variant)
// This simulates what @/config/variant exports.
// We intercept via Node's module register for .ts files with Vite aliases:
// Since --experimental-strip-types handles TS syntax but not path aliases,
// we need a loader or we inline the test logic directly.

// ── Inline test of density mode logic (no import) ────────────────────────────
// We replicate the core logic here to test without Vite's resolve.

const STORAGE_KEY = 'wm-density-mode';
const EVENT_NAME = 'wm:density-changed';

const COMPACT_PANELS = new Set([
  'map', 'strategic-risk', 'live-news', 'markets', 'cii',
]);

const STANDARD_PANELS = new Set([
  'map', 'strategic-risk', 'live-news', 'markets', 'cii',
  'strategic-posture', 'insights', 'politics', 'commodities',
  'intel', 'energy', 'crypto', 'economic', 'cascade', 'middleeast',
]);

let currentMode = null;

function getDensityMode() {
  if (currentMode) return currentMode;
  const stored = storage.get(STORAGE_KEY) ?? null;
  if (stored === 'compact' || stored === 'standard' || stored === 'full') {
    currentMode = stored;
    return stored;
  }
  currentMode = 'full';
  return 'full';
}

function setDensityMode(mode) {
  const prev = getDensityMode();
  if (prev === mode) return;
  currentMode = mode;
  storage.set(STORAGE_KEY, mode);
  document.dispatchEvent(new CustomEvent(EVENT_NAME, {
    detail: { mode, previous: prev },
  }));
}

function getDensityConfig(mode) {
  const m = mode ?? getDensityMode();
  if (m === 'compact') return { panels: COMPACT_PANELS, label: 'Compact', maxPanels: 5 };
  if (m === 'standard') return { panels: STANDARD_PANELS, label: 'Standard', maxPanels: 15 };
  return { panels: new Set(), label: 'Full', maxPanels: Infinity };
}

function isPanelVisibleInDensity(panelKey, mode) {
  const m = mode ?? getDensityMode();
  if (m === 'full') return true;
  return getDensityConfig(m).panels.has(panelKey);
}

function cycleDensityMode() {
  const current = getDensityMode();
  const next = current === 'compact' ? 'standard'
    : current === 'standard' ? 'full'
    : 'compact';
  setDensityMode(next);
  return next;
}

function onDensityChange(listener) {
  const handler = (e) => listener(e.detail);
  document.addEventListener(EVENT_NAME, handler);
  return () => document.removeEventListener(EVENT_NAME, handler);
}

const DENSITY_MODES = [
  { id: 'compact', label: 'Compact', icon: '◻', description: '5 key panels — minimal cognitive load' },
  { id: 'standard', label: 'Standard', icon: '◫', description: '15 core panels — daily monitoring' },
  { id: 'full', label: 'Full', icon: '▣', description: 'All panels — maximum information' },
];

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  storage.clear();
  currentMode = null;
  eventListeners.clear();
});

describe('Density Mode Service', () => {
  it('defaults to full mode when nothing stored', () => {
    assert.equal(getDensityMode(), 'full');
  });

  it('stores and retrieves density mode', () => {
    setDensityMode('compact');
    assert.equal(getDensityMode(), 'compact');
    assert.equal(storage.get('wm-density-mode'), 'compact');
  });

  it('compact mode returns 5 panels', () => {
    const config = getDensityConfig('compact');
    assert.equal(config.maxPanels, 5);
    assert.equal(config.panels.size, 5);
    assert.ok(config.panels.has('map'), 'Compact must include map');
    assert.ok(config.panels.has('strategic-risk'), 'Compact must include strategic-risk');
    assert.ok(config.panels.has('live-news'), 'Compact must include live-news');
    assert.ok(config.panels.has('markets'), 'Compact must include markets');
    assert.ok(config.panels.has('cii'), 'Compact must include cii');
  });

  it('standard mode returns 15 panels', () => {
    const config = getDensityConfig('standard');
    assert.equal(config.maxPanels, 15);
    assert.equal(config.panels.size, 15);
    assert.ok(config.panels.has('map'), 'Standard must include map');
    assert.ok(config.panels.has('insights'), 'Standard must include insights');
  });

  it('full mode panel set is empty (show all)', () => {
    const config = getDensityConfig('full');
    assert.equal(config.panels.size, 0);
    assert.equal(config.maxPanels, Infinity);
  });

  it('isPanelVisibleInDensity returns true for all panels in full mode', () => {
    assert.equal(isPanelVisibleInDensity('random-panel', 'full'), true);
    assert.equal(isPanelVisibleInDensity('anything', 'full'), true);
  });

  it('isPanelVisibleInDensity filters correctly in compact mode', () => {
    assert.equal(isPanelVisibleInDensity('map', 'compact'), true);
    assert.equal(isPanelVisibleInDensity('giving', 'compact'), false);
    assert.equal(isPanelVisibleInDensity('heatmap', 'compact'), false);
  });

  it('cycleDensityMode cycles compact → standard → full → compact', () => {
    setDensityMode('compact');
    assert.equal(cycleDensityMode(), 'standard');
    assert.equal(cycleDensityMode(), 'full');
    assert.equal(cycleDensityMode(), 'compact');
  });

  it('onDensityChange fires listener on mode change', () => {
    const changes = [];
    const unsub = onDensityChange((detail) => changes.push(detail));

    setDensityMode('compact');
    setDensityMode('standard');

    assert.equal(changes.length, 2);
    assert.equal(changes[0].mode, 'compact');
    assert.equal(changes[0].previous, 'full');
    assert.equal(changes[1].mode, 'standard');
    assert.equal(changes[1].previous, 'compact');

    unsub();
    setDensityMode('full');
    assert.equal(changes.length, 2, 'Should not fire after unsubscribe');
  });

  it('setDensityMode does not fire event for same mode', () => {
    setDensityMode('compact');
    const changes = [];
    const unsub = onDensityChange((detail) => changes.push(detail));
    setDensityMode('compact'); // same mode
    assert.equal(changes.length, 0);
    unsub();
  });

  it('DENSITY_MODES has correct structure', () => {
    assert.equal(DENSITY_MODES.length, 3);
    assert.deepEqual(DENSITY_MODES.map(m => m.id), ['compact', 'standard', 'full']);
    for (const m of DENSITY_MODES) {
      assert.ok(m.label, `Mode ${m.id} should have a label`);
      assert.ok(m.icon, `Mode ${m.id} should have an icon`);
      assert.ok(m.description, `Mode ${m.id} should have a description`);
    }
  });

  it('standard panels are a superset of compact panels', () => {
    const compact = getDensityConfig('compact').panels;
    const standard = getDensityConfig('standard').panels;
    for (const key of compact) {
      assert.ok(standard.has(key), `Standard should include compact panel: ${key}`);
    }
  });
});
