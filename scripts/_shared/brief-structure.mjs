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
      const text = String(entry.summary || entry.text || entry.label || entry.title || entry.headline || '').trim();
      if (text) out.push(text);
    }
  }
  return out;
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

function normalizeRelated(sections) {
  const related = {
    entities: flattenStringList(sections?.relatedEntities),
    pathways: flattenStringList(sections?.adjacentPathways),
    assets: flattenStringList(sections?.relatedAssets),
    sectors: flattenStringList(sections?.relatedSectors),
  };
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
  const whyMatters = flattenStringList(sections.whyItMatters || sections.whyMatters);
  const evidenceItems = flattenStringList(sections.evidence);
  const caveats = flattenStringList(sections.risks || sections.caveats);
  const monitor = flattenStringList(sections.watchpoints || sections.monitor || sections.nextActions);
  const related = normalizeRelated(sections);

  const briefStructure = {
    whatChanged,
    whyMatters,
    evidence: {
      items: evidenceItems,
      classes: evidenceClassesFromLedger(evidenceLedger),
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
