/**
 * S-Level Phase 8: browser E2E for Decision Inbox action + refresh.
 *
 * Contract: an operator action must not reappear as actionable after refresh
 * unless the backend action genuinely failed.
 */
import { expect, test, type Page, type Route } from '@playwright/test';

const DASHBOARD_URL = 'http://127.0.0.1:4173/event-dashboard.html';

const APPROVAL_FIXTURE_ID = 'approval-action-refresh-001';
const BLOCKED_APPROVAL_FIXTURE_ID = 'approval-blocked-retry-001';
const PROPOSAL_FIXTURE_ID = 9_998_001;

type InboxState = {
  proposals: unknown[];
  approvals: unknown[];
};

let inboxState: InboxState = { proposals: [], approvals: [] };

function resetFixtures() {
  inboxState = {
    proposals: [
      {
        id: PROPOSAL_FIXTURE_ID,
        proposal_type: 'add-rss',
        proposalType: 'add-rss',
        status: 'pending',
        source: 'codex',
        payload: { url: 'https://example.test/feed.xml', label: 'Action+refresh fixture' },
        reasoning: 'Refresh test fixture',
        created_at: new Date().toISOString(),
      },
    ],
    approvals: [
      {
        id: APPROVAL_FIXTURE_ID,
        action_type: 'add-rss-untrusted',
        status: 'pending',
        payload: { url: 'https://example.test/untrusted.xml', label: 'Action+refresh fixture' },
        reasoning: 'Refresh test fixture',
        created_at: new Date().toISOString(),
      },
    ],
  };
}

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function readJsonFromPostData(raw: string | null): Record<string, unknown> {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function setupRoutes(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname;
    const includeFinal =
      url.searchParams.get('include_final') === '1'
      || url.searchParams.get('includeFinal') === '1';

    if (method === 'GET' && path === '/api/proposal-inbox') {
      const proposals = includeFinal
        ? inboxState.proposals
        : inboxState.proposals.filter((p: any) => !['executed', 'dead', 'rejected'].includes(String(p.status).toLowerCase()));
      const approvals = includeFinal
        ? inboxState.approvals
        : inboxState.approvals.filter((a: any) => !['approved', 'rejected', 'executed'].includes(String(a.status).toLowerCase()));
      return fulfill(route, { proposals, approvals, summary: { actionableCount: proposals.length + approvals.length } });
    }

    if (method === 'POST' && path.startsWith('/api/approval-queue/') && path.endsWith('/review')) {
      const queueId = path.split('/')[3];
      const body = readJsonFromPostData(route.request().postData());
      const decision = String(body?.decision || '').toLowerCase();
      const target = inboxState.approvals.find((a: any) => String(a.id) === String(queueId));
      if (target) {
        (target as any).status = decision === 'reject' ? 'rejected' : 'executed';
      }
      return fulfill(route, { approval: target, audit: { requestId: 'mock-' + queueId } });
    }

    if (method === 'POST' && path.startsWith('/api/codex-proposals/') && path.endsWith('/review')) {
      const proposalId = path.split('/')[3];
      const body = readJsonFromPostData(route.request().postData());
      const decision = String(body?.decision || '').toLowerCase();
      const target = inboxState.proposals.find((p: any) => String(p.id) === String(proposalId));
      if (target) {
        (target as any).status = decision === 'reject' ? 'rejected' : 'executed';
      }
      return fulfill(route, { proposal: target, audit: { requestId: 'mock-' + proposalId } });
    }

    if (method === 'GET') {
      return fulfill(route, { ok: true, data: null, items: [], events: [], signals: [] });
    }

    return fulfill(route, { error: `Unexpected mocked API: ${method} ${path}` }, 501);
  });
}

async function loadInboxSurface(page: Page) {
  await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.surface-nav', { timeout: 10_000 });
  await page.click('.surface-nav-btn[data-surface="inbox"]');
  await page.waitForSelector('.surface[data-surface="inbox"].active', { timeout: 5_000 });
}

async function clickInboxAction(page: Page, itemId: string, action: string) {
  await page.locator(`.inbox-item[data-id="${itemId}"]`).click();
  await page.locator(`#inbox-preview-content [data-inbox-action="${action}"][data-inbox-item-id="${itemId}"]`).click();
}

test.beforeEach(() => {
  resetFixtures();
});

test.describe('Decision Inbox action persists after refresh', () => {
  test('approval rejection does not reappear after reload', async ({ page }) => {
    await setupRoutes(page);
    await loadInboxSurface(page);

    await expect(page.locator(`.inbox-item[data-id="approval-${APPROVAL_FIXTURE_ID}"]`)).toBeVisible();

    const reviewRequest = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes(`/api/approval-queue/${APPROVAL_FIXTURE_ID}/review`),
    );
    await clickInboxAction(page, `approval-${APPROVAL_FIXTURE_ID}`, 'reject');
    const request = await reviewRequest;
    expect(readJsonFromPostData(request.postData())).toMatchObject({
      decision: 'reject',
      reviewer: 'theme-dashboard',
    });
    await expect(page.locator('#inbox-preview-content')).toContainText('REJECTED');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.click('.surface-nav-btn[data-surface="inbox"]');
    await page.waitForSelector('.surface[data-surface="inbox"].active', { timeout: 5_000 });

    await expect(page.locator(`.inbox-item[data-id="approval-${APPROVAL_FIXTURE_ID}"]`)).toHaveCount(0);

    const historyJson = await page.evaluate(async () => {
      const res = await fetch('/api/proposal-inbox?include_final=1');
      return res.json();
    });
    const historyIds = (historyJson.approvals || []).map((a: { id: unknown }) => String(a.id));
    expect(historyIds).toContain(APPROVAL_FIXTURE_ID);
  });

  test('proposal rejection does not reappear after reload', async ({ page }) => {
    await setupRoutes(page);
    await loadInboxSurface(page);

    await expect(page.locator(`.inbox-item[data-id="proposal-${PROPOSAL_FIXTURE_ID}"]`)).toBeVisible();

    const reviewRequest = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes(`/api/codex-proposals/${PROPOSAL_FIXTURE_ID}/review`),
    );
    await clickInboxAction(page, `proposal-${PROPOSAL_FIXTURE_ID}`, 'reject');
    const request = await reviewRequest;
    expect(readJsonFromPostData(request.postData())).toMatchObject({
      decision: 'reject',
      reviewer: 'theme-dashboard',
    });
    await expect(page.locator('#inbox-preview-content')).toContainText('REJECTED');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.click('.surface-nav-btn[data-surface="inbox"]');
    await page.waitForSelector('.surface[data-surface="inbox"].active', { timeout: 5_000 });

    await expect(page.locator(`.inbox-item[data-id="proposal-${PROPOSAL_FIXTURE_ID}"]`)).toHaveCount(0);
  });

  test('blocked approval exposes Retry Check and reuses approval execution path', async ({ page }) => {
    inboxState = {
      proposals: [],
      approvals: [
        {
          id: BLOCKED_APPROVAL_FIXTURE_ID,
          action_type: 'add-rss',
          status: 'needs-fix',
          payload: {
            url: 'https://example.test/weak-feed.xml',
            label: 'Blocked retry fixture',
            nextAction: 'reject',
            qualityScore: 0.2,
            recentItemCount: 1,
          },
          reasoning: 'Blocked retry fixture',
          created_at: new Date().toISOString(),
        },
      ],
    };

    await setupRoutes(page);
    await loadInboxSurface(page);
    await page.locator('[data-status-filter="needs-fix"]').click();

    const itemId = `approval-${BLOCKED_APPROVAL_FIXTURE_ID}`;
    await expect(page.locator(`.inbox-item[data-id="${itemId}"]`)).toBeVisible();
    await page.locator(`.inbox-item[data-id="${itemId}"]`).click();

    const retryButton = page.locator(`#inbox-preview-content [data-inbox-action="retry"][data-inbox-item-id="${itemId}"]`);
    await expect(retryButton).toBeVisible();
    await expect(page.locator(`#inbox-preview-content [data-inbox-action="accept"][data-inbox-item-id="${itemId}"]`)).toHaveCount(0);

    const reviewRequest = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes(`/api/approval-queue/${BLOCKED_APPROVAL_FIXTURE_ID}/review`),
    );
    await retryButton.click();
    const request = await reviewRequest;
    expect(readJsonFromPostData(request.postData())).toMatchObject({
      decision: 'accept',
      reviewer: 'theme-dashboard',
    });
  });
});
