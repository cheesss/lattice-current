import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { logSourceOpsEvent } from './source-ops-log';

export interface ScheduledReport {
  id: string;
  variant: string;
  trigger: 'interval' | 'volume' | 'manual';
  generatedAt: string;
  title: string;
  summary: string;
  themes: string[];
  sourceCount: number;
  newsCount: number;
  clusterCount: number;
  marketCount: number;
  collectorSummary?: string;
  redTeamSummary?: string;
  quantSummary?: string;
  rebuttalSummary?: string;
  consensusMode?: 'single' | 'multi-agent';
}

export interface ScheduledReportInput {
  variant: string;
  trigger?: 'interval' | 'volume' | 'manual';
  newsCount: number;
  clusterCount: number;
  marketCount: number;
  sourceCount: number;
  topHeadlines: string[];
  topThemes: string[];
  topMarkets: string[];
}

interface PersistedScheduledReports {
  reports: ScheduledReport[];
  lastGeneratedAt: number;
  lastNewsCount: number;
}

const REPORT_CACHE_KEY = 'scheduled-reports:v1';
const REPORT_INTERVAL_MS = 4 * 60 * 60 * 1000;
const REPORT_NEWS_DELTA = 90;
const MAX_REPORTS = 40;

let loaded = false;
let reports: ScheduledReport[] = [];
let lastGeneratedAt = 0;
let lastNewsCount = 0;

function nowMs(): number {
  return Date.now();
}

function makeId(): string {
  return `report:${nowMs()}`;
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  await refreshFromCache();
}

async function refreshFromCache(): Promise<void> {
  try {
    const cached = await getPersistentCache<PersistedScheduledReports>(REPORT_CACHE_KEY);
    reports = cached?.data?.reports ?? [];
    lastGeneratedAt = cached?.data?.lastGeneratedAt ?? 0;
    lastNewsCount = cached?.data?.lastNewsCount ?? 0;
  } catch (error) {
    console.warn('[scheduled-reports] load failed', error);
  }
}

async function persist(): Promise<void> {
  reports = reports
    .slice()
    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
    .slice(0, MAX_REPORTS);
  await setPersistentCache(REPORT_CACHE_KEY, {
    reports,
    lastGeneratedAt,
    lastNewsCount,
  });
}

function buildFallbackSummary(input: ScheduledReportInput): string {
  const headlineSummary = input.topHeadlines.slice(0, 4).join(' | ');
  const themeSummary = input.topThemes.slice(0, 6).join(', ');
  const marketSummary = input.topMarkets.slice(0, 4).join(', ');
  return [
    `Loaded snapshot shows ${input.newsCount} news items, ${input.clusterCount} clusters, and ${input.marketCount} market datapoints across ${input.sourceCount} active sources.`,
    themeSummary ? `Dominant themes: ${themeSummary}.` : '',
    marketSummary ? `Largest market context: ${marketSummary}.` : '',
    headlineSummary ? `Top headlines: ${headlineSummary}.` : '',
  ].filter(Boolean).join(' ');
}

async function buildCodexSummary(input: ScheduledReportInput): Promise<string | null> {
  try {
    const response = await fetch('/api/local-codex-summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'deep',
        variant: input.variant,
        lang: 'ko',
        geoContext: 'Write a concise Korean situation report covering current geopolitical, market, and technology conditions in 6-10 sentences.',
        headlines: [
          `REPORT_TRIGGER ${input.trigger || 'interval'}`,
          `NEWS_COUNT ${input.newsCount}`,
          `CLUSTER_COUNT ${input.clusterCount}`,
          `MARKET_COUNT ${input.marketCount}`,
          `SOURCE_COUNT ${input.sourceCount}`,
          ...input.topThemes.map((theme) => `THEME ${theme}`),
          ...input.topMarkets.map((market) => `MARKET ${market}`),
          ...input.topHeadlines.map((headline) => `HEADLINE ${headline}`),
        ].slice(0, 140),
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { summary?: string };
    return typeof payload.summary === 'string' && payload.summary.trim()
      ? payload.summary.trim()
      : null;
  } catch {
    return null;
  }
}

async function buildRoleSummary(
  input: ScheduledReportInput,
  role: 'collector' | 'red-team' | 'quant' | 'judge',
  extraLines: string[],
): Promise<string | null> {
  try {
    const geoContextByRole: Record<typeof role, string> = {
      collector: 'Write a Korean intelligence collector summary from the supplied snapshot cues. Focus on facts, signals, and what changed.',
      'red-team': 'Write a Korean red-team rebuttal. Challenge weak assumptions, propaganda risk, source weakness, and uncertainty in the supplied cues.',
      quant: 'Write a Korean quant/market transmission note. Explain which assets, commodities, rates, or countries are exposed and why.',
      judge: 'Write a Korean final consensus report. Integrate collector, red-team, and quant views into a concise but analytical final situation report.',
    };
    const response = await fetch('/api/local-codex-summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'deep',
        variant: input.variant,
        lang: 'ko',
        geoContext: geoContextByRole[role],
        headlines: [
          `REPORT_ROLE ${role}`,
          `REPORT_TRIGGER ${input.trigger || 'interval'}`,
          `NEWS_COUNT ${input.newsCount}`,
          `CLUSTER_COUNT ${input.clusterCount}`,
          `MARKET_COUNT ${input.marketCount}`,
          `SOURCE_COUNT ${input.sourceCount}`,
          ...input.topThemes.map((theme) => `THEME ${theme}`),
          ...input.topMarkets.map((market) => `MARKET ${market}`),
          ...input.topHeadlines.map((headline) => `HEADLINE ${headline}`),
          ...extraLines,
        ].slice(0, 180),
      }),
      signal: AbortSignal.timeout(55_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { summary?: string };
    return typeof payload.summary === 'string' && payload.summary.trim()
      ? payload.summary.trim()
      : null;
  } catch {
    return null;
  }
}

async function buildConsensusReport(input: ScheduledReportInput): Promise<{
  collectorSummary?: string;
  redTeamSummary?: string;
  quantSummary?: string;
  rebuttalSummary?: string;
  summary: string | null;
  consensusMode: 'single' | 'multi-agent';
}> {
  const collectorSummary = await buildRoleSummary(input, 'collector', []);
  const redTeamSummary = await buildRoleSummary(input, 'red-team', collectorSummary ? [`COLLECTOR ${collectorSummary}`] : []);
  const quantSummary = await buildRoleSummary(
    input,
    'quant',
    collectorSummary ? [`COLLECTOR ${collectorSummary}`] : [],
  );

  if (!collectorSummary && !redTeamSummary && !quantSummary) {
    return {
      summary: await buildCodexSummary(input),
      consensusMode: 'single',
    };
  }

  const summary = await buildRoleSummary(input, 'judge', [
    collectorSummary ? `COLLECTOR ${collectorSummary}` : '',
    redTeamSummary ? `RED_TEAM ${redTeamSummary}` : '',
    quantSummary ? `QUANT ${quantSummary}` : '',
  ].filter(Boolean));

  return {
    collectorSummary: collectorSummary || undefined,
    redTeamSummary: redTeamSummary || undefined,
    quantSummary: quantSummary || undefined,
    rebuttalSummary: redTeamSummary || undefined,
    summary,
    consensusMode: 'multi-agent',
  };
}

export async function listScheduledReports(limit = 12): Promise<ScheduledReport[]> {
  await ensureLoaded();
  await refreshFromCache();
  return reports.slice(0, Math.max(1, limit));
}

export async function maybeGenerateScheduledReport(
  input: ScheduledReportInput,
  options: { force?: boolean } = {},
): Promise<ScheduledReport | null> {
  await ensureLoaded();
  const now = nowMs();
  const dueByInterval = now - lastGeneratedAt >= REPORT_INTERVAL_MS;
  const dueByVolume = input.newsCount - lastNewsCount >= REPORT_NEWS_DELTA;
  if (!options.force && !dueByInterval && !dueByVolume) {
    return null;
  }

  const trigger: ScheduledReport['trigger'] =
    options.force ? 'manual' : dueByVolume ? 'volume' : 'interval';
  const consensus = await buildConsensusReport({ ...input, trigger });
  const summary = consensus.summary || buildFallbackSummary(input);
  const report: ScheduledReport = {
    id: makeId(),
    variant: input.variant,
    trigger,
    generatedAt: new Date(now).toISOString(),
    title: `${input.variant.toUpperCase()} Situation Report`,
    summary,
    themes: input.topThemes.slice(0, 8),
    sourceCount: input.sourceCount,
    newsCount: input.newsCount,
    clusterCount: input.clusterCount,
    marketCount: input.marketCount,
    collectorSummary: consensus.collectorSummary,
    redTeamSummary: consensus.redTeamSummary,
    quantSummary: consensus.quantSummary,
    rebuttalSummary: consensus.rebuttalSummary,
    consensusMode: consensus.consensusMode,
  };

  reports.unshift(report);
  lastGeneratedAt = now;
  lastNewsCount = input.newsCount;
  await persist();
  await logSourceOpsEvent({
    kind: 'report',
    action: 'generated',
    actor: 'codex',
    title: report.title,
    detail: summary.slice(0, 280),
    status: trigger,
    category: input.variant,
    tags: report.themes.slice(0, 6),
  });
  return report;
}
