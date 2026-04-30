/**
 * S-Tier §7 — product quality metric endpoint contract.
 *
 * Verifies /api/product-quality returns the five required metrics with
 * targets and a summary roll-up. Does not mutate any data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { startEventDashboardServer } from '../scripts/event-dashboard-api.mjs';
import { PRODUCT_QUALITY_TARGETS } from '../scripts/_shared/product-quality-metrics.mjs';

async function withServer(callback) {
  const server = startEventDashboardServer(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  try {
    await callback({ base });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

test('product-quality endpoint returns the five required metrics', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/product-quality`);
    assert.ok(res.ok || res.status === 503, `expected 200/503, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.metrics, 'metrics must be present');
    for (const key of [
      'theme_relevance_precision',
      'brief_completeness',
      'evidence_coverage',
      'noise_suppression_rate',
      'actionability_score',
    ]) {
      assert.ok(key in body.metrics, `missing metric: ${key}`);
      const value = body.metrics[key];
      // null is acceptable when sample is empty; otherwise must be 0..1
      if (value !== null) {
        assert.ok(value >= 0 && value <= 1, `${key} out of [0,1]: ${value}`);
      }
    }
  });
});

test('product-quality endpoint exposes the s-tier targets', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/product-quality`);
    const body = await res.json();
    assert.deepEqual(body.targets, PRODUCT_QUALITY_TARGETS);
    // The four metrics with targets must each have a target between 0 and 1.
    for (const [k, v] of Object.entries(body.targets)) {
      assert.ok(v > 0 && v <= 1, `target ${k} out of (0,1]: ${v}`);
    }
  });
});

test('product-quality summary classifies metrics into meeting / failing / unknown', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/product-quality`);
    const body = await res.json();
    assert.ok(body.summary, 'summary required');
    assert.ok(['ok', 'warning', 'unknown'].includes(body.summary.level), `bad level: ${body.summary.level}`);
    assert.ok(Array.isArray(body.summary.meeting));
    assert.ok(Array.isArray(body.summary.failing));
    assert.ok(Array.isArray(body.summary.unknown));
    // Every metric in the summary must be a valid metric name.
    const validNames = new Set(Object.keys(PRODUCT_QUALITY_TARGETS));
    for (const name of body.summary.meeting) {
      assert.ok(validNames.has(name), `unknown metric in meeting: ${name}`);
    }
    for (const f of body.summary.failing) {
      assert.ok(validNames.has(f.metric), `unknown metric in failing: ${f.metric}`);
      assert.ok(typeof f.value === 'number' && typeof f.target === 'number');
    }
  });
});

test('product-quality details include sample sizes for transparency', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/product-quality`);
    const body = await res.json();
    assert.ok(body.details, 'details required for transparency');
    assert.ok(body.details.theme_relevance_precision);
    // Non-null metric must come with a sample count > 0.
    if (body.metrics.theme_relevance_precision !== null) {
      assert.ok(body.details.theme_relevance_precision.sample > 0);
    }
    if (body.metrics.noise_suppression_rate !== null) {
      assert.ok(body.details.noise_suppression_rate.sample > 0);
    }
  });
});

test('product-quality note explicitly excludes time_to_first_value', async () => {
  // Plan §7 lists time_to_first_value as a metric but it's a CLIENT telemetry
  // measurement (seconds until a first-time user can understand one signal),
  // not something the server can compute. The endpoint must declare this.
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/product-quality`);
    const body = await res.json();
    assert.match(String(body.note || ''), /time_to_first_value/i);
    assert.ok(!('time_to_first_value' in body.metrics));
  });
});
