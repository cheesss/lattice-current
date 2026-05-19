import { normalizeKnowledgeKey } from './adjacency-graph.mjs';
import { loadResearchOsPolicy, requirePolicyNumber } from './research-os-policy.mjs';

export const RELATION_EXTRACTOR_ALLOWED_RELATIONS = Object.freeze([
  'requires',
  'supplies',
  'bottleneck',
  'beneficiary',
  'substitute',
  'adjacent_to',
  'exposed_to',
  'enables',
  'risk_to',
  'uses',
  'manufactures',
  'depends_on',
]);

export const RELATION_EXTRACTOR_ALLOWED_NODE_TYPES = Object.freeze([
  'theme',
  'technology',
  'component',
  'material',
  'process',
  'infrastructure',
  'supplier',
  'company',
  'symbol',
  'source',
]);

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeType(value) {
  return normalizeKnowledgeKey(value).replace(/-/g, '_');
}

const STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'among', 'and', 'are', 'because',
  'been', 'before', 'between', 'but', 'can', 'could', 'from', 'has', 'have',
  'for', 'into', 'its', 'more', 'new', 'not', 'over', 'said', 'such', 'that', 'the',
  'their', 'then', 'there', 'these', 'this', 'through', 'under', 'using', 'was',
  'were', 'when', 'where', 'which', 'while', 'who', 'would',
]);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function tokenize(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

function classifyObjectType(phrase) {
  const key = normalizeKnowledgeKey(phrase);
  if (/(hydrogen|helium|lithium|graphite|graphene|silicon|oxygen|nitrogen|ammonia|propellant|fuel|catalyst|alloy|polymer)/.test(key)) {
    return 'material';
  }
  if (/(cooling|refrigerator|cryostat|magnet|transformer|reactor|battery|chip|engine|pump|sensor|system|electronics|rotor|turbine|fuel-cell|fuel-cell|cell|link)/.test(key)) {
    return 'component';
  }
  if (/(infrastructure|center|pipeline|terminal|plant|facility|launch|station|grid|network)/.test(key)) {
    return 'infrastructure';
  }
  if (/(production|manufacturing|fabrication|electrolysis|exfoliation|shuttling|synthesis|processing)/.test(key)) {
    return 'process';
  }
  return 'technology';
}

function phraseCandidates(text, maxPhrases = 8) {
  const words = tokenize(text);
  const counts = new Map();
  for (let size = 2; size <= 4; size += 1) {
    for (let i = 0; i <= words.length - size; i += 1) {
      const phrase = words.slice(i, i + size).join(' ');
      if (phrase.length < 8) continue;
      counts.set(phrase, (counts.get(phrase) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
    .slice(0, maxPhrases)
    .map(([phrase, count]) => ({ phrase, count, objectType: classifyObjectType(phrase) }));
}

function hasTechnicalCue(phrase, policy) {
  const key = normalizeKnowledgeKey(phrase);
  const cues = (policy?.relationExtraction?.technicalCueTerms || []).map(normalizeKnowledgeKey).filter(Boolean);
  return cues.some((cue) => key.includes(cue));
}

function canonicalizeTechnicalPhrase(phrase, policy) {
  const key = normalizeKnowledgeKey(phrase);
  const cues = (policy?.relationExtraction?.technicalCueTerms || [])
    .map(normalizeKnowledgeKey)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  const weakStandalone = new Set((policy?.relationExtraction?.weakStandaloneCueTerms || []).map(normalizeKnowledgeKey));
  const cue = cues.find((item) => key.includes(item));
  if (!cue) return null;
  if (weakStandalone.has(cue)) return null;
  return cue.replace(/-/g, ' ');
}

function hasNoiseContext(phrase, policy) {
  const key = normalizeKnowledgeKey(phrase);
  const terms = (policy?.relationExtraction?.noiseContextTerms || []).map(normalizeKnowledgeKey).filter(Boolean);
  return terms.some((term) => key.split('-').includes(term) || key.includes(term));
}

function wordBoundaryRegex(term) {
  return new RegExp(`(^|[^a-z0-9])${String(term || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
}

function supportedThemesForBundle(bundle, question, text) {
  const questionThemes = Array.isArray(question.themes) ? question.themes.map(normalizeKnowledgeKey).filter(Boolean) : [];
  if (!questionThemes.length) return [];
  const metadataTheme = normalizeKnowledgeKey(bundle?.metadata?.theme || bundle?.theme);
  if (metadataTheme && questionThemes.includes(metadataTheme)) return [metadataTheme];
  const normalizedText = normalizeKnowledgeKey(text);
  const textMatches = questionThemes.filter((theme) => {
    if (normalizedText.includes(theme)) return true;
    const parts = theme.split('-').filter((part) => part.length >= 4);
    return parts.length > 0 && parts.every((part) => normalizedText.includes(part));
  });
  if (textMatches.length) return textMatches;
  if (questionThemes.length === 1) return questionThemes;
  return [];
}

export function buildRelationsFromEvidenceBundle(bundle = {}, question = {}, options = {}) {
  const policy = options.policy || loadResearchOsPolicy();
  const title = cleanText(bundle.title);
  const excerpt = cleanText(bundle.text_excerpt || bundle.textExcerpt);
  const text = `${title}. ${excerpt}`;
  const quote = excerpt || title;
  const themes = supportedThemesForBundle(bundle, question, text);
  const phrases = [...new Map(phraseCandidates(text, options.maxPhrases || 8)
    .filter((candidate) => hasTechnicalCue(candidate.phrase, policy))
    .filter((candidate) => !hasNoiseContext(candidate.phrase, policy))
    .map((candidate) => {
      const canonical = canonicalizeTechnicalPhrase(candidate.phrase, policy);
      if (!canonical) return null;
      return [canonical, {
        ...candidate,
        phrase: canonical,
        objectType: classifyObjectType(canonical),
      }];
    })
    .filter(Boolean)).values()];
  const relations = [];
  for (const theme of themes.slice(0, 4)) {
    for (const candidate of phrases) {
      relations.push({
        subject: theme,
        subjectType: 'theme',
        relation: 'requires',
        object: candidate.phrase,
        objectType: candidate.objectType,
        confidence: Math.min(0.72, 0.42 + candidate.count * 0.08),
        evidenceQuote: quote.slice(0, 220),
        evidenceStrength: 'indirect',
        caveat: 'Automated extraction from evidence text; relation is candidate-only until reviewed.',
        metadata: {
          sourceType: bundle.source_type || bundle.sourceType,
          sourceId: bundle.source_id || bundle.sourceId,
          extractionMode: 'deterministic-phrase',
        },
      });
    }
  }
  for (const company of options.companyNodes || []) {
    const name = String(company.canonicalName || company.canonical_name || '').trim();
    if (!name || !wordBoundaryRegex(name).test(text)) continue;
    for (const candidate of phrases.slice(0, 3)) {
      relations.push({
        subject: candidate.phrase,
        subjectType: candidate.objectType,
        relation: 'supplies',
        object: name,
        objectType: 'company',
        confidence: 0.46,
        evidenceQuote: quote.slice(0, 220),
        evidenceStrength: 'weak',
        caveat: 'Company was co-mentioned with the connector; supplier role is not proven.',
        metadata: {
          sourceType: bundle.source_type || bundle.sourceType,
          sourceId: bundle.source_id || bundle.sourceId,
          extractionMode: 'company-co-mention',
          companyNodeId: company.id,
        },
      });
    }
  }
  return validateExtractedRelations({ relations }, options).accepted;
}

export function validateExtractedRelations(payload = {}, options = {}) {
  const policy = options.policy || loadResearchOsPolicy();
  const quoteLessConfidenceMax = Number(options.quoteLessConfidenceMax ?? requirePolicyNumber(policy, 'relationExtraction.quoteLessConfidenceMax'));
  const relations = Array.isArray(payload.relations) ? payload.relations : [];
  const accepted = [];
  const rejected = [];
  for (const [index, relation] of relations.entries()) {
    const subject = String(relation.subject || '').trim();
    const object = String(relation.object || '').trim();
    const relationType = normalizeType(relation.relation);
    const subjectType = normalizeType(relation.subjectType || relation.subject_type);
    const objectType = normalizeType(relation.objectType || relation.object_type);
    const evidenceQuote = String(relation.evidenceQuote || relation.evidence_quote || '').trim();
    const confidence = Math.max(0, Math.min(1, toNumber(relation.confidence)));
    const errors = [];
    if (!subject) errors.push('missing-subject');
    if (!object) errors.push('missing-object');
    if (!RELATION_EXTRACTOR_ALLOWED_RELATIONS.includes(relationType)) errors.push('invalid-relation');
    if (!RELATION_EXTRACTOR_ALLOWED_NODE_TYPES.includes(subjectType)) errors.push('invalid-subject-type');
    if (!RELATION_EXTRACTOR_ALLOWED_NODE_TYPES.includes(objectType)) errors.push('invalid-object-type');
    if (!evidenceQuote && confidence > quoteLessConfidenceMax) errors.push('quote-less-high-confidence');
    if (errors.length) {
      rejected.push({ index, relation, errors });
      continue;
    }
    accepted.push({
      subject,
      subjectType,
      relation: relationType,
      object,
      objectType,
      confidence: evidenceQuote ? confidence : Math.min(confidence, quoteLessConfidenceMax),
      evidenceQuote,
      evidenceStrength: relation.evidenceStrength || relation.evidence_strength || (evidenceQuote ? 'indirect' : 'weak'),
      caveat: relation.caveat || '',
      metadata: relation.metadata || {},
    });
  }
  return {
    ok: rejected.length === 0,
    accepted,
    rejected,
    metrics: {
      total: relations.length,
      accepted: accepted.length,
      rejected: rejected.length,
    },
  };
}
