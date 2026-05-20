import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { promises as fs } from "node:fs";
import path from "node:path";

type PluginConfig = {
  latticeApiBaseUrl?: string;
  latticeUiBaseUrl?: string;
  defaultTheme?: string;
  timeoutMs?: number;
  sidecarBaseUrl?: string;
  sidecarToken?: string;
  sidecarAuthMode?: "none" | "bearer";
};

type JsonObject = Record<string, unknown>;
type RequestOptions = {
  method?: "GET" | "POST";
  body?: JsonObject | null;
  headers?: Record<string, string>;
};

function readConfig(api: { pluginConfig?: unknown }): Required<PluginConfig> {
  const raw = ((api.pluginConfig && typeof api.pluginConfig === "object" ? api.pluginConfig : {}) || {}) as PluginConfig;
  const localApiPort = String(process.env.LOCAL_API_PORT || "").trim();
  const defaultSidecarBaseUrl = String(
    process.env.LATTICE_SIDECAR_BASE_URL
    || process.env.LOCAL_API_BASE_URL
    || (localApiPort ? `http://127.0.0.1:${localApiPort}` : "http://127.0.0.1:46123"),
  ).trim();
  return {
    latticeApiBaseUrl: raw.latticeApiBaseUrl || "http://127.0.0.1:46200",
    latticeUiBaseUrl: raw.latticeUiBaseUrl || process.env.LATTICE_UI_BASE_URL || "http://localhost:3000",
    defaultTheme: raw.defaultTheme || "materials-science",
    timeoutMs: clampTimeout(raw.timeoutMs),
    sidecarBaseUrl: raw.sidecarBaseUrl || defaultSidecarBaseUrl,
    sidecarToken: raw.sidecarToken || "",
    sidecarAuthMode: raw.sidecarAuthMode === "bearer" ? "bearer" : "none",
  };
}

function clampTimeout(value?: number): number {
  if (!Number.isFinite(value)) {
    return 10_000;
  }
  return Math.min(60_000, Math.max(1_000, Number(value)));
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildUrl(baseUrl: string, path: string): string {
  return `${trimTrailingSlash(baseUrl)}${path}`;
}

function buildSidecarHeaders(config: Required<PluginConfig>): Record<string, string> | undefined {
  if (config.sidecarAuthMode !== "bearer") return undefined;
  if (!config.sidecarToken) {
    throw new Error("sidecarToken required when sidecarAuthMode=bearer");
  }
  return { Authorization: `Bearer ${config.sidecarToken}` };
}

function createDeepLink(config: Required<PluginConfig>, hash: string): string {
  return `${trimTrailingSlash(config.latticeUiBaseUrl)}/event-dashboard.html${hash}`;
}

async function fetchJson(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<JsonObject> {
  return requestJson(url, timeoutMs, {
    method: "GET",
    headers,
  });
}

async function postJson(url: string, timeoutMs: number, body: JsonObject, headers?: Record<string, string>): Promise<JsonObject> {
  return requestJson(url, timeoutMs, {
    method: "POST",
    body,
    headers,
  });
}

async function requestJson(url: string, timeoutMs: number, options: RequestOptions = {}): Promise<JsonObject> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        accept: "application/json",
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(`Expected JSON but received ${contentType || "unknown"} from ${url}`);
    }
    return (await response.json()) as JsonObject;
  } finally {
    clearTimeout(timeout);
  }
}

function formatQualityScore(value: number | null | undefined): string {
  if (!Number.isFinite(value as number)) {
    return "없음";
  }
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function dedupeReasoning(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const deduped: string[] = [];
  for (const line of lines) {
    if (!deduped.includes(line)) {
      deduped.push(line);
    }
  }
  return deduped.join(" | ");
}

function ageHours(value?: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, (Date.now() - parsed) / 3_600_000);
}

function formatHours(hours: number | null): string {
  if (hours == null) {
    return "없음";
  }
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  }
  if (hours < 48) {
    return `${hours.toFixed(1)}h`;
  }
  return `${Math.round(hours)}h`;
}

function formatPct(value: number | null | undefined): string {
  if (!Number.isFinite(value as number)) {
    return "없음";
  }
  return `${Number(value).toFixed(1)}%`;
}

function formatNumber(value: number | null | undefined, digits = 1): string {
  if (!Number.isFinite(value as number)) {
    return "없음";
  }
  return Number(value).toFixed(digits);
}

function translateHealthStatus(value: unknown): string {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "healthy" || normalized === "ok") return "정상";
  if (normalized === "degraded" || normalized === "warning") return "주의";
  if (normalized === "unhealthy" || normalized === "error") return "비정상";
  return String(value || "알 수 없음");
}

function translateDbStatus(value: unknown): string {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "connected") return "연결됨";
  if (normalized === "disconnected") return "끊김";
  return String(value || "알 수 없음");
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function textResult(text: string, details: JsonObject = {}) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function compactForToolPayload(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  if (Array.isArray(value)) {
    const items = value.slice(0, 5).map((item) => compactForToolPayload(item, depth + 1));
    return value.length > 5 ? [...items, { omitted: value.length - 5 }] : items;
  }
  if (typeof value === "object") {
    if (depth >= 3) return "[object omitted]";
    const entries = Object.entries(value as JsonObject).slice(0, 12);
    const compact: JsonObject = {};
    for (const [key, item] of entries) {
      compact[key] = compactForToolPayload(item, depth + 1);
    }
    const omitted = Object.keys(value as JsonObject).length - entries.length;
    if (omitted > 0) compact.omittedKeys = omitted;
    return compact;
  }
  return String(value);
}

function errorResult(label: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return textResult(`${label}: 사용할 수 없음\n이유: ${message}`, {
    status: "failed",
    error: message,
  });
}

function successResult(summary: string, payload: JsonObject = {}) {
  return textResult(summary, {
    status: "ok",
    payload: compactForToolPayload(payload) as JsonObject,
  });
}

function summarizeHealth(data: JsonObject, config: Required<PluginConfig>): string {
  const articleAge = data.articleAgeMs != null ? Number(data.articleAgeMs) / 3_600_000 : null;
  const signalAge = data.signalAgeMs != null ? Number(data.signalAgeMs) / 3_600_000 : null;
  return [
    `Lattice 상태: ${translateHealthStatus(data.status)} | 점수 ${formatNumber(Number(data.compositeScore ?? 0), 3)} | DB ${translateDbStatus(data.db)}`,
    `기사 ${String(data.articles ?? "없음")} (${formatHours(articleAge)} 경과) | 신호 ${String(data.signals ?? "없음")} (${formatHours(signalAge)} 경과) | 대기 ${String(data.pending ?? "없음")}`,
    `링크: ${createDeepLink(config, "#ops")}`,
  ].join("\n");
}

function summarizeKpi(data: JsonObject, config: Required<PluginConfig>): string {
  const meta = ((data.meta || {}) as JsonObject);
  return [
    `레짐 ${String(data.riskState || "unknown").toUpperCase()} | 위험 ${formatNumber(Number(data.riskGauge ?? 0), 1)} | VIX ${formatNumber(Number(data.vix ?? 0), 2)}`,
    `유가 ${formatNumber(Number(data.oilPrice ?? 0), 2)} | 달러 ${formatNumber(Number(data.dollarIndex ?? 0), 3)} | 스프레드 ${formatNumber(Number(data.yieldSpread ?? 0), 2)}`,
    `피드 모드 ${String(meta.mode || "unknown")} | 오래됨 ${meta.stale ? "예" : "아니오"}${meta.staleReason ? ` | 이유: ${String(meta.staleReason)}` : ""}`,
    `링크: ${createDeepLink(config, "#home")}`,
  ].join("\n");
}

function summarizeThemeBrief(data: JsonObject, config: Required<PluginConfig>): string {
  const summary = ((data.summary || {}) as JsonObject);
  const meta = ((data.meta || {}) as JsonObject);
  const risks = asArray<string>(data.risks).slice(0, 2);
  const watchpoints = asArray<string>(data.watchpoints).slice(0, 2);
  const sections = ((data.sections || {}) as Record<string, unknown>);
  const whySection = ((sections.whyItMatters || {}) as Record<string, unknown>);
  const why = asArray<string>(whySection.statements).slice(0, 2);
  return [
    `${String(data.label || data.theme || "테마")} | ${String(data.categoryLabel || data.category || "알 수 없음")} | ${String(summary.lifecycleStage || "알 수 없음")} | 기사 ${String(summary.articleCount ?? "없음")}`,
    `전년대비 ${formatPct(Number(summary.vsYearAgoPct ?? NaN))} | 가속도 ${formatPct(Number(summary.acceleration ?? NaN))} | 소스 다양성 ${formatNumber(Number(summary.sourceDiversity ?? 0), 2)}`,
    why.length ? `이유: ${why.join(" | ")}` : "이유: 없음",
    risks.length ? `위험: ${risks.join(" | ")}` : "위험: 감지 없음",
    watchpoints.length ? `관찰: ${watchpoints.join(" | ")}` : "관찰: 감지 없음",
    `신선도: ${meta.stale ? `오래됨 (${String(meta.staleReason || "이유 없음")})` : "최신"} | 링크: ${createDeepLink(config, "#investigate")}`,
  ].join("\n");
}

function summarizeApprovalQueue(data: JsonObject, config: Required<PluginConfig>, limit: number): string {
  const approvals = asArray<JsonObject>((data as { approvals?: unknown }).approvals);
  const counts = approvals.reduce<Record<string, number>>((acc, item) => {
    const key = String(item.status || "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const top = approvals
    .filter((item) => item.status === "pending" || item.status === "needs-fix")
    .slice(0, limit)
    .map((item) => {
      const payload = ((item.payload || {}) as JsonObject);
      const age = formatHours(ageHours(item.created_at as string | null));
      return `- #${String(item.id)} ${String(payload.name || payload.url || item.action_type)} | ${String(item.status)} | ${age}`;
    });
  return [
    `승인 큐: 전체 ${approvals.length} | 대기 ${counts.pending || 0} | 수정필요 ${counts["needs-fix"] || 0} | 거절 ${counts.rejected || 0} | 실행됨 ${counts.executed || 0}`,
    top.length ? top.join("\n") : "- 승인 항목 없음",
    `링크: ${createDeepLink(config, "#inbox")}`,
  ].join("\n");
}

function summarizeDiscoveryTriage(data: JsonObject, config: Required<PluginConfig>, limit: number): string {
  const source = (data as { topics?: unknown; items?: unknown });
  const topics = asArray<JsonObject>(source.topics || source.items);
  const top = topics.slice(0, limit).map((item) => {
    return `- ${String(item.label || item.id)} | ${String(item.promotionState || "미검토")} | 모멘텀 ${formatNumber(Number(item.momentum ?? 0), 2)} | 기사 ${String(item.articleCount ?? "없음")}`;
  });
  return [
    `발견 검토: 토픽 ${topics.length}개`,
    top.length ? top.join("\n") : "- 검토할 발견 토픽 없음",
    `링크: ${createDeepLink(config, "#inbox")}`,
  ].join("\n");
}

function summarizeFreshnessAudit(data: JsonObject, config: Required<PluginConfig>): string {
  const summary = ((data.summary || {}) as JsonObject);
  const nas = ((data.nas || {}) as JsonObject);
  const articles = ((nas.articles || {}) as JsonObject);
  const signalHistory = ((nas.signalHistory || {}) as JsonObject);
  const signals = asArray<JsonObject>(signalHistory.signals);
  const staleSignals = signals.filter((item) => Number(item.ageHours ?? 0) > 48);
  const mirroredSignals = signals.filter((item) => Boolean(item.mirrored));
  return [
    `신선도 감사: 발견 ${String(summary.findings ?? 0)} | 캐시 이슈 ${String(summary.cacheIssues ?? 0)} | 24시간 기사 ${String(summary.articleCount24h ?? "없음")} | 72시간 기사 ${String(summary.articleCount72h ?? "없음")}`,
    `NAS 기사 최신 ${String(articles.latestPublishedAt || "없음")} | 오래된 신호 ${staleSignals.length} | 미러 신호 ${mirroredSignals.length}`,
    `링크: ${createDeepLink(config, "#ops")}`,
  ].join("\n");
}

function summarizeLiveStatus(data: JsonObject, config: Required<PluginConfig>, limit: number): string {
  const temperatures = asArray<JsonObject>(data.temperatures)
    .sort((a, b) => Number(b.intensity ?? 0) - Number(a.intensity ?? 0))
    .slice(0, limit)
    .map((item) => `- ${String(item.theme)}: ${String(item.temperature)} (${formatNumber(Number(item.intensity ?? 0) * 100, 1)}%)`);
  const meta = ((data.meta || {}) as JsonObject);
  return [
    `라이브 상태: 대기 ${String(data.pending ?? "없음")} | 오늘 기사 ${String(data.todayArticles ?? "없음")} | 오래됨 ${meta.stale ? "예" : "아니오"}`,
    temperatures.length ? temperatures.join("\n") : "- 라이브 온도 없음",
    `링크: ${createDeepLink(config, "#home")}`,
  ].join("\n");
}

function summarizeSidecar(label: string, data: JsonObject): string {
  const keys = Object.keys(data).slice(0, 8);
  const preview = keys.length
    ? keys.map((key) => `${key}=${typeof data[key] === "object" ? "[object]" : String(data[key])}`).join(" | ")
    : JSON.stringify(data);
  return `${label}: ${preview}`;
}

function summarizeRuntimeObservabilitySidecar(data: JsonObject): string {
  const summary = ((data.summary || {}) as JsonObject);
  const serviceStatus = ((data.serviceStatus || {}) as JsonObject);
  const serviceSummary = ((serviceStatus.summary || {}) as JsonObject);
  const serviceLocal = ((serviceStatus.local || {}) as JsonObject);
  const runtime = ((data.runtime || serviceLocal || {}) as JsonObject);
  const health = ((data.health || data.automationHealth || {}) as JsonObject);
  const codex = ((data.codex || {}) as JsonObject);
  const routeCoverage = ((data.routeCoverage || {}) as JsonObject);
  const credentials = ((data.credentials || {}) as JsonObject);
  const daemon = ((data.daemon || {}) as JsonObject);
  const daemonSummary = ((daemon.summary || {}) as JsonObject);
  const missingRequired = asArray<string>(credentials.missingRequiredKeys);
  const blockerReasons = asArray<string>(data.blockerReasons);
  const reasons = [
    ...asArray<string>(health.reasons),
    ...blockerReasons,
  ].filter((reason, index, all) => reason && all.indexOf(reason) === index).slice(0, 3);
  const status = String(health.status || summary.status || daemon.status || "unknown");
  const activeCycle = String(health.activeCycleStatus || "n/a");
  const blockerCount = health.blockerCount ?? summary.blockerCount ?? blockerReasons.length;
  const missingRoutes = routeCoverage.missingRouteCount ?? routeCoverage.missingHandlerCount ?? 0;
  const hasCurrentSchedulerHealth = Object.keys(health).length > 0;
  const taskLine = hasCurrentSchedulerHealth
    ? `scheduler health: stale tasks ${String(summary.staleTaskCount ?? "없음")} | failing tasks ${String(summary.failingTaskCount ?? health.datasetErrorCount ?? "없음")} | legacy daemon ignored for current blockers`
    : `legacy daemon: ${String(daemon.status || "n/a")} | stale tasks ${String(summary.staleTaskCount ?? daemonSummary.staleTaskCount ?? "없음")} | failing tasks ${String(summary.failingTaskCount ?? daemonSummary.failingTaskCount ?? "없음")}`;

  return [
    `Runtime observability: sidecar 연결됨 | mode ${String(runtime.mode || "unknown")} | port ${String(runtime.port || "unknown")}`,
    `서비스: 정상 ${String(serviceSummary.operational ?? "없음")} | 저하 ${String(serviceSummary.degraded ?? "없음")} | 장애 ${String(serviceSummary.outage ?? "없음")}`,
    `자동화: ${status} | activeCycle ${activeCycle} | stalled ${health.stalled ? "예" : "아니오"} | blockers ${String(blockerCount)}`,
    taskLine,
    `Codex: ${codex.available ? "사용 가능" : "확인 필요"} | route missing ${String(missingRoutes)} | missing required secrets ${missingRequired.length}`,
    reasons.length ? `상세: ${reasons.join(" | ")}` : "상세: 즉시 차단 이유 없음",
  ].join("\n");
}

function summarizeAutomationOpsSidecar(data: JsonObject): string {
  const summary = ((data.summary || {}) as JsonObject);
  const serviceStatus = ((data.serviceStatus || {}) as JsonObject);
  const serviceSummary = ((serviceStatus.summary || {}) as JsonObject);
  const runtime = ((data.runtime || serviceStatus.local || {}) as JsonObject);
  const health = ((data.health || data.automationHealth || {}) as JsonObject);
  const automation = ((data.automation || {}) as JsonObject);
  const lastCycle = ((automation.lastCycle || {}) as JsonObject);
  const state = ((automation.state || {}) as JsonObject);
  const activeCycle = ((state.activeCycle || {}) as JsonObject);
  const queue = ((state.queue || {}) as JsonObject);
  const daemon = ((data.daemon || {}) as JsonObject);
  const daemonSummary = ((daemon.summary || {}) as JsonObject);
  const blockerReasons = asArray<string>(data.blockerReasons);
  const reasons = [
    ...asArray<string>(health.reasons),
    ...blockerReasons,
  ].filter((reason, index, all) => reason && all.indexOf(reason) === index).slice(0, 3);
  const status = String(summary.status || health.status || "unknown");
  const observabilityScore = Number(summary.observabilityScore ?? (health.status === "healthy" ? 1 : 0));
  const hasCurrentSchedulerHealth = Object.keys(health).length > 0 || Object.keys(automation).length > 0;
  const taskLine = hasCurrentSchedulerHealth
    ? `scheduler health: stale tasks ${String(summary.staleTaskCount ?? (health.stalled ? 1 : 0))} | failing tasks ${String(summary.failingTaskCount ?? health.datasetErrorCount ?? "없음")} | legacy daemon ignored for current blockers`
    : `legacy daemon: ${String(daemon.status || "n/a")} | stale tasks ${String(daemonSummary.staleTaskCount ?? "없음")} | failing tasks ${String(daemonSummary.failingTaskCount ?? "없음")}`;

  return [
    `Automation ops snapshot: sidecar 연결됨 | mode ${String(runtime.mode || "unknown")} | port ${String(runtime.port || "unknown")} | 상태 ${status} | observability ${formatNumber(observabilityScore, 2)}`,
    `서비스: 정상 ${String(serviceSummary.operational ?? "없음")} | 저하 ${String(serviceSummary.degraded ?? "없음")} | 장애 ${String(serviceSummary.outage ?? "없음")}`,
    `최근 자동화: ${String(lastCycle.kind || "없음")} ${String(lastCycle.status || "unknown")} | ${String(lastCycle.detail || "detail 없음")}`,
    `활성 사이클: ${String(activeCycle.status || "unknown")} | stage ${String(activeCycle.stage || "unknown")} | progress ${String(activeCycle.progressPct ?? "없음")}%`,
    `큐: theme ${String(queue.themeQueueDepth ?? "없음")} | dataset ${String(queue.datasetProposalDepth ?? "없음")} | runs ${String(queue.runDepth ?? "없음")}`,
    `health: datasets ${String(health.enabledDatasetCount ?? "없음")} | dataset errors ${String(health.datasetErrorCount ?? "없음")} | failures ${String(health.consecutiveFailures ?? state.consecutiveFailures ?? "없음")}`,
    taskLine,
    reasons.length ? `current blockers: ${reasons.join(" | ")}` : "current blockers: none",
  ].join("\n");
}

function summarizeApprovalReview(data: JsonObject, config: Required<PluginConfig>): string {
  const approval = ((data.approval || {}) as JsonObject);
  const execution = ((data.execution || {}) as JsonObject);
  const quality = ((execution.quality || {}) as JsonObject);
  const payload = ((approval.payload || {}) as JsonObject);
  const itemLabel = String(payload.name || payload.url || approval.action_type || approval.id || "approval item");
  const status = String(approval.status || "unknown");
  const reviewMode = data.dryRun === true ? "simulate accept" : (execution && Object.keys(execution).length > 0 ? "review accept" : "review reject");
  const reasoning = dedupeReasoning(approval.reasoning);
  const lines = [
    `승인 #${String(approval.id || "없음")} ${reviewMode} | ${itemLabel}`,
    `상태 ${status}${data.alreadyFinal ? " | 이미 완료" : ""}${data.needsFix ? " | 수정필요" : ""}${data.skipped ? " | 건너뜀" : ""}`,
  ];

  if (Object.keys(execution).length > 0) {
    lines.push(
      `${String(execution.summary || execution.reason || "실행 완료")} | 연결자 ${String(execution.connectorKind || "없음")} | 품질 ${formatQualityScore(Number(execution.qualityScore ?? quality.score ?? NaN))} | 최근 항목 ${String(execution.recentItemCount ?? quality.recentItemCount ?? "없음")}`,
    );
    if (execution.resolvedUrl) {
      lines.push(`확정 URL: ${String(execution.resolvedUrl)}`);
    }
  }

  if (reasoning) {
    lines.push(`근거: ${reasoning}`);
  }

  lines.push(`링크: ${createDeepLink(config, "#inbox")}`);
  return lines.join("\n");
}

function summarizeDiscoveryReview(data: JsonObject, config: Required<PluginConfig>): string {
  const topic = ((data.topic || {}) as JsonObject);
  const review = ((data.review || {}) as JsonObject);
  const meta = ((data.meta || {}) as JsonObject);
  const label = String(topic.label || topic.id || review.topicId || "discovery topic");
  const lines = [
    `Discovery 검토 ${String(review.decision || topic.promotionState || "unknown")} | ${label}`,
    `테마 ${String(review.normalizedTheme || topic.normalizedTheme || "unassigned")} | 상위 ${String(review.normalizedParentTheme || topic.parentTheme || "unknown")} | 카테고리 ${String(review.normalizedCategory || topic.category || "unknown")}`,
    `모멘텀 ${formatNumber(Number(topic.momentum ?? 0), 2)} | 기사 ${String(topic.articleCount ?? "없음")} | 갱신 ${String(meta.updatedAt || topic.updatedAt || "없음")}`,
    `링크: ${createDeepLink(config, "#inbox")}`,
  ];
  return lines.join("\n");
}

type SourceRepairStatus = {
  ok: boolean;
  generatedAt: string;
  audit: JsonObject | null;
  auditSummary: SourceRepairAuditSummary;
  registry: {
    total: number;
    active: number;
    closedLoopActive: number;
    closedLoopApproved: number;
    topClosedLoop: JsonObject[];
  };
  approval: {
    total: number;
    pending: number;
    needsFix: number;
    sourceNeedsFix: number;
  };
  freshness: {
    findings: unknown;
    cacheIssues: unknown;
    articleCount24h: unknown;
    articleCount72h: unknown;
    latestPublishedAt: unknown;
  };
};

type SourceRepairAuditSummary = {
  ok: boolean;
  schema: "none" | "codex-source-code-application-evidence" | "source-repair-closed-loop" | "unknown";
  generatedAt: string;
  caseCount: number;
  passedCaseCount: number;
  targetSuccesses: number;
  countedSuccesses: number;
  totalArticles: number;
  totalRecent72hArticles: number;
  totalThemedArticles: number;
  historical: JsonObject | null;
  codeRepairResults: JsonObject[];
  cases: JsonObject[];
};

type NowcastStatusPayload = {
  ok: boolean;
  generatedAt: string;
  summary: {
    level: "ok" | "warning" | "critical";
    activeModels: number;
    shadowModels: number;
    candidateModels: number;
    driftCritical: number;
    driftWarning: number;
    lastGatePassAt: string | null;
    lastGateFailAt: string | null;
  };
  registry: {
    available: boolean;
    states?: { candidate: number; shadow: number; active: number; deprecated: number };
    total?: number;
    models: Array<{
      modelKey: string;
      modelVersion: string;
      targetSignal: string;
      promotionState: string;
      holdoutMae: number | null;
      baselineMae: number | null;
      coverage90: number | null;
      nTrain: number | null;
      nHoldout: number | null;
      createdAt: string;
      promotedAt: string | null;
      deprecatedAt: string | null;
    }>;
  };
  reconciliation: {
    available: boolean;
    windowHours?: number;
    signals: Array<{
      signalName: string;
      modelVersion: string;
      sampleCount: number;
      mae: number | null;
      coverage: number | null;
      driftLevel: "ok" | "warning" | "critical" | "unknown";
      latestReconciledAt: string | null;
    }>;
    warnings?: number;
    criticals?: number;
  };
  training: {
    available: boolean;
    snapshots: Array<{
      targetSignal: string;
      trainingDate: string;
      featureSetHash: string;
      rowCount: number;
      gate: {
        passed: boolean | null;
        maeRatio: number | null;
        coverage90: number | null;
        sampleCount: number | null;
        reasons: string[];
      };
    }>;
  };
};

function translateNowcastLevel(level: string): string {
  if (level === "critical") return "심각";
  if (level === "warning") return "주의";
  if (level === "ok") return "정상";
  return level || "알 수 없음";
}

function translateDriftLevel(level: string): string {
  if (level === "critical") return "심각";
  if (level === "warning") return "주의";
  if (level === "ok") return "정상";
  return "판정불가";
}

function summarizeNowcastStatus(payload: NowcastStatusPayload, config: Required<PluginConfig>): string {
  const summary = payload.summary || {
    level: "ok",
    activeModels: 0,
    shadowModels: 0,
    candidateModels: 0,
    driftCritical: 0,
    driftWarning: 0,
    lastGatePassAt: null,
    lastGateFailAt: null,
  };

  const registry = payload.registry;
  const reconciliation = payload.reconciliation;
  const training = payload.training;

  const driftLines = reconciliation.available && reconciliation.signals.length
    ? reconciliation.signals.slice(0, 6).map((signal) => {
        const cov = signal.coverage == null ? "n/a" : (signal.coverage * 100).toFixed(1) + "%";
        const mae = signal.mae == null ? "n/a" : signal.mae.toFixed(4);
        return `- ${signal.signalName} (${signal.modelVersion}): 커버리지 ${cov} | MAE ${mae} | 샘플 ${signal.sampleCount} | ${translateDriftLevel(signal.driftLevel)}`;
      })
    : ["- 최근 24시간 reconciliation 데이터 없음"];

  const gateFails = training.available
    ? training.snapshots.filter((s) => s.gate.passed === false).slice(0, 3)
    : [];
  const gateFailLines = gateFails.length
    ? gateFails.map((s) => `- ${s.targetSignal}: ${s.gate.reasons.join("; ")}`)
    : ["- 최근 게이트 실패 스냅샷 없음"];

  const lastPassLine = summary.lastGatePassAt
    ? `최근 게이트 통과: ${formatTimestamp(String(summary.lastGatePassAt))}`
    : "최근 게이트 통과 기록 없음";
  const lastFailLine = summary.lastGateFailAt
    ? `최근 게이트 실패: ${formatTimestamp(String(summary.lastGateFailAt))}`
    : "최근 게이트 실패 기록 없음";

  const registryLine = registry.available
    ? `모델 레지스트리: 활성 ${summary.activeModels} | 그림자 ${summary.shadowModels} | 후보 ${summary.candidateModels}`
    : "모델 레지스트리: 테이블 없음 (마이그레이션 미적용)";

  const reconcLine = reconciliation.available
    ? `Reconciliation ${reconciliation.windowHours ?? 24}시간 창: 심각 ${summary.driftCritical} | 주의 ${summary.driftWarning}`
    : "Reconciliation: 테이블 없음";

  const analysis = (() => {
    if (summary.level === "critical") {
      return "분석: 커버리지 50% 미만 신호가 있습니다. 해당 모델을 shadow로 강등하거나 재학습을 고려하세요.";
    }
    if (summary.level === "warning") {
      return "분석: 커버리지 70% 미만 신호가 감지됐습니다. calibration drift 추세를 확인하세요.";
    }
    if (summary.activeModels === 0 && summary.shadowModels === 0) {
      return "분석: 승격된 모델이 없습니다. 대시보드는 관측값/프록시만 표시하고 있습니다.";
    }
    return "분석: 게이트가 강제되고 있으며 활성 모델이 신선도 범위 안에서 작동 중입니다.";
  })();

  return [
    `Lattice Nowcast 상태: ${translateNowcastLevel(summary.level)}`,
    registryLine,
    reconcLine,
    lastPassLine,
    lastFailLine,
    "Reconciliation 상세 (상위 6개):",
    driftLines.join("\n"),
    "최근 게이트 실패 스냅샷 (상위 3개):",
    gateFailLines.join("\n"),
    analysis,
    `링크: ${createDeepLink(config, "#ops")}`,
  ].filter(Boolean).join("\n");
}

type HotEventsPayload = {
  ok: boolean;
  available: boolean;
  lookbackDays: number;
  limit?: number;
  totalReturned?: number;
  gradeCounts?: Record<string, number>;
  surgeCount?: number;
  events: Array<{
    id: number;
    theme: string | null;
    title: string | null;
    eventDate: string | null;
    articleCount: number;
    sourceCount: number;
    temperature: number | null;
    isSurge: boolean;
    bestEvidenceGrade: string | null;
    upliftRows: number;
    maxAbsUplift: number | null;
    maxAbsTStat: number | null;
  }>;
  note?: string;
};

function summarizeHotEvents(payload: HotEventsPayload, config: Required<PluginConfig>): string {
  if (!payload.available) {
    return ["Lattice 핫 이벤트: 사용할 수 없음", payload.note || "canonical_events 테이블 없음"].join("\n");
  }
  const events = payload.events || [];
  const gc = payload.gradeCounts || {};
  const gradeLine = `증거 등급: E4 ${gc.E4 ?? 0} | E3 ${gc.E3 ?? 0} | E2 ${gc.E2 ?? 0} | E1 ${gc.E1 ?? 0} | E0 ${gc.E0 ?? 0} | none ${gc.none ?? 0}`;
  const eventLines = events.slice(0, 8).map((ev) => {
    const temp = ev.temperature == null ? "n/a" : ev.temperature.toFixed(2);
    const uplift = ev.maxAbsUplift == null ? "n/a" : (ev.maxAbsUplift * 100).toFixed(2) + "%";
    const tstat = ev.maxAbsTStat == null ? "n/a" : ev.maxAbsTStat.toFixed(2);
    const grade = ev.bestEvidenceGrade || "N/A";
    const surge = ev.isSurge ? " 🔥" : "";
    return `- [#${ev.id}] ${String(ev.title || "(무제)").slice(0, 80)} | ${String(ev.theme || "")} | ${String(ev.eventDate || "").slice(0, 10)} | 등급 ${grade} | T=${tstat} | |uplift|=${uplift} | 기사 ${ev.articleCount} | 온도 ${temp}${surge}`;
  });
  const analysis = events.length === 0
    ? "분석: 지정 범위 내 이벤트 없음."
    : (gc.E4 ?? 0) + (gc.E3 ?? 0) > 0
      ? "분석: E3/E4 높은 증거 등급 이벤트 발생. Decision Inbox에서 해당 이벤트 검토 권장."
      : "분석: 낮은 증거 등급 이벤트만 감지 — 추가 기사 수집 대기.";
  return [
    `Lattice 핫 이벤트 (최근 ${payload.lookbackDays}일, 상위 ${payload.totalReturned ?? events.length}건):`,
    gradeLine,
    payload.surgeCount != null ? `Hawkes 급등 이벤트: ${payload.surgeCount}건` : null,
    "",
    eventLines.length ? eventLines.join("\n") : "- 해당 이벤트 없음",
    "",
    analysis,
    `링크: ${createDeepLink(config, "#investigate")}`,
  ].filter(Boolean).join("\n");
}

type MetaModelHealthPayload = {
  ok: boolean;
  generatedAt: string;
  summary: {
    level: "ok" | "warning" | "critical";
    hasEvalTable: boolean;
    hasPredictionsTable: boolean;
    latestEval: {
      modelVersion?: string;
      evalDate?: string;
      brierScore?: number | null;
      ece?: number | null;
      logLoss?: number | null;
      sampleCount?: number | null;
    } | null;
    recentPredictions: {
      total: number;
      modelVersions: number;
      recentWindowHours: number;
      recentCount: number;
    } | null;
    notes: string[];
  };
  evalHistory: Array<{
    modelVersion: string;
    evalDate: string;
    brierScore: number | null;
    ece: number | null;
    logLoss: number | null;
    sampleCount: number | null;
  }>;
  activeModelVersions: Array<{ modelVersion: string; predictionCount: number; latestAt: string | null }>;
};

function summarizeMetaModelHealth(payload: MetaModelHealthPayload, config: Required<PluginConfig>): string {
  const s = payload.summary;
  const level = s.level === "critical" ? "심각" : s.level === "warning" ? "주의" : "정상";
  const latest = s.latestEval;
  const latestLine = latest
    ? `최신 평가: ${String(latest.modelVersion || "?")} (${formatTimestamp(String(latest.evalDate || ""))}) | Brier ${latest.brierScore == null ? "n/a" : latest.brierScore.toFixed(4)} | ECE ${latest.ece == null ? "n/a" : latest.ece.toFixed(4)} | LogLoss ${latest.logLoss == null ? "n/a" : latest.logLoss.toFixed(4)} | n=${latest.sampleCount ?? "n/a"}`
    : "최신 평가 없음";
  const recent = s.recentPredictions;
  const recentLine = recent
    ? `예측: 총 ${recent.total} | 모델 버전 ${recent.modelVersions}개 | 최근 ${recent.recentWindowHours}시간 ${recent.recentCount}건`
    : "예측 테이블 접근 불가";
  const versionLines = (payload.activeModelVersions || []).slice(0, 3).map((v) =>
    `- ${v.modelVersion}: ${v.predictionCount}건, 최신 ${formatTimestamp(String(v.latestAt || ""))}`,
  );
  const notesLine = s.notes && s.notes.length ? s.notes.map((n) => `  • ${n}`).join("\n") : "  • 이슈 없음";
  return [
    `Lattice 메타모델 상태: ${level}`,
    latestLine,
    recentLine,
    "활성 모델:",
    versionLines.length ? versionLines.join("\n") : "- 활성 모델 없음",
    "주의사항:",
    notesLine,
    `링크: ${createDeepLink(config, "#ops")}`,
  ].join("\n");
}

type ExplainEventPayload = {
  ok: boolean;
  error?: string;
  event?: {
    id: number;
    theme: string | null;
    title: string | null;
    eventDate: string | null;
    articleCount: number;
    sourceCount: number;
    sampledSourceDiversity: number;
    createdAt: string | null;
  };
  hawkes?: { temperature: number | null; isSurge: boolean; articleCount: number } | null;
  articles?: Array<{ id: number; title: string | null; sourceId: string | null; publishedAt: string | null; url: string | null }>;
  uplift?: Array<{
    symbol: string;
    horizon: string;
    uplift: number | null;
    tStat: number | null;
    evidenceGrade: string | null;
    eventAlphaMean: number | null;
    controlAlphaMean: number | null;
    nControls: number | null;
  }>;
  controls?: Array<{ controlDate: string; matchDistance: number | null; vixDelta: number | null; yieldSpreadDelta: number | null; regimeEvent: string | null; regimeControl: string | null }>;
};

function summarizeExplainEvent(payload: ExplainEventPayload, config: Required<PluginConfig>): string {
  if (!payload.ok || !payload.event) {
    return `이벤트 조회 실패: ${payload.error || "알 수 없음"}`;
  }
  const ev = payload.event;
  const hawkes = payload.hawkes;
  const uplift = payload.uplift || [];
  const articles = payload.articles || [];

  const upliftLines = uplift.slice(0, 6).map((u) => {
    const upl = u.uplift == null ? "n/a" : (u.uplift * 100).toFixed(2) + "%";
    const t = u.tStat == null ? "n/a" : u.tStat.toFixed(2);
    return `- ${u.symbol} [${u.horizon}] | 등급 ${u.evidenceGrade || "?"} | uplift ${upl} | T=${t} | controls=${u.nControls ?? "?"}`;
  });
  const articleLines = articles.slice(0, 5).map((a) => `- ${String(a.title || "(무제)").slice(0, 90)} (${a.sourceId || "?"})`);
  const hawkesLine = hawkes
    ? `Hawkes 온도: ${hawkes.temperature == null ? "n/a" : hawkes.temperature.toFixed(2)} | 급등여부: ${hawkes.isSurge ? "예" : "아니오"} | 기사 ${hawkes.articleCount}`
    : "Hawkes 온도: n/a";

  return [
    `Lattice 이벤트 상세 #${ev.id}: ${ev.title || "(무제)"}`,
    `테마 ${ev.theme || "?"} | 이벤트일 ${String(ev.eventDate || "").slice(0, 10)} | 기사 ${ev.articleCount} | 소스 ${ev.sourceCount} (표본 다양성 ${ev.sampledSourceDiversity})`,
    hawkesLine,
    "",
    `종목 반응 (상위 ${Math.min(6, uplift.length)}건):`,
    upliftLines.length ? upliftLines.join("\n") : "- uplift 데이터 없음 (matched_controls 미빌드 또는 n < 30)",
    "",
    "기사 샘플:",
    articleLines.length ? articleLines.join("\n") : "- 기사 매핑 없음",
    `링크: ${createDeepLink(config, "#investigate")}`,
  ].join("\n");
}

type SourceDiversityAuditPayload = {
  ok: boolean;
  available: boolean;
  windowHours: number;
  totalArticles?: number;
  distinctSources?: number;
  topSourceShare?: number;
  syndicatorShare?: number;
  level?: "ok" | "warning" | "critical";
  sources: Array<{
    sourceId: string;
    articleCount: number;
    share: number;
    isSyndicator: boolean;
    flag: "warning" | "critical" | null;
  }>;
  note?: string;
};

function summarizeSourceDiversityAudit(payload: SourceDiversityAuditPayload, config: Required<PluginConfig>): string {
  if (!payload.available) {
    return ["Lattice 소스 다양성: 사용할 수 없음", payload.note || "articles 테이블 없음"].join("\n");
  }
  const level = payload.level === "critical" ? "심각" : payload.level === "warning" ? "주의" : "정상";
  const topShare = payload.topSourceShare == null ? "n/a" : (payload.topSourceShare * 100).toFixed(1) + "%";
  const syndShare = payload.syndicatorShare == null ? "n/a" : (payload.syndicatorShare * 100).toFixed(1) + "%";
  const topSources = (payload.sources || []).slice(0, 8).map((s) => {
    const flagIcon = s.flag === "critical" ? " ⛔" : s.flag === "warning" ? " ⚠️" : "";
    const synd = s.isSyndicator ? " [syndicator]" : "";
    return `- ${s.sourceId}: ${s.articleCount} (${(s.share * 100).toFixed(1)}%)${synd}${flagIcon}`;
  });
  const analysis = payload.level === "critical"
    ? "분석: 단일 소스가 50% 초과 점유 — 소스 다양화 또는 해당 소스 비중 제한 필요."
    : payload.level === "warning"
      ? "분석: 단일 소스 30% 이상 또는 syndicator 비중 25% 이상 — 클러스터 편향 가능성."
      : "분석: 소스 분포 정상 범위.";
  return [
    `Lattice 소스 다양성 (${payload.windowHours}시간 창): ${level}`,
    `총 기사 ${payload.totalArticles ?? 0} | 고유 소스 ${payload.distinctSources ?? 0} | 최상위 소스 점유 ${topShare} | syndicator 점유 ${syndShare}`,
    "",
    "상위 소스:",
    topSources.length ? topSources.join("\n") : "- 데이터 없음",
    "",
    analysis,
    `링크: ${createDeepLink(config, "#ops")}`,
  ].join("\n");
}

type ThemeImpactPayload = {
  ok: boolean;
  error?: string;
  theme?: string;
  horizon?: string | null;
  sensitivityAvailable?: boolean;
  regimeAvailable?: boolean;
  conditionalAvailable?: boolean;
  autoMappingAvailable?: boolean;
  sensitivity?: Array<{
    symbol: string;
    horizon: string;
    sampleSize: number;
    avgReturn: number | null;
    hitRate: number | null;
    returnVol: number | null;
    sensitivityZScore: number | null;
    baselineReturn: number | null;
    baselineVol: number | null;
    interpretation: string | null;
  }>;
  regime?: Array<{
    symbol: string;
    horizon: string;
    regime: string;
    sampleSize: number;
    avgReturn: number | null;
    hitRate: number | null;
    regimeMultiplier: number | null;
    anomalyRate: number | null;
  }>;
  conditional?: Array<{
    symbol: string;
    horizon: string;
    conditionType: string;
    conditionValue: string;
    avgReturn: number | null;
    hitRate: number | null;
    sampleSize: number;
  }>;
  autoMapping?: Array<{
    symbol: string;
    avgAbsReaction: number | null;
    reactionCount: number;
    correlation: number | null;
    method: string | null;
    qualityScore: number | null;
    directionalEdge: number | null;
    outcomeHitRate: number | null;
    outcomeAvgReturn: number | null;
  }>;
};

function summarizeThemeImpact(payload: ThemeImpactPayload, config: Required<PluginConfig>): string {
  if (!payload.ok) return `테마 영향 분석 실패: ${payload.error || "알 수 없음"}`;
  const sensLines = (payload.sensitivity || []).slice(0, 6).map((s) => {
    const z = s.sensitivityZScore == null ? "n/a" : s.sensitivityZScore.toFixed(2);
    const hit = s.hitRate == null ? "n/a" : (s.hitRate * 100).toFixed(1) + "%";
    const avg = s.avgReturn == null ? "n/a" : (s.avgReturn * 100).toFixed(2) + "%";
    return `- ${s.symbol} [${s.horizon}] | Z=${z} | 적중률 ${hit} | 평균수익 ${avg} | n=${s.sampleSize}`;
  });
  const regimeLines = (payload.regime || []).slice(0, 5).map((r) => {
    const mult = r.regimeMultiplier == null ? "n/a" : r.regimeMultiplier.toFixed(2);
    const avg = r.avgReturn == null ? "n/a" : (r.avgReturn * 100).toFixed(2) + "%";
    return `- ${r.symbol} [${r.horizon}] ${r.regime} | 배수 ${mult} | 평균 ${avg} | n=${r.sampleSize}`;
  });
  const autoLines = (payload.autoMapping || []).slice(0, 5).map((a) => {
    const q = a.qualityScore == null ? "n/a" : a.qualityScore.toFixed(2);
    const corr = a.correlation == null ? "n/a" : a.correlation.toFixed(2);
    return `- ${a.symbol} | 반응 ${a.reactionCount}회 | 품질 ${q} | 상관 ${corr}`;
  });
  const counts = `민감도 ${payload.sensitivity?.length ?? 0} | 체제별 ${payload.regime?.length ?? 0} | 조건부 ${payload.conditional?.length ?? 0} | 자동매핑 ${payload.autoMapping?.length ?? 0}`;
  return [
    `Lattice 테마 영향: "${payload.theme}"${payload.horizon ? ` (horizon ${payload.horizon})` : ""}`,
    counts,
    "",
    "민감도 상위 (Z-score 기준):",
    sensLines.length ? sensLines.join("\n") : "- 데이터 없음",
    "",
    "체제별 반응 상위:",
    regimeLines.length ? regimeLines.join("\n") : "- 데이터 없음",
    "",
    "자동 매핑 상위:",
    autoLines.length ? autoLines.join("\n") : "- 매핑 없음",
    `링크: ${createDeepLink(config, "#investigate")}`,
  ].join("\n");
}

type BulkSimulationResult = {
  id: number;
  ok: boolean;
  dryRun?: boolean;
  decision?: string;
  quality?: number | null;
  reason?: string | null;
  outcome?: "would-accept" | "would-skip" | "would-fail" | "error";
  error?: string;
};

function summarizeBulkSimulation(results: BulkSimulationResult[], config: Required<PluginConfig>): string {
  const total = results.length;
  const accepted = results.filter((r) => r.outcome === "would-accept").length;
  const skipped = results.filter((r) => r.outcome === "would-skip").length;
  const failed = results.filter((r) => r.outcome === "would-fail" || r.outcome === "error").length;
  const lines = results.slice(0, 10).map((r) => {
    const outcome = r.outcome === "would-accept" ? "수락예상"
      : r.outcome === "would-skip" ? "스킵예상"
      : r.outcome === "would-fail" ? "실패예상"
      : "오류";
    const q = r.quality == null ? "n/a" : r.quality.toFixed(2);
    const reason = r.reason || r.error || "";
    return `- #${r.id}: ${outcome} | 품질 ${q}${reason ? " | " + String(reason).slice(0, 80) : ""}`;
  });
  return [
    `Lattice 일괄 시뮬레이션 (${total}건):`,
    `수락예상 ${accepted} | 스킵예상 ${skipped} | 실패/오류 ${failed}`,
    "",
    lines.length ? lines.join("\n") : "- 결과 없음",
    `링크: ${createDeepLink(config, "#inbox")}`,
  ].join("\n");
}

async function readJsonFile(filePath: string): Promise<JsonObject | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}

async function readLatestAudit(rootDir: string): Promise<JsonObject | null> {
  const auditsDir = path.join(repoDataDir(rootDir), "audits");
  try {
    const candidates = (await fs.readdir(auditsDir))
      .filter((name) => (
        name.startsWith("codex-source-code-application-evidence-")
        || name.startsWith("source-repair-closed-loop-")
      ) && name.endsWith(".json"));
    const ranked = await Promise.all(candidates.map(async (name) => {
      const filePath = path.join(auditsDir, name);
      try {
        const stat = await fs.stat(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      } catch {
        return { filePath, mtimeMs: 0 };
      }
    }));
    ranked.sort((a, b) => b.mtimeMs - a.mtimeMs || b.filePath.localeCompare(a.filePath));
    for (const candidate of ranked) {
      const parsed = await readJsonFile(candidate.filePath);
      if (parsed) return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function finiteNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeSourceRepairAuditCase(item: JsonObject): JsonObject {
  const registration = ((item.registration || {}) as JsonObject);
  const backfill = ((item.backfill || {}) as JsonObject);
  const quality = ((registration.quality || {}) as JsonObject);
  const record = ((registration.record || {}) as JsonObject);
  const inserted = finiteNumber(backfill.inserted ?? backfill.fetched);
  const qualityScore = finiteNumber(item.qualityScore ?? quality.score);
  return {
    feedName: item.feedName || record.feedName || item.repairedUrl || item.originalUrl || "source",
    url: registration.feedUrl || item.repairedUrl || record.url || item.originalUrl,
    category: item.theme || item.originalTheme || record.category || "unknown",
    confidence: finiteNumber(record.confidence, Math.round(qualityScore * 100)),
    connectorKind: item.connectorKind || quality.connectorKind,
    articleCount: inserted,
    articleCount72h: finiteNumber(item.recentItemCount ?? quality.recentItemCount),
    themedCount: finiteNumber(backfill.themed),
    latestPublishedAt: item.latestPublishedAt || record.updatedAt || null,
    passed: Boolean(registration.registered) && inserted > 0,
  };
}

function normalizeSourceRepairAudit(audit: JsonObject | null): SourceRepairAuditSummary {
  if (!audit) {
    return {
      ok: false,
      schema: "none",
      generatedAt: "",
      caseCount: 0,
      passedCaseCount: 0,
      targetSuccesses: 10,
      countedSuccesses: 0,
      totalArticles: 0,
      totalRecent72hArticles: 0,
      totalThemedArticles: 0,
      historical: null,
      codeRepairResults: [],
      cases: [],
    };
  }

  const evidenceCases = asArray<JsonObject>(audit.cases);
  if (evidenceCases.length || audit.caseCount != null || audit.passedCaseCount != null) {
    const caseCount = finiteNumber(audit.caseCount, evidenceCases.length);
    const passedCaseCount = finiteNumber(
      audit.passedCaseCount,
      evidenceCases.filter((item) => item.passed !== false).length,
    );
    return {
      ok: Boolean(audit.ok),
      schema: "codex-source-code-application-evidence",
      generatedAt: String(audit.generatedAt || audit.finishedAt || ""),
      caseCount,
      passedCaseCount,
      targetSuccesses: finiteNumber(audit.targetSuccesses, Math.max(10, caseCount)),
      countedSuccesses: passedCaseCount,
      totalArticles: finiteNumber(audit.totalArticles),
      totalRecent72hArticles: finiteNumber(audit.totalRecent72hArticles),
      totalThemedArticles: finiteNumber(audit.totalThemedArticles),
      historical: null,
      codeRepairResults: asArray<JsonObject>(audit.codeRepairResults).slice(0, 5),
      cases: evidenceCases,
    };
  }

  const successes = asArray<JsonObject>(audit.successes);
  const skipped = asArray<JsonObject>(audit.skipped);
  const failures = asArray<JsonObject>(audit.failures);
  if (successes.length || skipped.length || failures.length || audit.targetSuccesses != null) {
    const cases = successes.map((item) => normalizeSourceRepairAuditCase(item));
    const historical = ((audit.historical || {}) as JsonObject);
    const countedSuccesses = finiteNumber(
      audit.countedSuccesses,
      cases.filter((item) => item.passed !== false).length,
    );
    return {
      ok: Boolean(audit.ok),
      schema: "source-repair-closed-loop",
      generatedAt: String(audit.finishedAt || audit.generatedAt || audit.startedAt || ""),
      caseCount: successes.length + skipped.length + failures.length,
      passedCaseCount: countedSuccesses,
      targetSuccesses: finiteNumber(audit.targetSuccesses, Math.max(1, successes.length)),
      totalArticles: cases.reduce((sum, item) => sum + finiteNumber(item.articleCount), 0),
      totalRecent72hArticles: cases.reduce((sum, item) => sum + finiteNumber(item.articleCount72h), 0),
      totalThemedArticles: cases.reduce((sum, item) => sum + finiteNumber(item.themedCount), 0),
      countedSuccesses,
      historical,
      codeRepairResults: asArray<JsonObject>(audit.codeRepairResults).slice(0, 5),
      cases,
    };
  }

  return {
    ok: Boolean(audit.ok),
    schema: "unknown",
    generatedAt: String(audit.generatedAt || audit.finishedAt || ""),
    caseCount: 0,
    passedCaseCount: 0,
    targetSuccesses: 10,
    countedSuccesses: 0,
    totalArticles: 0,
    totalRecent72hArticles: 0,
    totalThemedArticles: 0,
    historical: null,
    codeRepairResults: asArray<JsonObject>(audit.codeRepairResults).slice(0, 5),
    cases: [],
  };
}

export function normalizeSourceRepairAuditForTest(audit: JsonObject | null): SourceRepairAuditSummary {
  return normalizeSourceRepairAudit(audit);
}

export const __openClawLatticeTestUtils = {
  readConfig,
  summarizeRuntimeObservabilitySidecar,
  summarizeAutomationOpsSidecar,
};

async function readSourceRegistry(rootDir: string): Promise<JsonObject[]> {
  const filePath = path.join(repoDataDir(rootDir), "persistent-cache", "source-registry%3Av1.json");
  const parsed = await readJsonFile(filePath);
  const data = ((parsed?.data || {}) as JsonObject);
  return asArray<JsonObject>(data.discoveredSources);
}

function sourceRepairCountsFromApprovals(data: JsonObject): SourceRepairStatus["approval"] {
  const approvals = asArray<JsonObject>((data as { approvals?: unknown }).approvals);
  const countStatus = (status: string) => approvals.filter((item) => item.status === status).length;
  const sourceNeedsFix = approvals.filter((item) => {
    const payload = ((item.payload || {}) as JsonObject);
    const action = String(item.action_type || item.type || "");
    return item.status === "needs-fix" && (action.includes("rss") || Boolean(payload.url));
  }).length;
  return {
    total: approvals.length,
    pending: countStatus("pending"),
    needsFix: countStatus("needs-fix"),
    sourceNeedsFix,
  };
}

function sourceRepairFreshnessFromAudit(data: JsonObject): SourceRepairStatus["freshness"] {
  const summary = ((data.summary || {}) as JsonObject);
  const nas = ((data.nas || {}) as JsonObject);
  const articles = ((nas.articles || {}) as JsonObject);
  return {
    findings: summary.findings ?? "없음",
    cacheIssues: summary.cacheIssues ?? "없음",
    articleCount24h: summary.articleCount24h ?? "없음",
    articleCount72h: summary.articleCount72h ?? "없음",
    latestPublishedAt: articles.latestPublishedAt || "없음",
  };
}

async function buildSourceRepairStatus(api: { rootDir: string }, config: Required<PluginConfig>): Promise<SourceRepairStatus> {
  const [audit, registryRows, approvalQueue, freshnessAudit] = await Promise.all([
    readLatestAudit(api.rootDir),
    readSourceRegistry(api.rootDir),
    fetchJson(buildUrl(config.latticeApiBaseUrl, "/api/approval-queue"), config.timeoutMs),
    fetchJson(buildUrl(config.latticeApiBaseUrl, "/api/data-freshness-audit"), config.timeoutMs),
  ]);

  const closedLoopRows = registryRows.filter((item) => item.discoveredBy === "codex-source-repair-closed-loop");
  const closedLoopActive = closedLoopRows.filter((item) => item.status === "active");
  const closedLoopApproved = closedLoopRows.filter((item) => item.status === "approved");
  const auditSummary = normalizeSourceRepairAudit(audit);
  const auditTarget = Math.max(
    1,
    Math.min(auditSummary.targetSuccesses || 10, auditSummary.countedSuccesses || auditSummary.caseCount || auditSummary.targetSuccesses || 10),
  );

  return {
    ok: auditSummary.ok && auditSummary.passedCaseCount >= auditTarget && closedLoopActive.length >= 10,
    generatedAt: new Date().toISOString(),
    audit,
    auditSummary,
    registry: {
      total: registryRows.length,
      active: registryRows.filter((item) => item.status === "active").length,
      closedLoopActive: closedLoopActive.length,
      closedLoopApproved: closedLoopApproved.length,
      topClosedLoop: closedLoopActive.slice(0, 8).map((item) => ({
        feedName: item.feedName,
        category: item.category,
        confidence: item.confidence,
        url: item.url,
      })),
    },
    approval: sourceRepairCountsFromApprovals(approvalQueue),
    freshness: sourceRepairFreshnessFromAudit(freshnessAudit),
  };
}

function summarizeSourceRepairStatus(status: SourceRepairStatus, config: Required<PluginConfig>): string {
  const audit = status.auditSummary;
  const latestCases = audit.cases.slice(0, 5).map((item) => {
    const latest = item.latestPublishedAt ? ` | 최신 ${formatTimestamp(String(item.latestPublishedAt))}` : "";
    return `- ${String(item.feedName || item.url || "소스")} | ${String(item.category || "알 수 없음")} | 기사 ${String(item.articleCount ?? "없음")}${latest}`;
  });
  const auditLabel = audit.schema === "source-repair-closed-loop" ? "최근 수리 실행" : "누적 수리 증거";
  const historical = ((audit.historical || {}) as JsonObject);
  const historicalLine = audit.schema === "source-repair-closed-loop" && historical
    ? `누적 파이프라인: 등록·백필 ${finiteNumber(historical.seededSources)} | 테마 ${finiteNumber(historical.themedSources)} | 이벤트맵 ${finiteNumber(historical.eventMappedSources)} | pending outcome ${finiteNumber(historical.pendingOutcomes)}`
    : "";
  const codexHistoricalLine = audit.schema === "source-repair-closed-loop" && historical
    ? `Codex 코드수리 증거: 활성 ${finiteNumber(historical.codexRepairActiveSources)} | 백필 ${finiteNumber(historical.codexRepairSeededSources)} | 이벤트맵 ${finiteNumber(historical.codexRepairEventMappedSources)} | pending outcome ${finiteNumber(historical.codexRepairPendingOutcomes)}`
    : "";
  const codeRepairFeedbackLine = audit.codeRepairResults.length
    ? `Codex 코드수리 피드백: 최근 결과 ${audit.codeRepairResults.length}건 | ${audit.codeRepairResults.slice(0, 3).map((item) => `${String(item.status || "unknown")}:${String(item.runId || "run").slice(0, 24)}`).join(" | ")}`
    : "Codex 코드수리 피드백: 최근 결과 없음";

  return [
    `Lattice 소스 수리 상태: ${status.ok ? "정상" : "주의"}`,
    `Codex 자동수리 루프(${auditLabel}): ${audit.countedSuccesses || audit.passedCaseCount}/${audit.targetSuccesses} 기준 충족 | 이번 실행 ${audit.caseCount}건 | 백필 기사 ${audit.totalArticles} | 테마 태깅 ${audit.totalThemedArticles}`,
    historicalLine,
    codexHistoricalLine,
    codeRepairFeedbackLine,
    `소스 레지스트리: 활성 ${status.registry.active}/${status.registry.total} | 수리 후 활성 ${status.registry.closedLoopActive} | 수리 후 승인 ${status.registry.closedLoopApproved}`,
    `승인 큐: 전체 ${status.approval.total} | 대기 ${status.approval.pending} | 수정필요 ${status.approval.needsFix} | 소스 수정필요 ${status.approval.sourceNeedsFix}`,
    `데이터 신선도: 24시간 기사 ${String(status.freshness.articleCount24h)} | 72시간 기사 ${String(status.freshness.articleCount72h)} | 최신 ${formatTimestamp(String(status.freshness.latestPublishedAt || ""))}`,
    "분석: 홈페이지나 사이트맵뿐인 저품질 후보는 수정필요로 남기고, Codex 수리 목록이 RSS 후보를 찾아 검증, 등록, 백필, 테마 태깅까지 이어갑니다.",
    latestCases.length ? latestCases.join("\n") : "- 최신 수리 사례 없음",
    `링크: ${createDeepLink(config, "#inbox")} | ${createDeepLink(config, "#ops")}`,
  ].filter(Boolean).join("\n");
}

function summarizeError(label: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${label}: 사용할 수 없음\n이유: ${message}`;
}

function repoDataDir(rootDir: string): string {
  const normalized = rootDir.replaceAll("\\", "/");
  if (normalized.endsWith("/plugins/openclaw-lattice-control-plane")) {
    return path.resolve(rootDir, "..", "..", "data");
  }
  return path.resolve(rootDir, "data");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function clipText(value: string, limit = 1_600): string {
  if (!value || value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(0, limit - 3))}...`;
}

function compactSnapshotData(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return clipText(value, 700);
  if (Array.isArray(value)) {
    const items = value.slice(0, 8).map((item) => compactSnapshotData(item, depth + 1));
    return value.length > 8 ? [...items, { omitted: value.length - 8 }] : items;
  }
  if (typeof value === "object") {
    if (depth >= 3) return "[object omitted]";
    const source = value as JsonObject;
    const compact: JsonObject = {};
    for (const [key, item] of Object.entries(source).slice(0, 16)) {
      if (["raw", "stdout", "stderr", "systemPrompt", "finalPromptText", "finalAssistantRawText"].includes(key)) {
        compact[key] = "[omitted]";
        continue;
      }
      compact[key] = compactSnapshotData(item, depth + 1);
    }
    const omitted = Object.keys(source).length - Object.keys(compact).length;
    if (omitted > 0) compact.omittedKeys = omitted;
    return compact;
  }
  return String(value);
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "없음";
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour12: false,
  });
}

async function safeSection(
  label: string,
  reader: () => Promise<JsonObject>,
  summarize: (data: JsonObject) => string,
): Promise<JsonObject> {
  try {
    const data = await reader();
    return {
      ok: true,
      summary: summarize(data),
      data: compactSnapshotData(data),
    };
  } catch (error) {
    return {
      ok: false,
      summary: summarizeError(label, error),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function compactRecentRun(run: JsonObject): JsonObject {
  return {
    eventId: run.eventId,
    eventType: run.eventType,
    finishedAt: run.finishedAt,
    exitCode: run.exitCode,
    provider: run.provider,
    model: run.model,
    summary: clipText(String(run.summary || ""), 500),
    text: clipText(String(run.text || ""), 500),
  };
}

function compactRecentEvent(event: JsonObject): JsonObject {
  return {
    eventType: event.eventType,
    severity: event.severity,
    summary: clipText(String(event.summary || ""), 500),
    entityType: event.entityType,
    entityId: event.entityId,
    surface: event.surface,
    deepLink: event.deepLink,
    createdAt: event.createdAt,
  };
}

function translateEventType(value: unknown): string {
  const normalized = String(value || "").toLowerCase();
  const labels: Record<string, string> = {
    "approval-created": "승인 항목 생성",
    "approval-needs-fix": "승인 항목 수정필요",
    "brief-ready": "브리프 준비",
    "scheduler-cycle-completed": "스케줄러 사이클 완료",
    "scheduler-cycle-failed": "스케줄러 사이클 실패",
    "source-probe-failed": "소스 검증 실패",
    "source-registered": "소스 등록",
    "source-rejected": "소스 거절",
    "source-repaired": "소스 수리",
  };
  return labels[normalized] || String(value || "알 수 없음");
}

function localizeEventSummary(summary: unknown, eventType: unknown): string {
  const text = String(summary || "").trim();
  const exact: Record<string, string> = {
    "Cycle failed": "사이클 실패",
    "Daily operator brief is ready after the latest automation cycle": "최근 자동화 사이클 이후 일일 운영 브리프 준비 완료",
    "Intelligence automation cycle completed": "인텔리전스 자동화 사이클 완료",
    "Source registered": "소스 등록됨",
  };
  return exact[text] || text || translateEventType(eventType);
}

async function readRecentAgentRuns(rootDir: string, limit: number): Promise<JsonObject[]> {
  const runsDir = path.join(repoDataDir(rootDir), "openclaw-agent-runs");
  let files: string[] = [];
  try {
    files = (await fs.readdir(runsDir))
      .filter((name) => name.endsWith(".result.json"))
      .sort()
      .reverse()
      .slice(0, limit);
  } catch {
    return [];
  }

  const results = await Promise.all(files.map(async (name) => {
    try {
      const raw = await fs.readFile(path.join(runsDir, name), "utf8");
      const parsed = JSON.parse(raw) as JsonObject;
      const parsedBlock = ((parsed.parsed || {}) as JsonObject);
      const resultBlock = ((parsedBlock.result || {}) as JsonObject);
      const payloads = asArray<JsonObject>(resultBlock.payloads);
      const meta = (resultBlock.meta || {}) as JsonObject;
      const executionTrace = (meta.executionTrace || {}) as JsonObject;
      const agentMeta = (meta.agentMeta || {}) as JsonObject;
      const firstPayload = payloads[0] || {};
      const text = typeof firstPayload.text === "string"
        ? firstPayload.text
        : typeof meta?.finalAssistantVisibleText === "string"
          ? String(meta.finalAssistantVisibleText)
          : "";
      return {
        eventId: parsed.eventId,
        eventType: parsed.eventType,
        finishedAt: parsed.finishedAt,
        exitCode: parsed.exitCode,
        summary: (((parsed.parsed || {}) as JsonObject).summary || parsed.stdout || "") as string,
        provider: executionTrace?.winnerProvider || agentMeta?.provider || "unknown",
        model: executionTrace?.winnerModel || agentMeta?.model || "unknown",
        text,
      };
    } catch {
      return null;
    }
  }));

  return results.filter(Boolean) as JsonObject[];
}

async function readRecentEvents(rootDir: string, limit: number): Promise<JsonObject[]> {
  const filePath = path.join(repoDataDir(rootDir), "openclaw-webhook-events.jsonl");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-limit);
    return lines
      .map((line) => {
        try {
          return JSON.parse(line) as JsonObject;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as JsonObject[];
  } catch {
    return [];
  }
}

async function buildDashboardSnapshot(api: { rootDir: string }, config: Required<PluginConfig>): Promise<JsonObject> {
  const [health, kpi, liveStatus, approvals, freshness, discovery, themeBrief, recentRuns, recentEvents] = await Promise.all([
    safeSection("상태", () => fetchJson(buildUrl(config.latticeApiBaseUrl, "/api/health"), config.timeoutMs), (data) => summarizeHealth(data, config)),
    safeSection("KPI 요약", () => fetchJson(buildUrl(config.latticeApiBaseUrl, "/api/kpi-summary"), config.timeoutMs), (data) => summarizeKpi(data, config)),
    safeSection("라이브 상태", () => fetchJson(buildUrl(config.latticeApiBaseUrl, "/api/live-status"), config.timeoutMs), (data) => summarizeLiveStatus(data, config, 6)),
    safeSection("승인 큐", () => fetchJson(buildUrl(config.latticeApiBaseUrl, "/api/approval-queue"), config.timeoutMs), (data) => summarizeApprovalQueue(data, config, 6)),
    safeSection("신선도 감사", () => fetchJson(buildUrl(config.latticeApiBaseUrl, "/api/data-freshness-audit"), config.timeoutMs), (data) => summarizeFreshnessAudit(data, config)),
    safeSection("발견 검토", () => fetchJson(buildUrl(config.latticeApiBaseUrl, "/api/discovery-triage"), config.timeoutMs), (data) => summarizeDiscoveryTriage(data, config, 6)),
    safeSection("테마 브리프", () => fetchJson(buildUrl(config.latticeApiBaseUrl, `/api/theme-brief/${encodeURIComponent(config.defaultTheme)}`), config.timeoutMs), (data) => summarizeThemeBrief(data, config)),
    readRecentAgentRuns(api.rootDir, 6),
    readRecentEvents(api.rootDir, 8),
  ]);

  const compactRecentRuns = asArray<JsonObject>(recentRuns).map(compactRecentRun);
  const compactRecentEvents = asArray<JsonObject>(recentEvents).map(compactRecentEvent);
  const latestBrief = compactRecentRuns.find((run) => run.eventType === "brief-ready") || null;
  return {
    generatedAt: new Date().toISOString(),
    links: {
      latticeHome: createDeepLink(config, "#home"),
      decisionInbox: createDeepLink(config, "#inbox"),
      investigate: createDeepLink(config, "#investigate"),
      ops: createDeepLink(config, "#ops"),
      rawSnapshot: "/plugins/lattice/api/snapshot",
    },
    sections: {
      health,
      kpi,
      liveStatus,
      approvals,
      freshness,
      discovery,
      themeBrief,
    },
    latestBrief,
    recentRuns: compactRecentRuns,
    recentEvents: compactRecentEvents,
  };
}

function renderSectionCard(title: string, section: JsonObject): string {
  const summary = typeof section.summary === "string" ? section.summary : `${title}: 사용할 수 없음`;
  const state = section.ok === false ? "degraded" : "ok";
  const stateLabel = state === "ok" ? "정상" : "주의";
  return `
    <section class="card ${state}">
      <header class="card-header">
        <h2>${escapeHtml(title)}</h2>
        <span class="badge">${stateLabel}</span>
      </header>
      <pre>${escapeHtml(summary)}</pre>
    </section>
  `;
}

function renderRecentRuns(runs: JsonObject[]): string {
  if (runs.length === 0) {
    return "<li>아직 수집된 에이전트 실행 기록이 없습니다.</li>";
  }
  return runs.map((run) => {
    const summary = clipText(String(run.text || run.summary || "completed"), 280);
    return `
      <li>
        <strong>${escapeHtml(translateEventType(run.eventType))}</strong>
        <span>${escapeHtml(formatTimestamp(run.finishedAt as string | undefined))}</span>
        <div>${escapeHtml(String(run.provider || "unknown"))} / ${escapeHtml(String(run.model || "unknown"))}</div>
        <p>${escapeHtml(summary)}</p>
      </li>
    `;
  }).join("");
}

function renderRecentEvents(events: JsonObject[]): string {
  if (events.length === 0) {
    return "<li>아직 수집된 웹훅 이벤트가 없습니다.</li>";
  }
  return events.slice().reverse().map((event) => `
      <li>
        <strong>${escapeHtml(translateEventType(event.eventType))}</strong>
        <span>${escapeHtml(formatTimestamp(event.createdAt as string | undefined))}</span>
        <p>${escapeHtml(localizeEventSummary(event.summary, event.eventType))}</p>
      </li>
    `).join("");
}

function renderDashboardHtml(snapshot: JsonObject): string {
  const links = ((snapshot.links || {}) as JsonObject);
  const sections = ((snapshot.sections || {}) as JsonObject);
  const latestBrief = (snapshot.latestBrief || null) as JsonObject | null;
  const briefText = latestBrief ? clipText(String(latestBrief.text || latestBrief.summary || "브리프 내용 없음"), 1_200) : "아직 완료된 브리프가 없습니다.";
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="20" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lattice OpenClaw 운영 화면</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b0d12;
        --panel: #151922;
        --panel-alt: #1b2130;
        --text: #f4f7fb;
        --muted: #9aa4b2;
        --line: rgba(255,255,255,0.09);
        --accent: #5eead4;
        --warn: #f59e0b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", system-ui, sans-serif;
        background: radial-gradient(circle at top, #162031 0, #0b0d12 48%);
        color: var(--text);
      }
      main { max-width: 1380px; margin: 0 auto; padding: 28px; }
      .hero { display: grid; gap: 16px; margin-bottom: 20px; }
      .hero h1 { margin: 0; font-size: 30px; }
      .hero p { margin: 0; color: var(--muted); }
      .actions { display: flex; flex-wrap: wrap; gap: 10px; }
      .actions a {
        display: inline-flex; align-items: center; justify-content: center;
        padding: 10px 14px; border-radius: 12px; text-decoration: none;
        color: var(--text); background: var(--panel); border: 1px solid var(--line);
      }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
      .card {
        background: linear-gradient(180deg, var(--panel), var(--panel-alt));
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 16px;
        min-height: 180px;
      }
      .card.degraded { border-color: rgba(245,158,11,0.35); }
      .card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
      .card h2, .panel h2 { margin: 0; font-size: 15px; letter-spacing: 0.04em; color: var(--muted); }
      .badge { font-size: 11px; font-weight: 700; color: var(--accent); }
      .degraded .badge { color: var(--warn); }
      pre {
        white-space: pre-wrap; word-break: break-word; margin: 0;
        font-family: "JetBrains Mono", Consolas, monospace; font-size: 12px; line-height: 1.55;
      }
      .panel {
        margin-top: 16px; padding: 16px; border-radius: 16px;
        background: linear-gradient(180deg, var(--panel), var(--panel-alt));
        border: 1px solid var(--line);
      }
      .meta { color: var(--muted); font-size: 13px; }
      ul { list-style: none; padding: 0; margin: 12px 0 0; display: grid; gap: 10px; }
      li {
        padding: 12px; border-radius: 12px; background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.05);
      }
      li span { display: block; color: var(--muted); font-size: 12px; margin-top: 4px; }
      li p { margin: 8px 0 0; color: var(--text); font-size: 13px; }
      .two-up { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
      @media (max-width: 960px) {
        .grid, .two-up { grid-template-columns: 1fr; }
        main { padding: 18px; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div>
          <h1>Lattice x OpenClaw 운영 화면</h1>
          <p>생성 시각 ${escapeHtml(formatTimestamp(snapshot.generatedAt as string | undefined))}. 20초마다 자동 갱신됩니다.</p>
        </div>
        <div class="actions">
          <a href="${escapeHtml(String(links.latticeHome || "#"))}" target="_blank" rel="noreferrer">Lattice 홈 열기</a>
          <a href="${escapeHtml(String(links.decisionInbox || "#"))}" target="_blank" rel="noreferrer">결정함</a>
          <a href="${escapeHtml(String(links.investigate || "#"))}" target="_blank" rel="noreferrer">조사 화면</a>
          <a href="${escapeHtml(String(links.ops || "#"))}" target="_blank" rel="noreferrer">운영 화면</a>
          <a href="${escapeHtml(String(links.rawSnapshot || "#"))}" target="_blank" rel="noreferrer">원본 JSON</a>
        </div>
      </section>
      <section class="grid">
        ${renderSectionCard("상태", (sections.health || {}) as JsonObject)}
        ${renderSectionCard("KPI", (sections.kpi || {}) as JsonObject)}
        ${renderSectionCard("라이브 상태", (sections.liveStatus || {}) as JsonObject)}
        ${renderSectionCard("승인 큐", (sections.approvals || {}) as JsonObject)}
        ${renderSectionCard("신선도 감사", (sections.freshness || {}) as JsonObject)}
        ${renderSectionCard("발견 검토", (sections.discovery || {}) as JsonObject)}
      </section>
      <section class="panel">
        <header class="card-header">
          <h2>최신 브리프</h2>
          <span class="meta">${escapeHtml(latestBrief ? formatTimestamp(latestBrief.finishedAt as string | undefined) : "없음")}</span>
        </header>
        <pre>${escapeHtml(briefText)}</pre>
      </section>
      <section class="two-up">
        <section class="panel">
          <header class="card-header">
            <h2>최근 에이전트 실행</h2>
            <span class="meta">${escapeHtml(String(asArray<JsonObject>(snapshot.recentRuns).length))}건</span>
          </header>
          <ul>${renderRecentRuns(asArray<JsonObject>(snapshot.recentRuns))}</ul>
        </section>
        <section class="panel">
          <header class="card-header">
            <h2>최근 이벤트</h2>
            <span class="meta">${escapeHtml(String(asArray<JsonObject>(snapshot.recentEvents).length))}건</span>
          </header>
          <ul>${renderRecentEvents(asArray<JsonObject>(snapshot.recentEvents))}</ul>
        </section>
      </section>
    </main>
  </body>
</html>`;
}

function writeJson(res: { setHeader: (name: string, value: string) => void; statusCode: number; end: (body?: string) => void }, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body, null, 2));
}

function writeHtml(res: { setHeader: (name: string, value: string) => void; statusCode: number; end: (body?: string) => void }, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(body);
}

function writeMethodNotAllowed(res: { setHeader: (name: string, value: string) => void; statusCode: number; end: (body?: string) => void }, allow = "GET"): void {
  res.statusCode = 405;
  res.setHeader("allow", allow);
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end("Method Not Allowed");
}

function createDashboardHandler(api: { rootDir: string; pluginConfig?: unknown }) {
  return async (req: { method?: string; url?: string }, res: { setHeader: (name: string, value: string) => void; statusCode: number; end: (body?: string) => void }) => {
    if (req.method !== "GET") {
      writeMethodNotAllowed(res, "GET");
      return true;
    }

    const url = new URL(req.url || "/", "http://127.0.0.1:18789");
    const config = readConfig(api);

    if (url.pathname === "/plugins/lattice" || url.pathname === "/plugins/lattice/") {
      const snapshot = await buildDashboardSnapshot(api, config);
      writeHtml(res, 200, renderDashboardHtml(snapshot));
      return true;
    }

    if (url.pathname === "/plugins/lattice/api/snapshot") {
      const snapshot = await buildDashboardSnapshot(api, config);
      writeJson(res, 200, snapshot);
      return true;
    }

    if (url.pathname === "/plugins/lattice/api/source-repair-status") {
      const status = await buildSourceRepairStatus({ rootDir: api.rootDir || process.cwd() }, config);
      writeJson(res, 200, {
        summary: summarizeSourceRepairStatus(status, config),
        status,
      });
      return true;
    }

    writeJson(res, 404, { error: "not_found" });
    return true;
  };
}

async function runTool(label: string, fn: () => Promise<{ summary: string; payload?: JsonObject }>) {
  try {
    const result = await fn();
    return successResult(result.summary, result.payload || {});
  } catch (error) {
    return errorResult(label, error);
  }
}

export default definePluginEntry({
  id: "openclaw-lattice-control-plane",
  name: "Lattice Control Plane",
  description: "Operator tools for local Lattice health, briefs, queue state, guarded review actions, and observability.",
  register(api) {
    api.registerHttpRoute({
      path: "/plugins/lattice",
      auth: "plugin",
      match: "prefix",
      replaceExisting: true,
      handler: createDashboardHandler({
        rootDir: api.rootDir || process.cwd(),
        pluginConfig: api.pluginConfig,
      }),
    });

    api.registerCommand({
      name: "lattice-source-status",
      description: "Show Lattice source repair closed-loop status without invoking the LLM.",
      acceptsArgs: false,
      requireAuth: false,
      handler: async () => {
        const config = readConfig(api);
        const status = await buildSourceRepairStatus({ rootDir: api.rootDir || process.cwd() }, config);
        return { text: summarizeSourceRepairStatus(status, config) };
      },
    });

    api.registerTool({
      name: "lattice.get_health",
      label: "Lattice health",
      description: "Return a concise Lattice health summary for operators.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params) {
        const config = readConfig(api);
        return runTool("lattice.get_health", async () => {
          const data = await fetchJson(buildUrl(config.latticeApiBaseUrl, "/api/health"), config.timeoutMs);
          return { summary: summarizeHealth(data, config), payload: data };
        });
      },
    });

    api.registerTool({
      name: "lattice.get_source_repair_status",
      label: "Lattice source repair status",
      description: "Return source repair closed-loop status, repaired source counts, NAS backfill evidence, and remaining needs-fix counts.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params) {
        const config = readConfig(api);
        return runTool("lattice.get_source_repair_status", async () => {
          const status = await buildSourceRepairStatus({ rootDir: api.rootDir || process.cwd() }, config);
          return {
            summary: summarizeSourceRepairStatus(status, config),
            payload: status as unknown as JsonObject,
          };
        });
      },
    });

    api.registerTool({
      name: "lattice.get_kpi_summary",
      label: "Lattice KPI summary",
      description: "Return the top-level regime and market KPI summary.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params) {
        const config = readConfig(api);
        return runTool("lattice.get_kpi_summary", async () => {
          const data = await fetchJson(buildUrl(config.latticeApiBaseUrl, "/api/kpi-summary"), config.timeoutMs);
          return { summary: summarizeKpi(data, config), payload: data };
        });
      },
    });

    api.registerTool({
      name: "lattice.get_nowcast_status",
      label: "Lattice nowcast status",
      description: "Return nowcast model registry state, 24h reconciliation drift per signal, and recent training-snapshot gate verdicts.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params) {
        const config = readConfig(api);
        return runTool("lattice.get_nowcast_status", async () => {
          const data = await fetchJson(buildUrl(config.latticeApiBaseUrl, "/api/nowcast-status"), config.timeoutMs);
          const payload = data as unknown as NowcastStatusPayload;
          return { summary: summarizeNowcastStatus(payload, config), payload: data };
        });
      },
    });

    api.registerTool({
      name: "lattice.get_hot_events",
      label: "Lattice hot events",
      description: "Return top recent canonical events ranked by evidence grade, t-stat, and Hawkes temperature.",
      parameters: Type.Object({
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 25, default: 10 })),
        lookbackDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, default: 7 })),
      }),
      async execute(_toolCallId, args: { limit?: number; lookbackDays?: number }) {
        const config = readConfig(api);
        const limit = Math.min(25, Math.max(1, Number(args?.limit ?? 10)));
        const lookbackDays = Math.min(30, Math.max(1, Number(args?.lookbackDays ?? 7)));
        return runTool("lattice.get_hot_events", async () => {
          const url = buildUrl(config.latticeApiBaseUrl, `/api/hot-events?limit=${limit}&lookback=${lookbackDays}`);
          const data = await fetchJson(url, config.timeoutMs);
          const payload = data as unknown as HotEventsPayload;
          return { summary: summarizeHotEvents(payload, config), payload: data };
        });
      },
    });

    api.registerTool({
      name: "lattice.get_meta_model_health",
      label: "Lattice meta-model health",
      description: "Return the latest meta-model calibration metrics (Brier, ECE, log-loss) and 24h prediction counts.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params) {
        const config = readConfig(api);
        return runTool("lattice.get_meta_model_health", async () => {
          const data = await fetchJson(buildUrl(config.latticeApiBaseUrl, "/api/meta-model-health"), config.timeoutMs);
          const payload = data as unknown as MetaModelHealthPayload;
          return { summary: summarizeMetaModelHealth(payload, config), payload: data };
        });
      },
    });

    api.registerTool({
      name: "lattice.explain_event",
      label: "Lattice explain event",
      description: "Return a single canonical event's full context: articles, Hawkes temperature, per-symbol uplift, and matched controls.",
      parameters: Type.Object({
        eventId: Type.Integer({ minimum: 1, description: "canonical_events.id" }),
      }),
      async execute(_toolCallId, args: { eventId: number }) {
        const config = readConfig(api);
        const id = Math.max(1, Number(args?.eventId));
        return runTool("lattice.explain_event", async () => {
          const url = buildUrl(config.latticeApiBaseUrl, `/api/explain-event/${id}`);
          const data = await fetchJson(url, config.timeoutMs);
          const payload = data as unknown as ExplainEventPayload;
          return { summary: summarizeExplainEvent(payload, config), payload: data };
        });
      },
    });

    api.registerTool({
      name: "lattice.get_source_diversity_audit",
      label: "Lattice source diversity audit",
      description: "Return recent-window article source distribution with concentration warnings (top-source share, syndicator share).",
      parameters: Type.Object({
        windowHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 168, default: 24 })),
      }),
      async execute(_toolCallId, args: { windowHours?: number }) {
        const config = readConfig(api);
        const windowHours = Math.min(168, Math.max(1, Number(args?.windowHours ?? 24)));
        return runTool("lattice.get_source_diversity_audit", async () => {
          const url = buildUrl(config.latticeApiBaseUrl, `/api/source-diversity-audit?window=${windowHours}`);
          const data = await fetchJson(url, config.timeoutMs);
          const payload = data as unknown as SourceDiversityAuditPayload;
          return { summary: summarizeSourceDiversityAudit(payload, config), payload: data };
        });
      },
    });

    api.registerTool({
      name: "lattice.get_theme_impact",
      label: "Lattice theme impact",
      description: "Return per-symbol sensitivity, regime-conditional multipliers, and auto-mapping quality for a given theme.",
      parameters: Type.Object({
        theme: Type.String({ description: "Theme key (e.g. 'energy', 'ai-ml')." }),
        horizon: Type.Optional(Type.String({ description: "Optional horizon filter (e.g. '5d')." })),
        symbolLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, default: 12 })),
      }),
      async execute(_toolCallId, args: { theme: string; horizon?: string; symbolLimit?: number }) {
        const config = readConfig(api);
        const theme = encodeURIComponent(String(args?.theme || "").trim());
        const horizon = args?.horizon ? `&horizon=${encodeURIComponent(args.horizon)}` : "";
        const limit = Math.min(30, Math.max(1, Number(args?.symbolLimit ?? 12)));
        return runTool("lattice.get_theme_impact", async () => {
          const url = buildUrl(config.latticeApiBaseUrl, `/api/theme-impact/${theme}?limit=${limit}${horizon}`);
          const data = await fetchJson(url, config.timeoutMs);
          const payload = data as unknown as ThemeImpactPayload;
          return { summary: summarizeThemeImpact(payload, config), payload: data };
        });
      },
    });

    api.registerTool({
      name: "lattice.bulk_simulate_approvals",
      label: "Lattice bulk simulate approvals",
      description: "Dry-run (simulate) multiple approval decisions in one call. Writes are never performed; each id is evaluated with dryRun=true.",
      parameters: Type.Object({
        ids: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1, maxItems: 20, description: "Approval queue ids to simulate." }),
        reviewer: Type.Optional(Type.String({ description: "Reviewer label recorded by the API." })),
      }),
      async execute(_toolCallId, args: { ids: number[]; reviewer?: string }) {
        const config = readConfig(api);
        const ids = Array.from(new Set((args?.ids || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 1))).slice(0, 20);
        return runTool("lattice.bulk_simulate_approvals", async () => {
          const results: BulkSimulationResult[] = [];
          await Promise.all(ids.map(async (id) => {
            try {
              const url = buildUrl(config.latticeApiBaseUrl, `/api/approval-queue/${id}/review`);
              const res = await fetch(url, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ decision: "accept", reviewer: args?.reviewer ?? "openclaw-bulk-sim", dryRun: true }),
                signal: AbortSignal.timeout(config.timeoutMs),
              });
              const data = (await res.json().catch(() => ({}))) as JsonObject;
              const execution = (data as { execution?: JsonObject }).execution;
              const probe = (execution?.probe ?? execution?.result) as JsonObject | undefined;
              const quality = typeof probe?.quality === "number"
                ? probe.quality
                : typeof (data as { quality?: number }).quality === "number"
                  ? (data as { quality?: number }).quality ?? null
                  : null;
              const skipped = Boolean((data as { skipped?: boolean }).skipped) || Boolean(execution?.skipped);
              const failed = !res.ok || Boolean((data as { error?: unknown }).error);
              const outcome: BulkSimulationResult["outcome"] = failed
                ? "would-fail"
                : skipped
                  ? "would-skip"
                  : "would-accept";
              results.push({
                id,
                ok: res.ok,
                dryRun: true,
                decision: "accept",
                quality,
                reason: (data as { reason?: string }).reason ?? ((execution as { reason?: string } | undefined)?.reason) ?? null,
                outcome,
              });
            } catch (err) {
              results.push({
                id,
                ok: false,
                dryRun: true,
                outcome: "error",
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }));
          results.sort((a, b) => a.id - b.id);
          return { summary: summarizeBulkSimulation(results, config), payload: { results } as unknown as JsonObject };
        });
      },
    });

    api.registerTool({
      name: "lattice.get_theme_brief",
      label: "Lattice theme brief",
      description: "Return a concise theme brief for a canonical theme.",
      parameters: Type.Object({
        theme: Type.Optional(Type.String({ description: "Canonical theme slug. Defaults to plugin config defaultTheme." })),
      }),
      async execute(_toolCallId, args: { theme?: string }) {
        const config = readConfig(api);
        const theme = args?.theme || config.defaultTheme;
        return runTool("lattice.get_theme_brief", async () => {
          const data = await fetchJson(buildUrl(config.latticeApiBaseUrl, `/api/theme-brief/${encodeURIComponent(theme)}`), config.timeoutMs);
          return { summary: summarizeThemeBrief(data, config), payload: { theme, data } };
        });
      },
    });

    api.registerTool({
      name: "lattice.get_approval_queue",
      label: "Lattice approval queue",
      description: "Return approval queue counts and top pending items.",
      parameters: Type.Object({
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 5 })),
      }),
      async execute(_toolCallId, args: { limit?: number }) {
        const config = readConfig(api);
        const limit = Math.min(10, Math.max(1, Number(args?.limit ?? 5)));
        return runTool("lattice.get_approval_queue", async () => {
          const data = await fetchJson(buildUrl(config.latticeApiBaseUrl, "/api/approval-queue"), config.timeoutMs);
          return {
            summary: summarizeApprovalQueue(data, config, limit),
            payload: {
              limit,
              approvals: asArray<JsonObject>((data as { approvals?: unknown }).approvals).slice(0, limit),
            },
          };
        });
      },
    });

    api.registerTool({
      name: "lattice.get_discovery_triage",
      label: "Lattice discovery triage",
      description: "Return the hottest discovery triage topics.",
      parameters: Type.Object({
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 5 })),
      }),
      async execute(_toolCallId, args: { limit?: number }) {
        const config = readConfig(api);
        const limit = Math.min(10, Math.max(1, Number(args?.limit ?? 5)));
        return runTool("lattice.get_discovery_triage", async () => {
          const data = await fetchJson(buildUrl(config.latticeApiBaseUrl, "/api/discovery-triage"), config.timeoutMs);
          const source = (data as { topics?: unknown; items?: unknown });
          return {
            summary: summarizeDiscoveryTriage(data, config, limit),
            payload: {
              limit,
              items: asArray<JsonObject>(source.topics || source.items).slice(0, limit),
            },
          };
        });
      },
    });

    api.registerTool({
      name: "lattice.get_data_freshness_audit",
      label: "Lattice data freshness audit",
      description: "Return the latest data freshness and NAS audit summary.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params) {
        const config = readConfig(api);
        return runTool("lattice.get_data_freshness_audit", async () => {
          const data = await fetchJson(buildUrl(config.latticeApiBaseUrl, "/api/data-freshness-audit"), config.timeoutMs);
          return { summary: summarizeFreshnessAudit(data, config), payload: data };
        });
      },
    });

    api.registerTool({
      name: "lattice.get_live_status",
      label: "Lattice live status",
      description: "Return the hottest live themes and current stale state.",
      parameters: Type.Object({
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 6 })),
      }),
      async execute(_toolCallId, args: { limit?: number }) {
        const config = readConfig(api);
        const limit = Math.min(10, Math.max(1, Number(args?.limit ?? 6)));
        return runTool("lattice.get_live_status", async () => {
          const data = await fetchJson(buildUrl(config.latticeApiBaseUrl, "/api/live-status"), config.timeoutMs);
          return {
            summary: summarizeLiveStatus(data, config, limit),
            payload: {
              limit,
              liveStatus: data,
            },
          };
        });
      },
    });

    api.registerTool({
      name: "lattice.get_runtime_observability",
      label: "Lattice runtime observability",
      description: "Return read-only runtime observability from the local Lattice sidecar when configured.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params) {
        const config = readConfig(api);
        return runTool("lattice.get_runtime_observability", async () => {
          if (!config.sidecarBaseUrl) {
            return {
              summary: "Runtime observability: sidecarBaseUrl not configured",
              payload: { sidecarConfigured: false },
            };
          }
          const data = await fetchJson(buildUrl(config.sidecarBaseUrl, "/api/local-runtime-observability"), config.timeoutMs, buildSidecarHeaders(config));
          return { summary: summarizeRuntimeObservabilitySidecar(data), payload: data };
        });
      },
    });

    api.registerTool({
      name: "lattice.get_automation_ops_snapshot",
      label: "Lattice automation ops snapshot",
      description: "Return read-only automation ops state from the local Lattice sidecar when configured.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params) {
        const config = readConfig(api);
        return runTool("lattice.get_automation_ops_snapshot", async () => {
          if (!config.sidecarBaseUrl) {
            return {
              summary: "Automation ops snapshot: sidecarBaseUrl not configured",
              payload: { sidecarConfigured: false },
            };
          }
          const data = await fetchJson(buildUrl(config.sidecarBaseUrl, "/api/local-automation-ops-snapshot"), config.timeoutMs, buildSidecarHeaders(config));
          return { summary: summarizeAutomationOpsSidecar(data), payload: data };
        });
      },
    });

    api.registerTool({
      name: "lattice.simulate_approval",
      label: "Lattice simulate approval",
      description: "Dry-run an approval accept decision without changing final queue state.",
      parameters: Type.Object({
        id: Type.Integer({ minimum: 1, description: "Approval queue item id." }),
        reviewer: Type.Optional(Type.String({ description: "Reviewer label recorded by the API." })),
        reason: Type.Optional(Type.String({ description: "Optional human-readable reason for the dry run." })),
      }),
      async execute(_toolCallId, args: { id: number; reviewer?: string; reason?: string }) {
        const config = readConfig(api);
        return runTool("lattice.simulate_approval", async () => {
          const data = await postJson(
            buildUrl(config.latticeApiBaseUrl, `/api/approval-queue/${encodeURIComponent(String(args.id))}/review`),
            config.timeoutMs,
            {
              decision: "accept",
              dryRun: true,
              ...(args.reviewer ? { reviewer: args.reviewer } : {}),
              ...(args.reason ? { reason: args.reason } : {}),
            },
          );
          return { summary: summarizeApprovalReview(data, config), payload: data };
        });
      },
    });

    api.registerTool({
      name: "lattice.review_approval",
      label: "Lattice review approval",
      description: "Execute a guarded approval review action against the approval queue.",
      parameters: Type.Object({
        id: Type.Integer({ minimum: 1, description: "Approval queue item id." }),
        decision: Type.Union([
          Type.Literal("accept"),
          Type.Literal("reject"),
        ], { description: "Approval action to execute." }),
        reviewer: Type.Optional(Type.String({ description: "Reviewer label recorded by the API." })),
        reason: Type.Optional(Type.String({ description: "Optional human-readable reason for the decision." })),
      }),
      async execute(_toolCallId, args: { id: number; decision: "accept" | "reject"; reviewer?: string; reason?: string }) {
        const config = readConfig(api);
        return runTool("lattice.review_approval", async () => {
          const data = await postJson(
            buildUrl(config.latticeApiBaseUrl, `/api/approval-queue/${encodeURIComponent(String(args.id))}/review`),
            config.timeoutMs,
            {
              decision: args.decision,
              ...(args.reviewer ? { reviewer: args.reviewer } : {}),
              ...(args.reason ? { reason: args.reason } : {}),
            },
          );
          return { summary: summarizeApprovalReview(data, config), payload: data };
        });
      },
    });

    api.registerTool({
      name: "lattice.review_discovery_topic",
      label: "Lattice review discovery topic",
      description: "Apply a guarded discovery-triage decision to a topic.",
      parameters: Type.Object({
        topicId: Type.String({ minLength: 1, description: "Discovery topic id." }),
        decision: Type.Union([
          Type.Literal("canonical"),
          Type.Literal("watch"),
          Type.Literal("suppressed"),
        ], { description: "Promotion decision to apply." }),
        reviewer: Type.Optional(Type.String({ description: "Reviewer label recorded by the API." })),
        reason: Type.Optional(Type.String({ description: "Optional human-readable reason for the decision." })),
        normalizedTheme: Type.Optional(Type.String({ description: "Optional normalized theme override." })),
        normalizedParentTheme: Type.Optional(Type.String({ description: "Optional normalized parent-theme override." })),
        normalizedCategory: Type.Optional(Type.String({ description: "Optional normalized category override." })),
      }),
      async execute(_toolCallId, args: {
        topicId: string;
        decision: "canonical" | "watch" | "suppressed";
        reviewer?: string;
        reason?: string;
        normalizedTheme?: string;
        normalizedParentTheme?: string;
        normalizedCategory?: string;
      }) {
        const config = readConfig(api);
        return runTool("lattice.review_discovery_topic", async () => {
          const data = await postJson(
            buildUrl(config.latticeApiBaseUrl, "/api/discovery-triage/review"),
            config.timeoutMs,
            {
              topicId: args.topicId,
              decision: args.decision,
              ...(args.reviewer ? { reviewer: args.reviewer } : {}),
              ...(args.reason ? { reason: args.reason } : {}),
              ...(args.normalizedTheme ? { normalizedTheme: args.normalizedTheme } : {}),
              ...(args.normalizedParentTheme ? { normalizedParentTheme: args.normalizedParentTheme } : {}),
              ...(args.normalizedCategory ? { normalizedCategory: args.normalizedCategory } : {}),
            },
          );
          return { summary: summarizeDiscoveryReview(data, config), payload: data };
        });
      },
    });
  },
});
