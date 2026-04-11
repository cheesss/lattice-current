import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildIdeaGenerationRuntimeContext,
  deriveSignalContextFallback,
} from '../src/services/investment/idea-generation/runtime-context';

describe('investment runtime context fallback', () => {
  it('derives a usable signal snapshot from macro indicators and transmission when live signal history is absent', () => {
    const fallback = deriveSignalContextFallback({
      macroIndicators: {
        vix: 23.4,
        yieldSpread: -0.42,
        dollarIndex: 108.3,
        oilPrice: 91.6,
      },
      transmissionProxy: {
        marketStress: 0.64,
        transmissionStrength: 0.58,
        reactionSignificance: 0.51,
      },
      transmission: {
        generatedAt: '2026-04-10T00:00:00.000Z',
      } as any,
    });

    assert.equal(fallback?.vix, 23.4);
    assert.equal(fallback?.yieldSpread, -0.42);
    assert.equal(fallback?.gdeltStress, 0.64);
    assert.equal(fallback?.transmissionStrength, 0.58);
    assert.equal(fallback?.capturedAt, '2026-04-10T00:00:00.000Z');
  });

  it('uses derived signal context inside the runtime when direct signal history is missing', () => {
    const runtime = buildIdeaGenerationRuntimeContext({
      markets: [
        { symbol: '^VIX', price: 19.8 } as any,
        { symbol: 'T10Y2Y', price: -0.31 } as any,
        { symbol: 'DCOILWTICO', price: 88.2 } as any,
      ],
      transmission: {
        generatedAt: '2026-04-10T01:20:00.000Z',
        regime: { label: 'risk-off', confidence: 77 },
        edges: [
          { strength: 82, informationFlowScore: 0.6, leadLagScore: 0.4 },
        ],
      } as any,
      signalContext: null,
    });

    assert.equal(runtime.signal.signalSnapshot?.vix, 19.8);
    assert.equal(runtime.signal.signalSnapshot?.yieldSpread, -0.31);
    assert.equal(runtime.signal.signalSnapshot?.gdeltStress, runtime.signal.transmissionProxy?.marketStress ?? null);
    assert.equal(runtime.signal.signalSnapshot?.capturedAt, '2026-04-10T01:20:00.000Z');
  });
});
