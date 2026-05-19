import { loadResearchOsPolicy, requirePolicyNumber } from './research-os-policy.mjs';
import { normalizeKnowledgeKey, stableResearchOsId } from './adjacency-graph.mjs';
import { THEME_TAXONOMY } from './theme-taxonomy.mjs';

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function unique(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function questionKey(question) {
  return stableResearchOsId([
    question.questionType,
    ...(question.themes || []).map(normalizeKnowledgeKey).sort(),
    ...(question.seedTerms || []).map(normalizeKnowledgeKey).sort(),
    question.triggerReason || '',
  ]);
}

function makeQuestion(input) {
  const question = {
    questionType: input.questionType,
    themes: unique(input.themes),
    seedTerms: unique(input.seedTerms),
    prompt: input.prompt,
    triggerReason: input.triggerReason,
    noveltyScore: toNumber(input.noveltyScore),
    heatScore: toNumber(input.heatScore),
    gapScore: toNumber(input.gapScore),
    priorityScore: toNumber(input.priorityScore),
    metadata: input.metadata || {},
  };
  return { ...question, id: questionKey(question) };
}

function sortQuestions(left, right) {
  return right.priorityScore - left.priorityScore
    || right.heatScore - left.heatScore
    || right.noveltyScore - left.noveltyScore
    || left.id.localeCompare(right.id);
}

function buildStableTaxonomyTerms() {
  const terms = new Set();
  for (const [key, value] of Object.entries(THEME_TAXONOMY || {})) {
    terms.add(normalizeKnowledgeKey(key));
    terms.add(normalizeKnowledgeKey(value.label));
    terms.add(normalizeKnowledgeKey(value.category));
    if (value.parentTheme) terms.add(normalizeKnowledgeKey(value.parentTheme));
  }
  return terms;
}

function isLowQualityNovelPhrase(text, policy) {
  const key = normalizeKnowledgeKey(text);
  if (!key) return true;
  if (/^\d+$/.test(key.replace(/-/g, ''))) return true;
  if (key.length < 4) return true;
  if (buildStableTaxonomyTerms().has(key)) return true;
  const genericTerms = new Set((policy?.scoring?.genericNoise?.terms || []).map(normalizeKnowledgeKey));
  const denylist = new Set((policy?.generation?.novelPhraseDenylist || []).map(normalizeKnowledgeKey));
  return genericTerms.has(key) || denylist.has(key);
}

export function generateResearchQuestions(snapshot = {}, policy = loadResearchOsPolicy()) {
  const minHotThemeHeat = requirePolicyNumber(policy, 'generation.minHotThemeHeat');
  const minThemeMomentum = requirePolicyNumber(policy, 'generation.minThemeMomentum');
  const maxSupplierDiversityForGap = requirePolicyNumber(policy, 'generation.maxSupplierDiversityForGap');
  const minNovelPhraseCount = requirePolicyNumber(policy, 'generation.minNovelPhraseCount');
  const maxQuestions = requirePolicyNumber(policy, 'generation.maxQuestionsPerRun');
  const maxThemePairs = requirePolicyNumber(policy, 'generation.maxThemePairsPerRun');
  const hotThemeNovelty = requirePolicyNumber(policy, 'generation.questionScoring.hotThemeNovelty');
  const themePairNovelty = requirePolicyNumber(policy, 'generation.questionScoring.themePairNovelty');
  const themePairGap = requirePolicyNumber(policy, 'generation.questionScoring.themePairGap');
  const explanationGapNovelty = requirePolicyNumber(policy, 'generation.questionScoring.explanationGapNovelty');
  const novelPhraseNovelty = requirePolicyNumber(policy, 'generation.questionScoring.novelPhraseNovelty');
  const novelPhraseGap = requirePolicyNumber(policy, 'generation.questionScoring.novelPhraseGap');
  const sourceDivergenceNovelty = requirePolicyNumber(policy, 'generation.questionScoring.sourceDivergenceNovelty');
  const sourceDivergenceGap = requirePolicyNumber(policy, 'generation.questionScoring.sourceDivergenceGap');
  const sourceDivergenceFallbackHeat = requirePolicyNumber(policy, 'generation.questionScoring.sourceDivergenceFallbackHeat');
  const incomingEntityNovelty = requirePolicyNumber(policy, 'generation.questionScoring.incomingEntityNovelty');
  const incomingEntityGap = requirePolicyNumber(policy, 'generation.questionScoring.incomingEntityGap');
  const sourceBridgeNovelty = requirePolicyNumber(policy, 'generation.questionScoring.sourceBridgeNovelty');
  const sourceBridgeGap = requirePolicyNumber(policy, 'generation.questionScoring.sourceBridgeGap');
  const crossSourceConvergenceNovelty = requirePolicyNumber(policy, 'generation.questionScoring.crossSourceConvergenceNovelty');
  const crossSourceConvergenceGap = requirePolicyNumber(policy, 'generation.questionScoring.crossSourceConvergenceGap');
  const incomingQuestionQuotaMin = requirePolicyNumber(policy, 'incoming.questionQuotaMin');
  const userInterestHeat = requirePolicyNumber(policy, 'generation.questionScoring.userInterestHeat');
  const userInterestNovelty = requirePolicyNumber(policy, 'generation.questionScoring.userInterestNovelty');
  const userInterestGap = requirePolicyNumber(policy, 'generation.questionScoring.userInterestGap');
  const supplierGapPriorityWeight = requirePolicyNumber(policy, 'generation.questionScoring.supplierGapPriorityWeight');
  const questions = [];

  const themes = (snapshot.themes || [])
    .map((theme) => ({
      key: normalizeKnowledgeKey(theme.key || theme.theme || theme.name),
      label: theme.label || theme.name || theme.key || theme.theme,
      heat: toNumber(theme.heat ?? theme.temperature ?? theme.hawkes),
      momentum: toNumber(theme.momentum ?? theme.acceleration ?? theme.change),
      supplierDiversity: toNumber(theme.supplierDiversity ?? theme.relatedEntityCount ?? theme.entityCount),
      evidenceCount: toNumber(theme.evidenceCount ?? theme.articleCount),
      sourceDiversity: toNumber(theme.sourceDiversity),
    }))
    .filter((theme) => theme.key && theme.key !== 'unknown');

  const hotThemes = themes
    .filter((theme) => theme.heat >= minHotThemeHeat || theme.momentum >= minThemeMomentum)
    .sort((left, right) => (right.heat + right.momentum) - (left.heat + left.momentum));

  for (const theme of hotThemes) {
    questions.push(makeQuestion({
      questionType: 'hot_theme',
      themes: [theme.key],
      seedTerms: [theme.label],
      prompt: `${theme.label} is rising. Find upstream components, materials, infrastructure, suppliers, and hidden bottlenecks that could explain or constrain this theme.`,
      triggerReason: `hot theme heat=${theme.heat.toFixed(3)} momentum=${theme.momentum.toFixed(3)}`,
      heatScore: Math.max(theme.heat, theme.momentum),
      noveltyScore: hotThemeNovelty,
      gapScore: Math.max(0, maxSupplierDiversityForGap - theme.supplierDiversity),
      priorityScore: Math.max(theme.heat, theme.momentum) + Math.max(0, maxSupplierDiversityForGap - theme.supplierDiversity) * supplierGapPriorityWeight,
      metadata: { trigger: 'hot_theme', supplierDiversity: theme.supplierDiversity },
    }));
  }

  const pairLimit = Math.min(maxThemePairs, hotThemes.length * Math.max(0, hotThemes.length - 1) / 2);
  let pairCount = 0;
  for (let i = 0; i < hotThemes.length && pairCount < pairLimit; i += 1) {
    for (let j = i + 1; j < hotThemes.length && pairCount < pairLimit; j += 1) {
      const left = hotThemes[i];
      const right = hotThemes[j];
      const heat = Math.min(Math.max(left.heat, left.momentum), Math.max(right.heat, right.momentum));
      questions.push(makeQuestion({
        questionType: 'theme_pair',
        themes: [left.key, right.key],
        seedTerms: [left.label, right.label],
        prompt: `Find shared physical bottlenecks, components, materials, infrastructure, and suppliers connecting ${left.label} and ${right.label}. Avoid copying known examples unless evidence independently supports them.`,
        triggerReason: `hot theme pair heat=${heat.toFixed(3)}`,
        heatScore: heat,
        noveltyScore: themePairNovelty,
        gapScore: themePairGap,
        priorityScore: heat + themePairNovelty,
        metadata: { trigger: 'theme_pair' },
      }));
      pairCount += 1;
    }
  }

  for (const theme of themes.filter((item) => item.supplierDiversity <= maxSupplierDiversityForGap && (item.heat > 0 || item.momentum > 0))) {
    questions.push(makeQuestion({
      questionType: 'explanation_gap',
      themes: [theme.key],
      seedTerms: [theme.label],
      prompt: `${theme.label} has limited supplier/entity coverage. Find upstream suppliers, physical inputs, components, and processes missing from the current brief.`,
      triggerReason: `supplier diversity ${theme.supplierDiversity} <= policy max ${maxSupplierDiversityForGap}`,
      heatScore: Math.max(theme.heat, theme.momentum),
      noveltyScore: explanationGapNovelty,
      gapScore: maxSupplierDiversityForGap - theme.supplierDiversity + 1,
      priorityScore: Math.max(theme.heat, theme.momentum) + explanationGapNovelty,
      metadata: { trigger: 'explanation_gap', supplierDiversity: theme.supplierDiversity },
    }));
  }

  for (const phrase of snapshot.novelPhrases || []) {
    const count = toNumber(phrase.count ?? phrase.sourceCount ?? phrase.frequency);
    if (count < minNovelPhraseCount) continue;
    const text = phrase.phrase || phrase.term || phrase.label;
    if (isLowQualityNovelPhrase(text, policy)) continue;
    questions.push(makeQuestion({
      questionType: 'novel_phrase',
      themes: unique(phrase.themes || []),
      seedTerms: [text],
      prompt: `The phrase "${text}" is emerging outside the stable taxonomy. Determine whether it is a component, material, supplier, process, bottleneck, or noise.`,
      triggerReason: `novel phrase count=${count}`,
      heatScore: Math.min(1, count / (minNovelPhraseCount * 2)),
      noveltyScore: novelPhraseNovelty,
      gapScore: novelPhraseGap,
      priorityScore: 1 + Math.min(1, count / (minNovelPhraseCount * 2)),
      metadata: { trigger: 'novel_phrase', count, sources: phrase.sources || [] },
    }));
  }

  for (const divergence of snapshot.sourceDivergences || []) {
    const theme = normalizeKnowledgeKey(divergence.theme || divergence.topic);
    questions.push(makeQuestion({
      questionType: 'source_divergence',
      themes: theme ? [theme] : [],
      seedTerms: unique([divergence.topic, divergence.sourceType]),
      prompt: `${divergence.sourceType || 'A source'} is moving before other sources for ${divergence.topic || theme || 'an unknown topic'}. Find whether this is an early component/supplier signal or a false lead.`,
      triggerReason: divergence.reason || 'source divergence',
      heatScore: toNumber(divergence.strength, sourceDivergenceFallbackHeat),
      noveltyScore: sourceDivergenceNovelty,
      gapScore: sourceDivergenceGap,
      priorityScore: toNumber(divergence.strength, sourceDivergenceFallbackHeat) + sourceDivergenceNovelty,
      metadata: { trigger: 'source_divergence', ...divergence },
    }));
  }

  for (const signal of snapshot.incomingSignals || []) {
    const label = signal.label || signal.term || signal.normalizedKey || signal.normalized_key;
    const key = normalizeKnowledgeKey(label);
    if (!key) continue;
    const sourceTypes = unique(signal.sourceTypes || signal.source_types || []);
    const themesForSignal = unique(signal.linkedThemes || signal.linked_themes || signal.themes || [])
      .map(normalizeKnowledgeKey)
      .filter(Boolean);
    const signalType = signal.signalType || signal.signal_type || 'incoming_entity';
    const questionType = signalType === 'cross_source_convergence'
      ? 'cross_source_convergence'
      : signalType === 'source_bridge'
        ? 'source_bridge'
        : 'incoming_entity';
    const policyNovelty = questionType === 'cross_source_convergence'
      ? crossSourceConvergenceNovelty
      : questionType === 'source_bridge'
        ? sourceBridgeNovelty
        : incomingEntityNovelty;
    const policyGap = questionType === 'cross_source_convergence'
      ? crossSourceConvergenceGap
      : questionType === 'source_bridge'
        ? sourceBridgeGap
        : incomingEntityGap;
    const priority = toNumber(signal.priorityScore ?? signal.priority_score, 0);
    const novelty = Math.max(policyNovelty, toNumber(signal.noveltyScore ?? signal.novelty_score, 0));
    const observed = toNumber(signal.observationCount ?? signal.observation_count, 0);
    const sourceCount = toNumber(signal.sourceCount ?? signal.source_count, sourceTypes.length);
    questions.push(makeQuestion({
      questionType,
      themes: themesForSignal,
      seedTerms: [label],
      prompt: `${label} is appearing in incoming evidence (${sourceTypes.join(', ') || 'unknown sources'}). Determine whether it is a new component, supplier, material, process, infrastructure layer, or noise, and connect it to adjacent themes only if independent evidence supports it.`,
      triggerReason: `incoming signal priority=${priority.toFixed(3)} observations=${observed} sources=${sourceCount}`,
      heatScore: Math.max(priority, toNumber(signal.sourceDivergenceScore ?? signal.source_divergence_score, 0)),
      noveltyScore: novelty,
      gapScore: policyGap,
      priorityScore: priority + novelty,
      metadata: {
        trigger: 'incoming_signal',
        incomingSignalId: signal.id || signal.deterministicId || signal.deterministic_id || null,
        incomingSignalType: signalType,
        sourceTypes,
        sourceCount,
        observationCount: observed,
        seedSimilarity: toNumber(signal.seedSimilarity ?? signal.seed_similarity, 0),
        graphDistanceSummary: signal.graphDistanceSummary || signal.graph_distance_summary || {},
      },
    }));
  }

  for (const interest of snapshot.userInterests || []) {
    const themesForInterest = unique(interest.themes || [interest.theme]).map(normalizeKnowledgeKey).filter(Boolean);
    if (!themesForInterest.length) continue;
    questions.push(makeQuestion({
      questionType: 'user_interest',
      themes: themesForInterest,
      seedTerms: unique([interest.label, ...(interest.aliases || [])]),
      prompt: `The operator is tracking ${interest.label || themesForInterest.join(' + ')}. Find adjacent components, materials, suppliers, and cross-theme connectors, but keep outputs private until reviewed.`,
      triggerReason: 'user followed or tracked target',
      heatScore: userInterestHeat,
      noveltyScore: userInterestNovelty,
      gapScore: userInterestGap,
      priorityScore: userInterestHeat + userInterestNovelty,
      metadata: { trigger: 'user_interest', private: true },
    }));
  }

  const byId = new Map();
  for (const question of questions.sort(sortQuestions)) {
    if (!byId.has(question.id)) byId.set(question.id, question);
  }
  const incomingQuestionTypes = new Set(['incoming_entity', 'source_bridge', 'cross_source_convergence']);
  const sorted = [...byId.values()].sort(sortQuestions);
  const minIncomingQuestions = Math.min(maxQuestions, Math.ceil(maxQuestions * incomingQuestionQuotaMin));
  const selectedMap = new Map();
  for (const question of sorted.filter((item) => incomingQuestionTypes.has(item.questionType)).slice(0, minIncomingQuestions)) {
    selectedMap.set(question.id, question);
  }
  for (const question of sorted) {
    if (selectedMap.size >= maxQuestions) break;
    if (!selectedMap.has(question.id)) selectedMap.set(question.id, question);
  }
  const selected = [...selectedMap.values()].sort(sortQuestions);
  const autonomousCount = selected.filter((question) => question.questionType !== 'user_interest').length;
  return {
    ok: true,
    questions: selected,
    metrics: {
      total: selected.length,
      autonomousCount,
      autonomousQuestionRate: selected.length ? autonomousCount / selected.length : 0,
      triggerCounts: selected.reduce((acc, question) => {
        acc[question.questionType] = (acc[question.questionType] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}
