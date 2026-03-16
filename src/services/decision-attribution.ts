export interface AttributionComponent {
  key: string;
  label: string;
  contribution: number;
  explanation: string;
}

export interface IdeaAttributionBreakdown {
  primaryDriver: string;
  primaryPenalty: string;
  components: AttributionComponent[];
  narrative: string;
  failureModes: string[];
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function sortComponents(components: AttributionComponent[]): AttributionComponent[] {
  return components.slice().sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

export function buildIdeaAttribution(args: {
  themeLabel: string;
  symbol: string;
  corroborationQuality: number;
  contradictionPenalty: number;
  recentEvidenceScore: number;
  stalePenalty: number;
  realityScore: number;
  transferEntropy: number;
  banditScore: number;
  graphSignalScore: number;
  regimeMultiplier: number;
  macroPenalty: number;
  falsePositiveRisk: number;
  marketMovePct: number | null;
}): IdeaAttributionBreakdown {
  const components: AttributionComponent[] = [
    {
      key: 'corroboration',
      label: 'Cross-source corroboration',
      contribution: round((args.corroborationQuality - 50) * 0.28),
      explanation: 'Measures whether multiple sources agree on the event with sufficient diversity.',
    },
    {
      key: 'recentEvidence',
      label: 'Recent evidence',
      contribution: round((args.recentEvidenceScore - 50) * 0.22 - args.stalePenalty * 0.35),
      explanation: 'Rewards fresh realized samples and penalizes stale priors.',
    },
    {
      key: 'reality',
      label: 'Execution reality',
      contribution: round((args.realityScore - 50) * 0.24),
      explanation: 'Rewards liquid, tradable setups and penalizes spread/slippage friction.',
    },
    {
      key: 'regime',
      label: 'Macro regime fit',
      contribution: round((args.regimeMultiplier - 1) * 22 - args.macroPenalty * 0.45),
      explanation: 'Measures whether the idea fits the active top-down market regime and kill-switch state.',
    },
    {
      key: 'graph',
      label: 'Graph propagation',
      contribution: round((args.graphSignalScore - 50) * 0.18),
      explanation: 'Rewards multi-hop propagation support across entities, sectors, and transmission edges.',
    },
    {
      key: 'learning',
      label: 'Adaptive learning',
      contribution: round(args.transferEntropy * 12 + args.banditScore * 3.5),
      explanation: 'Combines transmission lead-lag structure with bandit exploration/exploitation confidence.',
    },
    {
      key: 'contradiction',
      label: 'Contradiction penalty',
      contribution: round(-args.contradictionPenalty * 0.7 - args.falsePositiveRisk * 0.18),
      explanation: 'Penalizes conflicting headlines, rumor language, and false-positive risk.',
    },
    {
      key: 'beta',
      label: 'Market beta drift',
      contribution: round((args.marketMovePct || 0) * 0.65),
      explanation: 'Captures whether the asset is already moving with or against the proposed thesis.',
    },
  ];

  const sorted = sortComponents(components);
  const primaryDriver = sorted.find((component) => component.contribution > 0)?.label || 'No positive driver dominated';
  const primaryPenalty = sorted.slice().reverse().find((component) => component.contribution < 0)?.label || 'No major penalty dominated';
  const positiveDrivers = sorted.filter((component) => component.contribution > 0).slice(0, 2).map((component) => component.label.toLowerCase());
  const negativeDrivers = sorted.filter((component) => component.contribution < 0).slice(0, 2).map((component) => component.label.toLowerCase());
  const failureModes = [
    args.falsePositiveRisk >= 40 ? 'False-positive risk is still elevated.' : '',
    args.realityScore < 45 ? 'Execution frictions can erase most of the raw edge.' : '',
    args.recentEvidenceScore < 36 ? 'Recent evidence is too thin for confident live deployment.' : '',
    args.contradictionPenalty >= 12 ? 'Contradictory reporting remains unresolved.' : '',
    args.macroPenalty >= 12 ? 'Top-down macro overlay is actively suppressing this idea.' : '',
  ].filter(Boolean);

  return {
    primaryDriver,
    primaryPenalty,
    components: sorted,
    narrative: `${args.themeLabel} / ${args.symbol} leans on ${positiveDrivers.join(' and ') || 'limited support'}, while ${negativeDrivers.join(' and ') || 'few penalties'} is holding confidence back.`,
    failureModes,
  };
}
