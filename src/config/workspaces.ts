import { SITE_VARIANT } from './variant';

export type WorkspaceId =
  | 'signals'
  | 'brief'
  | 'watch'
  | 'validate'
  | 'operate';

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

const LEGACY_WORKSPACE_ALIASES: Record<string, WorkspaceId> = {
  overview: 'signals',
  intelligence: 'brief',
  investing: 'validate',
  builders: 'signals',
  operations: 'operate',
  progress: 'watch',
  all: 'signals',
};

const WORKSPACES: WorkspaceDefinition[] = [
  {
    id: 'signals',
    label: 'Signals',
    title: 'Signals Workspace',
    description: 'Start from the ranked live signal, not raw category feeds or map overlays.',
    eyebrow: 'Signal Loop',
    heroTitle: 'See the live signal, the explanation, and the next move in one place.',
    heroSummary: 'This surface compresses live intake, operator framing, and the current regime into a single signal-first workspace.',
    flowSteps: [
      { label: 'Detect', summary: 'Rank the live field by severity, confidence, and signal quality.' },
      { label: 'Explain', summary: 'Keep the reason, sources, and linked theme attached to the signal.' },
      { label: 'Act', summary: 'Move directly into follow, brief, or validation without opening a second product.' },
    ],
    focusAreas: ['Priority signals', 'Live explanation', 'Next action'],
    showMap: false,
    panelKeys: [
      'live-news',
      'insights',
      'event-intelligence',
      'strategic-posture',
      'strategic-risk',
      'cii',
      'macro-signals',
      'signal-ridgeline',
      'transmission-sankey',
      'investment-workflow',
      'investment-ideas',
      'monitors',
    ],
    featuredPanels: ['live-news', 'event-intelligence', 'insights', 'macro-signals'],
  },
  {
    id: 'brief',
    label: 'Brief',
    title: 'Brief Workspace',
    description: 'Open the evidence stack behind a selected signal, theme, country, or region.',
    eyebrow: 'Signal Brief',
    heroTitle: 'Translate live movement into a readable, evidence-backed brief.',
    heroSummary: 'The brief surface joins event interpretation, theme context, country stress, and impact evidence.',
    flowSteps: [
      { label: 'Open', summary: 'Select a live signal, theme, or country and pull the brief into focus.' },
      { label: 'Trace', summary: 'Walk through posture, transmission, exposure, and evidence provenance.' },
      { label: 'Escalate', summary: 'Save the signal to watch or route it into validation when it matters.' },
    ],
    focusAreas: ['Theme context', 'Country lens', 'Evidence quality'],
    showMap: true,
    panelKeys: [
      'insights',
      'event-intelligence',
      'strategic-posture',
      'strategic-risk',
      'cii',
      'cascade',
      'gdelt-intel',
      'satellite-fires',
      'ucdp-events',
      'displacement',
      'climate',
      'population-exposure',
      'cross-asset-tape',
      'country-exposure-matrix',
      'signal-ridgeline',
      'transmission-sankey',
    ],
    featuredPanels: ['event-intelligence', 'strategic-posture', 'strategic-risk', 'cii'],
  },
  {
    id: 'watch',
    label: 'Watch',
    title: 'Watch Workspace',
    description: 'Track followed themes, alerts, operators notes, and saved decision context over time.',
    eyebrow: 'Follow Through',
    heroTitle: 'Keep durable themes and saved signals in an active watch loop.',
    heroSummary: 'This surface is for persistent follow-up: watched themes, structural alerts, saved ideas, and operator state changes.',
    flowSteps: [
      { label: 'Track', summary: 'Keep saved signals, themes, and countries in one watch queue.' },
      { label: 'Review', summary: 'Read deltas, alerts, and follow-up context without reopening the raw field.' },
      { label: 'Promote', summary: 'Escalate watched items into validation only when they cross a clear threshold.' },
    ],
    focusAreas: ['Saved themes', 'Alerts', 'Watchpoints'],
    showMap: false,
    panelKeys: [
      'monitors',
      'event-intelligence',
      'investment-workflow',
      'investment-ideas',
      'signal-ridgeline',
      'transmission-sankey',
    ],
    featuredPanels: ['monitors', 'investment-workflow', 'investment-ideas', 'event-intelligence'],
  },
  {
    id: 'validate',
    label: 'Validate',
    title: 'Validate Workspace',
    description: 'Use replay and validation only after the signal has been framed and selected.',
    eyebrow: 'Validation',
    heroTitle: 'Validate the signal after the brief is clear, not before.',
    heroSummary: 'This surface keeps replay, cross-asset confirmation, and candidate review in one advanced workspace.',
    flowSteps: [
      { label: 'Select', summary: 'Carry a chosen signal or theme into validation without losing context.' },
      { label: 'Verify', summary: 'Check replay behavior, exposure, and confirmation before escalating.' },
      { label: 'Decide', summary: 'Return the result to the brief or watch loop with an explicit outcome.' },
    ],
    focusAreas: ['Replay', 'Exposure', 'Candidate review'],
    showMap: false,
    panelKeys: [
      'backtest-lab',
      'macro-signals',
      'cross-asset-tape',
      'event-impact-screener',
      'country-exposure-matrix',
      'investment-workflow',
      'investment-ideas',
      'signal-ridgeline',
      'transmission-sankey',
      'event-intelligence',
      'markets',
      'commodities',
      'crypto',
      'economic',
      'heatmap',
      'etf-flows',
      'stablecoins',
      'polymarket',
    ],
    featuredPanels: ['backtest-lab', 'investment-workflow', 'investment-ideas', 'macro-signals'],
  },
  {
    id: 'operate',
    label: 'Operate',
    title: 'Operate Workspace',
    description: 'Run the data and service layer without mixing it into the main operator surface.',
    eyebrow: 'Operations',
    heroTitle: 'Keep the machine healthy without turning the whole product into a cockpit.',
    heroSummary: 'This workspace is reserved for data quality, automation health, runtime state, and diagnostics.',
    flowSteps: [
      { label: 'Inspect', summary: 'Read freshness, source quality, and runtime health in one pass.' },
      { label: 'Recover', summary: 'Fix blockers before they degrade signals, briefs, or validation.' },
      { label: 'Sustain', summary: 'Keep operations separate from the signal-analysis experience.' },
    ],
    focusAreas: ['Data health', 'Automation', 'Runtime'],
    showMap: false,
    panelKeys: [
      'dataflow-ops',
      'codex-ops',
      'data-qa',
      'source-ops',
      'runtime-config',
      'resource-profiler',
      'service-status',
      'tech-readiness',
      'backtest-lab',
    ],
    featuredPanels: ['dataflow-ops', 'source-ops', 'runtime-config', 'resource-profiler'],
  },
];

const FALLBACK_WORKSPACE: WorkspaceDefinition = {
  id: 'signals',
  label: 'Signals',
  title: 'Signals Workspace',
  description: 'Keep the live signal, the brief, and the next action on one surface.',
  eyebrow: 'Signal Loop',
  heroTitle: 'Turn raw motion into a clear next move.',
  heroSummary: 'Keep the signal, the brief, and the follow-up action on one surface.',
  flowSteps: [
    { label: 'Detect', summary: 'Read the live field.' },
    { label: 'Explain', summary: 'Open the brief.' },
    { label: 'Act', summary: 'Choose the next action.' },
  ],
  focusAreas: ['Live signal', 'Brief', 'Action'],
  showMap: false,
  panelKeys: [],
  featuredPanels: [],
};

export function isWorkspaceId(value: string | null | undefined): value is WorkspaceId {
  return value === 'signals'
    || value === 'brief'
    || value === 'watch'
    || value === 'validate'
    || value === 'operate';
}

export function resolveWorkspaceId(
  id?: string | null,
  variant: string = SITE_VARIANT,
): WorkspaceId {
  const normalized = String(id || '').trim().toLowerCase();
  const candidate = isWorkspaceId(normalized)
    ? normalized
    : LEGACY_WORKSPACE_ALIASES[normalized] ?? null;

  if (candidate) {
    const found = WORKSPACES.find((workspace) =>
      workspace.id === candidate && (!workspace.variants || workspace.variants.includes(variant)));
    if (found) return found.id;
  }

  const signals = WORKSPACES.find((workspace) =>
    workspace.id === 'signals' && (!workspace.variants || workspace.variants.includes(variant)));
  return signals?.id ?? FALLBACK_WORKSPACE.id;
}

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
  const resolvedId = resolveWorkspaceId(id, variant);
  const found = definitions.find((workspace) => workspace.id === resolvedId);
  return found ?? definitions[0] ?? FALLBACK_WORKSPACE;
}
