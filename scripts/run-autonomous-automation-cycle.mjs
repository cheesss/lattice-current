#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runBackfillQueueExecutor,
} from './_shared/backfill-queue-executor.mjs';
import {
  buildAutomationConsolePayload,
} from './_shared/automation-console-surface.mjs';
import {
  buildAutomationRuntimeStatus,
  writeAutomationRuntimeStatus,
} from './_shared/automation-runtime-supervisor.mjs';
import {
  buildReportSourceQuarantine,
  writeReportSourceQuarantineArtifact,
} from './_shared/report-source-quarantine.mjs';
import {
  buildReportCandidateStaging,
  writeReportCandidateStagingArtifact,
} from './_shared/report-candidate-staging.mjs';
import {
  buildEvidenceGateConsolidation,
  writeEvidenceGateConsolidationArtifact,
} from './_shared/evidence-gate-consolidator.mjs';
import {
  buildHistoricalAnalogueBridge,
  writeHistoricalAnalogueBridgeArtifact,
} from './_shared/historical-analogue-bridge.mjs';
import {
  buildValuationContextAutoLinker,
  buildValuationContextRotation,
  writeValuationContextAutoLinkerArtifact,
  writeValuationContextRotationArtifact,
} from './_shared/valuation-context-auto-linker.mjs';
import {
  loadLocalValuationFundamentalsCache,
} from './_shared/external-data/local-valuation-fundamentals-cache.mjs';
import {
  buildValuationExpectationBridgeDryRun,
} from './_shared/valuation-expectation-bridge-dry-run.mjs';
import {
  runValuationContextRequirementExecutor,
} from './_shared/valuation-context-requirement-executor.mjs';
import {
  buildSectorPositivePathRegistry,
  buildSectorPositivePathSummary,
} from './_shared/sector-positive-path-registry.mjs';
import {
  buildSourceProviderManifestRegistry,
  buildSourceProviderManifestCandidates,
  writeSourceProviderManifestRegistryArtifact,
} from './_shared/source-provider-manifest-registry.mjs';
import {
  buildEvidenceExecutorRegistry,
  writeEvidenceExecutorRegistryArtifact,
} from './_shared/evidence-executor-registry.mjs';
import {
  buildSectorPackRegistry,
  writeSectorPackRegistryArtifact,
} from './_shared/sector-pack-registry.mjs';
import {
  buildCollectorBackedSourceProviderCandidates,
  buildProviderCollectorRegistry,
  writeProviderCollectorRegistryArtifact,
} from './_shared/provider-collector-registry.mjs';
import {
  buildPrioritySourceProviderCandidates,
} from './_shared/source-provider-priority-catalog.mjs';
import {
  buildPriorityProviderFixtureProbes,
} from './_shared/source-provider-fixture-probes.mjs';
import {
  runSourceProviderActivation,
} from './_shared/source-registry-safe-writer.mjs';
import {
  runStagedProviderLiveExecutor,
} from './_shared/staged-provider-live-executor.mjs';
import {
  buildProviderQualityFeedback,
  writeProviderQualityFeedbackArtifact,
} from './_shared/provider-quality-feedback.mjs';
import {
  buildSourceQualityScore,
  writeSourceQualityScoreArtifact,
} from './_shared/source-quality-score.mjs';
import {
  buildSourceDiversityFeedback,
  writeSourceDiversityFeedbackArtifact,
} from './_shared/source-diversity-feedback.mjs';
import {
  buildAutomationFeedbackRemediation,
  writeAutomationFeedbackRemediationArtifact,
} from './_shared/automation-feedback-remediation.mjs';
import {
  runAutomationFeedbackCodeRepair,
} from './_shared/automation-feedback-code-repair.mjs';

const DEFAULT_RUNTIME_ROOT = path.join(process.cwd(), 'data', 'runtime');

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    runtimeRoot: DEFAULT_RUNTIME_ROOT,
    apply: false,
    writeArtifacts: true,
    limit: 25,
    verifyProviderFixtures: true,
    executeStagedProviderLive: true,
    stagedProviderMaxTargets: 5,
    stagedProviderTimeoutMs: 6000,
    allowCodePatch: false,
    codePatchMaxRepairs: 1,
    parallelCodePatch: false,
    parallelCodePatchWorkers: 3,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--dry-run') out.apply = false;
    else if (arg === '--no-write') out.writeArtifacts = false;
    else if (arg === '--no-verify-provider-fixtures') out.verifyProviderFixtures = false;
    else if (arg === '--no-execute-staged-provider-live') out.executeStagedProviderLive = false;
    else if (arg === '--allow-code-patch') out.allowCodePatch = true;
    else if (arg === '--parallel-code-patch' || arg === '--parallel') out.parallelCodePatch = true;
    else if (arg === '--runtime-root' || arg === '--artifact-root') out.runtimeRoot = path.resolve(next() || out.runtimeRoot);
    else if (arg === '--limit') out.limit = Number(next() || out.limit);
    else if (arg === '--staged-provider-max-targets') out.stagedProviderMaxTargets = Number(next() || out.stagedProviderMaxTargets);
    else if (arg === '--staged-provider-timeout-ms') out.stagedProviderTimeoutMs = Number(next() || out.stagedProviderTimeoutMs);
    else if (arg === '--code-patch-max-repairs') out.codePatchMaxRepairs = Number(next() || out.codePatchMaxRepairs);
    else if (arg === '--parallel-code-patch-workers') out.parallelCodePatchWorkers = Number(next() || out.parallelCodePatchWorkers);
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--runtime-root=')) out.runtimeRoot = path.resolve(arg.slice('--runtime-root='.length));
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--staged-provider-max-targets=')) out.stagedProviderMaxTargets = Number(arg.slice('--staged-provider-max-targets='.length));
    else if (arg.startsWith('--staged-provider-timeout-ms=')) out.stagedProviderTimeoutMs = Number(arg.slice('--staged-provider-timeout-ms='.length));
    else if (arg.startsWith('--code-patch-max-repairs=')) out.codePatchMaxRepairs = Number(arg.slice('--code-patch-max-repairs='.length));
    else if (arg.startsWith('--parallel-code-patch-workers=')) out.parallelCodePatchWorkers = Number(arg.slice('--parallel-code-patch-workers='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function helpText() {
  return `Usage:
  node --import tsx scripts/run-autonomous-automation-cycle.mjs --dry-run
  node --import tsx scripts/run-autonomous-automation-cycle.mjs --apply

This cycle coordinates local runtime artifacts for source/provider activation,
backfill queue execution, report-source quarantine, and runtime supervision.
It does not activate paid providers, write canonical graph state, promote
readiness, write report candidates, or allow portfolio actions.
Priority provider fixture probes are enabled by default and only move
fixture-backed providers to staged lifecycle records after parser/healthcheck
contract verification. Use --no-verify-provider-fixtures to inspect raw
needs_fixture state.
Staged provider live execution is enabled by default under bounded read-only
limits. It stores raw/accepted evidence artifacts only and never promotes
readiness or writes report candidates. Use --no-execute-staged-provider-live
for fixture-only inspection.
Use --allow-code-patch to let Codex CLI attempt one bounded provider/collector
code repair from the latest remediation artifact. It still cannot commit,
activate providers, promote readiness, or write report candidates.
Use --parallel-code-patch --parallel-code-patch-workers 3 to run bounded
Codex CLI repairs in isolated snapshot workspaces and merge only safe,
non-overlapping allowed-file changes.
`;
}

async function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}

async function readTrustedLocalValuationRows(runtimeRoot = DEFAULT_RUNTIME_ROOT) {
  const names = new Set([
    'local-valuation-fundamentals-cache.latest.json',
    'trusted-local-valuation-cache.latest.json',
  ]);
  try {
    for (const name of await readdir(runtimeRoot)) {
      if (/^trusted-local-valuation-cache\..+\.latest\.json$/i.test(name)) names.add(name);
      if (/^local-valuation-fundamentals-cache\..+\.latest\.json$/i.test(name)) names.add(name);
    }
  } catch {
    // Missing runtime roots are valid during isolated test runs.
  }
  const rows = [];
  const sourceFiles = [];
  for (const name of [...names].sort()) {
    const filePath = path.join(runtimeRoot, name);
    const parsed = await readJson(filePath);
    const fileRows = asArray(parsed?.rows || parsed?.data);
    if (!fileRows.length) continue;
    rows.push(...fileRows);
    sourceFiles.push(path.resolve(filePath));
  }
  return { rows, sourceFiles };
}

function valuationBridgeInputFromGate({
  evidenceGateConsolidation = {},
  valuationContextAutoLinker = {},
  historicalAnalogueBridge = {},
} = {}) {
  const state = evidenceGateConsolidation?.primaryState || {};
  const contextRows = asArray(valuationContextAutoLinker?.contextRows);
  return {
    thesis: state.subjectLabel || state.bottleneckNode || 'Selected cross-theme bottleneck operating bridge and valuation context',
    seedId: state.seedId,
    trackId: state.trackId,
    bottleneckNode: state.bottleneckNode,
    issuerUniverse: contextRows.map((row) => row.issuer),
    trackBAcceptedIssuerEvidenceCount: contextRows.length,
    trackBIssuerEvidenceByIssuer: Object.fromEntries(contextRows.map((row) => [
      row.issuer,
      asArray(row.acceptedIssuerBridgeEvidenceIds).map((evidenceId) => ({ evidenceId })),
    ])),
    localValuationRows: contextRows,
    localValuationCache: valuationContextAutoLinker.localValuationCache,
    historicalAnalogueBridge,
    requireHistoricalAnalogueBridge: true,
    marketValidationStatus: state.marketValidationStatus === 'controlled_ready' ? 'controlled_ready' : null,
    marketValidationControlUsed: state.marketValidationStatus === 'controlled_ready',
    marketValidationBenchmarkUsed: state.marketValidationStatus === 'controlled_ready' ? 'local_controlled_market_cache' : null,
  };
}

function valuationBridgeInputFromSeedContext({
  seedContext = {},
  historicalAnalogueBridge = {},
} = {}) {
  const contextRows = asArray(seedContext?.contextRows);
  return {
    thesis: seedContext.subjectLabel || seedContext.bottleneckNode || 'Selected cross-theme bottleneck operating bridge and valuation context',
    seedId: seedContext.seedId,
    trackId: seedContext.trackId,
    bottleneckNode: seedContext.bottleneckNode,
    issuerUniverse: contextRows.map((row) => row.issuer),
    trackBAcceptedIssuerEvidenceCount: contextRows.length,
    trackBIssuerEvidenceByIssuer: Object.fromEntries(contextRows.map((row) => [
      row.issuer,
      asArray(row.acceptedIssuerBridgeEvidenceIds).map((evidenceId) => ({ evidenceId })),
    ])),
    localValuationRows: contextRows,
    localValuationCache: {
      rowCount: contextRows.length,
      missingIssuers: seedContext.missingIssuerFundamentals || [],
      sourceProvenance: [...new Set(contextRows.map((row) => row.sourceProvenance).filter(Boolean))],
      asOfDates: [...new Set(contextRows.map((row) => row.asOfDate).filter(Boolean))],
    },
    historicalAnalogueBridge,
    requireHistoricalAnalogueBridge: true,
    marketValidationStatus: seedContext.marketValidationStatus === 'controlled_ready' ? 'controlled_ready' : null,
    marketValidationControlUsed: seedContext.marketValidationStatus === 'controlled_ready',
    marketValidationBenchmarkUsed: seedContext.marketValidationStatus === 'controlled_ready' ? 'local_controlled_market_cache' : null,
  };
}

function candidatesFromBackfillPlan(backfillPlan = {}, limit = 25) {
  return asArray(backfillPlan.tasks).slice(0, Number(limit || 25)).map((task, index) => ({
    candidateId: compact(task.providerRoute || task.providerRouteId || `${task.evidenceClass}:${index}`),
    providerName: compact(task.providerRoute || task.providers?.[0] || task.evidenceClass || 'source-query'),
    evidenceClass: compact(task.evidenceClass || 'provider_data_gap'),
    sourceUrl: compact(task.sourceUrl || task.sourceQueryDrafts?.[0]?.sourceUrl || ''),
    sourceType: compact(task.providerRoute || 'source_query'),
    providerRoute: compact(task.providerRoute || 'source_query'),
    status: task.status === 'provider_gap_proposal_required' ? 'provider_gap_proposal_required' : 'discovered_untrusted',
    fixtureRequired: task.status === 'provider_gap_proposal_required' || task.adapterProposalRequired === true,
    authRequired: task.authRequired === true,
    apiKeyRequired: task.apiKeyRequired === true,
    fixtureRequirement: task.fixtureRequirement || null,
    failureModes: task.failureModes || [],
    metadata: {
      taskId: task.taskId,
      seedId: task.seedId,
      status: task.status,
    },
  }));
}

function reportRowsFromArtifacts({ repairLoop, finalReport } = {}) {
  const rows = [];
  if (repairLoop?.clientMemoPath || repairLoop?.dryRunReportSubject || repairLoop?.runId) {
    rows.push({
      reportId: repairLoop.reportId || repairLoop.runId || 'repair-loop-report',
      reportPath: repairLoop.clientMemoPath || repairLoop.finalInvestmentReportDryRunPath || null,
      generatedAt: repairLoop.generatedAt || new Date().toISOString(),
      subject: repairLoop.dryRunReportSubject?.subjectLabel || repairLoop.inputState?.selectedSeed?.seedTitle || repairLoop.selectedChildSeed?.bottleneckNode || repairLoop.runId,
      childSeedId: repairLoop.selectedChildSeed?.childSeedId || repairLoop.inputState?.selectedSeed?.childSeedId || null,
      parentSeedId: repairLoop.selectedChildSeed?.parentSeedId || null,
      bottleneckNode: repairLoop.selectedChildSeed?.bottleneckNode || null,
    });
  }
  if (finalReport?.clientMemoPath || finalReport?.reportPath || finalReport?.runId) {
    rows.push({
      reportId: finalReport.reportId || finalReport.runId || 'final-report-dry-run',
      reportPath: finalReport.clientMemoPath || finalReport.reportPath || null,
      generatedAt: finalReport.generatedAt || new Date().toISOString(),
      subject: finalReport.subject?.subjectLabel || finalReport.subjectLabel || finalReport.title || finalReport.runId,
      childSeedId: finalReport.subject?.childSeedId || null,
      parentSeedId: finalReport.subject?.parentSeedId || null,
      bottleneckNode: finalReport.subject?.bottleneckNode || null,
    });
  }
  return rows;
}

function zeroBoundary(extra = {}) {
  return {
    providerActivationWrites: 0,
    sourceRegistryWrites: 0,
    canonicalWrites: 0,
    readinessPromotionWrites: 0,
    reportCandidateWrites: 0,
    portfolioActionWrites: 0,
    ...extra,
  };
}

function historicalAnalogueInputFromArtifacts({ repairLoop = {}, finalReport = {}, valuationExpectationBridge = {} } = {}) {
  const subject = repairLoop?.dryRunReportSubject
    || repairLoop?.iterations?.at?.(-1)?.actionResult?.reportSubjectDryRun
    || finalReport?.subject
    || {};
  return {
    seedId: subject.childSeedId || subject.subjectId || repairLoop?.selectedChildSeed?.childSeedId || repairLoop?.inputState?.selectedSeed?.childSeedId || '',
    bottleneckClass: subject.bottleneckClass || repairLoop?.selectedChildSeed?.childClass || repairLoop?.inputState?.selectedSeed?.childClass || '',
    bottleneckNode: subject.bottleneckNode || subject.subjectLabel || repairLoop?.selectedChildSeed?.bottleneckNode || '',
    issuerUniverse: subject.issuerUniverse || valuationExpectationBridge?.issuerUniverse || repairLoop?.issuerUniverse || [],
    issuerRolePattern: valuationExpectationBridge?.issuerValuationBridgeTable?.map((row) => row.roleClass) || [],
    evidenceClasses: [
      ...(valuationExpectationBridge?.issuerValuationBridgeTable?.some((row) => Number(row.acceptedIssuerEvidenceCount || 0) > 0) ? ['issuer_exposure'] : []),
      ...(finalReport?.decisionDiagnostic?.coveredEvidenceClasses || []),
      ...(repairLoop?.acceptedEvidenceClasses || []),
    ],
    catalystTypes: valuationExpectationBridge?.issuerValuationBridgeTable?.map((row) => row.backlogOrGuidanceEvidence || row.operatingExposure) || [],
  };
}

export async function runAutonomousAutomationCycle(options = {}) {
  const runtimeRoot = options.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  const [
    backfillPlan,
    repairLoop,
    finalReport,
    daemonState,
    existingActivation,
    existingProviderQualityFeedback,
    existingFeedbackRemediation,
    existingEvidenceGateConsolidation,
    existingReportCandidateStaging,
    existingValuationExpectationBridge,
    existingHistoricalAnalogueBridge,
  ] = await Promise.all([
    readJson(path.join(runtimeRoot, 'seed-bias-backfill-plan.latest.json')),
    readJson(path.join(runtimeRoot, 'autonomous-research-repair-loop.latest.json')),
    readJson(path.join(runtimeRoot, 'final-investment-report-dry-run.latest.json')),
    readJson(path.join(process.cwd(), 'data', 'daemon-state.json')),
    readJson(path.join(runtimeRoot, 'source-provider-activation.latest.json')),
    readJson(path.join(runtimeRoot, 'provider-quality-feedback.latest.json')),
    readJson(path.join(runtimeRoot, 'automation-feedback-remediation.latest.json')),
    readJson(path.join(runtimeRoot, 'evidence-gate-consolidation.latest.json')),
    readJson(path.join(runtimeRoot, 'report-candidate-staging.latest.json')),
    readJson(path.join(runtimeRoot, 'valuation-expectation-bridge-dry-run.latest.json')),
    readJson(path.join(runtimeRoot, 'historical-analogue-bridge.latest.json')),
  ]);

  const feedbackBackfillTasks = [
    ...asArray(existingFeedbackRemediation?.targetedBackfillTasks),
    ...asArray(existingFeedbackRemediation?.convertedGateTasks),
  ]
    .slice(0, Number(options.limit || 25))
    .map((task) => ({
      ...task,
      taskId: task.taskId ? `${task.taskId}:executor` : `feedback-backfill-${task.evidenceClass}:executor`,
      seedId: task.seedId || 'automation-feedback-remediation',
      providerRoute: asArray(task.providerRoute)[0] || asArray(task.sourceBuckets)[0] || 'source_query',
      status: task.status === 'provider_gap_proposal_required' ? 'provider_gap_proposal_required' : 'queued',
      reviewRequired: false,
      sourceQuery: task.sourceQuery || `targeted ${task.evidenceClass} evidence backfill from source diversity feedback`,
      mutationBoundary: zeroBoundary(task.mutationBoundary || {}),
      remediationSource: existingFeedbackRemediation.version || 'automation-feedback-remediation',
    }));
  const gateConsolidationBackfillTasks = asArray(existingEvidenceGateConsolidation?.suggestedBackfillTasks)
    .slice(0, Number(options.limit || 25))
    .map((task) => ({
      ...task,
      taskId: task.taskId ? `${task.taskId}:executor` : `gate-consolidation-${task.evidenceClass}:executor`,
      seedId: task.seedId || existingEvidenceGateConsolidation?.candidateSeed?.seedId || 'evidence-gate-consolidation',
      providerRoute: task.providerRoute || 'source_query',
      status: task.status || 'queued',
      reviewRequired: task.reviewRequired === true ? true : false,
      sourceQuery: task.sourceQuery || `seed-centric ${task.evidenceClass} gate closure task`,
      mutationBoundary: zeroBoundary(task.mutationBoundary || {}),
      remediationSource: task.remediationSource || existingEvidenceGateConsolidation.version || 'evidence-gate-consolidator',
    }));
  const mergedBackfillTasks = [
    ...asArray(backfillPlan?.tasks),
    ...feedbackBackfillTasks,
    ...gateConsolidationBackfillTasks,
  ].filter((task, index, tasks) => {
    const key = compact(task.taskId || `${task.seedId}:${task.evidenceClass}:${task.providerRoute}`);
    return key && tasks.findIndex((candidate) => compact(candidate.taskId || `${candidate.seedId}:${candidate.evidenceClass}:${candidate.providerRoute}`) === key) === index;
  });
  const effectiveBackfillPlan = {
    ...(backfillPlan || { ok: true }),
    tasks: mergedBackfillTasks,
    feedbackRemediationTaskCount: feedbackBackfillTasks.length,
    gateConsolidationTaskCount: gateConsolidationBackfillTasks.length,
  };

  const providerManifestRegistry = buildSourceProviderManifestRegistry({ generatedAt: new Date().toISOString() });
  const manifestCandidates = buildSourceProviderManifestCandidates({
    registry: providerManifestRegistry,
    generatedAt: new Date().toISOString(),
  });
  const priorityCandidates = buildPrioritySourceProviderCandidates({ generatedAt: new Date().toISOString() });
  const evidenceExecutorRegistry = buildEvidenceExecutorRegistry({ generatedAt: new Date().toISOString() });
  const sectorPackRegistry = buildSectorPackRegistry({ generatedAt: new Date().toISOString() });
  const providerCollectorRegistry = buildProviderCollectorRegistry({
    sourceProviderRegistry: providerManifestRegistry,
    generatedAt: new Date().toISOString(),
  });
  const collectorBackedCandidates = buildCollectorBackedSourceProviderCandidates(providerCollectorRegistry, {
    generatedAt: new Date().toISOString(),
  });
  const backfillCandidates = candidatesFromBackfillPlan(effectiveBackfillPlan, options.limit);
  const fixtureProbePayload = options.verifyProviderFixtures === false
    ? { probesByCandidateId: {}, probeResults: [], verifiedCount: 0, missingCount: manifestCandidates.length }
    : buildPriorityProviderFixtureProbes(manifestCandidates, { generatedAt: new Date().toISOString() });

  const sourceProviderActivation = await runSourceProviderActivation(
    [
      ...manifestCandidates,
      ...collectorBackedCandidates,
      ...backfillCandidates,
    ],
    {
      existing: existingActivation || undefined,
      probesByCandidateId: fixtureProbePayload.probesByCandidateId,
      artifactPath: path.join(runtimeRoot, 'source-provider-activation.latest.json'),
      writeArtifact: options.writeArtifacts !== false,
      mode: options.apply ? 'apply_staged_artifact' : 'dry_run_artifact',
    },
  );

  const stagedProviderLiveExecution = await runStagedProviderLiveExecutor({
    backfillPlan: effectiveBackfillPlan,
    sourceProviderActivation,
    repairLoop,
  }, {
    artifactPath: path.join(runtimeRoot, 'staged-provider-live-executor.latest.json'),
    writeArtifact: options.writeArtifacts !== false,
    mode: options.apply ? 'apply_artifact_only' : 'dry-run',
    executeLive: options.executeStagedProviderLive !== false,
    maxTargets: options.stagedProviderMaxTargets || 5,
    timeoutMs: options.stagedProviderTimeoutMs || 6000,
    fetchImpl: options.fetchImpl,
    providerCollectorRegistry,
  });

  const backfillQueue = await runBackfillQueueExecutor({
    backfillPlan: effectiveBackfillPlan,
    sourceProviderActivation,
  }, {
    artifactPath: path.join(runtimeRoot, 'backfill-queue-executor.latest.json'),
    writeArtifact: options.writeArtifacts !== false,
    mode: options.apply ? 'apply_artifact_only' : 'dry-run',
    sourceProviderActivation,
  });

  const reportSourceQuarantine = buildReportSourceQuarantine({
    reports: reportRowsFromArtifacts({ repairLoop, finalReport }),
    now: new Date(),
    cooldownHours: 168,
  });
  const quarantineArtifact = options.writeArtifacts === false
    ? reportSourceQuarantine
    : await writeReportSourceQuarantineArtifact(reportSourceQuarantine, path.join(runtimeRoot, 'report-source-quarantine.latest.json'));

  let valuationExpectationBridge = existingValuationExpectationBridge;
  const historicalAnalogueBridge = existingHistoricalAnalogueBridge || buildHistoricalAnalogueBridge(
    historicalAnalogueInputFromArtifacts({ repairLoop, finalReport, valuationExpectationBridge }),
    { generatedAt: new Date().toISOString() },
  );
  if (options.writeArtifacts !== false && !existingHistoricalAnalogueBridge) {
    historicalAnalogueBridge.artifactPath = await writeHistoricalAnalogueBridgeArtifact(
      historicalAnalogueBridge,
      path.join(runtimeRoot, 'historical-analogue-bridge.latest.json'),
    );
  }

  const preliminaryEvidenceGateConsolidation = buildEvidenceGateConsolidation({
    stagedProviderLiveExecution,
    backfillQueue,
    repairLoop,
    finalReport,
    valuationExpectationBridge,
    historicalAnalogueBridge,
    reportCandidateStaging: existingReportCandidateStaging,
    existing: existingEvidenceGateConsolidation,
  });
  const trustedValuationRows = await readTrustedLocalValuationRows(runtimeRoot);
  let valuationContextAutoLinker = buildValuationContextAutoLinker({
    evidenceGateConsolidation: preliminaryEvidenceGateConsolidation,
    historicalAnalogueBridge,
    localValuationRows: trustedValuationRows.rows,
    generatedAt: new Date().toISOString(),
  });
  let valuationContextRotation = buildValuationContextRotation({
    seedContexts: valuationContextAutoLinker.seedContexts || [],
    evidenceGateConsolidation: preliminaryEvidenceGateConsolidation,
    generatedAt: new Date().toISOString(),
  });
  const valuationContextRequirementExecutor = await runValuationContextRequirementExecutor({
    valuationContextRotation,
    valuationContextAutoLinker,
    historicalAnalogueBridge,
    existingLocalValuationRows: trustedValuationRows.rows,
    localPriceContextRows: options.localPriceContextRows,
    dbClient: options.dbClient,
    pgConfig: options.pgConfig,
    readDbContext: options.readDbContext !== false,
    runtimeRoot,
    generatedAt: new Date().toISOString(),
  }, {
    writeArtifact: options.writeArtifacts !== false,
    artifactPath: path.join(runtimeRoot, 'valuation-context-requirement-executor.latest.json'),
    cacheArtifactPath: path.join(runtimeRoot, 'trusted-local-valuation-cache.autogenerated.latest.json'),
    mode: options.apply ? 'apply_artifact_only' : 'dry-run',
  });
  const effectiveTrustedValuationRows = [
    ...trustedValuationRows.rows,
    ...asArray(valuationContextRequirementExecutor.rows),
  ];
  if (valuationContextRequirementExecutor.valuationContextRowsCreated > 0) {
    valuationContextAutoLinker = buildValuationContextAutoLinker({
      evidenceGateConsolidation: preliminaryEvidenceGateConsolidation,
      historicalAnalogueBridge,
      localValuationRows: effectiveTrustedValuationRows,
      generatedAt: new Date().toISOString(),
    });
    valuationContextRotation = buildValuationContextRotation({
      seedContexts: valuationContextAutoLinker.seedContexts || [],
      evidenceGateConsolidation: preliminaryEvidenceGateConsolidation,
      generatedAt: new Date().toISOString(),
    });
  }
  const valuationContextSeed = asArray(valuationContextAutoLinker.seedContexts)
    .find((context) => asArray(context.contextRows).length > 0);
  if (valuationContextSeed) {
    valuationExpectationBridge = buildValuationExpectationBridgeDryRun(
      valuationBridgeInputFromSeedContext({
        seedContext: valuationContextSeed,
        historicalAnalogueBridge,
      }),
    );
    valuationExpectationBridge.seedId = valuationContextSeed.seedId;
    valuationExpectationBridge.trackId = valuationContextSeed.trackId || 'issuer_bridge_track';
    valuationExpectationBridge.valuationContextAutoLinker = {
      version: valuationContextAutoLinker.version,
      contextRowCount: valuationContextSeed.contextRows.length,
      missingIssuerFundamentals: valuationContextSeed.missingIssuerFundamentals,
      reflectionStatus: valuationContextAutoLinker.reflectionStatus,
      seedId: valuationContextSeed.seedId,
      trackId: valuationContextSeed.trackId,
      artifactPath: path.resolve(path.join(runtimeRoot, 'valuation-context-auto-linker.latest.json')),
    };
  }
  let evidenceGateConsolidation = buildEvidenceGateConsolidation({
    stagedProviderLiveExecution,
    backfillQueue,
    repairLoop,
    finalReport,
    valuationExpectationBridge,
    historicalAnalogueBridge,
    reportCandidateStaging: existingReportCandidateStaging,
    existing: existingEvidenceGateConsolidation,
  });
  valuationContextRotation = buildValuationContextRotation({
    seedContexts: valuationContextAutoLinker.seedContexts || [],
    evidenceGateConsolidation,
    generatedAt: new Date().toISOString(),
  });
  if (options.writeArtifacts !== false) {
    valuationContextAutoLinker.artifactPath = await writeValuationContextAutoLinkerArtifact(
      {
        ...valuationContextAutoLinker,
        trustedLocalValuationCacheSourceFiles: trustedValuationRows.sourceFiles,
      },
      path.join(runtimeRoot, 'valuation-context-auto-linker.latest.json'),
    );
    valuationContextRotation.artifactPath = await writeValuationContextRotationArtifact(
      valuationContextRotation,
      path.join(runtimeRoot, 'valuation-context-rotation.latest.json'),
    );
    if (valuationExpectationBridge && valuationContextSeed) {
      valuationExpectationBridge.artifactPath = await writeJson(
        path.join(runtimeRoot, 'valuation-expectation-bridge-dry-run.latest.json'),
        valuationExpectationBridge,
      );
    }
    evidenceGateConsolidation.artifactPath = await writeEvidenceGateConsolidationArtifact(
      evidenceGateConsolidation,
      path.join(runtimeRoot, 'evidence-gate-consolidation.latest.json'),
    );
    evidenceGateConsolidation.localFixtureRequirementArtifactPath = await writeJson(
      path.join(runtimeRoot, 'local-market-valuation-fixture-requirements.latest.json'),
      {
        ok: true,
        version: 'local-market-valuation-fixture-requirements-v1',
        generatedAt: new Date().toISOString(),
        source: 'evidence-gate-consolidator',
        requirementCount: (evidenceGateConsolidation.localFixtureRequirements || []).length
          + (valuationContextRotation.valuationContextRequirements || []).length,
        requirements: [
          ...(evidenceGateConsolidation.localFixtureRequirements || []),
          ...(valuationContextRotation.valuationContextRequirements || []),
        ],
        valuationContextRequirementExecutor: {
          taskCount: valuationContextRequirementExecutor.taskCount,
          valuationContextRowsCreated: valuationContextRequirementExecutor.valuationContextRowsCreated,
          missingIssuerFundamentalsAfterExecution: valuationContextRequirementExecutor.missingIssuerFundamentalsAfterExecution,
          valuationContextSourceStatus: valuationContextRequirementExecutor.valuationContextSourceStatus,
          valuationContextExecutionFailureReason: valuationContextRequirementExecutor.valuationContextExecutionFailureReason,
          activeValuationBlockedSeed: valuationContextRequirementExecutor.activeValuationBlockedSeed,
          nextSeedRotationAction: valuationContextRequirementExecutor.nextSeedRotationAction,
        },
        operatorRequiredActions: [
          ...(evidenceGateConsolidation.operatorRequiredActions || []),
          ...((valuationContextRotation.valuationContextRequirements || []).length ? ['provide_local_valuation_context'] : []),
        ],
        stopReason: evidenceGateConsolidation.stopReason,
        mutationBoundary: zeroBoundary(),
      },
    );
  }

  const reportCandidateStaging = buildReportCandidateStaging({
    repairLoop,
    finalReport,
    evidenceGateConsolidation,
    existing: existingReportCandidateStaging,
  });
  if (options.writeArtifacts !== false) {
    reportCandidateStaging.artifactPath = await writeReportCandidateStagingArtifact(
      reportCandidateStaging,
      path.join(runtimeRoot, 'report-candidate-staging.latest.json'),
    );
  }

  const runtimeStatus = buildAutomationRuntimeStatus({
    daemonState: daemonState || {},
    activationArtifact: sourceProviderActivation,
    backfillArtifact: backfillQueue,
    repairLoopArtifact: repairLoop,
    reportSourceQuarantine: quarantineArtifact,
  });
  const runtimeArtifact = options.writeArtifacts === false
    ? runtimeStatus
    : await writeAutomationRuntimeStatus(runtimeStatus, path.join(runtimeRoot, 'automation-runtime-supervisor.latest.json'));

  const qualityGeneratedAt = new Date().toISOString();
  const sourceQualityScore = buildSourceQualityScore({
    stagedProviderLiveExecution,
    backfillQueue,
    generatedAt: qualityGeneratedAt,
  });
  const providerQualityFeedbackWithSourceQuality = buildProviderQualityFeedback({
    stagedProviderLiveExecution,
    backfillQueue,
    sourceProviderActivation,
    providerCollectorRegistry,
    sourceQualityScore,
    existing: existingProviderQualityFeedback,
    generatedAt: qualityGeneratedAt,
  });
  const sourceDiversityFeedback = buildSourceDiversityFeedback({
    sourceProviderActivation,
    stagedProviderLiveExecution,
    backfillQueue,
    reportSourceQuarantine: quarantineArtifact,
    repairLoop,
    finalReport,
    biasDiagnostics: await readJson(path.join(runtimeRoot, 'seed-bias-diagnostics.latest.json')),
    reports: reportRowsFromArtifacts({ repairLoop, finalReport }),
    generatedAt: new Date().toISOString(),
  });
  const automationFeedbackRemediation = buildAutomationFeedbackRemediation({
    providerQualityFeedback: providerQualityFeedbackWithSourceQuality,
    sourceDiversityFeedback,
    evidenceGateConsolidation,
    valuationContextRequirementExecutor,
    valuationContextAutoLinker,
    valuationContextRotation,
    generatedAt: new Date().toISOString(),
  });
  if (options.writeArtifacts !== false) {
    sourceQualityScore.artifactPath = await writeSourceQualityScoreArtifact(
      sourceQualityScore,
      path.join(runtimeRoot, 'source-quality-score.latest.json'),
    );
    providerQualityFeedbackWithSourceQuality.artifactPath = await writeProviderQualityFeedbackArtifact(
      providerQualityFeedbackWithSourceQuality,
      path.join(runtimeRoot, 'provider-quality-feedback.latest.json'),
    );
    sourceDiversityFeedback.artifactPath = await writeSourceDiversityFeedbackArtifact(
      sourceDiversityFeedback,
      path.join(runtimeRoot, 'source-diversity-feedback.latest.json'),
    );
    automationFeedbackRemediation.artifactPath = await writeAutomationFeedbackRemediationArtifact(
      automationFeedbackRemediation,
      path.join(runtimeRoot, 'automation-feedback-remediation.latest.json'),
    );
  }
  const automationFeedbackCodeRepair = await runAutomationFeedbackCodeRepair({
    remediation: automationFeedbackRemediation,
    execute: options.allowCodePatch === true,
    maxRepairs: Number(options.codePatchMaxRepairs || 1),
    parallel: options.parallelCodePatch === true,
    parallelWorkers: Number(options.parallelCodePatchWorkers || 3),
    isolation: 'snapshot-worktree',
    writeArtifact: options.writeArtifacts !== false && options.allowCodePatch === true,
    artifactPath: path.join(runtimeRoot, 'automation-feedback-code-repair.latest.json'),
    verify: options.allowCodePatch === true,
    verifyEvidenceDelta: options.allowCodePatch === true,
    rollbackIneffective: true,
  });

  const sectorPositivePathRegistry = buildSectorPositivePathRegistry();
  const sectorPositivePathSummary = buildSectorPositivePathSummary(sectorPositivePathRegistry);
  let sectorPositivePathArtifact = sectorPositivePathRegistry;
  if (options.writeArtifacts !== false) {
    providerManifestRegistry.artifactPath = await writeSourceProviderManifestRegistryArtifact(
      providerManifestRegistry,
      path.join(runtimeRoot, 'provider-manifest-registry.latest.json'),
    );
    evidenceExecutorRegistry.artifactPath = await writeEvidenceExecutorRegistryArtifact(
      evidenceExecutorRegistry,
      path.join(runtimeRoot, 'evidence-executor-registry.latest.json'),
    );
    sectorPackRegistry.artifactPath = await writeSectorPackRegistryArtifact(
      sectorPackRegistry,
      path.join(runtimeRoot, 'sector-pack-registry.latest.json'),
    );
    providerCollectorRegistry.artifactPath = await writeProviderCollectorRegistryArtifact(
      providerCollectorRegistry,
      path.join(runtimeRoot, 'provider-collector-registry.latest.json'),
    );
    const sectorPath = path.join(runtimeRoot, 'sector-positive-path-registry.latest.json');
    sectorPositivePathArtifact = {
      ...sectorPositivePathRegistry,
      summary: sectorPositivePathSummary,
      artifactPath: await writeJson(sectorPath, {
        ...sectorPositivePathRegistry,
        summary: sectorPositivePathSummary,
      }),
    };
  }

  const consolePayload = buildAutomationConsolePayload({
    runtimeStatus: runtimeArtifact,
    sourceProviderActivation,
    providerFixtureProbes: fixtureProbePayload,
    stagedProviderLiveExecution,
    backfillQueue,
    evidenceGateConsolidation,
    valuationExpectationBridge,
    valuationContextAutoLinker,
    valuationContextRotation,
    valuationContextRequirementExecutor,
    historicalAnalogueBridge,
    reportCandidateStaging,
    reportSourceQuarantine: quarantineArtifact,
    repairLoop,
    biasDiagnostics: await readJson(path.join(runtimeRoot, 'seed-bias-diagnostics.latest.json')),
    finalReport,
    sectorPositivePaths: sectorPositivePathSummary,
    providerManifestRegistry,
    evidenceExecutorRegistry,
    sectorPackRegistry,
    providerCollectorRegistry,
    providerQualityFeedback: providerQualityFeedbackWithSourceQuality,
    sourceQualityScore,
    sourceDiversityFeedback,
    automationFeedbackRemediation,
    automationFeedbackCodeRepair,
  });
  const artifactPaths = {};
  if (options.writeArtifacts !== false) {
    artifactPaths.providerFixtureProbes = await writeJson(
      path.join(runtimeRoot, 'source-provider-fixture-probes.latest.json'),
      fixtureProbePayload,
    );
    artifactPaths.stagedProviderLiveExecution = stagedProviderLiveExecution.artifactPath || path.resolve(path.join(runtimeRoot, 'staged-provider-live-executor.latest.json'));
    artifactPaths.reportCandidateStaging = reportCandidateStaging.artifactPath || path.resolve(path.join(runtimeRoot, 'report-candidate-staging.latest.json'));
    artifactPaths.evidenceGateConsolidation = evidenceGateConsolidation.artifactPath || path.resolve(path.join(runtimeRoot, 'evidence-gate-consolidation.latest.json'));
    artifactPaths.valuationContextAutoLinker = valuationContextAutoLinker.artifactPath || path.resolve(path.join(runtimeRoot, 'valuation-context-auto-linker.latest.json'));
    artifactPaths.valuationContextRotation = valuationContextRotation.artifactPath || path.resolve(path.join(runtimeRoot, 'valuation-context-rotation.latest.json'));
    artifactPaths.valuationContextRequirementExecutor = valuationContextRequirementExecutor.artifactPath || path.resolve(path.join(runtimeRoot, 'valuation-context-requirement-executor.latest.json'));
    artifactPaths.historicalAnalogueBridge = historicalAnalogueBridge.artifactPath || path.resolve(path.join(runtimeRoot, 'historical-analogue-bridge.latest.json'));
    artifactPaths.localMarketValuationFixtureRequirements = evidenceGateConsolidation.localFixtureRequirementArtifactPath || path.resolve(path.join(runtimeRoot, 'local-market-valuation-fixture-requirements.latest.json'));
    artifactPaths.automationConsole = await writeJson(path.join(runtimeRoot, 'automation-console.latest.json'), consolePayload);
  }

  const payload = {
    ok: true,
    source: 'autonomous-automation-cycle',
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'apply_artifact_only' : 'dry-run',
    sourceProviderActivation,
    collectorBackedProviderCandidates: collectorBackedCandidates,
    collectorBackedProviderCandidateCount: collectorBackedCandidates.length,
    providerFixtureProbes: fixtureProbePayload,
    stagedProviderLiveExecution,
    backfillQueue,
    evidenceGateConsolidation,
    valuationExpectationBridge,
    valuationContextAutoLinker,
    valuationContextRotation,
    valuationContextRequirementExecutor,
    historicalAnalogueBridge,
    reportCandidateStaging,
    reportSourceQuarantine: quarantineArtifact,
    runtimeStatus: runtimeArtifact,
    sectorPositivePathRegistry: sectorPositivePathArtifact,
    providerManifestRegistry,
    evidenceExecutorRegistry,
    sectorPackRegistry,
    providerCollectorRegistry,
    providerQualityFeedback: providerQualityFeedbackWithSourceQuality,
    sourceQualityScore,
    sourceDiversityFeedback,
    automationFeedbackRemediation,
    automationFeedbackCodeRepair,
    automationConsole: consolePayload,
    artifactPaths,
    mutationBoundaries: zeroBoundary({
      sourceRegistryWrites: sourceProviderActivation.boundaries?.sourceRegistryWrites || 0,
      providerActivationWrites: sourceProviderActivation.boundaries?.providerActivationWrites || 0,
      rawEvidenceWrites: Number(backfillQueue.mutationBoundaries?.rawEvidenceWrites || 0)
        + Number(stagedProviderLiveExecution.mutationBoundaries?.rawEvidenceWrites || 0),
      acceptedEvidenceWrites: Number(backfillQueue.mutationBoundaries?.acceptedEvidenceWrites || 0)
        + Number(stagedProviderLiveExecution.mutationBoundaries?.acceptedEvidenceWrites || 0),
      gateConsolidationArtifactWrites: evidenceGateConsolidation.mutationBoundary?.gateConsolidationArtifactWrites || 0,
      generatedBackfillTaskArtifactWrites: evidenceGateConsolidation.mutationBoundary?.generatedBackfillTaskArtifactWrites || 0,
      valuationContextRequirementArtifactWrites: valuationContextRequirementExecutor.mutationBoundary?.valuationContextRequirementArtifactWrites || 0,
      valuationContextCacheArtifactWrites: valuationContextRequirementExecutor.mutationBoundary?.valuationContextCacheArtifactWrites || 0,
      reportCandidateStagedArtifactWrites: reportCandidateStaging.mutationBoundary?.reportCandidateStagedArtifactWrites || 0,
    }),
  };
  if (options.writeArtifacts !== false) {
    payload.artifactPaths.providerManifestRegistry = providerManifestRegistry.artifactPath;
    payload.artifactPaths.evidenceExecutorRegistry = evidenceExecutorRegistry.artifactPath;
    payload.artifactPaths.sectorPackRegistry = sectorPackRegistry.artifactPath;
    payload.artifactPaths.providerCollectorRegistry = providerCollectorRegistry.artifactPath;
    payload.artifactPaths.evidenceGateConsolidation = evidenceGateConsolidation.artifactPath;
    payload.artifactPaths.valuationContextAutoLinker = valuationContextAutoLinker.artifactPath || path.resolve(path.join(runtimeRoot, 'valuation-context-auto-linker.latest.json'));
    payload.artifactPaths.valuationContextRotation = valuationContextRotation.artifactPath || path.resolve(path.join(runtimeRoot, 'valuation-context-rotation.latest.json'));
    payload.artifactPaths.historicalAnalogueBridge = historicalAnalogueBridge.artifactPath || path.resolve(path.join(runtimeRoot, 'historical-analogue-bridge.latest.json'));
    payload.artifactPaths.sourceQualityScore = sourceQualityScore.artifactPath;
    payload.artifactPaths.providerQualityFeedback = providerQualityFeedbackWithSourceQuality.artifactPath;
    payload.artifactPaths.sourceDiversityFeedback = sourceDiversityFeedback.artifactPath;
    payload.artifactPaths.automationFeedbackRemediation = automationFeedbackRemediation.artifactPath;
    if (automationFeedbackCodeRepair.artifactPath) {
      payload.artifactPaths.automationFeedbackCodeRepair = automationFeedbackCodeRepair.artifactPath;
    }
    payload.artifactPaths.valuationContextRequirementExecutor = valuationContextRequirementExecutor.artifactPath || path.resolve(path.join(runtimeRoot, 'valuation-context-requirement-executor.latest.json'));
    payload.artifactPaths.cycle = await writeJson(path.join(runtimeRoot, 'autonomous-automation-cycle.latest.json'), payload);
  }
  return payload;
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const result = await runAutonomousAutomationCycle(options);
  process.stdout.write(`${JSON.stringify({
    ok: result.ok,
    mode: result.mode,
    sourceProvider: result.sourceProviderActivation.summary,
    providerFixtureProbes: {
      verifiedCount: result.providerFixtureProbes.verifiedCount,
      missingCount: result.providerFixtureProbes.missingCount,
    },
    stagedProviderLiveExecution: {
      targetCount: result.stagedProviderLiveExecution.targetCount,
      rawEvidenceStoredCount: result.stagedProviderLiveExecution.rawEvidenceStoredCount,
      acceptedEvidenceStoredCount: result.stagedProviderLiveExecution.acceptedEvidenceStoredCount,
      acceptedPromotionEvidenceStoredCount: result.stagedProviderLiveExecution.acceptedPromotionEvidenceStoredCount,
    },
    backfillQueue: {
      taskCount: result.backfillQueue.taskCount,
      rawEvidenceStoredCount: result.backfillQueue.rawEvidenceStoredCount,
      acceptedEvidenceStoredCount: result.backfillQueue.acceptedEvidenceStoredCount,
    },
    reportCandidateStaging: {
      stagingStatus: result.reportCandidateStaging.stagingStatus,
      stageCount: result.reportCandidateStaging.stageCount,
      automaticPromotionAllowed: result.reportCandidateStaging.automaticPromotionAllowed,
      reportCandidateWriteAllowed: result.reportCandidateStaging.reportCandidateWriteAllowed,
    },
    evidenceGateConsolidation: {
      stateCount: result.evidenceGateConsolidation.stateCount,
      candidateSeed: result.evidenceGateConsolidation.candidateSeed,
      nextGateAction: result.evidenceGateConsolidation.nextGateAction,
      suggestedBackfillTaskCount: result.evidenceGateConsolidation.suggestedBackfillTaskCount,
      localFixtureRequirementCount: result.evidenceGateConsolidation.localFixtureRequirementCount,
      stagedForOperatorReview: result.evidenceGateConsolidation.stagedForOperatorReview,
      stopReason: result.evidenceGateConsolidation.stopReason,
    },
    historicalAnalogueBridge: {
      usableAnalogueCount: result.historicalAnalogueBridge?.usableAnalogueCount,
      bestAnalogueIds: result.historicalAnalogueBridge?.bestAnalogueIds,
      reflectionStatus: result.historicalAnalogueBridge?.reflectionStatus,
    },
    valuationContextAutoLinker: {
      gateEligible: result.valuationContextAutoLinker?.gateEligible,
      contextRowCount: result.valuationContextAutoLinker?.contextRows?.length || 0,
      missingIssuerFundamentals: result.valuationContextAutoLinker?.missingIssuerFundamentals || [],
      reflectionStatus: result.valuationContextAutoLinker?.reflectionStatus,
      fixtureRequirementCount: result.valuationContextAutoLinker?.fixtureRequirementCount || 0,
    },
    valuationContextRotation: {
      activeCandidateSeed: result.valuationContextRotation?.activeCandidateSeed || null,
      valuationBlockedCandidateCount: result.valuationContextRotation?.valuationBlockedCandidates?.length || 0,
      nextEligibleSeed: result.valuationContextRotation?.nextEligibleSeed || null,
      rotationReason: result.valuationContextRotation?.rotationReason || null,
      stopReason: result.valuationContextRotation?.stopReason || null,
    },
    valuationContextRequirementExecutor: {
      taskCount: result.valuationContextRequirementExecutor?.taskCount || 0,
      valuationContextRowsCreated: result.valuationContextRequirementExecutor?.valuationContextRowsCreated || 0,
      missingIssuerFundamentalsAfterExecution: result.valuationContextRequirementExecutor?.missingIssuerFundamentalsAfterExecution || [],
      valuationContextSourceStatus: result.valuationContextRequirementExecutor?.valuationContextSourceStatus || null,
      nextSeedRotationAction: result.valuationContextRequirementExecutor?.nextSeedRotationAction || null,
    },
    registries: {
      providerManifestOk: result.providerManifestRegistry.ok,
      providerManifestCount: result.providerManifestRegistry.providerCount,
      collectorBackedProviderCandidates: result.collectorBackedProviderCandidateCount,
      evidenceExecutorOk: result.evidenceExecutorRegistry.ok,
      evidenceExecutorCount: result.evidenceExecutorRegistry.executorCount,
      sectorPackOk: result.sectorPackRegistry.ok,
      sectorPackCount: result.sectorPackRegistry.sectorCount,
      providerCollectorOk: result.providerCollectorRegistry.ok,
      providerCollectorCount: result.providerCollectorRegistry.collectorCount,
      providerQualityFeedbackRecords: result.providerQualityFeedback.recordCount,
      providerQualityRecommendedAction: result.providerQualityFeedback.recommendedRemediationAction,
      sourceQualityRecordCount: result.sourceQualityScore.recordCount,
      sourceQualityTerminalBlockers: result.sourceQualityScore.summary.terminalBlockerCount,
      sourceDiversityRecommendedAction: result.sourceDiversityFeedback.recommendedNextAction,
      feedbackRemediationNextAction: result.automationFeedbackRemediation.summary.nextSafeAction,
      feedbackRemediationTasks: result.automationFeedbackRemediation.summary.targetedBackfillTaskCount,
      feedbackFixtureRequirements: result.automationFeedbackRemediation.summary.fixtureRequirementCount,
      codeRepairMode: result.automationFeedbackCodeRepair.mode,
      codeRepairRequests: result.automationFeedbackCodeRepair.requestCount,
      codeRepairExecuted: result.automationFeedbackCodeRepair.executedCount,
      codeRepairParallel: result.automationFeedbackCodeRepair.parallel,
      codeRepairParallelWorkers: result.automationFeedbackCodeRepair.parallelWorkers,
    },
    runtimeStatus: result.runtimeStatus.runtimeStatus,
    mutationBoundaries: result.mutationBoundaries,
    artifactPaths: result.artifactPaths,
  }, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
