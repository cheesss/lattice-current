export type OpenClawWebhookConfig = {
  enabled: boolean;
  mode: 'raw' | 'taskflow';
  urls: string[];
  secret: string;
  notifyPolicy: string;
  logPath: string;
  uiBaseUrl: string;
  timeoutMs: number;
  runTask: boolean;
  taskRuntime: string;
  childSessionKey: string;
  dispatchAgent: boolean;
  dispatchEventTypes: string[];
  dispatchSkipEventTypes: string[];
  dispatchAgentId: string;
  dispatchTimeoutSeconds: number;
  dispatchNodePath: string;
  dispatchCliEntry: string;
  dispatchArtifactDir: string;
  configPath: string;
};

export type OpenClawEvent = {
  eventId: string;
  eventType: string;
  createdAt: string;
  source: string;
  severity: string;
  theme: string | null;
  entityType: string;
  entityId: string;
  surface: string;
  summary: string;
  deepLink: string;
  payload: Record<string, unknown>;
};

export function loadOpenClawWebhookConfig(options?: Record<string, unknown>): Promise<OpenClawWebhookConfig>;
export function buildOpenClawDeepLink(surface?: string, options?: Record<string, unknown>): string;
export function createOpenClawEvent(input?: Record<string, unknown>, options?: Record<string, unknown>): OpenClawEvent;
export function formatOpenClawWebhookRequest(event: OpenClawEvent, config?: Partial<OpenClawWebhookConfig>): Record<string, unknown>;
export function formatOpenClawTaskInstruction(event: OpenClawEvent): string;
export function emitOpenClawEvent(event: OpenClawEvent, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
export function emitOpenClawEvents(events: OpenClawEvent[], options?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
