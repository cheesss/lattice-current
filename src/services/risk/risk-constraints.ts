/**
 * Risk Constraints — Phase 4
 *
 * Defines portfolio-level risk constraints that are evaluated
 * independently of signal generation. The risk layer has veto power
 * over any idea regardless of conviction.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Identifier for market regime states. */
export type MarketRegimeId = string;

/** Portfolio-level risk constraints. */
export interface PortfolioConstraints {
  /** Maximum total position exposure (long + short absolute). */
  maxGrossExposurePct: number;
  /** Maximum net directional exposure (long - short). */
  maxNetExposurePct: number;
  /** Maximum single position size. */
  maxSinglePositionPct: number;
  /** Maximum concentration in one sector. */
  maxSectorConcentrationPct: number;
  /** Maximum weight in a correlated group. */
  maxCorrelatedGroupPct: number;
  /** Drawdown threshold that triggers exposure reduction. */
  maxDrawdownTriggerPct: number;
  /** Minimum liquidity score required. */
  minLiquidityScore: number;
  /** Regime-specific constraint overrides. */
  regimeOverrides: Map<MarketRegimeId, Partial<Omit<PortfolioConstraints, 'regimeOverrides'>>>;
}

/** A scored position in the portfolio. */
export interface PortfolioPosition {
  symbol: string;
  direction: 'long' | 'short' | 'hedge';
  sizePct: number;
  sector: string;
  assetKind: string;
  liquidityScore: number;
  correlationGroup?: string;
  conviction: number;
  returnPct: number | null;
}

/** A sized idea proposed for the portfolio. */
export interface SizedIdea {
  id: string;
  title: string;
  themeId: string;
  direction: 'long' | 'short' | 'hedge' | 'watch' | 'pair';
  conviction: number;
  falsePositiveRisk: number;
  sizePct: number;
  symbols: Array<{
    symbol: string;
    sector?: string;
    assetKind?: string;
    liquidityScore?: number;
    direction: string;
    correlationGroup?: string;
  }>;
}

/** Result of constraint enforcement on a single idea. */
export interface ConstrainedIdea extends SizedIdea {
  /** Final approved size after risk adjustment. */
  approvedSizePct: number;
  /** Whether the idea was approved. */
  approved: boolean;
  /** If vetoed or reduced, reasons are listed here. */
  vetoReasons: string[];
  /** Which constraint triggered the adjustment. */
  constraintTriggered: string | null;
}

/** Result of a constraint check. */
export interface ConstraintCheckResult {
  passed: boolean;
  constraintName: string;
  message: string;
  /** Suggested maximum size that would pass. */
  suggestedMaxSizePct?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONSTRAINTS: PortfolioConstraints = {
  maxGrossExposurePct: 150,
  maxNetExposurePct: 80,
  maxSinglePositionPct: 12,
  maxSectorConcentrationPct: 35,
  maxCorrelatedGroupPct: 25,
  maxDrawdownTriggerPct: 15,
  minLiquidityScore: 30,
  regimeOverrides: new Map([
    ['risk-off', {
      maxGrossExposurePct: 80,
      maxNetExposurePct: 40,
      maxSinglePositionPct: 6,
      maxSectorConcentrationPct: 20,
      maxCorrelatedGroupPct: 15,
    }],
    ['crisis', {
      maxGrossExposurePct: 40,
      maxNetExposurePct: 20,
      maxSinglePositionPct: 4,
      maxSectorConcentrationPct: 12,
      maxCorrelatedGroupPct: 10,
    }],
  ]),
};

// ---------------------------------------------------------------------------
// Constraint Resolution
// ---------------------------------------------------------------------------

/** Resolve effective constraints by applying regime overrides. */
export function resolveConstraints(
  base: PortfolioConstraints,
  regime: MarketRegimeId | null,
): Omit<PortfolioConstraints, 'regimeOverrides'> {
  const overrides = regime ? base.regimeOverrides.get(regime) : undefined;
  return {
    maxGrossExposurePct: overrides?.maxGrossExposurePct ?? base.maxGrossExposurePct,
    maxNetExposurePct: overrides?.maxNetExposurePct ?? base.maxNetExposurePct,
    maxSinglePositionPct: overrides?.maxSinglePositionPct ?? base.maxSinglePositionPct,
    maxSectorConcentrationPct: overrides?.maxSectorConcentrationPct ?? base.maxSectorConcentrationPct,
    maxCorrelatedGroupPct: overrides?.maxCorrelatedGroupPct ?? base.maxCorrelatedGroupPct,
    maxDrawdownTriggerPct: overrides?.maxDrawdownTriggerPct ?? base.maxDrawdownTriggerPct,
    minLiquidityScore: overrides?.minLiquidityScore ?? base.minLiquidityScore,
  };
}

// ---------------------------------------------------------------------------
// Individual Constraint Checks
// ---------------------------------------------------------------------------

/** Check if adding this idea would exceed gross exposure. */
export function checkGrossExposure(
  idea: SizedIdea,
  portfolio: PortfolioPosition[],
  limit: number,
): ConstraintCheckResult {
  const currentGross = portfolio.reduce((sum: number, p: PortfolioPosition) => sum + Math.abs(p.sizePct), 0);
  const newGross = currentGross + idea.sizePct;
  const headroom = Math.max(0, limit - currentGross);

  if (newGross <= limit) {
    return { passed: true, constraintName: 'gross-exposure', message: `Gross exposure ${r2(newGross)}% within ${limit}% limit` };
  }
  return {
    passed: false,
    constraintName: 'gross-exposure',
    message: `Gross exposure would be ${r2(newGross)}% (limit ${limit}%)`,
    suggestedMaxSizePct: Math.max(0, headroom),
  };
}

/** Check if adding this idea would exceed net exposure. */
export function checkNetExposure(
  idea: SizedIdea,
  portfolio: PortfolioPosition[],
  limit: number,
): ConstraintCheckResult {
  const netSign = idea.direction === 'short' ? -1 : 1;
  const currentNet = portfolio.reduce((sum: number, p: PortfolioPosition) => {
    const sign = p.direction === 'short' ? -1 : 1;
    return sum + sign * p.sizePct;
  }, 0);
  const newNet = Math.abs(currentNet + netSign * idea.sizePct);

  if (newNet <= limit) {
    return { passed: true, constraintName: 'net-exposure', message: `Net exposure ${r2(newNet)}% within ${limit}% limit` };
  }
  return {
    passed: false,
    constraintName: 'net-exposure',
    message: `Net exposure would be ${r2(newNet)}% (limit ${limit}%)`,
    suggestedMaxSizePct: Math.max(0, limit - Math.abs(currentNet)),
  };
}

/** Check single position size limit. */
export function checkSinglePositionSize(
  idea: SizedIdea,
  limit: number,
): ConstraintCheckResult {
  if (idea.sizePct <= limit) {
    return { passed: true, constraintName: 'single-position', message: `Position ${r2(idea.sizePct)}% within ${limit}% limit` };
  }
  return {
    passed: false,
    constraintName: 'single-position',
    message: `Position ${r2(idea.sizePct)}% exceeds ${limit}% single-position limit`,
    suggestedMaxSizePct: limit,
  };
}

/** Check sector concentration. */
export function checkSectorConcentration(
  idea: SizedIdea,
  portfolio: PortfolioPosition[],
  limit: number,
): ConstraintCheckResult {
  const ideaSectors = new Set(idea.symbols.map((s) => s.sector || 'unknown'));
  for (const sector of ideaSectors) {
    const sectorExposure = portfolio
      .filter((p: PortfolioPosition) => p.sector === sector)
      .reduce((sum: number, p: PortfolioPosition) => sum + Math.abs(p.sizePct), 0);
    const newExposure = sectorExposure + idea.sizePct;
    if (newExposure > limit) {
      return {
        passed: false,
        constraintName: 'sector-concentration',
        message: `Sector '${sector}' would be ${r2(newExposure)}% (limit ${limit}%)`,
        suggestedMaxSizePct: Math.max(0, limit - sectorExposure),
      };
    }
  }
  return { passed: true, constraintName: 'sector-concentration', message: 'Sector concentration within limits' };
}

/** Check correlated group concentration. */
export function checkCorrelatedGroup(
  idea: SizedIdea,
  portfolio: PortfolioPosition[],
  limit: number,
): ConstraintCheckResult {
  const ideaGroups = new Set(
    idea.symbols
      .map((s) => s.correlationGroup)
      .filter((g): g is string => Boolean(g)),
  );
  if (ideaGroups.size === 0) {
    return { passed: true, constraintName: 'correlated-group', message: 'No correlation group assigned' };
  }
  for (const group of ideaGroups) {
    const groupExposure = portfolio
      .filter((p: PortfolioPosition) => p.correlationGroup === group)
      .reduce((sum: number, p: PortfolioPosition) => sum + Math.abs(p.sizePct), 0);
    const newExposure = groupExposure + idea.sizePct;
    if (newExposure > limit) {
      return {
        passed: false,
        constraintName: 'correlated-group',
        message: `Correlated group '${group}' would be ${r2(newExposure)}% (limit ${limit}%)`,
        suggestedMaxSizePct: Math.max(0, limit - groupExposure),
      };
    }
  }
  return { passed: true, constraintName: 'correlated-group', message: 'Correlated group within limits' };
}

/** Check minimum liquidity score. */
export function checkLiquidity(
  idea: SizedIdea,
  minScore: number,
): ConstraintCheckResult {
  const minIdeaLiquidity = Math.min(
    ...idea.symbols.map((s) => s.liquidityScore ?? 100),
  );
  if (minIdeaLiquidity >= minScore) {
    return { passed: true, constraintName: 'liquidity', message: `Liquidity ${minIdeaLiquidity} >= ${minScore}` };
  }
  return {
    passed: false,
    constraintName: 'liquidity',
    message: `Lowest symbol liquidity ${minIdeaLiquidity} below minimum ${minScore}`,
  };
}

// ---------------------------------------------------------------------------
// Composite Constraint Enforcement
// ---------------------------------------------------------------------------

/**
 * Enforce all constraints on a set of proposed ideas.
 * Ideas are processed in order of conviction (highest first).
 * Constraint violations result in size reduction or veto.
 */
export function enforceConstraints(
  proposals: SizedIdea[],
  portfolio: PortfolioPosition[],
  constraints: PortfolioConstraints,
  regime: MarketRegimeId | null = null,
): ConstrainedIdea[] {
  const effective = resolveConstraints(constraints, regime);
  // Sort by conviction descending — highest conviction gets first allocation
  const sorted = [...proposals].sort((a: SizedIdea, b: SizedIdea) => b.conviction - a.conviction);
  const currentPortfolio = [...portfolio];
  const results: ConstrainedIdea[] = [];

  for (const idea of sorted) {
    const vetoReasons: string[] = [];
    let approvedSize = idea.sizePct;
    let constraintTriggered: string | null = null;

    // 1. Liquidity gate (hard veto — no size reduction possible)
    const liquidityCheck = checkLiquidity(idea, effective.minLiquidityScore);
    if (!liquidityCheck.passed) {
      results.push({
        ...idea,
        approvedSizePct: 0,
        approved: false,
        vetoReasons: [liquidityCheck.message],
        constraintTriggered: 'liquidity',
      });
      continue;
    }

    // 2. Single position limit
    const singleCheck = checkSinglePositionSize(idea, effective.maxSinglePositionPct);
    if (!singleCheck.passed) {
      approvedSize = singleCheck.suggestedMaxSizePct ?? 0;
      vetoReasons.push(singleCheck.message);
      constraintTriggered = 'single-position';
    }

    // 3. Sector concentration
    const sectorCheck = checkSectorConcentration(
      { ...idea, sizePct: approvedSize },
      currentPortfolio,
      effective.maxSectorConcentrationPct,
    );
    if (!sectorCheck.passed) {
      approvedSize = Math.min(approvedSize, sectorCheck.suggestedMaxSizePct ?? 0);
      vetoReasons.push(sectorCheck.message);
      constraintTriggered = constraintTriggered ?? 'sector-concentration';
    }

    // 4. Correlated group
    const corrCheck = checkCorrelatedGroup(
      { ...idea, sizePct: approvedSize },
      currentPortfolio,
      effective.maxCorrelatedGroupPct,
    );
    if (!corrCheck.passed) {
      approvedSize = Math.min(approvedSize, corrCheck.suggestedMaxSizePct ?? 0);
      vetoReasons.push(corrCheck.message);
      constraintTriggered = constraintTriggered ?? 'correlated-group';
    }

    // 5. Gross exposure
    const grossCheck = checkGrossExposure(
      { ...idea, sizePct: approvedSize },
      currentPortfolio,
      effective.maxGrossExposurePct,
    );
    if (!grossCheck.passed) {
      approvedSize = Math.min(approvedSize, grossCheck.suggestedMaxSizePct ?? 0);
      vetoReasons.push(grossCheck.message);
      constraintTriggered = constraintTriggered ?? 'gross-exposure';
    }

    // 6. Net exposure
    const netCheck = checkNetExposure(
      { ...idea, sizePct: approvedSize },
      currentPortfolio,
      effective.maxNetExposurePct,
    );
    if (!netCheck.passed) {
      approvedSize = Math.min(approvedSize, netCheck.suggestedMaxSizePct ?? 0);
      vetoReasons.push(netCheck.message);
      constraintTriggered = constraintTriggered ?? 'net-exposure';
    }

    // Round
    approvedSize = Math.round(approvedSize * 100) / 100;
    const approved = approvedSize > 0;

    if (!approved) {
      vetoReasons.push('Effective size reduced to zero');
    }

    results.push({
      ...idea,
      approvedSizePct: approvedSize,
      approved,
      vetoReasons,
      constraintTriggered: vetoReasons.length > 0 ? (constraintTriggered ?? 'multiple') : null,
    });

    // Add approved idea to simulated portfolio for subsequent checks
    if (approved) {
      for (const sym of idea.symbols) {
        currentPortfolio.push({
          symbol: sym.symbol,
          direction: idea.direction === 'watch' || idea.direction === 'pair' ? 'long' : idea.direction as 'long' | 'short' | 'hedge',
          sizePct: approvedSize / Math.max(idea.symbols.length, 1),
          sector: sym.sector || 'unknown',
          assetKind: sym.assetKind || 'equity',
          liquidityScore: sym.liquidityScore ?? 80,
          correlationGroup: sym.correlationGroup,
          conviction: idea.conviction,
          returnPct: null,
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function r2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}
