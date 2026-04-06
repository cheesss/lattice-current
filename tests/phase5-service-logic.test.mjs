import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  calculateCII,
  clearCountryData,
  getPreviousScores,
  ingestConflictsForCII,
  ingestNewsForCII,
  ingestOutagesForCII,
  ingestProtestsForCII,
  ingestUcdpForCII,
  resetIngestStats,
} from '../src/services/country-instability.ts';
import {
  __resetTrendingKeywordStateForTests,
  drainTrendingSignals,
  ingestHeadlines,
  updateTrendingConfig,
} from '../src/services/trending-keywords.ts';
import { clearCells, detectGeoConvergence, ingestGeoEvent } from '../src/services/geo-convergence.ts';
import {
  checkBatchForBreakingAlerts,
  destroyBreakingNewsAlerts,
  dispatchOrefBreakingAlert,
  initBreakingNewsAlerts,
  updateAlertSettings,
} from '../src/services/breaking-news-alerts.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

function createLocalStorageMock() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

function createBrowserLikeGlobals() {
  const localStorage = createLocalStorageMock();
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget();
  Object.assign(windowTarget, { localStorage });
  globalThis.window = windowTarget;
  globalThis.document = documentTarget;
  globalThis.localStorage = localStorage;
  if (typeof globalThis.CustomEvent === 'undefined') {
    globalThis.CustomEvent = class CustomEvent extends Event {
      constructor(type, params = {}) {
        super(type, params);
        this.detail = params.detail;
      }
    };
  }
}

function withMockedNow(timestampMs) {
  const original = Date.now;
  Date.now = () => timestampMs;
  return () => {
    Date.now = original;
  };
}

async function flushAsyncSignals() {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

beforeEach(() => {
  createBrowserLikeGlobals();
  clearCountryData();
  resetIngestStats();
  getPreviousScores().clear();
  clearCells();
  __resetTrendingKeywordStateForTests();
  destroyBreakingNewsAlerts();
});

afterEach(() => {
  destroyBreakingNewsAlerts();
});

describe('country instability integration', () => {
  it('keeps all CII scores inside [0, 100]', () => {
    ingestProtestsForCII([
      { country: 'Israel', lat: 31.7, lon: 35.2, severity: 'high', fatalities: 1, time: new Date() },
      { country: 'Iran', lat: 35.7, lon: 51.4, severity: 'medium', fatalities: 0, time: new Date() },
    ]);
    ingestConflictsForCII([
      { country: 'Syria', lat: 33.5, lon: 36.3, eventType: 'violence_against_civilians', fatalities: 7 },
    ]);
    ingestNewsForCII([
      { primaryTitle: 'Missile exchange escalates in Israel', countries: ['IL'], isAlert: true, velocity: { sourcesPerHour: 8 } },
    ]);
    ingestOutagesForCII([
      { country: 'IL', severity: 'major', latitude: 31.7, longitude: 35.2 },
    ]);

    const scores = calculateCII();
    assert.ok(scores.length > 0, 'calculateCII should always return scored countries');
    scores.forEach((row) => {
      assert.ok(row.score >= 0 && row.score <= 100, `${row.code} score ${row.score} out of range`);
    });
  });

  it('applies the UCDP war floor to conflict-heavy countries', () => {
    ingestUcdpForCII(new Map([
      ['SY', { intensity: 'war' }],
    ]));

    const syria = calculateCII().find((row) => row.code === 'SY');
    assert.ok(syria, 'Syria should exist in the CII output');
    assert.ok(syria.score >= 70, `War floor should keep Syria >= 70, got ${syria.score}`);
  });

  it('keeps component weights normalized to 1', () => {
    const source = readFileSync(
      resolve(projectRoot, 'src/services/country-instability.ts'),
      'utf8',
    );
    const match = source.match(/const COMPONENT_WEIGHTS:[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
    assert.ok(match, 'COMPONENT_WEIGHTS block should exist');
    const weights = [...match[1].matchAll(/:\s*([0-9.]+)/g)].map((entry) => Number(entry[1]));
    const total = weights.reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `Component weights should sum to 1, got ${total}`);
  });
});

describe('trending keyword spike integration', () => {
  it('emits a spike only when count, multiplier, source diversity, and significance all clear the gate', async () => {
    updateTrendingConfig({ minSpikeCount: 3, spikeMultiplier: 2, autoSummarize: false });

    let restore = withMockedNow(Date.parse('2026-03-24T00:00:00Z') - (3 * 60 * 60 * 1000));
    ingestHeadlines([
      { title: 'Netanyahu cabinet meets overnight', source: 'Reuters', pubDate: new Date() },
      { title: 'Netanyahu discusses regional response', source: 'AP News', pubDate: new Date() },
    ]);
    restore();

    restore = withMockedNow(Date.parse('2026-03-24T00:00:00Z'));
    ingestHeadlines([
      { title: 'Netanyahu orders emergency security meeting', source: 'Reuters', pubDate: new Date() },
      { title: 'Netanyahu faces fresh military pressure', source: 'AP News', pubDate: new Date() },
      { title: 'Netanyahu addresses parliament amid escalation', source: 'BBC World', pubDate: new Date() },
      { title: 'Netanyahu and cabinet discuss next steps', source: 'Bloomberg', pubDate: new Date() },
    ]);
    restore();

    await flushAsyncSignals();
    const signals = drainTrendingSignals();
    assert.equal(signals.length, 1, 'Expected exactly one qualifying keyword spike');
    assert.equal(signals[0].type, 'keyword_spike');
    assert.match(signals[0].data.relatedTopics[0], /Netanyahu/i);
  });

  it('blocks spikes when source diversity is too low', async () => {
    updateTrendingConfig({ minSpikeCount: 3, spikeMultiplier: 2, autoSummarize: false });
    const restore = withMockedNow(Date.parse('2026-03-24T01:00:00Z'));
    ingestHeadlines([
      { title: 'Netanyahu warns of retaliation', source: 'Reuters', pubDate: new Date() },
      { title: 'Netanyahu issues new warning', source: 'Reuters', pubDate: new Date() },
      { title: 'Netanyahu convenes cabinet again', source: 'Reuters', pubDate: new Date() },
    ]);
    restore();

    await flushAsyncSignals();
    assert.equal(drainTrendingSignals().length, 0, 'Single-source bursts should not fire a spike');
  });

  it('respects per-term cooldown after a spike fires', async () => {
    updateTrendingConfig({ minSpikeCount: 2, spikeMultiplier: 1, autoSummarize: false });

    let restore = withMockedNow(Date.parse('2026-03-24T02:00:00Z'));
    ingestHeadlines([
      { title: 'Netanyahu convenes security cabinet', source: 'Reuters', pubDate: new Date() },
      { title: 'Netanyahu cabinet expands emergency session', source: 'BBC World', pubDate: new Date() },
    ]);
    restore();
    await flushAsyncSignals();
    assert.equal(drainTrendingSignals().length, 1, 'First spike should fire');

    restore = withMockedNow(Date.parse('2026-03-24T02:10:00Z'));
    ingestHeadlines([
      { title: 'Netanyahu adds reserve units', source: 'Reuters', pubDate: new Date() },
      { title: 'Netanyahu signals longer operation', source: 'AP News', pubDate: new Date() },
    ]);
    restore();
    await flushAsyncSignals();
    assert.equal(drainTrendingSignals().length, 0, 'Cooldown should suppress follow-up spikes in 30 minutes');
  });
});

describe('geo convergence integration', () => {
  it('requires at least three event types in one grid cell', () => {
    const seenAlerts = new Set();
    const now = new Date('2026-03-24T03:00:00Z');
    ingestGeoEvent(32.1, 35.2, 'protest', now);
    ingestGeoEvent(32.4, 35.4, 'military_flight', now);
    assert.equal(detectGeoConvergence(seenAlerts).length, 0, 'Two event types should not converge yet');

    ingestGeoEvent(32.6, 35.6, 'military_vessel', now);
    const alerts = detectGeoConvergence(seenAlerts);
    assert.equal(alerts.length, 1, 'Three event types in one cell should create one alert');
    assert.equal(alerts[0].types.length, 3);
  });

  it('keeps adjacent grid cells separate at the floor() boundary', () => {
    const seenAlerts = new Set();
    const now = new Date('2026-03-24T04:00:00Z');
    ingestGeoEvent(10.9, 20.9, 'protest', now);
    ingestGeoEvent(11.1, 20.9, 'military_flight', now);
    ingestGeoEvent(11.1, 20.9, 'military_vessel', now);

    const alerts = detectGeoConvergence(seenAlerts);
    assert.equal(alerts.length, 0, 'Events split across floor() cell boundaries should not merge');
  });
});

describe('breaking news alerts integration', () => {
  function makeAlertItem(overrides = {}) {
    return {
      title: 'Missile strike reported near major city',
      source: 'Reuters',
      link: 'https://example.com/alert',
      isAlert: true,
      pubDate: new Date(Date.now()),
      threat: { level: 'high', source: 'model' },
      ...overrides,
    };
  }

  it('deduplicates repeated RSS alerts', () => {
    let restore = withMockedNow(Date.parse('2026-03-24T06:00:00Z'));
    initBreakingNewsAlerts();
    restore();
    updateAlertSettings({ enabled: true, sensitivity: 'critical-and-high' });
    const fired = [];
    document.addEventListener('wm:breaking-news', (event) => fired.push(event.detail));

    restore = withMockedNow(Date.parse('2026-03-24T06:00:11Z'));
    checkBatchForBreakingAlerts([makeAlertItem()]);
    checkBatchForBreakingAlerts([makeAlertItem()]);
    restore();

    assert.equal(fired.length, 1, 'Duplicate alerts should only dispatch once');
  });

  it('enforces the global cooldown across different alerts', () => {
    let restore = withMockedNow(Date.parse('2026-03-24T05:00:00Z'));
    initBreakingNewsAlerts();
    restore();
    updateAlertSettings({ enabled: true, sensitivity: 'critical-and-high' });
    const fired = [];
    document.addEventListener('wm:breaking-news', (event) => fired.push(event.detail));

    restore = withMockedNow(Date.parse('2026-03-24T05:00:11Z'));
    checkBatchForBreakingAlerts([makeAlertItem({ title: 'First high alert', link: 'https://example.com/a' })]);
    restore();

    restore = withMockedNow(Date.parse('2026-03-24T05:00:30Z'));
    checkBatchForBreakingAlerts([makeAlertItem({ title: 'Second high alert', link: 'https://example.com/b' })]);
    restore();

    restore = withMockedNow(Date.parse('2026-03-24T05:01:12Z'));
    checkBatchForBreakingAlerts([makeAlertItem({ title: 'Third high alert', link: 'https://example.com/c' })]);
    restore();

    assert.equal(fired.length, 2, 'Only alerts outside the 60s global cooldown should fire');
  });

  it('blocks keyword-only alerts from low-authority specialty sources', () => {
    let restore = withMockedNow(Date.parse('2026-03-24T07:00:00Z'));
    initBreakingNewsAlerts();
    restore();
    updateAlertSettings({ enabled: true, sensitivity: 'critical-and-high' });
    const fired = [];
    document.addEventListener('wm:breaking-news', (event) => fired.push(event.detail));

    restore = withMockedNow(Date.parse('2026-03-24T07:00:11Z'));
    checkBatchForBreakingAlerts([
      makeAlertItem({
        source: 'Atlantic Council',
        threat: { level: 'high', source: 'keyword' },
      }),
    ]);
    restore();

    assert.equal(fired.length, 0, 'Tier-3+ keyword-only alerts should be suppressed');
  });

  it('deduplicates OREF sirens by alert identity', () => {
    let restore = withMockedNow(Date.parse('2026-03-24T07:30:00Z'));
    initBreakingNewsAlerts();
    restore();
    updateAlertSettings({ enabled: true, sensitivity: 'critical-and-high' });
    const fired = [];
    document.addEventListener('wm:breaking-news', (event) => fired.push(event.detail));

    const payload = [{
      id: 'sir-1',
      cat: 'rocket',
      title: 'Incoming rockets',
      alertDate: '2026-03-24T05:30:00Z',
      data: ['Ashkelon'],
    }];

    dispatchOrefBreakingAlert(payload);
    dispatchOrefBreakingAlert(payload);

    assert.equal(fired.length, 1, 'Identical siren batches should dedupe');
  });
});
