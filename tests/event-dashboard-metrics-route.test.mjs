import test from 'node:test';
import assert from 'node:assert/strict';

import { startEventDashboardServer } from '../scripts/event-dashboard-api.mjs';

test('event dashboard exposes metrics for observed requests', async () => {
  const server = startEventDashboardServer(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.ok([200, 503].includes(healthResponse.status));

    const metricsResponse = await fetch(`http://127.0.0.1:${port}/api/metrics`);
    assert.equal(metricsResponse.status, 200);
    const payload = await metricsResponse.json();
    assert.equal(payload.component, 'event-dashboard-api');
    assert.ok(Array.isArray(payload.metrics));
    assert.ok(payload.metrics.some((metric) => metric.name === 'api.request_count'));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
