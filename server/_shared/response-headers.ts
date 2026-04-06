/**
 * Side-channel for handlers to attach response headers without modifying codegen.
 *
 * Handlers set headers via setResponseHeader(ctx.request, key, value).
 * The gateway reads and applies them after the handler returns.
 * WeakMap ensures automatic cleanup when the Request is GC'd.
 */

const channel = new WeakMap<object, Record<string, string>>();

function isWeakMapKey(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

export function setResponseHeader(req: Request | object | null | undefined, key: string, value: string): void {
  if (!isWeakMapKey(req)) return;
  let headers = channel.get(req);
  if (!headers) {
    headers = {};
    channel.set(req, headers);
  }
  headers[key] = value;
}

export function markNoCacheResponse(req: Request | object | null | undefined): void {
  setResponseHeader(req, 'X-No-Cache', '1');
}

export function drainResponseHeaders(req: Request | object | null | undefined): Record<string, string> | undefined {
  if (!isWeakMapKey(req)) return undefined;
  const headers = channel.get(req);
  if (headers) channel.delete(req);
  return headers;
}
