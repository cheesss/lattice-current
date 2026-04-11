import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import {
  buildCompactGeoPressureSnapshot,
  buildCompactInvestmentSnapshot,
  buildCompactMacroSnapshot,
  buildCompactRiskSnapshot,
  buildCompactSourceOpsSnapshot,
  buildCompactTransmissionSnapshot,
  buildCompactValidationSnapshot,
  buildThemeShellSnapshotPayloads,
} from '../scripts/_shared/theme-shell-snapshot-builders.mjs';

const tempRoots = [];

async function makeDataRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'theme-shell-snapshots-'));
  tempRoots.push(root);
  await mkdir(path.join(root, 'event-dashboard-cache'), { recursive: true });
  await mkdir(path.join(root, 'persistent-cache'), { recursive: true });
  await mkdir(path.join(root, 'historical'), { recursive: true });
  return root;
}

after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2));
}

function persistentPath(root, cacheKey) {
  return path.join(root, 'persistent-cache', `${encodeURIComponent(cacheKey)}.json`);
}

describe('theme shell snapshot builders', () => {
  let root;

  beforeEach(async () => {
    root = await makeDataRoot();
  });

  it('builds compact snapshots from existing cache files and persistent envelopes', async () => {
    await writeJson(path.join(root, 'event-dashboard-cache', 'live-status.json'), {
      temperatures: [
        { theme: 'ai-ml', temperature: 'HOT', intensity: 0.82 },
        { theme: 'conflict', temperature: 'WARM', intensity: 0.51 },
      ],
      signals: [
        { channel: 'vix', label: 'VIX', value: 29.2, updatedAt: '2026-04-09T00:00:00.000Z' },
        { channel: 'marketStress', label: 'Market Stress', value: 0.75, updatedAt: '2026-04-09T00:00:00.000Z' },
        { channel: 'hy_credit_spread', label: 'HY Credit', value: 4.8, updatedAt: '2026-04-09T00:00:00.000Z' },
        { channel: 'transmissionStrength', label: 'Transmission', value: 0.18, updatedAt: '2026-04-09T00:00:00.000Z' },
      ],
      pending: 3,
      todayArticles: 28,
      meta: {
        updatedAt: '2026-04-09T00:05:00.000Z',
        stale: false,
      },
    });

    await writeJson(path.join(root, 'event-dashboard-cache', 'whatif.json'), {
      strategies: [
        { name: 'ai-ml / NVDA', theme: 'ai-ml', sharpe: 2.4, expectedReturn: 11.1, maxDrawdown: 4.3 },
        { name: 'conflict / XLE', theme: 'conflict', sharpe: 1.7, expectedReturn: 7.5, maxDrawdown: 5.1 },
      ],
      meta: {
        updatedAt: '2026-04-09T00:10:00.000Z',
        stale: false,
      },
    });

    await writeJson(path.join(root, 'event-dashboard-cache', 'heatmap.json'), {
      themes: ['ai-ml', 'conflict'],
      symbols: ['NVDA', 'XLE'],
      cells: [
        { theme: 'ai-ml', symbol: 'NVDA', hitRate: 0.72, avgReturn: 4.1 },
        { theme: 'conflict', symbol: 'XLE', hitRate: 0.64, avgReturn: 3.3 },
      ],
      meta: {
        updatedAt: '2026-04-09T00:10:00.000Z',
        stale: false,
      },
    });

    await writeJson(persistentPath(root, 'replay-adaptation:v1'), {
      key: 'replay-adaptation:v1',
      data: {
        snapshot: {
          updatedAt: '2026-04-09T00:20:00.000Z',
          workflow: {
            runCount: 4,
            costAdjustedHitRate: 0.61,
            costAdjustedAvgReturnPct: 2.9,
            coverageScore: 88,
            qualityScore: 74,
            executionScore: 79,
          },
          coverageLedger: {
            globalCoverageDensity: 92,
            globalCompletenessScore: 90,
          },
          recentRuns: [
            {
              id: 'replay:1',
              label: 'AI replay',
              mode: 'replay',
              completedAt: '2026-04-09T00:19:00.000Z',
              uniqueThemeCount: 2,
              uniqueSymbolCount: 3,
              frameCount: 140,
              costAdjustedHitRate: 0.58,
              costAdjustedAvgReturnPct: 2.1,
              portfolio: { navChangePct: 3.8 },
            },
          ],
        },
      },
      updatedAt: Date.parse('2026-04-09T00:20:00.000Z'),
      ttlMs: 3600000,
      expiresAt: Date.now() + 3600000,
    });

    await writeJson(persistentPath(root, 'investment-intelligence:v1'), {
      key: 'investment-intelligence:v1',
      data: {
        snapshot: {
          generatedAt: '2026-04-09T00:16:00.000Z',
          integration: {
            signalRuntime: {
              source: 'derived-market-transmission',
              coverage: 4,
              signalCapturedAt: '2026-04-09T00:15:00.000Z',
              transmissionGeneratedAt: '2026-04-09T00:14:00.000Z',
              transmissionFreshnessHours: 2.4,
              transmissionFresh: true,
            },
          },
        },
      },
    });

    await writeJson(persistentPath(root, 'investment-intelligence-tracked-ideas:v1'), {
      key: 'investment-intelligence-tracked-ideas:v1',
      data: {
        ideas: [
          {
            id: 'idea-1',
            theme: 'ai-ml',
            symbol: 'NVDA',
            title: 'Inference capacity bottleneck',
            status: 'active',
            conviction: 0.84,
            updatedAt: '2026-04-09T00:15:00.000Z',
          },
        ],
      },
    });

    await writeJson(persistentPath(root, 'investment-intelligence-candidate-reviews:v1'), {
      key: 'investment-intelligence-candidate-reviews:v1',
      data: {
        reviews: [
          { id: 'review-1', status: 'accepted' },
          { id: 'review-2', status: 'pending' },
        ],
      },
    });

    await writeJson(persistentPath(root, 'investment-intelligence-conviction-model:v1'), {
      key: 'investment-intelligence-conviction-model:v1',
      data: {
        model: {
          observations: 420,
          learningRate: 0.08,
          updatedAt: '2026-04-09T00:11:00.000Z',
          weights: {
            corroborationQuality: 0.3,
            recentEvidenceScore: 0.2,
          },
        },
      },
    });

    await writeJson(persistentPath(root, 'investment-intelligence-experiment-registry:v1'), {
      key: 'investment-intelligence-experiment-registry:v1',
      data: {
        registry: {
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
          activeReason: 'Shadow hit rate softened and the profile shifted defensive.',
          history: [
            {
              id: 'promote:1',
              recordedAt: '2026-04-09T00:09:00.000Z',
              score: 63.4,
              action: 'promote',
              reason: 'Shadow hit rate softened and the profile shifted defensive.',
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
        },
      },
    });

    await writeJson(persistentPath(root, 'event-market-transmission:v1'), {
      key: 'event-market-transmission:v1',
      data: {
        snapshot: {
          generatedAt: '2026-04-09T00:30:00.000Z',
          regime: {
            id: 'inflation-shock',
            label: 'Inflation Shock',
            confidence: 78,
          },
          notes: [
            'Country-specific geopolitical escalation likely transmits into exposed sectors.',
          ],
        },
        edges: [
          {
            id: 'edge-1',
            eventTitle: 'Russia sanctions squeeze energy routes',
            eventSource: 'Reuters',
            marketSymbol: 'XLE',
            relationType: 'country',
            strength: 88,
            rawStrength: 80,
            flowDirection: 'neutral',
            flowLagHours: 0,
            reason: 'Russia disruption is repricing energy and shipping exposure.',
            keywords: ['russia', 'oil'],
          },
          {
            id: 'edge-2',
            eventTitle: 'Iran shipping risk reprices crude',
            eventSource: 'Lloyds List',
            marketSymbol: 'CL=F',
            relationType: 'country',
            strength: 81,
            rawStrength: 74,
            flowDirection: 'neutral',
            flowLagHours: 0,
            reason: 'Iran corridor risk is repricing crude and insurer exposure.',
            keywords: ['iran', 'shipping'],
          },
          {
            id: 'edge-3',
            eventTitle: 'Commodity shock widens energy risk premium',
            eventSource: 'Bloomberg',
            marketSymbol: 'USO',
            relationType: 'commodity',
            strength: 76,
            rawStrength: 69,
            flowDirection: 'neutral',
            flowLagHours: 0,
            reason: 'Commodity repricing is amplifying downstream energy beta.',
            keywords: ['oil'],
          },
        ],
      },
      updatedAt: Date.parse('2026-04-09T00:30:00.000Z'),
      ttlMs: 3600000,
      expiresAt: Date.now() + 3600000,
    });

    await writeJson(persistentPath(root, 'source-registry:v1'), {
      key: 'source-registry:v1',
      data: {
        records: [
          { id: 'src-1', category: 'defense', status: 'active' },
        ],
        overrides: [
          { id: 'ovr-1' },
        ],
        discoveredSources: [
          { id: 'disc-1', category: 'technology', status: 'draft' },
          { id: 'disc-2', category: 'defense', status: 'approved' },
        ],
      },
      updatedAt: Date.parse('2026-04-09T00:35:00.000Z'),
      ttlMs: 3600000,
      expiresAt: Date.now() + 3600000,
    });

    await writeJson(persistentPath(root, 'source-ops-log:v1'), {
      key: 'source-ops-log:v1',
      data: {
        events: [
          {
            id: 'evt-1',
            title: 'Reuters feed promoted',
            action: 'status-change',
            actor: 'system',
            status: 'active',
            category: 'defense',
            detail: 'Auto-approved after quality screen 0.98',
            createdAt: Date.parse('2026-04-09T00:36:00.000Z'),
          },
        ],
      },
      updatedAt: Date.parse('2026-04-09T00:36:00.000Z'),
      ttlMs: 3600000,
      expiresAt: Date.now() + 3600000,
    });

    await writeJson(persistentPath(root, 'source-credibility:v1'), {
      key: 'source-credibility:v1',
      data: {
        profiles: [
          { id: 'cred-1', domain: 'reuters.com' },
          { id: 'cred-2', domain: 'lloydslist.com' },
        ],
      },
      updatedAt: Date.parse('2026-04-09T00:37:00.000Z'),
      ttlMs: 3600000,
      expiresAt: Date.now() + 3600000,
    });

    const payload = await buildThemeShellSnapshotPayloads({
      dataRoot: root,
      buildStructuralAlerts: async () => ({
        items: [
          {
            id: 'alert-1',
            theme: 'conflict',
            severity: 'high',
            headline: 'Shipping corridor risk is rising',
            alertScore: 68,
          },
        ],
      }),
    });

    assert.equal(payload.risk.level, 'high');
    assert.equal(payload.risk.summary.alertCount, 1);
    assert.equal(payload.risk.hottestThemes[0].theme, 'ai-ml');
    assert.equal(payload.macro.verdict, 'defensive');
    assert.equal(payload.macro.strategyCount, 2);
    assert.equal(payload.investment.trackedIdeaCount, 1);
    assert.equal(payload.investment.bestStrategies[0].symbol, 'NVDA');
    assert.equal(payload.investment.experimentRegistry.lastAction, 'promote');
    assert.equal(payload.investment.experimentRegistry.rollbackArmed, true);
    assert.equal(payload.investment.experimentRegistry.profile.aggression, 0.94);
    assert.equal(payload.investment.signalRuntime.source, 'derived-market-transmission');
    assert.equal(payload.investment.signalRuntime.coverage, 4);
    assert.equal(payload.validation.runCount, 4);
    assert.equal(payload.validation.recentRuns[0].label, 'AI replay');
    assert.equal(payload.geoPressure.topCountries[0].code, 'RU');
    assert.equal(payload.transmission.regimeLabel, 'Inflation Shock');
    assert.equal(payload.transmission.topRelations[0].relationType, 'country');
    assert.equal(payload.sourceOps.approvedCount, 2);
    assert.equal(payload.sourceOps.profileCount, 2);
  });

  it('falls back to safeQuery when cache files are missing', async () => {
    const safeQuery = async (sql) => {
      const query = String(sql);
      if (query.includes('FROM signal_history')) {
        return {
          rows: [
            { signal_name: 'vix', ts: '2026-04-09T01:00:00.000Z', value: 17.4 },
            { signal_name: 'marketStress', ts: '2026-04-09T01:00:00.000Z', value: 0.31 },
            { signal_name: 'hy_credit_spread', ts: '2026-04-09T01:00:00.000Z', value: 3.1 },
            { signal_name: 'transmissionStrength', ts: '2026-04-09T01:00:00.000Z', value: 0.28 },
          ],
        };
      }
      if (query.includes('FROM event_hawkes_intensity')) {
        return {
          rows: [
            { theme: 'semiconductor', normalized_temperature: 0.73 },
          ],
        };
      }
      if (query.includes('FROM pending_outcomes')) {
        return { rows: [{ count: 2 }] };
      }
      if (query.includes("FROM articles")) {
        return { rows: [{ count: 12 }] };
      }
      if (query.includes('FROM auto_article_themes')) {
        return {
          rows: [
            { theme: 'semiconductor', count: 6 },
          ],
        };
      }
      if (query.includes('FROM whatif_simulations')) {
        return {
          rows: [
            {
              name: 'semiconductor / SMH',
              theme: 'semiconductor',
              symbol: 'SMH',
              sharpe_ratio: 1.8,
              expected_return: 6.4,
              max_drawdown: 3.2,
            },
          ],
        };
      }
      if (query.includes('FROM stock_sensitivity_matrix')) {
        return {
          rows: [
            {
              theme: 'semiconductor',
              symbol: 'SMH',
              hit_rate: 0.69,
              avg_return: 2.7,
            },
          ],
        };
      }
      if (query.includes('FROM labeled_outcomes')) {
        return { rows: [] };
      }
      return { rows: [] };
    };

    const risk = await buildCompactRiskSnapshot({
      dataRoot: root,
      safeQuery,
      buildStructuralAlerts: async () => ({
        items: [
          {
            id: 'alert-2',
            theme: 'semiconductor',
            severity: 'medium',
            headline: 'Packaging lead times are stretching',
            alertScore: 42,
          },
        ],
      }),
    });
    const macro = await buildCompactMacroSnapshot({ dataRoot: root, safeQuery });
    const investment = await buildCompactInvestmentSnapshot({ dataRoot: root, safeQuery });

    assert.equal(risk.meta.available, true);
    assert.equal(risk.hottestThemes[0].theme, 'semiconductor');
    assert.equal(macro.verdict, 'constructive');
    assert.equal(macro.strategyCount, 1);
    assert.equal(investment.bestStrategies[0].symbol, 'SMH');
    assert.equal(investment.strongestPairs[0].theme, 'semiconductor');
    assert.equal(investment.experimentRegistry, null);
    assert.equal(investment.signalRuntime, null);
  });

  it('falls back to json validation artifacts when replay cache is missing', async () => {
    await writeJson(path.join(root, 'alpha-validation-result.json'), {
      verdict: 'pass',
      tests: {
        featureAUC: { pass: true },
        temporalStability: { pass: false },
        decileSeparation: { pass: true },
      },
    });
    await writeJson(path.join(root, 'historical', '1yr-backtest-result.json'), {
      ok: true,
      run: {
        id: 'replay:historical-1',
        label: 'Historical replay',
        mode: 'replay',
        completedAt: '2026-04-08T18:00:00.000Z',
        frameCount: 1200,
        uniqueThemeCount: 4,
        uniqueSymbolCount: 9,
        portfolio: {
          navChangePct: 6.3,
        },
      },
    });

    const validation = await buildCompactValidationSnapshot({ dataRoot: root });

    assert.equal(validation.meta.available, true);
    assert.equal(validation.runCount, 1);
    assert.equal(validation.recentRuns[0].label, 'Historical replay');
    assert.equal(validation.qualityScore, 100);
  });

  it('does not let a large pending backlog alone peg risk at 100', async () => {
    const safeQuery = async (sql) => {
      const query = String(sql);
      if (query.includes('FROM signal_history')) {
        return {
          rows: [
            { signal_name: 'vix', ts: '2026-04-09T01:00:00.000Z', value: 18.4 },
          ],
        };
      }
      if (query.includes('FROM event_hawkes_intensity')) {
        return {
          rows: [
            { theme: 'semiconductor', normalized_temperature: 0.18 },
            { theme: 'semiconductor', normalized_temperature: 0.11 },
          ],
        };
      }
      if (query.includes('FROM pending_outcomes')) {
        return { rows: [{ count: 3272 }] };
      }
      if (query.includes('FROM articles')) {
        return { rows: [{ count: 54 }] };
      }
      if (query.includes('FROM auto_article_themes')) {
        return { rows: [] };
      }
      return { rows: [] };
    };

    const risk = await buildCompactRiskSnapshot({
      dataRoot: root,
      safeQuery,
      buildStructuralAlerts: async () => ({
        items: [
          { id: 'alert-1', theme: 'semiconductor', severity: 'high', headline: 'Constraint detected', alertScore: 63 },
          { id: 'alert-2', theme: 'macroeconomics', severity: 'medium', headline: 'Policy drift detected', alertScore: 44 },
        ],
      }),
    });

    assert.equal(risk.summary.pendingValidation, 3272);
    assert.equal(risk.hottestThemes.length, 1);
    assert.ok(risk.score < 100);
    assert.ok(risk.score >= 20);
  });

  it('returns stable empty payloads when neither DB nor cache data is present', async () => {
    const [risk, macro, investment, validation, geoPressure, transmission, sourceOps] = await Promise.all([
      buildCompactRiskSnapshot({ dataRoot: root }),
      buildCompactMacroSnapshot({ dataRoot: root }),
      buildCompactInvestmentSnapshot({ dataRoot: root }),
      buildCompactValidationSnapshot({ dataRoot: root }),
      buildCompactGeoPressureSnapshot({ dataRoot: root }),
      buildCompactTransmissionSnapshot({ dataRoot: root }),
      buildCompactSourceOpsSnapshot({ dataRoot: root }),
    ]);

    assert.equal(risk.meta.available, false);
    assert.equal(macro.meta.available, false);
    assert.equal(investment.meta.available, false);
    assert.equal(validation.meta.available, false);
    assert.equal(geoPressure.meta.available, false);
    assert.equal(transmission.meta.available, false);
    assert.equal(sourceOps.meta.available, false);
    assert.deepEqual(risk.hottestThemes, []);
    assert.deepEqual(macro.signals, []);
    assert.deepEqual(investment.bestStrategies, []);
    assert.deepEqual(validation.recentRuns, []);
    assert.deepEqual(geoPressure.topCountries, []);
    assert.deepEqual(transmission.strongestEdges, []);
    assert.deepEqual(sourceOps.recentEvents, []);
  });
});
