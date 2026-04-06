import type { InvestmentDirection, PositionSizingRule } from './types';
import { POSITION_RULES } from './constants';

export function chooseSizingRule(
  conviction: number,
  falsePositiveRisk: number,
  direction: InvestmentDirection,
): PositionSizingRule {
  if (direction === 'hedge') {
    return POSITION_RULES.find((rule) => rule.id === 'hedge') || POSITION_RULES[0]!;
  }
  const matched = POSITION_RULES
    .filter((rule) => rule.id !== 'hedge')
    .slice()
    .sort((a, b) => b.minConviction - a.minConviction)
    .find((rule) => conviction >= rule.minConviction && falsePositiveRisk <= rule.maxFalsePositiveRisk);
  return matched || POSITION_RULES[0]!;
}
