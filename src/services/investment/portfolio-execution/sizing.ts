/**
 * Theme exposure caps and dynamic position weight inference
 * extracted from portfolio-optimizer.ts.
 *
 * Canonical functions:
 *   - buildThemeExposureCaps           — per-theme exposure limits
 *   - inferDynamicMaxPositionWeight    — adaptive max position weight
 */

export {
  buildThemeExposureCaps,
  inferDynamicMaxPositionWeight,
} from '../portfolio-optimizer';

// buildHrpfClusterCaps is module-private in portfolio-optimizer.ts.
// Re-exported here as documentation for the intended extraction.
// If standalone access is needed, promote it in portfolio-optimizer and re-export.
