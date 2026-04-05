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
});
