import { validateReportBundle } from './report-validator.mjs';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatList(items, renderer) {
  if (!Array.isArray(items) || !items.length) return '<p class="muted">No items available.</p>';
  return `<ul>${items.map((item) => `<li>${renderer(item)}</li>`).join('')}</ul>`;
}

function refsBlock(item = {}) {
  const refs = [
    ...asArray(item.claimIds).map((id) => `claim:${id}`),
    ...asArray(item.evidenceIds).map((id) => `evidence:${id}`),
    ...asArray(item.metricIds).map((id) => `metric:${id}`),
    ...asArray(item.figureIds).map((id) => `figure:${id}`),
    ...asArray(item.caveatIds).map((id) => `caveat:${id}`),
  ];
  return refs.length ? `<div class="refs">${refs.map((ref) => `<code>${escapeHtml(ref)}</code>`).join(' ')}</div>` : '';
}

function mdRefs(item = {}) {
  const refs = [
    ...asArray(item.claimIds).map((id) => `claim:${id}`),
    ...asArray(item.evidenceIds).map((id) => `evidence:${id}`),
    ...asArray(item.metricIds).map((id) => `metric:${id}`),
    ...asArray(item.figureIds).map((id) => `figure:${id}`),
    ...asArray(item.caveatIds).map((id) => `caveat:${id}`),
  ];
  return refs.length ? ` (${refs.join(', ')})` : '';
}

function mdCitation(item = {}) {
  return '';
}

function refCount(item = {}) {
  return [
    ...asArray(item.claimIds),
    ...asArray(item.evidenceIds),
    ...asArray(item.metricIds),
    ...asArray(item.figureIds),
    ...asArray(item.caveatIds),
  ].length;
}

function citationBadge(item = {}) {
  void item;
  return '';
}

function renderAnalysisSection(items = [], options = {}) {
  const showRefs = options.showRefs === true;
  return formatList(items, (item) => `${escapeHtml(item.text || item.label || item.summary || item.rationale || '')}${showRefs ? refsBlock(item) : citationBadge(item)}`);
}

function renderParagraphSection(items = []) {
  if (!Array.isArray(items) || !items.length) return '<p class="muted">No items available.</p>';
  return `<div class="memo-copy">${items.map((item) => `<p>${escapeHtml(item.text || item.label || item.summary || item.rationale || '')}${citationBadge(item)}</p>`).join('')}</div>`;
}

function hasLongFormSections(analysis = {}) {
  return Array.isArray(analysis.longFormSections) && analysis.longFormSections.some((section) => asArray(section.paragraphs).length);
}

function renderLongFormSections(sections = []) {
  return asArray(sections)
    .filter((section) => asArray(section.paragraphs).length)
    .map((section) => `
  <section class="long-form-section" data-section="${escapeHtml(section.key || '')}">
    <h2>${escapeHtml(section.title || section.key || 'Section')}</h2>
    ${renderParagraphSection(section.paragraphs)}
  </section>`)
    .join('');
}

function renderLongFormMarkdown(sections = []) {
  const lines = [];
  for (const section of asArray(sections).filter((item) => asArray(item.paragraphs).length)) {
    lines.push(`## ${section.title || section.key || 'Section'}`);
    lines.push('');
    for (const paragraph of asArray(section.paragraphs)) {
      lines.push(`${paragraph.text || paragraph.label || ''}${mdCitation(paragraph)}`);
      lines.push('');
    }
  }
  return lines;
}

function titleCaseMemo(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace(/\bAnd\b/g, 'and')
    .replace(/\bOr\b/g, 'or')
    .replace(/\bNot\b/g, 'Not');
}

function reportDisplayTitle(bundle = {}, analysis = {}) {
  const subject = bundle.subject?.displayName || bundle.subject?.subjectId || 'Intelligence Report';
  const shortThesis = analysis.narrativePlan?.thesis?.short;
  return shortThesis ? `${subject}: ${titleCaseMemo(shortThesis)}` : subject;
}

function translateClientBlocker(text = '') {
  return String(text || '')
    .replace(/\btranscript pack still uses proxy evidence\b/gi, 'call-transcript evidence gap')
    .replace(/\bonly\s+(\d+)\/(\d+)\s+core investment packs are available\b/gi, 'core investment evidence is still incomplete')
    .replace(/\bdeep data packs are below publishable depth\b/gi, 'research coverage is still below publishable depth')
    .replace(/\bstructured data gaps remain\b/gi, 'structured evidence gaps remain')
    .replace(/\bevidence diversity is below institutional target\b/gi, 'independent source diversity is still below target')
    .replace(/\bno reliable historical analogue is attached\b/gi, 'no reliable historical comparison is attached')
    .replace(/\barticle sample is ([^,]+), below investment memo threshold \d+\b/gi, 'the evidence sample is still below investment-memo depth')
    .replace(/\bsource diversity ([0-9.]+) is below ([0-9.]+)\b/gi, 'independent source diversity is still below target')
    .replace(/\bdirect issuer management-commentary coverage\s+(\d+)\/(\d+)\s+is below ontology threshold\b/gi, 'direct issuer management-commentary coverage remains below the theme-specific threshold ($1/$2)')
    .replace(/\bdirect management-commentary coverage\s+(\d+)\/(\d+)\s+is below investment memo threshold\b/gi, 'direct management-commentary coverage remains below the investment-memo threshold ($1/$2)')
    .replace(/\btheme ontology critical KPI coverage\s+([0-9]+)%; missing\b/gi, 'theme-specific operating KPI coverage is incomplete; missing')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderMetricList(metrics = []) {
  return formatList(metrics, (metric) => `<strong>${escapeHtml(metric.name)}</strong>: ${escapeHtml(metric.value)} ${escapeHtml(metric.unit || '')} <span class="muted">(${escapeHtml(metric.metricId)})</span>`);
}

function renderSignalCards(cards = []) {
  if (!cards.length) return '<p class="muted">No signal cards generated.</p>';
  return `<div class="signal-grid">${cards.map((card) => `
    <article class="signal-card signal-${escapeHtml(card.strength || 'watch')}">
      <div class="signal-head">
        <span>${escapeHtml(card.domain || 'signal')}</span>
        <strong>${escapeHtml(card.strength || 'watch')}</strong>
      </div>
      <h3>${escapeHtml(card.title || 'Signal')}</h3>
      <p>${escapeHtml(card.interpretation || '')}</p>
      <p class="muted"><strong>Decision use:</strong> ${escapeHtml(card.decisionUse || 'review')}</p>
    </article>
  `).join('')}</div>`;
}

function formatPct(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  return `${(n * 100).toFixed(digits)}%`;
}

function formatSignedPct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function formatNumber(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  return n.toFixed(digits).replace(/\.00$/, '');
}

function formatInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  return Math.round(n).toLocaleString('en-US');
}

function pluralize(count, singular, plural = `${singular}s`) {
  const n = Number(count);
  return Number.isFinite(n) && Math.abs(n) === 1 ? singular : plural;
}

function marketRowKey(row = {}) {
  return [
    row.symbol || '',
    row.eventWindow || row.event_window || row.window || row.horizon || '',
    Number(row.relativeReturnPct ?? row.relative_return_pct ?? 0).toFixed(4),
    Number(row.tStat ?? row.t_stat ?? 0).toFixed(4),
    Number(row.sampleSize ?? row.sample_size ?? 0),
    Boolean(row.decisionGrade),
    Boolean(row.screeningGrade),
    Boolean(row.hasBenchmarkControl),
    Boolean(row.hasFactorControl),
  ].join('|').toLowerCase();
}

function dedupeMarketRows(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of asArray(rows)) {
    const key = marketRowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function headlineMarketRows(marketValidation = {}) {
  const rows = dedupeMarketRows(marketValidation.rows);
  const decisionRows = rows.filter((row) => row.decisionGrade);
  if (decisionRows.length) return decisionRows;
  const screeningRows = rows.filter((row) => row.screeningGrade);
  if (screeningRows.length) return screeningRows;
  return rows.filter((row) => String(row.symbol || '').toUpperCase() !== 'MARKET' && Number(row.sampleSize || 0) >= 30);
}

function compactText(value = '', max = 110) {
  const text = String(value || '')
    .replace(/\bvalidate through revenue, margin, guidance, and market sensitivity\b/gi, 'issuer-specific operating and market bridge')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function tableStatusLabel(status = '') {
  return String(status || 'unknown').replace(/[_-]+/g, ' ');
}

function crossThemeEvidenceClassLabel(value = '') {
  return String(value || 'unknown')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compactIssuerRole(value = '') {
  const normalized = String(value || '')
    .replace(/\bmissile and air-defense exposure, aerospace systems, and supply-chain\/program execution risk\b/gi, 'missile / air-defense, aerospace systems, supply-chain risk')
    .replace(/\bmissile defense, aeronautics, space systems, and backlog-to-revenue conversion\b/gi, 'missile defense, aeronautics, space, backlog conversion')
    .replace(/\bspace, sensors, missile-defense programs, and segment execution\b/gi, 'space, sensors, missile-defense, segment execution')
    .replace(/\bshipbuilding, combat systems, aerospace backlog, and yard-throughput execution\b/gi, 'shipbuilding, combat systems, aerospace backlog, yard throughput');
  return compactText(normalized, 84);
}

function compactOperatingBridge(value = '') {
  const text = String(value || '');
  const symbolBridge = text.match(/^([A-Z.=-]{1,8}) bridge:\s*management commentary and issuer facts are present;\s*\1 theme-KPI context includes/i);
  if (symbolBridge) {
    return `${symbolBridge[1]}: commentary + issuer facts; attribution pending`;
  }
  const symbolPending = text.match(/^([A-Z.=-]{1,8}) issuer operating bridge pending;\s*\1 theme-KPI context includes/i);
  if (symbolPending) {
    return `${symbolPending[1]}: issuer operating bridge pending; KPI context in gate`;
  }
  if (/issuer operating bridge:\s*direct issuer commentary plus fundamental evidence;\s*theme-level KPI context includes/i.test(text)) {
    return 'direct commentary + fundamentals; attribution pending';
  }
  if (/issuer operating bridge pending;\s*theme-level KPI context includes/i.test(text)) {
    return 'issuer operating bridge pending; relevant theme KPI context is listed in the KPI gate';
  }
  return compactText(text);
}

function compactEvidenceQueryCell(row = {}) {
  const label = row.label || crossThemeEvidenceClassLabel(row.evidenceClass || '');
  const route = tableStatusLabel(row.providerRoute || row.validationNeed || '');
  if (row.status === 'missing') return `Collect ${label}${route ? ` via ${route}` : ''}`;
  if (row.status === 'context') return `Upgrade ${label} from context to direct evidence`;
  if (row.status === 'direct' || row.status === 'promotion_eligible') return `Validate ${label} source independence`;
  return compactText(row.missingReason || row.nextQuery || row.validationNeed || '');
}

function crossThemeIssuerValidationCell(row = {}) {
  const symbol = row.symbol || 'Issuer';
  const status = row.metadata?.status || '';
  if (status === 'operating_anchor_attached') {
    const bridge = row.metadata?.operatingBridge || row.requiredValidation || '';
    if (/Procurement Trigger/i.test(bridge)) {
      return `${symbol}: tie the procurement anchor to backlog, segment revenue, guidance, and customer exposure.`;
    }
    if (/Technical Qualification/i.test(bridge)) {
      const templates = {
        LMT: 'LMT: qualify program revenue, backlog conversion, delivery timing, and guidance.',
        GD: 'GD: test whether qualification evidence maps to segment economics or remains too indirect.',
        LHX: 'LHX: tie Aerojet qualification evidence to capacity, backlog, and margin exposure.',
        NOC: 'NOC: connect propulsion qualification evidence to space systems and missile-defense demand.',
        RKLB: 'RKLB: separate launch-manifest exposure from defense motor qualification evidence.',
      };
      return templates[String(symbol || '').toUpperCase()] || `${symbol}: qualify issuer economics, timing, and guidance linkage.`;
    }
    return `${symbol}: convert this operating anchor into issuer-specific economics and management commentary.`;
  }
  if (row.promotionEligible) return compactText(row.requiredValidation || row.fact_text || '');
  return `${symbol}: backlog, segment, guidance, customer, or supplier-link proof needed`;
}

function institutionalLaneStatus(row = {}, marketValidation = {}) {
  if (row.key === 'controlled_market_validation' && marketValidation.tier) {
    return `${tableStatusLabel(row.status)} coverage; ${tableStatusLabel(marketValidation.tier)} validation`;
  }
  return tableStatusLabel(row.status);
}

function institutionalLaneDepth(row = {}, marketValidation = {}) {
  if (row.key === 'controlled_market_validation' && marketValidation.tier) {
    return `${formatInteger(marketValidation.rowCount ?? row.rowCount)} market rows / ${formatInteger(marketValidation.decisionGradeRowCount)} decision-grade / ${formatInteger(marketValidation.regimeSupportRowCount)} regime-consistent`;
  }
  return `${formatInteger(row.rowCount)} rows / ${formatInteger(row.numericRowCount)} numeric`;
}

function marketValidationSummaryLine(marketValidation = {}, crossThemeActionability = null) {
  if (!marketValidation.tier) return 'Market validation rows are shown when controlled or screened market evidence is attached.';
  const controlledLabel = marketValidation.tier === 'decision_grade'
    ? 'Controlled market screen is decision-grade'
    : `Controlled market screen is ${tableStatusLabel(marketValidation.tier)}`;
  const outlierCount = asArray(marketValidation.screenedOutliers).length;
  const anomalyCount = Number(marketValidation.statisticalAnomalyCount || 0);
  const issuerActionMissing = crossThemeActionability
    && Number(crossThemeActionability.metrics?.marketRowCount || 0) === 0
    && marketValidation.tier === 'decision_grade';
  return [
    `${controlledLabel}: max headline t-stat ${formatNumber(marketValidation.maxAbsTStat)}, ${formatInteger(marketValidation.decisionGradeRowCount)} ${pluralize(marketValidation.decisionGradeRowCount, 'decision-grade row')}, ${formatInteger(marketValidation.screeningGradeRowCount)} ${pluralize(marketValidation.screeningGradeRowCount, 'screening row')}, and ${formatInteger(marketValidation.regimeSupportRowCount)} ${pluralize(marketValidation.regimeSupportRowCount, 'regime-consistency support row')}.`,
    anomalyCount ? `${formatInteger(anomalyCount)} extreme t-stat ${pluralize(anomalyCount, 'row')} lack regime-consistency support and stay out of decision-grade validation.` : '',
    outlierCount ? `${formatInteger(outlierCount)} small-sample/high-t-stat screened ${pluralize(outlierCount, 'outlier')} are kept out of the headline.` : '',
    issuerActionMissing ? 'Issuer-action market validation is not attached because no same-symbol direct issuer exposure bridge is closed.' : '',
  ].filter(Boolean).join(' ');
}

function discoveryReadinessLabelForGrade(grade = '', fallback = 'Tracked discovery') {
  if (!grade) return fallback;
  if (grade === 'S' || grade === 'A') return `Strong discovery (${grade})`;
  if (grade === 'B') return 'Evidence-supported discovery (B)';
  if (grade === 'C') return 'Discovery lead (C)';
  return `Early discovery (${grade})`;
}

function evidenceTierDisplayLabel(tier = '', fallback = '') {
  const normalized = String(tier || '').trim();
  return ({
    evidence_backed_bottleneck_candidate: 'Evidence-supported research candidate',
    review_ready_bottleneck: 'Review-ready evidence tier',
    research_lead: 'Research lead',
    graph_adjacency: 'Graph adjacency',
  })[normalized] || fallback || tableStatusLabel(normalized || 'evidence tier tracked');
}

function evidenceClassClosureMap(research = {}) {
  const ledger = research.reportClosureLedger || research.completionLedger || research.closureLedger || {};
  const rows = asArray(ledger.classRows).length ? asArray(ledger.classRows) : asArray(ledger.classLedger);
  return new Map(rows.map((row) => [row.evidenceClass, row]));
}

function evidenceContractClosureRow(row = {}, closureMap = new Map()) {
  const evidenceClass = row.evidenceClass || row.className || row.class || row.label;
  const closure = closureMap.get(evidenceClass) || {};
  const closureTier = closure.evidenceUse || closure.state || '';
  const currentStatus = row.status || '';
  const stalePromotionTier = currentStatus === 'missing'
    && ['promotion_collected', 'complete'].includes(String(closureTier || ''));
  const tier = row.evidenceTier
    || row.tier
    || row.evidenceUse
    || (stalePromotionTier ? currentStatus : closureTier)
    || '';
  const provider = [closure.providerRoute || row.providerRoute || row.validationNeed || '', closure.collector || '']
    .filter(Boolean)
    .join(' / ');
  return {
    providerRoute: provider,
    tier: tier ? tableStatusLabel(tier) : `${formatInteger(row.directCount)} direct / ${formatInteger(row.contextCount)} context / ${formatInteger(row.promotionEligibleCount)} promotion`,
    latestRunResult: stalePromotionTier
      ? (row.latestRunResult || row.lastResult || row.status || closure.latestRunResult || '')
      : (closure.latestRunResult || row.latestRunResult || row.lastResult || row.status || ''),
    factsFound: closure.factsFound || closure.factKeys || row.factsFound || '',
    closureReason: stalePromotionTier
      ? (row.missingReason || row.closureReason || closure.closureReason || '')
      : (closure.closureReason || row.closureReason || ''),
    nextAction: closure.nextAction || row.nextAction || compactEvidenceQueryCell(row),
  };
}

function htmlTable(headers = [], rows = []) {
  if (!rows.length) return '<p class="muted">No table rows available.</p>';
  return `<div class="table-wrap"><table class="evidence-table">
    <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function mdTable(headers = [], rows = []) {
  if (!rows.length) return [];
  const escapeMd = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [
    `| ${headers.map(escapeMd).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeMd).join(' | ')} |`),
    '',
  ];
}

function deepResearch(bundle = {}) {
  return bundle.metadata?.deepResearch || {};
}

function renderInstitutionalEvidenceTablesHtml(bundle = {}, validation = {}) {
  const research = deepResearch(bundle);
  const institutional = research.packs?.institutionalEvidencePack || {};
  const issuerCards = asArray(research.packs?.issuerThesisPack?.cards);
  const ontology = research.ontologyPack || {};
  const crossThemeBridge = research.crossThemeActionBridge || research.packs?.crossThemeActionBridge || {};
  const crossThemeMatrix = asArray(research.crossThemeEvidenceMatrix || crossThemeBridge.evidenceMatrix);
  const evidenceContractMatrix = asArray(research.evidenceClassMatrix);
  const closureMap = evidenceClassClosureMap(research);
  const crossThemeIssuerRows = asArray(crossThemeBridge.rows)
    .filter((row) => row.source_type === 'cross_theme_action_bridge' && row.symbol);
  const autoIssuerRowsRaw = asArray(crossThemeBridge.autoDiscoveredIssuers).length
    ? asArray(crossThemeBridge.autoDiscoveredIssuers)
    : (asArray(crossThemeBridge.rows).some((row) => row.source_type === 'cross_theme_auto_issuer_map')
      ? asArray(crossThemeBridge.rows).filter((row) => row.source_type === 'cross_theme_auto_issuer_map' && row.symbol)
      : asArray(research.packs?.issuerDiscoveryPack?.rows));
  const marketValidation = validation.quality?.investmentReadiness?.marketValidation
    || research.investmentReadiness?.marketValidation
    || {};
  const qualityCrossThemeActionability = validation.quality?.crossThemeActionability
    || research.crossThemeActionBridge
    || null;
  const hasContent = asArray(institutional.dimensions).length
    || issuerCards.length
    || asArray(marketValidation.rows).length
    || asArray(ontology.kpis).length
    || evidenceContractMatrix.length
    || crossThemeMatrix.length
    || autoIssuerRowsRaw.length
    || crossThemeIssuerRows.length;
  if (!hasContent) return '';

  const institutionalRows = asArray(institutional.dimensions)
    .slice()
    .sort((a, b) => String(a.status || '').localeCompare(String(b.status || '')) || String(a.label || '').localeCompare(String(b.label || '')))
    .slice(0, 12)
    .map((row) => [
      row.label || row.key,
      institutionalLaneStatus(row, marketValidation),
      institutionalLaneDepth(row, marketValidation),
      `${formatInteger(row.symbolCount)} symbols / ${formatInteger(row.sourceKindCount)} source lanes`,
      compactText(row.decisionUse || ''),
    ]);

  const issuerRows = issuerCards
    .slice(0, 8)
    .map((card) => [
      card.symbol || 'n/a',
      compactIssuerRole(card.role || ''),
      compactText(card.fundamentalBridge || ''),
      compactText(card.valuationBridge || ''),
      compactText(card.expectationBridge || card.metadata?.expectationBridge || ''),
      compactText(card.marketBridge || ''),
      compactOperatingBridge(card.operatingBridge || ''),
      tableStatusLabel(card.thesisUse || ''),
    ]);

  const marketRows = headlineMarketRows(marketValidation)
    .slice()
    .sort((a, b) => Number(Boolean(b.decisionGrade)) - Number(Boolean(a.decisionGrade)) || Number(Boolean(b.screeningGrade)) - Number(Boolean(a.screeningGrade)) || Number(Boolean(b.regimeConsistent)) - Number(Boolean(a.regimeConsistent)) || Number(b.absTStat || 0) - Number(a.absTStat || 0))
    .slice(0, 10)
    .map((row) => [
      row.symbol || 'n/a',
      row.eventWindow || 'n/a',
      formatSignedPct(row.relativeReturnPct),
      formatNumber(row.tStat),
      formatInteger(row.sampleSize),
      row.decisionGrade ? 'decision-grade' : row.screeningGrade ? 'screening-grade' : 'not decision-useful',
      [row.hasBenchmarkControl ? 'benchmark' : '', row.hasFactorControl ? 'factor/regime' : ''].filter(Boolean).join(' + ') || 'raw screen',
      row.regimeSupportLabel || row.regimeConsistencyGrade || 'not attached',
    ]);

  const kpiRows = asArray(ontology.kpis)
    .slice()
    .sort((a, b) => Number(Boolean(a.satisfied)) - Number(Boolean(b.satisfied)) || Number(b.priority || 0) - Number(a.priority || 0))
    .slice(0, 12)
    .map((kpi) => [
      kpi.displayName || kpi.kpiKey,
      kpi.satisfied ? 'covered' : 'missing',
      kpi.critical ? 'critical' : 'supporting',
      tableStatusLabel(kpi.requiredFor || ''),
      compactText(asArray(kpi.queryTerms).join(', ')),
    ]);

  const crossMatrixRows = crossThemeMatrix
    .slice(0, 12)
    .map((row) => [
      crossThemeEvidenceClassLabel(row.evidenceClass || row.label || ''),
      tableStatusLabel(row.status || ''),
      `${formatInteger(row.directCount)} direct / ${formatInteger(row.promotionEligibleCount)} promotion`,
      asArray(row.sourceGroups).join(', ') || 'n/a',
      compactEvidenceQueryCell(row),
    ]);

  const evidenceContractRows = evidenceContractMatrix
    .slice(0, 16)
    .map((row) => {
      const closure = evidenceContractClosureRow(row, closureMap);
      return [
        row.label || crossThemeEvidenceClassLabel(row.evidenceClass || ''),
        tableStatusLabel(row.status || ''),
        closure.tier,
        compactText(closure.providerRoute || ''),
        compactText(closure.factsFound || closure.latestRunResult || ''),
        compactText(closure.closureReason || ''),
        compactText(closure.nextAction || ''),
      ];
    });

  const crossIssuerRows = crossThemeIssuerRows
    .slice(0, 10)
    .map((row) => [
      row.symbol || 'n/a',
      compactText(row.issuer || ''),
      tableStatusLabel(row.metadata?.issuerBridgeRole || row.issuerBridgeRole || 'unclear'),
      compactText(row.exposureType || ''),
      tableStatusLabel(row.metadata?.status || (row.promotionEligible ? 'issuer_exposure_attached' : 'follow_up_required')),
      crossThemeIssuerValidationCell(row),
    ]);
  const autoIssuerRows = autoIssuerRowsRaw
    .slice(0, 14)
    .map((row) => [
      tableStatusLabel(row.role || row.issuerBridgeRole || row.metadata?.issuerBridgeRole || 'unclear'),
      row.symbol || 'n/a',
      compactText(row.issuerName || row.issuer || ''),
      tableStatusLabel(row.status || row.metadata?.status || 'candidate'),
      compactText(row.whyRelated || row.exposureType || row.fact_text || ''),
      compactText(row.nextValidation || row.requiredValidation || ''),
    ]);

  const densityLine = institutional.status
    ? `Institutional evidence density is ${escapeHtml(formatPct(institutional.coverageScore, 0))}; table coverage is ${escapeHtml(formatPct(institutional.tableCoverage, 0))}, primary evidence coverage is ${escapeHtml(formatPct(institutional.primaryEvidenceCoverage, 0))}, and long-horizon coverage is ${escapeHtml(formatPct(institutional.longHorizonCoverage, 0))}.`
    : 'The matrix below separates evidence breadth from decision-grade validation.';
  const marketLine = marketValidationSummaryLine(marketValidation, qualityCrossThemeActionability);

  return `
  <section class="institutional-tables">
    <h2>Evidence and Validation Tables</h2>
    <p class="muted">${densityLine} ${marketLine}</p>
    <h3>Institutional Evidence Matrix</h3>
    ${htmlTable(['Evidence lane', 'Status', 'Depth', 'Breadth', 'Decision use'], institutionalRows)}
    <h3>Issuer Evidence Bridge</h3>
    ${htmlTable(['Issuer', 'Role', 'Fundamental bridge', 'Valuation bridge', 'Expectation read', 'Market bridge', 'Operating bridge', 'Use'], issuerRows)}
    <h3>Market Validation Table</h3>
    ${htmlTable(['Symbol', 'Window', 'Relative move', 't-stat', 'Sample', 'Evidence tier', 'Controls', 'Regime support'], marketRows)}
    <h3>Theme-Specific KPI Gate</h3>
    ${htmlTable(['KPI', 'Coverage', 'Criticality', 'Required for', 'Collection target'], kpiRows)}
    ${evidenceContractRows.length ? `<h3>Evidence Contract Matrix</h3>${htmlTable(['Evidence class', 'Status', 'Evidence tier / use', 'Provider / collector', 'Facts found', 'Closure reason', 'Next action'], evidenceContractRows)}` : ''}
    ${crossMatrixRows.length ? `<h3>Cross-Theme Evidence Matrix</h3>${htmlTable(['Evidence class', 'Status', 'Direct / promotion', 'Source groups', 'Next query'], crossMatrixRows)}` : ''}
    ${autoIssuerRows.length ? `<h3>Auto-discovered related issuer map</h3><p class="muted">These issuers are report-visible collection targets. Candidate and probable-exposure rows can raise research priority, but they do not raise actionability until direct issuer exposure evidence attaches.</p>${htmlTable(['Role', 'Symbol', 'Issuer', 'Status', 'Why related', 'Next validation'], autoIssuerRows)}` : ''}
    ${crossIssuerRows.length ? `<h3>Cross-Theme Issuer Action Bridge</h3>${htmlTable(['Symbol', 'Issuer', 'Role class', 'Exposure', 'Bridge status', 'Required validation'], crossIssuerRows)}` : ''}
  </section>`;
}

function renderInstitutionalEvidenceTablesMarkdown(bundle = {}, validation = {}) {
  const research = deepResearch(bundle);
  const institutional = research.packs?.institutionalEvidencePack || {};
  const issuerCards = asArray(research.packs?.issuerThesisPack?.cards);
  const ontology = research.ontologyPack || {};
  const crossThemeBridge = research.crossThemeActionBridge || research.packs?.crossThemeActionBridge || {};
  const crossThemeMatrix = asArray(research.crossThemeEvidenceMatrix || crossThemeBridge.evidenceMatrix);
  const evidenceContractMatrix = asArray(research.evidenceClassMatrix);
  const closureMap = evidenceClassClosureMap(research);
  const crossThemeIssuerRows = asArray(crossThemeBridge.rows)
    .filter((row) => row.source_type === 'cross_theme_action_bridge' && row.symbol);
  const autoIssuerRowsRaw = asArray(crossThemeBridge.autoDiscoveredIssuers).length
    ? asArray(crossThemeBridge.autoDiscoveredIssuers)
    : (asArray(crossThemeBridge.rows).some((row) => row.source_type === 'cross_theme_auto_issuer_map')
      ? asArray(crossThemeBridge.rows).filter((row) => row.source_type === 'cross_theme_auto_issuer_map' && row.symbol)
      : asArray(research.packs?.issuerDiscoveryPack?.rows));
  const marketValidation = validation.quality?.investmentReadiness?.marketValidation
    || research.investmentReadiness?.marketValidation
    || {};
  const qualityCrossThemeActionability = validation.quality?.crossThemeActionability
    || research.crossThemeActionBridge
    || null;
  const hasContent = asArray(institutional.dimensions).length
    || issuerCards.length
    || asArray(marketValidation.rows).length
    || asArray(ontology.kpis).length
    || evidenceContractMatrix.length
    || crossThemeMatrix.length
    || autoIssuerRowsRaw.length
    || crossThemeIssuerRows.length;
  if (!hasContent) return [];

  const lines = ['## Evidence and Validation Tables', ''];
  if (institutional.status || marketValidation.tier) {
    lines.push(`${institutional.status ? `Institutional evidence density is ${formatPct(institutional.coverageScore, 0)}; table coverage is ${formatPct(institutional.tableCoverage, 0)}, primary evidence coverage is ${formatPct(institutional.primaryEvidenceCoverage, 0)}, and long-horizon coverage is ${formatPct(institutional.longHorizonCoverage, 0)}.` : ''} ${marketValidationSummaryLine(marketValidation, qualityCrossThemeActionability)}`.trim());
    lines.push('');
  }

  const institutionalRows = asArray(institutional.dimensions)
    .slice()
    .sort((a, b) => String(a.status || '').localeCompare(String(b.status || '')) || String(a.label || '').localeCompare(String(b.label || '')))
    .slice(0, 12)
    .map((row) => [
      row.label || row.key,
      institutionalLaneStatus(row, marketValidation),
      institutionalLaneDepth(row, marketValidation),
      `${formatInteger(row.symbolCount)} symbols / ${formatInteger(row.sourceKindCount)} source lanes`,
      compactText(row.decisionUse || ''),
    ]);
  lines.push('### Institutional Evidence Matrix', '');
  lines.push(...mdTable(['Evidence lane', 'Status', 'Depth', 'Breadth', 'Decision use'], institutionalRows));

  const issuerRows = issuerCards.slice(0, 8).map((card) => [
    card.symbol || 'n/a',
    compactIssuerRole(card.role || ''),
    compactText(card.fundamentalBridge || ''),
    compactText(card.valuationBridge || ''),
    compactText(card.expectationBridge || card.metadata?.expectationBridge || ''),
    compactText(card.marketBridge || ''),
    compactOperatingBridge(card.operatingBridge || ''),
    tableStatusLabel(card.thesisUse || ''),
  ]);
  lines.push('### Issuer Evidence Bridge', '');
  lines.push(...mdTable(['Issuer', 'Role', 'Fundamental bridge', 'Valuation bridge', 'Expectation read', 'Market bridge', 'Operating bridge', 'Use'], issuerRows));

  const marketRows = headlineMarketRows(marketValidation)
    .slice()
    .sort((a, b) => Number(Boolean(b.decisionGrade)) - Number(Boolean(a.decisionGrade)) || Number(Boolean(b.screeningGrade)) - Number(Boolean(a.screeningGrade)) || Number(Boolean(b.regimeConsistent)) - Number(Boolean(a.regimeConsistent)) || Number(b.absTStat || 0) - Number(a.absTStat || 0))
    .slice(0, 10)
    .map((row) => [
      row.symbol || 'n/a',
      row.eventWindow || 'n/a',
      formatSignedPct(row.relativeReturnPct),
      formatNumber(row.tStat),
      formatInteger(row.sampleSize),
      row.decisionGrade ? 'decision-grade' : row.screeningGrade ? 'screening-grade' : 'not decision-useful',
      [row.hasBenchmarkControl ? 'benchmark' : '', row.hasFactorControl ? 'factor/regime' : ''].filter(Boolean).join(' + ') || 'raw screen',
      row.regimeSupportLabel || row.regimeConsistencyGrade || 'not attached',
    ]);
  lines.push('### Market Validation Table', '');
  lines.push(...mdTable(['Symbol', 'Window', 'Relative move', 't-stat', 'Sample', 'Evidence tier', 'Controls', 'Regime support'], marketRows));

  const kpiRows = asArray(ontology.kpis)
    .slice()
    .sort((a, b) => Number(Boolean(a.satisfied)) - Number(Boolean(b.satisfied)) || Number(b.priority || 0) - Number(a.priority || 0))
    .slice(0, 12)
    .map((kpi) => [
      kpi.displayName || kpi.kpiKey,
      kpi.satisfied ? 'covered' : 'missing',
      kpi.critical ? 'critical' : 'supporting',
      tableStatusLabel(kpi.requiredFor || ''),
      compactText(asArray(kpi.queryTerms).join(', ')),
    ]);
  lines.push('### Theme-Specific KPI Gate', '');
  lines.push(...mdTable(['KPI', 'Coverage', 'Criticality', 'Required for', 'Collection target'], kpiRows));

  const evidenceContractRows = evidenceContractMatrix.slice(0, 16).map((row) => {
    const closure = evidenceContractClosureRow(row, closureMap);
    return [
      row.label || crossThemeEvidenceClassLabel(row.evidenceClass || ''),
      tableStatusLabel(row.status || ''),
      closure.tier,
      compactText(closure.providerRoute || ''),
      compactText(closure.factsFound || closure.latestRunResult || ''),
      compactText(closure.closureReason || ''),
      compactText(closure.nextAction || ''),
    ];
  });
  if (evidenceContractRows.length) {
    lines.push('### Evidence Contract Matrix', '');
    lines.push(...mdTable(['Evidence class', 'Status', 'Evidence tier / use', 'Provider / collector', 'Facts found', 'Closure reason', 'Next action'], evidenceContractRows));
  }

  const crossMatrixRows = crossThemeMatrix.slice(0, 12).map((row) => [
    crossThemeEvidenceClassLabel(row.evidenceClass || row.label || ''),
    tableStatusLabel(row.status || ''),
    `${formatInteger(row.directCount)} direct / ${formatInteger(row.promotionEligibleCount)} promotion`,
    asArray(row.sourceGroups).join(', ') || 'n/a',
    compactEvidenceQueryCell(row),
  ]);
  if (crossMatrixRows.length) {
    lines.push('### Cross-Theme Evidence Matrix', '');
    lines.push(...mdTable(['Evidence class', 'Status', 'Direct / promotion', 'Source groups', 'Next query'], crossMatrixRows));
  }

  const autoIssuerRows = autoIssuerRowsRaw.slice(0, 14).map((row) => [
    tableStatusLabel(row.role || row.issuerBridgeRole || row.metadata?.issuerBridgeRole || 'unclear'),
    row.symbol || 'n/a',
    compactText(row.issuerName || row.issuer || ''),
    tableStatusLabel(row.status || row.metadata?.status || 'candidate'),
    compactText(row.whyRelated || row.exposureType || row.fact_text || ''),
    compactText(row.nextValidation || row.requiredValidation || ''),
  ]);
  if (autoIssuerRows.length) {
    lines.push('### Auto-discovered related issuer map', '');
    lines.push('These issuers are report-visible collection targets. Candidate and probable-exposure rows can raise research priority, but they do not raise actionability until direct issuer exposure evidence attaches.', '');
    lines.push(...mdTable(['Role', 'Symbol', 'Issuer', 'Status', 'Why related', 'Next validation'], autoIssuerRows));
  }

  const crossIssuerRows = crossThemeIssuerRows.slice(0, 10).map((row) => [
    row.symbol || 'n/a',
    compactText(row.issuer || ''),
    tableStatusLabel(row.metadata?.issuerBridgeRole || row.issuerBridgeRole || 'unclear'),
    compactText(row.exposureType || ''),
    tableStatusLabel(row.metadata?.status || (row.promotionEligible ? 'issuer_exposure_attached' : 'follow_up_required')),
    crossThemeIssuerValidationCell(row),
  ]);
  if (crossIssuerRows.length) {
    lines.push('### Cross-Theme Issuer Action Bridge', '');
    lines.push(...mdTable(['Symbol', 'Issuer', 'Role class', 'Exposure', 'Bridge status', 'Required validation'], crossIssuerRows));
  }
  return lines;
}

function nonObviousDiscoveryFromBundle(bundle = {}) {
  return bundle.metadata?.nonObviousDiscovery
    || bundle.metadata?.adjacentCandidate?.metadata?.nonObviousDiscovery
    || bundle.metadata?.candidate?.evidence_summary?.nonObviousDiscovery
    || bundle.metadata?.candidate?.evidenceSummary?.nonObviousDiscovery
    || bundle.metadata?.candidate?.metadata?.nonObviousDiscovery
    || bundle.subject?.metadata?.discovery?.nonObviousDiscovery
    || null;
}

function concreteBottleneckNodesFromBundle(bundle = {}) {
  return asArray(
    bundle.metadata?.concreteBottleneckNodes
    || bundle.metadata?.adjacentCandidate?.metadata?.concreteBottleneckNodes
    || bundle.subject?.metadata?.discovery?.concreteBottleneckNodes
    || [],
  ).slice(0, 6);
}

function adjacentMetadataFromBundle(bundle = {}) {
  return bundle.metadata?.adjacentCandidate?.metadata || {};
}

function frontierNodeSupportFromBundle(bundle = {}) {
  const adjacentMetadata = adjacentMetadataFromBundle(bundle);
  const candidateSummary = bundle.metadata?.candidate?.evidence_summary || bundle.metadata?.candidate?.evidenceSummary || {};
  const candidateMetadata = bundle.metadata?.candidate?.metadata || {};
  return {
    supported: Boolean(
      bundle.metadata?.frontierNodeSupported
      || adjacentMetadata.frontierNodeSupported
      || candidateSummary.frontierParentReportReady
      || candidateMetadata.frontierParentReportReady,
    ),
    sourceDerivedNodeCount: Number(
      bundle.metadata?.sourceDerivedNodeCount
      || adjacentMetadata.sourceDerivedNodeCount
      || candidateSummary.sourceDerivedNodeCount
      || candidateMetadata.sourceDerivedNodeCount
      || 0,
    ),
    scarcityEvidenceScore: Number(
      bundle.metadata?.scarcityEvidenceScore
      || adjacentMetadata.scarcityEvidenceScore
      || candidateSummary.nonObviousDiscovery?.scarcitySignalScore
      || candidateMetadata.nonObviousDiscovery?.scarcitySignalScore
      || 0,
    ),
  };
}

function consensusSuppressionDetails(bundle = {}, nonObvious = {}) {
  const adjacentMetadata = adjacentMetadataFromBundle(bundle);
  const symbols = [
    ...asArray(nonObvious.suppressedConsensusSymbols),
    ...asArray(bundle.metadata?.suppressedConsensusSymbols),
    ...asArray(adjacentMetadata.suppressedConsensusSymbols),
  ].map((item) => String(item || '').trim()).filter(Boolean);
  const basis = [
    ...asArray(nonObvious.consensusPenaltyBasis),
    ...asArray(bundle.metadata?.consensusPenaltyBasis),
    ...asArray(adjacentMetadata.consensusPenaltyBasis),
  ].map((item) => {
    if (!item || typeof item !== 'object') return compactText(item, 80);
    return compactText(`${item.term || item.symbol || item.label || 'consensus term'} (${item.count || 1})`, 80);
  }).filter(Boolean);
  return {
    symbols: [...new Set(symbols)].slice(0, 8),
    basis: [...new Set(basis)].slice(0, 5),
  };
}

function renderNonObviousDiscoveryHtml(bundle = {}) {
  const nonObvious = nonObviousDiscoveryFromBundle(bundle);
  if (!nonObvious) return '';
  const sourceTerms = asArray(bundle.metadata?.adjacentCandidate?.source_terms || bundle.subject?.metadata?.discovery?.triggerTerms || bundle.metadata?.adjacentCandidate?.metadata?.sourceTerms).slice(0, 8);
  const concreteNodes = concreteBottleneckNodesFromBundle(bundle);
  const frontierSupport = frontierNodeSupportFromBundle(bundle);
  const suppression = consensusSuppressionDetails(bundle, nonObvious);
  const rows = [
    ['Non-obvious connector', nonObvious.themeDistanceScore >= 0.5 ? 'distant-theme candidate' : 'near-theme or consensus-adjacent', formatPct(nonObvious.themeDistanceScore, 0)],
    ['Known narrative suppressed', nonObvious.consensusPenalty >= 0.45 ? 'suppressed until narrow evidence appears' : 'not materially suppressed', formatPct(nonObvious.consensusPenalty, 0)],
    ['Narrow bottleneck node', nonObvious.bottleneckSpecificityScore >= 0.45 ? 'specific component/process/material signal' : 'broad node still needs decomposition', formatPct(nonObvious.bottleneckSpecificityScore, 0)],
    ['Scarcity test', nonObvious.scarcitySignalScore >= 0.28 ? 'scarcity cues present' : 'scarcity evidence still needed', formatPct(nonObvious.scarcitySignalScore, 0)],
    ['Surprise / divergence', nonObvious.surpriseScore >= 0.5 ? 'unexpected dependency term' : 'close to known narrative', formatPct(nonObvious.surpriseScore, 0)],
    ['Frontier node support', frontierSupport.supported ? 'source-derived node is eligible for report promotion' : 'node-first evidence still collecting', `${frontierSupport.sourceDerivedNodeCount} source-derived nodes`],
    ['Pricing-power path', nonObvious.frontierScore >= 62 ? 'frontier report candidate' : 'research lead only', `${Number(nonObvious.frontierScore || 0).toFixed(0)}/100`],
  ];
  return `
  <section class="non-obvious-frontier">
    <h2>Non-obvious Bottleneck Lens</h2>
    <p class="muted">This section keeps fresh connector discovery separate from issuer/actionability promotion. Consensus names can re-enter only after direct evidence attaches.</p>
    ${htmlTable(['Lens', 'Current read', 'Score'], rows)}
    ${concreteNodes.length ? `
      <h3>Concrete Node Probes</h3>
      <p class="muted">These are decomposition targets for the next collection pass. They are not issuer/actionability evidence until the listed acceptance facts attach.</p>
      ${htmlTable(['Node', 'Type', 'Evidence class', 'Acceptance facts'], concreteNodes.map((node) => [
        node.node || node.key || 'concrete node',
        `${node.nodeType || 'process'}${node.sourceDerived ? ' / source-derived' : ''}`,
        asArray(node.evidenceClasses).slice(0, 4).join(', ') || 'supplier_capacity',
        asArray(node.acceptanceCriteria).slice(0, 3).join('; ') || 'direct evidence required',
      ]))}
    ` : ''}
    ${nonObvious.suppressedNarrativeReason ? `<p class="muted">${escapeHtml(nonObvious.suppressedNarrativeReason)}</p>` : ''}
    ${suppression.symbols.length ? `<p class="muted">Suppressed consensus symbols: ${escapeHtml(suppression.symbols.join(', '))}</p>` : ''}
    ${suppression.basis.length ? `<p class="muted">Consensus basis: ${escapeHtml(suppression.basis.join('; '))}</p>` : ''}
    ${sourceTerms.length ? `<p class="muted">Source terms: ${escapeHtml(sourceTerms.join(', '))}</p>` : ''}
  </section>`;
}

function renderNonObviousDiscoveryMarkdown(bundle = {}) {
  const nonObvious = nonObviousDiscoveryFromBundle(bundle);
  if (!nonObvious) return [];
  const concreteNodes = concreteBottleneckNodesFromBundle(bundle);
  const frontierSupport = frontierNodeSupportFromBundle(bundle);
  const suppression = consensusSuppressionDetails(bundle, nonObvious);
  return [
    '## Non-obvious Bottleneck Lens',
    '',
    `- Non-obvious connector: ${nonObvious.themeDistanceScore >= 0.5 ? 'distant-theme candidate' : 'near-theme or consensus-adjacent'} (${formatPct(nonObvious.themeDistanceScore, 0)})`,
    `- Known narrative suppressed: ${nonObvious.consensusPenalty >= 0.45 ? 'suppressed until narrow evidence appears' : 'not materially suppressed'} (${formatPct(nonObvious.consensusPenalty, 0)})`,
    `- Narrow bottleneck node: ${nonObvious.bottleneckSpecificityScore >= 0.45 ? 'specific component/process/material signal' : 'broad node still needs decomposition'} (${formatPct(nonObvious.bottleneckSpecificityScore, 0)})`,
    `- Scarcity test: ${nonObvious.scarcitySignalScore >= 0.28 ? 'scarcity cues present' : 'scarcity evidence still needed'} (${formatPct(nonObvious.scarcitySignalScore, 0)})`,
    `- Surprise / divergence: ${nonObvious.surpriseScore >= 0.5 ? 'unexpected dependency term' : 'close to known narrative'} (${formatPct(nonObvious.surpriseScore, 0)})`,
    `- Frontier node support: ${frontierSupport.supported ? 'source-derived node is eligible for report promotion' : 'node-first evidence still collecting'} (${frontierSupport.sourceDerivedNodeCount} source-derived nodes)`,
    `- Pricing-power path: ${nonObvious.frontierScore >= 62 ? 'frontier report candidate' : 'research lead only'} (${Number(nonObvious.frontierScore || 0).toFixed(0)}/100)`,
    nonObvious.suppressedNarrativeReason ? `- Suppression reason: ${nonObvious.suppressedNarrativeReason}` : null,
    suppression.symbols.length ? `- Suppressed consensus symbols: ${suppression.symbols.join(', ')}` : null,
    suppression.basis.length ? `- Consensus basis: ${suppression.basis.join('; ')}` : null,
    concreteNodes.length ? '' : null,
    concreteNodes.length ? '### Concrete Node Probes' : null,
    ...concreteNodes.map((node) => `- ${node.node || node.key}${node.sourceDerived ? ' (source-derived)' : ''}: ${asArray(node.acceptanceCriteria).slice(0, 3).join('; ')}`),
    '',
  ].filter(Boolean);
}

function renderAppendix(bundle = {}, validation = {}, analysis = {}) {
  return `
    <section class="appendix">
      <h2>Appendix: Audit Trail</h2>
      <p class="muted">The body above is the analyst memo. Raw claim, metric, evidence, caveat, and query records stay here for verification.</p>
      <details open>
        <summary>Signal Cards</summary>
        ${renderSignalCards(analysis.signalCards || [])}
      </details>
      <details>
        <summary>Metric Calibration</summary>
        <pre>${escapeHtml(JSON.stringify(analysis.metricCalibration || {}, null, 2))}</pre>
      </details>
      <details>
        <summary>Evidence Strength</summary>
        <pre>${escapeHtml(JSON.stringify(analysis.evidenceStrength || {}, null, 2))}</pre>
      </details>
      <details>
        <summary>Metric Ledger</summary>
        ${renderMetricList(bundle.metrics || [])}
      </details>
      <details>
        <summary>Evidence Base</summary>
        ${formatList(bundle.evidence || [], (item) => `<strong>${escapeHtml(item.title)}</strong> <span class="muted">${escapeHtml(item.publisher || '')} &middot; ${escapeHtml(item.freshnessStatus || 'unknown')} &middot; ${escapeHtml(item.evidenceGrade || 'ungraded')}</span> <code>${escapeHtml(item.evidenceId)}</code>`)}
      </details>
      <details>
        <summary>Figure Ledger</summary>
        ${formatList(bundle.figures || [], (figure) => `<strong>${escapeHtml(figure.title)}</strong> <span class="muted">${escapeHtml(figure.chartType || '')} &middot; ${escapeHtml(figure.analyticQuestion || '')}</span> <code>${escapeHtml(figure.figureId)}</code>`)}
      </details>
      <details>
        <summary>Caveat Ledger</summary>
        ${formatList(bundle.caveats || [], (item) => `<strong>${escapeHtml(item.severity)}</strong> &middot; ${escapeHtml(item.text)} <code>${escapeHtml(item.caveatId)}</code>`)}
      </details>
      <details>
        <summary>Watch Ledger</summary>
        ${formatList(bundle.watchIndicators || [], (item) => `${escapeHtml(item.label || item.text)} <span class="muted">${escapeHtml(item.source || '')} ${escapeHtml(item.horizon || '')}</span> <code>${escapeHtml(item.watchId)}</code>`)}
      </details>
      <details>
        <summary>Validation</summary>
        <p>Status: <strong>${escapeHtml(validation.status || 'unknown')}</strong></p>
        ${validation.blockers?.length ? `<h3>Blockers</h3>${formatList(validation.blockers, (item) => `${escapeHtml(item.type)}: ${escapeHtml(item.message)}`)}` : ''}
        ${validation.warnings?.length ? `<h3>Warnings</h3>${formatList(validation.warnings, (item) => `${escapeHtml(item.type)}: ${escapeHtml(item.message)}`)}` : ''}
      </details>
      <details>
        <summary>Query Manifest</summary>
        <pre>${escapeHtml(JSON.stringify(bundle.queryManifest || {}, null, 2))}</pre>
      </details>
    </section>
  `;
}

function renderQualityRibbon(validation = {}) {
  const quality = validation.quality || {};
  const publishabilityReasons = asArray(quality.publishabilityReasons);
  const productTier = quality.productTier || quality.investmentReadiness?.tier || null;
  const bottleneckReadiness = quality.bottleneckReadiness || quality.crossThemeDiscoveryQuality || null;
  const isCrossThemeDiscovery = Boolean(bottleneckReadiness);
  const crossThemeActionability = quality.crossThemeActionability || null;
  const researchUtility = quality.researchUtility || null;
  const decisionDiagnostic = quality.decisionDiagnostic?.status && quality.decisionDiagnostic.status !== 'not_applicable'
    ? quality.decisionDiagnostic
    : null;
  const isTriage = productTier === 'signal_triage';
  const isMemoCandidate = productTier === 'investment_memo_candidate';
  const isThesisValidation = productTier === 'thesis_validation';
  const scopeLabel = isCrossThemeDiscovery ? 'Cross-theme discovery' : isTriage ? 'Research prioritization' : (isMemoCandidate || isThesisValidation) ? 'Thesis validation memo' : 'Evidence memo';
  const decisionUse = isCrossThemeDiscovery ? 'Bottleneck validation' : isTriage ? 'Watchlist refinement' : (isMemoCandidate || isThesisValidation) ? 'Investment memo preparation' : 'Analyst review';
  const primaryBlocker = translateClientBlocker(asArray(quality.investmentReadiness?.blockers)[0] || '');
  const hasDecisionGradeMarketValidation = quality.investmentReadiness?.marketValidation?.tier === 'decision_grade';
  const portfolioUse = portfolioUseLabel(quality);
  const bottleneckLabel = evidenceTierDisplayLabel(
    bottleneckReadiness?.tier || productTier,
    bottleneckReadiness?.label || String(productTier || '').replace(/[_-]+/g, ' '),
  );
  const actionBridgeLabel = crossThemeActionability?.label || 'Action bridge pending';
  const investmentGateLabel = quality.investmentReadiness?.tier
    ? String(quality.investmentReadiness.tier).replace(/[_-]+/g, ' ')
    : 'separate gate';
  const discoveryGrade = quality.crossThemeDiscoveryQuality?.grade || bottleneckReadiness?.grade || '';
  const discoveryReadinessLabel = discoveryGrade
    ? discoveryReadinessLabelForGrade(discoveryGrade)
    : (bottleneckLabel || 'Tracked discovery');
  const researchPriorityLabel = researchUtility?.label
    || (researchUtility?.grade ? `Research Priority ${researchUtility.grade}` : 'Research priority tracked');
  const investmentActionabilityLabel = isCrossThemeDiscovery
    ? (decisionDiagnostic?.status === 'decision_ready_review' && crossThemeActionability?.tier === 'analyst_action_review_ready'
      ? 'Analyst review ready'
      : crossThemeActionability?.tier === 'analyst_action_review_ready' || crossThemeActionability?.tier === 'issuer_follow_up_ready'
        ? 'Thesis validation candidate; Not investment-ready'
        : 'Not investment-ready')
    : portfolioUseLabel(quality);
  const evidenceClosureLabel = decisionDiagnostic?.label || (quality.publishable === false ? 'Evidence repair needed' : 'Audit linked');
  const crossThemeClosureBlocked = isCrossThemeDiscovery
    && decisionDiagnostic
    && decisionDiagnostic.status !== 'decision_ready_review';
  const conviction = isCrossThemeDiscovery
    ? (crossThemeClosureBlocked ? 'Evidence-limited; closure blocked' : bottleneckLabel)
    : primaryBlocker ? 'Evidence-limited' : (isMemoCandidate || isThesisValidation) ? 'Review-ready, not decision-ready' : 'Evidence-bound';
  const clientReasons = publishabilityReasons
    .slice(0, 4)
    .map(translateClientBlocker)
    .filter(Boolean)
    .join(' ');
  const publishability = quality.publishable === false || crossThemeClosureBlocked
    ? isCrossThemeDiscovery
      ? `<div class="publishability publishability-blocked"><strong>${escapeHtml(researchPriorityLabel)}; not an investment memo.</strong><p>${escapeHtml(decisionDiagnostic?.nextAction || researchUtility?.nextAction || clientReasons || 'Use this as a research-priority memo until issuer exposure, procurement/substitution evidence, and closure gaps are resolved.')}</p></div>`
      : `<div class="publishability publishability-blocked"><strong>Research memo still needs evidence repair.</strong><p>${escapeHtml(clientReasons) || 'Unresolved evidence-depth or trust gaps remain.'}</p></div>`
    : isCrossThemeDiscovery
      ? `<div class="publishability publishability-ready"><strong>${escapeHtml(bottleneckLabel)}; investment readiness is a separate gate.</strong><p>${escapeHtml(decisionDiagnostic?.nextAction || 'Use this memo to validate a non-obvious cross-theme bottleneck candidate. Investment readiness remains a separate gate.')}</p></div>`
      : productTier === 'signal_triage'
      ? `<div class="publishability publishability-ready"><strong>Research-prioritization memo.</strong><p>Use this memo to decide what to monitor, what to collect, and whether the theme should remain in discovery or move toward active watchlist status.</p></div>`
      : isMemoCandidate
        ? `<div class="publishability publishability-ready"><strong>Thesis validation memo candidate.</strong><p>${hasDecisionGradeMarketValidation ? 'Decision-grade market validation is attached; mechanism attribution, issuer expectation impact, and portfolio context still require analyst review.' : 'No report-blocking evidence gap is attached; decision-grade validation is still required for mechanism support and controlled market sensitivity.'}</p></div>`
        : `<div class="publishability publishability-ready"><strong>Evidence-bound memo candidate.</strong><p>No report-blocking quality gap is attached to this artifact.</p></div>`;
  return `
    <section class="quality">
      ${isCrossThemeDiscovery ? `<div><span>Discovery Readiness</span><strong>${escapeHtml(discoveryReadinessLabel)}</strong></div>` : ''}
      ${isCrossThemeDiscovery ? `<div><span>Research Priority</span><strong>${escapeHtml(researchPriorityLabel)}</strong></div>` : ''}
      ${isCrossThemeDiscovery ? `<div><span>Investment Actionability</span><strong>${escapeHtml(investmentActionabilityLabel)}</strong></div>` : ''}
      ${isCrossThemeDiscovery ? `<div><span>Evidence Closure</span><strong>${escapeHtml(evidenceClosureLabel)}</strong></div>` : ''}
      <div><span>scope</span><strong>${escapeHtml(scopeLabel)}</strong></div>
      <div><span>decision use</span><strong>${escapeHtml(decisionUse)}</strong></div>
      <div><span>conviction</span><strong>${escapeHtml(conviction)}</strong></div>
      ${isCrossThemeDiscovery ? `<div><span>discovery quality</span><strong>${escapeHtml(quality.crossThemeDiscoveryQuality?.grade || 'tracked')}</strong></div>` : ''}
      ${isCrossThemeDiscovery ? `<div><span>evidence tier</span><strong>${escapeHtml(bottleneckLabel)}</strong></div>` : ''}
      ${isCrossThemeDiscovery ? `<div><span>action bridge</span><strong>${escapeHtml(actionBridgeLabel)}</strong></div>` : ''}
      ${isCrossThemeDiscovery ? `<div><span>investment gate</span><strong>${escapeHtml(investmentGateLabel)}</strong></div>` : ''}
      ${isCrossThemeDiscovery && researchUtility?.closureState ? `<div><span>research closure</span><strong>${escapeHtml(tableStatusLabel(researchUtility.closureState))}</strong></div>` : ''}
      ${decisionDiagnostic ? `<div><span>evidence state</span><strong>${escapeHtml(decisionDiagnostic.label)}</strong></div>` : ''}
      ${isMemoCandidate ? `<div><span>portfolio use</span><strong>${escapeHtml(portfolioUse)}</strong></div>` : ''}
      ${primaryBlocker ? `<div><span>primary blocker</span><strong>${escapeHtml(primaryBlocker)}</strong></div>` : ''}
      <div><span>provenance</span><strong>Audit linked</strong></div>
    </section>
    ${publishability}
  `;
}

function portfolioUseLabel(quality = {}) {
  const readiness = quality.investmentReadiness || {};
  const hasDecisionGradeMarketValidation = readiness.marketValidation?.tier === 'decision_grade';
  const hasOpenBlocker = asArray(readiness.blockers).length > 0 || asArray(readiness.decisionValidationGaps).length > 0;
  if (quality.publishable !== false && readiness.tier === 'investment_memo_candidate' && hasDecisionGradeMarketValidation && !hasOpenBlocker) {
    return 'Analyst action review';
  }
  return 'Not actionable';
}

export function renderAuditAppendixHtml(bundle = {}, options = {}) {
  const analysis = options.analysis || {};
  const validation = options.validation || validateReportBundle(bundle, { analysis });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>${escapeHtml(bundle.subject?.displayName || bundle.reportId)} - Audit Appendix</title>
  <style>
    :root{color-scheme:dark;--bg:#0d0f13;--panel:#151922;--line:#2a3140;--text:#e7ecf3;--muted:#9aa7b7;--accent:#d8f99d}
    body{margin:0;background:#0d0f13;color:var(--text);font:14px/1.55 ui-sans-serif,system-ui,Segoe UI,sans-serif}
    main{max-width:1100px;margin:0 auto;padding:32px}
    h1{margin:0 0 8px;font-size:34px}
    .muted{color:var(--muted)}
    a{color:var(--accent)}
    code{background:#0a0c10;border:1px solid var(--line);border-radius:6px;padding:2px 6px;color:var(--accent);font-size:12px}
    section,.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin:14px 0}
    details{border-top:1px solid var(--line);padding:12px 0}
    summary{cursor:pointer;color:var(--accent);font-size:12px;text-transform:uppercase;letter-spacing:.08em}
    pre{white-space:pre-wrap;background:#090b10;border:1px solid var(--line);border-radius:12px;padding:12px;overflow:auto}
    .signal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
    .signal-card{border:1px solid var(--line);border-radius:12px;padding:12px;background:#10141b}
    .signal-head{display:flex;justify-content:space-between;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}
    li{margin:6px 0}
  </style>
</head>
<body>
<main>
  <header>
    <p><a href="./report.html">Back to client memo</a></p>
    <h1>Audit Appendix</h1>
    <p class="muted">${escapeHtml(bundle.reportId)} &middot; ${escapeHtml(bundle.reportType)} &middot; as of ${escapeHtml(bundle.asOf)}</p>
  </header>
  ${renderAppendix(bundle, validation, analysis)}
</main>
</body>
</html>`;
}

function renderFigures(figures = [], options = {}) {
  if (!figures.length) return '<p class="muted">No figures planned.</p>';
  const showIds = options.showIds === true;
  return figures.map((figure, index) => `
    <article class="figure-card">
      <div class="figure-head">
        <strong>Exhibit ${index + 1}. ${escapeHtml(figure.title)}</strong>
        ${showIds ? `<code>${escapeHtml(figure.figureId)}</code>` : ''}
      </div>
      ${figure.renderAssetId
        ? `<img class="figure-img" src="${escapeHtml(figure.renderAssetId)}" alt="${escapeHtml(figure.title)}">`
        : `<div class="figure-placeholder">${escapeHtml(figure.chartType)}</div>`}
      <p>${escapeHtml(figure.metadata?.takeaway || figure.analyticQuestion)}</p>
      ${figure.metadata?.takeaway ? `<p class="muted">Question: ${escapeHtml(figure.analyticQuestion)}</p>` : ''}
      <p class="muted">Data as of ${escapeHtml(figure.dataAsOf || 'unknown')} | supports linked claims in the appendix</p>
    </article>
  `).join('');
}

export function renderReportHtml(bundle = {}, options = {}) {
  const analysis = options.analysis || {};
  const validation = options.validation || validateReportBundle(bundle, { analysis });
  const displayTitle = reportDisplayTitle(bundle, analysis);
  const memoBody = hasLongFormSections(analysis)
    ? renderLongFormSections(analysis.longFormSections)
    : `
  <section>
    <h2>Executive Judgment</h2>
    ${renderParagraphSection(analysis.keyJudgments || bundle.claims || [])}
  </section>
  <section>
    <h2>Core View</h2>
    ${renderParagraphSection(analysis.thesis || [])}
  </section>
  <section>
    <h2>Context</h2>
    ${renderParagraphSection(analysis.context || [])}
  </section>
  <section>
    <h2>What Changed</h2>
    ${renderParagraphSection(analysis.whatChanged || [])}
  </section>
  <section>
    <h2>Evidence Assessment</h2>
    ${renderParagraphSection(analysis.dataDepth || [])}
  </section>
  <section>
    <h2>Economic Mechanism</h2>
    ${renderParagraphSection(analysis.causalChain || [])}
  </section>
  <section>
    <h2>Historical Analogues</h2>
    ${renderParagraphSection(analysis.historicalAnalogues || [])}
  </section>
  <section>
    <h2>Market Implication</h2>
    ${renderParagraphSection(analysis.marketTransmission || [])}
  </section>
  <section>
    <h2>Scenario Matrix</h2>
    ${formatList(analysis.scenarios || [], (item) => `<strong>${escapeHtml(item.label || 'Scenario')}</strong>: ${escapeHtml(item.text || '')}${citationBadge(item)}`)}
  </section>
  <section>
    <h2>Counter-Thesis</h2>
    ${renderParagraphSection(analysis.alternativeExplanations || [])}
  </section>
  <section>
    <h2>Risks and Counterpoints</h2>
    ${renderParagraphSection(analysis.risks || [])}
  </section>
  <section>
    <h2>Caveats and Information Gaps</h2>
    ${renderParagraphSection(analysis.informationGaps || [])}
  </section>
  <section>
    <h2>What Would Change Our Mind</h2>
    ${renderParagraphSection(analysis.whatWouldChangeMind || analysis.decisionUse || [])}
  </section>
  <section>
    <h2>Watch Next</h2>
    ${renderParagraphSection(analysis.watchNext?.length ? analysis.watchNext : [])}
  </section>
  <section>
    <h2>Research Agenda</h2>
    ${renderParagraphSection(analysis.researchAgenda || analysis.sourceQueries || [])}
  </section>
  <section>
    <h2>Analyst Conclusion</h2>
    ${renderParagraphSection(analysis.analystConclusion || [])}
  </section>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>${escapeHtml(displayTitle)} - Lattice Report</title>
  <style>
    :root{color-scheme:dark;--bg:#0d0f13;--panel:#151922;--line:#2a3140;--text:#e7ecf3;--muted:#9aa7b7;--accent:#d8f99d;--warn:#fbbf24;--bad:#fb7185}
    body{margin:0;background:radial-gradient(circle at 20% 0%,#1a2119 0,#0d0f13 34%,#080a0e 100%);color:var(--text);font:15px/1.65 Georgia,ui-serif,serif}
    main{max-width:980px;margin:0 auto;padding:38px 32px 64px}
    header{border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:20px}
    h1{margin:0 0 10px;font-size:42px;line-height:1.05;letter-spacing:-.03em}
    h2{margin:30px 0 10px;font-size:20px;letter-spacing:-.01em}
    h3{margin:18px 0 8px;font-size:15px}
    .muted{color:var(--muted)}
    .meta,.refs{display:flex;gap:8px;flex-wrap:wrap;color:var(--muted);font-size:12px}
    code{background:#0a0c10;border:1px solid var(--line);border-radius:6px;padding:2px 6px;color:var(--accent);font-size:12px}
    section,.card,.figure-card{background:rgba(21,25,34,.82);border:1px solid var(--line);border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 18px 60px rgba(0,0,0,.18)}
    li{margin:8px 0}
    .quality{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;background:#10141b}
    .quality div{border:1px solid var(--line);border-radius:10px;padding:10px}
    .quality span{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}
    .quality strong{font-size:17px}
    .publishability{margin:0 0 18px;border-radius:16px;padding:14px 16px}
    .publishability strong{display:block;margin-bottom:4px}
    .publishability p{margin:0;color:var(--muted)}
    .publishability-blocked{border:1px solid rgba(251,191,36,.5);background:rgba(251,191,36,.08)}
    .publishability-ready{border:1px solid rgba(52,211,153,.35);background:rgba(52,211,153,.08)}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .figure-head{display:flex;justify-content:space-between;gap:12px;align-items:center}
    .figure-placeholder{height:130px;border:1px dashed var(--line);border-radius:10px;display:grid;place-items:center;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;margin:10px 0;background:#0f1218}
    .figure-img{width:100%;height:auto;border:1px solid var(--line);border-radius:10px;margin:10px 0;background:#0f1218}
    .table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px;background:#0f1218;margin:10px 0 18px}
    .evidence-table{width:100%;border-collapse:collapse;font:12px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
    .evidence-table th{position:sticky;top:0;background:#141a24;color:#d8f99d;text-align:left;text-transform:uppercase;letter-spacing:.07em;font-size:11px}
    .evidence-table th,.evidence-table td{border-bottom:1px solid var(--line);padding:9px 10px;vertical-align:top}
    .evidence-table tr:last-child td{border-bottom:0}
    .institutional-tables h3{margin-top:22px;color:#f1f5f9}
    .cite{display:inline-block;margin-left:8px;padding:1px 7px;border:1px solid rgba(216,249,157,.35);border-radius:999px;color:var(--accent);font:11px/1.5 ui-sans-serif,system-ui,sans-serif;vertical-align:middle}
    .memo-copy p{margin:0 0 14px}
    .memo-copy p:last-child{margin-bottom:0}
    .memo-nav{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 0}
    .memo-nav a{color:var(--accent);text-decoration:none;border:1px solid rgba(216,249,157,.25);border-radius:999px;padding:4px 10px;font:12px/1.4 ui-sans-serif,system-ui,sans-serif}
    .signal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
    .signal-card{background:#10141b;border:1px solid var(--line);border-radius:13px;padding:13px}
    .signal-head{display:flex;justify-content:space-between;color:var(--muted);font:11px/1.4 ui-sans-serif,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em}
    .signal-card h3{font-size:16px;margin:8px 0}
    .signal-strong{border-color:rgba(52,211,153,.45)}
    .signal-medium{border-color:rgba(216,249,157,.38)}
    .signal-watch{border-color:rgba(251,191,36,.38)}
    .signal-weak{border-color:rgba(251,113,133,.35)}
    details{border-top:1px solid var(--line);padding:12px 0}
    summary{cursor:pointer;color:var(--accent);font:13px/1.4 ui-sans-serif,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em}
    .appendix{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
    .appendix ul{font-size:13px}
    .blocker{border-color:rgba(251,113,133,.5)}
    .warning{border-color:rgba(251,191,36,.5)}
    @media(max-width:820px){main{padding:18px}.quality,.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
<main>
  <header>
    <div class="meta">
      <span>${escapeHtml(bundle.reportTypeLabel || 'Lattice intelligence report')}</span>
      <span>${escapeHtml(bundle.reportId)}</span>
      <span>as of ${escapeHtml(bundle.asOf)}</span>
    </div>
    <h1>${escapeHtml(displayTitle)}</h1>
    <p class="muted">${escapeHtml(bundle.reportTypeLabel || 'Lattice intelligence report')} | client memo. Raw ledgers live in the audit appendix.</p>
    <div class="memo-nav">
      <a href="./audit_appendix.html">Audit appendix</a>
      <a href="./bundle.json">Evidence bundle</a>
      <a href="./source-query-drafts.json">Evidence tasks</a>
    </div>
  </header>
  ${renderQualityRibbon(validation)}
  ${memoBody}
  ${renderNonObviousDiscoveryHtml(bundle)}
  ${renderInstitutionalEvidenceTablesHtml(bundle, validation)}
  <section>
    <h2>Exhibits</h2>
    <div class="grid">${renderFigures((bundle.figures || []).slice(0, 6))}</div>
  </section>
</main>
</body>
</html>`;
}

export function renderReportMarkdown(bundle = {}, options = {}) {
  const analysis = options.analysis || {};
  const validation = options.validation || validateReportBundle(bundle, { analysis });
  const lines = [];
  lines.push(`# ${reportDisplayTitle(bundle, analysis)}`);
  lines.push('');
  lines.push(`- Report: ${bundle.reportId}`);
  lines.push(`- Type: ${bundle.reportType}`);
  lines.push(`- As of: ${bundle.asOf}`);
  const quality = validation.quality || {};
  const productTier = quality.productTier || quality.investmentReadiness?.tier || null;
  const bottleneckReadiness = quality.bottleneckReadiness || quality.crossThemeDiscoveryQuality || null;
  const isCrossThemeDiscovery = Boolean(bottleneckReadiness);
  const isTriage = productTier === 'signal_triage';
  const isMemoCandidate = productTier === 'investment_memo_candidate';
  const isThesisValidation = productTier === 'thesis_validation';
  const decisionDiagnostic = quality.decisionDiagnostic?.status && quality.decisionDiagnostic.status !== 'not_applicable'
    ? quality.decisionDiagnostic
    : null;
  lines.push(`- Scope: ${isCrossThemeDiscovery ? 'Cross-theme discovery' : isTriage ? 'Research prioritization' : (isMemoCandidate || isThesisValidation) ? 'Thesis validation memo' : 'Evidence memo'}`);
  lines.push(`- Decision use: ${isCrossThemeDiscovery ? 'Bottleneck validation' : isTriage ? 'Watchlist refinement' : (isMemoCandidate || isThesisValidation) ? 'Investment memo preparation' : 'Analyst review'}`);
  if (isCrossThemeDiscovery) {
    const grade = quality.crossThemeDiscoveryQuality?.grade;
    const discoveryLabel = grade
      ? discoveryReadinessLabelForGrade(grade)
      : evidenceTierDisplayLabel(bottleneckReadiness.tier || productTier, bottleneckReadiness.label || productTier);
    lines.push(`- Discovery Readiness: ${discoveryLabel}`);
  }
  if (isCrossThemeDiscovery) lines.push(`- Research Priority: ${quality.researchUtility?.label || 'Research priority tracked'}`);
  if (isCrossThemeDiscovery) {
    const crossThemeActionability = quality.crossThemeActionability || {};
    const investmentActionabilityLabel = decisionDiagnostic?.status === 'decision_ready_review' && crossThemeActionability.tier === 'analyst_action_review_ready'
      ? 'Analyst review ready'
      : crossThemeActionability.tier === 'analyst_action_review_ready' || crossThemeActionability.tier === 'issuer_follow_up_ready'
        ? 'Thesis validation candidate; Not investment-ready'
        : 'Not investment-ready';
    lines.push(`- Investment Actionability: ${investmentActionabilityLabel}`);
  }
  if (isCrossThemeDiscovery) lines.push(`- Evidence Closure: ${decisionDiagnostic?.label || 'Evidence repair needed'}`);
  if (isCrossThemeDiscovery) lines.push(`- Evidence tier: ${evidenceTierDisplayLabel(bottleneckReadiness.tier || productTier, bottleneckReadiness.label || productTier)}`);
  if (decisionDiagnostic) lines.push(`- Evidence state: ${decisionDiagnostic.label}`);
  if (isMemoCandidate || isThesisValidation) lines.push(`- Portfolio use: ${portfolioUseLabel(quality)}`);
  lines.push('');
  if (hasLongFormSections(analysis)) {
    lines.push(...renderLongFormMarkdown(analysis.longFormSections));
    lines.push(...renderNonObviousDiscoveryMarkdown(bundle));
    lines.push(...renderInstitutionalEvidenceTablesMarkdown(bundle, validation));
    lines.push('## Exhibits');
    for (const [index, figure] of (bundle.figures || []).slice(0, 6).entries()) {
      lines.push(`- Exhibit ${index + 1}. ${figure.title} - ${figure.metadata?.takeaway || figure.analyticQuestion}`);
    }
    lines.push('');
    lines.push('## Verification');
    lines.push('Full provenance, validation details, and raw audit records are written separately in audit_appendix.html and audit_appendix.json.');
    return `${lines.join('\n')}\n`;
  }
  if ((analysis.codexNarrativeHead || []).length) {
    lines.push('## Analyst Narrative');
    for (const item of analysis.codexNarrativeHead) lines.push(`${item.text}${mdCitation(item)}`);
    lines.push('');
  }
  lines.push('## Executive Judgment');
  for (const item of (analysis.keyJudgments || bundle.claims || [])) {
    lines.push(`- ${item.text || item.generatedText || item.canonicalText}${mdCitation(item)}`);
  }
  lines.push('');
  lines.push('## Core View');
  for (const item of (analysis.thesis || [])) {
    lines.push(`- ${item.text}${mdCitation(item)}`);
  }
  lines.push('');
  lines.push('## Context');
  for (const item of (analysis.context || [])) {
    lines.push(`- ${item.text}${mdCitation(item)}`);
  }
  lines.push('');
  if ((analysis.codexBullThesis || []).length || (analysis.codexBearThesis || []).length || (analysis.codexInvalidator || []).length) {
    lines.push('## Bull / Bear Synthesis');
    if ((analysis.codexBullThesis || []).length) {
      lines.push('### Bull thesis');
      for (const item of analysis.codexBullThesis) lines.push(`${item.text}${mdCitation(item)}`);
    }
    if ((analysis.codexBearThesis || []).length) {
      lines.push('### Bear thesis');
      for (const item of analysis.codexBearThesis) lines.push(`${item.text}${mdCitation(item)}`);
    }
    if ((analysis.codexInvalidator || []).length) {
      lines.push('### What would change my mind');
      for (const item of analysis.codexInvalidator) lines.push(`${item.text}${mdCitation(item)}`);
    }
    lines.push('');
  }
  lines.push('## What Changed');
  for (const item of (analysis.whatChanged || [])) {
    lines.push(`- ${item.text}${mdCitation(item)}`);
  }
  lines.push('');
  lines.push('## Evidence Assessment');
  for (const item of (analysis.dataDepth || [])) {
    lines.push(`- ${item.text}${mdCitation(item)}`);
  }
  lines.push('');
  lines.push('## Economic Mechanism');
  for (const item of (analysis.causalChain || [])) {
    lines.push(`- ${item.text}${mdCitation(item)}`);
  }
  lines.push('');
  lines.push('## Historical Analogues');
  for (const item of (analysis.historicalAnalogues || [])) {
    lines.push(`- ${item.text}${mdCitation(item)}`);
  }
  lines.push('');
  lines.push('## Market Implication');
  for (const item of (analysis.marketTransmission || [])) {
    lines.push(`- ${item.text}${mdCitation(item)}`);
  }
  lines.push('');
  lines.push('## Scenario Matrix');
  for (const item of (analysis.scenarios || [])) {
    lines.push(`- ${item.label || 'Scenario'}: ${item.text}${mdCitation(item)}`);
  }
  lines.push('');
  lines.push(...renderNonObviousDiscoveryMarkdown(bundle));
  lines.push(...renderInstitutionalEvidenceTablesMarkdown(bundle, validation));
  lines.push('## Figures');
  for (const [index, figure] of (bundle.figures || []).slice(0, 6).entries()) {
    lines.push(`- Exhibit ${index + 1}. ${figure.title} - ${figure.metadata?.takeaway || figure.analyticQuestion}`);
  }
  lines.push('');
  lines.push('## Counter-Thesis');
  for (const item of (analysis.alternativeExplanations || [])) {
    lines.push(`- ${item.text}${mdCitation(item)}`);
  }
  lines.push('');
  lines.push('## Caveats');
  for (const item of (analysis.informationGaps || [])) {
    lines.push(`- ${item.text}${mdCitation(item)}`);
  }
  lines.push('');
  lines.push('## Risks and Counterpoints');
  for (const item of (analysis.risks || [])) {
    lines.push(`- ${item.text}${mdCitation(item)}`);
  }
  lines.push('');
  lines.push('## Watch Next');
  for (const item of (analysis.watchNext || [])) {
    lines.push(`- ${item.text || item.label}${mdCitation(item)}`);
  }
  lines.push('');
  lines.push('## What Would Change Our Mind');
  for (const item of (analysis.whatWouldChangeMind || analysis.decisionUse || [])) {
    lines.push(`- ${item.text}${mdCitation(item)}`);
  }
  lines.push('');
  lines.push('## Research Agenda');
  for (const item of (analysis.researchAgenda || [])) {
    lines.push(`- ${item.text}${mdCitation(item)}`);
  }
  lines.push('');
  lines.push('## Feedback Learning');
  for (const item of (analysis.feedbackLearning || [])) {
    lines.push(`- ${item.text}${mdCitation(item)}`);
  }
  lines.push('');
  lines.push('## Analyst Conclusion');
  for (const item of (analysis.analystConclusion || [])) {
    lines.push(`- ${item.text}${mdCitation(item)}`);
  }
  lines.push('');
  lines.push('## Verification');
  lines.push('Full provenance, validation details, and raw audit records are written separately in audit_appendix.html and audit_appendix.json.');
  return `${lines.join('\n')}\n`;
}
