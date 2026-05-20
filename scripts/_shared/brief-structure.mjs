/**
 * Theme brief 6-section envelope (S-Tier User Value §2).
 *
 * Plan §2 mandates that every theme brief follow a fixed structure:
 *
 *   1. What changed?
 *   2. Why it matters
 *   3. Evidence
 *   4. Caveats / noise risk
 *   5. What to monitor next
 *   6. Related assets / sectors / entities
 *
 * The existing buildThemeBriefPayload (trend-dashboard-queries.mjs) already
 * emits most of these under different field names. This module normalizes the
 * envelope so consumers can rely on a stable shape and so we can compute a
 * `briefCompleteness` metric uniformly.
 *
 * Mapping (existing → plan):
 *   whatChanged           → whatChanged
 *   whyItMatters          → whyMatters
 *   evidence + ledger     → evidence (with classes from evidenceLedger)
 *   risks                 → caveats
 *   watchpoints           → monitor
 *   relatedEntities,
 *     adjacentPathways    → related
 */

const SECTION_KEYS = ['whatChanged', 'whyMatters', 'evidence', 'caveats', 'monitor', 'related'];

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.items)) return value.items;
  return [];
}

function flattenStringList(input) {
  const out = [];
  for (const entry of asArray(input)) {
    if (!entry) continue;
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed) out.push(trimmed);
    } else if (typeof entry === 'object') {
      // Try a wide set of common identifier fields. Order matters — prefer
      // narrative fields over identifier fields so '.note' beats '.entityKey'.
      const text = String(
        entry.summary
        || entry.text
        || entry.statement
        || entry.message
        || entry.headline
        || entry.note
        || entry.reason
        || entry.thesis
        || entry.label
        || entry.title
        || entry.companyName
        || entry.name
        || entry.entityKey
        || entry.targetThemeLabel
        || entry.targetTheme
        || '',
      ).trim();
      if (text) out.push(text);
    }
  }
  return out;
}

/**
 * Extract evidence items from a rich `sections.evidence` object.
 *
 * The legacy buildThemeEvidence returns an object with curatedItems[],
 * provenance[], evidenceClasses[], trend, sourceBreakdown, etc. We need
 * to surface human-readable strings for each piece of evidence so the
 * brief-completeness metric counts content, not container shape.
 */
function extractEvidenceItemsFromObject(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return [];
  const items = [];

  // 1. Provenance refs — each ref's `label` is the human-readable summary.
  for (const ref of asArray(evidence.provenance)) {
    if (!ref) continue;
    const label = String(ref.label || ref.title || ref.summary || '').trim();
    if (label) items.push(label);
  }

  // 2. Curated digest items (titles).
  for (const item of asArray(evidence.curatedItems)) {
    if (!item) continue;
    const text = String(item.title || item.headline || item.summary || '').trim();
    if (text) items.push(text);
  }

  // 3. Recent article references.
  for (const item of asArray(evidence.recentArticles)) {
    if (!item) continue;
    const text = String(item.title || item.headline || '').trim();
    if (text) items.push(text);
  }

  // 4. SEC context entities (just names — for "evidence of activity" framing).
  for (const ent of asArray(evidence.secEntities || evidence.secContext?.entities)) {
    if (!ent) continue;
    const text = String(ent.name || ent.label || ent.entity || '').trim();
    if (text) items.push(text);
  }

  // 5. Trend snapshot one-liner.
  if (evidence.trend && typeof evidence.trend === 'object') {
    const t = evidence.trend;
    if (Number.isFinite(Number(t.articleCount))) {
      const pieces = [`${t.articleCount} articles`];
      if (Number.isFinite(Number(t.vsPreviousPct))) {
        pieces.push(`${Number(t.vsPreviousPct).toFixed(0)}% vs prior period`);
      }
      if (t.lifecycleStage) pieces.push(`${t.lifecycleStage} stage`);
      items.push(pieces.join(', '));
    }
  }

  // De-duplicate while preserving order.
  const seen = new Set();
  const deduped = [];
  for (const text of items) {
    if (seen.has(text)) continue;
    seen.add(text);
    deduped.push(text);
  }
  return deduped;
}

function evidenceClassesFromLedger(ledger) {
  if (!ledger || typeof ledger !== 'object') return [];
  const raw = Array.isArray(ledger.evidenceClasses) ? ledger.evidenceClasses : [];
  return raw
    .map((cls) => {
      if (!cls) return null;
      if (typeof cls === 'string') return { class: cls };
      const klass = String(cls.class || cls.type || cls.evidence_class || '').trim();
      const count = Number(cls.count ?? 0);
      if (!klass) return null;
      return { class: klass, count: Number.isFinite(count) ? count : 0 };
    })
    .filter(Boolean);
}

/**
 * The legacy theme-brief builder emits relatedEntities and adjacentPathways
 * as objects, not flat arrays:
 *   relatedEntities = { entities: [...], pathways: [...], status, ... }
 *   adjacentPathways = { items: [{label, reason, thesis, targetTheme...}], summary }
 *
 * Each container can be either an array OR one of those objects. This
 * extractor accepts both shapes and surfaces human-readable strings.
 */
function extractRelatedStrings(input, prioritizedKeys = []) {
  if (!input) return [];
  if (Array.isArray(input)) return flattenStringList(input);
  if (typeof input === 'object') {
    for (const key of prioritizedKeys) {
      const inner = input[key];
      if (Array.isArray(inner) && inner.length > 0) return flattenStringList(inner);
    }
    if (Array.isArray(input.items) && input.items.length > 0) return flattenStringList(input.items);
  }
  return [];
}

function normalizeRelated(sections) {
  const re = sections?.relatedEntities;
  const related = {
    // entities: prefer .entities[] (each has companyName/entityKey/name),
    // fall back to flat array form.
    entities: extractRelatedStrings(re, ['entities'])
      .concat(extractRelatedStrings(re?.entities)),
    // pathways: relatedEntities also exposes its own pathways[] (each has
    // relationType + note). adjacentPathways is the dedicated source.
    pathways: extractRelatedStrings(sections?.adjacentPathways, ['items'])
      .concat(extractRelatedStrings(re?.pathways)),
    assets: extractRelatedStrings(sections?.relatedAssets, ['items']),
    sectors: extractRelatedStrings(sections?.relatedSectors, ['items']),
  };
  // Per-bucket dedupe.
  for (const key of Object.keys(related)) {
    related[key] = Array.from(new Set(related[key]));
  }
  return related;
}

function sectionPresent(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object') {
    if (Array.isArray(value.items)) return value.items.length > 0;
    if (Array.isArray(value.entries)) return value.entries.length > 0;
    if (Array.isArray(value.entities) && value.entities.length > 0) return true;
    if (Array.isArray(value.pathways) && value.pathways.length > 0) return true;
    if (Array.isArray(value.assets) && value.assets.length > 0) return true;
    if (Array.isArray(value.sectors) && value.sectors.length > 0) return true;
    if (typeof value.summary === 'string' && value.summary.trim()) return true;
    if (Array.isArray(value.classes) && value.classes.length > 0) return true;
    if (Array.isArray(value.items) && value.items.length > 0) return true;
  }
  return false;
}

/**
 * Project a raw brief payload (the value returned by buildThemeBriefPayload
 * under `sections` plus the top-level `evidenceLedger`) into the canonical
 * 6-section envelope.
 *
 * Returns { briefStructure, briefCompleteness, missingSections } where:
 *   - briefStructure: { whatChanged, whyMatters, evidence, caveats, monitor, related }
 *   - briefCompleteness: 0..1 — share of sections with non-empty content
 *   - missingSections: array of plan-named section keys with empty content
 */
export function projectBriefStructure(payload = {}) {
  const sections = payload?.sections || {};
  const evidenceLedger = payload?.evidenceLedger || {};

  const whatChanged = flattenStringList(sections.whatChanged);
  // whyMatters: legacy field is whyItMatters; the existing builder emits an
  // object with `statements` array (not a flat list). Pull statements + the
  // generic flat-list fallback so the projection works for both shapes.
  const whyMatters = (() => {
    const direct = flattenStringList(sections.whyItMatters || sections.whyMatters);
    if (direct.length > 0) return direct;
    const wim = sections.whyItMatters || sections.whyMatters;
    if (wim && typeof wim === 'object') {
      const statements = flattenStringList(wim.statements);
      if (statements.length > 0) return statements;
    }
    return [];
  })();

  // evidence: the legacy builder emits a rich object (curatedItems, provenance,
  // recentArticles, secContext, trend, etc.) rather than a flat list. Extract
  // human-readable strings from those nested arrays so evidence_coverage
  // reflects content, not container shape.
  const evidenceItems = (() => {
    const flat = flattenStringList(sections.evidence);
    if (flat.length > 0) return flat;
    return extractEvidenceItemsFromObject(sections.evidence);
  })();

  // evidenceClasses can come from either the top-level evidenceLedger or the
  // evidence.evidenceClasses array — accept both.
  const evidenceClasses = (() => {
    const fromLedger = evidenceClassesFromLedger(evidenceLedger);
    if (fromLedger.length > 0) return fromLedger;
    if (sections.evidence && Array.isArray(sections.evidence.evidenceClasses)) {
      return evidenceClassesFromLedger({ evidenceClasses: sections.evidence.evidenceClasses });
    }
    return [];
  })();

  const caveats = flattenStringList(sections.risks || sections.caveats);
  // monitor: watchpoints can be an object with statements[] like whyItMatters.
  const monitor = (() => {
    const direct = flattenStringList(sections.watchpoints || sections.monitor || sections.nextActions);
    if (direct.length > 0) return direct;
    const wp = sections.watchpoints || sections.monitor || sections.nextActions;
    if (wp && typeof wp === 'object') {
      const statements = flattenStringList(wp.statements);
      if (statements.length > 0) return statements;
    }
    return [];
  })();
  const related = normalizeRelated(sections);

  const briefStructure = {
    whatChanged,
    whyMatters,
    evidence: {
      items: evidenceItems,
      classes: evidenceClasses,
    },
    caveats,
    monitor,
    related,
  };

  const presence = {
    whatChanged: sectionPresent(whatChanged),
    whyMatters: sectionPresent(whyMatters),
    evidence: evidenceItems.length > 0 || briefStructure.evidence.classes.length > 0,
    caveats: sectionPresent(caveats),
    monitor: sectionPresent(monitor),
    related: sectionPresent(related),
  };
  const filledCount = SECTION_KEYS.filter((key) => presence[key]).length;
  const briefCompleteness = filledCount / SECTION_KEYS.length;
  const missingSections = SECTION_KEYS.filter((key) => !presence[key]);

  return { briefStructure, briefCompleteness, missingSections };
}

/**
 * Decorate a brief payload in place (returns the same object for chaining)
 * with the 6-section envelope + completeness metric.
 */
export function decorateBriefWithStructure(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const projection = projectBriefStructure(payload);
  payload.briefStructure = projection.briefStructure;
  payload.briefCompleteness = Number(projection.briefCompleteness.toFixed(3));
  payload.missingSections = projection.missingSections;
  return payload;
}

export const BRIEF_SECTION_KEYS = SECTION_KEYS;
