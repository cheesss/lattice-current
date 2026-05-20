function compactText(value, max = 320) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function uniqueStrings(values = [], limit = 80) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
    const text = compactText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  const finite = Number.isFinite(number) ? number : min;
  return Math.max(min, Math.min(max, finite));
}

function normalizeKey(value = '') {
  return compactText(value, 240)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function splitTokens(value = '') {
  return normalizeKey(value).split('-').filter((token) => token.length >= 2);
}

function containsTerm(haystack = '', needle = '') {
  const text = ` ${compactText(haystack, 2000).toLowerCase()} `;
  const term = compactText(needle, 180).toLowerCase();
  if (!term) return false;
  return text.includes(` ${term} `) || text.includes(term);
}

const THEME_CATEGORY_PATTERNS = Object.freeze({
  compute: /\b(ai|ml|cloud|compute|data[-\s]?center|hyperscaler|software|accelerator)\b/i,
  grid_energy: /\b(power|grid|utility|electricity|renewable|clean[-\s]?energy|solar|wind|battery|energy)\b/i,
  space_defense: /\b(space|launch|satellite|rocket|defense|missile|munitions?|aerospace)\b/i,
  semiconductors: /\b(semiconductor|chip|wafer|foundry|packaging|hbm|euv|substrate)\b/i,
  industrial_materials: /\b(industrial|materials?|gas|chemical|steel|copper|alloy|mining|feedstock|fluid)\b/i,
  finance_risk: /\b(insurance|reinsurance|bank|credit|risk|financial|warranty|claims?)\b/i,
  transport_consumer: /\b(aviation|airline|travel|logistics|shipping|rail|auto|consumer|retail)\b/i,
  health_life_science: /\b(health|biotech|pharma|drug|medical|glp[-\s]?1|hospital|life[-\s]?science)\b/i,
  cyber_security: /\b(cyber|security|identity|ransomware|vulnerability|incident)\b/i,
  nuclear_heavy_industry: /\b(nuclear|reactor|smr|forging|turbine|ha?leu|uranium)\b/i,
});

const DOMAIN_CATEGORY_MAP = Object.freeze({
  ai_data_center: 'compute',
  ai_ml: 'compute',
  clean_energy: 'grid_energy',
  space: 'space_defense',
  defense: 'space_defense',
  defense_industrial: 'space_defense',
  semiconductor: 'semiconductors',
  cybersecurity: 'cyber_security',
  industrial_materials: 'industrial_materials',
  insurance_finance: 'finance_risk',
  aviation_transport: 'transport_consumer',
  healthcare: 'health_life_science',
  nuclear: 'nuclear_heavy_industry',
});

const CLOSE_CATEGORY_PAIRS = new Set([
  'compute|grid_energy',
  'compute|semiconductors',
  'grid_energy|industrial_materials',
  'grid_energy|nuclear_heavy_industry',
  'health_life_science|transport_consumer',
]);

const FAR_CATEGORY_PAIRS = new Set([
  'compute|finance_risk',
  'compute|transport_consumer',
  'space_defense|industrial_materials',
  'space_defense|finance_risk',
  'space_defense|health_life_science',
  'space_defense|semiconductors',
  'health_life_science|grid_energy',
  'health_life_science|semiconductors',
  'cyber_security|industrial_materials',
  'cyber_security|grid_energy',
  'nuclear_heavy_industry|compute',
]);

const BROAD_THEME_TOKENS = new Set([
  'ai', 'ml', 'cloud', 'compute', 'data', 'center', 'power', 'grid', 'energy',
  'interconnection', 'utility',
  'space', 'defense', 'semiconductor', 'chip', 'clean', 'cyber', 'security',
  'infrastructure', 'technology', 'platform', 'market', 'demand', 'growth',
]);

const NARROW_NODE_RE = /\b(relay|breaker|switchgear|transformer|insulation|dielectric|coolant|fluid|pump|heat exchanger|sensor|valve|cable|connector|substation|automation|control system|protection|study|consultant|permitting|permit|inspection|maintenance|test facility|test range|qualification|certification|approved supplier|single source|sole source|fuel farm|storage tank|propellant loading|feedstock|substrate|photoresist|wafer|interposer|inverter|compressor|turbine|forging|warranty|insurance)\b/i;
const BROAD_NODE_RE = /\b(theme|market|sector|platform|infrastructure|demand|growth|adoption|buildout|queue|capacity|supply|power|grid|data center|cloud|ai)\b/i;
const SCARCITY_SIGNAL_RE = /\b(lead[-\s]?time|qualification|qualified|certification|certified|single[-\s]?source|sole[-\s]?source|approved supplier|limited supplier|limited suppliers|permitting|permit|queue|backlog|test facility|test range|field failure|replacement cycle|maintenance interval|yield|utilization|capacity expansion|source expansion|shortage|constraint|bottleneck|hard to substitute|substitution|redundancy|pricing power|price increase|margin|book[-\s]?to[-\s]?bill)\b/i;
const PRICING_PATH_RE = /\b(price|pricing|margin|backlog|book[-\s]?to[-\s]?bill|revenue recognition|lead[-\s]?time|surcharge|contract renewal|guidance|capacity allocation)\b/i;
const CONSENSUS_PROFILE_VERSION = 'dynamic-consensus-v1';

function categoryPairKey(left, right) {
  return [left, right].sort().join('|');
}

function categoriesFromText(value = '') {
  const text = compactText(value, 4000);
  const categories = [];
  for (const [category, pattern] of Object.entries(THEME_CATEGORY_PATTERNS)) {
    if (pattern.test(text)) categories.push(category);
  }
  return categories;
}

export function inferDiscoveryCategories(context = {}) {
  return uniqueStrings([
    ...asArray(context.domains).map((domain) => DOMAIN_CATEGORY_MAP[String(domain || '').toLowerCase()] || domain),
    ...categoriesFromText([
      ...asArray(context.themes),
      context.ontologyKey,
      context.parentSubject,
      ...asArray(context.sourceTerms),
      compactText(context.corpus || '', 1200),
    ].join(' ')),
  ], 12)
    .map((category) => String(category || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean);
}

function categoryDistance(left, right) {
  if (!left || !right) return 0.35;
  if (left === right) return 0.12;
  const pair = categoryPairKey(left, right);
  if (FAR_CATEGORY_PAIRS.has(pair)) return 0.9;
  if (CLOSE_CATEGORY_PAIRS.has(pair)) return 0.4;
  return 0.68;
}

export function scoreThemeDistance(context = {}) {
  const categories = inferDiscoveryCategories(context);
  if (categories.length < 2) return 0.25;
  let best = 0;
  for (let i = 0; i < categories.length; i += 1) {
    for (let j = i + 1; j < categories.length; j += 1) {
      best = Math.max(best, categoryDistance(categories[i], categories[j]));
    }
  }
  return clamp(best);
}

function subjectEchoScore(phrase = '', context = {}) {
  const phraseKey = normalizeKey(phrase);
  const subjectKey = normalizeKey(context.parentSubject || context.parentSubjectKey || '');
  if (!phraseKey || !subjectKey) return 0;
  if (phraseKey === subjectKey) return 1;
  if (subjectKey.includes(phraseKey) || phraseKey.includes(subjectKey)) return 0.75;
  const phraseTokens = new Set(splitTokens(phraseKey));
  const subjectTokens = new Set(splitTokens(subjectKey));
  if (!phraseTokens.size || !subjectTokens.size) return 0;
  const overlap = [...phraseTokens].filter((token) => subjectTokens.has(token)).length;
  return overlap / Math.max(phraseTokens.size, subjectTokens.size, 1);
}

export function scoreBottleneckSpecificity(phrase = '', context = {}) {
  const text = compactText(phrase, 240);
  const tokens = splitTokens(text);
  if (!tokens.length) return 0;
  let score = 0.28;
  if (tokens.length >= 3 && tokens.length <= 6) score += 0.14;
  if (NARROW_NODE_RE.test(text)) score += 0.34;
  if (SCARCITY_SIGNAL_RE.test(text)) score += 0.12;
  if (PRICING_PATH_RE.test(text)) score += 0.06;
  const broadTokenShare = tokens.filter((token) => BROAD_THEME_TOKENS.has(token)).length / Math.max(tokens.length, 1);
  if (broadTokenShare >= 0.5 && !NARROW_NODE_RE.test(text)) score -= 0.24;
  if (BROAD_NODE_RE.test(text) && tokens.length <= 3 && !NARROW_NODE_RE.test(text)) score -= 0.1;
  score -= subjectEchoScore(text, context) * 0.25;
  return clamp(score);
}

export function scoreScarcitySignals(...values) {
  const text = compactText(values.flatMap(asArray).join(' '), 4000);
  if (!text) return 0;
  const matches = text.match(new RegExp(SCARCITY_SIGNAL_RE.source, 'gi')) || [];
  let score = Math.min(0.72, matches.length * 0.12);
  if (/\b(single[-\s]?source|sole[-\s]?source|approved supplier|qualified supplier|hard to substitute)\b/i.test(text)) score += 0.18;
  if (/\b(lead[-\s]?time|queue|backlog|test facility|permitting|field failure)\b/i.test(text)) score += 0.12;
  if (PRICING_PATH_RE.test(text)) score += 0.08;
  return clamp(score);
}

function symbolLike(value = '') {
  const text = String(value || '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(text) ? text : '';
}

function countTerm(map, value = '', weight = 1) {
  const key = normalizeKey(value);
  if (!key || key.length < 2) return;
  map.set(key, (map.get(key) || 0) + weight);
}

function collectConsensusValue(value, out = [], depth = 0) {
  if (!value || depth > 5) return out;
  if (typeof value === 'string' || typeof value === 'number') {
    const text = compactText(value, 180);
    if (text) out.push(text);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectConsensusValue(item, out, depth + 1);
    return out;
  }
  if (typeof value === 'object') {
    for (const key of [
      'symbol',
      'ticker',
      'issuerName',
      'issuer_name',
      'name',
      'label',
      'displayName',
      'subject',
      'connector',
      'lane',
      'node',
      'canonicalName',
      'normalizedKey',
      'representative_title',
      'title',
    ]) {
      collectConsensusValue(value[key], out, depth + 1);
    }
  }
  return out;
}

export function buildDynamicConsensusProfile(input = {}) {
  const termCounts = new Map();
  const symbolCounts = new Map();
  const sources = [
    ...asArray(input.consensusTerms),
    ...asArray(input.reportSubjects),
    ...asArray(input.recentReportSubjects),
    ...asArray(input.issuerDiscoveryMap),
    ...asArray(input.candidateIssuerUniverse),
    ...asArray(input.issuerUniverse),
    ...asArray(input.ontologySupplierSymbols),
    ...asArray(input.providerRows),
    ...asArray(input.backfillRows),
  ];
  for (const value of sources) {
    const extracted = collectConsensusValue(value);
    for (const item of extracted) {
      const symbol = symbolLike(item);
      if (symbol) symbolCounts.set(symbol, (symbolCounts.get(symbol) || 0) + 1);
      countTerm(termCounts, item, 1);
    }
  }
  const frequentTerms = [...termCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 80)
    .map(([term, count]) => ({ term, count }));
  const frequentSymbols = [...symbolCounts.entries()]
    .filter(([, count]) => count >= 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 60)
    .map(([symbol, count]) => ({ symbol, count }));
  return {
    version: CONSENSUS_PROFILE_VERSION,
    frequentTerms,
    frequentSymbols,
    termCount: frequentTerms.length,
    symbolCount: frequentSymbols.length,
  };
}

export function dynamicConsensusPenalty(phrase = '', context = {}) {
  const profile = context.consensusProfile || buildDynamicConsensusProfile(context);
  const phraseKey = normalizeKey(phrase);
  if (!phraseKey) {
    return {
      penalty: 0,
      basis: [],
      suppressedConsensusSymbols: [],
      profileVersion: profile.version || CONSENSUS_PROFILE_VERSION,
    };
  }
  const tokens = new Set(splitTokens(phraseKey));
  const basis = [];
  let penalty = 0;
  for (const item of asArray(profile.frequentTerms)) {
    const term = item.term || normalizeKey(item);
    if (!term || term === phraseKey) continue;
    const termTokens = new Set(splitTokens(term));
    const overlap = [...tokens].filter((token) => termTokens.has(token)).length / Math.max(tokens.size, termTokens.size, 1);
    if (overlap >= 0.5 || phraseKey.includes(term) || term.includes(phraseKey)) {
      const count = Number(item.count || 1);
      penalty += Math.min(0.24, 0.07 + Math.log2(count + 1) * 0.035);
      basis.push({ term, count, overlap: Math.round(overlap * 1000) / 1000 });
    }
  }
  const suppressedConsensusSymbols = asArray(profile.frequentSymbols)
    .filter((item) => containsTerm(phrase, item.symbol || item))
    .map((item) => item.symbol || item)
    .slice(0, 12);
  if (suppressedConsensusSymbols.length) penalty += Math.min(0.26, 0.12 + suppressedConsensusSymbols.length * 0.04);
  return {
    penalty: clamp(penalty, 0, 0.72),
    basis: basis.slice(0, 8),
    suppressedConsensusSymbols,
    profileVersion: profile.version || CONSENSUS_PROFILE_VERSION,
  };
}

export function scoreConsensusPenalty(phrase = '', context = {}) {
  const text = compactText(phrase, 240);
  const phraseKey = normalizeKey(text);
  if (!phraseKey) return 0;
  let penalty = subjectEchoScore(text, context) * 0.6;
  const tokens = splitTokens(text);
  const broadTokenShare = tokens.filter((token) => BROAD_THEME_TOKENS.has(token)).length / Math.max(tokens.length, 1);
  if (broadTokenShare >= 0.5 && !NARROW_NODE_RE.test(text)) penalty += 0.18;
  const consensusTerms = uniqueStrings([
    context.parentSubject,
    context.parentSubjectKey,
    ...asArray(context.themes),
    ...asArray(context.consensusTerms),
    ...asArray(context.issuerUniverse),
  ], 80);
  for (const term of consensusTerms) {
    const termKey = normalizeKey(term);
    if (!termKey || termKey === phraseKey) continue;
    if (termKey.includes(phraseKey) || phraseKey.includes(termKey)) {
      penalty += 0.1;
      break;
    }
  }
  const dynamic = dynamicConsensusPenalty(phrase, context);
  return clamp(Math.max(penalty, dynamic.penalty || 0));
}

export function scoreSurprise(phrase = '', context = {}) {
  const phraseTokens = new Set(splitTokens(phrase));
  if (!phraseTokens.size) return 0;
  const expectedTerms = uniqueStrings([
    context.parentSubject,
    context.parentSubjectKey,
    ...asArray(context.themes),
    ...asArray(context.domains),
    ...asArray(context.consensusTerms),
  ], 120);
  const expectedTokens = new Set(expectedTerms.flatMap(splitTokens));
  const overlap = [...phraseTokens].filter((token) => expectedTokens.has(token)).length / Math.max(phraseTokens.size, 1);
  const specificity = scoreBottleneckSpecificity(phrase, context);
  const scarcity = scoreScarcitySignals(phrase, context.sourceTerms || []);
  return clamp((1 - overlap) * 0.48 + specificity * 0.34 + scarcity * 0.18);
}

export function scoreFrontierNode({
  node = '',
  sentence = '',
  context = {},
  relationSupport = 0,
  sourceDiversity = 0,
  evidenceClasses = [],
} = {}) {
  const phrase = compactText(node, 240);
  const dynamic = dynamicConsensusPenalty(phrase, context);
  const specificity = scoreBottleneckSpecificity(phrase, context);
  const scarcity = scoreScarcitySignals(phrase, sentence, context.sourceTerms || []);
  const surprise = scoreSurprise(phrase, context);
  const relationScore = clamp(Number(relationSupport || 0) / 3);
  const diversityScore = clamp(Number(sourceDiversity || 0) / 3);
  const evidenceScore = clamp(asArray(evidenceClasses).length / 4);
  const score = clamp(
    specificity * 0.3
    + scarcity * 0.24
    + surprise * 0.22
    + relationScore * 0.1
    + diversityScore * 0.08
    + evidenceScore * 0.06
    - dynamic.penalty * 0.28,
  );
  return {
    score,
    specificity,
    scarcity,
    surprise,
    consensusPenalty: dynamic.penalty,
    consensusPenaltyBasis: dynamic.basis,
  };
}

export function scoreNonObviousBottleneckDiscovery({
  phrase = '',
  sentence = '',
  context = {},
  relationSupport = 0,
  sourceDiversity = 0,
  evidenceClasses = [],
} = {}) {
  const sourceTerms = uniqueStrings([phrase, ...asArray(context.sourceTerms)], 20);
  const enrichedContext = { ...context, sourceTerms };
  const themeDistanceScore = scoreThemeDistance(enrichedContext);
  const bottleneckSpecificityScore = scoreBottleneckSpecificity(phrase, enrichedContext);
  const scarcitySignalScore = scoreScarcitySignals(phrase, sentence, sourceTerms);
  const dynamicConsensus = dynamicConsensusPenalty(phrase, enrichedContext);
  const consensusPenalty = scoreConsensusPenalty(phrase, enrichedContext);
  const surprise = scoreSurprise(phrase, enrichedContext);
  const frontierNode = scoreFrontierNode({
    node: phrase,
    sentence,
    context: enrichedContext,
    relationSupport,
    sourceDiversity,
    evidenceClasses,
  });
  const relationScore = clamp(Number(relationSupport || 0) / 3);
  const diversityScore = clamp(Number(sourceDiversity || 0) / 3);
  const evidenceClassScore = clamp(asArray(evidenceClasses).length / 4);
  const frontierScore = clamp(
    (themeDistanceScore * 0.24)
    + (bottleneckSpecificityScore * 0.22)
    + (scarcitySignalScore * 0.18)
    + (surprise * 0.12)
    + (relationScore * 0.1)
    + (diversityScore * 0.08)
    + (evidenceClassScore * 0.06)
    - (consensusPenalty * 0.36),
  ) * 100;
  const suppressedNarrativeReason = consensusPenalty >= 0.45
    ? 'candidate echoes the current subject or a high-frequency narrative; keep it below narrower bottleneck nodes until direct scarcity evidence appears'
    : null;
  return {
    themeDistanceScore,
    bottleneckSpecificityScore,
    scarcitySignalScore,
    surpriseScore: surprise,
    frontierNodeScore: frontierNode.score,
    consensusPenalty,
    consensusPenaltyBasis: dynamicConsensus.basis,
    suppressedConsensusSymbols: dynamicConsensus.suppressedConsensusSymbols,
    consensusProfileVersion: dynamicConsensus.profileVersion,
    frontierScore,
    suppressedNarrativeReason,
  };
}

export function classifyNonObviousFrontierStatus({
  baseReady = false,
  nonObvious = {},
  hasEvidenceClass = false,
} = {}) {
  const frontierScore = Number(nonObvious.frontierScore || 0);
  const specificity = Number(nonObvious.bottleneckSpecificityScore || 0);
  const scarcity = Number(nonObvious.scarcitySignalScore || 0);
  const themeDistance = Number(nonObvious.themeDistanceScore || 0);
  const consensusPenalty = Number(nonObvious.consensusPenalty || 0);
  const frontierNode = Number(nonObvious.frontierNodeScore || 0);
  if (consensusPenalty >= 0.4 && frontierScore < 58) return 'consensus_suppressed';
  if (baseReady && hasEvidenceClass && frontierScore >= 62 && specificity >= 0.45 && scarcity >= 0.28 && themeDistance >= 0.5) {
    return 'non_obvious_bottleneck_ready';
  }
  if ((frontierScore >= 48 || frontierNode >= 0.48) && specificity >= 0.38) return 'needs_scarcity_evidence';
  if (frontierScore >= 36) return 'frontier_candidate';
  return baseReady ? 'ready_for_deep_report' : 'needs_evidence';
}

export function summarizeNonObviousScores(items = []) {
  const scored = asArray(items).map((item) => item?.nonObvious || item).filter(Boolean);
  if (!scored.length) {
    return {
      themeDistanceScore: 0,
      bottleneckSpecificityScore: 0,
      scarcitySignalScore: 0,
      surpriseScore: 0,
      frontierNodeScore: 0,
      consensusPenalty: 0,
      consensusPenaltyBasis: [],
      suppressedConsensusSymbols: [],
      consensusProfileVersion: CONSENSUS_PROFILE_VERSION,
      frontierScore: 0,
      suppressedNarrativeReason: null,
    };
  }
  const avg = (key) => scored.reduce((sum, item) => sum + Number(item[key] || 0), 0) / scored.length;
  const max = (key) => scored.reduce((best, item) => Math.max(best, Number(item[key] || 0)), 0);
  const consensusPenalty = max('consensusPenalty');
  const frontierScore = Math.max(max('frontierScore'), avg('frontierScore'));
  const suppressed = scored.find((item) => item.suppressedNarrativeReason)?.suppressedNarrativeReason || null;
  return {
    themeDistanceScore: max('themeDistanceScore'),
    bottleneckSpecificityScore: max('bottleneckSpecificityScore'),
    scarcitySignalScore: max('scarcitySignalScore'),
    surpriseScore: max('surpriseScore'),
    frontierNodeScore: max('frontierNodeScore'),
    consensusPenalty,
    consensusPenaltyBasis: scored.flatMap((item) => asArray(item.consensusPenaltyBasis)).slice(0, 8),
    suppressedConsensusSymbols: uniqueStrings(scored.flatMap((item) => asArray(item.suppressedConsensusSymbols)), 12),
    consensusProfileVersion: scored.find((item) => item.consensusProfileVersion)?.consensusProfileVersion || CONSENSUS_PROFILE_VERSION,
    frontierScore,
    suppressedNarrativeReason: suppressed,
  };
}
