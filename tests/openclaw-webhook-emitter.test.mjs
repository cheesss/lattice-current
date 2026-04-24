import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';

import {
  createOpenClawEvent,
  emitOpenClawEvent,
  formatOpenClawAgentDispatchRequest,
  buildOpenClawDeepLink,
  formatOpenClawRunTaskRequest,
  formatOpenClawWebhookRequest,
  loadOpenClawWebhookConfig,
} from '../scripts/_shared/openclaw-webhook-emitter.mjs';

describe('openclaw-webhook-emitter', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env = { ...envBackup };
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('returns disabled when no webhook url is configured and still logs the event', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'openclaw-webhook-'));
    const logPath = path.join(dir, 'events.jsonl');
    const configPath = path.join(dir, 'missing-config.json');
    delete process.env.OPENCLAW_WEBHOOK_URL;
    delete process.env.OPENCLAW_WEBHOOK_URLS;

    const result = await emitOpenClawEvent({
      eventType: 'source-probe-failed',
      summary: 'Probe failed',
      entityType: 'source',
      entityId: 'https://example.com',
    }, { logPath, configPath });

    assert.equal(result.delivered, false);
    assert.equal(result.reason, 'webhook disabled or not configured');
    const logged = await readFile(logPath, 'utf8');
    assert.match(logged, /source-probe-failed/);
  });

  it('posts the raw event payload in raw mode', async () => {
    const requests = [];
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      requests.push({
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/lattice`;

    try {
      const result = await emitOpenClawEvent({
        eventType: 'source-registered',
        summary: 'Source registered',
        entityType: 'source',
        entityId: 'https://example.com/feed.xml',
        payload: { articleCount: 4 },
      }, { url, mode: 'raw', configPath: path.join(os.tmpdir(), 'missing-openclaw-webhook-config.json') });
      assert.equal(result.delivered, true);
      assert.equal(requests.length, 1);
      const parsed = JSON.parse(requests[0].body);
      assert.equal(parsed.eventType, 'source-registered');
      assert.equal(parsed.payload.articleCount, 4);
    } finally {
      server.close();
    }
  });

  it('formats taskflow mode into a create_flow request', () => {
    const event = createOpenClawEvent({
      eventType: 'scheduler-cycle-failed',
      severity: 'critical',
      summary: 'Cycle failed',
      entityType: 'scheduler-cycle',
      entityId: 'cycle:1',
      payload: { lastError: 'boom' },
    });

    const body = formatOpenClawWebhookRequest(event, { mode: 'taskflow', notifyPolicy: 'done_only' });
    assert.equal(body.action, 'create_flow');
    assert.equal(body.status, 'queued');
    assert.equal(body.notifyPolicy, 'done_only');
    assert.match(body.goal, /scheduler-cycle-failed/);
    assert.match(body.goal, /Cycle failed/);
    assert.match(body.goal, /페이로드:/);
  });

  it('uses the current event dashboard dev port for default deep links', () => {
    delete process.env.LATTICE_UI_BASE_URL;
    assert.equal(
      buildOpenClawDeepLink('ops'),
      'http://localhost:3000/event-dashboard.html#ops',
    );
    const event = createOpenClawEvent({
      eventType: 'brief-ready',
      summary: 'Brief ready',
      entityType: 'brief',
      entityId: 'daily',
    });
    assert.equal(event.deepLink, 'http://localhost:3000/event-dashboard.html#ops');
  });

  it('dedupes webhook urls from options, env, and file config', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'openclaw-webhook-'));
    const configPath = path.join(dir, 'openclaw-webhook.json');
    const url = 'http://127.0.0.1:9999/lattice';
    await writeFile(configPath, JSON.stringify({
      enabled: true,
      url,
      urls: [url.toUpperCase(), 'http://127.0.0.1:9998/lattice'],
    }));
    process.env.OPENCLAW_WEBHOOK_URL = url;
    process.env.OPENCLAW_WEBHOOK_URLS = `${url},http://127.0.0.1:9998/lattice`;

    const config = await loadOpenClawWebhookConfig({
      configPath,
      url,
      urls: [url],
    });

    assert.deepEqual(config.urls, [
      url,
      'http://127.0.0.1:9998/lattice',
    ]);
  });

  it('formats taskflow child execution into a run_task request', () => {
    const event = createOpenClawEvent({
      eventType: 'brief-ready',
      severity: 'info',
      summary: 'Daily brief is ready',
      entityType: 'brief',
      entityId: 'daily-2026-04-16',
      deepLink: 'http://127.0.0.1:4173/event-dashboard.html#home',
    });

    const body = formatOpenClawRunTaskRequest(event, {
      taskRuntime: 'acp',
      childSessionKey: 'agent:main:main',
      notifyPolicy: 'done_only',
    }, 'flow-123');

    assert.equal(body.action, 'run_task');
    assert.equal(body.flowId, 'flow-123');
    assert.equal(body.runtime, 'acp');
    assert.equal(body.childSessionKey, 'agent:main:main');
    assert.match(body.task, /brief-ready/);
    assert.match(body.task, /운영 브리프/);
    assert.match(body.task, /한국어로만 답/);
  });

  it('formats a detached agent dispatch envelope', () => {
    const event = createOpenClawEvent({
      eventType: 'source-probe-failed',
      summary: 'Probe failed',
      entityType: 'source',
      entityId: 'https://example.com',
      deepLink: 'http://127.0.0.1:4173/event-dashboard.html#ops',
    });

    const envelope = formatOpenClawAgentDispatchRequest(event, {
      dispatchAgentId: 'main',
      dispatchTimeoutSeconds: 120,
      dispatchNodePath: 'C:\\Program Files\\nodejs\\node.exe',
      dispatchCliEntry: 'C:\\Users\\chohj\\AppData\\Roaming\\npm\\node_modules\\openclaw\\dist\\index.js',
      dispatchArtifactDir: 'data/openclaw-agent-runs',
    });

    assert.equal(envelope.agentId, 'main');
    assert.equal(envelope.timeoutSeconds, 120);
    assert.match(envelope.instruction, /실패한 소스 후보/);
    assert.match(envelope.artifactDir, /openclaw-agent-runs/i);
  });

  it('skips detached agent dispatch for non-allowlisted event types', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'openclaw-webhook-'));
    const result = await emitOpenClawEvent({
      eventType: 'brief-ready',
      summary: 'Brief ready',
      entityType: 'brief',
      entityId: 'daily',
    }, {
      configPath: path.join(dir, 'missing-config.json'),
      logPath: path.join(dir, 'events.jsonl'),
      dispatchAgent: true,
      dispatchEventTypes: ['source-repaired'],
      dispatchNodePath: process.execPath,
      dispatchCliEntry: 'not-used-for-skipped-dispatch',
    });

    assert.equal(result.dispatch.enabled, true);
    assert.equal(result.dispatch.queued, false);
    assert.match(result.dispatch.reason, /not allowlisted/);
  });

  it('posts create_flow then run_task when taskflow mode is enabled', async () => {
    const requests = [];
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push(parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (parsed.action === 'create_flow') {
        res.end(JSON.stringify({ ok: true, flow: { flowId: 'flow-abc' } }));
        return;
      }
      res.end(JSON.stringify({ ok: true, task: { id: 'task-1' } }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/lattice`;

    try {
      const result = await emitOpenClawEvent({
        eventType: 'scheduler-cycle-failed',
        summary: 'Cycle failed',
        entityType: 'scheduler-cycle',
        entityId: 'cycle:1',
        payload: { lastError: 'boom' },
      }, {
        configPath: path.join(os.tmpdir(), 'missing-openclaw-taskflow-config.json'),
        logPath: path.join(os.tmpdir(), `openclaw-taskflow-${Date.now()}.jsonl`),
        url,
        mode: 'taskflow',
        runTask: true,
        taskRuntime: 'acp',
        dispatchAgent: false,
      });
      assert.equal(result.delivered, true);
      assert.equal(requests.length, 2);
      assert.equal(requests[0].action, 'create_flow');
      assert.equal(requests[1].action, 'run_task');
      assert.equal(requests[1].flowId, 'flow-abc');
      assert.equal(requests[1].runtime, 'acp');
    } finally {
      server.close();
    }
  });
});
