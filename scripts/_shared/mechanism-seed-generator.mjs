import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  normalizeKnowledgeKey,
  stableResearchOsId,
} from './adjacency-graph.mjs';
import {
  scoreBottleneckSpecificity,
  scoreScarcitySignals,
  scoreSurprise,
} from './non-obvious-bottleneck-discovery.mjs';
import {
  loadOperatorCrossThemePrior,
  scoreUserCrossThemePriorFit,
  selectDiversifiedParentSeedPool,
} from './operator-cross-theme-prior.mjs';

export const DEFAULT_OPERATOR_SEED_PRIOR_PATH = path.join(process.cwd(), 'config', 'operator-seed-prior.json');
export const LOCAL_OPERATOR_SEED_PRIOR_PATH = path.join(process.cwd(), 'config', 'operator-seed-prior.local.json');

const GENERATOR_VERSION = 'mechanism-seed-generator-v1';

const EVIDENCE_CLASS_BY_BOTTLENECK = Object.freeze({
  power_constraint: ['power_constraint', 'capex_confirmation', 'supplier_capacity'],
  supplier_capacity: ['supplier_capacity', 'issuer_exposure', 'issuer_commentary'],
  technical_qualification: ['technical_qualification', 'supplier_capacity', 'substitution_limit'],
  permitting_regulatory: ['permitting_regulatory', 'policy_funding', 'negative_control'],
  material_input: ['material_input', 'commodity_input', 'supplier_capacity', 'substitution_limit'],
  engineering_process: ['engineering_process', 'technical_qualification', 'mechanism_validation'],
  test_facility_capacity: ['test_facility_capacity', 'technical_qualification', 'supplier_capacity'],
  provider_data_gap: ['provider_data_gap'],
  procurement_trigger: ['procurement_trigger', 'policy_funding', 'mission_award'],
  substitution_limit: ['substitution_limit', 'technical_qualification', 'negative_control'],
  commodity_input: ['commodity_input', 'supplier_capacity', 'substitution_limit'],
  cloud_revenue: ['cloud_revenue', 'capex_confirmation', 'issuer_commentary'],
  mechanism_validation: ['mechanism_validation', 'issuer_exposure', 'negative_control'],
});

const COMMON_EVIDENCE_CLASSES = Object.freeze([
  'mechanism_validation',
  'issuer_exposure',
  'market_validation',
  'negative_control',
  'historical_analog',
]);

const DOMAIN_TEMPLATES = Object.freeze([
  {
    id: 'ai_data_center_power',
    match: /\b(ai|ml|data[-\s]?center|hyperscaler|cloud|rack density|gpu|accelerator|compute)\b/i,
    guard: /\b(power|grid|interconnection|cooling|transformer|switchgear|substation|utility|electricity|megawatt|mw)\b/i,
    themeKey: 'ai-ml',
    themeLabel: 'AI / Machine Learning',
    growthDriver: 'AI compute and data-center capex expansion',
    realActivity: 'higher rack density, larger AI clusters, and new data-center campus buildout',
    physicalProcess: 'power delivery, cooling, utility interconnection, transformer procurement, and switchgear deployment',
    requiredInputs: ['transformers', 'switchgear', 'electrical steel', 'cooling equipment', 'grid interconnection capacity'],
    bottleneck: {
      label: 'grid interconnection and power-equipment lead-time constraint',
      class: 'power_constraint',
      mechanism: 'AI capex becomes deployment delay when utility interconnection, transformers, switchgear, or cooling infrastructure lag compute demand',
    },
    supplierCategory: 'grid equipment, cooling, and data-center power infrastructure suppliers',
  },
  {
    id: 'space_cryogenic_ground_support',
    match: /\b(space|launch|rocket|satellite|payload|range|propellant|cryogenic|lox|liquid oxygen|liquid hydrogen|helium)\b/i,
    themeKey: 'space',
    themeLabel: 'Space',
    growthDriver: 'launch cadence expansion',
    realActivity: 'more launch campaigns, propellant loading operations, and range turnaround cycles',
    physicalProcess: 'cryogenic storage, industrial gas supply, propellant loading, purge, pressurization, and launch ground support',
    requiredInputs: ['LOX', 'liquid hydrogen', 'helium', 'fuel farms', 'cryogenic valves', 'propellant loading equipment'],
    bottleneck: {
      label: 'cryogenic and industrial gas ground-support capacity',
      class: 'supplier_capacity',
      mechanism: 'higher launch cadence can expose shortages in LOX, liquid hydrogen, helium, storage tanks, valves, and ground-support equipment',
    },
    supplierCategory: 'cryogenic equipment, industrial gas, and launch ground-support suppliers',
  },
  {
    id: 'defense_solid_rocket_motor',
    match: /\b(defen[cs]e|missile|munition|interceptor|solid rocket motor|srm|energetic|propellant|aerojet|northrop|replenishment)\b/i,
    themeKey: 'defense-industrial',
    themeLabel: 'Defense Industrial',
    growthDriver: 'missile replenishment and allied procurement funding',
    realActivity: 'munition order growth, interceptor production ramps, and funded backlog conversion',
    physicalProcess: 'solid rocket motor production, energetic-material sourcing, qualification testing, and supplier certification',
    requiredInputs: ['solid rocket motors', 'energetic binders', 'ammonium perchlorate', 'qualified motor cases', 'test-range capacity'],
    bottleneck: {
      label: 'solid rocket motor and energetic-material qualified supplier capacity',
      class: 'supplier_capacity',
      mechanism: 'missile replenishment depends on qualified solid rocket motor capacity, energetic-material supply, and test/qualification throughput',
    },
    supplierCategory: 'solid rocket motor, energetics, and missile propulsion suppliers',
  },
  {
    id: 'glp1_fill_finish',
    match: /\b(glp[-\s]?1|obesity|diabetes|peptide|semaglutide|tirzepatide|pharma|biotech|injector|fill[-\s]?finish|cold chain)\b/i,
    themeKey: 'biotech',
    themeLabel: 'Biotech',
    growthDriver: 'GLP-1 demand growth',
    realActivity: 'large-volume peptide drug manufacturing, sterile fill-finish, device assembly, and cold-chain distribution',
    physicalProcess: 'peptide synthesis, sterile fill-finish, autoinjector component supply, device assembly, and refrigerated logistics',
    requiredInputs: ['peptide synthesis capacity', 'sterile fill-finish lines', 'autoinjectors', 'glass cartridges', 'cold-chain capacity'],
    bottleneck: {
      label: 'peptide fill-finish and autoinjector capacity',
      class: 'supplier_capacity',
      mechanism: 'GLP-1 prescription growth can translate into capacity pressure in peptide synthesis, fill-finish, injection devices, and cold-chain logistics',
    },
    supplierCategory: 'CDMO, fill-finish, autoinjector, cartridge, and cold-chain suppliers',
  },
  {
    id: 'quantum_fusion_cryogenic_vacuum',
    match: /\b(quantum|fusion|superconducting|cryogenic|vacuum|magnet|dilution refrigerator|specialty material|isotope)\b/i,
    themeKey: 'emerging-tech',
    themeLabel: 'Emerging Technology',
    growthDriver: 'quantum, fusion, and advanced research hardware scale-up',
    realActivity: 'lab-to-pilot hardware deployment, cryogenic operations, vacuum systems, and superconducting magnet procurement',
    physicalProcess: 'cryogenic cooling, high-vacuum operations, magnet fabrication, specialty material processing, and precision instrumentation',
    requiredInputs: ['cryogenic systems', 'vacuum chambers', 'superconducting magnets', 'specialty alloys', 'precision instrumentation'],
    bottleneck: {
      label: 'cryogenic, vacuum, and specialty-material qualified supply',
      class: 'technical_qualification',
      mechanism: 'quantum and fusion scale-up can be constrained by qualified cryogenic, vacuum, magnet, and specialty-material suppliers',
    },
    supplierCategory: 'cryogenic, vacuum, superconducting magnet, and specialty-material suppliers',
  },
  {
    id: 'semiconductor_advanced_packaging',
    match: /\b(semiconductor|chip|hbm|advanced packaging|cowos|substrate|interposer|euv|foundry|wafer|fab)\b/i,
    themeKey: 'semiconductor',
    themeLabel: 'Semiconductor',
    growthDriver: 'advanced semiconductor demand growth',
    realActivity: 'accelerator packaging, HBM integration, wafer processing, and foundry capacity allocation',
    physicalProcess: 'advanced packaging, substrate supply, interposer manufacturing, wafer processing, and tool qualification',
    requiredInputs: ['advanced packaging capacity', 'substrates', 'interposers', 'HBM', 'wafer tools'],
    bottleneck: {
      label: 'advanced packaging and substrate capacity',
      class: 'supplier_capacity',
      mechanism: 'AI accelerator demand can become constrained by CoWoS-like packaging, substrates, interposers, memory integration, and tool qualification',
    },
    supplierCategory: 'advanced packaging, substrate, memory, and semiconductor equipment suppliers',
  },
]);

const REPRESENTATIVE_TICKERS = new Set([
  'NVDA',
  'MSFT',
  'GOOGL',
  'GOOG',
  'META',
  'VRT',
  'ETN',
  'PWR',
  'LMT',
  'RTX',
  'TSM',
  'ASML',
  'AMD',
]);

const KNOWN_NARRATIVE_PATTERNS = Object.freeze([
  /\bAI\b.*\b(NVDA|GPU|data[-\s]?center|power)\b/i,
  /\bdata[-\s]?center\b.*\b(power|grid|VRT|ETN|PWR)\b/i,
  /\bdefen[cs]e\b.*\b(LMT|RTX|missile|budget)\b/i,
  /\bsemiconductor\b.*\b(NVDA|TSM|ASML|AI)\b/i,
]);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  const out = { ...(base || {}) };
  for (const [key, value] of Object.entries(override || {})) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compactText(value, max = 360) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function uniqueStrings(values = [], limit = 80) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
    const text = compactText(value, 240);
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

function textBlob(...values) {
  return values.flatMap(asArray).map((value) => {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (value && typeof value === 'object') return JSON.stringify(value);
    return '';
  }).join(' ');
}

function splitTerms(value = '') {
  return normalizeKnowledgeKey(value).split('-').filter((token) => token.length >= 2);
}

function countMatches(text = '', patterns = []) {
  const haystack = String(text || '').toLowerCase();
  return patterns.reduce((sum, pattern) => sum + (haystack.includes(String(pattern || '').toLowerCase()) ? 1 : 0), 0);
}

function regexesFromPatterns(patterns = []) {
  return asArray(patterns).map((pattern) => {
    try {
      return new RegExp(pattern, 'i');
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function isGenericNarrativeText(text = '', prior = {}) {
  const compact = compactText(text, 2000);
  if (!compact) return true;
  if (regexesFromPatterns(prior.genericNarrativePatterns || []).some((pattern) => pattern.test(compact))) return true;
  const key = normalizeKnowledgeKey(compact);
  const tokens = splitTerms(key);
  if (tokens.length <= 4 && /\b(ai|space|defense|biotech|semiconductor|stocks?|etf|good|buy|growth)\b/i.test(compact)) {
    return !/\b(power|grid|switchgear|cryogenic|helium|motor|binder|fill|finish|autoinjector|vacuum|magnet|substrate|interposer)\b/i.test(compact);
  }
  return false;
}

function templateForInput(input = {}) {
  const text = textBlob(
    input.themeLabel,
    input.themeKey,
    input.prompt,
    input.label,
    input.title,
    input.seedTerms,
    input.sourceTerms,
    input.evidenceClasses,
    input.metadata,
  );
  const candidates = DOMAIN_TEMPLATES
    .filter((template) => template.match.test(text) && (!template.guard || template.guard.test(text)))
    .map((template) => ({ template, score: templateMatchScore(template.id, text) }))
    .sort((left, right) => right.score - left.score);
  return candidates[0]?.template || null;
}

function templateMatchScore(templateId = '', text = '') {
  let score = 1;
  if (templateId === 'defense_solid_rocket_motor' && /\b(defen[cs]e|missile|munition|interceptor|srm|solid rocket motor|energetic|replenishment)\b/i.test(text)) score += 5;
  if (templateId === 'space_cryogenic_ground_support' && /\b(space|launch|satellite|payload|range|lox|liquid oxygen|liquid hydrogen|helium|fuel farm|propellant loading)\b/i.test(text)) score += 4;
  if (templateId === 'quantum_fusion_cryogenic_vacuum' && /\b(quantum|fusion|superconducting|dilution refrigerator|high vacuum)\b/i.test(text)) score += 5;
  if (templateId === 'glp1_fill_finish' && /\b(glp[-\s]?1|peptide|fill[-\s]?finish|autoinjector|cold chain)\b/i.test(text)) score += 5;
  if (templateId === 'ai_data_center_power' && /\b(data[-\s]?center|hyperscaler|grid|interconnection|switchgear|transformer|cooling)\b/i.test(text)) score += 5;
  if (templateId === 'semiconductor_advanced_packaging' && /\b(hbm|cowos|substrate|interposer|advanced packaging)\b/i.test(text)) score += 5;
  return score;
}

function inferTemplateFromEvidenceClass(input = {}) {
  const text = textBlob(input.evidenceClasses, input.sourceTerms, input.prompt, input.label, input.metadata);
  if (/\b(power_constraint|grid|interconnection|cooling)\b/i.test(text)) return DOMAIN_TEMPLATES.find((item) => item.id === 'ai_data_center_power');
  if (/\b(propulsion_constraint|launch_manifest|cryogenic|helium)\b/i.test(text)) return DOMAIN_TEMPLATES.find((item) => item.id === 'space_cryogenic_ground_support');
  if (/\b(procurement_trigger|mission_award|solid rocket|srm|munition)\b/i.test(text)) return DOMAIN_TEMPLATES.find((item) => item.id === 'defense_solid_rocket_motor');
  if (/\b(technical_qualification|vacuum|magnet|cryogenic)\b/i.test(text)) return DOMAIN_TEMPLATES.find((item) => item.id === 'quantum_fusion_cryogenic_vacuum');
  return null;
}

function ontologyInputsFromConfig(ontology = {}) {
  const inputs = [];
  for (const archetype of asArray(ontology.archetypes)) {
    const discovery = archetype.discovery || {};
    const drivers = asArray(discovery.drivers);
    const driver = drivers[0] || {};
    const shared = {
      source: 'ontology',
      sourceIds: [archetype.key],
      themeKey: asArray(archetype.themeIds)[0] || archetype.key,
      themeLabel: archetype.label || archetype.key,
      growthDriver: driver.name || '',
      realActivity: driver.mechanism || driver.whyNow || '',
      metadata: { archetypeKey: archetype.key, ontologyVersion: ontology.version || null },
    };
    for (const constraint of asArray(discovery.constraints)) {
      inputs.push({
        ...shared,
        label: constraint.name,
        prompt: [constraint.name, constraint.mechanism, constraint.triggerTerms, constraint.sourceQueries].flat().filter(Boolean).join(' '),
        seedTerms: uniqueStrings([constraint.name, constraint.triggerTerms], 16),
        sourceTerms: uniqueStrings([constraint.triggerTerms, constraint.sourceQueries], 20),
        evidenceClasses: [],
        suppliers: asArray(discovery.suppliers),
        components: asArray(discovery.components),
        materials: asArray(discovery.materials),
        metadata: { ...shared.metadata, constraint },
      });
    }
  }
  return inputs;
}

function researchQuestionInputs(questions = []) {
  return asArray(questions).map((question) => ({
    source: 'research_question',
    sourceIds: [question.id || question.deterministic_id || question.deterministicId].filter(Boolean),
    themeKey: asArray(question.themes)[0] || '',
    themeLabel: asArray(question.themes)[0] || '',
    label: asArray(question.seedTerms)[0] || question.prompt || question.questionType,
    prompt: question.prompt,
    seedTerms: question.seedTerms,
    sourceTerms: question.seedTerms,
    evidenceClasses: question.evidenceClasses || question.metadata?.evidenceClasses || [],
    metadata: { questionType: question.questionType, ...(question.metadata || {}) },
  }));
}

function adjacentCandidateInputs(candidates = []) {
  return asArray(candidates).map((candidate) => ({
    source: 'adjacent_lane',
    sourceIds: [candidate.candidateKey || candidate.candidate_key || candidate.id].filter(Boolean),
    themeKey: asArray(candidate.metadata?.parentThemes || candidate.themes)[0] || '',
    themeLabel: candidate.parentSubject || candidate.parent_subject || asArray(candidate.metadata?.parentThemes)[0] || '',
    label: candidate.label || candidate.lane,
    prompt: [candidate.label, candidate.lane, candidate.reason, candidate.nextAction, candidate.queryVariants].flat().filter(Boolean).join(' '),
    seedTerms: candidate.seedTerms || candidate.seed_terms || [],
    sourceTerms: candidate.sourceTerms || candidate.source_terms || [],
    evidenceClasses: candidate.evidenceClasses || candidate.evidence_classes || [],
    issuerCandidates: candidate.issuerCandidates || candidate.issuer_candidates || [],
    metadata: candidate.metadata || {},
  }));
}

function reportArtifactInputs(artifacts = []) {
  return asArray(artifacts).map((artifact) => {
    const bundle = artifact.bundle || artifact;
    const subject = bundle.subject || artifact.subject || {};
    const metadata = bundle.metadata || artifact.metadata || {};
    const discovery = subject.metadata?.discovery || metadata.discovery || {};
    return {
      source: 'report_artifact',
      sourceIds: [artifact.reportId || metadata.reportId || bundle.reportId || subject.key || subject.label].filter(Boolean),
      themeKey: asArray(bundle.themes || metadata.themes || subject.metadata?.themes)[0] || '',
      themeLabel: asArray(bundle.themeLabels || bundle.themes || metadata.themes)[0] || '',
      label: subject.label || subject.name || metadata.subject || artifact.reportId,
      prompt: textBlob(subject.label, discovery, metadata.adjacentCandidate, metadata.deepResearch?.reportClosureLedger),
      seedTerms: uniqueStrings([subject.label, discovery?.concreteBottleneckNodes, metadata.adjacentCandidate?.sourceTerms], 16),
      sourceTerms: uniqueStrings([discovery?.sourceTerms, metadata.adjacentCandidate?.sourceTerms], 20),
      evidenceClasses: uniqueStrings([metadata.deepResearch?.reportClosureLedger?.classes, metadata.reportClosureLedger?.classes].flat().map((row) => row?.evidenceClass || row?.class || row), 24),
      metadata: { reportId: artifact.reportId || metadata.reportId || null, discovery },
    };
  });
}

function normalizeInputSources(inputs = {}) {
  const direct = asArray(inputs.seeds || inputs.inputs);
  return [
    ...direct,
    ...researchQuestionInputs(inputs.researchQuestions || inputs.questions),
    ...adjacentCandidateInputs(inputs.adjacentCandidates || inputs.candidates),
    ...reportArtifactInputs(inputs.reportArtifacts || inputs.artifacts),
    ...ontologyInputsFromConfig(inputs.ontology || {}),
  ];
}

function publicIssuerCandidatesFrom(input = {}, template = {}) {
  return uniqueStrings([
    input.issuerCandidates,
    input.candidateIssuerUniverse,
    input.issuerUniverse,
    asArray(input.suppliers).map((supplier) => supplier.symbol),
    asArray(input.metadata?.suppliers).map((supplier) => supplier.symbol),
    asArray(input.metadata?.constraint?.suppliers).map((supplier) => supplier.symbol),
    template.publicIssuerCandidates,
  ], 24)
    .map((value) => String(value || '').trim().toUpperCase())
    .filter((value) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(value))
    .filter((value) => !REPRESENTATIVE_TICKERS.has(value));
}

function suppressedRepresentativeTickersFrom(input = {}, template = {}) {
  return uniqueStrings([
    input.issuerCandidates,
    input.candidateIssuerUniverse,
    input.issuerUniverse,
    asArray(input.suppliers).map((supplier) => supplier.symbol),
    asArray(input.metadata?.suppliers).map((supplier) => supplier.symbol),
    asArray(input.metadata?.constraint?.suppliers).map((supplier) => supplier.symbol),
    template.publicIssuerCandidates,
  ], 24)
    .map((value) => String(value || '').trim().toUpperCase())
    .filter((value) => REPRESENTATIVE_TICKERS.has(value));
}

function additionalInputsFromInput(input = {}) {
  return uniqueStrings([
    input.requiredInputs,
    asArray(input.materials).map((item) => item.name || item),
    asArray(input.components).map((item) => item.name || item),
    asArray(input.sourceTerms),
  ], 16);
}

function supplierCategoryFrom(input = {}, template = {}) {
  return input.supplierCategory?.label
    || input.supplierCategory
    || template.supplierCategory
    || asArray(input.suppliers).map((supplier) => supplier.name || supplier).filter(Boolean).slice(0, 3).join(', ')
    || 'specialized suppliers with direct exposure to the bottleneck';
}

function evidenceClassesForSeed(seed = {}) {
  return uniqueStrings([
    COMMON_EVIDENCE_CLASSES,
    EVIDENCE_CLASS_BY_BOTTLENECK[seed.bottleneck?.class] || [],
    seed.expectedEvidenceClasses,
  ], 24);
}

function buildEvidenceQueries(seed = {}) {
  const subject = seed.bottleneck?.label || seed.seedTitle || seed.theme?.label || 'mechanism seed';
  const supplier = seed.supplierCategory?.label || 'supplier';
  const inputs = seed.requiredInputs?.slice(0, 4).join(' ') || subject;
  const issuerSymbols = seed.supplierCategory?.publicIssuerCandidates?.slice(0, 6).join(' ');
  return uniqueStrings([
    `"${subject}" capacity qualified supplier`,
    `"${subject}" ${supplier} official company filing transcript`,
    `${inputs} bottleneck lead time backlog official source`,
    issuerSymbols ? `${issuerSymbols} "${subject}" capex exposure management commentary` : '',
    `${subject} government contract budget award technical qualification`,
  ], 8);
}

function buildCounterEvidenceQueries(seed = {}) {
  const subject = seed.bottleneck?.label || seed.seedTitle || seed.theme?.label || 'mechanism seed';
  return uniqueStrings([
    `"${subject}" easy substitutes supplier redundancy`,
    `"${subject}" no capacity constraint no shortage no lead time pressure`,
    `"${subject}" alternative suppliers substitution risk`,
    `"${subject}" demand delayed canceled procurement timing risk`,
  ], 6);
}

function scoreOperatorPreference(seed = {}, prior = {}) {
  const text = textBlob(seed.theme?.label, seed.growthDriver, seed.realActivity, seed.physicalProcess, seed.requiredInputs, seed.bottleneck, seed.supplierCategory);
  const preferHits = countMatches(text, prior.prefer || []);
  const penalizeHits = countMatches(text, prior.penalize || []);
  return clamp(0.48 + preferHits * 0.08 - penalizeHits * 0.1);
}

function scoreEvidenceability(seed = {}) {
  const text = textBlob(seed.expectedEvidenceClasses, seed.evidenceQueries, seed.bottleneck, seed.supplierCategory);
  let score = 0.28;
  if (seed.evidenceQueries?.length >= 2) score += 0.18;
  if (/\b(filing|transcript|official|government|contract|budget|patent|technical|qualification|sec|company)\b/i.test(text)) score += 0.22;
  if (seed.expectedEvidenceClasses?.includes('issuer_commentary') || seed.expectedEvidenceClasses?.includes('primary_filing')) score += 0.1;
  if (seed.expectedEvidenceClasses?.includes('market_validation')) score += 0.08;
  return clamp(score);
}

function scoreInvestability(seed = {}) {
  let score = seed.supplierCategory?.privateOnly ? 0.2 : 0.48;
  if (seed.supplierCategory?.publicIssuerCandidates?.length) score += 0.34;
  if (seed.expectedEvidenceClasses?.includes('issuer_exposure')) score += 0.12;
  if (/\b(public|listed|issuer|company|supplier)\b/i.test(textBlob(seed.supplierCategory))) score += 0.06;
  return clamp(score);
}

function scorePhysicalLinkage(seed = {}) {
  let score = 0;
  if (seed.realActivity) score += 0.18;
  if (seed.physicalProcess) score += 0.28;
  if (seed.requiredInputs?.length) score += 0.24;
  if (seed.bottleneck?.mechanism) score += 0.2;
  if (seed.supplierCategory?.label) score += 0.1;
  return clamp(score);
}

function scoreDemandElasticity(seed = {}) {
  const text = textBlob(seed.growthDriver, seed.realActivity, seed.bottleneck?.mechanism);
  let score = 0.35;
  if (/\b(capex|demand|growth|production|launch cadence|procurement|order|buildout|deployment|prescription|scale-up|capacity)\b/i.test(text)) score += 0.32;
  if (/\b(convert|translate|becomes|depends|requires|pull forward|turnaround)\b/i.test(text)) score += 0.18;
  return clamp(score);
}

function scoreCounterEvidenceRisk(seed = {}) {
  let risk = 0.5;
  if (seed.counterEvidenceQueries?.length) risk -= 0.18;
  if (/\b(substitute|alternative|redundancy|no capacity|no shortage|timing risk)\b/i.test(textBlob(seed.counterEvidenceQueries))) risk -= 0.08;
  if (seed.biasAudit?.bias_flags?.includes('single_source_risk')) risk += 0.16;
  if (seed.supplierCategory?.privateOnly) risk += 0.12;
  return clamp(risk);
}

function scoreKnownNarrative(seed = {}) {
  const text = textBlob(seed.theme?.label, seed.growthDriver, seed.realActivity, seed.physicalProcess, seed.requiredInputs, seed.bottleneck?.label, seed.bottleneck?.mechanism, seed.supplierCategory?.publicIssuerCandidates, seed.evidenceQueries);
  const narrativeHits = KNOWN_NARRATIVE_PATTERNS.filter((pattern) => pattern.test(text)).length;
  const representativeTickerHits = asArray(seed.suppressedRepresentativeTickers).length
    + asArray(seed.supplierCategory?.publicIssuerCandidates).filter((ticker) => REPRESENTATIVE_TICKERS.has(String(ticker || '').toUpperCase())).length;
  const sourceFrequencyProxy = Math.min(1, asArray(seed.lineage?.sourceIds).length / 6);
  const knownNarrativeScore = clamp(0.16 + narrativeHits * 0.22 + representativeTickerHits * 0.12 + sourceFrequencyProxy * 0.18);
  const tickerObviousnessPenalty = clamp(representativeTickerHits * 0.12);
  const knownNarrativePenalty = clamp(knownNarrativeScore * 0.18 + tickerObviousnessPenalty);
  const seedSimilarityScore = clamp(seed.biasAudit?.seed_dependence_score ?? 0);
  const priorReportOverlap = clamp(asArray(seed.lineage?.sourceIds).filter((id) => /report|rpt|adjacent-\d+/i.test(String(id || ''))).length / Math.max(1, asArray(seed.lineage?.sourceIds).length));
  const sourceNoveltyScore = clamp(1 - seedSimilarityScore - priorReportOverlap * 0.25);
  const nodeSpecificityScore = clamp((Number(seed.scores?.bottleneck_specificity ?? 0) || scoreBottleneckSpecificity(seed.bottleneck?.label || seed.seedTitle || '')));
  return {
    knownNarrativeScore,
    knownNarrativePenalty,
    representativeTickerSuppressionApplied: asArray(seed.suppressedRepresentativeTickers).length > 0,
    seedSimilarityScore,
    priorReportOverlap,
    tickerObviousnessPenalty,
    sourceNoveltyScore,
    nodeSpecificityScore,
  };
}

export function scoreMechanismSeed(seed = {}, prior = loadOperatorSeedPrior()) {
  const crossThemePrior = prior.crossThemePrior || loadOperatorCrossThemePrior();
  const physical_linkage = scorePhysicalLinkage(seed);
  const demand_elasticity = scoreDemandElasticity(seed);
  const bottleneck_specificity = clamp(scoreBottleneckSpecificity(seed.bottleneck?.label || seed.seedTitle || '', {
    parentSubject: seed.theme?.label,
    sourceTerms: seed.requiredInputs,
    themes: [seed.theme?.label],
  }));
  const scarcity_signal = scoreScarcitySignals(seed.bottleneck?.label, seed.bottleneck?.mechanism, seed.requiredInputs, seed.evidenceQueries);
  const non_obviousness = clamp(scoreSurprise(seed.bottleneck?.label || seed.seedTitle || '', {
    parentSubject: seed.theme?.label,
    sourceTerms: seed.requiredInputs,
    themes: [seed.theme?.label],
  }));
  const evidenceability = scoreEvidenceability(seed);
  const investability = scoreInvestability(seed);
  const operator_preference_score = scoreOperatorPreference(seed, prior);
  const counter_evidence_risk = scoreCounterEvidenceRisk(seed);
  const narrative = scoreKnownNarrative(seed);
  const userPrior = scoreUserCrossThemePriorFit({
    ...seed,
    scores: { ...(seed.scores || {}), ...narrative },
  }, crossThemePrior);
  const weights = prior.scoringWeights || {};
  const positive = (
    physical_linkage * Number(weights.physical_linkage ?? 0.18)
    + demand_elasticity * Number(weights.demand_elasticity ?? 0.06)
    + bottleneck_specificity * Number(weights.bottleneck_specificity ?? 0.18)
    + scarcity_signal * Number(weights.scarcity_signal ?? 0.14)
    + non_obviousness * Number(weights.non_obviousness ?? 0.12)
    + evidenceability * Number(weights.evidenceability ?? 0.16)
    + investability * Number(weights.investability ?? 0.12)
    + operator_preference_score * Number(weights.operator_preference_score ?? 0.04)
    + userPrior.userCrossThemePriorFit * Number(crossThemePrior.scoring?.userPriorFitWeightMax ?? 0.15)
  );
  const composite_seed_score = clamp(
    positive
    - (counter_evidence_risk * Number(weights.counter_evidence_risk_penalty ?? 0.04))
    - narrative.knownNarrativePenalty * 0.08,
  );
  return {
    physical_linkage,
    demand_elasticity,
    bottleneck_specificity,
    scarcity_signal,
    non_obviousness,
    evidenceability,
    investability,
    counter_evidence_risk,
    operator_preference_score,
    composite_seed_score,
    ...narrative,
    ...userPrior,
  };
}

function sourceTypeFromRef(ref = {}) {
  if (typeof ref === 'string') return ref;
  return ref.sourceType || ref.source_type || ref.provider || ref.source || ref.type || '';
}

function regionFromRef(ref = {}) {
  if (typeof ref === 'string') {
    if (/\b(dart|korea|krx|edinet|tdnet|japan|eu|ted|europe)\b/i.test(ref)) return ref.match(/\b(dart|korea|krx|edinet|tdnet|japan|eu|ted|europe)\b/i)?.[0]?.toLowerCase() || '';
    if (/\b(sec|usaspending|dod|war\.gov|defense\.gov|eia|ferc|us)\b/i.test(ref)) return 'us';
    return '';
  }
  return ref.region || ref.country || ref.jurisdiction || '';
}

function sourceCounts(seed = {}, context = {}) {
  const refs = [
    ...asArray(context.sourceRefs),
    ...asArray(seed.lineage?.sourceRefs),
    ...asArray(seed.lineage?.sourceTypes),
  ];
  const sourceTypes = uniqueStrings(refs.map(sourceTypeFromRef), 30);
  const regions = uniqueStrings(refs.map(regionFromRef), 20);
  const typeText = sourceTypes.join(' ');
  return {
    sourceTypes,
    regions,
    official: sourceTypes.filter((type) => /\b(official|sec|filing|company|government|dod|war|defense|usaspending|eia|ferc|fda|patent)\b/i.test(type)).length,
    trade: sourceTypes.filter((type) => /\b(trade|industry|specialist|media)\b|trade[_-]?media/i.test(type)).length,
    research: sourceTypes.filter((type) => /\b(openalex|paper|patent|lens|research|github)\b/i.test(type)).length,
    company: sourceTypes.filter((type) => /\b(company|ir|sec|filing|transcript|fmp)\b/i.test(type)).length,
    government: sourceTypes.filter((type) => /\b(government|dod|war|defense|usaspending|eia|ferc|fda|budget|ted|dart|edinet|tdnet)\b/i.test(type)).length,
    hasTrade: /\b(trade|industry|specialist|media)\b|trade[_-]?media/i.test(typeText),
  };
}

function providerGapsForSeed(seed = {}, missingSources = [], prior = {}) {
  const labels = new Set();
  const text = textBlob(seed.theme?.label, seed.bottleneck, seed.requiredInputs, seed.physicalProcess, seed.expectedEvidenceClasses);
  const configured = prior.providerGapLabels || {};
  if (missingSources.includes('missing_non_us_source')) {
    for (const label of asArray(configured.non_us_source)) labels.add(label);
  }
  if (missingSources.includes('missing_trade_press_source')) {
    for (const label of asArray(configured.trade_media)) labels.add(label);
  }
  if (/\b(technical|qualification|patent|cryogenic|vacuum|magnet|peptide|autoinjector|substrate|interposer)\b/i.test(text)) {
    for (const label of asArray(configured.patent_or_technical)) labels.add(label);
  }
  if (/\b(power|grid|interconnection|utility|switchgear|transformer)\b/i.test(text)) {
    for (const label of asArray(configured.grid_interconnection)) labels.add(label);
  }
  if (/\b(procurement|contract|award|budget|defense|missile|munition)\b/i.test(text)) {
    for (const label of asArray(configured.procurement)) labels.add(label);
  }
  return [...labels].filter(Boolean).sort();
}

export function auditSeedSourceCoverage(seed = {}, context = {}, prior = loadOperatorSeedPrior()) {
  const expectations = prior.sourceCoverageExpectations || {};
  const counts = sourceCounts(seed, context);
  const missing = new Set();
  const biasFlags = new Set();
  if (counts.regions.length < Number(expectations.region_diversity_min ?? 1)) missing.add('missing_non_us_source');
  if (counts.sourceTypes.length < Number(expectations.source_type_min ?? 2)) biasFlags.add('source_type_monoculture');
  if (counts.official < Number(expectations.official_source_min ?? 1)) missing.add('missing_official_company_source');
  if (counts.government < 1 && /\b(procurement|policy|mission|defense|grid|power|fda|government|budget)\b/i.test(textBlob(seed))) {
    missing.add('missing_government_or_regulatory_source');
  }
  if (!counts.hasTrade && counts.trade < 1) missing.add('missing_trade_press_source');
  if (/\b(technical|qualification|patent|cryogenic|vacuum|magnet|peptide|autoinjector|substrate|interposer)\b/i.test(textBlob(seed))) {
    missing.add('missing_patent_or_technical_source');
  }
  const singleSourcePenalty = counts.sourceTypes.length <= 1 ? 0.25 : 0;
  if (singleSourcePenalty > 0) biasFlags.add('single_source_risk');
  const seedDependenceScore = clamp(Number(seed.lineage?.source === 'ontology' ? 0.25 : 0.1) + singleSourcePenalty);
  const missing_sources = [...missing].sort();
  return {
    source_region_diversity: counts.regions.length,
    source_type_diversity: counts.sourceTypes.length,
    official_source_count: counts.official,
    trade_source_count: counts.trade,
    research_source_count: counts.research,
    company_source_count: counts.company,
    government_source_count: counts.government,
    single_source_penalty: singleSourcePenalty,
    seed_dependence_score: seedDependenceScore,
    missing_sources,
    provider_gap_labels: providerGapsForSeed(seed, missing_sources, prior),
    bias_flags: [...biasFlags].sort(),
  };
}

function statusForSeed(seed = {}, prior = {}) {
  if (seed.rejectedReasons?.length) return 'rejected';
  const hasStructure = Boolean(seed.theme?.label && seed.growthDriver && seed.realActivity && seed.physicalProcess && seed.requiredInputs?.length && seed.bottleneck?.label && seed.supplierCategory?.label);
  const hasQueries = seed.evidenceQueries?.length > 0 && seed.counterEvidenceQueries?.length > 0;
  if (hasStructure && hasQueries && Number(seed.scores?.composite_seed_score || 0) >= Number(prior.statusThresholds?.needs_evidence_min ?? 0.55)) {
    return 'needs_evidence';
  }
  return 'draft';
}

function rejectedReasonsForSeed(seed = {}, prior = {}) {
  const reasons = [];
  const text = textBlob(seed.theme?.label, seed.growthDriver, seed.realActivity, seed.physicalProcess, seed.requiredInputs, seed.bottleneck?.label, seed.supplierCategory?.label, seed.evidenceQueries);
  if (isGenericNarrativeText(text, prior)) reasons.push('generic_theme_narrative');
  if (!seed.physicalProcess) reasons.push('missing_physical_process');
  if (!seed.requiredInputs?.length) reasons.push('missing_required_input');
  if (!seed.counterEvidenceQueries?.length) reasons.push('missing_counter_evidence_query');
  if (!seed.evidenceQueries?.length) reasons.push('missing_evidence_query');
  return uniqueStrings(reasons, 10);
}

function seedTitle(seed = {}) {
  const input = seed.requiredInputs?.[0] || seed.bottleneck?.label || seed.theme?.label || 'mechanism seed';
  return `${seed.theme?.label || 'Theme'} -> ${input} -> ${seed.bottleneck?.label || 'bottleneck'}`;
}

export function normalizeMechanismSeed(input = {}, options = {}) {
  const prior = options.prior || loadOperatorSeedPrior();
  const template = input.template || templateForInput(input) || inferTemplateFromEvidenceClass(input) || {};
  const themeKey = normalizeKnowledgeKey(input.themeKey || input.theme?.key || template.themeKey || asArray(input.themes)[0] || '');
  const themeLabel = input.themeLabel || input.theme?.label || template.themeLabel || input.themeKey || asArray(input.themes)[0] || 'Unmapped Theme';
  const bottleneck = {
    ...(template.bottleneck || {}),
    ...(typeof input.bottleneck === 'object' ? input.bottleneck : {}),
  };
  if (!bottleneck.label) bottleneck.label = input.label || asArray(input.seedTerms)[0] || compactText(input.prompt, 80);
  const inputClass = input.bottleneckClass || asArray(input.evidenceClasses).find((klass) => EVIDENCE_CLASS_BY_BOTTLENECK[klass]);
  if (inputClass) bottleneck.class = inputClass;
  if (!bottleneck.class) bottleneck.class = 'mechanism_validation';
  if (!bottleneck.mechanism) bottleneck.mechanism = input.mechanism || template.bottleneck?.mechanism || input.prompt || '';
  const supplierCategory = {
    label: supplierCategoryFrom(input, template),
    publicIssuerCandidates: publicIssuerCandidatesFrom(input, template),
    privateOnly: Boolean(input.privateOnly || input.supplierCategory?.privateOnly),
  };
  const seed = {
    seedId: '',
    seedTitle: '',
    status: 'draft',
    theme: { key: themeKey, label: themeLabel },
    growthDriver: input.growthDriver || template.growthDriver || asArray(input.seedTerms)[0] || themeLabel,
    realActivity: input.realActivity || template.realActivity || input.prompt || '',
    physicalProcess: input.physicalProcess || template.physicalProcess || '',
    requiredInputs: uniqueStrings([input.requiredInputs, template.requiredInputs, additionalInputsFromInput(input)], 16),
    bottleneck,
    supplierCategory,
    evidenceQueries: uniqueStrings([input.evidenceQueries], 12),
    counterEvidenceQueries: uniqueStrings([input.counterEvidenceQueries], 12),
    expectedEvidenceClasses: uniqueStrings([COMMON_EVIDENCE_CLASSES, input.expectedEvidenceClasses, input.evidenceClasses, EVIDENCE_CLASS_BY_BOTTLENECK[bottleneck.class] || []], 24),
    scores: {},
    biasAudit: {},
    providerGaps: [],
    rejectedReasons: [],
    suppressedRepresentativeTickers: suppressedRepresentativeTickersFrom(input, template),
    seedLockAudit: {},
    lineage: {
      source: input.source || 'direct',
      sourceIds: uniqueStrings(input.sourceIds || [input.id], 12),
      sourceRefs: asArray(input.sourceRefs),
      sourceTypes: uniqueStrings(input.sourceTypes || input.discoveredFrom || [], 12),
      generatorVersion: GENERATOR_VERSION,
      generatedAt: options.generatedAt || new Date().toISOString(),
    },
  };
  seed.expectedEvidenceClasses = evidenceClassesForSeed(seed);
  seed.evidenceQueries = uniqueStrings([seed.evidenceQueries, buildEvidenceQueries(seed)], 12);
  seed.counterEvidenceQueries = uniqueStrings([seed.counterEvidenceQueries, buildCounterEvidenceQueries(seed)], 8);
  seed.seedTitle = seedTitle(seed);
  seed.seedId = stableMechanismSeedId(seed);
  seed.biasAudit = auditSeedSourceCoverage(seed, { sourceRefs: input.sourceRefs }, prior);
  seed.providerGaps = seed.biasAudit.provider_gap_labels || [];
  seed.scores = scoreMechanismSeed(seed, prior);
  seed.seedLockAudit = {
    seedSimilarityScore: seed.scores.seedSimilarityScore,
    seedDependenceScore: seed.biasAudit.seed_dependence_score,
    priorReportOverlap: seed.scores.priorReportOverlap,
    sourceNoveltyScore: seed.scores.sourceNoveltyScore,
    representativeTickerSuppressionApplied: seed.scores.representativeTickerSuppressionApplied,
    suppressedRepresentativeTickers: seed.suppressedRepresentativeTickers,
    userCrossThemePriorFit: seed.scores.userCrossThemePriorFit,
    matchedUserPriorIds: seed.scores.matchedUserPriorIds,
    matchedDistantThemes: seed.scores.matchedDistantThemes,
    parentOnlyDueToKnownNarrative: seed.scores.parentOnlyDueToKnownNarrative,
  };
  seed.metadata = {
    ...(seed.metadata || {}),
    userCrossThemePrior: {
      role: 'exploration_prior_only',
      userCrossThemePriorFit: seed.scores.userCrossThemePriorFit,
      matchedUserPriorIds: seed.scores.matchedUserPriorIds,
      matchedDistantThemes: seed.scores.matchedDistantThemes,
      connectorClassFit: seed.scores.connectorClassFit,
      preferredNodeMatch: seed.scores.preferredNodeMatch,
      avoidNarrativeHit: seed.scores.avoidNarrativeHit,
      parentOnlyDueToKnownNarrative: seed.scores.parentOnlyDueToKnownNarrative,
      canRaiseReportReadiness: false,
      canRaiseInvestmentReadiness: false,
    },
    parentOnlyDueToKnownNarrative: seed.scores.parentOnlyDueToKnownNarrative,
  };
  seed.rejectedReasons = rejectedReasonsForSeed(seed, prior);
  if (seed.rejectedReasons.includes('generic_theme_narrative')) {
    seed.scores = {
      ...seed.scores,
      composite_seed_score: Math.min(Number(seed.scores.composite_seed_score || 0), 0.2),
    };
  }
  seed.status = statusForSeed(seed, prior);
  return seed;
}

export function stableMechanismSeedId(seed = {}) {
  return `msd-${stableResearchOsId([
    normalizeKnowledgeKey(seed.theme?.key || seed.theme?.label || ''),
    normalizeKnowledgeKey(seed.growthDriver || ''),
    normalizeKnowledgeKey(seed.physicalProcess || ''),
    normalizeKnowledgeKey(seed.bottleneck?.label || ''),
    ...uniqueStrings(seed.requiredInputs || [], 8).map(normalizeKnowledgeKey).sort(),
  ])}`;
}

function sortSeeds(left, right) {
  return Number(right.scores?.composite_seed_score || 0) - Number(left.scores?.composite_seed_score || 0)
    || String(left.seedId).localeCompare(String(right.seedId));
}

export function generateMechanismSeeds(inputs = {}, options = {}) {
  const prior = options.prior || loadOperatorSeedPrior(options);
  const crossThemePrior = options.crossThemePrior || loadOperatorCrossThemePrior(options);
  prior.crossThemePrior = crossThemePrior;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const minScore = options.minScore === undefined ? null : Number(options.minScore);
  const includeRejected = Boolean(options.includeRejected);
  const limit = Math.max(0, Number(options.limit || 50));
  const normalizedInputs = normalizeInputSources(inputs);
  const byId = new Map();
  const diagnostics = {
    inputCount: normalizedInputs.length,
    rejectedCount: 0,
    duplicateCount: 0,
    genericNarrativeRejected: 0,
  };
  for (const input of normalizedInputs) {
    const seed = normalizeMechanismSeed(input, { ...options, prior, generatedAt });
    if (seed.status === 'rejected') {
      diagnostics.rejectedCount += 1;
      if (seed.rejectedReasons.includes('generic_theme_narrative')) diagnostics.genericNarrativeRejected += 1;
      if (!includeRejected) continue;
    }
    if (minScore !== null && Number.isFinite(minScore) && Number(seed.scores?.composite_seed_score || 0) < minScore) continue;
    if (byId.has(seed.seedId)) {
      diagnostics.duplicateCount += 1;
      const existing = byId.get(seed.seedId);
      existing.lineage.sourceIds = uniqueStrings([existing.lineage.sourceIds, seed.lineage.sourceIds], 24);
      existing.lineage.sourceTypes = uniqueStrings([existing.lineage.sourceTypes, seed.lineage.sourceTypes], 24);
      continue;
    }
    byId.set(seed.seedId, seed);
  }
  const eligibleSeeds = [...byId.values()].sort(sortSeeds);
  const rejectedSeeds = eligibleSeeds.filter((seed) => seed.status === 'rejected');
  const selectableSeeds = eligibleSeeds.filter((seed) => seed.status !== 'rejected');
  const parentSelection = crossThemePrior.selectionPolicy?.disableTopOneParentSelection !== false
    ? selectDiversifiedParentSeedPool(selectableSeeds, {
      crossThemePrior,
      parentPoolSize: Math.min(Math.max(Number(options.parentPoolSize || crossThemePrior.selectionPolicy?.parentPoolSize || 10), 8), 12),
    })
    : { ok: true, topOneSelectionDisabled: false, selected: selectableSeeds };
  const selectedSeeds = crossThemePrior.selectionPolicy?.disableTopOneParentSelection !== false
    ? parentSelection.selected
    : selectableSeeds;
  const outputSeeds = includeRejected ? [...selectedSeeds, ...rejectedSeeds] : selectedSeeds;
  const seeds = outputSeeds.slice(0, limit || undefined);
  const statusCounts = seeds.reduce((acc, seed) => {
    acc[seed.status] = (acc[seed.status] || 0) + 1;
    return acc;
  }, {});
  const providerGapCounts = seeds.reduce((acc, seed) => {
    for (const gap of seed.providerGaps || []) acc[gap] = (acc[gap] || 0) + 1;
    return acc;
  }, {});
  return {
    ok: true,
    version: GENERATOR_VERSION,
    generatedAt,
    seeds,
    summary: {
      generated: seeds.length,
      statusCounts,
      providerGapCounts,
      diagnostics,
      parentSelection: {
        topOneSelectionDisabled: parentSelection.topOneSelectionDisabled,
        parentPoolSize: parentSelection.parentPoolSize || seeds.length,
        selectionMethod: parentSelection.selectionMethod || 'composite_score',
        bucketDistribution: parentSelection.bucketDistribution || {},
      },
      readOnly: true,
      dbWrites: 0,
      approvalQueueWrites: 0,
      canonicalWrites: 0,
    },
  };
}

export function buildSeedEvidencePlan(seed = {}) {
  return {
    seedId: seed.seedId,
    evidenceClasses: seed.expectedEvidenceClasses || [],
    evidenceQueries: seed.evidenceQueries || [],
    counterEvidenceQueries: seed.counterEvidenceQueries || [],
    providerGaps: seed.providerGaps || [],
    marketValidationPlan: {
      source: 'local_controlled_market_data',
      promotionFromSourceQueryAllowed: false,
    },
    negativeControlPlan: {
      evidenceClass: 'negative_control',
      promotionEligible: false,
      queries: seed.counterEvidenceQueries || [],
    },
    enqueueDefault: false,
    nextAction: seed.status === 'needs_evidence'
      ? 'review seed, then explicitly enqueue seed-scoped evidence collection'
      : seed.status === 'rejected'
        ? `fix or discard seed: ${(seed.rejectedReasons || []).join(', ')}`
        : 'add direct evidence or improve seed structure before collection',
  };
}

export function seedToUniversalResearchSubject(seed = {}) {
  return {
    subjectKey: seed.seedId,
    label: seed.seedTitle || seed.bottleneck?.label || seed.theme?.label,
    subjectType: 'material_or_bottleneck',
    aliases: uniqueStrings([seed.bottleneck?.label, seed.requiredInputs, seed.supplierCategory?.label], 20),
    sourceTypes: ['operator_mechanism_seed'],
    sourceRefs: [{ sourceType: 'operator_mechanism_seed', sourceId: seed.seedId }],
    priorityScore: Math.round(Number(seed.scores?.composite_seed_score || 0) * 100),
    status: seed.status,
    metadata: {
      operatorSeedId: seed.seedId,
      mechanismSeed: seed,
      seedScores: seed.scores,
      biasAudit: seed.biasAudit,
      providerGaps: seed.providerGaps,
    },
  };
}

export function loadOperatorSeedPrior(options = {}) {
  const defaultsPath = options.defaultsPath || DEFAULT_OPERATOR_SEED_PRIOR_PATH;
  const localPath = options.localPath || LOCAL_OPERATOR_SEED_PRIOR_PATH;
  const defaults = readJson(defaultsPath);
  const local = existsSync(localPath) ? readJson(localPath) : {};
  const prior = deepMerge(deepMerge(defaults, local), options.priorOverrides || {});
  validateOperatorSeedPrior(prior);
  return prior;
}

export function validateOperatorSeedPrior(prior = {}) {
  const requiredWeights = [
    'physical_linkage',
    'bottleneck_specificity',
    'evidenceability',
    'scarcity_signal',
    'investability',
    'non_obviousness',
    'demand_elasticity',
    'operator_preference_score',
    'counter_evidence_risk_penalty',
  ];
  const missing = requiredWeights.filter((key) => !Number.isFinite(Number(prior.scoringWeights?.[key])));
  if (missing.length) throw new Error(`[operator-seed-prior] missing scoring weights: ${missing.join(',')}`);
  if (!asArray(prior.prefer).length || !asArray(prior.penalize).length) {
    throw new Error('[operator-seed-prior] prefer and penalize lists are required');
  }
  return { ok: true };
}

export function mechanismSeedGeneratorVersion() {
  return GENERATOR_VERSION;
}
