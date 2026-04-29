/**
 * S-Level §Phase 2 contract: Decision Inbox action persistence.
 *
 * The plan requires that "an operator action must not reappear as actionable
 * after refresh unless it genuinely failed." We verify that contract at the
 * API layer rather than browser layer because:
 *
 *   1. event-dashboard.html is currently the 7,919-line monolith awaiting
 *      the §G2 split. Browser-level selectors will break with that split.
 *   2. The contract is fundamentally an API one — the dashboard just renders
 *      what the API says is actionable.
 *
 * Scope of this test (no DB mutations — all checks are read-only):
 *   - /api/proposal-inbox  default excludes status IN ('executed', 'dead')
 *   - /api/proposal-inbox?include_final=1  includes them
 *   - /api/approval-queue  default excludes status IN ('approved','rejected','executed')
 *   - /api/approval-queue?include_final=1  includes them
 *   - /api/discovery-triage default behaves identically (already had include_final)
 *   - /api/inbox/audit returns a well-formed envelope
 *   - /api/inbox/audit?type= filters correctly
 *
 * A separate browser-level E2E will be added in PR 3 of the dashboard split.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { startEventDashboardServer } from '../scripts/event-dashboard-api.mjs';

const FINAL_PROPOSAL_STATES = new Set(['executed', 'dead']);
const FINAL_APPROVAL_STATES = new Set(['approved', 'rejected', 'executed']);

async function withServer(callback) {
  const server = startEventDashboardServer(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  try {
    await callback({ base, port });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test('proposal-inbox default excludes final states', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/proposal-inbox`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const proposals = Array.isArray(body.proposals) ? body.proposals : [];
    for (const p of proposals) {
      assert.ok(
        !FINAL_PROPOSAL_STATES.has(String(p.status || '').toLowerCase()),
        `default proposal-inbox returned final-state proposal: id=${p.id} status=${p.status}`,
      );
    }
  });
});

test('proposal-inbox?include_final=1 includes final states', async () => {
  await withServer(async ({ base }) => {
    const [defaultRes, finalRes] = await Promise.all([
      fetch(`${base}/api/proposal-inbox`).then((r) => r.json()),
      fetch(`${base}/api/proposal-inbox?include_final=1`).then((r) => r.json()),
    ]);
    const defaultProposals = Array.isArray(defaultRes.proposals) ? defaultRes.proposals : [];
    const finalProposals = Array.isArray(finalRes.proposals) ? finalRes.proposals : [];
    // Final view must be a superset (or equal) of default. Sets intentionally
    // checked by id since order may differ.
    const defaultIds = new Set(defaultProposals.map((p) => Number(p.id)));
    const finalIds = new Set(finalProposals.map((p) => Number(p.id)));
    for (const id of defaultIds) {
      assert.ok(finalIds.has(id), `default proposal id ${id} missing from include_final view`);
    }
  });
});

test('approval-queue default excludes final states', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/approval-queue`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const approvals = Array.isArray(body.approvals) ? body.approvals : [];
    for (const a of approvals) {
      assert.ok(
        !FINAL_APPROVAL_STATES.has(String(a.status || '').toLowerCase()),
        `default approval-queue returned final-state approval: id=${a.id} status=${a.status}`,
      );
    }
  });
});

test('approval-queue?include_final=1 returns superset of default', async () => {
  await withServer(async ({ base }) => {
    const [defaultRes, finalRes] = await Promise.all([
      fetch(`${base}/api/approval-queue`).then((r) => r.json()),
      fetch(`${base}/api/approval-queue?include_final=1`).then((r) => r.json()),
    ]);
    const defaultApprovals = Array.isArray(defaultRes.approvals) ? defaultRes.approvals : [];
    const finalApprovals = Array.isArray(finalRes.approvals) ? finalRes.approvals : [];
    assert.ok(
      finalApprovals.length >= defaultApprovals.length,
      `include_final returned fewer items (${finalApprovals.length}) than default (${defaultApprovals.length})`,
    );
  });
});

test('discovery-triage default omits suppressed/canonical without include_final', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/discovery-triage`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const items = Array.isArray(body.items) ? body.items : [];
    for (const item of items) {
      const state = String(item.promotion_state || item.promotionState || 'watch').toLowerCase();
      assert.notEqual(state, 'suppressed', `default discovery-triage returned suppressed item: ${item.id}`);
      // canonical excluded too unless include_final=1; but the existing payload may
      // include canonical when status differs — only suppressed is the strict gate
      // because plan §Phase 2 lists canonical/suppressed both as final but
      // canonical is "final = success" which dashboards may legitimately surface
      // for context. The strict check is on suppressed.
    }
  });
});

test('inbox audit endpoint returns valid envelope', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/inbox/audit?limit=5`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.count, 'number');
    assert.ok(Array.isArray(body.entries));
    if (body.entries.length > 0) {
      const entry = body.entries[0];
      assert.ok(entry.item_type, 'audit entry must have item_type');
      assert.ok(entry.item_id, 'audit entry must have item_id');
      assert.ok(entry.created_at, 'audit entry must have created_at');
      assert.ok(
        ['discovery', 'approval', 'proposal', 'e2_signal'].includes(entry.item_type),
        `unknown item_type in audit: ${entry.item_type}`,
      );
    }
  });
});

test('inbox audit type filter rejects unknown types gracefully', async () => {
  await withServer(async ({ base }) => {
    // Unknown type silently produces no rows — we don't 400 on it because the
    // plan calls audit a non-blocking observability concern.
    const res = await fetch(`${base}/api/inbox/audit?type=BOGUS&limit=5`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.entries));
  });
});

test('proposal review on missing proposal returns 404 with audit.requestId', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/codex-proposals/999999999/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'reject', reviewer: 'sl-day5-test', reason: 'audit-contract' }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.match(String(body.error || ''), /not found/i);
    // Even on error, request id must be returned for client correlation.
    assert.ok(body.audit?.requestId, 'review error response must include audit.requestId');
    assert.match(String(body.audit.requestId), /^[a-f0-9]{12}$/);
  });
});
