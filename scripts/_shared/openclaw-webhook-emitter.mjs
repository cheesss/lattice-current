import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';

/**
 * Verify an inbound webhook signature header against the raw request body.
 *
 * Header format (matches what postOpenClawWebhook emits):
 *   x-lattice-signature: t=<unix_seconds>,v1=<hex_hmac_sha256>
 *
 * Usage in a receiver:
 *   const ok = verifyLatticeWebhookSignature({
 *     header: req.headers['x-lattice-signature'],
 *     body: rawBodyString,
 *     secret: process.env.OPENCLAW_WEBHOOK_SIGNING_SECRET || process.env.OPENCLAW_WEBHOOK_SECRET,
 *     toleranceSeconds: 300,
 *   });
 *   if (!ok) return res.writeHead(401).end();
 *
 * Returns true only if (a) header is well-formed, (b) timestamp is within
 * tolerance, and (c) HMAC matches in constant time. Never throws.
 */
export function verifyLatticeWebhookSignature({ header, body, secret, toleranceSeconds = 300 } = {}) {
  if (!header || !secret || typeof body !== 'string') return false;
  const parts = String(header).split(',').reduce((acc, kv) => {
    const idx = kv.indexOf('=');
    if (idx > 0) acc[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
    return acc;
  }, {});
  const ts = Number(parts.t);
  const sig = parts.v1;
  if (!Number.isFinite(ts) || !sig) return false;
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false;
  const expected = createHmac('sha256', String(secret)).update(`${ts}.${body}`).digest('hex');
  if (expected.length !== sig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(sig, 'utf8'));
  } catch {
    return false;
  }
}
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const DEFAULT_CONFIG_PATH = path.resolve('data', 'openclaw-webhook.json');
const DEFAULT_LOG_PATH = path.resolve('data', 'openclaw-webhook-events.jsonl');
const DEFAULT_UI_BASE_URL = 'http://localhost:3000';
const DEFAULT_NOTIFY_POLICY = 'done_only';
const DEFAULT_TIMEOUT_MS = 10_000;
const TASKFLOW_GOAL_PAYLOAD_LIMIT = 1_200;
const DEFAULT_TASK_RUNTIME = 'acp';
const DEFAULT_AGENT_DISPATCH_LOG_DIR = path.resolve('data', 'openclaw-agent-runs');
const DEFAULT_OPENCLAW_NODE_PATH = process.execPath;
const DEFAULT_OPENCLAW_CLI_ENTRY = path.resolve(
  process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
  'npm',
  'node_modules',
  'openclaw',
  'dist',
  'index.js',
);
const DISPATCH_HELPER_PATH = fileURLToPath(new URL('./openclaw-agent-dispatch.mjs', import.meta.url));

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function compact(array) {
  return array.filter(Boolean);
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }
  return compact(String(value || '').split(',').map((item) => normalizeString(item)));
}

function dedupeStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function truncate(value, maxChars) {
  if (!value || value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

async function readJsonFile(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function loadOpenClawWebhookConfig(options = {}) {
  const configPath = path.resolve(
    normalizeString(options.configPath || process.env.OPENCLAW_WEBHOOK_CONFIG_PATH) || DEFAULT_CONFIG_PATH,
  );
  const fileConfig = await readJsonFile(configPath);
  const explicitUrls = Array.isArray(options.urls) ? options.urls : [];
  const envUrls = compact(String(process.env.OPENCLAW_WEBHOOK_URLS || '').split(','));
  const urls = dedupeStrings([
    normalizeString(options.url),
    normalizeString(process.env.OPENCLAW_WEBHOOK_URL),
    ...explicitUrls,
    ...envUrls,
    ...(Array.isArray(fileConfig?.urls) ? fileConfig.urls.map((value) => normalizeString(value)) : []),
    normalizeString(fileConfig?.url),
  ]);
  const mode = normalizeString(
    options.mode || process.env.OPENCLAW_WEBHOOK_MODE || fileConfig?.mode || 'raw',
  ).toLowerCase();
  const enabled = options.enabled != null
    ? Boolean(options.enabled)
    : fileConfig?.enabled != null
      ? Boolean(fileConfig.enabled)
      : urls.length > 0;

  return {
    enabled,
    mode: mode === 'taskflow' ? 'taskflow' : 'raw',
    urls,
    secret: normalizeString(
      options.secret
      || process.env.OPENCLAW_WEBHOOK_SECRET
      || process.env.OPENCLAW_WEBHOOK_BEARER_TOKEN
      || fileConfig?.secret,
    ),
    notifyPolicy: normalizeString(
      options.notifyPolicy
      || process.env.OPENCLAW_WEBHOOK_NOTIFY_POLICY
      || fileConfig?.notifyPolicy
      || DEFAULT_NOTIFY_POLICY,
    ) || DEFAULT_NOTIFY_POLICY,
    logPath: path.resolve(normalizeString(options.logPath || fileConfig?.logPath) || DEFAULT_LOG_PATH),
    uiBaseUrl: normalizeString(
      options.uiBaseUrl
      || process.env.LATTICE_UI_BASE_URL
      || process.env.OPENCLAW_LATTICE_UI_BASE_URL
      || fileConfig?.uiBaseUrl
      || DEFAULT_UI_BASE_URL,
    ) || DEFAULT_UI_BASE_URL,
    timeoutMs: Math.max(
      1_000,
      Number(options.timeoutMs || process.env.OPENCLAW_WEBHOOK_TIMEOUT_MS || fileConfig?.timeoutMs || DEFAULT_TIMEOUT_MS),
    ),
    runTask: normalizeBoolean(
      options.runTask ?? process.env.OPENCLAW_WEBHOOK_RUN_TASK ?? fileConfig?.runTask,
      mode === 'taskflow',
    ),
    taskRuntime: normalizeString(
      options.taskRuntime || process.env.OPENCLAW_WEBHOOK_TASK_RUNTIME || fileConfig?.taskRuntime || DEFAULT_TASK_RUNTIME,
    ) || DEFAULT_TASK_RUNTIME,
    childSessionKey: normalizeString(
      options.childSessionKey || process.env.OPENCLAW_WEBHOOK_CHILD_SESSION_KEY || fileConfig?.childSessionKey,
    ),
    dispatchAgent: normalizeBoolean(
      options.dispatchAgent ?? process.env.OPENCLAW_WEBHOOK_DISPATCH_AGENT ?? fileConfig?.dispatchAgent,
      false,
    ),
    dispatchEventTypes: normalizeStringList(
      options.dispatchEventTypes
      || process.env.OPENCLAW_WEBHOOK_DISPATCH_EVENT_TYPES
      || fileConfig?.dispatchEventTypes,
    ),
    dispatchSkipEventTypes: normalizeStringList(
      options.dispatchSkipEventTypes
      || process.env.OPENCLAW_WEBHOOK_DISPATCH_SKIP_EVENT_TYPES
      || fileConfig?.dispatchSkipEventTypes,
    ),
    dispatchAgentId: normalizeString(
      options.dispatchAgentId || process.env.OPENCLAW_WEBHOOK_DISPATCH_AGENT_ID || fileConfig?.dispatchAgentId || 'main',
    ) || 'main',
    dispatchTimeoutSeconds: Math.max(
      30,
      Number(
        options.dispatchTimeoutSeconds
        || process.env.OPENCLAW_WEBHOOK_DISPATCH_TIMEOUT_SECONDS
        || fileConfig?.dispatchTimeoutSeconds
        || 600,
      ),
    ),
    dispatchNodePath: normalizeString(
      options.dispatchNodePath
      || process.env.OPENCLAW_WEBHOOK_DISPATCH_NODE_PATH
      || fileConfig?.dispatchNodePath
      || DEFAULT_OPENCLAW_NODE_PATH,
    ) || DEFAULT_OPENCLAW_NODE_PATH,
    dispatchCliEntry: normalizeString(
      options.dispatchCliEntry
      || process.env.OPENCLAW_WEBHOOK_DISPATCH_CLI_ENTRY
      || fileConfig?.dispatchCliEntry
      || DEFAULT_OPENCLAW_CLI_ENTRY,
    ) || DEFAULT_OPENCLAW_CLI_ENTRY,
    dispatchArtifactDir: path.resolve(
      normalizeString(
        options.dispatchArtifactDir
        || process.env.OPENCLAW_WEBHOOK_DISPATCH_ARTIFACT_DIR
        || fileConfig?.dispatchArtifactDir
        || DEFAULT_AGENT_DISPATCH_LOG_DIR,
      ) || DEFAULT_AGENT_DISPATCH_LOG_DIR,
    ),
    configPath,
  };
}

export function buildOpenClawDeepLink(surface = 'home', options = {}) {
  const baseUrl = normalizeString(options.uiBaseUrl || process.env.LATTICE_UI_BASE_URL || DEFAULT_UI_BASE_URL) || DEFAULT_UI_BASE_URL;
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const hash = normalizeString(surface).replace(/^#/, '');
  return hash ? `${cleanBase}/event-dashboard.html#${hash}` : `${cleanBase}/event-dashboard.html`;
}

export function createOpenClawEvent(input = {}, options = {}) {
  const uiBaseUrl = normalizeString(options.uiBaseUrl || input.uiBaseUrl || process.env.LATTICE_UI_BASE_URL || DEFAULT_UI_BASE_URL) || DEFAULT_UI_BASE_URL;
  const eventType = normalizeString(input.eventType) || 'lattice-event';
  const surface = normalizeString(input.surface || 'ops');
  return {
    eventId: normalizeString(input.eventId) || `evt-${Date.now()}-${randomUUID()}`,
    eventType,
    createdAt: normalizeString(input.createdAt) || nowIso(),
    source: normalizeString(input.source) || 'lattice-current',
    severity: normalizeString(input.severity) || 'info',
    theme: normalizeString(input.theme) || null,
    entityType: normalizeString(input.entityType) || 'event',
    entityId: normalizeString(input.entityId) || eventType,
    surface,
    summary: normalizeString(input.summary) || eventType,
    deepLink: normalizeString(input.deepLink) || buildOpenClawDeepLink(surface, { uiBaseUrl }),
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
  };
}

function formatTaskFlowGoal(event) {
  const payloadText = truncate(JSON.stringify(event.payload || {}), TASKFLOW_GOAL_PAYLOAD_LIMIT);
  return compact([
    `[${String(event.severity || 'info').toUpperCase()}] ${event.eventType}`,
    event.summary,
    event.theme ? `테마: ${event.theme}` : '',
    `대상: ${event.entityType}/${event.entityId}`,
    event.deepLink ? `링크: ${event.deepLink}` : '',
    payloadText ? `페이로드: ${payloadText}` : '',
  ]).join('\n');
}

export function formatOpenClawWebhookRequest(event, config = {}) {
  if (config.mode === 'taskflow') {
    return {
      action: 'create_flow',
      goal: formatTaskFlowGoal(event),
      status: 'queued',
      notifyPolicy: config.notifyPolicy || DEFAULT_NOTIFY_POLICY,
    };
  }
  return event;
}

export function formatOpenClawTaskInstruction(event) {
  const base = compact([
    `Lattice 이벤트 ${event.eventType}를 처리하세요.`,
    `요약: ${event.summary}.`,
    event.theme ? `테마: ${event.theme}.` : '',
    event.deepLink ? `링크: ${event.deepLink}.` : '',
    '한국어로만 답하고, Hindi/Hinglish/캐주얼 영어를 섞지 마세요.',
  ]);

  const byType = {
    'source-probe-failed': [
      '실패한 소스 후보를 확인하고 현재 probe가 왜 거절했는지 설명하세요.',
      '먼저 읽기 전용 Lattice 도구만 사용하고, 다음 안전한 운영 조치만 추천하세요.',
      '쓰기 도구를 자동 실행하지 마세요.',
    ],
    'approval-created': [
      '승인 큐 항목을 확인하고 바로 실행 가능한지, 수정필요인지 요약하세요.',
      '후보 검증이 필요하면 simulate-only 동작만 사용하세요.',
      '최종 수락을 자동 실행하지 마세요.',
    ],
    'source-repaired': [
      '수리 결과, 이제 통과 가능한 이유, 남은 운영 리스크를 요약하세요.',
    ],
    'source-registered': [
      '새로 등록된 소스와 운영자가 다음에 확인해야 할 검증 항목을 요약하세요.',
    ],
    'source-rejected': [
      '소스가 거절된 이유와 다른 소스 유형 또는 모니터가 더 적합한지 요약하세요.',
    ],
    'scheduler-cycle-failed': [
      '시스템 상태를 확인하고 예상 영향, 영향 범위, 가장 안전한 복구 단계를 요약하세요.',
      '런타임 상태를 자동으로 변경하지 마세요.',
    ],
    'scheduler-cycle-completed': [
      '완료된 사이클을 짧게 요약하고 stale 또는 지연된 후속 확인 항목을 강조하세요.',
    ],
    'brief-ready': [
      '사용 가능한 Lattice 읽기 도구로 간결한 운영 브리프를 작성하세요.',
      '무엇이 바뀌었는지, 왜 중요한지, 지금 무엇을 검토해야 하는지를 우선하세요.',
    ],
  };

  const specific = byType[event.eventType] || [
    '이벤트를 확인하고 영향과 다음 안전한 운영 조치를 요약하세요.',
  ];
  return compact([...base, ...specific]).join(' ');
}

export function formatOpenClawRunTaskRequest(event, config = {}, flowId) {
  return {
    action: 'run_task',
    flowId,
    runtime: normalizeString(config.taskRuntime) || DEFAULT_TASK_RUNTIME,
    task: formatOpenClawTaskInstruction(event),
    ...(config.childSessionKey ? { childSessionKey: config.childSessionKey } : {}),
    ...(config.notifyPolicy ? { notifyPolicy: config.notifyPolicy } : {}),
    label: `lattice:${event.eventType}`,
  };
}

export function formatOpenClawAgentDispatchRequest(event, config = {}) {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    summary: event.summary,
    deepLink: event.deepLink,
    instruction: formatOpenClawTaskInstruction(event),
    agentId: normalizeString(config.dispatchAgentId) || 'main',
    timeoutSeconds: Math.max(30, Number(config.dispatchTimeoutSeconds) || 600),
    nodePath: normalizeString(config.dispatchNodePath) || DEFAULT_OPENCLAW_NODE_PATH,
    cliEntry: normalizeString(config.dispatchCliEntry) || DEFAULT_OPENCLAW_CLI_ENTRY,
    artifactDir: path.resolve(normalizeString(config.dispatchArtifactDir) || DEFAULT_AGENT_DISPATCH_LOG_DIR),
    event,
  };
}

async function writeEventLog(event, logPath) {
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(event)}\n`, 'utf8');
}

function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function extractFlowId(responseJson) {
  if (!responseJson || typeof responseJson !== 'object') return '';
  if (normalizeString(responseJson.flowId)) return normalizeString(responseJson.flowId);
  if (responseJson.flow && typeof responseJson.flow === 'object' && normalizeString(responseJson.flow.flowId)) {
    return normalizeString(responseJson.flow.flowId);
  }
  if (responseJson.result && typeof responseJson.result === 'object') {
    if (normalizeString(responseJson.result.flowId)) return normalizeString(responseJson.result.flowId);
    if (responseJson.result.flow && typeof responseJson.result.flow === 'object' && normalizeString(responseJson.result.flow.flowId)) {
      return normalizeString(responseJson.result.flow.flowId);
    }
  }
  return '';
}

async function postOpenClawWebhook(url, body, config, event, stage) {
  try {
    const payload = JSON.stringify(body);
    const signingKey = config.signingSecret || config.secret;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signingKey
      ? createHmac('sha256', String(signingKey)).update(`${timestamp}.${payload}`).digest('hex')
      : null;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.secret ? { Authorization: `Bearer ${config.secret}` } : {}),
        ...(signature ? {
          'x-lattice-signature': `t=${timestamp},v1=${signature}`,
          'x-lattice-signature-timestamp': timestamp,
        } : {}),
        'x-lattice-event-type': event.eventType,
        'x-lattice-event-id': event.eventId,
      },
      body: payload,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const text = await response.text().catch(() => '');
    return {
      stage,
      url,
      ok: response.ok,
      status: response.status,
      body: text,
      json: safeJsonParse(text),
    };
  } catch (error) {
    return {
      stage,
      url,
      ok: false,
      error: String(error?.message || error || 'openclaw webhook delivery failed'),
    };
  }
}

async function spawnOpenClawAgentDispatch(event, config) {
  if (!config.dispatchAgent) {
    return {
      enabled: false,
      queued: false,
      reason: 'agent dispatch disabled',
    };
  }
  const allowedTypes = new Set((config.dispatchEventTypes || []).map((type) => type.toLowerCase()));
  const skippedTypes = new Set((config.dispatchSkipEventTypes || []).map((type) => type.toLowerCase()));
  const eventType = String(event.eventType || '').toLowerCase();
  if (skippedTypes.has(eventType)) {
    return {
      enabled: true,
      queued: false,
      reason: `agent dispatch skipped for event type ${event.eventType}`,
    };
  }
  if (allowedTypes.size > 0 && !allowedTypes.has(eventType)) {
    return {
      enabled: true,
      queued: false,
      reason: `agent dispatch not allowlisted for event type ${event.eventType}`,
    };
  }

  const envelope = formatOpenClawAgentDispatchRequest(event, config);
  await mkdir(envelope.artifactDir, { recursive: true });
  const envelopePath = path.join(envelope.artifactDir, `${event.eventId}.request.json`);
  await writeFile(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');

  const child = spawn(
    envelope.nodePath,
    [DISPATCH_HELPER_PATH, envelopePath],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  child.unref();

  return {
    enabled: true,
    queued: true,
    pid: child.pid || null,
    envelopePath,
  };
}

export async function emitOpenClawEvent(input, options = {}) {
  const event = createOpenClawEvent(input, options);
  const config = await loadOpenClawWebhookConfig(options);
  await writeEventLog(event, config.logPath);

  const attempts = [];
  if (config.enabled && config.urls.length > 0) {
    const requestBody = formatOpenClawWebhookRequest(event, config);
    for (const url of config.urls) {
      // eslint-disable-next-line no-await-in-loop
      const createAttempt = await postOpenClawWebhook(url, requestBody, config, event, 'create_flow');
      attempts.push(createAttempt);

      if (
        config.mode === 'taskflow'
        && config.runTask
        && createAttempt.ok
      ) {
        const flowId = extractFlowId(createAttempt.json);
        if (!flowId) {
          attempts.push({
            stage: 'run_task',
            url,
            ok: false,
            error: 'create_flow response missing flowId',
          });
          continue;
        }
        const runTaskBody = formatOpenClawRunTaskRequest(event, config, flowId);
        // eslint-disable-next-line no-await-in-loop
        attempts.push(await postOpenClawWebhook(url, runTaskBody, config, event, 'run_task'));
      }
    }
  }

  const dispatch = await spawnOpenClawAgentDispatch(event, config);
  const webhookDelivered = attempts.some((attempt) => attempt.ok);
  const dispatched = Boolean(dispatch?.queued);

  return {
    ok: webhookDelivered || dispatched,
    delivered: webhookDelivered || dispatched,
    event,
    config,
    attempts,
    dispatch,
    reason: webhookDelivered || dispatched ? undefined : 'webhook disabled or not configured',
  };
}

export async function emitOpenClawEvents(events, options = {}) {
  const results = [];
  for (const event of events || []) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await emitOpenClawEvent(event, options));
  }
  return results;
}
