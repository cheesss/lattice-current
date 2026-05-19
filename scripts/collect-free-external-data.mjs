#!/usr/bin/env node
/*
 * Collect free external data packs that require only user-provided keys.
 *
 * Current providers:
 *   - FRED_API_KEY -> macro/rates/credit/economic series
 *   - EIA_API_KEY  -> energy/electricity/commodity series
 *
 * The script persists provider facts as reviewed-source observations, not as
 * canonical theme claims. Reports can then cite them through the evidence pack.
 */

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureGenericKpiSchema } from './_shared/generic-kpi-collection.mjs';
import {
  filterIssuerSymbols,
  ontologyKpiDefinitionsForTheme,
} from './_shared/theme-ontology.mjs';
import { loadFor as loadFred, isAvailable as fredAvailable } from './_shared/external-data/fred.mjs';
import { loadFor as loadEia, isAvailable as eiaAvailable } from './_shared/external-data/eia.mjs';
import { loadFor as loadFmp, isAvailable as fmpAvailable } from './_shared/external-data/fmp.mjs';
import { loadFor as loadPolygon, isAvailable as polygonAvailable } from './_shared/external-data/polygon.mjs';
import { SUBJECT_KINDS } from './_shared/external-data/adapter-base.mjs';
import { ensureTrackingTargetsSchema, refreshTrackedTargetHits } from './_shared/tracking-targets.mjs';
import { runSecCompanyFacts } from './fetch-sec-company-facts.mjs';
import { routeEvidenceProvider } from './_shared/evidence-provider-router.mjs';
import { persistEvidenceBundles } from './_shared/evidence-collector.mjs';
import { ensureResearchOsSchema } from './_shared/adjacency-graph.mjs';
import { evaluateEvidenceClassAcceptance } from './_shared/evidence-class-playbooks.mjs';
import { collectorCapability } from './_shared/collector-capability-matrix.mjs';

const { Client } = pg;
const DEFAULT_THEME = 'cloud-infrastructure';
const DEFAULT_LABEL = 'Cloud Infrastructure';
const DEFAULT_PROVIDERS = ['fred', 'eia', 'public-planning-source', 'sec', 'fmp', 'polygon', 'dod-contracts', 'usaspending'];
const DOD_CONTRACTS_RSS_URL = 'https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=400&Site=945&max=30';
const USASPENDING_AWARD_SEARCH_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
const PUBLIC_PLANNING_SOURCE_CATALOG = Object.freeze([
  {
    provider: 'lbl-emp',
    name: 'LBNL Queued Up interconnection queue dataset',
    url: 'https://emp.lbl.gov/publications/queued-2025-edition-characteristics',
    evidenceClasses: ['grid_interconnection', 'power_constraint', 'operating_kpi', 'mechanism_validation'],
    match: /\b(interconnection|queue|grid|transmission|utility|power|data.?center|clean.?energy)\b/i,
    terms: [
      'interconnection queues',
      'impact studies',
      'interconnection wait times',
      'ISOs',
      'RTOs',
      'utilities',
      'gigawatts',
      'GW',
    ],
  },
  {
    provider: 'lbl-emp',
    name: 'LBNL interconnection queue resource hub',
    url: 'https://emp.lbl.gov/queues',
    evidenceClasses: ['grid_interconnection', 'power_constraint', 'operating_kpi', 'mechanism_validation'],
    match: /\b(interconnection|queue|grid|transmission|utility|power|clean.?energy)\b/i,
    terms: [
      'interconnection queues',
      'queue data',
      'transmission grid operators',
      'wait times',
      'gigawatts',
      'GW',
    ],
  },
  {
    provider: 'ferc',
    name: 'FERC interconnection final rule explainer',
    url: 'https://www.ferc.gov/explainer-interconnection-final-rule',
    evidenceClasses: ['grid_interconnection', 'power_constraint', 'mechanism_validation', 'substitution_limit'],
    match: /\b(interconnection|queue|backlog|transmission|rto|iso|utility|grid)\b/i,
    terms: [
      'interconnection',
      'backlogs',
      'transmission providers',
      'interconnection process',
      'queue processing times',
      'commercial readiness',
    ],
  },
  {
    provider: 'ferc',
    name: 'FERC interconnection final rule fact sheet',
    url: 'https://www.ferc.gov/news-events/news/fact-sheet-improvements-generator-interconnection-procedures-and-agreements',
    evidenceClasses: ['grid_interconnection', 'mechanism_validation', 'substitution_limit'],
    match: /\b(interconnection|queue|study|transmission provider|timely|delays?|backlog)\b/i,
    terms: [
      'cluster study process',
      'transmission providers',
      'interconnection studies',
      'interconnection queue',
      'delays',
      'site control',
    ],
  },
  {
    provider: 'govinfo',
    name: 'Federal Register FERC Order 2023 interconnection final rule',
    url: 'https://www.govinfo.gov/content/pkg/FR-2023-09-06/html/2023-16628.htm',
    evidenceClasses: ['grid_interconnection', 'policy_funding', 'mechanism_validation', 'substitution_limit', 'technical_qualification'],
    match: /\b(interconnection|cluster study|site control|commercial readiness|withdrawal penalties|transmission provider|queue|system impact study|facilities study)\b/i,
    terms: [
      'cluster study process',
      'transmission providers',
      'site control',
      'commercial readiness deposit',
      'withdrawal penalties',
      'system impact study',
      'facilities study',
      'interconnection queue',
    ],
  },
  {
    provider: 'gao',
    name: 'GAO major rule report on FERC interconnection reforms',
    url: 'https://www.gao.gov/products/b-335566',
    evidenceClasses: ['grid_interconnection', 'policy_funding', 'mechanism_validation', 'substitution_limit'],
    match: /\b(interconnection|queue backlogs|certainty|prevent undue discrimination|large generator|small generator)\b/i,
    terms: [
      'interconnection queue backlogs',
      'improve certainty',
      'prevent undue discrimination',
      'generator interconnection procedures',
      'FERC-516',
      'FERC-516A',
    ],
  },
  {
    provider: 'eia',
    name: 'EIA data-center electricity demand and grid manager evidence',
    url: 'https://www.eia.gov/todayinenergy/detail.php?id=67344',
    evidenceClasses: ['power_constraint', 'grid_interconnection', 'operating_kpi'],
    match: /\b(data.?center|power|electricity|grid|utility|load|demand|interconnection)\b/i,
    terms: [
      'data centers',
      'electricity demand',
      'grid managers',
      'interconnection',
      'large load customers',
      'future electricity demand',
    ],
  },
  {
    provider: 'doe',
    name: 'DOE data-center electricity demand grid enablers',
    url: 'https://www.energy.gov/oe/clean-energy-resources-meet-data-center-electricity-demand',
    evidenceClasses: ['power_constraint', 'grid_interconnection', 'policy_funding', 'mechanism_validation'],
    match: /\b(data.?center|electricity|grid|interconnection|utility|clean.?energy|power)\b/i,
    terms: [
      'data centers',
      'interconnection',
      'regulatory reforms',
      'electricity demand',
      'modernize the grid',
    ],
  },
  {
    provider: 'doe-i2x',
    name: 'DOE interconnection queue management and study-capacity evidence',
    url: 'https://www.energy.gov/eere/i2x/funding-notice-i2x-innovative-queue-management-solutions-iqms-clean-energy-interconnection',
    evidenceClasses: ['grid_interconnection', 'supplier_capacity', 'mechanism_validation', 'substitution_limit'],
    match: /\b(interconnection|queue|study|utility|energization|backlog|delay|software|impact studies)\b/i,
    terms: [
      'queue management',
      'interconnection study processes',
      'impact studies',
      'technical reviews',
      'distribution utilities',
      'long delays',
    ],
  },
  {
    provider: 'doe-i2x',
    name: 'DOE interconnection resources and standards evidence',
    url: 'https://www.energy.gov/eere/i2x/interconnection-resources',
    evidenceClasses: ['grid_interconnection', 'technical_qualification', 'mechanism_validation'],
    match: /\b(interconnection|queue|standard|study|transmission|distribution|ieee|p2800)\b/i,
    terms: [
      'interconnection resources',
      'best practices',
      'standards',
      'interconnection queue data',
      'transmission systems',
      'P2800',
    ],
  },
]);
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const SYMBOL_TEXT_STOPLIST = new Set([
  'SEC', 'KPI', 'MD', 'MD&A', 'API', 'URL', 'RSS', 'ETF', 'FX', 'USD', 'CPI',
  'GDP', 'FRED', 'EIA', 'FMP', 'AI', 'ML', 'OS', 'DB', 'NATO', 'EU', 'UN',
  'US', 'USA', 'DOD', 'MOD', 'MW', 'LLM', 'FY', 'Q1', 'Q2', 'Q3', 'Q4',
]);
const DIRECT_TARGET_TERM_STOPWORDS = new Set([
  'earnings', 'call', 'transcript', 'management', 'commentary', 'guidance',
  'demand', 'supply', 'capacity', 'issuer', 'exposure', 'segment', 'revenue',
  'backlog', 'customer', 'contract', 'annual', 'quarterly', 'report', 'filing',
  'evidence', 'direct', 'official', 'source', 'provider', 'risk', 'factor',
  'exhibit', 'presentation', 'investor', 'relations', 'company', 'business',
  'support', 'supports', 'supporting', 'confirmation', 'validation',
]);

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    theme: DEFAULT_THEME,
    label: DEFAULT_LABEL,
    themes: [],
    providers: [...DEFAULT_PROVIDERS],
    symbols: [],
    autoDiscover: false,
    force: false,
    limit: 50,
    sinceHours: 24 * 14,
    throttleHours: 12,
    trackingLookbackDays: 180,
    usaspendingLookbackDays: 365,
    secRefresh: true,
    secRefreshStaleHours: 24 * 7,
    secMaxFacts: 600,
    secMaxFilings: 80,
    reportId: null,
    providerConcurrency: Math.max(1, Math.min(12, Number(process.env.EXTERNAL_PROVIDER_CONCURRENCY || 4))),
    targetConcurrency: Math.max(1, Math.min(12, Number(process.env.EXTERNAL_PROVIDER_TARGET_CONCURRENCY || 4))),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--theme') out.theme = argv[++i] || out.theme;
    else if (arg === '--themes') out.themes = String(argv[++i] || '').split(',').map((x) => x.trim()).filter(Boolean);
    else if (arg === '--label') out.label = argv[++i] || out.label;
    else if (arg === '--providers') out.providers = String(argv[++i] || '').split(',').map((x) => x.trim()).filter(Boolean);
    else if (arg === '--symbols') out.symbols = String(argv[++i] || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    else if (arg === '--auto-discover') out.autoDiscover = true;
    else if (arg === '--force') out.force = true;
    else if (arg === '--limit') out.limit = Math.max(1, Math.min(500, Number(argv[++i] || out.limit)));
    else if (arg === '--since-hours') out.sinceHours = Math.max(1, Math.min(24 * 365, Number(argv[++i] || out.sinceHours)));
    else if (arg === '--throttle-hours') out.throttleHours = Math.max(0, Math.min(24 * 30, Number(argv[++i] || out.throttleHours)));
    else if (arg === '--tracking-lookback-days') out.trackingLookbackDays = Math.max(1, Math.min(1825, Number(argv[++i] || out.trackingLookbackDays)));
    else if (arg === '--usaspending-lookback-days') out.usaspendingLookbackDays = Math.max(30, Math.min(3650, Number(argv[++i] || out.usaspendingLookbackDays)));
    else if (arg === '--no-sec-refresh') out.secRefresh = false;
    else if (arg === '--sec-refresh-stale-hours') out.secRefreshStaleHours = Math.max(0, Math.min(24 * 365, Number(argv[++i] || out.secRefreshStaleHours)));
    else if (arg === '--sec-max-facts') out.secMaxFacts = Math.max(0, Math.min(2000, Number(argv[++i] || out.secMaxFacts)));
    else if (arg === '--sec-max-filings') out.secMaxFilings = Math.max(0, Math.min(250, Number(argv[++i] || out.secMaxFilings)));
    else if (arg === '--report-id') out.reportId = String(argv[++i] || '').trim() || null;
    else if (arg.startsWith('--report-id=')) out.reportId = String(arg.slice('--report-id='.length) || '').trim() || null;
    else if (arg === '--provider-concurrency') out.providerConcurrency = Math.max(1, Math.min(12, Number(argv[++i] || out.providerConcurrency)));
    else if (arg.startsWith('--provider-concurrency=')) out.providerConcurrency = Math.max(1, Math.min(12, Number(arg.slice('--provider-concurrency='.length) || out.providerConcurrency)));
    else if (arg === '--target-concurrency') out.targetConcurrency = Math.max(1, Math.min(12, Number(argv[++i] || out.targetConcurrency)));
    else if (arg.startsWith('--target-concurrency=')) out.targetConcurrency = Math.max(1, Math.min(12, Number(arg.slice('--target-concurrency='.length) || out.targetConcurrency)));
  }
  return out;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

function labelFromSlug(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cleanText(value, max = 220) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeDirectTermText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function directTargetTermsFromText(value = '') {
  const words = normalizeDirectTermText(value)
    .split(' ')
    .filter((word) => word.length >= 4)
    .filter((word) => !DIRECT_TARGET_TERM_STOPWORDS.has(word))
    .filter((word) => !SYMBOL_TEXT_STOPLIST.has(word.toUpperCase()))
    .slice(0, 18);
  const terms = [];
  for (let size = 4; size >= 2; size -= 1) {
    for (let index = 0; index <= words.length - size; index += 1) {
      const phrase = words.slice(index, index + size).join(' ');
      if (phrase.length >= 10) terms.push(phrase);
    }
  }
  return uniqueStrings(terms).slice(0, 18);
}

function directTargetTermsFromPlan(plan = {}, target = {}) {
  return uniqueStrings([
    ...directTargetTermsFromText(plan?.acceptanceCriteria),
    ...directTargetTermsFromText(plan?.providerRoute),
    ...directTargetTermsFromText(plan?.evidenceClass),
    ...asArray(plan?.queryVariants).flatMap(directTargetTermsFromText),
    ...asArray(plan?.sourceProviders).flatMap(directTargetTermsFromText),
    ...asArray(plan?.requiredFacts).flatMap(directTargetTermsFromText),
    ...directTargetTermsFromText(target.query),
    ...directTargetTermsFromText(target.label),
    ...asArray(target.aliases).flatMap(directTargetTermsFromText),
  ]).slice(0, 24);
}

function providerItemTargetHit(item = {}, plan = {}, target = {}) {
  const provider = String(item.provider || item.sourceProvider || '').toLowerCase();
  if (!['sec', 'fmp', 'sec-edgar', 'fmp-transcripts'].some((name) => provider.includes(name))) return true;
  const terms = directTargetTermsFromPlan(plan, target);
  if (!terms.length) return true;
  const text = normalizeDirectTermText([item.title, item.excerpt, item.text].filter(Boolean).join(' '));
  return terms.some((term) => text.includes(normalizeDirectTermText(term)));
}

function stripHtmlToText(value, max = 120_000) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function xmlDecode(value = '') {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function xmlTag(item = '', tag = '') {
  const match = String(item || '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? xmlDecode(match[1]) : '';
}

function parseDodContractRssItems(xml = '') {
  return [...String(xml || '').matchAll(/<item\b[^>]*>[\s\S]*?<\/item>/gi)]
    .map((match) => {
      const item = match[0];
      const title = xmlTag(item, 'title');
      const link = xmlTag(item, 'link') || xmlTag(item, 'guid');
      const description = stripHtmlToText(xmlTag(item, 'description'), 1000);
      const pubDate = toIsoDate(xmlTag(item, 'pubDate'));
      return { title, link, description, pubDate };
    })
    .filter((item) => item.title && /^https:\/\/www\.war\.gov\/News\/Contracts\//i.test(item.link || ''));
}

function extractDodContractFacts(text = '') {
  const body = stripHtmlToText(text, 80_000);
  const amounts = [...body.matchAll(/\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(billion|million)?/gi)]
    .map((match) => {
      const base = Number(String(match[1] || '').replace(/,/g, ''));
      if (!Number.isFinite(base)) return null;
      const unit = String(match[2] || '').toLowerCase();
      const valueUsd = unit === 'billion' ? base * 1_000_000_000 : unit === 'million' ? base * 1_000_000 : base;
      return { raw: match[0].replace(/\s+/g, ' '), valueUsd };
    })
    .filter(Boolean);
  const largest = amounts.reduce((best, item) => (item.valueUsd > (best?.valueUsd || 0) ? item : best), null);
  return {
    amountCount: amounts.length,
    largestAwardUsd: largest?.valueUsd || null,
    largestAwardText: largest?.raw || null,
  };
}

function excerptAroundTerms(text = '', terms = [], max = 2200) {
  const body = stripHtmlToText(text);
  if (!body) return '';
  const lowered = body.toLowerCase();
  const term = uniqueStrings(terms, (value) => cleanText(value, 80).toLowerCase())
    .find((item) => item && lowered.includes(item));
  if (!term) return cleanText(body, max);
  const start = Math.max(0, lowered.indexOf(term) - Math.floor(max / 3));
  return cleanText(body.slice(start, start + max), max);
}

const PUBLIC_PLANNING_EVIDENCE_TERMS = Object.freeze([
  'interconnection queue',
  'interconnection queues',
  'interconnection study',
  'interconnection studies',
  'system impact study',
  'facilities study',
  'transmission provider',
  'transmission providers',
  'rto',
  'iso',
  'utility',
  'utilities',
  'substation',
  'queue backlog',
  'queue processing',
  'wait time',
  'wait times',
  'delay',
  'delays',
  'large load',
  'data center',
  'data centers',
  'gigawatt',
  'gigawatts',
  'megawatt',
  'megawatts',
  'mw',
  'gw',
  'load growth',
  'grid manager',
  'grid managers',
]);

const PUBLIC_PLANNING_FACT_PATTERNS = Object.freeze([
  /\b(interconnection queues?|queue backlogs?|queue processing|interconnection process)\b/i,
  /\b(interconnection stud(?:y|ies)|system impact stud(?:y|ies)|facilities stud(?:y|ies))\b/i,
  /\b(cluster stud(?:y|ies)|cluster study process|first-ready[, -]+first-served)\b/i,
  /\b(site control|commercial readiness deposit|commercial readiness|withdrawal penalties)\b/i,
  /\b(final rule|federal register|fed\. reg\.|ferc|commission)\b/i,
  /\b(transmission providers?|rto|iso|utilities|utility)\b/i,
  /\b(substation|transmission|grid)\b/i,
  /\b(wait times?|delays?|backlog|duration|timing|years?)\b/i,
  /\b([0-9][0-9,.]*\s?(?:gw|gigawatts?|mw|megawatts?))\b/i,
  /\b(data centers?|large loads?|load growth|electricity demand)\b/i,
]);

const PUBLIC_PLANNING_CLASS_TERMS = Object.freeze({
  policy_funding: [
    'final rule',
    'federal register',
    'FERC',
    'commission',
    'regulatory reform',
    'funding',
    'grant',
    'budget',
    'authorization',
    'appropriation',
  ],
  substitution_limit: [
    'site control',
    'commercial readiness deposit',
    'withdrawal penalties',
    'cluster study process',
    'first-ready first-served',
    'system impact study',
    'facilities study',
    'interconnection studies',
    'before a project can connect',
    'interconnection queue backlogs',
    'long delays',
  ],
  issuer_exposure: [
    'issuer',
    'segment',
    'customer',
    'contract',
    'backlog',
    'guidance',
    'data center',
    'grid',
    'transmission',
    'substation',
  ],
});

function countRegexMatches(text = '', pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return (String(text || '').match(new RegExp(pattern.source, flags)) || []).length;
}

function publicPlanningWindowScore(window = '', terms = []) {
  const lowered = window.toLowerCase();
  let score = 0;
  for (const term of uniqueStrings(terms, (value) => cleanText(value, 120).toLowerCase())) {
    if (term && lowered.includes(term)) score += term.split(/\s+/).length >= 2 ? 3 : 1;
  }
  for (const pattern of PUBLIC_PLANNING_FACT_PATTERNS) {
    score += countRegexMatches(window, pattern) * 4;
  }
  if (/\bskip to (main content|sub-navigation)|official websites use|main menu|view all|share sensitive information\b/i.test(window)) {
    score -= 16;
  }
  if (/\b(table|chart|reported|published|estimates?|analysis|data|queue|interconnection|transmission|utility|demand)\b/i.test(window)) {
    score += 3;
  }
  return score;
}

export function bestPublicPlanningExcerpt(text = '', terms = [], max = 1400) {
  const body = stripHtmlToText(text, 180_000);
  if (!body) return '';
  const allTerms = uniqueStrings([
    ...asArray(terms),
    ...PUBLIC_PLANNING_EVIDENCE_TERMS,
  ], (value) => cleanText(value, 120).toLowerCase()).filter(Boolean);
  const lowered = body.toLowerCase();
  const starts = new Set();
  for (const term of allTerms) {
    let index = lowered.indexOf(term);
    let guard = 0;
    while (index >= 0 && guard < 24) {
      starts.add(Math.max(0, index - Math.floor(max * 0.28)));
      index = lowered.indexOf(term, index + Math.max(1, term.length));
      guard += 1;
    }
  }
  if (!starts.size) return excerptAroundTerms(body, terms, max);
  let best = '';
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const start of starts) {
    const candidate = cleanText(body.slice(start, start + max), max);
    const score = publicPlanningWindowScore(candidate, allTerms);
    if (score > bestScore || (score === bestScore && candidate.length > best.length)) {
      best = candidate;
      bestScore = score;
    }
  }
  return best || excerptAroundTerms(body, terms, max);
}

function cleanSymbol(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9.\-]+$/.test(raw)) return '';
  const symbol = raw.replace(/[^A-Z0-9.\-]/g, '');
  return SYMBOL_PATTERN.test(symbol) ? symbol : '';
}

function symbolsFromText(value) {
  return uniqueStrings(
    String(value || '').match(/\b[A-Z][A-Z0-9.\-]{1,9}\b/g) || [],
    (token) => (SYMBOL_TEXT_STOPLIST.has(String(token || '').toUpperCase()) ? '' : cleanSymbol(token)),
  ).slice(0, 12);
}

function symbolsFromPayload(value) {
  const payload = parseJsonLike(value);
  const subject = payload.subject || {};
  const target = payload.target || {};
  return uniqueStrings([
    ...asArray(payload.symbols),
    ...asArray(payload.tickers),
    ...asArray(payload.symbol),
    ...asArray(payload.issuerUniverseSymbols),
    ...asArray(payload.issuerSymbols),
    ...asArray(payload.issuerUniverse),
    ...asArray(payload.candidateIssuerUniverse),
    ...asArray(payload.collectionUniverse),
    ...asArray(payload.promotionUniverse),
    ...asArray(subject.symbols),
    ...asArray(target.issuerUniverseSymbols),
    ...asArray(target.issuerSymbols),
    ...asArray(target.candidateIssuerUniverseSymbols),
    ...asArray(target.candidateIssuerUniverse),
    ...asArray(target.collectionUniverse),
    ...asArray(target.promotionUniverse),
    ...asArray(target.symbols),
  ], cleanSymbol);
}

function uniqueStrings(values = [], normalizer = (value) => cleanText(value)) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const normalized = normalizer(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'object') return Object.values(value);
  return String(value).split(',');
}

async function runLimited(items = [], concurrency = 1, worker = async (item) => item) {
  const list = asArray(items);
  const limit = Math.max(1, Math.min(list.length || 1, Math.floor(Number(concurrency || 1))));
  const results = new Array(list.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < list.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

function providerRouteHintText(options = {}) {
  const plans = asArray(options.providerRoutePlans);
  return cleanText([
    options.theme,
    options.themeId,
    options.label,
    options.category,
    options.parentTheme,
    ...asArray(options.themes),
    ...plans.flatMap((plan) => [
      plan?.ontologyKey,
      ...asArray(plan?.ontologyKeys),
      plan?.providerRoute,
      plan?.evidenceClass,
      ...asArray(plan?.sourceProviders),
      ...asArray(plan?.executableCollectors),
      ...asArray(plan?.queryVariants),
    ]),
  ].flat().filter(Boolean).join(' '), 5000);
}

function inferredOntologyThemeId(options = {}) {
  const explicit = slugify(options.theme || options.themeId || DEFAULT_THEME);
  const hints = providerRouteHintText(options);
  if (/defense|dod|war\.gov|usaspending|procurement|munition|missile|interceptor|aerojet|northrop|solid rocket|PAC-3|THAAD|GMLRS|PrSM|SM-6/i.test(hints)) {
    return 'defense-industrial';
  }
  if (/space|launch|satellite|propulsion|rocket lab|range slot|constellation/i.test(hints)) return 'space';
  if (/data.?center|power|grid|electric|utility|cloud|AI|accelerator/i.test(hints)) return 'cloud-infrastructure';
  return explicit;
}

function themeOntologyContext(options = {}) {
  const themeId = inferredOntologyThemeId(options);
  const themeLabel = options.label || labelFromSlug(themeId);
  return {
    themeId,
    themeLabel,
    definitions: ontologyKpiDefinitionsForTheme({
      themeId,
      themeLabel,
      category: options.category,
      parentTheme: options.parentTheme,
    }),
  };
}

function buildOntologyTranscriptTerms(options = {}) {
  const context = themeOntologyContext(options);
  const plans = asArray(options.providerRoutePlans);
  return uniqueStrings([
    options.label,
    options.theme,
    ...plans.flatMap((plan) => [
      plan?.evidenceClass,
      plan?.providerRoute,
      plan?.acceptanceCriteria,
      ...asArray(plan?.requiredFacts),
      ...asArray(plan?.sourceProviders),
      ...asArray(plan?.queryVariants),
    ]),
    ...context.definitions.flatMap((definition) => [
      definition.displayName,
      definition.definitionText,
      ...asArray(definition.sourceTypes),
      ...asArray(definition.metadata?.queryTerms),
    ]),
    'management commentary',
    'guidance',
    'demand',
    'supply',
    'capacity',
    'orders',
    'backlog',
    'capex',
    'utilization',
  ], (value) => cleanText(value, 80));
}

const WEAK_ONTOLOGY_TERMS = new Set([
  'demand',
  'supply',
  'capacity',
  'orders',
  'guidance',
  'margin',
  'deployment',
  'production',
  'budget',
  'program',
  'market',
]);

function tokenizeEvidenceText(value = '') {
  return cleanText(value, 50_000)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[-/]+/g, ' ')
    .replace(/[^a-z0-9\s/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function kpiEvidenceTerms(definition = {}) {
  return uniqueStrings([
    definition.displayName,
    definition.kpiKey,
    definition.definitionText,
    ...asArray(definition.metadata?.queryTerms),
  ], (value) => cleanText(value, 80).toLowerCase())
    .filter((term) => term.length >= 3);
}

function isStrongOntologyTerm(term = '') {
  const normalized = tokenizeEvidenceText(term);
  if (!normalized) return false;
  if (WEAK_ONTOLOGY_TERMS.has(normalized)) return false;
  return normalized.length >= 7 || /[\s/-]/.test(normalized) || ['dod', 'nato', 'hbm', 'mw'].includes(normalized);
}

export function extractOntologyKpiHitsFromText(text = '', definitions = [], options = {}) {
  const normalized = tokenizeEvidenceText(text);
  if (!normalized) return [];
  const allowedKeys = new Set(asArray(options.allowedKpiKeys).filter(Boolean));
  const out = [];
  for (const definition of asArray(definitions)) {
    if (allowedKeys.size && !allowedKeys.has(definition.kpiKey)) continue;
    if (definition.kpiKey === 'direct_management_commentary') continue;
    const terms = kpiEvidenceTerms(definition);
    const matchedTerms = terms.filter((term) => normalized.includes(tokenizeEvidenceText(term)));
    if (!matchedTerms.length) continue;
    const strongMatches = matchedTerms.filter(isStrongOntologyTerm);
    if (!strongMatches.length && matchedTerms.length < 2) continue;
    out.push({
      definition,
      matchedTerms: matchedTerms.slice(0, 8),
      confidence: Math.min(0.9, 0.62 + matchedTerms.length * 0.07),
    });
  }
  return out;
}

function parseJsonLike(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function sanitizeJsonValue(value, seen = new WeakSet()) {
  if (typeof value === 'string') return value.replace(/\u0000/g, '');
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonValue(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeJsonValue(item, seen)]));
}

function jsonParam(value) {
  return JSON.stringify(sanitizeJsonValue(value ?? {}));
}

function providerRoutePlansFromInput(input = {}) {
  const plans = [];
  const push = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) plans.push(value);
  };
  push(input.providerRoutePlan);
  if (Array.isArray(input.providerRoutePlans)) {
    for (const item of input.providerRoutePlans) push(item);
  }
  return plans;
}

function cleanNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unusableDiscoveryText(value) {
  const text = cleanText(value).toLowerCase();
  return !text
    || text === 'unknown'
    || text === 'system-quality'
    || text.startsWith('no-match-theme-')
    || text.startsWith('no match ')
    || text.startsWith('unknown ')
    || text.includes('report deep research gap (')
    || text.includes('no canonical report mutation');
}

function toIsoDate(value) {
  if (!value) return null;
  const text = String(value);
  const normalized = /^\d{4}-\d{2}$/.test(text) ? `${text}-01` : text;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function nextAttemptIso(retryAfterSec = null, fallbackMinutes = 60) {
  const seconds = Number(retryAfterSec);
  const delayMs = Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : Math.max(1, Number(fallbackMinutes || 60)) * 60 * 1000;
  return new Date(Date.now() + delayMs).toISOString();
}

function nextAttemptFromProviderResult(result = {}, createdAt = null) {
  const direct = result.nextAttemptAt || result.cooldownUntil || result.retryAt || null;
  if (direct && Number.isFinite(Date.parse(direct))) return new Date(direct).toISOString();
  const errorAttempts = asArray(result.errors)
    .map((error) => error?.nextAttemptAt || error?.cooldownUntil || null)
    .filter((value) => value && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  if (errorAttempts.length) return new Date(errorAttempts[0]).toISOString();
  const retryAfterSec = Number(result.retryAfterSec ?? asArray(result.errors)
    .map((error) => Number(error?.retryAfterSec))
    .find(Number.isFinite));
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    const base = createdAt && Number.isFinite(Date.parse(createdAt)) ? Date.parse(createdAt) : Date.now();
    return new Date(base + retryAfterSec * 1000).toISOString();
  }
  return null;
}

function providerCooldownsFromRuns(rows = [], now = new Date(), providerAllowList = []) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const allow = new Set(asArray(providerAllowList).map((provider) => String(provider || '').trim()).filter(Boolean));
  const byProvider = new Map();
  for (const row of asArray(rows)) {
    const status = String(row?.status || '').trim();
    if (!['deferred_provider', 'retry_wait'].includes(status)) continue;
    const summary = parseJsonLike(row?.summary);
    const createdAt = row?.created_at || row?.createdAt || summary?.createdAt || null;
    const results = asArray(summary?.results);
    for (const result of results) {
      const provider = String(result?.provider || result?.deferredProvider || '').trim();
      if (!provider || (allow.size && !allow.has(provider))) continue;
      const retryish = Boolean(
        result?.rateLimited
        || result?.deferred
        || result?.retryable
        || result?.cooldownUntil
        || result?.nextAttemptAt
        || asArray(result?.errors).some((error) => error?.rateLimited || error?.retryable || error?.nextAttemptAt),
      );
      if (!retryish) continue;
      const nextAttemptAt = nextAttemptFromProviderResult(result, createdAt);
      if (!nextAttemptAt || Date.parse(nextAttemptAt) <= nowMs) continue;
      const existing = byProvider.get(provider);
      if (existing && Date.parse(existing.nextAttemptAt) >= Date.parse(nextAttemptAt)) continue;
      byProvider.set(provider, {
        provider,
        nextAttemptAt,
        cooldownUntil: nextAttemptAt,
        deferredSymbols: filterIssuerSymbols(uniqueStrings([
          ...asArray(result?.deferredSymbols),
          ...asArray(result?.symbols),
          ...asArray(row?.target_symbols),
          ...asArray(row?.targetSymbols),
          ...asArray(result?.errors).map((error) => error?.symbol),
        ], cleanSymbol)),
        retryReason: result?.rateLimited ? 'provider_rate_limited' : 'provider_retry_wait',
        sourceRunId: row?.id || null,
      });
    }
  }
  return [...byProvider.values()].sort((a, b) => a.provider.localeCompare(b.provider));
}

async function loadActiveProviderCooldowns(client, target, providers = []) {
  if (!target?.targetKey || !asArray(providers).length) return [];
  const result = await queryOptional(client, `
    SELECT id, target_symbols, providers, status, summary, created_at
      FROM external_provider_backfill_runs
     WHERE (
         target_key = $1
         OR (
           target_theme = $2
           AND cardinality($3::text[]) > 0
           AND target_symbols && $3::text[]
         )
       )
       AND status IN ('deferred_provider', 'retry_wait')
       AND created_at >= NOW() - INTERVAL '7 days'
     ORDER BY created_at DESC
     LIMIT 24
  `, [target.targetKey, target.theme || null, filterIssuerSymbols(target.symbols || [])]);
  return providerCooldownsFromRuns(result.rows, new Date(), providers);
}

async function fetchText(url, timeoutMs = 12_000) {
  if (!url) return { ok: false, error: 'missing_url' };
  const host = (() => {
    try { return new URL(url).hostname; } catch { return ''; }
  })();
  const isSec = /(^|\.)sec\.gov$/i.test(host);
  const userAgents = isSec
    ? [process.env.SEC_USER_AGENT || process.env.EDGAR_USER_AGENT || process.env.LATTICE_HTTP_USER_AGENT || 'Lattice-Intelligence-Reports/0.1 (research; contact via repo)']
    : [
      process.env.LATTICE_HTTP_USER_AGENT || 'Lattice-Intelligence-Reports/0.1 (research; contact via repo)',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Lattice-Intelligence-Reports/0.1',
    ];
  let lastFailure = null;
  try {
    for (const [index, userAgent] of userAgents.entries()) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
            'User-Agent': userAgent,
          },
        });
        if (!response.ok) {
          const retryAfter = response.headers?.get?.('retry-after') || null;
          lastFailure = {
            ok: false,
            status: response.status,
            error: `HTTP ${response.status}`,
            rateLimited: response.status === 429,
            retryAfterSec: retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null,
            fallbackAttempted: index > 0,
          };
          if (!isSec && [403, 406].includes(response.status) && index < userAgents.length - 1) continue;
          if (!isSec && [403, 406].includes(response.status)) break;
          return lastFailure;
        }
        return { ok: true, status: response.status, text: await response.text(), fallbackAttempted: index > 0 };
      } catch (error) {
        lastFailure = {
          ok: false,
          status: 0,
          error: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error),
          fallbackAttempted: index > 0,
        };
        if (index < userAgents.length - 1) continue;
        return lastFailure;
      } finally {
        clearTimeout(timer);
      }
    }
    if (!isSec && [403, 406].includes(Number(lastFailure?.status))) {
      const readerUrl = publicReaderFallbackUrl(url);
      if (readerUrl) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(readerUrl, {
            signal: controller.signal,
            headers: {
              Accept: 'text/plain,text/markdown;q=0.9,*/*;q=0.8',
              'User-Agent': process.env.LATTICE_HTTP_USER_AGENT || 'Lattice-Intelligence-Reports/0.1 (research; contact via repo)',
            },
          });
          if (response.ok) {
            return {
              ok: true,
              status: response.status,
              text: await response.text(),
              fallbackAttempted: true,
              readerFallback: true,
              originalStatus: lastFailure.status,
            };
          }
        } catch (error) {
          lastFailure = {
            ok: false,
            status: 0,
            error: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error),
            fallbackAttempted: true,
            readerFallback: true,
          };
        } finally {
          clearTimeout(timer);
        }
      }
    }
    return lastFailure || { ok: false, error: 'fetch_failed' };
  } catch (error) {
    return { ok: false, status: 0, error: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error), fallbackAttempted: false };
  }
}

function publicReaderFallbackUrl(url = '') {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    return `https://r.jina.ai/http://${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return '';
  }
}

async function fetchJson(url, options = {}) {
  if (!url) return { ok: false, error: 'missing_url' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 15_000);
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': process.env.LATTICE_HTTP_USER_AGENT || 'Lattice-Intelligence-Reports/0.1 (research; contact via repo)',
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    if (!response.ok) {
      const retryAfter = response.headers?.get?.('retry-after') || null;
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}`,
        text: text.slice(0, 500),
        rateLimited: response.status === 429,
        retryable: response.status === 429 || response.status >= 500,
        retryAfterSec: retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null,
      };
    }
    try {
      return { ok: true, status: response.status, json: JSON.parse(text) };
    } catch (error) {
      return { ok: false, status: response.status, error: `invalid_json:${String(error?.message || error)}`, text: text.slice(0, 500) };
    }
  } catch (error) {
    return { ok: false, status: 0, error: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

function secArchiveBaseUrl(row = {}) {
  const accession = cleanText(row.accession || row.accession_no || row.accessionNumber || row.metadata?.accession, 40).replace(/-/g, '');
  const cik = String(row.cik || row.metadata?.cik || '').replace(/\D+/g, '').replace(/^0+/, '');
  if (cik && accession) return `https://www.sec.gov/Archives/edgar/data/${cik}/${accession}`;
  const url = String(row.primary_doc_url || row.url || '');
  const match = url.match(/^(https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\/\d+)\//i);
  return match ? match[1] : '';
}

function buildSecArchiveIndexUrl(row = {}) {
  const base = secArchiveBaseUrl(row);
  return base ? `${base}/index.json` : '';
}

function secAttachmentPriority(name = '') {
  const lower = String(name || '').toLowerCase();
  if (/ex[-_]?99\.?1|ex99\.?1|dex99\.?1|earnings|release/.test(lower)) return 100;
  if (/ex[-_]?99|ex99|dex99|presentation|investor|supplement/.test(lower)) return 80;
  if (/press|results|quarter|financial/.test(lower)) return 60;
  return 0;
}

function extractSecAttachmentCandidates(indexPayload = {}, row = {}) {
  const base = secArchiveBaseUrl(row);
  if (!base) return [];
  const primary = String(row.primary_document || '').toLowerCase();
  const items = asArray(indexPayload?.directory?.item);
  return items
    .map((item) => ({ name: cleanText(item?.name, 240), item }))
    .filter((entry) => entry.name)
    .filter((entry) => /\.(htm|html|txt)$/i.test(entry.name))
    .filter((entry) => !/(_htm\.xml|\.xsd|\.xsl|\.json|\.xml)$/i.test(entry.name))
    .filter((entry) => entry.name.toLowerCase() !== primary)
    .map((entry) => ({
      name: entry.name,
      url: `${base}/${entry.name}`,
      priority: secAttachmentPriority(entry.name),
      sourceType: /earnings|release|ex[-_]?99\.?1|ex99\.?1|dex99\.?1/i.test(entry.name)
        ? 'sec_earnings_release_exhibit'
        : 'sec_investor_presentation_exhibit',
      metadata: { secAttachment: entry.item },
    }))
    .filter((entry) => entry.priority > 0)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))
    .slice(0, 5);
}

function isoDateDaysAgo(days = 365) {
  const date = new Date(Date.now() - Math.max(1, Number(days || 365)) * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function buildUsaSpendingAwardSearchPayload({
  recipientName,
  startDate = isoDateDaysAgo(365),
  endDate = new Date().toISOString().slice(0, 10),
  limit = 10,
} = {}) {
  return {
    subawards: false,
    limit: Math.max(1, Math.min(100, Number(limit || 10))),
    page: 1,
    sort: 'Award Amount',
    order: 'desc',
    filters: {
      award_type_codes: ['A', 'B', 'C', 'D'],
      recipient_search_text: [cleanText(recipientName, 160)].filter(Boolean),
      agencies: [{ type: 'awarding', tier: 'toptier', name: 'Department of Defense' }],
      time_period: [{ start_date: startDate, end_date: endDate }],
      award_amounts: [{ lower_bound: 1_000_000 }],
    },
    fields: [
      'Award ID',
      'Recipient Name',
      'Recipient UEI',
      'Start Date',
      'End Date',
      'Award Amount',
      'Awarding Agency',
      'Awarding Sub Agency',
      'Funding Agency',
      'Funding Sub Agency',
      'Contract Award Type',
      'Description',
      'NAICS',
      'PSC',
    ],
  };
}

function extractUsaSpendingAwardFacts(payload = {}, context = {}) {
  return asArray(payload.results).map((row) => {
    const amountUsd = cleanNumber(row['Award Amount'] ?? row.award_amount ?? row.amount);
    const awardId = cleanText(row['Award ID'] || row.award_id || row.generated_internal_id || row.internal_id, 180);
    const recipient = cleanText(row['Recipient Name'] || row.recipient_name || context.recipientName, 180);
    const description = cleanText(row.Description || row.description || row['Award Description'], 1200);
    const agency = cleanText(row['Awarding Agency'] || row.awarding_agency || '', 160);
    const subagency = cleanText(row['Awarding Sub Agency'] || row.awarding_sub_agency || '', 160);
    const startDate = toIsoDate(row['Start Date'] || row.start_date);
    const generatedId = cleanText(row.generated_internal_id || row.internal_id || '', 220);
    const evidenceRef = generatedId
      ? `https://www.usaspending.gov/award/${encodeURIComponent(generatedId)}`
      : 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
    return {
      symbol: context.symbol || null,
      recipientName: recipient,
      awardId,
      generatedId,
      amountUsd,
      startDate,
      evidenceRef,
      kpiKey: 'defense_contract_awards',
      text: [
        awardId,
        recipient,
        description,
        agency,
        subagency,
        row.NAICS,
        row.PSC,
        'contract award procurement missile munitions shipyard defense production',
      ].map(cleanText).filter(Boolean).join(' '),
      raw: row,
    };
  }).filter((award) => award.awardId || award.amountUsd !== null || award.text);
}

async function upsertKpiDefinition(client, {
  kpiKey,
  displayName,
  dataPack,
  unit,
  sourceTypes,
  freshnessSlaHours,
  definitionText,
}) {
  await client.query(`
    INSERT INTO kpi_definition_registry (
      kpi_key, display_name, data_pack, unit, leading_or_lagging, source_types,
      freshness_sla_hours, definition_text, metadata, updated_at
    )
    VALUES ($1, $2, $3, $4, 'lagging', $5::jsonb, $6, $7, $8::jsonb, NOW())
    ON CONFLICT (kpi_key) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      data_pack = EXCLUDED.data_pack,
      unit = EXCLUDED.unit,
      source_types = EXCLUDED.source_types,
      freshness_sla_hours = EXCLUDED.freshness_sla_hours,
      definition_text = EXCLUDED.definition_text,
      metadata = kpi_definition_registry.metadata || EXCLUDED.metadata,
      updated_at = NOW()
  `, [
    kpiKey,
    displayName,
    dataPack,
    unit,
    jsonParam(sourceTypes || []),
    freshnessSlaHours,
    definitionText,
    jsonParam({ createdBy: 'collect-free-external-data' }),
  ]);
}

async function upsertThemeKpiMap(client, { themeId, themeLabel, kpiKey, priority, confidence, rationale }) {
  await client.query(`
    INSERT INTO theme_kpi_map (
      theme_id, theme_label, kpi_key, status, priority, confidence, rationale,
      metadata, updated_at
    )
    VALUES ($1, $2, $3, 'active', $4, $5, $6, $7::jsonb, NOW())
    ON CONFLICT (theme_id, kpi_key) DO UPDATE SET
      theme_label = EXCLUDED.theme_label,
      status = 'active',
      priority = GREATEST(theme_kpi_map.priority, EXCLUDED.priority),
      confidence = GREATEST(theme_kpi_map.confidence, EXCLUDED.confidence),
      rationale = COALESCE(theme_kpi_map.rationale, EXCLUDED.rationale),
      metadata = theme_kpi_map.metadata || EXCLUDED.metadata,
      updated_at = NOW()
  `, [
    themeId,
    themeLabel,
    kpiKey,
    priority,
    confidence,
    rationale,
    jsonParam({ source: 'free-external-data', reviewBoundary: 'provider fact, not canonical claim' }),
  ]);
}

async function insertObservation(client, obs) {
  if (!obs || obs.valueNum === null || obs.valueNum === undefined) return false;
  const observedAt = toIsoDate(obs.observedAt) || new Date().toISOString();
  const dedupeKey = [
    obs.themeId,
    obs.kpiKey,
    obs.sourceType,
    obs.sourceId,
    observedAt.slice(0, 10),
  ].join('::');
  const result = await client.query(`
    INSERT INTO industry_kpi_observations (
      theme, kpi_name, value_num, unit, geography, observed_at, source_type,
      evidence_ref, metadata, kpi_key, entity_id, period_start, period_end,
      source_id, confidence, freshness_status, dedupe_key
    )
    SELECT $1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9::jsonb, $10,
           $11, $12::timestamptz, $13::timestamptz, $14, $15, 'fresh', $16
    WHERE NOT EXISTS (
      SELECT 1 FROM industry_kpi_observations WHERE dedupe_key = $16
    )
    RETURNING id
  `, [
    obs.themeId,
    obs.kpiName,
    obs.valueNum,
    obs.unit || 'value',
    obs.geography || null,
    observedAt,
    obs.sourceType,
    obs.evidenceRef,
    jsonParam(obs.metadata || {}),
    obs.kpiKey,
    obs.entityId || null,
    obs.periodStart ? toIsoDate(obs.periodStart) : observedAt,
    obs.periodEnd ? toIsoDate(obs.periodEnd) : observedAt,
    obs.sourceId,
    obs.confidence ?? 0.8,
    dedupeKey,
  ]);
  return result.rows.length > 0;
}

async function insertOntologyKpiEvidenceHits(client, {
  options,
  symbol,
  text,
  evidenceRef,
  sourceType,
  sourceId,
  observedAt,
  provider,
  metadata = {},
  definitions,
}) {
  const { themeId, themeLabel, definitions: defaultDefinitions } = themeOntologyContext(options);
  const hits = extractOntologyKpiHitsFromText(text, definitions || defaultDefinitions);
  let inserted = 0;
  for (const hit of hits) {
    const definition = hit.definition;
    await upsertKpiDefinition(client, {
      kpiKey: definition.kpiKey,
      displayName: definition.displayName,
      dataPack: definition.dataPack,
      unit: definition.unit || 'evidence_hit',
      sourceTypes: definition.sourceTypes,
      freshnessSlaHours: definition.freshnessSlaHours,
      definitionText: definition.definitionText,
    });
    await upsertThemeKpiMap(client, {
      themeId,
      themeLabel,
      kpiKey: definition.kpiKey,
      priority: definition.priority,
      confidence: Math.max(0.68, hit.confidence),
      rationale: `Provider text matched ontology terms for ${definition.displayName}.`,
    });
    if (await insertObservation(client, {
      themeId,
      kpiKey: definition.kpiKey,
      kpiName: definition.displayName,
      valueNum: 1,
      unit: 'evidence_hit',
      observedAt: observedAt || new Date().toISOString(),
      sourceType,
      sourceId: sourceId || `${provider}:${symbol}:${definition.kpiKey}:${slugify(evidenceRef || '')}`,
      evidenceRef,
      entityId: symbol || null,
      confidence: hit.confidence,
      metadata: {
        provider,
        symbol,
        ontologyKey: definition.metadata?.ontologyKey,
        ontologyVersion: definition.metadata?.ontologyVersion,
        kpiKey: definition.kpiKey,
        matchedTerms: hit.matchedTerms,
        evidenceBoundary: 'textual ontology evidence hit; value_num=1 means presence, not a measured numeric KPI',
        excerpt: excerptAroundTerms(text, hit.matchedTerms, 1000),
        ...metadata,
      },
    })) inserted += 1;
  }
  return { inserted, hits };
}

async function insertOntologyFundamentalObservation(client, {
  options,
  symbol,
  metricName,
  valueNum,
  periodEnd,
  evidenceRef,
  sourceId,
  metadata = {},
  definitions,
}) {
  const value = cleanNumber(valueNum);
  if (value === null) return false;
  const { themeId, themeLabel, definitions: defaultDefinitions } = themeOntologyContext(options);
  const metricText = tokenizeEvidenceText(metricName);
  const candidates = (definitions || defaultDefinitions).filter((definition) => {
    const keyText = tokenizeEvidenceText(definition.kpiKey);
    const queryText = tokenizeEvidenceText(asArray(definition.metadata?.queryTerms).join(' '));
    if (/capital expenditure|capex/.test(metricText)) return /capex|capital expenditure|capital/.test(`${keyText} ${queryText}`);
    return false;
  });
  let inserted = false;
  for (const definition of candidates) {
    await upsertKpiDefinition(client, {
      kpiKey: definition.kpiKey,
      displayName: definition.displayName,
      dataPack: definition.dataPack,
      unit: 'USD',
      sourceTypes: definition.sourceTypes,
      freshnessSlaHours: definition.freshnessSlaHours,
      definitionText: definition.definitionText,
    });
    await upsertThemeKpiMap(client, {
      themeId,
      themeLabel,
      kpiKey: definition.kpiKey,
      priority: definition.priority,
      confidence: 0.78,
      rationale: `${metricName} from provider fundamentals maps to ${definition.displayName}.`,
    });
    if (await insertObservation(client, {
      themeId,
      kpiKey: definition.kpiKey,
      kpiName: definition.displayName,
      valueNum: Math.abs(value),
      unit: 'USD',
      observedAt: periodEnd || new Date().toISOString(),
      sourceType: 'fmp_fundamental_ontology_metric',
      sourceId: sourceId || `fmp:${symbol}:${definition.kpiKey}:${periodEnd || 'latest'}`,
      evidenceRef,
      entityId: symbol || null,
      confidence: 0.78,
      metadata: {
        provider: 'fmp',
        symbol,
        sourceMetricName: metricName,
        rawValue: value,
        normalizedValue: Math.abs(value),
        ontologyKey: definition.metadata?.ontologyKey,
        ontologyVersion: definition.metadata?.ontologyVersion,
        evidenceBoundary: 'provider fundamentals mapped to ontology KPI; not analyst-written thesis evidence',
        ...metadata,
      },
    })) inserted = true;
  }
  return inserted;
}

async function loadThemeSymbols(client, themeId, fallback = [], options = {}) {
  const explicit = filterIssuerSymbols(fallback);
  if (explicit.length) return explicit;
  if (options.strictEndogenous) return [];
  const key = slugify(themeId || options.theme || options.label);
  const label = cleanText(options.label || labelFromSlug(key || themeId), 160);
  const rows = await client.query(`
    SELECT symbol
      FROM (
        SELECT symbol, MAX(COALESCE(score, relevance_score, confidence, 0)) AS rank_score
          FROM theme_symbol_mappings
         WHERE theme = $1 OR theme_key = $1 OR canonical_theme = $1
         GROUP BY symbol
        UNION ALL
        SELECT symbol, MAX(COALESCE(sensitivity_score, abs(avg_return_pct), 0)) AS rank_score
          FROM stock_sensitivity_matrix
         WHERE theme = $1 OR theme_key = $1 OR canonical_theme = $1
         GROUP BY symbol
      ) ranked
     WHERE symbol IS NOT NULL
     GROUP BY symbol
     ORDER BY MAX(rank_score) DESC NULLS LAST, symbol
     LIMIT 8
  `, [key || themeId]).catch(() => ({ rows: [] }));
  const exposureRows = await queryOptional(client, `
    SELECT entity_key AS symbol, confidence AS rank_score
      FROM theme_entity_exposure
     WHERE theme = ANY($1::text[])
       AND entity_type IN ('company', 'equity', 'ticker')
     ORDER BY confidence DESC NULLS LAST, updated_at DESC NULLS LAST
     LIMIT 12
  `, [[key, themeId].filter(Boolean)]);
  const regimeRows = await queryOptional(client, `
    SELECT symbol, MAX(sample_size) AS rank_score
      FROM regime_conditional_impact
     WHERE theme = ANY($1::text[])
     GROUP BY symbol
     ORDER BY MAX(sample_size) DESC NULLS LAST
     LIMIT 12
  `, [[key, themeId].filter(Boolean)]);
  const targetRows = await queryOptional(client, `
    SELECT symbols
      FROM tracked_targets
     WHERE status = 'active'
       AND (
         normalized_key = ANY($1::text[])
         OR LOWER(label) = LOWER($2)
         OR EXISTS (SELECT 1 FROM unnest(aliases) AS alias WHERE LOWER(alias) = LOWER($2))
       )
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 8
  `, [[key, themeId].filter(Boolean), label]);
  const reportTaskRows = await queryOptional(client, `
    SELECT metadata
      FROM report_backfill_tasks
     WHERE subject_key = ANY($1::text[])
        OR LOWER(COALESCE(metadata->'subject'->>'displayName', metadata->'subject'->>'subjectId', '')) = LOWER($2)
     ORDER BY COALESCE(updated_at, created_at, NOW()) DESC
     LIMIT 20
  `, [[key, themeId].filter(Boolean), label]);
  const approvalRows = await queryOptional(client, `
    SELECT payload
      FROM approval_queue
     WHERE payload ? 'query'
       AND (
         payload->>'subjectKey' = ANY($1::text[])
         OR payload->'subject'->>'subjectId' = ANY($1::text[])
         OR LOWER(COALESCE(payload->'subject'->>'displayName', payload->>'label', payload->>'name', '')) = LOWER($2)
       )
     ORDER BY COALESCE(reviewed_at, created_at, NOW()) DESC
     LIMIT 20
  `, [[key, themeId].filter(Boolean), label]);
  const previousRuns = await queryOptional(client, `
    SELECT target_symbols
      FROM external_provider_backfill_runs
     WHERE target_theme = ANY($1::text[])
        OR LOWER(target_label) = LOWER($2)
     ORDER BY created_at DESC
     LIMIT 8
  `, [[key, themeId].filter(Boolean), label]);
  const symbols = filterIssuerSymbols(uniqueStrings([
    ...rows.rows.map((row) => row.symbol),
    ...exposureRows.rows.map((row) => row.symbol),
    ...regimeRows.rows.map((row) => row.symbol),
    ...targetRows.rows.flatMap((row) => asArray(row.symbols)),
    ...reportTaskRows.rows.flatMap((row) => symbolsFromPayload(row.metadata)),
    ...approvalRows.rows.flatMap((row) => symbolsFromPayload(row.payload)),
    ...previousRuns.rows.flatMap((row) => asArray(row.target_symbols)),
  ], cleanSymbol));
  if (symbols.length) return symbols;
  if (key === 'cloud-infrastructure') return filterIssuerSymbols(['MSFT', 'AMZN', 'GOOGL', 'ORCL', 'IBM']);
  return [];
}

async function ensureExternalProviderBackfillSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS external_provider_backfill_runs (
      id BIGSERIAL PRIMARY KEY,
      target_key TEXT NOT NULL,
      target_theme TEXT,
      target_label TEXT,
      target_symbols TEXT[] NOT NULL DEFAULT '{}'::text[],
      providers TEXT[] NOT NULL DEFAULT '{}'::text[],
      discovered_from JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'ok',
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_external_provider_backfill_runs_target_time
      ON external_provider_backfill_runs (target_key, created_at DESC)
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS transcript_evidence (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT,
      speaker TEXT,
      transcript_at TIMESTAMPTZ,
      topic TEXT,
      excerpt TEXT NOT NULL,
      evidence_ref TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_transcript_evidence_symbol_time
      ON transcript_evidence (symbol, transcript_at DESC)
  `);
}

async function queryOptional(client, sql, params = []) {
  try {
    return await client.query(sql, params);
  } catch {
    return { rows: [] };
  }
}

function normalizeBackfillTarget(input = {}) {
  const providerRoutePlans = providerRoutePlansFromInput(input);
  const routeScoped = Boolean(
    input.providerRoutePlan ||
    input.providerRoutePlans ||
    input.desiredEvidenceClass ||
    input.evidenceClass,
  );
  const explicitSymbols = uniqueStrings(asArray(input.symbols || input.symbol || input.tickers || input.ticker), cleanSymbol);
  const rawLabel = cleanText(input.label || input.name || input.supplier || input.connector || input.query || input.theme || input.themeId || input.normalizedKey || explicitSymbols[0]);
  const symbols = filterIssuerSymbols(uniqueStrings([
    ...explicitSymbols,
    ...(routeScoped ? [] : symbolsFromText(input.query)),
    ...(routeScoped ? [] : symbolsFromText(rawLabel)),
  ], cleanSymbol));
  const theme = slugify(input.theme || input.themeId || input.theme_id || input.normalizedKey || input.normalized_key || rawLabel || symbols[0]);
  const label = rawLabel || labelFromSlug(theme) || symbols[0];
  const aliases = uniqueStrings([
    label,
    input.query,
    input.reason,
    input.supplier,
    input.connector,
    ...asArray(input.aliases),
  ]).filter((alias) => !unusableDiscoveryText(alias)).slice(0, 12);
  if (!theme && !symbols.length) return null;
  if (unusableDiscoveryText(theme) && !symbols.length) return null;
  const targetKeySymbols = [...symbols].sort((a, b) => a.localeCompare(b));
  const targetKey = [
    theme || 'symbol-only',
    targetKeySymbols.length ? targetKeySymbols.join(',') : '',
  ].join('::');
  const desiredEvidenceClasses = uniqueStrings([
    input.desiredEvidenceClass,
    input.evidenceClass,
    ...providerRoutePlans.map((plan) => plan.evidenceClass),
  ], slugify);
  const reportIds = uniqueStrings([
    ...asArray(input.reportIds),
    input.reportId,
    input.report_id,
    input.latestReportId,
    input.latest_report_id,
  ]);
  const adjacentCandidateKey = cleanText(
    input.adjacentCandidateKey
    || input.adjacent_candidate_key
    || input.metadata?.adjacentCandidateKey
    || input.metadata?.adjacent_candidate_key
    || input.subject?.metadata?.discovery?.adjacentCandidateKey
    || providerRoutePlans.find((plan) => plan?.metadata?.adjacentCandidateKey)?.metadata?.adjacentCandidateKey
    || '',
    180,
  );
  const adjacentLane = cleanText(
    input.adjacentLane
    || input.adjacent_lane
    || input.metadata?.adjacentLane
    || input.metadata?.adjacent_lane
    || input.subject?.metadata?.discovery?.adjacentLane
    || providerRoutePlans.find((plan) => plan?.metadata?.adjacentLane)?.metadata?.adjacentLane
    || '',
    180,
  );
  const strictEndogenous = Boolean(
    input.strictEndogenous
    || input.strict_endogenous
    || input.metadata?.strictEndogenous
    || input.metadata?.strict_endogenous
    || input.metadata?.discoveryNamespace === 'strict_endogenous_adjacent'
    || input.metadata?.frontierDiscovery === true
    || input.subject?.metadata?.strictEndogenous
    || providerRoutePlans.some((plan) => plan?.strictEndogenous || plan?.discoveryNamespace === 'strict_endogenous_adjacent'),
  );
  return {
    theme: theme || `symbol-${symbols[0]}`,
    label: label || labelFromSlug(theme),
    symbols,
    strictEndogenous,
    aliases,
    providerRoutePlans,
    desiredEvidenceClasses,
    targetKey,
    reportId: reportIds[0] || null,
    latestReportId: input.latestReportId || input.latest_report_id || null,
    reportIds,
    adjacentCandidateKey,
    adjacentLane,
    sources: uniqueStrings(asArray(input.sources || input.source || input.discoveredFrom || input.discovered_from)),
    priority: cleanText(input.priority || 'normal', 32),
    sourceRowIds: uniqueStrings(asArray(input.sourceRowIds || input.source_row_ids)),
    trackingTargetIds: uniqueStrings(asArray(input.trackingTargetIds || input.tracking_target_ids)),
  };
}

function mergeBackfillTargets(targets = []) {
  const map = new Map();
  for (const rawTarget of targets) {
    const target = normalizeBackfillTarget(rawTarget);
    if (!target) continue;
    const existing = map.get(target.targetKey);
    if (!existing) {
      map.set(target.targetKey, target);
      continue;
    }
    existing.symbols = uniqueStrings([...existing.symbols, ...target.symbols], cleanSymbol);
    existing.aliases = uniqueStrings([...existing.aliases, ...target.aliases]);
    existing.sources = uniqueStrings([...existing.sources, ...target.sources]);
    existing.providerRoutePlans = [
      ...(existing.providerRoutePlans || []),
      ...(target.providerRoutePlans || []),
    ];
    existing.desiredEvidenceClasses = uniqueStrings([
      ...(existing.desiredEvidenceClasses || []),
      ...(target.desiredEvidenceClasses || []),
    ], slugify);
    existing.sourceRowIds = uniqueStrings([...existing.sourceRowIds, ...target.sourceRowIds]);
    existing.trackingTargetIds = uniqueStrings([...existing.trackingTargetIds, ...target.trackingTargetIds]);
    existing.strictEndogenous = Boolean(existing.strictEndogenous || target.strictEndogenous);
    existing.reportIds = uniqueStrings([...asArray(existing.reportIds), ...asArray(target.reportIds), target.reportId, target.latestReportId]);
    existing.reportId = existing.reportId || target.reportId || null;
    existing.latestReportId = existing.latestReportId || target.latestReportId || null;
    existing.adjacentCandidateKey = existing.adjacentCandidateKey || target.adjacentCandidateKey || '';
    existing.adjacentLane = existing.adjacentLane || target.adjacentLane || '';
  }
  return collapseDuplicateCollectionUniverseTargets([...map.values()]);
}

function mergeTargetInto(base, target) {
  base.symbols = uniqueStrings([...asArray(base.symbols), ...asArray(target.symbols)], cleanSymbol);
  base.aliases = uniqueStrings([...asArray(base.aliases), ...asArray(target.aliases)]);
  base.sources = uniqueStrings([...asArray(base.sources), ...asArray(target.sources)]);
  base.providerRoutePlans = [
    ...asArray(base.providerRoutePlans),
    ...asArray(target.providerRoutePlans),
  ];
  base.desiredEvidenceClasses = uniqueStrings([
    ...asArray(base.desiredEvidenceClasses),
    ...asArray(target.desiredEvidenceClasses),
  ], slugify);
  base.sourceRowIds = uniqueStrings([...asArray(base.sourceRowIds), ...asArray(target.sourceRowIds)]);
  base.trackingTargetIds = uniqueStrings([...asArray(base.trackingTargetIds), ...asArray(target.trackingTargetIds)]);
  base.strictEndogenous = Boolean(base.strictEndogenous || target.strictEndogenous);
  base.reportIds = uniqueStrings([
    ...asArray(base.reportIds),
    ...asArray(target.reportIds),
    base.reportId,
    base.latestReportId,
    target.reportId,
    target.latestReportId,
  ]);
  base.reportId = base.reportId || target.reportId || null;
  base.latestReportId = base.latestReportId || target.latestReportId || null;
  base.adjacentCandidateKey = base.adjacentCandidateKey || target.adjacentCandidateKey || '';
  base.adjacentLane = base.adjacentLane || target.adjacentLane || '';
  return base;
}

function targetCollectionUniverseKey(target = {}) {
  const symbols = uniqueStrings(target.symbols || [], cleanSymbol).sort((a, b) => a.localeCompare(b));
  if (!symbols.length) return '';
  if (!asArray(target.providerRoutePlans).length && !target.reportId && !asArray(target.reportIds).length) return '';
  return symbols.join(',');
}

function targetScopeRank(target = {}) {
  return [
    target.strictEndogenous ? 16 : 0,
    target.reportId ? 8 : 0,
    asArray(target.reportIds).length ? 4 : 0,
    asArray(target.providerRoutePlans).length ? 2 : 0,
    String(target.targetKey || '').length > String(target.theme || '').length + 2 ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0);
}

function collapseDuplicateCollectionUniverseTargets(targets = []) {
  const groups = new Map();
  const passthrough = [];
  for (const target of targets) {
    const key = targetCollectionUniverseKey(target);
    if (!key) {
      passthrough.push(target);
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(target);
  }
  const collapsed = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      collapsed.push(group[0]);
      continue;
    }
    const [primary, ...rest] = [...group].sort((a, b) => targetScopeRank(b) - targetScopeRank(a));
    const merged = { ...primary };
    for (const target of rest) mergeTargetInto(merged, target);
    collapsed.push(merged);
  }
  return [...passthrough, ...collapsed];
}

function extractTargetsFromApprovalRows(rows = []) {
  const targets = [];
  for (const row of rows) {
    const payload = parseJsonLike(row.payload);
    const themes = uniqueStrings(asArray(payload.themes || payload.theme || payload.targetTheme || payload.canonicalTheme), slugify);
    const subjectLabel = payload.subject?.displayName || payload.subject?.subjectId || payload.subject?.metadata?.theme;
    const label = payload.supplier || payload.connector || payload.label || payload.name || subjectLabel || payload.query || row.action_type;
    const symbols = filterIssuerSymbols(symbolsFromPayload(payload));
    const aliases = uniqueStrings([payload.query, payload.reason, payload.supplier, payload.connector, row.reasoning]);
    const source = cleanText(payload.source || payload.createdBy || '');
    const subjectKey = slugify(payload.subjectKey || payload.subject?.subjectId || payload.subject?.displayName || '');
    const providerRoutePlan = payload.providerRoutePlan || (payload.desiredEvidenceClass || payload.evidenceClass
      ? routeEvidenceProvider({
        evidenceClass: payload.desiredEvidenceClass || payload.evidenceClass,
        query: payload.query,
        subject: payload.subject?.displayName || payload.subject?.subjectId || label,
        target: payload.target || payload.connector || payload.supplier || label,
        themes,
        issuerUniverse: symbols,
      })
      : null);
    if (
      (source === 'report-deep-research-pack' || payload.reportBackfillTaskId)
      && (!subjectKey || subjectKey === 'unknown' || unusableDiscoveryText(payload.query) || unusableDiscoveryText(label))
    ) {
      continue;
    }
    if (themes.length) {
      for (const theme of themes) {
        if (unusableDiscoveryText(theme) || unusableDiscoveryText(label)) continue;
        targets.push({
          theme,
          label: label || labelFromSlug(theme),
          query: payload.query,
          symbols,
          aliases,
          providerRoutePlan,
          desiredEvidenceClass: payload.desiredEvidenceClass || payload.evidenceClass || null,
          discoveredFrom: ['approval_queue', row.action_type],
          sourceRowIds: [row.id],
        });
      }
    } else if (label || symbols.length) {
      if (unusableDiscoveryText(label) && !symbols.length) continue;
      targets.push({
        theme: payload.normalizedKey || payload.normalized_key || label || symbols[0],
        label,
        query: payload.query,
        symbols,
        aliases,
        providerRoutePlan,
        desiredEvidenceClass: payload.desiredEvidenceClass || payload.evidenceClass || null,
        discoveredFrom: ['approval_queue', row.action_type],
        sourceRowIds: [row.id],
      });
    }
  }
  return targets;
}

function extractBackfillTargetsFromRows({
  trackedTargets = [],
  approvals = [],
  themeKpis = [],
  dataJobs = [],
  reportBackfills = [],
  sourceRows = [],
} = {}) {
  const targets = [];
  for (const row of trackedTargets) {
    targets.push({
      theme: row.normalized_key || row.label,
      label: row.label,
      symbols: row.symbols,
      aliases: row.aliases,
      priority: row.priority,
      discoveredFrom: ['tracked_targets', row.target_type],
      trackingTargetIds: [row.id],
    });
  }
  targets.push(...extractTargetsFromApprovalRows(approvals));
  for (const row of themeKpis) {
    targets.push({
      theme: row.theme_id,
      label: row.theme_label || labelFromSlug(row.theme_id),
      discoveredFrom: ['theme_kpi_map', row.kpi_key],
    });
  }
  for (const row of dataJobs) {
    targets.push({
      theme: row.theme_id || row.subject_key || row.query,
      label: row.theme_label || row.subject_label || row.query || row.theme_id,
      aliases: [row.query, row.kpi_key],
      discoveredFrom: ['data_collection_jobs', row.source_type || row.status],
    });
  }
  for (const row of reportBackfills) {
    if (unusableDiscoveryText(row.subject_key) || unusableDiscoveryText(row.query)) continue;
    const metadataSymbols = filterIssuerSymbols(symbolsFromPayload(row.metadata));
    const providerRoutePlan = row.metadata?.providerRoutePlan || (row.metadata?.desiredEvidenceClass || row.metadata?.evidenceClass
      ? routeEvidenceProvider({
        evidenceClass: row.metadata.desiredEvidenceClass || row.metadata.evidenceClass,
        providerRoute: row.metadata.providerRoute || row.metadata.target?.providerRoute || row.metadata.evidenceContract?.providerRoute,
        query: row.query,
        subject: row.metadata.subject?.displayName || row.metadata.subject?.subjectId || row.subject_label || row.subject_key,
        target: row.metadata.target?.label || row.metadata.target?.displayName || row.subject_label || row.query,
        themes: [
          row.subject_key,
          ...asArray(row.metadata.themes),
          ...asArray(row.metadata.candidateThemes),
          ...asArray(row.metadata.subject?.metadata?.themes),
        ],
        ontologyKey: row.metadata.evidenceContract?.ontologyKey || row.metadata.ontologyKey,
        ontologyKeys: row.metadata.evidenceContract?.ontologyKeys,
        issuerUniverse: metadataSymbols,
        metadata: row.metadata,
      })
      : null);
    targets.push({
      theme: row.subject_key || row.query,
      label: row.subject_label || row.query || row.subject_key,
      query: row.query,
      symbols: metadataSymbols,
        aliases: [row.query, row.data_pack],
        providerRoutePlan,
        desiredEvidenceClass: row.metadata?.desiredEvidenceClass || row.metadata?.evidenceClass || null,
        reportId: row.report_id || row.metadata?.reportId || null,
        latestReportId: row.metadata?.latestReportId || null,
        adjacentCandidateKey: row.metadata?.adjacentCandidateKey || row.metadata?.subject?.metadata?.discovery?.adjacentCandidateKey || null,
        adjacentLane: row.metadata?.adjacentLane || row.metadata?.subject?.metadata?.discovery?.adjacentLane || null,
        strictEndogenous: Boolean(
          row.metadata?.strictEndogenous
          || row.metadata?.strict_endogenous
          || row.metadata?.subject?.metadata?.strictEndogenous
          || row.metadata?.subject?.metadata?.discoveryNamespace === 'strict_endogenous_adjacent'
          || row.metadata?.adjacentCandidate?.metadata?.discoveryNamespace === 'strict_endogenous_adjacent'
          || row.metadata?.adjacentCandidate?.metadata?.frontierDiscovery === true
          || row.metadata?.frontierDiscovery === true
        ),
        discoveredFrom: ['report_backfill_tasks', row.data_pack || row.status],
      });
  }
  for (const row of sourceRows) {
    targets.push({
      theme: row.theme || row.canonical_theme || row.name,
      label: row.theme || row.name,
      aliases: [row.name, row.url],
      discoveredFrom: ['source_registry', row.status],
    });
  }
  return mergeBackfillTargets(targets);
}

async function discoverProviderBackfillTargets(client, options = {}) {
  const sinceHours = Math.max(1, Math.floor(Number(options.sinceHours || 24 * 14)));
  const limit = Math.max(1, Math.min(500, Math.floor(Number(options.limit || 50))));
  const reportId = String(options.reportId || '').trim() || null;
  const reportScoped = Boolean(reportId);
  const trackedTargets = reportScoped ? { rows: [] } : await queryOptional(client, `
    SELECT id, label, target_type, normalized_key, aliases, symbols, priority, status, updated_at, created_at
      FROM tracked_targets
     WHERE status = 'active'
       AND updated_at >= NOW() - make_interval(hours => $1::int)
     ORDER BY updated_at DESC
     LIMIT $2
  `, [sinceHours, limit]);
  const approvals = await queryOptional(client, `
    SELECT id, action_type, payload, status, reasoning, created_at, reviewed_at
      FROM approval_queue
     WHERE created_at >= NOW() - make_interval(hours => $1::int)
       AND (
         $3::text IS NULL
         OR payload->>'reportId' = $3::text
         OR payload->>'latestReportId' = $3::text
       )
       AND (
         action_type IN ('source-query', 'add-rss', 'add-rss-untrusted', 'backfill-source')
         OR payload ? 'query'
         OR payload ? 'theme'
         OR payload ? 'themes'
         OR payload ? 'supplier'
         OR payload ? 'connector'
         OR payload ? 'symbols'
       )
     ORDER BY created_at DESC
     LIMIT $2
  `, [sinceHours, limit, reportId]);
  const themeKpis = reportScoped ? { rows: [] } : await queryOptional(client, `
    SELECT theme_id, theme_label, kpi_key, status, updated_at
      FROM theme_kpi_map
     WHERE status = 'active'
       AND updated_at >= NOW() - make_interval(hours => $1::int)
     ORDER BY updated_at DESC
     LIMIT $2
  `, [sinceHours, limit]);
  const dataJobs = reportScoped ? { rows: [] } : await queryOptional(client, `
    SELECT theme_id, theme_label, query, kpi_key, source_type, status, updated_at, created_at
      FROM data_collection_jobs
     WHERE COALESCE(updated_at, created_at, NOW()) >= NOW() - make_interval(hours => $1::int)
     ORDER BY COALESCE(updated_at, created_at, NOW()) DESC
     LIMIT $2
  `, [sinceHours, limit]);
  const reportBackfills = await queryOptional(client, `
    SELECT report_id,
           NULL::text AS subject_type,
           subject_key,
           COALESCE(metadata->'subject'->>'displayName', metadata->'subject'->>'subjectId', subject_key) AS subject_label,
           pack_name AS data_pack,
           query,
           status,
           metadata,
           updated_at,
           created_at
      FROM report_backfill_tasks
     WHERE COALESCE(updated_at, created_at, NOW()) >= NOW() - make_interval(hours => $1::int)
       AND status NOT IN ('superseded', 'complete', 'rejected', 'cancelled')
       AND (
         $3::text IS NULL
         OR report_id = $3::text
         OR metadata->>'reportId' = $3::text
         OR metadata->>'latestReportId' = $3::text
       )
     ORDER BY COALESCE(updated_at, created_at, NOW()) DESC
     LIMIT $2
  `, [sinceHours, limit, reportId]);
  const sourceRows = reportScoped ? { rows: [] } : await queryOptional(client, `
    SELECT name, url, theme, canonical_theme, status, updated_at, created_at
      FROM source_registry
     WHERE COALESCE(updated_at, created_at, NOW()) >= NOW() - make_interval(hours => $1::int)
       AND status IN ('active', 'approved')
     ORDER BY COALESCE(updated_at, created_at, NOW()) DESC
     LIMIT $2
  `, [sinceHours, limit]);
  const discovered = extractBackfillTargetsFromRows({
    trackedTargets: trackedTargets.rows,
    approvals: approvals.rows,
    themeKpis: themeKpis.rows,
    dataJobs: dataJobs.rows,
    reportBackfills: reportBackfills.rows,
    sourceRows: sourceRows.rows,
  });
  return discovered.slice(0, limit);
}

async function targetRecentlyBackfilled(client, targetKey, throttleHours) {
  if (!throttleHours) return false;
  const result = await client.query(`
    SELECT id
      FROM external_provider_backfill_runs
     WHERE target_key = $1
       AND status IN ('ok', 'deferred_provider', 'retry_wait')
       AND created_at >= NOW() - make_interval(hours => $2::int)
     ORDER BY created_at DESC
     LIMIT 1
  `, [targetKey, Math.floor(Number(throttleHours))]);
  return result.rows.length > 0;
}

async function insertCompanyFundamental(client, row) {
  if (!row || row.valueNum === null || row.valueNum === undefined) return false;
  const periodEnd = toIsoDate(row.periodEnd)?.slice(0, 10) || null;
  const result = await client.query(`
    INSERT INTO company_fundamentals (
      symbol, period_end, metric_name, value_num, unit, source_type, evidence_ref, metadata, created_at
    )
    SELECT $1, NULLIF($2, '')::date, $3, $4, $5, $6, $7, $8::jsonb, NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM company_fundamentals
       WHERE symbol = $1
         AND COALESCE(period_end::text, '') = COALESCE($2, '')
         AND metric_name = $3
         AND source_type = $6
    )
    RETURNING id
  `, [
    row.symbol,
    periodEnd,
    row.metricName,
    row.valueNum,
    row.unit || 'USD',
    row.sourceType || 'fmp',
    row.evidenceRef || `fmp:${row.symbol}`,
    jsonParam(row.metadata || {}),
  ]);
  return result.rows.length > 0;
}

async function insertValuationSnapshot(client, row) {
  if (!row || row.valueNum === null || row.valueNum === undefined) return false;
  const observedAt = toIsoDate(row.observedAt) || new Date().toISOString();
  const result = await client.query(`
    INSERT INTO valuation_snapshots (
      symbol, observed_at, metric_name, value_num, peer_group, source_type, metadata, created_at
    )
    SELECT $1, NULLIF($2, '')::timestamptz, $3, $4, $5, $6, $7::jsonb, NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM valuation_snapshots
       WHERE symbol = $1
         AND observed_at = $2::timestamptz
         AND metric_name = $3
         AND source_type = $6
    )
    RETURNING id
  `, [
    row.symbol,
    observedAt,
    row.metricName,
    row.valueNum,
    row.peerGroup || null,
    row.sourceType || 'manual_or_adapter',
    jsonParam(row.metadata || {}),
  ]);
  return result.rows.length > 0;
}

async function insertTranscriptEvidence(client, row) {
  if (!row?.symbol || !row?.excerpt) return false;
  const transcriptAt = toIsoDate(row.transcriptAt) || new Date().toISOString();
  const result = await client.query(`
    INSERT INTO transcript_evidence (
      symbol, speaker, transcript_at, topic, excerpt, evidence_ref, metadata, created_at
    )
    SELECT $1, $2, NULLIF($3, '')::timestamptz, $4, $5, $6, $7::jsonb, NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM transcript_evidence
       WHERE symbol = $1
         AND (
           (NULLIF($3, '') IS NULL AND transcript_at IS NULL)
           OR transcript_at = NULLIF($3, '')::timestamptz
         )
         AND COALESCE(topic, '') = COALESCE($4, '')
         AND COALESCE(evidence_ref, '') = COALESCE($6, '')
    )
    RETURNING id
  `, [
    row.symbol,
    row.speaker || null,
    transcriptAt,
    row.topic || 'earnings call transcript',
    cleanText(row.excerpt, 4000),
    row.evidenceRef || `fmp:${row.symbol}:earning-call-transcript`,
    jsonParam(row.metadata || {}),
  ]);
  return result.rows.length > 0;
}

async function collectFred(client, subject, options) {
  if (!fredAvailable()) return { provider: 'fred', available: false, inserted: 0, errors: [{ kind: 'no_key' }] };
  const result = await loadFred(subject);
  let inserted = 0;
  const kpiKey = 'external_macro_series';
  await upsertKpiDefinition(client, {
    kpiKey,
    displayName: 'External macro series',
    dataPack: 'marketPack',
    unit: 'value',
    sourceTypes: ['fred'],
    freshnessSlaHours: 720,
    definitionText: 'FRED macro/rates/credit indicators attached to a theme report as external context.',
  });
  await upsertThemeKpiMap(client, {
    themeId: options.theme,
    themeLabel: options.label,
    kpiKey,
    priority: 68,
    confidence: 0.75,
    rationale: 'Free FRED macro context improves regime and causal interpretation.',
  });
  for (const series of result.pack?.series || []) {
    const value = cleanNumber(series.latest?.value);
    if (value === null) continue;
    if (await insertObservation(client, {
      themeId: options.theme,
      kpiKey,
      kpiName: series.label || series.id,
      valueNum: value,
      unit: 'value',
      observedAt: series.latest?.date,
      sourceType: 'fred',
      sourceId: series.id,
      evidenceRef: `fred:${series.id}`,
      confidence: 0.82,
      metadata: {
        provider: 'fred',
        seriesId: series.id,
        label: series.label,
        latest: series.latest,
        series: series.series,
      },
    })) inserted += 1;
  }
  return { provider: 'fred', available: true, ok: result.ok, packAvailable: result.pack?.available || false, inserted, errors: result.errors || [] };
}

async function collectEia(client, subject, options) {
  if (!eiaAvailable()) return { provider: 'eia', available: false, inserted: 0, errors: [{ kind: 'no_key' }] };
  const result = await loadEia(subject);
  let inserted = 0;
  const kpiKey = 'electricity_demand_proxy';
  await upsertKpiDefinition(client, {
    kpiKey,
    displayName: 'Electricity demand proxy',
    dataPack: 'industryPack',
    unit: 'million kilowatt hours',
    sourceTypes: ['eia'],
    freshnessSlaHours: 4320,
    definitionText: 'Official EIA electricity demand context mapped to themes where power demand is a bottleneck or input.',
  });
  await upsertThemeKpiMap(client, {
    themeId: options.theme,
    themeLabel: options.label,
    kpiKey,
    priority: 82,
    confidence: 0.82,
    rationale: 'Official electricity demand is a direct input for infrastructure and energy-intensive themes.',
  });
  for (const series of result.pack?.series || []) {
    const latest = series.latest || {};
    const value = cleanNumber(latest.sales ?? latest.value ?? latest.generation);
    if (value === null) continue;
    if (await insertObservation(client, {
      themeId: options.theme,
      kpiKey,
      kpiName: series.label || 'EIA energy series',
      valueNum: value,
      unit: latest['sales-units'] || latest['value-units'] || latest['generation-units'] || 'value',
      geography: latest.stateDescription || latest.duoarea || null,
      observedAt: latest.period,
      sourceType: 'eia',
      sourceId: series.route,
      evidenceRef: `eia:${series.route}`,
      confidence: 0.86,
      metadata: {
        provider: 'eia',
        route: series.route,
        label: series.label,
        latest,
        series: series.series,
      },
    })) inserted += 1;
  }
  return { provider: 'eia', available: true, ok: result.ok, packAvailable: result.pack?.available || false, inserted, errors: result.errors || [] };
}

function publicPlanningCatalogEntriesForOptions(options = {}) {
  const routeText = cleanText([
    options.theme,
    options.label,
    ...asArray(options.desiredEvidenceClasses),
    ...asArray(options.providerRoutePlans).flatMap((plan) => [
      plan?.evidenceClass,
      plan?.providerRoute,
      plan?.acceptanceCriteria,
      ...asArray(plan?.sourceProviders),
      ...asArray(plan?.queryVariants),
      ...asArray(plan?.requiredFacts),
    ]),
  ].flat().filter(Boolean).join(' '), 5000);
  const classSet = new Set(asArray(options.desiredEvidenceClasses)
    .map((item) => slugify(item).replace(/-/g, '_')));
  for (const plan of asArray(options.providerRoutePlans)) {
    if (plan?.evidenceClass) classSet.add(slugify(plan.evidenceClass).replace(/-/g, '_'));
  }
  return PUBLIC_PLANNING_SOURCE_CATALOG.filter((entry) => {
    const classHit = asArray(entry.evidenceClasses).some((klass) => classSet.has(klass));
    return classHit || entry.match.test(routeText);
  });
}

async function collectPublicPlanningSources(client, options) {
  const entries = publicPlanningCatalogEntriesForOptions(options);
  if (!entries.length) {
    return {
      provider: 'public-planning-source',
      available: true,
      ok: true,
      inserted: 0,
      skipped: true,
      reason: 'no public planning source matched the report-scoped provider route',
    };
  }
  const routeTerms = uniqueStrings([
    options.label,
    options.theme,
    ...asArray(options.desiredEvidenceClasses).map((klass) => klass.replace(/_/g, ' ')),
    ...asArray(options.providerRoutePlans).flatMap((plan) => directTargetTermsFromPlan(plan, {
      label: options.label,
      theme: options.theme,
      aliases: [options.label, options.theme],
    })),
    ...entries.flatMap((entry) => entry.terms || []),
  ], (value) => cleanText(value, 100)).slice(0, 40);
  const inspected = [];
  const errors = [];
  for (const entry of entries.slice(0, Math.max(1, Math.min(8, Number(options.limit || 6))))) {
    const fetched = await fetchText(entry.url, 18_000);
    if (!fetched.ok) {
      errors.push({
        kind: 'public_planning_fetch_failed',
        provider: entry.provider,
        url: entry.url,
        status: fetched.status,
        error: fetched.error,
        retryable: /timeout|50\d|429|rate/i.test(`${fetched.status || ''} ${fetched.error || ''}`),
      });
      continue;
    }
    const text = stripHtmlToText(fetched.text, 140_000);
    const excerpt = bestPublicPlanningExcerpt(text, [...routeTerms, ...asArray(entry.terms)], 1400);
    if (!excerpt || excerpt.length < 80) continue;
    if (/\b(title:\s*just a moment|target url returned error\s+40[036]|forbidden warning|maybe not yet fully loaded)\b/i.test(excerpt)) {
      errors.push({
        kind: 'public_planning_reader_blocked',
        provider: entry.provider,
        url: entry.url,
        status: fetched.status || 403,
        retryable: true,
      });
      continue;
    }
    inspected.push({
      provider: 'public-planning-source',
      sourceProvider: entry.provider,
      sourceType: 'public_planning_source',
      title: entry.name,
      excerpt,
      text: excerpt,
      fullText: text,
      url: entry.url,
      evidenceRef: entry.url,
      publishedAt: null,
      hitKpis: [],
      publicPlanningProvider: entry.provider,
      publicPlanningEvidenceClasses: entry.evidenceClasses,
      sourceTerms: uniqueStrings([...(entry.terms || []), ...routeTerms], (value) => cleanText(value, 120)).slice(0, 30),
      frontierNodeEvidenceTerms: uniqueStrings(PUBLIC_PLANNING_EVIDENCE_TERMS, (value) => cleanText(value, 120)).slice(0, 30),
      fetchFallbackAttempted: Boolean(fetched.fallbackAttempted),
    });
  }
  return {
    provider: 'public-planning-source',
    available: true,
    ok: errors.length === 0 || inspected.length > 0,
    inserted: 0,
    inspectedCount: inspected.length,
    inspected,
    errors,
  };
}

async function collectDodContracts(client, options) {
  const ontologyContext = themeOntologyContext(options);
  const definitions = ontologyContext.definitions.filter((definition) => String(definition.kpiKey || '').startsWith('defense_'));
  if (!definitions.length) {
    return {
      provider: 'dod-contracts',
      available: true,
      ok: true,
      inserted: 0,
      skipped: true,
      reason: 'DoD contract announcements only apply to defense ontology themes.',
    };
  }
  const rss = await fetchText(DOD_CONTRACTS_RSS_URL, 15_000);
  if (!rss.ok) {
    return {
      provider: 'dod-contracts',
      available: true,
      ok: false,
      inserted: 0,
      errors: [{ kind: 'rss_fetch_failed', url: DOD_CONTRACTS_RSS_URL, error: rss.error, status: rss.status }],
    };
  }
  const items = parseDodContractRssItems(rss.text).slice(0, Math.max(1, Math.min(20, Number(options.limit || 12))));
  const ontologyTerms = uniqueStrings(definitions.flatMap((definition) => [
    definition.displayName,
    definition.definitionText,
    ...asArray(definition.metadata?.queryTerms),
  ]), (value) => cleanText(value, 90));
  const allowedKpiKeys = new Set([
    'defense_contract_awards',
    'defense_procurement_budget_lines',
    'defense_munitions_capacity',
    'defense_missile_air_defense_demand',
    'defense_program_delays',
    'defense_shipyard_throughput',
    'defense_nato_eu_budget_commitments',
  ]);
  let inserted = 0;
  const errors = [];
  const inspected = [];
  for (const item of items) {
    const fetched = await fetchText(item.link, 15_000);
    if (!fetched.ok) {
      errors.push({ kind: 'contract_page_fetch_failed', title: item.title, url: item.link, status: fetched.status, error: fetched.error });
      continue;
    }
    const articleText = stripHtmlToText(fetched.text, 90_000);
    const excerpt = excerptAroundTerms(articleText, ontologyTerms, 3200) || cleanText(`${item.title}. ${item.description}`, 3200);
    const facts = extractDodContractFacts(articleText);
    const result = await insertOntologyKpiEvidenceHits(client, {
      options,
      symbol: null,
      text: `${excerpt} ${articleText}`,
      evidenceRef: item.link,
      sourceType: 'dod_contract_awards',
      sourceId: `dod-contracts:${slugify(item.title || item.link)}`,
      observedAt: item.pubDate || new Date().toISOString(),
      provider: 'dod-contracts',
      definitions,
      metadata: {
        title: item.title,
        description: item.description,
        rssUrl: DOD_CONTRACTS_RSS_URL,
        amountCount: facts.amountCount,
        largestAwardUsd: facts.largestAwardUsd,
        largestAwardText: facts.largestAwardText,
        sourceBoundary: 'Official War.gov contract announcements; award evidence, not issuer guidance.',
      },
    });
    const filteredKpis = result.hits
      .filter((hit) => !allowedKpiKeys.has(hit.definition.kpiKey))
      .map((hit) => hit.definition.kpiKey);
    if (filteredKpis.length) {
      errors.push({ kind: 'unexpected_kpi_hit_filtered', title: item.title, filteredKpis });
    }
    inserted += result.inserted;
    inspected.push({
      title: item.title,
      url: item.link,
      excerpt: cleanText(excerpt, 700),
      hitKpis: result.hits.map((hit) => hit.definition.kpiKey),
      largestAwardUsd: facts.largestAwardUsd,
      largestAwardText: facts.largestAwardText,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return {
    provider: 'dod-contracts',
    available: true,
    ok: errors.length === 0 || inserted > 0,
    inserted,
    inspectedCount: inspected.length,
    inspected: inspected.slice(0, 8),
    errors,
  };
}

async function symbolsNeedingSecCompanyFactsRefresh(client, symbols = [], options = {}) {
  const issuerSymbols = filterIssuerSymbols(symbols);
  if (!issuerSymbols.length || options.secRefresh === false) return [];
  const staleHours = Math.max(0, Math.floor(Number(options.secRefreshStaleHours ?? 24 * 7)));
  const result = await queryOptional(client, `
    SELECT ticker,
           MAX(imported_at) AS last_imported_at,
           COUNT(*)::int AS filing_count
      FROM sec_filings_evidence
     WHERE ticker = ANY($1::text[])
       AND filing_type = ANY($2::text[])
     GROUP BY ticker
  `, [issuerSymbols, ['8-K', '10-Q', '10-K']]);
  const rowsByTicker = new Map(result.rows.map((row) => [String(row.ticker || '').toUpperCase(), row]));
  return issuerSymbols.filter((symbol) => {
    const row = rowsByTicker.get(symbol);
    if (!row) return true;
    if (!staleHours) return false;
    const importedAt = row.last_imported_at ? new Date(row.last_imported_at).valueOf() : 0;
    return !Number.isFinite(importedAt) || Date.now() - importedAt > staleHours * 60 * 60 * 1000;
  });
}

async function refreshSecCompanyFactsForSymbols(client, symbols = [], options = {}) {
  const needingRefresh = await symbolsNeedingSecCompanyFactsRefresh(client, symbols, options);
  const refreshed = [];
  const errors = [];
  for (const symbol of needingRefresh) {
    try {
      const result = await runSecCompanyFacts({
        ticker: symbol,
        includeFacts: true,
        includeFilings: true,
        maxFacts: options.secMaxFacts,
        maxFilings: options.secMaxFilings,
        forms: ['10-K', '10-Q', '8-K'],
      });
      refreshed.push({
        symbol,
        factCount: result.factCount || 0,
        filingCount: result.filingCount || 0,
        upsertedFacts: result.upsertedFacts || 0,
        upsertedFilings: result.upsertedFilings || 0,
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
    } catch (error) {
      errors.push({
        symbol,
        kind: 'sec_companyfacts_refresh_failed',
        retryable: /deadlock|timeout|rate|fetch|network/i.test(String(error?.message || error)),
        error: String(error?.message || error).slice(0, 300),
      });
    }
  }
  return {
    attempted: needingRefresh.length,
    refreshed,
    errors,
  };
}

async function collectSecManagementCommentary(client, options) {
  const symbols = await loadThemeSymbols(client, options.theme, options.symbols, options);
  if (!symbols.length) {
    return { provider: 'sec', available: true, ok: true, symbols, inserted: 0, skipped: true, reason: 'no symbols for SEC management-commentary collection' };
  }
  const secRefresh = await refreshSecCompanyFactsForSymbols(client, symbols, options);
  const ontologyContext = themeOntologyContext(options);
  const terms = buildOntologyTranscriptTerms(options);
  const routeScoped = asArray(options.providerRoutePlans).length > 0;
  const routeTerms = uniqueStrings(asArray(options.providerRoutePlans).flatMap((plan) => directTargetTermsFromPlan(plan, {
    label: options.label,
    theme: options.theme,
    aliases: [options.label, options.theme],
  })));
  const maxFilingsPerSymbol = ontologyContext.definitions.some((definition) => String(definition.kpiKey || '').startsWith('defense_')) ? 5 : 2;
  const rows = await queryOptional(client, `
    SELECT filing_key,
           cik,
           ticker,
           entity_name,
           accession,
           filing_type,
           filing_date,
           accepted_at,
           primary_doc_url,
           primary_doc_description,
           primary_document,
           metadata
      FROM sec_filings_evidence
     WHERE ticker = ANY($1::text[])
       AND filing_type = ANY($2::text[])
       AND primary_doc_url IS NOT NULL
     ORDER BY ticker, filing_date DESC NULLS LAST, accepted_at DESC NULLS LAST
  `, [symbols, ['8-K', '10-Q', '10-K']]);
  const seenBySymbol = new Map();
  let inserted = 0;
  let insertedOntologyKpis = 0;
  const inspected = [];
  const errors = [];
  const deferredSymbolSet = new Set();
  let secRateLimited = false;
  const markSecRateLimited = (symbol, detail = {}) => {
    secRateLimited = true;
    const currentIndex = Math.max(0, symbols.indexOf(symbol));
    for (const deferred of symbols.slice(currentIndex)) deferredSymbolSet.add(deferred);
    errors.push({
      symbol,
      kind: 'provider_deferred_after_rate_limit',
      retryable: true,
      rateLimited: true,
      retryAfterSec: detail.retryAfterSec ?? null,
      nextAttemptAt: nextAttemptIso(detail.retryAfterSec ?? null),
    });
  };
  for (const row of rows.rows) {
    if (secRateLimited) break;
    const symbol = cleanSymbol(row.ticker);
    if (!symbol) continue;
    const seen = seenBySymbol.get(symbol) || 0;
    if (seen >= maxFilingsPerSymbol) continue;
    const documentCandidates = [{
      name: row.primary_document || 'primary_document',
      url: row.primary_doc_url,
      sourceType: 'sec_primary_filing_document',
      priority: 20,
      metadata: {},
    }];
    const indexUrl = buildSecArchiveIndexUrl(row);
    if (indexUrl && row.filing_type === '8-K') {
      const index = await fetchJson(indexUrl, {
        headers: {
          'User-Agent': process.env.SEC_USER_AGENT || process.env.EDGAR_USER_AGENT || process.env.LATTICE_HTTP_USER_AGENT || 'Lattice-Intelligence-Reports/0.1 (research; contact via repo)',
        },
      });
      if (index.ok) {
        documentCandidates.push(...extractSecAttachmentCandidates(index.json, row));
      } else {
        errors.push({
          symbol,
          filingKey: row.filing_key,
          url: indexUrl,
          kind: 'sec_index_fetch_failed',
          error: index.error,
          status: index.status,
          rateLimited: Boolean(index.rateLimited),
          retryable: Boolean(index.retryable),
          retryAfterSec: index.retryAfterSec ?? null,
        });
        if (index.rateLimited || index.status === 429) {
          markSecRateLimited(symbol, index);
          break;
        }
      }
    }
    const seenUrls = new Set();
    for (const doc of documentCandidates.sort((a, b) => b.priority - a.priority)) {
      if (secRateLimited) break;
      if (!doc.url || seenUrls.has(doc.url)) continue;
      seenUrls.add(doc.url);
      const fetched = await fetchText(doc.url);
      if (!fetched.ok) {
        errors.push({
          symbol,
          filingKey: row.filing_key,
          url: doc.url,
          kind: 'sec_doc_fetch_failed',
          error: fetched.error,
          status: fetched.status,
          rateLimited: Boolean(fetched.rateLimited),
          retryable: Boolean(fetched.rateLimited) || /timeout|50\d/i.test(`${fetched.status || ''} ${fetched.error || ''}`),
          retryAfterSec: fetched.retryAfterSec ?? null,
        });
        if (fetched.rateLimited || fetched.status === 429) {
          markSecRateLimited(symbol, fetched);
          break;
        }
        continue;
      }
      const excerpt = excerptAroundTerms(fetched.text, terms, doc.sourceType === 'sec_primary_filing_document' ? 2800 : 3600);
      if (!excerpt || excerpt.length < 120) continue;
      const hasTerm = terms.some((term) => excerpt.toLowerCase().includes(String(term).toLowerCase()));
      const hasRouteTerm = routeTerms.length
        ? routeTerms.some((term) => excerpt.toLowerCase().includes(String(term).toLowerCase()))
        : hasTerm;
      if (!hasTerm && row.filing_type !== '8-K') continue;
      if (routeScoped && !hasRouteTerm) continue;
      const isAttachment = doc.sourceType !== 'sec_primary_filing_document';
      const topic = isAttachment
        ? `${row.filing_type} exhibit earnings-release commentary`
        : `${row.filing_type} direct management commentary`;
      const insertedTranscript = await insertTranscriptEvidence(client, {
        symbol,
        speaker: row.entity_name || symbol,
        transcriptAt: row.accepted_at || row.filing_date || new Date().toISOString(),
        topic,
        excerpt,
        evidenceRef: doc.url,
        metadata: {
          provider: 'sec-edgar',
          sourceType: isAttachment ? doc.sourceType : 'sec_direct_management_commentary',
          directManagementCommentaryEvidence: true,
          directTranscriptEvidence: false,
          isCallTranscript: false,
          filingKey: row.filing_key,
          filingType: row.filing_type,
          filingDate: row.filing_date,
          acceptedAt: row.accepted_at,
          accession: row.accession,
          cik: row.cik,
          primaryDocument: row.primary_document,
          primaryDocDescription: row.primary_doc_description,
          attachmentName: isAttachment ? doc.name : null,
          extractionTerms: terms,
          boundary: isAttachment
            ? 'direct SEC 8-K exhibit / earnings-release commentary; not a verbatim earnings-call transcript'
            : 'direct issuer filing commentary; not a verbatim earnings-call transcript',
          ...(doc.metadata || {}),
        },
      });
      inspected.push({
        symbol,
        issuerName: row.entity_name || symbol,
        title: `${symbol} ${topic}`,
        excerpt,
        text: excerpt,
        url: doc.url,
        evidenceRef: doc.url,
        sourceType: isAttachment ? doc.sourceType : 'sec_direct_management_commentary',
        sourceProvider: 'sec-edgar',
        filingKey: row.filing_key,
        filingType: row.filing_type,
        filingDate: row.filing_date,
        acceptedAt: row.accepted_at,
        provider: 'sec',
      });
      const ontologyHits = await insertOntologyKpiEvidenceHits(client, {
        options,
        symbol,
        text: fetched.text,
        evidenceRef: doc.url,
        sourceType: isAttachment ? 'sec_exhibit_ontology_evidence' : 'sec_filing_ontology_evidence',
        sourceId: `sec:${symbol}:${row.filing_key || slugify(row.primary_doc_url)}:${slugify(doc.name || doc.url)}:ontology`,
        observedAt: row.accepted_at || row.filing_date || new Date().toISOString(),
        provider: 'sec-edgar',
        definitions: ontologyContext.definitions,
        metadata: {
          filingKey: row.filing_key,
          filingType: row.filing_type,
          filingDate: row.filing_date,
          accession: row.accession,
          cik: row.cik,
          primaryDocument: row.primary_document,
          primaryDocDescription: row.primary_doc_description,
          attachmentName: isAttachment ? doc.name : null,
          sourceBoundary: isAttachment
            ? 'SEC exhibit ontology hit; direct issuer exhibit, not computed proxy.'
            : 'SEC filing ontology hit; direct issuer filing, not computed proxy.',
        },
      });
      insertedOntologyKpis += ontologyHits.inserted;
      if (insertedTranscript) {
        inserted += 1;
        seenBySymbol.set(symbol, (seenBySymbol.get(symbol) || 0) + 1);
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  const rateLimited = errors.some((error) => error.rateLimited || error.status === 429);
  const retryable = rateLimited || errors.some((error) => error.retryable);
  const retryAfterSec = errors.map((error) => Number(error.retryAfterSec)).filter(Number.isFinite)[0] || null;
  const nextAttemptAt = retryable ? nextAttemptIso(retryAfterSec || null) : null;
  return {
    provider: 'sec',
    available: true,
    ok: !rateLimited && (secRefresh.errors.length === 0 || inserted + insertedOntologyKpis > 0),
    retryable,
    deferred: retryable,
    deferredProvider: retryable ? 'sec' : null,
    rateLimited,
    retryAfterSec,
    cooldownUntil: nextAttemptAt,
    nextAttemptAt,
    symbols,
    inserted: inserted + insertedOntologyKpis,
    insertedManagementCommentary: inserted,
    insertedOntologyKpis,
    secRefresh,
    inspectedCount: inspected.length,
    inspected: inspected.slice(0, 24),
    deferredSymbols: uniqueStrings([...deferredSymbolSet], cleanSymbol),
    providerRateLimitEvents: errors.filter((error) => error.rateLimited || error.status === 429),
    errors: [...secRefresh.errors, ...errors],
  };
}

async function loadIssuerRecipientProfiles(client, symbols = []) {
  const issuerSymbols = filterIssuerSymbols(symbols);
  if (!issuerSymbols.length) return [];
  const rows = await queryOptional(client, `
    SELECT ticker, entity_name
      FROM sec_entity_profiles
     WHERE ticker = ANY($1::text[])
  `, [issuerSymbols]);
  const byTicker = new Map(rows.rows.map((row) => [cleanSymbol(row.ticker), cleanText(row.entity_name, 180)]));
  return issuerSymbols.map((symbol) => ({
    symbol,
    recipientName: byTicker.get(symbol) || symbol,
  })).filter((row) => row.recipientName);
}

async function collectUsaSpendingAwards(client, options) {
  const ontologyContext = themeOntologyContext(options);
  const defenseDefinitions = ontologyContext.definitions.filter((definition) => String(definition.kpiKey || '').startsWith('defense_'));
  if (!defenseDefinitions.length) {
    return {
      provider: 'usaspending',
      available: true,
      ok: true,
      inserted: 0,
      skipped: true,
      reason: 'USAspending contract awards are currently mapped to defense ontology themes only.',
    };
  }
  const symbols = await loadThemeSymbols(client, options.theme, options.symbols, options);
  const recipients = await loadIssuerRecipientProfiles(client, symbols);
  if (!recipients.length) {
    return { provider: 'usaspending', available: true, ok: true, inserted: 0, skipped: true, reason: 'no issuer recipients resolved for USAspending collection' };
  }
  const contractDefinition = defenseDefinitions.find((definition) => definition.kpiKey === 'defense_contract_awards');
  const allowedOntologyDefinitions = defenseDefinitions.filter((definition) => new Set([
    'defense_contract_awards',
    'defense_procurement_budget_lines',
    'defense_munitions_capacity',
    'defense_missile_air_defense_demand',
    'defense_program_delays',
    'defense_shipyard_throughput',
    'defense_nato_eu_budget_commitments',
  ]).has(definition.kpiKey));
  let inserted = 0;
  let insertedOntologyKpis = 0;
  const inspected = [];
  const errors = [];
  const startDate = isoDateDaysAgo(options.usaspendingLookbackDays || 365);
  const endDate = new Date().toISOString().slice(0, 10);
  for (const recipient of recipients.slice(0, Math.max(1, Math.min(12, Number(options.limit || 8))))) {
    const payload = buildUsaSpendingAwardSearchPayload({
      recipientName: recipient.recipientName,
      startDate,
      endDate,
      limit: Math.max(1, Math.min(12, Number(options.limit || 8))),
    });
    const fetched = await fetchJson(USASPENDING_AWARD_SEARCH_URL, {
      method: 'POST',
      body: payload,
      timeoutMs: 20_000,
    });
    if (!fetched.ok) {
      errors.push({
        symbol: recipient.symbol,
        recipientName: recipient.recipientName,
        kind: 'usaspending_award_fetch_failed',
        status: fetched.status,
        retryable: /429|timeout|50\d|rate/i.test(`${fetched.status || ''} ${fetched.error || ''}`),
        error: fetched.error,
      });
      continue;
    }
    const awards = extractUsaSpendingAwardFacts(fetched.json, recipient).slice(0, Math.max(1, Math.min(8, Number(options.limit || 6))));
    for (const award of awards) {
      if (contractDefinition && award.amountUsd !== null) {
        await upsertKpiDefinition(client, {
          kpiKey: contractDefinition.kpiKey,
          displayName: contractDefinition.displayName,
          dataPack: contractDefinition.dataPack,
          unit: 'USD',
          sourceTypes: uniqueStrings([...(contractDefinition.sourceTypes || []), 'usaspending_contract_awards']),
          freshnessSlaHours: contractDefinition.freshnessSlaHours,
          definitionText: contractDefinition.definitionText,
        });
        await upsertThemeKpiMap(client, {
          themeId: ontologyContext.themeId,
          themeLabel: ontologyContext.themeLabel,
          kpiKey: contractDefinition.kpiKey,
          priority: contractDefinition.priority,
          confidence: 0.82,
          rationale: 'USAspending public award data supplies recipient-level contract award evidence.',
        });
        if (await insertObservation(client, {
          themeId: ontologyContext.themeId,
          kpiKey: contractDefinition.kpiKey,
          kpiName: contractDefinition.displayName,
          valueNum: award.amountUsd,
          unit: 'USD',
          observedAt: award.startDate || new Date().toISOString(),
          sourceType: 'usaspending_contract_awards',
          sourceId: `usaspending:${award.generatedId || award.awardId || recipient.symbol}`,
          evidenceRef: award.evidenceRef,
          entityId: recipient.symbol,
          confidence: 0.84,
          metadata: {
            provider: 'usaspending',
            symbol: recipient.symbol,
            recipientName: award.recipientName,
            awardId: award.awardId,
            generatedId: award.generatedId,
            rawAward: award.raw,
            proxyBoundary: 'Federal award data is a contract-award/procurement proxy; it does not satisfy direct issuer book-to-bill or management-guidance evidence.',
          },
        })) inserted += 1;
      }
      const ontologyHits = await insertOntologyKpiEvidenceHits(client, {
        options,
        symbol: recipient.symbol,
        text: award.text,
        evidenceRef: award.evidenceRef,
        sourceType: 'usaspending_contract_awards',
        sourceId: `usaspending:${recipient.symbol}:${slugify(award.awardId || award.generatedId || award.evidenceRef)}:ontology`,
        observedAt: award.startDate || new Date().toISOString(),
        provider: 'usaspending',
        definitions: allowedOntologyDefinitions,
        metadata: {
          recipientName: award.recipientName,
          awardId: award.awardId,
          generatedId: award.generatedId,
          amountUsd: award.amountUsd,
          sourceBoundary: 'USAspending award evidence; use as procurement/award evidence, not issuer book-to-bill.',
        },
      });
      insertedOntologyKpis += ontologyHits.inserted;
      inspected.push({
        symbol: recipient.symbol,
        recipientName: award.recipientName,
        awardId: award.awardId,
        amountUsd: award.amountUsd,
        evidenceRef: award.evidenceRef,
        text: cleanText(award.text, 700),
        hitKpis: ontologyHits.hits.map((hit) => hit.definition.kpiKey),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return {
    provider: 'usaspending',
    available: true,
    ok: errors.length === 0 || inserted + insertedOntologyKpis > 0,
    symbols: recipients.map((row) => row.symbol),
    inserted: inserted + insertedOntologyKpis,
    insertedAwardAmounts: inserted,
    insertedOntologyKpis,
    inspectedCount: inspected.length,
    inspected: inspected.slice(0, 8),
    errors,
  };
}

async function collectFmp(client, options) {
  if (!fmpAvailable()) return { provider: 'fmp', available: false, inserted: 0, errors: [{ kind: 'no_key' }] };
  const symbols = await loadThemeSymbols(client, options.theme, options.symbols, options);
  const ontologyContext = themeOntologyContext(options);
  let insertedFundamentals = 0;
  let insertedValuations = 0;
  let insertedTranscripts = 0;
  let insertedOntologyKpis = 0;
  const errors = [];
  const inspected = [];
  const deferredSymbols = [];
  const providerRateLimitEvents = [];
  const transcriptTerms = buildOntologyTranscriptTerms(options);
  let fmpRateLimited = false;
  for (let symbolIndex = 0; symbolIndex < symbols.length; symbolIndex += 1) {
    const symbol = symbols[symbolIndex];
    const result = await loadFmp({ kind: SUBJECT_KINDS.SYMBOL, key: symbol }, {
      includeTranscripts: true,
      transcriptLimit: 2,
      transcriptTerms,
    });
    if (!result.ok) errors.push({
      symbol,
      kind: 'load_failed',
      retryable: Boolean(result.retryable),
      rateLimited: Boolean(result.rateLimited),
      retryAfterSec: result.retryAfterSec ?? null,
    });
    for (const error of result.errors || []) errors.push({ symbol, ...error });
    if (result.rateLimited) {
      for (const deferred of symbols.slice(symbolIndex)) deferredSymbols.push(deferred);
      const event = {
        symbol,
        kind: 'provider_deferred_after_rate_limit',
        retryable: true,
        rateLimited: true,
        retryAfterSec: result.retryAfterSec ?? null,
        nextAttemptAt: nextAttemptIso(result.retryAfterSec ?? null),
      };
      providerRateLimitEvents.push(event);
      errors.push(event);
      fmpRateLimited = true;
    }
    for (const row of result.pack?.incomeAnnual || []) {
      for (const [metricName, valueNum] of [
        ['Revenue', row.revenue],
        ['Operating Income', row.operatingIncome],
        ['Net Income', row.netIncome],
        ['Gross Margin', row.grossProfitRatio],
        ['Operating Margin', row.operatingIncomeRatio],
        ['EPS', row.eps],
      ]) {
        const value = cleanNumber(valueNum);
        if (value === null) continue;
        if (await insertCompanyFundamental(client, {
          symbol,
          periodEnd: row.date,
          metricName,
          valueNum: value,
          unit: metricName.includes('Margin') ? 'ratio' : metricName === 'EPS' ? 'USD/share' : 'USD',
          sourceType: 'fmp',
          evidenceRef: `fmp:${symbol}:income-statement`,
          metadata: { provider: 'fmp', row, statement: 'incomeAnnual' },
        })) insertedFundamentals += 1;
      }
    }
    for (const row of result.pack?.cashflowAnnual || []) {
      for (const [metricName, valueNum] of [
        ['Operating Cash Flow', row.operatingCashFlow],
        ['Capital Expenditure', row.capitalExpenditure],
        ['Free Cash Flow', row.freeCashFlow],
      ]) {
        const value = cleanNumber(valueNum);
        if (value === null) continue;
        if (await insertCompanyFundamental(client, {
          symbol,
          periodEnd: row.date,
          metricName,
          valueNum: value,
          unit: 'USD',
          sourceType: 'fmp',
          evidenceRef: `fmp:${symbol}:cash-flow-statement`,
          metadata: { provider: 'fmp', row, statement: 'cashflowAnnual' },
        })) insertedFundamentals += 1;
        if (metricName === 'Capital Expenditure' && await insertOntologyFundamentalObservation(client, {
          options,
          symbol,
          metricName,
          valueNum: value,
          periodEnd: row.date,
          evidenceRef: `fmp:${symbol}:cash-flow-statement`,
          sourceId: `fmp:${symbol}:capital-expenditure:${row.date || 'latest'}`,
          definitions: ontologyContext.definitions,
          metadata: { row, statement: 'cashflowAnnual' },
        })) insertedOntologyKpis += 1;
      }
    }
    for (const row of result.pack?.analystEstimates || []) {
      const value = cleanNumber(row.estimatedRevenueAvg);
      if (value === null) continue;
      if (await insertCompanyFundamental(client, {
        symbol,
        periodEnd: row.date,
        metricName: 'Analyst Estimated Revenue Avg',
        valueNum: value,
        unit: 'USD',
        sourceType: 'fmp',
        evidenceRef: `fmp:${symbol}:analyst-estimates`,
        metadata: { provider: 'fmp', row, statement: 'analystEstimates' },
      })) insertedFundamentals += 1;
    }
    const ttm = result.pack?.keyMetricsTtm || {};
    for (const [metricName, valueNum] of Object.entries({
      'P/E TTM': ttm.peRatio,
      'Price/Book TTM': ttm.priceBookRatio,
      'ROE TTM': ttm.roe,
      'Debt/Equity TTM': ttm.debtToEquity,
      'Current Ratio TTM': ttm.currentRatio,
      'EV/EBITDA TTM': ttm.evToEbitda,
    })) {
      const value = cleanNumber(valueNum);
      if (value === null) continue;
      if (await insertValuationSnapshot(client, {
        symbol,
        observedAt: new Date().toISOString(),
        metricName,
        valueNum: value,
        peerGroup: options.theme,
        sourceType: 'fmp',
        metadata: { provider: 'fmp', ttm, peers: result.pack?.peers || [] },
      })) insertedValuations += 1;
    }
    for (const transcript of result.pack?.earningsTranscripts || []) {
      const evidenceRef = transcript.url || `fmp:${symbol}:earning-call-transcript:${transcript.fiscalYear}:Q${transcript.quarter}`;
      const title = `${symbol} ${transcript.fiscalYear || ''} Q${transcript.quarter || ''} earnings call transcript`.trim();
      if (await insertTranscriptEvidence(client, {
        symbol,
        speaker: transcript.speaker,
        transcriptAt: transcript.eventDate || new Date().toISOString(),
        topic: title.replace(`${symbol} `, ''),
        excerpt: transcript.excerpt,
        evidenceRef,
        metadata: {
          provider: 'fmp',
          sourceType: 'fmp_earning_call_transcript',
          transcript,
          directTranscriptEvidence: true,
          transcriptTerms,
        },
      })) insertedTranscripts += 1;
      inspected.push({
        symbol,
        title,
        excerpt: transcript.excerpt,
        text: transcript.excerpt,
        url: transcript.url || null,
        evidenceRef,
        sourceType: 'fmp_earning_call_transcript',
        sourceProvider: 'fmp-transcripts',
        provider: 'fmp',
        transcriptFiscalYear: transcript.fiscalYear,
        transcriptQuarter: transcript.quarter,
        speaker: transcript.speaker,
        publishedAt: transcript.eventDate || null,
      });
      const ontologyHits = await insertOntologyKpiEvidenceHits(client, {
        options,
        symbol,
        text: transcript.excerpt,
        evidenceRef,
        sourceType: 'fmp_transcript_ontology_evidence',
        sourceId: `fmp:${symbol}:transcript:${transcript.fiscalYear || 'fy'}:Q${transcript.quarter || 'q'}:ontology`,
        observedAt: transcript.eventDate || new Date().toISOString(),
        provider: 'fmp',
        definitions: ontologyContext.definitions,
        metadata: {
          transcriptFiscalYear: transcript.fiscalYear,
          transcriptQuarter: transcript.quarter,
          transcriptSpeaker: transcript.speaker,
        },
      });
      insertedOntologyKpis += ontologyHits.inserted;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(2000, Number(options.fmpSymbolDelayMs || 250)))));
    if (fmpRateLimited) break;
  }
  const rateLimited = errors.some((error) => error.rateLimited || error.status === 429);
  const retryable = rateLimited || errors.some((error) => error.retryable);
  const retryAfterSec = errors.map((error) => Number(error.retryAfterSec)).filter(Number.isFinite)[0] || null;
  return {
    provider: 'fmp',
    available: true,
    ok: !rateLimited,
    retryable,
    deferred: retryable,
    deferredProvider: retryable ? 'fmp' : null,
    rateLimited,
    retryAfterSec,
    cooldownUntil: retryable ? nextAttemptIso(retryAfterSec || null) : null,
    nextAttemptAt: retryable ? nextAttemptIso(retryAfterSec || null) : null,
    symbols,
    deferredSymbols: uniqueStrings(deferredSymbols, cleanSymbol),
    providerRateLimitEvents,
    inserted: insertedFundamentals + insertedValuations + insertedTranscripts + insertedOntologyKpis,
    insertedFundamentals,
    insertedValuations,
    insertedTranscripts,
    insertedOntologyKpis,
    inspectedCount: inspected.length,
    inspected: inspected.slice(0, 24),
    errors,
  };
}

async function collectPolygon(client, options) {
  if (!polygonAvailable()) return { provider: 'polygon', available: false, inserted: 0, errors: [{ kind: 'no_key' }] };
  const symbols = await loadThemeSymbols(client, options.theme, options.symbols, options);
  let inserted = 0;
  const errors = [];
  for (const symbol of symbols) {
    const result = await loadPolygon({ kind: SUBJECT_KINDS.SYMBOL, key: symbol });
    if (!result.ok) errors.push({ symbol, kind: 'load_failed' });
    const bar = result.pack?.previousBar;
    if (bar?.close != null && await insertValuationSnapshot(client, {
      symbol,
      observedAt: bar.timestamp || new Date().toISOString(),
      metricName: 'Polygon Previous Close',
      valueNum: cleanNumber(bar.close),
      peerGroup: options.theme,
      sourceType: 'polygon',
      metadata: {
        provider: 'polygon',
        previousBar: bar,
        reference: result.pack?.reference || null,
      },
    })) inserted += 1;
    if (bar?.volume != null && await insertValuationSnapshot(client, {
      symbol,
      observedAt: bar.timestamp || new Date().toISOString(),
      metricName: 'Polygon Previous Volume',
      valueNum: cleanNumber(bar.volume),
      peerGroup: options.theme,
      sourceType: 'polygon',
      metadata: {
        provider: 'polygon',
        previousBar: bar,
        reference: result.pack?.reference || null,
      },
    })) inserted += 1;
  }
  return { provider: 'polygon', available: true, ok: true, symbols, inserted, errors };
}

function selectProvidersForBackfillTarget(target = {}, options = {}, resolvedSymbols = []) {
  const providerScopeSources = new Set(target.sources || []);
  const hasSymbolScope = Boolean(resolvedSymbols.length);
  const hasThemeProviderScope = [
    'manual',
    'env_or_cli',
    'cli',
    'theme_kpi_map',
    'source_registry',
    'electricity_demand_proxy',
    'external_macro_series',
  ].some((source) => providerScopeSources.has(source));
  const routeProviderScope = uniqueStrings(
    asArray(target.providerRoutePlans)
      .flatMap((plan) => asArray(plan?.executableCollectors))
      .filter((provider) => DEFAULT_PROVIDERS.includes(provider)),
  );
  const hasProviderRoutePlan = asArray(target.providerRoutePlans).length > 0;
  if (hasProviderRoutePlan && !routeProviderScope.length) return [];
  const requestedProviders = routeProviderScope.length
    ? options.providers.filter((provider) => routeProviderScope.includes(provider))
    : options.providers;
  return requestedProviders.filter((provider) => {
    if (provider === 'fmp' || provider === 'polygon') return hasSymbolScope || target.theme === DEFAULT_THEME;
    if (provider === 'usaspending') return hasSymbolScope || /defense|industrial|procurement|contract/i.test(`${target.theme || ''} ${target.label || ''}`);
    if (provider === 'fred' || provider === 'eia') return hasThemeProviderScope || target.theme === DEFAULT_THEME;
    if (provider === 'public-planning-source') return hasThemeProviderScope || hasProviderRoutePlan || target.theme === DEFAULT_THEME;
    return true;
  });
}

async function collectForTarget(client, target, options) {
  const resolvedSymbols = await loadThemeSymbols(
    client,
    target.theme || options.theme,
    target.symbols?.length ? target.symbols : options.symbols,
    { ...options, label: target.label || options.label, strictEndogenous: target.strictEndogenous },
  );
  const selectedProviders = selectProvidersForBackfillTarget(target, options, resolvedSymbols);
  const activeCooldowns = options.force || Number(options.throttleHours || 0) === 0
    ? []
    : await loadActiveProviderCooldowns(client, target, selectedProviders);
  const cooledProviders = new Map(activeCooldowns.map((cooldown) => [cooldown.provider, cooldown]));
  const runOptions = {
    ...options,
    theme: target.theme || options.theme,
    label: target.label || labelFromSlug(target.theme || options.theme),
    symbols: resolvedSymbols,
    providers: selectedProviders,
    reportId: target.reportId || options.reportId || null,
    latestReportId: target.latestReportId || null,
    reportIds: uniqueStrings([...asArray(target.reportIds), target.reportId, target.latestReportId, options.reportId]),
    providerRoutePlans: target.providerRoutePlans || [],
    desiredEvidenceClasses: target.desiredEvidenceClasses || [],
  };
  const subject = { kind: SUBJECT_KINDS.THEME, key: runOptions.theme };
  const cooldownResults = activeCooldowns.map((cooldown) => ({
    provider: cooldown.provider,
    available: true,
    ok: false,
    skipped: true,
    deferred: true,
    retryable: true,
    reason: 'provider_cooldown_active',
    retryReason: cooldown.retryReason,
    deferredSymbols: cooldown.deferredSymbols || [],
    cooldownUntil: cooldown.cooldownUntil,
    nextAttemptAt: cooldown.nextAttemptAt,
    sourceRunId: cooldown.sourceRunId || null,
  }));
  const providerJobs = [
    ['fred', (queryable) => collectFred(queryable, subject, runOptions)],
    ['eia', (queryable) => collectEia(queryable, subject, runOptions)],
    ['public-planning-source', (queryable) => collectPublicPlanningSources(queryable, runOptions)],
    ['dod-contracts', (queryable) => collectDodContracts(queryable, runOptions)],
    ['sec', (queryable) => collectSecManagementCommentary(queryable, runOptions)],
    ['usaspending', (queryable) => collectUsaSpendingAwards(queryable, runOptions)],
    ['fmp', (queryable) => collectFmp(queryable, runOptions)],
    ['polygon', (queryable) => collectPolygon(queryable, runOptions)],
  ].filter(([provider]) => runOptions.providers.includes(provider) && !cooledProviders.has(provider));
  const results = await runLimited(
    providerJobs,
    runOptions.providerConcurrency || options.providerConcurrency || 1,
    async ([provider, runProvider]) => {
      const useDedicatedClient = Number(runOptions.providerConcurrency || options.providerConcurrency || 1) > 1;
      const providerClient = useDedicatedClient ? new Client(resolveNasPgConfig()) : client;
      try {
        if (useDedicatedClient) await providerClient.connect();
        return await runProvider(providerClient);
      } catch (error) {
        return { provider, available: true, ok: false, inserted: 0, errors: [{ message: String(error?.message || error) }] };
      } finally {
        if (useDedicatedClient) await providerClient.end().catch(() => {});
      }
    },
  );
  results.unshift(...cooldownResults);
  if (!results.length) {
    results.push({
      provider: 'none',
      available: true,
      ok: true,
      inserted: 0,
      skipped: true,
      reason: 'no_safe_provider_scope_for_keyword_or_source_candidate',
    });
  }
  return { target: runOptions, results };
}

async function refreshTrackingHitsForTarget(client, target, options) {
  const ids = uniqueStrings(target.trackingTargetIds || []).map((id) => Number(id)).filter(Number.isFinite);
  const results = [];
  for (const id of ids) {
    try {
      results.push(await refreshTrackedTargetHits(client, id, {
        lookbackDays: options.trackingLookbackDays,
        maxPerAlias: 80,
      }));
    } catch (error) {
      results.push({ ok: false, targetId: id, error: String(error?.message || error) });
    }
  }
  return results;
}

async function insertBackfillRun(client, target, providers, status, summary) {
  await client.query(`
    INSERT INTO external_provider_backfill_runs (
      target_key, target_theme, target_label, target_symbols, providers,
      discovered_from, status, summary, created_at
    ) VALUES ($1, $2, $3, $4::text[], $5::text[], $6::jsonb, $7, $8::jsonb, NOW())
  `, [
    target.targetKey,
    target.theme,
    target.label,
    target.symbols || [],
    providers || [],
    jsonParam(target.sources || []),
    status,
    jsonParam(summary || {}),
  ]);
}

function providerRunStatus(results = []) {
  const list = asArray(results);
  if (list.some((result) => result.rateLimited)) return 'deferred_provider';
  if (list.some((result) => result.retryable || result.deferred)) return 'retry_wait';
  if (list.length && list.every((providerResult) => providerResult.skipped)) return 'skipped';
  if (list.some((result) => result.ok === false)) return 'partial';
  return 'ok';
}

function providerRouteEvidenceClasses(target = {}) {
  return uniqueStrings([
    ...asArray(target.desiredEvidenceClasses),
    ...asArray(target.providerRoutePlans).map((plan) => plan?.evidenceClass),
  ], slugify).map((value) => value.replace(/-/g, '_'));
}

function baselineOfficialProviderEvidenceUse(evidenceClass = '', provider = '', item = {}) {
  const cls = String(evidenceClass || '').replace(/-/g, '_');
  const hitKpis = asArray(item.hitKpis);
  const capability = collectorCapability(provider, cls);
  if (provider === 'public-planning-source' && capability.supported) {
    return capability.maxEvidenceUse || 'supporting_context';
  }
  const hasDirectIssuerText = ['sec', 'fmp'].includes(provider)
    && cleanText(item.excerpt || item.text || item.title, 80).length >= 40
    && ['issuer_exposure', 'issuer_commentary', 'primary_filing', 'capex_confirmation', 'cloud_revenue', 'power_constraint', 'supplier_capacity', 'substitution_limit', 'propulsion_constraint', 'technical_qualification'].includes(cls);
  if (hasDirectIssuerText && capability.supported) {
    return capability.maxEvidenceUse || 'supporting_context';
  }
  const hasOfficialProcurementFact = hitKpis.length > 0 || Number(item.largestAwardUsd || item.amountUsd || 0) > 0;
  if (!hasOfficialProcurementFact) return null;
  if (['procurement_trigger', 'policy_funding', 'mission_award'].includes(cls)) return 'promotion_candidate';
  if (['substitution_limit', 'propulsion_constraint', 'mechanism_validation'].includes(cls)) {
    const supportsConstraint = hitKpis.some((key) => /munitions_capacity|missile_air_defense_demand|procurement_budget_lines|contract_awards/.test(String(key || '')));
    return supportsConstraint ? 'supporting_context' : null;
  }
  if (provider === 'usaspending' && ['issuer_exposure', 'issuer_commentary'].includes(cls)) return 'supporting_context';
  return null;
}

function publicPlanningTermsForClass(evidenceClass = '') {
  const cls = String(evidenceClass || '').replace(/-/g, '_');
  return asArray(PUBLIC_PLANNING_CLASS_TERMS[cls]);
}

function officialProviderAcceptance(evidenceClass = '', provider = '', item = {}) {
  const baselineUse = baselineOfficialProviderEvidenceUse(evidenceClass, provider, item);
  const capability = collectorCapability(provider, evidenceClass);
  if (!baselineUse) {
    return {
      evidenceUse: null,
      acceptanceVerdict: 'rejected',
      factsExtracted: [],
      factKeys: [],
      missingFacts: [],
      collectorCapability: capability,
      closureReason: capability.supported ? 'provider_no_hit' : 'collector_not_available',
    };
  }
  const text = cleanText([
    item.symbol,
    item.issuerName,
    item.title,
    item.excerpt,
    item.text,
    item.recipientName,
    item.awardId,
    item.largestAwardText,
    item.amountUsd ? `$${Math.round(Number(item.amountUsd)).toLocaleString('en-US')}` : '',
    asArray(item.hitKpis).join(', '),
  ].filter(Boolean).join(' | '), 1200);
  const acceptance = evaluateEvidenceClassAcceptance({
    evidenceClass,
    provider,
    sourceType: item.sourceType || (provider === 'usaspending' ? 'usaspending_contract_awards' : provider === 'dod-contracts' ? 'dod_contract_awards' : provider),
    text,
    title: item.title || '',
    metadata: {
      provider,
      sourceProvider: provider,
      symbol: item.symbol || null,
      issuerName: item.issuerName || null,
      sourceType: item.sourceType || null,
      hitKpis: asArray(item.hitKpis),
      amountUsd: item.amountUsd || item.largestAwardUsd || null,
      largestAwardUsd: item.largestAwardUsd || item.amountUsd || null,
      awardId: item.awardId || null,
      filingType: item.filingType || null,
      evidenceRef: item.evidenceRef || item.url || null,
    },
    evidenceUse: baselineUse,
    maxEvidenceUse: capability.maxEvidenceUse || baselineUse,
    targetHit: item.targetHit !== false,
    classCueHit: true,
    strongClassCueHit: baselineUse === 'promotion_candidate',
  });
  return {
    ...acceptance,
    evidenceUse: acceptance.evidenceUse,
    collectorCapability: capability,
  };
}

function officialProviderEvidenceUse(evidenceClass = '', provider = '', item = {}) {
  return officialProviderAcceptance(evidenceClass, provider, item).evidenceUse;
}

async function upsertProviderBackfillQuestion(client, reportId, target = {}) {
  await ensureResearchOsSchema(client);
  const deterministicId = `provider-backfill:${reportId}:${target.targetKey || target.theme || 'target'}`;
  const { rows } = await client.query(`
    INSERT INTO research_questions (
      deterministic_id, question_type, themes, seed_terms, prompt, trigger_reason,
      novelty_score, heat_score, gap_score, priority_score, status, metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
    ON CONFLICT (deterministic_id) WHERE deterministic_id IS NOT NULL DO UPDATE
      SET themes = EXCLUDED.themes,
          seed_terms = EXCLUDED.seed_terms,
          prompt = EXCLUDED.prompt,
          trigger_reason = EXCLUDED.trigger_reason,
          metadata = research_questions.metadata || EXCLUDED.metadata,
          updated_at = NOW()
    RETURNING id
  `, [
    deterministicId,
    'provider_backfill',
    uniqueStrings([target.theme, ...asArray(target.sources)]).slice(0, 8),
    uniqueStrings([target.label, target.theme, ...asArray(target.aliases), ...providerRouteEvidenceClasses(target)]).slice(0, 18),
    `Report-scoped official provider evidence backfill for ${target.label || target.theme || reportId}.`,
    `Evidence contract provider backfill for report ${reportId}`,
    0.2,
    0.2,
    0.8,
    0.75,
    'new',
    jsonParam({
      reportId,
      targetKey: target.targetKey || null,
      source: 'collect-free-external-data',
      providerRoutePlans: target.providerRoutePlans || [],
    }),
  ]);
  return rows[0]?.id || null;
}

async function persistProviderRouteEvidenceBundles(client, target = {}, result = {}, options = {}) {
  const reportId = String(options.reportId || '').trim();
  if (!reportId) return { persisted: 0, skipped: true };
  const desiredClasses = providerRouteEvidenceClasses(target);
  if (!desiredClasses.length) return { persisted: 0, skipped: true, reason: 'no desired evidence classes' };
  const bundles = [];
  for (const providerResult of asArray(result.results)) {
    if (!['dod-contracts', 'usaspending', 'sec', 'fmp', 'public-planning-source'].includes(providerResult?.provider)) continue;
    for (const item of asArray(providerResult.inspected)) {
      const title = cleanText(item.title || `${providerResult.provider} official evidence`, 220);
      const baseExcerpt = cleanText(item.excerpt || item.text || [
        item.recipientName,
        item.awardId,
        item.largestAwardText,
        item.amountUsd ? `$${Math.round(Number(item.amountUsd)).toLocaleString('en-US')}` : '',
        asArray(item.hitKpis).join(', '),
      ].filter(Boolean).join(' | '), item.sourceType === 'public_planning_source' ? 1600 : 900);
      const url = item.url || item.evidenceRef || null;
      for (const evidenceClass of desiredClasses) {
        const providerRoutePlan = asArray(target.providerRoutePlans).find((plan) => slugify(plan?.evidenceClass) === slugify(evidenceClass)) || null;
        const excerpt = item.sourceType === 'public_planning_source' && item.fullText
          ? bestPublicPlanningExcerpt(item.fullText, [
            ...publicPlanningTermsForClass(evidenceClass),
            ...directTargetTermsFromPlan(providerRoutePlan, target),
            ...asArray(item.sourceTerms),
          ], 1600)
          : baseExcerpt;
        const targetHit = providerItemTargetHit({ ...item, provider: providerResult.provider }, providerRoutePlan, target);
        const acceptance = officialProviderAcceptance(evidenceClass, providerResult.provider, {
          ...item,
          excerpt,
          text: excerpt,
          targetHit,
        });
        const evidenceUse = acceptance.evidenceUse;
        if (!evidenceUse) continue;
        bundles.push({
          questionId: `provider-backfill:${reportId}`,
          sourceType: item.sourceType || (providerResult.provider === 'usaspending' ? 'usaspending_contract_awards' : providerResult.provider === 'dod-contracts' ? 'dod_contract_awards' : providerResult.provider),
          sourceId: [
            'provider-route',
            reportId,
            providerResult.provider,
            evidenceClass,
            item.awardId || item.evidenceRef || item.url || title,
          ].map(slugify).join(':'),
          title,
          textExcerpt: excerpt,
          url,
          publishedAt: item.publishedAt || null,
          relevanceScore: evidenceUse === 'promotion_candidate' ? 0.86 : 0.62,
          metadata: {
            reportId,
            latestReportId: reportId,
            desiredEvidenceClass: evidenceClass,
            evidenceClass,
            evidenceUse,
            promotionEligible: evidenceUse === 'promotion_candidate',
            memoryTier: evidenceUse,
            provider: providerResult.provider,
            sourceProvider: item.sourceProvider || providerResult.provider,
            publicPlanningProvider: item.publicPlanningProvider || null,
            publicPlanningEvidenceClasses: asArray(item.publicPlanningEvidenceClasses),
            sourceType: item.sourceType || null,
            providerRoutePlan,
            adjacentCandidateKey: target.adjacentCandidateKey || providerRoutePlan?.metadata?.adjacentCandidateKey || null,
            adjacentLane: target.adjacentLane || providerRoutePlan?.metadata?.adjacentLane || null,
            issuerUniverse: target.symbols || [],
            issuerSymbol: item.symbol || null,
            issuerName: item.issuerName || null,
            hitKpis: asArray(item.hitKpis),
            amountUsd: item.amountUsd || item.largestAwardUsd || null,
            awardId: item.awardId || null,
            filingKey: item.filingKey || null,
            filingType: item.filingType || null,
            transcriptFiscalYear: item.transcriptFiscalYear || null,
            transcriptQuarter: item.transcriptQuarter || null,
            factsExtracted: acceptance.factsExtracted || [],
            factKeys: acceptance.factKeys || [],
            missingFacts: acceptance.missingFacts || [],
            acceptanceVerdict: acceptance.acceptanceVerdict || evidenceUse,
            requiredFacts: acceptance.requiredFacts || [],
            collectorCapability: acceptance.collectorCapability || null,
            closureReason: acceptance.closureReason || null,
            targetHit,
            directTargetTerms: providerRoutePlan ? directTargetTermsFromPlan(providerRoutePlan, target) : [],
            sourceTerms: uniqueStrings(asArray(item.sourceTerms), (value) => cleanText(value, 120)).slice(0, 30),
            frontierNodeEvidenceTerms: uniqueStrings(asArray(item.frontierNodeEvidenceTerms), (value) => cleanText(value, 120)).slice(0, 30),
            fetchFallbackAttempted: Boolean(item.fetchFallbackAttempted),
            sourceBoundary: 'Report-scoped official provider evidence; promotion is limited to the requested evidence class and does not mutate canonical sources.',
          },
        });
      }
    }
  }
  if (!bundles.length) return { persisted: 0, skipped: true, reason: 'no class-qualified official provider rows' };
  const questionId = await upsertProviderBackfillQuestion(client, reportId, target);
  if (!questionId) return { persisted: 0, skipped: true, reason: 'provider backfill question unavailable' };
  for (const bundle of bundles) bundle.questionId = questionId;
  const persisted = await persistEvidenceBundles(client, bundles);
  return { persisted: persisted.inserted || 0, skipped: false, bundleCount: bundles.length };
}

async function runSingleTheme(client, options) {
  const target = normalizeBackfillTarget({
    theme: options.theme,
    label: options.label,
    symbols: options.symbols,
    discoveredFrom: ['manual'],
  });
  const result = await collectForTarget(client, target, options);
  const providerEvidence = await persistProviderRouteEvidenceBundles(client, { ...target, symbols: result.target.symbols }, result, options);
  const summary = { ...result, providerEvidence };
  await insertBackfillRun(client, { ...target, symbols: result.target.symbols }, result.target.providers, providerRunStatus(result.results), summary);
  return { ok: true, mode: 'single', theme: options.theme, results: result.results };
}

async function runAutoDiscover(client, options) {
  await ensureTrackingTargetsSchema(client);
  const explicitTargets = mergeBackfillTargets([
    ...options.themes.map((theme) => ({ theme, label: labelFromSlug(theme), discoveredFrom: ['env_or_cli'] })),
    ...(options.theme && options.theme !== DEFAULT_THEME ? [{ theme: options.theme, label: options.label, symbols: options.symbols, discoveredFrom: ['cli'] }] : []),
  ]);
  const discoveredTargets = await discoverProviderBackfillTargets(client, options);
  const targets = mergeBackfillTargets([...explicitTargets, ...discoveredTargets]).slice(0, options.limit);
  const targetResults = await runLimited(targets, options.targetConcurrency || 1, async (target) => {
    const useDedicatedClient = Number(options.targetConcurrency || 1) > 1;
    const targetClient = useDedicatedClient ? new Client(resolveNasPgConfig()) : client;
    try {
      if (useDedicatedClient) await targetClient.connect();
      if (!options.force && await targetRecentlyBackfilled(targetClient, target.targetKey, options.throttleHours)) {
        const skipped = { target, skipped: true, reason: 'recently_backfilled' };
        return skipped;
      }
      const trackingHits = await refreshTrackingHitsForTarget(targetClient, target, options);
      const result = await collectForTarget(targetClient, target, options);
      const providerEvidence = await persistProviderRouteEvidenceBundles(targetClient, { ...target, symbols: result.target.symbols }, result, options);
      const summary = { ...result, trackingHits, providerEvidence };
      await insertBackfillRun(targetClient, { ...target, symbols: result.target.symbols }, result.target.providers, providerRunStatus(result.results), summary);
      return { target, trackingHits, results: result.results };
    } finally {
      if (useDedicatedClient) await targetClient.end().catch(() => {});
    }
  });
  return {
    ok: true,
    mode: 'auto-discover',
    targetCount: targets.length,
    skippedCount: targetResults.filter((row) => row.skipped).length,
    targets: targetResults,
  };
}

async function main() {
  const options = parseArgs();
  if (options.themes.length) options.autoDiscover = true;
  loadOptionalEnvFile();
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    await ensureGenericKpiSchema(client);
    await ensureExternalProviderBackfillSchema(client);
    const payload = options.autoDiscover
      ? await runAutoDiscover(client, options)
      : await runSingleTheme(client, options);
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}

export {
  parseArgs,
  normalizeBackfillTarget,
  mergeBackfillTargets,
  extractBackfillTargetsFromRows,
  discoverProviderBackfillTargets,
  loadThemeSymbols,
  buildOntologyTranscriptTerms,
  buildSecArchiveIndexUrl,
  extractSecAttachmentCandidates,
  buildUsaSpendingAwardSearchPayload,
  extractUsaSpendingAwardFacts,
  symbolsNeedingSecCompanyFactsRefresh,
  parseDodContractRssItems,
  extractDodContractFacts,
  selectProvidersForBackfillTarget,
  officialProviderEvidenceUse,
  officialProviderAcceptance,
  providerRouteEvidenceClasses,
  providerCooldownsFromRuns,
  providerRunStatus,
};
