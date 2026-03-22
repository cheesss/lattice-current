import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { canUseLocalAgentEndpoints } from './runtime';
import { logSourceOpsEvent } from './source-ops-log';
import { appendOntologyLedgerEvent } from './ontology-event-store';
import { nameToCountryCode } from './country-geometry';

export type CanonicalEntityType =
  | 'country'
  | 'company'
  | 'technology'
  | 'commodity'
  | 'waterway'
  | 'organization'
  | 'person'
  | 'location'
  | 'asset'
  | 'event'
  | 'unknown';

export interface CanonicalEntity {
  id: string;
  canonicalName: string;
  entityType: CanonicalEntityType;
  aliases: string[];
  confidence: number;
  source: 'local' | 'wikidata' | 'heuristic';
  aliasProvenance?: Array<{
    alias: string;
    source: 'local' | 'wikidata' | 'heuristic' | 'opensanctions-style';
  }>;
  externalRefs?: Array<{
    system: 'wikidata' | 'local' | 'opensanctions-style';
    id: string;
    label: string;
  }>;
}

interface PersistedOntology {
  entities: CanonicalEntity[];
}

const ONTOLOGY_CACHE_KEY = 'entity-ontology:v1';

const LOCAL_ENTITY_SETS: Array<{ id: string; canonicalName: string; entityType: CanonicalEntityType; aliases: string[] }> = [
  {
    id: 'Q30',
    canonicalName: 'United States',
    entityType: 'country',
    aliases: ['usa', 'us', 'u.s.', 'u.s', 'united states', 'united states of america', 'united states government'],
  },
  {
    id: 'Q794',
    canonicalName: 'Iran',
    entityType: 'country',
    aliases: ['iran', 'iranian', 'islamic republic of iran'],
  },
  {
    id: 'Q801',
    canonicalName: 'Israel',
    entityType: 'country',
    aliases: ['israel', 'israeli'],
  },
  {
    id: 'Q846',
    canonicalName: 'Qatar',
    entityType: 'country',
    aliases: ['qatar', 'qatarenergy', 'qatar energy', 'qatarenergy lng'],
  },
  {
    id: 'Q183',
    canonicalName: 'Germany',
    entityType: 'country',
    aliases: ['germany', 'deutschland'],
  },
  {
    id: 'Q145',
    canonicalName: 'United Kingdom',
    entityType: 'country',
    aliases: ['uk', 'u.k.', 'united kingdom', 'britain', 'great britain'],
  },
  {
    id: 'Q148',
    canonicalName: 'China',
    entityType: 'country',
    aliases: ['china', 'prc', 'people republic of china'],
  },
  {
    id: 'Q17',
    canonicalName: 'Japan',
    entityType: 'country',
    aliases: ['japan'],
  },
  {
    id: 'Q884',
    canonicalName: 'South Korea',
    entityType: 'country',
    aliases: ['south korea', 'korea', 'rok', 'republic of korea'],
  },
  {
    id: 'Q15180',
    canonicalName: 'Helium',
    entityType: 'commodity',
    aliases: ['helium', 'he'],
  },
  {
    id: 'Q48376',
    canonicalName: 'Urea',
    entityType: 'commodity',
    aliases: ['urea', 'carbamide'],
  },
  {
    id: 'Q2005',
    canonicalName: 'Strait of Hormuz',
    entityType: 'waterway',
    aliases: ['strait of hormuz', 'hormuz'],
  },
  {
    id: 'ORG:IAEA',
    canonicalName: 'IAEA',
    entityType: 'organization',
    aliases: ['iaea', 'international atomic energy agency'],
  },
];

let loaded = false;
const canonicalByAlias = new Map<string, CanonicalEntity>();
const canonicalById = new Map<string, CanonicalEntity>();

function normalizeAlias(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s.\-_/+]/gu, '')
    .slice(0, 140);
}

function nowId(raw: string): string {
  return `local:${normalizeAlias(raw).replace(/\s+/g, '_')}`;
}

export function inferCanonicalEntityType(term: string, aliases: string[] = []): CanonicalEntityType {
  const candidates = [term, ...aliases].map((value) => normalizeAlias(value)).filter(Boolean);
  if (candidates.some((value) => nameToCountryCode(value))) return 'country';
  if (candidates.some((value) => /\b(strait|gulf|canal|sea|ocean|bay|channel)\b/.test(value))) return 'waterway';
  if (candidates.some((value) => /\b(helium|urea|oil|gas|lng|ammonia|uranium|fertilizer|wheat|corn|copper|gold|silver)\b/.test(value))) return 'commodity';
  if (candidates.some((value) => /\b(ai|llm|quantum|semiconductor|chip|robot|drone|uav|satellite|battery|model|cloud|compute|biotech|genome|vaccine)\b/.test(value))) return 'technology';
  if (candidates.some((value) => /\b(inc|corp|corporation|company|co\.?|ltd|limited|plc|llc|holdings|group|technologies|energy|motors|airlines|labs|systems|ventures|capital|partners)\b/.test(value))) return 'company';
  if (candidates.some((value) => /\b(agency|ministry|government|administration|guard|forces|army|navy|military|department|council|commission|office|iaea|nato|un|eu|otx)\b/.test(value))) return 'organization';
  if (candidates.some((value) => /\b(port|terminal|refinery|pipeline|vessel|tanker|carrier|aircraft|frigate|destroyer|satcom|substation|datacenter)\b/.test(value))) return 'asset';

  const raw = String(term || '').trim();
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,2}$/.test(raw)) return 'person';
  if (/^[A-Z][A-Z0-9]{2,8}$/.test(raw)) return 'organization';
  return 'unknown';
}

function rebuildAliasIndex(): void {
  canonicalByAlias.clear();
  for (const entity of canonicalById.values()) {
    for (const alias of entity.aliases) {
      const key = normalizeAlias(alias);
      if (!key) continue;
      canonicalByAlias.set(key, entity);
    }
    const canonicalKey = normalizeAlias(entity.canonicalName);
    if (canonicalKey) canonicalByAlias.set(canonicalKey, entity);
  }
}

function addEntityToMaps(entity: CanonicalEntity): void {
  canonicalById.set(entity.id, entity);
  rebuildAliasIndex();
}

function buildOpenSanctionsStyleRef(canonicalName: string): NonNullable<CanonicalEntity['externalRefs']> {
  const clean = normalizeAlias(canonicalName);
  if (!clean) return [];
  return [{
    system: 'opensanctions-style',
    id: `entity:${clean.replace(/\s+/g, '-')}`,
    label: canonicalName,
  }];
}

function hydrateEntity(entity: CanonicalEntity): CanonicalEntity {
  const aliases = Array.from(new Set((entity.aliases || []).map((alias) => normalizeAlias(alias)).filter(Boolean))).slice(0, 24);
  return {
    ...entity,
    aliases,
    canonicalName: String(entity.canonicalName || '').trim() || 'unknown',
    confidence: Math.max(0, Math.min(100, Math.round(entity.confidence || 45))),
    entityType: entity.entityType || inferCanonicalEntityType(entity.canonicalName, aliases),
    aliasProvenance: (entity.aliasProvenance || [])
      .map((entry) => ({ alias: normalizeAlias(entry.alias), source: entry.source }))
      .filter((entry) => entry.alias)
      .slice(0, 24),
    externalRefs: (entity.externalRefs || []).slice(0, 12),
  };
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;

  for (const base of LOCAL_ENTITY_SETS) {
    addEntityToMaps(hydrateEntity({
      id: base.id,
      canonicalName: base.canonicalName,
      entityType: base.entityType,
      aliases: base.aliases,
      confidence: 94,
      source: 'local',
      aliasProvenance: base.aliases.map((alias) => ({ alias, source: 'local' as const })),
      externalRefs: [
        { system: 'wikidata', id: base.id, label: base.canonicalName },
        ...buildOpenSanctionsStyleRef(base.canonicalName),
      ],
    }));
  }

  try {
    const cached = await getPersistentCache<PersistedOntology>(ONTOLOGY_CACHE_KEY);
    for (const entity of cached?.data?.entities ?? []) {
      addEntityToMaps(hydrateEntity(entity));
    }
  } catch (error) {
    console.warn('[entity-ontology] load failed', error);
  }
}

async function persist(): Promise<void> {
  const entities = Array.from(canonicalById.values()).slice(0, 3000);
  await setPersistentCache(ONTOLOGY_CACHE_KEY, { entities });
}

function resolveLocalEntity(term: string, aliases: string[] = []): CanonicalEntity | null {
  const candidates = [term, ...aliases];
  for (const candidate of candidates) {
    const key = normalizeAlias(candidate);
    if (!key) continue;
    const found = canonicalByAlias.get(key);
    if (found) {
      return {
        ...found,
        confidence: Math.max(found.confidence, 88),
      };
    }
  }
  return null;
}

async function tryResolveViaWikidata(term: string): Promise<CanonicalEntity | null> {
  if (!canUseLocalAgentEndpoints()) return null;
  const query = String(term || '').trim();
  if (!query || query.length < 3) return null;
  try {
    const response = await fetch('/api/local-entity-resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: query }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as {
      ok?: boolean;
      id?: string;
      canonicalName?: string;
      aliases?: string[];
      confidence?: number;
      description?: string;
    };
    if (!payload.ok || !payload.id || !payload.canonicalName) return null;
    const aliases = (payload.aliases || []).slice(0, 20);
    return hydrateEntity({
      id: payload.id,
      canonicalName: payload.canonicalName,
      entityType: inferCanonicalEntityType(`${payload.canonicalName} ${payload.description || ''}`, aliases),
      aliases,
      confidence: Math.max(55, Math.min(98, Math.round(payload.confidence ?? 75))),
      source: 'wikidata',
      aliasProvenance: aliases.map((alias) => ({ alias, source: 'wikidata' as const })),
      externalRefs: [
        { system: 'wikidata', id: payload.id, label: payload.canonicalName },
        ...buildOpenSanctionsStyleRef(payload.canonicalName),
      ],
    });
  } catch {
    return null;
  }
}

function buildHeuristicEntity(term: string, aliases: string[] = [], confidence = 45): CanonicalEntity {
  const canonicalName = String(term || '').trim() || 'unknown';
  const normalizedAliases = aliases.slice(0, 8);
  return hydrateEntity({
    id: nowId(term),
    canonicalName,
    entityType: inferCanonicalEntityType(canonicalName, normalizedAliases),
    aliases: normalizedAliases,
    confidence,
    source: 'heuristic',
    aliasProvenance: normalizedAliases.map((alias) => ({ alias, source: 'heuristic' as const })),
    externalRefs: buildOpenSanctionsStyleRef(canonicalName),
  });
}

function findEntityByQuery(query: string): CanonicalEntity | null {
  const clean = String(query || '').trim();
  if (!clean) return null;
  const byId = canonicalById.get(clean);
  if (byId) return byId;
  const byAlias = canonicalByAlias.get(normalizeAlias(clean));
  if (byAlias) return byAlias;
  return null;
}

export async function resolveCanonicalEntity(
  term: string,
  aliases: string[] = [],
): Promise<CanonicalEntity> {
  await ensureLoaded();
  const local = resolveLocalEntity(term, aliases);
  if (local) return local;

  const wikidata = await tryResolveViaWikidata(term);
  if (wikidata) {
    addEntityToMaps(wikidata);
    await persist();
    return wikidata;
  }

  const fallback = buildHeuristicEntity(term, aliases, 45);
  addEntityToMaps(fallback);
  await persist();
  return fallback;
}

export async function resolveCanonicalEntityFast(
  term: string,
  aliases: string[] = [],
): Promise<CanonicalEntity> {
  await ensureLoaded();
  const local = resolveLocalEntity(term, aliases);
  if (local) return local;
  return buildHeuristicEntity(term, aliases, 40);
}

export async function listCanonicalEntities(limit = 240): Promise<CanonicalEntity[]> {
  await ensureLoaded();
  return Array.from(canonicalById.values())
    .sort((a, b) => b.confidence - a.confidence || a.canonicalName.localeCompare(b.canonicalName))
    .slice(0, Math.max(1, limit));
}

export async function approveCanonicalAlias(entityId: string, alias: string): Promise<CanonicalEntity | null> {
  await ensureLoaded();
  const entity = canonicalById.get(entityId);
  const cleanAlias = normalizeAlias(alias);
  if (!entity || !cleanAlias) return null;
  if (!entity.aliases.includes(cleanAlias)) entity.aliases = [...entity.aliases, cleanAlias].slice(0, 24);
  const provenance = entity.aliasProvenance || [];
  if (!provenance.some((entry) => entry.alias === cleanAlias && entry.source === 'local')) {
    provenance.unshift({ alias: cleanAlias, source: 'local' });
  }
  entity.aliasProvenance = provenance.slice(0, 24);
  if (entity.entityType === 'unknown') entity.entityType = inferCanonicalEntityType(entity.canonicalName, entity.aliases);
  canonicalById.set(entity.id, hydrateEntity(entity));
  rebuildAliasIndex();
  await persist();
  await logSourceOpsEvent({
    kind: 'ontology',
    action: 'alias-approved',
    actor: 'manual',
    title: entity.canonicalName,
    detail: `Approved alias ${cleanAlias}`,
    status: entity.entityType,
    tags: [cleanAlias],
  });
  await appendOntologyLedgerEvent({
    type: 'alias-approved',
    summary: `${entity.canonicalName} <- ${cleanAlias}`,
    payload: {
      entityId: entity.id,
      canonicalName: entity.canonicalName,
      alias: cleanAlias,
      entityType: entity.entityType,
    },
  }).catch(() => null);
  return canonicalById.get(entity.id) || null;
}

export async function splitCanonicalAlias(entityId: string, alias: string, newCanonicalName?: string): Promise<CanonicalEntity | null> {
  await ensureLoaded();
  const entity = canonicalById.get(entityId);
  const cleanAlias = normalizeAlias(alias);
  if (!entity || !cleanAlias) return null;
  entity.aliases = entity.aliases.filter((entry) => normalizeAlias(entry) !== cleanAlias);
  entity.aliasProvenance = (entity.aliasProvenance || []).filter((entry) => normalizeAlias(entry.alias) !== cleanAlias);

  const canonicalName = String(newCanonicalName || alias).trim() || alias;
  const created = hydrateEntity({
    id: nowId(`${canonicalName}:${Date.now()}`),
    canonicalName,
    entityType: inferCanonicalEntityType(canonicalName, [cleanAlias]),
    aliases: [cleanAlias],
    confidence: Math.max(60, Math.min(90, entity.confidence - 5)),
    source: 'local',
    aliasProvenance: [{ alias: cleanAlias, source: 'local' }],
    externalRefs: buildOpenSanctionsStyleRef(canonicalName),
  });
  canonicalById.set(entity.id, hydrateEntity(entity));
  canonicalById.set(created.id, created);
  rebuildAliasIndex();
  await persist();
  await logSourceOpsEvent({
    kind: 'ontology',
    action: 'alias-split',
    actor: 'manual',
    title: canonicalName,
    detail: `Split alias ${cleanAlias} from ${entity.canonicalName}`,
    status: created.entityType,
    tags: [entity.canonicalName, cleanAlias],
  });
  await appendOntologyLedgerEvent({
    type: 'alias-split',
    summary: `${entity.canonicalName} -> ${canonicalName}`,
    payload: {
      sourceEntityId: entity.id,
      createdEntityId: created.id,
      alias: cleanAlias,
      canonicalName,
      entityType: created.entityType,
    },
  }).catch(() => null);
  return created;
}

export async function mergeCanonicalEntities(sourceQuery: string, targetQuery: string): Promise<CanonicalEntity | null> {
  await ensureLoaded();
  const source = findEntityByQuery(sourceQuery);
  const target = findEntityByQuery(targetQuery);
  if (!source || !target || source.id === target.id) return target || null;

  const merged = hydrateEntity({
    ...target,
    entityType: target.entityType !== 'unknown' ? target.entityType : source.entityType,
    aliases: Array.from(new Set([
      ...target.aliases,
      ...source.aliases,
      normalizeAlias(source.canonicalName),
    ])).filter(Boolean).slice(0, 24),
    confidence: Math.max(target.confidence, source.confidence),
    aliasProvenance: [
      ...(target.aliasProvenance || []),
      ...(source.aliasProvenance || []),
      { alias: normalizeAlias(source.canonicalName), source: 'local' as const },
    ].filter((entry) => entry.alias).slice(0, 24),
    externalRefs: Array.from(new Map([
      ...((target.externalRefs || []).map((ref) => [`${ref.system}:${ref.id}`, ref] as const)),
      ...((source.externalRefs || []).map((ref) => [`${ref.system}:${ref.id}`, ref] as const)),
    ]).values()).slice(0, 16),
  });

  canonicalById.set(target.id, merged);
  canonicalById.delete(source.id);
  rebuildAliasIndex();
  await persist();
  await logSourceOpsEvent({
    kind: 'ontology',
    action: 'entity-merged',
    actor: 'manual',
    title: merged.canonicalName,
    detail: `Merged ${source.canonicalName} into ${merged.canonicalName}`,
    status: merged.entityType,
    tags: [source.canonicalName, merged.canonicalName],
  });
  await appendOntologyLedgerEvent({
    type: 'entity-merged',
    summary: `${source.canonicalName} -> ${merged.canonicalName}`,
    payload: {
      sourceEntityId: source.id,
      targetEntityId: merged.id,
      sourceCanonicalName: source.canonicalName,
      targetCanonicalName: merged.canonicalName,
      entityType: merged.entityType,
    },
  }).catch(() => null);
  return merged;
}
