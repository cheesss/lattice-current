import { canUseLocalAgentEndpoints } from './runtime';
import type { NetworkDiscoveryCapture } from './network-discovery';

export interface MultimodalExtractionTarget {
  url: string;
  topic?: string;
}

export interface MultimodalFinding {
  id: string;
  url: string;
  topic: string;
  summary: string;
  evidence: string[];
  networkCaptures?: NetworkDiscoveryCapture[];
  model: string;
  usedVision: boolean;
  capturedAt: string;
}

function makeId(url: string, topic: string): string {
  return `${new Date().toISOString()}::${topic}::${url}`.slice(0, 220);
}

export async function extractMultimodalFinding(
  target: MultimodalExtractionTarget,
): Promise<MultimodalFinding | null> {
  if (!canUseLocalAgentEndpoints()) return null;
  const url = String(target.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;

  try {
    const response = await fetch('/api/local-multimodal-extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        topic: String(target.topic || '').trim(),
        timeoutMs: 30_000,
      }),
      signal: AbortSignal.timeout(35_000),
    });
    if (!response.ok) return null;

    const payload = await response.json() as {
      success?: boolean;
      summary?: string;
      evidence?: string[];
      networkCaptures?: NetworkDiscoveryCapture[];
      model?: string;
      usedVision?: boolean;
      capturedAt?: string;
      topic?: string;
    };
    if (!payload.success || !payload.summary) return null;

    const topic = payload.topic || target.topic || 'multimodal-scan';
    return {
      id: makeId(url, topic),
      url,
      topic,
      summary: payload.summary,
      evidence: (payload.evidence || []).slice(0, 12),
      networkCaptures: (payload.networkCaptures || []).slice(0, 16),
      model: payload.model || 'playwright-dom',
      usedVision: Boolean(payload.usedVision),
      capturedAt: payload.capturedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function extractMultimodalFindingsBatch(
  targets: MultimodalExtractionTarget[],
  limit = 4,
): Promise<MultimodalFinding[]> {
  const out: MultimodalFinding[] = [];
  const slice = targets.slice(0, Math.max(1, limit));
  for (const target of slice) {
    const finding = await extractMultimodalFinding(target);
    if (finding) out.push(finding);
  }
  return out;
}
