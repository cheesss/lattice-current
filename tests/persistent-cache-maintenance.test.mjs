import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isAutoVacuumRunning,
  startAutoVacuum,
  stopAutoVacuum,
} from '../src/services/persistent-cache.ts';

test('persistent-cache maintenance is opt-in and not started on import', () => {
  stopAutoVacuum();
  assert.equal(isAutoVacuumRunning(), false);
});

test('persistent-cache maintenance can be started and stopped explicitly', () => {
  stopAutoVacuum();
  startAutoVacuum();
  assert.equal(isAutoVacuumRunning(), true);
  stopAutoVacuum();
  assert.equal(isAutoVacuumRunning(), false);
});
