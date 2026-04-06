/**
 * Deploy cluster planning and budget allocation extracted from portfolio-optimizer.ts.
 *
 * Canonical functions:
 *   - buildDeployClusterPlan — cluster-aware idea grouping and scoring
 *   - allocateDeployBudget   — distributes capital across clusters/ideas
 *   - zipfRankShares         — Zipf-law allocation shares
 */

export {
  buildDeployClusterPlan,
  allocateDeployBudget,
} from '../portfolio-optimizer';

// zipfRankShares is not exported from portfolio-optimizer (module-private).
// It is used only by buildConcentratedAllocationShares internally.
// To use it independently, import it from portfolio-optimizer after making it public,
// or copy the implementation here. For now we document the intent.

/**
 * Generate Zipf-law rank shares for a given count and exponent.
 *
 * This is a re-export placeholder. The canonical implementation lives in
 * portfolio-optimizer.ts as a private function. If standalone access is needed,
 * promote it to a public export in portfolio-optimizer and re-export here.
 */
export function zipfRankShares(count: number, alpha: number): number[] {
  if (!(count > 0)) return [];
  const weights = Array.from({ length: count }, (_, index) => 1 / Math.pow(index + 1, alpha));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return total > 0 ? weights.map((value) => value / total) : weights.map(() => 1 / count);
}
