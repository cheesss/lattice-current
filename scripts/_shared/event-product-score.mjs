/**
 * Event product score (S-Tier User Value §1).
 *
 * Plan §1 requires ranking events by a composite product score that combines
 * theme relevance, evidence grade, freshness, source credibility, market/policy
 * impact, and a duplicate penalty:
 *
 *   productScore =
 *     themeRelevance
 *     × evidenceWeight
 *     × freshnessWeight
 *     × sourceCredibility
 *     × impactWeight
 *     × duplicatePenalty
 *
 * Pure multiplication is intentional — it expresses that each component is
 * necessary, not just helpful. A dead-zero in any one of them collapses the
 * score. To prevent total elimination on a single missing signal we clamp each
 * component to a small floor, but a weak signal will still dominate the score.
 *
 * Every score returns a `components` and `rationale` array so the dashboard can
 * show the calculation path (plan §1: "Show the calculation path for all
 * prominent metrics").
 *
 * Inputs are the row shape returned by buildHotEventsPayload's normalizeHotEventRow,
 * augmented with publisherGroups when available.
 */

const COMPONENT_FLOOR = 0.05;

const EVIDENCE_GRADE_WEIGHTS = {
  E4: 1.00,
  E3: 0.85,
  E2: 0.70,
  E1: 0.40,
  E0: 0.20,
};

// Catch-all themes that the plan §6 says must be penalized "unless no narrower
// theme exists". We give them a haircut on themeRelevance.
const CATCH_ALL_THEMES = new Set([
  'technology-general',
  'emerging-tech',
  'general',
  'misc',
  'other',
  'unknown',
]);

const FRESHNESS_HALF_LIFE_DAYS = 14;

function clamp(value, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function floorComponent(value) {
  return clamp(value, COMPONENT_FLOOR, 1);
}

function isDynamicTheme(theme) {
  return typeof theme === 'string' && /^dt-[a-z0-9]+$/i.test(theme.trim());
}

/**
 * Token set extracted from the theme tag itself. We split on hyphens and
 * underscores, lowercase, drop short stop tokens. For 'energy-supply-chain'
 * this yields ['energy', 'supply', 'chain']. For 'ai-ml' → ['ai', 'ml']
 * (we keep 2-char tokens because they are often legitimate domain terms).
 *
 * Stop tokens are domain-specific common-but-uninformative words.
 */
const THEME_TOKEN_STOPLIST = new Set([
  'and', 'the', 'for', 'with', 'from', 'into', 'over', 'general', 'misc', 'other',
]);

function themeTokenSet(theme) {
  if (!theme || typeof theme !== 'string') return new Set();
  const raw = theme.trim().toLowerCase();
  if (!raw || raw === 'unknown' || isDynamicTheme(raw)) return new Set();
  const tokens = raw
    .split(/[-_\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !THEME_TOKEN_STOPLIST.has(t));
  return new Set(tokens);
}

/**
 * Compute keyword overlap between the theme tag and the event's
 * representative_title (and any title hints on linked articles).
 *
 * Returns a number in [0, 1]:
 *   1.0  every theme token appears in the title
 *   0.5  half of theme tokens appear
 *   0.0  no overlap (likely mismatched theme assignment)
 *
 * If the theme has no informative tokens (dt-*, generic, single short word),
 * returns null so callers can ignore the signal.
 */
export function computeThemeKeywordOverlap(event = {}) {
  const tokens = themeTokenSet(event.theme);
  if (tokens.size === 0) return null;
  const title = String(event.title || event.representative_title || '').toLowerCase();
  if (!title) return null;
  let hit = 0;
  for (const t of tokens) {
    // Word-boundary-ish check — avoid 'ai' matching inside 'gain'.
    const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    if (re.test(title)) hit += 1;
  }
  return hit / tokens.size;
}

function ageDays(eventDate, now = new Date()) {
  if (!eventDate) return Number.POSITIVE_INFINITY;
  const t = new Date(eventDate).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - t) / 86_400_000);
}

/**
 * themeRelevance ∈ [floor, 1]
 *
 * Heuristic until a dedicated theme-relevance model lands (plan §5):
 *   - dt-* (auto-generated dynamic theme): 0.40 — uncertain mapping
 *   - catch-all theme name (technology-general, etc.): 0.55 — too broad
 *   - explicit market relevance signal favourable
 *     (market_relevant > low_relevant when known): boost to 0.90
 *   - no market relevance signal at all: 0.70 (neutral)
 *   - relevance_blocked quality flag: 0.30
 */
export function computeThemeRelevance(event = {}) {
  const rationale = [];
  const theme = String(event.theme || '').trim();
  const flags = Array.isArray(event.qualityFlags) ? event.qualityFlags : [];

  let score = 0.70;
  if (isDynamicTheme(theme)) {
    score = 0.40;
    rationale.push('dynamic-theme-code');
  } else if (CATCH_ALL_THEMES.has(theme.toLowerCase())) {
    score = 0.55;
    rationale.push('catch-all-theme');
  }

  if (flags.includes('low-market-relevance')) {
    score = Math.min(score, 0.30);
    rationale.push('quality-flag:low-market-relevance');
  }

  const known = Number(event.knownMarketRelevanceArticles ?? 0);
  const relevant = Number(event.marketRelevantArticles ?? 0);
  const low = Number(event.lowRelevanceArticles ?? 0);
  if (known > 0 && relevant >= low + 1) {
    score = Math.min(1, score + 0.20);
    rationale.push('market-relevance:strong');
  }

  // S-Tier N1: keyword overlap between the theme tag and the event title.
  // A canonical theme like 'energy-supply-chain' should appear word-for-word
  // (or token-by-token) in its events' titles. Strong overlap (>= 50%)
  // boosts the score; zero overlap is a meaningful red flag — the theme
  // assignment may be wrong even when the rest of the signals look healthy.
  const overlap = computeThemeKeywordOverlap(event);
  if (overlap !== null) {
    if (overlap >= 0.5) {
      score = Math.min(1, score + 0.10);
      rationale.push(`keyword-overlap:${(overlap * 100).toFixed(0)}%`);
    } else if (overlap === 0) {
      score = Math.max(0, score - 0.20);
      rationale.push('keyword-overlap:none — theme tag may not match event content');
    } else {
      rationale.push(`keyword-overlap:${(overlap * 100).toFixed(0)}%`);
    }
  }

  return { value: floorComponent(score), rationale };
}

export function computeEvidenceWeight(event = {}) {
  const grade = String(event.bestEvidenceGrade || event.rawEvidenceGrade || '').toUpperCase();
  // Plan §1: "Move `none` evidence-grade items out of the validated signal
  // lane." We honour that by giving `none` the smallest possible weight.
  // Combined with downstream classifyEventLane, this naturally drops them
  // into the noise lane unless other signals are exceptionally strong.
  const value = EVIDENCE_GRADE_WEIGHTS[grade] ?? COMPONENT_FLOOR;
  const rationale = [`grade:${grade || 'none'}`];
  return { value: floorComponent(value), rationale };
}

export function computeFreshnessWeight(event = {}, now = new Date()) {
  const days = ageDays(event.eventDate, now);
  if (!Number.isFinite(days)) {
    return { value: COMPONENT_FLOOR, rationale: ['no-event-date'] };
  }
  const value = Math.exp(-days / FRESHNESS_HALF_LIFE_DAYS);
  return {
    value: floorComponent(value),
    rationale: [`age:${days.toFixed(1)}d`],
  };
}

export function computeSourceCredibility(event = {}) {
  const sourceCount = Number(event.sourceCount ?? 0);
  const publisherGroups = Number(event.publisherGroups ?? event.publisher_groups ?? 0);
  const flags = Array.isArray(event.qualityFlags) ? event.qualityFlags : [];

  let value;
  let rationale;
  if (publisherGroups >= 3 && sourceCount >= 5) {
    value = 1.0; rationale = ['multi-publisher:5+'];
  } else if (publisherGroups >= 2 && sourceCount >= 3) {
    value = 0.80; rationale = ['multi-publisher:3+'];
  } else if (sourceCount >= 2) {
    value = 0.50; rationale = ['multi-source-but-narrow'];
  } else {
    value = 0.20; rationale = ['single-source'];
  }
  if (flags.includes('single-source')) {
    value = Math.min(value, 0.25);
  }
  return { value: floorComponent(value), rationale };
}

export function computeImpactWeight(event = {}) {
  const t = Math.abs(Number(event.rawMaxAbsTStat ?? event.maxAbsTStat ?? 0));
  let value;
  let rationale;
  if (t >= 4) { value = 1.00; rationale = ['t>=4']; }
  else if (t >= 3) { value = 0.80; rationale = ['t>=3']; }
  else if (t >= 2) { value = 0.60; rationale = ['t>=2']; }
  else if (t >= 1) { value = 0.40; rationale = ['t>=1']; }
  else { value = 0.20; rationale = ['t<1-or-missing']; }
  return { value: floorComponent(value), rationale };
}

/**
 * duplicatePenalty ∈ [floor, 1]
 *
 * 1.0 = no duplication penalty.
 * 0.5 ≈ all articles share one publisher group.
 *
 * Without a duplicate cluster ID at the row level we approximate by:
 *   ratio = publisherGroups / max(1, sourceCount)
 * a ratio close to 1 means every source is independent.
 */
export function computeDuplicatePenalty(event = {}) {
  const sourceCount = Number(event.sourceCount ?? 0);
  const publisherGroups = Number(event.publisherGroups ?? event.publisher_groups ?? sourceCount);
  if (sourceCount <= 1) {
    return { value: floorComponent(0.30), rationale: ['single-source'] };
  }
  if (publisherGroups <= 1) {
    return { value: 0.50, rationale: ['all-same-publisher-group'] };
  }
  const ratio = publisherGroups / Math.max(1, sourceCount);
  return {
    value: floorComponent(0.6 + 0.4 * ratio),
    rationale: [`pub-group-ratio:${ratio.toFixed(2)}`],
  };
}

/**
 * Compute the composite product score for one event.
 *
 * Returns:
 *   {
 *     productScore: 0..1,
 *     components: { themeRelevance, evidenceWeight, freshnessWeight,
 *                   sourceCredibility, impactWeight, duplicatePenalty },
 *     rationale: string[]   // collected from each component
 *   }
 */
export function computeEventProductScore(event = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const themeRelevance = computeThemeRelevance(event);
  const evidenceWeight = computeEvidenceWeight(event);
  const freshnessWeight = computeFreshnessWeight(event, now);
  const sourceCredibility = computeSourceCredibility(event);
  const impactWeight = computeImpactWeight(event);
  const duplicatePenalty = computeDuplicatePenalty(event);

  const productScore =
    themeRelevance.value
    * evidenceWeight.value
    * freshnessWeight.value
    * sourceCredibility.value
    * impactWeight.value
    * duplicatePenalty.value;

  return {
    productScore: clamp(productScore, 0, 1),
    components: {
      themeRelevance: themeRelevance.value,
      evidenceWeight: evidenceWeight.value,
      freshnessWeight: freshnessWeight.value,
      sourceCredibility: sourceCredibility.value,
      impactWeight: impactWeight.value,
      duplicatePenalty: duplicatePenalty.value,
    },
    rationale: [
      ...themeRelevance.rationale,
      ...evidenceWeight.rationale,
      ...freshnessWeight.rationale,
      ...sourceCredibility.rationale,
      ...impactWeight.rationale,
      ...duplicatePenalty.rationale,
    ],
  };
}

/**
 * Sort events in-place by descending productScore. Adds productScore +
 * scoreBreakdown to each event for the dashboard to display.
 */
export function rankByProductScore(events, options = {}) {
  if (!Array.isArray(events)) return [];
  const now = options.now instanceof Date ? options.now : new Date();
  const decorated = events.map((event) => {
    const score = computeEventProductScore(event, { now });
    return {
      ...event,
      productScore: score.productScore,
      scoreBreakdown: {
        components: score.components,
        rationale: score.rationale,
      },
    };
  });
  decorated.sort((a, b) => (b.productScore ?? 0) - (a.productScore ?? 0));
  return decorated;
}

/**
 * Classify a scored event into a lane (S-Tier §3 / Phase 2 prep):
 *   - 'validated': promoted E2+ AND productScore >= 0.20
 *   - 'watch':     scored event without promotion OR low evidence
 *   - 'noise':     productScore < 0.05 (catch-all + ungraded + stale)
 */
export function classifyEventLane(event = {}) {
  const productScore = Number(event.productScore ?? 0);
  const promoted = Boolean(event.promotionEligible);
  if (promoted && productScore >= 0.20) return 'validated';
  if (productScore < 0.05) return 'noise';
  return 'watch';
}

/**
 * S-Tier N3: surface "almost-validated" events.
 *
 * The existing 3-lane (validated / watch / noise) split is per-event but
 * coarse — it does not distinguish "watch lane because there's no signal
 * yet" from "watch lane because there IS a signal that just hasn't
 * passed the promotion gate". This helper computes a finer status:
 *
 *   'validated'  — promoted E2+ AND productScore ≥ 0.20  (same as lane)
 *   'pending'    — raw evidence grade ≥ E1 but NOT promotion-eligible.
 *                   Means the statistical signal exists but blocked on
 *                   controls / t-stat / market-relevance — operator can
 *                   inspect and override or wait for more controls.
 *   'observation'— scored watch event without E1+ raw grade.
 *   'noise'      — productScore < 0.05 / no grade at all.
 *
 * Returns a structured envelope with status + blockers (concrete reasons
 * promotion was blocked) so the dashboard can show "Pending: 3 events
 * blocked on n_controls < 8" rather than a generic "watch".
 */
export function computeValidationStatus(event = {}) {
  const lane = event.lane || classifyEventLane(event);
  const rawGrade = String(
    event.rawEvidenceGrade
    || event.bestEvidenceGrade
    || '',
  ).toUpperCase();
  const promoted = Boolean(event.promotionEligible);
  const score = Number(event.productScore ?? 0);
  const flags = Array.isArray(event.qualityFlags) ? event.qualityFlags : [];
  const blockers = [];

  // Map known qualityFlags to user-readable blocker reasons.
  if (flags.includes('low-control-count')) {
    blockers.push({
      code: 'low-control-count',
      reason: 'Promotion blocked: not enough matched controls (n_controls below threshold). Wait for the matching window to expand.',
    });
  }
  if (flags.includes('low-market-relevance')) {
    blockers.push({
      code: 'low-market-relevance',
      reason: 'Promotion blocked: linked articles do not show market relevance. May be off-topic or low-impact for this theme.',
    });
  }
  if (flags.includes('raw-grade-not-promoted') && !promoted) {
    blockers.push({
      code: 'raw-grade-not-promoted',
      reason: 'Raw evidence grade is present but not promoted. Inspect t-stat magnitude — typical block is |t| < 2.',
    });
  }
  if (flags.includes('single-source')) {
    blockers.push({
      code: 'single-source',
      reason: 'Promotion needs ≥ 2 sources confirming the event. Currently single-source.',
    });
  }
  if (flags.includes('single-article')) {
    blockers.push({
      code: 'single-article',
      reason: 'Event is a single-article cluster. Will not promote until additional articles attach.',
    });
  }

  let status;
  if (promoted && score >= 0.20) {
    status = 'validated';
  } else if (lane === 'noise' && rawGrade === '') {
    // No grade and noise score — pure observation.
    status = 'noise';
  } else if (['E1', 'E2', 'E3', 'E4'].includes(rawGrade) && !promoted) {
    // The interesting case — statistically significant but blocked.
    status = 'pending';
    if (blockers.length === 0) {
      // Defensive — when we have a graded event but no qualityFlags,
      // still record the structural "not promoted" reason.
      blockers.push({
        code: 'unknown-block',
        reason: 'Raw grade present but promotion gate not satisfied — inspect uplift_rows + t-stat manually.',
      });
    }
  } else if (lane === 'noise') {
    status = 'noise';
  } else {
    status = 'observation';
  }

  return {
    status,
    rawGrade: rawGrade || null,
    promoted,
    productScore: score,
    blockers,
  };
}

/**
 * One-line rationale for why an event landed in its lane. Used by the
 * empty-state envelope and the dashboard so noise events can show
 * "WHY noise" without the full scoreBreakdown rationale array.
 */
export function explainEventLane(event = {}) {
  const lane = classifyEventLane(event);
  const grade = String(event.bestEvidenceGrade || event.rawEvidenceGrade || '').toUpperCase() || 'none';
  const promoted = Boolean(event.promotionEligible);
  const score = Number(event.productScore ?? 0);
  if (lane === 'validated') {
    return `Validated: promoted ${grade} grade with productScore ${score.toFixed(2)}.`;
  }
  if (lane === 'watch') {
    if (!promoted && grade !== 'none') {
      return `Watch: ${grade} evidence but not promoted (likely below control or t-stat threshold). Worth tracking, not yet a confirmed signal.`;
    }
    return `Watch: productScore ${score.toFixed(2)} — observable but evidence is thin.`;
  }
  // noise
  if (grade === 'none') {
    return `Noise: no evidence grade (E0+) yet. Article cluster exists but has no statistical confirmation.`;
  }
  return `Noise: productScore ${score.toFixed(3)} below threshold. Likely catch-all theme or stale.`;
}

/**
 * Per-event recommended action (S-Tier §4 — every signal card must include
 * a recommended action). Hooks off the lane + score breakdown so the
 * recommendation is consistent with WHY the event landed where it did.
 *
 * Returns:
 *   action     short verb-phrase: "Investigate now", "Watch for confirmation",
 *              "Skip — observation only", "Promote to inbox"
 *   tone       'primary' | 'secondary' | 'muted'  — for UI button styling
 *   reason     one-liner explaining the recommendation
 */
export function recommendActionForEvent(event = {}) {
  const lane = event.lane || classifyEventLane(event);
  const grade = String(event.bestEvidenceGrade || event.rawEvidenceGrade || '').toUpperCase();
  const score = Number(event.productScore ?? 0);
  const validationStatus = event.validationStatus
    || (lane === 'validated' ? 'validated' : null);
  const blockers = Array.isArray(event.validationBlockers) ? event.validationBlockers : [];

  if (lane === 'validated') {
    return {
      action: 'Investigate now',
      tone: 'primary',
      reason: `Validated ${grade} signal with productScore ${score.toFixed(2)} — open the event to inspect uplift, controls, and source diversity before deciding.`,
    };
  }
  // S-Tier §N3: pending takes precedence over generic watch — these are
  // the most actionable watch events (statistical signal exists, blocked
  // on a specific gate the operator can inspect).
  if (validationStatus === 'pending') {
    const blockerCodes = blockers.map((b) => b.code).join(', ') || 'unknown-block';
    return {
      action: 'Inspect blocker · pending validation',
      tone: 'primary',
      reason: `Raw ${grade} grade present but promotion blocked on: ${blockerCodes}. Open the event — the block may be fixable (more controls coming) or you can override into the Decision Inbox if the block is structural.`,
    };
  }
  if (lane === 'watch') {
    if (grade && grade !== 'NONE') {
      return {
        action: 'Watch for confirmation',
        tone: 'secondary',
        reason: `${grade} evidence present but not yet promoted (likely missing controls or t-stat). Re-check after the next event-engine refresh; promote to Decision Inbox if it crosses the threshold.`,
      };
    }
    return {
      action: 'Watch — evidence pending',
      tone: 'secondary',
      reason: `productScore ${score.toFixed(2)} — observable but no evidence grade yet. Wait for the meta-model-infer cycle to attach uplift before acting.`,
    };
  }
  // noise
  return {
    action: 'Skip — observation only',
    tone: 'muted',
    reason: `Below validation threshold (productScore ${score.toFixed(3)}, no evidence grade). Surface only as context, not as actionable signal.`,
  };
}

/**
 * Theme-level framing for empty / noise-only theme pages (plan §3 + S4).
 * Returns:
 *   bucket  'validated_signals' | 'watch_only' | 'noise_only' | 'no_data'
 *   message ready-to-render English string explaining what the page is showing
 *   counts  { validated, watch, noise } over the candidate set
 */
export function summarizeThemeFraming({ events = [], laneCounts = {}, themeFilter = null, pendingCount = 0 } = {}) {
  const counts = {
    validated: Number(laneCounts.validated ?? 0),
    watch: Number(laneCounts.watch ?? 0),
    noise: Number(laneCounts.noise ?? 0),
    pending: Number(pendingCount ?? 0),
  };
  const total = counts.validated + counts.watch + counts.noise;
  const themeLabel = themeFilter ? `"${themeFilter}"` : 'this view';
  if (total === 0) {
    return {
      bucket: 'no_data',
      message: `No event candidates for ${themeLabel} in the current window. The aggregator returned zero rows.`,
      counts,
    };
  }
  if (counts.validated > 0) {
    const pendingNote = counts.pending > 0
      ? ` Plus ${counts.pending} pending-validation item${counts.pending === 1 ? '' : 's'} (E1+ grade, blocked on controls or t-stat).`
      : '';
    return {
      bucket: 'validated_signals',
      message: `${counts.validated} validated signal${counts.validated === 1 ? '' : 's'} for ${themeLabel}. ${counts.watch} additional watch item${counts.watch === 1 ? '' : 's'} for context.${pendingNote}`,
      counts,
    };
  }
  if (counts.pending > 0) {
    // S-Tier N3: surface near-validation explicitly even when no items have
    // crossed the promotion gate. This is the most actionable framing for
    // analysts — "we have signal, here's what's missing".
    return {
      bucket: 'pending_validation',
      message: `${counts.pending} pending-validation event${counts.pending === 1 ? '' : 's'} for ${themeLabel} — these have raw E1+ evidence but are blocked on controls, t-stat, or market-relevance. Inspect to see whether the block is fixable or whether to wait for more controls. ${counts.watch + counts.noise > 0 ? `${counts.watch + counts.noise} additional observations.` : ''}`,
      counts,
    };
  }
  if (counts.watch > 0) {
    return {
      bucket: 'watch_only',
      message: `No validated signals for ${themeLabel} yet. ${counts.watch} watch-only item${counts.watch === 1 ? '' : 's'} flagged for monitoring — these have evidence in progress but have not crossed the validation threshold.`,
      counts,
    };
  }
  // noise-only
  return {
    bucket: 'noise_only',
    message: `No validated or watch signals for ${themeLabel} yet. ${counts.noise} item${counts.noise === 1 ? '' : 's'} are surfaced as noise — they reached the news ingestion floor but have neither evidence grade nor sufficient statistical confirmation. Treat as observation only, not as actionable signals.`,
    counts,
  };
}
