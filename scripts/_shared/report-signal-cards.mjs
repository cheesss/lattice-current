import { buildEvidenceStrengthSummary } from './report-evidence-strength.mjs';
import { buildMetricCalibrationSummary } from './report-metric-calibration.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function first(array) {
  return asArray(array)[0] || null;
}

function unique(items) {
  return [...new Set(asArray(items).filter(Boolean))];
}

function subjectName(bundle = {}) {
  return bundle.subject?.displayName || bundle.subject?.subjectId || 'The subject';
}

function packStatus(bundle = {}, packName) {
  return String(bundle.metadata?.deepResearch?.packs?.[packName]?.status || 'missing');
}

function metricByPattern(bundle = {}, pattern) {
  return asArray(bundle.metrics).find((metric) => pattern.test(String(metric.name || metric.metricId || '')));
}

function refsFromBundle(bundle = {}, extra = {}) {
  const claim = first(bundle.claims) || {};
  const claimIdsKnown = new Set(asArray(bundle.claims).map((row) => row.claimId).filter(Boolean));
  const evidenceIdsKnown = new Set(asArray(bundle.evidence).map((row) => row.evidenceId).filter(Boolean));
  const metricIdsKnown = new Set(asArray(bundle.metrics).map((row) => row.metricId).filter(Boolean));
  const figureIdsKnown = new Set(asArray(bundle.figures).map((row) => row.figureId).filter(Boolean));
  const caveatIdsKnown = new Set(asArray(bundle.caveats).map((row) => row.caveatId).filter(Boolean));
  const onlyKnown = (ids, known) => unique(ids).filter((id) => known.has(id));
  return {
    claimIds: onlyKnown([claim.claimId, ...asArray(extra.claimIds)], claimIdsKnown),
    evidenceIds: onlyKnown([...asArray(claim.supportingEvidenceIds), ...asArray(extra.evidenceIds)], evidenceIdsKnown).slice(0, 5),
    metricIds: onlyKnown([...asArray(claim.supportingMetricIds), ...asArray(extra.metricIds)], metricIdsKnown).slice(0, 5),
    figureIds: onlyKnown([...asArray(claim.supportingFigureIds), ...asArray(extra.figureIds)], figureIdsKnown).slice(0, 4),
    caveatIds: onlyKnown([...asArray(claim.caveatIds), ...asArray(extra.caveatIds)], caveatIdsKnown).slice(0, 5),
  };
}

function card({
  domain,
  title,
  strength = 'weak',
  evidenceClass = 'D',
  interpretation,
  decisionUse,
  refs = {},
  metadata = {},
}) {
  return {
    domain,
    title,
    strength,
    evidenceClass,
    interpretation,
    decisionUse,
    ...refs,
    metadata,
  };
}

function strengthFromClass(evidenceClass) {
  if (evidenceClass === 'A') return 'strong';
  if (evidenceClass === 'B') return 'medium';
  if (evidenceClass === 'C') return 'watch';
  return 'weak';
}

function buildAttentionCard(bundle, calibration, evidenceStrength) {
  const sampleMetric = metricByPattern(bundle, /article|evidence|sample|momentum|acceleration/i);
  const calibrated = calibration.metrics.find((metric) => metric.metricId === sampleMetric?.metricId) || null;
  const sourceSummary = bundle.sourceSummary || {};
  const articleCount = Number(sourceSummary.articleCount ?? sourceSummary.article_count ?? sampleMetric?.value ?? 0);
  const claimClass = first(evidenceStrength.claims)?.evidenceClass || 'D';
  const isThin = articleCount > 0 && articleCount < 10;
  return card({
    domain: 'attention',
    title: 'Attention signal',
    strength: isThin ? 'weak' : strengthFromClass(claimClass),
    evidenceClass: isThin ? 'D' : claimClass,
    interpretation: calibrated
      ? `${calibrated.interpretation}. This describes media or evidence flow, not fundamental demand by itself.`
      : `${subjectName(bundle)} has an attention/evidence signal, but the bundle lacks a calibrated attention metric.`,
    decisionUse: isThin
      ? 'triage only; do not call the theme declining or expanding from this sample'
      : 'use as a first-pass change detector, then confirm with fundamental and constraint evidence',
    refs: refsFromBundle(bundle, { metricIds: sampleMetric ? [sampleMetric.metricId] : [] }),
    metadata: { articleCount, calibration: calibrated },
  });
}

function buildFundamentalCard(bundle) {
  const available = ['fundamentalPack', 'filingPack', 'transcriptPack']
    .filter((packName) => packStatus(bundle, packName) === 'available');
  const evidenceClass = available.length >= 2 ? 'B' : available.length ? 'C' : 'E';
  return card({
    domain: 'fundamental',
    title: 'Fundamental signal',
    strength: available.length >= 2 ? 'medium' : available.length ? 'watch' : 'weak',
    evidenceClass,
    interpretation: available.length
      ? `Fundamental coverage is present through ${available.join(', ')}. The memo can discuss economics, but should still avoid unsupported valuation claims.`
      : 'Fundamental, filing, and transcript evidence are not yet deep enough to support an investment-grade conclusion.',
    decisionUse: available.length >= 2
      ? 'supports thesis refinement when paired with market and causal evidence'
      : 'convert the gap into backfill/source-query tasks before publishing an investment memo',
    refs: refsFromBundle(bundle, { metricIds: ['MET-DEEP-DATA-DEPTH'].filter(Boolean) }),
    metadata: { availablePacks: available },
  });
}

function buildMarketCard(bundle) {
  const reactions = asArray(bundle.marketReactions);
  const validated = reactions.filter((reaction) => String(reaction.validationStatus || '').toLowerCase() === 'validated');
  const tStats = reactions.map((reaction) => Math.abs(Number(reaction.tStat ?? 0))).filter(Number.isFinite);
  const maxT = tStats.length ? Math.max(...tStats) : 0;
  const nonCompany = new Set(['SPY', 'QQQ', 'DIA', 'IWM', 'GLD', 'TLT', 'UUP', 'USO', 'UNG', 'DBC', 'XLE', 'XLK', 'XLV', 'EFA', 'EEM']);
  const symbols = unique(reactions.map((reaction) => String(reaction.symbol || '').toUpperCase()).filter((symbol) => symbol && !nonCompany.has(symbol))).slice(0, 5);
  const evidenceClass = validated.length && maxT >= 1.5 ? 'B' : reactions.length ? 'C' : 'E';
  return card({
    domain: 'market',
    title: 'Market transmission',
    strength: evidenceClass === 'B' ? 'medium' : evidenceClass === 'C' ? 'watch' : 'weak',
    evidenceClass,
    interpretation: reactions.length
      ? `Market evidence identifies monitored links in ${symbols.length ? symbols.join(', ') : 'the attached peer set'}. Treat this as event-window sensitivity, not durable alpha, until benchmark, factor, and regime validation clear.`
      : 'No market reaction rows are attached, so asset transmission is unmeasured.',
    decisionUse: evidenceClass === 'B'
      ? 'supports market-implication discussion with event-window caveats'
      : 'use for screening or open a market backfill task',
    refs: refsFromBundle(bundle, { metricIds: reactions.flatMap((reaction) => asArray(reaction.metricIds)) }),
    metadata: { reactionCount: reactions.length, validatedCount: validated.length, maxAbsTStat: maxT, symbols },
  });
}

function buildConstraintCard(bundle) {
  const industryAvailable = packStatus(bundle, 'industryPack') === 'available';
  const crossAssetPaths = asArray(bundle.metadata?.crossAssetPaths?.paths);
  const evidenceClass = industryAvailable ? 'B' : crossAssetPaths.length ? 'C' : 'D';
  return card({
    domain: 'constraint',
    title: 'Constraint or bottleneck signal',
    strength: industryAvailable ? 'medium' : crossAssetPaths.length ? 'watch' : 'weak',
    evidenceClass,
    interpretation: industryAvailable
      ? 'Industry KPI rows are available, so the memo can discuss physical capacity, utilization, orders, or bottleneck evidence.'
      : crossAssetPaths.length
        ? 'Cross-asset paths suggest candidate bottlenecks, but industry KPI confirmation is still missing.'
        : 'No physical bottleneck evidence is attached yet.',
    decisionUse: industryAvailable ? 'use as economic mechanism support' : 'route to industry/source backfill before treating as a bottleneck',
    refs: refsFromBundle(bundle, { metricIds: ['MET-DEEP-KPI-COVERAGE'].filter(Boolean) }),
    metadata: { industryAvailable, crossAssetPathCount: crossAssetPaths.length },
  });
}

function buildCausalCard(bundle) {
  const edges = asArray(bundle.metadata?.deepResearch?.packs?.causalPack?.edges);
  const supported = edges.filter((edge) => Number(edge.confidence ?? edge.edgeScore ?? 0) >= 0.7);
  const evidenceClass = supported.length ? 'B' : edges.length ? 'C' : 'E';
  return card({
    domain: 'causal',
    title: 'Causal mechanism',
    strength: supported.length ? 'medium' : edges.length ? 'watch' : 'weak',
    evidenceClass,
    interpretation: supported.length
      ? `${supported.length} causal edge(s) clear the support threshold. Correlation, temporal relation, and causal hypothesis must remain labeled separately.`
      : edges.length
        ? 'Causal edges exist but are candidate-tier; they should frame hypotheses rather than thesis proof.'
        : 'No causal edge is attached; the report can describe gaps but not a transmission mechanism.',
    decisionUse: supported.length ? 'use to structure thesis mechanism' : 'keep in scenario/counter-thesis or research queue',
    refs: refsFromBundle(bundle, { metricIds: ['MET-DEEP-CAUSAL-EDGES'] }),
    metadata: { edgeCount: edges.length, supportedEdgeCount: supported.length },
  });
}

function buildResearchCard(bundle) {
  const researchAvailable = packStatus(bundle, 'researchPack') === 'available';
  const policyAvailable = packStatus(bundle, 'policyPack') === 'available';
  const available = [researchAvailable && 'researchPack', policyAvailable && 'policyPack'].filter(Boolean);
  const evidenceClass = available.length === 2 ? 'B' : available.length ? 'C' : 'D';
  return card({
    domain: 'research_policy',
    title: 'Research and policy context',
    strength: available.length === 2 ? 'medium' : available.length ? 'watch' : 'weak',
    evidenceClass,
    interpretation: available.length
      ? `Context coverage is present through ${available.join(', ')}.`
      : 'Research, patent, technical maturity, and policy evidence are sparse.',
    decisionUse: available.length ? 'supports background and invalidator framing' : 'open research/policy collection tasks',
    refs: refsFromBundle(bundle),
    metadata: { availablePacks: available },
  });
}

export function buildSignalCards(bundle = {}) {
  const evidenceStrength = buildEvidenceStrengthSummary(bundle);
  const metricCalibration = buildMetricCalibrationSummary(bundle);
  const cards = [
    buildAttentionCard(bundle, metricCalibration, evidenceStrength),
    buildFundamentalCard(bundle),
    buildMarketCard(bundle),
    buildConstraintCard(bundle),
    buildCausalCard(bundle),
    buildResearchCard(bundle),
  ];
  return {
    generatedAt: new Date().toISOString(),
    cards,
    evidenceStrength,
    metricCalibration,
  };
}
