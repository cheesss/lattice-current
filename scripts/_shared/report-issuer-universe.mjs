import {
  filterIssuerSymbols,
  resolveThemeOntology,
} from './theme-ontology.mjs';
import {
  buildIssuerDiscoveryMap,
  candidateIssuerUniverseFromMap,
  issuerDiscoverySummary,
} from './report-issuer-discovery-map.mjs';
import { isStrictEndogenousBundle } from './cross-theme-discovery-quality.mjs';

const LEGACY_ISSUER_ALIASES = Object.freeze({
  AJRD: { symbol: 'LHX', entity: 'Aerojet Rocketdyne', reason: 'acquired_issuer_legacy_symbol' },
  'AEROJET ROCKETDYNE': { symbol: 'LHX', entity: 'Aerojet Rocketdyne', reason: 'acquired_issuer_legacy_entity' },
  AEROJET: { symbol: 'LHX', entity: 'Aerojet Rocketdyne', reason: 'acquired_issuer_legacy_entity' },
});

const SYMBOL_FIELD_PATTERN = /^(symbol|ticker|symbols|tickers|issuerUniverse|issuerSymbols|issuerUniverseSymbols)$/i;
const PACK_SYMBOL_FIELD_PATTERN = /^(symbol|ticker|symbols|tickers|issuerSymbols)$/i;
const SYMBOL_TEXT_STOPLIST = new Set([
  'SEC', 'API', 'RSS', 'ETF', 'FX', 'USD', 'CPI', 'GDP', 'FRED', 'EIA', 'FMP',
  'AI', 'ML', 'OS', 'DB', 'NATO', 'EU', 'UN', 'US', 'USA', 'DOD', 'MOD',
  'MW', 'LLM', 'ARR', 'NRR', 'FY', 'Q1', 'Q2', 'Q3', 'Q4',
]);
const ISSUER_REQUIRED_CLASSES = new Set([
  'issuer_commentary',
  'primary_filing',
  'issuer_exposure',
  'capex_confirmation',
  'cloud_revenue',
  'market_validation',
  'budget_signal',
  'vendor_exposure',
  'pipeline_exposure',
]);
const DIRECT_ISSUER_DISCOVERY_STATUSES = new Set([
  'issuer_exposure_attached',
  'direct_node_exposure_attached',
]);

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slug(value) {
  return compact(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function unique(values = [], normalizer = (value) => compact(value)) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const item = normalizer(value);
    if (!item) continue;
    const key = String(item).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function addSource(map, symbol, source, detail = {}) {
  const ticker = compact(symbol).toUpperCase();
  if (!ticker || SYMBOL_TEXT_STOPLIST.has(ticker)) return;
  if (!map.has(ticker)) map.set(ticker, []);
  const entry = { source, ...detail };
  const key = JSON.stringify(entry);
  if (!map.get(ticker).some((item) => JSON.stringify(item) === key)) {
    map.get(ticker).push(entry);
  }
}

function symbolCandidatesFromPrimitive(value) {
  if (value == null) return [];
  if (typeof value === 'number') return [];
  const text = compact(value).toUpperCase();
  if (!text) return [];
  if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(text)) return [text];
  return [];
}

function collectSymbolsFromField(value, sourceMap, source, detail = {}) {
  for (const item of asArray(value)) {
    if (item && typeof item === 'object') {
      for (const key of ['symbol', 'ticker']) {
        for (const symbol of symbolCandidatesFromPrimitive(item[key])) addSource(sourceMap, symbol, source, detail);
      }
      continue;
    }
    for (const symbol of symbolCandidatesFromPrimitive(item)) addSource(sourceMap, symbol, source, detail);
  }
}

function walkForSymbolFields(value, sourceMap, source, depth = 0, pattern = SYMBOL_FIELD_PATTERN, path = [], skipPattern = null) {
  if (!value || depth > 9 || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      walkForSymbolFields(item, sourceMap, source, depth + 1, pattern, [...path, String(index)], skipPattern);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (skipPattern?.test(key)) continue;
    const nextPath = [...path, key];
    if (pattern.test(key)) collectSymbolsFromField(child, sourceMap, source, { field: key, path: nextPath.join('.') });
    walkForSymbolFields(child, sourceMap, source, depth + 1, pattern, nextPath, skipPattern);
  }
}

function findDeepResearchObjects(value, depth = 0, out = []) {
  if (!value || depth > 8 || typeof value !== 'object') return out;
  if (value.deepResearch && typeof value.deepResearch === 'object') out.push(value.deepResearch);
  if (value.deepResearchPack && typeof value.deepResearchPack === 'object') out.push(value.deepResearchPack);
  for (const child of Object.values(value)) findDeepResearchObjects(child, depth + 1, out);
  return out;
}

function currentIssuerDiscoveryRows(bundle = {}) {
  const reusableTopLevelStatuses = new Set([
    'issuer_exposure_attached',
    'direct_node_exposure_attached',
    'market_attached',
    'probable_exposure',
    'frontier_node_candidate',
  ]);
  const topLevelRows = asArray(bundle.metadata?.issuerDiscoveryMap)
    .filter((row) => reusableTopLevelStatuses.has(String(row?.status || '').toLowerCase()))
    .map((row) => ({
      ...row,
      metadata: {
        ...(row?.metadata || {}),
        currentIssuerDiscoveryMap: true,
      },
    }));
  const rows = [];
  rows.push(...topLevelRows);
  for (const item of [
    bundle.metadata?.deepResearch,
    bundle.metadata?.deepResearchPack,
    bundle.deepResearch,
    bundle.deepResearchPack,
  ].filter(Boolean)) {
    rows.push(...asArray(item.packs?.issuerDiscoveryPack?.rows));
    rows.push(...asArray(item.issuerDiscoveryPack?.rows));
    rows.push(...asArray(item.crossThemeActionBridge?.autoDiscoveredIssuers));
  }
  return rows;
}

function symbolsFromIssuerRows(rows = [], predicate = () => true) {
  const symbols = [];
  for (const row of asArray(rows)) {
    if (!row || !predicate(row)) continue;
    for (const symbol of [
      row.symbol,
      row.ticker,
      row.issuerSymbol,
      row.metadata?.symbol,
      row.metadata?.issuerSymbol,
    ].flatMap(symbolCandidatesFromPrimitive)) {
      symbols.push(symbol);
    }
  }
  return filterIssuerSymbols(symbols);
}

function rowHasDirectIssuerBridge(row = {}) {
  return row.promotionEligible === true
    || DIRECT_ISSUER_DISCOVERY_STATUSES.has(String(row.status || '').toLowerCase());
}

function collectText(value, depth = 0, out = []) {
  if (!value || depth > 6) return out;
  if (typeof value === 'string' || typeof value === 'number') {
    const text = compact(value);
    if (text) out.push(text);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, depth + 1, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const key of ['displayName', 'title', 'name', 'connector', 'mechanism', 'whyNow', 'query', 'nextQuery', 'sourceQueries', 'triggerTerms', 'discovery']) {
      collectText(value[key], depth + 1, out);
    }
  }
  return out;
}

function reportThemes(artifact = {}) {
  const bundle = artifact.bundle || artifact;
  const subject = bundle.subject || {};
  const metadata = subject.metadata || {};
  return unique([
    subject.theme,
    subject.themeKey,
    subject.subjectType === 'theme' ? subject.subjectId : null,
    metadata.theme,
    metadata.themeKey,
    metadata.primaryTheme,
    ...asArray(metadata.themes),
    ...asArray(bundle.metadata?.candidate?.themes),
    ...asArray(bundle.metadata?.themeContext?.themes),
    ...asArray(artifact.manifest?.themes),
    artifact.manifest?.theme,
    artifact.manifest?.themeKey,
  ]).filter((theme) => !/^(cross-theme|report)$/i.test(theme));
}

function reportSubjectText(artifact = {}) {
  const bundle = artifact.bundle || artifact;
  return compact(
    bundle.subject?.displayName ||
    bundle.subject?.display ||
    bundle.subject?.title ||
    bundle.subject?.subjectId ||
    artifact.manifest?.subject ||
    artifact.reportId ||
    'report',
  );
}

function reportRelevanceText(artifact = {}) {
  const bundle = artifact.bundle || artifact;
  const deepResearch = findDeepResearchObjects(bundle);
  const parts = [
    reportSubjectText(artifact),
    ...collectText(bundle.subject?.metadata || {}),
    ...collectText(bundle.metadata?.candidate || {}),
    ...collectText(bundle.evidence || []),
    ...deepResearch.flatMap((item) => collectText({
      actionBridge: item.actionBridge,
      crossThemeActionBridge: item.crossThemeActionBridge,
      evidenceClassMatrix: item.evidenceClassMatrix,
      universalEvidenceContract: item.universalEvidenceContract,
    })),
  ];
  return unique(parts).join(' ').toLowerCase();
}

function collectExplicitReportSymbols(artifact = {}, sourceMap) {
  const bundle = artifact.bundle || artifact;
  collectSymbolsFromField(bundle.subject?.symbol, sourceMap, 'subject');
  collectSymbolsFromField(bundle.subject?.ticker, sourceMap, 'subject');
  collectSymbolsFromField(bundle.subject?.subjectType === 'symbol' ? bundle.subject?.subjectId : null, sourceMap, 'subject');
  const skipNestedMarkets = /^(marketValidation|marketReactions|matchedControls|eventUplift)$/i;
  walkForSymbolFields({
    symbols: bundle.symbols,
    issuerUniverse: bundle.issuerUniverse,
    metadataSymbols: bundle.metadata?.symbols,
    candidateSymbols: bundle.metadata?.candidate?.symbols,
    themeContext: bundle.metadata?.themeContext,
    manifest: artifact.manifest,
    validation: artifact.validation?.report,
  }, sourceMap, 'report-explicit', 0, SYMBOL_FIELD_PATTERN, [], skipNestedMarkets);
}

function collectPackSymbols(artifact = {}, sourceMap) {
  const bundle = artifact.bundle || artifact;
  const skipNestedMarkets = /^(marketPack|marketValidation|marketReactions|reportClosureLedger|matchedControls|eventUplift)$/i;
  for (const item of findDeepResearchObjects(bundle)) {
    walkForSymbolFields(item.packs || item, sourceMap, 'report-pack', 0, PACK_SYMBOL_FIELD_PATTERN, [], skipNestedMarkets);
  }
  walkForSymbolFields(bundle.claims || [], sourceMap, 'report-pack', 0, PACK_SYMBOL_FIELD_PATTERN, [], skipNestedMarkets);
}

function keepIssuerSource(symbol, sources = []) {
  if (sources.some((source) => source.source !== 'report-pack')) return true;
  return sources.some((source) => {
    const field = compact(source.field).toLowerCase();
    const pathText = compact(source.path).toLowerCase();
    if (['symbols', 'tickers', 'issuersymbols'].includes(field)) return true;
    return /fundamental|issuer|transcript|filing|exposure|company|contract|procurement|supplier/.test(pathText);
  });
}

function termMatches(text, values = []) {
  const haystack = compact(text).toLowerCase();
  return asArray(values).some((value) => {
    const needle = compact(value).toLowerCase();
    return needle.length >= 3 && haystack.includes(needle);
  });
}

function collectOntologySupplierSymbols(artifact = {}, sourceMap, relevanceText) {
  for (const theme of reportThemes(artifact)) {
    const ontology = resolveThemeOntology({ themeId: theme, themeLabel: theme });
    for (const supplier of asArray(ontology.discovery?.suppliers)) {
      const symbol = supplier.symbol || supplier.ticker;
      if (!symbol) continue;
      const names = unique([
        supplier.name,
        supplier.label,
        ...asArray(supplier.aliases),
      ]);
      if (termMatches(relevanceText, names) || termMatches(relevanceText, [symbol])) {
        addSource(sourceMap, symbol, 'ontology-supplier', {
          theme,
          ontologyKey: ontology.key,
          issuerName: supplier.name || supplier.label || null,
        });
      }
    }
  }
}

export function resolveIssuerAliases(value = '') {
  const text = compact(Array.isArray(value) ? value.join(' ') : value).toUpperCase();
  const mappings = [];
  const sourceMap = new Map();
  for (const [alias, mapping] of Object.entries(LEGACY_ISSUER_ALIASES)) {
    const aliasPattern = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^A-Z0-9])${aliasPattern}([^A-Z0-9]|$)`, 'i').test(text)) {
      mappings.push({ alias, ...mapping });
      addSource(sourceMap, mapping.symbol, 'legacy-alias', { alias, entity: mapping.entity, reason: mapping.reason });
    }
  }
  return {
    symbols: filterIssuerSymbols([...sourceMap.keys()]),
    legacyMappings: mappings,
  };
}

export function resolveReportIssuerUniverse(artifact = {}, options = {}) {
  const bundle = artifact.bundle || artifact;
  const strictEndogenous = Boolean(options.strictEndogenous) || isStrictEndogenousBundle(bundle);
  const candidateSummary = bundle.metadata?.candidate?.evidence_summary || bundle.metadata?.candidate?.evidenceSummary || {};
  const candidateMetadata = bundle.metadata?.candidate?.metadata || {};
  const subjectDiscovery = bundle.subject?.metadata?.discovery || {};
  const subjectKey = compact(bundle.subject?.subjectId || bundle.subject?.metadata?.candidateId || subjectDiscovery.adjacentCandidateKey).toLowerCase();
  const frontierParentScoped = Boolean(
    candidateSummary.frontierParentCollectionEligible
    || candidateSummary.frontierParentReportReady
    || candidateMetadata.frontierParentCollectionEligible
    || candidateMetadata.frontierParentReportReady
    || subjectKey.startsWith('endogenous-frontier-parent-')
  );
  if (strictEndogenous || frontierParentScoped) {
    const currentRows = currentIssuerDiscoveryRows(bundle);
    const strictArtifact = {
      bundle: {
        reportId: bundle.reportId,
        reportType: bundle.reportType,
        subject: bundle.subject,
        metadata: {
          candidate: bundle.metadata?.candidate,
          adjacentCandidate: bundle.metadata?.adjacentCandidate,
          frontierDiscovery: strictEndogenous || frontierParentScoped,
          theme: bundle.metadata?.theme,
          themeKey: bundle.metadata?.themeKey,
          deepResearch: {
            ontologyPack: bundle.metadata?.deepResearch?.ontologyPack,
          },
        },
      },
      manifest: artifact.manifest,
    };
    const promotionEligibleSymbols = filterIssuerSymbols(unique([
      ...asArray(options.promotionEligibleSymbols),
      ...symbolsFromIssuerRows(currentRows, rowHasDirectIssuerBridge),
    ], (symbol) => String(symbol || '').toUpperCase()), options);
    const issuerDiscoveryMap = buildIssuerDiscoveryMap({
      artifact: strictArtifact,
      rows: { research: currentRows },
      candidateIssuerUniverse: asArray(options.candidateIssuerUniverse),
      promotionEligibleSymbols,
      strictEndogenous: true,
    });
    const collectionEligibleIssuerRows = issuerDiscoveryMap.filter((row) => {
      const status = String(row.status || '').toLowerCase();
      if (status === 'rejected_or_invalidated') return false;
      if (status !== 'suppressed_consensus_issuer') return true;
      const sourceTypes = new Set(asArray(row.sourceTypes).map((source) => String(source || '').toLowerCase()));
      return sourceTypes.has('evidence_row') || sourceTypes.has('provider_route_plan');
    });
    const candidateIssuerUniverse = unique([
      ...candidateIssuerUniverseFromMap(collectionEligibleIssuerRows),
      ...asArray(options.candidateIssuerUniverse),
    ], (symbol) => String(symbol || '').toUpperCase());
    const issuerUniverse = filterIssuerSymbols(unique([
      ...promotionEligibleSymbols,
      ...candidateIssuerUniverseFromMap(issuerDiscoveryMap.filter((row) => rowHasDirectIssuerBridge(row))),
    ], (symbol) => String(symbol || '').toUpperCase()), options);
    const collectionUniverse = filterIssuerSymbols(unique([
      ...issuerUniverse,
      ...candidateIssuerUniverse,
    ], (symbol) => String(symbol || '').toUpperCase()), options);
    return {
      issuerUniverse,
      symbols: issuerUniverse,
      candidateIssuerUniverse,
      collectionUniverse,
      promotionEligibleSymbols,
      issuerDiscoveryMap,
      issuerBridgeSummary: issuerDiscoverySummary(issuerDiscoveryMap),
      sources: Object.fromEntries(issuerUniverse.map((symbol) => [symbol, [{ source: 'strict-current-issuer-bridge' }]])),
      candidateSources: Object.fromEntries(issuerDiscoveryMap.map((row) => [row.symbol, row.sourceTypes || []])),
      excludedSymbols: [],
      legacyMappings: [],
      themes: reportThemes(artifact),
      subject: reportSubjectText(artifact),
      eventTerms: unique([
        reportSubjectText(artifact),
        ...collectText(bundle.subject?.metadata?.discovery || {}),
      ]).slice(0, 16),
      empty: collectionUniverse.length === 0,
      reason: collectionUniverse.length
        ? (issuerUniverse.length ? 'resolved' : 'candidate_universe_only')
        : 'no_issuer_universe',
      strictEndogenous: Boolean(strictEndogenous),
      frontierParentScoped,
      version: 'report-issuer-universe-v1',
    };
  }
  const sourceMap = new Map();
  collectExplicitReportSymbols(artifact, sourceMap);
  collectPackSymbols(artifact, sourceMap);

  const relevanceText = reportRelevanceText(artifact);
  collectOntologySupplierSymbols(artifact, sourceMap, relevanceText);
  const aliasResolution = resolveIssuerAliases(relevanceText);
  for (const mapping of aliasResolution.legacyMappings) {
    addSource(sourceMap, mapping.symbol, 'legacy-alias', {
      alias: mapping.alias,
      entity: mapping.entity,
      reason: mapping.reason,
    });
  }
  for (const symbol of asArray(options.issuerUniverse)) addSource(sourceMap, symbol, 'options');

  const scopedSymbols = [...sourceMap.keys()]
    .filter((symbol) => keepIssuerSource(symbol, sourceMap.get(symbol) || []));
  const filtered = filterIssuerSymbols(scopedSymbols, options);
  const issuerUniverse = unique(filtered, (symbol) => String(symbol || '').toUpperCase());
  const excludedSymbols = [...sourceMap.keys()].filter((symbol) => !issuerUniverse.includes(symbol));
  const issuerDiscoveryMap = buildIssuerDiscoveryMap({
    artifact,
    candidateIssuerUniverse: [
      ...issuerUniverse,
      ...asArray(options.candidateIssuerUniverse),
    ],
    promotionEligibleSymbols: options.promotionEligibleSymbols || [],
  });
  const candidateIssuerUniverse = unique([
    ...candidateIssuerUniverseFromMap(issuerDiscoveryMap),
    ...asArray(options.candidateIssuerUniverse),
  ], (symbol) => String(symbol || '').toUpperCase());
  return {
    issuerUniverse,
    symbols: issuerUniverse,
    candidateIssuerUniverse,
    collectionUniverse: unique([...issuerUniverse, ...candidateIssuerUniverse], (symbol) => String(symbol || '').toUpperCase()),
    promotionEligibleSymbols: filterIssuerSymbols(options.promotionEligibleSymbols || [], options),
    issuerDiscoveryMap,
    issuerBridgeSummary: issuerDiscoverySummary(issuerDiscoveryMap),
    sources: Object.fromEntries(issuerUniverse.map((symbol) => [symbol, sourceMap.get(symbol) || []])),
    candidateSources: Object.fromEntries(issuerDiscoveryMap.map((row) => [row.symbol, row.sourceTypes || []])),
    excludedSymbols,
    legacyMappings: aliasResolution.legacyMappings,
    themes: reportThemes(artifact),
    subject: reportSubjectText(artifact),
    eventTerms: unique([
      reportSubjectText(artifact),
      ...collectText((artifact.bundle || artifact).subject?.metadata?.discovery || {}),
    ]).slice(0, 16),
    empty: issuerUniverse.length === 0,
    reason: issuerUniverse.length ? 'resolved' : 'no_issuer_universe',
    version: 'report-issuer-universe-v1',
  };
}

export function issuerUniverseForEvidenceClass(evidenceClass = '', artifactOrResolution = {}, options = {}) {
  const normalizedClass = slug(evidenceClass);
  const resolution = Array.isArray(artifactOrResolution?.issuerUniverse) || artifactOrResolution?.version === 'report-issuer-universe-v1'
    ? artifactOrResolution
    : resolveReportIssuerUniverse(artifactOrResolution, options);
  const issuerUniverse = filterIssuerSymbols(resolution.issuerUniverse || resolution.symbols || [], options);
  const candidateIssuerUniverse = filterIssuerSymbols(resolution.candidateIssuerUniverse || [], options);
  const promotionUniverse = Array.isArray(resolution.promotionEligibleSymbols)
    ? filterIssuerSymbols(resolution.promotionEligibleSymbols, options)
    : issuerUniverse;
  const marketValidationNeedsDirectBridge = normalizedClass === 'market_validation';
  const collectionUniverse = marketValidationNeedsDirectBridge
    ? filterIssuerSymbols(unique([
      ...promotionUniverse,
      ...issuerUniverse,
    ]), options)
    : filterIssuerSymbols(unique([
      ...promotionUniverse,
      ...issuerUniverse,
      ...candidateIssuerUniverse,
      ...asArray(resolution.collectionUniverse),
    ]), options);
  const requiresIssuerUniverse = ISSUER_REQUIRED_CLASSES.has(normalizedClass);
  return {
    evidenceClass: normalizedClass,
    issuerUniverse,
    candidateIssuerUniverse,
    collectionUniverse,
    promotionUniverse,
    requiresIssuerUniverse,
    blocked: requiresIssuerUniverse && collectionUniverse.length === 0,
    blockedReason: requiresIssuerUniverse && collectionUniverse.length === 0 ? 'blocked_missing_issuer_universe' : null,
    resolution,
  };
}

export const __test = {
  LEGACY_ISSUER_ALIASES,
  reportThemes,
  reportRelevanceText,
};
