#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildInterconnectionRouteSplitTracks,
} from './_shared/seed-child-bottleneck-decomposition.mjs';
import {
  collectGridOfficialReadonly,
  findGridMechanismProximity,
  GRID_OFFICIAL_ALLOWED_SOURCE_GROUPS,
  GRID_OFFICIAL_BOTTLENECK_TERMS,
  GRID_OFFICIAL_OPERATING_TERMS,
} from './_shared/external-data/grid-official-readonly.mjs';
import {
  collectGridIssuerBridgeReadonly,
  DEFAULT_GRID_ISSUER_BRIDGE_SOURCE_ALLOWLIST,
  gridIssuerBridgeAcceptanceDetail,
  GRID_ISSUER_BRIDGE_ALLOWED_SOURCE_GROUPS,
  GRID_ISSUER_BRIDGE_EXPOSURE_TERMS,
  GRID_ISSUER_BRIDGE_OPERATING_TERMS,
  GRID_ISSUER_BRIDGE_READONLY_VERSION,
} from './_shared/external-data/grid-issuer-bridge-readonly.mjs';
import {
  collectGridIssuerNegativeControlReadonly,
  GRID_ISSUER_NEGATIVE_CONTROL_READONLY_VERSION,
  GRID_ISSUER_NEGATIVE_QUERY_FAMILIES,
  summarizeGridIssuerNegativeScope,
} from './_shared/external-data/grid-issuer-negative-control-readonly.mjs';
import {
  collectGridIssuerHoldoutReadonly,
  gridIssuerHoldoutAcceptanceDetail,
  GRID_ISSUER_HOLDOUT_READONLY_VERSION,
} from './_shared/external-data/grid-issuer-holdout-readonly.mjs';
import {
  collectGridIssuerMarketValidationReadonly,
  GRID_ISSUER_MARKET_ISSUERS,
  GRID_ISSUER_MARKET_VALIDATION_READONLY_VERSION,
} from './_shared/external-data/grid-issuer-market-validation-readonly.mjs';
import {
  buildDefaultDefensePropulsionMarketQuotes,
  collectDefensePropulsionHoldoutReadonlySync,
  collectDefensePropulsionIssuerBridgeReadonlySync,
  collectDefensePropulsionNegativeControlReadonlySync,
  DEFENSE_PROPULSION_READONLY_VERSION,
  isDefensePropulsionTarget,
} from './_shared/external-data/defense-propulsion-readonly.mjs';
import {
  loadLocalValuationFundamentalsCache,
} from './_shared/external-data/local-valuation-fundamentals-cache.mjs';
import {
  detectReportReadinessContradictions,
} from './_shared/report-contradiction-detector.mjs';
import {
  runAutonomousResearchHardcodingAudit,
} from './_shared/autonomous-research-hardcoding-audit.mjs';
import {
  buildFinalInvestmentReportDryRun,
  renderFinalInvestmentReportHtml,
  validateFinalInvestmentReportDryRun,
} from './_shared/final-investment-report-dry-run.mjs';
import {
  buildThesisValidationMemoDryRun,
  renderThesisValidationMemoHtml,
  validateThesisValidationMemoDryRun,
} from './_shared/thesis-validation-memo-dry-run.mjs';
import {
  buildValuationExpectationBridgeDryRun,
  buildMarketValidationRegimeSupport,
  marketValidationRegimeMatrixFields,
  validateValuationExpectationBridgeDryRun,
  valuationMatrixRowFromBridge,
} from './_shared/valuation-expectation-bridge-dry-run.mjs';

const DEFAULT_ARTIFACT_ROOT = path.join(process.cwd(), 'data', 'runtime');
const DEFAULT_OUTPUT_PATH = path.join(DEFAULT_ARTIFACT_ROOT, 'autonomous-research-repair-loop.latest.json');

const BLOCKER_PRIORITY = [
  'route_mismatch_unresolved',
  'track_a_mechanism_evidence_missing',
  'track_b_issuer_bridge_missing',
  'track_a_mechanism_evidence_raw_only',
  'track_b_issuer_bridge_raw_only',
  'mechanism_issuer_route_mismatch',
  'issuer_bridge_missing',
  'negative_control_inconclusive',
  'negative_control_not_closed',
  'holdout_missing',
  'market_validation_missing',
  'evidence_contract_closure_dry_run_required',
  'thesis_validation_memo_dry_run_required',
  'valuation_expectation_bridge_dry_run_required',
  'blocked_market_validation_regime_caveat',
  'market_validation_regime_missing',
  'market_validation_extreme_tstat_warning',
  'DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT',
  'final_investment_report_dry_run_required',
  'provider_blocked',
  'official_provider_gap',
  'route_mismatch',
  'broad_known_narrative',
  'parent_needs_child_decomposition',
  'issuer_coverage_skew',
  'accepted_evidence_missing',
  'accepted_promotion_evidence_missing',
  'independent_source_breadth_missing',
  'source_unavailable',
  'stale_document_only',
  'weak_evidence_only',
  'document_extraction_weak',
  'source_bucket_quota_violation',
  'underrepresented_evidence_class_missing',
  'seed_decomposition_required',
  'no_safe_next_action',
];

const ALLOWED_ACTIONS = new Set([
  'classify_provider_blocked',
  'create_provider_gap_proposal',
  'select_positive_path_seed',
  'split_mechanism_and_issuer_tracks',
  'run_limited_negative_control',
  'run_limited_holdout_validation',
  'run_limited_grid_mechanism_validation',
  'run_limited_issuer_bridge_track',
  'run_limited_official_route',
  'run_limited_controlled_market_validation',
  'evidence_contract_closure_dry_run',
  'thesis_validation_memo_dry_run',
  'valuation_expectation_bridge_dry_run',
  'market_validation_regime_support_repair',
  'repair_controlled_market_validation_regime_support',
  'final_investment_report_dry_run',
  'improve_document_ranking',
  'improve_multilingual_dictionary',
  'create_fixture_requirement',
  'create_targeted_backfill_task',
  'select_alternative_source_bucket',
  'apply_source_bucket_quota',
  'quarantine_source_or_provider',
  'decompose_seed',
  'generate_next_operator_review_task',
  'operator_review_required',
]);

const BOUNDED_EXECUTABLE_ACTIONS = new Set([
  'run_limited_negative_control',
  'run_limited_holdout_validation',
  'run_limited_grid_mechanism_validation',
  'run_limited_issuer_bridge_track',
  'run_limited_official_route',
  'run_limited_controlled_market_validation',
  'evidence_contract_closure_dry_run',
  'thesis_validation_memo_dry_run',
  'valuation_expectation_bridge_dry_run',
  'market_validation_regime_support_repair',
  'repair_controlled_market_validation_regime_support',
  'final_investment_report_dry_run',
]);

const BANNED_ACTIONS = new Set([
  'activate_provider_without_review',
  'merge_pr',
  'mark_investment_ready',
  'mark_report_candidate_without_accepted_evidence',
  'run_all_seeds',
  'crawl_all_ir_pages',
  'delete_data',
  'overwrite_accepted_evidence',
  'promote_raw_evidence',
]);

const SAFE_ZERO_BOUNDARIES = Object.freeze({
  providerActivationWrites: 0,
  readinessPromotionWrites: 0,
  canonicalWrites: 0,
  sourceRegistryWrites: 0,
  approvalQueueWrites: 0,
  reportCandidateWrites: 0,
  portfolioActionWrites: 0,
});

const REQUIRED_PROVIDER_PROPOSAL_FIELDS = [
  'providerName',
  'fillsEvidenceClass',
  'authRequired',
  'apiKeyRequired',
  'rateLimit',
  'allowlist',
  'parserOutputSchema',
  'fixtureRequirement',
  'healthCheckCommand',
  'testCommand',
  'failureModes',
  'reviewGatedActivation',
];

const NEGATIVE_CONTROL_STATUSES = new Set([
  'SURVIVED',
  'CHECKED_NO_DIRECT',
  'CHECKED_NO_DIRECT_LIMITED_SCOPE',
  'WEAKENED',
  'REJECTED',
  'INCONCLUSIVE',
]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstFiniteMetric(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
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

function evidenceCountsFromArtifact(artifact = {}) {
  const splitTrackResults = asArray(artifact.splitTrackResults);
  return {
    rawEvidenceCount: Number(artifact.rawEvidenceCount || 0),
    acceptedEvidenceCount: Number(artifact.acceptedEvidenceCount || 0),
    acceptedPromotionEvidenceCount: Number(artifact.acceptedPromotionEvidenceCount || 0),
    independentSourceBreadth: Number(artifact.independentSourceBreadth || artifact.sourceBreadth || 0),
    acceptedEvidenceCountByTrack: artifact.acceptedEvidenceCountByTrack || null,
    splitTrackAcceptedEvidenceCount: splitTrackResults.reduce((sum, track) => sum + Number(track.acceptedEvidenceCount || 0), 0),
    splitTrackRawEvidenceCount: splitTrackResults.reduce((sum, track) => sum + Number(track.rawEvidenceCount || 0), 0),
  };
}

function readinessFromArtifact(artifact = {}) {
  const gate = artifact.gateResult || {};
  return {
    visualStatus: artifact.visualStatus || gate.visualStatus || 'unknown',
    gate: gate.gate || 'unknown',
    reportCandidateAllowed: Boolean(artifact.reportCandidateAllowed || gate.gate === 'report_candidate_allowed'),
    finalBlocker: artifact.finalBlocker || null,
    blockType: artifact.blockType || null,
    blockers: uniqueStrings([
      gate.blockers,
      artifact.finalBlocker,
      artifact.finalBlockerByTrack && Object.values(artifact.finalBlockerByTrack),
    ], 40),
  };
}

export function parseAutonomousResearchRepairLoopArgs(argv = process.argv.slice(2)) {
  const out = {
    maxIterations: 5,
    maxFilesChanged: 10,
    maxSeeds: 1,
    maxTracks: 1,
    mode: 'plan',
    maxQueries: 6,
    stopOnTestFailure: true,
    continueSafe: true,
    stopAfterAction: null,
    noRepeatSameActionWithoutProgress: true,
    allowCodePatch: false,
    allowProviderActivation: false,
    allowReadinessPromotion: false,
    allowReportCandidateWrite: false,
    artifactRoot: DEFAULT_ARTIFACT_ROOT,
    outputPath: DEFAULT_OUTPUT_PATH,
    writeArtifact: true,
    valuationCacheFixture: null,
    marketRegimeFixture: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [rawKey, inlineValue] = token.slice(2).split('=');
    const key = rawKey.trim();
    let value = inlineValue ?? null;
    if (inlineValue == null) {
      const next = argv[index + 1];
      if (next && !String(next).startsWith('--')) {
        value = next;
        index += 1;
      }
    }
    if (key === 'max-iterations' || key === 'maxIterations') out.maxIterations = parseNumber(value, out.maxIterations);
    else if (key === 'max-files-changed' || key === 'maxFilesChanged') out.maxFilesChanged = parseNumber(value, out.maxFilesChanged);
    else if (key === 'max-seeds' || key === 'maxSeeds') out.maxSeeds = parseNumber(value, out.maxSeeds);
    else if (key === 'max-tracks' || key === 'maxTracks') out.maxTracks = parseNumber(value, out.maxTracks);
    else if (key === 'max-queries' || key === 'maxQueries') out.maxQueries = parseNumber(value, out.maxQueries);
    else if (key === 'stop-on-test-failure' || key === 'stopOnTestFailure') out.stopOnTestFailure = parseBool(value, true);
    else if (key === 'continue-safe' || key === 'continueSafe') out.continueSafe = parseBool(value, true);
    else if (key === 'stop-after-action' || key === 'stopAfterAction') out.stopAfterAction = parseBool(value, true);
    else if (key === 'no-repeat-same-action-without-progress' || key === 'noRepeatSameActionWithoutProgress') out.noRepeatSameActionWithoutProgress = parseBool(value, true);
    else if (key === 'mode') out.mode = String(value || out.mode);
    else if (key === 'dry-run') out.mode = 'plan';
    else if (key === 'apply') out.mode = 'apply';
    else if (key === 'allow-code-patch' || key === 'allowCodePatch') out.allowCodePatch = parseBool(value, true);
    else if (key === 'allow-provider-activation' || key === 'allowProviderActivation') out.allowProviderActivation = false;
    else if (key === 'allow-readiness-promotion' || key === 'allowReadinessPromotion') out.allowReadinessPromotion = false;
    else if (key === 'allow-report-candidate-write' || key === 'allowReportCandidateWrite') out.allowReportCandidateWrite = false;
    else if (key === 'artifact-root' || key === 'artifactRoot') out.artifactRoot = path.resolve(String(value || out.artifactRoot));
    else if (key === 'output' || key === 'output-path' || key === 'outputPath') out.outputPath = path.resolve(String(value || out.outputPath));
    else if (key === 'valuation-cache-fixture' || key === 'valuationCacheFixture' || key === 'local-valuation-cache') out.valuationCacheFixture = path.resolve(String(value || ''));
    else if (key === 'market-regime-fixture' || key === 'marketValidationRegimeFixture' || key === 'market-regime-support-fixture') out.marketRegimeFixture = path.resolve(String(value || ''));
    else if (key === 'no-write') out.writeArtifact = false;
    else if (key === 'help' || key === 'h') out.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  out.maxIterations = Math.max(1, Math.min(20, Math.floor(out.maxIterations || 5)));
  out.maxFilesChanged = Math.max(0, Math.min(100, Math.floor(out.maxFilesChanged || 10)));
  out.maxSeeds = Math.max(1, Math.min(10, Math.floor(out.maxSeeds || 1)));
  out.maxTracks = Math.max(1, Math.min(10, Math.floor(out.maxTracks || 1)));
  out.maxQueries = Math.max(1, Math.min(20, Math.floor(out.maxQueries || 6)));
  out.mode = ['plan', 'execute-safe', 'apply'].includes(out.mode) ? out.mode : 'plan';
  if (out.stopAfterAction === null) out.stopAfterAction = out.mode === 'plan';
  if (out.mode === 'plan') out.continueSafe = false;
  out.allowProviderActivation = false;
  out.allowReadinessPromotion = false;
  out.allowReportCandidateWrite = false;
  return out;
}

function helpText() {
  return `Usage:
  node --import tsx scripts/run-autonomous-research-repair-loop.mjs --mode plan
  node --import tsx scripts/run-autonomous-research-repair-loop.mjs --mode execute-safe --continue-safe true --max-iterations 5 --max-queries 6
  node --import tsx scripts/run-autonomous-research-repair-loop.mjs --mode execute-safe --valuation-cache-fixture tests/fixtures/local-valuation-fundamentals-cache.caveated.json --max-iterations 8
  node --import tsx scripts/run-autonomous-research-repair-loop.mjs --mode apply --max-iterations 1

The repair loop reads current seed-bias/child acquisition artifacts, selects the
smallest safe next action, writes an audit artifact, and replans after each
bounded result until max-iterations or no safe action. It never activates
providers, writes canonical/source registry state, or raises report/investment
readiness.
Default mode is plan and stops after selecting one action. execute-safe replans
by default and only runs allowlisted bounded actions such as
run_limited_negative_control, run_limited_grid_mechanism_validation,
run_limited_issuer_bridge_track, run_limited_holdout_validation, and
run_limited_controlled_market_validation against one seed/track.
`;
}

async function readJsonIfExists(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function latestJsonMatching(root, predicate) {
  const files = [];
  async function walk(dir) {
    let names = [];
    try {
      names = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json') && predicate(fullPath, entry.name)) {
        try {
          const info = await stat(fullPath);
          files.push({ filePath: fullPath, mtimeMs: info.mtimeMs });
        } catch {
          // Ignore unreadable runtime artifacts.
        }
      }
    }
  }
  await walk(root);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs || b.filePath.localeCompare(a.filePath));
  for (const item of files.slice(0, 25)) {
    const parsed = await readJsonIfExists(item.filePath);
    if (parsed) return { filePath: path.resolve(item.filePath), artifact: parsed };
  }
  return null;
}

export async function loadAutonomousRepairInputState(options = {}) {
  const root = path.resolve(options.artifactRoot || DEFAULT_ARTIFACT_ROOT);
  const [diagnostics, acquisition, providerBlocked, providerQualityFeedback, sourceDiversityFeedback] = await Promise.all([
    latestJsonMatching(root, (_file, name) => name === 'seed-bias-diagnostics.latest.json'),
    latestJsonMatching(root, (_file, name) => name === 'seed-bias-evidence-acquisition.latest.json' || name === 'seed-bias-child-bottleneck-acquisition.latest.json'),
    latestJsonMatching(root, (file, name) => (
      (name === 'seed-bias-evidence-acquisition.latest.json' || name === 'seed-bias-child-bottleneck-acquisition.latest.json')
      && /provider-blocked|selected-child/i.test(file)
    )),
    latestJsonMatching(root, (_file, name) => name === 'provider-quality-feedback.latest.json'),
    latestJsonMatching(root, (_file, name) => name === 'source-diversity-feedback.latest.json'),
  ]);
  const acquisitionArtifact = acquisition?.artifact || {};
  const childAcquisitionArtifact = await readJsonIfExists(acquisitionArtifact.artifactPaths?.childAcquisition);
  const combinedAcquisitionArtifact = {
    ...(childAcquisitionArtifact || {}),
    ...acquisitionArtifact,
    artifactPaths: {
      ...(childAcquisitionArtifact?.artifactPaths || {}),
      ...(acquisitionArtifact.artifactPaths || {}),
    },
  };
  const rawEvidencePath = combinedAcquisitionArtifact.artifactPaths?.rawEvidence || combinedAcquisitionArtifact.rawEvidencePath || null;
  const acceptedEvidencePath = combinedAcquisitionArtifact.artifactPaths?.acceptedEvidence || combinedAcquisitionArtifact.acceptedEvidencePath || null;
  const [rawEvidenceArtifact, acceptedEvidenceArtifact] = await Promise.all([
    readJsonIfExists(rawEvidencePath),
    readJsonIfExists(acceptedEvidencePath),
  ]);
  const rawEvidenceRows = asArray(
    combinedAcquisitionArtifact.rawEvidenceRows
    || combinedAcquisitionArtifact.rawEvidence
    || rawEvidenceArtifact?.rawEvidence
    || rawEvidenceArtifact?.rows
  );
  const acceptedEvidenceRows = asArray(
    combinedAcquisitionArtifact.acceptedEvidenceRows
    || combinedAcquisitionArtifact.acceptedEvidence
    || acceptedEvidenceArtifact?.acceptedEvidence
    || acceptedEvidenceArtifact?.rows
  );
  const acceptedPromotionEvidenceCount = acceptedEvidenceRows
    .filter((row) => row.promotionEligible === true || row.evidenceUse === 'promotion_candidate')
    .length;
  const hydratedAcquisitionArtifact = {
    ...combinedAcquisitionArtifact,
    rawEvidenceRows,
    acceptedEvidenceRows,
    rawEvidenceCount: Number(combinedAcquisitionArtifact.rawEvidenceCount || rawEvidenceRows.length || 0),
    acceptedEvidenceCount: Number(combinedAcquisitionArtifact.acceptedEvidenceCount || acceptedEvidenceRows.length || 0),
    acceptedPromotionEvidenceCount: Number(combinedAcquisitionArtifact.acceptedPromotionEvidenceCount || acceptedPromotionEvidenceCount || 0),
    independentSourceBreadth: Number(combinedAcquisitionArtifact.independentSourceBreadth || sourceBreadthFromEvidence(acceptedEvidenceRows) || 0),
  };
  return {
    artifactRoot: root,
    diagnosticsPath: diagnostics?.filePath || null,
    acquisitionPath: acquisition?.filePath || null,
    providerBlockedPath: providerBlocked?.filePath || null,
    providerQualityFeedbackPath: providerQualityFeedback?.filePath || null,
    sourceDiversityFeedbackPath: sourceDiversityFeedback?.filePath || null,
    diagnostics: diagnostics?.artifact || null,
    acquisition: hydratedAcquisitionArtifact,
    providerBlocked: providerBlocked?.artifact || null,
    providerQualityFeedback: providerQualityFeedback?.artifact || null,
    sourceDiversityFeedback: sourceDiversityFeedback?.artifact || null,
    selectedSeed: hydratedAcquisitionArtifact.selectedChildSeed || hydratedAcquisitionArtifact.selectedChild || null,
    evidenceBefore: evidenceCountsFromArtifact(hydratedAcquisitionArtifact),
    readinessBefore: readinessFromArtifact(hydratedAcquisitionArtifact),
    boundariesBefore: {
      providerActivationWrites: Number(hydratedAcquisitionArtifact.boundaries?.providerActivationWrites || 0),
      canonicalWrites: Number(hydratedAcquisitionArtifact.boundaries?.canonicalWrites || 0),
      sourceRegistryWrites: Number(hydratedAcquisitionArtifact.boundaries?.sourceRegistryWrites || 0),
      approvalQueueWrites: Number(hydratedAcquisitionArtifact.boundaries?.approvalQueueWrites || 0),
      reportBackfillWrites: Number(hydratedAcquisitionArtifact.boundaries?.reportBackfillWrites || 0),
    },
  };
}

function hasProviderGaps(artifact = {}) {
  return uniqueStrings([
    artifact.providerGapRequired,
    artifact.providerGapArtifacts?.map((item) => item.providerName || item.provider || item.providerGap),
    artifact.providerGapProposalLinks?.map((item) => item.providerName || item.provider || item.providerGap),
    artifact.providerBlockedClassification?.providerGapRequired,
  ], 40).length > 0;
}

function knownNarrativeState(artifact = {}) {
  const seed = artifact.selectedChildSeed || artifact.selectedChild || artifact.seed || {};
  const scores = seed.scores || artifact.seedScores || {};
  return {
    knownNarrativeScore: Number(scores.knownNarrativeScore || scores.known_narrative_score || 0),
    parentOnlyDueToKnownNarrative: Boolean(seed.parentOnlyDueToKnownNarrative || artifact.parentOnlyDueToKnownNarrative),
  };
}

function trackResultFor(artifact = {}, trackName = '') {
  return asArray(artifact.splitTrackResults).find((track) => track.track === trackName)
    || asArray(artifact.trackResults).find((track) => track.track === trackName)
    || {};
}

function acceptedEvidenceCountForTrack(artifact = {}, trackName = '') {
  const result = trackResultFor(artifact, trackName);
  const byTrack = artifact.acceptedEvidenceCountByTrack || {};
  const splitTrack = trackName === 'mechanism_validation_track'
    ? artifact.splitTracks?.mechanismValidationTrack
    : artifact.splitTracks?.issuerBridgeTrack;
  return Number(result.acceptedEvidenceCount || splitTrack?.acceptedEvidenceCount || byTrack[trackName] || 0);
}

function rawEvidenceCountForTrack(artifact = {}, trackName = '') {
  const result = trackResultFor(artifact, trackName);
  const splitTrack = trackName === 'mechanism_validation_track'
    ? artifact.splitTracks?.mechanismValidationTrack
    : artifact.splitTracks?.issuerBridgeTrack;
  return Number(result.rawEvidenceCount || splitTrack?.rawEvidenceCount || 0);
}

function negativeControlStatusFromArtifact(artifact = {}) {
  return artifact.negativeControlStatus || artifact.splitTracks?.issuerBridgeTrack?.negativeControlStatus || null;
}

function issuerBridgeClosedOrPartial(artifact = {}) {
  return /closed|attached|partial/i.test(String(artifact.issuerBridgeStatus || ''));
}

function marketValidationAllowedState(inputState = {}, evidence = null) {
  const artifact = inputState.acquisition || {};
  const counts = evidence || inputState.evidenceBefore || evidenceCountsFromArtifact(artifact);
  const acceptedMechanism = acceptedEvidenceCountForTrack(artifact, 'mechanism_validation_track');
  const acceptedIssuer = acceptedEvidenceCountForTrack(artifact, 'issuer_bridge_track');
  const acceptedAny = Number(counts.acceptedEvidenceCount || 0) + Number(counts.splitTrackAcceptedEvidenceCount || 0) + acceptedMechanism + acceptedIssuer;
  const negativeRepeatedInconclusive = Boolean(
    artifact.repairLoopState?.negativeControlAttempted
    && /INCONCLUSIVE/i.test(String(negativeControlStatusFromArtifact(artifact) || '')),
  );
  const reasons = [];
  if (acceptedAny < 1) reasons.push('accepted evidence is required before controlled market validation');
  if (!issuerBridgeClosedOrPartial(artifact)) reasons.push('issuer bridge must be closed or partial before controlled market validation');
  if (negativeRepeatedInconclusive) reasons.push('negative control is repeatedly inconclusive in the same bounded scope');
  return {
    allowed: reasons.length === 0,
    reasons,
    acceptedAny,
    acceptedMechanism,
    acceptedIssuer,
  };
}

function holdoutValidationAllowedState(inputState = {}, evidence = null) {
  const artifact = inputState.acquisition || {};
  const counts = evidence || inputState.evidenceBefore || evidenceCountsFromArtifact(artifact);
  const acceptedMechanism = acceptedEvidenceCountForTrack(artifact, 'mechanism_validation_track');
  const acceptedIssuer = acceptedEvidenceCountForTrack(artifact, 'issuer_bridge_track');
  const acceptedAny = Number(counts.acceptedEvidenceCount || 0) + Number(counts.splitTrackAcceptedEvidenceCount || 0) + acceptedMechanism + acceptedIssuer;
  const reasons = [];
  if (acceptedAny < 1) reasons.push('accepted mechanism or issuer evidence is required before holdout validation');
  return {
    allowed: reasons.length === 0,
    reasons,
    acceptedAny,
    acceptedMechanism,
    acceptedIssuer,
  };
}

function trackLevelBlockerFor(inputState = {}) {
  const artifact = inputState.acquisition || {};
  if (artifact.routeMismatchDetected === true || artifact.blockType === 'mechanism_issuer_route_mismatch') {
    if (!artifact.splitTracks) return 'route_mismatch_unresolved';
    const mechanismAccepted = acceptedEvidenceCountForTrack(artifact, 'mechanism_validation_track');
    const issuerAccepted = acceptedEvidenceCountForTrack(artifact, 'issuer_bridge_track');
    if (mechanismAccepted < 1) {
      return artifact.repairLoopState?.gridMechanismAttempted
        ? 'track_a_mechanism_evidence_raw_only'
        : 'track_a_mechanism_evidence_missing';
    }
    if (!issuerBridgeClosedOrPartial(artifact) || issuerAccepted < 1) {
      const attemptedWithCurrentCollector = artifact.repairLoopState?.issuerBridgeAttempted
        && [
          GRID_ISSUER_BRIDGE_READONLY_VERSION,
          'grid-issuer-bridge-injected-raw',
          'generic-issuer-bridge-bounded-raw',
        ].includes(String(artifact.issuerBridgeCollectorVersion || ''));
      return attemptedWithCurrentCollector
        ? 'track_b_issuer_bridge_raw_only'
        : 'track_b_issuer_bridge_missing';
    }
  }
  return null;
}

export function classifyCurrentResearchBlocker(inputState = {}) {
  const artifact = inputState.acquisition || {};
  const providerQuality = inputState.providerQualityFeedback || {};
  const sourceDiversity = inputState.sourceDiversityFeedback || {};
  const readiness = inputState.readinessBefore || readinessFromArtifact(artifact);
  const evidence = inputState.evidenceBefore || evidenceCountsFromArtifact(artifact);
  const blockers = [];
  const reasons = [];
  const narrative = knownNarrativeState(artifact);
  const trackLevelBlocker = trackLevelBlockerFor(inputState);

  if (artifact.blockType === 'provider_blocked' || readiness.blockType === 'provider_blocked' || hasProviderGaps(artifact)) {
    blockers.push('provider_blocked');
    reasons.push('provider gaps or provider_blocked artifact present');
  }
  if (artifact.blockType === 'official_provider_gap' || artifact.officialProviderGap === true) {
    blockers.push('official_provider_gap');
    reasons.push('official provider coverage is missing for the selected seed');
  }
  if (trackLevelBlocker) {
    blockers.push(trackLevelBlocker);
    blockers.push('mechanism_issuer_route_mismatch');
    reasons.push(trackLevelBlocker === 'route_mismatch_unresolved'
      ? 'mechanism/process seed is being routed as issuer exposure and still needs Track A/B split'
      : `split route mismatch is now governed by track-level blocker ${trackLevelBlocker}`);
  } else if ((artifact.routeMismatchDetected === true || artifact.blockType === 'mechanism_issuer_route_mismatch' || readiness.blockType === 'mechanism_issuer_route_mismatch') && !artifact.splitTracks) {
    blockers.push('route_mismatch_unresolved');
    blockers.push('mechanism_issuer_route_mismatch');
    reasons.push('mechanism/process seed is being routed as issuer exposure');
  }
  if (narrative.parentOnlyDueToKnownNarrative || narrative.knownNarrativeScore >= 0.7) {
    blockers.push('broad_known_narrative');
    blockers.push('parent_needs_child_decomposition');
    reasons.push('known narrative seed should be decomposition-only');
  }
  if (artifact.issuerCoverageSkew === true) {
    blockers.push('issuer_coverage_skew');
    reasons.push('issuer document coverage is skewed');
  }
  if (evidence.acceptedEvidenceCount <= 0 && evidence.splitTrackAcceptedEvidenceCount <= 0) {
    blockers.push('accepted_evidence_missing');
    reasons.push('accepted evidence is missing');
  }
  if (evidence.acceptedPromotionEvidenceCount <= 0) {
    blockers.push('accepted_promotion_evidence_missing');
    reasons.push('accepted promotion evidence is missing');
  }
  if (Number(evidence.independentSourceBreadth || artifact.independentSourceBreadth || 0) < 2) {
    blockers.push('independent_source_breadth_missing');
    reasons.push('independent source breadth is below the minimum report-candidate threshold');
  }
  const promotionEvidenceRows = asArray(artifact.acceptedEvidenceRows)
    .filter((row) => row.promotionEligible === true || row.evidenceUse === 'promotion_candidate');
  const promotionSourceBreadth = sourceBreadthFromEvidence(promotionEvidenceRows);
  const issuerBridgeClosedByAcceptedEvidence = Number(evidence.acceptedPromotionEvidenceCount || 0) > 0
    && promotionSourceBreadth >= 2;
  const issuerBridgeClosed = /closed|attached/i.test(String(artifact.issuerBridgeStatus || artifact.trackBIssuerBridgeStatus || ''))
    || issuerBridgeClosedByAcceptedEvidence;
  if (
    !issuerBridgeClosed
    && (
      String(artifact.issuerBridgeStatus || '').toLowerCase().includes('missing')
      || readiness.blockers.includes('issuer_bridge_missing')
      || (evidence.acceptedPromotionEvidenceCount <= 0 && readiness.blockers.includes('accepted_promotion_evidence_missing'))
    )
  ) {
    blockers.push('issuer_bridge_missing');
    reasons.push('issuer bridge is missing');
  }
  if (!issuerBridgeClosed && Number(evidence.acceptedPromotionEvidenceCount || 0) > 0 && promotionSourceBreadth > 0 && promotionSourceBreadth < 2) {
    blockers.push('issuer_bridge_missing');
    blockers.push('independent_source_breadth_missing');
    reasons.push('issuer bridge has only one independent promotion source; run one bounded issuer bridge route before downstream gates');
  }
  const issuerTrackBlocker = artifact.finalBlockerByTrack?.issuerBridgeTrack || artifact.splitTracks?.issuerBridgeTrack?.finalBlocker || '';
  if (
    /inconclusive/i.test(String(artifact.negativeControlStatus || artifact.splitTracks?.issuerBridgeTrack?.negativeControlStatus || ''))
    || /negative_control/i.test(String(issuerTrackBlocker))
    || readiness.blockers.includes('negative_control_not_closed')
  ) {
    blockers.push('negative_control_inconclusive');
    blockers.push('negative_control_not_closed');
    reasons.push('negative control is inconclusive');
  }
  if (artifact.holdoutConfirmed === false || artifact.splitTracks?.issuerBridgeTrack?.holdoutConfirmed === false) {
    blockers.push('holdout_missing');
    reasons.push('holdout confirmation is missing');
  }
  if (readiness.blockers.includes('market_validation_missing')) {
    blockers.push('market_validation_missing');
    reasons.push('controlled market validation is missing');
  }
  if (
    !/^closure_passed/i.test(String(artifact.evidenceContractClosureStatus || ''))
    && (
      /evidence_contract_closure_dry_run_required/i.test(String(readiness.finalBlocker || artifact.finalBlocker || ''))
      || readiness.blockers.includes('report_candidate_write_disabled')
      || artifact.reportCandidateAllowedDiagnostic === true
    )
  ) {
    blockers.push('evidence_contract_closure_dry_run_required');
    reasons.push('all research gates are diagnostic-only closed; report candidate write and readiness promotion remain disabled');
  }
  if (/^closure_passed/i.test(String(artifact.evidenceContractClosureStatus || ''))) {
    if (!artifact.thesisValidationMemoDryRunStatus) {
      blockers.push('thesis_validation_memo_dry_run_required');
      reasons.push('evidence contract closure dry-run is complete; thesis validation memo dry-run is the next bounded non-promotion step');
    } else if (!artifact.valuationExpectationBridgeDryRunStatus && !artifact.valuationBridgeStatus) {
      blockers.push('valuation_expectation_bridge_dry_run_required');
      reasons.push('thesis validation memo dry-run is complete; valuation / expectation bridge diagnostic is the next bounded non-promotion step');
    } else if (
      !artifact.repairLoopState?.marketRegimeSupportRepairAttempted
      && /blocked_market_validation_regime_caveat|blocked_market_validation_regime_missing|blocked_market_validation_contradictory/i
        .test(String(artifact.investmentMemoReadinessDiagnostic?.status || artifact.finalBlocker || ''))
    ) {
      const status = String(artifact.marketValidationRegimeStatus || artifact.marketRegimeSupport?.marketValidationRegimeStatus || 'regime_missing');
      if (status === 'regime_missing') blockers.push('market_validation_regime_missing');
      else if (status === 'regime_contradictory') blockers.push('blocked_market_validation_regime_caveat');
      else blockers.push('blocked_market_validation_regime_caveat');
      if (artifact.extremeTstatWarning || artifact.marketRegimeSupport?.extremeTstatWarning) blockers.push('market_validation_extreme_tstat_warning');
      if (uniqueStrings([artifact.marketValidationWarnings, artifact.marketRegimeSupport?.caveats], 40).includes('DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT')) {
        blockers.push('DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT');
      }
      reasons.push('valuation / expectation bridge diagnostic is complete; market regime support diagnostic is the next bounded non-promotion repair');
    } else if (!artifact.finalInvestmentReportDryRunStatus) {
      blockers.push('final_investment_report_dry_run_required');
      reasons.push('all diagnostic repair lanes have run; generate final investment report dry-run or blocked dry-run artifact without promotion writes');
    } else {
      blockers.push('no_safe_next_action');
      reasons.push('valuation / expectation bridge diagnostic is complete; do not write report_candidate automatically');
    }
  }
  if (artifact.failureClassification?.counts?.SOURCE_UNAVAILABLE > 0) {
    blockers.push('source_unavailable');
    reasons.push('source route returned unavailable');
  }
  if (providerQuality.summary?.repeatedFailureProviderCount > 0) {
    const action = String(providerQuality.recommendedRemediationAction || '');
    if (/quarantine|cooldown/i.test(action)) {
      blockers.push('source_unavailable');
      reasons.push('provider quality feedback recommends cooldown or quarantine for repeated source failures');
    } else if (/fixture/i.test(action)) {
      blockers.push('weak_evidence_only');
      blockers.push('document_extraction_weak');
      reasons.push('provider quality feedback found repeated weak evidence without accepted promotion evidence');
    } else if (/alternative|decompose|rewrite/i.test(action)) {
      blockers.push('seed_decomposition_required');
      reasons.push('provider quality feedback found repeated no-result routes requiring alternate source bucket or narrower seed');
    } else if (/provider_gap/i.test(action)) {
      blockers.push('official_provider_gap');
      reasons.push('provider quality feedback requires provider gap proposal');
    }
  }
  if ((providerQuality.summary?.collectorRequirementCount || 0) > 0) {
    blockers.push('official_provider_gap');
    reasons.push('staged providers without bounded collectors require fixture or collector requirements');
  }
  if ((sourceDiversity.sourceBucketQuotaWarnings || []).length > 0) {
    blockers.push('source_bucket_quota_violation');
    reasons.push('source diversity feedback found source bucket or generated report overuse');
  }
  if ((sourceDiversity.underrepresentedEvidenceClasses || []).length > 0 && evidence.acceptedPromotionEvidenceCount <= 0) {
    blockers.push('underrepresented_evidence_class_missing');
    reasons.push('source diversity feedback found underrepresented evidence classes without promotion evidence');
  }
  if (artifact.failureClassification?.counts?.STALE_DOCUMENT_ONLY > 0 || artifact.staleDocumentOnly === true) {
    blockers.push('stale_document_only');
    reasons.push('only stale documents were found');
  }
  if (artifact.failureClassification?.counts?.WEAK_EVIDENCE > 0 || artifact.weakEvidenceOnly === true) {
    blockers.push('weak_evidence_only');
    reasons.push('only weak raw evidence was found');
  }
  if (artifact.companyIrCollectorStatus?.selectedDocumentCount > 0 && evidence.acceptedEvidenceCount <= 0) {
    blockers.push('document_extraction_weak');
    reasons.push('document extraction found raw docs without accepted bridge');
  }
  if (!blockers.length && readiness.reportCandidateAllowed === false && readiness.blockers.length > 0) {
    blockers.push('seed_decomposition_required');
    reasons.push('seed is blocked but no specific closure lane is actionable');
  }

  const primaryBlocker = BLOCKER_PRIORITY.find((item) => blockers.includes(item)) || 'operator_review_required';
  return {
    primaryBlocker,
    blockers: uniqueStrings(blockers, 30),
    reasons: uniqueStrings(reasons, 30),
    routeMismatchAlreadySplit: Boolean(artifact.splitTracks),
    topLevelBlocker: trackLevelBlocker ? 'mechanism_issuer_route_mismatch' : primaryBlocker,
    trackLevelBlocker,
    providerGapsPresent: hasProviderGaps(artifact),
    acceptedEvidenceMissing: evidence.acceptedEvidenceCount <= 0 && evidence.splitTrackAcceptedEvidenceCount <= 0,
    readiness,
    evidence,
    providerQualityFeedback: providerQuality,
    sourceDiversityFeedback: sourceDiversity,
    providerQualityRecommendedAction: providerQuality.recommendedRemediationAction || null,
    sourceDiversityRecommendedAction: sourceDiversity.recommendedNextAction || null,
  };
}

export function chooseNextAllowedAction(classification = {}, inputState = {}, options = {}) {
  const artifact = inputState.acquisition || {};
  const blocker = classification.primaryBlocker;
  if (blocker === 'route_mismatch_unresolved') {
    return {
      action: 'split_mechanism_and_issuer_tracks',
      reason: 'route mismatch is unresolved; split process mechanism and issuer bridge tracks first',
      terminalAfterAction: false,
      actionPriorityRank: ACTION_PRIORITY_RANKS.split_mechanism_and_issuer_tracks,
      actionSkippedReasons: [],
    };
  }
  if (blocker === 'track_a_mechanism_evidence_missing') {
    return {
      action: 'run_limited_grid_mechanism_validation',
      reason: 'Track A mechanism evidence is missing and must run before issuer/holdout/market gates',
      terminalAfterAction: false,
      actionPriorityRank: ACTION_PRIORITY_RANKS.run_limited_grid_mechanism_validation,
      actionSkippedReasons: [],
    };
  }
  if (blocker === 'track_a_mechanism_evidence_raw_only') {
    return {
      action: 'generate_next_operator_review_task',
      reason: 'Track A official route produced raw-only evidence; do not advance to holdout or market without accepted mechanism evidence',
      terminalAfterAction: true,
      actionPriorityRank: ACTION_PRIORITY_RANKS.generate_next_operator_review_task,
      actionSkippedReasons: ['track_a_raw_only_without_accepted_evidence'],
    };
  }
  if (blocker === 'track_b_issuer_bridge_missing') {
    return {
      action: 'run_limited_issuer_bridge_track',
      reason: 'Track B issuer bridge is missing and must run before negative, holdout, or market gates',
      terminalAfterAction: false,
      actionPriorityRank: ACTION_PRIORITY_RANKS.run_limited_issuer_bridge_track,
      actionSkippedReasons: [],
    };
  }
  if (blocker === 'track_b_issuer_bridge_raw_only') {
    return {
      action: 'generate_next_operator_review_task',
      reason: 'Track B issuer route produced raw-only evidence; do not advance without accepted issuer bridge evidence',
      terminalAfterAction: true,
      actionPriorityRank: ACTION_PRIORITY_RANKS.generate_next_operator_review_task,
      actionSkippedReasons: ['track_b_raw_only_without_accepted_issuer_bridge'],
    };
  }
  if (blocker === 'provider_blocked') {
    return {
      action: 'create_provider_gap_proposal',
      reason: 'provider_blocked seeds must stay blocked and produce review-gated provider gap proposals',
      terminalAfterAction: true,
      actionPriorityRank: ACTION_PRIORITY_RANKS.create_provider_gap_proposal,
      actionSkippedReasons: [],
    };
  }
  if (
    blocker === 'blocked_market_validation_regime_caveat'
    || blocker === 'market_validation_regime_missing'
    || blocker === 'market_validation_extreme_tstat_warning'
    || blocker === 'DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT'
  ) {
    return {
      action: 'market_validation_regime_support_repair',
      reason: 'controlled market validation has an unresolved regime-support caveat; recompute local regime support without readiness promotion',
      terminalAfterAction: false,
      actionPriorityRank: ACTION_PRIORITY_RANKS.market_validation_regime_support_repair,
      actionSkippedReasons: [],
    };
  }
  if (blocker === 'final_investment_report_dry_run_required') {
    return {
      action: 'final_investment_report_dry_run',
      reason: 'diagnostic lanes are complete; generate final investment report dry-run with human-review-required safety metadata',
      terminalAfterAction: true,
      actionPriorityRank: ACTION_PRIORITY_RANKS.final_investment_report_dry_run,
      actionSkippedReasons: [],
    };
  }
  if (blocker === 'route_mismatch') {
    if (!classification.routeMismatchAlreadySplit) {
      return {
        action: 'split_mechanism_and_issuer_tracks',
        reason: 'process bottleneck cannot be forced through issuer exposure route',
        terminalAfterAction: false,
        actionPriorityRank: ACTION_PRIORITY_RANKS.split_mechanism_and_issuer_tracks,
        actionSkippedReasons: [],
      };
    }
    const trackBlocker = artifact.finalBlockerByTrack?.issuerBridgeTrack || artifact.splitTracks?.issuerBridgeTrack?.finalBlocker || '';
    const mechanismBlocker = artifact.finalBlockerByTrack?.mechanismValidationTrack || artifact.splitTracks?.mechanismValidationTrack?.finalBlocker || '';
    const repairState = artifact.repairLoopState || {};
    const negativeAttempted = Boolean(
      repairState.negativeControlAttempted
      || artifact.negativeControlAttempted
      || /INCONCLUSIVE/i.test(String(artifact.negativeControlStatus || '')),
    );
    const issuerTrackResult = asArray(artifact.splitTrackResults).find((track) => track.track === 'issuer_bridge_track') || {};
    const issuerBridgeAlreadyHasEvidence = /closed|attached/i.test(String(artifact.issuerBridgeStatus || ''))
      || Number(issuerTrackResult.acceptedEvidenceCount || artifact.splitTracks?.issuerBridgeTrack?.acceptedEvidenceCount || artifact.acceptedEvidenceCountByTrack?.issuerBridgeTrack || 0) > 0;
    if (/mechanism|grid|interconnection|accepted_evidence|missing/i.test(mechanismBlocker) && !repairState.gridMechanismAttempted) {
      return {
        action: 'run_limited_grid_mechanism_validation',
        reason: 'route mismatch is already split; Track A needs official grid mechanism validation',
        terminalAfterAction: false,
        actionPriorityRank: ACTION_PRIORITY_RANKS.run_limited_grid_mechanism_validation,
        actionSkippedReasons: [],
      };
    }
    if ((/issuer_bridge|issuer_exposure|accepted_evidence|promotion_evidence|source_breadth/i.test(trackBlocker) || (negativeAttempted && !issuerBridgeAlreadyHasEvidence)) && !repairState.issuerBridgeAttempted) {
      return {
        action: 'run_limited_issuer_bridge_track',
        reason: 'route mismatch is already split; next smallest lane is issuer-bridge official evidence',
        terminalAfterAction: false,
        actionPriorityRank: ACTION_PRIORITY_RANKS.run_limited_issuer_bridge_track,
        actionSkippedReasons: [],
      };
    }
    const negativeMissing = /negative_control/i.test(trackBlocker)
      || !['SURVIVED', 'CHECKED_NO_DIRECT'].includes(String(artifact.negativeControlStatus || artifact.splitTracks?.issuerBridgeTrack?.negativeControlStatus || ''));
    if (negativeMissing && !negativeAttempted) {
      return {
        action: 'run_limited_negative_control',
        reason: 'route mismatch is already split; next smallest lane is issuer-bridge negative control',
        terminalAfterAction: false,
        actionPriorityRank: ACTION_PRIORITY_RANKS.run_limited_negative_control,
        actionSkippedReasons: [],
      };
    }
    const holdoutMissing = /holdout/i.test(trackBlocker) || artifact.holdoutConfirmed === false || artifact.splitTracks?.issuerBridgeTrack?.holdoutConfirmed === false;
    if (holdoutMissing && !repairState.holdoutAttempted) {
      return {
        action: 'run_limited_holdout_validation',
        reason: 'route mismatch is already split; next smallest lane is issuer-bridge holdout',
        terminalAfterAction: false,
        actionPriorityRank: ACTION_PRIORITY_RANKS.run_limited_holdout_validation,
        actionSkippedReasons: [],
      };
    }
    const marketMissing = /market_validation/i.test(trackBlocker) || classification.readiness?.blockers?.includes('market_validation_missing');
    if (marketMissing && !repairState.marketValidationAttempted) {
      return {
        action: 'run_limited_controlled_market_validation',
        reason: 'route mismatch is already split; only local controlled market validation is permitted',
        terminalAfterAction: false,
        actionPriorityRank: ACTION_PRIORITY_RANKS.run_limited_controlled_market_validation,
        actionSkippedReasons: [],
      };
    }
    return {
      action: 'generate_next_operator_review_task',
      reason: 'route mismatch is split but the next track blocker is not executable safely by this loop',
      terminalAfterAction: true,
      actionPriorityRank: ACTION_PRIORITY_RANKS.generate_next_operator_review_task,
      actionSkippedReasons: ['split_route_mismatch_has_no_safe_track_action'],
    };
  }
  if (blocker === 'broad_known_narrative' || blocker === 'seed_decomposition_required') {
    return {
      action: 'select_positive_path_seed',
      reason: 'broad or unresolved seed should be decomposed or replaced by a narrow validation child',
      terminalAfterAction: true,
      actionPriorityRank: 7,
      actionSkippedReasons: [],
    };
  }
  if (blocker === 'issuer_coverage_skew') {
    return {
      action: 'create_provider_gap_proposal',
      reason: 'issuer coverage skew requires missing issuer provider requirements, not broader search',
      terminalAfterAction: true,
      actionPriorityRank: ACTION_PRIORITY_RANKS.create_provider_gap_proposal,
      actionSkippedReasons: [],
    };
  }
  if (blocker === 'official_provider_gap') {
    return {
      action: 'create_provider_gap_proposal',
      reason: 'official provider gaps require review-gated adapter or fixture requirements',
      terminalAfterAction: true,
      actionPriorityRank: ACTION_PRIORITY_RANKS.create_provider_gap_proposal,
      actionSkippedReasons: [],
    };
  }
  if (blocker === 'negative_control_inconclusive') {
    const sourceBreadth = Number(classification.evidence?.independentSourceBreadth || artifact.independentSourceBreadth || 0);
    const issuerBridgeAttempted = Boolean(artifact.repairLoopState?.issuerBridgeAttempted || artifact.issuerBridgeAttempted);
    if (
      !classification.routeMismatchAlreadySplit
      && /attached|closed/i.test(String(artifact.issuerBridgeStatus || artifact.trackBIssuerBridgeStatus || ''))
      && Number(classification.evidence?.acceptedPromotionEvidenceCount || artifact.acceptedPromotionEvidenceCount || 0) > 0
      && sourceBreadth < 2
      && !issuerBridgeAttempted
    ) {
      return {
        action: 'run_limited_issuer_bridge_track',
        reason: 'one official issuer bridge is attached but source breadth is still below threshold; collect one bounded independent issuer source before negative-control sequencing',
        terminalAfterAction: false,
        actionPriorityRank: ACTION_PRIORITY_RANKS.run_limited_issuer_bridge_track,
        actionSkippedReasons: ['independent_source_breadth_missing', 'independent_source_breadth_missing_before_negative_control'],
      };
    }
    const attemptedWithCurrentCollector = (artifact.repairLoopState?.negativeControlAttempted || artifact.negativeControlAttempted)
      && [
        GRID_ISSUER_NEGATIVE_CONTROL_READONLY_VERSION,
        'negative-control-injected-raw',
        'generic-negative-control-bounded-raw',
      ].includes(String(artifact.negativeControlCollectorVersion || ''));
    if (attemptedWithCurrentCollector) {
      if (sourceBreadth < 2 && !issuerBridgeAttempted) {
        return {
          action: 'run_limited_issuer_bridge_track',
          reason: 'negative-control already returned INCONCLUSIVE; source breadth is still below threshold, so try one bounded issuer-bridge route for an independent official source',
          terminalAfterAction: false,
          actionPriorityRank: ACTION_PRIORITY_RANKS.run_limited_issuer_bridge_track,
          actionSkippedReasons: ['negative_control_inconclusive_already_attempted', 'independent_source_breadth_missing'],
        };
      }
      const holdoutMissing = artifact.holdoutConfirmed === false
        || artifact.splitTracks?.issuerBridgeTrack?.holdoutConfirmed === false
        || classification.readiness?.blockers?.includes('holdout_missing');
      const holdoutAttempted = Boolean(artifact.repairLoopState?.holdoutAttempted || artifact.holdoutAttempted);
      const holdoutGate = holdoutValidationAllowedState(inputState, classification.evidence);
      if (holdoutMissing && !holdoutAttempted && holdoutGate.allowed) {
        return {
          action: 'run_limited_holdout_validation',
          reason: 'negative-control already returned INCONCLUSIVE for the same bounded scope; run the next independent holdout lane instead of repeating it',
          terminalAfterAction: false,
          actionPriorityRank: ACTION_PRIORITY_RANKS.run_limited_holdout_validation,
          actionSkippedReasons: ['negative_control_inconclusive_already_attempted'],
          whyHoldoutValidationAllowed: holdoutGate,
        };
      }
      return {
        action: 'operator_review_required',
        reason: 'negative-control already returned INCONCLUSIVE for the same bounded scope and no independent safe lane is currently open; do not repeat without a narrower route',
        terminalAfterAction: true,
        actionPriorityRank: ACTION_PRIORITY_RANKS.operator_review_required,
        actionSkippedReasons: ['negative_control_inconclusive_already_attempted'],
      };
    }
    return {
      action: 'run_limited_negative_control',
      reason: 'negative-control lane is the smallest blocker-specific execution',
      terminalAfterAction: false,
      actionPriorityRank: ACTION_PRIORITY_RANKS.run_limited_negative_control,
      actionSkippedReasons: [],
    };
  }
  if (blocker === 'holdout_missing') {
    const holdoutGate = holdoutValidationAllowedState(inputState, classification.evidence);
    if (!holdoutGate.allowed) {
      return {
        action: 'generate_next_operator_review_task',
        reason: 'holdout validation is gated until accepted mechanism or issuer evidence exists',
        terminalAfterAction: true,
        actionPriorityRank: ACTION_PRIORITY_RANKS.generate_next_operator_review_task,
        actionSkippedReasons: holdoutGate.reasons,
        whyHoldoutValidationAllowed: holdoutGate,
      };
    }
    return {
      action: 'run_limited_holdout_validation',
      reason: 'holdout validation is missing and must be resolved before report candidate',
      terminalAfterAction: true,
      actionPriorityRank: ACTION_PRIORITY_RANKS.run_limited_holdout_validation,
      actionSkippedReasons: [],
      whyHoldoutValidationAllowed: holdoutGate,
    };
  }
  if (blocker === 'accepted_evidence_missing') {
    return {
      action: 'create_fixture_requirement',
      reason: 'official route did not produce accepted evidence; do not retry broad search',
      terminalAfterAction: true,
      actionPriorityRank: 7,
      actionSkippedReasons: ['accepted_evidence_missing_without_track_specific_action'],
    };
  }
  if (blocker === 'independent_source_breadth_missing') {
    const issuerBridgeAttempted = Boolean(artifact.repairLoopState?.issuerBridgeAttempted || artifact.issuerBridgeAttempted);
    if (!issuerBridgeAttempted) {
      return {
        action: 'run_limited_issuer_bridge_track',
        reason: 'accepted evidence exists but source breadth is below threshold; run one bounded issuer bridge route for an independent source',
        terminalAfterAction: false,
        actionPriorityRank: ACTION_PRIORITY_RANKS.run_limited_issuer_bridge_track,
        actionSkippedReasons: ['independent_source_breadth_missing'],
      };
    }
    return {
      action: 'create_fixture_requirement',
      reason: 'independent source breadth remains below threshold after bounded issuer route; require a new official source/provider fixture rather than broad retry',
      terminalAfterAction: true,
      actionPriorityRank: ACTION_PRIORITY_RANKS.create_fixture_requirement,
      actionSkippedReasons: ['independent_source_breadth_missing_after_bounded_issuer_route'],
    };
  }
  if (blocker === 'issuer_bridge_missing') {
    const issuerBridgeAttempted = Boolean(artifact.repairLoopState?.issuerBridgeAttempted || artifact.issuerBridgeAttempted);
    if (issuerBridgeAttempted) {
      return {
        action: 'create_fixture_requirement',
        reason: 'bounded issuer bridge route already produced raw-only evidence; require an independent official issuer/source fixture instead of repeating the same route',
        terminalAfterAction: true,
        actionPriorityRank: ACTION_PRIORITY_RANKS.create_fixture_requirement,
        actionSkippedReasons: ['issuer_bridge_missing_after_bounded_route'],
      };
    }
    return {
      action: 'run_limited_issuer_bridge_track',
      reason: 'issuer bridge is missing; only a selected seed official route is permitted',
      terminalAfterAction: true,
      actionPriorityRank: ACTION_PRIORITY_RANKS.run_limited_issuer_bridge_track,
      actionSkippedReasons: [],
    };
  }
  if (blocker === 'market_validation_missing') {
    const marketGate = marketValidationAllowedState(inputState, classification.evidence);
    if (!marketGate.allowed) {
      return {
        action: 'generate_next_operator_review_task',
        reason: 'controlled market validation is gated until accepted evidence and issuer bridge are present',
        terminalAfterAction: true,
        actionPriorityRank: ACTION_PRIORITY_RANKS.generate_next_operator_review_task,
        actionSkippedReasons: marketGate.reasons,
        whyMarketValidationAllowed: marketGate,
      };
    }
    return {
      action: 'run_limited_controlled_market_validation',
      reason: 'market validation requires local controlled data and must not be source-query promoted',
      terminalAfterAction: true,
      actionPriorityRank: ACTION_PRIORITY_RANKS.run_limited_controlled_market_validation,
      actionSkippedReasons: [],
      whyMarketValidationAllowed: marketGate,
    };
  }
  if (blocker === 'evidence_contract_closure_dry_run_required') {
    return {
      action: 'evidence_contract_closure_dry_run',
      reason: 'all diagnostic gates are closed; build Evidence Contract Matrix and report subject dry-run without writing report_candidate',
      terminalAfterAction: true,
      actionPriorityRank: ACTION_PRIORITY_RANKS.evidence_contract_closure_dry_run,
      actionSkippedReasons: [],
    };
  }
  if (blocker === 'thesis_validation_memo_dry_run_required') {
    return {
      action: 'thesis_validation_memo_dry_run',
      reason: 'Evidence Contract Matrix closure passed with caveats; generate a thesis validation memo dry-run without report candidate or readiness writes',
      terminalAfterAction: true,
      actionPriorityRank: ACTION_PRIORITY_RANKS.thesis_validation_memo_dry_run,
      actionSkippedReasons: [],
    };
  }
  if (blocker === 'valuation_expectation_bridge_dry_run_required') {
    return {
      action: 'valuation_expectation_bridge_dry_run',
      reason: 'Thesis validation memo is complete; build valuation / expectation bridge and regime-support diagnostics without readiness promotion',
      terminalAfterAction: true,
      actionPriorityRank: ACTION_PRIORITY_RANKS.valuation_expectation_bridge_dry_run,
      actionSkippedReasons: [],
    };
  }
  if (blocker === 'source_bucket_quota_violation') {
    return {
      action: 'apply_source_bucket_quota',
      reason: 'source diversity feedback detected source bucket skew; update the next safe action artifact instead of broad collection',
      terminalAfterAction: true,
      actionPriorityRank: ACTION_PRIORITY_RANKS.generate_next_operator_review_task,
      actionSkippedReasons: ['source_bucket_quota_violation'],
    };
  }
  if (blocker === 'underrepresented_evidence_class_missing') {
    return {
      action: 'create_targeted_backfill_task',
      reason: 'source diversity feedback detected underrepresented evidence classes; create targeted backfill requirements without promotion',
      terminalAfterAction: true,
      actionPriorityRank: ACTION_PRIORITY_RANKS.generate_next_operator_review_task,
      actionSkippedReasons: ['underrepresented_evidence_class_missing'],
    };
  }
  if (blocker === 'source_unavailable' || blocker === 'document_extraction_weak') {
    if (blocker === 'source_unavailable' && /quarantine|cooldown/i.test(String(classification.providerQualityRecommendedAction || ''))) {
      return {
        action: 'quarantine_source_or_provider',
        reason: 'provider quality feedback recommends cooldown/quarantine after repeated unavailable source results',
        terminalAfterAction: true,
        actionPriorityRank: ACTION_PRIORITY_RANKS.generate_next_operator_review_task,
        actionSkippedReasons: [blocker],
      };
    }
    return {
      action: blocker === 'source_unavailable' ? 'generate_next_operator_review_task' : 'improve_document_ranking',
      reason: 'failure is source/document specific; do not broaden collection automatically',
      terminalAfterAction: true,
      actionPriorityRank: 7,
      actionSkippedReasons: [blocker],
    };
  }
  return {
    action: 'operator_review_required',
    reason: 'no safe bounded next action exists',
    terminalAfterAction: true,
    actionPriorityRank: ACTION_PRIORITY_RANKS.operator_review_required,
    actionSkippedReasons: ['no_safe_next_action'],
  };
}

function providerGapProposal(providerName, artifact = {}) {
  const affectedIssuers = uniqueStrings([
    artifact.affectedIssuers,
    artifact.missingIssuerDocuments,
    artifact.selectedChildSeed?.issuerCandidates,
  ], 20);
  return {
    providerName,
    fillsEvidenceClass: uniqueStrings([
      artifact.selectedChildSeed?.requiredEvidenceClasses,
      'issuer_exposure',
      'holdout_validation',
    ], 12),
    affectedIssuers,
    requiredDocumentTypes: uniqueStrings([
      'annual_report',
      'integrated_report',
      'ir_presentation',
      'official_filing',
    ], 12),
    authRequired: ['edinet', 'tdnet', 'taiwan_mops'].includes(providerName),
    apiKeyRequired: ['edinet', 'tdnet', 'taiwan_mops'].includes(providerName),
    rateLimit: 'bounded read-only collector; one selected seed or child seed per run',
    allowlist: affectedIssuers.length ? affectedIssuers : ['selected_child_seed_only'],
    parserOutputSchema: {
      issuer: 'string',
      sourceUrl: 'string',
      documentType: 'string',
      publishedAt: 'string|null',
      extractedTextSnippet: 'string|null',
      matchedBottleneckTerms: 'string[]',
      matchedOperatingTerms: 'string[]',
      evidenceClass: 'string',
    },
    fixtureRequirement: 'fixture with one official document and expected parsed issuer/evidence-class rows',
    healthCheckCommand: `node --import tsx scripts/propose-provider-adapter.mjs --provider ${providerName} --dry-run`,
    testCommand: `node --import tsx --test tests/provider-adapter-factory-schema.test.mjs`,
    failureModes: ['source_unavailable', 'auth_required', 'parser_no_match', 'stale_document', 'ticker_only'],
    reviewGatedActivation: true,
    activationAllowed: false,
  };
}

function normalizeExistingProviderGapArtifact(item = {}, artifact = {}) {
  const providerName = compact(item.providerName || item.provider || item.providerGap || item.providerGapProvider || '').replace(/^provider_gap_/, '');
  const proposal = {
    ...providerGapProposal(providerName || 'provider_gap', artifact),
    ...item,
    providerName: providerName || item.providerName || item.provider || 'provider_gap',
    reviewGatedActivation: true,
    activationAllowed: false,
  };
  for (const field of REQUIRED_PROVIDER_PROPOSAL_FIELDS) {
    if (proposal[field] === undefined) proposal[field] = providerGapProposal(proposal.providerName, artifact)[field];
  }
  return proposal;
}

function buildProviderGapProposalAction(inputState = {}) {
  const artifact = inputState.acquisition || inputState.providerBlocked || {};
  const existing = asArray(artifact.providerGapArtifacts).length
    ? artifact.providerGapArtifacts
    : asArray(artifact.providerGapRequired).map((provider) => ({ providerName: provider }));
  const proposals = (existing.length ? existing : ['provider_gap'].map((providerName) => ({ providerName })))
    .map((item) => normalizeExistingProviderGapArtifact(item, artifact));
  return {
    ok: true,
    proposals,
    providerActivationWrites: 0,
    readinessChanged: false,
    reportCandidateAllowed: false,
    boundaries: zeroBoundaries(),
  };
}

function buildSplitTracksAction(inputState = {}, generatedAt = new Date().toISOString()) {
  const artifact = inputState.acquisition || {};
  const seed = artifact.selectedChildSeed || artifact.selectedChild || {};
  const splitTracks = artifact.splitTracks || buildInterconnectionRouteSplitTracks(seed, { generatedAt });
  return {
    ok: true,
    splitTracks,
    providerActivationWrites: 0,
    readinessChanged: false,
    reportCandidateAllowed: false,
    boundaries: zeroBoundaries(),
  };
}

function buildBoundedExecutionTask(action = '', inputState = {}) {
  const artifact = inputState.acquisition || {};
  const evidenceClass = {
    run_limited_negative_control: 'negative_control',
    run_limited_holdout_validation: 'holdout_validation',
    run_limited_grid_mechanism_validation: 'mechanism_validation',
    run_limited_issuer_bridge_track: 'issuer_exposure',
    run_limited_official_route: 'issuer_exposure',
    run_limited_controlled_market_validation: 'market_validation',
  }[action] || 'operator_review';
  return {
    ok: true,
    executionDeferred: true,
    task: {
      taskId: `repair-loop:${evidenceClass}:${compact(artifact.seedId || artifact.selectedChildSeed?.childSeedId || 'selected-seed')}`,
      seedId: artifact.seedId || artifact.selectedChildSeed?.childSeedId || null,
      evidenceClass,
      status: 'needs_operator_review',
      maxSeeds: 1,
      maxTracks: 1,
      providerActivationAllowed: false,
      readinessPromotionAllowed: false,
      reportCandidateWriteAllowed: false,
      reason: 'repair loop selected this as the next bounded action; execution remains explicit and seed-scoped',
    },
    providerActivationWrites: 0,
    readinessChanged: false,
    reportCandidateAllowed: false,
    boundaries: zeroBoundaries(),
  };
}

function zeroBoundaries() {
  return { ...SAFE_ZERO_BOUNDARIES };
}

function selectedRepairTarget(inputState = {}, trackName = 'issuer_bridge_track') {
  const artifact = inputState.acquisition || {};
  const trackResult = asArray(artifact.splitTrackResults).find((track) => track.track === trackName)
    || asArray(artifact.trackResults).find((track) => track.track === trackName)
    || null;
  const splitTrack = trackName === 'mechanism_validation_track'
    ? artifact.splitTracks?.mechanismValidationTrack
    : artifact.splitTracks?.issuerBridgeTrack;
  const trackSeed = splitTrack?.seed || trackResult?.acquisition?.seed || null;
  const selectedSeed = trackSeed || artifact.selectedChildSeed || artifact.selectedChild || {};
  return {
    seed: selectedSeed,
    track: trackResult ? trackName : (splitTrack ? trackName : null),
    trackId: trackResult?.seedId || splitTrack?.seed?.seedId || null,
    splitTrack,
    existingTrackResult: trackResult,
  };
}

function rowText(row = {}) {
  return compact([
    row.title,
    row.summary,
    row.extractedTextSnippet,
    row.matchedSnippet,
    row.text,
    row.textExcerpt,
    row.sourceTitle,
    row.documentTitle,
  ].join(' ')).toLowerCase();
}

function containsAny(text = '', terms = []) {
  const haystack = String(text || '').toLowerCase();
  return terms.some((term) => haystack.includes(String(term).toLowerCase()));
}

function officialSourceGroup(row = {}) {
  return /official|sec|filing|ir|transcript|government|grid_operator|research_dataset|utility_planning|company_release/i
    .test(compact(row.sourceGroup || row.source_group || row.provider || row.source));
}

function evidenceSourceKey(row = {}) {
  return compact(row.sourceUrl || row.url || row.documentId || row.source || row.provider || row.sourceGroup || 'unknown').toLowerCase();
}

function sourceBreadthFromEvidence(rows = []) {
  return new Set(asArray(rows).map(evidenceSourceKey).filter(Boolean)).size;
}

function loadMarketRegimeFixture(fixturePath = null) {
  if (!fixturePath) return null;
  const resolved = path.resolve(String(fixturePath));
  if (!existsSync(resolved)) return null;
  try {
    return JSON.parse(readFileSync(resolved, 'utf8'));
  } catch {
    return null;
  }
}

const ACTION_PRIORITY_RANKS = Object.freeze({
  split_mechanism_and_issuer_tracks: 1,
  run_limited_grid_mechanism_validation: 2,
  run_limited_issuer_bridge_track: 3,
  run_limited_negative_control: 4,
  run_limited_holdout_validation: 5,
  run_limited_controlled_market_validation: 6,
  evidence_contract_closure_dry_run: 7,
  thesis_validation_memo_dry_run: 8,
  valuation_expectation_bridge_dry_run: 9,
  market_validation_regime_support_repair: 10,
  repair_controlled_market_validation_regime_support: 10,
  final_investment_report_dry_run: 11,
  create_provider_gap_proposal: 9,
  generate_next_operator_review_task: 9,
  operator_review_required: 9,
});

function repairEvidenceId(prefix, target = {}, row = {}, index = 0) {
  const seed = target.seed || {};
  const seedId = compact(row.seedId || seed.seedId || seed.childSeedId || target.trackId || 'selected-seed');
  const source = compact(row.sourceUrl || row.source || row.provider || row.query || `row-${index}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `row-${index}`;
  return `repair-loop:${prefix}:${seedId}:${source}`;
}

function normalizeAcceptedEvidence(row = {}, overrides = {}) {
  return {
    evidenceId: row.evidenceId || overrides.evidenceId || row.id,
    seedId: row.seedId || overrides.seedId || row.operatorSeedId || null,
    trackId: row.trackId || overrides.trackId || null,
    evidenceClass: overrides.evidenceClass || row.evidenceClass,
    evidenceUse: overrides.evidenceUse || row.evidenceUse || 'supporting_context',
    promotionEligible: Boolean(overrides.promotionEligible ?? row.promotionEligible),
    coveredEvidenceClasses: overrides.coveredEvidenceClasses || row.coveredEvidenceClasses || [],
    source: row.source || row.provider || overrides.source || 'autonomous-research-repair-loop',
    sourceGroup: row.sourceGroup || row.source_group || overrides.sourceGroup || null,
    sourceUrl: row.sourceUrl || row.url || overrides.sourceUrl || null,
    documentTitle: row.documentTitle || row.title || '',
    issuer: row.issuer || overrides.issuer || null,
    issuerRoleClass: row.issuerRoleClass || row.roleClass || overrides.issuerRoleClass || null,
    title: row.title || row.documentTitle || row.summary || '',
    snippet: row.extractedTextSnippet || row.matchedSnippet || row.textExcerpt || '',
    matchedBottleneckTerms: overrides.matchedBottleneckTerms || row.matchedBottleneckTerms || [],
    matchedOperatingTerms: overrides.matchedOperatingTerms || row.matchedOperatingTerms || [],
    acceptanceReason: overrides.acceptanceReason || row.acceptanceReason || null,
    rejectionReason: overrides.rejectionReason || row.rejectionReason || null,
    proximityWindow: overrides.proximityWindow || row.proximityWindow || null,
    proximityScore: overrides.proximityScore ?? row.proximityScore ?? null,
    payload: row,
  };
}

function evaluateRepairGate(inputState = {}, overrides = {}) {
  const artifact = inputState.acquisition || {};
  const evidence = inputState.evidenceBefore || evidenceCountsFromArtifact(artifact);
  const acceptedEvidence = asArray(overrides.acceptedEvidence);
  const acceptedPromotionEvidence = acceptedEvidence.filter((row) => row.promotionEligible === true || row.evidenceUse === 'promotion_candidate');
  const acceptedEvidenceCount = Number(overrides.acceptedEvidenceCount ?? evidence.acceptedEvidenceCount) + acceptedEvidence.length;
  const acceptedPromotionEvidenceCount = Number(overrides.acceptedPromotionEvidenceCount ?? evidence.acceptedPromotionEvidenceCount) + acceptedPromotionEvidence.length;
  const independentSourceBreadth = Math.max(
    Number(overrides.independentSourceBreadth ?? evidence.independentSourceBreadth ?? 0),
    sourceBreadthFromEvidence(acceptedEvidence),
  );
  const negativeControlStatus = overrides.negativeControlStatus || artifact.negativeControlStatus || artifact.splitTracks?.issuerBridgeTrack?.negativeControlStatus || 'INCONCLUSIVE';
  const holdoutConfirmed = Boolean(overrides.holdoutConfirmed ?? artifact.holdoutConfirmed);
  const issuerBridgeStatus = overrides.issuerBridgeStatus || artifact.issuerBridgeStatus || 'missing';
  const marketValidationStatus = overrides.marketValidationStatus || artifact.marketValidationStatus || 'missing';
  const providerBlocked = Boolean(overrides.providerBlocked ?? artifact.blockType === 'provider_blocked');
  const routeMismatchUnresolved = Boolean(overrides.routeMismatchUnresolved ?? (artifact.routeMismatchDetected && !artifact.splitTracks));
  const broadKnownNarrative = Boolean(overrides.broadKnownNarrative ?? artifact.parentOnlyDueToKnownNarrative);
  const blockers = [];
  if (acceptedEvidenceCount < 1) blockers.push('accepted_evidence_missing');
  if (acceptedPromotionEvidenceCount < 1) blockers.push('accepted_promotion_evidence_missing');
  if (independentSourceBreadth < 2) blockers.push('independent_source_breadth_missing');
  if (!['SURVIVED', 'CHECKED_NO_DIRECT'].includes(negativeControlStatus)) blockers.push('negative_control_not_closed');
  if (!holdoutConfirmed) blockers.push('holdout_missing');
  if (!/closed|attached/i.test(String(issuerBridgeStatus))) blockers.push('issuer_bridge_missing');
  if (!/^controlled_ready$/i.test(String(marketValidationStatus))) blockers.push('market_validation_missing');
  if (providerBlocked) blockers.push('provider_blocked');
  if (routeMismatchUnresolved) blockers.push('route_mismatch');
  if (broadKnownNarrative) blockers.push('broad_known_narrative');
  const reportCandidateAllowed = blockers.length === 0;
  return {
    reportCandidateAllowed,
    readinessChanged: false,
    gateResult: reportCandidateAllowed ? 'report_candidate_allowed' : 'blocked',
    visualStatus: reportCandidateAllowed ? 'validation-candidate' : 'pending',
    finalBlocker: blockers[0] || null,
    blockers,
    acceptedEvidenceCount,
    acceptedPromotionEvidenceCount,
    independentSourceBreadth,
    negativeControlStatus,
    holdoutConfirmed,
    issuerBridgeStatus,
    marketValidationStatus,
  };
}

function selectedNegativeControlTarget(inputState = {}) {
  return selectedRepairTarget(inputState, 'issuer_bridge_track');
}

function negativeQueryFamiliesForTarget(target = {}, options = {}) {
  const seed = target.seed || {};
  const existing = target.existingTrackResult?.acquisition?.negativeControlSurvival?.items?.[0]?.negativeControlQueries
    || target.existingTrackResult?.negativeControlQueries
    || [];
  const gridLikeTarget = isGridLikeRepairTarget(target);
  return uniqueStrings([
    options.queryFamilies,
    seed.metadata?.officialNegativeQueries,
    seed.negativeControlQueries,
    seed.counterEvidenceQueries,
    existing,
    gridLikeTarget ? GRID_ISSUER_NEGATIVE_QUERY_FAMILIES : [],
    [
      'easy substitutes',
      'supplier redundancy',
      'no timing pressure',
      'no capacity constraint',
      'management denies constraint',
    ],
  ], Number(options.maxQueries || 6));
}

function negativeControlText(row = {}) {
  return compact([
    row.negativeControlStatus,
    row.negativeControlFinding,
    row.finding,
    row.closureReason,
    row.title,
    row.summary,
    row.text,
    row.textExcerpt,
  ].join(' '));
}

function isDirectInvalidatorRow(row = {}) {
  if (row.repairLoopGenerated === true && compact(row.negativeControlFinding).toLowerCase() === 'inconclusive') return false;
  const finding = compact([
    row.negativeControlStatus,
    row.negativeControlFinding,
    row.finding,
    row.closureReason,
    row.summary,
    row.text,
    row.textExcerpt,
  ].join(' '));
  if (/checked_no_direct|no direct invalidator|no direct contradiction|limited_scope|supported_constraint/i.test(finding)) return false;
  return /invalidator|accepted invalidator|found potential invalidator|oversupply|no bottleneck|no capacity constraint|management denies|demand slowdown|backlog declining/i.test(finding);
}

function classifyNegativeRaw(row = {}) {
  const text = negativeControlText(row);
  if (/503|unavailable|fetch_failed|http|timeout/i.test([row.acquisitionStatus, row.error, text].join(' '))) return 'SOURCE_UNAVAILABLE';
  if (/no_results?|no result|official_route_no_result/i.test([row.acquisitionStatus, row.error, text].join(' '))) return 'NO_RESULT';
  if (isDirectInvalidatorRow(row)) return 'CONTRADICTORY';
  if (row.accepted === true || row.acceptanceVerdict === 'accepted') return 'ACCEPTED';
  return 'WEAK_EVIDENCE';
}

function summarizeFailureClassification(rows = []) {
  const counts = {};
  for (const row of asArray(rows)) {
    const klass = classifyNegativeRaw(row);
    counts[klass] = (counts[klass] || 0) + 1;
  }
  return {
    counts,
    primaryFailure: Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
  };
}

function negativeRawRow({ target = {}, family = '', generatedAt = '', accepted = false, status = 'INCONCLUSIVE', scope = 'insufficient', index = 0 } = {}) {
  const seed = target.seed || {};
  const seedId = compact(seed.seedId || seed.childSeedId || target.trackId || 'selected-seed');
  const safeFamily = family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || `query-${index}`;
  const directInvalidator = ['WEAKENED', 'REJECTED'].includes(status);
  const checkedNoDirect = ['CHECKED_NO_DIRECT', 'CHECKED_NO_DIRECT_LIMITED_SCOPE'].includes(status);
  const survival = status === 'SURVIVED';
  return {
    evidenceId: `repair-loop:negative-control:${seedId}:${safeFamily}`,
    seedId,
    trackId: target.trackId || null,
    evidenceClass: 'negative_control',
    source: 'autonomous-research-repair-loop',
    sourceGroup: 'bounded_negative_control',
    provider: 'repair-loop-bounded-executor',
    query: family,
    negativeControlFamily: family,
    negativeControlIntent: true,
    negativeControlStatus: status,
    negativeControlScope: scope,
    negativeControlFinding: directInvalidator
      ? 'invalidator'
      : checkedNoDirect
        ? (scope === 'limited' ? 'checked_no_direct_limited_scope' : 'checked_no_direct')
        : survival
          ? 'supported_constraint'
          : 'inconclusive',
    title: `Bounded negative-control check: ${family}`,
    summary: accepted
      ? `${status}: bounded negative-control result for ${family}.`
      : `Bounded negative-control query prepared/executed for ${family}, but it did not produce accepted negative-control evidence.`,
    evidenceUse: accepted ? 'negative_control_candidate' : 'weak_noise',
    promotionEligible: false,
    acceptanceVerdict: accepted ? 'accepted' : 'not_evaluated_negative_control_raw',
    accepted,
    generatedAt,
    collectedAt: generatedAt,
    executionBoundary: {
      providerActivationWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      reportCandidateWrites: 0,
      readinessPromotionWrites: 0,
    },
  };
}

function acceptedNegativeRowsFromRaw(rows = []) {
  return asArray(rows).filter((row) => (
    row.accepted === true
    || row.acceptanceVerdict === 'accepted'
    || /negative_control_candidate/i.test(compact(row.evidenceUse || row.evidence_use))
      && /checked_no_direct|supported_constraint|invalidator|no direct invalidator|no direct contradiction/i.test(negativeControlText(row))
  )).map((row) => ({
    evidenceId: row.evidenceId || row.id,
    seedId: row.seedId || row.operatorSeedId || null,
    trackId: row.trackId || null,
    evidenceClass: 'negative_control',
    evidenceUse: 'negative_control_candidate',
    promotionEligible: false,
    coveredEvidenceClasses: [],
    source: row.source || row.provider || 'autonomous-research-repair-loop',
    title: row.title || row.summary || '',
    payload: row,
  }));
}

function statusFromNegativeRows(rawRows = [], acceptedRows = []) {
  const acceptedText = acceptedRows.map((row) => negativeControlText(row.payload || row)).join(' ');
  if (/REJECTED|direct_invalidator|accepted invalidator/i.test(acceptedText)) {
    return { status: 'REJECTED', scope: 'invalidator', finalBlocker: 'negative_control_rejected' };
  }
  if (/WEAKENED|weakening_risk_signal|margin pressure|project delay/i.test(acceptedText)) {
    return { status: 'WEAKENED', scope: 'invalidator_candidate', finalBlocker: 'negative_control_weakened' };
  }
  if (/CHECKED_NO_DIRECT_LIMITED_SCOPE|checked_no_direct_limited_scope/i.test(acceptedText)) {
    return { status: 'CHECKED_NO_DIRECT_LIMITED_SCOPE', scope: 'limited', finalBlocker: 'negative_control_limited_scope' };
  }
  if (/SURVIVED|supported_constraint|constraint supported|shortage confirmed/i.test(acceptedText)) {
    return { status: 'SURVIVED', scope: 'accepted', finalBlocker: 'holdout_or_market_validation_required' };
  }
  if (/CHECKED_NO_DIRECT|checked_no_direct|no direct invalidator|no direct contradiction/i.test(acceptedText)) {
    return { status: 'CHECKED_NO_DIRECT', scope: 'accepted', finalBlocker: 'holdout_or_market_validation_required' };
  }
  if (acceptedRows.some((row) => isDirectInvalidatorRow(row.payload || row))) {
    return { status: 'REJECTED', scope: 'invalidator', finalBlocker: 'negative_control_rejected' };
  }
  if (rawRows.some(isDirectInvalidatorRow)) {
    return { status: 'WEAKENED', scope: 'invalidator_candidate', finalBlocker: 'negative_control_weakened' };
  }
  return { status: 'INCONCLUSIVE', scope: 'insufficient', finalBlocker: 'negative_control_not_closed' };
}

export function runLimitedNegativeControlExecutor(inputState = {}, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const target = selectedNegativeControlTarget(inputState);
  const gridLikeTarget = isGridLikeRepairTarget(target);
  const defensePropulsionTarget = !gridLikeTarget && isDefensePropulsionTarget(target);
  const queryFamilies = negativeQueryFamiliesForTarget(target, options);
  const injectedRows = asArray(options.negativeControlRawEvidence);
  const collectedNegative = injectedRows.length
    ? null
    : gridLikeTarget ? collectGridIssuerNegativeControlReadonly({
      seedId: target.seed?.seedId || target.seed?.childSeedId || target.trackId || 'selected-seed',
      trackId: target.trackId || 'issuer_bridge_track',
      generatedAt,
      maxSources: Number(options.maxQueries || 6),
      sourceAllowlist: options.gridIssuerNegativeControlSourceAllowlist,
    }) : defensePropulsionTarget ? collectDefensePropulsionNegativeControlReadonlySync({
      seed: target.seed || {},
      trackId: target.trackId || 'issuer_bridge_track',
      generatedAt,
      maxSources: Number(options.maxQueries || 6),
      sourceAllowlist: options.defensePropulsionSourceAllowlist,
    }) : null;
  const generatedRows = queryFamilies.map((family, index) => negativeRawRow({
    target,
    family,
    generatedAt,
    index,
  }));
  const rawEvidence = (injectedRows.length ? injectedRows : (collectedNegative?.rawEvidence?.length ? collectedNegative.rawEvidence : generatedRows))
    .slice(0, Number(options.maxQueries || 6))
    .map((row, index) => ({
      ...negativeRawRow({
        target,
        family: row.query || row.negativeControlFamily || queryFamilies[index] || `query ${index + 1}`,
        generatedAt,
        index,
      }),
      ...row,
      evidenceClass: 'negative_control',
      negativeControlIntent: true,
      promotionEligible: false,
      repairLoopGenerated: !injectedRows.length,
    }));
  const acceptedEvidence = acceptedNegativeRowsFromRaw(rawEvidence);
  const scope = collectedNegative?.scope || summarizeGridIssuerNegativeScope(rawEvidence);
  const status = collectedNegative?.scope
    ? {
      status: scope.negativeControlStatus,
      scope: scope.negativeControlScope,
      finalBlocker: scope.negativeControlStatus === 'CHECKED_NO_DIRECT'
        ? 'holdout_or_market_validation_required'
        : scope.negativeControlStatus === 'CHECKED_NO_DIRECT_LIMITED_SCOPE'
          ? 'negative_control_limited_scope'
          : scope.negativeControlStatus === 'WEAKENED'
            ? 'negative_control_weakened'
            : scope.negativeControlStatus === 'REJECTED'
              ? 'negative_control_rejected'
              : 'negative_control_not_closed',
    }
    : statusFromNegativeRows(rawEvidence, acceptedEvidence);
  const existingReadiness = inputState.readinessBefore || readinessFromArtifact(inputState.acquisition || {});
  const negativeClosed = ['SURVIVED', 'CHECKED_NO_DIRECT'].includes(status.status);
  const gateImpact = {
    negativeControlClosed: negativeClosed,
    downgradeCandidate: ['WEAKENED', 'REJECTED'].includes(status.status),
    reportCandidateAllowed: false,
    readinessChanged: false,
    visualStatus: ['review-ready', 'decision-ready'].includes(existingReadiness.visualStatus) ? 'pending' : existingReadiness.visualStatus,
    gateResult: ['WEAKENED', 'REJECTED'].includes(status.status) ? 'blocked_negative_control' : 'blocked',
    finalBlocker: negativeClosed ? 'holdout_missing' : status.finalBlocker,
    blockers: negativeClosed ? ['holdout_missing', 'market_validation_missing'] : ['negative_control_not_closed'],
  };
  return {
    ok: true,
    executed: true,
    action: 'run_limited_negative_control',
    actionId: `repair-loop-negative-control-${Date.parse(generatedAt) || Date.now()}`,
    seedId: compact(target.seed?.seedId || target.seed?.childSeedId || inputState.acquisition?.seedId || null),
    trackId: target.trackId,
    track: target.track,
    evidenceClass: 'negative_control',
    queryFamilies,
    collectorVersion: collectedNegative?.version || (gridLikeTarget ? 'negative-control-injected-raw' : 'generic-negative-control-bounded-raw'),
    sourceGroupsUsed: collectedNegative?.sourceGroupsUsed || uniqueStrings(rawEvidence.map((row) => row.sourceGroup || row.source_group), 20),
    sourceFamiliesUsed: collectedNegative?.sourceFamiliesUsed || uniqueStrings(rawEvidence.map((row) => row.sourceFamily || row.source || row.provider), 20),
    issuerCandidates: collectedNegative?.issuerCandidates || uniqueStrings([rawEvidence.map((row) => row.issuer), seedIssuerCandidates(target)], 20),
    rawEvidence,
    acceptedEvidence,
    rawEvidenceIds: rawEvidence.map((row) => row.evidenceId).filter(Boolean),
    acceptedEvidenceIds: acceptedEvidence.map((row) => row.evidenceId).filter(Boolean),
    negativeControlStatus: status.status,
    negativeControlScope: status.scope,
    checkedIssuerCount: scope.checkedIssuerCount || 0,
    checkedSourceGroupCount: scope.checkedSourceGroupCount || 0,
    checkedQueryFamilyCount: scope.checkedQueryFamilyCount || 0,
    directInvalidatorCount: scope.directInvalidatorCount || 0,
    weakRiskSignalCount: scope.weakRiskSignalCount || 0,
    noResultCount: scope.noResultCount || 0,
    sourceUnavailableCount: scope.sourceUnavailableCount || 0,
    directInvalidatorFound: Boolean(scope.directInvalidatorFound),
    checkedSourceGroups: scope.checkedSourceGroups || [],
    checkedIssuers: scope.checkedIssuers || [],
    matchedInvalidatorTerms: scope.matchedInvalidatorTerms || [],
    matchedRiskTerms: scope.matchedRiskTerms || [],
    failureClassification: summarizeFailureClassification(rawEvidence),
    gateImpact,
    boundaries: {
      ...zeroBoundaries(),
    },
  };
}

const TRACK_A_GRID_TERMS = [
  ...GRID_OFFICIAL_BOTTLENECK_TERMS,
  'interconnection queue',
  'interconnection study',
  'study delay',
  'study backlog',
  'queue duration',
  'processing capacity',
  'withdrawal rate',
  'network upgrade delay',
  'interconnection reform',
  'queue congestion',
  'study timeline',
  'study timelines',
];

const TRACK_A_OPERATING_TERMS = [
  ...GRID_OFFICIAL_OPERATING_TERMS,
  'timing bottleneck',
  'capacity constraint',
  'cost increase',
  'processing delay',
  'project delay',
  'queue congestion',
  'backlog growth',
  'delayed grid connection',
  'longer study timeline',
  'longer study timelines',
  'processing capacity bottleneck',
  'processing capacity bottlenecks',
  'queue duration',
  'withdrawal rate',
  'network upgrade delay',
];

const TRACK_A_ALLOWED_SOURCE_GROUPS = GRID_OFFICIAL_ALLOWED_SOURCE_GROUPS;

const TRACK_A_OFFICIAL_ROUTE_TEMPLATES = [
  {
    sourceGroup: 'official_research_dataset',
    source: 'lbnl_interconnection_queue',
    provider: 'LBNL',
    query: 'LBNL interconnection queue dataset study backlog queue duration withdrawal rate',
    title: 'LBNL interconnection queue dataset route',
  },
  {
    sourceGroup: 'official_government',
    source: 'ferc_interconnection_reform',
    provider: 'FERC',
    query: 'FERC interconnection reform processing capacity study delay queue backlog',
    title: 'FERC interconnection reform route',
  },
  {
    sourceGroup: 'official_grid_operator',
    source: 'iso_rto_interconnection_queue_reports',
    provider: 'ISO/RTO',
    query: 'PJM MISO CAISO ERCOT SPP interconnection queue reports study delay network upgrade delay',
    title: 'ISO/RTO interconnection queue report route',
  },
  {
    sourceGroup: 'utility_planning',
    source: 'utility_transmission_planning',
    provider: 'utility_planning',
    query: 'utility transmission planning interconnection study queue congestion project delay',
    title: 'Utility transmission planning route',
  },
];

const TRACK_B_GRID_ISSUER_TERMS = GRID_ISSUER_BRIDGE_EXPOSURE_TERMS;

const TRACK_B_OPERATING_TERMS = GRID_ISSUER_BRIDGE_OPERATING_TERMS;

const TRACK_B_ALLOWED_SOURCE_GROUPS = GRID_ISSUER_BRIDGE_ALLOWED_SOURCE_GROUPS;

const GRID_REPAIR_TARGET_RE = /\b(grid|interconnection|substation|transmission|utility|power delivery|electric infrastructure|grid modernization|rto|iso queue|ferc|pjm|miso|caiso|ercot|spp)\b/i;

const GENERIC_ISSUER_BRIDGE_ALLOWED_SOURCE_GROUPS = Object.freeze([
  'official_filing',
  'sec_filing',
  'sec',
  'official_company_ir',
  'issuer_ir',
  'issuer_transcript',
  'earnings_transcript',
  'company_release',
  'official_company_release',
  'official_contract',
  'official_government',
  'government_contract',
  'specialist_trade_media',
]);

const GENERIC_OPERATING_BRIDGE_TERMS = Object.freeze([
  'segment revenue',
  'revenue',
  'revenue growth',
  'backlog',
  'guidance',
  'capex',
  'capital expenditure',
  'capacity',
  'capacity expansion',
  'allocation',
  'lead time',
  'customer demand',
  'order',
  'orders',
  'bookings',
  'project execution',
  'production line',
  'utilization',
]);

function targetSearchText(target = {}) {
  const seed = target.seed || {};
  return compact([
    target.trackId,
    target.track,
    seed.seedId,
    seed.childSeedId,
    seed.bottleneckNode,
    seed.bottleneck?.label,
    seed.mechanism,
    seed.childClass,
    seed.bottleneckClass,
    seed.subjectLabel,
    seed.theme?.key,
    seed.theme?.label,
    seed.requiredEvidenceClasses,
    seed.evidenceClasses,
    seed.expectedEvidenceClasses,
    seed.acceptanceCriteria?.requiredTerms,
    seed.acceptanceCriteria?.bridgeTerms,
    seed.evidenceQueries,
    seed.negativeControlQueries,
  ].flat(Infinity).join(' '));
}

function isGridLikeRepairTarget(target = {}) {
  return GRID_REPAIR_TARGET_RE.test(targetSearchText(target));
}

function seedIssuerCandidates(target = {}, limit = 12) {
  const seed = target.seed || {};
  return uniqueStrings([
    seed.routeIssuerCandidates,
    seed.issuerCandidates,
    seed.issuerUniverse,
    seed.supplierCategory?.publicIssuerCandidates,
    asArray(seed.issuerRoleCandidates).map((row) => row.symbol || row.issuer || row.ticker),
  ], limit);
}

function issuerRoleClassForTargetIssuer(target = {}, issuer = '') {
  const seed = target.seed || {};
  const normalized = compact(issuer).toUpperCase();
  const role = asArray(seed.issuerRoleCandidates).find((row) => (
    compact(row.symbol || row.issuer || row.ticker).toUpperCase() === normalized
  ));
  return compact(role?.roleClass || role?.issuerRoleClass || seed.issuerRoleClass || seed.childClass || seed.bottleneckClass || 'issuer_bridge_candidate');
}

function genericRequiredTermsForTarget(target = {}) {
  const seed = target.seed || {};
  return uniqueStrings([
    seed.acceptanceCriteria?.requiredTerms,
    seed.bottleneckNode,
    seed.bottleneck?.label,
    seed.requiredInputs,
  ], 30).filter((term) => compact(term).length >= 3);
}

function genericOperatingTermsForTarget(target = {}) {
  const seed = target.seed || {};
  return uniqueStrings([
    seed.acceptanceCriteria?.bridgeTerms,
    GENERIC_OPERATING_BRIDGE_TERMS,
  ], 30).filter((term) => compact(term).length >= 3);
}

function findGenericTermProximity(text = '', {
  exposureTerms = [],
  operatingTerms = [],
  windowChars = 1000,
} = {}) {
  const body = compact(text);
  const lower = body.toLowerCase();
  const matchedExposureTerms = termsMatched(lower, exposureTerms);
  const matchedOperatingTerms = termsMatched(lower, operatingTerms);
  if (!matchedExposureTerms.length || !matchedOperatingTerms.length) {
    return {
      matched: false,
      matchedExposureTerms,
      matchedOperatingTerms,
      proximityWindow: windowChars,
      proximityScore: 0,
      matchedSnippet: body.slice(0, Math.min(760, body.length)),
    };
  }
  for (const exposureTerm of matchedExposureTerms) {
    const exposureIndex = lower.indexOf(String(exposureTerm).toLowerCase());
    for (const operatingTerm of matchedOperatingTerms) {
      const operatingIndex = lower.indexOf(String(operatingTerm).toLowerCase());
      if (exposureIndex >= 0 && operatingIndex >= 0 && Math.abs(exposureIndex - operatingIndex) <= windowChars) {
        const start = Math.max(0, Math.min(exposureIndex, operatingIndex) - 360);
        return {
          matched: true,
          matchedExposureTerms,
          matchedOperatingTerms,
          proximityWindow: windowChars,
          proximityScore: 1 - Math.min(1, Math.abs(exposureIndex - operatingIndex) / windowChars),
          matchedSnippet: body.slice(start, start + Math.min(1000, windowChars + 240)),
        };
      }
    }
  }
  return {
    matched: false,
    matchedExposureTerms,
    matchedOperatingTerms,
    proximityWindow: windowChars,
    proximityScore: 0,
    matchedSnippet: body.slice(0, Math.min(760, body.length)),
  };
}

function genericIssuerBridgeAcceptanceDetail(row = {}, target = {}, {
  windowChars = 1000,
} = {}) {
  const body = compact([
    row.extractedTextSnippet,
    row.matchedSnippet,
    row.text,
    row.textExcerpt,
    row.bodyText,
    row.pageText,
    row.summary,
  ].join(' '));
  const sourceGroup = compact(row.sourceGroup || row.source_group).toLowerCase();
  const proximity = findGenericTermProximity(body, {
    exposureTerms: genericRequiredTermsForTarget(target),
    operatingTerms: genericOperatingTermsForTarget(target),
    windowChars,
  });
  const rejectionReasons = [];
  if (!officialSourceGroup(row) || !GENERIC_ISSUER_BRIDGE_ALLOWED_SOURCE_GROUPS.includes(sourceGroup)) {
    rejectionReasons.push('source_group_not_allowed_for_generic_issuer_bridge');
  }
  if (!body) rejectionReasons.push('body_snippet_missing');
  if (row.tickerOnly) rejectionReasons.push('ticker_only');
  if (row.rawMetadataOnly) rejectionReasons.push('raw_metadata_only');
  if (/not_evaluated/i.test(String(row.acceptanceVerdict || ''))) rejectionReasons.push('not_evaluated_raw_evidence');
  if (!proximity.matchedExposureTerms.length) rejectionReasons.push('bottleneck_term_missing_in_body');
  if (!proximity.matchedOperatingTerms.length) rejectionReasons.push('operating_bridge_missing_in_body');
  if (proximity.matchedExposureTerms.length && proximity.matchedOperatingTerms.length && !proximity.matched) {
    rejectionReasons.push('bottleneck_operating_terms_not_proximate');
  }
  return {
    accepted: rejectionReasons.length === 0,
    rejectionReasons,
    matchedExposureTerms: proximity.matchedExposureTerms,
    matchedOperatingTerms: proximity.matchedOperatingTerms,
    matchedSnippet: proximity.matchedSnippet || body.slice(0, Math.min(700, body.length)),
    proximityWindow: proximity.proximityWindow,
    proximityScore: proximity.proximityScore,
  };
}

function genericIssuerBridgeRawRowsFromTarget(target = {}, generatedAt = '', maxRows = 6) {
  const seed = target.seed || {};
  const issuers = seedIssuerCandidates(target, maxRows);
  const requiredTerms = genericRequiredTermsForTarget(target);
  const bridgeTerms = genericOperatingTermsForTarget(target);
  const bottleneck = compact(seed.bottleneckNode || seed.bottleneck?.label || requiredTerms[0] || 'selected bottleneck');
  const bridge = compact(bridgeTerms[0] || 'operating bridge');
  return (issuers.length ? issuers : ['selected_issuer']).slice(0, maxRows).map((issuer, index) => ({
    evidenceId: repairEvidenceId('issuer-bridge', target, { source: `generic-official-route-${issuer}` }, index),
    seedId: seed.seedId || seed.childSeedId || target.trackId || 'selected-seed',
    trackId: target.trackId || null,
    evidenceClass: 'issuer_exposure',
    issuer,
    issuerRoleClass: issuerRoleClassForTargetIssuer(target, issuer),
    roleClass: issuerRoleClassForTargetIssuer(target, issuer),
    source: 'official_issuer_route_placeholder',
    provider: 'repair-loop-generic-official-route',
    sourceGroup: 'official_filing',
    query: `${issuer} ${bottleneck} ${bridge} official filing transcript`,
    title: `Bounded issuer bridge route: ${issuer} ${bottleneck}`,
    documentTitle: `Official issuer route required for ${issuer}`,
    summary: `Generic official issuer route prepared for ${issuer} and ${bottleneck}; no accepted document snippet has been extracted yet.`,
    extractedTextSnippet: '',
    matchedExposureTerms: [],
    matchedOperatingTerms: [],
    acceptanceVerdict: 'not_evaluated_issuer_bridge_raw',
    rejectionReason: 'not_evaluated_raw_evidence',
    accepted: false,
    promotionEligible: false,
    evidenceUse: 'weak_noise',
    generatedAt,
    collectedAt: generatedAt,
  }));
}

function genericHoldoutAcceptanceDetail(row = {}, target = {}, opts = {}) {
  return genericIssuerBridgeAcceptanceDetail(row, target, opts);
}

function genericHoldoutRawRowsFromTarget(target = {}, generatedAt = '', maxRows = 6) {
  const seed = target.seed || {};
  const routes = uniqueStrings([seed.holdoutRoutes, ['official_industry_or_government', 'specialist_trade_media']], maxRows);
  const bottleneck = compact(seed.bottleneckNode || seed.bottleneck?.label || genericRequiredTermsForTarget(target)[0] || 'selected bottleneck');
  return routes.slice(0, maxRows).map((route, index) => ({
    evidenceId: repairEvidenceId('holdout-validation', target, { source: route }, index),
    seedId: seed.seedId || seed.childSeedId || target.trackId || 'selected-seed',
    trackId: target.trackId || null,
    evidenceClass: 'holdout_validation',
    source: route,
    provider: 'repair-loop-generic-holdout-route',
    sourceGroup: route === 'specialist_trade_media' ? 'specialist_trade_media' : 'official_government',
    query: `${bottleneck} independent holdout validation ${route}`,
    title: `Bounded holdout route: ${bottleneck}`,
    documentTitle: `Independent holdout route required for ${bottleneck}`,
    summary: `Generic holdout route prepared for ${bottleneck}; no accepted independent document snippet has been extracted yet.`,
    extractedTextSnippet: '',
    acceptanceVerdict: 'not_evaluated_holdout_validation_raw',
    accepted: false,
    promotionEligible: false,
    evidenceUse: 'weak_noise',
    generatedAt,
    collectedAt: generatedAt,
  }));
}

function generatedRawRows(target = {}, evidenceClass = '', queries = [], generatedAt = '') {
  return uniqueStrings(queries, 12).map((query, index) => ({
    evidenceId: repairEvidenceId(evidenceClass, target, { query }, index),
    seedId: target.seed?.seedId || target.seed?.childSeedId || target.trackId || 'selected-seed',
    trackId: target.trackId || null,
    evidenceClass,
    source: 'autonomous-research-repair-loop',
    sourceGroup: 'bounded_repair_loop',
    query,
    title: `Bounded ${evidenceClass} check: ${query}`,
    summary: `Bounded ${evidenceClass} query prepared/executed for ${query}, but no accepted evidence was found.`,
    acceptanceVerdict: `not_evaluated_${evidenceClass}_raw`,
    accepted: false,
    promotionEligible: false,
    evidenceUse: 'weak_noise',
    generatedAt,
    collectedAt: generatedAt,
  }));
}

function gridMechanismBodyText(row = {}) {
  return compact([
    row.extractedTextSnippet,
    row.matchedSnippet,
    row.text,
    row.textExcerpt,
    row.pageText,
    row.bodyText,
    asArray(row.datasetFieldsUsed).join(' '),
    row.datasetMetricSummary,
    row.bottleneckInterpretation,
    row.metricDefinition,
  ].join(' ')).toLowerCase();
}

function termsMatched(text = '', terms = []) {
  return uniqueStrings(terms.filter((term) => String(text || '').toLowerCase().includes(String(term).toLowerCase())), 40);
}

function genericElectricityDemandOnly(row = {}, bodyText = '') {
  const text = compact([
    row.title,
    row.summary,
    bodyText,
  ].join(' ')).toLowerCase();
  return /electricity demand is rising|data centers need more power|ai uses more electricity|power demand is rising/i.test(text)
    && !containsAny(bodyText, ['study delay', 'study backlog', 'queue duration', 'processing delay', 'network upgrade delay', 'withdrawal rate', 'interconnection reform']);
}

function gridMechanismAcceptanceDetail(row = {}) {
  const bodyText = gridMechanismBodyText(row);
  const proximity = findGridMechanismProximity(bodyText, {
    bottleneckTerms: TRACK_A_GRID_TERMS,
    operatingTerms: TRACK_A_OPERATING_TERMS,
    windowChars: Number(row.proximityWindow || 1000),
  });
  const matchedBottleneckTerms = proximity.matchedBottleneckTerms;
  const matchedOperatingTerms = proximity.matchedOperatingTerms;
  const rejectionReasons = [];
  if (!officialSourceGroup(row) || !TRACK_A_ALLOWED_SOURCE_GROUPS.some((group) => String(row.sourceGroup || row.source_group || '').toLowerCase() === group)) {
    rejectionReasons.push('source_group_not_official_grid_source');
  }
  if (!bodyText) rejectionReasons.push('body_snippet_missing');
  if (row.rawMetadataOnly) rejectionReasons.push('raw_metadata_only');
  if (/not_evaluated/i.test(String(row.acceptanceVerdict || ''))) rejectionReasons.push('not_evaluated_raw_evidence');
  if (!matchedBottleneckTerms.length) rejectionReasons.push('bottleneck_term_missing_in_body');
  if (!matchedOperatingTerms.length) rejectionReasons.push('operating_bridge_missing_in_body');
  if (matchedBottleneckTerms.length && matchedOperatingTerms.length && !proximity.matched) rejectionReasons.push('bottleneck_operating_terms_not_proximate');
  if (genericElectricityDemandOnly(row, bodyText)) rejectionReasons.push('generic_electricity_demand_only');
  return {
    accepted: rejectionReasons.length === 0,
    rejectionReasons,
    matchedBottleneckTerms,
    matchedOperatingTerms,
    proximityWindow: proximity.proximityWindow,
    proximityScore: proximity.proximityScore,
    matchedSnippet: proximity.matchedSnippet || row.matchedSnippet || row.extractedTextSnippet || row.textExcerpt || bodyText.slice(0, 700),
  };
}

function acceptedGridMechanismRowsFromRaw(rows = []) {
  return asArray(rows).map((row) => ({
    row,
    detail: gridMechanismAcceptanceDetail(row),
  })).filter(({ detail }) => detail.accepted).map(({ row, detail }) => normalizeAcceptedEvidence(row, {
    evidenceClass: 'mechanism_validation',
    evidenceUse: 'supporting_context',
    promotionEligible: false,
    coveredEvidenceClasses: ['mechanism_validation'],
    matchedBottleneckTerms: detail.matchedBottleneckTerms,
    matchedOperatingTerms: detail.matchedOperatingTerms,
    acceptanceReason: 'official_grid_source_with_interconnection_bottleneck_and_operating_bridge',
    proximityWindow: detail.proximityWindow,
    proximityScore: detail.proximityScore,
  }));
}

function gridMechanismRawRowsFromOfficialRoutes(target = {}, generatedAt = '', maxRows = 6) {
  return TRACK_A_OFFICIAL_ROUTE_TEMPLATES.slice(0, maxRows).map((route, index) => ({
    evidenceId: repairEvidenceId('mechanism-validation', target, route, index),
    seedId: target.seed?.seedId || target.seed?.childSeedId || target.trackId || 'selected-seed',
    trackId: target.trackId || null,
    evidenceClass: 'mechanism_validation',
    source: route.source,
    provider: route.provider,
    sourceGroup: route.sourceGroup,
    query: route.query,
    title: route.title,
    documentTitle: route.title,
    sourceUrl: null,
    summary: `Official grid-source route prepared for ${route.query}; no accepted document snippet has been extracted yet.`,
    extractedTextSnippet: '',
    matchedBottleneckTerms: [],
    matchedOperatingTerms: [],
    acceptanceVerdict: 'not_evaluated_mechanism_validation_raw',
    rejectionReason: 'not_evaluated_raw_evidence',
    accepted: false,
    promotionEligible: false,
    evidenceUse: 'weak_noise',
    generatedAt,
    collectedAt: generatedAt,
  }));
}

function issuerBridgeAcceptanceDetailForTarget(row = {}, target = {}) {
  return isGridLikeRepairTarget(target)
    ? gridIssuerBridgeAcceptanceDetail(row, {
      windowChars: Number(row.proximityWindow || 1000),
    })
    : genericIssuerBridgeAcceptanceDetail(row, target, {
      windowChars: Number(row.proximityWindow || 1000),
    });
}

function acceptedIssuerBridgeRowsFromRaw(rows = [], target = {}) {
  return asArray(rows).map((row) => ({
    row,
    detail: issuerBridgeAcceptanceDetailForTarget(row, target),
  })).filter(({ detail }) => detail.accepted).map(({ row, detail }) => normalizeAcceptedEvidence(row, {
    evidenceClass: 'issuer_exposure',
    evidenceUse: 'promotion_candidate',
    promotionEligible: true,
    coveredEvidenceClasses: ['issuer_exposure'],
    matchedBottleneckTerms: detail.matchedExposureTerms,
    matchedOperatingTerms: detail.matchedOperatingTerms,
    acceptanceReason: isGridLikeRepairTarget(target)
      ? 'official_issuer_source_with_grid_exposure_and_operating_bridge'
      : 'official_issuer_source_with_seed_bottleneck_and_operating_bridge',
    proximityWindow: detail.proximityWindow,
    proximityScore: detail.proximityScore,
  }));
}

function acceptedHoldoutRowsFromRaw(rows = [], target = {}) {
  return asArray(rows).map((row) => ({
    row,
    detail: isGridLikeRepairTarget(target)
      ? gridIssuerHoldoutAcceptanceDetail(row, {
        windowChars: Number(row.proximityWindow || 1000),
      })
      : genericHoldoutAcceptanceDetail(row, target, {
        windowChars: Number(row.proximityWindow || 1000),
      }),
  })).filter(({ detail }) => detail.accepted).map(({ row, detail }) => normalizeAcceptedEvidence(row, {
    evidenceClass: 'holdout_validation',
    evidenceUse: 'supporting_context',
    promotionEligible: false,
    coveredEvidenceClasses: ['holdout_validation'],
    matchedBottleneckTerms: detail.matchedExposureTerms,
    matchedOperatingTerms: detail.matchedDemandTerms || detail.matchedOperatingTerms,
    acceptanceReason: isGridLikeRepairTarget(target)
      ? 'independent_official_holdout_source_with_grid_project_and_demand_bridge'
      : 'independent_official_holdout_source_with_seed_bottleneck_and_operating_bridge',
    proximityWindow: detail.proximityWindow,
    proximityScore: detail.proximityScore,
  }));
}

function acceptedMarketValidationRowsFromRaw(rows = []) {
  return asArray(rows).filter((row) => (
    /local_controlled_market|controlled_market/i.test(String(row.sourceGroup || row.provider || ''))
    && /controlled_ready|market_validation_caveated/i.test(String(row.marketValidationStatus || row.status || row.summary || ''))
    && !/source-query|rss/i.test(String(row.sourceGroup || row.provider || row.source || ''))
    && !/rejected|not_accepted|not_evaluated|raw_only/i.test(String(row.acceptanceVerdict || row.evidenceUse || row.acceptedUse || ''))
  )).map((row) => normalizeAcceptedEvidence(row, {
    evidenceClass: 'market_validation',
    evidenceUse: 'supporting_context',
    promotionEligible: false,
    coveredEvidenceClasses: ['market_validation'],
  }));
}

export function runLimitedGridMechanismValidationExecutor(inputState = {}, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const target = selectedRepairTarget(inputState, 'mechanism_validation_track');
  const injectedRows = asArray(options.gridMechanismRawEvidence);
  const collectedOfficial = injectedRows.length
    ? null
    : collectGridOfficialReadonly({
      seedId: target.seed?.seedId || target.seed?.childSeedId || target.trackId || 'selected-seed',
      trackId: target.trackId || 'mechanism_validation_track',
      generatedAt,
      maxSources: Number(options.maxQueries || 6),
      sourceAllowlist: options.gridOfficialSourceAllowlist,
    });
  const rawSourceRows = injectedRows.length
    ? injectedRows
    : (collectedOfficial?.rawEvidence?.length ? collectedOfficial.rawEvidence : gridMechanismRawRowsFromOfficialRoutes(target, generatedAt, Number(options.maxQueries || 6)));
  const rawEvidence = rawSourceRows.slice(0, Number(options.maxQueries || 6)).map((row, index) => {
    const detail = gridMechanismAcceptanceDetail(row);
    return ({
    ...row,
    evidenceId: row.evidenceId || repairEvidenceId('mechanism-validation', target, row, index),
    evidenceClass: 'mechanism_validation',
    trackId: target.trackId || row.trackId || null,
    repairLoopGenerated: !injectedRows.length,
    matchedBottleneckTerms: detail.matchedBottleneckTerms,
    matchedOperatingTerms: detail.matchedOperatingTerms,
    matchedSnippet: detail.matchedSnippet || row.matchedSnippet || '',
    proximityWindow: detail.proximityWindow || row.proximityWindow || null,
    proximityScore: detail.proximityScore ?? row.proximityScore ?? null,
    rejectionReason: detail.accepted ? null : detail.rejectionReasons.join(','),
    acceptanceReason: detail.accepted ? 'official_grid_source_with_interconnection_bottleneck_and_operating_bridge' : null,
  });
  });
  const acceptedEvidence = acceptedGridMechanismRowsFromRaw(rawEvidence);
  const sourceGroupsUsed = uniqueStrings(rawEvidence.map((row) => row.sourceGroup || row.source_group), 10);
  const sourceFamiliesUsed = uniqueStrings(rawEvidence.map((row) => row.sourceFamily || row.source || row.provider), 10);
  const gateImpact = {
    reportCandidateAllowed: false,
    readinessChanged: false,
    visualStatus: 'pending',
    gateResult: 'blocked',
    finalBlocker: acceptedEvidence.length ? 'issuer_bridge_required_after_mechanism_validation' : 'track_a_mechanism_validation_missing',
    mechanismEvidenceAccepted: acceptedEvidence.length > 0,
  };
  return {
    ok: true,
    executed: true,
    action: 'run_limited_grid_mechanism_validation',
    actionId: `repair-loop-grid-mechanism-${Date.parse(generatedAt) || Date.now()}`,
    seedId: compact(target.seed?.seedId || target.seed?.childSeedId || target.trackId || null),
    trackId: target.trackId,
    track: 'mechanism_validation_track',
    evidenceClass: 'mechanism_validation',
    sourceRoutes: TRACK_A_OFFICIAL_ROUTE_TEMPLATES.map((route) => route.provider),
    allowedSourceGroups: TRACK_A_ALLOWED_SOURCE_GROUPS,
    sourceGroupsUsed,
    sourceFamiliesUsed,
    collectorVersion: collectedOfficial?.version || 'grid-mechanism-injected-raw',
    fixtureRequired: Boolean(collectedOfficial?.fixtureRequired),
    failureClassification: collectedOfficial?.failureClassifications || summarizeFailureClassification(rawEvidence),
    mechanismValidationStatus: acceptedEvidence.length ? 'accepted_mechanism_evidence' : 'raw_only',
    rawEvidence,
    acceptedEvidence,
    rawEvidenceIds: rawEvidence.map((row) => row.evidenceId).filter(Boolean),
    acceptedEvidenceIds: acceptedEvidence.map((row) => row.evidenceId).filter(Boolean),
    gateImpact,
    boundaries: zeroBoundaries(),
  };
}

export function runLimitedIssuerBridgeTrackExecutor(inputState = {}, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const target = selectedRepairTarget(inputState, 'issuer_bridge_track');
  const gridLikeTarget = isGridLikeRepairTarget(target);
  const defensePropulsionTarget = !gridLikeTarget && isDefensePropulsionTarget(target);
  const injectedRows = asArray(options.issuerBridgeRawEvidence);
  const collectedIssuerBridge = injectedRows.length
    ? null
    : gridLikeTarget ? collectGridIssuerBridgeReadonly({
      seedId: target.seed?.seedId || target.seed?.childSeedId || target.trackId || 'selected-seed',
      trackId: target.trackId || 'issuer_bridge_track',
      generatedAt,
      maxSources: Number(options.maxQueries || 6),
      sourceAllowlist: options.gridIssuerBridgeSourceAllowlist,
    }) : defensePropulsionTarget ? collectDefensePropulsionIssuerBridgeReadonlySync({
      seed: target.seed || {},
      trackId: target.trackId || 'issuer_bridge_track',
      generatedAt,
      maxSources: Number(options.maxQueries || 6),
      sourceAllowlist: options.defensePropulsionSourceAllowlist,
    }) : null;
  const rawSourceRows = injectedRows.length
    ? injectedRows
    : (collectedIssuerBridge?.rawEvidence?.length ? collectedIssuerBridge.rawEvidence : gridLikeTarget ? generatedRawRows(target, 'issuer_exposure', [
      ...DEFAULT_GRID_ISSUER_BRIDGE_SOURCE_ALLOWLIST.map((row) => row.fixtureText || row.documentTitle || row.sourceId),
    ], generatedAt) : genericIssuerBridgeRawRowsFromTarget(target, generatedAt, Number(options.maxQueries || 6)));
  const rawEvidence = rawSourceRows.slice(0, Number(options.maxQueries || 6)).map((row, index) => {
    const detail = issuerBridgeAcceptanceDetailForTarget(row, target);
    return ({
      ...row,
      evidenceId: row.evidenceId || repairEvidenceId('issuer-bridge', target, row, index),
      evidenceClass: 'issuer_exposure',
      trackId: target.trackId || row.trackId || null,
      repairLoopGenerated: !injectedRows.length,
      matchedExposureTerms: detail.matchedExposureTerms,
      matchedOperatingTerms: detail.matchedOperatingTerms,
      matchedSnippet: detail.matchedSnippet || row.matchedSnippet || '',
      proximityWindow: detail.proximityWindow || row.proximityWindow || null,
      proximityScore: detail.proximityScore ?? row.proximityScore ?? null,
      rejectionReason: detail.accepted ? null : detail.rejectionReasons.join(','),
      acceptanceReason: detail.accepted
        ? (gridLikeTarget ? 'official_issuer_source_with_grid_exposure_and_operating_bridge' : 'official_issuer_source_with_seed_bottleneck_and_operating_bridge')
        : null,
      acceptanceVerdict: detail.accepted ? 'accepted' : (row.acceptanceVerdict || 'not_evaluated_issuer_bridge_raw'),
    });
  });
  const acceptedEvidence = acceptedIssuerBridgeRowsFromRaw(rawEvidence, target);
  const acceptedPromotionEvidenceCount = acceptedEvidence.filter((row) => row.promotionEligible === true || row.evidenceUse === 'promotion_candidate').length;
  const independentSourceBreadth = sourceBreadthFromEvidence(acceptedEvidence);
  const issuerBridgeStatus = acceptedEvidence.length
    ? independentSourceBreadth >= 2 ? 'closed' : 'partial'
    : 'missing';
  const gateImpact = evaluateRepairGate(inputState, {
    acceptedEvidence,
    issuerBridgeStatus,
  });
  if (!acceptedEvidence.length) {
    gateImpact.finalBlocker = 'issuer_bridge_missing';
    gateImpact.blockers = uniqueStrings(['issuer_bridge_missing', ...(gateImpact.blockers || [])], 20);
  }
  const sourceGroupsUsed = uniqueStrings(rawEvidence.map((row) => row.sourceGroup || row.source_group), 10);
  const sourceFamiliesUsed = uniqueStrings(rawEvidence.map((row) => row.sourceFamily || row.source || row.provider), 10);
  const issuerCandidates = uniqueStrings([rawEvidence.map((row) => row.issuer), seedIssuerCandidates(target)], 20);
  const issuerRoleClasses = uniqueStrings(rawEvidence.map((row) => row.issuerRoleClass || row.roleClass), 20);
  return {
    ok: true,
    executed: true,
    action: 'run_limited_issuer_bridge_track',
    actionId: `repair-loop-issuer-bridge-${Date.parse(generatedAt) || Date.now()}`,
    seedId: compact(target.seed?.seedId || target.seed?.childSeedId || target.trackId || null),
    trackId: target.trackId,
    track: 'issuer_bridge_track',
    evidenceClass: 'issuer_exposure',
    sourceRoutes: gridLikeTarget
      ? ['SEC', 'IR', 'earnings_transcript', 'company_release']
      : defensePropulsionTarget
        ? ['official_company_release', 'official_government_release', 'SEC']
        : ['SEC', 'company_ir', 'earnings_transcript', 'official_release'],
    allowedSourceGroups: gridLikeTarget ? TRACK_B_ALLOWED_SOURCE_GROUPS : GENERIC_ISSUER_BRIDGE_ALLOWED_SOURCE_GROUPS,
    sourceGroupsUsed,
    sourceFamiliesUsed,
    collectorVersion: collectedIssuerBridge?.version || (gridLikeTarget ? 'grid-issuer-bridge-injected-raw' : 'generic-issuer-bridge-bounded-raw'),
    fixtureRequired: Boolean(collectedIssuerBridge?.fixtureRequired),
    failureClassification: collectedIssuerBridge?.failureClassifications || summarizeFailureClassification(rawEvidence),
    issuerCandidates,
    issuerRoleClasses,
    rawEvidence,
    acceptedEvidence,
    rawEvidenceIds: rawEvidence.map((row) => row.evidenceId).filter(Boolean),
    acceptedEvidenceIds: acceptedEvidence.map((row) => row.evidenceId).filter(Boolean),
    acceptedIssuerEvidenceCount: acceptedEvidence.length,
    acceptedPromotionEvidenceCount,
    independentSourceBreadth,
    issuerBridgeStatus,
    matchedExposureTerms: uniqueStrings(acceptedEvidence.flatMap((row) => row.matchedBottleneckTerms || row.payload?.matchedExposureTerms || []), 20),
    matchedOperatingTerms: uniqueStrings(acceptedEvidence.flatMap((row) => row.matchedOperatingTerms || row.payload?.matchedOperatingTerms || []), 20),
    gateImpact,
    boundaries: zeroBoundaries(),
  };
}

export function runLimitedHoldoutValidationExecutor(inputState = {}, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const target = selectedRepairTarget(inputState, 'issuer_bridge_track');
  const gridLikeTarget = isGridLikeRepairTarget(target);
  const defensePropulsionTarget = !gridLikeTarget && isDefensePropulsionTarget(target);
  const injectedRows = asArray(options.holdoutRawEvidence);
  const collectedHoldout = injectedRows.length
    ? null
    : gridLikeTarget ? collectGridIssuerHoldoutReadonly({
      seedId: target.seed?.seedId || target.seed?.childSeedId || target.trackId || 'selected-seed',
      trackId: target.trackId || 'issuer_bridge_track',
      generatedAt,
      maxSources: Number(options.maxQueries || 6),
      sourceAllowlist: options.gridIssuerHoldoutSourceAllowlist,
      issuerBridgeSourceUrls: options.issuerBridgeSourceUrls,
      issuerBridgeDocumentIds: options.issuerBridgeDocumentIds,
    }) : defensePropulsionTarget ? collectDefensePropulsionHoldoutReadonlySync({
      seed: target.seed || {},
      trackId: target.trackId || 'issuer_bridge_track',
      generatedAt,
      maxSources: Number(options.maxQueries || 6),
      sourceAllowlist: options.defensePropulsionSourceAllowlist,
    }) : null;
  const rawEvidence = (injectedRows.length ? injectedRows : (collectedHoldout?.rawEvidence?.length ? collectedHoldout.rawEvidence : gridLikeTarget ? generatedRawRows(target, 'holdout_validation', [
    'utility customer announcement transmission backlog',
    'industry source power delivery project execution',
    'official grid planning source validates bottleneck',
  ], generatedAt) : genericHoldoutRawRowsFromTarget(target, generatedAt, Number(options.maxQueries || 6)))).slice(0, Number(options.maxQueries || 6)).map((row, index) => ({
    ...row,
    evidenceId: row.evidenceId || repairEvidenceId('holdout-validation', target, row, index),
    evidenceClass: 'holdout_validation',
    trackId: target.trackId || row.trackId || null,
    repairLoopGenerated: !injectedRows.length,
  }));
  const acceptedEvidence = acceptedHoldoutRowsFromRaw(rawEvidence, target);
  const holdoutStatus = collectedHoldout?.scope?.holdoutStatus
    || (rawEvidence.some((row) => row.holdoutStatus === 'CONTRADICTED' || row.contradictionFound === true)
      ? 'CONTRADICTED'
      : acceptedEvidence.length > 0
        ? 'CONFIRMED'
        : 'INCONCLUSIVE');
  const holdoutConfirmed = holdoutStatus === 'CONFIRMED' && acceptedEvidence.length > 0;
  const gateImpact = evaluateRepairGate(inputState, {
    acceptedEvidence,
    holdoutConfirmed,
  });
  if (holdoutConfirmed) {
    gateImpact.finalBlocker = 'market_validation_missing';
    gateImpact.blockers = uniqueStrings(['market_validation_missing', ...(gateImpact.blockers || []).filter((blocker) => blocker !== 'holdout_missing')], 20);
    gateImpact.reportCandidateAllowed = false;
    gateImpact.gateResult = 'blocked';
  } else if (holdoutStatus === 'CONTRADICTED') {
    gateImpact.finalBlocker = 'holdout_contradicted';
    gateImpact.blockers = uniqueStrings(['holdout_contradicted', ...(gateImpact.blockers || [])], 20);
    gateImpact.reportCandidateAllowed = false;
    gateImpact.gateResult = 'blocked_holdout_contradicted';
  }
  return {
    ok: true,
    executed: true,
    action: 'run_limited_holdout_validation',
    actionId: `repair-loop-holdout-${Date.parse(generatedAt) || Date.now()}`,
    seedId: compact(target.seed?.seedId || target.seed?.childSeedId || target.trackId || null),
    trackId: target.trackId,
    track: target.track || 'issuer_bridge_track',
    evidenceClass: 'holdout_validation',
    rawEvidence,
    acceptedEvidence,
    rawEvidenceIds: rawEvidence.map((row) => row.evidenceId).filter(Boolean),
    acceptedEvidenceIds: acceptedEvidence.map((row) => row.evidenceId).filter(Boolean),
    collectorVersion: collectedHoldout?.version || (gridLikeTarget ? 'grid-issuer-holdout-injected-raw' : 'generic-holdout-bounded-raw'),
    sourceGroupsUsed: collectedHoldout?.sourceGroupsUsed || uniqueStrings(rawEvidence.map((row) => row.sourceGroup || row.source_group), 20),
    sourceFamiliesUsed: collectedHoldout?.sourceFamiliesUsed || uniqueStrings(rawEvidence.map((row) => row.sourceFamily || row.source || row.provider), 20),
    matchedExposureTerms: collectedHoldout?.scope?.matchedExposureTerms || uniqueStrings(acceptedEvidence.flatMap((row) => row.matchedBottleneckTerms || row.payload?.matchedExposureTerms || []), 20),
    matchedDemandTerms: collectedHoldout?.scope?.matchedDemandTerms || uniqueStrings(acceptedEvidence.flatMap((row) => row.matchedOperatingTerms || row.payload?.matchedDemandTerms || []), 20),
    contradictionFound: Boolean(collectedHoldout?.scope?.contradictionFound || rawEvidence.some((row) => row.contradictionFound === true)),
    contradictionCount: Number(collectedHoldout?.scope?.contradictionCount || rawEvidence.filter((row) => row.contradictionFound === true || row.holdoutStatus === 'CONTRADICTED').length),
    contradictionTerms: collectedHoldout?.scope?.contradictionTerms || uniqueStrings(rawEvidence.flatMap((row) => row.contradictionTerms || []), 20),
    acceptedHoldoutEvidenceCount: acceptedEvidence.length,
    holdoutStatus,
    holdoutConfirmed,
    gateImpact,
    boundaries: zeroBoundaries(),
  };
}

export function runLimitedControlledMarketValidationExecutor(inputState = {}, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const target = selectedRepairTarget(inputState, 'issuer_bridge_track');
  const gridLikeTarget = isGridLikeRepairTarget(target);
  const defensePropulsionTarget = !gridLikeTarget && isDefensePropulsionTarget(target);
  const injectedRows = asArray(options.marketValidationRawEvidence);
  const artifact = inputState.acquisition || {};
  const artifactMarketAnchorRows = asArray(artifact.acceptedEvidenceRows).filter((row) => (
    row.evidenceUse === 'promotion_candidate'
    || row.promotionEligible === true
    || ['issuer_exposure', 'holdout_validation', 'mechanism_validation'].includes(String(row.evidenceClass || '').toLowerCase())
  ));
  const anchorEvidence = options.marketValidationAcceptedAnchorEvidence !== undefined
    ? options.marketValidationAcceptedAnchorEvidence
    : (options.useDefaultMarketAnchors === true && !artifactMarketAnchorRows.length ? null : artifactMarketAnchorRows);
  const requestedMarketIssuerUniverse = uniqueStrings([
    options.marketValidationIssuerUniverse,
    target.seed?.issuerCandidates,
    target.seed?.issuerUniverse,
    artifact.trackBIssuerCandidates,
  ], 10);
  const marketIssuerUniverse = requestedMarketIssuerUniverse.length
    ? requestedMarketIssuerUniverse
    : (options.useDefaultMarketAnchors === true ? GRID_ISSUER_MARKET_ISSUERS : []);
  const marketQuotes = options.marketQuotes || (defensePropulsionTarget
    ? buildDefaultDefensePropulsionMarketQuotes({
      symbols: uniqueStrings([marketIssuerUniverse, 'SPY', 'XLI', 'GRID', 'IEF'], 12),
    })
    : undefined);
  const collection = injectedRows.length
    ? null
    : collectGridIssuerMarketValidationReadonly({
      seedId: target.seed?.seedId || target.seed?.childSeedId || target.trackId || 'selected-seed',
      trackId: target.trackId || 'issuer_bridge_track',
      acceptedEvidence: anchorEvidence,
      issuerUniverse: marketIssuerUniverse,
      marketQuotes,
      generatedAt,
      useDefaultAcceptedEvidence: options.useDefaultMarketAnchors === true,
    });
  const rawEvidence = (injectedRows.length ? injectedRows : (collection?.rawEvidence?.length ? collection.rawEvidence : generatedRawRows(target, 'market_validation', [
    'local controlled event study for selected issuer universe',
  ], generatedAt))).slice(0, Number(options.maxQueries || 6)).map((row, index) => ({
    ...row,
    evidenceId: row.evidenceId || repairEvidenceId('market-validation', target, row, index),
    evidenceClass: 'market_validation',
    trackId: target.trackId || row.trackId || null,
    repairLoopGenerated: !injectedRows.length,
    promotionEligible: false,
  }));
  const acceptedEvidence = acceptedMarketValidationRowsFromRaw(rawEvidence);
  const marketValidationStatus = acceptedEvidence.length
    ? (rawEvidence.find((row) => acceptedEvidence.some((accepted) => accepted.evidenceId === row.evidenceId))?.marketValidationStatus || collection?.marketValidationStatus || 'market_validation_caveated')
    : (collection?.marketValidationStatus || 'insufficient_market_data');
  const diagnosticGateImpact = evaluateRepairGate(inputState, {
    acceptedEvidence,
    marketValidationStatus,
  });
  const nonMarketDiagnosticBlockers = asArray(diagnosticGateImpact.blockers)
    .filter((blocker) => blocker !== 'market_validation_missing');
  const marketCaveatAcceptedForDiagnostic = defensePropulsionTarget
    && marketValidationStatus === 'market_validation_caveated'
    && acceptedEvidence.length > 0
    && nonMarketDiagnosticBlockers.length === 0;
  const reportCandidateAllowedDiagnostic = (marketValidationStatus === 'controlled_ready'
    && diagnosticGateImpact.reportCandidateAllowed === true)
    || marketCaveatAcceptedForDiagnostic;
  const finalBlocker = reportCandidateAllowedDiagnostic
    ? 'evidence_contract_closure_dry_run_required'
    : marketValidationStatus === 'market_validation_caveated'
      ? 'market_validation_caveated'
      : marketValidationStatus === 'not_directionally_supported'
        ? 'market_validation_not_directionally_supported'
        : 'market_validation_missing';
  const gateImpact = {
    ...diagnosticGateImpact,
    reportCandidateAllowed: false,
    reportCandidateAllowedDiagnostic,
    readinessChanged: false,
    gateResult: 'blocked',
    visualStatus: 'pending',
    finalBlocker,
    blockers: reportCandidateAllowedDiagnostic
      ? uniqueStrings(['report_candidate_write_disabled', ...nonMarketDiagnosticBlockers], 20)
      : uniqueStrings([finalBlocker, ...(diagnosticGateImpact.blockers || [])], 20),
    evidenceContractClosureDryRun: reportCandidateAllowedDiagnostic,
    reportSubjectDryRun: reportCandidateAllowedDiagnostic,
    decisionUseCaveat: marketCaveatAcceptedForDiagnostic ? 'market_validation_caveated_for_report_candidate_dry_run_only' : null,
  };
  return {
    ok: true,
    executed: true,
    action: 'run_limited_controlled_market_validation',
    actionId: `repair-loop-market-validation-${Date.parse(generatedAt) || Date.now()}`,
    seedId: compact(target.seed?.seedId || target.seed?.childSeedId || target.trackId || null),
    trackId: target.trackId,
    track: target.track || 'issuer_bridge_track',
    evidenceClass: 'market_validation',
    collectorVersion: collection?.version || GRID_ISSUER_MARKET_VALIDATION_READONLY_VERSION,
    eventAnchors: collection?.eventAnchors || [],
    eventAnchorCount: Number(collection?.eventAnchors?.length || 0),
    marketValidationWindowResults: collection?.windowResults || rawEvidence.flatMap((row) => row.windowResults || []),
    marketValidationBenchmarkUsed: collection?.benchmarkUsed || rawEvidence[0]?.benchmarkUsed || null,
    marketValidationSectorBenchmarkUsed: collection?.sectorBenchmarkUsed || rawEvidence[0]?.sectorBenchmarkUsed || null,
    marketValidationControlUsed: Boolean(collection?.controlUsed ?? rawEvidence[0]?.controlUsed),
    marketValidationSampleSize: Number(collection?.sampleSize ?? rawEvidence[0]?.sampleSize ?? 0),
    marketValidationDirection: collection?.direction || rawEvidence[0]?.direction || null,
    marketValidationCaveats: collection?.caveats || rawEvidence[0]?.caveats || [],
    marketValidationWarnings: collection?.warnings || rawEvidence[0]?.warnings || [],
    missingBenchmark: collection?.missingBenchmark || rawEvidence[0]?.missingBenchmark || [],
    rawEvidence,
    acceptedEvidence,
    rawEvidenceIds: rawEvidence.map((row) => row.evidenceId).filter(Boolean),
    acceptedEvidenceIds: acceptedEvidence.map((row) => row.evidenceId).filter(Boolean),
    marketValidationStatus,
    reportCandidateAllowedDiagnostic,
    evidenceContractClosureDryRun: reportCandidateAllowedDiagnostic,
    reportSubjectDryRun: reportCandidateAllowedDiagnostic,
    gateImpact,
    boundaries: zeroBoundaries(),
  };
}

function splitTrackResult(artifact = {}, track = '') {
  return asArray(artifact.splitTrackResults).find((row) => row.track === track) || {};
}

function matrixRow({
  evidenceClass,
  required = true,
  acceptedCount = 0,
  promotionEligibleCount = 0,
  sourceGroups = [],
  independentSourceBreadth = 0,
  status = 'missing',
  blocking = false,
  evidenceIds = [],
  caveats = [],
  acceptedUse = 'supporting_context',
  nextActionIfMissing = null,
  ...rest
} = {}) {
  return {
    ...rest,
    evidenceClass,
    required,
    acceptedCount: Number(acceptedCount || 0),
    promotionEligibleCount: Number(promotionEligibleCount || 0),
    sourceGroups: uniqueStrings(sourceGroups, 20),
    independentSourceBreadth: Number(independentSourceBreadth || 0),
    status,
    blocking: Boolean(blocking),
    evidenceIds: uniqueStrings(evidenceIds, 40),
    caveats: uniqueStrings(caveats, 20),
    acceptedUse,
    nextActionIfMissing,
  };
}

function buildEvidenceContractClosureMatrix(artifact = {}) {
  const trackA = splitTrackResult(artifact, 'mechanism_validation_track');
  const trackB = splitTrackResult(artifact, 'issuer_bridge_track');
  const acceptedRows = asArray(artifact.acceptedEvidenceRows);
  const issuerExposureRows = acceptedRows.filter((row) => String(row.evidenceClass || '').toLowerCase() === 'issuer_exposure');
  const promotionIssuerRows = issuerExposureRows
    .filter((row) => row.promotionEligible === true || row.evidenceUse === 'promotion_candidate');
  const issuerEvidenceIds = uniqueStrings([
    trackB.acceptedEvidenceIds,
    issuerExposureRows.map((row) => row.evidenceId || row.id),
  ], 80);
  const issuerSourceGroups = uniqueStrings([
    artifact.trackBSourceGroupsUsed,
    trackB.sourceGroupsUsed,
    issuerExposureRows.map((row) => row.sourceGroup || row.source_group || row.provider || row.source),
  ], 20);
  const issuerMatchedExposureTerms = uniqueStrings([
    artifact.trackBMatchedExposureTerms,
    trackB.matchedExposureTerms,
    issuerExposureRows.map((row) => row.matchedExposureTerms || row.matchedBottleneckTerms || row.coveredEvidenceClasses),
  ], 40);
  const issuerMatchedOperatingTerms = uniqueStrings([
    artifact.trackBMatchedOperatingTerms,
    trackB.matchedOperatingTerms,
    issuerExposureRows.map((row) => row.matchedOperatingTerms || row.matchedDemandTerms || row.operatingBridgeTerms),
  ], 40);
  const acceptedMechanismDirect = Number(trackA.acceptedEvidenceIds?.length || trackA.acceptedEvidenceCount || 0);
  const acceptedIssuer = Math.max(
    Number(artifact.trackBAcceptedIssuerEvidenceCount || trackB.acceptedIssuerEvidenceCount || 0),
    issuerExposureRows.length,
  );
  const promotionIssuer = Math.max(
    Number(artifact.trackBAcceptedPromotionEvidenceCount || trackB.acceptedPromotionEvidenceCount || 0),
    promotionIssuerRows.length,
  );
  const negativeClosed = ['SURVIVED', 'CHECKED_NO_DIRECT'].includes(String(artifact.negativeControlStatus || artifact.trackBNegativeControlStatus || ''));
  const negativeCount = Number(artifact.trackBAcceptedNegativeControlEvidenceCount || 0);
  const holdoutConfirmed = Boolean(artifact.holdoutConfirmed || artifact.trackBHoldoutConfirmed);
  const holdoutCount = Number(artifact.trackBAcceptedHoldoutEvidenceCount || 0);
  const marketStatus = artifact.marketValidationStatus || 'missing';
  const marketAccepted = /controlled_ready|market_validation_caveated/i.test(String(marketStatus));
  const marketCaveats = uniqueStrings([artifact.marketValidationCaveats, artifact.marketValidationWarnings], 20);
  const sourceBreadth = Number(artifact.independentSourceBreadth || 0);
  const selectedText = JSON.stringify([
    artifact.selectedChildSeed,
    artifact.selectedSeed,
    artifact.splitTracks,
    artifact.dryRunReportSubject,
  ]).toLowerCase();
  const requiresGridInterconnection = /\b(grid|interconnection|substation|transmission|utility|power delivery)\b/.test(selectedText)
    || asArray(artifact.selectedChildSeed?.requiredEvidenceClasses).includes('grid_interconnection');
  const mechanismSupportedByIssuerBridge = !requiresGridInterconnection
    && acceptedMechanismDirect < 1
    && acceptedIssuer >= 1
    && uniqueStrings([issuerMatchedExposureTerms, issuerMatchedOperatingTerms], 20).length >= 2;
  const acceptedMechanism = mechanismSupportedByIssuerBridge ? 1 : acceptedMechanismDirect;
  const valuationBridge = artifact.valuationExpectationBridgeDryRun || artifact.valuationBridgeDryRun || null;
  const valuationRow = valuationBridge
    ? valuationMatrixRowFromBridge(valuationBridge)
    : matrixRow({
      evidenceClass: 'valuation_or_expectation_bridge',
      required: false,
      acceptedCount: 0,
      promotionEligibleCount: 0,
      sourceGroups: [],
      independentSourceBreadth: sourceBreadth,
      status: 'missing_investment_readiness_only',
      blocking: false,
      caveats: ['valuation_or_expectation_bridge_missing_investment_readiness_blocked'],
      acceptedUse: 'investment_readiness_only',
      nextActionIfMissing: 'build_valuation_or_expectation_bridge_before_investment_memo',
    });
  const rows = [
    matrixRow({
      evidenceClass: 'mechanism_validation',
      acceptedCount: acceptedMechanism,
      promotionEligibleCount: 0,
      sourceGroups: trackA.sourceGroupsUsed || artifact.trackASourceGroupsUsed || [],
      independentSourceBreadth: sourceBreadth,
      status: acceptedMechanism >= 1 ? 'accepted' : 'missing',
      blocking: acceptedMechanism < 1,
      evidenceIds: acceptedMechanismDirect >= 1 ? (trackA.acceptedEvidenceIds || []) : issuerEvidenceIds,
      caveats: mechanismSupportedByIssuerBridge ? ['mechanism_context_supported_by_issuer_bridge_refresh_independent_mechanism_source'] : [],
      acceptedUse: 'supporting_context',
      nextActionIfMissing: 'run_limited_official_route',
    }),
    matrixRow({
      evidenceClass: 'issuer_exposure',
      acceptedCount: acceptedIssuer,
      promotionEligibleCount: promotionIssuer,
      sourceGroups: issuerSourceGroups,
      independentSourceBreadth: sourceBreadth,
      status: promotionIssuer >= 1 ? 'promotion_collected' : acceptedIssuer >= 1 ? 'context_collected' : 'missing',
      blocking: promotionIssuer < 1,
      evidenceIds: issuerEvidenceIds,
      acceptedUse: 'promotion_candidate',
      nextActionIfMissing: 'run_limited_issuer_bridge_track',
    }),
    matrixRow({
      evidenceClass: 'issuer_commentary_or_official_issuer_bridge',
      acceptedCount: acceptedIssuer,
      promotionEligibleCount: promotionIssuer,
      sourceGroups: issuerSourceGroups,
      independentSourceBreadth: sourceBreadth,
      status: acceptedIssuer >= 1 ? 'accepted_official_issuer_bridge' : 'missing',
      blocking: acceptedIssuer < 1,
      evidenceIds: issuerEvidenceIds,
      acceptedUse: promotionIssuer >= 1 ? 'promotion_candidate' : 'supporting_context',
      nextActionIfMissing: 'run_limited_issuer_bridge_track',
    }),
    matrixRow({
      evidenceClass: 'negative_control',
      acceptedCount: negativeClosed ? Math.max(1, negativeCount) : negativeCount,
      promotionEligibleCount: 0,
      sourceGroups: artifact.trackBNegativeSourceGroupsUsed || [],
      independentSourceBreadth: sourceBreadth,
      status: negativeClosed ? 'checked_no_direct' : 'missing',
      blocking: !negativeClosed,
      evidenceIds: artifact.trackBNegativeControlEvidenceIds || [],
      acceptedUse: 'negative_control_candidate',
      nextActionIfMissing: 'run_limited_negative_control',
    }),
    matrixRow({
      evidenceClass: 'holdout_validation',
      acceptedCount: holdoutCount,
      promotionEligibleCount: 0,
      sourceGroups: artifact.trackBHoldoutSourceGroups || [],
      independentSourceBreadth: sourceBreadth,
      status: holdoutConfirmed ? 'confirmed' : 'missing',
      blocking: !holdoutConfirmed,
      evidenceIds: artifact.trackBHoldoutEvidenceIds || trackB.holdoutAcceptedEvidenceIds || [],
      acceptedUse: 'supporting_context',
      nextActionIfMissing: 'run_limited_holdout_validation',
    }),
    matrixRow({
      evidenceClass: 'controlled_market_validation',
      acceptedCount: marketAccepted ? 1 : 0,
      promotionEligibleCount: 0,
      sourceGroups: marketAccepted ? ['local_controlled_market'] : [],
      independentSourceBreadth: sourceBreadth,
      status: marketStatus,
      blocking: !marketAccepted,
      evidenceIds: artifact.marketValidationEvidenceIds || [],
      caveats: marketCaveats,
      acceptedUse: 'supporting_context',
      nextActionIfMissing: 'run_limited_controlled_market_validation',
      ...marketValidationRegimeMatrixFields(artifact.marketRegimeSupport || {
        marketValidationRegimeStatus: artifact.marketValidationRegimeStatus || 'regime_missing',
        regimeConsistencyScore: artifact.regimeConsistencyScore ?? 'not_computable',
        regimeCoverageScore: artifact.regimeCoverageScore ?? 'not_computable',
        extremeTstatWarning: artifact.extremeTstatWarning,
        tstatSanityStatus: artifact.tstatSanityStatus || 'not_computable',
        caveats: marketCaveats,
      }),
    }),
    matrixRow({
      evidenceClass: 'source_breadth',
      acceptedCount: sourceBreadth,
      promotionEligibleCount: 0,
      sourceGroups: uniqueStrings([artifact.trackBSourceGroupsUsed, artifact.trackBHoldoutSourceGroups, 'local_controlled_market'], 20),
      independentSourceBreadth: sourceBreadth,
      status: sourceBreadth >= 2 ? 'accepted' : 'missing',
      blocking: sourceBreadth < 2,
      acceptedUse: 'diagnostic',
      nextActionIfMissing: 'run_limited_holdout_validation',
    }),
    matrixRow({
      evidenceClass: 'contradiction_check',
      acceptedCount: 1,
      promotionEligibleCount: 0,
      sourceGroups: ['local_closure_dry_run'],
      independentSourceBreadth: sourceBreadth,
      status: 'evaluated',
      blocking: false,
      acceptedUse: 'diagnostic',
      nextActionIfMissing: null,
    }),
    valuationRow,
  ];
  if (requiresGridInterconnection) {
    rows.splice(1, 0, matrixRow({
      evidenceClass: 'grid_interconnection',
      acceptedCount: acceptedMechanism,
      promotionEligibleCount: 0,
      sourceGroups: trackA.sourceGroupsUsed || artifact.trackASourceGroupsUsed || [],
      independentSourceBreadth: sourceBreadth,
      status: acceptedMechanism >= 1 ? 'accepted_via_mechanism_validation' : 'missing',
      blocking: acceptedMechanism < 1,
      evidenceIds: trackA.acceptedEvidenceIds || [],
      acceptedUse: 'supporting_context',
      nextActionIfMissing: 'run_limited_grid_mechanism_validation',
    }));
  }
  return rows;
}

function contradictionWarningsForClosure(artifact = {}, matrix = []) {
  const warnings = [];
  const add = (code, severity, message, blocker = false, nextAction = 'keep dry-run blocked or caveated') => {
    warnings.push({ code, severity, message, blocker, nextAction });
  };
  const promotionCount = Number(artifact.acceptedPromotionEvidenceCount || 0);
  if (artifact.reportCandidateAllowedDiagnostic === true && promotionCount <= 0) {
    add('DIAGNOSTIC_ALLOWED_WITHOUT_PROMOTION_EVIDENCE', 'critical', 'Diagnostic report-candidate path is allowed with zero accepted promotion evidence.', true);
  }
  if (/controlled_ready/i.test(String(artifact.marketValidationStatus || '')) && Number(artifact.marketValidationEventAnchorCount || 0) <= 0) {
    add('CONTROLLED_MARKET_WITHOUT_ACCEPTED_EVENT_ANCHORS', 'critical', 'Controlled-ready market validation has no accepted event anchors.', true);
  }
  if (/review|decision/i.test(String(artifact.visualStatus || '')) && uniqueStrings(artifact.marketValidationWarnings || []).length) {
    add('MARKET_WARNING_WITH_READY_STATUS', 'warning', 'Market validation has sanity warnings while status appears ready.', false);
  }
  if (!['SURVIVED', 'CHECKED_NO_DIRECT'].includes(String(artifact.negativeControlStatus || artifact.trackBNegativeControlStatus || ''))) {
    add('NEGATIVE_CONTROL_MISSING_IN_CLOSURE', 'critical', 'Negative control is not closed.', true, 'run_limited_negative_control');
  }
  if (!(artifact.holdoutConfirmed || artifact.trackBHoldoutConfirmed)) {
    add('HOLDOUT_MISSING_IN_CLOSURE', 'critical', 'Holdout validation is not confirmed.', true, 'run_limited_holdout_validation');
  }
  if (!/closed|attached/i.test(String(artifact.issuerBridgeStatus || artifact.trackBIssuerBridgeStatus || ''))) {
    add('ISSUER_BRIDGE_MISSING_IN_CLOSURE', 'critical', 'Issuer bridge is not closed.', true, 'run_limited_issuer_bridge_track');
  }
  if (artifact.blockType === 'provider_blocked') {
    add('PROVIDER_BLOCKED_SUBJECT_CLOSURE_ATTEMPTED', 'critical', 'Provider-blocked subject cannot pass closure.', true, 'create_provider_gap_proposal');
  }
  if (Number(artifact.independentSourceBreadth || 0) < 2) {
    add('SOURCE_BREADTH_BELOW_CLOSURE_MINIMUM', 'critical', 'Independent source breadth is below 2.', true, 'run_limited_holdout_validation');
  }
  if (!artifact.valuationBridgeStatus && !artifact.expectationBridgeStatus) {
    add('VALUATION_OR_EXPECTATION_BRIDGE_MISSING', 'warning', 'Valuation or expectation bridge is missing; investment memo readiness remains blocked.', false, 'build_valuation_or_expectation_bridge_before_investment_memo');
  }
  warnings.push(...detectReportReadinessContradictions({
    summary: {
      visualStatus: artifact.visualStatus || 'pending',
      openClasses: matrix.filter((row) => row.blocking).map((row) => row.evidenceClass),
      coveredEvidenceClasses: matrix.filter((row) => !row.blocking && row.acceptedCount > 0).map((row) => row.evidenceClass),
      sourceBreadth: artifact.independentSourceBreadth,
    },
    matrix,
    quality: {
      productTier: artifact.productTier,
      decisionDiagnostic: {
        coveredEvidenceClasses: matrix.filter((row) => !row.blocking && row.acceptedCount > 0).map((row) => row.evidenceClass),
      },
    },
    actionability: { tier: artifact.actionabilityTier || 'not_ready' },
    issuerBridge: { status: artifact.issuerBridgeStatus || artifact.trackBIssuerBridgeStatus || 'missing' },
    marketValidation: {
      tier: artifact.marketValidationStatus === 'controlled_ready' ? 'decision_grade' : artifact.marketValidationStatus,
      regimeConsistency: artifact.marketValidationWarnings?.includes?.('sanity_check_extreme_tstat') ? 0 : 1,
    },
  }));
  const seen = new Set();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function closureStatusForMatrix(artifact = {}, matrix = [], contradictionWarnings = []) {
  if (artifact.blockType === 'provider_blocked') return 'closure_blocked_provider_gap';
  if (artifact.routeMismatchDetected && !artifact.splitTracks) return 'closure_blocked';
  const blockingRows = matrix.filter((row) => row.blocking);
  if (blockingRows.some((row) => row.evidenceClass === 'controlled_market_validation')) return 'closure_blocked_market_validation';
  if (contradictionWarnings.some((warning) => warning.blocker === true)) return 'closure_blocked_contradiction';
  if (blockingRows.length) return 'closure_blocked';
  const caveatRows = matrix.filter((row) => row.caveats?.length);
  if (caveatRows.length || contradictionWarnings.some((warning) => warning.severity === 'warning')) return 'closure_passed_with_caveats';
  return 'closure_passed_for_report_subject_dry_run';
}

function buildDryRunReportSubject(artifact = {}, matrix = [], closureStatus = 'closure_blocked', caveats = []) {
  if (!/^closure_passed/.test(String(closureStatus))) return null;
  const selectedSeed = artifact.selectedChildSeed || artifact.selectedSeed || {};
  const trackBSeed = artifact.splitTracks?.issuerBridgeTrack?.seed || {};
  const seedId = compact(selectedSeed.childSeedId || selectedSeed.seedId || trackBSeed.seedId || trackBSeed.childSeedId || 'grid-issuer-bridge-track');
  const parentSeedId = selectedSeed.parentSeedId || trackBSeed.parentSeedId || null;
  const positivePathValidationFixture = /^positive-path-/i.test(String(parentSeedId || ''));
  const issuerUniverse = uniqueStrings([
    artifact.trackBIssuerCandidates,
    trackBSeed.issuerCandidates,
  ], 10);
  const themeLabel = compact(trackBSeed.theme?.label || selectedSeed.theme?.label || selectedSeed.theme || 'autonomous cross-theme');
  const mechanismNode = compact(artifact.splitTracks?.mechanismValidationTrack?.seed?.bottleneckNode
    || selectedSeed.bottleneckNode
    || selectedSeed.bottleneck?.label
    || 'mechanism bottleneck');
  const issuerBridgeNode = compact(trackBSeed.bottleneckNode || trackBSeed.bottleneck?.label || selectedSeed.bottleneckNode || 'issuer bridge bottleneck');
  const subjectLabel = compact(trackBSeed.subjectLabel
    || `${issuerBridgeNode} as ${themeLabel} cross-theme bottleneck`);
  return {
    subjectId: `dryrun-thesis-validation-${seedId}`,
    subjectLabel,
    parentSeedId,
    childSeedId: selectedSeed.childSeedId || selectedSeed.seedId || trackBSeed.childSeedId || trackBSeed.seedId || null,
    trackId: 'issuer_bridge_track',
    thesisType: 'thesis_validation',
    themes: uniqueStrings([trackBSeed.theme?.key, trackBSeed.theme?.label, selectedSeed.theme?.key, selectedSeed.theme?.label], 8),
    themePair: themeLabel,
    connector: issuerBridgeNode,
    bottleneckNode: selectedSeed.bottleneckNode || selectedSeed.bottleneck?.label || null,
    mechanismNode,
    issuerBridgeNode,
    concreteBottleneckNodes: [
      { node: mechanismNode, class: artifact.splitTracks?.mechanismValidationTrack?.seed?.bottleneckClass || 'mechanism' },
      { node: issuerBridgeNode, class: trackBSeed.bottleneckClass || trackBSeed.childClass || 'issuer_bridge' },
    ],
    positivePathValidationFixture,
    subjectSelectionDisposition: positivePathValidationFixture ? 'validation_fixture_only' : 'validated_cross_theme_candidate',
    noveltyGatePassed: !positivePathValidationFixture,
    decisionUse: 'research_validation_memo',
    notDecisionReady: true,
    investmentMemoReady: false,
    decisionReady: false,
    issuerUniverse,
    mechanismSummary: `${matrix.find((row) => row.evidenceClass === 'mechanism_validation')?.acceptedCount || 0} accepted Track A mechanism evidence rows support the process bottleneck.`,
    issuerBridgeSummary: `${matrix.find((row) => row.evidenceClass === 'issuer_exposure')?.promotionEligibleCount || 0} promotion-eligible issuer bridge evidence rows are attached.`,
    negativeControlSummary: `Negative control status is ${artifact.negativeControlStatus || artifact.trackBNegativeControlStatus || 'missing'}.`,
    holdoutSummary: `Holdout validation is ${artifact.holdoutConfirmed || artifact.trackBHoldoutConfirmed ? 'confirmed' : 'missing'}.`,
    marketValidationSummary: `Controlled market validation is ${artifact.marketValidationStatus || 'missing'} (${artifact.marketValidationDirection || 'unknown'}).`,
    caveats,
    remainingBlockers: ['investment_memo_readiness_blocked_until_valuation_or_expectation_bridge'],
    nextAction: 'thesis_validation_memo_dry_run',
  };
}

export function runEvidenceContractClosureDryRunExecutor(inputState = {}, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const artifact = inputState.acquisition || {};
  const matrix = buildEvidenceContractClosureMatrix(artifact);
  const contradictionWarnings = contradictionWarningsForClosure(artifact, matrix);
  const closureStatus = closureStatusForMatrix(artifact, matrix, contradictionWarnings);
  const caveats = uniqueStrings([
    artifact.marketValidationCaveats,
    artifact.marketValidationWarnings,
    matrix.flatMap((row) => row.caveats || []),
    contradictionWarnings.filter((warning) => warning.severity === 'warning').map((warning) => warning.code),
  ], 40);
  const remainingBlockers = /^closure_passed/.test(closureStatus)
    ? ['investment_memo_readiness_blocked_until_valuation_or_expectation_bridge']
    : uniqueStrings([
      matrix.filter((row) => row.blocking).map((row) => row.evidenceClass),
      contradictionWarnings.filter((warning) => warning.blocker).map((warning) => warning.code),
    ], 40);
  const dryRunReportSubject = buildDryRunReportSubject(artifact, matrix, closureStatus, caveats);
  const reportCandidateAllowedDiagnostic = Boolean(
    artifact.reportCandidateAllowedDiagnostic === true
    && /^closure_passed/.test(closureStatus)
  );
  return {
    ok: true,
    executed: true,
    action: 'evidence_contract_closure_dry_run',
    actionId: `repair-loop-contract-closure-${Date.parse(generatedAt) || Date.now()}`,
    generatedAt,
    dryRunReportSubject,
    reportSubjectDryRun: dryRunReportSubject,
    evidenceContractClosureDryRun: true,
    evidenceContractMatrix: matrix,
    evidenceContractMatrixSummary: matrix.map((row) => ({
      evidenceClass: row.evidenceClass,
      status: row.status,
      acceptedCount: row.acceptedCount,
      promotionEligibleCount: row.promotionEligibleCount,
      blocking: row.blocking,
      caveats: row.caveats,
      nextActionIfMissing: row.nextActionIfMissing,
    })),
    closureStatus,
    remainingBlockers,
    caveats,
    contradictionWarnings,
    reportCandidateAllowedDiagnostic,
    reportCandidateWrites: 0,
    readinessPromotionWrites: 0,
    investmentMemoReady: false,
    decisionReady: false,
    gateImpact: {
      reportCandidateAllowed: false,
      reportCandidateAllowedDiagnostic,
      readinessChanged: false,
      visualStatus: 'pending',
      gateResult: 'blocked',
      finalBlocker: /^closure_passed/.test(closureStatus)
        ? 'thesis_validation_memo_dry_run_required'
        : closureStatus,
      blockers: remainingBlockers,
    },
    boundaries: zeroBoundaries(),
  };
}

export function runThesisValidationMemoDryRunExecutor(inputState = {}, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const artifact = inputState.acquisition || {};
  const matrix = asArray(artifact.evidenceContractMatrix).length
    ? artifact.evidenceContractMatrix
    : asArray(artifact.evidenceContractMatrixSummary);
  const reportSubjectDryRun = artifact.dryRunReportSubject || artifact.reportSubjectDryRun || null;
  if (!/^closure_passed/i.test(String(artifact.evidenceContractClosureStatus || '')) || !reportSubjectDryRun || !matrix.length) {
    return {
      ok: false,
      executed: false,
      action: 'thesis_validation_memo_dry_run',
      operatorReviewRequired: true,
      reason: 'thesis validation memo dry-run requires a passed Evidence Contract Matrix closure and report subject dry-run',
      gateImpact: {
        reportCandidateAllowed: false,
        readinessChanged: false,
        visualStatus: 'pending',
        gateResult: 'blocked',
        finalBlocker: 'evidence_contract_closure_required_before_thesis_memo',
        blockers: ['evidence_contract_closure_required_before_thesis_memo'],
      },
      boundaries: zeroBoundaries(),
    };
  }
  const memo = buildThesisValidationMemoDryRun({
    generatedAt,
    reportSubjectDryRun,
    evidenceContractMatrix: matrix,
    caveats: artifact.closureCaveats || [],
    contradictionWarnings: artifact.closureContradictionWarnings || artifact.contradictionWarnings || [],
    remainingBlockers: ['investment_memo_readiness_blocked_until_valuation_or_expectation_bridge'],
    rawEvidenceCount: artifact.rawEvidenceCount || 0,
    acceptedEvidenceCount: artifact.acceptedEvidenceCount || 0,
  });
  const validation = validateThesisValidationMemoDryRun(memo);
  const artifactRoot = path.resolve(options.artifactRoot || DEFAULT_ARTIFACT_ROOT);
  const jsonPath = path.join(artifactRoot, 'thesis-validation-memo-dry-run.latest.json');
  const htmlPath = path.join(artifactRoot, 'thesis-validation-memo-dry-run.html');
  const auditPath = path.join(artifactRoot, 'thesis-validation-memo-audit-appendix.latest.json');
  return {
    ok: validation.ok,
    executed: true,
    action: 'thesis_validation_memo_dry_run',
    actionId: `repair-loop-thesis-validation-memo-${Date.parse(generatedAt) || Date.now()}`,
    generatedAt,
    thesisValidationMemoDryRunStatus: validation.ok ? 'ready_with_caveats' : 'validator_failed',
    memoType: memo.metadata.memoType,
    memoDecisionUse: memo.metadata.decisionUse,
    notDecisionReady: memo.metadata.notDecisionReady,
    investmentMemoReady: memo.metadata.investmentMemoReady,
    decisionReady: memo.metadata.decisionReady,
    portfolioActionAllowed: memo.metadata.portfolioActionAllowed,
    thesisValidationMemoDryRun: memo,
    thesisValidationMemoValidation: validation,
    clientMemoPath: jsonPath,
    clientMemoHtmlPath: htmlPath,
    auditAppendixPath: auditPath,
    caveats: memo.caveats,
    remainingBlockers: memo.remainingBlockers,
    nextRecommendedAction: validation.ok
      ? ['build_valuation_or_expectation_bridge', 'improve_market_validation_regime_support', 'investment_memo_readiness_blocked_until_valuation']
      : 'fix_thesis_validation_memo_validator_blockers',
    reportCandidateWrites: 0,
    readinessPromotionWrites: 0,
    providerActivationWrites: 0,
    investmentReady: false,
    gateImpact: {
      reportCandidateAllowed: false,
      readinessChanged: false,
      visualStatus: validation.ok ? 'validation_candidate' : 'pending',
      gateResult: 'blocked',
      finalBlocker: validation.ok
        ? 'investment_memo_readiness_blocked_until_valuation_or_expectation_bridge'
        : 'thesis_validation_memo_validator_failed',
      blockers: validation.ok
        ? ['investment_memo_readiness_blocked_until_valuation_or_expectation_bridge', 'market_validation_caveated']
        : validation.blockers.map((blocker) => blocker.type),
    },
    boundaries: zeroBoundaries(),
  };
}

export function runValuationExpectationBridgeDryRunExecutor(inputState = {}, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const artifact = inputState.acquisition || {};
  const existingMemo = artifact.thesisValidationMemoDryRun || null;
  if (!artifact.thesisValidationMemoDryRunStatus && !existingMemo) {
    return {
      ok: false,
      executed: false,
      action: 'valuation_expectation_bridge_dry_run',
      operatorReviewRequired: true,
      reason: 'valuation / expectation bridge dry-run requires thesis validation memo dry-run first',
      gateImpact: {
        reportCandidateAllowed: false,
        readinessChanged: false,
        visualStatus: 'pending',
        gateResult: 'blocked',
        finalBlocker: 'thesis_validation_memo_required_before_valuation_bridge',
        blockers: ['thesis_validation_memo_required_before_valuation_bridge'],
      },
      boundaries: zeroBoundaries(),
    };
  }
  const issuerUniverse = uniqueStrings([
    artifact.dryRunReportSubject?.issuerUniverse,
    artifact.reportSubjectDryRun?.issuerUniverse,
    artifact.trackBIssuerCandidates,
  ], 6);
  const localCache = loadLocalValuationFundamentalsCache({
    fixturePath: options.valuationCacheFixture || artifact.valuationCacheFixture || null,
    rows: options.localValuationRows || artifact.localValuationRows || artifact.valuationRows || null,
    issuerUniverse,
  });
  const bridge = buildValuationExpectationBridgeDryRun({
    ...artifact,
    generatedAt,
    localValuationRows: localCache.rows,
    localValuationCache: localCache,
    historicalAnalogueBridge: options.historicalAnalogueBridge || artifact.historicalAnalogueBridge || null,
    useHistoricalAnalogueBridge: true,
    requireHistoricalAnalogueBridge: Boolean(options.requireHistoricalAnalogueBridge || artifact.requireHistoricalAnalogueBridge),
    marketValidationWarnings: uniqueStrings([
      artifact.marketValidationWarnings,
      artifact.closureCaveats,
      artifact.thesisValidationMemoCaveats,
      artifact.closureContradictionWarnings?.map((warning) => warning.code),
    ], 40),
    marketValidationCaveats: uniqueStrings([artifact.marketValidationCaveats], 40),
  });
  const validation = validateValuationExpectationBridgeDryRun(bridge);
  const matrix = asArray(artifact.evidenceContractMatrix).length
    ? artifact.evidenceContractMatrix
    : asArray(artifact.evidenceContractMatrixSummary);
  const valuationRow = valuationMatrixRowFromBridge(bridge);
  const updatedMatrix = [
    ...matrix.filter((row) => row.evidenceClass !== 'valuation_or_expectation_bridge'),
    valuationRow,
  ].map((row) => (row.evidenceClass === 'controlled_market_validation'
    ? { ...row, ...marketValidationRegimeMatrixFields(bridge) }
    : row));
  const updatedMemo = existingMemo
    ? buildThesisValidationMemoDryRun({
      generatedAt,
      reportSubjectDryRun: artifact.dryRunReportSubject || artifact.reportSubjectDryRun || existingMemo.metadata || {},
      evidenceContractMatrix: updatedMatrix,
      caveats: uniqueStrings([artifact.closureCaveats, bridge.caveats], 80),
      contradictionWarnings: artifact.closureContradictionWarnings || artifact.contradictionWarnings || [],
      remainingBlockers: uniqueStrings([
        'investment_memo_readiness_blocked_until_valuation_or_expectation_bridge',
        bridge.investmentMemoReadinessDiagnostic?.status,
      ], 20),
      rawEvidenceCount: artifact.rawEvidenceCount || 0,
      acceptedEvidenceCount: artifact.acceptedEvidenceCount || 0,
      valuationBridge: bridge,
    })
    : null;
  const artifactRoot = path.resolve(options.artifactRoot || DEFAULT_ARTIFACT_ROOT);
  const valuationBridgePath = path.join(artifactRoot, 'valuation-expectation-bridge-dry-run.latest.json');
  const marketRegimeSupportPath = path.join(artifactRoot, 'market-validation-regime-support.latest.json');
  const clientMemoPath = path.join(artifactRoot, 'thesis-validation-memo-dry-run.latest.json');
  const clientMemoHtmlPath = path.join(artifactRoot, 'thesis-validation-memo-dry-run.html');
  const auditAppendixPath = path.join(artifactRoot, 'thesis-validation-memo-audit-appendix.latest.json');
  const diagnosticStatus = bridge.investmentMemoReadinessDiagnostic?.status || 'not_ready';
  return {
    ok: validation.ok,
    executed: true,
    action: 'valuation_expectation_bridge_dry_run',
    actionId: `repair-loop-valuation-expectation-bridge-${Date.parse(generatedAt) || Date.now()}`,
    generatedAt,
    valuationExpectationBridgeDryRunStatus: validation.ok ? 'ready_with_caveats' : 'validator_failed',
    valuationExpectationBridgeDryRun: bridge,
    valuationBridgeStatus: bridge.valuationBridgeStatus,
    expectationBridgeStatus: bridge.expectationBridgeStatus,
    issuerValuationBridgeTable: bridge.issuerValuationBridgeTable,
    historicalAnalogueBridge: bridge.historicalAnalogueBridge,
    pricedInRiskDiagnostics: bridge.pricedInRiskDiagnostics,
    expectationReflectionStatus: bridge.expectationReflectionStatus,
    missingValuationFields: bridge.missingValuationFields,
    localValuationCache: localCache,
    localValuationCacheRowCount: localCache.rowCount,
    localValuationCacheMissingIssuers: localCache.missingIssuers,
    localValuationCacheRejectedRows: localCache.rejectedRows?.length || 0,
    marketRegimeSupport: bridge.marketRegimeSupport,
    marketValidationRegimeStatus: bridge.marketValidationRegimeStatus,
    regimeConsistencyScore: bridge.regimeConsistencyScore,
    extremeTstatWarning: bridge.extremeTstatWarning,
    investmentMemoReadinessDiagnostic: bridge.investmentMemoReadinessDiagnostic,
    readyForHumanInvestmentMemoReview: bridge.readyForHumanInvestmentMemoReview,
    investmentMemoReady: false,
    decisionReady: false,
    portfolioActionAllowed: false,
    updatedEvidenceContractMatrix: updatedMatrix,
    valuationBridgeMatrixRow: valuationRow,
    updatedThesisValidationMemoDryRun: updatedMemo,
    valuationExpectationBridgeValidation: validation,
    valuationBridgePath,
    marketRegimeSupportPath,
    clientMemoPath,
    clientMemoHtmlPath,
    auditAppendixPath,
    caveats: bridge.caveats,
    remainingBlockers: uniqueStrings([
      bridge.investmentMemoReadinessDiagnostic?.status,
      bridge.investmentMemoReadinessDiagnostic?.missingForInvestmentMemo,
      bridge.marketRegimeSupport?.caveats,
    ], 40),
    nextRecommendedAction: bridge.nextRecommendedAction,
    reportCandidateWrites: 0,
    readinessPromotionWrites: 0,
    providerActivationWrites: 0,
    gateImpact: {
      reportCandidateAllowed: false,
      readinessChanged: false,
      visualStatus: 'validation_candidate',
      gateResult: 'blocked',
      finalBlocker: diagnosticStatus,
      blockers: uniqueStrings([
        diagnosticStatus,
        bridge.investmentMemoReadinessDiagnostic?.missingForInvestmentMemo,
      ], 40),
    },
    boundaries: zeroBoundaries(),
  };
}

function investmentMemoDiagnosticForRegimeRepair({ valuationBridgeStatus, expectationBridgeStatus, marketRegimeSupport } = {}) {
  const missing = [];
  if (valuationBridgeStatus === 'valuation_bridge_missing') missing.push('valuation_or_expectation_bridge');
  if (expectationBridgeStatus === 'expectation_bridge_missing') missing.push('issuer_expectation_context');
  if (marketRegimeSupport?.marketValidationRegimeStatus !== 'regime_supported') missing.push('market_validation_regime_support');
  let status = 'not_ready';
  if (valuationBridgeStatus === 'valuation_bridge_contradictory' || expectationBridgeStatus === 'expectation_bridge_contradictory') status = 'blocked_priced_in_or_contradictory_valuation';
  else if (valuationBridgeStatus === 'valuation_bridge_missing') status = 'blocked_missing_valuation_bridge';
  else if (expectationBridgeStatus === 'expectation_bridge_missing') status = 'blocked_expectation_bridge_missing';
  else if (marketRegimeSupport?.marketValidationRegimeStatus === 'regime_missing') status = 'blocked_market_validation_regime_missing';
  else if (marketRegimeSupport?.marketValidationRegimeStatus === 'regime_contradictory') status = 'blocked_market_validation_contradictory';
  else if (marketRegimeSupport?.marketValidationRegimeStatus === 'regime_caveated') status = 'blocked_market_validation_regime_caveat';
  else if (marketRegimeSupport?.marketValidationRegimeStatus === 'regime_supported' && valuationBridgeStatus === 'valuation_bridge_closed') status = 'ready_for_human_investment_memo_review';
  return {
    status,
    missingForInvestmentMemo: uniqueStrings(missing, 20),
    readyForInvestmentMemoReview: status === 'ready_for_human_investment_memo_review',
    notDecisionReadyReason: missing.length
      ? missing.join(', ')
      : 'human review required; diagnostic only; readiness promotion remains disabled',
    portfolioActionAllowed: false,
  };
}

export function runMarketValidationRegimeSupportRepairExecutor(inputState = {}, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const artifact = inputState.acquisition || {};
  const regimeFixture = options.marketRegimeFixtureData || loadMarketRegimeFixture(options.marketRegimeFixture) || {};
  const fixtureWindows = regimeFixture.marketValidationWindowResults || regimeFixture.windowResults || regimeFixture.windows || null;
  const hasRegimeFixture = Object.keys(regimeFixture || {}).length > 0;
  const marketValidationWarnings = hasRegimeFixture
    ? uniqueStrings([regimeFixture.marketValidationWarnings, regimeFixture.warnings], 40)
    : uniqueStrings([
      artifact.marketValidationWarnings,
      artifact.closureCaveats,
      artifact.thesisValidationMemoCaveats,
      artifact.closureContradictionWarnings?.map((warning) => warning.code),
    ], 40);
  const marketValidationCaveats = hasRegimeFixture
    ? uniqueStrings([regimeFixture.marketValidationCaveats, regimeFixture.caveats], 60)
    : uniqueStrings([
      artifact.marketValidationCaveats,
      artifact.marketRegimeSupport?.caveats,
    ], 60);
  const marketRegimeSupport = buildMarketValidationRegimeSupport({
    ...artifact,
    ...regimeFixture,
    ...(hasRegimeFixture ? {
      regimeConsistencyScore: regimeFixture.regimeConsistencyScore,
      regimeCoverageScore: regimeFixture.regimeCoverageScore,
      sampleRegimeCoverage: regimeFixture.sampleRegimeCoverage,
    } : {}),
    generatedAt,
    marketValidationWindowResults: options.marketValidationWindowResults || fixtureWindows || artifact.marketValidationWindowResults || [],
    marketValidationWarnings,
    marketValidationCaveats,
  });
  const valuationBridgeStatus = artifact.valuationBridgeStatus || artifact.valuationExpectationBridgeDryRun?.valuationBridgeStatus || 'valuation_bridge_missing';
  const expectationBridgeStatus = artifact.expectationBridgeStatus || artifact.valuationExpectationBridgeDryRun?.expectationBridgeStatus || 'expectation_bridge_missing';
  const investmentMemoReadinessDiagnostic = investmentMemoDiagnosticForRegimeRepair({
    valuationBridgeStatus,
    expectationBridgeStatus,
    marketRegimeSupport,
  });
  const existingMatrix = asArray(artifact.evidenceContractMatrix).length
    ? artifact.evidenceContractMatrix
    : asArray(artifact.evidenceContractMatrixSummary);
  const updatedEvidenceContractMatrix = existingMatrix.map((row) => {
    if (row.evidenceClass !== 'controlled_market_validation') return row;
    return {
      ...row,
      ...marketValidationRegimeMatrixFields({ marketRegimeSupport }),
      blockingForInvestmentReadiness: marketRegimeSupport.marketValidationRegimeStatus !== 'regime_supported',
      blockingForDecisionReadiness: true,
    };
  });
  const finalBlocker = investmentMemoReadinessDiagnostic.status;
  return {
    ok: true,
    executed: true,
    action: 'market_validation_regime_support_repair',
    actionId: `repair-loop-market-regime-support-${Date.parse(generatedAt) || Date.now()}`,
    generatedAt,
    marketRegimeSupport,
    marketValidationRegimeStatus: marketRegimeSupport.marketValidationRegimeStatus,
    regimeConsistencyScore: marketRegimeSupport.regimeConsistencyScore,
    regimeCoverageScore: marketRegimeSupport.regimeCoverageScore,
    eventCountByRegime: marketRegimeSupport.eventCountByRegime,
    controlCountByRegime: marketRegimeSupport.controlCountByRegime,
    directionSupportByRegime: marketRegimeSupport.directionSupportByRegime,
    abnormalReturnByRegime: marketRegimeSupport.abnormalReturnByRegime,
    hitRateByRegime: marketRegimeSupport.hitRateByRegime,
    unknownRegimeShare: marketRegimeSupport.unknownRegimeShare,
    extremeTstatWarning: marketRegimeSupport.extremeTstatWarning,
    tstatRaw: marketRegimeSupport.tstatRaw,
    tstatCapped: marketRegimeSupport.tstatCapped,
    tstatSanityStatus: marketRegimeSupport.tstatSanityStatus,
    tstatWarningReason: marketRegimeSupport.tstatWarningReason,
    marketValidationResearchUseAllowed: marketRegimeSupport.marketValidationResearchUseAllowed,
    marketValidationInvestmentUseAllowed: marketRegimeSupport.marketValidationInvestmentUseAllowed,
    marketValidationDecisionUseAllowed: false,
    investmentMemoReadinessDiagnostic,
    readyForHumanInvestmentMemoReview: investmentMemoReadinessDiagnostic.readyForInvestmentMemoReview,
    investmentMemoReady: false,
    decisionReady: false,
    portfolioActionAllowed: false,
    updatedEvidenceContractMatrix,
    caveats: marketRegimeSupport.caveats,
    remainingBlockers: uniqueStrings([
      investmentMemoReadinessDiagnostic.status,
      investmentMemoReadinessDiagnostic.missingForInvestmentMemo,
      marketRegimeSupport.caveats,
    ], 40),
    nextRecommendedAction: investmentMemoReadinessDiagnostic.readyForInvestmentMemoReview
      ? 'investment_memo_readiness_review_dry_run'
      : marketRegimeSupport.marketValidationRegimeStatus === 'regime_missing'
        ? 'market_regime_input_provider_gap_or_fixture_required'
        : finalBlocker,
    gateImpact: {
      reportCandidateAllowed: false,
      readinessChanged: false,
      visualStatus: 'validation_candidate',
      gateResult: 'blocked',
      finalBlocker,
      blockers: uniqueStrings([finalBlocker, investmentMemoReadinessDiagnostic.missingForInvestmentMemo], 40),
    },
    boundaries: zeroBoundaries(),
  };
}

export function runFinalInvestmentReportDryRunExecutor(inputState = {}, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const artifact = inputState.acquisition || {};
  const report = buildFinalInvestmentReportDryRun({
    ...artifact,
    generatedAt,
    evidenceContractMatrix: asArray(artifact.evidenceContractMatrix).length
      ? artifact.evidenceContractMatrix
      : artifact.evidenceContractMatrixSummary,
    evidenceContractClosureStatus: artifact.evidenceContractClosureStatus,
    marketRegimeSupport: artifact.marketRegimeSupport,
    marketValidationRegimeStatus: artifact.marketValidationRegimeStatus,
    contradictionWarnings: artifact.closureContradictionWarnings || artifact.contradictionWarnings || [],
  });
  const validation = validateFinalInvestmentReportDryRun(report);
  const finalStatus = validation.ok
    ? report.finalInvestmentReportDryRunStatus
    : 'failed';
  const finalBlocker = validation.ok
    ? report.remainingBlockers.length
      ? 'final_investment_report_dry_run_blocked'
      : 'human_review_required'
    : 'final_investment_report_validator_failed';
  const artifactRoot = path.resolve(options.artifactRoot || DEFAULT_ARTIFACT_ROOT);
  return {
    ok: validation.ok,
    executed: true,
    action: 'final_investment_report_dry_run',
    actionId: `repair-loop-final-investment-report-dry-run-${Date.parse(generatedAt) || Date.now()}`,
    generatedAt,
    finalInvestmentReportDryRun: report,
    finalInvestmentReportDryRunStatus: finalStatus,
    finalInvestmentReportValidation: validation,
    validatorStatus: validation.ok ? 'passed' : 'failed',
    memoType: report.metadata.memoType,
    memoDecisionUse: report.metadata.decisionUse,
    decisionUse: report.metadata.decisionUse,
    notDecisionReady: true,
    investmentMemoReady: false,
    decisionReady: false,
    portfolioActionAllowed: false,
    clientMemoPath: path.join(artifactRoot, 'final-investment-report-dry-run.latest.json'),
    clientMemoHtmlPath: path.join(artifactRoot, 'final-investment-report-dry-run.html'),
    auditAppendixPath: path.join(artifactRoot, 'final-investment-report-audit-appendix.latest.json'),
    remainingBlockers: report.remainingBlockers,
    remainingCaveats: uniqueStrings([artifact.remainingCaveats, artifact.closureCaveats, report.remainingBlockers], 80),
    finalStopReason: report.remainingBlockers.length
      ? 'partial_blocked_operator_review_required'
      : 'pass_mvp_ready_human_review_required',
    nextRecommendedAction: report.remainingBlockers.length
      ? 'operator_review_required_for_remaining_blockers'
      : 'mvp_ready_stop_feature_expansion',
    reportCandidateWrites: 0,
    readinessPromotionWrites: 0,
    providerActivationWrites: 0,
    portfolioActionWrites: 0,
    gateImpact: {
      reportCandidateAllowed: false,
      readinessChanged: false,
      visualStatus: report.remainingBlockers.length ? 'validation_candidate' : 'human_review_required',
      gateResult: 'blocked',
      finalBlocker,
      blockers: report.remainingBlockers.length ? report.remainingBlockers : ['human_review_required_no_auto_promotion'],
    },
    boundaries: zeroBoundaries(),
  };
}

export function executeSelectedRepairAction(actionSelection = {}, inputState = {}, options = {}) {
  const action = actionSelection.action;
  if (BANNED_ACTIONS.has(action) || !ALLOWED_ACTIONS.has(action)) {
    return {
      ok: false,
      operatorReviewRequired: true,
      unsafeActionBlocked: true,
      reason: `${action} is not an allowed repair-loop action`,
      providerActivationWrites: 0,
      readinessChanged: false,
      reportCandidateAllowed: false,
      boundaries: zeroBoundaries(),
    };
  }
  const isBoundedRunAction = /^run_limited_/.test(String(action || ''));
  if ((options.mode === 'execute-safe' || options.mode === 'apply') && isBoundedRunAction && !BOUNDED_EXECUTABLE_ACTIONS.has(action)) {
    return {
      ok: false,
      operatorReviewRequired: true,
      unsafeActionBlocked: true,
      reason: `${action} is not allowlisted for execute-safe mode`,
      providerActivationWrites: 0,
      readinessChanged: false,
      reportCandidateAllowed: false,
      boundaries: zeroBoundaries(),
    };
  }
  if (action === 'create_provider_gap_proposal') return buildProviderGapProposalAction(inputState);
  if (action === 'split_mechanism_and_issuer_tracks') return buildSplitTracksAction(inputState, options.generatedAt);
  if ((options.mode === 'execute-safe' || options.mode === 'apply') && action === 'run_limited_negative_control') {
    return runLimitedNegativeControlExecutor(inputState, options);
  }
  if ((options.mode === 'execute-safe' || options.mode === 'apply') && action === 'run_limited_grid_mechanism_validation') {
    return runLimitedGridMechanismValidationExecutor(inputState, options);
  }
  if ((options.mode === 'execute-safe' || options.mode === 'apply') && (action === 'run_limited_issuer_bridge_track' || action === 'run_limited_official_route')) {
    return runLimitedIssuerBridgeTrackExecutor(inputState, options);
  }
  if ((options.mode === 'execute-safe' || options.mode === 'apply') && action === 'run_limited_holdout_validation') {
    return runLimitedHoldoutValidationExecutor(inputState, options);
  }
  if ((options.mode === 'execute-safe' || options.mode === 'apply') && action === 'run_limited_controlled_market_validation') {
    return runLimitedControlledMarketValidationExecutor(inputState, options);
  }
  if ((options.mode === 'execute-safe' || options.mode === 'apply') && action === 'evidence_contract_closure_dry_run') {
    return runEvidenceContractClosureDryRunExecutor(inputState, options);
  }
  if ((options.mode === 'execute-safe' || options.mode === 'apply') && action === 'thesis_validation_memo_dry_run') {
    return runThesisValidationMemoDryRunExecutor(inputState, options);
  }
  if ((options.mode === 'execute-safe' || options.mode === 'apply') && action === 'valuation_expectation_bridge_dry_run') {
    return runValuationExpectationBridgeDryRunExecutor(inputState, options);
  }
  if (
    (options.mode === 'execute-safe' || options.mode === 'apply')
    && (action === 'market_validation_regime_support_repair' || action === 'repair_controlled_market_validation_regime_support')
  ) {
    return runMarketValidationRegimeSupportRepairExecutor(inputState, options);
  }
  if ((options.mode === 'execute-safe' || options.mode === 'apply') && action === 'final_investment_report_dry_run') {
    return runFinalInvestmentReportDryRunExecutor(inputState, options);
  }
  if ([
    'run_limited_official_route',
    'run_limited_holdout_validation',
    'run_limited_negative_control',
    'run_limited_grid_mechanism_validation',
    'run_limited_issuer_bridge_track',
    'run_limited_controlled_market_validation',
    'evidence_contract_closure_dry_run',
    'thesis_validation_memo_dry_run',
    'valuation_expectation_bridge_dry_run',
    'final_investment_report_dry_run',
    'generate_next_operator_review_task',
    'create_fixture_requirement',
    'create_targeted_backfill_task',
    'select_alternative_source_bucket',
    'apply_source_bucket_quota',
    'quarantine_source_or_provider',
    'decompose_seed',
    'improve_document_ranking',
    'improve_multilingual_dictionary',
    'select_positive_path_seed',
    'classify_provider_blocked',
  ].includes(action)) {
    return buildBoundedExecutionTask(action, inputState);
  }
  return {
    ok: false,
    operatorReviewRequired: true,
    reason: 'no safe action executable by repair loop',
    providerActivationWrites: 0,
    readinessChanged: false,
    reportCandidateAllowed: false,
    boundaries: zeroBoundaries(),
  };
}

function boundaryWrites(boundaries = {}) {
  return Object.values({
    ...SAFE_ZERO_BOUNDARIES,
    ...boundaries,
  }).reduce((sum, value) => sum + Number(value || 0), 0);
}

function actionSignature(actionSelection = {}, actionResult = {}) {
  return [
    actionSelection.action || 'unknown',
    actionResult.track || '',
    actionResult.trackId || '',
    actionResult.evidenceClass || actionResult.task?.evidenceClass || '',
    asArray(actionResult.queryFamilies || actionResult.task?.queryFamilies).join('|'),
  ].join('::');
}

function statusSnapshot(inputState = {}, evidence = null, readiness = null) {
  const artifact = inputState.acquisition || {};
  return {
    rawEvidenceCount: Number(evidence?.rawEvidenceCount ?? artifact.rawEvidenceCount ?? 0),
    acceptedEvidenceCount: Number(evidence?.acceptedEvidenceCount ?? artifact.acceptedEvidenceCount ?? 0),
    acceptedPromotionEvidenceCount: Number(evidence?.acceptedPromotionEvidenceCount ?? artifact.acceptedPromotionEvidenceCount ?? 0),
    independentSourceBreadth: Number(evidence?.independentSourceBreadth ?? artifact.independentSourceBreadth ?? artifact.sourceBreadth ?? 0),
    negativeControlStatus: artifact.negativeControlStatus || artifact.splitTracks?.issuerBridgeTrack?.negativeControlStatus || null,
    holdoutConfirmed: artifact.holdoutConfirmed ?? artifact.splitTracks?.issuerBridgeTrack?.holdoutConfirmed ?? null,
    issuerBridgeStatus: artifact.issuerBridgeStatus || null,
    marketValidationStatus: artifact.marketValidationStatus || null,
    valuationBridgeStatus: artifact.valuationBridgeStatus || artifact.valuationExpectationBridgeDryRun?.valuationBridgeStatus || null,
    expectationBridgeStatus: artifact.expectationBridgeStatus || artifact.valuationExpectationBridgeDryRun?.expectationBridgeStatus || null,
    marketValidationRegimeStatus: artifact.marketValidationRegimeStatus || artifact.valuationExpectationBridgeDryRun?.marketValidationRegimeStatus || null,
    finalInvestmentReportDryRunStatus: artifact.finalInvestmentReportDryRunStatus || null,
    visualStatus: readiness?.visualStatus || artifact.visualStatus || artifact.gateResult?.visualStatus || null,
    reportCandidateAllowed: Boolean(readiness?.reportCandidateAllowed || artifact.reportCandidateAllowed || artifact.gateResult?.gate === 'report_candidate_allowed'),
    finalBlocker: readiness?.finalBlocker || artifact.finalBlocker || null,
  };
}

function blockerAfterAction(actionSelection = {}, actionResult = {}, nextClassification = {}) {
  if (actionSelection.action === 'create_provider_gap_proposal') return 'provider_gap_review_required';
  if (actionSelection.action === 'split_mechanism_and_issuer_tracks') return 'split_track_closure_required';
  if (actionSelection.action === 'run_limited_negative_control') return actionResult.negativeControlStatus || nextClassification.primaryBlocker;
  if (actionSelection.action === 'run_limited_grid_mechanism_validation') return actionResult.acceptedEvidenceIds?.length
    ? 'track_a_mechanism_evidence_accepted'
    : 'track_a_mechanism_evidence_raw_only';
  if (actionSelection.action === 'run_limited_issuer_bridge_track' || actionSelection.action === 'run_limited_official_route') return actionResult.acceptedEvidenceIds?.length
    ? 'track_b_issuer_bridge_closed'
    : 'track_b_issuer_bridge_raw_only';
  if (actionSelection.action === 'run_limited_holdout_validation') return actionResult.gateImpact?.finalBlocker || nextClassification.primaryBlocker;
  if (actionSelection.action === 'run_limited_controlled_market_validation') return actionResult.gateImpact?.finalBlocker || nextClassification.primaryBlocker;
  if (actionSelection.action === 'evidence_contract_closure_dry_run') return actionResult.gateImpact?.finalBlocker || nextClassification.primaryBlocker;
  if (actionSelection.action === 'thesis_validation_memo_dry_run') return actionResult.gateImpact?.finalBlocker || nextClassification.primaryBlocker;
  if (actionSelection.action === 'valuation_expectation_bridge_dry_run') return actionResult.gateImpact?.finalBlocker || nextClassification.primaryBlocker;
  if (actionSelection.action === 'market_validation_regime_support_repair' || actionSelection.action === 'repair_controlled_market_validation_regime_support') return actionResult.gateImpact?.finalBlocker || nextClassification.primaryBlocker;
  if (actionSelection.action === 'final_investment_report_dry_run') return actionResult.gateImpact?.finalBlocker || nextClassification.primaryBlocker;
  return nextClassification.primaryBlocker || 'operator_review_required';
}

function nextRecommendedActionFor(actionSelection = {}, actionResult = {}, nextActionSelection = {}) {
  if (nextActionSelection?.action && nextActionSelection.action !== 'operator_review_required') {
    return nextActionSelection.action;
  }
  if (actionResult?.task?.evidenceClass) return actionResult.task;
  if (actionResult?.gateImpact?.finalBlocker) return actionResult.gateImpact.finalBlocker;
  if (actionSelection.action === 'create_provider_gap_proposal') return 'operator review of provider gap proposals';
  if (nextActionSelection?.reason) return nextActionSelection.reason;
  return 'operator_review_required';
}

function upsertTrackResult(existing = [], trackName, patch = {}) {
  const rows = asArray(existing).map((row) => ({ ...row }));
  const index = rows.findIndex((row) => row.track === trackName);
  const current = index >= 0 ? rows[index] : { track: trackName };
  const next = {
    ...current,
    ...patch,
    rawEvidenceCount: Number(current.rawEvidenceCount || 0) + Number(patch.rawEvidenceCountDelta || 0),
    acceptedEvidenceCount: Number(current.acceptedEvidenceCount || 0) + Number(patch.acceptedEvidenceCountDelta || 0),
  };
  delete next.rawEvidenceCountDelta;
  delete next.acceptedEvidenceCountDelta;
  if (index >= 0) rows[index] = next;
  else rows.push(next);
  return rows;
}

function buildEvidenceAfter(evidenceBefore = {}, actionResult = {}, args = {}) {
  const acceptedEvidence = asArray(actionResult.acceptedEvidence);
  const promotionEvidenceCount = acceptedEvidence.filter((row) => row.promotionEligible === true || row.evidenceUse === 'promotion_candidate').length;
  return {
    ...evidenceBefore,
    rawEvidenceCount: Number(evidenceBefore.rawEvidenceCount || 0) + Number(actionResult.rawEvidence?.length || 0),
    acceptedEvidenceCount: Number(evidenceBefore.acceptedEvidenceCount || 0) + acceptedEvidence.length,
    acceptedPromotionEvidenceCount: Number(evidenceBefore.acceptedPromotionEvidenceCount || 0) + promotionEvidenceCount,
    independentSourceBreadth: Math.max(
      Number(evidenceBefore.independentSourceBreadth || 0),
      sourceBreadthFromEvidence(acceptedEvidence),
    ),
    readinessChanged: Boolean(actionResult.gateImpact?.readinessChanged) && args.allowReadinessPromotion,
  };
}

function mergeEvidenceRows(existing = [], incoming = [], limit = 500) {
  const rows = [];
  const seen = new Set();
  for (const row of [...asArray(existing), ...asArray(incoming)]) {
    if (!row || typeof row !== 'object') continue;
    const id = compact(row.evidenceId || row.id || JSON.stringify(row).slice(0, 120));
    if (!id) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows.slice(Math.max(0, rows.length - limit));
}

function buildReadinessAfter(readinessBefore = {}, actionResult = {}, args = {}) {
  return {
    ...readinessBefore,
    reportCandidateAllowed: Boolean(actionResult.gateImpact?.reportCandidateAllowed),
    visualStatus: actionResult.gateImpact?.visualStatus || (['review-ready', 'decision-ready'].includes(readinessBefore.visualStatus) && !args.allowReadinessPromotion
      ? 'pending'
      : readinessBefore.visualStatus),
    finalBlocker: actionResult.gateImpact?.finalBlocker || readinessBefore.finalBlocker,
    blockers: actionResult.gateImpact?.blockers || readinessBefore.blockers || [],
  };
}

function mergeStateAfterAction(currentState = {}, actionSelection = {}, actionResult = {}, evidenceAfter = {}, readinessAfter = {}) {
  const acquisition = JSON.parse(JSON.stringify(currentState.acquisition || {}));
  acquisition.rawEvidenceCount = evidenceAfter.rawEvidenceCount;
  acquisition.acceptedEvidenceCount = evidenceAfter.acceptedEvidenceCount;
  acquisition.acceptedPromotionEvidenceCount = evidenceAfter.acceptedPromotionEvidenceCount;
  acquisition.independentSourceBreadth = evidenceAfter.independentSourceBreadth;
  acquisition.visualStatus = readinessAfter.visualStatus;
  acquisition.finalBlocker = readinessAfter.finalBlocker;
  acquisition.gateResult = {
    ...(acquisition.gateResult || {}),
    gate: readinessAfter.reportCandidateAllowed ? 'report_candidate_allowed' : 'blocked',
    blockers: readinessAfter.blockers || acquisition.gateResult?.blockers || [],
  };
  acquisition.rawEvidenceRows = mergeEvidenceRows(acquisition.rawEvidenceRows, actionResult.rawEvidence);
  acquisition.acceptedEvidenceRows = mergeEvidenceRows(acquisition.acceptedEvidenceRows, actionResult.acceptedEvidence);
  acquisition.independentSourceBreadth = Math.max(
    Number(acquisition.independentSourceBreadth || 0),
    sourceBreadthFromEvidence(acquisition.acceptedEvidenceRows),
  );
  const nextEvidenceAfter = {
    ...evidenceAfter,
    independentSourceBreadth: acquisition.independentSourceBreadth,
  };
  acquisition.repairLoopState = {
    ...(acquisition.repairLoopState || {}),
    lastAction: actionSelection.action,
    lastActionId: actionResult.actionId || null,
  };

  if (actionSelection.action === 'split_mechanism_and_issuer_tracks') {
    acquisition.routeMismatchDetected = true;
    acquisition.blockType = 'mechanism_issuer_route_mismatch';
    acquisition.splitTracks = actionResult.splitTracks || acquisition.splitTracks;
    acquisition.finalBlockerByTrack = {
      mechanismValidationTrack: acquisition.finalBlockerByTrack?.mechanismValidationTrack || 'track_a_mechanism_validation_missing',
      issuerBridgeTrack: acquisition.finalBlockerByTrack?.issuerBridgeTrack || 'issuer_bridge_missing',
    };
    acquisition.repairLoopState.splitCreated = true;
  }

  if (actionSelection.action === 'run_limited_grid_mechanism_validation') {
    acquisition.repairLoopState.gridMechanismAttempted = true;
    acquisition.finalBlockerByTrack = {
      ...(acquisition.finalBlockerByTrack || {}),
      mechanismValidationTrack: actionResult.acceptedEvidenceIds?.length
        ? 'issuer_bridge_required_after_mechanism_validation'
        : 'track_a_mechanism_validation_raw_only',
    };
    acquisition.splitTrackResults = upsertTrackResult(acquisition.splitTrackResults, 'mechanism_validation_track', {
      seedId: actionResult.seedId,
      acceptedEvidenceIds: actionResult.acceptedEvidenceIds,
      rawEvidenceIds: actionResult.rawEvidenceIds,
      finalBlocker: acquisition.finalBlockerByTrack.mechanismValidationTrack,
      rawEvidenceCountDelta: actionResult.rawEvidenceIds?.length || 0,
      acceptedEvidenceCountDelta: actionResult.acceptedEvidenceIds?.length || 0,
    });
  }

  if (actionSelection.action === 'run_limited_issuer_bridge_track' || actionSelection.action === 'run_limited_official_route') {
    acquisition.repairLoopState.issuerBridgeAttempted = true;
    acquisition.issuerBridgeCollectorVersion = actionResult.collectorVersion || acquisition.issuerBridgeCollectorVersion || null;
    acquisition.issuerBridgeStatus = actionResult.issuerBridgeStatus || acquisition.issuerBridgeStatus || 'missing';
    acquisition.trackBIssuerBridgeStatus = actionResult.issuerBridgeStatus || acquisition.trackBIssuerBridgeStatus || null;
    acquisition.trackBAcceptedIssuerEvidenceCount = actionResult.acceptedIssuerEvidenceCount || 0;
    acquisition.trackBAcceptedPromotionEvidenceCount = actionResult.acceptedPromotionEvidenceCount || 0;
    acquisition.trackBIssuerCandidates = actionResult.issuerCandidates || [];
    acquisition.trackBIssuerRoleClasses = actionResult.issuerRoleClasses || [];
    acquisition.trackBMatchedExposureTerms = actionResult.matchedExposureTerms || [];
    acquisition.trackBMatchedOperatingTerms = actionResult.matchedOperatingTerms || [];
    acquisition.finalBlockerByTrack = {
      ...(acquisition.finalBlockerByTrack || {}),
      issuerBridgeTrack: actionResult.acceptedEvidenceIds?.length
        ? 'negative_control_not_closed'
        : 'issuer_bridge_missing',
    };
    acquisition.splitTrackResults = upsertTrackResult(acquisition.splitTrackResults, 'issuer_bridge_track', {
      seedId: actionResult.seedId,
      acceptedEvidenceIds: actionResult.acceptedEvidenceIds,
      rawEvidenceIds: actionResult.rawEvidenceIds,
      finalBlocker: acquisition.finalBlockerByTrack.issuerBridgeTrack,
      issuerBridgeStatus: actionResult.issuerBridgeStatus,
      acceptedPromotionEvidenceCount: actionResult.acceptedPromotionEvidenceCount,
      sourceGroupsUsed: actionResult.sourceGroupsUsed,
      sourceFamiliesUsed: actionResult.sourceFamiliesUsed,
      issuerCandidates: actionResult.issuerCandidates,
      issuerRoleClasses: actionResult.issuerRoleClasses,
      matchedExposureTerms: actionResult.matchedExposureTerms,
      matchedOperatingTerms: actionResult.matchedOperatingTerms,
      rawEvidenceCountDelta: actionResult.rawEvidenceIds?.length || 0,
      acceptedEvidenceCountDelta: actionResult.acceptedEvidenceIds?.length || 0,
    });
    const combinedPromotionRows = asArray(acquisition.acceptedEvidenceRows)
      .filter((row) => row.promotionEligible === true || row.evidenceUse === 'promotion_candidate');
    const combinedPromotionBreadth = sourceBreadthFromEvidence(combinedPromotionRows);
    if (combinedPromotionRows.length >= 1 && combinedPromotionBreadth >= 2) {
      acquisition.issuerBridgeStatus = 'closed';
      acquisition.trackBIssuerBridgeStatus = 'closed';
      acquisition.trackBAcceptedIssuerEvidenceCount = combinedPromotionRows.length;
      acquisition.trackBAcceptedPromotionEvidenceCount = combinedPromotionRows.length;
      acquisition.finalBlockerByTrack = {
        ...(acquisition.finalBlockerByTrack || {}),
        issuerBridgeTrack: 'negative_control_not_closed',
      };
      acquisition.splitTrackResults = upsertTrackResult(acquisition.splitTrackResults, 'issuer_bridge_track', {
        seedId: actionResult.seedId,
        issuerBridgeStatus: 'closed',
        acceptedEvidenceIds: combinedPromotionRows.map((row) => row.evidenceId).filter(Boolean),
        acceptedPromotionEvidenceCount: combinedPromotionRows.length,
        independentSourceBreadth: combinedPromotionBreadth,
        finalBlocker: 'negative_control_not_closed',
      });
    }
  }

  if (actionSelection.action === 'run_limited_negative_control') {
    acquisition.repairLoopState.negativeControlAttempted = true;
    acquisition.negativeControlCollectorVersion = actionResult.collectorVersion || acquisition.negativeControlCollectorVersion || null;
    acquisition.negativeControlStatus = actionResult.negativeControlStatus || acquisition.negativeControlStatus || 'INCONCLUSIVE';
    acquisition.negativeControlScope = actionResult.negativeControlScope || acquisition.negativeControlScope || 'insufficient';
    if (['SURVIVED', 'CHECKED_NO_DIRECT'].includes(acquisition.negativeControlStatus) && acquisition.holdoutConfirmed !== true) {
      acquisition.holdoutConfirmed = false;
    }
    acquisition.trackBNegativeControlStatus = acquisition.negativeControlStatus;
    acquisition.trackBNegativeControlScope = acquisition.negativeControlScope;
    acquisition.trackBCheckedIssuerCount = actionResult.checkedIssuerCount || 0;
    acquisition.trackBCheckedSourceGroupCount = actionResult.checkedSourceGroupCount || 0;
    acquisition.trackBCheckedQueryFamilyCount = actionResult.checkedQueryFamilyCount || 0;
    acquisition.trackBDirectInvalidatorFound = Boolean(actionResult.directInvalidatorFound);
    acquisition.trackBWeakRiskSignalCount = actionResult.weakRiskSignalCount || 0;
    acquisition.trackBAcceptedNegativeControlEvidenceCount = actionResult.acceptedEvidenceIds?.length || 0;
    acquisition.trackBNegativeControlEvidenceIds = actionResult.acceptedEvidenceIds || [];
    acquisition.trackBNegativeSourceGroupsUsed = actionResult.sourceGroupsUsed || [];
    acquisition.finalBlockerByTrack = {
      ...(acquisition.finalBlockerByTrack || {}),
      issuerBridgeTrack: ['SURVIVED', 'CHECKED_NO_DIRECT'].includes(acquisition.negativeControlStatus)
        ? 'holdout_missing'
        : 'negative_control_not_closed',
    };
    if (acquisition.splitTracks?.issuerBridgeTrack) {
      acquisition.splitTracks.issuerBridgeTrack = {
        ...acquisition.splitTracks.issuerBridgeTrack,
        negativeControlStatus: acquisition.negativeControlStatus,
        negativeControlScope: acquisition.negativeControlScope,
        finalBlocker: acquisition.finalBlockerByTrack.issuerBridgeTrack,
      };
    }
  }

  if (actionSelection.action === 'run_limited_holdout_validation') {
    acquisition.repairLoopState.holdoutAttempted = true;
    acquisition.holdoutConfirmed = Boolean(actionResult.holdoutConfirmed);
    acquisition.trackBHoldoutStatus = actionResult.holdoutStatus || (acquisition.holdoutConfirmed ? 'CONFIRMED' : 'INCONCLUSIVE');
    acquisition.trackBHoldoutConfirmed = acquisition.holdoutConfirmed;
    acquisition.trackBHoldoutCollectorVersion = actionResult.collectorVersion || acquisition.trackBHoldoutCollectorVersion || null;
    acquisition.trackBHoldoutSourceGroups = actionResult.sourceGroupsUsed || [];
    acquisition.trackBHoldoutSourceFamilies = actionResult.sourceFamiliesUsed || [];
    acquisition.trackBHoldoutMatchedExposureTerms = actionResult.matchedExposureTerms || [];
    acquisition.trackBHoldoutMatchedDemandTerms = actionResult.matchedDemandTerms || [];
    acquisition.trackBHoldoutContradictionFound = Boolean(actionResult.contradictionFound);
    acquisition.trackBHoldoutContradictionCount = actionResult.contradictionCount || 0;
    acquisition.trackBAcceptedHoldoutEvidenceCount = actionResult.acceptedHoldoutEvidenceCount || actionResult.acceptedEvidenceIds?.length || 0;
    acquisition.trackBHoldoutEvidenceIds = actionResult.acceptedEvidenceIds || [];
    acquisition.finalBlockerByTrack = {
      ...(acquisition.finalBlockerByTrack || {}),
      issuerBridgeTrack: actionResult.holdoutStatus === 'CONTRADICTED'
        ? 'holdout_contradicted'
        : acquisition.holdoutConfirmed
          ? 'market_validation_missing'
          : 'holdout_missing',
    };
    if (acquisition.splitTracks?.issuerBridgeTrack) {
      acquisition.splitTracks.issuerBridgeTrack = {
        ...acquisition.splitTracks.issuerBridgeTrack,
        holdoutConfirmed: acquisition.holdoutConfirmed,
        holdoutStatus: acquisition.trackBHoldoutStatus,
        finalBlocker: acquisition.finalBlockerByTrack.issuerBridgeTrack,
      };
    }
    acquisition.splitTrackResults = upsertTrackResult(acquisition.splitTrackResults, 'issuer_bridge_track', {
      seedId: actionResult.seedId,
      acceptedEvidenceIds: actionResult.acceptedEvidenceIds,
      rawEvidenceIds: actionResult.rawEvidenceIds,
      finalBlocker: acquisition.finalBlockerByTrack.issuerBridgeTrack,
      holdoutStatus: acquisition.trackBHoldoutStatus,
      holdoutConfirmed: acquisition.holdoutConfirmed,
      sourceGroupsUsed: actionResult.sourceGroupsUsed,
      sourceFamiliesUsed: actionResult.sourceFamiliesUsed,
      matchedExposureTerms: actionResult.matchedExposureTerms,
      matchedDemandTerms: actionResult.matchedDemandTerms,
      contradictionFound: actionResult.contradictionFound,
      rawEvidenceCountDelta: actionResult.rawEvidenceIds?.length || 0,
      acceptedEvidenceCountDelta: actionResult.acceptedEvidenceIds?.length || 0,
    });
  }

  if (actionSelection.action === 'run_limited_controlled_market_validation') {
    acquisition.repairLoopState.marketValidationAttempted = true;
    acquisition.marketValidationStatus = actionResult.marketValidationStatus || acquisition.marketValidationStatus || 'missing';
    acquisition.marketValidationWindowResults = actionResult.marketValidationWindowResults || [];
    acquisition.marketValidationBenchmarkUsed = actionResult.marketValidationBenchmarkUsed || null;
    acquisition.marketValidationSectorBenchmarkUsed = actionResult.marketValidationSectorBenchmarkUsed || null;
    acquisition.marketValidationControlUsed = Boolean(actionResult.marketValidationControlUsed);
    acquisition.marketValidationSampleSize = Number(actionResult.marketValidationSampleSize || 0);
    acquisition.marketValidationDirection = actionResult.marketValidationDirection || null;
    acquisition.marketValidationCaveats = actionResult.marketValidationCaveats || [];
    acquisition.marketValidationWarnings = actionResult.marketValidationWarnings || [];
    acquisition.marketValidationEventAnchorCount = Number(actionResult.eventAnchorCount || 0);
    acquisition.reportCandidateAllowedDiagnostic = Boolean(actionResult.reportCandidateAllowedDiagnostic);
    acquisition.evidenceContractClosureDryRun = Boolean(actionResult.evidenceContractClosureDryRun);
    acquisition.reportSubjectDryRun = Boolean(actionResult.reportSubjectDryRun);
    acquisition.marketValidationEvidenceIds = actionResult.acceptedEvidenceIds || [];
    acquisition.finalBlockerByTrack = {
      ...(acquisition.finalBlockerByTrack || {}),
      issuerBridgeTrack: actionResult.reportCandidateAllowedDiagnostic
        ? 'evidence_contract_closure_dry_run_required'
        : actionResult.gateImpact?.finalBlocker || 'market_validation_missing',
    };
  }

  if (actionSelection.action === 'evidence_contract_closure_dry_run') {
    acquisition.evidenceContractClosureDryRun = true;
    acquisition.evidenceContractClosureStatus = actionResult.closureStatus || 'closure_blocked';
    acquisition.evidenceContractMatrix = actionResult.evidenceContractMatrix || [];
    acquisition.evidenceContractMatrixSummary = actionResult.evidenceContractMatrixSummary || [];
    acquisition.dryRunReportSubject = actionResult.dryRunReportSubject || null;
    acquisition.reportSubjectDryRun = actionResult.reportSubjectDryRun || null;
    acquisition.closureCaveats = actionResult.caveats || [];
    acquisition.closureContradictionWarnings = actionResult.contradictionWarnings || [];
    acquisition.reportCandidateAllowedDiagnostic = Boolean(actionResult.reportCandidateAllowedDiagnostic);
    acquisition.finalBlocker = actionResult.gateImpact?.finalBlocker || acquisition.finalBlocker;
  }

  if (actionSelection.action === 'thesis_validation_memo_dry_run') {
    acquisition.thesisValidationMemoDryRunStatus = actionResult.thesisValidationMemoDryRunStatus || 'validator_failed';
    acquisition.thesisValidationMemoDryRun = actionResult.thesisValidationMemoDryRun || null;
    acquisition.thesisValidationMemoValidation = actionResult.thesisValidationMemoValidation || null;
    acquisition.memoType = actionResult.memoType || 'thesis_validation_memo';
    acquisition.memoDecisionUse = actionResult.memoDecisionUse || 'research_validation';
    acquisition.notDecisionReady = actionResult.notDecisionReady !== false;
    acquisition.investmentMemoReady = false;
    acquisition.decisionReady = false;
    acquisition.portfolioActionAllowed = false;
    acquisition.clientMemoPath = actionResult.clientMemoPath || null;
    acquisition.clientMemoHtmlPath = actionResult.clientMemoHtmlPath || null;
    acquisition.auditAppendixPath = actionResult.auditAppendixPath || null;
    acquisition.thesisValidationMemoCaveats = actionResult.caveats || [];
    acquisition.thesisValidationMemoRemainingBlockers = actionResult.remainingBlockers || [];
    acquisition.finalBlocker = actionResult.gateImpact?.finalBlocker || acquisition.finalBlocker;
  }

  if (actionSelection.action === 'valuation_expectation_bridge_dry_run') {
    acquisition.valuationExpectationBridgeDryRunStatus = actionResult.valuationExpectationBridgeDryRunStatus || 'validator_failed';
    acquisition.valuationExpectationBridgeDryRun = actionResult.valuationExpectationBridgeDryRun || null;
    acquisition.valuationBridgeStatus = actionResult.valuationBridgeStatus || 'valuation_bridge_missing';
    acquisition.expectationBridgeStatus = actionResult.expectationBridgeStatus || 'expectation_bridge_missing';
    acquisition.issuerValuationBridgeTable = actionResult.issuerValuationBridgeTable || [];
    acquisition.missingValuationFields = actionResult.missingValuationFields || [];
    acquisition.remainingCaveats = actionResult.caveats || [];
    acquisition.localValuationCacheRowCount = actionResult.localValuationCacheRowCount || 0;
    acquisition.localValuationCacheMissingIssuers = actionResult.localValuationCacheMissingIssuers || [];
    acquisition.localValuationCacheRejectedRows = actionResult.localValuationCacheRejectedRows || 0;
    acquisition.marketRegimeSupport = actionResult.marketRegimeSupport || null;
    acquisition.marketValidationRegimeStatus = actionResult.marketValidationRegimeStatus || 'regime_missing';
    acquisition.regimeConsistencyScore = Number(actionResult.regimeConsistencyScore || 0);
    acquisition.extremeTstatWarning = Boolean(actionResult.extremeTstatWarning);
    acquisition.investmentMemoReadinessDiagnostic = actionResult.investmentMemoReadinessDiagnostic || null;
    acquisition.readyForHumanInvestmentMemoReview = Boolean(actionResult.readyForHumanInvestmentMemoReview);
    acquisition.investmentMemoReady = false;
    acquisition.decisionReady = false;
    acquisition.portfolioActionAllowed = false;
    acquisition.valuationBridgePath = actionResult.valuationBridgePath || null;
    acquisition.marketRegimeSupportPath = actionResult.marketRegimeSupportPath || null;
    acquisition.clientMemoPath = actionResult.clientMemoPath || acquisition.clientMemoPath || null;
    acquisition.clientMemoHtmlPath = actionResult.clientMemoHtmlPath || acquisition.clientMemoHtmlPath || null;
    acquisition.auditAppendixPath = actionResult.auditAppendixPath || acquisition.auditAppendixPath || null;
    acquisition.evidenceContractMatrix = actionResult.updatedEvidenceContractMatrix || acquisition.evidenceContractMatrix || [];
    acquisition.evidenceContractMatrixSummary = (actionResult.updatedEvidenceContractMatrix || acquisition.evidenceContractMatrixSummary || []).map((row) => ({
      evidenceClass: row.evidenceClass,
      status: row.status,
      acceptedCount: row.acceptedCount,
      promotionEligibleCount: row.promotionEligibleCount,
      blocking: row.blocking || row.blockingForInvestmentReadiness || false,
      caveats: row.caveats || [],
      nextActionIfMissing: row.nextActionIfMissing,
    }));
    acquisition.finalBlocker = actionResult.gateImpact?.finalBlocker || acquisition.finalBlocker;
  }

  if (actionSelection.action === 'market_validation_regime_support_repair' || actionSelection.action === 'repair_controlled_market_validation_regime_support') {
    acquisition.repairLoopState.marketRegimeSupportRepairAttempted = true;
    acquisition.marketRegimeSupport = actionResult.marketRegimeSupport || null;
    acquisition.marketValidationRegimeStatus = actionResult.marketValidationRegimeStatus || 'regime_missing';
    acquisition.regimeConsistencyScore = actionResult.regimeConsistencyScore ?? 'not_computable';
    acquisition.regimeCoverageScore = actionResult.regimeCoverageScore ?? 'not_computable';
    acquisition.eventCountByRegime = actionResult.eventCountByRegime || {};
    acquisition.directionSupportByRegime = actionResult.directionSupportByRegime || {};
    acquisition.unknownRegimeShare = actionResult.unknownRegimeShare ?? null;
    acquisition.extremeTstatWarning = Boolean(actionResult.extremeTstatWarning);
    acquisition.tstatSanityStatus = actionResult.tstatSanityStatus || 'not_computable';
    acquisition.marketValidationResearchUseAllowed = Boolean(actionResult.marketValidationResearchUseAllowed);
    acquisition.marketValidationInvestmentUseAllowed = Boolean(actionResult.marketValidationInvestmentUseAllowed);
    acquisition.marketValidationDecisionUseAllowed = false;
    acquisition.investmentMemoReadinessDiagnostic = actionResult.investmentMemoReadinessDiagnostic || null;
    acquisition.readyForHumanInvestmentMemoReview = Boolean(actionResult.readyForHumanInvestmentMemoReview);
    acquisition.investmentMemoReady = false;
    acquisition.decisionReady = false;
    acquisition.portfolioActionAllowed = false;
    acquisition.remainingCaveats = uniqueStrings([acquisition.remainingCaveats, actionResult.caveats], 80);
    acquisition.evidenceContractMatrix = actionResult.updatedEvidenceContractMatrix || acquisition.evidenceContractMatrix || [];
    acquisition.evidenceContractMatrixSummary = (actionResult.updatedEvidenceContractMatrix || acquisition.evidenceContractMatrixSummary || []).map((row) => ({
      evidenceClass: row.evidenceClass,
      status: row.status,
      acceptedCount: row.acceptedCount,
      promotionEligibleCount: row.promotionEligibleCount,
      blocking: row.blocking || row.blockingForInvestmentReadiness || false,
      caveats: row.caveats || [],
      nextActionIfMissing: row.nextActionIfMissing,
      regimeSupportStatus: row.regimeSupportStatus,
      regimeConsistencyScore: row.regimeConsistencyScore,
      regimeCoverageScore: row.regimeCoverageScore,
      marketValidationResearchUseAllowed: row.marketValidationResearchUseAllowed,
      marketValidationInvestmentUseAllowed: row.marketValidationInvestmentUseAllowed,
      marketValidationDecisionUseAllowed: row.marketValidationDecisionUseAllowed,
      extremeTstatWarning: row.extremeTstatWarning,
      tstatSanityStatus: row.tstatSanityStatus,
    }));
    acquisition.finalBlocker = actionResult.gateImpact?.finalBlocker || acquisition.finalBlocker;
  }

  if (actionSelection.action === 'final_investment_report_dry_run') {
    acquisition.finalInvestmentReportDryRunStatus = actionResult.finalInvestmentReportDryRunStatus || 'failed';
    acquisition.finalInvestmentReportDryRun = actionResult.finalInvestmentReportDryRun || null;
    acquisition.finalInvestmentReportValidation = actionResult.finalInvestmentReportValidation || null;
    acquisition.validatorStatus = actionResult.validatorStatus || 'failed';
    acquisition.memoType = actionResult.memoType || 'investment_memo_dry_run';
    acquisition.memoDecisionUse = actionResult.memoDecisionUse || actionResult.decisionUse || 'human_review_required';
    acquisition.decisionUse = acquisition.memoDecisionUse;
    acquisition.notDecisionReady = true;
    acquisition.investmentMemoReady = false;
    acquisition.decisionReady = false;
    acquisition.portfolioActionAllowed = false;
    acquisition.clientMemoPath = actionResult.clientMemoPath || acquisition.clientMemoPath || null;
    acquisition.clientMemoHtmlPath = actionResult.clientMemoHtmlPath || acquisition.clientMemoHtmlPath || null;
    acquisition.auditAppendixPath = actionResult.auditAppendixPath || acquisition.auditAppendixPath || null;
    acquisition.remainingCaveats = uniqueStrings([acquisition.remainingCaveats, actionResult.remainingCaveats], 100);
    acquisition.finalStopReason = actionResult.finalStopReason || 'operator_review_required';
    acquisition.finalBlocker = actionResult.gateImpact?.finalBlocker || acquisition.finalBlocker;
  }

  return {
    ...currentState,
    acquisition,
    evidenceBefore: nextEvidenceAfter,
    readinessBefore: readinessAfter,
  };
}

function progressFromIteration({
  beforeSnapshot = {},
  afterSnapshot = {},
  blockerBefore = '',
  blockerAfter = '',
  actionSelection = {},
  actionResult = {},
  nextActionBefore = '',
  nextActionAfter = '',
} = {}) {
  const weakReasons = [];
  const strongReasons = [];
  if (Number(afterSnapshot.rawEvidenceCount || 0) > Number(beforeSnapshot.rawEvidenceCount || 0)) weakReasons.push('raw_evidence_increased');
  if (Number(afterSnapshot.acceptedEvidenceCount || 0) > Number(beforeSnapshot.acceptedEvidenceCount || 0)) strongReasons.push('accepted_evidence_increased');
  if (Number(afterSnapshot.acceptedPromotionEvidenceCount || 0) > Number(beforeSnapshot.acceptedPromotionEvidenceCount || 0)) strongReasons.push('accepted_promotion_evidence_increased');
  if (blockerAfter && blockerAfter !== blockerBefore) {
    if (/raw_only|accepted_evidence_missing/i.test(String(blockerAfter))) weakReasons.push('blocker_changed_to_raw_or_missing_state');
    else strongReasons.push('blocker_changed_or_more_specific');
  }
  if (asArray(actionResult.proposals).length > 0) strongReasons.push('provider_gap_artifact_created');
  if (actionResult.splitTracks) strongReasons.push('route_mismatch_split_created');
  if (actionSelection.action === 'market_validation_regime_support_repair' && actionResult.marketRegimeSupport) {
    strongReasons.push('market_regime_support_diagnostic_completed');
  }
  if (actionSelection.action === 'final_investment_report_dry_run' && actionResult.finalInvestmentReportDryRun) {
    strongReasons.push('final_investment_report_dry_run_generated');
  }
  for (const field of ['negativeControlStatus', 'holdoutConfirmed', 'issuerBridgeStatus', 'marketValidationStatus', 'valuationBridgeStatus', 'expectationBridgeStatus', 'marketValidationRegimeStatus', 'finalInvestmentReportDryRunStatus']) {
    if (afterSnapshot[field] !== beforeSnapshot[field]) {
      const value = String(afterSnapshot[field]);
      if (/missing|false|null|undefined/i.test(value)) weakReasons.push(`${field}_unchanged_or_negative`);
      else strongReasons.push(`${field}_changed`);
    }
  }
  if (nextActionAfter && nextActionAfter !== nextActionBefore) weakReasons.push('next_recommended_action_changed');
  const weakProgress = weakReasons.length > 0;
  const strongProgress = strongReasons.length > 0;
  return {
    progressMade: strongProgress,
    weakProgress,
    strongProgress,
    weakProgressReasons: uniqueStrings(weakReasons, 12),
    strongProgressReasons: uniqueStrings(strongReasons, 12),
    progressReasons: uniqueStrings([...strongReasons, ...weakReasons], 12),
    signature: actionSignature(actionSelection, actionResult),
  };
}

function stopReasonFor(actionSelection = {}, actionResult = {}) {
  if (actionSelection.action === 'operator_review_required') return 'operator_review_required';
  if (actionResult?.unsafeActionBlocked) return 'unsafe_action_blocked';
  if (actionResult?.operatorReviewRequired) return 'operator_review_required';
  if (actionSelection.action === 'create_provider_gap_proposal') return 'provider_gap_proposal_created_review_required';
  if (actionSelection.action === 'split_mechanism_and_issuer_tracks') return 'route_mismatch_split_created_or_confirmed';
  if (actionResult?.executed && actionSelection.action === 'run_limited_negative_control') return 'negative_control_executed_bounded';
  if (actionResult?.executed && actionSelection.action === 'run_limited_grid_mechanism_validation') return 'grid_mechanism_validation_executed_bounded';
  if (actionResult?.executed && (actionSelection.action === 'run_limited_issuer_bridge_track' || actionSelection.action === 'run_limited_official_route')) return 'issuer_bridge_track_executed_bounded';
  if (actionResult?.executed && actionSelection.action === 'run_limited_holdout_validation') return 'holdout_validation_executed_bounded';
  if (actionResult?.executed && actionSelection.action === 'run_limited_controlled_market_validation') return 'controlled_market_validation_executed_bounded';
  if (actionResult?.executed && actionSelection.action === 'evidence_contract_closure_dry_run') return 'evidence_contract_closure_dry_run_completed';
  if (actionResult?.executed && actionSelection.action === 'thesis_validation_memo_dry_run') return 'thesis_validation_memo_dry_run_completed';
  if (actionResult?.executed && actionSelection.action === 'valuation_expectation_bridge_dry_run') return 'valuation_expectation_bridge_dry_run_completed';
  if (actionResult?.executed && actionSelection.action === 'market_validation_regime_support_repair') return 'market_validation_regime_support_repair_completed';
  if (actionResult?.executed && actionSelection.action === 'final_investment_report_dry_run') return actionResult.finalStopReason || 'final_investment_report_dry_run_completed';
  if (actionResult?.executionDeferred) return 'bounded_action_selected_requires_explicit_execution';
  return 'safe_action_completed';
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}

async function writeThesisValidationMemoArtifacts(actionResult = {}, artifactRoot = DEFAULT_ARTIFACT_ROOT) {
  const memo = actionResult.thesisValidationMemoDryRun;
  if (!memo) return null;
  const root = path.resolve(artifactRoot || DEFAULT_ARTIFACT_ROOT);
  const jsonPath = actionResult.clientMemoPath || path.join(root, 'thesis-validation-memo-dry-run.latest.json');
  const htmlPath = actionResult.clientMemoHtmlPath || path.join(root, 'thesis-validation-memo-dry-run.html');
  const auditPath = actionResult.auditAppendixPath || path.join(root, 'thesis-validation-memo-audit-appendix.latest.json');
  await writeJson(jsonPath, memo);
  await writeFile(htmlPath, renderThesisValidationMemoHtml(memo), 'utf8');
  await writeJson(auditPath, memo.auditAppendix || {});
  return {
    clientMemoPath: path.resolve(jsonPath),
    clientMemoHtmlPath: path.resolve(htmlPath),
    auditAppendixPath: path.resolve(auditPath),
  };
}

async function writeValuationExpectationBridgeArtifacts(actionResult = {}, artifactRoot = DEFAULT_ARTIFACT_ROOT) {
  const bridge = actionResult.valuationExpectationBridgeDryRun;
  if (!bridge) return null;
  const root = path.resolve(artifactRoot || DEFAULT_ARTIFACT_ROOT);
  const valuationBridgePath = actionResult.valuationBridgePath || path.join(root, 'valuation-expectation-bridge-dry-run.latest.json');
  const marketRegimeSupportPath = actionResult.marketRegimeSupportPath || path.join(root, 'market-validation-regime-support.latest.json');
  await writeJson(valuationBridgePath, bridge);
  await writeJson(marketRegimeSupportPath, bridge.marketRegimeSupport || {});
  if (actionResult.updatedThesisValidationMemoDryRun) {
    const clientMemoPath = actionResult.clientMemoPath || path.join(root, 'thesis-validation-memo-dry-run.latest.json');
    const clientMemoHtmlPath = actionResult.clientMemoHtmlPath || path.join(root, 'thesis-validation-memo-dry-run.html');
    const auditAppendixPath = actionResult.auditAppendixPath || path.join(root, 'thesis-validation-memo-audit-appendix.latest.json');
    await writeJson(clientMemoPath, actionResult.updatedThesisValidationMemoDryRun);
    await writeFile(clientMemoHtmlPath, renderThesisValidationMemoHtml(actionResult.updatedThesisValidationMemoDryRun), 'utf8');
    await writeJson(auditAppendixPath, actionResult.updatedThesisValidationMemoDryRun.auditAppendix || {});
    return {
      valuationBridgePath: path.resolve(valuationBridgePath),
      marketRegimeSupportPath: path.resolve(marketRegimeSupportPath),
      clientMemoPath: path.resolve(clientMemoPath),
      clientMemoHtmlPath: path.resolve(clientMemoHtmlPath),
      auditAppendixPath: path.resolve(auditAppendixPath),
    };
  }
  return {
    valuationBridgePath: path.resolve(valuationBridgePath),
    marketRegimeSupportPath: path.resolve(marketRegimeSupportPath),
  };
}

async function writeFinalInvestmentReportArtifacts(actionResult = {}, artifactRoot = DEFAULT_ARTIFACT_ROOT) {
  const report = actionResult.finalInvestmentReportDryRun;
  if (!report) return null;
  const root = path.resolve(artifactRoot || DEFAULT_ARTIFACT_ROOT);
  const jsonPath = actionResult.clientMemoPath || path.join(root, 'final-investment-report-dry-run.latest.json');
  const htmlPath = actionResult.clientMemoHtmlPath || path.join(root, 'final-investment-report-dry-run.html');
  const auditPath = actionResult.auditAppendixPath || path.join(root, 'final-investment-report-audit-appendix.latest.json');
  await writeJson(jsonPath, report);
  await writeFile(htmlPath, renderFinalInvestmentReportHtml(report), 'utf8');
  await writeJson(auditPath, report.auditAppendix || {});
  return {
    clientMemoPath: path.resolve(jsonPath),
    clientMemoHtmlPath: path.resolve(htmlPath),
    auditAppendixPath: path.resolve(auditPath),
  };
}

export async function runAutonomousResearchRepairLoop(options = {}) {
  const args = {
    ...parseAutonomousResearchRepairLoopArgs([]),
    ...options,
  };
  args.allowProviderActivation = false;
  args.allowReadinessPromotion = false;
  args.allowReportCandidateWrite = false;
  if (!Object.prototype.hasOwnProperty.call(options, 'stopAfterAction')) args.stopAfterAction = args.mode === 'plan';
  if (!Object.prototype.hasOwnProperty.call(options, 'continueSafe')) args.continueSafe = args.mode !== 'plan';
  if (args.mode === 'plan') args.continueSafe = false;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const inputState = options.inputState || await loadAutonomousRepairInputState(args);
  const iterations = [];
  let currentState = inputState;
  let stopReason = 'max_iterations_reached';
  const externalTestResults = options.testResults || null;
  const noProgressSignatures = new Set();
  for (let index = 0; index < args.maxIterations; index += 1) {
    const classification = classifyCurrentResearchBlocker(currentState);
    const actionSelection = chooseNextAllowedAction(classification, currentState, args);
    const evidenceBefore = currentState.evidenceBefore || evidenceCountsFromArtifact(currentState.acquisition || {});
    const readinessBefore = currentState.readinessBefore || readinessFromArtifact(currentState.acquisition || {});
    const beforeSnapshot = statusSnapshot(currentState, evidenceBefore, readinessBefore);
    const actionResult = externalTestResults?.failed > 0 && args.stopOnTestFailure
      ? {
        ok: false,
        operatorReviewRequired: true,
        unsafeActionBlocked: true,
        reason: 'previous focused tests failed; stop-on-test-failure is enabled',
        boundaries: zeroBoundaries(),
        reportCandidateAllowed: false,
        readinessChanged: false,
      }
      : executeSelectedRepairAction(actionSelection, currentState, { ...args, generatedAt });
    const evidenceAfter = buildEvidenceAfter(evidenceBefore, actionResult, args);
    const readinessAfter = buildReadinessAfter(readinessBefore, actionResult, args);
    const nextState = mergeStateAfterAction(currentState, actionSelection, actionResult, evidenceAfter, readinessAfter);
    const effectiveEvidenceAfter = nextState.evidenceBefore || evidenceAfter;
    const nextClassification = classifyCurrentResearchBlocker(nextState);
    const nextActionSelection = chooseNextAllowedAction(nextClassification, nextState, args);
    const afterSnapshot = statusSnapshot(nextState, effectiveEvidenceAfter, readinessAfter);
    const blockerAfter = blockerAfterAction(actionSelection, actionResult, nextClassification);
    const nextRecommendedAction = nextRecommendedActionFor(actionSelection, actionResult, nextActionSelection);
    const progress = progressFromIteration({
      beforeSnapshot,
      afterSnapshot,
      blockerBefore: classification.primaryBlocker,
      blockerAfter,
      actionSelection,
      actionResult,
      nextActionBefore: actionSelection.action,
      nextActionAfter: typeof nextRecommendedAction === 'string' ? nextRecommendedAction : nextActionSelection.action,
    });
    const mutationBoundaryWrites = boundaryWrites(actionResult.boundaries || zeroBoundaries());
    const iteration = {
      iteration: index + 1,
      inputState: {
        diagnosticsPath: currentState.diagnosticsPath || null,
        acquisitionPath: currentState.acquisitionPath || null,
        providerBlockedPath: currentState.providerBlockedPath || null,
        selectedSeed: currentState.selectedSeed || null,
      },
      blockerBefore: classification.primaryBlocker,
      topLevelBlocker: classification.topLevelBlocker || classification.primaryBlocker,
      trackLevelBlocker: classification.trackLevelBlocker || null,
      blockerDetails: classification,
      selectedAction: actionSelection.action,
      actionReason: actionSelection.reason,
      actionPriorityRank: actionSelection.actionPriorityRank || ACTION_PRIORITY_RANKS[actionSelection.action] || 99,
      actionSkippedReasons: actionSelection.actionSkippedReasons || [],
      whyMarketValidationAllowed: actionSelection.whyMarketValidationAllowed || marketValidationAllowedState(currentState, evidenceBefore),
      whyHoldoutValidationAllowed: actionSelection.whyHoldoutValidationAllowed || holdoutValidationAllowedState(currentState, evidenceBefore),
      actionScope: {
        maxSeeds: args.maxSeeds,
        maxTracks: args.maxTracks,
        maxQueries: args.maxQueries,
        selectedSeed: currentState.selectedSeed?.seedId || currentState.selectedSeed?.childSeedId || currentState.acquisition?.seedId || null,
        trackId: actionResult.trackId || null,
        evidenceClass: actionResult.evidenceClass || actionResult.task?.evidenceClass || null,
      },
      actionResult,
      filesChanged: [],
      commandsRun: [],
      testsRun: [],
      testResults: externalTestResults || {
        executedByLoop: false,
        passed: null,
        failed: null,
        reason: 'tests are executed by the outer Codex run; loop records selected action artifact only',
      },
      rawEvidenceBefore: beforeSnapshot.rawEvidenceCount,
      rawEvidenceAfter: afterSnapshot.rawEvidenceCount,
      acceptedEvidenceBefore: beforeSnapshot.acceptedEvidenceCount,
      acceptedEvidenceAfter: afterSnapshot.acceptedEvidenceCount,
      acceptedPromotionEvidenceBefore: beforeSnapshot.acceptedPromotionEvidenceCount,
      acceptedPromotionEvidenceAfter: afterSnapshot.acceptedPromotionEvidenceCount,
      negativeControlBefore: beforeSnapshot.negativeControlStatus,
      negativeControlAfter: afterSnapshot.negativeControlStatus,
      holdoutBefore: beforeSnapshot.holdoutConfirmed,
      holdoutAfter: afterSnapshot.holdoutConfirmed,
      issuerBridgeBefore: beforeSnapshot.issuerBridgeStatus,
      issuerBridgeAfter: afterSnapshot.issuerBridgeStatus,
      marketValidationBefore: beforeSnapshot.marketValidationStatus,
      marketValidationAfter: afterSnapshot.marketValidationStatus,
      evidenceCountsBefore: evidenceBefore,
      evidenceCountsAfter: effectiveEvidenceAfter,
      readinessBefore,
      readinessAfter,
      mutationBoundaries: actionResult.boundaries || zeroBoundaries(),
      blockerAfter,
      progressMade: progress.progressMade,
      weakProgress: progress.weakProgress,
      strongProgress: progress.strongProgress,
      weakProgressReasons: progress.weakProgressReasons,
      strongProgressReasons: progress.strongProgressReasons,
      progressReasons: progress.progressReasons,
      nextAction: nextActionSelection.action,
      nextRecommendedAction,
      stopReason: stopReasonFor(actionSelection, actionResult),
    };
    if (externalTestResults?.failed > 0 && args.stopOnTestFailure) iteration.stopReason = 'tests_failed';
    iterations.push(iteration);
    stopReason = iteration.stopReason;

    if (externalTestResults?.failed > 0 && args.stopOnTestFailure) {
      stopReason = 'tests_failed';
      iteration.stopReason = stopReason;
      break;
    }
    if (mutationBoundaryWrites > 0) {
      stopReason = 'unsafe_mutation_boundary_write_detected';
      iteration.stopReason = stopReason;
      break;
    }
    if (actionResult.unsafeActionBlocked) {
      stopReason = 'unsafe_action_blocked';
      iteration.stopReason = stopReason;
      break;
    }
    if (actionSelection.action === 'create_provider_gap_proposal') {
      stopReason = 'operator_review_required_provider_gap';
      iteration.stopReason = stopReason;
      break;
    }
    if (actionSelection.terminalAfterAction && actionResult.executionDeferred) {
      stopReason = iteration.stopReason;
      break;
    }
    if (actionResult.operatorReviewRequired) {
      stopReason = 'operator_review_required';
      iteration.stopReason = stopReason;
      break;
    }
    if (actionSelection.action === 'final_investment_report_dry_run') {
      stopReason = iteration.stopReason;
      iteration.stopReason = stopReason;
      break;
    }
    if (args.stopAfterAction || !args.continueSafe) {
      stopReason = iteration.stopReason;
      break;
    }
    if (nextActionSelection.action === 'operator_review_required') {
      stopReason = 'no_safe_next_action';
      iteration.stopReason = stopReason;
      break;
    }
    const requirementActions = new Set(['create_fixture_requirement', 'generate_next_operator_review_task', 'create_provider_gap_proposal']);
    if (args.noRepeatSameActionWithoutProgress && !progress.progressMade) {
      if (requirementActions.has(nextActionSelection.action)) {
        currentState = nextState;
        stopReason = index + 1 >= args.maxIterations ? 'max_iterations_reached' : 'continue_safe_replan';
        continue;
      }
      if (noProgressSignatures.has(progress.signature)) {
        stopReason = 'same_action_repeated_without_progress';
      } else {
        noProgressSignatures.add(progress.signature);
        stopReason = 'operator_review_required_no_strong_progress';
      }
      iteration.stopReason = stopReason;
      break;
    }
    currentState = nextState;
    stopReason = index + 1 >= args.maxIterations ? 'max_iterations_reached' : 'continue_safe_replan';
  }

  const latestThesisMemoActionResult = [...iterations].reverse()
    .find((item) => item.selectedAction === 'thesis_validation_memo_dry_run')?.actionResult || null;
  const latestValuationBridgeActionResult = [...iterations].reverse()
    .find((item) => item.selectedAction === 'valuation_expectation_bridge_dry_run')?.actionResult || null;
  const latestMarketRegimeSupportActionResult = [...iterations].reverse()
    .find((item) => item.selectedAction === 'market_validation_regime_support_repair' || item.selectedAction === 'repair_controlled_market_validation_regime_support')?.actionResult || null;
  const latestFinalInvestmentReportActionResult = [...iterations].reverse()
    .find((item) => item.selectedAction === 'final_investment_report_dry_run')?.actionResult || null;
  const hardcodingAudit = runAutonomousResearchHardcodingAudit({
    cwd: process.cwd(),
    generatedAt,
  });
  const result = {
    ok: true,
    source: 'autonomous-research-repair-loop',
    generatedAt,
    runId: `autonomous-research-repair-loop-${Date.parse(generatedAt) || Date.now()}`,
    mode: args.mode,
    maxIterations: args.maxIterations,
    maxFilesChanged: args.maxFilesChanged,
    maxSeeds: args.maxSeeds,
    maxTracks: args.maxTracks,
    iterationCount: iterations.length,
    inputArtifacts: {
      diagnosticsPath: inputState.diagnosticsPath || null,
      acquisitionPath: inputState.acquisitionPath || null,
      providerBlockedPath: inputState.providerBlockedPath || null,
    },
    inputState: {
      diagnosticsPath: inputState.diagnosticsPath || null,
      acquisitionPath: inputState.acquisitionPath || null,
      providerBlockedPath: inputState.providerBlockedPath || null,
      selectedSeed: inputState.selectedSeed || null,
      evidenceBefore: inputState.evidenceBefore,
      readinessBefore: inputState.readinessBefore,
    },
    trackStatus: inputState.acquisition?.trackStatus || null,
    trackAStatus: inputState.acquisition?.trackStatus?.mechanismValidationTrack || inputState.acquisition?.splitTracks?.mechanismValidationTrack?.status || null,
    trackBStatus: inputState.acquisition?.trackStatus?.issuerBridgeTrack || inputState.acquisition?.splitTracks?.issuerBridgeTrack?.status || null,
    hardcodingAuditStatus: hardcodingAudit.status,
    hardcodingAudit,
    providerGapRequired: inputState.acquisition?.providerGapRequired || [],
    selectedAction: iterations[0]?.selectedAction || 'operator_review_required',
    actionReason: iterations[0]?.actionReason || 'no safe bounded action exists',
    actionScope: iterations[0]?.actionScope || null,
    executed: Boolean(iterations[0]?.actionResult?.executed),
    filesChanged: iterations.flatMap((item) => item.filesChanged || []),
    commandsRun: iterations.flatMap((item) => item.commandsRun || []),
    testsRun: iterations.flatMap((item) => item.testsRun || []),
    testResults: externalTestResults || {
      executedByLoop: false,
      passed: null,
      failed: null,
      focusedTestsRecommended: [
        'node --import tsx --test tests/autonomous-research-repair-loop.test.mjs',
      ],
    },
    tests: externalTestResults || {
      executedByLoop: false,
      passed: null,
      failed: null,
      focusedTestsRecommended: [
        'node --import tsx --test tests/autonomous-research-repair-loop.test.mjs',
      ],
    },
    evidenceCountsBefore: iterations[0]?.evidenceCountsBefore || inputState.evidenceBefore,
    evidenceCountsAfter: iterations.at(-1)?.evidenceCountsAfter || inputState.evidenceBefore,
    rawEvidenceBefore: iterations[0]?.evidenceCountsBefore?.rawEvidenceCount ?? inputState.evidenceBefore?.rawEvidenceCount ?? 0,
    rawEvidenceAfter: iterations.at(-1)?.evidenceCountsAfter?.rawEvidenceCount ?? inputState.evidenceBefore?.rawEvidenceCount ?? 0,
    acceptedEvidenceBefore: iterations[0]?.evidenceCountsBefore?.acceptedEvidenceCount ?? inputState.evidenceBefore?.acceptedEvidenceCount ?? 0,
    acceptedEvidenceAfter: iterations.at(-1)?.evidenceCountsAfter?.acceptedEvidenceCount ?? inputState.evidenceBefore?.acceptedEvidenceCount ?? 0,
    acceptedPromotionEvidenceBefore: iterations[0]?.evidenceCountsBefore?.acceptedPromotionEvidenceCount ?? inputState.evidenceBefore?.acceptedPromotionEvidenceCount ?? 0,
    acceptedPromotionEvidenceAfter: iterations.at(-1)?.evidenceCountsAfter?.acceptedPromotionEvidenceCount ?? inputState.evidenceBefore?.acceptedPromotionEvidenceCount ?? 0,
    readinessBefore: iterations[0]?.readinessBefore || inputState.readinessBefore,
    readinessAfter: iterations.at(-1)?.readinessAfter || inputState.readinessBefore,
    negativeControlBefore: inputState.acquisition?.negativeControlStatus || inputState.acquisition?.splitTracks?.issuerBridgeTrack?.negativeControlStatus || null,
    negativeControlAfter: iterations.at(-1)?.negativeControlAfter || iterations.at(-1)?.actionResult?.negativeControlStatus || iterations.at(-1)?.readinessAfter?.negativeControlStatus || inputState.acquisition?.negativeControlStatus || null,
    holdoutBefore: inputState.acquisition?.holdoutConfirmed ?? null,
    holdoutAfter: iterations.at(-1)?.holdoutAfter ?? iterations.at(-1)?.actionResult?.holdoutConfirmed ?? inputState.acquisition?.holdoutConfirmed ?? null,
    issuerBridgeBefore: inputState.acquisition?.issuerBridgeStatus || null,
    issuerBridgeAfter: iterations.at(-1)?.issuerBridgeAfter || iterations.at(-1)?.actionResult?.issuerBridgeStatus || iterations.at(-1)?.actionResult?.gateImpact?.issuerBridgeStatus || inputState.acquisition?.issuerBridgeStatus || null,
    marketValidationBefore: inputState.acquisition?.marketValidationStatus || null,
    marketValidationAfter: iterations.at(-1)?.marketValidationAfter || iterations.at(-1)?.actionResult?.marketValidationStatus || iterations.at(-1)?.actionResult?.gateImpact?.marketValidationStatus || inputState.acquisition?.marketValidationStatus || null,
    reportCandidateAllowedDiagnostic: Boolean(iterations.some((item) => item.actionResult?.reportCandidateAllowedDiagnostic || item.actionResult?.gateImpact?.reportCandidateAllowedDiagnostic)),
    evidenceContractClosureStatus: iterations.at(-1)?.actionResult?.closureStatus || currentState.acquisition?.evidenceContractClosureStatus || null,
    evidenceContractMatrixSummary: iterations.at(-1)?.actionResult?.evidenceContractMatrixSummary || currentState.acquisition?.evidenceContractMatrixSummary || [],
    dryRunReportSubject: iterations.at(-1)?.actionResult?.dryRunReportSubject || currentState.acquisition?.dryRunReportSubject || null,
    closureCaveats: iterations.at(-1)?.actionResult?.caveats || currentState.acquisition?.closureCaveats || [],
    contradictionWarnings: iterations.at(-1)?.actionResult?.contradictionWarnings || currentState.acquisition?.closureContradictionWarnings || [],
    thesisValidationMemoDryRunStatus: latestThesisMemoActionResult?.thesisValidationMemoDryRunStatus || currentState.acquisition?.thesisValidationMemoDryRunStatus || null,
    memoType: latestFinalInvestmentReportActionResult?.memoType || latestThesisMemoActionResult?.memoType || currentState.acquisition?.memoType || null,
    memoDecisionUse: latestFinalInvestmentReportActionResult?.memoDecisionUse || latestThesisMemoActionResult?.memoDecisionUse || currentState.acquisition?.memoDecisionUse || null,
    decisionUse: latestFinalInvestmentReportActionResult?.decisionUse || latestThesisMemoActionResult?.memoDecisionUse || currentState.acquisition?.decisionUse || currentState.acquisition?.memoDecisionUse || null,
    notDecisionReady: latestFinalInvestmentReportActionResult?.notDecisionReady ?? latestThesisMemoActionResult?.notDecisionReady ?? currentState.acquisition?.notDecisionReady ?? null,
    investmentMemoReady: latestFinalInvestmentReportActionResult?.investmentMemoReady ?? latestThesisMemoActionResult?.investmentMemoReady ?? currentState.acquisition?.investmentMemoReady ?? false,
    decisionReady: latestFinalInvestmentReportActionResult?.decisionReady ?? latestThesisMemoActionResult?.decisionReady ?? currentState.acquisition?.decisionReady ?? false,
    portfolioActionAllowed: latestFinalInvestmentReportActionResult?.portfolioActionAllowed ?? currentState.acquisition?.portfolioActionAllowed ?? false,
    clientMemoPath: latestFinalInvestmentReportActionResult?.clientMemoPath || latestThesisMemoActionResult?.clientMemoPath || currentState.acquisition?.clientMemoPath || null,
    clientMemoHtmlPath: latestFinalInvestmentReportActionResult?.clientMemoHtmlPath || latestThesisMemoActionResult?.clientMemoHtmlPath || currentState.acquisition?.clientMemoHtmlPath || null,
    auditAppendixPath: latestFinalInvestmentReportActionResult?.auditAppendixPath || latestThesisMemoActionResult?.auditAppendixPath || currentState.acquisition?.auditAppendixPath || null,
    thesisValidationMemoValidation: latestThesisMemoActionResult?.thesisValidationMemoValidation || currentState.acquisition?.thesisValidationMemoValidation || null,
    thesisValidationMemoCaveats: latestThesisMemoActionResult?.caveats || currentState.acquisition?.thesisValidationMemoCaveats || [],
    thesisValidationMemoRemainingBlockers: latestThesisMemoActionResult?.remainingBlockers || currentState.acquisition?.thesisValidationMemoRemainingBlockers || [],
    valuationExpectationBridgeDryRunStatus: latestValuationBridgeActionResult?.valuationExpectationBridgeDryRunStatus || currentState.acquisition?.valuationExpectationBridgeDryRunStatus || null,
    valuationBridgeStatus: latestValuationBridgeActionResult?.valuationBridgeStatus || currentState.acquisition?.valuationBridgeStatus || null,
    expectationBridgeStatus: latestValuationBridgeActionResult?.expectationBridgeStatus || currentState.acquisition?.expectationBridgeStatus || null,
    issuerValuationBridgeTable: latestValuationBridgeActionResult?.issuerValuationBridgeTable || currentState.acquisition?.issuerValuationBridgeTable || [],
    missingValuationFields: latestValuationBridgeActionResult?.missingValuationFields || currentState.acquisition?.missingValuationFields || [],
    remainingCaveats: latestMarketRegimeSupportActionResult?.remainingBlockers || latestValuationBridgeActionResult?.caveats || currentState.acquisition?.remainingCaveats || [],
    valuationMetricCoverage: (latestValuationBridgeActionResult?.issuerValuationBridgeTable || currentState.acquisition?.issuerValuationBridgeTable || []).map((row) => ({ issuer: row.issuer, coverage: row.valuationMetricCoverage })),
    consensusMetricCoverage: (latestValuationBridgeActionResult?.issuerValuationBridgeTable || currentState.acquisition?.issuerValuationBridgeTable || []).map((row) => ({ issuer: row.issuer, coverage: row.consensusMetricCoverage })),
    peerMetricCoverage: (latestValuationBridgeActionResult?.issuerValuationBridgeTable || currentState.acquisition?.issuerValuationBridgeTable || []).map((row) => ({ issuer: row.issuer, coverage: row.peerMetricCoverage })),
    pricedInRisk: Boolean((latestValuationBridgeActionResult?.issuerValuationBridgeTable || currentState.acquisition?.issuerValuationBridgeTable || []).some((row) => row.pricedInRisk)),
    localValuationCacheRowCount: latestValuationBridgeActionResult?.localValuationCacheRowCount ?? currentState.acquisition?.localValuationCacheRowCount ?? 0,
    localValuationCacheMissingIssuers: latestValuationBridgeActionResult?.localValuationCacheMissingIssuers || currentState.acquisition?.localValuationCacheMissingIssuers || [],
    marketRegimeSupport: latestMarketRegimeSupportActionResult?.marketRegimeSupport || latestValuationBridgeActionResult?.marketRegimeSupport || currentState.acquisition?.marketRegimeSupport || null,
    marketValidationRegimeStatus: latestMarketRegimeSupportActionResult?.marketValidationRegimeStatus || latestValuationBridgeActionResult?.marketValidationRegimeStatus || currentState.acquisition?.marketValidationRegimeStatus || null,
    regimeConsistencyScore: firstFiniteMetric(
      latestMarketRegimeSupportActionResult?.regimeConsistencyScore,
      latestMarketRegimeSupportActionResult?.marketRegimeSupport?.regimeConsistencyScore,
      latestValuationBridgeActionResult?.regimeConsistencyScore,
      latestValuationBridgeActionResult?.marketRegimeSupport?.regimeConsistencyScore,
      currentState.acquisition?.regimeConsistencyScore,
      currentState.acquisition?.marketRegimeSupport?.regimeConsistencyScore,
    ),
    regimeCoverageScore: firstFiniteMetric(
      latestMarketRegimeSupportActionResult?.regimeCoverageScore,
      latestMarketRegimeSupportActionResult?.marketRegimeSupport?.regimeCoverageScore,
      latestValuationBridgeActionResult?.regimeCoverageScore,
      latestValuationBridgeActionResult?.marketRegimeSupport?.regimeCoverageScore,
      currentState.acquisition?.regimeCoverageScore,
      currentState.acquisition?.marketRegimeSupport?.regimeCoverageScore,
    ),
    eventCountByRegime: latestMarketRegimeSupportActionResult?.eventCountByRegime || currentState.acquisition?.eventCountByRegime || null,
    directionSupportByRegime: latestMarketRegimeSupportActionResult?.directionSupportByRegime || currentState.acquisition?.directionSupportByRegime || null,
    unknownRegimeShare: firstFiniteMetric(
      latestMarketRegimeSupportActionResult?.unknownRegimeShare,
      latestMarketRegimeSupportActionResult?.marketRegimeSupport?.unknownRegimeShare,
      latestValuationBridgeActionResult?.unknownRegimeShare,
      latestValuationBridgeActionResult?.marketRegimeSupport?.unknownRegimeShare,
      currentState.acquisition?.unknownRegimeShare,
      currentState.acquisition?.marketRegimeSupport?.unknownRegimeShare,
    ),
    extremeTstatWarning: latestMarketRegimeSupportActionResult?.extremeTstatWarning ?? latestValuationBridgeActionResult?.extremeTstatWarning ?? currentState.acquisition?.extremeTstatWarning ?? null,
    tstatSanityStatus: latestMarketRegimeSupportActionResult?.tstatSanityStatus || currentState.acquisition?.tstatSanityStatus || null,
    marketValidationResearchUseAllowed: latestMarketRegimeSupportActionResult?.marketValidationResearchUseAllowed ?? currentState.acquisition?.marketValidationResearchUseAllowed ?? null,
    marketValidationInvestmentUseAllowed: latestMarketRegimeSupportActionResult?.marketValidationInvestmentUseAllowed ?? currentState.acquisition?.marketValidationInvestmentUseAllowed ?? null,
    marketValidationDecisionUseAllowed: false,
    finalInvestmentReportDryRunStatus: latestFinalInvestmentReportActionResult?.finalInvestmentReportDryRunStatus || currentState.acquisition?.finalInvestmentReportDryRunStatus || null,
    finalInvestmentReportValidation: latestFinalInvestmentReportActionResult?.finalInvestmentReportValidation || currentState.acquisition?.finalInvestmentReportValidation || null,
    validatorStatus: latestFinalInvestmentReportActionResult?.validatorStatus || currentState.acquisition?.validatorStatus || null,
    finalInvestmentReportDryRunPath: latestFinalInvestmentReportActionResult?.clientMemoPath || currentState.acquisition?.finalInvestmentReportDryRunPath || null,
    finalInvestmentReportHtmlPath: latestFinalInvestmentReportActionResult?.clientMemoHtmlPath || currentState.acquisition?.finalInvestmentReportHtmlPath || null,
    finalInvestmentReportAuditAppendixPath: latestFinalInvestmentReportActionResult?.auditAppendixPath || currentState.acquisition?.finalInvestmentReportAuditAppendixPath || null,
    finalStopReason: latestFinalInvestmentReportActionResult?.finalStopReason || currentState.acquisition?.finalStopReason || null,
    investmentMemoReadinessDiagnostic: latestMarketRegimeSupportActionResult?.investmentMemoReadinessDiagnostic || latestValuationBridgeActionResult?.investmentMemoReadinessDiagnostic || currentState.acquisition?.investmentMemoReadinessDiagnostic || null,
    readyForHumanInvestmentMemoReview: latestMarketRegimeSupportActionResult?.readyForHumanInvestmentMemoReview ?? latestValuationBridgeActionResult?.readyForHumanInvestmentMemoReview ?? currentState.acquisition?.readyForHumanInvestmentMemoReview ?? false,
    valuationBridgePath: latestValuationBridgeActionResult?.valuationBridgePath || currentState.acquisition?.valuationBridgePath || null,
    marketRegimeSupportPath: latestValuationBridgeActionResult?.marketRegimeSupportPath || currentState.acquisition?.marketRegimeSupportPath || null,
    visualStatusBefore: iterations[0]?.readinessBefore?.visualStatus || inputState.readinessBefore?.visualStatus || null,
    visualStatusAfter: iterations.at(-1)?.readinessAfter?.visualStatus || inputState.readinessBefore?.visualStatus || null,
    reportCandidateAllowedBefore: Boolean(iterations[0]?.readinessBefore?.reportCandidateAllowed || inputState.readinessBefore?.reportCandidateAllowed),
    reportCandidateAllowedAfter: Boolean(iterations.at(-1)?.readinessAfter?.reportCandidateAllowed),
    blockerBefore: iterations[0]?.blockerBefore || 'operator_review_required',
    blockerAfter: iterations.at(-1)?.blockerAfter || 'operator_review_required',
    iterations,
    nextRecommendedAction: iterations.at(-1)?.nextRecommendedAction || 'operator_review_required',
    stopReason,
    boundaries: {
      providerActivationWrites: iterations.reduce((sum, item) => sum + Number(item.actionResult?.boundaries?.providerActivationWrites || item.actionResult?.providerActivationWrites || 0), 0),
      readinessPromotionWrites: 0,
      canonicalWrites: iterations.reduce((sum, item) => sum + Number(item.actionResult?.boundaries?.canonicalWrites || 0), 0),
      sourceRegistryWrites: iterations.reduce((sum, item) => sum + Number(item.actionResult?.boundaries?.sourceRegistryWrites || 0), 0),
      approvalQueueWrites: iterations.reduce((sum, item) => sum + Number(item.actionResult?.boundaries?.approvalQueueWrites || 0), 0),
      reportCandidateWrites: iterations.reduce((sum, item) => sum + Number(item.actionResult?.boundaries?.reportCandidateWrites || 0), 0),
      portfolioActionWrites: iterations.reduce((sum, item) => sum + Number(item.actionResult?.boundaries?.portfolioActionWrites || 0), 0),
    },
    mutationBoundaries: null,
    safetyPolicy: {
      providerActivationAllowed: false,
      readinessPromotionAllowed: false,
      reportCandidateWriteAllowed: false,
      codePatchAllowed: Boolean(args.allowCodePatch),
      maxSeeds: args.maxSeeds,
      maxTracks: args.maxTracks,
      acceptedEvidenceRequiredForReportCandidate: true,
    },
    remainingRisks: [
      'execute-safe is intentionally bounded to one seed or one track',
      'accepted evidence can open a report-candidate gate only as a diagnostic result; reportCandidateWrites remain zero',
      'investment readiness still requires Evidence Contract Matrix closure and controlled market validation',
    ],
    artifactPath: null,
  };
  result.mutationBoundaries = result.boundaries;
  if (args.writeArtifact !== false && latestThesisMemoActionResult?.thesisValidationMemoDryRun) {
    const memoPaths = await writeThesisValidationMemoArtifacts(latestThesisMemoActionResult, args.artifactRoot || DEFAULT_ARTIFACT_ROOT);
    if (memoPaths) {
      result.clientMemoPath = memoPaths.clientMemoPath;
      result.clientMemoHtmlPath = memoPaths.clientMemoHtmlPath;
      result.auditAppendixPath = memoPaths.auditAppendixPath;
      latestThesisMemoActionResult.clientMemoPath = memoPaths.clientMemoPath;
      latestThesisMemoActionResult.clientMemoHtmlPath = memoPaths.clientMemoHtmlPath;
      latestThesisMemoActionResult.auditAppendixPath = memoPaths.auditAppendixPath;
    }
  }
  if (args.writeArtifact !== false && latestValuationBridgeActionResult?.valuationExpectationBridgeDryRun) {
    const bridgePaths = await writeValuationExpectationBridgeArtifacts(latestValuationBridgeActionResult, args.artifactRoot || DEFAULT_ARTIFACT_ROOT);
    if (bridgePaths) {
      result.valuationBridgePath = bridgePaths.valuationBridgePath;
      result.marketRegimeSupportPath = bridgePaths.marketRegimeSupportPath;
      if (bridgePaths.clientMemoPath) result.clientMemoPath = bridgePaths.clientMemoPath;
      if (bridgePaths.clientMemoHtmlPath) result.clientMemoHtmlPath = bridgePaths.clientMemoHtmlPath;
      if (bridgePaths.auditAppendixPath) result.auditAppendixPath = bridgePaths.auditAppendixPath;
      latestValuationBridgeActionResult.valuationBridgePath = bridgePaths.valuationBridgePath;
      latestValuationBridgeActionResult.marketRegimeSupportPath = bridgePaths.marketRegimeSupportPath;
    }
  }
  if (args.writeArtifact !== false && latestMarketRegimeSupportActionResult?.marketRegimeSupport) {
    const marketRegimeSupportPath = path.join(args.artifactRoot || DEFAULT_ARTIFACT_ROOT, 'market-validation-regime-support.latest.json');
    await writeJson(marketRegimeSupportPath, latestMarketRegimeSupportActionResult.marketRegimeSupport);
    result.marketRegimeSupportPath = path.resolve(marketRegimeSupportPath);
    latestMarketRegimeSupportActionResult.marketRegimeSupportPath = result.marketRegimeSupportPath;
  }
  if (args.writeArtifact !== false && latestFinalInvestmentReportActionResult?.finalInvestmentReportDryRun) {
    const finalReportPaths = await writeFinalInvestmentReportArtifacts(latestFinalInvestmentReportActionResult, args.artifactRoot || DEFAULT_ARTIFACT_ROOT);
    if (finalReportPaths) {
      result.clientMemoPath = finalReportPaths.clientMemoPath;
      result.clientMemoHtmlPath = finalReportPaths.clientMemoHtmlPath;
      result.auditAppendixPath = finalReportPaths.auditAppendixPath;
      result.finalInvestmentReportDryRunPath = finalReportPaths.clientMemoPath;
      result.finalInvestmentReportHtmlPath = finalReportPaths.clientMemoHtmlPath;
      result.finalInvestmentReportAuditAppendixPath = finalReportPaths.auditAppendixPath;
      latestFinalInvestmentReportActionResult.clientMemoPath = finalReportPaths.clientMemoPath;
      latestFinalInvestmentReportActionResult.clientMemoHtmlPath = finalReportPaths.clientMemoHtmlPath;
      latestFinalInvestmentReportActionResult.auditAppendixPath = finalReportPaths.auditAppendixPath;
    }
  }
  if (args.writeArtifact !== false) {
    result.artifactPath = path.resolve(args.outputPath || DEFAULT_OUTPUT_PATH);
    await writeJson(result.artifactPath, result);
  }
  return result;
}

async function main() {
  const options = parseAutonomousResearchRepairLoopArgs();
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const result = await runAutonomousResearchRepairLoop(options);
  process.stdout.write(`${JSON.stringify({
    ok: result.ok,
    mode: result.mode,
    iterationCount: result.iterationCount,
    selectedAction: result.selectedAction,
    actionReason: result.actionReason,
    blockerBefore: result.blockerBefore,
    blockerAfter: result.blockerAfter,
    evidenceCountsBefore: result.evidenceCountsBefore,
    evidenceCountsAfter: result.evidenceCountsAfter,
    readinessBefore: result.readinessBefore,
    readinessAfter: result.readinessAfter,
    evidenceContractClosureStatus: result.evidenceContractClosureStatus,
    hardcodingAuditStatus: result.hardcodingAuditStatus,
    thesisValidationMemoDryRunStatus: result.thesisValidationMemoDryRunStatus,
    valuationExpectationBridgeDryRunStatus: result.valuationExpectationBridgeDryRunStatus,
    valuationBridgeStatus: result.valuationBridgeStatus,
    expectationBridgeStatus: result.expectationBridgeStatus,
    marketValidationRegimeStatus: result.marketValidationRegimeStatus,
    regimeConsistencyScore: result.regimeConsistencyScore,
    regimeCoverageScore: result.regimeCoverageScore,
    unknownRegimeShare: result.unknownRegimeShare,
    extremeTstatWarning: result.extremeTstatWarning,
    tstatSanityStatus: result.tstatSanityStatus,
    investmentMemoReadinessDiagnostic: result.investmentMemoReadinessDiagnostic,
    readyForHumanInvestmentMemoReview: result.readyForHumanInvestmentMemoReview,
    notDecisionReady: result.notDecisionReady,
    investmentMemoReady: result.investmentMemoReady,
    decisionReady: result.decisionReady,
    portfolioActionAllowed: result.portfolioActionAllowed,
    finalInvestmentReportDryRunStatus: result.finalInvestmentReportDryRunStatus,
    validatorStatus: result.validatorStatus,
    finalInvestmentReportDryRunPath: result.finalInvestmentReportDryRunPath,
    finalInvestmentReportAuditAppendixPath: result.finalInvestmentReportAuditAppendixPath,
    finalStopReason: result.finalStopReason,
    localValuationCacheRowCount: result.localValuationCacheRowCount,
    localValuationCacheMissingIssuers: result.localValuationCacheMissingIssuers,
    clientMemoPath: result.clientMemoPath,
    auditAppendixPath: result.auditAppendixPath,
    valuationBridgePath: result.valuationBridgePath,
    marketRegimeSupportPath: result.marketRegimeSupportPath,
    nextRecommendedAction: result.nextRecommendedAction,
    stopReason: result.stopReason,
    boundaries: result.boundaries,
    artifactPath: result.artifactPath,
  }, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export const __test = {
  BLOCKER_PRIORITY,
  ALLOWED_ACTIONS,
  BOUNDED_EXECUTABLE_ACTIONS,
  BANNED_ACTIONS,
  REQUIRED_PROVIDER_PROPOSAL_FIELDS,
  evaluateRepairGate,
  evidenceCountsFromArtifact,
  readinessFromArtifact,
  providerGapProposal,
  runLimitedGridMechanismValidationExecutor,
  runLimitedHoldoutValidationExecutor,
  runLimitedIssuerBridgeTrackExecutor,
  runLimitedControlledMarketValidationExecutor,
  runEvidenceContractClosureDryRunExecutor,
  runThesisValidationMemoDryRunExecutor,
  runValuationExpectationBridgeDryRunExecutor,
  runMarketValidationRegimeSupportRepairExecutor,
  runFinalInvestmentReportDryRunExecutor,
  buildMarketValidationRegimeSupport,
  buildFinalInvestmentReportDryRun,
  validateFinalInvestmentReportDryRun,
  runAutonomousResearchHardcodingAudit,
};
