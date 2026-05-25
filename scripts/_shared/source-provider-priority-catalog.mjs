import {
  buildSourceProviderManifestRegistry,
  providerSpecsFromManifestRegistry,
} from './source-provider-manifest-registry.mjs';

export const SOURCE_PROVIDER_PRIORITY_CATALOG_VERSION = 'source-provider-priority-catalog-v1';

const PRIORITY_PROVIDER_SPECS = Object.freeze([
  {
    providerName: 'company_ir_direct_pdf',
    fillsEvidenceClasses: ['issuer_exposure', 'holdout_validation'],
    sourceType: 'official_company_ir',
    providerRoute: 'company_ir_direct_pdf',
    authRequired: false,
    apiKeyRequired: false,
    fixtureRequired: true,
    fixtureRequirement: 'issuer allowlist PDF fixture with body text, no-result, stale-document, and ticker-only cases',
    parserOutputSchema: {
      type: 'company_ir_document_evidence',
      requiredFields: ['issuer', 'sourceUrl', 'documentTitle', 'documentType', 'publishedAt', 'extractedTextSnippet', 'desiredEvidenceClass', 'evidenceUse'],
    },
    allowlist: ['issuer_ir_index_page', 'official_company_pdf', 'annual_report', 'ir_presentation', 'earnings_presentation'],
    healthCheckCommand: 'node --import tsx scripts/run-seed-bias-evidence-acquisition.mjs --dry-run --evidence-class issuer_exposure --source company_ir_direct_pdf --limit 1',
    testCommand: 'node --import tsx --test tests/company-ir-readonly.test.mjs',
    failureModes: ['SOURCE_UNAVAILABLE', 'TIMEOUT', 'WEAK_EVIDENCE', 'TICKER_ONLY', 'NO_RESULT', 'provider_rate_limited', 'parser_error'],
  },
  {
    providerName: 'taiwan_mops',
    fillsEvidenceClasses: ['issuer_exposure', 'holdout_validation', 'primary_filing'],
    sourceType: 'non_us_official_filing',
    providerRoute: 'taiwan_mops',
    authRequired: false,
    apiKeyRequired: false,
    fixtureRequired: true,
    fixtureRequirement: 'Taiwan MOPS annual report / material information fixture with issuer identifier mapping and no-result case',
    parserOutputSchema: {
      type: 'official_filing_evidence',
      requiredFields: ['provider', 'issuer', 'sourceUrl', 'title', 'publishedAt', 'desiredEvidenceClass', 'evidenceUse', 'metadata'],
    },
    allowlist: ['mops.twse.com.tw', 'mopsov.twse.com.tw'],
    healthCheckCommand: 'node --import tsx scripts/collect-free-external-data.mjs --providers taiwan_mops --limit 1 --dry-run',
    testCommand: 'node --import tsx --test tests/provider-adapter-taiwan-mops.test.mjs',
    failureModes: ['SOURCE_UNAVAILABLE', 'TIMEOUT', 'TICKER_ONLY', 'NO_RESULT', 'identifier_mapping_missing', 'provider_rate_limited', 'parser_error'],
  },
  {
    providerName: 'edinet',
    fillsEvidenceClasses: ['issuer_exposure', 'issuer_commentary', 'primary_filing', 'supplier_capacity'],
    sourceType: 'non_us_official_filing',
    providerRoute: 'edinet',
    authRequired: false,
    apiKeyRequired: false,
    fixtureRequired: true,
    fixtureRequirement: 'EDINET annual securities report fixture with Japanese issuer identifier mapping and rate-limit case',
    parserOutputSchema: {
      type: 'official_filing_evidence',
      requiredFields: ['provider', 'issuer', 'sourceUrl', 'title', 'publishedAt', 'desiredEvidenceClass', 'evidenceUse', 'metadata'],
    },
    allowlist: ['disclosure2.edinet-fsa.go.jp'],
    healthCheckCommand: 'node --import tsx scripts/collect-free-external-data.mjs --providers edinet --limit 1 --dry-run',
    testCommand: 'node --import tsx --test tests/provider-adapter-edinet.test.mjs',
    failureModes: ['SOURCE_UNAVAILABLE', 'TIMEOUT', 'TICKER_ONLY', 'NO_RESULT', 'identifier_mapping_missing', 'provider_rate_limited', 'parser_error'],
  },
  {
    providerName: 'tdnet',
    fillsEvidenceClasses: ['issuer_exposure', 'issuer_commentary', 'primary_filing', 'supplier_capacity'],
    sourceType: 'non_us_official_disclosure',
    providerRoute: 'tdnet',
    authRequired: false,
    apiKeyRequired: false,
    fixtureRequired: true,
    fixtureRequirement: 'TDnet timely disclosure listing/PDF fixture with issuer mapping and no-match case',
    parserOutputSchema: {
      type: 'official_disclosure_evidence',
      requiredFields: ['provider', 'issuer', 'sourceUrl', 'title', 'publishedAt', 'desiredEvidenceClass', 'evidenceUse', 'metadata'],
    },
    allowlist: ['tdnet-pdf.kabutan.jp', 'www.release.tdnet.info'],
    healthCheckCommand: 'node --import tsx scripts/collect-free-external-data.mjs --providers tdnet --limit 1 --dry-run',
    testCommand: 'node --import tsx --test tests/provider-adapter-tdnet.test.mjs',
    failureModes: ['SOURCE_UNAVAILABLE', 'TIMEOUT', 'TICKER_ONLY', 'NO_RESULT', 'identifier_mapping_missing', 'provider_rate_limited', 'parser_error'],
  },
  {
    providerName: 'dart',
    fillsEvidenceClasses: ['issuer_exposure', 'issuer_commentary', 'primary_filing', 'supplier_capacity'],
    sourceType: 'non_us_official_filing',
    providerRoute: 'dart',
    authRequired: false,
    apiKeyRequired: false,
    fixtureRequired: true,
    fixtureRequirement: 'Korea DART business report fixture with issuer code mapping and no-result case',
    parserOutputSchema: {
      type: 'official_filing_evidence',
      requiredFields: ['provider', 'issuer', 'sourceUrl', 'title', 'publishedAt', 'desiredEvidenceClass', 'evidenceUse', 'metadata'],
    },
    allowlist: ['dart.fss.or.kr', 'opendart.fss.or.kr'],
    healthCheckCommand: 'node --import tsx scripts/collect-free-external-data.mjs --providers dart --limit 1 --dry-run',
    testCommand: 'node --import tsx --test tests/provider-adapter-dart.test.mjs',
    failureModes: ['SOURCE_UNAVAILABLE', 'TIMEOUT', 'TICKER_ONLY', 'NO_RESULT', 'identifier_mapping_missing', 'provider_rate_limited', 'parser_error'],
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

export function prioritySourceProviderSpecs() {
  const registry = buildSourceProviderManifestRegistry();
  const manifestSpecs = registry.ok
    ? providerSpecsFromManifestRegistry(registry).filter((spec) => spec.priorityProvider !== false)
    : [];
  const specs = manifestSpecs.length ? manifestSpecs : PRIORITY_PROVIDER_SPECS;
  return specs.map((spec) => ({
    ...spec,
    fillsEvidenceClasses: [...spec.fillsEvidenceClasses],
    allowlist: [...spec.allowlist],
    failureModes: [...spec.failureModes],
  }));
}

export function buildPrioritySourceProviderCandidates(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  return prioritySourceProviderSpecs().flatMap((spec) => (
    spec.fillsEvidenceClasses.map((evidenceClass) => ({
      candidateId: `priority:${spec.providerName}:${evidenceClass}`,
      providerName: spec.providerName,
      evidenceClass,
      sourceUrl: '',
      sourceType: spec.sourceType,
      providerRoute: spec.providerRoute,
      status: 'discovered_untrusted',
      discoveredBy: 'priority_provider_catalog',
      authRequired: spec.authRequired,
      apiKeyRequired: spec.apiKeyRequired,
      fixtureRequired: spec.fixtureRequired,
      fixtureRequirement: spec.fixtureRequirement,
      allowlist: spec.allowlist,
      parserOutputSchema: spec.parserOutputSchema,
      healthCheckCommand: spec.healthCheckCommand,
      testCommand: spec.testCommand,
      failureModes: spec.failureModes,
        metadata: {
          priorityProviderCatalogVersion: SOURCE_PROVIDER_PRIORITY_CATALOG_VERSION,
          providerManifestRegistry: spec.manifestFile ? 'config_backed' : 'fallback_catalog',
          manifestFile: spec.manifestFile || null,
          reviewGatedActivation: true,
          activationPolicy: 'probe_fixture_healthcheck_before_active_use',
          createdAt: generatedAt,
      },
    }))
  ));
}

export function buildPrioritySourceProviderCoverage(records = []) {
  const byProvider = {};
  for (const spec of prioritySourceProviderSpecs()) {
    byProvider[spec.providerName] = {
      providerName: spec.providerName,
      requiredEvidenceClasses: spec.fillsEvidenceClasses,
      statuses: {},
      fixtureStatuses: {},
      parserStatuses: {},
      healthcheckStatuses: {},
      activationBlockers: [],
      status: 'missing',
      reviewGatedActivation: true,
    };
  }
  for (const record of asArray(records)) {
    const providerName = compact(record.providerName).toLowerCase();
    if (!byProvider[providerName]) continue;
    const status = compact(record.status || 'discovered_untrusted');
    byProvider[providerName].statuses[status] = (byProvider[providerName].statuses[status] || 0) + 1;
    if (record.fixtureStatus) {
      byProvider[providerName].fixtureStatuses[record.fixtureStatus] = (byProvider[providerName].fixtureStatuses[record.fixtureStatus] || 0) + 1;
    }
    if (record.parserStatus) {
      byProvider[providerName].parserStatuses[record.parserStatus] = (byProvider[providerName].parserStatuses[record.parserStatus] || 0) + 1;
    }
    if (record.healthcheckStatus) {
      byProvider[providerName].healthcheckStatuses[record.healthcheckStatus] = (byProvider[providerName].healthcheckStatuses[record.healthcheckStatus] || 0) + 1;
    }
    if (record.activationBlocker && !byProvider[providerName].activationBlockers.includes(record.activationBlocker)) {
      byProvider[providerName].activationBlockers.push(record.activationBlocker);
    }
    byProvider[providerName].status = status;
  }
  const providers = Object.values(byProvider);
  return {
    ok: true,
    version: SOURCE_PROVIDER_PRIORITY_CATALOG_VERSION,
    providerCount: providers.length,
    providers,
    missingProviders: providers.filter((item) => item.status === 'missing').map((item) => item.providerName),
    needsFixtureProviders: providers.filter((item) => item.status === 'needs_fixture').map((item) => item.providerName),
    stagedOrActiveLimitedProviders: providers.filter((item) => item.status === 'staged' || item.status === 'active_limited').map((item) => item.providerName),
  };
}
