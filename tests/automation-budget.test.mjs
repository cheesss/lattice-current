import test from 'node:test';
import assert from 'node:assert/strict';

import { AUTOMATION_BUDGETS, checkBudget, getBudgetStatus } from '../scripts/_shared/automation-budget.mjs';

function createClient(usedByInterval = {}) {
  return {
    async query(_text, values = []) {
      const action = values[0];
      if (String(_text).includes("INTERVAL '1 hour'")) return { rows: [{ used: usedByInterval.hourly?.[action] || 0 }] };
      if (String(_text).includes("INTERVAL '1 day'")) return { rows: [{ used: usedByInterval.daily?.[action] || 0 }] };
      if (String(_text).includes("INTERVAL '7 days'")) return { rows: [{ used: usedByInterval.weekly?.[action] || 0 }] };
      return { rows: [{ used: 0 }] };
    },
  };
}

test('automation budgets expose expected action classes', () => {
  assert.equal(AUTOMATION_BUDGETS.daily.backfillCalls, 5);
  assert.equal(AUTOMATION_BUDGETS.daily.rssRegistrations, 10);
  assert.equal(AUTOMATION_BUDGETS.weekly.backfillItems, 500000);
});

test('checkBudget blocks daily overage', async () => {
  const client = createClient({ daily: { backfillCalls: 5 } });
  const result = await checkBudget(client, 'backfillCalls', 1);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'daily budget exceeded');
});

test('getBudgetStatus returns scoped counters', async () => {
  const client = createClient({
    hourly: { codexCalls: 2 },
    daily: { codexCalls: 3, backfillCalls: 1 },
    weekly: { backfillCalls: 4 },
  });
  const status = await getBudgetStatus(client);
  assert.equal(status.daily.codexCalls.used, 3);
  assert.equal(status.daily.backfillCalls.remaining, 4);
  assert.equal(status.weekly.backfillCalls.used, 4);
  assert.equal(typeof status.killSwitchActive, 'boolean');
});
