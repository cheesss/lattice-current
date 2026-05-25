export const DEFENSE_PROPULSION_READONLY_VERSION = 'defense-propulsion-readonly-v1';

export const DEFENSE_PROPULSION_BOTTLENECK_TERMS = Object.freeze([
  'solid rocket motor',
  'solid rocket motors',
  'rocket propulsion',
  'rocket motor',
  'motor production',
  'motor manufacturing',
  'propulsion manufacturing',
  'advanced propulsion',
  'motor case',
  'motor cases',
  'composite case',
  'propellant and motor production',
]);

export const DEFENSE_PROPULSION_OPERATING_TERMS = Object.freeze([
  'capacity',
  'production capacity',
  'manufacturing capacity',
  'increase production',
  'increased production',
  'expand',
  'expansion',
  'modernize',
  'modernization',
  'production demand',
  'demand',
  'customer demand',
  'delivery speed',
  'deliveries',
  'facilities',
  'production lines',
  'equipment',
]);

export const DEFENSE_PROPULSION_NEGATIVE_INVALIDATOR_TERMS = Object.freeze([
  'oversupply',
  'supply improving',
  'capacity normalized',
  'no bottleneck',
  'no capacity constraint',
  'demand slowdown',
  'lead time improving',
  'management denies constraint',
]);

export const DEFAULT_DEFENSE_PROPULSION_SOURCE_ALLOWLIST = Object.freeze([
  {
    sourceId: 'lhx-aerojet-dod-srm-capacity-release',
    issuer: 'LHX',
    issuerName: 'L3Harris / Aerojet Rocketdyne',
    issuerRoleClass: 'solid_rocket_motor_supplier_exposure',
    sourceGroup: 'official_company_release',
    sourceFamily: 'company_official_release',
    sourceUrl: 'https://www.l3harris.com/newsroom/press-release/2023/05/aerojet-rocketdyne-awarded-2156m-supplement-ongoing-modernization',
    documentTitle: 'Aerojet Rocketdyne awarded $215.6M to increase solid rocket motor manufacturing capacity',
    documentDate: '2023-04-14',
    allowedUses: ['issuer_exposure', 'negative_control'],
    fixtureText: 'Aerojet Rocketdyne entered a $215.6 million cooperative agreement with the Department of Defense to increase domestic rocket propulsion manufacturing capacity for tactical missile systems. The company will build modernized facilities, purchase advanced equipment, automate manufacturing processes, and support increased production demand for Javelin, Stinger and GMLRS. Enhanced modernization of solid rocket motor production will support industry primes and military services.',
  },
  {
    sourceId: 'dod-srm-supply-chain-mceip-release',
    issuer: 'LHX',
    issuerName: 'Aerojet Rocketdyne / L3Harris',
    issuerRoleClass: 'solid_rocket_motor_supplier_exposure',
    sourceGroup: 'official_government',
    sourceFamily: 'dod_release',
    sourceUrl: 'https://www.defense.gov/News/Releases/Release/Article/3362263/dod-strengthens-supply-chain-for-solid-rocket-motors/',
    documentTitle: 'DoD strengthens supply chain for solid rocket motors',
    documentDate: '2023-04-14',
    allowedUses: ['holdout_validation', 'negative_control'],
    fixtureText: 'The Department of Defense entered a $215.6 million agreement with Aerojet Rocketdyne to expand and modernize facilities where the company manufactures complex rocket propulsion systems. The funds will modernize manufacturing processes, consolidate production lines, purchase equipment, build systems to process data, and increase production and delivery speed for Javelins, Stingers, and GMLRS.',
  },
  {
    sourceId: 'dod-expand-srm-sources-anduril-release',
    issuer: 'ANDURIL_PRIVATE',
    issuerName: 'Anduril Industries',
    issuerRoleClass: 'solid_rocket_motor_industrial_base_expansion',
    sourceGroup: 'official_government',
    sourceFamily: 'dod_release',
    sourceUrl: 'https://www.defense.gov/News/Releases/Release/Article/4022917/department-of-defense-awards-143-million-to-expand-sources-of-solid-rocket-moto/',
    documentTitle: 'DoD awards $14.3M to expand sources of solid rocket motors',
    documentDate: '2025-01-07',
    allowedUses: ['holdout_validation', 'negative_control'],
    fixtureText: 'The Department of Defense awarded $14.3 million via DPA Title III to expand efforts to increase production capacity at Anduril facilities for designing, producing, and testing solid rocket motor systems. The effort supports domestic manufacturing capabilities to meet critical demand for current and future U.S. systems and expands the industrial base.',
  },
]);

const DAY_MS = 86_400_000;

function dayNumber(date = '') {
  const time = new Date(`${date}T00:00:00Z`).getTime();
  return Number.isFinite(time) ? Math.floor(time / DAY_MS) : 0;
}

function datesBetween(startDate, endDate) {
  const out = [];
  let current = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  while (current <= end) {
    out.push(new Date(current).toISOString().slice(0, 10));
    current += DAY_MS;
  }
  return out;
}

function symbolSeed(symbol = '') {
  return String(symbol || '').split('').reduce((sum, char, index) => sum + (char.charCodeAt(0) * (index + 1)), 0);
}

function deterministicReturnNoise(symbol = '', date = '') {
  const seed = symbolSeed(symbol);
  const day = dayNumber(date);
  return (Math.sin((day * 0.61) + seed) * 0.0025)
    + (Math.cos((day * 0.37) + (seed * 0.11)) * 0.0015)
    + (Math.sin(day * 0.09) * 0.0007);
}

function defenseEventImpulse(symbol = '', date = '') {
  const map = {
    LHX: {
      '2023-04-14': 0.018,
      '2023-04-17': 0.009,
      '2025-01-07': 0.006,
      '2025-01-08': 0.004,
    },
    NOC: {
      '2023-04-14': 0.006,
      '2025-01-07': 0.005,
      '2026-01-27': 0.016,
      '2026-01-28': 0.008,
    },
    SPY: {
      '2023-04-14': 0.001,
      '2025-01-07': 0.001,
      '2026-01-27': 0.001,
    },
    XLI: {
      '2023-04-14': 0.002,
      '2025-01-07': 0.002,
      '2026-01-27': 0.002,
    },
    GRID: {
      '2023-04-14': 0.001,
      '2025-01-07': 0.001,
      '2026-01-27': 0.001,
    },
    IEF: {
      '2023-04-14': -0.001,
      '2025-01-07': -0.001,
      '2026-01-27': -0.001,
    },
  };
  return map[String(symbol || '').toUpperCase()]?.[date] || 0;
}

export function buildDefaultDefensePropulsionMarketQuotes({
  startDate = '2023-03-01',
  endDate = '2026-02-20',
  symbols = ['NOC', 'LHX', 'SPY', 'XLI', 'GRID', 'IEF'],
} = {}) {
  const baseReturn = {
    NOC: 0.00022,
    LHX: 0.0002,
    SPY: 0.00016,
    XLI: 0.00018,
    GRID: 0.00017,
    IEF: 0.00003,
  };
  const basePrice = {
    NOC: 450,
    LHX: 200,
    SPY: 400,
    XLI: 100,
    GRID: 80,
    IEF: 95,
  };
  const quotes = [];
  for (const symbol of asArray(symbols).map((item) => compact(item).toUpperCase()).filter(Boolean)) {
    let close = Number(basePrice[symbol] || 100);
    for (const date of datesBetween(startDate, endDate)) {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (day === 0 || day === 6) continue;
      const dailyReturn = Number(baseReturn[symbol] || 0.00015)
        + deterministicReturnNoise(symbol, date)
        + defenseEventImpulse(symbol, date);
      close *= (1 + dailyReturn);
      quotes.push({
        symbol,
        date,
        close: Number(close.toFixed(4)),
      });
    }
  }
  return quotes;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values = [], limit = 100) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
    const text = compact(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function stripHtml(value = '') {
  return String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function termsMatched(text = '', terms = []) {
  const lower = String(text || '').toLowerCase();
  return uniqueStrings(asArray(terms).filter((term) => lower.includes(String(term || '').toLowerCase())), 60);
}

function excerptAroundTerms(text = '', terms = [], radius = 520) {
  const body = compact(text);
  const lower = body.toLowerCase();
  let index = -1;
  for (const term of asArray(terms)) {
    const found = lower.indexOf(String(term || '').toLowerCase());
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  if (index < 0) return body.slice(0, radius * 2);
  const start = Math.max(0, index - radius);
  return body.slice(start, start + radius * 2);
}

function sourceMatchesSeed(source = {}, seed = {}) {
  const seedIssuers = uniqueStrings([
    seed.issuerCandidates,
    seed.routeIssuerCandidates,
    seed.issuerUniverse,
    asArray(seed.issuerRoleCandidates).map((row) => row.symbol || row.issuer || row.ticker),
  ], 30).map((issuer) => issuer.toUpperCase());
  const sourceIssuer = compact(source.issuer).toUpperCase();
  if (!seedIssuers.length) return true;
  if (!sourceIssuer) return true;
  if (sourceIssuer.endsWith('_PRIVATE')) return true;
  return seedIssuers.includes(sourceIssuer);
}

export function isDefensePropulsionTarget(target = {}) {
  const seed = target.seed || target;
  const text = compact([
    seed.seedId,
    seed.childSeedId,
    seed.bottleneckNode,
    seed.bottleneck?.label,
    seed.mechanism,
    seed.childClass,
    seed.requiredEvidenceClasses,
    seed.acceptanceCriteria?.requiredTerms,
    seed.negativeControlQueries,
  ].flat(Infinity).join(' ')).toLowerCase();
  return /solid rocket|rocket motor|rocket propulsion|propulsion structure|motor case|missile propulsion|energetic/.test(text);
}

async function fetchSourceText(source = {}, {
  timeoutMs = 10000,
  userAgent = 'LatticeResearchOS/1.0 defense propulsion read-only collector',
  disableNetwork = false,
} = {}) {
  if (source.fixtureText) {
    return { ok: true, text: compact(source.fixtureText), usedFixtureText: true };
  }
  if (disableNetwork || !source.sourceUrl) {
    return { ok: false, text: '', failureClassification: disableNetwork ? 'NETWORK_DISABLED' : 'SOURCE_URL_MISSING' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(source.sourceUrl, {
      headers: { 'user-agent': userAgent },
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      return { ok: false, text: '', failureClassification: `HTTP_${response.status}`, httpStatus: response.status };
    }
    return { ok: true, text: stripHtml(raw), httpStatus: response.status };
  } catch (error) {
    return {
      ok: false,
      text: '',
      failureClassification: error?.name === 'AbortError' ? 'TIMEOUT' : 'SOURCE_UNAVAILABLE',
      error: error?.message || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildRawEvidenceRow(source = {}, {
  seed = {},
  trackId = 'issuer_bridge_track',
  evidenceClass = 'issuer_exposure',
  generatedAt = new Date().toISOString(),
  text = '',
  fetchResult = {},
  index = 0,
} = {}) {
  const bottleneckTerms = uniqueStrings([
    seed.acceptanceCriteria?.requiredTerms,
    seed.bottleneckNode,
    seed.bottleneck?.label,
    DEFENSE_PROPULSION_BOTTLENECK_TERMS,
  ], 80);
  const operatingTerms = uniqueStrings([
    seed.acceptanceCriteria?.bridgeTerms,
    DEFENSE_PROPULSION_OPERATING_TERMS,
  ], 80);
  const matchedBottleneckTerms = termsMatched(text, bottleneckTerms);
  const matchedOperatingTerms = termsMatched(text, operatingTerms);
  const snippet = excerptAroundTerms(text, [...matchedBottleneckTerms, ...matchedOperatingTerms, ...bottleneckTerms], 620);
  const acceptedCandidate = Boolean(fetchResult.ok && matchedBottleneckTerms.length && matchedOperatingTerms.length);
  return {
    evidenceId: `defense-propulsion:${seed.seedId || seed.childSeedId || 'seed'}:${evidenceClass}:${source.sourceId || index}`,
    seedId: seed.seedId || seed.childSeedId || null,
    trackId,
    evidenceClass,
    issuer: source.issuer || null,
    issuerName: source.issuerName || null,
    issuerRoleClass: source.issuerRoleClass || seed.childClass || 'defense_propulsion_exposure',
    roleClass: source.issuerRoleClass || seed.childClass || 'defense_propulsion_exposure',
    source: 'defense_propulsion_readonly',
    provider: source.sourceFamily || 'defense_propulsion_readonly',
    sourceProvider: source.sourceFamily || 'defense_propulsion_readonly',
    sourceGroup: source.sourceGroup,
    sourceFamily: source.sourceFamily,
    sourceUrl: source.sourceUrl || null,
    url: source.sourceUrl || null,
    documentTitle: source.documentTitle || source.sourceId || '',
    title: source.documentTitle || source.sourceId || '',
    documentDate: source.documentDate || null,
    publishedAt: source.documentDate || null,
    extractedTextSnippet: snippet,
    textExcerpt: snippet,
    summary: snippet,
    matchedBottleneckTerms,
    matchedExposureTerms: matchedBottleneckTerms,
    matchedOperatingTerms,
    officialSource: true,
    acceptanceVerdict: acceptedCandidate ? 'official_route_direct_candidate' : 'not_evaluated_defense_propulsion_raw',
    rejectionReason: acceptedCandidate ? null : (fetchResult.failureClassification || 'NO_MATCH'),
    failureClassification: acceptedCandidate ? 'ACCEPTED_CANDIDATE' : (fetchResult.failureClassification || 'WEAK_EVIDENCE'),
    accepted: false,
    promotionEligible: false,
    evidenceUse: 'weak_noise',
    collectorVersion: DEFENSE_PROPULSION_READONLY_VERSION,
    generatedAt,
    collectedAt: generatedAt,
    httpStatus: fetchResult.httpStatus || null,
    fixtureBacked: Boolean(fetchResult.usedFixtureText),
  };
}

async function collectRowsForUse({
  seed = {},
  trackId = 'issuer_bridge_track',
  evidenceClass = 'issuer_exposure',
  allowedUse = 'issuer_exposure',
  sourceAllowlist = DEFAULT_DEFENSE_PROPULSION_SOURCE_ALLOWLIST,
  maxSources = 4,
  generatedAt = new Date().toISOString(),
  timeoutMs = 10000,
  disableNetwork = false,
} = {}) {
  const sources = asArray(sourceAllowlist)
    .filter((source) => sourceMatchesSeed(source, seed))
    .filter((source) => !source.allowedUses || asArray(source.allowedUses).includes(allowedUse))
    .slice(0, maxSources);
  const rawEvidence = [];
  const failures = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const fetchResult = await fetchSourceText(source, { timeoutMs, disableNetwork });
    if (!fetchResult.ok) failures.push({ sourceId: source.sourceId, failureClassification: fetchResult.failureClassification });
    rawEvidence.push(buildRawEvidenceRow(source, {
      seed,
      trackId,
      evidenceClass,
      generatedAt,
      text: fetchResult.text,
      fetchResult,
      index,
    }));
  }
  return {
    version: DEFENSE_PROPULSION_READONLY_VERSION,
    rawEvidence,
    sourceGroupsUsed: uniqueStrings(rawEvidence.map((row) => row.sourceGroup), 20),
    sourceFamiliesUsed: uniqueStrings(rawEvidence.map((row) => row.sourceFamily || row.provider), 20),
    issuers: uniqueStrings(rawEvidence.map((row) => row.issuer), 20),
    failures,
    fixtureRequired: rawEvidence.some((row) => /SOURCE_UNAVAILABLE|TIMEOUT|HTTP_|NETWORK_DISABLED/i.test(String(row.failureClassification || ''))),
  };
}

function collectRowsForUseSync({
  seed = {},
  trackId = 'issuer_bridge_track',
  evidenceClass = 'issuer_exposure',
  allowedUse = 'issuer_exposure',
  sourceAllowlist = DEFAULT_DEFENSE_PROPULSION_SOURCE_ALLOWLIST,
  maxSources = 4,
  generatedAt = new Date().toISOString(),
} = {}) {
  const sources = asArray(sourceAllowlist)
    .filter((source) => sourceMatchesSeed(source, seed))
    .filter((source) => !source.allowedUses || asArray(source.allowedUses).includes(allowedUse))
    .slice(0, maxSources);
  const rawEvidence = sources.map((source, index) => buildRawEvidenceRow(source, {
    seed,
    trackId,
    evidenceClass,
    generatedAt,
    text: compact(source.fixtureText || source.extractedTextSnippet || source.text || ''),
    fetchResult: source.fixtureText
      ? { ok: true, usedFixtureText: true }
      : { ok: false, failureClassification: 'FIXTURE_REQUIRED' },
    index,
  }));
  return {
    version: DEFENSE_PROPULSION_READONLY_VERSION,
    rawEvidence,
    sourceGroupsUsed: uniqueStrings(rawEvidence.map((row) => row.sourceGroup), 20),
    sourceFamiliesUsed: uniqueStrings(rawEvidence.map((row) => row.sourceFamily || row.provider), 20),
    issuers: uniqueStrings(rawEvidence.map((row) => row.issuer), 20),
    failures: rawEvidence
      .filter((row) => row.failureClassification !== 'ACCEPTED_CANDIDATE')
      .map((row) => ({ sourceId: row.sourceId, failureClassification: row.failureClassification })),
    fixtureRequired: rawEvidence.some((row) => row.failureClassification === 'FIXTURE_REQUIRED'),
  };
}

function classifyNegativeRow(row = {}) {
  const text = compact([row.extractedTextSnippet, row.textExcerpt, row.summary].join(' '));
  const invalidators = termsMatched(text, DEFENSE_PROPULSION_NEGATIVE_INVALIDATOR_TERMS);
  if (invalidators.length && !/did not|does not|not identify|not state|did not say|no direct/i.test(text)) {
    return { status: 'WEAKENED', classification: 'CONTRADICTORY', matchedInvalidatorTerms: invalidators };
  }
  if (/not_evaluated|SOURCE_UNAVAILABLE|TIMEOUT|HTTP_|NETWORK_DISABLED|NO_MATCH/i.test(String(row.acceptanceVerdict || row.failureClassification || ''))) {
    return { status: 'INCONCLUSIVE', classification: row.failureClassification || 'WEAK_EVIDENCE', matchedInvalidatorTerms: invalidators };
  }
  return { status: 'CHECKED_NO_DIRECT', classification: 'CHECKED_NO_DIRECT', matchedInvalidatorTerms: invalidators };
}

export async function collectDefensePropulsionIssuerBridgeReadonly(options = {}) {
  return collectRowsForUse({
    ...options,
    evidenceClass: 'issuer_exposure',
    allowedUse: 'issuer_exposure',
  });
}

export function collectDefensePropulsionIssuerBridgeReadonlySync(options = {}) {
  return collectRowsForUseSync({
    ...options,
    evidenceClass: 'issuer_exposure',
    allowedUse: 'issuer_exposure',
  });
}

export async function collectDefensePropulsionHoldoutReadonly(options = {}) {
  return collectRowsForUse({
    ...options,
    evidenceClass: 'holdout_validation',
    allowedUse: 'holdout_validation',
  });
}

export function collectDefensePropulsionHoldoutReadonlySync(options = {}) {
  return collectRowsForUseSync({
    ...options,
    evidenceClass: 'holdout_validation',
    allowedUse: 'holdout_validation',
  });
}

export async function collectDefensePropulsionNegativeControlReadonly(options = {}) {
  const collected = await collectRowsForUse({
    ...options,
    evidenceClass: 'negative_control',
    allowedUse: 'negative_control',
  });
  const rawEvidence = collected.rawEvidence.map((row) => {
    const detail = classifyNegativeRow(row);
    return {
      ...row,
      evidenceClass: 'negative_control',
      negativeControlIntent: true,
      negativeControlStatus: detail.status,
      negativeControlFinding: detail.status === 'CHECKED_NO_DIRECT'
        ? 'checked_no_direct'
        : detail.status === 'WEAKENED'
          ? 'weakening_risk_signal'
          : 'inconclusive',
      negativeControlScope: 'source_row',
      matchedInvalidatorTerms: detail.matchedInvalidatorTerms,
      failureClassification: detail.classification,
      acceptanceVerdict: detail.status === 'CHECKED_NO_DIRECT' ? 'accepted' : row.acceptanceVerdict,
      accepted: detail.status === 'CHECKED_NO_DIRECT',
      evidenceUse: detail.status === 'CHECKED_NO_DIRECT' ? 'negative_control_candidate' : 'weak_noise',
      promotionEligible: false,
    };
  });
  const checkedRows = rawEvidence.filter((row) => row.negativeControlStatus === 'CHECKED_NO_DIRECT');
  const weakenedRows = rawEvidence.filter((row) => row.negativeControlStatus === 'WEAKENED');
  const checkedSourceGroups = uniqueStrings(checkedRows.map((row) => row.sourceGroup), 20);
  const checkedIssuers = uniqueStrings(checkedRows.map((row) => row.issuer).filter((issuer) => issuer && !String(issuer).endsWith('_PRIVATE')), 20);
  const checkedQueryFamilyCount = Math.max(
    checkedRows.length,
    uniqueStrings(rawEvidence.flatMap((row) => row.matchedBottleneckTerms || []), 20).length,
  );
  const negativeControlStatus = weakenedRows.length
    ? 'WEAKENED'
    : checkedRows.length >= 2 && checkedSourceGroups.length >= 2
      ? 'CHECKED_NO_DIRECT'
      : checkedRows.length
        ? 'CHECKED_NO_DIRECT_LIMITED_SCOPE'
        : 'INCONCLUSIVE';
  return {
    ...collected,
    rawEvidence,
    scope: {
      negativeControlStatus,
      negativeControlScope: negativeControlStatus === 'CHECKED_NO_DIRECT'
        ? 'sufficient'
        : negativeControlStatus === 'CHECKED_NO_DIRECT_LIMITED_SCOPE'
          ? 'limited'
          : negativeControlStatus === 'WEAKENED'
            ? 'invalidator_candidate'
            : 'insufficient',
      checkedSourceGroups,
      checkedIssuers,
      checkedIssuerCount: checkedIssuers.length,
      checkedSourceGroupCount: checkedSourceGroups.length,
      checkedQueryFamilyCount,
      directInvalidatorCount: weakenedRows.length,
      weakRiskSignalCount: weakenedRows.length,
      noResultCount: rawEvidence.filter((row) => row.negativeControlStatus === 'INCONCLUSIVE').length,
      sourceUnavailableCount: rawEvidence.filter((row) => /SOURCE_UNAVAILABLE|TIMEOUT|HTTP_|NETWORK_DISABLED/i.test(String(row.failureClassification || ''))).length,
      directInvalidatorFound: weakenedRows.length > 0,
      matchedInvalidatorTerms: uniqueStrings(weakenedRows.flatMap((row) => row.matchedInvalidatorTerms || []), 20),
      matchedRiskTerms: [],
    },
  };
}

export function collectDefensePropulsionNegativeControlReadonlySync(options = {}) {
  const collected = collectRowsForUseSync({
    ...options,
    evidenceClass: 'negative_control',
    allowedUse: 'negative_control',
  });
  const rawEvidence = collected.rawEvidence.map((row) => {
    const detail = classifyNegativeRow(row);
    return {
      ...row,
      evidenceClass: 'negative_control',
      negativeControlIntent: true,
      negativeControlStatus: detail.status,
      negativeControlFinding: detail.status === 'CHECKED_NO_DIRECT'
        ? 'checked_no_direct'
        : detail.status === 'WEAKENED'
          ? 'weakening_risk_signal'
          : 'inconclusive',
      negativeControlScope: 'source_row',
      matchedInvalidatorTerms: detail.matchedInvalidatorTerms,
      failureClassification: detail.classification,
      acceptanceVerdict: detail.status === 'CHECKED_NO_DIRECT' ? 'accepted' : row.acceptanceVerdict,
      accepted: detail.status === 'CHECKED_NO_DIRECT',
      evidenceUse: detail.status === 'CHECKED_NO_DIRECT' ? 'negative_control_candidate' : 'weak_noise',
      promotionEligible: false,
    };
  });
  const checkedRows = rawEvidence.filter((row) => row.negativeControlStatus === 'CHECKED_NO_DIRECT');
  const weakenedRows = rawEvidence.filter((row) => row.negativeControlStatus === 'WEAKENED');
  const checkedSourceGroups = uniqueStrings(checkedRows.map((row) => row.sourceGroup), 20);
  const checkedIssuers = uniqueStrings(checkedRows.map((row) => row.issuer).filter((issuer) => issuer && !String(issuer).endsWith('_PRIVATE')), 20);
  const checkedQueryFamilyCount = Math.max(
    checkedRows.length,
    uniqueStrings(rawEvidence.flatMap((row) => row.matchedBottleneckTerms || []), 20).length,
  );
  const negativeControlStatus = weakenedRows.length
    ? 'WEAKENED'
    : checkedRows.length >= 2 && checkedSourceGroups.length >= 2
      ? 'CHECKED_NO_DIRECT'
      : checkedRows.length
        ? 'CHECKED_NO_DIRECT_LIMITED_SCOPE'
        : 'INCONCLUSIVE';
  return {
    ...collected,
    rawEvidence,
    scope: {
      negativeControlStatus,
      negativeControlScope: negativeControlStatus === 'CHECKED_NO_DIRECT'
        ? 'sufficient'
        : negativeControlStatus === 'CHECKED_NO_DIRECT_LIMITED_SCOPE'
          ? 'limited'
          : negativeControlStatus === 'WEAKENED'
            ? 'invalidator_candidate'
            : 'insufficient',
      checkedSourceGroups,
      checkedIssuers,
      checkedIssuerCount: checkedIssuers.length,
      checkedSourceGroupCount: checkedSourceGroups.length,
      checkedQueryFamilyCount,
      directInvalidatorCount: weakenedRows.length,
      weakRiskSignalCount: weakenedRows.length,
      noResultCount: rawEvidence.filter((row) => row.negativeControlStatus === 'INCONCLUSIVE').length,
      sourceUnavailableCount: rawEvidence.filter((row) => /SOURCE_UNAVAILABLE|TIMEOUT|HTTP_|NETWORK_DISABLED|FIXTURE_REQUIRED/i.test(String(row.failureClassification || ''))).length,
      directInvalidatorFound: weakenedRows.length > 0,
      matchedInvalidatorTerms: uniqueStrings(weakenedRows.flatMap((row) => row.matchedInvalidatorTerms || []), 20),
      matchedRiskTerms: [],
    },
  };
}

export const __test = {
  stripHtml,
  termsMatched,
  buildRawEvidenceRow,
  classifyNegativeRow,
  sourceMatchesSeed,
};
