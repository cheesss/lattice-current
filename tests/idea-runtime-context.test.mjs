import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildIdeaGenerationRuntimeContext,
  captureSignalContext,
  deriveSignalContextFromLatestSignals,
} from '../src/services/investment/idea-generation/runtime-context.ts';
import { repoPath } from './_workspace-paths.mjs';

describe('idea generation runtime context', () => {
  it('derives macro indicators and transmission proxy from live inputs', () => {
    const context = buildIdeaGenerationRuntimeContext({
      markets: [
        { symbol: '^VIX', name: 'VIX', display: 'VIX', price: 27.4, change: 1.2 },
        { symbol: 'T10Y2Y', name: '10Y-2Y', display: '10Y-2Y', price: -0.42, change: -0.03 },
        { symbol: 'DTWEXBGS', name: 'Dollar', display: 'Dollar', price: 112.8, change: 0.4 },
        { symbol: 'DCOILWTICO', name: 'WTI', display: 'WTI', price: 81.6, change: 1.1 },
      ],
      transmission: {
        generatedAt: '2026-04-06T03:00:00.000Z',
        regime: { label: 'risk-off', confidence: 82 },
        edges: [
          { strength: 84, informationFlowScore: 0.68, leadLagScore: 0.42 },
          { strength: 72, informationFlowScore: 0.57, leadLagScore: 0.31 },
        ],
        summaryLines: [],
      },
    });

    assert.equal(context.signal.macroIndicators?.vix, 27.4);
    assert.equal(context.signal.macroIndicators?.yieldSpread, -0.42);
    assert.equal(context.signal.macroIndicators?.dollarIndex, 112.8);
    assert.equal(context.signal.macroIndicators?.oilPrice, 81.6);
    assert.ok((context.signal.transmissionProxy?.marketStress ?? 0) > 0.5);
    assert.ok((context.signal.transmissionProxy?.transmissionStrength ?? 0) > 0.5);
    assert.equal(context.signal.signalSnapshot, null);
  });

  it('captures signal context from latest signals and threads it into the runtime contract', async () => {
    const signalContext = await captureSignalContext(async () => ({
      vix: { value: 28.2, ts: '2026-04-06T10:00:00.000Z' },
      yieldSpread: { value: -0.61, ts: '2026-04-06T10:01:00.000Z' },
      hy_credit_spread: { value: 4.8, ts: '2026-04-06T10:02:00.000Z' },
      marketStress: { value: 0.73, ts: '2026-04-06T10:03:00.000Z' },
      transmissionStrength: { value: 0.56, ts: '2026-04-06T10:04:00.000Z' },
    }));
    assert.deepEqual(signalContext, {
      vix: 28.2,
      yieldSpread: -0.61,
      creditSpread: 4.8,
      gdeltStress: 0.73,
      transmissionStrength: 0.56,
      capturedAt: '2026-04-06T10:04:00.000Z',
    });

    const context = buildIdeaGenerationRuntimeContext({ signalContext });
    assert.deepEqual(context.signal.signalSnapshot, signalContext);
  });

  it('derives signal context snapshots from latest-signal rows', () => {
    const signalContext = deriveSignalContextFromLatestSignals({
      vix: { value: 24.5, ts: '2026-04-06T10:00:00.000Z' },
      transmissionStrength: { value: 0.49, ts: '2026-04-06T10:02:00.000Z' },
    });
    assert.deepEqual(signalContext, {
      vix: 24.5,
      yieldSpread: null,
      creditSpread: null,
      gdeltStress: null,
      transmissionStrength: 0.49,
      capturedAt: '2026-04-06T10:02:00.000Z',
    });
  });

  it('forces live and replay call sites through the shared runtime-context builder', () => {
    const orchestratorSource = readFileSync(repoPath('src/services/investment/orchestrator.ts'), 'utf8');
    const replaySource = readFileSync(repoPath('src/services/backtest/replay-workflow.ts'), 'utf8');

    assert.match(orchestratorSource, /const signalContext = await captureSignalContext\(\)/);
    assert.match(orchestratorSource, /const decisionRuntimeContext = buildIdeaGenerationRuntimeContext\(/);
    assert.match(orchestratorSource, /signalContext,/);
    assert.match(orchestratorSource, /buildIdeaCards\(mappings, \[\], macroOverlay, replayAdaptation, decisionRuntimeContext\)/);
    assert.match(orchestratorSource, /buildIdeaCards\(mappings, analogs, macroOverlay, replayAdaptation, decisionRuntimeContext\)/);

    assert.match(replaySource, /const decisionRuntimeContext = buildIdeaGenerationRuntimeContext\(/);
    assert.match(replaySource, /buildIdeaCards\(mappings, \[\], macroOverlay, baseReplayAdaptation, decisionRuntimeContext\)/);
  });
});
