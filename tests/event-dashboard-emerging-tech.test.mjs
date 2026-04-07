import test from 'node:test';
import assert from 'node:assert/strict';

import { startEventDashboardServer } from '../scripts/event-dashboard-api.mjs';

test('event dashboard exposes emerging-tech and report routes', async () => {
  const server = startEventDashboardServer(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const topicsResponse = await fetch(`http://127.0.0.1:${port}/api/emerging-tech`);
    assert.equal(topicsResponse.status, 200);
    const topicsPayload = await topicsResponse.json();
    assert.ok(Array.isArray(topicsPayload.topics));

    const timelineResponse = await fetch(`http://127.0.0.1:${port}/api/emerging-tech/timeline`);
    assert.equal(timelineResponse.status, 200);
    const timelinePayload = await timelineResponse.json();
    assert.ok(Array.isArray(timelinePayload.topics));

    const reportsResponse = await fetch(`http://127.0.0.1:${port}/api/reports/latest?limit=5`);
    assert.equal(reportsResponse.status, 200);
    const reportsPayload = await reportsResponse.json();
    assert.ok(Array.isArray(reportsPayload.reports));

    const topicDetailResponse = await fetch(`http://127.0.0.1:${port}/api/emerging-tech/nonexistent-topic`);
    assert.equal(topicDetailResponse.status, 200);
    const topicDetailPayload = await topicDetailResponse.json();
    assert.ok(Object.prototype.hasOwnProperty.call(topicDetailPayload, 'topic'));
    assert.ok(Object.prototype.hasOwnProperty.call(topicDetailPayload, 'report'));

    const reportDetailResponse = await fetch(`http://127.0.0.1:${port}/api/reports/nonexistent-report`);
    assert.equal(reportDetailResponse.status, 200);
    const reportDetailPayload = await reportDetailResponse.json();
    assert.ok(Object.prototype.hasOwnProperty.call(reportDetailPayload, 'report'));
    assert.ok(Object.prototype.hasOwnProperty.call(reportDetailPayload, 'topic'));

    const digestResponse = await fetch(`http://127.0.0.1:${port}/api/digest/weekly`);
    assert.equal(digestResponse.status, 200);
    const digestPayload = await digestResponse.json();
    assert.ok(Object.prototype.hasOwnProperty.call(digestPayload, 'digest'));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
