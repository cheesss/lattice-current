import { REPORT_TYPES } from './report-evidence-bundle.mjs';

export const REPORT_CHART_TYPES = Object.freeze([
  'line_column',
  'indexed_return',
  'timeline',
  'lollipop',
  'network',
  'freshness_heatmap',
  'status_board',
  'causal_map',
  'historical_analog_table',
  'peer_basket',
  'scenario_table',
  'watch_table',
]);

function firstClaimId(bundle) {
  return bundle?.claims?.[0]?.claimId || 'CLM-001';
}

function hasFigure(bundle, figureId) {
  return (bundle.figures || []).some((figure) => figure.figureId === figureId);
}

function makeFigure(bundle, spec) {
  return {
    figureId: spec.figureId,
    title: spec.title,
    chartType: spec.chartType,
    visualVocabularyCategory: spec.visualVocabularyCategory,
    analyticQuestion: spec.analyticQuestion,
    dataRefIds: spec.dataRefIds || [],
    supportedClaimIds: spec.supportedClaimIds || [firstClaimId(bundle)],
    caveatIds: spec.caveatIds || [],
    dataAsOf: spec.dataAsOf || bundle.asOf,
    renderAssetId: null,
    metadata: {
      planned: true,
      takeaway: spec.takeaway || spec.metadata?.takeaway || null,
      ...(spec.metadata || {}),
    },
  };
}

function hasCaveat(bundle = {}, pattern) {
  return (bundle.caveats || []).some((item) => pattern.test(`${item.type} ${item.text}`));
}

function attachFiguresToClaims(bundle) {
  const figures = bundle.figures || [];
  return {
    ...bundle,
    claims: (bundle.claims || []).map((claim) => {
      const linkedFigureIds = figures
        .filter((figure) => (figure.supportedClaimIds || []).includes(claim.claimId))
        .map((figure) => figure.figureId);
      return {
        ...claim,
        supportingFigureIds: [
          ...new Set([
            ...(claim.supportingFigureIds || []),
            ...linkedFigureIds,
          ]),
        ],
      };
    }),
  };
}

export function planReportFigures(bundle = {}) {
  const planned = [];
  const metricIds = (bundle.metrics || []).map((metric) => metric.metricId);
  const marketIds = (bundle.marketReactions || []).map((reaction) => reaction.reactionId);
  const deep = bundle.metadata?.deepResearch;
  if (bundle.reportType === REPORT_TYPES.THEME) {
    planned.push(makeFigure(bundle, {
      figureId: 'FIG-THEME-TREND',
      title: 'Theme trend metrics',
      chartType: 'line_column',
      visualVocabularyCategory: 'change_over_time',
      analyticQuestion: 'Did theme coverage and acceleration move in the selected period?',
      takeaway: hasCaveat(bundle, /baseline|low_attention|sample|stale/i)
        ? 'Trend movement is visible, but sparse or distorted baselines prevent a lifecycle call by themselves.'
        : 'Trend movement provides the attention layer; it still needs operating evidence before it becomes a thesis call.',
      dataRefIds: metricIds,
      caveatIds: (bundle.caveats || []).filter((item) => ['baseline_distortion', 'stale_data'].includes(item.type)).map((item) => item.caveatId),
    }));
    planned.push(makeFigure(bundle, {
      figureId: 'FIG-THEME-SOURCES',
      title: 'Source diversity',
      chartType: 'lollipop',
      visualVocabularyCategory: 'ranking',
      analyticQuestion: 'Is the theme supported by diverse sources or concentrated coverage?',
      takeaway: hasCaveat(bundle, /source_diversity|concentration/i)
        ? 'Source concentration caps conviction until independent coverage broadens.'
        : 'Source breadth is sufficient to support review, but not enough to establish a canonical event; the thesis still depends on operating support.',
      dataRefIds: metricIds.filter((id) => /SOURCE|DIVERSITY/i.test(id)),
      caveatIds: (bundle.caveats || []).filter((item) => item.type === 'source_diversity').map((item) => item.caveatId),
    }));
  } else if (bundle.reportType === REPORT_TYPES.CROSS_THEME) {
    planned.push(makeFigure(bundle, {
      figureId: 'FIG-XTC-GRAPH',
      title: 'Theme-component-supplier pathway',
      chartType: 'network',
      visualVocabularyCategory: 'relationship',
      analyticQuestion: 'Which connector links the selected themes and candidate supplier path?',
      dataRefIds: metricIds,
      caveatIds: (bundle.caveats || []).map((item) => item.caveatId),
    }));
    planned.push(makeFigure(bundle, {
      figureId: 'FIG-XTC-EVIDENCE',
      title: 'Evidence readiness',
      chartType: 'lollipop',
      visualVocabularyCategory: 'ranking',
      analyticQuestion: 'Does the candidate have enough evidence and source diversity for promotion?',
      dataRefIds: metricIds,
      caveatIds: (bundle.caveats || []).map((item) => item.caveatId),
    }));
  } else if (bundle.reportType === REPORT_TYPES.EVENT_SIGNAL) {
    planned.push(makeFigure(bundle, {
      figureId: 'FIG-EVENT-TIMELINE',
      title: 'Event and evidence timeline',
      chartType: 'timeline',
      visualVocabularyCategory: 'change_over_time',
      analyticQuestion: 'When did the event evidence and market reaction appear?',
      dataRefIds: [...metricIds, ...marketIds],
    }));
    planned.push(makeFigure(bundle, {
      figureId: 'FIG-EVENT-MARKET',
      title: 'Validated market reaction',
      chartType: 'lollipop',
      visualVocabularyCategory: 'ranking',
      analyticQuestion: 'Which related symbols had the strongest validated reaction?',
      dataRefIds: marketIds,
    }));
  } else if (bundle.reportType === REPORT_TYPES.REGIME) {
    planned.push(makeFigure(bundle, {
      figureId: 'FIG-REGIME-MACRO',
      title: 'Macro regime inputs',
      chartType: 'line_column',
      visualVocabularyCategory: 'change_over_time',
      analyticQuestion: 'Which macro inputs are driving the current regime state?',
      dataRefIds: metricIds,
    }));
    planned.push(makeFigure(bundle, {
      figureId: 'FIG-REGIME-TRANSMISSION',
      title: 'Transmission edge readiness',
      chartType: 'network',
      visualVocabularyCategory: 'relationship',
      analyticQuestion: 'Which transmission links should stay correlation-only versus validated?',
      dataRefIds: metricIds.filter((id) => /TRANSMISSION|CONFIDENCE/i.test(id)),
      caveatIds: (bundle.caveats || []).filter((item) => item.type === 'causality_boundary').map((item) => item.caveatId),
    }));
  } else if (bundle.reportType === REPORT_TYPES.SYMBOL) {
    planned.push(makeFigure(bundle, {
      figureId: 'FIG-SYMBOL-EXPOSURE',
      title: 'Theme exposure and validation',
      chartType: 'lollipop',
      visualVocabularyCategory: 'ranking',
      analyticQuestion: 'Is the symbol exposure supported by validation rather than a standalone ticker mention?',
      dataRefIds: metricIds,
      caveatIds: (bundle.caveats || []).filter((item) => ['weak_controls', 'pending_validation'].includes(item.type)).map((item) => item.caveatId),
    }));
    planned.push(makeFigure(bundle, {
      figureId: 'FIG-SYMBOL-REACTION',
      title: 'Relative market reaction',
      chartType: 'indexed_return',
      visualVocabularyCategory: 'change_over_time',
      analyticQuestion: 'How did the symbol move relative to its benchmark in the event window?',
      dataRefIds: [...metricIds.filter((id) => /RETURN|VALIDATION/i.test(id)), ...marketIds],
      caveatIds: (bundle.caveats || []).map((item) => item.caveatId),
    }));
  } else if (bundle.reportType === REPORT_TYPES.SYSTEM_QUALITY) {
    planned.push(makeFigure(bundle, {
      figureId: 'FIG-OPS-FRESHNESS',
      title: 'Dataset freshness',
      chartType: 'freshness_heatmap',
      visualVocabularyCategory: 'status',
      analyticQuestion: 'Which dependencies are fresh, degraded, or stale?',
      dataRefIds: (bundle.dataFreshness || []).map((item) => item.freshnessId),
      caveatIds: (bundle.caveats || []).filter((item) => item.type === 'stale_data').map((item) => item.caveatId),
    }));
  }
  if (deep) {
    if (deep.packs?.issuerThesisPack?.status === 'available') {
      const issuerPack = deep.packs.issuerThesisPack;
      const missingOperatingSymbols = (issuerPack.cards || [])
        .filter((card) => !(card.dataFlags?.hasIssuerOperatingKpi || card.dataFlags?.hasIssuerOperatingBridge))
        .map((card) => card.symbol)
        .filter(Boolean)
        .slice(0, 4);
      planned.push(makeFigure(bundle, {
        figureId: 'FIG-DEEP-ISSUER-THESIS',
        title: 'Issuer thesis bridge',
        chartType: 'peer_basket',
        visualVocabularyCategory: 'comparison',
        analyticQuestion: 'Which issuers have operating evidence, market sensitivity, and valuation/consensus support?',
        takeaway: missingOperatingSymbols.length
          ? `Company-level thesis work is explicit, but issuer operating KPI bridge is still missing for ${missingOperatingSymbols.join(', ')}.`
          : issuerPack.missingConsensusSymbols?.length
          ? `Company-level thesis work is now explicit, but consensus coverage is still missing for ${issuerPack.missingConsensusSymbols.slice(0, 4).join(', ')}.`
          : 'Company-level thesis work can compare operating evidence, market sensitivity, and consensus support across issuers.',
        dataRefIds: metricIds.filter((id) => /ISSUER|MARKET|VALUATION|DEEP/i.test(id)),
        caveatIds: (bundle.caveats || []).filter((item) => /valuation|consensus|data_gap|ontology/i.test(`${item.type} ${item.text}`)).map((item) => item.caveatId),
        metadata: { issuerThesisPack: issuerPack },
      }));
    }
    planned.push(makeFigure(bundle, {
      figureId: 'FIG-DEEP-CAUSAL-CHAIN',
      title: 'Causal chain readiness',
      chartType: 'causal_map',
      visualVocabularyCategory: 'relationship',
      analyticQuestion: 'Which mechanisms connect the signal to assets, companies, policy, or industry bottlenecks?',
      takeaway: 'Causal edges remain hypothesis-level unless independent evidence supports both timing and economic transmission.',
      dataRefIds: metricIds.filter((id) => /CAUSAL|CROSS-ASSET|MARKET|REGIME/i.test(id)),
      caveatIds: (bundle.caveats || []).filter((item) => /causal|data_gap/i.test(`${item.type} ${item.text}`)).map((item) => item.caveatId),
      metadata: { edges: deep.packs?.causalPack?.edges || [] },
    }));
    planned.push(makeFigure(bundle, {
      figureId: 'FIG-DEEP-HISTORICAL-ANALOGS',
      title: 'Historical analogues',
      chartType: 'historical_analog_table',
      visualVocabularyCategory: 'comparison',
      analyticQuestion: 'Does the current signal resemble a past cycle or is historical memory insufficient?',
      takeaway: deep.packs?.historicalAnalogPack?.status === 'available'
        ? 'Historical memory should remain secondary unless a named analogue includes regime context, market outcome, and clear differences.'
        : 'No named historical analogue is reliable enough; the report should not invent one.',
      dataRefIds: metricIds.filter((id) => /HISTORICAL|ANALOG/i.test(id)),
      caveatIds: (bundle.caveats || []).filter((item) => /historical|analog/i.test(`${item.type} ${item.text}`)).map((item) => item.caveatId),
      metadata: { analogues: deep.packs?.historicalAnalogPack?.analogues || [] },
    }));
    planned.push(makeFigure(bundle, {
      figureId: 'FIG-DEEP-DATA-DEPTH',
      title: 'Research coverage',
      chartType: 'status_board',
      visualVocabularyCategory: 'status',
      analyticQuestion: 'Which evidence lanes are supported and which still need backfill?',
      takeaway: deep.investmentReadiness?.tier === 'investment_memo_candidate'
        ? 'The evidence base is broad enough for thesis validation review, but decision-grade validation still governs use.'
        : 'Research coverage is broad enough for triage, but remaining blockers cap investment readiness.',
      dataRefIds: metricIds.filter((id) => /DEEP|GAP|FEEDBACK/i.test(id)),
      caveatIds: (bundle.caveats || []).filter((item) => /data_gap|stale|baseline/i.test(`${item.type} ${item.text}`)).map((item) => item.caveatId),
      metadata: { packs: deep.packs || {}, gaps: deep.gaps || [] },
    }));
    if (deep.packs?.institutionalEvidencePack) {
      const institutional = deep.packs.institutionalEvidencePack;
      const weakest = (institutional.blockingDimensions || [])
        .slice(0, 3)
        .map((item) => item.label)
        .filter(Boolean);
      planned.push(makeFigure(bundle, {
        figureId: 'FIG-DEEP-INSTITUTIONAL-EVIDENCE',
        title: 'Institutional evidence matrix',
        chartType: 'status_board',
        visualVocabularyCategory: 'status',
        analyticQuestion: 'Which quantitative tables and primary evidence lanes are dense enough for institutional research use?',
        takeaway: institutional.coverageScore >= 0.65
          ? 'Institutional evidence lanes are review-grade, but decision use still depends on primary evidence and controlled validation.'
          : `Institutional evidence density is below publishable threshold; weakest lanes are ${weakest.join(', ') || 'not yet classified'}.`,
        dataRefIds: metricIds.filter((id) => /INSTITUTIONAL|QUANT|PRIMARY|LONG-HORIZON/i.test(id)),
        caveatIds: (bundle.caveats || []).filter((item) => /institutional|data_gap/i.test(`${item.type} ${item.text}`)).map((item) => item.caveatId),
        metadata: { institutionalEvidencePack: institutional },
      }));
    }
    planned.push(makeFigure(bundle, {
      figureId: 'FIG-DEEP-WATCH-TRIGGERS',
      title: 'Watch trigger table',
      chartType: 'watch_table',
      visualVocabularyCategory: 'actionability',
      analyticQuestion: 'What evidence or metric change should change the analyst stance next?',
      takeaway: 'Watch triggers are useful only if they define stance changes and executable collection tasks.',
      dataRefIds: (bundle.watchIndicators || []).map((item) => item.watchId),
      caveatIds: (bundle.caveats || []).filter((item) => /gap|pending|stale/i.test(`${item.type} ${item.text}`)).map((item) => item.caveatId),
    }));
  }
  return attachFiguresToClaims({
    ...bundle,
    figures: [
      ...(bundle.figures || []),
      ...planned.filter((figure) => !hasFigure(bundle, figure.figureId)),
    ],
  });
}

export function validateFigureSpecs(figures = []) {
  const blockers = [];
  const warnings = [];
  for (const figure of figures) {
    if (!REPORT_CHART_TYPES.includes(figure.chartType)) {
      blockers.push({ type: 'unsupported_chart_type', message: `Unsupported chart type: ${figure.chartType}`, figureId: figure.figureId });
    }
    if (!figure.analyticQuestion) {
      blockers.push({ type: 'missing_analytic_question', message: 'Figure is missing analytic question.', figureId: figure.figureId });
    }
    if (!Array.isArray(figure.supportedClaimIds) || figure.supportedClaimIds.length === 0) {
      blockers.push({ type: 'figure_without_claim', message: 'Figure does not support any claim.', figureId: figure.figureId });
    }
    if (!figure.dataAsOf) {
      blockers.push({ type: 'figure_without_data_as_of', message: 'Figure is missing dataAsOf.', figureId: figure.figureId });
    }
    if (!Array.isArray(figure.dataRefIds) || figure.dataRefIds.length === 0) {
      warnings.push({ type: 'figure_without_data_refs', message: 'Figure has no data refs and should stay schematic/appendix only.', figureId: figure.figureId });
    }
  }
  return { ok: blockers.length === 0, blockers, warnings };
}
