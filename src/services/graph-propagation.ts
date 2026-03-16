import type { KeywordGraphSnapshot } from './keyword-registry';
import type { EventMarketTransmissionSnapshot } from './event-market-transmission';

export interface GraphThemeInput {
  id: string;
  label: string;
  triggers: string[];
  sectors: string[];
  commodities: string[];
}

export interface GraphEventCandidateInput {
  id: string;
  title: string;
  text: string;
  region: string;
  reasons: string[];
  matchedSymbols: string[];
}

export interface GraphAssetInput {
  symbol: string;
  name: string;
  assetKind: 'etf' | 'equity' | 'commodity' | 'fx' | 'rate' | 'crypto';
  sector: string;
  commodity?: string;
  direction: 'long' | 'short' | 'hedge' | 'watch' | 'pair';
  role: 'primary' | 'confirm' | 'hedge';
  themeIds?: string[];
  aliases?: string[];
}

export interface GraphSupportAssessment {
  graphSignalScore: number;
  propagationPath: string[];
  notes: string[];
}

export interface HiddenCandidateDiscovery {
  id: string;
  themeId: string;
  themeLabel: string;
  region: string;
  symbol: string;
  assetName: string;
  assetKind: GraphAssetInput['assetKind'];
  sector: string;
  commodity: string | null;
  direction: GraphAssetInput['direction'];
  role: GraphAssetInput['role'];
  score: number;
  path: string[];
  reasons: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return Array.from(new Set(normalize(value).split(' ').filter((token) => token.length >= 3))).slice(0, 48);
}

function overlap(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  let total = 0;
  for (const token of left) {
    if (rightSet.has(token)) total += 1;
  }
  return total;
}

function graphTerms(snapshot: KeywordGraphSnapshot | null | undefined): string[] {
  const nodes = (snapshot?.nodes || []).slice(0, 48).map((node) => node.term);
  const edges = (snapshot?.edges || []).slice(0, 24).flatMap((edge) => [edge.source, edge.target, edge.relationType || '']);
  return tokenize([...nodes, ...edges].join(' '));
}

function transmissionTerms(snapshot: EventMarketTransmissionSnapshot | null | undefined, eventTitle: string): string[] {
  const rows = (snapshot?.edges || [])
    .filter((edge) => normalize(edge.eventTitle) === normalize(eventTitle))
    .slice(0, 12)
    .flatMap((edge) => [edge.marketSymbol, edge.marketName, edge.relationType, ...(edge.keywords || [])]);
  return tokenize(rows.join(' '));
}

function assetTokens(asset: GraphAssetInput): string[] {
  return tokenize([
    asset.symbol,
    asset.name,
    asset.sector,
    asset.commodity || '',
    ...(asset.aliases || []),
  ].join(' '));
}

export function assessGraphSupport(args: {
  theme: GraphThemeInput;
  event: GraphEventCandidateInput;
  asset: GraphAssetInput;
  keywordGraph?: KeywordGraphSnapshot | null;
  transmission?: EventMarketTransmissionSnapshot | null;
}): GraphSupportAssessment {
  const eventTokens = tokenize([args.event.title, args.event.text, ...(args.event.reasons || [])].join(' '));
  const themeTokens = tokenize([args.theme.label, ...args.theme.triggers, ...args.theme.sectors, ...args.theme.commodities].join(' '));
  const assetKeyTokens = assetTokens(args.asset);
  const graphKeyTokens = graphTerms(args.keywordGraph);
  const transmissionKeyTokens = transmissionTerms(args.transmission, args.event.title);
  const directOverlap = overlap(assetKeyTokens, [...eventTokens, ...themeTokens]);
  const graphOverlap = overlap(assetKeyTokens, graphKeyTokens);
  const transmissionOverlap = overlap(assetKeyTokens, transmissionKeyTokens);
  const sectorMatch = args.theme.sectors.some((sector) => normalize(sector) === normalize(args.asset.sector)) ? 1 : 0;
  const commodityMatch = args.asset.commodity && args.theme.commodities.some((commodity) => normalize(commodity) === normalize(args.asset.commodity || '')) ? 1 : 0;
  const matchedSymbolBridge = args.event.matchedSymbols.some((symbol) => normalize(symbol) === normalize(args.asset.symbol)) ? 1 : 0;
  const score = clamp(
    Math.round(
      28
      + directOverlap * 12
      + graphOverlap * 8
      + transmissionOverlap * 10
      + sectorMatch * 10
      + commodityMatch * 9
      + matchedSymbolBridge * 8,
    ),
    0,
    100,
  );

  const path = [
    args.event.title,
    args.theme.label,
    transmissionKeyTokens[0] || graphKeyTokens[0] || args.asset.sector,
    args.asset.symbol,
  ].filter(Boolean).slice(0, 4);

  return {
    graphSignalScore: score,
    propagationPath: path,
    notes: [
      directOverlap > 0 ? 'Asset aliases overlap the event or theme vocabulary.' : 'Direct lexical overlap is limited.',
      graphOverlap > 0 ? 'Keyword graph communities reinforce the asset path.' : 'Keyword graph support is light.',
      transmissionOverlap > 0 ? 'Transmission edges support a market bridge into the asset.' : 'Transmission edges are not yet strongly aligned.',
    ],
  };
}

export function discoverHiddenGraphCandidates(args: {
  themes: GraphThemeInput[];
  candidates: GraphEventCandidateInput[];
  assetCatalog: GraphAssetInput[];
  keywordGraph?: KeywordGraphSnapshot | null;
  transmission?: EventMarketTransmissionSnapshot | null;
  existingThemeSymbols?: Record<string, string[]>;
}): HiddenCandidateDiscovery[] {
  const discoveries = new Map<string, HiddenCandidateDiscovery>();
  for (const candidate of args.candidates) {
    for (const theme of args.themes) {
      const existingSymbols = new Set((args.existingThemeSymbols?.[theme.id] || []).map((symbol) => normalize(symbol)));
      for (const asset of args.assetCatalog.filter((row) => (row.themeIds || []).includes(theme.id))) {
        if (existingSymbols.has(normalize(asset.symbol))) continue;
        const support = assessGraphSupport({
          theme,
          event: candidate,
          asset,
          keywordGraph: args.keywordGraph,
          transmission: args.transmission,
        });
        if (support.graphSignalScore < 64) continue;
        const id = `${theme.id}:${candidate.region}:${asset.symbol}`.toLowerCase();
        const next: HiddenCandidateDiscovery = {
          id,
          themeId: theme.id,
          themeLabel: theme.label,
          region: candidate.region,
          symbol: asset.symbol,
          assetName: asset.name,
          assetKind: asset.assetKind,
          sector: asset.sector,
          commodity: asset.commodity || null,
          direction: asset.direction,
          role: asset.role,
          score: support.graphSignalScore,
          path: support.propagationPath,
          reasons: support.notes,
        };
        const existing = discoveries.get(id);
        if (!existing || existing.score < next.score) discoveries.set(id, next);
      }
    }
  }
  return Array.from(discoveries.values())
    .sort((a, b) => b.score - a.score || a.themeLabel.localeCompare(b.themeLabel))
    .slice(0, 18);
}
