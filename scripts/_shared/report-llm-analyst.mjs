import { buildTypedAnalystSections } from './report-analyst-typed.mjs';
import { generateCodexNarrative, validateCodexNarrative, narrativeToAnalystBlocks } from './report-codex-narrator.mjs';
import { buildSignalCards } from './report-signal-cards.mjs';
import { buildAnalystSynthesis } from './report-analyst-synthesis.mjs';
import { applyNarrativeEditorPass, buildNarrativePlan, enhanceAnalysisWithAdaptiveNarrativeStructure } from './report-narrative-plan.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function first(array) {
  return Array.isArray(array) && array.length ? array[0] : null;
}

function unique(items) {
  return [...new Set(asArray(items).filter(Boolean))];
}

const METRIC_LABELS = new Map([
  ['article_count', 'article volume'],
  ['YoY', 'YoY change'],
  ['recent_evidence_items', 'recent evidence flow'],
  ['distinct_sources', 'independent source count'],
  ['source_diversity', 'source breadth'],
  ['candidate_score', 'connector score'],
  ['evidence_score', 'evidence quality'],
  ['seed_similarity', 'seed similarity'],
  ['theme_exposure_score', 'theme exposure score'],
  ['relative_return', 'relative return'],
  ['validation_quality', 'validation quality'],
  ['regime_confidence', 'regime confidence'],
  ['transmission_edges', 'transmission links'],
  ['fresh_datasets', 'fresh input count'],
  ['stale_datasets', 'stale input count'],
  ['pending_validation', 'pending validation items'],
  ['ece', 'calibration error'],
  ['data_depth_score', 'research depth'],
  ['causal_edge_count', 'causal chain breadth'],
  ['historical_analog_count', 'historical analogue count'],
  ['structured_gap_count', 'open research gaps'],
  ['feedback_rows', 'feedback examples'],
]);

const PACK_LABELS = new Map([
  ['marketPack', 'market reaction context'],
  ['fundamentalPack', 'fundamentals'],
  ['filingPack', 'filings'],
  ['transcriptPack', 'management commentary'],
  ['industryPack', 'industry data'],
  ['researchPack', 'technical research'],
  ['policyPack', 'policy and regulation'],
  ['causalPack', 'causal chain'],
  ['historicalAnalogPack', 'historical memory'],
  ['feedbackPack', 'feedback learning'],
  ['institutionalEvidencePack', 'institutional evidence density'],
]);

const DATASET_LABELS = new Map([
  ['theme_trend_aggregates', 'theme trend inputs'],
  ['event_clusters', 'event clustering inputs'],
  ['event_market_transmission', 'event transmission inputs'],
  ['cross_theme_candidates', 'cross-theme discovery inputs'],
  ['symbol_exposure', 'symbol exposure inputs'],
  ['ops_status', 'system status inputs'],
  ['validation_snapshot', 'validation snapshot inputs'],
]);

function humanizeIdentifier(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function metricLabel(metric = {}) {
  const name = String(metric.name || metric.metricId || 'metric');
  return METRIC_LABELS.get(name) || humanizeIdentifier(name) || 'metric';
}

function packLabel(name) {
  return PACK_LABELS.get(String(name || '')) || humanizeIdentifier(name) || 'research area';
}

function datasetLabel(name) {
  return DATASET_LABELS.get(String(name || '')) || humanizeIdentifier(name) || 'input';
}

function claimRefs(claim = {}, bundle = {}) {
  return {
    claimIds: unique([
      claim.claimId,
      bundle.claims?.[0]?.claimId,
    ]).slice(0, 2),
    evidenceIds: unique([
      ...asArray(claim.supportingEvidenceIds),
      ...asArray(bundle.evidence).map((item) => item.evidenceId),
    ]).slice(0, 4),
    metricIds: unique([
      ...asArray(claim.supportingMetricIds),
      ...asArray(bundle.metrics).map((item) => item.metricId),
    ]).slice(0, 6),
    figureIds: unique([
      ...asArray(claim.supportingFigureIds),
      ...asArray(bundle.figures).map((item) => item.figureId),
    ]).slice(0, 4),
    caveatIds: unique([
      ...asArray(claim.caveatIds),
      ...asArray(bundle.caveats).map((item) => item.caveatId),
    ]).slice(0, 6),
  };
}

function refsFor({ claim = {}, bundle = {}, evidence = [], metrics = [], figures = [], caveats = [] } = {}) {
  const base = claimRefs(claim, bundle);
  return {
    claimIds: base.claimIds,
    evidenceIds: unique([...asArray(evidence).map((item) => item.evidenceId), ...base.evidenceIds]).slice(0, 4),
    metricIds: unique([...asArray(metrics).map((item) => item.metricId), ...base.metricIds]).slice(0, 6),
    figureIds: unique([...asArray(figures).map((item) => item.figureId), ...base.figureIds]).slice(0, 4),
    caveatIds: unique([...asArray(caveats).map((item) => item.caveatId), ...base.caveatIds]).slice(0, 6),
  };
}

function claimById(bundle = {}, claimId) {
  return asArray(bundle.claims).find((claim) => claim.claimId === claimId) || null;
}

function refsForDeep(bundle = {}, opts = {}) {
  const claim = claimById(bundle, 'CLM-DEEP-RESEARCH') || first(bundle.claims) || {};
  return refsFor({
    claim,
    bundle,
    evidence: asArray(opts.evidence),
    metrics: asArray(opts.metrics),
    figures: asArray(opts.figures),
    caveats: asArray(opts.caveats),
  });
}

function formatMetricValue(metric = {}) {
  if (Number.isFinite(Number(metric.value))) {
    const number = Number(metric.value);
    if (Number.isInteger(number)) return String(number);
    return String(Number(number.toFixed(3)));
  }
  return String(metric.value ?? 'unknown');
}

function metricPhrase(metric = {}) {
  const numeric = Number(metric.value);
  const limitations = asArray(metric.limitations).join(' ');
  if (
    String(metric.name || '').toLowerCase() === 'acceleration'
    && Number.isFinite(numeric)
    && (Math.abs(numeric) > 100 || /baseline|sparse|zero/i.test(limitations))
  ) {
    const direction = numeric > 0 ? 'positive' : numeric < 0 ? 'negative' : 'flat';
    return `the acceleration flag is ${direction}; the ${formatMetricValue(metric)}${metric.unit ? ` ${metric.unit}` : ''} point estimate is baseline-sensitive and should not be read as precise magnitude`;
  }
  const unit = metric.unit ? ` ${metric.unit}` : '';
  const window = metric.window ? ` in the ${metric.window} lens` : '';
  return `${metricLabel(metric)} is ${formatMetricValue(metric)}${unit}${window}`;
}

function metricSignalStrength(metric = {}) {
  const value = Math.abs(Number(metric.value));
  if (!Number.isFinite(value)) return 0;
  const name = String(metric.name || '');
  if (value === 0) return 0;
  if (/recent|fresh|evidence|acceleration|yoy|confidence|validation|exposure|return|temperature|edge/i.test(name)) return value + 10;
  return value;
}

function orderedMetrics(metrics = []) {
  return [...asArray(metrics)].sort((a, b) => metricSignalStrength(b) - metricSignalStrength(a));
}

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function proseSafeTitle(value) {
  const title = String(value || '').replace(/\s+/g, ' ').trim();
  if (!title) return 'attached evidence item';
  /* Numeric validators treat fresh numbers in prose as generated claims. Keep
   * titles readable, but avoid letting headline numerals look like memo facts. */
  return title.replace(/[-+]?\d+(?:\.\d+)?%?/g, 'reported figure');
}

function proseSafeCaveat(value) {
  return String(value || '')
    .replace(/\bfundamentalPack\b/g, 'fundamental data pack')
    .replace(/\bfilingPack\b/g, 'filing evidence pack')
    .replace(/\btranscriptPack\b/g, 'management commentary pack')
    .replace(/\bindustryPack\b/g, 'industry KPI pack')
    .replace(/\bresearchPack\b/g, 'technical research pack')
    .replace(/\bpolicyPack\b/g, 'policy and regulation pack')
    .replace(/\b[A-Z]{2,}(?:-[A-Z]+)*-\d+(?:-[A-Z0-9]+)?\b/g, 'the referenced validation item')
    .replace(/\b[A-Z]+-\d+\b/g, 'the referenced item')
    .replace(/[-+]?\d+(?:\.\d+)?%?/g, 'reported figure')
    .replace(/\s+/g, ' ')
    .trim();
}

function proseSafeMemoText(value) {
  return String(value || '')
    .replace(/\bfundamentalPack\b/g, 'fundamental data pack')
    .replace(/\bfilingPack\b/g, 'filing evidence pack')
    .replace(/\btranscriptPack\b/g, 'management commentary pack')
    .replace(/\bindustryPack\b/g, 'industry KPI pack')
    .replace(/\bresearchPack\b/g, 'technical research pack')
    .replace(/\bpolicyPack\b/g, 'policy and regulation pack')
    .replace(/\b[A-Z]{2,}(?:-[A-Z]+)*-\d+(?:-[A-Z0-9]+)?\b/g, 'the referenced item')
    .replace(/\btheme_trend_aggregates\b/gi, 'theme trend inputs')
    .replace(/\bstock_sensitivity_matrix\b/gi, 'symbol sensitivity screen')
    .replace(/\bcanonical_events\b/gi, 'event timeline')
    .replace(/\bmarket-reaction row\b/gi, 'measured market reaction')
    .replace(/\brows?\b/gi, (match) => (match.toLowerCase() === 'rows' ? 'items' : 'item'))
    .replace(/\bfields?\b/gi, (match) => (match.toLowerCase() === 'fields' ? 'inputs' : 'input'))
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentenceStem(value) {
  return proseSafeCaveat(value).replace(/[.。]+$/g, '');
}

function freshnessSummary(bundle = {}) {
  const statuses = unique(asArray(bundle.dataFreshness).map((item) => item.freshnessStatus || 'unknown'));
  if (!statuses.length) return 'Freshness is unknown, so conviction should remain bounded.';
  const degraded = statuses.some((status) => /stale|degraded/i.test(status));
  if (degraded) {
    return `System freshness is ${statuses.join(', ')}. Current article evidence can still be useful, but aggregate or model-derived conclusions should stay caveated until the stale input is repaired.`;
  }
  return `System freshness is ${statuses.join(', ')}; the report can use the attached inputs as current for this coverage window.`;
}

function evidenceSummary(bundle = {}) {
  const statuses = unique(asArray(bundle.evidence).map((item) => item.freshnessStatus || 'unknown'));
  if (!asArray(bundle.evidence).length) {
    return 'No direct evidence is attached, so the only defensible conclusion is an information gap.';
  }
  return `Attached evidence is ${statuses.join(', ')}; conviction should still depend on independent current sources, not only model or aggregate support.`;
}

function reportTypeAssessment(bundle = {}) {
  const subject = bundle.subject?.displayName || 'This subject';
  if (bundle.reportType === 'theme_report') {
    return `${subject} needs a structural-vs-cyclical read: separate durable adoption signals from short-lived attention bursts and stale aggregate artifacts.`;
  }
  if (bundle.reportType === 'event_signal_report') {
    return `${subject} needs an event-quality read: separate a newsworthy headline from a decision-relevant signal with independent evidence and measurable transmission.`;
  }
  if (bundle.reportType === 'regime_transmission_report') {
    return `${subject} needs a regime read: identify live macro inputs, likely transmission channels, and the correlations that are not yet causal evidence.`;
  }
  if (bundle.reportType === 'cross_theme_bottleneck_report') {
    return `${subject} needs a bottleneck read: distinguish a real shared dependency from a supplier adjacency or seed-biased graph overlap.`;
  }
  if (bundle.reportType === 'symbol_signal_report') {
    return `${subject} needs an exposure read: determine whether the symbol is a useful proxy for the theme or only a weak statistical linkage.`;
  }
  if (bundle.reportType === 'system_quality_report') {
    return `${subject} needs a trust-gate read: define which outputs are safe, which require repair, and which should be suppressed.`;
  }
  return `${subject} needs an evidence-bound intelligence read rather than a free-form summary.`;
}

function marketTransmissionBlocks(bundle = {}, primary = {}) {
  const reactions = asArray(bundle.marketReactions);
  const refs = refsFor({ claim: primary, bundle });
  if (!reactions.length) {
    return [{
      text: 'Market linkage is not quantified in this bundle. That does not make the subject irrelevant, but it does mean the report should stop at theme or evidence interpretation instead of implying asset transmission.',
      ...refs,
    }];
  }
  return reactions.slice(0, 3).map((reaction) => ({
    text: `${reaction.symbol || 'The linked symbol'} is the clearest measured market link in the bundle. It is marked ${reaction.validationStatus || 'unknown'}; relative return is ${formatMetricValue({ value: reaction.relativeReturnPct })} percent, uplift is ${formatMetricValue({ value: reaction.uplift })}, and t-stat is ${formatMetricValue({ value: reaction.tStat })}. Treat this as an exposure check, not a standalone conclusion.`,
    claimIds: refs.claimIds,
    evidenceIds: refs.evidenceIds,
    metricIds: unique([...asArray(reaction.metricIds), ...refs.metricIds]).slice(0, 6),
    figureIds: refs.figureIds,
    caveatIds: refs.caveatIds,
    reactionId: reaction.reactionId,
  }));
}

function publisherSummary(bundle = {}) {
  const publishers = unique(asArray(bundle.evidence)
    .map((item) => item.publisher)
    .filter((item) => item && !/\d/.test(String(item))));
  if (!publishers.length) return 'The source mix is not cleanly exposed.';
  return `Representative source mix includes ${publishers.slice(0, 4).join(', ')}.`;
}

function buildTimelineBlocks(bundle = {}, primary = {}, ctx = {}) {
  const refs = refsFor({ claim: primary, bundle, evidence: ctx.evidenceRefs, metrics: ctx.metricRefs, figures: ctx.figureRefs, caveats: ctx.caveatRefs });
  const datedEvidence = asArray(bundle.evidence)
    .map((item) => ({
      item,
      date: formatDate(item.publishedAt || item.published_at || item.eventTime || item.ingestedAt || item.ingested_at),
    }))
    .filter((entry) => entry.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (datedEvidence.length) {
    return datedEvidence.slice(0, 4).map(({ item, date }) => {
      const publisher = item.publisher ? ` (${item.publisher})` : '';
      return {
        text: `${date}: ${proseSafeTitle(item.title || item.text || item.evidenceId)}${publisher}. Treat this as the observable sequence behind the thesis, not as proof of durable impact by itself.`,
        ...refsFor({ claim: primary, bundle, evidence: [item], metrics: ctx.metricRefs, figures: ctx.figureRefs, caveats: ctx.caveatRefs }),
      };
    });
  }
  const freshness = asArray(bundle.dataFreshness)
    .map((item) => `${datasetLabel(item.dataset || item.name)} ${item.freshnessStatus || 'unknown'}`)
    .slice(0, 3)
    .join(', ');
  return [{
    text: freshness
      ? `No event-level sequence is attached. The useful timeline is therefore the data freshness state: ${freshness}.`
      : 'No event-level sequence is attached, so the report should not invent a chronology.',
    ...refs,
  }];
}

function caveatBlocks(bundle = {}, primary = {}, limit = 3) {
  return asArray(bundle.caveats).slice(0, limit).map((caveat) => ({
    text: `Risk: ${proseSafeCaveat(caveat.text || caveat.type || 'A report limitation is present')} This is marked ${caveat.severity || 'medium'}, so the main conclusion should keep the limitation visible instead of burying it in the appendix.`,
    claimIds: asArray(caveat.appliesToClaimIds).length ? asArray(caveat.appliesToClaimIds) : refsFor({ claim: primary, bundle }).claimIds,
    evidenceIds: [],
    metricIds: [],
    figureIds: [],
    caveatIds: [caveat.caveatId],
  }));
}

function metricByName(metrics = [], pattern) {
  return asArray(metrics).find((metric) => pattern.test(String(metric.name || metric.metricId || '')));
}

function buildThesis(bundle = {}, primary = {}, ctx = {}) {
  const subject = bundle.subject?.displayName || 'The subject';
  const strongest = first(ctx.metricRefs);
  const caveatText = ctx.weakEvidence
    ? 'Because unresolved caveats remain, the right stance is watch-level rather than publication-grade conviction.'
    : 'The current evidence supports a working view, but not an unconstrained action call.';
  const measurement = strongest ? `The main quantitative anchor: ${metricPhrase(strongest)}.` : 'There is no strong quantitative anchor yet.';
  const typeFrame = reportTypeAssessment(bundle);
  return [{
    text: `${subject}: ${typeFrame} ${measurement} ${caveatText}`,
    confidence: primary.confidenceLevel || (ctx.weakEvidence ? 'low' : 'medium'),
    ...refsFor({ claim: primary, bundle, evidence: ctx.evidenceRefs, metrics: ctx.metricRefs, figures: ctx.figureRefs, caveats: ctx.caveatRefs }),
  }];
}

function buildCatalysts(bundle = {}, primary = {}, ctx = {}) {
  const recentEvidence = metricByName(bundle.metrics, /recent_evidence|article_count|evidence/i);
  const acceleration = metricByName(bundle.metrics, /acceleration|temperature|confidence|exposure|return|validation/i);
  const sourceQuality = metricByName(bundle.metrics, /source|diversity|control|edge/i);
  const catalysts = [];
  if (acceleration) {
    catalysts.push({
      text: `Primary quantitative signal: ${metricPhrase(acceleration)}.`,
      ...refsFor({ claim: primary, bundle, metrics: [acceleration], figures: ctx.figureRefs, caveats: ctx.caveatRefs }),
    });
  }
  if (recentEvidence) {
    catalysts.push({
      text: `Evidence pulse: ${metricPhrase(recentEvidence)}. ${publisherSummary(bundle)}`,
      ...refsFor({ claim: primary, bundle, evidence: ctx.evidenceRefs, metrics: [recentEvidence], caveats: ctx.caveatRefs }),
    });
  }
  if (sourceQuality) {
    catalysts.push({
      text: `Evidence quality check: ${metricPhrase(sourceQuality)}. Weak source breadth keeps this at diligence level.`,
      ...refsFor({ claim: primary, bundle, metrics: [sourceQuality], caveats: ctx.caveatRefs }),
    });
  }
  if (!catalysts.length) {
    catalysts.push({
      text: 'No clear catalyst metric is attached, so the report should prioritize source expansion and metric repair before issuing a stronger analytical view.',
      ...refsFor({ claim: primary, bundle, caveats: ctx.caveatRefs }),
    });
  }
  return catalysts.slice(0, 3);
}

function buildScenarios(bundle = {}, primary = {}, ctx = {}) {
  return [
    {
      label: 'Base case',
      text: 'Keep the subject on watch; require the next evidence refresh to preserve the current direction before escalating conviction.',
      ...refsFor({ claim: primary, bundle, evidence: ctx.evidenceRefs, metrics: ctx.metricRefs, figures: ctx.figureRefs, caveats: ctx.caveatRefs }),
    },
    {
      label: 'Stronger case',
      text: 'Independent evidence broadens, caveats shrink, and market or transmission evidence aligns with the thesis.',
      ...refsFor({ claim: primary, bundle, evidence: ctx.evidenceRefs, metrics: ctx.metricRefs, figures: ctx.figureRefs, caveats: ctx.caveatRefs }),
    },
    {
      label: 'Weaker case',
      text: 'Evidence remains concentrated, data freshness degrades, or aggregate metrics conflict with current evidence.',
      ...refsFor({ claim: primary, bundle, evidence: ctx.evidenceRefs, metrics: ctx.metricRefs, caveats: ctx.caveatRefs }),
    },
  ];
}

function buildRiskBlocks(bundle = {}, primary = {}, ctx = {}) {
  const caveatIds = asArray(bundle.caveats).slice(0, 4).map((caveat) => caveat.caveatId).filter(Boolean);
  const refs = refsFor({
    claim: primary,
    bundle,
    evidence: ctx.evidenceRefs,
    metrics: ctx.metricRefs,
    figures: ctx.figureRefs,
    caveats: caveatIds.map((caveatId) => ({ caveatId })),
  });
  return [
    {
      text: 'Method risk: source concentration, graph-derived links, or broad-market beta can make the signal look stronger than the operating evidence supports.',
      ...refs,
    },
    {
      text: 'Data risk: stale, proxy, or unevenly refreshed evidence can preserve an old narrative after the current economics have changed.',
      ...refs,
    },
  ];
}

function buildConclusion(bundle = {}, primary = {}, ctx = {}) {
  const subject = bundle.subject?.displayName || 'The subject';
  return [{
    text: ctx.weakEvidence
      ? `${subject} is not ready for high-conviction publication. The current conclusion is to watch, repair the caveats, and regenerate after the next evidence refresh.`
      : `${subject} is ready for analyst review as a sourced intelligence memo, with conviction bounded by the attached evidence and watch triggers.`,
    confidence: primary.confidenceLevel || (ctx.weakEvidence ? 'low' : 'medium'),
    ...refsFor({ claim: primary, bundle, evidence: ctx.evidenceRefs, metrics: ctx.metricRefs, figures: ctx.figureRefs, caveats: ctx.caveatRefs }),
  }];
}

function deepMetric(bundle, id) {
  return asArray(bundle.metrics).find((metric) => metric.metricId === id) || null;
}

function buildDataDepthBlocks(bundle = {}) {
  const deep = bundle.metadata?.deepResearch;
  if (!deep) return [];
  const depth = deepMetric(bundle, 'MET-DEEP-DATA-DEPTH');
  const gaps = deepMetric(bundle, 'MET-DEEP-GAPS');
  const kpiCoverage = deepMetric(bundle, 'MET-DEEP-KPI-COVERAGE');
  const institutionalMetric = deepMetric(bundle, 'MET-DEEP-INSTITUTIONAL-EVIDENCE-DENSITY');
  const available = Object.entries(deep.packs || {})
    .filter(([, pack]) => pack.status === 'available')
    .map(([name]) => name);
  const missing = asArray(deep.gaps).map((gap) => gap.packName);
  const registry = deep.kpiRegistry || {};
  const kpiGapNames = asArray(registry.gaps)
    .map((gap) => gap.displayName || gap.kpiKey)
    .filter(Boolean);
  const kpiSentence = registry.mappedCount
    ? ` The generic KPI spine maps ${registry.mappedCount} indicators, has ${registry.observationCount || 0} observations, fresh coverage metric is ${Number(registry.coverage || 0)}, and queues ${registry.missingCount || 0} missing KPI collection jobs${kpiGapNames.length ? `: ${kpiGapNames.slice(0, 4).join(', ')}.` : '.'}`
    : '';
  const collectionPlan = asArray(deep.collectionPlan);
  const collectionSentence = collectionPlan.length
    ? ` The report also queued ${collectionPlan.length} investment-depth collection tasks, led by ${collectionPlan.slice(0, 3).map((task) => proseSafeMemoText(task.packName || task.collectionKind)).join(', ')}.`
    : '';
  const missingSentence = missing.length
    ? `Pack-level missing areas: ${missing.slice(0, 5).map(packLabel).join(', ')}.`
    : 'Pack-level missing areas: none.';
  const readiness = deep.investmentReadiness;
  const readinessSentence = readiness
    ? ` Scope is ${proseSafeMemoText(readiness.tier || 'unknown')}: ${proseSafeMemoText(readiness.interpretation || '')}`
    : '';
  const institutionalPack = deep.packs?.institutionalEvidencePack || null;
  const weakInstitutionalDimensions = asArray(institutionalPack?.blockingDimensions)
    .map((item) => item.label)
    .filter(Boolean)
    .slice(0, 5);
  const institutionalSentence = institutionalPack
    ? ` Institutional evidence density is ${proseSafeMemoText(institutionalPack.tier || 'unknown')} at ${Number(institutionalPack.coverageScore || 0).toFixed(2)}; the weakest table lanes are ${weakInstitutionalDimensions.length ? weakInstitutionalDimensions.join(', ') : 'not material'}.`
    : '';
  return [{
    text: available.length
      ? `Research depth is strongest in ${available.slice(0, 4).map(packLabel).join(', ')}. ${missingSentence} KPI-level gaps are handled separately so stale or absent indicators still cap conviction until repaired.${institutionalSentence}${readinessSentence}${collectionSentence}${kpiSentence}`
      : `No deep research packs are sufficiently supported yet. The right product behavior is source expansion first, not a polished but unsupported conclusion.${institutionalSentence}${readinessSentence}${collectionSentence}${kpiSentence}`,
    ...refsForDeep(bundle, {
      metrics: [depth, gaps, kpiCoverage, institutionalMetric].filter(Boolean),
      caveats: asArray(bundle.caveats).filter((item) => /data_gap|historical|causal|institutional/i.test(`${item.type} ${item.text}`)).slice(0, 4),
      figures: asArray(bundle.figures).filter((figure) => figure.figureId === 'FIG-DEEP-DATA-DEPTH'),
    }),
  }];
}

function buildCausalChainBlocks(bundle = {}) {
  const deep = bundle.metadata?.deepResearch;
  if (!deep) return [];
  const causalMetric = deepMetric(bundle, 'MET-DEEP-CAUSAL-EDGES');
  const edges = asArray(deep.packs?.causalPack?.edges);
  const refs = refsForDeep(bundle, {
    metrics: [causalMetric].filter(Boolean),
    caveats: asArray(bundle.caveats).filter((item) => /causal|data_gap/i.test(`${item.type} ${item.text}`)).slice(0, 3),
    figures: asArray(bundle.figures).filter((figure) => figure.figureId === 'FIG-DEEP-CAUSAL-CHAIN'),
  });
  if (!edges.length) {
    return [{
      text: 'No causal chain is sufficiently supported yet. Keep the report at signal detection and open a causal backfill task before claiming transmission.',
      ...refs,
    }];
  }
  return edges.slice(0, 3).map((edge) => ({
    text: `${proseSafeMemoText(edge.sourceNode || 'source')} may transmit to ${proseSafeMemoText(edge.targetNode || 'target')} through this mechanism: ${proseSafeMemoText(edge.mechanism || 'mechanism not specified')}. Treat it as ${humanizeIdentifier(edge.edgeType || 'unknown') || 'an unclassified link'}, so correlation, graph adjacency, and causal hypothesis remain separated.`,
    ...refs,
  }));
}

function buildHistoricalBlocks(bundle = {}) {
  const deep = bundle.metadata?.deepResearch;
  if (!deep) return [];
  const analogMetric = deepMetric(bundle, 'MET-DEEP-HISTORICAL-ANALOGS');
  const analogues = asArray(deep.packs?.historicalAnalogPack?.analogues);
  const namedAnalogues = analogues.filter((analogue) => {
    const name = String(analogue.analogName || analogue.name || '').trim();
    if (!name) return false;
    return !/^(hawkes[-_ ]profile analogue|historical analogue|analogue)\s*\d*$/i.test(name);
  });
  const refs = refsForDeep(bundle, {
    metrics: [analogMetric].filter(Boolean),
    caveats: asArray(bundle.caveats).filter((item) => /historical|analog/i.test(`${item.type} ${item.text}`)),
    figures: asArray(bundle.figures).filter((figure) => figure.figureId === 'FIG-DEEP-HISTORICAL-ANALOGS'),
  });
  if (!namedAnalogues.length) {
    return [{
      text: analogues.length
        ? 'The bundle contains statistical profile matches, but no named historical analogue with regime context, market outcome, and clear differences. Keep this as insufficient historical memory rather than presenting placeholder analogue names.'
        : 'No reliable historical analogue is attached. The memo should say there is no clean precedent rather than forcing a past-cycle comparison without regime, market-outcome, and source-pattern evidence.',
      ...refs,
    }];
  }
  return namedAnalogues.slice(0, 3).map((analogue) => ({
    text: `${proseSafeMemoText(analogue.analogName || 'Historical analogue')} is the closest historical memory candidate in the attached pack. Similarity drivers: ${asArray(analogue.similarityDrivers).slice(0, 3).map(proseSafeMemoText).join(', ') || 'not specified'}. Key difference: ${proseSafeMemoText(asArray(analogue.differences)[0] || analogue.whatBrokeTheAnalogy || 'not specified')}.`,
    ...refs,
  }));
}

function buildFeedbackLearningBlocks(bundle = {}) {
  const deep = bundle.metadata?.deepResearch;
  if (!deep) return [];
  const feedbackMetric = deepMetric(bundle, 'MET-DEEP-FEEDBACK');
  const rows = asArray(deep.packs?.feedbackPack?.rows);
  return [{
    text: rows.length
      ? 'Prior report feedback is attached and should weight claim phrasing, suppress rejected patterns, and preserve useful analyst sections.'
      : 'No prior report feedback is attached yet. Future accept/reject/useful/incorrect actions should feed the next generation pass.',
    ...refsForDeep(bundle, { metrics: [feedbackMetric].filter(Boolean) }),
  }];
}

export function buildEvidenceBoundAnalystPrompt(bundle = {}) {
  return [
    'You are an evidence-bound analyst.',
    'Use only facts, metrics, entities, tickers, dates, figures, and caveats in the supplied bundle.',
    'Do not add external facts.',
    'Do not upgrade validation status.',
    'Do not turn a candidate into a canonical conclusion.',
    'Do not hide stale data.',
    'Do not produce investment advice.',
    'Every factual sentence must reference claimIds, evidenceIds, metricIds, figureIds, or caveatIds.',
    'If evidence is weak, explicitly say it is weak.',
    'If data is stale, explicitly say it is stale.',
    'Prefer supports, suggests, is consistent with, candidate, and watch-level unless validationStatus is validated.',
    '',
    `Report type: ${bundle.reportType}`,
    `Subject: ${bundle.subject?.displayName || bundle.subject?.subjectId || 'unknown'}`,
  ].join('\n');
}

export function generateDeterministicAnalystDraft(bundle = {}) {
  const primary = first(bundle.claims) || {};
  const caveats = asArray(bundle.caveats);
  const deepGapCount = asArray(bundle.metadata?.deepResearch?.gaps).length;
  const freshEvidenceCount = asArray(bundle.evidence).filter((item) => !/stale|degraded/i.test(String(item.freshnessStatus || ''))).length;
  const weakEvidence = deepGapCount > 0 || caveats.some((item) => {
    const text = `${item.type} ${item.text}`;
    if (/stale|freshness|degraded/i.test(text) && freshEvidenceCount >= 3) return false;
    if (/baseline/i.test(text) && freshEvidenceCount >= 3) return false;
    return /source|pending|needs|seed|gap|no reliable|not attached|data_gap|aggregate_evidence_mismatch|evidence_aggregate_mismatch|report_scope|signal[-_ ]triage/i.test(text);
  });
  const refs = claimRefs(primary, bundle);
  const sourceQueryCaveats = caveats.filter((item) => (
    !String(item.caveatId || '').startsWith('CAV-DEEP-')
    && /source|pending|needs|evidence|seed/i.test(`${item.type} ${item.text}`)
  ));
  const deepSourceQueries = asArray(bundle.metadata?.deepResearch?.gaps).slice(0, 5).map((gap) => ({
    text: `Backfill ${packLabel(gap.packName)}: ${proseSafeMemoText(gap.query)}`,
    reason: gap.reason,
    claimIds: ['CLM-DEEP-RESEARCH'],
    evidenceIds: [],
    metricIds: ['MET-DEEP-GAPS'],
    figureIds: ['FIG-DEEP-DATA-DEPTH'],
    caveatIds: [`CAV-DEEP-GAP-${String(gap.packName || '').toUpperCase().replace(/[^A-Z0-9]/g, '-')}`],
    approvalRequired: true,
  }));
  const kpiSourceQueries = asArray(bundle.metadata?.deepResearch?.kpiRegistry?.gaps).slice(0, 5).map((gap) => ({
    text: `Collect KPI ${proseSafeMemoText(gap.displayName || gap.kpiKey)}: ${proseSafeMemoText(gap.query)}`,
    reason: gap.reason,
    claimIds: ['CLM-DEEP-RESEARCH'],
    evidenceIds: [],
    metricIds: ['MET-DEEP-KPI-COVERAGE'],
    figureIds: ['FIG-DEEP-DATA-DEPTH'],
    caveatIds: asArray(bundle.caveats).some((item) => item.caveatId === 'CAV-DEEP-KPI-COVERAGE') ? ['CAV-DEEP-KPI-COVERAGE'] : [],
    approvalRequired: true,
    metadata: {
      gapKind: 'theme_kpi',
      themeId: gap.themeId,
      themeLabel: gap.themeLabel,
      kpiKey: gap.kpiKey,
      displayName: gap.displayName,
      dataPack: gap.dataPack,
      severity: gap.severity,
      query: gap.query,
      boundary: 'structured KPI collection draft; canonical observation requires reviewed evidence',
    },
  }));
  const collectionSourceQueries = asArray(bundle.metadata?.deepResearch?.collectionPlan).slice(0, 8).map((task) => ({
    text: `Collect ${proseSafeMemoText(packLabel(task.packName) || task.packName)}: ${proseSafeMemoText(task.query)}`,
    reason: task.reason,
    claimIds: ['CLM-DEEP-RESEARCH'],
    evidenceIds: [],
    metricIds: ['MET-DEEP-COLLECTION-TASKS', 'MET-DEEP-INVESTMENT-READINESS'].filter(Boolean),
    figureIds: ['FIG-DEEP-DATA-DEPTH'],
    caveatIds: asArray(bundle.caveats).some((item) => item.caveatId === 'CAV-DEEP-SIGNAL-TRIAGE-SCOPE') ? ['CAV-DEEP-SIGNAL-TRIAGE-SCOPE'] : [],
    approvalRequired: true,
    metadata: {
      gapKind: 'investment_depth_collection',
      packName: task.packName,
      collectionKind: task.collectionKind,
      query: task.query,
      target: task.target,
      desiredEvidenceClass: task.metadata?.desiredEvidenceClass || task.metadata?.evidenceClass || task.target?.evidenceClass || null,
      evidenceClass: task.metadata?.evidenceClass || task.metadata?.desiredEvidenceClass || task.target?.evidenceClass || null,
      providerRoute: task.metadata?.providerRoute || task.target?.providerRoute || null,
      acceptanceCriteria: task.metadata?.acceptanceCriteria || null,
      promotionEligible: task.metadata?.promotionEligible ?? null,
      negativeControlIntent: task.metadata?.negativeControlIntent ?? null,
      evidenceContract: task.metadata?.evidenceContract || null,
      boundary: 'queued to report_backfill_tasks and review-gated source-query flow; canonical report data changes only after accepted evidence',
    },
  }));
  const keyJudgmentText = primary.canonicalText || `${bundle.subject?.displayName || 'The subject'} has a reportable signal, but the evidence bundle is incomplete.`;
  const metricRefs = orderedMetrics(bundle.metrics).slice(0, 4);
  const evidenceRefs = asArray(bundle.evidence).slice(0, 4);
  const figureRefs = asArray(bundle.figures).slice(0, 3);
  const caveatRefs = asArray(bundle.caveats).slice(0, 4);
  const ctx = { metricRefs, evidenceRefs, figureRefs, caveatRefs, weakEvidence };
  const primaryRefs = refsFor({ claim: primary, bundle });
  const strongestMetric = first(metricRefs);
  const keyJudgments = [
    {
      text: keyJudgmentText,
      confidence: primary.confidenceLevel || (weakEvidence ? 'low' : 'medium'),
      ...primaryRefs,
    },
    strongestMetric ? {
      text: `The primary measurement read is that ${metricPhrase(strongestMetric)}, which makes this report a measured signal rather than a narrative-only summary.`,
      confidence: primary.confidenceLevel || (weakEvidence ? 'low' : 'medium'),
      ...refsFor({ claim: primary, bundle, metrics: [strongestMetric], figures: figureRefs.slice(0, 1) }),
    } : {
      text: 'The report does not include enough metric facts to quantify the signal, so the useful output is gap identification and source expansion.',
      confidence: 'low',
      ...primaryRefs,
    },
    {
      text: weakEvidence
        ? 'Decision use should stay watch-level until the attached caveats are repaired and the evidence chain is independently strengthened.'
        : 'Decision use is supported only by the attached evidence, metrics, figures, and caveats; unsupported facts should not be added downstream.',
      confidence: weakEvidence ? 'low' : 'medium',
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, metrics: metricRefs, figures: figureRefs, caveats: caveatRefs }),
    },
  ];
  const whatChanged = metricRefs.length
    ? metricRefs.map((metric) => ({
      text: `${metricPhrase(metric)}.`,
      ...refsFor({ claim: primary, bundle, metrics: [metric], figures: figureRefs }),
    }))
    : [{
      text: 'No metric facts are attached, so the report should state that change cannot be measured from this bundle.',
      ...primaryRefs,
    }];
  const evidenceSynthesis = [
    {
      text: evidenceSummary(bundle),
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, caveats: caveatRefs }),
    },
    {
      text: freshnessSummary(bundle),
      ...refsFor({ claim: primary, bundle, caveats: caveatRefs }),
    },
    {
      text: bundle.sourceSummary?.lowDiversityFlag || bundle.sourceSummary?.low_diversity_flag
        ? 'Source concentration is a limiting condition, so the report should not treat volume as independent confirmation.'
        : 'Source concentration is not flagged as a blocker, but the source list still remains the basis for conviction.',
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, caveats: caveatRefs }),
    },
    {
      text: 'The key tension is whether observed evidence, calculated metrics, and market response point in the same direction. If they diverge, the weakest leg should cap conviction.',
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, metrics: metricRefs, figures: figureRefs, caveats: caveatRefs }),
    },
  ];
  const timeline = buildTimelineBlocks(bundle, primary, ctx);
  const analyticalAssessment = [
    {
      text: reportTypeAssessment(bundle),
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, metrics: metricRefs, figures: figureRefs, caveats: caveatRefs }),
    },
    {
      text: 'The useful read is the gap between the headline signal and the evidence quality: conviction should rise only when independent sources, current metrics, and market transmission point in the same direction.',
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, metrics: metricRefs, figures: figureRefs }),
    },
    {
      text: 'The next analytical question is whether the measured signal maps to a company, sector, regime, or operational decision, and which missing evidence would flip the conclusion.',
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, metrics: metricRefs, figures: figureRefs, caveats: caveatRefs }),
    },
  ];
  const decisionUse = [
    {
      text: weakEvidence
        ? 'Use this as a triage brief: repair caveats through source queries or validation, then re-run the report.'
        : 'Use this as a review brief: compare the figures, evidence, and caveats before escalating conviction.',
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, metrics: metricRefs, figures: figureRefs, caveats: caveatRefs }),
    },
    {
      text: 'Do not use the report as a standalone action memo. Use it to decide which evidence chain deserves deeper review, which metric needs refresh, and which watch trigger matters next.',
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, metrics: metricRefs, figures: figureRefs, caveats: caveatRefs }),
    },
  ];
  const dataDepth = buildDataDepthBlocks(bundle);
  const causalChain = buildCausalChainBlocks(bundle);
  const historicalAnalogues = buildHistoricalBlocks(bundle);
  const feedbackLearning = buildFeedbackLearningBlocks(bundle);
  /* Phase 3: type-specific prose overlays. The typed builder reads the
   * Phase 2 themeContext / event details / sensitivity row / candidate row
   * and produces subject-specific sentences. Sections returned as null
   * fall back to the generic templates below. */
  const typed = buildTypedAnalystSections(bundle);
  const preferTypedDiscoveryMemo = bundle.reportType === 'cross_theme_bottleneck_report';
  const signalCards = buildSignalCards(bundle);
  const analystSynthesis = buildAnalystSynthesis(bundle, signalCards);
  const narrativePlan = buildNarrativePlan(bundle, signalCards, analystSynthesis);
  const pickTyped = (typedSection, fallback) =>
    (typed && typedSection !== undefined && typedSection !== null && (!Array.isArray(typedSection) || typedSection.length > 0))
      ? typedSection
      : fallback;
  const ensureMinBlocks = (items, fallback, minimum = 1) => {
    const merged = [...asArray(items)];
    for (const block of asArray(fallback)) {
      if (merged.length >= minimum) break;
      const text = String(block.text || block.label || '').trim();
      if (!merged.some((existing) => String(existing.text || existing.label || '').trim() === text)) {
        merged.push(block);
      }
    }
    return merged;
  };
  const watchFallback = asArray(bundle.watchIndicators).map((watch) => ({
    text: proseSafeMemoText(watch.label),
    claimIds: asArray(watch.claimIds),
    evidenceIds: [],
    metricIds: [],
    figureIds: [],
    caveatIds: [],
    watchId: watch.watchId,
  }));
  const caveatGapPattern = /pending|needs|source|stale|gap|proxy|transcript|triage|scope|blocker|warning|investment|readiness|causal|hypothesis|baseline|sample|diversity|quality/i;
  const caveatGapBlocks = caveats
    .filter((caveat) => caveatGapPattern.test(`${caveat.type} ${caveat.text}`))
    .map((caveat) => ({
      text: `${sentenceStem(caveat.text || `Resolve the ${caveat.type || 'information'} gap`)}. Treat this as a backfill requirement before raising conviction beyond the attached evidence.`,
      claimIds: asArray(caveat.appliesToClaimIds).length ? asArray(caveat.appliesToClaimIds) : refs.claimIds,
      caveatIds: [caveat.caveatId],
    }));
  const readinessCaveatId = asArray(bundle.caveats).some((item) => item.caveatId === 'CAV-DEEP-SIGNAL-TRIAGE-SCOPE')
    ? 'CAV-DEEP-SIGNAL-TRIAGE-SCOPE'
    : null;
  const readinessGapBlocks = asArray(bundle.metadata?.deepResearch?.investmentReadiness?.blockers).slice(0, 4).map((blocker) => ({
    text: `${sentenceStem(blocker)}. Keep this in signal-triage scope until the blocker is repaired by source collection or validation.`,
    claimIds: refs.claimIds,
    caveatIds: readinessCaveatId ? [readinessCaveatId] : [],
  }));
  const readinessTier = bundle.metadata?.deepResearch?.investmentReadiness?.tier || '';
  const hasReadinessBlockers = asArray(bundle.metadata?.deepResearch?.investmentReadiness?.blockers).length > 0;
  const defaultWarningGap = weakEvidence && (hasReadinessBlockers || readinessTier === 'signal_triage')
    ? [{
      text: 'Validation is warning-level because the evidence stack is incomplete. Keep the memo at research-prioritization scope until missing evidence is collected and the report is regenerated.',
      claimIds: refs.claimIds,
      caveatIds: caveatRefs.map((item) => item.caveatId).filter(Boolean).slice(0, 3),
    }]
    : [];
  const noGapBlock = [{
    text: 'No blocker-level information gap is attached. Continue to treat the memo as evidence-bound: raise conviction only after fresh sources, current metrics, and market checks continue to agree.',
    claimIds: refs.claimIds,
    evidenceIds: evidenceRefs.map((item) => item.evidenceId).filter(Boolean).slice(0, 3),
    metricIds: metricRefs.map((item) => item.metricId).filter(Boolean).slice(0, 3),
  }];
  const informationGapFallback = ensureMinBlocks(
    caveatGapBlocks,
    [...readinessGapBlocks, ...defaultWarningGap, ...noGapBlock],
    Math.max(1, Math.min(3, caveatGapBlocks.length + readinessGapBlocks.length + defaultWarningGap.length + noGapBlock.length)),
  );
  const analysis = {
    generatedAt: new Date().toISOString(),
    provider: 'deterministic',
    model: typed ? 'rule-based-typed-analyst' : 'rule-based-evidence-bound-analyst',
    promptPolicy: 'evidence-bound',
    signalCards: signalCards.cards,
    evidenceStrength: signalCards.evidenceStrength,
    metricCalibration: signalCards.metricCalibration,
    analystSynthesis,
    universalEvidenceContract: bundle.metadata?.deepResearch?.universalEvidenceContract || null,
    evidenceClassMatrix: bundle.metadata?.deepResearch?.evidenceClassMatrix || [],
    actionBridge: bundle.metadata?.deepResearch?.actionBridge || null,
    narrativePlan,
    narrativeStructure: narrativePlan.narrativeStructure,
    longFormSections: narrativePlan.longFormSections,
    keyJudgments: ensureMinBlocks(
      preferTypedDiscoveryMemo ? pickTyped(typed?.keyJudgments, narrativePlan.sections.executiveJudgment) : narrativePlan.sections.executiveJudgment,
      analystSynthesis.executiveView,
      3,
    ),
    thesis: ensureMinBlocks(
      preferTypedDiscoveryMemo ? pickTyped(typed?.thesis, [{ text: narrativePlan.openingFrame, ...narrativePlan.refs }]) : [{ text: narrativePlan.openingFrame, ...narrativePlan.refs }],
      analystSynthesis.thesis,
      1,
    ),
    context: narrativePlan.sections.context,
    whatChanged: ensureMinBlocks(analystSynthesis.whatChanged, pickTyped(typed?.whatChanged, whatChanged), 2),
    catalysts: pickTyped(typed?.catalysts, buildCatalysts(bundle, primary, ctx)),
    dataDepth: ensureMinBlocks(
      preferTypedDiscoveryMemo ? pickTyped(typed?.dataDepth, narrativePlan.sections.evidenceAssessment) : narrativePlan.sections.evidenceAssessment,
      analystSynthesis.weakestEvidence,
      2,
    ),
    causalChain: ensureMinBlocks(
      preferTypedDiscoveryMemo ? pickTyped(typed?.causalChain, narrativePlan.sections.economicMechanism) : narrativePlan.sections.economicMechanism,
      analystSynthesis.economicMechanism,
      2,
    ),
    historicalAnalogues: ensureMinBlocks(
      pickTyped(typed?.historicalAnalogues, historicalAnalogues),
      [{
        text: 'No reliable named historical analogue is attached. Treat this as insufficient historical memory rather than forcing a past-cycle comparison without regime, market-outcome, and difference evidence.',
        ...primaryRefs,
      }],
      1,
    ),
    evidenceSynthesis: ensureMinBlocks(
      preferTypedDiscoveryMemo ? pickTyped(typed?.evidenceSynthesis, narrativePlan.sections.evidenceAssessment) : narrativePlan.sections.evidenceAssessment,
      analystSynthesis.strongestEvidence,
      2,
    ),
    timeline: pickTyped(typed?.timeline, timeline),
    marketTransmission: ensureMinBlocks(narrativePlan.sections.marketImplication, analystSynthesis.marketImplication, 2),
    scenarios: narrativePlan.sections.scenarios,
    risks: ensureMinBlocks(pickTyped(typed?.risks, buildRiskBlocks(bundle, primary, ctx)), [], 2),
    analyticalAssessment: ensureMinBlocks(analystSynthesis.thesis, pickTyped(typed?.analyticalAssessment, analyticalAssessment), 2),
    decisionUse: ensureMinBlocks(narrativePlan.sections.whatWouldChangeMind, analystSynthesis.invalidators, 2),
    whatWouldChangeMind: narrativePlan.sections.whatWouldChangeMind,
    researchAgenda: narrativePlan.sections.researchAgenda,
    analystConclusion: narrativePlan.sections.conclusion,
    alternativeExplanations: ensureMinBlocks(analystSynthesis.counterThesis, pickTyped(typed?.alternativeExplanations, []), 1),
    informationGaps: pickTyped(typed?.informationGaps, informationGapFallback),
    watchNext: ensureMinBlocks(
      narrativePlan.sections.watchNext,
      watchFallback,
      2,
    ),
    sourceQueries: pickTyped(typed?.sourceQueries, [
      ...analystSynthesis.nextResearchActions.map((action, index) => ({
        text: action.text,
        reason: 'Analyst synthesis identified this as the next evidence collection action.',
        queryId: `SQD-SYNTH-${String(index + 1).padStart(2, '0')}`,
        claimIds: action.claimIds || refs.claimIds,
        evidenceIds: action.evidenceIds || [],
        metricIds: action.metricIds || [],
        figureIds: action.figureIds || [],
        caveatIds: action.caveatIds || [],
        approvalRequired: true,
        metadata: { gapKind: 'analyst_synthesis_collection' },
      })),
      ...collectionSourceQueries,
      ...deepSourceQueries,
      ...kpiSourceQueries,
      ...sourceQueryCaveats.slice(0, 3).map((caveat) => ({
        text: `Draft an evidence-expansion query for the ${humanizeIdentifier(caveat.type || 'open')} caveat before raising conviction.`,
        claimIds: asArray(caveat.appliesToClaimIds).length ? asArray(caveat.appliesToClaimIds) : refs.claimIds,
        evidenceIds: [],
        metricIds: [],
        figureIds: [],
        caveatIds: [caveat.caveatId],
        approvalRequired: true,
      })),
    ]),
    feedbackLearning: pickTyped(typed?.feedbackLearning, feedbackLearning),
    analystNotes: pickTyped(typed?.analystNotes, [{
      text: weakEvidence
        ? 'Treat this as a watch-level intelligence brief until evidence gaps are repaired.'
        : 'The memo is evidence-bound and can be reviewed against the attached claims and sources.',
      ...primaryRefs,
    }]),
  };
  return applyNarrativeEditorPass(analysis);
}

export async function generateReportAnalystDraft(bundle = {}, options = {}) {
  /* Always start with the deterministic / typed draft. It's the floor. */
  let draft = generateDeterministicAnalystDraft(bundle);
  if (options.provider === 'codex' || options.provider === 'llm') {
    draft = await enhanceAnalysisWithAdaptiveNarrativeStructure(draft, bundle, options);
  }
  if (options.provider !== 'codex') return draft;

  /* Phase 4: Codex narrative on top of typed sections. The narrative is
   * additive — typed sections still render. If Codex fails or output fails
   * validation, keep typed-only. */
  const typed = buildTypedAnalystSections(bundle);
  let narrativeAttempt;
  try {
    narrativeAttempt = await generateCodexNarrative(bundle, typed, { timeoutMs: options.codexTimeoutMs || 90_000 });
  } catch (e) {
    return { ...draft, codexAttempted: true, codexError: String(e?.message || e) };
  }
  if (!narrativeAttempt.ok || !narrativeAttempt.parsed) {
    return { ...draft, codexAttempted: true, codexError: narrativeAttempt.error || 'unknown', codexMessage: narrativeAttempt.message };
  }
  /* Validate against bundle's allow-lists. We re-import the validator's
   * helpers via a small inline shim — the validator module is the source
   * of truth, but importing it here would cause a cycle. */
  const { knownNumericStrings, allowedTickerStrings } = await import('./report-validator-helpers.mjs').catch(async () => {
    /* Inline fallback if helpers module not present — replicate minimal
     * logic. Real implementation will live in report-validator-helpers.mjs
     * exported for both narrator and validator. */
    const v = await import('./report-validator.mjs');
    return { knownNumericStrings: v.knownNumericStrings || (() => new Set()), allowedTickerStrings: v.allowedTickerStrings || (() => new Set()) };
  });
  const knownNumbers = knownNumericStrings(bundle);
  const allowedTickers = allowedTickerStrings(bundle);
  const validated = validateCodexNarrative(narrativeAttempt.parsed, bundle, knownNumbers, allowedTickers);
  const blocks = narrativeToAnalystBlocks(validated.sections, bundle);
  if (!blocks) {
    return { ...draft, codexAttempted: true, codexValidatedSections: validated.sections, codexDropped: validated.dropped, codexAttachFailed: 'no validated sections' };
  }
  return {
    ...draft,
    provider: 'codex+typed',
    model: 'codex+rule-based-typed-analyst',
    codexAttempted: true,
    codexNarrativeHead: blocks.narrativeHead,
    codexBullThesis: blocks.bullThesis,
    codexBearThesis: blocks.bearThesis,
    codexInvalidator: blocks.invalidator,
    codexDropped: validated.dropped,
    codexRaw: narrativeAttempt.raw,
  };
}
