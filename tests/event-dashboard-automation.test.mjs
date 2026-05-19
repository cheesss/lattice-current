import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFileSync } from 'node:fs';

import {
  loadApprovalById,
  queueForApproval,
  reviewApprovalQueueItemById,
} from '../scripts/_shared/approval-queue.mjs';
import { AUTOMATION_SCHEMA_STATEMENTS } from '../scripts/_shared/schema-automation.mjs';
import {
  deriveProposalExecutionStatus,
  reviewCodexProposalById,
} from '../scripts/proposal-executor.mjs';
import {
  closeEventDashboardResources,
  startEventDashboardServer,
} from '../scripts/event-dashboard-api.mjs';

process.env.PGHOST ||= '127.0.0.1';
process.env.PGPORT ||= '5432';
process.env.PGUSER ||= 'test';
process.env.PGDATABASE ||= 'test';
process.env.PGPASSWORD ||= 'test';

const dashboardApiSource = readFileSync(new URL('../scripts/event-dashboard-api.mjs', import.meta.url), 'utf8');
const dashboardHtmlSource = readFileSync(new URL('../event-dashboard.html', import.meta.url), 'utf8');

function normalizeSql(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

test('automation schema allows needs-fix approval queue status', () => {
  const schema = AUTOMATION_SCHEMA_STATEMENTS.join('\n');
  assert.match(schema, /needs-fix/);
  assert.match(schema, /context-collected/);
  assert.match(schema, /negative-control-collected/);
  assert.match(schema, /weak-noise-collected/);
  assert.match(schema, /approval_queue_status_check/);
});

test('dashboard exposes report backfill closure summary without approval execution controls', () => {
  const routeStart = dashboardApiSource.indexOf("segments[2] === 'backfill-closure'");
  const routeBlock = dashboardApiSource.slice(routeStart, routeStart + 1800);
  assert.match(dashboardApiSource, /backfill-closure/);
  assert.match(dashboardApiSource, /loadReportBackfillClosureSummaries/);
  assert.match(dashboardApiSource, /openClasses/);
  assert.match(dashboardApiSource, /marketTier/);
  assert.match(dashboardApiSource, /negativeControlStatus/);
  assert.match(dashboardApiSource, /classRows/);
  assert.match(dashboardApiSource, /primaryBlocker/);
  assert.match(dashboardApiSource, /nextAction/);
  assert.match(dashboardApiSource, /visualStatus/);
  assert.match(dashboardApiSource, /adjacent-theme-candidates/);
  assert.match(dashboardApiSource, /loadAdjacentThemeCandidateSummaries/);
  assert.match(dashboardApiSource, /generatedLane/);
  assert.match(dashboardApiSource, /seedLeakageScore/);
  assert.match(dashboardApiSource, /relationSupport/);
  assert.match(dashboardApiSource, /candidateIssuerCount/);
  assert.match(dashboardApiSource, /bridgeAttachedCount/);
  assert.match(dashboardApiSource, /issuerMappingGapCount/);
  assert.match(dashboardApiSource, /latestReportPath/);
  assert.notEqual(routeStart, -1);
  assert.doesNotMatch(routeBlock, /markApprovalReviewed|markApprovalReviewed\(/);
  assert.match(dashboardHtmlSource, /Report Backfill/);
  assert.match(dashboardHtmlSource, /Adjacent Themes/);
  assert.match(dashboardHtmlSource, /loadAdjacentThemeCandidates/);
  assert.match(dashboardHtmlSource, /loadReportBackfillClosure/);
  assert.match(dashboardHtmlSource, /review-ready/);
  assert.match(dashboardHtmlSource, /rejected/);
  const modernSurfaces = readFileSync(new URL('../src/dashboard/surfaces/report-backfill.mjs', import.meta.url), 'utf8');
  assert.match(modernSurfaces, /Evidence closure matrix/);
  assert.match(modernSurfaces, /renderClosureMatrix/);
  assert.match(modernSurfaces, /Audit details/);
});

test('approval queue review routes source-query approvals to source-query executor', () => {
  const routeStart = dashboardApiSource.indexOf('async function reviewApprovalQueueItem');
  const routeBlock = dashboardApiSource.slice(routeStart, routeStart + 5200);
  assert.notEqual(routeStart, -1);
  assert.match(dashboardApiSource, /executeSourceQueryApproval/);
  assert.match(routeBlock, /action_type[\s\S]+source-query/);
  assert.match(routeBlock, /executeSourceQueryApproval/);
  assert.ok(
    routeBlock.indexOf('executeSourceQueryApproval') < routeBlock.indexOf('executeProposal'),
    'source-query approvals must not fall through to generic proposal executor',
  );
});

function createApprovalQueueClient(seed = {}) {
  let row = seed ? {
    id: Number(seed.id || 1),
    action_type: seed.action_type || 'add-rss',
    payload: seed.payload || { url: 'https://example.com/rss.xml' },
    status: seed.status || 'pending',
    reasoning: seed.reasoning || null,
    created_at: seed.created_at || '2026-04-09T00:00:00.000Z',
    reviewed_at: seed.reviewed_at || null,
    reviewer: seed.reviewer || null,
  } : null;
  const calls = [];

  return {
    calls,
    get row() {
      return row;
    },
    async query(text, values = []) {
      const sql = normalizeSql(text);
      calls.push({ sql, values });

      if (sql.includes('from approval_queue') && sql.includes('where id = $1')) {
        return {
          rows: row && row.id === Number(values[0]) ? [row] : [],
        };
      }

      if (sql.startsWith('update approval_queue')) {
        if (!row || row.id !== Number(values[0])) {
          return { rows: [] };
        }
        const appendedNote = String(values[3] || '').trim();
        row = {
          ...row,
          status: String(values[1]),
          reviewer: String(values[2]),
          reviewed_at: '2026-04-09T00:10:00.000Z',
          reasoning: appendedNote
            ? [row.reasoning, appendedNote].filter(Boolean).join('\n')
            : row.reasoning,
        };
        return { rows: [row] };
      }

      throw new Error(`Unexpected approval queue query: ${sql}`);
    },
  };
}

function createProposalClient(seed = {}) {
  let row = seed ? {
    id: Number(seed.id || 1),
    proposal_type: seed.proposal_type || 'attach-theme',
    payload: seed.payload || {
      targetTheme: 'semiconductors',
      attachmentKey: 'taiwan-supply-chain',
      label: 'Taiwan supply chain',
      symbols: ['TSM'],
    },
    status: seed.status || 'pending',
    result: seed.result || null,
    reasoning: seed.reasoning || null,
    source: seed.source || 'test-suite',
    created_at: seed.created_at || '2026-04-09T00:00:00.000Z',
    executed_at: seed.executed_at || null,
  } : null;
  const calls = [];

  return {
    calls,
    get row() {
      return row;
    },
    async query(text, values = []) {
      const sql = normalizeSql(text);
      calls.push({ sql, values });

      if (sql.startsWith('create table') || sql.startsWith('create index') || sql.startsWith('alter table') || sql.startsWith('do $$')) {
        return { rows: [] };
      }

      if (sql.includes('from codex_proposals') && sql.includes('where id = $1')) {
        return {
          rows: row && row.id === Number(values[0]) ? [row] : [],
        };
      }

      if (sql.startsWith('update codex_proposals set status = $1')) {
        if (!row || row.id !== Number(values[2])) {
          return { rows: [] };
        }
        row = {
          ...row,
          status: String(values[0]),
          result: JSON.parse(values[1]),
          executed_at: '2026-04-09T00:30:00.000Z',
        };
        return { rows: [] };
      }

      throw new Error(`Unexpected proposal query: ${sql}`);
    },
  };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await closeEventDashboardResources();
}

function installPoolQueryMock(handler) {
  const originalQuery = pg.Pool.prototype.query;
  const originalEnd = pg.Pool.prototype.end;

  pg.Pool.prototype.query = function patchedQuery(text, values) {
    return handler.call(this, text, values);
  };
  pg.Pool.prototype.end = async function patchedEnd() {};

  return async () => {
    pg.Pool.prototype.query = originalQuery;
    pg.Pool.prototype.end = originalEnd;
    await closeEventDashboardResources();
  };
}

test('event dashboard exposes automation observability routes', { concurrency: false }, async () => {
  const restorePool = installPoolQueryMock(async () => ({ rows: [] }));
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

    const surfaceModuleResponse = await fetch(`http://127.0.0.1:${port}/src/dashboard/surfaces/index.mjs`);
    assert.equal(surfaceModuleResponse.status, 200);
    assert.match(surfaceModuleResponse.headers.get('content-type') || '', /text\/javascript/);

    const surfaceCssResponse = await fetch(`http://127.0.0.1:${port}/src/dashboard/surfaces/surfaces.css`);
    assert.equal(surfaceCssResponse.status, 200);
    assert.match(surfaceCssResponse.headers.get('content-type') || '', /text\/css/);
  } finally {
    await closeServer(server);
    await restorePool();
  }
});

test('event dashboard review routes update proposal and approval payloads', { concurrency: false }, async () => {
  const proposalRow = {
    id: 17,
    proposal_type: 'attach-theme',
    payload: {
      targetTheme: 'semiconductors',
      attachmentKey: 'taiwan-supply-chain',
      label: 'Taiwan supply chain',
      symbols: ['TSM'],
    },
    status: 'pending',
    result: null,
    reasoning: 'queued from test',
    source: 'test-suite',
    created_at: '2026-04-09T00:00:00.000Z',
    executed_at: null,
  };
  const approvalRow = {
    id: 21,
    action_type: 'attach-theme',
    payload: {
      targetTheme: 'semiconductors',
      attachmentKey: 'packaging-bottleneck',
      label: 'Packaging bottleneck',
      symbols: ['ASML'],
    },
    status: 'pending',
    reasoning: 'needs human check',
    created_at: '2026-04-09T00:00:00.000Z',
    reviewed_at: null,
    reviewer: null,
  };
  const restorePool = installPoolQueryMock(async (text, values = []) => {
    const sql = normalizeSql(text);

    if (sql.startsWith('create table') || sql.startsWith('create index') || sql.startsWith('alter table')) {
      return { rows: [] };
    }

    if (sql.includes('from codex_proposals') && sql.includes('where id = $1')) {
      return {
        rows: Number(values[0]) === 17 ? [proposalRow] : [],
      };
    }

    if (sql.startsWith('update codex_proposals set status = $1')) {
      if (Number(values[2]) !== 17) return { rows: [] };
      proposalRow.status = String(values[0]);
      proposalRow.result = JSON.parse(values[1]);
      proposalRow.executed_at = '2026-04-09T00:20:00.000Z';
      return { rows: [] };
    }

    if (sql.includes('from approval_queue') && sql.includes('where id = $1')) {
      return {
        rows: Number(values[0]) === 21 ? [approvalRow] : [],
      };
    }

    if (sql.startsWith('update approval_queue')) {
      if (Number(values[0]) !== 21) return { rows: [] };
      const note = String(values[3] || '').trim();
      approvalRow.status = String(values[1]);
      approvalRow.reviewed_at = '2026-04-09T00:25:00.000Z';
      approvalRow.reviewer = String(values[2]);
      approvalRow.reasoning = note
        ? [approvalRow.reasoning, note].filter(Boolean).join('\n')
        : approvalRow.reasoning;
      return {
        rows: [approvalRow],
      };
    }

    return { rows: [] };
  });

  const server = startEventDashboardServer(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const approveProposal = await fetch(`http://127.0.0.1:${port}/api/codex-proposals/17/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'accept', reviewer: 'qa-user' }),
    });
    assert.equal(approveProposal.status, 200);
    const proposalPayload = await approveProposal.json();
    assert.equal(proposalPayload.proposal.id, 17);
    assert.equal(proposalPayload.proposal.status, 'executed');
    assert.match(String(proposalPayload.proposal.result.summary), /Attachment/);

    const approveApproval = await fetch(`http://127.0.0.1:${port}/api/approval-queue/21/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'accept', reviewer: 'ops-user' }),
    });
    assert.equal(approveApproval.status, 200);
    const approvalPayload = await approveApproval.json();
    assert.equal(approvalPayload.approval.id, 21);
    assert.equal(approvalPayload.approval.status, 'executed');
    assert.equal(approvalPayload.approval.reviewer, 'ops-user');
    assert.match(String(approvalPayload.execution.summary), /Attachment/);

    const invalidDecision = await fetch(`http://127.0.0.1:${port}/api/codex-proposals/17/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'later' }),
    });
    assert.equal(invalidDecision.status, 400);

    const missingProposal = await fetch(`http://127.0.0.1:${port}/api/codex-proposals/404/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'accept' }),
    });
    assert.equal(missingProposal.status, 404);

    const themeShellSnapshots = await fetch(`http://127.0.0.1:${port}/api/theme-shell-snapshots`);
    assert.equal(themeShellSnapshots.status, 200);
    const snapshotPayload = await themeShellSnapshots.json();
    assert.ok(Object.prototype.hasOwnProperty.call(snapshotPayload, 'risk'));
    assert.ok(Object.prototype.hasOwnProperty.call(snapshotPayload, 'macro'));
    assert.ok(Object.prototype.hasOwnProperty.call(snapshotPayload, 'investment'));
    assert.ok(Object.prototype.hasOwnProperty.call(snapshotPayload, 'validation'));
  } finally {
    await closeServer(server);
    await restorePool();
  }
});

test('approval queue helpers load items and respect final review state', { concurrency: false }, async () => {
  const client = createApprovalQueueClient({
    id: 7,
    reasoning: 'manual approval required',
  });

  const loaded = await loadApprovalById(client, 7);
  assert.equal(loaded.id, 7);
  assert.equal(loaded.status, 'pending');

  const reviewed = await reviewApprovalQueueItemById(client, 7, 'accept', {
    reviewer: 'theme-dashboard',
    note: 'looks safe',
  });
  assert.equal(reviewed.status, 'approved');
  assert.equal(reviewed.alreadyFinal, false);
  assert.equal(client.row.reviewer, 'theme-dashboard');
  assert.match(String(client.row.reasoning), /looks safe/);

  const finalState = await reviewApprovalQueueItemById(client, 7, 'reject', {
    reviewer: 'theme-dashboard',
  });
  assert.equal(finalState.status, 'approved');
  assert.equal(finalState.alreadyFinal, true);
  assert.equal(
    client.calls.filter((call) => call.sql.startsWith('update approval_queue')).length,
    1,
  );
});

test('queueForApproval dedupes existing pending source URLs', { concurrency: false }, async () => {
  let row = {
    id: 19,
    action_type: 'add-rss',
    payload: { url: 'https://example.com/feed.xml', qualityScore: 0.2 },
    status: 'needs-fix',
    reasoning: 'old failed probe',
    created_at: '2026-04-09T00:00:00.000Z',
  };
  let insertCount = 0;
  const calls = [];
  const client = {
    async query(text, values = []) {
      const sql = normalizeSql(text);
      calls.push({ sql, values });
      if (sql.includes('from approval_queue') && sql.includes("regexp_replace(payload->>'url'")) {
        return { rows: [row] };
      }
      if (sql.startsWith('update approval_queue')) {
        row = {
          ...row,
          payload: JSON.parse(values[1]),
          status: 'pending',
          reasoning: [row.reasoning, values[2]].filter(Boolean).join('\n'),
        };
        return {
          rows: [{
            id: row.id,
            action_type: row.action_type,
            status: row.status,
            created_at: row.created_at,
          }],
        };
      }
      if (sql.startsWith('insert into approval_queue')) {
        insertCount += 1;
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const queued = await queueForApproval(client, {
    type: 'add-rss',
    params: {
      url: 'https://example.com/feed.xml/',
      name: 'Example Feed',
      qualityScore: 0.88,
    },
    reason: 'new passing probe',
  });

  assert.equal(queued.id, 19);
  assert.equal(queued.status, 'pending');
  assert.equal(queued.deduped, true);
  assert.equal(insertCount, 0);
  assert.equal(row.payload.qualityScore, 0.88);
  assert.match(row.reasoning, /new passing probe/);
  assert.equal(calls.find((call) => call.sql.includes('from approval_queue'))?.values?.[1], 'https://example.com/feed.xml');
  assert.equal(calls.filter((call) => call.sql.startsWith('update approval_queue')).length, 1);
});

test('proposal execution helpers derive statuses and avoid rewriting final proposals', { concurrency: false }, async () => {
  assert.equal(deriveProposalExecutionStatus({ pendingApproval: true }), 'pending-approval');
  assert.equal(deriveProposalExecutionStatus({ skipped: true }), 'skipped');
  assert.equal(deriveProposalExecutionStatus({ ok: true }), 'executed');
  assert.equal(deriveProposalExecutionStatus({ ok: true }, { dryRun: true }), 'dry-run');

  const pendingClient = createProposalClient({ id: 11, status: 'pending' });
  const accepted = await reviewCodexProposalById(pendingClient, 11, 'accept', {
    reviewer: 'theme-dashboard',
  });
  assert.equal(accepted.status, 'executed');
  assert.equal(accepted.alreadyFinal, false);
  assert.match(String(accepted.result.summary), /Attachment/);
  assert.equal(pendingClient.row.status, 'executed');

  const finalClient = createProposalClient({
    id: 12,
    status: 'executed',
    result: { summary: 'already done' },
    executed_at: '2026-04-09T00:40:00.000Z',
  });
  const finalReview = await reviewCodexProposalById(finalClient, 12, 'reject', {
    reviewer: 'theme-dashboard',
  });
  assert.equal(finalReview.status, 'executed');
  assert.equal(finalReview.alreadyFinal, true);
  assert.equal(
    finalClient.calls.filter((call) => call.sql.startsWith('update codex_proposals set status = $1')).length,
    0,
  );
});
