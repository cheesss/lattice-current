import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  __openClawLatticeTestUtils,
  normalizeSourceRepairAuditForTest,
} from '../plugins/openclaw-lattice-control-plane/index.ts';

const pluginSource = readFileSync(new URL('../plugins/openclaw-lattice-control-plane/index.ts', import.meta.url), 'utf8');
const pluginManifest = JSON.parse(readFileSync(new URL('../plugins/openclaw-lattice-control-plane/openclaw.plugin.json', import.meta.url), 'utf8'));
const agentRules = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
const identity = readFileSync(new URL('../IDENTITY.md', import.meta.url), 'utf8');
const userContext = readFileSync(new URL('../USER.md', import.meta.url), 'utf8');
const soul = readFileSync(new URL('../SOUL.md', import.meta.url), 'utf8');
const tools = readFileSync(new URL('../TOOLS.md', import.meta.url), 'utf8');

test('OpenClaw plugin deep links use the dashboard inbox fragment', () => {
  assert.doesNotMatch(pluginSource, /#decision-inbox/);
  assert.match(pluginSource, /#inbox/);
});

test('OpenClaw snapshot route compacts raw payload fields', () => {
  assert.match(pluginSource, /function compactSnapshotData/);
  assert.match(pluginSource, /raw", "stdout", "stderr", "systemPrompt"/);
  assert.match(pluginSource, /recentRuns: compactRecentRuns/);
  assert.match(pluginSource, /recentEvents: compactRecentEvents/);
});

test('OpenClaw plugin exposes context-safe source repair status', () => {
  assert.match(pluginSource, /name: "lattice\.get_source_repair_status"/);
  assert.match(pluginSource, /name: "lattice-source-status"/);
  assert.match(pluginSource, /\/plugins\/lattice\/api\/source-repair-status/);
  assert.match(pluginSource, /summarizeSourceRepairStatus/);
  assert.match(pluginSource, /source-repair-closed-loop-/);
});

test('OpenClaw plugin manifest declares command aliases and tool contracts', () => {
  assert.equal(pluginManifest.id, 'openclaw-lattice-control-plane');
  assert.ok(pluginManifest.commandAliases.some((entry) => entry.name === 'lattice-source-status'));
  assert.ok(pluginManifest.contracts.tools.includes('lattice.get_source_repair_status'));
  assert.ok(pluginManifest.contracts.tools.includes('lattice.get_automation_ops_snapshot'));
});

test('OpenClaw Lattice web surface uses Korean operator labels', () => {
  assert.match(pluginSource, /결정함/);
  assert.match(pluginSource, /발견 검토/);
  assert.match(pluginSource, /소스 등록/);
  assert.match(pluginSource, /translateDbStatus/);
  assert.match(pluginSource, /translateEventType/);
  assert.match(pluginSource, /연결됨/);
  assert.doesNotMatch(pluginSource, />Decision Inbox</);
  assert.doesNotMatch(pluginSource, /Discovery Triage/);
  assert.doesNotMatch(pluginSource, /DB connected/);
});

test('OpenClaw sidecar auth mode is explicit', () => {
  assert.match(pluginSource, /sidecarAuthMode/);
  assert.match(pluginSource, /sidecarToken required when sidecarAuthMode=bearer/);
  assert.match(pluginSource, /buildSidecarHeaders/);
});

test('OpenClaw sidecar defaults to the local sidecar and current dashboard UI', () => {
  const config = __openClawLatticeTestUtils.readConfig({});
  assert.equal(config.sidecarBaseUrl, 'http://127.0.0.1:46123');
  assert.equal(config.latticeUiBaseUrl, 'http://localhost:3000');
  assert.doesNotMatch(pluginSource, /sidecarBaseUrl: raw\.sidecarBaseUrl \|\| ""/);
});

test('OpenClaw sidecar summaries report configured runtime data', () => {
  const runtimeSummary = __openClawLatticeTestUtils.summarizeRuntimeObservabilitySidecar({
    runtime: { mode: 'standalone-dev', port: 46123 },
    serviceStatus: { summary: { operational: 3, degraded: 1, outage: 0 } },
    health: { status: 'idle', activeCycleStatus: 'idle', stalled: false, blockerCount: 0, reasons: [] },
    codex: { available: true },
    routeCoverage: { missingRouteCount: 0 },
    credentials: { missingRequiredKeys: [] },
  });
  const opsSummary = __openClawLatticeTestUtils.summarizeAutomationOpsSidecar({
    runtime: { mode: 'standalone-dev', port: 46123 },
    serviceStatus: { summary: { operational: 3, degraded: 0, outage: 0 } },
    health: {
      status: 'healthy',
      enabledDatasetCount: 4,
      datasetErrorCount: 0,
      consecutiveFailures: 0,
    },
    automation: {
      lastCycle: { kind: 'source-repair', status: 'ok', detail: 'counted=61' },
      state: {
        activeCycle: { status: 'idle', stage: 'completed', progressPct: 100 },
        queue: { themeQueueDepth: 0, datasetProposalDepth: 0, runDepth: 10 },
      },
    },
    daemon: { status: 'ready', summary: { staleTaskCount: 0, failingTaskCount: 0 } },
    blockerReasons: [],
  });

  assert.match(runtimeSummary, /sidecar 연결됨/);
  assert.match(runtimeSummary, /port 46123/);
  assert.match(opsSummary, /port 46123/);
  assert.match(opsSummary, /datasets 4/);
  assert.match(opsSummary, /source-repair ok/);
  assert.doesNotMatch(runtimeSummary + opsSummary, /sidecarBaseUrl not configured/);
});

test('OpenClaw summaries prefer current scheduler health over legacy daemon state', () => {
  const runtimeSummary = __openClawLatticeTestUtils.summarizeRuntimeObservabilitySidecar({
    runtime: { mode: 'standalone-dev', port: 46123 },
    summary: { status: 'watch', staleTaskCount: 0, failingTaskCount: 1, blockerCount: 2 },
    serviceStatus: { summary: { operational: 3, degraded: 0, outage: 0 } },
    automationHealth: {
      status: 'degraded',
      activeCycleStatus: 'running',
      stalled: false,
      datasetErrorCount: 1,
      consecutiveFailures: 10,
      blockerCount: 2,
      reasons: ['1 dataset report errors', 'max consecutive dataset failures 10'],
    },
    daemon: { status: 'blocked', summary: { staleTaskCount: 23, failingTaskCount: 3 } },
    codex: { available: true },
    routeCoverage: { missingRouteCount: 0 },
    credentials: { missingRequiredKeys: [] },
  });
  const opsSummary = __openClawLatticeTestUtils.summarizeAutomationOpsSidecar({
    runtime: { mode: 'standalone-dev', port: 46123 },
    serviceStatus: { summary: { operational: 3, degraded: 0, outage: 0 } },
    health: {
      status: 'degraded',
      enabledDatasetCount: 4,
      datasetErrorCount: 1,
      consecutiveFailures: 10,
      reasons: ['1 dataset report errors', 'max consecutive dataset failures 10'],
    },
    automation: {
      lastCycle: { kind: 'source-repair', status: 'ok', detail: 'counted=61' },
      state: {
        activeCycle: { status: 'running', stage: 'dataset:done', progressPct: 75 },
        queue: { themeQueueDepth: 16, datasetProposalDepth: 0, runDepth: 360 },
      },
    },
    daemon: { status: 'blocked', summary: { staleTaskCount: 23, failingTaskCount: 3 } },
    blockerReasons: [],
  });

  assert.match(runtimeSummary + opsSummary, /scheduler health/);
  assert.match(runtimeSummary + opsSummary, /dataset report errors/);
  assert.match(runtimeSummary + opsSummary, /legacy daemon ignored for current blockers/);
  assert.doesNotMatch(runtimeSummary + opsSummary, /daemon: blocked|daemon blocked/i);
});

test('agent rules and injected context are readable UTF-8 and block mixed-language replies', () => {
  assert.match(agentRules, /If the user prompt is Korean, answer in Korean only/);
  assert.match(agentRules, /Do not mix Hindi, Hinglish/);
  for (const content of [agentRules, identity, userContext, soul, tools]) {
    assert.doesNotMatch(content, /\?\?/);
    assert.doesNotMatch(content, /Hinglish mix|Hindi \+ English/i);
  }
});

test('source repair status normalizes current closed-loop audit schema', () => {
  const audit = {
    ok: true,
    finishedAt: '2026-04-22T02:23:53.904Z',
    targetSuccesses: 1,
    successes: [{
      repairedUrl: 'https://venturebeat.com/feed/',
      feedName: 'VentureBeat',
      theme: 'ai-ml',
      qualityScore: 0.712,
      recentItemCount: 7,
      connectorKind: 'rss',
      registration: {
        registered: true,
        feedUrl: 'https://venturebeat.com/feed/',
        quality: { score: 0.712, recentItemCount: 7, connectorKind: 'rss' },
        record: { feedName: 'VentureBeat', category: 'ai-ml', confidence: 71 },
      },
      backfill: { fetched: 7, inserted: 7, themed: 7 },
    }],
    skipped: [],
    failures: [],
  };

  const summary = normalizeSourceRepairAuditForTest(audit);
  assert.equal(summary.schema, 'source-repair-closed-loop');
  assert.equal(summary.ok, true);
  assert.equal(summary.caseCount, 1);
  assert.equal(summary.passedCaseCount, 1);
  assert.equal(summary.targetSuccesses, 1);
  assert.equal(summary.totalArticles, 7);
  assert.equal(summary.totalRecent72hArticles, 7);
  assert.equal(summary.totalThemedArticles, 7);
  assert.equal(summary.cases[0].feedName, 'VentureBeat');
  assert.equal(summary.cases[0].passed, true);
});

test('source repair status keeps legacy aggregated evidence schema compatible', () => {
  const summary = normalizeSourceRepairAuditForTest({
    ok: true,
    generatedAt: '2026-04-22T02:35:12.203Z',
    caseCount: 11,
    passedCaseCount: 11,
    totalArticles: 258,
    totalRecent72hArticles: 140,
    totalThemedArticles: 81,
    cases: [{ feedName: 'Army Times', articleCount: 25, passed: true }],
  });

  assert.equal(summary.schema, 'codex-source-code-application-evidence');
  assert.equal(summary.caseCount, 11);
  assert.equal(summary.passedCaseCount, 11);
  assert.equal(summary.totalArticles, 258);
  assert.equal(summary.cases[0].feedName, 'Army Times');
});
