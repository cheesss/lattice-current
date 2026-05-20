/**
 * S-Tier §4 — user watchlist persistence contract.
 *
 * Hits the live event-dashboard API (started on a random port) to verify
 * that follow / mute / dismiss / snooze persist across requests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { startEventDashboardServer } from '../scripts/event-dashboard-api.mjs';

const TEST_USER = 'sl-p4-test-' + Date.now();
const TEST_ITEM_TYPE = 'theme';
const TEST_ITEM_ID = 'p4-test-theme-' + Date.now();

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

async function postJson(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function deleteRequest(base, path) {
  const res = await fetch(`${base}${path}`, { method: 'DELETE' });
  return { status: res.status, body: await res.json() };
}

async function getJson(base, path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

test('watchlist follow persists across reads', async () => {
  await withServer(async ({ base }) => {
    const setRes = await postJson(base, '/api/watchlist', {
      userId: TEST_USER,
      itemType: TEST_ITEM_TYPE,
      itemId: TEST_ITEM_ID,
      state: 'follow',
      reviewer: 'sl-p4-test',
      note: 'follow test',
    });
    assert.equal(setRes.status, 200, JSON.stringify(setRes.body));
    assert.equal(setRes.body.ok, true);
    assert.equal(setRes.body.entry.state, 'follow');
    assert.ok(setRes.body.audit?.requestId);

    const getRes = await getJson(base, `/api/watchlist/${TEST_ITEM_TYPE}/${encodeURIComponent(TEST_ITEM_ID)}?user=${TEST_USER}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.entry?.state, 'follow', 'state must persist');
  });
});

test('watchlist mute overrides previous follow on same item', async () => {
  await withServer(async ({ base }) => {
    await postJson(base, '/api/watchlist', { userId: TEST_USER, itemType: TEST_ITEM_TYPE, itemId: TEST_ITEM_ID, state: 'follow' });
    const muteRes = await postJson(base, '/api/watchlist', {
      userId: TEST_USER, itemType: TEST_ITEM_TYPE, itemId: TEST_ITEM_ID, state: 'mute',
    });
    assert.equal(muteRes.body.entry.state, 'mute');

    const getRes = await getJson(base, `/api/watchlist/${TEST_ITEM_TYPE}/${encodeURIComponent(TEST_ITEM_ID)}?user=${TEST_USER}`);
    assert.equal(getRes.body.entry.state, 'mute');
  });
});

test('watchlist snooze requires snoozeUntil', async () => {
  await withServer(async ({ base }) => {
    const noStamp = await postJson(base, '/api/watchlist', {
      userId: TEST_USER, itemType: TEST_ITEM_TYPE, itemId: TEST_ITEM_ID + '-snooze', state: 'snooze',
    });
    assert.equal(noStamp.status, 500, 'missing snoozeUntil should error');

    const future = new Date(Date.now() + 3_600_000).toISOString();
    const ok = await postJson(base, '/api/watchlist', {
      userId: TEST_USER, itemType: TEST_ITEM_TYPE, itemId: TEST_ITEM_ID + '-snooze', state: 'snooze', snoozeUntil: future,
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.entry.state, 'snooze');
    assert.ok(ok.body.entry.snooze_until, 'snooze_until should be set');
  });
});

test('watchlist invalid itemType returns 400 with audit.requestId', async () => {
  await withServer(async ({ base }) => {
    const res = await postJson(base, '/api/watchlist', {
      userId: TEST_USER, itemType: 'BOGUS', itemId: 'x', state: 'follow',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /invalid itemType/i);
    assert.ok(res.body.audit?.requestId);
  });
});

test('watchlist invalid state returns 400', async () => {
  await withServer(async ({ base }) => {
    const res = await postJson(base, '/api/watchlist', {
      userId: TEST_USER, itemType: 'theme', itemId: 'x', state: 'BOGUS',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /invalid state/i);
  });
});

test('list watchlist filters by user and type', async () => {
  await withServer(async ({ base }) => {
    await postJson(base, '/api/watchlist', { userId: TEST_USER, itemType: TEST_ITEM_TYPE, itemId: TEST_ITEM_ID + '-list-1', state: 'follow' });
    await postJson(base, '/api/watchlist', { userId: TEST_USER, itemType: TEST_ITEM_TYPE, itemId: TEST_ITEM_ID + '-list-2', state: 'mute' });

    const all = await getJson(base, `/api/watchlist?user=${TEST_USER}`);
    assert.ok(all.body.count >= 2);

    const follows = await getJson(base, `/api/watchlist?user=${TEST_USER}&state=follow`);
    for (const entry of follows.body.entries) {
      assert.equal(entry.state, 'follow');
    }
  });
});

test('delete removes entry and writes audit', async () => {
  await withServer(async ({ base }) => {
    const itemId = TEST_ITEM_ID + '-delete';
    await postJson(base, '/api/watchlist', { userId: TEST_USER, itemType: TEST_ITEM_TYPE, itemId, state: 'follow' });
    const delRes = await deleteRequest(base, `/api/watchlist/${TEST_ITEM_TYPE}/${encodeURIComponent(itemId)}?user=${TEST_USER}`);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.removed, true);
    assert.ok(delRes.body.audit?.requestId);

    const getRes = await getJson(base, `/api/watchlist/${TEST_ITEM_TYPE}/${encodeURIComponent(itemId)}?user=${TEST_USER}`);
    assert.equal(getRes.body.entry, null, 'entry should be gone');
  });
});

test('watchlist action shows up in /api/inbox/audit', async () => {
  await withServer(async ({ base }) => {
    const itemId = TEST_ITEM_ID + '-audit-' + Math.random().toString(36).slice(2, 6);
    await postJson(base, '/api/watchlist', {
      userId: TEST_USER, itemType: TEST_ITEM_TYPE, itemId, state: 'follow', reviewer: 'sl-p4-audit-test',
    });
    const audit = await getJson(base, `/api/inbox/audit?type=e2_signal&id=${encodeURIComponent(itemId)}&limit=5`);
    assert.equal(audit.body.ok, true);
    assert.ok(audit.body.entries.length >= 1, 'audit row must exist');
    const entry = audit.body.entries.find((e) => e.item_id === itemId);
    assert.ok(entry, `audit entry for ${itemId} not found`);
    assert.equal(entry.next_state, 'follow');
    assert.equal(entry.reviewer, 'sl-p4-audit-test');
  });
});
