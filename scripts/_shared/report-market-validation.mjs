import { ensureResearchOsSchema } from './adjacency-graph.mjs';
import { persistEvidenceBundles } from './evidence-collector.mjs';
import { resolveReportIssuerUniverse } from './report-issuer-universe.mjs';

const DECISION_TSTAT = 1.96;
const SCREENING_TSTAT = 1.25;
const ANOMALOUS_TSTAT_WITHOUT_REGIME = 12;
const MIN_CONTROLS = 30;
const MIN_EVENTS = 5;
const MARKET_QUOTE_BENCHMARK_SYMBOLS = Object.freeze(['SPY', 'QQQ', 'XLI', 'XLU']);
const REPORT_SCOPED_MARKET_HORIZON_BARS = 5;
const REPORT_SCOPED_MARKET_MAX_EVENTS = 80;

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function compactUnique(values) {
  return [...new Set(asArray(values).flat().filter((value) => value != null && String(value).trim()).map((value) => String(value).trim()))];
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function absNumber(value) {
  const numeric = numberOrNull(value);
  return numeric == null ? 0 : Math.abs(numeric);
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function mean(values = []) {
  const nums = asArray(values).map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function stddev(values = []) {
  const nums = asArray(values).map(Number).filter(Number.isFinite);
  if (nums.length < 2) return null;
  const avg = mean(nums);
  const variance = nums.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

function isoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function daysBetween(left, right) {
  const a = new Date(`${left}T00:00:00Z`).getTime();
  const b = new Date(`${right}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.round((a - b) / 86_400_000);
}

function firstIndexOnOrAfter(series = [], date) {
  let lo = 0;
  let hi = series.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (series[mid].date >= date) {
      best = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return best;
}

function forwardReturnForDate(series = [], date, horizonBars = REPORT_SCOPED_MARKET_HORIZON_BARS) {
  const startIndex = firstIndexOnOrAfter(series, date);
  if (startIndex < 0 || startIndex + horizonBars >= series.length) return null;
  const start = Number(series[startIndex].price);
  const end = Number(series[startIndex + horizonBars].price);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) return null;
  return ((end / start) - 1) * 100;
}

function metadataOf(value) {
  return value && typeof value === 'object' ? value.metadata || {} : {};
}

function reportSubjectKey(artifact) {
  const bundle = artifact?.bundle || {};
  const subject = bundle.subject || {};
  return (
    subject?.key ||
    subject?.id ||
    subject?.subjectId ||
    subject?.display ||
    subject?.displayName ||
    artifact?.manifest?.subjectKey ||
    artifact?.validation?.report?.subjectKey ||
    artifact?.reportId ||
    'report'
  );
}

function reportSubjectDisplay(artifact) {
  const bundle = artifact?.bundle || {};
  const subject = bundle.subject || {};
  const value = (
    subject?.display ||
    subject?.displayName ||
    subject?.title ||
    subject?.key ||
    artifact?.manifest?.subject ||
    artifact?.validation?.report?.subject ||
    reportSubjectKey(artifact)
  );
  if (value && typeof value === 'object') {
    return value.displayName || value.display || value.title || value.key || value.subjectId || reportSubjectKey(artifact);
  }
  return value;
}

function extractThemesFromArtifact(artifact) {
  const bundle = artifact?.bundle || {};
  const subject = bundle.subject || {};
  const metadata = subject.metadata || {};
  const candidates = [
    subject.theme,
    subject.themeKey,
    subject.type === 'theme' ? subject.key : null,
    metadata.theme,
    metadata.themeKey,
    metadata.primaryTheme,
    metadata.ontologyKey,
    metadata.crossTheme?.theme,
    metadata.crossTheme?.themeA,
    metadata.crossTheme?.themeB,
    metadata.themes,
    artifact?.manifest?.theme,
    artifact?.manifest?.themeKey,
    artifact?.validation?.report?.theme,
    artifact?.validation?.report?.themeKey,
  ];
  return compactUnique(candidates)
    .map((value) => String(value).toLowerCase())
    .filter((value) => !['cross-theme', 'symbol', 'report'].includes(value));
}

function extractIssuerUniverseFromArtifact(artifact, options = {}) {
  const resolution = options.issuerResolution || resolveReportIssuerUniverse(artifact, options);
  return compactUnique([
    resolution.issuerUniverse,
    options.issuerUniverse,
  ]).map((value) => value.toUpperCase());
}

function subjectSearchPatterns(artifact, options = {}) {
  const display = reportSubjectDisplay(artifact);
  const key = reportSubjectKey(artifact);
  const issuerResolution = options.issuerResolution || resolveReportIssuerUniverse(artifact, options);
  const tokens = compactUnique([
    display,
    key,
    issuerResolution.eventTerms,
    ...String(display || '')
      .split(/[^A-Za-z0-9]+/)
      .filter((token) => token.length >= 4),
  ]).slice(0, 16);
  return tokens.map((token) => `%${String(token).toLowerCase()}%`);
}

function reportScopedEventPatterns(artifact, options = {}) {
  const display = reportSubjectDisplay(artifact);
  const key = reportSubjectKey(artifact);
  const issuerResolution = options.issuerResolution || resolveReportIssuerUniverse(artifact, options);
  const rawTerms = compactUnique([
    display,
    key,
    issuerResolution.eventTerms,
  ]);
  const terms = rawTerms
    .map((term) => String(term || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((term) => {
      if (!term || term.length < 8 || term.length > 90) return false;
      if (/[.!?]/.test(term)) return false;
      const words = term.split(/\s+/).filter(Boolean);
      if (words.length >= 2) return true;
      return /\b(interconnection|substation|transmission|queue|grid|datacenter|data center|power|utility)\b/i.test(term);
    });
  return compactUnique(terms)
    .slice(0, 20)
    .map((term) => `%${term}%`);
}

function reportScopedEventTokens(artifact, options = {}) {
  const display = reportSubjectDisplay(artifact);
  const key = reportSubjectKey(artifact);
  const issuerResolution = options.issuerResolution || resolveReportIssuerUniverse(artifact, options);
  const domainTokenRe = /\b(interconnection|queue|grid|transmission|substation|utility|utilities|rto|iso|load|power|datacenter|data center|cluster|tariff|permit|permitting|study|studies)\b/gi;
  const text = compactUnique([display, key, issuerResolution.eventTerms]).join(' ').toLowerCase();
  const matches = text.match(domainTokenRe) || [];
  return compactUnique(matches.map((token) => token.toLowerCase().replace(/\s+/g, ' ').trim()))
    .filter((token) => !['study', 'studies'].includes(token))
    .slice(0, 12);
}

function hasControlType(row, pattern) {
  return asArray(row?.controls)
    .concat(asArray(row?.controlTypes))
    .concat(asArray(row?.metadata?.controls))
    .concat(asArray(row?.metadata?.controlTypes))
    .some((value) => pattern.test(String(value || '')));
}

function rowSampleSize(row) {
  const metadata = metadataOf(row);
  return (
    numberOrNull(row.sampleSize) ||
    numberOrNull(row.nControls) ||
    numberOrNull(row.n_controls) ||
    numberOrNull(row.controlCount) ||
    numberOrNull(metadata.sampleSize) ||
    numberOrNull(metadata.nControls) ||
    numberOrNull(metadata.n_controls) ||
    numberOrNull(metadata.controlCount) ||
    0
  );
}

function rowEventCount(row) {
  const metadata = metadataOf(row);
  return (
    numberOrNull(row.eventCount) ||
    numberOrNull(row.event_count) ||
    numberOrNull(metadata.eventCount) ||
    numberOrNull(metadata.event_count) ||
    numberOrNull(row.nEvents) ||
    numberOrNull(metadata.nEvents) ||
    0
  );
}

function hasRealControls(row) {
  return (
    hasControlType(row, /matched_controls|benchmark|control/i) &&
    (hasControlType(row, /factor|macro|regime|sector|industry/i) || asArray(row?.controls).length >= 2)
  );
}

function regimeSupportCount(row = {}) {
  const metadata = metadataOf(row);
  const directCount = (
    numberOrNull(row.regimeSupportCount) ??
    numberOrNull(row.regime_support_count) ??
    numberOrNull(metadata.regimeSupportCount) ??
    numberOrNull(metadata.regime_support_count)
  );
  if (directCount != null) return directCount;
  const regimes = asArray(metadata.regimeControls?.regimes || metadata.regimes || row.regimeControls?.regimes || row.regimes);
  return regimes.length;
}

function hasRegimeConsistencyEvidence(row = {}) {
  return regimeSupportCount(row) > 0
    || Boolean(row.regimeConsistent || row.regime_consistent || row.metadata?.regimeConsistent || row.metadata?.regime_consistent)
    || !/^(not_attached|no_regime|none|)$/i.test(String(row.regimeConsistencyGrade || row.regime_consistency_grade || row.metadata?.regimeConsistencyGrade || ''));
}

function marketStatAnomalyReason(row = {}) {
  const absT = absNumber(normalizedTStat(row));
  if (absT >= ANOMALOUS_TSTAT_WITHOUT_REGIME && !hasRegimeConsistencyEvidence(row)) {
    return 'extreme_tstat_without_regime_consistency';
  }
  return null;
}

function validationStatus(row) {
  return String(row?.validationStatus || row?.validation_status || row?.metadata?.validationStatus || '').toLowerCase();
}

function normalizedTStat(row) {
  return (
    numberOrNull(row.tStat) ||
    numberOrNull(row.t_stat) ||
    numberOrNull(row.aggregateTStat) ||
    numberOrNull(row.aggregate_t_stat) ||
    numberOrNull(row.metadata?.tStat) ||
    numberOrNull(row.metadata?.aggregateTStat) ||
    numberOrNull(row.metadata?.aggregate_t_stat) ||
    0
  );
}

function isDecisionGradeRow(row) {
  return (
    validationStatus(row) === 'validated' &&
    absNumber(normalizedTStat(row)) >= DECISION_TSTAT &&
    rowSampleSize(row) >= MIN_CONTROLS &&
    rowEventCount(row) >= MIN_EVENTS &&
    hasRealControls(row) &&
    !marketStatAnomalyReason(row)
  );
}

function isScreeningGradeRow(row) {
  return (
    validationStatus(row) === 'validated' &&
    absNumber(normalizedTStat(row)) >= SCREENING_TSTAT &&
    rowSampleSize(row) >= MIN_CONTROLS &&
    hasRealControls(row)
  );
}

function isWeakScreenRow(row) {
  return rowSampleSize(row) > 0 || absNumber(normalizedTStat(row)) > 0;
}

export function normalizeMarketValidationRow(row = {}) {
  const metadata = metadataOf(row);
  const embedded = metadata.marketValidationRow || metadata.marketValidation?.row || {};
  const merged = { ...embedded, ...row };
  const controls = compactUnique([
    merged.controls,
    merged.controlTypes,
    metadata.controls,
    metadata.controlTypes,
    embedded.controls,
    embedded.controlTypes,
  ]);
  const sampleSize = rowSampleSize(merged);
  const eventCount = rowEventCount(merged);
  const tStat = normalizedTStat(merged);
  return {
    ...merged,
    symbol: merged.symbol ? String(merged.symbol).toUpperCase() : 'MARKET',
    eventWindow: merged.eventWindow || merged.horizon || merged.window || metadata.horizon || 'event_window',
    relativeReturnPct:
      numberOrNull(merged.relativeReturnPct) ??
      numberOrNull(merged.relative_return_pct) ??
      numberOrNull(merged.avgUpliftPct) ??
      numberOrNull(merged.avg_uplift_pct),
    tStat,
    sampleSize,
    nControls: sampleSize,
    eventCount,
    controls,
    validationStatus: validationStatus(merged) || (sampleSize >= MIN_CONTROLS ? 'validated' : 'screened'),
    statisticalAnomaly: marketStatAnomalyReason(merged),
    metadata: {
      ...metadata,
      ...embedded.metadata,
      marketValidationSource: metadata.marketValidationSource || merged.marketValidationSource || 'local',
    },
  };
}

export function classifyMarketValidationRows(rows = []) {
  const normalizedRows = asArray(rows).map(normalizeMarketValidationRow).filter(Boolean);
  const decisionRows = normalizedRows.filter(isDecisionGradeRow);
  const screeningRows = normalizedRows.filter((row) => !isDecisionGradeRow(row) && isScreeningGradeRow(row));
  const weakRows = normalizedRows.filter((row) => !isDecisionGradeRow(row) && !isScreeningGradeRow(row) && isWeakScreenRow(row));
  const anomalyRows = normalizedRows.filter((row) => row.statisticalAnomaly);
  const tier = decisionRows.length
    ? 'decision_grade'
    : screeningRows.length
      ? 'screening_grade'
      : weakRows.length
        ? 'weak_screen'
        : 'missing';
  const evidenceUse =
    tier === 'decision_grade'
      ? 'promotion_candidate'
      : tier === 'screening_grade'
        ? 'supporting_context'
        : tier === 'weak_screen'
          ? 'weak_noise'
          : 'missing';
  return {
    tier,
    evidenceUse,
    rowCount: normalizedRows.length,
    decisionGradeRowCount: decisionRows.length,
    screeningGradeRowCount: screeningRows.length,
    weakRowCount: weakRows.length,
    statisticalAnomalyCount: anomalyRows.length,
    maxAbsTStat: normalizedRows.reduce((max, row) => Math.max(max, absNumber(normalizedTStat(row))), 0),
    maxSampleSize: normalizedRows.reduce((max, row) => Math.max(max, rowSampleSize(row)), 0),
    maxEventCount: normalizedRows.reduce((max, row) => Math.max(max, rowEventCount(row)), 0),
    rows: normalizedRows,
    decisionRows,
    screeningRows,
    weakRows,
    anomalyRows,
  };
}

function marketValidationMissingReason(profile = {}, context = {}) {
  if (profile.tier !== 'missing') {
    if (profile.statisticalAnomalyCount > 0 && profile.tier !== 'decision_grade') return 'statistical_anomaly_without_regime_support';
    if (profile.tier === 'weak_screen' && profile.maxSampleSize < MIN_CONTROLS) return 'weak_controls';
    if (profile.tier === 'weak_screen' && profile.maxAbsTStat < SCREENING_TSTAT) return 'below_tstat';
    return null;
  }
  if (!asArray(context.issuerUniverse).length) return 'no_issuer_universe';
  if (context.clientAvailable === false) return 'no_market_client';
  if (context.eventCandidateCount === 0) return 'no_event_candidates';
  if (Number(context.localRowCount || 0) + Number(context.bundleRowCount || 0) <= 0) return 'no_event_uplift_rows';
  if (profile.maxSampleSize > 0 && profile.maxSampleSize < MIN_CONTROLS) return 'weak_controls';
  if (profile.maxAbsTStat > 0 && profile.maxAbsTStat < SCREENING_TSTAT) return 'below_tstat';
  return 'no_event_uplift_rows';
}

function marketValidationNextAction(missingReason) {
  return {
    no_issuer_universe: 'resolve issuer universe before running controlled market validation',
    no_market_client: 'run market validation with a DB client so event_uplift and matched controls can be queried',
    no_event_candidates: 'create or link canonical event candidates for the report subject before event_uplift can be computed',
    no_event_uplift_rows: 'run repair-recent-event-uplift or event-control build for the report event/symbol candidates',
    weak_controls: 'build additional matched_controls rows before treating market validation as decision grade',
    below_tstat: 'keep market validation as weak/context until controlled abnormal returns clear the t-stat gate',
    statistical_anomaly_without_regime_support: 'attach regime-consistency evidence or recompute event windows before treating extreme t-stat rows as decision grade',
  }[missingReason] || null;
}

export function marketReactionFromEvidenceRow(row = {}) {
  const metadata = metadataOf(row);
  const marketRow = metadata.marketValidationRow || metadata.marketValidation?.row || metadata.marketValidation || row;
  return normalizeMarketValidationRow({
    ...marketRow,
    metadata: {
      ...metadata,
      ...(marketRow.metadata || {}),
      reportBackfillPackName: metadata.reportBackfillPackName || metadata.packName,
      desiredEvidenceClass: metadata.desiredEvidenceClass || 'market_validation',
      evidenceUse: metadata.evidenceUse,
    },
  });
}

export function buildBundleMarketValidationRows(bundle = {}) {
  return asArray(bundle.marketReactions).map((row) =>
    normalizeMarketValidationRow({
      ...row,
      metadata: {
        ...(row.metadata || {}),
        marketValidationSource: 'bundle.marketReactions',
      },
    }),
  );
}

export async function loadLocalMarketValidationRows(client, artifact = {}, options = {}) {
  if (!client?.query) return [];
  const themes = extractThemesFromArtifact(artifact);
  const issuerResolution = options.issuerResolution || resolveReportIssuerUniverse(artifact, options);
  const symbols = extractIssuerUniverseFromArtifact(artifact, { ...options, issuerResolution });
  if (!symbols.length) return [];
  const patterns = subjectSearchPatterns(artifact, { ...options, issuerResolution });
  const maxRows = Number(options.limit || 50);
  const lookbackDays = Number(options.lookbackDays || 730);
  const sql = `
    SELECT
      eu.symbol,
      COALESCE(eu.horizon, 'event_window') AS horizon,
      COUNT(*)::int AS event_count,
      SUM(COALESCE(eu.n_controls, 0))::int AS n_controls,
      AVG(eu.uplift)::float AS avg_uplift_pct,
      AVG(eu.event_alpha)::float AS avg_event_alpha,
      AVG(eu.control_avg_return)::float AS avg_control_return,
      MAX(ABS(COALESCE(eu.t_stat, 0)))::float AS max_abs_t_stat,
      CASE
        WHEN STDDEV_POP(eu.uplift) IS NULL OR STDDEV_POP(eu.uplift) = 0 THEN MAX(eu.t_stat)::float
        ELSE (AVG(eu.uplift) / NULLIF(STDDEV_POP(eu.uplift), 0) * SQRT(COUNT(*)))::float
      END AS aggregate_t_stat,
      MAX(eu.evidence_grade) AS evidence_grade,
      MAX(ce.event_date) AS latest_event_date,
      ARRAY_AGG(DISTINCT ce.theme) FILTER (WHERE ce.theme IS NOT NULL) AS themes
    FROM event_uplift eu
    JOIN canonical_events ce ON ce.id = eu.canonical_event_id
    WHERE eu.evidence_grade IN ('E2', 'E3', 'E4')
      AND ce.event_date >= CURRENT_DATE - make_interval(days => $5::int)
      AND (
        cardinality($1::text[]) = 0
        OR ce.theme = ANY($1::text[])
        OR lower(COALESCE(ce.representative_title, '')) ILIKE ANY($3::text[])
      )
      AND (cardinality($2::text[]) = 0 OR eu.symbol = ANY($2::text[]))
    GROUP BY eu.symbol, COALESCE(eu.horizon, 'event_window')
    ORDER BY MAX(ABS(COALESCE(eu.t_stat, 0))) DESC NULLS LAST, SUM(COALESCE(eu.n_controls, 0)) DESC
    LIMIT $4::int
  `;
  const { rows } = await client.query(sql, [themes, symbols, patterns.length ? patterns : ['%'], maxRows, lookbackDays]);
  return asArray(rows).map((row) =>
    normalizeMarketValidationRow({
      symbol: row.symbol,
      eventWindow: row.horizon,
      relativeReturnPct: row.avg_uplift_pct,
      tStat: row.aggregate_t_stat || row.max_abs_t_stat,
      sampleSize: row.n_controls,
      nControls: row.n_controls,
      eventCount: row.event_count,
      controls: ['matched_controls', 'macro_regime_matched_controls'],
      validationStatus: row.n_controls >= MIN_CONTROLS ? 'validated' : 'screened',
      metadata: {
        marketValidationSource: 'event_uplift',
        evidenceGrade: row.evidence_grade,
        latestEventDate: row.latest_event_date,
        themes: row.themes || [],
        avgEventAlpha: row.avg_event_alpha,
        avgControlReturn: row.avg_control_return,
      },
    }),
  );
}

export async function loadReportScopedMarketQuoteValidationRows(client, artifact = {}, options = {}) {
  if (!client?.query) return [];
  const issuerResolution = options.issuerResolution || resolveReportIssuerUniverse(artifact, options);
  const symbols = extractIssuerUniverseFromArtifact(artifact, { ...options, issuerResolution });
  if (!symbols.length) return [];
  const patterns = reportScopedEventPatterns(artifact, { ...options, issuerResolution });
  if (!patterns.length) return [];
  const lookbackDays = Number(options.lookbackDays || 730);
  const eventLimit = Math.max(MIN_EVENTS, Math.min(REPORT_SCOPED_MARKET_MAX_EVENTS, Number(options.eventLimit || REPORT_SCOPED_MARKET_MAX_EVENTS)));
  const eventSql = `
    SELECT DISTINCT ce.event_date::date AS event_date,
           MAX(ce.representative_title) AS representative_title,
           COUNT(*)::int AS event_rows
      FROM canonical_events ce
     WHERE ce.event_date >= CURRENT_DATE - make_interval(days => $2::int)
       AND lower(COALESCE(ce.representative_title, '')) ILIKE ANY($1::text[])
     GROUP BY ce.event_date::date
     ORDER BY ce.event_date::date DESC
     LIMIT $3::int
  `;
  const eventResult = await client.query(eventSql, [patterns, lookbackDays, eventLimit]);
  let eventRows = asArray(eventResult.rows);
  let eventDates = compactUnique(eventRows.map((row) => isoDate(row.event_date)));
  const tokenTerms = reportScopedEventTokens(artifact, { ...options, issuerResolution });
  if (eventDates.length < MIN_EVENTS && tokenTerms.length) {
    const tokenSql = `
      SELECT DISTINCT ce.event_date::date AS event_date,
             MAX(ce.representative_title) AS representative_title,
             COUNT(*)::int AS event_rows
        FROM canonical_events ce
       WHERE ce.event_date >= CURRENT_DATE - make_interval(days => $2::int)
         AND (
           SELECT COUNT(*)
             FROM UNNEST($1::text[]) AS token(term)
            WHERE lower(COALESCE(ce.representative_title, '')) LIKE '%' || token.term || '%'
         ) >= $4::int
       GROUP BY ce.event_date::date
       ORDER BY ce.event_date::date DESC
       LIMIT $3::int
    `;
    const minTokenHits = tokenTerms.length >= 2 ? 1 : 1;
    const tokenResult = await client.query(tokenSql, [tokenTerms, lookbackDays, eventLimit, minTokenHits]);
    eventRows = asArray(tokenResult.rows);
    eventDates = compactUnique(eventRows.map((row) => isoDate(row.event_date)));
  }
  if (eventDates.length < MIN_EVENTS) return [];

  const quoteSymbols = compactUnique([...symbols, ...MARKET_QUOTE_BENCHMARK_SYMBOLS].map((item) => String(item || '').toUpperCase()));
  const quoteSql = `
    SELECT symbol,
           DATE(observed_at)::date AS trade_date,
           AVG(last_price)::double precision AS price
      FROM market_quotes
     WHERE symbol = ANY($1::text[])
       AND observed_at >= CURRENT_DATE - make_interval(days => $2::int)
       AND last_price IS NOT NULL
     GROUP BY symbol, DATE(observed_at)
     ORDER BY symbol, DATE(observed_at)
  `;
  const quoteResult = await client.query(quoteSql, [quoteSymbols, lookbackDays + 45]);
  const seriesBySymbol = new Map();
  for (const row of asArray(quoteResult.rows)) {
    const symbol = String(row.symbol || '').toUpperCase();
    const date = isoDate(row.trade_date);
    const price = Number(row.price);
    if (!symbol || !date || !Number.isFinite(price) || price <= 0) continue;
    if (!seriesBySymbol.has(symbol)) seriesBySymbol.set(symbol, []);
    seriesBySymbol.get(symbol).push({ date, price });
  }
  for (const series of seriesBySymbol.values()) {
    series.sort((left, right) => left.date.localeCompare(right.date));
  }

  const benchmarkReturn = (date) => {
    const returns = MARKET_QUOTE_BENCHMARK_SYMBOLS
      .map((symbol) => forwardReturnForDate(seriesBySymbol.get(symbol) || [], date))
      .filter(Number.isFinite);
    return mean(returns);
  };
  const eventDateSet = new Set(eventDates);
  const nearEvent = (date) => eventDates.some((eventDate) => Math.abs(daysBetween(date, eventDate)) <= 7);
  const rows = [];
  for (const symbol of symbols) {
    const series = seriesBySymbol.get(symbol) || [];
    if (series.length < MIN_CONTROLS + REPORT_SCOPED_MARKET_HORIZON_BARS) continue;
    const eventAbnormal = [];
    const eventDateSample = [];
    for (const eventDate of eventDates) {
      const issuerReturn = forwardReturnForDate(series, eventDate);
      const basketReturn = benchmarkReturn(eventDate);
      if (!Number.isFinite(issuerReturn) || !Number.isFinite(basketReturn)) continue;
      eventAbnormal.push(issuerReturn - basketReturn);
      if (eventDateSample.length < 8) eventDateSample.push(eventDate);
    }
    const controlAbnormal = [];
    for (const point of series) {
      if (eventDateSet.has(point.date) || nearEvent(point.date)) continue;
      const issuerReturn = forwardReturnForDate(series, point.date);
      const basketReturn = benchmarkReturn(point.date);
      if (!Number.isFinite(issuerReturn) || !Number.isFinite(basketReturn)) continue;
      controlAbnormal.push(issuerReturn - basketReturn);
    }
    if (eventAbnormal.length < 1 || controlAbnormal.length < 2) continue;
    const eventMean = mean(eventAbnormal);
    const controlMean = mean(controlAbnormal);
    const controlStd = stddev(controlAbnormal);
    const uplift = eventMean - controlMean;
    const tStat = controlStd && controlStd > 0
      ? uplift / (controlStd / Math.sqrt(Math.max(1, eventAbnormal.length)))
      : 0;
    rows.push(normalizeMarketValidationRow({
      symbol,
      eventWindow: `${REPORT_SCOPED_MARKET_HORIZON_BARS}d`,
      relativeReturnPct: uplift,
      tStat,
      sampleSize: controlAbnormal.length,
      nControls: controlAbnormal.length,
      eventCount: eventAbnormal.length,
      controls: ['market_quotes_report_controls', 'benchmark_spy_qqq', 'sector_factor_xli_xlu'],
      validationStatus: controlAbnormal.length >= MIN_CONTROLS && eventAbnormal.length >= MIN_EVENTS ? 'validated' : 'screened',
      metadata: {
        marketValidationSource: 'market_quotes_report_event_controls',
        eventCandidateCount: eventDates.length,
        eventDateSample,
        eventPatterns: patterns.slice(0, 10),
        eventTokenTerms: tokenTerms,
        benchmarkSymbols: MARKET_QUOTE_BENCHMARK_SYMBOLS,
        avgEventAbnormalReturn: eventMean,
        avgControlAbnormalReturn: controlMean,
        controlStdDev: controlStd,
        reportScoped: true,
      },
    }));
  }
  return rows;
}

async function loadLocalMarketValidationDiagnostics(client, artifact = {}, options = {}) {
  if (!client?.query) return { clientAvailable: false, eventCandidateCount: null };
  const themes = extractThemesFromArtifact(artifact);
  const issuerResolution = options.issuerResolution || resolveReportIssuerUniverse(artifact, options);
  const patterns = subjectSearchPatterns(artifact, { ...options, issuerResolution });
  const lookbackDays = Number(options.lookbackDays || 730);
  const sql = `
    SELECT COUNT(*)::int AS event_candidate_count
    FROM canonical_events ce
    WHERE ce.event_date >= CURRENT_DATE - make_interval(days => $3::int)
      AND (
        cardinality($1::text[]) = 0
        OR ce.theme = ANY($1::text[])
        OR lower(COALESCE(ce.representative_title, '')) ILIKE ANY($2::text[])
      )
  `;
  const { rows } = await client.query(sql, [themes, patterns.length ? patterns : ['%'], lookbackDays]);
  return {
    clientAvailable: true,
    eventCandidateCount: Number(rows?.[0]?.event_candidate_count || 0),
  };
}

export async function buildReportMarketValidation(client, artifact = {}, options = {}) {
  const issuerResolution = options.issuerResolution || resolveReportIssuerUniverse(artifact, options);
  const issuerUniverse = extractIssuerUniverseFromArtifact(artifact, { ...options, issuerResolution });
  const issuerSet = new Set(issuerUniverse);
  const bundleRows = buildBundleMarketValidationRows(artifact?.bundle || {})
    .filter((row) => issuerSet.has(String(row.symbol || '').toUpperCase()));
  let localRows = [];
  let quoteRows = [];
  let diagnostics = { clientAvailable: Boolean(client?.query), eventCandidateCount: null };
  try {
    localRows = issuerUniverse.length
      ? await loadLocalMarketValidationRows(client, artifact, { ...options, issuerResolution })
      : [];
    quoteRows = issuerUniverse.length && !localRows.length
      ? await loadReportScopedMarketQuoteValidationRows(client, artifact, { ...options, issuerResolution })
      : [];
    diagnostics = await loadLocalMarketValidationDiagnostics(client, artifact, { ...options, issuerResolution });
  } catch (error) {
    if (options.strict) throw error;
    localRows = [];
    quoteRows = [];
    diagnostics = { ...diagnostics, error: String(error?.message || error) };
  }
  const profile = classifyMarketValidationRows([...localRows, ...quoteRows, ...bundleRows]);
  const missingReason = marketValidationMissingReason(profile, {
    ...diagnostics,
    issuerUniverse,
    localRowCount: localRows.length + quoteRows.length,
    bundleRowCount: bundleRows.length,
  });
  return {
    ...profile,
    missingReason,
    nextAction: marketValidationNextAction(missingReason),
    localRowCount: localRows.length + quoteRows.length,
    eventUpliftRowCount: localRows.length,
    marketQuoteRowCount: quoteRows.length,
    bundleRowCount: bundleRows.length,
    themes: extractThemesFromArtifact(artifact),
    issuerUniverse,
    issuerResolution,
    eventCandidateCount: diagnostics.eventCandidateCount,
    diagnostic: diagnostics,
    subjectKey: reportSubjectKey(artifact),
    subjectDisplay: reportSubjectDisplay(artifact),
  };
}

async function ensureMarketValidationQuestion(client, artifact = {}) {
  await ensureResearchOsSchema(client);
  const subjectKey = reportSubjectKey(artifact);
  const subjectDisplay = reportSubjectDisplay(artifact);
  const theme = extractThemesFromArtifact(artifact)[0] || 'market_validation';
  const deterministicId = `report-market-validation:${slug(artifact?.reportId || subjectKey)}`;
  const sql = `
    INSERT INTO research_questions (
      deterministic_id,
      question_type,
      themes,
      seed_terms,
      prompt,
      trigger_reason,
      priority_score,
      status,
      metadata
    ) VALUES ($1, 'market_validation', $2, $3, $4, 'report_market_validation', 4, 'active', $5::jsonb)
    ON CONFLICT (deterministic_id) WHERE deterministic_id IS NOT NULL DO UPDATE SET
      themes = EXCLUDED.themes,
      seed_terms = EXCLUDED.seed_terms,
      prompt = EXCLUDED.prompt,
      updated_at = now(),
      metadata = research_questions.metadata || EXCLUDED.metadata
    RETURNING id
  `;
  const { rows } = await client.query(sql, [
    deterministicId,
    [theme],
    [subjectDisplay, subjectKey].filter(Boolean),
    `Local controlled market validation for ${subjectDisplay}`,
    JSON.stringify({
      reportId: artifact?.reportId,
      reportSubjectKey: subjectKey,
      desiredEvidenceClass: 'market_validation',
      deterministicId,
    }),
  ]);
  return rows?.[0]?.id;
}

function rowEvidenceUse(row) {
  if (isDecisionGradeRow(row)) return 'promotion_candidate';
  if (isScreeningGradeRow(row)) return 'supporting_context';
  if (isWeakScreenRow(row)) return 'weak_noise';
  return 'weak_noise';
}

export async function persistReportMarketValidation(client, artifact = {}, profile = {}, options = {}) {
  if (!client?.query || !profile?.rows?.length || options.dryRun) return { persisted: 0, skipped: true };
  const questionId = await ensureMarketValidationQuestion(client, artifact);
  if (!questionId) return { persisted: 0, skipped: true };
  const reportId = artifact?.reportId || artifact?.validation?.report?.id || artifact?.manifest?.reportId || reportSubjectKey(artifact);
  const subjectKey = reportSubjectKey(artifact);
  const subjectDisplay = reportSubjectDisplay(artifact);
  const bundles = profile.rows.slice(0, Number(options.persistLimit || 20)).map((row) => {
    const normalized = normalizeMarketValidationRow(row);
    const evidenceUse = rowEvidenceUse(normalized);
    const sourceId = `${reportId}:market-validation:${normalized.symbol}:${slug(normalized.eventWindow)}`;
    return {
      questionId,
      sourceType: 'local-market-validation',
      sourceId,
      title: `${normalized.symbol} ${normalized.eventWindow} controlled market validation`,
      textExcerpt: [
        `Controlled market validation tier=${profile.tier}.`,
        `symbol=${normalized.symbol}; window=${normalized.eventWindow}; t_stat=${Number(normalized.tStat || 0).toFixed(2)}; controls=${normalized.nControls || 0}; events=${normalized.eventCount || 0}.`,
      ].join(' '),
      url: null,
      publishedAt: normalized.metadata?.latestEventDate || null,
      relevanceScore: evidenceUse === 'promotion_candidate' ? 0.95 : evidenceUse === 'supporting_context' ? 0.72 : 0.38,
      metadata: {
        reportId,
        reportSubjectKey: subjectKey,
        reportSubjectDisplay: subjectDisplay,
        reportBackfillPackName: 'marketPack',
        packName: 'marketPack',
        desiredEvidenceClass: 'market_validation',
        evidenceUse,
        providerRoutePlan: {
          evidenceClass: 'market_validation',
          providerRoute: 'market_validation',
          executableCollectors: ['local-market-validation'],
          sourceProviders: ['event_uplift', 'matched_controls', 'market_returns', 'market_quotes'],
          promotionEligible: evidenceUse === 'promotion_candidate',
          issuerUniverse: profile.issuerUniverse || [],
        },
        marketValidation: {
          tier: profile.tier,
          evidenceUse: profile.evidenceUse,
          missingReason: profile.missingReason || null,
          nextAction: profile.nextAction || null,
          row,
          profileSummary: {
            rowCount: profile.rowCount,
            decisionGradeRowCount: profile.decisionGradeRowCount,
            screeningGradeRowCount: profile.screeningGradeRowCount,
            weakRowCount: profile.weakRowCount,
            maxAbsTStat: profile.maxAbsTStat,
            maxSampleSize: profile.maxSampleSize,
            maxEventCount: profile.maxEventCount,
          },
        },
      },
    };
  });
  await persistEvidenceBundles(client, bundles);
  return { persisted: bundles.length, skipped: false };
}

async function persistMarketValidationRepairIntent(client, artifact = {}, profile = {}, options = {}) {
  if (!client?.query || options.dryRun || !['no_event_candidates', 'no_event_uplift_rows'].includes(profile?.missingReason)) {
    return { persisted: 0, skipped: true };
  }
  await ensureResearchOsSchema(client);
  const reportId = artifact?.reportId || artifact?.validation?.report?.id || artifact?.manifest?.reportId || reportSubjectKey(artifact);
  const subjectKey = reportSubjectKey(artifact);
  const subjectDisplay = reportSubjectDisplay(artifact);
  const deterministicId = `report-market-validation-repair:${slug(reportId || subjectKey)}:${profile.missingReason}`;
  const themes = extractThemesFromArtifact(artifact);
  const seedTerms = [subjectDisplay, subjectKey, ...themes, ...asArray(profile.issuerUniverse)].filter(Boolean).slice(0, 24);
  const { rows } = await client.query(
    `INSERT INTO research_questions (
       deterministic_id, question_type, themes, seed_terms, prompt, trigger_reason,
       priority_score, status, metadata
     ) VALUES ($1, 'market_validation_repair', $2, $3, $4, 'report_market_validation_repair', 4.5, 'new', $5::jsonb)
     ON CONFLICT (deterministic_id) WHERE deterministic_id IS NOT NULL DO UPDATE SET
       themes = EXCLUDED.themes,
       seed_terms = EXCLUDED.seed_terms,
       prompt = EXCLUDED.prompt,
       metadata = research_questions.metadata || EXCLUDED.metadata,
       updated_at = now()
     RETURNING id`,
    [
      deterministicId,
      themes,
      seedTerms,
      `Create or repair controlled event/uplift rows for ${subjectDisplay} across ${asArray(profile.issuerUniverse).join(', ') || 'resolved issuers'}.`,
      JSON.stringify({
        reportId,
        reportSubjectKey: subjectKey,
        reportSubjectDisplay: subjectDisplay,
        desiredEvidenceClass: 'market_validation',
        missingReason: profile.missingReason,
        nextAction: profile.nextAction,
        issuerUniverse: profile.issuerUniverse || [],
        eventCandidateCount: profile.eventCandidateCount ?? null,
        repairKind: profile.missingReason === 'no_event_candidates' ? 'create_report_scoped_event_candidates' : 'build_event_uplift_rows',
        sourceBoundary: 'Repair intent only; market_validation promotion still requires local event_uplift and matched_controls rows.',
      }),
    ],
  );
  return { persisted: rows.length ? 1 : 0, skipped: false, questionId: rows[0]?.id || null };
}

export async function runReportMarketValidation(client, artifact = {}, options = {}) {
  const profile = await buildReportMarketValidation(client, artifact, options);
  const persistence = await persistReportMarketValidation(client, artifact, profile, options);
  const repairIntent = await persistMarketValidationRepairIntent(client, artifact, profile, options);
  return {
    ok: true,
    profile,
    persisted: persistence.persisted || 0,
    repairIntent,
    skipped: Boolean(persistence.skipped),
  };
}
