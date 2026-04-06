/**
 * Risk Engine — Phase 4
 *
 * Independent risk management layer that evaluates portfolio risk
 * and individual idea risk separately from the signal pipeline.
 * The risk engine has veto power over any idea regardless of conviction.
 */

import type {
  PortfolioConstraints,
  PortfolioPosition,
  SizedIdea,
  ConstrainedIdea,
  MarketRegimeId,
} from './risk-constraints';
import {
  DEFAULT_CONSTRAINTS,
  resolveConstraints,
  enforceConstraints,
  checkGrossExposure,
  checkNetExposure,
  checkSinglePositionSize,
  checkSectorConcentration,
  checkCorrelatedGroup,
  checkLiquidity,
} from './risk-constraints';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PortfolioRiskAssessment {
  /** Total exposure (sum of absolute position sizes). */
  grossExposurePct: number;
  /** Net directional exposure (long - short). */
  netExposurePct: number;
  /** Correlation-based risk score (0-100, higher = more risk). */
  correlationRisk: number;
  /** Sector/region/asset kind concentration score (0-100). */
  concentrationRisk: number;
  /** Overall liquidity profile score (0-100, higher = more liquid). */
  liquidityScore: number;
  /** Estimated maximum drawdown based on current positions. */
  maxDrawdownEstimate: number;
  /** Regime-specific stress test results. */
  regimeStressTests: RegimeStressResult[];
  /** Risk level summary. */
  riskLevel: 'low' | 'moderate' | 'elevated' | 'high' | 'critical';
  /** Breakdown by sector. */
  sectorBreakdown: SectorRiskEntry[];
}

export interface RegimeStressResult {
  regime: string;
  estimatedDrawdownPct: number;
  exposureAdjustmentPct: number;
  positionsAtRisk: number;
}

export interface SectorRiskEntry {
  sector: string;
  exposurePct: number;
  positionCount: number;
  avgConviction: number;
}

export interface IdeaRiskAssessment {
  /** How much adding this idea changes portfolio risk. */
  marginalRisk: number;
  /** Correlation with existing positions (0-1). */
  correlationWithExisting: number;
  /** Liquidity score of the idea's symbols. */
  liquidityScore: number;
  /** Whether the idea is approved by the risk engine. */
  approved: boolean;
  /** Reasons for veto if not approved. */
  vetoReasons: string[];
  /** Risk-adjusted size. */
  adjustedSizePct: number;
}

export interface RiskGateResult {
  /** Ideas that passed the risk gate. */
  passed: ConstrainedIdea[];
  /** Ideas that were vetoed. */
  vetoed: ConstrainedIdea[];
  /** Ideas that had their size reduced. */
  reduced: ConstrainedIdea[];
  /** Portfolio risk assessment after gate. */
  portfolioRisk: PortfolioRiskAssessment;
  /** Summary statistics. */
  summary: {
    totalProposed: number;
    totalApproved: number;
    totalVetoed: number;
    totalReduced: number;
    totalOriginalExposure: number;
    totalApprovedExposure: number;
  };
}

// ---------------------------------------------------------------------------
// Risk Engine
// ---------------------------------------------------------------------------

export class RiskEngine {
  private constraints: PortfolioConstraints;
  private regime: MarketRegimeId | null = null;

  constructor(constraints: PortfolioConstraints = DEFAULT_CONSTRAINTS) {
    this.constraints = constraints;
  }

  /** Update the current market regime. */
  setRegime(regime: MarketRegimeId | null): void {
    this.regime = regime;
  }

  /** Get the current effective constraints (with regime overrides applied). */
  getEffectiveConstraints(): Omit<PortfolioConstraints, 'regimeOverrides'> {
    return resolveConstraints(this.constraints, this.regime);
  }

  /** Update constraints. */
  setConstraints(constraints: PortfolioConstraints): void {
    this.constraints = constraints;
  }

  // -----------------------------------------------------------------------
  // Portfolio-level Assessment
  // -----------------------------------------------------------------------

  /** Assess the overall risk of the current portfolio. */
  assessPortfolioRisk(portfolio: PortfolioPosition[]): PortfolioRiskAssessment {
    const grossExposurePct = portfolio.reduce(
      (sum: number, p: PortfolioPosition) => sum + Math.abs(p.sizePct), 0,
    );
    const netExposurePct = portfolio.reduce(
      (sum: number, p: PortfolioPosition) => {
        const sign = p.direction === 'short' ? -1 : 1;
        return sum + sign * p.sizePct;
      }, 0,
    );

    const sectorBreakdown = buildSectorBreakdown(portfolio);
    const concentrationRisk = computeConcentrationRisk(sectorBreakdown);
    const correlationRisk = computeCorrelationRisk(portfolio);
    const liquidityScore = computePortfolioLiquidity(portfolio);
    const maxDrawdownEstimate = estimateMaxDrawdown(grossExposurePct, concentrationRisk, correlationRisk);

    const regimeStressTests = [
      buildStressTest('risk-off', portfolio, 0.6),
      buildStressTest('crisis', portfolio, 0.3),
      buildStressTest('rate-shock', portfolio, 0.7),
    ];

    const riskLevel = classifyRiskLevel(grossExposurePct, concentrationRisk, correlationRisk);

    return {
      grossExposurePct: r2n(grossExposurePct),
      netExposurePct: r2n(netExposurePct),
      correlationRisk: r2n(correlationRisk),
      concentrationRisk: r2n(concentrationRisk),
      liquidityScore: r2n(liquidityScore),
      maxDrawdownEstimate: r2n(maxDrawdownEstimate),
      regimeStressTests,
      riskLevel,
      sectorBreakdown,
    };
  }

  // -----------------------------------------------------------------------
  // Idea-level Assessment
  // -----------------------------------------------------------------------

  /** Assess the risk of adding a single idea to the portfolio. */
  assessIdeaRisk(
    idea: SizedIdea,
    portfolio: PortfolioPosition[],
  ): IdeaRiskAssessment {
    const effective = this.getEffectiveConstraints();
    const vetoReasons: string[] = [];
    let adjustedSize = idea.sizePct;

    // Run all constraint checks
    const checks = [
      checkLiquidity(idea, effective.minLiquidityScore),
      checkSinglePositionSize(idea, effective.maxSinglePositionPct),
      checkSectorConcentration(idea, portfolio, effective.maxSectorConcentrationPct),
      checkCorrelatedGroup(idea, portfolio, effective.maxCorrelatedGroupPct),
      checkGrossExposure(idea, portfolio, effective.maxGrossExposurePct),
      checkNetExposure(idea, portfolio, effective.maxNetExposurePct),
    ];

    for (const check of checks) {
      if (!check.passed) {
        vetoReasons.push(check.message);
        if (check.suggestedMaxSizePct !== undefined) {
          adjustedSize = Math.min(adjustedSize, check.suggestedMaxSizePct);
        } else {
          adjustedSize = 0; // Hard veto (e.g., liquidity)
        }
      }
    }

    adjustedSize = Math.max(0, r2n(adjustedSize));

    // Compute marginal risk
    const currentRisk = this.assessPortfolioRisk(portfolio);
    const hypotheticalPortfolio = [...portfolio, ...idea.symbols.map((s) => ({
      symbol: s.symbol,
      direction: (idea.direction === 'watch' || idea.direction === 'pair' ? 'long' : idea.direction) as 'long' | 'short' | 'hedge',
      sizePct: adjustedSize / Math.max(idea.symbols.length, 1),
      sector: s.sector || 'unknown',
      assetKind: s.assetKind || 'equity',
      liquidityScore: s.liquidityScore ?? 80,
      correlationGroup: s.correlationGroup,
      conviction: idea.conviction,
      returnPct: null,
    }))];
    const newRisk = this.assessPortfolioRisk(hypotheticalPortfolio);
    const marginalRisk = r2n(newRisk.concentrationRisk - currentRisk.concentrationRisk + (newRisk.correlationRisk - currentRisk.correlationRisk));

    // Correlation with existing positions (simplified: same sector = 0.7, same group = 0.9)
    const correlationWithExisting = computeIdeaCorrelation(idea, portfolio);

    const minLiquidity = Math.min(...idea.symbols.map((s) => s.liquidityScore ?? 100));

    return {
      marginalRisk,
      correlationWithExisting: r2n(correlationWithExisting),
      liquidityScore: minLiquidity,
      approved: adjustedSize > 0,
      vetoReasons,
      adjustedSizePct: adjustedSize,
    };
  }

  // -----------------------------------------------------------------------
  // Risk Gates (Pipeline Integration)
  // -----------------------------------------------------------------------

  /**
   * First risk gate: idea-level screening.
   * Applied after scoring, before sizing.
   * Rejects ideas with fundamental risk issues (liquidity, spread).
   */
  applyIdeaGate(
    ideas: SizedIdea[],
    portfolio: PortfolioPosition[],
  ): RiskGateResult {
    const constrained = enforceConstraints(ideas, portfolio, this.constraints, this.regime);
    return buildGateResult(constrained, ideas, portfolio, this);
  }

  /**
   * Second risk gate: portfolio-level screening.
   * Applied after sizing, before deployment.
   * Checks aggregate portfolio constraints.
   */
  applyPortfolioGate(
    ideas: SizedIdea[],
    portfolio: PortfolioPosition[],
  ): RiskGateResult {
    const constrained = enforceConstraints(ideas, portfolio, this.constraints, this.regime);
    return buildGateResult(constrained, ideas, portfolio, this);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSectorBreakdown(portfolio: PortfolioPosition[]): SectorRiskEntry[] {
  const sectors = new Map<string, { exposure: number; count: number; convictions: number[] }>();
  for (const p of portfolio) {
    const entry = sectors.get(p.sector) ?? { exposure: 0, count: 0, convictions: [] };
    entry.exposure += Math.abs(p.sizePct);
    entry.count += 1;
    entry.convictions.push(p.conviction);
    sectors.set(p.sector, entry);
  }
  return Array.from(sectors.entries()).map(([sector, data]) => ({
    sector,
    exposurePct: r2n(data.exposure),
    positionCount: data.count,
    avgConviction: r2n(data.convictions.reduce((a: number, b: number) => a + b, 0) / data.convictions.length),
  }));
}

function computeConcentrationRisk(breakdown: SectorRiskEntry[]): number {
  if (breakdown.length === 0) return 0;
  const maxExposure = Math.max(...breakdown.map((s: SectorRiskEntry) => s.exposurePct));
  const totalExposure = breakdown.reduce((sum: number, s: SectorRiskEntry) => sum + s.exposurePct, 0);
  if (totalExposure === 0) return 0;
  // HHI-like concentration: max sector / total * 100
  return Math.min(100, (maxExposure / totalExposure) * 100);
}

function computeCorrelationRisk(portfolio: PortfolioPosition[]): number {
  if (portfolio.length <= 1) return 0;
  const groups = new Map<string, number>();
  for (const p of portfolio) {
    const group = p.correlationGroup ?? p.sector;
    groups.set(group, (groups.get(group) ?? 0) + Math.abs(p.sizePct));
  }
  const maxGroup = Math.max(...Array.from(groups.values()));
  const total = portfolio.reduce((sum: number, p: PortfolioPosition) => sum + Math.abs(p.sizePct), 0);
  if (total === 0) return 0;
  return Math.min(100, (maxGroup / total) * 100 * (portfolio.length > 5 ? 0.8 : 1));
}

function computePortfolioLiquidity(portfolio: PortfolioPosition[]): number {
  if (portfolio.length === 0) return 100;
  const weighted = portfolio.reduce(
    (sum: number, p: PortfolioPosition) => sum + p.liquidityScore * Math.abs(p.sizePct),
    0,
  );
  const totalSize = portfolio.reduce((sum: number, p: PortfolioPosition) => sum + Math.abs(p.sizePct), 0);
  return totalSize > 0 ? weighted / totalSize : 100;
}

function estimateMaxDrawdown(gross: number, concentration: number, correlation: number): number {
  // Simplified drawdown estimation
  const baseDd = gross * 0.15; // 15% of gross as base
  const concentrationAdj = 1 + (concentration / 100) * 0.5;
  const correlationAdj = 1 + (correlation / 100) * 0.3;
  return Math.min(100, baseDd * concentrationAdj * correlationAdj);
}

function buildStressTest(
  regime: string,
  portfolio: PortfolioPosition[],
  survivalRate: number,
): RegimeStressResult {
  const totalExposure = portfolio.reduce((sum: number, p: PortfolioPosition) => sum + Math.abs(p.sizePct), 0);
  const atRisk = portfolio.filter((p: PortfolioPosition) => p.liquidityScore < 60).length;
  return {
    regime,
    estimatedDrawdownPct: r2n(totalExposure * (1 - survivalRate) * 0.3),
    exposureAdjustmentPct: r2n(-totalExposure * (1 - survivalRate)),
    positionsAtRisk: atRisk,
  };
}

function classifyRiskLevel(
  gross: number,
  concentration: number,
  correlation: number,
): 'low' | 'moderate' | 'elevated' | 'high' | 'critical' {
  const score = gross * 0.4 + concentration * 0.3 + correlation * 0.3;
  if (score >= 120) return 'critical';
  if (score >= 90) return 'high';
  if (score >= 60) return 'elevated';
  if (score >= 30) return 'moderate';
  return 'low';
}

function computeIdeaCorrelation(idea: SizedIdea, portfolio: PortfolioPosition[]): number {
  if (portfolio.length === 0) return 0;
  const ideaSectors = new Set(idea.symbols.map((s) => s.sector || 'unknown'));
  const ideaGroups = new Set(idea.symbols.map((s) => s.correlationGroup).filter(Boolean));

  let maxCorr = 0;
  for (const p of portfolio) {
    if (ideaGroups.has(p.correlationGroup)) {
      maxCorr = Math.max(maxCorr, 0.9);
    } else if (ideaSectors.has(p.sector)) {
      maxCorr = Math.max(maxCorr, 0.7);
    }
  }
  return maxCorr;
}

function buildGateResult(
  constrained: ConstrainedIdea[],
  originalIdeas: SizedIdea[],
  portfolio: PortfolioPosition[],
  engine: RiskEngine,
): RiskGateResult {
  const passed = constrained.filter((c: ConstrainedIdea) => c.approved && c.vetoReasons.length === 0);
  const vetoed = constrained.filter((c: ConstrainedIdea) => !c.approved);
  const reduced = constrained.filter((c: ConstrainedIdea) => c.approved && c.vetoReasons.length > 0);

  const totalOriginalExposure = originalIdeas.reduce((sum: number, i: SizedIdea) => sum + i.sizePct, 0);
  const totalApprovedExposure = constrained
    .filter((c: ConstrainedIdea) => c.approved)
    .reduce((sum: number, c: ConstrainedIdea) => sum + c.approvedSizePct, 0);

  // Compute portfolio risk after gate
  const approvedPositions: PortfolioPosition[] = constrained
    .filter((c: ConstrainedIdea) => c.approved)
    .flatMap((c: ConstrainedIdea) =>
      c.symbols.map((s) => ({
        symbol: s.symbol,
        direction: (c.direction === 'watch' || c.direction === 'pair' ? 'long' : c.direction) as 'long' | 'short' | 'hedge',
        sizePct: c.approvedSizePct / Math.max(c.symbols.length, 1),
        sector: s.sector || 'unknown',
        assetKind: s.assetKind || 'equity',
        liquidityScore: s.liquidityScore ?? 80,
        correlationGroup: s.correlationGroup,
        conviction: c.conviction,
        returnPct: null,
      })),
    );

  const portfolioRisk = engine.assessPortfolioRisk([...portfolio, ...approvedPositions]);

  return {
    passed,
    vetoed,
    reduced,
    portfolioRisk,
    summary: {
      totalProposed: originalIdeas.length,
      totalApproved: passed.length + reduced.length,
      totalVetoed: vetoed.length,
      totalReduced: reduced.length,
      totalOriginalExposure: r2n(totalOriginalExposure),
      totalApprovedExposure: r2n(totalApprovedExposure),
    },
  };
}

function r2n(n: number): number {
  return Math.round(n * 100) / 100;
}