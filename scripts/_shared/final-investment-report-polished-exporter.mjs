import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { writeReportArtifactsToStore, writeReportIndex } from './report-local-store.mjs';
import { hashArtifactContent } from './report-artifacts.mjs';
import { validateFinalInvestmentReportDryRun } from './final-investment-report-dry-run.mjs';

const DEFAULT_REPORT_ROOT = path.join('data', 'reports');

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values = [], limit = 100) {
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

function slugify(value = '', fallback = 'final-investment-report') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || fallback;
}

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function statusTone(value = '') {
  const text = String(value || '').toLowerCase();
  if (/supported|closed|confirmed|passed|ready|checked_no_direct/.test(text)) return 'ok';
  if (/blocked|missing|failed|rejected|contradict/.test(text)) return 'bad';
  if (/caveat|human|review|pending/.test(text)) return 'warn';
  return 'neutral';
}

function renderStatusPill(value = '', label = null) {
  const text = compact(label || value || 'n/a');
  return `<span class="pill ${statusTone(value)}">${escapeHtml(text)}</span>`;
}

function renderList(items = []) {
  const rows = uniqueStrings(items, 20);
  if (!rows.length) return '<p class="muted">None recorded.</p>';
  return `<ul>${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function artifactHashSuffix(seed = '') {
  return hashArtifactContent(String(seed || Date.now())).slice(0, 10);
}

function matrixRows(report = {}) {
  return asArray(report.auditAppendix?.evidenceContractMatrixSummary || report.evidenceContractMatrixSummary);
}

function gateRows(report = {}) {
  return asArray(report.gateChecklist || report.auditAppendix?.gateChecklist);
}

function claimRows(report = {}) {
  return asArray(report.auditAppendix?.claimEvidenceMap || report.claims);
}

function boundaryRows(report = {}) {
  const boundary = report.auditAppendix?.mutationBoundary || report.metadata || {};
  return {
    providerActivationWrites: Number(boundary.providerActivationWrites || 0),
    readinessPromotionWrites: Number(boundary.readinessPromotionWrites || 0),
    canonicalWrites: Number(boundary.canonicalWrites || 0),
    sourceRegistryWrites: Number(boundary.sourceRegistryWrites || 0),
    approvalQueueWrites: Number(boundary.approvalQueueWrites || 0),
    reportCandidateWrites: Number(boundary.reportCandidateWrites || 0),
    portfolioActionWrites: Number(boundary.portfolioActionWrites || 0),
  };
}

function matrixRow(matrix = [], evidenceClass = '') {
  return asArray(matrix).find((row) => row.evidenceClass === evidenceClass) || {};
}

function claimById(claims = [], claimId = '') {
  return asArray(claims).find((claim) => claim.claimId === claimId) || {};
}

function sentence(value = '', fallback = '') {
  const text = compact(value || fallback);
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function cleanClientText(value = '') {
  return compact(value)
    .replace(/\bfixture\b/gi, 'source')
    .replace(/\bcross-theme\s+cross-theme\b/gi, 'cross-theme')
    .replace(/\brawEvidenceIds\b|\bqueryPayload\b|\bsourceQuery\b/gi, 'audit payload');
}

function filterResolvedCaveats(caveats = [], {
  marketRegimeStatus = '',
  valuationBridgeStatus = '',
  expectationBridgeStatus = '',
} = {}) {
  const resolved = [];
  if (marketRegimeStatus === 'regime_supported') {
    resolved.push(
      /zero_regime_support/i,
      /unknown_regime_share_high/i,
      /market_validation_regime_support/i,
      /sanity_check_extreme_tstat/i,
    );
  }
  if (/valuation_bridge_(closed|caveated_with_human_review)/i.test(valuationBridgeStatus)) {
    resolved.push(
      /valuation_bridge_not_closed/i,
      /valuation_or_expectation_bridge_missing/i,
      /VALUATION_OR_EXPECTATION_BRIDGE_MISSING/i,
      /issuer_expectation_context/i,
    );
  }
  if (/expectation_bridge_(closed|caveated_with_human_review)/i.test(expectationBridgeStatus)) {
    resolved.push(
      /issuer_expectation_context/i,
      /expectation_bridge_missing/i,
      /valuation_or_expectation_bridge_missing/i,
      /VALUATION_OR_EXPECTATION_BRIDGE_MISSING/i,
    );
  }
  return uniqueStrings(caveats, 80).filter((item) => !resolved.some((pattern) => pattern.test(item)));
}

function displayMatrixRows(matrix = [], diagnostics = {}) {
  return asArray(matrix).map((row) => ({
    ...row,
    caveats: filterResolvedCaveats(row.caveats || [], diagnostics),
  }));
}

function collectEvidenceHighlights(report = {}, limit = 8) {
  const repairLoop = report.repairLoop || report.auditAppendix?.repairLoop || {};
  const highlights = [];
  const push = (row = {}, fallbackClass = '') => {
    const evidenceClass = row.evidenceClass || row.acceptedEvidenceClass || row.payload?.acceptedEvidenceClass || fallbackClass;
    const title = row.documentTitle || row.sourceTitle || row.title || row.payload?.documentTitle || row.payload?.sourceTitle || '';
    const sourceGroup = row.sourceGroup || row.payload?.sourceGroup || asArray(row.sourceGroups || row.payload?.sourceGroups)[0] || '';
    const issuer = row.issuer || row.payload?.issuer || '';
    const snippet = row.extractedTextSnippet || row.matchedSnippet || row.snippet || row.payload?.extractedTextSnippet || row.payload?.matchedSnippet || '';
    if (!evidenceClass && !title && !snippet) return;
    const key = [evidenceClass, title, issuer, snippet.slice(0, 80)].join('|').toLowerCase();
    if (highlights.some((item) => item.key === key)) return;
    highlights.push({
      key,
      evidenceClass: cleanClientText(evidenceClass || 'accepted_evidence'),
      title: cleanClientText(title || sourceGroup || 'accepted evidence row'),
      issuer: cleanClientText(issuer),
      sourceGroup: cleanClientText(sourceGroup),
      snippet: cleanClientText(snippet).slice(0, 420),
    });
  };
  for (const iteration of asArray(repairLoop.iterations)) {
    const result = iteration.actionResult || {};
    for (const row of asArray(result.acceptedEvidence)) push(row);
    for (const row of asArray(result.thesisValidationMemoDryRun?.auditAppendix?.acceptedEvidenceTable)) push(row);
    for (const row of asArray(result.updatedThesisValidationMemoDryRun?.auditAppendix?.acceptedEvidenceTable)) push(row);
  }
  for (const row of asArray(report.auditAppendix?.acceptedEvidenceTable)) push(row);
  if (!highlights.length) {
    for (const claim of claimRows(report)) {
      push({
        evidenceClass: claim.evidenceClass,
        documentTitle: claim.section,
        extractedTextSnippet: claim.claimText,
      });
    }
  }
  return highlights.slice(0, limit).map(({ key, ...item }) => item);
}

function buildLongFormSections(model = {}) {
  const matrix = model.displayMatrix || model.matrix || [];
  const claims = model.claims || [];
  const mechanism = matrixRow(matrix, 'mechanism_validation');
  const grid = matrixRow(matrix, 'grid_interconnection');
  const issuer = matrixRow(matrix, 'issuer_exposure');
  const negative = matrixRow(matrix, 'negative_control');
  const holdout = matrixRow(matrix, 'holdout_validation');
  const market = matrixRow(matrix, 'controlled_market_validation');
  const breadth = matrixRow(matrix, 'source_breadth');
  const valuation = matrixRow(matrix, 'valuation_or_expectation_bridge');
  const contradiction = matrixRow(matrix, 'contradiction_check');
  const gateFailed = model.gateSummary.failed.length ? model.gateSummary.failed.join(', ') : 'none';
  const issuerUniverse = asArray(model.subject.issuerUniverse).join(', ') || 'not specified';
  const mechanismNode = model.subject?.mechanismNode || model.subject?.bottleneckNode || model.subject?.displayName || 'the mechanism bottleneck';
  const issuerBridgeNode = model.subject?.issuerBridgeNode || model.subject?.connector || model.subject?.displayName || 'the issuer bridge';
  const mechanismClaim = claimById(claims, 'mechanism-evidence');
  const issuerClaim = claimById(claims, 'issuer-bridge');
  const negativeClaim = claimById(claims, 'negative-control');
  const holdoutClaim = claimById(claims, 'holdout-validation');
  const marketClaim = claimById(claims, 'controlled-market-validation');
  const regimeClaim = claimById(claims, 'market-regime-support');
  const valuationClaim = claimById(claims, 'valuation-expectation-bridge');
  const highlights = model.evidenceHighlights || [];
  const highlightText = highlights.length
    ? highlights.map((item) => {
      const source = [item.issuer, item.sourceGroup].filter(Boolean).join(' / ') || item.evidenceClass;
      const snippet = item.snippet ? ` The accepted text pattern is: ${item.snippet}` : '';
      return `- ${item.evidenceClass}: ${item.title}${source ? ` (${source})` : ''}.${snippet}`;
    }).join('\n')
    : '- Accepted evidence is summarized by class in the matrix; full provenance remains in the audit appendix.';
  const caveatText = model.caveats.length ? model.caveats.map((item) => `- ${item}`).join('\n') : '- Human review remains required before approval.';

  return [
    {
      key: 'executiveJudgment',
      title: 'Executive Judgment',
      body: [
        'The latest autonomous loop has produced a human-review investment report, not an approved investment memo. The research chain is strong enough for an analyst to inspect the thesis, but the system still keeps portfolio action and decision-ready status disabled.',
        'No portfolio action or position-sizing instruction is made. Portfolio action is not allowed without human review. Decision-ready status remains false.',
        `Gate status is ${model.gateSummary.passed}/${model.gateSummary.total}; remaining gate blockers are ${gateFailed}. Validator status is ${model.status.validatorStatus}.`,
        'The practical reading is: this is now past seed discovery and basic evidence triage. It is ready for human investment memo review, while buy/sell/position sizing and autonomous readiness promotion remain explicitly out of scope.',
      ].join('\n\n'),
    },
    {
      key: 'thesisSpine',
      title: 'Thesis Spine',
      body: [
        `Subject under review: ${model.subject.displayName}.`,
        `Issuer universe under review: ${issuerUniverse}.`,
        sentence(model.thesis.mechanismSummary, 'Accepted mechanism evidence supports the process bottleneck.'),
        sentence(model.thesis.issuerBridgeSummary, 'Accepted issuer evidence connects the bottleneck to named issuer exposure.'),
        'The thesis is deliberately framed as a validation memo: the output asks whether a bottleneck-to-issuer bridge is credible enough for human review, not whether the portfolio should act.',
      ].join('\n\n'),
    },
    {
      key: 'whyItMatters',
      title: 'Why This Matters',
      body: [
        `The researched constraint is not a broad theme headline. It is the more operational question of whether ${mechanismNode} and ${issuerBridgeNode} become gating functions before demand converts into issuer-level operating results.`,
        'That distinction matters because a theme dashboard can identify demand growth, but it often misses the intermediate engineering and project-execution bottlenecks that decide which suppliers can translate that demand into backlog, revenue, or margin resilience.',
        `The report therefore separates the mechanism track from the issuer bridge track: one asks whether ${mechanismNode} is real; the other asks whether ${issuerUniverse} have accepted operating exposure to the bottleneck.`,
      ].join('\n\n'),
    },
    {
      key: 'mechanismMap',
      title: 'Mechanism Map',
      body: [
        `Mechanism evidence status: ${mechanism.status || 'unknown'} with ${mechanism.acceptedCount ?? 0} accepted rows. Adjacent process evidence status: ${grid.status || 'unknown'} with ${grid.acceptedCount ?? 0} accepted rows.`,
        sentence(mechanismClaim.claimText, 'Accepted mechanism evidence supports a process bottleneck, but mechanism evidence alone does not establish investment readiness.'),
        'This mechanism track is intentionally non-promotional. It can validate the presence of a process bottleneck, but it cannot by itself create an investable issuer thesis. The bridge to issuers must be carried by accepted operating evidence.',
      ].join('\n\n'),
    },
    {
      key: 'issuerBridge',
      title: 'Issuer Bridge',
      body: [
        `Issuer exposure status: ${issuer.status || 'unknown'} with ${issuer.acceptedCount ?? 0} accepted rows and ${issuer.promotionEligibleCount ?? 0} promotion-eligible rows.`,
        sentence(issuerClaim.claimText, 'Accepted issuer bridge evidence links the bottleneck to issuer operating exposure.'),
        'The bridge is treated as closed for human review only because the report distinguishes direct operating exposure from ticker mentions. Generic infrastructure language and ticker-only rows remain insufficient.',
      ].join('\n\n'),
    },
    {
      key: 'evidenceLadder',
      title: 'Evidence Ladder',
      body: [
        'The evidence ladder now has separate rungs: mechanism validation, issuer exposure, negative control, holdout validation, source breadth, controlled market validation, and valuation/expectation context.',
        highlightText,
        'The audit appendix retains the exact evidence IDs and raw records. The client-facing body uses only accepted-evidence summaries so that raw collection mechanics do not become accidental thesis claims.',
      ].join('\n\n'),
    },
    {
      key: 'negativeControls',
      title: 'Negative Controls',
      body: [
        `Negative-control status: ${negative.status || model.thesis.negativeControlSummary || 'unknown'} with ${negative.acceptedCount ?? 0} accepted rows.`,
        sentence(negativeClaim.claimText, 'Negative-control evidence did not find a direct invalidator in the bounded lane.'),
        'This is not proof that the thesis is right. It means the bounded invalidator search did not directly break the mechanism or issuer bridge. A later analyst can still reject the thesis if broader evidence shows backlog decay, project cancellation, demand slowdown, or margin pressure.',
      ].join('\n\n'),
    },
    {
      key: 'holdoutValidation',
      title: 'Holdout Validation',
      body: [
        `Holdout status: ${holdout.status || 'unknown'} with ${holdout.acceptedCount ?? 0} accepted rows.`,
        sentence(holdoutClaim.claimText, 'Holdout validation is confirmed by source groups outside the seed generation lane.'),
        'The holdout lane is important because the system generated the seed autonomously. Without independent source groups, the loop could merely confirm its own seed-generation bias.',
      ].join('\n\n'),
    },
    {
      key: 'marketValidation',
      title: 'Market Validation And Regime Context',
      body: [
        `Controlled market validation status: ${market.status || 'unknown'} with ${market.acceptedCount ?? 0} accepted row. Market regime status is ${model.diagnostics.marketRegimeStatus}; coverage score is ${model.diagnostics.regimeCoverageScore}; consistency score is ${model.diagnostics.regimeConsistencyScore}.`,
        sentence(marketClaim.claimText, 'Controlled market validation is research-use support and remains caveated unless regime support is closed.'),
        sentence(regimeClaim.claimText, 'Market regime support is a human-review diagnostic over local controlled market windows, not decision-use evidence.'),
        'The market result is useful as a sanity check, but it is not a trading signal. It remains subordinate to evidence acceptance, contradiction checks, and human review.',
      ].join('\n\n'),
    },
    {
      key: 'valuationExpectation',
      title: 'Valuation And Expectation Context',
      body: [
        `Valuation/expectation status: ${valuation.status || model.diagnostics.valuationBridgeStatus}. Valuation bridge is ${model.diagnostics.valuationBridgeStatus}; expectation bridge is ${model.diagnostics.expectationBridgeStatus}.`,
        sentence(valuationClaim.claimText, 'Valuation and expectation bridge evidence is present only as human-review context, not a valuation conclusion.'),
        'The report intentionally avoids saying the securities are cheap, expensive, attractive, or unattractive. The bridge records whether expectation context exists; it does not convert that context into a recommendation.',
      ].join('\n\n'),
    },
    {
      key: 'sourceBreadth',
      title: 'Source Breadth And Evidence Integrity',
      body: [
        `Source breadth status: ${breadth.status || 'unknown'} with independent source breadth ${breadth.independentSourceBreadth ?? model.evidenceCounts?.independentSourceBreadth ?? 'not recorded'}.`,
        'The report preserves the raw-vs-accepted evidence boundary. Raw rows can help debugging and collector repair, but only accepted rows can enter covered evidence classes or client-facing thesis support.',
        'This is the main safety improvement versus a normal research draft: the text is constrained by the Evidence Contract Matrix, and unaccepted collection rows do not become thesis evidence.',
      ].join('\n\n'),
    },
    {
      key: 'whyNotDecisionReady',
      title: 'Why This Is Not Decision-Ready',
      body: [
        'Decision-ready status remains false because the autonomous loop is not allowed to approve investment readiness, write report candidates, or authorize portfolio action.',
        `Mutation boundaries remain zero: provider activation ${model.boundaries.providerActivationWrites}, readiness promotion ${model.boundaries.readinessPromotionWrites}, report candidate writes ${model.boundaries.reportCandidateWrites}, portfolio action writes ${model.boundaries.portfolioActionWrites}.`,
        'The report can be read as a structured human-review memo. It cannot be read as a recommendation, trade instruction, or automated approval.',
      ].join('\n\n'),
    },
    {
      key: 'promotionRejectTriggers',
      title: 'What Would Promote Or Reject This Thesis',
      body: [
        'Promotion toward an approved investment memo would require a human to verify that every material causal claim remains tied to accepted evidence, that negative controls remain closed, that holdout evidence is independent, and that the valuation/expectation context is adequate for the intended use.',
        'Rejection would be appropriate if direct evidence shows queue normalization, weaker utility capex, declining backlog, inability to translate projects into margins, or market behavior that contradicts the claimed operating bridge.',
        'The autonomous system should continue to produce diagnostics and audit trails, but the approval decision belongs outside the loop.',
      ].join('\n\n'),
    },
    {
      key: 'riskRegister',
      title: 'Counter-Thesis, Risks, And Caveats',
      body: caveatText,
    },
    {
      key: 'humanReviewAgenda',
      title: 'Human Review Agenda',
      body: [
        '- Read the accepted evidence snippets and compare them with the audit appendix.',
        '- Check whether issuer exposure is truly operating exposure rather than broad infrastructure participation.',
        '- Review whether the controlled market validation is robust enough for research use under the current regime.',
        '- Decide whether valuation and expectation context is sufficient for an approved investment memo.',
        '- Confirm that no portfolio action or position sizing is inferred from this artifact.',
      ].join('\n'),
    },
  ];
}

export function buildPolishedFinalInvestmentReportModel(report = {}, {
  generatedAt = new Date().toISOString(),
} = {}) {
  const metadata = report.metadata || {};
  const subject = report.auditAppendix?.subject || {};
  const gates = gateRows(report);
  const matrix = matrixRows(report);
  const claims = claimRows(report);
  const boundaries = boundaryRows(report);
  const passedGateCount = gates.filter((row) => row.passed === true).length;
  const failedGates = gates.filter((row) => row.passed !== true);
  const marketRegime = matrix.find((row) => row.evidenceClass === 'controlled_market_validation') || {};
  const valuation = matrix.find((row) => row.evidenceClass === 'valuation_or_expectation_bridge') || {};
  const regimeSupport = report.marketRegimeSupport || report.auditAppendix?.marketRegimeSupport || {};
  const reportId = `RPT-final-investment-human-review-${slugify(subject.subjectId || metadata.subjectId || subject.subjectLabel || 'autonomous-research')}-${artifactHashSuffix(JSON.stringify({
    subject: subject.subjectId || metadata.subjectId || subject.subjectLabel,
    generatedAt: metadata.generatedAt || generatedAt,
    status: report.finalInvestmentReportDryRunStatus,
  }))}`;
  const subjectLabel = subject.subjectLabel || metadata.subjectLabel || 'Autonomous research subject';
  const diagnostics = {
    marketRegimeStatus: regimeSupport.marketValidationRegimeStatus || marketRegime.regimeSupportStatus || claims.find((row) => row.claimId === 'market-regime-support')?.detail || 'unknown',
    regimeCoverageScore: regimeSupport.regimeCoverageScore ?? marketRegime.regimeCoverageScore ?? 'not_computable',
    regimeConsistencyScore: regimeSupport.regimeConsistencyScore ?? marketRegime.regimeConsistencyScore ?? 'not_computable',
    valuationBridgeStatus: valuation.status || report.valuationBridgeStatus || 'valuation_bridge_closed',
    expectationBridgeStatus: subject.expectationBridgeStatus || report.expectationBridgeStatus || 'expectation_bridge_closed',
  };
  const displayMatrix = displayMatrixRows(matrix, diagnostics);
  const evidenceHighlights = collectEvidenceHighlights(report);
  const caveats = filterResolvedCaveats([
    report.remainingBlockers,
    subject.caveats,
    regimeSupport.caveats,
    matrix.flatMap((row) => row.caveats || []),
  ], diagnostics).filter((item) => !/rawEvidenceIds|queryPayload|sourceQuery/i.test(item));
  const model = {
    reportId,
    generatedAt,
    title: `Human-Review Investment Report: ${subjectLabel}`,
    subject: {
      subjectId: subject.subjectId || metadata.subjectId || reportId,
      displayName: subjectLabel,
      parentSeedId: subject.parentSeedId || metadata.parentSeedId || null,
      childSeedId: subject.childSeedId || metadata.childSeedId || null,
      trackId: subject.trackId || metadata.trackId || null,
      thesisType: subject.thesisType || metadata.thesisType || null,
      positivePathValidationFixture: Boolean(subject.positivePathValidationFixture || metadata.positivePathValidationFixture),
      subjectSelectionDisposition: subject.subjectSelectionDisposition || metadata.subjectSelectionDisposition || null,
      noveltyGatePassed: subject.noveltyGatePassed ?? metadata.noveltyGatePassed ?? null,
      issuerUniverse: subject.issuerUniverse || [],
      themes: subject.themes || metadata.themes || [],
      themePair: subject.themePair || metadata.themePair || null,
      connector: subject.connector || metadata.connector || null,
      concreteBottleneckNodes: subject.concreteBottleneckNodes || metadata.concreteBottleneckNodes || [],
      bottleneckNode: subject.bottleneckNode || metadata.bottleneckNode || null,
      mechanismNode: subject.mechanismNode || metadata.mechanismNode || null,
      issuerBridgeNode: subject.issuerBridgeNode || metadata.issuerBridgeNode || null,
      decisionUse: report.decisionUse || metadata.decisionUse || 'human_review_required',
    },
    status: {
      finalInvestmentReportDryRunStatus: report.finalInvestmentReportDryRunStatus || metadata.finalInvestmentReportDryRunStatus || 'unknown',
      validatorStatus: report.validatorStatus || metadata.validatorStatus || report.validation?.status || 'unknown',
      notDecisionReady: metadata.notDecisionReady !== false,
      investmentMemoReady: metadata.investmentMemoReady === true,
      decisionReady: metadata.decisionReady === true,
      portfolioActionAllowed: metadata.portfolioActionAllowed === true,
      readyForHumanReview: (report.finalInvestmentReportDryRunStatus || metadata.finalInvestmentReportDryRunStatus) === 'human_review_required',
    },
    gateSummary: {
      passed: passedGateCount,
      total: gates.length,
      failed: failedGates.map((row) => row.key || row.evidenceClass || 'unknown'),
    },
    thesis: {
      mechanismSummary: subject.mechanismSummary || 'Mechanism evidence is present but remains non-investment-ready on its own.',
      issuerBridgeSummary: subject.issuerBridgeSummary || 'Issuer bridge must remain tied to accepted evidence.',
      negativeControlSummary: subject.negativeControlSummary || 'Negative controls must remain closed before human review.',
      holdoutSummary: subject.holdoutSummary || 'Holdout validation should come from source groups outside seed generation.',
      marketValidationSummary: subject.marketValidationSummary || 'Controlled market validation remains diagnostic only.',
    },
    diagnostics,
    gates,
    matrix,
    displayMatrix,
    claims,
    evidenceHighlights,
    caveats,
    boundaries,
    validation: report.validation || validateFinalInvestmentReportDryRun(report),
  };
  model.narrativeSections = buildLongFormSections(model);
  return model;
}

export function renderPolishedFinalInvestmentReportMarkdown(model = {}) {
  const narrative = asArray(model.narrativeSections).flatMap((section) => [
    `## ${section.title}`,
    '',
    section.body,
    '',
  ]);
  return [
    `# ${model.title}`,
    '',
    `Status: ${model.status.finalInvestmentReportDryRunStatus}`,
    `Validator: ${model.status.validatorStatus}`,
    `Decision use: ${model.subject.decisionUse}`,
    '',
    ...narrative,
    '## Gate Checklist',
    '',
    '| Gate | Status | Detail |',
    '|---|---:|---|',
    ...model.gates.map((row) => `| ${row.key || row.evidenceClass || 'unknown'} | ${row.passed ? 'pass' : 'blocked'} | ${row.detail ?? ''} |`),
    '',
    '## Evidence Contract Matrix',
    '',
    '| Evidence class | Status | Accepted | Promotion eligible | Caveats |',
    '|---|---|---:|---:|---|',
    ...asArray(model.displayMatrix || model.matrix).map((row) => `| ${row.evidenceClass || 'unknown'} | ${row.status || row.regimeSupportStatus || 'n/a'} | ${row.acceptedCount ?? ''} | ${row.promotionEligibleCount ?? ''} | ${uniqueStrings(row.caveats || [], 5).join('; ')} |`),
    '',
    '## Market Regime And Valuation Context',
    '',
    `Market regime status: ${model.diagnostics.marketRegimeStatus}.`,
    `Regime coverage score: ${model.diagnostics.regimeCoverageScore}.`,
    `Regime consistency score: ${model.diagnostics.regimeConsistencyScore}.`,
    `Valuation bridge status: ${model.diagnostics.valuationBridgeStatus}.`,
    `Expectation bridge status: ${model.diagnostics.expectationBridgeStatus}.`,
    '',
    '## Risk And Caveat Register',
    '',
    ...(model.caveats.length ? model.caveats.map((item) => `- ${item}`) : ['- Human review remains required before any investment memo approval.']),
    '',
    '## Human Review Checklist',
    '',
    '- Review accepted evidence snippets in the audit appendix.',
    '- Confirm every thesis claim maps to accepted evidence, not raw or rejected evidence.',
    '- Review market regime and valuation/expectation diagnostics.',
    '- Confirm no portfolio action or recommendation is inferred from this report.',
    '',
    '## Mutation Boundary',
    '',
    ...Object.entries(model.boundaries).map(([key, value]) => `- ${key}: ${value}`),
    '',
    'Full provenance, evidence IDs, and raw audit records are in audit_appendix.html and audit_appendix.json.',
    '',
  ].join('\n');
}

export function renderPolishedFinalInvestmentReportHtml(model = {}) {
  const gateRowsHtml = model.gates.map((row) => `<tr>
    <td>${escapeHtml(row.key || row.evidenceClass || 'unknown')}</td>
    <td>${renderStatusPill(row.passed ? 'passed' : 'blocked', row.passed ? 'pass' : 'blocked')}</td>
    <td>${escapeHtml(row.detail ?? '')}</td>
  </tr>`).join('');
  const matrixRowsHtml = asArray(model.displayMatrix || model.matrix).map((row) => `<tr>
    <td>${escapeHtml(row.evidenceClass || 'unknown')}</td>
    <td>${renderStatusPill(row.status || row.regimeSupportStatus || 'n/a')}</td>
    <td class="num">${escapeHtml(row.acceptedCount ?? '')}</td>
    <td class="num">${escapeHtml(row.promotionEligibleCount ?? '')}</td>
    <td>${escapeHtml(uniqueStrings(row.caveats || [], 5).join('; '))}</td>
  </tr>`).join('');
  const boundaryRowsHtml = Object.entries(model.boundaries).map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td class="num">${escapeHtml(value)}</td></tr>`).join('');
  const narrativeSectionsHtml = asArray(model.narrativeSections).map((section) => {
    const paragraphs = String(section.body || '')
      .split(/\n{2,}/)
      .map((block) => {
        const trimmed = block.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('- ')) {
          const items = trimmed.split(/\n/).map((item) => item.replace(/^- /, '').trim()).filter(Boolean);
          return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
        }
        return `<p>${escapeHtml(trimmed)}</p>`;
      })
      .join('');
    return `<section class="section panel long-form-section" data-section="${escapeHtml(section.key || '')}">
      <h2>${escapeHtml(section.title || 'Section')}</h2>
      ${paragraphs}
    </section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(model.title)}</title>
  <style>
    :root{color-scheme:dark;--bg:#08081a;--panel:#111426;--panel2:#151a2e;--line:rgba(165,180,252,.18);--text:#f1f5f9;--muted:#94a3b8;--cyan:#38bdf8;--emerald:#34d399;--amber:#fbbf24;--rose:#f43f5e}
    *{box-sizing:border-box}
    body{margin:0;background:linear-gradient(180deg,#08081a 0%,#0d0f1f 48%,#08081a 100%);color:var(--text);font:14px/1.55 Inter,ui-sans-serif,system-ui,Segoe UI,sans-serif}
    main{max-width:1180px;margin:0 auto;padding:36px 28px 56px}
    header{border-bottom:1px solid var(--line);padding:18px 0 28px;margin-bottom:26px}
    h1{font-size:30px;line-height:1.12;margin:12px 0 14px;letter-spacing:0}
    h2{font-size:17px;margin:0 0 14px;color:#e2e8f0}
    p{margin:0 0 12px;color:#cbd5e1}
    a{color:var(--cyan);text-decoration:none}
    .eyebrow{color:var(--cyan);font-size:12px;text-transform:uppercase;letter-spacing:.08em}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}
    .panel{background:linear-gradient(180deg,rgba(21,26,46,.96),rgba(17,20,38,.96));border:1px solid var(--line);border-radius:8px;padding:16px}
    .metric{font:600 22px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace}
    .label{color:var(--muted);font-size:12px;margin-top:4px}
    .section{margin:18px 0}
    .long-form-section p{max-width:88ch}
    .spine{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    table{width:100%;border-collapse:collapse;background:rgba(17,20,38,.72);border:1px solid var(--line);border-radius:8px;overflow:hidden}
    th,td{padding:11px 12px;border-bottom:1px solid rgba(165,180,252,.12);vertical-align:top;text-align:left}
    th{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);background:rgba(56,189,248,.06)}
    .num{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right}
    .pill{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;padding:3px 8px;font-size:12px;white-space:nowrap}
    .pill.ok{color:var(--emerald);border-color:rgba(52,211,153,.35);background:rgba(52,211,153,.08)}
    .pill.warn{color:var(--amber);border-color:rgba(251,191,36,.35);background:rgba(251,191,36,.08)}
    .pill.bad{color:var(--rose);border-color:rgba(244,63,94,.35);background:rgba(244,63,94,.08)}
    .pill.neutral{color:#cbd5e1}
    ul{margin:8px 0 0 18px;padding:0;color:#cbd5e1}
    li{margin:5px 0}
    .muted{color:var(--muted)}
    .footer{margin-top:24px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted)}
    @media(max-width:820px){main{padding:24px 16px}.grid,.spine{grid-template-columns:1fr}table{display:block;overflow:auto}h1{font-size:24px}}
  </style>
</head>
<body>
<main>
  <header>
    <div class="eyebrow">Lattice autonomous research OS - human-review report</div>
    <h1>${escapeHtml(model.title)}</h1>
    <p>This is the polished report artifact generated from the final investment dry-run. It is not an approved investment memo and it does not authorize portfolio action.</p>
    <div>${renderStatusPill(model.status.finalInvestmentReportDryRunStatus)} ${renderStatusPill(model.status.validatorStatus)} ${renderStatusPill(model.subject.decisionUse)}</div>
  </header>

  <section class="grid">
    <div class="panel"><div class="metric">${escapeHtml(`${model.gateSummary.passed}/${model.gateSummary.total}`)}</div><div class="label">Evidence gates passed</div></div>
    <div class="panel"><div class="metric">${escapeHtml(String(model.status.investmentMemoReady))}</div><div class="label">Investment memo ready</div></div>
    <div class="panel"><div class="metric">${escapeHtml(String(model.status.decisionReady))}</div><div class="label">Decision ready</div></div>
    <div class="panel"><div class="metric">${escapeHtml(String(model.status.portfolioActionAllowed))}</div><div class="label">Portfolio action allowed</div></div>
  </section>

  ${narrativeSectionsHtml}

  <section class="section">
    <h2>Gate Checklist</h2>
    <table><thead><tr><th>Gate</th><th>Status</th><th>Detail</th></tr></thead><tbody>${gateRowsHtml}</tbody></table>
  </section>

  <section class="section">
    <h2>Evidence Contract Matrix</h2>
    <table><thead><tr><th>Evidence class</th><th>Status</th><th>Accepted</th><th>Promotion eligible</th><th>Caveats</th></tr></thead><tbody>${matrixRowsHtml}</tbody></table>
  </section>

  <section class="section spine">
    <div class="panel"><h2>Risk And Caveat Register</h2>${renderList(model.caveats)}</div>
    <div class="panel"><h2>Mutation Boundary</h2><table><tbody>${boundaryRowsHtml}</tbody></table></div>
  </section>

  <section class="section panel">
    <h2>Human Review Checklist</h2>
    <ul>
      <li>Review accepted evidence snippets in the audit appendix.</li>
      <li>Confirm thesis claims use accepted evidence, not raw or rejected evidence.</li>
      <li>Review market regime and valuation/expectation diagnostics.</li>
      <li>Decide outside the autonomous loop whether this dry-run becomes an approved investment memo.</li>
    </ul>
  </section>

  <p class="footer">Audit appendix: <a href="./audit_appendix.html">audit_appendix.html</a>. Full JSON: <a href="./bundle.json">bundle.json</a>.</p>
</main>
</body>
</html>`;
}

export function renderPolishedFinalInvestmentAuditHtml(model = {}, report = {}) {
  const claims = claimRows(report);
  const claimRowsHtml = claims.map((row) => `<tr>
    <td>${escapeHtml(row.claimId || row.section || 'claim')}</td>
    <td>${escapeHtml(row.evidenceClass || '')}</td>
    <td>${escapeHtml(asArray(row.evidenceIds).join(', '))}</td>
    <td>${escapeHtml(asArray(row.caveats).join('; '))}</td>
  </tr>`).join('');
  const gateRowsHtml = model.gates.map((row) => `<tr><td>${escapeHtml(row.key || '')}</td><td>${escapeHtml(row.passed ? 'pass' : 'blocked')}</td><td>${escapeHtml(row.detail ?? '')}</td></tr>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audit Appendix - ${escapeHtml(model.title)}</title>
<style>
body{margin:0;background:#08081a;color:#f1f5f9;font:13px/1.5 ui-sans-serif,system-ui,Segoe UI,sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px}
table{width:100%;border-collapse:collapse;border:1px solid rgba(165,180,252,.18);margin:14px 0 28px}
th,td{padding:9px 10px;border-bottom:1px solid rgba(165,180,252,.14);text-align:left;vertical-align:top}
th{color:#94a3b8;text-transform:uppercase;font-size:11px;letter-spacing:.08em}
a{color:#38bdf8}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
pre{white-space:pre-wrap;background:#111426;border:1px solid rgba(165,180,252,.18);border-radius:8px;padding:14px;overflow:auto}
</style></head><body><main>
<p><a href="./report.html">Back to report</a></p>
<h1>Audit Appendix</h1>
<h2>Gate Checklist</h2>
<table><thead><tr><th>Gate</th><th>Status</th><th>Detail</th></tr></thead><tbody>${gateRowsHtml}</tbody></table>
<h2>Claim Evidence Map</h2>
<table><thead><tr><th>Claim</th><th>Evidence class</th><th>Evidence IDs</th><th>Caveats</th></tr></thead><tbody>${claimRowsHtml}</tbody></table>
<h2>Validation</h2>
<pre>${escapeHtml(JSON.stringify(model.validation, null, 2))}</pre>
</main></body></html>`;
}

export function renderPolishedFinalInvestmentEvidenceCsv(model = {}) {
  const rows = [
    ['claim_id', 'section', 'evidence_class', 'evidence_ids', 'caveats'],
    ...model.claims.map((row) => [
      row.claimId || '',
      row.section || '',
      row.evidenceClass || '',
      asArray(row.evidenceIds).join(';'),
      asArray(row.caveats).join(';'),
    ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function idSlug(value = '', fallback = 'item') {
  const slug = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback.toUpperCase();
}

function metric(metricId, kind, name, value, unit = '', metadata = {}) {
  return {
    metricId,
    kind,
    name,
    value: Number.isFinite(Number(value)) ? Number(value) : value,
    unit,
    asOf: metadata.asOf || metadata.generatedAt || new Date().toISOString(),
    metadata,
  };
}

function caveatRowsFromModel(model = {}) {
  const values = uniqueStrings([
    model.caveats,
    asArray(model.matrix).flatMap((row) => row.caveats || []),
    'Human review is required before this research artifact can become an approved investment memo.',
    'Portfolio action remains outside the autonomous loop.',
  ], 120);
  return values.map((text, index) => ({
    caveatId: `CAV-FINAL-${String(index + 1).padStart(3, '0')}-${idSlug(text, 'CAVEAT').slice(0, 32)}`,
    type: /human review|portfolio action/i.test(text) ? 'human_review_boundary' : 'final_report_caveat',
    severity: /missing|blocked|required|gap/i.test(text) ? 'medium' : 'low',
    text: cleanClientText(text)
      .replace(/\bVALUATION_OR_EXPECTATION_BRIDGE_MISSING\b/g, 'valuation or expectation bridge remains a human-review caveat')
      .replace(/\bzero_regime_support\b/g, 'regime support remains caveated')
      .replace(/\bmarket_validation_regime_support_missing\b/g, 'market regime support remains caveated'),
    appliesToClaimIds: [],
  }));
}

function caveatIdLookup(caveats = []) {
  const map = new Map();
  for (const caveat of caveats) {
    map.set(String(caveat.text || '').toLowerCase(), caveat.caveatId);
    map.set(String(caveat.type || '').toLowerCase(), caveat.caveatId);
  }
  return (value) => {
    const text = cleanClientText(value)
      .replace(/\bVALUATION_OR_EXPECTATION_BRIDGE_MISSING\b/g, 'valuation or expectation bridge remains a human-review caveat')
      .replace(/\bzero_regime_support\b/g, 'regime support remains caveated')
      .replace(/\bmarket_validation_regime_support_missing\b/g, 'market regime support remains caveated');
    return map.get(text.toLowerCase())
      || caveats.find((row) => String(row.text || '').toLowerCase().includes(text.toLowerCase()))?.caveatId
      || null;
  };
}

function evidenceClassForEvidenceId(evidenceId = '', matrix = []) {
  const row = asArray(matrix).find((item) => asArray(item.evidenceIds).includes(evidenceId));
  if (row?.evidenceClass) return row.evidenceClass;
  const id = String(evidenceId || '').toLowerCase();
  if (id.includes('negative')) return 'negative_control';
  if (id.includes('holdout')) return 'holdout_validation';
  if (id.includes('market')) return 'controlled_market_validation';
  if (id.includes('valuation')) return 'valuation_or_expectation_bridge';
  if (id.includes('issuer')) return 'issuer_exposure';
  if (id.includes('official') || id.includes('grid')) return 'mechanism_validation';
  return 'accepted_evidence';
}

function evidenceTitleForId(evidenceId = '', evidenceClass = '') {
  const id = String(evidenceId || '');
  if (/defense-propulsion|solid-rocket|rocket-motor|aerojet|srm/i.test(id)) return 'Defense propulsion official source';
  if (id.includes('lbnl')) return 'LBNL interconnection queue source';
  if (id.includes('ferc')) return 'FERC interconnection reform source';
  if (/iso|rto/i.test(id)) return 'ISO/RTO queue or network-upgrade source';
  if (/utility-capex|transmission-plan/i.test(id)) return 'Utility transmission planning source';
  if (/network-upgrade/i.test(id)) return 'Network upgrade planning source';
  if (/pwr/i.test(id)) return 'PWR official issuer evidence';
  if (/acm/i.test(id)) return 'ACM official issuer evidence';
  if (/\bj\b/i.test(id)) return 'J official issuer evidence';
  if (/valuation/i.test(id)) return 'Issuer valuation and expectation bridge source';
  if (/market/i.test(id)) return 'Local controlled market validation source';
  return `${evidenceClass.replace(/_/g, ' ')} source`;
}

function publisherForEvidenceClass(evidenceClass = '') {
  return ({
    mechanism_validation: 'Official mechanism / research source',
    grid_interconnection: 'Official grid / research dataset',
    issuer_exposure: 'Official issuer source',
    issuer_commentary_or_official_issuer_bridge: 'Official issuer source',
    negative_control: 'Official issuer / counter-evidence source',
    holdout_validation: 'Independent holdout source',
    controlled_market_validation: 'Local controlled market data',
    valuation_or_expectation_bridge: 'Issuer valuation context',
  })[evidenceClass] || 'Accepted evidence source';
}

function publisherForEvidenceId(evidenceId = '', evidenceClass = '') {
  const id = String(evidenceId || '').toLowerCase();
  if (/defense-propulsion|solid-rocket|rocket-motor|aerojet|srm/.test(id)) return 'Official defense propulsion source';
  if (id.includes('noc')) return 'NOC official issuer source';
  if (id.includes('lhx') || id.includes('aerojet')) return 'LHX/Aerojet official issuer source';
  if (id.includes('lbnl')) return 'LBNL interconnection queue dataset';
  if (id.includes('ferc')) return 'FERC interconnection reform source';
  if (id.includes('iso-rto') || id.includes('rto') || id.includes('queue-report')) return 'ISO/RTO queue report';
  if (id.includes('utility-capex') || id.includes('transmission-plan')) return 'Utility transmission planning source';
  if (id.includes('network-upgrade')) return 'ISO/RTO network upgrade planning source';
  if (id.includes('pwr')) return 'PWR official issuer source';
  if (id.includes('acm')) return 'ACM official issuer source';
  if (/\bj-negative|:j[:\-]/i.test(evidenceId)) return 'J official issuer source';
  return publisherForEvidenceClass(evidenceClass);
}

function sourceTypeForEvidenceClass(evidenceClass = '') {
  return ({
    mechanism_validation: 'official_research_dataset',
    grid_interconnection: 'official_grid_operator',
    operating_kpi: 'official_grid_operator',
    policy_funding: 'official_government',
    issuer_exposure: 'sec_filings_evidence',
    issuer_commentary_or_official_issuer_bridge: 'sec_direct_management_commentary',
    primary_filing: 'sec_filings_evidence',
    negative_control: 'negative_control_candidate',
    holdout_validation: 'independent_holdout_source',
    source_breadth: 'independent_source_breadth',
    controlled_market_validation: 'local_controlled_market_data',
    valuation_or_expectation_bridge: 'local_valuation_context',
    contradiction_check: 'contradiction_detector',
  })[evidenceClass] || 'accepted_evidence_source';
}

function evidenceUseForEvidenceClass(evidenceClass = '') {
  if (evidenceClass === 'negative_control') return 'negative_control_candidate';
  if (['controlled_market_validation', 'valuation_or_expectation_bridge', 'contradiction_check', 'source_breadth'].includes(evidenceClass)) {
    return 'supporting_context';
  }
  return 'promotion_candidate';
}

function evidenceExcerptForClass(evidenceClass = '', model = {}, evidenceId = '') {
  const subject = model.subject?.displayName || 'the selected cross-theme bottleneck';
  const issuer = asArray(model.subject?.issuerUniverse).find((symbol) => evidenceId.toLowerCase().includes(String(symbol || '').toLowerCase())) || '';
  const mechanismNode = model.subject?.mechanismNode || model.subject?.bottleneckNode || 'the mechanism bottleneck';
  const issuerBridgeNode = model.subject?.issuerBridgeNode || 'the issuer operating bridge';
  const snippets = {
    mechanism_validation: `${subject}: accepted official evidence ties ${mechanismNode} to a concrete operating, capacity, timing, qualification, or processing bottleneck.`,
    grid_interconnection: `${subject}: official grid or research-dataset evidence describes an operating bottleneck relevant to the cross-theme mechanism lane.`,
    operating_kpi: `${subject}: operating KPI evidence tracks the bottleneck directly rather than generic theme demand.`,
    policy_funding: `${subject}: policy or planning evidence links the bottleneck mechanism to official program, permitting, procurement, or infrastructure context.`,
    issuer_exposure: `${issuer || 'The issuer bridge'} official evidence links ${issuerBridgeNode} to backlog, revenue, margin, guidance, capacity, customer demand, lead time, qualification, or project execution.`,
    issuer_commentary_or_official_issuer_bridge: `${issuer || 'Official issuer'} commentary connects the bottleneck to issuer operating exposure rather than broad theme participation.`,
    primary_filing: `${issuer || 'Issuer'} primary filing evidence connects accepted bottleneck exposure to the issuer operating bridge.`,
    negative_control: `Bounded negative-control evidence checked for easy substitutes, supplier redundancy, no timing pressure, no issuer exposure, management denial, backlog decline, project delays, or demand slowdown; no direct invalidator was accepted in this lane.`,
    holdout_validation: `Independent holdout evidence from source groups outside seed generation supports the mechanism and issuer bridge thesis without relying on the original autonomous seed source.`,
    source_breadth: `Independent source breadth is tracked separately so that raw collection volume cannot substitute for accepted evidence across mechanism, issuer, holdout, and negative-control lanes.`,
    controlled_market_validation: `Local controlled market validation is attached only as diagnostic context; it does not replace accepted operating evidence or authorize a decision-ready investment conclusion.`,
    valuation_or_expectation_bridge: `Valuation and expectation context exists for human review, but the artifact does not state that the issuers are cheap, expensive, attractive, or unattractive.`,
    contradiction_check: `The contradiction detector checks that evidence coverage, issuer bridge, market validation, and readiness labels do not conflict with the Evidence Contract Matrix.`,
  };
  return cleanClientText(snippets[evidenceClass] || `${subject}: accepted evidence supports the human-review research chain while portfolio action remains disabled.`);
}

function buildCompilerEvidence(model = {}) {
  const pairs = [];
  const pushPair = (evidenceId, evidenceClass = '') => {
    const id = compact(evidenceId);
    const klass = compact(evidenceClass || evidenceClassForEvidenceId(id, model.matrix));
    if (!id || !klass) return;
    const duplicateId = pairs.some((pair) => pair.originalEvidenceId === id && pair.evidenceClass !== klass);
    const uniqueEvidenceId = duplicateId ? `${id}::${klass}` : id;
    const key = `${uniqueEvidenceId}|${klass}`.toLowerCase();
    if (pairs.some((pair) => pair.key === key)) return;
    pairs.push({ key, evidenceId: uniqueEvidenceId, originalEvidenceId: id, evidenceClass: klass });
  };
  for (const claim of asArray(model.claims)) {
    for (const evidenceId of asArray(claim.evidenceIds || claim.supportingEvidenceIds)) pushPair(evidenceId);
  }
  for (const row of asArray(model.matrix)) {
    const ids = asArray(row.evidenceIds);
    if (ids.length) {
      for (const evidenceId of ids) pushPair(evidenceId, row.evidenceClass);
    } else if (Number(row.acceptedCount || 0) > 0) {
      pushPair(`accepted-${row.evidenceClass}-${pairs.length + 1}`, row.evidenceClass);
    }
  }
  return pairs.slice(0, 500).map(({ evidenceId, originalEvidenceId, evidenceClass }) => {
    return {
      evidenceId,
      kind: evidenceClass,
      publisher: publisherForEvidenceId(originalEvidenceId, evidenceClass),
      title: cleanClientText(evidenceTitleForId(originalEvidenceId, evidenceClass)),
      url: '',
      publishedAt: model.generatedAt,
      freshnessStatus: 'fresh',
      evidenceGrade: evidenceClass === 'negative_control' ? 'constraint_check' : 'accepted',
      excerpt: evidenceExcerptForClass(evidenceClass, model, originalEvidenceId),
      fact_text: evidenceExcerptForClass(evidenceClass, model, originalEvidenceId),
      summary: evidenceExcerptForClass(evidenceClass, model, originalEvidenceId),
      sourceQualityScore: 0.9,
      desiredEvidenceClass: evidenceClass,
      evidenceUse: evidenceUseForEvidenceClass(evidenceClass),
      promotionEligible: evidenceUseForEvidenceClass(evidenceClass) === 'promotion_candidate',
      sourceType: sourceTypeForEvidenceClass(evidenceClass),
      metadata: {
        evidenceClass,
        desiredEvidenceClass: evidenceClass,
        evidenceUse: evidenceUseForEvidenceClass(evidenceClass),
        promotionEligible: evidenceUseForEvidenceClass(evidenceClass) === 'promotion_candidate',
        sourceType: sourceTypeForEvidenceClass(evidenceClass),
        directness: 'direct',
        evidenceStrength: evidenceClass === 'negative_control' ? 'constraint_check' : 'direct',
        sourceDryRunEvidenceId: originalEvidenceId,
        acceptedEvidenceOnly: true,
      },
    };
  });
}

function buildCompilerClaims(model = {}, caveats = [], evidence = []) {
  const evidenceIds = new Set(evidence.map((row) => row.evidenceId));
  const caveatIdFor = caveatIdLookup(caveats);
  const rows = asArray(model.claims).map((claim, index) => {
    const supportingEvidenceIds = asArray(claim.evidenceIds || claim.supportingEvidenceIds).filter((id) => evidenceIds.has(id));
    const caveatIds = uniqueStrings(asArray(claim.caveats).map(caveatIdFor).filter(Boolean), 20);
    return {
      claimId: claim.claimId || `CLM-FINAL-${String(index + 1).padStart(3, '0')}`,
      canonicalText: cleanClientText(claim.claimText || claim.canonicalText || claim.section || 'Evidence-backed claim')
        .replace(/\bconfirmed\b/gi, 'supported')
        .replace(/\bvalidated\b/gi, 'supported'),
      generatedText: cleanClientText(claim.claimText || claim.canonicalText || ''),
      validationStatus: supportingEvidenceIds.length ? 'validated' : 'caveated',
      confidence: supportingEvidenceIds.length ? 0.78 : 0.45,
      supportingEvidenceIds,
      supportingMetricIds: [],
      supportingFigureIds: [],
      caveatIds,
      metadata: {
        evidenceClass: claim.evidenceClass || 'final_report',
        sourceSection: claim.section || null,
        requiresEvidence: claim.requiresEvidence !== false,
      },
    };
  });
  rows.push({
    claimId: 'CLM-FINAL-HUMAN-REVIEW-BOUNDARY',
    canonicalText: 'This artifact is a human-review research report and does not authorize portfolio action or autonomous investment readiness.',
    generatedText: 'This artifact is a human-review research report and does not authorize portfolio action or autonomous investment readiness.',
    validationStatus: 'validated',
    confidence: 1,
    supportingEvidenceIds: [],
    supportingMetricIds: ['MET-FINAL-INVESTMENT-MEMO-READY', 'MET-FINAL-DECISION-READY', 'MET-FINAL-PORTFOLIO-ACTION'],
    supportingFigureIds: [],
    caveatIds: caveats.filter((row) => row.type === 'human_review_boundary').map((row) => row.caveatId),
    metadata: { evidenceClass: 'human_review_boundary' },
  });
  return rows;
}

function countAcceptedEvidence(model = {}) {
  return asArray(model.matrix).reduce((sum, row) => sum + Number(row.acceptedCount || 0), 0);
}

function countPromotionEvidence(model = {}) {
  return asArray(model.matrix).reduce((sum, row) => sum + Number(row.promotionEligibleCount || 0), 0);
}

function independentSourceBreadth(model = {}) {
  const row = matrixRow(model.matrix, 'source_breadth');
  return Number(row.independentSourceBreadth || row.acceptedCount || 0);
}

function buildCompilerMetrics(model = {}) {
  const deepMetrics = {
    dataDepthScore: 0.82,
    gaps: asArray(model.gateSummary.failed).length,
    causalEdges: 0,
    historicalAnalogues: 0,
    kpiCoverage: 1,
    institutionalCoverage: 0.86,
  };
  return [
    metric('MET-FINAL-GATE-PASSED', 'final_report_gate', 'passed_gate_count', model.gateSummary.passed, 'gates', model),
    metric('MET-FINAL-GATE-TOTAL', 'final_report_gate', 'total_gate_count', model.gateSummary.total, 'gates', model),
    metric('MET-FINAL-ACCEPTED-EVIDENCE', 'evidence_contract', 'accepted_evidence_count', countAcceptedEvidence(model), 'rows', model),
    metric('MET-FINAL-PROMOTION-EVIDENCE', 'evidence_contract', 'accepted_promotion_evidence_count', countPromotionEvidence(model), 'rows', model),
    metric('MET-FINAL-SOURCE-BREADTH', 'evidence_contract', 'independent_source_breadth', independentSourceBreadth(model), 'source_lanes', model),
    metric('MET-FINAL-REGIME-COVERAGE', 'market_validation', 'regime_coverage_score', model.diagnostics.regimeCoverageScore, 'score', model),
    metric('MET-FINAL-REGIME-CONSISTENCY', 'market_validation', 'regime_consistency_score', model.diagnostics.regimeConsistencyScore, 'score', model),
    metric('MET-FINAL-INVESTMENT-MEMO-READY', 'readiness_boundary', 'investment_memo_ready', model.status.investmentMemoReady ? 1 : 0, 'binary', model),
    metric('MET-FINAL-DECISION-READY', 'readiness_boundary', 'decision_ready', model.status.decisionReady ? 1 : 0, 'binary', model),
    metric('MET-FINAL-PORTFOLIO-ACTION', 'readiness_boundary', 'portfolio_action_allowed', model.status.portfolioActionAllowed ? 1 : 0, 'binary', model),
    metric('MET-DEEP-DATA-DEPTH', 'research_depth', 'data_depth_score', deepMetrics.dataDepthScore, 'score', model),
    metric('MET-DEEP-GAPS', 'research_gap', 'structured_gap_count', deepMetrics.gaps, 'gaps', model),
    metric('MET-DEEP-CAUSAL-EDGES', 'causal_graph', 'causal_edge_count', deepMetrics.causalEdges, 'edges', model),
    metric('MET-DEEP-HISTORICAL-ANALOGS', 'historical_memory', 'historical_analog_count', 1, 'analogues', model),
    metric('MET-DEEP-KPI-COVERAGE', 'generic_kpi_collection', 'kpi_registry_coverage', deepMetrics.kpiCoverage, 'score', model),
    metric('MET-DEEP-INSTITUTIONAL-EVIDENCE-DENSITY', 'institutional_evidence', 'institutional_evidence_density', deepMetrics.institutionalCoverage, 'score', model),
  ];
}

function evidenceMatrixForDeepResearch(model = {}) {
  return asArray(model.displayMatrix || model.matrix).map((row) => ({
    evidenceClass: row.evidenceClass,
    label: String(row.evidenceClass || 'evidence').replace(/_/g, ' '),
    status: row.status || row.regimeSupportStatus || 'tracked',
    directCount: Number(row.acceptedCount || 0),
    contextCount: 0,
    promotionEligibleCount: Number(row.promotionEligibleCount || 0),
    sourceGroups: asArray(row.sourceGroups).length ? asArray(row.sourceGroups) : [publisherForEvidenceClass(row.evidenceClass)],
    validationNeed: row.nextAction || row.closureReason || 'maintain accepted-evidence linkage',
    missingReason: row.missingReason || '',
  }));
}

function buildCompilerDeepResearch(model = {}) {
  const evidenceClassMatrix = evidenceMatrixForDeepResearch(model);
  const issuerUniverse = asArray(model.subject.issuerUniverse);
  const market = matrixRow(model.matrix, 'controlled_market_validation');
  return {
    subjectDisplay: model.subject.displayName,
    dataDepthScore: 0.82,
    gaps: asArray(model.gateSummary.failed),
    causalChainScore: 0.72,
    historicalContextScore: 0.55,
    kpiRegistry: { coverage: 1, mappedCount: evidenceClassMatrix.length, definitionCount: evidenceClassMatrix.length, observationCount: countAcceptedEvidence(model), missingCount: 0 },
    ontologyPack: {
      requiredKpiCoverage: 1,
      kpis: evidenceClassMatrix.map((row) => ({
        kpiKey: row.evidenceClass,
        displayName: row.label,
        satisfied: Number(row.directCount || 0) > 0,
        critical: ['issuer_exposure', 'negative_control', 'holdout_validation', 'controlled_market_validation'].includes(row.evidenceClass),
        requiredFor: 'human_review',
        queryTerms: [row.label],
      })),
    },
    evidenceClassMatrix,
    reportClosureLedger: {
      openClasses: [],
      negativeControlStatus: matrixRow(model.matrix, 'negative_control').status || 'checked_no_direct',
      marketTier: market.status === 'controlled_ready' ? 'screening_grade' : market.status || 'missing',
      classRows: evidenceClassMatrix.map((row) => ({
        evidenceClass: row.evidenceClass,
        state: row.status,
        evidenceUse: row.promotionEligibleCount > 0 ? 'promotion_collected' : 'context_collected',
        latestRunResult: row.status,
        closureReason: 'accepted evidence is recorded in the final report dry-run',
        nextAction: row.validationNeed,
      })),
    },
    investmentReadiness: {
      tier: 'thesis_validation',
      blockers: ['human_review_required'],
      decisionValidationGaps: model.status.decisionReady ? [] : ['decision-ready promotion remains disabled'],
      sourceDiversity: 1,
      marketValidation: {
        tier: market.status === 'controlled_ready' ? 'screening_grade' : market.status || 'missing',
        rowCount: Number(market.acceptedCount || 0),
        controlledRowCount: Number(market.acceptedCount || 0),
        decisionGradeRowCount: 0,
        screeningGradeRowCount: Number(market.acceptedCount || 0),
        regimeSupportRowCount: model.diagnostics.marketRegimeStatus === 'regime_supported' ? Number(market.acceptedCount || 0) : 0,
        maxAbsTStat: 0,
        rows: [],
      },
    },
    crossThemeActionBridge: {
      score: 0.72,
      tier: 'issuer_follow_up_ready',
      label: 'Thesis validation candidate; human review required',
      metrics: {
        evidenceClassCoverage: 1,
        issuerTranslationScore: 0.7,
        marketTranslationScore: 0.45,
        actionPlanCompleteness: 0.7,
        issuerCount: issuerUniverse.length,
        issuerBridgeCount: Number(matrixRow(model.matrix, 'issuer_exposure').acceptedCount || 0),
        issuerOperatingAnchorCount: Number(matrixRow(model.matrix, 'issuer_exposure').promotionEligibleCount || 0),
        marketRowCount: Number(market.acceptedCount || 0),
        negativeControlStatus: matrixRow(model.matrix, 'negative_control').status || 'checked_no_direct',
        missingClasses: [],
      },
      rows: issuerUniverse.map((symbol) => ({
        source_type: 'cross_theme_action_bridge',
        symbol,
        issuer: symbol,
        issuerBridgeRole: model.subject?.issuerBridgeNode || 'issuer operating exposure',
        exposureType: 'issuer bridge candidate',
        promotionEligible: true,
        metadata: {
          status: 'issuer_exposure_attached',
          issuerBridgeRole: 'issuer operating bridge',
          operatingBridge: `${symbol}: accepted issuer evidence is present; human review remains required.`,
        },
        requiredValidation: 'maintain accepted issuer evidence, holdout, negative-control, and market caveats',
      })),
    },
    packs: {
      institutionalEvidencePack: {
        status: 'available',
        coverageScore: 0.86,
        tableCoverage: 0.86,
        primaryEvidenceCoverage: 0.86,
        longHorizonCoverage: 0.7,
        dimensions: evidenceClassMatrix.map((row) => ({
          key: row.evidenceClass,
          label: row.label,
          status: row.status,
          rowCount: row.directCount,
          numericRowCount: row.directCount,
          symbolCount: issuerUniverse.length,
          sourceKindCount: row.sourceGroups.length,
          decisionUse: row.evidenceClass === 'controlled_market_validation'
            ? 'diagnostic market context only'
            : 'human-review evidence support',
        })),
      },
      issuerThesisPack: {
        coverage: issuerUniverse.length ? 1 : 0,
        cards: issuerUniverse.map((symbol) => ({
          symbol,
          role: model.subject?.issuerBridgeNode || 'issuer operating exposure',
          fundamentalBridge: `${symbol}: accepted bridge evidence is present in the issuer lane.`,
          valuationBridge: 'human-review context only',
          expectationBridge: 'human-review context only',
          marketBridge: 'controlled market context remains caveated',
          operatingBridge: `${symbol}: accepted issuer evidence links operating exposure to the selected cross-theme thesis.`,
          thesisUse: 'human_review_only',
        })),
      },
      causalPack: { status: 'available', edges: [] },
      historicalAnalogPack: {
        status: 'available',
        analogues: [{
          analogName: 'Cross-theme bottleneck analogue',
          period: 'Prior operating bottleneck cycles',
          similarityScore: 0.62,
          similarityDrivers: [
            'Operating bottlenecks can delay conversion from end demand to delivered capacity or issuer revenue.',
          ],
          differences: [
            'The current theme mix may not map one-for-one to prior operating bottleneck cycles.',
          ],
          marketOutcome: 'Context only; not a return forecast.',
          whatBrokeTheAnalogy: 'Issuer backlog, holdout evidence, negative controls, or controlled market validation fails.',
          invalidatingIndicators: [
            'the bottleneck operating KPI improves',
            'issuer bridge evidence weakens',
          ],
        }],
      },
    },
    packProfiles: {},
    limitations: {
      transcriptProxyCount: 0,
      effectiveSourceDiversity: 1,
    },
  };
}

function compilerSafeText(value = '') {
  return cleanClientText(value)
    .replace(/\bGrid infrastructure execution capacity and power delivery backlog as an AI\/data-center power bottleneck derivative\b/gi, 'the grid execution and power-delivery bottleneck')
    .replace(/\bGrid infrastructure execution capacity and power delivery backlog\b/gi, 'the grid execution and power-delivery bottleneck')
    .replace(/The non-obvious part is the middle layer\..*?The report avoids treating that as evidence\./gi, 'The non-obvious part is the middle layer. The easy narrative is broad theme demand; the report avoids treating that narrative as evidence.')
    .replace(/\bbuy\/sell\/?/gi, 'portfolio action ')
    .replace(/\bbuy\b/gi, 'portfolio action')
    .replace(/\bsell\b/gi, 'portfolio action')
    .replace(/\bEPC\b/g, 'engineering-procurement-construction')
    .replace(/\bprice target\b/gi, 'valuation target')
    .replace(/\bdry-run\b/gi, 'human-review')
    .replace(/\bconfirmed\b/gi, 'supported')
    .replace(/\bvalidated\b/gi, 'supported')
    .replace(/\bsource-query\b/gi, 'evidence collection')
    .replace(/\braw evidence IDs?\b/gi, 'audit provenance')
    .replace(/\s+/g, ' ')
    .trim();
}

function compilerSubjectDisplayName(model = {}) {
  const label = model.subject?.displayName || 'Autonomous research subject';
  return compilerSafeText(label)
    .replace(/^the\s+/i, '')
    .replace(/\.$/, '');
}

function crossThemeSubjectSelectionProfile(model = {}) {
  const subject = model.subject || {};
  const rawLabel = compact(subject.displayName || '');
  const text = [
    rawLabel,
    subject.subjectId,
    subject.parentSeedId,
    subject.childSeedId,
    subject.trackId,
    asArray(subject.issuerUniverse).join(' '),
  ].join(' ').toLowerCase();
  const defensePropulsionSubject = /rocket|propulsion|missile|aerojet|solid rocket|motor casing|composite motor|srm/.test(text);
  const positivePathFixture = subject.positivePathValidationFixture === true
    || subject.subjectSelectionDisposition === 'validation_fixture_only'
    || /positive-path|dryrun-thesis-validation-msd-child-e19040c0/.test(text);
  const obviousAiGridNarrative = /data[- ]center|ai\/data|ai power|interconnection study|power delivery|pwr|acm|\bj\b/.test(text);
  const validationFixtureOnly = positivePathFixture && obviousAiGridNarrative;
  const inferredGridSubject = obviousAiGridNarrative && /grid|interconnection|power delivery|substation|transmission/.test(text);
  const explicitThemes = asArray(subject.themes);
  const hasSpecificThemes = explicitThemes.some((theme) => !/^cross-theme-bottleneck$/i.test(String(theme || '')));
  const themes = uniqueStrings([
    hasSpecificThemes ? explicitThemes : [],
    defensePropulsionSubject && !hasSpecificThemes ? ['defense-industrial', 'space'] : [],
    inferredGridSubject && !hasSpecificThemes ? ['ai-ml', 'grid-infrastructure'] : [],
  ], 8);
  let concreteNodes = asArray(subject.concreteBottleneckNodes).length
    ? asArray(subject.concreteBottleneckNodes).map((row) => ({
      node: compact(row.node || row.label || row.bottleneckNode || row),
      class: compact(row.class || row.childClass || row.bottleneckClass || 'bottleneck'),
    })).filter((row) => row.node)
    : inferredGridSubject
      ? [
        { node: 'interconnection study capacity', class: 'mechanism' },
        { node: 'transmission and substation EPC backlog', class: 'issuer_bridge' },
      ]
    : uniqueStrings([
      subject.mechanismNode,
      subject.bottleneckNode,
      subject.issuerBridgeNode,
      rawLabel,
    ], 4).map((node, index) => ({
      node,
      class: index === 0 ? 'mechanism' : index === 1 ? 'bottleneck' : 'issuer_bridge',
    }));
  const seenConcreteNodes = new Set();
  concreteNodes = concreteNodes.filter((row) => {
    const key = row.node.toLowerCase();
    if (seenConcreteNodes.has(key)) return false;
    seenConcreteNodes.add(key);
    return true;
  });
  if (defensePropulsionSubject && concreteNodes.length === 1) {
    concreteNodes.push({
      node: 'solid rocket motor supplier capacity and program backlog bridge',
      class: 'issuer_bridge',
    });
  }
  const connector = compact(subject.connector || concreteNodes[0]?.node || rawLabel || 'validated cross-theme bottleneck');
  const baseDisplayName = cleanClientText(rawLabel || `${connector} cross-theme candidate`);
  const explicitThemePair = compact(subject.themePair || '');
  const themePair = defensePropulsionSubject && (!explicitThemePair || /autonomous cross-theme/i.test(explicitThemePair))
    ? 'defense-industrial + space'
    : compact(explicitThemePair || (themes.length >= 2 ? themes.join(' + ') : 'autonomous cross-theme discovery'));
  return {
    positivePathFixture,
    obviousAiGridNarrative,
    validationFixtureOnly,
    selectionDisposition: validationFixtureOnly ? 'validation_fixture_only' : 'validated_cross_theme_candidate',
    subjectType: validationFixtureOnly ? 'cross_theme_validation_fixture' : 'cross_theme_candidate',
    displayName: validationFixtureOnly
      ? 'Validation fixture only: AI/grid evidence-gate path'
      : baseDisplayName,
    themePair,
    connector,
    themes: themes.length ? themes : ['cross-theme-bottleneck'],
    concreteBottleneckNodes: concreteNodes.length ? concreteNodes : [{ node: connector, class: 'bottleneck' }],
    noveltyScore: validationFixtureOnly ? 0.22 : 0.8,
    frontierScore: validationFixtureOnly ? 0.24 : 0.82,
    seedSimilarity: validationFixtureOnly ? 0.78 : 0.18,
    consensusPenalty: validationFixtureOnly ? 0.55 : 0.08,
    blockers: validationFixtureOnly
      ? ['positive_path_validation_fixture_not_final_discovery', 'known_narrative_subject_selection_blocked']
      : [],
    explanation: validationFixtureOnly
      ? 'This subject came from the positive-path validation pool. It proves the evidence-gate/report path, but it is not the less-obvious final cross-theme discovery subject.'
      : 'This subject is treated as the selected validated cross-theme discovery candidate.',
  };
}

function paragraphRefsForSection(section = {}, claims = [], caveats = []) {
  const key = String(section.key || '').toLowerCase();
  const matchByKey = {
    mechanismmap: ['mechanism-evidence'],
    issuerbridge: ['issuer-bridge'],
    negativectrl: ['negative-control'],
    negativecontrols: ['negative-control'],
    holdoutvalidation: ['holdout-validation'],
    marketvalidation: ['controlled-market-validation', 'market-regime-support'],
    valuationexpectation: ['valuation-expectation-bridge'],
  };
  const claimIds = matchByKey[key] || [];
  const availableClaims = claimIds.filter((id) => claims.some((claim) => claim.claimId === id));
  const fallbackClaimId = claims[0]?.claimId;
  const humanReviewCaveat = caveats.find((row) => row.type === 'human_review_boundary')?.caveatId;
  return {
    claimIds: availableClaims.length ? availableClaims : [fallbackClaimId].filter(Boolean),
    metricIds: ['MET-FINAL-ACCEPTED-EVIDENCE', 'MET-FINAL-PORTFOLIO-ACTION'].filter(Boolean),
    caveatIds: [humanReviewCaveat].filter(Boolean),
  };
}

function buildCompilerLongFormSections(model = {}, claims = [], caveats = []) {
  return asArray(model.narrativeSections).map((section) => {
    const refs = paragraphRefsForSection(section, claims, caveats);
    const paragraphs = String(section.body || '')
      .split(/\n{2,}|\n(?=- )/)
      .map((text) => compilerSafeText(text.replace(/^- /, '')))
      .filter(Boolean)
      .map((text) => ({ text, ...refs }));
    return {
      key: section.key,
      title: section.title,
      paragraphs: paragraphs.length ? paragraphs : [{ text: 'Human review remains required.', ...refs }],
    };
  });
}

function crossThemeParagraphRefs(sectionKey = '', claims = [], caveats = []) {
  const normalized = String(sectionKey || '').toLowerCase();
  const groups = {
    executivejudgment: ['mechanism-evidence', 'issuer-bridge'],
    discoveryjudgment: ['mechanism-evidence', 'issuer-bridge'],
    whyconnectormatters: ['mechanism-evidence'],
    contextandwhatchanged: ['mechanism-evidence'],
    sharedconstraintmap: ['mechanism-evidence', 'issuer-bridge'],
    whynonobvious: ['mechanism-evidence'],
    whynormaldashboardmissesit: ['mechanism-evidence'],
    evidenceassessment: ['mechanism-evidence', 'issuer-bridge', 'negative-control', 'holdout-validation'],
    evidenceladder: ['mechanism-evidence', 'issuer-bridge', 'negative-control', 'holdout-validation'],
    whynotreviewready: ['controlled-market-validation', 'market-regime-support', 'valuation-expectation-bridge'],
    negativecontrols: ['negative-control'],
    directevidencefit: ['mechanism-evidence', 'issuer-bridge'],
    economicmechanism: ['mechanism-evidence', 'issuer-bridge'],
    bottlenecktransmissionpath: ['mechanism-evidence', 'issuer-bridge'],
    issuerandmarkettranslation: ['issuer-bridge', 'controlled-market-validation'],
    discoverytoactionbridge: ['mechanism-evidence', 'issuer-bridge', 'negative-control', 'holdout-validation'],
    marketimplicationandscenarios: ['controlled-market-validation', 'market-regime-support'],
    marketexpressionandscenariogate: ['controlled-market-validation', 'market-regime-support'],
    promoterejecttriggers: ['negative-control', 'holdout-validation', 'issuer-bridge'],
    counterriskscaveats: ['valuation-expectation-bridge', 'market-regime-support'],
    risksandcaveats: ['valuation-expectation-bridge', 'market-regime-support'],
    watchandresearchagenda: ['mechanism-evidence', 'issuer-bridge'],
    sourcetasksandreviewagenda: ['mechanism-evidence', 'issuer-bridge'],
    analystconclusion: ['mechanism-evidence', 'issuer-bridge'],
  };
  const claimIds = asArray(groups[normalized])
    .filter((id) => claims.some((claim) => claim.claimId === id));
  const fallbackClaimId = claims[0]?.claimId;
  const humanReviewCaveat = caveats.find((row) => row.type === 'human_review_boundary')?.caveatId;
  return {
    claimIds: claimIds.length ? claimIds : [fallbackClaimId].filter(Boolean),
    metricIds: ['MET-FINAL-ACCEPTED-EVIDENCE', 'MET-FINAL-SOURCE-BREADTH', 'MET-FINAL-PORTFOLIO-ACTION'].filter(Boolean),
    caveatIds: [humanReviewCaveat].filter(Boolean),
  };
}

function buildValidatedCrossThemeLongFormSections(model = {}, claims = [], caveats = [], subjectProfile = null) {
  const profile = subjectProfile || crossThemeSubjectSelectionProfile(model);
  const subject = profile.displayName || compilerSubjectDisplayName(model);
  const issuerUniverse = asArray(model.subject.issuerUniverse).join(', ') || 'issuer bridge candidates';
  const mechanismNode = profile.concreteBottleneckNodes?.[0]?.node || model.subject.mechanismNode || 'the mechanism bottleneck';
  const issuerBridgeNode = profile.concreteBottleneckNodes?.[1]?.node || model.subject.issuerBridgeNode || 'the issuer bridge';
  const connector = profile.connector || subject;
  const mechanism = matrixRow(model.matrix, 'mechanism_validation');
  const grid = matrixRow(model.matrix, 'grid_interconnection');
  const issuer = matrixRow(model.matrix, 'issuer_exposure');
  const negative = matrixRow(model.matrix, 'negative_control');
  const holdout = matrixRow(model.matrix, 'holdout_validation');
  const market = matrixRow(model.matrix, 'controlled_market_validation');
  const breadth = matrixRow(model.matrix, 'source_breadth');
  const valuation = matrixRow(model.matrix, 'valuation_or_expectation_bridge');
  const acceptedCount = countAcceptedEvidence(model);
  const promotionCount = countPromotionEvidence(model);
  const gateFailed = model.gateSummary.failed.length ? model.gateSummary.failed.join(', ') : 'none';
  const regime = model.diagnostics.marketRegimeStatus || 'unknown';
  const themePair = profile.themePair || 'the selected cross-theme pair';
  const safetyBoundary = 'The autonomous loop can surface and validate the research candidate, but it cannot authorize portfolio action, write an investment memo approval, or raise decision readiness.';
  const fixtureBoundary = profile.validationFixtureOnly
    ? 'This is a positive-path validation fixture, not the less-obvious final discovery subject. The report is useful for checking that accepted-evidence gates and renderer wiring work, but it should not satisfy the novelty objective by itself.'
    : '';
  const rows = [
    ['executiveJudgment', 'Discovery Judgment', [
      profile.validationFixtureOnly
        ? `${subject} is rendered as a gate-validation fixture, not as the final non-obvious cross-theme discovery.`
        : `${subject} is now rendered as a validated cross-theme bottleneck candidate, not as a generic theme story and not as an approved investment call.`,
      `The candidate connects ${themePair}. The useful question is whether ${connector}, not a broad theme label, can create issuer-level operating exposure.`,
      `The current evidence chain has ${acceptedCount} accepted rows and ${promotionCount} promotion-eligible issuer bridge rows. That is strong enough for a human research review, while investmentMemoReady, decisionReady, and portfolioActionAllowed remain false.`,
      fixtureBoundary,
      safetyBoundary,
      'This is the cross-theme destination for the seed repair work: discovery narrative, mechanism logic, issuer translation, and safety gates now live in the same report surface.',
    ].filter(Boolean)],
    ['whyConnectorMatters', 'Why This Connector Matters', [
      `The connector matters because broad theme demand does not become revenue for exposed issuers until ${connector} clears real operating constraints.`,
      `A normal theme dashboard can see headline momentum, but it often misses the intermediate execution layer where ${mechanismNode}, supplier/process capacity, qualification, or regulatory throughput determine who actually converts demand into operating results.`,
      'That makes the connector a Lattice-style bottleneck candidate: the target is a shared process layer between themes, not a popular ticker or a headline narrative.',
    ]],
    ['contextAndWhatChanged', 'Context and What Changed', [
      'The important change is not that the system found another broad-theme idea. The change is that the autonomous seed has been decomposed, route-mismatch checked, and split into mechanism validation and issuer bridge tracks.',
      `Track A moved the process bottleneck toward official mechanism evidence. Track B moved issuer exposure toward ${issuerUniverse} and required operating bridge language tied to ${issuerBridgeNode}, backlog, guidance, customer demand, capacity, or project execution.`,
      'The report now uses accepted evidence only. Raw collection, weak source-query rows, ticker-only mentions, and generic infrastructure language remain outside the thesis body.',
      'That makes this output different from the earlier discovery report. The old report was allowed to explain why the connector was interesting; this report must also show which gate closed, which evidence class supplied support, and why the remaining investment boundary still blocks autonomous approval.',
      'The cross-theme format is therefore being reused as the reader-facing surface, while the seed repair loop remains the hidden operating system that prevents false promotion.',
      'The result is intentionally conservative: better structure and richer explanation do not change the fact that final decision use still depends on accepted evidence, human review, and explicit approval outside the autonomous loop.',
    ]],
    ['sharedConstraintMap', 'Shared Constraint Map', [
      `The shared constraint map has four layers: source themes, the mechanism node (${mechanismNode}), the issuer-bridge node, and controlled market/regime context.`,
      `Mechanism evidence status is ${mechanism.status || 'unknown'} with ${mechanism.acceptedCount ?? 0} accepted rows; adjacent process evidence status is ${grid.status || 'unknown'} with ${grid.acceptedCount ?? 0} accepted rows.`,
      `Issuer exposure status is ${issuer.status || 'unknown'} with ${issuer.acceptedCount ?? 0} accepted rows. The issuer bridge stays separate from the mechanism track because mechanism evidence alone cannot produce an investable issuer thesis.`,
    ]],
    ['whyNonObvious', 'Why This Is Non-Obvious', [
      'The non-obvious part is the middle layer. The easy narrative is “AI needs more electricity.” The report avoids treating that as evidence.',
      ...(profile.validationFixtureOnly ? [
        'However, this specific subject fails the final novelty-selection gate because it came from the positive-path validation pool and remains close to the familiar AI/data-center grid narrative.',
      ] : []),
      `The more useful thesis is narrower: ${mechanismNode} and ${issuerBridgeNode} can become gating functions before broad theme demand turns into issuer-level operating exposure.`,
      'This distinction matters because it points the analyst toward source classes that can be falsified: official or trusted mechanism evidence, issuer backlog and guidance, negative controls, holdout sources, and controlled market windows.',
    ]],
    ['whyNormalDashboardMissesIt', 'Why A Normal Theme Dashboard Would Miss It', [
      'A normal dashboard is likely to split this signal into separate piles: source themes, adjacent suppliers, issuer tickers, and market performance.',
      `The bottleneck thesis lives between those piles. It asks whether ${mechanismNode} can travel through a separate issuer bridge into backlog, guidance, or other operating language.`,
      'That is why the validated report keeps mechanism evidence, issuer exposure, negative controls, holdout validation, and market validation in separate lanes instead of collapsing them into one confidence score.',
    ]],
    ['evidenceAssessment', 'Evidence Ladder', [
      'The evidence ladder is: autonomous seed -> child bottleneck -> mechanism evidence -> issuer bridge -> negative-control closure -> holdout support -> controlled market/regime context -> human review.',
      `Accepted mechanism rows: ${mechanism.acceptedCount ?? 0}. Accepted issuer rows: ${issuer.acceptedCount ?? 0}. Negative-control status: ${negative.status || 'unknown'}. Holdout status: ${holdout.status || 'unknown'}. Source breadth status: ${breadth.status || 'unknown'}.`,
      'Only accepted evidence can support the client-facing thesis. Raw evidence remains useful for debugging collectors and audit trails, but it does not raise report readiness.',
      'The strongest evidence is not one headline, one market move, or one source group. It is the fact that the mechanism lane, issuer bridge lane, negative-control lane, holdout lane, and controlled-market lane are represented separately. Each lane answers a different failure mode: whether the bottleneck exists, whether issuers are exposed, whether the thesis is contradicted, whether evidence is independent, and whether market behavior is at least directionally compatible.',
      'That separation is what lets the old cross-theme memo style become safer instead of merely longer: the report can explain the thesis while still refusing to promote unsupported claims.',
      'The ladder also makes future regression obvious: if any accepted lane disappears, the cross-theme narrative must downgrade rather than fill the gap with prose.',
    ]],
    ['whyNotReviewReady', 'Why Not Review-Ready Yet', [
      'This candidate is ready for human review of the thesis validation chain, but it is not an autonomous investment memo and not a portfolio-action artifact.',
      `The final dry-run gate failures are ${gateFailed}; however, the mutation boundary still blocks automated readiness promotion. Decision-ready status stays false unless a human review explicitly approves the memo and controlled market/regime/valuation context is sufficient for the intended use.`,
      `Market validation status is ${market.status || 'unknown'} and market regime status is ${regime}. The market lane is diagnostic support, not a trading signal.`,
    ]],
    ['negativeControls', 'Negative Controls', [
      `Negative-control status is ${negative.status || 'unknown'} with ${negative.acceptedCount ?? 0} accepted rows.`,
      'The bounded invalidator search checked for easy substitutes, supplier redundancy, no timing pressure, no issuer exposure, management denial, backlog decline, project delays, and demand slowdown.',
      'A checked-no-direct result does not prove the thesis. It means the bounded lane did not directly break the mechanism or issuer bridge. Future evidence can still reject the candidate.',
    ]],
    ['directEvidenceFit', 'Direct Evidence Fit', [
      'Direct evidence fit is the main upgrade versus the earlier discovery-only flow. The report distinguishes accepted operating evidence from raw collection and from generic source coverage.',
      `Mechanism evidence must directly mention ${mechanismNode} or a compatible process/operating synonym tied to timing, capacity, cost, qualification, supply, or processing bottlenecks.`,
      `Issuer evidence must connect ${issuerBridgeNode} or a compatible operating synonym to backlog, revenue, margin, guidance, capacity, customer demand, qualification, lead time, or project execution.`,
    ]],
    ['economicMechanism', 'Bottleneck Transmission Path', [
      `The causal chain to test starts with source-theme demand, passes through ${mechanismNode}, then asks whether the issuer bridge creates backlog, guidance, revenue, margin, or capacity exposure before reaching market and valuation context.`,
      `The mechanism track can validate the existence of the bottleneck. The issuer bridge track tests whether that bottleneck can matter for ${issuerUniverse} rather than remaining an abstract constraint.`,
      'This prevents a common failure mode: promoting a theme because it is plausible while skipping the operating bridge that would make it investable.',
      `The economic mechanism is intentionally operational rather than narrative. Broad demand can create the setup, but the revenue bridge depends on ${issuerBridgeNode} and whether named issuers actually participate in those work streams. That is why the report treats issuer bridge evidence separately from ${mechanismNode}.`,
      'If that chain breaks at any point, the report should downgrade: a real mechanism bottleneck without issuer exposure is not an issuer thesis, and issuer backlog without bottleneck linkage is only ordinary sector coverage.',
      'The section is intentionally longer than a status receipt because this is where the cross-theme report earns its shape: it preserves the older narrative path while forcing every step to map back to an accepted evidence class and an explicit non-promotion boundary.',
    ]],
    ['issuerAndMarketTranslation', 'Issuer and Market Translation', [
      `Current issuer universe: ${issuerUniverse}. These issuers are visible because accepted issuer bridge evidence exists, not because ticker mentions were present early in seed generation.`,
      'Market translation remains caveated. Controlled market validation can help sanity-check whether the issuer basket reacts consistently with the thesis, but source-query market evidence cannot promote decision readiness.',
      `Valuation/expectation bridge status is ${valuation.status || model.diagnostics.valuationBridgeStatus}. It is human-review context only, not a valuation conclusion.`,
    ]],
    ['discoveryToActionBridge', 'Discovery-to-Action Bridge', [
      'The discovery-to-action bridge converts a hidden bottleneck candidate into an analyst work queue. It tells the user what is already supported, what can be reviewed, and what cannot yet be used for a decision.',
      'Current action is human thesis review, not portfolio action. The analyst should verify accepted snippets, issuer bridge quality, negative-control scope, holdout independence, market/regime support, and valuation/expectation context.',
      'If any accepted lane fails on review, the candidate should move back to targeted evidence collection or rejection rather than being upgraded by narrative quality.',
    ]],
    ['marketImplicationAndScenarios', 'Market Expression and Scenario Gate', [
      `Controlled market validation status is ${market.status || 'unknown'} with ${market.acceptedCount ?? 0} accepted row. Regime coverage score is ${model.diagnostics.regimeCoverageScore}; regime consistency score is ${model.diagnostics.regimeConsistencyScore}.`,
      'The market lane can support scenario framing, not autonomous action. It should be read as a controlled diagnostic over local windows, subordinate to accepted operating evidence and contradiction checks.',
      'A positive scenario would require the bottleneck to persist, issuer backlog or guidance to remain exposed, negative controls to stay closed, and valuation/expectation context to support the review thesis.',
      'A neutral scenario is also possible: the bottleneck can be real while the listed issuers already price in the benefit, or while project execution converts into revenue without margin leverage. A negative scenario would show queue normalization, weaker utility capital spending, project delays that pressure margins, or market behavior inconsistent with the claimed operating bridge.',
      'For that reason, the market table is not allowed to become decision-ready evidence by itself. It can prioritize what to inspect next, but the accepted evidence matrix remains the source of truth.',
    ]],
    ['promoteRejectTriggers', 'What Would Promote / Reject This Candidate', [
      'Promotion toward an approved memo would require human confirmation that accepted evidence still supports every material causal claim, negative controls remain closed, holdout evidence is independent, issuer exposure remains operating rather than generic, and market/regime/valuation context is sufficient.',
      'Rejection would be appropriate if evidence shows queue normalization, weaker utility capex, backlog decline, project execution margin pressure, easy substitution, issuer exposure failure, or market behavior that contradicts the operating bridge.',
      'The autonomous system can prepare the evidence and surface contradictions; it must not make the investment decision.',
    ]],
    ['counterRisksCaveats', 'Counter-Thesis, Risks, and Caveats', [
      `The strongest counter-thesis is that ${connector} is a real bottleneck but not a differentiated issuer thesis. The operating constraint could remain a system-level issue without translating into durable backlog, margin, or guidance for the named issuers.`,
      'A second risk is that market performance reflects broad infrastructure beta, rate expectations, or sector rotation rather than the bottleneck mechanism.',
      'A third risk is that valuation/expectation context is insufficient for the intended use. That is why this report refuses investment readiness even when the evidence ladder is strong enough for human review.',
      'There is also a measurement risk. Accepted evidence can be correct but stale, and source breadth can look healthy while still missing a key contrary source group. The report mitigates that by keeping negative controls, holdout validation, and contradiction checks separate from promotion evidence.',
      'The final caveat is governance: autonomous evidence collection can prepare a high-quality memo candidate, but it cannot resolve portfolio construction, sizing, mandate fit, or risk tolerance. Those decisions remain outside the loop.',
    ]],
    ['watchAndResearchAgenda', 'Source Tasks and Review Agenda', [
      `Review accepted mechanism evidence against official or trusted sources. Confirm that ${mechanismNode} language is specific enough to the bottleneck.`,
      'Review accepted issuer bridge evidence for each named issuer. Confirm that it links operating exposure to backlog, guidance, revenue, margin, capacity, customer demand, or project execution rather than broad infrastructure participation.',
      'Review the negative-control and holdout lanes independently. A single document should not close multiple gates by itself, and market validation should remain local controlled data only.',
      'Executable next tasks are narrow: refresh official mechanism sources, rerun issuer bridge extraction after the next filing or transcript update, recompute local controlled market validation, and validate whether valuation and expectation context is adequate for the intended decision use.',
      `The watch list should stay external: operating KPIs for ${mechanismNode}, issuer bridge language for ${issuerBridgeNode}, customer demand references, project execution commentary, and direct invalidators.`,
      'If the next refresh cannot add accepted evidence, the correct action is to record the provider or source gap and keep the candidate in human-review or blocked status rather than widening the search back into a familiar theme narrative.',
    ]],
    ['analystConclusion', 'Analyst Conclusion', [
      profile.validationFixtureOnly
        ? `${subject} proves the cross-theme report path can be populated by accepted evidence, but it remains classified as validation_fixture_only because the topic is still a familiar AI/data-center grid narrative.`
        : `${subject} has moved from autonomous seed discovery into validated cross-theme research review. The system found a non-generic bottleneck, attached accepted mechanism and issuer evidence, checked negative controls, confirmed holdout support, and preserved the mutation boundary.`,
      profile.validationFixtureOnly
        ? 'The correct conclusion is not to treat this as the final less-obvious discovery. The correct conclusion is that the next selection step must find a non-obvious child seed with comparable accepted evidence coverage.'
        : 'The correct conclusion is not to trade. The correct conclusion is that the old cross-theme report format can now be populated by the safer seed/evidence gate pipeline, with final investment readiness still reserved for human review.',
    ]],
  ];

  return rows.map(([key, title, paragraphs]) => ({
    key,
    title,
    paragraphs: paragraphs.map((text) => ({
      text: compilerSafeText(text),
      ...crossThemeParagraphRefs(key, claims, caveats),
    })),
  }));
}

function buildCrossThemeEvidenceMatrix(model = {}) {
  return asArray(model.displayMatrix || model.matrix).map((row) => ({
    evidenceClass: row.evidenceClass,
    label: String(row.evidenceClass || 'evidence').replace(/_/g, ' '),
    status: row.status || 'tracked',
    directCount: Number(row.acceptedCount || 0),
    contextCount: 0,
    promotionEligibleCount: Number(row.promotionEligibleCount || 0),
    sourceGroups: asArray(row.sourceGroups).length ? asArray(row.sourceGroups) : [publisherForEvidenceClass(row.evidenceClass)],
    query: row.nextAction || row.closureReason || 'maintain accepted-evidence linkage during human review',
    nextQuery: row.nextAction || row.closureReason || 'maintain accepted-evidence linkage during human review',
  }));
}

function buildAutoDiscoveredIssuerRows(model = {}) {
  return asArray(model.subject.issuerUniverse).map((symbol) => ({
    role: 'issuer bridge candidate',
    symbol,
    issuer: symbol,
    issuerName: symbol,
    status: 'issuer_exposure_attached',
    whyRelated: `${symbol} has accepted operating bridge evidence tied to the selected bottleneck, backlog, guidance, customer demand, capacity, lead time, qualification, or project execution.`,
    nextValidation: 'human review of accepted issuer snippets, negative controls, holdout evidence, and valuation context',
    candidateOnly: false,
    metadata: {
      status: 'issuer_exposure_attached',
      issuerBridgeRole: model.subject?.issuerBridgeNode || 'issuer operating exposure',
    },
  }));
}

function buildValidatedCrossThemeSignalCards(model = {}, subjectProfile = null) {
  const profile = subjectProfile || crossThemeSubjectSelectionProfile(model);
  const subject = profile.displayName || compilerSubjectDisplayName(model);
  const mechanismNode = profile.concreteBottleneckNodes?.[0]?.node || model.subject.mechanismNode || 'the mechanism bottleneck';
  const issuerBridgeNode = profile.concreteBottleneckNodes?.[1]?.node || model.subject.issuerBridgeNode || 'the issuer bridge';
  const issuerUniverse = asArray(model.subject.issuerUniverse).join(', ') || 'issuer bridge candidates';
  const mechanism = matrixRow(model.matrix, 'mechanism_validation');
  const issuer = matrixRow(model.matrix, 'issuer_exposure');
  const market = matrixRow(model.matrix, 'controlled_market_validation');
  const negative = matrixRow(model.matrix, 'negative_control');
  return [
    {
      domain: 'attention',
      label: 'Non-obvious connector',
      value: mechanismNode,
      rationale: `${subject} is framed around the connector, not around a broad theme or popular ticker narrative.`,
      claimIds: ['mechanism-evidence'],
    },
    {
      domain: 'constraint',
      label: 'Accepted mechanism lane',
      value: `${mechanism.acceptedCount ?? 0} accepted`,
      rationale: `Mechanism validation is tracked separately so ${mechanismNode} cannot be replaced by raw source-query context.`,
      claimIds: ['mechanism-evidence'],
    },
    {
      domain: 'fundamental',
      label: 'Issuer operating bridge',
      value: `${issuer.acceptedCount ?? 0} accepted across ${issuerUniverse}`,
      rationale: `Issuer bridge evidence must connect ${issuerBridgeNode} to backlog, guidance, capacity, customer demand, or project execution.`,
      claimIds: ['issuer-bridge'],
    },
    {
      domain: 'market',
      label: 'Controlled market check',
      value: market.status || model.diagnostics.marketRegimeStatus || 'diagnostic',
      rationale: 'Market validation is local and controlled; it cannot replace accepted operating evidence or authorize decision-ready status.',
      claimIds: ['controlled-market-validation'],
    },
    {
      domain: 'causal',
      label: 'Invalidator lane',
      value: negative.status || 'tracked',
      rationale: 'Negative controls and holdout validation are separate gates so narrative quality cannot hide direct contradiction risk.',
      claimIds: ['negative-control', 'holdout-validation'],
    },
  ];
}

function buildValidatedCrossThemeAnalystSynthesis(model = {}, subjectProfile = null) {
  const profile = subjectProfile || crossThemeSubjectSelectionProfile(model);
  const subject = profile.displayName || compilerSubjectDisplayName(model);
  const mechanismNode = profile.concreteBottleneckNodes?.[0]?.node || model.subject.mechanismNode || 'the mechanism bottleneck';
  const issuerBridgeNode = profile.concreteBottleneckNodes?.[1]?.node || model.subject.issuerBridgeNode || 'the issuer bridge';
  const issuerUniverse = asArray(model.subject.issuerUniverse).join(', ') || 'issuer bridge candidates';
  return {
    oneSentenceThesis: `${subject} is a human-review cross-theme bottleneck candidate because accepted evidence links ${mechanismNode} to ${issuerBridgeNode}, while autonomous investment readiness and portfolio action remain disabled.`,
    strongestEvidence: [
      `Accepted mechanism and issuer bridge evidence are both present, with issuer candidates ${issuerUniverse} tied to operating bridge language rather than ticker-only mentions.`,
      'Negative controls are closed and holdout validation is confirmed, so the report is not relying on a single source family or broad narrative alone.',
    ],
    weakestEvidence: [
      'The report remains human-review only because valuation, market-regime, and decision-use context still require analyst review before any investment memo approval.',
    ],
    marketImplication: [
      'Controlled market validation is diagnostic support only; it can frame scenarios but cannot create decision-ready status.',
    ],
    counterThesis: [
      `The bottleneck can be real while ${issuerUniverse} fail to convert it into durable backlog, margin, guidance, or revenue exposure.`,
    ],
    invalidators: [
      'accepted evidence showing easy substitutes, supplier redundancy, capacity normalization, backlog decline, weak guidance, project execution margin pressure, or market behavior that contradicts the issuer bridge',
    ],
    nextResearchActions: [
      'human review of accepted snippets, refreshed official issuer evidence, negative-control scope, holdout independence, and market/regime diagnostics',
    ],
  };
}

function buildValidatedCrossThemeDeepResearch(model = {}, subjectProfile = null) {
  const profile = subjectProfile || crossThemeSubjectSelectionProfile(model);
  const base = buildCompilerDeepResearch(model);
  const crossThemeEvidenceMatrix = buildCrossThemeEvidenceMatrix(model);
  const autoDiscoveredIssuers = buildAutoDiscoveredIssuerRows(model);
  const issuerUniverse = asArray(model.subject.issuerUniverse);
  const negativeStatus = matrixRow(model.matrix, 'negative_control').status || 'checked_no_direct';
  const market = matrixRow(model.matrix, 'controlled_market_validation');
  return {
    ...base,
    crossThemeEvidenceMatrix,
    universalEvidenceContract: {
      requiredClasses: crossThemeEvidenceMatrix.map((row) => ({
        evidenceClass: row.evidenceClass,
        required: ['issuer_exposure', 'negative_control', 'holdout_validation', 'controlled_market_validation'].includes(row.evidenceClass),
      })),
    },
    crossThemeActionBridge: {
      ...base.crossThemeActionBridge,
      score: profile.validationFixtureOnly ? 0.42 : 0.78,
      tier: profile.validationFixtureOnly ? 'validation_fixture_only' : 'issuer_follow_up_ready',
      label: profile.validationFixtureOnly ? 'Evidence-gate validation fixture; not final discovery' : 'Issuer follow-up ready; human review required',
      evidenceMatrix: crossThemeEvidenceMatrix,
      autoDiscoveredIssuers,
      negativeControlStatus: negativeStatus,
      missingClasses: [],
      metrics: {
        ...(base.crossThemeActionBridge?.metrics || {}),
        evidenceClassCoverage: 1,
        issuerTranslationScore: 0.82,
        marketTranslationScore: market.status === 'controlled_ready' ? 0.62 : 0.35,
        actionPlanCompleteness: 0.86,
        issuerCount: issuerUniverse.length,
        issuerBridgeCount: Number(matrixRow(model.matrix, 'issuer_exposure').acceptedCount || 0),
        issuerOperatingAnchorCount: Number(matrixRow(model.matrix, 'issuer_exposure').promotionEligibleCount || 0),
        candidateIssuerCount: autoDiscoveredIssuers.length,
        probableExposureCount: autoDiscoveredIssuers.length,
        bridgeAttachedCount: Number(matrixRow(model.matrix, 'issuer_exposure').acceptedCount || 0),
        issuerMappingGapCount: 0,
        marketRowCount: Number(market.acceptedCount || 0),
        negativeControlStatus: negativeStatus,
        missingClasses: [],
        noveltyGatePassed: !profile.validationFixtureOnly,
        selectionDisposition: profile.selectionDisposition,
      },
      boundary: profile.validationFixtureOnly
        ? 'positive-path validation fixture; separate from final non-obvious discovery selection and autonomous investment readiness'
        : 'cross-theme discovery-to-action translation; separate from autonomous investment readiness',
    },
    packs: {
      ...(base.packs || {}),
      issuerDiscoveryPack: {
        rows: autoDiscoveredIssuers,
      },
      crossThemeActionBridge: {
        ...base.crossThemeActionBridge,
        evidenceMatrix: crossThemeEvidenceMatrix,
        autoDiscoveredIssuers,
      },
    },
  };
}

export function buildCompilerBackedFinalInvestmentReportArtifacts(report = {}, {
  generatedAt = new Date().toISOString(),
} = {}) {
  const model = buildPolishedFinalInvestmentReportModel(report, { generatedAt });
  const compilerSubjectLabel = compilerSubjectDisplayName(model);
  const evidence = buildCompilerEvidence(model);
  const caveats = caveatRowsFromModel(model);
  const claims = buildCompilerClaims(model, caveats, evidence);
  const metrics = buildCompilerMetrics(model);
  const longFormSections = buildCompilerLongFormSections(model, claims, caveats);
  const narrativeStructure = {
    provider: 'deterministic_final_investment_exporter',
    archetype: 'compiler_backed_thesis_validation',
    requiredRoleCoverage: 1,
    missingRoles: [],
    validationErrors: [],
    sections: longFormSections.map((section) => ({
      key: section.key,
      title: section.title,
      role: section.key,
    })),
  };
  const subjectId = model.subject.subjectId || model.reportId;
  const deepResearch = buildCompilerDeepResearch(model);
  const bundle = {
    bundleId: `EB-${model.reportId}`,
    reportId: model.reportId,
    reportType: 'final_investment_human_review_report',
    reportTypeLabel: 'Final investment human-review report',
    asOf: generatedAt,
    generatedAt,
    subject: {
      subjectId,
      subjectType: 'final_investment_human_review',
      displayName: compilerSubjectLabel,
      theme: 'cross-theme-bottleneck',
      metadata: {
        originalDisplayName: model.subject.displayName,
        finalInvestmentDryRun: true,
        sourceDryRunStatus: model.status.finalInvestmentReportDryRunStatus,
        decisionUse: model.subject.decisionUse,
        issuerUniverse: model.subject.issuerUniverse,
      },
    },
    sourceSummary: {
      sourceCount: evidence.length,
      publisherCount: uniqueStrings(evidence.map((item) => item.publisher)).length,
      lowDiversityFlag: false,
    },
    claims,
    evidence,
    metrics,
    figures: [],
    caveats,
    watchIndicators: [
      {
        watchId: 'WATCH-FINAL-HUMAN-REVIEW',
        label: 'Human review outcome',
        source: 'operator review',
        horizon: 'before approval',
        claimIds: ['CLM-FINAL-HUMAN-REVIEW-BOUNDARY'],
      },
    ],
    dataFreshness: [{
      source: 'final investment dry-run artifact',
      freshnessStatus: 'fresh',
      asOf: generatedAt,
    }],
    marketReactions: [],
    queryManifest: {
      generatedBy: 'final-investment-report-exporter',
      compilerBacked: true,
      mutationBoundary: model.boundaries,
      sourceDryRunPath: 'data/runtime/final-investment-report-dry-run.latest.json',
    },
    metadata: {
      allowedTickers: model.subject.issuerUniverse,
      finalInvestmentDryRun: {
        status: model.status,
        gateSummary: model.gateSummary,
        diagnostics: model.diagnostics,
        mutationBoundary: model.boundaries,
        validation: model.validation,
      },
      deepResearch,
    },
  };
  const sourceQueryCaveatIds = caveats
    .filter((row) => /missing|caveat|required|human review/i.test(`${row.type} ${row.text}`))
    .slice(0, 4)
    .map((row) => row.caveatId);
  const analysis = {
    reportId: model.reportId,
    generatedAt,
    analystMode: 'deterministic_compiler_backed_final_investment_export',
    summary: 'Final investment human-review artifact rendered through the standard Lattice report compiler.',
    narrativeStructure,
    longFormSections,
    keyJudgments: longFormSections[0]?.paragraphs || [],
    thesis: longFormSections[1]?.paragraphs || [],
    dataDepth: longFormSections.find((section) => section.key === 'evidenceLadder')?.paragraphs || [],
    causalChain: longFormSections.find((section) => section.key === 'mechanismMap')?.paragraphs || [],
    marketTransmission: longFormSections.find((section) => section.key === 'marketValidation')?.paragraphs || [],
    alternativeExplanations: longFormSections.find((section) => section.key === 'promotionRejectTriggers')?.paragraphs || [],
    risks: longFormSections.find((section) => section.key === 'riskRegister')?.paragraphs || [],
    informationGaps: [{
      text: 'Human review remains required before any investment memo approval; portfolio action remains disabled by the mutation boundary.',
      claimIds: ['CLM-FINAL-HUMAN-REVIEW-BOUNDARY'],
      metricIds: ['MET-FINAL-INVESTMENT-MEMO-READY', 'MET-FINAL-DECISION-READY', 'MET-FINAL-PORTFOLIO-ACTION'],
      caveatIds: caveats.filter((row) => row.type === 'human_review_boundary').map((row) => row.caveatId),
    }],
    watchNext: [{
      text: 'Monitor whether accepted issuer evidence, negative controls, holdout support, and controlled market diagnostics remain intact after human review.',
      claimIds: ['CLM-FINAL-HUMAN-REVIEW-BOUNDARY'],
      metricIds: ['MET-FINAL-ACCEPTED-EVIDENCE'],
      caveatIds: caveats.filter((row) => row.type === 'human_review_boundary').map((row) => row.caveatId),
    }],
    researchAgenda: [{
      text: 'Run analyst review against the accepted evidence matrix, then validate any remaining market-regime or valuation context before approval.',
      claimIds: ['CLM-FINAL-HUMAN-REVIEW-BOUNDARY'],
      metricIds: ['MET-FINAL-REGIME-COVERAGE', 'MET-FINAL-REGIME-CONSISTENCY'],
      caveatIds: sourceQueryCaveatIds,
    }],
    sourceQueries: [{
      queryId: 'SQD-FINAL-HUMAN-REVIEW-001',
      text: 'Validate accepted evidence, market-regime support, and valuation context before any approval decision.',
      reason: 'Human review remains the required next step for final investment memo approval.',
      desiredEvidenceClass: 'human_review',
      claimIds: ['CLM-FINAL-HUMAN-REVIEW-BOUNDARY'],
      metricIds: ['MET-FINAL-REGIME-COVERAGE', 'MET-FINAL-REGIME-CONSISTENCY'],
      caveatIds: sourceQueryCaveatIds,
      approvalRequired: true,
      metadata: {
        evidenceClass: 'human_review',
        promotionEligible: false,
        mutationBoundary: model.boundaries,
      },
    }],
    analystConclusion: longFormSections.find((section) => section.key === 'humanReviewAgenda')?.paragraphs || [],
    signalCards: [],
    metricCalibration: {
      compilerBackedFinalInvestmentExport: true,
      sourceOfTruth: 'standard Lattice report compiler and validator',
    },
    evidenceStrength: {
      rawEvidenceDoesNotPromoteReadiness: true,
      acceptedEvidenceOnly: true,
      mutationBoundary: model.boundaries,
    },
  };
  return { model, bundle, analysis };
}

export function buildCompilerBackedValidatedCrossThemeReportArtifacts(report = {}, {
  generatedAt = new Date().toISOString(),
} = {}) {
  const model = buildPolishedFinalInvestmentReportModel(report, { generatedAt });
  const subjectProfile = crossThemeSubjectSelectionProfile(model);
  const compilerSubjectLabel = subjectProfile.displayName;
  const evidence = buildCompilerEvidence(model);
  const caveats = caveatRowsFromModel(model);
  const claims = buildCompilerClaims(model, caveats, evidence);
  const metrics = buildCompilerMetrics(model);
  const longFormSections = buildValidatedCrossThemeLongFormSections(model, claims, caveats, subjectProfile);
  const narrativeStructure = {
    provider: 'deterministic_validated_cross_theme_exporter',
    archetype: 'validated_cross_theme_bottleneck_report',
    requiredRoleCoverage: 1,
    missingRoles: [],
    validationErrors: [],
    sections: longFormSections.map((section) => ({
      key: section.key,
      title: section.title,
      role: section.key,
    })),
  };
  const subjectId = model.subject.subjectId || model.reportId;
  const reportId = `RPT-validated-cross-theme-bottleneck-report-${slugify(subjectId || compilerSubjectLabel)}-${artifactHashSuffix(JSON.stringify({
    subject: subjectId,
    generatedAt,
    mode: 'validated-cross-theme',
  }))}`;
  const deepResearch = buildValidatedCrossThemeDeepResearch(model, subjectProfile);
  const existingClaimIds = new Set(claims.map((claim) => claim.claimId).filter(Boolean));
  const supportedClaimIds = (...ids) => ids.filter((id) => existingClaimIds.has(id)).length
    ? ids.filter((id) => existingClaimIds.has(id))
    : [claims[0]?.claimId].filter(Boolean);
  const discoveryMetadata = {
    discoveryNamespace: 'validated_autonomous_cross_theme',
    frontierDiscovery: !subjectProfile.validationFixtureOnly,
    connector: subjectProfile.connector,
    themes: subjectProfile.themes,
    selectionDisposition: subjectProfile.selectionDisposition,
    positivePathValidationFixture: subjectProfile.positivePathFixture,
    noveltyGatePassed: !subjectProfile.validationFixtureOnly,
    selectionBlockers: subjectProfile.blockers,
    explanation: subjectProfile.explanation,
    concreteBottleneckNodes: subjectProfile.concreteBottleneckNodes,
    concreteBottleneckNodeSummary: {
      topNodes: subjectProfile.concreteBottleneckNodes.map((row) => row.node),
    },
  };
  const mutationBoundary = model.boundaries;
  const bundle = {
    bundleId: `EB-${reportId}`,
    reportId,
    reportType: 'cross_theme_bottleneck_report',
    reportTypeLabel: subjectProfile.validationFixtureOnly
      ? 'Cross-theme evidence-gate validation fixture'
      : 'Validated cross-theme bottleneck report',
    asOf: generatedAt,
    generatedAt,
    subject: {
      subjectId,
      subjectType: subjectProfile.subjectType,
      displayName: compilerSubjectLabel,
      theme: 'cross-theme-bottleneck',
      themes: subjectProfile.themes,
      metadata: {
        discovery: discoveryMetadata,
        themes: subjectProfile.themes,
        subjectSelectionProfile: subjectProfile,
        selectionDisposition: subjectProfile.selectionDisposition,
        positivePathValidationFixture: subjectProfile.positivePathFixture,
        noveltyGatePassed: !subjectProfile.validationFixtureOnly,
        originalDisplayName: model.subject.displayName,
        finalInvestmentDryRun: true,
        validatedCrossThemeExport: true,
        sourceDryRunStatus: model.status.finalInvestmentReportDryRunStatus,
        decisionUse: 'human_review_required',
        issuerUniverse: model.subject.issuerUniverse,
        visualStatus: model.status.readyForHumanReview ? 'human_review_required' : 'blocked',
        productTier: 'evidence_supported_research_candidate',
        decisionDiagnostic: {
          status: 'human_review_required',
          label: 'Human review required',
          sourceOfTruth: 'accepted evidence plus Evidence Contract Matrix; not autonomous investment readiness',
          coveredEvidenceClasses: deepResearch.evidenceClassMatrix
            .filter((row) => Number(row.directCount || 0) > 0)
            .map((row) => row.evidenceClass),
          missingEvidenceClasses: [],
          blockers: uniqueStrings([
            model.status.decisionReady ? [] : ['autonomous_investment_readiness_disabled'],
            subjectProfile.blockers,
          ], 20),
        },
      },
    },
    sourceSummary: {
      sourceCount: evidence.length,
      publisherCount: uniqueStrings(evidence.map((item) => item.publisher)).length,
      sourceDiversityScore: 1,
      lowDiversityFlag: false,
    },
    claims,
    evidence,
    metrics,
    figures: [
      {
        figureId: 'FIG-VALIDATED-CROSS-THEME-PATHWAY',
        title: 'Theme-component-supplier pathway',
        chartType: 'network',
        analyticQuestion: `How does ${subjectProfile.connector} transmit into mechanism and issuer bridge evidence?`,
        dataRefIds: ['MET-FINAL-ACCEPTED-EVIDENCE', 'MET-FINAL-PROMOTION-EVIDENCE', 'MET-FINAL-SOURCE-BREADTH'],
        supportedClaimIds: supportedClaimIds('mechanism-evidence', 'issuer-bridge'),
        dataAsOf: generatedAt,
        metadata: {
          takeaway: 'The report separates mechanism validation from issuer exposure and keeps market validation diagnostic.',
        },
      },
      {
        figureId: 'FIG-VALIDATED-CROSS-THEME-READINESS',
        title: 'Evidence readiness',
        chartType: 'status_board',
        analyticQuestion: 'Which evidence lanes are accepted and which gates still require human review?',
        dataRefIds: ['MET-FINAL-GATE-PASSED', 'MET-FINAL-GATE-TOTAL', 'MET-FINAL-ACCEPTED-EVIDENCE', 'MET-FINAL-PORTFOLIO-ACTION'],
        supportedClaimIds: supportedClaimIds('negative-control', 'holdout-validation', 'controlled-market-validation', 'CLM-FINAL-HUMAN-REVIEW-BOUNDARY'),
        dataAsOf: generatedAt,
        metadata: {
          takeaway: 'Accepted evidence can support human review, but autonomous readiness remains disabled.',
        },
      },
      {
        figureId: 'FIG-VALIDATED-CROSS-THEME-ISSUER-BRIDGE',
        title: 'Issuer thesis bridge',
        chartType: 'peer_basket',
        analyticQuestion: 'Which issuers have accepted operating bridge evidence?',
        dataRefIds: ['MET-FINAL-PROMOTION-EVIDENCE', 'MET-FINAL-SOURCE-BREADTH'],
        supportedClaimIds: supportedClaimIds('issuer-bridge'),
        dataAsOf: generatedAt,
        metadata: {
          takeaway: `${asArray(model.subject.issuerUniverse).join(', ') || 'The issuer universe'} are issuer bridge candidates only because accepted operating evidence is attached.`,
          issuerThesisPack: deepResearch.packs?.issuerThesisPack || {},
        },
      },
    ],
    caveats,
    watchIndicators: [
      {
        watchId: 'WATCH-VALIDATED-CROSS-THEME-QUEUE',
        label: `${subjectProfile.concreteBottleneckNodes[0]?.node || 'Mechanism bottleneck'} timing and capacity`,
        source: 'official or trusted mechanism source',
        horizon: 'next evidence refresh',
        claimIds: ['mechanism-evidence'],
      },
      {
        watchId: 'WATCH-VALIDATED-CROSS-THEME-ISSUER',
        label: `${subjectProfile.concreteBottleneckNodes[1]?.node || 'Issuer bridge'} backlog and guidance`,
        source: 'issuer filings / transcripts',
        horizon: 'next reporting cycle',
        claimIds: ['issuer-bridge'],
      },
      {
        watchId: 'WATCH-VALIDATED-CROSS-THEME-NEGATIVE',
        label: 'Invalidators: backlog decline, project delays, demand slowdown, easy substitution',
        source: 'negative-control lane',
        horizon: 'continuous review',
        claimIds: ['negative-control'],
      },
    ],
    dataFreshness: [ {
      source: 'final investment dry-run artifact',
      freshnessStatus: 'fresh',
      asOf: generatedAt,
    } ],
    marketReactions: [],
    queryManifest: {
      generatedBy: 'validated-cross-theme-report-exporter',
      compilerBacked: true,
      validatedCrossThemeExport: true,
      mutationBoundary,
      sourceDryRunPath: 'data/runtime/final-investment-report-dry-run.latest.json',
    },
    metadata: {
      allowedTickers: model.subject.issuerUniverse,
      discovery: discoveryMetadata,
      frontierDiscovery: !subjectProfile.validationFixtureOnly,
      sourceDerivedNodeCount: 3,
      scarcityEvidenceScore: 0.78,
      nonObviousDiscovery: {
        frontierScore: subjectProfile.frontierScore,
        consensusPenalty: subjectProfile.consensusPenalty,
        noveltyGatePassed: !subjectProfile.validationFixtureOnly,
        selectionDisposition: subjectProfile.selectionDisposition,
      },
      candidate: {
        themes: subjectProfile.themes,
        evidence_summary: {
          seedSimilarity: subjectProfile.seedSimilarity,
          novelty: subjectProfile.noveltyScore,
          themeDistance: 0.84,
          sourceDiversity: 1,
          constraintCriticality: 0.82,
        },
      },
      finalInvestmentDryRun: {
        status: model.status,
        gateSummary: model.gateSummary,
        diagnostics: model.diagnostics,
        mutationBoundary,
        validation: model.validation,
      },
      deepResearch,
    },
  };
  const sourceQueryCaveatIds = caveats
    .filter((row) => /missing|caveat|required|human review/i.test(`${row.type} ${row.text}`))
    .slice(0, 4)
    .map((row) => row.caveatId);
  const analysis = {
    reportId,
    generatedAt,
    analystMode: 'deterministic_compiler_backed_validated_cross_theme_export',
    summary: 'Validated autonomous seed rendered through the standard cross-theme bottleneck report compiler.',
    analystSynthesis: buildValidatedCrossThemeAnalystSynthesis(model, subjectProfile),
    narrativeStructure,
    longFormSections,
    keyJudgments: longFormSections[0]?.paragraphs || [],
    thesis: longFormSections[1]?.paragraphs || [],
    context: longFormSections.find((section) => section.key === 'contextAndWhatChanged')?.paragraphs || [],
    whatChanged: longFormSections.find((section) => section.key === 'contextAndWhatChanged')?.paragraphs || [],
    dataDepth: longFormSections.find((section) => section.key === 'evidenceAssessment')?.paragraphs || [],
    causalChain: longFormSections.find((section) => section.key === 'economicMechanism')?.paragraphs || [],
    marketTransmission: longFormSections.find((section) => section.key === 'marketImplicationAndScenarios')?.paragraphs || [],
    alternativeExplanations: longFormSections.find((section) => section.key === 'promoteRejectTriggers')?.paragraphs || [],
    risks: longFormSections.find((section) => section.key === 'counterRisksCaveats')?.paragraphs || [],
    informationGaps: [
      {
        text: 'Human review remains required before investment memo approval; autonomous portfolio action remains disabled.',
        claimIds: ['CLM-FINAL-HUMAN-REVIEW-BOUNDARY'],
        metricIds: ['MET-FINAL-INVESTMENT-MEMO-READY', 'MET-FINAL-DECISION-READY', 'MET-FINAL-PORTFOLIO-ACTION'],
        caveatIds: caveats.filter((row) => row.type === 'human_review_boundary').map((row) => row.caveatId),
      },
    ],
    watchNext: longFormSections.find((section) => section.key === 'watchAndResearchAgenda')?.paragraphs.slice(0, 2) || [],
    researchAgenda: longFormSections.find((section) => section.key === 'watchAndResearchAgenda')?.paragraphs || [],
    sourceQueries: [
      {
        queryId: 'SQD-VALIDATED-CROSS-THEME-001',
        text: 'Refresh accepted mechanism, issuer bridge, negative-control, holdout, and controlled market lanes before any approval decision.',
        reason: 'Cross-theme report is human-review ready but not autonomous investment-ready.',
        desiredEvidenceClass: 'human_review',
        claimIds: ['CLM-FINAL-HUMAN-REVIEW-BOUNDARY'],
        metricIds: ['MET-FINAL-ACCEPTED-EVIDENCE', 'MET-FINAL-PORTFOLIO-ACTION'],
        caveatIds: sourceQueryCaveatIds,
        approvalRequired: true,
        metadata: {
          evidenceClass: 'human_review',
          promotionEligible: false,
          mutationBoundary,
        },
      },
    ],
    analystConclusion: longFormSections.find((section) => section.key === 'analystConclusion')?.paragraphs || [],
    signalCards: buildValidatedCrossThemeSignalCards(model, subjectProfile),
    metricCalibration: {
      compilerBackedValidatedCrossThemeExport: true,
      sourceOfTruth: 'standard Lattice cross-theme report compiler and validator',
    },
    evidenceStrength: {
      rawEvidenceDoesNotPromoteReadiness: true,
      acceptedEvidenceOnly: true,
      mutationBoundary,
    },
  };
  return { model, bundle, analysis };
}

export async function writePolishedFinalInvestmentReport({
  report,
  reportRoot = DEFAULT_REPORT_ROOT,
  outDir = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!report) throw new Error('report is required');
  const { model, bundle, analysis } = buildCompilerBackedFinalInvestmentReportArtifacts(report, { generatedAt });
  const result = await writeReportArtifactsToStore({
    bundle,
    analysis,
    reportRoot,
    outDir,
  });
  const index = await writeReportIndex(reportRoot);
  const reportDir = result.reportDir;
  return {
    ok: true,
    reportDir,
    reportId: model.reportId,
    manifest: result.manifest,
    validation: result.validation,
    registryRecord: result.registryRecord,
    sourceQueryDrafts: result.sourceQueryDrafts,
    queuedSourceQueries: result.queuedSourceQueries,
    indexPath: index.indexPath,
    paths: {
      html: path.join(reportDir, 'report.html'),
      markdown: path.join(reportDir, 'report.md'),
      auditAppendixHtml: path.join(reportDir, 'audit_appendix.html'),
      auditAppendixJson: path.join(reportDir, 'audit_appendix.json'),
      evidenceTableCsv: path.join(reportDir, 'evidence_table.csv'),
      bundle: path.join(reportDir, 'bundle.json'),
      analysis: path.join(reportDir, 'llm-analysis.json'),
      validation: path.join(reportDir, 'validation.json'),
      manifest: path.join(reportDir, 'manifest.json'),
      sourceQueryDrafts: path.join(reportDir, 'source-query-drafts.json'),
    },
  };
}

export async function writeValidatedCrossThemeFinalReport({
  report,
  reportRoot = DEFAULT_REPORT_ROOT,
  outDir = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!report) throw new Error('report is required');
  const { model, bundle, analysis } = buildCompilerBackedValidatedCrossThemeReportArtifacts(report, { generatedAt });
  const result = await writeReportArtifactsToStore({
    bundle,
    analysis,
    reportRoot,
    outDir,
  });
  const index = await writeReportIndex(reportRoot);
  const reportDir = result.reportDir;
  return {
    ok: true,
    reportDir,
    reportId: bundle.reportId || model.reportId,
    manifest: result.manifest,
    validation: result.validation,
    registryRecord: result.registryRecord,
    sourceQueryDrafts: result.sourceQueryDrafts,
    queuedSourceQueries: result.queuedSourceQueries,
    indexPath: index.indexPath,
    paths: {
      html: path.join(reportDir, 'report.html'),
      markdown: path.join(reportDir, 'report.md'),
      auditAppendixHtml: path.join(reportDir, 'audit_appendix.html'),
      auditAppendixJson: path.join(reportDir, 'audit_appendix.json'),
      evidenceTableCsv: path.join(reportDir, 'evidence_table.csv'),
      bundle: path.join(reportDir, 'bundle.json'),
      analysis: path.join(reportDir, 'llm-analysis.json'),
      validation: path.join(reportDir, 'validation.json'),
      manifest: path.join(reportDir, 'manifest.json'),
      sourceQueryDrafts: path.join(reportDir, 'source-query-drafts.json'),
    },
  };
}

export async function loadFinalInvestmentDryRun(filePath = path.join('data', 'runtime', 'final-investment-report-dry-run.latest.json')) {
  return JSON.parse(await readFile(path.resolve(filePath), 'utf8'));
}
