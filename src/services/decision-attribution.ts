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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  const corroboration = clamp(args.corroborationQuality / 100, 0, 1);
  const recentEvidence = clamp(args.recentEvidenceScore / 100, 0, 1);
  const reality = clamp(args.realityScore / 100, 0, 1);
  const graph = clamp(args.graphSignalScore / 100, 0, 1);
  const transferEntropy = clamp(args.transferEntropy, 0, 1);
  const bandit = clamp((args.banditScore + 1.5) / 3, 0, 1);
  const regime = clamp((args.regimeMultiplier - 1) / 0.5, -1, 1);
  const contradiction = clamp(args.contradictionPenalty / 30, 0, 1);
  const falsePositive = clamp(args.falsePositiveRisk / 100, 0, 1);
  const components: AttributionComponent[] = [
    {
      key: 'corroboration',
      label: 'Cross-source corroboration',
      contribution: round((corroboration - 0.5) * 22),
      explanation: 'Measures whether multiple sources agree on the event with sufficient diversity.',
    },
    {
      key: 'recentEvidence',
      label: 'Recent evidence',
      contribution: round((recentEvidence - 0.5) * 16 - args.stalePenalty * 0.25),
      explanation: 'Rewards fresh realized samples and penalizes stale priors.',
    },
    {
      key: 'reality',
      label: 'Execution reality',
      contribution: round((reality - 0.5) * 18),
      explanation: 'Rewards liquid, tradable setups and penalizes spread/slippage friction.',
    },
    {
      key: 'regime',
      label: 'Macro regime fit',
      contribution: round(regime * 14 - args.macroPenalty * 0.35),
      explanation: 'Measures whether the idea fits the active top-down market regime and kill-switch state.',
    },
    {
      key: 'graph',
      label: 'Graph propagation',
      contribution: round((graph - 0.5) * 14),
      explanation: 'Rewards multi-hop propagation support across entities, sectors, and transmission edges.',
    },
    {
      key: 'learning',
      label: 'Adaptive learning',
      contribution: round((transferEntropy - 0.4) * 10 + (bandit - 0.5) * 10),
      explanation: 'Combines transmission lead-lag structure with bandit exploration/exploitation confidence.',
    },
    {
      key: 'contradiction',
      label: 'Contradiction penalty',
      contribution: round(-(contradiction * 16 + falsePositive * 12)),
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
