/*
 * Type-specific analyst prose generators.
 *
 * Phase 3 replaces the meta-prose templates ("...this is the measurement the
 * report should explain before adding narrative interpretation") with
 * subject-specific statements that read the bundle's themeContext, peer
 * symbols, knowledge edges, and event timeline.
 *
 * The output shape matches generateDeterministicAnalystDraft so the typed
 * builder can be a drop-in delegate. Each section now carries:
 *   - specific entity names (e.g. "Vertiv", "fiber", "GLD")
 *   - specific numbers (article_count=0, momentum=-100, confidence=0.58)
 *   - explicit bull / bear stance (not just "stronger" / "weaker" labels)
 *   - explicit invalidation criteria (what would flip the conclusion)
 *
 * Goal grade after Phase 3: ~A- (junior buy-side analyst note). Codex
 * synthesis (Phase 4) builds on these structured sections and adds the
 * narrative voice.
 */

function asArray(value) { return Array.isArray(value) ? value : []; }
function unique(items) { return [...new Set(asArray(items).filter(Boolean))]; }

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmtPct(value, digits = 1) {
  const n = num(value);
  if (n === null) return 'unknown';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function fmtNum(value, digits = 2) {
  const n = num(value);
  if (n === null) return 'unknown';
  if (Number.isInteger(n) && digits === 2) return String(n);
  return n.toFixed(digits);
}

function desiredCrossThemeEvidenceClass(query = '') {
  const text = String(query || '').toLowerCase();
  if (/\b(easy substitute|easy substitutes|supplier redundancy|no capacity constraint|non-qualified supplier|no procurement timing|limited qualified substitutes|no near-term supplier redundancy|negative control|alternative supplier)\b/.test(text)) return 'negative_control';
  if (/\b(qualification|qualified|certification|technical|nozzle|energetic|propellant|material)\b/.test(text)) return 'technical_qualification';
  if (/\b(procurement|contract|award|funding|budget|dod|pentagon|nato|program)\b/.test(text)) return 'procurement_trigger';
  if (/\b(capacity|facility|plant|factory|production|throughput|line|supplier)\b/.test(text)) return 'supplier_capacity';
  if (/\b(replacement|alternative|substitute|substitution|constraint|bottleneck)\b/.test(text)) return 'substitution_limit';
  if (/\b(revenue|segment|guidance|issuer|exposure|margin|backlog|book-to-bill|book to bill)\b/.test(text)) return 'issuer_exposure';
  return 'supplier_capacity';
}

const CROSS_THEME_REQUIRED_EVIDENCE_CLASSES = [
  'supplier_capacity',
  'technical_qualification',
  'procurement_trigger',
  'substitution_limit',
  'issuer_exposure',
  'negative_control',
];

function quoted(value = '') {
  const clean = String(value || '').replace(/"/g, '').replace(/\s+/g, ' ').trim();
  return clean ? `"${clean}"` : '';
}

function crossThemeQueryForClass({ name = '', themes = [], triggers = [] } = {}, evidenceClass = 'supplier_capacity') {
  const connector = quoted(name) || '"cross theme bottleneck"';
  const themeText = unique([
    ...asArray(themes),
    ...asArray(triggers).slice(0, 2),
  ]).join(' ');
  const themeSuffix = themeText ? ` ${themeText}` : '';
  return ({
    supplier_capacity: `${connector} facility production capacity supplier throughput${themeSuffix}`,
    technical_qualification: `${connector} qualified supplier technical qualification certification energetic materials${themeSuffix}`,
    procurement_trigger: `${connector} procurement contract award funding budget program trigger${themeSuffix}`,
    substitution_limit: `${connector} substitute alternative supplier redundancy sole source hard to substitute${themeSuffix}`,
    issuer_exposure: `${connector} issuer exposure revenue segment guidance backlog book-to-bill${themeSuffix}`,
    negative_control: `${connector} easy substitutes supplier redundancy no capacity constraint non-qualified supplier no procurement timing`,
  })[evidenceClass] || `${connector} capacity supplier evidence${themeSuffix}`;
}

function crossThemeAcceptanceCriteria(evidenceClass = '') {
  return ({
    supplier_capacity: 'Connector-specific capacity, facility, throughput, production-line, or supplier bottleneck evidence.',
    technical_qualification: 'Qualification, certification, test, material, propellant, nozzle, or technical substitution evidence.',
    procurement_trigger: 'Contract award, funding, budget-line, program timing, procurement, or customer demand trigger evidence.',
    substitution_limit: 'Evidence that substitutes are scarce, slow to qualify, sole-source, or supplier redundancy is limited.',
    issuer_exposure: 'Issuer-level backlog, segment revenue, guidance, supplier/customer exposure, or management-commentary evidence.',
    negative_control: 'Invalidator or constraint-check evidence about easy substitutes, supplier redundancy, no timing pressure, or non-qualified suppliers.',
  })[evidenceClass] || 'Evidence must be directly tied to the connector and requested evidence class.';
}

function crossThemeIssuerHints({ query = '', name = '', themes = [] } = {}) {
  const text = `${query} ${name} ${asArray(themes).join(' ')}`.toUpperCase();
  return ['LHX', 'NOC', 'LMT', 'RTX', 'GD', 'RKLB']
    .filter((symbol) => new RegExp(`\\b${symbol}\\b`).test(text));
}

function buildCrossThemeSourceQueryEntries({ discovery = {}, cand = {}, name = '', themes = [] } = {}) {
  const triggerTerms = asArray(discovery.triggerTerms);
  const rawQueries = asArray(discovery.sourceQueries).map((query) => String(query || '').trim()).filter(Boolean);
  const entries = rawQueries.map((query) => ({
    query,
    desiredEvidenceClass: desiredCrossThemeEvidenceClass(query),
  }));
  const covered = new Set(entries.map((entry) => entry.desiredEvidenceClass));
  for (const evidenceClass of CROSS_THEME_REQUIRED_EVIDENCE_CLASSES) {
    if (covered.has(evidenceClass)) continue;
    entries.push({
      query: crossThemeQueryForClass({
        name: cand.connector || cand.connector_name || cand.supplier_name || name,
        themes,
        triggers: triggerTerms,
      }, evidenceClass),
      desiredEvidenceClass: evidenceClass,
    });
    covered.add(evidenceClass);
  }
  const seen = new Set();
  return entries.filter((entry) => {
    const key = entry.query.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fmtAcceleration(bundle, value) {
  const n = num(value);
  if (n === null) return 'unknown';
  const distorted = Math.abs(n) > 100 || bundle?.metadata?.diagnosticSignals?.hasBaselineDistortion;
  if (!distorted) return fmtPct(n, 0);
  if (n > 0) return 'positive but baseline-distorted';
  if (n < 0) return 'negative but baseline-distorted';
  return 'flat';
}

function humanizeIdentifier(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function humanizeThemeIdentifier(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function memoSafeText(value) {
  return String(value || '')
    .replace(/\btheme_trend_aggregates\b/gi, 'theme trend inputs')
    .replace(/\bstock_sensitivity_matrix\b/gi, 'symbol sensitivity screen')
    .replace(/\bcanonical_events\b/gi, 'event timeline')
    .replace(/\bknowledge_edges\b/gi, 'knowledge graph links')
    .replace(/\bregime_conditional_impact\b/gi, 'regime-conditioning check')
    .replace(/\bauto-pipeline\b/gi, 'theme mapping refresh')
    .replace(/\brows?\b/gi, (match) => (match.toLowerCase() === 'rows' ? 'items' : 'item'))
    .replace(/\bfields?\b/gi, (match) => (match.toLowerCase() === 'fields' ? 'inputs' : 'input'))
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function relationLabel(value) {
  return humanizeIdentifier(value) || 'is linked to';
}

function controlContext(controls = []) {
  const visible = asArray(controls)
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item) => !/^(sample_size|n_controls)=/i.test(item))
    .slice(0, 3);
  return visible.length ? `control context: ${visible.join(', ')}` : 'control sample is attached';
}

/* Per-sentence citation. When opts.specific=true, the sentence pins only the
 * IDs explicitly listed in opts.evidenceIds / metricIds / figureIds /
 * caveatIds (no bundle-wide bulk attach). When opts.specific is omitted, falls
 * back to the bundle-wide attach for sentences that genuinely span the bundle.
 *
 * Goal: prose like "GOOGL: +5.22% avg return, t-stat 0.95" should pin only
 * the GOOGL marketReaction id, not every other evidence + metric the bundle
 * happens to carry. */
function refsFor(bundle, opts = {}) {
  const claim = bundle.claims?.[0] || {};
  const claimIds = [claim.claimId].filter(Boolean);
  if (opts.specific) {
    return {
      claimIds,
      evidenceIds: asArray(opts.evidenceIds).slice(0, 4),
      metricIds: asArray(opts.metricIds).slice(0, 4),
      figureIds: asArray(opts.figureIds).slice(0, 2),
      caveatIds: asArray(opts.caveatIds).slice(0, 3),
    };
  }
  return {
    claimIds,
    evidenceIds: unique([
      ...asArray(opts.evidenceIds),
      ...(asArray(bundle.evidence).slice(0, 3).map((e) => e.evidenceId)),
    ]).slice(0, 3),
    metricIds: unique([
      ...asArray(opts.metricIds),
      ...(asArray(bundle.metrics).slice(0, 3).map((m) => m.metricId)),
    ]).slice(0, 4),
    figureIds: unique([
      ...asArray(opts.figureIds),
      ...(asArray(bundle.figures).slice(0, 2).map((f) => f.figureId)),
    ]).slice(0, 2),
    caveatIds: unique([
      ...asArray(opts.caveatIds),
      ...(asArray(bundle.caveats).slice(0, 2).map((c) => c.caveatId)),
    ]).slice(0, 3),
  };
}

function findMetric(bundle, name) {
  return asArray(bundle.metrics).find((m) => m.name === name) || null;
}
function findMetricById(bundle, id) {
  return asArray(bundle.metrics).find((m) => m.metricId === id) || null;
}

/* ============================================================
 *  THEME REPORT — uses bundle.metadata.themeContext heavily
 * ============================================================ */

function buildThemeKeyJudgments(bundle) {
  const ctx = bundle.metadata?.themeContext || {};
  const subject = bundle.subject?.displayName || 'this theme';
  const articleCount = num(findMetric(bundle, 'article_count')?.value);
  const yoy = num(findMetric(bundle, 'YoY')?.value);
  const acceleration = num(findMetric(bundle, 'acceleration')?.value);
  const recentEvidence = num(findMetric(bundle, 'recent_evidence_items')?.value);
  const subtopic = ctx.subtopics?.[0];
  const peerCounts = ctx.peerSymbols?.counts || { positive: 0, negative: 0, total: 0 };
  const eventCount = ctx.events?.length || 0;
  const surgeCount = (ctx.events || []).filter((e) => e.isSurge).length;
  const orphanFlag = bundle.metadata?.diagnosticSignals?.hasAggregateOrphan;

  const judgments = [];

  /* Judgment 1 — what is moving */
  if (orphanFlag) {
    judgments.push({
      text: `${subject} has ${articleCount ?? '?'} articles in the aggregate read, but the event timeline shows ${eventCount} live event${eventCount === 1 ? '' : 's'} over the last 30 days (${surgeCount} surge${surgeCount === 1 ? '' : 's'}). Treat the aggregate as stale and anchor the memo on the event timeline plus recent evidence instead.`,
      confidence: 'medium',
      ...refsFor(bundle),
    });
  } else if (subtopic) {
    judgments.push({
      text: `${subject} is currently classified as "${subtopic.lifecycle_stage || 'unknown'}" on the theme lifecycle. Attention momentum is ${fmtNum(subtopic.momentum_score, 0)}, while acceleration is ${fmtAcceleration(bundle, subtopic.acceleration)} because the comparison base is sparse. The aggregate read is ${fmtPct(yoy, 0)} YoY on ${articleCount ?? '?'} articles this period.`,
      confidence: 'medium',
      ...refsFor(bundle),
    });
  } else {
    judgments.push({
      text: `${subject} has ${articleCount ?? '?'} articles in the current aggregate period, YoY is ${fmtPct(yoy, 0)}, and acceleration is ${fmtAcceleration(bundle, acceleration)}. The report has ${recentEvidence || 0} recent evidence item${recentEvidence === 1 ? '' : 's'} attached.`,
      confidence: 'medium',
      ...refsFor(bundle),
    });
  }

  /* Judgment 2 — peer symbol exposure */
  if (peerCounts.total > 0) {
    const positiveTickers = (ctx.peerSymbols.positive || []).slice(0, 3).map((p) => p.symbol).filter(Boolean);
    const negativeTickers = (ctx.peerSymbols.negative || []).slice(0, 3).map((p) => p.symbol).filter(Boolean);
    if (positiveTickers.length || negativeTickers.length) {
      const parts = [];
      if (positiveTickers.length) parts.push(`positive sensitivity: ${positiveTickers.join(', ')}`);
      if (negativeTickers.length) parts.push(`negative sensitivity: ${negativeTickers.join(', ')}`);
      judgments.push({
        text: `Market exposure screen found ${peerCounts.total} candidate symbols: ${parts.join('; ')}. Symbols inside the noise band are not treated as actionable proxies.`,
        confidence: 'medium',
        ...refsFor(bundle),
      });
    }
  } else {
    judgments.push({
      text: `No symbol exposures are available for this theme. Market linkage cannot be validated from the current bundle; symbol-coverage backfill should run before the memo draws asset conclusions.`,
      confidence: 'low',
      ...refsFor(bundle),
    });
  }

  /* Judgment 3 — knowledge graph reach */
  const conns = ctx.knowledgeConnections || [];
  if (conns.length) {
    const top = conns.slice(0, 3).map((c) => `${c.entityName} (${relationLabel(c.relationType)}, confidence ${fmtNum(c.confidence, 2)})`);
    judgments.push({
      text: `Knowledge graph attaches ${conns.length} entit${conns.length === 1 ? 'y' : 'ies'} to ${subject}: ${top.join('; ')}. These are candidate-tier extractions until cross-validated.`,
      confidence: 'low',
      ...refsFor(bundle),
    });
  }

  return judgments.slice(0, 3);
}

function buildThemeThesis(bundle) {
  const ctx = bundle.metadata?.themeContext || {};
  const subject = bundle.subject?.displayName || 'this theme';
  const peerN = ctx.peerSymbols?.counts?.total || 0;
  const subtopic = ctx.subtopics?.[0];
  const events = ctx.events || [];
  const recentSurge = events.find((e) => e.isSurge);
  const orphanFlag = bundle.metadata?.diagnosticSignals?.hasAggregateOrphan;

  let stance = 'neutral';
  const reasons = [];
  if (subtopic?.lifecycle_stage === 'declining' || (num(subtopic?.momentum_score) ?? 0) < -50) {
    stance = 'attention is weakening';
    reasons.push(`subtopic in declining lifecycle (momentum ${fmtNum(subtopic?.momentum_score, 0)})`);
  } else if (subtopic?.lifecycle_stage === 'accelerating' || (num(subtopic?.momentum_score) ?? 0) > 50) {
    stance = 'attention is strengthening';
    reasons.push(`subtopic in accelerating lifecycle (momentum ${fmtNum(subtopic?.momentum_score, 0)})`);
  }
  if (recentSurge) reasons.push(`event ${recentSurge.eventId} on ${recentSurge.eventDate?.slice(0, 10)} is a surge`);
  if (peerN === 0) reasons.push('no validated symbol exposure in the sensitivity screen');
  if (orphanFlag) reasons.push('aggregate signal is stale; distrust the multipliers');

  const reasonText = reasons.length ? reasons.join('; ') : 'baseline stance; no strong directional signal in the bundle';
  return [{
    text: `${subject}: working stance is that ${stance} (${reasonText}). The upside case requires sustained article volume and new positively sensitive peer symbols. The downside case is the current state: declining or stagnant attention with no symbol confirmation. Invalidator: a period with more than 30 articles, positive multi-source coverage, and at least 2 positively sensitive peers with 30 or more observations.`,
    confidence: orphanFlag ? 'low' : 'medium',
    stance,
    ...refsFor(bundle),
  }];
}

function buildThemeWhatChanged(bundle) {
  const ctx = bundle.metadata?.themeContext || {};
  const events = ctx.events || [];
  const subtopics = ctx.subtopics || [];
  const blocks = [];

  if (events.length) {
    const singleSourceDominated = events.filter((event) => Number(event.sourceCount || 0) <= 1).length > events.length / 2;
    const hasCanonicalEvent = events.some((event) => Number(event.articleCount || 0) >= 10 && Number(event.sourceCount || 0) >= 3);
    const hasIntensityQualifiedEvent = events.some((event) => event.isSurge && Number(event.hawkesIntensity || 0) > 0);
    const wireConcentration = events.some((event) => event.wireDominated);
    blocks.push({
      text: [
        singleSourceDominated
          ? 'Recent coverage is fragmented and mostly single-source, so it should be read as narrative scan evidence rather than a canonical event.'
          : 'Recent coverage has broader source participation, which makes the event set worth monitoring as a possible narrative cluster.',
        hasCanonicalEvent
          ? 'At least one attached cluster has enough breadth to deserve follow-up review.'
          : 'No attached cluster yet forms a multi-source canonical event.'
        ,
        hasIntensityQualifiedEvent
          ? 'The event set includes an intensity-qualified surge, so follow-on coverage should be watched.'
          : 'The event set is not intensity-qualified in the current bundle.'
        ,
        wireConcentration ? 'Wire concentration remains a caveat for interpreting article volume.' : '',
      ].filter(Boolean).join(' '),
      ...refsFor(bundle, { metricIds: ['MET-EVENT-TIMELINE-COUNT'] }),
    });
  }

  if (!blocks.length) {
    blocks.push({
      text: 'No event sequence is recorded in the last 30 days for this theme. Either coverage is genuinely quiet or event clustering has not run.',
      ...refsFor(bundle),
    });
  }


  /* Subtopic shifts — specific-citation */
  const subtopicLabels = subtopics
    .filter((subtopic) => subtopic.lifecycle_stage && subtopic.theme_label)
    .slice(0, 3)
    .map((subtopic) => `${subtopic.theme_label} (${subtopic.lifecycle_stage})`);
  if (subtopicLabels.length) {
    blocks.push({
      text: `Subtopic movement is concentrated around ${subtopicLabels.join(', ')}. Treat lifecycle, momentum, and acceleration as directional coverage-rotation diagnostics, not precise industry growth math when baselines are sparse.`,
      ...refsFor(bundle, { metricIds: ['MET-SUBTOPIC-COUNT'] }),
    });
  }

  return blocks.slice(0, 6);
}

function buildThemeCatalysts(bundle) {
  const ctx = bundle.metadata?.themeContext || {};
  const conns = ctx.knowledgeConnections || [];
  const subject = bundle.subject?.displayName || 'this theme';
  const blocks = [];

  /* Catalyst 1: knowledge edges with highest evidence count, restricted to
   * those whose EVID-EDGE-{id} is actually in bundle.evidence (Phase 2 pushes
   * the top 6 by confidence; the highest evidence_count edge may not be in
   * that subset, which would break citation validation). */
  const evidenceIdSet = new Set(asArray(bundle.evidence).map((e) => e.evidenceId));
  const sortedConns = [...conns]
    .filter((c) => evidenceIdSet.has(`EVID-EDGE-${c.edgeId}`))
    .sort((a, b) => (num(b.evidenceCount) || 0) - (num(a.evidenceCount) || 0));
  if (sortedConns[0]) {
    const top = sortedConns[0];
    blocks.push({
      text: `Catalyst lane: ${subject} ${relationLabel(top.relationType)} ${top.entityName} (${top.entityType}). The link carries ${top.evidenceCount} supporting item${top.evidenceCount === 1 ? '' : 's'}, source breadth ${top.sourceDiversity}, and confidence ${fmtNum(top.confidence, 2)}. Watch ${top.entityName} for theme-specific reads.`,
      ...refsFor(bundle, { specific: true, metricIds: ['MET-KNOWLEDGE-DEGREE'], evidenceIds: [`EVID-EDGE-${top.edgeId}`] }),
    });
  }

  /* Catalyst 2: regime symbols showing differential response. Phrase varies
   * by whether the symbol spans multiple distinct regimes or just multiple
   * horizons within the same regime. */
  const regimeBy = ctx.regimeBySymbol || [];
  if (regimeBy[0]) {
    const top = regimeBy[0];
    const distinctRegimes = new Set(top.regimes.map((r) => r.regime)).size;
    const observations = top.regimes.map((r) => `${r.regime}/${r.horizon}: multiplier ${fmtNum(r.regime_multiplier, 2)} across ${r.sample_size} observations`).join('; ');
    blocks.push({
      text: distinctRegimes >= 2
        ? `Regime-conditioned read: ${top.symbol} responds differently across regimes: ${observations}. Transmission strength is regime-dependent.`
        : `Horizon-conditioned read: ${top.symbol} multipliers differ across horizons within the ${top.regimes[0]?.regime} regime: ${observations}. Same regime, but the holding-period response is non-flat.`,
      ...refsFor(bundle),
    });
  }

  /* Catalyst 3: hawkes surge */
  const surge = (ctx.events || []).find((e) => e.isSurge);
  if (surge) {
    blocks.push({
      text: `Event-surge read: event ${surge.eventId} on ${surge.eventDate?.slice(0, 10)} fired with intensity ${fmtNum(surge.hawkesIntensity, 2)}. Self-exciting clustering means follow-on coverage is more likely in the next 7-14 days.`,
      ...refsFor(bundle),
    });
  }

  if (!blocks.length) {
    blocks.push({
      text: `No clear catalyst signal is attached. The knowledge graph has ${conns.length} edge${conns.length === 1 ? '' : 's'}, and the regime lens covers ${regimeBy.length} symbol${regimeBy.length === 1 ? '' : 's'}; rerun event discovery if a catalyst should be present.`,
      ...refsFor(bundle),
    });
  }
  return blocks.slice(0, 3);
}

function buildThemeMarketTransmission(bundle) {
  const reactions = asArray(bundle.marketReactions);
  if (!reactions.length) {
    return [{
      text: 'No market reactions in the bundle; theme has no measured asset transmission. Treat market commentary as out of scope for this report.',
      ...refsFor(bundle),
    }];
  }
  return reactions.slice(0, 5).map((r) => {
    const sampleControl = (r.controls || []).find((c) => /sample_size/.test(c)) || 'sample_size=?';
    const observationCount = sampleControl.replace(/^sample_size=/, '');
    const observationPhrase = observationCount === '?' ? 'an attached observation sample' : `${observationCount} observations`;
    const validation = r.validationStatus || 'candidate';
    return {
      text: `${r.symbol} is the measured market link: ${fmtPct(r.relativeReturnPct, 2)} average return, t-stat ${fmtNum(r.tStat, 2)}, and ${observationPhrase}. It is marked ${validation}; ${validation === 'validated' ? 'the multi-period sample can support research proxy work.' : 'the sample remains below the validation threshold, so keep it as candidate exposure.'}`,
      /* Specific citation: only this reaction's metadata, not the whole bundle */
      ...refsFor(bundle, {
        specific: true,
        evidenceIds: [],
        metricIds: [],
        figureIds: [],
        caveatIds: [],
      }),
      reactionId: r.reactionId,
    };
  });
}

function buildThemeScenarios(bundle) {
  const ctx = bundle.metadata?.themeContext || {};
  const subject = bundle.subject?.displayName || 'this theme';
  const peerN = ctx.peerSymbols?.counts?.total || 0;
  const eventN = ctx.events?.length || 0;

  return [
    {
      label: 'Upside case',
      text: `Sustained article volume returns above 30 articles per period for 2 or more consecutive periods, at least 2 positively sensitive peer symbols emerge with 30 or more observations, and event intensity remains elevated above 0.5: escalate to active watchlist with allocated tracking budget.`,
      ...refsFor(bundle),
    },
    {
      label: 'Downside case',
      text: `Current state extended (peer count stays ${peerN}, event count stays ${eventN}/30d, lifecycle remains declining): theme remains in the discovery layer; no symbol-level decision use is justified.`,
      ...refsFor(bundle),
    },
    {
      label: 'Inflection invalidator',
      text: `What flips the call: (1) a single canonical event with 3 or more source clusters and at least 10 articles, (2) multi-regime appearance of any symbol with a consistent sensitivity sign, (3) cross-theme connector candidate validates ${subject} as a bottleneck for an adjacent theme.`,
      ...refsFor(bundle),
    },
  ];
}

function buildThemeRisks(bundle) {
  const orphanFlag = bundle.metadata?.diagnosticSignals?.hasAggregateOrphan;
  const overfitFlag = bundle.metadata?.diagnosticSignals?.hasOverfitRisk;
  const evidenceMismatchFlag = bundle.metadata?.diagnosticSignals?.hasEvidenceMismatch;
  const blocks = [];
  if (orphanFlag) {
    blocks.push({
      text: 'Stale aggregate risk: the aggregate read is inconsistent with current event evidence. Discount the aggregate and anchor the risk read on the event timeline.',
      ...refsFor(bundle),
    });
  }
  if (evidenceMismatchFlag) {
    blocks.push({
      text: 'Evidence-window mismatch: recent evidence is present while the aggregate article window is empty. Treat the two windows separately and do not call the recent evidence "this period" data.',
      ...refsFor(bundle),
    });
  }
  if (overfitFlag) {
    blocks.push({
      text: 'Overfit risk: at least one peer symbol has a multiplier above 5 with fewer than 10 observations. Below 10 observations, the multiplier is statistical noise, not regime conditioning.',
      ...refsFor(bundle),
    });
  }
  /* Generic risks */
  blocks.push({
    text: 'Source concentration risk: when source breadth falls below 0.4 or one publisher dominates, a coordinated wire push can manufacture apparent volume without independent confirmation.',
    ...refsFor(bundle),
  });
  blocks.push({
    text: 'Knowledge graph candidate risk: deterministic phrase extraction over-produces low-confidence links. Treat confidence below 0.7 as a research candidate, not a fact.',
    ...refsFor(bundle),
  });
  return blocks.slice(0, 4);
}

function buildThemeAnalyticalAssessment(bundle) {
  const ctx = bundle.metadata?.themeContext || {};
  const subject = bundle.subject?.displayName || 'This theme';
  return [
    {
      text: `${subject} is read through three lenses: (a) attention pulse from article volume, event intensity, and subtopic momentum, (b) symbol transmission from peer sensitivity signs, and (c) graph adjacency to component, supplier, and technology entities. The strongest evidence is whichever lens has the largest fresh sample.`,
      ...refsFor(bundle),
    },
    {
      text: ctx.peerSymbols?.counts?.total
        ? `The peer symbol set (${ctx.peerSymbols.counts.total} symbols, ${ctx.peerSymbols.counts.positive} positive, ${ctx.peerSymbols.counts.negative} negative) is the most actionable lens. Watch the sign-asymmetry: if negative dominates, the theme is risk-off correlated.`
        : `The peer symbol lens is empty. Until the sensitivity screen has observations for this theme, market-linkage statements should be deferred.`,
      ...refsFor(bundle),
    },
    {
      text: `Counter-question to the analyst: which of the lenses (attention / transmission / graph) would have to break for the working stance to change? Documented answer below in scenarios.`,
      ...refsFor(bundle),
    },
  ];
}

function buildThemeWatchNext(bundle) {
  const ctx = bundle.metadata?.themeContext || {};
  const blocks = [];
  /* Subtopic-derived watch */
  const subtopic = ctx.subtopics?.[0];
  if (subtopic) {
    blocks.push({
      text: `Watch subtopic "${subtopic.theme_label}" rank in parent: drop below rank ${subtopic.rank_in_parent + 2} signals deceleration; rise above rank ${Math.max(1, subtopic.rank_in_parent - 2)} signals acceleration.`,
      claimIds: [bundle.claims?.[0]?.claimId].filter(Boolean),
      evidenceIds: [], metricIds: [], figureIds: [], caveatIds: [],
    });
  }
  /* Knowledge entity watch */
  const conns = (ctx.knowledgeConnections || []).slice(0, 3);
  conns.forEach((conn) => {
    blocks.push({
      text: `Watch ${conn.entityName} (${conn.entityType}): its independent news flow ${conn.relationType === 'requires' ? 'directly affects' : 'co-moves with'} the theme.`,
      claimIds: [bundle.claims?.[0]?.claimId].filter(Boolean),
      evidenceIds: [], metricIds: [], figureIds: [], caveatIds: [],
    });
  });
  /* Existing watch indicators */
  for (const w of asArray(bundle.watchIndicators).slice(0, 2)) {
    blocks.push({
      text: memoSafeText(w.label),
      claimIds: asArray(w.claimIds), evidenceIds: [], metricIds: [], figureIds: [], caveatIds: [],
      watchId: w.watchId,
    });
  }
  return blocks.slice(0, 5);
}

export function buildThemeAnalystSections(bundle) {
  const orphanFlag = bundle.metadata?.diagnosticSignals?.hasAggregateOrphan;
  const noContext = !bundle.metadata?.themeContext;
  if (noContext) return null; // fall back to deterministic generic prose
  return {
    keyJudgments: buildThemeKeyJudgments(bundle),
    thesis: buildThemeThesis(bundle),
    whatChanged: buildThemeWhatChanged(bundle),
    catalysts: buildThemeCatalysts(bundle),
    marketTransmission: buildThemeMarketTransmission(bundle),
    scenarios: buildThemeScenarios(bundle),
    risks: buildThemeRisks(bundle),
    analyticalAssessment: buildThemeAnalyticalAssessment(bundle),
    watchNext: buildThemeWatchNext(bundle),
    /* Sections kept generic — they don't benefit from theme context as much */
    decisionUse: null, // delegate to generic
    analystConclusion: null,
    evidenceSynthesis: null,
    timeline: null,
    alternativeExplanations: null,
    informationGaps: null,
    sourceQueries: null,
    analystNotes: [{
      text: orphanFlag
        ? 'Typed analyst frame: stale aggregate detected, so the memo prefers event timeline and knowledge-graph evidence.'
        : 'Typed analyst frame: subject-specific reads from subtopics, peers, knowledge links, and events.',
      ...refsFor(bundle),
    }],
  };
}

/* ============================================================
 *  EVENT SIGNAL REPORT
 * ============================================================ */

export function buildEventAnalystSections(bundle) {
  const subject = bundle.subject?.displayName || 'this event';
  const eventId = bundle.subject?.subjectId;
  const reactions = asArray(bundle.marketReactions);
  const articleEvidence = asArray(bundle.evidence).filter((e) => e.kind === 'news_article');
  const sources = unique(articleEvidence.map((e) => e.publisher).filter(Boolean));
  const validatedReactions = reactions.filter((r) => r.validationStatus === 'validated');
  const tStatList = reactions.map((r) => num(r.tStat)).filter((v) => v !== null && Math.abs(v) > 1.5);

  /* Publisher names go in quotes so their numeric content (e.g. "404 Media")
   * gets stripped by validator's quoted-string sanitizer. */
  const sourceList = sources.slice(0, 3).map((s) => `"${s}"`).join(', ');
  const keyJudgments = [
    {
      text: `"${subject}" is an event cluster with ${articleEvidence.length} article${articleEvidence.length === 1 ? '' : 's'} from ${sources.length} source${sources.length === 1 ? '' : 's'} (${sourceList}${sources.length > 3 ? ', plus additional sources' : ''}). The bundle attaches ${reactions.length} market reaction${reactions.length === 1 ? '' : 's'}, with ${validatedReactions.length} marked validated.`,
      confidence: 'medium',
      ...refsFor(bundle, { specific: true }),
    },
  ];
  if (tStatList.length) {
    keyJudgments.push({
      text: `Significant t-stats (|t|>1.5): ${tStatList.slice(0, 4).map((t) => fmtNum(t, 2)).join(', ')}. The event has measurable asset response.`,
      confidence: 'medium',
      ...refsFor(bundle),
    });
  } else {
    keyJudgments.push({
      text: 'No attached market reaction clears the 1.5 t-stat threshold. Event is news-grade but not yet decision-grade for asset transmission.',
      confidence: 'low',
      ...refsFor(bundle),
    });
  }
  const thesis = [{
    text: `"${subject}" becomes decision-relevant only if the market reaction is multi-symbol with a consistent sign, the article cluster spans 3 or more independent sources, and follow-on events appear within 7 days. Current read: ${validatedReactions.length} validated symbol${validatedReactions.length === 1 ? '' : 's'} and ${sources.length} source${sources.length === 1 ? '' : 's'}.`,
    confidence: validatedReactions.length >= 2 && sources.length >= 3 ? 'medium' : 'low',
    ...refsFor(bundle),
  }];
  return {
    keyJudgments,
    thesis,
    whatChanged: [{
      text: `"${subject}" entered the event set with ${articleEvidence.length} attached article${articleEvidence.length === 1 ? '' : 's'}. The first visible source is "${sources[0] || 'unknown'}".`,
      ...refsFor(bundle, { specific: true }),
    }],
    catalysts: tStatList.length ? [{
      text: `Catalyst: significant uplift in ${reactions.filter((r) => num(r.tStat) && Math.abs(num(r.tStat)) > 1.5).slice(0, 3).map((r) => r.symbol).join(', ')}.`,
      ...refsFor(bundle),
    }] : null,
    marketTransmission: reactions.slice(0, 5).map((r) => ({
      text: `${r.symbol} shows ${fmtPct(r.relativeReturnPct, 2)} relative return with t-stat ${fmtNum(r.tStat, 2)}; ${controlContext(r.controls)}. It is marked ${r.validationStatus}.`,
      ...refsFor(bundle),
      reactionId: r.reactionId,
    })),
    scenarios: [
      { label: 'Upside case', text: `Follow-on events appear within 7 days, source breadth expands beyond ${sources.length}, validated symbol count rises above ${validatedReactions.length}. Event becomes a thesis driver.`, ...refsFor(bundle) },
      { label: 'Downside case', text: `No follow-on events; validated symbols stay at ${validatedReactions.length}. Event becomes a one-shot news item without lasting transmission.`, ...refsFor(bundle) },
      { label: 'Invalidator', text: `Reverse uplift in next 14 days OR a competing event with stronger evidence on the same theme. Either flips the read from "active signal" to "noise candidate".`, ...refsFor(bundle) },
    ],
    risks: [
      { text: `Single-source risk: ${sources.length === 1 ? 'YES: only one publisher in the cluster.' : 'manageable: ' + sources.length + ' sources.'}`, ...refsFor(bundle) },
      { text: `Sample-size risk: market reactions with fewer than 30 controls are exploratory; multipliers are unreliable.`, ...refsFor(bundle) },
    ],
    analyticalAssessment: [{
      text: `Read this event through 3 questions: (1) is the article cluster real (sources, freshness)? (2) is the asset response measurable (t-stat, sample)? (3) does the event fit a known causal frame (theme + supplier/component path)? Affirmative on all 3 = decision-grade.`,
      ...refsFor(bundle),
    }],
    watchNext: [{
      text: `Watch for follow-on event clusters on the same theme in the next 7 to 14 days; self-excitation predicts continued clustering.`,
      claimIds: [bundle.claims?.[0]?.claimId].filter(Boolean), evidenceIds: [], metricIds: [], figureIds: [], caveatIds: [],
    }],
    decisionUse: null,
    /* Override analystConclusion to wrap event title in quotes — titles can
     * contain numeric tokens (e.g. "404 Media") that the validator would
     * otherwise flag as unknown numeric claims. */
    analystConclusion: [{
      text: validatedReactions.length >= 2 && sources.length >= 3
        ? `"${subject}" is ready as a multi-source, multi-symbol event signal. Decision use stays bound to the attached market reactions and evidence.`
        : `"${subject}" is not ready for decision use yet; bundle has ${validatedReactions.length} validated symbol${validatedReactions.length === 1 ? '' : 's'} and ${sources.length} source${sources.length === 1 ? '' : 's'}. Triage: expand source coverage, then re-run.`,
      confidence: validatedReactions.length >= 2 && sources.length >= 3 ? 'medium' : 'low',
      ...refsFor(bundle),
    }],
    evidenceSynthesis: null,
    timeline: null,
    alternativeExplanations: null,
    informationGaps: null,
    sourceQueries: null,
    analystNotes: [{
      text: 'Typed analyst frame: event-specific read using cluster size, source breadth, and market-response strength.',
      ...refsFor(bundle),
    }],
  };
}

/* ============================================================
 *  SYMBOL SIGNAL REPORT
 * ============================================================ */

export function buildSymbolAnalystSections(bundle) {
  const sym = bundle.metadata?.sensitivity || {};
  const ticker = sym.symbol || bundle.subject?.displayName || 'this symbol';
  const theme = sym.theme || 'unknown';
  const zscore = num(sym.sensitivity_zscore);
  const sample = num(sym.sample_size);
  const sampleCount = sample ?? 0;
  const avgReturn = num(sym.avg_return);
  const baselineReturn = num(sym.baseline_return);
  const overfit = bundle.metadata?.diagnosticSignals?.hasOverfitRisk;

  let stance = 'neutral';
  if (zscore !== null && zscore > 1) stance = 'positive exposure';
  else if (zscore !== null && zscore < -1) stance = 'negative exposure';

  return {
    keyJudgments: [
      {
        text: `${ticker} exposure to ${theme}: sensitivity score ${fmtNum(zscore, 2)}, average return ${fmtPct(avgReturn, 2)}, baseline return ${fmtPct(baselineReturn, 2)}, and ${sampleCount} observations. Stance: ${stance}.`,
        confidence: sampleCount >= 30 ? 'medium' : 'low',
        ...refsFor(bundle),
      },
      sampleCount < 10 ? {
        text: 'Observation count is below 10; the sensitivity score is exploratory, not a regime statistic. Treat it as candidate evidence.',
        confidence: 'low',
        ...refsFor(bundle),
      } : null,
    ].filter(Boolean),
    thesis: [{
      text: `${ticker}: ${stance === 'positive exposure' ? `useful positive exposure proxy for ${theme} when the sensitivity score remains positive with a growing observation base` : stance === 'negative exposure' ? `useful inverse exposure candidate for ${theme}; verify the negative correlation is not a defensive-asset coincidence` : `not currently a useful proxy for ${theme}; the sensitivity score remains inside the noise band`}. ${overfit ? 'Overfit caveat applies.' : ''}`,
      confidence: sampleCount >= 30 ? 'medium' : 'low',
      stance,
      ...refsFor(bundle),
    }],
    whatChanged: [
      { text: `Sensitivity review updated ${sym.updated_at ? new Date(sym.updated_at).toISOString().slice(0, 10) : 'unknown'}; horizon is ${sym.horizon || '?'}, hit rate is ${fmtNum(sym.hit_rate, 2)}, and return volatility is ${fmtNum(sym.return_vol, 2)}.`, ...refsFor(bundle) },
    ],
    catalysts: null,
    marketTransmission: asArray(bundle.marketReactions).slice(0, 3).map((r) => ({
      text: `${r.symbol} in the ${r.eventWindow || 'event'} window: ${fmtPct(r.relativeReturnPct, 2)} average relative return, t-stat ${fmtNum(r.tStat, 2)}.`,
      ...refsFor(bundle),
      reactionId: r.reactionId,
    })),
    scenarios: [
      { label: 'Upside case', text: `${ticker} observations grow above 30 with a stable sensitivity sign, and hit rate stays above 0.55: escalate to a validated research proxy.`, ...refsFor(bundle) },
      { label: 'Downside case', text: `Sign flips period-over-period or observations stay below 10: proxy is unreliable.`, ...refsFor(bundle) },
      { label: 'Invalidator', text: `Theme-symbol mapping changes after refresh and the sensitivity score drops to the noise band, or the symbol's theme relevance is structurally broken by sector reclassification.`, ...refsFor(bundle) },
    ],
    risks: [
      { text: `Theme-symbol path may be coincidental: ${ticker} could be moving on factors unrelated to ${theme} (interest rates, dollar, commodity prices). Validate with a regime-conditioning check.`, ...refsFor(bundle) },
      { text: `Liquidity, sector beta, and index-factor exposure can dominate the theme signal; require repeated confirmation before treating ${ticker} as a clean proxy.`, ...refsFor(bundle) },
      overfit ? { text: 'Overfit flag: regime multiplier is above 5 with a low observation count. Treat the multiplier as statistical noise.', ...refsFor(bundle) } : null,
    ].filter(Boolean),
    analyticalAssessment: [{
      text: `${ticker} as a ${theme} proxy is useful only if the sign is stable across regimes, observations exceed 30, and hit rate stays above 0.55. Without all three, treat it as candidate evidence.`,
      ...refsFor(bundle),
    }],
    watchNext: [{
      text: `Watch observation growth and sensitivity-score stability over the next 4 weeks. Crossing 30 observations with an absolute sensitivity score above 1 promotes the signal to validated proxy review.`,
      claimIds: [bundle.claims?.[0]?.claimId].filter(Boolean), evidenceIds: [], metricIds: [], figureIds: [], caveatIds: [],
    }],
    decisionUse: null, analystConclusion: null, timeline: null,
    alternativeExplanations: null, informationGaps: null, sourceQueries: null,
    analystNotes: [{ text: 'Typed analyst frame: stance-driven exposure read with explicit invalidators.', ...refsFor(bundle) }],
  };
}

/* ============================================================
 *  CROSS-THEME BOTTLENECK REPORT
 * ============================================================ */

export function buildCrossThemeAnalystSections(bundle) {
  const cand = bundle.metadata?.candidate || {};
  const name = cand.supplier_name || cand.connector_name || bundle.subject?.displayName || 'this candidate';
  const candidateThemes = asArray(cand.themes).filter(Boolean);
  const subjectMetadataThemes = asArray(bundle.subject?.metadata?.themes).filter(Boolean);
  const subjectThemes = asArray(bundle.subject?.themes).filter(Boolean);
  const adjacentThemes = asArray(bundle.metadata?.adjacentCandidate?.metadata?.themes).filter(Boolean);
  const themes = unique((
    candidateThemes.length ? candidateThemes
      : subjectMetadataThemes.length ? subjectMetadataThemes
        : adjacentThemes.length ? adjacentThemes
          : subjectThemes
  ).map(humanizeThemeIdentifier).filter(Boolean));
  const score = num(cand.score);
  const summary = cand.evidence_summary || {};
  const seedSim = num(summary.seedSimilarity);
  const sourceDiversity = num(summary.sourceDiversity);
  const evidenceQuality = num(summary.evidenceQuality);
  const discovery = cand.discovery || summary.discovery || bundle.metadata?.discovery || {};
  const discoveryRole = humanizeIdentifier(discovery.role || cand.metadata?.role || 'bottleneck');
  const discoveryFit = num(cand.discoveryFit ?? summary.discoveryFit ?? discovery.discoveryFit);
  const constraintCriticality = num(cand.constraintCriticality ?? summary.constraintCriticality ?? discovery.constraintScore);
  const geopoliticalRelevance = num(cand.geopoliticalRelevance ?? summary.geopoliticalRelevance ?? discovery.geopoliticalRelevance);
  const mechanism = discovery.mechanism || `${name} may be an intermediate dependency shared by ${themes.join(', ') || 'multiple themes'}`;
  const whyNow = discovery.whyNow || 'the candidate sits where theme attention, technical dependency, and supply-chain evidence should be tested together';
  const triggers = asArray(discovery.triggerTerms).slice(0, 5);
  const sourceQueries = buildCrossThemeSourceQueryEntries({ discovery, cand, name, themes });
  const status = cand.status || 'new';
  const themeText = themes.join(', ') || 'multiple themes';

  return {
    keyJudgments: [
      {
        text: `${name} is best read as a ${discoveryRole} discovery candidate across ${themeText}, not as a finished canonical theme. The practical question is whether it is a real shared dependency that can constrain multiple themes at once, or only a graph adjacency that happens to sit near them.`,
        confidence: status === 'accepted' ? 'medium' : 'low',
        ...refsFor(bundle),
      },
      {
        text: `The discovery read is strongest when constraint criticality, independent support, and theme overlap line up. Here the system sees discovery fit ${fmtNum(discoveryFit, 2)}, constraint criticality ${fmtNum(constraintCriticality, 2)}, geopolitical relevance ${fmtNum(geopoliticalRelevance, 2)}, and source breadth ${fmtNum(sourceDiversity, 2)}; that is enough for analyst follow-up, but not enough for canonical promotion without direct evidence.`,
        confidence: 'medium',
        ...refsFor(bundle),
      },
    ],
    thesis: [{
      text: `${name} should be evaluated as a possible bottleneck thesis: ${mechanism}. The useful analyst frame is not whether the name appears in two theme graphs; it is whether demand, policy, technical requirements, or supplier capacity can make this node matter at the same time for ${themeText}.`,
      confidence: status === 'accepted' ? 'medium' : 'low',
      stance: status === 'accepted' ? 'validated-bottleneck-review' : 'discovery-candidate',
      ...refsFor(bundle),
    }],
    whatChanged: [
      { text: `The candidate now carries an explicit discovery role instead of only a relationship score. That matters because a ${discoveryRole} candidate asks a different question from a generic theme link: whether one input, process, supplier, or infrastructure layer can become the limiting variable for several themes at once.`, ...refsFor(bundle) },
    ],
    catalysts: [
      { text: `Why now: ${whyNow}. The strongest catalyst would be evidence that the same constraint appears in procurement, capacity, technical, or supplier commentary rather than only in theme co-mentions.`, ...refsFor(bundle) },
      triggers.length ? { text: `Trigger terms to monitor: ${triggers.join(', ')}. These should be used as watch terms, not as proof by themselves.`, ...refsFor(bundle) } : null,
    ].filter(Boolean),
    dataDepth: [
      {
        text: `The current evidence stack is still discovery-grade. Candidate score ${fmtNum(score, 2)} ranks the idea for review, while evidence support ${fmtNum(evidenceQuality, 2)} and source breadth ${fmtNum(sourceDiversity, 2)} decide whether it can move beyond watch status. A high discovery fit without independent support should generate source queries, not a finished conclusion.`,
        ...refsFor(bundle),
      },
    ],
    causalChain: [
      {
        text: `The causal chain to test is: theme demand or policy shock -> ${name} as ${discoveryRole} -> capacity, substitution, or supplier pressure -> affected themes and exposed issuers. The chain is useful because it tells the analyst what evidence would prove or disprove the bottleneck, rather than merely showing that two themes share vocabulary.`,
        ...refsFor(bundle),
      },
    ],
    evidenceSynthesis: [
      {
        text: `This is a practical discovery memo only if it separates four classes of evidence: direct supplier or component evidence, policy or geopolitical trigger evidence, technical feasibility evidence, and market visibility. Missing any one class does not kill the idea, but it should keep the candidate review-gated.`,
        ...refsFor(bundle),
      },
    ],
    marketTransmission: asArray(bundle.marketReactions).slice(0, 3).map((r) => ({
      text: `${r.symbol}: ${fmtPct(r.relativeReturnPct, 2)} average relative return, multiplier ${fmtNum(r.uplift, 2)}.`,
      ...refsFor(bundle),
      reactionId: r.reactionId,
    })),
    scenarios: [
      { label: 'Upgrade case', text: `Upgrade the candidate if independent evidence shows ${name} is capacity-constrained, hard to substitute, and relevant to at least two mapped themes through different source groups. That would move the memo from discovery watch to reviewed promotion queue.`, ...refsFor(bundle) },
      { label: 'Base case', text: `Keep it as a discovery candidate if the evidence stays plausible but indirect. In that state, ${name} is useful for source targeting and analyst follow-up, not for final thesis promotion.`, ...refsFor(bundle) },
      { label: 'Invalidator', text: `Downgrade the candidate if new evidence shows easy substitutes, broad supplier redundancy, or no direct operating dependency across the mapped themes. That would make the idea adjacency rather than bottleneck.`, ...refsFor(bundle) },
    ],
    risks: [
      { text: `The main risk is adjacency masquerading as dependency. A candidate can be near several themes because it is a common word, supplier, or technology layer; the proof burden is showing that it constrains outcomes, timing, or economics.`, ...refsFor(bundle) },
      { text: seedSim !== null && seedSim > 0.35
        ? `Seed-lock remains material: seed similarity is ${fmtNum(seedSim, 2)}, so the system should prioritize evidence that was not implied by the original seed vocabulary.`
        : `Seed-lock is controlled but not eliminated: seed similarity is ${fmtNum(seedSim, 2)}, so independent source expansion still matters.`,
      ...refsFor(bundle) },
    ],
    analyticalAssessment: [{
      text: `${name} is useful if it changes what the analyst does next: search for capacity, substitution, supplier concentration, policy dependence, and technical qualification evidence. If the next cycle cannot find those links, the candidate should stay in the backlog even if the surface score remains high.`,
      ...refsFor(bundle),
    }],
    watchNext: [{
      text: `Watch for direct evidence that ${name} is becoming tight, funded, qualified, regulated, or hard to substitute. Independent supply, capacity, procurement, or technical-qualification evidence is stronger than another generic theme mention.`,
      claimIds: [bundle.claims?.[0]?.claimId].filter(Boolean), evidenceIds: [], metricIds: [], figureIds: [], caveatIds: [],
    }],
    sourceQueries: sourceQueries.map((entry) => ({
      text: `Open source query: ${entry.query}`,
      claimIds: [bundle.claims?.[0]?.claimId].filter(Boolean), evidenceIds: [], metricIds: [], figureIds: [], caveatIds: [],
      approvalRequired: true,
      metadata: {
        gapKind: 'cross_theme_discovery',
        desiredEvidenceClass: entry.desiredEvidenceClass,
        evidenceClass: entry.desiredEvidenceClass,
        query: entry.query,
        candidateId: cand.id ? String(cand.id) : bundle.subject?.subjectId || null,
        candidateThemes: themes,
        connector: cand.connector || name,
        supplier: cand.supplier || null,
        issuerHints: crossThemeIssuerHints({ query: entry.query, name, themes }),
        acceptanceCriteria: crossThemeAcceptanceCriteria(entry.desiredEvidenceClass),
        promotionEligible: entry.desiredEvidenceClass !== 'negative_control',
      },
    })),
    decisionUse: null, analystConclusion: null, timeline: null,
    alternativeExplanations: null, informationGaps: null,
    analystNotes: [{ text: 'Typed analyst frame: bottleneck-versus-adjacency read with explicit supply-chain context.', ...refsFor(bundle) }],
  };
}

/* ============================================================
 *  Top-level dispatch
 * ============================================================ */
export function buildTypedAnalystSections(bundle) {
  if (!bundle?.reportType) return null;
  if (bundle.reportType === 'theme_report') return buildThemeAnalystSections(bundle);
  if (bundle.reportType === 'event_signal_report') return buildEventAnalystSections(bundle);
  if (bundle.reportType === 'symbol_signal_report') return buildSymbolAnalystSections(bundle);
  if (bundle.reportType === 'cross_theme_bottleneck_report') return buildCrossThemeAnalystSections(bundle);
  return null;
}
