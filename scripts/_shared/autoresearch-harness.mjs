import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { stableResearchOsId } from './adjacency-graph.mjs';

function nowIso() {
  return new Date().toISOString();
}

export async function runAutoresearchHarnessRound(options = {}) {
  const name = options.name || 'research-os-round';
  const startedAt = Date.now();
  const budgetMs = Math.max(1, Number(options.budgetMs || options.budget?.wallClockMs || 60_000));
  const journalPath = options.journalPath || path.join(process.cwd(), 'data', 'automation', 'autoresearch-rounds.jsonl');
  const variantGenerator = options.variantGenerator || (async () => ({ variant: {}, rationale: 'noop' }));
  const execute = options.execute || (async (variant) => ({ ok: true, variant }));
  const metric = options.metric || (async () => ({}));
  const acceptanceGate = options.acceptanceGate || (() => true);
  const decision = options.decision || ((metrics) => acceptanceGate(metrics));
  const variant = await variantGenerator({ name, budgetMs });
  if (Date.now() - startedAt > budgetMs) {
    throw new Error(`[autoresearch-harness] budget exceeded before execution for ${name}`);
  }
  const result = await execute(variant);
  if (Date.now() - startedAt > budgetMs) {
    throw new Error(`[autoresearch-harness] budget exceeded during execution for ${name}`);
  }
  const metrics = await metric(result);
  const gateOk = Boolean(acceptanceGate(metrics, options.baseline || {}));
  const accepted = gateOk && Boolean(decision(metrics, options.baseline || {}));
  const entry = {
    id: stableResearchOsId([name, nowIso(), JSON.stringify(variant).slice(0, 200)]),
    name,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: nowIso(),
    budgetMs,
    elapsedMs: Date.now() - startedAt,
    variant,
    metrics,
    gateOk,
    accepted,
    baseline: options.baseline || {},
    livePollutionAllowed: false,
  };
  mkdirSync(path.dirname(journalPath), { recursive: true });
  appendFileSync(journalPath, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}
