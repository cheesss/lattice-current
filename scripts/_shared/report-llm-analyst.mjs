import { buildTypedAnalystSections } from './report-analyst-typed.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function first(array) {
  return Array.isArray(array) && array.length ? array[0] : null;
}

function unique(items) {
  return [...new Set(asArray(items).filter(Boolean))];
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

function formatMetricValue(metric = {}) {
  if (Number.isFinite(Number(metric.value))) {
    const number = Number(metric.value);
    if (Number.isInteger(number)) return String(number);
    return String(Number(number.toFixed(3)));
  }
  return String(metric.value ?? 'unknown');
}

function metricPhrase(metric = {}) {
  const unit = metric.unit ? ` ${metric.unit}` : '';
  const window = metric.window ? ` in the ${metric.window} lens` : '';
  return `${metric.name || 'metric'} is ${formatMetricValue(metric)}${unit}${window}`;
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

function freshnessSummary(bundle = {}) {
  const statuses = unique(asArray(bundle.dataFreshness).map((item) => item.freshnessStatus || 'unknown'));
  if (!statuses.length) return 'Freshness metadata is not attached, so the report should keep confidence bounded.';
  return `Freshness status is represented in the bundle as ${statuses.join(', ')}, so stale or degraded inputs must stay visible in the caveats.`;
}

function evidenceSummary(bundle = {}) {
  const statuses = unique(asArray(bundle.evidence).map((item) => item.freshnessStatus || 'unknown'));
  if (!asArray(bundle.evidence).length) {
    return 'The evidence ledger is empty, so this report can only identify an information gap.';
  }
  return `The evidence ledger should be read by evidence grade and freshness (${statuses.join(', ')}) before any claim is moved beyond review-gated use.`;
}

function reportTypeAssessment(bundle = {}) {
  const subject = bundle.subject?.displayName || 'This subject';
  if (bundle.reportType === 'theme_report') {
    return `${subject} should be read as a theme-change brief, not as a headline digest. The analyst question is whether the theme is structurally moving, merely receiving recent attention, or being distorted by a stale aggregate.`;
  }
  if (bundle.reportType === 'event_signal_report') {
    return `${subject} should be read as an event-signal brief. The analyst question is whether the event is only newsworthy, or whether the evidence chain and market-reaction ledger justify treating it as a decision-relevant signal.`;
  }
  if (bundle.reportType === 'regime_transmission_report') {
    return `${subject} should be read as a regime-transmission brief. The analyst question is which macro inputs are live, which links are only correlation, and which links have enough validation to guide scenario work.`;
  }
  if (bundle.reportType === 'cross_theme_bottleneck_report') {
    return `${subject} should be read as a review-gated connector candidate. The analyst question is whether this is a real cross-theme bottleneck, a supplier adjacency worth watching, or a seed-biased graph overlap.`;
  }
  if (bundle.reportType === 'symbol_signal_report') {
    return `${subject} should be read as an exposure-validation brief. The analyst question is whether the symbol is a usable proxy for the theme, or whether the linkage is too weak for decision use.`;
  }
  if (bundle.reportType === 'system_quality_report') {
    return `${subject} should be read as a trust-gate brief. The analyst question is which downstream outputs are safe, which require repair, and which should be suppressed until validation catches up.`;
  }
  return `${subject} should be read as an evidence-bound intelligence brief rather than a free-form summary.`;
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
    text: `${reaction.symbol || 'The linked symbol'} is the clearest market-link row in the bundle. Validation status: ${reaction.validationStatus || 'unknown'}; relative return is ${formatMetricValue({ value: reaction.relativeReturnPct })} percent, uplift is ${formatMetricValue({ value: reaction.uplift })}, and t-stat is ${formatMetricValue({ value: reaction.tStat })}. Treat this as a measured exposure check, not a standalone conclusion.`,
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
  if (!publishers.length) return 'The evidence ledger does not expose a clean source mix in the narrative layer.';
  return `Representative source mix includes ${publishers.slice(0, 4).join(', ')}.`;
}

function caveatBlocks(bundle = {}, primary = {}, limit = 3) {
  return asArray(bundle.caveats).slice(0, limit).map((caveat) => ({
    text: `Risk: ${caveat.type || 'general'} is marked ${caveat.severity || 'medium'}, so the report should preserve the limitation in the main conclusion instead of burying it in the appendix.`,
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
    ? 'The thesis is constrained by unresolved caveats, so it should be used as a working view rather than a publishable conclusion.'
    : 'The thesis can be used as a structured working view as long as downstream readers keep the evidence ledger attached.';
  const measurement = strongest ? `The main measurement anchor is ${metricPhrase(strongest)}.` : 'The bundle does not provide a strong measurement anchor.';
  const typeFrame = reportTypeAssessment(bundle);
  return [{
    text: `${subject} is best framed as a claim-led analyst brief rather than a generic news summary. ${typeFrame} ${measurement} The working thesis should therefore link the measurement, the evidence ledger, and the caveats before it asks the reader to act. ${caveatText}`,
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
      text: `Catalyst one is the directional measurement: ${metricPhrase(acceleration)}. This tells the reader which quantitative feature is moving before the report introduces interpretation.`,
      ...refsFor({ claim: primary, bundle, metrics: [acceleration], figures: ctx.figureRefs, caveats: ctx.caveatRefs }),
    });
  }
  if (recentEvidence) {
    catalysts.push({
      text: `Catalyst two is evidence availability: ${metricPhrase(recentEvidence)}. ${publisherSummary(bundle)} This separates a live evidence trail from a purely historical or model-only signal.`,
      ...refsFor({ claim: primary, bundle, evidence: ctx.evidenceRefs, metrics: [recentEvidence], caveats: ctx.caveatRefs }),
    });
  }
  if (sourceQuality) {
    catalysts.push({
      text: `Catalyst three is evidence quality: ${metricPhrase(sourceQuality)}. If source breadth or controls are weak, this remains a due-diligence item rather than a finished thesis.`,
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
      text: 'Keep the subject on watch and require the next evidence refresh to preserve the current measurement direction before escalating the conclusion.',
      ...refsFor({ claim: primary, bundle, evidence: ctx.evidenceRefs, metrics: ctx.metricRefs, figures: ctx.figureRefs, caveats: ctx.caveatRefs }),
    },
    {
      label: 'Stronger case',
      text: 'Independent evidence broadens, caveats shrink, and market or transmission rows align with the thesis; only then should the report move toward higher-confidence decision use.',
      ...refsFor({ claim: primary, bundle, evidence: ctx.evidenceRefs, metrics: ctx.metricRefs, figures: ctx.figureRefs, caveats: ctx.caveatRefs }),
    },
    {
      label: 'Weaker case',
      text: 'Evidence remains concentrated, data freshness degrades, or the metric ledger conflicts with the evidence ledger; in that case the right action is repair and re-run rather than stronger publication.',
      ...refsFor({ claim: primary, bundle, evidence: ctx.evidenceRefs, metrics: ctx.metricRefs, caveats: ctx.caveatRefs }),
    },
  ];
}

function buildRiskBlocks(bundle = {}, primary = {}, ctx = {}) {
  const risks = caveatBlocks(bundle, primary, 4);
  if (risks.length >= 2) return risks;
  return [
    ...risks,
    {
      text: 'A key counterpoint is that the evidence bundle can show attention without proving durable economic impact; market or transmission validation should remain a separate test.',
      ...refsFor({ claim: primary, bundle, evidence: ctx.evidenceRefs, metrics: ctx.metricRefs, caveats: ctx.caveatRefs }),
    },
    {
      text: 'A second counterpoint is data-shape risk: if the metric ledger, source ledger, and figure ledger do not agree, the report should expose the mismatch instead of smoothing it into a cleaner story.',
      ...refsFor({ claim: primary, bundle, evidence: ctx.evidenceRefs, metrics: ctx.metricRefs, figures: ctx.figureRefs, caveats: ctx.caveatRefs }),
    },
  ].slice(0, 3);
}

function buildConclusion(bundle = {}, primary = {}, ctx = {}) {
  const subject = bundle.subject?.displayName || 'The subject';
  return [{
    text: ctx.weakEvidence
      ? `${subject} is not ready to be read as a finished analyst conclusion. The useful output is a disciplined triage brief: inspect the evidence ledger, run the proposed source or validation repairs, then regenerate the report.`
      : `${subject} is ready for review as an evidence-bound analyst brief. The conclusion should stay tied to the claim ledger, the metric ledger, the figure ledger, and the watch triggers rather than becoming an unsupported narrative.`,
    confidence: primary.confidenceLevel || (ctx.weakEvidence ? 'low' : 'medium'),
    ...refsFor({ claim: primary, bundle, evidence: ctx.evidenceRefs, metrics: ctx.metricRefs, figures: ctx.figureRefs, caveats: ctx.caveatRefs }),
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
  const weakEvidence = caveats.some((item) => /source|pending|needs|stale|baseline|seed/i.test(`${item.type} ${item.text}`));
  const refs = claimRefs(primary, bundle);
  const sourceQueryCaveats = caveats.filter((item) => /source|pending|needs|evidence|seed/i.test(`${item.type} ${item.text}`));
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
        : 'Decision use is supported only inside the attached evidence, metric, figure, and caveat ledger; unsupported facts should not be added downstream.',
      confidence: weakEvidence ? 'low' : 'medium',
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, metrics: metricRefs, figures: figureRefs, caveats: caveatRefs }),
    },
  ];
  const whatChanged = metricRefs.length
    ? metricRefs.map((metric) => ({
      text: `${metricPhrase(metric)}; this is the measurement the report should explain before adding narrative interpretation.`,
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
        : 'Source concentration is not flagged as a blocker in the bundle, but the evidence ledger still remains the source of truth.',
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, caveats: caveatRefs }),
    },
    {
      text: 'The analyst read should separate three layers: observed evidence, calculated metrics, and interpretation. If those layers disagree, the disagreement is part of the report rather than a formatting issue to hide.',
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, metrics: metricRefs, figures: figureRefs, caveats: caveatRefs }),
    },
  ];
  const timeline = [
    {
      text: 'Read the sequence as evidence ingestion first, metric calculation second, figure rendering third, and analyst interpretation last.',
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, metrics: metricRefs, figures: figureRefs }),
    },
    {
      text: 'If any dataset is stale or degraded, later narrative sections should remain trust-gated rather than presented as current state.',
      ...refsFor({ claim: primary, bundle, caveats: caveatRefs }),
    },
  ];
  const analyticalAssessment = [
    {
      text: reportTypeAssessment(bundle),
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, metrics: metricRefs, figures: figureRefs, caveats: caveatRefs }),
    },
    {
      text: 'The strongest product value is not the prose itself; it is the claim-to-evidence chain that lets a reviewer inspect every judgment before action.',
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, metrics: metricRefs, figures: figureRefs }),
    },
    {
      text: 'A professional reading should ask what would change the conclusion, which evidence class is missing, and whether the measured signal maps to a company, sector, regime, or operational decision. This report keeps those questions explicit so the next iteration can repair gaps instead of simply adding longer prose.',
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, metrics: metricRefs, figures: figureRefs, caveats: caveatRefs }),
    },
  ];
  const decisionUse = [
    {
      text: weakEvidence
        ? 'Use this as a triage brief: open the evidence ledger, repair caveats through source queries or validation, then re-run the report.'
        : 'Use this as a review brief: inspect the evidence drawer, compare figures with claims, and keep caveats attached to the final decision.',
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, metrics: metricRefs, figures: figureRefs, caveats: caveatRefs }),
    },
    {
      text: 'Do not use the report as a standalone recommendation. Use it to decide which evidence chain deserves deeper human review, which metric needs refresh, and which watch trigger should be monitored in the next cycle.',
      ...refsFor({ claim: primary, bundle, evidence: evidenceRefs, metrics: metricRefs, figures: figureRefs, caveats: caveatRefs }),
    },
  ];
  /* Phase 3: type-specific prose overlays. The typed builder reads the
   * Phase 2 themeContext / event details / sensitivity row / candidate row
   * and produces subject-specific sentences. Sections returned as null
   * fall back to the generic templates below. */
  const typed = buildTypedAnalystSections(bundle);
  const pickTyped = (typedSection, fallback) =>
    (typed && typedSection !== undefined && typedSection !== null) ? typedSection : fallback;
  return {
    generatedAt: new Date().toISOString(),
    provider: 'deterministic',
    model: typed ? 'rule-based-typed-analyst' : 'rule-based-evidence-bound-analyst',
    promptPolicy: 'evidence-bound',
    keyJudgments: pickTyped(typed?.keyJudgments, keyJudgments),
    thesis: pickTyped(typed?.thesis, buildThesis(bundle, primary, ctx)),
    whatChanged: pickTyped(typed?.whatChanged, whatChanged),
    catalysts: pickTyped(typed?.catalysts, buildCatalysts(bundle, primary, ctx)),
    evidenceSynthesis: pickTyped(typed?.evidenceSynthesis, evidenceSynthesis),
    timeline: pickTyped(typed?.timeline, timeline),
    marketTransmission: pickTyped(typed?.marketTransmission, marketTransmissionBlocks(bundle, primary)),
    scenarios: pickTyped(typed?.scenarios, buildScenarios(bundle, primary, ctx)),
    risks: pickTyped(typed?.risks, buildRiskBlocks(bundle, primary, ctx)),
    analyticalAssessment: pickTyped(typed?.analyticalAssessment, analyticalAssessment),
    decisionUse: pickTyped(typed?.decisionUse, decisionUse),
    analystConclusion: pickTyped(typed?.analystConclusion, buildConclusion(bundle, primary, ctx)),
    alternativeExplanations: pickTyped(typed?.alternativeExplanations, caveatBlocks(bundle, primary, 3)),
    informationGaps: pickTyped(typed?.informationGaps, caveats
      .filter((caveat) => /pending|needs|source|stale|gap/i.test(`${caveat.type} ${caveat.text}`))
      .map((caveat) => ({
        text: `Resolve the ${caveat.type || 'information'} gap before using this report as a publishable conclusion.`,
        claimIds: asArray(caveat.appliesToClaimIds).length ? asArray(caveat.appliesToClaimIds) : refs.claimIds,
        caveatIds: [caveat.caveatId],
      }))),
    watchNext: pickTyped(typed?.watchNext, asArray(bundle.watchIndicators).map((watch) => ({
      text: watch.label,
      claimIds: asArray(watch.claimIds),
      evidenceIds: [],
      metricIds: [],
      figureIds: [],
      caveatIds: [],
      watchId: watch.watchId,
    }))),
    sourceQueries: pickTyped(typed?.sourceQueries, sourceQueryCaveats.slice(0, 3).map((caveat) => ({
      text: `Draft an evidence-expansion query for the ${caveat.type || 'open'} blocker before promotion or publication.`,
      claimIds: asArray(caveat.appliesToClaimIds).length ? asArray(caveat.appliesToClaimIds) : refs.claimIds,
      evidenceIds: [],
      metricIds: [],
      figureIds: [],
      caveatIds: [caveat.caveatId],
      approvalRequired: true,
    }))),
    analystNotes: pickTyped(typed?.analystNotes, [{
      text: weakEvidence
        ? 'Treat this report as a watch-level intelligence brief until evidence gaps are repaired.'
        : 'The report is evidence-bound and can be reviewed against the attached claim and evidence ledger.',
      ...primaryRefs,
    }]),
  };
}

export async function generateReportAnalystDraft(bundle = {}, options = {}) {
  if (options.provider && options.provider !== 'deterministic') {
    return {
      ...generateDeterministicAnalystDraft(bundle),
      provider: 'deterministic',
      providerFallbackReason: 'External LLM providers are intentionally disabled until budget, key, and validation policy are configured.',
    };
  }
  return generateDeterministicAnalystDraft(bundle);
}
