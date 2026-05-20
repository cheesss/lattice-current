import crypto from 'node:crypto';
import { routeEvidenceProvider } from './evidence-provider-router.mjs';
import {
  issuerUniverseForEvidenceClass,
  resolveReportIssuerUniverse,
} from './report-issuer-universe.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashArtifactContent(value) {
  const content = typeof value === 'string' ? value : stableJson(value);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function inferEvidenceClass(query = {}) {
  return query.desiredEvidenceClass
    || query.metadata?.desiredEvidenceClass
    || query.metadata?.evidenceClass
    || null;
}

function inferCandidateId(query = {}, bundle = {}) {
  return query.candidateId
    || query.metadata?.candidateId
    || bundle.subject?.metadata?.candidateId
    || bundle.subject?.subjectId
    || null;
}

function inferConnector(query = {}, bundle = {}) {
  return query.connector
    || query.metadata?.connector
    || bundle.metadata?.candidate?.connector_name
    || bundle.metadata?.candidate?.connector
    || bundle.subject?.displayName
    || null;
}

function inferIssuerHints(query = {}, bundle = {}) {
  const direct = query.issuerHints || query.metadata?.issuerHints;
  if (Array.isArray(direct) && direct.length) return direct.map(String);
  const text = `${query.text || ''} ${query.metadata?.query || ''} ${bundle.subject?.displayName || ''}`.toUpperCase();
  return ['LHX', 'NOC', 'LMT', 'RTX', 'GD', 'RKLB']
    .filter((symbol) => new RegExp(`\\b${symbol}\\b`).test(text));
}

function reportThemes(bundle = {}) {
  const subject = bundle.subject || {};
  return [
    subject.theme,
    subject.themeKey,
    subject.subjectType === 'theme' ? subject.subjectId : null,
    subject.metadata?.theme,
    subject.metadata?.themeKey,
    ...(Array.isArray(subject.metadata?.themes) ? subject.metadata.themes : []),
    ...(Array.isArray(bundle.metadata?.candidate?.themes) ? bundle.metadata.candidate.themes : []),
    ...(Array.isArray(bundle.metadata?.themeContext?.themes) ? bundle.metadata.themeContext.themes : []),
  ].filter(Boolean);
}

function reportSubjectDisplay(bundle = {}) {
  return bundle.subject?.displayName
    || bundle.subject?.display
    || bundle.subject?.title
    || bundle.subject?.subjectId
    || bundle.reportId
    || 'report';
}

function acceptanceCriteriaForEvidenceClass(evidenceClass = '') {
  return ({
    supplier_capacity: 'Accept only connector-specific capacity, facility, throughput, production-line, or supplier bottleneck evidence.',
    technical_qualification: 'Accept only qualification, certification, test, material, nozzle, propellant, or technical substitution evidence.',
    procurement_trigger: 'Accept only contract award, funding, budget-line, program timing, procurement, or customer pull evidence.',
    substitution_limit: 'Accept only direct evidence that substitutes are scarce, slow to qualify, sole-source, or capacity-redundancy is limited.',
    issuer_exposure: 'Accept only issuer-level backlog, segment revenue, guidance, supplier/customer, or management-commentary exposure evidence.',
    negative_control: 'Accept invalidator or constraint-check evidence about easy substitutes, supplier redundancy, no timing pressure, or non-qualified suppliers.',
  })[evidenceClass] || 'Accept only evidence directly tied to the report subject and requested evidence class.';
}

function promotionEligibleForDraft(evidenceClass = '') {
  return Boolean(evidenceClass) && evidenceClass !== 'negative_control';
}

function coerceBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
}

export function buildSourceQueryDrafts(bundle = {}, analysis = {}) {
  const issuerResolution = resolveReportIssuerUniverse({ bundle });
  return asArray(analysis.sourceQueries).map((query, index) => {
    const metadata = query.metadata && typeof query.metadata === 'object' ? query.metadata : {};
    const desiredEvidenceClass = inferEvidenceClass(query);
    const candidateId = inferCandidateId(query, bundle);
    const connector = inferConnector(query, bundle);
    const explicitIssuerHints = inferIssuerHints(query, bundle);
    const promotionUniverse = [
      ...asArray(metadata.promotionUniverse),
      ...asArray(metadata.target?.promotionUniverseSymbols),
      ...asArray(issuerResolution.promotionEligibleSymbols),
    ].filter(Boolean);
    const issuerUniverse = [
      ...promotionUniverse,
      ...asArray(metadata.issuerUniverse),
      ...asArray(metadata.symbols),
      ...asArray(metadata.target?.issuerUniverseSymbols),
      ...explicitIssuerHints,
    ].filter(Boolean);
    const candidateIssuerUniverse = [
      ...asArray(metadata.candidateIssuerUniverse),
      ...asArray(metadata.collectionUniverse),
      ...asArray(metadata.target?.candidateIssuerUniverseSymbols),
      ...asArray(issuerResolution.candidateIssuerUniverse),
      ...asArray(issuerResolution.collectionUniverse),
      ...asArray(issuerResolution.issuerUniverse),
    ].filter(Boolean);
    const issuerStatus = desiredEvidenceClass
      ? issuerUniverseForEvidenceClass(desiredEvidenceClass, { ...issuerResolution, issuerUniverse, candidateIssuerUniverse })
      : { blocked: false, issuerUniverse, candidateIssuerUniverse, collectionUniverse: [...issuerUniverse, ...candidateIssuerUniverse] };
    const queryText = metadata.query || query.query || query.text || '';
    const providerRoutePlan = desiredEvidenceClass
      ? routeEvidenceProvider({
        evidenceClass: desiredEvidenceClass,
        query: queryText,
        subject: reportSubjectDisplay(bundle),
        target: connector || reportSubjectDisplay(bundle),
        themes: reportThemes(bundle),
        issuerUniverse: issuerStatus.issuerUniverse || issuerUniverse,
        candidateIssuerUniverse: issuerStatus.candidateIssuerUniverse || candidateIssuerUniverse,
        collectionUniverse: issuerStatus.collectionUniverse || [...issuerUniverse, ...candidateIssuerUniverse],
        metadata: {
          ...metadata,
          candidateId,
          connector,
          reportType: bundle.reportType,
        },
      })
      : null;
    const issuerHints = providerRoutePlan?.collectionUniverse?.length
      ? providerRoutePlan.collectionUniverse
      : (issuerStatus.collectionUniverse || issuerStatus.issuerUniverse || explicitIssuerHints);
    const acceptanceCriteria = query.acceptanceCriteria
      || metadata.acceptanceCriteria
      || providerRoutePlan?.acceptanceCriteria
      || acceptanceCriteriaForEvidenceClass(desiredEvidenceClass);
    const promotionEligible = query.promotionEligible !== undefined
      ? coerceBoolean(query.promotionEligible)
      : (metadata.promotionEligible !== undefined
        ? coerceBoolean(metadata.promotionEligible)
        : (providerRoutePlan ? Boolean(providerRoutePlan.promotionEligible) : promotionEligibleForDraft(desiredEvidenceClass)));
    return {
      queryId: query.queryId || `SQD-${String(index + 1).padStart(3, '0')}`,
      reportId: bundle.reportId,
      bundleId: bundle.bundleId,
      candidateId,
      connector,
      desiredEvidenceClass,
      issuerHints,
      issuerUniverse: issuerHints,
      providerRoutePlan,
      candidateIssuerUniverse: providerRoutePlan?.candidateIssuerUniverse || candidateIssuerUniverse,
      collectionUniverse: providerRoutePlan?.collectionUniverse || issuerHints,
      executableCollectors: providerRoutePlan?.executableCollectors || [],
      sourceProviders: providerRoutePlan?.sourceProviders || [],
      queryVariants: providerRoutePlan?.queryVariants || [],
      acceptanceCriteria,
      promotionEligible,
      text: query.text,
      reason: query.reason || 'Report caveat or information gap requires evidence expansion.',
      claimIds: asArray(query.claimIds),
      evidenceIds: asArray(query.evidenceIds),
      metricIds: asArray(query.metricIds),
      figureIds: asArray(query.figureIds),
      caveatIds: asArray(query.caveatIds),
      metadata: {
        ...metadata,
        candidateId,
        connector,
        desiredEvidenceClass,
        issuerHints,
        issuerUniverse: issuerHints,
        candidateIssuerUniverse: providerRoutePlan?.candidateIssuerUniverse || candidateIssuerUniverse,
        collectionUniverse: providerRoutePlan?.collectionUniverse || issuerHints,
        issuerResolution,
        providerRoutePlan,
        providerRoute: providerRoutePlan?.providerRoute || null,
        sourceProviders: providerRoutePlan?.sourceProviders || [],
        executableCollectors: providerRoutePlan?.executableCollectors || [],
        queryVariants: providerRoutePlan?.queryVariants || [],
        closureState: providerRoutePlan?.blocked ? providerRoutePlan.blockedReason : metadata.closureState || null,
        nextAction: providerRoutePlan?.nextAction || metadata.nextAction || null,
        acceptanceCriteria,
        promotionEligible,
      },
      approvalRequired: query.approvalRequired !== false,
      status: 'draft',
      boundary: 'artifact-only; canonical source queue integration is intentionally deferred',
      generatedAt: analysis.generatedAt || new Date().toISOString(),
    };
  });
}

export function buildReportManifest({
  bundle = {},
  analysis = {},
  validation = {},
  sourceQueryDrafts = [],
  artifactHashes = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const narrativeStructure = analysis.narrativeStructure || analysis.narrativePlan?.narrativeStructure || {};
  return {
    reportId: bundle.reportId,
    bundleId: bundle.bundleId,
    reportType: bundle.reportType,
    subject: bundle.subject,
    generatedAt,
    validationStatus: validation.status,
    quality: validation.quality,
    narrative_structure_provider: narrativeStructure.provider || null,
    narrative_archetype: narrativeStructure.archetype || null,
    section_role_coverage: narrativeStructure.requiredRoleCoverage ?? null,
    adaptive_structure_fallback_reason: narrativeStructure.fallbackReason || null,
    figures: asArray(bundle.figures).map((figure) => ({
      figureId: figure.figureId,
      title: figure.title,
      chartType: figure.chartType,
      renderAssetId: figure.renderAssetId,
      dataHash: hashArtifactContent({
        dataRefIds: figure.dataRefIds,
        supportedClaimIds: figure.supportedClaimIds,
        dataAsOf: figure.dataAsOf,
      }),
    })),
    sourceQueries: {
      artifact: 'source-query-drafts.json',
      count: sourceQueryDrafts.length,
      approvalRequired: sourceQueryDrafts.some((query) => query.approvalRequired),
      boundary: 'artifact-only; no live source registry writes',
    },
    artifacts: {
      bundle: 'bundle.json',
      analysis: 'llm-analysis.json',
      validation: 'validation.json',
      manifest: 'manifest.json',
      html: 'report.html',
      markdown: 'report.md',
      auditAppendixHtml: 'audit_appendix.html',
      auditAppendixJson: 'audit_appendix.json',
      evidenceTableCsv: 'evidence_table.csv',
      sourceQueryDrafts: 'source-query-drafts.json',
    },
    artifactHashes,
  };
}
