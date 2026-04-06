/**
 * Phase 4: Independent Risk Management Layer Tests
 * Validates RiskEngine, risk constraints, and pipeline risk gates.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { repoPath } from './_workspace-paths.mjs';

// ---------------------------------------------------------------------------
// Test 1: Risk Constraints — defaults and resolution
// ---------------------------------------------------------------------------
describe('risk-constraints', () => {
  it('DEFAULT_CONSTRAINTS has sane defaults', async () => {
    const { DEFAULT_CONSTRAINTS } = await import('../src/services/risk/risk-constraints.ts');
    assert.ok(DEFAULT_CONSTRAINTS.maxGrossExposurePct > 0);
    assert.ok(DEFAULT_CONSTRAINTS.maxNetExposurePct > 0);
    assert.ok(DEFAULT_CONSTRAINTS.maxSinglePositionPct > 0);
    assert.ok(DEFAULT_CONSTRAINTS.minLiquidityScore > 0);
    assert.ok(DEFAULT_CONSTRAINTS.regimeOverrides instanceof Map);
  });

  it('resolveConstraints applies regime overrides', async () => {
    const { DEFAULT_CONSTRAINTS, resolveConstraints } = await import('../src/services/risk/risk-constraints.ts');

    const normal = resolveConstraints(DEFAULT_CONSTRAINTS, null);
    assert.equal(normal.maxGrossExposurePct, 150);

    const riskOff = resolveConstraints(DEFAULT_CONSTRAINTS, 'risk-off');
    assert.equal(riskOff.maxGrossExposurePct, 80);
    assert.equal(riskOff.maxSinglePositionPct, 6);

    const crisis = resolveConstraints(DEFAULT_CONSTRAINTS, 'crisis');
    assert.equal(crisis.maxGrossExposurePct, 40);
    assert.equal(crisis.maxSinglePositionPct, 4);
  });

  it('resolveConstraints falls through for unknown regime', async () => {
    const { DEFAULT_CONSTRAINTS, resolveConstraints } = await import('../src/services/risk/risk-constraints.ts');
    const unknown = resolveConstraints(DEFAULT_CONSTRAINTS, 'unknown-regime');
    assert.equal(unknown.maxGrossExposurePct, DEFAULT_CONSTRAINTS.maxGrossExposurePct);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Individual constraint checks
// ---------------------------------------------------------------------------
describe('constraint checks', () => {
  it('checkGrossExposure passes when within limit', async () => {
    const { checkGrossExposure } = await import('../src/services/risk/risk-constraints.ts');
    const idea = { id: 'a', sizePct: 5, symbols: [], direction: 'long', conviction: 70, falsePositiveRisk: 20, title: 'T', themeId: 't' };
    const portfolio = [{ symbol: 'SPY', sizePct: 10, sector: 'broad', direction: 'long', assetKind: 'etf', liquidityScore: 90, conviction: 60, returnPct: null }];
    const result = checkGrossExposure(idea, portfolio, 150);
    assert.equal(result.passed, true);
  });

  it('checkGrossExposure fails when over limit', async () => {
    const { checkGrossExposure } = await import('../src/services/risk/risk-constraints.ts');
    const idea = { id: 'a', sizePct: 50, symbols: [], direction: 'long', conviction: 70, falsePositiveRisk: 20, title: 'T', themeId: 't' };
    const portfolio = [{ symbol: 'SPY', sizePct: 120, sector: 'broad', direction: 'long', assetKind: 'etf', liquidityScore: 90, conviction: 60, returnPct: null }];
    const result = checkGrossExposure(idea, portfolio, 150);
    assert.equal(result.passed, false);
    assert.ok(result.suggestedMaxSizePct !== undefined);
    assert.ok(result.suggestedMaxSizePct <= 30);
  });

  it('checkLiquidity rejects low liquidity', async () => {
    const { checkLiquidity } = await import('../src/services/risk/risk-constraints.ts');
    const idea = {
      id: 'a', sizePct: 5, direction: 'long', conviction: 80, falsePositiveRisk: 10, title: 'T', themeId: 't',
      symbols: [{ symbol: 'ILLIQ', liquidityScore: 15, direction: 'long' }],
    };
    const result = checkLiquidity(idea, 30);
    assert.equal(result.passed, false);
  });

  it('checkSinglePositionSize caps oversized positions', async () => {
    const { checkSinglePositionSize } = await import('../src/services/risk/risk-constraints.ts');
    const idea = { id: 'a', sizePct: 20, symbols: [], direction: 'long', conviction: 90, falsePositiveRisk: 5, title: 'T', themeId: 't' };
    const result = checkSinglePositionSize(idea, 12);
    assert.equal(result.passed, false);
    assert.equal(result.suggestedMaxSizePct, 12);
  });

  it('checkSectorConcentration detects over-concentrated sectors', async () => {
    const { checkSectorConcentration } = await import('../src/services/risk/risk-constraints.ts');
    const idea = {
      id: 'a', sizePct: 10, direction: 'long', conviction: 70, falsePositiveRisk: 20, title: 'T', themeId: 't',
      symbols: [{ symbol: 'XLE', sector: 'energy', direction: 'long' }],
    };
    const portfolio = [
      { symbol: 'USO', sizePct: 30, sector: 'energy', direction: 'long', assetKind: 'etf', liquidityScore: 80, conviction: 65, returnPct: null },
    ];
    const result = checkSectorConcentration(idea, portfolio, 35);
    assert.equal(result.passed, false);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Composite constraint enforcement
// ---------------------------------------------------------------------------
describe('enforceConstraints', () => {
  it('approves ideas within all limits', async () => {
    const { enforceConstraints, DEFAULT_CONSTRAINTS } = await import('../src/services/risk/risk-constraints.ts');
    const ideas = [
      {
        id: 'idea1', title: 'Test', themeId: 'energy', direction: 'long', conviction: 75, falsePositiveRisk: 15, sizePct: 5,
        symbols: [{ symbol: 'XLE', sector: 'energy', liquidityScore: 85, direction: 'long' }],
      },
    ];
    const result = enforceConstraints(ideas, [], DEFAULT_CONSTRAINTS, null);
    assert.equal(result.length, 1);
    assert.equal(result[0].approved, true);
    assert.equal(result[0].approvedSizePct, 5);
    assert.equal(result[0].vetoReasons.length, 0);
  });

  it('vetoes ideas with insufficient liquidity', async () => {
    const { enforceConstraints, DEFAULT_CONSTRAINTS } = await import('../src/services/risk/risk-constraints.ts');
    const ideas = [
      {
        id: 'idea1', title: 'Illiquid', themeId: 'micro', direction: 'long', conviction: 90, falsePositiveRisk: 10, sizePct: 5,
        symbols: [{ symbol: 'MICRO', sector: 'tech', liquidityScore: 10, direction: 'long' }],
      },
    ];
    const result = enforceConstraints(ideas, [], DEFAULT_CONSTRAINTS, null);
    assert.equal(result[0].approved, false);
    assert.ok(result[0].vetoReasons.length > 0);
    assert.equal(result[0].constraintTriggered, 'liquidity');
  });

  it('conviction 90 idea can be vetoed by risk engine', async () => {
    const { enforceConstraints, DEFAULT_CONSTRAINTS } = await import('../src/services/risk/risk-constraints.ts');
    // High conviction, but liquidity too low
    const ideas = [
      {
        id: 'idea1', title: 'High conviction low liquidity', themeId: 't', direction: 'long', conviction: 90, falsePositiveRisk: 5, sizePct: 8,
        symbols: [{ symbol: 'LOW', sector: 'tech', liquidityScore: 5, direction: 'long' }],
      },
    ];
    const result = enforceConstraints(ideas, [], DEFAULT_CONSTRAINTS, null);
    assert.equal(result[0].approved, false);
    assert.ok(result[0].vetoReasons.some(r => r.includes('liquidity')));
  });

  it('reduces size when position limit exceeded', async () => {
    const { enforceConstraints, DEFAULT_CONSTRAINTS } = await import('../src/services/risk/risk-constraints.ts');
    const ideas = [
      {
        id: 'idea1', title: 'Oversized', themeId: 't', direction: 'long', conviction: 80, falsePositiveRisk: 15, sizePct: 20,
        symbols: [{ symbol: 'XLE', sector: 'energy', liquidityScore: 85, direction: 'long' }],
      },
    ];
    const result = enforceConstraints(ideas, [], DEFAULT_CONSTRAINTS, null);
    assert.equal(result[0].approved, true);
    assert.ok(result[0].approvedSizePct <= DEFAULT_CONSTRAINTS.maxSinglePositionPct);
    assert.ok(result[0].vetoReasons.length > 0); // size was reduced
  });

  it('processes ideas by conviction order', async () => {
    const { enforceConstraints, DEFAULT_CONSTRAINTS } = await import('../src/services/risk/risk-constraints.ts');
    const ideas = [
      {
        id: 'low', title: 'Low Conv', themeId: 't', direction: 'long', conviction: 40, falsePositiveRisk: 30, sizePct: 5,
        symbols: [{ symbol: 'A', sector: 'tech', liquidityScore: 80, direction: 'long' }],
      },
      {
        id: 'high', title: 'High Conv', themeId: 't', direction: 'long', conviction: 85, falsePositiveRisk: 10, sizePct: 5,
        symbols: [{ symbol: 'B', sector: 'tech', liquidityScore: 80, direction: 'long' }],
      },
    ];
    const result = enforceConstraints(ideas, [], DEFAULT_CONSTRAINTS, null);
    // High conviction should be processed first
    assert.equal(result[0].id, 'high');
    assert.equal(result[1].id, 'low');
  });

  it('regime change tightens constraints automatically', async () => {
    const { enforceConstraints, DEFAULT_CONSTRAINTS } = await import('../src/services/risk/risk-constraints.ts');
    const ideas = [
      {
        id: 'idea1', title: 'Normal sized', themeId: 't', direction: 'long', conviction: 75, falsePositiveRisk: 15, sizePct: 10,
        symbols: [{ symbol: 'XLE', sector: 'energy', liquidityScore: 85, direction: 'long' }],
      },
    ];

    // Normal: 10% is fine (max single = 12)
    const normalResult = enforceConstraints(ideas, [], DEFAULT_CONSTRAINTS, null);
    assert.equal(normalResult[0].approved, true);
    assert.equal(normalResult[0].approvedSizePct, 10);

    // Crisis: max single = 4, so 10% gets reduced
    const crisisResult = enforceConstraints(ideas, [], DEFAULT_CONSTRAINTS, 'crisis');
    assert.equal(crisisResult[0].approved, true);
    assert.ok(crisisResult[0].approvedSizePct <= 4);
  });
});

// ---------------------------------------------------------------------------
// Test 4: RiskEngine class
// ---------------------------------------------------------------------------
describe('RiskEngine', () => {
  it('assessPortfolioRisk returns valid assessment', async () => {
    const { RiskEngine } = await import('../src/services/risk/risk-engine.ts');
    const engine = new RiskEngine();

    const portfolio = [
      { symbol: 'XLE', direction: 'long', sizePct: 8, sector: 'energy', assetKind: 'etf', liquidityScore: 85, conviction: 70, returnPct: 2.5 },
      { symbol: 'GDX', direction: 'long', sizePct: 5, sector: 'materials', assetKind: 'etf', liquidityScore: 75, conviction: 65, returnPct: -1.2 },
      { symbol: 'TLT', direction: 'short', sizePct: 6, sector: 'bonds', assetKind: 'etf', liquidityScore: 95, conviction: 60, returnPct: 1.8 },
    ];

    const risk = engine.assessPortfolioRisk(portfolio);
    assert.equal(typeof risk.grossExposurePct, 'number');
    assert.equal(typeof risk.netExposurePct, 'number');
    assert.ok(risk.grossExposurePct > 0);
    assert.ok(risk.regimeStressTests.length > 0);
    assert.ok(risk.sectorBreakdown.length > 0);
    assert.ok(['low', 'moderate', 'elevated', 'high', 'critical'].includes(risk.riskLevel));
  });

  it('assessPortfolioRisk handles empty portfolio', async () => {
    const { RiskEngine } = await import('../src/services/risk/risk-engine.ts');
    const engine = new RiskEngine();
    const risk = engine.assessPortfolioRisk([]);
    assert.equal(risk.grossExposurePct, 0);
    assert.equal(risk.netExposurePct, 0);
    assert.equal(risk.riskLevel, 'low');
  });

  it('assessIdeaRisk computes marginal risk', async () => {
    const { RiskEngine } = await import('../src/services/risk/risk-engine.ts');
    const engine = new RiskEngine();

    const portfolio = [
      { symbol: 'XLE', direction: 'long', sizePct: 8, sector: 'energy', assetKind: 'etf', liquidityScore: 85, conviction: 70, returnPct: null },
    ];

    const idea = {
      id: 'new', title: 'New Idea', themeId: 'energy', direction: 'long', conviction: 75, falsePositiveRisk: 20, sizePct: 5,
      symbols: [{ symbol: 'USO', sector: 'energy', liquidityScore: 80, direction: 'long' }],
    };

    const assessment = engine.assessIdeaRisk(idea, portfolio);
    assert.equal(typeof assessment.marginalRisk, 'number');
    assert.equal(typeof assessment.correlationWithExisting, 'number');
    assert.ok(assessment.correlationWithExisting >= 0.7); // same sector
    assert.equal(typeof assessment.approved, 'boolean');
  });

  it('setRegime changes effective constraints', async () => {
    const { RiskEngine } = await import('../src/services/risk/risk-engine.ts');
    const engine = new RiskEngine();

    const normalConstraints = engine.getEffectiveConstraints();
    assert.equal(normalConstraints.maxGrossExposurePct, 150);

    engine.setRegime('crisis');
    const crisisConstraints = engine.getEffectiveConstraints();
    assert.equal(crisisConstraints.maxGrossExposurePct, 40);
  });

  it('applyIdeaGate returns proper gate result', async () => {
    const { RiskEngine } = await import('../src/services/risk/risk-engine.ts');
    const engine = new RiskEngine();

    const ideas = [
      {
        id: 'good', title: 'Good Idea', themeId: 't', direction: 'long', conviction: 80, falsePositiveRisk: 10, sizePct: 5,
        symbols: [{ symbol: 'AAPL', sector: 'tech', liquidityScore: 95, direction: 'long' }],
      },
      {
        id: 'bad', title: 'Bad Liquidity', themeId: 't', direction: 'long', conviction: 90, falsePositiveRisk: 5, sizePct: 5,
        symbols: [{ symbol: 'ILLIQ', sector: 'micro', liquidityScore: 5, direction: 'long' }],
      },
    ];

    const gateResult = engine.applyIdeaGate(ideas, []);
    assert.equal(gateResult.summary.totalProposed, 2);
    assert.ok(gateResult.summary.totalVetoed >= 1);
    assert.ok(gateResult.vetoed.some(v => v.id === 'bad'));
    assert.ok(gateResult.portfolioRisk);
  });

  it('all veto reasons are recorded', async () => {
    const { RiskEngine } = await import('../src/services/risk/risk-engine.ts');
    const engine = new RiskEngine();

    const ideas = [
      {
        id: 'multi-fail', title: 'Multi Fail', themeId: 't', direction: 'long', conviction: 50, falsePositiveRisk: 60, sizePct: 5,
        symbols: [{ symbol: 'LOW', sector: 'tech', liquidityScore: 5, direction: 'long' }],
      },
    ];

    const gateResult = engine.applyIdeaGate(ideas, []);
    const vetoed = gateResult.vetoed.find(v => v.id === 'multi-fail');
    assert.ok(vetoed);
    assert.ok(vetoed.vetoReasons.length > 0);
    assert.equal(vetoed.constraintTriggered, 'liquidity');
  });
});

// ---------------------------------------------------------------------------
// Test 5: Success criteria from master plan
// ---------------------------------------------------------------------------
describe('phase 4 success criteria', () => {
  it('risk engine vetoes conviction=90 idea (when risk is high)', async () => {
    const { RiskEngine } = await import('../src/services/risk/risk-engine.ts');
    const engine = new RiskEngine();

    const ideas = [
      {
        id: 'high-conv', title: 'High Conviction', themeId: 't', direction: 'long', conviction: 90, falsePositiveRisk: 5, sizePct: 8,
        symbols: [{ symbol: 'LOW', sector: 'tech', liquidityScore: 5, direction: 'long' }],
      },
    ];

    const result = engine.applyIdeaGate(ideas, []);
    assert.ok(result.vetoed.some(v => v.id === 'high-conv'));
  });

  it('risk constraint changes do not affect signal generation code', async () => {
    // Verify by checking that risk-constraints imports only from itself
    const fs = await import('node:fs');
    const content = fs.readFileSync(repoPath('src', 'services', 'risk', 'risk-constraints.ts'), 'utf-8');
    // risk-constraints should have NO imports from investment/ modules
    assert.ok(!content.includes("from '../investment/"), 'risk-constraints should not import from investment/');
    assert.ok(!content.includes("from './investment/"), 'risk-constraints should not import from investment/');
  });

  it('regime change auto-adjusts constraints', async () => {
    const { RiskEngine } = await import('../src/services/risk/risk-engine.ts');
    const engine = new RiskEngine();

    engine.setRegime(null);
    const normal = engine.getEffectiveConstraints();

    engine.setRegime('risk-off');
    const riskOff = engine.getEffectiveConstraints();

    // Risk-off should be strictly tighter
    assert.ok(riskOff.maxGrossExposurePct < normal.maxGrossExposurePct);
    assert.ok(riskOff.maxSinglePositionPct < normal.maxSinglePositionPct);
    assert.ok(riskOff.maxSectorConcentrationPct < normal.maxSectorConcentrationPct);
  });

  it('all veto/reduction reasons are explicitly recorded', async () => {
    const { enforceConstraints, DEFAULT_CONSTRAINTS } = await import('../src/services/risk/risk-constraints.ts');
    const ideas = [
      {
        id: 'oversized', title: 'Oversized', themeId: 't', direction: 'long', conviction: 80, falsePositiveRisk: 10, sizePct: 25,
        symbols: [{ symbol: 'XLE', sector: 'energy', liquidityScore: 80, direction: 'long' }],
      },
    ];
    const result = enforceConstraints(ideas, [], DEFAULT_CONSTRAINTS, null);
    // Should be reduced (25% > max single 12%)
    assert.ok(result[0].vetoReasons.length > 0);
    assert.ok(result[0].constraintTriggered !== null);
    // Reason should explain what happened
    assert.ok(result[0].vetoReasons[0].length > 10);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Structure verification
// ---------------------------------------------------------------------------
describe('phase 4 structure', () => {
  it('risk-engine.ts exists', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(repoPath('src', 'services', 'risk', 'risk-engine.ts'), 'utf-8');
    const lines = content.split('\n').length;
    assert.ok(lines >= 100);
    assert.ok(content.includes('class RiskEngine'));
    assert.ok(content.includes('assessPortfolioRisk'));
    assert.ok(content.includes('assessIdeaRisk'));
    assert.ok(content.includes('applyIdeaGate'));
  });

  it('risk-constraints.ts exists', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(repoPath('src', 'services', 'risk', 'risk-constraints.ts'), 'utf-8');
    const lines = content.split('\n').length;
    assert.ok(lines >= 100);
    assert.ok(content.includes('enforceConstraints'));
    assert.ok(content.includes('PortfolioConstraints'));
    assert.ok(content.includes('DEFAULT_CONSTRAINTS'));
  });

  it('risk modules are independent from investment signal modules', async () => {
    const fs = await import('node:fs');
    const engineContent = fs.readFileSync(repoPath('src', 'services', 'risk', 'risk-engine.ts'), 'utf-8');
    // risk-engine should only import from risk-constraints, not from investment/
    assert.ok(!engineContent.includes("from '../investment/"), 'risk-engine should not depend on investment modules');
  });
});
