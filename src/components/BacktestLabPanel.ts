import { Panel } from './Panel';
import { type CoverageOpsSnapshot } from '@/services/coverage-ledger';
import type {
  BacktestOpsRunSummary,
  BacktestOpsSnapshot,
  BacktestIdeaRun,
  ForwardReturnRecord,
  HistoricalReplayRun,
  WalkForwardWindow,
} from '@/services/historical-intelligence';
import { listHistoricalReplayRuns } from '@/services/historical-intelligence';
import type { HistoricalDatasetSummary } from '@/services/importer/historical-stream-worker';
import {
  buildCurrentDecisionSupportSnapshot,
  buildThemeDiagnosticsSnapshot,
  buildWorkflowDropoffSummary,
  type CurrentDecisionSupportItem,
  type CurrentDecisionSupportSnapshot,
  type InvestmentIntelligenceSnapshot,
  type WorkflowDropoffSummary,
} from '@/services/investment-intelligence';
import { type RemoteAutomationStatusPayload } from '@/services/intelligence-automation-remote';
import { type ReplayAdaptationSnapshot } from '@/services/replay-adaptation';
import type { IntelligencePostgresConfig } from '@/services/server/intelligence-postgres';
import {
  clearInvestmentFocusContext,
  getInvestmentFocusContext,
  setInvestmentFocusContext,
  subscribeInvestmentFocusContext,
} from '@/services/investment-focus-context';
import {
  importHistoricalDatasetRemote,
  runHistoricalReplayRemote,
  testHistoricalPostgresRemote,
  runWalkForwardRemote,
} from '@/services/historical-control';
import { openBacktestHubWindow } from '@/services/backtest-hub-launcher';
import { getDataFlowOpsSnapshot } from '@/services/data-flow-ops';
import { APP_BRAND } from '@/config/brand';
import { escapeHtml } from '@/utils/sanitize';

interface EventDecisionSummary {
  ideaRunId: string;
  title: string;
  generatedAt: string;
  region: string;
  themeId: string;
  conviction: number;
  falsePositiveRisk: number;
  sizePct: number;
  symbol: string | null;
  direction: string;
  horizonHours: number | null;
  signedReturnPct: number | null;
  costAdjustedSignedReturnPct: number | null;
  hit: boolean | null;
}

interface PortfolioAccountingPoint {
  timestamp: string;
  nav: number;
  batchReturnPct: number;
  drawdownPct: number;
  deployedPct: number;
}

interface PortfolioAccountingSummary {
  weightedReturnPct: number;
  navStart: number;
  navEnd: number;
  navChangePct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number | null;
  tradeCount: number;
  batchCount: number;
  averageDeployedPct: number;
  positiveBatchRate: number;
  equityCurve: PortfolioAccountingPoint[];
}

function asTs(value: string): number {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPct(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatMaybeNumber(value: number | null | undefined, digits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return value.toFixed(digits);
}

function formatDateTime(value: string): string {
  const ts = asTs(value);
  if (!ts) return value;
  return new Date(ts).toLocaleString();
}

function formatRelativeTime(value: string): string {
  const diff = Math.max(0, Date.now() - asTs(value));
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h ago`;
  return `${Math.floor(hour / 24)}d ago`;
}

function opsTone(status: string): 'ready' | 'watch' | 'blocked' {
  if (status === 'ready') return 'ready';
  if (status === 'blocked') return 'blocked';
  return 'watch';
}

function decisionBucketTone(
  bucket: CurrentDecisionSupportItem['bucket'],
): 'ready' | 'watch' | 'blocked' {
  if (bucket === 'act-now') return 'ready';
  if (bucket === 'avoid') return 'blocked';
  return 'watch';
}

function renderOpsSummaryCard(title: string, summary: BacktestOpsRunSummary | null): string {
  if (!summary) {
    return `
      <div class="backtest-lab-kpi">
        <span class="backtest-lab-kpi-label">${escapeHtml(title)}</span>
        <span class="backtest-lab-kpi-value">n/a</span>
        <div class="backtest-lab-note">No run summary yet</div>
      </div>
    `;
  }
  return `
    <div class="backtest-lab-kpi">
      <div class="backtest-lab-kpi-label-row">
        <span class="backtest-lab-kpi-label">${escapeHtml(title)}</span>
        <span class="investment-action-chip ${opsTone(summary.status)}">${escapeHtml(summary.status.toUpperCase())}</span>
      </div>
      <span class="backtest-lab-kpi-value">${formatPct(summary.costAdjustedAvgReturnPct)}</span>
      <div class="backtest-lab-note">
        hit ${summary.costAdjustedHitRate}% | ideas ${summary.ideaRunCount} | returns ${summary.forwardReturnCount}
      </div>
      <div class="backtest-lab-note">
        frames ${summary.evaluationFrameCount}/${summary.frameCount} | non-tradable ${summary.nonTradableRate}% | ${formatRelativeTime(summary.updatedAt)}
      </div>
    </div>
  `;
}

function datasetStatusTone(
  completenessScore: number,
  gapRatio: number,
  hasError: boolean,
): 'ready' | 'watch' | 'blocked' {
  if (hasError) return 'blocked';
  if (completenessScore >= 60 && gapRatio <= 0.32) return 'ready';
  return 'watch';
}

function primaryHorizon(run: HistoricalReplayRun): number {
  if (run.horizonsHours.includes(24)) return 24;
  return run.horizonsHours[0] ?? 24;
}

function runPeriodLabel(run: HistoricalReplayRun): string {
  const from = run.checkpoints[0]?.timestamp || run.startedAt;
  const to = run.checkpoints[run.checkpoints.length - 1]?.timestamp || run.completedAt;
  return `${formatDateTime(from)} -> ${formatDateTime(to)}`;
}

function formatTimeRange(from?: string | null, to?: string | null): string {
  if (!from && !to) return 'range unavailable';
  if (from && to) return `${from.slice(0, 10)} -> ${to.slice(0, 10)}`;
  return `${(from || to || '').slice(0, 10)}`;
}

function describeTrainingDataset(dataset: HistoricalDatasetSummary): string {
  const range = formatTimeRange(dataset.firstValidTime, dataset.lastValidTime);
  return `${dataset.rawRecordCount} raw / ${dataset.frameCount} frames / ${range}`;
}

function runHitRate(run: HistoricalReplayRun, horizon: number): number | null {
  const rows = run.forwardReturns.filter(
    (row) => row.horizonHours === horizon && typeof row.signedReturnPct === 'number',
  );
  if (rows.length === 0) return null;
  const hits = rows.filter((row) => (row.signedReturnPct || 0) > 0).length;
  return Math.round((hits / rows.length) * 100);
}

function runAvgReturn(run: HistoricalReplayRun, horizon: number): number | null {
  const rows = run.forwardReturns.filter(
    (row) => row.horizonHours === horizon && typeof row.signedReturnPct === 'number',
  );
  if (rows.length === 0) return null;
  return Number(average(rows.map((row) => row.signedReturnPct || 0)).toFixed(2));
}

function runCostAdjustedAvgReturn(run: HistoricalReplayRun, horizon: number): number | null {
  const rows = run.forwardReturns.filter(
    (row) => row.horizonHours === horizon && typeof row.costAdjustedSignedReturnPct === 'number',
  );
  if (rows.length === 0) return null;
  return Number(average(rows.map((row) => row.costAdjustedSignedReturnPct || 0)).toFixed(2));
}

function renderWindowSummary(windows: WalkForwardWindow[] | undefined): string {
  if (!windows || windows.length === 0) return 'single replay window';
  return windows.map((window) => `${window.phase}:${window.frameCount}`).join(' | ');
}

function getIdeaRecords(run: HistoricalReplayRun, ideaRunId: string): ForwardReturnRecord[] {
  return run.forwardReturns
    .filter((row) => row.ideaRunId === ideaRunId)
    .sort((a, b) => {
      if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
      return a.horizonHours - b.horizonHours;
    });
}

function chooseBestRecord(records: ForwardReturnRecord[], preferredHorizon: number): ForwardReturnRecord | null {
  const preferred = records.filter(
    (row) => row.horizonHours === preferredHorizon && typeof row.signedReturnPct === 'number',
  );
  const target = preferred.length > 0
    ? preferred
    : records.filter((row) => typeof row.signedReturnPct === 'number');
  if (target.length === 0) return null;
  return target.slice().sort((a, b) =>
    (b.costAdjustedSignedReturnPct ?? b.signedReturnPct ?? 0) - (a.costAdjustedSignedReturnPct ?? a.signedReturnPct ?? 0),
  )[0] || null;
}

interface MissionControlPosture {
  label: string;
  tone: 'ready' | 'watch' | 'blocked';
  summary: string;
  nextStep: string;
}

function buildMissionControlPosture(args: {
  intelligenceSnapshot: InvestmentIntelligenceSnapshot | null;
  decisionSupport: CurrentDecisionSupportSnapshot;
  workflowDropoff: WorkflowDropoffSummary;
}): MissionControlPosture {
  const { intelligenceSnapshot, decisionSupport, workflowDropoff } = args;
  if (!intelligenceSnapshot) {
    return {
      label: 'Live Snapshot Unavailable',
      tone: 'blocked',
      summary: 'Current investment-intelligence snapshot is not loaded yet.',
      nextStep: 'Refresh the intelligence snapshot before acting on the latest backtest results.',
    };
  }

  const macro = intelligenceSnapshot.macroOverlay;
  const blockedStage = workflowDropoff.stages.find((stage) => stage.status === 'blocked') || null;
  if (decisionSupport.actNow.length > 0 && macro.topDownAction === 'normal') {
    return {
      label: 'Selective Deploy',
      tone: 'ready',
      summary: `${decisionSupport.actNow.length} live idea${decisionSupport.actNow.length === 1 ? '' : 's'} cleared confirmation with enough backtest support to stay actionable now.`,
      nextStep: `Respect the current gross cap of ${macro.grossExposureCapPct}% and add risk through the top-ranked deploy bucket first.`,
    };
  }
  if (
    decisionSupport.defensive.length > 0
    || macro.topDownAction === 'defend'
    || /risk[- ]?off/i.test(decisionSupport.regimeLabel)
  ) {
    return {
      label: 'Defensive Stance',
      tone: 'watch',
      summary: `The system is reading ${decisionSupport.regimeLabel} conditions and prefers hedge / ballast expressions over fresh directional risk.`,
      nextStep: decisionSupport.defensive.length > 0
        ? 'Use the defensive bucket first and wait for better confirmation before adding new cyclic risk.'
        : 'Keep fresh risk light until a hedge or deploy idea survives the next refresh.',
    };
  }
  if (decisionSupport.watch.length > 0 || decisionSupport.avoid.length > 0) {
    return {
      label: 'Wait For Confirmation',
      tone: 'watch',
      summary: blockedStage
        ? `${blockedStage.label} is still the main bottleneck, so promising ideas are failing one of the last gates.`
        : 'The snapshot is producing more watch / avoid pressure than clean deploy pressure.',
      nextStep: blockedStage?.reasons[0]
        ? `Fix the lead blocker first: ${blockedStage.reasons[0]}`
        : 'Monitor the watch bucket and wait for a cleaner confirmation pulse before deploying capital.',
    };
  }
  return {
    label: 'Capital Preservation',
    tone: 'blocked',
    summary: 'No current setup is strong enough to justify a fresh directional deployment.',
    nextStep: 'Keep risk low, keep collecting evidence, and wait for a higher-quality snapshot.',
  };
}

function renderMissionDecisionBucket(
  title: string,
  bucket: CurrentDecisionSupportItem['bucket'],
  items: CurrentDecisionSupportItem[],
  emptyState: string,
): string {
  const rows = items.slice(0, 2).map((item) => {
    const rationale = item.rationale[0] || 'Backtest and live evidence are mixed.';
    const caution = item.caution[0] || 'No major caution recorded.';
    return `
      <div class="backtest-mission-item ${decisionBucketTone(bucket)}">
        <div class="backtest-mission-item-head">
          <button type="button" class="backtest-lab-link" data-action="focus-theme" data-theme-id="${escapeHtml(item.themeId)}">${escapeHtml(item.title)}</button>
          <span class="investment-action-chip ${decisionBucketTone(bucket)}">${escapeHtml(item.action.toUpperCase())}</span>
        </div>
        <div class="backtest-mission-metrics">
          <span class="backtest-mission-chip">${escapeHtml(item.symbols.join(', ') || 'No symbols')}</span>
          <span class="backtest-mission-chip">Replay ${formatPct(item.replayAvgReturnPct)}</span>
          <span class="backtest-mission-chip">Current ${formatPct(item.currentAvgReturnPct)}</span>
          <span class="backtest-mission-chip">${item.preferredHorizonHours ? `${item.preferredHorizonHours}h` : 'n/a horizon'}</span>
          <span class="backtest-mission-chip">Size ${formatPct(item.sizePct)}</span>
        </div>
        <div class="backtest-lab-note"><strong>Suggested:</strong> ${escapeHtml(item.suggestedAction)}</div>
        <div class="backtest-lab-note"><strong>Why now:</strong> ${escapeHtml(rationale)}</div>
        <div class="backtest-lab-note"><strong>Caution:</strong> ${escapeHtml(caution)}</div>
      </div>
    `;
  }).join('');

  return `
    <section class="investment-subcard">
      <div class="investment-subcard-head">
        <h4>${escapeHtml(title)}</h4>
        <span class="investment-mini-label">${items.length} items</span>
      </div>
      <div class="backtest-mission-list">
        ${rows || `<div class="backtest-mission-empty">${escapeHtml(emptyState)}</div>`}
      </div>
    </section>
  `;
}

function buildDecisionSummaries(run: HistoricalReplayRun): EventDecisionSummary[] {
  const horizon = primaryHorizon(run);
  return run.ideaRuns
    .map((ideaRun) => {
      const best = chooseBestRecord(getIdeaRecords(run, ideaRun.id), horizon);
      return {
        ideaRunId: ideaRun.id,
        title: ideaRun.title,
        generatedAt: ideaRun.generatedAt,
        region: ideaRun.region,
        themeId: ideaRun.themeId,
        conviction: ideaRun.conviction,
        falsePositiveRisk: ideaRun.falsePositiveRisk,
        sizePct: ideaRun.sizePct,
        symbol: best?.symbol ?? null,
        direction: best?.direction || ideaRun.direction,
        horizonHours: best?.horizonHours ?? null,
        signedReturnPct: best?.signedReturnPct ?? null,
        costAdjustedSignedReturnPct: best?.costAdjustedSignedReturnPct ?? null,
        hit: best && typeof (best.costAdjustedSignedReturnPct ?? best.signedReturnPct) === 'number'
          ? (best.costAdjustedSignedReturnPct ?? best.signedReturnPct ?? 0) > 0
          : null,
      };
    })
    .sort((a, b) => {
      const scoreA = typeof (a.costAdjustedSignedReturnPct ?? a.signedReturnPct) === 'number' ? (a.costAdjustedSignedReturnPct ?? a.signedReturnPct ?? -999) : -999;
      const scoreB = typeof (b.costAdjustedSignedReturnPct ?? b.signedReturnPct) === 'number' ? (b.costAdjustedSignedReturnPct ?? b.signedReturnPct ?? -999) : -999;
      return scoreB - scoreA;
    });
}

function buildRunThemeOptions(runs: HistoricalReplayRun[]): Array<{ id: string; label: string }> {
  const seen = new Map<string, string>();
  for (const run of runs) {
    for (const ideaRun of run.ideaRuns) {
      if (!seen.has(ideaRun.themeId)) {
        seen.set(ideaRun.themeId, ideaRun.title.split('|')[0]?.trim() || ideaRun.themeId);
      }
    }
  }
  return Array.from(seen.entries())
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildRunRegionOptions(runs: HistoricalReplayRun[]): string[] {
  return Array.from(new Set(runs.flatMap((run) => run.ideaRuns.map((ideaRun) => ideaRun.region).filter(Boolean)))).sort();
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function buildPortfolioAccountingFromSnapshot(run: HistoricalReplayRun): PortfolioAccountingSummary | null {
  const source = run.portfolioAccounting?.summary;
  if (!source) return null;
  const rawCurve = Array.isArray(run.portfolioAccounting?.equityCurve) ? run.portfolioAccounting!.equityCurve : [];
  let peak = Number(source.initialCapital) || 100;
  const equityCurve: PortfolioAccountingPoint[] = rawCurve.map((point, index) => {
    const nav = Number(point?.nav) || 0;
    const prevNav = index > 0 ? Number(rawCurve[index - 1]?.nav) || nav : Number(source.initialCapital) || nav || 100;
    peak = Math.max(peak, nav || peak);
    const batchReturnPct = prevNav > 0 ? ((nav / prevNav) - 1) * 100 : 0;
    const drawdownPct = peak > 0 ? ((nav / peak) - 1) * 100 : 0;
    return {
      timestamp: String(point?.timestamp || run.completedAt),
      nav,
      batchReturnPct,
      drawdownPct,
      deployedPct: Number(point?.grossExposurePct) || 0,
    };
  });
  const positiveBatchRate = equityCurve.length > 0
    ? (equityCurve.filter((point) => point.batchReturnPct > 0).length / equityCurve.length) * 100
    : 0;
  const averageDeployedPct = equityCurve.length > 0
    ? average(equityCurve.map((point) => point.deployedPct))
    : Number(source.avgGrossExposurePct) || 0;
  return {
    weightedReturnPct: Number.isFinite(Number(source.weightedCostAdjustedReturnPct))
      ? Number(source.weightedCostAdjustedReturnPct)
      : Number(source.weightedReturnPct) || 0,
    navStart: Number(source.initialCapital) || 100,
    navEnd: Number(source.finalCapital) || Number(source.initialCapital) || 100,
    navChangePct: Number.isFinite(Number(source.totalReturnPct))
      ? Number(source.totalReturnPct)
      : ((Number(source.finalCapital) / Math.max(1, Number(source.initialCapital))) - 1) * 100,
    cagrPct: Number(source.cagrPct) || 0,
    maxDrawdownPct: Number(source.maxDrawdownPct) || 0,
    sharpeRatio: Number.isFinite(Number(source.sharpeRatio)) ? Number(source.sharpeRatio) : null,
    tradeCount: Number(source.tradeCount) || 0,
    batchCount: equityCurve.length,
    averageDeployedPct,
    positiveBatchRate,
    equityCurve,
  };
}

function buildPortfolioAccounting(run: HistoricalReplayRun): PortfolioAccountingSummary | null {
  const snapshotSummary = buildPortfolioAccountingFromSnapshot(run);
  if (snapshotSummary) return snapshotSummary;

  const tradeRows = run.ideaRuns
    .map((ideaRun) => {
      const preferredHorizon = typeof ideaRun.preferredHorizonHours === 'number' && Number.isFinite(ideaRun.preferredHorizonHours)
        ? Math.max(1, Math.round(ideaRun.preferredHorizonHours))
        : primaryHorizon(run);
      const best = chooseBestRecord(getIdeaRecords(run, ideaRun.id), preferredHorizon);
      const returnPct = best ? (best.costAdjustedSignedReturnPct ?? best.signedReturnPct ?? null) : null;
      const sizePct = Number(ideaRun.sizePct) || 0;
      if (returnPct == null || sizePct <= 0) return null;
      return {
        timestamp: ideaRun.generatedAt,
        returnPct,
        weight: Math.max(0, sizePct) / 100,
      };
    })
    .filter((row): row is { timestamp: string; returnPct: number; weight: number } => Boolean(row));

  if (tradeRows.length === 0) return null;

  const byTimestamp = new Map<string, { returnPct: number; weight: number; count: number }[]>();
  for (const row of tradeRows) {
    const bucket = byTimestamp.get(row.timestamp) || [];
    bucket.push({ returnPct: row.returnPct, weight: row.weight, count: 1 });
    byTimestamp.set(row.timestamp, bucket);
  }

  const batches = Array.from(byTimestamp.entries())
    .sort((a, b) => asTs(a[0]) - asTs(b[0]))
    .map(([timestamp, rows]) => {
      const grossWeight = rows.reduce((sum, row) => sum + row.weight, 0);
      const deployedWeight = Math.min(1, grossWeight);
      const scale = grossWeight > 0 ? deployedWeight / grossWeight : 0;
      const batchReturnPct = rows.reduce((sum, row) => sum + (row.weight * scale * row.returnPct), 0);
      return {
        timestamp,
        grossWeight,
        deployedWeight,
        batchReturnPct,
      };
    });

  const navStart = 100;
  let nav = navStart;
  let peakNav = navStart;
  let weightedReturnNumerator = 0;
  let weightedReturnDenominator = 0;
  const equityCurve: PortfolioAccountingPoint[] = [];

  for (const batch of batches) {
    nav *= 1 + (batch.batchReturnPct / 100);
    peakNav = Math.max(peakNav, nav);
    const drawdownPct = ((nav / peakNav) - 1) * 100;
    weightedReturnNumerator += batch.batchReturnPct * batch.deployedWeight;
    weightedReturnDenominator += batch.deployedWeight;
    equityCurve.push({
      timestamp: batch.timestamp,
      nav,
      batchReturnPct: batch.batchReturnPct,
      drawdownPct,
      deployedPct: batch.deployedWeight * 100,
    });
  }

  const navEnd = nav;
  const navChangePct = ((navEnd / navStart) - 1) * 100;
  const weightedReturnPct = weightedReturnDenominator > 0
    ? weightedReturnNumerator / weightedReturnDenominator
    : 0;
  const startTs = asTs(equityCurve[0]?.timestamp || run.startedAt);
  const endTs = asTs(equityCurve[equityCurve.length - 1]?.timestamp || run.completedAt);
  const elapsedDays = Math.max(1 / 365, (endTs - startTs) / (1000 * 60 * 60 * 24));
  const years = Math.max(1 / 365, elapsedDays / 365.25);
  const cagrPct = navEnd > 0 && navStart > 0
    ? ((Math.pow(navEnd / navStart, 1 / years) - 1) * 100)
    : 0;
  const maxDrawdownPct = equityCurve.length > 0
    ? Math.min(0, ...equityCurve.map((point) => point.drawdownPct))
    : 0;
  const batchReturns = equityCurve.map((point) => point.batchReturnPct / 100);
  const meanBatchReturn = average(batchReturns);
  const volatility = standardDeviation(batchReturns);
  const gapsDays = equityCurve
    .slice(1)
    .map((point, index) => Math.max(0, (asTs(point.timestamp) - asTs(equityCurve[index]?.timestamp || point.timestamp)) / (1000 * 60 * 60 * 24)))
    .filter((value) => Number.isFinite(value) && value > 0);
  const periodDays = gapsDays.length > 0 ? median(gapsDays) : Math.max(1, elapsedDays / Math.max(1, equityCurve.length));
  const periodsPerYear = Math.max(1, Math.min(365.25, 365.25 / Math.max(1 / 365, periodDays)));
  const sharpeRatio = volatility > 0
    ? (meanBatchReturn / volatility) * Math.sqrt(periodsPerYear)
    : null;
  const positiveBatchRate = equityCurve.length > 0
    ? (equityCurve.filter((point) => point.batchReturnPct > 0).length / equityCurve.length) * 100
    : 0;
  const averageDeployedPct = equityCurve.length > 0
    ? average(equityCurve.map((point) => point.deployedPct))
    : 0;

  return {
    weightedReturnPct,
    navStart,
    navEnd,
    navChangePct,
    cagrPct,
    maxDrawdownPct,
    sharpeRatio,
    tradeCount: tradeRows.length,
    batchCount: batches.length,
    averageDeployedPct,
    positiveBatchRate,
    equityCurve,
  };
}

function renderPortfolioAccountingCard(title: string, summary: PortfolioAccountingSummary | null, compact = false): string {
  if (!summary) {
    return compact
      ? `
        <div class="backtest-lab-kpi">
          <span class="backtest-lab-kpi-label">${escapeHtml(title)}</span>
          <span class="backtest-lab-kpi-value">n/a</span>
          <div class="backtest-lab-note">No portfolio accounting available yet</div>
        </div>
      `
      : `
        <div class="backtest-lab-chart-card">
          <div class="backtest-lab-chart-head">
            <div>
              <div class="investment-mini-label">${escapeHtml(title)}</div>
              <div class="backtest-lab-chart-title">Size-weighted NAV, CAGR, drawdown, and Sharpe</div>
            </div>
          </div>
          <div class="backtest-lab-note">No portfolio accounting available yet.</div>
        </div>
      `;
  }

  const navTone = summary.navChangePct >= 0 ? 'positive' : 'negative';
  const sharpe = summary.sharpeRatio == null ? 'n/a' : formatMaybeNumber(summary.sharpeRatio, 2);
  const points = summary.equityCurve;
  const width = 620;
  const height = compact ? 120 : 190;
  const navMin = Math.min(summary.navStart, ...points.map((point) => point.nav));
  const navMax = Math.max(summary.navStart, ...points.map((point) => point.nav));
  const span = Math.max(1, navMax - navMin);
  const yFor = (value: number): number => height - 24 - ((value - navMin) / span) * (height - 48);
  const path = points.length > 0
    ? points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${((30 + (index / Math.max(1, points.length - 1)) * (width - 60))).toFixed(1)} ${yFor(point.nav).toFixed(1)}`).join(' ')
    : '';
  const lastPoint = points[points.length - 1] || null;

  if (compact) {
    return `
      <div class="backtest-lab-kpi">
        <div class="backtest-lab-kpi-label-row">
          <span class="backtest-lab-kpi-label">${escapeHtml(title)}</span>
          <span class="investment-action-chip ${opsTone(summary.navChangePct >= 0 ? 'ready' : 'watch')}">PORTFOLIO</span>
        </div>
        <span class="backtest-lab-kpi-value">${formatPct(summary.navChangePct)}</span>
        <div class="backtest-lab-note">
          weighted ${formatPct(summary.weightedReturnPct)} | NAV ${summary.navStart.toFixed(2)} -> ${summary.navEnd.toFixed(2)}
        </div>
        <div class="backtest-lab-note">
          CAGR ${formatPct(summary.cagrPct)} | MDD ${formatPct(summary.maxDrawdownPct)} | Sharpe ${sharpe}
        </div>
      </div>
    `;
  }

  return `
    <div class="backtest-lab-chart-card">
      <div class="backtest-lab-chart-head">
        <div>
          <div class="investment-mini-label">${escapeHtml(title)}</div>
          <div class="backtest-lab-chart-title">Size-weighted NAV with cash-aware compounding</div>
        </div>
        <div class="backtest-lab-chart-value ${navTone}">NAV ${summary.navEnd.toFixed(2)}</div>
      </div>
      ${points.length > 0 ? `
        <svg viewBox="0 0 ${width} ${height}" class="backtest-lab-chart-svg" aria-label="${escapeHtml(title)} equity curve">
          <line x1="30" y1="${yFor(summary.navStart).toFixed(1)}" x2="${(width - 30).toFixed(1)}" y2="${yFor(summary.navStart).toFixed(1)}" class="backtest-lab-zero-line" />
          <path d="${path}" class="backtest-lab-equity-path ${navTone}" />
        </svg>
      ` : '<div class="backtest-lab-note">No equity points available.</div>'}
      <div class="backtest-lab-note">
        weighted ${formatPct(summary.weightedReturnPct)} | NAV ${summary.navStart.toFixed(2)} -> ${summary.navEnd.toFixed(2)} | avg deployed ${summary.averageDeployedPct.toFixed(0)}%
      </div>
      <div class="backtest-lab-note">
        CAGR ${formatPct(summary.cagrPct)} | MDD ${formatPct(summary.maxDrawdownPct)} | Sharpe ${sharpe} | batches ${summary.batchCount}
      </div>
      ${lastPoint ? `<div class="backtest-lab-note">Last batch ${escapeHtml(formatDateTime(lastPoint.timestamp))} | batch return ${formatPct(lastPoint.batchReturnPct)} | drawdown ${formatPct(lastPoint.drawdownPct)}</div>` : ''}
    </div>
  `;
}

function buildHeatmap(decisions: EventDecisionSummary[]): string {
  const rows = decisions.filter((decision) => typeof (decision.costAdjustedSignedReturnPct ?? decision.signedReturnPct) === 'number');
  if (!rows.length) {
    return '<div class="backtest-lab-chart-card"><div class="backtest-lab-note">Decision heatmap unavailable for current focus.</div></div>';
  }
  const byDay = new Map<string, { count: number; hits: number; total: number }>();
  for (const row of rows) {
    const day = row.generatedAt.slice(0, 10);
    const bucket = byDay.get(day) || { count: 0, hits: 0, total: 0 };
    const value = row.costAdjustedSignedReturnPct ?? row.signedReturnPct ?? 0;
    bucket.count += 1;
    if (value > 0) bucket.hits += 1;
    bucket.total += value;
    byDay.set(day, bucket);
  }
  const cells = Array.from(byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-28)
    .map(([day, bucket]) => {
      const avg = bucket.total / Math.max(1, bucket.count);
      const hitRate = bucket.hits / Math.max(1, bucket.count);
      let tone = 'flat';
      if (avg >= 1.5 || hitRate >= 0.75) tone = 'strong';
      else if (avg > 0 || hitRate >= 0.5) tone = 'positive';
      else if (avg <= -1.5 || hitRate <= 0.2) tone = 'negative';
      return `
        <div class="backtest-lab-heat-cell ${tone}" title="${escapeHtml(day)} | avg ${formatPct(avg)} | hit ${(hitRate * 100).toFixed(0)}%">
          <span>${escapeHtml(day.slice(5))}</span>
        </div>
      `;
    }).join('');

  return `
    <div class="backtest-lab-chart-card">
      <div class="backtest-lab-chart-head">
        <div>
          <div class="investment-mini-label">Decision Heatmap</div>
          <div class="backtest-lab-chart-title">Daily hit-rate and signed-return calendar</div>
        </div>
      </div>
      <div class="backtest-lab-heatmap">${cells}</div>
    </div>
  `;
}

function buildSymbolReturnTable(run: HistoricalReplayRun, ideaRun: BacktestIdeaRun): string {
  const bySymbol = new Map<string, ForwardReturnRecord[]>();
  for (const row of getIdeaRecords(run, ideaRun.id)) {
    const bucket = bySymbol.get(row.symbol) || [];
    bucket.push(row);
    bySymbol.set(row.symbol, bucket);
  }
  const horizonColumns = run.horizonsHours.slice();
  const rows = ideaRun.symbols.map((symbolState) => {
    const symbolRows = bySymbol.get(symbolState.symbol) || [];
    const byHorizon = new Map(symbolRows.map((row) => [row.horizonHours, row] as const));
    return `
      <tr>
        <td>${escapeHtml(symbolState.symbol)}</td>
        <td>${escapeHtml(symbolState.role)}</td>
        <td>${escapeHtml(symbolState.direction.toUpperCase())}</td>
        <td>${formatMaybeNumber(symbolState.entryPrice)}</td>
        ${horizonColumns.map((horizon) => {
          const record = byHorizon.get(horizon);
          const display = record?.costAdjustedSignedReturnPct ?? record?.signedReturnPct ?? null;
          const tooltip = record && typeof record.executionPenaltyPct === 'number'
            ? ` title="raw ${formatPct(record.signedReturnPct)} | penalty ${record.executionPenaltyPct.toFixed(2)}% | session ${record.sessionState}"`
            : '';
          return `<td${tooltip}>${formatPct(display)}</td>`;
        }).join('')}
      </tr>
    `;
  }).join('');

  return `
    <table class="investment-table backtest-lab-table">
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Role</th>
          <th>Dir</th>
          <th>Entry</th>
          ${horizonColumns.map((horizon) => `<th>${horizon}h</th>`).join('')}
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="99">No forward returns yet</td></tr>'}</tbody>
    </table>
  `;
}

export class BacktestLabPanel extends Panel {
  private runs: HistoricalReplayRun[] = [];
  private datasets: HistoricalDatasetSummary[] = [];
  private opsSnapshot: BacktestOpsSnapshot | null = null;
  private automationStatus: RemoteAutomationStatusPayload | null = null;
  private coverageOps: CoverageOpsSnapshot | null = null;
  private intelligenceSnapshot: InvestmentIntelligenceSnapshot | null = null;
  private replayAdaptation: ReplayAdaptationSnapshot | null = null;
  private selectedRunId: string | null = null;
  private selectedIdeaRunId: string | null = null;
  private controlState = {
    filePath: '',
    datasetId: '',
    provider: '',
    bucketHours: '6',
    warmupFrameCount: '0',
    replayLabel: '',
    walkForwardLabel: '',
    postgresSync: false,
    pgConnectionString: '',
    pgSchema: 'lattice_current_intel',
    pgPageSize: '1000',
    pgSsl: false,
  };
  private actionMessage = '';
  private actionBusy = false;
  private focus = getInvestmentFocusContext();
  private unsubscribeFocus: (() => void) | null = null;
  private postgresStatus: {
    state: 'idle' | 'testing' | 'connected' | 'error';
    message: string;
    detail: string;
  } = {
    state: 'idle',
    message: 'Postgres sync disabled',
    detail: '',
  };

  constructor() {
    super({
      id: 'backtest-lab',
      title: APP_BRAND.hubs.backtest,
      showCount: true,
      className: 'panel-wide span-2',
    });

    this.content.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>('[data-action]');
      if (!button) return;
      const action = button.dataset.action || '';
      if (action === 'refresh') {
        void this.refreshData({ forceOpsRefresh: true });
        return;
      }
      if (action === 'import-dataset') {
        void this.handleImport();
        return;
      }
      if (action === 'run-replay') {
        void this.handleReplay();
        return;
      }
      if (action === 'run-walk-forward') {
        void this.handleWalkForward();
        return;
      }
      if (action === 'test-postgres') {
        void this.handlePostgresTest();
        return;
      }
      if (action === 'open-hub') {
        void openBacktestHubWindow();
        return;
      }
      if (action === 'select-run') {
        this.selectedRunId = button.dataset.runId || null;
        this.selectedIdeaRunId = null;
        this.render();
        return;
      }
      if (action === 'select-idea') {
        this.selectedIdeaRunId = button.dataset.ideaRunId || null;
        this.render();
        return;
      }
      if (action === 'clear-focus') {
        clearInvestmentFocusContext();
        return;
      }
      if (action === 'focus-theme') {
        setInvestmentFocusContext({ themeId: button.dataset.themeId || null });
      }
    });
    this.unsubscribeFocus = subscribeInvestmentFocusContext((context) => {
      this.focus = context;
      this.render();
    });
    this.content.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement | null;
      const field = target?.dataset.field;
      if (!field || !(field in this.controlState)) return;
      const isCheckbox = target instanceof HTMLInputElement && target.type === 'checkbox';
      (this.controlState as Record<string, unknown>)[field] = isCheckbox ? target.checked : target.value;
    });
    this.content.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement | null;
      const field = target?.dataset.field;
      if (!target) return;
      if (field === 'focus-theme') {
        setInvestmentFocusContext({ themeId: target.value || null });
        return;
      }
      if (field === 'focus-region') {
        setInvestmentFocusContext({ region: target.value || null });
        return;
      }
      if (!field || !(field in this.controlState)) return;
      const isCheckbox = target instanceof HTMLInputElement && target.type === 'checkbox';
      (this.controlState as Record<string, unknown>)[field] = isCheckbox ? target.checked : target.value;
      if (field === 'datasetId') {
        const selectedDataset = this.datasets.find((dataset) => dataset.datasetId === target.value);
        this.controlState.provider = selectedDataset?.provider || '';
      }
      this.render();
    });

    void this.refreshData();
  }

  public destroy(): void {
    this.unsubscribeFocus?.();
    this.unsubscribeFocus = null;
    super.destroy();
  }

  public async refreshData(options: { forceOpsRefresh?: boolean } = {}): Promise<void> {
    try {
      this.setFetching(true);
      this.showLoading('Loading replay history...');
      const [runs, dataFlowOps] = await Promise.all([
        listHistoricalReplayRuns(12),
        getDataFlowOpsSnapshot({ forceRefresh: options.forceOpsRefresh }),
      ]);
      this.runs = runs;
      this.datasets = dataFlowOps.historicalDatasets;
      this.opsSnapshot = dataFlowOps.backtestOps;
      this.automationStatus = dataFlowOps.automation;
      this.intelligenceSnapshot = dataFlowOps.intelligence;
      this.replayAdaptation = dataFlowOps.replayAdaptation;
      this.coverageOps = dataFlowOps.coverage;
      this.setCount(this.runs.length);
      if (!this.controlState.datasetId || !this.datasets.some((dataset) => dataset.datasetId === this.controlState.datasetId)) {
        this.controlState.datasetId = this.datasets[0]?.datasetId || '';
      }
      this.controlState.provider = this.datasets.find((dataset) => dataset.datasetId === this.controlState.datasetId)?.provider || this.controlState.provider || '';
      if (!this.selectedRunId || !this.runs.some((run) => run.id === this.selectedRunId)) {
        this.selectedRunId = this.runs[0]?.id ?? null;
        this.selectedIdeaRunId = null;
      }
      this.setDataBadge(this.runs.length > 0 ? 'live' : 'unavailable', this.runs.length > 0 ? 'RUNS' : 'NO RUNS');
      this.render();
    } catch (error) {
      console.warn('[backtest-lab] load failed', error);
      this.setCount(0);
      this.setDataBadge('unavailable', 'ERROR');
      this.showError('Failed to load replay runs', () => void this.refreshData());
    } finally {
      this.setFetching(false);
    }
  }

  private postgresConfig(): IntelligencePostgresConfig | null {
    const connectionString = this.controlState.pgConnectionString.trim();
    const schema = this.controlState.pgSchema.trim();
    if (!connectionString && !schema && !this.controlState.pgSsl) {
      return null;
    }
    return {
      connectionString: connectionString || undefined,
      schema: schema || undefined,
      ssl: this.controlState.pgSsl || undefined,
    };
  }

  private summarizePostgresResult(result: unknown): string {
    if (!result || typeof result !== 'object') return '';
    const shaped = result as { result?: { rawRecordCount?: number; frameCount?: number; runId?: string } };
    if (shaped.result?.runId) {
      return `postgres synced run ${shaped.result.runId}`;
    }
    if (typeof shaped.result?.rawRecordCount === 'number' || typeof shaped.result?.frameCount === 'number') {
      return `postgres synced ${shaped.result?.rawRecordCount ?? 0} raw / ${shaped.result?.frameCount ?? 0} frames`;
    }
    return 'postgres sync completed';
  }

  private async handleImport(): Promise<void> {
    const filePath = this.controlState.filePath.trim();
    if (!filePath) {
      this.actionMessage = 'file path required';
      this.render();
      return;
    }
    this.actionBusy = true;
    this.actionMessage = 'importing historical dataset...';
    this.render();
    try {
      const importResult = await importHistoricalDatasetRemote(filePath, {
        datasetId: this.controlState.datasetId.trim() || undefined,
        provider: this.controlState.provider.trim() || undefined,
        bucketHours: Math.max(1, Number(this.controlState.bucketHours || 6)),
        warmupFrameCount: Math.max(0, Number(this.controlState.warmupFrameCount || 0)),
      }, {
        postgresSync: this.controlState.postgresSync,
        pgConfig: this.postgresConfig(),
        postgresPageSize: Math.max(100, Number(this.controlState.pgPageSize || 1000)),
      });
      const result = importResult.result;
      const pgNote = this.summarizePostgresResult(importResult.postgresSyncResult);
      this.actionMessage = result
        ? `imported ${result.datasetId} (${result.rawRecordCount} raw / ${result.frameCount} frames)${pgNote ? ` · ${pgNote}` : ''}`
        : 'import failed';
      if (result?.datasetId) {
        this.controlState.datasetId = result.datasetId;
      }
      await this.refreshData({ forceOpsRefresh: true });
    } finally {
      this.actionBusy = false;
      this.render();
    }
  }

  private async handleReplay(): Promise<void> {
    const datasetId = this.controlState.datasetId.trim();
    if (!datasetId) {
      this.actionMessage = 'dataset required';
      this.render();
      return;
    }
    this.actionBusy = true;
    this.actionMessage = 'running replay...';
    this.render();
    try {
      const replayResult = await runHistoricalReplayRemote(datasetId, {
        label: this.controlState.replayLabel.trim() || `${datasetId} replay`,
      }, {}, {
        postgresSync: this.controlState.postgresSync,
        pgConfig: this.postgresConfig(),
      });
      const run = replayResult.run;
      const pgNote = this.summarizePostgresResult(replayResult.postgresSyncResult);
      this.actionMessage = run ? `replay completed: ${run.label}${pgNote ? ` · ${pgNote}` : ''}` : 'replay failed';
      await this.refreshData({ forceOpsRefresh: true });
    } finally {
      this.actionBusy = false;
      this.render();
    }
  }

  private async handleWalkForward(): Promise<void> {
    const datasetId = this.controlState.datasetId.trim();
    if (!datasetId) {
      this.actionMessage = 'dataset required';
      this.render();
      return;
    }
    this.actionBusy = true;
    this.actionMessage = 'running walk-forward...';
    this.render();
    try {
      const replayResult = await runWalkForwardRemote(datasetId, {
        label: this.controlState.walkForwardLabel.trim() || `${datasetId} walk-forward`,
      }, {}, {
        postgresSync: this.controlState.postgresSync,
        pgConfig: this.postgresConfig(),
      });
      const run = replayResult.run;
      const pgNote = this.summarizePostgresResult(replayResult.postgresSyncResult);
      this.actionMessage = run ? `walk-forward completed: ${run.label}${pgNote ? ` · ${pgNote}` : ''}` : 'walk-forward failed';
      await this.refreshData({ forceOpsRefresh: true });
    } finally {
      this.actionBusy = false;
      this.render();
    }
  }

  private async handlePostgresTest(): Promise<void> {
    this.postgresStatus = {
      state: 'testing',
      message: 'testing postgres connection...',
      detail: '',
    };
    this.render();
    try {
      const result = await testHistoricalPostgresRemote(this.postgresConfig() || {});
      if (result) {
        this.postgresStatus = {
          state: 'connected',
          message: `connected: ${result.database}`,
          detail: `${result.schema} · ${result.serverTime}`,
        };
      } else {
        this.postgresStatus = {
          state: 'error',
          message: 'postgres connection failed',
          detail: 'Check connection string / schema / ssl settings.',
        };
      }
    } catch (error) {
      this.postgresStatus = {
        state: 'error',
        message: 'postgres connection failed',
        detail: String((error as Error)?.message || error || ''),
      };
    }
    this.render();
  }

  private render(): void {
    const themeOptions = buildRunThemeOptions(this.runs);
    const regionOptions = buildRunRegionOptions(this.runs);
    const intelligenceSnapshot = this.intelligenceSnapshot;
    const replayAdaptation = this.replayAdaptation;
    const themeDiagnostics = buildThemeDiagnosticsSnapshot({
      snapshot: intelligenceSnapshot,
      replayAdaptation,
    });
    const decisionSupport = buildCurrentDecisionSupportSnapshot({
      snapshot: intelligenceSnapshot,
      replayAdaptation,
      themeDiagnostics,
    });
    const workflowDropoff = buildWorkflowDropoffSummary({
      snapshot: intelligenceSnapshot,
      replayAdaptation,
    });
    const datasetOptions = this.datasets.map((dataset) => `
      <option value="${escapeHtml(dataset.datasetId)}"${dataset.datasetId === this.controlState.datasetId ? ' selected' : ''}>
        ${escapeHtml(dataset.datasetId)} (${escapeHtml(dataset.provider)})
      </option>
    `).join('');
    const controlBlock = `
      <section class="investment-subcard">
        <h4>Replay Builder</h4>
        <div class="backtest-lab-controls">
          <label class="backtest-lab-control">
            <span>File</span>
            <input type="text" data-field="filePath" value="${escapeHtml(this.controlState.filePath)}" placeholder="data/historical/...json" />
          </label>
          <label class="backtest-lab-control">
            <span>Dataset</span>
            <input type="text" data-field="datasetId" value="${escapeHtml(this.controlState.datasetId)}" placeholder="dataset id" />
          </label>
          <label class="backtest-lab-control">
            <span>Provider</span>
            <input type="text" data-field="provider" value="${escapeHtml(this.controlState.provider)}" placeholder="gdelt-doc / fred / coingecko" />
          </label>
          <label class="backtest-lab-control">
            <span>Bucket Hours</span>
            <input type="number" min="1" step="1" data-field="bucketHours" value="${escapeHtml(this.controlState.bucketHours)}" />
          </label>
          <label class="backtest-lab-control">
            <span>Warm-up Frames</span>
            <input type="number" min="0" step="1" data-field="warmupFrameCount" value="${escapeHtml(this.controlState.warmupFrameCount)}" />
          </label>
          <label class="backtest-lab-control">
            <span>Loaded Datasets</span>
            <select data-field="datasetId">
              <option value="">Select dataset</option>
              ${datasetOptions}
            </select>
          </label>
          <label class="backtest-lab-control">
            <span>Replay Label</span>
            <input type="text" data-field="replayLabel" value="${escapeHtml(this.controlState.replayLabel)}" placeholder="optional replay label" />
          </label>
          <label class="backtest-lab-control">
            <span>Walk-forward Label</span>
            <input type="text" data-field="walkForwardLabel" value="${escapeHtml(this.controlState.walkForwardLabel)}" placeholder="optional walk-forward label" />
          </label>
          <label class="backtest-lab-control backtest-lab-control-checkbox">
            <span>Postgres Sync</span>
            <input type="checkbox" data-field="postgresSync"${this.controlState.postgresSync ? ' checked' : ''} />
          </label>
          <label class="backtest-lab-control backtest-lab-control-wide">
            <span>Postgres URL</span>
            <input type="password" data-field="pgConnectionString" value="${escapeHtml(this.controlState.pgConnectionString)}" placeholder="postgres://user:pass@host:5432/db" />
          </label>
          <label class="backtest-lab-control">
            <span>PG Schema</span>
            <input type="text" data-field="pgSchema" value="${escapeHtml(this.controlState.pgSchema)}" placeholder="lattice_current_intel" />
          </label>
          <label class="backtest-lab-control">
            <span>PG Page Size</span>
            <input type="number" min="100" step="100" data-field="pgPageSize" value="${escapeHtml(this.controlState.pgPageSize)}" />
          </label>
          <label class="backtest-lab-control backtest-lab-control-checkbox">
            <span>PG SSL</span>
            <input type="checkbox" data-field="pgSsl"${this.controlState.pgSsl ? ' checked' : ''} />
          </label>
        </div>
        <div class="backtest-lab-toolbar">
          <button type="button" class="backtest-lab-btn" data-action="refresh"${this.actionBusy ? ' disabled' : ''}>Refresh</button>
          <button type="button" class="backtest-lab-btn" data-action="import-dataset"${this.actionBusy ? ' disabled' : ''}>Import</button>
          <button type="button" class="backtest-lab-btn" data-action="run-replay"${this.actionBusy ? ' disabled' : ''}>Replay</button>
          <button type="button" class="backtest-lab-btn" data-action="run-walk-forward"${this.actionBusy ? ' disabled' : ''}>Walk-forward</button>
          <button type="button" class="backtest-lab-btn" data-action="test-postgres"${this.actionBusy ? ' disabled' : ''}>Test PG</button>
          <button type="button" class="backtest-lab-btn secondary" data-action="open-hub">Open ${APP_BRAND.hubs.backtest}</button>
        </div>
        <div class="backtest-lab-note">${escapeHtml(this.actionBusy ? `${this.actionMessage} (working)` : this.actionMessage || 'Pick a dataset, then import, replay, or walk-forward from this workspace.')}</div>
        <div class="backtest-lab-postgres ${escapeHtml(this.postgresStatus.state)}">
          <strong>Postgres</strong>
          <span>${escapeHtml(this.postgresStatus.message)}</span>
          ${this.postgresStatus.detail ? `<span>${escapeHtml(this.postgresStatus.detail)}</span>` : ''}
        </div>
      </section>
    `;
    const focusToolbar = `
      <div class="investment-focus-toolbar">
        <div class="investment-focus-badge">Focus: ${escapeHtml(this.focus.themeId || 'all themes')} ${this.focus.region ? `| ${escapeHtml(this.focus.region)}` : ''}</div>
        <label>
          <span class="investment-mini-label">Theme</span>
          <select data-field="focus-theme">
            <option value="">All themes</option>
            ${themeOptions.map((option) => `<option value="${escapeHtml(option.id)}"${option.id === this.focus.themeId ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
          </select>
        </label>
        <label>
          <span class="investment-mini-label">Region</span>
          <select data-field="focus-region">
            <option value="">All regions</option>
            ${regionOptions.map((region) => `<option value="${escapeHtml(region)}"${region === this.focus.region ? ' selected' : ''}>${escapeHtml(region)}</option>`).join('')}
          </select>
        </label>
        <button type="button" class="backtest-lab-btn" data-action="clear-focus">Clear focus</button>
      </div>
    `;
    const opsSnapshot = this.opsSnapshot;
    const automationStatus = this.automationStatus;
    const coverageOps = this.coverageOps;
    const posture = buildMissionControlPosture({
      intelligenceSnapshot,
      decisionSupport,
      workflowDropoff,
    });
    const readyDatasets = coverageOps?.datasets.filter((dataset) =>
      datasetStatusTone(
        dataset.completenessScore,
        dataset.gapRatio,
        Boolean(automationStatus?.state.datasets[dataset.datasetId]?.lastError),
      ) === 'ready',
    ).length ?? 0;
    const blockedDatasets = coverageOps?.datasets.filter((dataset) =>
      datasetStatusTone(
        dataset.completenessScore,
        dataset.gapRatio,
        Boolean(automationStatus?.state.datasets[dataset.datasetId]?.lastError),
      ) === 'blocked',
    ).length ?? 0;
    const recentRunStatuses = opsSnapshot
      ? ([
        ['Replay', opsSnapshot.latestReplay],
        ['Walk-forward', opsSnapshot.latestWalkForward],
        ['Current-like', opsSnapshot.currentLike],
      ].filter(([, summary]) => Boolean(summary)) as Array<[string, BacktestOpsRunSummary]>)
      : [];
    const runProgressRows = recentRunStatuses.map(([label, summary]) => `
      <div class="backtest-progress-row">
        <div>
          <div class="backtest-lab-kpi-label">${escapeHtml(label)}</div>
          <div class="backtest-lab-note">${summary.evaluationFrameCount}/${summary.frameCount} frames | ideas ${summary.ideaRunCount}</div>
        </div>
        <div class="backtest-progress-metric">
          <span class="investment-action-chip ${opsTone(summary.status)}">${escapeHtml(summary.status.toUpperCase())}</span>
          <span>${summary.progressPct}%</span>
        </div>
      </div>
    `).join('');
    const blockedStage = workflowDropoff.stages.find((stage) => stage.status === 'blocked') || null;
    const themeDiagnosticById = new Map(themeDiagnostics.rows.map((row) => [row.themeId, row] as const));
    const blockerLines = [
      blockedStage ? `${blockedStage.label}: ${blockedStage.reasons[0] || 'primary drop-off still blocked'}` : '',
      blockedDatasets > 0 ? `${blockedDatasets} dataset${blockedDatasets === 1 ? '' : 's'} still have import or fetch blockers.` : '',
      automationStatus?.state.runs.find((run) => run.status === 'error')
        ? `Automation error: ${automationStatus.state.runs.find((run) => run.status === 'error')?.detail || 'last automation cycle failed'}.`
        : '',
      decisionSupport.actNow.length === 0 ? 'No clean act-now candidate survived the current ranking layer.' : '',
    ].filter(Boolean).slice(0, 4);
    const themePulseRows = (opsSnapshot?.themeProfiles || [])
      .slice()
      .sort((left, right) =>
        right.robustUtility - left.robustUtility
        || right.coverageAdjustedUtility - left.coverageAdjustedUtility
      )
      .slice(0, 5)
      .map((profile) => {
        const row = themeDiagnosticById.get(profile.themeId);
        const tone = profile.currentVsReplayDrift <= -1.5
          ? 'blocked'
          : profile.robustUtility >= 0
            ? 'ready'
            : 'watch';
        return `
          <tr class="${tone}">
            <td><button type="button" class="backtest-lab-link" data-action="focus-theme" data-theme-id="${escapeHtml(profile.themeId)}">${escapeHtml(row?.themeLabel || profile.themeId)}</button></td>
            <td>${formatMaybeNumber(profile.robustUtility)}</td>
            <td>${formatPct(row?.currentAvgReturnPct ?? null)}</td>
            <td>${formatPct(profile.currentVsReplayDrift)}</td>
            <td>${formatMaybeNumber(profile.windowFlipRate)}</td>
          </tr>
        `;
      }).join('');
    const latestReplayRun = this.runs.find((run) => run.mode === 'replay') || this.runs[0] || null;
    const latestReplayPortfolio = latestReplayRun ? buildPortfolioAccounting(latestReplayRun) : null;
    const missionControlSection = `
      <section class="investment-subcard backtest-mission-card">
        <div class="investment-subcard-head">
          <h4>Replay Overview</h4>
          <span class="investment-mini-label">${escapeHtml(intelligenceSnapshot ? formatRelativeTime(intelligenceSnapshot.generatedAt) : opsSnapshot ? formatRelativeTime(opsSnapshot.updatedAt) : 'n/a')}</span>
        </div>
        <div class="backtest-lab-kpis">
          <div class="backtest-lab-kpi">
            <div class="backtest-lab-kpi-label-row">
              <span class="backtest-lab-kpi-label">Portfolio Stance</span>
              <span class="investment-action-chip ${posture.tone}">${escapeHtml(posture.label.toUpperCase())}</span>
            </div>
            <span class="backtest-lab-kpi-value">${escapeHtml(decisionSupport.regimeLabel)}</span>
            <div class="backtest-lab-note">${escapeHtml(posture.summary)}</div>
            <div class="backtest-lab-note">${escapeHtml(posture.nextStep)}</div>
          </div>
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Backtest Readiness</span>
            <span class="backtest-lab-kpi-value">${opsSnapshot?.derived.readinessScore ?? 0}</span>
            <div class="backtest-lab-note">
              quality ${opsSnapshot?.derived.qualityScore ?? 0} | execution ${opsSnapshot?.derived.executionScore ?? 0} | drift ${opsSnapshot?.derived.driftScore ?? 0}
            </div>
            <div class="backtest-lab-note">${readyDatasets}/${coverageOps?.datasetCount ?? 0} datasets look ready for reuse.</div>
          </div>
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Decision Pressure</span>
            <span class="backtest-lab-kpi-value">${decisionSupport.actNow.length} / ${decisionSupport.defensive.length} / ${decisionSupport.avoid.length}</span>
            <div class="backtest-lab-note">deploy / defensive / avoid buckets</div>
            <div class="backtest-lab-note">gross cap ${intelligenceSnapshot?.macroOverlay.grossExposureCapPct ?? 0}% | net cap ${intelligenceSnapshot?.macroOverlay.netExposureCapPct ?? 0}%</div>
          </div>
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Research Progress</span>
            <span class="backtest-lab-kpi-value">${coverageOps?.frameCount ?? 0} frames</span>
            <div class="backtest-lab-note">${coverageOps?.newsCount ?? 0} news | ${coverageOps?.marketCount ?? 0} markets | ${coverageOps?.sourceFamilyCount ?? 0} families</div>
            <div class="backtest-lab-note">${automationStatus?.state.themeQueue.length ?? 0} theme ideas queued | ${automationStatus?.state.datasetProposals.length ?? 0} dataset proposals</div>
          </div>
        </div>
        <div class="backtest-mission-grid">
          <div class="backtest-mission-column">
            <section class="investment-subcard">
              <div class="investment-subcard-head">
                <h4>What This Means Now</h4>
                <span class="investment-mini-label">${escapeHtml(decisionSupport.regimeLabel)}</span>
              </div>
              <div class="backtest-mission-list">
                ${decisionSupport.summary.map((line) => `<div class="backtest-mission-summary-line">${escapeHtml(line)}</div>`).join('')}
              </div>
            </section>
            <section class="investment-subcard">
              <div class="investment-subcard-head">
                <h4>Progress & Coverage</h4>
                <span class="investment-mini-label">${recentRunStatuses.length} tracked runs</span>
              </div>
              <div class="backtest-progress-list">
                ${runProgressRows || '<div class="backtest-mission-empty">No run progress rows yet.</div>'}
              </div>
              <div class="backtest-lab-note">
                Coverage ${coverageOps?.coverage.globalCoverageDensity.toFixed(0) ?? '0'} / completeness ${coverageOps?.coverage.globalCompletenessScore.toFixed(0) ?? '0'} / blockers ${blockedDatasets}
              </div>
            </section>
            <section class="investment-subcard">
              <div class="investment-subcard-head">
                <h4>Theme Pulse</h4>
                <span class="investment-mini-label">${opsSnapshot?.themeProfiles.length ?? 0} tracked</span>
              </div>
              <table class="investment-table backtest-lab-table">
                <thead><tr><th>Theme</th><th>Robust</th><th>Current</th><th>Drift</th><th>Flip</th></tr></thead>
                <tbody>${themePulseRows || '<tr><td colspan="5">No theme pulse rows yet.</td></tr>'}</tbody>
              </table>
            </section>
          </div>
          <div class="backtest-mission-column">
            ${renderMissionDecisionBucket('Act Now', 'act-now', decisionSupport.actNow, 'No clean deploy candidate survived the current snapshot.')}
            ${renderMissionDecisionBucket('Defensive Cover', 'defensive', decisionSupport.defensive, 'No hedge expression is currently outranking the watch bucket.')}
          </div>
          <div class="backtest-mission-column">
            ${renderMissionDecisionBucket('Avoid / Underweight', 'avoid', decisionSupport.avoid, 'No major avoid theme is dominating the snapshot right now.')}
            ${renderMissionDecisionBucket('Watch For Confirmation', 'watch', decisionSupport.watch, 'Nothing is close enough to promotion yet.')}
            <section class="investment-subcard">
              <div class="investment-subcard-head">
                <h4>Main Blockers</h4>
                <span class="investment-mini-label">${blockerLines.length} active</span>
              </div>
              <div class="backtest-mission-list">
                ${blockerLines.length
                  ? blockerLines.map((line) => `<div class="backtest-mission-summary-line">${escapeHtml(line)}</div>`).join('')
                  : '<div class="backtest-mission-empty">No major blocker is currently dominating the decision flow.</div>'}
              </div>
            </section>
          </div>
        </div>
      </section>
    `;
    const opsSummarySection = opsSnapshot ? `
      <section class="investment-subcard">
        <div class="investment-subcard-head">
          <h4>Replay Health</h4>
          <span class="investment-mini-label">${escapeHtml(formatRelativeTime(opsSnapshot.updatedAt))}</span>
        </div>
        <div class="backtest-lab-kpis">
          ${renderOpsSummaryCard('Latest Replay', opsSnapshot.latestReplay)}
          ${renderOpsSummaryCard('Walk-forward', opsSnapshot.latestWalkForward)}
          ${renderOpsSummaryCard('Current-like', opsSnapshot.currentLike)}
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Readiness</span>
            <span class="backtest-lab-kpi-value">${opsSnapshot.derived.readinessScore}</span>
            <div class="backtest-lab-note">
              quality ${opsSnapshot.derived.qualityScore} | execution ${opsSnapshot.derived.executionScore} | coverage ${opsSnapshot.derived.coverageScore}
            </div>
            <div class="backtest-lab-note">
              drift ${opsSnapshot.derived.driftScore} | activity ${opsSnapshot.derived.activityScore}
            </div>
          </div>
          ${renderPortfolioAccountingCard('Replay Portfolio', latestReplayPortfolio, true)}
        </div>
        <table class="investment-table backtest-lab-table">
          <thead><tr><th>Run</th><th>Status</th><th>Mode</th><th>Frames</th><th>Ideas</th><th>Hit</th><th>Adj Avg</th><th>Updated</th></tr></thead>
          <tbody>${opsSnapshot.recentRuns.map((run) => `
            <tr>
              <td>${escapeHtml(run.label)}</td>
              <td><span class="investment-action-chip ${opsTone(run.status)}">${escapeHtml(run.status.toUpperCase())}</span></td>
              <td>${escapeHtml(run.mode.toUpperCase())}</td>
              <td>${run.evaluationFrameCount}/${run.frameCount}</td>
              <td>${run.ideaRunCount}</td>
              <td>${run.costAdjustedHitRate}%</td>
              <td>${formatPct(run.costAdjustedAvgReturnPct)}</td>
              <td>${escapeHtml(formatRelativeTime(run.updatedAt))}</td>
            </tr>
          `).join('') || '<tr><td colspan="8">No recent run summaries</td></tr>'}</tbody>
        </table>
      </section>
    ` : '';
    const datasetOpsRows = coverageOps?.datasets.slice(0, 10).map((dataset) => {
      const state = automationStatus?.state.datasets[dataset.datasetId];
      const tone = datasetStatusTone(dataset.completenessScore, dataset.gapRatio, Boolean(state?.lastError));
      const latestImport = dataset.importedAt || state?.lastImportAt || state?.lastFetchAt || null;
      return `
        <tr>
          <td>${escapeHtml(dataset.label || dataset.datasetId)}</td>
          <td>${escapeHtml((dataset.provider || '-').toUpperCase())}</td>
          <td><span class="investment-action-chip ${tone}">${escapeHtml(tone.toUpperCase())}</span></td>
          <td>${dataset.enabled ? 'yes' : 'no'}</td>
          <td>${dataset.rawRecordCount}/${dataset.frameCount}</td>
          <td>${dataset.coverageDensity.toFixed(0)} / ${dataset.completenessScore.toFixed(0)}</td>
          <td>${dataset.gapRatio.toFixed(2)}</td>
          <td>${typeof dataset.knowledgeLagHours === 'number' ? dataset.knowledgeLagHours.toFixed(1) : 'n/a'}h</td>
          <td>${latestImport ? escapeHtml(formatRelativeTime(latestImport)) : '-'}</td>
          <td>${escapeHtml(state?.lastError || '-')}</td>
        </tr>
      `;
    }).join('') || '';
    const sourceFamilyRows = coverageOps?.sourceFamilies.slice(0, 8).map((family) => `
      <tr>
        <td>${escapeHtml(family.sourceFamily)}</td>
        <td>${family.datasetCount}</td>
        <td>${family.frameCount}</td>
        <td>${family.coverageDensity.toFixed(0)}</td>
        <td>${family.completenessScore.toFixed(0)}</td>
        <td>${family.gapRatio.toFixed(2)}</td>
        <td>${family.knowledgeLagHours.toFixed(1)}h</td>
      </tr>
    `).join('') || '';
    const dataCoverageSection = coverageOps ? `
      <div class="investment-grid-two">
        <section class="investment-subcard">
          <div class="investment-subcard-head">
            <h4>Data Collection Pipeline</h4>
            <span class="investment-mini-label">${coverageOps.datasetCount} datasets</span>
          </div>
          <div class="investment-coverage-grid">
            <div class="investment-coverage-stat"><span class="investment-mini-label">Frames</span><b>${coverageOps.frameCount}</b></div>
            <div class="investment-coverage-stat"><span class="investment-mini-label">News</span><b>${coverageOps.newsCount}</b></div>
            <div class="investment-coverage-stat"><span class="investment-mini-label">Markets</span><b>${coverageOps.marketCount}</b></div>
            <div class="investment-coverage-stat"><span class="investment-mini-label">Coverage</span><b>${coverageOps.coverage.globalCoverageDensity.toFixed(0)}</b></div>
            <div class="investment-coverage-stat"><span class="investment-mini-label">Completeness</span><b>${coverageOps.coverage.globalCompletenessScore.toFixed(0)}</b></div>
            <div class="investment-coverage-stat"><span class="investment-mini-label">Source families</span><b>${coverageOps.sourceFamilyCount}</b></div>
          </div>
          <table class="investment-table backtest-lab-table">
            <thead><tr><th>Dataset</th><th>Provider</th><th>Status</th><th>Enabled</th><th>Raw/Frames</th><th>Coverage/Comp</th><th>Gap</th><th>Lag</th><th>Latest import</th><th>Blocker</th></tr></thead>
            <tbody>${datasetOpsRows || '<tr><td colspan="10">No dataset coverage rows yet</td></tr>'}</tbody>
          </table>
        </section>
        <section class="investment-subcard">
          <div class="investment-subcard-head">
            <h4>Source Family Coverage</h4>
            <span class="investment-mini-label">${coverageOps.sourceFamilyCount} families</span>
          </div>
          <table class="investment-table backtest-lab-table">
            <thead><tr><th>Family</th><th>Datasets</th><th>Frames</th><th>Coverage</th><th>Completeness</th><th>Gap</th><th>Lag</th></tr></thead>
            <tbody>${sourceFamilyRows || '<tr><td colspan="7">No source-family coverage rows yet</td></tr>'}</tbody>
          </table>
        </section>
      </div>
    ` : '';
    const trainingDatasets = this.datasets
      .filter((dataset) => dataset.rawRecordCount > 0 || dataset.frameCount > 0)
      .sort((a, b) => b.frameCount - a.frameCount || b.rawRecordCount - a.rawRecordCount || a.datasetId.localeCompare(b.datasetId))
      .slice(0, 8);
    const trainingDatasetRows = trainingDatasets.map((dataset) => `
      <tr>
        <td>${escapeHtml(dataset.datasetId)}</td>
        <td>${escapeHtml((dataset.provider || '-').toUpperCase())}</td>
        <td>${escapeHtml(describeTrainingDataset(dataset))}</td>
        <td>${dataset.importedAt ? escapeHtml(formatRelativeTime(dataset.importedAt)) : '-'}</td>
      </tr>
    `).join('');
    const adaptationRunRows = replayAdaptation?.recentRuns.slice(0, 6).map((run) => `
      <tr>
        <td>${escapeHtml(run.label)}</td>
        <td>${escapeHtml(run.mode.toUpperCase())}</td>
        <td>${run.evaluationFrameCount}/${run.frameCount}</td>
        <td>${run.uniqueThemeCount}</td>
        <td>${run.uniqueSymbolCount}</td>
        <td>${escapeHtml(formatRelativeTime(run.completedAt))}</td>
      </tr>
    `).join('') || '';
    const liveSnapshotRows = intelligenceSnapshot ? `
      <div class="investment-coverage-grid">
        <div class="investment-coverage-stat"><span class="investment-mini-label">Generated</span><b>${escapeHtml(formatRelativeTime(intelligenceSnapshot.generatedAt))}</b></div>
        <div class="investment-coverage-stat"><span class="investment-mini-label">Direct mappings</span><b>${intelligenceSnapshot.directMappings.length}</b></div>
        <div class="investment-coverage-stat"><span class="investment-mini-label">Idea cards</span><b>${intelligenceSnapshot.ideaCards.length}</b></div>
        <div class="investment-coverage-stat"><span class="investment-mini-label">Tracked ideas</span><b>${intelligenceSnapshot.trackedIdeas.length}</b></div>
        <div class="investment-coverage-stat"><span class="investment-mini-label">Top themes</span><b>${intelligenceSnapshot.topThemes.length}</b></div>
        <div class="investment-coverage-stat"><span class="investment-mini-label">Coverage</span><b>${intelligenceSnapshot.coverageLedger?.globalCoverageDensity ?? 0}</b></div>
      </div>
      <div class="backtest-mission-list">
        ${intelligenceSnapshot.summaryLines.slice(0, 4).map((line) => `<div class="backtest-mission-summary-line">${escapeHtml(line)}</div>`).join('')}
      </div>
    ` : '<div class="backtest-mission-empty">No current investment snapshot loaded yet.</div>';
    const latestTrainingWindows = latestReplayRun?.windows?.map((window) => `
      <tr>
        <td>${escapeHtml(window.phase.toUpperCase())}</td>
        <td>${escapeHtml(formatTimeRange(window.from, window.to))}</td>
        <td>${window.frameCount}</td>
      </tr>
    `).join('') || '';
    const trainingInputsSection = `
      <section class="investment-subcard">
        <div class="investment-subcard-head">
          <h4>Replay Inputs & Live Context</h4>
          <span class="investment-mini-label">${replayAdaptation?.recentRuns.length ?? 0} replay memories</span>
        </div>
        <div class="backtest-mission-list">
          <div class="backtest-mission-summary-line">Live decisions currently combine four layers: historical replay memory, learned replay adaptation profiles, the latest current investment snapshot, and dataset / coverage health.</div>
          <div class="backtest-mission-summary-line">This section shows which datasets and snapshots are actively feeding those layers right now.</div>
        </div>
        <div class="investment-grid-two">
          <section class="investment-subcard">
            <div class="investment-subcard-head">
              <h4>Historical Corpus Feeding Replay</h4>
              <span class="investment-mini-label">${trainingDatasets.length} datasets</span>
            </div>
            <table class="investment-table backtest-lab-table">
              <thead><tr><th>Dataset</th><th>Provider</th><th>Range / volume</th><th>Latest import</th></tr></thead>
              <tbody>${trainingDatasetRows || '<tr><td colspan="4">No historical datasets with usable frames are loaded yet.</td></tr>'}</tbody>
            </table>
          </section>
          <section class="investment-subcard">
            <div class="investment-subcard-head">
              <h4>Replay Memory Feeding Learned Profiles</h4>
              <span class="investment-mini-label">${replayAdaptation?.themeProfiles.length ?? 0} theme profiles</span>
            </div>
            <div class="investment-coverage-grid">
              <div class="investment-coverage-stat"><span class="investment-mini-label">Recent runs</span><b>${replayAdaptation?.recentRuns.length ?? 0}</b></div>
              <div class="investment-coverage-stat"><span class="investment-mini-label">Current theme perf</span><b>${replayAdaptation?.currentThemePerformance.length ?? 0}</b></div>
              <div class="investment-coverage-stat"><span class="investment-mini-label">Workflow quality</span><b>${replayAdaptation?.workflow.qualityScore ?? 0}</b></div>
              <div class="investment-coverage-stat"><span class="investment-mini-label">Workflow execution</span><b>${replayAdaptation?.workflow.executionScore ?? 0}</b></div>
            </div>
            <table class="investment-table backtest-lab-table">
              <thead><tr><th>Run</th><th>Mode</th><th>Eval/Frames</th><th>Themes</th><th>Symbols</th><th>Completed</th></tr></thead>
              <tbody>${adaptationRunRows || '<tr><td colspan="6">Replay adaptation has not recorded any runs yet.</td></tr>'}</tbody>
            </table>
          </section>
        </div>
        <div class="investment-grid-two">
          <section class="investment-subcard">
            <div class="investment-subcard-head">
              <h4>Current Snapshot Feeding Live Decisions</h4>
              <span class="investment-mini-label">${intelligenceSnapshot ? escapeHtml(decisionSupport.regimeLabel) : 'offline'}</span>
            </div>
            ${liveSnapshotRows}
          </section>
          <section class="investment-subcard">
            <div class="investment-subcard-head">
              <h4>Latest Training Window</h4>
              <span class="investment-mini-label">${latestReplayRun ? escapeHtml(latestReplayRun.label) : 'n/a'}</span>
            </div>
            <div class="backtest-lab-note">Latest replay mode: ${latestReplayRun ? escapeHtml(latestReplayRun.mode.toUpperCase()) : 'n/a'} | retain learning: ${latestReplayRun?.retainLearningState ? 'yes' : 'no'}</div>
            <div class="backtest-lab-note">Primary run period: ${latestReplayRun ? escapeHtml(runPeriodLabel(latestReplayRun)) : 'n/a'}</div>
            <table class="investment-table backtest-lab-table">
              <thead><tr><th>Window</th><th>Period</th><th>Frames</th></tr></thead>
              <tbody>${latestTrainingWindows || '<tr><td colspan="3">No explicit walk-forward window is attached to the latest run.</td></tr>'}</tbody>
            </table>
          </section>
        </div>
      </section>
    `;

    if (this.runs.length === 0) {
      this.setContent(`
        <div class="backtest-lab-shell">
          ${controlBlock}
          ${focusToolbar}
          ${missionControlSection}
          ${trainingInputsSection}
          ${opsSummarySection}
          ${dataCoverageSection}
          <div class="panel-empty">No backtest runs yet.</div>
          <div class="backtest-lab-note">
            Use the Replay and Walk-forward controls above to create the first run from this panel. Open ${APP_BRAND.hubs.backtest} only if you want the larger dedicated workspace.
          </div>
          <div class="backtest-lab-toolbar">
            <button type="button" class="backtest-lab-btn" data-action="refresh">Refresh</button>
          </div>
        </div>
      `);
      return;
    }

    const selectedRun = this.runs.find((run) => run.id === this.selectedRunId) || this.runs[0]!;
    const decisions = buildDecisionSummaries(selectedRun).filter((decision) =>
      (!this.focus.themeId || decision.themeId === this.focus.themeId)
      && (!this.focus.region || decision.region === this.focus.region),
    );
    const filteredIdeaRuns = selectedRun.ideaRuns.filter((ideaRun) =>
      (!this.focus.themeId || ideaRun.themeId === this.focus.themeId)
      && (!this.focus.region || ideaRun.region === this.focus.region),
    );
    if (!this.selectedIdeaRunId || !filteredIdeaRuns.some((ideaRun) => ideaRun.id === this.selectedIdeaRunId)) {
      this.selectedIdeaRunId = decisions[0]?.ideaRunId ?? filteredIdeaRuns[0]?.id ?? null;
    }
    const selectedIdea = filteredIdeaRuns.find((ideaRun) => ideaRun.id === this.selectedIdeaRunId) || filteredIdeaRuns[0] || null;
    const selectedDecision = decisions.find((decision) => decision.ideaRunId === selectedIdea?.id) || decisions[0] || null;
    const horizon = primaryHorizon(selectedRun);
    const runHit = runHitRate(selectedRun, horizon);
    const runAvg = runAvgReturn(selectedRun, horizon);
    const runCostAvg = runCostAdjustedAvgReturn(selectedRun, horizon);
    const selectedPortfolio = buildPortfolioAccounting(selectedRun);
    const sourcePosterior = selectedRun.sourceProfiles.length > 0
      ? Math.round(average(selectedRun.sourceProfiles.map((profile) => profile.posteriorAccuracyScore)))
      : 0;
    const mappingPosterior = selectedRun.mappingStats.length > 0
      ? Math.round(average(selectedRun.mappingStats.map((row) => row.posteriorWinRate)))
      : 0;

    const runButtons = this.runs.map((run) => {
      const selected = run.id === selectedRun.id ? ' selected' : '';
      return `
        <button type="button" class="backtest-lab-run-btn${selected}" data-action="select-run" data-run-id="${escapeHtml(run.id)}">
          <span class="backtest-lab-run-label">${escapeHtml(run.label)}</span>
          <span class="backtest-lab-run-meta">${escapeHtml(run.mode.toUpperCase())} · ${run.frameCount} frames · ${formatRelativeTime(run.completedAt)}</span>
        </button>
      `;
    }).join('');

    const decisionRows = decisions.slice(0, 12).map((decision) => {
      const selected = decision.ideaRunId === selectedIdea?.id ? ' selected' : '';
      return `
        <tr class="backtest-lab-row${selected}">
          <td>
            <button type="button" class="backtest-lab-link" data-action="select-idea" data-idea-run-id="${escapeHtml(decision.ideaRunId)}">
              ${escapeHtml(decision.title)}
            </button>
          </td>
          <td>${escapeHtml(decision.region)}</td>
          <td>${escapeHtml(decision.symbol || '-')}</td>
          <td>${escapeHtml(decision.direction.toUpperCase())}</td>
          <td>${decision.horizonHours ?? 'n/a'}${decision.horizonHours ? 'h' : ''}</td>
          <td>${formatPct(decision.costAdjustedSignedReturnPct ?? decision.signedReturnPct)}</td>
          <td>${decision.conviction}</td>
          <td>${decision.falsePositiveRisk}</td>
        </tr>
      `;
    }).join('');

    const checkpointRows = selectedRun.checkpoints.slice(-8).reverse().map((checkpoint) => `
      <tr>
        <td>${escapeHtml(formatDateTime(checkpoint.timestamp))}</td>
        <td>${checkpoint.newsCount}</td>
        <td>${checkpoint.clusterCount}</td>
        <td>${checkpoint.marketCount}</td>
        <td>${checkpoint.ideaCount}</td>
        <td>${checkpoint.mappingStatCount}</td>
      </tr>
    `).join('');

    const windowRows = (selectedRun.windows || []).map((window) => `
      <tr>
        <td>${escapeHtml(window.phase.toUpperCase())}</td>
        <td>${escapeHtml(formatDateTime(window.from))}</td>
        <td>${escapeHtml(formatDateTime(window.to))}</td>
        <td>${window.frameCount}</td>
      </tr>
    `).join('');

    const summaryLines = selectedRun.summaryLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
    const evidenceLines = selectedIdea?.evidence.slice(0, 8).map((line) => `<li>${escapeHtml(line)}</li>`).join('') || '<li>No evidence lines.</li>';
    const triggerLines = selectedIdea?.triggers.map((line) => `<li>${escapeHtml(line)}</li>`).join('') || '<li>No trigger notes.</li>';
    const invalidationLines = selectedIdea?.invalidation.map((line) => `<li>${escapeHtml(line)}</li>`).join('') || '<li>No invalidation rules.</li>';
    const equityCurve = renderPortfolioAccountingCard('Selected Run Portfolio', selectedPortfolio, false);
    const decisionHeatmap = buildHeatmap(decisions);

    this.setContent(`
      <div class="backtest-lab-shell">
        ${controlBlock}
        ${focusToolbar}
        ${missionControlSection}
        ${trainingInputsSection}
        ${opsSummarySection}
        ${dataCoverageSection}
        <div class="backtest-lab-toolbar">
          <div class="backtest-lab-run-list">${runButtons}</div>
          <button type="button" class="backtest-lab-btn" data-action="refresh">Refresh</button>
        </div>

        <div class="investment-grid-two">
          ${equityCurve}
          ${decisionHeatmap}
        </div>

        <div class="backtest-lab-kpis">
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Mode</span>
            <span class="backtest-lab-kpi-value">${escapeHtml(selectedRun.mode.toUpperCase())}</span>
          </div>
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Period</span>
            <span class="backtest-lab-kpi-value">${escapeHtml(runPeriodLabel(selectedRun))}</span>
          </div>
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Primary Horizon</span>
            <span class="backtest-lab-kpi-value">${horizon}h</span>
          </div>
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Hit Rate</span>
            <span class="backtest-lab-kpi-value">${runHit ?? 'n/a'}%</span>
          </div>
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Raw Avg</span>
            <span class="backtest-lab-kpi-value">${formatPct(runAvg)}</span>
          </div>
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Cost Adj Avg</span>
            <span class="backtest-lab-kpi-value">${formatPct(runCostAvg)}</span>
          </div>
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Reality Gate</span>
            <span class="backtest-lab-kpi-value">hit ${selectedRun.realitySummary.costAdjustedHitRate}% / score ${selectedRun.realitySummary.avgRealityScore}</span>
          </div>
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Learned Priors</span>
            <span class="backtest-lab-kpi-value">src ${sourcePosterior} / map ${mappingPosterior}</span>
          </div>
          ${renderPortfolioAccountingCard('Selected Run Portfolio', selectedPortfolio, true)}
        </div>

        <div class="investment-grid-two">
          <section class="investment-subcard">
            <h4>Run Summary</h4>
            <div class="backtest-lab-note">Windows: ${escapeHtml(renderWindowSummary(selectedRun.windows))}</div>
            <ul>${summaryLines || '<li>No run summary.</li>'}</ul>
          </section>
          <section class="investment-subcard">
            <h4>Replay Checkpoints</h4>
            <table class="investment-table backtest-lab-table">
              <thead><tr><th>Time</th><th>News</th><th>Clusters</th><th>Mkt</th><th>Ideas</th><th>MapStats</th></tr></thead>
              <tbody>${checkpointRows || '<tr><td colspan="6">No checkpoints</td></tr>'}</tbody>
            </table>
          </section>
        </div>

        <div class="investment-grid-two">
          <section class="investment-subcard">
            <h4>Walk-forward Windows</h4>
            <table class="investment-table backtest-lab-table">
              <thead><tr><th>Phase</th><th>From</th><th>To</th><th>Frames</th></tr></thead>
              <tbody>${windowRows || '<tr><td colspan="4">Single replay run</td></tr>'}</tbody>
            </table>
          </section>
          <section class="investment-subcard">
            <h4>Best Historical Decisions</h4>
            <table class="investment-table backtest-lab-table">
              <thead><tr><th>Event</th><th>Region</th><th>Asset</th><th>Dir</th><th>H</th><th>Adj Return</th><th>Conv</th><th>FP</th></tr></thead>
              <tbody>${decisionRows || '<tr><td colspan="8">No event decisions yet</td></tr>'}</tbody>
            </table>
          </section>
        </div>

        <section class="investment-subcard">
          <h4>Event Replay Detail</h4>
          ${selectedIdea ? `
            <div class="backtest-lab-detail-meta">
              <span>${escapeHtml(formatDateTime(selectedIdea.generatedAt))}</span>
              <span>${escapeHtml(selectedIdea.region)}</span>
              <span>${escapeHtml(selectedIdea.themeId)}</span>
              <span>${escapeHtml(selectedIdea.direction.toUpperCase())}</span>
              <span>Conv ${selectedIdea.conviction}</span>
              <span>FP ${selectedIdea.falsePositiveRisk}</span>
              <span>Size ${selectedIdea.sizePct}%</span>
              <span>Best ${selectedDecision?.symbol ? `${escapeHtml(selectedDecision.symbol)} ${escapeHtml(selectedDecision.direction.toUpperCase())}` : 'n/a'} ${selectedDecision?.horizonHours ? `@ ${selectedDecision.horizonHours}h` : ''}</span>
              <span>Adj ${formatPct(selectedDecision?.costAdjustedSignedReturnPct ?? selectedDecision?.signedReturnPct)}</span>
            </div>
            <div class="investment-idea-thesis">${escapeHtml(selectedIdea.thesis)}</div>
            <div class="investment-grid-two">
              <div>
                <h5>Evidence</h5>
                <ul>${evidenceLines}</ul>
              </div>
              <div>
                <h5>Triggers</h5>
                <ul>${triggerLines}</ul>
                <h5>Invalidation</h5>
                <ul>${invalidationLines}</ul>
              </div>
            </div>
            ${buildSymbolReturnTable(selectedRun, selectedIdea)}
          ` : '<div class="panel-empty">No event selected.</div>'}
        </section>
      </div>
    `);
  }
}
