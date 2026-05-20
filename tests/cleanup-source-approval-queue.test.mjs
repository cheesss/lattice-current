import test from 'node:test';
import assert from 'node:assert/strict';

import {
  planApprovalQueueCleanup,
} from '../scripts/cleanup-source-approval-queue.mjs';

function approval(id, status, url, reasoning = '', createdAt = `2026-04-09T00:${String(id).padStart(2, '0')}:00.000Z`) {
  return {
    id,
    status,
    action_type: 'add-rss',
    payload: { url, name: `source ${id}` },
    reasoning,
    created_at: createdAt,
  };
}

test('cleanup reopens executed low-quality approvals without registration evidence', () => {
  const updates = planApprovalQueueCleanup({
    approvals: [
      approval(1, 'executed', 'https://bad.example.com/', 'quality 0.00 below threshold 0.65'),
    ],
    activeSources: [],
  });

  assert.deepEqual(updates.map((update) => [update.id, update.toStatus]), [[1, 'needs-fix']]);
});

test('cleanup rejects duplicate open approvals and keeps the newest open item', () => {
  const updates = planApprovalQueueCleanup({
    approvals: [
      approval(1, 'pending', 'https://dup.example.com/feed.xml', '', '2026-04-09T00:01:00.000Z'),
      approval(2, 'needs-fix', 'https://dup.example.com/feed.xml', '', '2026-04-09T00:02:00.000Z'),
      approval(3, 'pending', 'https://dup.example.com/feed.xml', '', '2026-04-09T00:03:00.000Z'),
    ],
    activeSources: [],
  });

  assert.deepEqual(updates.map((update) => [update.id, update.toStatus]), [
    [1, 'rejected'],
    [2, 'rejected'],
  ]);
  assert.match(updates[0].note, /latest retained as #3/);
});

test('cleanup rejects open approvals superseded by an active resolved source on the same host', () => {
  const updates = planApprovalQueueCleanup({
    approvals: [
      approval(1, 'pending', 'https://source-fixture.test/'),
      approval(2, 'needs-fix', 'https://source-fixture.test/'),
    ],
    activeSources: [
      { status: 'active', url: 'https://source-fixture.test/feed/' },
    ],
  });

  assert.deepEqual(updates.map((update) => [update.id, update.toStatus]), [
    [1, 'rejected'],
    [2, 'rejected'],
  ]);
  assert.match(updates[0].note, /superseded by active source registry/);
});

test('cleanup keeps executed zero-seed approvals when an active source exists on the same host', () => {
  const updates = planApprovalQueueCleanup({
    approvals: [
      approval(1, 'executed', 'https://source-fixture.test/', 'RSS source: registered and seeded 0 articles'),
    ],
    activeSources: [
      { status: 'active', url: 'https://source-fixture.test/feed/' },
    ],
  });

  assert.deepEqual(updates, []);
});

test('cleanup rejects temporary verification approval rows', () => {
  const updates = planApprovalQueueCleanup({
    approvals: [
      approval(1, 'needs-fix', 'https://example.com/', 'temporary browser click verification row'),
    ],
    activeSources: [],
  });

  assert.deepEqual(updates.map((update) => [update.id, update.toStatus]), [[1, 'rejected']]);
  assert.match(updates[0].note, /temporary verification/);
});

test('cleanup rejects stale needs-fix approvals with repeated probe rejects', () => {
  const updates = planApprovalQueueCleanup({
    approvals: [
      approval(
        1,
        'needs-fix',
        'https://stale-source.example.com/',
        'skipped: probe reject: quality 0.00\nskipped: probe reject: quality 0.00',
        '2026-04-15T00:00:00.000Z',
      ),
      approval(
        2,
        'needs-fix',
        'https://fresh-source.example.com/',
        'skipped: probe reject: quality 0.00',
        '2026-04-21T00:00:00.000Z',
      ),
    ],
    activeSources: [],
    now: new Date('2026-04-21T12:00:00.000Z'),
  });

  assert.deepEqual(updates.map((update) => [update.id, update.toStatus]), [[1, 'rejected']]);
  assert.match(updates[0].note, /no passing repair candidate/);
});
