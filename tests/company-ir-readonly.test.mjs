import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_COMPANY_IR_HOLDOUT_VALIDATION_FIXTURES,
  buildCompanyIrHoldoutValidationRawEvidence,
  collectCompanyIrHoldoutValidationReadonly,
  companyIrHoldoutValidationAcceptanceDetail,
  classifyCompanyIrDocumentType,
  collectCompanyIrReadonly,
  findAbfOperatingProximity,
  rankCompanyIrDocumentsForIssuer,
  resolveCompanyIrDocumentLinks,
  scoreCompanyIrDocument,
  validateCompanyIrAllowlistUrl,
} from '../scripts/_shared/external-data/company-ir-readonly.mjs';
import {
  buildSeedBiasEvidenceAcquisition,
} from '../scripts/_shared/seed-bias-evidence-acquisition.mjs';
import {
  acceptSeedEvidenceRows,
} from '../scripts/_shared/seed-evidence-acceptance.mjs';
import {
  buildChildBottleneckBackfillTasks,
  decomposeChildBottleneckSeeds,
  selectPreferredChildBottleneckSeed,
} from '../scripts/_shared/seed-child-bottleneck-decomposition.mjs';

function parentSeed() {
  return {
    seedId: 'msd-435f5ea22b83be71',
    seedTitle: 'advanced packaging and substrate capacity',
    theme: { key: 'semiconductors', label: 'Semiconductor' },
    growthDriver: 'AI accelerator demand requires advanced packaging throughput',
    realActivity: 'advanced packaging ramp',
    physicalProcess: 'advanced packaging and substrate supply',
    requiredInputs: ['advanced packaging capacity', 'substrates'],
    bottleneck: {
      label: 'advanced packaging and substrate capacity',
      class: 'supplier_capacity',
      mechanism: 'qualified supplier and capacity bottleneck',
    },
    supplierCategory: {
      label: 'advanced packaging, substrate, memory, and semiconductor equipment suppliers',
      publicIssuerCandidates: ['TSM', 'ASML', 'AMD', 'NVDA', 'AVGO'],
    },
    evidenceQueries: ['advanced packaging capacity substrates bottleneck official source'],
    counterEvidenceQueries: ['advanced packaging capacity alternative suppliers substitution risk'],
    scores: { knownNarrativeScore: 0.2, seedSimilarityScore: 0.2 },
    lineage: { source: 'research_question', sourceIds: ['auto'] },
  };
}

function abfChild() {
  return selectPreferredChildBottleneckSeed(decomposeChildBottleneckSeeds(parentSeed()).childSeeds).childSeed;
}

function tasks(seed = abfChild()) {
  return buildChildBottleneckBackfillTasks(seed, { generatedAt: '2026-05-20T00:00:00.000Z' });
}

function allowlist(urls = []) {
  return [{
    issuer: 'IBIDY',
    issuerName: 'Ibiden',
    issuerRoleClass: 'substrate_capacity_owner',
    urls: urls.map((url, index) => ({
      sourceUrl: url,
      documentTitle: `Ibiden official IR document ${index + 1}`,
      documentType: 'annual_report',
      fiscalYear: 2026,
      sourceGroup: 'official_company_ir',
    })),
  }];
}

function indexAllowlist(url = 'https://ir.example.com/ibiden/annual/') {
  return [{
    issuer: 'IBIDY',
    issuerName: 'Ibiden',
    issuerRoleClass: 'substrate_capacity_owner',
    urls: [{
      sourceUrl: url,
      documentTitle: 'Ibiden annual reports library',
      documentType: 'annual_report_library',
      fiscalYear: 2026,
      sourceGroup: 'official_company_ir',
    }],
  }];
}

function multiIssuerIndexAllowlist() {
  return [
    {
      issuer: 'IBIDY',
      issuerName: 'Ibiden',
      issuerRoleClass: 'substrate_capacity_owner',
      urls: [{
        sourceUrl: 'https://ir.example.com/ibiden/annual/',
        documentTitle: 'Ibiden annual reports library',
        documentType: 'annual_report_library',
        fiscalYear: 2026,
        sourceGroup: 'official_company_ir',
      }],
    },
    {
      issuer: 'UNICY',
      issuerName: 'Unimicron',
      issuerRoleClass: 'substrate_capacity_owner',
      urls: [{
        sourceUrl: 'https://ir.example.com/unimicron/reports/',
        documentTitle: 'Unimicron investor reports',
        documentType: 'ir_report_library',
        fiscalYear: 2026,
        sourceGroup: 'official_company_ir',
      }],
    },
    {
      issuer: 'NANYF',
      issuerName: 'Nan Ya PCB',
      issuerRoleClass: 'substrate_capacity_owner',
      urls: [{
        sourceUrl: 'https://ir.example.com/nanya/reports/',
        documentTitle: 'Nan Ya PCB investor reports',
        documentType: 'ir_report_library',
        fiscalYear: 2026,
        sourceGroup: 'official_company_ir',
      }],
    },
  ];
}

function fetchFor(map = {}) {
  return async (url) => {
    const raw = map[String(url)];
    if (raw === undefined) return { ok: false, status: 404, headers: new Map(), text: async () => '' };
    const body = typeof raw === 'object' ? raw.body : raw;
    const contentType = typeof raw === 'object' ? raw.contentType || 'text/html; charset=utf-8' : 'text/html; charset=utf-8';
    return {
      ok: true,
      status: 200,
      headers: { get: () => contentType },
      text: async () => body,
      arrayBuffer: async () => Buffer.from(body, 'utf8'),
    };
  };
}

const companyIrHoldoutPositiveFixture = DEFAULT_COMPANY_IR_HOLDOUT_VALIDATION_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'positive_operating_bridge_fixture');
const companyIrHoldoutTickerOnlyFixture = DEFAULT_COMPANY_IR_HOLDOUT_VALIDATION_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'ticker_only_rejection_fixture');
const companyIrHoldoutMetadataOnlyFixture = DEFAULT_COMPANY_IR_HOLDOUT_VALIDATION_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'raw_metadata_only_rejection_fixture');

test('company IR holdout parser extracts independent operating bridge evidence', () => {
  const row = buildCompanyIrHoldoutValidationRawEvidence(companyIrHoldoutPositiveFixture, {
    seedId: 'seed-company-ir-holdout',
    taskId: 'company-ir-holdout',
    generatedAt: '2026-05-23T00:00:00.000Z',
  });
  const detail = companyIrHoldoutValidationAcceptanceDetail(row);

  assert.equal(row.providerName, 'company-ir-readonly');
  assert.equal(row.evidenceClass, 'holdout_validation');
  assert.equal(row.sourceGroup, 'official_company_ir_holdout');
  assert.equal(row.failureClassification, 'ACCEPTED');
  assert.equal(row.accepted, true);
  assert.equal(detail.accepted, true);
  assert.equal(row.promotionEligible, false);
  assert.equal(row.evidenceUse, 'supporting_context');
  assert.equal(row.matchedSubjectTerms.includes('ABF substrate'), true);
  assert.equal(row.matchedOperatingTerms.includes('capacity expansion'), true);
  assert.match(row.operatingBridgeSnippet, /customer demand/i);
  assert.equal(row.sourceIndependence, 'issuer_official_independent_ir');
  assert.equal(row.mutationBoundary.readinessPromotionWrites, 0);
});

test('company IR holdout parser rejects ticker-only and raw metadata-only fixtures', () => {
  const result = collectCompanyIrHoldoutValidationReadonly({
    seedId: 'seed-company-ir-holdout',
    generatedAt: '2026-05-23T00:00:00.000Z',
    sourceAllowlist: [companyIrHoldoutTickerOnlyFixture, companyIrHoldoutMetadataOnlyFixture],
  });
  const tickerOnly = result.rawEvidence.find((row) => row.fixtureKind === 'ticker_only_rejection_fixture');
  const metadataOnly = result.rawEvidence.find((row) => row.fixtureKind === 'raw_metadata_only_rejection_fixture');

  assert.equal(result.acceptedCandidateCount, 0);
  assert.equal(result.acceptedPromotionCandidateCount, 0);
  assert.equal(tickerOnly.failureClassification, 'TICKER_ONLY');
  assert.equal(tickerOnly.accepted, false);
  assert.equal(tickerOnly.promotionEligible, false);
  assert.match(tickerOnly.rejectionReason, /ticker_only/i);
  assert.equal(metadataOnly.failureClassification, 'WEAK_EVIDENCE');
  assert.equal(metadataOnly.accepted, false);
  assert.equal(metadataOnly.promotionEligible, false);
  assert.match(metadataOnly.rejectionReason, /raw_metadata_only/);
  assert.equal(result.acceptanceSafety.rawEvidenceAutoPromotes, false);
});

test('company IR holdout fixture can enter acceptance only as supporting context', () => {
  const collected = collectCompanyIrHoldoutValidationReadonly({
    seedId: 'seed-company-ir-holdout',
    task: {
      taskId: 'company-ir-holdout',
      seedId: 'seed-company-ir-holdout',
      evidenceClass: 'holdout_validation',
      providerRoute: 'company-ir-readonly',
      acceptanceCriteria: {
        requiredTerms: ['ABF substrate', 'capacity'],
      },
    },
    generatedAt: '2026-05-23T00:00:00.000Z',
    sourceAllowlist: [
      companyIrHoldoutPositiveFixture,
      companyIrHoldoutTickerOnlyFixture,
      companyIrHoldoutMetadataOnlyFixture,
    ],
  });
  const accepted = acceptSeedEvidenceRows(collected.rawEvidence, {
    tasks: [{
      taskId: 'company-ir-holdout',
      seedId: 'seed-company-ir-holdout',
      evidenceClass: 'holdout_validation',
      providerRoute: 'company-ir-readonly',
      acceptanceCriteria: { requiredTerms: ['ABF substrate', 'capacity'] },
    }],
    now: new Date('2026-05-23T00:00:00.000Z'),
  });

  assert.equal(accepted.acceptedEvidenceStoredCount, 1);
  assert.equal(accepted.acceptedEvidence[0].evidenceUse, 'supporting_context');
  assert.equal(accepted.acceptedEvidence[0].promotionEligible, false);
  assert.equal(accepted.acceptedEvidence.filter((row) => row.promotionEligible === true).length, 0);
  assert.equal(accepted.rawEvidence.find((row) => row.fixtureKind === 'ticker_only_rejection_fixture').accepted, false);
  assert.equal(accepted.rawEvidence.find((row) => row.fixtureKind === 'raw_metadata_only_rejection_fixture').accepted, false);
});

test('company IR collector permits only allowlisted issuer URLs', () => {
  const list = allowlist(['https://ir.example.com/ibiden/annual-2026']);
  assert.equal(validateCompanyIrAllowlistUrl('https://ir.example.com/ibiden/annual-2026', list).allowed, true);
  const rejected = validateCompanyIrAllowlistUrl('https://not-allowed.example.com/report', list);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.reason, 'url_not_in_company_ir_allowlist');
});

test('generic company IR metadata is raw only and cannot become accepted evidence', async () => {
  const seed = abfChild();
  const list = allowlist(['https://ir.example.com/ibiden/profile']);
  const collected = await collectCompanyIrReadonly({
    seed,
    tasks: tasks(seed),
    allowlist: list,
    fetchImpl: fetchFor({
      'https://ir.example.com/ibiden/profile': 'Official investor relations company profile and corporate overview.',
    }),
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const result = buildSeedBiasEvidenceAcquisition({
    seed,
    tasks: tasks(seed),
    collectedRawEvidence: collected.rawEvidence,
    diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(collected.companyIrCollectorStatus.allowlistOnly, true);
  assert.equal(result.acceptedEvidenceCount, 0);
  assert.equal(result.acceptedEvidence.some((row) => row.evidenceClass === 'issuer_exposure'), false);
  assert.equal(result.issuerBridgeStatus, 'missing');
  assert.equal(result.gateResult.gate, 'blocked');
});

test('IR index page is stored as raw metadata only and cannot become accepted evidence', async () => {
  const seed = abfChild();
  const list = indexAllowlist();
  const collected = await collectCompanyIrReadonly({
    seed,
    tasks: tasks(seed),
    allowlist: list,
    fetchImpl: fetchFor({
      'https://ir.example.com/ibiden/annual/': '<html><body>Official annual reports library ABF substrate capacity expansion <a href="/ibiden/annual-2026.pdf">Annual Report 2026</a></body></html>',
      'https://ir.example.com/ibiden/annual-2026.pdf': {
        contentType: 'application/pdf',
        body: '%PDF-1.4 (Official annual report ABF substrate capacity expansion capex customer demand lead time) %%EOF',
      },
    }),
    rateLimitMs: 0,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const indexRows = collected.rawEvidence.filter((row) => row.isIndexPage === true);
  assert.equal(indexRows.length >= 1, true);
  assert.equal(indexRows.some((row) => row.promotionEligible === true), false);
  assert.equal(indexRows.every((row) => row.acceptanceVerdict === 'company_ir_index_metadata_only'), true);
});

test('official document link resolver finds prioritized annual report and IR presentation links', () => {
  assert.equal(classifyCompanyIrDocumentType({ href: '/fy2026-integrated-report.pdf', text: 'Integrated Report 2026' }), 'integrated_report');
  assert.equal(classifyCompanyIrDocumentType({ href: '/results-presentation.pdf', text: 'Financial Results Presentation' }), 'earnings_presentation');
  const docs = resolveCompanyIrDocumentLinks({
    issuer: 'IBIDY',
    issuerName: 'Ibiden',
    issuerRoleClass: 'substrate_capacity_owner',
    sourceUrl: 'https://ir.example.com/ibiden/annual/',
    sourceGroup: 'official_company_ir',
  }, `
    <a href="/ibiden/results-2026.pdf">Financial Results 2026</a>
    <a href="/ibiden/presentation-2026.pdf">IR Presentation 2026</a>
    <a href="/ibiden/annual-2026.pdf">Annual Report 2026</a>
    <a href="https://external.example.com/annual-2026.pdf">External Annual Report 2026</a>
  `);
  assert.deepEqual(docs.map((doc) => doc.documentType), ['annual_report', 'ir_presentation', 'financial_results']);
  assert.equal(docs.every((doc) => doc.sourceUrl.startsWith('https://ir.example.com/')), true);
});

test('company IR ranking prefers fresh relevant official documents over old annual PDFs', () => {
  const ranked = rankCompanyIrDocumentsForIssuer([
    {
      issuer: 'IBIDY',
      issuerName: 'Ibiden',
      issuerRoleClass: 'substrate_capacity_owner',
      sourceUrl: 'https://ir.example.com/ibiden/annual-2018.pdf',
      documentTitle: 'Annual Report 2018 ABF substrate capacity',
      documentType: 'annual_report',
      fiscalYear: 2018,
      sourceGroup: 'official_company_ir',
    },
    {
      issuer: 'IBIDY',
      issuerName: 'Ibiden',
      issuerRoleClass: 'substrate_capacity_owner',
      sourceUrl: 'https://ir.example.com/ibiden/integrated-2025.pdf',
      documentTitle: 'Integrated Report 2025 package substrate business capacity',
      documentType: 'integrated_report',
      fiscalYear: 2025,
      sourceGroup: 'official_company_ir',
    },
    {
      issuer: 'IBIDY',
      issuerName: 'Ibiden',
      issuerRoleClass: 'substrate_capacity_owner',
      sourceUrl: 'https://ir.example.com/ibiden/presentation-2026.pdf',
      documentTitle: 'IR Presentation 2026 high-end substrate capex',
      documentType: 'ir_presentation',
      fiscalYear: 2026,
      sourceGroup: 'official_company_ir',
    },
  ], {
    generatedAt: '2026-05-20T00:00:00.000Z',
    maxDocumentsPerIssuer: 2,
  });
  assert.equal(ranked.selectedDocuments.length, 2);
  assert.equal(ranked.selectedDocuments.some((doc) => doc.sourceUrl.includes('2018')), false);
  assert.equal(ranked.rejectedDocuments.find((doc) => doc.sourceUrl.includes('2018')).rejectionReason, 'stale_document_penalty');
  assert.equal(ranked.selectedDocuments[0].fiscalYear >= 2025, true);
});

test('2019-before documents receive a strong stale penalty', () => {
  const fresh = scoreCompanyIrDocument({
    issuerRoleClass: 'substrate_capacity_owner',
    sourceUrl: 'https://ir.example.com/abf-capacity-2025.pdf',
    documentTitle: 'Annual Report 2025 ABF substrate capacity',
    documentType: 'annual_report',
    fiscalYear: 2025,
  }, { generatedAt: '2026-05-20T00:00:00.000Z' });
  const stale = scoreCompanyIrDocument({
    issuerRoleClass: 'substrate_capacity_owner',
    sourceUrl: 'https://ir.example.com/abf-capacity-2018.pdf',
    documentTitle: 'Annual Report 2018 ABF substrate capacity',
    documentType: 'annual_report',
    fiscalYear: 2018,
  }, { generatedAt: '2026-05-20T00:00:00.000Z' });
  assert.equal(stale.staleDocument, true);
  assert.equal(stale.documentScoreBreakdown.staleDocumentPenalty >= 45, true);
  assert.equal(fresh.documentScore > stale.documentScore, true);
});

test('multi-issuer coverage balancing records skew and issuer-specific provider gaps', async () => {
  const seed = abfChild();
  const collected = await collectCompanyIrReadonly({
    seed,
    tasks: tasks(seed),
    allowlist: multiIssuerIndexAllowlist(),
    fetchImpl: fetchFor({
      'https://ir.example.com/ibiden/annual/': `
        <a href="/ibiden/integrated-2026.pdf">Integrated Report 2026 ICパッケージ基板 生産能力</a>
        <a href="/ibiden/integrated-2025.pdf">Integrated Report 2025 ABF substrate capacity</a>
        <a href="/ibiden/annual-2018.pdf">Annual Report 2018 ABF substrate capacity</a>
      `,
      'https://ir.example.com/ibiden/integrated-2026.pdf': {
        contentType: 'application/pdf',
        body: '%PDF-1.4 (ICパッケージ基板の生産能力と顧客需要を説明します) %%EOF',
      },
      'https://ir.example.com/ibiden/integrated-2025.pdf': {
        contentType: 'application/pdf',
        body: '%PDF-1.4 (ABF substrate capacity and capex allocation) %%EOF',
      },
      'https://ir.example.com/unimicron/reports/': '<html>No official PDF links in this fixture</html>',
      'https://ir.example.com/nanya/reports/': '<html>No official PDF links in this fixture</html>',
    }),
    rateLimitMs: 0,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const status = collected.companyIrCollectorStatus;
  assert.equal(status.selectedDocuments.length, 2);
  assert.equal(status.selectedDocuments.every((doc) => doc.issuer === 'IBIDY'), true);
  assert.equal(status.issuerCoverageSkew, true);
  assert.equal(status.issuerCoverageSkewWarning, 'issuer_coverage_skew');
  assert.equal(status.missingIssuerDocuments.includes('UNICY'), true);
  assert.equal(status.issuerSpecificProviderGap.some((item) => (
    item.issuer === 'UNICY' && item.providerGap.includes('taiwan_mops_required')
  )), true);
  assert.equal(status.issuerDocumentCoverage.find((item) => item.issuer === 'IBIDY').selectedDocumentCount, 2);
});

test('ABF substrate plus capacity bridge in official IR can accept issuer exposure only', async () => {
  const seed = abfChild();
  const list = allowlist(['https://ir.example.com/ibiden/annual-2026']);
  const collected = await collectCompanyIrReadonly({
    seed,
    tasks: tasks(seed),
    allowlist: list,
    fetchImpl: fetchFor({
      'https://ir.example.com/ibiden/annual-2026': 'Official annual report investor relations: the company issuer reports ABF package substrate capacity expansion, capex allocation, customer demand, revenue, and lead time pressure for high-end substrate products.',
    }),
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const result = buildSeedBiasEvidenceAcquisition({
    seed,
    tasks: tasks(seed),
    collectedRawEvidence: collected.rawEvidence,
    diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(result.acceptedEvidence.some((row) => row.evidenceClass === 'issuer_exposure'), true);
  assert.equal(result.issuerBridgeStatus, 'attached');
  assert.equal(result.holdoutValidation.holdoutConfirmed, false);
  assert.equal(result.gateResult.gate, 'blocked');
  assert.equal(result.gateResult.blockers.includes('holdout_confirmation_missing'), true);
});

test('PDF/text document body needs bottleneck plus operating bridge terms for accepted issuer exposure', async () => {
  const seed = abfChild();
  const list = indexAllowlist();
  const collected = await collectCompanyIrReadonly({
    seed,
    tasks: tasks(seed),
    allowlist: list,
    fetchImpl: fetchFor({
      'https://ir.example.com/ibiden/annual/': '<a href="/ibiden/annual-2026.pdf">Annual Report 2026</a><a href="/ibiden/presentation-2026.html">IR Presentation 2026</a>',
      'https://ir.example.com/ibiden/annual-2026.pdf': {
        contentType: 'application/pdf',
        body: '%PDF-1.4 (Official annual report ABF substrate capacity expansion capex allocation customer demand AI server) %%EOF',
      },
      'https://ir.example.com/ibiden/presentation-2026.html': 'Official IR presentation: high-end IC substrate production line capacity supports HPC and data center customer demand.',
    }),
    rateLimitMs: 0,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const result = buildSeedBiasEvidenceAcquisition({
    seed,
    tasks: tasks(seed),
    collectedRawEvidence: collected.rawEvidence,
    diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const issuerRows = result.acceptedEvidence.filter((row) => row.evidenceClass === 'issuer_exposure');
  assert.equal(issuerRows.length, 1);
  assert.equal(issuerRows[0].payload.extractionStatus, 'pdf_text_extracted');
  assert.equal(issuerRows[0].payload.matchedBottleneckTerms.includes('ABF substrate'), true);
  assert.equal(issuerRows[0].payload.matchedOperatingTerms.includes('capacity expansion'), true);
});

test('Japanese ABF substrate and capacity terms create proximity-based accepted candidate', async () => {
  const seed = abfChild();
  const list = allowlist(['https://ir.example.com/ibiden/integrated-2026']);
  const collected = await collectCompanyIrReadonly({
    seed,
    tasks: tasks(seed),
    allowlist: list,
    fetchImpl: fetchFor({
      'https://ir.example.com/ibiden/integrated-2026': '統合報告書: ICパッケージ基板の生産能力を増強し、データセンター向け顧客需要と売上拡大に対応します。',
    }),
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const result = buildSeedBiasEvidenceAcquisition({
    seed,
    tasks: tasks(seed),
    collectedRawEvidence: collected.rawEvidence,
    diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const issuerRows = result.acceptedEvidence.filter((row) => row.evidenceClass === 'issuer_exposure');
  assert.equal(issuerRows.length, 1);
  assert.equal(issuerRows[0].payload.proximityMatch, true);
  assert.equal(issuerRows[0].payload.matchedLanguage.includes('ja'), true);
  assert.equal(issuerRows[0].payload.matchedBottleneckTerms.includes('ICパッケージ基板'), true);
  assert.equal(issuerRows[0].payload.matchedOperatingTerms.includes('生産能力'), true);
});

test('Chinese ABF substrate and capacity expansion terms create proximity-based accepted candidate', async () => {
  const seed = abfChild();
  const list = allowlist(['https://ir.example.com/ibiden/integrated-2026']);
  const collected = await collectCompanyIrReadonly({
    seed,
    tasks: tasks(seed),
    allowlist: list,
    fetchImpl: fetchFor({
      'https://ir.example.com/ibiden/integrated-2026': '年度報告: ABF載板產能擴充用於支援AI server與客戶需求，並帶動營收成長。',
    }),
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const result = buildSeedBiasEvidenceAcquisition({
    seed,
    tasks: tasks(seed),
    collectedRawEvidence: collected.rawEvidence,
    diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const issuerRows = result.acceptedEvidence.filter((row) => row.evidenceClass === 'issuer_exposure');
  assert.equal(issuerRows.length, 1);
  assert.equal(issuerRows[0].payload.proximityMatch, true);
  assert.equal(issuerRows[0].payload.matchedLanguage.includes('zh'), true);
  assert.equal(issuerRows[0].payload.matchedBottleneckTerms.includes('ABF載板'), true);
  assert.equal(issuerRows[0].payload.matchedOperatingTerms.includes('產能擴充'), true);
});

test('scattered bottleneck and operating terms without proximity remain raw-only', async () => {
  const seed = abfChild();
  const list = allowlist(['https://ir.example.com/ibiden/integrated-2026']);
  const separated = `ICパッケージ基板 ${'neutral text '.repeat(120)} 生産能力`;
  const proximity = findAbfOperatingProximity(separated, { window: 120 });
  assert.equal(proximity.matched, false);
  const collected = await collectCompanyIrReadonly({
    seed,
    tasks: tasks(seed),
    allowlist: list,
    fetchImpl: fetchFor({
      'https://ir.example.com/ibiden/integrated-2026': separated,
    }),
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const result = buildSeedBiasEvidenceAcquisition({
    seed,
    tasks: tasks(seed),
    collectedRawEvidence: collected.rawEvidence,
    diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(collected.rawEvidence.some((row) => row.acceptanceVerdict === 'company_ir_terms_not_proximate_raw_only'), true);
  assert.equal(result.acceptedEvidence.some((row) => row.evidenceClass === 'issuer_exposure'), false);
});

test('old stale official document remains raw-only even with ABF operating bridge terms', async () => {
  const seed = abfChild();
  const list = allowlist(['https://ir.example.com/ibiden/annual-2018']);
  list[0].urls[0].fiscalYear = 2018;
  list[0].urls[0].documentTitle = 'Ibiden Annual Report 2018';
  const collected = await collectCompanyIrReadonly({
    seed,
    tasks: tasks(seed),
    allowlist: list,
    fetchImpl: fetchFor({
      'https://ir.example.com/ibiden/annual-2018': 'Official annual report investor relations: ABF package substrate capacity expansion, capex allocation, customer demand, revenue, and lead time pressure.',
    }),
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const result = buildSeedBiasEvidenceAcquisition({
    seed,
    tasks: tasks(seed),
    collectedRawEvidence: collected.rawEvidence,
    diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(collected.rawEvidence.some((row) => row.acceptanceVerdict === 'company_ir_stale_document_raw_only'), true);
  assert.equal(result.acceptedEvidence.some((row) => row.evidenceClass === 'issuer_exposure'), false);
});

test('same company IR document cannot close issuer exposure and holdout simultaneously', async () => {
  const seed = abfChild();
  const list = allowlist(['https://ir.example.com/ibiden/annual-2026']);
  const collected = await collectCompanyIrReadonly({
    seed,
    tasks: tasks(seed),
    allowlist: list,
    fetchImpl: fetchFor({
      'https://ir.example.com/ibiden/annual-2026': 'Official annual report investor relations: ABF package substrate capacity and capex allocation are tied to customer demand, revenue, backlog, and lead time.',
    }),
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const result = buildSeedBiasEvidenceAcquisition({
    seed,
    tasks: tasks(seed),
    collectedRawEvidence: collected.rawEvidence,
    diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(result.issuerBridgeStatus, 'attached');
  assert.equal(result.holdoutValidation.holdoutConfirmed, false);
});

test('second independent company IR document can close holdout as supporting evidence', async () => {
  const seed = abfChild();
  const list = [{
    issuer: 'IBIDY',
    issuerName: 'Ibiden',
    issuerRoleClass: 'substrate_capacity_owner',
    urls: [
      {
        sourceUrl: 'https://ir.example.com/ibiden/annual-2026',
        documentTitle: 'Ibiden annual report 2026',
        documentType: 'annual_report',
        fiscalYear: 2026,
        sourceGroup: 'official_company_ir',
      },
      {
        sourceUrl: 'https://ir.example.com/ibiden/ir-presentation-2026',
        documentTitle: 'Ibiden IR presentation 2026',
        documentType: 'ir_presentation',
        fiscalYear: 2026,
        sourceGroup: 'official_company_ir',
      },
    ],
  }];
  const collected = await collectCompanyIrReadonly({
    seed,
    tasks: tasks(seed),
    allowlist: list,
    fetchImpl: fetchFor({
      'https://ir.example.com/ibiden/annual-2026': 'Official annual report investor relations: ABF package substrate capacity and capex allocation are tied to customer demand, revenue, backlog, and lead time.',
      'https://ir.example.com/ibiden/ir-presentation-2026': 'Official IR presentation: high-end IC substrate capacity expansion supports customer demand and lead time allocation for ABF build-up substrate.',
    }),
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const result = buildSeedBiasEvidenceAcquisition({
    seed,
    tasks: tasks(seed),
    collectedRawEvidence: collected.rawEvidence,
    diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(result.acceptedEvidence.some((row) => row.evidenceClass === 'issuer_exposure'), true);
  assert.equal(result.acceptedEvidence.some((row) => row.evidenceClass === 'holdout_validation'), true);
  assert.equal(result.holdoutValidation.holdoutConfirmed, true);
  assert.equal(result.gateResult.gate, 'blocked');
  assert.equal(result.gateResult.blockers.includes('market_validation_missing'), true);
});

test('company IR negative-control invalidator rejects or weakens gate, while sufficient no-direct search can close no-direct', async () => {
  const seed = abfChild();
  const list = allowlist([
    'https://ir.example.com/ibiden/annual-2026',
    'https://ir.example.com/ibiden/ir-presentation-2026',
  ]);
  const invalidator = await collectCompanyIrReadonly({
    seed,
    tasks: tasks(seed),
    allowlist: list,
    fetchImpl: fetchFor({
      'https://ir.example.com/ibiden/annual-2026': 'Official annual report: ABF package substrate capacity expansion completed and supply improving with lead time improving.',
      'https://ir.example.com/ibiden/ir-presentation-2026': 'Official IR presentation: ABF package substrate capacity and customer demand.',
    }),
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const invalidatorResult = buildSeedBiasEvidenceAcquisition({
    seed,
    tasks: tasks(seed),
    collectedRawEvidence: invalidator.rawEvidence,
    diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(['REJECTED', 'WEAKENED'].includes(invalidatorResult.negativeControlSurvival.items[0].survivalStatus), true);
  assert.equal(invalidatorResult.gateResult.gate, 'blocked');

  const checked = await collectCompanyIrReadonly({
    seed,
    tasks: tasks(seed),
    allowlist: list,
    fetchImpl: fetchFor({
      'https://ir.example.com/ibiden/annual-2026': 'Official annual report: ABF package substrate capacity and capex allocation are tied to customer demand and lead time.',
      'https://ir.example.com/ibiden/ir-presentation-2026': 'Official IR presentation: high-end IC substrate capacity expansion supports customer demand and allocation.',
    }),
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const checkedResult = buildSeedBiasEvidenceAcquisition({
    seed,
    tasks: tasks(seed),
    collectedRawEvidence: checked.rawEvidence,
    diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(checkedResult.negativeControlSurvival.items[0].survivalStatus, 'CHECKED_NO_DIRECT_LIMITED_SCOPE');
  assert.equal(checkedResult.negativeControlSurvival.items[0].negativeControlScope, 'limited');
  assert.equal(checkedResult.gateResult.blockers.includes('negative_control_not_closed'), true);
  assert.equal(checkedResult.boundaries.providerActivationWrites, 0);
});

test('sufficient-scope no-direct negative control can close negative lane but does not bypass other gates', async () => {
  const seed = abfChild();
  const list = [{
    issuer: 'IBIDY',
    issuerName: 'Ibiden',
    issuerRoleClass: 'substrate_capacity_owner',
    urls: [
      {
        sourceUrl: 'https://ir.example.com/ibiden/annual-2026',
        documentTitle: 'Annual Report 2026',
        documentType: 'annual_report',
        fiscalYear: 2026,
        sourceGroup: 'official_company_ir',
      },
      {
        sourceUrl: 'https://ir.example.com/ibiden/integrated-2026',
        documentTitle: 'Integrated Report 2026',
        documentType: 'integrated_report',
        fiscalYear: 2026,
        sourceGroup: 'official_filing',
      },
      {
        sourceUrl: 'https://ir.example.com/ibiden/ir-presentation-2026',
        documentTitle: 'IR Presentation 2026',
        documentType: 'ir_presentation',
        fiscalYear: 2026,
        sourceGroup: 'official_company_ir',
      },
    ],
  }];
  const collected = await collectCompanyIrReadonly({
    seed,
    tasks: tasks(seed),
    allowlist: list,
    fetchImpl: fetchFor({
      'https://ir.example.com/ibiden/annual-2026': 'Official annual report: ABF package substrate capacity and capex allocation are tied to customer demand and lead time.',
      'https://ir.example.com/ibiden/integrated-2026': 'Official integrated report: high-end IC substrate production line capacity supports HPC and data center demand.',
      'https://ir.example.com/ibiden/ir-presentation-2026': 'Official IR presentation: build-up substrate allocation and customer demand continue for AI server package substrate.',
    }),
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const result = buildSeedBiasEvidenceAcquisition({
    seed,
    tasks: tasks(seed),
    collectedRawEvidence: collected.rawEvidence,
    diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(result.negativeControlSurvival.items[0].survivalStatus, 'CHECKED_NO_DIRECT_SUFFICIENT_SCOPE');
  assert.equal(result.negativeControlScope, 'sufficient');
  assert.equal(result.gateResult.blockers.includes('negative_control_not_closed'), false);
  assert.equal(result.gateResult.gate, 'blocked');
});
