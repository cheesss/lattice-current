import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const HISTORICAL_ANALOGUE_BRIDGE_VERSION = 'historical-analogue-bridge-v1';
export const DEFAULT_HISTORICAL_ANALOGUE_BRIDGE_PATH = path.join(
  process.cwd(),
  'data',
  'runtime',
  'historical-analogue-bridge.latest.json',
);

const TRUSTED_PROVENANCE = new Set(['trusted_local_analogue_library', 'accepted_prior_report']);
const GENERATED_REPORT_PROVENANCE = /generated|dry[-_ ]?run|source[-_ ]?query|llm|news|rss/i;

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

function lowerSet(values = []) {
  return new Set(uniqueStrings(values, 100).map((value) => value.toLowerCase()));
}

function overlapScore(a = [], b = []) {
  const left = lowerSet(a);
  const right = lowerSet(b);
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const item of left) {
    if (right.has(item)) hits += 1;
  }
  return Math.min(1, hits / Math.min(left.size, right.size));
}

function textOverlapScore(a = '', b = '') {
  const left = lowerSet(String(a || '').split(/[^a-z0-9]+/i).filter((token) => token.length > 3));
  const right = lowerSet(String(b || '').split(/[^a-z0-9]+/i).filter((token) => token.length > 3));
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const item of left) {
    if (right.has(item)) hits += 1;
  }
  return Math.min(1, hits / Math.min(left.size, right.size));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function median(values = []) {
  const nums = values.map(numberOrNull).filter((value) => value !== null).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  const value = nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  return Number(value.toFixed(6));
}

function normalizeCase(row = {}) {
  const sourceProvenance = compact(row.sourceProvenance || 'trusted_local_analogue_library');
  const marketOutcome = row.marketOutcome || {};
  return {
    analogueId: compact(row.analogueId || row.id || row.title),
    title: compact(row.title || row.analogueId || 'Historical analogue'),
    period: compact(row.period || ''),
    bottleneckClass: compact(row.bottleneckClass || ''),
    bottleneckNode: compact(row.bottleneckNode || ''),
    issuerRolePattern: uniqueStrings(row.issuerRolePattern || row.issuerRoles || [], 30),
    evidenceClasses: uniqueStrings(row.evidenceClasses || [], 30),
    catalystTypes: uniqueStrings(row.catalystTypes || row.catalysts || [], 30),
    issuerBasket: uniqueStrings(row.issuerBasket || [], 20).map((issuer) => issuer.toUpperCase()),
    peerBasket: uniqueStrings(row.peerBasket || [], 20).map((issuer) => issuer.toUpperCase()),
    eventDates: uniqueStrings(row.eventDates || [], 20),
    marketOutcome: {
      return30dExcess: numberOrNull(marketOutcome.return30dExcess),
      return90dExcess: numberOrNull(marketOutcome.return90dExcess),
      maxDrawdownBeforeMove: numberOrNull(marketOutcome.maxDrawdownBeforeMove),
      multipleChange: numberOrNull(marketOutcome.multipleChange),
      estimateRevisionDirection: compact(marketOutcome.estimateRevisionDirection || ''),
    },
    invalidators: uniqueStrings(row.invalidators || [], 30),
    sourceProvenance,
    fixtureOnly: row.fixtureOnly === true,
    validationErrors: uniqueStrings([
      compact(row.analogueId || row.id || row.title) ? null : 'missing_analogue_id',
      compact(row.bottleneckClass) ? null : 'missing_bottleneck_class',
      compact(row.sourceProvenance || sourceProvenance) ? null : 'missing_source_provenance',
      TRUSTED_PROVENANCE.has(sourceProvenance) ? null : 'untrusted_source_provenance',
      GENERATED_REPORT_PROVENANCE.test(sourceProvenance) ? 'generated_or_untrusted_analogue_source' : null,
    ], 10),
  };
}

export function loadHistoricalAnalogueCases({
  configDir = path.join(process.cwd(), 'config', 'historical-analogues'),
  cases = null,
} = {}) {
  const rawCases = [];
  if (cases) {
    rawCases.push(...asArray(cases));
  } else if (existsSync(configDir)) {
    for (const name of readdirSync(configDir).filter((item) => item.endsWith('.json')).sort()) {
      const parsed = JSON.parse(readFileSync(path.join(configDir, name), 'utf8'));
      rawCases.push(...asArray(parsed.cases || parsed.analogues || parsed));
    }
  }
  const normalizedCases = rawCases.map(normalizeCase);
  const usableCases = normalizedCases.filter((row) => row.validationErrors.length === 0);
  return {
    ok: true,
    version: HISTORICAL_ANALOGUE_BRIDGE_VERSION,
    source: 'trusted_local_analogue_library',
    configDir: path.resolve(configDir),
    cases: usableCases,
    rejectedCases: normalizedCases.filter((row) => !usableCases.includes(row)),
    caseCount: usableCases.length,
  };
}

function inferSeedVector(input = {}) {
  return {
    seedId: compact(input.seedId || input.childSeedId || input.subjectId || input.reportSubjectDryRun?.childSeedId || ''),
    bottleneckClass: compact(input.bottleneckClass || input.childClass || input.reportSubjectDryRun?.bottleneckClass || ''),
    bottleneckNode: compact(input.bottleneckNode || input.subjectLabel || input.reportSubjectDryRun?.bottleneckNode || input.reportSubjectDryRun?.subjectLabel || ''),
    issuerRolePattern: uniqueStrings([
      input.issuerRolePattern,
      input.issuerRoles,
      input.issuerValuationBridgeTable?.map((row) => row.roleClass),
      input.localValuationRows?.map((row) => row.roleClass),
    ], 40),
    evidenceClasses: uniqueStrings([
      input.evidenceClasses,
      input.acceptedEvidenceClasses,
      input.acceptedPromotionEvidenceClasses,
      input.evidenceContractMatrix?.filter((row) => Number(row.acceptedCount || row.promotionEligibleCount || 0) > 0).map((row) => row.evidenceClass),
      input.evidenceContractMatrixSummary?.filter((row) => Number(row.acceptedCount || row.promotionEligibleCount || 0) > 0).map((row) => row.evidenceClass),
    ], 40),
    catalystTypes: uniqueStrings([
      input.catalystTypes,
      input.catalysts,
      input.localValuationRows?.map((row) => row.backlogToRevenueCommentary || row.operatingExposure),
    ], 40),
    issuerUniverse: uniqueStrings([input.issuerUniverse, input.reportSubjectDryRun?.issuerUniverse, input.trackBIssuerCandidates], 20).map((issuer) => issuer.toUpperCase()),
    peerBasket: uniqueStrings([input.peerBasket, input.localValuationRows?.flatMap((row) => row.peerGroup || [])], 20).map((issuer) => issuer.toUpperCase()),
    invalidatorTerms: uniqueStrings([input.invalidatorTerms, input.negativeControlInvalidators], 30),
  };
}

export function scoreHistoricalAnalogueCase(seed = {}, analogue = {}) {
  const bottleneckClassScore = compact(seed.bottleneckClass)
    && compact(seed.bottleneckClass).toLowerCase() === compact(analogue.bottleneckClass).toLowerCase()
    ? 1
    : textOverlapScore(seed.bottleneckClass, analogue.bottleneckClass);
  const bottleneckNodeScore = textOverlapScore(seed.bottleneckNode, analogue.bottleneckNode);
  const issuerRoleScore = overlapScore(seed.issuerRolePattern, analogue.issuerRolePattern);
  const evidenceClassScore = overlapScore(seed.evidenceClasses, analogue.evidenceClasses);
  const catalystScore = Math.max(overlapScore(seed.catalystTypes, analogue.catalystTypes), textOverlapScore(seed.bottleneckNode, analogue.catalystTypes.join(' ')));
  const sectorPeerScore = Math.max(overlapScore(seed.issuerUniverse, analogue.issuerBasket), overlapScore(seed.peerBasket, analogue.peerBasket));
  const invalidatingIndicators = uniqueStrings(
    analogue.invalidators.filter((item) => {
      const text = item.toLowerCase();
      return seed.invalidatorTerms.some((term) => text.includes(term.toLowerCase()) || term.toLowerCase().includes(text));
    }),
    20,
  );
  const invalidatorPenalty = invalidatingIndicators.length ? 0.2 : 0;
  const totalScore = Math.max(0, Number((
    0.2 * bottleneckClassScore
    + 0.15 * bottleneckNodeScore
    + 0.2 * issuerRoleScore
    + 0.2 * evidenceClassScore
    + 0.15 * catalystScore
    + 0.1 * sectorPeerScore
    - invalidatorPenalty
  ).toFixed(4)));
  const differences = uniqueStrings([
    bottleneckClassScore < 0.5 ? 'bottleneck_class_differs' : null,
    issuerRoleScore < 0.5 ? 'issuer_role_pattern_differs' : null,
    evidenceClassScore < 0.5 ? 'evidence_class_overlap_limited' : null,
    sectorPeerScore < 0.25 ? 'issuer_or_peer_basket_differs' : null,
    analogue.fixtureOnly ? 'fixture_only_not_readiness_evidence' : null,
  ], 20);
  return {
    analogueId: analogue.analogueId,
    totalScore,
    bottleneckClassScore,
    bottleneckNodeScore,
    issuerRoleScore,
    evidenceClassScore,
    catalystScore,
    marketRegimeScore: 0,
    sectorPeerScore,
    differences,
    invalidatingIndicators,
    fixtureOnly: analogue.fixtureOnly === true,
    sourceProvenance: analogue.sourceProvenance,
    issuerBasket: analogue.issuerBasket || [],
    peerBasket: analogue.peerBasket || [],
    marketOutcome: analogue.marketOutcome,
  };
}

export function buildHistoricalAnalogueBridge(input = {}, options = {}) {
  const loaded = input.historicalAnalogueCases
    ? loadHistoricalAnalogueCases({ cases: input.historicalAnalogueCases, configDir: options.configDir })
    : loadHistoricalAnalogueCases({ configDir: options.configDir });
  const seed = inferSeedVector(input);
  const scores = loaded.cases
    .map((analogue) => scoreHistoricalAnalogueCase(seed, analogue))
    .sort((a, b) => b.totalScore - a.totalScore);
  const usableScores = scores.filter((score) => score.totalScore >= Number(options.minSimilarity || 0.35));
  const topScores = usableScores.slice(0, Number(options.maxAnalogues || 5));
  const return90dValues = topScores
    .map((score) => score.marketOutcome?.return90dExcess)
    .filter((value) => value !== null && value !== undefined);
  const multipleValues = topScores
    .map((score) => score.marketOutcome?.multipleChange)
    .filter((value) => value !== null && value !== undefined);
  const missingInputs = uniqueStrings([
    loaded.caseCount < 2 ? 'historical_analogue_case_count_below_2' : null,
    topScores.length < 2 ? 'usable_analogue_similarity_below_threshold' : null,
    return90dValues.length < 2 ? 'analogue_90d_excess_return_missing' : null,
    seed.evidenceClasses.length ? null : 'accepted_evidence_classes_missing',
  ], 20);
  return {
    ok: true,
    version: HISTORICAL_ANALOGUE_BRIDGE_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    seed,
    analogueCount: loaded.caseCount,
    usableAnalogueCount: topScores.length,
    bestAnalogueIds: topScores.map((score) => score.analogueId),
    scores,
    topScores,
    analogueMedianExcessMove90d: median(return90dValues),
    analogueMedianMultipleExpansion: median(multipleValues),
    missingInputs,
    reflectionStatus: missingInputs.length ? 'insufficient_comparison_data' : 'comparison_ready',
    fixtureOnly: topScores.some((score) => score.fixtureOnly),
    pricedInRisk: false,
    sourceProvenance: loaded.source,
    rejectedCaseCount: loaded.rejectedCases.length,
    boundaries: {
      providerActivationWrites: 0,
      readinessPromotionWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      approvalQueueWrites: 0,
      reportCandidateWrites: 0,
      portfolioActionWrites: 0,
    },
  };
}

export async function writeHistoricalAnalogueBridgeArtifact(
  payload,
  filePath = DEFAULT_HISTORICAL_ANALOGUE_BRIDGE_PATH,
) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}
