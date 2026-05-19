function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function subjectName(bundle = {}) {
  return bundle.subject?.displayName || bundle.subject?.subjectId || 'The subject';
}

function domainCard(signalCards = {}, domain) {
  return asArray(signalCards.cards).find((card) => card.domain === domain) || null;
}

function good(card) {
  return card && ['strong', 'medium'].includes(String(card.strength || '').toLowerCase());
}

function weak(card) {
  return !card || ['weak'].includes(String(card.strength || '').toLowerCase());
}

function refBlock(bundle = {}, cards = []) {
  const claimIds = new Set();
  const evidenceIds = new Set();
  const metricIds = new Set();
  const figureIds = new Set();
  const caveatIds = new Set();
  for (const card of cards.filter(Boolean)) {
    asArray(card.claimIds).forEach((id) => claimIds.add(id));
    asArray(card.evidenceIds).forEach((id) => evidenceIds.add(id));
    asArray(card.metricIds).forEach((id) => metricIds.add(id));
    asArray(card.figureIds).forEach((id) => figureIds.add(id));
    asArray(card.caveatIds).forEach((id) => caveatIds.add(id));
  }
  const primary = asArray(bundle.claims)[0] || {};
  if (primary.claimId) claimIds.add(primary.claimId);
  return {
    claimIds: [...claimIds].slice(0, 5),
    evidenceIds: [...evidenceIds].slice(0, 5),
    metricIds: [...metricIds].slice(0, 5),
    figureIds: [...figureIds].slice(0, 4),
    caveatIds: [...caveatIds].slice(0, 5),
  };
}

function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function buildWhatChangedBlocks(bundle = {}, cards = []) {
  const subject = subjectName(bundle);
  const ctx = bundle.metadata?.themeContext || {};
  const events = asArray(ctx.events);
  const subtopics = asArray(ctx.subtopics);
  const attention = cards.find((card) => card.domain === 'attention') || null;
  const market = cards.find((card) => card.domain === 'market') || null;
  const refs = refBlock(bundle, [attention, market]);

  if (!events.length && !subtopics.length) {
    return [{
      text: `${subject} has no attached event sequence or subtopic rotation in this bundle, so the memo should frame change as an evidence gap rather than a trend call.`,
      ...refs,
    }];
  }

  const singleSourceDominated = events.length
    ? events.filter((event) => Number(event.sourceCount || 0) <= 1).length > events.length / 2
    : false;
  const hasCanonicalEvent = events.some((event) => Number(event.articleCount || 0) >= 10 && Number(event.sourceCount || 0) >= 3);
  const hasIntensityQualifiedEvent = events.some((event) => event.isSurge && Number(event.hawkesIntensity || 0) > 0);
  const subtopicNames = subtopics
    .filter((subtopic) => subtopic.theme_label || subtopic.themeLabel)
    .slice(0, 3)
    .map((subtopic) => titleCase(subtopic.theme_label || subtopic.themeLabel));

  const coverageRead = events.length
    ? [
      singleSourceDominated
        ? `Recent ${subject} coverage remains fragmented and mostly single-source.`
        : `Recent ${subject} coverage has enough source breadth to remain on the research screen.`,
      hasCanonicalEvent
        ? 'One attached cluster may deserve follow-up as a candidate canonical event.'
        : 'The attached items do not yet combine into a multi-source canonical event.',
      hasIntensityQualifiedEvent
        ? 'There is at least one intensity-qualified surge, so follow-on coverage should be monitored.'
        : 'No attached event is intensity-qualified, so the change read should stay pattern-level rather than event-call level.',
    ].join(' ')
    : `No attached event sequence supports a fresh event call for ${subject}.`;

  const rotationRead = subtopicNames.length
    ? `Subtopic evidence points to coverage rotation around ${subtopicNames.join(', ')}; this is useful for research prioritization but not enough by itself to infer industry-cycle direction.`
    : 'No subtopic rotation is attached, so the memo should not infer breadth expansion or contraction from the current bundle.';

  return [
    {
      text: coverageRead,
      ...refs,
    },
    {
      text: rotationRead,
      ...refBlock(bundle, [attention]),
    },
  ];
}

export function buildAnalystSynthesis(bundle = {}, signalCards = {}) {
  const subject = subjectName(bundle);
  const attention = domainCard(signalCards, 'attention');
  const fundamental = domainCard(signalCards, 'fundamental');
  const market = domainCard(signalCards, 'market');
  const constraint = domainCard(signalCards, 'constraint');
  const causal = domainCard(signalCards, 'causal');
  const researchPolicy = domainCard(signalCards, 'research_policy');
  const usefulCards = asArray(signalCards.cards).filter((card) => ['strong', 'medium', 'watch'].includes(String(card.strength || '').toLowerCase()));
  const weakestCards = asArray(signalCards.cards).filter((card) => ['weak'].includes(String(card.strength || '').toLowerCase()));
  const thesisVerb = good(fundamental) || good(constraint)
    ? 'is an investable research candidate only where fundamental or constraint evidence confirms the attention signal'
    : 'is still a signal-triage candidate, not a finished investment memo';
  const attentionQualifier = attention?.metadata?.articleCount > 0 && attention.metadata.articleCount < 10
    ? 'The current sample is thin, so attention metrics cannot support a broad lifecycle call.'
    : 'Attention evidence is useful as a change detector, but it is not the same as fundamental demand.';
  const rotationFrame = weak(attention) && (good(fundamental) || good(constraint))
    ? `${subject} looks more like a narrative rotation than a thesis failure: attention is weak, while deeper packs still need to determine whether economics remain intact.`
    : `${subject} should be read through separate attention, fundamental, market, and constraint lenses rather than one blended hotness score.`;
  const marketFrame = good(market)
    ? market.interpretation
    : 'Market transmission is not decision-grade yet; price reaction should remain a screening input until event windows, benchmarks, and controls are explicit.';
  const causalFrame = good(causal)
    ? causal.interpretation
    : 'The causal map is incomplete or candidate-tier, so the memo should state hypotheses and invalidators instead of implying verified causality.';
  const weakest = weakestCards[0] || fundamental || attention;
  const strongest = usefulCards[0] || attention || fundamental || market;
  const refs = refBlock(bundle, [attention, fundamental, market, constraint, causal, researchPolicy]);
  const nextActions = [];
  if (weak(fundamental)) nextActions.push('Collect company filings, fundamentals, transcript/guidance evidence, and comparable-company context.');
  if (weak(constraint)) nextActions.push('Collect industry KPI evidence for capacity, demand, utilization, orders, or physical bottlenecks.');
  if (weak(market)) nextActions.push('Recompute market transmission with explicit event windows, benchmarks, controls, and regime splits.');
  if (weak(causal)) nextActions.push('Attach causal edges with mechanism, direction, lag, confidence, evidence, and caveats.');
  if (!nextActions.length) nextActions.push('Refresh the report after the next evidence update and compare thesis, counter-thesis, and watch triggers.');
  const whatChanged = buildWhatChangedBlocks(bundle, asArray(signalCards.cards));

  return {
    title: `${titleCase(subject)}: ${good(fundamental) || good(constraint) ? 'Evidence-Led Research Memo' : 'Signal Triage Memo'}`,
    oneSentenceThesis: `${subject} ${thesisVerb}. ${attentionQualifier}`,
    executiveView: [
      {
        text: rotationFrame,
        ...refs,
      },
      {
        text: `${marketFrame} This separates measured market correlation from causal mechanism.`,
        ...refBlock(bundle, [market, causal]),
      },
      {
        text: `The weakest link is ${weakest?.title || 'evidence depth'}: ${weakest?.interpretation || 'the bundle still needs deeper evidence before conviction rises'}`,
        ...refBlock(bundle, [weakest]),
      },
    ],
    thesis: [
      {
        text: `${subject} ${thesisVerb}. The memo should focus on whether the signal is moving from attention into economics, constraints, market reaction, or policy/research confirmation.`,
        ...refs,
      },
    ],
    whatChanged,
    strongestEvidence: [
      {
        text: `${strongest?.title || 'Evidence'} is the strongest current support: ${strongest?.interpretation || 'no strong support is attached yet'}`,
        ...refBlock(bundle, [strongest]),
      },
    ],
    weakestEvidence: [
      {
        text: `${weakest?.title || 'Evidence gap'} is the binding limitation: ${weakest?.interpretation || 'the report should not overstate the conclusion'}`,
        ...refBlock(bundle, [weakest]),
      },
    ],
    economicMechanism: [
      {
        text: `${causalFrame} The correct mechanism path is event or theme change -> economic driver -> company/sector exposure -> market reaction -> invalidator.`,
        ...refBlock(bundle, [causal, constraint, market]),
      },
    ],
    marketImplication: [
      {
        text: `${marketFrame} The report should name exposed assets only as monitored links unless validation clears the attached caveats.`,
        ...refBlock(bundle, [market]),
      },
    ],
    counterThesis: [
      {
        text: `The bearish or skeptical read is that ${subject} is an attention artifact: source breadth, fundamentals, industry KPIs, or market reactions may fail to confirm the narrative.`,
        ...refs,
      },
    ],
    invalidators: [
      {
        text: 'Invalidate a higher-conviction view if source breadth stays concentrated, core data packs remain missing, causal edges stay candidate-tier, or market reactions fail under controlled event windows.',
        ...refs,
      },
    ],
    nextResearchActions: nextActions.slice(0, 5).map((text) => ({
      text,
      ...refs,
    })),
  };
}
