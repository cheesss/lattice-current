import type { Feed } from '@/types';
import { rssProxyUrl } from '@/utils';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import {
  resolveCanonicalEntity,
  resolveCanonicalEntityFast,
  type CanonicalEntityType,
} from './entity-ontology';
import { logSourceOpsEvent } from './source-ops-log';
import { nameToCountryCode } from './country-geometry';

export type KeywordStatus = 'draft' | 'active' | 'retired';
export type KeywordIngress = 'manual' | 'llm' | 'market' | 'playwright';
export type KeywordDomain = 'tech' | 'defense' | 'energy' | 'bio' | 'macro' | 'supply-chain' | 'mixed';

export interface KeywordRecord {
  id: string;
  term: string;
  canonicalId: string;
  canonicalName: string;
  entityType: CanonicalEntityType;
  entityConfidence: number;
  entitySource: 'local' | 'wikidata' | 'heuristic';
  domain: KeywordDomain;
  aliases: string[];
  lang: string;
  weight: number;
  confidence: number;
  status: KeywordStatus;
  lastSeen: number | null;
  decayScore: number;
  repeatCount: number;
  sourceTierScore: number;
  marketRelevanceScore: number;
  qualityScore: number;
  sourceCounts: Record<KeywordIngress, number>;
  relatedTerms: Record<string, number>;
  createdAt: number;
  updatedAt: number;
}

export interface KeywordCandidateInput {
  term: string;
  domain?: KeywordDomain;
  aliases?: string[];
  lang?: string;
  weight?: number;
  confidence?: number;
  sourceTier?: number;
  marketRelevance?: number;
  ingress?: KeywordIngress;
  relatedTerms?: string[];
}

export type TemporalRelationType =
  | 'cooccurrence'
  | 'supply_chain'
  | 'sanction'
  | 'cooperation'
  | 'conflict'
  | 'capital_flow'
  | 'tech_transfer'
  | 'owned_by'
  | 'inferred_sanction'
  | 'signal';

export interface TemporalRelationObservation {
  sourceTerm: string;
  targetTerm: string;
  relationType?: TemporalRelationType;
  weight?: number;
  evidence?: string;
  observedAt?: number;
}

export interface KeywordGraphNode {
  id: string;
  term: string;
  canonicalId?: string;
  canonicalName?: string;
  entityType?: CanonicalEntityType;
  entityConfidence?: number;
  entitySource?: 'local' | 'wikidata' | 'heuristic';
  domain: KeywordDomain;
  status: KeywordStatus;
  score: number;
  weight: number;
  lastSeen: number | null;
}

export interface KeywordGraphEdge {
  source: string;
  target: string;
  weight: number;
  relationType?: TemporalRelationType;
  validFrom?: string;
  validUntil?: string | null;
  active?: boolean;
  evidence?: string[];
  sourceCanonicalId?: string;
  targetCanonicalId?: string;
}

export interface OntologyConstraintViolation {
  id: string;
  createdAt: string;
  sourceTerm: string;
  sourceCanonicalId: string;
  sourceEntityType: CanonicalEntityType;
  targetTerm: string;
  targetCanonicalId: string;
  targetEntityType: CanonicalEntityType;
  relationType: TemporalRelationType;
  reason: string;
  evidence?: string;
}

export interface KeywordGraphSnapshot {
  generatedAt: string;
  nodes: KeywordGraphNode[];
  edges: KeywordGraphEdge[];
}

interface PersistedKeywordRegistry {
  keywords: KeywordRecord[];
  temporalEdges?: TemporalKeywordEdgeRecord[];
  ontologyViolations?: OntologyConstraintViolation[];
}

interface TemporalKeywordEdgeRecord {
  id: string;
  sourceTerm: string;
  targetTerm: string;
  sourceCanonicalId: string;
  targetCanonicalId: string;
  relationType: TemporalRelationType;
  weight: number;
  observationCount: number;
  validFrom: number;
  validUntil: number | null;
  lastObservedAt: number;
  active: boolean;
  evidence: string[];
  createdAt: number;
  updatedAt: number;
}

const KEYWORD_REGISTRY_KEY = 'keyword-registry:v1';
const MAX_KEYWORDS = 2400;
const MAX_TEMPORAL_EDGES = 6000;
const MAX_ONTOLOGY_VIOLATIONS = 1200;
const ACTIVE_KEYWORD_TOP_N = 180;
const RETIRE_AFTER_MS = 45 * 24 * 60 * 60 * 1000;
const DECAY_STEP = 12;
const EDGE_STALE_MS = 21 * 24 * 60 * 60 * 1000;
const EDGE_SOFT_DECAY_MS = 5 * 24 * 60 * 60 * 1000;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'will', 'have', 'has', 'been', 'were', 'are',
  'about', 'after', 'under', 'over', 'between', 'amid', 'across', 'global', 'update', 'report', 'new', 'news',
  'analysis', 'official', 'statement', 'board', 'session', 'today', 'yesterday', 'tomorrow',
  'say', 'says', 'said', 'talk', 'talks', 'price', 'prices', 'live', 'breaking', 'watch', 'call', 'calls',
  'warn', 'warns', 'latest', 'claim', 'claims',
]);

const GENERIC_KEYWORD_TOKENS = new Set([
  'say', 'says', 'said', 'talk', 'talks', 'price', 'prices', 'live', 'breaking', 'watch', 'call', 'calls',
  'warn', 'warns', 'latest', 'claim', 'claims', 'update', 'updates', 'report', 'reports', 'news',
  'official', 'officials', 'president', 'minister', 'leaders', 'leader', 'threaten', 'threatens', 'threatened',
  'escalate', 'escalates', 'escalated', 'surpass', 'surpasses', 'surged', 'surges', 'soar', 'soars', 'spike',
  'spikes', 'rise', 'rises', 'rising', 'fall', 'falls', 'falling', 'drop', 'drops', 'halt', 'halts',
  'mixed', 'some', 'many', 'several', 'few', 'off', 'give', 'gives', 'gave', 'giving', 'waive', 'waives', 'waived',
  'ahead', 'behind', 'very', 'less', 'more', 'money', 'step', 'steps', 'down', 'people', 'messages',
  'first', 'hour', 'hours', 'potential', 'best', 'tail', 'tails', 'cognitive', 'used', 'use', 'uses', 'using',
  'wildly', 'over', 'under', 'above', 'below', 'around', 'about', 'after', 'before', 'during', 'can', 'could',
  'would', 'should', 'may', 'might', 'still', 'already', 'just', 'only', 'really', 'nearly', 'nears',
  'system', 'systems', 'barrel', 'barrels', 'swing', 'swings', 'reuters',
  'wants', 'want', 'wanted', 'fresh', 'targeted', 'target', 'targets', 'asked', 'asks', 'asking',
  'access', 'sends', 'send', 'transport', 'route', 'routes', 'enters', 'enter', 'week', 'weeks',
  'photos', 'photo', 'images', 'when',
]);

const LOW_SIGNAL_KEYWORD_PATTERNS = [
  /\b(live updates?|what we know|analysis demand|editorial agenda)\b/i,
  /\b(money off|gives mixed|give mixed|mixed signals?)\b/i,
  /\b(step down|radical left|french radical(?: left)?|talk war and|war and)\b/i,
  /\b(potential energy(?: arxiv)?|hours war|first hours war|strike over(?: \d+)?|openai news|chatgpt openai news|llms can unmask|best-of-tails)\b/i,
  /\b(war but(?: says)?|talk war|used claude strike|claude strike(?: over)?|wildly iran war)\b/i,
  /\b(wants bolster|bolster security|fresh strikes|transport routes|has access|photos appear|when asked)\b/i,
  /^(wants|bolster|fresh|targeted|access|transport|routes|photos|when|asked|strikes)$/i,
  /^(trump|biden|netanyahu|putin|xi|zelensky|khamenei|modi|macron)(?:\s+\w+){0,3}$/i,
];

const WEAK_CONTEXT_TOKENS = new Set([
  'first', 'hour', 'hours', 'potential', 'best', 'tail', 'tails', 'cognitive', 'used', 'use', 'uses', 'using',
  'wildly', 'over', 'under', 'above', 'below', 'around', 'about', 'after', 'before', 'during', 'can', 'could',
  'would', 'should', 'may', 'might', 'still', 'already', 'just', 'only', 'really', 'nearly', 'nears',
  'wants', 'want', 'fresh', 'targeted', 'asked', 'access', 'sends', 'send', 'transport', 'route', 'routes',
  'photos', 'photo', 'when', 'week', 'weeks',
]);

const REGION_KEYWORD_TERMS = new Set([
  'africa', 'europe', 'asia', 'middle east', 'latin america', 'south america', 'north america', 'southeast asia',
  'east asia', 'central asia', 'sub-saharan africa', 'west africa', 'east africa', 'north africa',
]);

const DOMAIN_SIGNAL_TOKEN_RE =
  /(drone|missile|war|sanction|military|naval|defense|strike|nuclear|ceasefire|hostage|protest|riot|election|coup|rebel|insurgent|militia|refugee|aid|border|oil|gas|lng|power|grid|energy|battery|uranium|solar|wind|drought|famine|outbreak|epidemic|cholera|mpox|ai|semiconductor|chip|robot|quantum|llm|model|cloud|compute|vaccine|biotech|genome|drug|clinical|biopharma|inflation|yield|bond|equity|fx|gdp|rates|macro|shipping|freight|port|chokepoint|logistics|container|export|tariff|supply|pipeline|cable|satellite)/;

const SIGNAL_KEYWORD_TOKENS = new Set([
  'drone', 'missile', 'war', 'sanction', 'military', 'naval', 'defense', 'strike', 'nuclear', 'oil', 'gas',
  'lng', 'power', 'grid', 'energy', 'battery', 'uranium', 'solar', 'wind', 'ai', 'semiconductor', 'chip',
  'robot', 'quantum', 'llm', 'model', 'cloud', 'compute', 'vaccine', 'biotech', 'genome', 'drug', 'clinical',
  'biopharma', 'inflation', 'yield', 'bond', 'equity', 'fx', 'gdp', 'rates', 'macro', 'shipping', 'freight',
  'port', 'chokepoint', 'logistics', 'container', 'export', 'tariff', 'supply', 'pipeline', 'cable', 'satellite',
  'ceasefire', 'hostage', 'protest', 'riot', 'election', 'coup', 'rebel', 'insurgent', 'militia', 'refugee',
  'aid', 'border', 'drought', 'famine', 'outbreak', 'epidemic', 'cholera', 'mpox',
  'crude',
]);

const QUERY_SUFFIXES = [
  'supply chain',
  'export control',
  'funding',
  'policy',
];

interface RelationConstraintDefinition {
  directed: boolean;
  domain: CanonicalEntityType[];
  range: CanonicalEntityType[];
}

const ONTOLOGY_RELATION_CONSTRAINTS: Record<TemporalRelationType, RelationConstraintDefinition> = {
  cooccurrence: {
    directed: false,
    domain: ['country', 'company', 'technology', 'commodity', 'waterway', 'organization', 'person', 'location', 'asset', 'event', 'unknown'],
    range: ['country', 'company', 'technology', 'commodity', 'waterway', 'organization', 'person', 'location', 'asset', 'event', 'unknown'],
  },
  signal: {
    directed: true,
    domain: ['country', 'company', 'technology', 'commodity', 'waterway', 'organization', 'person', 'location', 'asset', 'event', 'unknown'],
    range: ['country', 'company', 'technology', 'commodity', 'waterway', 'organization', 'person', 'location', 'asset', 'event', 'unknown'],
  },
  supply_chain: {
    directed: true,
    domain: ['country', 'company', 'commodity', 'technology', 'waterway', 'organization', 'asset'],
    range: ['country', 'company', 'commodity', 'technology', 'waterway', 'organization', 'asset'],
  },
  sanction: {
    directed: true,
    domain: ['country', 'organization'],
    range: ['country', 'company', 'person', 'organization', 'asset'],
  },
  inferred_sanction: {
    directed: true,
    domain: ['country', 'organization'],
    range: ['country', 'company', 'person', 'organization', 'asset'],
  },
  cooperation: {
    directed: false,
    domain: ['country', 'company', 'organization', 'person', 'technology'],
    range: ['country', 'company', 'organization', 'person', 'technology'],
  },
  conflict: {
    directed: false,
    domain: ['country', 'organization', 'person', 'asset'],
    range: ['country', 'organization', 'person', 'asset', 'waterway', 'location'],
  },
  capital_flow: {
    directed: true,
    domain: ['country', 'company', 'organization', 'person'],
    range: ['company', 'organization', 'technology', 'commodity', 'asset'],
  },
  tech_transfer: {
    directed: true,
    domain: ['country', 'company', 'organization', 'technology'],
    range: ['country', 'company', 'organization', 'technology'],
  },
  owned_by: {
    directed: true,
    domain: ['company', 'organization', 'asset'],
    range: ['company', 'organization'],
  },
};

const KEYWORD_CATEGORY_DOMAIN: Record<string, KeywordDomain[]> = {
  politics: ['defense', 'macro', 'mixed'],
  crisis: ['defense', 'energy', 'mixed'],
  finance: ['macro', 'energy', 'tech'],
  tech: ['tech', 'bio'],
  'supply-chain': ['supply-chain', 'energy', 'macro'],
};

let loaded = false;
const keywordMap = new Map<string, KeywordRecord>();
const temporalEdgeMap = new Map<string, TemporalKeywordEdgeRecord>();
const ontologyViolationMap = new Map<string, OntologyConstraintViolation>();

function nowMs(): number {
  return Date.now();
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeTerm(raw: string): string {
  return normalizeSpaces(String(raw || ''))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_/+.]/gu, '')
    .slice(0, 120);
}

function normalizeAlias(raw: string): string {
  return normalizeSpaces(String(raw || '')).slice(0, 120);
}

function clamp01To100(value: number, fallback = 50): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function tierToScore(sourceTier: number | undefined): number {
  if (!Number.isFinite(sourceTier)) return 55;
  const tier = Math.max(1, Math.min(4, Math.round(Number(sourceTier))));
  if (tier === 1) return 95;
  if (tier === 2) return 80;
  if (tier === 3) return 62;
  return 42;
}

function inferDomain(term: string): KeywordDomain {
  const value = normalizeTerm(term);
  if (/(drone|missile|war|sanction|military|naval|defense|strike|nuclear)/.test(value)) return 'defense';
  if (/(oil|gas|lng|power|grid|energy|battery|uranium|solar|wind)/.test(value)) return 'energy';
  if (/(ai|semiconductor|chip|robot|quantum|llm|model|cloud|compute)/.test(value)) return 'tech';
  if (/(vaccine|biotech|genome|drug|clinical|biopharma)/.test(value)) return 'bio';
  if (/(inflation|yield|bond|equity|fx|gdp|rates|macro)/.test(value)) return 'macro';
  if (/(shipping|freight|port|chokepoint|logistics|container)/.test(value)) return 'supply-chain';
  return 'mixed';
}

function isDirectionalRelationType(relationType: TemporalRelationType): boolean {
  return ONTOLOGY_RELATION_CONSTRAINTS[relationType]?.directed ?? false;
}

function hasDomainSignalToken(term: string): boolean {
  return DOMAIN_SIGNAL_TOKEN_RE.test(normalizeTerm(term));
}

function countSignalKeywordTokens(tokens: string[]): number {
  return tokens.filter(token => SIGNAL_KEYWORD_TOKENS.has(token)).length;
}

function isCountryLikeKeyword(term: string): boolean {
  const normalized = normalizeTerm(term);
  return !!nameToCountryCode(normalized) || REGION_KEYWORD_TERMS.has(normalized);
}

function shouldKeepExtractedKeyword(term: string): boolean {
  const normalized = normalizeTerm(term);
  if (!normalized || isLowSignalKeywordTerm(normalized)) return false;
  const tokens = normalized.split(' ').filter(Boolean);
  const weakOrGenericCount = tokens.filter(token => GENERIC_KEYWORD_TOKENS.has(token) || WEAK_CONTEXT_TOKENS.has(token)).length;
  if (hasDomainSignalToken(normalized)) {
    if (weakOrGenericCount >= Math.max(1, tokens.length - 1) && !isCountryLikeKeyword(normalized)) return false;
    return true;
  }
  if (isCountryLikeKeyword(normalized)) return true;
  return false;
}

export function isLowSignalKeywordTerm(term: string): boolean {
  const normalized = normalizeTerm(term);
  if (!normalized) return true;
  if (LOW_SIGNAL_KEYWORD_PATTERNS.some(pattern => pattern.test(normalized))) {
    return true;
  }

  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length === 1) return GENERIC_KEYWORD_TOKENS.has(tokens[0]!);

  const nonGeneric = tokens.filter(token => !GENERIC_KEYWORD_TOKENS.has(token));
  if (nonGeneric.length === 0) return true;
  const signalTokenCount = countSignalKeywordTokens(tokens);
  const weakContextCount = tokens.filter(token => WEAK_CONTEXT_TOKENS.has(token)).length;
  const firstToken = tokens[0] || '';
  const lastToken = tokens[tokens.length - 1] || '';
  const edgeGeneric = GENERIC_KEYWORD_TOKENS.has(firstToken) || GENERIC_KEYWORD_TOKENS.has(lastToken)
    || STOPWORDS.has(firstToken) || STOPWORDS.has(lastToken);

  if (edgeGeneric && !isCountryLikeKeyword(normalized)) return true;
  if (weakContextCount >= Math.max(1, tokens.length - 1) && !isCountryLikeKeyword(normalized)) return true;
  if (signalTokenCount === 0 && tokens.length >= 3 && nonGeneric.length <= 2) return true;
  if (signalTokenCount === 1) {
    const contextTokens = tokens.filter(token => !SIGNAL_KEYWORD_TOKENS.has(token) && !GENERIC_KEYWORD_TOKENS.has(token) && !STOPWORDS.has(token));
    if (contextTokens.length === 0) return true;
    if (contextTokens.every(token => WEAK_CONTEXT_TOKENS.has(token))) return true;
    if (tokens.length >= 3 && contextTokens.length <= 1 && !isCountryLikeKeyword(normalized)) return true;
  }

  const domain = inferDomain(normalized);
  if (domain !== 'mixed' && !(signalTokenCount <= 1 && nonGeneric.length <= 2 && tokens.length > 2 && tokens.some(token => GENERIC_KEYWORD_TOKENS.has(token)))) {
    return false;
  }

  const genericCount = tokens.length - nonGeneric.length;
  if (genericCount <= 0) return false;
  if (nonGeneric.length <= 1) return true;
  if (tokens.length > 6 && signalTokenCount === 0) return true;
  if (signalTokenCount === 1 && nonGeneric.length === 1 && tokens.length <= 4) return true;
  if (signalTokenCount <= 1 && nonGeneric.length <= 2) return true;
  if ((GENERIC_KEYWORD_TOKENS.has(tokens[0]!) || GENERIC_KEYWORD_TOKENS.has(tokens[tokens.length - 1]!)) && nonGeneric.length <= 2) {
    return true;
  }
  return false;
}

function inferRelationTypeFromEvidence(evidence?: string): TemporalRelationType {
  const text = normalizeTerm(evidence || '');
  if (/(owned by|subsidiary|subsidiaries|parent company|wholly owned|majority-owned|affiliate of|holding company)/.test(text)) return 'owned_by';
  if (/(sanction|embargo|export control|ban|restriction)/.test(text)) return 'sanction';
  if (/(war|strike|conflict|attack|missile|drone|hostility)/.test(text)) return 'conflict';
  if (/(funding|investment|capital|ipo|valuation|financing)/.test(text)) return 'capital_flow';
  if (/(tech transfer|license|ip|chip|semiconductor|model release)/.test(text)) return 'tech_transfer';
  if (/(shipping|port|freight|chokepoint|logistics|supply)/.test(text)) return 'supply_chain';
  if (/(deal|cooperate|partnership|alliance|agreement)/.test(text)) return 'cooperation';
  return 'cooccurrence';
}

function keywordId(term: string, domain: KeywordDomain, lang: string): string {
  return `${normalizeTerm(term)}::${domain}::${(lang || 'en').toLowerCase()}`;
}

function edgeId(
  sourceCanonicalId: string,
  targetCanonicalId: string,
  relationType: TemporalRelationType,
): string {
  if (isDirectionalRelationType(relationType)) {
    return `${sourceCanonicalId}=>${targetCanonicalId}::${relationType}`;
  }
  const left = sourceCanonicalId < targetCanonicalId ? sourceCanonicalId : targetCanonicalId;
  const right = sourceCanonicalId < targetCanonicalId ? targetCanonicalId : sourceCanonicalId;
  return `${left}::${right}::${relationType}`;
}

function makeViolationId(input: {
  sourceCanonicalId: string;
  targetCanonicalId: string;
  relationType: TemporalRelationType;
  sourceEntityType: CanonicalEntityType;
  targetEntityType: CanonicalEntityType;
}): string {
  return [
    input.sourceCanonicalId,
    input.targetCanonicalId,
    input.relationType,
    input.sourceEntityType,
    input.targetEntityType,
  ].join('::').slice(0, 320);
}

function validateRelationConstraint(input: {
  source: KeywordRecord;
  target: KeywordRecord;
  relationType: TemporalRelationType;
}): { valid: true } | { valid: false; reason: string } {
  const definition = ONTOLOGY_RELATION_CONSTRAINTS[input.relationType];
  if (!definition) return { valid: true };
  if (!definition.domain.includes(input.source.entityType)) {
    return {
      valid: false,
      reason: `${input.relationType} domain rejects ${input.source.entityType}`,
    };
  }
  if (!definition.range.includes(input.target.entityType)) {
    return {
      valid: false,
      reason: `${input.relationType} range rejects ${input.target.entityType}`,
    };
  }
  return { valid: true };
}

function recencyScore(lastSeen: number | null): number {
  if (!lastSeen) return 0;
  const ageMs = nowMs() - lastSeen;
  if (ageMs < 24 * 60 * 60 * 1000) return 100;
  if (ageMs < 3 * 24 * 60 * 60 * 1000) return 82;
  if (ageMs < 7 * 24 * 60 * 60 * 1000) return 64;
  if (ageMs < 14 * 24 * 60 * 60 * 1000) return 46;
  if (ageMs < 30 * 24 * 60 * 60 * 1000) return 30;
  return 12;
}

function repeatScore(repeatCount: number): number {
  if (!Number.isFinite(repeatCount) || repeatCount <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(Math.log2(repeatCount + 1) * 18)));
}

function computeQuality(record: KeywordRecord): number {
  const recency = recencyScore(record.lastSeen);
  const repeat = repeatScore(record.repeatCount);
  const confidence = clamp01To100(record.confidence, 50);
  const total = (
    (record.sourceTierScore * 0.22) +
    (record.marketRelevanceScore * 0.2) +
    (repeat * 0.22) +
    (recency * 0.2) +
    (confidence * 0.16)
  );
  const decayed = total - (record.decayScore * 0.18);
  return Math.max(0, Math.min(100, Math.round(decayed)));
}

function buildDomainCounts(records: KeywordRecord[]): Map<KeywordDomain, number> {
  const counts = new Map<KeywordDomain, number>();
  for (const record of records) {
    counts.set(record.domain, (counts.get(record.domain) || 0) + 1);
  }
  return counts;
}

function domainBalanceBonus(domain: KeywordDomain, counts: Map<KeywordDomain, number>, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const represented = Math.max(1, counts.size);
  const idealShare = 1 / represented;
  const currentShare = (counts.get(domain) || 0) / total;
  return Math.round((idealShare - currentShare) * 18);
}

function mergeAliases(a: string[], b: string[]): string[] {
  const set = new Set<string>();
  for (const raw of [...a, ...b]) {
    const alias = normalizeAlias(raw);
    if (!alias) continue;
    set.add(alias);
    if (set.size >= 12) break;
  }
  return Array.from(set);
}

function maybeTransitionStatus(record: KeywordRecord): void {
  if (record.decayScore >= 95) {
    record.status = 'retired';
    return;
  }
  if (record.qualityScore >= 90) {
    record.status = 'active';
    return;
  }
  if (record.status === 'active' && record.qualityScore < 42) {
    record.status = 'draft';
    return;
  }
  if (record.status === 'retired' && record.qualityScore >= 76) {
    record.status = 'draft';
  }
}

function upsertTemporalEdge(input: {
  source: KeywordRecord;
  target: KeywordRecord;
  relationType?: TemporalRelationType;
  weight?: number;
  evidence?: string;
  observedAt?: number;
}): void {
  if (input.source.id === input.target.id) return;
  const relationType = input.relationType || inferRelationTypeFromEvidence(input.evidence);
  const constraint = validateRelationConstraint({
    source: input.source,
    target: input.target,
    relationType,
  });
  if (!constraint.valid) {
    const violation: OntologyConstraintViolation = {
      id: makeViolationId({
        sourceCanonicalId: input.source.canonicalId,
        targetCanonicalId: input.target.canonicalId,
        relationType,
        sourceEntityType: input.source.entityType,
        targetEntityType: input.target.entityType,
      }),
      createdAt: new Date().toISOString(),
      sourceTerm: input.source.term,
      sourceCanonicalId: input.source.canonicalId,
      sourceEntityType: input.source.entityType,
      targetTerm: input.target.term,
      targetCanonicalId: input.target.canonicalId,
      targetEntityType: input.target.entityType,
      relationType,
      reason: constraint.reason,
      evidence: input.evidence ? normalizeAlias(input.evidence) : undefined,
    };
    ontologyViolationMap.set(violation.id, violation);
    void logSourceOpsEvent({
      kind: 'ontology',
      action: 'constraint-rejected',
      actor: 'system',
      title: `${input.source.term} -> ${input.target.term}`,
      detail: constraint.reason,
      status: relationType,
      tags: [input.source.entityType, input.target.entityType],
    });
    return;
  }
  const observedAt = Number.isFinite(input.observedAt) ? Number(input.observedAt) : nowMs();
  const id = edgeId(input.source.canonicalId, input.target.canonicalId, relationType);
  const existing = temporalEdgeMap.get(id);
  const baseWeight = Math.max(1, Math.min(25, Math.round(Number(input.weight) || 1)));

  if (existing) {
    existing.weight = Math.max(1, Math.min(2000, existing.weight + baseWeight));
    existing.observationCount += 1;
    existing.lastObservedAt = observedAt;
    existing.updatedAt = nowMs();
    existing.active = true;
    existing.validUntil = null;
    if (input.evidence) {
      const evidence = normalizeAlias(input.evidence);
      if (evidence) {
        existing.evidence = [evidence, ...existing.evidence.filter(item => item !== evidence)].slice(0, 8);
      }
    }
    temporalEdgeMap.set(id, existing);
    return;
  }

  const directional = isDirectionalRelationType(relationType);
  const sourceTerm = directional
    ? input.source.term
    : (input.source.term < input.target.term ? input.source.term : input.target.term);
  const targetTerm = directional
    ? input.target.term
    : (input.source.term < input.target.term ? input.target.term : input.source.term);
  const sourceCanonicalId = directional
    ? input.source.canonicalId
    : (input.source.term < input.target.term ? input.source.canonicalId : input.target.canonicalId);
  const targetCanonicalId = directional
    ? input.target.canonicalId
    : (input.source.term < input.target.term ? input.target.canonicalId : input.source.canonicalId);
  const evidence = input.evidence ? [normalizeAlias(input.evidence)].filter(Boolean) : [];

  temporalEdgeMap.set(id, {
    id,
    sourceTerm,
    targetTerm,
    sourceCanonicalId,
    targetCanonicalId,
    relationType,
    weight: baseWeight,
    observationCount: 1,
    validFrom: observedAt,
    validUntil: null,
    lastObservedAt: observedAt,
    active: true,
    evidence,
    createdAt: nowMs(),
    updatedAt: nowMs(),
  });
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const cached = await getPersistentCache<PersistedKeywordRegistry>(KEYWORD_REGISTRY_KEY);
    for (const item of cached?.data?.keywords ?? []) {
      const canonicalName = item.canonicalName || item.term;
      keywordMap.set(item.id, {
        ...item,
        canonicalId: item.canonicalId || item.id,
        canonicalName,
        entityType: item.entityType || 'unknown',
        entityConfidence: Number.isFinite(item.entityConfidence) ? item.entityConfidence : 50,
        entitySource: item.entitySource || 'heuristic',
      });
    }
    for (const edge of cached?.data?.temporalEdges ?? []) {
      temporalEdgeMap.set(edge.id, edge);
    }
    for (const violation of cached?.data?.ontologyViolations ?? []) {
      ontologyViolationMap.set(violation.id, violation);
    }
  } catch (error) {
    console.warn('[keyword-registry] failed to load cache', error);
  }
}

async function persist(): Promise<void> {
  const all = Array.from(keywordMap.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_KEYWORDS);
  const temporalEdges = Array.from(temporalEdgeMap.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_TEMPORAL_EDGES);
  const ontologyViolations = Array.from(ontologyViolationMap.values())
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_ONTOLOGY_VIOLATIONS);

  keywordMap.clear();
  for (const item of all) keywordMap.set(item.id, item);
  temporalEdgeMap.clear();
  for (const edge of temporalEdges) temporalEdgeMap.set(edge.id, edge);
  ontologyViolationMap.clear();
  for (const violation of ontologyViolations) ontologyViolationMap.set(violation.id, violation);

  await setPersistentCache(KEYWORD_REGISTRY_KEY, { keywords: all, temporalEdges, ontologyViolations });
}

async function updateRecordFromCandidate(record: KeywordRecord, input: KeywordCandidateInput): Promise<void> {
  const ts = nowMs();
  const canonical = await resolveCanonicalEntityFast(input.term, input.aliases || []);
  const incomingConfidence = clamp01To100(Number(input.confidence), record.confidence || 55);
  const incomingTierScore = tierToScore(input.sourceTier);
  const incomingMarketScore = clamp01To100(Number(input.marketRelevance), record.marketRelevanceScore || 40);

  const prevRepeats = Math.max(1, record.repeatCount);
  record.repeatCount += 1;
  record.lastSeen = ts;
  record.updatedAt = ts;
  record.weight = Math.max(0.1, Math.min(5, Number(input.weight) || record.weight || 1));
  record.aliases = mergeAliases(record.aliases, input.aliases || []);
  record.canonicalId = canonical.id || record.canonicalId;
  record.canonicalName = canonical.canonicalName || record.canonicalName;
  record.entityType = canonical.entityType || record.entityType;
  record.entityConfidence = Math.max(record.entityConfidence, canonical.confidence);
  record.entitySource = canonical.source || record.entitySource;
  record.confidence = Math.round(((record.confidence * prevRepeats) + incomingConfidence) / (prevRepeats + 1));
  record.sourceTierScore = Math.round(((record.sourceTierScore * prevRepeats) + incomingTierScore) / (prevRepeats + 1));
  record.marketRelevanceScore = Math.round(((record.marketRelevanceScore * prevRepeats) + incomingMarketScore) / (prevRepeats + 1));
  record.decayScore = Math.max(0, record.decayScore - 14);

  const ingress = input.ingress || 'manual';
  record.sourceCounts[ingress] = (record.sourceCounts[ingress] || 0) + 1;

  for (const rawRelated of input.relatedTerms || []) {
    const related = normalizeTerm(rawRelated);
    if (!related || related === record.term) continue;
    const current = record.relatedTerms[related] || 0;
    record.relatedTerms[related] = Math.min(999, current + 1);
  }

  record.qualityScore = computeQuality(record);
  maybeTransitionStatus(record);
}

async function createRecordFromCandidate(input: KeywordCandidateInput): Promise<KeywordRecord | null> {
  const term = normalizeTerm(input.term);
  if (!term || term.length < 3 || STOPWORDS.has(term) || isLowSignalKeywordTerm(term)) return null;
  const canonical = await resolveCanonicalEntityFast(term, input.aliases || []);
  const domain = input.domain || inferDomain(term);
  const lang = (input.lang || 'en').toLowerCase().slice(0, 8);
  const ts = nowMs();
  const ingress = input.ingress || 'manual';
  const record: KeywordRecord = {
    id: keywordId(term, domain, lang),
    term,
    canonicalId: canonical.id,
    canonicalName: canonical.canonicalName || term,
    entityType: canonical.entityType,
    entityConfidence: canonical.confidence,
    entitySource: canonical.source,
    domain,
    aliases: mergeAliases([], input.aliases || []),
    lang,
    weight: Math.max(0.1, Math.min(5, Number(input.weight) || 1)),
    confidence: clamp01To100(Number(input.confidence), 56),
    status: 'draft',
    lastSeen: ts,
    decayScore: 0,
    repeatCount: 1,
    sourceTierScore: tierToScore(input.sourceTier),
    marketRelevanceScore: clamp01To100(Number(input.marketRelevance), 40),
    qualityScore: 0,
    sourceCounts: {
      manual: 0,
      llm: 0,
      market: 0,
      playwright: 0,
    },
    relatedTerms: {},
    createdAt: ts,
    updatedAt: ts,
  };
  record.sourceCounts[ingress] = 1;
  for (const related of input.relatedTerms || []) {
    const normalized = normalizeTerm(related);
    if (!normalized || normalized === record.term) continue;
    record.relatedTerms[normalized] = 1;
  }
  record.qualityScore = computeQuality(record);
  maybeTransitionStatus(record);
  return record;
}

async function upsertCandidateInMemory(input: KeywordCandidateInput): Promise<KeywordRecord | null> {
  const term = normalizeTerm(input.term);
  if (!term || term.length < 3 || STOPWORDS.has(term) || isLowSignalKeywordTerm(term)) return null;
  const domain = input.domain || inferDomain(term);
  const lang = (input.lang || 'en').toLowerCase().slice(0, 8);
  const id = keywordId(term, domain, lang);
  const existing = keywordMap.get(id);
  if (existing) {
    await updateRecordFromCandidate(existing, input);
    keywordMap.set(id, existing);
    return existing;
  }
  const created = await createRecordFromCandidate({ ...input, term, domain, lang });
  if (!created) return null;
  keywordMap.set(created.id, created);
  await logSourceOpsEvent({
    kind: 'keyword',
    action: 'discovered',
    actor: input.ingress || 'manual',
    title: created.term,
    detail: `${created.domain} keyword (${created.canonicalName})`,
    status: created.status,
    category: created.domain,
    tags: created.aliases.slice(0, 6),
  });
  return created;
}

async function ensureRelatedKeywordRecord(term: string, lang: string, domainHint: KeywordDomain = 'mixed'): Promise<KeywordRecord | null> {
  const normalized = normalizeTerm(term);
  if (!normalized || normalized.length < 3 || STOPWORDS.has(normalized) || isLowSignalKeywordTerm(normalized)) return null;

  const idCandidates = [
    keywordId(normalized, domainHint, lang),
    keywordId(normalized, inferDomain(normalized), lang),
  ];
  for (const id of idCandidates) {
    const existing = keywordMap.get(id);
    if (existing) return existing;
  }

  const created = await createRecordFromCandidate({
    term: normalized,
    domain: domainHint,
    lang,
    ingress: 'llm',
    confidence: 42,
    sourceTier: 3,
    marketRelevance: 30,
    weight: 0.8,
  });
  if (!created) return null;
  keywordMap.set(created.id, created);
  return created;
}

export async function upsertKeywordCandidate(input: KeywordCandidateInput): Promise<KeywordRecord | null> {
  await ensureLoaded();
  const record = await upsertCandidateInMemory(input);
  await persist();
  return record;
}

export async function upsertKeywordCandidates(inputs: KeywordCandidateInput[]): Promise<KeywordRecord[]> {
  await ensureLoaded();
  const upserted: KeywordRecord[] = [];
  for (const input of inputs) {
    const record = await upsertCandidateInMemory(input);
    if (record) {
      upserted.push(record);
      const relatedCandidates = (input.relatedTerms || [])
        .map(term => normalizeTerm(term))
        .filter(Boolean)
        .slice(0, 8);
      for (const relatedTerm of relatedCandidates) {
        const related = await ensureRelatedKeywordRecord(relatedTerm, record.lang, inferDomain(relatedTerm));
        if (!related) continue;
        upsertTemporalEdge({
          source: record,
          target: related,
          relationType: inferRelationTypeFromEvidence(`${record.term} ${related.term}`),
          weight: 1,
          evidence: `${record.term} -> ${related.term}`,
          observedAt: nowMs(),
        });
      }
    }
  }
  if (upserted.length > 0) {
    await persist();
  }
  return upserted;
}

export async function setKeywordStatus(id: string, status: KeywordStatus): Promise<KeywordRecord | null> {
  await ensureLoaded();
  const existing = keywordMap.get(id);
  if (!existing) return null;
  existing.status = status;
  existing.updatedAt = nowMs();
  if (status === 'retired') {
    existing.decayScore = Math.max(existing.decayScore, 92);
  }
  keywordMap.set(id, existing);
  await persist();
  await logSourceOpsEvent({
    kind: 'keyword',
    action: 'status-change',
    actor: 'manual',
    title: existing.term,
    detail: `Keyword -> ${status}`,
    status,
    category: existing.domain,
    tags: existing.aliases.slice(0, 6),
  });
  return existing;
}

export async function listKeywordRegistry(): Promise<KeywordRecord[]> {
  await ensureLoaded();
  return Array.from(keywordMap.values()).sort((a, b) => {
    if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
    return b.updatedAt - a.updatedAt;
  });
}

export async function reviewKeywordRegistryLifecycle(maxActive = ACTIVE_KEYWORD_TOP_N): Promise<void> {
  await ensureLoaded();
  const ts = nowMs();
  const purgeIds = new Set<string>();
  const purgeCanonicalIds = new Set<string>();
  const purgeTerms = new Set<string>();
  for (const record of keywordMap.values()) {
    if (isLowSignalKeywordTerm(record.term)) {
      purgeIds.add(record.id);
      purgeCanonicalIds.add(record.canonicalId);
      purgeTerms.add(record.term);
      continue;
    }

    const age = record.lastSeen ? ts - record.lastSeen : RETIRE_AFTER_MS + 1;
    if (age > 7 * 24 * 60 * 60 * 1000) {
      record.decayScore = Math.min(100, record.decayScore + DECAY_STEP);
    } else if (age < 2 * 24 * 60 * 60 * 1000) {
      record.decayScore = Math.max(0, record.decayScore - 8);
    }

    record.qualityScore = computeQuality(record);
    if (age > RETIRE_AFTER_MS && record.qualityScore < 55) {
      record.status = 'retired';
    } else {
      maybeTransitionStatus(record);
    }
    record.updatedAt = ts;
  }

  const active = Array.from(keywordMap.values())
    .filter(record => record.status === 'active')
  const activeDomainCounts = buildDomainCounts(active);
  const activeTotal = active.length;
  active.sort((a, b) => {
    const leftScore = (a.qualityScore * a.weight) + domainBalanceBonus(a.domain, activeDomainCounts, activeTotal);
    const rightScore = (b.qualityScore * b.weight) + domainBalanceBonus(b.domain, activeDomainCounts, activeTotal);
    if (rightScore !== leftScore) return rightScore - leftScore;
    return b.updatedAt - a.updatedAt;
  });
  for (let i = maxActive; i < active.length; i += 1) {
    active[i]!.status = 'draft';
    active[i]!.updatedAt = ts;
  }

  for (const edge of temporalEdgeMap.values()) {
    if (
      purgeCanonicalIds.has(edge.sourceCanonicalId)
      || purgeCanonicalIds.has(edge.targetCanonicalId)
      || purgeTerms.has(edge.sourceTerm)
      || purgeTerms.has(edge.targetTerm)
    ) {
      temporalEdgeMap.delete(edge.id);
      continue;
    }
    const age = ts - edge.lastObservedAt;
    if (age > EDGE_STALE_MS) {
      edge.active = false;
      edge.validUntil = edge.validUntil || edge.lastObservedAt;
      edge.updatedAt = ts;
      continue;
    }
    if (age > EDGE_SOFT_DECAY_MS) {
      edge.weight = Math.max(1, Math.round(edge.weight * 0.96));
      edge.updatedAt = ts;
    }
  }
  for (const id of purgeIds) {
    keywordMap.delete(id);
  }
  await persist();
}

export async function refreshKeywordCanonicalMappings(limit = 80): Promise<number> {
  await ensureLoaded();
  const targets = Array.from(keywordMap.values())
    .filter(record => record.status !== 'retired')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    })
    .slice(0, Math.max(1, Math.min(limit, 300)));

  let updated = 0;
  for (const record of targets) {
    try {
      const canonical = await resolveCanonicalEntity(record.term, record.aliases || []);
      const nextId = canonical.id || record.canonicalId;
      const nextName = canonical.canonicalName || record.canonicalName;
      const nextType = canonical.entityType || record.entityType;
      const nextConfidence = Math.max(record.entityConfidence, canonical.confidence || 0);
      const nextSource = canonical.source || record.entitySource;
      if (
        nextId !== record.canonicalId
        || nextName !== record.canonicalName
        || nextType !== record.entityType
        || nextConfidence !== record.entityConfidence
        || nextSource !== record.entitySource
      ) {
        record.canonicalId = nextId;
        record.canonicalName = nextName;
        record.entityType = nextType;
        record.entityConfidence = nextConfidence;
        record.entitySource = nextSource;
        record.updatedAt = nowMs();
        updated += 1;
      }
    } catch {
      // keep prior mapping on resolver failures
    }
  }
  if (updated > 0) await persist();
  return updated;
}

export async function observeTemporalKeywordRelations(observations: TemporalRelationObservation[]): Promise<number> {
  await ensureLoaded();
  let count = 0;
  for (const obs of observations) {
    const sourceTerm = normalizeTerm(obs.sourceTerm);
    const targetTerm = normalizeTerm(obs.targetTerm);
    if (!sourceTerm || !targetTerm || sourceTerm === targetTerm) continue;

    const source = await ensureRelatedKeywordRecord(sourceTerm, 'en', inferDomain(sourceTerm));
    const target = await ensureRelatedKeywordRecord(targetTerm, 'en', inferDomain(targetTerm));
    if (!source || !target) continue;

    upsertTemporalEdge({
      source,
      target,
      relationType: obs.relationType || inferRelationTypeFromEvidence(obs.evidence),
      weight: obs.weight ?? 1,
      evidence: obs.evidence,
      observedAt: obs.observedAt,
    });
    count += 1;
  }
  if (count > 0) await persist();
  return count;
}

export async function getAutonomousKeywordTopics(limit = 24): Promise<string[]> {
  await ensureLoaded();
  const ranked = Array.from(keywordMap.values())
    .filter(record => record.status !== 'retired');
  const rankedDomainCounts = buildDomainCounts(ranked);
  const rankedTotal = ranked.length;
  ranked.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      const leftScore = (a.qualityScore * a.weight) + domainBalanceBonus(a.domain, rankedDomainCounts, rankedTotal);
      const rightScore = (b.qualityScore * b.weight) + domainBalanceBonus(b.domain, rankedDomainCounts, rankedTotal);
      const scoreDelta = rightScore - leftScore;
      if (scoreDelta !== 0) return scoreDelta;
      return b.updatedAt - a.updatedAt;
    });

  const active = ranked.filter(record => record.status === 'active');
  const emergentDrafts = ranked.filter(record => record.status === 'draft' && record.qualityScore >= 48);
  const selected = (active.length > 0 ? [...active, ...emergentDrafts] : emergentDrafts)
    .slice(0, limit);
  return selected.map(record => record.term);
}

export async function getKeywordGraphSnapshot(limitNodes = 72, limitEdges = 140): Promise<KeywordGraphSnapshot> {
  await ensureLoaded();
  const nodes = Array.from(keywordMap.values())
    .filter(record => record.status !== 'retired')
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, limitNodes)
    .map<KeywordGraphNode>(record => ({
      id: record.id,
      term: record.term,
      canonicalId: record.canonicalId,
      canonicalName: record.canonicalName,
      entityType: record.entityType,
      entityConfidence: record.entityConfidence,
      entitySource: record.entitySource,
      domain: record.domain,
      status: record.status,
      score: record.qualityScore,
      weight: record.weight,
      lastSeen: record.lastSeen,
    }));

  const allowedTerms = new Set(nodes.map(node => node.term));
  const temporalEdges = Array.from(temporalEdgeMap.values())
    .filter(edge => allowedTerms.has(edge.sourceTerm) && allowedTerms.has(edge.targetTerm))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limitEdges)
    .map<KeywordGraphEdge>((edge) => ({
      source: edge.sourceTerm,
      target: edge.targetTerm,
      weight: edge.weight,
      relationType: edge.relationType,
      validFrom: new Date(edge.validFrom).toISOString(),
      validUntil: edge.validUntil ? new Date(edge.validUntil).toISOString() : null,
      active: edge.active,
      evidence: edge.evidence.slice(0, 4),
      sourceCanonicalId: edge.sourceCanonicalId,
      targetCanonicalId: edge.targetCanonicalId,
    }));

  const fallbackEdgeMap = new Map<string, KeywordGraphEdge>();
  if (temporalEdges.length < Math.min(18, limitEdges)) {
    for (const record of keywordMap.values()) {
      if (!allowedTerms.has(record.term)) continue;
      const source = record.term;
      for (const [target, count] of Object.entries(record.relatedTerms || {})) {
        if (!allowedTerms.has(target) || target === source) continue;
        const key = source < target ? `${source}::${target}` : `${target}::${source}`;
        const current = fallbackEdgeMap.get(key);
        if (current) {
          current.weight = Math.min(999, current.weight + count);
        } else {
          fallbackEdgeMap.set(key, {
            source: source < target ? source : target,
            target: source < target ? target : source,
            weight: Math.max(1, count),
            relationType: 'cooccurrence',
            active: true,
          });
        }
      }
    }
  }

  const edges = [...temporalEdges, ...Array.from(fallbackEdgeMap.values())]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limitEdges);

  return {
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
  };
}

function mapDomainToCategories(domain: KeywordDomain): string[] {
  const out: string[] = [];
  for (const [category, domains] of Object.entries(KEYWORD_CATEGORY_DOMAIN)) {
    if (domains.includes(domain)) out.push(category);
  }
  if (out.length === 0) out.push('politics');
  return out;
}

function buildGoogleNewsQueryFeed(query: string, lang: string): Feed {
  const q = normalizeSpaces(query).slice(0, 180);
  const gl = lang === 'ko' ? 'KR' : 'US';
  const hl = lang === 'ko' ? 'ko' : 'en-US';
  const ceid = lang === 'ko' ? 'KR:ko' : 'US:en';
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  return {
    name: `KW: ${q}`,
    url: rssProxyUrl(url),
    lang,
  };
}

export async function buildKeywordTemplateFeedsForCategory(
  category: string,
  options: { maxKeywords?: number; maxFeeds?: number; lang?: string } = {},
): Promise<Feed[]> {
  await ensureLoaded();
  const maxKeywords = Math.max(1, Math.min(40, options.maxKeywords ?? 12));
  const maxFeeds = Math.max(1, Math.min(120, options.maxFeeds ?? 24));
  const lang = (options.lang || 'en').toLowerCase();
  const categoryKey = (category || 'politics').toLowerCase();

  const matched = Array.from(keywordMap.values())
    .filter(record => record.status === 'active' && record.lang === lang)
    .filter(record => mapDomainToCategories(record.domain).includes(categoryKey))
    .sort((a, b) => (b.qualityScore * b.weight) - (a.qualityScore * a.weight))
    .slice(0, maxKeywords);

  const feeds: Feed[] = [];
  const seen = new Set<string>();
  for (const record of matched) {
    const bases = [record.term, ...record.aliases.slice(0, 2)];
    for (const base of bases) {
      const queries = [base, ...QUERY_SUFFIXES.map(suffix => `${base} ${suffix}`)];
      for (const query of queries) {
        const normalized = normalizeTerm(query);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        feeds.push(buildGoogleNewsQueryFeed(query, lang));
        if (feeds.length >= maxFeeds) return feeds;
      }
    }
  }
  return feeds;
}

export async function listTemporalKeywordEdges(limit = 400): Promise<Array<{
  id: string;
  sourceTerm: string;
  targetTerm: string;
  relationType: TemporalRelationType;
  weight: number;
  validFrom: string;
  validUntil: string | null;
  active: boolean;
  evidence: string[];
}>> {
  await ensureLoaded();
  return Array.from(temporalEdgeMap.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, limit))
    .map(edge => ({
      id: edge.id,
      sourceTerm: edge.sourceTerm,
      targetTerm: edge.targetTerm,
      relationType: edge.relationType,
      weight: edge.weight,
      validFrom: new Date(edge.validFrom).toISOString(),
      validUntil: edge.validUntil ? new Date(edge.validUntil).toISOString() : null,
      active: edge.active,
      evidence: edge.evidence.slice(0, 8),
    }));
}

export async function listOntologyConstraintViolations(limit = 240): Promise<OntologyConstraintViolation[]> {
  await ensureLoaded();
  return Array.from(ontologyViolationMap.values())
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, Math.max(1, limit));
}

export function extractKeywordCandidatesFromText(
  text: string,
  options: { domain?: KeywordDomain; lang?: string; ingress?: KeywordIngress } = {},
): KeywordCandidateInput[] {
  const normalizedText = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalizedText) return [];

  const ngrams = new Set<string>();
  const terms = normalizedText
    .split(/[^\p{L}\p{N}\-_/+.]+/u)
    .map(token => token.trim())
    .filter(token => token.length >= 3)
    .slice(0, 140);

  for (let i = 0; i < terms.length; i += 1) {
    const t1 = normalizeTerm(terms[i] || '');
    if (t1 && !STOPWORDS.has(t1) && t1.length >= 4) ngrams.add(t1);
    const t2 = normalizeTerm(`${terms[i] || ''} ${terms[i + 1] || ''}`);
    if (t2 && t2.split(' ').length === 2 && t2.length >= 7 && !STOPWORDS.has(t2)) ngrams.add(t2);
    const t3 = normalizeTerm(`${terms[i] || ''} ${terms[i + 1] || ''} ${terms[i + 2] || ''}`);
    if (t3 && t3.split(' ').length === 3 && t3.length >= 10 && !STOPWORDS.has(t3)) ngrams.add(t3);
    if (ngrams.size >= 36) break;
  }

  return Array.from(ngrams)
    .slice(0, 28)
    .filter(term => shouldKeepExtractedKeyword(term))
    .map((term) => ({
      term,
      domain: options.domain || inferDomain(term),
      lang: options.lang || 'en',
      ingress: options.ingress || 'llm',
      confidence: 58,
      weight: 1,
    }));
}
