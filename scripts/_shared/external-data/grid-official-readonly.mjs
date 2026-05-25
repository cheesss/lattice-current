export const GRID_OFFICIAL_READONLY_VERSION = 'grid-official-readonly-v1';

export const GRID_OFFICIAL_ALLOWED_SOURCE_GROUPS = Object.freeze([
  'official_research_dataset',
  'official_government',
  'official_grid_operator',
  'utility_planning',
]);

export const GRID_OFFICIAL_BOTTLENECK_TERMS = Object.freeze([
  'interconnection queue',
  'interconnection study',
  'study delay',
  'study backlog',
  'queue duration',
  'processing capacity',
  'withdrawal rate',
  'network upgrade delay',
  'interconnection reform',
  'study timeline',
  'queue processing',
]);

export const GRID_OFFICIAL_OPERATING_TERMS = Object.freeze([
  'timing bottleneck',
  'capacity constraint',
  'processing delay',
  'project delay',
  'queue congestion',
  'backlog growth',
  'delayed grid connection',
  'cost increase',
  'longer study timeline',
  'upgrade cost',
  'application backlog',
]);

export const DEFAULT_GRID_OFFICIAL_SOURCE_ALLOWLIST = Object.freeze([
  {
    sourceId: 'lbnl-queued-up-fixture',
    sourceGroup: 'official_research_dataset',
    sourceFamily: 'lbnl_interconnection_queue',
    sourceUrl: 'https://emp.lbl.gov/queued-up',
    documentTitle: 'Queued Up interconnection queue dataset fixture',
    documentType: 'official_research_dataset_fixture',
    reportYear: 2024,
    allowedForTrack: 'track_a_mechanism_validation',
    extractionMode: 'text',
    maxBytes: 120000,
    timeoutMs: 10000,
    rateLimitKey: 'lbnl_interconnection_queue',
    fixtureText: 'The interconnection queue exhibits study backlog, queue duration, withdrawal rate, and backlog growth. These metrics indicate a processing capacity bottleneck and longer study timeline for projects seeking grid connection.',
  },
  {
    sourceId: 'ferc-interconnection-reform-fixture',
    sourceGroup: 'official_government',
    sourceFamily: 'ferc_interconnection_reform',
    sourceUrl: 'https://www.ferc.gov/',
    documentTitle: 'FERC interconnection reform document fixture',
    documentType: 'official_government_fixture',
    reportYear: 2023,
    allowedForTrack: 'track_a_mechanism_validation',
    extractionMode: 'text',
    maxBytes: 120000,
    timeoutMs: 10000,
    rateLimitKey: 'ferc_interconnection_reform',
    fixtureText: 'Interconnection reform documents describe interconnection study delay, queue processing, network upgrade delay, and project delay as constraints that slow generator and load interconnection.',
  },
  {
    sourceId: 'iso-rto-queue-report-fixture',
    sourceGroup: 'official_grid_operator',
    sourceFamily: 'iso_rto_interconnection_queue_report',
    sourceUrl: 'https://www.pjm.com/',
    documentTitle: 'ISO/RTO interconnection queue report fixture',
    documentType: 'official_grid_operator_fixture',
    reportYear: 2024,
    allowedForTrack: 'track_a_mechanism_validation',
    extractionMode: 'text',
    maxBytes: 120000,
    timeoutMs: 10000,
    rateLimitKey: 'iso_rto_interconnection_queue',
    fixtureText: 'The interconnection study timeline lengthened as queue congestion, processing delay, and network upgrade delay increased for projects in the interconnection queue.',
  },
  {
    sourceId: 'utility-planning-fixture-required',
    sourceGroup: 'utility_planning',
    sourceFamily: 'utility_transmission_planning',
    sourceUrl: null,
    documentTitle: 'Utility transmission planning source requirement',
    documentType: 'fixture_requirement',
    reportYear: null,
    allowedForTrack: 'track_a_mechanism_validation',
    extractionMode: 'text',
    maxBytes: 120000,
    timeoutMs: 10000,
    rateLimitKey: 'utility_transmission_planning',
    fixtureText: '',
  },
]);

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

function textIncludes(text = '', term = '') {
  return String(text || '').toLowerCase().includes(String(term || '').toLowerCase());
}

function termsMatched(text = '', terms = []) {
  return asArray(terms).filter((term) => textIncludes(text, term));
}

function firstTermIndex(text = '', terms = []) {
  const lower = String(text || '').toLowerCase();
  let best = -1;
  let bestTerm = '';
  for (const term of terms) {
    const index = lower.indexOf(String(term || '').toLowerCase());
    if (index >= 0 && (best < 0 || index < best)) {
      best = index;
      bestTerm = term;
    }
  }
  return { index: best, term: bestTerm };
}

export function findGridMechanismProximity(text = '', {
  bottleneckTerms = GRID_OFFICIAL_BOTTLENECK_TERMS,
  operatingTerms = GRID_OFFICIAL_OPERATING_TERMS,
  windowChars = 1000,
} = {}) {
  const body = compact(text);
  const matchedBottleneckTerms = termsMatched(body, bottleneckTerms);
  const matchedOperatingTerms = termsMatched(body, operatingTerms);
  if (!matchedBottleneckTerms.length || !matchedOperatingTerms.length) {
    return {
      matched: false,
      matchedBottleneckTerms,
      matchedOperatingTerms,
      proximityWindow: windowChars,
      proximityScore: 0,
      matchedSnippet: '',
    };
  }
  for (const bottleneckTerm of matchedBottleneckTerms) {
    const lower = body.toLowerCase();
    const bottleneckIndex = lower.indexOf(bottleneckTerm.toLowerCase());
    for (const operatingTerm of matchedOperatingTerms) {
      const operatingIndex = lower.indexOf(operatingTerm.toLowerCase());
      if (bottleneckIndex >= 0 && operatingIndex >= 0 && Math.abs(bottleneckIndex - operatingIndex) <= windowChars) {
        const start = Math.max(0, Math.min(bottleneckIndex, operatingIndex) - 360);
        return {
          matched: true,
          matchedBottleneckTerms,
          matchedOperatingTerms,
          proximityWindow: windowChars,
          proximityScore: 1 - Math.min(1, Math.abs(bottleneckIndex - operatingIndex) / windowChars),
          matchedSnippet: body.slice(start, start + Math.min(1000, windowChars + 240)),
        };
      }
    }
  }
  const firstBottleneck = firstTermIndex(body, matchedBottleneckTerms);
  const firstOperating = firstTermIndex(body, matchedOperatingTerms);
  return {
    matched: false,
    matchedBottleneckTerms,
    matchedOperatingTerms,
    proximityWindow: windowChars,
    proximityScore: 0,
    matchedSnippet: body.slice(Math.max(0, Math.min(firstBottleneck.index, firstOperating.index) - 240), 760),
  };
}

function datasetEvidenceText(source = {}) {
  const fields = uniqueStrings(source.datasetFieldsUsed || source.datasetFields || [], 20);
  if (!fields.length) return '';
  return compact([
    fields.join(' '),
    source.datasetMetricSummary,
    source.bottleneckInterpretation,
    source.metricDefinition,
  ].join(' '));
}

function failureForSource(source = {}, text = '') {
  if (!GRID_OFFICIAL_ALLOWED_SOURCE_GROUPS.includes(source.sourceGroup)) return 'SOURCE_GROUP_NOT_ALLOWED';
  if (source.allowedForTrack !== 'track_a_mechanism_validation') return 'TRACK_NOT_ALLOWED';
  if (!text && !datasetEvidenceText(source)) return 'FIXTURE_REQUIRED';
  return null;
}

export function buildGridOfficialRawEvidence(source = {}, {
  seedId = 'track-a-seed',
  trackId = 'mechanism_validation_track',
  generatedAt = new Date().toISOString(),
  index = 0,
  windowChars = 1000,
} = {}) {
  const text = compact(source.fixtureText || source.extractedTextSnippet || source.text || '');
  const datasetText = datasetEvidenceText(source);
  const extractionText = compact([text, datasetText].join(' '));
  const failureClassification = failureForSource(source, extractionText);
  const proximity = findGridMechanismProximity(extractionText, { windowChars });
  const extractionStatus = failureClassification
    ? 'fixture_required'
    : proximity.matched
      ? 'extracted'
      : 'extracted_no_acceptance_match';
  return {
    evidenceId: `grid-official:${seedId}:${source.sourceId || `source-${index}`}`,
    seedId,
    trackId,
    evidenceClass: 'mechanism_validation',
    sourceId: source.sourceId || `source-${index}`,
    source: source.sourceFamily || source.sourceId || 'grid_official_readonly',
    provider: source.sourceFamily || 'grid_official_readonly',
    sourceGroup: source.sourceGroup,
    sourceFamily: source.sourceFamily,
    sourceUrl: source.sourceUrl || null,
    documentTitle: source.documentTitle || source.sourceId || '',
    documentType: source.documentType || 'official_grid_source',
    publishedAt: source.publishedAt || null,
    reportYear: source.reportYear || null,
    allowedForTrack: source.allowedForTrack || 'track_a_mechanism_validation',
    extractionMode: source.extractionMode || 'text',
    maxBytes: source.maxBytes || null,
    timeoutMs: source.timeoutMs || null,
    rateLimitKey: source.rateLimitKey || null,
    extractedTextSnippet: text || datasetText,
    datasetFieldsUsed: uniqueStrings(source.datasetFieldsUsed || source.datasetFields || [], 20),
    matchedBottleneckTerms: proximity.matchedBottleneckTerms,
    matchedOperatingTerms: proximity.matchedOperatingTerms,
    matchedSnippet: proximity.matchedSnippet,
    proximityWindow: proximity.proximityWindow,
    proximityScore: proximity.proximityScore,
    extractionStatus,
    failureClassification,
    acceptanceVerdict: proximity.matched && !failureClassification ? 'accepted' : 'not_evaluated_mechanism_validation_raw',
    accepted: proximity.matched && !failureClassification,
    promotionEligible: false,
    evidenceUse: proximity.matched && !failureClassification ? 'supporting_context' : 'weak_noise',
    fixtureBacked: Boolean(source.fixtureText || source.datasetFieldsUsed || source.datasetFields),
    generatedAt,
    collectedAt: generatedAt,
  };
}

export function collectGridOfficialReadonly({
  seedId = 'track-a-seed',
  trackId = 'mechanism_validation_track',
  generatedAt = new Date().toISOString(),
  sourceAllowlist = DEFAULT_GRID_OFFICIAL_SOURCE_ALLOWLIST,
  maxSources = 4,
  windowChars = 1000,
} = {}) {
  const selectedSources = asArray(sourceAllowlist)
    .filter((source) => source?.allowedForTrack === 'track_a_mechanism_validation')
    .slice(0, maxSources);
  const rawEvidence = selectedSources.map((source, index) => buildGridOfficialRawEvidence(source, {
    seedId,
    trackId,
    generatedAt,
    index,
    windowChars,
  }));
  const sourceFamiliesUsed = uniqueStrings(rawEvidence.map((row) => row.sourceFamily), 20);
  const sourceGroupsUsed = uniqueStrings(rawEvidence.map((row) => row.sourceGroup), 20);
  return {
    version: GRID_OFFICIAL_READONLY_VERSION,
    source: 'grid-official-readonly',
    rawEvidence,
    sourceFamiliesUsed,
    sourceGroupsUsed,
    fixtureRequired: rawEvidence.some((row) => row.failureClassification === 'FIXTURE_REQUIRED'),
    failureClassifications: rawEvidence.reduce((counts, row) => {
      if (row.failureClassification) counts[row.failureClassification] = (counts[row.failureClassification] || 0) + 1;
      return counts;
    }, {}),
  };
}
