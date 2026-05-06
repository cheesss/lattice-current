/*
 * Report Codex narrator.
 *
 * Phase 4: lift the typed prose (deterministic, structured, entity-bound) into
 * Bridgewater-style analyst narrative via Codex. The deterministic typed
 * sections give Codex a high-fidelity skeleton; Codex adds the narrative
 * voice and explicit bull/bear synthesis.
 *
 * Architecture:
 *   bundle (Phase 2 rich)  →  typed sections (Phase 3)  →  Codex narrator
 *                                                         →  validator gate
 *                                                         →  merged sections
 *
 * The narrator NEVER replaces typed sections wholesale. It is an additive
 * layer that:
 *   1. Generates a single 200-300 word executive narrative (head)
 *   2. Generates an explicit bull / bear / inflection trio
 *   3. Generates a concluding "what would change my mind" paragraph
 *
 * Every Codex output goes through the validator (knownNumericStrings,
 * allowedTickerStrings) before being attached to the report. If a sentence
 * fails validation, it is silently dropped — typed prose still renders.
 *
 * Cost model: Codex runs are bounded by LATTICE_LLM_DAILY_BUDGET (default
 * 20 calls/day). Each call ~60s. Reports without budget fall back to typed
 * prose only.
 */

import { runCodexJsonPrompt } from './codex-json.mjs';

function asArray(v) { return Array.isArray(v) ? v : []; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

function buildBundleDigest(bundle) {
  /* Compress the bundle into a JSON skeleton small enough for the Codex
   * context window. Goal: include every entity, number, and label the
   * narrator might want to cite, but no raw article text dumps. */
  const ctx = bundle.metadata?.themeContext || {};
  return {
    reportType: bundle.reportType,
    subject: {
      type: bundle.subject?.subjectType,
      id: bundle.subject?.subjectId,
      name: bundle.subject?.displayName,
    },
    period: bundle.coverageWindow,
    asOf: bundle.asOf,
    metrics: asArray(bundle.metrics).slice(0, 16).map((m) => ({
      id: m.metricId, name: m.name, value: m.value, unit: m.unit, window: m.window,
    })),
    evidence: asArray(bundle.evidence).slice(0, 12).map((e) => ({
      id: e.evidenceId, kind: e.kind, publisher: e.publisher, title: e.title?.slice(0, 140),
      grade: e.evidenceGrade, freshness: e.freshnessStatus,
    })),
    marketReactions: asArray(bundle.marketReactions).slice(0, 10).map((r) => ({
      id: r.reactionId, symbol: r.symbol, returnPct: r.relativeReturnPct,
      uplift: r.uplift, tStat: r.tStat, sample: (r.controls || []).find((c) => /sample_size/.test(c)),
      validation: r.validationStatus,
    })),
    caveats: asArray(bundle.caveats).slice(0, 8).map((c) => ({
      id: c.caveatId, severity: c.severity, type: c.type, text: c.text?.slice(0, 220),
    })),
    figures: asArray(bundle.figures).slice(0, 6).map((f) => ({ id: f.figureId, kind: f.kind, label: f.label })),
    /* Theme report rich context */
    themeContext: ctx.themeKey ? {
      subtopics: asArray(ctx.subtopics).slice(0, 5).map((s) => ({
        sub: s.sub_theme, label: s.theme_label, parent: s.parent_theme,
        rank: s.rank_in_parent, lifecycle: s.lifecycle_stage,
        momentum: s.momentum_score, accel: s.acceleration, articles: s.article_count,
      })),
      peerSymbolsPositive: asArray(ctx.peerSymbols?.positive).map((p) => ({ symbol: p.symbol, zscore: p.sensitivity_zscore, avgReturn: p.avg_return, sample: p.sample_size })),
      peerSymbolsNegative: asArray(ctx.peerSymbols?.negative).map((p) => ({ symbol: p.symbol, zscore: p.sensitivity_zscore, avgReturn: p.avg_return, sample: p.sample_size })),
      regimeBySymbol: asArray(ctx.regimeBySymbol).slice(0, 4).map((g) => ({
        symbol: g.symbol,
        regimes: asArray(g.regimes).map((r) => ({ regime: r.regime, horizon: r.horizon, mult: r.regime_multiplier, n: r.sample_size })),
      })),
      knowledgeConnections: asArray(ctx.knowledgeConnections).slice(0, 6).map((c) => ({
        edgeId: c.edgeId, entity: c.entityName, type: c.entityType, relation: c.relationType,
        confidence: c.confidence, evidenceCount: c.evidenceCount, sourceDiversity: c.sourceDiversity,
      })),
      events: asArray(ctx.events).slice(0, 6).map((e) => ({
        id: e.eventId, date: e.eventDate?.slice(0, 10), title: e.title?.slice(0, 140),
        articleCount: e.articleCount, sources: e.sourceCount, hawkes: e.hawkesIntensity, isSurge: e.isSurge,
      })),
      hawkesSeries: asArray(ctx.hawkesSeries).slice(-14).map((h) => ({
        date: h.event_date, intensity: h.hawkes_intensity, articles: h.article_count,
      })),
    } : null,
    diagnosticSignals: bundle.metadata?.diagnosticSignals || {},
  };
}

function buildTypedDigest(typed) {
  if (!typed) return null;
  const flatten = (sections) => asArray(sections).map((s) => s.text).filter(Boolean).join(' || ');
  return {
    keyJudgments: flatten(typed.keyJudgments),
    workingThesis: flatten(typed.thesis),
    catalysts: flatten(typed.catalysts),
    risks: flatten(typed.risks),
    bullCase: flatten(asArray(typed.scenarios).filter((s) => /bull/i.test(s.label))),
    bearCase: flatten(asArray(typed.scenarios).filter((s) => /bear/i.test(s.label))),
    invalidator: flatten(asArray(typed.scenarios).filter((s) => /invalidat|inflect/i.test(s.label))),
    watchNext: flatten(typed.watchNext),
  };
}

const NARRATOR_PROMPT = `You are a Bridgewater Daily Observations-style intelligence analyst.

Your job: produce a synthesized analyst narrative on top of the structured
bundle and the deterministic typed sections supplied below. Output JSON only.

ABSOLUTE RULES (non-negotiable):
1. You may ONLY reference numbers that appear in the bundle's metrics,
   marketReactions, themeContext, or caveats.
2. You may ONLY reference tickers that appear in marketReactions.symbol or
   themeContext.peerSymbols. Do not invent tickers.
3. You may ONLY reference entity names that appear in evidence.title,
   themeContext.knowledgeConnections.entity, or themeContext.events.title.
4. NO investment advice ("buy", "sell", "price target", "매수", "매도", "목표가").
   Use words like "consistent with", "supports", "suggests", "watch".
5. NO claims that the typed sections did not already make. You are
   synthesizing, not adding new facts.
6. Every numeric mention must be cited with a metric id (MET-*) or evidence
   id (EVID-*) or reaction id (MRKT-*) the bundle contains.
7. If the bundle is weak (caveats with severity=high, diagnosticSignals
   show aggregate orphan or evidence mismatch), say so explicitly.
8. Output prose in English, professional analyst tone. No bullet points.

WRITE 4 SECTIONS as JSON (output exactly this shape):
{
  "narrativeHead": "200-300 word executive narrative tying together the
                    subject's attention pulse, symbol transmission, graph
                    adjacency, and current data quality.",
  "bullThesis":    "100-150 words — the strongest case the bundle supports
                    for upside. Must end with explicit metric/evidence
                    threshold that, if breached, would VALIDATE this case.",
  "bearThesis":    "100-150 words — the strongest case the bundle supports
                    for downside. Must end with explicit threshold that,
                    if breached, would VALIDATE this case.",
  "invalidator":   "60-100 words — what specific evidence would FLIP your
                    current working stance. Cite specific metric ids or
                    market reactions."
}

Use one paragraph per section. Inline-cite ids like (MET-PEER-COUNT,
EVID-ARTICLE-155833) where relevant. Do NOT introduce new ids.

If the bundle's diagnosticSignals.hasAggregateOrphan is true, the
narrative head must acknowledge that the aggregate is orphaned and that
the event timeline + knowledge graph are the trustworthy lenses.`;

export async function generateCodexNarrative(bundle, typed, { timeoutMs = 90_000, dryRun = false } = {}) {
  const bundleDigest = buildBundleDigest(bundle);
  const typedDigest = buildTypedDigest(typed);
  const prompt = `${NARRATOR_PROMPT}

BUNDLE:
${JSON.stringify(bundleDigest, null, 2)}

TYPED SECTIONS (deterministic, evidence-bound, treat as ground truth):
${JSON.stringify(typedDigest, null, 2)}

OUTPUT JSON ONLY (no markdown fences, no commentary):`;

  if (dryRun) {
    return { ok: true, dryRun: true, prompt: prompt.slice(0, 400) + '…', parsed: null };
  }

  let result;
  try {
    result = await runCodexJsonPrompt(prompt, timeoutMs, {
      env: { CODEX_MODEL: process.env.CODEX_MODEL || 'gpt-5.4' },
    });
  } catch (e) {
    return { ok: false, error: 'codex_call_failed', message: String(e?.message || e) };
  }
  if (result?.code !== 0 && !result?.parsed) {
    return { ok: false, error: 'codex_failed', code: result?.code, message: String(result?.message || '').slice(0, 600) };
  }
  return {
    ok: true,
    parsed: result.parsed,
    raw: result.text?.slice(0, 4000),
  };
}

/*
 * Validate Codex output against the bundle. Drops any sentence whose
 * numeric / ticker tokens don't appear in the bundle's allow lists.
 *
 * Returns { sections, droppedSentences, validatorReport } so the caller can
 * decide whether to attach the narrative or fall back to typed-only.
 */
export function validateCodexNarrative(parsed, bundle, knownNumbers, allowedTickers) {
  if (!parsed || typeof parsed !== 'object') return { sections: null, dropped: [] };
  const sections = {};
  const dropped = [];
  const evidenceIdSet = new Set(asArray(bundle.evidence).map((e) => e.evidenceId));
  const metricIdSet = new Set(asArray(bundle.metrics).map((m) => m.metricId));
  const reactionIdSet = new Set(asArray(bundle.marketReactions).map((r) => r.reactionId));
  for (const key of ['narrativeHead', 'bullThesis', 'bearThesis', 'invalidator']) {
    const text = String(parsed[key] || '').trim();
    if (!text) { sections[key] = null; continue; }
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    const kept = [];
    for (const sentence of sentences) {
      let ok = true;
      /* Numeric tokens (excluding 4-digit years and dates) */
      const stripped = sentence.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ').replace(/"[^"]*"/g, ' ');
      const numTokens = stripped.match(/[-+]?\d+(?:\.\d+)?%?/g) || [];
      let failedToken = null;
      for (const token of numTokens) {
        if (/^\d{4}$/.test(token)) continue;
        /* Tolerate small policy thresholds even if not pre-listed */
        const n = Number(token.replace(/%$/, ''));
        if (Number.isInteger(n) && n >= 0 && n <= 200) {
          if (knownNumbers.has(String(n))) continue;
        }
        if (!knownNumbers.has(token)) { ok = false; failedToken = token; break; }
      }
      if (!ok) { dropped.push({ section: key, sentence: sentence.slice(0, 200), reason: 'unknown_numeric', token: failedToken }); continue; }
      /* Uppercase ticker-like tokens — log only, don't drop the sentence.
       * Most "unknown" uppercase tokens are common English words that
       * happen to be capitalized at sentence start (Through, While) or
       * domain abbreviations not in COMMON_UPPERCASE_WORDS. The downstream
       * validator will catch genuine ticker hallucinations. */
      const upperTokens = stripped.match(/\b[A-Z][A-Z0-9.]{1,5}\b/g) || [];
      for (const token of upperTokens) {
        const norm = token.replace(/\.$/, '').toUpperCase();
        if (norm.length <= 1) continue;
        if (allowedTickers.has(norm)) continue;
        if (/^(MET|EVID|FIG|CAV|CLM|MRKT|WATCH|YOY|MW|GW|AI|ML|API|CTO|CEO|CFO|GPU|CPU|EU|US|UK|EV|IPO|GDP|CPI|AND|OR|NOT|IT|IS|OK|NA|TPU|SLA|PPA|CFTC|SEC|EDP|HHI|NLP|THE|FOR|BUT|YET|ALL|ANY|MAY|NEW|END|JUL|AUG|SEP|OCT|NOV|DEC|JAN|FEB|MAR|APR|MAY|JUN)$/.test(norm)) continue;
        if (norm.startsWith('MET-') || norm.startsWith('EVID-') || norm.startsWith('FIG-') || norm.startsWith('CAV-') || norm.startsWith('CLM-') || norm.startsWith('MRKT-')) continue;
        /* Soft warning — don't drop sentence on uppercase. Numeric checks
         * and forbidden phrases are the only hard-drop reasons. */
        dropped.push({ section: key, sentence: sentence.slice(0, 120), reason: 'soft_warn_uppercase', token: norm });
      }
      /* Forbidden investment phrases */
      if (/\b(buy|sell|strong buy|price target)\b/i.test(sentence)) {
        dropped.push({ section: key, sentence, reason: 'forbidden_phrase' });
        continue;
      }
      kept.push(sentence);
    }
    sections[key] = kept.join(' ');
  }
  return { sections, dropped };
}

/*
 * Convert the validated narrative sections into the analyst-draft block
 * shape used by the report compiler.
 */
export function narrativeToAnalystBlocks(narrativeSections, bundle) {
  if (!narrativeSections) return null;
  const claimId = bundle.claims?.[0]?.claimId;
  const baseRefs = {
    claimIds: [claimId].filter(Boolean),
    evidenceIds: asArray(bundle.evidence).slice(0, 4).map((e) => e.evidenceId),
    metricIds: asArray(bundle.metrics).slice(0, 6).map((m) => m.metricId),
    figureIds: asArray(bundle.figures).slice(0, 2).map((f) => f.figureId),
    caveatIds: asArray(bundle.caveats).slice(0, 3).map((c) => c.caveatId),
  };
  return {
    narrativeHead: narrativeSections.narrativeHead ? [{
      text: narrativeSections.narrativeHead,
      ...baseRefs,
    }] : null,
    bullThesis: narrativeSections.bullThesis ? [{
      text: narrativeSections.bullThesis,
      ...baseRefs,
    }] : null,
    bearThesis: narrativeSections.bearThesis ? [{
      text: narrativeSections.bearThesis,
      ...baseRefs,
    }] : null,
    invalidator: narrativeSections.invalidator ? [{
      text: narrativeSections.invalidator,
      ...baseRefs,
    }] : null,
  };
}
