import { filterIssuerSymbols, scoreOntologyAnchorFit } from './theme-ontology.mjs';
import {
  computeCrossThemeDiscoveryQuality,
  crossThemeBodyEvidence,
  discoveryTierLabel,
} from './cross-theme-discovery-quality.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(items = []) {
  return [...new Set(asArray(items).filter(Boolean))];
}

function subjectName(bundle = {}) {
  if (typeof bundle.subject === 'string') return bundle.subject;
  return bundle.subject?.displayName || bundle.subject?.subjectId || 'The subject';
}

function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function domainCard(cards = [], domain) {
  return asArray(cards).find((card) => card.domain === domain) || null;
}

function isWeak(card) {
  return !card || String(card.strength || '').toLowerCase() === 'weak';
}

function refBlock(bundle = {}, cards = []) {
  const claimIds = new Set();
  const evidenceIds = new Set();
  const metricIds = new Set();
  const figureIds = new Set();
  const caveatIds = new Set();
  for (const card of cards.filter(Boolean)) {
    asArray(card.claimIds).forEach((id) => claimIds.add(id));
    asArray(card.evidenceIds).forEach((id) => evidenceIds.add(id));
    asArray(card.metricIds).forEach((id) => metricIds.add(id));
    asArray(card.figureIds).forEach((id) => figureIds.add(id));
    asArray(card.caveatIds).forEach((id) => caveatIds.add(id));
  }
  const primary = asArray(bundle.claims)[0] || {};
  if (primary.claimId) claimIds.add(primary.claimId);
  return {
    claimIds: [...claimIds].slice(0, 5),
    evidenceIds: [...evidenceIds].slice(0, 5),
    metricIds: [...metricIds].slice(0, 5),
    figureIds: [...figureIds].slice(0, 4),
    caveatIds: [...caveatIds].slice(0, 5),
  };
}

function symbolsFromBundle(bundle = {}) {
  const ontologyIssuers = filterIssuerSymbols(bundle.metadata?.deepResearch?.ontologyPack?.issuerUniverseSymbols || []);
  if (ontologyIssuers.length) return ontologyIssuers.slice(0, 6);
  const deepIssuers = filterIssuerSymbols(bundle.metadata?.deepResearch?.limitations?.symbols || []);
  if (deepIssuers.length) return deepIssuers.slice(0, 6);
  return filterIssuerSymbols([...new Set([
    ...asArray(bundle.marketReactions).map((row) => row.symbol),
    ...asArray(bundle.metadata?.themeContext?.peerSymbols?.positive).map((row) => row.symbol),
    ...asArray(bundle.metadata?.themeContext?.peerSymbols?.negative).map((row) => row.symbol),
  ].filter(Boolean).map((symbol) => String(symbol).toUpperCase()))]).slice(0, 6);
}

function economicFocus(bundle = {}) {
  const subject = subjectName(bundle).toLowerCase();
  const ontologyKey = String(bundle.metadata?.deepResearch?.ontologyPack?.ontologyKey || '').toLowerCase();
  if (ontologyKey === 'defense_industrial' || /defense|defence|military|munitions|missile/.test(subject)) {
    return {
      demand: 'mission demand, replenishment demand, and procurement funding',
      drivers: 'backlog, book-to-bill, contract awards, procurement budget lines, munitions capacity, missile and air-defense demand, and segment revenue guidance',
      constraints: 'production capacity, supply chain resilience, shipyard throughput, program execution, and policy funding',
      exposure: 'defense primes, missile and air-defense suppliers, shipbuilders, and critical component vendors',
    };
  }
  if (/ai|machine learning|semiconductor|cloud|compute|data center/.test(subject)) {
    return {
      demand: 'AI workload growth',
      drivers: 'capex, cloud revenue, accelerator orders, data-center utilization, and power-demand proxies',
      constraints: 'compute, networking, memory, cooling, power availability, and grid connection',
      exposure: 'platform, accelerator, and infrastructure-exposed companies',
    };
  }
  if (/space|rocket|aerospace/.test(subject)) {
    return {
      demand: 'mission, launch, and procurement demand',
      drivers: 'order flow, backlog, contract awards, launch cadence, and capacity utilization',
      constraints: 'propulsion, components, manufacturing capacity, test infrastructure, and policy funding',
      exposure: 'prime contractors, suppliers, launch providers, and critical component vendors',
    };
  }
  if (/energy|power|grid|climate|fusion|clean/.test(subject)) {
    return {
      demand: 'energy-system investment demand',
      drivers: 'capex, capacity additions, utilization, offtake demand, and policy support',
      constraints: 'grid access, equipment supply, permitting, fuel inputs, and financing costs',
      exposure: 'asset owners, equipment suppliers, utilities, and bottleneck providers',
    };
  }
  return {
    demand: 'end-market demand',
    drivers: 'revenue, margins, capex, orders, backlog, utilization, pricing, and management commentary',
    constraints: 'capacity, supply chain availability, input costs, regulation, and financing conditions',
    exposure: 'companies and sectors with measurable operating leverage to the theme',
  };
}

function translateBlocker(blocker = '') {
  return translateInternalTerms(blocker)
    .replace(/\bcontrolled market validation is ([a-z-]+); strongest t-stat ([0-9.]+) is below decision-grade or lacks benchmark\/factor\/regime controls\b/gi, '$1 controlled market validation (strongest t-stat $2; no decision-grade benchmark/factor/regime confirmation)')
    .replace(/\bonly\s+(\d+)\/(\d+)\s+core investment packs are available\b/gi, 'core investment evidence is incomplete ($1/$2 evidence lanes available)')
    .replace(/\barticle sample size is unknown\b/gi, 'the article sample size is unknown')
    .replace(/\barticle sample is ([^,]+), below investment memo threshold \d+\b/gi, 'the article sample remains below investment-memo depth')
    .replace(/\bsource diversity\s+[0-9.]+\s+is below\s+[0-9.]+\b/gi, 'independent source diversity is below target')
    .replace(/\bdirect transcript coverage\s+(\d+)\/(\d+)\s+remains below the investment-memo threshold\b/gi, 'direct transcript coverage remains below the investment-memo threshold ($1/$2)')
    .replace(/\bdirect management-commentary coverage\s+(\d+)\/(\d+)\s+is below investment memo threshold\b/gi, 'direct management-commentary coverage remains below the investment-memo threshold ($1/$2)')
    .replace(/\s+/g, ' ')
    .replace(/\s+\./g, '.')
    .trim()
    .replace(/\.$/, '');
}

function joinHumanList(items = []) {
  const clean = asArray(items).map((item) => String(item || '').trim()).filter(Boolean);
  if (!clean.length) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')}, and ${clean.at(-1)}`;
}

function blockerText(bundle = {}) {
  const blockers = asArray(bundle.metadata?.deepResearch?.investmentReadiness?.blockers)
    .map(translateBlocker)
    .filter(Boolean);
  const decisionGaps = asArray(bundle.metadata?.deepResearch?.investmentReadiness?.decisionValidationGaps)
    .map(translateBlocker)
    .filter(Boolean);
  if (!blockers.length && decisionGaps.length) return joinHumanList(decisionGaps);
  if (!blockers.length) {
    const tier = bundle.metadata?.deepResearch?.investmentReadiness?.tier || '';
    return tier === 'investment_memo_candidate' ? '' : 'analyst evidence review remains open before decision use.';
  }
  return joinHumanList(blockers);
}

function ontologyMissingSummary(bundle = {}, limit = 5) {
  const missing = asArray(bundle.metadata?.deepResearch?.ontologyPack?.missingKpis)
    .filter((item) => item.critical && item.requiredFor === 'investment_memo')
    .slice(0, limit)
    .map((item) => item.displayName || item.kpiKey)
    .filter(Boolean);
  return joinHumanList(missing);
}

function blockerSummary(bundle = {}) {
  const rawBlockers = asArray(bundle.metadata?.deepResearch?.investmentReadiness?.blockers).map(String);
  const rawDecisionGaps = asArray(bundle.metadata?.deepResearch?.investmentReadiness?.decisionValidationGaps).map(String);
  const ontologyGap = rawBlockers.some((item) => /theme ontology critical KPI/i.test(item));
  const directIssuerGap = rawBlockers.some((item) => /direct issuer management-commentary|direct management-commentary|direct transcript|call-transcript|transcript/i.test(item));
  const summaries = [];
  if (ontologyGap) {
    const missing = ontologyMissingSummary(bundle);
    summaries.push(missing
      ? `missing theme-specific operating KPIs (${missing})`
      : 'missing theme-specific operating KPIs');
  }
  if (directIssuerGap) summaries.push('insufficient direct issuer management commentary');
  const other = rawBlockers
    .filter((item) => !/theme ontology critical KPI|direct issuer management-commentary|direct management-commentary|direct transcript|call-transcript|transcript/i.test(item))
    .map(translateBlocker)
    .filter(Boolean);
  const decision = rawDecisionGaps.map(translateBlocker).filter(Boolean);
  return joinHumanList([...summaries, ...other, ...decision]) || blockerText(bundle);
}

function blockerCondition(bundle = {}) {
  const rawBlockers = asArray(bundle.metadata?.deepResearch?.investmentReadiness?.blockers).map(String);
  const rawDecisionGaps = asArray(bundle.metadata?.deepResearch?.investmentReadiness?.decisionValidationGaps).map(String);
  const tier = bundle.metadata?.deepResearch?.investmentReadiness?.tier || '';
  if (!rawBlockers.length && rawDecisionGaps.length) {
    if (rawDecisionGaps.some((item) => /controlled market validation/i.test(item))) {
      return 'controlled market evidence clears benchmark, factor, and regime tests';
    }
    return rawDecisionGaps.map(translateBlocker).filter(Boolean).join(' and ');
  }
  if (!rawBlockers.length && tier === 'investment_memo_candidate') {
    return 'analyst review finds the evidence chain and controlled market checks remain supportive';
  }
  if (rawBlockers.length > 1) {
    const missingPacks = rawBlockers.some((item) => /core investment packs/i.test(item));
    const sample = rawBlockers.some((item) => /article sample/i.test(item));
    const diversity = rawBlockers.some((item) => /source diversity/i.test(item));
    const ontologyGap = rawBlockers.some((item) => /theme ontology critical KPI/i.test(item));
    const directTranscript = rawBlockers.some((item) => /direct issuer management-commentary|direct transcript|direct management-commentary|call-transcript|transcript/i.test(item));
    const conditions = [
      missingPacks ? 'core evidence lanes are populated' : null,
      sample ? 'the evidence sample reaches investment-memo depth' : null,
      diversity ? 'independent source diversity improves' : null,
      ontologyGap ? 'theme-specific operating KPIs are collected' : null,
      directTranscript ? 'direct management-commentary evidence is collected' : null,
    ].filter(Boolean);
    if (conditions.length) return joinHumanList(conditions);
  }
  const text = blockerText(bundle);
  if (/theme-specific operating KPI coverage is incomplete/i.test(text)) return 'theme-specific operating KPIs are collected';
  if (/analyst evidence review remains open/i.test(text)) return 'the next evidence review clears analyst use';
  if (/direct call-transcript evidence is still missing/i.test(text)) return 'direct call-transcript evidence is collected';
  if (/direct transcript coverage .*below (?:the )?investment-memo threshold/i.test(text)) return 'direct transcript coverage reaches the investment-memo threshold';
  if (/direct management-commentary coverage .*below (?:the )?investment-memo threshold/i.test(text)) return 'direct management-commentary coverage reaches the investment-memo threshold';
  if (/evidence sample is still below/i.test(text)) return 'the evidence sample reaches investment-memo depth';
  if (/source diversity is still below/i.test(text)) return 'independent source diversity improves';
  return text.replace(/\.$/, '');
}

function translateInternalTerms(text = '') {
  return String(text || '')
    .replace(/\bfundamentalPack\b/g, 'fundamental evidence')
    .replace(/\bfilingPack\b/g, 'primary filing evidence')
    .replace(/\btranscriptPack\b/g, 'management commentary evidence')
    .replace(/\bindustryPack\b/g, 'industry evidence')
    .replace(/\bmarketPack\b/g, 'market reaction evidence')
    .replace(/\bresearchPack\b/g, 'research and technical evidence')
    .replace(/\bpolicyPack\b/g, 'policy evidence')
    .replace(/\bcausalPack\b/g, 'causal mechanism evidence')
    .replace(/\bhistoricalAnalogPack\b/g, 'historical comparison evidence')
    .replace(/\bfeedbackPack\b/g, 'feedback memory')
    .replace(/\bpack\b/gi, 'evidence lane')
    .replace(/\bKPI spine\b/gi, 'indicator coverage')
    .replace(/\bKPI-level\b/gi, 'indicator-level')
    .replace(/\bgeneric KPI\b/gi, 'theme indicator')
    .replace(/\bfresh coverage metric is\s+[-+]?\d+(?:\.\d+)?\b/gi, 'fresh coverage still needs context')
    .replace(/\bhas\s+\d+\s+observations\b/gi, 'has supporting observations')
    .replace(/\bmaps\s+\d+\s+indicators\b/gi, 'covers multiple indicators')
    .replace(/\bqueues?\s+\d+\s+missing KPI collection jobs?:?\s*[^.]*\./gi, 'leaves several indicator checks for the research queue.')
    .replace(/\bqueued\s+\d+\s+investment-depth collection tasks?,?\s*led by\s*[^.]*\./gi, 'adds follow-up collection work to the research queue.')
    .replace(/\btranscript evidence lane still uses proxy evidence\b/gi, 'direct call-transcript evidence is still missing')
    .replace(/\btranscript pack still uses proxy evidence\b/gi, 'direct call-transcript evidence is still missing')
    .replace(/\bdirect transcript coverage\s+(\d+)\/(\d+)\s+is below investment memo threshold\b/gi, 'direct transcript coverage remains below the investment-memo threshold ($1/$2)')
    .replace(/\bdirect management-commentary coverage\s+(\d+)\/(\d+)\s+is below investment memo threshold\b/gi, 'direct management-commentary coverage remains below the investment-memo threshold ($1/$2)')
    .replace(/\bdirect issuer management-commentary coverage\s+(\d+)\/(\d+)\s+is below ontology threshold\b/gi, 'direct issuer management-commentary coverage remains below the theme-specific threshold ($1/$2)')
    .replace(/\btheme ontology critical KPI coverage\s+([0-9]+)%; missing\b/gi, 'theme-specific operating KPI coverage is incomplete; missing')
    .replace(/\bTranscript evidence lane uses SEC filing or earnings-release proxy evidence where call-level transcript excerpts are unavailable\./gi, 'Direct call-transcript evidence is missing; current management-commentary context comes from SEC filings or earnings releases.')
    .replace(/\s+/g, ' ')
    .trim();
}

function block(text, refs = {}) {
  return { text: translateInternalTerms(text), ...refs };
}

function paragraph(parts = {}, refs = {}) {
  const text = [
    parts.claim,
    parts.context,
    parts.evidenceAnchor,
    parts.interpretation,
    parts.implication,
    parts.limitation,
    parts.transition,
  ].filter(Boolean).join(' ')
    .replace(/This keeps .*? from becoming a style claim;/i, 'This keeps novelty from becoming a style claim;');
  return block(text, refs);
}

function longSection(key, title, paragraphs = [], options = {}) {
  return {
    key,
    title,
    ...(options.role ? { role: options.role } : {}),
    ...(Array.isArray(options.requiredMoves) ? { requiredMoves: options.requiredMoves } : {}),
    targetWords: options.targetWords || 0,
    paragraphs: asArray(paragraphs).filter((item) => item?.text),
  };
}

const REQUIRED_NARRATIVE_ROLES = Object.freeze([
  'current_judgment',
  'evidence_hierarchy',
  'mechanism',
  'counter_thesis',
  'caveats',
  'what_changes_view',
  'research_agenda',
]);

const ROLE_ALIASES = Object.freeze({
  judgment: 'current_judgment',
  current_read: 'current_judgment',
  current_judgment: 'current_judgment',
  executive_judgment: 'current_judgment',
  evidence: 'evidence_hierarchy',
  evidence_assessment: 'evidence_hierarchy',
  evidence_hierarchy: 'evidence_hierarchy',
  proof_hierarchy: 'evidence_hierarchy',
  mechanism: 'mechanism',
  causal_mechanism: 'mechanism',
  economic_mechanism: 'mechanism',
  transmission_path: 'mechanism',
  counter: 'counter_thesis',
  counter_thesis: 'counter_thesis',
  alternative_explanations: 'counter_thesis',
  negative_controls: 'counter_thesis',
  caveat: 'caveats',
  caveats: 'caveats',
  risks: 'caveats',
  risk: 'caveats',
  invalidators: 'what_changes_view',
  invalidator: 'what_changes_view',
  what_changes_view: 'what_changes_view',
  what_would_change_view: 'what_changes_view',
  promote_reject: 'what_changes_view',
  watch: 'what_changes_view',
  watch_next: 'what_changes_view',
  agenda: 'research_agenda',
  research_agenda: 'research_agenda',
  action_agenda: 'research_agenda',
  source_tasks: 'research_agenda',
});

const NARRATIVE_COMMON_TITLE_TOKENS = new Set([
  'AI', 'ML', 'SEC', 'ETF', 'FX', 'US', 'UK', 'EU', 'NATO', 'KPI', 'KPIS',
  'DB', 'API', 'LLM', 'PPTX', 'PDF', 'HTML', 'JSON', 'CEO', 'CFO', 'CTO',
  'CAPEX', 'OPEX', 'R&D', 'FY', 'QOQ', 'YOY',
]);

function normalizeNarrativeRole(value = '') {
  const key = String(value || '')
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
  return ROLE_ALIASES[key] || key;
}

function sectionCoveredRoles(section = {}) {
  const roles = new Set();
  const values = [
    section.role,
    ...(Array.isArray(section.roles) ? section.roles : []),
    ...(Array.isArray(section.requiredMoves) ? section.requiredMoves : []),
  ];
  for (const value of values) {
    const normalized = normalizeNarrativeRole(value);
    if (REQUIRED_NARRATIVE_ROLES.includes(normalized)) roles.add(normalized);
  }
  return roles;
}

function narrativeRoleCoverage(sections = []) {
  const covered = new Set();
  for (const section of asArray(sections)) {
    for (const role of sectionCoveredRoles(section)) covered.add(role);
  }
  const missingRoles = REQUIRED_NARRATIVE_ROLES.filter((role) => !covered.has(role));
  return {
    coveredRoles: [...covered].sort(),
    missingRoles,
    requiredRoleCoverage: Math.round(((REQUIRED_NARRATIVE_ROLES.length - missingRoles.length) / REQUIRED_NARRATIVE_ROLES.length) * 1000) / 1000,
  };
}

function allowedNarrativeTitleCorpus(context = {}) {
  const subject = typeof context.subject === 'string'
    ? context.subject
    : (context.subject?.displayName || context.subject?.subjectId || '');
  return [
    subject,
    context.reportType,
    context.thesis?.short,
    context.readerQuestion,
    context.focus?.drivers,
    context.focus?.constraints,
    context.metadata?.deepResearch?.ontologyPack?.ontologyLabel,
    context.metadata?.deepResearch?.ontologyPack?.ontologyKey,
    ...asArray(context.evidence).map((item) => item.title),
    ...asArray(context.marketReactions).map((item) => item.symbol),
    ...asArray(context.metadata?.deepResearch?.ontologyPack?.issuerUniverseSymbols),
    ...asArray(context.metadata?.themeContext?.peerSymbols?.positive).map((item) => item.symbol),
    ...asArray(context.metadata?.themeContext?.peerSymbols?.negative).map((item) => item.symbol),
  ].filter(Boolean).join(' ');
}

function unsupportedNarrativeTitleTokens(title = '', context = {}) {
  const corpus = allowedNarrativeTitleCorpus(context).toUpperCase();
  const unsupported = [];
  const tokens = String(title || '').match(/\b[A-Z][A-Z0-9&./-]{1,12}\b|\b\d{2,4}\b/g) || [];
  for (const raw of tokens) {
    const token = raw.replace(/[.]/g, '').toUpperCase();
    if (!token || NARRATIVE_COMMON_TITLE_TOKENS.has(token)) continue;
    if (/^\d+$/.test(token)) {
      if (!corpus.includes(token)) unsupported.push(raw);
      continue;
    }
    if (/^FY\d{2}$/i.test(token)) {
      if (!corpus.includes(token)) unsupported.push(raw);
      continue;
    }
    if (!corpus.includes(token)) unsupported.push(raw);
  }
  return [...new Set(unsupported)];
}

function narrativeArchetypeFor(context = {}) {
  const reportType = context.reportType || '';
  const subject = subjectName(context).toLowerCase();
  const ontologyKey = String(context.metadata?.deepResearch?.ontologyPack?.ontologyKey || '').toLowerCase();
  if (reportType === 'cross_theme_bottleneck_report') return 'cross_theme_bottleneck';
  if (reportType === 'event_signal_report') return 'event_signal';
  if (reportType === 'regime_transmission_report') return 'regime_transmission';
  if (reportType === 'symbol_signal_report') return 'symbol_issuer';
  if (reportType === 'system_quality_report') return 'system_quality';
  if (ontologyKey === 'defense_industrial' || /defense|defence|military|munitions|missile/.test(subject)) return 'theme_defense_industrial';
  return 'theme_research_memo';
}

function adaptiveTitleSpecs(archetype = 'theme_research_memo') {
  const base = {
    theme_research_memo: [
      ['executiveJudgment', 'Executive Judgment', 'current_judgment', ['current_read', 'decision_use']],
      ['contextAndWhatChanged', 'What the Market Is Trying to Decide', 'current_judgment', ['market_debate']],
      ['evidenceAssessment', 'Attention vs Operating Evidence', 'evidence_hierarchy', ['proof_hierarchy']],
      ['economicMechanism', 'Mechanism Test', 'mechanism', ['transmission_path']],
      ['issuerThesisAndValuationBridge', 'Company Exposure and Expectation Bridge', 'mechanism', ['issuer_bridge']],
      ['marketImplicationAndScenarios', 'Market Translation and Scenario Gate', 'what_changes_view', ['scenarios']],
      ['counterRisksCaveats', 'Counter-Thesis and Evidence Risks', 'counter_thesis', ['caveats']],
      ['watchAndResearchAgenda', 'What Would Change the View', 'what_changes_view', ['research_agenda']],
      ['analystConclusion', 'Analyst Conclusion', 'research_agenda', ['closing_judgment']],
    ],
    theme_defense_industrial: [
      ['executiveJudgment', 'Executive Judgment', 'current_judgment', ['current_read', 'decision_use']],
      ['contextAndWhatChanged', 'Backlog Conversion Question', 'current_judgment', ['market_debate']],
      ['evidenceAssessment', 'Defense KPI Evidence Test', 'evidence_hierarchy', ['proof_hierarchy']],
      ['economicMechanism', 'Procurement-to-Production Mechanism', 'mechanism', ['transmission_path']],
      ['issuerThesisAndValuationBridge', 'Prime-by-Prime Exposure Bridge', 'mechanism', ['issuer_bridge']],
      ['marketImplicationAndScenarios', 'Defense Peer Translation and Scenario Gate', 'what_changes_view', ['scenarios']],
      ['counterRisksCaveats', 'Counter-Thesis and Program Risks', 'counter_thesis', ['caveats']],
      ['watchAndResearchAgenda', 'KPI Backfill and Validation Agenda', 'what_changes_view', ['research_agenda']],
      ['analystConclusion', 'Analyst Conclusion', 'research_agenda', ['closing_judgment']],
    ],
    cross_theme_bottleneck: [
      ['executiveJudgment', 'Discovery Judgment', 'current_judgment', ['decision_use']],
      ['whyConnectorMatters', 'Why This Connector Matters', 'current_judgment', ['connector_role']],
      ['contextAndWhatChanged', 'Context and What Changed', 'current_judgment', ['market_debate']],
      ['sharedConstraintMap', 'Shared Constraint Map', 'mechanism', ['constraint_map']],
      ['whyNonObvious', 'Why This Is Non-Obvious', 'evidence_hierarchy', ['novelty_baseline']],
      ['whyNormalDashboardMissesIt', 'Why A Normal Theme Dashboard Would Miss It', 'mechanism', ['discovery_gap']],
      ['evidenceLadder', 'Evidence Ladder', 'evidence_hierarchy', ['proof_hierarchy']],
      ['whyNotReviewReady', 'Why Not Review-Ready Yet', 'evidence_hierarchy', ['readiness_gate']],
      ['negativeControls', 'Negative Controls', 'counter_thesis', ['invalidators']],
      ['evidenceAssessment', 'Direct Evidence Fit', 'evidence_hierarchy', ['anchor_fit']],
      ['economicMechanism', 'Bottleneck Transmission Path', 'mechanism', ['transmission_path']],
      ['issuerMarketTranslation', 'Issuer and Market Translation', 'mechanism', ['issuer_bridge']],
      ['discoveryActionBridge', 'Discovery-to-Action Bridge', 'research_agenda', ['action_bridge']],
      ['marketImplicationAndScenarios', 'Market Expression and Scenario Gate', 'what_changes_view', ['scenarios']],
      ['promotionRejection', 'What Would Promote / Reject This Candidate', 'what_changes_view', ['research_agenda']],
      ['counterRisksCaveats', 'Counter-Thesis, Risks, and Caveats', 'counter_thesis', ['caveats']],
      ['watchAndResearchAgenda', 'Source Tasks and Review Agenda', 'research_agenda', ['watch_next']],
      ['analystConclusion', 'Analyst Conclusion', 'research_agenda', ['closing_judgment']],
    ],
    event_signal: [
      ['executiveJudgment', 'Executive Judgment', 'current_judgment', ['current_read']],
      ['contextAndWhatChanged', 'What Happened', 'current_judgment', ['event_sequence']],
      ['evidenceAssessment', 'Evidence and Source Strength', 'evidence_hierarchy', ['proof_hierarchy']],
      ['economicMechanism', 'Transmission Path', 'mechanism', ['causal_chain']],
      ['marketImplicationAndScenarios', 'Affected Themes and Assets', 'what_changes_view', ['market_path']],
      ['counterRisksCaveats', 'Alternative Explanations', 'counter_thesis', ['caveats']],
      ['watchAndResearchAgenda', 'What Would Change the Read', 'what_changes_view', ['research_agenda']],
      ['analystConclusion', 'Analyst Conclusion', 'research_agenda', ['closing_judgment']],
    ],
    symbol_issuer: [
      ['executiveJudgment', 'Executive Judgment', 'current_judgment', ['current_read']],
      ['contextAndWhatChanged', 'Company Exposure Thesis', 'current_judgment', ['market_debate']],
      ['evidenceAssessment', 'Fundamental Bridge', 'evidence_hierarchy', ['proof_hierarchy']],
      ['economicMechanism', 'Operating Transmission Path', 'mechanism', ['issuer_bridge']],
      ['issuerThesisAndValuationBridge', 'Valuation and Expectation Gap', 'mechanism', ['valuation_bridge']],
      ['marketImplicationAndScenarios', 'Market Sensitivity and Scenarios', 'what_changes_view', ['scenarios']],
      ['counterRisksCaveats', 'Risk to Thesis', 'counter_thesis', ['caveats']],
      ['watchAndResearchAgenda', 'What Would Change the View', 'what_changes_view', ['research_agenda']],
      ['analystConclusion', 'Analyst Conclusion', 'research_agenda', ['closing_judgment']],
    ],
    regime_transmission: [
      ['executiveJudgment', 'Current Regime', 'current_judgment', ['current_read']],
      ['contextAndWhatChanged', 'Trigger Chain', 'current_judgment', ['market_debate']],
      ['evidenceAssessment', 'Regime Evidence Quality', 'evidence_hierarchy', ['proof_hierarchy']],
      ['economicMechanism', 'Cross-Asset Transmission', 'mechanism', ['transmission_path']],
      ['marketImplicationAndScenarios', 'Scenario Map', 'what_changes_view', ['scenarios']],
      ['counterRisksCaveats', 'Invalidators', 'counter_thesis', ['caveats']],
      ['watchAndResearchAgenda', 'Monitoring and Validation Plan', 'what_changes_view', ['research_agenda']],
      ['analystConclusion', 'Analyst Conclusion', 'research_agenda', ['closing_judgment']],
    ],
    system_quality: [
      ['executiveJudgment', 'System Trust State', 'current_judgment', ['current_read']],
      ['contextAndWhatChanged', 'Coverage Gaps', 'evidence_hierarchy', ['coverage_gaps']],
      ['evidenceAssessment', 'Data Freshness and Validation', 'evidence_hierarchy', ['proof_hierarchy']],
      ['economicMechanism', 'Failure Propagation Path', 'mechanism', ['ops_chain']],
      ['marketImplicationAndScenarios', 'Operational Risk Scenarios', 'what_changes_view', ['scenarios']],
      ['counterRisksCaveats', 'Known Limitations', 'counter_thesis', ['caveats']],
      ['watchAndResearchAgenda', 'Remediation Plan', 'what_changes_view', ['research_agenda']],
      ['analystConclusion', 'Operator Conclusion', 'research_agenda', ['closing_judgment']],
    ],
  };
  return base[archetype] || base.theme_research_memo;
}

export function buildDeterministicNarrativeStructure(plan = {}, context = {}) {
  const archetype = narrativeArchetypeFor({ ...context, reportType: context.reportType || plan.reportType });
  const presentKeys = new Set(asArray(plan.longFormSections).map((section) => section.key));
  const sections = adaptiveTitleSpecs(archetype)
    .filter(([key]) => !presentKeys.size || presentKeys.has(key))
    .map(([key, title, role, requiredMoves], index) => ({
      key,
      title,
      role,
      requiredMoves,
      evidenceAnchors: [],
      riskLevel: ['counter_thesis', 'caveats'].includes(role) ? 'high' : 'medium',
      targetWords: asArray(plan.longFormSections).find((section) => section.key === key)?.targetWords || 220,
      order: index + 1,
    }));
  const coverage = narrativeRoleCoverage(sections);
  return {
    version: 'adaptive-narrative-structure-v1',
    provider: 'deterministic_fallback',
    archetype,
    readerQuestion: plan.readerQuestion || context.readerQuestion || '',
    coreThesis: plan.thesis?.short || context.thesis?.short || '',
    sections,
    requiredRoles: REQUIRED_NARRATIVE_ROLES,
    ...coverage,
  };
}

export function validateNarrativeStructure(structure = {}, context = {}) {
  const errors = [];
  const sections = asArray(structure.sections);
  if (!sections.length) errors.push('narrativeStructure.sections is empty');
  const coverage = narrativeRoleCoverage(sections);
  if (coverage.missingRoles.length) {
    errors.push(`missing required roles: ${coverage.missingRoles.join(', ')}`);
  }
  const titles = new Set();
  for (const section of sections) {
    const title = String(section.title || '').trim();
    if (!title) {
      errors.push(`section ${section.key || '(unknown)'} is missing a title`);
      continue;
    }
    const normalized = title.toLowerCase();
    if (titles.has(normalized)) errors.push(`duplicate section title: ${title}`);
    titles.add(normalized);
    const unsupported = unsupportedNarrativeTitleTokens(title, context);
    if (unsupported.length) {
      errors.push(`unsupported title token in "${title}": ${unsupported.join(', ')}`);
    }
  }
  const rawTermPattern = /\b(raw ledger|query manifest|metric ledger|evidence-backed|fundamentalPack|transcriptPack|status warning|artifact [SABCD]|final [SABCD])\b/i;
  for (const section of sections) {
    if (rawTermPattern.test(`${section.title || ''} ${section.role || ''}`)) {
      errors.push(`section exposes internal system language: ${section.title || section.key}`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    ...coverage,
  };
}

export function applyAdaptiveNarrativeStructureToPlan(plan = {}, requestedStructure = null, context = {}) {
  const fallbackStructure = buildDeterministicNarrativeStructure(plan, { ...context, ...plan });
  let structure = requestedStructure || fallbackStructure;
  const validation = validateNarrativeStructure(structure, { ...context, ...plan });
  if (!validation.ok) {
    structure = {
      ...fallbackStructure,
      provider: 'deterministic_fallback',
      fallbackReason: validation.errors.join('; '),
      validationErrors: validation.errors,
    };
  } else {
    structure = {
      ...structure,
      version: structure.version || 'adaptive-narrative-structure-v1',
      provider: structure.provider || 'llm',
      requiredRoles: REQUIRED_NARRATIVE_ROLES,
      ...validation,
    };
  }

  const specsByKey = new Map(asArray(structure.sections).map((section) => [section.key, section]));
  const existing = asArray(plan.longFormSections);
  const existingByKey = new Map(existing.map((section) => [section.key, section]));
  const ordered = [];
  const used = new Set();
  for (const spec of asArray(structure.sections)) {
    const section = existingByKey.get(spec.key);
    if (!section) continue;
    used.add(spec.key);
    ordered.push({
      ...section,
      title: spec.title || section.title,
      role: spec.role,
      requiredMoves: asArray(spec.requiredMoves),
    });
  }
  for (const section of existing) {
    if (used.has(section.key)) continue;
    const spec = specsByKey.get(section.key);
    ordered.push({
      ...section,
      ...(spec?.title ? { title: spec.title } : {}),
      ...(spec?.role ? { role: spec.role } : {}),
      ...(spec?.requiredMoves ? { requiredMoves: asArray(spec.requiredMoves) } : {}),
    });
  }

  return {
    ...plan,
    narrativeStructure: structure,
    longFormSections: ordered,
  };
}

function adaptiveNarrativePrompt(bundle = {}, plan = {}) {
  const deterministic = buildDeterministicNarrativeStructure(plan, { ...bundle, ...plan });
  const digest = {
    reportType: bundle.reportType,
    subject: bundle.subject,
    currentArchetype: deterministic.archetype,
    requiredRoles: REQUIRED_NARRATIVE_ROLES,
    existingSections: asArray(plan.longFormSections).map((section) => ({
      key: section.key,
      currentTitle: section.title,
      targetWords: section.targetWords,
      paragraphCount: asArray(section.paragraphs).length,
    })),
    evidenceAnchors: asArray(bundle.evidence).slice(0, 10).map((item) => ({
      id: item.evidenceId,
      title: item.title,
      publisher: item.publisher,
      kind: item.kind,
    })),
    metrics: asArray(bundle.metrics).slice(0, 10).map((item) => ({
      id: item.metricId,
      name: item.name,
      value: item.value,
      unit: item.unit,
    })),
    marketReactions: asArray(bundle.marketReactions).slice(0, 8).map((item) => ({
      id: item.reactionId,
      symbol: item.symbol,
      relativeReturnPct: item.relativeReturnPct,
      tStat: item.tStat,
    })),
    thesis: plan.thesis?.short || '',
    readerQuestion: plan.readerQuestion || '',
  };
  return `You are selecting the narrative structure for an evidence-bound Lattice intelligence report.

Output JSON only. Do not create facts, companies, tickers, dates, or numbers. You may only choose section order, section titles, section roles, and rhetorical framing using the existing section keys.

Required role coverage:
${REQUIRED_NARRATIVE_ROLES.join(', ')}

Output exact shape:
{
  "version": "adaptive-narrative-structure-v1",
  "provider": "llm",
  "archetype": "short_archetype_name",
  "readerQuestion": "...",
  "coreThesis": "...",
  "sections": [
    {
      "key": "one of existingSections.key",
      "title": "client-facing heading; no unsupported entities/tickers/dates/numbers",
      "role": "one required role",
      "requiredMoves": ["optional role aliases or paragraph moves"],
      "evidenceAnchors": [],
      "riskLevel": "low|medium|high",
      "targetWords": 220
    }
  ]
}

Bundle digest:
${JSON.stringify(digest, null, 2)}

Return JSON only.`;
}

export async function buildLlmAdaptiveNarrativeStructure(bundle = {}, plan = {}, options = {}) {
  try {
    const { runCodexJsonPrompt } = await import('./codex-json.mjs');
    const result = await runCodexJsonPrompt(adaptiveNarrativePrompt(bundle, plan), options.timeoutMs || 60_000, {
      label: 'report-adaptive-narrative-structure',
      env: { CODEX_MODEL: process.env.CODEX_MODEL || 'gpt-5.4' },
    });
    if (Number(result?.code ?? 1) !== 0) {
      return {
        ok: false,
        reason: result?.failureKind || result?.stderr || result?.message || `llm_outline_exit_${result?.code ?? 'unknown'}`,
        structure: null,
      };
    }
    if (!result?.parsed) {
      return {
        ok: false,
        reason: result?.failureKind || result?.message || 'llm_outline_failed',
        structure: null,
      };
    }
    const validation = validateNarrativeStructure(result.parsed, { ...bundle, ...plan });
    return {
      ok: validation.ok,
      reason: validation.ok ? null : validation.errors.join('; '),
      structure: result.parsed,
      validation,
      raw: result.parsed,
    };
  } catch (error) {
    return {
      ok: false,
      reason: String(error?.message || error),
      structure: null,
    };
  }
}

export async function enhanceAnalysisWithAdaptiveNarrativeStructure(analysis = {}, bundle = {}, options = {}) {
  if (!analysis?.longFormSections?.length) return analysis;
  const attempt = await buildLlmAdaptiveNarrativeStructure(bundle, analysis.narrativePlan || analysis, {
    timeoutMs: options.adaptiveStructureTimeoutMs || options.codexTimeoutMs || 60_000,
  });
  const nextPlan = applyAdaptiveNarrativeStructureToPlan(
    analysis.narrativePlan || analysis,
    attempt.ok ? attempt.structure : null,
    bundle,
  );
  return applyNarrativeEditorPass({
    ...analysis,
    narrativePlan: {
      ...(analysis.narrativePlan || {}),
      narrativeStructure: nextPlan.narrativeStructure,
      longFormSections: nextPlan.longFormSections,
    },
    narrativeStructure: {
      ...nextPlan.narrativeStructure,
      provider: attempt.ok ? 'llm' : 'deterministic_fallback',
      ...(attempt.ok ? {} : { fallbackReason: attempt.reason || nextPlan.narrativeStructure?.fallbackReason || 'llm_outline_unavailable' }),
    },
    adaptiveStructureAttempted: true,
    adaptiveStructureError: attempt.ok ? null : attempt.reason,
    longFormSections: nextPlan.longFormSections,
  });
}

function focusShorthand(subject = '') {
  const lowered = String(subject || '').toLowerCase();
  if (/ai|machine learning|semiconductor|cloud|compute|data center/.test(lowered)) return 'AI infrastructure economics';
  if (/defense|defence|military|munitions|missile/.test(lowered)) return 'procurement demand, backlog, and defense production capacity';
  if (/space|rocket|aerospace/.test(lowered)) return 'mission economics and supplier capacity';
  if (/energy|power|grid|climate|fusion|clean/.test(lowered)) return 'energy-system investment economics';
  return 'operating-demand evidence';
}

function symbolList(symbols = []) {
  return symbols.length ? symbols.join(', ') : 'the monitored peer set';
}

function buildWatchBlocks({ subject, shorthand, refs }) {
  return [
    block(`Watch for external evidence that the ${subject} signal is broadening beyond media attention into ${shorthand}. The useful signs are broader independent coverage, direct management commentary, and market sensitivity that persists outside broad risk-on rallies.`, refs),
    block('Watch whether graph-derived causal links become independently supported. If they remain adjacency-only, the signal should stay under review even if the next coverage pulse looks stronger.', refs),
  ];
}

function marketControlPhrase(subject = '') {
  const lowered = String(subject || '').toLowerCase();
  if (/defense|defence|military|munitions|missile/.test(lowered)) {
    return 'broad equity, industrial, aerospace-defense ETF, rates, and risk-regime benchmarks';
  }
  if (/ai|machine learning|semiconductor|cloud|compute|data center/.test(lowered)) {
    return 'broad tech, semiconductor, sector, factor, and regime benchmarks';
  }
  return 'broad equity, sector, factor, and regime benchmarks';
}

function operatingLanguagePhrase(subject = '', focus = {}) {
  const lowered = String(subject || '').toLowerCase();
  if (/defense|defence|military|munitions|missile/.test(lowered)) {
    return 'backlog, book-to-bill, contract awards, procurement budget, munitions capacity, missile and air-defense demand, segment guidance, and program execution language';
  }
  if (String(focus.drivers || '').length > 60) {
    return 'operating-demand evidence';
  }
  return `${focus.drivers || 'demand, utilization, supply, and pricing'} language`;
}

function exposureMechanismSentence(subject = '', focus = {}) {
  const lowered = String(subject || '').toLowerCase();
  if (/defense|defence|military|munitions|missile/.test(lowered)) {
    return 'Defense primes should be tested through backlog, bookings, and segment guidance; missile and air-defense suppliers through replenishment demand and production capacity; shipbuilders through funded backlog, yard throughput, and program execution.';
  }
  if (/ai|machine learning|semiconductor|cloud|compute|data center/.test(lowered)) {
    return 'Platform companies should be tested through cloud revenue and workload monetization; accelerator suppliers through order visibility and capacity allocation; infrastructure-exposed companies through utilization, power access, cooling, and grid constraints.';
  }
  return `Relevant companies should be tested through the operating channels that connect ${focus.demand || 'demand'} to ${focus.exposure || 'issuer exposure'}.`;
}

function issuerBridgeInterpretationSentence(subject = '', focus = {}) {
  const lowered = String(subject || '').toLowerCase();
  if (/defense|defence|military|munitions|missile/.test(lowered)) {
    return 'This is the layer that turns theme relevance into issuer-specific questions: which company has backlog conversion, which has missile or air-defense exposure, which has shipyard or production-capacity risk, and which has enough valuation or consensus context to matter for review.';
  }
  if (/ai|machine learning|semiconductor|cloud|compute|data center/.test(lowered)) {
    return 'This is the layer that turns theme relevance into issuer-specific questions: which issuer monetizes AI workload growth through cloud revenue, which supplier captures accelerator or server demand, which company faces data-center power or utilization constraints, and which valuation or consensus bridge is strong enough to matter for review.';
  }
  if (/space|rocket|aerospace/.test(lowered)) {
    return 'This is the layer that turns theme relevance into issuer-specific questions: which issuer has launch cadence, mission backlog, propulsion exposure, component capacity, and valuation or consensus context strong enough to matter for review.';
  }
  if (/energy|power|grid|climate|fusion|clean/.test(lowered)) {
    return 'This is the layer that turns theme relevance into issuer-specific questions: which issuer has capacity additions, grid access, equipment exposure, offtake demand, financing sensitivity, and valuation or consensus context strong enough to matter for review.';
  }
  return `This is the layer that turns theme relevance into issuer-specific questions: which issuer has direct exposure to ${focus.drivers || 'operating demand'}, which one has the clearest fundamental bridge, and which valuation or consensus context is strong enough to matter for review.`;
}

function issuerThesisPackFromBundle(bundle = {}) {
  return bundle.metadata?.deepResearch?.packs?.issuerThesisPack || null;
}

function issuerThesisCardsFromPack(pack = {}) {
  return asArray(pack?.cards)
    .filter((card) => card?.symbol)
    .slice(0, 8);
}

function issuerThesisDataFlags(card = {}) {
  return card.dataFlags || card.metadata?.dataFlags || {};
}

function cleanIssuerBridge(text = '', fallback = '') {
  const cleaned = translateInternalTerms(text || fallback)
    .replace(/^([A-Z.=-]{1,8}) bridge:\s*management commentary and issuer facts are present;\s*\1 theme-KPI context includes[^.;]*(?:;\s*\1 attribution still requires analyst validation)?/i, '$1 bridge: direct issuer commentary and issuer facts are attached; KPI context is shown in the KPI gate; attribution still requires analyst validation')
    .replace(/^([A-Z.=-]{1,8}) issuer operating bridge pending;\s*\1 theme-KPI context includes[^.;]*/i, '$1 issuer operating bridge pending; KPI context is shown in the KPI gate')
    .replace(/\b[\w /-]+-exposed issuer;\s*validate through revenue, margin, guidance, and market sensitivity\b/gi, 'theme-exposed issuer requiring operating validation')
    .replace(/\bissuer fundamentals are not yet deep enough\b/gi, 'fundamental evidence is not yet deep enough')
    .replace(/\bvaluation\/consensus bridge is incomplete\b/gi, 'valuation and consensus bridge is incomplete')
    .replace(/\bno calibrated market-reaction row\b/gi, 'no calibrated market-reaction row is attached')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function issuerBridgeStatus(card = {}) {
  const flags = issuerThesisDataFlags(card);
  const fundamental = flags.hasFundamentals
    ? 'fundamental bridge is present'
    : 'fundamental bridge is incomplete';
  let valuation = 'valuation and consensus bridge is incomplete';
  if (flags.hasValuation && flags.hasConsensus) valuation = 'valuation and consensus bridge is present';
  else if (flags.hasValuation) valuation = 'valuation context is present but consensus is missing';
  else if (flags.hasConsensus) valuation = 'consensus context is present but valuation is missing';
  const market = flags.hasMarketReaction
    ? 'market-reaction row is attached; use the market section for calibrated magnitude'
    : 'market-reaction row is missing';
  return { fundamental, valuation, market };
}

function issuerExpectationTier(card = {}) {
  const explicit = String(card.expectationBridgeTier || card.metadata?.expectationBridgeTier || '').trim();
  if (explicit) return explicit;
  const flags = issuerThesisDataFlags(card);
  if (flags.hasConsensus && flags.hasValuation && flags.hasMarketReaction) return 'expectation_review';
  if (flags.hasConsensus || flags.hasValuation || flags.hasMarketReaction) return 'expectation_context';
  return 'incomplete';
}

function cleanIssuerExpectationBridge(card = {}) {
  return cleanIssuerBridge(
    card.expectationBridge || card.metadata?.expectationBridge || '',
    issuerExpectationTier(card) === 'incomplete' ? '' : 'expectation bridge attached',
  );
}

function issuerCardSentence(card = {}) {
  const symbol = String(card.symbol || '').toUpperCase();
  const flags = issuerThesisDataFlags(card);
  const role = cleanIssuerBridge(card.role || card.metadata?.role, 'issuer-level exposure needs role mapping');
  const operating = cleanIssuerBridge(card.operatingBridge || card.metadata?.operatingBridge, '');
  const expectation = cleanIssuerExpectationBridge(card);
  const use = card.thesisUse === 'thesis_validation' ? 'thesis-validation' : 'research-prioritization';
  const missing = [
    (flags.hasIssuerOperatingKpi || flags.hasIssuerOperatingBridge) ? null : 'issuer operating KPI bridge',
    flags.hasConsensus ? null : 'consensus',
    flags.hasValuation ? null : 'valuation',
    issuerExpectationTier(card) === 'incomplete' ? 'expectation bridge' : null,
    flags.hasIssuerCommentary ? null : 'issuer commentary',
    flags.hasMarketReaction ? null : 'controlled market read',
  ].filter(Boolean);
  const bridgeGap = missing.length ? `bridge gap for ${symbol}: ${joinHumanList(missing)}` : `bridge gap for ${symbol}: none`;
  const operatingPhrase = operating ? `; ${operating}` : '';
  const expectationPhrase = expectation ? `; expectation read: ${expectation}` : '';
  if (/^theme-exposed issuer requiring operating validation$/i.test(role)) {
    return `${symbol}: ${use} use; ${bridgeGap}${operatingPhrase}${expectationPhrase}.`;
  }
  return `${symbol}: ${role}; ${use} use; ${bridgeGap}${operatingPhrase}${expectationPhrase}.`;
}

function issuerThesisSummary(issuerThesis = {}) {
  const cards = asArray(issuerThesis.cards);
  if (!cards.length) {
    return 'No issuer-level thesis bridge is attached yet, so the report cannot explain which companies convert the theme into earnings, valuation, or downside-risk exposure.';
  }
  const thesisSymbols = cards.filter((card) => card.thesisUse === 'thesis_validation').map((card) => card.symbol);
  const expectationSymbols = cards
    .filter((card) => ['expectation_validation', 'expectation_review'].includes(issuerExpectationTier(card)))
    .map((card) => card.symbol);
  const researchSymbols = cards.filter((card) => card.thesisUse !== 'thesis_validation').map((card) => card.symbol);
  if (thesisSymbols.length && researchSymbols.length) {
    const verb = thesisSymbols.length === 1 ? 'has' : 'have';
    const expectationClause = expectationSymbols.length
      ? ` ${joinHumanList(expectationSymbols)} also ${expectationSymbols.length === 1 ? 'has' : 'have'} the clearest expectation bridge.`
      : '';
    return `${joinHumanList(thesisSymbols)} ${verb} the clearest current issuer-level bridge, while ${joinHumanList(researchSymbols)} remain research-prioritization names until issuer operating KPI evidence, consensus, valuation, issuer commentary, or market validation fills in.${expectationClause}`;
  }
  if (thesisSymbols.length) {
    const verb = thesisSymbols.length === 1 ? 'has' : 'have';
    const expectationClause = expectationSymbols.length
      ? ` The attached expectation bridge is strongest for ${joinHumanList(expectationSymbols)}.`
      : '';
    return `${joinHumanList(thesisSymbols)} ${verb} enough issuer-level evidence to support thesis-validation review; analyst approval still gates any portfolio action.${expectationClause}`;
  }
  return `${joinHumanList(cards.map((card) => card.symbol))} remain research-prioritization names because the company-level bridge is incomplete.`;
}

function issuerThesisGapSentence(issuerThesis = {}) {
  const cards = asArray(issuerThesis.cards);
  const missingOperating = cards
    .filter((card) => {
      const flags = issuerThesisDataFlags(card);
      return !(flags.hasIssuerOperatingKpi || flags.hasIssuerOperatingBridge);
    })
    .map((card) => card.symbol)
    .filter(Boolean);
  const missingConsensus = asArray(issuerThesis.missingConsensusSymbols).filter(Boolean);
  const missingValuation = asArray(issuerThesis.missingValuationSymbols).filter(Boolean);
  const missingExpectation = cards
    .filter((card) => issuerExpectationTier(card) === 'incomplete')
    .map((card) => card.symbol)
    .filter(Boolean);
  const parts = [];
  if (missingOperating.length) parts.push(`Issuer-specific operating KPI bridge is missing for ${joinHumanList(missingOperating)}`);
  if (missingConsensus.length) parts.push(`consensus is missing for ${joinHumanList(missingConsensus)}`);
  if (missingValuation.length) parts.push(`valuation context is missing for ${joinHumanList(missingValuation)}`);
  if (missingExpectation.length) parts.push(`expectation bridge is incomplete for ${joinHumanList(missingExpectation)}`);
  if (!parts.length) {
    return 'The issuer bridge has no broad consensus, valuation, or expectation-bridge coverage gap, but earnings revision, multiple expansion, and downside-risk interpretation still require analyst judgment.';
  }
  return `${parts.join('; ')}. That means the report can name company-level hypotheses, but it cannot yet translate them into earnings revision, multiple expansion, or downside-risk conclusions for the full peer set.`;
}

function issuerExamplesSentence(issuerThesis = {}) {
  const cards = asArray(issuerThesis.cards);
  if (!cards.length) return '';
  const validationCards = cards.filter((card) => card.thesisUse === 'thesis_validation');
  const partialBridgeCards = cards.filter((card) => issuerThesisDataFlags(card).hasIssuerOperatingBridge && !issuerThesisDataFlags(card).hasIssuerOperatingKpi);
  if (validationCards.length >= 3 && partialBridgeCards.length >= 3) {
    return `${joinHumanList(validationCards.map((card) => card.symbol).filter(Boolean))} are attached for thesis-validation use; the common bridge is direct issuer commentary plus fundamental evidence, with theme KPI context shown in the KPI gate and attribution still requiring analyst validation.`;
  }
  if (partialBridgeCards.length >= 3) {
    const validationSymbols = validationCards.map((card) => card.symbol).filter(Boolean);
    const researchSymbols = cards
      .filter((card) => card.thesisUse !== 'thesis_validation')
      .map((card) => card.symbol)
      .filter(Boolean);
    const validationClause = validationSymbols.length
      ? `${joinHumanList(validationSymbols)} ${validationSymbols.length === 1 ? 'has' : 'have'} the clearest thesis-validation bridge`
      : 'No issuer has a full thesis-validation bridge';
    const researchClause = researchSymbols.length
      ? `, while ${joinHumanList(researchSymbols)} remain research-prioritization names`
      : '';
    return `${validationClause}${researchClause}. Direct issuer commentary and fundamental evidence are attached, but the shared theme KPI context is shown in the KPI gate rather than repeated issuer by issuer; attribution still requires analyst validation.`;
  }
  return cards.slice(0, 4).map(issuerCardSentence).join(' ');
}

function conciseBlockerForBody(primaryBlocker = '') {
  const text = translateInternalTerms(primaryBlocker);
  const match = text.match(/missing theme-specific operating KPIs?\s*\(([^)]+)\)/i);
  if (match) return 'missing decision-grade operating KPI confirmation';
  if (text.length <= 160) return text;
  return text
    .replace(/^missing theme-specific operating KPIs?/i, 'missing decision-grade operating KPI evidence')
    .slice(0, 220)
    .replace(/,\s*[^,]*$/, '')
    .trim();
}

function blockerEvidenceTarget(followOnBlocker = '') {
  const text = String(followOnBlocker || '').trim();
  if (/missing decision-grade operating KPI confirmation/i.test(text)) {
    return 'decision-grade operating KPI confirmation';
  }
  if (/^missing\s+/i.test(text)) {
    return text.replace(/^missing\s+/i, '');
  }
  return text || 'stronger primary support';
}

function blockerContextSentence(primaryBlocker = '') {
  if (/operating KPI|book-to-bill|procurement|munitions|air-defense|backlog/i.test(primaryBlocker)) {
    return 'Direct issuer commentary and operating KPI evidence must line up before the report can connect the signal to investment-grade mechanism evidence.';
  }
  if (/management commentary|transcript/i.test(primaryBlocker)) {
    return 'Management commentary on demand, utilization, pricing, supply, or capacity is the bridge between a theme signal and a fundamental claim.';
  }
  return 'The open evidence gap is the bridge between a theme signal and an investment-grade fundamental claim.';
}

function buildResearchTasks({ subject, focus, symbols, shorthand, refs }) {
  const monitored = symbolList(symbols);
  const controls = marketControlPhrase(subject);
  const operatingLanguage = operatingLanguagePhrase(subject, focus);
  return [
    block(`Collect direct call transcripts and filing updates for ${monitored}, then extract ${operatingLanguage}. This is an executable collection task, not a client-facing watch condition.`, refs),
    block(`Recompute controlled event studies against ${controls}. Use the result to decide whether ${shorthand} is showing durable exposure or only beta to the broader market tape.`, refs),
  ];
}

function cleanAnchorTitle(title = '') {
  const cleaned = String(title || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x20-\x7E]+/g, ' ')
    .replace(/\?{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length < 8) return null;
  const questionMarkShare = (cleaned.match(/\?/g) || []).length / Math.max(1, cleaned.length);
  return questionMarkShare > 0.08 ? null : cleaned;
}

function eventAnchorFit(event = {}, focus = {}, ontologyPack = null) {
  if (event.ontologyFit && typeof event.ontologyFit === 'object') {
    const label = String(event.ontologyFit.label || 'unknown').toLowerCase();
    return {
      label,
      score: label === 'high' ? 3 : label === 'medium' ? 2 : label === 'low' ? 0.1 : 0.5,
      reason: event.ontologyFit.reason || 'Theme ontology classified this anchor',
    };
  }
  if (ontologyPack && !ontologyPack.isGenericFallback) {
    const ontologyFit = scoreOntologyAnchorFit(event, {
      key: ontologyPack.ontologyKey,
      label: ontologyPack.ontologyLabel,
      anchorFitRules: ontologyPack.anchorFitRules || ontologyPack.anchor_fit_rules || ontologyPack.rules || null,
    });
    if (ontologyFit.label !== 'unknown') {
      return {
        label: ontologyFit.label,
        score: ontologyFit.label === 'high' ? 3 : ontologyFit.label === 'medium' ? 2 : 0.1,
        reason: ontologyFit.reason,
      };
    }
  }
  const title = cleanAnchorTitle(event.title);
  const text = `${title} ${event.theme || ''} ${event.summary || ''}`.toLowerCase();
  const focusTerms = [
    ...String(focus.drivers || '').split(/[,/]| and /i),
    ...String(focus.constraints || '').split(/[,/]| and /i),
    focus.demand,
    focus.exposure,
  ].map((term) => String(term || '').trim().toLowerCase()).filter((term) => term.length >= 4);
  const highTerms = ['capex', 'capital expenditure', 'cloud revenue', 'accelerator', 'gpu', 'data center', 'datacenter', 'utilization', 'capacity', 'power demand', 'electricity', 'server', 'compute', 'memory', 'networking', 'cooling', 'infrastructure'];
  const mediumTerms = ['enterprise', 'productivity', 'platform', 'software', 'adoption', 'deployment', 'automation', 'model', 'chip', 'semiconductor'];
  const lowTerms = ['worker', 'labor', 'copyright', 'lawsuit', 'proposal', 'regulation', 'policy', 'game', 'consumer', 'culture', 'school', 'election'];
  const high = highTerms.some((term) => text.includes(term)) || focusTerms.some((term) => term && text.includes(term));
  const medium = mediumTerms.some((term) => text.includes(term));
  const low = lowTerms.some((term) => text.includes(term));
  const label = high ? 'high' : medium ? 'medium' : low ? 'low' : 'unknown';
  return {
    label,
    score: high ? 3 : medium ? 2 : low ? 0.1 : 0.5,
    reason: label === 'high'
      ? 'directly tied to the operating mechanism'
      : label === 'medium'
        ? 'adjacent to adoption or platform evidence'
        : label === 'low'
          ? 'policy, labor, consumer, or cultural adjacency rather than operating support'
          : 'not enough metadata to classify mechanism fit',
  };
}

function ontologyAnchorCandidates(ontologyPack = null) {
  if (!ontologyPack || ontologyPack.isGenericFallback) return [];
  return asArray(ontologyPack.topAnchorFits)
    .map((item) => ({
      title: cleanAnchorTitle(item.title || item.anchor?.title),
      articleCount: Number(item.articleCount || item.anchor?.articleCount || 0),
      sourceCount: Number(item.sourceCount || item.anchor?.sourceCount || 0),
      isSurge: Boolean(item.isSurge || item.anchor?.isSurge),
      isOntologyAnchor: true,
      ontologyFit: item.fit || item.anchor?.fit || null,
    }))
    .filter((item) => item.title);
}

function bestEventAnchor(bundle = {}, focus = {}) {
  const ontologyPack = bundle.metadata?.deepResearch?.ontologyPack || null;
  const events = [
    ...asArray(bundle.metadata?.themeContext?.events),
    ...ontologyAnchorCandidates(ontologyPack),
  ];
  const ranked = events
    .filter((item) => cleanAnchorTitle(item.title))
    .map((item) => {
      const fit = eventAnchorFit(item, focus, ontologyPack);
      const sourceScore = Math.min(2, Number(item.sourceCount || item.sources || 0) / 3);
      const surgeScore = item.isSurge ? 0.5 : 0;
      const canonicalScore = Number(item.articleCount || item.articles || 0) >= 10 && Number(item.sourceCount || item.sources || 0) >= 3 ? 1 : 0;
      return { item, fit, rankScore: fit.score * 3 + sourceScore + surgeScore + canonicalScore };
    })
    .sort((a, b) => b.rankScore - a.rankScore);
  const event = ranked[0]?.item || null;
  if (!event) return null;
  const title = cleanAnchorTitle(event.title);
  if (!title) return null;
  return {
    title,
    articleCount: Number(event.articleCount || 0),
    sourceCount: Number(event.sourceCount || 0),
    isCanonical: Number(event.articleCount || 0) >= 10 && Number(event.sourceCount || 0) >= 3,
    isSurge: Boolean(event.isSurge),
    fit: ranked[0]?.fit || eventAnchorFit(event, focus, ontologyPack),
  };
}

function bestMarketAnchor(bundle = {}, symbols = []) {
  const profiledRows = asArray(bundle.metadata?.deepResearch?.investmentReadiness?.marketValidation?.rows);
  const profileBest = bundle.metadata?.deepResearch?.investmentReadiness?.marketValidation?.best || null;
  if (profiledRows.length || profileBest) {
    const rankedProfileRows = (profiledRows.length ? profiledRows : [profileBest])
      .filter(Boolean)
      .sort((a, b) => (
        Number(Boolean(b.decisionGrade)) - Number(Boolean(a.decisionGrade))
        || Number(Boolean(b.screeningGrade)) - Number(Boolean(a.screeningGrade))
        || Number(b.absTStat || Math.abs(Number(b.tStat || 0))) - Number(a.absTStat || Math.abs(Number(a.tStat || 0)))
      ));
    const topRow = rankedProfileRows.find((row) => row.decisionGrade) || rankedProfileRows.find((row) => row.screeningGrade) || profileBest || rankedProfileRows[0] || null;
    return {
      symbols,
      topSymbol: topRow?.symbol || symbols[0] || null,
      validationStatus: topRow?.validationStatus || null,
      relativeReturnPct: topRow?.relativeReturnPct,
      tStat: topRow?.tStat,
      controls: topRow?.controls || [],
      eventWindow: topRow?.eventWindow || null,
      sampleSize: topRow?.sampleSize || null,
      hasRealControls: Boolean(topRow?.hasRealControls),
      decisionGrade: Boolean(topRow?.decisionGrade),
      screeningGrade: Boolean(topRow?.screeningGrade),
      marketValidationTier: bundle.metadata?.deepResearch?.investmentReadiness?.marketValidation?.tier || null,
      regimeSupportLabel: topRow?.regimeSupportLabel || null,
      regimeSupportCount: topRow?.regimeSupportCount || 0,
      regimeDistinctCount: topRow?.regimeDistinctCount || 0,
      regimeHorizonCount: topRow?.regimeHorizonCount || 0,
      regimeConsistent: Boolean(topRow?.regimeConsistent),
    };
  }
  const reactions = asArray(bundle.marketReactions)
    .filter((row) => row.symbol && !['SPY', 'QQQ', 'DIA', 'IWM', 'GLD', 'TLT', 'UUP', 'USO', 'UNG', 'DBC', 'XLE', 'XLK', 'XLV', 'EFA', 'EEM', 'ITA', 'XAR', 'PPA'].includes(String(row.symbol).toUpperCase()));
  const ranked = reactions
    .map((row) => ({ ...row, strength: Math.abs(Number(row.tStat || 0)) + Math.abs(Number(row.relativeReturnPct || 0)) / 10 }))
    .sort((a, b) => b.strength - a.strength);
  const topRow = ranked[0] || null;
  return {
    symbols,
    topSymbol: topRow?.symbol || symbols[0] || null,
    validationStatus: topRow?.validationStatus || null,
    relativeReturnPct: topRow?.relativeReturnPct,
    tStat: topRow?.tStat,
    controls: topRow?.controls || [],
    eventWindow: topRow?.eventWindow || topRow?.event_window || topRow?.window || topRow?.horizon || null,
    sampleSize: topRow?.sampleSize || null,
    hasRealControls: Boolean(topRow?.hasRealControls),
    decisionGrade: Boolean(topRow?.decisionGrade),
    screeningGrade: Boolean(topRow?.screeningGrade),
    marketValidationTier: bundle.metadata?.deepResearch?.investmentReadiness?.marketValidation?.tier || null,
    regimeSupportLabel: topRow?.regimeSupportLabel || null,
    regimeSupportCount: topRow?.regimeSupportCount || 0,
    regimeDistinctCount: topRow?.regimeDistinctCount || 0,
    regimeHorizonCount: topRow?.regimeHorizonCount || 0,
    regimeConsistent: Boolean(topRow?.regimeConsistent),
  };
}

function eventAnchorSentence(eventAnchor) {
  if (!eventAnchor) {
    return 'No named event anchor is strong enough to carry the thesis, so the evidence pattern should be read as monitoring context rather than a resolved catalyst.';
  }
  if (eventAnchor.fit?.label === 'low') {
    return `No high-fit event anchor is attached. The most visible low-fit item is "${eventAnchor.title}", which is ${eventAnchor.fit.reason}. It supports fragmentation monitoring only, not the operating-demand thesis.`;
  }
  if (eventAnchor.fit?.label === 'medium') {
    return `The current event anchor is "${eventAnchor.title}", with medium fit to the thesis: ${eventAnchor.fit.reason}. It supports monitoring, but it does not yet validate the highest-priority operating KPI channel.`;
  }
  if (eventAnchor.fit?.label === 'high' && !eventAnchor.isCanonical) {
    return `The highest-fit operating anchor is "${eventAnchor.title}", which matches the thesis mechanism: ${eventAnchor.fit.reason}. It supports mechanism monitoring, but still needs source breadth before it can be treated as a durable catalyst.`;
  }
  if (eventAnchor.isCanonical) {
    return `The main evidence anchor is "${eventAnchor.title}", which has enough article and source breadth to support a stronger follow-up check.`;
  }
  return `The main event anchor is "${eventAnchor.title}", but it remains a monitoring signal rather than a canonical event.`;
}

function marketAnchorSentence(marketAnchor, symbolPhrase) {
  if (!marketAnchor?.topSymbol) {
    return 'No single market anchor is strong enough to carry the thesis, so market evidence should remain a monitoring input rather than a trade input.';
  }
  const sample = marketAnchor.sampleSize
    || asArray(marketAnchor.controls).map(String).find((item) => /(?:sample_size|n_controls|n)=/i.test(item))?.match(/(?:sample_size|n_controls|n)=([0-9.]+)/i)?.[1];
  const tStat = Number(marketAnchor.tStat);
  const rel = Number(marketAnchor.relativeReturnPct);
  const tPhrase = Number.isFinite(tStat) ? `t-stat ${tStat.toFixed(2)}` : 'no interpretable t-stat';
  const relPhrase = Number.isFinite(rel) ? `${rel.toFixed(2)}% average relative return` : 'no calibrated relative-return magnitude';
  const samplePhrase = sample ? ` on sample size ${sample}` : '';
  const windowPhrase = marketAnchor.eventWindow ? ` over the ${marketAnchor.eventWindow} event window` : ' over the attached event window';
  const status = marketAnchor.decisionGrade
    ? 'decision-grade market evidence for thesis validation'
    : marketAnchor.screeningGrade || String(marketAnchor.validationStatus || '').toLowerCase() === 'validated'
      ? 'screening-grade'
      : 'candidate-level';
  const absT = Number.isFinite(tStat) ? Math.abs(tStat) : 0;
  const direction = Number.isFinite(rel) && rel > 0
    ? 'positive'
    : Number.isFinite(rel) && rel < 0
      ? 'negative'
      : 'flat or uncalibrated';
  const interpretation = marketAnchor.decisionGrade
    ? `The ${direction} move clears the current statistical and control gates for thesis-validation use, but it still needs analyst attribution to the operating mechanism before it can support portfolio action.`
    : absT >= 1.96
    ? `The ${direction} move is statistically strong enough to study further, but it still needs benchmark, factor, and regime interpretation before becoming decision-grade.`
    : absT >= 1.25
      ? `The ${direction} move is worth monitoring, but the t-stat remains below a high-conviction threshold.`
      : `The ${direction} move is not decision-useful on its own because the t-stat is weak.`;
  const regimePhrase = marketAnchor.regimeConsistent
    ? ` Regime consistency is supportive across ${marketAnchor.regimeDistinctCount || 2} regimes and ${marketAnchor.regimeHorizonCount || 1} horizons, but this remains supporting evidence rather than a substitute for decision-grade t-stat validation.`
    : '';
  const boundary = marketAnchor.decisionGrade
    ? `The read is ${status}; it validates market expression for the memo, not a standalone position-sizing conclusion.`
    : `The read is ${status} and still needs event-window, control, and regime interpretation before becoming decision-grade.`;
  return `${marketAnchor.topSymbol} screens as the strongest monitored market anchor, with ${relPhrase}${windowPhrase}, ${tPhrase}${samplePhrase}. ${interpretation}${regimePhrase} ${boundary} The broader exposure set is ${symbolPhrase}.`;
}

function humanReadable(value = '') {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function humanReadableTheme(value = '') {
  return String(value || '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function scoreText(value, fallback = 'not scored') {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : fallback;
}

function countPhrase(count, singular, plural = `${singular}s`) {
  const n = Number(count || 0);
  return `${n} ${n === 1 ? singular : plural}`;
}

function evidenceLaneSummary(items = [], { limit = 3 } = {}) {
  const clean = unique(asArray(items).map(humanReadable).filter(Boolean));
  if (!clean.length) return 'no missing action-bridge class is flagged';
  if (clean.length > limit) return 'open evidence lanes';
  const shown = clean.slice(0, limit);
  return joinHumanList(shown);
}

function sentenceStart(value = '') {
  const text = String(value || '').trim();
  return text ? `${text.slice(0, 1).toUpperCase()}${text.slice(1)}` : text;
}

function crossThemeProfile(bundle = {}) {
  const candidate = bundle.metadata?.candidate || {};
  const summary = candidate.evidence_summary || {};
  const discovery = candidate.discovery || summary.discovery || bundle.metadata?.discovery || {};
  const subject = subjectName(bundle);
  const candidateThemes = asArray(candidate.themes).filter(Boolean);
  const subjectMetadataThemes = asArray(bundle.subject?.metadata?.themes).filter(Boolean);
  const subjectThemes = asArray(bundle.subject?.themes).filter(Boolean);
  const adjacentThemes = asArray(bundle.metadata?.adjacentCandidate?.metadata?.themes).filter(Boolean);
  const themes = unique((
    candidateThemes.length ? candidateThemes
      : subjectMetadataThemes.length ? subjectMetadataThemes
        : adjacentThemes.length ? adjacentThemes
          : subjectThemes
  ).map(humanReadableTheme).filter(Boolean));
  const themeText = themes.length ? joinHumanList(themes) : 'the connected themes';
  const isSingleThemeContext = themes.length === 1;
  const themeScopeText = isSingleThemeContext
    ? `${themeText} source evidence and adjacent expansion`
    : themeText;
  const themeRelationText = isSingleThemeContext
    ? `inside ${themeText} and its adjacent source evidence`
    : `across ${themeText}`;
  const themeShareText = isSingleThemeContext
    ? `this node may matter inside ${themeText} and point to adjacent dependencies`
    : `${themeText} could share this node`;
  const themeLinkText = isSingleThemeContext
    ? `emerges from ${themeText} source evidence`
    : `links ${themeText}`;
  const discoveryRole = humanReadable(discovery.role || candidate.role || 'bottleneck');
  const mechanism = discovery.mechanism || `${subject} may be an intermediate dependency shared by ${themeText}`;
  const whyNow = discovery.whyNow || 'the candidate sits where demand, policy, technical requirements, and supplier capacity should be tested together';
  const triggerTerms = asArray(discovery.triggerTerms).slice(0, 6);
  const sourceQueries = asArray(discovery.sourceQueries).slice(0, 6);
  const readinessBlockers = asArray(bundle.metadata?.deepResearch?.investmentReadiness?.blockers)
    .slice(0, 4)
    .map((blocker) => String(blocker || '')
      .replace(/theme ontology critical KPI coverage\s+\d+%/gi, 'theme-specific operating KPI coverage remains incomplete')
      .replace(/direct issuer management-commentary coverage remains below the theme-specific threshold\s+\(\d+\/\d+\)/gi, 'direct issuer management-commentary coverage remains below the theme-specific threshold')
      .replace(/;\s*missing\s+.+$/i, '')
      .replace(/missing\s+.+$/i, 'theme-specific operating KPI gaps remain')
      .trim())
    .filter(Boolean);
  const ontologyGaps = asArray(bundle.metadata?.deepResearch?.ontologyPack?.missingKpis)
    .filter((gap) => gap.critical)
    .slice(0, 6)
    .map((gap) => String(gap.displayName || gap.kpiKey || '').replace(/^[^:]+:\s*/, ''))
    .filter(Boolean);
  const discoveryFit = candidate.discoveryFit ?? summary.discoveryFit ?? discovery.discoveryFit;
  const constraintCriticality = candidate.constraintCriticality ?? summary.constraintCriticality ?? discovery.constraintScore;
  const geopoliticalRelevance = candidate.geopoliticalRelevance ?? summary.geopoliticalRelevance ?? discovery.geopoliticalRelevance;
  const sourceQueryEvidenceCount = Number(summary.sourceQueryEvidenceCount || 0);
  const sourceQueryPersistedCount = Number(summary.sourceQueryPersistedCount || 0);
  const sourceQueryContextCount = Number(summary.sourceQueryContextCount || 0);
  const sourceQueryNegativeControlCount = Number(summary.sourceQueryNegativeControlCount || 0);
  const sourceQueryNoiseCount = Number(summary.sourceQueryNoiseCount || 0);
  const directEvidenceCount = Number(summary.directEvidenceCount || 0);
  const sourceDiversityRaw = Number(summary.sourceDiversityRaw || 0);
  const derivedSourceDiversity = sourceDiversityRaw > 0 ? Math.min(1, sourceDiversityRaw / 5) : undefined;
  const derivedEvidenceQuality = sourceQueryEvidenceCount > 0
    ? Math.min(
      0.72,
      0.2
        + Math.min(sourceQueryEvidenceCount, 8) * 0.035
        + Math.min(sourceDiversityRaw, 5) * 0.035
        + Math.min(directEvidenceCount, 2) * 0.17,
    )
    : undefined;
  const explicitEvidenceQuality = candidate.evidenceScore ?? candidate.evidence ?? summary.evidenceQuality;
  const explicitSourceDiversity = candidate.sourceDiversity ?? summary.sourceDiversity;
  const evidenceQuality = Number(explicitEvidenceQuality || 0) > 0 ? explicitEvidenceQuality : derivedEvidenceQuality;
  const sourceDiversity = Number(explicitSourceDiversity || 0) > 0 ? explicitSourceDiversity : derivedSourceDiversity;
  const seedSimilarity = candidate.seedSimilarity ?? summary.seedSimilarity;
  const discoveryQuality = computeCrossThemeDiscoveryQuality(bundle);
  const evidenceAnchors = crossThemeEvidenceAnchors(bundle, { subject, themes, triggerTerms });
  const actionBridge = bundle.metadata?.deepResearch?.crossThemeActionBridge || null;
  return {
    candidate,
    summary,
    discovery,
    subject,
    themes,
    themeText,
    isSingleThemeContext,
    themeScopeText,
    themeRelationText,
    themeShareText,
    themeLinkText,
    discoveryRole,
    mechanism,
    whyNow,
    triggerTerms,
    sourceQueries,
    readinessBlockers,
    ontologyGaps,
    sourceQueryEvidenceCount,
    sourceQueryPersistedCount,
    sourceQueryContextCount,
    sourceQueryNegativeControlCount,
    sourceQueryNoiseCount,
    directEvidenceCount,
    sourceDiversityRaw,
    discoveryFit,
    constraintCriticality,
    geopoliticalRelevance,
    evidenceQuality,
    sourceDiversity,
    seedSimilarity,
    discoveryQuality,
    evidenceAnchors,
    actionBridge,
  };
}

function cleanEvidenceTitle(value = '') {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b([A-Za-z][A-Za-z&.\- ]{2,})\s+\1\b/g, '$1')
    .trim();
}

function crossThemeEvidenceAnchors(bundle = {}, { subject = '', themes = [], triggerTerms = [] } = {}) {
  const bodyEvidence = crossThemeBodyEvidence(bundle).bodyEvidence
    .map((item) => {
      const title = cleanEvidenceTitle(item.title || item.label || item.atomicFacts?.[0]?.text || item.metadata?.title || '');
      if (!title) return null;
      return {
        evidenceId: item.evidenceId || item.evidence_id,
        title,
        publisher: item.publisher || item.sourceId || item.source_id || 'source evidence',
        direct: item.direct,
        sourceQuery: /source_query|external-rss|knowledge/i.test(`${item.kind || ''} ${item.evidenceId || ''}`),
        fit: item.crossThemeFit,
        score: (item.crossThemeFit?.score || 0) * 10 + (item.direct ? 5 : 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || Number(b.direct) - Number(a.direct));
  if (bodyEvidence.length) {
    const seenBody = new Set();
    const anchors = [];
    for (const item of bodyEvidence) {
      const key = item.title.toLowerCase();
      if (seenBody.has(key)) continue;
      seenBody.add(key);
      anchors.push(item);
      if (anchors.length >= 3) break;
    }
    return anchors;
  }

  const terms = unique([
    ...String(subject || '').split(/\s+/),
    ...asArray(triggerTerms).flatMap((term) => String(term || '').split(/\s+/)),
    ...asArray(themes).flatMap((theme) => String(theme || '').split(/[-_\s]+/)),
  ])
    .map((term) => term.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((term) => term.length >= 4 && !['capacity', 'theme', 'industrial'].includes(term));
  const scored = asArray(bundle.evidence)
    .map((item) => {
      const title = cleanEvidenceTitle(item.title || item.label || item.atomicFacts?.[0]?.text || '');
      const haystack = `${title} ${item.publisher || ''} ${item.kind || ''}`.toLowerCase();
      const termHits = terms.filter((term) => haystack.includes(term)).length;
      if (!title || termHits <= 0) return null;
      const grade = String(item.evidenceGrade || item.evidence_grade || item.metadata?.grade || '').toLowerCase();
      const direct = /(^|[_\s-])direct($|[_\s-])/.test(grade)
        || /direct/i.test(String(item.kind || ''));
      const sourceQuery = /source_query|external-rss|knowledge/i.test(`${item.kind || ''} ${item.evidenceId || ''}`);
      return {
        evidenceId: item.evidenceId,
        title,
        publisher: item.publisher || item.sourceId || 'source evidence',
        direct,
        sourceQuery,
        score: termHits + (direct ? 5 : 0) + (sourceQuery ? 2 : 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || Number(b.direct) - Number(a.direct));
  const seen = new Set();
  const anchors = [];
  for (const item of scored) {
    const key = item.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    anchors.push(item);
    if (anchors.length >= 3) break;
  }
  return anchors;
}

function evidenceAnchorListSentence(anchors = []) {
  const items = asArray(anchors).slice(0, 3);
  if (!items.length) return '';
  return `Concrete source anchors include ${items.map((item) => `"${item.title}"${item.direct ? ' (direct)' : ''}`).join('; ')}.`;
}

function buildCrossThemeNarrativeBlueprint(bundle = {}, signalCards = {}) {
  const profile = crossThemeProfile(bundle);
  const refs = refBlock(bundle, asArray(signalCards.cards || signalCards));
  const discoveryQuality = profile.discoveryQuality;
  const directEvidenceBlocker = profile.sourceQueryEvidenceCount > 0
    ? 'decision-grade operating evidence across capacity, supplier, procurement, and qualification classes is collected from independent source groups'
    : 'direct supplier, component, capacity, substitution, procurement, or technical-qualification evidence is collected from independent source groups';
  return {
    version: 'semantic-blueprint-v3',
    reportType: 'cross_theme_bottleneck_report',
    subject: profile.subject,
    thesis: {
      stance: 'cross_theme_bottleneck_discovery',
      short: profile.isSingleThemeContext
        ? `bottleneck candidate from ${profile.themeText}`
        : `shared bottleneck candidate across ${profile.themeText}`,
      confidence: Number(profile.evidenceQuality || 0) >= 0.65 ? 'medium' : 'low_to_medium',
      decisionUse: 'bottleneck_discovery_and_source_expansion',
    },
    readerQuestion: profile.isSingleThemeContext
      ? `Is ${profile.subject} a real adjacent dependency induced from ${profile.themeText}, or only report-local vocabulary?`
      : `Is ${profile.subject} a real shared dependency across ${profile.themeText}, or only graph adjacency?`,
    evidenceLogic: {
      weakestLeg: 'direct independent operating evidence',
      requiredConfirmation: 'capacity, substitution, supplier concentration, procurement, technical qualification, and market visibility evidence',
      confirmationShorthand: 'shared bottleneck evidence',
      constraintPath: profile.mechanism,
      marketLinks: symbolsFromBundle(bundle),
      blocker: directEvidenceBlocker,
      blockerClearCondition: directEvidenceBlocker,
      blockerSummary: directEvidenceBlocker,
      hasReadinessBlockers: true,
    },
    concreteAnchors: {
      hasReadinessBlockers: true,
      blocker: directEvidenceBlocker,
      blockerSummary: directEvidenceBlocker,
      blockerClearCondition: directEvidenceBlocker,
    },
    focus: {
      demand: 'theme demand and policy shock across connected domains',
      drivers: 'capacity, substitution, supplier concentration, procurement funding, technical qualification, and market visibility',
      constraints: profile.mechanism,
      exposure: 'connected themes, component suppliers, exposed issuers, and policy-dependent demand corridors',
    },
    symbolPhrase: symbolList(symbolsFromBundle(bundle)),
    shorthand: 'shared bottleneck evidence',
    scope: 'signal_triage',
    bottleneckReadiness: discoveryQuality,
    crossThemeDiscoveryQuality: discoveryQuality,
    crossTheme: profile,
    sectionIntent: {
      executiveJudgment: 'state whether this is a hidden bottleneck candidate, not a generic theme',
      context: 'explain why the connected themes could share one limiting variable',
      evidenceAssessment: 'separate ontology discovery fit from direct evidence depth',
      economicMechanism: 'describe demand or policy shock to capacity or supplier pressure',
      marketImplication: 'explain how the node would become investable only after validation',
      counterThesis: 'state why this may be only adjacency',
      watchNext: 'external evidence that validates bottleneck status',
      researchAgenda: 'executable source queries and backfill tasks',
    },
    argumentPillars: [
      `${profile.subject} is useful only if it changes what evidence the analyst collects next.`,
      `Discovery fit and constraint criticality can prioritize the candidate, but direct evidence must validate it.`,
      `The causal chain must distinguish shared dependency from co-mentions, supplier adjacency, and seed vocabulary.`,
      `Canonical promotion remains review-gated until independent capacity, supplier, policy, or technical evidence supports the bottleneck.`,
    ],
    bestCounterargument: `The strongest skeptical read is that ${profile.subject} is adjacency rather than dependency: it appears near ${profile.themeText}, but does not constrain timing, economics, or outcomes.`,
    closingJudgment: `Keep ${profile.subject} in bottleneck discovery until ${directEvidenceBlocker}.`,
    refs,
  };
}

export function buildCrossThemeLongFormSections(blueprint = {}) {
  const profile = blueprint.crossTheme || crossThemeProfile({});
  const refs = blueprint.refs || {};
  const name = profile.subject || blueprint.subject || 'The candidate';
  const displayName = sentenceStart(name);
  const themes = profile.themeText || 'the connected themes';
  const themeScope = profile.themeScopeText || themes;
  const themeRelation = profile.themeRelationText || `across ${themes}`;
  const themeShare = profile.themeShareText || `${themes} could share this node`;
  const themeLink = profile.themeLinkText || `links ${themes}`;
  const role = profile.discoveryRole || 'bottleneck';
  const triggerText = profile.triggerTerms?.length ? profile.triggerTerms.join(', ') : 'capacity, supplier, procurement, substitution, and technical-qualification language';
  const queryText = profile.sourceQueries?.length ? profile.sourceQueries.slice(0, 3).join('; ') : `${name} capacity supplier substitution evidence`;
  const mechanismSentence = sentenceStart(String(profile.mechanism || '').trim()).replace(/[.?!]?\s*$/, '.');
  const whyNowSentence = sentenceStart(String(profile.whyNow || '').trim()).replace(/[.?!]?\s*$/, '.');
  const evidenceQuality = scoreText(profile.evidenceQuality);
  const sourceDiversity = scoreText(profile.sourceDiversity);
  const discoveryFit = scoreText(profile.discoveryFit);
  const criticality = scoreText(profile.constraintCriticality);
  const geopolitical = scoreText(profile.geopoliticalRelevance);
  const seed = scoreText(profile.seedSimilarity);
  const discoveryQuality = profile.discoveryQuality || {};
  const discoveryMetrics = discoveryQuality.metrics || {};
  const actionBridge = profile.actionBridge || {};
  const bottleneckTier = discoveryTierLabel(discoveryQuality.tier || 'research_lead');
  const actionBridgeLabel = actionBridge.label || String(actionBridge.tier || 'source_expansion_only').replace(/_/g, ' ');
  const actionIssuerRows = asArray(actionBridge.exposedIssuers).slice(0, 5);
  const autoIssuerAllRows = asArray(actionBridge.autoDiscoveredIssuers);
  const autoIssuerRows = autoIssuerAllRows.slice(0, 8);
  const autoDirectAttachedRows = autoIssuerAllRows.filter((issuer) => (
    issuer.status === 'direct_node_exposure_attached'
    || issuer.status === 'issuer_exposure_attached'
  ));
  const autoDirectAttachedCount = autoDirectAttachedRows.length;
  const autoDirectAttachedText = autoDirectAttachedRows.slice(0, 5)
    .map((issuer) => `${issuer.symbol} (${humanReadable(issuer.status)})`)
    .join(', ');
  const autoFollowUpCount = Math.max(0, autoIssuerAllRows.length - autoDirectAttachedCount);
  const autoIssuerText = autoIssuerRows.length
    ? autoIssuerRows.slice(0, 5).map((issuer) => `${issuer.symbol} (${humanReadable(issuer.issuerBridgeRole || issuer.role || 'candidate')})`).join(', ')
    : '';
  const actionIssuerText = actionIssuerRows.length
    ? actionIssuerRows.map((issuer) => `${issuer.symbol} (${humanReadable(issuer.status)})`).join(', ')
    : (autoDirectAttachedCount
      ? `partial bridge attached (${autoDirectAttachedText})${autoFollowUpCount ? `, with ${countPhrase(autoFollowUpCount, 'candidate issuer')} still requiring direct bridge evidence` : ''}`
      : (autoIssuerText
        ? `candidate map exists (${autoIssuerText}), but direct issuer translation is not attached yet`
        : 'no issuer translation is attached yet'));
  const directIssuerCount = actionIssuerRows.filter((issuer) => issuer.status === 'issuer_exposure_attached').length;
  const operatingIssuerCount = actionIssuerRows.filter((issuer) => issuer.status === 'operating_anchor_attached').length;
  const followUpIssuerCount = actionIssuerRows.filter((issuer) => issuer.status !== 'issuer_exposure_attached' && issuer.status !== 'operating_anchor_attached').length;
  const actionIssuerSummaryText = actionIssuerRows.length
    ? [
        directIssuerCount ? `${countPhrase(directIssuerCount, 'issuer')} with direct issuer-exposure evidence` : null,
        operatingIssuerCount ? `${countPhrase(operatingIssuerCount, 'issuer')} with operating anchors but not issuer-level economics` : null,
        followUpIssuerCount ? `${countPhrase(followUpIssuerCount, 'issuer')} still requiring issuer follow-up` : null,
      ].filter(Boolean).join('; ')
    : (autoDirectAttachedCount
      ? [
          `${countPhrase(autoDirectAttachedCount, 'issuer')} with direct node-exposure bridge attached (${autoDirectAttachedText})`,
          autoFollowUpCount ? `${countPhrase(autoFollowUpCount, 'candidate issuer')} still requiring direct bridge evidence` : null,
          'operating, market, and issuer-commentary classes still required for promotion',
        ].filter(Boolean).join('; ')
      : (autoIssuerRows.length
        ? `candidate issuer map exists with ${countPhrase(autoIssuerAllRows.length, 'issuer')}; direct bridge evidence is still missing`
        : 'no issuer translation is attached yet'));
  const actionMissingClasses = asArray(actionBridge.missingClasses).map(humanReadable).filter(Boolean);
  const actionMissingClassText = evidenceLaneSummary(actionMissingClasses);
  const actionMarketText = actionBridge.marketTranslation?.status === 'attached'
    ? `Market translation is attached at ${humanReadable(actionBridge.marketTranslation.tier || 'unknown')} with ${countPhrase(actionBridge.marketTranslation.rowCount, 'row')}.`
    : 'Market translation is not yet attached; discovery can still be valid while tradable expression remains unresolved.';
  const valuationReadiness = actionBridge.valuationReadiness || profile.valuationReadiness || null;
  const valuationSummary = valuationReadiness?.summary || null;
  const actionValuationText = valuationSummary
    ? (() => {
        const tier = humanReadable(valuationSummary.tier || 'unknown');
        if (valuationSummary.tier === 'overheated') {
          return `Run-up check flags ${countPhrase(valuationSummary.overheatedSymbolCount, 'overheated issuer')}; the candidate is best treated as a watchlist lead until momentum cools.`;
        }
        if (valuationSummary.tier === 'extended') {
          return `Run-up check shows ${countPhrase(valuationSummary.extendedSymbolCount, 'extended issuer')} without a meaningful drawdown; size only after consolidation.`;
        }
        if (valuationSummary.tier === 'cheap') {
          return `Run-up check leaves the resolved issuer universe in a cheap-to-fair range relative to the benchmark; verify there is no value-trap risk.`;
        }
        if (valuationSummary.tier === 'unknown' || valuationSummary.tier === 'mixed') {
          return `Run-up check is partial (${tier}); ${(valuationSummary.missingClass || []).map(humanReadable).join(', ') || 'awaiting market quote coverage'}.`;
        }
        return `Run-up check tier is ${tier}; valuation gate is clear for issuer promotion.`;
      })()
    : 'Run-up check is not yet attached; defer overheated/cheap judgment until market quote coverage and valuation snapshot are loaded.';
  const bodyEvidenceCount = Number(discoveryMetrics.bodyEvidenceCount || 0);
  const highFitAnchorCount = Number(discoveryMetrics.highFitAnchorCount || 0);
  const negativeControlPass = Number(discoveryMetrics.negativeControlPass || 0) >= 1;
  const coveredEvidenceClasses = asArray(discoveryMetrics.evidenceClassesCovered).map(humanReadable).filter(Boolean);
  const missingEvidenceClasses = asArray(discoveryMetrics.missingEvidenceClasses).map(humanReadable).filter(Boolean);
  const discoverySourceGroupStatus = Number(discoveryMetrics.sourceDiversity || 0) >= 0.8
    ? 'Independent body-evidence source breadth is strong enough for review-ready consideration.'
    : 'Independent body-evidence source breadth still needs more source groups tied to high- or medium-fit evidence.';
  const directHighStatus = Number(discoveryMetrics.directHighFitAnchorCount || 0) > 0
    ? 'Direct operating anchors are now present, but they still need evidence-class breadth and negative-control discipline.'
    : 'No direct high-fit operating anchor is strong enough to promote the candidate yet.';
  const missingClassText = missingEvidenceClasses.length
    ? `Missing evidence lanes are ${evidenceLaneSummary(missingEvidenceClasses)}.`
    : 'The positive evidence classes are covered; the remaining issue is independent confirmation and negative-control quality.';
  const coveredClassText = coveredEvidenceClasses.length
    ? `Covered evidence classes are ${joinHumanList(coveredEvidenceClasses)}.`
    : 'No promotion evidence class is covered strongly enough yet.';
  const blockerText = profile.readinessBlockers?.length
    ? `The current readiness blockers are: ${profile.readinessBlockers.join('; ')}.`
    : 'The current blocker is direct operating evidence rather than conceptual relevance.';
  const sourceQueryEvidenceText = profile.sourceQueryPersistedCount > 0
    ? `The latest source-query pass now writes canonical memory into separate buckets: promotion-candidate evidence, supporting context, negative-control candidates, and weak/noisy rows. Only promotion-candidate items can update edge evidence or readiness; context, negative-control, and weak/noisy rows stay in memory for audit, query refinement, and invalidator checks. ${blockerText}`
    : blockerText;
  const hasInitialDirectEvidence = profile.directEvidenceCount > 0 || profile.sourceQueryEvidenceCount > 0;
  const bindingBlockerClaim = hasInitialDirectEvidence
    ? 'The binding blocker is complete operating validation, not first-pass evidence.'
    : 'The binding blocker is direct operating evidence.';
  const bindingBlockerContext = hasInitialDirectEvidence
    ? 'The first source-query pass now gives the candidate a real evidence base, but the memo still needs operating, procurement, substitution, and issuer evidence across independent source groups.'
    : 'The memo needs supplier, component, capacity, substitution, procurement, or technical-qualification evidence from independent source groups.';
  const caveatClaim = hasInitialDirectEvidence
    ? 'The principal caveat is decision-grade validation, not conceptual relevance.'
    : 'The principal caveat is direct evidence, not conceptual relevance.';
  const caveatContext = hasInitialDirectEvidence
    ? `${displayName} is conceptually relevant and now has first-pass source-query support, but it is not yet validated across the operating evidence classes required for promotion.`
    : `${displayName} is conceptually relevant because it ${themeLink}; it is not yet supported because the direct evidence classes still need to be filled.`;
  const ontologyGapText = profile.ontologyGaps?.length
    ? `The missing ontology evidence is specific: ${profile.ontologyGaps.join(', ')}.`
    : 'The missing evidence should be stated as concrete source tasks, not generic data insufficiency.';
  const evidenceAnchorText = evidenceAnchorListSentence(profile.evidenceAnchors);
  return [
    longSection('executiveJudgment', 'Executive Judgment', [
      paragraph({
        claim: `${displayName} is a cross-theme ${role} discovery candidate, not a finished theme or investment call.`,
        context: profile.isSingleThemeContext
          ? `It was induced from ${themeScope}, so the useful question is whether one input, process, supplier layer, or capacity constraint can become an adjacent bottleneck worth expanding beyond the original theme.`
          : `It connects ${themes}, so the useful question is whether one shared input, process, supplier layer, or capacity constraint can become a limiting variable across more than one domain.`,
        interpretation: `That is different from a normal theme memo. The product value is not saying that ${name} is important because it appears in a graph; the value is turning a possible hidden bottleneck into a concrete test path.`,
        implication: `The candidate should stay in source-expansion and analyst-validation mode until direct evidence supports an effect on timing, capacity, substitution, or economics.`,
      }, refs),
      paragraph({
        claim: `The strongest current read is prioritization, not promotion.`,
        context: `Discovery fit is ${discoveryFit}, constraint criticality is ${criticality}, geopolitical relevance is ${geopolitical}, evidence quality is ${evidenceQuality}, and source breadth is ${sourceDiversity}.`,
        interpretation: `Those scores say the idea deserves analyst attention, but they do not by themselves support bottleneck status. A high ontology score without independent support should create source queries, not canonical elevation.`,
        implication: `The immediate decision use is to decide where to search next, which suppliers or technical constraints matter, and what would invalidate the candidate.`,
      }, refs),
      paragraph({
        claim: bindingBlockerClaim,
        context: bindingBlockerContext,
        interpretation: `Until that validation appears, the candidate is best treated as a hidden-bottleneck hypothesis with practical research value rather than a conclusion.`,
        transition: `The next section explains why ${themeShare} and why that connection may matter now.`,
      }, refs),
    ], { targetWords: 260 }),
    longSection('whyConnectorMatters', 'Why This Connector Matters', [
      paragraph({
        claim: `${displayName} matters only if it changes the research map ${themeRelation}.`,
        context: `The connector has to explain a shared operating dependency: the same capacity, component, material, supplier, or qualification layer needs to affect more than one domain.`,
        interpretation: `That is the difference between an interesting label and a useful discovery. A cross-theme report should not just say that two themes are related; it should identify the concrete node where timing, cost, capacity, or substitution risk can concentrate.`,
        implication: `For this candidate, the practical output is a short list of evidence classes and issuer follow-ups, not a generic claim that the theme is important.`,
      }, refs),
      paragraph({
        claim: `The current action bridge is ${actionBridgeLabel}.`,
        context: `Issuer translation is partial: ${actionIssuerSummaryText}. ${actionMarketText} ${actionValuationText}`,
        interpretation: `This keeps discovery quality separate from tradable expression. The bottleneck idea can be strong while the system still needs issuer, market, and validation evidence before an analyst can use it in a portfolio context.`,
        implication: `The next report should improve the action bridge by filling ${actionMissingClassText}.`,
      }, refs),
    ], { targetWords: 250 }),
    longSection('whyNotReviewReady', 'Why Not Review-Ready Yet', [
      paragraph({
        claim: `The candidate is not review-ready until the discovery evidence matrix clears promotion, diversity, and negative-control checks together.`,
        context: `${directHighStatus} ${discoverySourceGroupStatus}`,
        interpretation: `This is a cross-theme discovery gate, not an investment gate. The system can recognize a useful hidden-bottleneck lead while still refusing to call it review-ready when direct evidence, source groups, or invalidator checks are incomplete.`,
        implication: `That keeps the artifact useful for discovery without letting a clever connection outrun the evidence.`,
      }, refs),
      paragraph({
        claim: `The current matrix should drive the next backfill cycle.`,
        context: `Action-bridge gaps to close: ${actionMissingClassText}.`,
        interpretation: negativeControlPass
          ? `Negative-control discipline is present, so the next promotion question is whether the positive evidence classes are deep enough across independent source groups.`
          : `Negative-control evidence is still missing or insufficient, so the next source-query pass must actively search for easy substitutes, supplier redundancy, absence of capacity pressure, and weak procurement timing.`,
        implication: `The next report should promote only if new accepted evidence closes these matrix gaps; otherwise the candidate should remain a research lead even if the idea remains interesting.`,
      }, refs),
    ], { targetWords: 240 }),
    longSection('contextAndWhatChanged', 'Context and What Changed', [
      paragraph({
        claim: `The important change is that ${name} is now framed as a shared dependency question instead of a relationship-score artifact.`,
        context: `A relationship score can show that two themes share vocabulary or entities. A bottleneck frame asks a harder question: whether the same constraint can slow, reprice, or redirect multiple themes at once.`,
        interpretation: `That distinction is central to the original Lattice use case: finding products, materials, components, and suppliers that become important at the intersection of unrelated-looking fields.`,
        implication: `For ${themeScope}, the candidate is useful only if it reveals a limiting variable that standard single-theme dashboards would miss.`,
      }, refs),
      paragraph({
        claim: `The current mechanism to test is explicit.`,
        context: mechanismSentence,
        interpretation: `This mechanism matters because it converts an abstract connector into a falsifiable research question. The next cycle can look for capacity constraints, supplier concentration, technical qualification requirements, substitution limits, or procurement pressure.`,
        implication: `If those signals appear in independent evidence, ${name} becomes more than graph adjacency; if they do not, it should remain backlog research.`,
      }, refs),
      paragraph({
        claim: `The why-now condition is also explicit.`,
        context: whyNowSentence,
        interpretation: `Why-now evidence prevents the system from elevating permanently plausible but currently inert dependencies. A bottleneck matters when demand, policy, launch cadence, procurement, funding, or technical deadlines create timing pressure.`,
        transition: `That makes evidence assessment less about volume and more about whether the right evidence classes are present.`,
      }, refs),
    ], { targetWords: 360 }),
    longSection('sharedConstraintMap', 'Shared Constraint Map', [
      paragraph({
        claim: `The shared-constraint map is the core object, not the theme pair itself.`,
        context: `${displayName} ${themeLink} through a stated operating mechanism that should be tested rather than repeated as proof.`,
        interpretation: `A useful map has four layers: demand or policy pressure, the connector, the evidence class that tests whether the connector is binding, and the issuer or asset where the constraint can be monitored.`,
        implication: `If one layer is missing, the report should preserve the idea but route it to the correct follow-up task instead of upgrading the candidate.`,
      }, refs),
      paragraph({
        claim: `The bridge is evidence-class aware.`,
        context: `${coveredClassText} ${missingClassText}`,
        interpretation: `That matters because a bottleneck cannot be proven by one impressive item. Capacity, qualification, procurement, substitution, issuer exposure, and negative controls answer different questions.`,
        implication: `The map should promote the candidate only when enough of those questions are answered by independent source groups.`,
      }, refs),
    ], { targetWords: 260 }),
    longSection('whyNonObvious', 'Why This Is Non-Obvious', [
      paragraph({
        claim: `${displayName} is interesting only if the connection is non-obvious in the evidence, not merely unusual in wording.`,
        context: `The current evidence tier is ${bottleneckTier}, which is intentionally separate from investment readiness.`,
        interpretation: `That combination is the product signal. A common connector inside one crowded theme is less valuable than a specific component, material, process, or supplier layer that bridges distant themes and did not simply echo the original seed vocabulary.`,
        implication: `The report should therefore treat novelty as an evidence-supported discovery dimension, separate from investment readiness or broad theme momentum.`,
      }, refs),
      paragraph({
        claim: `The candidate becomes more than a clever graph edge when operating evidence attaches to the connector itself.`,
        context: highFitAnchorCount > 0
          ? `High-fit operating anchors passed the body-evidence filter and are eligible for the memo body.`
          : `No high-fit operating anchor is yet strong enough to carry the thesis, so the candidate remains a research lead.`,
        interpretation: `High-fit evidence means the source mentions the connector or supplier together with capacity, facility, production, procurement, qualification, or other operating language. Generic market-size reports or broad commentary do not promote the candidate.`,
        implication: `This keeps novelty from becoming a style claim; it has to show up as low baseline co-mention plus specific operating evidence.`,
      }, refs),
    ], { targetWords: 260 }),
    longSection('whyNormalDashboardMissesIt', 'Why A Normal Theme Dashboard Would Miss It', [
      paragraph({
        claim: `A normal theme dashboard is likely to split this signal into separate piles.`,
        context: profile.isSingleThemeContext
          ? `One view may show the parent theme, another may show supplier activity, and a third may show market reactions. The bottleneck hypothesis lives between those views: whether ${name} is a limiting layer ${themeRelation}.`
          : `One view may show defense demand, another may show space launch or supplier activity, and a third may show market reactions. The bottleneck hypothesis lives between those views: whether ${name} is the shared limiting layer across ${themes}.`,
        interpretation: `Single-theme ranking can miss a connector that is not the largest headline in either theme but matters because it sits in the middle of both operating chains.`,
        implication: `The discovery product should surface the connector, not just the themes around it.`,
      }, refs),
      paragraph({
        claim: `That is why the memo filters body evidence more aggressively than the audit appendix.`,
        context: `Evidence has to include the connector or supplier term and at least one linked theme, ontology, capacity, supplier, procurement, production, or qualification signal before it supports the body narrative.`,
        interpretation: `Rows that only mention unrelated AI, cloud, macro, or generic market language can still remain in the appendix for provenance, but they should not make the candidate look stronger in the client memo.`,
        implication: `The result is a cleaner cross-theme thesis: fewer rows, stronger relevance, and clearer next-source tasks.`,
      }, refs),
    ], { targetWords: 270 }),
    longSection('evidenceLadder', 'Evidence Ladder', [
      paragraph({
        claim: `The evidence ladder is graph adjacency -> research lead -> evidence-supported research candidate -> review-ready evidence tier.`,
        context: `The current tier is ${bottleneckTier}; movement up the ladder requires stronger direct operating anchors and independent source breadth.`,
        interpretation: `Graph adjacency says the idea is worth inspecting. A research lead has enough specificity to open source queries. An evidence-supported research candidate has direct operating anchors. A review-ready evidence tier has multiple independent, high-fit anchors plus negative-control discipline.`,
        implication: `This tiering lets the system celebrate discovery quality without pretending the same artifact is already an investment memo.`,
      }, refs),
      paragraph({
        claim: `Concrete anchors should determine movement up the ladder.`,
        context: evidenceAnchorText || `No concrete anchor is currently strong enough to name as thesis support.`,
        interpretation: `A supplier facility, production capacity expansion, contract award, technical qualification, or hard substitution limit is stronger than a broad sector outlook because it can be tied to timing and mechanism.`,
        implication: `Accepted evidence should move the candidate only when it answers a specific required lane, with promotion, context, market, and negative-control evidence kept separate.`,
      }, refs),
      paragraph({
        claim: `The ladder is now evidence-class aware.`,
        context: `The readiness section names the open matrix slots; the ladder uses those slots to decide whether a candidate can move beyond research-lead status.`,
        interpretation: `This prevents one strong capacity item from doing all the work. A bottleneck thesis needs scarcity, technical difficulty, timing pressure, substitution limits, market expression, and falsification pressure to be tracked separately.`,
        implication: `The output should show not only what evidence exists, but which promotion class remains open.`,
      }, refs),
    ], { targetWords: 280 }),
    longSection('negativeControls', 'Negative Controls', [
      paragraph({
        claim: `Negative controls are mandatory because cross-theme discovery can otherwise over-rank plausible adjacency.`,
        context: negativeControlPass
          ? `The current evidence passes the first negative-control check because high-fit operating anchors outweigh generic or noisy rows.`
          : `The current evidence has not fully cleared negative-control pressure, so generic or noisy rows still need to be kept away from thesis support.`,
        interpretation: `The candidate should be penalized if evidence shows easy substitutes, many qualified suppliers, broad redundant capacity, no timing pressure, or no direct operating dependency ${themeRelation}.`,
        implication: `A negative-control pass improves discovery quality; it does not override the need for review-gated canonical promotion.`,
      }, refs),
      paragraph({
        claim: `Generic market reports are useful context but weak promotion evidence.`,
        context: `They can confirm that a market exists, but they rarely show supplier scarcity, qualification barriers, procurement timing, or a concrete substitution constraint.`,
        interpretation: `That distinction matters because the product is searching for hidden bottlenecks, not simply larger markets.`,
        implication: `The system should keep broad market-size rows below direct operating evidence in the evidence ladder.`,
      }, refs),
    ], { targetWords: 260 }),
    longSection('evidenceAssessment', 'Evidence Assessment', [
      paragraph({
        claim: `The evidence hierarchy has to separate discovery fit from support.`,
        context: `Discovery fit ${discoveryFit} and constraint criticality ${criticality} are useful ranking signals. Evidence quality ${evidenceQuality} and source breadth ${sourceDiversity} determine whether the idea can move beyond discovery.`,
        interpretation: `This prevents the system from repeating the original seed problem: a candidate can look elegant because it sits at a thematic intersection, while still lacking the independent evidence needed for analyst use.`,
        implication: `The correct output is a review-gated candidate plus source tasks, not canonical elevation.`,
      }, refs),
      paragraph({
        claim: `The evidence gap is now theme-specific, not a vague more-data warning.`,
        context: sourceQueryEvidenceText,
        interpretation: ontologyGapText,
        implication: `That makes the next cycle operational: collect the missing KPI or issuer evidence, attach it to the candidate record, and only then re-score the bottleneck thesis.`,
      }, refs),
      paragraph({
        claim: `The required evidence classes are concrete.`,
        context: `The memo needs direct supplier or component evidence, policy or procurement trigger evidence, technical feasibility or qualification evidence, and market visibility evidence.`,
        interpretation: `Each class answers a different question. Supplier evidence tests scarcity; policy evidence tests timing; technical evidence tests whether substitutes are realistic; market visibility tests whether exposed issuers or sectors can express the constraint.`,
        implication: `Missing any one class does not kill the idea, but it should cap conviction and determine the next backfill task.`,
      }, refs),
      paragraph({
        claim: `Seed-lock remains a risk to monitor, not a reason to discard the candidate.`,
        context: `Seed similarity is ${seed}.`,
        interpretation: `Low seed similarity makes the candidate more interesting as autonomous discovery; high seed similarity would mean the system may be rediscovering the user's original framing.`,
        transition: `The next section turns the evidence hierarchy into a causal map that can be tested theme by theme.`,
      }, refs),
    ], { targetWords: 360 }),
    longSection('economicMechanism', 'Economic Mechanism', [
      paragraph({
        claim: `The causal chain to test is demand or policy shock -> ${name} as ${role} -> capacity, substitution, or supplier pressure -> affected themes and exposed issuers.`,
        context: `This is the operational version of the bottleneck thesis.`,
        interpretation: `It asks whether the candidate changes delivery timing, marginal cost, supplier bargaining power, production rate, technical feasibility, or market exposure.`,
        implication: `If the chain cannot be supported, the candidate is only an adjacency; if it can, it becomes a useful research lead across multiple domains.`,
      }, refs),
      paragraph({
        claim: `The mechanism should be tested with negative controls as well as positive evidence.`,
        context: `A real bottleneck should show hard-to-substitute capacity, qualified suppliers, policy-linked demand, or technical constraints; a weak connector will show only repeated mentions or generic supplier adjacency.`,
        interpretation: `Negative controls keep the system from over-elevating common industrial terms that appear across many themes without actually constraining any of them.`,
        implication: `This is where analyst-level usefulness comes from: the report tells the user how to disconfirm the candidate, not only why it might be interesting.`,
      }, refs),
      paragraph({
        claim: `The watch vocabulary is now specific enough for automated collection.`,
        context: `Monitor ${triggerText}.`,
        interpretation: `Those terms should seed source-query drafts, SEC/filing searches, contract-award searches, technical-paper searches, and supplier-news backfill depending on the ontology role.`,
        transition: `The market and scenario read should stay subordinate to this mechanism until direct evidence strengthens.`,
      }, refs),
    ], { targetWords: 360 }),
    longSection('marketImplicationAndScenarios', 'Market Implication and Scenarios', [
      paragraph({
        claim: `Market use is currently watchlist construction, not trade construction.`,
        context: `A cross-theme bottleneck becomes investable only after it is mapped to exposed issuers, substitute suppliers, procurement beneficiaries, input-cost losers, or capacity owners.`,
        interpretation: `Before that mapping is tested, price moves can be broad beta, sector rotation, or unrelated issuer news.`,
        implication: `The report should therefore use market data to choose what to monitor, while keeping portfolio action outside the automated output.`,
      }, refs),
      paragraph({
        claim: profile.isSingleThemeContext
          ? `The upgrade case requires independent evidence that the node matters beyond a single report-local phrase.`
          : `The upgrade case requires independent evidence from at least two connected themes in the mapped set.`,
        context: `The strongest version would show ${name} becoming tight, funded, qualified, regulated, or hard to substitute, with support from different source groups rather than one repeated narrative.`,
        interpretation: `That would move the candidate from discovery watch to review queue because it would show shared dependency rather than co-mention.`,
        implication: `A reviewed candidate should then spawn issuer-specific reports for the companies most exposed to capacity, supplier, or substitution pressure.`,
      }, refs),
      paragraph({
        claim: `The invalidator is equally important.`,
        context: `Downgrade the candidate if new evidence shows easy substitutes, broad supplier redundancy, no timing pressure, or no direct operating dependency for either connected theme.`,
        interpretation: `In that outcome, ${name} can remain a useful graph node but should not occupy analyst attention as a hidden bottleneck.`,
        transition: `That scenario discipline leads into the explicit counter-thesis and research agenda.`,
      }, refs),
    ], { targetWords: 330 }),
    longSection('issuerMarketTranslation', 'Issuer and Market Translation', [
      paragraph({
        claim: `Issuer and market translation are follow-up layers, not proof of the bottleneck by themselves.`,
        context: `Current issuer bridge: ${actionIssuerText}. Current market bridge: ${actionBridge.marketTranslation?.status === 'attached' ? humanReadable(actionBridge.marketTranslation.tier || 'attached') : 'not attached; tradable expression still needs issuer mapping and controlled rows'}.`,
        interpretation: `This section answers a different question from discovery quality. Discovery asks whether the connector is non-obvious and supported by evidence; issuer translation asks who owns the exposure, who benefits from capacity, and who bears substitution or timing risk.`,
        implication: `If issuer exposure is missing, the right action is to collect issuer-level evidence, not to downgrade a strong discovery candidate into a weak theme report.`,
      }, refs),
      paragraph({
        claim: `The market read should stay subordinate to the operating bridge.`,
        context: `Price sensitivity is useful only after the connector has a concrete issuer or asset expression tied to the operating evidence classes.`,
        interpretation: `That avoids the common error of treating broad sector beta as bottleneck validation. Market rows can prioritize issuer follow-up, but they should not promote the connector unless operating evidence and issuer exposure also align.`,
        implication: `The next validation step is to bind any market signal to the evidence classes named in the discovery matrix.`,
      }, refs),
    ], { targetWords: 280 }),
    longSection('promotionRejection', 'What Would Promote / Reject This Candidate', [
      paragraph({
        claim: `Promotion requires evidence that the connector is operationally binding across more than one theme.`,
        context: `The strongest promotion evidence would tie operating scarcity, qualification difficulty, procurement timing, practical non-substitutability, issuer exposure, and negative-control results to the same connector without collapsing them into one score.`,
        interpretation: `Those evidence classes prove different parts of the bottleneck thesis: scarcity, technical difficulty, timing pressure, practical non-substitutability, and market expression.`,
        implication: `If accepted evidence appears in two or more of those classes, the next report can consider moving from research lead to an evidence-supported research candidate or a review-ready evidence tier.`,
      }, refs),
      paragraph({
        claim: `Rejection should be equally explicit.`,
        context: `Reject or downgrade if the next evidence cycle finds broad supplier redundancy, substitute materials or processes that are easy to qualify, demand that is not time-sensitive, or evidence that the mapped dependency does not rely on the same operating layer ${themeRelation}.`,
        interpretation: `That rejection rule is important because novelty alone is not enough. A genuinely new connection can still be economically irrelevant if it does not constrain cost, timing, performance, or availability.`,
        implication: `The desired behavior is not endless discovery; it is accept, watch, or reject based on targeted evidence.`,
      }, refs),
    ], { targetWords: 260 }),
    longSection('discoveryActionBridge', 'Discovery-to-Action Bridge', [
      paragraph({
        claim: `The discovery-to-action bridge converts the idea into executable analyst work.`,
        context: `The bridge tier is ${actionBridgeLabel}; missing action classes are ${actionMissingClassText}.`,
        interpretation: `This prevents the report from ending as a clever observation. Each missing class should become a source query, issuer follow-up, negative-control test, or market validation task.`,
        implication: `The candidate should move forward only when the bridge improves, not simply because the prose is persuasive.`,
      }, refs),
      paragraph({
        claim: `Actionability remains distinct from investment readiness.`,
        context: `A cross-theme discovery can deserve S-tier discovery attention while still carrying a conservative investment gate.`,
        interpretation: `That separation is deliberate. It lets Lattice find non-obvious connections early without turning every connection into a trade, target price, or recommendation.`,
        implication: `The next product step is issuer-specific follow-up after the bridge identifies which companies or assets can express the bottleneck.`,
      }, refs),
    ], { targetWords: 240 }),
    longSection('counterRisksCaveats', 'Counter-Thesis, Risks, and Caveats', [
      paragraph({
        claim: blueprint.bestCounterargument || `The strongest skeptical read is that ${name} is adjacency rather than dependency.`,
        context: `This is the main risk for cross-theme discovery systems because relationship graphs naturally surface shared vocabulary, shared suppliers, and generic component layers.`,
        interpretation: `A useful report must therefore ask whether the node constrains outcomes, timing, economics, or technical feasibility. If it does not, the candidate should stay in the backlog.`,
        implication: `This keeps autonomous discovery from becoming a list of plausible but non-actionable connectors.`,
      }, refs),
      paragraph({
        claim: `The second risk is false precision.`,
        context: `The numerical scores rank the candidate for review but are not evidence of real-world scarcity, supplier leverage, or market impact by themselves.`,
        interpretation: `That is why the memo exposes discovery fit, source breadth, and evidence quality separately instead of collapsing them into one confidence number.`,
        implication: `An analyst can then decide whether to spend time on source expansion without mistaking the ranking score for evidence.`,
      }, refs),
      paragraph({
        claim: caveatClaim,
        context: caveatContext,
        interpretation: `That caveat preserves the useful part of the signal while preventing premature canonical elevation.`,
        transition: `The final section converts that caveat into concrete source queries and review actions.`,
      }, refs),
    ], { targetWords: 320 }),
    longSection('watchAndResearchAgenda', 'What to Watch and Research Agenda', [
      paragraph({
        claim: `Watch for direct evidence that ${name} is becoming capacity-constrained, funded, qualified, regulated, or hard to substitute.`,
        context: `Independent supply, procurement, technical, and supplier-concentration evidence is stronger than another generic theme mention.`,
        interpretation: `These watch conditions are external signals; they define what would make the candidate more credible in the next cycle.`,
        implication: `If the watch conditions do not appear, the candidate should remain discovery backlog even if graph centrality remains high.`,
      }, refs),
      paragraph({
        claim: `The backfill agenda should prioritize the missing ontology gates before adding generic coverage.`,
        context: profile.ontologyGaps?.length ? `Priority gaps should stay anchored to the named operating KPI gaps already identified above.` : `Priority gaps should come from the connected theme ontologies and candidate evidence base.`,
        interpretation: `This keeps the system aligned with the actual cross-theme thesis: a shared bottleneck must show operating pressure in the connected domains, not just broader media attention.`,
        implication: `A future report should upgrade only if those gap-specific tasks produce direct supplier, capacity, procurement, qualification, or issuer evidence.`,
      }, refs),
      paragraph({
        claim: `The executable source-query path is already narrow enough to run automatically.`,
        context: `Start with: ${queryText}.`,
        interpretation: `Those queries should backfill direct source evidence, not merely increase article count. The acceptance criterion is whether they produce supplier, capacity, substitute, procurement, or technical evidence that can attach to the candidate record.`,
        implication: `This turns the report into a research operating loop: propose candidate, collect targeted evidence, re-score, then accept, watch, or reject.`,
      }, refs),
      paragraph({
        claim: `The next report should be stricter, not longer.`,
        context: `If the backfill cycle finds direct evidence, the next memo should name the evidence class and affected themes. If it does not, it should downgrade the candidate despite the attractive thematic intersection.`,
        interpretation: `That is the analyst-level behavior this system needs: use cross-theme discovery to find non-obvious questions, then let evidence decide whether the question deserves more attention.`,
      }, refs),
    ], { targetWords: 320 }),
    longSection('analystConclusion', 'Analyst Conclusion', [
      paragraph({
        claim: `${displayName} is a useful hidden-bottleneck lead if it changes the next research action.`,
        context: `The action is not to promote it; the action is to test capacity, substitution, supplier concentration, policy dependence, and technical qualification evidence ${themeRelation}.`,
        interpretation: `That makes the output practical even before it is investment-grade: it gives the user a concrete insight path that a normal single-theme scan would not surface.`,
        implication: `If the next cycle cannot find those links, the candidate should stay in backlog; if it can, it should move into review queue and issuer-level follow-up.`,
      }, refs),
    ], { targetWords: 110 }),
  ];
}

function renderCrossThemeClientMemoFromBlueprint(blueprint = {}) {
  const longFormSections = buildCrossThemeLongFormSections(blueprint);
  const refs = blueprint.refs || {};
  const paragraphsByKey = (key) => longFormSections.find((section) => section.key === key)?.paragraphs || [];
  const plan = {
    ...blueprint,
    version: 'semantic-plan-v3',
    blueprintVersion: blueprint.version,
    longFormSections,
    openingFrame: `${blueprint.subject} is being tested as a cross-theme bottleneck candidate, not as a generic attention trend.`,
    sections: {
      executiveJudgment: paragraphsByKey('executiveJudgment'),
      context: paragraphsByKey('contextAndWhatChanged'),
      evidenceAssessment: paragraphsByKey('evidenceAssessment'),
      economicMechanism: paragraphsByKey('economicMechanism'),
      marketImplication: paragraphsByKey('marketImplicationAndScenarios'),
      scenarios: [
        { label: 'Upgrade case', text: `Upgrade if independent evidence shows ${blueprint.subject} is capacity-constrained, hard to substitute, and relevant to more than one connected theme.`, ...refs },
        { label: 'Base case', text: `Keep as discovery watch while evidence is plausible but indirect.`, ...refs },
        { label: 'Invalidator', text: `Downgrade if substitutes are easy, supplier redundancy is broad, or no direct operating dependency is found.`, ...refs },
      ],
      whatWouldChangeMind: paragraphsByKey('watchAndResearchAgenda').slice(0, 1),
      watchNext: paragraphsByKey('watchAndResearchAgenda').slice(0, 1),
      researchAgenda: paragraphsByKey('watchAndResearchAgenda').slice(1),
      conclusion: paragraphsByKey('analystConclusion'),
    },
  };
  return applyAdaptiveNarrativeStructureToPlan(plan, null, blueprint);
}

function blockerPhrase(text = '') {
  const cleaned = translateInternalTerms(text || 'the primary evidence blocker remains open');
  if (/\band\b/i.test(cleaned)) return cleaned;
  return /\bis still missing\b|\bremains open\b|\bremains below\b|\bis below\b/i.test(cleaned) ? `that ${cleaned}` : cleaned;
}

export function buildNarrativeBlueprint(bundle = {}, signalCards = {}, analystSynthesis = {}) {
  if (bundle.reportType === 'cross_theme_bottleneck_report') {
    return buildCrossThemeNarrativeBlueprint(bundle, signalCards, analystSynthesis);
  }
  const subject = subjectName(bundle);
  const cards = asArray(signalCards.cards || signalCards);
  const attention = domainCard(cards, 'attention');
  const fundamental = domainCard(cards, 'fundamental');
  const market = domainCard(cards, 'market');
  const constraint = domainCard(cards, 'constraint');
  const causal = domainCard(cards, 'causal');
  const focus = economicFocus(bundle);
  const symbols = symbolsFromBundle(bundle);
  const symbolPhrase = symbolList(symbols);
  const shorthand = focusShorthand(subject);
  const weakAttention = isWeak(attention);
  const refs = refBlock(bundle, [attention, fundamental, market, constraint, causal]);
  const issuerThesisPack = issuerThesisPackFromBundle(bundle);
  const issuerThesisCards = issuerThesisCardsFromPack(issuerThesisPack);
  const scope = bundle.metadata?.deepResearch?.investmentReadiness?.tier || 'standard_report';
  const hasReadinessBlockers = asArray(bundle.metadata?.deepResearch?.investmentReadiness?.blockers).length > 0;
  const blocker = blockerText(bundle);
  const isDefense = /defense|defence|military|munitions|missile/i.test(subject)
    || String(bundle.metadata?.deepResearch?.ontologyPack?.ontologyKey || '').toLowerCase() === 'defense_industrial';
  const stance = isDefense
    ? 'backlog_replenishment_validation'
    : weakAttention
      ? 'narrative_rotation'
      : 'active_research_screen';
  const coreThesis = isDefense
    ? (hasReadinessBlockers
      ? 'backlog conversion and replenishment thesis; book-to-bill evidence still caps conviction'
      : 'backlog conversion and replenishment thesis ready for validation review')
    : weakAttention
    ? 'possible narrative rotation; thesis failure not supported'
    : 'active research screen, with attention separated from economics';
  const readerQuestion = `Is ${subject} moving from coverage into measurable economics: ${focus.drivers}?`;
  const bestCounterargument = `The strongest alternative explanation is that the signal remains an attention artifact instead of a transition into ${shorthand}.`;
  const closingJudgment = scope === 'signal_triage'
    ? `Keep the memo at research-prioritization scope until ${blockerCondition(bundle)}`
    : 'The report can be reviewed as a thesis validation memo, but still needs analyst review before any decision use';

  return {
    version: 'semantic-blueprint-v3',
    reportType: bundle.reportType,
    subject,
    thesis: {
      stance,
      short: coreThesis,
      confidence: weakAttention ? 'low_to_medium' : 'medium',
      decisionUse: scope === 'signal_triage' ? 'research_prioritization' : 'analyst_review',
    },
    readerQuestion,
    evidenceLogic: {
      weakestLeg: weakAttention ? 'attention' : 'unvalidated transmission',
      requiredConfirmation: focus.drivers,
      confirmationShorthand: shorthand,
      constraintPath: focus.constraints,
      marketLinks: symbols,
      blocker,
      blockerClearCondition: blockerCondition(bundle),
      blockerSummary: blockerSummary(bundle),
      hasReadinessBlockers,
    },
    concreteAnchors: {
      event: bestEventAnchor(bundle, focus),
      market: bestMarketAnchor(bundle, symbols),
      blocker,
      blockerSummary: blockerSummary(bundle),
      blockerClearCondition: blockerCondition(bundle),
      hasReadinessBlockers,
    },
    focus,
    symbolPhrase,
    shorthand,
    issuerThesis: {
      status: issuerThesisPack?.status || (issuerThesisCards.length ? 'available' : 'gap'),
      coverage: Number(issuerThesisPack?.coverage ?? 0),
      cards: issuerThesisCards,
      consensusSymbols: asArray(issuerThesisPack?.consensusSymbols),
      valuationSymbols: asArray(issuerThesisPack?.valuationSymbols),
      missingConsensusSymbols: asArray(issuerThesisPack?.missingConsensusSymbols),
      missingValuationSymbols: asArray(issuerThesisPack?.missingValuationSymbols),
      boundary: issuerThesisPack?.boundary || 'Issuer thesis cards are evidence-bound company hypotheses, not recommendations.',
    },
    scope,
    sectionIntent: {
      executiveJudgment: 'state conclusion, confidence, and decision use once',
      context: 'frame the market debate without repeating the thesis sentence',
      whatChanged: 'summarize evidence pattern, not individual event logs',
      evidenceAssessment: 'rank proof strength and identify the binding evidence gap',
      economicMechanism: 'describe transmission path from demand to constraints to exposure',
      marketImplication: 'explain asset relevance and limits of current market evidence',
      counterThesis: 'state the strongest alternative explanation',
      risks: 'state data, source, and method risks that could distort the read',
      caveats: 'state unresolved evidence gaps that cap conviction',
      watchNext: 'external indicators the analyst should monitor',
      researchAgenda: 'executable collection and validation tasks',
    },
    argumentPillars: [
      'Attention is useful as a change detector, not as evidence of fundamental demand by itself.',
      `The fundamental question is whether ${focus.demand} is visible in ${focus.drivers}.`,
      `The constraint question is whether ${focus.constraints} turn the broad narrative into a measurable bottleneck.`,
      `The market question is whether ${symbolPhrase} show repeated sensitivity after benchmark, factor, and regime controls.`,
    ],
    bestCounterargument,
    closingJudgment,
    refs,
  };
}

function buildLongFormSections({
  subject,
  focus,
  shorthand,
  refs,
  coreThesis,
  executiveRead,
  eventAnchorText,
  marketAnchorText,
  blocker,
  blockerSummaryText,
  blockerClearCondition,
  symbolPhrase,
  bestCounterargument,
  hasReadinessBlockers = true,
  hasDecisionGradeMarketEvidence = false,
  issuerThesis = {},
}) {
  const primaryBlocker = translateInternalTerms(blockerSummaryText || blocker || '');
  const primaryBlockerPhrase = blockerPhrase(primaryBlocker);
  const followOnBlocker = conciseBlockerForBody(primaryBlocker);
  const followOnEvidenceTarget = blockerEvidenceTarget(followOnBlocker);
  const blockerContext = blockerContextSentence(primaryBlocker);
  const clearCondition = translateInternalTerms(blockerClearCondition || 'the primary evidence blocker is cleared');
  const isDefense = /defense|defence|military|munitions|missile/i.test(subject);
  const operatingIndicatorPhrase = isDefense
    ? 'the required defense operating KPI set'
    : String(focus.drivers || '').length > 60
      ? 'the required operating KPI set'
      : focus.drivers;
  const operatingLanguage = operatingLanguagePhrase(subject, focus);
  const controls = marketControlPhrase(subject);
  const marketBetaPhrase = isDefense
    ? 'industrial/aerospace-defense beta, rates, or broad risk appetite'
    : 'broad technology, semiconductor, or risk-on exposure';
  const eventAnchorFollowUp = /^No single/i.test(eventAnchorText)
    ? 'The lack of a named event anchor keeps the evidence assessment broad rather than catalyst-led.'
    : 'It is useful as a marker for where to look next, but it does not establish the operating mechanism.';
  const issuerCards = asArray(issuerThesis.cards);
  const issuerAvailable = issuerCards.length > 0;
  const issuerExamples = issuerExamplesSentence(issuerThesis);
  const issuerSummary = issuerThesisSummary(issuerThesis);
  const issuerGaps = issuerThesisGapSentence(issuerThesis);
  return [
    longSection('executiveJudgment', 'Executive Judgment', [
      paragraph({
        claim: `The current ${subject} signal ${executiveRead}.`,
        context: `That does not mean the underlying thesis is settled or broken; it means the attached evidence is asking a narrower question than a simple hot-or-cold theme call.`,
        interpretation: `The operating question is whether fragmented attention is converting into ${operatingIndicatorPhrase}.`,
        implication: hasReadinessBlockers
          ? `If those indicators begin to support the signal, the theme can move from review into active watchlist work; if they do not, the current attention pattern should be downgraded as narrative noise.`
          : `If those indicators continue to support the signal, the theme can remain in thesis validation review; if they do not, the current attention pattern should be downgraded as narrative noise.`,
      }, refs),
      paragraph({
        claim: hasReadinessBlockers
          ? `The decision use is watchlist refinement; trade construction remains outside this evidence state.`
          : `The decision use is investment memo preparation; analysts still approve any portfolio action separately.`,
        context: hasReadinessBlockers
          ? `The report has enough structure to identify what should be monitored, what should be collected, and which market links deserve controlled testing.`
          : `The core evidence lanes are populated, so the memo can enter thesis validation review instead of preliminary screening.`,
        interpretation: hasReadinessBlockers
          ? `It does not yet have the primary operating support needed to translate the theme into an earnings, valuation, or durable alpha claim.`
          : `That does not turn the system into a recommender; it means the remaining work is to judge thesis quality, causal mechanism, and controlled market sensitivity.`,
        implication: hasReadinessBlockers
          ? `The product boundary stays explicit: the memo sharpens the research path without implying an investment conclusion that the evidence cannot support.`
          : `The product boundary stays explicit: the memo is review-ready, while analysts still apply mandate-specific controls before any action.`,
      }, refs),
      paragraph({
        claim: hasReadinessBlockers
          ? `The binding ${/\band\b/i.test(primaryBlockerPhrase) ? 'blockers are' : 'blocker is'} ${primaryBlockerPhrase}.`
          : `No report-blocking evidence gap is attached in the current bundle.`,
        context: hasReadinessBlockers
          ? blockerContext
          : `That moves the memo out of preliminary signal review and into thesis validation review, while keeping action approval separate from automated generation.`,
        implication: hasReadinessBlockers
          ? `Until ${clearCondition}, the right stance is to keep the theme evidence-limited but active enough to justify follow-up collection and controlled market validation.`
          : hasDecisionGradeMarketEvidence
            ? `The next step is analyst validation of mechanism attribution, issuer-specific expectation impact, and portfolio context; the market evidence is no longer the binding data gap.`
            : `The next step is thesis validation against the evidence chain and controlled market tests, because decision-grade validation gaps remain in mechanism support and controlled market sensitivity.`,
        transition: `The next section explains why the current change is better read as coverage fragmentation and research narrowing, not as a completed lifecycle call.`,
      }, refs),
    ], { targetWords: 220 }),
    longSection('contextAndWhatChanged', 'Context and What Changed', [
      paragraph({
        claim: `The market is testing whether ${subject} has moved beyond broad attention into measurable demand.`,
        context: `The harder question is whether the prior narrative is broadening into measurable demand or fragmenting across disconnected headlines.`,
        interpretation: `Attention can flag a change early, but it cannot carry the thesis alone because attention can fade, rotate, or temporarily disperse without proving that end-market demand has changed.`,
        implication: `The report treats recent coverage as a prompt for deeper work, not as a final read on the theme.`,
      }, refs),
      paragraph({
        claim: `The main change is fragmentation, not proof.`,
        context: `Recent coverage still does not combine into a multi-source canonical event, even though there is at least one intensity-qualified item worth monitoring.`,
        evidenceAnchor: eventAnchorText,
        interpretation: `A single visible surge can justify follow-on tracking; a canonical event requires source breadth, timing, and economic relevance.`,
        implication: `The research burden shifts away from generic coverage and toward testing whether the attention pattern is becoming visible in ${shorthand}.`,
      }, refs),
      paragraph({
        claim: `This changes the memo's role.`,
        context: hasReadinessBlockers
          ? `Instead of presenting ${subject} as a completed investment thesis, the memo frames the theme as a testable research question.`
          : `Instead of treating ${subject} as a completed trade thesis, the memo frames the theme as a review-ready thesis validation memo.`,
        interpretation: hasReadinessBlockers
          ? `If the next evidence refresh shows broader independent coverage plus operating support, the rotation read strengthens; if the refresh only adds more isolated headlines, the signal remains evidence-limited.`
          : `If the next evidence refresh shows broader independent coverage plus operating support, the rotation read strengthens; if the refresh only adds more isolated headlines, the memo should stay in thesis validation instead of moving toward decision use.`,
        transition: `That framing leads directly into the evidence hierarchy: which parts of the bundle are strong enough to use, and which parts still cap conviction.`,
      }, refs),
    ], { targetWords: 350 }),
    longSection('evidenceAssessment', 'Evidence Assessment', [
      paragraph({
        claim: `The proof hierarchy is uneven.`,
        context: `Attention is the weakest leg because it describes evidence flow, not fundamental demand by itself.`,
        interpretation: `The stronger research path is to ask whether the available fundamental, filing, market, constraint, and causal evidence all point toward the same operating mechanism.`,
        implication: hasReadinessBlockers
          ? `A broader evidence mix keeps the theme alive as a research candidate, but it does not remove the need for primary support.`
          : `The broader evidence mix is enough to move beyond preliminary screening; the analyst task is now to test whether the mechanism and market evidence justify a stronger view.`,
      }, refs),
      paragraph({
        claim: `The strongest concrete anchor is an event-level monitoring point, not a durable catalyst.`,
        evidenceAnchor: eventAnchorFollowUp,
        interpretation: `Its value is directional: it helps prioritize follow-up, but it does not prove a lifecycle shift, demand inflection, or valuation impact.`,
        implication: `The next useful evidence should connect the event pattern to operating data, not simply increase the article count.`,
      }, refs),
      paragraph({
        claim: hasReadinessBlockers
          ? `The limiting evidence gap is economically important: ${followOnBlocker}.`
          : `The remaining limitation is decision-grade validation, not raw evidence availability.`,
        context: hasReadinessBlockers
          ? `This is now a validation gap, not a raw source-volume or issuer-commentary gap. Until those KPI lanes are observed, the report can identify plausible research paths but cannot determine whether the theme affects earnings, capacity, pricing, or only narrative attention.`
          : `The bundle has enough breadth for review, but not yet enough tested mechanism evidence for an investment conclusion.`,
        interpretation: hasReadinessBlockers
          ? `This is the right place for caution, but not for paralysis. The gap clarifies what to collect next and prevents the memo from overstating conviction.`
          : `That is a higher-quality constraint than a raw data gap: it asks whether the evidence is strong enough to change a view, not whether the system has enough rows to write a memo.`,
        transition: `The next section turns that evidence hierarchy into the economic mechanism the system needs to test.`,
      }, refs),
    ], { targetWords: 400 }),
    longSection('economicMechanism', 'Economic Mechanism', [
      paragraph({
        claim: `The investable path is not attention by itself.`,
        context: `The path is demand growth -> operating pressure -> bottlenecks in ${focus.constraints} -> exposure for ${focus.exposure}.`,
        interpretation: exposureMechanismSentence(subject, focus),
        implication: `The next evidence refresh should test the mechanism, not only the popularity of the theme.`,
      }, refs),
      paragraph({
        claim: `The bottleneck logic is the most important part of the causal read.`,
        context: `For ${subject}, the question is whether ${focus.demand} is showing up in ${shorthand}, beyond media attention alone.`,
        interpretation: `If operating demand is real, the pressure should be visible through capacity, utilization, orders, power, supply, pricing, or management commentary. If those channels do not show support, then the theme may still be topical without being economically decisive.`,
        implication: `The report separates attention weakness from operating-demand weakness for that reason.`,
      }, refs),
      paragraph({
        claim: `Causal links remain hypothesis-level until independent evidence supports both mechanism and timing.`,
        context: `A company, supplier, component, or policy node can sit near the theme without being the actual transmission path.`,
        interpretation: `The memo distinguishes graph adjacency, measured correlation, supported hypothesis, and tested mechanism.`,
        transition: `The same distinction matters for market interpretation because exposed symbols can move with the theme, with sector beta, or with broad risk appetite.`,
      }, refs),
    ], { targetWords: 350 }),
    ...(issuerAvailable ? [longSection('issuerThesisAndValuationBridge', 'Issuer Thesis and Valuation Bridge', [
      paragraph({
        claim: `The company-level bridge is now explicit but uneven.`,
        context: issuerSummary,
        evidenceAnchor: issuerExamples,
        interpretation: issuerBridgeInterpretationSentence(subject, focus),
        implication: `This bridge is what moves the memo from theme relevance toward issuer-specific earnings revision, multiple expansion, or downside-risk pathways.`,
      }, refs),
      paragraph({
        claim: isDefense
          ? `The defense-prime thesis should split by business model instead of treating RTX, LMT, NOC, and GD as interchangeable defense exposure.`
          : `The issuer thesis should split by operating exposure instead of treating every monitored symbol as the same theme proxy.`,
        context: isDefense
          ? `Missile and air-defense demand matters differently for RTX and LMT than shipyard throughput does for GD or space and sensors programs do for NOC.`
          : `Different issuers translate the same theme through different revenue, margin, capex, and valuation channels.`,
        interpretation: `The report should read company rows as thesis bridges, not as a ticker list.`,
        implication: `The next upgrade requires issuer-specific evidence that links operating KPIs to segment revenue, margin, guidance, or consensus expectations, not broad thematic adjacency.`,
      }, refs),
      paragraph({
        claim: `The valuation and consensus translation is still the gating issue for investment-language output.`,
        context: issuerGaps,
        interpretation: `Screening market sensitivity can identify where to look, but alone it cannot say whether expectations are too low, estimates should rise, multiples should expand, or downside risk is mispriced.`,
        implication: `The memo stays in thesis-validation mode until issuer-level fundamentals, consensus, valuation context, and controlled market evidence line up for the same company-level story.`,
        transition: `That issuer bridge is what the market implication section now has to test.`,
      }, refs),
    ], { targetWords: 360 })] : []),
    longSection('marketImplicationAndScenarios', 'Market Implication and Scenarios', [
      paragraph({
        claim: `The market evidence supports watchlist construction and analyst action review.`,
        evidenceAnchor: marketAnchorText,
        context: hasDecisionGradeMarketEvidence
          ? `Those names now show controlled market expression, but that still does not prove durable theme alpha without issuer-level mechanism attribution and portfolio-context review.`
          : `Those names can help monitor whether the theme has market expression, but current sensitivity still needs ${controls} before it can be treated as durable theme alpha.`,
        interpretation: `The practical question is whether price moves line up with the economic mechanism or merely reflect ${marketBetaPhrase}.`,
        implication: `Until that test is complete, market links should guide monitoring and analyst review, not position sizing.`,
      }, refs),
      paragraph({
        claim: `The upgrade case requires alignment across evidence types.`,
        context: `The theme strengthens if fragmented coverage consolidates around ${shorthand}, direct filing or management evidence supports demand, and monitored assets show repeated controlled sensitivity.`,
        interpretation: hasReadinessBlockers
          ? `That combination would move the report from signal triage toward an active analyst memo because the narrative, operating evidence, and market behavior would point in the same direction.`
          : `That combination would move the report from thesis validation review toward active thesis review because the narrative, operating evidence, and market behavior would point in the same direction.`,
        implication: hasReadinessBlockers
          ? `The base case remains research-candidate status until that alignment appears.`
          : `The base case remains thesis validation review until that alignment appears.`,
      }, refs),
      paragraph({
        claim: `The downgrade case is also clear.`,
        context: `If coverage stays narrow, causal edges remain candidate-tier, and controlled event studies explain the apparent reaction as market beta, the skeptical interpretation wins.`,
        interpretation: hasReadinessBlockers
          ? `In that outcome, ${subject} can remain a monitored theme without receiving additional research priority.`
          : `In that outcome, ${subject} can remain a monitored theme without being advanced from thesis validation review into decision use.`,
        transition: `That scenario discipline is what keeps the next section's counter-thesis and caveats from becoming generic disclaimers.`,
      }, refs),
    ], { targetWords: 350 }),
    longSection('counterRisksCaveats', 'Counter-Thesis, Risks, and Caveats', [
      paragraph({
        claim: bestCounterargument,
        context: `This is the strongest skeptical read because attention can create an apparent signal before operating evidence appears.`,
        interpretation: `If the current evidence is only a media artifact, then broader coverage will not translate into demand support, causal mechanisms will remain adjacency-only, and market sensitivity will fail under controlled tests.`,
        implication: `The counter-thesis is not a reason to ignore the theme; it is the standard that the next evidence refresh must beat.`,
      }, refs),
      paragraph({
        claim: `The main method risks are source concentration, graph-derived links, and uncontrolled market beta.`,
        context: `Each can make the signal look stronger than the underlying economics support.`,
        interpretation: `Source concentration can manufacture momentum, graph extraction can over-produce plausible but weak connections, and broad market rallies can make exposed names look theme-sensitive even when they are simply moving with the tape.`,
        implication: `These risks should stay visible in the memo but should not be repeated as generic warnings in every section.`,
      }, refs),
      paragraph({
        claim: `The principal caveat is conviction, not relevance.`,
        context: hasReadinessBlockers
          ? `The theme is relevant enough for research prioritization, but the primary evidence blocker still prevents an investment-grade conclusion.`
          : `The theme is broad enough for thesis validation review, but automated evidence assembly still should not become position sizing or a finished call by itself.`,
        interpretation: hasReadinessBlockers
          ? `That caveat should cap the memo's use while preserving the workflow value: identify evidence gaps, collect the missing inputs, and rerun the report with stronger primary support.`
          : `That caveat preserves the product boundary: the system can now produce a reviewable thesis validation memo, while the analyst must still decide whether the thesis, mechanism, and market evidence justify action.`,
        transition: `The final section converts that caveat into concrete watch conditions and executable research tasks.`,
      }, refs),
    ], { targetWords: 320 }),
    longSection('watchAndResearchAgenda', 'What to Watch and Research Agenda', [
      paragraph({
        claim: `Watch for external evidence that the signal is broadening beyond media attention into ${shorthand}.`,
        context: `The useful signs are broader independent coverage, direct management commentary, and market sensitivity that persists outside broad risk-on rallies.`,
        interpretation: `These watch conditions define what would make the thesis more credible to an analyst reading the next update.`,
        implication: hasReadinessBlockers
          ? `If they do not appear, the theme should remain in discovery even if another short coverage pulse emerges.`
          : `If they do not appear, the theme should remain in evidence-bound review even if another short coverage pulse emerges.`,
      }, refs),
      paragraph({
        claim: hasReadinessBlockers
          ? `The executable research agenda follows directly from the evidence gap.`
          : `The executable research agenda now shifts from evidence collection to validating the thesis memo.`,
        context: hasReadinessBlockers
          ? `Collect direct call transcripts and filing updates for ${symbolPhrase}, then extract ${operatingLanguage}.`
          : `Review the attached filing and management-commentary evidence for ${symbolPhrase}, then extract ${operatingLanguage} into decision-ready evidence notes.`,
        interpretation: hasReadinessBlockers
          ? `Success requires direct issuer excerpts or provider observations that support or challenge the missing operating KPI lanes.`
          : `Success means the analyst can identify which excerpts support, weaken, or do not bear on the operating-demand thesis.`,
        implication: hasDecisionGradeMarketEvidence
          ? `After that, refresh controlled event studies against ${controls}; the market lane stays useful only if sensitivity persists as new events enter the sample.`
          : `After that, recompute controlled event studies against ${controls}; market evidence improves only if sensitivity remains positive after those controls.`,
      }, refs),
      paragraph({
        claim: `The conclusion stays conditional.`,
        context: hasReadinessBlockers
          ? `${subject} should remain a research candidate until the mechanism is substantiated, monitored market links hold up under controls, or the signal is downgraded as narrative noise.`
          : `${subject} should remain a thesis validation memo until the mechanism is substantiated, monitored market links hold up under controls, or the signal is downgraded as narrative noise.`,
        interpretation: `That conditional stance is the point of the long-form memo: it does not make unsupported facts, but it gives the user a coherent path for deciding what to believe next.`,
      }, refs),
    ], { targetWords: 320 }),
    longSection('analystConclusion', 'Analyst Conclusion', [
      paragraph({
        claim: hasReadinessBlockers
          ? `${subject} is not ready to be treated as a finished investment call, but it is now framed as a coherent research question instead of a dashboard scan.`
          : `${subject} is now a review-ready thesis validation memo instead of a dashboard scan.`,
        context: `The memo's value is the path it creates: separate attention from operating demand, test the mechanism, recheck market sensitivity, and downgrade the signal if those checks fail.`,
        interpretation: `That is a longer-form analyst conclusion because it explains how the reader should use the evidence, not just what the current status label says.`,
        implication: hasReadinessBlockers
          ? `The next update should either strengthen the evidence chain with ${followOnEvidenceTarget} and controlled market tests, or move the theme back to lower-priority monitoring.`
          : hasDecisionGradeMarketEvidence
            ? `The next update should either turn the validated market lane into issuer-specific thesis attribution or explain why market strength does not change the analyst view.`
            : `The next update should either upgrade the thesis after controlled market checks or move the theme back to lower-priority monitoring.`,
      }, refs),
    ], { targetWords: 90 }),
  ];
}

export function renderClientMemoFromBlueprint(blueprint = {}) {
  if (blueprint.reportType === 'cross_theme_bottleneck_report') {
    return renderCrossThemeClientMemoFromBlueprint(blueprint);
  }
  const {
    subject = 'The subject',
    thesis = {},
    focus = economicFocus({ subject: { displayName: subject } }),
    symbolPhrase = 'the monitored peer set',
    shorthand = focusShorthand(subject),
    refs = {},
    concreteAnchors = {},
    issuerThesis = {},
    bestCounterargument = 'The strongest alternative explanation is that the signal remains an attention artifact.',
    closingJudgment = 'Keep this memo in analyst review until the primary evidence blocker is cleared',
  } = blueprint;
  const coreThesis = thesis.short || 'active research screen, with attention separated from economics';
  const hasReadinessBlockers = concreteAnchors.hasReadinessBlockers !== false;
  const executiveRead = /backlog conversion/i.test(coreThesis)
    ? (hasReadinessBlockers
      ? 'is best framed as a backlog-conversion and replenishment-cycle thesis, but book-to-bill evidence still caps conviction'
      : 'is best framed as a backlog-conversion and replenishment-cycle thesis ready for analyst validation')
    : /narrative rotation/i.test(coreThesis)
    ? 'does not support a thesis-breakdown call and is more consistent with possible rotation'
    : 'remains on the active research screen with attention separated from economics';
  const watchNext = buildWatchBlocks({ subject, shorthand, refs });
  const researchAgenda = buildResearchTasks({
    subject,
    focus,
    symbols: asArray(blueprint.evidenceLogic?.marketLinks),
    shorthand,
    refs,
  });
  const eventAnchor = concreteAnchors.event;
  const eventAnchorText = eventAnchorSentence(eventAnchor);
  const marketAnchor = concreteAnchors.market;
  const marketAnchorText = marketAnchorSentence(marketAnchor, symbolPhrase);
  const hasDecisionGradeMarketEvidence = Boolean(marketAnchor?.decisionGrade || marketAnchor?.marketValidationTier === 'decision_grade');
  const longFormSections = buildLongFormSections({
    subject,
    focus,
    shorthand,
    refs,
    coreThesis,
    executiveRead,
    eventAnchorText,
    marketAnchorText,
    blocker: concreteAnchors.blocker,
    blockerSummaryText: concreteAnchors.blockerSummary,
    blockerClearCondition: concreteAnchors.blockerClearCondition,
    symbolPhrase,
    bestCounterargument,
    hasReadinessBlockers,
    hasDecisionGradeMarketEvidence,
    issuerThesis,
  });
  const issuerThesisSection = longFormSections.find((section) => section.key === 'issuerThesisAndValuationBridge');
  const marketAnchorShort = marketAnchor?.topSymbol
    ? `The market anchor is monitored sensitivity in ${marketAnchor.topSymbol}; it is useful for watchlist construction until controlled event studies show persistence.`
    : `No single market anchor is strong enough to carry the thesis; market evidence should remain a monitoring input.`;

  const plan = {
    ...blueprint,
    version: 'semantic-plan-v3',
    blueprintVersion: blueprint.version,
    longFormSections,
    openingFrame: `The evidence does not yet show ${subject} thesis failure. It shows fragmented attention that still needs to be tested against operating-demand indicators: ${focus.drivers}.`,
    sections: {
      executiveJudgment: [
        block(`Current read: ${subject} ${executiveRead}. The evidence supports a narrower question about whether attention is translating into operating evidence, constraints, and monitored market links.`, refs),
        block(concreteAnchors.hasReadinessBlockers === false
          ? `Decision use is bounded: this memo can move into analyst review as a thesis validation memo, but it should not become portfolio action without human approval and controlled validation.`
          : `Decision use is bounded: this memo can refine the watchlist and evidence plan, but it should not become a trade-construction memo until the binding blocker is resolved.`, refs),
        block(concreteAnchors.hasReadinessBlockers === false
          ? `Use the next pass to test the mechanism and market links instead of backfilling generic evidence.`
          : `Keep the memo at research-prioritization scope until the primary evidence blocker is cleared.`, refs),
      ],
      context: [
        block(`The market is not trying to decide whether ${subject} is simply hot or cold. The real debate is whether the prior narrative is broadening into measurable demand or fragmenting across disconnected headlines.`, refs),
        block(`If ${shorthand} does not support the signal, the theme should stay under review even if the next coverage pulse looks stronger.`, refs),
      ],
      evidenceAssessment: [
        block(`The proof hierarchy is uneven. Attention is the weakest leg, while economic and market context is sufficient to keep the research thread alive. The next evidence should substantiate operating demand, not just add another generic article.`, refs),
        block(eventAnchorText, refs),
        block(concreteAnchors.hasReadinessBlockers === false
          ? `No report-blocking evidence gap is attached. Decision-grade validation remains in mechanism support and controlled market sensitivity; the remaining question is whether the evidence is strong enough to change an analyst view, not whether the system has enough rows to write the memo.`
          : `The binding gap is economically important: ${translateInternalTerms(concreteAnchors.blocker || 'the primary evidence blocker remains open')}. It caps conviction because it determines whether the theme affects earnings, capacity, pricing, or only narrative attention.`, refs),
      ],
      economicMechanism: [
        block(`The investable path is not attention by itself. The path is demand growth -> operating pressure -> bottlenecks in ${focus.constraints} -> exposure for ${focus.exposure}. That is the chain the next evidence refresh has to support.`, refs),
        block(`Causal links should therefore stay hypothesis-level until independent evidence supports both the mechanism and the timing. The memo should distinguish adjacency from transmission: an entity can be near the theme without being the economic bottleneck.`, refs),
      ],
      issuerThesis: issuerThesisSection?.paragraphs || [],
      marketImplication: [
        block(`${marketAnchorShort} The monitored market links are concentrated in ${symbolPhrase}. For now, that supports watchlist construction and analyst review.`, refs),
        block(`The practical implication is to test whether price sensitivity aligns with the economic mechanism. If reactions appear only during broad risk-on or sector rallies, the signal is not yet durable theme alpha.`, refs),
      ],
      scenarios: [
        {
          label: 'Upgrade scenario',
          text: translateInternalTerms(`The theme strengthens if fragmented coverage consolidates around ${shorthand}. The strongest version would combine broader independent source coverage, direct support from filings or management commentary, and repeated market sensitivity across benchmark, factor, and regime controls.`),
          ...refs,
        },
        {
          label: 'Base case',
          text: concreteAnchors.hasReadinessBlockers === false
            ? translateInternalTerms(`The current base case is thesis validation review. The signal is useful for investment memo preparation because the theme has monitored market links and economic questions, but the evidence still needs analyst judgment before decision use.`)
            : translateInternalTerms(`The current base case is research-candidate status. The signal is useful for prioritization because the theme has monitored market links and economic questions, but the evidence does not yet support a final investment memo.`),
          ...refs,
        },
        {
          label: 'Downgrade scenario',
          text: concreteAnchors.hasReadinessBlockers === false
            ? translateInternalTerms(`The skeptical case wins if coverage stays narrow, causal edges remain candidate-tier, and market sensitivity disappears under controlled event studies. In that outcome, the theme should stay in thesis validation review instead of decision use.`)
            : translateInternalTerms(`The skeptical case wins if coverage stays narrow, causal edges remain candidate-tier, and market sensitivity disappears under controlled event studies. In that outcome, the theme should stay under review instead of active watchlist status.`),
          ...refs,
        },
      ],
      whatWouldChangeMind: [
        block(`Upgrade the view if independent coverage broadens, direct management or filing evidence supports ${shorthand}, and monitored assets show repeated controlled sensitivity.`, refs),
        block(`Downgrade the view if the signal remains single-source, the causal map stays graph-derived, or benchmark/factor/regime controls explain the apparent market reaction.`, refs),
      ],
      watchNext,
      researchAgenda,
      conclusion: [
        block(concreteAnchors.hasReadinessBlockers === false
          ? `${subject} should remain a thesis validation memo pending analyst action review. The memo's value is narrowing the next validation step: substantiate the mechanism, test monitored market links under controls, or downgrade the signal as narrative noise.`
          : `${subject} should remain a research candidate, not a finished investment call. The memo's value is narrowing the next evidence collection step: substantiate the mechanism, test monitored market links under controls, or downgrade the signal as narrative noise.`, refs),
      ],
    },
  };
  return applyAdaptiveNarrativeStructureToPlan(plan, null, blueprint);
}

export function buildNarrativePlan(bundle = {}, signalCards = {}, analystSynthesis = {}) {
  return renderClientMemoFromBlueprint(buildNarrativeBlueprint(bundle, signalCards, analystSynthesis));
}

function cleanText(text = '') {
  return translateInternalTerms(text)
    .replace(/\bFundamental coverage is present through ([^.]+)\./gi, 'The fundamental leg is not empty, but it still needs economic confirmation.')
    .replace(/\bPack-level missing areas: none\.\s*/gi, '')
    .replace(/\bKPI-level gaps are handled separately[^.]*\.\s*/gi, '')
    .replace(/\bThe generic theme indicator coverage covers multiple indicators, has supporting observations, fresh coverage still needs context, and leaves several indicator checks for the research queue\.\s*/gi, 'The indicator work is broad enough for triage but still needs direct economic confirmation. ')
    .replace(/\bScope is signal triage:\s*/gi, 'The scope remains signal triage: ')
    .replace(/\bThis is a signal-triage memo, not a final investment memo\./gi, 'This is a research-prioritization memo, not a final investment memo.')
    .replace(/\bTreat this as a backfill requirement before raising conviction beyond the attached evidence\./gi, 'Resolve this before raising conviction.')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMemoText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(value = '') {
  return new Set(normalizeMemoText(value).split(/\s+/).filter((token) => token.length > 3));
}

function jaccardSimilarity(a = '', b = '') {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / Math.max(1, new Set([...left, ...right]).size);
}

function sectionText(items = []) {
  return asArray(items).map((item) => item.text || item.label || '').join(' ');
}

function dedupeBlocks(blocks = []) {
  const seen = new Set();
  const out = [];
  for (const block of asArray(blocks)) {
    const key = normalizeMemoText(block.text || block.label || '').slice(0, 220);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(block);
  }
  return out;
}

const MENTION_BUDGETS = [
  {
    key: 'coreThesisExact',
    pattern: /\bnarrative rotation, not thesis failure\b/gi,
    max: 1,
    replacement: 'the current rotation read',
  },
  {
    key: 'fullDriverList',
    pattern: /\bcapex, cloud revenue, accelerator orders, data-center utilization, and power-demand proxies\b/gi,
    max: 1,
    replacement: 'operating-demand indicators',
  },
  {
    key: 'directTranscriptGap',
    pattern: /\bdirect call-transcript evidence is still missing\b/gi,
    max: 2,
    replacement: 'the primary evidence blocker remains open',
  },
  {
    key: 'researchScope',
    pattern: /\bresearch-prioritization memo, not a final investment memo\b/gi,
    max: 1,
    replacement: 'research-prioritization scope',
  },
  {
    key: 'controlList',
    pattern: /\bbenchmark, factor, and regime controls\b/gi,
    max: 2,
    replacement: 'controlled market checks',
  },
];

function applyMentionBudgetToText(text = '', state = {}) {
  let out = String(text || '');
  for (const budget of MENTION_BUDGETS) {
    out = out.replace(budget.pattern, (match) => {
      state[budget.key] = Number(state[budget.key] || 0) + 1;
      return state[budget.key] <= budget.max ? match : budget.replacement;
    });
  }
  return out;
}

function enforceMentionBudget(edited = {}, sectionKeys = []) {
  const state = {};
  for (const key of sectionKeys) {
    if (!Array.isArray(edited[key])) continue;
    edited[key] = edited[key].map((item) => ({
      ...item,
      ...(item.text != null ? { text: applyMentionBudgetToText(item.text, state) } : {}),
    }));
  }
  return edited;
}

function cleanLongFormSections(sections = [], state = {}) {
  return asArray(sections).map((section) => ({
    ...section,
    paragraphs: dedupeBlocks(asArray(section.paragraphs).map((item) => ({
      ...item,
      ...(item.text != null ? { text: applyMentionBudgetToText(cleanText(item.text), state) } : {}),
    }))),
  }));
}

export function applyNarrativeEditorPass(analysis = {}) {
  const edited = { ...analysis };
  const sectionKeys = [
    'keyJudgments',
    'thesis',
    'context',
    'whatChanged',
    'dataDepth',
    'causalChain',
    'issuerThesis',
    'historicalAnalogues',
    'evidenceSynthesis',
    'marketTransmission',
    'scenarios',
    'risks',
    'alternativeExplanations',
    'informationGaps',
    'watchNext',
    'decisionUse',
    'analystConclusion',
    'researchAgenda',
    'whatWouldChangeMind',
  ];
  for (const key of sectionKeys) {
    if (!Array.isArray(edited[key])) continue;
    edited[key] = dedupeBlocks(edited[key].map((item) => ({
      ...item,
      ...(item.text != null ? { text: cleanText(item.text) } : {}),
      ...(item.label != null ? { label: titleCase(item.label) } : {}),
    })));
  }
  enforceMentionBudget(edited, sectionKeys);
  if (Array.isArray(edited.longFormSections)) {
    edited.longFormSections = cleanLongFormSections(edited.longFormSections, {});
  }
  const plan = edited.narrativePlan || {};
  if (jaccardSimilarity(sectionText(edited.watchNext), sectionText(edited.researchAgenda)) > 0.72) {
    if (Array.isArray(plan.sections?.watchNext) && plan.sections.watchNext.length) {
      edited.watchNext = dedupeBlocks(plan.sections.watchNext.map((item) => ({ ...item, text: cleanText(item.text) })));
    }
    if (Array.isArray(plan.sections?.researchAgenda) && plan.sections.researchAgenda.length) {
      edited.researchAgenda = dedupeBlocks(plan.sections.researchAgenda.map((item) => ({ ...item, text: cleanText(item.text) })));
    }
  }
  if (jaccardSimilarity(sectionText(edited.alternativeExplanations), sectionText(edited.risks)) > 0.72) {
    const refs = plan.refs || {};
    edited.risks = [
      block('The main methodology risk is that source concentration, graph-derived links, or uncontrolled market beta can make the signal look stronger than it is.', refs),
      block('A separate data risk is that stale or proxy evidence can preserve an old narrative after the current operating evidence has changed.', refs),
    ].map((item) => ({ ...item, text: cleanText(item.text) }));
  }
  return edited;
}
