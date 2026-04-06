import { SITE_VARIANT } from './variant';

export type WorkspaceId =
  | 'overview'
  | 'intelligence'
  | 'investing'
  | 'builders'
  | 'operations'
  | 'progress'
  | 'all';

export interface WorkspaceFlowStep {
  label: string;
  summary: string;
}

export interface WorkspaceDefinition {
  id: WorkspaceId;
  label: string;
  title: string;
  description: string;
  eyebrow: string;
  heroTitle: string;
  heroSummary: string;
  flowSteps: WorkspaceFlowStep[];
  focusAreas: string[];
  showMap: boolean;
  panelKeys: string[];
  featuredPanels: string[];
  variants?: string[];
}

export const WORKSPACE_STORAGE_KEY = 'lattice-current-workspace';
export const LEGACY_WORKSPACE_STORAGE_KEY = 'worldmonitor-workspace';

const WORKSPACES: WorkspaceDefinition[] = [
  {
    id: 'overview',
    label: 'Live',
    title: 'Live Workspace',
    description: 'Start from prioritized headlines, the current pressure stack, and the next decision instead of raw feed overload.',
    eyebrow: 'Daily Loop',
    heroTitle: 'Start with the signal that matters, not every feed at once.',
    heroSummary: 'This lens keeps prioritized signals, posture, and the next operator decision on one surface.',
    flowSteps: [
      { label: 'Observe', summary: 'Prioritized headlines, map context, and posture shifts stay together.' },
      { label: 'Explain', summary: 'Event intelligence, source quality, and transmission context stay attached.' },
      { label: 'Act', summary: 'Decision support stays in the same loop, with replay kept as validation only.' },
    ],
    focusAreas: ['Priority signals', 'Briefing loop', 'Decision support'],
    showMap: true,
    panelKeys: [
      'live-news',
      'politics',
      'intel',
      'insights',
      'event-intelligence',
      'strategic-posture',
      'strategic-risk',
      'macro-signals',
      'signal-ridgeline',
      'transmission-sankey',
      'cross-asset-tape',
      'investment-workflow',
      'investment-ideas',
      'dataflow-ops',
      'source-ops',
      'monitors',
      'giving',
      'positive-feed',
      'progress',
      'spotlight',
      'digest',
      'counters',
    ],
    featuredPanels: ['live-news', 'insights', 'event-intelligence', 'macro-signals'],
  },
  {
    id: 'intelligence',
    label: 'Briefing',
    title: 'Briefing Workspace',
    description: 'Follow posture shifts, country risk, and the evidence stack behind emerging pressure.',
    eyebrow: 'Briefing',
    heroTitle: 'Translate noisy events into a readable pressure stack.',
    heroSummary: 'This workspace prioritizes escalation, transmission, and source quality over raw headline volume.',
    flowSteps: [
      { label: 'Filter', summary: 'Compress raw events into posture, clusters, and risk bearings.' },
      { label: 'Trace', summary: 'Follow transmission paths, country risk, and evidence quality.' },
      { label: 'Escalate', summary: 'Promote only the most material theaters into the operator view.' },
    ],
    focusAreas: ['Country risk', 'Transmission paths', 'Source quality'],
    showMap: true,
    panelKeys: [
      'strategic-posture',
      'strategic-risk',
      'cii',
      'intel',
      'glint-feed',
      'gdelt-intel',
      'event-intelligence',
      'cascade',
      'politics',
      'us',
      'europe',
      'middleeast',
      'africa',
      'latam',
      'asia',
      'energy',
      'gov',
      'thinktanks',
      'satellite-fires',
      'ucdp-events',
      'displacement',
      'climate',
      'population-exposure',
      'transmission-sankey',
      'signal-ridgeline',
      'source-ops',
    ],
    featuredPanels: ['strategic-posture', 'strategic-risk', 'event-intelligence', 'gdelt-intel'],
    variants: ['full', 'finance', 'tech'],
  },
  {
    id: 'investing',
    label: 'Decide',
    title: 'Decision Workspace',
    description: 'Put macro pressure, signal candidates, and replay validation on one canvas.',
    eyebrow: 'Decision Support',
    heroTitle: 'Compare live regime pressure with validated signal context before taking action.',
    heroSummary: 'The product here is the decision loop from regime read to signal candidate to validation, not raw backtest output.',
    flowSteps: [
      { label: 'Screen', summary: 'Rank current signal candidates against macro and live confirmation.' },
      { label: 'Validate', summary: 'Use replay validation only after the live signal has been framed.' },
      { label: 'Decide', summary: 'Translate evidence into constraints, watch states, and next actions.' },
    ],
    focusAreas: ['Macro regime', 'Signal candidates', 'Validation context'],
    showMap: true,
    panelKeys: [
      'markets',
      'markets-news',
      'commodities',
      'commodities-news',
      'economic',
      'economic-news',
      'forex',
      'bonds',
      'centralbanks',
      'trade-policy',
      'supply-chain',
      'finance',
      'crypto',
      'crypto-news',
      'fintech',
      'cross-asset-tape',
      'event-impact-screener',
      'country-exposure-matrix',
      'event-intelligence',
      'investment-workflow',
      'investment-ideas',
      'macro-signals',
      'signal-ridgeline',
      'transmission-sankey',
      'etf-flows',
      'stablecoins',
      'heatmap',
      'analysis',
      'polymarket',
      'gcc-investments',
      'gccNews',
      'dataflow-ops',
      'source-ops',
      'backtest-lab',
      'resource-profiler',
    ],
    featuredPanels: ['macro-signals', 'event-intelligence', 'investment-workflow', 'investment-ideas'],
    variants: ['full', 'finance', 'tech'],
  },
  {
    id: 'builders',
    label: 'Build',
    title: 'Builder Workspace',
    description: 'Track AI, cyber, policy, and startup motion from the build side of the system.',
    eyebrow: 'Build Radar',
    heroTitle: 'Track product, infrastructure, security, and policy from the builder side.',
    heroSummary: 'Instead of a global monitor, this workspace behaves like a build radar for technical operators and founders.',
    flowSteps: [
      { label: 'Scan', summary: 'Follow AI, infra, security, and startup motion in one field.' },
      { label: 'Validate', summary: 'Cross-check product narratives against signals and service health.' },
      { label: 'Ship', summary: 'Keep research and operational diagnostics close to the same workspace.' },
    ],
    focusAreas: ['AI stack', 'Security drift', 'Shipping velocity'],
    showMap: true,
    panelKeys: [
      'tech',
      'ai',
      'startups',
      'vcblogs',
      'regionalStartups',
      'unicorns',
      'accelerators',
      'funding',
      'producthunt',
      'github',
      'events',
      'security',
      'policy',
      'regulation',
      'hardware',
      'cloud',
      'dev',
      'service-status',
      'tech-readiness',
      'layoffs',
      'ipo',
    ],
    featuredPanels: ['ai', 'tech', 'security', 'tech-readiness'],
    variants: ['full', 'tech'],
  },
  {
    id: 'operations',
    label: 'Operate',
    title: 'Operations Workspace',
    description: 'Work the machine itself: data freshness, automation, runtime health, source quality, and validation.',
    eyebrow: 'Operations',
    heroTitle: 'Run the machine with clarity, not dashboard clutter.',
    heroSummary: 'This workspace treats the service as a living pipeline: data quality, automation state, runtime health, and replay trust.',
    flowSteps: [
      { label: 'Inspect', summary: 'Read freshness, lag, coverage, and runtime health in one pass.' },
      { label: 'Recover', summary: 'Fix blockers before they leak into live signal and decision support.' },
      { label: 'Sustain', summary: 'Keep automation and validation healthy without leaving the workspace.' },
    ],
    focusAreas: ['Coverage health', 'Automation loops', 'Runtime stability'],
    showMap: false,
    panelKeys: [
      'dataflow-ops',
      'codex-ops',
      'data-qa',
      'source-ops',
      'runtime-config',
      'backtest-lab',
      'resource-profiler',
      'service-status',
      'tech-readiness',
      'macro-signals',
      'investment-workflow',
    ],
    featuredPanels: ['dataflow-ops', 'source-ops', 'runtime-config', 'resource-profiler'],
  },
  {
    id: 'progress',
    label: 'Progress',
    title: 'Long Horizon Workspace',
    description: 'Surface resilience, progress, and constructive signals that compound over time.',
    eyebrow: 'Long Horizon',
    heroTitle: 'Watch what compounds instead of only what breaks.',
    heroSummary: 'This lens favors resilience, durable progress, and constructive patterns that matter over longer arcs.',
    flowSteps: [
      { label: 'Notice', summary: 'Pull positive and resilient signals into one clean stream.' },
      { label: 'Connect', summary: 'Link progress metrics, stories, and durable trend lines.' },
      { label: 'Carry', summary: 'Keep a calmer operating surface for longer-horizon work.' },
    ],
    focusAreas: ['Resilience', 'Positive compounding', 'Long-horizon context'],
    showMap: true,
    panelKeys: [
      'positive-feed',
      'progress',
      'counters',
      'spotlight',
      'breakthroughs',
      'digest',
      'species',
      'renewable',
      'giving',
    ],
    featuredPanels: ['positive-feed', 'progress', 'spotlight', 'renewable'],
    variants: ['happy'],
  },
  {
    id: 'all',
    label: 'Canvas',
    title: 'Open Canvas',
    description: 'Expose the full lattice exactly as configured, without focus filtering.',
    eyebrow: 'Open Canvas',
    heroTitle: 'Move across the full lattice without workspace filtering.',
    heroSummary: 'Use this view when you want every pane, every domain, and the entire service surface in one place.',
    flowSteps: [
      { label: 'Survey', summary: 'Expose the full configured surface without opinionated narrowing.' },
      { label: 'Cross', summary: 'Jump across markets, briefing, graph, and operations fluidly.' },
      { label: 'Compose', summary: 'Build your own working layout on top of the entire lattice.' },
    ],
    focusAreas: ['Free exploration', 'Cross-domain joins', 'Operator shortcuts'],
    showMap: true,
    panelKeys: [],
    featuredPanels: ['live-news', 'event-intelligence', 'macro-signals', 'dataflow-ops'],
  },
];

const FALLBACK_WORKSPACE: WorkspaceDefinition = {
  id: 'overview',
  label: 'Live',
  title: 'Live Workspace',
  description: 'Keep the live pulse, the latest brief, and the next action on one surface.',
  eyebrow: 'Daily Loop',
  heroTitle: 'Turn raw motion into a clear next move.',
  heroSummary: 'Keep the field, the brief, and the next action on one surface.',
  flowSteps: [
    { label: 'Observe', summary: 'Track the live field.' },
    { label: 'Explain', summary: 'Open the brief.' },
    { label: 'Act', summary: 'Follow the next action.' },
  ],
  focusAreas: ['Live pulse', 'Briefing loop', 'Decision support'],
  showMap: true,
  panelKeys: [],
  featuredPanels: [],
};

export function getWorkspaceDefinitions(variant: string = SITE_VARIANT): WorkspaceDefinition[] {
  return WORKSPACES.filter((workspace) => !workspace.variants || workspace.variants.includes(variant));
}

export function getWorkspaceDefinition(
  id?: string | null,
  variant: string = SITE_VARIANT,
): WorkspaceDefinition {
  const definitions = getWorkspaceDefinitions(variant);
  if (definitions.length === 0) {
    return FALLBACK_WORKSPACE;
  }
  if (id) {
    const found = definitions.find((workspace) => workspace.id === id);
    if (found) return found;
  }
  const overview = definitions.find((workspace) => workspace.id === 'overview');
  return overview ?? definitions[0] ?? FALLBACK_WORKSPACE;
}
