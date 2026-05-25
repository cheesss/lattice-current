export const COMPANY_IR_READONLY_VERSION = 'company-ir-readonly-v4-multilingual-balanced-extraction';

export const ABF_BOTTLENECK_TERMS = Object.freeze([
  'ABF substrate',
  'Ajinomoto build-up film',
  'build-up substrate',
  'IC substrate',
  'package substrate',
  'FC-BGA substrate',
  'semiconductor package substrate',
  'high-end substrate',
  'advanced substrate',
  'ICパッケージ基板',
  'パッケージ基板',
  '半導体パッケージ基板',
  'ビルドアップ基板',
  '高機能基板',
  'FC-BGA基板',
  'ABF基板',
  'IC載板',
  'ABF載板',
  '封裝基板',
  '高階載板',
  '半導體載板',
  '載板產能',
  '載板',
  '封装基板',
]);

export const ABF_OPERATING_BRIDGE_TERMS = Object.freeze([
  'capacity',
  'capacity expansion',
  'capex',
  'capital expenditure',
  'utilization',
  'production line',
  'allocation',
  'lead time',
  'order',
  'orders',
  'backlog',
  'customer demand',
  'AI server',
  'HPC',
  'data center',
  'advanced packaging',
  'guidance',
  'revenue growth',
  'segment revenue',
  'revenue',
  '生産能力',
  '產能',
  '產能擴充',
  '擴產',
  '増産',
  '拡張',
  '設備投資',
  '資本支出',
  '生産ライン',
  '產線',
  '納期',
  '交期',
  '供給配分',
  '顧客需要',
  '客戶需求',
  'データセンター',
  '資料中心',
  '受注',
  '訂單',
  '營收',
  '売上',
]);

export const ABF_NEGATIVE_CONTROL_TERMS = Object.freeze([
  'oversupply',
  'supply improving',
  'lead time improving',
  'capacity normalized',
  'no bottleneck',
  'diversified suppliers',
  'demand slowdown',
  'inventory correction',
]);

const JAPANESE_ABF_TERMS = new Set([
  'ICパッケージ基板',
  'パッケージ基板',
  '半導体パッケージ基板',
  'ビルドアップ基板',
  '高機能基板',
  'FC-BGA基板',
  'ABF基板',
  '生産能力',
  '増産',
  '拡張',
  '設備投資',
  '生産ライン',
  '納期',
  '供給配分',
  '顧客需要',
  'データセンター',
  '受注',
  '売上',
]);

const CHINESE_ABF_TERMS = new Set([
  'IC載板',
  'ABF載板',
  '封裝基板',
  '高階載板',
  '半導體載板',
  '載板產能',
  '載板',
  '封装基板',
  '產能',
  '產能擴充',
  '擴產',
  '資本支出',
  '產線',
  '交期',
  '客戶需求',
  '資料中心',
  '訂單',
  '營收',
]);

const ACCEPTED_ROLE_CLASSES = new Set([
  'substrate_capacity_owner',
  'material_input_owner',
  'osat_packaging_capacity',
]);

const DOCUMENT_TYPE_PRIORITY = Object.freeze({
  annual_report: 1,
  integrated_report: 2,
  ir_presentation: 3,
  earnings_presentation: 4,
  financial_results: 5,
  sustainability_report: 6,
  official_ir_document: 7,
});

const DOCUMENT_TYPE_SCORE = Object.freeze({
  annual_report: 30,
  integrated_report: 28,
  ir_presentation: 24,
  earnings_presentation: 22,
  financial_results: 16,
  sustainability_report: 5,
  official_ir_document: 8,
});

const INDEX_DOCUMENT_TYPES = new Set([
  'annual_report_library',
  'ir_report_library',
  'financial_report_library',
  'ir_library',
  'investor_library',
]);

const READONLY_ZERO_MUTATION_BOUNDARY = Object.freeze({
  providerActivationWrites: 0,
  sourceRegistryWrites: 0,
  canonicalWrites: 0,
  readinessPromotionWrites: 0,
  reportCandidateWrites: 0,
  portfolioActionWrites: 0,
});

const COMPANY_IR_HOLDOUT_ALLOWED_SOURCE_GROUPS = Object.freeze([
  'official_company_ir',
  'official_company_ir_holdout',
  'official_company_filing',
  'official_filing',
]);

export const DEFAULT_COMPANY_IR_HOLDOUT_VALIDATION_FIXTURES = Object.freeze([
  {
    fixtureId: 'positive_operating_bridge_fixture',
    fixtureKind: 'positive_operating_bridge_fixture',
    issuer: 'IBIDY',
    issuerName: 'Ibiden',
    issuerRoleClass: 'substrate_capacity_owner',
    sourceGroup: 'official_company_ir_holdout',
    sourceFamily: 'company_ir_presentation',
    sourceIndependence: 'issuer_official_independent_ir',
    sourceUrl: 'https://ir.example.com/ibiden/ir-presentation-2026',
    documentTitle: 'Ibiden IR presentation holdout validation fixture',
    documentType: 'ir_presentation',
    documentDate: '2026-05-20',
    fiscalYear: 2026,
    rawTextSnippet: 'Official IR presentation fixture: high-end ABF substrate capacity expansion supports AI server customer demand, capex allocation, revenue growth, backlog, and lead time management for package substrate products.',
  },
  {
    fixtureId: 'no_result_fixture',
    fixtureKind: 'no_result_fixture',
    issuer: 'IBIDY',
    issuerName: 'Ibiden',
    issuerRoleClass: 'substrate_capacity_owner',
    sourceGroup: 'official_company_ir_holdout',
    sourceFamily: 'company_ir_search',
    sourceIndependence: 'issuer_official_independent_ir',
    sourceUrl: 'https://ir.example.com/ibiden/no-result-fixture',
    documentTitle: 'Company IR holdout no-result fixture',
    documentType: 'company_ir_search_fixture',
    documentDate: '2026-05-20',
    rawTextSnippet: '',
  },
  {
    fixtureId: 'timeout_or_source_unavailable_fixture',
    fixtureKind: 'timeout_or_source_unavailable_fixture',
    issuer: 'IBIDY',
    issuerName: 'Ibiden',
    issuerRoleClass: 'substrate_capacity_owner',
    sourceGroup: 'official_company_ir_holdout',
    sourceFamily: 'company_ir_document',
    sourceIndependence: 'issuer_official_independent_ir',
    sourceUrl: 'https://ir.example.com/ibiden/source-unavailable-fixture',
    documentTitle: 'Company IR holdout source unavailable fixture',
    documentType: 'company_ir_timeout_fixture',
    documentDate: '2026-05-20',
    rawTextSnippet: '',
  },
  {
    fixtureId: 'ticker_only_rejection_fixture',
    fixtureKind: 'ticker_only_rejection_fixture',
    issuer: 'IBIDY',
    issuerName: 'Ibiden',
    issuerRoleClass: 'substrate_capacity_owner',
    sourceGroup: 'official_company_ir_holdout',
    sourceFamily: 'company_ir_search',
    sourceIndependence: 'issuer_official_independent_ir',
    sourceUrl: 'https://ir.example.com/ibiden/ticker-only-fixture',
    documentTitle: 'Company IR holdout ticker-only rejection fixture',
    documentType: 'ticker_lookup_fixture',
    documentDate: '2026-05-20',
    rawTextSnippet: 'IBIDY Ibiden',
    tickerOnly: true,
  },
  {
    fixtureId: 'raw_metadata_only_rejection_fixture',
    fixtureKind: 'raw_metadata_only_rejection_fixture',
    issuer: 'IBIDY',
    issuerName: 'Ibiden',
    issuerRoleClass: 'substrate_capacity_owner',
    sourceGroup: 'official_company_ir_holdout',
    sourceFamily: 'company_ir_search',
    sourceIndependence: 'issuer_official_independent_ir',
    sourceUrl: 'https://ir.example.com/ibiden/raw-metadata-only-fixture',
    documentTitle: 'Company IR holdout metadata-only rejection fixture',
    documentType: 'company_ir_metadata_fixture',
    documentDate: '2026-05-20',
    rawTextSnippet: 'Company IR metadata: issuer=IBIDY title=IR presentation fiscalYear=2026 documentType=ir_presentation',
    rawMetadataOnly: true,
  },
]);

export const ABF_COMPANY_IR_ALLOWLIST = Object.freeze([
  {
    issuer: 'IBIDY',
    issuerName: 'Ibiden',
    issuerRoleClass: 'substrate_capacity_owner',
    urls: [
      {
        sourceUrl: 'https://www.ibiden.com/ir/library/annual/',
        documentTitle: 'Ibiden annual reports library',
        documentType: 'annual_report_library',
        sourceGroup: 'official_company_ir',
      },
    ],
  },
  {
    issuer: 'UNICY',
    issuerName: 'Unimicron',
    issuerRoleClass: 'substrate_capacity_owner',
    urls: [
      {
        sourceUrl: 'https://www.unimicron.com/investor-relations/financial-reports',
        documentTitle: 'Unimicron financial reports',
        documentType: 'ir_report_library',
        sourceGroup: 'official_company_ir',
      },
    ],
  },
  {
    issuer: 'NANYF',
    issuerName: 'Nan Ya PCB',
    issuerRoleClass: 'substrate_capacity_owner',
    urls: [
      {
        sourceUrl: 'https://www.nanyapcb.com.tw/en/ir/financials',
        documentTitle: 'Nan Ya PCB investor financials',
        documentType: 'ir_report_library',
        sourceGroup: 'official_company_ir',
      },
    ],
  },
  {
    issuer: 'KINSF',
    issuerName: 'Kinsus',
    issuerRoleClass: 'substrate_capacity_owner',
    urls: [
      {
        sourceUrl: 'https://www.kinsus.com.tw/en/investor/financial-reports',
        documentTitle: 'Kinsus investor financial reports',
        documentType: 'ir_report_library',
        sourceGroup: 'official_company_ir',
      },
    ],
  },
  {
    issuer: 'ATASY',
    issuerName: 'AT&S',
    issuerRoleClass: 'substrate_capacity_owner',
    urls: [
      {
        sourceUrl: 'https://ats.net/en/investors/reports/',
        documentTitle: 'AT&S investor reports',
        documentType: 'annual_report_library',
        sourceGroup: 'official_company_ir',
      },
    ],
  },
  {
    issuer: 'SHINKO',
    issuerName: 'Shinko Electric Industries',
    issuerRoleClass: 'substrate_capacity_owner',
    urls: [
      {
        sourceUrl: 'https://www.shinko.co.jp/english/ir/library/annual/',
        documentTitle: 'Shinko annual reports',
        documentType: 'annual_report_library',
        sourceGroup: 'official_company_ir',
      },
    ],
  },
]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalize(value = '') {
  return compact(value).toLowerCase();
}

function uniqueStrings(values = [], limit = 80) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
    const text = compact(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function safeId(value = '') {
  return compact(value).replace(/[^a-zA-Z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'item';
}

function stableHash(value = '') {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stripHtml(value = '') {
  return String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value = '') {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchedTerms(text = '', terms = []) {
  const normalized = normalize(text);
  return uniqueStrings(asArray(terms).filter((term) => normalized.includes(normalize(term))), 40);
}

function languageForTerm(term = '') {
  if (JAPANESE_ABF_TERMS.has(term) || /[\u3040-\u30ff]/.test(term)) return 'ja';
  if (CHINESE_ABF_TERMS.has(term)) return 'zh';
  if (/[\u3400-\u9fff]/.test(term)) return 'cjk';
  return 'en';
}

function matchedLanguages(terms = []) {
  const languages = uniqueStrings(asArray(terms).map(languageForTerm), 6);
  if (languages.length > 1) return ['multi', ...languages];
  return languages;
}

function termOccurrences(text = '', terms = []) {
  const clean = compact(text);
  const lower = clean.toLowerCase();
  const out = [];
  for (const term of uniqueStrings(terms, 200)) {
    const needle = compact(term).toLowerCase();
    if (!needle) continue;
    let start = 0;
    while (start < lower.length) {
      const index = lower.indexOf(needle, start);
      if (index < 0) break;
      out.push({
        term,
        index,
        end: index + needle.length,
        language: languageForTerm(term),
      });
      start = index + Math.max(1, needle.length);
    }
  }
  return out.sort((a, b) => a.index - b.index || a.term.localeCompare(b.term));
}

export function findAbfOperatingProximity(text = '', {
  window = 800,
} = {}) {
  const clean = compact(text);
  const bottleneckHits = termOccurrences(clean, ABF_BOTTLENECK_TERMS);
  const operatingHits = termOccurrences(clean, ABF_OPERATING_BRIDGE_TERMS);
  let best = null;
  for (const bottleneck of bottleneckHits) {
    for (const operating of operatingHits) {
      const distance = Math.max(0, Math.max(bottleneck.index, operating.index) - Math.min(bottleneck.end, operating.end));
      if (distance > Number(window || 800)) continue;
      if (!best || distance < best.distance) best = { bottleneck, operating, distance };
    }
  }
  if (!best) {
    return {
      matched: false,
      proximityWindow: Number(window || 800),
      proximityScore: 0,
      matchedLanguage: matchedLanguages([...bottleneckHits, ...operatingHits].map((hit) => hit.term)),
      matchedBottleneckTerms: uniqueStrings(bottleneckHits.map((hit) => hit.term), 40),
      matchedOperatingTerms: uniqueStrings(operatingHits.map((hit) => hit.term), 40),
      matchedSnippet: '',
      pageNumber: null,
      textSpan: null,
    };
  }
  const start = Math.max(0, Math.min(best.bottleneck.index, best.operating.index) - 240);
  const end = Math.min(clean.length, Math.max(best.bottleneck.end, best.operating.end) + 240);
  const snippet = clean.slice(start, end);
  const snippetBottleneckTerms = matchedTerms(snippet, ABF_BOTTLENECK_TERMS);
  const snippetOperatingTerms = matchedTerms(snippet, ABF_OPERATING_BRIDGE_TERMS);
  return {
    matched: true,
    proximityWindow: Number(window || 800),
    proximityScore: Math.max(1, Number(window || 800) - best.distance),
    proximityDistance: best.distance,
    matchedLanguage: matchedLanguages([...snippetBottleneckTerms, ...snippetOperatingTerms]),
    matchedBottleneckTerms: snippetBottleneckTerms,
    matchedOperatingTerms: snippetOperatingTerms,
    matchedSnippet: snippet,
    pageNumber: null,
    textSpan: { start, length: snippet.length },
  };
}

function excerpt(text = '', terms = [], radius = 520) {
  const clean = compact(text);
  const normalized = normalize(clean);
  let index = -1;
  for (const term of asArray(terms)) {
    const found = normalized.indexOf(normalize(term));
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  if (index < 0) return clean.slice(0, radius * 2);
  return clean.slice(Math.max(0, index - radius), index + radius);
}

function hostOf(url = '') {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

function urlPathOf(url = '') {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function fiscalYearFrom(value = '') {
  const match = String(value || '').match(/\b(20[1-3][0-9])\b/);
  return match ? Number(match[1]) : null;
}

function currentYearFrom(value = new Date()) {
  const parsed = new Date(value || Date.now());
  return Number.isFinite(parsed.getTime()) ? parsed.getUTCFullYear() : new Date().getUTCFullYear();
}

function isStaleFiscalYear(year) {
  return Number.isFinite(Number(year)) && Number(year) < 2019;
}

function isPdfUrl(url = '', contentType = '') {
  return /\.pdf(?:$|[?#])/i.test(url) || /application\/pdf|pdf/i.test(contentType);
}

function isIndexDocument(doc = {}) {
  if (doc.isIndexPage === true) return true;
  const type = compact(doc.documentType).toLowerCase();
  if (INDEX_DOCUMENT_TYPES.has(type)) return true;
  return /library|reports?|financials?|investor/.test(urlPathOf(doc.sourceUrl)) && !/\.pdf(?:$|[?#])/i.test(doc.sourceUrl);
}

function documentPriority(documentType = '') {
  return DOCUMENT_TYPE_PRIORITY[compact(documentType).toLowerCase()] || 99;
}

function allowlistDocuments(allowlist = ABF_COMPANY_IR_ALLOWLIST) {
  return asArray(allowlist).flatMap((issuer) => asArray(issuer.urls).map((doc) => ({
    issuer: compact(issuer.issuer || issuer.symbol || issuer.issuerName).toUpperCase(),
    issuerName: compact(issuer.issuerName || issuer.name || issuer.issuer),
    issuerRoleClass: compact(issuer.issuerRoleClass || issuer.roleClass || 'unclear'),
    sourceUrl: compact(doc.sourceUrl || doc.url),
    documentTitle: compact(doc.documentTitle || doc.title || issuer.issuerName || issuer.issuer),
    documentType: compact(doc.documentType || 'ir_document'),
    language: compact(doc.language || 'unknown'),
    publishedAt: doc.publishedAt || null,
    fiscalYear: doc.fiscalYear || fiscalYearFrom([doc.documentTitle, doc.sourceUrl].join(' ')),
    sourceGroup: compact(doc.sourceGroup || 'official_company_ir'),
    allowedDocumentHosts: uniqueStrings([doc.allowedDocumentHosts, doc.documentHosts], 12),
  }))).filter((doc) => doc.sourceUrl);
}

export function validateCompanyIrAllowlistUrl(url = '', allowlist = ABF_COMPANY_IR_ALLOWLIST) {
  const target = compact(url);
  if (!target) return { allowed: false, reason: 'missing_url' };
  const normalizedTarget = target.replace(/\/+$/, '');
  const docs = allowlistDocuments(allowlist);
  const match = docs.find((doc) => doc.sourceUrl.replace(/\/+$/, '') === normalizedTarget);
  if (!match) return { allowed: false, reason: 'url_not_in_company_ir_allowlist' };
  return { allowed: true, document: match };
}

function classifyFetchFailure(error = '') {
  if (/timeout|abort/i.test(error)) return 'TIMEOUT';
  if (/http-?404|not found/i.test(error)) return 'NO_RESULT';
  if (/http|fetch|unavailable|network|getaddrinfo|enotfound|econn/i.test(error)) return 'SOURCE_UNAVAILABLE';
  return 'WEAK_EVIDENCE';
}

function classifyExtractionFailure(fetchResult = {}, text = '') {
  if (fetchResult.ok === false) return classifyFetchFailure(fetchResult.error);
  if (fetchResult.pdfMetadataOnly === true) return 'WEAK_EVIDENCE';
  if (!compact(text)) return 'NO_RESULT';
  return null;
}

function pdfTextFromBuffer(buffer) {
  const raw = Buffer.from(buffer || '').toString('utf8');
  const literalText = [...raw.matchAll(/\(([^)]{3,})\)/g)].map((match) => match[1]).join(' ');
  const candidate = literalText.length > 80 ? literalText : raw;
  return candidate
    .replace(/\\[rn]/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500000);
}

async function fetchDocumentText(url = '', {
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      text: '',
      rawText: '',
      error: 'fetch-unavailable',
      status: 0,
      extractionStatus: 'fetch_unavailable',
      documentBodyExtracted: false,
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 10000)));
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        'user-agent': process.env.LATTICE_HTTP_USER_AGENT || 'LatticeResearchOS/1.0 company-ir-readonly',
        accept: 'text/html,application/xhtml+xml,application/pdf,text/plain,*/*',
      },
    });
    clearTimeout(timeout);
    if (!response?.ok) {
      return {
        ok: false,
        text: '',
        rawText: '',
        error: `http-${response?.status || 'unknown'}`,
        status: response?.status || 0,
        extractionStatus: 'fetch_failed',
        documentBodyExtracted: false,
      };
    }
    const contentType = response.headers?.get?.('content-type') || '';
    if (isPdfUrl(url, contentType)) {
      let text = '';
      if (typeof response.arrayBuffer === 'function') {
        text = pdfTextFromBuffer(await response.arrayBuffer());
      } else if (typeof response.text === 'function') {
        text = stripHtml(await response.text());
      }
      const documentBodyExtracted = compact(text).length > 40;
      return {
        ok: true,
        text,
        rawText: text,
        contentType,
        status: response.status,
        pdfMetadataOnly: !documentBodyExtracted,
        extractionStatus: documentBodyExtracted ? 'pdf_text_extracted' : 'pdf_metadata_only',
        documentBodyExtracted,
      };
    }
    const rawText = typeof response.text === 'function' ? await response.text() : '';
    const text = stripHtml(rawText).slice(0, 500000);
    return {
      ok: true,
      text,
      rawText: rawText.slice(0, 500000),
      contentType,
      status: response.status,
      pdfMetadataOnly: false,
      extractionStatus: text ? 'html_text_extracted' : 'html_metadata_only',
      documentBodyExtracted: text.length > 0,
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      ok: false,
      text: '',
      rawText: '',
      error: String(error?.message || error),
      status: 0,
      extractionStatus: 'fetch_failed',
      documentBodyExtracted: false,
    };
  }
}

function classifyCompanyIrDocumentTypeFromText(value = '') {
  const text = normalize(value);
  if (/\b(integrated report|統合報告|integrated)\b/i.test(text)) return 'integrated_report';
  if (/\b(annual report|annual securities report|form 20-f|20-f|10-k|annual)\b/i.test(text)) return 'annual_report';
  if (/\b(earnings presentation|results presentation|financial results briefing|briefing)\b/i.test(text)) return 'earnings_presentation';
  if (/\b(financial results|quarterly results|results|決算短信)\b/i.test(text)) return 'financial_results';
  if (/\b(ir presentation|investor presentation|corporate presentation|presentation)\b/i.test(text)) return 'ir_presentation';
  if (/\b(sustainability report|esg report|csr report)\b/i.test(text)) return 'sustainability_report';
  return 'official_ir_document';
}

export function classifyCompanyIrDocumentType({ href = '', text = '' } = {}) {
  return classifyCompanyIrDocumentTypeFromText([text, href].join(' '));
}

function recencyScoreFor(year, generatedAt = new Date()) {
  const fiscalYear = Number(year);
  if (!Number.isFinite(fiscalYear)) return 4;
  const currentYear = currentYearFrom(generatedAt);
  const age = Math.max(0, currentYear - fiscalYear);
  if (age <= 1) return 30;
  if (age <= 3) return 24;
  if (age <= 5) return 16;
  if (age <= 7) return 8;
  return 0;
}

function proximityScore(text = '') {
  const proximity = findAbfOperatingProximity(text);
  if (proximity.matched) return 20;
  if (proximity.matchedBottleneckTerms.length) return 8;
  if (proximity.matchedOperatingTerms.length) return 4;
  return 0;
}

export function scoreCompanyIrDocument(doc = {}, {
  generatedAt = new Date().toISOString(),
} = {}) {
  const titleText = compact(doc.documentTitle || doc.title || '');
  const urlText = compact(doc.sourceUrl || doc.url || '');
  const snippetText = compact(doc.extractedTextSnippet || doc.rawTextSnippet || doc.snippet || '');
  const fiscalYear = Number(doc.fiscalYear || fiscalYearFrom([titleText, urlText].join(' ')));
  const staleDocument = isStaleFiscalYear(fiscalYear);
  const matchedTitleTerms = uniqueStrings([
    matchedTerms(titleText, ABF_BOTTLENECK_TERMS),
    matchedTerms(titleText, ABF_OPERATING_BRIDGE_TERMS),
  ], 40);
  const matchedUrlTerms = uniqueStrings([
    matchedTerms(urlText, ABF_BOTTLENECK_TERMS),
    matchedTerms(urlText, ABF_OPERATING_BRIDGE_TERMS),
    /\babf\b/i.test(urlText) ? ['ABF'] : [],
    /fc-?bga/i.test(urlText) ? ['FC-BGA'] : [],
  ], 40);
  const matchedSnippetTerms = uniqueStrings([
    matchedTerms(snippetText, ABF_BOTTLENECK_TERMS),
    matchedTerms(snippetText, ABF_OPERATING_BRIDGE_TERMS),
  ], 40);
  const recencyScore = recencyScoreFor(fiscalYear, generatedAt);
  const documentTypeScore = DOCUMENT_TYPE_SCORE[compact(doc.documentType).toLowerCase()] || 0;
  const titleTermMatchScore = matchedTitleTerms.length * 8;
  const urlTermMatchScore = matchedUrlTerms.length * 6;
  const seedTermProximityScore = proximityScore([titleText, urlText, snippetText].join(' '));
  const issuerRoleFitScore = ACCEPTED_ROLE_CLASSES.has(doc.issuerRoleClass) ? 10 : 0;
  const staleDocumentPenalty = staleDocument ? 45 : 0;
  const documentScore = recencyScore
    + documentTypeScore
    + titleTermMatchScore
    + urlTermMatchScore
    + seedTermProximityScore
    + issuerRoleFitScore
    - staleDocumentPenalty;
  return {
    ...doc,
    fiscalYear: Number.isFinite(fiscalYear) ? fiscalYear : null,
    staleDocument,
    documentScore,
    documentScoreBreakdown: {
      recencyScore,
      documentTypeScore,
      titleTermMatchScore,
      urlTermMatchScore,
      seedTermProximityScore,
      issuerRoleFitScore,
      staleDocumentPenalty,
    },
    matchedTitleTerms,
    matchedUrlTerms,
    matchedSnippetTerms,
  };
}

export function rankCompanyIrDocumentsForIssuer(docs = [], {
  generatedAt = new Date().toISOString(),
  maxDocumentsPerIssuer = 3,
} = {}) {
  const candidateDocuments = asArray(docs)
    .map((doc) => scoreCompanyIrDocument(doc, { generatedAt }))
    .sort((a, b) => (
      b.documentScore - a.documentScore
      || Number(b.fiscalYear || 0) - Number(a.fiscalYear || 0)
      || documentPriority(a.documentType) - documentPriority(b.documentType)
      || a.sourceUrl.localeCompare(b.sourceUrl)
    ));
  const freshCandidates = candidateDocuments.filter((doc) => doc.staleDocument !== true);
  const selectablePool = freshCandidates.length ? freshCandidates : candidateDocuments;
  const selectedKeys = new Set(selectablePool
    .slice(0, Math.max(1, Number(maxDocumentsPerIssuer || 3)))
    .map((doc) => doc.sourceUrl));
  const selectedDocuments = candidateDocuments
    .filter((doc) => selectedKeys.has(doc.sourceUrl))
    .map((doc, index) => ({
      ...doc,
      selectionRank: index + 1,
      selectionReason: doc.staleDocument ? 'stale_fallback_no_fresh_document_available' : 'ranked_by_freshness_relevance_and_role_fit',
    }));
  const rejectedDocuments = candidateDocuments
    .filter((doc) => !selectedKeys.has(doc.sourceUrl))
    .map((doc) => ({
      ...doc,
      rejectionReason: doc.staleDocument && freshCandidates.length
        ? 'stale_document_penalty'
        : 'lower_ranked_document',
    }));
  return {
    candidateDocuments,
    selectedDocuments,
    rejectedDocuments,
  };
}

function anchorLinks(html = '') {
  const out = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    const attrs = match[1] || '';
    const hrefMatch = attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i) || attrs.match(/\bhref\s*=\s*([^\s>]+)/i);
    const href = hrefMatch ? compact(hrefMatch[2] || hrefMatch[1] || '') : '';
    if (!href || /^(?:javascript:|mailto:|tel:|#)/i.test(href)) continue;
    out.push({
      href: decodeHtml(href),
      text: stripHtml(match[2] || ''),
    });
  }
  return out;
}

function officialDocumentUrlAllowed(url = '', indexDoc = {}) {
  const indexHost = hostOf(indexDoc.sourceUrl);
  const targetHost = hostOf(url);
  const extraHosts = new Set(uniqueStrings(indexDoc.allowedDocumentHosts, 20).map((host) => host.toLowerCase()));
  return Boolean(targetHost && (targetHost === indexHost || extraHosts.has(targetHost)));
}

export function resolveCompanyIrDocumentLinks(indexDoc = {}, html = '', {
  maxDocumentsPerIssuer = 3,
} = {}) {
  const links = [];
  const seen = new Set();
  for (const link of anchorLinks(html)) {
    let sourceUrl = '';
    try {
      sourceUrl = new URL(link.href, indexDoc.sourceUrl).href;
    } catch {
      continue;
    }
    if (!officialDocumentUrlAllowed(sourceUrl, indexDoc)) continue;
    const documentType = classifyCompanyIrDocumentType({ href: sourceUrl, text: link.text });
    if (documentType === 'official_ir_document' && !isPdfUrl(sourceUrl) && !/report|presentation|results|financial/i.test([sourceUrl, link.text].join(' '))) continue;
    const key = sourceUrl.replace(/[#?].*$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      ...indexDoc,
      sourceUrl,
      documentTitle: compact(link.text) || compact(indexDoc.documentTitle) || sourceUrl,
      documentType,
      sourceGroup: indexDoc.sourceGroup || 'official_company_ir',
      fiscalYear: fiscalYearFrom([link.text, sourceUrl].join(' ')) || null,
      publishedAt: indexDoc.publishedAt || null,
      parentIndexUrl: indexDoc.sourceUrl,
      isIndexPage: false,
      resolvedFromIndex: true,
    });
  }
  return links
    .sort((a, b) => (
      documentPriority(a.documentType) - documentPriority(b.documentType)
      || Number(b.fiscalYear || 0) - Number(a.fiscalYear || 0)
      || a.sourceUrl.localeCompare(b.sourceUrl)
    ))
    .slice(0, Math.max(1, Number(maxDocumentsPerIssuer || 3)));
}

function taskByClass(tasks = []) {
  const map = new Map();
  for (const task of asArray(tasks)) {
    const klass = compact(task.evidenceClass || task.evidence_class || task.payload?.evidenceClass);
    if (klass) map.set(klass, task.payload || task);
  }
  return map;
}

function sourceIndependenceForDoc(doc = {}) {
  if (doc.sourceIndependence) return compact(doc.sourceIndependence);
  const group = compact(doc.sourceGroup || 'official_company_ir');
  if (group === 'official_company_ir_holdout') return 'issuer_official_independent_ir';
  if (group === 'official_company_filing' || group === 'official_filing') return 'issuer_official_filing';
  return 'issuer_official_ir';
}

function rawBase(task = {}, seed = {}, doc = {}, generatedAt = new Date().toISOString()) {
  const evidenceClass = compact(task.evidenceClass || task.evidence_class);
  return {
    seedId: seed.seedId || seed.childSeedId || null,
    taskId: task.taskId || task.task_id || null,
    evidenceClass,
    desiredEvidenceClass: evidenceClass,
    providerName: 'company-ir-readonly',
    providerRoute: 'company-ir-readonly',
    source: 'company-ir-readonly',
    sourceType: doc.sourceGroup || 'official_company_ir',
    provider: 'company-ir-readonly',
    sourceProvider: 'company-ir-readonly',
    sourceGroup: doc.sourceGroup || 'official_company_ir',
    issuer: doc.issuer,
    issuerName: doc.issuerName,
    issuerRoleClass: doc.issuerRoleClass,
    sourceUrl: doc.sourceUrl,
    url: doc.sourceUrl,
    parentIndexUrl: doc.parentIndexUrl || null,
    documentTitle: doc.documentTitle,
    documentType: doc.documentType,
    language: doc.language,
    fiscalYear: doc.fiscalYear || null,
    publishedAt: doc.publishedAt || null,
    documentScore: Number.isFinite(Number(doc.documentScore)) ? Number(doc.documentScore) : null,
    documentScoreBreakdown: doc.documentScoreBreakdown || null,
    staleDocument: doc.staleDocument === true,
    selectionRank: doc.selectionRank || null,
    selectionReason: doc.selectionReason || null,
    rejectionReason: doc.rejectionReason || null,
    matchedTitleTerms: doc.matchedTitleTerms || [],
    matchedUrlTerms: doc.matchedUrlTerms || [],
    isIndexPage: doc.isIndexPage === true,
    resolvedFromIndex: doc.resolvedFromIndex === true,
    sourceFamily: doc.sourceFamily || 'company_ir_document',
    sourceIndependence: sourceIndependenceForDoc(doc),
    createdAt: generatedAt,
    officialSource: true,
    readOnlyCollector: true,
    mutationBoundary: { ...READONLY_ZERO_MUTATION_BOUNDARY },
    executionBoundary: {
      providerActivationWrites: 0,
      sourceRegistryWrites: 0,
      canonicalWrites: 0,
      approvalQueueWrites: 0,
      reportPromotionWrites: 0,
    },
  };
}

function documentExtractionFields(doc = {}, text = '', fetchResult = {}) {
  const topicTerms = matchedTerms(text, ABF_BOTTLENECK_TERMS);
  const bridgeTerms = matchedTerms(text, ABF_OPERATING_BRIDGE_TERMS);
  const proximity = findAbfOperatingProximity(text);
  const snippet = proximity.matchedSnippet || excerpt(text, [...topicTerms, ...ABF_BOTTLENECK_TERMS]);
  return {
    extractedTextSnippet: snippet,
    rawTextSnippet: snippet,
    textExcerpt: snippet,
    matchedSubjectTerms: topicTerms,
    matchedSnippetTerms: uniqueStrings([topicTerms, bridgeTerms], 80),
    matchedBottleneckTerms: topicTerms,
    matchedOperatingTerms: bridgeTerms,
    operatingBridgeSnippet: snippet,
    matchedLanguage: proximity.matchedLanguage || matchedLanguages([...topicTerms, ...bridgeTerms]),
    proximityWindow: proximity.proximityWindow,
    proximityScore: proximity.proximityScore,
    proximityDistance: proximity.proximityDistance ?? null,
    proximityMatch: proximity.matched === true,
    proximityMatches: proximity.matched ? [{
      matchedLanguage: proximity.matchedLanguage || [],
      matchedBottleneckTerms: proximity.matchedBottleneckTerms || [],
      matchedOperatingTerms: proximity.matchedOperatingTerms || [],
      proximityWindow: proximity.proximityWindow,
      proximityScore: proximity.proximityScore,
      matchedSnippet: proximity.matchedSnippet,
      pageNumber: proximity.pageNumber,
      textSpan: proximity.textSpan,
    }] : [],
    proximityMatchedSnippet: proximity.matchedSnippet || '',
    topicTerms,
    operatingBridgeTerms: bridgeTerms,
    extractedTerms: uniqueStrings([topicTerms, bridgeTerms], 80),
    pageNumber: null,
    textSpan: proximity.textSpan || (snippet ? { start: 0, length: snippet.length } : null),
    extractionStatus: fetchResult.extractionStatus || (doc.isIndexPage ? 'index_metadata_only' : 'not_evaluated'),
    documentBodyExtracted: fetchResult.documentBodyExtracted === true && doc.isIndexPage !== true,
  };
}

function issuerExposureRaw(task = {}, seed = {}, doc = {}, {
  text = '',
  fetchResult = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const fields = documentExtractionFields(doc, text, fetchResult);
  const roleAccepted = ACCEPTED_ROLE_CLASSES.has(doc.issuerRoleClass);
  const sourceAccepted = ['official_company_ir', 'official_filing'].includes(compact(doc.sourceGroup || 'official_company_ir'));
  const direct = sourceAccepted
    && roleAccepted
    && fields.documentBodyExtracted
    && fields.matchedBottleneckTerms.length > 0
    && fields.matchedOperatingTerms.length > 0
    && fields.proximityMatch === true
    && doc.staleDocument !== true
    && doc.isIndexPage !== true;
  const failureClassification = direct
    ? 'ACCEPTED'
    : fetchResult.ok === false
      ? classifyFetchFailure(fetchResult.error)
      : classifyExtractionFailure(fetchResult, text) || 'WEAK_EVIDENCE';
  const metadataOnlyReason = doc.isIndexPage === true
    ? 'company_ir_index_metadata_only'
    : doc.staleDocument === true
      ? 'company_ir_stale_document_raw_only'
    : !fields.documentBodyExtracted
      ? 'company_ir_document_body_not_extracted'
      : 'company_ir_weak_or_metadata_only';
  return {
    ...rawBase(task, seed, doc, generatedAt),
    evidenceId: `company-ir:${safeId(seed.seedId || seed.childSeedId)}:${safeId(doc.issuer)}:${stableHash(doc.sourceUrl)}:issuer`,
    title: `${doc.issuerName || doc.issuer} company IR ${seed.bottleneck?.label || seed.bottleneckNode || 'issuer exposure'} check`,
    summary: direct
      ? `Official company IR document links ${doc.issuerName || doc.issuer} ${doc.issuerRoleClass} to ${fields.matchedBottleneckTerms.join(', ')} with operating bridge terms ${fields.matchedOperatingTerms.join(', ')}. ${fields.extractedTextSnippet}`
      : fetchResult.ok === false
        ? `Company IR fetch failed for ${doc.sourceUrl}: ${fetchResult.error}`
        : `Company IR document did not establish an accepted ABF substrate operating bridge. ${fields.extractedTextSnippet}`,
    ...fields,
    acquisitionStatus: fetchResult.ok === false ? 'company_ir_fetch_failed' : 'company_ir_readonly_executed',
    acceptanceVerdict: direct ? 'company_ir_direct_candidate' : fields.proximityMatch !== true && fields.matchedBottleneckTerms.length && fields.matchedOperatingTerms.length ? 'company_ir_terms_not_proximate_raw_only' : metadataOnlyReason,
    evidenceUse: direct ? 'promotion_candidate' : 'weak_noise',
    promotionEligible: direct,
    failureClassification,
  };
}

function holdoutRaw(task = {}, seed = {}, doc = {}, {
  text = '',
  issuerEvidenceIds = [],
  issuerDirectDocuments = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const fields = documentExtractionFields(doc, text, doc.fetchResult || {});
  const issuerDirectKeys = new Set(asArray(issuerDirectDocuments).map((item) => `${item.sourceGroup || ''}:${item.documentType || ''}:${item.sourceUrl || ''}`));
  const sameDocument = issuerDirectKeys.has(`${doc.sourceGroup || ''}:${doc.documentType || ''}:${doc.sourceUrl || ''}`);
  const separateDocumentTypeOrGroup = !asArray(issuerDirectDocuments).some((item) => (
    item.sourceUrl === doc.sourceUrl
    || (item.sourceGroup === doc.sourceGroup && item.documentType === doc.documentType)
  ));
  const direct = !sameDocument
    && separateDocumentTypeOrGroup
    && ACCEPTED_ROLE_CLASSES.has(doc.issuerRoleClass)
    && fields.documentBodyExtracted
    && fields.matchedBottleneckTerms.length > 0
    && fields.matchedOperatingTerms.length > 0
    && fields.proximityMatch === true
    && doc.staleDocument !== true;
  return {
    ...rawBase(task, seed, { ...doc, sourceGroup: 'official_company_ir_holdout' }, generatedAt),
    evidenceId: `company-ir:${safeId(seed.seedId || seed.childSeedId)}:${safeId(doc.issuer)}:${stableHash(doc.sourceUrl)}:holdout`,
    title: `${doc.issuerName || doc.issuer} independent company IR holdout check`,
    summary: direct
      ? `Separate company IR document confirms ${fields.matchedBottleneckTerms.join(', ')} with operating bridge terms ${fields.matchedOperatingTerms.join(', ')}. ${fields.extractedTextSnippet}`
      : `Company IR holdout did not confirm a separate direct operating bridge. ${fields.extractedTextSnippet}`,
    ...fields,
    matchedEvidenceClasses: direct ? ['issuer_exposure'] : [],
    rawEvidenceIds: issuerEvidenceIds,
    holdoutConfirmed: direct,
    acquisitionStatus: 'company_ir_readonly_executed',
    acceptanceVerdict: direct ? 'company_ir_holdout_direct_candidate' : sameDocument ? 'same_document_not_allowed_to_close_issuer_and_holdout' : 'company_ir_holdout_no_direct_result',
    evidenceUse: direct ? 'supporting_context' : 'weak_noise',
    promotionEligible: false,
    failureClassification: direct ? 'ACCEPTED' : 'WEAK_EVIDENCE',
  };
}

function bodyText(row = {}) {
  return compact([
    row.rawTextSnippet,
    row.extractedTextSnippet,
    row.operatingBridgeSnippet,
    row.textExcerpt,
    row.bodyText,
    row.text,
  ].join(' '));
}

function allowedCompanyIrHoldoutSourceGroup(row = {}) {
  return COMPANY_IR_HOLDOUT_ALLOWED_SOURCE_GROUPS.includes(compact(row.sourceGroup || '').toLowerCase());
}

export function findCompanyIrHoldoutValidationBridge(text = '', {
  windowChars = 800,
} = {}) {
  const body = compact(text);
  const bridge = findAbfOperatingProximity(body, { window: windowChars });
  const matchedSubjectTerms = uniqueStrings(
    bridge.matchedBottleneckTerms?.length ? bridge.matchedBottleneckTerms : matchedTerms(body, ABF_BOTTLENECK_TERMS),
    80,
  );
  const matchedOperatingTerms = uniqueStrings(
    bridge.matchedOperatingTerms?.length ? bridge.matchedOperatingTerms : matchedTerms(body, ABF_OPERATING_BRIDGE_TERMS),
    80,
  );
  const operatingBridgeSnippet = bridge.matchedSnippet || excerpt(body, uniqueStrings([matchedSubjectTerms, matchedOperatingTerms], 80), 500);
  return {
    matched: bridge.matched === true,
    matchedSubjectTerms,
    matchedOperatingTerms,
    operatingBridgeSnippet,
    proximityWindow: Number(windowChars || 800),
    proximityScore: bridge.proximityScore || 0,
    proximityDistance: bridge.proximityDistance ?? null,
    matchedLanguage: bridge.matchedLanguage || matchedLanguages([...matchedSubjectTerms, ...matchedOperatingTerms]),
  };
}

export function companyIrHoldoutValidationAcceptanceDetail(row = {}, {
  windowChars = 800,
} = {}) {
  const text = bodyText(row);
  const bridge = findCompanyIrHoldoutValidationBridge(text, { windowChars });
  const rejectionReasons = [];
  if (!allowedCompanyIrHoldoutSourceGroup(row)) rejectionReasons.push('source_group_not_allowed_for_company_ir_holdout');
  if (!text) rejectionReasons.push('body_snippet_missing');
  if (row.tickerOnly === true) rejectionReasons.push('ticker_only');
  if (row.rawMetadataOnly === true || row.isIndexPage === true) rejectionReasons.push('raw_metadata_only');
  if (!compact(row.sourceIndependence)) rejectionReasons.push('source_independence_missing');
  if (!bridge.matchedSubjectTerms.length) rejectionReasons.push('subject_term_missing_in_body');
  if (!bridge.matchedOperatingTerms.length) rejectionReasons.push('operating_bridge_missing_in_body');
  if (bridge.matchedSubjectTerms.length && bridge.matchedOperatingTerms.length && !bridge.matched) {
    rejectionReasons.push('subject_operating_terms_not_proximate');
  }
  return {
    accepted: rejectionReasons.length === 0,
    rejectionReasons,
    matchedSubjectTerms: bridge.matchedSubjectTerms,
    matchedOperatingTerms: bridge.matchedOperatingTerms,
    operatingBridgeSnippet: bridge.operatingBridgeSnippet,
    proximityWindow: bridge.proximityWindow,
    proximityScore: bridge.proximityScore,
    proximityDistance: bridge.proximityDistance,
    matchedLanguage: bridge.matchedLanguage,
  };
}

function companyIrHoldoutFixtureFailureClassification(source = {}, detail = {}) {
  switch (source.fixtureKind) {
    case 'timeout_or_source_unavailable_fixture':
      return 'TIMEOUT';
    case 'no_result_fixture':
      return 'NO_RESULT';
    case 'ticker_only_rejection_fixture':
      return 'TICKER_ONLY';
    case 'raw_metadata_only_rejection_fixture':
      return 'WEAK_EVIDENCE';
    default:
      return detail.accepted ? 'ACCEPTED' : 'WEAK_EVIDENCE';
  }
}

export function buildCompanyIrHoldoutValidationRawEvidence(source = {}, {
  seedId = 'company-ir-holdout-validation-seed',
  taskId = null,
  generatedAt = new Date().toISOString(),
  index = 0,
  windowChars = 800,
} = {}) {
  const rawTextSnippet = compact(source.rawTextSnippet || source.fixtureText || source.extractedTextSnippet || '');
  const sourceIndependence = sourceIndependenceForDoc({
    ...source,
    sourceGroup: source.sourceGroup || 'official_company_ir_holdout',
  });
  const detail = companyIrHoldoutValidationAcceptanceDetail({
    ...source,
    rawTextSnippet,
    sourceIndependence,
  }, { windowChars });
  const failureClassification = source.failureClassification || companyIrHoldoutFixtureFailureClassification(source, detail);
  const accepted = failureClassification === 'ACCEPTED' && detail.accepted;
  const rejectionReason = accepted ? null : uniqueStrings([
    failureClassification,
    detail.rejectionReasons,
  ], 16).join(',');
  const documentTitle = compact(source.documentTitle || source.title || source.fixtureId || `Company IR holdout fixture ${index}`);
  const sourceGroup = source.sourceGroup || 'official_company_ir_holdout';
  const summary = accepted
    ? `Independent company IR holdout bridge: ${detail.operatingBridgeSnippet}`
    : `Company IR holdout fixture rejected: ${rejectionReason || failureClassification}`;

  return {
    evidenceId: `company-ir-readonly:holdout_validation:${seedId}:${source.fixtureId || `fixture-${index}`}`,
    taskId,
    seedId,
    providerName: 'company-ir-readonly',
    evidenceClass: 'holdout_validation',
    desiredEvidenceClass: 'holdout_validation',
    issuer: source.issuer || null,
    issuerName: source.issuerName || null,
    issuerRoleClass: source.issuerRoleClass || null,
    source: 'company-ir-readonly',
    provider: 'company-ir-readonly',
    sourceProvider: 'company-ir-readonly',
    providerRoute: 'company-ir-readonly',
    sourceType: sourceGroup,
    sourceGroup,
    sourceFamily: source.sourceFamily || 'company_ir_document',
    sourceUrl: source.sourceUrl || null,
    url: source.sourceUrl || null,
    documentTitle,
    title: documentTitle,
    documentType: source.documentType || 'company_ir_holdout_fixture',
    documentDate: source.documentDate || source.publishedAt || null,
    publishedAt: source.publishedAt || source.documentDate || null,
    fiscalYear: source.fiscalYear || fiscalYearFrom([documentTitle, source.sourceUrl].join(' ')) || null,
    rawTextSnippet,
    extractedTextSnippet: rawTextSnippet,
    textExcerpt: rawTextSnippet,
    summary,
    matchedSubjectTerms: detail.matchedSubjectTerms,
    matchedBottleneckTerms: detail.matchedSubjectTerms,
    matchedOperatingTerms: detail.matchedOperatingTerms,
    operatingBridgeSnippet: detail.operatingBridgeSnippet,
    sourceIndependence,
    proximityWindow: detail.proximityWindow,
    proximityScore: detail.proximityScore,
    proximityDistance: detail.proximityDistance,
    matchedLanguage: detail.matchedLanguage,
    fixtureKind: source.fixtureKind || source.fixtureId || 'unspecified_fixture',
    fixtureBackedProviderExecution: true,
    validationFixtureOnly: false,
    tickerOnly: source.tickerOnly === true,
    rawMetadataOnly: source.rawMetadataOnly === true,
    failureClassification,
    rejectionReason,
    acceptanceReason: accepted ? 'independent_company_ir_holdout_with_subject_and_operating_bridge' : null,
    acceptanceVerdict: accepted ? 'company_ir_holdout_direct_candidate' : 'not_evaluated_company_ir_holdout_raw',
    accepted,
    holdoutConfirmed: accepted,
    promotionEligible: false,
    evidenceUse: accepted ? 'supporting_context' : 'weak_noise',
    coveredEvidenceClasses: [],
    generatedAt,
    collectedAt: generatedAt,
    mutationBoundary: { ...READONLY_ZERO_MUTATION_BOUNDARY },
  };
}

export function collectCompanyIrHoldoutValidationReadonly({
  seedId = 'company-ir-holdout-validation-seed',
  task = {},
  generatedAt = new Date().toISOString(),
  sourceAllowlist = DEFAULT_COMPANY_IR_HOLDOUT_VALIDATION_FIXTURES,
  maxSources = 5,
  windowChars = 800,
} = {}) {
  const rawEvidence = asArray(sourceAllowlist)
    .slice(0, Number(maxSources || 5))
    .map((source, index) => buildCompanyIrHoldoutValidationRawEvidence(source, {
      seedId: seedId || task.seedId || 'company-ir-holdout-validation-seed',
      taskId: task.taskId || null,
      generatedAt,
      index,
      windowChars,
    }));
  return {
    version: COMPANY_IR_READONLY_VERSION,
    source: 'company-ir-readonly',
    providerName: 'company-ir-readonly',
    evidenceClass: 'holdout_validation',
    rawEvidence,
    sourceGroupsUsed: uniqueStrings(rawEvidence.map((row) => row.sourceGroup), 20),
    sourceFamiliesUsed: uniqueStrings(rawEvidence.map((row) => row.sourceFamily), 20),
    fixtureKindsCovered: uniqueStrings(rawEvidence.map((row) => row.fixtureKind), 20),
    fixtureRequired: false,
    acceptedCandidateCount: rawEvidence.filter((row) => row.accepted === true).length,
    acceptedPromotionCandidateCount: rawEvidence.filter((row) => row.promotionEligible === true).length,
    failureClassifications: rawEvidence.reduce((counts, row) => {
      const key = row.failureClassification || 'WEAK_EVIDENCE';
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
    acceptanceSafety: {
      rawEvidenceAutoPromotes: false,
      tickerOnlyAccepted: false,
      rawMetadataOnlyAccepted: false,
      weakSourceQueryAccepted: false,
    },
    mutationBoundary: { ...READONLY_ZERO_MUTATION_BOUNDARY },
  };
}

function negativeControlRaw(task = {}, seed = {}, docs = [], {
  generatedAt = new Date().toISOString(),
} = {}) {
  const bodyDocs = docs.filter((doc) => doc.documentBodyExtracted === true);
  const combined = bodyDocs.map((doc) => compact([doc.documentTitle, doc.text].join(' '))).join(' ');
  const invalidatorTerms = matchedTerms(combined, ABF_NEGATIVE_CONTROL_TERMS);
  const currentYear = currentYearFrom(generatedAt);
  const freshBodyDocs = bodyDocs.filter((doc) => Number(doc.fiscalYear || 0) >= currentYear - 3 && doc.staleDocument !== true);
  const staleDocumentCount = bodyDocs.filter((doc) => doc.staleDocument === true).length;
  const issuerCount = uniqueStrings(bodyDocs.map((doc) => doc.issuer), 12).length;
  const sourceGroupCount = uniqueStrings(bodyDocs.map((doc) => doc.sourceGroup), 12).length;
  const documentTypeCount = uniqueStrings(bodyDocs.map((doc) => doc.documentType), 12).length;
  const termCoverageCount = bodyDocs.filter((doc) => {
    const text = compact([doc.documentTitle, doc.sourceUrl, doc.text].join(' '));
    return findAbfOperatingProximity(text).matched === true;
  }).length;
  const sufficientScope = bodyDocs.length >= 2
    && freshBodyDocs.length >= 2
    && (issuerCount >= 2 || sourceGroupCount >= 2)
    && documentTypeCount >= 2
    && termCoverageCount >= 2;
  const limitedScope = bodyDocs.length > 0 && termCoverageCount > 0 && !sufficientScope;
  let status = 'INCONCLUSIVE';
  let scope = 'insufficient';
  let evidenceUse = 'weak_noise';
  let acceptanceVerdict = 'company_ir_negative_control_inconclusive';
  let finding = 'inconclusive';
  let failureClassification = 'WEAK_EVIDENCE';
  if (invalidatorTerms.length) {
    status = 'WEAKENED';
    scope = sufficientScope ? 'sufficient' : 'limited';
    evidenceUse = 'negative_control_candidate';
    acceptanceVerdict = 'company_ir_negative_control_invalidator_candidate';
    finding = 'invalidator';
    failureClassification = 'CONTRADICTORY';
  } else if (sufficientScope) {
    status = 'CHECKED_NO_DIRECT_SUFFICIENT_SCOPE';
    scope = 'sufficient';
    evidenceUse = 'negative_control_candidate';
    acceptanceVerdict = 'company_ir_negative_control_checked_no_direct_sufficient_scope';
    finding = 'checked_no_direct_sufficient_scope';
    failureClassification = 'ACCEPTED';
  } else if (limitedScope) {
    status = 'CHECKED_NO_DIRECT_LIMITED_SCOPE';
    scope = 'limited';
    evidenceUse = 'negative_control_candidate';
    acceptanceVerdict = 'company_ir_negative_control_checked_no_direct_limited_scope';
    finding = 'checked_no_direct_limited_scope';
    failureClassification = 'ACCEPTED';
  }
  return {
    ...rawBase(task, seed, {
      issuer: 'ABF_COMPANY_IR_ALLOWLIST',
      issuerName: 'ABF company IR allowlist',
      issuerRoleClass: 'mixed_official_ir',
      sourceUrl: 'company-ir-readonly://abf-substrate-negative-control',
      documentTitle: 'ABF company IR negative-control scan',
      documentType: 'negative_control_scan',
      sourceGroup: 'official_company_ir_negative_control',
    }, generatedAt),
    evidenceId: `company-ir:${safeId(seed.seedId || seed.childSeedId)}:negative:${stableHash(bodyDocs.map((doc) => doc.sourceUrl).join('|'))}`,
    title: 'Company IR negative-control scan',
    summary: invalidatorTerms.length
      ? `Company IR document extraction found possible invalidator terms: ${invalidatorTerms.join(', ')}.`
      : sufficientScope
        ? 'Company IR documents were searched with sufficient scope and no direct invalidator was found.'
        : limitedScope
          ? 'Company IR documents were searched with limited scope and no direct invalidator was found.'
        : 'Company IR document extraction was insufficient to close negative control.',
    textExcerpt: combined.slice(0, 1200),
    extractedTextSnippet: combined.slice(0, 1200),
    negativeControlIntent: true,
    negativeControlFinding: finding,
    negativeControlStatus: status,
    negativeControlScope: scope,
    scannedDocumentCount: docs.length,
    scannedBodyDocumentCount: bodyDocs.length,
    freshBodyDocumentCount: freshBodyDocs.length,
    staleDocumentCount,
    sourceGroupCount,
    issuerCount,
    documentTypeCount,
    termCoverageCount,
    invalidatorTerms,
    extractionStatus: bodyDocs.length ? 'document_text_extracted' : 'insufficient_document_text',
    acquisitionStatus: bodyDocs.length || invalidatorTerms.length ? 'company_ir_readonly_executed' : 'company_ir_search_insufficient',
    acceptanceVerdict,
    evidenceUse,
    promotionEligible: false,
    failureClassification,
  };
}

function issuerDocsForSeed(seed = {}, allowlist = ABF_COMPANY_IR_ALLOWLIST) {
  const allowedIssuers = new Set(uniqueStrings([
    seed.routeIssuerCandidates,
    seed.issuerCandidates,
    seed.issuerUniverse,
  ], 40).map((item) => item.toUpperCase()));
  const roleByIssuer = new Map(asArray(seed.issuerRoleCandidates).map((item) => [
    compact(item.symbol || item.issuerName).toUpperCase(),
    compact(item.roleClass || item.issuerRoleClass || 'unclear'),
  ]));
  return allowlistDocuments(allowlist)
    .filter((doc) => !allowedIssuers.size || allowedIssuers.has(doc.issuer) || roleByIssuer.has(doc.issuer))
    .map((doc) => ({
      ...doc,
      issuerRoleClass: roleByIssuer.get(doc.issuer) || doc.issuerRoleClass,
      isIndexPage: isIndexDocument(doc),
    }));
}

function groupByIssuer(docs = []) {
  const groups = new Map();
  for (const doc of asArray(docs)) {
    const issuer = doc.issuer || 'UNKNOWN';
    if (!groups.has(issuer)) groups.set(issuer, []);
    groups.get(issuer).push(doc);
  }
  return groups;
}

function fallbackRouteForIssuer(issuer = '') {
  const key = compact(issuer).toUpperCase();
  if (['UNICY', 'NANYF', 'KINSF'].includes(key)) return ['taiwan_mops_required', 'company_ir_direct_pdf_required'];
  if (key === 'ATASY') return ['company_ir_direct_pdf_required'];
  if (key === 'IBIDY') return ['edinet_or_ir_pdf_available'];
  return ['company_ir_direct_pdf_required'];
}

function balancedDocumentSelection(selections = [], maxDocuments = 15) {
  const selected = [];
  const issuerQueues = asArray(selections).map((selection) => ({
    issuer: selection.issuer,
    docs: asArray(selection.selectedDocuments),
  })).filter((selection) => selection.docs.length);
  let rank = 0;
  while (selected.length < Number(maxDocuments || 15) && issuerQueues.some((selection) => selection.docs[rank])) {
    for (const selection of issuerQueues) {
      const doc = selection.docs[rank];
      if (!doc) continue;
      selected.push({
        ...doc,
        globalSelectionRank: selected.length + 1,
        selectionReason: doc.selectionReason || 'balanced_by_issuer_and_ranked_by_relevance',
      });
      if (selected.length >= Number(maxDocuments || 15)) break;
    }
    rank += 1;
  }
  return selected;
}

function delay(ms = 0) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export async function collectCompanyIrReadonly({
  seed = {},
  tasks = [],
  allowlist = ABF_COMPANY_IR_ALLOWLIST,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000,
  maxDocuments = 15,
  maxDocumentsPerIssuer = 2,
  rateLimitMs = 100,
  generatedAt = new Date().toISOString(),
} = {}) {
  const byClass = taskByClass(tasks);
  const issuerTask = byClass.get('issuer_exposure');
  const holdoutTask = byClass.get('holdout_validation');
  const negativeTask = byClass.get('negative_control');
  const issuerIndexDocs = issuerDocsForSeed(seed, allowlist);
  const rawEvidence = [];
  const routeRuns = [];
  const fetchedDocs = [];
  const issuerDirectDocuments = [];
  const issuerEvidenceIds = [];
  const resolvedDocuments = [];
  const documentSelectionByIssuer = [];
  let inspectedIndexPageCount = 0;

  for (const indexDoc of issuerIndexDocs) {
    const validation = validateCompanyIrAllowlistUrl(indexDoc.sourceUrl, allowlist);
    if (!validation.allowed) {
      routeRuns.push({ route: 'company-ir-readonly-index', issuer: indexDoc.issuer, sourceUrl: indexDoc.sourceUrl, itemCount: 0, error: validation.reason });
      continue;
    }
    const fetched = await fetchDocumentText(indexDoc.sourceUrl, { fetchImpl, timeoutMs });
    await delay(rateLimitMs);
    const indexText = fetched.text || stripHtml(fetched.rawText || '');
    inspectedIndexPageCount += 1;
    if (issuerTask && indexDoc.isIndexPage) {
      rawEvidence.push(issuerExposureRaw(issuerTask, seed, { ...indexDoc, isIndexPage: true }, {
        text: indexText,
        fetchResult: { ...fetched, documentBodyExtracted: false, extractionStatus: 'index_metadata_only' },
        generatedAt,
      }));
    }
    if (indexDoc.isIndexPage) {
      const links = fetched.ok
        ? resolveCompanyIrDocumentLinks(indexDoc, fetched.rawText || fetched.text || '', { maxDocumentsPerIssuer: 50 })
        : [];
      resolvedDocuments.push(...links);
      routeRuns.push({
        route: 'company-ir-readonly-index',
        issuer: indexDoc.issuer,
        issuerRoleClass: indexDoc.issuerRoleClass,
        sourceUrl: indexDoc.sourceUrl,
        itemCount: links.length,
        resolvedDocumentCount: links.length,
        error: fetched.ok ? null : classifyFetchFailure(fetched.error),
      });
    } else {
      resolvedDocuments.push({ ...indexDoc, isIndexPage: false, resolvedFromIndex: false });
    }
  }

  const groupedResolvedDocuments = groupByIssuer(resolvedDocuments);
  const seenIssuerKeys = uniqueStrings(issuerIndexDocs.map((doc) => doc.issuer), 40);
  for (const issuer of seenIssuerKeys) {
    const docs = groupedResolvedDocuments.get(issuer) || [];
    const ranked = rankCompanyIrDocumentsForIssuer(docs, { generatedAt, maxDocumentsPerIssuer });
    documentSelectionByIssuer.push({
      issuer,
      candidateDocuments: ranked.candidateDocuments,
      selectedDocuments: ranked.selectedDocuments,
      rejectedDocuments: ranked.rejectedDocuments,
      issuerSpecificProviderGap: ranked.selectedDocuments.length
        ? []
        : fallbackRouteForIssuer(issuer),
    });
  }
  const documentsToFetch = balancedDocumentSelection(documentSelectionByIssuer, maxDocuments);

  for (const doc of documentsToFetch.slice(0, Math.max(1, Number(maxDocuments || 15)))) {
    const fetched = await fetchDocumentText(doc.sourceUrl, { fetchImpl, timeoutMs });
    await delay(rateLimitMs);
    const text = fetched.text || '';
    const fetchedDoc = {
      ...doc,
      text,
      fetchResult: fetched,
      documentBodyExtracted: fetched.documentBodyExtracted === true,
      extractionStatus: fetched.extractionStatus,
    };
    fetchedDocs.push(fetchedDoc);
    if (issuerTask && issuerDirectDocuments.length === 0) {
      const row = issuerExposureRaw(issuerTask, seed, fetchedDoc, {
        text,
        fetchResult: fetched,
        generatedAt,
      });
      rawEvidence.push(row);
      if (row.promotionEligible === true) {
        issuerDirectDocuments.push({
          sourceUrl: row.sourceUrl,
          sourceGroup: row.sourceGroup,
          documentType: row.documentType,
        });
        issuerEvidenceIds.push(row.evidenceId);
      }
      routeRuns.push({
        route: 'company-ir-readonly-document',
        issuer: doc.issuer,
        issuerRoleClass: doc.issuerRoleClass,
        sourceUrl: doc.sourceUrl,
        documentType: doc.documentType,
        itemCount: row.promotionEligible === true ? 1 : 0,
        acceptedCandidate: row.promotionEligible === true,
        extractionStatus: row.extractionStatus,
        error: row.promotionEligible === true ? null : row.failureClassification,
      });
    } else if (issuerTask) {
      routeRuns.push({
        route: 'company-ir-readonly-document',
        issuer: doc.issuer,
        issuerRoleClass: doc.issuerRoleClass,
        sourceUrl: doc.sourceUrl,
        documentType: doc.documentType,
        itemCount: 0,
        acceptedCandidate: false,
        extractionStatus: fetched.extractionStatus,
        reservedForHoldout: true,
        error: 'reserved_for_independent_holdout_document',
      });
    }
  }

  if (holdoutTask) {
    const holdoutDocs = fetchedDocs.filter((doc) => !issuerDirectDocuments.some((issuerDoc) => (
      issuerDoc.sourceUrl === doc.sourceUrl
      || (issuerDoc.sourceGroup === doc.sourceGroup && issuerDoc.documentType === doc.documentType)
    )));
    for (const doc of holdoutDocs) {
      rawEvidence.push(holdoutRaw(holdoutTask, seed, doc, {
        text: doc.text,
        issuerEvidenceIds,
        issuerDirectDocuments,
        generatedAt,
      }));
    }
    if (!holdoutDocs.length) {
      routeRuns.push({ route: 'company-ir-readonly-holdout', itemCount: 0, error: 'same_document_or_document_type_not_allowed_to_close_issuer_and_holdout' });
    }
  }

  if (negativeTask) {
    rawEvidence.push(negativeControlRaw(negativeTask, seed, fetchedDocs, { generatedAt }));
  }

  const fetchedByUrl = new Map(fetchedDocs.map((doc) => [doc.sourceUrl, doc]));
  const documentSelection = {
    issuers: documentSelectionByIssuer.map((issuerSelection) => ({
      issuer: issuerSelection.issuer,
      issuerSpecificProviderGap: issuerSelection.issuerSpecificProviderGap || [],
      candidateDocuments: issuerSelection.candidateDocuments,
      selectedDocuments: issuerSelection.selectedDocuments.map((doc) => {
        const fetched = fetchedByUrl.get(doc.sourceUrl);
        const fields = fetched ? documentExtractionFields(fetched, fetched.text || '', fetched.fetchResult || {}) : {};
        return {
          ...doc,
          matchedSnippetTerms: fields.matchedSnippetTerms || doc.matchedSnippetTerms || [],
          matchedBottleneckTerms: fields.matchedBottleneckTerms || [],
          matchedOperatingTerms: fields.matchedOperatingTerms || [],
          matchedLanguage: fields.matchedLanguage || doc.matchedLanguage || [],
          proximityWindow: fields.proximityWindow || null,
          proximityScore: fields.proximityScore || 0,
          proximityMatch: fields.proximityMatch === true,
          proximityMatches: fields.proximityMatches || [],
          matchedSnippet: fields.proximityMatchedSnippet || fields.extractedTextSnippet || '',
          extractionStatus: fetched?.extractionStatus || null,
          failureClassification: fetched?.fetchResult?.ok === false ? classifyFetchFailure(fetched.fetchResult.error) : null,
        };
      }),
      rejectedDocuments: issuerSelection.rejectedDocuments,
    })),
  };
  const flatCandidateDocuments = documentSelection.issuers.flatMap((item) => item.candidateDocuments);
  const flatSelectedDocuments = documentSelection.issuers.flatMap((item) => item.selectedDocuments);
  const flatRejectedDocuments = documentSelection.issuers.flatMap((item) => item.rejectedDocuments);
  const latestDocumentYear = Math.max(0, ...flatSelectedDocuments.map((doc) => Number(doc.fiscalYear || 0)));
  const staleDocumentCount = flatSelectedDocuments.filter((doc) => doc.staleDocument === true).length;
  const selectedIssuerCounts = new Map();
  for (const doc of flatSelectedDocuments) selectedIssuerCounts.set(doc.issuer, (selectedIssuerCounts.get(doc.issuer) || 0) + 1);
  const maxIssuerShare = flatSelectedDocuments.length
    ? Math.max(0, ...[...selectedIssuerCounts.values()]) / flatSelectedDocuments.length
    : 0;
  const issuerCoverageSkew = maxIssuerShare > 0.6;
  const issuerDocumentCoverage = documentSelection.issuers.map((item) => {
    const fetchedForIssuer = fetchedDocs.filter((doc) => doc.issuer === item.issuer);
    const rawForIssuer = rawEvidence.filter((row) => row.issuer === item.issuer);
    const acceptedForIssuer = rawForIssuer.filter((row) => row.promotionEligible === true);
    return {
      issuer: item.issuer,
      candidateDocumentCount: item.candidateDocuments.length,
      selectedDocumentCount: item.selectedDocuments.length,
      fetchedDocumentCount: fetchedForIssuer.length,
      acceptedCandidateCount: acceptedForIssuer.length,
      latestDocumentYear: Math.max(0, ...item.selectedDocuments.map((doc) => Number(doc.fiscalYear || 0))) || null,
      documentTypes: uniqueStrings(item.selectedDocuments.map((doc) => doc.documentType), 12),
      issuerSpecificProviderGap: item.issuerSpecificProviderGap || [],
    };
  });
  const missingIssuerDocuments = issuerDocumentCoverage
    .filter((item) => item.selectedDocumentCount === 0)
    .map((item) => item.issuer);
  const issuerSpecificProviderGap = issuerDocumentCoverage
    .filter((item) => item.issuerSpecificProviderGap.length)
    .map((item) => ({
      issuer: item.issuer,
      providerGap: item.issuerSpecificProviderGap,
    }));
  const proximityMatches = flatSelectedDocuments.flatMap((doc) => doc.proximityMatches || []);
  const multilingualTermMatches = uniqueStrings(flatSelectedDocuments.flatMap((doc) => [
    doc.matchedLanguage,
    doc.matchedBottleneckTerms,
    doc.matchedOperatingTerms,
  ]), 120);

  const status = {
    ok: true,
    version: COMPANY_IR_READONLY_VERSION,
    providerExecution: false,
    readOnly: true,
    allowlistOnly: true,
    issuerCount: new Set(issuerIndexDocs.map((doc) => doc.issuer)).size,
    inspectedIndexPageCount,
    resolvedDocumentCount: resolvedDocuments.length,
    processedDocumentCount: fetchedDocs.length,
    inspectedDocumentCount: fetchedDocs.length,
    maxDocumentsPerIssuer,
    selectedDocumentCount: flatSelectedDocuments.length,
    staleDocumentCount,
    latestDocumentYear: latestDocumentYear || null,
    issuerDocumentCoverage,
    missingIssuerDocuments,
    issuerCoverageSkew,
    issuerCoverageSkewWarning: issuerCoverageSkew ? 'issuer_coverage_skew' : null,
    issuerSpecificProviderGap,
    multilingualTermMatches,
    proximityMatches,
    documentSelection,
    candidateDocuments: flatCandidateDocuments,
    selectedDocuments: flatSelectedDocuments,
    rejectedDocuments: flatRejectedDocuments,
    rawEvidenceCount: rawEvidence.length,
    acceptedCandidateCount: rawEvidence.filter((row) => row.promotionEligible === true).length,
    failureModes: uniqueStrings(rawEvidence.map((row) => row.failureClassification), 20),
    mutationBoundary: {
      providerActivationWrites: 0,
      sourceRegistryWrites: 0,
      canonicalWrites: 0,
      approvalQueueWrites: 0,
      reportPromotionWrites: 0,
    },
  };

  return {
    ok: true,
    source: 'company-ir-readonly',
    companyIrCollectorStatus: status,
    rawEvidence,
    routeRuns,
    queryCount: routeRuns.length,
    resultCount: rawEvidence.length,
  };
}
