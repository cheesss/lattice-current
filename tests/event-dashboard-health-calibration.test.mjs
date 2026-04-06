import test from 'node:test';
import assert from 'node:assert/strict';

import { startEventDashboardServer } from '../scripts/event-dashboard-api.mjs';

test('event dashboard exposes composite health and calibration routes', async () => {
  const server = startEventDashboardServer(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.ok([200, 503].includes(healthResponse.status));
    const healthPayload = await healthResponse.json();
    assert.equal(typeof healthPayload.compositeScore, 'number');
    assert.equal(typeof healthPayload.components?.apiHealth, 'number');
    assert.ok(['healthy', 'degraded', 'critical'].includes(healthPayload.status));

    const calibrationResponse = await fetch(`http://127.0.0.1:${port}/api/calibration`);
    assert.equal(calibrationResponse.status, 200);
    const calibrationPayload = await calibrationResponse.json();
    assert.equal(typeof calibrationPayload.ece, 'number');
    assert.equal(typeof calibrationPayload.brierScore, 'number');
    assert.ok(Array.isArray(calibrationPayload.buckets));

    const codexQualityResponse = await fetch(`http://127.0.0.1:${port}/api/codex-quality`);
    assert.equal(codexQualityResponse.status, 200);
    const codexQualityPayload = await codexQualityResponse.json();
    assert.equal(typeof codexQualityPayload.totalCalls, 'number');
    assert.equal(typeof codexQualityPayload.parseSuccessRate, 'number');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
