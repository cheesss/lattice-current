/**
 * Portfolio execution controls extracted from portfolio-optimizer.ts.
 *
 * Canonical functions:
 *   - applyPortfolioExecutionControls — full execution pipeline
 *   - deployFloorPctForCard           — per-card deployment floor
 */

export {
  applyPortfolioExecutionControls,
} from '../portfolio-optimizer';

// deployFloorPctForCard is module-private in portfolio-optimizer.ts.
// Re-exported here as a standalone copy for consumers that need it directly.

import type { InvestmentIdeaCard } from '../types';
import type { MacroRiskOverlay } from '../../macro-risk-overlay';
import { clamp } from '../utils';

/**
 * Compute the deployment floor percentage for a single card.
 * This is the minimum allocation a deployed card should receive.
 */
export function deployFloorPctForCard(
  card: InvestmentIdeaCard,
  macroOverlay: MacroRiskOverlay,
  grossBudgetPct = 0,
  deployCount = 1,
): number {
  if (macroOverlay.killSwitch || card.confirmationState === 'contradicted') return 0;
  const budgetAwareFloor = grossBudgetPct > 0
    ? (grossBudgetPct / Math.max(1, deployCount)) * (macroOverlay.state === 'risk-on' ? 0.34 : macroOverlay.state === 'balanced' ? 0.28 : 0.22)
    : 0;
  const baseFloor = Math.max(
    budgetAwareFloor,
    macroOverlay.state === 'risk-on'
      ? 1.2
      : macroOverlay.state === 'balanced'
        ? 0.8
        : 0.4,
  );
  const confirmationBoost = clamp((card.confirmationScore - 55) / 35, 0, 1);
  const realityBoost = clamp((card.realityScore - 60) / 30, 0, 1);
  const sizeBoost = clamp(card.sizeMultiplier, 0, 1.5);
  const floor = baseFloor * (0.7 + confirmationBoost * 0.7 + realityBoost * 0.25 + sizeBoost * 0.08);
  const cap = macroOverlay.state === 'risk-on' ? 2.5 : macroOverlay.state === 'balanced' ? 1.8 : 1.1;
  return clamp(Number(floor.toFixed(2)), 0, cap);
}
