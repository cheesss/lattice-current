import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { DatasetProposal, DatasetDiscoveryThemeInput } from '../dataset-discovery';
import type { ProposalEvidenceBundle } from './proposal-evidence-builder';
import { ALLOWED_BACKFILL_SOURCES, validateBackfillArgs } from '../../../scripts/_shared/backfill-whitelist.mjs';

interface CodexExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

const CODEX_TIMEOUT_MS = 95_000;

function buildExecArgs(prompt: string): string[] {
  const args = ['exec'];
  if (process.env.CODEX_MODEL?.trim()) args.push('--model', process.env.CODEX_MODEL.trim());
  void prompt;
  args.push('--json', '--skip-git-repo-check', '--sandbox', 'read-only', '--full-auto');
  return args;
}

function getSafeEnv(): NodeJS.ProcessEnv {
  const keys = [
    'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
    'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
    'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'CODEX_HOME', 'HTTPS_PROXY',
    'HTTP_PROXY', 'NO_PROXY', 'LANG', 'TERM', 'CODEX_MODEL', 'CODEX_BIN',
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) if (process.env[key]) env[key] = process.env[key];
  return env;
}

function isCodexLoggedIn(outputText: string): boolean {
  return /logged in/i.test(String(outputText || ''));
}

async function resolveCodexCommand(): Promise<string> {
  if (process.env.CODEX_BIN?.trim() && existsSync(process.env.CODEX_BIN.trim())) return process.env.CODEX_BIN.trim();
  const userHome = process.env.USERPROFILE || os.homedir();
  const appData = process.env.APPDATA || path.join(userHome, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(userHome, 'AppData', 'Local');
  const candidates = [
    path.join(localAppData, 'Programs', 'OpenAI', 'codex', 'codex.exe'),
    path.join(appData, 'npm', 'codex.cmd'),
    path.join(appData, 'npm', 'codex'),
  ];
  const vscodeExtRoot = path.join(userHome, '.vscode', 'extensions');
  if (existsSync(vscodeExtRoot)) {
    try {
      const entries = await readdir(vscodeExtRoot, { withFileTypes: true });
      for (const entry of entries.filter((item) => item.isDirectory() && item.name.startsWith('openai.chatgpt-')).sort((a, b) => b.name.localeCompare(a.name))) {
        candidates.unshift(path.join(vscodeExtRoot, entry.name, 'bin', 'windows-x86_64', 'codex.exe'));
      }
    } catch {
      // ignore
    }
  }
  return candidates.find((candidate) => existsSync(candidate)) || 'codex';
}

async function runCodexCli(args: string[], timeoutMs = CODEX_TIMEOUT_MS): Promise<CodexExecResult> {
  const command = await resolveCodexCommand();
  const useStdinPrompt = args[0] === 'exec' && args.includes('--full-auto');
  const prompt = useStdinPrompt ? String(args[args.length - 1] ?? '') : '';
  const spawnArgs = useStdinPrompt ? args.slice(0, -1) : args;
  return new Promise((resolve) => {
    const child = spawn(command, spawnArgs, {
      cwd: process.cwd(),
      env: getSafeEnv(),
      stdio: [useStdinPrompt ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    if (useStdinPrompt) {
      child.stdin?.write(prompt);
      child.stdin?.end();
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: Number(code ?? 1), stdout, stderr });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}`.trim() });
    });
  });
}

function parseCodexJsonOutput(stdout: string): string {
  let lastAgentMessage = '';
  for (const rawLine of String(stdout || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed?.type === 'item.completed' && parsed?.item?.type === 'agent_message' && typeof parsed.item.text === 'string') {
        lastAgentMessage = parsed.item.text.trim();
      }
    } catch {
      // ignore
    }
  }
  return lastAgentMessage;
}

function parseJsonObject(rawText: string): Record<string, unknown> | null {
  const text = String(rawText || '').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        const parsed = JSON.parse(fenced[1].trim());
        return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export interface BackfillCurationAction {
  type: 'backfill-source' | 'add-rss' | 'add-theme';
  source?: string;
  args?: Record<string, unknown>;
  reason: string;
  priority?: 'high' | 'medium' | 'low';
  expectedImpact?: string;
  url?: string;
  name?: string;
  theme?: string;
  relationType?: string;
  transmissionOrder?: string;
  transmissionPath?: string;
}

export interface BackfillCurationContext {
  stats: {
    totalArticles: number;
    sourcesBreakdown: Record<string, number>;
    recentTopics: number;
    unknownRate?: number;
  };
  budgets: {
    daily?: Record<string, { remaining?: number }>;
  };
  topics: Array<{
    id: string;
    label: string;
    category: string;
    articleCount: number;
  }>;
  weakAreas: string[];
}

export interface BackfillCurationPlan {
  diagnosis: string;
  actions: BackfillCurationAction[];
}

function buildPrompt(theme: DatasetDiscoveryThemeInput, evidence?: ProposalEvidenceBundle | null): string {
  return [
    'You are a historical dataset planner for macro and geopolitical replay.',
    'Your job is to decide which missing historical datasets would materially improve replay coverage for this theme.',
    '',
    'Analyze in this order:',
    '1. What evidence is still missing: macro, conflict/event, market proxy, commodity linkage, policy layer, logistics, funding, or adjacent second-order signals?',
    '2. What direct and indirect transmission paths would make this theme more explainable if additional history were fetched?',
    '3. Which of the allowed providers best fills that direct or indirect evidence gap?',
    '4. What exact fetch arguments would keep the dataset narrow, relevant, and point-in-time safe?',
    '5. Which proposals are high-signal enough to justify ingestion now?',
    '',
    'Rules:',
    '- Use only providers: fred, alfred, gdelt-doc, coingecko, acled.',
    '- Prefer fewer, higher-signal proposals over broad noisy coverage.',
    '- Do not propose datasets that duplicate what the theme already clearly has.',
    '- It is valid to recommend an indirect or adjacent dataset if it explains a credible second-order or third-order transmission path.',
    '- Good adjacent examples include supply chain strain, power demand, insurance pricing, export controls, logistics bottlenecks, financing conditions, labor or capex proxies.',
    '- Every proposal must include a concrete rationale and query summary.',
    '- If no proposal is justified, return an empty proposals array.',
    '',
    'Output rules:',
    '- Return strict JSON only. No markdown.',
    '- The response must match this schema exactly.',
    '',
    'JSON schema:',
    '{ "proposals": [ { "id": "...", "label": "...", "provider": "gdelt-doc", "confidence": 0-100, "rationale": "what gap this closes and why", "querySummary": "what will be fetched", "relationType": "direct|adjacent|second-order|third-order", "transmissionPath": "one short sentence describing the mechanism", "fetchArgs": { } } ] }',
    `Theme: ${theme.label}`,
    `Triggers: ${theme.triggers.join(', ') || '(none)'}`,
    `Sectors: ${theme.sectors.join(', ') || '(none)'}`,
    `Commodities: ${theme.commodities.join(', ') || '(none)'}`,
    `Headlines: ${(theme.supportingHeadlines || []).slice(0, 4).join(' || ') || '(none)'}`,
    `Suggested symbols: ${(theme.suggestedSymbols || []).join(', ') || '(none)'}`,
    evidence?.summary ? `Evidence summary: ${evidence.summary}` : '',
    evidence?.historicalAnalogs?.length
      ? `Historical analogs:\n${evidence.historicalAnalogs.map((row) => `- ${row}`).join('\n')}`
      : '',
    evidence?.weaknessSignals?.length
      ? `Weakness signals:\n${evidence.weaknessSignals.map((row) => `- ${row}`).join('\n')}`
      : '',
    evidence?.coverageSignals?.length
      ? `Coverage signals:\n${evidence.coverageSignals.map((row) => `- ${row}`).join('\n')}`
      : '',
  ].join('\n');
}

function buildBackfillPrompt(context: BackfillCurationContext): string {
  const whitelist = (Object.entries(ALLOWED_BACKFILL_SOURCES) as Array<[string, { args?: Record<string, { max?: number }>; minIntervalHours: number }]>)
    .map(([name, config]) => `- ${name}: max ${(config.args?.limit as { max?: number } | undefined)?.max || 'n/a'} items, min interval ${config.minIntervalHours}h`)
    .join('\n');
  return [
    'You are a signal-first corpus curator for emerging technology discovery.',
    'Your job is to decide whether the corpus needs more history, more source diversity, or a new theme action.',
    '',
    'Analyze in this order:',
    '1. What is weak right now: corpus volume, source diversity, topic discovery quality, or category coverage?',
    '2. Which action type best fixes that weakness: backfill-source, add-rss, or add-theme?',
    '3. Which direct, adjacent, second-order, or third-order evidence lanes are missing?',
    '4. Is the action narrow and concrete enough to execute safely?',
    '',
    'Rules:',
    '- Maximum 3 actions.',
    '- Prefer backfill-source when historical coverage is weak.',
    '- Use add-rss for targeted direct coverage or adjacent evidence coverage when it supports a credible indirect transmission path.',
    '- Use add-theme only when a structurally distinct theme is repeatedly visible, even if the investable angle is second-order or third-order rather than headline-direct.',
    '- It is valid to recommend non-obvious but credibly linked sources around supply chains, policy, insurance, logistics, financing, power, or labor if they improve explanatory depth.',
    '- Do not exceed budget.',
    '- Every action must include a concrete reason and expected impact.',
    '- If no action is justified, return an empty actions array.',
    '',
    'Output rules:',
    '- Return strict JSON only. No markdown.',
    '- The response must match this schema exactly.',
    '',
    'JSON schema:',
    '{ "diagnosis": "string", "actions": [ { "type": "backfill-source" | "add-rss" | "add-theme", "source": "string", "args": {}, "reason": "string", "priority": "high|medium|low", "expectedImpact": "string", "relationType": "direct|adjacent|second-order|third-order", "transmissionPath": "one short sentence describing the missing evidence lane" } ] }',
    `Corpus total articles: ${context.stats.totalArticles}`,
    `Sources: ${JSON.stringify(context.stats.sourcesBreakdown)}`,
    `Recent topics (30d): ${context.stats.recentTopics}`,
    `Unknown rate: ${Number(context.stats.unknownRate || 0).toFixed(3)}`,
    `Weak areas: ${(context.weakAreas || []).join(', ') || '(none)'}`,
    `Topic snapshot: ${(context.topics || []).slice(0, 12).map((topic) => `${topic.label}:${topic.articleCount}`).join(' | ') || '(none)'}`,
    `Remaining daily budget: ${JSON.stringify(context.budgets?.daily || {})}`,
    'Allowed backfill sources:',
    whitelist,
  ].join('\n');
}

function normalizeBackfillAction(raw: Record<string, unknown>): BackfillCurationAction | null {
  const type = String(raw.type || '').trim();
  if (type === 'backfill-source') {
    const source = String(raw.source || '').trim().toLowerCase();
    const args = raw.args && typeof raw.args === 'object' ? raw.args as Record<string, unknown> : {};
    const validated = validateBackfillArgs(source, args);
    if (!validated.ok) return null;
    return {
      type: 'backfill-source',
      source,
      args: validated.value,
      reason: String(raw.reason || 'backfill coverage gap').trim() || 'backfill coverage gap',
      priority: String(raw.priority || 'medium').trim() as BackfillCurationAction['priority'],
      expectedImpact: String(raw.expectedImpact || '').trim() || undefined,
      relationType: String(raw.relationType || '').trim().toLowerCase() || undefined,
      transmissionPath: String(raw.transmissionPath || '').trim() || undefined,
    };
  }
  if (type === 'add-rss') {
    const url = String(raw.url || '').trim();
    if (!url) return null;
    return {
      type: 'add-rss',
      url,
      name: String(raw.name || '').trim() || undefined,
      theme: String(raw.theme || '').trim() || undefined,
      reason: String(raw.reason || 'add rss coverage').trim() || 'add rss coverage',
      priority: String(raw.priority || 'medium').trim() as BackfillCurationAction['priority'],
      expectedImpact: String(raw.expectedImpact || '').trim() || undefined,
      relationType: String(raw.relationType || '').trim().toLowerCase() || undefined,
      transmissionPath: String(raw.transmissionPath || '').trim() || undefined,
    };
  }
  if (type === 'add-theme') {
    return {
      type: 'add-theme',
      name: String(raw.name || raw.id || '').trim() || undefined,
      theme: String(raw.theme || raw.id || '').trim() || undefined,
      reason: String(raw.reason || 'add theme coverage').trim() || 'add theme coverage',
      priority: String(raw.priority || 'medium').trim() as BackfillCurationAction['priority'],
      expectedImpact: String(raw.expectedImpact || '').trim() || undefined,
      relationType: String(raw.relationType || '').trim().toLowerCase() || undefined,
      transmissionPath: String(raw.transmissionPath || '').trim() || undefined,
    };
  }
  return null;
}

function buildFallbackBackfillPlan(context: BackfillCurationContext): BackfillCurationPlan {
  const actions: BackfillCurationAction[] = [];
  const remainingBackfills = Number(context.budgets?.daily?.backfillCalls?.remaining ?? 0);
  if (remainingBackfills <= 0) {
    return {
      diagnosis: 'Daily backfill budget exhausted. No automated actions proposed.',
      actions,
    };
  }

  if (context.weakAreas.includes('source-diversity') || context.weakAreas.includes('corpus-volume')) {
    actions.push({
      type: 'backfill-source',
      source: 'hackernews',
      args: { limit: 10000, minScore: 50 },
      reason: 'broaden emerging-tech source coverage with high-signal HN stories',
      priority: 'high',
      expectedImpact: 'increase source diversity and discovery candidate volume',
    });
  }
  if (context.weakAreas.some((area) => area === 'topic-discovery' || area.startsWith('category:'))) {
    actions.push({
      type: 'backfill-source',
      source: 'arxiv',
      args: { categories: ['cs.AI', 'cs.LG', 'q-bio.QM'], from: '2024-01-01', limit: 8000 },
      reason: 'strengthen research-side discovery when recent topics are sparse',
      priority: 'high',
      expectedImpact: 'raise research momentum and topic discovery breadth',
    });
  }
  if (context.weakAreas.includes('emerging-tech-coverage') && actions.length < 3) {
    actions.push({
      type: 'backfill-source',
      source: 'gdelt-articles',
      args: { keywords: ['emerging technology', 'robotics', 'semiconductor'], from: '2024-01-01', limit: 12000 },
      reason: 'fill broad global news coverage for emerging technology',
      priority: 'medium',
      expectedImpact: 'increase cross-source corroboration for new topics',
    });
  }
  return {
    diagnosis: `Fallback curation based on weak areas: ${(context.weakAreas || []).join(', ') || 'none'}`,
    actions: actions.slice(0, 3),
  };
}

export async function proposeBackfillActions(context: BackfillCurationContext): Promise<BackfillCurationPlan> {
  const fallback = buildFallbackBackfillPlan(context);
  const loginStatus = await runCodexCli(['login', 'status'], 8_000);
  if (loginStatus.code !== 0 || !isCodexLoggedIn(`${loginStatus.stdout}\n${loginStatus.stderr}`)) return fallback;

  const result = await runCodexCli(buildExecArgs(buildBackfillPrompt(context)), CODEX_TIMEOUT_MS);
  if (result.code !== 0) return fallback;

  const parsed = parseJsonObject(parseCodexJsonOutput(result.stdout || '') || result.stdout);
  if (!parsed) return fallback;
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions.map((action) => normalizeBackfillAction(action as Record<string, unknown>)).filter(Boolean) as BackfillCurationAction[]
    : [];
  return {
    diagnosis: String(parsed.diagnosis || fallback.diagnosis).trim() || fallback.diagnosis,
    actions: actions.slice(0, 3),
  };
}

export async function proposeDatasetsWithCodex(
  theme: DatasetDiscoveryThemeInput,
  evidence?: ProposalEvidenceBundle | null,
): Promise<DatasetProposal[] | null> {
  const loginStatus = await runCodexCli(['login', 'status'], 8_000);
  if (loginStatus.code !== 0 || !isCodexLoggedIn(`${loginStatus.stdout}\n${loginStatus.stderr}`)) return null;
  const result = await runCodexCli(buildExecArgs(buildPrompt(theme, evidence)), CODEX_TIMEOUT_MS);
  if (result.code !== 0) return null;
  const parsed = parseJsonObject(parseCodexJsonOutput(result.stdout || '') || result.stdout);
  if (!parsed || !Array.isArray(parsed.proposals)) return null;
  return parsed.proposals.map((row) => ({
    id: String((row as Record<string, unknown>).id || '').trim(),
    label: String((row as Record<string, unknown>).label || '').trim(),
    provider: String((row as Record<string, unknown>).provider || '').trim() as DatasetProposal['provider'],
    proposedBy: 'codex' as const,
    confidence: Math.max(25, Math.min(95, Math.round(Number((row as Record<string, unknown>).confidence) || 60))),
    proposalScore: Math.max(25, Math.min(99, Math.round(Number((row as Record<string, unknown>).confidence) || 60))),
    rationale: String((row as Record<string, unknown>).rationale || 'Codex dataset proposal').trim(),
    querySummary: String((row as Record<string, unknown>).querySummary || '').trim(),
    sourceThemeId: theme.themeId,
    fetchArgs: ((row as Record<string, unknown>).fetchArgs || {}) as Record<string, string | number | boolean>,
    pitSafety: 'medium' as const,
    estimatedCost: 'medium' as const,
    autoRegister: false,
    autoEnable: false,
  })).filter((proposal) => proposal.id && proposal.label && proposal.provider);
}
