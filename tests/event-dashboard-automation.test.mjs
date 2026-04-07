import test from 'node:test';
import assert from 'node:assert/strict';

import { startEventDashboardServer } from '../scripts/event-dashboard-api.mjs';

test('event dashboard exposes automation observability routes', async () => {
  const server = startEventDashboardServer(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const budgetResponse = await fetch(`http://127.0.0.1:${port}/api/automation-budget`);
    assert.equal(budgetResponse.status, 200);
    const budgetPayload = await budgetResponse.json();
    assert.ok(Object.prototype.hasOwnProperty.call(budgetPayload, 'budget'));
    assert.ok(Object.prototype.hasOwnProperty.call(budgetPayload, 'approvals'));
    assert.ok(Object.prototype.hasOwnProperty.call(budgetPayload, 'recentActions'));

    const logResponse = await fetch(`http://127.0.0.1:${port}/api/automation-log`);
    assert.equal(logResponse.status, 200);
    const logPayload = await logResponse.json();
    assert.ok(Array.isArray(logPayload.actions));

    const approvalResponse = await fetch(`http://127.0.0.1:${port}/api/approval-queue`);
    assert.equal(approvalResponse.status, 200);
    const approvalPayload = await approvalResponse.json();
    assert.ok(Array.isArray(approvalPayload.approvals));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
