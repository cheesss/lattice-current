import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

const ORIGINAL_CACHE_DIR = process.env.WORLDMONITOR_PERSISTENT_CACHE_DIR;
const EXPERIMENT_REGISTRY_KEY = 'investment-intelligence-experiment-registry:v1';

describe('investment experiment registry bridge', () => {
  let cacheDir = '';

  beforeEach(async () => {
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'investment-registry-bridge-'));
    process.env.WORLDMONITOR_PERSISTENT_CACHE_DIR = cacheDir;
  });

  afterEach(async () => {
    if (ORIGINAL_CACHE_DIR) {
      process.env.WORLDMONITOR_PERSISTENT_CACHE_DIR = ORIGINAL_CACHE_DIR;
    } else {
      delete process.env.WORLDMONITOR_PERSISTENT_CACHE_DIR;
    }
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('persists tuned registry state and hydrates it back into the active weight profile', async () => {
    const investment = await import('../src/services/investment-intelligence');
    const experimentRegistry = await import('../src/services/experiment-registry');

    await investment.resetInvestmentLearningState();

    const tunedRegistry = {
      activeProfile: {
        corroborationWeightMultiplier: 1.05,
        contradictionPenaltyMultiplier: 1.08,
        recencyPenaltyMultiplier: 1.04,
        realityPenaltyMultiplier: 1.12,
        graphPropagationWeightMultiplier: 1,
        riskOffExposureMultiplier: 1.06,
        riskOnAggressionMultiplier: 0.94,
        regimeRiskOffMultiplier: 1.03,
        regimeInflationMultiplier: 1,
      },
      lastScore: 63.4,
      rollbackArmed: true,
      activeReason: 'Shadow underperformance pushed the profile more defensive.',
      history: [
        {
          id: 'promote:1',
          recordedAt: '2026-04-09T00:09:00.000Z',
          score: 63.4,
          action: 'promote' as const,
          reason: 'Shadow underperformance pushed the profile more defensive.',
          profile: {
            corroborationWeightMultiplier: 1.05,
            contradictionPenaltyMultiplier: 1.08,
            recencyPenaltyMultiplier: 1.04,
            realityPenaltyMultiplier: 1.12,
            graphPropagationWeightMultiplier: 1,
            riskOffExposureMultiplier: 1.06,
            riskOnAggressionMultiplier: 0.94,
            regimeRiskOffMultiplier: 1.03,
            regimeInflationMultiplier: 1,
          },
          performance: {
            generatedAt: '2026-04-09T00:09:00.000Z',
            rawHitRate24h: 56,
            costAdjustedHitRate24h: 49,
            rawAvgReturn24h: 1.8,
            costAdjustedAvgReturn24h: 1.2,
            portfolioWeightedReturnPct: 0.8,
            portfolioCagrPct: 3.2,
            portfolioMaxDrawdownPct: 4.1,
            portfolioSharpe: 0.8,
            avgExecutionPenaltyPct: 1.3,
            recentShadowHitRate: 44,
            recentShadowAvgReturnPct: -0.4,
            recentDrawdownPct: 3.2,
            abstainRate: 24,
            realityBlockedRate: 18,
            hiddenCandidateCount: 3,
          },
        },
      ],
    };

    await investment.syncExperimentRegistrySnapshot(tunedRegistry);

    const persistedPath = path.join(cacheDir, `${encodeURIComponent(EXPERIMENT_REGISTRY_KEY)}.json`);
    const persisted = JSON.parse(await readFile(persistedPath, 'utf8'));
    assert.equal(persisted.data.registry.activeProfile.riskOnAggressionMultiplier, 0.94);
    assert.equal(persisted.data.registry.rollbackArmed, true);

    experimentRegistry.hydrateExperimentRegistry(null);
    assert.equal(experimentRegistry.getActiveWeightProfileSync().riskOnAggressionMultiplier, 1);

    const hydrated = await investment.hydratePersistedExperimentRegistry();
    assert.equal(hydrated.lastScore, 63.4);
    assert.equal(hydrated.rollbackArmed, true);
    assert.equal(experimentRegistry.getActiveWeightProfileSync().riskOnAggressionMultiplier, 0.94);
  });
});
