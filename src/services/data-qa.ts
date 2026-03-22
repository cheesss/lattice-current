import type { AppContext } from '@/app/app-context';
import type { NewsItem } from '@/types';
import { SITE_VARIANT } from '@/config';
import { getCurrentLanguage } from './i18n';
import type { SummarizationProvider } from './summarization';
import { getAllGeoHubs } from './geo-hub-index';
import { canUseLocalAgentEndpoints, isDesktopRuntime } from './runtime';
import { isFeatureAvailable } from './runtime-config';
import { calculateCII } from './country-instability';
import { nameToCountryCode } from './country-geometry';

const MAX_NEWS_ITEMS = 2400;
const MAX_NEWS_PER_CATEGORY = 1200;
const MAX_CLUSTERS = 120;
const MAX_MARKETS = 220;
const MAX_PREDICTIONS = 180;
const MAX_INTEL_ITEMS = 240;
const MAX_CONTEXT_CHARS = 450_000;
const MAX_PROMPT_HEADLINES = 3000;
const MAX_EVIDENCE_RESULTS = 8;
const MAX_EVIDENCE_HINTS = 80;
const LOCAL_CODEX_TIMEOUT_MS = 18_000;
const LOCAL_OLLAMA_SOFT_COOLDOWN_MS = 2 * 60_000;
const LOCAL_OLLAMA_HARD_COOLDOWN_MS = 30 * 60_000;

let localOllamaRetryAfter = 0;
let localOllamaFailureReason = '';

type QAMode = 'casual' | 'analytical';
type QARegionKey =
  | 'africa'
  | 'europe'
  | 'asia'
  | 'middle-east'
  | 'north-america'
  | 'south-america'
  | 'oceania';

interface QAQuestionProfile {
  mode: QAMode;
  focus: 'market' | 'risk' | 'intel' | 'mixed';
  requireEvidence: boolean;
  regionKey?: QARegionKey;
  regionLabel?: string;
  regionTerms: string[];
}

function toIso(value: Date | string | number | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function cleanText(value: string | undefined | null, maxLen: number): string {
  if (!value) return '';
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLen - 3))}...`;
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s\-_.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsNormalizedTerm(normalized: string, term: string): boolean {
  const cleanTerm = normalizeForMatch(term);
  if (!cleanTerm) return false;
  if (normalized === cleanTerm) return true;
  const pattern = new RegExp(`(?:^|\\s)${escapeRegex(cleanTerm)}(?:\\s|$)`, 'i');
  return pattern.test(normalized);
}

function tokenize(value: string): string[] {
  return Array.from(new Set(
    normalizeForMatch(value)
      .split(' ')
      .filter(token => token.length >= 3)
      .slice(0, 260)
  ));
}

function questionAllowsSports(question: string): boolean {
  const normalized = normalizeForMatch(question);
  return /\b(sport|sports|football|soccer|baseball|basketball|tennis|cricket|league|cup|match|athletics)\b/.test(normalized)
    || /(스포츠|축구|야구|농구|테니스|크리켓|리그|컵|경기|선수|체육)/.test(question);
}

function isSportsNoiseText(value: string): boolean {
  const normalized = normalizeForMatch(value);
  return /\b(basketball|football|soccer|baseball|tennis|cricket|league|cup|athletics|semifinal|quarterfinal|world baseball classic|win over|vs )\b/.test(normalized)
    || /(축구|야구|농구|테니스|리그|컵|준결승|결승|체육|선수|감독|경기)/.test(value);
}

function questionWantsHardNews(question: string): boolean {
  const normalized = normalizeForMatch(question);
  return /\b(situation|overview|brief|summary|analysis|what.?s happening|latest|status|outlook|risk)\b/.test(normalized)
    || /(상황|정세|현황|핵심|요약|브리핑|분석|무슨 일|어때|전망|리스크)/.test(question);
}

function questionNeedsSituationalOverview(question: string): boolean {
  const normalized = normalizeForMatch(question);
  return /\b(situation|overview|brief|summary|status|outlook|risk|what.?s happening|how is)\b/.test(normalized)
    || /(상황|정세|현황|핵심|요약|브리핑|설명|어때|어떄|전망|리스크|무슨 일)/.test(question);
}

function questionLooksCasual(question: string): boolean {
  const normalized = normalizeForMatch(question);
  return /\b(hello|hi|hey|what can you do|who are you|help)\b/.test(normalized)
    || /(안녕|반가워|뭐 할 수 있어|무엇을 할 수 있어|도움말|헬프)/.test(question);
}

function isLifestyleNoiseText(value: string): boolean {
  const normalized = normalizeForMatch(value);
  return /\b(beauty|fashion|podcast|music|movie|film|celebrity|obesity|weight loss|weight-loss|diet|church|christian|festival|lifestyle|tv show|entertainment|ready-to-wear|runway|collection|photos|photo gallery|style|gossip|obituary|dies aged|dies at|dead at)\b/.test(normalized)
    || /(뷰티|패션|팟캐스트|음악|영화|연예|다이어트|비만|교회|기독교|엔터테인먼트|라이프스타일|컬렉션|화보|사진|런웨이|스타일|부고|별세|사망)/.test(value);
}

function isRoutineInstitutionalText(value: string): boolean {
  const normalized = normalizeForMatch(value);
  return /\b(introductory statement|statement on|press release|remarks|speech|address|call with|meets with|meeting with|commits to|welcomes|congratulates|confirmed|confirms)\b/.test(normalized)
    || /(성명|발언|기조연설|연설|브리핑|기자회견|통화|면담|회동|만남|환영|축하|확인)/.test(value);
}

function hardNewsSignalScore(value: string): number {
  const normalized = normalizeForMatch(value);
  const terms = [
    'attack', 'attacks', 'army', 'military', 'drone', 'missile', 'base', 'killed', 'dead', 'clash', 'clashes',
    'conflict', 'war', 'ceasefire', 'protest', 'election', 'government', 'minister', 'president', 'ambassador',
    'fuel', 'oil', 'gas', 'inflation', 'debt', 'default', 'market', 'economy', 'aid', 'sanction', 'border',
    'insurgent', 'refugee', 'displacement', 'drought', 'famine', 'outbreak', 'epidemic', 'port', 'shipping',
    'cocoa', 'commodity', 'farmers', 'agriculture', 'dangote',
  ];
  let score = 0;
  for (const term of terms) {
    if (normalized.includes(term)) score += 1;
  }
  if (/(공습|공격|군|군사|드론|미사일|기지|사망|충돌|전쟁|휴전|시위|선거|정부|장관|대통령|대사|연료|석유|가스|인플레|부채|디폴트|시장|경제|원조|제재|국경|난민|실향민|가뭄|기근|전염병|항만|해운|농업|코코아|원자재)/.test(value)) {
    score += 2;
  }
  return score;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function toYahooSymbolUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

function toSearchUrl(query: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}

function normalizeNews(item: NewsItem): {
  source: string;
  title: string;
  link: string;
  time: string | null;
  threat: string | null;
  location: string | null;
} {
  return {
    source: cleanText(item.source, 80),
    title: cleanText(item.title, 280),
    link: cleanText(item.link, 260),
    time: toIso(item.pubDate),
    threat: item.threat?.level ?? null,
    location: item.locationName
      ? cleanText(item.locationName, 120)
      : (Number.isFinite(item.lat) && Number.isFinite(item.lon))
        ? `${item.lat?.toFixed(2)},${item.lon?.toFixed(2)}`
        : null,
  };
}

export interface DataQASnapshot {
  generatedAt: string;
  variant: string;
  language: string;
  timeRange: string;
  enabledLayers: string[];
  counts: {
    news: number;
    clusters: number;
    markets: number;
    predictions: number;
    protests: number;
    outages: number;
    flights: number;
    vessels: number;
    earthquakes: number;
    monitors: number;
  };
  monitors: Array<{
    id: string;
    name: string;
    keywords: string[];
    lat: number | null;
    lon: number | null;
  }>;
  newsByCategory: Array<{
    category: string;
    total: number;
    items: ReturnType<typeof normalizeNews>[];
  }>;
  allNews: ReturnType<typeof normalizeNews>[];
  clusters: Array<{
    id: string;
    title: string;
    source: string;
    link: string;
    sourceCount: number;
    firstSeen: string | null;
    lastUpdated: string | null;
    isAlert: boolean;
    threat: string | null;
    relationScore: number | null;
    evidence: string[];
  }>;
  markets: Array<{
    symbol: string;
    name: string;
    price: number | null;
    change: number | null;
  }>;
  predictions: Array<{
    title: string;
    yesPrice: number;
    volume: number | null;
    url: string;
  }>;
  intelligence: {
    outages: Array<{
      title: string;
      country: string;
      severity: string;
      time: string | null;
      categories: string[];
      location: string;
    }>;
    protests: Array<{
      title: string;
      country: string;
      severity: string;
      eventType: string;
      time: string | null;
      confidence: string;
    }>;
    earthquakes: Array<{
      place: string;
      magnitude: number;
      depth: number;
      time: string | null;
    }>;
    militaryFlights: Array<{
      callsign: string;
      type: string;
      operatorCountry: string;
      speed: number;
      altitude: number;
      lastSeen: string | null;
      location: string;
    }>;
    militaryVessels: Array<{
      name: string;
      type: string;
      operatorCountry: string;
      speed: number;
      lastAisUpdate: string | null;
      dark: boolean;
      location: string;
    }>;
    usniFleet: {
      articleTitle: string;
      articleDate: string;
      vessels: number;
      strikeGroups: number;
      regions: string[];
    } | null;
  };
  keywordGraph: {
    generatedAt: string | null;
    nodes: Array<{
      term: string;
      domain: string;
      status: string;
      score: number;
    }>;
    edges: Array<{
      source: string;
      target: string;
      weight: number;
    }>;
  };
  graphRag: {
    generatedAt: string | null;
    globalThemes: string[];
    hierarchyLines: string[];
  };
  ontologyGraph: {
    generatedAt: string | null;
    nodes: number;
    edges: number;
    events: number;
    inferred: number;
    violations: number;
  };
  multimodal: Array<{
    topic: string;
    url: string;
    summary: string;
    capturedAt: string | null;
    evidence: string[];
  }>;
  sourceCredibility: Array<{
    source: string;
    credibilityScore: number;
    corroborationScore: number;
    feedHealthScore: number;
    propagandaRiskScore: number;
    notes: string[];
  }>;
  transmissions: Array<{
    eventTitle: string;
    marketSymbol: string;
    relationType: string;
    strength: number;
    reason: string;
  }>;
  reports: Array<{
    title: string;
    generatedAt: string;
    summary: string;
    rebuttalSummary?: string | null;
    consensusMode?: string | null;
  }>;
  multiHop: Array<{
    title: string;
    severity: string;
    category: string;
    confidence: number;
    summary: string;
    chain: string[];
  }>;
  ontology: Array<{
    canonicalName: string;
    confidence: number;
    source: string;
    externalRefs: string[];
  }>;
}

export type DataQAEvidenceType =
  | 'news'
  | 'cluster'
  | 'market'
  | 'prediction'
  | 'outage'
  | 'protest'
  | 'earthquake'
  | 'flight'
  | 'vessel'
  | 'multimodal';

export interface DataQAEvidenceLink {
  id: string;
  type: DataQAEvidenceType;
  label: string;
  url: string;
  note?: string;
  score: number;
}

export interface DataQAAnswer {
  answer: string;
  provider: SummarizationProvider | 'snapshot';
  model: string;
  cached: boolean;
  contextChars: number;
  truncated: boolean;
  evidence: DataQAEvidenceLink[];
  mode: QAMode;
  quality: 'pass' | 'augmented' | 'fallback';
  evidenceFirst?: boolean;
}

interface EvidenceCandidate {
  id: string;
  type: DataQAEvidenceType;
  label: string;
  url: string;
  aliases: string[];
  note?: string;
  timestamp?: string | null;
}

interface LocalCodexChatResponse {
  summary?: string;
  model?: string;
}

interface PreparedQuestionContext {
  cleanQuestion: string;
  snapshot: DataQASnapshot;
  profile: QAQuestionProfile;
  evidenceHints: DataQAEvidenceLink[];
  allowedEvidenceIds: Set<string>;
  headlines: string[];
  contextChars: number;
  truncated: boolean;
  geoContext: string;
  lang: string;
}

interface QARegionSpec {
  key: QARegionKey;
  label: string;
  aliases: string[];
  hubRegions: string[];
  extraTerms: string[];
}

const QA_REGION_SPECS: QARegionSpec[] = [
  {
    key: 'africa',
    label: 'Africa',
    aliases: ['africa', 'african', '아프리카'],
    hubRegions: ['africa'],
    extraTerms: ['sub-saharan africa', 'west africa', 'east africa', 'southern africa', 'central africa', 'sahel', 'horn of africa'],
  },
  {
    key: 'europe',
    label: 'Europe',
    aliases: ['europe', 'european', 'eu', '유럽'],
    hubRegions: ['europe'],
    extraTerms: ['eastern europe', 'western europe', 'baltic', 'black sea'],
  },
  {
    key: 'asia',
    label: 'Asia',
    aliases: ['asia', 'asian', '아시아'],
    hubRegions: ['asia'],
    extraTerms: ['east asia', 'southeast asia', 'south asia', 'taiwan strait', 'south china sea'],
  },
  {
    key: 'middle-east',
    label: 'Middle East',
    aliases: ['middle east', 'mideast', 'mena', '중동'],
    hubRegions: ['middle east'],
    extraTerms: ['gulf', 'persian gulf', 'red sea', 'levant', 'hormuz'],
  },
  {
    key: 'north-america',
    label: 'North America',
    aliases: ['north america', '북미'],
    hubRegions: ['north america'],
    extraTerms: ['united states', 'usa', 'canada', 'mexico'],
  },
  {
    key: 'south-america',
    label: 'South America',
    aliases: ['south america', 'latin america', 'latam', '남미', '중남미'],
    hubRegions: ['south america'],
    extraTerms: ['brazil', 'argentina', 'colombia', 'venezuela'],
  },
  {
    key: 'oceania',
    label: 'Oceania',
    aliases: ['oceania', 'australia', 'pacific', '오세아니아'],
    hubRegions: ['oceania', 'pacific'],
    extraTerms: ['new zealand', 'canberra', 'sydney'],
  },
];

const REGION_TERM_STOPWORDS = new Set([
  'international',
  'global',
  'world',
]);

const QA_REGION_CATALOG = (() => {
  const hubs = getAllGeoHubs();
  return QA_REGION_SPECS.map(spec => {
    const terms = new Set<string>();
    const addTerm = (value: string): void => {
      const normalized = normalizeForMatch(value);
      if (!normalized) return;
      if (normalized.length < 3) return;
      if (REGION_TERM_STOPWORDS.has(normalized)) return;
      terms.add(normalized);
    };

    spec.aliases.forEach(addTerm);
    spec.extraTerms.forEach(addTerm);
    for (const hub of hubs) {
      const hubRegion = normalizeForMatch(hub.region);
      if (!spec.hubRegions.includes(hubRegion)) continue;
      addTerm(hub.name);
      addTerm(hub.country);
      hub.keywords.forEach(addTerm);
    }
    return {
      ...spec,
      terms: Array.from(terms).filter(Boolean),
    };
  });
})();

function toTimeMs(value?: string | null): number {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function detectQuestionRegion(normalizedQuestion: string): {
  key?: QARegionKey;
  label?: string;
  terms: string[];
} {
  for (const spec of QA_REGION_CATALOG) {
    if (spec.aliases.some(alias => normalizedQuestion.includes(normalizeForMatch(alias)))) {
      return {
        key: spec.key,
        label: spec.label,
        terms: spec.terms,
      };
    }
  }
  return { terms: [] };
}

function matchesRegionProfile(text: string, profile: QAQuestionProfile): boolean {
  if (!profile.regionTerms.length) return true;
  const normalized = normalizeForMatch(text);
  return profile.regionTerms.some(term => containsNormalizedTerm(normalized, term));
}

function filterItemsForProfile<T>(
  items: T[],
  profile: QAQuestionProfile,
  toText: (item: T) => string,
): T[] {
  if (!profile.regionTerms.length) return items;
  return items.filter(item => matchesRegionProfile(toText(item), profile));
}

function buildQuestionTokens(question: string, profile: QAQuestionProfile): string[] {
  const base = tokenize(question);
  if (!profile.regionTerms.length) return base;
  const expanded = profile.regionTerms
    .slice(0, 40)
    .flatMap(term => tokenize(term))
    .slice(0, 80);
  return Array.from(new Set([...base, ...expanded]));
}

function tokenMatchScore(text: string, tokens: string[]): number {
  if (!tokens.length) return 0;
  const normalized = normalizeForMatch(text);
  let score = 0;
  for (const token of tokens) {
    if (token.length < 3) continue;
    if (normalized.includes(token)) score += 1;
  }
  return score;
}

function rankByQuestion<T>(
  items: T[],
  tokens: string[],
  toText: (item: T) => string,
  toTime?: (item: T) => string | null,
): T[] {
  return items
    .map((item, index) => ({
      item,
      index,
      score: tokenMatchScore(toText(item), tokens),
      timeMs: toTimeMs(toTime ? toTime(item) : null),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.timeMs !== a.timeMs) return b.timeMs - a.timeMs;
      return a.index - b.index;
    })
    .map(entry => entry.item);
}

function detectQuestionProfile(question: string): QAQuestionProfile {
  const normalized = normalizeForMatch(question);
  if (!normalized) {
    return { mode: 'analytical', focus: 'mixed', requireEvidence: true, regionTerms: [] };
  }

  if (questionLooksCasual(question)) {
    return {
      mode: 'casual',
      focus: 'mixed',
      requireEvidence: false,
      regionTerms: [],
    };
  }

  const marketHints = [
    'market', 'stock', 'bond', 'oil', 'gold', 'commodity', 'crypto',
    'price', 'yield', 'ticker', 'equity', 'fx',
    '유가', '주식', '증시', '채권', '원자재', '환율', '달러', '금리',
    '해운', '운임', '보험료', '호르무즈', 'shipping',
  ];
  const riskHints = [
    'risk', 'war', 'conflict', 'sanction', 'escalation', 'threat', 'impact',
    '시나리오', '리스크', '위험', '전쟁', '충돌', '제재', '영향',
  ];
  const intelHints = [
    'flight', 'vessel', 'outage', 'protest', 'earthquake', 'intel',
    '항공', '선박', '정전', '시위', '지진', '정보',
  ];

  const hasMarket = marketHints.some(hint => normalized.includes(hint));
  const hasRisk = riskHints.some(hint => normalized.includes(hint));
  const hasIntel = intelHints.some(hint => normalized.includes(hint));

  let focus: QAQuestionProfile['focus'] = 'mixed';
  if (hasMarket && !hasRisk && !hasIntel) focus = 'market';
  else if (hasRisk && !hasMarket && !hasIntel) focus = 'risk';
  else if (hasIntel && !hasMarket && !hasRisk) focus = 'intel';
  const region = detectQuestionRegion(normalized);

  return {
    mode: 'analytical',
    focus,
    requireEvidence: true,
    regionKey: region.key,
    regionLabel: region.label,
    regionTerms: region.terms,
  };
}

const MARKET_SIGNAL_HINTS = [
  'market', 'stock', 'stocks', 'equity', 'equities', 'bond', 'bonds', 'yield', 'yields',
  'price', 'prices', 'pricing', 'oil', 'crude', 'brent', 'wti', 'gas', 'lng', 'commodity',
  'commodities', 'shipping', 'freight', 'tanker', 'tankers', 'insurance', 'premium', 'premiums',
  'transport route', 'transport routes', 'strait of hormuz', 'hormuz', 'supply chain',
  '유가', '주식', '증시', '채권', '금리', '원자재', '운임', '해운', '보험료', '공급망',
];

const SHIPPING_SIGNAL_HINTS = [
  'shipping', 'ship', 'ships', 'vessel', 'vessels', 'freight', 'tanker', 'tankers',
  'port', 'ports', 'strait', 'hormuz', 'chokepoint', 'maritime', 'insurance',
  '해운', '선박', '항로', '항만', '호르무즈', '보험료', '운송',
];

function keywordSignalScore(text: string, hints: string[]): number {
  if (!text) return 0;
  const normalized = normalizeForMatch(text);
  return hints.reduce((score, hint) => score + (normalized.includes(hint) ? 1 : 0), 0);
}

function buildNewsQuestionText(
  news: ReturnType<typeof normalizeNews>,
  profile: QAQuestionProfile,
): string {
  const body = `${news.title} ${news.location ?? ''} ${news.threat ?? ''} ${news.link}`;
  return profile.regionTerms.length ? body : `${news.source} ${body}`;
}

function buildClusterQuestionText(
  cluster: DataQASnapshot['clusters'][number],
  profile: QAQuestionProfile,
): string {
  const body = `${cluster.title} ${cluster.threat ?? ''} ${cluster.evidence.join(' ')} ${cluster.link}`;
  return profile.regionTerms.length ? body : `${cluster.source} ${body}`;
}

function threatWeight(level: string | null | undefined): number {
  switch ((level ?? '').toLowerCase()) {
    case 'critical': return 12;
    case 'high': return 8;
    case 'medium': return 4;
    case 'elevated': return 3;
    case 'low': return 1;
    default: return 0;
  }
}

function rankNewsForQuestion(
  items: ReturnType<typeof normalizeNews>[],
  profile: QAQuestionProfile,
  question: string,
): ReturnType<typeof normalizeNews>[] {
  const tokens = buildQuestionTokens(question, profile);
  const situational = questionNeedsSituationalOverview(question);
  return items
    .map((news, index) => {
      const text = buildNewsQuestionText(news, profile);
      const signalScore = hardNewsSignalScore(`${news.title} ${news.source} ${news.location ?? ''}`);
      const relevance = tokenMatchScore(text, tokens) * 10
        + signalScore * (situational ? 5 : 3)
        + threatWeight(news.threat);
      return {
        news,
        index,
        relevance,
        signalScore,
        timeMs: toTimeMs(news.time),
      };
    })
    .sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      if (b.signalScore !== a.signalScore) return b.signalScore - a.signalScore;
      if (b.timeMs !== a.timeMs) return b.timeMs - a.timeMs;
      return a.index - b.index;
    })
    .map(entry => entry.news);
}

function rankClustersForQuestion(
  items: DataQASnapshot['clusters'],
  profile: QAQuestionProfile,
  question: string,
): DataQASnapshot['clusters'] {
  const tokens = buildQuestionTokens(question, profile);
  const situational = questionNeedsSituationalOverview(question);
  return items
    .map((cluster, index) => {
      const text = buildClusterQuestionText(cluster, profile);
      const signalScore = hardNewsSignalScore(`${cluster.title} ${cluster.evidence.join(' ')} ${cluster.source}`);
      const relevance = tokenMatchScore(text, tokens) * 10
        + signalScore * (situational ? 5 : 3)
        + threatWeight(cluster.threat)
        + (cluster.isAlert ? 4 : 0)
        + Math.min(6, cluster.sourceCount);
      return {
        cluster,
        index,
        relevance,
        signalScore,
        timeMs: toTimeMs(cluster.lastUpdated),
      };
    })
    .sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      if (b.signalScore !== a.signalScore) return b.signalScore - a.signalScore;
      if (b.timeMs !== a.timeMs) return b.timeMs - a.timeMs;
      return a.index - b.index;
    })
    .map(entry => entry.cluster);
}

function getRegionCountryCodes(profile: QAQuestionProfile): Set<string> {
  if (!profile.regionKey || !profile.regionLabel) return new Set<string>();
  const regionNorm = normalizeForMatch(profile.regionLabel);
  const codes = new Set<string>();
  for (const hub of getAllGeoHubs()) {
    if (normalizeForMatch(hub.region) !== regionNorm) continue;
    const code = nameToCountryCode(hub.country);
    if (code) codes.add(code);
  }
  const extraHints: Partial<Record<QARegionKey, string[]>> = {
    africa: ['Sudan', 'South Sudan', 'Nigeria', 'Ethiopia', 'Somalia', 'Democratic Republic of the Congo', 'Mali', 'Burkina Faso', 'Niger', 'Central African Republic', 'Eritrea'],
    'middle-east': ['Iran', 'Israel', 'Iraq', 'Lebanon', 'Yemen', 'Saudi Arabia', 'Qatar', 'Syria', 'Jordan', 'Egypt', 'Turkey'],
    asia: ['China', 'Taiwan', 'India', 'Pakistan', 'Afghanistan', 'Myanmar', 'North Korea', 'Japan', 'South Korea', 'Philippines'],
    europe: ['Ukraine', 'Russia', 'Belarus', 'Poland', 'Romania', 'Germany', 'France', 'United Kingdom'],
    'north-america': ['United States', 'Canada', 'Mexico', 'Cuba'],
    'south-america': ['Brazil', 'Argentina', 'Colombia', 'Venezuela', 'Chile', 'Peru'],
    oceania: ['Australia', 'New Zealand'],
  };
  for (const hint of extraHints[profile.regionKey] ?? []) {
    const code = nameToCountryCode(hint);
    if (code) codes.add(code);
  }
  return codes;
}

function getRegionalInstabilityLeaders(profile: QAQuestionProfile): Array<{ name: string; score: number; trend: string }> {
  const countryCodes = getRegionCountryCodes(profile);
  if (countryCodes.size === 0) return [];
  return calculateCII()
    .filter(item => countryCodes.has(item.code))
    .sort((a, b) => b.score - a.score || b.change24h - a.change24h)
    .slice(0, 4)
    .map(item => ({
      name: item.name,
      score: item.score,
      trend: item.trend,
    }));
}

function filterNewsForQuestion(
  items: ReturnType<typeof normalizeNews>[],
  profile: QAQuestionProfile,
  question: string,
): ReturnType<typeof normalizeNews>[] {
  const allowSports = questionAllowsSports(question);
  const hardNews = questionWantsHardNews(question);
  const situational = questionNeedsSituationalOverview(question);
  return items.filter(news => {
    const text = buildNewsQuestionText(news, profile);
    const candidateText = `${news.title} ${news.source} ${news.location ?? ''} ${news.threat ?? ''}`;
    if (profile.regionTerms.length && !matchesRegionProfile(text, profile)) return false;
    if (!allowSports && isSportsNoiseText(`${news.title} ${news.location ?? ''}`)) return false;
    if (hardNews && isLifestyleNoiseText(candidateText)) return false;
    if (hardNews && situational && profile.regionTerms.length) {
      if (hardNewsSignalScore(candidateText) + threatWeight(news.threat) <= 0) return false;
      if (isRoutineInstitutionalText(candidateText) && hardNewsSignalScore(candidateText) < 4) return false;
    }
    return true;
  });
}

function filterClustersForQuestion(
  items: DataQASnapshot['clusters'],
  profile: QAQuestionProfile,
  question: string,
): DataQASnapshot['clusters'] {
  const allowSports = questionAllowsSports(question);
  const hardNews = questionWantsHardNews(question);
  const situational = questionNeedsSituationalOverview(question);
  return items.filter(cluster => {
    const text = buildClusterQuestionText(cluster, profile);
    const candidateText = `${cluster.title} ${cluster.evidence.join(' ')} ${cluster.threat ?? ''}`;
    if (profile.regionTerms.length && !matchesRegionProfile(text, profile)) return false;
    if (!allowSports && isSportsNoiseText(`${cluster.title} ${cluster.evidence.join(' ')}`)) return false;
    if (hardNews && isLifestyleNoiseText(candidateText)) return false;
    if (hardNews && situational && profile.regionTerms.length) {
      if (hardNewsSignalScore(candidateText) + threatWeight(cluster.threat) + (cluster.isAlert ? 1 : 0) <= 0) return false;
      if (isRoutineInstitutionalText(candidateText) && hardNewsSignalScore(candidateText) < 4) return false;
    }
    return true;
  });
}

function appendEvidenceIfMissing(
  answer: string,
  evidence: DataQAEvidenceLink[],
): { answer: string; augmented: boolean } {
  if (!answer.trim()) return { answer, augmented: false };
  if (evidence.length === 0) return { answer, augmented: false };
  if (/\[EVID:[a-z]+-\d+\]/i.test(answer)) return { answer, augmented: false };

  const footerLines = evidence.slice(0, 4).map(
    item => `- [EVID:${item.id}] ${item.label}${item.note ? ` (${item.note})` : ''}`,
  );
  const merged = `${answer.trim()}\n\n근거:\n${footerLines.join('\n')}`;
  return { answer: merged, augmented: true };
}

function buildQuestionGraphSubgraph(
  snapshot: DataQASnapshot,
  question: string,
  profile: QAQuestionProfile,
): {
  nodes: DataQASnapshot['keywordGraph']['nodes'];
  edges: DataQASnapshot['keywordGraph']['edges'];
  themes: string[];
  hierarchyLines: string[];
} {
  const tokens = buildQuestionTokens(question, profile).slice(0, 80);
  const rankedNodes = snapshot.keywordGraph.nodes
    .map((node, index) => ({
      node,
      index,
      score: tokenMatchScore(`${node.term} ${node.domain} ${node.status}`, tokens) * 5 + Math.round((node.score || 0) / 20),
    }))
    .sort((a, b) => (b.score - a.score) || (b.node.score - a.node.score) || (a.index - b.index))
    .slice(0, 8)
    .map((entry) => entry.node);

  const nodeTerms = new Set(rankedNodes.map((node) => node.term.toLowerCase()));
  const rankedEdges = snapshot.keywordGraph.edges
    .map((edge, index) => ({
      edge,
      index,
      score:
        tokenMatchScore(`${edge.source} ${edge.target}`, tokens) * 4
        + (nodeTerms.has(edge.source.toLowerCase()) ? 5 : 0)
        + (nodeTerms.has(edge.target.toLowerCase()) ? 5 : 0)
        + edge.weight,
    }))
    .sort((a, b) => (b.score - a.score) || (b.edge.weight - a.edge.weight) || (a.index - b.index))
    .slice(0, 8)
    .map((entry) => entry.edge);

  const themes = rankByQuestion(
    snapshot.graphRag.globalThemes,
    tokens,
    (theme) => theme,
  ).slice(0, 6);

  const hierarchyLines = rankByQuestion(
    snapshot.graphRag.hierarchyLines,
    tokens,
    (line) => line,
  ).slice(0, 6);

  return { nodes: rankedNodes, edges: rankedEdges, themes, hierarchyLines };
}

function buildPromptHeadlines(
  question: string,
  snapshot: DataQASnapshot,
  profile: QAQuestionProfile,
  evidenceHints: DataQAEvidenceLink[],
): {
  headlines: string[];
  contextChars: number;
  truncated: boolean;
} {
  const tokens = buildQuestionTokens(question, profile).slice(0, 80);
  const graphSubgraph = buildQuestionGraphSubgraph(snapshot, question, profile);
  const headlines: string[] = [];
  let contextChars = 0;
  let truncated = false;

  const pushLine = (line: string): void => {
    const trimmed = cleanText(line, 480);
    if (!trimmed) return;
    if (headlines.length >= MAX_PROMPT_HEADLINES) {
      truncated = true;
      return;
    }
    if (contextChars + trimmed.length + 1 > MAX_CONTEXT_CHARS) {
      truncated = true;
      return;
    }
    headlines.push(trimmed);
    contextChars += trimmed.length + 1;
  };

  pushLine('ROLE: You are the in-app World Monitor geopolitical + market data analyst.');
  pushLine(`INTERACTION_MODE: ${profile.mode}; focus=${profile.focus}; requireEvidence=${profile.requireEvidence ? 'yes' : 'no'}`);
  if (profile.regionKey && profile.regionLabel) {
    pushLine(`REGION_FOCUS: ${profile.regionLabel}`);
    pushLine('REGION_RULE: If the question is region-specific, only prioritize signals clearly tied to that region. If coverage is weak, say that explicitly instead of using unrelated global news.');
  }
  pushLine(`QUESTION: ${cleanText(question, 1000)}`);
  if (profile.mode === 'analytical') {
    pushLine('RULES: Give concrete conclusions with drivers/risks/scenarios. Mark uncertainty explicitly.');
    pushLine('EVIDENCE_RULE: Every key claim must include citation token like [EVID:news-12].');
    pushLine('OUTPUT_RULE: Use readable Korean. Do not output URL-only lines.');
    pushLine('OUTPUT_GUARD: Do not discuss prompt lines, line numbers, or internal formatting.');
  } else {
    pushLine('RULES: Keep a natural conversational tone. If data is referenced, keep it brief and concrete.');
  }
  pushLine('LANGUAGE_RULE: Answer in Korean (한국어).');
  pushLine(`DATASET_META: variant=${snapshot.variant}; lang=${snapshot.language}; generatedAt=${snapshot.generatedAt}; timeRange=${snapshot.timeRange}`);
  pushLine(`DATASET_COUNTS: news=${snapshot.counts.news}, clusters=${snapshot.counts.clusters}, markets=${snapshot.counts.markets}, predictions=${snapshot.counts.predictions}, protests=${snapshot.counts.protests}, outages=${snapshot.counts.outages}, flights=${snapshot.counts.flights}, vessels=${snapshot.counts.vessels}, earthquakes=${snapshot.counts.earthquakes}`);
  pushLine(`KEYWORD_GRAPH_COUNTS: nodes=${snapshot.keywordGraph.nodes.length}, edges=${snapshot.keywordGraph.edges.length}, generatedAt=${snapshot.keywordGraph.generatedAt ?? 'na'}`);
  pushLine(`GRAPH_RAG_COUNTS: themes=${snapshot.graphRag.globalThemes.length}, lines=${snapshot.graphRag.hierarchyLines.length}, generatedAt=${snapshot.graphRag.generatedAt ?? 'na'}`);
  pushLine(`ONTOLOGY_GRAPH_COUNTS: nodes=${snapshot.ontologyGraph.nodes}, edges=${snapshot.ontologyGraph.edges}, events=${snapshot.ontologyGraph.events}, inferred=${snapshot.ontologyGraph.inferred}, violations=${snapshot.ontologyGraph.violations}, generatedAt=${snapshot.ontologyGraph.generatedAt ?? 'na'}`);
  pushLine(`MULTIMODAL_COUNTS: findings=${snapshot.multimodal.length}`);
  pushLine(`SOURCE_CREDIBILITY_COUNTS: profiles=${snapshot.sourceCredibility.length}`);
  pushLine(`TRANSMISSION_COUNTS: edges=${snapshot.transmissions.length}`);
  pushLine(`REPORT_COUNTS: reports=${snapshot.reports.length}`);
  pushLine(`MULTI_HOP_COUNTS: alerts=${snapshot.multiHop.length}`);
  pushLine(`ONTOLOGY_COUNTS: entities=${snapshot.ontology.length}`);

  if (profile.requireEvidence && evidenceHints.length > 0) {
    for (const hint of evidenceHints.slice(0, MAX_EVIDENCE_HINTS)) {
      pushLine(`EVIDENCE_HINT: [EVID:${hint.id}] type=${hint.type}; label=${hint.label}; note=${hint.note ?? 'na'}`);
    }
  }

  if (snapshot.monitors.length > 0) {
    const monitorLine = rankByQuestion(
      snapshot.monitors,
      tokens,
      monitor => `${monitor.name} ${monitor.keywords.join(' ')}`,
    )
      .slice(0, 4)
      .map(monitor => `${monitor.name} [${monitor.keywords.slice(0, 4).join(', ')}]`)
      .join(' || ');
    pushLine(`MONITORS: ${monitorLine}`);
  }

  const topGraphNodes = graphSubgraph.nodes
    .map(node => `${node.term}:${node.domain}:${Math.round(node.score)}`);
  if (topGraphNodes.length > 0) {
    pushLine(`GRAPH_SUBGRAPH_NODES: ${topGraphNodes.join(' | ')}`);
  }

  const topGraphEdges = graphSubgraph.edges
    .map(edge => `${edge.source}->${edge.target} (${edge.weight})`);
  if (topGraphEdges.length > 0) {
    pushLine(`GRAPH_SUBGRAPH_RELATIONS: ${topGraphEdges.join(' | ')}`);
  }

  if (graphSubgraph.themes.length > 0) {
    pushLine(`GRAPH_SUBGRAPH_THEMES: ${graphSubgraph.themes.join(', ')}`);
  }
  for (const line of graphSubgraph.hierarchyLines.slice(0, 4)) {
    pushLine(line);
  }

  for (const finding of snapshot.multimodal.slice(0, 3)) {
    pushLine(`MULTIMODAL: topic=${finding.topic}; capturedAt=${finding.capturedAt ?? 'na'}; summary=${finding.summary}`);
  }

  for (const profile of snapshot.sourceCredibility.slice(0, 4)) {
    pushLine(`SOURCE_CREDIBILITY: source=${profile.source}; credibility=${profile.credibilityScore}; corroboration=${profile.corroborationScore}; health=${profile.feedHealthScore}; propagandaRisk=${profile.propagandaRiskScore}; notes=${profile.notes.join(' | ')}`);
  }

  for (const edge of snapshot.transmissions.slice(0, 6)) {
    pushLine(`TRANSMISSION: event=${edge.eventTitle}; market=${edge.marketSymbol}; type=${edge.relationType}; strength=${edge.strength}; reason=${edge.reason}`);
  }

  for (const report of snapshot.reports.slice(0, 3)) {
    pushLine(`REPORT: title=${report.title}; generatedAt=${report.generatedAt}; mode=${report.consensusMode ?? 'na'}; summary=${report.summary}`);
    if (report.rebuttalSummary) {
      pushLine(`REPORT_REBUTTAL: title=${report.title}; rebuttal=${report.rebuttalSummary}`);
    }
  }

  for (const alert of snapshot.multiHop.slice(0, 4)) {
    pushLine(`MULTI_HOP: title=${alert.title}; severity=${alert.severity}; category=${alert.category}; confidence=${alert.confidence}; chain=${alert.chain.join(' -> ')}; summary=${alert.summary}`);
  }

  for (const entity of snapshot.ontology.slice(0, 6)) {
    pushLine(`ONTOLOGY: canonical=${entity.canonicalName}; confidence=${entity.confidence}; source=${entity.source}; refs=${entity.externalRefs.join(', ')}`);
  }

  const orderedNews = rankNewsForQuestion(
    filterNewsForQuestion(snapshot.allNews, profile, question),
    profile,
    question,
  );
  if (profile.regionKey) pushLine(`REGION_NEWS_MATCHES: ${orderedNews.length}`);
  for (const news of orderedNews) {
    pushLine(`NEWS: src=${news.source}; time=${news.time ?? 'na'}; loc=${news.location ?? 'na'}; threat=${news.threat ?? 'na'}; title=${news.title}`);
  }

  const topClusters = rankClustersForQuestion(
    filterClustersForQuestion(snapshot.clusters, profile, question),
    profile,
    question,
  ).slice(0, 6);
  if (profile.regionKey) pushLine(`REGION_CLUSTER_MATCHES: ${topClusters.length}`);
  for (const cluster of topClusters) {
    pushLine(`CLUSTER: title=${cluster.title}; source=${cluster.source}; sources=${cluster.sourceCount}; threat=${cluster.threat ?? 'na'}; updated=${cluster.lastUpdated ?? 'na'}; alert=${cluster.isAlert ? 'yes' : 'no'}`);
  }

  const topMarkets = [...snapshot.markets]
    .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0))
    .slice(0, 4);
  for (const market of topMarkets) {
    pushLine(`MARKET: ${market.symbol} (${market.name}) price=${market.price ?? 'na'} change=${market.change ?? 'na'}`);
  }

  const topPredictions = rankByQuestion(
    snapshot.predictions,
    tokens,
    prediction => `${prediction.title} ${prediction.yesPrice} ${prediction.volume ?? ''}`,
  ).slice(0, 3);
  for (const prediction of topPredictions) {
    pushLine(`PREDICTION: title=${prediction.title}; yes=${prediction.yesPrice.toFixed(1)}%; volume=${prediction.volume ?? 'na'}`);
  }

  const topOutages = rankByQuestion(
    filterItemsForProfile(
      snapshot.intelligence.outages,
      profile,
      outage => `${outage.title} ${outage.country} ${outage.severity} ${outage.categories.join(' ')} ${outage.location}`,
    ),
    tokens,
    outage => `${outage.title} ${outage.country} ${outage.severity} ${outage.categories.join(' ')} ${outage.location}`,
    outage => outage.time,
  ).slice(0, 2);
  for (const outage of topOutages) {
    pushLine(`OUTAGE: ${outage.country}; severity=${outage.severity}; time=${outage.time ?? 'na'}; title=${outage.title}`);
  }

  const topProtests = rankByQuestion(
    filterItemsForProfile(
      snapshot.intelligence.protests,
      profile,
      protest => `${protest.title} ${protest.country} ${protest.severity} ${protest.eventType}`,
    ),
    tokens,
    protest => `${protest.title} ${protest.country} ${protest.severity} ${protest.eventType}`,
    protest => protest.time,
  ).slice(0, 2);
  for (const protest of topProtests) {
    pushLine(`PROTEST: ${protest.country}; type=${protest.eventType}; severity=${protest.severity}; confidence=${protest.confidence}; time=${protest.time ?? 'na'}; title=${protest.title}`);
  }

  const topQuakes = rankByQuestion(
    filterItemsForProfile(
      snapshot.intelligence.earthquakes,
      profile,
      quake => `${quake.place} ${quake.magnitude} ${quake.depth}`,
    ),
    tokens,
    quake => `${quake.place} ${quake.magnitude} ${quake.depth}`,
    quake => quake.time,
  ).slice(0, 2);
  for (const quake of topQuakes) {
    pushLine(`EARTHQUAKE: place=${quake.place}; mag=${quake.magnitude.toFixed(1)}; depth=${quake.depth}km; time=${quake.time ?? 'na'}`);
  }

  const topFlights = rankByQuestion(
    filterItemsForProfile(
      snapshot.intelligence.militaryFlights,
      profile,
      flight => `${flight.callsign} ${flight.type} ${flight.operatorCountry} ${flight.location}`,
    ),
    tokens,
    flight => `${flight.callsign} ${flight.type} ${flight.operatorCountry} ${flight.location}`,
    flight => flight.lastSeen,
  ).slice(0, 2);
  for (const flight of topFlights) {
    pushLine(`FLIGHT: callsign=${flight.callsign}; type=${flight.type}; operator=${flight.operatorCountry}; altitude=${flight.altitude}; speed=${flight.speed}; lastSeen=${flight.lastSeen ?? 'na'}; loc=${flight.location}`);
  }

  const topVessels = rankByQuestion(
    filterItemsForProfile(
      snapshot.intelligence.militaryVessels,
      profile,
      vessel => `${vessel.name} ${vessel.type} ${vessel.operatorCountry} ${vessel.location}`,
    ),
    tokens,
    vessel => `${vessel.name} ${vessel.type} ${vessel.operatorCountry} ${vessel.location}`,
    vessel => vessel.lastAisUpdate,
  ).slice(0, 2);
  for (const vessel of topVessels) {
    pushLine(`VESSEL: name=${vessel.name}; type=${vessel.type}; operator=${vessel.operatorCountry}; speed=${vessel.speed}; dark=${vessel.dark ? 'yes' : 'no'}; lastAis=${vessel.lastAisUpdate ?? 'na'}; loc=${vessel.location}`);
  }

  if (headlines.length < 2) {
    headlines.push('DATASET_FALLBACK: No structured records loaded.');
    contextChars += 43;
  }

  if (
    snapshot.counts.news > orderedNews.length
    || snapshot.counts.clusters > topClusters.length
    || snapshot.counts.markets > topMarkets.length
  ) {
    truncated = true;
  }

  return { headlines, contextChars, truncated };
}

function buildCodexFocusLines(prepared: PreparedQuestionContext): string[] {
  const alwaysPrefixes = [
    'ROLE:',
    'INTERACTION_MODE:',
    'REGION_FOCUS:',
    'REGION_RULE:',
    'QUESTION:',
    'RULES:',
    'EVIDENCE_RULE:',
    'OUTPUT_RULE:',
    'OUTPUT_GUARD:',
    'LANGUAGE_RULE:',
    'DATASET_META:',
    'DATASET_COUNTS:',
  ];
  const cappedPrefixes: Array<{ prefix: string; limit: number }> = [
    { prefix: 'EVIDENCE_HINT:', limit: 8 },
    { prefix: 'GRAPH_SUBGRAPH_NODES:', limit: 1 },
    { prefix: 'GRAPH_SUBGRAPH_RELATIONS:', limit: 1 },
    { prefix: 'GRAPH_SUBGRAPH_THEMES:', limit: 1 },
    { prefix: 'SOURCE_CREDIBILITY:', limit: 2 },
    { prefix: 'TRANSMISSION:', limit: 4 },
    { prefix: 'REPORT:', limit: 2 },
    { prefix: 'REPORT_REBUTTAL:', limit: 1 },
    { prefix: 'MULTI_HOP:', limit: 3 },
    { prefix: 'ONTOLOGY:', limit: 3 },
    { prefix: 'NEWS:', limit: 6 },
    { prefix: 'CLUSTER:', limit: 4 },
    { prefix: 'MARKET:', limit: 4 },
    { prefix: 'PREDICTION:', limit: 2 },
    { prefix: 'OUTAGE:', limit: 2 },
    { prefix: 'PROTEST:', limit: 2 },
    { prefix: 'EARTHQUAKE:', limit: 1 },
    { prefix: 'FLIGHT:', limit: 1 },
    { prefix: 'VESSEL:', limit: 1 },
  ];

  const selected: string[] = [];
  const seen = new Set<string>();
  const counters = new Map<string, number>();

  const push = (line: string): void => {
    const trimmed = cleanText(line, 420);
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    selected.push(trimmed);
  };

  for (const prefix of alwaysPrefixes) {
    const line = prepared.headlines.find(item => item.startsWith(prefix));
    if (line) push(line);
  }

  for (const { prefix, limit } of cappedPrefixes) {
    for (const line of prepared.headlines) {
      if (!line.startsWith(prefix)) continue;
      const used = counters.get(prefix) ?? 0;
      if (used >= limit) break;
      push(line);
      counters.set(prefix, used + 1);
    }
  }

  return selected.slice(0, 42);
}

async function tryLocalCodexChat(
  question: string,
  contextLines: string[],
  geoContext: string,
  lang: string,
  options: {
    mode?: 'chat' | 'analysis' | 'deep';
    timeoutMs?: number;
    maxLines?: number;
  } = {},
): Promise<{ summary: string; provider: SummarizationProvider; model: string; cached: boolean } | null> {
  if (!(isDesktopRuntime() || import.meta.env.DEV)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? LOCAL_CODEX_TIMEOUT_MS);
    const response = await fetch('/api/local-codex-summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        mode: options.mode ?? 'deep',
        geoContext,
        variant: SITE_VARIANT,
        lang,
        headlines: [
          `USER_QUESTION: ${cleanText(question, 1200)}`,
          ...contextLines,
        ].slice(0, options.maxLines ?? 2200),
      }),
    }).finally(() => clearTimeout(timer));
    if (!response.ok) return null;

    const payload = await response.json() as LocalCodexChatResponse;
    const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
    if (!summary) return null;

    return {
      summary,
      provider: 'codex',
      model: typeof payload.model === 'string' && payload.model.trim() ? payload.model.trim() : 'codex-cli',
      cached: false,
    };
  } catch {
    return null;
  }
}

async function tryLocalOllamaChat(
  question: string,
  contextLines: string[],
  geoContext: string,
  options: {
    timeoutMs?: number;
    maxLines?: number;
  } = {},
): Promise<{ summary: string; provider: SummarizationProvider; model: string; cached: boolean } | null> {
  if (!canUseLocalAgentEndpoints()) return null;
  if (!isFeatureAvailable('aiOllama')) return null;
  if (localOllamaRetryAfter > Date.now()) return null;

  const registerLocalOllamaFailure = (reason: string, hard = false): null => {
    localOllamaFailureReason = cleanText(reason || 'local ollama unavailable', 160);
    localOllamaRetryAfter = Date.now() + (hard ? LOCAL_OLLAMA_HARD_COOLDOWN_MS : LOCAL_OLLAMA_SOFT_COOLDOWN_MS);
    return null;
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? LOCAL_CODEX_TIMEOUT_MS);
    const response = await fetch('/api/local-ollama-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        timeoutMs: options.timeoutMs ?? 20_000,
        messages: [
          {
            role: 'system',
            content: geoContext,
          },
          {
            role: 'user',
            content: [
              `QUESTION: ${cleanText(question, 1200)}`,
              ...contextLines,
            ].slice(0, options.maxLines ?? 2200).join('\n'),
          },
        ],
      }),
    }).finally(() => clearTimeout(timer));
    if (!response.ok) {
      const hardFailure = response.status === 400
        || response.status === 401
        || response.status === 403
        || response.status === 404;
      let detail = `local ollama http ${response.status}`;
      try {
        const payload = await response.json() as { error?: string; reason?: string };
        detail = String(payload.reason || payload.error || detail);
      } catch {
        // ignore parse failure
      }
      return registerLocalOllamaFailure(detail, hardFailure);
    }

    const payload = await response.json() as { ok?: boolean; summary?: string; model?: string; reason?: string };
    const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
    if (!payload.ok || !summary) {
      const reason = String(payload.reason || 'local ollama returned empty response');
      const hardFailure = /missing|unauthorized|forbidden|not found|404/i.test(reason);
      return registerLocalOllamaFailure(reason, hardFailure);
    }

    localOllamaRetryAfter = 0;
    localOllamaFailureReason = '';

    return {
      summary,
      provider: 'ollama',
      model: typeof payload.model === 'string' && payload.model.trim() ? payload.model.trim() : 'ollama',
      cached: false,
    };
  } catch (error) {
    const reason = String((error as Error | undefined)?.message || localOllamaFailureReason || 'local ollama request failed');
    return registerLocalOllamaFailure(reason, /abort|timeout/i.test(reason) ? false : true);
  }
}

function buildPreparedQuestionContext(
  question: string,
  snapshot: DataQASnapshot,
): PreparedQuestionContext | null {
  const cleanQuestion = question.trim();
  if (!cleanQuestion) return null;

  const profile = detectQuestionProfile(cleanQuestion);
  const evidenceHints = rankEvidenceForQuestion(cleanQuestion, snapshot, profile, MAX_EVIDENCE_HINTS);
  const allowedEvidenceIds = new Set(evidenceHints.map(item => item.id.toLowerCase()));
  const { headlines, contextChars, truncated } = buildPromptHeadlines(cleanQuestion, snapshot, profile, evidenceHints);
  const geoContext = [
    'Use only the provided structured snapshot lines as source of truth.',
    profile.mode === 'casual'
      ? 'If the user is casual, answer naturally but stay grounded in the currently loaded snapshot when mentioning data.'
      : 'Always provide data-grounded analytical answer with conclusions, drivers, risks, scenarios, and uncertainty.',
    'Always cite key claims with [EVID:<id>] tokens from provided EVIDENCE_HINT lines.',
    'Always answer in Korean (한국어).',
    'Do not output URL-only responses.',
    profile.regionLabel ? `If the user asks about ${profile.regionLabel}, do not answer with unrelated non-${profile.regionLabel} stories.` : '',
  ].join(' ');

  return {
    cleanQuestion,
    snapshot,
    profile,
    evidenceHints,
    allowedEvidenceIds,
    headlines,
    contextChars,
    truncated,
    geoContext,
    lang: snapshot.language || getCurrentLanguage(),
  };
}

function buildCasualSnapshotAnswer(prepared: PreparedQuestionContext): DataQAAnswer {
  return {
    answer: [
      '현재 로드된 World Monitor 데이터 기준으로 지역 상황 요약, 국가별 리스크 정리, 시장/원자재/항공·해상 이벤트 연결, 그리고 근거 링크 정리를 할 수 있습니다.',
      '예를 들어 `아프리카 상황`, `중동 리스크`, `유가와 해상 교통 영향`, `최근 들어온 핵심 뉴스`처럼 물으면 바로 현재 스냅샷 기준으로 정리해 드립니다.',
    ].join('\n'),
    provider: 'snapshot',
    model: 'deterministic-snapshot',
    cached: false,
    contextChars: prepared.contextChars,
    truncated: prepared.truncated,
    evidence: [],
    mode: prepared.profile.mode,
    quality: 'pass',
  };
}

function buildFinalAnswer(
  prepared: PreparedQuestionContext,
  result: { summary: string; provider: SummarizationProvider; model: string; cached: boolean } | null,
  allowDeterministicFallback: boolean,
): DataQAAnswer | null {
  const { cleanQuestion, snapshot, profile, evidenceHints, allowedEvidenceIds, contextChars, truncated } = prepared;

  if (profile.mode === 'casual' && !result) {
    return buildCasualSnapshotAnswer(prepared);
  }

  const resolvedSummary = result?.summary?.trim() ?? '';
  const lowSignal = !resolvedSummary
    || isLowSignalAnalyticalAnswer(
      resolvedSummary,
      profile.requireEvidence,
      allowedEvidenceIds,
      cleanQuestion,
      profile,
      truncated,
      result?.provider,
    );

  if (lowSignal && !allowDeterministicFallback) {
    return null;
  }

  const useSnapshotAnswer = lowSignal || !result;
  let quality: DataQAAnswer['quality'] = 'pass';
  let answer = useSnapshotAnswer
    ? buildDeterministicFallbackAnswer(cleanQuestion, snapshot, profile, evidenceHints)
    : resolvedSummary;

  let evidence = useSnapshotAnswer
    ? evidenceHints.slice(0, MAX_EVIDENCE_RESULTS)
    : rankEvidenceLinks(cleanQuestion, answer, snapshot, profile, allowedEvidenceIds);
  if (evidence.length === 0) {
    evidence = evidenceHints.slice(0, MAX_EVIDENCE_RESULTS);
  }

  const evidenceMerge = appendEvidenceIfMissing(answer, evidence);
  if (evidenceMerge.augmented) {
    answer = evidenceMerge.answer;
    quality = 'augmented';
  }

  if (evidence.length > 0) {
    const evidenceHeader = [
      '핵심 근거:',
      ...evidence.slice(0, 4).map((item) => `- ${item.label}${item.note ? ` | ${item.note}` : ''}`),
      '',
    ].join('\n');
    if (!answer.startsWith('핵심 근거:')) {
      answer = `${evidenceHeader}${answer}`;
    }
  }

  return {
    answer,
    provider: useSnapshotAnswer ? 'snapshot' : result.provider,
    model: useSnapshotAnswer ? 'deterministic-snapshot' : result.model,
    cached: useSnapshotAnswer ? false : result.cached,
    contextChars,
    truncated,
    evidence,
    mode: profile.mode,
    quality,
    evidenceFirst: true,
  };
}

function buildEvidenceCandidates(snapshot: DataQASnapshot): EvidenceCandidate[] {
  const candidates: EvidenceCandidate[] = [];
  let seq = 1;
  const nextId = (prefix: string): string => `${prefix}-${seq++}`;

  const pushCandidate = (
    type: DataQAEvidenceType,
    label: string,
    url: string,
    aliases: string[],
    note?: string,
    timestamp?: string | null,
  ): void => {
    if (!label || !url || !isValidHttpUrl(url)) return;
    candidates.push({
      id: nextId(type),
      type,
      label: cleanText(label, 260),
      url,
      aliases: aliases.map(alias => cleanText(alias, 140)).filter(Boolean),
      note: note ? cleanText(note, 180) : undefined,
      timestamp: timestamp ?? null,
    });
  };

  for (const news of snapshot.allNews.slice(0, 260)) {
    pushCandidate(
      'news',
      `[${news.source}] ${news.title}`,
      news.link,
      [news.source, news.title, news.location || '', news.threat || ''],
      news.time ? `Published ${news.time}` : undefined,
      news.time,
    );
  }

  for (const cluster of snapshot.clusters.slice(0, 160)) {
    if (!cluster.link) continue;
    pushCandidate(
      'cluster',
      `[Cluster] ${cluster.title}`,
      cluster.link,
      [cluster.title, cluster.source, cluster.threat || '', ...cluster.evidence],
      cluster.lastUpdated ? `Updated ${cluster.lastUpdated}` : undefined,
      cluster.lastUpdated,
    );
  }

  for (const market of snapshot.markets.slice(0, 140)) {
    const symbolUrl = toYahooSymbolUrl(market.symbol);
    pushCandidate(
      'market',
      `[${market.symbol}] ${market.name}`,
      symbolUrl,
      [market.symbol, market.name, `${market.price ?? ''}`, `${market.change ?? ''}`],
      market.price !== null ? `Price ${market.price}` : undefined,
      null,
    );
  }

  for (const prediction of snapshot.predictions.slice(0, 120)) {
    if (!prediction.url) continue;
    pushCandidate(
      'prediction',
      `[Prediction] ${prediction.title}`,
      prediction.url,
      [prediction.title, `${prediction.yesPrice}`, `${prediction.volume ?? ''}`],
      `Yes ${prediction.yesPrice.toFixed(1)}%`,
      null,
    );
  }

  for (const outage of snapshot.intelligence.outages.slice(0, 60)) {
    const search = toSearchUrl(`${outage.title} ${outage.country} internet outage`);
    pushCandidate(
      'outage',
      `[Outage] ${outage.title}`,
      search,
      [outage.title, outage.country, outage.severity, ...outage.categories],
      `${outage.country} | ${outage.severity}`,
      outage.time,
    );
  }

  for (const protest of snapshot.intelligence.protests.slice(0, 60)) {
    const search = toSearchUrl(`${protest.title} ${protest.country} protest`);
    pushCandidate(
      'protest',
      `[Protest] ${protest.title}`,
      search,
      [protest.title, protest.country, protest.severity, protest.eventType],
      `${protest.country} | ${protest.severity}`,
      protest.time,
    );
  }

  for (const quake of snapshot.intelligence.earthquakes.slice(0, 50)) {
    const search = toSearchUrl(`${quake.place} earthquake magnitude ${quake.magnitude}`);
    pushCandidate(
      'earthquake',
      `[Earthquake] ${quake.place} M${quake.magnitude.toFixed(1)}`,
      search,
      [quake.place, `${quake.magnitude}`, `${quake.depth}`],
      quake.time ? `Occurred ${quake.time}` : undefined,
      quake.time,
    );
  }

  for (const flight of snapshot.intelligence.militaryFlights.slice(0, 50)) {
    const search = toSearchUrl(`${flight.callsign} ${flight.operatorCountry} military flight`);
    pushCandidate(
      'flight',
      `[Flight] ${flight.callsign} (${flight.operatorCountry})`,
      search,
      [flight.callsign, flight.type, flight.operatorCountry],
      `${flight.type} | ${flight.location}`,
      flight.lastSeen,
    );
  }

  for (const vessel of snapshot.intelligence.militaryVessels.slice(0, 50)) {
    const search = toSearchUrl(`${vessel.name} ${vessel.operatorCountry} vessel`);
    pushCandidate(
      'vessel',
      `[Vessel] ${vessel.name} (${vessel.operatorCountry})`,
      search,
      [vessel.name, vessel.type, vessel.operatorCountry],
      `${vessel.type} | ${vessel.location}`,
      vessel.lastAisUpdate,
    );
  }

  for (const finding of snapshot.multimodal.slice(0, 40)) {
    if (!isValidHttpUrl(finding.url)) continue;
    pushCandidate(
      'multimodal',
      `[Multimodal] ${finding.topic}`,
      finding.url,
      [finding.topic, finding.summary, ...finding.evidence],
      finding.capturedAt ? `Captured ${finding.capturedAt}` : undefined,
      finding.capturedAt,
    );
  }

  return candidates;
}

function scoreCandidate(
  candidate: EvidenceCandidate,
  combinedNorm: string,
  tokens: string[],
  profile?: QAQuestionProfile,
): number {
  if (!combinedNorm) return 0;
  const situational = questionNeedsSituationalOverview(combinedNorm);
  const hardNews = questionWantsHardNews(combinedNorm);
  const aliasNorm = candidate.aliases
    .map(alias => normalizeForMatch(alias))
    .filter(Boolean);
  if (aliasNorm.length === 0) return 0;

  const candidateNorm = normalizeForMatch([candidate.label, ...candidate.aliases].join(' '));
  if (profile?.regionTerms.length && !matchesRegionProfile(candidateNorm, profile)) return 0;
  if (!questionAllowsSports(combinedNorm) && isSportsNoiseText(candidateNorm)) return 0;
  if (hardNews && isLifestyleNoiseText(candidateNorm)) return 0;
  const signalScore = hardNewsSignalScore(candidateNorm);
  if (situational && hardNews && (candidate.type === 'news' || candidate.type === 'cluster') && signalScore <= 0) {
    return 0;
  }
  if (profile?.regionTerms.length && situational && candidate.type === 'news' && signalScore === 0) {
    return 0;
  }
  if (profile?.regionTerms.length && situational && (candidate.type === 'news' || candidate.type === 'cluster')) {
    if (isRoutineInstitutionalText(candidateNorm) && signalScore < 4) return 0;
  }

  let score = 0;
  const marketQuestionSignal = keywordSignalScore(combinedNorm, MARKET_SIGNAL_HINTS);
  const shippingQuestionSignal = keywordSignalScore(combinedNorm, SHIPPING_SIGNAL_HINTS);
  const candidateMarketSignal = keywordSignalScore(candidateNorm, MARKET_SIGNAL_HINTS);
  const candidateShippingSignal = keywordSignalScore(candidateNorm, SHIPPING_SIGNAL_HINTS);

  for (const alias of aliasNorm) {
    if (alias.length < 2) continue;
    if (combinedNorm.includes(alias)) {
      score += Math.min(34, Math.max(8, Math.round(alias.length * 0.8)));
    }
  }

  for (const token of tokens) {
    if (token.length < 3) continue;
    if (candidateNorm.includes(token)) score += 2;
  }

  if (situational) {
    score += signalScore * (candidate.type === 'cluster' ? 2 : 3);
  }

  if (candidate.type === 'market' && /[A-Z]{1,5}(?:[-.=][A-Z0-9]{1,6})?/.test(candidate.label)) {
    score += 3;
  }

  if (marketQuestionSignal > 0) {
    if (candidate.type === 'market') score += 18;
    if (candidate.type === 'prediction') score += 10;
    score += candidateMarketSignal * 7;
    score += candidateShippingSignal * 8;

    if (
      (candidate.type === 'news' || candidate.type === 'cluster')
      && candidateMarketSignal === 0
      && candidateShippingSignal === 0
      && signalScore < 6
    ) {
      return 0;
    }
  }

  if (shippingQuestionSignal > 0 && candidate.type === 'news' && candidateShippingSignal > 0) {
    score += 6;
  }

  if (candidate.timestamp) {
    const ts = new Date(candidate.timestamp).getTime();
    if (Number.isFinite(ts)) {
      const ageHrs = (Date.now() - ts) / (1000 * 60 * 60);
      if (ageHrs <= 24) score += 4;
      else if (ageHrs <= 72) score += 2;
    }
  }

  return score;
}

function rankEvidenceLinks(
  question: string,
  answer: string,
  snapshot: DataQASnapshot,
  profile: QAQuestionProfile,
  allowedEvidenceIds?: Set<string>,
): DataQAEvidenceLink[] {
  const candidates = buildEvidenceCandidates(snapshot);
  if (candidates.length === 0) return [];

  const combinedNorm = normalizeForMatch(`${question}\n${answer}`);
  const tokens = buildQuestionTokens(`${question} ${answer}`, profile);

  const scored = candidates
    .map(candidate => ({
      candidate,
      score: scoreCandidate(candidate, combinedNorm, tokens, profile),
    }))
    .filter(entry => !allowedEvidenceIds || allowedEvidenceIds.has(entry.candidate.id.toLowerCase()))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const selected: DataQAEvidenceLink[] = [];
  const seenUrl = new Set<string>();

  const append = (entry: { candidate: EvidenceCandidate; score: number }): void => {
    if (selected.length >= MAX_EVIDENCE_RESULTS) return;
    if (seenUrl.has(entry.candidate.url)) return;
    seenUrl.add(entry.candidate.url);
    selected.push({
      id: entry.candidate.id,
      type: entry.candidate.type,
      label: entry.candidate.label,
      url: entry.candidate.url,
      note: entry.candidate.note,
      score: entry.score,
    });
  };

  for (const entry of scored) append(entry);

  if (selected.length === 0) {
    for (const candidate of candidates) {
      if (selected.length >= Math.min(4, MAX_EVIDENCE_RESULTS)) break;
      if (candidate.type !== 'news' && candidate.type !== 'cluster') continue;
      if (seenUrl.has(candidate.url)) continue;
      seenUrl.add(candidate.url);
      selected.push({
        id: candidate.id,
        type: candidate.type,
        label: candidate.label,
        url: candidate.url,
        note: candidate.note,
        score: 1,
      });
    }
  }

  return selected;
}

function rankEvidenceForQuestion(
  question: string,
  snapshot: DataQASnapshot,
  profile: QAQuestionProfile,
  limit = MAX_EVIDENCE_HINTS,
): DataQAEvidenceLink[] {
  const candidates = buildEvidenceCandidates(snapshot);
  if (candidates.length === 0) return [];

  const combinedNorm = normalizeForMatch(question);
  const tokens = buildQuestionTokens(question, profile);
  const situational = questionNeedsSituationalOverview(question);
  const selected: DataQAEvidenceLink[] = [];
  const seenUrl = new Set<string>();
  const candidateByUrl = new Map<string, EvidenceCandidate>();
  for (const candidate of candidates) {
    candidateByUrl.set(candidate.url, candidate);
  }

  const appendCandidate = (candidate: EvidenceCandidate, score: number): void => {
    if (selected.length >= limit) return;
    if (!candidate.url || seenUrl.has(candidate.url)) return;
    seenUrl.add(candidate.url);
    selected.push({
      id: candidate.id,
      type: candidate.type,
      label: candidate.label,
      url: candidate.url,
      note: candidate.note,
      score,
    });
  };

  if (situational) {
    const topNews = rankNewsForQuestion(
      filterNewsForQuestion(snapshot.allNews, profile, question),
      profile,
      question,
    ).slice(0, 8);
    for (const news of topNews) {
      const candidate = candidateByUrl.get(news.link);
      if (!candidate) continue;
      appendCandidate(candidate, 10_000 - selected.length);
    }

    const topClusters = rankClustersForQuestion(
      filterClustersForQuestion(snapshot.clusters, profile, question),
      profile,
      question,
    ).slice(0, 4);
    for (const cluster of topClusters) {
      const candidate = candidateByUrl.get(cluster.link);
      if (!candidate) continue;
      appendCandidate(candidate, 9_000 - selected.length);
    }
  }

  const scored = candidates
    .map(candidate => ({
      candidate,
      score: scoreCandidate(candidate, combinedNorm, tokens, profile),
    }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const entry of scored) {
    appendCandidate(entry.candidate, entry.score);
    if (selected.length >= limit) break;
  }

  return selected;
}

function isBrokenAnswer(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  const urls = (trimmed.match(/https?:\/\//gi) ?? []).length;
  const lines = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const firstLine = lines[0]?.toLowerCase() ?? '';
  const letterMatches = trimmed.match(/[A-Za-z0-9\uAC00-\uD7A3]/g) ?? [];
  const punctuationMatches = trimmed.match(/[^\sA-Za-z0-9\uAC00-\uD7A3]/g) ?? [];
  const looksLikeBrokenGlyphs = /["'`.,;:!?()[\]{}\-]{6,}/.test(trimmed);
  const noAlnum = letterMatches.length === 0;
  const punctuationHeavy = punctuationMatches.length > letterMatches.length * 1.2;

  if (urls >= 3 && urls * 5 >= Math.max(1, letterMatches.length / 2)) return true;
  if (/^(sources?|references?|links?)\s*[:\-]/.test(firstLine)) return true;
  if (lines.length <= 3 && lines.every(line => /^https?:\/\//i.test(line))) return true;
  if (noAlnum || punctuationHeavy || looksLikeBrokenGlyphs) return true;

  return false;
}

function stripEvidencePreface(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('핵심 근거:')) return trimmed;

  const lines = trimmed.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? '';
    if (index === 0 && line === '핵심 근거:') {
      index += 1;
      continue;
    }
    if (!line) {
      index += 1;
      if (index > 1) break;
      continue;
    }
    if (
      /^-\s/.test(line)
      || /^근거:?$/u.test(line)
      || /^\[?EVID/i.test(line)
      || /(?:Published|Price|Volume|Confidence)\b/i.test(line)
    ) {
      index += 1;
      continue;
    }
    break;
  }

  const body = lines.slice(index).join('\n').trim();
  return body || trimmed;
}

function countSubstantiveAnswerLines(text: string): number {
  const body = stripEvidencePreface(text)
    .replace(/\[EVID:[^\]]+\]/gi, ' ')
    .trim();
  if (!body) return 0;

  return body
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter((line) => (
      line.length >= 26
      || /^[0-9]+\./.test(line)
      || /^-\s/.test(line)
      || /[.!?다요]\s*$/u.test(line)
    ))
    .length;
}

function questionRequestsStructuredOverview(question: string, profile?: QAQuestionProfile): boolean {
  if (profile?.regionKey) return true;
  const normalized = normalizeForMatch(question);
  return /\b(by region|region by region|country by country|overview|summary|brief|situation|status|outlook)\b/.test(normalized)
    || /(지역별|국가별|대륙별|5줄|다섯 줄|요약|브리핑|상황|정세|현황|전망)/.test(question);
}

function answerLooksMetaWithoutSubstance(text: string): boolean {
  const normalized = normalizeForMatch(stripEvidencePreface(text));
  return /\b(core signal|editorial agenda|analysis demand itself|most important request|structural risk|high uncertainty|narrower question)\b/.test(normalized)
    || /(핵심 스토리|중심 신호|분석 수요 자체|가장 중요한 요청|구조적 리스크|불확실성이 높|더 좁혀서 질문)/.test(text);
}

function isConciseGroundedModelAnswer(
  text: string,
  question: string,
  citationIds: string[],
  provider?: SummarizationProvider,
): boolean {
  if (provider !== 'codex' && provider !== 'ollama') return false;

  const trimmed = text.trim();
  const body = stripEvidencePreface(trimmed)
    .replace(/\[EVID:[^\]]+\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const bodyWords = body.split(/\s+/).filter(Boolean).length;
  const substantiveLines = countSubstantiveAnswerLines(trimmed);

  if (bodyWords < 16) return false;
  if (substantiveLines < 1) return false;
  if (citationIds.length === 0) return false;
  if (answerLooksMetaWithoutSubstance(trimmed)) return false;

  const bodyNorm = normalizeForMatch(body);
  const queryTokens = tokenize(question)
    .filter(token => !/^(what|when|where|with|from|that|this|there|their|about|current|latest|today|risk|analysis|summary|situation|status|overview|market|news|data|report|global|regional|effect|impact)$/.test(token))
    .slice(0, 12);
  const overlap = queryTokens.filter(token => containsNormalizedTerm(bodyNorm, token)).length;

  if (questionNeedsSituationalOverview(question) && bodyWords < 22 && overlap === 0 && citationIds.length < 2) {
    return false;
  }

  return overlap >= 1 || citationIds.length >= 2;
}

function isLowSignalAnalyticalAnswer(
  text: string,
  requireEvidence = false,
  allowedEvidenceIds?: Set<string>,
  question = '',
  profile?: QAQuestionProfile,
  truncated = false,
  provider?: SummarizationProvider,
): boolean {
  if (isBrokenAnswer(text)) return true;

  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  if (words < 24) return true;
  if (/\[EVID:line-\d+\]/i.test(trimmed)) return true;

  const matches = Array.from(trimmed.matchAll(/\[EVID:([^\]]+)\]/gi));
  const citationIds = matches.map(match => String(match[1] || '').trim()).filter(Boolean);

  if (requireEvidence && citationIds.length === 0) return true;
  if (citationIds.some(id => !/^(news|cluster|market|prediction|outage|protest|earthquake|flight|vessel|multimodal)-\d+$/i.test(id))) {
    return true;
  }
  if (allowedEvidenceIds && citationIds.length > 0) {
    const unknown = citationIds.some(id => !allowedEvidenceIds.has(id.toLowerCase()));
    if (unknown) return true;
  }

  const body = stripEvidencePreface(trimmed)
    .replace(/\[EVID:[^\]]+\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const bodyWords = body.split(/\s+/).filter(Boolean).length;
  const substantiveLines = countSubstantiveAnswerLines(trimmed);

  if (isConciseGroundedModelAnswer(trimmed, question, citationIds, provider)) return false;

  if (bodyWords < 30) return true;
  if (truncated && bodyWords < 120) return true;
  if (trimmed.startsWith('핵심 근거:') && bodyWords < 70) return true;
  if (questionNeedsSituationalOverview(question) && substantiveLines < 2) return true;
  if (questionRequestsStructuredOverview(question, profile) && substantiveLines < 3) return true;
  if (answerLooksMetaWithoutSubstance(trimmed) && substantiveLines < 3) return true;

  return false;
}
function buildDeterministicFallbackAnswer(
  question: string,
  snapshot: DataQASnapshot,
  profile: QAQuestionProfile,
  evidenceHints: DataQAEvidenceLink[] = [],
): string {
  const lines: string[] = [];

  const topNews = rankNewsForQuestion(
    filterNewsForQuestion(snapshot.allNews, profile, question),
    profile,
    question,
  ).slice(0, 4);

  const topClusters = rankClustersForQuestion(
    filterClustersForQuestion(snapshot.clusters, profile, question),
    profile,
    question,
  ).slice(0, 3);

  const markets = [...snapshot.markets]
    .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0))
    .slice(0, 3);

  if (profile.regionKey && topNews.length === 0 && topClusters.length === 0) {
    lines.push(`현재 로드된 스냅샷 기준으로는 ${profile.regionLabel ?? '해당 지역'} 관련 직접 신호가 충분히 많지 않습니다.`);
    lines.push(`즉, 지금은 ${profile.regionLabel ?? '이 지역'} 전체 상황을 강하게 단정하기보다 coverage 공백을 전제로 보수적으로 해석하는 편이 맞습니다.`);
  } else {
    const regionalRiskLeaders = getRegionalInstabilityLeaders(profile);
    if (profile.regionLabel && regionalRiskLeaders.length > 0) {
      const riskLine = regionalRiskLeaders
        .map(item => `${item.name} ${item.score}(${item.trend === 'rising' ? '상승' : item.trend === 'falling' ? '완화' : '유지'})`)
        .join(', ');
      lines.push(`현재 ${profile.regionLabel} 내부 위험도 상위권은 ${riskLine} 순입니다.`);
    }
    const leadClauses = topNews
      .slice(0, 3)
      .map((news) => {
        const where = news.location ? `${news.location}에서는` : `${news.source} 기준으로는`;
        return `${where} ${news.title}`;
      });

    if (profile.regionLabel) {
      if (leadClauses.length > 0) {
        lines.push(`현재 ${profile.regionLabel}는 한 가지 단일 이슈보다 ${leadClauses.join(', ')} 같은 복수의 축으로 움직이고 있습니다.`);
      } else {
        lines.push(`현재 ${profile.regionLabel}는 직접 확인된 뉴스 신호가 제한적이어서 지역 전체 흐름을 좁게 읽어야 합니다.`);
      }
    } else if (leadClauses.length > 0) {
      lines.push(`현재 전체 스냅샷에서 가장 눈에 띄는 흐름은 ${leadClauses.join(', ')} 입니다.`);
    }

    if (topClusters.length > 0) {
      const clusterSummary = topClusters
        .slice(0, 2)
        .map(cluster => `${cluster.title}(${cluster.sourceCount}개 출처, ${cluster.threat ?? 'na'})`)
        .join(', ');
      lines.push(`클러스터 기준으로는 ${clusterSummary} 이 상대적으로 밀도가 높습니다.`);
    }

    const alertCount = topNews.filter(news => news.threat === 'high' || news.threat === 'critical').length
      + topClusters.filter(cluster => cluster.threat === 'high' || cluster.threat === 'critical').length;
    if (alertCount >= 2) {
      lines.push('단기적으로는 경보성 이슈 비중이 높아 변동성과 경계 심리가 유지될 가능성이 큽니다.');
    } else if (topNews.length > 0 || topClusters.length > 0) {
      lines.push('즉시 폭발형 리스크보다 개별 사건이 누적되면서 불안정성이 서서히 올라가는 흐름에 더 가깝습니다.');
    }
  }

  if (!profile.regionKey && markets.length > 0) {
    const marketLine = markets
      .map(market => `${market.symbol} ${market.change == null ? 'na' : `${market.change.toFixed(2)}%`}`)
      .join(', ');
    lines.push(`시장 측면에서는 ${marketLine} 순으로 변동성이 크게 잡힙니다.`);
  }

  if (evidenceHints.length > 0) {
    lines.push('근거:');
    for (const item of evidenceHints.slice(0, 3)) {
      lines.push(`- [EVID:${item.id}] ${item.label}`);
    }
  }

  lines.push('원하면 여기서 국가별, 안보/정치/경제 축별로 더 좁혀서 바로 이어서 분석할 수 있습니다.');
  return lines.join('\n');
}

export function buildDataQASnapshot(ctx: AppContext): DataQASnapshot {
  const enabledLayers = Object.entries(ctx.mapLayers)
    .filter(([, enabled]) => enabled)
    .map(([layer]) => layer);

  const allNews = ctx.allNews
    .slice(0, MAX_NEWS_ITEMS)
    .map(normalizeNews);

  const newsByCategory = Object.entries(ctx.newsByCategory).map(([category, items]) => ({
    category,
    total: items.length,
    items: items.slice(0, MAX_NEWS_PER_CATEGORY).map(normalizeNews),
  }));

  const clusters = ctx.latestClusters.slice(0, MAX_CLUSTERS).map(cluster => ({
    id: cluster.id,
    title: cleanText(cluster.primaryTitle, 280),
    source: cleanText(cluster.primarySource, 80),
    link: cleanText(cluster.primaryLink, 260),
    sourceCount: cluster.sourceCount,
    firstSeen: toIso(cluster.firstSeen),
    lastUpdated: toIso(cluster.lastUpdated),
    isAlert: cluster.isAlert,
    threat: cluster.threat?.level ?? null,
    relationScore: cluster.relations?.confidenceScore ?? null,
    evidence: (cluster.relations?.evidence ?? []).slice(0, 8).map(e => cleanText(e, 160)),
  }));

  const markets = ctx.latestMarkets.slice(0, MAX_MARKETS).map(market => ({
    symbol: cleanText(market.symbol, 40),
    name: cleanText(market.name, 120),
    price: market.price,
    change: market.change,
  }));

  const predictions = ctx.latestPredictions.slice(0, MAX_PREDICTIONS).map(prediction => ({
    title: cleanText(prediction.title, 220),
    yesPrice: prediction.yesPrice,
    volume: typeof prediction.volume === 'number' ? prediction.volume : null,
    url: cleanText(prediction.url || '', 260),
  }));

  const outages = (ctx.intelligenceCache.outages ?? []).slice(0, MAX_INTEL_ITEMS).map(outage => ({
    title: cleanText(outage.title, 220),
    country: cleanText(outage.country, 80),
    severity: outage.severity,
    time: toIso(outage.pubDate),
    categories: outage.categories.slice(0, 8).map(category => cleanText(category, 60)),
    location: `${outage.lat.toFixed(2)},${outage.lon.toFixed(2)}`,
  }));

  const protests = (ctx.intelligenceCache.protests?.events ?? []).slice(0, MAX_INTEL_ITEMS).map(protest => ({
    title: cleanText(protest.title, 220),
    country: cleanText(protest.country, 80),
    severity: protest.severity,
    eventType: protest.eventType,
    time: toIso(protest.time),
    confidence: protest.confidence,
  }));

  const earthquakes = (ctx.intelligenceCache.earthquakes ?? []).slice(0, MAX_INTEL_ITEMS).map(earthquake => ({
    place: cleanText(earthquake.place, 180),
    magnitude: earthquake.magnitude,
    depth: earthquake.depthKm,
    time: toIso(earthquake.occurredAt),
  }));

  const flights = (ctx.intelligenceCache.military?.flights ?? []).slice(0, MAX_INTEL_ITEMS).map(flight => ({
    callsign: cleanText(flight.callsign, 40),
    type: flight.aircraftType,
    operatorCountry: cleanText(flight.operatorCountry, 80),
    speed: flight.speed,
    altitude: flight.altitude,
    lastSeen: toIso(flight.lastSeen),
    location: `${flight.lat.toFixed(2)},${flight.lon.toFixed(2)}`,
  }));

  const vessels = (ctx.intelligenceCache.military?.vessels ?? []).slice(0, MAX_INTEL_ITEMS).map(vessel => ({
    name: cleanText(vessel.name, 80),
    type: vessel.vesselType,
    operatorCountry: cleanText(vessel.operatorCountry, 80),
    speed: vessel.speed,
    lastAisUpdate: toIso(vessel.lastAisUpdate),
    dark: Boolean(vessel.isDark),
    location: `${vessel.lat.toFixed(2)},${vessel.lon.toFixed(2)}`,
  }));

  const monitors = ctx.monitors.map(monitor => ({
    id: monitor.id,
    name: cleanText(monitor.name || monitor.keywords.join(', '), 160),
    keywords: monitor.keywords.slice(0, 20).map(keyword => cleanText(keyword, 40)),
    lat: typeof monitor.lat === 'number' ? monitor.lat : null,
    lon: typeof monitor.lon === 'number' ? monitor.lon : null,
  }));

  const usniFleet = ctx.intelligenceCache.usniFleet
    ? {
      articleTitle: cleanText(ctx.intelligenceCache.usniFleet.articleTitle, 220),
      articleDate: cleanText(ctx.intelligenceCache.usniFleet.articleDate, 80),
      vessels: ctx.intelligenceCache.usniFleet.vessels.length,
      strikeGroups: ctx.intelligenceCache.usniFleet.strikeGroups.length,
      regions: ctx.intelligenceCache.usniFleet.regions.slice(0, 20).map(region => cleanText(region, 80)),
    }
    : null;

  return {
    generatedAt: new Date().toISOString(),
    variant: SITE_VARIANT,
    language: getCurrentLanguage(),
    timeRange: ctx.currentTimeRange,
    enabledLayers,
    counts: {
      news: ctx.allNews.length,
      clusters: ctx.latestClusters.length,
      markets: ctx.latestMarkets.length,
      predictions: ctx.latestPredictions.length,
      protests: ctx.intelligenceCache.protests?.events.length ?? 0,
      outages: ctx.intelligenceCache.outages?.length ?? 0,
      flights: ctx.intelligenceCache.military?.flights.length ?? 0,
      vessels: ctx.intelligenceCache.military?.vessels.length ?? 0,
      earthquakes: ctx.intelligenceCache.earthquakes?.length ?? 0,
      monitors: ctx.monitors.length,
    },
    monitors,
    newsByCategory,
    allNews,
    clusters,
    markets,
    predictions,
    intelligence: {
      outages,
      protests,
      earthquakes,
      militaryFlights: flights,
      militaryVessels: vessels,
      usniFleet,
    },
    keywordGraph: {
      generatedAt: ctx.intelligenceCache.keywordGraph?.generatedAt ?? null,
      nodes: (ctx.intelligenceCache.keywordGraph?.nodes ?? [])
        .slice(0, 80)
        .map(node => ({
          term: cleanText(node.term, 80),
          domain: cleanText(node.domain, 40),
          status: cleanText(node.status, 20),
          score: Number(node.score) || 0,
        })),
      edges: (ctx.intelligenceCache.keywordGraph?.edges ?? [])
        .slice(0, 120)
        .map(edge => ({
          source: cleanText(edge.source, 80),
          target: cleanText(edge.target, 80),
          weight: Number(edge.weight) || 0,
        })),
    },
    graphRag: {
      generatedAt: ctx.intelligenceCache.graphRagSummary?.generatedAt ?? null,
      globalThemes: (ctx.intelligenceCache.graphRagSummary?.globalThemes ?? [])
        .slice(0, 24)
        .map(theme => cleanText(theme, 60)),
      hierarchyLines: (ctx.intelligenceCache.graphRagSummary?.hierarchyLines ?? [])
        .slice(0, 24)
        .map(line => cleanText(line, 320)),
    },
    ontologyGraph: {
      generatedAt: ctx.intelligenceCache.ontologyGraph?.generatedAt ?? null,
      nodes: ctx.intelligenceCache.ontologyGraph?.nodes.length ?? 0,
      edges: ctx.intelligenceCache.ontologyGraph?.edges.length ?? 0,
      events: ctx.intelligenceCache.ontologyGraph?.eventNodes.length ?? 0,
      inferred: ctx.intelligenceCache.ontologyGraph?.inferredEdges.length ?? 0,
      violations: ctx.intelligenceCache.ontologyGraph?.violations.length ?? 0,
    },
    multimodal: (ctx.intelligenceCache.multimodalFindings ?? [])
      .slice(0, 40)
      .map(finding => ({
        topic: cleanText(finding.topic, 80),
        url: finding.url,
        summary: cleanText(finding.summary, 320),
        capturedAt: toIso(finding.capturedAt),
        evidence: (finding.evidence || []).slice(0, 8).map(entry => cleanText(entry, 120)),
      })),
    sourceCredibility: (ctx.intelligenceCache.sourceCredibility ?? [])
      .slice(0, 24)
      .map(profile => ({
        source: cleanText(profile.source, 80),
        credibilityScore: profile.credibilityScore,
        corroborationScore: profile.corroborationScore,
        feedHealthScore: profile.feedHealthScore,
        propagandaRiskScore: profile.propagandaRiskScore,
        notes: (profile.notes || []).slice(0, 4).map(note => cleanText(note, 120)),
      })),
    transmissions: (ctx.intelligenceCache.eventMarketTransmission?.edges ?? [])
      .slice(0, 24)
      .map(edge => ({
        eventTitle: cleanText(edge.eventTitle, 180),
        marketSymbol: cleanText(edge.marketSymbol, 30),
        relationType: cleanText(edge.relationType, 30),
        strength: edge.strength,
        reason: cleanText(edge.reason, 180),
      })),
    reports: (ctx.intelligenceCache.scheduledReports ?? [])
      .slice(0, 8)
      .map(report => ({
        title: cleanText(report.title, 140),
        generatedAt: report.generatedAt,
        summary: cleanText(report.summary, 320),
        rebuttalSummary: report.rebuttalSummary ? cleanText(report.rebuttalSummary, 220) : null,
        consensusMode: report.consensusMode ?? null,
      })),
    multiHop: (ctx.intelligenceCache.multiHopInferences ?? [])
      .slice(0, 16)
      .map(alert => ({
        title: cleanText(alert.title, 180),
        severity: cleanText(alert.severity, 20),
        category: cleanText(alert.category, 40),
        confidence: alert.confidence,
        summary: cleanText(alert.summary, 260),
        chain: (alert.chain || []).slice(0, 6).map(item => cleanText(item, 80)),
      })),
    ontology: (ctx.intelligenceCache.ontologyEntities ?? [])
      .slice(0, 20)
      .map(entity => ({
        canonicalName: cleanText(entity.canonicalName, 100),
        confidence: entity.confidence,
        source: entity.source,
        externalRefs: (entity.externalRefs || []).slice(0, 4).map(ref => cleanText(`${ref.system}:${ref.id}`, 90)),
      })),
  };
}

export async function askQuestionOverSnapshot(
  question: string,
  snapshot: DataQASnapshot,
): Promise<DataQAAnswer | null> {
  const prepared = buildPreparedQuestionContext(question, snapshot);
  if (!prepared) return null;
  if (prepared.profile.mode === 'analytical') {
    const codexFocusLines = buildCodexFocusLines(prepared);
    const result = await tryLocalOllamaChat(
      prepared.cleanQuestion,
      prepared.headlines,
      prepared.geoContext,
      {
        timeoutMs: 22_000,
        maxLines: 1800,
      },
    ) ?? await tryLocalCodexChat(
      prepared.cleanQuestion,
      codexFocusLines,
      prepared.geoContext,
      prepared.lang,
      {
        mode: 'analysis',
        timeoutMs: 42_000,
        maxLines: 80,
      },
    );
    return buildFinalAnswer(prepared, result, true);
  }
  return buildFinalAnswer(prepared, null, true);
}

export async function refineQuestionOverSnapshotWithCodex(
  question: string,
  snapshot: DataQASnapshot,
): Promise<DataQAAnswer | null> {
  const prepared = buildPreparedQuestionContext(question, snapshot);
  if (!prepared || prepared.profile.mode === 'casual') return null;
  const codexFocusLines = buildCodexFocusLines(prepared);

  const result = await tryLocalOllamaChat(
    prepared.cleanQuestion,
    prepared.headlines,
    prepared.geoContext,
    {
      timeoutMs: 28_000,
      maxLines: 2200,
    },
  ) ?? await tryLocalCodexChat(
    prepared.cleanQuestion,
    codexFocusLines,
    prepared.geoContext,
    prepared.lang,
    {
      mode: 'chat',
      timeoutMs: 45_000,
      maxLines: 60,
    },
  );

  return buildFinalAnswer(prepared, result, false);
}




