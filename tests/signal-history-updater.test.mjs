import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('signal-history-updater', () => {
  it('exports pushSignalFromMarketData', async () => {
    const mod = await import('../src/services/signal-history-updater.ts');
    assert.equal(typeof mod.pushSignalFromMarketData, 'function');
  });
  it('exports pushGdeltStress', async () => {
    const mod = await import('../src/services/signal-history-updater.ts');
    assert.equal(typeof mod.pushGdeltStress, 'function');
  });
  it('exports pushSignal', async () => {
    const mod = await import('../src/services/signal-history-updater.ts');
    assert.equal(typeof mod.pushSignal, 'function');
  });
  it('exports getLatestSignals', async () => {
    const mod = await import('../src/services/signal-history-updater.ts');
    assert.equal(typeof mod.getLatestSignals, 'function');
  });
  it('ignores unknown market symbols without throwing', async () => {
    const mod = await import('../src/services/signal-history-updater.ts');
    await assert.doesNotReject(() => mod.pushSignalFromMarketData('UNKNOWN', 123, '2026-04-06T00:00:00.000Z'));
  });
  it('ignores invalid GDELT stress inputs without throwing', async () => {
    const mod = await import('../src/services/signal-history-updater.ts');
    await assert.doesNotReject(() => mod.pushGdeltStress(Number.NaN, 0, 1, '2026-04-06T00:00:00.000Z'));
    await assert.doesNotReject(() => mod.pushGdeltStress(0, Number.POSITIVE_INFINITY, 1, '2026-04-06T00:00:00.000Z'));
  });
  it('ignores empty or non-finite generic signals without throwing', async () => {
    const mod = await import('../src/services/signal-history-updater.ts');
    await assert.doesNotReject(() => mod.pushSignal('', 1, '2026-04-06T00:00:00.000Z'));
    await assert.doesNotReject(() => mod.pushSignal('marketStress', Number.NaN, '2026-04-06T00:00:00.000Z'));
  });
});
