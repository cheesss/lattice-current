import assert from 'node:assert/strict';
import test from 'node:test';

import { isOpaqueDiscoveryTheme } from '../scripts/refresh-discovery-from-recent-themes.mjs';

test('recent discovery refresh filters opaque auto-discovery theme ids', () => {
  assert.equal(isOpaqueDiscoveryTheme('dt-e5ae963eeace'), true);
  assert.equal(isOpaqueDiscoveryTheme('DT-F27A82287DF0'), true);
  assert.equal(isOpaqueDiscoveryTheme('cybersecurity'), false);
  assert.equal(isOpaqueDiscoveryTheme('defense-industrial'), false);
});
