import test from 'node:test';
import assert from 'node:assert/strict';

import { applySchemaConstraints } from '../scripts/_shared/schema-constraints.mjs';

test('applySchemaConstraints executes all steps and tolerates failures per step', async () => {
  const executed = [];
  const summary = await applySchemaConstraints({
    async query(sql) {
      executed.push(String(sql));
      if (String(sql).includes('chk_lo_exit_price')) {
        throw new Error('constraint blocked by existing data');
      }
      return { rows: [] };
    },
  });

  assert.ok(executed.length >= 10);
  assert.ok(summary.appliedCount > 0);
  assert.ok(summary.failedCount >= 1);
  assert.ok(summary.results.some((result) => result.id === 'labeled_outcomes.exit_price.check' && result.ok === false));
});

