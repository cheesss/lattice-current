import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('theme Follow/Mute actions persist through the watchlist API as well as local workspace state', async () => {
  const dashboard = await readFile(new URL('../event-dashboard.html', import.meta.url), 'utf8');

  assert.match(dashboard, /async function persistThemeWatchlistState/);
  assert.match(dashboard, /\$\{API\}\/watchlist/);
  assert.match(dashboard, /itemType:'theme'/);
  assert.match(dashboard, /state:stateValue/);
  assert.match(dashboard, /await persistThemeWatchlistState\(normalized,'follow'\)/);
  assert.match(dashboard, /await persistThemeWatchlistState\(normalized,'mute'\)/);
  assert.match(dashboard, /async function removeThemeWatchlistState/);
  assert.match(dashboard, /\/watchlist\/theme\/\$\{encodeURIComponent\(normalized\)\}/);
});
