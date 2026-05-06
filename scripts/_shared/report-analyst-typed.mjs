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
      text: `${subject} aggregate row reports article_count=${articleCount} but ${eventCount} canonical events fired in the last 30 days (${surgeCount} surge${surgeCount === 1 ? '' : 's'}). Read the aggregate as stale; trust the event timeline and recent evidence ledger instead.`,
      confidence: 'medium',
      ...refsFor(bundle),
    });
  } else if (subtopic) {
    judgments.push({
      text: `${subject} sits at lifecycle stage "${subtopic.lifecycle_stage || 'unknown'}" with momentum_score=${fmtNum(subtopic.momentum_score, 0)} and acceleration ${fmtPct(subtopic.acceleration, 0)}. The aggregate-level read is ${fmtPct(yoy, 0)} YoY on ${articleCount ?? '?'} articles this period.`,
      confidence: 'medium',
      ...refsFor(bundle),
    });
  } else {
    judgments.push({
      text: `${subject} aggregate this period: ${articleCount ?? '?'} articles, YoY ${fmtPct(yoy, 0)}, acceleration ${fmtPct(acceleration, 0)}. ${recentEvidence || 0} recent evidence items attached.`,
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
      if (positiveTickers.length) parts.push(`positive-zscore: ${positiveTickers.join(', ')}`);
      if (negativeTickers.length) parts.push(`negative-zscore: ${negativeTickers.join(', ')}`);
      judgments.push({
        text: `Symbol exposure (${peerCounts.total} candidates in stock_sensitivity_matrix): ${parts.join('; ')}. Treat zscore<1 candidates as noise.`,
        confidence: 'medium',
        ...refsFor(bundle),
      });
    }
  } else {
    judgments.push({
      text: `No symbols in stock_sensitivity_matrix for this theme. Market linkage cannot be validated from the current bundle — recommend running auto-pipeline for symbol coverage.`,
      confidence: 'low',
      ...refsFor(bundle),
    });
  }

  /* Judgment 3 — knowledge graph reach */
  const conns = ctx.knowledgeConnections || [];
  if (conns.length) {
    const top = conns.slice(0, 3).map((c) => `${c.entityName} (${c.relationType}, conf ${fmtNum(c.confidence, 2)})`);
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
    stance = 'bearish-on-attention';
    reasons.push(`subtopic in declining lifecycle (momentum ${fmtNum(subtopic?.momentum_score, 0)})`);
  } else if (subtopic?.lifecycle_stage === 'accelerating' || (num(subtopic?.momentum_score) ?? 0) > 50) {
    stance = 'bullish-on-attention';
    reasons.push(`subtopic in accelerating lifecycle (momentum ${fmtNum(subtopic?.momentum_score, 0)})`);
  }
  if (recentSurge) reasons.push(`event ${recentSurge.eventId} on ${recentSurge.eventDate?.slice(0, 10)} flagged as surge`);
  if (peerN === 0) reasons.push('no validated symbol exposure in stock_sensitivity_matrix');
  if (orphanFlag) reasons.push('aggregate row is orphaned — distrust the multipliers');

  const reasonText = reasons.length ? reasons.join('; ') : 'baseline stance — no strong directional signal in the bundle';
  return [{
    text: `${subject}: working stance is ${stance} (${reasonText}). The bull case requires sustained article volume + new positive-zscore peer symbols. The bear case is the current state — declining or stagnant attention with no symbol confirmation. Invalidator: a single regime period of >30 article days with positive multi-source coverage AND at least 2 positive-zscore peers above sample_size=30.`,
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

  /* Top events — specific-citation (each event's own row, no bundle-wide attach) */
  events.slice(0, 4).forEach((event) => {
    const date = event.eventDate?.slice(0, 10) || 'unknown';
    const surge = event.isSurge ? ' (SURGE)' : '';
    const wire = event.wireDominated ? ', wire-dominated' : '';
    const sources = event.sourceCount;
    blocks.push({
      text: `${date}: "${event.title}" — ${event.articleCount} article${event.articleCount === 1 ? '' : 's'}, ${sources} source${sources === 1 ? '' : 's'}${wire}, hawkes ${fmtNum(event.hawkesIntensity, 2)}${surge}`,
      ...refsFor(bundle, { specific: true, metricIds: ['MET-EVENT-TIMELINE-COUNT'] }),
      eventRef: event.eventId,
    });
  });

  if (!blocks.length) {
    blocks.push({
      text: 'No canonical events recorded in the last 30 days for this theme. Either coverage is genuinely quiet or article→event clustering has not run.',
      ...refsFor(bundle),
    });
  }

  /* Subtopic shifts — specific-citation */
  subtopics.slice(0, 3).forEach((subtopic) => {
    if (subtopic.lifecycle_stage && subtopic.theme_label) {
      blocks.push({
        text: `Subtopic "${subtopic.theme_label}": rank ${subtopic.rank_in_parent} in parent theme "${subtopic.parent_theme}", lifecycle ${subtopic.lifecycle_stage}, momentum ${fmtNum(subtopic.momentum_score, 0)}, accel ${fmtPct(subtopic.acceleration, 0)}.`,
        ...refsFor(bundle, { specific: true, metricIds: ['MET-SUBTOPIC-COUNT'] }),
      });
    }
  });

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
      text: `Catalyst lane: ${subject} ${top.relationType} ${top.entityName} (${top.entityType}, evidence_count=${top.evidenceCount}, source_diversity=${top.sourceDiversity}, confidence=${fmtNum(top.confidence, 2)}). Watch ${top.entityName} for theme-specific reads.`,
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
    const observations = top.regimes.map((r) => `${r.regime}/${r.horizon}(mult ${fmtNum(r.regime_multiplier, 2)}, n=${r.sample_size})`).join('; ');
    blocks.push({
      text: distinctRegimes >= 2
        ? `Regime-conditional play: ${top.symbol} responds differently across regimes — ${observations}. Transmission strength is regime-dependent.`
        : `Horizon-conditional play: ${top.symbol} multipliers differ across horizons within the ${top.regimes[0]?.regime} regime — ${observations}. Same regime, but the holding-period response is non-flat.`,
      ...refsFor(bundle),
    });
  }

  /* Catalyst 3: hawkes surge */
  const surge = (ctx.events || []).find((e) => e.isSurge);
  if (surge) {
    blocks.push({
      text: `Hawkes surge: event ${surge.eventId} on ${surge.eventDate?.slice(0, 10)} fired with intensity ${fmtNum(surge.hawkesIntensity, 2)}. Self-exciting clustering means follow-on coverage is more likely in the next 7-14 days.`,
      ...refsFor(bundle),
    });
  }

  if (!blocks.length) {
    blocks.push({
      text: `No clear catalyst signals in the bundle. Knowledge graph: ${conns.length} edges. Regime breadth: ${regimeBy.length} symbols. Run incremental-event-engine if catalysts are expected but missing.`,
      ...refsFor(bundle),
    });
  }
  return blocks.slice(0, 3);
}

function buildThemeMarketTransmission(bundle) {
  const reactions = asArray(bundle.marketReactions);
  if (!reactions.length) {
    return [{
      text: 'No market reactions in the bundle — theme has no measured asset transmission. Treat market commentary as out of scope for this report.',
      ...refsFor(bundle),
    }];
  }
  return reactions.slice(0, 5).map((r) => {
    const sample = (r.controls || []).find((c) => /sample_size/.test(c)) || 'sample_size=?';
    const validation = r.validationStatus || 'candidate';
    return {
      text: `${r.symbol}: ${fmtPct(r.relativeReturnPct, 2)} avg return, t-stat ${fmtNum(r.tStat, 2)}, ${sample}. Status: ${validation}. ${validation === 'validated' ? 'Multi-period sample — usable as proxy.' : 'Below validation threshold — read as candidate exposure.'}`,
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
      label: 'Bull case',
      text: `Sustained article volume returns (>30 articles/period for 2+ consecutive periods), at least 2 positive-zscore peer symbols emerge above sample_size=30, and Hawkes intensity remains elevated (>0.5) — escalate to active watchlist with allocated tracking budget.`,
      ...refsFor(bundle),
    },
    {
      label: 'Bear case',
      text: `Current state extended (peer count stays ${peerN}, event count stays ${eventN}/30d, lifecycle remains declining) — theme remains in the discovery layer; no symbol-level decision use is justified.`,
      ...refsFor(bundle),
    },
    {
      label: 'Inflection invalidator',
      text: `What flips the call: (1) a single canonical event with 3+ source clusters AND article_count >= 10, (2) multi-regime appearance of any symbol with consistent zscore sign, (3) cross-theme connector candidate validates ${subject} as a bottleneck for an adjacent theme.`,
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
      text: 'Aggregate orphan: theme_trend_aggregates row reports zero articles but non-zero YoY/acceleration/novelty. The aggregate was not refreshed against the current article→theme mapping. Discount the aggregate; trust the event timeline.',
      ...refsFor(bundle),
    });
  }
  if (evidenceMismatchFlag) {
    blocks.push({
      text: 'Evidence-aggregate mismatch: recent_evidence_items > 0 but aggregate window article_count = 0. The two metrics live on different windows; do not treat the recent evidence as "this period" data.',
      ...refsFor(bundle),
    });
  }
  if (overfitFlag) {
    blocks.push({
      text: 'Overfit risk: at least one peer symbol has |multiplier| > 5 with sample_size < 10. Below n=10 the multiplier is statistical noise, not regime conditioning.',
      ...refsFor(bundle),
    });
  }
  /* Generic risks */
  blocks.push({
    text: 'Source concentration risk: when source_diversity < 0.4 or one publisher dominates, a coordinated wire push can manufacture apparent volume without independent confirmation.',
    ...refsFor(bundle),
  });
  blocks.push({
    text: 'Knowledge graph candidate risk: deterministic-phrase relation extraction over-produces low-confidence edges. Treat conf<0.7 edges as research candidates, not facts.',
    ...refsFor(bundle),
  });
  return blocks.slice(0, 4);
}

function buildThemeAnalyticalAssessment(bundle) {
  const ctx = bundle.metadata?.themeContext || {};
  const subject = bundle.subject?.displayName || 'This theme';
  return [
    {
      text: `${subject} is read through three lenses: (a) attention pulse — articles + Hawkes + subtopic momentum, (b) symbol transmission — stock_sensitivity_matrix peers segmented by zscore sign, (c) graph adjacency — knowledge_edges to component / supplier / technology entities. The strongest evidence is whichever lens has the largest fresh sample.`,
      ...refsFor(bundle),
    },
    {
      text: ctx.peerSymbols?.counts?.total
        ? `The peer symbol set (${ctx.peerSymbols.counts.total} symbols, ${ctx.peerSymbols.counts.positive} positive, ${ctx.peerSymbols.counts.negative} negative) is the most actionable lens. Watch the sign-asymmetry: if negative dominates, the theme is risk-off correlated.`
        : `The peer symbol lens is empty. Until stock_sensitivity_matrix has rows for this theme, market-linkage statements should be deferred.`,
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
      text: `Watch subtopic "${subtopic.theme_label}" rank in parent — drop below rank ${subtopic.rank_in_parent + 2} signals deceleration; rise above rank ${Math.max(1, subtopic.rank_in_parent - 2)} signals acceleration.`,
      claimIds: [bundle.claims?.[0]?.claimId].filter(Boolean),
      evidenceIds: [], metricIds: [], figureIds: [], caveatIds: [],
    });
  }
  /* Knowledge entity watch */
  const conns = (ctx.knowledgeConnections || []).slice(0, 3);
  conns.forEach((conn) => {
    blocks.push({
      text: `Watch ${conn.entityName} (${conn.entityType}) — its independent news flow ${conn.relationType === 'requires' ? 'directly affects' : 'co-moves with'} the theme.`,
      claimIds: [bundle.claims?.[0]?.claimId].filter(Boolean),
      evidenceIds: [], metricIds: [], figureIds: [], caveatIds: [],
    });
  });
  /* Existing watch indicators */
  for (const w of asArray(bundle.watchIndicators).slice(0, 2)) {
    blocks.push({
      text: w.label,
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
        ? 'P3 typed prose: aggregate orphan detected — prose discounts theme_trend_aggregates and prefers event timeline + knowledge graph as the primary read.'
        : 'P3 typed prose: subject-specific reads from themeContext (subtopics, peers, knowledge edges, events). Phase 4 will add Codex narrative synthesis.',
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
      text: `"${subject}" (event ${eventId}): ${articleEvidence.length} article${articleEvidence.length === 1 ? '' : 's'} from ${sources.length} source${sources.length === 1 ? '' : 's'} (${sourceList}${sources.length > 3 ? ' …' : ''}). ${reactions.length} market reaction${reactions.length === 1 ? '' : 's'} attached, ${validatedReactions.length} validated.`,
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
      text: 'No |t|>1.5 in attached market reactions. Event is news-grade but not yet decision-grade for asset selection.',
      confidence: 'low',
      ...refsFor(bundle),
    });
  }
  const thesis = [{
    text: `"${subject}": the event is decision-relevant if (a) market reaction is multi-symbol with consistent sign and "|t-stat|>1.5", (b) the article cluster spans 3+ independent sources, (c) follow-on events appear within 7 days. Current bundle: ${validatedReactions.length} validated symbols, ${sources.length} sources.`,
    confidence: validatedReactions.length >= 2 && sources.length >= 3 ? 'medium' : 'low',
    ...refsFor(bundle),
  }];
  return {
    keyJudgments,
    thesis,
    whatChanged: [{
      text: `Event fired: "${subject}" with ${articleEvidence.length} attached articles. Top source: "${sources[0] || 'unknown'}".`,
      ...refsFor(bundle, { specific: true }),
    }],
    catalysts: tStatList.length ? [{
      text: `Catalyst: significant uplift in ${reactions.filter((r) => num(r.tStat) && Math.abs(num(r.tStat)) > 1.5).slice(0, 3).map((r) => r.symbol).join(', ')}.`,
      ...refsFor(bundle),
    }] : null,
    marketTransmission: reactions.slice(0, 5).map((r) => ({
      text: `${r.symbol}: ${fmtPct(r.relativeReturnPct, 2)} alpha, t=${fmtNum(r.tStat, 2)}, n_controls=${(r.controls || []).find((c) => /n_controls/.test(c))?.split('=')[1] || '?'}, ${r.validationStatus}.`,
      ...refsFor(bundle),
      reactionId: r.reactionId,
    })),
    scenarios: [
      { label: 'Bull case', text: `Follow-on events appear within 7 days, source breadth expands beyond ${sources.length}, validated symbol count rises above ${validatedReactions.length}. Event becomes a thesis driver.`, ...refsFor(bundle) },
      { label: 'Bear case', text: `No follow-on events; validated symbols stay at ${validatedReactions.length}. Event becomes a one-shot news item without lasting transmission.`, ...refsFor(bundle) },
      { label: 'Invalidator', text: `Reverse uplift in next 14 days OR a competing event with stronger evidence on the same theme. Either flips the read from "active signal" to "noise candidate".`, ...refsFor(bundle) },
    ],
    risks: [
      { text: `Single-source risk: ${sources.length === 1 ? 'YES — only one publisher in the cluster.' : 'manageable — ' + sources.length + ' sources.'}`, ...refsFor(bundle) },
      { text: `Sample-size risk: market reactions on n_controls < 30 are exploratory; multipliers are unreliable.`, ...refsFor(bundle) },
    ],
    analyticalAssessment: [{
      text: `Read this event through 3 questions: (1) is the article cluster real (sources, freshness)? (2) is the asset response measurable (t-stat, sample)? (3) does the event fit a known causal frame (theme + supplier/component path)? Affirmative on all 3 = decision-grade.`,
      ...refsFor(bundle),
    }],
    watchNext: [{
      text: `Watch for follow-on canonical_events on the same theme in the next 7 to 14 days; Hawkes self-excitation predicts continued clustering.`,
      claimIds: [bundle.claims?.[0]?.claimId].filter(Boolean), evidenceIds: [], metricIds: [], figureIds: [], caveatIds: [],
    }],
    decisionUse: null,
    /* Override analystConclusion to wrap event title in quotes — titles can
     * contain numeric tokens (e.g. "404 Media") that the validator would
     * otherwise flag as unknown numeric claims. */
    analystConclusion: [{
      text: validatedReactions.length >= 2 && sources.length >= 3
        ? `"${subject}" is ready as a multi-source, multi-symbol event signal. Decision use stays bound to the attached market reactions and evidence ledger.`
        : `"${subject}" is not ready for decision use yet — bundle has ${validatedReactions.length} validated symbol${validatedReactions.length === 1 ? '' : 's'} and ${sources.length} source${sources.length === 1 ? '' : 's'}. Triage: expand source coverage, then re-run.`,
      confidence: validatedReactions.length >= 2 && sources.length >= 3 ? 'medium' : 'low',
      ...refsFor(bundle),
    }],
    evidenceSynthesis: null,
    timeline: null,
    alternativeExplanations: null,
    informationGaps: null,
    sourceQueries: null,
    analystNotes: [{
      text: 'P3 typed prose: event-specific frame (cluster size + source breadth + t-stat). Phase 4 Codex synthesis adds the narrative voice.',
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
  const avgReturn = num(sym.avg_return);
  const baselineReturn = num(sym.baseline_return);
  const overfit = bundle.metadata?.diagnosticSignals?.hasOverfitRisk;

  let stance = 'neutral';
  if (zscore !== null && zscore > 1) stance = 'positive-exposure';
  else if (zscore !== null && zscore < -1) stance = 'negative-exposure';

  return {
    keyJudgments: [
      {
        text: `${ticker} ↔ ${theme}: zscore ${fmtNum(zscore, 2)}, avg_return ${fmtPct(avgReturn, 2)}, baseline ${fmtPct(baselineReturn, 2)}, n=${sample}. Stance: ${stance}.`,
        confidence: sample >= 30 ? 'medium' : 'low',
        ...refsFor(bundle),
      },
      sample < 10 ? {
        text: 'Sample size below 10 — the sensitivity z-score is exploratory, not a regime statistic. Treat as candidate.',
        confidence: 'low',
        ...refsFor(bundle),
      } : null,
    ].filter(Boolean),
    thesis: [{
      text: `${ticker}: ${stance === 'positive-exposure' ? `useful long proxy for ${theme} when zscore stays >1 with growing n` : stance === 'negative-exposure' ? `useful short / hedge proxy for ${theme}; verify the negative correlation isn't a defensive-asset coincidence` : `not currently a useful proxy for ${theme} — zscore inside [-1, 1] noise band`}. ${overfit ? 'Overfit caveat applies.' : ''}`,
      confidence: sample >= 30 ? 'medium' : 'low',
      stance,
      ...refsFor(bundle),
    }],
    whatChanged: [
      { text: `Sensitivity row updated ${sym.updated_at ? new Date(sym.updated_at).toISOString().slice(0, 10) : 'unknown'}; horizon=${sym.horizon || '?'}, hit_rate=${fmtNum(sym.hit_rate, 2)}, return_vol=${fmtNum(sym.return_vol, 2)}.`, ...refsFor(bundle) },
    ],
    catalysts: null,
    marketTransmission: asArray(bundle.marketReactions).slice(0, 3).map((r) => ({
      text: `${r.symbol} window=${r.eventWindow}: ${fmtPct(r.relativeReturnPct, 2)} avg, t=${fmtNum(r.tStat, 2)}.`,
      ...refsFor(bundle),
      reactionId: r.reactionId,
    })),
    scenarios: [
      { label: 'Bull case', text: `${ticker} sample grows above 30 with stable zscore sign, hit_rate stays above 0.55 — escalate to validated proxy.`, ...refsFor(bundle) },
      { label: 'Bear case', text: `Sign flips period-over-period or sample stays below 10 — proxy is unreliable.`, ...refsFor(bundle) },
      { label: 'Invalidator', text: `Theme-symbol mapping changed (auto-pipeline rerun) and zscore drops to noise band, OR symbol's theme-relevance is structurally broken (sector reclassification).`, ...refsFor(bundle) },
    ],
    risks: [
      { text: `Theme-symbol path may be coincidental: ${ticker} could be moving on factors unrelated to ${theme} (interest rates, dollar, commodity prices). Validate with regime_conditional_impact.`, ...refsFor(bundle) },
      overfit ? { text: 'Overfit flag: regime_multiplier > 5 with low sample. Multiplier is statistical noise.', ...refsFor(bundle) } : null,
    ].filter(Boolean),
    analyticalAssessment: [{
      text: `${ticker} as a ${theme} proxy is useful only if (a) sign is stable across regimes, (b) sample > 30, (c) hit_rate > 0.55. Without all three, treat as candidate.`,
      ...refsFor(bundle),
    }],
    watchNext: [{
      text: `Watch sample_size growth and zscore stability over next 4 weeks. Crossing n=30 with |zscore|>1 promotes to validated proxy.`,
      claimIds: [bundle.claims?.[0]?.claimId].filter(Boolean), evidenceIds: [], metricIds: [], figureIds: [], caveatIds: [],
    }],
    decisionUse: null, analystConclusion: null, evidenceSynthesis: null, timeline: null,
    alternativeExplanations: null, informationGaps: null, sourceQueries: null,
    analystNotes: [{ text: 'P3 typed prose: stance-driven (positive/negative/neutral exposure) with explicit invalidators.', ...refsFor(bundle) }],
  };
}

/* ============================================================
 *  CROSS-THEME BOTTLENECK REPORT
 * ============================================================ */

export function buildCrossThemeAnalystSections(bundle) {
  const cand = bundle.metadata?.candidate || {};
  const name = cand.supplier_name || cand.connector_name || bundle.subject?.displayName || 'this candidate';
  const themes = asArray(cand.themes);
  const score = num(cand.score);
  const summary = cand.evidence_summary || {};
  const seedSim = num(summary.seedSimilarity);
  const sourceDiversity = num(summary.sourceDiversity);
  const evidenceQuality = num(summary.evidenceQuality);
  const status = cand.status || 'new';

  return {
    keyJudgments: [
      {
        text: `${name} as cross-theme connector: themes=[${themes.join(', ')}], score=${fmtNum(score, 2)}, status=${status}, evidence_quality=${fmtNum(evidenceQuality, 2)}, source_diversity=${fmtNum(sourceDiversity, 2)}, seed_similarity=${fmtNum(seedSim, 2)}.`,
        confidence: status === 'accepted' ? 'medium' : 'low',
        ...refsFor(bundle),
      },
      {
        text: seedSim !== null && seedSim > 0.7
          ? `Seed-lock risk: similarity ${fmtNum(seedSim, 2)} > 0.7 — this candidate may be a rephrase of the seed query, not an independent discovery.`
          : `Seed-lock risk acceptable: similarity ${fmtNum(seedSim, 2)} below 0.7 threshold.`,
        confidence: 'medium',
        ...refsFor(bundle),
      },
    ],
    thesis: [{
      text: `${name} ${themes.length === 2 ? `connects ${themes[0]} and ${themes[1]}` : `bridges ${themes.length} themes`}. Decide: real bottleneck (single-point dependency) vs. mere adjacency (co-mention without causal pinch). Test: does ${name} appear in supply-chain or component graphs for both themes? Bundle attaches ${asArray(bundle.evidence).length} evidence items.`,
      confidence: status === 'accepted' ? 'medium' : 'low',
      stance: status === 'accepted' ? 'validated-bottleneck' : 'candidate-only',
      ...refsFor(bundle),
    }],
    whatChanged: [
      { text: `Candidate status: ${status}, score=${fmtNum(score, 2)}, lane=${cand.lane || 'unknown'}.`, ...refsFor(bundle) },
    ],
    catalysts: [
      { text: `Catalyst structure: if ${name} is a true bottleneck, tightness in ${name}'s upstream (supply, capacity, regulation) propagates to all ${themes.length} connected themes simultaneously.`, ...refsFor(bundle) },
    ],
    marketTransmission: asArray(bundle.marketReactions).slice(0, 3).map((r) => ({
      text: `${r.symbol}: ${fmtPct(r.relativeReturnPct, 2)} avg, multiplier ${fmtNum(r.uplift, 2)}.`,
      ...refsFor(bundle),
      reactionId: r.reactionId,
    })),
    scenarios: [
      { label: 'Bull case (validate)', text: `Source diversity rises above 0.7, evidence quality crosses 0.8, ${name} appears in supply-chain database independently. Promote to canonical bottleneck.`, ...refsFor(bundle) },
      { label: 'Bear case (reject)', text: `Source diversity stays below 0.4, edge evidence remains single-source, seed similarity stays high. ${name} is co-mention adjacency, not bottleneck.`, ...refsFor(bundle) },
      { label: 'Invalidator', text: `New evidence shows ${name} has substitutes (multiple suppliers / alternative components). Bottleneck thesis collapses.`, ...refsFor(bundle) },
    ],
    risks: [
      { text: `Adjacency vs bottleneck confusion: graph proximity is not causal dependency. Verify with supply-chain or input-output data.`, ...refsFor(bundle) },
      { text: `Seed-lock: candidates discovered via embedding similarity to a seed are biased toward the seed's vocabulary. Track seedSimilarity over time.`, ...refsFor(bundle) },
    ],
    analyticalAssessment: [{
      text: `${name} clears the discovery threshold but the analyst question remains: is the connection a single-point dependency or a co-mention pattern? Decide by examining supply-chain graphs, regulatory dependencies, and substitute availability — not just news co-occurrence.`,
      ...refsFor(bundle),
    }],
    watchNext: [{
      text: `Watch ${name}'s independent news flow (separate from theme news). Independent supply or capacity news is the strongest validation.`,
      claimIds: [bundle.claims?.[0]?.claimId].filter(Boolean), evidenceIds: [], metricIds: [], figureIds: [], caveatIds: [],
    }],
    decisionUse: null, analystConclusion: null, evidenceSynthesis: null, timeline: null,
    alternativeExplanations: null, informationGaps: null, sourceQueries: null,
    analystNotes: [{ text: 'P3 typed prose: bottleneck-vs-adjacency frame. Phase 5 cross-asset graph traversal will add upstream/downstream supply-chain context.', ...refsFor(bundle) }],
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
