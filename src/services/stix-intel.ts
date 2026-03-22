import type { ClusteredEvent, NewsItem } from '@/types';
import type { CyberThreat } from '@/types';
import type { CanonicalEntity, CanonicalEntityType } from './entity-ontology';
import type { EventMarketTransmissionSnapshot } from './event-market-transmission';
import type { SecurityAdvisory } from './security-advisories';

export type StixObjectType =
  | 'bundle'
  | 'indicator'
  | 'relationship'
  | 'identity'
  | 'malware'
  | 'location'
  | 'sighting'
  | 'report'
  | 'incident'
  | 'infrastructure'
  | 'grouping';

export interface StixObject {
  type: StixObjectType;
  id: string;
  spec_version?: '2.1';
  created: string;
  modified: string;
  [key: string]: unknown;
}

export interface StixBundle {
  type: 'bundle';
  id: string;
  spec_version: '2.1';
  objects: StixObject[];
}

const CYBER_ADVISORY_RE = /\b(cyber|malware|ransomware|vulnerability|exploit|cisa|otx|abuse|breach|phishing)\b/i;
const GEOPOLITICAL_SIGNAL_RE = /\b(war|strike|missile|drone|navy|military|hormuz|shipping|oil|sanction|energy|mine|escort|blockade|ceasefire|troops|port|strait|cable|pipeline)\b/i;

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeIdPart(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function normalizeText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_.:/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stixId(type: Exclude<StixObjectType, 'bundle'>, seed: string): string {
  return `${type}--wm-${sanitizeIdPart(seed)}`;
}

function indicatorPattern(threat: CyberThreat): string {
  if (threat.indicatorType === 'domain') return `[domain-name:value = '${threat.indicator}']`;
  if (threat.indicatorType === 'url') return `[url:value = '${threat.indicator}']`;
  return `[ipv4-addr:value = '${threat.indicator}']`;
}

function inferIdentityClass(entityType: CanonicalEntityType): 'organization' | 'individual' | 'government' | 'class' | 'system' {
  if (entityType === 'country') return 'government';
  if (entityType === 'person') return 'individual';
  if (entityType === 'technology') return 'system';
  return 'organization';
}

function entityAliasList(entity: CanonicalEntity): string[] {
  return [entity.canonicalName, ...(entity.aliases || [])]
    .map(normalizeText)
    .filter(Boolean);
}

function matchEntities(
  text: string,
  entities: CanonicalEntity[],
  types?: CanonicalEntityType[],
  limit = 6,
): CanonicalEntity[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const matched = entities.filter((entity) => {
    if (types?.length && !types.includes(entity.entityType)) return false;
    return entityAliasList(entity).some((alias) => alias.length >= 3 && normalized.includes(alias));
  });

  return matched
    .slice()
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    .slice(0, limit);
}

function incidentSummary(cluster: ClusteredEvent): string {
  const evidence = cluster.relations?.evidence?.slice(0, 4).join(' | ') || '';
  const sources = cluster.topSources?.slice(0, 4).map((item) => item.name).join(', ') || cluster.primarySource;
  return [evidence, sources].filter(Boolean).join(' | ');
}

function pushUnique(
  objects: StixObject[],
  seen: Set<string>,
  object: StixObject,
): void {
  if (seen.has(object.id)) return;
  seen.add(object.id);
  objects.push(object);
}

export function buildStixBundle(input: {
  threats: CyberThreat[];
  advisories?: SecurityAdvisory[];
  clusters?: ClusteredEvent[];
  transmission?: EventMarketTransmissionSnapshot | null;
  entities?: CanonicalEntity[];
}): StixBundle {
  const created = nowIso();
  const objects: StixObject[] = [];
  const seen = new Set<string>();
  const incidentRefsByTitle = new Map<string, string>();
  const incidentObjectRefs = new Set<string>();
  const transmissionRefs = new Set<string>();
  const entities = input.entities || [];

  const ensureIdentity = (name: string, seed: string, identityClass: 'organization' | 'individual' | 'government' | 'class' | 'system', labels: string[], extras?: Record<string, unknown>): string => {
    const id = stixId('identity', seed);
    pushUnique(objects, seen, {
      type: 'identity',
      id,
      spec_version: '2.1',
      created,
      modified: created,
      name,
      identity_class: identityClass,
      labels,
      ...(extras || {}),
    });
    return id;
  };

  const ensureEntityIdentity = (entity: CanonicalEntity): string => ensureIdentity(
    entity.canonicalName,
    `entity:${entity.id}`,
    inferIdentityClass(entity.entityType),
    ['worldmonitor', 'ontology-entity', entity.entityType],
    {
      sectors: [entity.entityType],
      x_worldmonitor_source: entity.source,
      x_worldmonitor_confidence: entity.confidence,
    },
  );

  const ensureLocation = (entity: CanonicalEntity): string => {
    const id = stixId('location', `entity:${entity.id}`);
    pushUnique(objects, seen, {
      type: 'location',
      id,
      spec_version: '2.1',
      created,
      modified: created,
      name: entity.canonicalName,
      country: entity.entityType === 'country' ? entity.canonicalName : undefined,
      labels: ['worldmonitor', 'ontology-location', entity.entityType],
      x_worldmonitor_source: entity.source,
      x_worldmonitor_confidence: entity.confidence,
    });
    return id;
  };

  const ensureInfrastructure = (name: string, seed: string, labels: string[], extras?: Record<string, unknown>): string => {
    const id = stixId('infrastructure', seed);
    pushUnique(objects, seen, {
      type: 'infrastructure',
      id,
      spec_version: '2.1',
      created,
      modified: created,
      name,
      infrastructure_types: labels.filter(Boolean),
      labels: ['worldmonitor', ...labels],
      ...(extras || {}),
    });
    return id;
  };

  const ensureEntityInfrastructure = (entity: CanonicalEntity): string => ensureInfrastructure(
    entity.canonicalName,
    `entity:${entity.id}`,
    [entity.entityType],
    {
      x_worldmonitor_source: entity.source,
      x_worldmonitor_confidence: entity.confidence,
    },
  );

  const pushRelationship = (seed: string, sourceRef: string, targetRef: string, relationshipType: string, extras?: Record<string, unknown>): void => {
    pushUnique(objects, seen, {
      type: 'relationship',
      id: stixId('relationship', seed),
      spec_version: '2.1',
      created,
      modified: created,
      relationship_type: relationshipType,
      source_ref: sourceRef,
      target_ref: targetRef,
      ...(extras || {}),
    });
  };

  for (const threat of input.threats || []) {
    const sourceIdentityId = ensureIdentity(
      threat.source.toUpperCase(),
      `source:${threat.source}`,
      'organization',
      ['worldmonitor', 'cyber-intel-source'],
      { sectors: ['technology', 'government'] },
    );

    const indicatorId = stixId('indicator', threat.id || `${threat.source}:${threat.indicator}`);
    pushUnique(objects, seen, {
      type: 'indicator',
      id: indicatorId,
      spec_version: '2.1',
      created,
      modified: created,
      name: `${threat.indicatorType.toUpperCase()} ${threat.indicator}`,
      description: `${threat.type} IOC from ${threat.source}`,
      indicator_types: [threat.type, threat.indicatorType],
      pattern_type: 'stix',
      pattern: indicatorPattern(threat),
      valid_from: threat.firstSeen || created,
      labels: ['worldmonitor', threat.severity, threat.source],
      x_worldmonitor_severity: threat.severity,
      x_worldmonitor_tags: threat.tags,
    });

    pushRelationship(`${sourceIdentityId}->${indicatorId}`, sourceIdentityId, indicatorId, 'indicates', {
      description: 'Source feed emitted this indicator',
    });

    if (threat.malwareFamily) {
      const malwareId = stixId('malware', threat.malwareFamily);
      pushUnique(objects, seen, {
        type: 'malware',
        id: malwareId,
        spec_version: '2.1',
        created,
        modified: created,
        name: threat.malwareFamily,
        is_family: true,
        labels: ['worldmonitor', 'malware-family'],
      });
      pushRelationship(`${indicatorId}->${malwareId}`, indicatorId, malwareId, 'indicates', {
        description: 'Indicator associated with malware family',
      });
    }

    if (Number.isFinite(threat.lat) && Number.isFinite(threat.lon)) {
      const locationId = stixId('location', `${threat.country || 'unknown'}:${threat.lat}:${threat.lon}`);
      pushUnique(objects, seen, {
        type: 'location',
        id: locationId,
        spec_version: '2.1',
        created,
        modified: created,
        name: threat.country || 'Unknown',
        latitude: threat.lat,
        longitude: threat.lon,
        country: threat.country || undefined,
        labels: ['worldmonitor', 'geolocated-ioc'],
      });
      pushUnique(objects, seen, {
        type: 'sighting',
        id: stixId('sighting', `${indicatorId}:${locationId}`),
        spec_version: '2.1',
        created,
        modified: created,
        sighting_of_ref: indicatorId,
        where_sighted_refs: [sourceIdentityId],
        summary: true,
        description: `IOC geolocated near ${threat.country || 'unknown'}`,
        x_worldmonitor_location_ref: locationId,
      });
    }
  }

  const clusters = (input.clusters || [])
    .filter((cluster) => Boolean(cluster.primaryTitle))
    .filter((cluster) => cluster.isAlert || GEOPOLITICAL_SIGNAL_RE.test(cluster.primaryTitle))
    .slice(0, 28);

  for (const cluster of clusters) {
    const incidentId = stixId('incident', cluster.id || cluster.primaryTitle);
    const incidentText = [
      cluster.primaryTitle,
      cluster.primarySource,
      ...(cluster.relations?.evidence || []),
      ...cluster.allItems.slice(0, 4).map((item: NewsItem) => item.title),
    ].join(' ');

    pushUnique(objects, seen, {
      type: 'incident',
      id: incidentId,
      spec_version: '2.1',
      created,
      modified: created,
      name: cluster.primaryTitle,
      description: incidentSummary(cluster),
      first_seen: cluster.firstSeen?.toISOString?.() || created,
      last_seen: cluster.lastUpdated?.toISOString?.() || created,
      confidence: Math.max(10, Math.min(100, Math.round(cluster.relations?.confidenceScore || cluster.sourceCount * 12 || 40))),
      labels: [
        'worldmonitor',
        'geopolitical-incident',
        cluster.threat?.level || 'info',
        cluster.threat?.category || 'general',
      ],
      x_worldmonitor_source_count: cluster.sourceCount,
      x_worldmonitor_primary_source: cluster.primarySource,
      x_worldmonitor_coordinates: (Number.isFinite(cluster.lat) && Number.isFinite(cluster.lon))
        ? { lat: cluster.lat, lon: cluster.lon }
        : null,
    });
    incidentRefsByTitle.set(normalizeText(cluster.primaryTitle), incidentId);
    incidentObjectRefs.add(incidentId);

    const matchedActors = matchEntities(incidentText, entities, ['country', 'organization', 'company', 'person'], 4);
    const matchedLocations = matchEntities(incidentText, entities, ['country', 'location', 'waterway'], 4);
    const matchedAssets = matchEntities(incidentText, entities, ['asset', 'waterway', 'company', 'commodity', 'technology'], 4);

    for (const entity of matchedActors) {
      const actorId = ensureEntityIdentity(entity);
      pushRelationship(`${incidentId}:actor:${entity.id}`, incidentId, actorId, 'related-to', {
        description: 'Matched actor linked from cluster title/evidence',
        x_worldmonitor_role: entity.entityType === 'country' ? 'state-actor' : 'actor',
      });
    }

    for (const entity of matchedLocations) {
      const locationId = ensureLocation(entity);
      pushRelationship(`${incidentId}:location:${entity.id}`, incidentId, locationId, 'located-at', {
        description: 'Matched physical location linked from cluster title/evidence',
      });
    }

    for (const entity of matchedAssets) {
      const infrastructureId = ensureEntityInfrastructure(entity);
      pushRelationship(`${incidentId}:asset:${entity.id}`, incidentId, infrastructureId, 'targets', {
        description: 'Matched strategic asset or infrastructure linked from cluster text',
      });
    }
  }

  const advisories = (input.advisories || []).slice(0, 24);
  const cyberAdvisories = advisories.filter((item) => CYBER_ADVISORY_RE.test(item.title)).slice(0, 20);
  const physicalAdvisories = advisories.filter((item) => !CYBER_ADVISORY_RE.test(item.title)).slice(0, 20);

  if (cyberAdvisories.length > 0) {
    pushUnique(objects, seen, {
      type: 'report',
      id: stixId('report', `advisories:${cyberAdvisories[0]!.pubDate.toISOString()}`),
      spec_version: '2.1',
      created,
      modified: created,
      name: 'WorldMonitor Cyber Advisory Digest',
      published: cyberAdvisories[0]!.pubDate.toISOString(),
      labels: ['worldmonitor', 'cyber', 'advisory'],
      object_refs: [],
      description: cyberAdvisories.slice(0, 6).map((item) => item.title).join(' | '),
    });
  }

  for (const advisory of physicalAdvisories) {
    const reportId = stixId('report', advisory.link || advisory.title);
    const sourceIdentityId = ensureIdentity(
      advisory.source,
      `advisory-source:${advisory.source}`,
      'organization',
      ['worldmonitor', 'advisory-source'],
    );

    pushUnique(objects, seen, {
      type: 'report',
      id: reportId,
      spec_version: '2.1',
      created,
      modified: created,
      name: advisory.title,
      description: `${advisory.source} travel/security advisory`,
      published: advisory.pubDate.toISOString(),
      labels: ['worldmonitor', 'security-advisory', advisory.level || 'info'],
      object_refs: [],
      x_worldmonitor_country: advisory.country || null,
      x_worldmonitor_source_country: advisory.sourceCountry,
    });
    pushRelationship(`${sourceIdentityId}->${reportId}`, sourceIdentityId, reportId, 'related-to', {
      description: 'Issuing authority or source of advisory',
    });

    const advisoryText = `${advisory.title} ${advisory.country || ''}`;
    const advisoryLocations = matchEntities(advisoryText, entities, ['country', 'location', 'waterway'], 3);
    for (const entity of advisoryLocations) {
      const locationId = ensureLocation(entity);
      pushRelationship(`${reportId}:location:${entity.id}`, reportId, locationId, 'related-to', {
        description: 'Advisory references this location or country',
      });
    }
  }

  const transmissionEdges = input.transmission?.edges?.slice(0, 24) || [];
  if (transmissionEdges.length > 0) {
    const objectRefs: string[] = [];
    for (const edge of transmissionEdges) {
      const marketAssetId = ensureInfrastructure(
        `${edge.marketSymbol} ${edge.marketName}`,
        `market:${edge.marketSymbol}`,
        ['market-asset', edge.relationType],
        {
          description: edge.reason,
          x_worldmonitor_market_symbol: edge.marketSymbol,
          x_worldmonitor_market_name: edge.marketName,
          x_worldmonitor_market_url: edge.marketUrl,
        },
      );
      transmissionRefs.add(marketAssetId);
      objectRefs.push(marketAssetId);

      const incidentId = incidentRefsByTitle.get(normalizeText(edge.eventTitle));
      if (incidentId) {
        objectRefs.push(incidentId);
        pushRelationship(`${incidentId}:affects:${edge.marketSymbol}`, incidentId, marketAssetId, 'affects', {
          description: edge.reason,
          confidence: edge.strength,
          x_worldmonitor_keywords: edge.keywords,
        });
      } else {
        const eventReportId = stixId('report', `transmission:${edge.id}`);
        pushUnique(objects, seen, {
          type: 'report',
          id: eventReportId,
          spec_version: '2.1',
          created,
          modified: created,
          name: edge.eventTitle,
          description: edge.reason,
          labels: ['worldmonitor', 'geoeconomic-transmission', edge.relationType],
          object_refs: [marketAssetId],
          x_worldmonitor_event_source: edge.eventSource,
          x_worldmonitor_strength: edge.strength,
        });
        objectRefs.push(eventReportId);
      }
    }

    pushUnique(objects, seen, {
      type: 'grouping',
      id: stixId('grouping', `transmission:${input.transmission?.generatedAt || created}`),
      spec_version: '2.1',
      created,
      modified: created,
      name: 'WorldMonitor Geoeconomic Transmission Graph',
      context: 'malware-analysis',
      object_refs: Array.from(new Set(objectRefs)).slice(0, 64),
      labels: ['worldmonitor', 'geopolitical', 'geoeconomic', 'transmission'],
      description: transmissionEdges.slice(0, 8).map((edge) => `${edge.eventTitle} -> ${edge.marketSymbol}`).join(' | '),
    });
  }

  if (incidentObjectRefs.size > 1) {
    pushUnique(objects, seen, {
      type: 'grouping',
      id: stixId('grouping', `incidents:${created}`),
      spec_version: '2.1',
      created,
      modified: created,
      name: 'WorldMonitor Geopolitical Incident Set',
      context: 'suspicious-activity',
      object_refs: Array.from(incidentObjectRefs).slice(0, 48),
      labels: ['worldmonitor', 'geopolitical', 'incident-group'],
      description: clusters.slice(0, 8).map((cluster) => cluster.primaryTitle).join(' | '),
    });
  }

  return {
    type: 'bundle',
    id: `bundle--wm-${Date.now()}`,
    spec_version: '2.1',
    objects,
  };
}

export function summarizeStixBundle(bundle: StixBundle | null | undefined): Array<{ type: string; count: number }> {
  if (!bundle?.objects?.length) return [];
  const counts = new Map<string, number>();
  for (const object of bundle.objects) {
    counts.set(object.type, (counts.get(object.type) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}
