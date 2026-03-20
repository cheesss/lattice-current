import {
  buildCurrentDecisionSupportSnapshot,
  buildThemeDiagnosticsSnapshot,
  buildWorkflowDropoffSummary,
  type CurrentDecisionSupportItem,
  type CurrentDecisionSupportSnapshot,
  type ThemeDiagnosticsSnapshot,
  type WorkflowDropoffSummary,
} from '@/services/investment-intelligence';
import {
  getDataFlowOpsSnapshot,
  refreshDataFlowOpsSnapshot,
  subscribeDataFlowOpsSnapshot,
  type DataFlowOpsSnapshot,
  type DataFlowOpsStatusTone,
} from '@/services/data-flow-ops';
import {
  listHistoricalReplayRuns,
  type HistoricalReplayRun,
  type BacktestOpsRunSummary,
} from '@/services/historical-intelligence';
import {
  getLocalBacktestRunRemote,
  loadLocalBacktestRunsRemote,
  startLocalReplayNowRemote,
  startLocalSchedulerNowRemote,
} from '@/services/intelligence-automation-remote';
import { canUseLocalAgentEndpoints, isDesktopRuntime } from '@/services/runtime';
import { tryInvokeTauri } from '@/services/tauri-bridge';
import { escapeHtml } from '@/utils/sanitize';
import { buildBacktestOpsRunSummary, buildBacktestOpsSnapshot } from '@/services/replay-adaptation';
import { APP_BRAND } from '@/config/brand';

const AUTO_REFRESH_MS = 45_000;
type BacktestHubView = 'overview' | 'decision' | 'data' | 'history';
type BacktestHubLocale = 'en' | 'ko';
const HUB_LOCALE_STORAGE_KEY = 'wm:backtest-hub:locale';
let activeHubLocale: BacktestHubLocale = 'en';
const HUB_KO_COPY: Record<string, string> = {
  RUNNING: '실행 중',
  IDLE: '대기',
  'Refreshing Corpus...': '코퍼스 갱신 중...',
  'Refresh Data First': '먼저 데이터 갱신',
  'Refresh Corpus': '코퍼스 갱신',
  'Running Replay...': '리플레이 실행 중...',
  'Run Replay Now': '지금 리플레이 실행',
  'Run Replay': '리플레이 실행',
  Overview: '개요',
  'Latest runs and posture': '최신 실행과 포지션 상태',
  Decision: '의사결정',
  'Themes and live guidance': '테마와 현재 행동 가이드',
  Data: '데이터',
  'Coverage and dataset flow': '커버리지와 처리 흐름',
  History: '히스토리',
  'Run history and drift': '실행 이력과 드리프트',
  'Replay Started': '리플레이 시작',
  'Running a fresh replay against the latest historical corpus.': '최신 히스토리컬 코퍼스를 기준으로 새 리플레이를 실행하고 있습니다.',
  'Pipeline Started': '파이프라인 시작',
  'Refreshing datasets, the live snapshot, and tuning in one cycle.': '데이터셋, 라이브 스냅샷, 튜닝을 한 사이클로 갱신하고 있습니다.',
  'Replay Finished': '리플레이 완료',
  'No-trade result': '거래 없음 결과',
  'The replay finished cleanly, but this window still did not create a deployable idea.': '리플레이는 정상 종료됐지만 이번 구간에서는 배치 가능한 아이디어가 아직 생성되지 않았습니다.',
  'The latest replay finished without investable ideas. Check Dataset Health and Immediate blockers to see why the corpus is still thin.': '최신 리플레이는 끝났지만 투자 가능한 아이디어가 없었습니다. 코퍼스가 왜 얇은지 Dataset Health와 Immediate blockers를 확인하세요.',
  'Replay finished, but the latest window still produced 0 investable ideas. Check Dataset Health and Theme Pulse for the blocker.': '리플레이는 끝났지만 최신 구간의 투자 가능한 아이디어가 0개입니다. Dataset Health와 Theme Pulse에서 막힌 원인을 확인하세요.',
  'Recommended flow: Run Pipeline first, then Run Replay once the live snapshot is fresh.': '추천 흐름: 먼저 파이프라인을 돌리고, 라이브 스냅샷이 신선해지면 리플레이를 실행하세요.',
  'Recommended flow: inspect Latest Replay, then Theme Pulse, then Decision Brief before taking action.': '추천 흐름: Latest Replay, Theme Pulse, Decision Brief 순서로 확인한 뒤 행동하세요.',
  'Scheduler finished with follow-up needed': '스케줄러 완료, 후속 조치 필요',
  'Replay finished with follow-up needed': '리플레이 완료, 후속 조치 필요',
  'Chrome mode now attempts to preload the same locally mirrored secrets that desktop settings saved.': '크롬 모드는 데스크톱 설정에서 저장한 로컬 미러 시크릿을 미리 불러오도록 시도합니다.',
  'Top blocker:': '주요 막힘:',
  'Selected run': '선택된 실행',
  'No replay yet': '리플레이 없음',
  'No run summary recorded yet.': '기록된 실행 요약이 아직 없습니다.',
  'The run completed, but it did not produce investable ideas in this window yet.': '실행은 끝났지만 이번 구간에서는 투자 가능한 아이디어가 아직 나오지 않았습니다.',
  'Healthy selected run': '양호한 선택 실행',
  'Weak result': '약한 결과',
  'Usable signal': '활용 가능한 신호',
  'Thin sample': '얇은 샘플',
};
type HubGuidanceAction = {
  label: string;
  action: 'refresh' | 'start-replay' | 'start-scheduler' | 'open-settings' | 'set-view';
  view?: BacktestHubView;
  tone?: 'primary' | 'secondary' | 'ghost';
};

function resolveInitialHubLocale(): BacktestHubLocale {
  try {
    const stored = window.localStorage.getItem(HUB_LOCALE_STORAGE_KEY);
    if (stored === 'ko' || stored === 'en') return stored;
  } catch {
    // ignore
  }
  return navigator.language?.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

function setActiveHubLocale(locale: BacktestHubLocale): void {
  activeHubLocale = locale;
  try {
    window.localStorage.setItem(HUB_LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}

function hubLabel(en: string, ko: string): string {
  return activeHubLocale === 'ko' ? (HUB_KO_COPY[en] || ko) : en;
}

function hubStatusLabel(status: 'idle' | 'running'): string {
  return status === 'running'
    ? hubLabel('RUNNING', '실행 중')
    : hubLabel('IDLE', '대기');
}

function hubSchedulerLabel(variant: 'default' | 'pending' | 'recommended'): string {
  if (variant === 'pending') return hubLabel('Refreshing Corpus...', '코퍼스 갱신 중...');
  if (variant === 'recommended') return hubLabel('Refresh Data First', '먼저 데이터 갱신');
  return hubLabel('Refresh Corpus', '코퍼스 갱신');
}

function hubReplayLabel(variant: 'default' | 'pending' | 'recommended'): string {
  if (variant === 'pending') return hubLabel('Running Replay...', '리플레이 실행 중...');
  if (variant === 'recommended') return hubLabel('Run Replay Now', '지금 리플레이 실행');
  return hubLabel('Run Replay', '리플레이 실행');
}

function asTs(value?: string | null): number {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? ts : 0;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPct(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatMaybe(value: number | null | undefined, digits = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return value.toFixed(digits);
}

function formatRelativeTime(value?: string | null): string {
  const ts = asTs(value);
  if (!ts) return 'n/a';
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDateTime(value?: string | null): string {
  const ts = asTs(value);
  if (!ts) return 'n/a';
  return new Date(ts).toLocaleString();
}

function localizeHubErrorMessage(message: string): string {
  if (activeHubLocale !== 'ko') return message;
  if (/Another replay or scheduler cycle is already running or finalizing archive writes/i.test(message)) {
    return '다른 리플레이나 스케줄러 사이클이 아직 실행 중이거나 아카이브 쓰기를 마무리하는 중입니다. 몇 초 뒤 다시 시도하세요.';
  }
  if (/Replay trigger failed/i.test(message)) {
    return '리플레이 실행 요청이 실패했습니다.';
  }
  if (/Scheduler trigger failed/i.test(message)) {
    return '스케줄러 실행 요청이 실패했습니다.';
  }
  return message;
}

function toneClass(value: DataFlowOpsStatusTone | 'positive' | 'negative' | 'neutral'): string {
  if (value === 'positive') return 'ready';
  if (value === 'negative') return 'blocked';
  if (value === 'neutral') return 'watch';
  return value;
}

function renderHubGuidanceState(args: {
  tone: DataFlowOpsStatusTone | 'positive' | 'negative' | 'neutral';
  title: string;
  body: string;
  steps?: string[];
  actions?: HubGuidanceAction[];
}): string {
  /*
  const displayModeNote = isDesktopRuntime()
    ? hubLabel(
      'Desktop mode can reuse secrets saved in the local key vault after they are stored successfully.',
      '데스크톱 모드는 로컬 키 보관소에 정상 저장된 비밀값을 다시 사용할 수 있습니다.',
    )
    : hubLabel(
      'Browser mode can preload the locally mirrored secrets that were saved from the desktop settings flow.',
      '브라우저 모드는 데스크톱 설정 흐름에서 저장한 로컬 미러 비밀값을 미리 불러올 수 있습니다.',
    );
  const displayGuidanceNote = !snapshot.currentSnapshot.generatedAt
    ? hubLabel(
      'Recommended order: refresh data first, then run replay after the live snapshot updates.',
      '추천 순서: 먼저 데이터를 갱신한 뒤, 라이브 스냅샷이 업데이트되면 리플레이를 실행하세요.',
    )
    : (backtestOps?.latestReplay?.ideaRunCount || 0) === 0
      ? hubLabel(
        'The latest replay finished without investable ideas. Check Dataset Health and Immediate blockers to see why the corpus is still thin.',
        '최신 리플레이가 끝났지만 투자 가능한 아이디어가 나오지 않았습니다. 코퍼스가 왜 얇은지 Dataset Health와 Immediate blockers를 확인하세요.',
      )
      : hubLabel(
        'Recommended order: inspect Latest Replay, then Theme Pulse, then Live Briefing before taking action.',
        '추천 순서: Latest Replay, Theme Pulse, Live Briefing 순으로 확인한 뒤 행동하세요.',
      );
  */
  return `
    <div class="backtest-hub-empty-state ${toneClass(args.tone)}">
      <strong>${escapeHtml(args.title)}</strong>
      <div class="backtest-lab-note">${escapeHtml(args.body)}</div>
      ${args.steps?.length ? `
        <ul class="backtest-hub-empty-steps">
          ${args.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}
        </ul>
      ` : ''}
      ${args.actions?.length ? `
        <div class="backtest-hub-empty-actions">
          ${args.actions.map((action) => `
            <button
              type="button"
              class="backtest-lab-btn${action.tone === 'secondary' ? ' secondary' : ''}${action.tone === 'ghost' ? ' backtest-hub-ghost-btn' : ''}"
              data-action="${escapeHtml(action.action)}"
              ${action.view ? `data-view="${escapeHtml(action.view)}"` : ''}
            >
              ${escapeHtml(action.label)}
            </button>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function clearBacktestHubToast(): void {
  document.querySelector('.toast-notification.backtest-hub-toast')?.remove();
}

function showBacktestHubToast(args: {
  tone: 'positive' | 'negative' | 'neutral';
  title: string;
  detail?: string;
  durationMs?: number;
}): void {
  clearBacktestHubToast();
  const toast = document.createElement('div');
  toast.className = `toast-notification strong backtest-hub-toast ${toneClass(args.tone)}`;
  toast.innerHTML = `
    <div class="toast-strong-title">${escapeHtml(args.title)}</div>
    ${args.detail ? `<div class="toast-strong-detail">${escapeHtml(args.detail)}</div>` : ''}
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  const duration = Math.max(2500, Number(args.durationMs) || 5200);
  window.setTimeout(() => {
    toast.classList.remove('visible');
    window.setTimeout(() => toast.remove(), 320);
  }, duration);
}

function describePosture(snapshot: CurrentDecisionSupportSnapshot, workflow: WorkflowDropoffSummary): {
  label: string;
  tone: DataFlowOpsStatusTone;
  summary: string;
  nextStep: string;
} {
  const blockedStage = workflow.stages.find((stage) => stage.status === 'blocked') || null;
  if (snapshot.actNow.length > 0) {
    return {
      label: 'Selective Deploy',
      tone: 'ready',
      summary: `${snapshot.actNow.length} idea${snapshot.actNow.length === 1 ? '' : 's'} currently survive confirmation and execution gating.`,
      nextStep: 'Use the act-now bucket first, then layer defensive ballast if regime stress remains elevated.',
    };
  }
  if (snapshot.defensive.length > 0 || /risk[- ]?off/i.test(snapshot.regimeLabel)) {
    return {
      label: 'Defensive Bias',
      tone: 'watch',
      summary: `The live snapshot is reading ${snapshot.regimeLabel} conditions and prefers hedges over fresh cyclic exposure.`,
      nextStep: snapshot.defensive.length > 0
        ? 'Start with defensive cover and wait for cleaner deploy-quality confirmation.'
        : 'Keep net exposure restrained until a stronger directional idea survives the next replay pass.',
    };
  }
  return {
    label: hubLabel('Wait For Cleaner Signal', '더 선명한 신호 대기'),
    tone: blockedStage ? 'blocked' : 'watch',
    summary: blockedStage
      ? `${blockedStage.label} is the main drop-off stage, so ideas are still failing late in the workflow.`
      : hubLabel('The system is producing more watch / avoid pressure than clean deploy candidates.', '시스템이 뚜렷한 deploy 후보보다 watch / avoid 압력을 더 많이 만들고 있습니다.'),
    nextStep: blockedStage?.reasons[0] || hubLabel('Monitor the watch bucket and refresh after the next replay or data import cycle.', 'watch 버킷을 지켜보면서 다음 리플레이나 데이터 import 사이클 뒤에 다시 확인하세요.'),
  };
}

function extractCurrentLikeRun(
  ops: DataFlowOpsSnapshot['backtestOps'],
): BacktestOpsRunSummary | null {
  if (!ops?.currentLike) return null;
  return ops.currentLike;
}

function normalizeWidth(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(8, Math.min(100, (value / max) * 100));
}

function signedBarWidth(value: number, bound: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(bound) || bound <= 0) return 0;
  return Math.max(0, Math.min(100, (Math.abs(value) / bound) * 100));
}

function svgPolyline(values: number[], width: number, height: number): string {
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / Math.max(1, values.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function renderSparkline(values: number[], trend: 'positive' | 'negative' | 'neutral'): string {
  if (!values.length) {
    return '<div class="backtest-hub-empty">No curve yet</div>';
  }
  const points = svgPolyline(values, 460, 180);
  return `
    <svg class="backtest-lab-chart-svg" viewBox="0 0 460 180" preserveAspectRatio="none" aria-hidden="true">
      <polyline class="backtest-lab-equity-path ${toneClass(trend)}" points="${escapeHtml(points)}" />
    </svg>
  `;
}

function mergeRunsById(localRuns: HistoricalReplayRun[], remoteRuns: HistoricalReplayRun[]): HistoricalReplayRun[] {
  const merged = new Map<string, HistoricalReplayRun>();
  for (const run of [...localRuns, ...remoteRuns]) {
    if (!run?.id) continue;
    const existing = merged.get(run.id);
    if (!existing) {
      merged.set(run.id, run);
      continue;
    }
    const existingScore = JSON.stringify(existing).length;
    const nextScore = JSON.stringify(run).length;
    if (nextScore >= existingScore || asTs(run.completedAt) >= asTs(existing.completedAt)) {
      merged.set(run.id, run);
    }
  }
  return Array.from(merged.values()).sort((left, right) => asTs(right.completedAt) - asTs(left.completedAt));
}

function portfolioTrend(run: HistoricalReplayRun | null): 'positive' | 'negative' | 'neutral' {
  const nav = Number(run?.portfolioAccounting?.summary?.totalReturnPct);
  if (!Number.isFinite(nav)) return 'neutral';
  return nav > 0 ? 'positive' : nav < 0 ? 'negative' : 'neutral';
}

function renderRunComparisonCard(
  summary: BacktestOpsRunSummary | null,
  label: string,
  options?: {
    emptyText?: string;
    note?: string | null;
  },
): string {
  if (!summary) {
    return `
      <section class="investment-subcard backtest-hub-compare-card">
        <div class="investment-subcard-head">
          <h4>${escapeHtml(label)}</h4>
          <span class="investment-action-chip watch">N/A</span>
        </div>
        <div class="backtest-hub-empty">${escapeHtml(options?.emptyText || 'No run summary recorded yet.')}</div>
      </section>
    `;
  }

  const hitWidth = normalizeWidth(summary.costAdjustedHitRate, 100);
  const activityWidth = normalizeWidth(summary.activityScore, 100);
  const qualityWidth = normalizeWidth(summary.qualityScore, 100);
  const noIdeas = summary.ideaRunCount === 0 || summary.forwardReturnCount === 0;
  const verdict = noIdeas
    ? {
      tone: 'watch' as const,
      title: hubLabel('No-trade result', '거래 없음 결과'),
      body: hubLabel(
        'The replay finished cleanly, but this window still did not create a deployable idea.',
        '리플레이는 정상 종료됐지만, 이 구간에서는 아직 배치 가능한 아이디어가 나오지 않았습니다.',
      ),
    }
    : summary.costAdjustedAvgReturnPct > 0 && summary.qualityScore >= 55
      ? {
        tone: 'ready' as const,
        title: hubLabel('Usable signal', '사용 가능한 신호'),
        body: hubLabel(
          'This run has positive return and enough replay quality to deserve a closer review.',
          '이 실행은 수익률이 양수이고 리플레이 품질도 충분해서 한 번 더 자세히 볼 가치가 있습니다.',
        ),
      }
      : summary.qualityScore < 40 || summary.activityScore < 30
        ? {
          tone: 'watch' as const,
          title: hubLabel('Thin sample', '얇은 샘플'),
          body: hubLabel(
            'The run exists, but the sample is still thin enough that the result should be treated cautiously.',
            '실행 결과는 있지만 샘플이 아직 얇아서 조심스럽게 해석하는 편이 좋습니다.',
          ),
        }
        : {
          tone: 'blocked' as const,
          title: hubLabel('Weak result', '약한 결과'),
          body: hubLabel(
            'The run completed, but the return profile is still weak relative to the current corpus.',
            '실행은 끝났지만 현재 코퍼스 기준으로는 아직 수익 구조가 약합니다.',
          ),
        };
  return `
    <section class="investment-subcard backtest-hub-compare-card">
      <div class="investment-subcard-head">
        <h4>${escapeHtml(label)}</h4>
        <span class="investment-action-chip ${toneClass(summary.status)}">${escapeHtml(summary.status.toUpperCase())}</span>
      </div>
      <div class="backtest-hub-compare-value ${toneClass(summary.costAdjustedAvgReturnPct > 0 ? 'positive' : summary.costAdjustedAvgReturnPct < 0 ? 'negative' : 'neutral')}">
        ${formatPct(summary.costAdjustedAvgReturnPct)}
      </div>
      <div class="backtest-lab-note">
        ${summary.ideaRunCount} ideas · ${summary.forwardReturnCount} returns · ${summary.evaluationFrameCount}/${summary.frameCount} frames
      </div>
      <div class="backtest-hub-meter-list">
        <div class="backtest-hub-meter-row">
          <span>Hit rate</span>
          <b>${summary.costAdjustedHitRate}%</b>
          <div class="backtest-hub-meter"><div class="backtest-hub-meter-fill ready" style="width:${hitWidth}%"></div></div>
        </div>
        <div class="backtest-hub-meter-row">
          <span>Quality</span>
          <b>${summary.qualityScore}</b>
          <div class="backtest-hub-meter"><div class="backtest-hub-meter-fill watch" style="width:${qualityWidth}%"></div></div>
        </div>
        <div class="backtest-hub-meter-row">
          <span>Activity</span>
          <b>${summary.activityScore}</b>
          <div class="backtest-hub-meter"><div class="backtest-hub-meter-fill blocked" style="width:${activityWidth}%"></div></div>
        </div>
      </div>
      <div class="backtest-lab-note">
        ${noIdeas
          ? 'The run completed, but it did not produce investable ideas in this window yet.'
          : `Updated ${escapeHtml(formatRelativeTime(summary.updatedAt))}`}
      </div>
      <div class="backtest-hub-inline-status ${toneClass(verdict.tone)}">
        <strong>${escapeHtml(verdict.title)}</strong>
        <div class="backtest-lab-note">${escapeHtml(verdict.body)}</div>
      </div>
      ${options?.note ? `<div class="backtest-lab-note backtest-hub-inline-status watch">${escapeHtml(options.note)}</div>` : ''}
    </section>
  `;
}

function renderDecisionBucket(
  title: string,
  items: CurrentDecisionSupportItem[],
  empty: string,
): string {
  const rows = items.slice(0, 3).map((item) => `
    <div class="backtest-mission-item ${toneClass(item.bucket === 'act-now' ? 'ready' : item.bucket === 'avoid' ? 'blocked' : 'watch')}">
      <div class="backtest-mission-item-head">
        <strong>${escapeHtml(item.title)}</strong>
        <span class="investment-action-chip ${toneClass(item.bucket === 'act-now' ? 'ready' : item.bucket === 'avoid' ? 'blocked' : 'watch')}">${escapeHtml(item.action.toUpperCase())}</span>
      </div>
      <div class="backtest-mission-metrics">
        <span class="backtest-mission-chip">${escapeHtml(item.symbols.join(', ') || 'No symbols')}</span>
        <span class="backtest-mission-chip">Replay ${formatPct(item.replayAvgReturnPct)}</span>
        <span class="backtest-mission-chip">Current ${formatPct(item.currentAvgReturnPct)}</span>
      </div>
      <div class="backtest-lab-note"><strong>Suggested:</strong> ${escapeHtml(item.suggestedAction)}</div>
      <div class="backtest-lab-note"><strong>Why:</strong> ${escapeHtml(item.rationale[0] || 'Backtest and live evidence are still mixed.')}</div>
    </div>
  `).join('');
  return `
    <section class="investment-subcard">
      <div class="investment-subcard-head">
        <h4>${escapeHtml(title)}</h4>
        <span class="investment-mini-label">${items.length} items</span>
      </div>
      <div class="backtest-mission-list">
        ${rows || `<div class="backtest-mission-empty">${escapeHtml(empty)}</div>`}
      </div>
    </section>
  `;
}

function decisionSupportItemKey(item: CurrentDecisionSupportItem): string {
  return `${item.title}::${item.symbols.join('|')}::${item.action}`;
}

function dedupeDecisionBucket(
  items: CurrentDecisionSupportItem[],
  seen: Set<string>,
): CurrentDecisionSupportItem[] {
  const unique = [];
  for (const item of items) {
    const identity = decisionSupportItemKey(item);
    const fuzzyIdentity = `${item.title}::${item.symbols.join('|')}`;
    if (seen.has(identity) || seen.has(fuzzyIdentity)) continue;
    seen.add(identity);
    seen.add(fuzzyIdentity);
    unique.push(item);
  }
  return unique;
}

function normalizeDecisionSupportSnapshot(
  snapshot: CurrentDecisionSupportSnapshot,
): CurrentDecisionSupportSnapshot {
  const seen = new Set<string>();
  const actNow = dedupeDecisionBucket(snapshot.actNow, seen);
  const defensive = dedupeDecisionBucket(snapshot.defensive, seen);
  const avoid = dedupeDecisionBucket(snapshot.avoid, seen);
  const watch = dedupeDecisionBucket(snapshot.watch, seen);
  return {
    ...snapshot,
    actNow,
    defensive,
    avoid,
    watch,
  };
}

function renderDecisionBriefNotice(
  snapshot: DataFlowOpsSnapshot,
  decisionSupport: CurrentDecisionSupportSnapshot,
): string {
  const totalItems = decisionSupport.actNow.length
    + decisionSupport.defensive.length
    + decisionSupport.avoid.length
    + decisionSupport.watch.length;
  if (!snapshot.currentSnapshot.generatedAt) {
    return renderHubGuidanceState({
      tone: 'blocked',
      title: hubLabel('No live snapshot is feeding this brief yet', '아직 이 브리프를 만드는 라이브 스냅샷이 없습니다'),
      body: hubLabel(
        'The decision buckets are empty because the live investment snapshot has not been produced in this browser session yet.',
        '이 브리프가 비어 있는 가장 큰 이유는 현재 브라우저 세션에서 라이브 투자 스냅샷이 아직 생성되지 않았기 때문입니다.',
      ),
      steps: [
        hubLabel('Run Pipeline to refresh datasets and the live snapshot.', 'Run Pipeline을 먼저 눌러 데이터셋과 라이브 스냅샷을 새로 만드세요.'),
        hubLabel('After it finishes, run Replay to archive a fresh manual pass.', '완료되면 Run Replay를 눌러 최신 수동 리플레이를 아카이브하세요.'),
        hubLabel('If it stays empty, inspect the blockers in the Data tab.', '그래도 비어 있으면 Data 탭의 blocker를 먼저 확인하세요.'),
      ],
    });
  }
  if (snapshot.currentSnapshot.ideaCards === 0 || totalItems === 0) {
    return renderHubGuidanceState({
      tone: 'watch',
      title: hubLabel('The live snapshot is valid, but nothing is actionable yet', '라이브 스냅샷은 있으나 아직 행동 가능한 아이디어가 없습니다'),
      body: hubLabel(
        'This is a valid no-trade state. The page is working, but the latest signal set is not strong enough to promote into deploy-quality decisions.',
        '이건 고장이 아니라 정상적인 무신호 상태입니다. 페이지는 동작 중이지만 최신 신호가 deploy 수준까지 올라오지 못한 상태입니다.',
      ),
      steps: [
        hubLabel('Use the Theme Pulse and Dataset Health cards to see what is holding confidence down.', 'Theme Pulse와 Dataset Health 카드에서 신뢰도를 깎는 원인을 먼저 보세요.'),
        hubLabel('Try Run Pipeline before forcing another replay.', '리플레이를 반복으로 누르기 전에 Run Pipeline을 한 번 더 돌려 보세요.'),
      ],
    });
  }
  return '';
}

function renderThemePulse(snapshot: ThemeDiagnosticsSnapshot, opsSnapshot: DataFlowOpsSnapshot): string {
  if (!snapshot.rows.length) {
    if (!opsSnapshot.currentSnapshot.generatedAt) {
      return renderHubGuidanceState({
        tone: 'blocked',
        title: hubLabel('Theme diagnostics are waiting for a live snapshot', '테마 진단은 라이브 스냅샷을 기다리는 중입니다'),
        body: hubLabel(
          'Backtest runs exist, but the theme diagnostic layer has no current snapshot to compare against replay memory yet.',
          '백테스트 실행 이력은 있지만, 테마 진단 레이어가 replay 메모리와 비교할 현재 스냅샷이 아직 없습니다.',
        ),
        steps: [
        hubLabel('Run Pipeline to refresh the live snapshot and data-flow state.', 'Run Pipeline을 눌러 라이브 스냅샷과 데이터 흐름 상태를 갱신하세요.'),
          hubLabel('Then refresh this page or wait for the next auto refresh.', '그 뒤 이 페이지를 새로고침하거나 자동 새로고침을 기다리세요.'),
        ],
      });
    }
    if (opsSnapshot.currentSnapshot.ideaCards === 0) {
      return renderHubGuidanceState({
        tone: 'watch',
        title: hubLabel('No idea cards survived into theme diagnostics', '아이디어 카드가 테마 진단까지 살아남지 못했습니다'),
        body: hubLabel(
          'The latest live snapshot finished, but it produced zero idea cards, so there is nothing meaningful to rank here yet.',
          '최신 라이브 스냅샷은 끝났지만 아이디어 카드가 0개라, 여기서 순위를 매길 대상이 아직 없습니다.',
        ),
        steps: [
          hubLabel('Check Latest Replay and Current-like first.', '먼저 Latest Replay와 Current-like를 확인하세요.'),
        hubLabel('If they also show zero ideas, widen the corpus with Run Pipeline.', '거기도 0 ideas면 Run Pipeline으로 코퍼스를 더 넓히세요.'),
        ],
      });
    }
    return renderHubGuidanceState({
      tone: 'watch',
      title: hubLabel('Theme diagnostics are not ready yet', '테마 진단이 아직 준비되지 않았습니다'),
      body: hubLabel(
        'The hub has a snapshot, but the replay adaptation layer has not produced theme-level diagnostics for this state yet.',
        '허브에는 스냅샷이 있지만, 이 상태를 해석할 replay adaptation의 테마 진단이 아직 만들어지지 않았습니다.',
      ),
      steps: [
        hubLabel('Run Replay to generate a fresh run archive.', '새 실행 아카이브를 만들기 위해 Run Replay를 눌러 보세요.'),
      ],
    });
  }
  const topRows = snapshot.rows
    .slice()
    .sort((left, right) => right.diagnosticScore - left.diagnosticScore)
    .slice(0, 8);
  const maxDiag = Math.max(...topRows.map((row) => row.diagnosticScore), 1);
  const driftBound = Math.max(...topRows.map((row) => Math.abs(row.currentVsReplayDrift)), 0.5);
  return topRows.map((row) => {
    const diagWidth = normalizeWidth(row.diagnosticScore, maxDiag);
    const driftWidth = signedBarWidth(row.currentVsReplayDrift, driftBound);
    const driftTone = row.currentVsReplayDrift > 0 ? 'ready' : row.currentVsReplayDrift < 0 ? 'blocked' : 'watch';
    return `
      <div class="backtest-hub-theme-row ${toneClass(row.status)}">
        <div class="backtest-hub-theme-head">
          <strong>${escapeHtml(row.themeLabel)}</strong>
          <span class="investment-action-chip ${toneClass(row.status)}">${escapeHtml(row.confirmationState.toUpperCase())}</span>
        </div>
        <div class="backtest-hub-meter-row">
          <span>Diagnostic</span>
          <b>${formatMaybe(row.diagnosticScore, 0)}</b>
          <div class="backtest-hub-meter"><div class="backtest-hub-meter-fill ready" style="width:${diagWidth}%"></div></div>
        </div>
        <div class="backtest-hub-meter-row">
          <span>Current vs replay</span>
          <b>${formatPct(row.currentVsReplayDrift)}</b>
          <div class="backtest-hub-meter"><div class="backtest-hub-meter-fill ${driftTone}" style="width:${driftWidth}%"></div></div>
        </div>
        <div class="backtest-hub-theme-meta">
          <span>Replay ${formatPct(row.replayAvgReturnPct)}</span>
          <span>Current ${formatPct(row.currentAvgReturnPct)}</span>
          <span>Coverage ${formatMaybe(row.completenessScore, 0)}</span>
          <span>Horizon ${row.preferredHorizonHours ? `${row.preferredHorizonHours}h` : 'n/a'}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderWorkflowFunnel(summary: WorkflowDropoffSummary): string {
  const maxValue = Math.max(...summary.stages.map((stage) => stage.keptCount + stage.droppedCount), 1);
  return summary.stages.map((stage) => {
    const total = stage.keptCount + stage.droppedCount;
    const width = normalizeWidth(total, maxValue);
    return `
      <div class="backtest-hub-funnel-row ${toneClass(stage.status as DataFlowOpsStatusTone)}">
        <div class="backtest-hub-funnel-head">
          <strong>${escapeHtml(stage.label)}</strong>
          <span>${stage.keptCount} kept · ${stage.droppedCount} dropped</span>
        </div>
        <div class="backtest-hub-meter"><div class="backtest-hub-meter-fill ${toneClass(stage.status as DataFlowOpsStatusTone)}" style="width:${width}%"></div></div>
        <div class="backtest-lab-note">${escapeHtml(stage.reasons[0] || 'No dominant blocker recorded.')}</div>
      </div>
    `;
  }).join('');
}

function renderDatasetHealth(snapshot: DataFlowOpsSnapshot): string {
  const rows = snapshot.datasets
    .slice()
    .sort((left, right) => {
      const toneRank = { blocked: 3, degraded: 2, watch: 1, ready: 0 };
      return toneRank[right.status] - toneRank[left.status]
        || (right.pipelineLagMinutes ?? 0) - (left.pipelineLagMinutes ?? 0);
    })
    .slice(0, 10);
  if (!rows.length) {
    return '<tr><td colspan="7">No dataset rows recorded yet.</td></tr>';
  }
  return rows.map((row) => `
    <tr class="${toneClass(row.status)}">
      <td>${escapeHtml(row.label)}</td>
      <td>${escapeHtml(row.provider.toUpperCase())}</td>
      <td><span class="investment-action-chip ${toneClass(row.status)}">${escapeHtml(row.stageLabel.toUpperCase())}</span></td>
      <td>${row.progressPct}%</td>
      <td>${row.pipelineLagMinutes ?? 'n/a'}m</td>
      <td>${formatMaybe(row.completenessScore, 0)} / ${formatMaybe(row.coverageDensity, 0)}</td>
      <td>${escapeHtml(row.lastError || row.suggestedFix || 'Healthy')}</td>
    </tr>
  `).join('');
}

function renderTrainingInputs(snapshot: DataFlowOpsSnapshot): string {
  const datasetRows = snapshot.historicalDatasets
    .filter((dataset) => dataset.rawRecordCount > 0 || dataset.frameCount > 0)
    .sort((left, right) => right.frameCount - left.frameCount || right.rawRecordCount - left.rawRecordCount)
    .slice(0, 8);
  if (!datasetRows.length) {
    return '<tr><td colspan="4">No training corpus datasets loaded yet.</td></tr>';
  }
  return datasetRows.map((dataset) => `
    <tr>
      <td>${escapeHtml(dataset.datasetId)}</td>
      <td>${escapeHtml((dataset.provider || '-').toUpperCase())}</td>
      <td>${dataset.rawRecordCount} raw / ${dataset.frameCount} frames</td>
      <td>${escapeHtml(formatRelativeTime(dataset.importedAt || dataset.lastValidTime || null))}</td>
    </tr>
  `).join('');
}

function renderRunButtons(runs: HistoricalReplayRun[], selectedRunId: string | null): string {
  return runs.slice(0, 8).map((run) => `
    <button
      type="button"
      class="backtest-lab-run-btn${run.id === selectedRunId ? ' selected' : ''}"
      data-action="select-run"
      data-run-id="${escapeHtml(run.id)}"
    >
      <span class="backtest-lab-run-label">${escapeHtml(run.label)}</span>
      <span class="backtest-lab-run-meta">${escapeHtml(run.mode.toUpperCase())} · ${run.frameCount} frames · ${escapeHtml(formatRelativeTime(run.completedAt))}</span>
    </button>
  `).join('');
}

function buildInterpretationRows(run: HistoricalReplayRun | null): Array<{ tone: 'ready' | 'watch' | 'blocked'; title: string; body: string }> {
  if (!run) {
    return [{
      tone: 'watch',
      title: hubLabel('No selected run yet', '선택된 실행이 아직 없습니다'),
      body: hubLabel('Pick a replay, walk-forward, or current-like run to get an interpretation.', '리플레이, 워크포워드, current-like 실행 중 하나를 선택하면 해석을 볼 수 있습니다.'),
    }];
  }
  const summary = run.portfolioAccounting?.summary || null;
  const totalReturn = Number(summary?.totalReturnPct) || 0;
  const sharpe = Number(summary?.sharpeRatio) || 0;
  const gross = Number(summary?.avgGrossExposurePct) || 0;
  const mdd = Number(summary?.maxDrawdownPct) || 0;
  const tradeCount = Number(summary?.tradeCount) || run.ideaRuns.length;
  const rows: Array<{ tone: 'ready' | 'watch' | 'blocked'; title: string; body: string }> = [];

  if (totalReturn > 0 && sharpe >= 0.3) {
    rows.push({
      tone: 'ready',
      title: hubLabel('Healthy selected run', '선택된 실행은 비교적 건강합니다'),
      body: hubLabel(
        `NAV ${formatPct(totalReturn)} with Sharpe ${formatMaybe(sharpe, 2)} suggests this window is not just busy but directionally useful.`,
        `NAV ${formatPct(totalReturn)}, 샤프 ${formatMaybe(sharpe, 2)}는 이 구간이 단순히 많이 돈 것이 아니라 방향성도 비교적 유효했다는 뜻입니다.`,
      ),
    });
  } else if (totalReturn > 0) {
    rows.push({
      tone: 'watch',
      title: hubLabel('Positive but fragile', '플러스지만 아직 약합니다'),
      body: hubLabel(
        `NAV is positive at ${formatPct(totalReturn)}, but Sharpe ${formatMaybe(sharpe, 2)} says the ride is still noisy.`,
        `NAV는 ${formatPct(totalReturn)}로 플러스지만 샤프 ${formatMaybe(sharpe, 2)}를 보면 아직 변동성이 큰 편입니다.`,
      ),
    });
  } else {
    rows.push({
      tone: 'blocked',
      title: hubLabel('This window is still weak', '이 구간은 아직 약합니다'),
      body: hubLabel(
        `NAV ${formatPct(totalReturn)} and Sharpe ${formatMaybe(sharpe, 2)} mean this regime is still failing the current sizing and ranking policy.`,
        `NAV ${formatPct(totalReturn)}, 샤프 ${formatMaybe(sharpe, 2)}는 현재의 비중 및 랭킹 정책이 이 레짐에서 아직 충분히 맞지 않는다는 뜻입니다.`,
      ),
    });
  }

  if (gross < 10) {
    rows.push({
      tone: 'watch',
      title: hubLabel('Capital is still too cautious', '자본 배치가 아직 너무 보수적입니다'),
      body: hubLabel(
        `Average gross exposure is only ${formatPct(gross)}, so even a decent signal will struggle to move NAV materially.`,
        `평균 gross exposure가 ${formatPct(gross)}에 그쳐서 신호가 괜찮아도 NAV를 크게 움직이기 어렵습니다.`,
      ),
    });
  }

  if (mdd <= -5) {
    rows.push({
      tone: 'blocked',
      title: hubLabel('Drawdown still needs control', '낙폭 통제가 더 필요합니다'),
      body: hubLabel(
        `Max drawdown ${formatPct(mdd)} means the path is still too rough for a calm decision-support workflow.`,
        `최대 낙폭 ${formatPct(mdd)}는 의사결정 보조 도구로 쓰기엔 아직 경로가 거친 편이라는 뜻입니다.`,
      ),
    });
  }

  if (tradeCount < 3) {
    rows.push({
      tone: 'watch',
      title: hubLabel('Sample size is thin', '표본 수가 얇습니다'),
      body: hubLabel(
        `Only ${tradeCount} trades were recorded, so treat this run as directional evidence rather than a stable regime verdict.`,
        `${tradeCount}건만 거래가 기록돼서, 이 실행은 안정적인 결론보다 방향성 참고 자료에 가깝습니다.`,
      ),
    });
  }

  return rows.slice(0, 4);
}

function renderRunInterpretation(run: HistoricalReplayRun | null): string {
  return buildInterpretationRows(run).map((row) => `
    <div class="backtest-hub-issue ${row.tone}">
      <strong>${escapeHtml(row.title)}</strong>
      <div class="backtest-lab-note">${escapeHtml(row.body)}</div>
    </div>
  `).join('');
}

function renderSelectedRunOverview(run: HistoricalReplayRun | null): string {
  if (!run) {
    return `<div class="backtest-hub-empty">${hubLabel('No replay run is available yet.', '아직 표시할 리플레이 실행이 없습니다.')}</div>`;
  }
  const summary = run.portfolioAccounting?.summary || null;
  const curve = Array.isArray(run.portfolioAccounting?.equityCurve) ? run.portfolioAccounting!.equityCurve : [];
  const navValues = curve.map((point) => Number(point.nav) || 0).filter((value) => Number.isFinite(value) && value > 0);
  const trend = portfolioTrend(run);
  return `
    <div class="backtest-hub-selected-run">
      <div class="backtest-hub-selected-meta">
        <div class="investment-mini-label">Selected run</div>
        <h3>${escapeHtml(run.label)}</h3>
        <div class="backtest-lab-note">${escapeHtml(run.mode.toUpperCase())} · ${run.evaluationFrameCount}/${run.frameCount} frames · completed ${escapeHtml(formatDateTime(run.completedAt))}</div>
      </div>
      <div class="backtest-hub-run-metrics">
        <div class="backtest-hub-stat"><span>NAV</span><b class="${toneClass(trend)}">${formatPct(summary?.totalReturnPct)}</b></div>
        <div class="backtest-hub-stat"><span>CAGR</span><b>${formatPct(summary?.cagrPct)}</b></div>
        <div class="backtest-hub-stat"><span>MDD</span><b>${formatPct(summary?.maxDrawdownPct)}</b></div>
        <div class="backtest-hub-stat"><span>Sharpe</span><b>${formatMaybe(summary?.sharpeRatio, 2)}</b></div>
        <div class="backtest-hub-stat"><span>Gross</span><b>${formatPct(summary?.avgGrossExposurePct)}</b></div>
        <div class="backtest-hub-stat"><span>Trades</span><b>${summary?.tradeCount ?? 0}</b></div>
      </div>
      <div class="backtest-hub-sparkline-wrap">
        ${renderSparkline(navValues, trend)}
      </div>
      <div class="backtest-hub-issues">
        <h5>${hubLabel('Interpretation', '해석')}</h5>
        ${renderRunInterpretation(run)}
      </div>
    </div>
  `;
}

function runNavChange(run: HistoricalReplayRun): number {
  return Number(run.portfolioAccounting?.summary?.totalReturnPct) || 0;
}

function renderRunHistory(runs: HistoricalReplayRun[]): string {
  const recent = runs.slice(0, 10);
  if (!recent.length) {
    return '<div class="backtest-hub-empty">No recent replay history recorded yet.</div>';
  }
  const bound = Math.max(...recent.map((run) => Math.abs(runNavChange(run))), 1);
  return recent.map((run) => {
    const nav = runNavChange(run);
    const width = signedBarWidth(nav, bound);
    const tone = nav > 0 ? 'ready' : nav < 0 ? 'blocked' : 'watch';
    const tradeCount = run.portfolioAccounting?.summary?.tradeCount ?? run.ideaRuns.length;
    return `
      <div class="backtest-hub-run-history-row">
        <div class="backtest-hub-run-history-head">
          <div>
            <strong>${escapeHtml(run.label)}</strong>
            <div class="backtest-lab-note">${escapeHtml(run.mode.toUpperCase())} · ${run.evaluationFrameCount}/${run.frameCount} frames · ${tradeCount} trades</div>
          </div>
          <span class="investment-action-chip ${toneClass(tone)}">${formatPct(nav)}</span>
        </div>
        <div class="backtest-hub-run-history-bar">
          <div class="backtest-hub-run-history-zero"></div>
          <div class="backtest-hub-run-history-fill ${tone}" style="width:${width}%;${nav >= 0 ? 'left:50%;' : `left:${50 - width}%;`}"></div>
        </div>
        <div class="backtest-hub-run-history-meta">
          <span>${escapeHtml(formatRelativeTime(run.completedAt))}</span>
          <span>Horizon ${run.horizonsHours[0] ?? 'n/a'}h</span>
          <span>Ideas ${run.ideaRuns.length}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderThemeDriftMap(snapshot: ThemeDiagnosticsSnapshot, opsSnapshot: DataFlowOpsSnapshot): string {
  const rows = snapshot.rows.slice().sort((left, right) => right.diagnosticScore - left.diagnosticScore).slice(0, 12);
  if (!rows.length) {
    return renderHubGuidanceState({
      tone: opsSnapshot.currentSnapshot.generatedAt ? 'watch' : 'blocked',
      title: hubLabel('Theme drift map is waiting for comparable evidence', '테마 드리프트 맵이 비교 가능한 근거를 기다리는 중입니다'),
      body: hubLabel(
        'The scatter only appears once the hub has both a current snapshot and theme-level replay diagnostics.',
        '이 산점도는 현재 스냅샷과 테마 단위 replay 진단이 둘 다 있을 때만 의미 있게 그려집니다.',
      ),
      steps: [
        hubLabel('Run Pipeline if the live snapshot looks stale.', '라이브 스냅샷이 비어 있거나 오래됐으면 Run Pipeline을 먼저 돌리세요.'),
        hubLabel('Run Replay after that to populate comparable replay rows.', '그 다음 Run Replay로 비교 가능한 replay 행을 채우세요.'),
      ],
    });
  }
  const width = 560;
  const height = 280;
  const padX = 34;
  const padY = 24;
  const driftBound = Math.max(...rows.map((row) => Math.abs(row.currentVsReplayDrift)), 0.5);
  const maxDiag = Math.max(...rows.map((row) => row.diagnosticScore), 1);
  const circles = rows.map((row) => {
    const x = padX + ((row.currentVsReplayDrift + driftBound) / (driftBound * 2)) * (width - padX * 2);
    const y = height - padY - (row.diagnosticScore / maxDiag) * (height - padY * 2);
    const radius = 5 + Math.min(10, Math.sqrt(Math.max(1, row.cardCount + row.mappingCount)));
    return `
      <g class="backtest-hub-scatter-node ${toneClass(row.status)}">
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}"></circle>
        <text x="${x.toFixed(1)}" y="${(y - radius - 6).toFixed(1)}">${escapeHtml(row.themeLabel)}</text>
      </g>
    `;
  }).join('');

  return `
    <div class="backtest-hub-scatter-wrap">
      <svg class="backtest-hub-scatter" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <line x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}" class="backtest-hub-axis"></line>
        <line x1="${padX}" y1="${padY}" x2="${padX}" y2="${height - padY}" class="backtest-hub-axis"></line>
        <line x1="${width / 2}" y1="${padY}" x2="${width / 2}" y2="${height - padY}" class="backtest-hub-axis guide"></line>
        ${circles}
      </svg>
      <div class="backtest-hub-scatter-caption">
        <span>Negative drift</span>
        <span>Current vs replay drift</span>
        <span>Positive drift</span>
      </div>
    </div>
  `;
}

function renderSourceFamilyOverview(snapshot: DataFlowOpsSnapshot): string {
  const families = snapshot.coverage.sourceFamilies
    .slice()
    .sort((left, right) => right.frameCount - left.frameCount)
    .slice(0, 8);
  if (!families.length) {
    return '<div class="backtest-hub-empty">No source-family coverage recorded yet.</div>';
  }
  const maxFrames = Math.max(...families.map((row) => row.frameCount), 1);
  return families.map((row) => `
    <div class="backtest-hub-family-row">
      <div class="backtest-hub-family-head">
        <strong>${escapeHtml(row.sourceFamily)}</strong>
        <span>${row.datasetCount} datasets · ${row.frameCount} frames</span>
      </div>
      <div class="backtest-hub-meter-row">
        <span>Coverage</span>
        <b>${formatMaybe(row.coverageDensity, 0)}</b>
        <div class="backtest-hub-meter"><div class="backtest-hub-meter-fill ready" style="width:${normalizeWidth(row.coverageDensity, 100)}%"></div></div>
      </div>
      <div class="backtest-hub-meter-row">
        <span>Completeness</span>
        <b>${formatMaybe(row.completenessScore, 0)}</b>
        <div class="backtest-hub-meter"><div class="backtest-hub-meter-fill watch" style="width:${normalizeWidth(row.completenessScore, 100)}%"></div></div>
      </div>
      <div class="backtest-hub-meter-row">
        <span>Frame share</span>
        <b>${row.frameCount}</b>
        <div class="backtest-hub-meter"><div class="backtest-hub-meter-fill blocked" style="width:${normalizeWidth(row.frameCount, maxFrames)}%"></div></div>
      </div>
      <div class="backtest-lab-note">Lag ${formatMaybe(row.knowledgeLagHours, 1)}h · gap ${formatMaybe(row.gapRatio, 2)} · rate-limit ${formatMaybe(row.rateLimitLossEstimate, 2)}</div>
    </div>
  `).join('');
}

function renderDatasetPipelineLanes(snapshot: DataFlowOpsSnapshot): string {
  const rows = snapshot.datasets
    .slice()
    .sort((left, right) => (right.progressPct - left.progressPct) || ((left.pipelineLagMinutes ?? 9999) - (right.pipelineLagMinutes ?? 9999)))
    .slice(0, 8);
  if (!rows.length) {
    return '<div class="backtest-hub-empty">No dataset pipeline lanes available yet.</div>';
  }
  return rows.map((row) => {
    const stages = [
      { label: 'Fetch', done: Boolean(row.lastFetchAt) },
      { label: 'Import', done: Boolean(row.lastImportAt) },
      { label: 'Replay', done: Boolean(row.lastReplayAt) },
      { label: 'Walk', done: Boolean(row.lastWalkForwardAt) },
      { label: 'Discovery', done: Boolean(row.lastThemeDiscoveryAt) },
    ];
    return `
      <div class="backtest-hub-pipeline-lane ${toneClass(row.status)}">
        <div class="backtest-hub-family-head">
          <strong>${escapeHtml(row.label)}</strong>
          <span>${escapeHtml(row.stageLabel)} · ${row.progressPct}% · lag ${row.pipelineLagMinutes ?? 'n/a'}m</span>
        </div>
        <div class="backtest-hub-stage-strip">
          ${stages.map((stage) => `
            <div class="backtest-hub-stage-chip ${stage.done ? 'done' : 'pending'}">
              <span>${escapeHtml(stage.label)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderProviderMix(snapshot: DataFlowOpsSnapshot): string {
  const providerCounts = new Map<string, { datasets: number; frames: number }>();
  for (const dataset of snapshot.historicalDatasets) {
    const provider = String(dataset.provider || 'unknown').toUpperCase();
    const bucket = providerCounts.get(provider) || { datasets: 0, frames: 0 };
    bucket.datasets += 1;
    bucket.frames += dataset.frameCount || 0;
    providerCounts.set(provider, bucket);
  }
  const rows = Array.from(providerCounts.entries())
    .map(([provider, stats]) => ({ provider, ...stats }))
    .sort((left, right) => right.frames - left.frames)
    .slice(0, 8);
  if (!rows.length) {
    return '<div class="backtest-hub-empty">No provider mix available yet.</div>';
  }
  const maxFrames = Math.max(...rows.map((row) => row.frames), 1);
  return rows.map((row) => `
    <div class="backtest-hub-provider-row">
      <div class="backtest-hub-family-head">
        <strong>${escapeHtml(row.provider)}</strong>
        <span>${row.datasets} datasets</span>
      </div>
      <div class="backtest-hub-meter-row">
        <span>Frames</span>
        <b>${row.frames}</b>
        <div class="backtest-hub-meter"><div class="backtest-hub-meter-fill ready" style="width:${normalizeWidth(row.frames, maxFrames)}%"></div></div>
      </div>
    </div>
  `).join('');
}

function renderViewTabs(activeView: BacktestHubView): string {
  const tabs: Array<{ id: BacktestHubView; label: string; note: string }> = [
    { id: 'overview', label: hubLabel('Overview', '개요'), note: hubLabel('Latest runs and posture', '최신 실행과 포지션 상태') },
    { id: 'decision', label: hubLabel('Decision', '의사결정'), note: hubLabel('Themes and live guidance', '테마와 현재 행동 가이드') },
    { id: 'data', label: hubLabel('Data', '데이터'), note: hubLabel('Coverage and dataset flow', '커버리지와 처리 흐름') },
    { id: 'history', label: hubLabel('History', '히스토리'), note: hubLabel('Run history and drift', '실행 이력과 드리프트') },
  ];
  return tabs.map((tab) => `
    <button
      type="button"
      class="backtest-hub-tab${tab.id === activeView ? ' selected' : ''}"
      data-action="set-view"
      data-view="${tab.id}"
      aria-label="${escapeHtml(tab.label)}"
    >
      <strong>${escapeHtml(tab.label)}</strong>
      <span>${escapeHtml(tab.note)}</span>
    </button>
  `).join('');
}

function renderActivityBanner(
  snapshot: DataFlowOpsSnapshot,
  backtestOps: DataFlowOpsSnapshot['backtestOps'] | null,
  issues: DataFlowOpsSnapshot['issues'],
  pendingAction: 'replay' | 'scheduler' | null,
  actionMessage: { tone: DataFlowOpsStatusTone | 'positive' | 'negative' | 'neutral'; text: string } | null,
  highlightCompletion: boolean,
  refreshError: string | null,
): string {
  const running = snapshot.pipeline.activeCycleStatus === 'running';
  const blockedDatasets = snapshot.datasets.filter((row) => row.status === 'blocked').length;
  const degradedDatasets = snapshot.datasets.filter((row) => row.status === 'degraded').length;
  const totalAttentionDatasets = blockedDatasets + degradedDatasets;
  const hasLiveSnapshot = Boolean(snapshot.currentSnapshot.generatedAt);
  const topIssue = issues[0] || null;
  const tone: DataFlowOpsStatusTone = running
    ? 'ready'
    : topIssue
      ? topIssue.status
      : 'watch';
  const shouldRefreshFirst = !hasLiveSnapshot || totalAttentionDatasets > 0;
  const primaryAction = running
    ? null
    : shouldRefreshFirst
      ? 'scheduler'
      : 'replay';
  const primaryLabel = primaryAction === 'scheduler'
    ? hubLabel('Refresh Data First', '먼저 데이터 갱신')
    : primaryAction === 'replay'
      ? hubLabel('Run Replay Now', '지금 리플레이 실행')
      : hubLabel('Cycle Running', '실행 중');
  const replayDisabled = Boolean(pendingAction || running || !hasLiveSnapshot);
  const schedulerDisabled = Boolean(pendingAction || running);
  const title = running
    ? `Training cycle is active: ${snapshot.pipeline.activeStage || 'processing'}`
    : hubLabel(
      `Training cycle is idle. Last completed ${formatRelativeTime(snapshot.pipeline.latestCycleAt)}.`,
      `훈련 사이클은 대기 중입니다. 마지막 완료는 ${formatRelativeTime(snapshot.pipeline.latestCycleAt)}입니다.`,
    );
  const detail = running
    ? `${snapshot.pipeline.activeProgressPct ?? 0}% complete - dataset ${snapshot.pipeline.activeDatasetId || 'global'} - heartbeat ${snapshot.pipeline.heartbeatLagMinutes ?? 'n/a'}m ago`
    : `${blockedDatasets} blocked dataset${blockedDatasets === 1 ? '' : 's'} - ${degradedDatasets} degraded - queue depth ${snapshot.pipeline.openThemeQueueDepth} - source ${snapshot.pipeline.source}`;
  const modeNote = isDesktopRuntime()
    ? 'Desktop mode can use vault-backed secrets after they save successfully.'
    : 'Chrome mode now attempts to preload the same locally mirrored secrets that desktop settings saved.';
  const guidanceNote = !snapshot.currentSnapshot.generatedAt
    ? hubLabel('Recommended flow: Run Pipeline first, then Run Replay once the live snapshot is fresh.', '추천 흐름: 먼저 파이프라인을 돌린 뒤, 라이브 스냅샷이 새로워지면 리플레이를 실행하세요.')
    : (backtestOps?.latestReplay?.ideaRunCount || 0) === 0
      ? 'Latest replay finished without investable ideas. Use Dataset Health and blockers below to see why the corpus is still thin.'
      : 'Recommended flow: inspect Latest Replay, then Theme Pulse, then Decision Brief before taking action.';
  return `
    <section class="investment-subcard backtest-hub-activity ${tone}${highlightCompletion ? ' attention' : ''}">
      <div class="backtest-hub-activity-head">
        <div>
          <div class="investment-mini-label">${hubLabel('Pipeline Activity', '파이프라인 활동')}</div>
          <strong>${escapeHtml(title)}</strong>
        </div>
        <div class="backtest-hub-activity-actions">
          <span class="investment-action-chip ${toneClass(tone)}">${escapeHtml(hubStatusLabel(running ? 'running' : 'idle'))}</span>
          <div class="backtest-hub-primary-actions">
            ${primaryAction ? `
              <button
                type="button"
                class="backtest-lab-btn backtest-hub-primary-btn"
                data-action="start-${primaryAction}"
                ${primaryAction === 'replay' && replayDisabled ? ' disabled' : ''}
                ${primaryAction === 'scheduler' && schedulerDisabled ? ' disabled' : ''}
              >
                ${escapeHtml(primaryLabel)}
              </button>
            ` : ''}
            <button
              type="button"
              class="backtest-lab-btn secondary"
              data-action="start-scheduler"
              ${schedulerDisabled || primaryAction === 'scheduler' ? ' disabled' : ''}
            >
              ${pendingAction === 'scheduler' ? hubLabel('Running Pipeline...', '파이프라인 실행 중...') : hubLabel('Run Pipeline', '파이프라인 실행')}
            </button>
            <button
              type="button"
              class="backtest-lab-btn secondary"
              data-action="start-replay"
              ${replayDisabled || primaryAction === 'replay' ? ' disabled' : ''}
            >
              ${pendingAction === 'replay' ? hubLabel('Running Replay...', '리플레이 실행 중...') : hubLabel('Run Replay', '리플레이 실행')}
            </button>
          </div>
        </div>
      </div>
      <div class="backtest-lab-note">${escapeHtml(detail)}</div>
      <div class="backtest-lab-note">${escapeHtml(modeNote)}</div>
      <div class="backtest-lab-note">${hubLabel('Run Replay archives a fresh manual evidence pass. Run Pipeline refreshes datasets, the live snapshot, and tuning in one cycle.', '리플레이는 최신 수동 증거 패스를 저장하고, 파이프라인은 데이터셋, 라이브 스냅샷, 튜닝을 한 번에 갱신합니다.')}</div>
      <div class="backtest-lab-note"><strong>${hubLabel('Recommended', '추천')}:</strong> ${escapeHtml(guidanceNote)}</div>
      <div class="backtest-hub-inline-status ${toneClass(shouldRefreshFirst ? 'watch' : 'ready')}">
        <strong>${escapeHtml(hubLabel('Recommended next click', '추천 다음 클릭'))}</strong>
        <div class="backtest-lab-note">
          ${escapeHtml(
            running
              ? hubLabel('Wait for the running cycle to finish, then review the refreshed results.', '현재 실행 중인 작업이 끝난 뒤 새 결과를 확인하세요.')
              : shouldRefreshFirst
                ? hubLabel('Refresh data first so replay runs on a fresher corpus and snapshot.', '리플레이 전에 데이터를 먼저 갱신해서 더 최신 코퍼스와 스냅샷으로 돌리세요.')
                : hubLabel('The corpus is fresh enough now, so a manual replay is the fastest next step.', '지금은 코퍼스가 충분히 최신이라 수동 리플레이가 가장 빠른 다음 단계입니다.'),
          )}
        </div>
      </div>
      ${topIssue ? `<div class="backtest-lab-note"><strong>Top blocker:</strong> ${escapeHtml(topIssue.title)} - ${escapeHtml(topIssue.detail)}</div>` : ''}
      ${refreshError ? `<div class="backtest-lab-note backtest-hub-inline-status watch"><strong>Refresh warning:</strong> ${escapeHtml(refreshError)}. Showing the last known good state.</div>` : ''}
      ${actionMessage ? `<div class="backtest-lab-note backtest-hub-inline-status ${toneClass(actionMessage.tone)}">${escapeHtml(actionMessage.text)}</div>` : ''}
    </section>
  `;
}

function renderGuidedFlow(
  snapshot: DataFlowOpsSnapshot,
  latestReplaySummary: BacktestOpsRunSummary | null,
  decisionSupport: CurrentDecisionSupportSnapshot,
  selectedRun: HistoricalReplayRun | null,
): string {
  const blockedDatasets = snapshot.datasets.filter((row) => row.status === 'blocked' || row.status === 'degraded').length;
  const liveSnapshotReady = Boolean(snapshot.currentSnapshot.generatedAt);
  const replayIdeas = latestReplaySummary?.ideaRunCount ?? 0;
  const totalDecisionItems = decisionSupport.actNow.length
    + decisionSupport.defensive.length
    + decisionSupport.avoid.length
    + decisionSupport.watch.length;
  const steps: Array<{
    status: 'ready' | 'watch' | 'blocked';
    eyebrow: string;
    title: string;
    body: string;
    ctaLabel: string;
    action: HubGuidanceAction['action'];
    badge: string;
    view?: BacktestHubView;
  }> = [
    {
      status: !liveSnapshotReady ? 'blocked' : blockedDatasets > 0 ? 'watch' : 'ready',
      eyebrow: hubLabel('Step 1', '1단계'),
      title: hubLabel('Refresh the corpus', '코퍼스 새로고침'),
      body: liveSnapshotReady
        ? hubLabel(
          `The latest live snapshot is ${formatRelativeTime(snapshot.currentSnapshot.generatedAt)} old. ${blockedDatasets} dataset blocker${blockedDatasets === 1 ? '' : 's'} still need attention.`,
          `최신 라이브 스냅샷은 ${formatRelativeTime(snapshot.currentSnapshot.generatedAt)} 기준이며, 아직 ${blockedDatasets}개 데이터셋 blocker가 남아 있습니다.`,
        )
        : hubLabel(
          'No fresh live snapshot exists yet, so replay and decision cards are still running on stale context.',
          '아직 최신 라이브 스냅샷이 없어서 리플레이와 의사결정 카드가 오래된 문맥에 기대고 있습니다.',
        ),
      ctaLabel: hubLabel('Run Pipeline', '파이프라인 실행'),
      action: 'start-scheduler' as const,
      badge: liveSnapshotReady
        ? hubLabel(`${blockedDatasets} blockers`, `${blockedDatasets}개 blocker`)
        : hubLabel('Snapshot missing', '스냅샷 없음'),
    },
    {
      status: !latestReplaySummary ? 'blocked' : replayIdeas === 0 ? 'watch' : 'ready',
      eyebrow: hubLabel('Step 2', '2단계'),
      title: hubLabel('Archive a replay', '리플레이 저장'),
      body: !latestReplaySummary
        ? hubLabel(
          'No replay summary has been archived yet. Run a manual replay so the hub has a concrete result set to compare.',
          '아직 저장된 리플레이 요약이 없습니다. 수동 리플레이를 한 번 돌려 비교 가능한 결과 세트를 만드세요.',
        )
        : replayIdeas === 0
          ? hubLabel(
            'The latest replay completed, but it produced no investable ideas. This is a thin-corpus state, not a broken page.',
            '최신 리플레이는 완료됐지만 투자 가능한 아이디어가 나오지 않았습니다. 페이지 고장보다 코퍼스가 얇은 상태에 가깝습니다.',
          )
          : hubLabel(
            `Latest replay is archived and produced ${replayIdeas} investable idea${replayIdeas === 1 ? '' : 's'}.`,
            `최신 리플레이가 저장되어 있고 투자 가능한 아이디어 ${replayIdeas}개가 생성됐습니다.`,
          ),
      ctaLabel: hubLabel('Run Replay', '리플레이 실행'),
      action: 'start-replay' as const,
      badge: latestReplaySummary
        ? hubLabel(`Updated ${formatRelativeTime(latestReplaySummary.updatedAt)}`, `${formatRelativeTime(latestReplaySummary.updatedAt)} 갱신`)
        : hubLabel('No replay yet', '리플레이 없음'),
    },
    {
      status: !selectedRun ? 'blocked' : totalDecisionItems === 0 ? 'watch' : 'ready',
      eyebrow: hubLabel('Step 3', '3단계'),
      title: hubLabel('Read the outcome', '결과 읽기'),
      body: !selectedRun
        ? hubLabel(
          'A selected run is still missing, so there is nothing concrete to interpret yet.',
          '선택된 실행이 아직 없어서 구체적으로 해석할 결과가 없습니다.',
        )
        : totalDecisionItems === 0
          ? hubLabel(
            'A run exists, but the live decision layer still says no clear action. Read the Decision and Data tabs together.',
            '실행 결과는 있지만 라이브 의사결정 레이어는 아직 명확한 액션이 없다고 말합니다. Decision과 Data 탭을 같이 보세요.',
          )
          : hubLabel(
            'The run and the live snapshot now line up closely enough to review what to deploy, hedge, avoid, or simply watch.',
            '이제 실행 결과와 라이브 스냅샷이 충분히 맞물려서 무엇을 배치하고 헤지하고 피하거나 관찰할지 검토할 수 있습니다.',
          ),
      ctaLabel: totalDecisionItems > 0
        ? hubLabel('Open Decision', 'Decision 열기')
        : hubLabel('Open Data Checks', '데이터 점검 열기'),
      action: 'set-view' as const,
      view: totalDecisionItems > 0 ? 'decision' : 'data',
      badge: totalDecisionItems > 0
        ? hubLabel(`${totalDecisionItems} guidance items`, `${totalDecisionItems}개 가이드`)
        : hubLabel('No live guidance yet', '라이브 가이드 없음'),
    },
  ];

  return `
    <section class="investment-subcard backtest-hub-panel backtest-hub-runbook">
      <div class="investment-subcard-head">
        <div>
          <h4>${hubLabel('Recommended flow', '추천 흐름')}</h4>
          <div class="backtest-lab-note">${hubLabel(
            'If you are unsure what to click next, follow these three steps in order.',
            '다음에 무엇을 눌러야 할지 헷갈리면 이 세 단계를 순서대로 따라가면 됩니다.',
          )}</div>
        </div>
      </div>
      <div class="backtest-hub-runbook-grid">
        ${steps.map((step) => `
          <article class="backtest-hub-runbook-step ${step.status}">
            <div class="backtest-hub-runbook-head">
              <div>
                <div class="investment-mini-label">${escapeHtml(step.eyebrow)}</div>
                <strong>${escapeHtml(step.title)}</strong>
              </div>
              <span class="investment-action-chip ${step.status}">${escapeHtml(step.badge)}</span>
            </div>
            <div class="backtest-lab-note">${escapeHtml(step.body)}</div>
            <div class="backtest-hub-runbook-actions">
              <button
                type="button"
                class="backtest-lab-btn${step.action === 'set-view' ? ' secondary' : ''}"
                data-action="${escapeHtml(step.action)}"
                ${step.view ? `data-view="${escapeHtml(step.view)}"` : ''}
              >
                ${escapeHtml(step.ctaLabel)}
              </button>
            </div>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function renderViewSectionLead(view: BacktestHubView): string {
  const content = {
    overview: {
      title: hubLabel('Overview mode', '개요 모드'),
      body: hubLabel(
        'Start here when you want the shortest path from pipeline state to the latest replay outcome.',
        '파이프라인 상태부터 최신 리플레이 결과까지 가장 짧은 흐름으로 보고 싶을 때 여기서 시작하세요.',
      ),
    },
    decision: {
      title: hubLabel('Decision mode', '의사결정 모드'),
      body: hubLabel(
        'Use this view when you want to understand what the current snapshot is actually suggesting.',
        '현재 스냅샷이 실제로 무엇을 시사하는지 해석하고 싶을 때 이 화면을 보세요.',
      ),
    },
    data: {
      title: hubLabel('Data mode', '데이터 모드'),
      body: hubLabel(
        'Use this view when replay results look thin, blocked, or stale and you need to inspect the corpus itself.',
        '리플레이 결과가 얇거나 막혀 보일 때 코퍼스와 처리 상태 자체를 확인하려면 이 화면을 보세요.',
      ),
    },
    history: {
      title: hubLabel('History mode', '히스토리 모드'),
      body: hubLabel(
        'Use this view to compare runs, inspect drift, and see whether the latest result is part of a broader pattern.',
        '실행 이력을 비교하고 드리프트를 보면서 최신 결과가 더 넓은 패턴의 일부인지 확인할 때 이 화면을 보세요.',
      ),
    },
  } satisfies Record<BacktestHubView, { title: string; body: string }>;
  return `
    <section class="investment-subcard backtest-hub-panel backtest-hub-view-lead">
      <div class="investment-subcard-head">
        <h4>${escapeHtml(content[view].title)}</h4>
      </div>
      <div class="backtest-lab-note">${escapeHtml(content[view].body)}</div>
    </section>
  `;
}

function renderRunWorkspace(
  runs: HistoricalReplayRun[],
  selectedRunId: string | null,
  selectedRun: HistoricalReplayRun | null,
): string {
  if (!runs.length) {
    return renderHubGuidanceState({
      tone: 'watch',
      title: hubLabel('No replay archive is loaded yet', '아직 불러온 리플레이 아카이브가 없습니다'),
      body: hubLabel(
        'This panel turns into your main review workspace after the first replay finishes and archives at least one run.',
        '이 패널은 첫 리플레이가 끝나고 실행 결과가 하나 이상 저장된 뒤부터 핵심 리뷰 공간이 됩니다.',
      ),
      steps: [
        hubLabel('Run Pipeline first if you need to refresh or expand the corpus.', '먼저 코퍼스를 새로 만들거나 넓혀야 하면 Run Pipeline을 누르세요.'),
        hubLabel('Run Replay when you want a concrete manual result to inspect.', '직접 확인할 수동 결과가 필요하면 Run Replay를 누르세요.'),
      ],
      actions: [
        { label: hubLabel('Run Replay', '리플레이 실행'), action: 'start-replay' },
        { label: hubLabel('Run Pipeline', '파이프라인 실행'), action: 'start-scheduler', tone: 'secondary' },
      ],
    });
  }
  return `
    <div class="backtest-lab-run-list">${renderRunButtons(runs, selectedRunId)}</div>
    ${renderSelectedRunOverview(selectedRun)}
  `;
}

function renderRunHistoryWorkspace(runs: HistoricalReplayRun[]): string {
  if (!runs.length) {
    return renderHubGuidanceState({
      tone: 'watch',
      title: hubLabel('No recent replay history is recorded yet', '최근 리플레이 이력이 아직 기록되지 않았습니다'),
      body: hubLabel(
        'This history view becomes useful once replay runs start accumulating, because then you can compare windows instead of looking at a single result.',
        '이 히스토리 보기는 리플레이 실행이 쌓이기 시작할 때부터 의미가 커집니다. 그때부터 단일 결과가 아니라 여러 시간대를 비교할 수 있기 때문입니다.',
      ),
      actions: [
        { label: hubLabel('Run Replay', '리플레이 실행'), action: 'start-replay' },
        { label: hubLabel('Run Pipeline', '파이프라인 실행'), action: 'start-scheduler', tone: 'secondary' },
      ],
    });
  }
  return `<div class="backtest-hub-run-history-list">${renderRunHistory(runs)}</div>`;
}

class BacktestHubWindow {
  private readonly root: HTMLElement;
  private snapshot: DataFlowOpsSnapshot | null = null;
  private runs: HistoricalReplayRun[] = [];
  private selectedRunId: string | null = null;
  private view: BacktestHubView = 'overview';
  private locale: BacktestHubLocale = resolveInitialHubLocale();
  private pendingAction: 'replay' | 'scheduler' | null = null;
  private actionMessage: { tone: DataFlowOpsStatusTone | 'positive' | 'negative' | 'neutral'; text: string } | null = null;
  private attentionUntil = 0;
  private lastCompletionTitle: string | null = null;
  private lastObservedCycleStatus: string | null = null;
  private lastObservedLatestCycleAt: string | null = null;
  private lastAnnouncedCycleKey: string | null = null;
  private suppressCycleAnnouncementKey: string | null = null;
  private hasObservedPipelineState = false;
  private unsubscribe: (() => void) | null = null;
  private refreshTimer: number | null = null;
  private loading = false;
  private queuedRefresh = false;
  private queuedForceRefresh = false;
  private lastRefreshError: string | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const actionEl = target?.closest<HTMLElement>('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action || '';
      if (action === 'refresh') {
        void this.refresh(true);
        return;
      }
      if (action === 'start-replay') {
        if (!this.pendingAction) {
          void this.startReplay();
        }
        return;
      }
      if (action === 'start-scheduler') {
        if (!this.pendingAction) {
          void this.startScheduler();
        }
        return;
      }
      if (action === 'open-settings') {
        void this.openSettings();
        return;
      }
      if (action === 'select-run') {
        this.selectedRunId = actionEl.dataset.runId || null;
        this.render();
        return;
      }
      if (action === 'set-view') {
        const nextView = actionEl.dataset.view as BacktestHubView | undefined;
        if (nextView) {
          this.view = nextView;
          this.render();
        }
        return;
      }
      if (action === 'set-locale') {
        const nextLocale = actionEl.dataset.locale === 'ko' ? 'ko' : 'en';
        this.locale = nextLocale;
        setActiveHubLocale(nextLocale);
        this.render();
      }
    });
  }

  async init(): Promise<void> {
    this.unsubscribe = subscribeDataFlowOpsSnapshot((snapshot) => {
      this.handlePipelineTransition(snapshot);
      this.snapshot = snapshot;
      if (!this.selectedRunId && this.runs[0]) {
        this.selectedRunId = this.runs[0].id;
      }
      if (!this.loading) {
        this.render();
      }
    });
    this.refreshTimer = window.setInterval(() => {
      void this.refresh(false);
    }, AUTO_REFRESH_MS);
    window.addEventListener('beforeunload', () => this.destroy(), { once: true });
    await this.refresh(true);
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.refreshTimer != null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async refresh(forceRefresh: boolean): Promise<void> {
    if (this.loading) {
      this.queuedRefresh = true;
      this.queuedForceRefresh = this.queuedForceRefresh || forceRefresh;
      return;
    }
    this.loading = true;
    this.renderLoading(forceRefresh);
    try {
      const snapshotPromise = forceRefresh ? refreshDataFlowOpsSnapshot() : getDataFlowOpsSnapshot();
      const preferRemoteRuns = canUseLocalAgentEndpoints();
      const [snapshotResult, remoteRunsResult] = await Promise.allSettled([
        snapshotPromise,
        preferRemoteRuns ? loadLocalBacktestRunsRemote(12) : Promise.resolve([] as HistoricalReplayRun[]),
      ]);
      if (snapshotResult.status !== 'fulfilled') {
        throw snapshotResult.reason;
      }
      const snapshot = snapshotResult.value;
      const remoteRuns = remoteRunsResult.status === 'fulfilled'
        ? remoteRunsResult.value
        : [];
      const localRunsResult = (!preferRemoteRuns || remoteRuns.length === 0)
        ? await Promise.allSettled([listHistoricalReplayRuns(12)])
        : null;
      const localRuns = localRunsResult?.[0]?.status === 'fulfilled'
        ? localRunsResult[0].value
        : [];
      this.handlePipelineTransition(snapshot);
      this.snapshot = snapshot;
      this.runs = mergeRunsById(localRuns, remoteRuns);
      const partialErrors = [];
      if (remoteRunsResult.status === 'rejected') {
        partialErrors.push(remoteRunsResult.reason instanceof Error ? remoteRunsResult.reason.message : 'Remote run history unavailable');
      }
      if (localRunsResult?.[0]?.status === 'rejected') {
        partialErrors.push(localRunsResult[0].reason instanceof Error ? localRunsResult[0].reason.message : 'Local run history unavailable');
      }
      this.lastRefreshError = partialErrors.length ? partialErrors.join(' | ') : null;
      if (!this.selectedRunId || !this.runs.some((run) => run.id === this.selectedRunId)) {
        this.selectedRunId = this.runs[0]?.id || null;
      }
      this.render();
    } catch (error) {
      this.lastRefreshError = error instanceof Error ? error.message : 'Hub refresh failed';
      if (this.snapshot) {
        this.render();
      } else {
        this.root.innerHTML = `
          <div class="backtest-hub-shell">
            <section class="backtest-hub-hero investment-subcard">
              <div>
                <div class="investment-mini-label">${APP_BRAND.hubs.backtest}</div>
                <h1>${hubLabel('The hub could not load its initial state', '허브 초기 상태를 불러오지 못했습니다')}</h1>
                <div class="backtest-lab-note">${escapeHtml(this.lastRefreshError)}</div>
                <div class="backtest-lab-note">${hubLabel('Check the local sidecar/proxy path and try Refresh again.', '로컬 사이드카/프록시 경로를 확인한 뒤 Refresh를 다시 실행하세요.')}</div>
              </div>
            </section>
          </div>
        `;
      }
    } finally {
      this.loading = false;
      if (this.queuedRefresh) {
        const nextForceRefresh = this.queuedForceRefresh;
        this.queuedRefresh = false;
        this.queuedForceRefresh = false;
        void this.refresh(nextForceRefresh);
      }
    }
  }

  private async openSettings(): Promise<void> {
    if (isDesktopRuntime()) {
      await tryInvokeTauri<void>('open_settings_window_command');
      return;
    }
    const popup = window.open('/settings.html', '_blank', 'noopener');
    if (!popup) {
      window.location.assign('/settings.html');
    }
  }

  private announceCompletion(args: {
    tone: 'positive' | 'negative' | 'neutral';
    title: string;
    detail?: string;
  }): void {
    this.attentionUntil = Date.now() + 6000;
    this.lastCompletionTitle = args.title;
    showBacktestHubToast({
      tone: args.tone,
      title: args.title,
      detail: args.detail,
      durationMs: 5600,
    });
  }

  private handlePipelineTransition(snapshot: DataFlowOpsSnapshot): void {
    const nextStatus = snapshot.pipeline.activeCycleStatus || 'idle';
    const nextCompletedAt = snapshot.pipeline.latestCycleAt || null;
    const nextError = snapshot.pipeline.lastError || null;
    const prevStatus = this.lastObservedCycleStatus;
    const prevCompletedAt = this.lastObservedLatestCycleAt;

    if (!this.hasObservedPipelineState) {
      this.hasObservedPipelineState = true;
      this.lastObservedCycleStatus = nextStatus;
      this.lastObservedLatestCycleAt = nextCompletedAt;
      return;
    }

    const completionKey = `${nextStatus}:${nextCompletedAt || 'none'}:${nextError || 'ok'}`;
    const transitionedFromRunning = prevStatus === 'running' && nextStatus !== 'running';
    const sawNewCompletion = Boolean(nextCompletedAt && nextCompletedAt !== prevCompletedAt);

    if ((transitionedFromRunning || sawNewCompletion) && this.suppressCycleAnnouncementKey === completionKey) {
      this.lastAnnouncedCycleKey = completionKey;
      this.suppressCycleAnnouncementKey = null;
    } else if ((transitionedFromRunning || sawNewCompletion) && this.lastAnnouncedCycleKey !== completionKey) {
      this.lastAnnouncedCycleKey = completionKey;
      this.announceCompletion({
        tone: nextError ? 'negative' : 'positive',
        title: nextError
          ? hubLabel('Training Cycle Needs Attention', '훈련 사이클 점검 필요')
          : hubLabel('Training Cycle Finished', '훈련 사이클 완료'),
        detail: nextError
          ? nextError
          : hubLabel(
            `Completed ${formatRelativeTime(nextCompletedAt)} from ${snapshot.pipeline.source}.`,
            `${snapshot.pipeline.source} 기준으로 ${formatRelativeTime(nextCompletedAt)}에 완료되었습니다.`,
          ),
      });
    }

    this.lastObservedCycleStatus = nextStatus;
    this.lastObservedLatestCycleAt = nextCompletedAt;
  }

  private buildCompletionActionMessage(kind: 'replay' | 'scheduler', fallbackText: string): {
    tone: DataFlowOpsStatusTone | 'positive' | 'negative' | 'neutral';
    text: string;
  } {
    if (this.lastRefreshError) {
      return {
        tone: 'watch',
        text: hubLabel(
          `${kind === 'scheduler' ? 'Scheduler cycle completed' : 'Replay completed'}, but the hub could not refresh all latest sections: ${this.lastRefreshError}`,
          `${kind === 'scheduler' ? '스케줄러 사이클' : '리플레이'}은 끝났지만, 허브의 최신 섹션을 모두 새로고침하지 못했습니다: ${this.lastRefreshError}`,
        ),
      };
    }
    const topIssue = this.snapshot?.issues[0] || null;
    if (kind === 'replay') {
      const selectedRun = this.runs.find((run) => run.id === this.selectedRunId) || this.runs[0] || null;
      const tradeCount = Number(selectedRun?.portfolioAccounting?.summary?.tradeCount) || selectedRun?.ideaRuns.length || 0;
      if (selectedRun && tradeCount === 0) {
        return {
          tone: 'watch',
          text: hubLabel(
            'Replay finished, but the latest window still produced 0 investable ideas. Check Dataset Health and Theme Pulse for the blocker.',
            '리플레이는 끝났지만 최신 구간에서 아직 투자 가능한 아이디어가 0건입니다. Dataset Health와 Theme Pulse에서 막힘 요인을 확인하세요.',
          ),
        };
      }
    }
    if (topIssue) {
      return {
        tone: topIssue.status === 'blocked' ? 'negative' : 'watch',
        text: hubLabel(
          `${kind === 'scheduler' ? 'Scheduler finished with follow-up needed' : 'Replay finished with follow-up needed'}: ${topIssue.title}. ${topIssue.detail}`,
          `${kind === 'scheduler' ? '스케줄러는 끝났지만 후속 조치가 필요합니다' : '리플레이는 끝났지만 후속 조치가 필요합니다'}: ${topIssue.title}. ${topIssue.detail}`,
        ),
      };
    }
    return { tone: 'positive', text: fallbackText };
  }

  private async startReplay(): Promise<void> {
    const latestSnapshot = await refreshDataFlowOpsSnapshot({ forceRefresh: true }).catch(() => getDataFlowOpsSnapshot());
    if (latestSnapshot.pipeline.activeCycleStatus === 'running') {
      const message = hubLabel(
        'A pipeline cycle is still running. Wait for it to finish before starting a manual replay.',
        '파이프라인 사이클이 아직 실행 중입니다. 끝난 뒤에 수동 리플레이를 시작하세요.',
      );
      this.actionMessage = { tone: 'watch', text: message };
      this.announceCompletion({
        tone: 'negative',
        title: hubLabel('Replay Blocked', '리플레이 보류'),
        detail: message,
      });
      this.render();
      return;
    }
    this.pendingAction = 'replay';
    this.actionMessage = {
      tone: 'watch',
      text: hubLabel(
        'Starting a fresh replay against the latest historical corpus...',
        '최신 히스토리컬 코퍼스를 기준으로 새 리플레이를 시작합니다...',
      ),
    };
    showBacktestHubToast({
      tone: 'neutral',
      title: hubLabel('Replay Started', '리플레이 시작'),
      detail: hubLabel('Running a fresh replay against the latest historical corpus.', '최신 히스토리컬 코퍼스를 기준으로 새 리플레이를 실행하고 있습니다.'),
      durationMs: 2600,
    });
    this.render();
    try {
      const payload = await startLocalReplayNowRemote();
      const label = payload.run?.label || hubLabel('Manual Hub Replay', '허브 수동 리플레이');
      if (payload.run?.id) {
        this.selectedRunId = payload.run.id;
        const hydratedRun = await getLocalBacktestRunRemote(payload.run.id).catch(() => null);
        if (hydratedRun) {
          this.runs = mergeRunsById(this.runs, [hydratedRun]);
        }
      }
      this.actionMessage = {
        tone: 'positive',
        text: hubLabel(
          `${label} completed${payload.defaultsUsed?.maxFrames ? ` using ${payload.defaultsUsed.maxFrames} frames` : ``} . Refreshing run history...`.replace('  .', '.'),
          `${label} 완료${payload.defaultsUsed?.maxFrames ? ` · ${payload.defaultsUsed.maxFrames} 프레임 사용` : ''}. 실행 이력을 새로고침합니다...`,
        ),
      };
      this.announceCompletion({
        tone: 'positive',
        title: hubLabel('Replay Finished', '리플레이 완료'),
        detail: hubLabel(
          `${label}${payload.defaultsUsed?.maxFrames ? ` - ${payload.defaultsUsed.maxFrames} frames` : ``}`,
          `${label}${payload.defaultsUsed?.maxFrames ? ` - ${payload.defaultsUsed.maxFrames} 프레임` : ''}`,
        ),
      });
      await this.refresh(true);
      this.actionMessage = this.buildCompletionActionMessage(
        'replay',
        hubLabel(
          `${label} completed and refreshed the replay archive.`,
          `${label} 완료 후 리플레이 아카이브를 새로고침했습니다.`,
        ),
      );
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : hubLabel('Replay trigger failed', '리플레이 실행 요청이 실패했습니다.');
      const message = localizeHubErrorMessage(rawMessage);
      this.actionMessage = { tone: 'negative', text: message };
      this.announceCompletion({
        tone: 'negative',
        title: hubLabel('Replay Failed', '리플레이 실패'),
        detail: message,
      });
    } finally {
      this.pendingAction = null;
      this.render();
    }
  }

  private async startScheduler(): Promise<void> {
    const latestSnapshot = await refreshDataFlowOpsSnapshot({ forceRefresh: true }).catch(() => getDataFlowOpsSnapshot());
    if (latestSnapshot.pipeline.activeCycleStatus === 'running') {
      const message = hubLabel(
        'A pipeline cycle is already running. Wait for the current cycle to finish before starting another one.',
        '파이프라인 사이클이 이미 실행 중입니다. 현재 사이클이 끝난 뒤에 다시 시작하세요.',
      );
      this.actionMessage = { tone: 'watch', text: message };
      this.announceCompletion({
        tone: 'negative',
        title: hubLabel('Pipeline Already Running', '파이프라인 실행 중'),
        detail: message,
      });
      this.render();
      return;
    }
    this.pendingAction = 'scheduler';
    this.actionMessage = {
      tone: 'watch',
      text: hubLabel('Starting one full pipeline cycle...', '전체 파이프라인 사이클을 시작합니다...'),
    };
    showBacktestHubToast({
      tone: 'neutral',
      title: hubLabel('Pipeline Started', '파이프라인 시작'),
      detail: hubLabel('Refreshing datasets, the live snapshot, and tuning in one cycle.', '데이터셋, 라이브 스냅샷, 튜닝을 한 사이클로 갱신하고 있습니다.'),
      durationMs: 2600,
    });
    this.render();
    try {
      const payload = await startLocalSchedulerNowRemote();
      const touched = payload.result?.touchedDatasets?.length || 0;
      if (payload.result?.completedAt) {
        this.suppressCycleAnnouncementKey = `idle:${payload.result.completedAt}:ok`;
      }
      this.actionMessage = {
        tone: 'positive',
        text: hubLabel(
          `Scheduler cycle completed${touched ? ` and touched ${touched} dataset${touched === 1 ? `` : `s`}` : ``} . Refreshing hub state...`.replace('  .', '.'),
          `스케줄러 사이클 완료${touched ? ` · ${touched}개 데이터셋 처리` : ''}. 허브 상태를 새로고침합니다...`,
        ),
      };
      this.announceCompletion({
        tone: 'positive',
        title: hubLabel('Scheduler Finished', '스케줄러 완료'),
        detail: hubLabel(
          touched ? `${touched} dataset${touched === 1 ? `` : `s`} updated` : 'Cycle completed',
          touched ? `${touched}개 데이터셋 갱신` : '사이클 완료',
        ),
      });
      await this.refresh(true);
      this.actionMessage = this.buildCompletionActionMessage(
        'scheduler',
        hubLabel(
          touched ? `Scheduler cycle completed and updated ${touched} dataset${touched === 1 ? '' : 's'}.` : 'Scheduler cycle completed.',
          touched ? `스케줄러 사이클이 끝났고 ${touched}개 데이터셋을 갱신했습니다.` : '스케줄러 사이클이 완료되었습니다.',
        ),
      );
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : hubLabel('Scheduler trigger failed', '스케줄러 실행 요청이 실패했습니다.');
      const message = localizeHubErrorMessage(rawMessage);
      this.actionMessage = { tone: 'negative', text: message };
      this.announceCompletion({
        tone: 'negative',
        title: hubLabel('Scheduler Failed', '스케줄러 실패'),
        detail: message,
      });
    } finally {
      this.pendingAction = null;
      this.render();
    }
  }

  private renderLoading(forceRefresh: boolean): void {
    if (this.snapshot) return;
    setActiveHubLocale(this.locale);
    this.root.innerHTML = `
      <div class="backtest-hub-shell">
        <section class="backtest-hub-hero investment-subcard">
          <div>
            <div class="investment-mini-label">${APP_BRAND.hubs.backtest}</div>
            <h1>${hubLabel('Loading replay and pipeline state...', '리플레이와 파이프라인 상태를 불러오는 중...')}</h1>
            <div class="backtest-lab-note">${forceRefresh ? hubLabel('Refreshing live snapshots and replay history.', '라이브 스냅샷과 리플레이 이력을 새로고침하는 중입니다.') : hubLabel('Loading cached operations state.', '캐시된 운영 상태를 불러오는 중입니다.')}</div>
          </div>
        </section>
      </div>
    `;
  }

  private render(): void {
    setActiveHubLocale(this.locale);
    const snapshot = this.snapshot;
    if (!snapshot) {
      this.renderLoading(false);
      return;
    }
    const replayAdaptation = snapshot.replayAdaptation;
    const intelligence = snapshot.intelligence;
    const decisionSupport = normalizeDecisionSupportSnapshot(buildCurrentDecisionSupportSnapshot({
      snapshot: intelligence,
      replayAdaptation,
    }));
    const themeDiagnostics = buildThemeDiagnosticsSnapshot({
      snapshot: intelligence,
      replayAdaptation,
    });
    const workflowDropoff = buildWorkflowDropoffSummary({
      snapshot: intelligence,
      replayAdaptation,
    });
    const posture = describePosture(decisionSupport, workflowDropoff);
    const selectedRun = this.runs.find((run) => run.id === this.selectedRunId) || this.runs[0] || null;
    const backtestOps = this.runs.length > 0
      ? buildBacktestOpsSnapshot(this.runs, replayAdaptation)
      : snapshot.backtestOps;
    const fallbackReplay = selectedRun ? buildBacktestOpsRunSummary(selectedRun, replayAdaptation, 'replay') : null;
    const latestReplaySummary = backtestOps?.latestReplay || fallbackReplay;
    const latestWalkForwardSummary = backtestOps?.latestWalkForward || null;
    const currentLike = extractCurrentLikeRun(backtestOps);
    const latestRunTs = Math.max(
      asTs(selectedRun?.completedAt),
      asTs(latestReplaySummary?.updatedAt),
      asTs(latestWalkForwardSummary?.updatedAt),
    );
    const currentLikeTs = asTs(currentLike?.updatedAt);
    const currentLikeStale = Boolean(currentLike && latestRunTs && currentLikeTs && currentLikeTs + 60_000 < latestRunTs);
    const currentLikeEmptyText = this.runs.length > 0
      ? hubLabel('Current-like has not been regenerated from the latest replay adaptation snapshot yet.', 'Current-like는 아직 최신 replay adaptation 스냅샷으로 다시 생성되지 않았습니다.')
      : undefined;
    const currentLikeNote = currentLikeStale
      ? `Current-like still reflects an older adaptation snapshot (${formatRelativeTime(currentLike?.updatedAt)}). Latest run history is newer.`
      : null;
    const issues = snapshot.issues.slice(0, 4);
    const readinessScore = backtestOps?.derived.readinessScore ?? 0;
    const decisionPressure = decisionSupport.actNow.length + decisionSupport.defensive.length;
    const avgLag = average(snapshot.datasets.map((row) => row.pipelineLagMinutes ?? 0).filter((value) => value > 0));
    const highlightCompletion = this.attentionUntil > Date.now();
    const decisionBriefNotice = renderDecisionBriefNotice(snapshot, decisionSupport);
    const guidedFlow = renderGuidedFlow(snapshot, latestReplaySummary, decisionSupport, selectedRun);
    const viewLead = renderViewSectionLead(this.view);

    document.title = highlightCompletion && this.lastCompletionTitle ? `${this.lastCompletionTitle} - ${APP_BRAND.hubs.backtest}` : `${APP_BRAND.hubs.backtest} - ${APP_BRAND.name}`;
    this.root.innerHTML = `
      <div class="backtest-hub-shell view-${this.view}">
        <section class="backtest-hub-hero investment-subcard">
          <div class="backtest-hub-hero-head">
            <div>
              <div class="investment-mini-label">${APP_BRAND.hubs.backtest}</div>
              <h1>${hubLabel('Evidence, pipeline state, and live decision support in one workspace', '하나의 워크스페이스에서 증거, 파이프라인 상태, 그리고 현재 의사결정 보조를 함께 봅니다')}</h1>
              <div class="backtest-lab-note">${hubLabel('Use this studio to see what is feeding training, how replay evidence is evolving, and what the live snapshot is suggesting right now.', '이 스튜디오에서 현재 학습 입력, 리플레이 증거의 변화, 그리고 지금 스냅샷이 무엇을 시사하는지 한 번에 볼 수 있습니다.')}</div>
            </div>
            <div class="backtest-hub-actions">
              <div class="backtest-hub-locale-toggle" role="group" aria-label="${hubLabel('Language', '언어')}">
                <button type="button" class="backtest-hub-locale-btn${this.locale === 'ko' ? ' selected' : ''}" data-action="set-locale" data-locale="ko" aria-label="Switch to Korean">KO</button>
                <button type="button" class="backtest-hub-locale-btn${this.locale === 'en' ? ' selected' : ''}" data-action="set-locale" data-locale="en" aria-label="Switch to English">EN</button>
              </div>
              <button type="button" class="backtest-lab-btn" data-action="refresh">${hubLabel('Refresh', '새로고침')}</button>
              <button type="button" class="backtest-lab-btn secondary" data-action="open-settings">${hubLabel('Settings', '설정')}</button>
            </div>
          </div>
          <div class="backtest-hub-hero-grid">
            <div class="backtest-hub-summary-card ${toneClass(posture.tone)}">
              <span class="investment-mini-label">${hubLabel('Current posture', '현재 포지션 상태')}</span>
              <strong>${escapeHtml(posture.label)}</strong>
              <p>${escapeHtml(posture.summary)}</p>
              <div class="backtest-lab-note"><strong>${hubLabel('Next', '다음 행동')}:</strong> ${escapeHtml(posture.nextStep)}</div>
            </div>
            <div class="backtest-hub-summary-card ${toneClass(snapshot.pipeline.activeCycleStatus === 'running' ? 'ready' : snapshot.pipeline.lastError ? 'blocked' : 'watch')}">
              <span class="investment-mini-label">${hubLabel('Pipeline', '파이프라인')}</span>
              <strong>${escapeHtml(hubStatusLabel(snapshot.pipeline.activeCycleStatus === 'running' ? 'running' : 'idle'))}</strong>
              <p>${escapeHtml(snapshot.pipeline.activeStage || hubLabel('No active stage', '실행 중 단계 없음'))}</p>
              <div class="backtest-lab-note">Heartbeat ${snapshot.pipeline.heartbeatLagMinutes ?? 'n/a'}m · queue ${snapshot.pipeline.openThemeQueueDepth}</div>
            </div>
            <div class="backtest-hub-summary-card ${toneClass(readinessScore >= 65 ? 'ready' : readinessScore >= 40 ? 'watch' : 'blocked')}">
              <span class="investment-mini-label">${hubLabel('Backtest readiness', '백테스트 준비도')}</span>
              <strong>${readinessScore}</strong>
              <p>Replay quality ${backtestOps?.derived.qualityScore ?? 0} · coverage ${backtestOps?.derived.coverageScore ?? 0}</p>
              <div class="backtest-lab-note">${hubLabel('Latest snapshot', '최신 스냅샷')} ${escapeHtml(formatRelativeTime(snapshot.currentSnapshot.generatedAt))}</div>
            </div>
            <div class="backtest-hub-summary-card ${toneClass(snapshot.currentSnapshot.status)}">
              <span class="investment-mini-label">${hubLabel('Decision pressure', '의사결정 압력')}</span>
              <strong>${decisionPressure}</strong>
              <p>${escapeHtml(decisionSupport.regimeLabel)} · ${snapshot.currentSnapshot.directMappings} mappings · ${snapshot.currentSnapshot.ideaCards} idea cards</p>
              <div class="backtest-lab-note">${hubLabel('Dataset lag avg', '데이터셋 평균 지연')} ${formatMaybe(avgLag, 0)}m · ${hubLabel('issues', '이슈')} ${issues.length}</div>
            </div>
          </div>
          <div class="backtest-hub-tabbar">
            ${renderViewTabs(this.view)}
          </div>
        </section>

        ${renderActivityBanner(snapshot, backtestOps, issues, this.pendingAction, this.actionMessage, highlightCompletion, this.lastRefreshError)}

        ${guidedFlow}

        ${viewLead}

        <div class="backtest-hub-grid backtest-hub-grid-three" data-view-anchor="overview">
          ${renderRunComparisonCard(latestReplaySummary, hubLabel('Latest Replay', '최신 리플레이'))}
          ${renderRunComparisonCard(latestWalkForwardSummary, hubLabel('Latest Walk-forward', '최신 워크포워드'))}
          ${renderRunComparisonCard(currentLike, hubLabel('Current-like', '현재 유사 구간'), { emptyText: currentLikeEmptyText, note: currentLikeNote })}
        </div>

        <div class="backtest-hub-grid backtest-hub-grid-two" data-view-anchor="overview">
          <section class="investment-subcard backtest-hub-panel">
            <div class="investment-subcard-head">
              <div>
                <h4>${hubLabel('Evidence Curve', '증거 곡선')}</h4>
                <div class="backtest-lab-note">${hubLabel('Choose one archived run to inspect its path, exposure, and interpretation.', '저장된 실행 하나를 골라 경로, 노출, 해석을 확인하세요.')}</div>
              </div>
              <span class="investment-mini-label">${this.runs.length} runs loaded</span>
            </div>
            ${renderRunWorkspace(this.runs, this.selectedRunId, selectedRun)}
          </section>
          <section class="investment-subcard backtest-hub-panel">
            <div class="investment-subcard-head">
              <div>
                <h4>${hubLabel('Theme Pulse', '테마 펄스')}</h4>
                <div class="backtest-lab-note">${hubLabel('Use this to see which themes are healthy, fading, or blocked before trusting a replay result.', '리플레이 결과를 믿기 전에 어떤 테마가 건강한지, 약해졌는지, 막혔는지 여기서 먼저 봅니다.')}</div>
              </div>
              <span class="investment-mini-label">${themeDiagnostics.readyCount} ready · ${themeDiagnostics.watchCount} watch · ${themeDiagnostics.blockedCount} blocked</span>
            </div>
            <div class="backtest-hub-theme-list">
              ${renderThemePulse(themeDiagnostics, snapshot)}
            </div>
          </section>
        </div>

        <div class="backtest-hub-grid backtest-hub-grid-two" data-view-anchor="history">
          <section class="investment-subcard backtest-hub-panel">
            <div class="investment-subcard-head">
              <div>
                <h4>${hubLabel('Run History', '실행 이력')}</h4>
                <div class="backtest-lab-note">${hubLabel('Compare windows here after you have more than one archived run.', '저장된 실행이 두 개 이상일 때 여기서 시간대별 결과를 비교하세요.')}</div>
              </div>
              <span class="investment-mini-label">${this.runs.length} recorded runs</span>
            </div>
            ${renderRunHistoryWorkspace(this.runs)}
          </section>
          <section class="investment-subcard backtest-hub-panel">
            <div class="investment-subcard-head">
              <h4>${hubLabel('Theme Drift Map', '테마 드리프트 맵')}</h4>
              <span class="investment-mini-label">${hubLabel('Diagnostic score vs current drift', '진단 점수 vs 현재 드리프트')}</span>
            </div>
            ${renderThemeDriftMap(themeDiagnostics, snapshot)}
          </section>
        </div>

        <div class="backtest-hub-grid backtest-hub-grid-two" data-view-anchor="decision">
          <section class="investment-subcard backtest-hub-panel">
            <div class="investment-subcard-head">
                <h4>${hubLabel('Live Briefing', '라이브 브리핑')}</h4>
              <span class="investment-mini-label">${escapeHtml(decisionSupport.regimeLabel)}</span>
            </div>
            ${decisionBriefNotice}
            <div class="backtest-mission-grid">
              ${renderDecisionBucket('Act Now', decisionSupport.actNow, 'No idea is currently strong enough to deploy immediately.')}
              ${renderDecisionBucket('Defensive Cover', decisionSupport.defensive, 'No defensive bucket is active right now.')}
              ${renderDecisionBucket('Avoid / Underweight', decisionSupport.avoid, 'No strong avoid calls are active.')}
              ${renderDecisionBucket('Watch For Confirmation', decisionSupport.watch, 'Nothing is close enough to warrant a watch list item.')}
            </div>
          </section>
          <section class="investment-subcard backtest-hub-panel">
            <div class="investment-subcard-head">
              <h4>${hubLabel('Decision Funnel & Pipeline', '의사결정 퍼널 & 파이프라인')}</h4>
              <span class="investment-mini-label">${snapshot.pipeline.activeDatasetId || snapshot.pipeline.source}</span>
            </div>
            <div class="backtest-hub-pipeline-card">
              <div class="backtest-hub-pipeline-top">
                <div class="backtest-hub-stat"><span>Active stage</span><b>${escapeHtml(snapshot.pipeline.activeStage || 'idle')}</b></div>
                <div class="backtest-hub-stat"><span>Progress</span><b>${snapshot.pipeline.activeProgressPct ?? 0}%</b></div>
                <div class="backtest-hub-stat"><span>Queue depth</span><b>${snapshot.pipeline.openThemeQueueDepth}</b></div>
                <div class="backtest-hub-stat"><span>Latest cycle</span><b>${escapeHtml(formatRelativeTime(snapshot.pipeline.latestCycleAt))}</b></div>
              </div>
              <div class="backtest-hub-meter">
                <div class="backtest-hub-meter-fill ${toneClass(snapshot.pipeline.activeCycleStatus === 'running' ? 'ready' : snapshot.pipeline.lastError ? 'blocked' : 'watch')}" style="width:${snapshot.pipeline.activeProgressPct ?? 0}%"></div>
              </div>
              <div class="backtest-hub-funnel-list">
                ${renderWorkflowFunnel(workflowDropoff)}
              </div>
            </div>
          </section>
        </div>

        <div class="backtest-hub-grid backtest-hub-grid-two" data-view-anchor="data">
          <section class="investment-subcard backtest-hub-panel">
            <div class="investment-subcard-head">
              <h4>${hubLabel('Source Family Coverage', '소스 패밀리 커버리지')}</h4>
              <span class="investment-mini-label">${snapshot.coverage.sourceFamilyCount} ${hubLabel('families', '패밀리')}</span>
            </div>
            <div class="backtest-hub-theme-list">
              ${renderSourceFamilyOverview(snapshot)}
            </div>
          </section>
          <section class="investment-subcard backtest-hub-panel">
            <div class="investment-subcard-head">
              <h4>${hubLabel('Dataset Pipeline Lanes', '데이터셋 파이프라인 레인')}</h4>
              <span class="investment-mini-label">${snapshot.datasets.length} ${hubLabel('tracked datasets', '추적 중인 데이터셋')}</span>
            </div>
            <div class="backtest-hub-theme-list">
              ${renderDatasetPipelineLanes(snapshot)}
            </div>
          </section>
        </div>

        <div class="backtest-hub-grid backtest-hub-grid-two" data-view-anchor="data">
          <section class="investment-subcard backtest-hub-panel">
            <div class="investment-subcard-head">
              <h4>${hubLabel('Dataset Health', '데이터셋 상태')}</h4>
              <span class="investment-mini-label">${snapshot.overview.readyDatasets} ${hubLabel('ready', '준비됨')} · ${snapshot.overview.blockedDatasets} ${hubLabel('blocked', '차단됨')}</span>
            </div>
            <table class="investment-table backtest-lab-table">
              <thead><tr><th>Dataset</th><th>Provider</th><th>Status</th><th>Progress</th><th>Lag</th><th>Comp / Cov</th><th>Blocker</th></tr></thead>
              <tbody>${renderDatasetHealth(snapshot)}</tbody>
            </table>
          </section>
          <section class="investment-subcard backtest-hub-panel">
            <div class="investment-subcard-head">
              <h4>${hubLabel('Training Inputs', '훈련 입력')}</h4>
              <span class="investment-mini-label">${snapshot.historicalDatasets.length} ${hubLabel('datasets', '데이터셋')}</span>
            </div>
            <table class="investment-table backtest-lab-table">
              <thead><tr><th>Dataset</th><th>Provider</th><th>Corpus</th><th>Freshness</th></tr></thead>
              <tbody>${renderTrainingInputs(snapshot)}</tbody>
            </table>
            <div class="backtest-hub-provider-list">
              ${renderProviderMix(snapshot)}
            </div>
            <div class="backtest-hub-issues">
              <h5>${hubLabel('Immediate blockers', '즉시 확인할 막힘 요인')}</h5>
              ${issues.length ? issues.map((issue) => `
                <div class="backtest-hub-issue ${toneClass(issue.status)}">
                  <strong>${escapeHtml(issue.title)}</strong>
                  <div class="backtest-lab-note">${escapeHtml(issue.detail)}</div>
                  ${issue.suggestion ? `<div class="backtest-lab-note"><strong>${hubLabel('Fix', '해결')}</strong>: ${escapeHtml(issue.suggestion)}</div>` : ''}
                </div>
              `).join('') : `<div class="backtest-hub-empty">${escapeHtml(hubLabel('No major pipeline blockers are active right now.', '지금은 큰 파이프라인 blocker가 없습니다.'))}</div>`}
            </div>
          </section>
        </div>
      </div>
    `;
    this.normalizeRenderedUi();
  }

  private normalizeRenderedUi(): void {
    this.root.innerHTML = this.root.innerHTML.split(' 쨌 ').join(' · ');

    const primaryButton = this.root.querySelector<HTMLButtonElement>('.backtest-hub-primary-btn');
    if (primaryButton?.dataset.action === 'start-scheduler') {
      primaryButton.textContent = hubSchedulerLabel('recommended');
    } else if (primaryButton?.dataset.action === 'start-replay') {
      primaryButton.textContent = hubReplayLabel('recommended');
    }

    this.root.querySelectorAll<HTMLButtonElement>('[data-action="start-scheduler"]:not(.backtest-hub-primary-btn)').forEach((button) => {
      button.textContent = hubSchedulerLabel(this.pendingAction === 'scheduler' ? 'pending' : 'default');
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-action="start-replay"]:not(.backtest-hub-primary-btn)').forEach((button) => {
      button.textContent = hubReplayLabel(this.pendingAction === 'replay' ? 'pending' : 'default');
    });

    if (primaryButton?.dataset.action) {
      this.root
        .querySelectorAll<HTMLElement>(`[data-action="${primaryButton.dataset.action}"]:not(.backtest-hub-primary-btn)`)
        .forEach((element) => element.remove());
    }

    for (const action of ['start-scheduler', 'start-replay'] as const) {
      const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>(`button[data-action="${action}"]`));
      if (buttons.length <= 1) continue;
      const keep = new Set<HTMLButtonElement>();
      const primary = buttons.find((button) => button.classList.contains('backtest-hub-primary-btn'));
      if (primary) keep.add(primary);
      const firstEnabled = buttons.find((button) => !button.disabled && !keep.has(button));
      if (firstEnabled) keep.add(firstEnabled);
      buttons.forEach((button) => {
        if (!keep.has(button)) button.remove();
      });
    }

    if (this.locale === 'ko') {
      const koReplacements: Array<[string, string]> = [
        ['Chrome mode now attempts to preload the same locally mirrored secrets that desktop settings saved.', '크롬 모드에서는 데스크톱 설정에 저장한 로컬 미러 비밀값을 먼저 불러옵니다.'],
        ['Run Pipeline', '코퍼스 갱신'],
        ['Top blocker:', '가장 큰 막힘:'],
        ['Selected run', '선택된 실행'],
        ['No replay yet', '리플레이 없음'],
        ['No run summary recorded yet.', '아직 저장된 실행 요약이 없습니다.'],
        ['The run completed, but it did not produce investable ideas in this window yet.', '실행은 끝났지만 이 구간에서는 아직 투자 가능한 아이디어가 나오지 않았습니다.'],
        ['Healthy selected run', '선택된 실행은 비교적 건강합니다'],
        ['Weak result', '약한 결과'],
        ['Usable signal', '사용 가능한 신호'],
        ['Thin sample', '얇은 샘플'],
        ['No-trade result', '거래 없음 결과'],
      ];
      for (const [from, to] of koReplacements) {
        this.root.innerHTML = this.root.innerHTML.split(from).join(to);
      }
    }
  }
}

export async function initBacktestHubWindow(containerEl?: HTMLElement): Promise<void> {
  const appEl = containerEl ?? document.getElementById('app');
  if (!appEl) return;
  document.title = `${APP_BRAND.hubs.backtest} - ${APP_BRAND.name}`;
  const hub = new BacktestHubWindow(appEl);
  await hub.init();
}
