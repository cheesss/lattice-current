import type {
  AssetRecommendation, HorizonReturnStat, RecommendationRationale,
  RecommendationsResponse, ThemeIntensityData, ThemeIntensityResponse,
  SankeyFlowData, ImpactTimelineResponse,
  ThemeOverlapResult, ScrubberSnapshot, ScenarioInput, ScenarioResult,
} from '@/types/intelligence-dashboard';

// Lightweight parameter shapes — no external module imports needed
interface ForwardReturn { symbol: string; horizonHours: number; returnPct: number; maxDrawdownPct?: number }
interface ReplayRun { themeId: string; avgReturnPct?: number | null; hitRate?: number | null }
interface TransmissionEdge { eventTitle: string; marketSymbol: string; strength: number; relationType: string; sourceToTargetTe?: number; leadLagScore?: number; flowLagHours?: number }
interface TransmissionSnapshot { edges: TransmissionEdge[]; regime?: { id: string; label: string; confidence: number } | null }
interface HawkesResult { themeId: string; themeLabel: string; lambda: number; normalized: number; excitationMass: number; fittedAlpha: number; fittedBetaHours: number }

type Dir5 = 'long' | 'short' | 'hedge' | 'watch' | 'pair';
interface IntelSnapshot {
  generatedAt: string;
  regime?: { id: string; label: string; confidence: number } | null;
  directMappings: Array<{ symbol: string; assetName: string; themeId: string; themeLabel: string; direction: Dir5; conviction: number; sensitivityScore: number; transferEntropy?: number; leadLagScore?: number; corroboration: number; confirmationState: string; eventIntensity: number; reasons: string[] }>;
  ideaCards: Array<{ id: string; title: string; themeId: string; direction: Dir5; conviction: number; calibratedConfidence: number; transferEntropy?: number; confirmationState: string; symbols: Array<{ symbol: string; name: string; role: string; direction: string }>; evidence: string[]; preferredHorizonHours?: number | null }>;
  topThemes: string[];
}
interface ReplayCheckpoint { timestamp: number; themeId: string; themeLabel: string; intensity: number; symbols: string[]; headlines: string[] }
interface Cluster { id: string; primaryTitle: string; themeId?: string; themeLabel?: string; sourceCount: number }

/* --- helpers (private) --- */

function toDir(d: string): 'long' | 'short' | 'hedge' {
  return d === 'short' ? 'short' : d === 'hedge' ? 'hedge' : 'long';
}

function groupBy<T>(items: T[], key: (i: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const i of items) { const k = key(i); const a = m.get(k); a ? a.push(i) : m.set(k, [i]); }
  return m;
}

function rd(n: number, d = 4): number { const f = 10 ** d; return Math.round(n * f) / f; }

function confLevel(n: number): 'high' | 'medium' | 'low' { return n >= 10 ? 'high' : n >= 4 ? 'medium' : 'low'; }

function horizonStats(returns: ForwardReturn[], symbol: string): HorizonReturnStat[] {
  const byH = groupBy(returns.filter((r) => r.symbol === symbol), (r) => String(r.horizonHours));
  const out: HorizonReturnStat[] = [];
  for (const [h, items] of byH) {
    const pcts = items.map((i) => i.returnPct);
    const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
    const dds = items.map((i) => i.maxDrawdownPct ?? Math.min(0, i.returnPct));
    out.push({ horizonHours: Number(h), avgReturnPct: rd(avg), bestReturnPct: rd(Math.max(...pcts)), worstReturnPct: rd(Math.min(...pcts)), maxDrawdownPct: rd(Math.min(...dds)), winRate: rd(pcts.filter((p) => p > 0).length / pcts.length), sampleCount: pcts.length, confidenceLevel: confLevel(pcts.length) });
  }
  return out.sort((a, b) => a.horizonHours - b.horizonHours);
}

function bestHorizon(stats: HorizonReturnStat[]): number {
  if (!stats.length) return 48;
  let best = stats[0]!, bs = -Infinity;
  for (const s of stats) { const sp = s.bestReturnPct - s.worstReturnPct; const ra = sp > 0 ? s.avgReturnPct / sp : s.avgReturnPct; if (ra > bs) { bs = ra; best = s; } }
  return best.horizonHours;
}

/* --- 1. buildRecommendations --- */

export function buildRecommendations(snapshot: IntelSnapshot, _replayRuns: ReplayRun[], forwardReturns: ForwardReturn[]): RecommendationsResponse {
  const sm = new Map<string, { name: string; themeId: string; themeLabel: string; dir: 'long' | 'short' | 'hedge'; conv: number; te: number; lag: number; corr: number; cs: string; hl: string[]; ts: number }>();

  for (const m of snapshot.directMappings) {
    const ex = sm.get(m.symbol);
    if (!ex || m.conviction > ex.conv)
      sm.set(m.symbol, { name: m.assetName, themeId: m.themeId, themeLabel: m.themeLabel, dir: toDir(m.direction), conv: m.conviction, te: m.transferEntropy ?? 0, lag: m.leadLagScore ?? 0, corr: m.corroboration, cs: m.confirmationState, hl: m.reasons.slice(0, 3), ts: m.sensitivityScore });
  }
  for (const card of snapshot.ideaCards) {
    for (const sym of card.symbols) {
      if (!sm.has(sym.symbol))
        sm.set(sym.symbol, { name: sym.name, themeId: card.themeId, themeLabel: card.title, dir: toDir(card.direction), conv: card.conviction, te: card.transferEntropy ?? 0, lag: 0, corr: 1, cs: card.confirmationState, hl: card.evidence.slice(0, 3), ts: card.calibratedConfidence * 100 });
    }
  }

  const recs: AssetRecommendation[] = [];
  for (const [symbol, i] of sm) {
    const hr = horizonStats(forwardReturns, symbol);
    const regCtx = snapshot.regime ? `${snapshot.regime.label} (conf ${snapshot.regime.confidence})` : 'unknown';
    const rat: RecommendationRationale = { newsCount24h: i.hl.length, topHeadlines: i.hl, transmissionStrength: rd(i.ts), transferEntropy: rd(i.te), leadLagHours: rd(i.lag), regimeContext: regCtx, corroborationSources: i.corr, confirmationState: i.cs };
    recs.push({ symbol, name: i.name, direction: i.dir, themeId: i.themeId, themeLabel: i.themeLabel, score: rd(i.conv, 2), optimalHorizonHours: bestHorizon(hr), horizonReturns: hr, rationale: rat });
  }
  recs.sort((a, b) => b.score - a.score);

  const syms = recs.map((r) => r.symbol);
  return { recommendations: recs, correlationMatrix: { symbols: syms, correlations: syms.map(() => syms.map(() => 0)) }, regime: snapshot.regime ? { id: snapshot.regime.id, confidence: snapshot.regime.confidence } : null };
}

/* --- 2. buildThemeIntensityData --- */

export function buildThemeIntensityData(_snapshot: IntelSnapshot, transmission: TransmissionSnapshot, hawkesResults: HawkesResult[]): ThemeIntensityResponse {
  const now = Date.now();
  const themes: ThemeIntensityData[] = hawkesResults.map((h) => {
    const ts: ThemeIntensityData['intensityTimeSeries'] = [];
    for (let i = 23; i >= 0; i--) ts.push({ timestamp: new Date(now - i * 3_600_000).toISOString(), intensity: rd(h.normalized * Math.exp(-i / Math.max(1, h.fittedBetaHours))) });
    const pd: ThemeIntensityData['predictedDecay'] = [];
    for (let hr = 1; hr <= 48; hr += 3) pd.push({ hoursFromNow: hr, intensity: rd(h.normalized * Math.exp(-hr / Math.max(1, h.fittedBetaHours))), uncertainty: rd(0.05 + hr * 0.008) });
    return { themeId: h.themeId, themeLabel: h.themeLabel, currentIntensity: h.normalized, fittedBetaHours: h.fittedBetaHours, excitationMass: h.excitationMass, alpha: h.fittedAlpha, intensityTimeSeries: ts, predictedDecay: pd };
  });

  // Sankey from transmission edges
  const evtSet = new Map<string, string>();
  const thmSet = new Map<string, string>();
  const astSet = new Map<string, { label: string; returnPct: number }>();
  const links: SankeyFlowData['links'] = [];
  for (const e of transmission.edges.slice(0, 40)) {
    const eid = `evt-${e.eventTitle.slice(0, 30).replace(/\s+/g, '-')}`;
    evtSet.set(eid, e.eventTitle.slice(0, 60));
    const tid = `theme-${e.relationType}`;
    thmSet.set(tid, e.relationType);
    const aid = `asset-${e.marketSymbol}`;
    astSet.set(aid, { label: e.marketSymbol, returnPct: 0 });
    const s = rd(e.strength / 100, 3);
    links.push({ source: eid, target: tid, strength: s, direction: 'positive' }, { source: tid, target: aid, strength: s, direction: 'positive' });
  }
  const sankeyFlow: SankeyFlowData = {
    events: Array.from(evtSet, ([id, label]) => ({ id, label })),
    themes: Array.from(thmSet, ([id, label]) => ({ id, label })),
    assets: Array.from(astSet, ([id, v]) => ({ id, label: v.label, returnPct: v.returnPct })),
    links,
  };
  return { themes, sankeyFlow };
}

/* --- 3. buildImpactTimeline --- */

export function buildImpactTimeline(replayCheckpoints: ReplayCheckpoint[], _clusters: Cluster[], forwardReturns: ForwardReturn[]): ImpactTimelineResponse {
  const retsBySym = groupBy(forwardReturns, (r) => r.symbol);

  const events: ImpactTimelineResponse['events'] = replayCheckpoints.map((cp, idx) => {
    const ai: Record<string, Record<string, number>> = {};
    for (const sym of cp.symbols) {
      const byH: Record<string, number> = {};
      for (const r of retsBySym.get(sym) ?? []) byH[`${r.horizonHours}h`] = rd(r.returnPct, 2);
      ai[sym] = byH;
    }
    return { id: `evt-${idx}`, timestamp: cp.timestamp, title: cp.headlines[0] ?? cp.themeLabel, intensity: cp.intensity, sources: cp.headlines.slice(0, 3), themeIds: [cp.themeId], assetImpacts: ai };
  });
  events.sort((a, b) => a.timestamp - b.timestamp);

  // Detect theme overlaps within 24h windows
  const overlaps: ThemeOverlapResult[] = [];
  const winMs = 24 * 3_600_000;
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i]!, b = events[j]!;
      if (Math.abs(a.timestamp - b.timestamp) > winMs) continue;
      const allT = [...new Set([...a.themeIds, ...b.themeIds])];
      if (allT.length < 2) continue;
      const shared = Object.keys(a.assetImpacts).filter((s) => s in b.assetImpacts);
      const ce = shared.slice(0, 5).map((sym) => {
        const aV = Object.values(a.assetImpacts[sym]!), bV = Object.values(b.assetImpacts[sym]!);
        const aA = aV.length ? aV.reduce((x, y) => x + y, 0) / aV.length : 0;
        const bA = bV.length ? bV.reduce((x, y) => x + y, 0) / bV.length : 0;
        return { symbol: sym, avgReturnPct: rd((aA + bA) / 2, 2), singleThemeAvg: rd(Math.max(aA, bA), 2) };
      });
      overlaps.push({ themeIds: allT, overlapStart: Math.min(a.timestamp, b.timestamp), overlapEnd: Math.max(a.timestamp, b.timestamp), combinedEffect: ce });
    }
  }

  // Scrubber snapshots — sample up to 10 evenly-spaced events
  const scrubberSnapshots: ScrubberSnapshot[] = [];
  if (events.length > 0) {
    const step = Math.max(1, Math.floor(events.length / 10));
    for (let i = 0; i < events.length; i += step) {
      const e = events[i]!;
      scrubberSnapshots.push({
        timestamp: e.timestamp,
        topRecommendations: Object.keys(e.assetImpacts).slice(0, 5).map((s) => {
          const fr = forwardReturns.find((r) => r.symbol === s && r.horizonHours === 48);
          return { symbol: s, score: e.intensity, actual48hReturn: fr?.returnPct ?? null };
        }),
        themeIntensities: e.themeIds.map((t) => ({ themeId: t, intensity: e.intensity })),
      });
    }
  }
  return { events, overlaps, scrubberSnapshots };
}

/* --- 4. computeScenario --- */

export function computeScenario(scenarios: ScenarioInput[], hawkesParams: HawkesResult[], forwardReturns: ForwardReturn[]): ScenarioResult {
  const hMap = new Map(hawkesParams.map((h) => [h.themeId, h]));
  const cur: Record<string, Record<string, number>> = {};
  const scn: Record<string, Record<string, number>> = {};

  for (const input of scenarios) {
    const base = hMap.get(input.themeId)?.normalized ?? 0.5;
    const scale = base > 0 ? input.intensity / base : 1;
    const syms = [...new Set(forwardReturns.map((r) => r.symbol))].slice(0, 20);
    const c: Record<string, number> = {}, s: Record<string, number> = {};
    for (const sym of syms) {
      const sr = forwardReturns.filter((r) => r.symbol === sym);
      const avg = sr.length ? sr.reduce((a, b) => a + b.returnPct, 0) / sr.length : 0;
      c[sym] = rd(avg, 4); s[sym] = rd(avg * scale, 4);
    }
    cur[input.themeId] = c; scn[input.themeId] = s;
  }

  const avgB = hawkesParams.length ? hawkesParams.reduce((a, b) => a + b.fittedBetaHours, 0) / hawkesParams.length : 18;
  const iRatio = scenarios.length ? scenarios.reduce((a, s) => a + s.intensity, 0) / scenarios.length : 1;
  return { currentState: cur, scenarioState: scn, decayCurve: { currentBetaHours: rd(avgB, 2), scenarioBetaHours: rd(avgB * Math.max(0.5, Math.min(2, iRatio)), 2) } };
}

/* --- 5. computeCorrelationMatrix --- */

export function computeCorrelationMatrix(priceData: number[][], symbols: string[]): { symbols: string[]; correlations: number[][] } {
  const n = symbols.length;
  const corr: number[][] = Array.from({ length: n }, () => Array(n).fill(0) as number[]);
  for (let i = 0; i < n; i++) {
    corr[i]![i] = 1;
    for (let j = i + 1; j < n; j++) { const r = pearson(priceData[i] ?? [], priceData[j] ?? []); corr[i]![j] = r; corr[j]![i] = r; }
  }
  return { symbols, correlations: corr };
}

function pearson(xs: number[], ys: number[]): number {
  const len = Math.min(xs.length, ys.length);
  if (len < 3) return 0;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
  for (let i = 0; i < len; i++) { const x = xs[i]!, y = ys[i]!; sx += x; sy += y; sxy += x * y; sx2 += x * x; sy2 += y * y; }
  const d = Math.sqrt((len * sx2 - sx * sx) * (len * sy2 - sy * sy));
  return d === 0 ? 0 : rd((len * sxy - sx * sy) / d, 4);
}

/* --- 6. generateInsights --- */

export function generateInsights(correlations: number[][], symbols: string[]): string[] {
  const out: string[] = [];
  const n = symbols.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = correlations[i]?.[j] ?? 0, abs = Math.abs(r), a = symbols[i]!, b = symbols[j]!;
      if (abs >= 0.85) out.push(`${a}-${b} ${r > 0 ? 'positive' : 'negative'} correlation ${r.toFixed(2)} → low diversification benefit`);
      else if (abs <= 0.15) out.push(`${a}-${b} near-zero correlation ${r.toFixed(2)} → good diversification pair`);
      else if (r <= -0.5) out.push(`${a}-${b} inverse correlation ${r.toFixed(2)} → natural hedge opportunity`);
    }
  }
  return out.slice(0, 20);
}
