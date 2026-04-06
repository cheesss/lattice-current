import type { IdeaAttributionBreakdown } from '../../decision-attribution';

// ============================================================================
// ATTRIBUTION MERGING
// ============================================================================

export function mergeAttributionBreakdown(
  lead: IdeaAttributionBreakdown,
  rows: IdeaAttributionBreakdown[],
): IdeaAttributionBreakdown {
  if (!rows.length) return lead;
  const components = new Map<string, { label: string; contribution: number; explanation: string; count: number }>();
  for (const row of rows) {
    for (const component of row.components) {
      const current = components.get(component.key) || {
        label: component.label,
        contribution: 0,
        explanation: component.explanation,
        count: 0,
      };
      current.contribution += component.contribution;
      current.count += 1;
      components.set(component.key, current);
    }
  }
  const mergedComponents = Array.from(components.entries())
    .map(([key, value]) => ({
      key,
      label: value.label,
      contribution: Number((value.contribution / Math.max(1, value.count)).toFixed(2)),
      explanation: value.explanation,
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const primaryDriver = mergedComponents.find((component) => component.contribution > 0)?.label || lead.primaryDriver;
  const primaryPenalty = [...mergedComponents].reverse().find((component) => component.contribution < 0)?.label || lead.primaryPenalty;
  const failureModes = Array.from(new Set(rows.flatMap((row) => row.failureModes))).slice(0, 6);
  return {
    primaryDriver,
    primaryPenalty,
    components: mergedComponents,
    narrative: lead.narrative,
    failureModes,
  };
}
